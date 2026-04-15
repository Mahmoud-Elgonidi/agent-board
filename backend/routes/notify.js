/**
 * POST /api/tasks/:id/notify
 * Agent calls this to attach an output/result and trigger the Telegram completion notification.
 * Body: { agentId, output, message }
 */
const express = require('express')
const router = express.Router({ mergeParams: true })
const { taskQueries, agentQueries, logQueries } = require('../db')
const telegram = require('../telegram')
const orchestrator = require('../orchestrator')

router.post('/', async (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const { agentId, output, message } = req.body
  const agent = agentId
    ? agentQueries.getById.get(agentId)
    : task.assigned_agent
    ? agentQueries.getById.get(task.assigned_agent)
    : null

  // Log the output as a final step if provided
  if (output?.trim()) {
    const lastStep = logQueries.getLastStep.get(req.params.id)?.last_step ?? 0
    logQueries.insert.run({
      task_id: req.params.id,
      agent_id: agent?.id || null,
      step: lastStep + 1,
      message: `النتيجة النهائية: ${output.trim().slice(0, 500)}`,
      timestamp: Date.now(),
    })
    req.app.locals.broadcast?.({
      event: 'task:log',
      data: {
        taskId: req.params.id,
        entry: { step: lastStep + 1, message: output.trim().slice(0, 500), timestamp: Date.now() },
      },
    })
  }

  // Send Telegram notification now
  const logSteps = logQueries.getByTask.all(req.params.id).map((l) => l.message)
  const durationMs = task.created_at ? Date.now() - task.created_at : null

  try {
    await telegram.notifyTaskComplete({ task, agent, logSteps, output: output?.trim(), durationMs })
    orchestrator.logEvent('TELEGRAM_NOTIFIED', {
      agentId: agent?.id,
      taskId: req.params.id,
      message: `Telegram notification sent for task "${task.title}"`,
    })
    res.json({ ok: true, message: 'Notification sent' })
  } catch (err) {
    console.error('[notify] Telegram failed:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
