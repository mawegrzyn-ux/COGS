import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl, { Map as MbMap, Popup } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'
import { useMapboxToken } from '../hooks/useMapboxToken'
import { useWidgetLabel } from './widgets'

// Country-boundaries tileset is bundled with Mapbox access.
// Each feature carries iso_3166_1 (alpha-2) + iso_3166_1_alpha_3 (alpha-3).
const COUNTRY_SRC_ID    = 'mb-countries'
const COUNTRY_FILL_LYR  = 'mb-countries-fill'
const COUNTRY_LINE_LYR  = 'mb-countries-line'

function fillForCogs(avg: number): string {
  if (avg <= 30) return '#146A34' // accent
  if (avg <= 40) return '#D97706'
  return '#DC2626'
}

export default function MapboxMap() {
  const { countries, countryId, setCountryId } = useMarket()
  const { menuTiles } = useDashboardData()
  const { token, loading: tokenLoading } = useMapboxToken()
  const label = useWidgetLabel('Mapbox World Map')

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef       = useRef<MbMap | null>(null)
  const popupRef     = useRef<Popup | null>(null)
  const [styleReady, setStyleReady] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [mapError,  setMapError]    = useState<string | null>(null)

  // Esc closes fullscreen + body scroll lock.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [fullscreen])

  // Avg COGS% per market (reuses same logic as the GeoJSON map).
  const avgCogsByMarket = useMemo(() => {
    const sum: Record<number, number> = {}
    const count: Record<number, number> = {}
    for (const tile of menuTiles) {
      const vals = tile.levels.map(l => l.cogs_pct).filter((p): p is number => p != null)
      if (!vals.length) continue
      const avg = vals.reduce((s, n) => s + n, 0) / vals.length
      sum[tile.country_id]   = (sum[tile.country_id]   || 0) + avg
      count[tile.country_id] = (count[tile.country_id] || 0) + 1
    }
    const out: Record<number, number> = {}
    for (const k of Object.keys(sum)) {
      const id = Number(k)
      out[id] = sum[id] / count[id]
    }
    return out
  }, [menuTiles])

  // Group markets by their ISO 3166-1 alpha-2, compute fill colour per country.
  // Shape: iso2 → { color, markets: Market[] }
  const countryFillData = useMemo(() => {
    const byIso = new Map<string, { color: string; markets: typeof countries }>()
    const groups = new Map<string, typeof countries>()
    for (const c of countries) {
      const iso = (c.country_iso || '').toUpperCase()
      if (!iso) continue
      const list = groups.get(iso) ?? []
      list.push(c)
      groups.set(iso, list)
    }
    for (const [iso, markets] of groups.entries()) {
      const vals = markets.map(m => avgCogsByMarket[m.id]).filter(v => v != null) as number[]
      const color = vals.length
        ? fillForCogs(vals.reduce((s, n) => s + n, 0) / vals.length)
        : '#E8F5ED' // accent-dim — has markets but no COGS data
      byIso.set(iso, { color, markets })
    }
    return byIso
  }, [countries, avgCogsByMarket])

  // List of ISO codes that have markets — used to filter the fill layer so
  // only "in scope" countries get coloured. Countries with no markets render
  // in the default style's neutral fill.
  const includedIsos = useMemo(() => Array.from(countryFillData.keys()), [countryFillData])

  // Selected-market ISO (for the highlight ring).
  const selectedIso = useMemo(() => {
    if (countryId == null) return null
    const m = countries.find(c => c.id === countryId)
    return (m?.country_iso || '').toUpperCase() || null
  }, [countries, countryId])

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return
    try {
      mapboxgl.accessToken = token
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [0, 25],
        zoom: 1.1,
        projection: 'mercator',
        attributionControl: false,
      })
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new mapboxgl.AttributionControl({ compact: true }))
      map.on('style.load', () => {
        // Country-boundaries tileset is already included with Mapbox styles.
        map.addSource(COUNTRY_SRC_ID, {
          type: 'vector',
          url:  'mapbox://mapbox.country-boundaries-v1',
        })
        map.addLayer({
          id: COUNTRY_FILL_LYR,
          type: 'fill',
          source: COUNTRY_SRC_ID,
          'source-layer': 'country_boundaries',
          paint: {
            'fill-color': '#CBD5E1',
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false], 0.95,
              ['boolean', ['feature-state', 'selected'], false], 0.9,
              0.7,
            ],
          },
          filter: ['==', ['get', 'disputed'], 'false'],
        })
        map.addLayer({
          id: COUNTRY_LINE_LYR,
          type: 'line',
          source: COUNTRY_SRC_ID,
          'source-layer': 'country_boundaries',
          paint: {
            'line-color': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], '#146A34',
              '#ffffff',
            ],
            'line-width': [
              'case',
              ['boolean', ['feature-state', 'selected'], false], 2,
              0.5,
            ],
          },
        })
        setStyleReady(true)
      })
      map.on('error', (e) => {
        // eslint-disable-next-line no-console
        console.error('[MapboxMap]', e.error)
        if (e?.error?.message) setMapError(e.error.message)
      })
      mapRef.current = map
    } catch (err: any) {
      setMapError(err?.message || 'Failed to initialise Mapbox')
    }
    return () => {
      popupRef.current?.remove(); popupRef.current = null
      mapRef.current?.remove();   mapRef.current = null
      setStyleReady(false)
    }
  }, [token])

  // ── Apply colour + selection whenever market data changes ─────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    // Paint per-iso colour via a data-driven 'match' expression.
    const matchExpr: any[] = ['match', ['upcase', ['get', 'iso_3166_1']]]
    for (const [iso, { color }] of countryFillData.entries()) {
      matchExpr.push(iso, color)
    }
    matchExpr.push('#CBD5E1') // default = slate-300 (out of scope)

    try {
      map.setPaintProperty(COUNTRY_FILL_LYR, 'fill-color', matchExpr as any)
    } catch { /* style may still be swapping — next effect run will catch it */ }

    // Selection state via feature-state (needs promoteId, which the country
    // tileset doesn't support — instead we use a runtime filter layer).
    // Easiest: recompute the 'selected' state on line layer width by expression.
    try {
      map.setPaintProperty(COUNTRY_LINE_LYR, 'line-color', [
        'case',
        ['==', ['upcase', ['get', 'iso_3166_1']], selectedIso ?? ''],
        '#146A34',
        '#ffffff',
      ] as any)
      map.setPaintProperty(COUNTRY_LINE_LYR, 'line-width', [
        'case',
        ['==', ['upcase', ['get', 'iso_3166_1']], selectedIso ?? ''],
        2.5,
        0.5,
      ] as any)
    } catch { /* ignore */ }
  }, [countryFillData, selectedIso, styleReady, includedIsos])

  // ── Hover + click handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    const onMove = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [COUNTRY_FILL_LYR] })
      if (!features.length) {
        map.getCanvas().style.cursor = ''
        popupRef.current?.remove()
        popupRef.current = null
        return
      }
      const f = features[0]
      const iso = String(f.properties?.iso_3166_1 || '').toUpperCase()
      const entry = countryFillData.get(iso)
      map.getCanvas().style.cursor = entry ? 'pointer' : ''
      if (!entry) {
        popupRef.current?.remove()
        popupRef.current = null
        return
      }
      const name = String(f.properties?.name_en || f.properties?.name || iso)
      const lines = entry.markets.map(m => {
        const cogs = avgCogsByMarket[m.id]
        const cogsStr = cogs != null ? ` — ${cogs.toFixed(1)}% COGS` : ''
        return `<div style="font-size:11px;color:#2D4A38">${escapeHtml(m.name)}${cogsStr}</div>`
      }).join('')
      const html = `
        <div style="font-family:Nunito,system-ui,sans-serif;padding:6px 2px">
          <div style="font-size:12px;font-weight:600;color:#0F1F17;margin-bottom:4px">${escapeHtml(name)}</div>
          ${lines}
        </div>`
      if (!popupRef.current) {
        popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
      }
      popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map)
    }

    const onLeave = () => {
      map.getCanvas().style.cursor = ''
      popupRef.current?.remove()
      popupRef.current = null
    }

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [COUNTRY_FILL_LYR] })
      if (!features.length) return
      const iso = String(features[0].properties?.iso_3166_1 || '').toUpperCase()
      const entry = countryFillData.get(iso)
      if (!entry || !entry.markets.length) return
      // If this country already selected, clear; if only one market, select it;
      // if multiple markets, pick the first (for now — could open a chooser).
      const first = entry.markets[0]
      if (countryId === first.id) setCountryId(null)
      else setCountryId(first.id)
    }

    map.on('mousemove', COUNTRY_FILL_LYR, onMove)
    map.on('mouseleave', COUNTRY_FILL_LYR, onLeave)
    map.on('click', COUNTRY_FILL_LYR, onClick)
    return () => {
      map.off('mousemove', COUNTRY_FILL_LYR, onMove)
      map.off('mouseleave', COUNTRY_FILL_LYR, onLeave)
      map.off('click', COUNTRY_FILL_LYR, onClick)
    }
  }, [styleReady, countryFillData, avgCogsByMarket, countryId, setCountryId])

  // Resize when fullscreen toggles — mapbox needs a nudge after layout change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = setTimeout(() => map.resize(), 150)
    return () => clearTimeout(t)
  }, [fullscreen])

  // Fullscreen CSS (same Pepper-aware insets as MarketMap).
  const fullscreenStyle: React.CSSProperties = fullscreen
    ? {
        top:    0,
        left:   'var(--pepper-left, 0px)',
        right:  'var(--pepper-right, 0px)',
        bottom: 'var(--pepper-bottom, 0px)',
      }
    : {}
  const containerClass = fullscreen
    ? 'fixed z-40 bg-surface p-6 flex flex-col overflow-auto'
    : 'card p-5 h-full relative overflow-hidden'

  const selectedMarket = countries.find(c => c.id === countryId) ?? null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={containerClass} style={fullscreenStyle}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">{label}</h2>
          <p className="text-xs text-text-3 mt-0.5">
            Powered by Mapbox — click a country to select its market
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedMarket ? (
            <button onClick={() => setCountryId(null)}
              className="text-xs text-accent hover:underline">✕ Clear</button>
          ) : (
            <span className="text-xs text-text-3">No market selected</span>
          )}
          <button
            onClick={() => setFullscreen(v => !v)}
            className="text-xs text-text-3 hover:text-text-1 px-2 py-1 rounded hover:bg-surface-2 transition-colors flex items-center gap-1"
            title={fullscreen ? 'Exit full screen (Esc)' : 'Open full screen'}
            aria-label={fullscreen ? 'Exit full screen' : 'Open full screen'}
          >
            {fullscreen ? '⤢ Exit' : '⛶ Full screen'}
          </button>
        </div>
      </div>

      {tokenLoading ? (
        <div className="h-64 bg-surface-2 rounded-lg animate-pulse" />
      ) : !token ? (
        <div className="h-64 flex flex-col items-center justify-center text-sm text-text-3 gap-2 p-6 text-center">
          <div className="font-medium text-text-1">Mapbox not configured</div>
          <div>Add a public access token in <span className="font-medium">System → AI → Mapbox Integration</span> to enable the Mapbox widget.</div>
          <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer"
             className="text-xs text-accent hover:underline">Create a Mapbox token →</a>
        </div>
      ) : mapError ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3">
          Map error: {mapError}
        </div>
      ) : (
        <div className="relative flex-1" style={{ minHeight: fullscreen ? undefined : 380 }}>
          <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden"
               style={{ minHeight: fullscreen ? 'calc(100vh - 140px)' : 380 }} />
          {!styleReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-2/60 rounded-lg">
              <span
                className="inline-flex items-center gap-1.5 text-[10px] text-text-3 px-2 py-0.5 rounded-full bg-surface border border-border"
              >
                <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
                Loading Mapbox…
              </span>
            </div>
          )}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3 mt-3">
            <Legend color="#146A34" label="COGS ≤ 30%" />
            <Legend color="#D97706" label="≤ 40%" />
            <Legend color="#DC2626" label="> 40%" />
            <Legend color="#E8F5ED" label="No data" />
            <Legend color="#CBD5E1" label="Not in scope" />
            <span className="ml-auto text-text-3/60">{countries.length} markets</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded" style={{ background: color }} />
      {label}
    </span>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => (
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;'  :
    c === '>' ? '&gt;'  :
    c === '"' ? '&quot;': '&#39;'
  ))
}
