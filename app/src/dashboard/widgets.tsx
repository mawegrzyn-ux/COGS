import { useMemo, useState, useEffect, useCallback, useRef, createContext, useContext, ReactElement, ReactNode, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDashboardData } from './DashboardData'
import { useMarket } from '../contexts/MarketContext'
import { useApi } from '../hooks/useApi'
import { Modal, Field, Toast } from '../components/ui'
import { WidgetId } from './types'
import { usePermissions, Feature } from '../hooks/usePermissions'
import { useFeatureFlags, FeatureFlags } from '../contexts/FeatureFlagsContext'

// ── Widget-label context ──────────────────────────────────────────────────────
// Lets a user's custom label (set via the Customise panel) override the
// hardcoded title inside each widget. The WidgetShell wraps every widget in
// this provider; widgets call useWidgetLabel(defaultLabel) and render the
// returned string instead of their hardcoded one.

const WidgetLabelContext = createContext<string | null>(null)

export function WidgetLabelProvider({ label, children }: { label?: string | null; children: ReactNode }) {
  return (
    <WidgetLabelContext.Provider value={label ?? null}>
      {children}
    </WidgetLabelContext.Provider>
  )
}

export function useWidgetLabel(fallback: string): string {
  const override = useContext(WidgetLabelContext)
  return override?.trim() ? override : fallback
}

// ── Widget-popout context ─────────────────────────────────────────────────────
// True when the widget is being rendered inside the standalone pop-out page
// (window opened via WidgetPopoutPage). Widgets that have a "fullscreen" or
// "expanded" UX can opt in to enabling it automatically when popped out so
// the user gets max real estate in the new window.
const WidgetPopoutContext = createContext<boolean>(false)

export function WidgetPopoutProvider({ children }: { children: ReactNode }) {
  return <WidgetPopoutContext.Provider value={true}>{children}</WidgetPopoutContext.Provider>
}

export function useIsWidgetPopout(): boolean {
  return useContext(WidgetPopoutContext)
}

// ── Widget-editing context ────────────────────────────────────────────────────
// True when the parent dashboard is in "Customise" edit mode. Widgets that
// support their own inline editing (reordering internal items, sizing a
// sub-grid, adding/removing links, etc.) opt in by reading this — when false
// they render in read-only view mode.
const WidgetEditingContext = createContext<boolean>(false)

export function WidgetEditingProvider({ editing, children }: { editing: boolean; children: ReactNode }) {
  return <WidgetEditingContext.Provider value={editing}>{children}</WidgetEditingContext.Provider>
}

export function useIsWidgetEditing(): boolean {
  return useContext(WidgetEditingContext)
}

// Lazy-load the map widget so react-simple-maps + d3-geo only load when used
const MarketMap = lazy(() => import('./MarketMap'))
function MarketMapWidget() {
  return (
    <Suspense fallback={<div className="card p-5 h-full"><div className="h-64 bg-surface-2 rounded-lg animate-pulse" /></div>}>
      <MarketMap />
    </Suspense>
  )
}

// Lazy-load the country-region map too (shares the admin-1 GeoJSON + d3-geo).
const CountryRegionMap = lazy(() => import('./CountryRegionMap'))
function CountryRegionMapWidget() {
  return (
    <Suspense fallback={<div className="card p-5 h-full"><div className="h-64 bg-surface-2 rounded-lg animate-pulse" /></div>}>
      <CountryRegionMap />
    </Suspense>
  )
}

// Lazy-load the Mapbox map (mapbox-gl is a large dependency, only pulled in
// when this widget actually renders).
const MapboxMap = lazy(() => import('./MapboxMap'))
function MapboxMapWidget() {
  return (
    <Suspense fallback={<div className="card p-5 h-full"><div className="h-64 bg-surface-2 rounded-lg animate-pulse" /></div>}>
      <MapboxMap />
    </Suspense>
  )
}

// Mapbox country-zoom widget — same lazy-load pattern.
const MapboxCountryMap = lazy(() => import('./MapboxCountryMap'))
function MapboxCountryMapWidget() {
  return (
    <Suspense fallback={<div className="card p-5 h-full"><div className="h-64 bg-surface-2 rounded-lg animate-pulse" /></div>}>
      <MapboxCountryMap />
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
  const effectiveTitle = useWidgetLabel(title)
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">{effectiveTitle}</h2>
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
  const effectiveLabel = useWidgetLabel(label)
  return (
    <div className={`card p-5 h-full flex flex-col justify-between ${accent ? 'border-accent/30 bg-accent-dim' : ''}`}>
      <span className="text-text-3 text-xs font-medium uppercase tracking-wide">{effectiveLabel}</span>
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
  const navigate = useNavigate()
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
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/inventory?addQuote=${item.id}`)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-surface-2 text-left transition-colors group"
              title={`Add a price quote for ${item.name}`}
            >
              <span className="text-amber-500">⚠</span>
              <span className="text-text-1 text-sm flex-1 truncate">{item.name}</span>
              <span className="text-accent text-xs opacity-0 group-hover:opacity-100 transition-opacity">+ Add quote</span>
            </button>
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

// ── Quick Links widget ────────────────────────────────────────────────────────
// User-customisable shortcut grid. Each link has its own 12-col width and
// row-span, RBAC/feature-flag gating, and can be reordered via drag-drop in
// dashboard edit mode. Config persists to localStorage per-user (per-browser).

type QLSize   = 'sm' | 'md' | 'lg' | 'xl'     // ¼ / ½ / ¾ / full inside the widget's 12-col grid
type QLHeight = 1 | 2 | 3                      // row-span tracks

interface QuickLink {
  /** Stable id used for DnD + dedupe + add-menu filtering. */
  id:       string
  label:    string
  href:     string
  /** Key into ICON_MAP; storing a string (not a ReactElement) keeps the config JSON-serialisable. */
  icon:     string
  /** RBAC feature — hide tile if the user has no `read` access. */
  feature?: Feature
  /** Global feature-flag key — hide tile if flag is off. */
  flag?:    keyof FeatureFlags
  size:     QLSize
  rowSpan:  QLHeight
}

const QL_SIZE_CLASS: Record<QLSize, string> = {
  sm: 'col-span-3',
  md: 'col-span-6',
  lg: 'col-span-9',
  xl: 'col-span-12',
}
const QL_ROW_CLASS: Record<QLHeight, string> = {
  1: 'row-span-1',
  2: 'row-span-2',
  3: 'row-span-3',
}

// Catalog = every link the user can choose from via the "+ Add link" menu.
// Order here also becomes the default Quick Links layout (shipped on first
// load / after a Reset).
const QL_CATALOG: QuickLink[] = [
  { id: 'dashboard',  label: 'Dashboard',   href: '/dashboard',     icon: 'dashboard', feature: 'dashboard',      size: 'sm', rowSpan: 1 },
  { id: 'inventory',  label: 'Inventory',   href: '/inventory',     icon: 'inventory', feature: 'inventory',      size: 'sm', rowSpan: 1 },
  { id: 'recipes',    label: 'Recipes',     href: '/recipes',       icon: 'recipes',   feature: 'recipes',        size: 'sm', rowSpan: 1 },
  { id: 'sales',      label: 'Sales Items', href: '/sales-items',   icon: 'sales',     feature: 'menus',          size: 'sm', rowSpan: 1 },
  { id: 'menus',      label: 'Menus',       href: '/menus',         icon: 'menus',     feature: 'menus',          size: 'sm', rowSpan: 1 },
  { id: 'stock',      label: 'Stock',       href: '/stock-manager', icon: 'stock',     feature: 'stock_overview', flag: 'stock_manager', size: 'sm', rowSpan: 1 },
  { id: 'allergens',  label: 'Allergens',   href: '/allergens',     icon: 'allergen',  feature: 'allergens',      flag: 'allergens',     size: 'sm', rowSpan: 1 },
  { id: 'haccp',      label: 'HACCP',       href: '/haccp',         icon: 'haccp',     feature: 'haccp',          flag: 'haccp',         size: 'sm', rowSpan: 1 },
  { id: 'audits',     label: 'Audits',      href: '/audits',        icon: 'audits',    feature: 'audits',         flag: 'audits',        size: 'sm', rowSpan: 1 },
  { id: 'media',      label: 'Media',       href: '/media',         icon: 'media',                                                       size: 'sm', rowSpan: 1 },
  { id: 'config',     label: 'Config',      href: '/configuration', icon: 'config',    feature: 'settings',                              size: 'sm', rowSpan: 1 },
  { id: 'system',     label: 'System',      href: '/system',        icon: 'system',                                                      size: 'sm', rowSpan: 1 },
  { id: 'help',       label: 'Help',        href: '/help',          icon: 'help',                                                        size: 'sm', rowSpan: 1 },
]

// Default layout — the 8 links the widget shipped with originally.
const QL_DEFAULT_IDS = ['inventory', 'recipes', 'menus', 'sales', 'stock', 'haccp', 'allergens', 'config']
const QL_DEFAULT: QuickLink[] = QL_DEFAULT_IDS
  .map(id => QL_CATALOG.find(l => l.id === id))
  .filter((l): l is QuickLink => !!l)

const QL_STORAGE_KEY = 'cogs-quick-links-v1'
const QL_LAYOUT_STORAGE_KEY = 'cogs-quick-links-layout'

type QLLayout = 'grid' | 'column'

function loadQuickLinksLayout(): QLLayout {
  try { return (localStorage.getItem(QL_LAYOUT_STORAGE_KEY) === 'column') ? 'column' : 'grid' } catch { return 'grid' }
}
function saveQuickLinksLayout(layout: QLLayout) {
  try { localStorage.setItem(QL_LAYOUT_STORAGE_KEY, layout) } catch { /* ignore */ }
}

function loadQuickLinksConfig(): QuickLink[] {
  try {
    const raw = localStorage.getItem(QL_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as QuickLink[]
      if (Array.isArray(parsed)) {
        // Re-hydrate against the catalog so any renamed/moved route picks up
        // the fresh href + RBAC flags without users having to reset manually.
        const byId = new Map(QL_CATALOG.map(c => [c.id, c]))
        return parsed.map(saved => {
          const cat = byId.get(saved.id)
          return cat
            ? { ...cat, size: saved.size, rowSpan: saved.rowSpan }
            : saved
        })
      }
    }
  } catch { /* fall through to default */ }
  return QL_DEFAULT
}

function saveQuickLinksConfig(links: QuickLink[]) {
  try { localStorage.setItem(QL_STORAGE_KEY, JSON.stringify(links)) } catch { /* storage full — not fatal */ }
}

function QuickLinks() {
  const editing  = useIsWidgetEditing()
  const { can }  = usePermissions()
  const { flags, loading: flagsLoading } = useFeatureFlags()
  const [links,  setLinks]  = useState<QuickLink[]>(() => loadQuickLinksConfig())
  const [addOpen, setAddOpen] = useState(false)
  const [layout, setLayout] = useState<QLLayout>(() => loadQuickLinksLayout())

  // Persist any change to localStorage.
  useEffect(() => { saveQuickLinksConfig(links) }, [links])
  useEffect(() => { saveQuickLinksLayout(layout) }, [layout])

  // Edit-mode DnD state — whole tile is draggable.
  const dragId  = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  // RBAC + feature-flag gating. In edit mode we show everything so the owner
  // can still rearrange tiles they'd be hidden from at view time (without edit
  // mode the whole tile would disappear mid-drag, which would feel broken).
  // Flag-gated tiles are also hidden during the flags-loading window so
  // there's no flash for disabled modules (matches Sidebar behaviour).
  const visibleLinks = editing ? links : links.filter(l => {
    if (l.feature && !can(l.feature, 'read')) return false
    if (l.flag && (flagsLoading || !flags[l.flag])) return false
    return true
  })

  // Link id → catalog entry for the Add-link dropdown.
  const available = useMemo(
    () => QL_CATALOG.filter(c => !links.some(l => l.id === c.id)),
    [links]
  )

  function moveLink(fromId: string, toId: string) {
    if (fromId === toId) return
    setLinks(prev => {
      const fromIdx = prev.findIndex(l => l.id === fromId)
      const toIdx   = prev.findIndex(l => l.id === toId)
      if (fromIdx < 0 || toIdx < 0) return prev
      const next = [...prev]
      const [item] = next.splice(fromIdx, 1)
      const adjustedTo = fromIdx < toIdx ? toIdx - 1 : toIdx
      next.splice(adjustedTo, 0, item)
      return next
    })
  }

  function removeLink(id: string) {
    setLinks(prev => prev.filter(l => l.id !== id))
  }

  function addLink(id: string) {
    const cat = QL_CATALOG.find(c => c.id === id)
    if (!cat) return
    setLinks(prev => prev.some(l => l.id === id) ? prev : [...prev, { ...cat }])
    setAddOpen(false)
  }

  function resizeLink(id: string, patch: Partial<Pick<QuickLink, 'size' | 'rowSpan'>>) {
    setLinks(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }

  function resetToDefault() {
    if (!confirm('Reset Quick Links to the default layout?')) return
    setLinks(QL_DEFAULT)
  }

  return (
    <div className="card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <SectionHeader title="Quick Links" />
        {editing && (
          <div className="flex items-center gap-2 text-xs">
            {/* Layout toggle — single-column or multi-tile grid */}
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setLayout('grid')}
                className={`px-1.5 py-0.5 text-[11px] transition-colors ${layout === 'grid' ? 'bg-accent text-white' : 'bg-surface text-text-2 hover:bg-surface-2'}`}
                title="Grid layout (use per-tile width)"
              >▦ Grid</button>
              <button
                onClick={() => setLayout('column')}
                className={`px-1.5 py-0.5 text-[11px] transition-colors border-l border-border ${layout === 'column' ? 'bg-accent text-white' : 'bg-surface text-text-2 hover:bg-surface-2'}`}
                title="Single-column layout (one tile per row)"
              >☰ Column</button>
            </div>
            <div className="relative">
              <button
                onClick={() => setAddOpen(o => !o)}
                disabled={available.length === 0}
                className="btn-outline py-1 px-2 text-xs disabled:opacity-40"
                title={available.length === 0 ? 'All catalog links already added' : 'Add a link'}
              >
                + Add link
              </button>
              {addOpen && available.length > 0 && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setAddOpen(false)} />
                  <div className="absolute top-full right-0 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 max-h-80 overflow-y-auto">
                    {available.map(c => (
                      <button
                        key={c.id}
                        onClick={() => addLink(c.id)}
                        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-surface-2 text-left text-xs text-text-2"
                      >
                        <span className="w-5 h-5 rounded bg-surface-2 flex items-center justify-center text-text-2">
                          <QuickLinkIcon name={c.icon} />
                        </span>
                        <span className="flex-1 font-medium text-text-1">{c.label}</span>
                        <span className="text-text-3">{c.href}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <button onClick={resetToDefault} className="text-text-3 hover:text-text-1 px-2 py-1 rounded hover:bg-surface-2" title="Reset to defaults">
              ↺
            </button>
          </div>
        )}
      </div>

      {visibleLinks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-text-3 italic">
          {editing ? 'No links — use "+ Add link" above.' : 'No shortcuts configured.'}
        </div>
      ) : (
        <div
          className="grid grid-cols-12 gap-2 flex-1"
          style={{ gridAutoRows: 'minmax(72px, auto)', gridAutoFlow: 'row dense' }}
        >
          {visibleLinks.map(link => {
            const isDragging  = dragId.current === link.id
            const isDropOver  = dragOverId === link.id && dragId.current && dragId.current !== link.id
            // Column layout overrides per-tile width — every tile gets a full
            // row, height stays user-controlled.
            const sizeCls     = (layout === 'column' ? 'col-span-12' : QL_SIZE_CLASS[link.size]) + ' ' + QL_ROW_CLASS[link.rowSpan]
            const tileClasses = `relative ${sizeCls} ${editing ? 'cursor-grab active:cursor-grabbing' : ''} ${isDragging ? 'opacity-40' : ''} ${isDropOver ? 'ring-2 ring-accent rounded-xl' : ''}`

            const tileInner = (
              <>
                <span className="w-8 h-8 rounded-lg bg-surface-2 group-hover:bg-accent/15 flex items-center justify-center text-text-2 group-hover:text-accent transition-colors shrink-0">
                  <QuickLinkIcon name={link.icon} />
                </span>
                <span className="truncate">{link.label}</span>
              </>
            )

            return (
              <div
                key={link.id}
                className={tileClasses}
                draggable={editing}
                onDragStart={e => {
                  if (!editing) return
                  dragId.current = link.id
                  e.dataTransfer.effectAllowed = 'move'
                  try { e.dataTransfer.setData('text/plain', link.id) } catch { /* ignore */ }
                }}
                onDragOver={e => {
                  if (!editing || !dragId.current || dragId.current === link.id) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (dragOverId !== link.id) setDragOverId(link.id)
                }}
                onDragLeave={() => { if (dragOverId === link.id) setDragOverId(null) }}
                onDrop={e => {
                  if (!editing || !dragId.current) return
                  e.preventDefault()
                  moveLink(dragId.current, link.id)
                  dragId.current = null
                  setDragOverId(null)
                }}
                onDragEnd={() => { dragId.current = null; setDragOverId(null) }}
              >
                {editing ? (
                  // Edit mode: render a non-navigating tile with controls overlay.
                  <div className="h-full flex flex-col items-center justify-center gap-1.5 py-2 px-2 rounded-xl border border-dashed border-accent/50 bg-accent-dim/30 text-center text-xs font-medium text-text-2 group">
                    {tileInner}
                    <div className="absolute top-1 left-1 flex items-center gap-0.5">
                      <select
                        value={link.size}
                        onChange={e => resizeLink(link.id, { size: e.target.value as QLSize })}
                        className="text-[10px] border border-border rounded px-0.5 py-0 bg-surface text-text-2"
                        title="Width"
                        onClick={e => e.stopPropagation()}
                      >
                        <option value="sm">¼</option>
                        <option value="md">½</option>
                        <option value="lg">¾</option>
                        <option value="xl">1</option>
                      </select>
                      <select
                        value={link.rowSpan}
                        onChange={e => resizeLink(link.id, { rowSpan: Number(e.target.value) as QLHeight })}
                        className="text-[10px] border border-border rounded px-0.5 py-0 bg-surface text-text-2"
                        title="Height"
                        onClick={e => e.stopPropagation()}
                      >
                        <option value={1}>1h</option>
                        <option value={2}>2h</option>
                        <option value={3}>3h</option>
                      </select>
                    </div>
                    <button
                      onClick={() => removeLink(link.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded hover:bg-red-100 text-red-500 text-xs"
                      title="Remove link"
                    >✕</button>
                  </div>
                ) : (
                  <a
                    href={link.href}
                    className="h-full flex flex-col items-center justify-center gap-1.5 py-2 px-2 rounded-xl border border-border hover:border-accent/40 hover:bg-accent-dim transition-all text-center text-xs font-medium text-text-2 hover:text-accent group"
                  >
                    {tileInner}
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Resolves an icon key from the stored config to a React element.
function QuickLinkIcon({ name }: { name: string }) {
  const C = QL_ICON_MAP[name]
  return C ? <C /> : <IconConfig /> // fallback to a generic cog if key renamed
}

// Icon dictionary — string keys so they survive JSON serialisation of the config.
const QL_ICON_MAP: Record<string, () => ReactElement> = {
  inventory: IconInventory,
  recipes:   IconRecipe,
  menus:     IconMenu,
  sales:     IconSales,
  stock:     IconStock,
  haccp:     IconHaccp,
  allergen:  IconAllergen,
  config:    IconConfig,
  dashboard: IconDashboardQL,
  audits:    IconAudits,
  media:     IconMedia,
  help:      IconHelp,
  system:    IconSystem,
}

function IconDashboardQL() { return (
  <svg {...iconProps}>
    <rect x="3" y="3"   width="7" height="9" rx="1"/>
    <rect x="14" y="3"  width="7" height="5" rx="1"/>
    <rect x="14" y="12" width="7" height="9" rx="1"/>
    <rect x="3" y="16"  width="7" height="5" rx="1"/>
  </svg>
)}
function IconAudits() { return (
  <svg {...iconProps}>
    <path d="M9 11l3 3 5-5"/>
    <path d="M21 12c0 5-3.5 9-9 9s-9-4-9-9 3.5-9 9-9 9 4 9 9z"/>
  </svg>
)}
function IconMedia() { return (
  <svg {...iconProps}>
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <circle cx="8.5" cy="8.5" r="1.5"/>
    <path d="M21 15l-5-5L5 21"/>
  </svg>
)}
function IconHelp() { return (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="10"/>
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  </svg>
)}
function IconSystem() { return (
  <svg {...iconProps}>
    <rect x="2" y="4" width="20" height="12" rx="2"/>
    <line x1="8"  y1="20" x2="16" y2="20"/>
    <line x1="12" y1="16" x2="12" y2="20"/>
  </svg>
)}

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

// ── NewIngredient widget ──────────────────────────────────────────────────────
// Quick-add card: button opens a modal mirroring InventoryPage's "Add Ingredient
// with optional price quote" flow. Posts to /ingredients and (when enabled)
// /price-quotes. Refreshes dashboard data on success so tiles / stats update.

interface Unit { id: number; name: string; abbreviation: string; type: string }

function NewIngredientWidget() {
  const api = useApi()
  const { categories, vendors, refresh } = useDashboardData()
  const [open, setOpen]     = useState(false)
  const [units, setUnits]   = useState<Unit[]>([])
  const [withQuote, setWithQuote] = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [form, setForm] = useState({
    name: '', category_id: '', base_unit_id: '',
    waste_pct: '', notes: '',
  })
  const [quoteForm, setQuoteForm] = useState({
    vendor_id: '', purchase_price: '', qty_in_base_units: '1', purchase_unit: '',
  })

  // Lazy-load units the first time the modal opens — small payload, not in
  // DashboardData today.
  useEffect(() => {
    if (!open || units.length) return
    api.get('/units').then((u: Unit[]) => setUnits(u || [])).catch(() => {})
  }, [open, units.length, api])

  function reset() {
    setForm({ name: '', category_id: '', base_unit_id: '', waste_pct: '', notes: '' })
    setQuoteForm({ vendor_id: '', purchase_price: '', qty_in_base_units: '1', purchase_unit: '' })
    setWithQuote(false)
    setErrors({})
  }

  const onSave = useCallback(async () => {
    const e: Record<string, string> = {}
    if (!form.name.trim())      e.name         = 'Required'
    if (!form.base_unit_id)     e.base_unit_id = 'Required'
    if (withQuote) {
      if (!quoteForm.vendor_id)      e.vendor_id      = 'Required'
      if (!quoteForm.purchase_price) e.purchase_price = 'Required'
    }
    setErrors(e)
    if (Object.keys(e).length) return

    setSaving(true)
    try {
      const payload = {
        name:             form.name.trim(),
        category_id:      form.category_id ? Number(form.category_id) : null,
        base_unit_id:     Number(form.base_unit_id),
        waste_pct:        Number(form.waste_pct) || 0,
        notes:            form.notes.trim() || null,
      }
      const created = await api.post('/ingredients', payload) as { id: number } | null
      if (withQuote && created?.id) {
        await api.post('/price-quotes', {
          ingredient_id:     created.id,
          vendor_id:         Number(quoteForm.vendor_id),
          purchase_price:    Number(quoteForm.purchase_price),
          qty_in_base_units: Number(quoteForm.qty_in_base_units) || 1,
          purchase_unit:     quoteForm.purchase_unit.trim() || null,
          is_active:         true,
        })
        setToast({ message: 'Ingredient and price quote added', type: 'success' })
      } else {
        setToast({ message: 'Ingredient added', type: 'success' })
      }
      setOpen(false)
      reset()
      refresh()
    } catch (err: any) {
      setToast({ message: err?.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }, [api, form, quoteForm, withQuote, refresh])

  return (
    <div className="card p-5 h-full flex flex-col items-start gap-3 bg-gradient-to-br from-accent-dim to-surface">
      <div className="flex-1">
        <div className="text-xs uppercase tracking-wider text-accent font-semibold mb-1">Quick add</div>
        <h2 className="text-lg font-bold text-text-1">{useWidgetLabel('New ingredient')}</h2>
        <p className="text-sm text-text-2 mt-1">
          Capture a new ingredient, with an optional first price quote in one go.
        </p>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="btn-primary px-4 py-2 text-sm"
      >
        + New ingredient
      </button>

      {open && (
        <Modal
          title="New ingredient"
          onClose={() => { setOpen(false); reset() }}
          width="max-w-lg"
        >
          <Field label="Name" required error={errors.name}>
            <input
              className="input w-full"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Chicken Breast"
              autoFocus
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Category">
              <select
                className="select w-full"
                value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
              >
                <option value="">No category…</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Base Unit" required error={errors.base_unit_id}>
              <select
                className="select w-full"
                value={form.base_unit_id}
                onChange={e => setForm(f => ({ ...f, base_unit_id: e.target.value }))}
              >
                <option value="">Select unit…</option>
                {['mass', 'volume', 'count'].map(type => (
                  <optgroup key={type} label={type[0].toUpperCase() + type.slice(1)}>
                    {units.filter(u => u.type === type).map(u => (
                      <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Waste %">
              <input
                type="number"
                className="input w-full"
                value={form.waste_pct}
                onChange={e => setForm(f => ({ ...f, waste_pct: e.target.value }))}
                placeholder="0"
              />
            </Field>
            <Field label="Notes">
              <input
                className="input w-full"
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Optional…"
              />
            </Field>
          </div>

          <div className="border-t border-border pt-4 mt-2">
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={withQuote}
                onChange={e => setWithQuote(e.target.checked)}
                className="w-4 h-4 accent-accent"
              />
              <span className="text-sm font-semibold text-text-2">Also add a first price quote</span>
            </label>

            {withQuote && (
              <>
                <Field label="Vendor" required error={errors.vendor_id}>
                  <select
                    className="select w-full"
                    value={quoteForm.vendor_id}
                    onChange={e => setQuoteForm(q => ({ ...q, vendor_id: e.target.value }))}
                  >
                    <option value="">Select vendor…</option>
                    {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </Field>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Purchase price" required error={errors.purchase_price}>
                    <input
                      type="number"
                      step="0.01"
                      className="input w-full"
                      value={quoteForm.purchase_price}
                      onChange={e => setQuoteForm(q => ({ ...q, purchase_price: e.target.value }))}
                      placeholder="0.00"
                    />
                  </Field>
                  <Field label="Qty in base units">
                    <input
                      type="number"
                      step="0.0001"
                      className="input w-full"
                      value={quoteForm.qty_in_base_units}
                      onChange={e => setQuoteForm(q => ({ ...q, qty_in_base_units: e.target.value }))}
                      placeholder="1"
                    />
                  </Field>
                  <Field label="Purchase unit">
                    <input
                      className="input w-full"
                      value={quoteForm.purchase_unit}
                      onChange={e => setQuoteForm(q => ({ ...q, purchase_unit: e.target.value }))}
                      placeholder="kg"
                    />
                  </Field>
                </div>
              </>
            )}
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              className="btn-ghost px-4 py-2 text-sm"
              onClick={() => { setOpen(false); reset() }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : (withQuote ? 'Add ingredient + quote' : 'Add ingredient')}
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── NewPriceQuote widget ──────────────────────────────────────────────────────
// Companion to NewIngredient: pick an existing ingredient + vendor, enter the
// price and purchase pack size. Idempotent — same ingredient+vendor can have
// multiple historical quotes, and `is_active` marks the current one.

function NewPriceQuoteWidget() {
  const api = useApi()
  const { ingredients, vendors, refresh } = useDashboardData()
  const [open, setOpen]     = useState(false)
  const [saving, setSaving] = useState(false)
  const [toast, setToast]   = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ingSearch, setIngSearch] = useState('')

  const [form, setForm] = useState({
    ingredient_id:     '',
    vendor_id:         '',
    purchase_price:    '',
    qty_in_base_units: '1',
    purchase_unit:     '',
    vendor_product_code: '',
    is_active:         true,
  })

  function reset() {
    setForm({
      ingredient_id: '', vendor_id: '', purchase_price: '',
      qty_in_base_units: '1', purchase_unit: '',
      vendor_product_code: '', is_active: true,
    })
    setIngSearch('')
    setErrors({})
  }

  // Client-side filter so the select stays snappy even with thousands of
  // ingredients. Sorted so the selected one stays visible.
  const filteredIngredients = useMemo(() => {
    const needle = ingSearch.trim().toLowerCase()
    if (!needle) return ingredients
    return ingredients.filter(i => i.name.toLowerCase().includes(needle))
  }, [ingredients, ingSearch])

  const onSave = useCallback(async () => {
    const e: Record<string, string> = {}
    if (!form.ingredient_id)  e.ingredient_id  = 'Required'
    if (!form.vendor_id)      e.vendor_id      = 'Required'
    if (!form.purchase_price) e.purchase_price = 'Required'
    setErrors(e)
    if (Object.keys(e).length) return

    setSaving(true)
    try {
      await api.post('/price-quotes', {
        ingredient_id:       Number(form.ingredient_id),
        vendor_id:           Number(form.vendor_id),
        purchase_price:      Number(form.purchase_price),
        qty_in_base_units:   Number(form.qty_in_base_units) || 1,
        purchase_unit:       form.purchase_unit.trim() || null,
        vendor_product_code: form.vendor_product_code.trim() || null,
        is_active:           form.is_active,
      })
      setToast({ message: 'Price quote added', type: 'success' })
      setOpen(false)
      reset()
      refresh()
    } catch (err: any) {
      setToast({ message: err?.message || 'Save failed', type: 'error' })
    } finally {
      setSaving(false)
    }
  }, [api, form, refresh])

  return (
    <div className="card p-5 h-full flex flex-col items-start gap-3 bg-gradient-to-br from-accent-dim to-surface">
      <div className="flex-1">
        <div className="text-xs uppercase tracking-wider text-accent font-semibold mb-1">Quick add</div>
        <h2 className="text-lg font-bold text-text-1">{useWidgetLabel('New price quote')}</h2>
        <p className="text-sm text-text-2 mt-1">
          Record a fresh price for an existing ingredient from any vendor.
        </p>
      </div>
      <button
        onClick={() => setOpen(true)}
        className="btn-primary px-4 py-2 text-sm"
        disabled={ingredients.length === 0 || vendors.length === 0}
        title={
          ingredients.length === 0
            ? 'Add an ingredient first'
            : vendors.length === 0
              ? 'Add a vendor first'
              : undefined
        }
      >
        + New price quote
      </button>

      {open && (
        <Modal
          title="New price quote"
          onClose={() => { setOpen(false); reset() }}
          width="max-w-lg"
        >
          <Field label="Ingredient" required error={errors.ingredient_id}>
            <input
              className="input w-full mb-2"
              value={ingSearch}
              onChange={e => setIngSearch(e.target.value)}
              placeholder="Search ingredients…"
            />
            <select
              className="select w-full"
              size={6}
              value={form.ingredient_id}
              onChange={e => setForm(f => ({ ...f, ingredient_id: e.target.value }))}
            >
              {filteredIngredients.length === 0 ? (
                <option disabled>No matches</option>
              ) : filteredIngredients.map(i => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Vendor" required error={errors.vendor_id}>
            <select
              className="select w-full"
              value={form.vendor_id}
              onChange={e => setForm(f => ({ ...f, vendor_id: e.target.value }))}
              autoFocus
            >
              <option value="">Select vendor…</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Purchase price" required error={errors.purchase_price}>
              <input
                type="number"
                step="0.01"
                className="input w-full"
                value={form.purchase_price}
                onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))}
                placeholder="0.00"
              />
            </Field>
            <Field label="Qty in base units">
              <input
                type="number"
                step="0.0001"
                className="input w-full"
                value={form.qty_in_base_units}
                onChange={e => setForm(f => ({ ...f, qty_in_base_units: e.target.value }))}
                placeholder="1"
              />
            </Field>
            <Field label="Purchase unit">
              <input
                className="input w-full"
                value={form.purchase_unit}
                onChange={e => setForm(f => ({ ...f, purchase_unit: e.target.value }))}
                placeholder="kg"
              />
            </Field>
          </div>

          <Field label="Vendor product code">
            <input
              className="input w-full"
              value={form.vendor_product_code}
              onChange={e => setForm(f => ({ ...f, vendor_product_code: e.target.value }))}
              placeholder="Optional SKU"
            />
          </Field>

          <label className="flex items-center gap-2 cursor-pointer text-sm text-text-2 pt-1">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              className="w-4 h-4 accent-accent"
            />
            Mark as the active quote for this ingredient + vendor
          </label>

          <div className="flex gap-3 justify-end pt-2">
            <button
              className="btn-ghost px-4 py-2 text-sm"
              onClick={() => { setOpen(false); reset() }}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              className="btn-primary px-4 py-2 text-sm"
              onClick={onSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Add price quote'}
            </button>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Unquoted ingredients in recipes (with optional menu filter) ───────────────
//
// Different from "missing-quotes": this only counts ingredients that are
// actually referenced by at least one recipe — so you see real costing gaps,
// not orphaned catalog rows. Optional menu dropdown narrows the list to
// ingredients used by recipes that the menu serves.

interface UnquotedRow {
  id: number
  name: string
  base_unit_abbr: string | null
  category_name: string | null
  recipe_count: number
  used_in_recipes: string[]
}

function RecipeUnquotedIngredients() {
  const api = useApi()
  const navigate = useNavigate()
  const { menus } = useDashboardData()
  const [menuId, setMenuId] = useState<number | null>(null)
  const [rows, setRows] = useState<UnquotedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const path = menuId
      ? `/ingredients/unquoted-in-recipes?menu_id=${menuId}`
      : `/ingredients/unquoted-in-recipes`
    api.get(path)
      .then((data: UnquotedRow[]) => { if (!cancelled) setRows(Array.isArray(data) ? data : []) })
      .catch((err: { message?: string }) => { if (!cancelled) setError(err?.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, menuId])

  return (
    <div className="card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <SectionHeader title="Unquoted Ingredients in Recipes" count={loading ? undefined : rows.length} />
        <select
          className="input text-xs py-1 max-w-[200px]"
          value={menuId ?? ''}
          onChange={e => setMenuId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">All menus</option>
          {menus.map(m => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-2 flex-1">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8" />)}</div>
      ) : error ? (
        <div className="text-red-500 text-sm">{error}</div>
      ) : rows.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-6">
          <span className="badge-green text-sm">✓ Full coverage</span>
          <p className="text-text-3 text-sm text-center">
            {menuId
              ? 'Every ingredient used by this menu has at least one active price quote.'
              : 'Every ingredient referenced in a recipe has at least one active price quote.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1">
          {rows.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(`/inventory?addQuote=${item.id}`)}
              className="w-full flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-surface-2 text-left transition-colors group"
              title={`Add a price quote for ${item.name}`}
            >
              <span className="text-amber-500 mt-0.5">⚠</span>
              <div className="flex-1 min-w-0">
                <p className="text-text-1 text-sm font-medium truncate">{item.name}</p>
                <p className="text-text-3 text-xs truncate" title={item.used_in_recipes.join(', ')}>
                  {item.category_name ? `${item.category_name} · ` : ''}
                  Used in {item.recipe_count} recipe{item.recipe_count !== 1 ? 's' : ''}
                  {item.recipe_count <= 3 ? `: ${item.used_in_recipes.join(', ')}` : ''}
                </p>
              </div>
              <div className="flex flex-col items-end shrink-0 gap-0.5">
                <span className="text-text-3 text-xs">{item.base_unit_abbr || ''}</span>
                <span className="text-accent text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">+ Add quote</span>
              </div>
            </button>
          ))}
        </div>
      )}
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
  'mapbox-map':        MapboxMapWidget,
  'mapbox-country-map': MapboxCountryMapWidget,
  'menu-top-items':    MenuTopItemsWidget,
  'new-ingredient':    NewIngredientWidget,
  'new-price-quote':   NewPriceQuoteWidget,
  'country-region-map': CountryRegionMapWidget,
  'recipe-unquoted-ingredients': RecipeUnquotedIngredients,
}
