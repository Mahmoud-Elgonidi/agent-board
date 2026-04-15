/**
 * telegram.js
 * Direct Telegram Bot API sender — no LLM, instant delivery.
 */

const https = require('https')

// Map account name → bot token.
// Priority: per-agent DB override → global DB setting → env var
function getToken(account, agentId) {
  const { settingsQueries } = require('./db')

  // 1. Per-agent override stored as agent_{id}_telegram_token
  if (agentId) {
    const override = settingsQueries.get.get(`agent_${agentId}_telegram_token`)?.value
    if (override) return override
  }

  // 2. Global DB setting (telegram_token_{name}) — saved via settings panel
  const name     = (account || 'doc').toLowerCase()
  const dbToken  = settingsQueries.get.get(`telegram_token_${name}`)?.value
  if (dbToken) return dbToken

  // 3. Environment variable fallback
  const envKey = `TELEGRAM_BOT_TOKEN_${(account || 'doc').toUpperCase()}`
  return process.env[envKey] || process.env.TELEGRAM_BOT_TOKEN_DOC
}

function getChatId(chatId, agentId) {
  if (chatId) return chatId
  const { settingsQueries } = require('./db')

  // Per-agent chat ID override
  if (agentId) {
    const override = settingsQueries.get.get(`agent_${agentId}_telegram_chat_id`)?.value
    if (override) return override
  }

  return settingsQueries.get.get('telegram_chat_id')?.value || process.env.TELEGRAM_CHAT_ID
}

/**
 * Send a plain or HTML-formatted message to a Telegram chat.
 * @param {string} text       - Message text (HTML supported)
 * @param {object} opts
 * @param {string} opts.chatId    - Telegram chat ID (default: TELEGRAM_CHAT_ID env)
 * @param {string} opts.account   - Bot account to use: doc|adam|khaled|yusuf (default: TELEGRAM_BOT_ACCOUNT)
 * @param {string} opts.parseMode - 'HTML' | 'Markdown' | '' (default: 'HTML')
 */
function sendMessage(text, { chatId, account, agentId, parseMode = 'HTML' } = {}) {
  const token        = getToken(account || process.env.TELEGRAM_BOT_ACCOUNT || 'doc', agentId)
  const targetChatId = getChatId(chatId, agentId)

  if (!token) return Promise.reject(new Error('No Telegram bot token configured'))
  if (!targetChatId) return Promise.reject(new Error('No Telegram chat ID configured'))

  const body = JSON.stringify({
    chat_id: targetChatId,
    text,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  })

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${token}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          const parsed = JSON.parse(data)
          if (parsed.ok) {
            resolve(parsed)
          } else {
            reject(new Error(`Telegram API error: ${parsed.description}`))
          }
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Telegram request timed out')) })
    req.write(body)
    req.end()
  })
}

/**
 * Send task completion notification.
 * @param {object} task         - Task row from DB
 * @param {object} agent        - Agent row from DB
 * @param {string[]} logSteps   - Array of log messages (step summaries)
 * @param {string} [output]     - Optional agent output to attach
 * @param {number} [durationMs] - Time taken in ms
 */
async function notifyTaskComplete({ task, agent, logSteps = [], output, durationMs } = {}) {
  const duration = durationMs ? formatDuration(durationMs) : null
  const priorityEmoji = { urgent: '🔴', high: '🟠', medium: '🔵', low: '⚪' }[task.priority] || '🔵'

  let msg = `✅ <b>مهمة اكتملت</b>\n\n`
  msg += `📋 <b>${escapeHtml(task.title)}</b>\n`
  msg += `🤖 الوكيل: ${escapeHtml(agent?.name || 'غير معروف')}\n`
  msg += `${priorityEmoji} الأولوية: ${task.priority}\n`
  if (duration) msg += `⏱ الوقت: ${duration}\n`

  if (logSteps.length > 0) {
    msg += `\n📝 <b>الخطوات المنجزة:</b>\n`
    logSteps.forEach((step, i) => {
      msg += `  ${i + 1}. ${escapeHtml(step)}\n`
    })
  }

  if (output?.trim()) {
    const trimmed = output.trim().slice(0, 800)
    msg += `\n💬 <b>النتيجة:</b>\n<code>${escapeHtml(trimmed)}</code>`
    if (output.trim().length > 800) msg += `\n<i>... (مقتطع)</i>`
  }

  return sendMessage(msg, { account: agent?.name?.toLowerCase() })
}

/**
 * Send task stuck notification.
 */
async function notifyTaskStuck({ task, agent } = {}) {
  let msg = `⚠️ <b>وكيل متوقف</b>\n\n`
  msg += `📋 ${escapeHtml(task?.title || 'مهمة غير معروفة')}\n`
  msg += `🤖 الوكيل: ${escapeHtml(agent?.name || 'غير معروف')}\n`
  msg += `\nيتم محاولة الاستئناف تلقائياً…`

  return sendMessage(msg, { account: agent?.name?.toLowerCase() })
}

/**
 * Notify when an agent is first detected as stuck.
 * @param {object} opts
 * @param {object} opts.agent         - Agent row
 * @param {object} opts.task          - Current task row (may be null)
 * @param {number} opts.attempt       - Which attempt this is (1-based)
 * @param {number} opts.maxRetries    - Total allowed retries
 * @param {string} opts.idleFormatted - Human-readable idle duration
 * @param {string} opts.method        - 'soft-resume' | 'hard-restart'
 */
async function notifyAgentStuck({ agent, task, attempt, maxRetries, idleFormatted, method } = {}) {
  const isFirst    = attempt === 1
  const methodAr   = method === 'hard-restart' ? 'إعادة تشغيل كاملة' : 'استئناف ناعم'
  const emoji      = isFirst ? '⚠️' : '🔄'
  const title      = isFirst
    ? `<b>الوكيل توقف — جاري الاستئناف التلقائي</b>`
    : `<b>الوكيل لا يزال متوقفاً — المحاولة ${attempt}</b>`

  let msg = `${emoji} ${title}\n\n`
  msg += `🤖 الوكيل: <b>${escapeHtml(agent?.name || 'غير معروف')}</b>\n`
  msg += `⏱ مدة التوقف: ${escapeHtml(idleFormatted)}\n`

  if (task?.title) {
    msg += `📋 المهمة: ${escapeHtml(task.title)}\n`
    if (task.progress > 0) msg += `📊 التقدم عند التوقف: ${task.progress}%\n`
  }

  msg += `\n🔧 الإجراء التلقائي: ${methodAr} (${attempt}/${maxRetries})\n`
  msg += `<i>سيصلك تحديث بنتيجة المحاولة</i>`

  return sendMessage(msg, { account: agent?.name?.toLowerCase() })
}

/**
 * Notify when an automatic recovery attempt succeeds.
 */
async function notifyAgentRecovered({ agent, task, attempt, method } = {}) {
  const methodAr = method === 'cli-restart' ? 'إعادة تشغيل كاملة' : 'استئناف ناعم'

  let msg = `✅ <b>الوكيل استُؤنف بنجاح</b>\n\n`
  msg += `🤖 الوكيل: <b>${escapeHtml(agent?.name || 'غير معروف')}</b>\n`
  if (task?.title) msg += `📋 المهمة: ${escapeHtml(task.title)}\n`
  msg += `🔧 الطريقة: ${methodAr} (المحاولة ${attempt})\n`
  msg += `\n<i>الوكيل يتابع العمل الآن</i>`

  return sendMessage(msg, { account: agent?.name?.toLowerCase() })
}

/**
 * Notify when the agent process crashes unexpectedly (detected by agentMonitor).
 */
async function notifyAgentCrashed({ agent, task } = {}) {
  let msg = `💥 <b>الوكيل توقف فجأة</b>\n\n`
  msg += `🤖 الوكيل: <b>${escapeHtml(agent?.name || 'غير معروف')}</b>\n`
  msg += `❌ العملية ليست نشطة (process not found)\n`
  if (task?.title) msg += `📋 المهمة المتأثرة: ${escapeHtml(task.title)}\n`
  msg += `\n⚙️ يمكنك إعادة التشغيل من الإعدادات أو الطرفية:\n`
  msg += `<code>openclaw agent --agent ${escapeHtml((agent?.name || 'agent').toLowerCase())}</code>`

  return sendMessage(msg, { account: agent?.name?.toLowerCase() })
}

/**
 * Notify when all retry attempts failed — requires manual intervention.
 */
async function notifyAgentGaveUp({ agent, task, attempts } = {}) {
  let msg = `🚨 <b>فشل إعادة التشغيل التلقائي</b>\n\n`
  msg += `🤖 الوكيل: <b>${escapeHtml(agent?.name || 'غير معروف')}</b>\n`
  msg += `📋 المهمة: ${escapeHtml(task?.title || 'غير معروفة')}\n`
  msg += `🔁 عدد المحاولات الفاشلة: ${attempts}\n`
  msg += `\n❗ <b>مطلوب تدخل يدوي</b>\n`
  msg += `الوكيل خارج الخدمة تماماً. شغّله يدوياً من الطرفية:\n`
  msg += `<code>openclaw agent --agent ${escapeHtml((agent?.name || 'agent').toLowerCase())}</code>`

  return sendMessage(msg, { account: agent?.name?.toLowerCase() })
}

// --- Helpers ---

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}س ${m % 60}د`
  if (m > 0) return `${m}د ${s % 60}ث`
  return `${s}ث`
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

module.exports = {
  sendMessage,
  notifyTaskComplete,
  notifyTaskStuck,
  notifyAgentStuck,
  notifyAgentRecovered,
  notifyAgentCrashed,
  notifyAgentGaveUp,
}
