import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────
interface Unit {
  id:           number
  name:         string
  abbreviation: string
  type:         'mass' | 'volume' | 'count'
}

interface PriceLevel {
  id:          number
  name:        string
  description: string | null
}

type Tab = 'units' | 'price-levels' | 'exchange-rates'

const UNIT_TYPES = ['mass', 'volume', 'count'] as const

// ── Settings Page ─────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('units')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Settings"
        subtitle="Units, price levels and exchange rates"
      />
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {([
          { key: 'units',          label: 'Units' },
          { key: 'price-levels',   label: 'Price Levels' },
          { key: 'exchange-rates', label: 'Exchange Rates' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors
              ${tab === t.key
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'units'           && <UnitsTab />}
        {tab === 'price-levels'    && <PriceLevelsTab />}
        {tab === 'exchange-rates'  && <ExchangeRatesTab />}
      </div>
    </div>
  )
}

// ── Units Tab ─────────────────────────────────────────────────────────────────
function UnitsTab() {
  const api = useApi()
  const [units, setUnits]           = useState<Unit[]>([])
  const [loading, setLoading]       = useState(true)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState<Unit | null>(null)
  const [deleting, setDeleting]     = useState<Unit | null>(null)
  const [toast, setToast]           = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setUnits(await api.get('/units'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const openNew  = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (u: Unit) => { setEditing(u); setModalOpen(true) }

  const handleSave = async (values: Omit<Unit, 'id'>) => {
    try {
      if (editing) {
        await api.put(`/units/${editing.id}`, values)
        setToast({ message: 'Unit updated', type: 'success' })
      } else {
        await api.post('/units', values)
        setToast({ message: 'Unit added', type: 'success' })
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setToast({ message: msg, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/units/${deleting.id}`)
      setToast({ message: 'Unit deleted', type: 'success' })
      setDeleting(null)
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setToast({ message: msg, type: 'error' })
      setDeleting(null)
    }
  }

  const grouped = UNIT_TYPES.map(type => ({
    type,
    units: units.filter(u => u.type === type),
  }))

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-text-3">Measurement units used across ingredients and recipes.</p>
        <button onClick={openNew} className="btn-primary px-4 py-2 text-sm">+ Add Unit</button>
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          {units.length === 0 ? (
            <EmptyState
              message="No units yet. Add your first unit to get started."
              action={<button onClick={openNew} className="btn-primary px-4 py-2 text-sm">Add Unit</button>}
            />
          ) : grouped.map(({ type, units: typeUnits }) => typeUnits.length === 0 ? null : (
            <div key={type}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-3 mb-3 capitalize">{type}</h3>
              <div className="bg-surface rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-2 border-b border-border">
                      <th className="text-left px-4 py-2.5 font-semibold text-text-2">Name</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-text-2">Abbreviation</th>
                      <th className="text-left px-4 py-2.5 font-semibold text-text-2">Type</th>
                      <th className="w-24"/>
                    </tr>
                  </thead>
                  <tbody>
                    {typeUnits.map(unit => (
                      <tr key={unit.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-semibold text-text-1">{unit.name}</td>
                        <td className="px-4 py-3 font-mono text-text-2">{unit.abbreviation}</td>
                        <td className="px-4 py-3"><Badge label={unit.type} variant="neutral" /></td>
                        <td className="px-4 py-3">
                          <div className="flex gap-2 justify-end">
                            <button onClick={() => openEdit(unit)} className="btn-ghost px-2 py-1 text-xs">Edit</button>
                            <button onClick={() => setDeleting(unit)} className="btn-ghost px-2 py-1 text-xs text-red-500 hover:text-red-600">Delete</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <UnitModal
          unit={editing}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete unit "${deleting.name}"? This may affect ingredients using this unit.`}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Unit Modal ────────────────────────────────────────────────────────────────
function UnitModal({ unit, onSave, onClose }: {
  unit:    Unit | null
  onSave:  (v: Omit<Unit, 'id'>) => Promise<void>
  onClose: () => void
}) {
  const [name, setName]     = useState(unit?.name || '')
  const [abbr, setAbbr]     = useState(unit?.abbreviation || '')
  const [type, setType]     = useState<Unit['type']>(unit?.type || 'mass')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Name is required'
    if (!abbr.trim()) e.abbr = 'Abbreviation is required'
    return e
  }

  const handleSubmit = async () => {
    const e = validate()
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    await onSave({ name: name.trim(), abbreviation: abbr.trim(), type })
    setSaving(false)
  }

  return (
    <Modal title={unit ? 'Edit Unit' : 'Add Unit'} onClose={onClose}>
      <Field label="Name" required error={errors.name}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Kilogram" autoFocus />
      </Field>
      <Field label="Abbreviation" required error={errors.abbr}>
        <input className="input" value={abbr} onChange={e => setAbbr(e.target.value)} placeholder="e.g. kg" />
      </Field>
      <Field label="Type" required>
        <select className="input" value={type} onChange={e => setType(e.target.value as Unit['type'])}>
          {UNIT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
        </select>
      </Field>
      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {saving ? 'Saving…' : unit ? 'Save Changes' : 'Add Unit'}
        </button>
      </div>
    </Modal>
  )
}

// ── Price Levels Tab ──────────────────────────────────────────────────────────
function PriceLevelsTab() {
  const api = useApi()
  const [levels, setLevels]         = useState<PriceLevel[]>([])
  const [loading, setLoading]       = useState(true)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState<PriceLevel | null>(null)
  const [deleting, setDeleting]     = useState<PriceLevel | null>(null)
  const [toast, setToast]           = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLevels(await api.get('/price-levels'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const openNew  = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (l: PriceLevel) => { setEditing(l); setModalOpen(true) }

  const handleSave = async (values: Omit<PriceLevel, 'id'>) => {
    try {
      if (editing) {
        await api.put(`/price-levels/${editing.id}`, values)
        setToast({ message: 'Price level updated', type: 'success' })
      } else {
        await api.post('/price-levels', values)
        setToast({ message: 'Price level added', type: 'success' })
      }
      setModalOpen(false)
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setToast({ message: msg, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/price-levels/${deleting.id}`)
      setToast({ message: 'Price level deleted', type: 'success' })
      setDeleting(null)
      load()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong'
      setToast({ message: msg, type: 'error' })
      setDeleting(null)
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-text-3">Named price levels used across menus (e.g. Eat-in, Takeout, Delivery).</p>
        <button onClick={openNew} className="btn-primary px-4 py-2 text-sm">+ Add Price Level</button>
      </div>

      {loading ? <Spinner /> : levels.length === 0 ? (
        <EmptyState
          message="No price levels yet."
          action={<button onClick={openNew} className="btn-primary px-4 py-2 text-sm">Add Price Level</button>}
        />
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Name</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Description</th>
                <th className="w-24"/>
              </tr>
            </thead>
            <tbody>
              {levels.map(level => (
                <tr key={level.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{level.name}</td>
                  <td className="px-4 py-3 text-text-3">{level.description || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => openEdit(level)} className="btn-ghost px-2 py-1 text-xs">Edit</button>
                      <button onClick={() => setDeleting(level)} className="btn-ghost px-2 py-1 text-xs text-red-500">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <PriceLevelModal
          level={editing}
          onSave={handleSave}
          onClose={() => setModalOpen(false)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          message={`Delete price level "${deleting.name}"?`}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  )
}

// ── Price Level Modal ─────────────────────────────────────────────────────────
function PriceLevelModal({ level, onSave, onClose }: {
  level:   PriceLevel | null
  onSave:  (v: Omit<PriceLevel, 'id'>) => Promise<void>
  onClose: () => void
}) {
  const [name, setName]     = useState(level?.name || '')
  const [desc, setDesc]     = useState(level?.description || '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    await onSave({ name: name.trim(), description: desc.trim() || null })
    setSaving(false)
  }

  return (
    <Modal title={level ? 'Edit Price Level' : 'Add Price Level'} onClose={onClose}>
      <Field label="Name" required error={error}>
        <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Eat-in" autoFocus />
      </Field>
      <Field label="Description">
        <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
      </Field>
      <div className="flex gap-3 justify-end pt-2">
        <button onClick={onClose} className="btn-ghost px-4 py-2 text-sm">Cancel</button>
        <button onClick={handleSubmit} disabled={saving} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
          {saving ? 'Saving…' : level ? 'Save Changes' : 'Add Price Level'}
        </button>
      </div>
    </Modal>
  )
}

// ── Exchange Rates Tab ────────────────────────────────────────────────────────
function ExchangeRatesTab() {
  const api = useApi()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult]   = useState<{ synced_at: string; updated: { currency_code: string; rate: number }[] } | null>(null)
  const [error, setError]     = useState('')

  const handleSync = async () => {
    setSyncing(true)
    setError('')
    setResult(null)
    try {
      const data = await api.post('/sync-exchange-rates', {})
      setResult(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="max-w-xl">
      <p className="text-sm text-text-3 mb-6">
        Fetch the latest exchange rates from the Frankfurter API (base: EUR).
        Rates are stored on each country and used for cross-country COGS calculations.
      </p>
      <div className="bg-surface rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-text-1">Frankfurter API</h3>
            <p className="text-xs text-text-3 mt-0.5">api.frankfurter.app — free, no key required</p>
          </div>
          <button onClick={handleSync} disabled={syncing} className="btn-primary px-4 py-2 text-sm disabled:opacity-60">
            {syncing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
                Syncing…
              </span>
            ) : '↻ Sync Rates'}
          </button>
        </div>
        {error && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>}
        {result && (
          <div className="mt-4">
            <p className="text-xs text-text-3 mb-3">
              Synced at {new Date(result.synced_at).toLocaleString()} — {result.updated.length} countries updated
            </p>
            {result.updated.length === 0 ? (
              <p className="text-sm text-text-3 italic">No countries with matching currencies found. Add countries first.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {result.updated.map(r => (
                  <div key={r.currency_code} className="flex justify-between items-center bg-surface-2 rounded px-3 py-2 text-sm">
                    <span className="font-semibold text-text-1">{r.currency_code}</span>
                    <span className="font-mono text-text-3">{r.rate.toFixed(4)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
