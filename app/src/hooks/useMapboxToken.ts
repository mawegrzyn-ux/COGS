import { useEffect, useState } from 'react'
import { useApi } from './useApi'

// Module-level cache so multiple map widgets on the same dashboard don't each
// refetch. The token is a PUBLIC pk.xxx token — exposing it in memory across
// components is expected behaviour (Mapbox public tokens are meant for the
// browser and should be URL-restricted in the Mapbox dashboard).
let cachedToken: string | null | undefined = undefined
let inflight: Promise<string | null> | null = null

export function useMapboxToken() {
  const api = useApi()
  const [token, setToken] = useState<string | null | undefined>(cachedToken)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState<boolean>(cachedToken === undefined)

  useEffect(() => {
    if (cachedToken !== undefined) {
      setToken(cachedToken)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const p: Promise<string | null> = inflight ?? (inflight = api.get('/ai-config/mapbox-token')
      .then((r: any) => {
        cachedToken = r?.token || null
        inflight = null
        return cachedToken as string | null
      })
      .catch(() => {
        cachedToken = null
        inflight = null
        return null
      }))
    p.then(t => {
      if (cancelled) return
      setToken(t)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(e?.message || 'Failed to load Mapbox token')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [api])

  return { token, loading, error }
}
