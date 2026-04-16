require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const express = require('express')
const http = require('http')
const WebSocket = require('ws')
const cors = require('cors')
const path = require('path')

const { taskQueries, agentQueries, eventQueries, statusQueries } = require('./db')
const orchestrator     = require('./orchestrator')
const { normalizeTask } = orchestrator
const heartbeatMonitor = require('./heartbeatMonitor')
const sessionWatcher   = require('./sessionWatcher')
const agentMonitor     = require('./agentMonitor')

const PORT = parseInt(process.env.BACKEND_PORT || '3001', 10)

const app = express()
const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

// --- Middleware ---
app.use(cors())
app.use(express.json())

// --- Activity ring buffer (last 200 agent:activity events) ---
const activityBuffer = []
const ACTIVITY_BUFFER_SIZE = 200

// --- WebSocket broadcast ---
function broadcast(payload) {
  if (payload.event === 'agent:activity') {
    activityBuffer.push(payload.data)
    if (activityBuffer.length > ACTIVITY_BUFFER_SIZE) activityBuffer.shift()
  }
  const msg = JSON.stringify(payload)
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg)
    }
  })
}

// Inject broadcast into modules
orchestrator.setBroadcast(broadcast)
heartbeatMonitor.setBroadcast(broadcast)
sessionWatcher.setBroadcast(broadcast)
agentMonitor.setBroadcast(broadcast)

// When any agent goes idle, the monitor triggers the task queue processor
agentMonitor.setQueueProcessor(() => orchestrator.processTaskQueue())

// Make broadcast available to routes via app.locals
app.locals.broadcast = broadcast

// --- WebSocket lifecycle ---
wss.on('connection', (ws, req) => {
  console.log(`[ws] Client connected from ${req.socket.remoteAddress}`)

  // Send current state snapshot on connect
  ws.send(JSON.stringify({
    event: 'snapshot',
    data: {
      tasks: taskQueries.getAll.all().map(normalizeTask),
      agents: agentQueries.getAll.all(),
      events: eventQueries.getAll.all().slice(0, 50),
      statuses: statusQueries.getAll.all(),
    },
  }))

  ws.on('close', () => {
    console.log('[ws] Client disconnected')
  })

  ws.on('error', (err) => {
    console.error('[ws] Client error:', err.message)
  })
})

// --- Routes ---
app.use('/api/tasks', require('./routes/tasks'))
app.use('/api/tasks/:id/log', require('./routes/logs'))
app.use('/api/tasks/:id/notify', require('./routes/notify'))
app.use('/api/tasks/:id/comments', require('./routes/comments'))
app.use('/api/agents', require('./routes/agents'))
app.use('/api/heartbeat', require('./routes/heartbeat'))
app.use('/api/settings', require('./routes/settings'))
app.use('/api/statuses', require('./routes/statuses'))
app.use('/api/queue', require('./routes/queue'))
app.use('/api/crm-webhook',  require('./routes/crm-webhook'))
app.use('/api/crm-telegram', require('./routes/crm-telegram'))

// GET /api/events — recent event log
app.get('/api/events', (req, res) => {
  res.json(eventQueries.getAll.all())
})

// GET /api/activity — recent agent:activity ring buffer
app.get('/api/activity', (req, res) => {
  res.json([...activityBuffer].reverse())
})

// ─── Monitor API ──────────────────────────────────────────────────────────────

// GET /api/monitor — latest monitoring results
app.get('/api/monitor', (req, res) => {
  res.json({
    results: agentMonitor.getLastResults(),
    settings: agentMonitor.getSettings(),
  })
})

// POST /api/monitor/check — trigger immediate check, wait for results
app.post('/api/monitor/check', async (req, res) => {
  try {
    const results = await agentMonitor.forceCheck()
    res.json({ results, checkedAt: Date.now() })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Health check
app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), timestamp: Date.now() })
})

// --- Start ---
server.listen(PORT, () => {
  console.log(`[server] Backend running on http://localhost:${PORT}`)
  console.log(`[server] WebSocket ready on ws://localhost:${PORT}`)
  heartbeatMonitor.start()
  sessionWatcher.start()
  agentMonitor.start()

  // Startup: assign pending tasks to any agents that are already idle
  setTimeout(() => {
    orchestrator.processTaskQueue().catch((err) =>
      console.warn('[server] Startup queue processing failed:', err.message)
    )
  }, 5000)

  // Periodic safety net: every 60s, re-check for unassigned tasks + idle agents
  setInterval(() => {
    orchestrator.processTaskQueue().catch((err) =>
      console.warn('[server] Periodic queue processing failed:', err.message)
    )
  }, 60_000)
})

process.on('SIGTERM', () => {
  heartbeatMonitor.stop()
  agentMonitor.stop()
  server.close(() => process.exit(0))
})

process.on('SIGINT', () => {
  heartbeatMonitor.stop()
  agentMonitor.stop()
  server.close(() => process.exit(0))
})

module.exports = { app, broadcast }
