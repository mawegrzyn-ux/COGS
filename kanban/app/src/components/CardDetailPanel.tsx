import { useState, useEffect } from 'react'
import { type CardData } from './KanbanCard'
import { Field } from './ui'
import VoteBar from './VoteBar'

interface CardDetailPanelProps {
  card: CardData | null
  onSave: (id: number, updates: Partial<CardData>) => void
  onDelete: (id: number) => void
  onClose: () => void
}

export default function CardDetailPanel({ card, onSave, onDelete, onClose }: CardDetailPanelProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('')
  const [labels, setLabels] = useState('')
  const [storyPoints, setStoryPoints] = useState<number | ''>('')
  const [epic, setEpic] = useState('')

  useEffect(() => {
    if (card) {
      setTitle(card.title)
      setDescription(card.description ?? '')
      setPriority(card.priority ?? '')
      setLabels(card.labels ?? '')
      setStoryPoints(card.story_points ?? '')
      setEpic(card.epic ?? '')
    }
  }, [card])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  if (!card) return null

  function handleSave() {
    if (!card) return
    onSave(card.id, {
      title,
      description: description || undefined,
      priority: priority || undefined,
      labels: labels || undefined,
      story_points: storyPoints === '' ? undefined : Number(storyPoints),
      epic: epic || undefined,
    })
  }

  const hasVotes = (card.votes_for ?? 0) + (card.votes_against ?? 0) > 0

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 z-50 h-full w-96 max-w-full bg-surface shadow-modal flex flex-col animate-slide-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-bold text-text-1">Card Details</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <Field label="Title" required>
            <input
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
          </Field>

          <Field label="Description">
            <textarea
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 min-h-[80px] resize-y"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </Field>

          <Field label="Priority">
            <select
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={priority}
              onChange={e => setPriority(e.target.value)}
            >
              <option value="">None</option>
              <option value="highest">Highest</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
              <option value="lowest">Lowest</option>
            </select>
          </Field>

          <Field label="Labels" hint="Comma-separated">
            <input
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={labels}
              onChange={e => setLabels(e.target.value)}
              placeholder="e.g. frontend, bug, urgent"
            />
          </Field>

          <Field label="Story Points">
            <input
              type="number"
              min={0}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={storyPoints}
              onChange={e => setStoryPoints(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </Field>

          <Field label="Epic">
            <input
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={epic}
              onChange={e => setEpic(e.target.value)}
            />
          </Field>

          {card.jira_key && (
            <Field label="Jira Key">
              <input
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface-2 text-text-3 cursor-not-allowed"
                value={card.jira_key}
                readOnly
              />
            </Field>
          )}

          {/* Vote summary */}
          {hasVotes && (
            <div className="mt-4 pt-4 border-t border-border">
              <h3 className="text-sm font-bold text-text-1 mb-3">Vote Summary</h3>
              <VoteBar votesFor={card.votes_for ?? 0} votesAgainst={card.votes_against ?? 0} />
              <div className="flex justify-between mt-2 text-xs text-text-3">
                <span>For: {card.votes_for ?? 0}</span>
                <span>Against: {card.votes_against ?? 0}</span>
                <span>Net: {(card.votes_for ?? 0) - (card.votes_against ?? 0)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-3">
          <button onClick={handleSave} className="btn-primary px-4 py-2 text-sm flex-1">
            Save
          </button>
          <button
            onClick={() => onDelete(card.id)}
            className="btn-danger px-4 py-2 text-sm"
          >
            Delete
          </button>
          <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">
            Close
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .animate-slide-in {
          animation: slideIn 0.2s ease-out;
        }
      `}</style>
    </>
  )
}
