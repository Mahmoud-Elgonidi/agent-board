/**
 * routes/queue.js
 * Queue inspection and control endpoints.
 *
 * GET  /api/queue            — full queue snapshot
 * POST /api/queue/process    — trigger processTaskQueue immediately
 * POST /api/queue/reset      — reset all orphaned tasks to todo
 * POST /api/tasks/:id/reset  — reset a single task to todo (in tasks route, but also here)
 */

const express    = require('express')
const router     = express.Router()
const { taskQueries, agentQueries, eventQueries } = require('../db')
const orchestrator = require('../orchestrator')

// GET /api/queue — full queue snapshot
router.get('/', (req, res) => {
  const orphaned   = taskQueries.getOrphaned.all()
  const pending    = taskQueries.getPending.all()
  const active     = taskQueries.getActive.all()
  const agents     = agentQueries.getAll.all()
  const events     = eventQueries.getAll.all()   // last 200 system events

  res.json({
    orphaned,
    pending,
    active,
    agents: {
      idle:    agents.filter((a) => a.status === 'idle'),
      busy:    agents.filter((a) => a.status === 'busy'),
      stuck:   agents.filter((a) => a.status === 'stuck'),
      offline: agents.filter((a) => a.status === 'offline'),
    },
    events,
    summary: {
      orphaned: orphaned.length,
      pending:  pending.length,
      active:   active.length,
      idleAgents: agents.filter((a) => a.status === 'idle').length,
    },
  })
})

// POST /api/queue/process — trigger queue processing + return result
router.post('/process', async (req, res) => {
  try {
    const result = await orchestrator.processTaskQueue()
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/queue/reset — reset all orphaned tasks to todo
router.post('/reset', (req, res) => {
  try {
    const count = orchestrator.resetOrphanedTasks()
    res.json({ ok: true, reset: count })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
