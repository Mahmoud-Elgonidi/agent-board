const express = require('express')
const router = express.Router()
const { statusQueries } = require('../db')

// GET /api/statuses
router.get('/', (req, res) => {
  res.json(statusQueries.getAll.all())
})

// POST /api/statuses — create new custom status
router.post('/', (req, res) => {
  const { label, color, position, is_terminal, trigger_enabled, trigger_message } = req.body
  if (!label?.trim()) return res.status(400).json({ error: 'label is required' })

  // Generate slug id — try Latin chars first, else use timestamp
  const latinSlug = label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^\w]/g, '')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  const baseId = latinSlug.length >= 2 ? latinSlug : `status_${Date.now()}`

  // Ensure unique id
  let id = baseId
  let suffix = 1
  while (statusQueries.getById.get(id)) {
    id = `${baseId}_${suffix++}`
  }

  const maxPos = statusQueries.maxPosition.get()
  const now = Date.now()

  statusQueries.insert.run({
    id,
    label: label.trim(),
    color: color || 'slate',
    position: position != null ? parseInt(position) : (maxPos.max_pos + 1),
    is_terminal: is_terminal ? 1 : 0,
    is_system: 0,
    trigger_enabled: trigger_enabled ? 1 : 0,
    trigger_message: trigger_message?.trim() || null,
    created_at: now,
  })

  const created = statusQueries.getById.get(id)
  req.app.locals.broadcast?.({ event: 'status:created', data: created })
  res.status(201).json(created)
})

// PATCH /api/statuses/:id — update label, color, position, trigger
router.patch('/:id', (req, res) => {
  const status = statusQueries.getById.get(req.params.id)
  if (!status) return res.status(404).json({ error: 'Status not found' })

  const { label, color, position, is_terminal, trigger_enabled, trigger_message } = req.body

  statusQueries.update.run({
    id: req.params.id,
    label: label?.trim() || null,
    color: color || null,
    position: position != null ? parseInt(position) : null,
    is_terminal: is_terminal != null ? (is_terminal ? 1 : 0) : null,
    trigger_enabled: trigger_enabled != null ? (trigger_enabled ? 1 : 0) : null,
    trigger_message: trigger_message !== undefined ? (trigger_message?.trim() || null) : status.trigger_message,
  })

  const updated = statusQueries.getById.get(req.params.id)
  req.app.locals.broadcast?.({ event: 'status:updated', data: updated })
  res.json(updated)
})

// DELETE /api/statuses/:id — only non-system statuses
router.delete('/:id', (req, res) => {
  const status = statusQueries.getById.get(req.params.id)
  if (!status) return res.status(404).json({ error: 'Status not found' })
  if (status.is_system) return res.status(403).json({ error: 'Cannot delete system status' })

  statusQueries.delete.run(req.params.id)
  req.app.locals.broadcast?.({ event: 'status:deleted', data: { id: req.params.id } })
  res.json({ ok: true })
})

module.exports = router
