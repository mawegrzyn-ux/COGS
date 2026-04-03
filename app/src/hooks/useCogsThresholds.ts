import { useState, useEffect } from 'react'
import { useApi } from './useApi'

export interface CogsThresholds {
  excellent:  number
  acceptable: number
}

const DEFAULTS: CogsThresholds = { excellent: 28, acceptable: 35 }

/**
 * Loads the COGS colour thresholds from system settings once per mount.
 * Falls back to { excellent: 28, acceptable: 35 } if settings are unavailable.
 * Used by any component that needs to colour-code COGS% values consistently
 * with the thresholds configured in Settings → COGS Thresholds.
 */
export function useCogsThresholds(): CogsThresholds {
  const api = useApi()
  const [thresholds, setThresholds] = useState<CogsThresholds>(DEFAULTS)

  useEffect(() => {
    api.get('/settings')
      .then((s: any) => {
        const e = Number(s?.cogs_thresholds?.excellent)
        const a = Number(s?.cogs_thresholds?.acceptable)
        if (e > 0 && a > 0) setThresholds({ excellent: e, acceptable: a })
      })
      .catch(() => { /* stay on defaults */ })
  }, [api])

  return thresholds
}
