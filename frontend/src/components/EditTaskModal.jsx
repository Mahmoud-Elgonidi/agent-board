import React, { useState } from 'react'
import { X, Save, Zap, AlertCircle, Lock, User } from 'lucide-react'

const PRIORITIES = [
  { id: 'low',    label: 'منخفض', active: 'bg-slate-800 border-slate-600 text-slate-200',    inactive: 'bg-slate-900/60 border-slate-800/60 text-slate-500' },
  { id: 'medium', label: 'متوسط', active: 'bg-indigo-900/60 border-indigo-500 text-indigo-200', inactive: 'bg-indigo-950/40 border-indigo-900/40 text-indigo-500' },
  { id: 'high',   label: 'عالي',  active: 'bg-orange-900/60 border-orange-500 text-orange-200', inactive: 'bg-orange-950/40 border-orange-900/40 text-orange-500' },
  { id: 'urgent', label: 'عاجل',  active: 'bg-red-900/60 border-red-500 text-red-200',         inactive: 'bg-red-950/40 border-red-900/40 text-red-500' },
]

const STATUS_DOT = {
  idle: 'bg-emerald-400', busy: 'bg-blue-400', stuck: 'bg-orange-400', offline: 'bg-slate-600',
}

export default function EditTaskModal({ task, agents, onSave, onClose }) {
  const [title, setTitle]           = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [priority, setPriority]     = useState(task.priority || 'medium')
  const [targetAgent, setTargetAgent] = useState(task.target_agent || '')
  const [triggerAgent, setTriggerAgent] = useState(!!task.assigned_agent)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  const assignedAgent = agents.find((a) => a.id === task.assigned_agent)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('العنوان مطلوب'); return }
    setSubmitting(true)
    setError('')
    try {
      await onSave({
        title: title.trim(),
        description,
        priority,
        triggerAgent,
        target_agent: targetAgent || null,
      })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const hasAgent = !!task.assigned_agent
  const changed  = title !== task.title
    || description !== (task.description || '')
    || priority !== task.priority
    || (targetAgent || '') !== (task.target_agent || '')

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-board-surface border border-board-border rounded-3xl w-full max-w-lg shadow-2xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-board-border/60">
          <div>
            <h2 className="text-sm font-semibold text-white">تعديل المهمة</h2>
            {assignedAgent && (
              <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-fast inline-block" />
                معيّنة على {assignedAgent.name}
              </p>
            )}
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="px-6 py-5 space-y-4">
            {/* Title */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">
                العنوان <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">الوصف</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                className="input resize-none"
                placeholder="تفاصيل المهمة، متطلبات التنفيذ…"
              />
            </div>

            {/* Priority */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-2">الأولوية</label>
              <div className="flex gap-2">
                {PRIORITIES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPriority(p.id)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-all ${
                      priority === p.id ? p.active : `${p.inactive} opacity-60 hover:opacity-100`
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Agent */}
            {agents.length > 0 && (
              <div>
                <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 mb-2">
                  <Lock size={11} className="text-slate-600" />
                  تخصيص لوكيل
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetAgent('')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all ${
                      targetAgent === ''
                        ? 'border-indigo-500/60 bg-indigo-950/50 text-indigo-300'
                        : 'border-board-border/60 bg-board-card/40 text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <User size={11} />
                    أي وكيل
                  </button>
                  {agents.map((agent) => (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => setTargetAgent(agent.id)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs transition-all ${
                        targetAgent === agent.id
                          ? 'border-indigo-500/60 bg-indigo-950/50 text-slate-200'
                          : 'border-board-border/60 bg-board-card/40 text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${STATUS_DOT[agent.status] || 'bg-slate-600'}`} />
                      {agent.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Trigger agent toggle */}
            {hasAgent && (
              <div
                className={`flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer transition-all ${
                  triggerAgent
                    ? 'bg-indigo-950/50 border-indigo-600/60'
                    : 'bg-board-card/60 border-board-border/60 hover:border-board-borderHov'
                }`}
                onClick={() => setTriggerAgent(!triggerAgent)}
              >
                <div className="flex items-center gap-3">
                  <Zap size={15} className={triggerAgent ? 'text-indigo-400' : 'text-slate-600'} />
                  <div>
                    <p className="text-sm font-medium text-slate-200">أرسل التحديث للوكيل</p>
                    <p className="text-xs text-slate-500">
                      {triggerAgent
                        ? `${assignedAgent?.name} سيستلم التعديلات ويبدأ فوراً`
                        : 'حفظ بدون إشعار الوكيل'}
                    </p>
                  </div>
                </div>
                <div className={`w-9 h-5 rounded-full transition-colors relative shrink-0 ${triggerAgent ? 'bg-indigo-600' : 'bg-slate-700'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200 ${triggerAgent ? 'left-4' : 'left-0.5'}`} />
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/40 border border-red-900/40 rounded-xl px-3 py-2">
                <AlertCircle size={12} />
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-board-border/60">
            <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
            <button type="submit" className="btn-primary" disabled={submitting || !changed}>
              {triggerAgent && hasAgent ? <Zap size={14} /> : <Save size={14} />}
              {submitting
                ? 'جارٍ الحفظ…'
                : triggerAgent && hasAgent
                ? 'حفظ وإرسال للوكيل'
                : 'حفظ التعديلات'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
