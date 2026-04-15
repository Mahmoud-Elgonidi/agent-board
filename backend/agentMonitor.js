/**
 * agentMonitor.js
 * Professional agent monitoring — two independent check layers:
 *
 *   1. Process check (pgrep) — is the openclaw binary actually running?
 *   2. File-activity check — when was the agent's session file last written?
 *
 * Status transitions:
 *   process dead  + was busy/stuck   → offline  (process crashed)
 *   process dead  + was idle         → offline
 *   process alive + was offline      → idle  (process restarted externally)
 *   process alive + file stale       + was busy → stuck  (silently frozen)
 *   process alive + file active      + was stuck → busy  (recovered by itself)
 *
 * This module does NOT handle retry/recovery — that remains in heartbeatMonitor.
 * It does NOT send Telegram messages — heartbeatMonitor owns alerts.
 * It exposes forceCheck() + getLastResults() for the API / settings dashboard.
 */

'use strict'

const { exec }    = require('child_process')
const { promisify } = require('util')
const fs   = require('fs')
const path = require('path')
const os   = require('os')

const { agentQueries, taskQueries, settingsQueries } = require('./db')
const telegram = require('./telegram')

const execAsync = promisify(exec)
const OPENCLAW_AGENTS_DIR = path.join(os.homedir(), '.openclaw', 'agents')

let broadcast       = () => {}
let timerHandle     = null
let lastResults     = []      // cache of most recent check results
let queueProcessor  = () => Promise.resolve()  // set by server.js

function setBroadcast(fn)    { broadcast = fn }
function setQueueProcessor(fn) { queueProcessor = fn }
function getLastResults()    { return lastResults }

// ─── Settings (read from DB each cycle for live config changes) ───────────────

function getSettings() {
  const g = (key, def) => settingsQueries.get.get(key)?.value ?? def
  return {
    enabled:          g('monitor_enabled',           '1') !== '0',
    intervalSeconds:  parseInt(g('monitor_interval_seconds',          '30')),
    processCheck:     g('monitor_process_check',     '1') !== '0',
    fileCheck:        g('monitor_file_check',        '1') !== '0',
    fileStaleSeconds: parseInt(g('monitor_file_stale_seconds',        '120')),
    processPattern:   g('monitor_process_pattern',   'openclaw.*--agent'),
    notifyOnStuck:    g('monitor_notify_stuck',      '1') !== '0',
    notifyOnOffline:  g('monitor_notify_offline',    '1') !== '0',
    notifyOnRecovery:      g('monitor_notify_recovery',         '0') !== '0',
    processGracePeriodMs:  g('monitor_process_grace_period_ms', '60000'),
  }
}

// ─── Process check ────────────────────────────────────────────────────────────

async function isProcessRunning(agentName, pattern) {
  try {
    const escaped = agentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const cmd     = `pgrep -c -f "${pattern}.*${escaped}" 2>/dev/null || echo 0`
    const { stdout } = await execAsync(cmd, { timeout: 3000 })
    return parseInt(stdout.trim()) > 0
  } catch {
    return null  // null = check failed (permission issue, etc.)
  }
}

// ─── File activity check ──────────────────────────────────────────────────────

function getLatestSessionMtime(agentName) {
  const dir = path.join(OPENCLAW_AGENTS_DIR, agentName, 'sessions')
  if (!fs.existsSync(dir)) return null
  try {
    const mtimes = fs.readdirSync(dir)
      .filter(f => f.endsWith('.jsonl') && !f.includes('.checkpoint.'))
      .map(f => { try { return fs.statSync(path.join(dir, f)).mtimeMs } catch { return 0 } })
    return mtimes.length ? Math.max(...mtimes) : null
  } catch { return null }
}

// ─── Per-agent status transition ──────────────────────────────────────────────

async function checkAgent(agent, settings, now) {
  const processAlive = settings.processCheck
    ? await isProcessRunning(agent.name, settings.processPattern)
    : null

  const lastFile     = settings.fileCheck ? getLatestSessionMtime(agent.name) : null
  const fileIdleMs   = lastFile ? (now - lastFile) : null
  const fileStale    = fileIdleMs !== null ? fileIdleMs > settings.fileStaleSeconds * 1000 : null

  const cur = agent.status
  let next  = cur
  let reason = ''

  // ── Process-based transitions ─────────────────────────────────────────────
  if (processAlive === false) {
    if (cur === 'busy' || cur === 'stuck' || cur === 'idle') {
      // Grace period: if agent had a recent heartbeat, don't rush to mark offline.
      // A newly-assigned agent needs time to start its process before pgrep finds it.
      // heartbeatMonitor owns the stuck/timeout detection for actively working agents.
      const gracePeriodMs = parseInt(settings.processGracePeriodMs || '60000')
      const recentHeartbeat = agent.last_heartbeat && (now - agent.last_heartbeat) < gracePeriodMs

      if (!recentHeartbeat) {
        next   = 'offline'
        reason = 'العملية ليست نشطة'
      }
      // else: skip — process might still be starting up; let heartbeatMonitor handle timeout
    }
  } else if (processAlive === true) {
    if (cur === 'offline') {
      next   = agent.current_task_id ? 'busy' : 'idle'
      reason = 'العملية نشطة مجدداً'
    }
    // File-based transitions (only when process is confirmed alive)
    if (fileStale === true && cur === 'busy') {
      next   = 'stuck'
      reason = `لا نشاط في الملفات منذ ${Math.round(fileIdleMs / 1000)}ث`
    } else if (fileStale === false && cur === 'stuck') {
      next   = 'busy'
      reason = 'استُؤنف النشاط في الملفات'
    }
  }

  return {
    agentId:      agent.id,
    agentName:    agent.name,
    status:       cur,
    newStatus:    next,
    changed:      next !== cur,
    reason,
    processAlive,
    lastFileActivity: lastFile,
    fileIdleSeconds:  fileIdleMs !== null ? Math.round(fileIdleMs / 1000) : null,
    fileStale,
    checkedAt:    now,
  }
}

// ─── Main monitor cycle ───────────────────────────────────────────────────────

async function runMonitor() {
  const settings = getSettings()
  if (!settings.enabled) return []

  const agents  = agentQueries.getAll.all()
  const now     = Date.now()
  const results = []

  for (const agent of agents) {
    try {
      const r = await checkAgent(agent, settings, now)
      results.push(r)

      if (!r.changed) continue

      console.log(`[agentMonitor] ${agent.name}: ${r.status} → ${r.newStatus} (${r.reason})`)

      // Apply new status
      agentQueries.update.run({
        id: agent.id,
        status: r.newStatus,
        clearTask: r.newStatus === 'offline' ? 1 : 0,
        current_task_id: null,
        last_heartbeat: r.newStatus === 'offline' ? null : agent.last_heartbeat,
        name: null, host: null, port: null, max_idle_seconds: null,
      })

      const updatedAgent = agentQueries.getById.get(agent.id)
      broadcast({ event: 'agent:updated', data: updatedAgent })
      broadcast({
        event: 'agent:activity',
        data: {
          agentName: agent.name,
          type: r.newStatus === 'stuck' ? 'stuck' : r.newStatus === 'offline' ? 'offline' : 'resumed',
          snippet: `${r.status} → ${r.newStatus}: ${r.reason}`,
          timestamp: now,
        },
      })

      // Agent came online (idle) → try to assign a pending task
      if (r.newStatus === 'idle') {
        queueProcessor().catch((err) =>
          console.warn(`[agentMonitor] Queue processor error: ${err.message}`)
        )
      }

      // ── Telegram notifications ─────────────────────────────────────────────
      const task = agent.current_task_id
        ? taskQueries.getById.get(agent.current_task_id)
        : null

      if (settings.notifyOnOffline && r.newStatus === 'offline' && r.status === 'busy') {
        telegram.notifyAgentCrashed({ agent, task })
          .catch(e => console.warn('[agentMonitor] Telegram failed:', e.message))
      }

      if (settings.notifyOnStuck && r.newStatus === 'stuck') {
        // heartbeatMonitor owns the full stuck/retry flow; we only notify on file-based detection
        telegram.notifyAgentStuck({
          agent,
          task,
          attempt: 0,
          maxRetries: 0,
          idleFormatted: `${r.fileIdleSeconds}ث بدون نشاط`,
          method: 'file-monitor',
        }).catch(e => console.warn('[agentMonitor] Telegram failed:', e.message))
      }

      if (settings.notifyOnRecovery && r.newStatus === 'busy' && r.status === 'stuck') {
        telegram.notifyAgentRecovered({ agent, task, attempt: 0, method: 'file-activity' })
          .catch(e => console.warn('[agentMonitor] Telegram failed:', e.message))
      }

    } catch (err) {
      console.error(`[agentMonitor] Error checking ${agent.name}: ${err.message}`)
      results.push({ agentId: agent.id, agentName: agent.name, error: err.message, checkedAt: now })
    }
  }

  lastResults = results
  return results
}

// ─── Lifecycle (self-rescheduling so interval changes apply live) ─────────────

function scheduleNext() {
  const s = getSettings()
  const delay = (s.enabled ? s.intervalSeconds : 10) * 1000
  timerHandle = setTimeout(async () => {
    await runMonitor().catch(err => console.error('[agentMonitor]', err.message))
    scheduleNext()
  }, delay)
}

function start() {
  if (timerHandle) return
  const s = getSettings()
  console.log(`[agentMonitor] Starting — interval: ${s.intervalSeconds}s, process: ${s.processCheck}, file: ${s.fileCheck}`)
  runMonitor().catch(err => console.error('[agentMonitor]', err.message)) // initial run
  scheduleNext()
}

function stop() {
  if (timerHandle) { clearTimeout(timerHandle); timerHandle = null }
}

async function forceCheck() {
  const results = await runMonitor()
  // Re-arm the timer from now
  if (timerHandle) { clearTimeout(timerHandle); timerHandle = null }
  scheduleNext()
  return results
}

module.exports = { start, stop, setBroadcast, setQueueProcessor, forceCheck, getLastResults, getSettings }
