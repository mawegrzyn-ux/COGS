import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'

// ── World Countries (predefined list with ISO alpha-2 codes) ──────────────────

interface WorldCountry {
  iso: string
  name: string
  currency_code: string
  currency_symbol: string
}

const WORLD_COUNTRIES: WorldCountry[] = [
  { iso: 'AF', name: 'Afghanistan',           currency_code: 'AFN', currency_symbol: '؋'    },
  { iso: 'AL', name: 'Albania',               currency_code: 'ALL', currency_symbol: 'L'    },
  { iso: 'DZ', name: 'Algeria',               currency_code: 'DZD', currency_symbol: 'DA'   },
  { iso: 'AR', name: 'Argentina',             currency_code: 'ARS', currency_symbol: 'AR$'  },
  { iso: 'AU', name: 'Australia',             currency_code: 'AUD', currency_symbol: 'A$'   },
  { iso: 'AT', name: 'Austria',               currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'AZ', name: 'Azerbaijan',            currency_code: 'AZN', currency_symbol: '₼'    },
  { iso: 'BH', name: 'Bahrain',               currency_code: 'BHD', currency_symbol: 'BD'   },
  { iso: 'BD', name: 'Bangladesh',            currency_code: 'BDT', currency_symbol: '৳'    },
  { iso: 'BE', name: 'Belgium',               currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'BR', name: 'Brazil',                currency_code: 'BRL', currency_symbol: 'R$'   },
  { iso: 'BG', name: 'Bulgaria',              currency_code: 'BGN', currency_symbol: 'лв'   },
  { iso: 'CA', name: 'Canada',                currency_code: 'CAD', currency_symbol: 'CA$'  },
  { iso: 'CL', name: 'Chile',                 currency_code: 'CLP', currency_symbol: 'CL$'  },
  { iso: 'CN', name: 'China',                 currency_code: 'CNY', currency_symbol: '¥'    },
  { iso: 'CO', name: 'Colombia',              currency_code: 'COP', currency_symbol: 'CO$'  },
  { iso: 'HR', name: 'Croatia',               currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'CY', name: 'Cyprus',                currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'CZ', name: 'Czech Republic',        currency_code: 'CZK', currency_symbol: 'Kč'   },
  { iso: 'DK', name: 'Denmark',               currency_code: 'DKK', currency_symbol: 'kr'   },
  { iso: 'EG', name: 'Egypt',                 currency_code: 'EGP', currency_symbol: 'E£'   },
  { iso: 'FI', name: 'Finland',               currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'FR', name: 'France',                currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'GE', name: 'Georgia',               currency_code: 'GEL', currency_symbol: '₾'    },
  { iso: 'DE', name: 'Germany',               currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'GH', name: 'Ghana',                 currency_code: 'GHS', currency_symbol: 'GH₵'  },
  { iso: 'GR', name: 'Greece',                currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'HK', name: 'Hong Kong',             currency_code: 'HKD', currency_symbol: 'HK$'  },
  { iso: 'HU', name: 'Hungary',               currency_code: 'HUF', currency_symbol: 'Ft'   },
  { iso: 'IN', name: 'India',                 currency_code: 'INR', currency_symbol: '₹'    },
  { iso: 'ID', name: 'Indonesia',             currency_code: 'IDR', currency_symbol: 'Rp'   },
  { iso: 'IE', name: 'Ireland',               currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'IL', name: 'Israel',                currency_code: 'ILS', currency_symbol: '₪'    },
  { iso: 'IT', name: 'Italy',                 currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'JP', name: 'Japan',                 currency_code: 'JPY', currency_symbol: '¥'    },
  { iso: 'JO', name: 'Jordan',                currency_code: 'JOD', currency_symbol: 'JD'   },
  { iso: 'KZ', name: 'Kazakhstan',            currency_code: 'KZT', currency_symbol: '₸'    },
  { iso: 'KE', name: 'Kenya',                 currency_code: 'KES', currency_symbol: 'KSh'  },
  { iso: 'KW', name: 'Kuwait',                currency_code: 'KWD', currency_symbol: 'KD'   },
  { iso: 'LB', name: 'Lebanon',               currency_code: 'LBP', currency_symbol: 'L£'   },
  { iso: 'MY', name: 'Malaysia',              currency_code: 'MYR', currency_symbol: 'RM'   },
  { iso: 'MX', name: 'Mexico',                currency_code: 'MXN', currency_symbol: 'MX$'  },
  { iso: 'MA', name: 'Morocco',               currency_code: 'MAD', currency_symbol: 'MAD'  },
  { iso: 'NL', name: 'Netherlands',           currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'NZ', name: 'New Zealand',           currency_code: 'NZD', currency_symbol: 'NZ$'  },
  { iso: 'NG', name: 'Nigeria',               currency_code: 'NGN', currency_symbol: '₦'    },
  { iso: 'NO', name: 'Norway',                currency_code: 'NOK', currency_symbol: 'kr'   },
  { iso: 'OM', name: 'Oman',                  currency_code: 'OMR', currency_symbol: 'OMR'  },
  { iso: 'PK', name: 'Pakistan',              currency_code: 'PKR', currency_symbol: '₨'    },
  { iso: 'PE', name: 'Peru',                  currency_code: 'PEN', currency_symbol: 'S/'   },
  { iso: 'PH', name: 'Philippines',           currency_code: 'PHP', currency_symbol: '₱'    },
  { iso: 'PL', name: 'Poland',                currency_code: 'PLN', currency_symbol: 'zł'   },
  { iso: 'PT', name: 'Portugal',              currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'QA', name: 'Qatar',                 currency_code: 'QAR', currency_symbol: 'QR'   },
  { iso: 'RO', name: 'Romania',               currency_code: 'RON', currency_symbol: 'lei'  },
  { iso: 'RU', name: 'Russia',                currency_code: 'RUB', currency_symbol: '₽'    },
  { iso: 'SA', name: 'Saudi Arabia',          currency_code: 'SAR', currency_symbol: 'SR'   },
  { iso: 'SG', name: 'Singapore',             currency_code: 'SGD', currency_symbol: 'S$'   },
  { iso: 'SK', name: 'Slovakia',              currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'SI', name: 'Slovenia',              currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'ZA', name: 'South Africa',          currency_code: 'ZAR', currency_symbol: 'R'    },
  { iso: 'KR', name: 'South Korea',           currency_code: 'KRW', currency_symbol: '₩'    },
  { iso: 'ES', name: 'Spain',                 currency_code: 'EUR', currency_symbol: '€'    },
  { iso: 'SE', name: 'Sweden',                currency_code: 'SEK', currency_symbol: 'kr'   },
  { iso: 'CH', name: 'Switzerland',           currency_code: 'CHF', currency_symbol: 'CHF'  },
  { iso: 'TW', name: 'Taiwan',                currency_code: 'TWD', currency_symbol: 'NT$'  },
  { iso: 'TZ', name: 'Tanzania',              currency_code: 'TZS', currency_symbol: 'TSh'  },
  { iso: 'TH', name: 'Thailand',              currency_code: 'THB', currency_symbol: '฿'    },
  { iso: 'TN', name: 'Tunisia',               currency_code: 'TND', currency_symbol: 'DT'   },
  { iso: 'TR', name: 'Turkey',                currency_code: 'TRY', currency_symbol: '₺'    },
  { iso: 'UG', name: 'Uganda',                currency_code: 'UGX', currency_symbol: 'USh'  },
  { iso: 'UA', name: 'Ukraine',               currency_code: 'UAH', currency_symbol: '₴'    },
  { iso: 'AE', name: 'United Arab Emirates',  currency_code: 'AED', currency_symbol: 'AED'  },
  { iso: 'GB', name: 'United Kingdom',        currency_code: 'GBP', currency_symbol: '£'    },
  { iso: 'US', name: 'United States',         currency_code: 'USD', currency_symbol: '$'    },
  { iso: 'UZ', name: 'Uzbekistan',            currency_code: 'UZS', currency_symbol: "so'm" },
  { iso: 'VN', name: 'Vietnam',               currency_code: 'VND', currency_symbol: '₫'    },
  { iso: 'ZM', name: 'Zambia',                currency_code: 'ZMW', currency_symbol: 'ZK'   },
  { iso: 'ZW', name: 'Zimbabwe',              currency_code: 'ZWL', currency_symbol: 'Z$'   },
].sort((a, b) => a.name.localeCompare(b.name))

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
  const [activeTab, setActiveTab]   = useState<'Brand Partners' | 'Markets' | 'Locations'>('Brand Partners')
  const [markets,       setMarkets]       = useState<Market[]>([])
  const [taxRates,      setTaxRates]      = useState<TaxRate[]>([])
  const [priceLevels,   setPriceLevels]   = useState<PriceLevel[]>([])
  const [levelTax,      setLevelTax]      = useState<MarketLevelTax[]>([])
  const [brandPartners, setBrandPartners] = useState<BrandPartner[]>([])
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
      const [c, t, pl, clt, v, settings, locs, grps] = await Promise.all([
        api.get('/countries'),
        api.get('/tax-rates'),
        api.get('/price-levels'),
        api.get('/country-level-tax'),
        api.get('/brand-partners'),
        api.get('/settings').catch(() => ({})),
        api.get('/locations'),
        api.get('/location-groups'),
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
      const payload = {
        name:            marketForm.name.trim(),
        country_iso:     marketForm.country_iso || null,
        currency_code:   marketForm.currency_code.toUpperCase().trim(),
        currency_symbol: marketForm.currency_symbol.trim(),
        exchange_rate:   Number(marketForm.exchange_rate),
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
        title="Markets"
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
        {(['Brand Partners', 'Markets', 'Locations'] as const).map(tab => (
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
      ) : (
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
              onChange={(iso, wc) => setMarketForm(f => ({
                ...f,
                country_iso:     iso,
                currency_code:   wc.currency_code,
                currency_symbol: wc.currency_symbol,
              }))}
              error={marketErrors.country_iso}
            />
            <p className="text-xs text-text-3 mt-1">Links this market to a real country for flags and regional settings. Currency fields are auto-filled but editable.</p>
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

// ── Market Card ───────────────────────────────────────────────────────────────

interface MarketCardProps {
  market:                 Market
  taxRates:               TaxRate[]
  priceLevels:            PriceLevel[]
  levelTax:               MarketLevelTax[]
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
  onSetBrandPartner:      (marketId: number, bpId: number | null) => void
}

function MarketCard({
  market, taxRates, priceLevels, levelTax, brandPartners, baseCurrency,
  onEdit, onDelete, onAddTax, onEditTax, onDeleteTax, onSetDefaultTax,
  onSetDefaultPriceLevel, onSetLevelTax, onSetBrandPartner,
}: MarketCardProps) {
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
            <div className="font-bold text-text-1 text-sm">{market.name}</div>
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

        {/* Default Price Level */}
        {priceLevels.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Default Price Level</span>
              {market.default_price_level_id
                ? <Badge label={priceLevels.find(p => p.id === market.default_price_level_id)?.name || 'Unknown'} variant="green" />
                : <Badge label="Not set" variant="neutral" />
              }
            </div>
            <select
              className="select w-full text-xs"
              value={market.default_price_level_id ?? ''}
              onChange={e => onSetDefaultPriceLevel(market.id, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— None (manual selection) —</option>
              {priceLevels.map(pl => (
                <option key={pl.id} value={pl.id}>{pl.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Tax Rates */}
        <div>
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

        {/* Price Level → Tax mapping */}
        {priceLevels.length > 0 && taxRates.length > 0 && (
          <div className="border-t border-border pt-4">
            <div className="mb-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-text-3">Default Tax per Price Level</span>
              <p className="text-xs text-text-3 mt-1">Set which tax rate applies by default for each sales channel.</p>
            </div>
            <div className="space-y-2">
              {priceLevels.map(pl => {
                const mapping = levelTax.find(lt => lt.price_level_id === pl.id)
                return (
                  <div key={pl.id} className="flex items-center gap-3">
                    <span className="text-xs text-text-2 w-28 shrink-0">{pl.name}</span>
                    <select
                      className="select flex-1 text-xs"
                      value={mapping?.tax_rate_id ?? ''}
                      onChange={e => onSetLevelTax(market.id, pl.id, e.target.value ? Number(e.target.value) : null)}
                    >
                      <option value="">— Market default —</option>
                      {taxRates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({(Number(t.rate) * 100).toFixed(2)}%)
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
