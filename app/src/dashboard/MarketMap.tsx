import { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import { useApi } from '../hooks/useApi'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'
import { WORLD_COUNTRIES } from '../data/worldCountries'

// Country-level (natural earth 110m, ~90 kB) — used by the "Country" view.
const COUNTRY_GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// Admin-1 subdivisions (50m, states/provinces of every country). ~2 MB raw /
// ~500 kB gzipped. Only loaded when the user toggles to the "Regions" view.
const ADMIN1_GEO_URL  = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_admin_1_states_provinces.geojson'

// Country-name aliases — natural-earth uses its own spellings for a handful
// of countries. Used by both views for tooltip / lookup resolution.
const NAME_ALIASES: Record<string, string[]> = {
  'United States of America': ['United States', 'USA', 'US'],
  'United Kingdom':           ['UK', 'Great Britain', 'Britain'],
  'Czechia':                  ['Czech Republic'],
  'North Macedonia':          ['Macedonia'],
  'Eswatini':                 ['Swaziland'],
  'Myanmar':                  ['Burma'],
  'Côte d\u2019Ivoire':       ['Ivory Coast', 'Cote d\'Ivoire'],
  'Dem. Rep. Congo':          ['Democratic Republic of the Congo', 'DR Congo'],
  'Russia':                   ['Russian Federation'],
  'South Korea':              ['Republic of Korea', 'Korea, Republic of'],
  'North Korea':              ['Democratic People\'s Republic of Korea'],
  'Iran':                     ['Islamic Republic of Iran'],
  'Syria':                    ['Syrian Arab Republic'],
  'Tanzania':                 ['United Republic of Tanzania'],
  'Vietnam':                  ['Viet Nam'],
  'Laos':                     ['Lao People\'s Democratic Republic'],
  'Brunei':                   ['Brunei Darussalam'],
  'Moldova':                  ['Republic of Moldova'],
  'Bolivia':                  ['Plurinational State of Bolivia'],
  'Venezuela':                ['Bolivarian Republic of Venezuela'],
}
const NAME_TO_CANON: Record<string, string> = {}
for (const [canon, variants] of Object.entries(NAME_ALIASES)) {
  NAME_TO_CANON[canon.toLowerCase()] = canon
  for (const v of variants) NAME_TO_CANON[v.toLowerCase()] = canon
}
function canonicalName(name: string): string {
  return NAME_TO_CANON[name.toLowerCase()] ?? name
}

// Map natural-earth feature names (already canonicalised) → ISO 3166-1 alpha-2
// so the country-level view can resolve any feature to a country ISO. The
// lookup is built from WORLD_COUNTRIES (our 249-entry catalog) plus every
// alias listed in NAME_ALIASES, so both "United States" and "United States of
// America" route to "US", etc.
const COUNTRY_NAME_TO_ISO: Map<string, string> = (() => {
  const m = new Map<string, string>()
  for (const wc of WORLD_COUNTRIES) {
    m.set(wc.name.toLowerCase(), wc.iso)
    const canon = canonicalName(wc.name)
    if (canon !== wc.name) m.set(canon.toLowerCase(), wc.iso)
  }
  // Also index every canon key so that e.g. "United States of America" maps to
  // the same ISO as "United States".
  for (const canon of Object.keys(NAME_ALIASES)) {
    if (m.has(canon.toLowerCase())) continue
    // Find whichever variant is in our catalog and inherit its iso.
    const variants = [canon, ...(NAME_ALIASES[canon] || [])]
    for (const v of variants) {
      const hit = WORLD_COUNTRIES.find(wc => wc.name.toLowerCase() === v.toLowerCase())
      if (hit) { m.set(canon.toLowerCase(), hit.iso); break }
    }
  }
  return m
})()

interface RegionRow {
  id:          number
  country_iso: string
  name:        string
  iso_code:    string | null
}

type MapView = 'country' | 'region'

export default function MarketMap() {
  const api = useApi()
  const { countries, countryId, setCountryId } = useMarket()
  const { menuTiles } = useDashboardData()

  const [view, setView]   = useState<MapView>('country')
  const [countryGeo, setCountryGeo] = useState<any>(null)
  const [regionGeo, setRegionGeo]   = useState<any>(null)
  const [regions, setRegions]       = useState<RegionRow[]>([])
  const [hovered, setHovered]       = useState<HoverState | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  // Esc key closes fullscreen; body scroll locked while it's on.
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

  // Load country topojson once (tiny).
  useEffect(() => {
    let cancelled = false
    fetch(COUNTRY_GEO_URL)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (!cancelled) setCountryGeo(j) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load map') })
    return () => { cancelled = true }
  }, [])

  // Lazy-load admin-1 GeoJSON only when the user switches to region view.
  useEffect(() => {
    if (view !== 'region' || regionGeo) return
    let cancelled = false
    fetch(ADMIN1_GEO_URL)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (!cancelled) setRegionGeo(j) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load region map') })
    return () => { cancelled = true }
  }, [view, regionGeo])

  // Regions catalog — needed for region view to match market.region_ids → ISO 3166-2.
  useEffect(() => {
    let cancelled = false
    api.get('/regions')
      .then((rows: any) => { if (!cancelled) setRegions(rows || []) })
      .catch(() => { /* non-fatal */ })
  }, [api])

  // Avg COGS % per market id (colour scale).
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

  // region_id → ISO 3166-2 upper-case code
  const regionIdToIso = useMemo(() => {
    const m = new Map<number, string>()
    for (const r of regions) if (r.iso_code) m.set(r.id, r.iso_code.toUpperCase())
    return m
  }, [regions])

  // Precomputed coverage info per market: its parent ISO + the region ISO 3166-2
  // codes it claims. A market with no region_ids covers the whole country.
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

  // ── COUNTRY-VIEW INDEXES ────────────────────────────────────────────────────
  // Country view: any market with country_iso === X is a member of that country's
  // polygon. Colour is the average of all member markets' COGS. Tooltip lists all.
  const marketsByParentIso = useMemo(() => {
    const m = new Map<string, typeof marketCoverage>()
    for (const mc of marketCoverage) {
      if (!mc.country_iso) continue
      const list = m.get(mc.country_iso) ?? []
      list.push(mc)
      m.set(mc.country_iso, list)
    }
    return m
  }, [marketCoverage])

  // world-atlas countries-110m features carry ISO 3166-1 numeric code on `id`.
  // Convert to alpha-2 for matching against mcogs country_iso.
  // Rather than hard-coding the full map, we match by canonical English name
  // (feature.properties.name) against our known countries' names where ISO
  // mapping isn't available on the feature.

  // ── REGION-VIEW INDEXES ─────────────────────────────────────────────────────
  // For admin-1 view: match ISO 3166-2 (feature.iso_3166_2) against claimed
  // region isos. If no region-level match, fall back to whole-country markets.
  const marketsByRegionIso2 = useMemo(() => {
    const m = new Map<string, typeof marketCoverage>()
    for (const mc of marketCoverage) {
      if (mc.isWholeCountry) continue
      for (const iso2 of mc.region_isos) {
        const list = m.get(iso2) ?? []
        list.push(mc)
        m.set(iso2, list)
      }
    }
    return m
  }, [marketCoverage])

  const wholeCountryMarketsByIso = useMemo(() => {
    const m = new Map<string, typeof marketCoverage>()
    for (const mc of marketCoverage) {
      if (!mc.isWholeCountry || !mc.country_iso) continue
      const list = m.get(mc.country_iso) ?? []
      list.push(mc)
      m.set(mc.country_iso, list)
    }
    return m
  }, [marketCoverage])

  const selectedMarket = countries.find(c => c.id === countryId) ?? null

  function fillForCogs(avg: number): string {
    if (avg <= 30) return 'var(--accent)'
    if (avg <= 40) return '#D97706'
    return '#DC2626'
  }

  function fillForMatches(matches: typeof marketCoverage): string {
    if (matches.length === 0) return 'var(--surface-2)'
    // Average COGS across matching markets (so multi-market countries / shared
    // regions get a blended colour rather than last-wins).
    const vals = matches.map(m => avgCogsByMarket[m.market.id]).filter(v => v != null) as number[]
    if (!vals.length) return 'var(--accent-dim)'
    return fillForCogs(vals.reduce((s, n) => s + n, 0) / vals.length)
  }

  const activeGeo = view === 'country' ? countryGeo : regionGeo
  const loading = !activeGeo && !error

  const containerClass = fullscreen
    ? 'fixed inset-0 z-50 bg-surface p-6 flex flex-col overflow-auto'
    : 'card p-5 h-full relative overflow-hidden'

  return (
    <div className={containerClass}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">World Map</h2>
          <p className="text-xs text-text-3 mt-0.5">
            {view === 'country'
              ? 'Click a country — tooltip lists every market operating there'
              : 'Click a region to scope to the market that claims it'}
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

      {error ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3">
          Could not load map: {error}
        </div>
      ) : loading ? (
        <div className="h-64 bg-surface-2 rounded-lg animate-pulse" />
      ) : (
        <div className={`relative ${fullscreen ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
          <ComposableMap
            projection="geoNaturalEarth1"
            projectionConfig={{ scale: fullscreen ? 220 : 150 }}
            width={800}
            height={380}
            style={{ width: '100%', height: fullscreen ? '100%' : 'auto', flex: fullscreen ? 1 : undefined }}
          >
            <ZoomableGroup center={[0, 20]}>
              <Geographies geography={activeGeo}>
                {({ geographies }) => geographies.map(g =>
                  view === 'country'
                    ? renderCountryFeature(g, {
                        marketsByParentIso,
                        countryId, setCountryId, fillForMatches, setHovered,
                      })
                    : renderRegionFeature(g, {
                        marketsByRegionIso2, wholeCountryMarketsByIso,
                        countryId, setCountryId, fillForMatches, setHovered,
                      })
                )}
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>

          {hovered && <MapTooltip hovered={hovered} avgCogsByMarket={avgCogsByMarket} />}

          {/* Legend */}
          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-3 mt-3">
            <Legend color="var(--accent)"     label="COGS ≤ 30%" />
            <Legend color="#D97706"           label="≤ 40%" />
            <Legend color="#DC2626"           label="> 40%" />
            <Legend color="var(--accent-dim)" label="No data" />
            <Legend color="var(--surface-2)"  label="Not in scope" />
            <span className="ml-auto text-text-3/60">
              {countries.length} markets{view === 'region' ? ` · ${regions.length} regions` : ''}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Render helpers ────────────────────────────────────────────────────────────

interface HoverState {
  label:   string
  subtitle?: string
  matches: Array<{ market: { id: number; name: string; country_iso?: string | null }; isWholeCountry: boolean }>
}

function renderCountryFeature(
  g: any,
  ctx: {
    marketsByParentIso: Map<string, any[]>
    countryId: number | null
    setCountryId: (id: number | null) => void
    fillForMatches: (matches: any[]) => string
    setHovered: (h: HoverState | null) => void
  }
) {
  const props = g.properties || {}
  const name: string = props.name || ''
  const canonical = canonicalName(name)

  // Resolve feature → ISO 3166-1 alpha-2 via the name index. Then look up every
  // market with that country_iso (country-wide AND region-scoped) so the
  // country lights up whenever any market sits inside it.
  const iso = COUNTRY_NAME_TO_ISO.get(canonical.toLowerCase())
              ?? COUNTRY_NAME_TO_ISO.get(name.toLowerCase())
              ?? (props.iso_a2 || props.ISO_A2 || '').toString().toUpperCase()
  const matches = iso ? (ctx.marketsByParentIso.get(iso) || []) : []

  const primary = matches[0] || null
  const isSelected = primary && primary.market.id === ctx.countryId
  let fill = ctx.fillForMatches(matches)
  if (isSelected) fill = 'var(--accent-dark)'

  return (
    <Geography
      key={g.rsmKey}
      geography={g}
      onMouseEnter={() => ctx.setHovered({ label: canonical, subtitle: iso || undefined, matches })}
      onMouseLeave={() => ctx.setHovered(null)}
      onClick={() => { if (!primary) return; ctx.setCountryId(isSelected ? null : primary.market.id) }}
      style={{
        default: { fill, stroke: 'var(--border)', strokeWidth: 0.4, outline: 'none', cursor: primary ? 'pointer' : 'default', transition: 'fill 150ms' },
        hover:   { fill: primary ? 'var(--accent-mid)' : fill, stroke: 'var(--border)', strokeWidth: 0.6, outline: 'none', cursor: primary ? 'pointer' : 'default' },
        pressed: { fill: 'var(--accent-dark)', outline: 'none' },
      }}
    />
  )
}

function renderRegionFeature(
  g: any,
  ctx: {
    marketsByRegionIso2:       Map<string, any[]>
    wholeCountryMarketsByIso:  Map<string, any[]>
    countryId: number | null
    setCountryId: (id: number | null) => void
    fillForMatches: (matches: any[]) => string
    setHovered: (h: HoverState | null) => void
  }
) {
  const props = g.properties || {}
  const iso2: string        = (props.iso_3166_2 || '').toString().toUpperCase()
  const parentIso: string   = (props.iso_a2 || '').toString().toUpperCase()
  const regionName: string  = props.name || props.name_en || ''
  const countryName: string = props.admin || props.geounit || ''

  const matches =
    (iso2 && ctx.marketsByRegionIso2.get(iso2)) ||
    ctx.wholeCountryMarketsByIso.get(parentIso) ||
    []
  const primary = matches[0] || null
  const isSelected = primary && primary.market.id === ctx.countryId
  let fill = ctx.fillForMatches(matches)
  if (isSelected) fill = 'var(--accent-dark)'

  const label = regionName && countryName
    ? `${regionName} · ${canonicalName(countryName)}`
    : canonicalName(countryName) || regionName
  const subtitle = iso2 || parentIso || undefined

  return (
    <Geography
      key={g.rsmKey}
      geography={g}
      onMouseEnter={() => ctx.setHovered({ label, subtitle, matches })}
      onMouseLeave={() => ctx.setHovered(null)}
      onClick={() => { if (!primary) return; ctx.setCountryId(isSelected ? null : primary.market.id) }}
      style={{
        default: { fill, stroke: 'var(--border)', strokeWidth: 0.25, outline: 'none', cursor: primary ? 'pointer' : 'default', transition: 'fill 150ms' },
        hover:   { fill: primary ? 'var(--accent-mid)' : fill, stroke: 'var(--border)', strokeWidth: 0.5, outline: 'none', cursor: primary ? 'pointer' : 'default' },
        pressed: { fill: 'var(--accent-dark)', outline: 'none' },
      }}
    />
  )
}

function MapTooltip({
  hovered, avgCogsByMarket,
}: {
  hovered: HoverState
  avgCogsByMarket: Record<number, number>
}) {
  return (
    <div className="absolute top-2 left-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-sm pointer-events-none text-xs max-w-[260px]">
      <div className="font-semibold text-text-1">{hovered.label}</div>
      {hovered.subtitle && <div className="text-[10px] font-mono text-text-3 mt-0.5">{hovered.subtitle}</div>}
      {hovered.matches.length === 0 ? (
        <div className="text-text-3 italic mt-0.5">Not in your markets</div>
      ) : (
        <div className="mt-1 space-y-0.5">
          {hovered.matches.slice(0, 4).map((mc: any) => {
            const avg = avgCogsByMarket[mc.market.id]
            return (
              <div key={mc.market.id} className="flex items-center justify-between gap-3">
                <span className="text-text-2 truncate">
                  {mc.market.name}
                  {mc.isWholeCountry === false && ' · regional'}
                </span>
                {avg != null && <span className="font-semibold text-text-1">{avg.toFixed(1)}%</span>}
              </div>
            )
          })}
          {hovered.matches.length > 4 && (
            <div className="text-[10px] text-text-3 italic">+ {hovered.matches.length - 4} more</div>
          )}
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
