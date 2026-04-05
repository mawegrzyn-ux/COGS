import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast, PepperHelpButton } from '../components/ui'
import { useSortFilter } from '../hooks/useSortFilter'
import { ColumnHeader } from '../components/ColumnHeader'
import { DataGrid, GridToggleButton } from '../components/DataGrid'
import type { GridColumn, GridOption } from '../components/DataGrid'
import ImageUpload from '../components/ImageUpload'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor {
  id:              number
  name:            string
  country_id:      number
  country_name:    string
  currency_code:   string
  currency_symbol: string
  contact:         string | null
  email:           string | null
  phone:           string | null
  notes:           string | null
}

interface Country {
  id:              number
  name:            string
  currency_code:   string
  currency_symbol: string
}

interface Ingredient {
  id:                              number
  name:                            string
  category_id:                     number | null
  category_name:                   string | null
  base_unit_id:                    number | null
  base_unit_name:                  string | null
  base_unit_abbr:                  string | null
  default_prep_unit:               string | null
  default_prep_to_base_conversion: string
  notes:                           string | null
  image_url:                       string | null
  waste_pct:                       string
  quote_count:                     string
  active_quote_count:              string
  barcode:                         string | null
  dietary_flags:                   Record<string, boolean> | null
  energy_kcal:                     number | null
  protein_g:                       number | null
  carbs_g:                         number | null
  fat_g:                           number | null
  fibre_g:                         number | null
  sugar_g:                         number | null
  salt_g:                          number | null
  nutrition_source:                string | null
  nutrition_updated_at:            string | null
}

interface Allergen {
  id:     number
  code:   string
  name:   string
  eu_fic: boolean
}

interface IngAllergen {
  allergen_id: number
  code:        string
  name:        string
  status:      'contains' | 'may_contain' | 'free_from'
}

interface Quote {
  id:                  number
  ingredient_id:       number
  ingredient_name:     string
  ingredient_category: string | null
  base_unit_name:      string | null
  base_unit_abbr:      string | null
  vendor_id:           number
  vendor_name:         string
  country_id:          number
  country_name:        string
  currency_code:       string
  currency_symbol:     string
  purchase_price:      string
  qty_in_base_units:   string
  purchase_unit:       string | null
  price_per_base_unit: string | null
  is_active:           boolean
  is_preferred:        boolean
  vendor_product_code: string | null
}

interface Unit {
  id:                              number
  name:                            string
  abbreviation:                    string
  type:                            string
  default_recipe_unit:             string | null
  default_recipe_unit_conversion:  number | null
}

interface MenuRef { id: number; name: string; country_name: string }

type Tab        = 'ingredients' | 'quotes' | 'vendors'
type ToastState = { message: string; type: 'success' | 'error' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const api = useApi()
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem('inventory-tab') as Tab | null
    return (saved && ['ingredients', 'quotes', 'vendors'].includes(saved))
      ? saved
      : 'quotes'
  })

  const [ingredientCount, setIngredientCount] = useState<number>(0)
  const [quoteCount,      setQuoteCount]      = useState<number>(0)
  const [vendorCount,     setVendorCount]     = useState<number>(0)
  const [countryCount,    setCountryCount]    = useState<number>(0)
  const [initialQuoteIngId, setInitialQuoteIngId] = useState<number | undefined>(undefined)

  // Single lightweight stats call for header badges — avoids full-table fetches just for counts
  useEffect(() => {
    api.get('/ingredients/stats').then((s: any) => {
      if (!s) return
      setIngredientCount(s.ingredient_count  ?? 0)
      setQuoteCount(     s.active_quote_count ?? 0)
      setVendorCount(    s.vendor_count       ?? 0)
      setCountryCount(   s.country_count      ?? 0)
    }).catch(() => {})
  }, [api])

  const TAB_LABELS: Record<Tab, string> = {
    'ingredients':  'Ingredients',
    'quotes':       'Price Quotes',
    'vendors':      'Vendors',
  }

  const TAB_TUTORIALS: Record<Tab, string> = {
    'ingredients': 'How do I use the Ingredients tab? Explain adding an ingredient, setting base unit, waste percentage, prep unit conversion, and how categories work.',
    'quotes':      'How do Price Quotes work? Explain how one ingredient can have multiple quotes from different vendors in different countries, what the preferred vendor setting does, how is_active affects COGS, and the best workflow for pricing ingredients across multiple markets.',
    'vendors':     'How do Vendors work in COGS Manager? Explain country-scoping of vendors, why each vendor belongs to one country, and the workflow for setting up suppliers for a new market.',
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Inventory"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1">
            <span>Manage ingredients, vendor price quotes, and preferred suppliers per country.</span>
            {ingredientCount > 0 && (
              <span className="flex items-center gap-x-2 ml-2 text-text-3">
                <StatPill value={ingredientCount} label="ingredients" />
                <span className="text-border select-none">·</span>
                <StatPill value={quoteCount} label="active quotes" />
                <span className="text-border select-none">·</span>
                <StatPill value={vendorCount} label="vendors" />
                <span className="text-border select-none">·</span>
                <StatPill value={countryCount} label="countries" />
              </span>
            )}
          </span>
        }
        tutorialPrompt="Give me an overview of the Inventory section. What are the three tabs — Ingredients, Price Quotes, and Vendors — and how do they connect to build a complete cost picture for each market?"
      />

      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['ingredients', 'quotes', 'vendors'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); localStorage.setItem('inventory-tab', t) }}
            data-ai-context={JSON.stringify({ type: 'tutorial', prompt: TAB_TUTORIALS[t] })}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors
              ${tab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            <span className="flex items-center gap-1.5">
                {TAB_LABELS[t]}
                <PepperHelpButton prompt={TAB_TUTORIALS[t]} size={12} />
              </span>
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'ingredients'   && <IngredientsTab onViewQuotes={id => { setInitialQuoteIngId(id); setTab('quotes'); localStorage.setItem('inventory-tab', 'quotes') }} />}
        {tab === 'quotes'        && <PriceQuotesTab initialIngredientId={initialQuoteIngId} />}
        {tab === 'vendors'       && <VendorsTab onCountChange={setVendorCount} />}
      </div>
    </div>
  )
}

// ── Vendors Tab ───────────────────────────────────────────────────────────────

function VendorsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const api = useApi()

  const [vendors,       setVendors]       = useState<Vendor[]>([])
  const [countries,     setCountries]     = useState<Country[]>([])
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [filterCountry, setFilterCountry] = useState('')
  const [modal,         setModal]         = useState<Vendor | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Vendor | null>(null)
  const [toast,         setToast]         = useState<ToastState | null>(null)

  const blankForm = { name: '', country_id: '', contact: '', email: '', phone: '', notes: '' }
  const [form,   setForm]   = useState(blankForm)
  const [errors, setErrors] = useState<Partial<typeof blankForm>>({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, c] = await Promise.all([api.get('/vendors'), api.get('/countries')])
      setVendors(v || [])
      setCountries(c || [])
      onCountChange(v?.length || 0)
    } catch {
      showToast('Failed to load vendors', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const filtered = useMemo(() =>
    vendors.filter(v => {
      const matchSearch  = !search || v.name.toLowerCase().includes(search.toLowerCase())
      const matchCountry = !filterCountry || String(v.country_id) === filterCountry
      return matchSearch && matchCountry
    }), [vendors, search, filterCountry]
  )

  function openAdd() { setModal('new'); setForm(blankForm); setErrors({}) }

  function openEdit(v: Vendor) {
    setModal(v)
    setForm({
      name: v.name, country_id: String(v.country_id),
      contact: v.contact || '', email: v.email || '',
      phone: v.phone || '', notes: v.notes || '',
    })
    setErrors({})
  }

  function validate() {
    const e: Partial<typeof blankForm> = {}
    if (!form.name.trim()) e.name       = 'Required'
    if (!form.country_id)  e.country_id = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(), country_id: Number(form.country_id),
        contact: form.contact.trim() || null, email: form.email.trim() || null,
        phone: form.phone.trim() || null, notes: form.notes.trim() || null,
      }
      if (modal === 'new') { await api.post('/vendors', payload); showToast('Vendor added') }
      else if (modal != null) { await api.put(`/vendors/${(modal as Vendor).id}`, payload); showToast('Vendor updated') }
      setModal(null); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/vendors/${confirmDelete.id}`)
      showToast('Vendor deleted'); setConfirmDelete(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDelete(null) }
  }

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input type="search" placeholder="Search vendors…" value={search} onChange={e => setSearch(e.target.value)} className="input pl-9 w-full" />
        </div>
        <select className="select" value={filterCountry} onChange={e => setFilterCountry(e.target.value)}>
          <option value="">All Countries</option>
          {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAdd}>
          <PlusIcon size={14} /> Add Vendor
        </button>
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState
          message={search || filterCountry ? 'No vendors match your filters.' : 'No vendors yet. Add your first vendor to get started.'}
          action={!search && !filterCountry ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Vendor</button> : undefined}
        />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(v => <VendorCard key={v.id} vendor={v} onEdit={() => openEdit(v)} onDelete={() => setConfirmDelete(v)} />)}
        </div>
      )}

      {modal !== null && (
        <Modal title={modal === 'new' ? 'Add Vendor' : 'Edit Vendor'} onClose={() => setModal(null)}>
          <Field label="Vendor Name" required error={errors.name}>
            <input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Bangkok Fresh Co." autoFocus />
          </Field>
          <Field label="Country" required error={errors.country_id}>
            <select className="select w-full" value={form.country_id} onChange={e => setForm(f => ({ ...f, country_id: e.target.value }))}>
              <option value="">Select country…</option>
              {countries.map(c => <option key={c.id} value={c.id}>{c.name} ({c.currency_code})</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact Name">
              <input className="input w-full" value={form.contact} onChange={e => setForm(f => ({ ...f, contact: e.target.value }))} placeholder="e.g. John Smith" />
            </Field>
            <Field label="Phone">
              <input className="input w-full" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="e.g. +66 2 123 4567" />
            </Field>
          </div>
          <Field label="Email">
            <input className="input w-full" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="e.g. orders@vendor.com" />
          </Field>
          <Field label="Notes">
            <textarea className="input w-full" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes…" />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save Vendor'}</button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete vendor "${confirmDelete.name}"? This will fail if they have existing price quotes.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Vendor Card ───────────────────────────────────────────────────────────────

function VendorCard({ vendor, onEdit, onDelete }: { vendor: Vendor; onEdit: () => void; onDelete: () => void }) {
  const initials = vendor.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-accent-dim flex items-center justify-center text-accent font-bold text-sm shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-text-1 truncate">{vendor.name}</div>
          <div className="text-xs text-text-3 mt-0.5">{vendor.country_name} · {vendor.currency_code}</div>
        </div>
      </div>
      <div className="space-y-1.5 mb-4 text-sm">
        {vendor.contact && <div className="flex items-center gap-2 text-text-2"><PersonIcon size={13} className="text-text-3 shrink-0" /><span>{vendor.contact}</span></div>}
        {vendor.email   && <div className="flex items-center gap-2 text-text-2"><MailIcon   size={13} className="text-text-3 shrink-0" /><a href={`mailto:${vendor.email}`} className="hover:text-accent transition-colors truncate">{vendor.email}</a></div>}
        {vendor.phone   && <div className="flex items-center gap-2 text-text-2"><PhoneIcon  size={13} className="text-text-3 shrink-0" /><span>{vendor.phone}</span></div>}
        {vendor.notes   && <div className="text-xs text-text-3 italic mt-2 line-clamp-2">{vendor.notes}</div>}
        {!vendor.contact && !vendor.email && !vendor.phone && <p className="text-xs text-text-3 italic">No contact details added.</p>}
      </div>
      <div className="flex gap-2">
        <button className="btn-outline flex-1 py-1.5 text-sm flex items-center justify-center gap-1.5" onClick={onEdit}><EditIcon size={13} /> Edit</button>
        <button className="flex-1 py-1.5 text-sm flex items-center justify-center gap-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors font-semibold" onClick={onDelete}><TrashIcon size={13} /> Delete</button>
      </div>
    </div>
  )
}

// ── Quote Hover Popover ───────────────────────────────────────────────────────
// Shows a small floating panel with quote details when hovering the Quotes badge.
// Fetches data lazily on first hover and caches it. Uses fixed positioning so it
// never clips inside overflow-x-auto table containers.

function QuoteHoverPopover({ ing, onViewQuotes }: {
  ing: Ingredient
  onViewQuotes?: (id: number) => void
}) {
  const api                     = useApi()
  const [open,    setOpen]      = useState(false)
  const [quotes,  setQuotes]    = useState<Quote[] | null>(null)
  const [loading, setLoading]   = useState(false)
  const [pos,     setPos]       = useState({ top: 0, left: 0 })
  const hideTimer               = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = Number(ing.active_quote_count || 0)
  const total  = Number(ing.quote_count || 0)

  function scheduleClose() {
    hideTimer.current = setTimeout(() => setOpen(false), 120)
  }
  function cancelClose() {
    if (hideTimer.current) clearTimeout(hideTimer.current)
  }

  function handleBadgeEnter(e: React.MouseEvent<HTMLButtonElement>) {
    cancelClose()
    const rect = e.currentTarget.getBoundingClientRect()
    // Prefer opening below; if too close to bottom, open above
    const spaceBelow = window.innerHeight - rect.bottom
    const top = spaceBelow > 220 ? rect.bottom + 6 : rect.top - 6
    const left = Math.min(rect.left, window.innerWidth - 320)
    setPos({ top, left })
    setOpen(true)
    if (quotes === null && !loading) {
      setLoading(true)
      api.get(`/price-quotes?ingredient_id=${ing.id}`)
        .then((d: Quote[]) => setQuotes(d || []))
        .catch(() => setQuotes([]))
        .finally(() => setLoading(false))
    }
  }

  return (
    <div className="relative inline-block">
      <button
        onClick={() => onViewQuotes?.(ing.id)}
        onMouseEnter={handleBadgeEnter}
        onMouseLeave={scheduleClose}
        disabled={!onViewQuotes}
        className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors
          ${onViewQuotes ? 'cursor-pointer hover:opacity-70' : 'cursor-default'}
          ${active > 0 ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3'}`}>
        {ing.active_quote_count}/{ing.quote_count}
      </button>

      {open && total > 0 && (
        <div
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 99999 }}
          className="bg-white border border-border rounded-xl shadow-2xl p-3 w-72 pointer-events-auto"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
            <span className="text-[11px] font-semibold text-text-2 truncate">{ing.name}</span>
            <span className="text-[10px] text-text-3 ml-2 shrink-0">{active}/{total} active</span>
          </div>

          {loading ? (
            <div className="py-4 flex justify-center"><Spinner /></div>
          ) : !quotes || quotes.length === 0 ? (
            <p className="py-3 text-xs text-center text-text-3">No quotes found</p>
          ) : (
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {quotes.map(q => (
                <div key={q.id}
                  className={`flex items-start gap-2 px-2 py-1.5 rounded-lg text-xs
                    ${q.is_active ? 'bg-surface-2' : 'bg-surface-2 opacity-50'}
                    ${q.is_preferred ? 'ring-1 ring-accent/40' : ''}`}>
                  {/* Left: vendor + country */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="font-semibold text-text-1 truncate">{q.vendor_name}</span>
                      {q.is_preferred && (
                        <span className="text-[9px] bg-accent text-white px-1 py-px rounded-full shrink-0">★</span>
                      )}
                      {!q.is_active && (
                        <span className="text-[9px] bg-gray-200 text-gray-500 px-1 py-px rounded-full shrink-0">off</span>
                      )}
                    </div>
                    <div className="text-text-3 truncate">{q.country_name}</div>
                    {q.vendor_product_code && (
                      <div className="text-text-3 font-mono text-[10px] truncate">SKU: {q.vendor_product_code}</div>
                    )}
                  </div>
                  {/* Right: prices */}
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold text-text-1">
                      {q.currency_symbol}{Number(q.purchase_price).toFixed(2)}
                      {q.purchase_unit && (
                        <span className="text-text-3 font-normal text-[10px]"> /{q.purchase_unit}</span>
                      )}
                    </div>
                    {q.price_per_base_unit && (
                      <div className="font-mono text-[10px] text-text-3">
                        {q.currency_symbol}{Number(q.price_per_base_unit).toFixed(4)}/{q.base_unit_abbr}
                      </div>
                    )}
                    <div className="text-[10px] text-text-3">
                      {Number(q.qty_in_base_units).toFixed(3)} {q.base_unit_abbr}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer hint */}
          {quotes && quotes.length > 0 && (
            <div className="mt-2 pt-1.5 border-t border-border text-[10px] text-text-3 text-center">
              Click badge to open Quotes tab
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Ingredients Tab ───────────────────────────────────────────────────────────

function IngredientsTab({ onViewQuotes }: { onViewQuotes?: (id: number) => void }) {
  const api = useApi()

  const [ingredients,  setIngredients]  = useState<Ingredient[]>([])
  const [units,        setUnits]        = useState<Unit[]>([])
  const [dbCategories, setDbCategories] = useState<{id: number; name: string}[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [gridMode,     setGridMode]     = useState(false)
  const [modal,        setModal]        = useState<Ingredient | 'new' | null>(null)
  const [confirmDelete,setConfirmDelete]= useState<Ingredient | null>(null)
  const [toast,        setToast]        = useState<ToastState | null>(null)

  const blankForm = {
    name: '', category_id: '', base_unit_id: '', default_prep_unit: '',
    default_prep_to_base_conversion: '1', waste_pct: '0', notes: '', image_url: '',
  }
  const [form,   setForm]   = useState(blankForm)
  const [errors, setErrors] = useState<Partial<typeof blankForm>>({})
  const [saving, setSaving] = useState(false)

  const blankQuoteForm = {
    vendor_id: '', purchase_price: '', purchase_unit: '',
    qty_in_base_units: '1', is_active: 'true', vendor_product_code: '',
  }
  const [withQuote,   setWithQuote]   = useState(false)
  const [quoteForm,   setQuoteForm]   = useState(blankQuoteForm)
  const [quoteErrors, setQuoteErrors] = useState<Partial<typeof blankQuoteForm>>({})
  const [vendors,     setVendors]     = useState<Vendor[]>([])

  // Phase 4 — allergen & nutrition state
  type IngModalTab = 'details' | 'allergens' | 'nutrition'
  const [ingModalTab,    setIngModalTab]    = useState<IngModalTab>('details')
  const [allAllergens,   setAllAllergens]   = useState<Allergen[]>([])
  const [ingAllergens,   setIngAllergens]   = useState<IngAllergen[]>([])
  const [savingAllergens,setSavingAllergens]= useState(false)
  const blankNutForm: Record<string, string> = { energy_kcal: '', protein_g: '', carbs_g: '', fat_g: '', fibre_g: '', sugar_g: '', salt_g: '' }
  const [nutForm,      setNutForm]      = useState<Record<string, string>>(blankNutForm)
  const [nutSearch,    setNutSearch]    = useState('')
  const [nutResults,   setNutResults]   = useState<any[]>([])
  const [nutLoading,   setNutLoading]   = useState(false)
  const [savingNut,    setSavingNut]    = useState(false)
  const [dietaryFlags, setDietaryFlags] = useState<Record<string, boolean>>({})
  const [ingAllergenMap, setIngAllergenMap] = useState<Map<number, { code: string; status: string }[]>>(new Map())

  // ── Menu filter ──────────────────────────────────────────────────────────────
  const [menus,          setMenus]          = useState<MenuRef[]>([])
  const [filterMenuId,   setFilterMenuId]   = useState<number | null>(null)
  const [menuIngIds,     setMenuIngIds]     = useState<Set<number> | null>(null)
  const [menuFilterBusy, setMenuFilterBusy] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ings, us, cats, vends] = await Promise.all([
        api.get('/ingredients'),
        api.get('/units'),
        api.get('/categories?for_ingredients=true'),
        api.get('/vendors'),
      ])
      setIngredients(ings || [])
      setUnits(us || [])
      setDbCategories((cats || []).map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name)))
      setVendors(vends || [])
    } catch {
      showToast('Failed to load ingredients', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    api.get('/allergens').then((d: Allergen[]) => setAllAllergens(d || [])).catch(() => {})
  }, [api])

  useEffect(() => {
    api.get('/allergens/ingredients').then((rows: { ingredient_id: number; code: string; status: string }[]) => {
      const m = new Map<number, { code: string; status: string }[]>()
      for (const row of (rows || [])) {
        if (!m.has(row.ingredient_id)) m.set(row.ingredient_id, [])
        m.get(row.ingredient_id)!.push({ code: row.code, status: row.status })
      }
      setIngAllergenMap(m)
    }).catch(() => {})
  }, [api])

  // Load menus list for the filter dropdown
  useEffect(() => {
    api.get('/menus').then((d: any[]) =>
      setMenus((d || []).map((m: any) => ({ id: m.id, name: m.name, country_name: m.country_name || '' })))
    ).catch(() => {})
  }, [api])

  // Resolve ingredient IDs when menu filter changes
  useEffect(() => {
    if (!filterMenuId) { setMenuIngIds(null); return }
    setMenuFilterBusy(true)
    ;(async () => {
      try {
        const menuItems: any[] = (await api.get(`/menu-items?menu_id=${filterMenuId}`)) || []
        const ids = new Set<number>()
        for (const mi of menuItems)
          if (mi.item_type === 'ingredient' && mi.ingredient_id) ids.add(mi.ingredient_id)
        const recipeIds = [...new Set(
          menuItems.filter(mi => mi.item_type === 'recipe' && mi.recipe_id).map((mi: any) => mi.recipe_id)
        )]
        if (recipeIds.length > 0) {
          const recipes: any[] = await Promise.all(recipeIds.map((id: number) => api.get(`/recipes/${id}`)))
          for (const r of recipes)
            for (const item of (r?.items || []))
              if (item.item_type === 'ingredient' && item.ingredient_id) ids.add(item.ingredient_id)
        }
        setMenuIngIds(ids)
      } catch { setMenuIngIds(null) }
      finally  { setMenuFilterBusy(false) }
    })()
  }, [filterMenuId, api])

  // ── Derived ─────────────────────────────────────────────────────────────────

  const categories = dbCategories

  const searchFiltered = useMemo(() =>
    ingredients.filter(i => !search ||
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      (i.category_name || '').toLowerCase().includes(search.toLowerCase())
    )
  , [ingredients, search])

  const menuFiltered = useMemo(() =>
    menuIngIds ? searchFiltered.filter(i => menuIngIds.has(i.id)) : searchFiltered
  , [searchFiltered, menuIngIds])

  const { sorted, sortField, sortDir, getFilter, setSort, setFilter, hasActiveFilters } =
    useSortFilter<Ingredient>(menuFiltered, 'name', 'asc')

  // ── Keyboard prev/next while ingredient modal is open ───────────────────────
  useEffect(() => {
    if (modal === null || modal === 'new') return
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT'  ||
          (e.target as HTMLElement).tagName === 'TEXTAREA' ||
          (e.target as HTMLElement).tagName === 'SELECT') return
      const idx = sorted.findIndex(i => i.id === (modal as Ingredient).id)
      if (e.key === 'ArrowLeft'  && idx > 0)                  openEdit(sorted[idx - 1])
      if (e.key === 'ArrowRight' && idx < sorted.length - 1)  openEdit(sorted[idx + 1])
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [modal, sorted]) // eslint-disable-line

  // ── Ctrl+Enter → save when ingredient details modal is open ─────────────────
  useEffect(() => {
    if (modal === null) return
    if (modal !== 'new' && ingModalTab !== 'details') return
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!saving) handleSave()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, ingModalTab, saving, form, withQuote, quoteForm])

  // ── Column definitions for DataGrid ─────────────────────────────────────────

  const ingColumns = useMemo((): GridColumn<Ingredient>[] => {
    const unitOptions: GridOption[] = ['mass', 'volume', 'count'].flatMap(type =>
      units
        .filter(u => u.type === type)
        .map(u => ({ value: String(u.id), label: u.abbreviation || u.name, group: type.charAt(0).toUpperCase() + type.slice(1) }))
    )
    const catOptions: GridOption[] = categories.map(c => ({ value: String(c.id), label: c.name }))

    const unitFilterOptions: GridOption[] = unitOptions.map(u => ({ value: u.value, label: u.label }))

    return [
      {
        key: 'name', header: 'Ingredient', type: 'text', editable: true,
        minWidth: 160, placeholder: 'New ingredient…', sortable: true,
      },
      {
        key: 'category_id', header: 'Category', type: 'select', editable: true,
        options: catOptions, minWidth: 130,
        filterable: true, filterOptions: catOptions, sortable: false,
      },
      {
        key: 'base_unit_id', header: 'Base Unit', type: 'select', editable: true,
        options: unitOptions, minWidth: 100,
        filterable: true, filterOptions: unitFilterOptions, sortable: true,
      },
      {
        key: 'default_prep_unit', header: 'Prep Unit', type: 'text', editable: true,
        minWidth: 90, placeholder: 'e.g. g, cup…', mono: true, sortable: true,
      },
      {
        key: 'default_prep_to_base_conversion', header: 'Conv.', type: 'number', editable: true,
        minWidth: 80, min: 0.000001, step: 0.000001, mono: true, sortable: true,
      },
      {
        key: 'waste_pct', header: 'Waste %', type: 'number', editable: true,
        minWidth: 80, min: 0, max: 99, step: 0.5, mono: true, sortable: true,
      },
      {
        key: 'active_quote_count', header: 'Quotes', type: 'derived', editable: false,
        derive: row => {
          if (!row.quote_count) return '—'
          return `${row.active_quote_count ?? 0}/${row.quote_count ?? 0}`
        },
        align: 'right',
      },
    ]
  }, [units, dbCategories])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const convHint = () => {
    const unit = units.find(u => u.id === Number(form.base_unit_id))
    const prep = form.default_prep_unit || unit?.abbreviation || 'unit'
    const base = unit?.abbreviation || 'base unit'
    return `1 ${prep} = ${form.default_prep_to_base_conversion || '1'} ${base}`
  }

  function openAdd(wq = false) {
    setModal('new'); setForm(blankForm); setErrors({})
    setIngModalTab('details'); setIngAllergens([]); setNutForm(blankNutForm)
    setDietaryFlags({}); setNutSearch(''); setNutResults([])
    setWithQuote(wq); setQuoteForm(blankQuoteForm); setQuoteErrors({})
  }

  function openEdit(i: Ingredient) {
    setModal(i)
    setIngModalTab('details')
    setForm({
      name: i.name, category_id: i.category_id ? String(i.category_id) : '',
      base_unit_id: i.base_unit_id ? String(i.base_unit_id) : '',
      default_prep_unit: i.default_prep_unit || '',
      default_prep_to_base_conversion: i.default_prep_to_base_conversion || '1',
      waste_pct: i.waste_pct || '0', notes: i.notes || '',
      image_url: i.image_url || '',
    })
    setNutForm({
      energy_kcal: i.energy_kcal != null ? String(i.energy_kcal) : '',
      protein_g:   i.protein_g   != null ? String(i.protein_g)   : '',
      carbs_g:     i.carbs_g     != null ? String(i.carbs_g)     : '',
      fat_g:       i.fat_g       != null ? String(i.fat_g)       : '',
      fibre_g:     i.fibre_g     != null ? String(i.fibre_g)     : '',
      sugar_g:     i.sugar_g     != null ? String(i.sugar_g)     : '',
      salt_g:      i.salt_g      != null ? String(i.salt_g)      : '',
    })
    setDietaryFlags(i.dietary_flags || {})
    setNutSearch(''); setNutResults([])
    setErrors({})
    api.get(`/allergens/ingredient/${i.id}`)
      .then((d: IngAllergen[]) => setIngAllergens(d || []))
      .catch(() => setIngAllergens([]))
  }

  function validate() {
    const e: Partial<typeof blankForm> = {}
    if (!form.name.trim())  e.name         = 'Required'
    if (!form.base_unit_id) e.base_unit_id = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    if (withQuote && modal === 'new') {
      const qe: Partial<typeof blankQuoteForm> = {}
      if (!quoteForm.vendor_id)         qe.vendor_id         = 'Required'
      if (!quoteForm.purchase_price)    qe.purchase_price    = 'Required'
      if (!quoteForm.qty_in_base_units) qe.qty_in_base_units = 'Required'
      setQuoteErrors(qe)
      if (Object.keys(qe).length > 0) return
    }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(), category_id: Number(form.category_id) || null,
        base_unit_id: Number(form.base_unit_id),
        default_prep_unit: form.default_prep_unit.trim() || null,
        default_prep_to_base_conversion: Number(form.default_prep_to_base_conversion) || 1,
        waste_pct: Number(form.waste_pct) || 0,
        notes: form.notes.trim() || null,
        image_url: form.image_url.trim() || null,
      }
      if (modal === 'new') {
        const newIng = await api.post('/ingredients', payload)
        if (withQuote && newIng?.id) {
          await api.post('/price-quotes', {
            ingredient_id:     newIng.id,
            vendor_id:         Number(quoteForm.vendor_id),
            purchase_price:    Number(quoteForm.purchase_price),
            qty_in_base_units: Number(quoteForm.qty_in_base_units) || 1,
            purchase_unit:     quoteForm.purchase_unit.trim() || null,
            is_active:         quoteForm.is_active === 'true',
            vendor_product_code: quoteForm.vendor_product_code.trim() || null,
          })
          showToast('Ingredient and quote added')
        } else {
          showToast('Ingredient added')
        }
      } else if (modal != null) {
        await api.put(`/ingredients/${(modal as Ingredient).id}`, payload)
        showToast('Ingredient updated')
      }
      setModal(null); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/ingredients/${confirmDelete.id}`)
      showToast('Ingredient deleted'); setConfirmDelete(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDelete(null) }
  }

  function cycleAllergenStatus(code: string) {
    const order = ['contains', 'may_contain', 'free_from', null] as const
    const current = ingAllergens.find(a => a.code === code)?.status ?? null
    const nextIdx = (order.indexOf(current) + 1) % order.length
    const next = order[nextIdx]
    if (next === null) {
      setIngAllergens(prev => prev.filter(a => a.code !== code))
    } else {
      setIngAllergens(prev => {
        const existing = prev.find(a => a.code === code)
        if (existing) return prev.map(a => a.code === code ? { ...a, status: next } : a)
        const allergen = allAllergens.find(a => a.code === code)!
        return [...prev, { allergen_id: allergen.id, code, name: allergen.name, status: next }]
      })
    }
  }

  async function saveAllergens() {
    if (modal === 'new' || modal === null) return
    const ing = modal as Ingredient
    setSavingAllergens(true)
    try {
      await api.put(`/allergens/ingredient/${ing.id}`, {
        allergens: ingAllergens.map(a => ({ allergen_id: a.allergen_id, status: a.status })),
      })
      showToast('Allergens saved')
    } catch (err: any) { showToast(err.message || 'Failed to save allergens', 'error') }
    finally { setSavingAllergens(false) }
  }

  async function searchNutrition(q?: string) {
    const query = (q ?? nutSearch).trim()
    if (!query) return
    if (q !== undefined) setNutSearch(q)
    setNutLoading(true); setNutResults([])
    try {
      const data = await api.get(`/nutrition/search?q=${encodeURIComponent(query)}&source=both`)
      setNutResults([...(data?.usda || []), ...(data?.off || [])])
    } catch { showToast('Search failed', 'error') }
    finally { setNutLoading(false) }
  }

  function applyNutritionResult(result: any) {
    setNutForm({
      energy_kcal: result.energy_kcal != null ? String(Math.round(result.energy_kcal)) : '',
      protein_g:   result.protein_g   != null ? String(Number(result.protein_g).toFixed(2)) : '',
      carbs_g:     result.carbs_g     != null ? String(Number(result.carbs_g).toFixed(2)) : '',
      fat_g:       result.fat_g       != null ? String(Number(result.fat_g).toFixed(2)) : '',
      fibre_g:     result.fibre_g     != null ? String(Number(result.fibre_g).toFixed(2)) : '',
      sugar_g:     result.sugar_g     != null ? String(Number(result.sugar_g).toFixed(2)) : '',
      salt_g:      result.salt_g      != null ? String(Number(result.salt_g).toFixed(2)) : '',
    })
    setNutResults([]); setNutSearch('')
  }

  async function saveNutrition() {
    if (modal === 'new' || modal === null) return
    const ing = modal as Ingredient
    setSavingNut(true)
    try {
      // Two separate endpoints — nutrition values and dietary flags are stored differently
      await Promise.all([
        api.put(`/nutrition/ingredient/${ing.id}`, {
          energy_kcal: nutForm.energy_kcal !== '' ? Number(nutForm.energy_kcal) : null,
          protein_g:   nutForm.protein_g   !== '' ? Number(nutForm.protein_g)   : null,
          carbs_g:     nutForm.carbs_g     !== '' ? Number(nutForm.carbs_g)     : null,
          fat_g:       nutForm.fat_g       !== '' ? Number(nutForm.fat_g)       : null,
          fibre_g:     nutForm.fibre_g     !== '' ? Number(nutForm.fibre_g)     : null,
          sugar_g:     nutForm.sugar_g     !== '' ? Number(nutForm.sugar_g)     : null,
          salt_g:      nutForm.salt_g      !== '' ? Number(nutForm.salt_g)      : null,
        }),
        api.put(`/nutrition/ingredient/${ing.id}/dietary-flags`, dietaryFlags),
      ])
      showToast('Nutrition saved')
      load() // Refresh ingredient list so reopening the modal shows the saved values
    } catch (err: any) { showToast(err.message || 'Failed to save nutrition', 'error') }
    finally { setSavingNut(false) }
  }

  const categoryFilterOptions = categories.map(c => ({ label: c.name, value: c.name }))

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search" placeholder="Search ingredients or categories…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        {menus.length > 0 && (
          <div className="relative min-w-[160px]">
            <select
              className={`select w-full pr-7 ${filterMenuId ? 'border-accent text-accent font-semibold' : ''}`}
              value={filterMenuId ?? ''}
              onChange={e => setFilterMenuId(e.target.value ? Number(e.target.value) : null)}
              title="Filter ingredients by menu"
            >
              <option value="">All menus</option>
              {menus.map(m => (
                <option key={m.id} value={String(m.id)}>{m.name}{m.country_name ? ` (${m.country_name})` : ''}</option>
              ))}
            </select>
            {menuFilterBusy && (
              <span className="absolute right-7 top-1/2 -translate-y-1/2 w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin" style={{ borderTopColor: 'var(--accent)' }} />
            )}
          </div>
        )}
        <GridToggleButton active={gridMode} onToggle={() => setGridMode(g => !g)} />
        <button className="btn-outline px-4 py-2 text-sm flex items-center gap-2" onClick={() => openAdd(false)}>
          <PlusIcon size={14} /> Add Ingredient
        </button>
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={() => openAdd(true)}>
          <PlusIcon size={14} /> Add Ingredient & Quote
        </button>
      </div>

      {loading ? <Spinner /> : gridMode ? (
        <DataGrid<Ingredient>
          gridId="ingredients"
          columns={ingColumns}
          rows={searchFiltered}
          keyField="id"
          onSave={async (draft, isNew) => {
            const payload = {
              name:                            String(draft.name ?? '').trim(),
              category_id:                     Number(draft.category_id) || null,
              base_unit_id:                    Number(draft.base_unit_id) || null,
              default_prep_unit:               String(draft.default_prep_unit ?? '').trim() || null,
              default_prep_to_base_conversion: Number(draft.default_prep_to_base_conversion) || 1,
              waste_pct:                       Number(draft.waste_pct) || 0,
            }
            if (!payload.name) throw new Error('Name is required')
            return isNew
              ? api.post('/ingredients', payload)
              : api.put(`/ingredients/${(draft as any).id}`, payload)
          }}
          onSaved={(saved, isNew) => {
            if (isNew) setIngredients(prev => [...prev, saved])
            else       setIngredients(prev => prev.map(i =>
              // Merge so joined fields (quote_count, active_quote_count, base_unit_abbr etc.) are preserved
              i.id === saved.id ? { ...i, ...saved } : i
            ))
            showToast(isNew ? 'Ingredient added' : 'Ingredient saved')
          }}
          onEdit={openEdit}
          onDelete={ing => setConfirmDelete(ing)}
          showToast={showToast}
          hintRight="Tab from last cell saves row · Esc reverts"
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          message={search || hasActiveFilters || filterMenuId ? 'No ingredients match your filters.' : 'No ingredients yet. Add your first ingredient to get started.'}
          action={!search && !hasActiveFilters && !filterMenuId
            ? <button className="btn-primary px-4 py-2 text-sm" onClick={() => openAdd()}>Add Ingredient</button>
            : undefined
          }
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-300 rounded-t-xl">
                <ColumnHeader<Ingredient> label="Ingredient" field="name"                            sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Category"   field="category_name"                   sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={categoryFilterOptions} filterValues={getFilter('category_name')} onFilter={v => setFilter('category_name', v)} />
                <ColumnHeader<Ingredient> label="Base Unit"  field="base_unit_abbr"                  sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Prep Unit"  field="default_prep_unit"               sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Conv."      field="default_prep_to_base_conversion" sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Waste %"    field="waste_pct"                       sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <th className="px-4 py-3 text-left text-xs font-semibold text-text-3">Allergens</th>
                <ColumnHeader<Ingredient> label="Quotes"     field="active_quote_count"              sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(ing => (
                <tr key={ing.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{ing.name}</td>
                  <td className="px-4 py-3 text-text-3">{ing.category_name || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2">{ing.base_unit_abbr ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2">{ing.default_prep_unit || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2">
                    {Number(ing.default_prep_to_base_conversion) !== 1
                      ? Number(ing.default_prep_to_base_conversion).toFixed(4) : '1'}
                  </td>
                  <td className="px-4 py-3 font-mono text-text-2">
                    {Number(ing.waste_pct) > 0 ? `${ing.waste_pct}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-0.5">
                      {(ingAllergenMap.get(ing.id) || [])
                        .filter(a => a.status !== 'free_from')
                        .map(a => (
                          <span
                            key={a.code}
                            title={`${a.code}: ${a.status === 'contains' ? 'Contains' : 'May contain'}`}
                            className={`text-[10px] font-bold px-1 py-0.5 rounded leading-none
                              ${a.status === 'contains' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                            {a.code}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <QuoteHoverPopover ing={ing} onViewQuotes={onViewQuotes} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button className="btn-ghost px-2 py-1 text-xs flex items-center gap-1" onClick={() => openEdit(ing)}>
                        <EditIcon size={12} /> Edit
                      </button>
                      <button className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setConfirmDelete(ing)}>
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (() => {
        const modalIdx  = modal === 'new' ? -1 : sorted.findIndex(i => i.id === (modal as Ingredient).id)
        const prevIng   = modalIdx > 0                   ? sorted[modalIdx - 1] : null
        const nextIng   = modalIdx < sorted.length - 1   ? sorted[modalIdx + 1] : null
        return (
        <Modal
          title={modal === 'new' ? (withQuote ? 'Add Ingredient & Quote' : 'Add Ingredient') : `Edit: ${(modal as Ingredient).name}`}
          onClose={() => setModal(null)}
          width="max-w-2xl"
        >
          {/* Prev / Next navigation */}
          {modal !== 'new' && sorted.length > 1 && (
            <div className="flex items-center justify-between -mt-1 mb-3 pb-2 border-b border-border/50">
              <button
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${prevIng ? 'text-accent hover:bg-accent-dim' : 'text-text-3 opacity-30 cursor-default'}`}
                onClick={() => prevIng && openEdit(prevIng)}
                disabled={!prevIng}
                title={prevIng ? `Previous: ${prevIng.name}` : undefined}
              >
                ← {prevIng ? prevIng.name : 'Prev'}
              </button>
              <span className="text-xs text-text-3">{modalIdx + 1} / {sorted.length}</span>
              <button
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${nextIng ? 'text-accent hover:bg-accent-dim' : 'text-text-3 opacity-30 cursor-default'}`}
                onClick={() => nextIng && openEdit(nextIng)}
                disabled={!nextIng}
                title={nextIng ? `Next: ${nextIng.name}` : undefined}
              >
                {nextIng ? nextIng.name : 'Next'} →
              </button>
            </div>
          )}

          {/* Tabs — only for existing ingredients */}
          {modal !== 'new' && (
            <div className="flex gap-1 -mt-1 mb-4 border-b border-border">
              {(['details', 'allergens', 'nutrition'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setIngModalTab(t)}
                  className={`px-4 py-2 text-sm font-semibold rounded-t transition-colors
                    ${ingModalTab === t
                      ? 'text-accent border-b-2 border-accent'
                      : 'text-text-3 hover:text-text-1'
                    }`}
                >
                  {t === 'details' ? 'Details' : t === 'allergens' ? 'Allergens' : 'Nutrition'}
                </button>
              ))}
            </div>
          )}

          {/* ── Details tab ───────────────────────────────────────────────── */}
          {(modal === 'new' || ingModalTab === 'details') && (
            <>
              <Field label="Name" required error={errors.name}>
                <input className="input w-full" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Chicken Breast" autoFocus />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Category">
                  <select className="select w-full" value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}>
                    <option value="">No category…</option>
                    {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
                  </select>
                </Field>
                <Field label="Base Unit" required error={errors.base_unit_id}>
                  <select className="select w-full" value={form.base_unit_id} onChange={e => {
                    const selectedUnit = units.find(u => u.id === Number(e.target.value))
                    setForm(f => ({
                      ...f,
                      base_unit_id: e.target.value,
                      // Auto-populate recipe unit defaults if fields are currently blank
                      ...(selectedUnit?.default_recipe_unit && !f.default_prep_unit
                        ? { default_prep_unit: selectedUnit.default_recipe_unit }
                        : {}),
                      ...(selectedUnit?.default_recipe_unit_conversion && !f.default_prep_to_base_conversion
                        ? { default_prep_to_base_conversion: String(selectedUnit.default_recipe_unit_conversion) }
                        : {}),
                    }))
                  }}>
                    <option value="">Select unit…</option>
                    {['mass', 'volume', 'count'].map(type => (
                      <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                        {units.filter(u => u.type === type).map(u => (
                          <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <p className="text-xs text-text-3 mt-1">All price conversions use this unit.</p>
                </Field>
              </div>
              <div className="border-t border-border pt-4 mt-2">
                <p className="text-xs text-text-3 mb-3">Default prep settings — pre-filled when added to a recipe (overridable per recipe).</p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Default Prep Unit">
                    <input className="input w-full" value={form.default_prep_unit} onChange={e => setForm(f => ({ ...f, default_prep_unit: e.target.value }))} placeholder="e.g. g, slice, cup" />
                    <p className="text-xs text-text-3 mt-1">Auto-filled from base unit if blank.</p>
                  </Field>
                  <Field label="Conversion to Base Unit">
                    <input className="input w-full font-mono" type="number" min="0.000001" step="0.000001" value={form.default_prep_to_base_conversion} onChange={e => setForm(f => ({ ...f, default_prep_to_base_conversion: e.target.value }))} />
                    <p className="text-xs text-text-3 mt-1">{convHint()}</p>
                  </Field>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Waste %">
                  <input className="input w-full font-mono" type="number" min="0" max="99" step="0.5" value={form.waste_pct} onChange={e => setForm(f => ({ ...f, waste_pct: e.target.value }))} placeholder="0" />
                  <p className="text-xs text-text-3 mt-1">Added to cost calculations.</p>
                </Field>
                <Field label="Notes">
                  <input className="input w-full" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional…" />
                </Field>
              </div>
              <ImageUpload
                label="Image"
                value={form.image_url || null}
                onChange={url => setForm(f => ({ ...f, image_url: url || '' }))}
              />
              {modal === 'new' && !withQuote && (
                <p className="text-xs text-text-3 bg-surface-2 rounded-lg px-3 py-2 mt-2">
                  Save the ingredient first, then reopen to manage allergens and nutrition.
                </p>
              )}

              {/* ── Quote section (Add Ingredient & Quote mode) ─────────────── */}
              {modal === 'new' && withQuote && (
                <div className="border-t border-border pt-4 mt-4">
                  <p className="text-sm font-semibold text-text-1 mb-3">Price Quote</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vendor" required error={quoteErrors.vendor_id}>
                      <select className="select w-full" value={quoteForm.vendor_id} onChange={e => setQuoteForm(f => ({ ...f, vendor_id: e.target.value }))}>
                        <option value="">Select vendor…</option>
                        {vendors.map(v => (
                          <option key={v.id} value={v.id}>{v.name}{v.country_name ? ` (${v.country_name})` : ''}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Purchase Unit">
                      <input className="input w-full" value={quoteForm.purchase_unit} onChange={e => setQuoteForm(f => ({ ...f, purchase_unit: e.target.value }))} placeholder="e.g. 10 kg bag" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Purchase Price" required error={quoteErrors.purchase_price}>
                      <input className="input w-full font-mono" type="number" min="0" step="0.01" value={quoteForm.purchase_price} onChange={e => setQuoteForm(f => ({ ...f, purchase_price: e.target.value }))} placeholder="0.00" />
                    </Field>
                    <Field label={`Qty in ${units.find(u => u.id === Number(form.base_unit_id))?.abbreviation || 'base units'}`} required error={quoteErrors.qty_in_base_units}>
                      <input className="input w-full font-mono" type="number" min="0.000001" step="0.001" value={quoteForm.qty_in_base_units} onChange={e => setQuoteForm(f => ({ ...f, qty_in_base_units: e.target.value }))} />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Vendor Product Code">
                      <input className="input w-full" value={quoteForm.vendor_product_code} onChange={e => setQuoteForm(f => ({ ...f, vendor_product_code: e.target.value }))} placeholder="Optional…" />
                    </Field>
                    <Field label="Status">
                      <select className="select w-full" value={quoteForm.is_active} onChange={e => setQuoteForm(f => ({ ...f, is_active: e.target.value }))}>
                        <option value="true">Active</option>
                        <option value="false">Inactive</option>
                      </select>
                    </Field>
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end pt-2">
                <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
                <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : withQuote && modal === 'new'
                    ? <>Save Ingredient &amp; Quote <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Ctrl+↵</kbd></>
                    : <>Save Ingredient <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Ctrl+↵</kbd></>
                  }
                </button>
              </div>
            </>
          )}

          {/* ── Allergens tab ─────────────────────────────────────────────── */}
          {modal !== 'new' && ingModalTab === 'allergens' && (
            <AllergenTabContent
              allAllergens={allAllergens}
              ingAllergens={ingAllergens}
              onCycle={cycleAllergenStatus}
              onSave={saveAllergens}
              saving={savingAllergens}
              onClose={() => setModal(null)}
            />
          )}

          {/* ── Nutrition tab ─────────────────────────────────────────────── */}
          {modal !== 'new' && ingModalTab === 'nutrition' && (
            <NutritionTabContent
              nutForm={nutForm}
              setNutForm={setNutForm}
              nutSearch={nutSearch}
              nutResults={nutResults}
              nutLoading={nutLoading}
              onSearch={searchNutrition}
              onApply={applyNutritionResult}
              dietaryFlags={dietaryFlags}
              setDietaryFlags={setDietaryFlags}
              onSave={saveNutrition}
              saving={savingNut}
              onClose={() => setModal(null)}
              ingredientName={(modal as Ingredient)?.name ?? ''}
            />
          )}
        </Modal>
        )
      })()}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete "${confirmDelete.name}"? This will fail if it has existing price quotes or recipe usage.`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Price Quotes Tab ──────────────────────────────────────────────────────────

function PriceQuotesTab({ initialIngredientId }: { initialIngredientId?: number }) {
  const api = useApi()

  const [quotes,        setQuotes]       = useState<Quote[]>([])
  const [ingredients,   setIngredients]  = useState<Ingredient[]>([])
  const [vendors,       setVendors]      = useState<Vendor[]>([])
  const [countries,     setCountries]    = useState<Country[]>([])
  const [loading,          setLoading]         = useState(true)
  const [search,           setSearch]          = useState('')
  const [gridMode,         setGridMode]        = useState(false)
  const [modal,            setModal]           = useState<Quote | 'new' | null>(null)
  const [confirmDelete,    setConfirmDelete]   = useState<Quote | null>(null)
  const [toast,            setToast]           = useState<ToastState | null>(null)

  // ── Menu filter ──────────────────────────────────────────────────────────────
  const [menus,          setMenus]          = useState<MenuRef[]>([])
  const [filterMenuId,   setFilterMenuId]   = useState<number | null>(null)
  const [menuIngIds,     setMenuIngIds]     = useState<Set<number> | null>(null)
  const [menuFilterBusy, setMenuFilterBusy] = useState(false)

  // ── Missing quotes mode ──────────────────────────────────────────────────────
  const [showMissing,      setShowMissing]     = useState(false)
  const [missingCountryId, setMissingCountryId]= useState<string>('')
  const [missingForms,     setMissingForms]    = useState<Record<number, {
    vendor_id: string; purchase_unit: string; qty_in_base_units: string; purchase_price: string
  }>>({})
  const [missingSaving,    setMissingSaving]   = useState<Record<number, boolean>>({})

  const blankForm = {
    ingredient_id: '', vendor_id: '', purchase_unit: '', purchase_price: '',
    qty_in_base_units: '1', is_active: 'true', vendor_product_code: '',
  }
  const [form,   setForm]   = useState(blankForm)
  const [errors, setErrors] = useState<Partial<typeof blankForm>>({})
  const [saving, setSaving] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [q, ings, v, c] = await Promise.all([
        api.get('/price-quotes'), api.get('/ingredients'),
        api.get('/vendors'),      api.get('/countries'),
      ])
      setQuotes(q || []); setIngredients(ings || [])
      setVendors(v || []); setCountries(c || [])
    } catch {
      showToast('Failed to load price quotes', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // Load menus list for the filter dropdown
  useEffect(() => {
    api.get('/menus').then((d: any[]) =>
      setMenus((d || []).map((m: any) => ({ id: m.id, name: m.name, country_name: m.country_name || '' })))
    ).catch(() => {})
  }, [api])

  // Resolve ingredient IDs for selected menu
  useEffect(() => {
    if (!filterMenuId) { setMenuIngIds(null); return }
    setMenuFilterBusy(true)
    ;(async () => {
      try {
        const menuItems: any[] = (await api.get(`/menu-items?menu_id=${filterMenuId}`)) || []
        const ids = new Set<number>()
        for (const mi of menuItems)
          if (mi.item_type === 'ingredient' && mi.ingredient_id) ids.add(mi.ingredient_id)
        const recipeIds = [...new Set(
          menuItems.filter(mi => mi.item_type === 'recipe' && mi.recipe_id).map((mi: any) => mi.recipe_id)
        )]
        if (recipeIds.length > 0) {
          const recipes: any[] = await Promise.all(recipeIds.map((id: number) => api.get(`/recipes/${id}`)))
          for (const r of recipes)
            for (const item of (r?.items || []))
              if (item.item_type === 'ingredient' && item.ingredient_id) ids.add(item.ingredient_id)
        }
        setMenuIngIds(ids)
      } catch { setMenuIngIds(null) }
      finally  { setMenuFilterBusy(false) }
    })()
  }, [filterMenuId, api])

  // ── Derived ─────────────────────────────────────────────────────────────────

  const searchFiltered = useMemo(() =>
    quotes.filter(q => !search ||
      q.ingredient_name.toLowerCase().includes(search.toLowerCase()) ||
      q.vendor_name.toLowerCase().includes(search.toLowerCase())
    ), [quotes, search]
  )

  const menuFiltered = useMemo(() =>
    menuIngIds ? searchFiltered.filter(q => menuIngIds.has(q.ingredient_id)) : searchFiltered
  , [searchFiltered, menuIngIds])

  const initialQuoteFilters = useMemo(
    (): Record<string, string[]> => initialIngredientId ? { ingredient_id: [String(initialIngredientId)] } : {},
    [] // eslint-disable-line react-hooks/exhaustive-deps — intentionally only on mount
  )
  const { sorted, sortField, sortDir, getFilter, setSort, setFilter, hasActiveFilters } =
    useSortFilter<Quote>(menuFiltered, 'ingredient_name', 'asc', initialQuoteFilters)

  const selectedVendor = useMemo(() =>
    vendors.find(v => String(v.id) === form.vendor_id) || null
  , [vendors, form.vendor_id])

  const selectedIngredient = useMemo(() =>
    ingredients.find(i => String(i.id) === form.ingredient_id) || null
  , [ingredients, form.ingredient_id])

  const pricePerBaseUnit = useMemo(() => {
    const price = parseFloat(form.purchase_price)
    const qty   = parseFloat(form.qty_in_base_units)
    if (!price || !qty || qty === 0) return null
    return (price / qty).toFixed(6)
  }, [form.purchase_price, form.qty_in_base_units])

  // ── Missing quotes derived ───────────────────────────────────────────────────

  const vendorsForMissingCountry = useMemo(() =>
    missingCountryId ? vendors.filter(v => String(v.country_id) === missingCountryId) : vendors
  , [vendors, missingCountryId])

  const missingIngredients = useMemo(() => {
    if (!missingCountryId) return []
    const coveredIds = new Set(
      quotes
        .filter(q => q.is_active && String(q.country_id) === missingCountryId)
        .map(q => q.ingredient_id)
    )
    return ingredients.filter(i => !coveredIds.has(i.id))
  }, [quotes, ingredients, missingCountryId])

  function getMissingForm(ingId: number) {
    return missingForms[ingId] ?? { vendor_id: '', purchase_unit: '', qty_in_base_units: '1', purchase_price: '' }
  }

  function setMissingField(ingId: number, field: string, value: string) {
    setMissingForms(prev => ({
      ...prev,
      [ingId]: { ...getMissingForm(ingId), [field]: value },
    }))
  }

  async function saveMissingQuote(ing: Ingredient) {
    const f = getMissingForm(ing.id)
    if (!f.vendor_id || !f.purchase_price || Number(f.qty_in_base_units) <= 0) {
      showToast('Vendor and price are required', 'error'); return
    }
    setMissingSaving(prev => ({ ...prev, [ing.id]: true }))
    try {
      await api.post('/price-quotes', {
        ingredient_id:     ing.id,
        vendor_id:         Number(f.vendor_id),
        purchase_unit:     f.purchase_unit.trim() || null,
        purchase_price:    Number(f.purchase_price),
        qty_in_base_units: Number(f.qty_in_base_units) || 1,
        is_active:         true,
      })
      setMissingForms(prev => { const n = { ...prev }; delete n[ing.id]; return n })
      showToast(`Quote added for ${ing.name}`)
      load()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setMissingSaving(prev => ({ ...prev, [ing.id]: false }))
    }
  }

  // ── Column definitions for DataGrid ─────────────────────────────────────────

  const quoteColumns = useMemo((): GridColumn<Quote>[] => {
    const ingOptions: GridOption[] = ingredients.map(i => ({
      value: String(i.id),
      label: i.name,
      sub:   i.base_unit_abbr ?? undefined,
    }))
    const venOptions: GridOption[] = vendors.map(v => ({
      value: String(v.id),
      label: v.name,
      sub:   `${v.country_name} · ${v.currency_code}`,
    }))

    const statusOptions: GridOption[] = [
      { value: 'true',  label: 'Active'   },
      { value: 'false', label: 'Inactive' },
    ]

    return [
      {
        key: 'ingredient_id', header: 'Ingredient', type: 'combo', editable: true,
        options: ingOptions, minWidth: 160, placeholder: 'Search ingredient…',
        filterable: true, filterOptions: ingOptions, sortable: true,
      },
      {
        key: 'vendor_id', header: 'Vendor', type: 'combo', editable: true,
        options: venOptions, minWidth: 170, placeholder: 'Search vendor…',
        filterable: true, filterOptions: vendors.map(v => ({ value: String(v.id), label: v.name })), sortable: true,
      },
      {
        key: 'purchase_unit', header: 'Purchase Unit', type: 'text', editable: true,
        minWidth: 130, placeholder: 'e.g. Case 12×1kg', sortable: true,
      },
      {
        key: 'qty_in_base_units', header: 'Base Qty', type: 'number', editable: true,
        minWidth: 85, min: 0.000001, step: 0.000001, mono: true, sortable: true,
      },
      {
        key: 'purchase_price', header: 'Price', type: 'number', editable: true,
        minWidth: 90, min: 0, step: 0.01, mono: true, sortable: true,
        placeholder: (row) => {
          const v = vendors.find(v => String(v.id) === String((row as any).vendor_id))
          return v ? `0.00 ${v.currency_code}` : '0.00'
        },
      },
      {
        key: 'price_per_base_unit', header: 'Per Base Unit', type: 'derived', editable: false,
        derive: (row) => {
          const price = parseFloat(String((row as any).purchase_price))
          const qty   = parseFloat(String((row as any).qty_in_base_units))
          if (!price || !qty || qty === 0) return '—'
          const ing = ingredients.find(i => String(i.id) === String((row as any).ingredient_id))
          const ven = vendors.find(v => String(v.id) === String((row as any).vendor_id))
          const ppbu = (price / qty).toFixed(4)
          return `${ven?.currency_symbol ?? ''}${ppbu}${ing?.base_unit_abbr ? ` /${ing.base_unit_abbr}` : ''}`
        },
        align: 'right', mono: true,
      },
      {
        key: 'is_active', header: 'Status', type: 'select', editable: true,
        minWidth: 90, options: statusOptions,
        filterable: true, filterOptions: statusOptions, sortable: true,
      },
      {
        key: 'is_preferred', header: 'Preferred', type: 'derived', editable: false,
        derive: (row) => (row as any).is_preferred ? '★ Preferred' : '',
      },
    ]
  }, [ingredients, vendors])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  function openAdd() { setModal('new'); setForm(blankForm); setErrors({}) }

  function openEdit(q: Quote) {
    setModal(q)
    setForm({
      ingredient_id: String(q.ingredient_id), vendor_id: String(q.vendor_id),
      purchase_unit: q.purchase_unit || '', purchase_price: q.purchase_price,
      qty_in_base_units: q.qty_in_base_units, is_active: String(q.is_active),
      vendor_product_code: q.vendor_product_code || '',
    })
    setErrors({})
  }

  function validate() {
    const e: Partial<typeof blankForm> = {}
    if (!form.ingredient_id)                           e.ingredient_id     = 'Required'
    if (!form.vendor_id)                               e.vendor_id         = 'Required'
    if (!form.purchase_price)                          e.purchase_price    = 'Required'
    if (!form.qty_in_base_units ||
        Number(form.qty_in_base_units) <= 0)           e.qty_in_base_units = 'Must be > 0'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave(andNext = false) {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        ingredient_id: Number(form.ingredient_id), vendor_id: Number(form.vendor_id),
        purchase_unit: form.purchase_unit.trim() || null, purchase_price: Number(form.purchase_price),
        qty_in_base_units: Number(form.qty_in_base_units), is_active: form.is_active === 'true',
        vendor_product_code: form.vendor_product_code.trim() || null,
      }
      if (modal === 'new') { await api.post('/price-quotes', payload); showToast('Quote added') }
      else if (modal != null) { await api.put(`/price-quotes/${(modal as Quote).id}`, payload); showToast('Quote updated') }
      load()
      if (andNext) {
        // Keep modal open, reset form but retain vendor_id for rapid entry
        setForm({ ...blankForm, vendor_id: form.vendor_id })
        setErrors({})
        setModal('new')
      } else {
        setModal(null)
      }
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

  async function handleSaveAndNext() { handleSave(true) }

  // Alt+S → Save & Next · Ctrl+Enter → Save when quote modal is open
  useEffect(() => {
    if (modal === null) return
    function onKey(e: KeyboardEvent) {
      if (modal === 'new' && e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (!saving) handleSave(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (!saving) handleSave()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, saving, form])

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/price-quotes/${confirmDelete.id}`)
      showToast('Quote deleted'); setConfirmDelete(null); load()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error'); setConfirmDelete(null) }
  }

  async function togglePreferred(q: Quote) {
    try {
      if (q.is_preferred) {
        await api.delete(`/preferred-vendors/by-ingredient/${q.ingredient_id}/country/${q.country_id}`)
        showToast('Preferred vendor cleared')
      } else {
        await api.post('/preferred-vendors', {
          ingredient_id: q.ingredient_id, country_id: q.country_id,
          vendor_id: q.vendor_id, quote_id: q.id,
        })
        showToast('Set as preferred vendor')
      }
      load()
    } catch (err: any) { showToast(err.message || 'Failed to update preferred vendor', 'error') }
  }

  const vendorFilterOptions      = vendors.map(v => ({ label: v.name, value: String(v.id) }))
  const countryFilterOptions     = countries.map(c => ({ label: c.name, value: String(c.id) }))
  const statusFilterOptions      = [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }]
  const preferredFilterOptions   = [{ label: '★ Preferred', value: 'true' }, { label: 'Not preferred', value: 'false' }]
  const ingredientFilterOptions  = [...new Map(
    quotes.map(q => [q.ingredient_id, { label: q.ingredient_name, value: String(q.ingredient_id) }])
  ).values()].sort((a, b) => (a.label ?? '').localeCompare(b.label ?? ''))
  const categoryFilterOptions    = [...new Set(
    quotes.map(q => q.ingredient_category).filter(Boolean) as string[]
  )].sort().map(c => ({ label: c, value: c }))

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap items-center">
        {!showMissing && (
          <div className="relative flex-1 min-w-[200px]">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
            <input
              type="search" placeholder="Search ingredient or vendor…"
              value={search} onChange={e => setSearch(e.target.value)}
              className="input pl-9 w-full"
            />
          </div>
        )}
        {!showMissing && menus.length > 0 && (
          <div className="relative min-w-[160px]">
            <select
              className={`select w-full ${filterMenuId ? 'border-accent text-accent font-semibold' : ''}`}
              value={filterMenuId ?? ''}
              onChange={e => setFilterMenuId(e.target.value ? Number(e.target.value) : null)}
              title="Filter quotes by menu"
            >
              <option value="">All menus</option>
              {menus.map(m => (
                <option key={m.id} value={String(m.id)}>{m.name}{m.country_name ? ` (${m.country_name})` : ''}</option>
              ))}
            </select>
            {menuFilterBusy && (
              <span className="absolute right-7 top-1/2 -translate-y-1/2 w-3 h-3 border border-accent/40 border-t-accent rounded-full animate-spin" style={{ borderTopColor: 'var(--accent)' }} />
            )}
          </div>
        )}
        {showMissing && (
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <label className="text-sm font-medium text-text-2 whitespace-nowrap">Market:</label>
            <select
              className="select flex-1"
              value={missingCountryId}
              onChange={e => setMissingCountryId(e.target.value)}
            >
              <option value="">Select a market…</option>
              {countries.sort((a, b) => a.name.localeCompare(b.name)).map(c => (
                <option key={c.id} value={String(c.id)}>
                  {c.name} ({c.currency_code})
                </option>
              ))}
            </select>
            {missingCountryId && (
              <span className="text-xs text-text-3 whitespace-nowrap">
                {missingIngredients.length} unpriced
              </span>
            )}
          </div>
        )}
        <button
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors whitespace-nowrap
            ${showMissing
              ? 'bg-amber-50 border-amber-300 text-amber-700 font-semibold'
              : 'bg-surface border-border text-text-3 hover:text-text-1 hover:border-accent'
            }`}
          onClick={() => { setShowMissing(m => !m); setSearch('') }}
          title="Show ingredients with no active price quote for a selected market"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
          </svg>
          Missing Quotes
        </button>
        {!showMissing && <GridToggleButton active={gridMode} onToggle={() => setGridMode(g => !g)} />}
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAdd}>
          <PlusIcon size={14} /> Add Quote
        </button>
      </div>

      {loading ? <Spinner /> : showMissing ? (
        /* ── Missing quotes view ──────────────────────────────────────────────── */
        !missingCountryId ? (
          <EmptyState message="Select a market above to see which ingredients are missing a price quote for that country." />
        ) : missingIngredients.length === 0 ? (
          <EmptyState message={`All ingredients have at least one active price quote for ${countries.find(c => String(c.id) === missingCountryId)?.name ?? 'this market'}. 🎉`} />
        ) : (
          <div className="bg-surface border border-border rounded-xl overflow-visible">
            <div className="px-4 py-2.5 border-b border-border bg-amber-50/60 rounded-t-xl flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <p className="text-xs text-amber-700 font-medium">
                Fill in vendor, unit, qty and price for each ingredient then click <strong>Save</strong> to create the quote.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-200 border-b border-gray-300">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide">Ingredient</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide">Category</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide">Base Unit</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide">Vendor</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide">Purchase Unit</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide w-36">Conv. to Base</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-text-2 uppercase tracking-wide w-28">Price</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-text-2 uppercase tracking-wide">Per Base Unit</th>
                    <th className="w-20" />
                  </tr>
                </thead>
                <tbody>
                  {missingIngredients.map((ing, idx) => {
                    const f    = getMissingForm(ing.id)
                    const ven  = vendorsForMissingCountry.find(v => String(v.id) === f.vendor_id)
                    const ppbu = f.purchase_price && f.qty_in_base_units && Number(f.qty_in_base_units) > 0
                      ? (Number(f.purchase_price) / Number(f.qty_in_base_units)).toFixed(4)
                      : null
                    const isSaving = !!missingSaving[ing.id]
                    const canSave  = !!f.vendor_id && !!f.purchase_price && Number(f.qty_in_base_units) > 0
                    return (
                      <tr key={ing.id} className={`border-b border-border last:border-0 ${idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40'}`}>
                        <td className="px-4 py-2.5 font-semibold text-text-1">{ing.name}</td>
                        <td className="px-4 py-2.5 text-text-3 text-xs">{ing.category_name || '—'}</td>
                        <td className="px-4 py-2.5 font-mono text-text-3 text-xs">{ing.base_unit_abbr || '—'}</td>
                        <td className="px-4 py-2">
                          <select
                            className="select w-full min-w-[140px] text-sm py-1.5"
                            value={f.vendor_id}
                            onChange={e => setMissingField(ing.id, 'vendor_id', e.target.value)}
                          >
                            <option value="">Select vendor…</option>
                            {vendorsForMissingCountry.map(v => (
                              <option key={v.id} value={String(v.id)}>{v.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            className="input w-full min-w-[120px] text-sm py-1.5"
                            placeholder="e.g. Case 12×1kg"
                            value={f.purchase_unit}
                            onChange={e => setMissingField(ing.id, 'purchase_unit', e.target.value)}
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <input
                              className="input font-mono text-sm py-1.5 w-20"
                              type="number" min="0.000001" step="0.000001"
                              value={f.qty_in_base_units}
                              onChange={e => setMissingField(ing.id, 'qty_in_base_units', e.target.value)}
                            />
                            {ing.base_unit_abbr && (
                              <span className="text-xs text-text-3 font-mono whitespace-nowrap">{ing.base_unit_abbr}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2">
                          <input
                            className="input w-full font-mono text-sm py-1.5"
                            type="number" min="0" step="0.01" placeholder="0.00"
                            value={f.purchase_price}
                            onChange={e => setMissingField(ing.id, 'purchase_price', e.target.value)}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono">
                          {ppbu
                            ? <><span className="font-bold text-accent">{ven?.currency_symbol ?? ''}{ppbu}</span>{ing.base_unit_abbr && <span className="text-xs text-text-3 ml-0.5">/{ing.base_unit_abbr}</span>}</>
                            : <span className="text-text-3">—</span>
                          }
                        </td>
                        <td className="px-4 py-2">
                          <button
                            className="btn-primary px-3 py-1.5 text-xs disabled:opacity-40"
                            disabled={!canSave || isSaving}
                            onClick={() => saveMissingQuote(ing)}
                          >
                            {isSaving ? '…' : 'Save'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : gridMode ? (
        <DataGrid<Quote>
          gridId="quotes"
          columns={quoteColumns}
          rows={searchFiltered}
          keyField="id"
          onSave={async (draft, isNew) => {
            if (!draft.ingredient_id || !draft.vendor_id || !draft.purchase_price)
              throw new Error('Ingredient, vendor and price are required')
            const payload = {
              ingredient_id:     Number(draft.ingredient_id),
              vendor_id:         Number(draft.vendor_id),
              purchase_unit:     String(draft.purchase_unit ?? '').trim() || null,
              purchase_price:    Number(draft.purchase_price),
              qty_in_base_units: Number(draft.qty_in_base_units) || 1,
              is_active:         String(draft.is_active) === 'true',
            }
            return isNew
              ? api.post('/price-quotes', payload)
              : api.put(`/price-quotes/${(draft as any).id}`, payload)
          }}
          onSaved={(saved, isNew) => {
            if (isNew) setQuotes(prev => [...prev, saved])
            else       setQuotes(prev => prev.map(q => q.id === saved.id ? { ...q, ...saved } : q))
            showToast(isNew ? 'Quote added' : 'Quote saved')
          }}
          onEdit={openEdit}
          onDelete={q => setConfirmDelete(q)}
          renderActions={q => (
            <button
              onClick={() => togglePreferred(q)}
              title={q.is_preferred ? 'Clear preferred' : 'Set as preferred for this country'}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors
                ${q.is_preferred
                  ? 'bg-yellow-100 text-yellow-500 hover:bg-yellow-200'
                  : 'bg-surface-2 text-text-3 hover:bg-surface border border-border'
                }`}
            >
              <StarIcon size={13} filled={q.is_preferred} />
            </button>
          )}
          showToast={showToast}
          hintRight="Price / Base Unit recalculates live"
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          message={search || hasActiveFilters ? 'No quotes match your filters.' : 'No price quotes yet. Add your first quote to get started.'}
          action={!search && !hasActiveFilters
            ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Quote</button>
            : undefined
          }
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-200 border-b border-gray-300 rounded-t-xl">
                <ColumnHeader<Quote> label="Ingredient"    field="ingredient_name"     sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={ingredientFilterOptions} filterValues={getFilter('ingredient_id')} onFilter={v => setFilter('ingredient_id', v)} />
                <ColumnHeader<Quote> label="Category"      field="ingredient_category" sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={categoryFilterOptions}   filterValues={getFilter('ingredient_category')} onFilter={v => setFilter('ingredient_category', v)} />
                <ColumnHeader<Quote> label="Vendor"        field="vendor_name"         sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={vendorFilterOptions}  filterValues={getFilter('vendor_id')} onFilter={v => setFilter('vendor_id',  v)} />
                <ColumnHeader<Quote> label="Country"       field="country_name"        sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={countryFilterOptions} filterValues={getFilter('country_id')} onFilter={v => setFilter('country_id', v)} />
                <ColumnHeader<Quote> label="Purchase Unit" field="purchase_unit"       sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Quote> label="Price"         field="purchase_price"      sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                <ColumnHeader<Quote> label="Per Base Unit" field="price_per_base_unit" sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                <ColumnHeader<Quote> label="Status"        field="is_active"           sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={statusFilterOptions}    filterValues={getFilter('is_active')} onFilter={v => setFilter('is_active', v)} />
                <ColumnHeader<Quote> label="Preferred"     field="is_preferred"        sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={preferredFilterOptions}  filterValues={getFilter('is_preferred')} onFilter={v => setFilter('is_preferred', v)} />
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(q => (
                <tr key={q.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{q.ingredient_name}</td>
                  <td className="px-4 py-3 text-text-3">{q.ingredient_category || '—'}</td>
                  <td className="px-4 py-3 text-text-2">{q.vendor_name}</td>
                  <td className="px-4 py-3 text-text-2">{q.country_name}</td>
                  <td className="px-4 py-3 font-mono text-text-2">{q.purchase_unit || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2 text-right">{q.currency_symbol}{Number(q.purchase_price).toFixed(2)}</td>
                  <td className="px-4 py-3 font-mono text-right">
                    <span className="font-bold text-accent">
                      {q.price_per_base_unit ? `${q.currency_symbol}${Number(q.price_per_base_unit).toFixed(4)}` : '—'}
                    </span>
                    {q.base_unit_abbr && <span className="text-xs text-text-3 ml-1">/{q.base_unit_abbr}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${q.is_active ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3'}`}>
                      {q.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => togglePreferred(q)}
                      title={q.is_preferred ? 'Clear preferred' : 'Set as preferred for this country'}
                      className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors
                        ${q.is_preferred ? 'bg-yellow-100 text-yellow-500 hover:bg-yellow-200' : 'bg-surface-2 text-text-3 hover:bg-surface border border-border'}`}
                    >
                      <StarIcon size={13} filled={q.is_preferred} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button className="btn-ghost px-2 py-1 text-xs flex items-center gap-1" onClick={() => openEdit(q)}>
                        <EditIcon size={12} /> Edit
                      </button>
                      <button className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors" onClick={() => setConfirmDelete(q)}>
                        <TrashIcon size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <Modal title={modal === 'new' ? 'Add Price Quote' : 'Edit Price Quote'} onClose={() => setModal(null)}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Ingredient" required error={errors.ingredient_id}>
              <SearchCombo
                value={form.ingredient_id}
                onChange={v => setForm(f => ({ ...f, ingredient_id: v }))}
                options={ingredients.map(i => ({ id: String(i.id), label: `${i.name}${i.base_unit_abbr ? ` (${i.base_unit_abbr})` : ''}` }))}
                placeholder="Search ingredients…"
              />
            </Field>
            <Field label="Vendor" required error={errors.vendor_id}>
              <SearchCombo
                value={form.vendor_id}
                onChange={v => setForm(f => ({ ...f, vendor_id: v }))}
                options={vendors.map(v => ({ id: String(v.id), label: `${v.name} (${v.currency_code})` }))}
                placeholder="Search vendors…"
              />
              {selectedVendor && (
                <p className="text-xs text-text-3 mt-1">Country: {selectedVendor.country_name} · Currency: {selectedVendor.currency_symbol} {selectedVendor.currency_code}</p>
              )}
            </Field>
          </div>
          <div className="border-t border-border pt-4 mt-2">
            <p className="text-xs text-text-3 mb-3">How you purchase this ingredient:</p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Purchase Unit Label">
                <input className="input w-full" value={form.purchase_unit} onChange={e => setForm(f => ({ ...f, purchase_unit: e.target.value }))} placeholder="e.g. Case 12×1kg, 5L drum" />
                <p className="text-xs text-text-3 mt-1">Free-text label for your reference.</p>
              </Field>
              <Field label={`Purchase Price${selectedVendor ? ` (${selectedVendor.currency_symbol} ${selectedVendor.currency_code})` : ''}`} required error={errors.purchase_price}>
                <input className="input w-full font-mono" type="number" min="0" step="0.01" placeholder="0.00" value={form.purchase_price} onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} />
              </Field>
            </div>
            <Field label={`Base Unit Qty${selectedIngredient?.base_unit_abbr ? ` (${selectedIngredient.base_unit_abbr})` : ''}`} required error={errors.qty_in_base_units}>
              <input className="input w-full font-mono" type="number" min="0.000001" step="0.000001" value={form.qty_in_base_units} onChange={e => setForm(f => ({ ...f, qty_in_base_units: e.target.value }))} />
              <p className="text-xs text-text-3 mt-1">Total base units in this purchase. e.g. a case of 12×1kg bags = 12.</p>
            </Field>
          </div>
          {pricePerBaseUnit && selectedVendor && selectedIngredient && (
            <div className="bg-accent-dim border border-accent/20 rounded-lg px-4 py-3 text-sm">
              <span className="font-semibold text-accent">Price per base unit: </span>
              <span className="font-mono font-bold text-accent ml-1">{selectedVendor.currency_symbol}{pricePerBaseUnit}</span>
              {selectedIngredient.base_unit_abbr && <span className="text-text-3 ml-1">/ {selectedIngredient.base_unit_abbr}</span>}
              <span className="text-text-3 ml-3 text-xs">({selectedVendor.currency_symbol}{Number(form.purchase_price).toFixed(2)} ÷ {form.qty_in_base_units})</span>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Field label="Status">
              <select className="select w-full" value={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.value }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </Field>
            <Field label="Product Code">
              <input className="input w-full font-mono" value={form.vendor_product_code} onChange={e => setForm(f => ({ ...f, vendor_product_code: e.target.value }))} placeholder="Optional vendor SKU…" />
            </Field>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            {modal === 'new' && (
              <button className="btn-outline px-4 py-2 text-sm" onClick={handleSaveAndNext} disabled={saving}
                title="Save this quote and open a new one (Alt+S)">
                {saving ? 'Saving…' : <>Save &amp; Next <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Alt+S</kbd></>}
              </button>
            )}
            <button className="btn-primary px-4 py-2 text-sm" onClick={() => handleSave()} disabled={saving}>
              {saving ? 'Saving…' : <>Save Quote <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Ctrl+↵</kbd></>}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={`Delete this price quote for "${confirmDelete.ingredient_name}" from "${confirmDelete.vendor_name}"?`}
          onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Search Combo (used in quote modal) ────────────────────────────────────────

function SearchCombo({ value, onChange, options, placeholder = 'Search…' }: {
  value: string; onChange: (v: string) => void
  options: { id: string; label: string }[]; placeholder?: string
}) {
  const [open,           setOpen]           = useState(false)
  const [search,         setSearch]         = useState('')
  const [display,        setDisplay]        = useState(options.find(o => o.id === value)?.label || '')
  const [highlightedIdx, setHighlightedIdx] = useState(-1)
  const ref      = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    setDisplay(options.find(o => o.id === value)?.label || '')
  }, [value, options])

  const filtered = useMemo(() =>
    options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
  , [options, search])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setDisplay(options.find(o => o.id === value)?.label || '')
        setSearch('')
        setHighlightedIdx(-1)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [value, options])

  useEffect(() => {
    if (highlightedIdx >= 0) itemRefs.current[highlightedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIdx])

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = filtered.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open && total > 0) { setOpen(true); setHighlightedIdx(0); return }
      setHighlightedIdx(i => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!open || highlightedIdx < 0 || highlightedIdx >= total) return
      e.preventDefault()
      const sel = filtered[highlightedIdx]
      onChange(sel.id); setDisplay(sel.label); setSearch(''); setOpen(false); setHighlightedIdx(-1)
    } else if (e.key === 'Escape') {
      setOpen(false); setSearch(''); setHighlightedIdx(-1)
      setDisplay(options.find(o => o.id === value)?.label || '')
    }
  }

  return (
    <div ref={ref} className="relative">
      <input
        className="input w-full"
        value={open ? search : display}
        onChange={e => { setSearch(e.target.value); setOpen(true); setHighlightedIdx(-1) }}
        onFocus={() => { setOpen(true); setSearch('') }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.length === 0
            ? <div className="px-3 py-2 text-sm text-text-3">No results</div>
            : filtered.map((o, idx) => (
              <button key={o.id} ref={el => { itemRefs.current[idx] = el }} type="button"
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${highlightedIdx === idx ? 'bg-accent-dim text-accent font-semibold' : o.id === value ? 'text-accent font-semibold hover:bg-surface-2' : 'text-text-1 hover:bg-surface-2'}`}
                onMouseDown={e => { e.preventDefault(); onChange(o.id); setDisplay(o.label); setSearch(''); setOpen(false); setHighlightedIdx(-1) }}>
                {o.label}
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── Stat Pill (inline subtitle stat) ─────────────────────────────────────────

function StatPill({ value, label }: { value: number; label: string }) {
  return (
    <span>
      <span className="font-semibold text-text-1">{value}</span>
      {' '}{label}
    </span>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
}
function EditIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function TrashIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
}
function SearchIcon({ className = '' }: { className?: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
}
function PersonIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
}
function MailIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
}
function PhoneIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .91h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
}
function StarIcon({ size = 16, filled = false }: { size?: number; filled?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
}

// ── AllergenTabContent ─────────────────────────────────────────────────────────

const ALLERGEN_STATUS_STYLES: Record<string, string> = {
  contains:    'bg-red-100 text-red-700 border-red-300',
  may_contain: 'bg-amber-100 text-amber-700 border-amber-300',
  free_from:   'bg-green-100 text-green-700 border-green-300',
  none:        'bg-surface-2 text-text-3 border-border hover:border-text-3',
}
const ALLERGEN_STATUS_LABEL: Record<string, string> = {
  contains:    'Contains',
  may_contain: 'May contain',
  free_from:   'Free from',
}

function AllergenTabContent({ allAllergens, ingAllergens, onCycle, onSave, saving, onClose }: {
  allAllergens: Allergen[]
  ingAllergens: IngAllergen[]
  onCycle: (code: string) => void
  onSave:  () => void
  saving:  boolean
  onClose: () => void
}) {
  return (
    <>
      <p className="text-xs text-text-3 mb-4">
        Click an allergen chip to cycle: <span className="font-semibold text-red-600">Contains</span> →{' '}
        <span className="font-semibold text-amber-600">May contain</span> →{' '}
        <span className="font-semibold text-green-600">Free from</span> → Not set.{' '}
        Per EU FIC Regulation 1169/2011.
      </p>
      <div className="grid grid-cols-2 gap-2 mb-5">
        {allAllergens.map(allergen => {
          const current = ingAllergens.find(a => a.code === allergen.code)?.status
          const style = ALLERGEN_STATUS_STYLES[current || 'none']
          return (
            <button
              key={allergen.code}
              type="button"
              onClick={() => onCycle(allergen.code)}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors cursor-pointer ${style}`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-bold text-xs uppercase tracking-wide">{allergen.code}</div>
                <div className="text-xs truncate opacity-80">{allergen.name}</div>
              </div>
              {current && (
                <span className="text-xs font-semibold shrink-0">{ALLERGEN_STATUS_LABEL[current]}</span>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex gap-3 justify-end pt-2 border-t border-border">
        <button className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>Close</button>
        <button className="btn-primary px-4 py-2 text-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Allergens'}
        </button>
      </div>
    </>
  )
}

// ── NutritionTabContent ────────────────────────────────────────────────────────

const DIETARY_FLAG_LABELS: Record<string, string> = {
  vegan:       'Vegan',
  vegetarian:  'Vegetarian',
  halal:       'Halal',
  kosher:      'Kosher',
  gluten_free: 'Gluten Free',
  dairy_free:  'Dairy Free',
}

function NutritionTabContent({ nutForm, setNutForm, nutSearch, nutResults, nutLoading, onSearch, onApply, dietaryFlags, setDietaryFlags, onSave, saving, onClose, ingredientName = '' }: {
  nutForm:          Record<string, string>
  setNutForm:       (f: Record<string, string>) => void
  nutSearch:        string
  nutResults:       any[]
  nutLoading:       boolean
  onSearch:         (q?: string) => void
  onApply:          (r: any) => void
  dietaryFlags:     Record<string, boolean>
  setDietaryFlags:  (f: Record<string, boolean>) => void
  onSave:           () => void
  saving:           boolean
  onClose:          () => void
  ingredientName?:  string
}) {
  const [showSearchModal, setShowSearchModal] = useState(false)
  const [modalQuery,      setModalQuery]      = useState('')
  const [sourceFilter,    setSourceFilter]    = useState<'all' | 'usda' | 'off'>('all')
  const modalInputRef = useRef<HTMLInputElement>(null)

  function openSearch() {
    setModalQuery(nutSearch || ingredientName)
    setSourceFilter('all')
    setShowSearchModal(true)
    // trigger a search immediately if we have a query
    const q = nutSearch || ingredientName
    if (q.trim()) {
      onSearch(q.trim())
    }
    setTimeout(() => modalInputRef.current?.focus(), 80)
  }

  function handleModalSearch() {
    if (!modalQuery.trim()) return
    onSearch(modalQuery.trim())
  }

  function handleApply(r: any) {
    onApply(r)
    setShowSearchModal(false)
  }

  const filteredResults = nutResults.filter(r =>
    sourceFilter === 'all' || r.source === sourceFilter
  )

  const nutFields = [
    { key: 'energy_kcal', label: 'Energy',       unit: 'kcal' },
    { key: 'protein_g',   label: 'Protein',       unit: 'g' },
    { key: 'carbs_g',     label: 'Carbohydrates', unit: 'g' },
    { key: 'fat_g',       label: 'Fat',           unit: 'g' },
    { key: 'fibre_g',     label: 'Fibre',         unit: 'g' },
    { key: 'sugar_g',     label: 'Sugars',        unit: 'g' },
    { key: 'salt_g',      label: 'Salt',          unit: 'g' },
  ]

  return (
    <>
      {/* ── Search button row ───────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-text-3">Values per 100g. Click Search to auto-populate from USDA / Open Food Facts.</p>
        <button
          type="button"
          className="btn-outline px-3 py-1.5 text-sm shrink-0 ml-3"
          onClick={openSearch}
        >
          Search database…
        </button>
      </div>

      {/* ── Nutrition fields — per 100g ─────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        {nutFields.map(f => (
          <Field key={f.key} label={`${f.label} (${f.unit} / 100g)`}>
            <input
              className="input w-full font-mono"
              type="number"
              min="0"
              step="0.01"
              placeholder="—"
              value={nutForm[f.key] ?? ''}
              onChange={e => setNutForm({ ...nutForm, [f.key]: e.target.value })}
            />
          </Field>
        ))}
      </div>

      {/* ── Dietary flags ───────────────────────────────────────────── */}
      <div className="border-t border-border pt-3 mb-4">
        <p className="text-xs text-text-3 mb-2">Dietary flags:</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(DIETARY_FLAG_LABELS).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setDietaryFlags({ ...dietaryFlags, [key]: !dietaryFlags[key] })}
              className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                ${dietaryFlags[key]
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 text-text-3 border-border hover:border-accent hover:text-accent'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 justify-end pt-2 border-t border-border">
        <button className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>Close</button>
        <button className="btn-primary px-4 py-2 text-sm" onClick={onSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save Nutrition'}
        </button>
      </div>

      {/* ── Search modal ─────────────────────────────────────────────── */}
      {showSearchModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onMouseDown={e => { if (e.target === e.currentTarget) setShowSearchModal(false) }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl flex flex-col"
               style={{ maxHeight: '80vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h3 className="text-base font-semibold text-text-1">Search Nutrition Database</h3>
                <p className="text-xs text-text-3 mt-0.5">USDA FoodData Central + Open Food Facts — values per 100g</p>
              </div>
              <button
                type="button"
                className="text-text-3 hover:text-text-1 text-xl leading-none ml-4"
                onClick={() => setShowSearchModal(false)}
              >✕</button>
            </div>

            {/* Search input */}
            <div className="px-5 pt-4 pb-3 border-b border-border">
              <div className="flex gap-2">
                <input
                  ref={modalInputRef}
                  className="input flex-1"
                  placeholder="e.g. chicken breast raw"
                  value={modalQuery}
                  onChange={e => setModalQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleModalSearch()}
                />
                <button
                  type="button"
                  className="btn-primary px-4 py-2 text-sm shrink-0"
                  onClick={handleModalSearch}
                  disabled={nutLoading}
                >
                  {nutLoading ? 'Searching…' : 'Search'}
                </button>
              </div>

              {/* Source filter pills */}
              {nutResults.length > 0 && (
                <div className="flex gap-2 mt-3">
                  {(['all', 'usda', 'off'] as const).map(s => {
                    const count = s === 'all' ? nutResults.length
                      : nutResults.filter(r => r.source === s).length
                    const labels: Record<string, string> = { all: 'All', usda: 'USDA', off: 'Open Food Facts' }
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSourceFilter(s)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors
                          ${sourceFilter === s
                            ? 'bg-accent text-white border-accent'
                            : 'bg-surface-2 text-text-3 border-border hover:border-accent hover:text-accent'
                          }`}
                      >
                        {labels[s]} ({count})
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Results list */}
            <div className="flex-1 overflow-y-auto">
              {nutLoading && (
                <div className="flex items-center justify-center py-12 text-text-3 text-sm gap-2">
                  <span className="animate-spin text-accent">⟳</span> Searching…
                </div>
              )}
              {!nutLoading && nutResults.length === 0 && (
                <div className="text-center py-12 text-text-3 text-sm">
                  {modalQuery.trim()
                    ? 'No results found. Try a different search term.'
                    : 'Enter a search term above to find nutrition data.'
                  }
                </div>
              )}
              {!nutLoading && filteredResults.length === 0 && nutResults.length > 0 && (
                <div className="text-center py-12 text-text-3 text-sm">
                  No {sourceFilter === 'usda' ? 'USDA' : 'Open Food Facts'} results. Try "All" filter.
                </div>
              )}
              {!nutLoading && filteredResults.map((r, i) => (
                <button
                  key={i}
                  type="button"
                  className="w-full text-left px-5 py-3 hover:bg-accent-dim transition-colors border-b border-border last:border-0 flex items-start gap-3"
                  onClick={() => handleApply(r)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-text-1 text-sm leading-snug">{r.name}</div>
                    {r.brand && (
                      <div className="text-xs text-text-3 mt-0.5">{r.brand}</div>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                      {r.energy_kcal != null && (
                        <span className="text-xs text-text-2 font-mono">{Math.round(r.energy_kcal)} kcal</span>
                      )}
                      {r.protein_g != null && (
                        <span className="text-xs text-text-3 font-mono">P {Number(r.protein_g).toFixed(1)}g</span>
                      )}
                      {r.carbs_g != null && (
                        <span className="text-xs text-text-3 font-mono">C {Number(r.carbs_g).toFixed(1)}g</span>
                      )}
                      {r.fat_g != null && (
                        <span className="text-xs text-text-3 font-mono">F {Number(r.fat_g).toFixed(1)}g</span>
                      )}
                      {r.fibre_g != null && (
                        <span className="text-xs text-text-3 font-mono">Fb {Number(r.fibre_g).toFixed(1)}g</span>
                      )}
                      {r.salt_g != null && (
                        <span className="text-xs text-text-3 font-mono">Salt {Number(r.salt_g).toFixed(2)}g</span>
                      )}
                    </div>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full mt-0.5
                    ${r.source === 'usda'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-orange-100 text-orange-700'
                    }`}>
                    {r.source === 'usda' ? 'USDA' : 'OFF'}
                  </span>
                </button>
              ))}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-border flex items-center justify-between">
              <span className="text-xs text-text-3">
                {!nutLoading && nutResults.length > 0
                  ? `${filteredResults.length} result${filteredResults.length !== 1 ? 's' : ''}${sourceFilter !== 'all' ? ' (filtered)' : ''}`
                  : ''}
              </span>
              <button
                type="button"
                className="btn-ghost px-4 py-2 text-sm"
                onClick={() => setShowSearchModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
