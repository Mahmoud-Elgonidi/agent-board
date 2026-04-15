import React, { useState, useEffect, useRef } from 'react'
import { X, Send, Zap, MessageSquare, ClipboardList, RefreshCw, Trash2 } from 'lucide-react'

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
}
function formatDate(ts) {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'اليوم'
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

// Merge and sort comments + logs into a single timeline
function buildTimeline(comments, logs) {
  const items = [
    ...comments.map((c) => ({ ...c, _type: 'comment' })),
    ...logs.map((l) => ({ ...l, _type: 'log' })),
  ]
  return items.sort((a, b) => a.created_at - b.created_at || a.timestamp - b.timestamp)
}

export default function CommentsPanel({ task, agents, onClose }) {
  const [comments, setComments] = useState([])
  const [logs, setLogs] = useState([])
  const [body, setBody] = useState('')
  const [isInstruction, setIsInstruction] = useState(false)
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('all') // all | comments | log
  const bottomRef = useRef(null)
  const textareaRef = useRef(null)

  const assignedAgent = agents.find((a) => a.id === task.assigned_agent)

  // Initial fetch
  useEffect(() => {
    Promise.all([
      fetch(`/api/tasks/${task.id}/comments`).then((r) => r.json()),
      fetch(`/api/tasks/${task.id}/log`).then((r) => r.json()),
    ]).then(([c, l]) => {
      setComments(c)
      setLogs(l)
      setLoading(false)
    })
  }, [task.id])

  // Live WebSocket events
  useEffect(() => {
    function onComment(e) {
      if (e.detail.taskId !== task.id) return
      setComments((prev) => {
        const exists = prev.some((c) => c.id === e.detail.comment.id)
        return exists ? prev : [...prev, e.detail.comment]
      })
    }
    function onLog(e) {
      if (e.detail.taskId !== task.id) return
      setLogs((prev) => {
        const exists = prev.some((l) => l.timestamp === e.detail.entry.timestamp)
        return exists ? prev : [...prev, e.detail.entry]
      })
    }
    function onLogCleared(e) { if (e.detail.taskId === task.id) setLogs([]) }
    window.addEventListener('task:comment', onComment)
    window.addEventListener('task:log', onLog)
    window.addEventListener('task:log:cleared', onLogCleared)
    return () => {
      window.removeEventListener('task:comment', onComment)
      window.removeEventListener('task:log', onLog)
      window.removeEventListener('task:log:cleared', onLogCleared)
    }
  }, [task.id])

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments, logs])

  async function handleSend(e) {
    e.preventDefault()
    if (!body.trim()) return
    setSending(true)
    await fetch(`/api/tasks/${task.id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: body.trim(), isInstruction, author: 'أنت' }),
    })
    setBody('')
    setIsInstruction(false)
    setSending(false)
    textareaRef.current?.focus()
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend(e)
  }

  async function clearLog() {
    if (!confirm('مسح سجل الوكيل؟')) return
    await fetch(`/api/tasks/${task.id}/log`, { method: 'DELETE' })
    setLogs([])
  }

  const timeline = buildTimeline(comments, logs)
  const filtered = tab === 'comments' ? timeline.filter((i) => i._type === 'comment')
                 : tab === 'log'      ? timeline.filter((i) => i._type === 'log')
                 : timeline

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-board-surface border border-board-border rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl"
        style={{ maxHeight: '88vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-board-border shrink-0">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 mb-0.5 truncate">{task.title}</p>
            <div className="flex items-center gap-2">
              {assignedAgent && (
                <span className="flex items-center gap-1 text-xs text-blue-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  {assignedAgent.name}
                </span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                task.status === 'done' ? 'bg-emerald-900/40 text-emerald-400'
                : task.status === 'in_progress' ? 'bg-blue-900/40 text-blue-400'
                : task.status === 'blocked' ? 'bg-orange-900/40 text-orange-400'
                : 'bg-gray-800 text-gray-400'
              }`}>
                {task.status === 'done' ? 'مكتملة' : task.status === 'in_progress' ? 'جارية' : task.status === 'blocked' ? 'متوقفة' : 'انتظار'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-3">
            {logs.length > 0 && (
              <button className="btn-ghost p-1.5 rounded-lg text-gray-500 hover:text-red-400" onClick={clearLog} title="مسح سجل الوكيل">
                <Trash2 size={13} />
              </button>
            )}
            <button className="btn-ghost p-1.5 rounded-lg" onClick={onClose}><X size={15} /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pt-3 shrink-0">
          {[
            { id: 'all', label: `الكل (${timeline.length})` },
            { id: 'comments', label: `تعليقات (${comments.length})`, icon: <MessageSquare size={11} /> },
            { id: 'log', label: `سجل الوكيل (${logs.length})`, icon: <ClipboardList size={11} /> },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                tab === t.id ? 'bg-indigo-700 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {loading ? (
            <div className="flex justify-center py-12 text-gray-500">
              <RefreshCw size={18} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-gray-600">
              <MessageSquare size={28} className="mb-2 opacity-30" />
              <p className="text-sm">لا يوجد محتوى بعد</p>
            </div>
          ) : (
            filtered.map((item, idx) => {
              if (item._type === 'comment') {
                return <CommentBubble key={`c-${item.id}`} comment={item} />
              } else {
                return <LogEntry key={`l-${item.id ?? idx}`} entry={item} />
              }
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-board-border p-4 shrink-0">
          {/* Instruction toggle */}
          <div
            className={`flex items-center gap-3 p-2.5 rounded-xl border mb-3 cursor-pointer transition-all ${
              isInstruction
                ? 'border-indigo-600 bg-indigo-900/25'
                : 'border-board-border bg-board-card hover:border-indigo-700/40'
            }`}
            onClick={() => setIsInstruction(!isInstruction)}
          >
            <Zap size={14} className={isInstruction ? 'text-indigo-400' : 'text-gray-600'} />
            <div className="flex-1">
              <p className={`text-xs font-medium ${isInstruction ? 'text-indigo-300' : 'text-gray-400'}`}>
                {isInstruction ? '⚡ سيُرسل هذا التعليق كأوامر للوكيل' : 'تعليق للمتابعة فقط'}
              </p>
              {isInstruction && assignedAgent && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {task.status === 'done' || task.status === 'todo'
                    ? `سيُعاد تشغيل ${assignedAgent.name} والمهمة ستعود إلى "جارية"`
                    : `${assignedAgent.name} سيستلم التعليمات فوراً`}
                </p>
              )}
              {isInstruction && !assignedAgent && (
                <p className="text-xs text-orange-400 mt-0.5">لا يوجد وكيل معيّن على هذه المهمة</p>
              )}
            </div>
            <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${isInstruction ? 'bg-indigo-600' : 'bg-gray-700'}`}>
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${isInstruction ? 'left-4' : 'left-0.5'}`} />
            </div>
          </div>

          <form onSubmit={handleSend} className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isInstruction ? 'اكتب التعليمات الجديدة للوكيل…' : 'اكتب تعليقاً…'}
              rows={3}
              className={`flex-1 bg-board-card border rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none transition-colors resize-none ${
                isInstruction ? 'border-indigo-600/60 focus:border-indigo-500' : 'border-board-border focus:border-indigo-600'
              }`}
            />
            <button
              type="submit"
              disabled={!body.trim() || sending || (isInstruction && !assignedAgent)}
              className={`shrink-0 p-3 rounded-xl transition-all ${
                isInstruction
                  ? 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40'
                  : 'bg-indigo-700 hover:bg-indigo-600 text-white disabled:opacity-40'
              }`}
              title="Ctrl+Enter للإرسال"
            >
              {isInstruction ? <Zap size={16} /> : <Send size={16} />}
            </button>
          </form>
          <p className="text-xs text-gray-700 mt-1.5 text-left">Ctrl+Enter للإرسال</p>
        </div>
      </div>
    </div>
  )
}

// --- Sub-components ---

function CommentBubble({ comment }) {
  const isInstruction = comment.is_instruction === 1
  return (
    <div className="flex flex-col items-end">
      <div className={`max-w-[85%] rounded-2xl rounded-tr-sm px-4 py-2.5 ${
        isInstruction
          ? 'bg-indigo-700/60 border border-indigo-600/50'
          : 'bg-indigo-900/40 border border-indigo-800/30'
      }`}>
        {isInstruction && (
          <div className="flex items-center gap-1 mb-1.5">
            <Zap size={11} className="text-indigo-400" />
            <span className="text-xs text-indigo-400 font-medium">تعليمات للوكيل</span>
          </div>
        )}
        <p className="text-sm text-gray-100 leading-relaxed whitespace-pre-wrap">{comment.body}</p>
        <div className="flex items-center justify-between mt-1.5 gap-3">
          <span className="text-xs text-gray-500">{comment.author}</span>
          <span className="text-xs text-gray-600">{formatTime(comment.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

function LogEntry({ entry }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full border border-board-border bg-board-card flex items-center justify-center text-xs text-gray-500 shrink-0 mt-0.5">
        {entry.step}
      </div>
      <div className="flex-1 min-w-0 bg-board-card/50 border border-board-border/50 rounded-xl px-3 py-2">
        <div className="flex items-center gap-2 mb-1">
          <ClipboardList size={11} className="text-gray-600 shrink-0" />
          <span className="text-xs text-gray-600">الوكيل</span>
          <span className="text-xs text-gray-700 mr-auto">{formatTime(entry.timestamp)}</span>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed">{entry.message}</p>
      </div>
    </div>
  )
}
