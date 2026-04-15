/**
 * POST /api/crm-webhook
 *
 * Receives outbound webhooks from the Perfex CRM MCP Integration module.
 *
 * Supported events:
 *   task_assigned  — CRM task was assigned to the AI agent staff member.
 *                    Creates a board task and assigns it to an available agent.
 *   comment_added  — A new comment was added to a CRM task that has the AI agent.
 *                    Finds the running board task and notifies its agent.
 */

const express      = require('express')
const router       = express.Router()
const { spawn }    = require('child_process')
const http         = require('http')
const { agentQueries, taskQueries, logQueries } = require('../db')
const orchestrator = require('../orchestrator')

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw'

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Find the board task created for a given CRM task ID.
 * We store crm_task_id in the task's context JSON at creation time.
 */
function findBoardTaskByCrmId(crmTaskId) {
  const all = taskQueries.getAll.all()
  return all.find((t) => {
    try {
      const ctx = typeof t.context === 'string' ? JSON.parse(t.context) : (t.context || {})
      return String(ctx.crm_task_id) === String(crmTaskId)
    } catch {
      return false
    }
  }) || null
}

/**
 * Send a heartbeat to the orchestrator from a spawned process.
 */
function sendHeartbeat(orchestratorPort, agentId, taskId, progress, status, message) {
  const body = JSON.stringify({ agentId, taskId, progress, status, message })
  const req = http.request({
    hostname: 'localhost',
    port: orchestratorPort,
    path: '/api/heartbeat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => res.resume())
  req.on('error', () => {})
  req.write(body)
  req.end()
}

/**
 * Spawn openclaw and wire heartbeats back to the orchestrator.
 */
function spawnAgent(agent, boardTaskId, message, orchestratorPort, label) {
  const agentSlug = (agent.name || '').toLowerCase()
  const proc = spawn(OPENCLAW_BIN, ['agent', '--agent', agentSlug, '--message', message, '--json'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let heartbeatInterval = null
  sendHeartbeat(orchestratorPort, agent.id, boardTaskId, 5, 'running', `${agent.name}: ${label}`)
  heartbeatInterval = setInterval(() => {
    sendHeartbeat(orchestratorPort, agent.id, boardTaskId, null, 'running', `${agent.name} يعمل…`)
  }, 25000)

  proc.stderr.on('data', (chunk) => {
    const t = chunk.toString().trim()
    if (t) console.log(`[crm-webhook][${agent.name}] stderr: ${t}`)
  })

  proc.on('close', (code) => {
    clearInterval(heartbeatInterval)
    sendHeartbeat(orchestratorPort, agent.id, boardTaskId,
      code === 0 ? 100 : 0,
      code === 0 ? 'completed' : 'failed',
      code === 0 ? `${label} — اكتمل` : `خرج بكود ${code}`)
  })
  proc.on('error', (err) => {
    clearInterval(heartbeatInterval)
    sendHeartbeat(orchestratorPort, agent.id, boardTaskId, 0, 'failed', `خطأ في التشغيل: ${err.message}`)
  })
}

/**
 * Build the initial prompt for a new CRM task assignment.
 */
function buildAssignedPrompt(crmTask, boardTaskId, orchestratorPort) {
  const statusMap = { 1: 'Not Started', 2: 'In Progress', 3: 'Testing', 4: 'Awaiting Feedback', 5: 'Complete' }
  return [
    `# مهمة جديدة من نظام CRM`,
    ``,
    `تم تعيينك على المهمة التالية. استخدم أدوات MCP للعمل عليها.`,
    ``,
    `## تفاصيل المهمة`,
    `- **الاسم:** ${crmTask.name || crmTask.title || `Task #${crmTask.id}`}`,
    `- **الوصف:** ${crmTask.description || 'لا يوجد وصف'}`,
    `- **الحالة الحالية:** ${statusMap[crmTask.status] || crmTask.status}`,
    `- **CRM Task ID:** ${crmTask.id}`,
    ``,
    `## خطوات العمل`,
    ``,
    `1. **غيّر الحالة إلى In Progress:**`,
    `   استخدم أداة \`update_task_status\` → task_id="${crmTask.id}", status=2`,
    ``,
    `2. **اقرأ التفاصيل الكاملة:**`,
    `   استخدم أداة \`get_task\` → task_id="${crmTask.id}"`,
    ``,
    `3. **اقرأ التعليقات الموجودة (إن وُجدت):**`,
    `   استخدم أداة \`get_comments\` → task_id="${crmTask.id}"`,
    ``,
    `4. **اعمل على المهمة** حسب وصفها.`,
    ``,
    `5. **بعد كل خطوة رئيسية — سجّل الوقت واكتب ملاحظة للعميل:**`,
    `   استخدم أداة \`log_time\` → task_id="${crmTask.id}", hours=X, minutes=Y`,
    `   note = "وصف بسيط يفهمه العميل — لا مصطلحات تقنية"`,
    `   مثال جيد:  "تم مراجعة المتطلبات وتصميم هيكل قاعدة البيانات"`,
    `   مثال سيئ: "refactored TaskController.php, fixed null pointer at line 287"`,
    ``,
    `6. **عند الانتهاء — غيّر الحالة إلى Complete:**`,
    `   استخدم أداة \`update_task_status\` → task_id="${crmTask.id}", status=5`,
    `   ثم سجّل الوقت الإجمالي مع ملخص ما تم.`,
    ``,
    `7. **أبلغ النظام بالانتهاء:**`,
    `   curl -s -X POST http://localhost:${orchestratorPort}/api/tasks/${boardTaskId}/notify \\`,
    `     -H 'Content-Type: application/json' \\`,
    `     -d '{"output":"ملخص ما أنجزته"}'`,
    ``,
    `اختم ردك النهائي بـ: TASK_COMPLETED`,
  ].join('\n')
}

/**
 * Build the prompt sent when a client adds a new comment on a CRM task.
 */
function buildCommentPrompt(crmTask, comment, boardTaskId, orchestratorPort) {
  return [
    `# تعليق جديد من العميل على مهمتك`,
    ``,
    `## المهمة`,
    `- **الاسم:** ${crmTask.name || crmTask.title || `Task #${crmTask.id}`}`,
    `- **CRM Task ID:** ${crmTask.id}`,
    ``,
    `## التعليق الجديد`,
    `**من:** ${comment.staff_full_name || comment.staffid || 'العميل'}`,
    `**التاريخ:** ${comment.dateadded || 'الآن'}`,
    ``,
    `${comment.content || '(بدون محتوى)'}`,
    ``,
    `## المطلوب`,
    ``,
    `1. اقرأ التعليق واستوعبه جيداً.`,
    `2. غيّر الحالة إلى In Progress:`,
    `   \`update_task_status\` → task_id="${crmTask.id}", status=2`,
    `3. نفّذ ما طلبه العميل.`,
    `4. سجّل الوقت مع ملاحظة بلغة العميل:`,
    `   \`log_time\` → task_id="${crmTask.id}", hours=X, minutes=Y, note="ما تم تنفيذه"`,
    `5. أبلغ النظام بالانتهاء:`,
    `   curl -s -X POST http://localhost:${orchestratorPort}/api/tasks/${boardTaskId}/notify \\`,
    `     -H 'Content-Type: application/json' \\`,
    `     -d '{"output":"ما أنجزته بناءً على تعليق العميل"}'`,
    ``,
    `اختم ردك النهائي بـ: TASK_COMPLETED`,
  ].join('\n')
}

// ── route ─────────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { event, task_id, task: crmTask, comment } = req.body
  const orchestratorPort = parseInt(process.env.BACKEND_PORT || '3001', 10)

  if (!event || !task_id || !crmTask) {
    return res.status(400).json({ error: 'event, task_id, and task are required' })
  }

  console.log(`[crm-webhook] event="${event}" crm_task_id=${task_id}`)

  // ── task_assigned ─────────────────────────────────────────────────────────
  if (event === 'task_assigned') {
    let boardTask = findBoardTaskByCrmId(task_id)

    if (!boardTask) {
      const title = crmTask.name || crmTask.title || `CRM Task #${task_id}`
      const description = [
        crmTask.description || '',
        `\n---\nCRM Task ID: ${task_id}`,
      ].join('\n').trim()

      boardTask = orchestrator.createTask({
        title,
        description,
        priority: crmTask.priority == 1 ? 'low' : crmTask.priority == 3 ? 'high' : 'medium',
        context: { crm_task_id: task_id, source: 'crm_webhook' },
      })
      console.log(`[crm-webhook] board task created: ${boardTask.id}`)
    }

    const idleAgents = agentQueries.getAll.all().filter((a) => a.status === 'idle')
    if (idleAgents.length === 0) {
      console.warn('[crm-webhook] no idle agents — task queued')
      return res.json({ ok: true, status: 'queued', board_task_id: boardTask.id })
    }

    const agent = idleAgents[0]
    await orchestrator.assignTaskToAgent(boardTask.id, agent.id)

    const prompt = buildAssignedPrompt(crmTask, boardTask.id, orchestratorPort)
    spawnAgent(agent, boardTask.id, prompt, orchestratorPort, `بدأ العمل على CRM task #${task_id}`)

    return res.json({ ok: true, status: 'assigned', board_task_id: boardTask.id, agent: agent.name })
  }

  // ── comment_added ─────────────────────────────────────────────────────────
  if (event === 'comment_added') {
    if (!comment) {
      return res.status(400).json({ error: 'comment required for comment_added' })
    }

    const boardTask = findBoardTaskByCrmId(task_id)
    if (!boardTask) {
      console.warn(`[crm-webhook] no board task for CRM task ${task_id}`)
      return res.json({ ok: true, status: 'ignored', message: 'No board task for this CRM task' })
    }

    const agentId = boardTask.assigned_agent
    const agent   = agentId ? agentQueries.getById.get(agentId) : null
    if (!agent) {
      return res.json({ ok: true, status: 'ignored', message: 'No agent assigned' })
    }

    // Log the comment on the board task timeline
    const lastStep = logQueries.getLastStep.get(boardTask.id)?.last_step ?? 0
    logQueries.insert.run({
      task_id:   boardTask.id,
      agent_id:  agent.id,
      step:      lastStep + 1,
      message:   `[CRM Comment] ${comment.staff_full_name || 'Client'}: ${(comment.content || '').slice(0, 300)}`,
      timestamp: Date.now(),
    })
    req.app.locals.broadcast?.({
      event: 'task:log',
      data: { taskId: boardTask.id, entry: {
        step: lastStep + 1,
        message: `[CRM Comment] ${(comment.content || '').slice(0, 100)}`,
        timestamp: Date.now(),
      }},
    })

    // Move board task back to in_progress
    orchestrator.updateTask(boardTask.id, { status: 'in_progress' })

    const prompt = buildCommentPrompt(crmTask, comment, boardTask.id, orchestratorPort)
    spawnAgent(agent, boardTask.id, prompt, orchestratorPort, `استقبل تعليق جديد على CRM task #${task_id}`)

    return res.json({ ok: true, status: 'notified', board_task_id: boardTask.id, agent: agent.name })
  }

  return res.status(400).json({ error: `Unknown event: ${event}` })
})

module.exports = router
