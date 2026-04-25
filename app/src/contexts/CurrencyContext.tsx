import { createContext, useContext, useEffect, useMemo, useState, useCallback, ReactNode } from 'react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'

/**
 * Global Display Currency switch. Drives "Display Currency" everywhere
 * (Recipes, Menu Engineer, Dashboard widgets, etc).
 *
 * Values:
 *  - ''          → show in the page's active market currency (page-local context)
 *  - '__BASE__'  → show in system base (USD)
 *  - '<code>'    → show in that currency code (e.g. 'EUR', 'GBP')
 *
 * Each consumer resolves the rate relative to its own active market —
 * this context only holds the user's preferred display currency.
 */

export interface CurrencyOption {
  value: string         // '' | '__BASE__' | currency code
  label: string
  symbol: string
}

interface CurrencyContextValue {
  currencyCode: string
  setCurrencyCode: (code: string) => void
  options: CurrencyOption[]
  loading: boolean
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currencyCode: '',
  setCurrencyCode: () => {},
  options: [],
  loading: true,
})

const STORAGE_KEY = 'cogs-display-currency'

interface CountryRow {
  id: number
  currency_code: string
  currency_symbol: string
  exchange_rate: number
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const { user } = usePermissions()

  const [countries, setCountries] = useState<CountryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currencyCode, setCurrencyCodeState] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) ?? ''
  })

  useEffect(() => {
    if (!user) return
    let cancelled = false
    setLoading(true)
    api.get('/countries')
      .then((rows: CountryRow[]) => { if (!cancelled) setCountries(rows || []) })
      .catch(() => { if (!cancelled) setCountries([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, user])

  const setCurrencyCode = useCallback((code: string) => {
    setCurrencyCodeState(code)
    if (code === '') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, code)
  }, [])

  // Dedup currencies — one row per code
  const options = useMemo<CurrencyOption[]>(() => {
    const out: CurrencyOption[] = [
      { value: '',         label: 'Market currency',   symbol: '' },
      { value: '__BASE__', label: 'System (USD $)',    symbol: '$' },
    ]
    const seen = new Set<string>(['', '__BASE__', 'USD'])
    for (const c of countries) {
      if (!c.currency_code || seen.has(c.currency_code)) continue
      seen.add(c.currency_code)
      out.push({
        value: c.currency_code,
        label: `${c.currency_code} ${c.currency_symbol}`,
        symbol: c.currency_symbol || '',
      })
    }
    return out
  }, [countries])

  const value = useMemo<CurrencyContextValue>(() => ({
    currencyCode, setCurrencyCode, options, loading,
  }), [currencyCode, setCurrencyCode, options, loading])

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>
}

export function useCurrency() {
  return useContext(CurrencyContext)
}
