import React, { useState } from 'react'
import { X, Zap, User } from 'lucide-react'

const STATUS_CONFIG = {
  idle:    { dot: 'bg-emerald-400',               label: 'متاح',      text: 'text-emerald-400' },
  busy:    { dot: 'bg-blue-400 animate-pulse',    label: 'مشغول',     text: 'text-blue-400' },
  stuck:   { dot: 'bg-orange-400 animate-pulse',  label: 'عالق',      text: 'text-orange-400' },
  offline: { dot: 'bg-slate-600',                 label: 'غير متصل',  text: 'text-slate-500' },
}

export default function AssignModal({ task, agents, onAssign, onClose }) {
  const [selected, setSelected] = useState(null)

  const idleAgents  = agents.filter((a) => a.status === 'idle')
  const otherAgents = agents.filter((a) => a.status !== 'idle')

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-board-surface border border-board-border rounded-3xl w-full max-w-md shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-board-border/60">
          <div>
            <h2 className="text-sm font-semibold text-white">تعيين وكيل</h2>
            <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{task.title}</p>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Agent list */}
        <div className="p-4 space-y-1.5 max-h-80 overflow-y-auto">
          {agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
              <User size={28} strokeWidth={1} />
              <p className="text-sm">لا يوجد وكلاء مسجلون</p>
            </div>
          ) : (
            <>
              {idleAgents.length > 0 && (
                <p className="section-label pb-1 pt-0.5 px-1">متاحون</p>
              )}
              {idleAgents.map((agent) => (
                <AgentOption key={agent.id} agent={agent} selected={selected === agent.id} onSelect={setSelected} />
              ))}
              {otherAgents.length > 0 && (
                <p className="section-label pb-1 pt-3 px-1">غير متاحين</p>
              )}
              {otherAgents.map((agent) => (
                <AgentOption key={agent.id} agent={agent} selected={selected === agent.id} onSelect={setSelected} />
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-board-border/60">
          <button className="btn-secondary" onClick={onClose}>إلغاء</button>
          <button
            className="btn-primary"
            onClick={() => selected && onAssign(selected)}
            disabled={!selected}
          >
            <Zap size={14} />
            تعيين وتشغيل
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentOption({ agent, selected, onSelect }) {
  const cfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.offline
  const isBusy = agent.status !== 'idle'

  return (
    <button
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl border transition-all text-right ${
        selected
          ? 'border-indigo-500/60 bg-indigo-950/50 shadow-glow-sm'
          : `border-board-border/60 bg-board-card/60 hover:bg-board-card hover:border-board-borderHov ${isBusy ? 'opacity-50' : ''}`
      }`}
      onClick={() => onSelect(agent.id)}
    >
      {/* Avatar */}
      <div className="relative shrink-0">
        <div className="w-8 h-8 rounded-xl bg-indigo-900/60 border border-indigo-800/40 flex items-center justify-center text-xs font-bold text-indigo-300">
          {agent.name[0].toUpperCase()}
        </div>
        <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-board-surface ${cfg.dot}`} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-medium text-slate-200 truncate">{agent.name}</p>
        <p className={`text-xs ${cfg.text}`}>{cfg.label}</p>
      </div>

      {/* Check */}
      {selected && (
        <div className="w-5 h-5 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
          <span className="text-white text-[10px] font-bold">✓</span>
        </div>
      )}
    </button>
  )
}
