import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useAuth0 } from '@auth0/auth0-react'
import ImageEditor from './ImageEditor'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MediaItem {
  id: number
  filename: string
  original_filename: string
  url: string
  thumb_url: string | null
  web_url: string | null
  storage_type: 'local' | 's3'
  mime_type: string
  size_bytes: number
  width: number | null
  height: number | null
  scope: 'shared' | 'form'
  form_key: string | null
  category_id: number | null
  category_name: string | null
  uploaded_by: string | null
  created_at: string
  duplicate_of?: string | null
}

interface MediaCategory {
  id: number
  name: string
  sort_order: number
  item_count: number
}

interface MediaLibraryProps {
  open: boolean
  onClose: () => void
  onInsert?: (url: string, item: MediaItem) => void
  formKey?: string
  onEditImage?: (item: MediaItem) => void
  mode?: 'modal' | 'page'   // 'modal' (default) uses portal+backdrop; 'page' renders inline
}

interface UploadChip {
  file: File
  preview: string
  status: 'uploading' | 'done' | 'error'
  error?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString()
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MediaLibrary({ open, onClose, onInsert, formKey, onEditImage, mode = 'modal' }: MediaLibraryProps) {
  const { getAccessTokenSilently } = useAuth0()

  // Data
  const [items, setItems] = useState<MediaItem[]>([])
  const [categories, setCategories] = useState<MediaCategory[]>([])
  const [loading, setLoading] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [activeCatId, setActiveCatId] = useState<number | 'none' | null>(null) // null = All

  // View
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [fullscreen, setFullscreen] = useState(false)

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  // Upload
  const [uploadCatId, setUploadCatId] = useState<number | null>(null)
  const [chips, setChips] = useState<UploadChip[]>([])
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  // New category inline input
  const [newCatName, setNewCatName] = useState('')
  const [showNewCat, setShowNewCat] = useState(false)
  const newCatRef = useRef<HTMLInputElement>(null)

  // Detail panel
  const [detailItem, setDetailItem] = useState<MediaItem | null>(null)
  const [editFilename, setEditFilename] = useState('')
  const [editCatId, setEditCatId] = useState<number | null>(null)
  const [editingFilename, setEditingFilename] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)

  // Panel resize
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelWidth, setPanelWidth] = useState(280)
  const resizing = useRef(false)
  const resizeStartX = useRef(0)
  const resizeStartW = useRef(0)

  // Bulk action
  const [bulkCatId, setBulkCatId] = useState<number | null>(null)

  // Image editor
  const [editingImage, setEditingImage] = useState<MediaItem | null>(null)

  // ── Auth helper ─────────────────────────────────────────────────────────────

  async function authHeaders(): Promise<HeadersInit> {
    const token = await getAccessTokenSilently()
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
  }

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const token = await getAccessTokenSilently()
      const params = new URLSearchParams()
      if (activeCatId === 'none') params.set('category_id', 'none')
      else if (activeCatId != null) params.set('category_id', String(activeCatId))
      if (search) params.set('q', search)
      if (formKey) params.set('form_key', formKey)
      const res = await fetch(`${API_BASE}/media?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error('Failed to load media')
      const data = await res.json()
      setItems(data.items || [])
      setCategories(data.categories || [])
    } catch {
      // silent — keep stale data
    } finally {
      setLoading(false)
    }
  }, [activeCatId, search, formKey, getAccessTokenSilently])

  useEffect(() => {
    if (open) load()
  }, [open, load])

  // ── ESC key ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  // ── Auto-focus new cat input ─────────────────────────────────────────────────

  useEffect(() => {
    if (showNewCat) setTimeout(() => newCatRef.current?.focus(), 50)
  }, [showNewCat])

  // ── Auto-clear chips ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (chips.length === 0) return
    const allDone = chips.every(c => c.status === 'done' || c.status === 'error')
    if (allDone) {
      const t = setTimeout(() => setChips([]), 2000)
      return () => clearTimeout(t)
    }
  }, [chips])

  // ── Sync detail panel with item changes ─────────────────────────────────────

  useEffect(() => {
    if (detailItem) {
      const fresh = items.find(i => i.id === detailItem.id)
      if (fresh) {
        setDetailItem(fresh)
        setEditFilename(fresh.filename)
        setEditCatId(fresh.category_id)
      }
    }
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Select item (open detail panel) ─────────────────────────────────────────

  function selectItem(item: MediaItem, toggle = false) {
    if (onInsert) {
      // picker mode: single select only
      setSelectedIds(new Set([item.id]))
      setDetailItem(item)
      setEditFilename(item.filename)
      setEditCatId(item.category_id)
      return
    }
    if (toggle) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(item.id)) next.delete(item.id)
        else next.add(item.id)
        return next
      })
      if (!selectedIds.has(item.id)) {
        setDetailItem(item)
        setEditFilename(item.filename)
        setEditCatId(item.category_id)
      }
    } else {
      setSelectedIds(new Set([item.id]))
      setDetailItem(item)
      setEditFilename(item.filename)
      setEditCatId(item.category_id)
    }
  }

  // ── Upload ───────────────────────────────────────────────────────────────────

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!arr.length) return

    // Build chips with preview
    const newChips: UploadChip[] = await Promise.all(arr.map(file => new Promise<UploadChip>(resolve => {
      const reader = new FileReader()
      reader.onload = e => resolve({ file, preview: e.target?.result as string, status: 'uploading' })
      reader.readAsDataURL(file)
    })))
    setChips(prev => [...prev, ...newChips])

    const token = await getAccessTokenSilently()
    const fd = new FormData()
    arr.forEach(f => fd.append('images', f))
    if (uploadCatId != null) fd.append('category_id', String(uploadCatId))
    if (formKey) { fd.append('scope', 'form'); fd.append('form_key', formKey) }
    else fd.append('scope', 'shared')

    try {
      const res = await fetch(`${API_BASE}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      if (!res.ok) throw new Error('Upload failed')
      setChips(prev => prev.map(c => arr.includes(c.file) ? { ...c, status: 'done' } : c))
      await load()
    } catch {
      setChips(prev => prev.map(c => arr.includes(c.file) ? { ...c, status: 'error', error: 'Failed' } : c))
    }
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────────

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current++
    setIsDragOver(true)
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragOver(false)
  }
  function handleDragOver(e: React.DragEvent) { e.preventDefault() }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragOver(false)
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files)
  }

  // ── Category CRUD ────────────────────────────────────────────────────────────

  async function saveNewCategory() {
    const name = newCatName.trim()
    if (!name) { setShowNewCat(false); return }
    try {
      const h = await authHeaders()
      const res = await fetch(`${API_BASE}/media/categories`, {
        method: 'POST', headers: h, body: JSON.stringify({ name }),
      })
      if (!res.ok) throw new Error()
      setNewCatName('')
      setShowNewCat(false)
      await load()
    } catch { /* ignore */ }
  }

  async function deleteCategory(id: number) {
    if (!window.confirm('Delete this category? Items will be moved to Uncategorised.')) return
    try {
      const token = await getAccessTokenSilently()
      await fetch(`${API_BASE}/media/categories/${id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      if (activeCatId === id) setActiveCatId(null)
      await load()
    } catch { /* ignore */ }
  }

  // ── Delete item ───────────────────────────────────────────────────────────────

  async function deleteItem(item: MediaItem) {
    if (!window.confirm(`Delete "${item.filename}"? This cannot be undone.`)) return
    try {
      const token = await getAccessTokenSilently()
      await fetch(`${API_BASE}/media/${item.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      setSelectedIds(prev => { const n = new Set(prev); n.delete(item.id); return n })
      if (detailItem?.id === item.id) setDetailItem(null)
      await load()
    } catch { /* ignore */ }
  }

  // ── Save detail ───────────────────────────────────────────────────────────────

  async function saveDetail() {
    if (!detailItem) return
    setSavingDetail(true)
    try {
      const h = await authHeaders()
      const res = await fetch(`${API_BASE}/media/${detailItem.id}`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({ filename: editFilename, category_id: editCatId }),
      })
      if (!res.ok) throw new Error()
      await load()
    } catch { /* ignore */ } finally {
      setSavingDetail(false)
    }
  }

  // ── Scope toggle ─────────────────────────────────────────────────────────────

  async function toggleScope(item: MediaItem) {
    const newScope = item.scope === 'shared' ? 'form' : 'shared'
    try {
      const h = await authHeaders()
      await fetch(`${API_BASE}/media/${item.id}`, {
        method: 'PUT', headers: h,
        body: JSON.stringify({ scope: newScope }),
      })
      await load()
    } catch { /* ignore */ }
  }

  // ── Bulk actions ─────────────────────────────────────────────────────────────

  async function bulkMove() {
    if (!selectedIds.size) return
    try {
      const h = await authHeaders()
      await fetch(`${API_BASE}/media/bulk`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ ids: [...selectedIds], action: 'move_category', category_id: bulkCatId }),
      })
      await load()
    } catch { /* ignore */ }
  }

  async function bulkDelete() {
    if (!selectedIds.size) return
    if (!window.confirm(`Delete ${selectedIds.size} item(s)? This cannot be undone.`)) return
    try {
      const h = await authHeaders()
      await fetch(`${API_BASE}/media/bulk`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ ids: [...selectedIds], action: 'delete' }),
      })
      setSelectedIds(new Set())
      setDetailItem(null)
      await load()
    } catch { /* ignore */ }
  }

  // ── Save edited image ─────────────────────────────────────────────────────────

  async function saveEditedImage(blob: Blob, mimeType: string) {
    if (!editingImage) return
    const token = await getAccessTokenSilently()
    const ext = mimeType === 'image/png' ? '.png' : '.jpg'
    const file = new File([blob], editingImage.filename.replace(/\.[^.]+$/, ext), { type: mimeType })
    const fd = new FormData()
    fd.append('images', file)
    if (editingImage.category_id != null) fd.append('category_id', String(editingImage.category_id))
    fd.append('scope', editingImage.scope)
    if (editingImage.form_key) fd.append('form_key', editingImage.form_key)
    try {
      // Delete old, upload new
      await fetch(`${API_BASE}/media/${editingImage.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      })
      await fetch(`${API_BASE}/media/upload`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
      })
      setEditingImage(null)
      setDetailItem(null)
      setSelectedIds(new Set())
      await load()
    } catch { /* silent */ }
  }

  // ── Panel resize ─────────────────────────────────────────────────────────────

  function startResize(e: React.MouseEvent) {
    resizing.current = true
    resizeStartX.current = e.clientX
    resizeStartW.current = panelWidth
    document.addEventListener('mousemove', onResizeMove)
    document.addEventListener('mouseup', onResizeUp)
    e.preventDefault()
  }
  function onResizeMove(e: MouseEvent) {
    if (!resizing.current) return
    const delta = resizeStartX.current - e.clientX
    const w = Math.max(200, Math.min(600, resizeStartW.current + delta))
    setPanelWidth(w)
  }
  function onResizeUp() {
    resizing.current = false
    document.removeEventListener('mousemove', onResizeMove)
    document.removeEventListener('mouseup', onResizeUp)
  }

  // ── Computed ─────────────────────────────────────────────────────────────────

  const totalCount = items.length
  const uncatCount = items.filter(i => !i.category_id).length

  const multiSelected = selectedIds.size >= 2
  const singleSelected = selectedIds.size === 1 && !multiSelected

  if (!open) return null

  // ── Render ────────────────────────────────────────────────────────────────────

  // Shared inner content used by both modal and page modes
  const innerContent = (
    <>
        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center bg-accent-dim/80 border-4 border-dashed border-accent rounded-2xl pointer-events-none">
            <div className="text-center">
              <svg className="w-16 h-16 mx-auto text-accent mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
              <p className="text-accent font-bold text-lg">Drop images here</p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-bold text-text-1">Media Library</h2>
            {formKey && (
              <span className="badge-yellow text-xs px-2 py-0.5">Form: {formKey}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Fullscreen toggle (modal mode only) */}
            {mode === 'modal' && (
            <button
              onClick={() => setFullscreen(f => !f)}
              className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors"
              title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            >
              {fullscreen ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M8 3v3a2 2 0 01-2 2H3m18 0h-3a2 2 0 01-2-2V3m0 18v-3a2 2 0 012-2h3M3 16h3a2 2 0 012 2v3"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
                </svg>
              )}
            </button>
            )}
            {/* Close (modal mode only) */}
            {mode !== 'page' && (
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors"
              title="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">

          {/* ── Left sidebar ── */}
          <aside className="w-[220px] shrink-0 border-r border-border flex flex-col bg-surface-2 overflow-y-auto">

            {/* Search */}
            <div className="p-3">
              <div className="relative">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="input text-sm pl-7 pr-7 py-1.5 w-full"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-3 hover:text-text-1">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="px-3 pb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3 mb-1">Categories</p>
            </div>

            {/* Category list */}
            <div className="flex-1 px-2 pb-2">
              {/* All */}
              <button
                onClick={() => setActiveCatId(null)}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors mb-0.5 ${activeCatId === null ? 'bg-accent-dim text-accent font-semibold' : 'text-text-2 hover:bg-white'}`}
              >
                <span>All media</span>
                <span className="text-xs text-text-3">{totalCount}</span>
              </button>

              {/* Uncategorised */}
              <button
                onClick={() => setActiveCatId('none')}
                className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors mb-0.5 ${activeCatId === 'none' ? 'bg-accent-dim text-accent font-semibold' : 'text-text-2 hover:bg-white'}`}
              >
                <span>No category</span>
                <span className="text-xs text-text-3">{uncatCount}</span>
              </button>

              {categories.map(cat => (
                <div key={cat.id} className="group relative">
                  <button
                    onClick={() => setActiveCatId(cat.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-sm transition-colors mb-0.5 ${activeCatId === cat.id ? 'bg-accent-dim text-accent font-semibold' : 'text-text-2 hover:bg-white'}`}
                  >
                    <span className="truncate pr-4">{cat.name}</span>
                    <span className="text-xs text-text-3 shrink-0">{cat.item_count}</span>
                  </button>
                  <button
                    onClick={() => deleteCategory(cat.id)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-50 text-text-3 hover:text-red-500 transition-all"
                    title="Delete category"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
                    </svg>
                  </button>
                </div>
              ))}

              {/* New category inline */}
              {showNewCat ? (
                <div className="mt-1 px-1">
                  <input
                    ref={newCatRef}
                    value={newCatName}
                    onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveNewCategory(); if (e.key === 'Escape') { setShowNewCat(false); setNewCatName('') } }}
                    onBlur={saveNewCategory}
                    placeholder="Category name…"
                    className="input text-xs py-1 px-2 w-full"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setShowNewCat(true)}
                  className="w-full flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-text-3 hover:text-accent hover:bg-white transition-colors mt-1"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                  New category
                </button>
              )}
            </div>

            <div className="border-t border-border p-3 space-y-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-3">Upload destination</p>
              <select
                value={uploadCatId ?? ''}
                onChange={e => setUploadCatId(e.target.value ? Number(e.target.value) : null)}
                className="input text-xs py-1 w-full"
              >
                <option value="">None</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-primary text-xs py-1.5 px-3 w-full flex items-center justify-center gap-1.5"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
                </svg>
                Upload images
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={e => { if (e.target.files?.length) uploadFiles(e.target.files); e.target.value = '' }}
              />
            </div>
          </aside>

          {/* ── Main area ── */}
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

            {/* Upload chips */}
            {chips.length > 0 && (
              <div className="flex flex-wrap gap-2 px-4 pt-3 pb-0">
                {chips.map((chip, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-surface-2 border border-border rounded-lg px-2 py-1">
                    <img src={chip.preview} alt="" className="w-7 h-7 object-cover rounded" />
                    <span className="text-xs text-text-2 max-w-[120px] truncate">{chip.file.name.slice(0, 20)}{chip.file.name.length > 20 ? '…' : ''}</span>
                    {chip.status === 'uploading' && (
                      <svg className="animate-spin w-3.5 h-3.5 text-accent shrink-0" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                      </svg>
                    )}
                    {chip.status === 'done' && <span className="badge-green text-[10px] px-1.5">Done</span>}
                    {chip.status === 'error' && <span className="text-[10px] text-red-500 font-medium">Error</span>}
                  </div>
                ))}
              </div>
            )}

            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-sm text-text-3">{totalCount} image{totalCount !== 1 ? 's' : ''}</span>
                {selectedIds.size > 0 && (
                  <button onClick={() => { setSelectedIds(new Set()); setDetailItem(null) }} className="text-xs text-accent hover:underline">
                    Clear selection ({selectedIds.size})
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded transition-colors ${viewMode === 'grid' ? 'bg-accent-dim text-accent' : 'text-text-3 hover:text-text-1 hover:bg-surface-2'}`}
                  title="Grid view"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                    <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded transition-colors ${viewMode === 'list' ? 'bg-accent-dim text-accent' : 'text-text-3 hover:text-text-1 hover:bg-surface-2'}`}
                  title="List view"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                  </svg>
                </button>
              </div>
            </div>

            {/* Grid / List */}
            <div className="flex-1 overflow-y-auto p-4">
              {loading ? (
                <div className="flex items-center justify-center h-32">
                  <svg className="animate-spin w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-center">
                  <svg className="w-12 h-12 text-text-3 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                    <path strokeLinecap="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"/>
                  </svg>
                  <p className="text-text-2 font-medium mb-1">No images found</p>
                  <p className="text-text-3 text-sm mb-3">Upload images using the sidebar or drag and drop files here.</p>
                  <button onClick={() => fileInputRef.current?.click()} className="btn-primary text-sm py-1.5 px-4">Upload images</button>
                </div>
              ) : viewMode === 'grid' ? (
                <GridView items={items} selectedIds={selectedIds} onSelect={selectItem} />
              ) : (
                <ListView items={items} selectedIds={selectedIds} onSelect={selectItem} />
              )}
            </div>
          </div>

          {/* ── Right detail panel ── */}
          <div
            ref={panelRef}
            className="shrink-0 border-l border-border flex flex-col bg-surface overflow-hidden relative"
            style={{ width: panelWidth }}
          >
            {/* Resize handle */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
              onMouseDown={startResize}
            />

            {multiSelected ? (
              <MultiPanel
                selectedIds={selectedIds}
                categories={categories}
                bulkCatId={bulkCatId}
                setBulkCatId={setBulkCatId}
                onBulkMove={bulkMove}
                onBulkDelete={bulkDelete}
              />
            ) : detailItem && singleSelected ? (
              <DetailPanel
                item={detailItem}
                categories={categories}
                editFilename={editFilename}
                setEditFilename={setEditFilename}
                editCatId={editCatId}
                setEditCatId={setEditCatId}
                editingFilename={editingFilename}
                setEditingFilename={setEditingFilename}
                saving={savingDetail}
                onSave={saveDetail}
                onDelete={deleteItem}
                onToggleScope={toggleScope}
                onEditImage={setEditingImage}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <svg className="w-10 h-10 text-text-3 mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path strokeLinecap="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/>
                </svg>
                <p className="text-sm text-text-3">Select an image to view details</p>
              </div>
            )}
          </div>
        </div>

        {/* Image editor */}
        {editingImage && (
          <ImageEditor
            open={true}
            src={editingImage.web_url || editingImage.url}
            onClose={() => setEditingImage(null)}
            onSave={saveEditedImage}
          />
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-border shrink-0 bg-surface-2">
          {mode !== 'page' && (
            <button onClick={onClose} className="btn-outline text-sm py-1.5 px-4">Close</button>
          )}
          {mode === 'page' && <div />}
          {onInsert && (
            <button
              onClick={() => {
                const id = [...selectedIds][0]
                const item = items.find(i => i.id === id)
                if (item) { onInsert(item.web_url || item.url, item); onClose() }
              }}
              disabled={selectedIds.size !== 1}
              className="btn-primary text-sm py-1.5 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Insert selected
            </button>
          )}
        </div>
    </>
  )

  // Page mode: render inline without portal/backdrop/fixed positioning
  if (mode === 'page') {
    return (
      <div
        className="flex flex-col w-full h-full bg-surface overflow-hidden relative"
        onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
      >
        {innerContent}
      </div>
    )
  }

  // Modal mode: render via portal with backdrop
  const modalClass = fullscreen
    ? 'fixed inset-0 z-50 flex flex-col bg-surface'
    : 'fixed inset-0 z-50 flex items-center justify-center p-4'

  const dialogClass = fullscreen
    ? 'flex flex-col flex-1 w-full h-full bg-surface overflow-hidden'
    : 'relative bg-surface rounded-2xl shadow-modal w-[92vw] max-w-6xl h-[88vh] flex flex-col overflow-hidden'

  return createPortal(
    <div className={modalClass} onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}>
      {/* Backdrop */}
      {!fullscreen && <div className="absolute inset-0 bg-black/50" onClick={onClose} />}

      {/* Dialog */}
      <div className={dialogClass}>
        {innerContent}
      </div>
    </div>,
    document.body
  )
}

// ── Grid View ─────────────────────────────────────────────────────────────────

function GridView({ items, selectedIds, onSelect }: {
  items: MediaItem[]
  selectedIds: Set<number>
  onSelect: (item: MediaItem, toggle?: boolean) => void
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
      {items.map(item => {
        const selected = selectedIds.has(item.id)
        const anySelected = selectedIds.size > 0
        const thumb = item.thumb_url || item.web_url || item.url
        return (
          <div
            key={item.id}
            onClick={() => onSelect(item, anySelected)}
            className={`group relative cursor-pointer rounded-xl overflow-hidden border-2 transition-all ${selected ? 'border-accent shadow-sm' : 'border-transparent hover:border-border'}`}
          >
            {/* Thumbnail */}
            <div className="aspect-square bg-surface-2 overflow-hidden">
              <img
                src={thumb}
                alt={item.filename}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>

            {/* Filename */}
            <div className="px-1.5 py-1 bg-surface">
              <p className="text-[11px] text-text-2 truncate">{item.filename}</p>
            </div>

            {/* Checkbox (top-left, visible on hover or if any selected) */}
            <div
              className={`absolute top-1.5 left-1.5 transition-opacity ${(anySelected || selected) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
              onClick={e => { e.stopPropagation(); onSelect(item, true) }}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${selected ? 'bg-accent border-accent' : 'bg-white/90 border-border hover:border-accent'}`}>
                {selected && (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                )}
              </div>
            </div>

          </div>
        )
      })}
    </div>
  )
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({ items, selectedIds, onSelect }: {
  items: MediaItem[]
  selectedIds: Set<number>
  onSelect: (item: MediaItem, toggle?: boolean) => void
}) {
  return (
    <table className="w-full text-sm border-separate border-spacing-0">
      <thead>
        <tr className="text-xs text-text-3 uppercase tracking-wide">
          <th className="text-left pb-2 pr-3 font-semibold w-10"></th>
          <th className="text-left pb-2 pr-3 font-semibold">Filename</th>
          <th className="text-left pb-2 pr-3 font-semibold whitespace-nowrap">Dimensions</th>
          <th className="text-left pb-2 pr-3 font-semibold">Size</th>
          <th className="text-left pb-2 pr-3 font-semibold">Date</th>
          <th className="text-left pb-2 font-semibold">Category</th>
        </tr>
      </thead>
      <tbody>
        {items.map(item => {
          const selected = selectedIds.has(item.id)
          const thumb = item.thumb_url || item.web_url || item.url
          return (
            <tr
              key={item.id}
              onClick={() => onSelect(item)}
              className={`cursor-pointer transition-colors ${selected ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}
            >
              <td className="py-1.5 pr-2">
                <div
                  onClick={e => { e.stopPropagation(); onSelect(item, true) }}
                  className={`w-5 h-5 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${selected ? 'bg-accent border-accent' : 'bg-white border-border hover:border-accent'}`}
                >
                  {selected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <path d="M20 6L9 17l-5-5"/>
                    </svg>
                  )}
                </div>
              </td>
              <td className="py-1.5 pr-3">
                <div className="flex items-center gap-2">
                  <img src={thumb} alt="" className="w-9 h-9 rounded object-cover shrink-0 border border-border" loading="lazy" />
                  <span className="text-text-1 truncate max-w-[180px]">{item.filename}</span>
                </div>
              </td>
              <td className="py-1.5 pr-3 text-text-3 whitespace-nowrap">
                {item.width && item.height ? `${item.width}×${item.height}` : '—'}
              </td>
              <td className="py-1.5 pr-3 text-text-3 whitespace-nowrap">{formatSize(item.size_bytes)}</td>
              <td className="py-1.5 pr-3 text-text-3 whitespace-nowrap">{formatDate(item.created_at)}</td>
              <td className="py-1.5 text-text-3">{item.category_name || <span className="text-text-3 italic">None</span>}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function DetailPanel({
  item, categories, editFilename, setEditFilename, editCatId, setEditCatId,
  editingFilename, setEditingFilename, saving, onSave, onDelete, onToggleScope, onEditImage,
}: {
  item: MediaItem
  categories: MediaCategory[]
  editFilename: string
  setEditFilename: (v: string) => void
  editCatId: number | null
  setEditCatId: (v: number | null) => void
  editingFilename: boolean
  setEditingFilename: (v: boolean) => void
  saving: boolean
  onSave: () => void
  onDelete: (item: MediaItem) => void
  onToggleScope: (item: MediaItem) => void
  onEditImage?: (item: MediaItem) => void
}) {
  const previewSrc = item.web_url || item.url

  return (
    <div className="flex flex-col h-full">
      {/* Preview */}
      <div className="bg-surface-2 border-b border-border flex items-center justify-center" style={{ minHeight: 180, maxHeight: 220 }}>
        <img
          src={previewSrc}
          alt={item.filename}
          className="max-w-full max-h-52 object-contain p-2"
        />
      </div>

      {/* Metadata */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">

        {/* Filename */}
        <div>
          <p className="text-[10px] uppercase font-semibold text-text-3 mb-0.5">Filename</p>
          {editingFilename ? (
            <input
              autoFocus
              value={editFilename}
              onChange={e => setEditFilename(e.target.value)}
              onBlur={() => setEditingFilename(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingFilename(false); if (e.key === 'Escape') { setEditFilename(item.filename); setEditingFilename(false) } }}
              className="input text-sm py-1 w-full"
            />
          ) : (
            <p
              onClick={() => setEditingFilename(true)}
              className="text-text-1 break-all cursor-pointer hover:text-accent transition-colors"
              title="Click to edit"
            >
              {editFilename}
            </p>
          )}
        </div>

        {/* Dimensions */}
        {(item.width || item.height) && (
          <div>
            <p className="text-[10px] uppercase font-semibold text-text-3 mb-0.5">Dimensions</p>
            <p className="text-text-2">{item.width} × {item.height}px</p>
          </div>
        )}

        {/* File size */}
        <div>
          <p className="text-[10px] uppercase font-semibold text-text-3 mb-0.5">File size</p>
          <p className="text-text-2">{formatSize(item.size_bytes)}</p>
        </div>

        {/* Upload date */}
        <div>
          <p className="text-[10px] uppercase font-semibold text-text-3 mb-0.5">Uploaded</p>
          <p className="text-text-2">{formatDate(item.created_at)}</p>
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5">
          <span className="badge-neutral text-xs px-2 py-0.5">{item.storage_type}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.scope === 'shared' ? 'badge-green' : 'badge-yellow'}`}>{item.scope}</span>
        </div>

        {/* Category */}
        <div>
          <p className="text-[10px] uppercase font-semibold text-text-3 mb-0.5">Category</p>
          <select
            value={editCatId ?? ''}
            onChange={e => setEditCatId(e.target.value ? Number(e.target.value) : null)}
            className="input text-sm py-1 w-full"
          >
            <option value="">None</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {/* Scope toggle */}
        <button
          onClick={() => onToggleScope(item)}
          className="btn-outline text-xs py-1.5 px-3 w-full"
        >
          {item.scope === 'shared' ? 'Move to form scope' : 'Move to shared'}
        </button>

        {/* Edit image */}
        {onEditImage && (
          <button
            onClick={() => onEditImage(item)}
            className="btn-ghost text-xs py-1.5 px-3 w-full border border-border"
          >
            Edit image
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-border flex gap-2 shrink-0">
        <button
          onClick={onSave}
          disabled={saving}
          className="btn-primary flex-1 text-sm py-1.5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => onDelete(item)}
          className="btn-danger text-sm py-1.5 px-3"
          title="Delete image"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>
          </svg>
        </button>
      </div>
    </div>
  )
}

// ── Multi-Select Panel ────────────────────────────────────────────────────────

function MultiPanel({
  selectedIds, categories, bulkCatId, setBulkCatId, onBulkMove, onBulkDelete,
}: {
  selectedIds: Set<number>
  categories: MediaCategory[]
  bulkCatId: number | null
  setBulkCatId: (v: number | null) => void
  onBulkMove: () => void
  onBulkDelete: () => void
}) {
  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="font-semibold text-text-1 text-sm">{selectedIds.size} items selected</p>
        <p className="text-xs text-text-3 mt-0.5">Use the controls below to act on all selected items.</p>
      </div>

      <div className="border-t border-border pt-4 space-y-2">
        <p className="text-[10px] uppercase font-semibold text-text-3">Move to category</p>
        <select
          value={bulkCatId ?? ''}
          onChange={e => setBulkCatId(e.target.value ? Number(e.target.value) : null)}
          className="input text-sm py-1 w-full"
        >
          <option value="">None</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button onClick={onBulkMove} className="btn-primary text-sm py-1.5 px-4 w-full">Apply</button>
      </div>

      <div className="border-t border-border pt-4">
        <button onClick={onBulkDelete} className="btn-danger text-sm py-1.5 px-4 w-full flex items-center justify-center gap-1.5">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>
          </svg>
          Delete {selectedIds.size} items
        </button>
      </div>
    </div>
  )
}
