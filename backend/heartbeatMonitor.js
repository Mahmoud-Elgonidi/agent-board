/**
 * heartbeatMonitor.js
 * Runs every 30 seconds. Detects stuck agents and triggers auto-resume.
 *
 * Retry tiers (per agent):
 *   1st stuck → soft resume (send message to existing session)
 *   2nd stuck → hard restart (kill process + fresh session with context)
 *   3rd stuck → hard restart again (last chance)
 *   4th stuck → give up: mark offline, Telegram alert, require manual action
 *
 * Between each tier the agent must be silent for max_idle_seconds again.
 * When a heartbeat arrives, the retry counter resets.
 */

const { agentQueries, taskQueries, commentQueries, logQueries, settingsQueries } = require('./db')
const { resumeAgent, hardRestartAgent } = require('./agentComms')
const { logEvent, updateTask } = require('./orchestrator')
const telegram = require('./telegram')

let broadcast    = () => {}
let timerHandle  = null

// agentId → { count, lastAttemptAt }
const retryState = new Map()

function setBroadcast(fn) { broadcast = fn }

/** Call this when a heartbeat arrives from an agent — resets its retry counter. */
function resetAgentRetry(agentId) { retryState.delete(agentId) }

// ─── Settings (read from DB each cycle so changes apply without restart) ──────

function getHBSettings() {
  const g = (key, def) => settingsQueries.get.get(key)?.value ?? def
  return {
    intervalMs:            parseInt(g('heartbeat_interval_ms',   process.env.HEARTBEAT_INTERVAL_MS  || '30000')),
    stuckThresholdSeconds: parseInt(g('stuck_threshold_seconds', process.env.STUCK_THRESHOLD_SECONDS || '180')),
    maxRetries:            parseInt(g('max_agent_retries',       process.env.MAX_AGENT_RETRIES       || '3')),
  }
}

// ─── Main check loop ─────────────────────────────────────────────────────────

async function checkAgents() {
  const now      = Date.now()
  const settings = getHBSettings()
  const agents   = agentQueries.getAll.all()

  for (const agent of agents) {
    // Only track agents that are supposed to be working
    if (agent.status === 'offline' || agent.status === 'idle') {
      retryState.delete(agent.id)
      continue
    }

    // Agents with no heartbeat yet are still starting up — skip
    if (!agent.last_heartbeat) continue

    const idleMs = now - agent.last_heartbeat
    // Per-agent override → global setting → default 180s
    const thresholdMs = (agent.max_idle_seconds || settings.stuckThresholdSeconds) * 1000

    if (idleMs > thresholdMs) {
      await handleStuckAgent(agent, now, settings.maxRetries)
    }
  }
}

// ─── Stuck agent handler ──────────────────────────────────────────────────────

async function handleStuckAgent(agent, now, maxRetries) {
  const state = retryState.get(agent.id) || { count: 0, lastAttemptAt: 0 }
  const idleSec = Math.round((now - agent.last_heartbeat) / 1000)

  // ── Check if this agent has given up ──────────────────────────────────────
  if (state.count >= maxRetries) {
    // Already gave up on a previous cycle — ensure it stays offline
    if (agent.status !== 'offline') {
      agentQueries.update.run({
        id: agent.id, status: 'offline', clearTask: 0, current_task_id: null,
        last_heartbeat: null, name: null, host: null, port: null, max_idle_seconds: null,
      })
      broadcast({ event: 'agent:updated', data: agentQueries.getById.get(agent.id) })
    }
    return
  }

  // ── Advance retry counter ──────────────────────────────────────────────────
  state.count += 1
  state.lastAttemptAt = now
  retryState.set(agent.id, state)

  const attemptLabel = `المحاولة ${state.count}/${maxRetries}`
  const idleFormatted = formatDuration(now - agent.last_heartbeat)
  const lastSeenFormatted = formatTime(agent.last_heartbeat)

  console.warn(`[heartbeatMonitor] Agent "${agent.name}" stuck (idle ${idleSec}s) — ${attemptLabel}`)

  // Get current task and its log history
  const currentTask = agent.current_task_id ? taskQueries.getById.get(agent.current_task_id) : null
  const previousLogs = currentTask
    ? logQueries.getByTask.all(currentTask.id).map((l) => l.message)
    : []

  // ── Mark agent as stuck ────────────────────────────────────────────────────
  agentQueries.update.run({
    id: agent.id, status: 'stuck', clearTask: 0, current_task_id: null,
    last_heartbeat: null, name: null, host: null, port: null, max_idle_seconds: null,
  })
  broadcast({ event: 'agent:stuck', data: agentQueries.getById.get(agent.id) })
  broadcast({
    event: 'agent:activity',
    data: {
      agentName: agent.name,
      taskId: currentTask?.id ?? null,
      type: 'stuck',
      snippet: `توقف (${idleFormatted}) — ${attemptLabel}`,
      timestamp: now,
    },
  })

  logEvent('STUCK_DETECTED', {
    agentId: agent.id,
    taskId: currentTask?.id ?? null,
    message: `Agent "${agent.name}" stuck — idle ${idleSec}s — ${attemptLabel}`,
    metadata: { idleSeconds: idleSec, attempt: state.count, maxRetries: maxRetries },
  })

  // ── Write diagnostic comment to task ──────────────────────────────────────
  if (currentTask) {
    const stuckNote = buildStuckNote({ agent, currentTask, idleFormatted, lastSeenFormatted, attempt: state.count, maxRetries: maxRetries })
    writeComment(currentTask.id, '⚙️ النظام', stuckNote, now)

    // Block the task while we try to recover
    if (currentTask.status === 'in_progress') {
      updateTask(currentTask.id, { status: 'blocked' })
    }
  }

  // ── Telegram: notify about this stuck detection ───────────────────────────
  const method = state.count === 1 ? 'soft-resume' : 'hard-restart'
  telegram.notifyAgentStuck({
    agent, task: currentTask,
    attempt: state.count, maxRetries: maxRetries,
    idleFormatted, method,
  }).catch(e => console.warn('[heartbeatMonitor] Telegram stuck failed:', e.message))

  // ── Choose recovery strategy based on attempt number ─────────────────────
  let result

  if (state.count < maxRetries) {
    // Attempts 1..maxRetries-1: escalating strategy
    if (state.count === 1) {
      // Soft resume — just send a message to the existing session
      console.log(`[heartbeatMonitor] Attempt ${state.count}: soft resume → ${agent.name}`)
      result = await resumeAgent(agent, currentTask || { title: 'Unknown', progress: 0 })
    } else {
      // Hard restart — kill process, start fresh session with full context
      console.log(`[heartbeatMonitor] Attempt ${state.count}: hard restart → ${agent.name}`)
      result = currentTask
        ? await hardRestartAgent(agent, currentTask, previousLogs)
        : { ok: false, error: 'No active task — cannot restart' }
    }

    // ── Handle resume/restart result ─────────────────────────────────────────
    if (result.ok) {
      const methodLabel = result.method === 'cli-restart' ? 'إعادة تشغيل كاملة' : 'استئناف ناعم'
      console.log(`[heartbeatMonitor] Recovery triggered (${methodLabel}) for "${agent.name}"`)

      // Mark agent busy again and reset last_heartbeat so the monitor waits again
      agentQueries.update.run({
        id: agent.id, status: 'busy', clearTask: 0,
        current_task_id: currentTask?.id ?? null,
        last_heartbeat: Date.now(), // restart the idle clock
        name: null, host: null, port: null, max_idle_seconds: null,
      })

      if (currentTask?.status === 'blocked') {
        updateTask(currentTask.id, { status: 'in_progress' })
      }

      logEvent('AGENT_RESUMED', {
        agentId: agent.id,
        taskId: currentTask?.id ?? null,
        message: `Agent "${agent.name}" recovery triggered via ${methodLabel} (attempt ${state.count})`,
        metadata: { method: result.method, attempt: state.count },
      })

      broadcast({ event: 'agent:resumed', data: agentQueries.getById.get(agent.id) })
      broadcast({
        event: 'agent:activity',
        data: {
          agentName: agent.name,
          taskId: currentTask?.id ?? null,
          type: 'resumed',
          snippet: `${methodLabel} — ${attemptLabel}`,
          timestamp: Date.now(),
        },
      })

      if (currentTask) {
        const resumeNote = buildResumeNote(agent, result, state.count)
        writeComment(currentTask.id, '⚙️ النظام', resumeNote, Date.now())
      }

      // Telegram: confirm recovery
      telegram.notifyAgentRecovered({
        agent, task: currentTask,
        attempt: state.count, method: result.method,
      }).catch(e => console.warn('[heartbeatMonitor] Telegram recovered failed:', e.message))

    } else {
      // Recovery command failed immediately (spawn error, etc.)
      console.error(`[heartbeatMonitor] Recovery failed immediately for "${agent.name}": ${result.error}`)

      // Keep last_heartbeat = null so next monitor cycle will trigger again quickly
      // (already null from the stuck-mark above)
      if (currentTask) {
        const failNote = `⚠️ ${attemptLabel}: فشل أمر الاستئناف.\nالسبب: ${result.error || 'غير معروف'}\nسيُعاد المحاولة في الدورة القادمة.`
        writeComment(currentTask.id, '⚙️ النظام', failNote, Date.now())
      }
    }

  } else {
    // Final attempt exhausted → give up
    console.error(`[heartbeatMonitor] All ${maxRetries} retries exhausted for "${agent.name}" — marking offline`)

    agentQueries.update.run({
      id: agent.id, status: 'offline', clearTask: 0, current_task_id: null,
      last_heartbeat: null, name: null, host: null, port: null, max_idle_seconds: null,
    })
    broadcast({ event: 'agent:updated', data: agentQueries.getById.get(agent.id) })
    broadcast({
      event: 'agent:activity',
      data: {
        agentName: agent.name,
        taskId: currentTask?.id ?? null,
        type: 'stuck',
        snippet: `تم استنفاد ${maxRetries} محاولات — الوكيل خارج الخدمة`,
        timestamp: Date.now(),
      },
    })

    logEvent('AGENT_GAVE_UP', {
      agentId: agent.id,
      taskId: currentTask?.id ?? null,
      message: `Agent "${agent.name}" — all ${maxRetries} retries exhausted, marking offline`,
      metadata: { attempts: maxRetries },
    })

    if (currentTask) {
      const gaveUpNote = buildGaveUpNote(agent, maxRetries)
      writeComment(currentTask.id, '⚙️ النظام', gaveUpNote, Date.now())
    }

    // Telegram alert
    telegram.notifyAgentGaveUp({ agent, task: currentTask, attempts: maxRetries })
      .catch((err) => console.warn(`[heartbeatMonitor] Telegram alert failed: ${err.message}`))
  }
}

// ─── Comment helpers ──────────────────────────────────────────────────────────

function writeComment(taskId, author, body, now) {
  commentQueries.insert.run({ task_id: taskId, author, body, is_instruction: 0, created_at: now })
  broadcast({ event: 'task:comment', data: { taskId, comment: { task_id: taskId, author, body, is_instruction: 0, created_at: now } } })
}

function buildStuckNote({ agent, currentTask, idleFormatted, lastSeenFormatted, attempt, maxRetries }) {
  const tier = attempt === 1 ? 'استئناف ناعم' : 'إعادة تشغيل كاملة'
  let note = `🔴 الوكيل ${agent.name} توقف عن الاستجابة\n\n`
  note += `التشخيص:\n`
  note += `• المدة منذ آخر نشاط: ${idleFormatted}\n`
  note += `• آخر نبضة استُقبلت: ${lastSeenFormatted}\n`
  note += `• الحد المسموح به: ${agent.max_idle_seconds || 180} ثانية\n`
  note += `• حالة المهمة قبل التوقف: ${currentTask.status}\n`
  note += `• نسبة الإنجاز عند التوقف: ${currentTask.progress || 0}%\n`
  note += `• المحاولة: ${attempt}/${maxRetries}\n`
  note += `\nإجراء تلقائي: جارٍ تنفيذ ${tier}…`
  return note
}

function buildResumeNote(agent, result, attempt) {
  const method = result.method === 'cli-restart' ? 'إعادة تشغيل كاملة (CLI)' : 'استئناف ناعم (CLI)'
  return `✅ نجح الإجراء التلقائي (المحاولة ${attempt})\nالطريقة: ${method}\nالوكيل ${agent.name} يتابع العمل الآن.`
}

function buildGaveUpNote(agent, attempts) {
  let note = `🚨 فشل الاسترداد التلقائي بعد ${attempts} محاولات\n\n`
  note += `الوكيل ${agent.name} خارج الخدمة تماماً.\n`
  note += `تم إرسال تنبيه عبر تيليجرام.\n\n`
  note += `⚠️ مطلوب تدخل يدوي:\n`
  note += `• افتح الطرفية وشغّل: openclaw agent --agent ${agent.name.toLowerCase()}\n`
  note += `• أو أعد تشغيل الوكيل من لوحة التحكم`
  return note
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatDuration(ms) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  if (m > 0) return `${m} دقيقة${s % 60 > 0 ? ` و${s % 60} ثانية` : ''}`
  return `${s} ثانية`
}

function formatTime(ts) {
  if (!ts) return 'غير معروف'
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

function scheduleNext() {
  const s     = getHBSettings()
  timerHandle = setTimeout(async () => {
    await checkAgents().catch(err => console.error('[heartbeatMonitor] Error during check:', err))
    scheduleNext()
  }, s.intervalMs)
}

function start() {
  if (timerHandle) return
  const s = getHBSettings()
  console.log(`[heartbeatMonitor] Starting — interval: ${s.intervalMs / 1000}s, stuck: ${s.stuckThresholdSeconds}s, maxRetries: ${s.maxRetries}`)
  scheduleNext()
}

function stop() {
  if (timerHandle) { clearTimeout(timerHandle); timerHandle = null }
}

module.exports = { start, stop, setBroadcast, resetAgentRetry }
