/**
 * agentComms.js
 * Handles outbound communication to OpenClaw agents via CLI.
 * Uses: openclaw agent --agent <id> --message "<task>" --json
 */

const { spawn } = require('child_process')
const http = require('http')

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw'
const ORCHESTRATOR_PORT = parseInt(process.env.BACKEND_PORT || '3001', 10)

// Map board agent names → openclaw agent IDs
function getOpenclawId(agent) {
  return (agent.name || '').toLowerCase()
}

/**
 * Assign a task to an OpenClaw agent.
 * Spawns: openclaw agent --agent <id> --message "<task>" --json
 * Streams output, sends heartbeats back to orchestrator.
 */
function assignTask(agent, task) {
  const agentId = getOpenclawId(agent)
  const message = buildTaskMessage(task)

  console.log(`[agentComms] Launching openclaw agent "${agentId}" for task "${task.title}"`)

  const proc = spawn(OPENCLAW_BIN, [
    'agent',
    '--agent', agentId,
    '--message', message,
    '--json',
  ], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let started = false
  let heartbeatInterval = null

  // Send initial "started" heartbeat
  sendHeartbeat(agent.id, task.id, 5, 'running', `Agent ${agent.name} started task`)
  started = true

  // Send periodic heartbeats every 30s while running so stuck-detection doesn't fire
  heartbeatInterval = setInterval(() => {
    sendHeartbeat(agent.id, task.id, null, 'running', `Agent ${agent.name} is working…`)
  }, 25000)

  proc.stdout.on('data', (chunk) => {
    output += chunk.toString()
    // Try to parse streaming JSON lines for live progress
    const lines = output.split('\n').filter(Boolean)
    for (const line of lines) {
      parseLiveOutput(agent, task, line)
    }
  })

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (text) console.log(`[agentComms][${agent.name}] stderr: ${text}`)
  })

  proc.on('close', (code) => {
    clearInterval(heartbeatInterval)

    if (code === 0) {
      // Try to extract final response text
      let finalMessage = `Task completed by ${agent.name}`
      try {
        const lines = output.trim().split('\n').filter(Boolean)
        const lastLine = lines[lines.length - 1]
        const parsed = JSON.parse(lastLine)
        if (parsed.text || parsed.response || parsed.content) {
          finalMessage = parsed.text || parsed.response || parsed.content
          if (finalMessage.length > 200) finalMessage = finalMessage.slice(0, 200) + '…'
        }
      } catch { /* output wasn't JSON */ }

      console.log(`[agentComms] Agent "${agent.name}" completed task "${task.title}"`)
      sendHeartbeat(agent.id, task.id, 100, 'completed', finalMessage)
    } else {
      console.error(`[agentComms] Agent "${agent.name}" exited with code ${code}`)
      sendHeartbeat(agent.id, task.id, 0, 'failed', `Agent ${agent.name} exited with code ${code}`)
    }
  })

  proc.on('error', (err) => {
    clearInterval(heartbeatInterval)
    console.error(`[agentComms] Failed to spawn openclaw for agent "${agent.name}": ${err.message}`)
    sendHeartbeat(agent.id, task.id, 0, 'failed', `Spawn error: ${err.message}`)
  })

  return Promise.resolve({ ok: true, method: 'cli', pid: proc.pid })
}

/**
 * Soft resume — send a wake-up message to the agent's existing session.
 */
function resumeAgent(agent, task) {
  const agentId = getOpenclawId(agent)
  const message = [
    `[RESUME] أنت كنت تعمل على مهمة وتوقفت. يرجى المتابعة من حيث توقفت.`,
    ``,
    `المهمة: ${task.title}`,
    `نسبة الإنجاز: ${task.progress || 0}%`,
    `الوصف: ${task.description || 'لا يوجد'}`,
    ``,
    `TASK_ID: ${task.id}`,
  ].join('\n')

  console.log(`[agentComms] Soft-resuming agent "${agentId}" on task "${task.title}"`)

  return new Promise((resolve) => {
    const proc = spawn(OPENCLAW_BIN, [
      'agent', '--agent', agentId, '--message', message,
    ], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    proc.on('close', (code) => {
      resolve({ ok: code === 0, method: 'cli', error: code !== 0 ? `Exit code ${code}` : undefined })
    })
    proc.on('error', (err) => {
      resolve({ ok: false, method: 'cli', error: err.message })
    })
  })
}

/**
 * Kill any existing openclaw process for this agent, then start a fresh session.
 * Used when soft resume fails or the process is truly dead.
 * @param {object} agent         - Agent row
 * @param {object} task          - Task row
 * @param {string[]} previousLogs - Log messages from previous run
 */
async function hardRestartAgent(agent, task, previousLogs = []) {
  const agentId = getOpenclawId(agent)
  console.log(`[agentComms] Hard-restarting agent "${agentId}" for task "${task.title}"`)

  // 1. Kill any lingering openclaw processes for this agent
  await killAgentProcess(agentId)

  // 2. Build context-aware restart message
  const message = buildRestartMessage(task, previousLogs)

  // 3. Spawn fresh session — track it just like assignTask
  return new Promise((resolve) => {
    const proc = spawn(OPENCLAW_BIN, [
      'agent', '--agent', agentId, '--message', message, '--json',
    ], {
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    let heartbeatInterval = null

    sendHeartbeat(agent.id, task.id, task.progress || 0, 'running', `${agent.name}: إعادة التشغيل الكاملة…`)

    heartbeatInterval = setInterval(() => {
      sendHeartbeat(agent.id, task.id, null, 'running', `${agent.name} يعمل بعد إعادة التشغيل…`)
    }, 25000)

    proc.stdout.on('data', (chunk) => {
      output += chunk.toString()
      output.split('\n').filter(Boolean).forEach((line) => parseLiveOutput(agent, task, line))
    })

    proc.stderr.on('data', (chunk) => {
      const text = chunk.toString().trim()
      if (text) console.log(`[agentComms][${agent.name}] stderr: ${text}`)
    })

    proc.on('close', (code) => {
      clearInterval(heartbeatInterval)
      resolve({ ok: code === 0, method: 'cli-restart', error: code !== 0 ? `Exit ${code}` : undefined })
    })

    proc.on('error', (err) => {
      clearInterval(heartbeatInterval)
      resolve({ ok: false, method: 'cli-restart', error: err.message })
    })
  })
}

/**
 * Kill all openclaw processes associated with a given agent name.
 * Waits 2 seconds after kill for the OS to reap them.
 */
function killAgentProcess(agentId) {
  return new Promise((resolve) => {
    // pkill -f matches the full command line — safe because agent names are unique slugs
    const killer = spawn('pkill', ['-f', `openclaw.*--agent.*${agentId}`], {
      stdio: 'ignore',
    })
    const done = () => setTimeout(resolve, 2000) // wait for OS to reap
    killer.on('close', done)
    killer.on('error', done) // ok if nothing to kill
  })
}

/**
 * Notify agent that a task has been updated — triggers it to re-read and act on changes.
 * Runs fire-and-forget in background.
 */
function notifyTaskUpdate(agent, task) {
  const agentId = getOpenclawId(agent)
  const message = `[TASK UPDATE] المهمة المعيّنة عليك تم تعديلها. يرجى مراجعة التفاصيل الجديدة والعمل عليها الآن.\n\nعنوان المهمة: ${task.title}\n\nالوصف المحدّث:\n${task.description || 'لا يوجد وصف'}\n\nالأولوية: ${task.priority}\n\nTASK_ID: ${task.id}\n\n---\nعند الانتهاء، اكتب TASK_COMPLETED في آخر ردك.`

  console.log(`[agentComms] Notifying agent "${agentId}" of task update: "${task.title}"`)

  const proc = spawn(OPENCLAW_BIN, [
    'agent',
    '--agent', agentId,
    '--message', message,
    '--json',
  ], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let heartbeatInterval = null

  // Mark agent as busy and send first heartbeat
  sendHeartbeat(agent.id, task.id, task.progress || 0, 'running', `${agent.name} استلم التحديث وبدأ العمل`)

  heartbeatInterval = setInterval(() => {
    sendHeartbeat(agent.id, task.id, null, 'running', `${agent.name} يعمل على التحديثات…`)
  }, 25000)

  proc.stdout.on('data', (chunk) => {
    output += chunk.toString()
    output.split('\n').filter(Boolean).forEach((line) => parseLiveOutput(agent, task, line))
  })

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (text) console.log(`[agentComms][${agent.name}] stderr: ${text}`)
  })

  proc.on('close', (code) => {
    clearInterval(heartbeatInterval)
    if (code === 0) {
      let finalMsg = `${agent.name} أنهى العمل على التحديثات`
      try {
        const lines = output.trim().split('\n').filter(Boolean)
        const parsed = JSON.parse(lines[lines.length - 1])
        if (parsed.text || parsed.response) {
          finalMsg = (parsed.text || parsed.response).slice(0, 200)
        }
      } catch { /* not JSON */ }
      sendHeartbeat(agent.id, task.id, 100, 'completed', finalMsg)
    } else {
      sendHeartbeat(agent.id, task.id, 0, 'failed', `${agent.name} خرج بكود خطأ ${code}`)
    }
  })

  proc.on('error', (err) => {
    clearInterval(heartbeatInterval)
    sendHeartbeat(agent.id, task.id, 0, 'failed', `خطأ في تشغيل الوكيل: ${err.message}`)
  })
}

/**
 * Push agent to continue working on a task that hasn't reached terminal status.
 * Called when an agent signals completion but the ticket is still not in a done state.
 */
function pushAgentToContinue(agent, task, terminalStatuses = []) {
  const agentName = getOpenclawId(agent)

  const statusList = terminalStatuses.length > 0
    ? terminalStatuses.map(s => `  • ${s.label} (id: "${s.id}")`).join('\n')
    : '  • done (مكتملة)'

  const message = [
    `[تنبيه النظام: المهمة لم تكتمل بعد]`,
    ``,
    `أرسلت إشارة إنهاء للمهمة، لكن التذكرة لم تُنقل إلى حالة نهائية.`,
    `الحالة الحالية: "${task.status}" — وهي حالة غير نهائية.`,
    ``,
    `المهمة: ${task.title}`,
    `TASK_ID: ${task.id}`,
    ``,
    `الحالات النهائية المتاحة:`,
    statusList,
    ``,
    `للإنهاء الصحيح:`,
    `1. تحقق من أن جميع متطلبات المهمة اكتملت فعلياً`,
    `2. انقل التذكرة إلى حالة نهائية:`,
    ``,
    `curl -s -X PATCH http://localhost:${ORCHESTRATOR_PORT}/api/tasks/${task.id} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"status":"done"}'`,
    ``,
    `3. ثم أرسل إشعار الاكتمال النهائي:`,
    ``,
    `curl -s -X POST http://localhost:${ORCHESTRATOR_PORT}/api/tasks/${task.id}/notify \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"agentId":"${agent.id}","output":"ملخص ما أنجزته"}'`,
    ``,
    `يُرجى الاستمرار في العمل وإنهاء المهمة بشكل صحيح.`,
  ].join('\n')

  console.log(`[agentComms] Pushing agent "${agentName}" to continue unfinished task "${task.title}"`)

  const proc = spawn(OPENCLAW_BIN, [
    'agent', '--agent', agentName, '--message', message, '--json',
  ], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })

  let output = ''
  let heartbeatInterval = null

  sendHeartbeat(agent.id, task.id, task.progress || 0, 'running',
    `${agent.name}: المهمة لم تكتمل — يستمر في العمل`)

  heartbeatInterval = setInterval(() => {
    sendHeartbeat(agent.id, task.id, null, 'running', `${agent.name} يعمل على إنهاء المهمة…`)
  }, 25000)

  proc.stdout.on('data', (chunk) => {
    output += chunk.toString()
    output.split('\n').filter(Boolean).forEach((line) => parseLiveOutput(agent, task, line))
  })
  proc.stderr.on('data', () => {})

  proc.on('close', (code) => {
    clearInterval(heartbeatInterval)
    if (code === 0) {
      sendHeartbeat(agent.id, task.id, 100, 'completed', `${agent.name}: أنهى المهمة`)
    } else {
      sendHeartbeat(agent.id, task.id, task.progress || 0, 'running',
        `${agent.name}: يحاول إنهاء المهمة…`)
    }
  })
  proc.on('error', (err) => {
    clearInterval(heartbeatInterval)
    console.error(`[agentComms] pushAgentToContinue error for "${agentName}": ${err.message}`)
  })
}

/**
 * Ping agent (not applicable for CLI-only agents — always return ok).
 */
function pingAgent(agent) {
  return Promise.resolve({ ok: true, method: 'cli' })
}

// --- Helpers ---

function buildRestartMessage(task, previousLogs = []) {
  let msg = `[إعادة تشغيل تلقائية] تمت إعادة تشغيلك بعد توقف غير متوقع.\n\n`
  msg += `المهمة: ${task.title}\n`
  if (task.description) msg += `الوصف: ${task.description}\n`
  msg += `الأولوية: ${task.priority || 'medium'}\n`
  msg += `نسبة الإنجاز السابقة: ${task.progress || 0}%\n`
  msg += `TASK_ID: ${task.id}\n`

  if (previousLogs.length > 0) {
    msg += `\nالخطوات التي أتممتها قبل التوقف (لا تعد تنفيذها):\n`
    previousLogs.slice(-10).forEach((log, i) => {
      msg += `  ${i + 1}. ${log}\n`
    })
  }

  msg += `\nيرجى مواصلة العمل من حيث توقفت.\n\n---\n`
  msg += reportingInstructions(task)
  return msg
}

function reportingInstructions(task) {
  let s = `TASK LOG INSTRUCTIONS:\n`
  s += `At every major step, run:\n`
  s += `curl -s -X POST http://localhost:${ORCHESTRATOR_PORT}/api/tasks/${task.id}/log \\\n`
  s += `  -H 'Content-Type: application/json' \\\n`
  s += `  -d '{"message": "خلاصة الخطوة"}'\n\n`
  s += `Log at least 3 steps. Log after EVERY meaningful action.\n\n`
  s += `When fully done:\n`
  s += `curl -s -X POST http://localhost:${ORCHESTRATOR_PORT}/api/tasks/${task.id}/notify \\\n`
  s += `  -H 'Content-Type: application/json' \\\n`
  s += `  -d '{"agentId":"AGENT_ID","output":"ملخص النتيجة النهائية"}'\n\n`
  s += `End your final response with: TASK_COMPLETED`
  return s
}

function buildTaskMessage(task) {
  let msg = `TASK: ${task.title}`
  if (task.description) msg += `\n\nDESCRIPTION:\n${task.description}`
  msg += `\n\nPriority: ${task.priority || 'medium'}`
  msg += `\n\n---\n\n`
  msg += reportingInstructions(task)
  return msg
}

function parseLiveOutput(agent, task, line) {
  try {
    const obj = JSON.parse(line)
    // Look for progress indicators in JSON output
    if (typeof obj.progress === 'number') {
      sendHeartbeat(agent.id, task.id, obj.progress, 'running', obj.message || obj.text || '')
    }
    if (obj.status === 'done' || obj.status === 'completed') {
      sendHeartbeat(agent.id, task.id, 100, 'completed', obj.text || 'Done')
    }
  } catch {
    // Plain text — check for TASK_COMPLETED marker
    if (line.includes('TASK_COMPLETED')) {
      sendHeartbeat(agent.id, task.id, 100, 'completed', 'Task completed')
    }
  }
}

function sendHeartbeat(agentId, taskId, progress, status, message) {
  const body = JSON.stringify({ agentId, taskId, progress, status, message })
  const req = http.request({
    hostname: 'localhost',
    port: ORCHESTRATOR_PORT,
    path: '/api/heartbeat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => {
    res.resume() // drain
  })
  req.on('error', (err) => console.warn(`[agentComms] Heartbeat failed: ${err.message}`))
  req.write(body)
  req.end()
}

module.exports = { assignTask, resumeAgent, hardRestartAgent, killAgentProcess, pingAgent, notifyTaskUpdate, pushAgentToContinue }
