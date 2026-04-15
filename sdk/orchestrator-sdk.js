/**
 * orchestrator-sdk.js
 * Thin client for Node.js agents to report progress to the orchestrator.
 *
 * Usage:
 *   const { report, complete, fail } = require('./orchestrator-sdk')
 *   await report({ agentId: 'agent-1', taskId: 'task-xyz', progress: 60, message: 'Running tests' })
 *   await complete({ agentId: 'agent-1', taskId: 'task-xyz', message: 'All done' })
 */

const http = require('http')
const https = require('https')

const DEFAULT_HOST = process.env.ORCHESTRATOR_HOST || 'localhost'
const DEFAULT_PORT = parseInt(process.env.ORCHESTRATOR_PORT || process.env.BACKEND_PORT || '3001', 10)

/**
 * Post a heartbeat/progress update to the orchestrator.
 * @param {object} opts
 * @param {string} opts.agentId     - Agent ID (required)
 * @param {string} [opts.taskId]    - Task ID currently being worked on
 * @param {number} [opts.progress]  - Progress 0-100
 * @param {string} [opts.status]    - 'running' | 'completed' | 'failed' | 'blocked'
 * @param {string} [opts.message]   - Human-readable status message
 * @param {string} [opts.host]      - Orchestrator host (default: localhost)
 * @param {number} [opts.port]      - Orchestrator port (default: 3001)
 */
function report({ agentId, taskId, progress = 0, status = 'running', message = '', host, port } = {}) {
  return postHeartbeat({ agentId, taskId, progress, status, message }, host, port)
}

/**
 * Report task completion.
 */
function complete({ agentId, taskId, message = 'Task completed', host, port } = {}) {
  return postHeartbeat({ agentId, taskId, progress: 100, status: 'completed', message }, host, port)
}

/**
 * Report task failure.
 */
function fail({ agentId, taskId, message = 'Task failed', host, port } = {}) {
  return postHeartbeat({ agentId, taskId, progress: 0, status: 'failed', message }, host, port)
}

// --- Internals ---

function postHeartbeat(body, host = DEFAULT_HOST, port = DEFAULT_PORT) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const useHttps = host.startsWith('https')
    const lib = useHttps ? https : http
    const hostname = host.replace(/^https?:\/\//, '')

    const req = lib.request(
      {
        hostname,
        port,
        path: '/api/heartbeat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let responseData = ''
        res.on('data', (chunk) => (responseData += chunk))
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(responseData || '{}'))
          } else {
            reject(new Error(`Orchestrator returned ${res.statusCode}: ${responseData}`))
          }
        })
      }
    )

    req.setTimeout(5000, () => {
      req.destroy()
      reject(new Error('Heartbeat timed out after 5s'))
    })

    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

module.exports = { report, complete, fail }
