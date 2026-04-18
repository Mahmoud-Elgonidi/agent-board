/**
 * POST /api/crm-telegram
 *
 * Receives a CRM MCP-Integration webhook payload and forwards it as a
 * formatted Telegram message using the configured doc-bot + chat_id.
 *
 * Set the agent's webhook URL to:
 *   http://localhost:3001/api/crm-telegram
 */

const express  = require('express')
const router   = express.Router()
const telegram = require('../telegram')

const STATUS_LABELS = { 1: 'Not Started', 2: 'In Progress', 3: 'Testing', 4: 'Awaiting Feedback', 5: 'Complete' }
const PRIORITY_LABELS = { 1: '🟢 Low', 2: '🔵 Medium', 3: '🔴 High' }

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

router.post('/', async (req, res) => {
  const { event, task_id, task, comment, agent } = req.body

  if (!event || !task_id) {
    return res.status(400).json({ error: 'event and task_id are required' })
  }

  let msg = ''

  if (event === 'task_assigned') {
    const taskName = esc(task?.name || task?.title || `Task #${task_id}`)
    const agentName = esc(agent?.name || 'MCP Agent')
    const status   = STATUS_LABELS[task?.status] || task?.status || '?'
    const priority = PRIORITY_LABELS[task?.priority] || `Priority ${task?.priority}`
    const project  = task?.rel_type === 'project' ? `Project #${task?.rel_id}` : '—'
    const desc     = task?.description ? `\n📝 ${esc(task.description.slice(0, 200))}` : ''

    msg = [
      `📌 <b>مهمة جديدة — ${agentName}</b>`,
      ``,
      `📋 <b>${taskName}</b> (#${task_id})`,
      `📁 ${esc(project)}`,
      `${priority}  |  ${esc(status)}`,
      desc,
    ].filter(l => l !== undefined).join('\n')

  } else if (event === 'comment_added') {
    const taskName   = esc(task?.name || task?.title || `Task #${task_id}`)
    const agentName  = esc(agent?.name || 'MCP Agent')
    const author     = esc(comment?.staff_full_name || 'Client')
    const content    = esc((comment?.content || '').slice(0, 500))

    msg = [
      `💬 <b>تعليق جديد — ${agentName}</b>`,
      ``,
      `📋 <b>${taskName}</b> (#${task_id})`,
      `👤 من: ${author}`,
      ``,
      content,
    ].join('\n')

  } else {
    msg = `ℹ️ <b>CRM Event: ${esc(event)}</b>\nTask #${task_id}`
  }

  try {
    const result = await telegram.sendMessage(msg, { account: 'doc' })
    console.log(`[crm-telegram] sent "${event}" for task #${task_id}, message_id=${result.result?.message_id}`)
    return res.json({ ok: true, message_id: result.result?.message_id })
  } catch (err) {
    console.error(`[crm-telegram] failed:`, err.message)
    return res.status(500).json({ ok: false, error: err.message })
  }
})

module.exports = router
