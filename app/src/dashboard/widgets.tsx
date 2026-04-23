import { useMemo, ReactElement, lazy, Suspense } from 'react'
import { useDashboardData } from './DashboardData'
import { useMarket } from '../contexts/MarketContext'
import { WidgetId } from './types'

// Lazy-load the map widget so react-simple-maps + d3-geo only load when used
const MarketMap = lazy(() => import('./MarketMap'))
function MarketMapWidget() {
  return (
    <Suspense fallback={<div className="card p-5 h-full"><div className="h-64 bg-surface-2 rounded-lg animate-pulse" /></div>}>
      <MarketMap />
    </Suspense>
  )
}

// Lazy-load the top-items chart — only fetches /cogs when visible
const MenuTopItemsChart = lazy(() => import('./MenuTopItemsChart'))
function MenuTopItemsWidget() {
  return (
    <Suspense fallback={<div className="card p-5 h-full"><div className="h-64 bg-surface-2 rounded-lg animate-pulse" /></div>}>
      <MenuTopItemsChart />
    </Suspense>
  )
}

// ── Shared UI bits ─────────────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`bg-surface-2 rounded animate-pulse ${className}`} />
}

function EmptyState({ message }: { message: string }) {
  return <div className="py-6 text-center text-text-3 text-sm">{message}</div>
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">{title}</h2>
      {count !== undefined && (
        <span className="text-xs font-medium text-text-3 bg-surface-2 px-2 py-0.5 rounded-full">{count}</span>
      )}
    </div>
  )
}

function timeSince(dateStr: string) {
  const d = new Date(dateStr)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function fmt(n: number) { return n.toLocaleString() }

// ── KPI widget (generic) ──────────────────────────────────────────────────────

function KpiCard({ label, value, accent = false, sub }: {
  label: string; value: number | string; accent?: boolean; sub?: string
}) {
  return (
    <div className={`card p-5 h-full flex flex-col justify-between ${accent ? 'border-accent/30 bg-accent-dim' : ''}`}>
      <span className="text-text-3 text-xs font-medium uppercase tracking-wide">{label}</span>
      <div>
        <div className={`text-3xl font-bold tabular-nums ${accent ? 'text-accent' : 'text-text-1'}`}>{value}</div>
        {sub && <div className="text-text-3 text-xs mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function KpiIngredients() {
  const { ingredients, loading } = useDashboardData()
  if (loading) return <Skeleton className="h-28" />
  return <KpiCard label="Ingredients" value={fmt(ingredients.length)} />
}

function KpiRecipes() {
  const { recipes, loading } = useDashboardData()
  if (loading) return <Skeleton className="h-28" />
  return <KpiCard label="Recipes" value={fmt(recipes.length)} />
}

function KpiMenus() {
  const { menus, loading } = useDashboardData()
  const { countryId } = useMarket()
  if (loading) return <Skeleton className="h-28" />
  const scoped = countryId == null ? menus : menus.filter(m => m.country_id === countryId)
  return <KpiCard label="Menus" value={fmt(scoped.length)} sub={countryId ? 'In selected market' : undefined} />
}

function KpiMarkets() {
  const { countries, loading } = useDashboardData()
  if (loading) return <Skeleton className="h-28" />
  return <KpiCard label="Markets" value={fmt(countries.length)} sub="Franchise markets" />
}

function KpiVendors() {
  const { vendors, loading } = useDashboardData()
  const { countryId } = useMarket()
  if (loading) return <Skeleton className="h-28" />
  const scoped = countryId == null ? vendors : vendors.filter(v => v.country_id === countryId)
  return <KpiCard label="Vendors" value={fmt(scoped.length)} sub={countryId ? 'In selected market' : undefined} />
}

function KpiActiveQuotes() {
  const { quotes, vendors, loading } = useDashboardData()
  const { countryId } = useMarket()
  const vendorCountry = useMemo(() => {
    const m: Record<number, number> = {}
    for (const v of vendors) m[v.id] = v.country_id
    return m
  }, [vendors])
  if (loading) return <Skeleton className="h-28" />
  const active = quotes.filter(q => q.is_active)
  const scoped = countryId == null ? active : active.filter(q => {
    const vid = (q as unknown as { vendor_id?: number }).vendor_id
    return vid ? vendorCountry[vid] === countryId : true
  })
  return <KpiCard label="Active Quotes" value={fmt(scoped.length)} accent />
}

function KpiCategories() {
  const { categories, loading } = useDashboardData()
  if (loading) return <Skeleton className="h-28" />
  return <KpiCard label="Categories" value={fmt(categories.length)} />
}

function KpiCoverage() {
  const { ingredients, quotes, loading } = useDashboardData()
  if (loading) return <Skeleton className="h-28" />
  const quotedIds = new Set(quotes.filter(q => q.is_active).map(q => q.ingredient_id))
  const pct = ingredients.length
    ? Math.round((quotedIds.size / ingredients.length) * 100)
    : 0
  return (
    <KpiCard label="Coverage" value={`${pct}%`} accent={pct >= 80}
      sub={pct >= 80 ? 'All major ingredients priced' : 'Some ingredients unpriced'} />
  )
}

// ── Coverage bar ───────────────────────────────────────────────────────────────

function CoverageBar() {
  const { ingredients, quotes, loading } = useDashboardData()
  if (loading) return <Skeleton className="h-28" />
  const quotedIds = new Set(quotes.filter(q => q.is_active).map(q => q.ingredient_id))
  const pct = ingredients.length ? Math.round((quotedIds.size / ingredients.length) * 100) : 0
  const color = pct >= 80 ? '#146A34' : pct >= 50 ? '#D97706' : '#DC2626'
  const label = pct >= 80 ? 'Good' : pct >= 50 ? 'Partial' : 'Low'
  return (
    <div className="card p-6 h-full flex flex-col justify-center gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-2">Price Quote Coverage</span>
        <span className="text-sm font-bold" style={{ color }}>{pct}% — {label}</span>
      </div>
      <div className="h-2.5 rounded-full bg-surface-2 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-text-3 text-xs">Percentage of ingredients with at least one active price quote</p>
    </div>
  )
}

// ── Menu tiles ─────────────────────────────────────────────────────────────────

function MenuTiles() {
  const { menuTiles, menuTilesLoading, cogsThresholds, menus } = useDashboardData()
  const { countryId } = useMarket()
  function cogsColor(pct: number | null) {
    if (pct == null) return 'text-text-3'
    if (!cogsThresholds) return 'text-text-1'
    if (pct <= cogsThresholds.excellent) return 'text-emerald-600'
    if (pct <= cogsThresholds.acceptable) return 'text-amber-500'
    return 'text-red-500'
  }
  const scopedCount = countryId == null ? menus.length : menus.filter(m => m.country_id === countryId).length
  return (
    <div className="card p-5 h-full">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader title={countryId ? 'Menus in market' : 'Menus'} count={scopedCount} />
        {cogsThresholds && (
          <div className="flex items-center gap-3 text-xs text-text-3">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/>≤{cogsThresholds.excellent}%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block"/>≤{cogsThresholds.acceptable}%</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>above</span>
          </div>
        )}
      </div>
      {menuTilesLoading && menuTiles.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: Math.max(1, scopedCount) }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : menuTiles.length === 0 ? (
        <EmptyState message={countryId ? 'No menus for this market' : 'No menus yet'} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {menuTiles.map(tile => (
            <a key={tile.menu_id} href="/menus"
              className="block rounded-xl border border-border bg-surface hover:border-accent/40 hover:shadow-sm transition-all group">
              <div className="px-4 pt-3 pb-2 border-b border-border/60">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold text-sm text-text-1 group-hover:text-accent transition-colors leading-tight">{tile.menu_name}</div>
                  <span className="flex-shrink-0 text-[10px] font-medium bg-surface-2 text-text-3 px-1.5 py-0.5 rounded-full whitespace-nowrap">{tile.item_count} items</span>
                </div>
                <div className="text-xs text-text-3 mt-0.5">{tile.country_name}</div>
              </div>
              <div className="px-4 py-2 space-y-1">
                {tile.levels.map(level => (
                  <div key={level.id} className="flex items-center justify-between">
                    <span className="text-xs text-text-2 flex items-center gap-1">
                      {level.name}
                      {level.is_default && <span className="text-[9px] font-bold bg-accent-dim text-accent px-1 py-0 rounded-full leading-4">default</span>}
                    </span>
                    <span className={`text-xs font-semibold tabular-nums ${cogsColor(level.cogs_pct)}`}>
                      {level.cogs_pct != null ? `${level.cogs_pct.toFixed(1)}%` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Missing quotes ─────────────────────────────────────────────────────────────

function MissingQuotes() {
  const { ingredients, quotes, loading } = useDashboardData()
  const quotedIds = useMemo(() => new Set(quotes.filter(q => q.is_active).map(q => q.ingredient_id)), [quotes])
  const missing = useMemo(() => ingredients.filter(i => !quotedIds.has(i.id)).slice(0, 10), [ingredients, quotedIds])
  return (
    <div className="card p-5 h-full">
      <SectionHeader title="Missing Price Quotes" count={missing.length} />
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : missing.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6">
          <span className="badge-green text-sm">✓ Full coverage</span>
          <p className="text-text-3 text-sm">All ingredients have at least one active price quote</p>
        </div>
      ) : (
        <div className="space-y-1">
          {missing.map(item => (
            <div key={item.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2">
              <span className="text-amber-500">⚠</span>
              <span className="text-text-1 text-sm flex-1 truncate">{item.name}</span>
              <span className="text-text-3 text-xs">No quote</span>
            </div>
          ))}
          {missing.length === 10 && (
            <p className="text-text-3 text-xs text-center pt-2">Showing first 10 — visit Inventory for full list</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Recent quotes ──────────────────────────────────────────────────────────────

function RecentQuotes() {
  const { quotes, vendors, loading } = useDashboardData()
  const { countryId } = useMarket()
  const vendorCountry = useMemo(() => {
    const m: Record<number, number> = {}
    for (const v of vendors) m[v.id] = v.country_id
    return m
  }, [vendors])
  const rows = useMemo(() => {
    const active = quotes.filter(q => q.is_active)
    const scoped = countryId == null ? active : active.filter(q => {
      const vid = (q as unknown as { vendor_id?: number }).vendor_id
      return vid ? vendorCountry[vid] === countryId : true
    })
    return [...scoped].sort((a, b) =>
      new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
    ).slice(0, 8)
  }, [quotes, countryId, vendorCountry])
  return (
    <div className="card p-5 h-full">
      <SectionHeader title="Recent Price Quotes" count={rows.length} />
      {loading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : rows.length === 0 ? (
        <EmptyState message="No active price quotes yet" />
      ) : (
        <div className="space-y-1">
          {rows.map(q => (
            <div key={q.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2">
              <div className="flex-1 min-w-0">
                <p className="text-text-1 text-sm truncate font-medium">{q.ingredient_name ?? `#${q.id}`}</p>
                <p className="text-text-3 text-xs truncate">{q.vendor_name ?? '—'}{q.country_name ? ` · ${q.country_name}` : ''}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="text-text-1 text-sm font-mono">{q.currency_code ?? ''} {typeof q.unit_price === 'number' ? q.unit_price.toFixed(2) : '—'}</p>
                <p className="text-text-3 text-xs">{q.updated_at ? timeSince(q.updated_at) : ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Quick links ────────────────────────────────────────────────────────────────

function QuickLinks() {
  const links: { label: string; href: string; icon: ReactElement }[] = [
    { label: 'Inventory',   href: '/inventory',     icon: <IconInventory /> },
    { label: 'Recipes',     href: '/recipes',       icon: <IconRecipe /> },
    { label: 'Menus',       href: '/menus',         icon: <IconMenu /> },
    { label: 'Sales Items', href: '/sales-items',   icon: <IconSales /> },
    { label: 'Stock',       href: '/stock-manager', icon: <IconStock /> },
    { label: 'HACCP',       href: '/haccp',         icon: <IconHaccp /> },
    { label: 'Allergens',   href: '/allergens',     icon: <IconAllergen /> },
    { label: 'Config',      href: '/configuration', icon: <IconConfig /> },
  ]
  return (
    <div className="card p-5 h-full">
      <SectionHeader title="Quick Links" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {links.map(l => (
          <a key={l.label} href={l.href}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-border hover:border-accent/40 hover:bg-accent-dim transition-all text-center text-xs font-medium text-text-2 hover:text-accent group">
            <span className="w-8 h-8 rounded-lg bg-surface-2 group-hover:bg-accent/15 flex items-center justify-center text-text-2 group-hover:text-accent transition-colors">
              {l.icon}
            </span>
            <span>{l.label}</span>
          </a>
        ))}
      </div>
    </div>
  )
}

// ── Quick-link icons ─────────────────────────────────────────────────────────

const iconProps = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function IconInventory() { return (
  <svg {...iconProps}>
    <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
    <path d="M12 6v6l4 2"/>
  </svg>
)}
function IconRecipe() { return (
  <svg {...iconProps}>
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
)}
function IconMenu() { return (
  <svg {...iconProps}>
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/>
    <line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
)}
function IconSales() { return (
  <svg {...iconProps}>
    <circle cx="9" cy="21" r="1"/>
    <circle cx="20" cy="21" r="1"/>
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>
  </svg>
)}
function IconStock() { return (
  <svg {...iconProps}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
    <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
    <line x1="12" y1="22.08" x2="12" y2="12"/>
  </svg>
)}
function IconHaccp() { return (
  <svg {...iconProps}>
    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4 4 0 1 0 5 0z"/>
  </svg>
)}
function IconAllergen() { return (
  <svg {...iconProps}>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)}
function IconConfig() { return (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>
)}

// ── Market picker — grid of markets with quick stats ──────────────────────────

function MarketPicker() {
  const { countries, setCountryId, countryId } = useMarket()
  const { menus, vendors, menuTiles } = useDashboardData()
  return (
    <div className="card p-5 h-full">
      <SectionHeader title="Markets" count={countries.length} />
      {countries.length === 0 ? (
        <EmptyState message="No markets available" />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {countries.map(c => {
            const menuCount = menus.filter(m => m.country_id === c.id).length
            const vendorCount = vendors.filter(v => v.country_id === c.id).length
            const selected = countryId === c.id
            const countryMenuTiles = menuTiles.filter(t => t.country_id === c.id)
            const avg = countryMenuTiles.length
              ? countryMenuTiles.flatMap(t => t.levels.map(l => l.cogs_pct).filter((p): p is number => p != null))
              : []
            const avgCogs = avg.length ? avg.reduce((s, n) => s + n, 0) / avg.length : null
            return (
              <button
                key={c.id}
                onClick={() => setCountryId(selected ? null : c.id)}
                className={`text-left rounded-xl border p-3 transition-all ${
                  selected
                    ? 'border-accent bg-accent-dim shadow-sm'
                    : 'border-border bg-surface hover:border-accent/40 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="font-semibold text-sm text-text-1">{c.name}</div>
                  <span className="text-xs font-mono text-text-3">{c.currency_symbol}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-3">
                  <span>{menuCount} menu{menuCount !== 1 ? 's' : ''}</span>
                  <span>·</span>
                  <span>{vendorCount} vendor{vendorCount !== 1 ? 's' : ''}</span>
                </div>
                {avgCogs != null && (
                  <div className="mt-1 text-xs">
                    <span className="text-text-3">Avg COGS </span>
                    <span className="font-semibold tabular-nums text-text-1">{avgCogs.toFixed(1)}%</span>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Market stats snapshot ──────────────────────────────────────────────────────

function MarketStats() {
  const { selected } = useMarket()
  const { menus, vendors, menuTiles, loading } = useDashboardData()
  if (!selected) {
    return (
      <div className="card p-5 h-full flex items-center justify-center text-center">
        <div>
          <p className="text-sm font-medium text-text-2 mb-1">No market selected</p>
          <p className="text-xs text-text-3">Pick a market to see its snapshot here</p>
        </div>
      </div>
    )
  }
  if (loading) return <Skeleton className="h-40" />
  const scopedMenus = menus.filter(m => m.country_id === selected.id)
  const scopedVendors = vendors.filter(v => v.country_id === selected.id)
  const tiles = menuTiles.filter(t => t.country_id === selected.id)
  const avg = tiles.flatMap(t => t.levels.map(l => l.cogs_pct).filter((p): p is number => p != null))
  const avgCogs = avg.length ? (avg.reduce((s, n) => s + n, 0) / avg.length).toFixed(1) + '%' : '—'
  return (
    <div className="card p-5 h-full">
      <SectionHeader title={`${selected.name} — Snapshot`} />
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Menus"    value={scopedMenus.length}   />
        <Stat label="Vendors"  value={scopedVendors.length} />
        <Stat label="Avg COGS" value={avgCogs}              />
        <Stat label="Currency" value={`${selected.currency_code} (${selected.currency_symbol})`} />
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-[10px] uppercase tracking-wide text-text-3 font-medium">{label}</div>
      <div className="text-lg font-bold text-text-1 tabular-nums mt-0.5">{value}</div>
    </div>
  )
}

// ── Market header banner ──────────────────────────────────────────────────────

function MarketHeader() {
  const { selected } = useMarket()
  return (
    <div className="card p-6 h-full bg-gradient-to-br from-accent-dim to-surface">
      {selected ? (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-accent font-semibold mb-1">Active market</div>
            <h2 className="text-3xl font-bold text-text-1">{selected.name}</h2>
            <p className="text-sm text-text-2 mt-0.5">
              {selected.currency_code} · {selected.currency_symbol} · exchange rate {selected.exchange_rate.toFixed(2)}
            </p>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-xs uppercase tracking-wider text-text-3 font-semibold mb-1">No market selected</div>
          <h2 className="text-2xl font-bold text-text-1">All markets</h2>
          <p className="text-sm text-text-2 mt-0.5">Pick a market below to scope the dashboard.</p>
        </div>
      )}
    </div>
  )
}

// ── Registry mapping WidgetId → component ─────────────────────────────────────

// ── MarketSelector — full-width dashboard switcher ────────────────────────────
// Distinct from MarketPicker (card-grid) and MarketHeader (banner). This is the
// fast chooser meant to live at the top of every template: a row of clickable
// chips + an "All markets" reset button. All widgets further down the page
// react via MarketContext, so picking one here re-scopes KPIs, menu tiles,
// recent quotes, the map etc. in one click.

function isoToFlag(iso: string | null | undefined): string {
  if (!iso || iso.length !== 2) return '🌐'
  return [...iso.toUpperCase()].map(c => String.fromCodePoint(0x1F1E6 - 65 + c.charCodeAt(0))).join('')
}

function MarketSelector() {
  const { countries, countryId, setCountryId, selected, loading } = useMarket()

  if (loading) {
    return (
      <div className="card p-4 h-full">
        <Skeleton className="h-6 w-48 mb-3" />
        <div className="flex gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-24 rounded-full" />
          ))}
        </div>
      </div>
    )
  }

  if (countries.length === 0) {
    return (
      <div className="card p-4 h-full text-sm text-text-3">
        No markets configured yet. Add one in <strong>Configuration → Location Structure → Markets</strong>.
      </div>
    )
  }

  return (
    <div className="card p-4 h-full flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <span className="text-xs uppercase tracking-wider text-text-3 font-semibold">Market</span>
        {selected ? (
          <span className="text-sm font-semibold text-text-1 flex items-center gap-1.5">
            <span className="text-base leading-none">{isoToFlag(selected.country_iso)}</span>
            {selected.name}
            <span className="text-xs font-mono text-text-3">· {selected.currency_code}</span>
          </span>
        ) : (
          <span className="text-sm font-medium text-text-2">All markets</span>
        )}
      </div>

      {/* All markets reset chip */}
      <button
        onClick={() => setCountryId(null)}
        className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap ${
          countryId === null
            ? 'bg-accent text-white border-accent'
            : 'bg-surface text-text-2 border-border hover:bg-surface-2 hover:text-text-1'
        }`}
        title="Clear market scope — show data across every allowed market"
      >
        🌐 All markets
      </button>

      {/* One chip per country the user can see */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {countries.map(c => {
          const active = countryId === c.id
          return (
            <button
              key={c.id}
              onClick={() => setCountryId(active ? null : c.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                active
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface text-text-2 border-border hover:bg-surface-2 hover:text-text-1'
              }`}
              title={`${c.name} · ${c.currency_code} ${c.currency_symbol}`}
            >
              <span className="text-sm leading-none">{isoToFlag(c.country_iso)}</span>
              <span>{c.name}</span>
              <span className={`text-[10px] font-mono ${active ? 'text-white/70' : 'text-text-3'}`}>
                {c.currency_symbol}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export const WIDGET_COMPONENTS: Record<WidgetId, () => ReactElement> = {
  'kpi-ingredients':   KpiIngredients,
  'kpi-recipes':       KpiRecipes,
  'kpi-menus':         KpiMenus,
  'kpi-markets':       KpiMarkets,
  'kpi-vendors':       KpiVendors,
  'kpi-active-quotes': KpiActiveQuotes,
  'kpi-categories':    KpiCategories,
  'kpi-coverage':      KpiCoverage,
  'coverage-bar':      CoverageBar,
  'menu-tiles':        MenuTiles,
  'missing-quotes':    MissingQuotes,
  'recent-quotes':     RecentQuotes,
  'quick-links':       QuickLinks,
  'market-selector':   MarketSelector,
  'market-picker':     MarketPicker,
  'market-stats':      MarketStats,
  'market-header':     MarketHeader,
  'market-map':        MarketMapWidget,
  'menu-top-items':    MenuTopItemsWidget,
}
