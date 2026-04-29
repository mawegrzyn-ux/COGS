// =============================================================================
// IntegrationStatusList — health pill grid for /api/ai-config/integration-status
//
// Used in two places:
//   1. Settings → AI tab as a top-of-page banner strip
//   2. Dashboard widget (`integration-status`) with configurable 1–4 col × 1–3
//      row layout — caller passes `cols` to control the grid breakpoint.
//
// Polls every 60 s by default (matches the server-side cache TTL). Pressing
// the refresh button forces ?force=1 so the server re-pings every integration.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { useApi } from '../hooks/useApi'

export interface IntegrationStatusRow {
  name:         string
  label:        string
  status:       'healthy' | 'unhealthy' | 'not_configured'
  latency_ms?:  number
  error?:       string
}

export interface IntegrationStatusResponse {
  checked_at:   string                       // ISO timestamp
  integrations: IntegrationStatusRow[]
  cached:       boolean
}

export interface IntegrationStatusListProps {
  /** Grid column count — 1 to 4. Defaults to 'auto' which uses
   *  Tailwind's `md:grid-cols-2 lg:grid-cols-3` responsive default. */
  cols?:    1 | 2 | 3 | 4 | 'auto'
  /** Hide the header (timestamp + refresh button) — used inside dense
   *  widgets where the parent already shows the metadata. */
  hideHeader?: boolean
  /** Polling interval in ms. 0 = disable polling (manual refresh only).
   *  Defaults to 60s, matching the server cache TTL. */
  pollMs?:   number
  /** Tighter padding + smaller font when used as a compact widget. */
  compact?: boolean
}

const STATUS_DOT: Record<IntegrationStatusRow['status'], string> = {
  healthy:        'bg-emerald-500',
  unhealthy:      'bg-red-500',
  not_configured: 'bg-gray-300',
}

const STATUS_LABEL: Record<IntegrationStatusRow['status'], string> = {
  healthy:        'Healthy',
  unhealthy:      'Unhealthy',
  not_configured: 'Not configured',
}

const STATUS_TINT: Record<IntegrationStatusRow['status'], string> = {
  healthy:        'border-emerald-200 bg-emerald-50/50',
  unhealthy:      'border-red-200    bg-red-50/50',
  not_configured: 'border-gray-200   bg-gray-50/50',
}

function gridCols(cols: IntegrationStatusListProps['cols']): string {
  switch (cols) {
    case 1: return 'grid-cols-1'
    case 2: return 'grid-cols-1 sm:grid-cols-2'
    case 3: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
    case 4: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
    default: return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  }
}

function formatLatency(ms?: number): string {
  if (ms == null) return ''
  if (ms < 1)        return '<1 ms'
  if (ms < 1000)     return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000))
  if (sec < 5)    return 'just now'
  if (sec < 60)   return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function IntegrationStatusList({
  cols = 'auto',
  hideHeader = false,
  pollMs = 60_000,
  compact = false,
}: IntegrationStatusListProps) {
  const api = useApi()
  const [data,    setData]    = useState<IntegrationStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const mountedRef = useRef(true)

  const load = async (force = false) => {
    if (force) setRefreshing(true)
    try {
      const url = force ? '/ai-config/integration-status?force=1' : '/ai-config/integration-status'
      const d = await api.get(url) as IntegrationStatusResponse
      if (mountedRef.current) {
        setData(d)
        setError(null)
      }
    } catch (err: unknown) {
      if (mountedRef.current) setError((err as { message?: string })?.message || 'Failed to load')
    } finally {
      if (mountedRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true
    load(false)
    if (pollMs > 0) {
      const t = setInterval(() => load(false), pollMs)
      return () => { mountedRef.current = false; clearInterval(t) }
    }
    return () => { mountedRef.current = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollMs])

  const padding   = compact ? 'px-3 py-2'   : 'px-4 py-3'
  const labelSize = compact ? 'text-xs'     : 'text-sm'
  const metaSize  = compact ? 'text-[10px]' : 'text-xs'

  return (
    <div className="space-y-3">
      {!hideHeader && (
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-text-3">
            {error
              ? <span className="text-red-500">Error: {error}</span>
              : data
                ? <>Last checked {formatRelative(data.checked_at)}{data.cached ? ' · cached' : ''}</>
                : 'Loading…'}
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            disabled={refreshing || loading}
            className="text-xs text-accent hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
            title="Force a fresh check (bypasses 60 s cache)"
          >{refreshing ? 'Refreshing…' : '↻ Refresh'}</button>
        </div>
      )}

      {loading && !data ? (
        <div className="text-sm text-text-3 italic">Checking integrations…</div>
      ) : data && (
        <div className={`grid gap-2 ${gridCols(cols)}`}>
          {data.integrations.map(row => (
            <div
              key={row.name}
              className={`rounded-lg border ${STATUS_TINT[row.status]} ${padding} flex items-start gap-2.5`}
              title={row.error ? `${STATUS_LABEL[row.status]} — ${row.error}` : STATUS_LABEL[row.status]}
            >
              <span
                className={`shrink-0 mt-1 w-2.5 h-2.5 rounded-full ${STATUS_DOT[row.status]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className={`${labelSize} font-semibold text-text-1 truncate`}>{row.label}</div>
                <div className={`${metaSize} text-text-3 mt-0.5 flex items-center gap-2`}>
                  <span>{STATUS_LABEL[row.status]}</span>
                  {row.latency_ms != null && row.status === 'healthy' && (
                    <span className="text-text-3">· {formatLatency(row.latency_ms)}</span>
                  )}
                  {row.error && (
                    <span className="text-red-500 truncate" title={row.error}>· {row.error}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
