/**
 * taskReformulator.js
 * Rewrites raw task titles/descriptions into clear, structured tickets
 * before they are saved — using either:
 *
 *   "agent" mode  → spawns a registered openclaw agent (same Claude Code
 *                   instance your other agents use) with a reformulation prompt
 *   "api" mode    → calls the Anthropic SDK directly with an API key
 *
 * In both cases the call is asynchronous and fire-and-forget:
 * the task is created immediately with original content, then updated
 * when the reformulation completes.  If reformulation fails for any
 * reason the original content is kept unchanged.
 */

'use strict'

const { spawn }    = require('child_process')
const Anthropic    = require('@anthropic-ai/sdk')
const { settingsQueries, agentQueries } = require('./db')

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || '/opt/homebrew/bin/openclaw'

// ─── Settings ─────────────────────────────────────────────────────────────────

function getSettings() {
  const g = (key, def) => settingsQueries.get.get(key)?.value ?? def
  return {
    enabled:    g('task_reformulate_enabled',   '1') !== '0',
    agentId:    g('task_reformulate_agent_id',  ''),      // if set → agent mode
    model:      g('task_reformulate_model',     'claude-haiku-4-5-20251001'),
    apiKey:     g('task_reformulate_api_key',   '') || process.env.ANTHROPIC_API_KEY || '',
    timeoutMs:  parseInt(g('task_reformulate_timeout_ms', '90000')),
  }
}

// ─── Shared prompt ────────────────────────────────────────────────────────────

function buildPrompt(title, description) {
  return `openclaw-control-ui:reformulation-task
أنت مساعد متخصص في إعادة صياغة مهام العمل بشكل احترافي وواضح.

المهمة المُدخلة:
العنوان: ${title}
الوصف: ${description?.trim() || '(لا يوجد وصف)'}

أعد صياغة هذه المهمة. أرجع JSON فقط بدون أي نص إضافي، بهذا الشكل بالضبط:
{
  "title": "عنوان واضح وموجز لا يتجاوز 80 حرفاً",
  "description": "وصف واضح يشرح الهدف والسياق",
  "steps": [
    "الخطوة الأولى",
    "الخطوة الثانية"
  ]
}

القواعد:
1. العنوان يبدأ بفعل أمر (أضف / أصلح / عدّل / أنشئ / حدّث)
2. الوصف: جملة أو جملتان فقط، لا تكرر العنوان
3. الخطوات: 2-6 خطوات تنفيذية مرتبة ومنطقية
4. استخدم اللغة نفسها التي كُتبت بها المهمة
5. لا تخترع معلومات غير موجودة في النص الأصلي`
}

// ─── Parse JSON from raw agent/API text ───────────────────────────────────────

function parseResult(raw) {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  // Try exact parse first
  try { return JSON.parse(cleaned) } catch {}
  // Fallback: extract first {...} block
  const m = cleaned.match(/\{[\s\S]*?\}/)
  if (m) { try { return JSON.parse(m[0]) } catch {} }
  return null
}

// ─── Agent mode (openclaw CLI) ────────────────────────────────────────────────

function reformulateViaAgent(agentName, title, description, timeoutMs) {
  const prompt = buildPrompt(title, description)

  return new Promise((resolve) => {
    let output = ''
    let settled = false

    const settle = (val) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(val)
    }

    const timer = setTimeout(() => {
      console.warn(`[taskReformulator] Agent "${agentName}" timed out — using original content`)
      proc.kill('SIGTERM')
      settle(null)
    }, timeoutMs)

    const proc = spawn(OPENCLAW_BIN, [
      'agent', '--agent', agentName.toLowerCase(),
      '--message', prompt, '--json',
    ], { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] })

    proc.stdout.on('data', (chunk) => { output += chunk.toString() })
    proc.stderr.on('data', () => {})   // suppress stderr noise

    proc.on('close', () => {
      const parsed = parseResult(output)
      settle(parsed)
    })

    proc.on('error', (err) => {
      console.warn(`[taskReformulator] Spawn error for "${agentName}": ${err.message}`)
      settle(null)
    })
  })
}

// ─── API mode (Anthropic SDK) ─────────────────────────────────────────────────

async function reformulateViaAPI(apiKey, model, title, description) {
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildPrompt(title, description) }],
  })
  return parseResult(msg.content?.[0]?.text || '')
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Reformulates a task's title and description.
 * Returns { title, description, reformulated } — reformulated is true only on success.
 * Always falls back to original values if anything fails.
 */
async function reformulateTask(title, description = '') {
  const settings = getSettings()
  if (!settings.enabled) return { title, description }

  let parsed = null

  try {
    if (settings.agentId) {
      const agent = agentQueries.getById.get(settings.agentId)
      if (agent) {
        console.log(`[taskReformulator] Agent mode — using "${agent.name}" to reformulate: "${title}"`)
        parsed = await reformulateViaAgent(agent.name, title, description, settings.timeoutMs)
      } else {
        console.warn(`[taskReformulator] Configured agent "${settings.agentId}" not found — falling back to API`)
      }
    }

    if (!parsed && settings.apiKey) {
      console.log(`[taskReformulator] API mode — reformulating: "${title}"`)
      parsed = await reformulateViaAPI(settings.apiKey, settings.model, title, description)
    }

    if (!parsed) {
      console.warn('[taskReformulator] No API key and no valid agent configured — skipping reformulation')
    }
  } catch (err) {
    console.warn(`[taskReformulator] Reformulation failed: ${err.message}`)
    parsed = null
  }

  if (!parsed) return { title, description }

  const newTitle = (parsed.title || title).slice(0, 200)
  const steps    = Array.isArray(parsed.steps) ? parsed.steps : []
  let   newDesc  = parsed.description || description

  if (steps.length > 0) {
    newDesc += '\n\n**الخطوات:**\n' + steps.map((s, i) => `${i + 1}. ${s}`).join('\n')
  }

  console.log(`[taskReformulator] Done: "${title}" → "${newTitle}"`)
  return { title: newTitle, description: newDesc, reformulated: true }
}

module.exports = { reformulateTask, getSettings }
