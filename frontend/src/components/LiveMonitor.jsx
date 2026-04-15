import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Activity, Terminal, Zap, AlertTriangle, RefreshCw, MessageSquare, Bot, Filter, Pause, Play } from 'lucide-react'

const API = '/api'

// Agent color palette — deterministic by name
const AGENT_COLORS = {
  doc:    { bg: 'bg-blue-900/40',   text: 'text-blue-300',   dot: 'bg-blue-400',   border: 'border-blue-700/40' },
  adam:   { bg: 'bg-emerald-900/40', text: 'text-emerald-300', dot: 'bg-emerald-400', border: 'border-emerald-700/40' },
  yusuf:  { bg: 'bg-purple-900/40', text: 'text-purple-300', dot: 'bg-purple-400', border: 'border-purple-700/40' },
  khaled: { bg: 'bg-amber-900/40',  text: 'text-amber-300',  dot: 'bg-amber-400',  border: 'border-amber-700/40' },
  rami:   { bg: 'bg-rose-900/40',   text: 'text-rose-300',   dot: 'bg-rose-400',   border: 'border-rose-700/40' },
  main:   { bg: 'bg-cyan-900/40',   text: 'text-cyan-300',   dot: 'bg-cyan-400',   border: 'border-cyan-700/40' },
}

const DEFAULT_COLOR = { bg: 'bg-gray-800/40', text: 'text-gray-300', dot: 'bg-gray-400', border: 'border-gray-700/40' }

function agentColor(name) {
  return AGENT_COLORS[(name || '').toLowerCase()] || DEFAULT_COLOR
}

// Event type metadata
const EVENT_META = {
  tool:         { icon: Terminal,      label: 'أداة',       className: 'text-indigo-400' },
  assistant:    { icon: Bot,           label: 'رد',         className: 'text-emerald-400' },
  user_message: { icon: MessageSquare, label: 'رسالة',      className: 'text-sky-400' },
  stuck:        { icon: AlertTriangle, label: 'توقف',       className: 'text-red-400' },
  resumed:      { icon: RefreshCw,     label: 'استئناف',    className: 'text-amber-400' },
  heartbeat:    { icon: Activity,      label: 'نبضة',       className: 'text-gray-500' },
}

function EventRow({ event, tasks }) {
  const color = agentColor(event.agentName)
  const meta = EVENT_META[event.type] || { icon: Zap, label: event.type, className: 'text-gray-400' }
  const Icon = meta.icon

  const task = event.taskId ? tasks.find((t) => t.id === event.taskId) : null
  const time = new Date(event.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className={`flex items-start gap-3 px-4 py-2.5 border-b border-board-border/50 hover:bg-white/3 transition-colors group ${event.type === 'stuck' ? 'bg-red-950/20' : ''}`}>
      {/* Timestamp */}
      <span className="text-xs text-gray-600 font-mono w-20 shrink-0 pt-0.5 tabular-nums">{time}</span>

      {/* Agent badge */}
      <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ${color.bg} ${color.text} ${color.border} border shrink-0 w-20 justify-center`}>
        <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
        {(event.agentName || '?').toLowerCase()}
      </div>

      {/* Event type icon */}
      <div className={`flex items-center gap-1 text-xs shrink-0 w-16 ${meta.className}`}>
        <Icon size={12} />
        <span>{meta.label}</span>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {event.type === 'tool' && (
          <span className="text-sm text-gray-300">
            <code className="text-indigo-300 font-mono bg-indigo-950/40 px-1 rounded text-xs">{event.toolName}</code>
            {event.snippet && <span className="text-gray-500 ml-2 text-xs truncate"> {event.snippet}</span>}
          </span>
        )}
        {event.type === 'assistant' && (
          <span className="text-sm text-gray-300 line-clamp-2">{event.snippet}</span>
        )}
        {event.type === 'user_message' && (
          <span className="text-sm text-gray-300">
            {event.source === 'telegram' && <span className="text-xs text-sky-500 mr-1">📱</span>}
            {event.snippet}
          </span>
        )}
        {event.type === 'stuck' && (
          <span className="text-sm text-red-300">{event.snippet}</span>
        )}
        {event.type === 'resumed' && (
          <span className="text-sm text-amber-300">{event.snippet}</span>
        )}
        {task && (
          <span className="ml-2 text-xs text-gray-600 truncate">← {task.title}</span>
        )}
      </div>
    </div>
  )
}

function AgentPulse({ name, events }) {
  const color = agentColor(name)
  const recent = events.filter((e) => e.agentName?.toLowerCase() === name.toLowerCase())
  const lastEvent = recent[0]
  const isActive = lastEvent && (Date.now() - lastEvent.timestamp) < 60000
  const toolCount = recent.filter((e) => e.type === 'tool').length

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${color.bg} ${color.border} border`}>
      <span className={`w-2 h-2 rounded-full ${color.dot} ${isActive ? 'animate-pulse' : 'opacity-40'}`} />
      <span className={`text-sm font-medium ${color.text}`}>{name}</span>
      {toolCount > 0 && (
        <span className="text-xs text-gray-500 ml-auto">{toolCount} أداة</span>
      )}
    </div>
  )
}

export default function LiveMonitor({ agents, tasks }) {
  const [events, setEvents] = useState([])
  const [filter, setFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [paused, setPaused] = useState(false)
  const [count, setCount] = useState(0)
  const bottomRef = useRef(null)
  const pauseRef = useRef(false)

  // Keep pauseRef in sync
  useEffect(() => { pauseRef.current = paused }, [paused])

  // Load initial activity from ring buffer
  useEffect(() => {
    fetch(`${API}/activity`)
      .then((r) => r.json())
      .then((data) => {
        setEvents(data.reverse()) // oldest first
      })
      .catch(console.error)
  }, [])

  // Listen for live agent:activity via custom window events
  const handleActivity = useCallback((e) => {
    if (pauseRef.current) return
    setEvents((prev) => {
      const updated = [...prev, e.detail]
      return updated.length > 500 ? updated.slice(-500) : updated
    })
    setCount((c) => c + 1)
  }, [])

  useEffect(() => {
    window.addEventListener('agent:activity', handleActivity)
    return () => window.removeEventListener('agent:activity', handleActivity)
  }, [handleActivity])

  // Auto-scroll to bottom when not paused
  useEffect(() => {
    if (!paused && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [events, paused])

  const agentNames = [...new Set(agents.map((a) => a.name.toLowerCase()))]

  const filtered = events.filter((e) => {
    if (filter !== 'all' && e.agentName?.toLowerCase() !== filter) return false
    if (typeFilter !== 'all' && e.type !== typeFilter) return false
    return true
  })

  const stuckCount = events.filter((e) => e.type === 'stuck' && (Date.now() - e.timestamp) < 300000).length

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-board-border bg-board-surface">
        <Terminal size={16} className="text-emerald-400" />
        <h2 className="text-sm font-semibold text-white">Live Monitor</h2>
        <span className="text-xs text-gray-500">{filtered.length} حدث</span>
        {stuckCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-red-400 bg-red-950/40 px-2 py-0.5 rounded-full">
            <AlertTriangle size={10} />
            {stuckCount} وكيل متوقف
          </span>
        )}

        <div className="flex-1" />

        {/* Pause/Resume */}
        <button
          onClick={() => setPaused((p) => !p)}
          className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${paused ? 'bg-amber-900/40 text-amber-300 border border-amber-700/40' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
        >
          {paused ? <Play size={12} /> : <Pause size={12} />}
          {paused ? `استئناف (${count} جديد)` : 'إيقاف مؤقت'}
        </button>

        {/* Agent filter */}
        <div className="flex items-center gap-1.5">
          <Filter size={12} className="text-gray-500" />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-xs bg-gray-800 border border-board-border rounded px-2 py-1 text-gray-300 focus:outline-none"
          >
            <option value="all">كل الوكلاء</option>
            {agentNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="text-xs bg-gray-800 border border-board-border rounded px-2 py-1 text-gray-300 focus:outline-none"
        >
          <option value="all">كل الأنواع</option>
          <option value="tool">الأدوات</option>
          <option value="assistant">الردود</option>
          <option value="user_message">الرسائل</option>
          <option value="stuck">توقف</option>
          <option value="resumed">استئناف</option>
        </select>
      </div>

      {/* Agent pulse row */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-board-border bg-board-surface/60 overflow-x-auto">
        {agentNames.map((name) => (
          <button key={name} onClick={() => setFilter(filter === name ? 'all' : name)}>
            <AgentPulse name={name} events={events} />
          </button>
        ))}
        {agentNames.length === 0 && (
          <span className="text-xs text-gray-600">لا توجد وكلاء مسجلون</span>
        )}
      </div>

      {/* Event stream */}
      <div className="flex-1 overflow-y-auto font-mono text-xs">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600">
            <Activity size={32} className="opacity-30" />
            <p>في انتظار النشاط…</p>
            <p className="text-xs text-gray-700">ستظهر هنا أحداث الوكلاء في الوقت الفعلي</p>
          </div>
        ) : (
          filtered.map((event, idx) => (
            <EventRow key={`${event.timestamp}-${idx}`} event={event} tasks={tasks} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Pause overlay indicator */}
      {paused && (
        <div className="flex items-center justify-center gap-2 py-2 bg-amber-950/40 border-t border-amber-700/40 text-xs text-amber-300">
          <Pause size={12} />
          <span>مؤقت — {count} حدث جديد منذ الإيقاف</span>
        </div>
      )}
    </div>
  )
}
