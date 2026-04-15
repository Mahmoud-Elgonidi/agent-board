const express = require('express')
const router = express.Router({ mergeParams: true })
const { taskQueries, logQueries } = require('../db')

// GET /api/tasks/:id/log
router.get('/', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  res.json(logQueries.getByTask.all(req.params.id))
})

// POST /api/tasks/:id/log
// Body: { agentId, message, step? }
router.post('/', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const { agentId, message, step } = req.body
  if (!message?.trim()) return res.status(400).json({ error: 'message is required' })

  // Auto-increment step if not provided
  const lastStep = logQueries.getLastStep.get(req.params.id)?.last_step ?? 0
  const entryStep = typeof step === 'number' ? step : lastStep + 1

  const entry = {
    task_id: req.params.id,
    agent_id: agentId || task.assigned_agent || null,
    step: entryStep,
    message: message.trim(),
    timestamp: Date.now(),
  }

  logQueries.insert.run(entry)

  // Broadcast to UI
  req.app.locals.broadcast?.({
    event: 'task:log',
    data: { taskId: req.params.id, entry: { ...entry, id: lastStep + 1 } },
  })

  res.status(201).json(entry)
})

// DELETE /api/tasks/:id/log  — clear the log
router.delete('/', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })
  logQueries.deleteByTask.run(req.params.id)
  req.app.locals.broadcast?.({ event: 'task:log:cleared', data: { taskId: req.params.id } })
  res.json({ ok: true })
})

module.exports = router
