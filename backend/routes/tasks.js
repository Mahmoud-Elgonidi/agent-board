const express = require('express')
const router = express.Router()
const { v4: uuidv4 } = require('uuid')
const { taskQueries, agentQueries, statusQueries, settingsQueries } = require('../db')
const orchestrator = require('../orchestrator')
const { normalizeTask } = orchestrator
const { notifyTaskUpdate, assignTask } = require('../agentComms')
const { reformulateTask } = require('../taskReformulator')

// GET /api/tasks
router.get('/', (req, res) => {
  const tasks = taskQueries.getAll.all().map(normalizeTask)
  res.json(tasks)
})

// POST /api/tasks
router.post('/', async (req, res) => {
  const { title, description, priority, context, target_agent, agentId } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'title is required' })

  // Block agent-created tasks if the setting is disabled
  if (agentId) {
    const allowed = settingsQueries.get.get('agent_task_creation_enabled')?.value ?? '1'
    if (allowed === '0') {
      orchestrator.logEvent('TASK_CREATION_BLOCKED', {
        agentId,
        message: `الوكيل "${agentId}" حاول إنشاء مهمة "${title?.trim()}" لكن الإنشاء مُعطَّل من الإعدادات`,
      })
      return res.status(403).json({
        error: 'agent_task_creation_disabled',
        message: 'إنشاء المهام من الوكلاء مُعطَّل حالياً من إعدادات النظام',
      })
    }
  }

  // Validate target_agent if provided
  if (target_agent) {
    const agent = agentQueries.getById.get(target_agent)
    if (!agent) return res.status(400).json({ error: 'الوكيل المحدد غير موجود' })
  }

  // Create task immediately with original content
  const task = orchestrator.createTask({
    title: title.trim(),
    description: description || '',
    priority: priority || 'medium',
    target_agent: target_agent || null,
    context: { ...(context || {}), reformulating: true },
  })

  // Respond immediately — reformulation happens in background
  res.status(201).json(task)

  // Fire-and-forget: reformulate THEN trigger the queue
  // (queue is intentionally NOT triggered before reformulation finishes)
  reformulateTask(title.trim(), description || '').then((reformed) => {
    if (reformed.reformulated) {
      orchestrator.updateTask(task.id, {
        title:       reformed.title,
        description: reformed.description,
        context:     { ...(context || {}), reformulating: false, reformulated: true },
      })
    } else {
      orchestrator.updateTask(task.id, {
        context: { ...(context || {}), reformulating: false, reformulated: false },
      })
    }
  }).catch((err) => {
    // Even on failure: clear the reformulating flag so the task isn't stuck
    console.warn(`[tasks] Background reformulation error: ${err.message}`)
    try {
      orchestrator.updateTask(task.id, {
        context: { ...(context || {}), reformulating: false, reformulated: false },
      })
    } catch (_) {}
  }).finally(() => {
    // Now the task is ready — trigger queue to assign it if eligible
    orchestrator.processTaskQueue().catch(() => {})
  })
})

// PATCH /api/tasks/:id
router.patch('/:id', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const { status, progress, agentId, title, description, priority, position, context, target_agent } = req.body

  // Handle agent assignment via this endpoint
  if (agentId && status === 'in_progress') {
    orchestrator.assignTaskToAgent(req.params.id, agentId)
      .then((updated) => res.json(updated))
      .catch((err) => res.status(400).json({ error: err.message }))
    return
  }

  const prevStatus = task.status
  const updated = orchestrator.updateTask(req.params.id, {
    title,
    description,
    status,
    priority,
    progress,
    position,
    context,
    assigned_agent: agentId,
    clearAgent: req.body.clearAgent,
    target_agent: target_agent !== undefined ? (target_agent || null) : undefined,
    clearTarget: target_agent === '' || target_agent === null ? 1 : 0,
  })

  // --- Status-change side effects ---
  const statusChanged = status && status !== prevStatus
  if (statusChanged) {
    const newStatusDef = statusQueries.getById.get(status)

    // Terminal status → complete the task (free agent, send Telegram)
    if (newStatusDef?.is_terminal && updated.assigned_agent) {
      const agent = agentQueries.getById.get(updated.assigned_agent)
      orchestrator.completeTask(updated.id, agent?.id, `تم تحويل المهمة إلى "${newStatusDef.label}" يدوياً`)
    }
    // Trigger-enabled status → notify the assigned agent
    else if (newStatusDef?.trigger_enabled && updated.assigned_agent) {
      const agent = agentQueries.getById.get(updated.assigned_agent)
      if (agent) {
        const message = buildTriggerMessage(newStatusDef.trigger_message, updated, newStatusDef)
        orchestrator.logEvent('STATUS_TRIGGER', {
          agentId: agent.id,
          taskId: updated.id,
          message: `تم تشغيل "${agent.name}" بسبب انتقال المهمة إلى "${newStatusDef.label}"`,
          metadata: { fromStatus: prevStatus, toStatus: status },
        })
        notifyTaskUpdate(agent, { ...updated, description: message })
      }
    }
  }

  // Manual triggerAgent flag (legacy)
  if (!statusChanged && req.body.triggerAgent && updated.assigned_agent) {
    const agent = agentQueries.getById.get(updated.assigned_agent)
    if (agent) {
      orchestrator.logEvent('TASK_UPDATED_TRIGGER', {
        agentId: agent.id,
        taskId: updated.id,
        message: `Task "${updated.title}" updated — triggering ${agent.name}`,
      })
      notifyTaskUpdate(agent, updated)
    }
  }

  res.json(updated)
})

// POST /api/tasks/:id/reset — reset task to todo, clear agent assignment
router.post('/:id/reset', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  const updated = orchestrator.updateTask(req.params.id, {
    status: 'todo', clearAgent: true, progress: 0,
  })
  res.json(updated)
})

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const task = taskQueries.getById.get(req.params.id)
  if (!task) return res.status(404).json({ error: 'Task not found' })

  orchestrator.deleteTask(req.params.id)
  res.json({ ok: true })
})

// POST /api/tasks/:id/assign
router.post('/:id/assign', async (req, res) => {
  const { agentId } = req.body
  if (!agentId) return res.status(400).json({ error: 'agentId is required' })

  try {
    const task = await orchestrator.assignTaskToAgent(req.params.id, agentId)
    res.json(task)
  } catch (err) {
    res.status(400).json({ error: err.message })
  }
})

// GET /api/tasks/:id/events
router.get('/:id/events', (req, res) => {
  const { eventQueries } = require('../db')
  const events = eventQueries.getByTask.all(req.params.id)
  res.json(events)
})

// Fill trigger message template variables
function buildTriggerMessage(template, task, statusDef) {
  const base = template || `انتقلت المهمة "{task_title}" إلى حالة "{status_label}".\n\nيرجى العمل عليها وفق الحالة الجديدة.\nTASK_ID: {task_id}`
  return base
    .replace(/\{task_title\}/g,      task.title || '')
    .replace(/\{task_description\}/g, task.description || '')
    .replace(/\{task_id\}/g,         task.id)
    .replace(/\{status_label\}/g,    statusDef.label)
    .replace(/\{priority\}/g,        task.priority || 'medium')
}

module.exports = router
