import React, { useState, useRef } from 'react'
import { Draggable } from '@hello-pangea/dnd'
import { User, Trash2, Zap, AlertCircle, Clock, Pencil, MessageSquare, Loader2, Lock } from 'lucide-react'
import AssignModal from './AssignModal'
import EditTaskModal from './EditTaskModal'
import TaskDetailDrawer from './TaskDetailDrawer'

const PRIORITY_STYLES = {
  urgent: { badge: 'bg-red-950/80 text-red-400 border-red-900/60',     strip: 'priority-urgent', dot: 'bg-red-500' },
  high:   { badge: 'bg-orange-950/80 text-orange-400 border-orange-900/60', strip: 'priority-high',   dot: 'bg-orange-500' },
  medium: { badge: 'bg-indigo-950/80 text-indigo-400 border-indigo-900/60', strip: 'priority-medium', dot: 'bg-indigo-500' },
  low:    { badge: 'bg-slate-900/80 text-slate-500 border-slate-800/60',    strip: 'priority-low',   dot: 'bg-slate-600' },
}

const PRIORITY_ICONS = {
  urgent: <AlertCircle size={9} />,
  high:   <Zap size={9} />,
  medium: null,
  low:    null,
}

const PRIORITY_LABELS = {
  urgent: 'عاجل',
  high:   'عالي',
  medium: 'متوسط',
  low:    'منخفض',
}

const STATUS_DOT_COLORS = {
  idle:    'bg-emerald-400',
  busy:    'bg-blue-400 animate-pulse-fast',
  stuck:   'bg-orange-400 animate-pulse-fast',
  offline: 'bg-slate-600',
}

function timeAgo(ts) {
  if (!ts) return null
  const diff = Date.now() - ts
  if (diff < 60000) return 'الآن'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}د`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}س`
  return `${Math.floor(diff / 86400000)}ي`
}

export default function TaskCard({ task, index, agents, onAssign, onDelete, onUpdate }) {
  const [showAssign, setShowAssign] = useState(false)
  const [showEdit, setShowEdit]     = useState(false)
  const [showDetail, setShowDetail] = useState(false)
  const pointerDownPos = useRef(null)

  const assignedAgent = agents.find((a) => a.id === task.assigned_agent)
  const targetAgent   = agents.find((a) => a.id === task.target_agent)
  const isStuck       = assignedAgent?.status === 'stuck'
  const isReforming   = task.context?.reformulating
  const heartbeatAge  = timeAgo(task.last_heartbeat)

  const priorityStyle = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium

  function handlePointerDown(e) {
    pointerDownPos.current = { x: e.clientX, y: e.clientY }
  }

  function handleCardClick(e) {
    if (pointerDownPos.current) {
      const dx = Math.abs(e.clientX - pointerDownPos.current.x)
      const dy = Math.abs(e.clientY - pointerDownPos.current.y)
      if (dx > 5 || dy > 5) return
    }
    setShowDetail(true)
  }

  function stop(e) { e.stopPropagation() }

  return (
    <>
      <Draggable draggableId={task.id} index={index}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            onPointerDown={handlePointerDown}
            onClick={handleCardClick}
            className={`
              group relative card cursor-pointer select-none overflow-hidden
              transition-all duration-200
              ${priorityStyle.strip}
              ${snapshot.isDragging
                ? 'dragging-card cursor-grabbing'
                : 'hover:bg-board-cardHov hover:border-board-borderHov hover:shadow-card-hover hover:-translate-y-px'
              }
              ${isStuck ? '!border-orange-700/60' : ''}
            `}
            style={{ ...provided.draggableProps.style, padding: '12px 12px 10px 14px' }}
          >
            {/* Reformulating shimmer overlay */}
            {isReforming && (
              <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500/8 to-transparent skeleton" />
              </div>
            )}

            {/* Top row: priority badge + actions */}
            <div className="flex items-start justify-between gap-2 mb-2.5">
              <span className={`badge badge-outline border ${priorityStyle.badge} text-[10px]`}>
                {PRIORITY_ICONS[task.priority]}
                {PRIORITY_LABELS[task.priority] || task.priority}
              </span>

              {/* Action toolbar (hover) */}
              <div
                className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 -mt-0.5 -mr-0.5"
                onClick={stop}
              >
                <button
                  className="btn-icon w-6 h-6 rounded-lg"
                  onClick={(e) => { stop(e); setShowEdit(true) }}
                  title="تعديل"
                >
                  <Pencil size={11} />
                </button>
                <button
                  className="btn-icon w-6 h-6 rounded-lg"
                  onClick={(e) => { stop(e); setShowAssign(true) }}
                  title="تعيين وكيل"
                >
                  <User size={11} />
                </button>
                <button
                  className="btn-icon w-6 h-6 rounded-lg text-red-500/70 hover:text-red-400 hover:bg-red-950/60"
                  onClick={(e) => { stop(e); onDelete(task.id) }}
                  title="حذف"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>

            {/* Title */}
            <h3 className={`text-sm font-medium leading-snug mb-1.5 line-clamp-2 ${
              isReforming ? 'text-slate-400' : 'text-slate-100'
            }`}>
              {isReforming && <Loader2 size={11} className="inline animate-spin mr-1.5 text-indigo-400" />}
              {task.title}
            </h3>

            {/* Description preview */}
            {task.description && (
              <p className="text-xs text-slate-500 leading-relaxed line-clamp-2 mb-2">
                {task.description}
              </p>
            )}

            {/* Progress bar */}
            {task.status === 'in_progress' && typeof task.progress === 'number' && (
              <div className="mb-2.5">
                <div className="flex justify-between items-center text-xs mb-1">
                  <span className="text-slate-600 text-[10px]">التقدم</span>
                  <span className="text-slate-400 font-medium text-[10px] tabular-nums">{task.progress}%</span>
                </div>
                <div className="h-1 bg-board-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${task.progress}%`,
                      background: task.progress >= 80
                        ? 'linear-gradient(90deg, #10b981, #34d399)'
                        : task.progress >= 40
                        ? 'linear-gradient(90deg, #6366f1, #818cf8)'
                        : 'linear-gradient(90deg, #6366f1, #a5b4fc)',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-board-border/40">
              {/* Agent */}
              {assignedAgent ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="relative shrink-0">
                    <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      isStuck ? 'bg-orange-900/80 text-orange-300' : 'bg-indigo-900/80 text-indigo-300'
                    }`}>
                      {assignedAgent.name[0].toUpperCase()}
                    </div>
                    <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-board-card ${
                      STATUS_DOT_COLORS[assignedAgent.status] || 'bg-slate-600'
                    }`} />
                  </div>
                  <span className={`text-xs truncate ${isStuck ? 'text-orange-400' : 'text-slate-400'}`}>
                    {assignedAgent.name}
                  </span>
                </div>
              ) : (
                <span className="text-xs text-slate-700 flex items-center gap-1">
                  <User size={10} />
                  غير معيّن
                </span>
              )}

              {/* Right meta */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Target agent lock indicator */}
                {task.target_agent && (
                  <span
                    className="flex items-center gap-1 text-[10px] text-amber-600/80"
                    title={`مخصص لـ ${targetAgent?.name || task.target_agent}`}
                  >
                    <Lock size={9} />
                    {targetAgent?.name || '…'}
                  </span>
                )}
                {heartbeatAge && (
                  <span className="flex items-center gap-1 text-[10px] text-slate-600 tabular-nums">
                    <Clock size={9} />
                    {heartbeatAge}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </Draggable>

      {showAssign && (
        <AssignModal
          task={task}
          agents={agents}
          onAssign={(agentId) => { onAssign(task.id, agentId); setShowAssign(false) }}
          onClose={() => setShowAssign(false)}
        />
      )}

      {showEdit && (
        <EditTaskModal
          task={task}
          agents={agents}
          onSave={(fields) => { onUpdate(task.id, fields); setShowEdit(false) }}
          onClose={() => setShowEdit(false)}
        />
      )}

      {showDetail && (
        <TaskDetailDrawer
          task={task}
          agents={agents}
          onClose={() => setShowDetail(false)}
          onEdit={() => { setShowDetail(false); setShowEdit(true) }}
          onAssign={() => { setShowDetail(false); setShowAssign(true) }}
          onDelete={onDelete}
          onUpdate={onUpdate}
        />
      )}
    </>
  )
}
