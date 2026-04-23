import { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, Marker } from 'react-simple-maps'
import { geoCentroid, geoBounds } from 'd3-geo'
import { useApi } from '../hooks/useApi'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'
import { useWidgetLabel } from './widgets'

// Same admin-1 GeoJSON used by MarketMap — 10m variant is the full global
// dataset (~25 MB, ~5 MB gzipped). Cached by the browser after first load;
// fetched async via AbortController so nothing else blocks.
const ADMIN1_GEO_URL = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_1_states_provinces.geojson'

interface RegionRow { id: number; country_iso: string; name: string; iso_code: string | null }
interface Location  { id: number; name: string; country_id: number; latitude: number | null; longitude: number | null }

/**
 * Zoomed-in map of ONE country, showing every sub-country region coloured by
 * whether the user has a market claiming it. Optional city pins for any
 * mcogs_locations with captured lat/lng. Follows the globally-selected market
 * in MarketContext; if there's no selection the widget prompts the user to
 * pick one.
 */
export default function CountryRegionMap() {
  const api = useApi()
  const { selected, countries } = useMarket()
  const { menuTiles } = useDashboardData()

  const [geo, setGeo]           = useState<any>(null)
  const [regions, setRegions]   = useState<RegionRow[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [error, setError]       = useState<string | null>(null)
  const [hovered, setHovered]   = useState<{ label: string; subtitle?: string; markets: string[] } | null>(null)

  const [loading, setLoading] = useState(false)

  // Fetch the admin-1 GeoJSON once. AbortController so the download is
  // cancelled if the user unmounts the widget — the rest of the app keeps
  // running normally while this (~5 MB gzipped) streams in the background.
  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    fetch(ADMIN1_GEO_URL, { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { setGeo(j); setLoading(false) })
      .catch(e => {
        if (e?.name === 'AbortError') return
        setError(e.message || 'Failed to load map')
        setLoading(false)
      })
    return () => ctrl.abort()
  }, [])

  // Fetch regions + locations catalogs.
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

  // Selected country ISO — the widget is a no-op until one is chosen.
  const iso = (selected?.country_iso || '').toUpperCase()

  // Average COGS per market (same derivation as the world map).
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
    for (const k of Object.keys(sum)) out[+k] = sum[+k] / cnt[+k]
    return out
  }, [menuTiles])

  // region_id → ISO 3166-2 code (upper-case)
  const regionIdToIso = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of regions) if (r.iso_code) m.set(r.id, r.iso_code.toUpperCase())
    return m
  }, [regions])

  // Index: ISO 3166-2 code → list of markets that claim it (restricted to the
  // currently-viewed country so we don't flood the map with unrelated markets).
  const marketsByIso2 = useMemo(() => {
    const m = new Map<string, Array<{ marketId: number; name: string; isWholeCountry: boolean }>>()
    for (const c of countries) {
      if ((c.country_iso || '').toUpperCase() !== iso) continue
      const regionIds = Array.isArray(c.region_ids) ? c.region_ids : []
      const regionIsos = regionIds
        .map(id => regionIdToIso.get(id))
        .filter((x): x is string => !!x)
      if (regionIsos.length === 0) continue
      for (const code of regionIsos) {
        const list = m.get(code) ?? []
        list.push({ marketId: c.id, name: c.name, isWholeCountry: false })
        m.set(code, list)
      }
    }
    return m
  }, [countries, iso, regionIdToIso])

  // Whole-country markets also colour every region uniformly.
  const wholeCountryMarkets = useMemo(() => {
    return countries.filter(c =>
      (c.country_iso || '').toUpperCase() === iso
      && (!c.region_ids || c.region_ids.length === 0)
    ).map(c => ({ marketId: c.id, name: c.name, isWholeCountry: true }))
  }, [countries, iso])

  // Filter features to the selected country.
  const countryFeatures = useMemo(() => {
    if (!geo) return []
    return (geo.features as any[]).filter(f =>
      (f.properties?.iso_a2 || '').toString().toUpperCase() === iso
    )
  }, [geo, iso])

  // Locations with coordinates, in the selected country.
  const cityPins = useMemo(() => {
    if (!selected) return []
    return locations.filter(l =>
      l.country_id === selected.id && l.latitude != null && l.longitude != null
    )
  }, [locations, selected])

  // Compute centroid + bounds for projection fit. If the country has no
  // admin-1 features in the 50m dataset (some tiny territories don't), fall
  // back to a generic scale and let the country still render from the
  // world-atlas fallback further down.
  const projectionConfig = useMemo(() => {
    if (countryFeatures.length === 0) return { scale: 400, center: [0, 20] as [number, number] }
    const fc = { type: 'FeatureCollection', features: countryFeatures } as any
    const [center] = [geoCentroid(fc)]
    const [[minLng, minLat], [maxLng, maxLat]] = geoBounds(fc)
    const lngSpan = Math.max(1, maxLng - minLng)
    const latSpan = Math.max(1, maxLat - minLat)
    // Scale is calibrated so the country comfortably fills an 800×500 viewBox
    // (see <ComposableMap> below). 360° of longitude ≈ base scale of 150.
    const scale = Math.min(
      (800 / lngSpan) * 60,
      (500 / latSpan) * 100,
    )
    return { scale: Math.max(200, Math.min(scale, 3000)), center: center as [number, number] }
  }, [countryFeatures])

  const totalLocations = selected ? locations.filter(l => l.country_id === selected.id).length : 0
  const missingCoords  = totalLocations - cityPins.length

  return (
    <div className="card p-5 h-full relative overflow-hidden">
      <div className="flex items-start justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">
            {useWidgetLabel(selected ? `${selected.name} · Regions` : 'Country Region Map')}
          </h2>
          <p className="text-xs text-text-3 mt-0.5">
            {selected
              ? 'Regions claimed by any market, plus city pins for locations with coordinates.'
              : 'Pick a market above to zoom into its country.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <span
              className="inline-flex items-center gap-1.5 text-[10px] text-text-3 px-2 py-0.5 rounded-full bg-surface-2 border border-border"
              title="Downloading detailed region data (~5 MB gzipped). The rest of the app stays responsive — this streams in the background."
            >
              <span className="inline-block w-2 h-2 bg-accent rounded-full animate-pulse" />
              Loading map…
            </span>
          )}
          {selected && (
            <div className="text-[10px] text-text-3 font-mono bg-surface-2 border border-border rounded px-2 py-0.5">
              {iso}
            </div>
          )}
        </div>
      </div>

      {!selected ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3 bg-surface-2 rounded-lg">
          No market selected
        </div>
      ) : error ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3">
          Could not load map: {error}
        </div>
      ) : !geo ? (
        <div className="h-64 bg-surface-2 rounded-lg animate-pulse" />
      ) : countryFeatures.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3 bg-surface-2 rounded-lg">
          No regional boundaries available for {iso} at 1:50 m resolution.
        </div>
      ) : (
        <div className="relative">
          <ComposableMap
            projection="geoMercator"
            projectionConfig={projectionConfig}
            width={800}
            height={500}
            style={{ width: '100%', height: 'auto' }}
          >
            <Geographies geography={{ type: 'FeatureCollection', features: countryFeatures }}>
              {({ geographies }) => geographies.map(g => {
                const props = g.properties || {}
                const iso2: string = (props.iso_3166_2 || '').toString().toUpperCase()
                const regionName: string = props.name || props.name_en || ''

                const regionalClaims = iso2 ? (marketsByIso2.get(iso2) ?? []) : []
                const allClaims = [...regionalClaims, ...wholeCountryMarkets]

                // Colour by avg COGS of claiming markets — same legend as
                // the world map (green ≤30%, amber ≤40%, red >40%).
                const vals = allClaims
                  .map(c => avgCogsByMarket[c.marketId])
                  .filter((v): v is number => v != null)
                let fill = '#CBD5E1'   // out of scope default
                if (allClaims.length > 0) {
                  if (vals.length) {
                    const avg = vals.reduce((s, n) => s + n, 0) / vals.length
                    fill = avg <= 30 ? 'var(--accent)' : avg <= 40 ? '#D97706' : '#DC2626'
                  } else {
                    fill = 'var(--accent-dim)'
                  }
                }

                return (
                  <Geography
                    key={g.rsmKey}
                    geography={g}
                    onMouseEnter={() => setHovered({
                      label: regionName,
                      subtitle: iso2 || undefined,
                      markets: allClaims.map(c => c.name + (c.isWholeCountry ? ' (country-wide)' : '')),
                    })}
                    onMouseLeave={() => setHovered(null)}
                    style={{
                      default: { fill, stroke: '#64748B', strokeWidth: 0.4, outline: 'none', transition: 'fill 150ms' },
                      hover:   { fill: allClaims.length ? 'var(--accent-mid)' : fill, stroke: '#475569', strokeWidth: 0.7, outline: 'none', cursor: 'default' },
                      pressed: { fill, outline: 'none' },
                    }}
                  />
                )
              })}
            </Geographies>

            {/* City pins — one per location with lat/lng. Rendered as small
                dots with a white halo so they stay visible on any region colour. */}
            {cityPins.map(loc => (
              <Marker key={loc.id} coordinates={[Number(loc.longitude), Number(loc.latitude)]}>
                <circle r={5} fill="#fff" stroke="#0F1F17" strokeWidth={1.5} />
                <circle r={2.5} fill="#0F1F17" />
                <title>{loc.name}</title>
              </Marker>
            ))}
          </ComposableMap>

          {hovered && (
            <div className="absolute top-2 left-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-sm pointer-events-none text-xs max-w-[240px]">
              <div className="font-semibold text-text-1">{hovered.label}</div>
              {hovered.subtitle && <div className="text-[10px] font-mono text-text-3 mt-0.5">{hovered.subtitle}</div>}
              {hovered.markets.length === 0 ? (
                <div className="text-text-3 italic mt-0.5">No market claims this region</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {hovered.markets.slice(0, 4).map((m, i) => (
                    <div key={i} className="text-text-2 truncate">{m}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3 mt-3">
            <Legend color="var(--accent)" label="COGS ≤ 30%" />
            <Legend color="#D97706"       label="≤ 40%" />
            <Legend color="#DC2626"       label="> 40%" />
            <Legend color="var(--accent-dim)" label="No data" />
            <Legend color="#CBD5E1"       label="Not claimed" />
            <span className="ml-auto flex items-center gap-2">
              <span>{cityPins.length} / {totalLocations} locations mapped</span>
              {missingCoords > 0 && (
                <span className="text-amber-600" title={`${missingCoords} location(s) missing coordinates`}>
                  · {missingCoords} missing coords
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-sm" style={{ background: color, border: '1px solid var(--border)' }} />
      {label}
    </span>
  )
}
