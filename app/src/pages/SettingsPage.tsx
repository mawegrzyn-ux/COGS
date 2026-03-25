import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'
import ImportPage from './ImportPage'

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
  is_default:  boolean
}

interface AppSettings {
  base_currency?:   { code: string; symbol: string; name: string }
  cogs_thresholds?: { excellent: number; acceptable: number }
  target_cogs?:     number
}

type Tab = 'units' | 'price-levels' | 'exchange-rates' | 'system' | 'thresholds' | 'test-data' | 'ai' | 'import'

const UNIT_TYPES = ['mass', 'volume', 'count'] as const

const TAB_LABELS: Record<Tab, string> = {
  'units':          'Base Units',
  'price-levels':   'Price Levels',
  'exchange-rates': 'Exchange Rates',
  'system':         'System',
  'thresholds':     'COGS Thresholds',
  'test-data':      'Test Data',
  'ai':             'AI',
  'import':         'Import',
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

      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border overflow-x-auto">
        {(['units', 'price-levels', 'exchange-rates', 'system', 'thresholds', 'test-data', 'ai', 'import'] as Tab[]).map(t => (
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

      <div className={tab === 'import' ? 'flex-1 overflow-y-auto' : 'flex-1 overflow-y-auto p-6'}>
        {tab === 'units'          && <UnitsTab />}
        {tab === 'price-levels'   && <PriceLevelsTab />}
        {tab === 'exchange-rates' && <ExchangeRatesTab />}
        {tab === 'system'         && <SystemTab />}
        {tab === 'thresholds'     && <ThresholdsTab />}
        {tab === 'test-data'      && <TestDataTab />}
        {tab === 'ai'             && <AiTab />}
        {tab === 'import'         && <ImportPage hideHeader />}
      </div>
    </div>
  )
}

// ── Units Tab ─────────────────────────────────────────────────────────────────

function UnitsTab() {
  const api = useApi()
  const [units, setUnits]       = useState<Unit[]>([])
  const [loading, setLoading]   = useState(true)
  const [modal, setModal]       = useState<Unit | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Unit | null>(null)
  const [toast, setToast]       = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setUnits(await api.get('/units'))
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
      } else if (modal != null) {
        await api.put(`/units/${(modal as Unit).id}`, values)
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

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <p className="text-sm text-text-3">Base units used across ingredients and recipes.</p>
        <button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">
          + Add Base Unit
        </button>
      </div>

      {loading ? <Spinner /> : units.length === 0 ? (
        <EmptyState
          message="No base units yet. Add your first unit to get started."
          action={<button onClick={() => setModal('new')} className="btn-primary px-4 py-2 text-sm">Add Base Unit</button>}
        />
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
              {units.map((unit, i) => (
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

      {modal !== null && (
        <UnitModal
          unit={modal === 'new' ? null : modal as Unit}
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
        <select className="select" value={type} onChange={e => setType(e.target.value as Unit['type'])}>
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
  const [modal, setModal]       = useState<PriceLevel | 'new' | null>(null)
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

  const handleSetDefault = async (level: PriceLevel) => {
    try {
      await api.post(`/price-levels/${level.id}/set-default`, {})
      setToast({ message: `"${level.name}" set as default`, type: 'success' })
      load()
    } catch (err: any) {
      setToast({ message: err.message, type: 'error' })
    }
  }

  const handleSave = async (values: Omit<PriceLevel, 'id'>) => {
    try {
      if (modal === 'new') {
        await api.post('/price-levels', values)
        setToast({ message: 'Price level added', type: 'success' })
      } else if (modal != null) {
        await api.put(`/price-levels/${(modal as PriceLevel).id}`, values)
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
                <th className="text-center px-4 py-2.5 font-semibold text-text-2 w-24">Default</th>
                <th className="w-20"/>
              </tr>
            </thead>
            <tbody>
              {levels.map(level => (
                <tr key={level.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                  <td className="px-4 py-3 font-semibold text-text-1">
                    {level.name}
                  </td>
                  <td className="px-4 py-3 text-text-3">{level.description || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {level.is_default
                      ? <span title="Default level" className="text-yellow-500 text-lg">★</span>
                      : <button
                          onClick={() => handleSetDefault(level)}
                          title="Set as default"
                          className="text-gray-300 hover:text-yellow-400 text-lg transition-colors"
                        >☆</button>
                    }
                  </td>
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
          level={modal === 'new' ? null : modal as PriceLevel}
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
  const [name,       setName]      = useState(level?.name || '')
  const [desc,       setDesc]      = useState(level?.description || '')
  const [isDefault,  setIsDefault] = useState(level?.is_default || false)
  const [saving,     setSaving]    = useState(false)
  const [error,      setError]     = useState('')

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    await onSave({ name: name.trim(), description: desc.trim() || null, is_default: isDefault })
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
      <Field label="Default level">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={e => setIsDefault(e.target.checked)}
            className="w-4 h-4 accent-yellow-500"
          />
          <span className="text-sm text-text-2">Use as the default price level across menus</span>
        </label>
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
  const [syncing, setSyncing]       = useState(false)
  const [result, setResult]         = useState<{ synced_at: string; base: string; updated: { currency_code: string; rate: number }[] } | null>(null)
  const [error, setError]           = useState('')
  const [baseCurrency, setBaseCurrency] = useState<string | null>(null)

  useEffect(() => {
    api.get('/settings')
      .then((s: any) => setBaseCurrency(s?.base_currency?.code || 'USD'))
      .catch(() => setBaseCurrency('USD'))
  }, [api])

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
        Fetch the latest exchange rates from the Frankfurter API.
        Rates are calculated relative to your base currency
        {baseCurrency
          ? <> (<span className="font-mono font-bold text-text-1">{baseCurrency}</span>)</>
          : ''
        }.
        Stored on each country and used for cross-country COGS calculations.
      </p>

      <div className="bg-surface rounded-lg border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-bold text-text-1">Frankfurter API</h3>
            <p className="text-xs text-text-3 mt-0.5">
              api.frankfurter.app — free, no key required
              {baseCurrency && (
                <span className="ml-2 font-mono text-accent font-semibold">base: {baseCurrency}</span>
              )}
            </p>
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
              {result.base && (
                <span className="ml-2 font-mono text-accent font-semibold">(base: {result.base})</span>
              )}
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
            className="input w-full"
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
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [toast, setToast]         = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [excellent, setExcellent]   = useState(28)
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

        <div className="flex items-center gap-4 px-5 py-4">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-red-50 text-red-600 w-24 justify-center shrink-0">
            Review
          </span>
          <span className="text-sm text-text-3 shrink-0">COGS &gt;</span>
          <span className="font-mono font-bold text-text-1 w-20 text-center">{acceptable}%</span>
          <span className="text-xs text-text-3">(auto)</span>
        </div>

      </div>

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

// ── Test Data Tab ─────────────────────────────────────────────────────────────

function TestDataTab() {
  const api = useApi()
  const [loading,       setLoading]       = useState(false)
  const [log,           setLog]           = useState<string[]>([])
  const [confirmAction, setConfirmAction] = useState<'seed' | 'seed-small' | 'clear' | 'defaults' | null>(null)
  const [toast,         setToast]         = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  async function handleSeed() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Clearing existing data…', 'Seeding full test data (1,000 ingredients) — please wait…'])
    try {
      const result = await api.post('/seed', {})
      setLog(result.log || [])
      setToast({ message: 'Full test data loaded successfully', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to load test data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleSeedSmall() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Clearing existing data…', 'Seeding small test data (200 ingredients) — please wait…'])
    try {
      const result = await api.post('/seed/small', {})
      setLog(result.log || [])
      setToast({ message: 'Small test data loaded successfully', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to load small test data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleClear() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Clearing all data…'])
    try {
      const result = await api.post('/seed/clear', {})
      setLog(result.log || ['All data cleared.'])
      setToast({ message: 'Database cleared', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to clear data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDefaults() {
    setConfirmAction(null)
    setLoading(true)
    setLog(['Loading default data…'])
    try {
      const result = await api.post('/seed/defaults', {})
      setLog(result.log || ['Default data loaded.'])
      setToast({ message: 'Default data loaded successfully', type: 'success' })
    } catch (err: any) {
      setLog(prev => [...prev, `Error: ${err.message}`])
      setToast({ message: err.message || 'Failed to load default data', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  const SEED_SUMMARY = [
    ['4',     'Countries with realistic tax rates per level'],
    ['3',     'Price Levels (Eat-In, Takeaway, Delivery)'],
    ['10',    'Vendors'],
    ['1,000', 'Ingredients across 12 categories'],
    ['500',   'Price Quotes'],
    ['48',    'Recipes with ingredient line items'],
    ['4',     'Menus — items priced across all price levels'],
  ]

  const SMALL_SEED_SUMMARY = [
    ['4',   'Countries with realistic tax rates per level'],
    ['3',   'Price Levels (Eat-In, Takeaway, Delivery)'],
    ['10',  'Vendors'],
    ['200', 'Ingredients across 12 categories'],
    ['400', 'Price Quotes (2 per ingredient)'],
    ['48',  'Recipes with ingredient line items'],
    ['4',   'Menus — items priced across all price levels'],
  ]

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">Test Data</h2>
        <p className="text-sm text-text-3">
          Load a full set of realistic dummy data to explore and test the app, or wipe the database to start fresh.
          All operations run inside a transaction and roll back on error.
        </p>
      </div>

      {/* Load Test Data card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-bold text-text-1 mb-2">Load Test Data</h3>
            <p className="text-xs text-text-3 mb-3">
              Clears <strong>all existing data</strong> first, then inserts:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {SEED_SUMMARY.map(([n, label]) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-2">
                  <span className="font-mono font-bold text-accent w-12 shrink-0 text-right">{n}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setConfirmAction('seed')}
            disabled={loading}
            className="btn-primary px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Running…
              </span>
            ) : 'Load Test Data'}
          </button>
        </div>
      </div>

      {/* Load Small Test Data card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-bold text-text-1 mb-2">Load Small Test Data</h3>
            <p className="text-xs text-text-3 mb-3">
              Faster reset for development — clears <strong>all existing data</strong> first, then inserts:
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {SMALL_SEED_SUMMARY.map(([n, label]) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-2">
                  <span className="font-mono font-bold text-accent w-12 shrink-0 text-right">{n}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setConfirmAction('seed-small')}
            disabled={loading}
            className="btn-outline px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                Running…
              </span>
            ) : 'Load Small Data'}
          </button>
        </div>
      </div>

      {/* Clear All Data card */}
      <div className="bg-surface border border-red-200 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h3 className="font-bold text-red-600 mb-1">Clear All Data</h3>
            <p className="text-sm text-text-3">
              Permanently removes all rows from every table. The schema and table structure are preserved.
              This cannot be undone.
            </p>
          </div>
          <button
            onClick={() => setConfirmAction('clear')}
            disabled={loading}
            className="btn-danger px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            Clear Database
          </button>
        </div>
      </div>

      {/* Load Default Data card */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-6">
        <div className="flex items-start justify-between gap-6">
          <div className="flex-1">
            <h3 className="font-bold text-text-1 mb-2">Load Default Data</h3>
            <p className="text-xs text-text-3 mb-3">
              Adds a minimal, production-ready starting point. Safe to run after{' '}
              <strong>Clear Database</strong> — does not wipe existing data first.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              {[
                ['1', 'Market — United Kingdom (GBP)'],
                ['1', 'Brand — Default Brand'],
                ['1', 'Location — Default Location'],
                ['3', 'Units — Kilogram, Litre, Each'],
                ['6', 'Categories — Food, Beverage, Other × 2 types'],
                ['1', 'Price Level — Default (is_default)'],
                ['1', 'Vendor — Default Vendor'],
                ['3', 'UK Tax Rates — 20%, 5%, 0% VAT'],
                ['1', 'Standard VAT → Default price level'],
              ].map(([n, label]) => (
                <div key={label} className="flex items-center gap-1.5 text-sm text-text-2">
                  <span className="font-mono font-bold text-accent w-12 shrink-0 text-right">{n}</span>
                  <span className="text-text-3">{label}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-text-3 mt-3 italic">No recipes or price quotes are created — those are entered by you.</p>
          </div>
          <button
            onClick={() => setConfirmAction('defaults')}
            disabled={loading}
            className="btn-outline px-4 py-2 text-sm whitespace-nowrap shrink-0 disabled:opacity-60"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-3.5 h-3.5 border-2 border-accent/40 border-t-accent rounded-full animate-spin" />
                Running…
              </span>
            ) : 'Load Defaults'}
          </button>
        </div>
      </div>

      {/* Log output panel */}
      {log.length > 0 && (
        <div className="bg-gray-950 rounded-lg p-4 font-mono text-xs text-green-400 max-h-56 overflow-y-auto space-y-0.5">
          {loading && (
            <div className="flex items-center gap-2 text-green-300 mb-1">
              <span className="w-3 h-3 border-2 border-green-400/40 border-t-green-400 rounded-full animate-spin inline-block" />
              Working…
            </div>
          )}
          {log.map((line, i) => (
            <div key={i} className={line.startsWith('Error') ? 'text-red-400' : ''}>{line}</div>
          ))}
        </div>
      )}

      {/* Confirm — seed (full) */}
      {confirmAction === 'seed' && (
        <ConfirmDialog
          message="This will DELETE all existing data and load the full test dataset (1,000 ingredients). This cannot be undone. Continue?"
          onConfirm={handleSeed}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Confirm — seed (small) */}
      {confirmAction === 'seed-small' && (
        <ConfirmDialog
          message="This will DELETE all existing data and load the small test dataset (200 ingredients). This cannot be undone. Continue?"
          onConfirm={handleSeedSmall}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Confirm — clear */}
      {confirmAction === 'clear' && (
        <ConfirmDialog
          message="This will permanently DELETE ALL DATA from every table. The schema is preserved but all records will be gone. Are you sure?"
          onConfirm={handleClear}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {/* Confirm — defaults */}
      {confirmAction === 'defaults' && (
        <ConfirmDialog
          message="This will insert default data (UK market, 3 units, categories, price level, vendor, tax rates) into the current database without clearing existing records. Continue?"
          onConfirm={handleDefaults}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── AI Integration Tab ────────────────────────────────────────────────────────

interface AiKeyStatus {
  anthropic_key_set: boolean
  voyage_key_set:    boolean
  brave_key_set:     boolean
}

function AiTab() {
  const api = useApi()
  const [loading,      setLoading]      = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [status,       setStatus]       = useState<AiKeyStatus>({ anthropic_key_set: false, voyage_key_set: false, brave_key_set: false })
  const [anthropic,    setAnthropic]    = useState('')
  const [voyage,       setVoyage]       = useState('')
  const [brave,        setBrave]        = useState('')
  const [conciseMode,  setConciseMode]  = useState(false)
  const [savingMode,   setSavingMode]   = useState(false)
  const [toast,        setToast]        = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/ai-config'),
      api.get('/settings'),
    ])
      .then(([s, settings]) => {
        setStatus(s)
        setConciseMode(settings?.ai_concise_mode === true)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [api])

  async function handleToggleConciseMode(val: boolean) {
    setConciseMode(val)
    setSavingMode(true)
    try {
      await api.patch('/settings', { ai_concise_mode: val })
      setToast({ message: val ? 'Concise mode enabled' : 'Concise mode disabled', type: 'success' })
    } catch (err: any) {
      setConciseMode(!val) // revert
      setToast({ message: err.message || 'Failed to save', type: 'error' })
    } finally {
      setSavingMode(false)
    }
  }

  useEffect(() => { load() }, [load])

  async function handleSave() {
    const payload: Record<string, string> = {}
    if (anthropic.trim()) payload.ANTHROPIC_API_KEY    = anthropic.trim()
    if (voyage.trim())    payload.VOYAGE_API_KEY       = voyage.trim()
    if (brave.trim())     payload.BRAVE_SEARCH_API_KEY = brave.trim()
    if (!Object.keys(payload).length) return
    setSaving(true)
    try {
      const updated: AiKeyStatus = await api.patch('/ai-config', payload)
      setStatus(updated)
      setAnthropic('')
      setVoyage('')
      setBrave('')
      setToast({ message: 'Keys saved', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function handleClear(key: 'ANTHROPIC_API_KEY' | 'VOYAGE_API_KEY' | 'BRAVE_SEARCH_API_KEY') {
    try {
      const updated: AiKeyStatus = await api.delete(`/ai-config/${key}`)
      setStatus(updated)
      setToast({ message: 'Key cleared', type: 'success' })
    } catch (err: any) {
      setToast({ message: err.message || 'Failed to clear key', type: 'error' })
    }
  }

  if (loading) return <Spinner />

  return (
    <div className="max-w-lg">
      <div className="mb-6">
        <h2 className="text-base font-bold text-text-1 mb-1">AI Integration</h2>
        <p className="text-sm text-text-3">
          API keys are stored securely in the database and never returned to the browser. Paste a new key to update — leave blank to keep the existing value.
        </p>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: 'Anthropic (Claude)', set: status.anthropic_key_set, key: 'ANTHROPIC_API_KEY'    as const },
          { label: 'Voyage AI (RAG)',    set: status.voyage_key_set,    key: 'VOYAGE_API_KEY'       as const },
          { label: 'Brave (Web Search)', set: status.brave_key_set,     key: 'BRAVE_SEARCH_API_KEY' as const },
        ].map(({ label, set, key }) => (
          <div
            key={key}
            className="flex items-center justify-between rounded-xl border px-4 py-3"
            style={{ borderColor: set ? 'var(--accent-mid)' : 'var(--border)', background: set ? 'var(--accent-dim)' : 'var(--surface-2)' }}
          >
            <div>
              <div className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{label}</div>
              <Badge label={set ? 'Configured' : 'Not set'} variant={set ? 'green' : 'neutral'} />
            </div>
            {set && (
              <button
                onClick={() => handleClear(key)}
                className="text-xs text-text-3 hover:text-red-500 transition-colors ml-2"
                title="Clear this key"
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Key inputs */}
      <div className="space-y-4">
        <Field label="Anthropic API Key">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={anthropic}
            onChange={e => setAnthropic(e.target.value)}
            placeholder={status.anthropic_key_set ? '••••••••  (leave blank to keep existing)' : 'sk-ant-…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">Required for the COGS Assistant. Get your key at console.anthropic.com</p>
        </Field>

        <Field label="Voyage AI API Key">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={voyage}
            onChange={e => setVoyage(e.target.value)}
            placeholder={status.voyage_key_set ? '••••••••  (leave blank to keep existing)' : 'pa-…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">Optional — enables semantic search over COGS documentation. Falls back to keyword search if not set. Get your key at dash.voyageai.com</p>
        </Field>

        <Field label="Brave Search API Key">
          <input
            type="password"
            className="input w-full font-mono text-sm"
            value={brave}
            onChange={e => setBrave(e.target.value)}
            placeholder={status.brave_key_set ? '••••••••  (leave blank to keep existing)' : 'BSA…'}
            autoComplete="off"
          />
          <p className="text-xs text-text-3 mt-1">Optional — enables full web search for the COGS Assistant. Falls back to DuckDuckGo instant answers if not set. Get your key at brave.com/search/api (free tier: 2,000 queries/month)</p>
        </Field>
      </div>

      <div className="flex justify-end pt-4">
        <button
          className="btn-primary px-5 py-2 text-sm"
          onClick={handleSave}
          disabled={saving || (!anthropic.trim() && !voyage.trim() && !brave.trim())}
        >
          {saving ? 'Saving…' : 'Save Keys'}
        </button>
      </div>

      {/* ── Response behaviour ── */}
      <div className="mt-8 pt-6 border-t border-border">
        <h2 className="text-base font-bold text-text-1 mb-1">Response Behaviour</h2>
        <p className="text-sm text-text-3 mb-4">Controls how McFry formats its replies.</p>

        <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-2/50 px-4 py-3.5">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-text-1">Concise mode</div>
            <div className="text-xs text-text-3 mt-0.5">
              McFry gives direct answers without narrating its investigation steps ("Let me check…", "I'll look that up…"). Tool calls happen silently — only the result is shown.
            </div>
          </div>
          <button
            role="switch"
            aria-checked={conciseMode}
            disabled={savingMode}
            onClick={() => handleToggleConciseMode(!conciseMode)}
            className={`relative flex-shrink-0 mt-0.5 w-10 h-5.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50 ${
              conciseMode ? 'bg-accent' : 'bg-border'
            } ${savingMode ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            style={{ height: '22px', width: '40px' }}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform ${
                conciseMode ? 'translate-x-[18px]' : 'translate-x-0'
              }`}
            />
          </button>
        </div>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}
