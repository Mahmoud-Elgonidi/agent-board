/**
 * sessionWatcher.js
 * Watches all OpenClaw agent session JSONL files.
 * When an agent starts a new task (from Telegram or main chat),
 * automatically creates a ticket on the board and tracks it.
 *
 * Telegram follow-up:
 *   - If a task runs > 60 seconds and came from Telegram, sends a status
 *     update every 60s (then every 2 min) so the user stays informed.
 *   - On completion sends a detailed "done" message to the same Telegram session.
 */

const fs   = require('fs')
const path = require('path')
const os   = require('os')
const http = require('http')

const { taskQueries, agentQueries, logQueries, commentQueries, sessionMapQueries, settingsQueries } = require('./db')
const orchestrator = require('./orchestrator')
const telegram     = require('./telegram')

const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents')
const ORCHESTRATOR_PORT   = parseInt(process.env.BACKEND_PORT || '3001', 10)

// Read follow-up settings from DB at runtime.
// Per-agent overrides (agent_{id}_followup_*) take priority over global settings.
function getFollowUpSettings(agentName) {
  const agentId = agentName
    ? agentQueries.getAll.all().find((a) => a.name.toLowerCase() === agentName.toLowerCase())?.id
    : null

  function get(perAgentSuffix, globalKey, defaultVal) {
    if (agentId) {
      const v = settingsQueries.get.get(`agent_${agentId}_${perAgentSuffix}`)?.value
      if (v !== undefined && v !== '') return v
    }
    return settingsQueries.get.get(globalKey)?.value ?? defaultVal
  }

  return {
    enabled:      get('followup_enabled',              'telegram_followup_enabled',              '1') !== '0',
    firstDelayMs: parseInt(get('followup_first_delay_seconds', 'telegram_followup_first_delay_seconds', '60'))  * 1000,
    repeatMs:     parseInt(get('followup_repeat_seconds',      'telegram_followup_repeat_seconds',      '120')) * 1000,
    maxCount:     parseInt(get('followup_max_count',           'telegram_followup_max_count',           '0')),
  }
}

// Per-file watcher state
const fileState = new Map()

let broadcast = () => {}
function setBroadcast(fn) { broadcast = fn }

// ─── Public API ──────────────────────────────────────────────────────────────

function start() {
  if (!fs.existsSync(OPENCLAW_AGENTS_DIR)) {
    console.warn(`[sessionWatcher] OpenClaw agents dir not found: ${OPENCLAW_AGENTS_DIR}`)
    return
  }

  const agentDirs = fs.readdirSync(OPENCLAW_AGENTS_DIR)
  for (const agentName of agentDirs) watchAgentDir(agentName)

  fs.watch(OPENCLAW_AGENTS_DIR, (event, name) => {
    if (name) watchAgentDir(name)
  })

  console.log(`[sessionWatcher] Watching ${agentDirs.length} agent(s) in ${OPENCLAW_AGENTS_DIR}`)
}

// ─── Directory watching ───────────────────────────────────────────────────────

function watchAgentDir(agentName) {
  const sessionsDir = path.join(OPENCLAW_AGENTS_DIR, agentName, 'sessions')
  if (!fs.existsSync(sessionsDir)) return

  const isLiveSession = (f) => f.endsWith('.jsonl') && !f.includes('.checkpoint.')

  try {
    for (const file of fs.readdirSync(sessionsDir).filter(isLiveSession)) {
      registerFile(agentName, path.join(sessionsDir, file))
    }
  } catch { /* dir not ready */ }

  try {
    fs.watch(sessionsDir, (event, filename) => {
      if (filename && isLiveSession(filename)) {
        registerFile(agentName, path.join(sessionsDir, filename))
      }
    })
  } catch { /* ok */ }
}

function registerFile(agentName, filePath) {
  if (fileState.has(filePath)) return
  if (!fs.existsSync(filePath)) return

  const size = fs.statSync(filePath).size
  fileState.set(filePath, {
    agentName,
    offset: size,
    sessionId:       null,
    currentRunId:    null,
    currentTaskId:   null,
    toolCallCount:   0,
    completionTimer: null,
    lastEntryTime:   null,
    // follow-up state
    taskSource:      null,   // 'telegram' | 'ui' | null
    taskStartTime:   null,
    followUpTimer:   null,
    followUpCount:   0,
  })

  try { fs.watch(filePath, () => processFile(filePath)) } catch { /* ok */ }
  console.log(`[sessionWatcher] Watching ${agentName} → ${path.basename(filePath)}`)
}

// ─── File processing ──────────────────────────────────────────────────────────

function processFile(filePath) {
  const state = fileState.get(filePath)
  if (!state) return

  let stat
  try { stat = fs.statSync(filePath) } catch { return }
  if (stat.size <= state.offset) return

  const buf = Buffer.alloc(stat.size - state.offset)
  const fd  = fs.openSync(filePath, 'r')
  fs.readSync(fd, buf, 0, buf.length, state.offset)
  fs.closeSync(fd)
  state.offset = stat.size

  const lines = buf.toString('utf8').split('\n').filter((l) => l.trim())
  for (const line of lines) {
    try { handleEntry(filePath, state, JSON.parse(line)) }
    catch { /* skip malformed */ }
  }
}

// ─── Entry handler ────────────────────────────────────────────────────────────

function handleEntry(filePath, state, entry) {
  state.lastEntryTime = Date.now()

  // ── Session start ──────────────────────────────────────────────────
  if (entry.type === 'session') {
    state.sessionId = entry.id
    return
  }

  // ── New agent run (bootstrap) — clear all timers from previous run ─
  if (entry.type === 'custom' && entry.customType === 'openclaw:bootstrap-context:full') {
    state.currentRunId  = entry.data?.runId
    state.toolCallCount = 0
    state.currentTaskId = null
    cancelCompletionTimer(state)
    cancelFollowUpTimer(state)
    state.taskSource    = null
    state.taskStartTime = null
    state.followUpCount = 0

    const existing = state.currentRunId ? sessionMapQueries.getByRunId.get(state.currentRunId) : null
    if (existing) state.currentTaskId = existing.task_id
    return
  }

  // ── Messages ───────────────────────────────────────────────────────
  if (entry.type !== 'message') return
  const { role, content, toolName } = entry.message || {}

  // ── User message → create / associate ticket ───────────────────────
  if (role === 'user') {
    const rawText   = extractText(content)
    const cleanText = cleanUserMessage(rawText)
    if (!cleanText || cleanText.length < 4) return

    const source = detectSource(rawText)
    if (source === 'system') return

    if (!state.currentTaskId && state.currentRunId) {
      state.currentTaskId = createTicket(state, cleanText, source, entry.timestamp)
      state.taskSource    = source
      state.taskStartTime = Date.now()
      state.followUpCount = 0

      // Start follow-up loop only for Telegram tasks (if feature enabled in settings)
      // and only if ticket creation was not blocked (currentTaskId may be null if blocked)
      if (state.currentTaskId && source === 'telegram') {
        const fup = getFollowUpSettings(state.agentName)
        if (fup.enabled) scheduleFollowUp(state, state.currentTaskId, fup.firstDelayMs)
      }
    } else if (state.currentTaskId) {
      addComment(state.currentTaskId, cleanText, source === 'telegram' ? 'تيليجرام' : 'أنت')
    }

    broadcast({
      event: 'agent:activity',
      data: {
        agentName: state.agentName,
        taskId: state.currentTaskId,
        type: 'user_message',
        source,
        snippet: cleanText.slice(0, 200),
        timestamp: Date.now(),
      },
    })
    return
  }

  // ── Tool result → log step ────────────────────────────────────────
  if (role === 'toolResult' && state.currentTaskId) {
    state.toolCallCount++
    const output   = extractText(content)
    const truncated = output?.slice(0, 200) || ''
    writeLog(state.currentTaskId, state.agentName, state.toolCallCount,
      `استخدم أداة \`${toolName || '?'}\`${truncated ? ': ' + truncated : ''}`)
    sendHeartbeat(state.agentName, state.currentTaskId,
      estimateProgress(state.toolCallCount), 'running',
      `${state.agentName} يستخدم: ${toolName || '?'}`)
    cancelCompletionTimer(state)
    broadcast({
      event: 'agent:activity',
      data: { agentName: state.agentName, taskId: state.currentTaskId, type: 'tool', toolName: toolName || '?', snippet: truncated, timestamp: Date.now() },
    })
    return
  }

  // ── Assistant message → potential completion ───────────────────────
  if (role === 'assistant' && state.currentTaskId) {
    const text = extractAssistantText(content)
    if (!text || text.length < 10) return

    cancelCompletionTimer(state)
    broadcast({
      event: 'agent:activity',
      data: { agentName: state.agentName, taskId: state.currentTaskId, type: 'assistant', snippet: text.slice(0, 200), timestamp: Date.now() },
    })

    state.completionTimer = setTimeout(() => finishTask(state, text), 20000)
    return
  }

  if ((role === 'toolCall' || role === 'tool_use') && state.completionTimer) {
    cancelCompletionTimer(state)
  }
}

// ─── Ticket management ────────────────────────────────────────────────────────

function createTicket(state, taskText, source, timestamp) {
  const now = Date.now()

  // Check if agent task creation is enabled
  const allowed = settingsQueries.get.get('agent_task_creation_enabled')?.value ?? '1'
  if (allowed === '0') {
    orchestrator.logEvent('TASK_CREATION_BLOCKED', {
      agentId: null,
      message: `الوكيل "${state.agentName}" حاول إنشاء مهمة تلقائية لكن الإنشاء مُعطَّل من الإعدادات`,
    })
    console.log(`[sessionWatcher] Ticket creation blocked by setting for ${state.agentName}`)
    return null
  }

  const allAgents = agentQueries.getAll.all()
  const boardAgent = allAgents.find((a) => a.name.toLowerCase() === state.agentName.toLowerCase())
  if (!boardAgent) {
    console.warn(`[sessionWatcher] No board agent found matching "${state.agentName}" — ticket will be created without agent assignment. Register the agent in the board to enable auto-assignment.`)
  }

  // Extract a meaningful title — avoid using code block headers, JSON keywords, or
  // single-word lines that give no context.  Reformulation will always overwrite this
  // with a proper action-oriented title once it completes.
  const firstLine = taskText.split('\n').find((l) => {
    const t = l.trim()
    return t.length >= 8 && !/^[`{[\]}<>]/.test(t) && !/^(json|javascript|typescript|python|bash|sh|html|css|xml|yaml|sql)$/i.test(t)
  }) || taskText.trim()

  const rawTitle = firstLine.trim().slice(0, 80) || `مهمة — ${state.agentName}`
  const title = rawTitle || `مهمة — ${state.agentName}`

  const description = `المصدر: ${source === 'telegram' ? '📱 تيليجرام' : '💬 الشات'}\n\n${taskText.slice(0, 2000)}`

  // Create task with reformulating flag and target_agent — title/description will be
  // updated once background reformulation finishes.
  const task = orchestrator.createTask({
    title,
    description,
    priority: 'medium',
    target_agent: boardAgent?.id || null,
    context: { reformulating: true },
  })

  if (boardAgent) {
    // The agent is already actively working on this — mark in_progress immediately.
    orchestrator.updateTask(task.id, { status: 'in_progress', assigned_agent: boardAgent.id, progress: 0 })
    agentQueries.update.run({
      id: boardAgent.id, status: 'busy', current_task_id: task.id, clearTask: 0,
      last_heartbeat: now, name: null, host: null, port: null, max_idle_seconds: null,
    })
    broadcast({ event: 'agent:updated', data: agentQueries.getById.get(boardAgent.id) })
  }

  sessionMapQueries.insert.run({
    session_id: state.sessionId || 'unknown',
    run_id: state.currentRunId || `${state.agentName}-${now}`,
    task_id: task.id,
    agent_name: state.agentName,
    created_at: now,
  })

  orchestrator.logEvent('AUTO_TICKET_CREATED', {
    agentId: boardAgent?.id,
    taskId: task.id,
    message: `تذكرة تلقائية: "${title}" — المصدر: ${source}`,
    metadata: { source, sessionId: state.sessionId, runId: state.currentRunId },
  })

  console.log(`[sessionWatcher] Created ticket "${title}" for agent ${state.agentName} (${source})`)
  sendHeartbeat(state.agentName, task.id, 0, 'running', `${state.agentName} بدأ مهمة جديدة من ${source === 'telegram' ? 'تيليجرام' : 'الشات'}`)

  // Reformulate title/description in background — pass the raw taskText so the AI
  // gets the actual user message content, not the board metadata prefix.
  const { reformulateTask } = require('./taskReformulator')
  reformulateTask(title, taskText).then((reformed) => {
    if (reformed.reformulated) {
      orchestrator.updateTask(task.id, {
        title:       reformed.title,
        description: reformed.description,
        context:     { reformulating: false, reformulated: true },
      })
    } else {
      orchestrator.updateTask(task.id, {
        context: { reformulating: false, reformulated: false },
      })
    }
  }).catch((err) => {
    console.warn(`[sessionWatcher] Reformulation error for ticket "${title}": ${err.message}`)
    try {
      orchestrator.updateTask(task.id, {
        context: { reformulating: false, reformulated: false },
      })
    } catch (_) {}
  })

  return task.id
}

function finishTask(state, finalText) {
  if (!state.currentTaskId) return

  const taskId = state.currentTaskId
  const task   = taskQueries.getById.get(taskId)
  if (!task || task.status === 'done') return

  // Stop follow-up timers immediately
  cancelFollowUpTimer(state)

  const step    = state.toolCallCount + 1
  const summary = finalText.slice(0, 300)
  writeLog(taskId, state.agentName, step, `الرد النهائي: ${summary}`)

  const boardAgent = agentQueries.getAll.all().find((a) => a.name.toLowerCase() === state.agentName.toLowerCase())
  orchestrator.completeTask(taskId, boardAgent?.id, finalText)

  // Send Telegram completion message directly (for telegram-sourced tasks, or as backup)
  if (state.taskSource === 'telegram' || !boardAgent) {
    sendTelegramCompletion(state, task, finalText).catch(() => {})
  }

  console.log(`[sessionWatcher] Task "${task.title}" completed by ${state.agentName}`)

  state.currentTaskId  = null
  state.currentRunId   = null
  state.toolCallCount  = 0
  state.taskSource     = null
  state.taskStartTime  = null
  state.followUpCount  = 0
}

function addComment(taskId, text, author) {
  const now = Date.now()
  commentQueries.insert.run({ task_id: taskId, author, body: text, is_instruction: 0, created_at: now })
  broadcast({ event: 'task:comment', data: { taskId, comment: { task_id: taskId, author, body: text, is_instruction: 0, created_at: now } } })
}

function writeLog(taskId, agentName, step, message) {
  const now = Date.now()
  logQueries.insert.run({ task_id: taskId, agent_id: null, step, message, timestamp: now })
  broadcast({ event: 'task:log', data: { taskId, entry: { step, message, timestamp: now } } })
}

// ─── Telegram follow-up ───────────────────────────────────────────────────────

/**
 * Schedule a periodic follow-up Telegram message.
 * @param {object} state    - file state
 * @param {string} taskId   - the task we are watching
 * @param {number} delayMs  - delay before next message
 */
function scheduleFollowUp(state, taskId, delayMs) {
  cancelFollowUpTimer(state)
  state.followUpTimer = setTimeout(async () => {
    state.followUpTimer = null

    // Bail out if state changed (task done, new task started, source changed)
    if (state.currentTaskId !== taskId || state.taskSource !== 'telegram') return

    const task = taskQueries.getById.get(taskId)
    if (!task || task.status === 'done') return

    // Read current settings — allows live changes without restart
    const fup = getFollowUpSettings(state.agentName)
    if (!fup.enabled) return

    // Respect max follow-up count (0 = unlimited)
    if (fup.maxCount > 0 && (state.followUpCount || 0) >= fup.maxCount) {
      console.log(`[sessionWatcher] Follow-up limit (${fup.maxCount}) reached for "${task.title}"`)
      return
    }

    await sendTelegramFollowUp(state, task)

    // Reschedule with repeat interval (re-read settings each cycle)
    if (state.currentTaskId === taskId) {
      const nextFup = getFollowUpSettings()
      if (nextFup.enabled) scheduleFollowUp(state, taskId, nextFup.repeatMs)
    }
  }, delayMs)
}

/**
 * Send a follow-up "still working" message to Telegram.
 */
async function sendTelegramFollowUp(state, task) {
  const recentLogs  = logQueries.getByTask.all(task.id).slice(-3)
  const elapsedMs   = state.taskStartTime ? Date.now() - state.taskStartTime : 0
  const elapsedMin  = Math.max(1, Math.round(elapsedMs / 60000))

  state.followUpCount = (state.followUpCount || 0) + 1

  const lines = [
    `🔄 <b>متابعة — ${esc(task.title)}</b>`,
    '',
    `🤖 الوكيل <b>${esc(state.agentName)}</b> يعمل على مهمتك`,
    `⏱ منذ: ${elapsedMin} دقيقة`,
    `🔧 خطوات منجزة: ${state.toolCallCount}`,
    `📊 التقدم التقديري: ${estimateProgress(state.toolCallCount)}%`,
  ]

  if (recentLogs.length > 0) {
    lines.push('', '📝 <b>آخر الخطوات:</b>')
    for (const log of recentLogs) {
      const clean = log.message.replace(/`/g, '').slice(0, 120)
      lines.push(`• ${esc(clean)}`)
    }
  }

  lines.push('', '<i>سيصلك إشعار فور الانتهاء</i>')

  const msg = lines.join('\n')

  try {
    await telegram.sendMessage(msg, { account: state.agentName.toLowerCase() })
    console.log(`[sessionWatcher] Follow-up #${state.followUpCount} sent for "${task.title}" (${state.agentName})`)
  } catch (err) {
    console.warn(`[sessionWatcher] Follow-up telegram failed: ${err.message}`)
  }
}

/**
 * Send a "task completed" message to Telegram when the agent finishes.
 */
async function sendTelegramCompletion(state, task, finalText) {
  const recentLogs  = logQueries.getByTask.all(task.id)
  const elapsedMs   = state.taskStartTime ? Date.now() - state.taskStartTime : null
  const duration    = elapsedMs ? formatDuration(elapsedMs) : null

  const lines = [
    `✅ <b>تم الانتهاء من المهمة</b>`,
    '',
    `📋 <b>${esc(task.title)}</b>`,
    `🤖 الوكيل: ${esc(state.agentName)}`,
  ]

  if (duration) lines.push(`⏱ الوقت المستغرق: ${duration}`)
  lines.push(`🔧 إجمالي الخطوات: ${state.toolCallCount}`)

  if (recentLogs.length > 0) {
    lines.push('', '📝 <b>ملخص ما تم إنجازه:</b>')
    const stepsToShow = recentLogs.filter((l) => !l.message.startsWith('الرد النهائي')).slice(-6)
    for (const log of stepsToShow) {
      const clean = log.message.replace(/استخدم أداة `[^`]+`[:\s]*/g, '').slice(0, 100).trim()
      if (clean) lines.push(`• ${esc(clean)}`)
    }
  }

  if (finalText?.trim()) {
    const trimmed = finalText.trim().slice(0, 600)
    lines.push('', `💬 <b>رد الوكيل:</b>`, `<code>${esc(trimmed)}</code>`)
    if (finalText.trim().length > 600) lines.push('<i>... (مقتطع)</i>')
  }

  const msg = lines.join('\n')

  try {
    await telegram.sendMessage(msg, { account: state.agentName.toLowerCase() })
    console.log(`[sessionWatcher] Completion message sent for "${task.title}"`)
  } catch (err) {
    console.warn(`[sessionWatcher] Completion telegram failed: ${err.message}`)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}س ${m % 60}د`
  if (m > 0) return `${m}د ${s % 60}ث`
  return `${s}ث`
}

function extractText(content) {
  if (!content) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n').trim()
  }
  return ''
}

function extractAssistantText(content) {
  if (!content) return ''
  if (Array.isArray(content)) {
    return content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n').trim()
  }
  return ''
}

function cleanUserMessage(raw) {
  if (!raw) return ''
  return raw
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```\n/g, '')
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```\n?/g, '')
    .replace(/\[.*?GMT[^\]]*\]\s*/g, '')
    .trim()
}

function detectSource(raw) {
  if (!raw) return 'unknown'
  if (raw.includes('sender_id') || raw.includes('Conversation info')) return 'telegram'
  if (raw.includes('openclaw-control-ui')) return 'system'
  return 'ui'
}

function estimateProgress(toolCallCount) {
  return Math.min(85, 10 + toolCallCount * 8)
}

function cancelCompletionTimer(state) {
  if (state.completionTimer) {
    clearTimeout(state.completionTimer)
    state.completionTimer = null
  }
}

function cancelFollowUpTimer(state) {
  if (state.followUpTimer) {
    clearTimeout(state.followUpTimer)
    state.followUpTimer = null
  }
}

function sendHeartbeat(agentName, taskId, progress, status, message) {
  const boardAgent = agentQueries.getAll.all().find((a) => a.name.toLowerCase() === agentName.toLowerCase())
  if (!boardAgent) return

  const body = JSON.stringify({ agentId: boardAgent.id, taskId, progress, status, message })
  const req = http.request({
    hostname: 'localhost', port: ORCHESTRATOR_PORT, path: '/api/heartbeat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => res.resume())
  req.on('error', () => {})
  req.write(body)
  req.end()
}

module.exports = { start, setBroadcast }
