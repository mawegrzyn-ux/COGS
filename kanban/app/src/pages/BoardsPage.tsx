import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { PageHeader, EmptyState, Spinner, Modal, Field, ConfirmDialog, Toast, useToast } from '../components/ui'

interface Board {
  id: number
  name: string
  description?: string
  card_count?: number
  session_count?: number
  created_at?: string
}

export default function BoardsPage() {
  const api = useApi()
  const navigate = useNavigate()
  const { toast, show: showToast, clear: clearToast } = useToast()

  const [boards, setBoards] = useState<Board[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const loadBoards = useCallback(async () => {
    try {
      const data = await api.get('/boards')
      setBoards(data)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load boards', 'error')
    } finally {
      setLoading(false)
    }
  }, [api, showToast])

  useEffect(() => { loadBoards() }, [loadBoards])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const board = await api.post('/boards', { name: newName.trim(), description: newDesc.trim() || undefined })
      setBoards(prev => [...prev, board])
      setShowNew(false)
      setNewName('')
      setNewDesc('')
      showToast('Board created')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create board', 'error')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (deleteId === null) return
    try {
      await api.del(`/boards/${deleteId}`)
      setBoards(prev => prev.filter(b => b.id !== deleteId))
      showToast('Board deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete board', 'error')
    } finally {
      setDeleteId(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Boards"
        subtitle="Manage your kanban boards"
        action={
          <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-sm">
            New Board
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Spinner />
        ) : boards.length === 0 ? (
          <EmptyState
            message="No boards yet. Create your first board to get started."
            action={
              <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-sm">
                Create Board
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {boards.map(board => (
              <div
                key={board.id}
                className="card p-5 hover:shadow-card transition-shadow cursor-pointer group"
                onClick={() => navigate(`/boards/${board.id}`)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="text-base font-bold text-text-1 group-hover:text-accent transition-colors">
                    {board.name}
                  </h3>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteId(board.id) }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 text-text-3 hover:text-red-500 transition-all"
                    title="Delete board"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                  </button>
                </div>
                {board.description && (
                  <p className="text-sm text-text-3 mb-3 line-clamp-2">{board.description}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-text-3">
                  <span className="flex items-center gap-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                      <path d="M3 9h18"/>
                    </svg>
                    {board.card_count ?? 0} cards
                  </span>
                  <span className="flex items-center gap-1">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M12 20V10M18 20V4M6 20v-4"/>
                    </svg>
                    {board.session_count ?? 0} sessions
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Board Modal */}
      {showNew && (
        <Modal title="New Board" onClose={() => setShowNew(false)}>
          <Field label="Board Name" required>
            <input
              autoFocus
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Sprint 42 Backlog"
              onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            />
          </Field>
          <Field label="Description">
            <textarea
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 min-h-[60px] resize-y"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="Optional description..."
            />
          </Field>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setShowNew(false)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Board'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteId !== null && (
        <ConfirmDialog
          message="Are you sure you want to delete this board? All cards, columns, and voting sessions will be permanently removed."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  )
}
