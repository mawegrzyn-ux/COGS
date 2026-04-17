import { createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode } from 'react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'

export interface Country {
  id: number
  name: string
  currency_code: string
  currency_symbol: string
  exchange_rate: number
  country_iso?: string | null
}

interface MarketContextValue {
  /** Selected country id, or null = "All markets" */
  countryId: number | null
  setCountryId: (id: number | null) => void
  /** All countries the user is allowed to see */
  countries: Country[]
  /** The currently-selected country object, or null */
  selected: Country | null
  /** Loading state for the countries list */
  loading: boolean
  reload: () => Promise<void>
}

const MarketContext = createContext<MarketContextValue>({
  countryId: null,
  setCountryId: () => {},
  countries: [],
  selected: null,
  loading: true,
  reload: async () => {},
})

const STORAGE_KEY = 'cogs-market-country-id'

export function MarketProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const { allowedCountries, user } = usePermissions()

  const [countries, setCountries] = useState<Country[]>([])
  const [loading, setLoading] = useState(true)
  const [countryId, setCountryIdState] = useState<number | null>(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw || raw === 'null') return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) ? n : null
  })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const rows: Country[] = await api.get('/countries').catch(() => [])
      const filtered = allowedCountries
        ? rows.filter(c => allowedCountries.includes(c.id))
        : rows
      setCountries(filtered)
    } finally {
      setLoading(false)
    }
  }, [api, allowedCountries])

  // Load countries once user is ready
  useEffect(() => {
    if (!user) return
    reload()
  }, [user, reload])

  // Clamp stored selection to allowed set
  useEffect(() => {
    if (!countries.length) return
    if (countryId !== null && !countries.find(c => c.id === countryId)) {
      setCountryIdState(null)
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [countries, countryId])

  const setCountryId = useCallback((id: number | null) => {
    setCountryIdState(id)
    if (id === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, String(id))
  }, [])

  const selected = useMemo(
    () => countryId == null ? null : (countries.find(c => c.id === countryId) ?? null),
    [countries, countryId]
  )

  const value = useMemo<MarketContextValue>(() => ({
    countryId, setCountryId, countries, selected, loading, reload,
  }), [countryId, setCountryId, countries, selected, loading, reload])

  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>
}

export function useMarket() {
  return useContext(MarketContext)
}
