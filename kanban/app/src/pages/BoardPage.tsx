import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { Spinner, Toast, useToast, ConfirmDialog } from '../components/ui'
import BoardColumn, { type ColumnData } from '../components/BoardColumn'
import CardDetailPanel from '../components/CardDetailPanel'
import ImportWizard from '../components/ImportWizard'
import { type CardData } from '../components/KanbanCard'

interface BoardData {
  id: number
  name: string
  description?: string
}

export default function BoardPage() {
  const { id } = useParams<{ id: string }>()
  const api = useApi()
  const navigate = useNavigate()
  const { toast, show: showToast, clear: clearToast } = useToast()

  const [board, setBoard] = useState<BoardData | null>(null)
  const [columns, setColumns] = useState<ColumnData[]>([])
  const [cards, setCards] = useState<CardData[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCard, setSelectedCard] = useState<CardData | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [boardName, setBoardName] = useState('')
  const [deleteCardId, setDeleteCardId] = useState<number | null>(null)

  const dragCardRef = useRef<CardData | null>(null)

  const loadBoard = useCallback(async () => {
    if (!id) return
    try {
      const [boardData, colData, cardData] = await Promise.all([
        api.get(`/boards/${id}`),
        api.get(`/boards/${id}/columns`),
        api.get(`/boards/${id}/cards`),
      ])
      setBoard(boardData)
      setBoardName(boardData.name)
      setColumns(colData)
      setCards(cardData)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load board', 'error')
    } finally {
      setLoading(false)
    }
  }, [id, api, showToast])

  useEffect(() => { loadBoard() }, [loadBoard])

  // Drag & Drop
  function handleDragStart(e: React.DragEvent, card: CardData) {
    dragCardRef.current = card
    e.dataTransfer.effectAllowed = 'move'
    // Make the dragged card semi-transparent
    const target = e.currentTarget as HTMLElement
    setTimeout(() => { target.style.opacity = '0.5' }, 0)
  }

  // Reset opacity on drag end (attached globally via onDragEnd on cards)
  useEffect(() => {
    function handleDragEnd(e: DragEvent) {
      const target = e.target as HTMLElement
      target.style.opacity = '1'
    }
    document.addEventListener('dragend', handleDragEnd)
    return () => document.removeEventListener('dragend', handleDragEnd)
  }, [])

  async function handleDrop(_e: React.DragEvent, columnId: number) {
    const card = dragCardRef.current
    if (!card || card.column_id === columnId) {
      dragCardRef.current = null
      return
    }

    // Optimistic update
    const colCards = cards.filter(c => c.column_id === columnId)
    const newSortOrder = colCards.length > 0 ? Math.max(...colCards.map(c => c.sort_order)) + 1 : 0
    setCards(prev => prev.map(c =>
      c.id === card.id ? { ...c, column_id: columnId, sort_order: newSortOrder } : c
    ))

    try {
      await api.put(`/cards/${card.id}/move`, { column_id: columnId, sort_order: newSortOrder })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to move card', 'error')
      loadBoard() // Revert on error
    }
    dragCardRef.current = null
  }

  async function handleAddCard(columnId: number, title: string) {
    try {
      const colCards = cards.filter(c => c.column_id === columnId)
      const sortOrder = colCards.length > 0 ? Math.max(...colCards.map(c => c.sort_order)) + 1 : 0
      const card = await api.post(`/boards/${id}/cards`, {
        title,
        column_id: columnId,
        sort_order: sortOrder,
      })
      setCards(prev => [...prev, card])
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to add card', 'error')
    }
  }

  async function handleSaveCard(cardId: number, updates: Partial<CardData>) {
    try {
      const updated = await api.put(`/cards/${cardId}`, updates)
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, ...updated } : c))
      setSelectedCard(prev => prev && prev.id === cardId ? { ...prev, ...updated } : prev)
      showToast('Card saved')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to save card', 'error')
    }
  }

  async function handleDeleteCard(cardId: number) {
    setDeleteCardId(cardId)
  }

  async function confirmDeleteCard() {
    if (deleteCardId === null) return
    try {
      await api.del(`/cards/${deleteCardId}`)
      setCards(prev => prev.filter(c => c.id !== deleteCardId))
      if (selectedCard?.id === deleteCardId) setSelectedCard(null)
      showToast('Card deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete card', 'error')
    } finally {
      setDeleteCardId(null)
    }
  }

  async function handleSaveBoardName() {
    if (!board || boardName.trim() === board.name) {
      setEditingName(false)
      return
    }
    try {
      await api.put(`/boards/${id}`, { name: boardName.trim() })
      setBoard(prev => prev ? { ...prev, name: boardName.trim() } : prev)
      showToast('Board name updated')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update name', 'error')
      setBoardName(board.name)
    }
    setEditingName(false)
  }

  if (loading) return <Spinner />
  if (!board) return <div className="p-6 text-text-3">Board not found</div>

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface flex-shrink-0">
        <div className="flex-1 min-w-0">
          {editingName ? (
            <input
              autoFocus
              className="text-xl font-extrabold text-text-1 bg-transparent border-b-2 border-accent focus:outline-none w-full max-w-md"
              value={boardName}
              onChange={e => setBoardName(e.target.value)}
              onBlur={handleSaveBoardName}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveBoardName(); if (e.key === 'Escape') { setBoardName(board.name); setEditingName(false) } }}
            />
          ) : (
            <h1
              className="text-xl font-extrabold text-text-1 cursor-pointer hover:text-accent transition-colors"
              onClick={() => setEditingName(true)}
              title="Click to edit"
            >
              {board.name}
            </h1>
          )}
          {board.description && <p className="text-sm text-text-3 mt-0.5">{board.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowImport(true)} className="btn-outline px-3 py-2 text-sm flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
            </svg>
            Import
          </button>
          <button onClick={() => navigate(`/boards/${id}/sessions`)} className="btn-outline px-3 py-2 text-sm flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 20V10M18 20V4M6 20v-4"/>
            </svg>
            Sessions
          </button>
          <button onClick={() => navigate(`/boards/${id}/results`)} className="btn-outline px-3 py-2 text-sm flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>
            </svg>
            Results
          </button>
        </div>
      </div>

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex gap-4 h-full items-start">
          {columns
            .sort((a, b) => a.sort_order - b.sort_order)
            .map(col => (
              <BoardColumn
                key={col.id}
                column={col}
                cards={cards.filter(c => c.column_id === col.id).sort((a, b) => a.sort_order - b.sort_order)}
                onDrop={handleDrop}
                onDragStart={handleDragStart}
                onAddCard={handleAddCard}
                onCardClick={setSelectedCard}
              />
            ))}

          {columns.length === 0 && (
            <div className="flex-1 flex items-center justify-center text-text-3 text-sm">
              No columns yet. Columns are created automatically when cards are imported, or by the API.
            </div>
          )}
        </div>
      </div>

      {/* Card detail panel */}
      <CardDetailPanel
        card={selectedCard}
        onSave={handleSaveCard}
        onDelete={handleDeleteCard}
        onClose={() => setSelectedCard(null)}
      />

      {/* Import wizard */}
      {showImport && (
        <ImportWizard
          boardId={id!}
          columns={columns}
          onClose={() => setShowImport(false)}
          onComplete={() => { setShowImport(false); loadBoard(); showToast('Cards imported successfully') }}
        />
      )}

      {/* Delete card confirmation */}
      {deleteCardId !== null && (
        <ConfirmDialog
          message="Delete this card? This action cannot be undone."
          onConfirm={confirmDeleteCard}
          onCancel={() => setDeleteCardId(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  )
}
