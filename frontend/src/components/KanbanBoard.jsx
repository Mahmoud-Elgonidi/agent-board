import React, { useState } from 'react'
import { DragDropContext } from '@hello-pangea/dnd'
import Column from './Column'

// Map color name → Tailwind classes used in columns
export const COLOR_MAP = {
  slate:   { text: 'text-slate-400',   dot: 'bg-slate-500',   ring: 'ring-slate-600/30',   badge: 'bg-slate-800/60 text-slate-300' },
  blue:    { text: 'text-blue-400',    dot: 'bg-blue-500',    ring: 'ring-blue-600/30',    badge: 'bg-blue-900/50 text-blue-300' },
  indigo:  { text: 'text-indigo-400',  dot: 'bg-indigo-500',  ring: 'ring-indigo-600/30',  badge: 'bg-indigo-900/50 text-indigo-300' },
  purple:  { text: 'text-purple-400',  dot: 'bg-purple-500',  ring: 'ring-purple-600/30',  badge: 'bg-purple-900/50 text-purple-300' },
  pink:    { text: 'text-pink-400',    dot: 'bg-pink-500',    ring: 'ring-pink-600/30',    badge: 'bg-pink-900/50 text-pink-300' },
  rose:    { text: 'text-rose-400',    dot: 'bg-rose-500',    ring: 'ring-rose-600/30',    badge: 'bg-rose-900/50 text-rose-300' },
  red:     { text: 'text-red-400',     dot: 'bg-red-500',     ring: 'ring-red-600/30',     badge: 'bg-red-900/50 text-red-300' },
  orange:  { text: 'text-orange-400',  dot: 'bg-orange-500',  ring: 'ring-orange-600/30',  badge: 'bg-orange-900/50 text-orange-300' },
  amber:   { text: 'text-amber-400',   dot: 'bg-amber-500',   ring: 'ring-amber-600/30',   badge: 'bg-amber-900/50 text-amber-300' },
  yellow:  { text: 'text-yellow-400',  dot: 'bg-yellow-500',  ring: 'ring-yellow-600/30',  badge: 'bg-yellow-900/50 text-yellow-300' },
  lime:    { text: 'text-lime-400',    dot: 'bg-lime-500',    ring: 'ring-lime-600/30',    badge: 'bg-lime-900/50 text-lime-300' },
  green:   { text: 'text-green-400',   dot: 'bg-green-500',   ring: 'ring-green-600/30',   badge: 'bg-green-900/50 text-green-300' },
  emerald: { text: 'text-emerald-400', dot: 'bg-emerald-500', ring: 'ring-emerald-600/30', badge: 'bg-emerald-900/50 text-emerald-300' },
  teal:    { text: 'text-teal-400',    dot: 'bg-teal-500',    ring: 'ring-teal-600/30',    badge: 'bg-teal-900/50 text-teal-300' },
  cyan:    { text: 'text-cyan-400',    dot: 'bg-cyan-500',    ring: 'ring-cyan-600/30',    badge: 'bg-cyan-900/50 text-cyan-300' },
  sky:     { text: 'text-sky-400',     dot: 'bg-sky-500',     ring: 'ring-sky-600/30',     badge: 'bg-sky-900/50 text-sky-300' },
}

export function getStatusColors(colorName) {
  return COLOR_MAP[colorName] || COLOR_MAP.slate
}

// Fallback statuses when DB hasn't loaded yet
const FALLBACK_STATUSES = [
  { id: 'todo',        label: 'في الانتظار', color: 'slate',   position: 0 },
  { id: 'in_progress', label: 'قيد التنفيذ', color: 'blue',    position: 1 },
  { id: 'blocked',     label: 'متوقفة',      color: 'orange',  position: 2 },
  { id: 'done',        label: 'مكتملة',      color: 'emerald', position: 3 },
]

export default function KanbanBoard({ tasks, agents, statuses, onMoveTask, onAssignTask, onDeleteTask, onUpdateTask }) {
  const [dragging, setDragging] = useState(false)

  const columns = (statuses?.length ? statuses : FALLBACK_STATUSES)
    .slice()
    .sort((a, b) => a.position - b.position)

  function getColumnTasks(statusId) {
    return tasks
      .filter((t) => t.status === statusId)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  }

  function computeNewPosition(destinationTasks, destinationIndex) {
    if (destinationTasks.length === 0) return 1000
    if (destinationIndex === 0) return (destinationTasks[0]?.position ?? 1000) / 2
    if (destinationIndex >= destinationTasks.length) {
      return (destinationTasks[destinationTasks.length - 1]?.position ?? 0) + 1000
    }
    const before = destinationTasks[destinationIndex - 1]?.position ?? 0
    const after  = destinationTasks[destinationIndex]?.position ?? before + 2000
    return (before + after) / 2
  }

  function onDragEnd(result) {
    setDragging(false)
    const { draggableId, source, destination } = result
    if (!destination) return
    if (source.droppableId === destination.droppableId && source.index === destination.index) return

    const destColTasks = getColumnTasks(destination.droppableId).filter((t) => t.id !== draggableId)
    const newPosition  = computeNewPosition(destColTasks, destination.index)

    onMoveTask(draggableId, destination.droppableId, newPosition)
  }

  return (
    <DragDropContext onDragStart={() => setDragging(true)} onDragEnd={onDragEnd}>
      <div className="flex gap-3 min-h-[calc(100vh-120px)] items-start pb-6">
        {columns.map((col) => (
          <Column
            key={col.id}
            column={{ ...col, ...getStatusColors(col.color) }}
            tasks={getColumnTasks(col.id)}
            agents={agents}
            statuses={statuses}
            isDragging={dragging}
            onAssignTask={onAssignTask}
            onDeleteTask={onDeleteTask}
            onUpdateTask={onUpdateTask}
          />
        ))}
      </div>
    </DragDropContext>
  )
}
