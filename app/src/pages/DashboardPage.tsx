import { useEffect, useState, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { PepperHelpButton } from '../components/ui'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DashStats {
  ingredients: number
  recipes:     number
  vendors:     number
  countries:   number
  menus:       number
  activeQuotes: number
  categories:  number
  priceLevels: number
  coverage:    number // % of ingredients with at least one active quote
}

interface PriceLevel { id: number; name: string; is_default: boolean }
interface CogsThresholds { excellent: number; acceptable: number }

interface SimpleMenu { id: number; name: string; country_id: number; country_name: string }

interface MenuCogsTile {
  menu_id:      number
  menu_name:    string
  country_name: string
  country_id:   number
  item_count:   number
  levels:       { id: number; name: string; is_default: boolean; cogs_pct: number | null }[]
}

interface RecentQuote {
  id: number
  ingredient_name: string
  vendor_name: string
  country_name: string
  unit_price: number
  currency_code: string
  updated_at: string
}

interface CoverageItem {
  name: string
  hasQuote: boolean
  country: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString()
}

function timeSince(dateStr: string) {
  const d = new Date(dateStr)
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon,
  accent = false,
  sub,
  aiContext,
}: {
  label: string
  value: number | string
  icon: React.ReactNode
  accent?: boolean
  sub?: string
  aiContext?: Record<string, string>
}) {
  return (
    <div
      className={`card p-5 flex flex-col gap-3 ${accent ? 'border-accent/30 bg-accent-dim' : ''}`}
      data-ai-context={aiContext ? JSON.stringify(aiContext) : undefined}
    >
      <div className="flex items-center justify-between">
        <span className="text-text-3 text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
        <span
          className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            accent ? 'bg-accent/15 text-accent' : 'bg-surface-2 text-text-2'
          }`}
        >
          {icon}
        </span>
      </div>
      <div>
        <div
          className={`text-3xl font-bold tabular-nums ${
            accent ? 'text-accent' : 'text-text-1'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-text-3 text-xs mt-0.5">{sub}</div>}
      </div>
    </div>
  )
}

function CoverageMeter({ pct }: { pct: number }) {
  const color =
    pct >= 80 ? '#146A34' : pct >= 50 ? '#D97706' : '#DC2626'
  const label =
    pct >= 80 ? 'Good' : pct >= 50 ? 'Partial' : 'Low'
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text-2">Price Quote Coverage</span>
        <span
          className="text-sm font-bold"
          style={{ color }}
        >
          {pct}% — {label}
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="text-text-3 text-xs">
        Percentage of ingredients with at least one active price quote
      </p>
    </div>
  )
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">
        {title}
      </h2>
      {count !== undefined && (
        <span className="text-xs font-medium text-text-3 bg-surface-2 px-2 py-0.5 rounded-full">
          {count}
        </span>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-text-3 text-sm">{message}</div>
  )
}

function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`bg-surface-2 rounded animate-pulse ${className}`}
    />
  )
}

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconIngredient = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/>
    <path d="M12 6v6l4 2"/>
  </svg>
)
const IconRecipe = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 11l3 3L22 4"/>
    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
  </svg>
)
const IconVendor = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
)
const IconCountry = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
)
const IconQuote = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="1" x2="12" y2="23"/>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
  </svg>
)
const IconCategory = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="2" y="3" width="9" height="9"/>
    <rect x="13" y="3" width="9" height="9"/>
    <rect x="2" y="13" width="9" height="9"/>
    <rect x="13" y="13" width="9" height="9"/>
  </svg>
)
const IconAlert = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)
const IconMenu = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <line x1="9" y1="12" x2="15" y2="12"/>
    <line x1="9" y1="16" x2="13" y2="16"/>
  </svg>
)
const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
)

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function DashboardPage() {
  const api = useApi()

  const [stats, setStats] = useState<DashStats | null>(null)
  const [recentQuotes, setRecentQuotes] = useState<RecentQuote[]>([])
  const [missingCoverage, setMissingCoverage] = useState<CoverageItem[]>([])
  const [priceLevelList, setPriceLevelList] = useState<PriceLevel[]>([])
  const [menuList, setMenuList] = useState<SimpleMenu[]>([])
  const [cogsThresholds, setCogsThresholds] = useState<CogsThresholds | null>(null)
  const [menuTiles, setMenuTiles] = useState<MenuCogsTile[]>([])
  const [menuTilesLoading, setMenuTilesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      else setRefreshing(true)

      try {
        const [
          ingredients,
          recipes,
          vendors,
          countries,
          quotes,
          categories,
          priceLevels,
          menus,
          settings,
        ] = await Promise.all([
          api.get('/ingredients').catch(() => []),
          api.get('/recipes').catch(() => []),
          api.get('/vendors').catch(() => []),
          api.get('/countries').catch(() => []),
          api.get('/price-quotes').catch(() => []),
          api.get('/categories').catch(() => []),
          api.get('/price-levels').catch(() => []),
          api.get('/menus').catch(() => []),
          api.get('/settings').catch(() => null),
        ])

        setPriceLevelList(priceLevels || [])
        setMenuList(menus || [])
        if (settings?.cogs_thresholds) setCogsThresholds(settings.cogs_thresholds)

        const activeQuotes: RecentQuote[] = (quotes || []).filter(
          (q: any) => q.is_active
        )

        // Coverage: ingredients that have at least 1 active quote
        const quotedIngIds = new Set(
          activeQuotes.map((q: any) => q.ingredient_id)
        )
        const ingList: any[] = ingredients || []
        const coverage =
          ingList.length > 0
            ? Math.round((quotedIngIds.size / ingList.length) * 100)
            : 0

        // Missing coverage — ingredients with no active quote (show first 10)
        const countryMap: Record<number, string> = {}
        for (const c of countries || []) countryMap[c.id] = c.name

        const vendorCountryMap: Record<number, number> = {}
        for (const v of vendors || []) vendorCountryMap[v.id] = v.country_id

        const missing: CoverageItem[] = ingList
          .filter((ing: any) => !quotedIngIds.has(ing.id))
          .slice(0, 10)
          .map((ing: any) => ({
            id: ing.id,
            name: ing.name,
            hasQuote: false,
            country: '—',
          }))

        setMissingCoverage(missing)

        // Recent active quotes sorted by updated_at desc
        const sorted = [...activeQuotes]
          .sort(
            (a: any, b: any) =>
              new Date(b.updated_at || b.created_at || 0).getTime() -
              new Date(a.updated_at || a.created_at || 0).getTime()
          )
          .slice(0, 8)

        setRecentQuotes(sorted)

        setStats({
          ingredients:  ingList.length,
          recipes:      (recipes      || []).length,
          vendors:      (vendors      || []).length,
          countries:    (countries    || []).length,
          menus:        (menus        || []).length,
          activeQuotes: activeQuotes.length,
          categories:   (categories   || []).length,
          priceLevels:  (priceLevels  || []).length,
          coverage,
        })

        setLastRefresh(new Date())
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [api]
  )

  useEffect(() => { load() }, [load])

  // ── Load per-menu COGS tiles (background, after main data ready) ──
  useEffect(() => {
    if (!menuList.length || !priceLevelList.length) return
    let cancelled = false
    setMenuTilesLoading(true)
    Promise.all(
      menuList.map(async menu => {
        const levelResults = await Promise.all(
          priceLevelList.map(level =>
            api.get(`/cogs/menu/${menu.id}?market_id=${menu.country_id}&price_level_id=${level.id}`)
              .then((res: any) => ({
                level_id:   level.id,
                cogs_pct:   res?.summary?.avg_cogs_pct_net ?? null,
                item_count: (res?.items ?? []).length,
              }))
              .catch(() => ({ level_id: level.id, cogs_pct: null, item_count: 0 }))
          )
        )
        const item_count = Math.max(...levelResults.map(r => r.item_count))
        return {
          menu_id:      menu.id,
          menu_name:    menu.name,
          country_name: menu.country_name,
          country_id:   menu.country_id,
          item_count:   item_count > 0 ? item_count : 0,
          levels:       priceLevelList.map((level, i) => ({
            id:         level.id,
            name:       level.name,
            is_default: level.is_default,
            cogs_pct:   levelResults[i].cogs_pct,
          })),
        } as MenuCogsTile
      })
    ).then(tiles => {
      if (!cancelled) setMenuTiles(tiles)
    }).finally(() => {
      if (!cancelled) setMenuTilesLoading(false)
    })
    return () => { cancelled = true }
  }, [menuList, priceLevelList, api])

  // ── Helpers ──

  function cogsColor(pct: number | null, thresholds: CogsThresholds | null) {
    if (pct == null) return 'text-text-3'
    if (!thresholds) return 'text-text-1'
    if (pct <= thresholds.excellent)  return 'text-emerald-600'
    if (pct <= thresholds.acceptable) return 'text-amber-500'
    return 'text-red-500'
  }

  // ── Render ──

  const now = lastRefresh.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="min-h-screen bg-surface-2">
      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">

        {/* ── Header ── */}
        <div
          className="flex items-center justify-between"
          data-ai-context={JSON.stringify({ type: 'tutorial', prompt: 'Walk me through the Dashboard. What do the KPI tiles mean, what is Price Quote Coverage and why does it matter, how do the Menu COGS tiles work, and what should I check first thing each day?' })}
        >
          <div className="flex items-start gap-2">
            <div>
              <h1 className="text-2xl font-bold text-text-1">Dashboard</h1>
              <p className="text-text-3 text-sm mt-0.5">
                Your COGS overview at a glance
              </p>
            </div>
            <PepperHelpButton
              prompt="Walk me through the Dashboard. What do the KPI tiles mean, what is Price Quote Coverage and why does it matter, how do the Menu COGS tiles work, and what should I check first thing each day?"
              size={14}
            />
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="btn-outline flex items-center gap-2 text-sm py-1.5 px-3"
          >
            <span className={refreshing ? 'animate-spin' : ''}>
              <IconRefresh />
            </span>
            {refreshing ? 'Refreshing…' : `Updated ${now}`}
          </button>
        </div>

        {/* ── KPI Grid ── */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Ingredients"   value={fmt(stats.ingredients)}   icon={<IconIngredient />} />
            <StatCard label="Recipes"        value={fmt(stats.recipes)}        icon={<IconRecipe />} />
            <StatCard label="Menus"          value={fmt(stats.menus)}          icon={<IconMenu />} />
            <StatCard label="Markets"        value={fmt(stats.countries)}      icon={<IconCountry />} sub="Franchise markets" />
            <StatCard label="Vendors"        value={fmt(stats.vendors)}        icon={<IconVendor />} />
            <StatCard label="Active Quotes"  value={fmt(stats.activeQuotes)}   icon={<IconQuote />} accent />
            <StatCard label="Categories"     value={fmt(stats.categories)}     icon={<IconCategory />} />
            <StatCard label="Coverage"       value={`${stats.coverage}%`}      icon={<IconQuote />}
              accent={stats.coverage >= 80}
              sub={stats.coverage >= 80 ? 'All major ingredients priced' : 'Some ingredients unpriced'}
              aiContext={{ type: 'coverage', value: `${stats.coverage}%`, label: 'Price Quote Coverage' }} />
          </div>
        ) : null}

        {/* ── Menu COGS tiles ── */}
        {!loading && menuList.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <SectionHeader title="Menus" count={menuList.length} />
              {cogsThresholds && (
                <div className="flex items-center gap-3 text-xs text-text-3 mb-4">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />≤{cogsThresholds.excellent}% excellent</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />≤{cogsThresholds.acceptable}% acceptable</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />above target</span>
                </div>
              )}
            </div>
            {menuTilesLoading && menuTiles.length === 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {menuList.map(m => <Skeleton key={m.id} className="h-32" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {menuTiles.map(tile => (
                  <a
                    key={tile.menu_id}
                    href="/menus"
                    className="block rounded-xl border border-border bg-surface hover:border-accent/40 hover:shadow-sm transition-all group"
                  >
                    {/* Tile header */}
                    <div className="px-4 pt-3 pb-2 border-b border-border/60">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-sm text-text-1 group-hover:text-accent transition-colors leading-tight">
                          {tile.menu_name}
                        </div>
                        <span className="flex-shrink-0 text-[10px] font-medium bg-surface-2 text-text-3 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                          {tile.item_count} item{tile.item_count !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="text-xs text-text-3 mt-0.5">{tile.country_name}</div>
                    </div>

                    {/* Price level COGS rows */}
                    <div className="px-4 py-2 space-y-1">
                      {tile.levels.map(level => (
                        <div
                          key={level.id}
                          className="flex items-center justify-between"
                          data-ai-context={level.cogs_pct != null ? JSON.stringify({ type: 'menu_cogs', value: `${level.cogs_pct.toFixed(1)}%`, menu: tile.menu_name, price_level: level.name }) : undefined}
                        >
                          <span className="text-xs text-text-2 flex items-center gap-1">
                            {level.name}
                            {level.is_default && (
                              <span className="text-[9px] font-bold bg-accent-dim text-accent px-1 py-0 rounded-full leading-4">default</span>
                            )}
                          </span>
                          {menuTilesLoading && level.cogs_pct == null ? (
                            <span className="w-10 h-3 bg-surface-2 rounded animate-pulse" />
                          ) : (
                            <span className={`text-xs font-semibold tabular-nums ${cogsColor(level.cogs_pct, cogsThresholds)}`}>
                              {level.cogs_pct != null ? `${level.cogs_pct.toFixed(1)}%` : '—'}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Coverage bar ── */}
        {!loading && stats && (
          <div className="card p-6">
            <CoverageMeter pct={stats.coverage} />
          </div>
        )}

        {/* ── Two-column: Missing Quotes + Recent Quotes ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Missing price coverage */}
          <div className="card p-5">
            <SectionHeader
              title="Missing Price Quotes"
              count={missingCoverage.length}
            />
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : missingCoverage.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8">
                <span className="badge-green text-sm">✓ Full coverage</span>
                <p className="text-text-3 text-sm">
                  All ingredients have at least one active price quote
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {missingCoverage.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
                  >
                    <span className="text-amber-500 flex-shrink-0">
                      <IconAlert />
                    </span>
                    <span className="text-text-1 text-sm flex-1 truncate">
                      {item.name}
                    </span>
                    <span className="text-text-3 text-xs">No quote</span>
                  </div>
                ))}
                {missingCoverage.length === 10 && (
                  <p className="text-text-3 text-xs text-center pt-2">
                    Showing first 10 — visit Inventory for full list
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Recent price quotes */}
          <div className="card p-5">
            <SectionHeader title="Recent Price Quotes" count={recentQuotes.length} />
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8" />
                ))}
              </div>
            ) : recentQuotes.length === 0 ? (
              <EmptyState message="No active price quotes yet" />
            ) : (
              <div className="space-y-1">
                {recentQuotes.map((q, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-text-1 text-sm truncate font-medium">
                        {q.ingredient_name ?? `Ingredient #${q.id}`}
                      </p>
                      <p className="text-text-3 text-xs truncate">
                        {q.vendor_name ?? '—'}
                        {q.country_name ? ` · ${q.country_name}` : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-text-1 text-sm font-mono">
                        {q.currency_code ?? ''}{' '}
                        {typeof q.unit_price === 'number'
                          ? q.unit_price.toFixed(2)
                          : '—'}
                      </p>
                      <p className="text-text-3 text-xs">
                        {q.updated_at ? timeSince(q.updated_at) : ''}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Quick Links ── */}
        <div className="card p-5">
          <SectionHeader title="Quick Links" />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
            {[
              { label: 'Inventory', href: '/inventory', icon: <IconIngredient /> },
              { label: 'Recipes', href: '/recipes', icon: <IconRecipe /> },
              { label: 'Menus', href: '/menus', icon: <IconCategory /> },
              { label: 'Vendors', href: '/settings', icon: <IconVendor /> },
              { label: 'Markets', href: '/markets', icon: <IconCountry /> },
            ].map(({ label, href, icon }) => (
              <a
                key={label}
                href={href}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-border hover:border-accent/40 hover:bg-accent-dim transition-all text-center group"
              >
                <span className="w-9 h-9 rounded-lg bg-surface-2 group-hover:bg-accent/15 flex items-center justify-center text-text-2 group-hover:text-accent transition-colors">
                  {icon}
                </span>
                <span className="text-xs font-medium text-text-2 group-hover:text-text-1 transition-colors">
                  {label}
                </span>
              </a>
            ))}
          </div>
        </div>

      </main>
    </div>
  )
}
