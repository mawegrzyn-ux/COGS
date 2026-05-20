import { createContext, useContext, useEffect, useState, useCallback, useMemo, ReactNode } from 'react'
import { useApi } from '../hooks/useApi'
import { useMarket } from '../contexts/MarketContext'

// Shared types
export interface PriceLevel { id: number; name: string; is_default: boolean }
export interface CogsThresholds { excellent: number; acceptable: number }

export interface SimpleMenu {
  id: number; name: string; country_id: number; country_name: string
}

export interface RecentQuote {
  id: number
  ingredient_id: number
  ingredient_name: string
  vendor_name: string
  country_id?: number
  country_name: string
  unit_price: number
  currency_code: string
  updated_at: string
  is_active: boolean
}

export interface Ingredient { id: number; name: string }
export interface Vendor { id: number; name: string; country_id: number }
export interface Category { id: number; name: string }

export interface MenuCogsTile {
  menu_id: number
  menu_name: string
  country_id: number
  country_name: string
  item_count: number
  levels: { id: number; name: string; is_default: boolean; cogs_pct: number | null }[]
}

interface DashboardDataValue {
  loading: boolean
  refreshing: boolean
  lastRefresh: Date
  ingredients: Ingredient[]
  recipes: { id: number }[]
  vendors: Vendor[]
  countries: { id: number; name: string; currency_symbol: string; currency_code: string }[]
  menus: SimpleMenu[]
  categories: Category[]
  priceLevels: PriceLevel[]
  quotes: RecentQuote[]
  cogsThresholds: CogsThresholds | null
  menuTiles: MenuCogsTile[]
  menuTilesLoading: boolean
  refresh: () => Promise<void>
}

const DashboardDataContext = createContext<DashboardDataValue>({
  loading: true, refreshing: false, lastRefresh: new Date(),
  ingredients: [], recipes: [], vendors: [], countries: [], menus: [],
  categories: [], priceLevels: [], quotes: [],
  cogsThresholds: null, menuTiles: [], menuTilesLoading: false,
  refresh: async () => {},
})

/**
 * Loads all the data dashboard widgets depend on (once, shared across widgets).
 * Widgets read from this via useDashboardData() and apply their own filtering
 * (e.g. market scope) on top.
 */
export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const { countryId } = useMarket()

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [recipes, setRecipes] = useState<{ id: number }[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [countries, setCountries] = useState<DashboardDataValue['countries']>([])
  const [menus, setMenus] = useState<SimpleMenu[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [priceLevels, setPriceLevels] = useState<PriceLevel[]>([])
  const [quotes, setQuotes] = useState<RecentQuote[]>([])
  const [cogsThresholds, setCogsThresholds] = useState<CogsThresholds | null>(null)
  const [menuTiles, setMenuTiles] = useState<MenuCogsTile[]>([])
  const [menuTilesLoading, setMenuTilesLoading] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [
        ingredientsR, recipesR, vendorsR, countriesR, quotesR,
        categoriesR, priceLevelsR, menusR, settingsR,
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
      setIngredients(ingredientsR || [])
      setRecipes(recipesR || [])
      setVendors(vendorsR || [])
      setCountries(countriesR || [])
      setMenus(menusR || [])
      setCategories(categoriesR || [])
      setPriceLevels(priceLevelsR || [])
      setQuotes(quotesR || [])
      if (settingsR?.cogs_thresholds) setCogsThresholds(settingsR.cogs_thresholds)
      setLastRefresh(new Date())
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [api])

  useEffect(() => { refresh() }, [refresh])

  // Load per-menu COGS tiles (scoped to selected market if any)
  useEffect(() => {
    if (!menus.length || !priceLevels.length) return
    let cancelled = false
    setMenuTilesLoading(true)
    const scopedMenus = countryId == null ? menus : menus.filter(m => m.country_id === countryId)
    Promise.all(
      scopedMenus.map(async menu => {
        const results = await Promise.all(
          priceLevels.map(level =>
            api.get(`/cogs/menu-sales/${menu.id}?price_level_id=${level.id}`)
              .then((res: any) => ({
                level_id: level.id,
                cogs_pct: res?.summary?.avg_cogs_pct_net ?? null,
                item_count: (res?.items ?? []).length,
              }))
              .catch(() => ({ level_id: level.id, cogs_pct: null, item_count: 0 }))
          )
        )
        const item_count = Math.max(...results.map(r => r.item_count))
        return {
          menu_id: menu.id,
          menu_name: menu.name,
          country_id: menu.country_id,
          country_name: menu.country_name,
          item_count: item_count > 0 ? item_count : 0,
          levels: priceLevels.map((level, i) => ({
            id: level.id, name: level.name, is_default: level.is_default,
            cogs_pct: results[i].cogs_pct,
          })),
        } as MenuCogsTile
      })
    ).then(tiles => { if (!cancelled) setMenuTiles(tiles) })
      .finally(() => { if (!cancelled) setMenuTilesLoading(false) })
    return () => { cancelled = true }
  }, [menus, priceLevels, api, countryId])

  const value = useMemo<DashboardDataValue>(() => ({
    loading, refreshing, lastRefresh,
    ingredients, recipes, vendors, countries, menus,
    categories, priceLevels, quotes, cogsThresholds,
    menuTiles, menuTilesLoading, refresh,
  }), [
    loading, refreshing, lastRefresh,
    ingredients, recipes, vendors, countries, menus,
    categories, priceLevels, quotes, cogsThresholds,
    menuTiles, menuTilesLoading, refresh,
  ])

  return <DashboardDataContext.Provider value={value}>{children}</DashboardDataContext.Provider>
}

export function useDashboardData() {
  return useContext(DashboardDataContext)
}
