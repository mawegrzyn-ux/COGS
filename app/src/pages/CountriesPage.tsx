import { useState, useCallback, useMemo, useEffect } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Country {
  id: number
  name: string
  currency_code: string
  currency_symbol: string
  exchange_rate: string
  default_price_level_id: number | null
}

interface TaxRate {
  id: number
  country_id: number
  name: string
  rate: string
  is_default: boolean
}

interface PriceLevel {
  id: number
  name: string
}

interface CountryLevelTax {
  id: number
  country_id: number
  price_level_id: number
  tax_rate_id: number
}

interface ToastState { message: string; type: 'success' | 'error' }

const blankCountry = { name: '', currency_code: '', currency_symbol: '', exchange_rate: '' }
const blankTax     = { name: '', rate: '' }

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CountriesPage() {
  const api = useApi()

  const [countries,       setCountries]       = useState<Country[]>([])
  const [taxRates,        setTaxRates]        = useState<TaxRate[]>([])
  const [priceLevels,     setPriceLevels]     = useState<PriceLevel[]>([])
  const [levelTax,        setLevelTax]        = useState<CountryLevelTax[]>([])
  const [baseCurrency,    setBaseCurrency]    = useState('USD')
  const [loading,         setLoading]         = useState(true)
  const [search,          setSearch]          = useState('')
  const [toast,           setToast]           = useState<ToastState | null>(null)

  const [countryModal,    setCountryModal]    = useState(false)
  const [editingCountry,  setEditingCountry]  = useState<Country | null>(null)
  const [countryForm,     setCountryForm]     = useState(blankCountry)
  const [countryErrors,   setCountryErrors]   = useState<Partial<typeof blankCountry>>({})
  const [countrySaving,   setCountrySaving]   = useState(false)

  const [taxModal,        setTaxModal]        = useState(false)
  const [editingTax,      setEditingTax]      = useState<TaxRate | null>(null)
  const [taxCountryId,    setTaxCountryId]    = useState<number | null>(null)
  const [taxForm,         setTaxForm]         = useState(blankTax)
  const [taxErrors,       setTaxErrors]       = useState<Partial<typeof blankTax>>({})
  const [taxSaving,       setTaxSaving]       = useState(false)

  const [confirmDelete,   setConfirmDelete]   = useState<{ type: 'country' | 'tax'; id: number } | null>(null)

  // ── Load ──────────────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [c, t, pl, clt, settings] = await Promise.all([
        api.get('/countries'),
        api.get('/tax-rates'),
        api.get('/price-levels'),
        api.get('/country-level-tax'),
        api.get('/settings').catch(() => ({})),
      ])
      setCountries(c   || [])
      setTaxRates(t    || [])
      setPriceLevels(pl || [])
      setLevelTax(clt  || [])
      setBaseCurrency((settings as any)?.base_currency || 'USD')
    } catch {
      showToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const filtered = useMemo(() =>
    countries.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.currency_code.toLowerCase().includes(search.toLowerCase())
    ), [countries, search]
  )

  const uniqueCurrencies = useMemo(() =>
    new Set(countries.map(c => c.currency_code)).size, [countries]
  )

  // ── Country CRUD ──────────────────────────────────────────────────────────────

  function openAddCountry() {
    setEditingCountry(null)
    setCountryForm(blankCountry)
    setCountryErrors({})
    setCountryModal(true)
  }

  function openEditCountry(c: Country) {
    setEditingCountry(c)
    setCountryForm({
      name:            c.name,
      currency_code:   c.currency_code,
      currency_symbol: c.currency_symbol,
      exchange_rate:   c.exchange_rate,
    })
    setCountryErrors({})
    setCountryModal(true)
  }

  function validateCountry() {
    const e: Partial<typeof blankCountry> = {}
    if (!countryForm.name.trim())            e.name            = 'Required'
    if (!countryForm.currency_code.trim())   e.currency_code   = 'Required'
    if (!countryForm.currency_symbol.trim()) e.currency_symbol = 'Required'
    if (!countryForm.exchange_rate)          e.exchange_rate   = 'Required'
    else if (isNaN(Number(countryForm.exchange_rate)) || Number(countryForm.exchange_rate) <= 0)
      e.exchange_rate = 'Must be a positive number'
    setCountryErrors(e)
    return Object.keys(e).length === 0
  }

  async function submitCountry() {
    if (!validateCountry()) return
    setCountrySaving(true)
    try {
      const payload = {
        ...countryForm,
        currency_code: countryForm.currency_code.toUpperCase(),
        exchange_rate: Number(countryForm.exchange_rate),
      }
      if (editingCountry) {
        await api.put(`/countries/${editingCountry.id}`, payload)
        showToast('Country updated')
      } else {
        await api.post('/countries', payload)
        showToast('Country added')
      }
      setCountryModal(false)
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setCountrySaving(false)
    }
  }

  async function deleteCountry(id: number) {
    try {
      await api.delete(`/countries/${id}`)
      showToast('Country deleted')
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Default price level ───────────────────────────────────────────────────────

  async function setDefaultPriceLevel(countryId: number, priceLevelId: number | null) {
    try {
      await api.patch(`/countries/${countryId}`, { default_price_level_id: priceLevelId })
      setCountries(prev => prev.map(c =>
        c.id === countryId ? { ...c, default_price_level_id: priceLevelId } : c
      ))
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Tax CRUD ──────────────────────────────────────────────────────────────────

  function openAddTax(countryId: number) {
    setEditingTax(null)
    setTaxCountryId(countryId)
    setTaxForm(blankTax)
    setTaxErrors({})
    setTaxModal(true)
  }

  function openEditTax(t: TaxRate) {
    setEditingTax(t)
    setTaxCountryId(t.country_id)
    setTaxForm({ name: t.name, rate: String(Number(t.rate) * 100) })
    setTaxErrors({})
    setTaxModal(true)
  }

  function validateTax() {
    const e: Partial<typeof blankTax> = {}
    if (!taxForm.name.trim()) e.name = 'Required'
    if (!taxForm.rate)        e.rate = 'Required'
    else if (isNaN(Number(taxForm.rate)) || Number(taxForm.rate) < 0)
      e.rate = 'Must be 0 or greater'
    setTaxErrors(e)
    return Object.keys(e).length === 0
  }

  async function submitTax() {
    if (!validateTax()) return
    setTaxSaving(true)
    try {
      const payload = {
        name:       taxForm.name.trim(),
        rate:       Number(taxForm.rate) / 100,
        country_id: taxCountryId,
      }
      if (editingTax) {
        await api.put(`/tax-rates/${editingTax.id}`, payload)
        showToast('Tax rate updated')
      } else {
        await api.post('/tax-rates', payload)
        showToast('Tax rate added')
      }
      setTaxModal(false)
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setTaxSaving(false)
    }
  }

  async function deleteTax(id: number) {
    try {
      await api.delete(`/tax-rates/${id}`)
      showToast('Tax rate deleted')
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  async function setDefaultTax(taxId: number, countryId: number) {
    try {
      await api.patch(`/tax-rates/${taxId}/set-default`, { country_id: countryId })
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Level tax mapping ─────────────────────────────────────────────────────────

  async function setLevelTaxMapping(countryId: number, priceLevelId: number, taxRateId: number | null) {
    try {
      await api.post('/country-level-tax', {
        country_id:     countryId,
        price_level_id: priceLevelId,
        tax_rate_id:    taxRateId,
      })
      setLevelTax(prev => {
        const without = prev.filter(r => !(r.country_id === countryId && r.price_level_id === priceLevelId))
        if (!taxRateId) return without
        return [...without, { id: Date.now(), country_id: countryId, price_level_id: priceLevelId, tax_rate_id: taxRateId }]
      })
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  function handleConfirmDelete() {
    if (!confirmDelete) return
    if (confirmDelete.type === 'country') deleteCountry(confirmDelete.id)
    else                                  deleteTax(confirmDelete.id)
    setConfirmDelete(null)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Countries & Currencies"
        subtitle="Register franchise markets with their local currency and exchange rate."
        action={
          <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAddCountry}>
            <PlusIcon /> Add Country
          </button>
        }
      />

      {/* KPI strip */}
      <div className="flex gap-4 px-6 py-4 border-b border-border bg-surface">
        <KpiCard label="Markets"       value={countries.length} />
        <KpiCard label="Currencies"    value={uniqueCurrencies} />
        <KpiCard label="Base Currency" value={baseCurrency} />
      </div>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border bg-surface">
        <div className="relative max-w-sm">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
          <input
            type="search"
            placeholder="Search countries…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9 w-full"
          />
        </div>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <Spinner />
        ) : filtered.length === 0 ? (
          <EmptyState
            message={search ? 'No countries match your search.' : 'No countries yet. Add your first market to get started.'}
            action={!search
              ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAddCountry}>Add Country</button>
              : undefined
            }
          />
        ) : (
          <div className="grid gap-5 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
            {filtered.map(country => (
              <CountryCard
                key={country.id}
                country={country}
                taxRates={taxRates.filter(t => t.country_id === country.id)}
                priceLevels={priceLevels}
                levelTax={levelTax.filter(lt => lt.country_id === country.id)}
                baseCurrency={baseCurrency}
                onEdit={openEditCountry}
                onDelete={id => setConfirmDelete({ type: 'country', id })}
                onAddTax={openAddTax}
                onEditTax={openEditTax}
                onDeleteTax={id => setConfirmDelete({ type: 'tax', id })}
                onSetDefaultTax={setDefaultTax}
                onSetDefaultPriceLevel={setDefaultPriceLevel}
                onSetLevelTax={setLevelTaxMapping}
              />
            ))}
          </div>
        )}
      </div>

      {/* Country Modal */}
      {countryModal && (
        <Modal
          title={editingCountry ? 'Edit Country' : 'Add Country'}
          onClose={() => setCountryModal(false)}
        >
          <Field label="Country / Market Name" required error={countryErrors.name}>
            <input
              className="input w-full"
              value={countryForm.name}
              onChange={e => setCountryForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. United Kingdom"
              autoFocus
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Currency Code" required error={countryErrors.currency_code}>
              <input
                className="input w-full"
                value={countryForm.currency_code}
                onChange={e => setCountryForm(f => ({ ...f, currency_code: e.target.value.toUpperCase() }))}
                placeholder="e.g. GBP"
                maxLength={10}
              />
              <p className="text-xs text-text-3 mt-1">ISO 4217 (USD, GBP, EUR…)</p>
            </Field>
            <Field label="Currency Symbol" required error={countryErrors.currency_symbol}>
              <input
                className="input w-full"
                value={countryForm.currency_symbol}
                onChange={e => setCountryForm(f => ({ ...f, currency_symbol: e.target.value }))}
                placeholder="e.g. £"
                maxLength={10}
              />
            </Field>
          </div>
          <Field label={`Exchange Rate (1 ${baseCurrency} = X local)`} required error={countryErrors.exchange_rate}>
            <input
              className="input w-full"
              type="number"
              step="0.000001"
              min="0.000001"
              value={countryForm.exchange_rate}
              onChange={e => setCountryForm(f => ({ ...f, exchange_rate: e.target.value }))}
              placeholder="e.g. 0.79"
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setCountryModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitCountry} disabled={countrySaving}>
              {countrySaving ? 'Saving…' : 'Save Country'}
            </button>
          </div>
        </Modal>
      )}

      {/* Tax Modal */}
      {taxModal && (
        <Modal
          title={editingTax ? 'Edit Tax Rate' : 'Add Tax Rate'}
          onClose={() => setTaxModal(false)}
          width="max-w-sm"
        >
          <Field label="Name" required error={taxErrors.name}>
            <input
              className="input w-full"
              value={taxForm.name}
              onChange={e => setTaxForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Standard VAT"
              autoFocus
            />
          </Field>
          <Field label="Rate (%)" required error={taxErrors.rate}>
            <input
              className="input w-full"
              type="number"
              step="0.01"
              min="0"
              value={taxForm.rate}
              onChange={e => setTaxForm(f => ({ ...f, rate: e.target.value }))}
              placeholder="e.g. 20"
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setTaxModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitTax} disabled={taxSaving}>
              {taxSaving ? 'Saving…' : 'Save Tax Rate'}
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={
            confirmDelete.type === 'country'
              ? 'Delete this country? All its tax rates and level-tax mappings will also be removed.'
              : 'Delete this tax rate?'
          }
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Country Card ──────────────────────────────────────────────────────────────

interface CountryCardProps {
  country:                Country
  taxRates:               TaxRate[]
  priceLevels:            PriceLevel[]
  levelTax:               CountryLevelTax[]
  baseCurrency:           string
  onEdit:                 (c: Country) => void
  onDelete:               (id: number) => void
  onAddTax:               (countryId: number) => void
  onEditTax:              (t: TaxRate) => void
  onDeleteTax:            (id: number) => void
  onSetDefaultTax:        (taxId: number, countryId: number) => void
  onSetDefaultPriceLevel: (countryId: number, priceLevelId: number | null) => void
  onSetLevelTax:          (countryId: number, priceLevelId: number, taxRateId: number | null) => void
}

function CountryCard({
  country, taxRates, priceLevels, levelTax, baseCurrency,
  onEdit, onDelete, onAddTax, onEditTax, onDeleteTax, onSetDefaultTax,
  onSetDefaultPriceLevel, onSetLevelTax,
}: CountryCardProps) {
  const initials = country.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const rate = Number(country.exchange_rate)
  const defaultPriceLevelName = country.default_price_level_id
    ? priceLevels.find(p => p.id === country.default_price_level_id)?.name
    : null

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">

      {/* Name + currency code */}
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <div className="w-10 h-10 rounded-lg bg-accent-dim flex items-center justify-center text-accent font-bold text-sm shrink-0">
          {initials}
        </div>
        <div>
          <div className="font-extrabold text-text-1 text-base tracking-wide uppercase">
            {country.name}
          </div>
          <div className="text-xs text-text-3 font-medium mt-0.5">{country.currency_code}</div>
        </div>
      </div>

      {/* Three stat boxes */}
      <div className="grid grid-cols-3 gap-2 px-5 pb-4">
        <StatBox label="Symbol" value={country.currency_symbol} />
        <StatBox label="Rate"   value={rate.toFixed(4)} mono />
        <StatBox
          label={`1 ${baseCurrency}`}
          value={`= ${rate.toFixed(6)}`}
          sub={country.currency_code}
          mono
        />
      </div>

      {/* Edit / Delete — full width row */}
      <div className="flex gap-2 px-5 pb-5">
        <button
          className="btn-outline flex-1 py-2 text-sm flex items-center justify-center gap-2"
          onClick={() => onEdit(country)}
        >
          <EditIcon size={13} /> Edit
        </button>
        <button
          className="flex-1 py-2 text-sm flex items-center justify-center gap-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors font-semibold"
          onClick={() => onDelete(country.id)}
        >
          <TrashIcon size={13} /> Delete
        </button>
      </div>

      {/* Sections */}
      <div className="border-t border-border divide-y divide-border">

        {/* Default Price Level */}
        {priceLevels.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-text-3">
                ✕ Default Price Level
              </span>
              {defaultPriceLevelName && (
                <Badge label={defaultPriceLevelName} variant="green" />
              )}
            </div>
            <p className="text-xs text-text-3 mb-2.5 leading-relaxed">
              Used in dashboard and reports as the default price level for this market.
            </p>
            <select
              className="select w-full text-sm"
              value={country.default_price_level_id ?? ''}
              onChange={e => onSetDefaultPriceLevel(country.id, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— None (manual selection) —</option>
              {priceLevels.map(pl => (
                <option key={pl.id} value={pl.id}>{pl.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Tax Rates */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-text-3 flex items-center gap-1.5">
              Tax Rates <HelpIcon />
            </span>
            <button
              className="btn-ghost py-1 px-2 text-xs flex items-center gap-1 font-semibold"
              onClick={() => onAddTax(country.id)}
            >
              <PlusIcon size={11} /> Add
            </button>
          </div>

          {taxRates.length === 0 ? (
            <p className="text-xs text-text-3 italic">No tax rates yet.</p>
          ) : (
            <div className="space-y-2">
              {taxRates.map(t => (
                <div key={t.id} className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-1 w-20 shrink-0 leading-tight">
                    {t.name}
                  </span>
                  <span className="font-mono text-sm font-bold text-text-1 shrink-0">
                    {(Number(t.rate) * 100).toFixed(2)}%
                  </span>
                  <div className="flex-1">
                    {t.is_default
                      ? <Badge label="default" variant="green" />
                      : (
                        <button
                          className="text-xs text-text-3 hover:text-accent transition-colors"
                          onClick={() => onSetDefaultTax(t.id, country.id)}
                        >
                          Set default
                        </button>
                      )
                    }
                  </div>
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-3 hover:text-accent hover:border-accent transition-colors"
                    onClick={() => onEditTax(t)}
                    title="Edit"
                  >
                    <EditIcon size={12} />
                  </button>
                  <button
                    className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    onClick={() => onDeleteTax(t.id)}
                    title="Delete"
                  >
                    <TrashIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Default Tax per Price Level */}
        {priceLevels.length > 0 && taxRates.length > 0 && (
          <div className="px-5 py-4">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-text-3">
                Default Tax per Price Level
              </span>
              <HelpIcon title="Set which tax rate applies by default for each sales channel" />
            </div>
            <p className="text-xs text-text-3 mb-3 leading-relaxed">
              Set which tax rate applies by default for each sales channel in this country. Items inherit this unless overridden individually.
            </p>
            <div className="space-y-2.5">
              {priceLevels.map(pl => {
                const mapping = levelTax.find(lt => lt.price_level_id === pl.id)
                return (
                  <div key={pl.id} className="flex items-center gap-3">
                    <span className="text-sm font-bold text-text-2 w-24 shrink-0">{pl.name}</span>
                    <select
                      className="select flex-1 text-sm"
                      value={mapping?.tax_rate_id ?? ''}
                      onChange={e => onSetLevelTax(country.id, pl.id, e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">— Country default —</option>
                      {taxRates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({(Number(t.rate) * 100).toFixed(0)}%)
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Stat Box ──────────────────────────────────────────────────────────────────

function StatBox({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="border border-border rounded-lg px-2 py-3 text-center">
      <div className={`text-sm font-bold text-text-1 leading-tight ${mono ? 'font-mono' : ''}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-xs text-text-2 leading-tight">{sub}</div>}
      <div className="text-[10px] font-semibold uppercase tracking-wider text-text-3 mt-1.5">
        {label}
      </div>
    </div>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-2 rounded-lg px-5 py-3 min-w-[100px]">
      <div className="text-xs text-text-3 font-medium mb-1">{label}</div>
      <div className="text-xl font-extrabold text-text-1">{value}</div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function HelpIcon({ title }: { title?: string }) {
  return (
    <span
      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-border text-text-3 text-[10px] font-bold cursor-help shrink-0"
      title={title}
    >?</span>
  )
}

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
