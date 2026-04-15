import React, { useState, useEffect, useCallback, useReducer } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import KanbanBoard from './components/KanbanBoard'
import AgentStatus from './components/AgentStatus'
import AddTaskModal from './components/AddTaskModal'
import LiveMonitor from './components/LiveMonitor'
import SettingsPage from './components/SettingsPage'
import QueueDashboard from './components/QueueDashboard'
import { Plus, Activity, RefreshCw, Terminal, LayoutDashboard, Settings, ListTodo, Wifi, WifiOff } from 'lucide-react'

const API = '/api'

function appReducer(state, action) {
  switch (action.type) {
    case 'SNAPSHOT':
      return {
        ...state,
        tasks: action.tasks,
        agents: action.agents,
        events: action.events,
        statuses: action.statuses ?? state.statuses,
        loading: false,
      }
    case 'TASK_CREATED':
      return { ...state, tasks: [...state.tasks, action.task] }
    case 'TASK_UPDATED':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.task.id ? action.task : t)),
      }
    case 'TASK_DELETED':
      return { ...state, tasks: state.tasks.filter((t) => t.id !== action.id) }
    case 'TASKS_CLEARED':
      return { ...state, tasks: state.tasks.filter((t) => t.status !== 'done') }
    case 'AGENT_DELETED':
      return { ...state, agents: state.agents.filter((a) => a.id !== action.id) }
    case 'STATUS_CREATED':
      return { ...state, statuses: [...state.statuses, action.status].sort((a,b) => a.position - b.position) }
    case 'STATUS_UPDATED':
      return { ...state, statuses: state.statuses.map((s) => s.id === action.status.id ? action.status : s).sort((a,b) => a.position - b.position) }
    case 'STATUS_DELETED':
      return { ...state, statuses: state.statuses.filter((s) => s.id !== action.id) }
    case 'AGENT_UPDATED':
    case 'AGENT_HEARTBEAT':
      return {
        ...state,
        agents: state.agents.some((a) => a.id === action.agent.id)
          ? state.agents.map((a) => (a.id === action.agent.id ? action.agent : a))
          : [...state.agents, action.agent],
      }
    case 'AGENT_REGISTERED':
      return { ...state, agents: [...state.agents, action.agent] }
    case 'ADD_EVENT':
      return { ...state, events: [action.event, ...state.events].slice(0, 100) }
    default:
      return state
  }
}

const VIEWS = [
  { id: 'board',    icon: LayoutDashboard, label: 'اللوحة' },
  { id: 'queue',    icon: ListTodo,        label: 'الطابور' },
  { id: 'monitor',  icon: Terminal,        label: 'المراقبة' },
  { id: 'settings', icon: Settings,        label: 'الإعدادات' },
]

export default function App() {
  const [state, dispatch] = useReducer(appReducer, {
    tasks: [],
    agents: [],
    events: [],
    statuses: [],
    loading: true,
  })
  const [showAddTask, setShowAddTask] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [view, setView] = useState('board')

  const handleWsMessage = useCallback((payload) => {
    setWsConnected(true)
    switch (payload.event) {
      case 'snapshot':
        dispatch({ type: 'SNAPSHOT', ...payload.data })
        break
      case 'task:created':
        dispatch({ type: 'TASK_CREATED', task: payload.data })
        break
      case 'task:updated':
        dispatch({ type: 'TASK_UPDATED', task: payload.data })
        break
      case 'task:deleted':
        dispatch({ type: 'TASK_DELETED', id: payload.data.id })
        break
      case 'agent:updated':
      case 'agent:stuck':
      case 'agent:resumed':
        dispatch({ type: 'AGENT_UPDATED', agent: payload.data })
        break
      case 'agent:heartbeat':
        dispatch({ type: 'AGENT_HEARTBEAT', agent: payload.data })
        break
      case 'agent:registered':
        dispatch({ type: 'AGENT_REGISTERED', agent: payload.data })
        break
      case 'agent:deleted':
        dispatch({ type: 'AGENT_DELETED', id: payload.data.id })
        break
      case 'tasks:cleared':
        dispatch({ type: 'TASKS_CLEARED' })
        break
      case 'status:created':
        dispatch({ type: 'STATUS_CREATED', status: payload.data })
        break
      case 'status:updated':
        dispatch({ type: 'STATUS_UPDATED', status: payload.data })
        break
      case 'status:deleted':
        dispatch({ type: 'STATUS_DELETED', id: payload.data.id })
        break
      case 'task:log':
        window.dispatchEvent(new CustomEvent('task:log', { detail: payload.data }))
        break
      case 'task:log:cleared':
        window.dispatchEvent(new CustomEvent('task:log:cleared', { detail: payload.data }))
        break
      case 'task:comment':
        window.dispatchEvent(new CustomEvent('task:comment', { detail: payload.data }))
        break
      case 'agent:activity':
        window.dispatchEvent(new CustomEvent('agent:activity', { detail: payload.data }))
        break
    }
  }, [])

  useWebSocket(handleWsMessage)

  useEffect(() => {
    Promise.all([
      fetch(`${API}/tasks`).then((r) => r.json()),
      fetch(`${API}/agents`).then((r) => r.json()),
      fetch(`${API}/statuses`).then((r) => r.json()),
    ]).then(([tasks, agents, statuses]) => {
      dispatch({ type: 'SNAPSHOT', tasks, agents, events: [], statuses })
    }).catch(console.error)
  }, [])

  async function handleCreateTask(data) {
    const res = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to create task')
    setShowAddTask(false)
  }

  async function handleMoveTask(taskId, newStatus, newPosition) {
    await fetch(`${API}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, position: newPosition }),
    })
  }

  async function handleAssignTask(taskId, agentId) {
    await fetch(`${API}/tasks/${taskId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    })
  }

  async function handleDeleteTask(taskId) {
    await fetch(`${API}/tasks/${taskId}`, { method: 'DELETE' })
  }

  async function refreshAgents() {
    const agents = await fetch(`${API}/agents`).then((r) => r.json())
    dispatch({ type: 'SNAPSHOT', tasks: state.tasks, agents, events: state.events })
  }

  async function handleUpdateTask(taskId, fields) {
    await fetch(`${API}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
  }

  const idleAgents  = state.agents.filter((a) => a.status === 'idle').length
  const busyAgents  = state.agents.filter((a) => a.status === 'busy').length
  const stuckAgents = state.agents.filter((a) => a.status === 'stuck').length

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-board-bg">
      {/* Header */}
      <header className="glass border-b border-board-border/60 px-5 py-0 flex items-center justify-between sticky top-0 z-40 shadow-header h-14 shrink-0">
        {/* Left: logo + status + nav */}
        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg flex items-center justify-center shadow-glow-sm">
              <Activity size={14} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white tracking-tight">Agent Board</span>
          </div>

          {/* WS status pill */}
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-colors ${
            wsConnected
              ? 'bg-emerald-950/60 text-emerald-400 border-emerald-900/50'
              : 'bg-amber-950/60 text-amber-400 border-amber-900/50'
          }`}>
            {wsConnected
              ? <Wifi size={11} className="shrink-0" />
              : <WifiOff size={11} className="shrink-0" />}
            <span className="font-medium">{wsConnected ? 'Live' : 'Connecting…'}</span>
          </div>

          {/* Nav tabs */}
          <nav className="flex items-center gap-0.5 bg-board-surface/70 border border-board-border/50 rounded-2xl p-1">
            {VIEWS.map(({ id, icon: Icon, label }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={view === id ? 'nav-tab-active' : 'nav-tab-inactive'}
              >
                <Icon size={12} />
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right: stats + actions */}
        <div className="flex items-center gap-3">
          {/* Agent status pills */}
          <div className="hidden sm:flex items-center gap-2 text-xs">
            {busyAgents > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-blue-950/60 text-blue-400 border border-blue-900/40">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse-fast" />
                {busyAgents} يعمل
              </span>
            )}
            {idleAgents > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-950/40 text-emerald-500 border border-emerald-900/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {idleAgents} خامل
              </span>
            )}
            {stuckAgents > 0 && (
              <span className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-orange-950/60 text-orange-400 border border-orange-900/40">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse-fast" />
                {stuckAgents} عالق
              </span>
            )}
          </div>

          <span className="text-xs text-slate-600 px-1">
            {state.tasks.length} مهمة
          </span>

          {view === 'board' && (
            <button className="btn-primary text-xs h-8 px-3" onClick={() => setShowAddTask(true)}>
              <Plus size={14} />
              مهمة جديدة
            </button>
          )}
        </div>
      </header>

      {/* Main content */}
      {view === 'board' ? (
        <div className="flex flex-1 min-h-0">
          <main className="flex-1 p-5 overflow-x-auto">
            {state.loading ? (
              <div className="flex items-center justify-center h-64 text-slate-500 gap-3">
                <RefreshCw size={20} className="animate-spin" />
                <span className="text-sm">تحميل اللوحة…</span>
              </div>
            ) : (
              <KanbanBoard
                tasks={state.tasks}
                agents={state.agents}
                statuses={state.statuses}
                onMoveTask={handleMoveTask}
                onAssignTask={handleAssignTask}
                onDeleteTask={handleDeleteTask}
                onUpdateTask={handleUpdateTask}
              />
            )}
          </main>

          <aside className="w-68 border-l border-board-border/50 bg-board-surface/50 p-4 overflow-y-auto hidden lg:block shrink-0">
            <AgentStatus agents={state.agents} tasks={state.tasks} />
          </aside>
        </div>
      ) : view === 'queue' ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <QueueDashboard tasks={state.tasks} agents={state.agents} />
        </div>
      ) : view === 'monitor' ? (
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0">
            <LiveMonitor agents={state.agents} tasks={state.tasks} />
          </div>
          <aside className="w-68 border-l border-board-border/50 bg-board-surface/50 p-4 overflow-y-auto hidden lg:block shrink-0">
            <AgentStatus agents={state.agents} tasks={state.tasks} />
          </aside>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          <SettingsPage
            agents={state.agents}
            tasks={state.tasks}
            statuses={state.statuses}
            onRefreshAgents={refreshAgents}
          />
        </div>
      )}

      {showAddTask && (
        <AddTaskModal
          onClose={() => setShowAddTask(false)}
          onCreate={handleCreateTask}
          agents={state.agents}
        />
      )}
    </div>
  )
}
