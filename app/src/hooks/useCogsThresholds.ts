import { useState, useEffect } from 'react'
import { useApi } from './useApi'

export interface CogsThresholds {
  excellent:  number
  acceptable: number
}

const DEFAULTS: CogsThresholds = { excellent: 28, acceptable: 35 }

/**
 * Loads the COGS colour thresholds used to paint COGS% cells across the app.
 *
 * Resolution order (first non-null wins):
 *   1. Per-market override on the selected country (cogs_threshold_excellent
 *      / cogs_threshold_acceptable on mcogs_countries)
 *   2. Global default in mcogs_settings.data.cogs_thresholds
 *   3. Hard-coded fallback { excellent: 28, acceptable: 35 }
 *
 * Pass `countryId` when the component knows which market it is rendering
 * (selected menu's country, Menu Engineer scope, etc.). Omit it for global
 * dashboards / admin screens.
 */
export function useCogsThresholds(countryId?: number | null): CogsThresholds {
  const api = useApi()
  const [global, setGlobal]   = useState<CogsThresholds>(DEFAULTS)
  const [market, setMarket]   = useState<CogsThresholds | null>(null)

  // Global settings — fetched once per mount regardless of countryId.
  useEffect(() => {
    api.get('/settings')
      .then((s: any) => {
        const e = Number(s?.cogs_thresholds?.excellent)
        const a = Number(s?.cogs_thresholds?.acceptable)
        if (e > 0 && a > 0) setGlobal({ excellent: e, acceptable: a })
      })
      .catch(() => { /* stay on defaults */ })
  }, [api])

  // Per-market override — refetches when countryId changes. When the market
  // has no override set, setMarket(null) and global wins.
  useEffect(() => {
    if (countryId == null) { setMarket(null); return }
    let cancelled = false
    api.get(`/countries`)
      .then((rows: any) => {
        if (cancelled) return
        const c = (rows || []).find((r: any) => r.id === countryId)
        const e = Number(c?.cogs_threshold_excellent)
        const a = Number(c?.cogs_threshold_acceptable)
        if (e > 0 && a > 0) setMarket({ excellent: e, acceptable: a })
        else setMarket(null)
      })
      .catch(() => { if (!cancelled) setMarket(null) })
    return () => { cancelled = true }
  }, [api, countryId])

  return market ?? global
}
