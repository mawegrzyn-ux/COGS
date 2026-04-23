import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'
import { StoresTab } from './StockManagerPage'
import { WORLD_COUNTRIES, WorldCountry } from '../data/worldCountries'

// Re-export so the rest of this file's types can still reference them without
// further import churn. The 249-country catalog itself lives in ../data.
export type { WorldCountry }

// (The pre-feature inline WORLD_COUNTRIES array has been moved to
// app/src/data/worldCountries.ts so the picker can cover all 249 ISO 3166-1
// countries without bloating this page.)


function isoToFlag(iso: string | null | undefined): string {
  if (!iso || iso.length !== 2) return '🌐'
  return [...iso.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))).join('')
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Market {
  id: number
  name: string
  currency_code: string
  currency_symbol: string
  exchange_rate: string
  default_price_level_id: number | null
  country_iso: string | null
  brand_partner_id: number | null
  region_ids?: number[]              // mcogs_regions this market covers; empty = whole country
  cogs_threshold_excellent?:  string | number | null   // NUMERIC — pg returns string; NULL inherits global
  cogs_threshold_acceptable?: string | number | null
}

interface Region {
  id:          number
  country_iso: string               // ISO 3166-1 alpha-2 — decoupled from the markets table
  name:        string
  iso_code:    string | null        // ISO 3166-2 subdivision code
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

interface MarketLevelTax {
  id: number
  country_id: number
  price_level_id: number
  tax_rate_id: number
}

// Brand Partners = franchisees that operate markets (distinct from mcogs_vendors = ingredient suppliers)
interface BrandPartner {
  id: number
  name: string
  contact: string | null
  email: string | null
  phone: string | null
  notes: string | null
}

interface ToastData { message: string; type: 'success' | 'error' }

interface Location {
  id:            number
  name:          string
  country_id:    number | null
  group_id:      number | null
  address:       string | null
  email:         string | null
  phone:         string | null
  contact_name:  string | null
  contact_email: string | null
  contact_phone: string | null
  is_active:     boolean
  market_name:   string | null
  market_iso:    string | null
  group_name:    string | null
}

interface LocationGroup {
  id:             number
  name:           string
  description:    string | null
  location_count: number
}

// ── Blank forms ───────────────────────────────────────────────────────────────

const blankMarket   = { name: '', country_iso: '', currency_code: '', currency_symbol: '', exchange_rate: '' }
const blankTax      = { name: '', rate: '' }
const blankBP       = { name: '', contact: '', email: '', phone: '', notes: '' }
const blankLocation = { name: '', country_id: '', group_id: '', address: '', email: '', phone: '', contact_name: '', contact_email: '', contact_phone: '', is_active: 'true' }
const blankGroup    = { name: '', description: '' }

// ── CountryPicker ─────────────────────────────────────────────────────────────

interface CountryPickerProps {
  value: string | null
  onChange: (iso: string, wc: WorldCountry) => void
  error?: string
}

function CountryPicker({ value, onChange, error }: CountryPickerProps) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const [pos, setPos]       = useState({ top: 0, left: 0, width: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  const selected = useMemo(() => WORLD_COUNTRIES.find(c => c.iso === value) || null, [value])

  const filtered = useMemo(() =>
    WORLD_COUNTRIES.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.iso.toLowerCase().includes(search.toLowerCase()) ||
      c.currency_code.toLowerCase().includes(search.toLowerCase())
    ),
    [search]
  )

  function handleOpen() {
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) })
    }
    setSearch('')
    setOpen(true)
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        className={`input w-full text-left flex items-center gap-2.5 min-h-[38px] ${error ? 'border-red-400' : ''}`}
        onClick={handleOpen}
      >
        <span className="text-xl leading-none shrink-0">{isoToFlag(value)}</span>
        <span className={`flex-1 ${selected ? 'text-text-1' : 'text-text-3'}`}>
          {selected ? selected.name : 'Select country…'}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-text-3 shrink-0">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[99998]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[99999] bg-surface border border-border rounded-lg shadow-xl overflow-hidden flex flex-col"
            style={{ top: pos.top, left: pos.left, width: pos.width, maxHeight: 320 }}
          >
            <div className="p-2 border-b border-border shrink-0">
              <input
                autoFocus
                type="text"
                placeholder="Search countries…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input w-full text-sm"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-sm text-text-3 text-center">No countries found</div>
              ) : filtered.map(c => (
                <button
                  key={c.iso}
                  type="button"
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-surface-2 transition-colors
                    ${c.iso === value ? 'bg-accent-dim text-accent font-semibold' : 'text-text-1'}`}
                  onClick={() => { onChange(c.iso, c); setOpen(false) }}
                >
                  <span className="text-base leading-none shrink-0">{isoToFlag(c.iso)}</span>
                  <span className="flex-1">{c.name}</span>
                  <span className="text-xs text-text-3 font-mono">{c.currency_code}</span>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MarketsPage() {
  const api = useApi()
  const [activeTab, setActiveTab]   = useState<'Brand Partners' | 'Markets' | 'Regions' | 'Locations' | 'Centres'>('Brand Partners')
  const [markets,       setMarkets]       = useState<Market[]>([])
  const [taxRates,      setTaxRates]      = useState<TaxRate[]>([])
  const [priceLevels,   setPriceLevels]   = useState<PriceLevel[]>([])
  const [levelTax,      setLevelTax]      = useState<MarketLevelTax[]>([])
  const [brandPartners, setBrandPartners] = useState<BrandPartner[]>([])
  // Per-country price-level enablement map. Key = `${country_id}-${price_level_id}`,
  // value = is_enabled. Missing entry = enabled (preserves pre-feature behaviour).
  const [cplMatrix,     setCplMatrix]     = useState<Map<string, boolean>>(new Map())
  // Catalog of all sub-country regions, grouped by country_id. Loaded once;
  // regional markets pick from this list via multi-select in the create/edit modal.
  const [regions,       setRegions]       = useState<Region[]>([])
  // Region ids selected in the currently-open market modal (when creating /
  // editing a regional market). Reset every time the modal opens.
  const [marketRegionIds, setMarketRegionIds] = useState<number[]>([])
  const [baseCurrency,  setBaseCurrency]  = useState('USD')
  const [loading,       setLoading]       = useState(true)
  const [search,        setSearch]        = useState('')
  const [toast,         setToast]         = useState<ToastData | null>(null)

  // Market modal
  const [marketModal,      setMarketModal]      = useState(false)
  const [editingMarket,    setEditingMarket]    = useState<Market | null>(null)
  const [marketForm,       setMarketForm]       = useState(blankMarket)
  const [marketErrors,     setMarketErrors]     = useState<Partial<typeof blankMarket>>({})
  const [marketSubmitting, setMarketSubmitting] = useState(false)

  // Tax rate modal
  const [taxModal,      setTaxModal]      = useState(false)
  const [editingTax,    setEditingTax]    = useState<TaxRate | null>(null)
  const [taxMarketId,   setTaxMarketId]   = useState<number | null>(null)
  const [taxForm,       setTaxForm]       = useState(blankTax)
  const [taxErrors,     setTaxErrors]     = useState<Partial<typeof blankTax>>({})
  const [taxSubmitting, setTaxSubmitting] = useState(false)

  // Brand Partner modal
  const [bpModal,      setBpModal]      = useState(false)
  const [editingBP,    setEditingBP]    = useState<BrandPartner | null>(null)
  const [bpForm,       setBpForm]       = useState(blankBP)
  const [bpErrors,     setBpErrors]     = useState<Partial<typeof blankBP>>({})
  const [bpSubmitting, setBpSubmitting] = useState(false)

  // Locations state
  const [locations,       setLocations]       = useState<Location[]>([])
  const [locationGroups,  setLocationGroups]  = useState<LocationGroup[]>([])
  const [filterLocMkt,    setFilterLocMkt]    = useState('')
  const [filterLocGrp,    setFilterLocGrp]    = useState('')
  const [showLocInactive, setShowLocInactive] = useState(false)

  // Location modal
  const [locModal,  setLocModal]  = useState<Location | 'new' | null>(null)
  const [locForm,   setLocForm]   = useState(blankLocation)
  const [locSaving, setLocSaving] = useState(false)

  // Group modal
  const [grpModal,  setGrpModal]  = useState<LocationGroup | 'new' | null>(null)
  const [grpForm,   setGrpForm]   = useState(blankGroup)
  const [grpSaving, setGrpSaving] = useState(false)

  // Confirm delete
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'market' | 'tax' | 'bp' | 'location' | 'group'; id: number } | null>(null)

  // ── Load data ───────────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [c, t, pl, clt, v, settings, locs, grps, rgn] = await Promise.all([
        api.get('/countries'),
        api.get('/tax-rates'),
        api.get('/price-levels'),
        api.get('/country-level-tax'),
        api.get('/brand-partners'),
        api.get('/settings').catch(() => ({})),
        api.get('/locations'),
        api.get('/location-groups'),
        api.get('/regions').catch(() => []),   // tolerant of older servers
      ])
      setMarkets(c   || [])
      setTaxRates(t  || [])
      setPriceLevels(pl || [])
      setLevelTax(clt || [])
      setBrandPartners(v || [])
      const bc = (settings as any)?.base_currency
      setBaseCurrency(typeof bc === 'object' && bc !== null ? (bc.code || 'USD') : (bc || 'USD'))
      setLocations(locs  || [])
      setLocationGroups(grps || [])
      setRegions(rgn || [])

      // Load the per-country price-level enablement matrix. Non-fatal on
      // failure — the matrix falls back to "all enabled", which matches the
      // pre-feature behaviour and keeps this page working on older servers
      // that don't have the /country-price-levels endpoint yet.
      try {
        const cpl = await api.get('/country-price-levels') as Array<{ country_id: number; price_level_id: number; is_enabled: boolean }>
        const m = new Map<string, boolean>()
        ;(cpl || []).forEach(r => m.set(`${r.country_id}-${r.price_level_id}`, !!r.is_enabled))
        setCplMatrix(m)
      } catch { /* older server — leave the map empty so everything shows as enabled */ }
    } catch {
      showToast('Failed to load data', 'error')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { loadAll() }, [loadAll])

  // ── Helpers ─────────────────────────────────────────────────────────────────

  const showToast = (message: string, type: 'success' | 'error' = 'success') =>
    setToast({ message, type })

  const filteredMarkets = useMemo(() =>
    markets.filter(m =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.currency_code.toLowerCase().includes(search.toLowerCase())
    ),
    [markets, search]
  )

  const filteredBPs = useMemo(() =>
    brandPartners.filter(bp =>
      bp.name.toLowerCase().includes(search.toLowerCase()) ||
      (bp.email    || '').toLowerCase().includes(search.toLowerCase()) ||
      (bp.contact  || '').toLowerCase().includes(search.toLowerCase()) ||
      (bp.phone    || '').toLowerCase().includes(search.toLowerCase())
    ),
    [brandPartners, search]
  )

  const uniqueCurrencies = useMemo(() => new Set(markets.map(m => m.currency_code)).size, [markets])

  const filteredLocations = useMemo(() =>
    locations.filter(loc => {
      if (filterLocMkt && String(loc.country_id) !== filterLocMkt) return false
      if (filterLocGrp && String(loc.group_id)   !== filterLocGrp) return false
      if (!showLocInactive && !loc.is_active) return false
      return true
    }),
    [locations, filterLocMkt, filterLocGrp, showLocInactive]
  )

  // For each brand partner, which markets use it?
  const bpMarkets = useMemo(() => {
    const map: Record<number, Market[]> = {}
    for (const m of markets) {
      if (m.brand_partner_id != null) {
        if (!map[m.brand_partner_id]) map[m.brand_partner_id] = []
        map[m.brand_partner_id].push(m)
      }
    }
    return map
  }, [markets, brandPartners])

  // ── Location CRUD ───────────────────────────────────────────────────────────

  function openAddLoc() { setLocModal('new'); setLocForm(blankLocation) }
  function openEditLoc(loc: Location) {
    setLocModal(loc)
    setLocForm({
      name:          loc.name,
      country_id:    loc.country_id ? String(loc.country_id) : '',
      group_id:      loc.group_id   ? String(loc.group_id)   : '',
      address:       loc.address       || '',
      email:         loc.email         || '',
      phone:         loc.phone         || '',
      contact_name:  loc.contact_name  || '',
      contact_email: loc.contact_email || '',
      contact_phone: loc.contact_phone || '',
      is_active:     String(loc.is_active),
    })
  }

  async function submitLoc() {
    if (!locForm.name.trim()) return showToast('Name is required', 'error')
    setLocSaving(true)
    try {
      const payload = {
        name:          locForm.name.trim(),
        country_id:    locForm.country_id  ? Number(locForm.country_id)  : null,
        group_id:      locForm.group_id    ? Number(locForm.group_id)    : null,
        address:       locForm.address.trim()       || null,
        email:         locForm.email.trim()         || null,
        phone:         locForm.phone.trim()          || null,
        contact_name:  locForm.contact_name.trim()  || null,
        contact_email: locForm.contact_email.trim() || null,
        contact_phone: locForm.contact_phone.trim() || null,
        is_active:     locForm.is_active !== 'false',
      }
      if (locModal === 'new') {
        await api.post('/locations', payload)
        showToast('Location added')
      } else if (locModal) {
        await api.put(`/locations/${(locModal as Location).id}`, payload)
        showToast('Location updated')
      }
      setLocModal(null); loadAll()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setLocSaving(false) }
  }

  async function deleteLoc(id: number) {
    try {
      await api.delete(`/locations/${id}`)
      showToast('Location deleted'); loadAll()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error') }
  }

  // ── Group CRUD ──────────────────────────────────────────────────────────────

  function openAddGrp() { setGrpModal('new'); setGrpForm(blankGroup) }
  function openEditGrp(g: LocationGroup) {
    setGrpModal(g)
    setGrpForm({ name: g.name, description: g.description || '' })
  }

  async function submitGrp() {
    if (!grpForm.name.trim()) return showToast('Group name is required', 'error')
    setGrpSaving(true)
    try {
      const payload = { name: grpForm.name.trim(), description: grpForm.description.trim() || null }
      if (grpModal === 'new') {
        await api.post('/location-groups', payload); showToast('Group added')
      } else if (grpModal) {
        await api.put(`/location-groups/${(grpModal as LocationGroup).id}`, payload); showToast('Group updated')
      }
      setGrpModal(null); loadAll()
    } catch (err: any) { showToast(err.message || 'Save failed', 'error') }
    finally { setGrpSaving(false) }
  }

  async function deleteGrp(id: number) {
    try {
      await api.delete(`/location-groups/${id}`)
      showToast('Group deleted'); loadAll()
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error') }
  }

  // ── Market CRUD ─────────────────────────────────────────────────────────────

  function openAddMarket() {
    setEditingMarket(null)
    setMarketForm(blankMarket)
    setMarketRegionIds([])
    setMarketErrors({})
    setMarketModal(true)
  }

  function openEditMarket(m: Market) {
    setEditingMarket(m)
    setMarketForm({
      name:            m.name,
      country_iso:     m.country_iso || '',
      currency_code:   m.currency_code,
      currency_symbol: m.currency_symbol,
      exchange_rate:   m.exchange_rate,
    })
    setMarketRegionIds(Array.isArray(m.region_ids) ? m.region_ids.slice() : [])
    setMarketErrors({})
    setMarketModal(true)
  }

  function validateMarket() {
    const e: Partial<typeof blankMarket> = {}
    if (!marketForm.name.trim())            e.name            = 'Required'
    if (!marketForm.country_iso)            e.country_iso     = 'Required'
    if (!marketForm.currency_code.trim())   e.currency_code   = 'Required'
    if (!marketForm.currency_symbol.trim()) e.currency_symbol = 'Required'
    if (!marketForm.exchange_rate)          e.exchange_rate   = 'Required'
    else if (isNaN(Number(marketForm.exchange_rate)) || Number(marketForm.exchange_rate) <= 0)
      e.exchange_rate = 'Must be a positive number'
    setMarketErrors(e)
    return Object.keys(e).length === 0
  }

  async function submitMarket() {
    if (!validateMarket()) return
    setMarketSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        name:            marketForm.name.trim(),
        country_iso:     marketForm.country_iso || null,
        currency_code:   marketForm.currency_code.toUpperCase().trim(),
        currency_symbol: marketForm.currency_symbol.trim(),
        exchange_rate:   Number(marketForm.exchange_rate),
        // Empty array = market covers the whole country; populated = limited
        // to those specific regions. All regions must belong to country_iso
        // (server enforces).
        region_ids: marketRegionIds,
      }
      if (editingMarket) {
        await api.put(`/countries/${editingMarket.id}`, payload)
        showToast('Market updated')
      } else {
        await api.post('/countries', payload)
        showToast('Market added')
      }
      setMarketModal(false)
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setMarketSubmitting(false)
    }
  }

  async function deleteMarket(id: number) {
    try {
      await api.delete(`/countries/${id}`)
      showToast('Market deleted')
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  async function setDefaultPriceLevel(marketId: number, priceLevelId: number | null) {
    try {
      await api.patch(`/countries/${marketId}`, { default_price_level_id: priceLevelId })
      setMarkets(prev => prev.map(m =>
        m.id === marketId ? { ...m, default_price_level_id: priceLevelId } : m
      ))
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  async function setMarketBrandPartner(marketId: number, bpId: number | null) {
    try {
      await api.patch(`/countries/${marketId}`, { brand_partner_id: bpId })
      setMarkets(prev => prev.map(m =>
        m.id === marketId ? { ...m, brand_partner_id: bpId } : m
      ))
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Tax rate CRUD ───────────────────────────────────────────────────────────

  function openAddTax(marketId: number) {
    setEditingTax(null)
    setTaxMarketId(marketId)
    setTaxForm(blankTax)
    setTaxErrors({})
    setTaxModal(true)
  }

  function openEditTax(t: TaxRate) {
    setEditingTax(t)
    setTaxMarketId(t.country_id)
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
    setTaxSubmitting(true)
    try {
      const payload = { name: taxForm.name.trim(), rate: Number(taxForm.rate) / 100, country_id: taxMarketId }
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
      setTaxSubmitting(false)
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

  async function setDefaultTax(taxId: number, marketId: number) {
    try {
      await api.patch(`/tax-rates/${taxId}/set-default`, { country_id: marketId })
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  async function setLevelTaxMapping(marketId: number, priceLevelId: number, taxRateId: number | null) {
    try {
      await api.post('/country-level-tax', { country_id: marketId, price_level_id: priceLevelId, tax_rate_id: taxRateId })
      setLevelTax(prev => {
        const without = prev.filter(r => !(r.country_id === marketId && r.price_level_id === priceLevelId))
        if (!taxRateId) return without
        return [...without, { id: Date.now(), country_id: marketId, price_level_id: priceLevelId, tax_rate_id: taxRateId }]
      })
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  async function setLevelEnabled(marketId: number, priceLevelId: number, isEnabled: boolean) {
    const key = `${marketId}-${priceLevelId}`
    // Optimistic update — snapshot prev so we can revert on failure.
    const prev = cplMatrix
    setCplMatrix(m => {
      const next = new Map(m)
      next.set(key, isEnabled)
      return next
    })
    try {
      await api.put(`/country-price-levels/${marketId}/${priceLevelId}`, { is_enabled: isEnabled })
    } catch (err: any) {
      setCplMatrix(prev)
      showToast(err.message || 'Update failed', 'error')
    }
  }

  async function setMarketCogsThresholds(marketId: number, excellent: number | null, acceptable: number | null) {
    // Validate client-side so we don't bounce through the API for obvious mistakes.
    if (excellent != null && (excellent <= 0 || excellent >= 100)) {
      showToast('Excellent threshold must be between 0 and 100', 'error')
      return
    }
    if (acceptable != null && (acceptable <= 0 || acceptable >= 100)) {
      showToast('Acceptable threshold must be between 0 and 100', 'error')
      return
    }
    if (excellent != null && acceptable != null && excellent > acceptable) {
      showToast('Excellent threshold must be ≤ Acceptable threshold', 'error')
      return
    }
    try {
      const updated = await api.patch(`/countries/${marketId}`, {
        cogs_threshold_excellent:  excellent  == null ? '' : excellent,
        cogs_threshold_acceptable: acceptable == null ? '' : acceptable,
      })
      setMarkets(prev => prev.map(m => m.id === marketId ? { ...m, ...updated } : m))
      showToast('COGS thresholds updated')
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Brand Partner CRUD ──────────────────────────────────────────────────────

  function openAddBP() {
    setEditingBP(null)
    setBpForm(blankBP)
    setBpErrors({})
    setBpModal(true)
  }

  function openEditBP(bp: BrandPartner) {
    setEditingBP(bp)
    setBpForm({
      name:    bp.name,
      contact: bp.contact || '',
      email:   bp.email   || '',
      phone:   bp.phone   || '',
      notes:   bp.notes   || '',
    })
    setBpErrors({})
    setBpModal(true)
  }

  function validateBP() {
    const e: Partial<typeof blankBP> = {}
    if (!bpForm.name.trim()) e.name = 'Required'
    setBpErrors(e)
    return Object.keys(e).length === 0
  }

  async function submitBP() {
    if (!validateBP()) return
    setBpSubmitting(true)
    try {
      const payload = {
        name:    bpForm.name.trim(),
        contact: bpForm.contact.trim() || null,
        email:   bpForm.email.trim()   || null,
        phone:   bpForm.phone.trim()   || null,
        notes:   bpForm.notes.trim()   || null,
      }
      if (editingBP) {
        await api.put(`/brand-partners/${editingBP.id}`, payload)
        showToast('Brand Partner updated')
      } else {
        await api.post('/brand-partners', payload)
        showToast('Brand Partner added')
      }
      setBpModal(false)
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    } finally {
      setBpSubmitting(false)
    }
  }

  async function deleteBP(id: number) {
    try {
      await api.delete(`/brand-partners/${id}`)
      showToast('Brand Partner deleted')
      loadAll()
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Confirm delete handler ──────────────────────────────────────────────────

  function handleConfirmDelete() {
    if (!confirmDelete) return
    if (confirmDelete.type === 'market')       deleteMarket(confirmDelete.id)
    else if (confirmDelete.type === 'tax')      deleteTax(confirmDelete.id)
    else if (confirmDelete.type === 'bp')       deleteBP(confirmDelete.id)
    else if (confirmDelete.type === 'location') deleteLoc(confirmDelete.id)
    else if (confirmDelete.type === 'group')    deleteGrp(confirmDelete.id)
    setConfirmDelete(null)
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Location Structure"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1">
            <span>Manage franchise markets, local currencies, tax rates and brand partners.</span>
            {markets.length > 0 && (
              <span className="flex items-center gap-x-2 ml-2 text-text-3">
                <span><span className="font-semibold text-text-1">{markets.length}</span> markets</span>
                <span className="text-border select-none">·</span>
                <span><span className="font-semibold text-text-1">{uniqueCurrencies}</span> currencies</span>
                <span className="text-border select-none">·</span>
                <span>base <span className="font-semibold text-text-1">{baseCurrency}</span></span>
              </span>
            )}
          </span>
        }
        tutorialPrompt="What are Markets in COGS Manager and how do they connect to everything else? Explain countries, currencies, exchange rates, tax rates, brand partners, and locations — and how selecting a market drives vendor scoping and COGS calculations."
        action={
          activeTab === 'Markets' ? (
            <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAddMarket}>
              <PlusIcon /> Add Market
            </button>
          ) : activeTab === 'Brand Partners' ? (
            <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAddBP}>
              <PlusIcon /> Add Brand Partner
            </button>
          ) : (
            <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={openAddLoc}>
              <PlusIcon /> Add Location
            </button>
          )
        }
      />

      {/* Tab bar */}
      <div className="flex border-b border-border bg-surface px-6">
        {(['Brand Partners', 'Markets', 'Regions', 'Locations', 'Centres'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSearch('') }}
            className={`px-4 py-3 text-sm font-semibold border-b-2 transition-colors -mb-px
              ${activeTab === tab
                ? 'border-accent text-accent'
                : 'border-transparent text-text-2 hover:text-text-1'
              }`}
          >
            {tab}
            {tab === 'Markets' && markets.length > 0 && (
              <span className="ml-1.5 text-xs bg-surface-2 text-text-3 rounded-full px-1.5 py-0.5">{markets.length}</span>
            )}
            {tab === 'Brand Partners' && brandPartners.length > 0 && (
              <span className="ml-1.5 text-xs bg-surface-2 text-text-3 rounded-full px-1.5 py-0.5">{brandPartners.length}</span>
            )}
            {tab === 'Locations' && locations.length > 0 && (
              <span className="ml-1.5 text-xs bg-surface-2 text-text-3 rounded-full px-1.5 py-0.5">{locations.length}</span>
            )}
            {tab === 'Regions' && regions.length > 0 && (
              <span className="ml-1.5 text-xs bg-surface-2 text-text-3 rounded-full px-1.5 py-0.5">{regions.length}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Spinner /></div>
      ) : activeTab === 'Markets' ? (
        <>
          {/* Search */}
          <div className="px-6 py-3 border-b border-border bg-surface">
            <div className="relative max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                type="search"
                placeholder="Search markets…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-9 w-full"
              />
            </div>
          </div>

          {/* Market cards */}
          <div className="flex-1 overflow-y-auto p-6">
            {filteredMarkets.length === 0 ? (
              <EmptyState
                message={search ? 'No markets match your search.' : 'No markets yet. Add your first market to get started.'}
                action={!search ? (
                  <button className="btn-primary px-4 py-2 text-sm" onClick={openAddMarket}>Add Market</button>
                ) : undefined}
              />
            ) : (
              <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
                {filteredMarkets.map(market => (
                  <MarketCard
                    key={market.id}
                    market={market}
                    taxRates={taxRates.filter(t => t.country_id === market.id)}
                    priceLevels={priceLevels}
                    levelTax={levelTax.filter(lt => lt.country_id === market.id)}
                    cplMatrix={cplMatrix}
                    regions={regions}
                    brandPartners={brandPartners}
                    baseCurrency={baseCurrency}
                    onEdit={openEditMarket}
                    onDelete={id => setConfirmDelete({ type: 'market', id })}
                    onAddTax={openAddTax}
                    onEditTax={openEditTax}
                    onDeleteTax={id => setConfirmDelete({ type: 'tax', id })}
                    onSetDefaultTax={setDefaultTax}
                    onSetDefaultPriceLevel={setDefaultPriceLevel}
                    onSetLevelTax={setLevelTaxMapping}
                    onSetLevelEnabled={setLevelEnabled}
                    onSetCogsThresholds={setMarketCogsThresholds}
                    onSetBrandPartner={setMarketBrandPartner}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : activeTab === 'Brand Partners' ? (
        /* ── Brand Partners tab ── */
        <>
          <div className="px-6 py-3 border-b border-border bg-surface">
            <div className="relative max-w-sm">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                type="search"
                placeholder="Search brand partners…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="input pl-9 w-full"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredBPs.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  message={search ? 'No brand partners match your search.' : 'No brand partners yet. Add your first brand partner.'}
                  action={!search ? (
                    <button className="btn-primary px-4 py-2 text-sm" onClick={openAddBP}>Add Brand Partner</button>
                  ) : undefined}
                />
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-200 border-b border-gray-300">
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-3">Name</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-3">Markets Covered</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-3">Contact</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-3">Email</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-3">Phone</th>
                    <th className="px-4 py-3 w-20"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredBPs.map(bp => {
                    const covered = bpMarkets[bp.id] || []
                    return (
                      <tr key={bp.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-medium text-text-1">{bp.name}</td>
                        <td className="px-4 py-3">
                          {covered.length === 0 ? (
                            <span className="text-text-3 text-xs">Not assigned</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {covered.map(m => (
                                <span
                                  key={m.id}
                                  className="inline-flex items-center gap-1 text-xs bg-accent-dim text-accent rounded-full px-2 py-0.5 font-medium"
                                >
                                  <span className="leading-none">{isoToFlag(m.country_iso)}</span>
                                  {m.name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-text-2">{bp.contact || <span className="text-text-3">—</span>}</td>
                        <td className="px-4 py-3 text-text-2">
                          {bp.email
                            ? <a href={`mailto:${bp.email}`} className="text-accent hover:underline">{bp.email}</a>
                            : <span className="text-text-3">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-text-2">{bp.phone || <span className="text-text-3">—</span>}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              className="p-1.5 text-text-3 hover:text-text-1 hover:bg-surface-2 rounded transition-colors"
                              onClick={() => openEditBP(bp)}
                              title="Edit"
                            >
                              <EditIcon size={14} />
                            </button>
                            <button
                              className="p-1.5 text-text-3 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                              onClick={() => setConfirmDelete({ type: 'bp', id: bp.id })}
                              title="Delete"
                            >
                              <TrashIcon size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : activeTab === 'Locations' ? (
        /* ── Locations tab — 2-panel layout ── */
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex gap-6 items-start">

            {/* ── LEFT: Locations table ── */}
            <div className="flex-1 min-w-0">
              {/* Filter bar */}
              <div className="flex gap-3 mb-4 flex-wrap items-center">
                <select
                  className="select text-sm"
                  value={filterLocMkt}
                  onChange={e => setFilterLocMkt(e.target.value)}
                >
                  <option value="">All Markets</option>
                  {markets.map(m => (
                    <option key={m.id} value={m.id}>
                      {isoToFlag(m.country_iso)} {m.name}
                    </option>
                  ))}
                </select>

                <select
                  className="select text-sm"
                  value={filterLocGrp}
                  onChange={e => setFilterLocGrp(e.target.value)}
                >
                  <option value="">All Groups</option>
                  {locationGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>

                <label className="flex items-center gap-2 text-sm text-text-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showLocInactive}
                    onChange={e => setShowLocInactive(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  Show inactive
                </label>
              </div>

              {filteredLocations.length === 0 ? (
                <EmptyState
                  message={locations.length === 0 ? 'No locations yet.' : 'No locations match the current filters.'}
                  action={locations.length === 0
                    ? <button className="btn-primary px-4 py-2 text-sm" onClick={openAddLoc}>Add Location</button>
                    : undefined}
                />
              ) : (
                <div className="bg-surface border border-border rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-200 border-b border-gray-300">
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Location</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Market</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Group</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Address</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Contact</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-text-2">Status</th>
                        <th className="w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLocations.map(loc => (
                        <tr key={loc.id} className={`border-b border-border last:border-0 hover:bg-surface-2 transition-colors ${!loc.is_active ? 'opacity-60' : ''}`}>
                          <td className="px-4 py-3">
                            <div className="font-semibold text-text-1">{loc.name}</div>
                            {loc.email && <div className="text-xs text-text-3">{loc.email}</div>}
                            {loc.phone && !loc.email && <div className="text-xs text-text-3">{loc.phone}</div>}
                          </td>
                          <td className="px-4 py-3">
                            {loc.market_name ? (
                              <span className="flex items-center gap-1.5 text-text-2 text-xs">
                                <span className="text-base leading-none">{isoToFlag(loc.market_iso)}</span>
                                <span>{loc.market_name}</span>
                              </span>
                            ) : <span className="text-text-3">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {loc.group_name
                              ? <span className="text-xs font-semibold bg-accent-dim text-accent px-2 py-0.5 rounded-full">{loc.group_name}</span>
                              : <span className="text-text-3">—</span>}
                          </td>
                          <td className="px-4 py-3 text-text-2 max-w-[140px]">
                            {loc.address
                              ? <span className="text-xs leading-snug line-clamp-2">{loc.address}</span>
                              : <span className="text-text-3">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {loc.contact_name ? (
                              <div>
                                <div className="text-text-1 font-medium text-xs">{loc.contact_name}</div>
                                {loc.contact_email && <div className="text-xs text-text-3">{loc.contact_email}</div>}
                                {loc.contact_phone && <div className="text-xs text-text-3">{loc.contact_phone}</div>}
                              </div>
                            ) : <span className="text-text-3">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${loc.is_active ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3 border border-border'}`}>
                              {loc.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex gap-1.5 justify-end">
                              <button
                                className="w-7 h-7 flex items-center justify-center rounded border border-border text-text-3 hover:border-accent hover:text-accent transition-colors"
                                onClick={() => openEditLoc(loc)}
                                title="Edit"
                              >
                                <EditIcon size={12} />
                              </button>
                              <button
                                className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                                onClick={() => setConfirmDelete({ type: 'location', id: loc.id })}
                                title="Delete"
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
            </div>

            {/* ── RIGHT: Groups panel ── */}
            <div className="w-72 shrink-0">
              <div className="bg-surface border border-border rounded-xl overflow-hidden">
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface-2">
                  <div>
                    <div className="text-xs font-bold text-text-1 uppercase tracking-wide">Groups</div>
                    <div className="text-xs text-text-3 mt-0.5">Cluster by city or region</div>
                  </div>
                  <button
                    className="btn-ghost px-2.5 py-1.5 text-xs flex items-center gap-1"
                    onClick={openAddGrp}
                  >
                    <PlusIcon size={12} /> Add
                  </button>
                </div>

                {locationGroups.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-text-3 italic">No groups yet.</div>
                ) : (
                  <div className="divide-y divide-border">
                    {locationGroups.map(g => (
                      <div key={g.id} className="flex items-center gap-2 px-4 py-3 hover:bg-surface-2 transition-colors group">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-text-1 truncate">{g.name}</div>
                          {g.description && (
                            <div className="text-xs text-text-3 truncate mt-0.5">{g.description}</div>
                          )}
                        </div>
                        <span className="text-xs font-bold bg-accent-dim text-accent px-1.5 py-0.5 rounded-full shrink-0">
                          {g.location_count}
                        </span>
                        <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded border border-border text-text-3 hover:border-accent hover:text-accent transition-colors"
                            onClick={() => openEditGrp(g)}
                            title="Edit"
                          >
                            <EditIcon size={11} />
                          </button>
                          <button
                            className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                            onClick={() => setConfirmDelete({ type: 'group', id: g.id })}
                            title="Delete"
                          >
                            <TrashIcon size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

          </div>
        </div>
      ) : activeTab === 'Regions' ? (
        /* ── Regions tab ── */
        <RegionsPanel
          api={api}
          markets={markets}
          regions={regions}
          onRefresh={loadAll}
          showToast={showToast}
        />
      ) : (
        /* ── Centres tab ── */
        <CentresPanel api={api} locations={locations} onRefresh={loadAll} />
      )}

      {/* ── Modals ── */}

      {/* Market Modal */}
      {marketModal && (
        <Modal
          title={editingMarket ? 'Edit Market' : 'Add Market'}
          onClose={() => setMarketModal(false)}
        >
          <Field label="Market Name" required error={marketErrors.name}>
            <input
              className="input w-full"
              value={marketForm.name}
              onChange={e => setMarketForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. United Kingdom, Germany North…"
              autoFocus
            />
          </Field>

          <Field label="Country" required error={marketErrors.country_iso}>
            <CountryPicker
              value={marketForm.country_iso || null}
              onChange={(iso, wc) => {
                setMarketForm(f => ({
                  ...f,
                  country_iso:     iso,
                  currency_code:   wc.currency_code,
                  currency_symbol: wc.currency_symbol,
                }))
                // Wipe region selection — they belong to the previous country.
                setMarketRegionIds([])
              }}
              error={marketErrors.country_iso}
            />
            <p className="text-xs text-text-3 mt-1">Links this market to a real country. Region scope below is limited to this country — a market can never span multiple countries. Currency fields are auto-filled but editable.</p>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Currency Code" required error={marketErrors.currency_code}>
              <input
                className="input w-full uppercase"
                value={marketForm.currency_code}
                onChange={e => setMarketForm(f => ({ ...f, currency_code: e.target.value.toUpperCase() }))}
                placeholder="e.g. GBP"
                maxLength={10}
              />
              <p className="text-xs text-text-3 mt-1">ISO 4217 (USD, GBP, EUR…)</p>
            </Field>
            <Field label="Currency Symbol" required error={marketErrors.currency_symbol}>
              <input
                className="input w-full"
                value={marketForm.currency_symbol}
                onChange={e => setMarketForm(f => ({ ...f, currency_symbol: e.target.value }))}
                placeholder="e.g. £"
                maxLength={10}
              />
            </Field>
          </div>

          <Field label={`Exchange Rate (1 ${baseCurrency} = X local)`} required error={marketErrors.exchange_rate}>
            <input
              className="input w-full"
              type="number"
              step="0.000001"
              min="0.000001"
              value={marketForm.exchange_rate}
              onChange={e => setMarketForm(f => ({ ...f, exchange_rate: e.target.value }))}
              placeholder="e.g. 0.79"
            />
          </Field>

          {/* Optional region scope. A market can cover the whole country
              (leave all boxes unticked) or be limited to specific regions
              within that country. A market can never span multiple countries —
              the server enforces this. */}
          {marketForm.country_iso && (() => {
            const iso = marketForm.country_iso.toUpperCase()
            const availableRegions = regions.filter(r => (r.country_iso || '').toUpperCase() === iso)
            return (
              <Field label="Regions within this country (optional)">
                {availableRegions.length === 0 ? (
                  <div className="text-xs text-text-3 p-3 bg-surface-2 rounded border border-border">
                    No regions catalogued for <span className="font-mono">{iso}</span> yet. Add some in <strong>Configuration → Location Structure → Regions</strong>, or leave this empty and the market will cover the whole country.
                  </div>
                ) : (
                  <div className="border border-border rounded p-2 max-h-56 overflow-y-auto bg-surface">
                    {availableRegions.map(r => {
                      const checked = marketRegionIds.includes(r.id)
                      return (
                        <label key={r.id} className="flex items-center gap-2 py-1 px-1 cursor-pointer hover:bg-surface-2 rounded">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e => {
                              setMarketRegionIds(prev =>
                                e.target.checked
                                  ? [...prev, r.id]
                                  : prev.filter(id => id !== r.id)
                              )
                            }}
                            className="w-4 h-4 accent-accent"
                          />
                          <span className="text-sm text-text-2">{r.name}</span>
                          {r.iso_code && <span className="text-xs text-text-3 ml-auto font-mono">{r.iso_code}</span>}
                        </label>
                      )
                    })}
                  </div>
                )}
                <p className="text-xs text-text-3 mt-1">
                  Leave unticked for country-wide coverage. Ticking any region limits this market to that subset. Multiple markets can claim the same region.
                </p>
              </Field>
            )
          })()}

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setMarketModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitMarket} disabled={marketSubmitting}>
              {marketSubmitting ? 'Saving…' : 'Save Market'}
            </button>
          </div>
        </Modal>
      )}

      {/* Tax Rate Modal */}
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
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitTax} disabled={taxSubmitting}>
              {taxSubmitting ? 'Saving…' : 'Save Tax Rate'}
            </button>
          </div>
        </Modal>
      )}

      {/* Brand Partner Modal */}
      {bpModal && (
        <Modal
          title={editingBP ? 'Edit Brand Partner' : 'Add Brand Partner'}
          onClose={() => setBpModal(false)}
        >
          <Field label="Business Name" required error={bpErrors.name}>
            <input
              className="input w-full"
              value={bpForm.name}
              onChange={e => setBpForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. UK Franchise Holdings Ltd"
              autoFocus
            />
            <p className="text-xs text-text-3 mt-1">Brand partners can be assigned to one or more markets from the Markets tab.</p>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Contact Name">
              <input
                className="input w-full"
                value={bpForm.contact}
                onChange={e => setBpForm(f => ({ ...f, contact: e.target.value }))}
                placeholder="e.g. Jane Smith"
              />
            </Field>
            <Field label="Phone">
              <input
                className="input w-full"
                type="tel"
                value={bpForm.phone}
                onChange={e => setBpForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. +44 20 7946 0958"
              />
            </Field>
          </div>

          <Field label="Email">
            <input
              className="input w-full"
              type="email"
              value={bpForm.email}
              onChange={e => setBpForm(f => ({ ...f, email: e.target.value }))}
              placeholder="e.g. contact@partner.com"
            />
          </Field>

          <Field label="Notes">
            <textarea
              className="input w-full resize-none"
              rows={3}
              value={bpForm.notes}
              onChange={e => setBpForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Any additional notes…"
            />
          </Field>

          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setBpModal(false)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitBP} disabled={bpSubmitting}>
              {bpSubmitting ? 'Saving…' : 'Save Brand Partner'}
            </button>
          </div>
        </Modal>
      )}

      {/* Location Modal */}
      {locModal !== null && (
        <Modal
          title={locModal === 'new' ? 'Add Location' : `Edit: ${(locModal as Location).name}`}
          onClose={() => setLocModal(null)}
          width="max-w-2xl"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location Name" required>
              <input
                className="input w-full"
                value={locForm.name}
                onChange={e => setLocForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. King Street Store"
                autoFocus
              />
            </Field>
            <Field label="Status">
              <select className="select w-full" value={locForm.is_active} onChange={e => setLocForm(f => ({ ...f, is_active: e.target.value }))}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Market">
              <select className="select w-full" value={locForm.country_id} onChange={e => setLocForm(f => ({ ...f, country_id: e.target.value }))}>
                <option value="">— No market —</option>
                {markets.map(m => (
                  <option key={m.id} value={m.id}>{isoToFlag(m.country_iso)} {m.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Group">
              <select className="select w-full" value={locForm.group_id} onChange={e => setLocForm(f => ({ ...f, group_id: e.target.value }))}>
                <option value="">— No group —</option>
                {locationGroups.map(g => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Address">
            <textarea
              className="input w-full"
              rows={3}
              value={locForm.address}
              onChange={e => setLocForm(f => ({ ...f, address: e.target.value }))}
              placeholder="Street, city, postcode"
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Location Email">
              <input className="input w-full" type="email" value={locForm.email} onChange={e => setLocForm(f => ({ ...f, email: e.target.value }))} placeholder="store@brand.com" />
            </Field>
            <Field label="Location Phone">
              <input className="input w-full" type="tel" value={locForm.phone} onChange={e => setLocForm(f => ({ ...f, phone: e.target.value }))} placeholder="+44 20 1234 5678" />
            </Field>
          </div>
          <div className="border-t border-border pt-4 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-3 mb-3">Contact Person</p>
            <Field label="Full Name">
              <input className="input w-full" value={locForm.contact_name} onChange={e => setLocForm(f => ({ ...f, contact_name: e.target.value }))} placeholder="e.g. Jane Smith" />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email">
                <input className="input w-full" type="email" value={locForm.contact_email} onChange={e => setLocForm(f => ({ ...f, contact_email: e.target.value }))} placeholder="jane@brand.com" />
              </Field>
              <Field label="Phone">
                <input className="input w-full" type="tel" value={locForm.contact_phone} onChange={e => setLocForm(f => ({ ...f, contact_phone: e.target.value }))} placeholder="+44 7700 900000" />
              </Field>
            </div>
          </div>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setLocModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitLoc} disabled={locSaving}>
              {locSaving ? 'Saving…' : locModal === 'new' ? 'Add Location' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* Group Modal */}
      {grpModal !== null && (
        <Modal
          title={grpModal === 'new' ? 'Add Group' : 'Edit Group'}
          onClose={() => setGrpModal(null)}
          width="max-w-sm"
        >
          <Field label="Group Name" required>
            <input
              className="input w-full"
              value={grpForm.name}
              onChange={e => setGrpForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. London Central"
              autoFocus
            />
          </Field>
          <Field label="Description">
            <input
              className="input w-full"
              value={grpForm.description}
              onChange={e => setGrpForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional note"
            />
          </Field>
          <div className="flex gap-3 justify-end pt-2">
            <button className="btn-ghost px-4 py-2 text-sm" onClick={() => setGrpModal(null)}>Cancel</button>
            <button className="btn-primary px-4 py-2 text-sm" onClick={submitGrp} disabled={grpSaving}>
              {grpSaving ? 'Saving…' : 'Save Group'}
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={
            confirmDelete.type === 'market'
              ? 'Delete this market? All its tax rates and level-tax mappings will also be removed.'
              : confirmDelete.type === 'tax'
              ? 'Delete this tax rate?'
              : confirmDelete.type === 'bp'
              ? 'Delete this brand partner? This will also unassign it from all markets.'
              : confirmDelete.type === 'location'
              ? 'Delete this location? This cannot be undone.'
              : 'Delete this group? Locations in this group will be unassigned but not deleted.'
          }
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Regions Panel — admin CRUD for sub-country regions ───────────────────────
// Regions are a shared catalog keyed by ISO 3166-1 alpha-2 country code and
// live independently of the markets table. Groups by country ISO in the UI.
// Uses /api/regions (catalog CRUD) + /api/regions/import-standard.

type RegionForm = { name: string; iso_code: string }

function RegionsPanel({ api, regions, onRefresh, showToast }: {
  api: ReturnType<typeof useApi>
  markets: Market[]    // retained for consistency with sibling panels; unused here
  regions: Region[]
  onRefresh: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}) {
  // Form state for the "add region" input per country ISO.
  const [addForms, setAddForms] = useState<Record<string, RegionForm>>({})
  const [addingFor, setAddingFor] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: number; name: string; iso_code: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  // Standard catalog summary: iso → count. Drives the "Import standard" button.
  const [catalogCounts, setCatalogCounts] = useState<Map<string, number>>(new Map())
  const [importingFor, setImportingFor] = useState<string | null>(null)
  // Countries the admin wants to see — starts as the union of ISOs already in
  // the regions catalog, plus any ISOs the user adds via the "+ Add country"
  // dropdown (backed by WORLD_COUNTRIES). Kept in a Set so sort order is stable.
  const [visibleIsos, setVisibleIsos] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    api.get('/regions/catalog').then((rows: any) => {
      if (cancelled) return
      const m = new Map<string, number>()
      ;(rows || []).forEach((r: any) => m.set(String(r.country_iso).toUpperCase(), Number(r.count) || 0))
      setCatalogCounts(m)
    }).catch(() => { /* older server — import buttons just won't appear */ })
    return () => { cancelled = true }
  }, [api])

  // Ensure every ISO that already has regions is visible by default.
  useEffect(() => {
    setVisibleIsos(prev => {
      const next = new Set(prev)
      regions.forEach(r => next.add((r.country_iso || '').toUpperCase()))
      return next
    })
  }, [regions])

  const displayCountries = useMemo(() => {
    const items = Array.from(visibleIsos)
      .filter(Boolean)
      .map(iso => {
        const wc = WORLD_COUNTRIES.find(c => c.iso === iso)
        return { iso, name: wc?.name || iso }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
    return items
  }, [visibleIsos])

  function getForm(iso: string) {
    return addForms[iso] || { name: '', iso_code: '' }
  }
  function setForm(iso: string, patch: Partial<RegionForm>) {
    setAddForms(prev => ({ ...prev, [iso]: { ...getForm(iso), ...patch } }))
  }

  async function handleAdd(iso: string) {
    const form = getForm(iso)
    if (!form.name.trim()) return
    setAddingFor(iso)
    try {
      await api.post('/regions', {
        country_iso: iso,
        name:        form.name.trim(),
        iso_code:    form.iso_code.trim() || null,
      })
      setForm(iso, { name: '', iso_code: '' })
      showToast('Region added')
      onRefresh()
    } catch (err: any) {
      showToast(err?.message || 'Failed to add region', 'error')
    } finally {
      setAddingFor(null)
    }
  }

  async function handleUpdate() {
    if (!editing || !editing.name.trim()) return
    setSaving(true)
    try {
      await api.put(`/regions/${editing.id}`, { name: editing.name.trim(), iso_code: editing.iso_code.trim() || null })
      setEditing(null)
      showToast('Region updated')
      onRefresh()
    } catch (err: any) {
      showToast(err?.message || 'Failed to update region', 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      await api.delete(`/regions/${id}`)
      showToast('Region deleted')
      onRefresh()
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete region', 'error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleImportStandard(iso: string, expectedCount: number) {
    if (!confirm(`Import ${expectedCount} standard regions for ${iso} from the ISO 3166-2 catalog? Existing regions with matching names will be skipped.`)) return
    setImportingFor(iso)
    try {
      const res = await api.post('/regions/import-standard', { country_iso: iso }) as { imported: number; skipped: number }
      showToast(`Imported ${res.imported} regions (${res.skipped} already present)`)
      onRefresh()
    } catch (err: any) {
      showToast(err?.message || 'Import failed', 'error')
    } finally {
      setImportingFor(null)
    }
  }

  function addCountry(iso: string) {
    if (!iso) return
    setVisibleIsos(prev => new Set(prev).add(iso.toUpperCase()))
  }

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="text-sm text-text-3 max-w-2xl">
          Manage sub-country regions (e.g. US states, UK nations, Canadian provinces). Regions are a shared catalog keyed by country — any market under that country can claim any subset. Multiple markets can claim the same region.
        </div>
        <div>
          <label className="text-xs text-text-3 block mb-1">+ Add country to configure</label>
          <select
            className="input text-sm"
            value=""
            onChange={e => { addCountry(e.target.value); e.target.value = '' }}
          >
            <option value="">— Pick a country —</option>
            {WORLD_COUNTRIES
              .filter(c => !visibleIsos.has(c.iso))
              .map(c => (<option key={c.iso} value={c.iso}>{c.name} ({c.iso})</option>))}
          </select>
        </div>
      </div>

      {displayCountries.length === 0 ? (
        <div className="p-8 text-center text-sm text-text-3 bg-surface rounded border border-border">
          No regions configured yet. Pick a country above to start.
        </div>
      ) : displayCountries.map(({ iso, name: countryName }) => {
        const list     = regions.filter(r => (r.country_iso || '').toUpperCase() === iso)
        const form     = getForm(iso)
        const isAdding = addingFor === iso
        const catalogCount = catalogCounts.get(iso) ?? 0
        const canImport    = catalogCount > 0 && catalogCount > list.length

        return (
          <div key={iso} className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-surface-2 border-b border-border gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-3 bg-surface border border-border px-1.5 py-0.5 rounded">{iso}</span>
                <span className="font-semibold text-sm text-text-1">{countryName}</span>
                <span className="text-xs text-text-3">· {list.length} {list.length === 1 ? 'region' : 'regions'}</span>
              </div>
              {canImport && (
                <button
                  className="btn-outline px-3 py-1 text-xs whitespace-nowrap"
                  onClick={() => handleImportStandard(iso, catalogCount)}
                  disabled={importingFor === iso}
                  title={`${catalogCount} standard ISO 3166-2 regions available`}
                >
                  {importingFor === iso
                    ? 'Importing…'
                    : `Import ${catalogCount - list.length} from standard catalog`}
                </button>
              )}
            </div>

            {/* Inline add form */}
            <div className="flex gap-2 px-4 py-3 border-b border-border bg-surface">
              <input
                className="input text-sm flex-1"
                placeholder="Region name (e.g. California)"
                value={form.name}
                onChange={e => setForm(iso, { name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(iso) }}
                disabled={isAdding}
              />
              <input
                className="input text-sm w-28 font-mono uppercase"
                placeholder={`ISO (${iso}-XX)`}
                value={form.iso_code}
                onChange={e => setForm(iso, { iso_code: e.target.value.toUpperCase() })}
                onKeyDown={e => { if (e.key === 'Enter') handleAdd(iso) }}
                disabled={isAdding}
                maxLength={10}
              />
              <button
                className="btn-primary px-4 text-sm"
                onClick={() => handleAdd(iso)}
                disabled={!form.name.trim() || isAdding}
              >
                {isAdding ? 'Adding…' : 'Add'}
              </button>
            </div>

            {list.length === 0 ? (
              <div className="px-4 py-4 text-xs text-text-3 italic">
                No regions yet for {countryName}. Add some above or use the standard-catalog import.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {list.map(r => {
                  const isEditing = editing?.id === r.id
                  return (
                    <li key={r.id} className="px-4 py-2.5 flex items-center gap-3">
                      {isEditing ? (
                        <>
                          <input
                            className="input text-sm flex-1"
                            value={editing!.name}
                            onChange={e => setEditing(v => v ? { ...v, name: e.target.value } : v)}
                            autoFocus
                          />
                          <input
                            className="input text-sm w-28 font-mono uppercase"
                            value={editing!.iso_code}
                            onChange={e => setEditing(v => v ? { ...v, iso_code: e.target.value.toUpperCase() } : v)}
                            maxLength={10}
                          />
                          <button className="btn-primary px-3 py-1 text-xs" onClick={handleUpdate} disabled={saving}>
                            {saving ? '…' : 'Save'}
                          </button>
                          <button className="btn-ghost px-3 py-1 text-xs" onClick={() => setEditing(null)} disabled={saving}>
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-text-1 flex-1">{r.name}</span>
                          {r.iso_code && (
                            <span className="text-xs font-mono text-text-3 px-2 py-0.5 rounded bg-surface-2 border border-border">
                              {r.iso_code}
                            </span>
                          )}
                          <button
                            className="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
                            onClick={() => setEditing({ id: r.id, name: r.name, iso_code: r.iso_code || '' })}
                          >
                            <EditIcon size={12} /> Edit
                          </button>
                          <button
                            className="btn-ghost px-2 py-1 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1"
                            onClick={() => {
                              if (confirm(`Delete region "${r.name}"? Any markets claiming it will lose the association.`)) handleDelete(r.id)
                            }}
                            disabled={deletingId === r.id}
                          >
                            <TrashIcon size={12} /> {deletingId === r.id ? '…' : 'Delete'}
                          </button>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Centres Panel (wraps StoresTab from StockManagerPage) ─────────────────────

function CentresPanel({ api, locations, onRefresh }: {
  api: ReturnType<typeof useApi>
  locations: { id: number; name: string; country_name?: string; is_active: boolean }[]
  onRefresh: () => void
}) {
  const { can } = usePermissions()
  const canWrite = can('stock_overview', 'write')
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <StoresTab api={api} locations={locations} canWrite={canWrite} showToast={showToast} onStoresChange={onRefresh} />
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-semibold text-white ${toast.type === 'success' ? 'bg-accent' : 'bg-red-600'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Market Card ───────────────────────────────────────────────────────────────

interface MarketCardProps {
  market:                 Market
  taxRates:               TaxRate[]
  priceLevels:            PriceLevel[]
  levelTax:               MarketLevelTax[]
  cplMatrix:              Map<string, boolean>
  regions:                Region[]
  brandPartners:          BrandPartner[]
  baseCurrency:           string
  onEdit:                 (m: Market) => void
  onDelete:               (id: number) => void
  onAddTax:               (marketId: number) => void
  onEditTax:              (t: TaxRate) => void
  onDeleteTax:            (id: number) => void
  onSetDefaultTax:        (taxId: number, marketId: number) => void
  onSetDefaultPriceLevel: (marketId: number, priceLevelId: number | null) => void
  onSetLevelTax:          (marketId: number, priceLevelId: number, taxRateId: number | null) => void
  onSetLevelEnabled:      (marketId: number, priceLevelId: number, isEnabled: boolean) => void
  onSetCogsThresholds:    (marketId: number, excellent: number | null, acceptable: number | null) => void
  onSetBrandPartner:      (marketId: number, bpId: number | null) => void
}

function MarketCard({
  market, taxRates, priceLevels, levelTax, cplMatrix, regions, brandPartners, baseCurrency,
  onEdit, onDelete, onAddTax, onEditTax, onDeleteTax, onSetDefaultTax,
  onSetDefaultPriceLevel, onSetLevelTax, onSetLevelEnabled, onSetCogsThresholds, onSetBrandPartner,
}: MarketCardProps) {
  const marketRegions = (market.region_ids || []).map(id => regions.find(r => r.id === id)).filter((r): r is Region => !!r)
  const flag          = isoToFlag(market.country_iso)
  const rate          = Number(market.exchange_rate)
  const linkedCountry = WORLD_COUNTRIES.find(c => c.iso === market.country_iso)
  const currentBP     = brandPartners.find(bp => bp.id === market.brand_partner_id)

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-surface-2 border border-border flex items-center justify-center text-2xl shrink-0 select-none">
            {flag}
          </div>
          <div>
            <div className="font-bold text-text-1 text-sm flex items-center gap-2">
              {market.name}
              {marketRegions.length > 0 && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-accent-dim text-accent uppercase tracking-wider" title={`Scoped to ${marketRegions.length} region(s)`}>
                  {marketRegions.length} REGION{marketRegions.length === 1 ? '' : 'S'}
                </span>
              )}
            </div>
            <div className="text-xs text-text-3 flex items-center gap-2 mt-0.5 flex-wrap">
              {linkedCountry && (
                <>
                  <span className="text-text-2">{linkedCountry.name}</span>
                  <span>·</span>
                </>
              )}
              <span className="font-mono">{market.currency_code}</span>
              <span>·</span>
              <span>{market.currency_symbol}</span>
              <span>·</span>
              <span className="font-mono">1 {baseCurrency} = {rate.toFixed(4)} {market.currency_code}</span>
            </div>
            {marketRegions.length > 0 && (
              <div className="text-xs text-text-3 mt-1 flex flex-wrap gap-1">
                {marketRegions.map(r => (
                  <span key={r.id} className="inline-block px-1.5 py-0.5 rounded bg-surface-2 border border-border text-text-2">
                    {r.name}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
            onClick={() => onEdit(market)}
          >
            <EditIcon size={12} /> Edit
          </button>
          <button
            className="btn-ghost px-3 py-1.5 text-xs text-red-500 hover:text-red-600 hover:bg-red-50 flex items-center gap-1.5"
            onClick={() => onDelete(market.id)}
          >
            <TrashIcon size={12} /> Delete
          </button>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* Brand Partner */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Brand Partner</span>
            {currentBP
              ? <Badge label={currentBP.name} variant="green" />
              : <Badge label="Not assigned" variant="neutral" />
            }
          </div>
          <p className="text-xs text-text-3 mb-2">The franchisee or partner business operating this market.</p>
          <select
            className="select w-full text-xs"
            value={market.brand_partner_id ?? ''}
            onChange={e => onSetBrandPartner(market.id, e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— Not assigned —</option>
            {brandPartners.map(bp => (
              <option key={bp.id} value={bp.id}>{bp.name}</option>
            ))}
          </select>
        </div>

        {/* Tax Rates */}
        <div className="border-t border-border pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Tax Rates</span>
            <button
              className="btn-ghost px-2 py-1 text-xs flex items-center gap-1"
              onClick={() => onAddTax(market.id)}
            >
              <PlusIcon size={12} /> Add
            </button>
          </div>

          {taxRates.length === 0 ? (
            <p className="text-xs text-text-3 italic">No tax rates yet.</p>
          ) : (
            <div className="space-y-1.5">
              {taxRates.map(t => (
                <div key={t.id} className="flex items-center gap-2 py-1">
                  <span className="flex-1 text-sm text-text-1">{t.name}</span>
                  <span className="font-mono text-xs text-text-2">{(Number(t.rate) * 100).toFixed(2)}%</span>
                  {t.is_default
                    ? <Badge label="default" variant="green" />
                    : (
                      <button
                        className="btn-ghost px-2 py-0.5 text-xs"
                        onClick={() => onSetDefaultTax(t.id, market.id)}
                      >
                        Set default
                      </button>
                    )
                  }
                  <button className="p-1 text-text-3 hover:text-text-1 transition-colors rounded" onClick={() => onEditTax(t)}>
                    <EditIcon size={13} />
                  </button>
                  <button className="p-1 text-text-3 hover:text-red-500 transition-colors rounded" onClick={() => onDeleteTax(t.id)}>
                    <TrashIcon size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Per-market COGS thresholds. NULL columns fall back to the global
            defaults configured in Configuration → COGS Thresholds. Save on
            blur so edits commit without a dedicated button. */}
        <MarketCogsThresholds market={market} onSave={onSetCogsThresholds} />

        {/* Unified Price Levels section — combines three previously separate
            blocks (Enabled / Default Tax per Level / Default Price Level)
            into one table so it's visible at a glance. Each row lets you
            toggle enablement, assign a tax rate, and flag the default. */}
        {priceLevels.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Price Levels</span>
              <p className="text-xs text-text-3 mt-1">
                Enable the sales channels this market uses, assign the default tax rate per channel, and flag which level is the market default.
              </p>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-text-3 border-b border-border">
                  <th className="pb-1.5 pr-2 font-semibold">Price Level</th>
                  <th className="pb-1.5 px-2 font-semibold text-center w-16">Enabled</th>
                  <th className="pb-1.5 px-2 font-semibold">Tax Rate</th>
                  <th className="pb-1.5 pl-2 font-semibold text-center w-16">Default</th>
                </tr>
              </thead>
              <tbody>
                {priceLevels.map(pl => {
                  const cplKey  = `${market.id}-${pl.id}`
                  const enabled = cplMatrix.get(cplKey) ?? true
                  const mapping = levelTax.find(lt => lt.price_level_id === pl.id)
                  const isDefault = market.default_price_level_id === pl.id
                  return (
                    <tr key={pl.id} className="border-b border-border last:border-0">
                      <td className={`py-2 pr-2 ${enabled ? 'text-text-1' : 'text-text-3 line-through'}`}>
                        {pl.name}
                      </td>
                      <td className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={e => onSetLevelEnabled(market.id, pl.id, e.target.checked)}
                          className="w-4 h-4 accent-accent"
                          aria-label={`${enabled ? 'Disable' : 'Enable'} ${pl.name}`}
                        />
                      </td>
                      <td className="py-2 px-2">
                        {taxRates.length === 0 ? (
                          <span className="text-text-3 italic">Add tax rates first</span>
                        ) : (
                          <select
                            className="select w-full text-xs"
                            value={mapping?.tax_rate_id ?? ''}
                            onChange={e => onSetLevelTax(market.id, pl.id, e.target.value ? Number(e.target.value) : null)}
                            disabled={!enabled}
                          >
                            <option value="">— Market default —</option>
                            {taxRates.map(t => (
                              <option key={t.id} value={t.id}>
                                {t.name} ({(Number(t.rate) * 100).toFixed(2)}%)
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-2 pl-2 text-center">
                        <button
                          type="button"
                          onClick={() => onSetDefaultPriceLevel(market.id, isDefault ? null : pl.id)}
                          className={`inline-flex items-center justify-center w-6 h-6 rounded transition-colors ${
                            isDefault
                              ? 'text-amber-500 hover:text-amber-600'
                              : 'text-text-3 hover:text-text-1'
                          }`}
                          title={isDefault ? 'Remove as market default' : 'Set as market default'}
                          aria-label={isDefault ? `${pl.name} is the market default` : `Make ${pl.name} the market default`}
                        >
                          {isDefault ? '★' : '☆'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Per-market COGS threshold editor ──────────────────────────────────────────
// Small inline form: two number inputs (excellent + acceptable) with save-on-blur
// semantics. Leaving a value empty clears the override so the market inherits
// the global defaults.

function MarketCogsThresholds({
  market, onSave,
}: {
  market: Market
  onSave: (marketId: number, excellent: number | null, acceptable: number | null) => void
}) {
  // Track local string state so the user can clear inputs without the value
  // snapping back to the saved number mid-edit.
  const [exc, setExc] = useState<string>(market.cogs_threshold_excellent  != null ? String(market.cogs_threshold_excellent)  : '')
  const [acc, setAcc] = useState<string>(market.cogs_threshold_acceptable != null ? String(market.cogs_threshold_acceptable) : '')

  // Resync when the market prop changes (e.g. loadAll refreshed after save).
  useEffect(() => {
    setExc(market.cogs_threshold_excellent  != null ? String(market.cogs_threshold_excellent)  : '')
    setAcc(market.cogs_threshold_acceptable != null ? String(market.cogs_threshold_acceptable) : '')
  }, [market.id, market.cogs_threshold_excellent, market.cogs_threshold_acceptable])

  function commit() {
    const nextExc = exc.trim() === '' ? null : Number(exc)
    const nextAcc = acc.trim() === '' ? null : Number(acc)
    const savedExc = market.cogs_threshold_excellent  != null ? Number(market.cogs_threshold_excellent)  : null
    const savedAcc = market.cogs_threshold_acceptable != null ? Number(market.cogs_threshold_acceptable) : null
    if (nextExc === savedExc && nextAcc === savedAcc) return  // no-op
    onSave(market.id, nextExc, nextAcc)
  }

  const hasOverride = market.cogs_threshold_excellent != null || market.cogs_threshold_acceptable != null

  return (
    <div className="border-t border-border pt-4">
      <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-3">COGS Thresholds</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${hasOverride ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-3'}`}>
          {hasOverride ? 'MARKET OVERRIDE' : 'INHERITING GLOBAL'}
        </span>
      </div>
      <p className="text-xs text-text-3 mb-2">
        COGS % cells paint green ≤ Excellent, amber ≤ Acceptable, red above. Leave blank to inherit the global defaults (<span className="font-mono">Configuration → COGS Thresholds</span>).
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="text-[11px] text-text-3">Excellent (≤%)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            inputMode="decimal"
            className="input text-sm w-full"
            value={exc}
            onChange={e => setExc(e.target.value)}
            onBlur={commit}
            placeholder="Global"
          />
        </div>
        <div className="flex-1">
          <label className="text-[11px] text-text-3">Acceptable (≤%)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            inputMode="decimal"
            className="input text-sm w-full"
            value={acc}
            onChange={e => setAcc(e.target.value)}
            onBlur={commit}
            placeholder="Global"
          />
        </div>
        {hasOverride && (
          <button
            className="btn-ghost px-2 py-1 text-xs text-text-3 hover:text-text-1"
            onClick={() => { setExc(''); setAcc(''); onSave(market.id, null, null) }}
            title="Clear overrides — inherit global defaults"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

// KpiCard removed — stats now inline in PageHeader subtitle

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )
}

function EditIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  )
}

function TrashIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
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
