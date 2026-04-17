import { useEffect, useMemo, useState } from 'react'
import { ComposableMap, Geographies, Geography, ZoomableGroup } from 'react-simple-maps'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'

// world-atlas topojson (natural earth, 110m resolution, ~90kB, fetched from CDN & cached by browser)
const GEO_URL = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

// world-atlas natural earth features expose both `name` (English) and `id` (ISO 3166-1 numeric).
// mcogs_countries.name is usually the English name, so match by case-insensitive name with
// a small alias table for the common mismatches (Natural Earth uses its own spellings).
const NAME_ALIASES: Record<string, string[]> = {
  // canonical-in-topojson  : list of mcogs_countries names that should map to it
  'United States of America': ['United States', 'USA', 'US'],
  'United Kingdom':           ['UK', 'Great Britain', 'Britain'],
  'Czechia':                  ['Czech Republic'],
  'North Macedonia':          ['Macedonia'],
  'Eswatini':                 ['Swaziland'],
  'Myanmar':                  ['Burma'],
  'Côte d\u2019Ivoire':       ['Ivory Coast', 'Cote d\'Ivoire'],
  'Congo':                    ['Republic of the Congo'],
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

// Build a reverse lookup: any variant → canonical topojson name
const NAME_TO_CANON: Record<string, string> = {}
for (const [canon, variants] of Object.entries(NAME_ALIASES)) {
  NAME_TO_CANON[canon.toLowerCase()] = canon
  for (const v of variants) NAME_TO_CANON[v.toLowerCase()] = canon
}

function canonicalName(name: string): string {
  return NAME_TO_CANON[name.toLowerCase()] ?? name
}

export default function MarketMap() {
  const { countries, countryId, setCountryId } = useMarket()
  const { menuTiles } = useDashboardData()
  const [hovered, setHovered] = useState<string | null>(null)
  const [topo, setTopo] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // Fetch the topojson once on mount (browser caches future visits)
  useEffect(() => {
    let cancelled = false
    fetch(GEO_URL)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => { if (!cancelled) setTopo(j) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load map') })
    return () => { cancelled = true }
  }, [])

  // Map canonical-name → mcogs country
  const byCanonName = useMemo(() => {
    const m: Record<string, typeof countries[number]> = {}
    for (const c of countries) m[canonicalName(c.name).toLowerCase()] = c
    return m
  }, [countries])

  // Per-country average COGS % (for colour intensity)
  const avgCogsByCountryId = useMemo(() => {
    const m: Record<number, number> = {}
    for (const tile of menuTiles) {
      const vals = tile.levels.map(l => l.cogs_pct).filter((p): p is number => p != null)
      if (!vals.length) continue
      const avg = vals.reduce((s, n) => s + n, 0) / vals.length
      if (m[tile.country_id] == null) m[tile.country_id] = avg
      else m[tile.country_id] = (m[tile.country_id] + avg) / 2
    }
    return m
  }, [menuTiles])

  const hoveredCountry = hovered ? byCanonName[canonicalName(hovered).toLowerCase()] : null
  const selected = countries.find(c => c.id === countryId) ?? null

  return (
    <div className="card p-5 h-full relative overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">World Map</h2>
          <p className="text-xs text-text-3 mt-0.5">Click a market to scope the dashboard</p>
        </div>
        {selected ? (
          <button onClick={() => setCountryId(null)}
            className="text-xs text-accent hover:underline">✕ Clear selection</button>
        ) : (
          <span className="text-xs text-text-3">No market selected</span>
        )}
      </div>

      {error ? (
        <div className="h-64 flex items-center justify-center text-sm text-text-3">
          Could not load map: {error}
        </div>
      ) : !topo ? (
        <div className="h-64 bg-surface-2 rounded-lg animate-pulse" />
      ) : (
        <div className="relative">
          <ComposableMap
            projection="geoNaturalEarth1"
            projectionConfig={{ scale: 150 }}
            width={800}
            height={380}
            style={{ width: '100%', height: 'auto' }}
          >
            <ZoomableGroup center={[0, 20]}>
              <Geographies geography={topo}>
                {({ geographies }) => geographies.map(geo => {
                  const name: string = geo.properties.name
                  const mapped = byCanonName[canonicalName(name).toLowerCase()]
                  const isAllowed = !!mapped
                  const isSelected = mapped && mapped.id === countryId
                  const cogs = mapped ? avgCogsByCountryId[mapped.id] : undefined

                  let fill = 'var(--surface-2)'      // default: unavailable country
                  if (isAllowed) {
                    if (cogs != null) {
                      // green → amber → red shading based on avg COGS (naive thresholds)
                      fill = cogs <= 30 ? 'var(--accent)'
                           : cogs <= 40 ? '#D97706'
                           : '#DC2626'
                    } else {
                      fill = 'var(--accent-dim)'
                    }
                  }
                  if (isSelected) fill = 'var(--accent-dark)'

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseEnter={() => setHovered(name)}
                      onMouseLeave={() => setHovered(null)}
                      onClick={() => { if (mapped) setCountryId(isSelected ? null : mapped.id) }}
                      style={{
                        default: {
                          fill,
                          stroke: 'var(--border)',
                          strokeWidth: 0.4,
                          outline: 'none',
                          cursor: isAllowed ? 'pointer' : 'default',
                          transition: 'fill 150ms',
                        },
                        hover: {
                          fill: isAllowed ? 'var(--accent-mid)' : fill,
                          stroke: 'var(--border)',
                          strokeWidth: 0.6,
                          outline: 'none',
                          cursor: isAllowed ? 'pointer' : 'default',
                        },
                        pressed: {
                          fill: 'var(--accent-dark)',
                          outline: 'none',
                        },
                      }}
                    />
                  )
                })}
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>

          {/* Tooltip for hovered country */}
          {hovered && (
            <div className="absolute top-2 left-2 bg-surface border border-border rounded-lg px-3 py-2 shadow-sm pointer-events-none text-xs">
              <div className="font-semibold text-text-1">{hoveredCountry?.name ?? hovered}</div>
              {hoveredCountry ? (
                <>
                  <div className="text-text-3 mt-0.5">
                    {hoveredCountry.currency_code} · {hoveredCountry.currency_symbol}
                  </div>
                  {avgCogsByCountryId[hoveredCountry.id] != null && (
                    <div className="text-text-2 mt-0.5">
                      Avg COGS: <span className="font-semibold">{avgCogsByCountryId[hoveredCountry.id].toFixed(1)}%</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-text-3 italic mt-0.5">Not in your markets</div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-3 text-[10px] text-text-3 mt-3">
            <Legend color="var(--accent)"     label="COGS ≤ 30%" />
            <Legend color="#D97706"           label="≤ 40%" />
            <Legend color="#DC2626"           label="> 40%" />
            <Legend color="var(--accent-dim)" label="No data" />
            <Legend color="var(--surface-2)"  label="Not in scope" />
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
