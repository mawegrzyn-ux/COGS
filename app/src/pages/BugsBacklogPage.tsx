import { useState, useEffect, useCallback, useMemo } from 'react'
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
  created_at: string; updated_at: string
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function BugsBacklogPage() {
  const api = useApi()
  const { can, isDev } = usePermissions()

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
  const [backlogFilter, setBacklogFilter] = useState({ status: '', priority: '', item_type: '', search: '' })
  const [showBacklogModal, setShowBacklogModal] = useState(false)
  const [backlogDetail, setBacklogDetail] = useState<BacklogItem | null>(null)
  const [backlogForm, setBacklogForm] = useState({ summary: '', description: '', item_type: 'story', priority: 'medium', acceptance_criteria: '', story_points: '' })
  const [deleteBacklog, setDeleteBacklog] = useState<BacklogItem | null>(null)

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
      const qs = params.toString()
      const data = await api.get(`/backlog${qs ? `?${qs}` : ''}`)
      setBacklog(data?.rows || [])
      setBacklogTotal(data?.total || 0)
    } finally { setBacklogLoading(false) }
  }, [api, backlogFilter])

  useEffect(() => { loadBugs() }, [loadBugs])
  useEffect(() => { loadBacklog() }, [loadBacklog])
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
    const payload = { ...backlogForm, story_points: backlogForm.story_points ? parseInt(backlogForm.story_points) : null }
    await api.post('/backlog', payload)
    setShowBacklogModal(false)
    setBacklogForm({ summary: '', description: '', item_type: 'story', priority: 'medium', acceptance_criteria: '', story_points: '' })
    setToast({ message: 'Backlog item created', type: 'success' })
    loadBacklog()
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
  }

  async function moveBacklog(id: number, dir: -1 | 1) {
    const idx = backlog.findIndex(b => b.id === id)
    if (idx < 0) return
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= backlog.length) return
    const items = [
      { id: backlog[idx].id, sort_order: backlog[swapIdx].sort_order },
      { id: backlog[swapIdx].id, sort_order: backlog[idx].sort_order },
    ]
    await api.put('/backlog/reorder', { items })
    loadBacklog()
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

  // ── Render ─────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: 'bugs', label: 'Bugs', count: bugsTotal },
    { key: 'backlog', label: 'Backlog', count: backlogTotal },
  ]

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-4">
      <PageHeader title="Bugs & Backlog" subtitle="Track issues and manage the development backlog" />

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
                      onClick={() => setBugDetail(b)}>
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
                    {can('backlog', 'write') && <th className="px-2 py-2 w-16">Order</th>}
                    <th className="px-3 py-2 w-28">Key</th>
                    <th className="px-3 py-2">Summary</th>
                    <th className="px-3 py-2 w-24">Type</th>
                    <th className="px-3 py-2 w-24">Priority</th>
                    <th className="px-3 py-2 w-28">Status</th>
                    <th className="px-3 py-2 w-16">Points</th>
                    <th className="px-3 py-2 w-28">Date</th>
                    {isDev && <th className="px-3 py-2 w-16" />}
                  </tr>
                </thead>
                <tbody>
                  {backlog.map((b, i) => (
                    <tr key={b.id} className="border-b border-border/50 hover:bg-surface-2 cursor-pointer"
                      onClick={() => setBacklogDetail(b)}>
                      {can('backlog', 'write') && (
                        <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-0.5 justify-center">
                            <button className="text-text-3 hover:text-text-1 disabled:opacity-30" disabled={i === 0}
                              onClick={() => moveBacklog(b.id, -1)}>▲</button>
                            <button className="text-text-3 hover:text-text-1 disabled:opacity-30" disabled={i === backlog.length - 1}
                              onClick={() => moveBacklog(b.id, 1)}>▼</button>
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-2 font-mono text-xs text-accent">{b.key}</td>
                      <td className="px-3 py-2 font-medium truncate max-w-[300px]">{b.summary}</td>
                      <td className="px-3 py-2"><Badge label={b.item_type} variant="neutral" /></td>
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

      {/* Bug detail modal */}
      {bugDetail && (
        <Modal title={bugDetail.key} onClose={() => setBugDetail(null)} width="max-w-2xl">
          <div className="space-y-3">
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
            <div className="flex justify-end gap-2 pt-2">
              {isDev && <button className="btn-ghost text-red-600 text-sm" onClick={() => { setBugDetail(null); setDeleteBug(bugDetail) }}>Delete</button>}
              <button className="btn-ghost" onClick={() => setBugDetail(null)}>Close</button>
            </div>
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

      {/* Backlog detail modal */}
      {backlogDetail && (
        <Modal title={backlogDetail.key} onClose={() => setBacklogDetail(null)} width="max-w-2xl">
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">{backlogDetail.summary}</h3>
            <div className="flex flex-wrap gap-2">
              <Badge label={backlogDetail.item_type} variant="neutral" />
              <PriorityBadge priority={backlogDetail.priority} />
              <StatusBadge status={backlogDetail.status} />
              {backlogDetail.story_points && <Badge label={`${backlogDetail.story_points} pts`} variant="green" />}
            </div>
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
            <div className="flex justify-end gap-2 pt-2">
              {isDev && <button className="btn-ghost text-red-600 text-sm" onClick={() => { setBacklogDetail(null); setDeleteBacklog(backlogDetail) }}>Delete</button>}
              <button className="btn-ghost" onClick={() => setBacklogDetail(null)}>Close</button>
            </div>
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
