import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { PageHeader, Spinner, EmptyState, Modal, Field, Badge, ConfirmDialog, Toast, useToast } from '../components/ui'

interface VotingSession {
  id: number
  board_id: number
  name: string
  slug: string
  tokens_for: number
  tokens_against: number
  voter_count?: number
  is_active: boolean
  expires_at?: string
  column_filter?: number[]
  notes?: string
  created_at: string
}

interface BoardInfo {
  id: number
  name: string
}

interface ColumnInfo {
  id: number
  name: string
}

export default function SessionsPage() {
  const { id: boardId } = useParams<{ id: string }>()
  const api = useApi()
  const { toast, show: showToast, clear: clearToast } = useToast()

  const [board, setBoard] = useState<BoardInfo | null>(null)
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [sessions, setSessions] = useState<VotingSession[]>([])
  const [loading, setLoading] = useState(true)

  // New session form
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  const [tokensFor, setTokensFor] = useState(10)
  const [tokensAgainst, setTokensAgainst] = useState(5)
  const [columnFilter, setColumnFilter] = useState<number[]>([])
  const [expiresAt, setExpiresAt] = useState('')
  const [notes, setNotes] = useState('')
  const [creating, setCreating] = useState(false)

  // Edit session
  const [editSession, setEditSession] = useState<VotingSession | null>(null)
  const [editName, setEditName] = useState('')
  const [editTokensFor, setEditTokensFor] = useState(10)
  const [editTokensAgainst, setEditTokensAgainst] = useState(5)
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteId, setDeleteId] = useState<number | null>(null)

  const loadData = useCallback(async () => {
    if (!boardId) return
    try {
      const [boardData, colData, sessionData] = await Promise.all([
        api.get(`/boards/${boardId}`),
        api.get(`/boards/${boardId}/columns`),
        api.get(`/boards/${boardId}/sessions`),
      ])
      setBoard(boardData)
      setColumns(colData)
      setSessions(sessionData)
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load sessions', 'error')
    } finally {
      setLoading(false)
    }
  }, [boardId, api, showToast])

  useEffect(() => { loadData() }, [loadData])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const session = await api.post(`/boards/${boardId}/sessions`, {
        name: newName.trim(),
        tokens_for: tokensFor,
        tokens_against: tokensAgainst,
        column_filter: columnFilter.length > 0 ? columnFilter : undefined,
        expires_at: expiresAt || undefined,
        notes: notes.trim() || undefined,
      })
      setSessions(prev => [...prev, session])
      setShowNew(false)
      resetNewForm()
      showToast('Session created')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to create session', 'error')
    } finally {
      setCreating(false)
    }
  }

  function resetNewForm() {
    setNewName('')
    setTokensFor(10)
    setTokensAgainst(5)
    setColumnFilter([])
    setExpiresAt('')
    setNotes('')
  }

  function openEdit(session: VotingSession) {
    setEditSession(session)
    setEditName(session.name)
    setEditTokensFor(session.tokens_for)
    setEditTokensAgainst(session.tokens_against)
    setEditNotes(session.notes ?? '')
  }

  async function handleSaveEdit() {
    if (!editSession || !editName.trim()) return
    setSaving(true)
    try {
      const updated = await api.put(`/sessions/${editSession.id}`, {
        name: editName.trim(),
        tokens_for: editTokensFor,
        tokens_against: editTokensAgainst,
        notes: editNotes.trim() || undefined,
      })
      setSessions(prev => prev.map(s => s.id === editSession.id ? { ...s, ...updated } : s))
      setEditSession(null)
      showToast('Session updated')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to update session', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (deleteId === null) return
    try {
      await api.del(`/sessions/${deleteId}`)
      setSessions(prev => prev.filter(s => s.id !== deleteId))
      showToast('Session deleted')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete session', 'error')
    } finally {
      setDeleteId(null)
    }
  }

  function copyLink(slug: string) {
    const url = `${window.location.origin}/vote/${slug}`
    navigator.clipboard.writeText(url).then(
      () => showToast('Link copied to clipboard'),
      () => showToast('Failed to copy link', 'error')
    )
  }

  function toggleColumnFilter(colId: number) {
    setColumnFilter(prev =>
      prev.includes(colId) ? prev.filter(c => c !== colId) : [...prev, colId]
    )
  }

  function isExpired(session: VotingSession) {
    if (!session.expires_at) return false
    return new Date(session.expires_at) < new Date()
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  if (loading) return <Spinner />

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Voting Sessions"
        subtitle={board ? `Board: ${board.name}` : undefined}
        action={
          <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-sm">
            New Session
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-6">
        {sessions.length === 0 ? (
          <EmptyState
            message="No voting sessions yet. Create one to start collecting votes."
            action={
              <button onClick={() => setShowNew(true)} className="btn-primary px-4 py-2 text-sm">
                Create Session
              </button>
            }
          />
        ) : (
          <div className="space-y-3">
            {sessions.map(session => (
              <div key={session.id} className="card p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-bold text-text-1">{session.name}</h3>
                      {session.is_active && !isExpired(session) ? (
                        <Badge label="Active" variant="green" />
                      ) : (
                        <Badge label="Expired" variant="neutral" />
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-text-3">
                      <span>Slug: <code className="font-mono text-text-2">{session.slug}</code></span>
                      <span>For: {session.tokens_for} tokens</span>
                      <span>Against: {session.tokens_against} tokens</span>
                      {session.voter_count != null && <span>{session.voter_count} voters</span>}
                      <span>Created {formatDate(session.created_at)}</span>
                      {session.expires_at && <span>Expires {formatDate(session.expires_at)}</span>}
                    </div>
                    {session.notes && (
                      <p className="text-xs text-text-3 mt-1 italic">{session.notes}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 ml-4">
                    <button
                      onClick={() => copyLink(session.slug)}
                      className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors"
                      title="Copy share link"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
                        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => openEdit(session)}
                      className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors"
                      title="Edit session"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => setDeleteId(session.id)}
                      className="p-1.5 rounded hover:bg-red-50 text-text-3 hover:text-red-500 transition-colors"
                      title="Delete session"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* New Session Modal */}
      {showNew && (
        <Modal title="New Voting Session" onClose={() => { setShowNew(false); resetNewForm() }}>
          <Field label="Session Name" required>
            <input
              autoFocus
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Sprint 42 Vote"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tokens FOR" hint="Tokens each voter gets for upvotes">
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={tokensFor}
                onChange={e => setTokensFor(Number(e.target.value))}
              />
            </Field>
            <Field label="Tokens AGAINST" hint="Tokens each voter gets for downvotes">
              <input
                type="number"
                min={0}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={tokensAgainst}
                onChange={e => setTokensAgainst(Number(e.target.value))}
              />
            </Field>
          </div>

          {columns.length > 0 && (
            <Field label="Column Filter" hint="Only include cards from selected columns. Leave all unchecked to include all columns.">
              <div className="space-y-1.5">
                {columns.map(col => (
                  <label key={col.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={columnFilter.includes(col.id)}
                      onChange={() => toggleColumnFilter(col.id)}
                      className="w-4 h-4 rounded border-border text-accent focus:ring-accent/30"
                    />
                    <span className="text-sm text-text-2">{col.name}</span>
                  </label>
                ))}
              </div>
            </Field>
          )}

          <Field label="Expiry Date" hint="Optional. Session will close after this date.">
            <input
              type="date"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 min-h-[60px] resize-y"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes for voters..."
            />
          </Field>

          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => { setShowNew(false); resetNewForm() }} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit Session Modal */}
      {editSession && (
        <Modal title="Edit Session" onClose={() => setEditSession(null)}>
          <Field label="Session Name" required>
            <input
              autoFocus
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={editName}
              onChange={e => setEditName(e.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Tokens FOR">
              <input
                type="number"
                min={1}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={editTokensFor}
                onChange={e => setEditTokensFor(Number(e.target.value))}
              />
            </Field>
            <Field label="Tokens AGAINST">
              <input
                type="number"
                min={0}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={editTokensAgainst}
                onChange={e => setEditTokensAgainst(Number(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-accent/30 min-h-[60px] resize-y"
              value={editNotes}
              onChange={e => setEditNotes(e.target.value)}
            />
          </Field>
          <div className="flex justify-end gap-3 mt-4">
            <button onClick={() => setEditSession(null)} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
            <button
              onClick={handleSaveEdit}
              disabled={!editName.trim() || saving}
              className="btn-primary px-6 py-2 text-sm disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteId !== null && (
        <ConfirmDialog
          message="Delete this voting session? All votes will be permanently removed."
          onConfirm={handleDelete}
          onCancel={() => setDeleteId(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  )
}
