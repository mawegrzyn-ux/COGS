import React, { useState } from 'react'
import KanbanCard, { type CardData } from './KanbanCard'

export interface ColumnData {
  id: number
  name: string
  sort_order: number
  wip_limit?: number
}

interface BoardColumnProps {
  column: ColumnData
  cards: CardData[]
  onDrop: (e: React.DragEvent, columnId: number) => void
  onDragStart: (e: React.DragEvent, card: CardData) => void
  onAddCard: (columnId: number, title: string) => void
  onCardClick: (card: CardData) => void
}

export default function BoardColumn({ column, cards, onDrop, onDragStart, onAddCard, onCardClick }: BoardColumnProps) {
  const [dragOver, setDragOver] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const isOverWip = column.wip_limit ? cards.length >= column.wip_limit : false

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    onDrop(e, column.id)
  }

  function handleAddSubmit() {
    const title = newTitle.trim()
    if (!title) { setAdding(false); return }
    onAddCard(column.id, title)
    setNewTitle('')
    setAdding(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleAddSubmit()
    if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
  }

  return (
    <div
      className={`flex flex-col bg-surface-2 rounded-xl w-72 flex-shrink-0 border-2 transition-colors ${
        dragOver ? 'border-accent bg-accent-dim/30' : 'border-transparent'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Column header */}
      <div className="px-3 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-text-1">{column.name}</h3>
          <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-border text-text-3 text-[10px] font-bold">
            {cards.length}
          </span>
        </div>
        {column.wip_limit && (
          <span className={`text-[10px] font-semibold ${isOverWip ? 'text-red-500' : 'text-text-3'}`}>
            WIP: {cards.length}/{column.wip_limit}
          </span>
        )}
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px]">
        {cards.map(card => (
          <KanbanCard
            key={card.id}
            card={card}
            onDragStart={onDragStart}
            onClick={onCardClick}
          />
        ))}
      </div>

      {/* Add card */}
      <div className="px-2 pb-2">
        {adding ? (
          <div className="card p-2">
            <input
              autoFocus
              className="w-full px-2 py-1.5 text-sm border border-border rounded bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              placeholder="Card title..."
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleAddSubmit}
            />
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2 text-sm text-text-3 hover:text-accent hover:bg-accent-dim/50 rounded-lg transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Add card
          </button>
        )}
      </div>
    </div>
  )
}
