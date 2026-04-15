const express = require('express')
const router = express.Router({ mergeParams: true })
const { taskQueries, agentQueries, commentQueries, logQueries } = require('../db')
const orchestrator = require('../orchestrator')
const { notifyTaskUpdate } = require('../agentComms')

// GET /api/tasks/:id/comments
router.get('/', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(commentQueries.getByTask.all(req.params.id))
})

// POST /api/tasks/:id/comments
// Body: { body, author?, isInstruction? }
router.post('/', async (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const { body, author = 'user', isInstruction = false } = req.body
  if (!body?.trim()) return res.status(400).json({ error: 'body is required' })

  const now = Date.now()
  const comment = {
    task_id: req.params.id,
    author: author.trim(),
    body: body.trim(),
    is_instruction: isInstruction ? 1 : 0,
    created_at: now,
  }

  const result = commentQueries.insert.run(comment)
  const inserted = { ...comment, id: result.lastInsertRowid }

  // Broadcast new comment to all UI clients
  req.app.locals.broadcast?.({ event: 'task:comment', data: { taskId: req.params.id, comment: inserted } })

  orchestrator.logEvent('COMMENT_ADDED', {
    taskId: req.params.id,
    agentId: task.assigned_agent,
    message: `تعليق جديد${isInstruction ? ' (تعليمات)' : ''}: ${body.trim().slice(0, 80)}`,
  })

  // If comment is an instruction → re-trigger the agent
  if (isInstruction && task.assigned_agent) {
    const agent = agentQueries.getById.get(task.assigned_agent)

    // If task was done or blocked → bring it back to in_progress
    if (task.status === 'done' || task.status === 'blocked' || task.status === 'todo') {
      orchestrator.updateTask(req.params.id, { status: 'in_progress', progress: task.progress || 0 })

      // Re-mark agent as busy
      agentQueries.update.run({
        id: agent.id,
        status: 'busy',
        current_task_id: req.params.id,
        clearTask: 0,
        last_heartbeat: now,
        name: null, host: null, port: null, max_idle_seconds: null,
      })
      req.app.locals.broadcast?.({ event: 'agent:updated', data: agentQueries.getById.get(agent.id) })
    }

    orchestrator.logEvent('INSTRUCTION_TRIGGERED', {
      taskId: req.params.id,
      agentId: agent.id,
      message: `إعادة تشغيل الوكيل "${agent.name}" بناءً على التعليمات الجديدة`,
    })

    // Build full comment history for context
    const allComments = commentQueries.getByTask.all(req.params.id)
    const allLogs     = logQueries.getByTask.all(req.params.id)

    // Fire-and-forget agent trigger
    triggerAgentWithInstruction(agent, task, allComments, allLogs, body.trim())
  }

  res.status(201).json(inserted)
})

// --- Internal: spawn openclaw with instruction context ---

const { spawn } = require('child_process')
const http = require('http')

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw'
const ORCHESTRATOR_PORT = parseInt(process.env.BACKEND_PORT || '3001', 10)

function triggerAgentWithInstruction(agent, task, allComments, allLogs, newInstruction) {
  const agentId = agent.name.toLowerCase()

  // Build context message
  let message = `[تعليمات جديدة على مهمة جارية]\n\n`
  message += `المهمة: ${task.title}\n`
  if (task.description) message += `الوصف الأصلي: ${task.description}\n`
  message += `\n---\n`

  if (allLogs.length > 0) {
    message += `\nما تم إنجازه حتى الآن:\n`
    allLogs.forEach((l) => { message += `  - الخطوة ${l.step}: ${l.message}\n` })
  }

  if (allComments.length > 1) {
    const prevComments = allComments.slice(0, -1)
    message += `\nالتعليقات السابقة:\n`
    prevComments.forEach((c) => { message += `  [${c.author}]: ${c.body}\n` })
  }

  message += `\n---\n`
  message += `\n🔴 التعليمات الجديدة (الأولوية القصوى):\n${newInstruction}\n`
  message += `\n---\n`
  message += `\nعند كل خطوة مهمة، سجّلها:\n`
  message += `curl -s -X POST http://localhost:${ORCHESTRATOR_PORT}/api/tasks/${task.id}/log -H 'Content-Type: application/json' -d '{"message":"وصف الخطوة"}'\n`
  message += `\nعند الانتهاء من التعليمات:\n`
  message += `curl -s -X POST http://localhost:${ORCHESTRATOR_PORT}/api/tasks/${task.id}/notify -H 'Content-Type: application/json' -d '{"output":"النتيجة النهائية"}'\n`
  message += `\nثم اكتب: TASK_COMPLETED`

  const proc = spawn(OPENCLAW_BIN, ['agent', '--agent', agentId, '--message', message, '--json'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  let heartbeatTimer = setInterval(() => {
    sendHeartbeat(agent.id, task.id, null, 'running', `${agent.name} يعمل على التعليمات الجديدة…`)
  }, 25000)

  sendHeartbeat(agent.id, task.id, task.progress || 0, 'running', `${agent.name} استلم التعليمات وبدأ`)

  proc.stdout.on('data', (chunk) => {
    output += chunk.toString()
    output.split('\n').filter(Boolean).forEach((line) => {
      if (line.includes('TASK_COMPLETED')) {
        sendHeartbeat(agent.id, task.id, 100, 'completed', 'اكتملت التعليمات')
      }
      try {
        const obj = JSON.parse(line)
        if (typeof obj.progress === 'number') sendHeartbeat(agent.id, task.id, obj.progress, 'running', obj.message || '')
      } catch { /* plain text */ }
    })
  })

  proc.stderr.on('data', (chunk) => {
    const t = chunk.toString().trim()
    if (t) console.log(`[comments][${agent.name}] stderr: ${t}`)
  })

  proc.on('close', (code) => {
    clearInterval(heartbeatTimer)
    if (code === 0) {
      let finalMsg = `${agent.name} أنهى تنفيذ التعليمات`
      try {
        const lines = output.trim().split('\n').filter(Boolean)
        const parsed = JSON.parse(lines[lines.length - 1])
        if (parsed.text || parsed.response) finalMsg = (parsed.text || parsed.response).slice(0, 300)
      } catch { /* ok */ }
      sendHeartbeat(agent.id, task.id, 100, 'completed', finalMsg)
    } else {
      sendHeartbeat(agent.id, task.id, 0, 'failed', `خطأ في تنفيذ التعليمات (كود ${code})`)
    }
  })

  proc.on('error', (err) => {
    clearInterval(heartbeatTimer)
    sendHeartbeat(agent.id, task.id, 0, 'failed', `خطأ في تشغيل الوكيل: ${err.message}`)
  })
}

function sendHeartbeat(agentId, taskId, progress, status, message) {
  const body = JSON.stringify({ agentId, taskId, progress, status, message })
  const req = http.request({
    hostname: 'localhost', port: ORCHESTRATOR_PORT, path: '/api/heartbeat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => res.resume())
  req.on('error', () => {})
  req.write(body)
  req.end()
}

module.exports = router
