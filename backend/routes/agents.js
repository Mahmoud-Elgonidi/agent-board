const express = require('express')
const router  = express.Router()
const fs      = require('fs')
const path    = require('path')
const os      = require('os')
const { v4: uuidv4 } = require('uuid')
const { agentQueries, taskQueries, logQueries, eventQueries, settingsQueries } = require('../db')
const { resumeAgent, hardRestartAgent, killAgentProcess } = require('../agentComms')

const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents')

// ─── Agent CRUD ───────────────────────────────────────────────────────────────

// GET /api/agents
router.get('/', (req, res) => {
  res.json(agentQueries.getAll.all())
})

// POST /api/agents/register
router.post('/register', (req, res) => {
  const { name, type, host, port, cli_command, max_idle_seconds } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  const agent = {
    id: uuidv4(),
    name: name.trim(),
    type: type || 'openclaw',
    host: host || 'localhost',
    port: port || null,
    cli_command: cli_command || null,
    max_idle_seconds: max_idle_seconds || 180,
    status: 'idle',
    created_at: Date.now(),
  }
  agentQueries.insert.run(agent)

  const created = agentQueries.getById.get(agent.id)
  req.app.locals.broadcast?.({ event: 'agent:registered', data: created })
  res.status(201).json(created)
})

// PATCH /api/agents/:id
router.patch('/:id', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  agentQueries.update.run({
    id: req.params.id,
    name: req.body.name ?? null,
    status: req.body.status ?? null,
    current_task_id: req.body.current_task_id ?? null,
    clearTask: req.body.clearTask ? 1 : 0,
    last_heartbeat: req.body.last_heartbeat ?? null,
    host: req.body.host ?? null,
    port: req.body.port ?? null,
    max_idle_seconds: req.body.max_idle_seconds ?? null,
  })

  const updated = agentQueries.getById.get(req.params.id)
  req.app.locals.broadcast?.({ event: 'agent:updated', data: updated })
  res.json(updated)
})

// DELETE /api/agents/:id
router.delete('/:id', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  agentQueries.delete.run(req.params.id)
  req.app.locals.broadcast?.({ event: 'agent:deleted', data: { id: req.params.id } })
  res.json({ ok: true })
})

// GET /api/agents/:id/logs
router.get('/:id/logs', (req, res) => {
  const logs = eventQueries.getByAgent.all(req.params.id)
  res.json(logs)
})

// POST /api/agents/:id/status — manually override agent status
router.post('/:id/status', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const { status } = req.body
  const VALID = ['idle', 'busy', 'stuck', 'offline']
  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` })
  }

  agentQueries.update.run({
    id: agent.id,
    status,
    clearTask: status === 'idle' || status === 'offline' ? 1 : 0,
    current_task_id: null,
    last_heartbeat: status === 'offline' ? null : Date.now(),
    name: null, host: null, port: null, max_idle_seconds: null,
  })

  const updated = agentQueries.getById.get(agent.id)
  req.app.locals.broadcast?.({ event: 'agent:updated', data: updated })
  res.json(updated)
})

// ─── Per-agent settings ───────────────────────────────────────────────────────

// GET /api/agents/:id/settings
router.get('/:id/settings', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const prefix = `agent_${req.params.id}_`
  const result = {}
  for (const row of settingsQueries.getAll.all()) {
    if (row.key.startsWith(prefix)) result[row.key.slice(prefix.length)] = row.value
  }
  res.json(result)
})

// PATCH /api/agents/:id/settings
// Pass null/empty string to remove an override (reverts to global)
router.patch('/:id/settings', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const now    = Date.now()
  const prefix = `agent_${req.params.id}_`

  for (const [key, value] of Object.entries(req.body)) {
    const fullKey = `${prefix}${key}`
    if (value === null || value === '') {
      settingsQueries.delete.run(fullKey)
    } else {
      settingsQueries.set.run({ key: fullKey, value: String(value), updated_at: now })
    }
  }

  const prefix2 = `agent_${req.params.id}_`
  const result  = {}
  for (const row of settingsQueries.getAll.all()) {
    if (row.key.startsWith(prefix2)) result[row.key.slice(prefix2.length)] = row.value
  }
  res.json(result)
})

// ─── Sessions ─────────────────────────────────────────────────────────────────

// GET /api/agents/:id/sessions — list session files with metadata
router.get('/:id/sessions', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const sessionsDir = path.join(OPENCLAW_AGENTS_DIR, agent.name, 'sessions')

  if (!fs.existsSync(sessionsDir)) {
    return res.json({ sessions: [], dir: sessionsDir, exists: false })
  }

  try {
    const filenames = fs.readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl') && !f.includes('.checkpoint.'))

    const sessions = filenames.map((filename) => {
      const filepath = path.join(sessionsDir, filename)
      try {
        const stat    = fs.statSync(filepath)
        const content = fs.readFileSync(filepath, 'utf8')
        const lines   = content.split('\n').filter((l) => l.trim())

        let firstTs = null, lastTs = null, sessionId = null
        let userMsgs = 0, toolCalls = 0, assistantMsgs = 0, runs = 0

        for (const line of lines) {
          try {
            const e = JSON.parse(line)
            if (!firstTs && e.timestamp) firstTs = e.timestamp
            if (e.timestamp) lastTs = e.timestamp
            if (e.type === 'session') sessionId = e.id
            if (e.type === 'custom' && e.customType === 'openclaw:bootstrap-context:full') runs++
            if (e.type === 'message') {
              const r = e.message?.role
              if (r === 'user') userMsgs++
              else if (r === 'assistant') assistantMsgs++
              else if (r === 'toolCall' || r === 'tool_use') toolCalls++
            }
          } catch { /* skip malformed */ }
        }

        return {
          filename,
          size: stat.size,
          modifiedAt: stat.mtimeMs,
          lineCount: lines.length,
          firstTimestamp: firstTs,
          lastTimestamp: lastTs,
          sessionId,
          userMessages: userMsgs,
          assistantMessages: assistantMsgs,
          toolCalls,
          runs,
        }
      } catch { return null }
    }).filter(Boolean).sort((a, b) => b.modifiedAt - a.modifiedAt)

    res.json({ sessions, dir: sessionsDir, exists: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/agents/:id/sessions/:filename — read messages from a session file
router.get('/:id/sessions/:filename', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const { filename } = req.params
  // Security: only plain .jsonl filenames, no path traversal
  if (!filename.endsWith('.jsonl') || /[/\\]/.test(filename) || filename.includes('..')) {
    return res.status(400).json({ error: 'Invalid filename' })
  }

  const filepath = path.join(OPENCLAW_AGENTS_DIR, agent.name, 'sessions', filename)
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Session not found' })

  try {
    const content  = fs.readFileSync(filepath, 'utf8')
    const allLines = content.split('\n').filter((l) => l.trim())
    const limit    = Math.min(parseInt(req.query.limit) || 150, 500)
    const offset   = Math.max(0, allLines.length - limit)

    const messages = allLines.slice(offset)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)

    res.json({ messages, total: allLines.length, showing: messages.length, filename })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─── Manual recovery actions ──────────────────────────────────────────────────

// POST /api/agents/:id/resume — soft resume (send wake-up message to existing session)
router.post('/:id/resume', async (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const task = agent.current_task_id
    ? taskQueries.getById.get(agent.current_task_id)
    : null
  if (!task) return res.status(400).json({ error: 'لا توجد مهمة نشطة لاستئنافها' })

  try {
    const result = await resumeAgent(agent, task)
    if (result.ok) {
      agentQueries.update.run({
        id: agent.id, status: 'busy', clearTask: 0,
        current_task_id: task.id,
        last_heartbeat: Date.now(),
        name: null, host: null, port: null, max_idle_seconds: null,
      })
      req.app.locals.broadcast?.({ event: 'agent:updated', data: agentQueries.getById.get(agent.id) })
    }
    res.json({ ok: result.ok, method: result.method, error: result.error })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/agents/:id/restart — hard restart (kill process + fresh session)
router.post('/:id/restart', async (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const task = agent.current_task_id
    ? taskQueries.getById.get(agent.current_task_id)
    : null
  if (!task) return res.status(400).json({ error: 'لا توجد مهمة نشطة — لا يمكن الإعادة بدون مهمة' })

  try {
    const previousLogs = logQueries.getByTask.all(task.id).map(l => l.message)
    const result = await hardRestartAgent(agent, task, previousLogs)
    if (result.ok) {
      agentQueries.update.run({
        id: agent.id, status: 'busy', clearTask: 0,
        current_task_id: task.id,
        last_heartbeat: Date.now(),
        name: null, host: null, port: null, max_idle_seconds: null,
      })
      req.app.locals.broadcast?.({ event: 'agent:updated', data: agentQueries.getById.get(agent.id) })
    }
    res.json({ ok: result.ok, method: result.method, error: result.error })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /api/agents/:id/kill — kill the process only (no restart)
router.post('/:id/kill', async (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  try {
    await killAgentProcess(agent.name.toLowerCase())
    agentQueries.update.run({
      id: agent.id, status: 'offline', clearTask: 1,
      current_task_id: null, last_heartbeat: null,
      name: null, host: null, port: null, max_idle_seconds: null,
    })
    req.app.locals.broadcast?.({ event: 'agent:updated', data: agentQueries.getById.get(agent.id) })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

module.exports = router
