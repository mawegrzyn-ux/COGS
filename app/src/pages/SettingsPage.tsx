import { useState, useEffect, useCallback, useMemo } from 'react'
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

interface AppSettings {
  base_currency?: { code: string; symbol: string; name: string }
  cogs_thresholds?: { excellent: number; acceptable: number }
  target_cogs?: number
}

type Tab = 'units' | 'price-levels' | 'exchange-rates' | 'system' | 'thresholds'

const UNIT_TYPES = ['mass', 'volume', 'count'] as const

const TAB_LABELS: Record<Tab, string> = {
  'units':          'Units',
  'price-levels':   'Price Levels',
  'exchange-rates': 'Exchange Rates',
  'system':         'System',
  'thresholds':     'COGS Thresholds',
}

// ── Settings Page ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('units')

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Settings"
        subtitle="Units, price levels and exchange rates"
      />

      {/* Tabs */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border overflow-x-auto">
        {(['units', 'price-levels', 'exchange-rates', 'system', 'thresholds'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors whitespace-nowrap
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
        {tab === 'units'          && <UnitsTab />}
        {tab === 'price-levels'   && <PriceLevelsTab />}
        {tab === 'exchange-rates' && <ExchangeRatesTab />}
        {tab === 'system'         && <SystemTab />}
        {tab === 'thresholds'     && <ThresholdsTab />}
      </div>
    </div>
  )
}

// ── Units Tab ─────────────────────────────────────────────────────────────────
function UnitsTab() {
  const api = useApi()
  const [units, setUnits]       = useState<Unit[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<Unit | null | 'new'>(null)
  const [deleting, setDeleting] = useState<Unit | null>(null)
  const [toast, setToast]       = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const data = await api.get('/units')
      setUnits(data)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const handleSave = async (values: Omit<Unit, 'id'>) => {
    try {
      if (modal === 'new') {
        await api.post('/units', values)
        setToast({ message: 'Unit added', type: 'success' })
      } else if (modal !== null && modal !== 'new') {
        await api.put(`/units/${modal.id}`, values)
        setToast({ message: 'Unit updated', type: 'success' })
      }
      setModal(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/units/${deleting.id}`)
      setToast({ message: 'Unit deleted', type: 'success' })
      setDeleting(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
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
        <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">
          + Add Unit
        </button>
      </div>

      {loading ? <Spinner /> : (
        <div className="space-y-6">
          {grouped.map(({ type, units: typeUnits }) => (
            <div key={type}>
              <h3 className="text-xs font-bold uppercase tracking-widest text-text-3 mb-3 capitalize">{type}</h3>
              {typeUnits.length === 0 ? (
                <p className="text-sm text-text-3 italic pl-2">No {type} units yet</p>
              ) : (
                <div className="bg-surface rounded-lg border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-surface-2 border-b border-border">
                        <th className="text-left px-4 py-2.5 font-semibold text-text-2">Name</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-text-2">Abbreviation</th>
                        <th className="text-left px-4 py-2.5 font-semibold text-text-2">Type</th>
                        <th className="w-20"/>
                      </tr>
                    </thead>
                    <tbody>
                      {typeUnits.map((unit, i) => (
                        <tr key={unit.id} className={`border-b border-border last:border-0 hover:bg-surface-2 transition-colors ${i % 2 === 0 ? '' : 'bg-surface-2/50'}`}>
                          <td className="px-4 py-3 font-semibold text-text-1">{unit.name}</td>
                          <td className="px-4 py-3 font-mono text-text-2">{unit.abbreviation}</td>
                          <td className="px-4 py-3"><Badge label={unit.type} variant="neutral" /></td>
                          <td className="px-4 py-3">
                            <div className="flex gap-2 justify-end">
                              <button onClick={() => setModal(unit)} className="btn-ghost px-2 py-1 text-xs">Edit</button>
                              <button onClick={() => setDeleting(unit)} className="btn-ghost px-2 py-1 text-xs text-red-500 hover:text-red-600">Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          {units.length === 0 && !loading && (
            <EmptyState
              message="No units yet. Add your first unit to get started."
              action={<button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">Add Unit</button>}
            />
          )}
        </div>
      )}

      {modal !== null && (
        <UnitModal
          unit={modal === 'new' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
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
  const [levels, setLevels]     = useState<PriceLevel[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<PriceLevel | null | 'new'>(null)
  const [deleting, setDeleting] = useState<PriceLevel | null>(null)
  const [toast, setToast]       = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setLevels(await api.get('/price-levels'))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const handleSave = async (values: Omit<PriceLevel, 'id'>) => {
    try {
      if (modal === 'new') {
        await api.post('/price-levels', values)
        setToast({ message: 'Price level added', type: 'success' })
      } else if (modal !== null && modal !== 'new') {
        await api.put(`/price-levels/${modal.id}`, values)
        setToast({ message: 'Price level updated', type: 'success' })
      }
      setModal(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await api.delete(`/price-levels/${deleting.id}`)
      setToast({ message: 'Price level deleted', type: 'success' })
      setDeleting(null)
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
      setDeleting(null)
    }
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-text-3">Named price levels used across menus (e.g. Eat-in, Takeout, Delivery).</p>
        <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">+ Add Price Level</button>
      </div>

      {loading ? <Spinner /> : levels.length === 0 ? (
        <EmptyState
          message="No price levels yet."
          action={<button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">Add Price Level</button>}
        />
      ) : (
        <div className="bg-surface rounded-lg border border-border overflow-hidden max-w-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 border-b border-border">
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Name</th>
                <th className="text-left px-4 py-2.5 font-semibold text-text-2">Description</th>
                <th className="w-20"/>
              </tr>
            </thead>
            <tbody>
              {levels.map(level => (
                <tr key={level.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">{level.name}</td>
                  <td className="px-4 py-3 text-text-3">{level.description || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => setModal(level)} className="btn-ghost px-2 py-1 text-xs">Edit</button>
                      <button onClick={() => setDeleting(level)} className="btn-ghost px-2 py-1 text-xs text-red-500">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal !== null && (
        <PriceLevelModal
          level={modal === 'new' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
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
    } catch (err: any) {
      setError(err.message)
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
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary px-4 py-2 text-sm disabled:opacity-60"
          >
            {syncing ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin"/>
                Syncing…
              </span>
            ) : '↻ Sync Rates'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{error}</div>
        )}

        {result && (
          <div className="mt-4">
            <p className="text-xs text-text-3 mb-3">
              Synced at {new Date(result.synced_at).toLocaleString()} — {result.updated.length} countries updated
            </p>
            <div className="grid grid-cols-3 gap-2">
              {result.updated.map(r => (
                <div key={r.currency_code} className="flex justify-between items-center bg-surface-2 rounded px-3 py-2 text-sm">
                  <span className="font-semibold text-text-1">{r.currency_code}</span>
                  <span className="font-mono text-text-3">{r.rate.toFixed(4)}</span>
                </div>
              ))}
            </div>
            {result.updated.length === 0 && (
              <p className="text-sm text-text-3 italic">No countries with matching currencies found. Add countries first.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── System Tab (Base Currency) ────────────────────────────────────────────────
function SystemTab() {
  const api = useApi()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [toast, setToast]     = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [form, setForm]       = useState({ code: 'USD', symbol: '$', name: 'US Dollar' })
  const [errors, setErrors]   = useState<Partial<typeof form>>({})

  useEffect(() => {
    api.get('/settings')
      .then((s: AppSettings) => {
        if (s?.base_currency) {
          setForm({
            code:   s.base_currency.code   || 'USD',
            symbol: s.base_currency.symbol || '$',
            name:   s.base_currency.name   || 'US Dollar',
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  function validate() {
    const e: Partial<typeof form> = {}
    if (!form.code.trim())   e.code   = 'Required'
    if (!form.symbol.trim()) e.symbol = 'Required'
    if (!form.name.trim())   e.name   = 'Required'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSave() {
    if (!validate()) return
    setSaving(true)
    try {
      await api.patch('/settings', {
        base_currency: {
          code:   form.code.toUpperCase().trim(),
          symbol: form.symbol.trim(),
          name:   form.name.trim(),
        }
      })
      setToast({ message: 'Base currency saved', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">Base / System Currency</h2>
        <p className="text-sm text-text-3">
          All costs are converted to this currency internally before being re-converted to each
          country's local currency for display.
        </p>
      </div>

      {/* Live preview */}
      <div className="flex items-center gap-4 bg-surface-2 border border-border rounded-xl px-5 py-4 mb-6">
        <div className="w-12 h-12 rounded-lg bg-accent-dim flex items-center justify-center text-accent text-xl font-bold shrink-0">
          {form.symbol || '$'}
        </div>
        <div>
          <div className="font-extrabold text-text-1 text-base">{form.name || 'Currency Name'}</div>
          <div className="font-mono text-sm text-text-3 mt-0.5">{form.code?.toUpperCase() || 'CODE'}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Currency Code" required error={errors.code}>
          <input
            className="input w-full uppercase"
            value={form.code}
            onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
            placeholder="USD"
            maxLength={10}
          />
          <p className="text-xs text-text-3 mt-1">ISO 4217 — USD, GBP, EUR…</p>
        </Field>
        <Field label="Symbol" required error={errors.symbol}>
          <input
            className="input w-full"
            value={form.symbol}
            onChange={e => setForm(f => ({ ...f, symbol: e.target.value }))}
            placeholder="$"
            maxLength={10}
          />
        </Field>
      </div>

      <Field label="Display Name" required error={errors.name}>
        <input
          className="input w-full"
          value={form.name}
          onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
          placeholder="US Dollar"
        />
      </Field>

      <div className="flex justify-end pt-2">
        <button className="btn-primary px-5 py-2 text-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── COGS Thresholds Tab ───────────────────────────────────────────────────────
function ThresholdsTab() {
  const api = useApi()
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [toast, setToast]       = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [excellent,  setExcellent]  = useState(28)
  const [acceptable, setAcceptable] = useState(35)
  const [targetCogs, setTargetCogs] = useState('')

  useEffect(() => {
    api.get('/settings')
      .then((s: AppSettings) => {
        if (s?.cogs_thresholds) {
          setExcellent(s.cogs_thresholds.excellent  ?? 28)
          setAcceptable(s.cogs_thresholds.acceptable ?? 35)
        }
        if (s?.target_cogs != null) setTargetCogs(String(s.target_cogs))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  async function handleSave() {
    if (excellent >= acceptable) {
      setToast({ message: 'Excellent threshold must be lower than Acceptable', type: 'error' })
      return
    }
    setSaving(true)
    try {
      await api.patch('/settings', {
        cogs_thresholds: { excellent, acceptable },
        target_cogs: targetCogs ? Number(targetCogs) : null,
      })
      setToast({ message: 'Thresholds saved', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">COGS % Thresholds</h2>
        <p className="text-sm text-text-3">
          Define the boundaries for colour-coded COGS status badges across all menus.
        </p>
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden mb-6">

        {/* Excellent */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-accent-dim text-accent w-24 justify-center shrink-0">
            Excellent
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS ≤</span>
          <input
            type="number"
            className="input w-20 text-center font-mono"
            min={1} max={99} step={1}
            value={excellent}
            onChange={e => setExcellent(Number(e.target.value))}
          />
          <span className="text-sm text-text-3">%</span>
        </div>

        {/* Acceptable */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-yellow-50 text-yellow-700 w-24 justify-center shrink-0">
            Acceptable
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS ≤</span>
          <input
            type="number"
            className="input w-20 text-center font-mono"
            min={1} max={99} step={1}
            value={acceptable}
            onChange={e => setAcceptable(Number(e.target.value))}
          />
          <span className="text-sm text-text-3">%</span>
        </div>

        {/* Review — auto-calculated */}
        <div className="flex items-center gap-4 px-5 py-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-600 w-24 justify-center shrink-0">
            Review
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS &gt;</span>
          <span className="font-mono font-bold text-text-1 w-20 text-center">{acceptable}%</span>
          <span className="text-xs text-text-3">(auto)</span>
        </div>
      </div>

      {/* Target COGS */}
      <Field label="Target COGS % (company-wide)">
        <input
          type="number"
          className="input w-32 font-mono"
          min={1} max={99} step={0.5}
          value={targetCogs}
          onChange={e => setTargetCogs(e.target.value)}
          placeholder="e.g. 28"
        />
        <p className="text-xs text-text-3 mt-1">Used for benchmark line on dashboard charts.</p>
      </Field>

      <div className="flex justify-end pt-2">
        <button className="btn-primary px-5 py-2 text-sm" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
