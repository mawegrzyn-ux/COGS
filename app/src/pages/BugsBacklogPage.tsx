import { useState, useEffect, useCallback, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'
import { PageHeader, Modal, Field, Spinner, Toast, Badge, ConfirmDialog } from '../components/ui'

// ── Types ────────────────────────────────────────────────────────────────────

interface Bug {
  id: number; key: string; summary: string; description: string | null
  priority: string; status: string; severity: string
  reported_by: string | null; reported_by_email: string | null
  assigned_to: string | null; page: string | null
  steps_to_reproduce: string | null; environment: string | null
  labels: string[]; attachments: any[]; resolution: string | null
  created_at: string; updated_at: string
}

interface BacklogItem {
  id: number; key: string; summary: string; description: string | null
  item_type: string; priority: string; status: string
  requested_by: string | null; requested_by_email: string | null
  assigned_to: string | null; labels: string[]
  acceptance_criteria: string | null; story_points: number | null
  sprint: string | null; sort_order: number
  epic_id: number | null; epic_key: string | null; epic_summary: string | null
  child_count?: number; child_done?: number
  created_at: string; updated_at: string
}

interface EpicSummary {
  id: number; key: string; summary: string; status: string
  child_count: number; child_done: number
}

interface ItemComment {
  id: number; entity_type: 'bug' | 'backlog'; entity_id: number
  user_sub: string | null; user_email: string | null; user_name: string
  comment: string; parent_id: number | null; created_at: string
}

type Tab = 'bugs' | 'backlog'

const BUG_STATUSES  = ['open', 'in_progress', 'resolved', 'closed', 'wont_fix'] as const
const BUG_PRIORITIES = ['highest', 'high', 'medium', 'low', 'lowest'] as const
const BUG_SEVERITIES = ['critical', 'major', 'minor', 'trivial'] as const

const BACKLOG_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done', 'wont_do'] as const
const BACKLOG_TYPES    = ['story', 'task', 'epic', 'improvement'] as const

const PRIORITY_COLOURS: Record<string, string> = {
  highest: 'bg-red-100 text-red-700',
  high:    'bg-orange-100 text-orange-700',
  medium:  'bg-yellow-100 text-yellow-700',
  low:     'bg-blue-100 text-blue-700',
  lowest:  'bg-gray-100 text-gray-500',
}

const SEVERITY_COLOURS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  major:    'bg-orange-100 text-orange-700',
  minor:    'bg-yellow-100 text-yellow-700',
  trivial:  'bg-gray-100 text-gray-500',
}

const STATUS_COLOURS: Record<string, string> = {
  open:        'bg-blue-100 text-blue-700',
  backlog:     'bg-gray-100 text-gray-600',
  todo:        'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  in_review:   'bg-purple-100 text-purple-700',
  resolved:    'bg-green-100 text-green-700',
  closed:      'bg-gray-200 text-gray-600',
  done:        'bg-green-100 text-green-700',
  wont_fix:    'bg-gray-200 text-gray-500',
  wont_do:     'bg-gray-200 text-gray-500',
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOURS[status] || 'bg-gray-100 text-gray-600'}`}>
    {status.replace(/_/g, ' ')}
  </span>
}

function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLOURS[priority] || 'bg-gray-100'}`}>
    {priority}
  </span>
}

function SeverityBadge({ severity }: { severity: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_COLOURS[severity] || 'bg-gray-100'}`}>
    {severity}
  </span>
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function CommentSection({ comments, commentsLoading, commentText, setCommentText, replyTo, setReplyTo, replyText, setReplyText, postingComment, onPost, onDelete, userSub, isDev }: {
  comments: ItemComment[]
  commentsLoading: boolean; commentText: string; setCommentText: (v: string) => void
  replyTo: number | null; setReplyTo: (v: number | null) => void
  replyText: string; setReplyText: (v: string) => void; postingComment: boolean
  onPost: (text: string, parentId?: number | null) => void
  onDelete: (commentId: number) => void
  userSub: string | null | undefined; isDev: boolean
}) {
  const topLevel = comments.filter(c => !c.parent_id)
  const byParent: Record<number, ItemComment[]> = {}
  for (const c of comments) {
    if (c.parent_id) {
      if (!byParent[c.parent_id]) byParent[c.parent_id] = []
      byParent[c.parent_id].push(c)
    }
  }

  return (
    <div className="border-t border-border pt-3 mt-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-text-1">Comments</span>
        <span className="text-xs text-text-3">({topLevel.length})</span>
      </div>

      {commentsLoading ? (
        <div className="text-xs text-text-3 py-2">Loading comments...</div>
      ) : topLevel.length === 0 ? (
        <div className="text-xs text-text-3 py-2">No comments yet</div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {topLevel.map(c => (
            <div key={c.id}>
              {/* Top-level comment */}
              <div className="bg-blue-50 rounded-lg p-2.5 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-text-1 text-xs">{c.user_name}</span>
                  <span className="text-[10px] text-text-3">{fmtTime(c.created_at)}</span>
                  <div className="flex-1" />
                  <button className="text-[10px] text-accent hover:underline" onClick={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText('') }}>
                    {replyTo === c.id ? 'Cancel' : 'Reply'}
                  </button>
                  {(c.user_sub === userSub || isDev) && (
                    <button className="text-[10px] text-red-400 hover:text-red-600" onClick={() => onDelete(c.id)}>Delete</button>
                  )}
                </div>
                <p className="text-text-2 whitespace-pre-wrap break-words text-xs">{c.comment}</p>
              </div>

              {/* Replies */}
              {(byParent[c.id] || []).map(r => (
                <div key={r.id} className="ml-5 mt-1 border-l-2 border-blue-100 pl-2.5">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-medium text-text-1 text-[11px]">{r.user_name}</span>
                    <span className="text-[10px] text-text-3">{fmtTime(r.created_at)}</span>
                    <div className="flex-1" />
                    {(r.user_sub === userSub || isDev) && (
                      <button className="text-[10px] text-red-400 hover:text-red-600" onClick={() => onDelete(r.id)}>Delete</button>
                    )}
                  </div>
                  <p className="text-text-2 whitespace-pre-wrap break-words text-[11px]">{r.comment}</p>
                </div>
              ))}

              {/* Reply input */}
              {replyTo === c.id && (
                <div className="ml-5 mt-1 flex gap-1.5">
                  <input className="input flex-1 text-xs" placeholder="Reply..." value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && replyText.trim()) { e.preventDefault(); onPost(replyText, c.id) } }} />
                  <button className="btn-primary text-xs px-2 py-1" disabled={!replyText.trim() || postingComment}
                    onClick={() => onPost(replyText, c.id)}>Send</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New comment */}
      <div className="flex gap-1.5">
        <textarea className="input flex-1 text-xs" rows={2} placeholder="Add a comment... (Ctrl+Enter to post)" value={commentText}
          onChange={e => setCommentText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commentText.trim()) { e.preventDefault(); onPost(commentText) } }} />
        <button className="btn-primary text-xs px-3 self-end" disabled={!commentText.trim() || postingComment}
          onClick={() => onPost(commentText)}>Post</button>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BugsBacklogPage({ embedded }: { embedded?: boolean } = {}) {
  const api = useApi()
  const { can, isDev, user } = usePermissions()

  const [tab, setTab] = useState<Tab>(() => (localStorage.getItem('bb_tab') as Tab) || 'bugs')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // ── Bugs state ──────────────────────────────────────────────────────────
  const [bugs, setBugs] = useState<Bug[]>([])
  const [bugsTotal, setBugsTotal] = useState(0)
  const [bugsLoading, setBugsLoading] = useState(true)
  const [bugFilter, setBugFilter] = useState({ status: '', priority: '', severity: '', search: '' })
  const [showBugModal, setShowBugModal] = useState(false)
  const [bugDetail, setBugDetail] = useState<Bug | null>(null)
  const [bugForm, setBugForm] = useState({ summary: '', description: '', priority: 'medium', severity: 'minor', page: '', steps_to_reproduce: '' })
  const [deleteBug, setDeleteBug] = useState<Bug | null>(null)

  // ── Backlog state ───────────────────────────────────────────────────────
  const [backlog, setBacklog] = useState<BacklogItem[]>([])
  const [backlogTotal, setBacklogTotal] = useState(0)
  const [backlogLoading, setBacklogLoading] = useState(true)
  const [backlogFilter, setBacklogFilter] = useState({ status: '', priority: '', item_type: '', search: '', epic_id: '' })
  const [showBacklogModal, setShowBacklogModal] = useState(false)
  const [backlogDetail, setBacklogDetail] = useState<BacklogItem | null>(null)
  const [backlogForm, setBacklogForm] = useState({ summary: '', description: '', item_type: 'story', priority: 'medium', acceptance_criteria: '', story_points: '', epic_id: '' })
  const [deleteBacklog, setDeleteBacklog] = useState<BacklogItem | null>(null)
  const [epics, setEpics] = useState<EpicSummary[]>([])

  // ── Comments state ────────────────────────────────────────────────────
  const [comments, setComments] = useState<ItemComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [replyTo, setReplyTo] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [postingComment, setPostingComment] = useState(false)

  // ── Edit state ────────────────────────────────────────────────────────
  const [bugEditForm, setBugEditForm] = useState<any>(null)
  const [backlogEditForm, setBacklogEditForm] = useState<any>(null)
  const [canEditBug, setCanEditBug] = useState(false)
  const [canEditBacklog, setCanEditBacklog] = useState(false)

  // ── Load functions ──────────────────────────────────────────────────────

  const loadBugs = useCallback(async () => {
    setBugsLoading(true)
    try {
      const params = new URLSearchParams()
      if (bugFilter.status) params.set('status', bugFilter.status)
      if (bugFilter.priority) params.set('priority', bugFilter.priority)
      if (bugFilter.severity) params.set('severity', bugFilter.severity)
      if (bugFilter.search) params.set('search', bugFilter.search)
      const qs = params.toString()
      const data = await api.get(`/bugs${qs ? `?${qs}` : ''}`)
      setBugs(data?.rows || [])
      setBugsTotal(data?.total || 0)
    } finally { setBugsLoading(false) }
  }, [api, bugFilter])

  const loadBacklog = useCallback(async () => {
    setBacklogLoading(true)
    try {
      const params = new URLSearchParams()
      if (backlogFilter.status) params.set('status', backlogFilter.status)
      if (backlogFilter.priority) params.set('priority', backlogFilter.priority)
      if (backlogFilter.item_type) params.set('item_type', backlogFilter.item_type)
      if (backlogFilter.search) params.set('search', backlogFilter.search)
      if (backlogFilter.epic_id) params.set('epic_id', backlogFilter.epic_id)
      const qs = params.toString()
      const data = await api.get(`/backlog${qs ? `?${qs}` : ''}`)
      setBacklog(data?.rows || [])
      setBacklogTotal(data?.total || 0)
    } finally { setBacklogLoading(false) }
  }, [api, backlogFilter])

  const loadEpics = useCallback(async () => {
    try {
      const data = await api.get('/backlog/epics')
      setEpics(data || [])
    } catch {}
  }, [api])

  useEffect(() => { loadBugs() }, [loadBugs])
  useEffect(() => { loadBacklog() }, [loadBacklog])
  useEffect(() => { loadEpics() }, [loadEpics])
  useEffect(() => { localStorage.setItem('bb_tab', tab) }, [tab])

  // ── Bug handlers ────────────────────────────────────────────────────────

  async function createBug() {
    if (!bugForm.summary.trim()) return
    await api.post('/bugs', bugForm)
    setShowBugModal(false)
    setBugForm({ summary: '', description: '', priority: 'medium', severity: 'minor', page: '', steps_to_reproduce: '' })
    setToast({ message: 'Bug logged', type: 'success' })
    loadBugs()
  }

  async function updateBugStatus(id: number, status: string) {
    await api.put(`/bugs/${id}`, { status })
    setToast({ message: 'Status updated', type: 'success' })
    loadBugs()
    if (bugDetail?.id === id) setBugDetail(prev => prev ? { ...prev, status } : null)
  }

  async function confirmDeleteBug() {
    if (!deleteBug) return
    await api.delete(`/bugs/${deleteBug.id}`)
    setDeleteBug(null)
    setBugDetail(null)
    setToast({ message: `${deleteBug.key} deleted`, type: 'success' })
    loadBugs()
  }

  // ── Backlog handlers ───────────────────────────────────────────────────

  async function createBacklogItem() {
    if (!backlogForm.summary.trim()) return
    const payload = {
      ...backlogForm,
      story_points: backlogForm.story_points ? parseInt(backlogForm.story_points) : null,
      epic_id: backlogForm.epic_id ? parseInt(backlogForm.epic_id) : null,
    }
    await api.post('/backlog', payload)
    setShowBacklogModal(false)
    setBacklogForm({ summary: '', description: '', item_type: 'story', priority: 'medium', acceptance_criteria: '', story_points: '', epic_id: '' })
    setToast({ message: 'Backlog item created', type: 'success' })
    loadBacklog()
    loadEpics()
  }

  async function updateBacklogStatus(id: number, status: string) {
    await api.put(`/backlog/${id}`, { status })
    setToast({ message: 'Status updated', type: 'success' })
    loadBacklog()
    if (backlogDetail?.id === id) setBacklogDetail(prev => prev ? { ...prev, status } : null)
  }

  async function confirmDeleteBacklog() {
    if (!deleteBacklog) return
    await api.delete(`/backlog/${deleteBacklog.id}`)
    setDeleteBacklog(null)
    setBacklogDetail(null)
    setToast({ message: `${deleteBacklog.key} deleted`, type: 'success' })
    loadBacklog()
    loadEpics()
  }

  // ── Drag-and-drop reorder ─────────────────────────────────────────────
  const dragIdRef    = useRef<number | null>(null)
  const dragOverRef  = useRef<number | null>(null)

  function handleDragStart(id: number) { dragIdRef.current = id }

  function handleDragOver(e: React.DragEvent, id: number) {
    e.preventDefault()
    dragOverRef.current = id
  }

  async function handleDrop() {
    const fromId = dragIdRef.current
    const toId   = dragOverRef.current
    dragIdRef.current = null
    dragOverRef.current = null
    if (fromId == null || toId == null || fromId === toId) return
    const fromIdx = backlog.findIndex(b => b.id === fromId)
    const toIdx   = backlog.findIndex(b => b.id === toId)
    if (fromIdx < 0 || toIdx < 0) return

    // Optimistic reorder in state
    const next = [...backlog]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    setBacklog(next)

    // Persist new sort_order for all items (simple sequential numbering)
    const items = next.map((b, i) => ({ id: b.id, sort_order: i + 1 }))
    try {
      await api.put('/backlog/reorder', { items })
    } catch {
      loadBacklog() // rollback on failure
    }
  }

  async function exportJira(type: 'bugs' | 'backlog') {
    const data = await api.get(`/${type}/export/jira`)
    if (!data?.length) { setToast({ message: 'Nothing to export', type: 'error' }); return }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${type}-jira-export.json`; a.click()
    URL.revokeObjectURL(url)
    setToast({ message: `Exported ${data.length} items`, type: 'success' })
  }

  // ── Comment helpers ───────────────────────────────────────────────────

  async function loadComments(entityType: 'bug' | 'backlog', entityId: number) {
    setCommentsLoading(true)
    try {
      const route = entityType === 'bug' ? 'bugs' : 'backlog'
      const data = await api.get(`/${route}/${entityId}/comments`)
      setComments(data || [])
    } finally { setCommentsLoading(false) }
  }

  async function postComment(entityType: 'bug' | 'backlog', entityId: number, text: string, parentId?: number | null) {
    if (!text.trim()) return
    setPostingComment(true)
    try {
      const route = entityType === 'bug' ? 'bugs' : 'backlog'
      await api.post(`/${route}/${entityId}/comments`, { comment: text.trim(), parent_id: parentId || null })
      setCommentText('')
      setReplyTo(null)
      setReplyText('')
      loadComments(entityType, entityId)
    } finally { setPostingComment(false) }
  }

  async function deleteComment(entityType: 'bug' | 'backlog', entityId: number, commentId: number) {
    const route = entityType === 'bug' ? 'bugs' : 'backlog'
    await api.delete(`/${route}/${entityId}/comments/${commentId}`)
    loadComments(entityType, entityId)
  }

  // ── Open detail with edit check + comments ────────────────────────────

  async function openBugDetail(bug: Bug) {
    setBugDetail(bug)
    setCommentText(''); setReplyTo(null); setReplyText('')
    try {
      const full = await api.get(`/bugs/${bug.id}`)
      if (full) {
        setBugDetail(full)
        setCanEditBug(!!full.can_edit)
        setBugEditForm({ summary: full.summary, description: full.description || '', priority: full.priority, severity: full.severity, page: full.page || '', steps_to_reproduce: full.steps_to_reproduce || '', resolution: full.resolution || '' })
      }
    } catch {}
    loadComments('bug', bug.id)
  }

  async function openBacklogDetail(item: BacklogItem) {
    setBacklogDetail(item)
    setCommentText(''); setReplyTo(null); setReplyText('')
    try {
      const full = await api.get(`/backlog/${item.id}`)
      if (full) {
        setBacklogDetail(full)
        setCanEditBacklog(!!full.can_edit)
        setBacklogEditForm({ summary: full.summary, description: full.description || '', item_type: full.item_type, priority: full.priority, acceptance_criteria: full.acceptance_criteria || '', story_points: full.story_points ? String(full.story_points) : '', epic_id: full.epic_id ? String(full.epic_id) : '' })
      }
    } catch {}
    loadComments('backlog', item.id)
  }

  async function saveBugEdit() {
    if (!bugDetail || !bugEditForm) return
    await api.put(`/bugs/${bugDetail.id}`, bugEditForm)
    setToast({ message: 'Bug updated', type: 'success' })
    loadBugs()
    const updated = await api.get(`/bugs/${bugDetail.id}`)
    if (updated) setBugDetail(updated)
  }

  async function saveBacklogEdit() {
    if (!backlogDetail || !backlogEditForm) return
    const payload = {
      ...backlogEditForm,
      story_points: backlogEditForm.story_points ? parseInt(backlogEditForm.story_points) : null,
      epic_id: backlogEditForm.epic_id ? parseInt(backlogEditForm.epic_id) : null,
    }
    await api.put(`/backlog/${backlogDetail.id}`, payload)
    setToast({ message: 'Backlog item updated', type: 'success' })
    loadBacklog()
    loadEpics()
    const updated = await api.get(`/backlog/${backlogDetail.id}`)
    if (updated) setBacklogDetail(updated)
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'bugs', label: 'Bugs', count: bugsTotal },
    { key: 'backlog', label: 'Backlog', count: backlogTotal },
  ]

  return (
    <div className={`${embedded ? 'p-4' : 'p-6'} max-w-[1400px] mx-auto space-y-4`}>
      {!embedded && <PageHeader title="Bugs & Backlog" subtitle="Track issues and manage the development backlog" />}

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-accent text-accent' : 'border-transparent text-text-3 hover:text-text-1'}`}>
            {t.label}
            <span className="ml-1.5 text-xs text-text-3">({t.count})</span>
          </button>
        ))}
      </div>

      {/* ═══ BUGS TAB ═══ */}
      {tab === 'bugs' && (
        <div className="space-y-3">
          {/* Filters + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-48" placeholder="Search bugs..." value={bugFilter.search}
              onChange={e => setBugFilter(f => ({ ...f, search: e.target.value }))} />
            <select className="input w-36" value={bugFilter.status} onChange={e => setBugFilter(f => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {BUG_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select className="input w-32" value={bugFilter.priority} onChange={e => setBugFilter(f => ({ ...f, priority: e.target.value }))}>
              <option value="">All priorities</option>
              {BUG_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="input w-32" value={bugFilter.severity} onChange={e => setBugFilter(f => ({ ...f, severity: e.target.value }))}>
              <option value="">All severities</option>
              {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex-1" />
            {isDev && <button className="btn-outline text-xs" onClick={() => exportJira('bugs')}>Export Jira</button>}
            <button className="btn-primary text-sm" onClick={() => setShowBugModal(true)}>+ Log Bug</button>
          </div>

          {/* Table */}
          {bugsLoading ? <Spinner /> : !bugs.length ? (
            <div className="text-center text-text-3 py-12">No bugs found</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-3 border-b border-border">
                    <th className="px-3 py-2 w-24">Key</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2 w-24">Priority</th>
                    <th className="px-3 py-2 w-24">Severity</th>
                    <th className="px-3 py-2 w-28">Status</th>
                    <th className="px-3 py-2 w-32">Reported</th>
                    <th className="px-3 py-2 w-28">Date</th>
                    {isDev && <th className="px-3 py-2 w-16" />}
                  </tr>
                </thead>
                <tbody>
                  {bugs.map(b => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-surface-2 cursor-pointer"
                      onClick={() => openBugDetail(b)}>
                      <td className="px-3 py-2 font-mono text-xs text-accent">{b.key}</td>
                      <td className="px-3 py-2 font-medium truncate max-w-[300px]">{b.summary}</td>
                      <td className="px-3 py-2"><PriorityBadge priority={b.priority} /></td>
                      <td className="px-3 py-2"><SeverityBadge severity={b.severity} /></td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {isDev ? (
                          <select className="text-xs border rounded px-1 py-0.5" value={b.status}
                            onChange={e => updateBugStatus(b.id, e.target.value)}>
                            {BUG_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                          </select>
                        ) : <StatusBadge status={b.status} />}
                      </td>
                      <td className="px-3 py-2 text-xs text-text-3 truncate">{b.reported_by_email || '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-3">{fmtDate(b.created_at)}</td>
                      {isDev && (
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <button className="text-red-400 hover:text-red-600 text-xs" onClick={() => setDeleteBug(b)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ BACKLOG TAB ═══ */}
      {tab === 'backlog' && (
        <div className="space-y-3">
          {/* Filters + actions */}
          <div className="flex flex-wrap items-center gap-2">
            <input className="input w-48" placeholder="Search backlog..." value={backlogFilter.search}
              onChange={e => setBacklogFilter(f => ({ ...f, search: e.target.value }))} />
            <select className="input w-36" value={backlogFilter.status} onChange={e => setBacklogFilter(f => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {BACKLOG_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select className="input w-32" value={backlogFilter.priority} onChange={e => setBacklogFilter(f => ({ ...f, priority: e.target.value }))}>
              <option value="">All priorities</option>
              {BUG_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select className="input w-32" value={backlogFilter.item_type} onChange={e => setBacklogFilter(f => ({ ...f, item_type: e.target.value }))}>
              <option value="">All types</option>
              {BACKLOG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select className="input w-40" value={backlogFilter.epic_id} onChange={e => setBacklogFilter(f => ({ ...f, epic_id: e.target.value }))}>
              <option value="">All epics</option>
              {epics.map(ep => <option key={ep.id} value={ep.id}>{ep.key} — {ep.summary.length > 30 ? ep.summary.slice(0, 30) + '…' : ep.summary}</option>)}
            </select>
            <div className="flex-1" />
            {isDev && <button className="btn-outline text-xs" onClick={() => exportJira('backlog')}>Export Jira</button>}
            {can('backlog', 'write') && <button className="btn-primary text-sm" onClick={() => setShowBacklogModal(true)}>+ Add Item</button>}
          </div>

          {/* Table */}
          {backlogLoading ? <Spinner /> : !backlog.length ? (
            <div className="text-center text-text-3 py-12">No backlog items found</div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-text-3 border-b border-border">
                    {can('backlog', 'write') && <th className="px-2 py-2 w-10" title="Drag to reorder" />}
                    <th className="px-3 py-2 w-28">Key</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2 w-24">Type</th>
                    <th className="px-3 py-2 w-36">Epic</th>
                    <th className="px-3 py-2 w-24">Priority</th>
                    <th className="px-3 py-2 w-28">Status</th>
                    <th className="px-3 py-2 w-16">Points</th>
                    <th className="px-3 py-2 w-28">Date</th>
                    {isDev && <th className="px-3 py-2 w-16" />}
                  </tr>
                </thead>
                <tbody>
                  {backlog.map((b) => (
                    <tr key={b.id}
                      className="border-b border-border/50 hover:bg-surface-2 cursor-pointer"
                      draggable={can('backlog', 'write') || false}
                      onDragStart={() => handleDragStart(b.id)}
                      onDragOver={e => handleDragOver(e, b.id)}
                      onDrop={handleDrop}
                      onClick={() => openBacklogDetail(b)}>
                      {can('backlog', 'write') && (
                        <td className="px-2 py-2 text-center cursor-grab active:cursor-grabbing" onClick={e => e.stopPropagation()}>
                          <svg className="w-4 h-4 text-text-3 mx-auto" fill="currentColor" viewBox="0 0 24 24">
                            <circle cx="9" cy="6" r="1.5" /><circle cx="15" cy="6" r="1.5" />
                            <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
                            <circle cx="9" cy="18" r="1.5" /><circle cx="15" cy="18" r="1.5" />
                          </svg>
                        </td>
                      )}
                      <td className="px-3 py-2 font-mono text-xs text-accent">{b.key}</td>
                      <td className="px-3 py-2 font-medium truncate max-w-[300px]">
                        {b.item_type === 'epic' && <span className="text-purple-600 mr-1">⬡</span>}
                        {b.summary}
                        {b.item_type === 'epic' && b.child_count != null && b.child_count > 0 && (
                          <span className="ml-2 text-xs text-text-3">({b.child_done ?? 0}/{b.child_count})</span>
                        )}
                      </td>
                      <td className="px-3 py-2"><Badge label={b.item_type} variant={b.item_type === 'epic' ? 'yellow' : 'neutral'} /></td>
                      <td className="px-3 py-2 text-xs truncate max-w-[120px]">
                        {b.epic_key ? (
                          <span className="inline-flex items-center gap-1 text-purple-600" title={b.epic_summary || ''}>
                            <span className="font-mono">{b.epic_key}</span>
                          </span>
                        ) : b.item_type !== 'epic' ? <span className="text-text-3">—</span> : null}
                      </td>
                      <td className="px-3 py-2"><PriorityBadge priority={b.priority} /></td>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                        {isDev ? (
                          <select className="text-xs border rounded px-1 py-0.5" value={b.status}
                            onChange={e => updateBacklogStatus(b.id, e.target.value)}>
                            {BACKLOG_STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
                          </select>
                        ) : <StatusBadge status={b.status} />}
                      </td>
                      <td className="px-3 py-2 text-center text-xs font-mono">{b.story_points ?? '—'}</td>
                      <td className="px-3 py-2 text-xs text-text-3">{fmtDate(b.created_at)}</td>
                      {isDev && (
                        <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                          <button className="text-red-400 hover:text-red-600 text-xs" onClick={() => setDeleteBacklog(b)}>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══ MODALS ═══ */}

      {/* Log Bug modal */}
      {showBugModal && (
        <Modal title="Log Bug" onClose={() => setShowBugModal(false)}>
          <div className="space-y-3">
            <Field label="Summary" required>
              <input className="input w-full" value={bugForm.summary}
                onChange={e => setBugForm(f => ({ ...f, summary: e.target.value }))}
                placeholder="Short description of the bug" autoFocus />
            </Field>
            <Field label="Description">
              <textarea className="input w-full" rows={3} value={bugForm.description}
                onChange={e => setBugForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Detailed description..." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Priority">
                <select className="input w-full" value={bugForm.priority}
                  onChange={e => setBugForm(f => ({ ...f, priority: e.target.value }))}>
                  {BUG_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Severity">
                <select className="input w-full" value={bugForm.severity}
                  onChange={e => setBugForm(f => ({ ...f, severity: e.target.value }))}>
                  {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Page / Module">
              <input className="input w-full" value={bugForm.page}
                onChange={e => setBugForm(f => ({ ...f, page: e.target.value }))}
                placeholder="e.g. Menus, Inventory..." />
            </Field>
            <Field label="Steps to Reproduce">
              <textarea className="input w-full" rows={3} value={bugForm.steps_to_reproduce}
                onChange={e => setBugForm(f => ({ ...f, steps_to_reproduce: e.target.value }))}
                placeholder="1. Go to...\n2. Click on...\n3. Observe..." />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowBugModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={createBug} disabled={!bugForm.summary.trim()}>Log Bug</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Bug detail / edit modal */}
      {bugDetail && (
        <Modal title={bugDetail.key} onClose={() => { setBugDetail(null); setCanEditBug(false); setBugEditForm(null) }} width="max-w-3xl">
          <div className="space-y-3">
            {/* Editable fields or read-only display */}
            {canEditBug && bugEditForm ? (
              <>
                <Field label="Summary" required>
                  <input className="input w-full" value={bugEditForm.summary}
                    onChange={e => setBugEditForm((f: any) => ({ ...f, summary: e.target.value }))} />
                </Field>
                <Field label="Description">
                  <textarea className="input w-full" rows={3} value={bugEditForm.description}
                    onChange={e => setBugEditForm((f: any) => ({ ...f, description: e.target.value }))} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Priority">
                    <select className="input w-full" value={bugEditForm.priority}
                      onChange={e => setBugEditForm((f: any) => ({ ...f, priority: e.target.value }))}>
                      {BUG_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </Field>
                  <Field label="Severity">
                    <select className="input w-full" value={bugEditForm.severity}
                      onChange={e => setBugEditForm((f: any) => ({ ...f, severity: e.target.value }))}>
                      {BUG_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Page / Module">
                  <input className="input w-full" value={bugEditForm.page}
                    onChange={e => setBugEditForm((f: any) => ({ ...f, page: e.target.value }))} />
                </Field>
                <Field label="Steps to Reproduce">
                  <textarea className="input w-full" rows={3} value={bugEditForm.steps_to_reproduce}
                    onChange={e => setBugEditForm((f: any) => ({ ...f, steps_to_reproduce: e.target.value }))} />
                </Field>
                <Field label="Resolution">
                  <textarea className="input w-full" rows={2} value={bugEditForm.resolution}
                    onChange={e => setBugEditForm((f: any) => ({ ...f, resolution: e.target.value }))} />
                </Field>
                <div className="flex items-center gap-2">
                  <StatusBadge status={bugDetail.status} />
                  <span className="text-xs text-text-3">Reported by {bugDetail.reported_by_email || '—'} · {fmtDate(bugDetail.created_at)}</span>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  {isDev && <button className="btn-ghost text-red-600 text-sm" onClick={() => { setBugDetail(null); setDeleteBug(bugDetail) }}>Delete</button>}
                  <button className="btn-ghost" onClick={() => { setBugDetail(null); setCanEditBug(false); setBugEditForm(null) }}>Cancel</button>
                  <button className="btn-primary text-sm" onClick={saveBugEdit} disabled={!bugEditForm.summary?.trim()}>Save</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">{bugDetail.summary}</h3>
                <div className="flex flex-wrap gap-2">
                  <PriorityBadge priority={bugDetail.priority} />
                  <SeverityBadge severity={bugDetail.severity} />
                  <StatusBadge status={bugDetail.status} />
                </div>
                {bugDetail.description && <p className="text-sm text-text-2 whitespace-pre-wrap">{bugDetail.description}</p>}
                {bugDetail.steps_to_reproduce && (
                  <div>
                    <div className="text-xs text-text-3 font-medium mb-1">Steps to Reproduce</div>
                    <p className="text-sm text-text-2 whitespace-pre-wrap bg-surface-2 rounded p-2">{bugDetail.steps_to_reproduce}</p>
                  </div>
                )}
                {bugDetail.resolution && (
                  <div>
                    <div className="text-xs text-text-3 font-medium mb-1">Resolution</div>
                    <p className="text-sm text-text-2 whitespace-pre-wrap bg-green-50 rounded p-2">{bugDetail.resolution}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs text-text-3">
                  <div>Page: {bugDetail.page || '—'}</div>
                  <div>Reported by: {bugDetail.reported_by_email || '—'}</div>
                  <div>Created: {fmtDate(bugDetail.created_at)}</div>
                  <div>Updated: {fmtDate(bugDetail.updated_at)}</div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  {isDev && <button className="btn-ghost text-red-600 text-sm" onClick={() => { setBugDetail(null); setDeleteBug(bugDetail) }}>Delete</button>}
                  <button className="btn-ghost" onClick={() => setBugDetail(null)}>Close</button>
                </div>
              </>
            )}

            {/* Comments */}
            <CommentSection comments={comments} commentsLoading={commentsLoading}
              commentText={commentText} setCommentText={setCommentText}
              replyTo={replyTo} setReplyTo={setReplyTo}
              replyText={replyText} setReplyText={setReplyText}
              postingComment={postingComment}
              onPost={(text, parentId) => postComment('bug', bugDetail.id, text, parentId)}
              onDelete={(cid) => deleteComment('bug', bugDetail.id, cid)}
              userSub={user?.sub} isDev={isDev} />
          </div>
        </Modal>
      )}

      {/* Add Backlog modal */}
      {showBacklogModal && (
        <Modal title="Add Backlog Item" onClose={() => setShowBacklogModal(false)}>
          <div className="space-y-3">
            <Field label="Summary" required>
              <input className="input w-full" value={backlogForm.summary}
                onChange={e => setBacklogForm(f => ({ ...f, summary: e.target.value }))}
                placeholder="Short description" autoFocus />
            </Field>
            <Field label="Description">
              <textarea className="input w-full" rows={3} value={backlogForm.description}
                onChange={e => setBacklogForm(f => ({ ...f, description: e.target.value }))} />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Type">
                <select className="input w-full" value={backlogForm.item_type}
                  onChange={e => setBacklogForm(f => ({ ...f, item_type: e.target.value }))}>
                  {BACKLOG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Priority">
                <select className="input w-full" value={backlogForm.priority}
                  onChange={e => setBacklogForm(f => ({ ...f, priority: e.target.value }))}>
                  {BUG_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
              <Field label="Story Points">
                <input className="input w-full" type="number" min={0} value={backlogForm.story_points}
                  onChange={e => setBacklogForm(f => ({ ...f, story_points: e.target.value }))} />
              </Field>
            </div>
            {backlogForm.item_type !== 'epic' && epics.length > 0 && (
              <Field label="Epic">
                <select className="input w-full" value={backlogForm.epic_id}
                  onChange={e => setBacklogForm(f => ({ ...f, epic_id: e.target.value }))}>
                  <option value="">— No epic —</option>
                  {epics.map(ep => <option key={ep.id} value={ep.id}>{ep.key} — {ep.summary}</option>)}
                </select>
              </Field>
            )}
            <Field label="Acceptance Criteria">
              <textarea className="input w-full" rows={3} value={backlogForm.acceptance_criteria}
                onChange={e => setBacklogForm(f => ({ ...f, acceptance_criteria: e.target.value }))}
                placeholder="Given... When... Then..." />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setShowBacklogModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={createBacklogItem} disabled={!backlogForm.summary.trim()}>Add Item</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Backlog detail / edit modal */}
      {backlogDetail && (
        <Modal title={backlogDetail.key} onClose={() => { setBacklogDetail(null); setCanEditBacklog(false); setBacklogEditForm(null) }} width="max-w-3xl">
          <div className="space-y-3">
            {canEditBacklog && backlogEditForm ? (
              <>
                <Field label="Summary" required>
                  <input className="input w-full" value={backlogEditForm.summary}
                    onChange={e => setBacklogEditForm((f: any) => ({ ...f, summary: e.target.value }))} />
                </Field>
                <Field label="Description">
                  <textarea className="input w-full" rows={3} value={backlogEditForm.description}
                    onChange={e => setBacklogEditForm((f: any) => ({ ...f, description: e.target.value }))} />
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Type">
                    <select className="input w-full" value={backlogEditForm.item_type}
                      onChange={e => setBacklogEditForm((f: any) => ({ ...f, item_type: e.target.value }))}>
                      {BACKLOG_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Priority">
                    <select className="input w-full" value={backlogEditForm.priority}
                      onChange={e => setBacklogEditForm((f: any) => ({ ...f, priority: e.target.value }))}>
                      {BUG_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </Field>
                  <Field label="Story Points">
                    <input className="input w-full" type="number" min={0} value={backlogEditForm.story_points}
                      onChange={e => setBacklogEditForm((f: any) => ({ ...f, story_points: e.target.value }))} />
                  </Field>
                </div>
                {backlogEditForm.item_type !== 'epic' && epics.length > 0 && (
                  <Field label="Epic">
                    <select className="input w-full" value={backlogEditForm.epic_id || ''}
                      onChange={e => setBacklogEditForm((f: any) => ({ ...f, epic_id: e.target.value }))}>
                      <option value="">— No epic —</option>
                      {epics.filter(ep => ep.id !== backlogDetail.id).map(ep => <option key={ep.id} value={ep.id}>{ep.key} — {ep.summary}</option>)}
                    </select>
                  </Field>
                )}
                <Field label="Acceptance Criteria">
                  <textarea className="input w-full" rows={3} value={backlogEditForm.acceptance_criteria}
                    onChange={e => setBacklogEditForm((f: any) => ({ ...f, acceptance_criteria: e.target.value }))} />
                </Field>
                <div className="flex items-center gap-2">
                  <Badge label={backlogDetail.item_type} variant={backlogDetail.item_type === 'epic' ? 'yellow' : 'neutral'} />
                  <StatusBadge status={backlogDetail.status} />
                  <span className="text-xs text-text-3">Requested by {backlogDetail.requested_by_email || '—'} · {fmtDate(backlogDetail.created_at)}</span>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  {isDev && <button className="btn-ghost text-red-600 text-sm" onClick={() => { setBacklogDetail(null); setDeleteBacklog(backlogDetail) }}>Delete</button>}
                  <button className="btn-ghost" onClick={() => { setBacklogDetail(null); setCanEditBacklog(false); setBacklogEditForm(null) }}>Cancel</button>
                  <button className="btn-primary text-sm" onClick={saveBacklogEdit} disabled={!backlogEditForm.summary?.trim()}>Save</button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">
                  {backlogDetail.item_type === 'epic' && <span className="text-purple-600 mr-1">⬡</span>}
                  {backlogDetail.summary}
                </h3>
                <div className="flex flex-wrap gap-2">
                  <Badge label={backlogDetail.item_type} variant={backlogDetail.item_type === 'epic' ? 'yellow' : 'neutral'} />
                  <PriorityBadge priority={backlogDetail.priority} />
                  <StatusBadge status={backlogDetail.status} />
                  {backlogDetail.story_points && <Badge label={`${backlogDetail.story_points} pts`} variant="green" />}
                  {backlogDetail.epic_key && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                      ⬡ {backlogDetail.epic_key}
                    </span>
                  )}
                </div>
                {backlogDetail.item_type === 'epic' && backlogDetail.child_count != null && backlogDetail.child_count > 0 && (
                  <div className="bg-surface-2 rounded-lg p-3">
                    <div className="text-xs text-text-3 mb-1 font-medium">Epic Progress — {backlogDetail.child_done ?? 0} / {backlogDetail.child_count} stories done</div>
                    <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${Math.round(((backlogDetail.child_done ?? 0) / backlogDetail.child_count) * 100)}%` }} />
                    </div>
                  </div>
                )}
                {backlogDetail.description && <p className="text-sm text-text-2 whitespace-pre-wrap">{backlogDetail.description}</p>}
                {backlogDetail.acceptance_criteria && (
                  <div>
                    <div className="text-xs text-text-3 font-medium mb-1">Acceptance Criteria</div>
                    <p className="text-sm text-text-2 whitespace-pre-wrap bg-surface-2 rounded p-2">{backlogDetail.acceptance_criteria}</p>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 text-xs text-text-3">
                  <div>Requested by: {backlogDetail.requested_by_email || '—'}</div>
                  <div>Sprint: {backlogDetail.sprint || '—'}</div>
                  <div>Created: {fmtDate(backlogDetail.created_at)}</div>
                  <div>Updated: {fmtDate(backlogDetail.updated_at)}</div>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  {isDev && <button className="btn-ghost text-red-600 text-sm" onClick={() => { setBacklogDetail(null); setDeleteBacklog(backlogDetail) }}>Delete</button>}
                  <button className="btn-ghost" onClick={() => setBacklogDetail(null)}>Close</button>
                </div>
              </>
            )}

            {/* Comments */}
            <CommentSection comments={comments} commentsLoading={commentsLoading}
              commentText={commentText} setCommentText={setCommentText}
              replyTo={replyTo} setReplyTo={setReplyTo}
              replyText={replyText} setReplyText={setReplyText}
              postingComment={postingComment}
              onPost={(text, parentId) => postComment('backlog', backlogDetail.id, text, parentId)}
              onDelete={(cid) => deleteComment('backlog', backlogDetail.id, cid)}
              userSub={user?.sub} isDev={isDev} />
          </div>
        </Modal>
      )}

      {/* Confirm delete dialogs */}
      {deleteBug && <ConfirmDialog message={`Delete ${deleteBug.key}? This cannot be undone.`} danger onConfirm={confirmDeleteBug} onCancel={() => setDeleteBug(null)} />}
      {deleteBacklog && <ConfirmDialog message={`Delete ${deleteBacklog.key}? This cannot be undone.`} danger onConfirm={confirmDeleteBacklog} onCancel={() => setDeleteBacklog(null)} />}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
