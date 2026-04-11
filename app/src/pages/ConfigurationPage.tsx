import { useState, useRef, useEffect, useCallback } from 'react'
import MarketsPage    from './MarketsPage'
import CategoriesPage from './CategoriesPage'
import ImportPage     from './ImportPage'
import SettingsPage   from './SettingsPage'
import { StoresTab }  from './StockManagerPage'
import MediaLibrary   from '../components/MediaLibrary'
import { usePermissions } from '../hooks/usePermissions'
import { useApi } from '../hooks/useApi'
import { Field, Spinner } from '../components/ui'

// ── Section definitions ────────────────────────────────────────────────────────

type Section =
  | 'global-config'
  | 'location-structure'
  | 'centres'
  | 'categories'
  | 'units'
  | 'price-levels'
  | 'currency'
  | 'cogs-thresholds'
  | 'users-roles'
  | 'import'
  | 'media'
  | 'stock-config'

interface SectionDef {
  id:      Section
  icon:    string
  label:   string
  feature: string | null   // RBAC feature key, null = always visible
}

const SECTIONS: SectionDef[] = [
  { id: 'global-config',      icon: '⚙️', label: 'Global Config',      feature: 'settings'   },
  { id: 'location-structure', icon: '🌍', label: 'Location Structure', feature: 'markets'    },
  { id: 'centres',            icon: '🏪', label: 'Centres',             feature: 'stock_overview' },
  { id: 'categories',         icon: '🏷️', label: 'Categories',         feature: 'categories' },
  { id: 'units',              icon: '📐', label: 'Base Units',          feature: 'settings'   },
  { id: 'price-levels',       icon: '💰', label: 'Price Levels',        feature: 'settings'   },
  { id: 'currency',           icon: '💱', label: 'Currency',            feature: 'settings'   },
  { id: 'cogs-thresholds',    icon: '🎯', label: 'COGS Thresholds',     feature: 'settings'   },
  { id: 'users-roles',        icon: '👥', label: 'Users & Roles',       feature: 'users'      },
  { id: 'import',             icon: '📥', label: 'Import',              feature: 'import'     },
  { id: 'media',              icon: '🖼️', label: 'Media Library',       feature: null         },
  { id: 'stock-config',       icon: '📦', label: 'Stock Config',        feature: 'settings' },
]

// ── Global Config section ─────────────────────────────────────────────────────

interface Recipe { id: number; name: string; category_name: string | null }
interface SalesItemSlim { id: number; recipe_id: number | null }

function GlobalConfigSection() {
  const api = useApi()

  // Bulk-create modal state
  const [open,        setOpen]        = useState(false)
  const [loading,     setLoading]     = useState(false)
  const [recipes,     setRecipes]     = useState<Recipe[]>([])
  const [usedIds,     setUsedIds]     = useState<Set<number>>(new Set())
  const [search,      setSearch]      = useState('')
  const [selected,    setSelected]    = useState<Set<number>>(new Set())
  const [executing,   setExecuting]   = useState(false)
  const [progress,    setProgress]    = useState(0)
  const [result,      setResult]      = useState<{ created: number; skipped: number; errors: number } | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const openModal = async () => {
    setOpen(true); setSearch(''); setSelected(new Set()); setResult(null); setProgress(0)
    setLoading(true)
    try {
      const [recs, sis]: [Recipe[], SalesItemSlim[]] = await Promise.all([
        api.get('/recipes'),
        api.get('/sales-items?include_inactive=true'),
      ])
      setRecipes(recs || [])
      setUsedIds(new Set((sis || []).filter(s => s.recipe_id).map(s => s.recipe_id as number)))
    } catch { /* ignore — show empty */ }
    finally { setLoading(false); setTimeout(() => searchRef.current?.focus(), 50) }
  }

  const filtered = recipes.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    (r.category_name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const newCount     = [...selected].filter(id => !usedIds.has(id)).length
  const allFiltered  = filtered.length > 0 && filtered.every(r => selected.has(r.id))

  const toggleAll = () => {
    setSelected(prev => {
      const next = new Set(prev)
      if (allFiltered) filtered.forEach(r => next.delete(r.id))
      else             filtered.forEach(r => next.add(r.id))
      return next
    })
  }

  const execute = async () => {
    setExecuting(true); setProgress(0)
    let created = 0, skipped = 0, errors = 0
    const toCreate = [...selected]
    for (let i = 0; i < toCreate.length; i++) {
      const recipeId = toCreate[i]
      setProgress(Math.round(((i + 1) / toCreate.length) * 100))
      if (usedIds.has(recipeId)) { skipped++; continue }
      const recipe = recipes.find(r => r.id === recipeId)
      if (!recipe) { skipped++; continue }
      try {
        await api.post('/sales-items', { item_type: 'recipe', name: recipe.name, recipe_id: recipeId })
        created++
      } catch { errors++ }
    }
    setResult({ created, skipped, errors })
    setExecuting(false)
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-text-1 mb-1">Global Config</h2>
      <p className="text-sm text-text-3 mb-6">System-wide operations and bulk actions.</p>

      {/* ── Bulk create card ── */}
      <div className="card p-5 mb-4">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-text-1 mb-1">Bulk Create Sales Items from Recipes</h3>
            <p className="text-xs text-text-3">
              Select multiple recipes and generate Sales Items for them in one step.
              Recipes that already have a linked Sales Item will be skipped automatically.
            </p>
          </div>
          <button className="btn btn-primary btn-sm shrink-0" onClick={openModal}>
            Create from Recipes
          </button>
        </div>
      </div>

      {/* ── Modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl flex flex-col w-full max-w-lg" style={{ maxHeight: '85vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
              <div>
                <h3 className="font-semibold text-text-1">Create Sales Items from Recipes</h3>
                <p className="text-xs text-text-3 mt-0.5">
                  {loading ? 'Loading recipes…'
                    : result  ? `Done — ${result.created} created, ${result.skipped} skipped${result.errors ? `, ${result.errors} failed` : ''}`
                    : `${recipes.length} recipes · ${selected.size} selected · ${newCount} new`}
                </p>
              </div>
              <button className="text-text-3 hover:text-text-1 ml-4" onClick={() => setOpen(false)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {/* Result banner */}
            {result && (
              <div className={`mx-5 mt-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2 flex-shrink-0 ${result.errors > 0 ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-green-50 text-green-800 border border-green-200'}`}>
                <span className="text-base">{result.errors > 0 ? '⚠️' : '✅'}</span>
                <span>
                  <strong>{result.created}</strong> Sales Item{result.created !== 1 ? 's' : ''} created
                  {result.skipped > 0 && <>, <strong>{result.skipped}</strong> skipped (already exist)</>}
                  {result.errors  > 0 && <>, <strong>{result.errors}</strong> failed</>}
                </span>
              </div>
            )}

            {/* Search + select-all */}
            {!result && !loading && (
              <div className="px-5 pt-4 pb-2 flex-shrink-0 space-y-2">
                <input
                  ref={searchRef}
                  className="input w-full text-sm"
                  placeholder="Search recipes by name or category…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <label className="flex items-center gap-2 text-sm cursor-pointer select-none px-1">
                  <input type="checkbox"
                    checked={allFiltered}
                    onChange={toggleAll}
                    disabled={filtered.length === 0} />
                  <span className="text-text-2 font-medium">
                    {allFiltered ? 'Deselect all' : 'Select all'}
                    {search && ` (${filtered.length} shown)`}
                  </span>
                </label>
              </div>
            )}

            {/* Recipe list */}
            <div className="flex-1 overflow-y-auto px-5 py-2">
              {loading && (
                <div className="flex items-center justify-center py-12 text-text-3 text-sm">Loading recipes…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="text-center py-12 text-text-3 text-sm italic">No recipes match "{search}"</div>
              )}
              {!loading && filtered.map(r => {
                const alreadyExists = usedIds.has(r.id)
                const isSelected    = selected.has(r.id)
                return (
                  <label key={r.id}
                    className={`flex items-center gap-3 px-2 py-2 rounded cursor-pointer select-none transition-colors ${isSelected ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}>
                    <input type="checkbox"
                      checked={isSelected}
                      disabled={executing}
                      onChange={() => setSelected(prev => {
                        const next = new Set(prev)
                        isSelected ? next.delete(r.id) : next.add(r.id)
                        return next
                      })} />
                    <span className={`flex-1 text-sm ${isSelected ? 'text-accent font-medium' : 'text-text-1'}`}>{r.name}</span>
                    {r.category_name && (
                      <span className="text-xs text-text-3 shrink-0">{r.category_name}</span>
                    )}
                    {alreadyExists && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-200 shrink-0">exists</span>
                    )}
                  </label>
                )
              })}
            </div>

            {/* Progress bar */}
            {executing && (
              <div className="px-5 py-2 flex-shrink-0">
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-accent rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
                <p className="text-xs text-text-3 mt-1 text-center">{progress}% complete</p>
              </div>
            )}

            {/* Footer */}
            <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3 flex-shrink-0">
              <span className="text-xs text-text-3">
                {!result && !loading && selected.size > 0 && `${newCount} will be created · ${selected.size - newCount} will be skipped`}
              </span>
              <div className="flex gap-2">
                <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} disabled={executing}>
                  {result ? 'Close' : 'Cancel'}
                </button>
                {!result && (
                  <button className="btn btn-primary btn-sm"
                    disabled={selected.size === 0 || newCount === 0 || executing || loading}
                    onClick={execute}>
                    {executing ? 'Creating…' : `Create ${newCount} Sales Item${newCount !== 1 ? 's' : ''}`}
                  </button>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  )
}

// ── Centres section (wraps StoresTab from StockManagerPage) ──────────────────

function CentresSection() {
  const api = useApi()
  const { can } = usePermissions()
  const canWrite = can('stock_overview', 'write')
  const [locations, setLocations] = useState<{ id: number; name: string; country_name?: string; is_active: boolean }[]>([])
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadLocations = useCallback(async () => {
    try {
      const data = await api.get('/locations?active=true')
      setLocations(data || [])
    } catch { /* silent */ }
  }, [api])

  useEffect(() => { loadLocations() }, [loadLocations])

  return (
    <div className="flex flex-col h-full">
      <StoresTab api={api} locations={locations} canWrite={canWrite} showToast={showToast} onStoresChange={loadLocations} />
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-semibold text-white ${toast.type === 'success' ? 'bg-accent' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Stock Config section ──────────────────────────────────────────────────────

function StockConfigSection() {
  const api = useApi()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [config, setConfig] = useState({
    po_prefix: 'PO',
    grn_prefix: 'GRN',
    inv_prefix: 'INV',
    cn_prefix: 'CN',
    xfer_prefix: 'TRF',
    allow_backdated_po: false,
    allow_quote_creation_from_po: true,
    allow_po_price_override: true,
  })
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      try {
        const settings = await api.get('/settings')
        if (settings?.stock_config) setConfig(prev => ({ ...prev, ...settings.stock_config }))
      } catch { /* silent */ }
      finally { setLoading(false) }
    })()
  }, [api])

  const save = async () => {
    setSaving(true)
    try {
      await api.patch('/settings', { stock_config: config })
      setToast('Stock configuration saved')
      setTimeout(() => setToast(null), 3000)
    } catch { setToast('Failed to save') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="p-6 flex justify-center"><Spinner /></div>

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-base font-bold text-text-1 mb-1">Stock Configuration</h2>
      <p className="text-sm text-text-3 mb-5">Configure document number prefixes and stock manager behaviour.</p>

      <div className="space-y-6">
        {/* Document Number Prefixes */}
        <div>
          <h3 className="text-sm font-semibold text-text-1 mb-3">Document Number Prefixes</h3>
          <p className="text-xs text-text-3 mb-3">Customise the prefix for auto-generated document numbers. Numbers are sequential (e.g. PO-1001, PO-1002).</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Purchase Order Prefix">
              <input className="input w-full" value={config.po_prefix} onChange={e => setConfig(c => ({ ...c, po_prefix: e.target.value }))} placeholder="PO" />
            </Field>
            <Field label="Goods Received Prefix">
              <input className="input w-full" value={config.grn_prefix} onChange={e => setConfig(c => ({ ...c, grn_prefix: e.target.value }))} placeholder="GRN" />
            </Field>
            <Field label="Invoice Prefix">
              <input className="input w-full" value={config.inv_prefix} onChange={e => setConfig(c => ({ ...c, inv_prefix: e.target.value }))} placeholder="INV" />
            </Field>
            <Field label="Credit Note Prefix">
              <input className="input w-full" value={config.cn_prefix} onChange={e => setConfig(c => ({ ...c, cn_prefix: e.target.value }))} placeholder="CN" />
            </Field>
            <Field label="Transfer Prefix">
              <input className="input w-full" value={config.xfer_prefix} onChange={e => setConfig(c => ({ ...c, xfer_prefix: e.target.value }))} placeholder="TRF" />
            </Field>
          </div>
        </div>

        <hr className="border-border" />

        {/* Behaviour Settings */}
        <div>
          <h3 className="text-sm font-semibold text-text-1 mb-3">Behaviour</h3>
          <label className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg border border-border cursor-pointer hover:bg-white transition-colors">
            <input type="checkbox" checked={config.allow_backdated_po} onChange={e => setConfig(c => ({ ...c, allow_backdated_po: e.target.checked }))} className="rounded" />
            <div>
              <span className="text-sm font-medium text-text-1">Allow backdated purchase orders</span>
              <p className="text-xs text-text-3 mt-0.5">When disabled, PO dates must be today or in the future.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg border border-border cursor-pointer hover:bg-white transition-colors mt-2">
            <input type="checkbox" checked={config.allow_quote_creation_from_po} onChange={e => setConfig(c => ({ ...c, allow_quote_creation_from_po: e.target.checked }))} className="rounded" />
            <div>
              <span className="text-sm font-medium text-text-1">Allow creating price quotes from purchase orders</span>
              <p className="text-xs text-text-3 mt-0.5">When enabled, users with Inventory write access can save new price quotes directly from PO line items. When disabled, quotes can only be created in the Inventory module.</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-surface-2 rounded-lg border border-border cursor-pointer hover:bg-white transition-colors mt-2">
            <input type="checkbox" checked={config.allow_po_price_override} onChange={e => setConfig(c => ({ ...c, allow_po_price_override: e.target.checked }))} className="rounded" />
            <div>
              <span className="text-sm font-medium text-text-1">Allow overriding quoted prices on purchase orders</span>
              <p className="text-xs text-text-3 mt-0.5">When disabled, users must use the price, unit, and conversion from the existing quote. They can still change the order quantity. Disable this to enforce price consistency.</p>
            </div>
          </label>
        </div>

        <div className="pt-2">
          <button className="btn-primary py-2 px-5 rounded text-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-accent text-white px-4 py-3 rounded-lg shadow-lg text-sm font-semibold">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Users & Roles combined section ────────────────────────────────────────────

function UsersRolesSection() {
  const [subTab, setSubTab] = useState<'users' | 'roles'>('users')
  return (
    <div className="flex flex-col h-full">
      {/* Mini tab bar */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['users', 'roles'] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors whitespace-nowrap capitalize
              ${subTab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {t === 'users' ? 'Users' : 'Roles'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <SettingsPage embedded initialTab={subTab} />
      </div>
    </div>
  )
}

// ── ConfigurationPage ──────────────────────────────────────────────────────────

export default function ConfigurationPage() {
  const [active, setActive] = useState<Section>('global-config')
  const { can } = usePermissions()

  const visibleSections = SECTIONS.filter(s =>
    !s.feature || can(s.feature as any, 'read')
  )

  // Default to first visible section
  const effectiveActive = visibleSections.find(s => s.id === active)
    ? active
    : (visibleSections[0]?.id ?? 'location-structure')

  function renderContent() {
    switch (effectiveActive) {
      case 'global-config':      return <GlobalConfigSection />
      case 'location-structure': return <MarketsPage />
      case 'centres':            return <CentresSection />
      case 'categories':         return <CategoriesPage />
      case 'units':              return <SettingsPage embedded initialTab="units" />
      case 'price-levels':       return <SettingsPage embedded initialTab="price-levels" />
      case 'currency':           return <SettingsPage embedded initialTab="currency" />
      case 'cogs-thresholds':    return <SettingsPage embedded initialTab="thresholds" />
      case 'users-roles':        return <UsersRolesSection />
      case 'import':             return <ImportPage />
      case 'media':              return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <MediaLibrary open={true} onClose={() => {}} mode="page" />
        </div>
      )
      case 'stock-config':       return <StockConfigSection />
      default:                   return null
    }
  }

  return (
    <div className="flex h-full">

      {/* ── Left secondary nav ──────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border bg-surface flex flex-col overflow-y-auto">
        <div className="px-4 pt-5 pb-3 border-b border-border">
          <h1 className="text-sm font-bold text-text-1">Configuration</h1>
          <p className="text-xs text-text-3 mt-0.5">System-wide settings</p>
        </div>

        <nav className="py-3 flex-1">
          {visibleSections.map(section => (
            <button
              key={section.id}
              onClick={() => setActive(section.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left
                ${effectiveActive === section.id
                  ? 'bg-accent-dim text-accent font-semibold'
                  : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                }`}
            >
              <span className="text-base leading-none shrink-0">{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main content panel ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {renderContent()}
      </div>

    </div>
  )
}
