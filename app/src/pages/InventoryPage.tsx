import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Vendor {
  id:            number
  name:          string
  country_id:    number
  country_name:  string
  currency_code: string
  currency_symbol: string
  contact:       string | null
  email:         string | null
  phone:         string | null
  notes:         string | null
}

interface Country {
  id:            number
  name:          string
  currency_code: string
  currency_symbol: string
}

type Tab = 'ingredients' | 'quotes' | 'vendors'
type ToastState = { message: string; type: 'success' | 'error' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const api = useApi()
  const [tab, setTab] = useState<Tab>('vendors')

  // KPI counts
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
    'ingredients': 'Ingredients',
    'quotes':      'Price Quotes',
    'vendors':     'Vendors',
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Inventory"
        subtitle="Manage ingredients, vendor price quotes, and preferred suppliers per country."
      />

      {/* KPI strip */}
      <div className="flex gap-4 px-6 py-4 border-b border-border bg-surface">
        <KpiCard label="Ingredients"      value={ingredientCount} />
        <KpiCard label="Active Quotes"    value={quoteCount} />
        <KpiCard label="Vendors"          value={vendorCount} />
        <KpiCard label="Countries Covered" value={countryCount} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['ingredients', 'quotes', 'vendors'] as Tab[]).map(t => (
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
        {tab === 'ingredients' && <IngredientsTab />}
        {tab === 'quotes'      && <ComingSoon label="Price Quotes" />}
        {tab === 'vendors'     && <VendorsTab onCountChange={setVendorCount} />}
      </div>
    </div>
  )
}

// ── Coming Soon placeholder ───────────────────────────────────────────────────

function ComingSoon({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-48 text-text-3 text-sm">
      {label} tab coming soon…
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

  // Form state
  const blankForm = { name: '', country_id: '', contact: '', email: '', phone: '', notes: '' }
  const [form,     setForm]     = useState(blankForm)
  const [errors,   setErrors]   = useState<Partial<typeof blankForm>>({})
  const [saving,   setSaving]   = useState(false)

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [v, c] = await Promise.all([
        api.get('/vendors'),
        api.get('/countries'),
      ])
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const filtered = useMemo(() =>
    vendors.filter(v => {
      const matchSearch  = !search || v.name.toLowerCase().includes(search.toLowerCase())
      const matchCountry = !filterCountry || String(v.country_id) === filterCountry
      return matchSearch && matchCountry
    }), [vendors, search, filterCountry]
  )

  function openAdd() {
    setModal('new')
    setForm(blankForm)
    setErrors({})
  }

  function openEdit(v: Vendor) {
    setModal(v)
    setForm({
      name:       v.name,
      country_id: String(v.country_id),
      contact:    v.contact  || '',
      email:      v.email    || '',
      phone:      v.phone    || '',
      notes:      v.notes    || '',
    })
    setErrors({})
  }

  function validate() {
    const e: Partial<typeof blankForm> = {}
    if (!form.name.trim())       e.name       = 'Required'
    if (!form.country_id)        e.country_id = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      const payload = {
        name:       form.name.trim(),
        country_id: Number(form.country_id),
        contact:    form.contact.trim()  || null,
        email:      form.email.trim()    || null,
        phone:      form.phone.trim()    || null,
        notes:      form.notes.trim()    || null,
      }
      if (modal === 'new') {
        await api.post('/vendors', payload)
        showToast('Vendor added')
      } else if (modal != null) {
        await api.put(`/vendors/${(modal as Vendor).id}`, payload)
        showToast('Vendor updated')
      }
      setModal(null)
      load()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/vendors/${confirmDelete.id}`)
      showToast('Vendor deleted')
      setConfirmDelete(null)
      load()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
      setConfirmDelete(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Filter bar */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search"
            placeholder="Search vendors…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <select
          className="select"
          value={filterCountry}
          onChange={e => setFilterCountry(e.target.value)}
        >
          <option value="">All Countries</option>
          {countries.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAdd}>
          <PlusIcon size={14} /> Add Vendor
        </button>
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState
          message={search || filterCountry ? 'No vendors match your filters.' : 'No vendors yet. Add your first vendor to get started.'}
          action={!search && !filterCountry
            ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Vendor</button>
            : undefined
          }
        />
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(v => (
            <VendorCard
              key={v.id}
              vendor={v}
              onEdit={() => openEdit(v)}
              onDelete={() => setConfirmDelete(v)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modal !== null && (
        <Modal
          title={modal === 'new' ? 'Add Vendor' : 'Edit Vendor'}
          onClose={() => setModal(null)}
        >
          <Field label="Vendor Name" required error={errors.name}>
            <input
              className="input w-full"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Bangkok Fresh Co."
              autoFocus
            />
          </Field>

          <Field label="Country" required error={errors.country_id}>
            <select
              className="select w-full"
              value={form.country_id}
              onChange={e => setForm(f => ({ ...f, country_id: e.target.value }))}
            >
              <option value="">Select country…</option>
              {countries.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.currency_code})
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact Name">
              <input
                className="input w-full"
                value={form.contact}
                onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
                placeholder="e.g. John Smith"
              />
            </Field>
            <Field label="Phone">
              <input
                className="input w-full"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. +66 2 123 4567"
              />
            </Field>
          </div>

          <Field label="Email">
            <input
              className="input w-full"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="e.g. orders@vendor.com"
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="input w-full"
              rows={2}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Optional notes…"
            />
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Vendor'}
            </button>
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

function VendorCard({ vendor, onEdit, onDelete }: {
  vendor:   Vendor
  onEdit:   () => void
  onDelete: () => void
}) {
  const initials = vendor.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()

  return (
    <div className="bg-surface border border-border rounded-xl p-5">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-accent-dim flex items-center justify-center text-accent font-bold text-sm shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-extrabold text-text-1 truncate">{vendor.name}</div>
          <div className="text-xs text-text-3 mt-0.5">{vendor.country_name} · {vendor.currency_code}</div>
        </div>
      </div>

      {/* Contact details */}
      <div className="space-y-1.5 mb-4 text-sm">
        {vendor.contact && (
          <div className="flex items-center gap-2 text-text-2">
            <PersonIcon size={13} className="text-text-3 shrink-0" />
            <span>{vendor.contact}</span>
          </div>
        )}
        {vendor.email && (
          <div className="flex items-center gap-2 text-text-2">
            <MailIcon size={13} className="text-text-3 shrink-0" />
            <a href={`mailto:${vendor.email}`} className="hover:text-accent transition-colors truncate">
              {vendor.email}
            </a>
          </div>
        )}
        {vendor.phone && (
          <div className="flex items-center gap-2 text-text-2">
            <PhoneIcon size={13} className="text-text-3 shrink-0" />
            <span>{vendor.phone}</span>
          </div>
        )}
        {vendor.notes && (
          <div className="text-xs text-text-3 italic mt-2 line-clamp-2">{vendor.notes}</div>
        )}
        {!vendor.contact && !vendor.email && !vendor.phone && (
          <p className="text-xs text-text-3 italic">No contact details added.</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button className="btn-outline flex-1 py-1.5 text-sm flex items-center justify-center gap-1.5" onClick={onEdit}>
          <EditIcon size={13} /> Edit
        </button>
        <button
          className="flex-1 py-1.5 text-sm flex items-center justify-center gap-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors font-semibold"
          onClick={onDelete}
        >
          <TrashIcon size={13} /> Delete
        </button>
      </div>
    </div>
  )
}


// ── Ingredients Tab ───────────────────────────────────────────────────────────

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
}

interface Unit {
  id:           number
  name:         string
  abbreviation: string
  type:         string
}

function IngredientsTab() {
  const api = useApi()

  const [ingredients,   setIngredients]   = useState<Ingredient[]>([])
  const [units,         setUnits]         = useState<Unit[]>([])
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [filterCat,     setFilterCat]     = useState('')
  const [modal,         setModal]         = useState<Ingredient | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Ingredient | null>(null)
  const [toast,         setToast]         = useState<ToastState | null>(null)

  const blankForm = {
    name:                            '',
    category:                        '',
    base_unit_id:                    '',
    default_prep_unit:               '',
    default_prep_to_base_conversion: '1',
    waste_pct:                       '0',
    notes:                           '',
  }
  const [form,   setForm]   = useState(blankForm)
  const [errors, setErrors] = useState<Partial<typeof blankForm>>({})
  const [saving, setSaving] = useState(false)

  // ── Load ────────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [ings, us] = await Promise.all([
        api.get('/ingredients'),
        api.get('/units'),
      ])
      setIngredients(ings || [])
      setUnits(us || [])
    } catch {
      showToast('Failed to load ingredients', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // ── Derived ──────────────────────────────────────────────────────────────────

  const categories = useMemo(() =>
    [...new Set(ingredients.map(i => i.category).filter(Boolean))].sort() as string[]
  , [ingredients])

  const filtered = useMemo(() =>
    ingredients.filter(i => {
      const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase())
      const matchCat    = !filterCat || i.category === filterCat
      return matchSearch && matchCat
    }), [ingredients, search, filterCat]
  )

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const baseUnit = (ing: Ingredient) => ing.base_unit_abbr ?? '—'

  const convHint = () => {
    const unit = units.find(u => u.id === Number(form.base_unit_id))
    const prep = form.default_prep_unit || unit?.abbreviation || 'unit'
    const base = unit?.abbreviation || 'base unit'
    return `1 ${prep} = ${form.default_prep_to_base_conversion || '1'} ${base}`
  }

  function openAdd() {
    setModal('new')
    setForm(blankForm)
    setErrors({})
  }

  function openEdit(i: Ingredient) {
    setModal(i)
    setForm({
      name:                            i.name,
      category:                        i.category || '',
      base_unit_id:                    i.base_unit_id ? String(i.base_unit_id) : '',
      default_prep_unit:               i.default_prep_unit || '',
      default_prep_to_base_conversion: i.default_prep_to_base_conversion || '1',
      waste_pct:                       i.waste_pct || '0',
      notes:                           i.notes || '',
    })
    setErrors({})
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
        name:                            form.name.trim(),
        category:                        form.category.trim() || null,
        base_unit_id:                    Number(form.base_unit_id),
        default_prep_unit:               form.default_prep_unit.trim() || null,
        default_prep_to_base_conversion: Number(form.default_prep_to_base_conversion) || 1,
        waste_pct:                       Number(form.waste_pct) || 0,
        notes:                           form.notes.trim() || null,
      }
      if (modal === 'new') {
        await api.post('/ingredients', payload)
        showToast('Ingredient added')
      } else if (modal != null) {
        await api.put(`/ingredients/${(modal as Ingredient).id}`, payload)
        showToast('Ingredient updated')
      }
      setModal(null)
      load()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return
    try {
      await api.delete(`/ingredients/${confirmDelete.id}`)
      showToast('Ingredient deleted')
      setConfirmDelete(null)
      load()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
      setConfirmDelete(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Filter bar */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search"
            placeholder="Search ingredients…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
        <select
          className="select"
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
        >
          <option value="">All Categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAdd}>
          <PlusIcon size={14} /> Add Ingredient
        </button>
      </div>

      {loading ? <Spinner /> : filtered.length === 0 ? (
        <EmptyState
          message={search || filterCat
            ? 'No ingredients match your filters.'
            : 'No ingredients yet. Add your first ingredient to get started.'
          }
          action={!search && !filterCat
            ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAdd}>Add Ingredient</button>
            : undefined
          }
        />
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border text-left">
                <th className="px-4 py-3 font-semibold text-text-2">Ingredient</th>
                <th className="px-4 py-3 font-semibold text-text-2">Category</th>
                <th className="px-4 py-3 font-semibold text-text-2">Base Unit</th>
                <th className="px-4 py-3 font-semibold text-text-2">Prep Unit</th>
                <th className="px-4 py-3 font-semibold text-text-2">Conv.</th>
                <th className="px-4 py-3 font-semibold text-text-2">Waste %</th>
                <th className="px-4 py-3 font-semibold text-text-2">Quotes</th>
                <th className="w-20"/>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ing => (
                <tr key={ing.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{ing.name}</td>
                  <td className="px-4 py-3 text-text-3">{ing.category || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2">{baseUnit(ing)}</td>
                  <td className="px-4 py-3 font-mono text-text-2">{ing.default_prep_unit || '—'}</td>
                  <td className="px-4 py-3 font-mono text-text-2">
                    {Number(ing.default_prep_to_base_conversion) !== 1
                      ? Number(ing.default_prep_to_base_conversion).toFixed(4)
                      : '1'
                    }
                  </td>
                  <td className="px-4 py-3 font-mono text-text-2">
                    {Number(ing.waste_pct) > 0 ? `${ing.waste_pct}%` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                      ${Number(ing.active_quote_count) > 0
                        ? 'bg-accent-dim text-accent'
                        : 'bg-surface-2 text-text-3'
                      }`}>
                      {ing.active_quote_count}/{ing.quote_count}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button
                        className="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
                        onClick={() => openEdit(ing)}
                      >
                        <EditIcon size={12} /> Edit
                      </button>
                      <button
                        className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        onClick={() => setConfirmDelete(ing)}
                      >
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

      {/* Modal */}
      {modal !== null && (
        <Modal
          title={modal === 'new' ? 'Add Ingredient' : 'Edit Ingredient'}
          onClose={() => setModal(null)}
        >
          <Field label="Name" required error={errors.name}>
            <input
              className="input w-full"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Chicken Breast"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <input
                className="input w-full"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                placeholder="e.g. Proteins"
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                {categories.map(c => <option key={c} value={c} />)}
              </datalist>
            </Field>

            <Field label="Base Unit" required error={errors.base_unit_id}>
              <select
                className="select w-full"
                value={form.base_unit_id}
                onChange={e => setForm(f => ({ ...f, base_unit_id: e.target.value }))}
              >
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
            <p className="text-xs text-text-3 mb-3">
              Default prep settings — pre-filled when added to a recipe (overridable per recipe).
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Default Prep Unit">
                <input
                  className="input w-full"
                  value={form.default_prep_unit}
                  onChange={e => setForm(f => ({ ...f, default_prep_unit: e.target.value }))}
                  placeholder="e.g. g, slice, cup"
                />
                <p className="text-xs text-text-3 mt-1">Auto-filled from base unit if blank.</p>
              </Field>
              <Field label="Conversion to Base Unit">
                <input
                  className="input w-full font-mono"
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={form.default_prep_to_base_conversion}
                  onChange={e => setForm(f => ({ ...f, default_prep_to_base_conversion: e.target.value }))}
                />
                <p className="text-xs text-text-3 mt-1">{convHint()}</p>
              </Field>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Waste %">
              <input
                className="input w-full font-mono"
                type="number"
                min="0"
                max="99"
                step="0.5"
                value={form.waste_pct}
                onChange={e => setForm(f => ({ ...f, waste_pct: e.target.value }))}
                placeholder="0"
              />
              <p className="text-xs text-text-3 mt-1">Added to cost calculations.</p>
            </Field>
            <Field label="Notes">
              <input
                className="input w-full"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional…"
              />
            </Field>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save Ingredient'}
            </button>
          </div>
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
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )
}

function EditIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6"/>
      <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
    </svg>
  )
}

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

function PersonIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  )
}

function MailIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
      <polyline points="22,6 12,13 2,6"/>
    </svg>
  )
}

function PhoneIcon({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}>
      <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.8a19.79 19.79 0 01-3.07-8.67A2 2 0 012 .91h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
    </svg>
  )
}
