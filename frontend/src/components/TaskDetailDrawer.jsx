import React, { useState, useEffect, useRef } from 'react'
import {
  X, Send, Zap, MessageSquare, ClipboardList, RefreshCw, Trash2,
  Pencil, User, Clock, CheckCircle2, Circle, Ban,
  ChevronRight, Activity, ChevronDown, ChevronUp,
  RotateCcw, CheckCircle, AlertCircle, Loader2,
} from 'lucide-react'

const API = '/api'

function formatTime(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
}

function formatDate(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'اليوم'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return 'أمس'
  return d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })
}

function timeAgo(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  if (diff < 60000) return 'الآن'
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} د`
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} س`
  return `منذ ${Math.floor(diff / 86400000)} ي`
}

function buildTimeline(comments, logs) {
  return [
    ...comments.map((c) => ({ ...c, _type: 'comment', _sortKey: c.created_at })),
    ...logs.map((l) => ({ ...l, _type: 'log', _sortKey: l.timestamp })),
  ].sort((a, b) => a._sortKey - b._sortKey)
}

const STATUS_CONFIG = {
  todo:        { label: 'في الانتظار', icon: Circle,       cls: 'text-slate-400 bg-slate-800/60 border-slate-700/40' },
  in_progress: { label: 'جارية',       icon: Activity,     cls: 'text-blue-400 bg-blue-950/60 border-blue-900/40' },
  blocked:     { label: 'متوقفة',      icon: Ban,          cls: 'text-orange-400 bg-orange-950/60 border-orange-900/40' },
  done:        { label: 'مكتملة',      icon: CheckCircle2, cls: 'text-emerald-400 bg-emerald-950/60 border-emerald-900/40' },
}

const PRIORITY_CONFIG = {
  urgent: { label: 'عاجل',   cls: 'text-red-400 bg-red-950/60 border-red-900/50' },
  high:   { label: 'عالية',  cls: 'text-orange-400 bg-orange-950/60 border-orange-900/50' },
  medium: { label: 'متوسطة', cls: 'text-indigo-400 bg-indigo-950/60 border-indigo-900/50' },
  low:    { label: 'منخفضة', cls: 'text-slate-500 bg-slate-900/60 border-slate-800/50' },
}

export default function TaskDetailDrawer({ task, agents, onClose, onEdit, onAssign, onDelete, onUpdate }) {
  const [comments, setComments]       = useState([])
  const [logs, setLogs]               = useState([])
  const [body, setBody]               = useState('')
  const [isInstruction, setIsInstruction] = useState(false)
  const [sending, setSending]         = useState(false)
  const [loading, setLoading]         = useState(true)
  const [tab, setTab]                 = useState('all')
  const [visible, setVisible]         = useState(false)
  const [descExpanded, setDescExpanded] = useState(false)
  const [recovery, setRecovery]       = useState(null)  // null | 'resuming' | 'restarting' | {ok,method} | {error}
  const bottomRef  = useRef(null)
  const textareaRef = useRef(null)
  const scrollRef  = useRef(null)

  const assignedAgent  = agents.find((a) => a.id === task.assigned_agent)
  const isStuck        = assignedAgent?.status === 'stuck'
  const isAgentDown    = assignedAgent && (assignedAgent.status === 'stuck' || assignedAgent.status === 'offline')
  const statusCfg      = STATUS_CONFIG[task.status] || STATUS_CONFIG.todo
  const priorityCfg   = PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium
  const StatusIcon    = statusCfg.icon

  // Slide-in
  useEffect(() => { requestAnimationFrame(() => setVisible(true)) }, [])

  function handleClose() {
    setVisible(false)
    setTimeout(onClose, 280)
  }

  // Fetch comments + logs
  useEffect(() => {
    Promise.all([
      fetch(`${API}/tasks/${task.id}/comments`).then((r) => r.json()),
      fetch(`${API}/tasks/${task.id}/log`).then((r) => r.json()),
    ]).then(([c, l]) => {
      setComments(c)
      setLogs(l)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [task.id])

  // Live WS events
  useEffect(() => {
    function onComment(e) {
      if (e.detail.taskId !== task.id) return
      setComments((prev) => prev.some((c) => c.id === e.detail.comment.id) ? prev : [...prev, e.detail.comment])
    }
    function onLog(e) {
      if (e.detail.taskId !== task.id) return
      setLogs((prev) => prev.some((l) => l.timestamp === e.detail.entry.timestamp) ? prev : [...prev, e.detail.entry])
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

  // Auto-scroll on new content
  useEffect(() => {
    if (!loading) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments, logs, loading])

  async function handleSend(e) {
    e.preventDefault()
    if (!body.trim() || sending) return
    setSending(true)
    await fetch(`${API}/tasks/${task.id}/comments`, {
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
    await fetch(`${API}/tasks/${task.id}/log`, { method: 'DELETE' })
    setLogs([])
  }

  function handleDelete() {
    handleClose()
    setTimeout(() => onDelete(task.id), 280)
  }

  async function handleResume() {
    if (!assignedAgent) return
    setRecovery('resuming')
    try {
      const res = await fetch(`${API}/agents/${assignedAgent.id}/resume`, { method: 'POST' })
      const data = await res.json()
      setRecovery(data.ok ? { ok: true, method: 'soft' } : { error: data.error || 'فشل الاستئناف' })
    } catch (e) {
      setRecovery({ error: e.message })
    }
    setTimeout(() => setRecovery(null), 4000)
  }

  async function handleRestart() {
    if (!assignedAgent) return
    setRecovery('restarting')
    try {
      const res = await fetch(`${API}/agents/${assignedAgent.id}/restart`, { method: 'POST' })
      const data = await res.json()
      setRecovery(data.ok ? { ok: true, method: 'hard' } : { error: data.error || 'فشلت إعادة التشغيل' })
    } catch (e) {
      setRecovery({ error: e.message })
    }
    setTimeout(() => setRecovery(null), 4000)
  }

  const timeline = buildTimeline(comments, logs)
  const filtered =
    tab === 'comments' ? timeline.filter((i) => i._type === 'comment') :
    tab === 'log'      ? timeline.filter((i) => i._type === 'log') :
    timeline

  const descLines = (task.description || '').split('\n')
  const descLong  = descLines.length > 4 || (task.description || '').length > 200

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={handleClose}
      />

      {/* Drawer — flex col, full height, no overflow on the container itself */}
      <div
        className={`fixed top-0 right-0 h-full z-50 flex flex-col bg-board-surface border-l border-board-border/60 shadow-2xl transition-transform duration-300 ease-out ${visible ? 'translate-x-0' : 'translate-x-full'}`}
        style={{ width: 'min(580px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >

        {/* ── HEADER (fixed) ── */}
        <div className="flex items-start gap-2 px-4 pt-4 pb-3 border-b border-board-border/60 shrink-0">
          <button onClick={handleClose} className="btn-icon mt-0.5 shrink-0">
            <ChevronRight size={16} />
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${statusCfg.cls}`}>
                <StatusIcon size={11} />
                {statusCfg.label}
              </span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${priorityCfg.cls}`}>
                {priorityCfg.label}
              </span>
              {isStuck && (
                <span className="text-xs px-2.5 py-1 rounded-full bg-orange-950/60 text-orange-400 border border-orange-800/40">
                  ⚠ الوكيل عالق
                </span>
              )}
            </div>
            <h2 className="text-sm font-semibold text-white leading-snug">{task.title}</h2>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button onClick={() => { onEdit(task); handleClose() }} className="btn-icon" title="تعديل"><Pencil size={14} /></button>
            <button onClick={() => { onAssign(task); handleClose() }} className="btn-icon" title="تعيين وكيل"><User size={14} /></button>
            <button onClick={handleDelete} className="btn-icon text-red-500/60 hover:text-red-400" title="حذف"><Trash2 size={14} /></button>
          </div>
        </div>

        {/* ── META ROW (fixed) ── */}
        <div className="px-4 py-2.5 border-b border-board-border/40 shrink-0 space-y-2.5">
          {/* Progress */}
          {task.status === 'in_progress' && (
            <div>
              <div className="flex justify-between text-xs text-slate-500 mb-1">
                <span>التقدم</span>
                <span className="tabular-nums">{task.progress ?? 0}%</span>
              </div>
              <div className="h-1.5 bg-board-border rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${task.progress ?? 0}%`,
                    background: (task.progress ?? 0) >= 80
                      ? 'linear-gradient(90deg,#10b981,#34d399)'
                      : 'linear-gradient(90deg,#6366f1,#818cf8)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Agent + timestamps */}
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            {assignedAgent ? (
              <div className="flex items-center gap-1.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${isStuck ? 'bg-orange-900 text-orange-300' : 'bg-indigo-900 text-indigo-300'}`}>
                  {assignedAgent.name[0].toUpperCase()}
                </div>
                <span className={isStuck ? 'text-orange-400' : 'text-slate-400'}>{assignedAgent.name}</span>
                {task.status === 'in_progress' && !isStuck && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </div>
            ) : (
              <button
                onClick={() => { onAssign(task); handleClose() }}
                className="flex items-center gap-1 text-slate-600 hover:text-indigo-400 transition-colors"
              >
                <User size={11} />
                اضغط لتعيين وكيل
              </button>
            )}
            {task.last_heartbeat && (
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {timeAgo(task.last_heartbeat)}
              </span>
            )}
            {task.created_at && (
              <span className="text-slate-600">{formatDate(task.created_at)} {formatTime(task.created_at)}</span>
            )}
          </div>

          {/* Recovery panel — shown when assigned agent is stuck or offline */}
          {isAgentDown && (
            <div className="rounded-xl border border-orange-900/50 bg-orange-950/30 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-2 text-xs text-orange-300">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse shrink-0" />
                <span className="font-medium">
                  {assignedAgent.status === 'stuck' ? 'الوكيل عالق — لم يستجب منذ فترة' : 'الوكيل غير متصل'}
                </span>
              </div>

              {/* Feedback */}
              {recovery && typeof recovery === 'object' && (
                <div className={`flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-lg ${
                  recovery.ok
                    ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/40'
                    : 'bg-red-950/60 text-red-400 border border-red-900/40'
                }`}>
                  {recovery.ok
                    ? <><CheckCircle size={10} className="shrink-0" /> {recovery.method === 'soft' ? 'تم إرسال إشارة الاستئناف — ينتظر استجابة الوكيل' : 'تمت إعادة التشغيل — ينتظر اتصال الوكيل'}</>
                    : <><AlertCircle size={10} className="shrink-0" /> {recovery.error}</>
                  }
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  onClick={handleResume}
                  disabled={!!recovery && typeof recovery === 'string'}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border border-indigo-900/50 bg-indigo-950/50 text-indigo-300 hover:bg-indigo-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {recovery === 'resuming'
                    ? <Loader2 size={11} className="animate-spin" />
                    : <Zap size={11} />}
                  استئناف سريع
                </button>
                <button
                  onClick={handleRestart}
                  disabled={!!recovery && typeof recovery === 'string'}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium border border-orange-900/50 bg-orange-950/50 text-orange-300 hover:bg-orange-900/60 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {recovery === 'restarting'
                    ? <Loader2 size={11} className="animate-spin" />
                    : <RotateCcw size={11} />}
                  إعادة تشغيل كاملة
                </button>
              </div>

              <p className="text-[10px] text-slate-600 leading-relaxed">
                الاستئناف السريع يرسل رسالة تنبيه للجلسة الحالية.
                إعادة التشغيل تُغلق العملية وتبدأ جلسة جديدة بكامل السياق.
              </p>
            </div>
          )}
        </div>

        {/* ── TABS (fixed) ── */}
        <div className="flex items-center gap-1 px-4 pt-2.5 pb-1.5 border-b border-board-border/40 shrink-0">
          {[
            { id: 'all',      label: 'الكل',       count: timeline.length },
            { id: 'comments', label: 'تعليقات',    count: comments.length, icon: <MessageSquare size={10} /> },
            { id: 'log',      label: 'سجل الوكيل', count: logs.length,     icon: <ClipboardList size={10} /> },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                tab === t.id ? 'bg-indigo-600/80 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
            >
              {t.icon}
              {t.label}
              <span className={`tabular-nums ${tab === t.id ? 'text-indigo-200' : 'text-slate-600'}`}>
                {t.count}
              </span>
            </button>
          ))}
          {logs.length > 0 && (
            <button
              className="ml-auto btn-icon text-slate-700 hover:text-red-400"
              onClick={clearLog}
              title="مسح السجل"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {/* ── SCROLLABLE BODY ── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">

          {/* Description — collapsible if long */}
          {task.description && (
            <div className="bg-board-card/60 border border-board-border/50 rounded-2xl px-4 py-3 mb-1">
              <p className={`text-sm text-slate-300 leading-relaxed whitespace-pre-wrap ${
                descLong && !descExpanded ? 'line-clamp-4' : ''
              }`}>
                {task.description}
              </p>
              {descLong && (
                <button
                  className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-400 mt-2 transition-colors"
                  onClick={() => setDescExpanded(!descExpanded)}
                >
                  {descExpanded
                    ? <><ChevronUp size={11} /> طي الوصف</>
                    : <><ChevronDown size={11} /> عرض الوصف كاملاً</>
                  }
                </button>
              )}
            </div>
          )}

          {/* Timeline */}
          {loading ? (
            <div className="flex justify-center py-16 text-slate-600">
              <RefreshCw size={20} className="animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-2 text-slate-700">
              <MessageSquare size={32} strokeWidth={1} className="opacity-30" />
              <p className="text-sm">لا يوجد محتوى بعد</p>
              <p className="text-xs text-slate-700">اكتب تعليقاً أو انتظر نشاط الوكيل</p>
            </div>
          ) : (
            filtered.map((item, idx) =>
              item._type === 'comment'
                ? <CommentBubble key={`c-${item.id ?? idx}`} comment={item} />
                : <LogEntry key={`l-${item.id ?? idx}`} entry={item} />
            )
          )}
          <div ref={bottomRef} />
        </div>

        {/* ── COMMENT INPUT (fixed at bottom) ── */}
        <div className="border-t border-board-border/60 bg-board-surface px-4 py-3 shrink-0">
          {/* Instruction toggle */}
          <div
            className={`flex items-center gap-3 px-3 py-2 rounded-xl border mb-2.5 cursor-pointer transition-all select-none ${
              isInstruction
                ? 'border-indigo-600/60 bg-indigo-950/40'
                : 'border-board-border/60 hover:border-board-borderHov'
            }`}
            style={{ background: isInstruction ? undefined : 'rgba(25,28,42,0.6)' }}
            onClick={() => setIsInstruction(!isInstruction)}
          >
            <Zap size={13} className={isInstruction ? 'text-indigo-400 shrink-0' : 'text-slate-600 shrink-0'} />
            <p className={`text-xs flex-1 ${isInstruction ? 'text-indigo-300 font-medium' : 'text-slate-500'}`}>
              {isInstruction
                ? (assignedAgent ? `⚡ سيُرسل مباشرة إلى ${assignedAgent.name}` : '⚡ تعليمات (لا يوجد وكيل معيّن)')
                : 'تعليق للمتابعة فقط'}
            </p>
            <div className={`w-8 h-4 rounded-full transition-colors relative shrink-0 ${isInstruction ? 'bg-indigo-600' : 'bg-slate-700'}`}>
              <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all duration-200 ${isInstruction ? 'left-[18px]' : 'left-0.5'}`} />
            </div>
          </div>

          {/* Text + send */}
          <form onSubmit={handleSend} className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isInstruction ? 'اكتب التعليمات للوكيل…' : 'اكتب تعليقاً…'}
              rows={2}
              className={`flex-1 bg-board-card border rounded-xl px-3 py-2 text-sm text-white placeholder-slate-600
                focus:outline-none transition-colors resize-none
                ${isInstruction
                  ? 'border-indigo-600/50 focus:border-indigo-500'
                  : 'border-board-border focus:border-indigo-600/60'
                }`}
            />
            <button
              type="submit"
              disabled={!body.trim() || sending}
              className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 ${
                isInstruction ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-700 hover:bg-indigo-600 text-white'
              }`}
              title="Ctrl+Enter"
            >
              {sending
                ? <RefreshCw size={15} className="animate-spin" />
                : isInstruction ? <Zap size={15} /> : <Send size={15} />}
            </button>
          </form>
          <p className="text-[10px] text-slate-700 mt-1.5 select-none">Ctrl+Enter للإرسال</p>
        </div>
      </div>
    </>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CommentBubble({ comment }) {
  const isInstruction = comment.is_instruction === 1
  return (
    <div className="flex flex-col items-end">
      <div className={`max-w-[88%] rounded-2xl rounded-tr-sm px-3.5 py-2.5 ${
        isInstruction
          ? 'bg-indigo-900/50 border border-indigo-700/40'
          : 'bg-slate-800/60 border border-slate-700/30'
      }`}>
        {isInstruction && (
          <div className="flex items-center gap-1 mb-1.5">
            <Zap size={10} className="text-indigo-400" />
            <span className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wide">تعليمات للوكيل</span>
          </div>
        )}
        <p className="text-sm text-slate-100 leading-relaxed whitespace-pre-wrap">{comment.body}</p>
        <div className="flex items-center justify-between mt-1.5 gap-4">
          <span className="text-[10px] text-slate-500">{comment.author}</span>
          <span className="text-[10px] text-slate-600 tabular-nums">{formatTime(comment.created_at)}</span>
        </div>
      </div>
    </div>
  )
}

function LogEntry({ entry }) {
  return (
    <div className="flex gap-2.5 items-start">
      <div className="w-5 h-5 rounded-lg border border-board-border bg-board-card flex items-center justify-center text-[10px] text-slate-600 shrink-0 mt-0.5 font-mono tabular-nums">
        {entry.step}
      </div>
      <div className="flex-1 min-w-0 bg-board-card/40 border border-board-border/40 rounded-xl px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <ClipboardList size={9} className="text-slate-600 shrink-0" />
          <span className="text-[10px] text-slate-600">الوكيل</span>
          <span className="text-[10px] text-slate-700 mr-auto tabular-nums">{formatTime(entry.timestamp)}</span>
        </div>
        <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{entry.message}</p>
      </div>
    </div>
  )
}
