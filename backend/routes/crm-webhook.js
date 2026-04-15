/**
 * POST /api/crm-webhook
 *
 * Receives outbound webhooks from the Perfex CRM MCP Integration module.
 *
 * Supported events:
 *   task_assigned  — CRM task assigned to AI agent. Creates board task,
 *                    assigns idle agent, spawns openclaw, sends Telegram "started".
 *   comment_added  — New comment on agent task. Re-triggers agent with comment context.
 */

const express      = require('express')
const router       = express.Router()
const { spawn }    = require('child_process')
const http         = require('http')
const { agentQueries, taskQueries, logQueries } = require('../db')
const orchestrator = require('../orchestrator')
const telegram     = require('../telegram')

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw'

// ── helpers ───────────────────────────────────────────────────────────────────

function findBoardTaskByCrmId(crmTaskId) {
  return taskQueries.getAll.all().find((t) => {
    try {
      const ctx = typeof t.context === 'string' ? JSON.parse(t.context) : (t.context || {})
      return String(ctx.crm_task_id) === String(crmTaskId)
    } catch { return false }
  }) || null
}

function sendHeartbeat(port, agentId, taskId, progress, status, message) {
  const body = JSON.stringify({ agentId, taskId, progress, status, message })
  const req  = http.request({
    hostname: 'localhost', port, path: '/api/heartbeat', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  }, (r) => r.resume())
  req.on('error', () => {})
  req.write(body)
  req.end()
}

/**
 * Spawn openclaw, wire heartbeats, send Telegram on start + completion.
 */
function spawnAgent(agent, boardTask, message, port) {
  const agentSlug = (agent.name || '').toLowerCase()
  const taskTitle = boardTask.title || `Board Task ${boardTask.id}`

  // Telegram: started
  telegram.sendMessage(
    `🚀 <b>${agent.name}</b> بدأ العمل على:\n<b>${taskTitle}</b>`,
    { account: agentSlug }
  ).catch(() => {})

  const proc = spawn(OPENCLAW_BIN, ['agent', '--agent', agentSlug, '--message', message, '--json'], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let output = ''
  sendHeartbeat(port, agent.id, boardTask.id, 5, 'running', `${agent.name}: بدأ العمل`)
  const hbInterval = setInterval(() => {
    sendHeartbeat(port, agent.id, boardTask.id, null, 'running', `${agent.name} يعمل…`)
  }, 25000)

  proc.stdout.on('data', (chunk) => { output += chunk.toString() })
  proc.stderr.on('data', (chunk) => {
    const t = chunk.toString().trim()
    if (t) console.log(`[crm-webhook][${agent.name}] ${t}`)
  })

  proc.on('close', (code) => {
    clearInterval(hbInterval)
    if (code === 0) {
      // Extract final response text
      let summary = 'تم إنهاء المهمة بنجاح'
      try {
        const lines  = output.trim().split('\n').filter(Boolean)
        const parsed = JSON.parse(lines[lines.length - 1])
        if (parsed.text || parsed.response || parsed.content) {
          summary = (parsed.text || parsed.response || parsed.content).slice(0, 300)
        }
      } catch { /* plain text output */ }

      sendHeartbeat(port, agent.id, boardTask.id, 100, 'completed', summary)

      // Telegram: completed
      telegram.sendMessage(
        `✅ <b>${agent.name}</b> أنهى المهمة:\n<b>${taskTitle}</b>\n\n${summary}`,
        { account: agentSlug }
      ).catch(() => {})

    } else {
      sendHeartbeat(port, agent.id, boardTask.id, 0, 'failed', `خرج بكود ${code}`)

      // Telegram: failed
      telegram.sendMessage(
        `❌ <b>${agent.name}</b> فشل في المهمة:\n<b>${taskTitle}</b>\nكود الخطأ: ${code}`,
        { account: agentSlug }
      ).catch(() => {})
    }
  })

  proc.on('error', (err) => {
    clearInterval(hbInterval)
    sendHeartbeat(port, agent.id, boardTask.id, 0, 'failed', err.message)
    telegram.sendMessage(
      `❌ <b>${agent.name}</b> فشل في تشغيل المهمة:\n<b>${taskTitle}</b>\n${err.message}`,
      { account: agentSlug }
    ).catch(() => {})
  })
}

/**
 * Build the full prompt for a new CRM task assignment.
 * The agent must: read task → set In Progress → work → log_time (client language)
 * → set Complete → notify board → done.
 */
function buildAssignedPrompt(crmTask, boardTask, port) {
  const statusMap = { 1: 'Not Started', 2: 'In Progress', 3: 'Testing', 4: 'Awaiting Feedback', 5: 'Complete' }
  const relInfo   = crmTask.rel_type === 'project' && crmTask.rel_id
    ? `مشروع ID: ${crmTask.rel_id}`
    : 'غير مرتبط بمشروع'

  return [
    `# مهمة جديدة من CRM — ابدأ الآن`,
    ``,
    `تم تعيينك على مهمة في نظام CRM. اقرأ كل التفاصيل وابدأ فوراً بدون انتظار.`,
    ``,
    `## تفاصيل المهمة`,
    `- **العنوان:** ${crmTask.name || crmTask.title || `Task #${crmTask.id}`}`,
    `- **الوصف:** ${crmTask.description || 'لا يوجد وصف — استنتج من العنوان'}`,
    `- **الحالة الحالية:** ${statusMap[crmTask.status] || crmTask.status}`,
    `- **الأولوية:** ${crmTask.priority == 1 ? 'منخفضة' : crmTask.priority == 3 ? 'عالية' : 'متوسطة'}`,
    `- **المشروع:** ${relInfo}`,
    `- **CRM Task ID:** ${crmTask.id}`,
    ``,
    `## الخطوات المطلوبة بالترتيب`,
    ``,
    `### الخطوة 1 — سجّل البداية (فوراً)`,
    `\`\`\``,
    `update_task_status → task_id="${crmTask.id}", status=2`,
    `\`\`\``,
    ``,
    `### الخطوة 2 — اقرأ التفاصيل الكاملة`,
    `\`\`\``,
    `get_task → task_id="${crmTask.id}"`,
    `get_comments → task_id="${crmTask.id}"`,
    `\`\`\``,
    `إذا وُجدت تعليقات من العميل — اقرأها وخذها بعين الاعتبار.`,
    ``,
    `### الخطوة 3 — اعمل على المهمة`,
    `افهم العنوان والوصف جيداً. نفّذ ما هو مطلوب بالكامل.`,
    ``,
    `### الخطوة 4 — سجّل الوقت بعد كل خطوة رئيسية`,
    `\`\`\``,
    `log_time → task_id="${crmTask.id}", hours=X, minutes=Y, note="وصف بلغة العميل"`,
    `\`\`\``,
    ``,
    `**قواعد الـ note:**`,
    `✅ جيد:  "تم مراجعة المتطلبات وإعداد هيكل قاعدة البيانات"`,
    `✅ جيد:  "تم تصميم شاشة تسجيل الدخول وربطها بالـ API"`,
    `❌ سيئ: "fixed null pointer at TaskController.php:287, refactored DB query"`,
    `❌ سيئ: "ran git diff, updated index.js"`,
    ``,
    `اكتب دائماً من منظور العميل — ماذا أنجزنا له، وليس كيف أنجزناه تقنياً.`,
    ``,
    `### الخطوة 5 — أغلق المهمة`,
    `\`\`\``,
    `update_task_status → task_id="${crmTask.id}", status=5`,
    `log_time → task_id="${crmTask.id}", hours=X, minutes=Y, note="ملخص كل ما تم إنجازه"`,
    `\`\`\``,
    ``,
    `### الخطوة 6 — أبلغ النظام بالانتهاء (مهم جداً)`,
    `\`\`\`bash`,
    `curl -s -X POST http://localhost:${port}/api/tasks/${boardTask.id}/notify \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"output":"ملخص ما أنجزته للعميل"}'`,
    `\`\`\``,
    ``,
    `اختم ردك النهائي بـ: TASK_COMPLETED`,
  ].join('\n')
}

/**
 * Build prompt for a new client comment on an agent task.
 */
function buildCommentPrompt(crmTask, comment, boardTask, port) {
  return [
    `# تعليق جديد من العميل — استأنف العمل`,
    ``,
    `## المهمة`,
    `- **العنوان:** ${crmTask.name || crmTask.title || `Task #${crmTask.id}`}`,
    `- **CRM Task ID:** ${crmTask.id}`,
    ``,
    `## التعليق الجديد`,
    `**من:** ${comment.staff_full_name || 'العميل'}`,
    `**التاريخ:** ${comment.dateadded || 'الآن'}`,
    ``,
    `---`,
    `${comment.content || ''}`,
    `---`,
    ``,
    `## المطلوب`,
    `1. اقرأ التعليق جيداً.`,
    `2. غيّر الحالة إلى In Progress:`,
    `   \`update_task_status\` → task_id="${crmTask.id}", status=2`,
    `3. نفّذ طلب العميل.`,
    `4. سجّل الوقت بلغة العميل:`,
    `   \`log_time\` → task_id="${crmTask.id}", hours=X, minutes=Y, note="ما تم تنفيذه"`,
    `5. إذا اكتمل الطلب — أغلق المهمة:`,
    `   \`update_task_status\` → task_id="${crmTask.id}", status=5`,
    `6. أبلغ النظام:`,
    `\`\`\`bash`,
    `curl -s -X POST http://localhost:${port}/api/tasks/${boardTask.id}/notify \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '{"output":"ما أنجزته بناءً على تعليق العميل"}'`,
    `\`\`\``,
    ``,
    `اختم ردك النهائي بـ: TASK_COMPLETED`,
  ].join('\n')
}

// ── route ─────────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const { event, task_id, task: crmTask, comment } = req.body
  const port = parseInt(process.env.BACKEND_PORT || '3001', 10)

  if (!event || !task_id || !crmTask) {
    return res.status(400).json({ error: 'event, task_id, and task are required' })
  }

  console.log(`[crm-webhook] event="${event}" crm_task_id=${task_id}`)

  // ── task_assigned ─────────────────────────────────────────────────────────
  if (event === 'task_assigned') {
    // Find or create board task
    let boardTask = findBoardTaskByCrmId(task_id)
    if (!boardTask) {
      const title = crmTask.name || crmTask.title || `CRM Task #${task_id}`
      boardTask   = orchestrator.createTask({
        title,
        description: (crmTask.description || '') + `\n\nCRM Task ID: ${task_id}`,
        priority: crmTask.priority == 1 ? 'low' : crmTask.priority == 3 ? 'high' : 'medium',
        context: { crm_task_id: task_id, source: 'crm_webhook' },
      })
      console.log(`[crm-webhook] board task created: ${boardTask.id}`)
    }

    // Find idle agent
    const idleAgents = agentQueries.getAll.all().filter((a) => a.status === 'idle')
    if (idleAgents.length === 0) {
      console.warn('[crm-webhook] no idle agents — task queued')
      return res.json({ ok: true, status: 'queued', board_task_id: boardTask.id })
    }

    const agent = idleAgents[0]
    await orchestrator.assignTaskToAgent(boardTask.id, agent.id)

    const prompt = buildAssignedPrompt(crmTask, boardTask, port)
    spawnAgent(agent, boardTask, prompt, port)

    return res.json({ ok: true, status: 'assigned', board_task_id: boardTask.id, agent: agent.name })
  }

  // ── comment_added ─────────────────────────────────────────────────────────
  if (event === 'comment_added') {
    if (!comment) return res.status(400).json({ error: 'comment required' })

    const boardTask = findBoardTaskByCrmId(task_id)
    if (!boardTask) {
      return res.json({ ok: true, status: 'ignored', message: 'No board task for this CRM task' })
    }

    const agent = boardTask.assigned_agent ? agentQueries.getById.get(boardTask.assigned_agent) : null
    if (!agent) {
      return res.json({ ok: true, status: 'ignored', message: 'No agent assigned' })
    }

    // Log comment in board timeline
    const lastStep = logQueries.getLastStep.get(boardTask.id)?.last_step ?? 0
    logQueries.insert.run({
      task_id:   boardTask.id,
      agent_id:  agent.id,
      step:      lastStep + 1,
      message:   `[CRM Comment] ${comment.staff_full_name || 'Client'}: ${(comment.content || '').slice(0, 300)}`,
      timestamp: Date.now(),
    })
    req.app.locals.broadcast?.({ event: 'task:log', data: {
      taskId: boardTask.id,
      entry: { step: lastStep + 1, message: `[CRM Comment] ${(comment.content || '').slice(0, 100)}`, timestamp: Date.now() },
    }})

    orchestrator.updateTask(boardTask.id, { status: 'in_progress' })

    const prompt = buildCommentPrompt(crmTask, comment, boardTask, port)
    spawnAgent(agent, boardTask, prompt, port)

    return res.json({ ok: true, status: 'notified', board_task_id: boardTask.id, agent: agent.name })
  }

  return res.status(400).json({ error: `Unknown event: ${event}` })
})

module.exports = router
