import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl, { Map as MbMap, Popup } from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { useApi } from '../hooks/useApi'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'
import { useMapboxToken } from '../hooks/useMapboxToken'
import { useWidgetLabel, useIsWidgetPopout } from './widgets'

// ── Constants ────────────────────────────────────────────────────────────────
const COUNTRY_SRC_ID   = 'mb-countries'
const COUNTRY_FILL_LYR = 'mb-countries-fill'
const COUNTRY_LINE_LYR = 'mb-countries-line'

const REGION_SRC_ID    = 'mb-regions'
const REGION_FILL_LYR  = 'mb-regions-fill'
const REGION_LINE_LYR  = 'mb-regions-line'

// Natural-earth 50m admin-1. Covers 9 large countries (US/CA/BR/RU/CN/IN/ID/AU/ZA) —
// sufficient as a Mapbox overlay; everywhere else falls back to country-level fill.
const ADMIN1_GEO_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson'

// Design tokens (kept in sync with index.css :root)
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

type MapView = 'country' | 'region'

interface RegionRow {
  id:          number
  country_iso: string
  name:        string
  iso_code:    string | null
}

// Default-style layers we hide for a cleaner dashboard look. Every style.layer
// whose id *starts with* one of these is removed. Kept subtle enough that the
// geography still reads well — boundaries and country labels remain.
const LAYER_PREFIXES_TO_HIDE = [
  'road', 'bridge', 'tunnel', 'transit',
  'poi', 'building', 'landuse',
  'settlement-minor-label', 'settlement-subdivision-label', 'path',
  'aeroway', 'ferry', 'crosswalk',
]

export default function MapboxMap() {
  const api = useApi()
  const { countries, countryId, setCountryId } = useMarket()
  const { menuTiles } = useDashboardData()
  const { token, loading: tokenLoading } = useMapboxToken()
  const label = useWidgetLabel('Mapbox World Map')
  const isPopout = useIsWidgetPopout()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef       = useRef<MbMap | null>(null)
  const popupRef     = useRef<Popup | null>(null)
  const hoverIsoRef  = useRef<string | null>(null)

  const [styleReady,   setStyleReady]   = useState(false)
  const [fullscreen,   setFullscreen]   = useState(false)
  const [mapError,     setMapError]     = useState<string | null>(null)

  const [view, setView] = useState<MapView>('country')
  const [regionGeo, setRegionGeo]       = useState<any>(null)
  const [regionGeoLoading, setRegionGeoLoading] = useState(false)
  const [regions, setRegions]           = useState<RegionRow[]>([])

  // When rendered in the pop-out window, expand to fill the viewport
  // automatically — the user opened a dedicated window specifically for this
  // widget, so they want it maximised.
  useEffect(() => {
    if (isPopout) setFullscreen(true)
  }, [isPopout])

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

  // Fetch regions catalog once (region_id → iso_3166_2).
  useEffect(() => {
    let cancelled = false
    api.get('/regions')
      .then((rows: any) => { if (!cancelled) setRegions(rows || []) })
      .catch(() => { /* non-fatal */ })
  }, [api])

  // Lazy-load admin-1 GeoJSON when the user flips to region view.
  useEffect(() => {
    if (view !== 'region' || regionGeo) return
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
  }, [view, regionGeo])

  // ── Avg COGS per market ────────────────────────────────────────────────────
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
    for (const k of Object.keys(sum)) out[Number(k)] = sum[Number(k)] / count[Number(k)]
    return out
  }, [menuTiles])

  // region_id → ISO 3166-2 code
  const regionIdToIso = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of regions) if (r.iso_code) m.set(r.id, r.iso_code.toUpperCase())
    return m
  }, [regions])

  // Per-market coverage: parent ISO + region ISO set
  const marketCoverage = useMemo(() => {
    return countries.map(c => {
      const iso = (c.country_iso || '').toUpperCase()
      const regionIds = Array.isArray(c.region_ids) ? c.region_ids : []
      const regionIsos = new Set<string>()
      for (const id of regionIds) {
        const code = regionIdToIso.get(id)
        if (code) regionIsos.add(code)
      }
      return { market: c, country_iso: iso, region_isos: regionIsos, isWholeCountry: regionIsos.size === 0 }
    })
  }, [countries, regionIdToIso])

  // Per-country colour for the **country view** — blends all markets for an
  // ISO regardless of region-scoping.
  const countryFillDataAll = useMemo(() => {
    const groups = new Map<string, typeof marketCoverage>()
    for (const mc of marketCoverage) {
      if (!mc.country_iso) continue
      const list = groups.get(mc.country_iso) ?? []
      list.push(mc)
      groups.set(mc.country_iso, list)
    }
    const out = new Map<string, { color: string; markets: typeof marketCoverage }>()
    for (const [iso, markets] of groups.entries()) {
      const vals = markets.map(m => avgCogsByMarket[m.market.id]).filter(v => v != null) as number[]
      const color = vals.length
        ? fillForCogs(vals.reduce((s, n) => s + n, 0) / vals.length)
        : COLOR_ACCENT_DIM
      out.set(iso, { color, markets })
    }
    return out
  }, [marketCoverage, avgCogsByMarket])

  // Per-country colour for the **region view** — only whole-country markets
  // contribute. Countries that are exclusively region-scoped render as
  // "not in scope" at the country level so the region layer on top is the
  // sole indicator of what's claimed.
  const countryFillDataWholeOnly = useMemo(() => {
    const groups = new Map<string, typeof marketCoverage>()
    for (const mc of marketCoverage) {
      if (!mc.country_iso || !mc.isWholeCountry) continue
      const list = groups.get(mc.country_iso) ?? []
      list.push(mc)
      groups.set(mc.country_iso, list)
    }
    const out = new Map<string, { color: string; markets: typeof marketCoverage }>()
    for (const [iso, markets] of groups.entries()) {
      const vals = markets.map(m => avgCogsByMarket[m.market.id]).filter(v => v != null) as number[]
      const color = vals.length
        ? fillForCogs(vals.reduce((s, n) => s + n, 0) / vals.length)
        : COLOR_ACCENT_DIM
      out.set(iso, { color, markets })
    }
    return out
  }, [marketCoverage, avgCogsByMarket])

  // Pick the appropriate map for the current view.
  const countryFillData = view === 'region' ? countryFillDataWholeOnly : countryFillDataAll

  // Per-region colour — only region-owning markets contribute.
  const regionFillData = useMemo(() => {
    const groups = new Map<string, typeof marketCoverage>()
    for (const mc of marketCoverage) {
      if (mc.isWholeCountry) continue
      for (const iso2 of mc.region_isos) {
        const list = groups.get(iso2) ?? []
        list.push(mc)
        groups.set(iso2, list)
      }
    }
    const out = new Map<string, { color: string; markets: typeof marketCoverage }>()
    for (const [iso2, markets] of groups.entries()) {
      const vals = markets.map(m => avgCogsByMarket[m.market.id]).filter(v => v != null) as number[]
      const color = vals.length
        ? fillForCogs(vals.reduce((s, n) => s + n, 0) / vals.length)
        : COLOR_ACCENT_DIM
      out.set(iso2, { color, markets })
    }
    return out
  }, [marketCoverage, avgCogsByMarket])

  // Selected country ISO (for the outline)
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
        zoom: 1.3,
        projection: { name: 'mercator' } as any,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
      })
      map.touchZoomRotate.disableRotation()
      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
      map.addControl(new mapboxgl.AttributionControl({ compact: true }))

      map.on('style.load', () => {
        // Hide default-style clutter so the widget reads as a clean choropleth
        // rather than a street map.
        const s = map.getStyle()
        if (s?.layers) {
          for (const layer of s.layers) {
            if (LAYER_PREFIXES_TO_HIDE.some(p => layer.id.startsWith(p))) {
              try { map.setLayoutProperty(layer.id, 'visibility', 'none') } catch { /* ignore */ }
            }
          }
        }

        // Country source — promoteId makes iso_3166_1 the feature id so
        // setFeatureState works for smooth hover transitions.
        map.addSource(COUNTRY_SRC_ID, {
          type: 'vector',
          url:  'mapbox://mapbox.country-boundaries-v1',
          promoteId: { country_boundaries: 'iso_3166_1' },
        } as any)

        // Country fill — colour via match expression, slight lift on hover.
        map.addLayer({
          id: COUNTRY_FILL_LYR,
          type: 'fill',
          source: COUNTRY_SRC_ID,
          'source-layer': 'country_boundaries',
          paint: {
            'fill-color': '#FFFFFF',
            'fill-opacity': [
              'case',
              ['boolean', ['feature-state', 'hover'], false],    0.92,
              ['boolean', ['feature-state', 'selected'], false], 0.88,
              0.72,
            ],
            'fill-opacity-transition': { duration: 150 },
          },
          filter: ['!=', ['get', 'disputed'], 'true'],
        })

        // Country outline
        map.addLayer({
          id: COUNTRY_LINE_LYR,
          type: 'line',
          source: COUNTRY_SRC_ID,
          'source-layer': 'country_boundaries',
          paint: {
            'line-color': COLOR_BORDER,
            'line-width': 0.5,
            'line-opacity': 0.9,
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

  // ── Add / refresh region source + layers when GeoJSON is ready ────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady || !regionGeo) return

    // Tag each feature with a stable id (iso_3166_2) for feature-state.
    const features = (regionGeo.features || []).map((f: any) => ({
      ...f,
      id: (f.properties?.iso_3166_2 || '').toUpperCase(),
    }))
    const geojson = { type: 'FeatureCollection', features }

    const existing = map.getSource(REGION_SRC_ID) as mapboxgl.GeoJSONSource | undefined
    if (existing) {
      existing.setData(geojson as any)
      return
    }

    map.addSource(REGION_SRC_ID, { type: 'geojson', data: geojson as any, promoteId: 'iso_3166_2' } as any)

    map.addLayer({
      id: REGION_FILL_LYR,
      type: 'fill',
      source: REGION_SRC_ID,
      layout: { visibility: view === 'region' ? 'visible' : 'none' },
      paint: {
        'fill-color': '#FFFFFF',
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false], 0.92,
          0.75,
        ],
        'fill-opacity-transition': { duration: 150 },
      },
    })
    map.addLayer({
      id: REGION_LINE_LYR,
      type: 'line',
      source: REGION_SRC_ID,
      layout: { visibility: view === 'region' ? 'visible' : 'none' },
      paint: {
        'line-color': COLOR_BORDER,
        'line-width': 0.4,
        'line-opacity': 0.7,
      },
    })
  }, [regionGeo, styleReady])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Toggle layer visibility when view changes ──────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    const vis = (id: string, v: 'visible' | 'none') => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
    }
    // Country layer stays visible in both modes — it's the base for regions.
    vis(COUNTRY_FILL_LYR, 'visible')
    vis(COUNTRY_LINE_LYR, 'visible')
    vis(REGION_FILL_LYR, view === 'region' ? 'visible' : 'none')
    vis(REGION_LINE_LYR, view === 'region' ? 'visible' : 'none')
  }, [view, styleReady])

  // ── Apply country fill (match expression) ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    // Match iso_3166_1 (upper-case) → colour
    const pairs: any[] = []
    for (const [iso, { color }] of countryFillData.entries()) pairs.push(iso, color)

    // If no markets, still render something rather than the bare white.
    const fillColorExpr: any = pairs.length
      ? ['match', ['upcase', ['get', 'iso_3166_1']], ...pairs, '#ECEEF0']
      : '#ECEEF0'

    try {
      map.setPaintProperty(COUNTRY_FILL_LYR, 'fill-color', fillColorExpr)

      // Selection outline — coloured + thicker for selected country.
      map.setPaintProperty(COUNTRY_LINE_LYR, 'line-color', [
        'case',
        ['==', ['upcase', ['get', 'iso_3166_1']], selectedIso ?? ''],
        COLOR_ACCENT,
        COLOR_BORDER,
      ] as any)
      map.setPaintProperty(COUNTRY_LINE_LYR, 'line-width', [
        'case',
        ['==', ['upcase', ['get', 'iso_3166_1']], selectedIso ?? ''],
        2,
        0.5,
      ] as any)
    } catch { /* style may still be swapping */ }
  }, [countryFillData, selectedIso, styleReady])

  // ── Apply region fill ──────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return
    if (!map.getLayer(REGION_FILL_LYR)) return

    const pairs: any[] = []
    for (const [iso2, { color }] of regionFillData.entries()) pairs.push(iso2, color)

    const fillColorExpr: any = pairs.length
      ? ['match', ['upcase', ['get', 'iso_3166_2']], ...pairs, 'rgba(0,0,0,0)']
      : 'rgba(0,0,0,0)'

    try {
      map.setPaintProperty(REGION_FILL_LYR, 'fill-color', fillColorExpr)
    } catch { /* ignore */ }
  }, [regionFillData, styleReady, regionGeo])

  // ── Hover + click handlers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !styleReady) return

    const clearHover = () => {
      if (hoverIsoRef.current) {
        try {
          map.removeFeatureState({ source: COUNTRY_SRC_ID, sourceLayer: 'country_boundaries', id: hoverIsoRef.current })
          if (map.getLayer(REGION_FILL_LYR)) {
            map.removeFeatureState({ source: REGION_SRC_ID, id: hoverIsoRef.current })
          }
        } catch { /* ignore */ }
        hoverIsoRef.current = null
      }
    }

    const onMoveCountries = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [COUNTRY_FILL_LYR] })
      if (!features.length) { clearHover(); popupRef.current?.remove(); popupRef.current = null; map.getCanvas().style.cursor = ''; return }
      const f = features[0]
      const iso = String(f.properties?.iso_3166_1 || '').toUpperCase()
      const entry = countryFillData.get(iso)
      map.getCanvas().style.cursor = entry ? 'pointer' : ''
      if (hoverIsoRef.current !== iso) {
        clearHover()
        if (entry) {
          try { map.setFeatureState({ source: COUNTRY_SRC_ID, sourceLayer: 'country_boundaries', id: iso }, { hover: true }) } catch { /* ignore */ }
          hoverIsoRef.current = iso
        }
      }
      if (!entry) { popupRef.current?.remove(); popupRef.current = null; return }
      showCountryPopup(map, e.lngLat, f.properties, entry, avgCogsByMarket, popupRef)
    }

    const onMoveRegions = (e: mapboxgl.MapMouseEvent) => {
      const regionFeatures = map.getLayer(REGION_FILL_LYR)
        ? map.queryRenderedFeatures(e.point, { layers: [REGION_FILL_LYR] })
        : []
      if (regionFeatures.length) {
        const f = regionFeatures[0]
        const iso2 = String(f.properties?.iso_3166_2 || '').toUpperCase()
        const entry = regionFillData.get(iso2)
        if (entry) {
          map.getCanvas().style.cursor = 'pointer'
          if (hoverIsoRef.current !== iso2) {
            clearHover()
            try { map.setFeatureState({ source: REGION_SRC_ID, id: iso2 }, { hover: true }) } catch { /* ignore */ }
            hoverIsoRef.current = iso2
          }
          showRegionPopup(map, e.lngLat, f.properties, entry, avgCogsByMarket, popupRef)
          return
        }
      }
      // Fall back to country-level hover
      onMoveCountries(e)
    }

    const onLeave = () => {
      clearHover()
      map.getCanvas().style.cursor = ''
      popupRef.current?.remove()
      popupRef.current = null
    }

    const onClickCountry = (e: mapboxgl.MapMouseEvent) => {
      // Try region first in region view
      if (view === 'region' && map.getLayer(REGION_FILL_LYR)) {
        const rf = map.queryRenderedFeatures(e.point, { layers: [REGION_FILL_LYR] })
        if (rf.length) {
          const iso2 = String(rf[0].properties?.iso_3166_2 || '').toUpperCase()
          const entry = regionFillData.get(iso2)
          if (entry?.markets.length) {
            const first = entry.markets[0].market
            setCountryId(countryId === first.id ? null : first.id)
            return
          }
        }
      }
      const cf = map.queryRenderedFeatures(e.point, { layers: [COUNTRY_FILL_LYR] })
      if (!cf.length) return
      const iso = String(cf[0].properties?.iso_3166_1 || '').toUpperCase()
      const entry = countryFillData.get(iso)
      if (!entry?.markets.length) return
      const first = entry.markets[0].market
      setCountryId(countryId === first.id ? null : first.id)
    }

    const moveHandler = view === 'region' ? onMoveRegions : onMoveCountries

    map.on('mousemove', moveHandler)
    map.on('mouseout', onLeave)
    map.on('click', onClickCountry)
    return () => {
      map.off('mousemove', moveHandler)
      map.off('mouseout', onLeave)
      map.off('click', onClickCountry)
    }
  }, [styleReady, countryFillData, regionFillData, avgCogsByMarket, countryId, setCountryId, view])

  // Resize when fullscreen toggles.
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

  const selectedMarket = countries.find(c => c.id === countryId) ?? null

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={containerClass} style={fullscreenStyle}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">{label}</h2>
          <p className="text-xs text-text-3 mt-0.5">
            {view === 'country'
              ? 'Click a country to set the active market'
              : 'Click a region to scope to its market'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex bg-surface-2 rounded p-0.5 text-xs">
            <button
              onClick={() => setView('country')}
              className={`px-2.5 py-1 rounded transition-colors ${view === 'country' ? 'bg-surface text-text-1 shadow-sm' : 'text-text-3 hover:text-text-1'}`}
            >
              Countries
            </button>
            <button
              onClick={() => setView('region')}
              className={`px-2.5 py-1 rounded transition-colors ${view === 'region' ? 'bg-surface text-text-1 shadow-sm' : 'text-text-3 hover:text-text-1'}`}
            >
              Regions
            </button>
          </div>
          {regionGeoLoading && (
            <span className="inline-flex items-center gap-1.5 text-[10px] text-text-3 px-2 py-0.5 rounded-full bg-surface-2 border border-border"
                  title="Loading admin-1 boundaries — the rest of the app stays responsive.">
              <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
              Loading regions…
            </span>
          )}
          {selectedMarket ? (
            <button onClick={() => setCountryId(null)} className="text-xs text-accent hover:underline">✕ Clear</button>
          ) : (
            <span className="text-xs text-text-3">No market selected</span>
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

      {tokenLoading ? (
        <div className="h-64 bg-surface-2 rounded-lg animate-pulse" />
      ) : !token ? (
        <div className="h-64 flex flex-col items-center justify-center text-sm text-text-3 gap-2 p-6 text-center">
          <div className="font-medium text-text-1">Mapbox not configured</div>
          <div>Add a public access token in <span className="font-medium">System → AI → Mapbox Integration</span>.</div>
          <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Create a Mapbox token →</a>
        </div>
      ) : token.startsWith('sk.') ? (
        <div className="h-64 flex flex-col items-center justify-center text-sm text-text-3 gap-2 p-6 text-center">
          <div className="font-medium text-text-1">Wrong token type</div>
          <div>The saved token starts with <code className="px-1 rounded bg-surface-2">sk.</code> (secret). Mapbox GL JS needs a <code className="px-1 rounded bg-surface-2">pk.</code> public token.</div>
          <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">Create a public token →</a>
        </div>
      ) : mapError ? (
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
              {countries.length} markets{view === 'region' ? ` · ${regions.length} regions` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Popup helpers ────────────────────────────────────────────────────────────
function showCountryPopup(
  map: MbMap,
  lngLat: mapboxgl.LngLat,
  props: any,
  entry: { markets: Array<{ market: { id: number; name: string } }> },
  avgCogsByMarket: Record<number, number>,
  popupRef: React.MutableRefObject<Popup | null>,
) {
  const name = String(props?.name_en || props?.name || '')
  const lines = entry.markets.map(m => {
    const cogs = avgCogsByMarket[m.market.id]
    const cogsStr = cogs != null ? ` · ${cogs.toFixed(1)}%` : ''
    return `<div style="font-size:11px;color:var(--text-2);line-height:1.4">${escapeHtml(m.market.name)}${cogsStr}</div>`
  }).join('')
  const html = `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-1);margin-bottom:4px">${escapeHtml(name)}</div>
      ${lines}
    </div>`
  if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
  popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map)
}

function showRegionPopup(
  map: MbMap,
  lngLat: mapboxgl.LngLat,
  props: any,
  entry: { markets: Array<{ market: { id: number; name: string } }> },
  avgCogsByMarket: Record<number, number>,
  popupRef: React.MutableRefObject<Popup | null>,
) {
  const regionName = String(props?.name || props?.name_en || props?.iso_3166_2 || '')
  const admin = String(props?.admin || '')
  const lines = entry.markets.map(m => {
    const cogs = avgCogsByMarket[m.market.id]
    const cogsStr = cogs != null ? ` · ${cogs.toFixed(1)}%` : ''
    return `<div style="font-size:11px;color:var(--text-2);line-height:1.4">${escapeHtml(m.market.name)}${cogsStr}</div>`
  }).join('')
  const html = `
    <div>
      <div style="font-size:12px;font-weight:600;color:var(--text-1);margin-bottom:2px">${escapeHtml(regionName)}</div>
      ${admin ? `<div style="font-size:10px;color:var(--text-3);margin-bottom:4px">${escapeHtml(admin)}</div>` : ''}
      ${lines}
    </div>`
  if (!popupRef.current) popupRef.current = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
  popupRef.current.setLngLat(lngLat).setHTML(html).addTo(map)
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
