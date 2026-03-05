import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'
import { useSortFilter } from '../hooks/useSortFilter'
import type { SortDir } from '../hooks/useSortFilter'
import { ColumnHeader } from '../components/ColumnHeader'
import { DataGrid, GridToggleButton } from '../components/DataGrid'
import type { GridColumn, GridOption } from '../components/DataGrid'

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
  category:                        string | null
  base_unit_id:                    number | null
  base_unit_name:                  string | null
  base_unit_abbr:                  string | null
  default_prep_unit:               string | null
  default_prep_to_base_conversion: string
  notes:                           string | null
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
  id:           number
  name:         string
  abbreviation: string
  type:         string
}

type Tab        = 'ingredients' | 'quotes' | 'vendors' | 'allergen-grid'
type ToastState = { message: string; type: 'success' | 'error' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const api = useApi()
  const [tab, setTab] = useState<Tab>('vendors')

  const [ingredientCount, setIngredientCount] = useState<number>(0)
  const [quoteCount,      setQuoteCount]      = useState<number>(0)
  const [vendorCount,     setVendorCount]     = useState<number>(0)
  const [countryCount,    setCountryCount]    = useState<number>(0)

  useEffect(() => {
    api.get('/ingredients').then((d: any[]) => setIngredientCount(d?.length || 0)).catch(() => {})
    api.get('/price-quotes').then((d: any[]) => setQuoteCount(d?.filter((q: any) => q.is_active).length || 0)).catch(() => {})
    api.get('/vendors').then((d: any[]) => {
      setVendorCount(d?.length || 0)
      setCountryCount(new Set(d?.map((v: any) => v.country_id)).size || 0)
    }).catch(() => {})
  }, [api])

  const TAB_LABELS: Record<Tab, string> = {
    'ingredients':  'Ingredients',
    'quotes':       'Price Quotes',
    'vendors':      'Vendors',
    'allergen-grid': 'Allergen Grid',
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Inventory"
        subtitle="Manage ingredients, vendor price quotes, and preferred suppliers per country."
      />

      <div className="flex gap-4 px-6 py-4 border-b border-border bg-surface">
        <KpiCard label="Ingredients"       value={ingredientCount} />
        <KpiCard label="Active Quotes"     value={quoteCount} />
        <KpiCard label="Vendors"           value={vendorCount} />
        <KpiCard label="Countries Covered" value={countryCount} />
      </div>

      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['ingredients', 'quotes', 'vendors', 'allergen-grid'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors
              ${tab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'ingredients'   && <IngredientsTab />}
        {tab === 'quotes'        && <PriceQuotesTab />}
        {tab === 'vendors'       && <VendorsTab onCountChange={setVendorCount} />}
        {tab === 'allergen-grid' && <AllergenGridTab />}
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

// ── Ingredients Tab ───────────────────────────────────────────────────────────

function IngredientsTab() {
  const api = useApi()

  const [ingredients,  setIngredients]  = useState<Ingredient[]>([])
  const [units,        setUnits]        = useState<Unit[]>([])
  const [dbCategories, setDbCategories] = useState<string[]>([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [gridMode,     setGridMode]     = useState(false)
  const [modal,        setModal]        = useState<Ingredient | 'new' | null>(null)
  const [confirmDelete,setConfirmDelete]= useState<Ingredient | null>(null)
  const [toast,        setToast]        = useState<ToastState | null>(null)

  const blankForm = {
    name: '', category: '', base_unit_id: '', default_prep_unit: '',
    default_prep_to_base_conversion: '1', waste_pct: '0', notes: '',
  }
  const [form,   setForm]   = useState(blankForm)
  const [errors, setErrors] = useState<Partial<typeof blankForm>>({})
  const [saving, setSaving] = useState(false)

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

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ings, us, cats] = await Promise.all([
        api.get('/ingredients'),
        api.get('/units'),
        api.get('/categories?type=ingredient'),
      ])
      setIngredients(ings || [])
      setUnits(us || [])
      setDbCategories((cats || []).map((c: any) => c.name).sort())
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

  // ── Derived ─────────────────────────────────────────────────────────────────

  const categories = useMemo(() =>
    [...new Set([
      ...dbCategories,
      ...ingredients.map(i => i.category).filter(Boolean) as string[],
    ])].sort()
  , [dbCategories, ingredients])

  const searchFiltered = useMemo(() =>
    ingredients.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))
  , [ingredients, search])

  const { sorted, sortField, sortDir, getFilter, setSort, setFilter, hasActiveFilters } =
    useSortFilter<Ingredient>(searchFiltered, 'name', 'asc')

  // ── Column definitions for DataGrid ─────────────────────────────────────────

  const ingColumns = useMemo((): GridColumn<Ingredient>[] => {
    const unitOptions: GridOption[] = ['mass', 'volume', 'count'].flatMap(type =>
      units
        .filter(u => u.type === type)
        .map(u => ({ value: String(u.id), label: u.abbreviation || u.name, group: type.charAt(0).toUpperCase() + type.slice(1) }))
    )
    const catOptions: GridOption[] = categories.map(c => ({ value: c, label: c }))

    const unitFilterOptions: GridOption[] = unitOptions.map(u => ({ value: u.value, label: u.label }))

    return [
      {
        key: 'name', header: 'Ingredient', type: 'text', editable: true,
        minWidth: 160, placeholder: 'New ingredient…', sortable: true,
      },
      {
        key: 'category', header: 'Category', type: 'combo', editable: true,
        options: catOptions, minWidth: 130, placeholder: 'Select or add…',
        filterable: true, filterOptions: catOptions, sortable: true,
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
  }, [units, categories])

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const convHint = () => {
    const unit = units.find(u => u.id === Number(form.base_unit_id))
    const prep = form.default_prep_unit || unit?.abbreviation || 'unit'
    const base = unit?.abbreviation || 'base unit'
    return `1 ${prep} = ${form.default_prep_to_base_conversion || '1'} ${base}`
  }

  function openAdd() {
    setModal('new'); setForm(blankForm); setErrors({})
    setIngModalTab('details'); setIngAllergens([]); setNutForm(blankNutForm)
    setDietaryFlags({}); setNutSearch(''); setNutResults([])
  }

  function openEdit(i: Ingredient) {
    setModal(i)
    setIngModalTab('details')
    setForm({
      name: i.name, category: i.category || '',
      base_unit_id: i.base_unit_id ? String(i.base_unit_id) : '',
      default_prep_unit: i.default_prep_unit || '',
      default_prep_to_base_conversion: i.default_prep_to_base_conversion || '1',
      waste_pct: i.waste_pct || '0', notes: i.notes || '',
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
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(), category: form.category.trim() || null,
        base_unit_id: Number(form.base_unit_id),
        default_prep_unit: form.default_prep_unit.trim() || null,
        default_prep_to_base_conversion: Number(form.default_prep_to_base_conversion) || 1,
        waste_pct: Number(form.waste_pct) || 0,
        notes: form.notes.trim() || null,
      }
      if (modal === 'new') { await api.post('/ingredients', payload); showToast('Ingredient added') }
      else if (modal != null) { await api.put(`/ingredients/${(modal as Ingredient).id}`, payload); showToast('Ingredient updated') }
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

  async function searchNutrition() {
    if (!nutSearch.trim()) return
    setNutLoading(true); setNutResults([])
    try {
      const data = await api.get(`/nutrition/search?q=${encodeURIComponent(nutSearch.trim())}&source=usda`)
      setNutResults(data?.results || [])
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
      await api.put(`/nutrition/ingredient/${ing.id}`, {
        energy_kcal: nutForm.energy_kcal !== '' ? Number(nutForm.energy_kcal) : null,
        protein_g:   nutForm.protein_g   !== '' ? Number(nutForm.protein_g)   : null,
        carbs_g:     nutForm.carbs_g     !== '' ? Number(nutForm.carbs_g)     : null,
        fat_g:       nutForm.fat_g       !== '' ? Number(nutForm.fat_g)       : null,
        fibre_g:     nutForm.fibre_g     !== '' ? Number(nutForm.fibre_g)     : null,
        sugar_g:     nutForm.sugar_g     !== '' ? Number(nutForm.sugar_g)     : null,
        salt_g:      nutForm.salt_g      !== '' ? Number(nutForm.salt_g)      : null,
        dietary_flags: dietaryFlags,
      })
      showToast('Nutrition saved')
    } catch (err: any) { showToast(err.message || 'Failed to save nutrition', 'error') }
    finally { setSavingNut(false) }
  }

  const categoryFilterOptions = categories.map(c => ({ label: c, value: c }))

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search" placeholder="Search ingredients…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <GridToggleButton active={gridMode} onToggle={() => setGridMode(g => !g)} />
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAdd}>
          <PlusIcon size={14} /> Add Ingredient
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
              category:                        String(draft.category ?? '').trim() || null,
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
          message={search || hasActiveFilters ? 'No ingredients match your filters.' : 'No ingredients yet. Add your first ingredient to get started.'}
          action={!search && !hasActiveFilters
            ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Ingredient</button>
            : undefined
          }
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border rounded-t-xl">
                <ColumnHeader<Ingredient> label="Ingredient" field="name"                            sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Category"   field="category"                        sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={categoryFilterOptions} filterValues={getFilter('category')} onFilter={v => setFilter('category', v)} />
                <ColumnHeader<Ingredient> label="Base Unit"  field="base_unit_abbr"                  sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Prep Unit"  field="default_prep_unit"               sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Conv."      field="default_prep_to_base_conversion" sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Waste %"    field="waste_pct"                       sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Ingredient> label="Quotes"     field="active_quote_count"              sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(ing => (
                <tr key={ing.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{ing.name}</td>
                  <td className="px-4 py-3 text-text-3">{ing.category || '—'}</td>
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
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                      ${Number(ing.active_quote_count) > 0 ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3'}`}>
                      {ing.active_quote_count}/{ing.quote_count}
                    </span>
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

      {modal !== null && (
        <Modal
          title={modal === 'new' ? 'Add Ingredient' : `Edit: ${(modal as Ingredient).name}`}
          onClose={() => setModal(null)}
          width="max-w-2xl"
        >
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
                  <CategoryCombo value={form.category} onChange={v => setForm(f => ({ ...f, category: v }))} options={categories} />
                </Field>
                <Field label="Base Unit" required error={errors.base_unit_id}>
                  <select className="select w-full" value={form.base_unit_id} onChange={e => setForm(f => ({ ...f, base_unit_id: e.target.value }))}>
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
              {modal === 'new' && (
                <p className="text-xs text-text-3 bg-surface-2 rounded-lg px-3 py-2 mt-2">
                  Save the ingredient first, then reopen to manage allergens and nutrition.
                </p>
              )}
              <div className="flex gap-3 justify-end pt-2">
                <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
                <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
                  {saving ? 'Saving…' : 'Save Ingredient'}
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
              setNutSearch={setNutSearch}
              nutResults={nutResults}
              nutLoading={nutLoading}
              onSearch={searchNutrition}
              onApply={applyNutritionResult}
              dietaryFlags={dietaryFlags}
              setDietaryFlags={setDietaryFlags}
              onSave={saveNutrition}
              saving={savingNut}
              onClose={() => setModal(null)}
            />
          )}
        </Modal>
      )}

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

function PriceQuotesTab() {
  const api = useApi()

  const [quotes,        setQuotes]       = useState<Quote[]>([])
  const [ingredients,   setIngredients]  = useState<Ingredient[]>([])
  const [vendors,       setVendors]      = useState<Vendor[]>([])
  const [countries,     setCountries]    = useState<Country[]>([])
  const [loading,       setLoading]      = useState(true)
  const [search,        setSearch]       = useState('')
  const [gridMode,      setGridMode]     = useState(false)
  const [modal,         setModal]        = useState<Quote | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete]= useState<Quote | null>(null)
  const [toast,         setToast]        = useState<ToastState | null>(null)

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

  // ── Derived ─────────────────────────────────────────────────────────────────

  const searchFiltered = useMemo(() =>
    quotes.filter(q => !search ||
      q.ingredient_name.toLowerCase().includes(search.toLowerCase()) ||
      q.vendor_name.toLowerCase().includes(search.toLowerCase())
    ), [quotes, search]
  )

  const { sorted, sortField, sortDir, getFilter, setSort, setFilter, hasActiveFilters } =
    useSortFilter<Quote>(searchFiltered, 'ingredient_name', 'asc')

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

  async function handleSave() {
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
      setModal(null); load()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setSaving(false) }
  }

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

  const vendorFilterOptions  = vendors.map(v => ({ label: v.name, value: String(v.id) }))
  const countryFilterOptions = countries.map(c => ({ label: c.name, value: String(c.id) }))
  const statusFilterOptions  = [{ label: 'Active', value: 'true' }, { label: 'Inactive', value: 'false' }]

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search" placeholder="Search ingredient or vendor…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <GridToggleButton active={gridMode} onToggle={() => setGridMode(g => !g)} />
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAdd}>
          <PlusIcon size={14} /> Add Quote
        </button>
      </div>

      {loading ? <Spinner /> : gridMode ? (
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
            else       setQuotes(prev => prev.map(q => q.id === saved.id ? saved : q))
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
              <tr className="bg-surface-2 border-b border-border rounded-t-xl">
                <ColumnHeader<Quote> label="Ingredient"    field="ingredient_name"     sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Quote> label="Vendor"        field="vendor_name"         sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={vendorFilterOptions}  filterValues={getFilter('vendor_id')} onFilter={v => setFilter('vendor_id',  v)} />
                <ColumnHeader<Quote> label="Country"       field="country_name"        sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={countryFilterOptions} filterValues={getFilter('country_id')} onFilter={v => setFilter('country_id', v)} />
                <ColumnHeader<Quote> label="Purchase Unit" field="purchase_unit"       sortField={sortField} sortDir={sortDir} onSort={setSort} />
                <ColumnHeader<Quote> label="Price"         field="purchase_price"      sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                <ColumnHeader<Quote> label="Per Base Unit" field="price_per_base_unit" sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                <ColumnHeader<Quote> label="Status"        field="is_active"           sortField={sortField} sortDir={sortDir} onSort={setSort} filterOptions={statusFilterOptions} filterValues={getFilter('is_active')} onFilter={v => setFilter('is_active', v)} />
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-text-2">Preferred</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(q => (
                <tr key={q.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-semibold text-text-1">{q.ingredient_name}</div>
                    {q.ingredient_category && <div className="text-xs text-text-3">{q.ingredient_category}</div>}
                  </td>
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
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Quote'}
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

// ── Allergen Grid Tab ─────────────────────────────────────────────────────────

type AlgStatus    = 'contains' | 'may_contain' | 'free_from'
type AlgSaveState = 'idle' | 'saving' | 'saved' | 'error'

interface IngAllergenRowBase {
  ingredient_id: number
  name:          string
  category:      string | null
  _saveState:    AlgSaveState
}
type IngAllergenRow = IngAllergenRowBase & Record<string, any>

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

function AllergenGridTab() {
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
                    <div className="flex items-end justify-center pb-1 text-[10px] font-bold uppercase text-text-2 tracking-wide"
                      style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', height: 68 }}>
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
                      <td key={a.code} className="border-r border-border last:border-r-0 p-0.5 text-center">
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

// ── Category Combo (used in ingredient modal) ─────────────────────────────────


function CategoryCombo({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: string[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
  const showAdd  = value.trim() !== '' && !options.some(o => o.toLowerCase() === value.toLowerCase().trim())

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        className="input w-full"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Select or type to add new…"
        autoComplete="off"
      />
      {open && (filtered.length > 0 || showAdd) && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden">
          {filtered.map(o => (
            <button key={o} type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors text-text-1"
              onMouseDown={e => { e.preventDefault(); onChange(o); setOpen(false) }}>{o}</button>
          ))}
          {showAdd && (
            <button type="button" className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors text-accent font-semibold border-t border-border"
              onMouseDown={e => { e.preventDefault(); onChange(value.trim()); setOpen(false) }}>
              + Add "{value.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Search Combo (used in quote modal) ────────────────────────────────────────

function SearchCombo({ value, onChange, options, placeholder = 'Search…' }: {
  value: string; onChange: (v: string) => void
  options: { id: string; label: string }[]; placeholder?: string
}) {
  const [open,    setOpen]    = useState(false)
  const [search,  setSearch]  = useState('')
  const [display, setDisplay] = useState(options.find(o => o.id === value)?.label || '')
  const ref = useRef<HTMLDivElement>(null)

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
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [value, options])

  return (
    <div ref={ref} className="relative">
      <input
        className="input w-full"
        value={open ? search : display}
        onChange={e => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => { setOpen(true); setSearch('') }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden max-h-56 overflow-y-auto">
          {filtered.length === 0
            ? <div className="px-3 py-2 text-sm text-text-3">No results</div>
            : filtered.map(o => (
              <button key={o.id} type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors ${o.id === value ? 'text-accent font-semibold' : 'text-text-1'}`}
                onMouseDown={e => { e.preventDefault(); onChange(o.id); setDisplay(o.label); setSearch(''); setOpen(false) }}>
                {o.label}
              </button>
            ))
          }
        </div>
      )}
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-2 rounded-lg px-5 py-3 min-w-[120px]">
      <div className="text-xs text-text-3 font-medium mb-1">{label}</div>
      <div className="text-xl font-extrabold text-text-1">{value}</div>
    </div>
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

function NutritionTabContent({ nutForm, setNutForm, nutSearch, setNutSearch, nutResults, nutLoading, onSearch, onApply, dietaryFlags, setDietaryFlags, onSave, saving, onClose }: {
  nutForm:         Record<string, string>
  setNutForm:      (f: Record<string, string>) => void
  nutSearch:       string
  setNutSearch:    (v: string) => void
  nutResults:      any[]
  nutLoading:      boolean
  onSearch:        () => void
  onApply:         (r: any) => void
  dietaryFlags:    Record<string, boolean>
  setDietaryFlags: (f: Record<string, boolean>) => void
  onSave:          () => void
  saving:          boolean
  onClose:         () => void
}) {
  const nutFields = [
    { key: 'energy_kcal', label: 'Energy',        unit: 'kcal' },
    { key: 'protein_g',   label: 'Protein',        unit: 'g' },
    { key: 'carbs_g',     label: 'Carbohydrates',  unit: 'g' },
    { key: 'fat_g',       label: 'Fat',            unit: 'g' },
    { key: 'fibre_g',     label: 'Fibre',          unit: 'g' },
    { key: 'sugar_g',     label: 'Sugars',         unit: 'g' },
    { key: 'salt_g',      label: 'Salt',           unit: 'g' },
  ]
  return (
    <>
      {/* USDA search */}
      <div className="mb-4">
        <p className="text-xs text-text-3 mb-2">Search USDA FoodData Central to auto-populate values (per 100g).</p>
        <div className="flex gap-2">
          <input
            className="input flex-1"
            placeholder="e.g. chicken breast raw"
            value={nutSearch}
            onChange={e => setNutSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && onSearch()}
          />
          <button className="btn-outline px-4 py-2 text-sm" onClick={onSearch} disabled={nutLoading}>
            {nutLoading ? 'Searching…' : 'Search'}
          </button>
        </div>
        {nutResults.length > 0 && (
          <div className="mt-2 border border-border rounded-lg overflow-hidden max-h-40 overflow-y-auto">
            {nutResults.map((r, i) => (
              <button
                key={i}
                type="button"
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent-dim transition-colors border-b border-border last:border-0"
                onClick={() => onApply(r)}
              >
                <div className="font-semibold text-text-1">{r.name}</div>
                {r.energy_kcal != null && (
                  <div className="text-xs text-text-3">
                    {Math.round(r.energy_kcal)}kcal · P:{Number(r.protein_g||0).toFixed(1)}g · C:{Number(r.carbs_g||0).toFixed(1)}g · F:{Number(r.fat_g||0).toFixed(1)}g
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nutrition fields — per 100g */}
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

      {/* Dietary flags */}
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
    </>
  )
}
