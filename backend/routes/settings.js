const express = require('express')
const router = express.Router()
const { settingsQueries, statsQueries, agentQueries } = require('../db')

// GET /api/settings — all settings as { key: value } object
router.get('/', (req, res) => {
  const rows = settingsQueries.getAll.all()
  const result = {}
  for (const row of rows) result[row.key] = row.value
  res.json(result)
})

// PATCH /api/settings — update one or more settings
// Body: { key: value, key2: value2, ... }
router.patch('/', (req, res) => {
  const now = Date.now()
  const updates = req.body
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Body must be a JSON object of key→value pairs' })
  }
  for (const [key, value] of Object.entries(updates)) {
    settingsQueries.set.run({ key, value: String(value), updated_at: now })
  }
  // Return all settings after update
  const rows = settingsQueries.getAll.all()
  const result = {}
  for (const row of rows) result[row.key] = row.value
  res.json(result)
})

// GET /api/settings/stats — database + runtime stats
router.get('/stats', (req, res) => {
  const counts = statsQueries.counts.get()
  res.json({ counts })
})

// DELETE /api/settings/tasks/done — remove completed tasks
router.delete('/tasks/done', (req, res) => {
  const info = statsQueries.clearDoneTasks.run()
  req.app.locals.broadcast?.({ event: 'tasks:cleared', data: { type: 'done', count: info.changes } })
  res.json({ ok: true, deleted: info.changes })
})

// DELETE /api/settings/events — clear event log
router.delete('/events', (req, res) => {
  statsQueries.clearEvents.run()
  res.json({ ok: true })
})

// PUT /api/settings/agents/:id — full agent config update
router.put('/agents/:id', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  const { name, type, host, port, cli_command, max_idle_seconds } = req.body
  agentQueries.updateConfig.run({
    id: req.params.id,
    name: name?.trim() || null,
    type: type || null,
    host: host?.trim() || null,
    port: port ? parseInt(port) : null,
    cli_command: cli_command?.trim() || null,
    max_idle_seconds: max_idle_seconds ? parseInt(max_idle_seconds) : null,
  })

  const updated = agentQueries.getById.get(req.params.id)
  req.app.locals.broadcast?.({ event: 'agent:updated', data: updated })
  res.json(updated)
})

// POST /api/settings/agents/:id/reset — force agent back to idle
router.post('/agents/:id/reset', (req, res) => {
  const agent = agentQueries.getById.get(req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })

  agentQueries.update.run({
    id: req.params.id,
    status: 'idle',
    clearTask: 1,
    current_task_id: null,
    last_heartbeat: Date.now(),
    name: null, host: null, port: null, max_idle_seconds: null,
  })

  const updated = agentQueries.getById.get(req.params.id)
  req.app.locals.broadcast?.({ event: 'agent:updated', data: updated })
  res.json(updated)
})

module.exports = router
