import React, { useState } from 'react'
import { Plus, X, Cpu, Activity, ChevronRight, RotateCcw, Zap, PowerOff, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'

const STATUS_CONFIG = {
  idle:    { dot: 'bg-emerald-400',                     text: 'text-emerald-400', label: 'خامل',      ring: 'ring-emerald-500/30', bg: 'bg-emerald-500/10' },
  busy:    { dot: 'bg-blue-400 animate-pulse-fast',     text: 'text-blue-400',    label: 'يعمل',      ring: 'ring-blue-500/30',   bg: 'bg-blue-500/10' },
  stuck:   { dot: 'bg-orange-400 animate-pulse-fast',   text: 'text-orange-400',  label: 'عالق',      ring: 'ring-orange-500/30', bg: 'bg-orange-950/30 border-orange-900/40' },
  offline: { dot: 'bg-slate-600',                       text: 'text-slate-500',   label: 'غير متصل',  ring: 'ring-slate-700/30',  bg: 'bg-slate-800/30' },
}

function timeAgo(ts) {
  if (!ts) return 'لم يتصل بعد'
  const diff = Date.now() - ts
  if (diff < 60000) return 'الآن'
  if (diff < 3600000) return `منذ ${Math.floor(diff / 60000)} د`
  return `منذ ${Math.floor(diff / 3600000)} س`
}

// Per-agent recovery state: 'idle' | 'resuming' | 'restarting' | { ok, method } | { error }
function useRecovery() {
  const [states, setStates] = useState({})
  const set = (agentId, val) => setStates(s => ({ ...s, [agentId]: val }))
  const clear = (agentId) => setTimeout(() => setStates(s => { const n = { ...s }; delete n[agentId]; return n }), 3500)
  return { states, set, clear }
}

export default function AgentStatus({ agents, tasks }) {
  const [showAdd, setShowAdd] = useState(false)
  const [newAgent, setNewAgent] = useState({ name: '', port: '', cli_command: '' })
  const [adding, setAdding] = useState(false)
  const recovery = useRecovery()

  async function handleAddAgent(e) {
    e.preventDefault()
    if (!newAgent.name.trim()) return
    setAdding(true)
    try {
      await fetch('/api/agents/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAgent.name.trim(),
          port: newAgent.port ? parseInt(newAgent.port) : null,
          cli_command: newAgent.cli_command || null,
        }),
      })
      setNewAgent({ name: '', port: '', cli_command: '' })
      setShowAdd(false)
    } finally {
      setAdding(false)
    }
  }

  async function handleRemoveAgent(agentId) {
    await fetch(`/api/agents/${agentId}`, { method: 'DELETE' })
  }

  async function handleResume(agent) {
    recovery.set(agent.id, 'resuming')
    try {
      const res = await fetch(`/api/agents/${agent.id}/resume`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        recovery.set(agent.id, { ok: true, method: 'soft' })
      } else {
        recovery.set(agent.id, { error: data.error || 'فشل الاستئناف' })
      }
    } catch (e) {
      recovery.set(agent.id, { error: e.message })
    }
    recovery.clear(agent.id)
  }

  async function handleRestart(agent) {
    recovery.set(agent.id, 'restarting')
    try {
      const res = await fetch(`/api/agents/${agent.id}/restart`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        recovery.set(agent.id, { ok: true, method: 'hard' })
      } else {
        recovery.set(agent.id, { error: data.error || 'فشلت إعادة التشغيل' })
      }
    } catch (e) {
      recovery.set(agent.id, { error: e.message })
    }
    recovery.clear(agent.id)
  }

  const sorted = [...agents].sort((a, b) => {
    const order = { busy: 0, stuck: 1, idle: 2, offline: 3 }
    return (order[a.status] ?? 4) - (order[b.status] ?? 4)
  })

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu size={13} className="text-slate-500" />
          <span className="section-label">الوكلاء</span>
          <span className="text-xs text-slate-600 font-medium">{agents.length}</span>
        </div>
        <button className="btn-icon" onClick={() => setShowAdd(!showAdd)} title="تسجيل وكيل">
          <Plus size={13} />
        </button>
      </div>

      {/* Add agent form */}
      {showAdd && (
        <form onSubmit={handleAddAgent} className="card p-3 space-y-2 animate-slide-up">
          <p className="text-xs font-medium text-slate-300 mb-2">تسجيل وكيل جديد</p>
          <input type="text" placeholder="اسم الوكيل" value={newAgent.name}
            onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
            className="input input-sm" autoFocus />
          <input type="number" placeholder="المنفذ (اختياري)" value={newAgent.port}
            onChange={(e) => setNewAgent({ ...newAgent, port: e.target.value })}
            className="input input-sm" />
          <input type="text" placeholder="أمر CLI (اختياري)" value={newAgent.cli_command}
            onChange={(e) => setNewAgent({ ...newAgent, cli_command: e.target.value })}
            className="input input-sm" />
          <div className="flex gap-2 pt-1">
            <button type="button" className="btn-ghost text-xs flex-1 py-1" onClick={() => setShowAdd(false)}>إلغاء</button>
            <button type="submit" className="btn-primary text-xs flex-1 py-1" disabled={adding}>
              {adding ? 'جارٍ التسجيل…' : 'تسجيل'}
            </button>
          </div>
        </form>
      )}

      {/* Agent list */}
      {agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-700">
          <Cpu size={28} strokeWidth={1} />
          <p className="text-xs">لا يوجد وكلاء مسجلون</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((agent) => {
            const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline
            const currentTask = tasks.find((t) => t.id === agent.current_task_id)
            const rs = recovery.states[agent.id]
            const isLoading = rs === 'resuming' || rs === 'restarting'
            const canRecover = (agent.status === 'stuck' || agent.status === 'offline') && currentTask

            return (
              <div key={agent.id} className={`rounded-2xl border border-board-border/60 p-3 transition-all duration-200 ${cfg.bg}`}>
                {/* Agent header */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`relative shrink-0 w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold bg-board-card ring-2 ${cfg.ring}`}>
                      <span className="text-slate-300">{agent.name[0].toUpperCase()}</span>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-board-bg ${cfg.dot}`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-slate-200 truncate">{agent.name}</p>
                      <p className={`text-[10px] font-medium ${cfg.text}`}>{cfg.label}</p>
                    </div>
                  </div>
                  <button
                    className="btn-icon w-6 h-6 rounded-lg text-slate-700 hover:text-red-400 hover:bg-red-950/60 shrink-0"
                    onClick={() => handleRemoveAgent(agent.id)}
                    title="إزالة"
                  >
                    <X size={11} />
                  </button>
                </div>

                {/* Current task */}
                {currentTask && (
                  <div className="mt-2.5 pt-2 border-t border-white/6">
                    <div className="flex items-center gap-1 mb-1.5">
                      <ChevronRight size={9} className="text-slate-600 shrink-0" />
                      <p className="text-[11px] text-slate-400 truncate">{currentTask.title}</p>
                    </div>
                    {typeof currentTask.progress === 'number' && (
                      <div className="h-1 bg-board-border/80 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${currentTask.progress}%`,
                            background: currentTask.progress >= 80
                              ? 'linear-gradient(90deg, #10b981, #34d399)'
                              : 'linear-gradient(90deg, #6366f1, #818cf8)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Recovery feedback */}
                {rs && typeof rs === 'object' && (
                  <div className={`mt-2 flex items-center gap-1.5 text-[10px] px-2 py-1.5 rounded-lg ${
                    rs.ok
                      ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-900/40'
                      : 'bg-red-950/60 text-red-400 border border-red-900/40'
                  }`}>
                    {rs.ok
                      ? <><CheckCircle size={10} /> {rs.method === 'soft' ? 'تم إرسال إشارة الاستئناف' : 'تمت إعادة التشغيل'} — ينتظر استجابة الوكيل</>
                      : <><AlertCircle size={10} /> {rs.error}</>
                    }
                  </div>
                )}

                {/* Recovery actions — shown for stuck/offline agents with an active task */}
                {canRecover && (
                  <div className="mt-2 pt-2 border-t border-white/6 flex gap-1.5">
                    {/* Soft resume */}
                    <button
                      onClick={() => handleResume(agent)}
                      disabled={isLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium border border-indigo-900/50 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 hover:border-indigo-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      title="إرسال رسالة استئناف للجلسة الحالية"
                    >
                      {rs === 'resuming'
                        ? <Loader2 size={10} className="animate-spin" />
                        : <Zap size={10} />}
                      استئناف
                    </button>

                    {/* Hard restart */}
                    <button
                      onClick={() => handleRestart(agent)}
                      disabled={isLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-medium border border-orange-900/50 bg-orange-950/40 text-orange-300 hover:bg-orange-900/50 hover:border-orange-700/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      title="إيقاف العملية وبدء جلسة جديدة"
                    >
                      {rs === 'restarting'
                        ? <Loader2 size={10} className="animate-spin" />
                        : <RotateCcw size={10} />}
                      إعادة تشغيل
                    </button>
                  </div>
                )}

                {/* Last heartbeat */}
                <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-700">
                  <Activity size={9} />
                  {timeAgo(agent.last_heartbeat)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
