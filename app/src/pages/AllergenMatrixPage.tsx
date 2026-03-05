import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Spinner, EmptyState, Toast } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Allergen {
  id:   number
  code: string
  name: string
}

interface Menu {
  id:          number
  name:        string
  country_name: string
}

interface MatrixRow {
  menu_item_id: number
  display_name: string
  item_type:    string
  category:     string | null
  allergens:    Record<string, 'contains' | 'may_contain' | 'free_from' | null>
}

type ToastState = { message: string; type: 'success' | 'error' }

// ── Status styling ─────────────────────────────────────────────────────────────

const STATUS_CELL: Record<string, string> = {
  contains:    'bg-red-500 text-white',
  may_contain: 'bg-amber-400 text-white',
  free_from:   'bg-green-500 text-white',
}

const STATUS_ABBR: Record<string, string> = {
  contains:    'C',
  may_contain: 'M',
  free_from:   'F',
}

const STATUS_TITLE: Record<string, string> = {
  contains:    'Contains',
  may_contain: 'May Contain',
  free_from:   'Free From',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AllergenMatrixPage() {
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
    <div className="flex flex-col h-full">

      {/* ── Screen-only page header ───────────────────────────────────────────── */}
      <div className="print:hidden">
        <PageHeader
          title="Allergen Matrix"
          subtitle="EU FIC Regulation 1169/2011 — 14 major allergens per menu item."
        />
      </div>

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
    </div>
  )
}
