import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl, { Map as MbMap, Popup, Marker } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { geoBounds } from 'd3-geo'
import { useApi } from '../hooks/useApi'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'
import { useMapboxToken } from '../hooks/useMapboxToken'
import { useWidgetLabel, useIsWidgetPopout } from './widgets'

// ── Constants ────────────────────────────────────────────────────────────────
const COUNTRY_MASK_SRC     = 'mb-country-mask'
const COUNTRY_MASK_LYR     = 'mb-country-mask-line'
// Solid fill covering every country EXCEPT the focused one — visually hides
// all surrounding countries (their fills, roads, borders) while letting the
// focused country show through. Labels are then filtered separately so only
// names within the focused country remain.
const COUNTRY_OUTSIDE_FILL = 'mb-country-outside-fill'

const REGION_SRC_ID     = 'mb-country-regions'
const REGION_FILL_LYR   = 'mb-country-regions-fill'
const REGION_LINE_LYR   = 'mb-country-regions-line'

// Mapbox Light style label layers we filter down to the focused country only.
// We try each one in a try/catch since the list is style-version specific.
const LABEL_LAYERS_TO_FILTER_BY_ISO1: string[] = [
  'country-label',
  'settlement-major-label',
  'settlement-subdivision-label',
  'natural-point-label',
  'water-point-label',
  'waterway-label',
  'airport-label',
]
const LABEL_LAYERS_TO_FILTER_BY_ISO2_PREFIX: string[] = [
  'state-label', // iso_3166_2 starts with "IN-", "US-", etc.
]

const ADMIN1_GEO_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson'

const COLOR_ACCENT     = '#146A34'
const COLOR_AMBER      = '#D97706'
const COLOR_RED        = '#DC2626'
const COLOR_ACCENT_DIM = '#E8F5ED'
const COLOR_BORDER     = '#D8E6DD'

function fillForCogs(avg: number): string {
  if (avg <= 30) return COLOR_ACCENT
  if (avg <= 40) return COLOR_AMBER
  return COLOR_RED
}

const LAYER_PREFIXES_TO_HIDE = [
  'road', 'bridge', 'tunnel', 'transit',
  'poi', 'building', 'landuse',
  'settlement-minor-label', 'settlement-subdivision-label', 'path',
  'aeroway', 'ferry', 'crosswalk',
]

interface RegionRow { id: number; country_iso: string; name: string; iso_code: string | null }
interface Location  { id: number; name: string; country_id: number; latitude: number | null; longitude: number | null }

/**
 * Zoomed-in Mapbox view of ONE country. Follows the globally-selected market
 * in MarketContext. Shows admin-1 regions within the country coloured by
 * market coverage + city pins for locations with captured lat/lng.
 */
export default function MapboxCountryMap() {
  const api = useApi()
  const { selected, countries, setCountryId } = useMarket()
  const { menuTiles } = useDashboardData()
  const { token, loading: tokenLoading } = useMapboxToken()
  const label = useWidgetLabel('Country Regions (Mapbox)')
  const isPopout = useIsWidgetPopout()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef       = useRef<MbMap | null>(null)
  const popupRef     = useRef<Popup | null>(null)
  const markersRef   = useRef<Marker[]>([])
  const hoverIsoRef  = useRef<string | null>(null)

  const [styleReady, setStyleReady] = useState(false)
  const [mapError,   setMapError]   = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const [regionGeo, setRegionGeo]   = useState<any>(null)
  const [regionGeoLoading, setRegionGeoLoading] = useState(false)
  const [regions, setRegions]       = useState<RegionRow[]>([])
  const [locations, setLocations]   = useState<Location[]>([])

  // Auto-fullscreen when popped out
  useEffect(() => { if (isPopout) setFullscreen(true) }, [isPopout])

  // Esc closes fullscreen
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

  // Load admin-1 GeoJSON + regions + locations
  useEffect(() => {
    const ctrl = new AbortController()
    setRegionGeoLoading(true)
    fetch(ADMIN1_GEO_URL, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { setRegionGeo(j); setRegionGeoLoading(false) })
      .catch(e => {
        if (e?.name === 'AbortError') return
        setMapError(e.message || 'Failed to load region data')
        setRegionGeoLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api.get('/regions').catch(() => []),
      api.get('/locations').catch(() => []),
    ]).then(([rgn, loc]: any[]) => {
      if (cancelled) return
      setRegions(rgn || [])
      setLocations(loc || [])
    })
    return () => { cancelled = true }
  }, [api])

  const iso = (selected?.country_iso || '').toUpperCase()

  // Derivations (match MarketMap / MapboxMap semantics)
  const avgCogsByMarket = useMemo(() => {
    const sum: Record<number, number> = {}
    const cnt: Record<number, number> = {}
    for (const tile of menuTiles) {
      const vals = tile.levels.map(l => l.cogs_pct).filter((p): p is number => p != null)
      if (!vals.length) continue
      const avg = vals.reduce((s, n) => s + n, 0) / vals.length
      sum[tile.country_id] = (sum[tile.country_id] || 0) + avg
      cnt[tile.country_id] = (cnt[tile.country_id] || 0) + 1
    }
    const out: Record<number, number> = {}
    for (const k of Object.keys(sum)) out[Number(k)] = sum[Number(k)] / cnt[Number(k)]
    return out
  }, [menuTiles])

  const regionIdToIso = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of regions) if (r.iso_code) m.set(r.id, r.iso_code.toUpperCase())
    return m
  }, [regions])

  // Which region ISO → which markets claim it (only for the current country)
  const regionFillData = useMemo(() => {
    const out = new Map<string, { color: string; markets: typeof countries }>()
    if (!iso) return out
    const groups = new Map<string, typeof countries>()
    for (const c of countries) {
      if ((c.country_iso || '').toUpperCase() !== iso) continue
      const regionIds = Array.isArray(c.region_ids) ? c.region_ids : []
      if (!regionIds.length) continue // whole-country markets don't claim specific regions
      for (const id of regionIds) {
        const code = regionIdToIso.get(id)
        if (!code) continue
        const list = groups.get(code) ?? []
        list.push(c)
        groups.set(code, list)
      }
    }
    for (const [iso2, markets] of groups.entries()) {
      const vals = markets.map(m => avgCogsByMarket[m.id]).filter(v => v != null) as number[]
      const color = vals.length
        ? fillForCogs(vals.reduce((s, n) => s + n, 0) / vals.length)
        : COLOR_ACCENT_DIM
      out.set(iso2, { color, markets })
    }
    return out
  }, [countries, regionIdToIso, iso, avgCogsByMarket])

  // GeoJSON filtered to the selected country's regions, with stable ids.
  const countryFeatureCollection = useMemo(() => {
    if (!regionGeo || !iso) return null
    const feats = (regionGeo.features || []).filter((f: any) => {
      const iso2 = String(f.properties?.iso_3166_2 || '').toUpperCase()
      return iso2.startsWith(`${iso}-`)
    }).map((f: any) => ({ ...f, id: String(f.properties?.iso_3166_2 || '').toUpperCase() }))
    return { type: 'FeatureCollection', features: feats } as any
  }, [regionGeo, iso])

  // Bounds for fitBounds
  const countryBounds = useMemo(() => {
    if (!countryFeatureCollection || !countryFeatureCollection.features.length) return null
    try {
      const b = geoBounds(countryFeatureCollection as any) as [[number, number], [number, number]]
      if (!isFinite(b[0][0])) return null
      return b
    } catch {
      return null
    }
  }, [countryFeatureCollection])

  // City pins — locations in this country with captured coordinates.
  const cityPins = useMemo(() => {
    if (!selected) return []
    return locations.filter(l =>
      l.country_id === selected.id &&
      l.latitude != null && l.longitude != null &&
      !Number.isNaN(Number(l.latitude)) && !Number.isNaN(Number(l.longitude))
    )
  }, [locations, selected])

  // ── Init map once per token ────────────────────────────────────────────────
  useEffect(() => {
    if (!token || !containerRef.current || mapRef.current) return
    try {
      mapboxgl.accessToken = token
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [0, 25],
        zoom: 1.2,
        projection: { name: 'mercator' } as any,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      })
      map.touchZoomRotate.disableRotation()
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new mapboxgl.AttributionControl({ compact: true }))

      map.on('style.load', () => {
        const s = map.getStyle()
        if (s?.layers) {
          for (const layer of s.layers) {
            if (LAYER_PREFIXES_TO_HIDE.some(p => layer.id.startsWith(p))) {
              try { map.setLayoutProperty(layer.id, 'visibility', 'none') } catch { /* ignore */ }
            }
          }
        }

        // Country outline via mapbox boundaries — a thin accent ring around
        // the focused country provides a strong visual anchor even if our
        // admin-1 GeoJSON doesn't cover it.
        map.addSource(COUNTRY_MASK_SRC, {
          type: 'vector',
          url: 'mapbox://mapbox.country-boundaries-v1',
          promoteId: { country_boundaries: 'iso_3166_1' },
        } as any)

        // Masking fill — covers every country whose ISO is NOT the focused
        // one. Filter starts as "never" (no focus yet) and is updated when a
        // country is selected. Inserted above the base style's land/road
        // layers but below the region + outline layers we add next so those
        // remain visible on top.
        map.addLayer({
          id: COUNTRY_OUTSIDE_FILL,
          type: 'fill',
          source: COUNTRY_MASK_SRC,
          'source-layer': 'country_boundaries',
          paint: {
            'fill-color': '#F7F9F8', // design token surface-2
            'fill-opacity': 0.95,
          },
          filter: ['==', ['upcase', ['get', 'iso_3166_1']], '___NEVER___'],
        })

        map.addLayer({
          id: COUNTRY_MASK_LYR,
          type: 'line',
          source: COUNTRY_MASK_SRC,
          'source-layer': 'country_boundaries',
          paint: {
            'line-color': COLOR_ACCENT,
            'line-width': 1.5,
            'line-opacity': 0.9,
          },
          filter: ['==', ['upcase', ['get', 'iso_3166_1']], ''], // updated when iso changes
        })

        setStyleReady(true)
      })

      map.on('error', (e) => {
        // eslint-disable-next-line no-console
        console.error('[MapboxCountryMap]', e.error)
        if (e?.error?.message) setMapError(e.error.message)
      })

      mapRef.current = map
    } catch (err: any) {
      setMapError(err?.message || 'Failed to initialise Mapbox')
    }
    return () => {
      for (const m of markersRef.current) m.remove()
      markersRef.current = []
      popupRef.current?.remove(); popupRef.current = null
      mapRef.current?.remove();   mapRef.current = null
      setStyleReady(false)
    }
  }, [token])

  // ── Update / add region source + layers when data arrives ─────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    const geojson = countryFeatureCollection ?? { type: 'FeatureCollection', features: [] } as any
    const existing = map.getSource(REGION_SRC_ID) as mapboxgl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(geojson)
    } else {
      map.addSource(REGION_SRC_ID, { type: 'geojson', data: geojson, promoteId: 'iso_3166_2' } as any)
      map.addLayer({
        id: REGION_FILL_LYR,
        type: 'fill',
        source: REGION_SRC_ID,
        paint: {
          'fill-color': '#FFFFFF',
          'fill-opacity': [
            'case',
            ['boolean', ['feature-state', 'hover'], false], 0.92,
            0.78,
          ],
          'fill-opacity-transition': { duration: 150 },
        },
      })
      map.addLayer({
        id: REGION_LINE_LYR,
        type: 'line',
        source: REGION_SRC_ID,
        paint: {
          'line-color': COLOR_BORDER,
          'line-width': 0.5,
          'line-opacity': 0.8,
        },
      })
    }
  }, [countryFeatureCollection, styleReady])

  // Apply all iso-dependent filters: country outline, masking fill for the
  // rest of the world, and label filters so only names inside the focused
  // country are visible. Every setFilter is try/caught because the style's
  // layer ids are version-specific and we'd rather silently keep a label
  // visible than crash the map on a style update.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    // Country outline — show only the focused country's border.
    if (map.getLayer(COUNTRY_MASK_LYR)) {
      try {
        map.setFilter(COUNTRY_MASK_LYR, ['==', ['upcase', ['get', 'iso_3166_1']], iso])
      } catch { /* ignore */ }
    }

    // Masking fill — cover everything EXCEPT the focused country.
    // `'___NEVER___'` placeholder when no iso so nothing is masked.
    if (map.getLayer(COUNTRY_OUTSIDE_FILL)) {
      try {
        const maskFilter: any = iso
          ? ['!=', ['upcase', ['get', 'iso_3166_1']], iso]
          : ['==', ['upcase', ['get', 'iso_3166_1']], '___NEVER___']
        map.setFilter(COUNTRY_OUTSIDE_FILL, maskFilter)
      } catch { /* ignore */ }
    }

    // Labels keyed off iso_3166_1 (country, cities, airports, etc.).
    for (const layerId of LABEL_LAYERS_TO_FILTER_BY_ISO1) {
      if (!map.getLayer(layerId)) continue
      try {
        const f: any = iso
          ? ['==', ['upcase', ['get', 'iso_3166_1']], iso]
          : null // restore default (show all) when no country is focused
        map.setFilter(layerId, f)
      } catch { /* ignore — layer may not have iso_3166_1 property */ }
    }

    // Labels keyed off iso_3166_2 (states/provinces) — filter by prefix.
    for (const layerId of LABEL_LAYERS_TO_FILTER_BY_ISO2_PREFIX) {
      if (!map.getLayer(layerId)) continue
      try {
        const f: any = iso
          ? ['==', ['slice', ['upcase', ['get', 'iso_3166_2']], 0, 2], iso]
          : null
        map.setFilter(layerId, f)
      } catch { /* ignore */ }
    }
  }, [iso, styleReady])

  // Region fill colour
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    if (!map.getLayer(REGION_FILL_LYR)) return
    const pairs: any[] = []
    for (const [iso2, { color }] of regionFillData.entries()) pairs.push(iso2, color)
    const fillColorExpr: any = pairs.length
      ? ['match', ['upcase', ['get', 'iso_3166_2']], ...pairs, '#ECEEF0']
      : '#ECEEF0'
    try { map.setPaintProperty(REGION_FILL_LYR, 'fill-color', fillColorExpr) } catch { /* ignore */ }
  }, [regionFillData, styleReady])

  // Fit bounds whenever the selected country changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    if (!countryBounds) return
    try {
      map.fitBounds(
        [[countryBounds[0][0], countryBounds[0][1]], [countryBounds[1][0], countryBounds[1][1]]],
        { padding: 40, duration: 900, maxZoom: 7 },
      )
    } catch { /* ignore */ }
  }, [countryBounds, styleReady])

  // Hover + click
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !map.getLayer(REGION_FILL_LYR)) return

    const clearHover = () => {
      if (hoverIsoRef.current) {
        try { map.removeFeatureState({ source: REGION_SRC_ID, id: hoverIsoRef.current }) } catch { /* ignore */ }
        hoverIsoRef.current = null
      }
    }

    const onMove = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [REGION_FILL_LYR] })
      if (!features.length) { clearHover(); popupRef.current?.remove(); popupRef.current = null; map.getCanvas().style.cursor = ''; return }
      const f = features[0]
      const iso2 = String(f.properties?.iso_3166_2 || '').toUpperCase()
      const entry = regionFillData.get(iso2)
      map.getCanvas().style.cursor = entry ? 'pointer' : ''
      if (hoverIsoRef.current !== iso2) {
        clearHover()
        if (entry) {
          try { map.setFeatureState({ source: REGION_SRC_ID, id: iso2 }, { hover: true }) } catch { /* ignore */ }
          hoverIsoRef.current = iso2
        }
      }

      const regionName = String(f.properties?.name || f.properties?.name_en || iso2)
      const marketLines = (entry?.markets ?? []).map(m => {
        const cogs = avgCogsByMarket[m.id]
        const cogsStr = cogs != null ? ` · ${cogs.toFixed(1)}%` : ''
        return `<div style="font-size:11px;color:var(--text-2);line-height:1.4">${escapeHtml(m.name)}${cogsStr}</div>`
      }).join('')
      const html = `
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--text-1);margin-bottom:2px">${escapeHtml(regionName)}</div>
          <div style="font-size:10px;color:var(--text-3);margin-bottom:4px">${escapeHtml(iso2)}</div>
          ${marketLines || '<div style="font-size:11px;color:var(--text-3)">Not in scope</div>'}
        </div>`
      if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
      popupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(map)
    }

    const onLeave = () => {
      clearHover(); map.getCanvas().style.cursor = ''; popupRef.current?.remove(); popupRef.current = null
    }

    const onClick = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [REGION_FILL_LYR] })
      if (!features.length) return
      const iso2 = String(features[0].properties?.iso_3166_2 || '').toUpperCase()
      const entry = regionFillData.get(iso2)
      if (!entry?.markets.length) return
      const first = entry.markets[0]
      setCountryId(first.id)
    }

    map.on('mousemove', REGION_FILL_LYR, onMove)
    map.on('mouseleave', REGION_FILL_LYR, onLeave)
    map.on('click', REGION_FILL_LYR, onClick)
    return () => {
      map.off('mousemove', REGION_FILL_LYR, onMove)
      map.off('mouseleave', REGION_FILL_LYR, onLeave)
      map.off('click', REGION_FILL_LYR, onClick)
    }
  }, [styleReady, regionFillData, avgCogsByMarket, setCountryId])

  // City pins
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    // Clear existing
    for (const m of markersRef.current) m.remove()
    markersRef.current = []

    for (const loc of cityPins) {
      const el = document.createElement('div')
      el.style.cssText = `
        width: 10px; height: 10px; border-radius: 999px;
        background: ${COLOR_ACCENT}; border: 2px solid white;
        box-shadow: 0 0 0 1px rgba(15,31,23,0.15);
        cursor: pointer;
      `
      el.title = loc.name
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([Number(loc.longitude), Number(loc.latitude)])
        .addTo(map)
      markersRef.current.push(marker)
    }
    return () => { /* handled by next invocation */ }
  }, [cityPins, styleReady])

  // Resize on fullscreen toggle
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const t = setTimeout(() => map.resize(), 150)
    return () => clearTimeout(t)
  }, [fullscreen])

  const fullscreenStyle: React.CSSProperties = fullscreen
    ? { top: 0, left: 'var(--pepper-left, 0px)', right: 'var(--pepper-right, 0px)', bottom: 'var(--pepper-bottom, 0px)' }
    : {}
  const containerClass = fullscreen
    ? 'fixed z-40 bg-surface p-6 flex flex-col overflow-auto mapbox-widget'
    : 'card p-5 h-full relative overflow-hidden mapbox-widget'

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!tokenLoading && !token) {
    return (
      <div className="card p-5 h-full flex flex-col items-center justify-center text-sm text-text-3 gap-2 text-center mapbox-widget">
        <div className="font-medium text-text-1">Mapbox not configured</div>
        <div>Add a public access token in <span className="font-medium">System → AI → Mapbox Integration</span>.</div>
      </div>
    )
  }

  if (!tokenLoading && token?.startsWith('sk.')) {
    return (
      <div className="card p-5 h-full flex flex-col items-center justify-center text-sm text-text-3 gap-2 text-center mapbox-widget">
        <div className="font-medium text-text-1">Wrong token type</div>
        <div>Replace the <code className="px-1 rounded bg-surface-2">sk.</code> token with a <code className="px-1 rounded bg-surface-2">pk.</code> public token.</div>
      </div>
    )
  }

  if (!selected) {
    return (
      <div className="card p-5 h-full flex flex-col items-center justify-center text-sm text-text-3 text-center mapbox-widget">
        <div className="font-medium text-text-1 mb-1">Country Regions (Mapbox)</div>
        <div>Pick a market to zoom into its country.</div>
      </div>
    )
  }

  return (
    <div className={containerClass} style={fullscreenStyle}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">{label}</h2>
          <p className="text-xs text-text-3 mt-0.5">
            {selected.name} — {cityPins.length ? `${cityPins.length} location pin${cityPins.length === 1 ? '' : 's'}` : 'No location pins'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {regionGeoLoading && (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-text-3 px-2 py-0.5 rounded-full bg-surface-2 border border-border">
              <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
              Loading regions…
            </span>
          )}
          {!isPopout && (
            <button
              onClick={() => setFullscreen(v => !v)}
              className="text-xs text-text-3 hover:text-text-1 px-2 py-1 rounded hover:bg-surface-2 transition-colors flex items-center gap-1"
              title={fullscreen ? 'Exit full screen (Esc)' : 'Open full screen'}
              aria-label={fullscreen ? 'Exit full screen' : 'Open full screen'}
            >
              {fullscreen ? '⤢ Exit' : '⛶ Full screen'}
            </button>
          )}
        </div>
      </div>

      {mapError ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3">Map error: {mapError}</div>
      ) : (
        <div className="relative flex-1" style={{ minHeight: fullscreen ? undefined : 380 }}>
          <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden border border-border"
               style={{ minHeight: fullscreen ? 'calc(100vh - 140px)' : 380 }} />
          {!styleReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-surface-2/60 rounded-lg">
              <span className="inline-flex items-center gap-1.5 text-[10px] text-text-3 px-2 py-0.5 rounded-full bg-surface border border-border">
                <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
                Loading Mapbox…
              </span>
            </div>
          )}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3 mt-3">
            <Legend color={COLOR_ACCENT}     label="COGS ≤ 30%" />
            <Legend color={COLOR_AMBER}      label="≤ 40%" />
            <Legend color={COLOR_RED}        label="> 40%" />
            <Legend color={COLOR_ACCENT_DIM} label="No data" />
            <Legend color="#ECEEF0"          label="Not in scope" />
            <span className="ml-auto text-text-3/60">
              {regionFillData.size} region{regionFillData.size === 1 ? '' : 's'} claimed
            </span>
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
