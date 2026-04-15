import React, { useState } from 'react'
import { X, Plus, AlertCircle, User, Lock, Info, ShieldAlert } from 'lucide-react'

const PRIORITIES = [
  { id: 'low',    label: 'منخفض', active: 'bg-slate-800 border-slate-600 text-slate-200',       inactive: 'bg-slate-900/60 border-slate-800/60 text-slate-500' },
  { id: 'medium', label: 'متوسط', active: 'bg-indigo-900/60 border-indigo-500 text-indigo-200', inactive: 'bg-indigo-950/40 border-indigo-900/40 text-indigo-500' },
  { id: 'high',   label: 'عالي',  active: 'bg-orange-900/60 border-orange-500 text-orange-200', inactive: 'bg-orange-950/40 border-orange-900/40 text-orange-500' },
  { id: 'urgent', label: 'عاجل',  active: 'bg-red-900/60 border-red-500 text-red-200',          inactive: 'bg-red-950/40 border-red-900/40 text-red-500' },
]

const STATUS_DOT = {
  idle:    'bg-emerald-400',
  busy:    'bg-blue-400',
  stuck:   'bg-orange-400',
  offline: 'bg-slate-600',
}

export default function AddTaskModal({ onClose, onCreate, agents = [] }) {
  const [title, setTitle]           = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority]     = useState('medium')
  const [targetAgent, setTargetAgent] = useState('')   // '' = any agent
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!title.trim()) { setError('العنوان مطلوب'); return }
    setSubmitting(true)
    setError('')
    try {
      await onCreate({
        title: title.trim(),
        description,
        priority,
        target_agent: targetAgent || null,
      })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const selectedAgent = agents.find((a) => a.id === targetAgent)

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
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600/20 border border-indigo-500/30 rounded-xl flex items-center justify-center">
              <Plus size={15} className="text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">مهمة جديدة</h2>
              <p className="text-xs text-slate-500">ستتم إعادة صياغتها تلقائياً</p>
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {/* Form */}
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
                placeholder="مثال: تنفيذ نظام المصادقة OAuth2"
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
                placeholder="تفاصيل المهمة، معايير القبول، السياق…"
                rows={4}
                className="input resize-none"
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
                      priority === p.id ? p.active : `${p.inactive} opacity-70 hover:opacity-100`
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target Agent */}
            <div>
              <label className="text-xs font-medium text-slate-400 flex items-center gap-1.5 mb-2">
                <Lock size={11} className="text-slate-600" />
                تخصيص لوكيل
                <span className="text-slate-600 font-normal">(اختياري)</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                {/* Any agent option */}
                <button
                  type="button"
                  onClick={() => setTargetAgent('')}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs transition-all text-right ${
                    targetAgent === ''
                      ? 'border-indigo-500/60 bg-indigo-950/50 text-indigo-300'
                      : 'border-board-border/60 bg-board-card/40 text-slate-400 hover:border-board-borderHov'
                  }`}
                >
                  <User size={13} className="shrink-0" />
                  <span>أي وكيل متاح</span>
                  {targetAgent === '' && <span className="mr-auto text-indigo-400">✓</span>}
                </button>

                {/* Agent options */}
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => setTargetAgent(agent.id)}
                    className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs transition-all text-right ${
                      targetAgent === agent.id
                        ? 'border-indigo-500/60 bg-indigo-950/50 text-slate-200'
                        : 'border-board-border/60 bg-board-card/40 text-slate-400 hover:border-board-borderHov'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <div className="w-5 h-5 rounded-lg bg-indigo-900/60 border border-indigo-800/40 flex items-center justify-center text-[10px] font-bold text-indigo-300">
                        {agent.name[0].toUpperCase()}
                      </div>
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-board-surface ${STATUS_DOT[agent.status] || 'bg-slate-600'}`} />
                    </div>
                    <span className="truncate">{agent.name}</span>
                    {targetAgent === agent.id && <span className="mr-auto text-indigo-400 shrink-0">✓</span>}
                  </button>
                ))}
              </div>

              {/* State-aware notice */}
              {!targetAgent ? (
                <div className="flex items-start gap-2 text-xs bg-orange-950/40 border border-orange-900/40 rounded-xl px-3 py-2.5 mt-1">
                  <ShieldAlert size={13} className="text-orange-400 shrink-0 mt-0.5" />
                  <p className="text-orange-300/90 leading-relaxed">
                    <strong>لن تُفتح تلقائياً</strong> — يجب تحديد وكيل حتى يبدأ النظام العمل عليها بعد إعادة الصياغة.
                    يمكن تعيين وكيل لها يدوياً لاحقاً من اللوحة.
                  </p>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs bg-emerald-950/40 border border-emerald-900/40 rounded-xl px-3 py-2.5 mt-1">
                  <Info size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-emerald-300/90 leading-relaxed">
                    ستُفتح تلقائياً لـ <strong>{selectedAgent?.name}</strong> بعد انتهاء إعادة الصياغة
                  </p>
                </div>
              )}
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/40 border border-red-900/40 rounded-xl px-3 py-2">
                <AlertCircle size={12} />
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2.5 px-6 py-4 border-t border-board-border/60">
            <button type="button" className="btn-secondary" onClick={onClose}>إلغاء</button>
            <button type="submit" className="btn-primary" disabled={submitting}>
              <Plus size={14} />
              {submitting ? 'جارٍ الإنشاء…' : 'إنشاء المهمة'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
