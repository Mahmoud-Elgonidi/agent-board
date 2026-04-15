import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  RefreshCw, AlertTriangle, Clock, Zap, CheckCircle2, Bot,
  RotateCcw, Play, Activity, ChevronRight, Terminal, Info,
  ArrowRight, Inbox, Loader2,
} from 'lucide-react'

const API = '/api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_BADGE = {
  urgent: 'bg-red-900/50 text-red-300 border-red-700/50',
  high:   'bg-orange-900/50 text-orange-300 border-orange-700/50',
  medium: 'bg-blue-900/50 text-blue-300 border-blue-700/50',
  low:    'bg-gray-800/50 text-gray-400 border-gray-700/50',
}
const PRIORITY_LABEL = { urgent: 'عاجل', high: 'مرتفع', medium: 'متوسط', low: 'منخفض' }

const EVENT_COLORS = {
  TASK_ASSIGNED:        'text-blue-400',
  TASK_COMPLETED:       'text-emerald-400',
  TASK_ORPHAN_RESET:    'text-amber-400',
  TASK_PREMATURE_COMPLETE: 'text-orange-400',
  STUCK_DETECTED:       'text-red-400',
  AGENT_RESUMED:        'text-indigo-400',
  AGENT_GAVE_UP:        'text-red-500',
  HEARTBEAT:            'text-gray-600',
  TELEGRAM_NOTIFIED:    'text-sky-400',
}

function timeAgo(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60)  return `${s}ث`
  if (s < 3600) return `${Math.floor(s/60)}د`
  return `${Math.floor(s/3600)}س`
}

function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function StatusDot({ status }) {
  const cls = {
    idle:    'bg-emerald-400',
    busy:    'bg-blue-400 animate-pulse',
    stuck:   'bg-orange-400 animate-pulse',
    offline: 'bg-gray-600',
  }[status] || 'bg-gray-600'
  return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />
}

// ─── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCard({ icon: Icon, label, value, color, sub }) {
  return (
    <div className={`flex items-center gap-3 p-4 rounded-xl border bg-board-surface ${color}`}>
      <Icon size={20} className="shrink-0 opacity-70" />
      <div>
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs opacity-70">{label}</p>
        {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ─── Task row ──────────────────────────────────────────────────────────────────

function TaskRow({ task, onReset, onAssign, idleAgents, actionLoading }) {
  const [showAssign, setShowAssign] = useState(false)

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-board-border/40 hover:bg-white/3 group">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">{task.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded border ${PRIORITY_BADGE[task.priority] || PRIORITY_BADGE.medium}`}>
            {PRIORITY_LABEL[task.priority] || task.priority}
          </span>
          <span className="text-xs text-gray-600 font-mono">{task.status}</span>
          {task.agent_name && (
            <span className="text-xs text-gray-600">
              وكيل: <span className={task.agent_status === 'offline' ? 'text-red-400' : 'text-gray-400'}>{task.agent_name}</span>
            </span>
          )}
          <span className="text-xs text-gray-700">{timeAgo(task.updated_at)} مضت</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {showAssign && idleAgents.length > 0 ? (
          <div className="flex items-center gap-1">
            {idleAgents.map(a => (
              <button
                key={a.id}
                onClick={() => { onAssign(task.id, a.id); setShowAssign(false) }}
                disabled={actionLoading}
                className="px-2 py-1 text-xs rounded-md bg-blue-900/40 hover:bg-blue-900/70 text-blue-300 border border-blue-800/40 disabled:opacity-50"
              >
                {a.name}
              </button>
            ))}
            <button onClick={() => setShowAssign(false)} className="text-gray-600 hover:text-gray-400 text-xs px-1">✕</button>
          </div>
        ) : (
          <>
            {idleAgents.length > 0 && (
              <button
                onClick={() => setShowAssign(true)}
                disabled={actionLoading}
                className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs rounded-md bg-indigo-900/40 hover:bg-indigo-900/70 text-indigo-300 border border-indigo-800/40 disabled:opacity-50 transition-opacity"
              >
                تعيين
              </button>
            )}
            <button
              onClick={() => onReset(task.id)}
              disabled={actionLoading}
              className="opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-amber-900/40 hover:bg-amber-900/70 text-amber-300 border border-amber-800/40 disabled:opacity-50 transition-opacity"
            >
              {actionLoading ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
              إعادة للطابور
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ─── Event log ─────────────────────────────────────────────────────────────────

function EventLog({ events, tasks }) {
  const [filter, setFilter] = useState('all')
  const TYPES = ['all', 'TASK_ASSIGNED', 'TASK_COMPLETED', 'TASK_ORPHAN_RESET', 'STUCK_DETECTED', 'AGENT_RESUMED', 'AGENT_GAVE_UP', 'HEARTBEAT']

  const visible = filter === 'all' ? events : events.filter(e => e.type === filter)

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-board-border overflow-x-auto shrink-0">
        {TYPES.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
              filter === t ? 'bg-indigo-700 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
            }`}
          >
            {t === 'all' ? 'الكل' : t}
          </button>
        ))}
        <span className="mr-auto text-xs text-gray-600 shrink-0">{visible.length} حدث</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-12">لا أحداث</p>
        ) : (
          visible.map((ev, i) => {
            const task = ev.task_id ? tasks?.find(t => t.id === ev.task_id) : null
            let meta = {}
            try { meta = ev.metadata ? JSON.parse(ev.metadata) : {} } catch {}

            return (
              <div key={ev.id || i} className="flex items-start gap-3 px-4 py-2.5 border-b border-board-border/30 hover:bg-white/2">
                <span className="text-xs text-gray-600 font-mono w-20 shrink-0 tabular-nums">{fmtTime(ev.timestamp)}</span>
                <span className={`text-xs font-mono w-36 shrink-0 ${EVENT_COLORS[ev.type] || 'text-gray-400'}`}>{ev.type}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300">{ev.message}</p>
                  {task && (
                    <p className="text-xs text-gray-600 mt-0.5 truncate">↳ {task.title}</p>
                  )}
                </div>
                <span className="text-xs text-gray-700 shrink-0">{timeAgo(ev.timestamp)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function QueueDashboard({ tasks: propTasks, agents: propAgents }) {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [processing, setProcessing] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [tab, setTab]             = useState('orphaned')
  const [lastRefresh, setLastRefresh] = useState(null)
  const intervalRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const d = await fetch(`${API}/queue`).then(r => r.json())
      setData(d)
      setLastRefresh(Date.now())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 10_000) // refresh every 10s
    return () => clearInterval(intervalRef.current)
  }, [load])

  async function handleProcess() {
    setProcessing(true)
    try {
      await fetch(`${API}/queue/process`, { method: 'POST' })
      await load()
    } catch {}
    setProcessing(false)
  }

  async function handleResetAll() {
    setResetting(true)
    try {
      await fetch(`${API}/queue/reset`, { method: 'POST' })
      await load()
    } catch {}
    setResetting(false)
  }

  async function handleResetOne(taskId) {
    setActionLoading(true)
    try {
      await fetch(`${API}/tasks/${taskId}/reset`, { method: 'POST' })
      await load()
    } catch {}
    setActionLoading(false)
  }

  async function handleAssign(taskId, agentId) {
    setActionLoading(true)
    try {
      await fetch(`${API}/tasks/${taskId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId }),
      })
      await load()
    } catch {}
    setActionLoading(false)
  }

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <RefreshCw size={20} className="animate-spin mr-2" />
        تحميل…
      </div>
    )
  }

  const { orphaned, pending, active, agents, events, summary } = data
  const allTasks = propTasks || []

  const TABS = [
    { id: 'orphaned', label: 'المهجورة', count: summary.orphaned, color: summary.orphaned > 0 ? 'text-red-400' : '' },
    { id: 'pending',  label: 'في الانتظار', count: summary.pending  },
    { id: 'active',   label: 'نشطة',    count: summary.active   },
    { id: 'events',   label: 'سجل النظام', count: events.length  },
    { id: 'agents',   label: 'الوكلاء',  count: propAgents?.length || 0 },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-board-border bg-board-surface shrink-0">
        <div className="flex items-center gap-3">
          <Activity size={18} className="text-indigo-400" />
          <h2 className="text-base font-semibold text-white">طابور المهام والنظام</h2>
          {lastRefresh && (
            <span className="text-xs text-gray-600">آخر تحديث: {fmtTime(lastRefresh)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={14} />
          </button>
          {summary.orphaned > 0 && (
            <button
              onClick={handleResetAll}
              disabled={resetting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-amber-900/40 hover:bg-amber-900/70 text-amber-300 border border-amber-800/40 disabled:opacity-50 transition-colors"
            >
              {resetting ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
              إعادة المهجورة ({summary.orphaned})
            </button>
          )}
          <button
            onClick={handleProcess}
            disabled={processing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors"
          >
            {processing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            تشغيل الطابور
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-board-border shrink-0">
        <SummaryCard icon={AlertTriangle} label="مهام مهجورة" value={summary.orphaned}
          color={summary.orphaned > 0 ? 'border-red-800/50 text-red-300' : 'border-board-border text-gray-400'} />
        <SummaryCard icon={Clock} label="في الانتظار" value={summary.pending}
          color="border-board-border text-amber-300" />
        <SummaryCard icon={Zap} label="نشطة الآن" value={summary.active}
          color="border-board-border text-blue-300" />
        <SummaryCard icon={Bot} label="وكلاء متاحون" value={summary.idleAgents}
          color={summary.idleAgents > 0 ? 'border-emerald-800/50 text-emerald-300' : 'border-board-border text-gray-400'}
          sub={`من ${propAgents?.length || 0} إجمالاً`} />
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-2 border-b border-board-border bg-board-surface shrink-0">
        {TABS.map(({ id, label, count, color }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === id ? 'bg-indigo-700 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              tab === id ? 'bg-white/20' : 'bg-board-bg text-gray-500'
            } ${color}`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

        {/* Orphaned */}
        {tab === 'orphaned' && (
          <div>
            {orphaned.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <CheckCircle2 size={32} className="mb-3 text-emerald-600" />
                <p className="text-sm">لا توجد مهام مهجورة</p>
                <p className="text-xs mt-1">كل المهام لها وكيل نشط أو في الطابور</p>
              </div>
            ) : (
              <>
                <div className="px-6 py-3 bg-red-950/20 border-b border-red-900/30">
                  <div className="flex items-center gap-2 text-red-400 text-xs">
                    <AlertTriangle size={13} />
                    <span>هذه المهام في حالة غير نهائية لكن وكيلها خارج الخدمة أو غير معيّن. اضغط "إعادة للطابور" لإعادتها للانتظار.</span>
                  </div>
                </div>
                {orphaned.map(task => (
                  <TaskRow key={task.id} task={task}
                    onReset={handleResetOne}
                    onAssign={handleAssign}
                    idleAgents={agents.idle}
                    actionLoading={actionLoading} />
                ))}
              </>
            )}
          </div>
        )}

        {/* Pending */}
        {tab === 'pending' && (
          <div>
            {pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <Inbox size={32} className="mb-3" />
                <p className="text-sm">الطابور فارغ</p>
              </div>
            ) : (
              <>
                {agents.idle.length === 0 && (
                  <div className="px-6 py-3 bg-amber-950/20 border-b border-amber-900/30">
                    <p className="text-xs text-amber-400 flex items-center gap-2">
                      <Info size={13} />
                      لا يوجد وكيل متاح الآن — ستُعيَّن المهام فور توفر وكيل
                    </p>
                  </div>
                )}
                {pending.map(task => (
                  <TaskRow key={task.id} task={task}
                    onReset={handleResetOne}
                    onAssign={handleAssign}
                    idleAgents={agents.idle}
                    actionLoading={actionLoading} />
                ))}
              </>
            )}
          </div>
        )}

        {/* Active */}
        {tab === 'active' && (
          <div>
            {active.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-600">
                <Zap size={32} className="mb-3" />
                <p className="text-sm">لا توجد مهام نشطة</p>
              </div>
            ) : (
              active.map(task => (
                <div key={task.id} className="flex items-center gap-3 px-6 py-3 border-b border-board-border/40">
                  <StatusDot status={task.agent_status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{task.title}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Bot size={10} /> {task.agent_name}
                      </span>
                      <span>{task.progress || 0}%</span>
                      <span className="font-mono">{task.status}</span>
                      <span>آخر تحديث {timeAgo(task.updated_at)}</span>
                    </div>
                  </div>
                  {/* Progress bar */}
                  <div className="w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${task.progress || 0}%` }} />
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Events log */}
        {tab === 'events' && (
          <div className="h-full flex flex-col">
            <EventLog events={events} tasks={allTasks} />
          </div>
        )}

        {/* Agents */}
        {tab === 'agents' && (
          <div className="p-6 space-y-2">
            {(propAgents || []).length === 0 ? (
              <p className="text-sm text-gray-600 text-center py-12">لا وكلاء مسجلون</p>
            ) : (
              (propAgents || []).map(agent => (
                <div key={agent.id} className="flex items-center gap-3 p-4 rounded-xl border border-board-border bg-board-surface">
                  <StatusDot status={agent.status} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{agent.name}</p>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                      <span className="font-mono">{agent.status}</span>
                      {agent.last_heartbeat && (
                        <span>نبضة: {timeAgo(agent.last_heartbeat)} مضت</span>
                      )}
                      {agent.current_task_id && (
                        <span className="text-blue-400 truncate">
                          ↳ {allTasks.find(t => t.id === agent.current_task_id)?.title || agent.current_task_id}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(agent.status === 'busy' || agent.status === 'stuck') && (
                      <>
                        <button
                          onClick={() => fetch(`${API}/agents/${agent.id}/resume`, { method: 'POST' }).then(load)}
                          className="px-2 py-1 text-xs rounded-md bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/40"
                        >انعاش ناعم</button>
                        <button
                          onClick={() => fetch(`${API}/agents/${agent.id}/restart`, { method: 'POST' }).then(load)}
                          className="px-2 py-1 text-xs rounded-md bg-orange-900/40 hover:bg-orange-900/70 text-orange-300 border border-orange-800/40"
                        >إعادة تشغيل</button>
                      </>
                    )}
                    {agent.status !== 'offline' && (
                      <button
                        onClick={() => fetch(`${API}/agents/${agent.id}/kill`, { method: 'POST' }).then(load)}
                        className="px-2 py-1 text-xs rounded-md bg-red-900/30 hover:bg-red-900/60 text-red-400 border border-red-800/40"
                      >إيقاف</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
