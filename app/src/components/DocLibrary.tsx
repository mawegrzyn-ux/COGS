import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'
import { Modal, Field, Spinner, Toast, Badge, ConfirmDialog } from './ui'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import Placeholder from '@tiptap/extension-placeholder'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import DOMPurify from 'dompurify'

// ── Types ────────────────────────────────────────────────────────────────────

interface DocCategory { id: number; name: string; sort_order: number }
interface Doc {
  id: number; title: string; slug: string; description: string | null
  content_html: string; content_type: 'wysiwyg' | 'html_upload'
  location: 'system' | 'help'; category_id: number | null
  category_name: string | null; skip_sanitize: boolean
  is_published: boolean; created_by: string | null; updated_by: string | null
  created_at: string; updated_at: string
}
interface TocItem { id: string; text: string; level: number }
interface ToastState { message: string; type: 'success' | 'error' }

type Mode = 'list' | 'view' | 'edit'

// ── Helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200)
}

function extractToc(html: string): TocItem[] {
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const items: TocItem[] = []
    doc.querySelectorAll('h1,h2,h3').forEach((el, i) => {
      const id = el.id || `heading-${i}`
      items.push({ id, text: el.textContent || '', level: parseInt(el.tagName[1]) })
    })
    return items
  } catch { return [] }
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function safeHtml(html: string, skipSanitize: boolean, isDev: boolean) {
  if (skipSanitize && isDev) return html
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['style'],
    ADD_ATTR: ['target', 'rel'],
  })
}

// ── TipTap Toolbar ───────────────────────────────────────────────────────────

function EditorToolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  if (!editor) return null
  const btn = (active: boolean, onClick: () => void, label: string) => (
    <button type="button" onClick={onClick}
      className={`px-2 py-1 text-xs rounded ${active ? 'bg-accent text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
      {label}
    </button>
  )
  return (
    <div className="flex flex-wrap gap-1 p-2 border-b border-border bg-surface-2 rounded-t-lg">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), 'B')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), 'I')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), 'U')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), 'S')}
      <span className="w-px h-6 bg-gray-300 mx-1" />
      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), 'H1')}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), 'H2')}
      {btn(editor.isActive('heading', { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(), 'H3')}
      <span className="w-px h-6 bg-gray-300 mx-1" />
      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), 'List')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), '1.')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), 'Quote')}
      {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), 'Code')}
      <span className="w-px h-6 bg-gray-300 mx-1" />
      {btn(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), 'Left')}
      {btn(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), 'Center')}
      {btn(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), 'Right')}
      <span className="w-px h-6 bg-gray-300 mx-1" />
      <button type="button" className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
        onClick={() => { const url = prompt('Link URL:'); if (url) editor.chain().focus().setLink({ href: url }).run() }}>
        Link
      </button>
      <button type="button" className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
        onClick={() => { const url = prompt('Image URL:'); if (url) editor.chain().focus().setImage({ src: url }).run() }}>
        Img
      </button>
      <button type="button" className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        Table
      </button>
      <button type="button" className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        HR
      </button>
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function DocLibrary({ location }: { location: 'system' | 'help' }) {
  const api = useApi()
  const { getAccessTokenSilently } = useAuth0()
  const { can, isDev } = usePermissions()
  const canWrite = can('docs', 'write')

  // State
  const [mode, setMode] = useState<Mode>('list')
  const [docs, setDocs] = useState<Doc[]>([])
  const [categories, setCategories] = useState<DocCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterCat, setFilterCat] = useState('')
  const [toast, setToast] = useState<ToastState | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Doc | null>(null)

  // View state
  const [viewDoc, setViewDoc] = useState<Doc | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const viewerRef = useRef<HTMLDivElement>(null)

  // Edit state
  const [editDoc, setEditDoc] = useState<Partial<Doc> | null>(null)
  const [editMode, setEditMode] = useState<'visual' | 'html'>('visual')
  const [htmlSource, setHtmlSource] = useState('')
  const [saving, setSaving] = useState(false)
  const [showCatModal, setShowCatModal] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Data loading ─────────────────────────────────────────────────────────

  const loadDocs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('location', location)
      if (filterCat) params.set('category_id', filterCat)
      if (search) params.set('search', search)
      const data = await api.get(`/docs-library?${params}`)
      setDocs(data || [])
    } finally { setLoading(false) }
  }, [api, location, filterCat, search])

  const loadCategories = useCallback(async () => {
    try {
      const data = await api.get('/docs-library/categories')
      setCategories(data || [])
    } catch { /* ignore */ }
  }, [api])

  useEffect(() => { loadDocs() }, [loadDocs])
  useEffect(() => { loadCategories() }, [loadCategories])

  // ── Fullscreen listener ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen()
    else viewerRef.current?.requestFullscreen()
  }

  // ── TipTap editor ────────────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Start writing...' }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'prose prose-sm max-w-none p-4 min-h-[300px] focus:outline-none' },
    },
  })

  // ── Actions ──────────────────────────────────────────────────────────────

  function openNew() {
    setEditDoc({ title: '', slug: '', description: '', content_html: '', content_type: 'wysiwyg', location, skip_sanitize: false, is_published: true, category_id: null })
    setEditMode('visual')
    setHtmlSource('')
    editor?.commands.setContent('')
    setMode('edit')
  }

  function openEdit(doc: Doc) {
    setEditDoc(doc)
    setEditMode(doc.content_type === 'html_upload' ? 'html' : 'visual')
    setHtmlSource(doc.content_html)
    editor?.commands.setContent(doc.content_html)
    setMode('edit')
  }

  function openView(doc: Doc) {
    setViewDoc(doc)
    setMode('view')
  }

  function backToList() {
    setMode('list')
    setViewDoc(null)
    setEditDoc(null)
  }

  async function loadFullDoc(id: number) {
    const doc = await api.get(`/docs-library/${id}`)
    return doc as Doc
  }

  async function handleView(doc: Doc) {
    // List doesn't include content_html, load full doc
    const full = await loadFullDoc(doc.id)
    openView(full)
  }

  async function handleSave() {
    if (!editDoc?.title) { setToast({ message: 'Title is required', type: 'error' }); return }
    setSaving(true)
    try {
      const html = editMode === 'visual' ? (editor?.getHTML() || '') : htmlSource
      const payload = {
        title: editDoc.title,
        slug: editDoc.slug || slugify(editDoc.title),
        description: editDoc.description || null,
        content_html: html,
        content_type: editMode === 'visual' ? 'wysiwyg' : 'html_upload',
        location: editDoc.location || location,
        category_id: editDoc.category_id || null,
        skip_sanitize: editDoc.skip_sanitize || false,
        is_published: editDoc.is_published !== false,
      }
      if ((editDoc as Doc).id) {
        await api.put(`/docs-library/${(editDoc as Doc).id}`, payload)
        setToast({ message: 'Document updated', type: 'success' })
      } else {
        await api.post('/docs-library', payload)
        setToast({ message: 'Document created', type: 'success' })
      }
      loadDocs()
      backToList()
    } catch (err: any) {
      setToast({ message: err?.message || 'Save failed', type: 'error' })
    } finally { setSaving(false) }
  }

  async function handleDelete(doc: Doc) {
    try {
      await api.delete(`/docs-library/${doc.id}`)
      setToast({ message: 'Document deleted', type: 'success' })
      loadDocs()
      backToList()
    } catch (err: any) {
      setToast({ message: err?.message || 'Delete failed', type: 'error' })
    }
    setConfirmDelete(null)
  }

  async function handleUploadHtml(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const formData = new FormData()
      formData.append('file', file)
      const headers: Record<string, string> = {}
      try { const token = await getAccessTokenSilently(); if (token) headers['Authorization'] = `Bearer ${token}` } catch {}
      const res = await fetch(`${(import.meta as any).env.VITE_API_URL || '/api'}/docs-library/upload-html`, {
        method: 'POST',
        body: formData,
        headers,
      })
      const data = await res.json()
      if (data.error) { setToast({ message: data.error.message, type: 'error' }); return }
      setEditDoc(prev => prev ? { ...prev, title: prev.title || data.title, content_html: data.content_html } : prev)
      setHtmlSource(data.content_html)
      setEditMode('html')
    } catch (err: any) {
      setToast({ message: 'Upload failed', type: 'error' })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  async function handleCreateCategory() {
    if (!newCatName.trim()) return
    try {
      await api.post('/docs-library/categories', { name: newCatName.trim() })
      setNewCatName('')
      setShowCatModal(false)
      loadCategories()
      setToast({ message: 'Category created', type: 'success' })
    } catch (err: any) {
      setToast({ message: err?.message || 'Failed', type: 'error' })
    }
  }

  // ── TOC for viewer ───────────────────────────────────────────────────────

  const toc = useMemo(() => viewDoc ? extractToc(viewDoc.content_html) : [], [viewDoc])

  // ── Render ───────────────────────────────────────────────────────────────

  // LIST MODE
  if (mode === 'list') {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <input className="input w-64" placeholder="Search documents..." value={search}
              onChange={e => setSearch(e.target.value)} />
            <select className="input w-40" value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">All categories</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {canWrite && (
              <button className="btn-outline text-sm flex items-center gap-1" onClick={() => setShowCatModal(true)}>
                + Category
              </button>
            )}
            {canWrite && (
              <button className="btn-primary text-sm flex items-center gap-1" onClick={openNew}>
                + New Document
              </button>
            )}
          </div>
        </div>

        {/* Grid */}
        {loading ? <div className="flex justify-center py-12"><Spinner /></div> : docs.length === 0 ? (
          <div className="text-center py-12 text-text-3">
            <p className="text-lg mb-2">No documents yet</p>
            {canWrite && <button className="btn-primary text-sm" onClick={openNew}>Create your first document</button>}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {docs.map(doc => (
              <div key={doc.id} className="card p-4 cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => handleView(doc)}>
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-1 line-clamp-2">{doc.title}</h3>
                  {!doc.is_published && <Badge label="Draft" variant="yellow" />}
                </div>
                {doc.description && <p className="text-sm text-text-3 line-clamp-2 mb-3">{doc.description}</p>}
                <div className="flex items-center gap-2 text-xs text-text-3">
                  {doc.category_name && <Badge label={doc.category_name} variant="green" />}
                  <span>{fmtDate(doc.updated_at)}</span>
                  {doc.skip_sanitize && <Badge label="Raw HTML" variant="yellow" />}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Category modal */}
        {showCatModal && (
          <Modal title="New Category" onClose={() => setShowCatModal(false)} width="sm">
            <Field label="Name">
              <input className="input" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateCategory()} autoFocus />
            </Field>
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-ghost text-sm" onClick={() => setShowCatModal(false)}>Cancel</button>
              <button className="btn-primary text-sm" onClick={handleCreateCategory}>Create</button>
            </div>
          </Modal>
        )}

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    )
  }

  // VIEW MODE
  if (mode === 'view' && viewDoc) {
    const rendered = safeHtml(viewDoc.content_html, viewDoc.skip_sanitize, isDev)
    return (
      <div ref={viewerRef} className="doc-viewer flex flex-col h-full">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0 doc-topbar">
          <div className="flex items-center gap-3">
            <button className="btn-ghost text-sm" onClick={backToList}>
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              Back
            </button>
            <h2 className="font-semibold text-text-1 text-lg">{viewDoc.title}</h2>
            {!viewDoc.is_published && <Badge label="Draft" variant="yellow" />}
            {viewDoc.skip_sanitize && <Badge label="Raw HTML" variant="yellow" />}
          </div>
          <div className="flex items-center gap-2">
            {canWrite && (
              <button className="btn-outline text-sm" onClick={() => openEdit(viewDoc)}>Edit</button>
            )}
            <button className="btn-ghost text-sm" onClick={toggleFullscreen} title="Toggle fullscreen">
              {isFullscreen ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" /></svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" /></svg>
              )}
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex flex-1 overflow-hidden">
          {/* TOC sidebar */}
          {toc.length > 0 && (
            <nav className="doc-toc w-56 shrink-0 border-r border-border overflow-y-auto p-3 bg-surface-2">
              <p className="text-xs font-semibold text-text-3 uppercase mb-2">Contents</p>
              {toc.map((item, i) => (
                <button key={i} className="block w-full text-left text-sm py-1 px-2 rounded hover:bg-accent-dim text-text-2 truncate"
                  style={{ paddingLeft: `${(item.level - 1) * 12 + 8}px` }}
                  onClick={() => {
                    const el = viewerRef.current?.querySelector(`#${item.id}`) || viewerRef.current?.querySelectorAll('h1,h2,h3')[i]
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}>
                  {item.text}
                </button>
              ))}
            </nav>
          )}

          {/* Document content */}
          <div className="doc-content flex-1 overflow-y-auto p-6 lg:p-10">
            <div className="max-w-4xl mx-auto doc-rendered-content"
              dangerouslySetInnerHTML={{ __html: rendered }} />
            <div className="mt-8 pt-4 border-t border-border text-xs text-text-3 max-w-4xl mx-auto">
              Last updated {fmtDate(viewDoc.updated_at)} by {viewDoc.updated_by || 'unknown'}
            </div>
          </div>
        </div>

        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    )
  }

  // EDIT MODE
  if (mode === 'edit' && editDoc) {
    const isNew = !(editDoc as Doc).id
    return (
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface shrink-0">
          <div className="flex items-center gap-3">
            <button className="btn-ghost text-sm" onClick={backToList}>Cancel</button>
            <h2 className="font-semibold text-text-1">{isNew ? 'New Document' : `Edit: ${editDoc.title}`}</h2>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && (
              <button className="text-sm text-red-600 hover:text-red-700" onClick={() => setConfirmDelete(editDoc as Doc)}>
                Delete
              </button>
            )}
            <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : isNew ? 'Create' : 'Save'}
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left — editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Editor mode toggle + upload */}
            <div className="flex items-center gap-2 px-4 py-2 bg-surface-2 border-b border-border">
              <button className={`px-3 py-1 text-xs rounded ${editMode === 'visual' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600'}`}
                onClick={() => {
                  if (editMode === 'html') editor?.commands.setContent(htmlSource)
                  setEditMode('visual')
                }}>Visual Editor</button>
              <button className={`px-3 py-1 text-xs rounded ${editMode === 'html' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600'}`}
                onClick={() => {
                  if (editMode === 'visual') setHtmlSource(editor?.getHTML() || '')
                  setEditMode('html')
                }}>HTML Source</button>
              <span className="w-px h-5 bg-gray-300 mx-1" />
              <button className="px-3 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded"
                onClick={() => fileInputRef.current?.click()}>
                Upload HTML File
              </button>
              <input ref={fileInputRef} type="file" accept=".html,.htm" className="hidden" onChange={handleUploadHtml} />
            </div>

            {/* Editor content */}
            {editMode === 'visual' ? (
              <div className="flex-1 overflow-y-auto border border-border rounded-b-lg mx-4 mb-4 mt-2 bg-white">
                <EditorToolbar editor={editor} />
                <EditorContent editor={editor} />
              </div>
            ) : (
              <textarea className="flex-1 mx-4 mb-4 mt-2 p-4 font-mono text-sm border border-border rounded-lg resize-none bg-white focus:outline-none focus:ring-2 focus:ring-accent/30"
                value={htmlSource} onChange={e => setHtmlSource(e.target.value)}
                placeholder="Paste or edit HTML here..." />
            )}
          </div>

          {/* Right — metadata panel */}
          <div className="w-72 shrink-0 border-l border-border bg-surface-2 overflow-y-auto p-4 space-y-4">
            <Field label="Title">
              <input className="input" value={editDoc.title || ''} autoFocus
                onChange={e => setEditDoc(prev => prev ? { ...prev, title: e.target.value } : prev)} />
            </Field>
            <Field label="Slug" hint="Auto-generated from title if empty">
              <input className="input text-sm font-mono" value={editDoc.slug || ''}
                placeholder={slugify(editDoc.title || '')}
                onChange={e => setEditDoc(prev => prev ? { ...prev, slug: e.target.value } : prev)} />
            </Field>
            <Field label="Description">
              <textarea className="input text-sm" rows={3} value={editDoc.description || ''}
                onChange={e => setEditDoc(prev => prev ? { ...prev, description: e.target.value } : prev)} />
            </Field>
            <Field label="Location">
              <select className="input" value={editDoc.location || 'help'}
                onChange={e => setEditDoc(prev => prev ? { ...prev, location: e.target.value as 'system' | 'help' } : prev)}>
                <option value="help">Help page</option>
                <option value="system">System page</option>
              </select>
            </Field>
            <Field label="Category">
              <select className="input" value={editDoc.category_id || ''}
                onChange={e => setEditDoc(prev => prev ? { ...prev, category_id: e.target.value ? parseInt(e.target.value) : null } : prev)}>
                <option value="">No category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Published">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="rounded border-gray-300 text-accent focus:ring-accent"
                  checked={editDoc.is_published !== false}
                  onChange={e => setEditDoc(prev => prev ? { ...prev, is_published: e.target.checked } : prev)} />
                <span className="text-sm text-text-2">Visible to users</span>
              </label>
            </Field>
            {isDev && (
              <Field label="Developer Options">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="rounded border-gray-300 text-amber-500 focus:ring-amber-500"
                    checked={!!editDoc.skip_sanitize}
                    onChange={e => setEditDoc(prev => prev ? { ...prev, skip_sanitize: e.target.checked } : prev)} />
                  <span className="text-sm text-amber-600">Skip sanitization (raw HTML)</span>
                </label>
                <p className="text-xs text-text-3 mt-1">Allows scripts, iframes, and event handlers. Use with caution.</p>
              </Field>
            )}
          </div>
        </div>

        {confirmDelete && (
          <ConfirmDialog message={`Delete "${confirmDelete.title}"? This cannot be undone.`} danger
            onConfirm={() => handleDelete(confirmDelete)} onCancel={() => setConfirmDelete(null)} />
        )}
        {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    )
  }

  return null
}
