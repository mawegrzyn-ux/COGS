import React from 'react'
import { Badge } from './ui'
import VoteBar from './VoteBar'

export interface CardData {
  id: number
  title: string
  description?: string
  priority?: string
  labels?: string
  story_points?: number
  epic?: string
  jira_key?: string
  column_id: number
  sort_order: number
  votes_for?: number
  votes_against?: number
}

const priorityConfig: Record<string, { label: string; variant: 'red' | 'orange' | 'yellow' | 'blue' | 'neutral' }> = {
  highest: { label: 'Highest', variant: 'red' },
  high:    { label: 'High',    variant: 'orange' },
  medium:  { label: 'Medium',  variant: 'yellow' },
  low:     { label: 'Low',     variant: 'blue' },
  lowest:  { label: 'Lowest',  variant: 'neutral' },
}

interface KanbanCardProps {
  card: CardData
  onDragStart: (e: React.DragEvent, card: CardData) => void
  onClick: (card: CardData) => void
}

export default function KanbanCard({ card, onDragStart, onClick }: KanbanCardProps) {
  const labelsArr = card.labels ? card.labels.split(',').map(l => l.trim()).filter(Boolean) : []
  const priorityCfg = card.priority ? priorityConfig[card.priority.toLowerCase()] : null
  const hasVotes = (card.votes_for ?? 0) + (card.votes_against ?? 0) > 0

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      onClick={() => onClick(card)}
      className="card p-3 cursor-grab hover:shadow-card active:cursor-grabbing transition-shadow group select-none"
    >
      {/* Title */}
      <p className="text-sm font-semibold text-text-1 leading-snug mb-1.5">{card.title}</p>

      {/* Meta row */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {priorityCfg && <Badge label={priorityCfg.label} variant={priorityCfg.variant} />}
        {labelsArr.map(l => (
          <span key={l} className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-surface-2 text-text-3 border border-border">
            {l}
          </span>
        ))}
        {card.story_points != null && card.story_points > 0 && (
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-accent-dim text-accent text-[10px] font-bold">
            {card.story_points}
          </span>
        )}
        {card.jira_key && (
          <span className="text-[10px] text-text-3 font-mono">{card.jira_key}</span>
        )}
      </div>

      {/* Mini vote bar */}
      {hasVotes && (
        <div className="mt-2">
          <VoteBar votesFor={card.votes_for ?? 0} votesAgainst={card.votes_against ?? 0} />
        </div>
      )}
    </div>
  )
}
