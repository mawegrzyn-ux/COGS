import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Spinner, EmptyState, Toast } from '../components/ui'
// ── Shared Allergen type ───────────────────────────────────────────────────────

interface Allergen { id: number; code: string; name: string }

// ── Inventory tab types & constants ───────────────────────────────────────────

type SortDir      = 'asc' | 'desc'
type AlgStatus    = 'contains' | 'may_contain' | 'free_from'
type AlgSaveState = 'idle' | 'saving' | 'saved' | 'error'

interface IngAllergenRowBase {
  ingredient_id: number
  name:          string
  category:      string | null
  _saveState:    AlgSaveState
}
type IngAllergenRow = IngAllergenRowBase & Record<string, any>

interface Country { id: number; name: string }

const ALG_STATUS_ORDER = ['contains', 'may_contain', 'free_from', null] as const

const ALG_CELL_CLS: Record<string, string> = {
  contains:    'bg-red-500 text-white hover:bg-red-600',
  may_contain: 'bg-amber-400 text-white hover:bg-amber-500',
  free_from:   'bg-green-500 text-white hover:bg-green-600',
}
const ALG_ABBR: Record<string, string> = {
  contains: 'C', may_contain: 'M', free_from: 'F',
}
const ALG_LABEL: Record<string, string> = {
  contains: 'Contains', may_contain: 'May Contain', free_from: 'Free From',
}

// ── Menu tab types ─────────────────────────────────────────────────────────────

interface Menu { id: number; name: string; country_name: string }
interface MatrixRow {
  menu_item_id: number
  display_name: string
  item_type:    string
  category:     string | null
  allergens:    Record<string, 'contains' | 'may_contain' | 'free_from' | null>
}
type ToastState = { message: string; type: 'success' | 'error' }
const STATUS_CELL: Record<string, string> = { contains: 'bg-red-500 text-white', may_contain: 'bg-amber-400 text-white', free_from: 'bg-green-500 text-white' }
const STATUS_ABBR: Record<string, string> = { contains: 'C', may_contain: 'M', free_from: 'F' }
const STATUS_TITLE: Record<string, string> = { contains: 'Contains', may_contain: 'May Contain', free_from: 'Free From' }

// ── AlgSortTh component ────────────────────────────────────────────────────────
// Sortable/filterable column header — defined at module level to prevent remount issues.
// Single button opens a combined Sort + Filter dropdown, matching ColumnHeader.tsx exactly.
// Uses position:fixed + getBoundingClientRect to escape the overflow:auto table wrapper.
function AlgSortTh({ label, field, sortField, sortDir, onSort, sticky, left, minWidth, filterOptions, filterValues, onFilter }: {
  label:          string
  field:          string
  sortField:      string
  sortDir:        SortDir
  onSort:         (f: string, d: SortDir) => void
  sticky?:        boolean
  left?:          number
  minWidth?:      number
  filterOptions?: { label: string; value: string }[]
  filterValues?:  string[]
  onFilter?:      (v: string[]) => void
}) {
  const [open,    setOpen]    = useState(false)
  const [search,  setSearch]  = useState('')
  const [dropPos, setDropPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const isActive  = sortField === field
  const hasFilter = (filterValues?.length ?? 0) > 0
  const hasFilterOptions = !!filterOptions && filterOptions.length > 0

  function openDropdown() {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setDropPos({ top: r.bottom + 4, left: r.left })
    setOpen(true)
  }

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function h(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false); setSearch('')
      }
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  // Reposition when table scrolls so dropdown tracks the header cell
  useEffect(() => {
    if (!open) return
    function reposition() {
      if (!btnRef.current) return
      const r = btnRef.current.getBoundingClientRect()
      setDropPos({ top: r.bottom + 4, left: r.left })
    }
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    return () => {
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
    }
  }, [open])

  // Auto-focus search when dropdown opens
  useEffect(() => {
    if (!open) setSearch('')
  }, [open])

  const visible = filterOptions?.filter(o => o.label.toLowerCase().includes(search.toLowerCase())) ?? []

  const stickyStyle: React.CSSProperties = sticky
    ? { position: 'sticky', left: left ?? 0, zIndex: 20, minWidth }
    : { minWidth }

  return (
    <th className={`px-3 py-3 text-left bg-surface-2 border-r border-border${sticky ? ' z-20' : ''}`} style={stickyStyle}>
      <div ref={wrapRef} className="relative inline-block">
        {/* Header button — clicking opens the combined sort+filter dropdown */}
        <button
          ref={btnRef}
          onClick={() => open ? setOpen(false) : openDropdown()}
          className={`flex items-center gap-1 text-xs font-semibold uppercase tracking-wide select-none transition-colors
            ${isActive || hasFilter ? 'text-accent' : 'text-text-2 hover:text-text-1'}`}
        >
          {label}
          <span className="ml-0.5">
            {isActive
              ? (sortDir === 'asc'
                  ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
                  : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>)
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="18 15 12 9 6 15" opacity="0.4"/><polyline points="6 9 12 15 18 9" opacity="0.4"/></svg>
            }
          </span>
          {hasFilter && (
            <span className="ml-0.5 px-1 rounded-full bg-accent text-white text-[9px] font-bold leading-4 min-w-[14px] text-center">
              {filterValues!.length}
            </span>
          )}
        </button>

        {/* Dropdown — fixed positioning escapes overflow:auto table wrapper */}
        {open && dropPos && (
          <div
            className="w-56 bg-surface border border-border rounded-lg shadow-lg overflow-hidden"
            style={{ position: 'fixed', top: dropPos.top, left: dropPos.left, zIndex: 99999 }}
          >
            {/* Sort section */}
            <div className="px-3 py-1.5 text-xs text-text-3 font-semibold uppercase tracking-wide border-b border-border bg-surface-2">
              Sort
            </div>
            <button
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2
                ${isActive && sortDir === 'asc' ? 'text-accent font-semibold' : 'text-text-1'}`}
              onMouseDown={e => { e.preventDefault(); onSort(field, 'asc'); setOpen(false) }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="18 15 12 9 6 15"/></svg>
              Ascending
            </button>
            <button
              className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2
                ${isActive && sortDir === 'desc' ? 'text-accent font-semibold' : 'text-text-1'}`}
              onMouseDown={e => { e.preventDefault(); onSort(field, 'desc'); setOpen(false) }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9"/></svg>
              Descending
            </button>

            {/* Filter section */}
            {hasFilterOptions && onFilter && (
              <>
                <div className="px-3 py-1.5 text-xs text-text-3 font-semibold uppercase tracking-wide border-t border-b border-border bg-surface-2 flex items-center justify-between">
                  <span>Filter</span>
                  {hasFilter && (
                    <button className="text-accent hover:underline font-normal normal-case tracking-normal"
                      onMouseDown={e => { e.preventDefault(); onFilter([]) }}>
                      Clear all
                    </button>
                  )}
                </div>
                <div className="px-2 py-2 border-b border-border">
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onMouseDown={e => e.stopPropagation()}
                    placeholder="Search…"
                    autoFocus
                    className="w-full px-2 py-1 text-sm bg-surface-2 border border-border rounded-md outline-none focus:border-accent transition-colors"
                  />
                </div>
                <div className="max-h-52 overflow-y-auto">
                  {visible.length === 0
                    ? <div className="px-3 py-2 text-sm text-text-3 italic">No matches</div>
                    : visible.map(opt => {
                        const checked = filterValues!.includes(opt.value)
                        return (
                          <button key={opt.value}
                            className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors flex items-center gap-2.5
                              ${checked ? 'text-accent' : 'text-text-1'}`}
                            onMouseDown={e => { e.preventDefault(); onFilter(checked ? filterValues!.filter(v => v !== opt.value) : [...filterValues!, opt.value]) }}
                          >
                            <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center transition-colors
                              ${checked ? 'bg-accent border-accent' : 'border-border'}`}>
                              {checked && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>}
                            </span>
                            <span className="truncate">{opt.label}</span>
                          </button>
                        )
                      })
                  }
                </div>
                <div className="px-2 py-2 border-t border-border bg-surface-2">
                  <button
                    className="w-full py-1.5 text-xs font-semibold rounded-md bg-accent text-white hover:opacity-90 transition-opacity"
                    onMouseDown={e => { e.preventDefault(); setOpen(false); setSearch('') }}
                  >
                    {hasFilter ? `Apply (${filterValues!.length} selected)` : 'Close'}
                  </button>
                </div>
              </>
            )}

            {/* If sort-only (no filter options), show a close button */}
            {!hasFilterOptions && (
              <div className="px-2 py-2 border-t border-border bg-surface-2">
                <button
                  className="w-full py-1.5 text-xs font-semibold rounded-md bg-accent text-white hover:opacity-90 transition-opacity"
                  onMouseDown={e => { e.preventDefault(); setOpen(false) }}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </th>
  )
}

// ── SearchIcon ─────────────────────────────────────────────────────────────────

function SearchIcon({ className = '' }: { className?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
}

// ── InventoryAllergenMatrix ────────────────────────────────────────────────────

function InventoryAllergenMatrix() {
  const api = useApi()

  const [allergens,     setAllergens]     = useState<Allergen[]>([])
  const [rows,          setRows]          = useState<IngAllergenRow[]>([])
  const [countries,     setCountries]     = useState<Country[]>([])
  const [filterCountry, setFilterCountry] = useState('')
  const [filterCats,    setFilterCats]    = useState<string[]>([])
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [toast,         setToast]         = useState<ToastState | null>(null)

  // Refs — kept in sync with state to avoid stale closures in debounce timers
  const rowsRef      = useRef<IngAllergenRow[]>([])
  const allergensRef = useRef<Allergen[]>([])
  const saveTimers   = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const quotedByCountry = useRef<Record<string, Set<number>>>({})

  rowsRef.current      = rows
  allergensRef.current = allergens

  const showToast = (msg: string, type: 'success' | 'error' = 'success') =>
    setToast({ message: msg, type })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ings, algs, assignments, ctrs, quotes] = await Promise.all([
        api.get('/ingredients'),
        api.get('/allergens'),
        api.get('/allergens/ingredients'),
        api.get('/countries'),
        api.get('/price-quotes'),
      ])

      setAllergens(algs || [])
      setCountries(ctrs || [])

      // Build country → Set<ingredient_id>
      const byCtry: Record<string, Set<number>> = {}
      for (const q of (quotes || [])) {
        const cid = String(q.country_id)
        if (!byCtry[cid]) byCtry[cid] = new Set()
        byCtry[cid].add(Number(q.ingredient_id))
      }
      quotedByCountry.current = byCtry

      // Build ingredient → { allergenCode: status } map
      const algMap: Record<number, Record<string, AlgStatus>> = {}
      for (const a of (assignments || [])) {
        if (!algMap[a.ingredient_id]) algMap[a.ingredient_id] = {}
        algMap[a.ingredient_id][a.code] = a.status
      }

      const built: IngAllergenRow[] = (ings || []).map((ing: any) => ({
        ingredient_id: ing.id,
        name:          ing.name,
        category:      ing.category,
        _saveState:    'idle' as AlgSaveState,
        ...(algs || []).reduce((acc: any, alg: any) => {
          acc[alg.code] = algMap[ing.id]?.[alg.code] ?? null
          return acc
        }, {}),
      }))
      setRows(built)
    } catch {
      showToast('Failed to load allergen data', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // Derived — categories for filter
  const categoryOptions = useMemo(() =>
    [...new Set(rows.map(r => r.category).filter(Boolean) as string[])].sort().map(c => ({ label: c, value: c }))
  , [rows])

  // Filtered rows
  const filteredRows = useMemo(() => {
    let result = rows
    if (filterCountry) {
      const allowed = quotedByCountry.current[filterCountry]
      result = allowed ? result.filter(r => allowed.has(r.ingredient_id)) : []
    }
    if (filterCats.length > 0) {
      result = result.filter(r => filterCats.includes(r.category ?? ''))
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(r => r.name.toLowerCase().includes(q))
    }
    return result
  }, [rows, filterCountry, filterCats, search])

  // Sort
  const [sortField, setSortField] = useState('name')
  const [sortDir,   setSortDir]   = useState<SortDir>('asc')

  function handleSort(field: string, dir: SortDir) {
    setSortField(field); setSortDir(dir)
  }

  const sorted = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const av = a[sortField] ?? ''
      const bv = b[sortField] ?? ''
      const cmp = String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredRows, sortField, sortDir])

  // Cycle allergen status on click → debounced save
  function cycleStatus(ingredientId: number, code: string) {
    setRows(prev => prev.map(r => {
      if (r.ingredient_id !== ingredientId) return r
      const cur    = r[code] as AlgStatus | null
      const nextIdx = (ALG_STATUS_ORDER.indexOf(cur) + 1) % ALG_STATUS_ORDER.length
      return { ...r, [code]: ALG_STATUS_ORDER[nextIdx] }
    }))

    // Debounce: after 600ms of no changes for this ingredient, save
    clearTimeout(saveTimers.current[ingredientId])
    saveTimers.current[ingredientId] = setTimeout(() => {
      const row = rowsRef.current.find(r => r.ingredient_id === ingredientId)
      if (!row) return
      const payload = allergensRef.current
        .filter(a => row[a.code] != null)
        .map(a => ({ allergen_id: a.id, status: row[a.code] as string }))
      performSave(ingredientId, payload)
    }, 600)
  }

  async function performSave(ingredientId: number, allergensList: any[]) {
    setRows(prev => prev.map(r => r.ingredient_id === ingredientId ? { ...r, _saveState: 'saving' } : r))
    try {
      await api.put(`/allergens/ingredient/${ingredientId}`, { allergens: allergensList })
      setRows(prev => prev.map(r => r.ingredient_id === ingredientId ? { ...r, _saveState: 'saved' } : r))
      setTimeout(() => {
        setRows(prev => prev.map(r => r.ingredient_id === ingredientId ? { ...r, _saveState: 'idle' } : r))
      }, 1500)
    } catch {
      showToast('Save failed', 'error')
      setRows(prev => prev.map(r => r.ingredient_id === ingredientId ? { ...r, _saveState: 'error' } : r))
    }
  }

  return (
    <>
      {/* ── Controls bar ────────────────────────────────────────────────────── */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search" placeholder="Search ingredients…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-52"
          />
        </div>

        <select
          className="select"
          value={filterCountry}
          onChange={e => setFilterCountry(e.target.value)}
        >
          <option value="">All Countries</option>
          {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {/* Legend */}
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {Object.entries(ALG_LABEL).map(([status, label]) => (
            <span key={status} className="flex items-center gap-1 text-xs text-text-2">
              <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${ALG_CELL_CLS[status].split(' ').slice(0, 2).join(' ')}`}>
                {ALG_ABBR[status]}
              </span>
              {label}
            </span>
          ))}
          <span className="text-xs text-text-3">· click cell to cycle · auto-saves</span>
        </div>
      </div>

      {loading ? <Spinner /> : sorted.length === 0 ? (
        <EmptyState
          message={search || filterCountry || filterCats.length > 0
            ? 'No ingredients match your filters.'
            : 'No ingredients found.'}
        />
      ) : (
        <div className="overflow-auto rounded-xl border border-border" style={{ maxHeight: 'calc(100vh - 310px)' }}>
          <table className="text-sm border-collapse" style={{ minWidth: `${310 + allergens.length * 52}px` }}>
            {/* ── Header ──────────────────────────────────────────────────── */}
            <thead>
              <tr>
                {/* Ingredient name — sticky left */}
                <AlgSortTh
                  label="Ingredient" field="name"
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                  sticky left={0} minWidth={200}
                />
                {/* Category — sticky behind name */}
                <AlgSortTh
                  label="Category" field="category"
                  sortField={sortField} sortDir={sortDir} onSort={handleSort}
                  sticky left={200} minWidth={130}
                  filterOptions={categoryOptions}
                  filterValues={filterCats}
                  onFilter={setFilterCats}
                />
                {/* 14 allergen columns — rotated headers */}
                {allergens.map(a => (
                  <th key={a.code} title={a.name} className="border-r border-border last:border-r-0 bg-surface-2 w-[52px] min-w-[52px]">
                    <div className="flex items-center justify-center text-[10px] font-bold uppercase text-text-2 tracking-wide"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 96 }}>
                      {a.code}
                    </div>
                  </th>
                ))}
                {/* Save indicator column */}
                <th className="w-7 bg-surface-2 border-l border-border" />
              </tr>
            </thead>

            {/* ── Body ────────────────────────────────────────────────────── */}
            <tbody>
              {sorted.map(row => (
                <tr
                  key={row.ingredient_id}
                  className={`border-b border-border last:border-0 transition-colors
                    ${row._saveState === 'saving' ? 'opacity-60' : 'hover:bg-surface-2/60'}`}
                >
                  {/* Name — sticky */}
                  <td
                    className="sticky left-0 z-10 bg-surface border-r border-border px-3 py-2 font-semibold text-text-1 whitespace-nowrap"
                    style={{ minWidth: 200 }}
                  >
                    {row.name}
                  </td>

                  {/* Category — sticky */}
                  <td
                    className="sticky bg-surface border-r border-border px-3 py-2 text-text-3 text-xs whitespace-nowrap"
                    style={{ left: 200, minWidth: 130 }}
                  >
                    {row.category || '—'}
                  </td>

                  {/* Allergen cells */}
                  {allergens.map(a => {
                    const status = row[a.code] as AlgStatus | null
                    return (
                      <td key={a.code} className="border-r border-border last:border-r-0">
                        <div className="flex items-center justify-center py-1.5">
                          <button
                            type="button"
                            title={`${a.name}: ${status ? ALG_LABEL[status] : 'Not set'} — click to cycle`}
                            onClick={() => cycleStatus(row.ingredient_id, a.code)}
                            className={`w-9 h-8 rounded font-bold text-xs transition-all active:scale-90
                              ${status
                                ? ALG_CELL_CLS[status]
                                : 'bg-surface-2 text-text-3 hover:bg-border border border-border'
                              }`}
                          >
                            {status ? ALG_ABBR[status] : '—'}
                          </button>
                        </div>
                      </td>
                    )
                  })}

                  {/* Save state */}
                  <td className="w-7 text-center border-l border-border">
                    {row._saveState === 'saving' && (
                      <span className="inline-block w-3 h-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    )}
                    {row._saveState === 'saved' && (
                      <span className="text-accent font-bold text-xs">✓</span>
                    )}
                    {row._saveState === 'error' && (
                      <span className="text-red-500 font-bold text-xs">!</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Row count */}
      {!loading && sorted.length > 0 && (
        <div className="mt-2 text-xs text-text-3 text-right">
          {sorted.length} ingredient{sorted.length !== 1 ? 's' : ''}
          {(filterCountry || filterCats.length > 0 || search) && ` (filtered from ${rows.length})`}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── MenuAllergenMatrix ─────────────────────────────────────────────────────────

function MenuAllergenMatrix() {
  const api = useApi()

  const [menus,     setMenus]     = useState<Menu[]>([])
  const [allergens, setAllergens] = useState<Allergen[]>([])
  const [matrix,    setMatrix]    = useState<MatrixRow[]>([])
  const [selectedMenu, setSelectedMenu] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [toast,     setToast]     = useState<ToastState | null>(null)

  // Category filter + group state
  const [groupBy,    setGroupBy]    = useState(false)
  const [filterCats, setFilterCats] = useState<string[]>([])
  const [catOpen,    setCatOpen]    = useState(false)
  const [catDropPos, setCatDropPos] = useState<{ top: number; left: number } | null>(null)
  const catBtnRef  = useRef<HTMLButtonElement>(null)
  const catDropRef = useRef<HTMLDivElement>(null)

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  // Load menus + allergen reference list
  useEffect(() => {
    Promise.all([
      api.get('/menus'),
      api.get('/allergens'),
    ]).then(([m, a]) => {
      setMenus(m || [])
      setAllergens(a || [])
    }).catch(() => showToast('Failed to load reference data', 'error'))
    .finally(() => setLoadingMeta(false))
  }, [api])

  // Load matrix whenever selected menu changes
  const loadMatrix = useCallback(async (menuId: string) => {
    if (!menuId) { setMatrix([]); return }
    setLoading(true)
    try {
      const data = await api.get(`/allergens/menu/${menuId}`)
      setMatrix(data?.items || [])
    } catch {
      showToast('Failed to load allergen matrix', 'error')
      setMatrix([])
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    loadMatrix(selectedMenu)
    setFilterCats([]) // reset category filter when menu changes
  }, [selectedMenu, loadMatrix])

  // Close category dropdown on outside click
  useEffect(() => {
    if (!catOpen) return
    function handle(e: MouseEvent) {
      if (
        catDropRef.current && !catDropRef.current.contains(e.target as Node) &&
        catBtnRef.current  && !catBtnRef.current.contains(e.target as Node)
      ) {
        setCatOpen(false)
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [catOpen])

  // Derived: all unique categories (sorted, 'Uncategorised' last)
  const allCategories = useMemo(() => {
    const cats = new Set(matrix.map(r => r.category || 'Uncategorised'))
    return [...cats].sort((a, b) => {
      if (a === 'Uncategorised') return 1
      if (b === 'Uncategorised') return -1
      return a.localeCompare(b)
    })
  }, [matrix])

  // Derived: filtered rows
  const filteredMatrix = useMemo(() =>
    filterCats.length === 0
      ? matrix
      : matrix.filter(r => filterCats.includes(r.category || 'Uncategorised')),
    [matrix, filterCats]
  )

  // Derived: grouped rows — null when groupBy is off
  const grouped = useMemo<[string, MatrixRow[]][] | null>(() => {
    if (!groupBy) return null
    const map: Record<string, MatrixRow[]> = {}
    for (const row of filteredMatrix) {
      const cat = row.category || 'Uncategorised'
      if (!map[cat]) map[cat] = []
      map[cat].push(row)
    }
    return Object.entries(map).sort(([a], [b]) => {
      if (a === 'Uncategorised') return 1
      if (b === 'Uncategorised') return -1
      return a.localeCompare(b)
    })
  }, [groupBy, filteredMatrix])

  function openCatDrop() {
    if (!catBtnRef.current) return
    const r = catBtnRef.current.getBoundingClientRect()
    setCatDropPos({ top: r.bottom + 4, left: r.left })
    setCatOpen(true)
  }

  function toggleCat(cat: string) {
    setFilterCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    )
  }

  // ── Legend items ────────────────────────────────────────────────────────────

  const legend = [
    { abbr: 'C', label: 'Contains',    cls: 'bg-red-500 text-white' },
    { abbr: 'M', label: 'May Contain', cls: 'bg-amber-400 text-white' },
    { abbr: 'F', label: 'Free From',   cls: 'bg-green-500 text-white' },
    { abbr: '—', label: 'Not Set',     cls: 'bg-surface-2 text-text-3' },
  ]

  const selectedMenuObj = menus.find(m => String(m.id) === selectedMenu)

  // ── Row renderer ────────────────────────────────────────────────────────────

  function renderRow(row: MatrixRow) {
    return (
      <tr key={row.menu_item_id} className="hover:bg-surface-2 transition-colors">
        <td className="sticky left-0 z-10 bg-surface border border-border px-4 py-2.5 font-semibold text-text-1 whitespace-nowrap">
          {row.display_name}
        </td>
        {allergens.map(a => {
          const status = row.allergens[a.code]
          return (
            <td key={a.code} className="border border-border p-1 text-center">
              {status ? (
                <span
                  title={STATUS_TITLE[status]}
                  className={`inline-flex items-center justify-center w-6 h-6 rounded font-bold text-xs ${STATUS_CELL[status]}`}
                >
                  {STATUS_ABBR[status]}
                </span>
              ) : (
                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-surface-2 text-text-3 text-xs">—</span>
              )}
            </td>
          )
        })}
      </tr>
    )
  }

  return (
    <>
      {/* ── Print-only header (hidden on screen) ─────────────────────────────── */}
      <div className="hidden print:block px-6 pt-5 pb-3 border-b border-gray-300">
        <h1 className="text-lg font-extrabold text-text-1 leading-tight">Allergen Matrix</h1>
        <p className="text-xs text-text-2 mt-0.5">
          {selectedMenuObj ? `${selectedMenuObj.name} — ${selectedMenuObj.country_name}` : ''}
          {' · '}EU FIC Regulation 1169/2011 — 14 major allergens
          {' · '}Printed: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
        </p>
        <div className="flex gap-5 mt-2">
          {legend.map(l => (
            <span key={l.abbr} className="flex items-center gap-1 text-xs text-text-2">
              <span className={`w-5 h-5 rounded flex items-center justify-center font-bold text-xs ${l.cls}`}>{l.abbr}</span>
              {l.label}
            </span>
          ))}
        </div>
      </div>

      {/* ── Controls bar (hidden when printing) ──────────────────────────────── */}
      <div className="px-6 py-4 border-b border-border bg-surface flex items-center gap-3 flex-wrap print:hidden">

        {/* Menu selector */}
        <div className="flex-1 min-w-[220px] max-w-xs">
          {loadingMeta ? (
            <div className="h-9 bg-surface-2 rounded animate-pulse" />
          ) : (
            <select
              className="select w-full"
              value={selectedMenu}
              onChange={e => setSelectedMenu(e.target.value)}
            >
              <option value="">Select a menu…</option>
              {menus.map(m => (
                <option key={m.id} value={m.id}>{m.name} — {m.country_name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Category filter button — only when matrix is loaded */}
        {matrix.length > 0 && (
          <button
            ref={catBtnRef}
            className={`btn-outline px-3 py-2 text-sm flex items-center gap-1.5 ${filterCats.length > 0 ? 'ring-2 ring-accent text-accent' : ''}`}
            onClick={() => catOpen ? setCatOpen(false) : openCatDrop()}
          >
            {/* funnel icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            {filterCats.length === 0
              ? 'All Categories'
              : `${filterCats.length} categor${filterCats.length === 1 ? 'y' : 'ies'}`}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
        )}

        {/* Group by category toggle — only when matrix is loaded */}
        {matrix.length > 0 && (
          <button
            className={`btn-outline px-3 py-2 text-sm flex items-center gap-1.5 ${groupBy ? 'bg-accent-dim text-accent border-accent font-semibold' : ''}`}
            onClick={() => setGroupBy(g => !g)}
            title="Group rows by category"
          >
            {/* list icon */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/>
              <line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/>
              <line x1="3" y1="6"  x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/>
              <line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            Group by Category
          </button>
        )}

        {/* Legend */}
        <div className="flex items-center gap-3 flex-wrap">
          {legend.map(l => (
            <div key={l.abbr} className="flex items-center gap-1.5 text-xs text-text-2">
              <span className={`w-5 h-5 rounded flex items-center justify-center font-bold text-xs ${l.cls}`}>{l.abbr}</span>
              {l.label}
            </div>
          ))}
        </div>

        {/* Print button */}
        <button
          className="ml-auto btn-outline px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => window.print()}
          disabled={matrix.length === 0}
          title={matrix.length === 0 ? 'Select a menu first' : 'Print or save as PDF'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Print / Save as PDF
        </button>
      </div>

      {/* ── Category filter dropdown (fixed-position, escapes overflow clip) ──── */}
      {catOpen && catDropPos && (
        <div
          ref={catDropRef}
          style={{ position: 'fixed', top: catDropPos.top, left: catDropPos.left, zIndex: 99999 }}
          className="bg-surface border border-border rounded shadow-modal w-56 py-1"
        >
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
            <span className="text-xs font-semibold text-text-2 uppercase tracking-wide">Category</span>
            {filterCats.length > 0 && (
              <button className="text-xs text-accent hover:underline" onClick={() => setFilterCats([])}>
                Clear
              </button>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto">
            {allCategories.map(cat => (
              <label
                key={cat}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2 cursor-pointer text-sm text-text-1"
              >
                <input
                  type="checkbox"
                  checked={filterCats.includes(cat)}
                  onChange={() => toggleCat(cat)}
                  className="accent-accent"
                />
                {cat}
              </label>
            ))}
          </div>

          {allCategories.length > 1 && (
            <div className="border-t border-border px-3 py-1.5">
              <button
                className="text-xs text-accent hover:underline"
                onClick={() =>
                  setFilterCats(filterCats.length === allCategories.length ? [] : [...allCategories])
                }
              >
                {filterCats.length === allCategories.length ? 'Deselect All' : 'Select All'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto p-6 print:overflow-visible print:p-4">
        {!selectedMenu ? (
          <EmptyState message="Select a menu above to view its allergen matrix." />
        ) : loading ? (
          <Spinner />
        ) : matrix.length === 0 ? (
          <EmptyState message="No menu items found, or none have allergen data assigned yet." />
        ) : filteredMatrix.length === 0 ? (
          <EmptyState message="No items match the selected categories." />
        ) : (
          <div className="overflow-x-auto print:overflow-visible">
            <table className="text-xs border-collapse" style={{ minWidth: `${280 + allergens.length * 48}px` }}>
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-surface border border-border px-4 py-3 text-left font-semibold text-text-1 min-w-[220px] whitespace-nowrap">
                    Menu Item
                  </th>
                  {allergens.map(a => (
                    <th
                      key={a.code}
                      title={a.name}
                      className="border border-border px-1 py-2 font-semibold text-text-2 text-center w-12 min-w-[48px]"
                    >
                      <div
                        className="text-xs uppercase tracking-wide"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: '72px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        {a.code}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grouped ? (
                  grouped.map(([cat, rows]) => (
                    <Fragment key={cat}>
                      {/* Category header row */}
                      <tr>
                        <td
                          colSpan={1 + allergens.length}
                          className="bg-accent-dim border border-border px-4 py-1.5 font-semibold text-xs text-accent uppercase tracking-wide"
                        >
                          {cat}
                        </td>
                      </tr>
                      {rows.map(row => renderRow(row))}
                    </Fragment>
                  ))
                ) : (
                  filteredMatrix.map(row => renderRow(row))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Main AllergenMatrixPage ────────────────────────────────────────────────────

export default function AllergenMatrixPage() {
  const [tab, setTab] = useState<'inventory' | 'menu'>(() => {
    const saved = localStorage.getItem('allergen-page-tab')
    return saved === 'menu' ? 'menu' : 'inventory'
  })

  return (
    <div className="flex flex-col h-full print:block">
      {/* Page header */}
      <div className="print:hidden">
        <PageHeader
          title="Allergens"
          subtitle="EU FIC Regulation 1169/2011 — 14 major allergens."
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 bg-surface border-b border-border print:hidden">
        {(['inventory', 'menu'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); localStorage.setItem('allergen-page-tab', t) }}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors
              ${tab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {t === 'inventory' ? 'Inventory Allergen Matrix' : 'Menu Allergen Matrix'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {tab === 'inventory'
          ? <InventoryAllergenMatrix />
          : <MenuAllergenMatrix />
        }
      </div>
    </div>
  )
}
