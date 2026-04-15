/**
 * orchestrator.js
 * Core task queue management and agent lifecycle.
 * Coordinates between the DB, agent communications, and WebSocket broadcast.
 */

const { v4: uuidv4 } = require('uuid')
const { taskQueries, agentQueries, eventQueries, logQueries, statusQueries, settingsQueries } = require('./db')
const { assignTask, resumeAgent, pushAgentToContinue } = require('./agentComms')
const telegram = require('./telegram')
// lazy-loaded to avoid circular dependency with heartbeatMonitor
let heartbeatMonitor = null
function getHeartbeatMonitor() {
  if (!heartbeatMonitor) heartbeatMonitor = require('./heartbeatMonitor')
  return heartbeatMonitor
}

let broadcast = () => {} // injected from server.js

function setBroadcast(fn) {
  broadcast = fn
}

// --- Event logging ---

function logEvent(type, { agentId = null, taskId = null, message = '', metadata = {} } = {}) {
  eventQueries.insert.run({
    type,
    agent_id: agentId,
    task_id: taskId,
    message,
    metadata: JSON.stringify(metadata),
    timestamp: Date.now(),
  })
  console.log(`[orchestrator] [${type}] ${message}`)
}

// --- Task lifecycle ---

function createTask({ title, description = '', priority = 'medium', context = {}, target_agent = null }) {
  const now = Date.now()
  const maxPos = taskQueries.getMaxPosition.get('todo')
  const position = (maxPos?.max_pos ?? 0) + 1000

  const task = {
    id: uuidv4(),
    title,
    description,
    status: 'todo',
    priority,
    assigned_agent: null,
    target_agent: target_agent || null,
    created_at: now,
    updated_at: now,
    progress: 0,
    position,
    context: JSON.stringify(context),
  }
  taskQueries.insert.run(task)
  broadcast({ event: 'task:created', data: getTask(task.id) })
  return task
}

function normalizeTask(row) {
  if (!row) return row
  if (typeof row.context === 'string') {
    try { row.context = JSON.parse(row.context) } catch { row.context = {} }
  }
  return row
}

function getTask(id) {
  return normalizeTask(taskQueries.getById.get(id))
}

function updateTask(id, fields) {
  const now = Date.now()
  taskQueries.update.run({
    id,
    title: fields.title ?? null,
    description: fields.description ?? null,
    status: fields.status ?? null,
    priority: fields.priority ?? null,
    assigned_agent: fields.assigned_agent ?? null,
    clearAgent: fields.clearAgent ? 1 : 0,
    target_agent: fields.target_agent ?? null,
    clearTarget: fields.clearTarget ? 1 : 0,
    progress: fields.progress ?? null,
    position: fields.position ?? null,
    context: fields.context ? JSON.stringify(fields.context) : null,
    updated_at: now,
  })
  const updated = getTask(id)
  broadcast({ event: 'task:updated', data: updated })
  return updated
}

function deleteTask(id) {
  taskQueries.delete.run(id)
  broadcast({ event: 'task:deleted', data: { id } })
}

// --- Agent assignment ---

async function assignTaskToAgent(taskId, agentId) {
  const task = getTask(taskId)
  const agent = agentQueries.getById.get(agentId)

  if (!task) throw new Error(`Task ${taskId} not found`)
  if (!agent) throw new Error(`Agent ${agentId} not found`)

  // Enforce target_agent restriction
  if (task.target_agent && task.target_agent !== agentId) {
    const targetAgent = agentQueries.getById.get(task.target_agent)
    throw new Error(
      `هذه المهمة مخصصة للوكيل "${targetAgent?.name || task.target_agent}" فقط ولا يمكن تعيينها لـ "${agent.name}"`
    )
  }

  // Update task status
  updateTask(taskId, { status: 'in_progress', assigned_agent: agentId, progress: 0 })

  // Update agent status
  agentQueries.update.run({
    id: agentId,
    status: 'busy',
    current_task_id: taskId,
    clearTask: 0,
    last_heartbeat: Date.now(),
    name: null,
    host: null,
    port: null,
    max_idle_seconds: null,
  })

  logEvent('TASK_ASSIGNED', {
    agentId,
    taskId,
    message: `Task "${task.title}" assigned to agent "${agent.name}"`,
    metadata: { taskTitle: task.title, agentName: agent.name },
  })

  broadcast({ event: 'agent:updated', data: agentQueries.getById.get(agentId) })

  // Fire-and-forget: send assign signal to agent
  assignTask(agent, getTask(taskId)).then((result) => {
    if (!result.ok) {
      console.warn(`[orchestrator] Agent ${agent.name} unreachable for assignment: ${result.error}`)
    }
  })

  return getTask(taskId)
}

// --- Task completion ---

function completeTask(taskId, agentId, output) {
  const task = getTask(taskId)
  if (!task) return

  const completedAt = Date.now()
  updateTask(taskId, { status: 'done', progress: 100 })

  const agent = agentId ? agentQueries.getById.get(agentId) : null

  // Free the agent
  if (agentId) {
    agentQueries.update.run({
      id: agentId,
      status: 'idle',
      clearTask: 1,
      current_task_id: null,
      last_heartbeat: completedAt,
      name: null,
      host: null,
      port: null,
      max_idle_seconds: null,
    })

    logEvent('TASK_COMPLETED', {
      agentId,
      taskId,
      message: `Task "${task.title}" completed by agent "${agent?.name || agentId}"`,
      metadata: { output: output?.slice(0, 500) },
    })

    broadcast({ event: 'agent:updated', data: agentQueries.getById.get(agentId) })

    // Send Telegram notification
    const logSteps = logQueries.getByTask.all(taskId).map((l) => l.message)
    const durationMs = task.last_heartbeat ? completedAt - task.created_at : null
    telegram.notifyTaskComplete({ task, agent, logSteps, output, durationMs })
      .then(() => console.log(`[orchestrator] Telegram notification sent for task "${task.title}"`))
      .catch((err) => console.warn(`[orchestrator] Telegram notification failed: ${err.message}`))

    // Pick up pending tasks for all idle agents
    processTaskQueue()
  }
}

// --- Continuous queue processing ---

/**
 * processTaskQueue — scans every idle agent and assigns it the next
 * pending task from the queue (priority-ordered).
 * Called: on startup, after task completion, after task creation,
 * and when any agent transitions to 'idle'.
 */
/**
 * resetOrphanedTasks — finds tasks that are stuck in a non-terminal status
 * with no active agent (agent offline or missing) and resets them to 'todo'
 * so they can be picked up by the queue processor.
 * Returns the number of tasks reset.
 */
function resetOrphanedTasks() {
  const orphaned = taskQueries.getOrphaned.all()
  let count = 0

  for (const task of orphaned) {
    console.log(`[orchestrator] Orphan reset: "${task.title}" (was ${task.status}, agent: ${task.agent_name || 'none'})`)
    taskQueries.update.run({
      id: task.id,
      title: null, description: null, status: 'todo', priority: null,
      assigned_agent: null, clearAgent: 1,
      target_agent: null, clearTarget: 0, // keep target_agent as-is
      progress: null, position: null,
      context: null, updated_at: Date.now(),
    })
    logEvent('TASK_ORPHAN_RESET', {
      taskId: task.id,
      message: `Task "${task.title}" reset to todo (was ${task.status}, agent ${task.agent_name || 'none'} is offline)`,
      metadata: { previousStatus: task.status, previousAgent: task.agent_name },
    })
    const updated = getTask(task.id)
    broadcast({ event: 'task:updated', data: updated })
    count++
  }
  return count
}

/**
 * processTaskQueue — scans every idle agent and assigns it the next
 * pending task from the queue (priority-ordered).
 * First resets any orphaned tasks back to 'todo'.
 * Called: on startup, after task completion, after task creation,
 * and when any agent transitions to 'idle'.
 */
async function processTaskQueue() {
  // Step 1: reset orphaned tasks (in_progress/blocked with offline agent) back to todo
  const resetCount = resetOrphanedTasks()
  if (resetCount > 0) {
    console.log(`[orchestrator] Queue: reset ${resetCount} orphaned task(s) → todo`)
  }

  // Step 2: assign pending tasks to idle agents
  const idleAgents = agentQueries.getAll.all().filter((a) => a.status === 'idle')
  if (idleAgents.length === 0) return { reset: resetCount, assigned: 0 }

  let assigned = 0
  for (const agent of idleAgents) {
    // Only pick tasks designated for this agent (or undesignated)
    const nextTask = taskQueries.getNextQueuedForAgent.get(agent.id)
    if (!nextTask) continue // no eligible task for this agent — try next agent

    console.log(`[orchestrator] Queue: assigning "${nextTask.title}" → "${agent.name}"`)
    try {
      await assignTaskToAgent(nextTask.id, agent.id)
      assigned++
    } catch (err) {
      console.error(`[orchestrator] Queue assignment failed for "${agent.name}": ${err.message}`)
    }
  }
  return { reset: resetCount, assigned }
}

// --- Heartbeat handling ---

function handleHeartbeat({ agentId, taskId, progress = 0, status = 'running', message = '' }) {
  const now = Date.now()

  // Update agent heartbeat
  const agent = agentQueries.getById.get(agentId)
  if (agent) {
    agentQueries.update.run({
      id: agentId,
      last_heartbeat: now,
      status: 'busy',
      current_task_id: taskId || agent.current_task_id,
      clearTask: 0,
      name: null,
      host: null,
      port: null,
      max_idle_seconds: null,
    })
    broadcast({ event: 'agent:heartbeat', data: agentQueries.getById.get(agentId) })

    // Agent is alive — reset its retry counter so the monitor starts fresh
    getHeartbeatMonitor().resetAgentRetry(agentId)
  }

  // Update task heartbeat + progress
  if (taskId) {
    taskQueries.updateHeartbeat.run({ id: taskId, last_heartbeat: now, progress, updated_at: now })
    const updatedTask = getTask(taskId)
    broadcast({ event: 'task:updated', data: updatedTask })

    if (status === 'completed') {
      // Check if the task must be in a terminal status before we allow completion
      const requireTerminal = settingsQueries.get.get('task_require_terminal_completion')?.value ?? '1'

      if (requireTerminal !== '0' && taskId) {
        const currentTask = getTask(taskId)
        if (currentTask) {
          const statusDef = statusQueries.getById.get(currentTask.status)
          if (!statusDef?.is_terminal) {
            // Not done yet — push the agent to continue until it moves the ticket
            if (agent) {
              const terminalStatuses = statusQueries.getAll.all().filter((s) => s.is_terminal)
              pushAgentToContinue(agent, currentTask, terminalStatuses)
            }
            logEvent('TASK_PREMATURE_COMPLETE', {
              agentId,
              taskId,
              message: `Agent "${agent?.name ?? agentId}" tried to complete "${currentTask.title}" but status is "${currentTask.status}" (not terminal)`,
              metadata: { status: currentTask.status },
            })
            return // block completion
          }
        }
      }

      completeTask(taskId, agentId)
      return
    }
  }

  logEvent('HEARTBEAT', {
    agentId,
    taskId,
    message: message || `Heartbeat from ${agentId}: ${progress}%`,
    metadata: { progress, status },
  })
}

module.exports = {
  setBroadcast,
  createTask,
  getTask,
  updateTask,
  deleteTask,
  assignTaskToAgent,
  completeTask,
  handleHeartbeat,
  logEvent,
  processTaskQueue,
  resetOrphanedTasks,
  normalizeTask,
}
