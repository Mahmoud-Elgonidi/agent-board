import React, { useEffect, useRef, useState } from 'react'
import { X, Trash2, ClipboardList, RefreshCw } from 'lucide-react'

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDate(ts) {
  const d = new Date(ts)
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

function elapsed(start, end) {
  const diff = end - start
  if (diff < 1000) return `${diff}ms`
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`
  return `${Math.floor(diff / 60000)}m ${Math.round((diff % 60000) / 1000)}s`
}

export default function LogModal({ task, agents, logs: initialLogs, onClose }) {
  const [logs, setLogs] = useState(initialLogs || [])
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)
  const assignedAgent = agents.find((a) => a.id === task.assigned_agent)

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  // Listen for live WebSocket log updates via custom event from App
  useEffect(() => {
    function onLogEntry(e) {
      if (e.detail.taskId !== task.id) return
      setLogs((prev) => {
        const exists = prev.some((l) => l.id === e.detail.entry.id && l.timestamp === e.detail.entry.timestamp)
        return exists ? prev : [...prev, e.detail.entry]
      })
    }
    function onLogCleared(e) {
      if (e.detail.taskId === task.id) setLogs([])
    }
    window.addEventListener('task:log', onLogEntry)
    window.addEventListener('task:log:cleared', onLogCleared)
    return () => {
      window.removeEventListener('task:log', onLogEntry)
      window.removeEventListener('task:log:cleared', onLogCleared)
    }
  }, [task.id])

  async function refresh() {
    setLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}/log`)
      setLogs(await res.json())
    } finally {
      setLoading(false)
    }
  }

  async function clearLog() {
    if (!confirm('مسح كل سجل المهمة؟')) return
    await fetch(`/api/tasks/${task.id}/log`, { method: 'DELETE' })
    setLogs([])
  }

  const startTs = logs[0]?.timestamp
  const endTs = logs[logs.length - 1]?.timestamp
  const totalTime = startTs && endTs ? elapsed(startTs, endTs) : null

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-board-surface border border-board-border rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: '85vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-board-border shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <ClipboardList size={16} className="text-indigo-400 shrink-0" />
              <h2 className="text-base font-semibold text-white truncate">سجل المهمة</h2>
            </div>
            <p className="text-xs text-gray-400 truncate">{task.title}</p>
            {assignedAgent && (
              <p className="text-xs text-indigo-400 mt-0.5">
                الوكيل: {assignedAgent.name}
                {totalTime && <span className="text-gray-500 ml-2">· الوقت الكلي: {totalTime}</span>}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <button
              className="btn-ghost p-1.5 rounded-lg text-gray-400 hover:text-white"
              onClick={refresh}
              title="تحديث"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
            {logs.length > 0 && (
              <button
                className="btn-ghost p-1.5 rounded-lg text-gray-400 hover:text-red-400"
                onClick={clearLog}
                title="مسح السجل"
              >
                <Trash2 size={14} />
              </button>
            )}
            <button className="btn-ghost p-1.5 rounded-lg" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Log timeline */}
        <div className="flex-1 overflow-y-auto p-5">
          {logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-gray-600">
              <ClipboardList size={32} className="mb-3 opacity-40" />
              <p className="text-sm">لا يوجد سجل بعد</p>
              <p className="text-xs mt-1 text-gray-700">الوكيل سيكتب هنا ملخص كل خطوة</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute right-[19px] top-3 bottom-3 w-px bg-board-border" />

              <div className="space-y-0">
                {logs.map((entry, idx) => {
                  const prevTs = idx > 0 ? logs[idx - 1].timestamp : null
                  const stepElapsed = prevTs ? elapsed(prevTs, entry.timestamp) : null
                  const isLast = idx === logs.length - 1
                  const isToday = new Date(entry.timestamp).toDateString() === new Date().toDateString()

                  return (
                    <div key={entry.id ?? idx} className="flex gap-4 pb-5">
                      {/* Step dot */}
                      <div className="flex flex-col items-center shrink-0 relative z-10">
                        <div
                          className={`w-10 h-10 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0 ${
                            isLast && task.status !== 'done'
                              ? 'border-indigo-500 bg-indigo-900/50 text-indigo-300 animate-pulse'
                              : task.status === 'done' && isLast
                              ? 'border-emerald-500 bg-emerald-900/40 text-emerald-300'
                              : 'border-board-border bg-board-card text-gray-400'
                          }`}
                        >
                          {entry.step}
                        </div>
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-1.5">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-xs text-gray-500 font-mono">
                            {formatTime(entry.timestamp)}
                          </span>
                          {!isToday && (
                            <span className="text-xs text-gray-600">{formatDate(entry.timestamp)}</span>
                          )}
                          {stepElapsed && (
                            <span className="text-xs text-gray-700 bg-board-border/50 px-1.5 py-0.5 rounded">
                              +{stepElapsed}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-200 leading-relaxed">{entry.message}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Done marker */}
              {task.status === 'done' && (
                <div className="flex gap-4 items-center mt-1">
                  <div className="w-10 h-10 rounded-full border-2 border-emerald-500 bg-emerald-900/40 flex items-center justify-center shrink-0 z-10 relative">
                    <span className="text-emerald-400 text-sm">✓</span>
                  </div>
                  <div className="pt-1">
                    <p className="text-sm font-medium text-emerald-400">اكتملت المهمة</p>
                    {totalTime && (
                      <p className="text-xs text-gray-500 mt-0.5">الوقت الإجمالي: {totalTime}</p>
                    )}
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Footer stats */}
        {logs.length > 0 && (
          <div className="border-t border-board-border px-5 py-3 flex items-center gap-4 text-xs text-gray-500 shrink-0">
            <span>{logs.length} خطوة</span>
            {totalTime && <span>المدة: {totalTime}</span>}
            <span className="mr-auto">
              آخر تحديث: {formatTime(logs[logs.length - 1].timestamp)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
