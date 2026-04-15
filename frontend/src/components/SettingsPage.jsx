import React, { useState, useEffect, useCallback } from 'react'
import {
  Bot, Settings, Send, Database, Plus, Pencil, Trash2, RefreshCw,
  Save, X, CheckCircle2, AlertTriangle, Eye, EyeOff, RotateCcw,
  Activity, Zap, Layers, GripVertical, Lock, Bell, Clock, ShieldOff,
  Radar, Power, Cpu, FileText, Wifi, WifiOff, ChevronDown, Sparkles,
} from 'lucide-react'

const API = '/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-600 mt-1">{hint}</p>}
    </div>
  )
}

function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors ${className}`}
      {...props}
    />
  )
}

function SectionCard({ title, description, icon: Icon, children }) {
  return (
    <div className="bg-board-card border border-board-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-board-border">
        {Icon && <Icon size={16} className="text-indigo-400 shrink-0" />}
        <div>
          <h3 className="text-sm font-semibold text-white">{title}</h3>
          {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function SaveButton({ saving, saved, onClick, label = 'حفظ' }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        saved
          ? 'bg-emerald-700 text-emerald-100'
          : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50'
      }`}
    >
      {saving ? <RefreshCw size={14} className="animate-spin" /> : saved ? <CheckCircle2 size={14} /> : <Save size={14} />}
      {saving ? 'جاري الحفظ…' : saved ? 'تم الحفظ' : label}
    </button>
  )
}

const STATUS_COLORS = {
  idle:    { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'متاح' },
  busy:    { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400', label: 'مشغول' },
  stuck:   { dot: 'bg-orange-400 animate-pulse', text: 'text-orange-400', label: 'متوقف' },
  offline: { dot: 'bg-gray-600', text: 'text-gray-500', label: 'غير متصل' },
}

// ─── Agents Tab ───────────────────────────────────────────────────────────────

function AgentsTab({ agents, tasks, globalSettings, onRefresh }) {
  const [showAdd, setShowAdd] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newAgent, setNewAgent] = useState({
    name: '', type: 'openclaw', host: 'localhost', port: '', cli_command: '', max_idle_seconds: '180',
  })

  async function handleAdd(e) {
    e.preventDefault()
    if (!newAgent.name.trim()) return
    setSaving(true)
    await fetch(`${API}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newAgent.name.trim(),
        type: newAgent.type,
        host: newAgent.host,
        port: newAgent.port ? parseInt(newAgent.port) : null,
        cli_command: newAgent.cli_command || null,
        max_idle_seconds: parseInt(newAgent.max_idle_seconds) || 180,
      }),
    })
    setNewAgent({ name: '', type: 'openclaw', host: 'localhost', port: '', cli_command: '', max_idle_seconds: '180' })
    setShowAdd(false)
    setSaving(false)
    onRefresh()
  }

  async function handleDelete(id) {
    if (!confirm('حذف هذا الوكيل؟')) return
    await fetch(`${API}/agents/${id}`, { method: 'DELETE' })
    if (expandedId === id) setExpandedId(null)
    onRefresh()
  }

  async function handleReset(id) {
    await fetch(`${API}/settings/agents/${id}/reset`, { method: 'POST' })
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {/* Add agent */}
      <SectionCard title="إضافة وكيل جديد" description="سجّل وكيل OpenClaw موجود لربطه باللوحة" icon={Plus}>
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <Plus size={14} /> إضافة وكيل
          </button>
        ) : (
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="الاسم *" hint="يجب أن يطابق اسم الوكيل في openclaw">
                <Input placeholder="مثال: doc" value={newAgent.name}
                  onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })} required autoFocus />
              </Field>
              <Field label="النوع">
                <select value={newAgent.type} onChange={(e) => setNewAgent({ ...newAgent, type: e.target.value })}
                  className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
                  <option value="openclaw">OpenClaw</option>
                  <option value="custom">Custom</option>
                </select>
              </Field>
              <Field label="الـ Host">
                <Input placeholder="localhost" value={newAgent.host}
                  onChange={(e) => setNewAgent({ ...newAgent, host: e.target.value })} />
              </Field>
              <Field label="البورت (اختياري)">
                <Input type="number" placeholder="مثال: 4001" value={newAgent.port}
                  onChange={(e) => setNewAgent({ ...newAgent, port: e.target.value })} />
              </Field>
              <Field label="مهلة عدم الاستجابة (ثانية)" hint="يُعتبر متوقفاً بعد هذه المدة">
                <Input type="number" placeholder="180" value={newAgent.max_idle_seconds}
                  onChange={(e) => setNewAgent({ ...newAgent, max_idle_seconds: e.target.value })} />
              </Field>
              <Field label="أمر CLI (اختياري)">
                <Input placeholder="openclaw agent --agent doc" value={newAgent.cli_command}
                  onChange={(e) => setNewAgent({ ...newAgent, cli_command: e.target.value })} />
              </Field>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAdd(false)}
                className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors">إلغاء</button>
              <button type="submit" disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                {saving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {saving ? 'جاري الإضافة…' : 'إضافة'}
              </button>
            </div>
          </form>
        )}
      </SectionCard>

      {/* Agents list */}
      <div className="space-y-3">
        {agents.length === 0 ? (
          <div className="bg-board-card border border-board-border rounded-xl p-8 text-center text-gray-500 text-sm">
            لا يوجد وكلاء مسجلون
          </div>
        ) : agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            tasks={tasks}
            globalSettings={globalSettings}
            expanded={expandedId === agent.id}
            onToggle={() => setExpandedId(expandedId === agent.id ? null : agent.id)}
            onDelete={() => handleDelete(agent.id)}
            onReset={() => handleReset(agent.id)}
            onSaved={onRefresh}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Agent Card (expandable, 3-tab) ──────────────────────────────────────────

function AgentCard({ agent, tasks, globalSettings, expanded, onToggle, onDelete, onReset, onSaved }) {
  const [tab, setTab]                   = useState('config')
  const [agentSettings, setAgentSettings] = useState(null)
  const [sessions, setSessions]         = useState(null)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [showStatusMenu, setShowStatusMenu]   = useState(false)
  const [settingStatus, setSettingStatus]     = useState(false)
  const statusCfg  = STATUS_COLORS[agent.status] || STATUS_COLORS.offline
  const currentTask = tasks.find((t) => t.id === agent.current_task_id)

  async function setAgentStatus(status) {
    setSettingStatus(true)
    setShowStatusMenu(false)
    await fetch(`${API}/agents/${agent.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setSettingStatus(false)
    onSaved()
  }

  // Load per-agent data when expanded
  useEffect(() => {
    if (!expanded) return
    fetch(`${API}/agents/${agent.id}/settings`)
      .then((r) => r.json()).then(setAgentSettings).catch(() => setAgentSettings({}))
  }, [expanded, agent.id])

  useEffect(() => {
    if (!expanded || tab !== 'sessions') return
    setLoadingSessions(true)
    fetch(`${API}/agents/${agent.id}/sessions`)
      .then((r) => r.json())
      .then((d) => { setSessions(d); setLoadingSessions(false) })
      .catch(() => setLoadingSessions(false))
  }, [expanded, tab, agent.id])

  function refreshSessions() {
    setLoadingSessions(true)
    fetch(`${API}/agents/${agent.id}/sessions`)
      .then((r) => r.json())
      .then((d) => { setSessions(d); setLoadingSessions(false) })
      .catch(() => setLoadingSessions(false))
  }

  const heartbeatAge = agent.last_heartbeat
    ? Math.floor((Date.now() - agent.last_heartbeat) / 1000)
    : null

  return (
    <div className="bg-board-card border border-board-border rounded-xl overflow-hidden">
      {/* ── Card header (always visible) ── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
        onClick={onToggle}
      >
        <span className={`w-3 h-3 rounded-full shrink-0 ${statusCfg.dot}`} />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-white">{agent.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full bg-black/30 ${statusCfg.text}`}>
              {statusCfg.label}
            </span>
            {agent.type && agent.type !== 'openclaw' && (
              <span className="text-xs text-gray-600 bg-white/5 px-1.5 py-0.5 rounded">{agent.type}</span>
            )}
            {sessions?.sessions && (
              <span className="text-xs text-indigo-400 bg-indigo-900/30 px-1.5 py-0.5 rounded-md">
                {sessions.sessions.length} سشن
              </span>
            )}
          </div>
          {currentTask ? (
            <p className="text-xs text-blue-400 mt-0.5 truncate">⚙ {currentTask.title}</p>
          ) : heartbeatAge !== null ? (
            <p className="text-xs text-gray-600 mt-0.5">
              آخر نشاط: {heartbeatAge < 60 ? `${heartbeatAge}ث` : `${Math.floor(heartbeatAge / 60)}د`}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-1 relative" onClick={(e) => e.stopPropagation()}>
          {/* Manual status control */}
          <div className="relative">
            <button
              onClick={() => setShowStatusMenu(v => !v)}
              disabled={settingStatus}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
              title="تغيير الحالة يدوياً"
            >
              {settingStatus ? <RefreshCw size={11} className="animate-spin" /> : <Power size={11} />}
              <ChevronDown size={10} />
            </button>
            {showStatusMenu && (
              <div className="absolute left-0 top-full mt-1 w-32 bg-board-card border border-board-border rounded-xl shadow-xl z-50 overflow-hidden">
                {[
                  { s: 'idle',    label: 'متاح',       dot: 'bg-emerald-400' },
                  { s: 'busy',    label: 'مشغول',      dot: 'bg-blue-400' },
                  { s: 'stuck',   label: 'متوقف',      dot: 'bg-orange-400' },
                  { s: 'offline', label: 'غير متصل',   dot: 'bg-gray-600' },
                ].map(({ s, label, dot }) => (
                  <button
                    key={s}
                    onClick={() => setAgentStatus(s)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-white/5 transition-colors text-right ${agent.status === s ? 'text-white bg-white/5' : 'text-gray-400'}`}
                  >
                    <span className={`w-2 h-2 rounded-full ${dot}`} />
                    {label}
                    {agent.status === s && <span className="mr-auto text-gray-600 text-xs">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button onClick={onDelete}
            className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
            <Trash2 size={13} />
          </button>
          <span className={`text-gray-500 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>▶</span>
        </div>
      </div>

      {/* ── Quick stats strip ── */}
      {!expanded && (
        <div className="flex gap-4 px-4 py-2 text-xs text-gray-600 border-t border-board-border/40 bg-board-bg/20">
          <span>مهلة: <span className="text-gray-400">{agent.max_idle_seconds}ث</span></span>
          {agent.host && <span>host: <span className="text-gray-400">{agent.host}</span></span>}
          {agent.port && <span>port: <span className="text-gray-400">{agent.port}</span></span>}
          {agent.cli_command && <span className="truncate max-w-[200px]">CLI: <span className="text-gray-400 font-mono">{agent.cli_command}</span></span>}
        </div>
      )}

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="border-t border-board-border">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-4 py-2 bg-board-bg/40 border-b border-board-border/40">
            {[
              { id: 'config',    label: 'الإعدادات',   icon: Settings },
              { id: 'sessions',  label: 'السشن',        icon: Activity },
              { id: 'notifs',    label: 'الإشعارات',    icon: Bell },
            ].map(({ id, label, icon: Icon }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  tab === id ? 'bg-indigo-700 text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}>
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          <div className="p-4">
            {tab === 'config' && (
              <AgentConfigTab agent={agent} agentSettings={agentSettings} onSaved={onSaved} />
            )}
            {tab === 'sessions' && (
              <AgentSessionsTab
                agentId={agent.id}
                sessions={sessions}
                loading={loadingSessions}
                onRefresh={refreshSessions}
              />
            )}
            {tab === 'notifs' && agentSettings !== null && (
              <AgentNotificationsTab
                agentId={agent.id}
                agentSettings={agentSettings}
                globalSettings={globalSettings}
                onSaved={(updated) => setAgentSettings(updated)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Config Tab ───────────────────────────────────────────────────────────────

function AgentConfigTab({ agent, agentSettings, onSaved }) {
  const [form, setForm] = useState({
    name:             agent.name,
    type:             agent.type || 'openclaw',
    host:             agent.host || 'localhost',
    port:             agent.port || '',
    cli_command:      agent.cli_command || '',
    max_idle_seconds: agent.max_idle_seconds || 180,
  })
  const [telegramToken, setTelegramToken] = useState('')
  const [showToken, setShowToken]         = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  // Populate per-agent telegram token from loaded settings
  useEffect(() => {
    if (agentSettings?.telegram_token !== undefined) {
      setTelegramToken(agentSettings.telegram_token || '')
    }
  }, [agentSettings])

  async function handleSave() {
    setSaving(true)
    // Save core agent config
    await fetch(`${API}/settings/agents/${agent.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        port: form.port ? parseInt(form.port) : null,
        max_idle_seconds: parseInt(form.max_idle_seconds) || 180,
      }),
    })
    // Save per-agent telegram token override (empty = remove override)
    await fetch(`${API}/agents/${agent.id}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_token: telegramToken || '' }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onSaved()
  }

  return (
    <div className="space-y-5">
      {/* Basic config */}
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">الإعدادات الأساسية</p>
        <div className="grid grid-cols-2 gap-4">
          <Field label="الاسم">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="النوع">
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500">
              <option value="openclaw">OpenClaw</option>
              <option value="custom">Custom</option>
            </select>
          </Field>
          <Field label="Host">
            <Input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
          </Field>
          <Field label="Port">
            <Input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} placeholder="اختياري" />
          </Field>
          <Field label="مهلة عدم الاستجابة (ثانية)" hint="يُعتبر الوكيل متوقفاً بعد هذه المدة دون نشاط">
            <Input type="number" value={form.max_idle_seconds}
              onChange={(e) => setForm({ ...form, max_idle_seconds: e.target.value })} />
          </Field>
          <Field label="أمر CLI" hint="الأمر المستخدم لتشغيل الوكيل">
            <Input value={form.cli_command} onChange={(e) => setForm({ ...form, cli_command: e.target.value })} placeholder="openclaw agent --agent doc" />
          </Field>
        </div>
      </div>

      {/* Telegram token override */}
      <div>
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">تيليجرام (خاص بهذا الوكيل)</p>
        <Field
          label="توكن البوت"
          hint={`تجاوز الإعداد العام لـ telegram_token_${agent.name.toLowerCase()} — اتركه فارغاً للاستخدام العام`}
        >
          <div className="relative">
            <Input
              type={showToken ? 'text' : 'password'}
              value={telegramToken}
              onChange={(e) => setTelegramToken(e.target.value)}
              placeholder={agentSettings?.telegram_token ? '••••••••' : 'يستخدم الإعداد العام'}
              className="pr-10"
            />
            <button type="button" onClick={() => setShowToken(!showToken)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
              {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </Field>
      </div>

      {/* Agent info */}
      <div className="p-3 rounded-xl bg-board-bg/50 border border-board-border/50 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        <span className="text-gray-600">معرّف الوكيل: <span className="text-gray-400 font-mono select-all">{agent.id}</span></span>
        <span className="text-gray-600">تاريخ الإنشاء: <span className="text-gray-400">{new Date(agent.created_at).toLocaleDateString('ar-EG')}</span></span>
        <span className="text-gray-600">الحالة: <span className={STATUS_COLORS[agent.status]?.text || 'text-gray-400'}>{STATUS_COLORS[agent.status]?.label || agent.status}</span></span>
        {agent.last_heartbeat && (
          <span className="text-gray-600">آخر نبضة: <span className="text-gray-400">{new Date(agent.last_heartbeat).toLocaleTimeString('ar-EG')}</span></span>
        )}
      </div>

      <div className="flex justify-end">
        <SaveButton saving={saving} saved={saved} onClick={handleSave} />
      </div>
    </div>
  )
}

// ─── Sessions Tab ─────────────────────────────────────────────────────────────

function AgentSessionsTab({ agentId, sessions, loading, onRefresh }) {
  const [openFile, setOpenFile]     = useState(null)
  const [messages, setMessages]     = useState(null)
  const [loadingMsgs, setLoadingMsgs] = useState(false)

  async function openSession(filename) {
    if (openFile === filename) { setOpenFile(null); setMessages(null); return }
    setOpenFile(filename)
    setLoadingMsgs(true)
    try {
      const r = await fetch(`${API}/agents/${agentId}/sessions/${encodeURIComponent(filename)}`)
      const d = await r.json()
      setMessages(d)
    } catch { setMessages(null) }
    setLoadingMsgs(false)
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  function formatDate(ts) {
    if (!ts) return '—'
    const d = new Date(ts)
    return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
  }

  if (loading) {
    return <div className="flex justify-center py-10"><RefreshCw size={20} className="animate-spin text-gray-500" /></div>
  }

  if (!sessions) {
    return (
      <div className="text-center py-8">
        <p className="text-sm text-gray-500">لم يتم تحميل السشنات بعد</p>
        <button onClick={onRefresh} className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 mx-auto">
          <RefreshCw size={12} /> تحميل
        </button>
      </div>
    )
  }

  if (!sessions.exists) {
    return (
      <div className="text-center py-8 space-y-2">
        <p className="text-sm text-gray-500">لا يوجد مجلد سشنات</p>
        <p className="text-xs text-gray-600 font-mono">{sessions.dir}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-white">{sessions.sessions.length} سشن</span>
          <span className="text-xs text-gray-500 font-mono truncate max-w-[240px]">{sessions.dir}</span>
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
          <RefreshCw size={12} /> تحديث
        </button>
      </div>

      {sessions.sessions.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-6">لا توجد سشنات بعد</p>
      )}

      {/* Session list */}
      <div className="space-y-2">
        {sessions.sessions.map((s) => (
          <div key={s.filename} className="border border-board-border rounded-xl overflow-hidden">
            {/* Session row */}
            <button
              onClick={() => openSession(s.filename)}
              className="w-full flex items-center gap-3 px-4 py-3 bg-board-bg/50 hover:bg-board-bg/80 transition-colors text-right"
            >
              <div className="flex-1 min-w-0 text-right">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-gray-300 truncate">{s.filename}</span>
                  {s.runs > 0 && (
                    <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">{s.runs} runs</span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-gray-600 flex-wrap">
                  <span>💬 {s.userMessages} رسائل مستخدم</span>
                  <span>🤖 {s.assistantMessages} ردود</span>
                  <span>🔧 {s.toolCalls} أدوات</span>
                  <span>{formatSize(s.size)}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-500">{formatDate(s.modifiedAt)}</p>
                <p className="text-xs text-gray-700 mt-0.5">{s.lineCount} سطر</p>
              </div>
              <span className={`text-gray-600 text-xs transition-transform ${openFile === s.filename ? 'rotate-90' : ''}`}>▶</span>
            </button>

            {/* Session messages viewer */}
            {openFile === s.filename && (
              <div className="border-t border-board-border bg-board-bg/30 max-h-96 overflow-y-auto">
                {loadingMsgs ? (
                  <div className="flex justify-center py-6"><RefreshCw size={16} className="animate-spin text-gray-500" /></div>
                ) : messages ? (
                  <div className="p-3 space-y-2">
                    {messages.total > messages.showing && (
                      <p className="text-xs text-gray-600 text-center pb-1">
                        يعرض آخر {messages.showing} من {messages.total} إدخال
                      </p>
                    )}
                    {messages.messages.map((entry, i) => (
                      <SessionEntry key={i} entry={entry} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 text-center py-4">خطأ في تحميل السشن</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function SessionEntry({ entry }) {
  if (entry.type === 'session') {
    return (
      <div className="text-xs text-gray-600 py-1 border-b border-board-border/30 font-mono">
        ── بداية سشن {entry.id?.slice(0, 8)} ──
      </div>
    )
  }
  if (entry.type === 'custom') {
    return (
      <div className="text-xs text-purple-500/70 py-1">
        ⚡ Run جديد — {entry.data?.runId?.slice(0, 12) || ''}
      </div>
    )
  }
  if (entry.type !== 'message') return null

  const { role, content, toolName } = entry.message || {}
  const ts = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : ''

  if (role === 'user') {
    const text = Array.isArray(content)
      ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('').trim()
      : (content || '')
    const clean = text.replace(/Conversation info[\s\S]*?```\n/g, '').replace(/Sender[\s\S]*?```\n?/g, '').trim()
    if (!clean) return null
    return (
      <div className="flex gap-2 items-start">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5">{ts}</span>
        <div className="bg-indigo-900/20 border border-indigo-800/30 rounded-lg px-3 py-1.5 text-xs text-indigo-200 flex-1">
          👤 {clean.slice(0, 300)}{clean.length > 300 ? '…' : ''}
        </div>
      </div>
    )
  }
  if (role === 'assistant') {
    const text = Array.isArray(content)
      ? content.filter((c) => c?.type === 'text').map((c) => c.text).join('').trim()
      : ''
    if (!text) return null
    return (
      <div className="flex gap-2 items-start">
        <span className="text-xs text-gray-600 shrink-0 mt-0.5">{ts}</span>
        <div className="bg-emerald-900/20 border border-emerald-800/30 rounded-lg px-3 py-1.5 text-xs text-emerald-200 flex-1">
          🤖 {text.slice(0, 400)}{text.length > 400 ? '…' : ''}
        </div>
      </div>
    )
  }
  if (role === 'toolCall' || role === 'tool_use') {
    return (
      <div className="flex gap-2 items-center">
        <span className="text-xs text-gray-600 shrink-0">{ts}</span>
        <span className="text-xs text-amber-400/70 bg-amber-900/10 px-2 py-0.5 rounded font-mono">
          🔧 {toolName || entry.message?.name || '?'}
        </span>
      </div>
    )
  }
  if (role === 'toolResult') {
    return (
      <div className="flex gap-2 items-center">
        <span className="text-xs text-gray-600 shrink-0">{ts}</span>
        <span className="text-xs text-gray-600 font-mono">↩ نتيجة أداة</span>
      </div>
    )
  }
  return null
}

// ─── Notifications Tab (per-agent follow-up overrides) ───────────────────────

function AgentNotificationsTab({ agentId, agentSettings, globalSettings, onSaved }) {
  // Determine if agent has custom overrides
  const hasOverride = agentSettings.followup_enabled !== undefined
    || agentSettings.followup_first_delay_seconds !== undefined
    || agentSettings.followup_repeat_seconds !== undefined
    || agentSettings.followup_max_count !== undefined

  const [useOverride, setUseOverride] = useState(hasOverride)
  const [form, setForm] = useState({
    followup_enabled:              agentSettings.followup_enabled              ?? globalSettings?.telegram_followup_enabled ?? '1',
    followup_first_delay_seconds:  agentSettings.followup_first_delay_seconds  ?? globalSettings?.telegram_followup_first_delay_seconds ?? '60',
    followup_repeat_seconds:       agentSettings.followup_repeat_seconds       ?? globalSettings?.telegram_followup_repeat_seconds ?? '120',
    followup_max_count:            agentSettings.followup_max_count            ?? globalSettings?.telegram_followup_max_count ?? '0',
  })
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)

  async function handleSave() {
    setSaving(true)
    let payload
    if (!useOverride) {
      // Remove all per-agent overrides
      payload = {
        followup_enabled: '',
        followup_first_delay_seconds: '',
        followup_repeat_seconds: '',
        followup_max_count: '',
      }
    } else {
      payload = {
        ...form,
        followup_enabled: form.followup_enabled === true || form.followup_enabled === '1' ? '1' : '0',
      }
    }
    const r = await fetch(`${API}/agents/${agentId}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const updated = await r.json()
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    onSaved(updated)
  }

  const enabled = form.followup_enabled === '1' || form.followup_enabled === true
  const firstMin = (parseInt(form.followup_first_delay_seconds) / 60).toFixed(1).replace('.0', '')
  const repeatMin = (parseInt(form.followup_repeat_seconds) / 60).toFixed(1).replace('.0', '')

  return (
    <div className="space-y-4">
      {/* Override toggle */}
      <div className="flex items-center justify-between p-4 rounded-xl bg-board-bg border border-board-border">
        <div>
          <p className="text-sm font-medium text-white">إعدادات خاصة بهذا الوكيل</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {useOverride ? 'يستخدم إعدادات مخصصة تتجاوز الإعدادات العامة' : 'يرث الإعدادات من لوحة تيليجرام العامة'}
          </p>
        </div>
        <div
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${useOverride ? 'bg-indigo-600' : 'bg-gray-700'}`}
          onClick={() => setUseOverride(!useOverride)}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${useOverride ? 'left-6' : 'left-1'}`} />
        </div>
      </div>

      {/* Global preview when not overriding */}
      {!useOverride && (
        <div className="p-4 rounded-xl bg-board-bg/40 border border-board-border/50 space-y-1.5 text-xs">
          <p className="text-gray-500 font-medium mb-2">الإعدادات المورثة من العام:</p>
          <p className="text-gray-600">متابعة تلقائية: <span className="text-gray-300">{globalSettings?.telegram_followup_enabled !== '0' ? 'مفعّلة' : 'معطّلة'}</span></p>
          <p className="text-gray-600">أول رسالة بعد: <span className="text-gray-300">{globalSettings?.telegram_followup_first_delay_seconds || 60}ث</span></p>
          <p className="text-gray-600">تكرار كل: <span className="text-gray-300">{globalSettings?.telegram_followup_repeat_seconds || 120}ث</span></p>
          <p className="text-gray-600">الحد الأقصى: <span className="text-gray-300">{globalSettings?.telegram_followup_max_count === '0' || !globalSettings?.telegram_followup_max_count ? 'بلا حد' : globalSettings.telegram_followup_max_count + ' رسالة'}</span></p>
        </div>
      )}

      {/* Override form */}
      {useOverride && (
        <div className="space-y-4">
          {/* Enable toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-board-bg/50 border border-board-border/50">
            <div>
              <p className="text-sm text-white">تفعيل المتابعة لهذا الوكيل</p>
              <p className="text-xs text-gray-500 mt-0.5">يرسل تحديثات دورية للمهام الطويلة</p>
            </div>
            <div
              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
              onClick={() => setForm((f) => ({ ...f, followup_enabled: enabled ? '0' : '1' }))}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-4' : 'left-0.5'}`} />
            </div>
          </div>

          <div className={`space-y-4 transition-opacity ${enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="أول رسالة بعد (ثانية)" hint={`${firstMin} دقيقة من بدء المهمة`}>
                <Input type="number" min="10" step="10" value={form.followup_first_delay_seconds}
                  onChange={(e) => setForm((f) => ({ ...f, followup_first_delay_seconds: e.target.value }))} />
              </Field>
              <Field label="تكرار كل (ثانية)" hint={`كل ${repeatMin} دقيقة بعدها`}>
                <Input type="number" min="10" step="10" value={form.followup_repeat_seconds}
                  onChange={(e) => setForm((f) => ({ ...f, followup_repeat_seconds: e.target.value }))} />
              </Field>
            </div>
            <Field label="الحد الأقصى للرسائل" hint="0 = بلا حد حتى انتهاء المهمة">
              <div className="flex items-center gap-3">
                <Input type="number" min="0" max="50" value={form.followup_max_count}
                  onChange={(e) => setForm((f) => ({ ...f, followup_max_count: e.target.value }))}
                  className="max-w-36" />
                {(form.followup_max_count === '0' || !form.followup_max_count) ? (
                  <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-1 rounded-lg">بلا حد</span>
                ) : (
                  <span className="text-xs text-gray-400">{form.followup_max_count} رسالة كحد أقصى</span>
                )}
              </div>
            </Field>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <SaveButton saving={saving} saved={saved} onClick={handleSave}
          label={useOverride ? 'حفظ الإعدادات المخصصة' : 'إزالة الإعدادات المخصصة'} />
      </div>
    </div>
  )
}

// ─── System Tab ───────────────────────────────────────────────────────────────

function SystemTab({ settings, onSettingsChange, agents = [] }) {
  const [form, setForm] = useState({
    heartbeat_interval_ms:   settings.heartbeat_interval_ms   || '30000',
    stuck_threshold_seconds: settings.stuck_threshold_seconds || '180',
    max_agent_retries:       settings.max_agent_retries       || '3',
    openclaw_bin:            settings.openclaw_bin            || '/opt/homebrew/bin/openclaw',
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [rfForm, setRfForm] = useState({
    task_reformulate_enabled:    settings.task_reformulate_enabled    ?? '1',
    task_reformulate_agent_id:   settings.task_reformulate_agent_id   || '',
    task_reformulate_model:      settings.task_reformulate_model      || 'claude-haiku-4-5-20251001',
    task_reformulate_api_key:    settings.task_reformulate_api_key    || '',
    task_reformulate_timeout_ms: settings.task_reformulate_timeout_ms || '90000',
    task_require_terminal_completion: settings.task_require_terminal_completion ?? '1',
    agent_task_creation_enabled: settings.agent_task_creation_enabled ?? '1',
  })
  const [rfSaving, setRfSaving] = useState(false)
  const [rfSaved,  setRfSaved]  = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  async function handleSave() {
    setSaving(true)
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setSaved(true)
    onSettingsChange(form)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSaveRf() {
    setRfSaving(true)
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rfForm),
    })
    setRfSaving(false); setRfSaved(true)
    onSettingsChange(rfForm)
    setTimeout(() => setRfSaved(false), 2000)
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="مراقبة القلب (Heartbeat)"
        description="إعدادات نظام مراقبة حالة الوكلاء"
        icon={Activity}
      >
        <div className="grid grid-cols-2 gap-6">
          <Field
            label="فترة الفحص (مللي ثانية)"
            hint={`كل ${parseInt(form.heartbeat_interval_ms) / 1000} ثانية يتحقق النظام من حالة الوكلاء`}
          >
            <Input
              type="number"
              step="1000"
              min="5000"
              value={form.heartbeat_interval_ms}
              onChange={(e) => setForm({ ...form, heartbeat_interval_ms: e.target.value })}
            />
          </Field>
          <Field
            label="مهلة عدم الاستجابة الافتراضية (ثانية)"
            hint="يُعتبر الوكيل متوقفاً إذا تجاوز هذه المدة دون نشاط"
          >
            <Input
              type="number"
              min="30"
              value={form.stuck_threshold_seconds}
              onChange={(e) => setForm({ ...form, stuck_threshold_seconds: e.target.value })}
            />
          </Field>
          <Field
            label="الحد الأقصى لمحاولات إعادة التشغيل"
            hint="بعد هذا العدد من المحاولات يُوقف النظام المحاولة ويرسل تنبيه"
          >
            <Input
              type="number"
              min="1"
              max="10"
              value={form.max_agent_retries}
              onChange={(e) => setForm({ ...form, max_agent_retries: e.target.value })}
            />
          </Field>
          <Field
            label="مسار OpenClaw"
            hint="المسار الكامل لملف openclaw في النظام"
          >
            <Input
              value={form.openclaw_bin}
              onChange={(e) => setForm({ ...form, openclaw_bin: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-6 p-4 rounded-xl bg-board-bg/50 border border-board-border/50">
          <p className="text-xs text-gray-500 mb-2 font-medium">ملخص الإعدادات الحالية:</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <span className="text-gray-500">فحص كل: <span className="text-gray-300">{parseInt(form.heartbeat_interval_ms) / 1000}ث</span></span>
            <span className="text-gray-500">عدم استجابة: <span className="text-gray-300">{form.stuck_threshold_seconds}ث</span></span>
            <span className="text-gray-500">محاولات إعادة التشغيل: <span className="text-gray-300">{form.max_agent_retries}</span></span>
            <span className="text-gray-500">openclaw: <span className="text-gray-300 font-mono">{form.openclaw_bin}</span></span>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <SaveButton saving={saving} saved={saved} onClick={handleSave} />
        </div>

        <div className="mt-4 p-3 rounded-lg bg-amber-900/20 border border-amber-800/30">
          <p className="text-xs text-amber-400">
            ⚠ تغيير هذه الإعدادات يسري فوراً على المحاولات القادمة. لا حاجة لإعادة تشغيل الخادم.
          </p>
        </div>
      </SectionCard>

      {/* Task reformulation */}
      <SectionCard
        title="إعادة صياغة المهام تلقائياً"
        description="يستخدم وكيل Claude لإعادة كتابة عنوان ووصف كل مهمة جديدة بشكل واضح ومنظم في الخلفية"
        icon={Sparkles}
      >
        {/* Master toggle */}
        <div className={`flex items-center justify-between p-4 rounded-xl border mb-5 ${rfForm.task_reformulate_enabled !== '0' ? 'bg-indigo-900/20 border-indigo-800/40' : 'bg-board-bg border-board-border'}`}>
          <div>
            <p className="text-sm font-medium text-white">تفعيل إعادة الصياغة</p>
            <p className="text-xs text-gray-500 mt-0.5">كل مهمة جديدة تُرسل إلى وكيل Claude للتحسين في الخلفية</p>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${rfForm.task_reformulate_enabled !== '0' ? 'bg-indigo-600' : 'bg-gray-700'}`}
            onClick={() => setRfForm(f => ({ ...f, task_reformulate_enabled: f.task_reformulate_enabled !== '0' ? '0' : '1' }))}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${rfForm.task_reformulate_enabled !== '0' ? 'left-6' : 'left-1'}`} />
          </div>
        </div>

        <div className={`space-y-4 transition-opacity ${rfForm.task_reformulate_enabled !== '0' ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          {/* Agent selector */}
          <Field
            label="وكيل الصياغة"
            hint="اختر وكيلاً مسجلاً لإعادة الصياغة — أو اتركه على 'مباشر' لاستخدام API مباشرةً"
          >
            <select
              className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              value={rfForm.task_reformulate_agent_id}
              onChange={e => setRfForm(f => ({ ...f, task_reformulate_agent_id: e.target.value }))}
            >
              <option value="">مباشر (عبر API)</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>

          {/* API settings — only when direct mode */}
          {!rfForm.task_reformulate_agent_id && (
            <>
              <Field label="النموذج المستخدم" hint="haiku أسرع وأرخص — sonnet أفضل جودة">
                <select
                  className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                  value={rfForm.task_reformulate_model}
                  onChange={e => setRfForm(f => ({ ...f, task_reformulate_model: e.target.value }))}
                >
                  <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 (سريع)</option>
                  <option value="claude-sonnet-4-6">claude-sonnet-4-6 (جودة عالية)</option>
                  <option value="claude-opus-4-6">claude-opus-4-6 (أعلى جودة)</option>
                </select>
              </Field>

              <Field
                label="مفتاح Anthropic API"
                hint="اتركه فارغاً لاستخدام متغير البيئة ANTHROPIC_API_KEY"
              >
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    placeholder="sk-ant-api..."
                    value={rfForm.task_reformulate_api_key}
                    onChange={e => setRfForm(f => ({ ...f, task_reformulate_api_key: e.target.value }))}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(v => !v)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 text-xs"
                  >
                    {showApiKey ? 'إخفاء' : 'إظهار'}
                  </button>
                </div>
              </Field>
            </>
          )}

          <Field
            label="مهلة الوكيل (مللي ثانية)"
            hint="الوقت الأقصى للانتظار قبل الاستسلام والاحتفاظ بالمحتوى الأصلي"
          >
            <Input
              type="number" min="10000" max="300000" step="5000"
              value={rfForm.task_reformulate_timeout_ms}
              onChange={e => setRfForm(f => ({ ...f, task_reformulate_timeout_ms: e.target.value }))}
            />
          </Field>

          <div className="p-4 rounded-xl bg-board-bg/50 border border-board-border/50 text-xs space-y-2">
            <p className="font-medium text-gray-400">آلية العمل:</p>
            <div className="space-y-1.5 text-gray-500">
              <p>① تُنشأ المهمة <span className="text-white">فوراً</span> بمحتواها الأصلي (لا انتظار)</p>
              <p>② يُرسَل العنوان والوصف إلى {rfForm.task_reformulate_agent_id ? `وكيل "${agents.find(a=>a.id===rfForm.task_reformulate_agent_id)?.name || '...'}"` : 'Claude API'} في الخلفية</p>
              <p>③ يُعيد الوكيل كتابة عنوان أوضح + وصف منظم + خطوات تنفيذية</p>
              <p>④ تُحدَّث المهمة تلقائياً وتظهر على اللوحة</p>
            </div>
            <p className="text-gray-600 mt-2">إذا فشل الوكيل أو انتهت مهلته — يبقى المحتوى الأصلي دون تغيير.</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <SaveButton saving={rfSaving} saved={rfSaved} onClick={handleSaveRf} />
        </div>
      </SectionCard>

      {/* Task completion guard */}
      <SectionCard
        title="حارس إنهاء المهمة"
        description="يمنع الوكيل من الإيقاف حتى ينقل التذكرة إلى حالة نهائية — ويتكلم معه إذا حاول الإنهاء قبل الأوان"
        icon={Bell}
      >
        <div className={`flex items-center justify-between p-4 rounded-xl border mb-4 ${rfForm.task_require_terminal_completion !== '0' ? 'bg-emerald-900/20 border-emerald-800/40' : 'bg-board-bg border-board-border'}`}>
          <div>
            <p className="text-sm font-medium text-white">تفعيل حارس الإنهاء</p>
            <p className="text-xs text-gray-500 mt-0.5">الوكيل لا يتوقف إلا بعد نقل التذكرة إلى حالة نهائية</p>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${rfForm.task_require_terminal_completion !== '0' ? 'bg-emerald-600' : 'bg-gray-700'}`}
            onClick={() => setRfForm(f => ({ ...f, task_require_terminal_completion: f.task_require_terminal_completion !== '0' ? '0' : '1' }))}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${rfForm.task_require_terminal_completion !== '0' ? 'left-6' : 'left-1'}`} />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-board-bg/50 border border-board-border/50 text-xs space-y-2">
          <p className="font-medium text-gray-400">ما الذي يحدث؟</p>
          <div className="space-y-2 text-gray-500">
            <div className="flex gap-2">
              <span className="text-emerald-400 shrink-0">✓</span>
              <p>عندما يُنهي الوكيل ويُرسل إشارة اكتمال — يتحقق النظام من حالة التذكرة</p>
            </div>
            <div className="flex gap-2">
              <span className="text-orange-400 shrink-0">⚠</span>
              <p>إذا لم تكن التذكرة في حالة نهائية (مكتملة / مُسلَّمة...) — يُرسل النظام رسالة للوكيل يطلب منه الاستمرار ونقل التذكرة</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-400 shrink-0">→</span>
              <p>الوكيل يستلم تعليمات واضحة بكيفية نقل التذكرة عبر API ثم إرسال إشعار الإنهاء</p>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Agent task creation */}
      <SectionCard
        title="إنشاء المهام من الوكلاء"
        description="تحكم في صلاحية الوكلاء لفتح مهام جديدة تلقائياً أثناء عملهم"
        icon={Lock}
      >
        <div className={`flex items-center justify-between p-4 rounded-xl border mb-4 ${
          rfForm.agent_task_creation_enabled !== '0'
            ? 'bg-emerald-900/20 border-emerald-800/40'
            : 'bg-red-900/20 border-red-800/40'
        }`}>
          <div>
            <p className="text-sm font-medium text-white">
              {rfForm.agent_task_creation_enabled !== '0' ? '✓ مسموح للوكلاء بفتح مهام' : '✗ محظور على الوكلاء فتح مهام'}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {rfForm.agent_task_creation_enabled !== '0'
                ? 'الوكلاء يستطيعون إنشاء مهام جديدة عبر POST /api/tasks مع agentId'
                : 'أي طلب إنشاء مهمة يحمل agentId سيُرفض بخطأ 403'}
            </p>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
              rfForm.agent_task_creation_enabled !== '0' ? 'bg-emerald-600' : 'bg-red-700'
            }`}
            onClick={() => setRfForm(f => ({
              ...f,
              agent_task_creation_enabled: f.agent_task_creation_enabled !== '0' ? '0' : '1',
            }))}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
              rfForm.agent_task_creation_enabled !== '0' ? 'left-6' : 'left-1'
            }`} />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-board-bg/50 border border-board-border/50 text-xs space-y-2">
          <p className="font-medium text-gray-400">متى تُعطِّل هذا الخيار؟</p>
          <div className="space-y-1.5 text-gray-500">
            <div className="flex gap-2">
              <span className="text-red-400 shrink-0">✗</span>
              <p>عندما لا تريد للوكيل أن يُنشئ مهاماً فرعية بمبادرته الخاصة</p>
            </div>
            <div className="flex gap-2">
              <span className="text-red-400 shrink-0">✗</span>
              <p>عند الحاجة للتحكم الكامل في مصدر المهام (المستخدم فقط)</p>
            </div>
            <div className="flex gap-2">
              <span className="text-emerald-400 shrink-0">✓</span>
              <p>المهام التي يُنشئها المستخدم مباشرة تعمل دائماً بغض النظر عن هذا الإعداد</p>
            </div>
            <div className="flex gap-2">
              <span className="text-blue-400 shrink-0">ℹ</span>
              <p>عند الرفض يُسجَّل الحدث في سجل النظام ويُعاد للوكيل خطأ <code className="text-orange-400 bg-board-bg px-1 rounded">403 agent_task_creation_disabled</code></p>
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <SaveButton saving={rfSaving} saved={rfSaved} onClick={handleSaveRf} />
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Telegram Tab ─────────────────────────────────────────────────────────────

function TelegramTab({ settings, onSettingsChange }) {
  const [form, setForm] = useState({
    telegram_chat_id:      settings.telegram_chat_id      || '',
    telegram_token_doc:    settings.telegram_token_doc    || '',
    telegram_token_adam:   settings.telegram_token_adam   || '',
    telegram_token_khaled: settings.telegram_token_khaled || '',
    telegram_token_yusuf:  settings.telegram_token_yusuf  || '',
  })
  const [followUp, setFollowUp] = useState({
    telegram_followup_enabled:             settings.telegram_followup_enabled !== '0',
    telegram_followup_first_delay_seconds: settings.telegram_followup_first_delay_seconds || '60',
    telegram_followup_repeat_seconds:      settings.telegram_followup_repeat_seconds      || '120',
    telegram_followup_max_count:           settings.telegram_followup_max_count           || '0',
  })
  const [showTokens, setShowTokens]   = useState({})
  const [saving, setSaving]           = useState(false)
  const [saved, setSaved]             = useState(false)
  const [savingFup, setSavingFup]     = useState(false)
  const [savedFup, setSavedFup]       = useState(false)
  const [testResult, setTestResult]   = useState(null)
  const [testing, setTesting]         = useState(false)

  function toggleShow(key) {
    setShowTokens((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  async function handleSave() {
    setSaving(true)
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    setSaved(true)
    onSettingsChange(form)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleSaveFollowUp() {
    setSavingFup(true)
    const payload = {
      ...followUp,
      telegram_followup_enabled: followUp.telegram_followup_enabled ? '1' : '0',
    }
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSavingFup(false)
    setSavedFup(true)
    onSettingsChange(payload)
    setTimeout(() => setSavedFup(false), 2000)
  }

  async function handleTest() {
    if (!form.telegram_chat_id || !form.telegram_token_doc) {
      setTestResult({ ok: false, message: 'أدخل Chat ID وتوكن الـ doc أولاً' })
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch(`https://api.telegram.org/bot${form.telegram_token_doc}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: form.telegram_chat_id,
          text: '✅ Agent Board — اتصال تيليجرام يعمل بنجاح!',
          parse_mode: 'HTML',
        }),
      })
      const data = await res.json()
      setTestResult({ ok: data.ok, message: data.ok ? 'تم الإرسال بنجاح!' : data.description })
    } catch (e) {
      setTestResult({ ok: false, message: e.message })
    } finally {
      setTesting(false)
    }
  }

  const tokenFields = [
    { key: 'telegram_token_doc',    label: 'توكن Doc' },
    { key: 'telegram_token_adam',   label: 'توكن Adam' },
    { key: 'telegram_token_khaled', label: 'توكن Khaled' },
    { key: 'telegram_token_yusuf',  label: 'توكن Yusuf' },
  ]

  const firstDelayMin  = (parseInt(followUp.telegram_followup_first_delay_seconds) / 60).toFixed(1).replace('.0', '')
  const repeatDelayMin = (parseInt(followUp.telegram_followup_repeat_seconds) / 60).toFixed(1).replace('.0', '')

  return (
    <div className="space-y-4">
      {/* Connection settings */}
      <SectionCard title="إعدادات تيليجرام" description="ربط البوت وإعداد الإشعارات" icon={Send}>
        <div className="space-y-4">
          <Field label="Chat ID" hint="معرّف المحادثة التي ستُرسل إليها الإشعارات">
            <Input
              value={form.telegram_chat_id}
              onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })}
              placeholder="مثال: 487211297"
            />
          </Field>

          <div className="border-t border-board-border pt-4">
            <p className="text-xs font-medium text-gray-400 mb-3">توكنات البوتات (واحد لكل وكيل)</p>
            <div className="space-y-3">
              {tokenFields.map(({ key, label }) => (
                <Field key={key} label={label}>
                  <div className="relative">
                    <Input
                      type={showTokens[key] ? 'text' : 'password'}
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      placeholder="123456789:AAAA..."
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShow(key)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    >
                      {showTokens[key] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </Field>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3 flex-wrap">
          <SaveButton saving={saving} saved={saved} onClick={handleSave} />
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-emerald-800 hover:bg-emerald-700 text-emerald-100 transition-colors disabled:opacity-50"
          >
            {testing ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
            {testing ? 'جاري الإرسال…' : 'اختبار الإرسال'}
          </button>
          {testResult && (
            <span className={`flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              {testResult.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              {testResult.message}
            </span>
          )}
        </div>
      </SectionCard>

      {/* Follow-up settings */}
      <SectionCard
        title="إعدادات المتابعة التلقائية"
        description="يرسل الوكيل رسائل دورية للمستخدم أثناء تنفيذ المهام المُسندة من تيليجرام"
        icon={Bell}
      >
        {/* Master toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-board-bg border border-board-border mb-5">
          <div>
            <p className="text-sm font-medium text-white">تفعيل المتابعة التلقائية</p>
            <p className="text-xs text-gray-500 mt-0.5">
              إذا تجاوزت المهمة المدة المحددة، يُرسَل تحديث دوري بحالة التنفيذ
            </p>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${followUp.telegram_followup_enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
            onClick={() => setFollowUp((f) => ({ ...f, telegram_followup_enabled: !f.telegram_followup_enabled }))}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${followUp.telegram_followup_enabled ? 'left-6' : 'left-1'}`} />
          </div>
        </div>

        <div className={`space-y-5 transition-opacity ${followUp.telegram_followup_enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          <div className="grid grid-cols-2 gap-5">
            <Field
              label="تأخير الرسالة الأولى (ثانية)"
              hint={`يُرسل أول تحديث بعد ${firstDelayMin} دقيقة من بدء المهمة`}
            >
              <Input
                type="number"
                min="10"
                step="10"
                value={followUp.telegram_followup_first_delay_seconds}
                onChange={(e) => setFollowUp((f) => ({ ...f, telegram_followup_first_delay_seconds: e.target.value }))}
              />
            </Field>
            <Field
              label="الفاصل بين الرسائل (ثانية)"
              hint={`بعد الرسالة الأولى، يُكرر كل ${repeatDelayMin} دقيقة`}
            >
              <Input
                type="number"
                min="10"
                step="10"
                value={followUp.telegram_followup_repeat_seconds}
                onChange={(e) => setFollowUp((f) => ({ ...f, telegram_followup_repeat_seconds: e.target.value }))}
              />
            </Field>
          </div>

          <Field
            label="الحد الأقصى لعدد رسائل المتابعة"
            hint="0 = بلا حد (حتى انتهاء المهمة) — يُنصح بـ 5–10 للمهام الطويلة"
          >
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min="0"
                max="50"
                value={followUp.telegram_followup_max_count}
                onChange={(e) => setFollowUp((f) => ({ ...f, telegram_followup_max_count: e.target.value }))}
                className="max-w-36"
              />
              {followUp.telegram_followup_max_count === '0' || followUp.telegram_followup_max_count === 0 ? (
                <span className="text-xs text-indigo-400 bg-indigo-900/30 px-2 py-1 rounded-lg">بلا حد</span>
              ) : (
                <span className="text-xs text-gray-400">
                  الوقت الإجمالي ≈{' '}
                  {Math.round(
                    (parseInt(followUp.telegram_followup_first_delay_seconds) +
                      (parseInt(followUp.telegram_followup_max_count) - 1) *
                        parseInt(followUp.telegram_followup_repeat_seconds)) / 60
                  )} دقيقة
                </span>
              )}
            </div>
          </Field>

          {/* Summary card */}
          <div className="p-4 rounded-xl bg-board-bg/50 border border-board-border/50">
            <div className="flex items-center gap-2 mb-3">
              <Clock size={13} className="text-gray-500" />
              <p className="text-xs font-medium text-gray-400">جدول الإرسال:</p>
            </div>
            <div className="space-y-1.5 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                الرسالة الأولى بعد: <span className="text-gray-300">{parseInt(followUp.telegram_followup_first_delay_seconds)}ث ({firstDelayMin} دقيقة)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                ثم كل: <span className="text-gray-300">{parseInt(followUp.telegram_followup_repeat_seconds)}ث ({repeatDelayMin} دقيقة)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-300 shrink-0" />
                الحد الأقصى: <span className="text-gray-300">
                  {followUp.telegram_followup_max_count === '0' || followUp.telegram_followup_max_count === 0
                    ? 'بلا حد'
                    : `${followUp.telegram_followup_max_count} رسالة`}
                </span>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-board-border/40 mt-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                عند الانتهاء: <span className="text-gray-300">رسالة إكمال تلقائية دائماً</span>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <SaveButton saving={savingFup} saved={savedFup} onClick={handleSaveFollowUp} />
        </div>

        <div className="mt-3 p-3 rounded-lg bg-blue-900/20 border border-blue-800/30">
          <p className="text-xs text-blue-400">
            💡 تسري هذه الإعدادات فوراً على المهام الجارية — لا حاجة لإعادة التشغيل.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Database Tab ─────────────────────────────────────────────────────────────

function DatabaseTab() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(null)
  const [messages, setMessages] = useState([])

  const loadStats = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`${API}/settings/stats`)
    const data = await res.json()
    setStats(data.counts)
    setLoading(false)
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  function addMessage(text, ok = true) {
    const id = Date.now()
    setMessages((m) => [...m, { id, text, ok }])
    setTimeout(() => setMessages((m) => m.filter((x) => x.id !== id)), 4000)
  }

  async function clearDone() {
    if (!confirm('حذف جميع المهام المكتملة؟ لا يمكن التراجع.')) return
    setClearing('done')
    const res = await fetch(`${API}/settings/tasks/done`, { method: 'DELETE' })
    const data = await res.json()
    addMessage(`تم حذف ${data.deleted} مهمة مكتملة`)
    await loadStats()
    setClearing(null)
  }

  async function clearEvents() {
    if (!confirm('مسح سجل الأحداث؟ لا يمكن التراجع.')) return
    setClearing('events')
    await fetch(`${API}/settings/events`, { method: 'DELETE' })
    addMessage('تم مسح سجل الأحداث')
    await loadStats()
    setClearing(null)
  }

  const statItems = stats ? [
    { label: 'إجمالي المهام', value: stats.total_tasks, color: 'text-white' },
    { label: 'قيد التنفيذ', value: stats.active_tasks, color: 'text-blue-400' },
    { label: 'في الانتظار', value: stats.queued_tasks, color: 'text-gray-400' },
    { label: 'متوقفة', value: stats.blocked_tasks, color: 'text-orange-400' },
    { label: 'مكتملة', value: stats.done_tasks, color: 'text-emerald-400' },
    { label: 'الوكلاء', value: stats.total_agents, color: 'text-indigo-400' },
    { label: 'مشغولون', value: stats.busy_agents, color: 'text-blue-400' },
    { label: 'سجلات الوكيل', value: stats.total_logs, color: 'text-gray-300' },
    { label: 'التعليقات', value: stats.total_comments, color: 'text-gray-300' },
    { label: 'الأحداث', value: stats.total_events, color: 'text-gray-300' },
  ] : []

  return (
    <div className="space-y-4">
      {/* Stats */}
      <SectionCard title="إحصائيات قاعدة البيانات" icon={Database}>
        {loading ? (
          <div className="flex justify-center py-8"><RefreshCw size={20} className="animate-spin text-gray-500" /></div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3 mb-4">
              {statItems.map((s) => (
                <div key={s.label} className="bg-board-bg rounded-xl p-3 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
            <button
              onClick={loadStats}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              <RefreshCw size={12} />
              تحديث
            </button>
          </>
        )}
      </SectionCard>

      {/* Toast messages */}
      {messages.map((m) => (
        <div key={m.id} className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm ${m.ok ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-800/40' : 'bg-red-900/40 text-red-300 border border-red-800/40'}`}>
          <CheckCircle2 size={14} />
          {m.text}
        </div>
      ))}

      {/* Danger zone */}
      <SectionCard title="منطقة الخطر" description="إجراءات لا يمكن التراجع عنها" icon={AlertTriangle}>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 rounded-xl bg-board-bg border border-board-border">
            <div>
              <p className="text-sm font-medium text-white">حذف المهام المكتملة</p>
              <p className="text-xs text-gray-500 mt-0.5">
                يحذف {stats?.done_tasks ?? 0} مهمة مكتملة من قاعدة البيانات
              </p>
            </div>
            <button
              onClick={clearDone}
              disabled={clearing === 'done' || !stats?.done_tasks}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-red-900/50 hover:bg-red-900 text-red-300 border border-red-800/50 disabled:opacity-40 transition-colors"
            >
              {clearing === 'done' ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
              حذف
            </button>
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-board-bg border border-board-border">
            <div>
              <p className="text-sm font-medium text-white">مسح سجل الأحداث</p>
              <p className="text-xs text-gray-500 mt-0.5">
                يحذف {stats?.total_events ?? 0} حدث من سجل النظام
              </p>
            </div>
            <button
              onClick={clearEvents}
              disabled={clearing === 'events' || !stats?.total_events}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-red-900/50 hover:bg-red-900 text-red-300 border border-red-800/50 disabled:opacity-40 transition-colors"
            >
              {clearing === 'events' ? <RefreshCw size={13} className="animate-spin" /> : <Trash2 size={13} />}
              مسح
            </button>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Statuses Tab ─────────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
  'slate','blue','indigo','purple','pink','rose','red',
  'orange','amber','yellow','lime','green','emerald','teal','cyan','sky',
]

const COLOR_PREVIEW = {
  slate: 'bg-slate-500', blue: 'bg-blue-500', indigo: 'bg-indigo-500',
  purple: 'bg-purple-500', pink: 'bg-pink-500', rose: 'bg-rose-500',
  red: 'bg-red-500', orange: 'bg-orange-500', amber: 'bg-amber-500',
  yellow: 'bg-yellow-500', lime: 'bg-lime-500', green: 'bg-green-500',
  emerald: 'bg-emerald-500', teal: 'bg-teal-500', cyan: 'bg-cyan-500',
  sky: 'bg-sky-500',
}

const DEFAULT_TRIGGER_MSG = `[حالة جديدة: {status_label}]

مهمتك "{task_title}" انتقلت إلى حالة "{status_label}".
يرجى العمل عليها وفق الحالة الجديدة.

الوصف: {task_description}
الأولوية: {priority}
TASK_ID: {task_id}`

function StatusesTab({ statuses }) {
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [newStatus, setNewStatus] = useState({
    label: '', color: 'slate', is_terminal: false,
    trigger_enabled: false, trigger_message: DEFAULT_TRIGGER_MSG,
  })

  async function handleAdd(e) {
    e.preventDefault()
    if (!newStatus.label.trim()) return
    setSaving(true)
    await fetch(`${API}/statuses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newStatus),
    })
    setNewStatus({ label: '', color: 'slate', is_terminal: false, trigger_enabled: false, trigger_message: DEFAULT_TRIGGER_MSG })
    setShowAdd(false)
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('حذف هذه الحالة؟ المهام بهذه الحالة لن تُحذف.')) return
    await fetch(`${API}/statuses/${id}`, { method: 'DELETE' })
  }

  return (
    <div className="space-y-4">
      {/* Add status */}
      <SectionCard title="إضافة حالة جديدة" description="أنشئ حالات مخصصة لسير العمل مع إمكانية تشغيل الوكيل تلقائياً" icon={Plus}>
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            <Plus size={14} />
            إضافة حالة
          </button>
        ) : (
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="اسم الحالة *">
                <Input
                  placeholder="مثال: قيد المراجعة"
                  value={newStatus.label}
                  onChange={(e) => setNewStatus({ ...newStatus, label: e.target.value })}
                  required autoFocus
                />
              </Field>
              <Field label="اللون">
                <div className="flex flex-wrap gap-2 mt-1">
                  {COLOR_OPTIONS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setNewStatus({ ...newStatus, color: c })}
                      className={`w-6 h-6 rounded-full ${COLOR_PREVIEW[c]} transition-all ${newStatus.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-board-card scale-110' : 'opacity-60 hover:opacity-100'}`}
                      title={c}
                    />
                  ))}
                </div>
              </Field>
            </div>

            {/* Flags */}
            <div className="flex gap-4 flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  className={`w-9 h-5 rounded-full transition-colors relative ${newStatus.is_terminal ? 'bg-emerald-600' : 'bg-gray-700'}`}
                  onClick={() => setNewStatus({ ...newStatus, is_terminal: !newStatus.is_terminal })}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${newStatus.is_terminal ? 'left-4' : 'left-0.5'}`} />
                </div>
                <span className="text-sm text-gray-300">حالة نهائية (تُحرّر الوكيل)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  className={`w-9 h-5 rounded-full transition-colors relative ${newStatus.trigger_enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                  onClick={() => setNewStatus({ ...newStatus, trigger_enabled: !newStatus.trigger_enabled })}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${newStatus.trigger_enabled ? 'left-4' : 'left-0.5'}`} />
                </div>
                <span className="text-sm text-gray-300">⚡ تشغيل الوكيل عند الانتقال لهذه الحالة</span>
              </label>
            </div>

            {/* Trigger message */}
            {newStatus.trigger_enabled && (
              <Field label="رسالة التشغيل" hint="المتغيرات المتاحة: {task_title}, {task_description}, {task_id}, {status_label}, {priority}">
                <textarea
                  value={newStatus.trigger_message}
                  onChange={(e) => setNewStatus({ ...newStatus, trigger_message: e.target.value })}
                  rows={5}
                  className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono resize-y"
                />
              </Field>
            )}

            <div className="flex gap-2">
              <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors">إلغاء</button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
                {saving ? <RefreshCw size={13} className="animate-spin" /> : <Plus size={13} />}
                {saving ? 'جاري الإضافة…' : 'إضافة'}
              </button>
            </div>
          </form>
        )}
      </SectionCard>

      {/* Statuses list */}
      <SectionCard title={`الحالات المعرّفة (${statuses?.length ?? 0})`} description="الترتيب يحدد ترتيب أعمدة اللوحة" icon={Layers}>
        <div className="space-y-2">
          {(statuses || []).map((status) => (
            <StatusRow
              key={status.id}
              status={status}
              isEditing={editingId === status.id}
              onEdit={() => setEditingId(editingId === status.id ? null : status.id)}
              onDelete={() => handleDelete(status.id)}
              onSaved={() => setEditingId(null)}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

function StatusRow({ status, isEditing, onEdit, onDelete, onSaved }) {
  const [form, setForm] = useState({
    label:           status.label,
    color:           status.color,
    position:        status.position,
    is_terminal:     !!status.is_terminal,
    trigger_enabled: !!status.trigger_enabled,
    trigger_message: status.trigger_message || DEFAULT_TRIGGER_MSG,
  })
  const [saving, setSaving] = useState(false)
  const dot = COLOR_PREVIEW[status.color] || 'bg-slate-500'

  async function handleSave() {
    setSaving(true)
    await fetch(`${API}/statuses/${status.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    setSaving(false)
    onSaved()
  }

  return (
    <div className="border border-board-border rounded-xl overflow-hidden">
      {/* Row header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-board-bg/50">
        <span className={`w-3 h-3 rounded-full shrink-0 ${dot}`} />
        <div className="flex-1 flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-white">{status.label}</span>
          <span className="text-xs text-gray-600 font-mono">#{status.id}</span>
          {status.is_system ? (
            <span className="flex items-center gap-1 text-xs text-gray-600"><Lock size={10} /> نظام</span>
          ) : null}
          {status.trigger_enabled ? (
            <span className="flex items-center gap-1 text-xs text-indigo-400 bg-indigo-900/30 px-1.5 py-0.5 rounded-md">
              <Zap size={10} /> trigger
            </span>
          ) : null}
          {status.is_terminal ? (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded-md">
              ✓ نهائية
            </span>
          ) : null}
        </div>
        <span className="text-xs text-gray-600">ترتيب: {status.position}</span>
        <button
          onClick={onEdit}
          className={`p-2 rounded-lg transition-colors ${isEditing ? 'text-indigo-400 bg-indigo-900/30' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}
        >
          <Pencil size={13} />
        </button>
        {!status.is_system && (
          <button onClick={onDelete} className="p-2 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors">
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Edit form */}
      {isEditing && (
        <div className="px-4 py-4 border-t border-board-border/50 bg-board-bg/30 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="الاسم">
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                disabled={status.is_system}
              />
            </Field>
            <Field label="الترتيب (رقم)">
              <Input
                type="number"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: parseInt(e.target.value) || 0 })}
              />
            </Field>
          </div>

          <Field label="اللون">
            <div className="flex flex-wrap gap-2 mt-1">
              {COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, color: c })}
                  className={`w-6 h-6 rounded-full ${COLOR_PREVIEW[c]} transition-all ${form.color === c ? 'ring-2 ring-white ring-offset-2 ring-offset-board-card scale-110' : 'opacity-60 hover:opacity-100'}`}
                  title={c}
                />
              ))}
            </div>
          </Field>

          <div className="flex gap-4 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                className={`w-9 h-5 rounded-full transition-colors relative ${form.is_terminal ? 'bg-emerald-600' : 'bg-gray-700'}`}
                onClick={() => !status.is_system && setForm({ ...form, is_terminal: !form.is_terminal })}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.is_terminal ? 'left-4' : 'left-0.5'}`} />
              </div>
              <span className="text-sm text-gray-300">حالة نهائية</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <div
                className={`w-9 h-5 rounded-full transition-colors relative ${form.trigger_enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
                onClick={() => setForm({ ...form, trigger_enabled: !form.trigger_enabled })}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${form.trigger_enabled ? 'left-4' : 'left-0.5'}`} />
              </div>
              <span className="text-sm text-gray-300">⚡ تشغيل الوكيل تلقائياً</span>
            </label>
          </div>

          {form.trigger_enabled && (
            <Field label="رسالة التشغيل" hint="{task_title}, {task_description}, {task_id}, {status_label}, {priority}">
              <textarea
                value={form.trigger_message}
                onChange={(e) => setForm({ ...form, trigger_message: e.target.value })}
                rows={6}
                className="w-full bg-board-bg border border-board-border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500 font-mono resize-y"
              />
            </Field>
          )}

          <div className="flex gap-2">
            <button onClick={onEdit} className="px-3 py-1.5 rounded-lg text-xs text-gray-400 hover:text-white hover:bg-white/10 transition-colors">إلغاء</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 transition-colors">
              {saving ? <RefreshCw size={12} className="animate-spin" /> : <Save size={12} />}
              {saving ? 'جاري الحفظ…' : 'حفظ'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Monitoring Tab ───────────────────────────────────────────────────────────

function MonitoringTab({ settings, onSettingsChange, agents }) {
  const [form, setForm] = useState({
    monitor_enabled:            settings?.monitor_enabled            ?? '1',
    monitor_interval_seconds:   settings?.monitor_interval_seconds   ?? '30',
    monitor_process_check:      settings?.monitor_process_check      ?? '1',
    monitor_file_check:         settings?.monitor_file_check         ?? '1',
    monitor_file_stale_seconds: settings?.monitor_file_stale_seconds ?? '120',
    monitor_process_pattern:    settings?.monitor_process_pattern    ?? 'openclaw.*--agent',
    monitor_notify_stuck:       settings?.monitor_notify_stuck       ?? '1',
    monitor_notify_offline:     settings?.monitor_notify_offline     ?? '1',
    monitor_notify_recovery:    settings?.monitor_notify_recovery    ?? '0',
  })
  // Auto-resume settings (heartbeat monitor)
  const [hbForm, setHbForm] = useState({
    stuck_threshold_seconds: settings?.stuck_threshold_seconds ?? '180',
    heartbeat_interval_ms:   settings?.heartbeat_interval_ms   ?? '30000',
    max_agent_retries:       settings?.max_agent_retries       ?? '3',
  })
  const [savingHb, setSavingHb]   = useState(false)
  const [savedHb, setSavedHb]     = useState(false)
  const [saving, setSaving]       = useState(false)
  const [saved, setSaved]         = useState(false)
  const [checking, setChecking]   = useState(false)
  const [results, setResults]     = useState(null)
  const [lastChecked, setLastChecked] = useState(null)
  // Manual action state per agent
  const [actionState, setActionState] = useState({}) // agentId → { loading, result }

  // Load latest results on mount
  useEffect(() => {
    fetch(`${API}/monitor`).then(r => r.json()).then(d => {
      if (d.results?.length) { setResults(d.results); setLastChecked(Date.now()) }
    }).catch(() => {})
  }, [])

  const enabled = form.monitor_enabled !== '0'

  async function handleSave() {
    setSaving(true)
    const payload = {
      ...form,
      monitor_enabled:       form.monitor_enabled === true || form.monitor_enabled !== '0' ? '1' : '0',
      monitor_process_check: form.monitor_process_check === true || form.monitor_process_check !== '0' ? '1' : '0',
      monitor_file_check:    form.monitor_file_check === true || form.monitor_file_check !== '0' ? '1' : '0',
      monitor_notify_stuck:     form.monitor_notify_stuck !== '0' ? '1' : '0',
      monitor_notify_offline:   form.monitor_notify_offline !== '0' ? '1' : '0',
      monitor_notify_recovery:  form.monitor_notify_recovery !== '0' ? '1' : '0',
    }
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false); setSaved(true)
    onSettingsChange(payload)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleCheckNow() {
    setChecking(true)
    try {
      const r = await fetch(`${API}/monitor/check`, { method: 'POST' })
      const d = await r.json()
      setResults(d.results)
      setLastChecked(d.checkedAt)
    } catch {}
    setChecking(false)
  }

  async function handleSaveHb() {
    setSavingHb(true)
    const payload = {
      stuck_threshold_seconds: hbForm.stuck_threshold_seconds,
      heartbeat_interval_ms:   hbForm.heartbeat_interval_ms,
      max_agent_retries:       hbForm.max_agent_retries,
    }
    await fetch(`${API}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSavingHb(false); setSavedHb(true)
    onSettingsChange(payload)
    setTimeout(() => setSavedHb(false), 2000)
  }

  async function handleAgentAction(agentId, action) {
    setActionState(s => ({ ...s, [agentId]: { loading: action, result: null } }))
    try {
      const r = await fetch(`${API}/agents/${agentId}/${action}`, { method: 'POST' })
      const d = await r.json()
      setActionState(s => ({ ...s, [agentId]: { loading: null, result: d.ok ? 'ok' : (d.error || 'error') } }))
      setTimeout(() => setActionState(s => ({ ...s, [agentId]: { loading: null, result: null } })), 3000)
    } catch (e) {
      setActionState(s => ({ ...s, [agentId]: { loading: null, result: 'error' } }))
      setTimeout(() => setActionState(s => ({ ...s, [agentId]: { loading: null, result: null } })), 3000)
    }
  }

  function Toggle({ fieldKey, label, hint }) {
    const on = form[fieldKey] !== '0'
    return (
      <div className="flex items-center justify-between py-3 border-b border-board-border/30 last:border-0">
        <div>
          <p className="text-sm text-white">{label}</p>
          {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
        </div>
        <div
          className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${on ? 'bg-indigo-600' : 'bg-gray-700'}`}
          onClick={() => setForm(f => ({ ...f, [fieldKey]: on ? '0' : '1' }))}
        >
          <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${on ? 'left-5' : 'left-1'}`} />
        </div>
      </div>
    )
  }

  // Status info helpers
  function processIcon(alive) {
    if (alive === true)  return <span className="text-emerald-400 text-xs flex items-center gap-1"><Cpu size={11} /> نشط</span>
    if (alive === false) return <span className="text-red-400 text-xs flex items-center gap-1"><Cpu size={11} /> متوقف</span>
    return <span className="text-gray-500 text-xs">—</span>
  }

  function fileIcon(r) {
    if (r.lastFileActivity === null) return <span className="text-gray-600 text-xs flex items-center gap-1"><FileText size={11} /> لا ملفات</span>
    if (r.fileStale) return <span className="text-orange-400 text-xs flex items-center gap-1"><FileText size={11} /> {r.fileIdleSeconds}ث</span>
    return <span className="text-emerald-400 text-xs flex items-center gap-1"><FileText size={11} /> {r.fileIdleSeconds}ث</span>
  }

  const STATUS_BADGE = {
    idle:    'bg-emerald-900/40 text-emerald-300 border-emerald-800/40',
    busy:    'bg-blue-900/40 text-blue-300 border-blue-800/40',
    stuck:   'bg-orange-900/40 text-orange-300 border-orange-800/40',
    offline: 'bg-gray-800/60 text-gray-500 border-gray-700/40',
  }
  const STATUS_LABEL = { idle: 'متاح', busy: 'يعمل', stuck: 'متوقف', offline: 'غير متصل' }

  return (
    <div className="space-y-4">
      {/* Live Dashboard */}
      <SectionCard title="لوحة مراقبة الوكلاء" description="الحالة الفعلية لكل وكيل بناءً على آخر فحص" icon={Radar}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-xs text-gray-500">
            {lastChecked
              ? `آخر فحص: ${new Date(lastChecked).toLocaleTimeString('ar-EG')}`
              : 'لم يتم الفحص بعد'}
          </div>
          <button
            onClick={handleCheckNow}
            disabled={checking}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            {checking ? <RefreshCw size={12} className="animate-spin" /> : <Radar size={12} />}
            {checking ? 'جارٍ الفحص…' : 'فحص الآن'}
          </button>
        </div>

        {/* Agent status grid */}
        {agents.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-6">لا يوجد وكلاء مسجلون</p>
        ) : (
          <div className="space-y-2">
            {agents.map(agent => {
              const r = results?.find(x => x.agentId === agent.id)
              const badge = STATUS_BADGE[agent.status] || STATUS_BADGE.offline
              return (
                <div key={agent.id} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-board-border bg-board-bg/40">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    agent.status === 'idle'    ? 'bg-emerald-400' :
                    agent.status === 'busy'    ? 'bg-blue-400 animate-pulse' :
                    agent.status === 'stuck'   ? 'bg-orange-400 animate-pulse' : 'bg-gray-600'
                  }`} />
                  <span className="text-sm font-medium text-white w-20 shrink-0">{agent.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${badge}`}>
                    {STATUS_LABEL[agent.status] || agent.status}
                  </span>
                  <div className="flex items-center gap-3 ml-auto text-xs flex-wrap justify-end">
                    {r ? (
                      <>
                        {processIcon(r.processAlive)}
                        {fileIcon(r)}
                        {r.changed && (
                          <span className="text-indigo-400 bg-indigo-900/30 px-1.5 py-0.5 rounded text-xs">
                            {r.status} → {r.newStatus}
                          </span>
                        )}
                        {r.error && (
                          <span className="text-red-400 text-xs">{r.error}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-600 text-xs">لا بيانات فحص</span>
                    )}
                    {agent.last_heartbeat && (
                      <span className="text-gray-600">
                        نبضة: {Math.round((Date.now() - agent.last_heartbeat) / 1000)}ث
                      </span>
                    )}
                    {/* Manual action buttons */}
                    {(() => {
                      const as = actionState[agent.id]
                      const loading = as?.loading
                      const result  = as?.result
                      return (
                        <div className="flex items-center gap-1.5">
                          {result === 'ok' && <span className="text-emerald-400 text-xs">✓ تم</span>}
                          {result && result !== 'ok' && <span className="text-red-400 text-xs">✗ {result}</span>}
                          {(agent.status === 'busy' || agent.status === 'stuck') && (
                            <button
                              onClick={() => handleAgentAction(agent.id, 'resume')}
                              disabled={!!loading}
                              className="px-2 py-1 rounded-md text-xs bg-emerald-900/40 hover:bg-emerald-900/70 text-emerald-300 border border-emerald-800/40 disabled:opacity-50 transition-colors"
                            >
                              {loading === 'resume' ? <RefreshCw size={10} className="animate-spin inline" /> : 'انعاش ناعم'}
                            </button>
                          )}
                          {(agent.status === 'busy' || agent.status === 'stuck') && (
                            <button
                              onClick={() => handleAgentAction(agent.id, 'restart')}
                              disabled={!!loading}
                              className="px-2 py-1 rounded-md text-xs bg-orange-900/40 hover:bg-orange-900/70 text-orange-300 border border-orange-800/40 disabled:opacity-50 transition-colors"
                            >
                              {loading === 'restart' ? <RefreshCw size={10} className="animate-spin inline" /> : 'إعادة تشغيل'}
                            </button>
                          )}
                          {agent.status !== 'offline' && (
                            <button
                              onClick={() => handleAgentAction(agent.id, 'kill')}
                              disabled={!!loading}
                              className="px-2 py-1 rounded-md text-xs bg-red-900/30 hover:bg-red-900/60 text-red-400 border border-red-800/40 disabled:opacity-50 transition-colors"
                            >
                              {loading === 'kill' ? <RefreshCw size={10} className="animate-spin inline" /> : 'إيقاف'}
                            </button>
                          )}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* Auto-resume settings */}
      <SectionCard title="إعدادات الانعاش التلقائي" description="حدد متى يتدخل النظام لإنعاش الوكيل العالق دون تدخل يدوي" icon={RefreshCw}>
        <div className="grid grid-cols-3 gap-4 mb-5">
          <Field label="مهلة التوقف (ثانية)" hint="كم ثانية بدون نبضة قبل اعتبار الوكيل عالقاً">
            <Input type="number" min="30" max="3600" step="30"
              value={hbForm.stuck_threshold_seconds}
              onChange={e => setHbForm(f => ({ ...f, stuck_threshold_seconds: e.target.value }))} />
          </Field>
          <Field label="فترة فحص النبضات (مللي ثانية)" hint="كم مرة في الثانية يتحقق النظام من النبضات">
            <Input type="number" min="5000" max="300000" step="5000"
              value={hbForm.heartbeat_interval_ms}
              onChange={e => setHbForm(f => ({ ...f, heartbeat_interval_ms: e.target.value }))} />
          </Field>
          <Field label="عدد المحاولات القصوى" hint="عدد محاولات الانعاش قبل إيقاف الوكيل نهائياً">
            <Input type="number" min="1" max="10" step="1"
              value={hbForm.max_agent_retries}
              onChange={e => setHbForm(f => ({ ...f, max_agent_retries: e.target.value }))} />
          </Field>
        </div>

        {/* Retry escalation timeline */}
        <div className="p-4 rounded-xl bg-board-bg/50 border border-board-border/50 mb-4">
          <p className="text-xs font-medium text-gray-400 mb-3">مسار الانعاش التلقائي:</p>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-orange-900/60 border border-orange-700/50 flex items-center justify-center text-xs text-orange-300 font-bold">1</span>
              <div>
                <p className="text-xs text-white">انعاش ناعم</p>
                <p className="text-xs text-gray-600">رسالة للسشن الحالية</p>
              </div>
            </div>
            <div className="h-px w-8 bg-board-border/60 shrink-0" />
            {Array.from({ length: Math.max(0, parseInt(hbForm.max_agent_retries || 3) - 2) }, (_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-red-900/60 border border-red-700/50 flex items-center justify-center text-xs text-red-300 font-bold">{i + 2}</span>
                <div>
                  <p className="text-xs text-white">إعادة تشغيل</p>
                  <p className="text-xs text-gray-600">إيقاف وبدء جديد</p>
                </div>
                <div className="h-px w-8 bg-board-border/60 shrink-0" />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gray-700/80 border border-gray-600/50 flex items-center justify-center text-xs text-gray-400 font-bold">✕</span>
              <div>
                <p className="text-xs text-white">الاستسلام</p>
                <p className="text-xs text-gray-600">وضع خارج الخدمة + تنبيه تيليجرام</p>
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-3">
            يتوقع النظام بين كل محاولة وأخرى {hbForm.stuck_threshold_seconds} ثانية بدون نبضة قبل الانتقال للمحاولة التالية.
          </p>
        </div>

        <div className="flex justify-end">
          <SaveButton saving={savingHb} saved={savedHb} onClick={handleSaveHb} />
        </div>
      </SectionCard>

      {/* Monitor settings */}
      <SectionCard title="إعدادات المراقبة" description="تحكم كامل في آلية الفحص الدوري للوكلاء" icon={Settings}>
        {/* Master toggle */}
        <div className={`flex items-center justify-between p-4 rounded-xl border mb-4 ${enabled ? 'bg-indigo-900/20 border-indigo-800/40' : 'bg-board-bg border-board-border'}`}>
          <div>
            <p className="text-sm font-medium text-white">تفعيل المراقبة التلقائية</p>
            <p className="text-xs text-gray-500 mt-0.5">فحص دوري لحالة كل وكيل</p>
          </div>
          <div
            className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${enabled ? 'bg-indigo-600' : 'bg-gray-700'}`}
            onClick={() => setForm(f => ({ ...f, monitor_enabled: enabled ? '0' : '1' }))}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${enabled ? 'left-6' : 'left-1'}`} />
          </div>
        </div>

        <div className={`space-y-5 transition-opacity ${enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
          {/* Timing */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">التوقيت</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="فترة الفحص (ثانية)" hint={`يفحص كل ${form.monitor_interval_seconds} ثانية تلقائياً`}>
                <Input type="number" min="5" max="300" step="5"
                  value={form.monitor_interval_seconds}
                  onChange={e => setForm(f => ({ ...f, monitor_interval_seconds: e.target.value }))} />
              </Field>
              <Field label="مهلة تجمد الملفات (ثانية)"
                hint="عدم كتابة الملف لهذه المدة = وكيل متوقف">
                <Input type="number" min="30" step="10"
                  value={form.monitor_file_stale_seconds}
                  onChange={e => setForm(f => ({ ...f, monitor_file_stale_seconds: e.target.value }))} />
              </Field>
            </div>
          </div>

          {/* Check layers */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">طبقات الفحص</p>
            <div className="bg-board-bg/40 rounded-xl border border-board-border/50 px-4 divide-y divide-board-border/30">
              <Toggle
                fieldKey="monitor_process_check"
                label="فحص العمليات (Process Check)"
                hint="يستخدم pgrep للتحقق من أن الوكيل يعمل فعلياً كعملية في النظام"
              />
              <Toggle
                fieldKey="monitor_file_check"
                label="فحص نشاط الملفات (File Activity)"
                hint="يراقب وقت آخر تعديل على ملفات السشن للكشف عن التجمد"
              />
            </div>
          </div>

          {/* Process pattern */}
          {form.monitor_process_check !== '0' && (
            <Field label="نمط البحث عن العملية (Regex)"
              hint="يُستخدم مع pgrep -f — مثال: openclaw.*--agent">
              <Input
                value={form.monitor_process_pattern}
                onChange={e => setForm(f => ({ ...f, monitor_process_pattern: e.target.value }))}
                placeholder="openclaw.*--agent"
                className="font-mono text-sm"
              />
            </Field>
          )}

          {/* Notifications */}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">إشعارات تيليجرام</p>
            <div className="bg-board-bg/40 rounded-xl border border-board-border/50 px-4 divide-y divide-board-border/30">
              <Toggle
                fieldKey="monitor_notify_stuck"
                label="إشعار عند التوقف"
                hint="يرسل رسالة تيليجرام عند اكتشاف تجمد الوكيل"
              />
              <Toggle
                fieldKey="monitor_notify_offline"
                label="إشعار عند الانقطاع المفاجئ"
                hint="يرسل رسالة عند اكتشاف أن العملية انتهت بشكل غير متوقع"
              />
              <Toggle
                fieldKey="monitor_notify_recovery"
                label="إشعار عند الاستئناف التلقائي"
                hint="يرسل رسالة عند عودة الوكيل للعمل تلقائياً"
              />
            </div>
          </div>

          {/* Summary */}
          <div className="p-4 rounded-xl bg-board-bg/50 border border-board-border/50 text-xs space-y-1.5">
            <p className="font-medium text-gray-400 mb-2">ملخص الإعداد الحالي:</p>
            <p className="text-gray-600">الفحص كل: <span className="text-gray-300">{form.monitor_interval_seconds} ثانية</span></p>
            {form.monitor_process_check !== '0' && (
              <p className="text-gray-600">فحص العمليات: <span className="text-emerald-400">مفعّل</span> — نمط: <span className="text-gray-300 font-mono">{form.monitor_process_pattern}</span></p>
            )}
            {form.monitor_file_check !== '0' && (
              <p className="text-gray-600">فحص الملفات: <span className="text-emerald-400">مفعّل</span> — تجمد بعد: <span className="text-gray-300">{form.monitor_file_stale_seconds}ث</span></p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <SaveButton saving={saving} saved={saved} onClick={handleSave} />
        </div>

        <div className="mt-3 p-3 rounded-lg bg-blue-900/20 border border-blue-800/30">
          <p className="text-xs text-blue-400">
            💡 تغيير الإعداد يسري على الدورة القادمة تلقائياً — لا حاجة لإعادة تشغيل الخادم.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'agents',     label: 'الوكلاء',        icon: Bot },
  { id: 'monitoring', label: 'المراقبة',        icon: Radar },
  { id: 'statuses',   label: 'الحالات',         icon: Layers },
  { id: 'system',     label: 'النظام',          icon: Settings },
  { id: 'telegram',   label: 'تيليجرام',        icon: Send },
  { id: 'database',   label: 'قاعدة البيانات',  icon: Database },
]

export default function SettingsPage({ agents, tasks, statuses, onRefreshAgents }) {
  const [tab, setTab] = useState('agents')
  const [settings, setSettings] = useState(null)
  const [loadingSettings, setLoadingSettings] = useState(true)

  useEffect(() => {
    fetch(`${API}/settings`)
      .then((r) => r.json())
      .then((data) => { setSettings(data); setLoadingSettings(false) })
      .catch(() => setLoadingSettings(false))
  }, [])

  function handleSettingsChange(updates) {
    setSettings((prev) => ({ ...prev, ...updates }))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="flex items-center gap-4 px-6 py-4 border-b border-board-border bg-board-surface shrink-0">
        <Settings size={18} className="text-indigo-400" />
        <h2 className="text-base font-semibold text-white">الإعدادات</h2>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-6 py-3 border-b border-board-border bg-board-surface shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              tab === id
                ? 'bg-indigo-700 text-white'
                : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {tab === 'agents' && (
          <AgentsTab agents={agents} tasks={tasks} globalSettings={settings} onRefresh={onRefreshAgents} />
        )}
        {tab === 'monitoring' && (
          loadingSettings
            ? <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-gray-500" /></div>
            : <MonitoringTab settings={settings} onSettingsChange={handleSettingsChange} agents={agents} />
        )}
        {tab === 'statuses' && (
          <StatusesTab statuses={statuses} />
        )}
        {tab === 'system' && (
          loadingSettings
            ? <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-gray-500" /></div>
            : <SystemTab settings={settings} onSettingsChange={handleSettingsChange} agents={agents} />
        )}
        {tab === 'telegram' && (
          loadingSettings
            ? <div className="flex justify-center py-16"><RefreshCw size={20} className="animate-spin text-gray-500" /></div>
            : <TelegramTab settings={settings} onSettingsChange={handleSettingsChange} />
        )}
        {tab === 'database' && <DatabaseTab />}
      </div>
    </div>
  )
}
