import React from 'react'
import { Droppable } from '@hello-pangea/dnd'
import { Zap, CheckCircle } from 'lucide-react'
import TaskCard from './TaskCard'

export default function Column({ column, tasks, agents, statuses, isDragging, onAssignTask, onDeleteTask, onUpdateTask }) {
  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Column header */}
      <div className="mb-2 px-0.5">
        {/* Top color bar */}
        <div className={`h-0.5 rounded-full mb-3 ${column.dot.replace('bg-', 'bg-')} opacity-70`} />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${column.dot}`} />
            <h2 className={`text-sm font-semibold ${column.color} tracking-tight`}>
              {column.label}
            </h2>
            {column.trigger_enabled && (
              <Zap size={11} className="text-indigo-400 opacity-70" title="يُشغّل الوكيل تلقائياً" />
            )}
            {column.is_terminal && (
              <CheckCircle size={11} className="text-emerald-400 opacity-70" title="حالة نهائية" />
            )}
          </div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
            tasks.length > 0
              ? `${column.badge} border border-current/20`
              : 'text-slate-600 bg-white/4'
          }`}>
            {tasks.length}
          </span>
        </div>
      </div>

      {/* Droppable area */}
      <Droppable droppableId={column.id}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex flex-col gap-2.5 flex-1 min-h-24 rounded-2xl p-2 transition-all duration-200 ${
              snapshot.isDraggingOver
                ? 'bg-indigo-950/30 drop-zone-active'
                : 'bg-white/2'
            }`}
            style={{ minHeight: '6rem' }}
          >
            {tasks.map((task, index) => (
              <TaskCard
                key={task.id}
                task={task}
                index={index}
                agents={agents}
                statuses={statuses}
                onAssign={onAssignTask}
                onDelete={onDeleteTask}
                onUpdate={onUpdateTask}
              />
            ))}
            {provided.placeholder}
            {tasks.length === 0 && !isDragging && (
              <div className="flex-1 flex items-center justify-center py-10 text-slate-700 text-xs select-none">
                أفلت المهام هنا
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  )
}
