import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../hooks/useApi'
import { useMarket } from '../contexts/MarketContext'
import { useDashboardData } from './DashboardData'

type Metric = 'cost' | 'revenue' | 'cogs_pct'

interface ChartRow {
  name: string
  value: number
  cogs_pct: number | null
}

interface MenuDataset {
  menu_id: number
  menu_name: string
  currency_symbol: string
  rows: ChartRow[]
  loading: boolean
}

/**
 * Renders a horizontal bar chart of the top 10 items for each menu in the current
 * market scope. One collapsible mini-chart per menu. User can toggle the metric
 * between "highest cost per portion", "highest revenue" (needs scenario qty) and
 * "worst COGS %".
 */
export default function MenuTopItemsChart() {
  const api = useApi()
  const { selected, countryId } = useMarket()
  const { menus, priceLevels } = useDashboardData()
  const [metric, setMetric] = useState<Metric>('cost')
  const [datasets, setDatasets] = useState<Record<number, MenuDataset>>({})

  // Scope menus to the active market (if any)
  const scopedMenus = useMemo(
    () => countryId == null ? menus : menus.filter(m => m.country_id === countryId),
    [menus, countryId],
  )

  // Default price level — first default, else first available
  const defaultLevelId = useMemo(() => {
    if (!priceLevels.length) return null
    return (priceLevels.find(p => p.is_default) ?? priceLevels[0]).id
  }, [priceLevels])

  // Per-menu price level override (for users who want to compare levels)
  const [levelByMenu, setLevelByMenu] = useState<Record<number, number>>({})

  // Load the per-country enablement matrix so we can filter each menu's
  // level dropdown. Map key = `${country_id}-${price_level_id}`. Missing row
  // defaults to enabled (preserves pre-feature behaviour).
  const [cplMatrix, setCplMatrix] = useState<Map<string, boolean>>(new Map())
  useEffect(() => {
    let cancelled = false
    api.get('/country-price-levels')
      .then((rows: any) => {
        if (cancelled) return
        const m = new Map<string, boolean>()
        ;(rows || []).forEach((r: any) => m.set(`${r.country_id}-${r.price_level_id}`, !!r.is_enabled))
        setCplMatrix(m)
      })
      .catch(() => { /* non-fatal; all levels stay visible */ })
    return () => { cancelled = true }
  }, [api])

  function levelsForMenu(menuCountryId: number | null | undefined) {
    if (menuCountryId == null || cplMatrix.size === 0) return priceLevels
    return priceLevels.filter(p => cplMatrix.get(`${menuCountryId}-${p.id}`) !== false)
  }

  // Fetch cogs for each scoped menu
  useEffect(() => {
    if (!defaultLevelId) return
    let cancelled = false
    for (const menu of scopedMenus) {
      const levelId = levelByMenu[menu.id] ?? defaultLevelId
      const key = menu.id
      setDatasets(prev => ({ ...prev, [key]: { ...(prev[key] ?? { menu_id: menu.id, menu_name: menu.name, currency_symbol: '', rows: [] }), loading: true } }))
      api.get(`/cogs/menu-sales/${menu.id}?price_level_id=${levelId}`)
        .then((res: any) => {
          if (cancelled) return
          const items = (res?.items ?? []) as any[]
          const currency_symbol = res?.currency_symbol ?? ''
          const rows: ChartRow[] = items.map(it => ({
            name: it.display_name ?? it.recipe_name ?? '—',
            value: metric === 'cost'
              ? (it.cost_per_portion ?? 0)
              : metric === 'revenue'
                ? ((it.qty ?? 0) * (it.sell_price_net ?? 0))
                : (it.cogs_pct_net ?? 0),
            cogs_pct: it.cogs_pct_net ?? null,
          }))
          rows.sort((a, b) => b.value - a.value)
          setDatasets(prev => ({
            ...prev,
            [key]: { menu_id: menu.id, menu_name: menu.name, currency_symbol, rows: rows.slice(0, 10), loading: false },
          }))
        })
        .catch(() => {
          if (!cancelled) setDatasets(prev => ({ ...prev, [key]: { ...(prev[key] ?? { menu_id: menu.id, menu_name: menu.name, currency_symbol: '', rows: [] }), loading: false } }))
        })
    }
    return () => { cancelled = true }
  }, [api, scopedMenus, defaultLevelId, levelByMenu, metric])

  const metricLabel =
    metric === 'cost'     ? 'Cost per portion'
    : metric === 'revenue' ? 'Revenue (qty × price)'
    :                        'COGS %'

  return (
    <div className="card p-5 h-full">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-text-1 uppercase tracking-wide">
            Top 10 items per menu
          </h2>
          <p className="text-xs text-text-3 mt-0.5">
            {selected ? `${selected.name} · ${metricLabel}` : `All markets · ${metricLabel}`}
          </p>
        </div>
        <div className="flex items-center gap-1 bg-surface-2 rounded-lg p-0.5">
          {(['cost', 'revenue', 'cogs_pct'] as Metric[]).map(m => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                metric === m ? 'bg-surface text-text-1 shadow-sm' : 'text-text-3 hover:text-text-1'
              }`}
            >
              {m === 'cost' ? 'Cost' : m === 'revenue' ? 'Revenue' : 'COGS%'}
            </button>
          ))}
        </div>
      </div>

      {scopedMenus.length === 0 ? (
        <div className="py-8 text-center text-text-3 text-sm">
          {selected ? `No menus in ${selected.name}` : 'No menus yet'}
        </div>
      ) : (
        <div className="space-y-5">
          {scopedMenus.map(menu => {
            const ds = datasets[menu.id]
            const levelId = levelByMenu[menu.id] ?? defaultLevelId
            return (
              <div key={menu.id}>
                {/* Menu header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="font-medium text-sm text-text-1 flex items-center gap-2">
                    <span>{menu.name}</span>
                    <span className="text-xs text-text-3">· {menu.country_name}</span>
                  </div>
                  {(() => {
                    const visibleLevels = levelsForMenu(menu.country_id)
                    if (visibleLevels.length <= 1) return null
                    return (
                      <select
                        value={levelId ?? ''}
                        onChange={e => setLevelByMenu(prev => ({ ...prev, [menu.id]: Number(e.target.value) }))}
                        className="text-xs border border-border rounded px-1.5 py-0.5 bg-surface text-text-2"
                      >
                        {visibleLevels.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )
                  })()}
                </div>

                {/* Chart */}
                {!ds || ds.loading ? (
                  <div className="space-y-1.5">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="h-5 bg-surface-2 rounded animate-pulse" />
                    ))}
                  </div>
                ) : ds.rows.length === 0 ? (
                  <div className="text-xs text-text-3 py-2">No items on this menu</div>
                ) : (
                  <BarChart rows={ds.rows} metric={metric} currency={ds.currency_symbol} />
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function BarChart({ rows, metric, currency }: { rows: ChartRow[]; metric: Metric; currency: string }) {
  const max = Math.max(...rows.map(r => r.value), 0.0001)

  function fmt(v: number) {
    if (metric === 'cogs_pct') return `${v.toFixed(1)}%`
    return `${currency}${v.toFixed(2)}`
  }

  function barColor(row: ChartRow): string {
    if (metric === 'cogs_pct') {
      if (row.value <= 30) return 'var(--accent)'
      if (row.value <= 40) return '#D97706'
      return '#DC2626'
    }
    return 'var(--accent)'
  }

  return (
    <div className="space-y-1">
      {rows.map((r, i) => {
        const pct = (r.value / max) * 100
        return (
          <div key={i} className="flex items-center gap-2 group">
            <div className="w-40 text-xs text-text-2 truncate flex-shrink-0" title={r.name}>
              {r.name}
            </div>
            <div className="flex-1 relative h-5 bg-surface-2 rounded overflow-hidden">
              <div
                className="h-full transition-all duration-500"
                style={{ width: `${Math.max(2, pct)}%`, background: barColor(r) }}
              />
            </div>
            <div className="w-24 text-right text-xs font-mono text-text-1 tabular-nums flex-shrink-0">
              {fmt(r.value)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
