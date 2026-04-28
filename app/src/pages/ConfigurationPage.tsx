import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import MarketsPage    from './MarketsPage'
import CategoriesPage from './CategoriesPage'
import ImportPage     from './ImportPage'
import SettingsPage   from './SettingsPage'

import MediaLibrary   from '../components/MediaLibrary'
import { usePermissions } from '../hooks/usePermissions'
import { useApi } from '../hooks/useApi'
import { Field, Spinner } from '../components/ui'
import { useFeatureFlags, FeatureFlags } from '../contexts/FeatureFlagsContext'

// ── Section definitions ────────────────────────────────────────────────────────

type Section =
  | 'global-config'
  | 'location-structure'
  | 'categories'
  | 'units'
  | 'price-levels'
  | 'currency'
  | 'cogs-thresholds'
  | 'users-roles'
  | 'import'
  | 'media'
  | 'stock-config'
  | 'languages'

interface SectionDef {
  id:      Section
  icon:    string
  label:   string
  feature: string | null   // RBAC feature key, null = always visible
}

const SECTIONS: SectionDef[] = [
  { id: 'global-config',      icon: '⚙️', label: 'Global Config',      feature: 'settings'   },
  { id: 'location-structure', icon: '🌍', label: 'Location Structure', feature: 'markets'    },
  { id: 'categories',         icon: '🏷️', label: 'Categories',         feature: 'categories' },
  { id: 'units',              icon: '📐', label: 'Base Units',          feature: 'settings'   },
  { id: 'price-levels',       icon: '💰', label: 'Price Levels',        feature: 'settings'   },
  { id: 'currency',           icon: '💱', label: 'Currency',            feature: 'settings'   },
  { id: 'cogs-thresholds',    icon: '🎯', label: 'COGS Thresholds',     feature: 'settings'   },
  { id: 'users-roles',        icon: '👥', label: 'Users & Roles',       feature: 'users'      },
  { id: 'import',             icon: '📥', label: 'Import',              feature: 'import'     },
  { id: 'media',              icon: '🖼️', label: 'Media Library',       feature: null         },
  { id: 'stock-config',       icon: '📦', label: 'Stock Config',        feature: 'settings' },
  { id: 'languages',          icon: '🌐', label: 'Languages',           feature: 'settings' },
]

// ── Feature Toggles card ──────────────────────────────────────────────────────

interface FlagDef {
  key:         keyof FeatureFlags
  label:       string
  description: string
  icon:        string
}

const FEATURE_FLAG_DEFS: FlagDef[] = [
  { key: 'stock_manager', icon: '📦', label: 'Stock Management', description: 'Purchase orders, goods received, invoices, waste, transfers, stocktake. When off, the Stock Manager nav item is hidden.' },
  { key: 'haccp',         icon: '🛡️', label: 'HACCP',             description: 'Food safety compliance — temperature logs, CCP logs, equipment register. When off, the HACCP nav item is hidden.' },
  { key: 'allergens',     icon: '⚠️', label: 'Allergens',          description: 'EU/UK FIC 14-allergen matrix for ingredients and menu items. When off, the Allergens nav item is hidden.' },
  { key: 'variations',    icon: '🌍', label: 'Recipe Variations', description: 'Market, price-level, and market+PL recipe variations. When off, recipes use a single global ingredient list only.' },
  { key: 'audits',        icon: '📋', label: 'QSC Audits',         description: 'Wingstop Quality/Service/Cleanliness audits with scored reports, templates, and photo/temperature capture. When off, the Audits nav item is hidden.' },
]

function FeatureFlagsCard() {
  const { flags, loading, update } = useFeatureFlags()
  const { can } = usePermissions()
  const canEdit = can('settings', 'write')
  const [savingKey, setSavingKey] = useState<keyof FeatureFlags | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const toggle = async (key: keyof FeatureFlags) => {
    if (!canEdit || savingKey) return
    setSavingKey(key)
    try {
      await update({ [key]: !flags[key] })
      setToast(`${FEATURE_FLAG_DEFS.find(d => d.key === key)?.label} ${!flags[key] ? 'enabled' : 'disabled'}`)
      setTimeout(() => setToast(null), 2500)
    } catch {
      setToast('Failed to save — please try again')
      setTimeout(() => setToast(null), 3000)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="card p-5 mb-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-text-1 mb-1">Feature Toggles</h3>
        <p className="text-xs text-text-3">
          Enable or disable top-level modules. Disabled modules disappear from the sidebar and their URLs redirect to the dashboard.
          These toggles apply system-wide and do not change per-user RBAC permissions.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-4"><Spinner /></div>
      ) : (
        <div className="space-y-2">
          {FEATURE_FLAG_DEFS.map(def => {
            const enabled = flags[def.key]
            const isSaving = savingKey === def.key
            return (
              <label
                key={def.key}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors select-none
                  ${enabled ? 'bg-accent-dim/40 border-accent/30' : 'bg-surface-2 border-border'}
                  ${canEdit ? 'cursor-pointer hover:bg-white' : 'cursor-not-allowed opacity-80'}`}
              >
                <span className="text-lg leading-none mt-0.5">{def.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${enabled ? 'text-text-1' : 'text-text-2'}`}>{def.label}</span>
                    {enabled
                      ? <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-700 border border-green-200">Enabled</span>
                      : <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">Disabled</span>
                    }
                  </div>
                  <p className="text-xs text-text-3 mt-1">{def.description}</p>
                </div>
                {/* Toggle switch */}
                <button
                  type="button"
                  onClick={() => toggle(def.key)}
                  disabled={!canEdit || isSaving}
                  role="switch"
                  aria-checked={enabled}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors
                    ${enabled ? 'bg-accent' : 'bg-gray-300'}
                    ${canEdit && !isSaving ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform
                      ${enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
                  />
                </button>
              </label>
            )
          })}
        </div>
      )}

      {!canEdit && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
          You need settings write access to change these toggles.
        </p>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-accent text-white px-4 py-3 rounded-lg shadow-lg text-sm font-semibold">
          {toast}
        </div>
      )}
    </div>
  )
}

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

      {/* ── Feature toggles card ── */}
      <FeatureFlagsCard />

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

// ── Languages section ─────────────────────────────────────────────────────────
// Admin UI for the mcogs_languages reference table — toggle is_active per
// language (controls what shows up in the top-bar LanguageSwitcher), set the
// default, edit name / native_name, add new languages, delete (refusing 'en'
// and the current default).
//
// Backed by /api/languages CRUD. Mutations require settings:write — the row
// itself stays visible to anyone with settings:read so the edit form gates
// itself, no need to hide the section.

interface Lang {
  code: string
  name: string
  native_name: string | null
  is_default: boolean
  is_rtl: boolean
  is_active: boolean
  sort_order: number
}

function LanguagesSection() {
  const api = useApi()
  const { can } = usePermissions()
  const canEdit = can('settings', 'write')

  const [rows, setRows]       = useState<Lang[]>([])
  const [loading, setLoading] = useState(true)
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [toast, setToast]     = useState<{ msg: string; ok: boolean } | null>(null)

  // Add-new modal state
  const [showAdd, setShowAdd] = useState(false)
  const [draft, setDraft]     = useState({ code: '', name: '', native_name: '', is_rtl: false })

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/languages')
      setRows((data as Lang[]) || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  // Helper for partial PUTs that just toggle a single boolean per row.
  const patch = async (code: string, patch: Partial<Lang>, optimistic?: (prev: Lang[]) => Lang[]) => {
    setSavingCode(code)
    if (optimistic) setRows(optimistic)
    try {
      await api.put(`/languages/${code}`, patch)
      // Reload to pick up server-side side effects (clearing other defaults)
      await load()
    } catch (err: any) {
      showToast(err?.message || 'Save failed', false)
      await load()  // revert
    } finally { setSavingCode(null) }
  }

  const onToggleActive = (l: Lang) =>
    patch(l.code, { is_active: !l.is_active },
      prev => prev.map(r => r.code === l.code ? { ...r, is_active: !r.is_active } : r))

  const onSetDefault = (l: Lang) =>
    patch(l.code, { is_default: true },
      prev => prev.map(r => ({ ...r, is_default: r.code === l.code })))

  const onToggleRtl = (l: Lang) =>
    patch(l.code, { is_rtl: !l.is_rtl },
      prev => prev.map(r => r.code === l.code ? { ...r, is_rtl: !r.is_rtl } : r))

  const onDelete = async (l: Lang) => {
    if (!window.confirm(`Delete language "${l.name}" (${l.code})? This is irreversible.`)) return
    setSavingCode(l.code)
    try {
      await api.delete(`/languages/${l.code}`)
      showToast(`Deleted ${l.code}`)
      await load()
    } catch (err: any) {
      showToast(err?.message || 'Delete failed', false)
    } finally { setSavingCode(null) }
  }

  const onAdd = async () => {
    const code = draft.code.trim().toLowerCase()
    const name = draft.name.trim()
    if (!code || !name) { showToast('Code and name are required', false); return }
    if (code.length > 5)   { showToast('Code should be a short ISO-639 tag (2–5 chars)', false); return }
    setSavingCode('__new__')
    try {
      await api.post('/languages', {
        code, name,
        native_name: draft.native_name.trim() || null,
        is_rtl: draft.is_rtl,
        is_active: true,
        sort_order: (rows[rows.length - 1]?.sort_order ?? 0) + 10,
      })
      setShowAdd(false)
      setDraft({ code: '', name: '', native_name: '', is_rtl: false })
      showToast(`Added ${code}`)
      await load()
    } catch (err: any) {
      showToast(err?.message || 'Add failed', false)
    } finally { setSavingCode(null) }
  }

  const activeCount = rows.filter(r => r.is_active).length

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-semibold text-text-1 mb-1">🌐 Languages</h2>
          <p className="text-sm text-text-3 leading-relaxed">
            Activate the languages that should appear in the top-bar Language switcher. Inactive
            languages stay in the database (their seeded translations are preserved) but are hidden
            from end-users. Default language is the fallback when a user has no preference.
          </p>
        </div>
        {canEdit && (
          <button
            className="btn btn-primary text-sm whitespace-nowrap"
            onClick={() => setShowAdd(true)}
            disabled={!!savingCode}
          >+ Add language</button>
        )}
      </div>

      <div className="text-xs text-text-3 mb-3">
        {loading ? 'Loading…' : `${activeCount} of ${rows.length} languages active`}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-text-3 text-xs uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">Code</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Native name</th>
              <th className="px-3 py-2 text-center">Active</th>
              <th className="px-3 py-2 text-center">Default</th>
              <th className="px-3 py-2 text-center">RTL</th>
              {canEdit && <th className="px-3 py-2 w-12" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(l => {
              const busy = savingCode === l.code
              const isEnglish = l.code === 'en'
              return (
                <tr key={l.code} className={busy ? 'opacity-50' : ''}>
                  <td className="px-3 py-2 font-mono text-xs uppercase">{l.code}</td>
                  <td className="px-3 py-2">{l.name}</td>
                  <td className="px-3 py-2 text-text-3">{l.native_name ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {/* Cannot deactivate English — it's the universal fallback. */}
                    <input
                      type="checkbox"
                      checked={l.is_active}
                      onChange={() => onToggleActive(l)}
                      disabled={!canEdit || busy || isEnglish || l.is_default}
                      title={isEnglish ? 'English cannot be deactivated' : l.is_default ? 'The default language is always active' : ''}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {l.is_default ? (
                      <span className="text-xs font-semibold text-accent">★ default</span>
                    ) : (
                      <button
                        className="text-xs text-text-3 hover:text-accent disabled:opacity-50"
                        onClick={() => onSetDefault(l)}
                        disabled={!canEdit || busy || !l.is_active}
                        title={!l.is_active ? 'Activate the language first' : 'Make this the default'}
                      >make default</button>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={l.is_rtl}
                      onChange={() => onToggleRtl(l)}
                      disabled={!canEdit || busy}
                      className="cursor-pointer"
                    />
                  </td>
                  {canEdit && (
                    <td className="px-3 py-2 text-center">
                      {!isEnglish && !l.is_default && (
                        <button
                          className="text-text-3 hover:text-red-500 text-xs"
                          onClick={() => onDelete(l)}
                          disabled={busy}
                          title="Delete language"
                        >✕</button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={canEdit ? 7 : 6} className="px-3 py-6 text-center text-text-3">
                No languages defined.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-3 mt-3 leading-relaxed">
        Toggling <strong>Active</strong> updates the LanguageSwitcher in the top bar immediately for new sessions —
        existing tabs may need a soft reload. Inactive languages keep their seeded translations and become available again
        when re-activated. Per-country default language is set on the Location Structure → Markets page.
      </p>

      {/* Add modal */}
      {showAdd && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-2xl w-[420px] max-w-full p-5 space-y-3">
            <h3 className="text-base font-semibold">Add language</h3>
            <Field label="Code (ISO-639, e.g. fr, es-MX)">
              <input
                className="input w-full"
                value={draft.code}
                onChange={e => setDraft(d => ({ ...d, code: e.target.value }))}
                autoFocus
                maxLength={5}
                placeholder="fr"
              />
            </Field>
            <Field label="Name (English)">
              <input
                className="input w-full"
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="French"
              />
            </Field>
            <Field label="Native name">
              <input
                className="input w-full"
                value={draft.native_name}
                onChange={e => setDraft(d => ({ ...d, native_name: e.target.value }))}
                placeholder="Français"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.is_rtl}
                onChange={e => setDraft(d => ({ ...d, is_rtl: e.target.checked }))}
              />
              Right-to-left script (Arabic / Hebrew etc.)
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button
                className="btn btn-outline text-sm"
                onClick={() => setShowAdd(false)}
                disabled={savingCode === '__new__'}
              >Cancel</button>
              <button
                className="btn btn-primary text-sm"
                onClick={onAdd}
                disabled={savingCode === '__new__'}
              >{savingCode === '__new__' ? 'Adding…' : 'Add'}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {toast && (
        <div className={`fixed bottom-6 right-6 px-3 py-2 rounded-lg shadow-lg text-sm ${
          toast.ok ? 'bg-accent text-white' : 'bg-red-500 text-white'
        }`}>{toast.msg}</div>
      )}
    </div>
  )
}

// ── Users & Roles combined section ────────────────────────────────────────────

function UsersRolesSection() {
  const [subTab, setSubTab] = useState<'users' | 'roles' | 'templates'>('users')
  const TAB_LABEL = { users: 'Users', roles: 'Roles', templates: 'Scope templates' }
  return (
    <div className="flex flex-col h-full">
      {/* Mini tab bar */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['users', 'roles', 'templates'] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors whitespace-nowrap
              ${subTab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {TAB_LABEL[t]}
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
  // Deep-link support: /configuration#users-roles, /configuration#import etc.
  // Used by Pepper's navigate_to_page tool with an optional `section` param
  // and by any external link that points at a sub-section. Unknown hashes
  // fall through to the default first section.
  const readHash = (): Section => {
    if (typeof window === 'undefined') return 'global-config'
    const raw = (window.location.hash || '').replace(/^#/, '')
    return SECTIONS.some(s => s.id === raw) ? (raw as Section) : 'global-config'
  }
  const [active, setActive] = useState<Section>(readHash)
  const { can } = usePermissions()

  // Listen for in-app hash changes so Pepper-driven navigation works even
  // when the user is already on /configuration.
  useEffect(() => {
    const onHash = () => setActive(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      case 'languages':          return <LanguagesSection />
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
