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
        {tab === 'ingredients' && <ComingSoon label="Ingredients" />}
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
