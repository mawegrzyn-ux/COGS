import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Spinner } from '../components/ui'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

// ── Types ─────────────────────────────────────────────────────────────────────

type Step        = 'upload' | 'parsing' | 'mapping' | 'review' | 'confirm' | 'executing' | 'done'
type ImportPath  = 'template' | 'ai'
type ReviewTab   = 'ingredients' | 'vendors' | 'price_quotes' | 'recipes' | 'menus'
type RowAction   = 'create' | 'skip' | 'override'
type RowStatus   = 'valid' | 'warning' | 'error'

interface StagedRow {
  _id:           string
  _action:       RowAction
  _status:       RowStatus
  _issues:       string[]
  _duplicate_of: { id: number; name: string } | null
  unit_source?:  string   // original imported unit when auto-resolved
  unit_method?:  string   // 'alias' | 'fuzzy'
  [key: string]: unknown
}

interface CatMapping {
  action:        'map' | 'create'
  maps_to_id?:   number
  maps_to_name?: string
  confidence?:   number
  suggested_name?: string
  suggested_type?: string
}

interface StagedData {
  vendors:          StagedRow[]
  ingredients:      StagedRow[]
  price_quotes:     StagedRow[]
  recipes:          StagedRow[]
  menus:            StagedRow[]
  category_mapping: Record<string, CatMapping>
  prerequisites:    { missing_units: string[]; missing_countries: string[] }
}

interface ImportResults {
  categories: number
  vendors: number; vendors_skipped: number; vendors_updated: number
  ingredients: number; ingredients_skipped: number; ingredients_updated: number
  price_quotes: number; price_quotes_skipped: number
  recipes: number; recipes_skipped: number; recipes_updated: number; recipe_items: number
  menus: number; menus_skipped: number; menu_items: number
  errors: string[]
}

interface DbCategory { id: number; name: string; type: string }

// ── Constants ─────────────────────────────────────────────────────────────────

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload',    label: 'Upload'     },
  { key: 'mapping',   label: 'Categories' },
  { key: 'review',    label: 'Review'     },
  { key: 'confirm',   label: 'Confirm'    },
  { key: 'done',      label: 'Done'       },
]
const VISIBLE_STEPS = STEPS.map(s => s.key)

const ACCEPTED = '.csv,.txt,.xlsx,.xls,.xlsb,.xlsm,.docx,.pptx'

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: RowStatus) {
  if (s === 'error')   return { bg: '#FEE2E2', text: '#DC2626', label: '✗' }
  if (s === 'warning') return { bg: '#FEF3C7', text: '#D97706', label: '⚠' }
  return                      { bg: '#D1FAE5', text: '#065F46', label: '✓' }
}

function countByAction(rows: StagedRow[]) {
  const create   = rows.filter(r => r._action === 'create').length
  const skip     = rows.filter(r => r._action === 'skip').length
  const override = rows.filter(r => r._action === 'override').length
  return { create, skip, override }
}

// ── Step Indicator ────────────────────────────────────────────────────────────

function StepBar({ step }: { step: Step }) {
  const idx = VISIBLE_STEPS.indexOf(step)
  return (
    <div className="flex items-center gap-0 mb-8">
      {STEPS.map((s, i) => {
        const active   = s.key === step
        const done     = VISIBLE_STEPS.indexOf(s.key) < idx
        const isLast   = i === STEPS.length - 1
        return (
          <div key={s.key} className="flex items-center">
            <div className="flex flex-col items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                ${active ? 'border-accent bg-accent text-white' :
                  done   ? 'border-accent bg-accent-dim text-accent' :
                           'border-border bg-white text-text-3'}`}>
                {done ? '✓' : i + 1}
              </div>
              <span className={`mt-1 text-xs ${active ? 'font-semibold text-accent' : 'text-text-3'}`}>{s.label}</span>
            </div>
            {!isLast && (
              <div className={`h-0.5 w-12 mx-1 mb-4 ${VISIBLE_STEPS.indexOf(s.key) < idx ? 'bg-accent' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Action Badge ─────────────────────────────────────────────────────────────

function ActionToggle({ value, onChange, disabled, hasDuplicate }: {
  value: RowAction; onChange: (v: RowAction) => void; disabled?: boolean; hasDuplicate?: boolean
}) {
  const color = value === 'create' ? 'var(--accent)' : value === 'override' ? '#D97706' : 'var(--text-3)'
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as RowAction)}
      disabled={disabled}
      className="text-xs rounded px-1.5 py-0.5 border border-border bg-white font-medium"
      style={{ color }}>
      <option value="create">Create</option>
      <option value="skip">Skip</option>
      {hasDuplicate && <option value="override">Override</option>}
    </select>
  )
}

// ── Editable Cell ─────────────────────────────────────────────────────────────

function EditCell({
  value, onChange, type = 'text', options, placeholder = '—',
}: {
  value: string; onChange: (v: string) => void
  type?: 'text' | 'number' | 'select'; options?: string[]; placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)

  const commit = () => { setEditing(false); onChange(draft) }

  if (editing) {
    if (type === 'select' && options) {
      return (
        <select autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
          className="text-xs border border-accent rounded px-1.5 py-0.5 w-full bg-white outline-none">
          <option value="">— none —</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )
    }
    return (
      <input autoFocus type={type} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
        className="text-xs border border-accent rounded px-1.5 py-0.5 w-full outline-none bg-white"
        style={{ minWidth: '80px' }} />
    )
  }
  return (
    <span onClick={() => { setDraft(value); setEditing(true) }}
      className="cursor-pointer hover:underline decoration-dotted text-xs"
      title="Click to edit">
      {value || <span className="text-text-3 italic">{placeholder}</span>}
    </span>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ImportPage() {
  const api            = useApi()
  const navigate       = useNavigate()
  const [searchParams] = useSearchParams()
  const { user }       = useAuth0()

  const [step,        setStep]        = useState<Step>('upload')
  const [importPath,  setImportPath]  = useState<ImportPath>('ai')
  const [file,        setFile]        = useState<File | null>(null)
  const [jobId,       setJobId]       = useState<string | null>(null)
  const [staged,      setStaged]      = useState<StagedData | null>(null)
  const [parseError,  setParseError]  = useState<string | null>(null)
  const [reviewTab,   setReviewTab]   = useState<ReviewTab>('ingredients')
  const [results,     setResults]     = useState<ImportResults | null>(null)
  const [execError,   setExecError]   = useState<string | null>(null)
  const [dbCats,      setDbCats]      = useState<DbCategory[]>([])
  const [filterDups,  setFilterDups]  = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Load categories
  useEffect(() => {
    api.get('/categories').then((d: DbCategory[]) => setDbCats(d || [])).catch(() => {})
  }, [api])

  // Load existing job from ?job=<id> URL param (chatbot deep-link)
  useEffect(() => {
    const jobFromUrl = searchParams.get('job')
    if (!jobFromUrl) return
    fetch(`${API_BASE}/import/${jobFromUrl}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.staged_data) return
        setJobId(data.id)
        setStaged(data.staged_data)
        const hasMappings = Object.keys(data.staged_data.category_mapping || {}).length > 0
        setStep(hasMappings ? 'mapping' : 'review')
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Row helpers ─────────────────────────────────────────────────────────────

  const updateRow = useCallback((entity: ReviewTab, id: string, changes: Partial<StagedRow>) => {
    setStaged(prev => {
      if (!prev) return prev
      return { ...prev, [entity]: (prev[entity] as StagedRow[]).map(r => r._id === id ? { ...r, ...changes } : r) }
    })
  }, [])

  const updateMapping = useCallback((src: string, changes: Partial<CatMapping>) => {
    setStaged(prev => {
      if (!prev) return prev
      return { ...prev, category_mapping: { ...prev.category_mapping, [src]: { ...prev.category_mapping[src], ...changes } } }
    })
  }, [])

  const skipAllDuplicates = useCallback((entity: ReviewTab) => {
    setStaged(prev => {
      if (!prev) return prev
      return { ...prev, [entity]: (prev[entity] as StagedRow[]).map(r => r._duplicate_of ? { ...r, _action: 'skip' as RowAction } : r) }
    })
  }, [])

  // ── Parse ────────────────────────────────────────────────────────────────────

  const handleParse = async () => {
    if (!file) return
    setStep('parsing')
    setParseError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('importPath', importPath)
      if (user?.email) form.append('userEmail', user.email)

      const res = await fetch(`${API_BASE}/import/upload`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))
        setParseError(err?.error?.message || 'Parse failed')
        setStep('upload')
        return
      }
      const data = await res.json()
      setJobId(data.job_id)
      setStaged(data.staged_data)
      const hasMappings = Object.keys(data.staged_data.category_mapping || {}).length > 0
      setStep(hasMappings ? 'mapping' : 'review')
    } catch (err: unknown) {
      setParseError(err instanceof Error ? err.message : 'Unknown error')
      setStep('upload')
    }
  }

  // ── Save staged to DB (on step transitions) ─────────────────────────────────

  const saveStaged = async () => {
    if (!jobId || !staged) return
    try {
      await fetch(`${API_BASE}/import/${jobId}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ staged_data: staged }),
      })
    } catch { /* non-critical */ }
  }

  // ── Execute ──────────────────────────────────────────────────────────────────

  const handleExecute = async () => {
    if (!jobId) return
    await saveStaged()
    setStep('executing')
    setExecError(null)
    try {
      const res = await fetch(`${API_BASE}/import/${jobId}/execute`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: { message: 'Execute failed' } }))
        setExecError(err?.error?.message || 'Import failed')
        setStep('confirm')
        return
      }
      const data = await res.json()
      setResults(data.results)
      setStep('done')
    } catch (err: unknown) {
      setExecError(err instanceof Error ? err.message : 'Import failed')
      setStep('confirm')
    }
  }

  // ── Discard ──────────────────────────────────────────────────────────────────

  const handleDiscard = () => {
    if (jobId) fetch(`${API_BASE}/import/${jobId}`, { method: 'DELETE' }).catch(() => {})
    setJobId(null); setStaged(null); setFile(null)
    setParseError(null); setExecError(null); setResults(null)
    setStep('upload')
  }

  // ── Resolved category name for a row ────────────────────────────────────────

  const resolvedCat = (src: string): string => {
    if (!staged || !src) return src
    const m = staged.category_mapping[src]
    if (!m) return src
    return m.action === 'map' ? (m.maps_to_name || src) : (m.suggested_name || src)
  }

  // ── STEP: Upload ─────────────────────────────────────────────────────────────

  const renderUpload = () => (
    <div className="max-w-2xl">
      {parseError && (
        <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
          {parseError}
        </div>
      )}

      {/* Path selector */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {(['ai','template'] as ImportPath[]).map(p => (
          <button key={p} onClick={() => setImportPath(p)}
            className={`p-4 rounded-xl border-2 text-left transition-colors ${importPath === p ? 'border-accent bg-accent-dim' : 'border-border bg-white hover:border-accent/40'}`}>
            <div className="font-semibold text-sm mb-1" style={{ color: importPath === p ? 'var(--accent)' : 'var(--text-1)' }}>
              {p === 'ai' ? '🤖 AI-Assisted Import' : '📋 Use COGS Template'}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>
              {p === 'ai'
                ? 'Upload any Excel or CSV file. McFry reads and maps your data automatically.'
                : 'Download the blank template, fill it in, upload it. Columns are pre-mapped — no AI needed.'}
            </div>
          </button>
        ))}
      </div>

      {/* Template download */}
      {importPath === 'template' && (
        <div className="mb-4 p-3 rounded-lg flex items-center gap-3 text-sm" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
          <span>📥</span>
          <span className="flex-1">First time? Download the blank template.</span>
          <a href={`${API_BASE}/import/template`} download className="font-semibold underline">Download template.xlsx</a>
        </div>
      )}

      {/* File picker */}
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f) }}
        className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors hover:border-accent"
        style={{ borderColor: file ? 'var(--accent)' : 'var(--border)', background: file ? 'var(--accent-dim)' : 'var(--surface-2)' }}>
        <input ref={fileRef} type="file" accept={ACCEPTED} className="hidden"
          onChange={e => setFile(e.target.files?.[0] ?? null)} />
        {file ? (
          <>
            <div className="text-2xl mb-2">📎</div>
            <div className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>{file.name}</div>
            <div className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{(file.size / 1024).toFixed(0)} KB — click to change</div>
          </>
        ) : (
          <>
            <div className="text-3xl mb-2">📂</div>
            <div className="font-semibold text-sm mb-1" style={{ color: 'var(--text-1)' }}>Drop file here or click to browse</div>
            <div className="text-xs" style={{ color: 'var(--text-3)' }}>Excel (.xlsx, .xls, .xlsb), CSV, Word, PPTX — max 10 MB</div>
          </>
        )}
      </div>

      <div className="mt-6 flex justify-end">
        <button onClick={handleParse} disabled={!file} className="btn-primary px-6">
          {importPath === 'ai' ? '🤖 Parse with McFry' : 'Parse File'} →
        </button>
      </div>
    </div>
  )

  // ── STEP: Parsing ─────────────────────────────────────────────────────────

  const renderParsing = () => (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Spinner />
      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
        {importPath === 'ai' ? 'McFry is reading your file…' : 'Parsing template…'}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>
        {importPath === 'ai' ? 'This may take 20–30 seconds for large files.' : 'Just a moment…'}
      </p>
    </div>
  )

  // ── STEP: Category Mapping ────────────────────────────────────────────────

  const renderMapping = () => {
    if (!staged) return null
    const mapping  = staged.category_mapping || {}
    const entries  = Object.entries(mapping)
    const dbIngCats = dbCats.filter(c => c.type === 'ingredient').map(c => c.name)
    const dbRecCats = dbCats.filter(c => c.type === 'recipe').map(c => c.name)

    return (
      <div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-2)' }}>
          McFry found the following categories in your file. Review how they map to existing COGS categories — or create new ones.
        </p>

        {entries.length === 0 ? (
          <div className="card p-6 text-center text-sm" style={{ color: 'var(--text-3)' }}>No categories found in file.</div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Imported Category</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Action</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>COGS Category</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Type</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {entries.map(([src, m]) => (
                  <tr key={src} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td className="px-4 py-2.5 font-medium" style={{ color: 'var(--text-1)' }}>{src}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={m.action}
                        onChange={e => updateMapping(src, { action: e.target.value as 'map'|'create' })}
                        className="text-xs rounded px-2 py-1 border border-border bg-white">
                        <option value="map">Map to existing</option>
                        <option value="create">Create new</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      {m.action === 'map' ? (
                        <select
                          value={m.maps_to_name || ''}
                          onChange={e => {
                            if (e.target.value === '__create__') {
                              updateMapping(src, { action: 'create', suggested_name: src })
                            } else {
                              const found = dbCats.find(c => c.name === e.target.value)
                              updateMapping(src, { maps_to_name: e.target.value, maps_to_id: found?.id })
                            }
                          }}
                          className="text-xs rounded px-2 py-1 border border-border bg-white w-full max-w-[200px]">
                          <option value="">— select —</option>
                          {[...dbIngCats, ...dbRecCats.filter(c => !dbIngCats.includes(c))].map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          <option disabled style={{ borderTop: '1px solid var(--border)' }}>──────────</option>
                          <option value="__create__">+ Create new category</option>
                        </select>
                      ) : (
                        <div className="flex items-center gap-1">
                          <input
                            type="text" value={m.suggested_name || src}
                            onChange={e => updateMapping(src, { suggested_name: e.target.value })}
                            className="text-xs rounded px-2 py-1 border border-border bg-white w-full max-w-[150px] outline-none focus:border-accent" />
                          <button
                            title="Switch back to map existing"
                            onClick={() => updateMapping(src, { action: 'map', suggested_name: undefined })}
                            className="text-text-3 hover:text-accent text-xs leading-none px-1">✕</button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <select
                        value={m.suggested_type || 'ingredient'}
                        onChange={e => updateMapping(src, { suggested_type: e.target.value })}
                        className="text-xs rounded px-2 py-1 border border-border bg-white">
                        <option value="ingredient">Ingredient</option>
                        <option value="recipe">Recipe</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      {m.action === 'map' && m.confidence != null ? (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${(m.confidence||0) >= 0.8 ? 'badge-green' : 'badge-yellow'}`}>
                          {Math.round((m.confidence||0) * 100)}%
                        </span>
                      ) : m.action === 'create' ? (
                        <span className="badge-yellow text-xs">New</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <button onClick={() => setStep('upload')} className="btn-outline px-4">← Back</button>
          <button onClick={() => { saveStaged(); setStep('review') }} className="btn-primary px-6">
            Confirm Mapping →
          </button>
        </div>
      </div>
    )
  }

  // ── STEP: Review ──────────────────────────────────────────────────────────

  const renderReview = () => {
    if (!staged) return null

    const tabs: { key: ReviewTab; label: string }[] = [
      { key: 'ingredients',  label: 'Ingredients'  },
      { key: 'vendors',      label: 'Vendors'       },
      { key: 'price_quotes', label: 'Price Quotes'  },
      { key: 'menus',        label: 'Menus'         },
      { key: 'recipes',      label: 'Recipes'       },
    ]

    const rows     = staged[reviewTab] as StagedRow[]
    const filtered = filterDups ? rows.filter(r => r._duplicate_of) : rows
    const dupCount = rows.filter(r => r._duplicate_of).length

    return (
      <div>
        {/* Prerequisites warning */}
        {(staged.prerequisites?.missing_units?.length > 0 || staged.prerequisites?.missing_countries?.length > 0) && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FEF3C7', color: '#92400E' }}>
            <strong>⚠ Prerequisites missing — these won't block import but will leave some fields blank:</strong>
            {staged.prerequisites.missing_units.length > 0 && (
              <span className="ml-2">Units not found: <em>{staged.prerequisites.missing_units.join(', ')}</em>. Create them in Settings → Units first.</span>
            )}
            {staged.prerequisites.missing_countries.length > 0 && (
              <span className="ml-2">Countries not found: <em>{staged.prerequisites.missing_countries.join(', ')}</em>. Create them in Markets first.</span>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border)' }}>
          {tabs.map(t => {
            const cnt    = (staged[t.key] as StagedRow[]).length
            const active = t.key === reviewTab
            return (
              <button key={t.key} onClick={() => setReviewTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${active ? 'border-accent text-accent' : 'border-transparent text-text-2 hover:text-text-1'}`}>
                {t.label} <span className="ml-1 text-xs opacity-70">({cnt})</span>
              </button>
            )
          })}
        </div>

        {/* Bulk actions */}
        <div className="flex items-center gap-3 mb-3">
          {dupCount > 0 && (
            <button onClick={() => skipAllDuplicates(reviewTab)} className="btn-outline text-xs px-3 py-1">
              Skip all duplicates ({dupCount})
            </button>
          )}
          {dupCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-2)' }}>
              <input type="checkbox" checked={filterDups} onChange={e => setFilterDups(e.target.checked)} />
              Show duplicates only
            </label>
          )}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-3)' }}>
            Click any cell to edit · Changes are saved when you click Next
          </span>
        </div>

        {/* Table */}
        <div className="card overflow-x-auto">
          {reviewTab === 'ingredients' && <IngredientsTable rows={filtered} staged={staged} updateRow={updateRow} resolvedCat={resolvedCat} dbCats={dbCats} />}
          {reviewTab === 'vendors'     && <VendorsTable     rows={filtered} updateRow={updateRow} />}
          {reviewTab === 'price_quotes'&& <QuotesTable      rows={filtered} updateRow={updateRow} staged={staged!} />}
          {reviewTab === 'recipes'     && <RecipesTable     rows={filtered} staged={staged} updateRow={updateRow} resolvedCat={resolvedCat} />}
          {reviewTab === 'menus'       && <MenusTable       rows={filtered} updateRow={updateRow} />}
        </div>

        <div className="mt-6 flex justify-between">
          <button onClick={() => setStep(Object.keys(staged.category_mapping||{}).length ? 'mapping' : 'upload')} className="btn-outline px-4">← Back</button>
          <button onClick={() => { saveStaged(); setStep('confirm') }} className="btn-primary px-6">Next: Confirm →</button>
        </div>
      </div>
    )
  }

  // ── STEP: Confirm ─────────────────────────────────────────────────────────

  const renderConfirm = () => {
    if (!staged) return null
    const entities: { key: ReviewTab; label: string }[] = [
      { key: 'vendors',      label: 'Vendors'      },
      { key: 'ingredients',  label: 'Ingredients'  },
      { key: 'price_quotes', label: 'Price Quotes' },
      { key: 'recipes',      label: 'Recipes'      },
      { key: 'menus',        label: 'Menus'        },
    ]
    return (
      <div className="max-w-xl">
        {execError && (
          <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: '#FEE2E2', color: '#DC2626' }}>
            {execError}
          </div>
        )}
        <div className="card p-5 mb-6">
          <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Import Summary</h3>
          <div className="space-y-2">
            {Object.values(staged.category_mapping||{}).filter(m => m.action === 'create').length > 0 && (
              <div className="flex items-center justify-between text-sm py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: 'var(--text-2)' }}>New categories</span>
                <span className="badge-green">{Object.values(staged.category_mapping).filter(m => m.action === 'create').length} new</span>
              </div>
            )}
            {entities.map(e => {
              const { create, skip, override } = countByAction((staged[e.key] as StagedRow[]) || [])
              return (
                <div key={e.key} className="flex items-center justify-between text-sm py-1.5 border-b" style={{ borderColor: 'var(--border)' }}>
                  <span style={{ color: 'var(--text-2)' }}>{e.label}</span>
                  <div className="flex gap-2">
                    {create   > 0 && <span className="badge-green">{create} new</span>}
                    {override > 0 && <span className="badge-yellow">{override} override</span>}
                    {skip     > 0 && <span className="badge-neutral">{skip} skip</span>}
                    {create === 0 && override === 0 && skip === 0 && <span className="text-xs text-text-3">nothing to import</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="flex justify-between">
          <button onClick={() => setStep('review')} className="btn-outline px-4">← Back to Review</button>
          <div className="flex gap-3">
            <button onClick={handleDiscard} className="btn-ghost text-sm px-4" style={{ color: 'var(--text-3)' }}>Discard</button>
            <button onClick={handleExecute} className="btn-primary px-8">Import Now →</button>
          </div>
        </div>
      </div>
    )
  }

  // ── STEP: Executing ───────────────────────────────────────────────────────

  const renderExecuting = () => (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <Spinner />
      <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Importing data…</p>
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>Writing records to database. Please wait.</p>
    </div>
  )

  // ── STEP: Done ────────────────────────────────────────────────────────────

  const renderDone = () => {
    if (!results) return null
    const rows = [
      { label: 'Categories created',    value: results.categories          },
      { label: 'Vendors imported',      value: results.vendors             },
      { label: 'Vendors updated',       value: results.vendors_updated     },
      { label: 'Vendors skipped',       value: results.vendors_skipped,    muted: true },
      { label: 'Ingredients imported',  value: results.ingredients         },
      { label: 'Ingredients updated',   value: results.ingredients_updated },
      { label: 'Ingredients skipped',   value: results.ingredients_skipped,muted: true },
      { label: 'Price quotes imported', value: results.price_quotes        },
      { label: 'Recipe quotes skipped', value: results.price_quotes_skipped,muted: true },
      { label: 'Recipes imported',      value: results.recipes             },
      { label: 'Recipes updated',       value: results.recipes_updated     },
      { label: 'Recipes skipped',       value: results.recipes_skipped,    muted: true },
      { label: 'Recipe items created',  value: results.recipe_items        },
      { label: 'Menus imported',        value: results.menus               },
      { label: 'Menus skipped',         value: results.menus_skipped,      muted: true },
      { label: 'Menu items created',    value: results.menu_items          },
    ]
    return (
      <div className="max-w-xl">
        <div className="card p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">✅</span>
            <h3 className="font-semibold" style={{ color: 'var(--accent)' }}>Import complete!</h3>
          </div>
          <div className="space-y-1">
            {rows.filter(r => r.value > 0).map(r => (
              <div key={r.label} className="flex justify-between text-sm py-1 border-b" style={{ borderColor: 'var(--border)' }}>
                <span style={{ color: r.muted ? 'var(--text-3)' : 'var(--text-2)' }}>{r.label}</span>
                <span className={r.muted ? 'text-text-3' : 'font-semibold'} style={{ color: r.muted ? undefined : 'var(--text-1)' }}>{r.value}</span>
              </div>
            ))}
          </div>
          {results.errors.length > 0 && (
            <div className="mt-3 p-2 rounded text-xs" style={{ background: '#FEF3C7', color: '#92400E' }}>
              <strong>Warnings:</strong>
              <ul className="mt-1 space-y-0.5 list-disc list-inside">{results.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => navigate('/inventory')} className="btn-primary px-5">Go to Inventory</button>
          <button onClick={() => navigate('/recipes')}   className="btn-outline px-5">Go to Recipes</button>
          <button onClick={handleDiscard}                className="btn-ghost px-5" style={{ color: 'var(--text-3)' }}>Import Another File</button>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <PageHeader
          title="Import Data"
          subtitle="Upload a spreadsheet and review before importing to your live database." />
        {step !== 'upload' && step !== 'parsing' && step !== 'done' && (
          <button onClick={handleDiscard} className="btn-ghost text-sm" style={{ color: 'var(--text-3)' }}>✕ Discard</button>
        )}
      </div>

      <StepBar step={step} />

      {step === 'upload'    && renderUpload()}
      {step === 'parsing'   && renderParsing()}
      {step === 'mapping'   && renderMapping()}
      {step === 'review'    && renderReview()}
      {step === 'confirm'   && renderConfirm()}
      {step === 'executing' && renderExecuting()}
      {step === 'done'      && renderDone()}
    </div>
  )
}

// ── Review sub-tables ─────────────────────────────────────────────────────────

interface TableProps {
  rows:       StagedRow[]
  updateRow:  (entity: ReviewTab, id: string, changes: Partial<StagedRow>) => void
  staged?:    StagedData
  resolvedCat?: (src: string) => string
  dbCats?:    DbCategory[]
}

function RowStatusBadge({ row }: { row: StagedRow }) {
  const c = statusColor(row._status)
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: c.bg, color: c.text }}>
        {c.label}
      </span>
      {row._issues.length > 0 && (
        <span title={row._issues.join('\n')} className="cursor-help text-xs" style={{ color: '#D97706' }}>⚠</span>
      )}
    </span>
  )
}

const TH = ({ children }: { children: React.ReactNode }) => (
  <th className="text-left px-3 py-2 text-xs font-semibold whitespace-nowrap" style={{ background: 'var(--surface-2)', color: 'var(--text-3)', borderBottom: '1px solid var(--border)' }}>
    {children}
  </th>
)
const TD = ({ children, className = '' }: { children?: React.ReactNode; className?: string }) => (
  <td className={`px-3 py-2 text-xs border-b ${className}`} style={{ borderColor: 'var(--border)', color: 'var(--text-1)' }}>
    {children}
  </td>
)

function IngredientsTable({ rows, updateRow, resolvedCat, dbCats }: TableProps) {
  const catOptions = [...new Set((dbCats||[]).map(c => c.name))]
  if (!rows.length) return <div className="p-6 text-center text-sm text-text-3">No ingredients found.</div>
  return (
    <table className="w-full min-w-[900px]">
      <thead><tr><TH>Action</TH><TH>Status</TH><TH>Name</TH><TH>Category</TH><TH>Base Unit</TH><TH>Prep Unit</TH><TH>Conv. to Base</TH><TH>Waste %</TH></tr></thead>
      <tbody>
        {rows.map(row => (
          <tr key={row._id} style={{ opacity: row._action === 'skip' ? 0.5 : 1 }}>
            <TD><ActionToggle value={row._action} hasDuplicate={!!row._duplicate_of} onChange={v => updateRow('ingredients', row._id, { _action: v })} /></TD>
            <TD><RowStatusBadge row={row} /></TD>
            <TD><EditCell value={String(row.name||'')}          onChange={v => updateRow('ingredients', row._id, { name: v })} /></TD>
            <TD><EditCell value={resolvedCat!(String(row.source_category||''))} onChange={v => updateRow('ingredients', row._id, { source_category: v })} type="select" options={catOptions} /></TD>
            <TD>
              <div className="flex items-center gap-1.5 flex-wrap">
                <EditCell value={String(row.unit||'')} onChange={v => updateRow('ingredients', row._id, { unit: v })} placeholder="e.g. kg" />
                {row.unit_source && row.unit_source !== row.unit && (
                  <span
                    className="text-xs px-1.5 py-0.5 rounded font-medium cursor-help shrink-0"
                    style={{ background: '#FEF3C7', color: '#92400E' }}
                    title={`Imported as "${row.unit_source}" — auto-matched to "${row.unit}" (${row.unit_method || 'matched'}). Click to override.`}>
                    was: {String(row.unit_source)}
                  </span>
                )}
              </div>
            </TD>
            <TD><EditCell value={String(row.prep_unit||'')} onChange={v => updateRow('ingredients', row._id, { prep_unit: v })} placeholder="e.g. portion" /></TD>
            <TD><EditCell value={String(row.prep_to_base_conversion||1)} onChange={v => updateRow('ingredients', row._id, { prep_to_base_conversion: parseFloat(v)||1 })} type="number" /></TD>
            <TD><EditCell value={String(row.waste_pct||0)}      onChange={v => updateRow('ingredients', row._id, { waste_pct: parseFloat(v)||0 })} type="number" /></TD>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function VendorsTable({ rows, updateRow }: TableProps) {
  if (!rows.length) return <div className="p-6 text-center text-sm text-text-3">No vendors found.</div>
  return (
    <table className="w-full min-w-[500px]">
      <thead><tr><TH>Action</TH><TH>Status</TH><TH>Name</TH><TH>Country</TH></tr></thead>
      <tbody>
        {rows.map(row => (
          <tr key={row._id} style={{ opacity: row._action === 'skip' ? 0.5 : 1 }}>
            <TD><ActionToggle value={row._action} hasDuplicate={!!row._duplicate_of} onChange={v => updateRow('vendors', row._id, { _action: v })} /></TD>
            <TD><RowStatusBadge row={row} /></TD>
            <TD><EditCell value={String(row.name||'')}    onChange={v => updateRow('vendors', row._id, { name: v })} /></TD>
            <TD><EditCell value={String(row.country||'')} onChange={v => updateRow('vendors', row._id, { country: v })} placeholder="e.g. United Kingdom" /></TD>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function QuotesTable({ rows, updateRow, staged }: TableProps) {
  // Build ingredient name → resolved base unit map for display in the conversion column
  const ingBaseUnit = new Map(
    (staged?.ingredients || []).map(i => [
      String(i.name || '').toLowerCase(),
      String(i.unit || ''),
    ])
  )

  if (!rows.length) return <div className="p-6 text-center text-sm text-text-3">No price quotes found.</div>
  return (
    <table className="w-full min-w-[750px]">
      <thead>
        <tr>
          <TH>Action</TH><TH>Status</TH><TH>Ingredient</TH><TH>Vendor</TH>
          <TH>Price</TH><TH>Purchase Unit</TH>
          <TH>
            <div>Conv. to Base</div>
            <div className="font-normal text-xs opacity-70">how many base units per purchase</div>
          </TH>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const baseUnit = ingBaseUnit.get(String(row.ingredient_name || '').toLowerCase()) || ''
          return (
            <tr key={row._id} style={{ opacity: row._action === 'skip' ? 0.5 : 1 }}>
              <TD><ActionToggle value={row._action} hasDuplicate={!!row._duplicate_of} onChange={v => updateRow('price_quotes', row._id, { _action: v })} /></TD>
              <TD><RowStatusBadge row={row} /></TD>
              <TD><EditCell value={String(row.ingredient_name||'')} onChange={v => updateRow('price_quotes', row._id, { ingredient_name: v })} /></TD>
              <TD><EditCell value={String(row.vendor_name||'')}     onChange={v => updateRow('price_quotes', row._id, { vendor_name: v })} /></TD>
              <TD><EditCell value={String(row.purchase_price||0)}   onChange={v => updateRow('price_quotes', row._id, { purchase_price: parseFloat(v)||0 })} type="number" /></TD>
              <TD><EditCell value={String(row.purchase_unit||'')}   onChange={v => updateRow('price_quotes', row._id, { purchase_unit: v })} placeholder="kg" /></TD>
              <TD>
                <div className="flex items-center gap-1">
                  <EditCell value={String(row.qty_in_base_units||1)} onChange={v => updateRow('price_quotes', row._id, { qty_in_base_units: parseFloat(v)||1 })} type="number" />
                  {baseUnit && <span className="text-xs text-text-3 shrink-0">{baseUnit}</span>}
                </div>
              </TD>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function RecipesTable({ rows, updateRow, resolvedCat, dbCats }: TableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const catOptions = [...new Set((dbCats||[]).map(c => c.name))]

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  if (!rows.length) return <div className="p-6 text-center text-sm text-text-3">No recipes found.</div>
  return (
    <table className="w-full min-w-[700px]">
      <thead><tr><TH>Action</TH><TH>Status</TH><TH>Name</TH><TH>Category</TH><TH>Yield</TH><TH>Items</TH></tr></thead>
      <tbody>
        {rows.flatMap(row => {
          const items      = (row.items as { item_name?: string; ingredient_name?: string; item_type?: string; qty: number; unit: string }[]) || []
          const isExpanded = expanded.has(row._id)
          return [
            <tr key={row._id} style={{ opacity: row._action === 'skip' ? 0.5 : 1 }}>
              <TD><ActionToggle value={row._action} hasDuplicate={!!row._duplicate_of} onChange={v => updateRow('recipes', row._id, { _action: v })} /></TD>
              <TD><RowStatusBadge row={row} /></TD>
              <TD><EditCell value={String(row.name||'')} onChange={v => updateRow('recipes', row._id, { name: v })} /></TD>
              <TD><EditCell value={resolvedCat!(String(row.source_category||''))} onChange={v => updateRow('recipes', row._id, { source_category: v })} type="select" options={catOptions} /></TD>
              <TD>{String(row.yield_qty||1)} {String(row.yield_unit||'')}</TD>
              <TD>
                <button onClick={() => toggle(row._id)} className="text-xs underline decoration-dotted" style={{ color: 'var(--accent)' }}>
                  {items.length} item{items.length !== 1 ? 's' : ''} {isExpanded ? '▲' : '▼'}
                </button>
              </TD>
            </tr>,
            ...(isExpanded ? items.map((item, j) => {
              const isSubRecipe = item.item_type === 'recipe'
              const displayName = item.item_name || item.ingredient_name || ''
              return (
                <tr key={`${row._id}-item-${j}`} style={{ background: 'var(--surface-2)' }}>
                  <TD />
                  <TD />
                  <TD className="pl-8">
                    <span className="italic text-text-3">
                      {isSubRecipe ? (
                        <span className="inline-flex items-center gap-1">
                          <span style={{ color: 'var(--accent)', fontSize: '10px' }}>📋</span>
                          <span>{displayName}</span>
                          <span className="text-xs px-1 rounded ml-1" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>sub-recipe</span>
                        </span>
                      ) : (
                        `↳ ${displayName}`
                      )}
                    </span>
                  </TD>
                  <TD />
                  <TD>{item.qty} {item.unit}</TD>
                  <TD />
                </tr>
              )
            }) : []),
          ]
        })}
      </tbody>
    </table>
  )
}

function MenusTable({ rows, updateRow }: TableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  if (!rows.length) return <div className="p-6 text-center text-sm text-text-3">No menus found.</div>
  return (
    <table className="w-full min-w-[700px]">
      <thead><tr><TH>Action</TH><TH>Status</TH><TH>Menu Name</TH><TH>Country</TH><TH>Description</TH><TH>Items</TH></tr></thead>
      <tbody>
        {rows.flatMap(row => {
          const items      = (row.items as { item_type?: string; item_name?: string; display_name?: string; sort_order?: number }[]) || []
          const isExpanded = expanded.has(row._id)
          return [
            <tr key={row._id} style={{ opacity: row._action === 'skip' ? 0.5 : 1 }}>
              <TD><ActionToggle value={row._action} hasDuplicate={!!row._duplicate_of} onChange={v => updateRow('menus', row._id, { _action: v })} /></TD>
              <TD><RowStatusBadge row={row} /></TD>
              <TD><EditCell value={String(row.name||'')}        onChange={v => updateRow('menus', row._id, { name: v })} /></TD>
              <TD><EditCell value={String(row.country||'')}     onChange={v => updateRow('menus', row._id, { country: v })} placeholder="e.g. United Kingdom" /></TD>
              <TD><EditCell value={String(row.description||'')} onChange={v => updateRow('menus', row._id, { description: v })} placeholder="optional" /></TD>
              <TD>
                <button onClick={() => toggle(row._id)} className="text-xs underline decoration-dotted" style={{ color: 'var(--accent)' }}>
                  {items.length} item{items.length !== 1 ? 's' : ''} {isExpanded ? '▲' : '▼'}
                </button>
              </TD>
            </tr>,
            ...(isExpanded ? items.map((item, j) => (
              <tr key={`${row._id}-mi-${j}`} style={{ background: 'var(--surface-2)' }}>
                <TD /><TD />
                <TD className="pl-8">
                  <span className="italic text-text-3">
                    ↳ {item.display_name || item.item_name || '—'}
                    {item.item_type === 'ingredient' && (
                      <span className="ml-1 text-xs px-1 rounded" style={{ background: '#E0E7FF', color: '#4338CA' }}>ingredient</span>
                    )}
                  </span>
                </TD>
                <TD /><TD />
                <TD><span className="text-xs text-text-3">#{item.sort_order || j + 1}</span></TD>
              </tr>
            )) : []),
          ]
        })}
      </tbody>
    </table>
  )
}
