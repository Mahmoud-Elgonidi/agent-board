const express = require('express')
const router = express.Router()
const orchestrator = require('../orchestrator')

// POST /api/heartbeat
// Body: { agentId, taskId, progress, status, message }
router.post('/', (req, res) => {
  const { agentId, taskId, progress, status, message } = req.body

  if (!agentId) return res.status(400).json({ error: 'agentId is required' })

  orchestrator.handleHeartbeat({
    agentId,
    taskId,
    progress: typeof progress === 'number' ? progress : parseInt(progress, 10) || 0,
    status: status || 'running',
    message: message || '',
  })

  res.json({ ok: true, received: Date.now() })
})

module.exports = router
