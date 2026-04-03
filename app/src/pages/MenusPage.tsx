import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useCogsThresholds, type CogsThresholds } from '../hooks/useCogsThresholds'
import { PageHeader, Modal, Field, Spinner, ConfirmDialog, Toast, PepperHelpButton } from '../components/ui'
import { ColumnHeader } from '../components/ColumnHeader'
import { useSortFilter } from '../hooks/useSortFilter'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Country     { id: number; name: string; currency_code: string; currency_symbol: string; exchange_rate: number }
interface PriceLevel  { id: number; name: string; is_default: boolean }
interface TaxRate     { id: number; country_id: number; name: string; rate: number; is_default: boolean }
interface CountryLevelTax { id: number; country_id: number; price_level_id: number; tax_rate_id: number }
interface Recipe      { id: number; name: string; category: string | null }
interface Ingredient  { id: number; name: string; base_unit_abbr: string | null }

interface Menu {
  id: number
  name: string
  country_id: number
  description: string | null
  country_name: string
}

interface MenuItem {
  id: number
  menu_id: number
  item_type: 'recipe' | 'ingredient'
  recipe_id: number | null
  ingredient_id: number | null
  display_name: string
  qty: number
  sell_price: number
  tax_rate_id: number | null
  recipe_name?: string
  ingredient_name?: string
  base_unit_abbr?: string
  yield_qty?: number
}

interface MenuItemPrice {
  id: number
  menu_item_id: number
  price_level_id: number
  sell_price: number
  tax_rate_id: number | null
}

interface CogsItem {
  menu_item_id:     number
  item_type:        'recipe' | 'ingredient'
  recipe_id:        number | null
  ingredient_id:    number | null
  display_name:     string
  recipe_name:      string
  category:         string
  qty:              number
  base_unit_abbr:   string
  cost_per_portion: number
  sell_price_gross: number
  sell_price_net:   number
  tax_rate:         number
  tax_rate_pct:     number
  tax_name:         string
  tax_rate_id:      number | null
  gp_net:           number
  gp_gross:         number
  cogs_pct_net:     number
  cogs_pct_gross:   number
}

interface CogsSummary {
  total_cost: number
  total_sell_net: number
  total_sell_gross: number
  avg_cogs_pct_net: number
  avg_cogs_pct_gross: number
}

interface CogsData {
  menu_id:         number
  currency_code:   string
  currency_symbol: string
  exchange_rate:   number
  items:           CogsItem[]
  summary:         CogsSummary
}

// Price report types
interface PriceReportCountry {
  id: number; name: string; code: string; symbol: string; rate: number
}
interface PriceReportCountryEntry {
  on_menu: boolean
  menu_id?: number
  menu_name?: string
  sell_gross?: number
  sell_net?: number
  cost?: number
  cogs_pct?: number | null
  menu_item_id?: number | null
  rate?: number
}
interface PriceReportRecipe {
  recipe_id: number
  recipe_name: string
  category: string
  countries: Record<number, PriceReportCountryEntry[]>
}
interface PriceReportData {
  recipes: PriceReportRecipe[]
  countries: PriceReportCountry[]
  price_levels: PriceLevel[]
  base_currency: { code: string; symbol: string; name: string }
}

// Level report types
interface LevelReportItem {
  menu_item_id: number
  display_name: string
  item_type: 'recipe' | 'ingredient'
  menu_name: string
  category: string
  cost: number
  levels: Record<number, { set: boolean; gross: number | null; net: number | null; cogs_pct: number | null; gp_net: number | null; lp_id?: number }>
}
interface LevelReportData {
  country: { id: number; name: string; symbol: string; code: string; rate: number }
  levels: PriceLevel[]
  items: LevelReportItem[]
}

interface MeChange {
  id:             number
  user_name:      string
  change_type:    'price' | 'qty' | 'comment'
  menu_item_id:   number | null
  price_level_id: number | null
  display_name:   string | null
  level_name:     string | null
  old_value:      number | null
  new_value:      number | null
  comment:        string | null
  parent_id:      number | null
  created_at:     string
  shared_page_id?: number  // which shared view this entry came from (tagged client-side)
}

interface SharedPage {
  id: number; slug: string; name: string; mode: 'view' | 'edit'
  notes: string | null
  menu_id: number | null; country_id: number | null; scenario_id: number | null
  menu_name: string | null; country_name: string | null; scenario_name: string | null
  is_active: boolean; expires_at: string | null; created_at: string
}

interface ScenarioSummary { id: number; name: string; menu_id: number | null; menu_name: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2)
const cogsClass = (pct: number, thr: CogsThresholds): 'green' | 'yellow' | 'red' =>
  pct <= thr.excellent ? 'green' : pct <= thr.acceptable ? 'yellow' : 'red'
const cogsColourClass = (pct: number, thr: CogsThresholds) => {
  const c = cogsClass(pct, thr)
  return c === 'green' ? 'text-emerald-600' : c === 'yellow' ? 'text-amber-500' : 'text-red-500'
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MenusPage() {
  const api = useApi()
  const cogsThresholds = useCogsThresholds()
  const [searchParams, setSearchParams] = useSearchParams()

  // shared data
  const [countries,       setCountries]       = useState<Country[]>([])
  const [priceLevels,     setPriceLevels]     = useState<PriceLevel[]>([])
  const [taxRates,        setTaxRates]        = useState<TaxRate[]>([])
  const [countryLevelTax, setCountryLevelTax] = useState<CountryLevelTax[]>([])
  const [recipes,         setRecipes]         = useState<Recipe[]>([])
  const [ingredients,     setIngredients]     = useState<Ingredient[]>([])
  const [menus,           setMenus]           = useState<Menu[]>([])
  const [loading,         setLoading]         = useState(true)

  // tab
  const [activeTab, setActiveTab] = useState<'builder' | 'price-report' | 'level-report' | 'scenario' | 'shared-links'>('builder')

  // builder state
  const [selectedMenuId,  setSelectedMenuId]  = useState<number | null>(null)
  const [levelOverridden, setLevelOverridden] = useState(false)  // true once user manually changes level
  const [activeMenuLevel, setActiveMenuLevel] = useState<number | ''>('')
  const [cogsData,        setCogsData]        = useState<CogsData | null>(null)
  const [loadingCogs,     setLoadingCogs]     = useState(false)
  const [menuSearch,      setMenuSearch]      = useState('')
  const [menuCountryFilter, setMenuCountryFilter] = useState<number | ''>('')
  const [itemFilterQ,     setItemFilterQ]     = useState('')
  const [itemFilterType,  setItemFilterType]  = useState('')
  const [itemFilterStatus,setItemFilterStatus]= useState('')
  const [itemFilterCat,   setItemFilterCat]   = useState('')
  const [itemSortCol,     setItemSortCol]     = useState('name')
  const [itemSortDir,     setItemSortDir]     = useState<1 | -1>(1)

  // modals
  const [menuModal,     setMenuModal]     = useState<'new' | Menu | null>(null)
  const [menuItemModal, setMenuItemModal] = useState<'new' | CogsItem | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'menu' | 'item'; id: number } | null>(null)
  const [levelPrices,   setLevelPrices]   = useState<MenuItemPrice[]>([])

  // menu item form
  const [miType,        setMiType]        = useState<'recipe' | 'ingredient'>('recipe')
  const [miRecipeId,    setMiRecipeId]    = useState<number | ''>('')
  const [miIngId,       setMiIngId]       = useState<number | ''>('')
  const [miDisplayName, setMiDisplayName] = useState('')
  const [miQty,         setMiQty]         = useState('1')
  const [miLevelInputs, setMiLevelInputs] = useState<Record<number, { price: string; taxId: number | '' }>>({})

  // price report
  // price level tool
  const [priceReportData,    setPriceReportData]    = useState<PriceReportData | null>(null)
  const [priceReportLoading, setPriceReportLoading] = useState(false)
  const [priceReportLoaded,  setPriceReportLoaded]  = useState(false)
  const [priceSelectedLevel, setPriceSelectedLevel] = useState<number | ''>('')
  const [priceCurrencyMode,  setPriceCurrencyMode]  = useState<'own' | 'single'>('own')
  const [priceSingleCurrency,setPriceSingleCurrency]= useState('')
  const [priceSearch,        setPriceSearch]        = useState('')
  const [priceCat,           setPriceCat]           = useState('')


  // scenario tool — persist last-used menu to survive page reload
  const [scenarioMenuId,    setScenarioMenuId]    = useState<number | null>(() => {
    try { const v = localStorage.getItem('me_last_menu_id'); return v ? Number(v) : null } catch { return null }
  })
  const [scenarioLevelId,   setScenarioLevelId]   = useState<number | '' | 'ALL'>('ALL')
  const [scenarioData,      setScenarioData]      = useState<CogsData | null>(null)
  const [scenarioLoading,   setScenarioLoading]   = useState(false)
  const [scenarioQty,       setScenarioQty]       = useState<Record<string, string>>({})
  const [scenarioRefreshKey, setScenarioRefreshKey] = useState(0)

  // market price tool
  const [levelReportData,    setLevelReportData]    = useState<LevelReportData | null>(null)
  const [levelReportLoading, setLevelReportLoading] = useState(false)
  const [lrCountryId,        setLrCountryId]        = useState<number | ''>('')
  const [lrSearch,           setLrSearch]           = useState('')
  const [lrSaveTimers,       setLrSaveTimers]       = useState<Record<string, ReturnType<typeof setTimeout>>>({})
  const [lrSaving,           setLrSaving]           = useState<Record<string, boolean>>({})
  const [lrSaved,            setLrSaved]            = useState<Record<string, boolean>>({})

  // shared links
  const [sharedPages,     setSharedPages]     = useState<SharedPage[]>([])
  const [sharedLoading,   setSharedLoading]   = useState(false)
  const [sharedModal,     setSharedModal]     = useState<'new' | SharedPage | null>(null)
  const [sharedConfirm,   setSharedConfirm]   = useState<number | null>(null)
  const [spName,          setSpName]          = useState('')
  const [spMode,          setSpMode]          = useState<'view' | 'edit'>('view')
  const [spPassword,      setSpPassword]      = useState('')
  const [spMenuId,        setSpMenuId]        = useState<number | ''>('')
  const [spCountryId,     setSpCountryId]     = useState<number | ''>('')
  const [spScenarioId,    setSpScenarioId]    = useState<number | ''>('')
  const [spExpires,       setSpExpires]       = useState('')
  const [spNotes,         setSpNotes]         = useState('')
  const [spSaving,        setSpSaving]        = useState(false)
  const [copiedSlug,      setCopiedSlug]      = useState<string | null>(null)
  const [allScenarios,    setAllScenarios]    = useState<ScenarioSummary[]>([])

  // Menu Engineer change panel
  const [meChanges,          setMeChanges]          = useState<MeChange[]>([])
  const [meChangesLoading,   setMeChangesLoading]   = useState(false)
  const [meSharedPageId,     setMeSharedPageId]     = useState<number | null>(null)
  const [meCurrentScenarioId, setMeCurrentScenarioId] = useState<number | null>(null)

  // toast
  const [toast, setToast] = useState<{ msg: string; type?: 'error' } | null>(null)
  const showToast = (msg: string, type?: 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  // ── Load all data ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [m, c, pl, tr, clt, r, i] = await Promise.all([
        api.get('/menus'),
        api.get('/countries'),
        api.get('/price-levels'),
        api.get('/tax-rates'),
        api.get('/country-level-tax'),
        api.get('/recipes'),
        api.get('/ingredients'),
      ])
      setMenus(m || [])
      setCountries(c || [])
      setPriceLevels(pl || [])
      setTaxRates(tr || [])
      setCountryLevelTax(clt || [])
      setRecipes(r || [])
      setIngredients(i || [])
      // Auto-select default price level if not already overridden by user
      const defLevel = (pl || []).find((l: PriceLevel) => l.is_default)
      if (defLevel && !levelOverridden) setActiveMenuLevel(defLevel.id)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  // ── Auto-open menu from ?menu=<id> URL param (e.g. linked from Recipes page) ─
  useEffect(() => {
    if (loading) return
    const paramId = searchParams.get('menu')
    if (!paramId) return
    const id = Number(paramId)
    if (!isNaN(id) && id > 0) {
      openMenu(id)
      setSearchParams({}, { replace: true })  // clean the URL after consuming the param
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // ── Open menu / load COGS ──────────────────────────────────────────────────

  const openMenu = useCallback(async (id: number) => {
    setSelectedMenuId(id)
    setScenarioMenuId(id)   // keep scenario in sync
    setItemFilterQ(''); setItemFilterType(''); setItemFilterStatus(''); setItemFilterCat('')
    setLoadingCogs(true)
    try {
      const url = activeMenuLevel ? `/cogs/menu/${id}?price_level_id=${activeMenuLevel}` : `/cogs/menu/${id}`
      const data = await api.get(url)
      setCogsData(data)
    } finally {
      setLoadingCogs(false)
    }
  }, [api, activeMenuLevel])

  // re-fetch when level changes
  useEffect(() => {
    if (selectedMenuId) openMenu(selectedMenuId)
  }, [activeMenuLevel]) // eslint-disable-line

  // ── Filtered / sorted menu list ───────────────────────────────────────────

  const filteredMenus = useMemo(() => {
    return menus.filter(m => {
      const matchQ   = !menuSearch || m.name.toLowerCase().includes(menuSearch.toLowerCase())
      const matchC   = !menuCountryFilter || m.country_id === menuCountryFilter
      return matchQ && matchC
    })
  }, [menus, menuSearch, menuCountryFilter])

  // ── Filtered / sorted items ───────────────────────────────────────────────

  const filteredItems = useMemo(() => {
    if (!cogsData) return []
    return cogsData.items.filter(item => {
      const name = item.display_name.toLowerCase()
      if (itemFilterQ && !name.includes(itemFilterQ.toLowerCase())) return false
      if (itemFilterType && item.item_type !== itemFilterType) return false
      if (itemFilterCat && item.category !== itemFilterCat) return false
      if (itemFilterStatus) {
        const hasPrice = item.sell_price_gross > 0
        if (!hasPrice || cogsClass(item.cogs_pct_net, cogsThresholds) !== itemFilterStatus) return false
      }
      return true
    })
  }, [cogsData, itemFilterQ, itemFilterType, itemFilterCat, itemFilterStatus])

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0
      if (itemSortCol === 'name')       { av = a.display_name.toLowerCase(); bv = b.display_name.toLowerCase() }
      else if (itemSortCol === 'cat')   { av = (a.category || '').toLowerCase(); bv = (b.category || '').toLowerCase() }
      else if (itemSortCol === 'type')  { av = a.item_type; bv = b.item_type }
      else if (itemSortCol === 'qty')   { av = a.qty; bv = b.qty }
      else if (itemSortCol === 'cost')  { av = a.cost_per_portion; bv = b.cost_per_portion }
      else if (itemSortCol === 'gross') { av = a.sell_price_gross; bv = b.sell_price_gross }
      else if (itemSortCol === 'net')   { av = a.sell_price_net; bv = b.sell_price_net }
      else if (itemSortCol === 'gp')    { av = a.gp_net; bv = b.gp_net }
      else if (itemSortCol === 'cogs')  { av = a.cogs_pct_net; bv = b.cogs_pct_net }
      if (av < bv) return -1 * itemSortDir
      if (av > bv) return  1 * itemSortDir
      return 0
    })
  }, [filteredItems, itemSortCol, itemSortDir])

  function toggleSort(col: string) {
    if (itemSortCol === col) setItemSortDir(d => d === 1 ? -1 : 1)
    else { setItemSortCol(col); setItemSortDir(1) }
  }

  // ── Selected menu helpers ──────────────────────────────────────────────────

  const selectedMenu = useMemo(() => menus.find(m => m.id === selectedMenuId) ?? null, [menus, selectedMenuId])
  const selectedCountry = useMemo(() => countries.find(c => c.id === selectedMenu?.country_id) ?? null, [countries, selectedMenu])
  const sym = selectedCountry?.currency_symbol ?? ''

  // ── Category list for filter dropdown ────────────────────────────────────
  const menuItemCategories = useMemo(() => {
    if (!cogsData) return []
    return [...new Set(cogsData.items.map(i => i.category).filter(Boolean))].sort()
  }, [cogsData])

  // ── Tax helpers ───────────────────────────────────────────────────────────

  function getDefaultTaxForCountryLevel(countryId: number, levelId: number | '') {
    if (levelId) {
      const clt = countryLevelTax.find(r => r.country_id === countryId && r.price_level_id === Number(levelId))
      if (clt) return taxRates.find(t => t.id === clt.tax_rate_id) ?? null
    }
    return taxRates.find(t => t.country_id === countryId && t.is_default) ?? null
  }

  // ── Shared pages CRUD ────────────────────────────────────────────────────

  const loadSharedPages = useCallback(async () => {
    setSharedLoading(true)
    try {
      const [pages, scenarios] = await Promise.all([
        api.get('/shared-pages'),
        api.get('/scenarios'),
      ])
      setSharedPages(pages || [])
      setAllScenarios((scenarios || []).map((s: { id: number; name: string; menu_id: number | null; menu_name: string | null }) => ({
        id: s.id, name: s.name, menu_id: s.menu_id, menu_name: s.menu_name,
      })))
    } finally {
      setSharedLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (activeTab === 'shared-links' || activeTab === 'scenario' || sharedModal === 'new') loadSharedPages()
  }, [activeTab, sharedModal, loadSharedPages])

  function openNewSharedModal() {
    setSpName(''); setSpMode('view'); setSpPassword(''); setSpNotes('')
    setSpMenuId(''); setSpCountryId(''); setSpScenarioId(''); setSpExpires('')
    setSharedModal('new')
  }

  function openEditSharedModal(p: SharedPage) {
    setSpName(p.name); setSpMode(p.mode); setSpPassword(''); setSpNotes(p.notes ?? '')
    setSpMenuId(p.menu_id ?? ''); setSpCountryId(p.country_id ?? '')
    setSpScenarioId(p.scenario_id ?? '')
    setSpExpires(p.expires_at ? p.expires_at.slice(0, 10) : '')
    setSharedModal(p)
  }

  async function saveSharedPage() {
    if (!spName || (!spPassword && sharedModal === 'new')) return
    setSpSaving(true)
    try {
      const body: Record<string, unknown> = {
        name:        spName,
        mode:        spMode,
        notes:       spNotes       || null,
        menu_id:     spMenuId      || null,
        country_id:  spCountryId   || null,
        scenario_id: spScenarioId  || null,
        expires_at:  spExpires     || null,
      }
      if (spPassword) body.password = spPassword
      if (sharedModal === 'new') {
        const created = await api.post('/shared-pages', body)
        setSharedPages(prev => [created, ...prev])
        showToast('Shared link created.')
      } else if (typeof sharedModal === 'object' && sharedModal) {
        const updated = await api.put(`/shared-pages/${sharedModal.id}`, body)
        setSharedPages(prev => prev.map(p => p.id === updated.id ? updated : p))
        showToast('Shared link updated.')
      }
      setSharedModal(null)
    } catch { showToast('Failed to save shared link.', 'error') }
    finally { setSpSaving(false) }
  }

  async function deleteSharedPage(id: number) {
    try {
      await api.delete(`/shared-pages/${id}`)
      setSharedPages(prev => prev.filter(p => p.id !== id))
      showToast('Shared link deleted.')
    } catch { showToast('Failed to delete shared link.', 'error') }
    setSharedConfirm(null)
  }

  function copySharedLink(slug: string) {
    const url = `${window.location.origin}/share/${slug}`
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSlug(slug)
      setTimeout(() => setCopiedSlug(null), 2000)
    })
  }

  // ── Menu CRUD ─────────────────────────────────────────────────────────────

  async function saveMenu(name: string, country_id: number, description: string) {
    const isEdit = typeof menuModal === 'object' && menuModal !== null
    try {
      if (isEdit) {
        const updated = await api.put(`/menus/${(menuModal as Menu).id}`, { name, country_id, description })
        setMenus(prev => prev.map(m => m.id === updated.id ? updated : m))
        if (selectedMenuId === updated.id) setCogsData(null)
      } else {
        const created = await api.post('/menus', { name, country_id, description })
        setMenus(prev => [...prev, created])
      }
      setMenuModal(null)
      showToast(isEdit ? 'Menu updated.' : 'Menu created.')
    } catch { showToast('Failed to save menu.', 'error') }
  }

  async function deleteMenu(id: number) {
    try {
      await api.delete(`/menus/${id}`)
      setMenus(prev => prev.filter(m => m.id !== id))
      if (selectedMenuId === id) { setSelectedMenuId(null); setCogsData(null) }
      showToast('Menu deleted.')
    } catch { showToast('Failed to delete menu.', 'error') }
  }

  // ── Menu item modal helpers ───────────────────────────────────────────────

  function resetMiModal() {
    setMiType('recipe'); setMiRecipeId(''); setMiIngId('')
    setMiDisplayName(''); setMiQty('1')
    const init: Record<number, { price: string; taxId: number | '' }> = {}
    priceLevels.forEach(l => { init[l.id] = { price: '', taxId: '' } })
    setMiLevelInputs(init)
  }

  function openNewItemModal() {
    resetMiModal()
    setMenuItemModal('new')
    setLevelPrices([])
  }

  async function openEditItemModal(item: CogsItem) {
    resetMiModal()
    setMiType(item.item_type)
    if (item.item_type === 'recipe')      setMiRecipeId(item.recipe_id ?? '')
    else                                  setMiIngId(item.ingredient_id ?? '')
    setMiDisplayName(item.display_name)
    setMiQty(String(item.qty))
    // load existing level prices
    try {
      const prices: MenuItemPrice[] = await api.get(`/menu-item-prices?menu_item_id=${item.menu_item_id}`)
      setLevelPrices(prices)
      const init: Record<number, { price: string; taxId: number | '' }> = {}
      priceLevels.forEach(l => {
        const lp = prices.find(p => p.price_level_id === l.id)
        init[l.id] = { price: lp ? fmt2(lp.sell_price) : '', taxId: lp?.tax_rate_id ?? '' }
      })
      setMiLevelInputs(init)
    } catch {
      const init: Record<number, { price: string; taxId: number | '' }> = {}
      priceLevels.forEach(l => { init[l.id] = { price: '', taxId: '' } })
      setMiLevelInputs(init)
    }
    setMenuItemModal(item)
  }

  async function saveInlinePrice(menuItemId: number, gross: number, levelId: number | '') {
    if (!levelId) return
    await api.post('/menu-item-prices', {
      menu_item_id:   menuItemId,
      price_level_id: levelId,
      sell_price:     Math.round(gross * 10000) / 10000,
    })
    if (selectedMenuId) await openMenu(selectedMenuId)
  }

  async function saveMenuItem() {
    if (!selectedMenuId) return
    const isEdit = menuItemModal !== 'new' && menuItemModal !== null
    const itemId = isEdit ? (menuItemModal as CogsItem).menu_item_id : null
    if (miType === 'recipe'     && !miRecipeId)  { showToast('Select a recipe.', 'error'); return }
    if (miType === 'ingredient' && !miIngId)     { showToast('Select an ingredient.', 'error'); return }
    const body = {
      menu_id:       selectedMenuId,
      item_type:     miType,
      recipe_id:     miType === 'recipe'     ? miRecipeId     : null,
      ingredient_id: miType === 'ingredient' ? miIngId        : null,
      display_name:  miDisplayName.trim(),
      qty:           parseFloat(miQty) || 1,
      sell_price:    0,
      tax_rate_id:   null,
    }
    try {
      let saved: MenuItem
      if (isEdit && itemId) saved = await api.put(`/menu-items/${itemId}`, body)
      else                  saved = await api.post('/menu-items', body)
      // save level prices
      await Promise.all(priceLevels.map(async l => {
        const inp = miLevelInputs[l.id]
        if (!inp) return
        if (inp.price !== '' && parseFloat(inp.price) >= 0) {
          await api.post('/menu-item-prices', {
            menu_item_id:   saved.id,
            price_level_id: l.id,
            sell_price:     parseFloat(inp.price),
            tax_rate_id:    inp.taxId || null,
          })
        } else if (inp.price === '') {
          const existing = levelPrices.find(p => p.price_level_id === l.id)
          if (existing) await api.delete(`/menu-item-prices/${existing.id}`)
        }
      }))
      setMenuItemModal(null)
      await openMenu(selectedMenuId)
      setScenarioRefreshKey(k => k + 1)
      showToast(isEdit ? 'Item updated.' : 'Item added to menu.')
    } catch { showToast('Failed to save item.', 'error') }
  }

  async function deleteMenuItem(id: number) {
    try {
      await api.delete(`/menu-items/${id}`)
      if (selectedMenuId) await openMenu(selectedMenuId)
      showToast('Item removed from menu.')
    } catch { showToast('Failed to remove item.', 'error') }
  }

  async function applyDefaultTax() {
    if (!selectedMenu || !activeMenuLevel) { showToast('Select a price level first.', 'error'); return }
    const defTax = getDefaultTaxForCountryLevel(selectedMenu.country_id, activeMenuLevel)
    if (!defTax) { showToast('No default tax rate for this country.', 'error'); return }
    const levelName = priceLevels.find(l => l.id === Number(activeMenuLevel))?.name ?? 'selected level'
    if (!confirm(`Apply "${defTax.name} (${(defTax.rate * 100).toFixed(2)}%)" to all priced items in level "${levelName}"?`)) return
    try {
      const prices: MenuItemPrice[] = await api.get(`/menu-item-prices?menu_id=${selectedMenuId}`)
      const forLevel = prices.filter(p => p.price_level_id === Number(activeMenuLevel))
      await Promise.all(forLevel.map(lp => api.post('/menu-item-prices', {
        menu_item_id:   lp.menu_item_id,
        price_level_id: lp.price_level_id,
        sell_price:     lp.sell_price,
        tax_rate_id:    defTax.id,
      })))
      await openMenu(selectedMenuId!)
      showToast(`Default tax applied to all "${levelName}" prices.`)
    } catch { showToast('Failed to apply tax.', 'error') }
  }

  // ── Price Report ──────────────────────────────────────────────────────────

  const loadPriceReport = useCallback(async () => {
    setPriceReportLoading(true)
    try {
      const url = priceSelectedLevel ? `/cogs/report/menu-prices?price_level_id=${priceSelectedLevel}` : '/cogs/report/menu-prices'
      const data: PriceReportData = await api.get(url)
      setPriceReportData(data)
      setPriceReportLoaded(true)
      // Default single-currency to base currency if not set
      if (!priceSingleCurrency && data.base_currency?.code) setPriceSingleCurrency(data.base_currency.code)
    } catch { showToast('Failed to load price report.', 'error') }
    finally { setPriceReportLoading(false) }
  }, [api, priceSelectedLevel]) // eslint-disable-line

  useEffect(() => {
    if (activeTab === 'price-report' && !priceReportLoaded) loadPriceReport()
  }, [activeTab, priceReportLoaded, loadPriceReport])

  useEffect(() => {
    if (activeTab === 'price-report') { setPriceReportLoaded(false) }
  }, [priceSelectedLevel]) // eslint-disable-line

  // ── Level Report ──────────────────────────────────────────────────────────

  const loadLevelReport = useCallback(async (countryId: number) => {
    setLevelReportLoading(true)
    try {
      const data: LevelReportData = await api.get(`/cogs/report/price-levels?country_id=${countryId}`)
      setLevelReportData(data)
    } catch { showToast('Failed to load level report.', 'error') }
    finally { setLevelReportLoading(false) }
  }, [api])

  useEffect(() => {
    if (activeTab === 'level-report' && lrCountryId) loadLevelReport(Number(lrCountryId))
  }, [activeTab, lrCountryId]) // eslint-disable-line

  useEffect(() => {
    // Load comments from ALL active shared pages linked to this menu + scenario.
    // Multiple shared views (different users/partners) are merged into one stream sorted by time.
    if (activeTab !== 'scenario' || !scenarioMenuId) { setMeChanges([]); setMeSharedPageId(null); return }
    const active = sharedPages.filter(p => p.menu_id === scenarioMenuId && p.is_active && (
      !meCurrentScenarioId || !p.scenario_id || p.scenario_id === meCurrentScenarioId
    ))
    if (!active.length) { setMeChanges([]); setMeSharedPageId(null); return }
    // Use first page as the "write" target for new comments posted from ME
    setMeSharedPageId(active[0].id)
    setMeChangesLoading(true)
    Promise.all(active.map(p =>
      api.get(`/shared-pages/${p.id}/changes`)
        .then((rows: MeChange[]) => rows.map(r => ({ ...r, shared_page_id: p.id })))
        .catch(() => [] as MeChange[])
    ))
      .then((results: MeChange[][]) => {
        const merged = results.flat().sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )
        setMeChanges(merged)
      })
      .finally(() => setMeChangesLoading(false))
  }, [activeTab, scenarioMenuId, meCurrentScenarioId, sharedPages, api])

  async function clearMeComments() {
    if (!scenarioMenuId) return
    const active = sharedPages.filter(p => p.menu_id === scenarioMenuId && p.is_active && (
      !meCurrentScenarioId || !p.scenario_id || p.scenario_id === meCurrentScenarioId
    ))
    if (!active.length) return
    try {
      await Promise.all(active.map(p => api.delete(`/shared-pages/${p.id}/changes/comments`)))
      setMeChanges(prev => prev.filter(c => c.change_type !== 'comment'))
      showToast('Comments cleared.')
    } catch { showToast('Failed to clear comments.', 'error') }
  }

  async function addMeComment(text: string, parentId?: number, sharedPageId?: number) {
    const targetPageId = sharedPageId ?? meSharedPageId
    if (!targetPageId || !text.trim()) return
    try {
      const row: MeChange = await api.post(`/shared-pages/${targetPageId}/changes`, {
        comment:   text.trim(),
        user_name: 'Admin',
        parent_id: parentId ?? null,
      })
      setMeChanges(prev => [{ ...row, shared_page_id: targetPageId }, ...prev])
    } catch { showToast('Failed to post comment.', 'error') }
  }

  useEffect(() => {
    if (activeTab !== 'scenario' || !scenarioMenuId) { setScenarioData(null); return }
    // 'ALL' mode: ScenarioTool fetches per-level data internally; parent doesn't load
    if (scenarioLevelId === 'ALL') { setScenarioData(null); return }
    setScenarioLoading(true)
    const url = scenarioLevelId
      ? `/cogs/menu/${scenarioMenuId}?price_level_id=${scenarioLevelId}`
      : `/cogs/menu/${scenarioMenuId}`
    api.get(url)
      .then((d: CogsData) => setScenarioData(d))
      .catch(() => {})
      .finally(() => setScenarioLoading(false))
  }, [activeTab, scenarioMenuId, scenarioLevelId, api, scenarioRefreshKey]) // eslint-disable-line

  // saveLrPrice: saves gross price, converting from display currency back to local if needed
  async function saveLrPrice(menuItemId: number, levelId: number, grossInDisplay: number) {
    const key = `${menuItemId}_${levelId}`
    if (isNaN(grossInDisplay) || grossInDisplay < 0) return
    // Convert from display currency (base) back to country local currency
    // display = local * exchangeRate => local = display / exchangeRate
    // MPT always shows prices in local currency, so dispRate=1; grossInDisplay IS the local price
    const localPrice = grossInDisplay
    const rounded = Math.round(localPrice * 10000) / 10000
    setLrSaving(prev => ({ ...prev, [key]: true }))
    try {
      await api.post('/menu-item-prices', { menu_item_id: menuItemId, price_level_id: levelId, sell_price: rounded })
      setLrSaved(prev => ({ ...prev, [key]: true }))
      setTimeout(() => setLrSaved(prev => ({ ...prev, [key]: false })), 700)
      clearTimeout(lrSaveTimers[key])
      const t = setTimeout(() => { if (lrCountryId) loadLevelReport(Number(lrCountryId)) }, 1200)
      setLrSaveTimers(prev => ({ ...prev, [key]: t }))
    } catch { showToast('Failed to save price.', 'error') }
    finally { setLrSaving(prev => ({ ...prev, [key]: false })) }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Spinner />
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Menu Builder"
        subtitle="Build menus, set sell prices and see live COGS% per dish."
        tutorialPrompt="Give me an overview of the Menu Builder section. What are the four tabs — Menus, Menu Engineer, Compare Markets, and Market Price Tool — and what is each one for?"
        action={
          activeTab === 'builder'
            ? <button className="btn btn-primary" onClick={() => setMenuModal('new')}>+ New Menu</button>
            : undefined
        }
      />

      {/* ── Tabs ── */}
      <div className="flex gap-1 px-6 border-b border-gray-200 mb-0">
        {([
          { key: 'builder',      label: '🍽 Menus',              tutorial: 'How do I use the Menu Builder tab? Explain creating a menu for a country, adding recipe and ingredient items, setting sort order, and assigning sell prices across different price levels.' },
          { key: 'scenario',     label: '📊 Menu Engineer',      tutorial: 'How does the Menu Engineer work? Explain the sales mix concept, how to enter quantities sold, what COGS% means in this context, how to use the Mix Manager, and how to save and push scenarios.' },
          { key: 'price-report', label: '📈 Compare Markets',    tutorial: 'What is the Compare Markets (Price Level Table) view? How do I use it to compare and edit sell prices across different markets and price levels, and how does currency conversion work here?' },
          { key: 'level-report', label: '🏷 Market Price Tool',  tutorial: 'What is the Market Price Tool (Menu Performance Table)? How do I read the COGS% grid across price levels and markets, and what should I be looking at to spot pricing problems?' },
          { key: 'shared-links', label: '🔗 Shared Links',       tutorial: 'What are Shared Links? How do I create a password-protected public link to share a menu with someone outside the app, in view-only or edit mode?' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            data-ai-context={JSON.stringify({ type: 'tutorial', prompt: t.tutorial })}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <span className="flex items-center gap-1.5">
              {t.label}
              <PepperHelpButton prompt={t.tutorial} size={12} />
            </span>
          </button>
        ))}
      </div>

      {/* ══ TAB: BUILDER ══════════════════════════════════════════════════════ */}
      {activeTab === 'builder' && (
        <div className="flex flex-1 min-h-0">

          {/* Left panel — menu list */}
          <aside className="w-64 flex-shrink-0 border-r border-gray-200 flex flex-col bg-white">
            <div className="p-3 border-b border-gray-100 space-y-2">
              <input
                className="input input-sm w-full"
                placeholder="Search menus…"
                value={menuSearch}
                onChange={e => setMenuSearch(e.target.value)}
              />
              <select
                className="select select-sm w-full"
                value={menuCountryFilter}
                onChange={e => setMenuCountryFilter(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">All Countries</option>
                {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredMenus.length === 0 && (
                <p className="p-4 text-sm text-gray-400">No menus found.</p>
              )}
              {filteredMenus.map(m => (
                <button
                  key={m.id}
                  onClick={() => openMenu(m.id)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    selectedMenuId === m.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900 truncate">{m.name}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{m.country_name}</div>
                </button>
              ))}
            </div>
          </aside>

          {/* Right panel — menu detail */}
          <section className="flex-1 overflow-y-auto bg-gray-50">
            {!selectedMenuId && (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                <div className="text-5xl mb-3">🍽</div>
                <p className="text-sm">Select a menu or create a new one.</p>
              </div>
            )}

            {selectedMenuId && loadingCogs && (
              <div className="flex items-center justify-center h-64"><Spinner /></div>
            )}

            {selectedMenuId && !loadingCogs && cogsData && selectedMenu && (
              <MenuDetail
                menu={selectedMenu}
                country={selectedCountry}
                cogsData={cogsData}
                sortedItems={sortedItems}
                filteredItems={filteredItems}
                priceLevels={priceLevels}
                activeMenuLevel={activeMenuLevel}
                sym={sym}
                itemFilterQ={itemFilterQ}
                itemFilterType={itemFilterType}
                itemFilterStatus={itemFilterStatus}
                itemFilterCat={itemFilterCat}
                itemSortCol={itemSortCol}
                itemSortDir={itemSortDir}
                categories={menuItemCategories}
                onLevelChange={v => { setActiveMenuLevel(v); setLevelOverridden(true) }}
                onFilterQ={setItemFilterQ}
                onFilterType={setItemFilterType}
                onFilterStatus={setItemFilterStatus}
                onFilterCat={setItemFilterCat}
                onSort={toggleSort}
                onSavePrice={saveInlinePrice}
                onEdit={m => setMenuModal(m)}
                onDelete={id => setConfirmDelete({ type: 'menu', id })}
                onAddItem={openNewItemModal}
                onEditItem={openEditItemModal}
                onDeleteItem={id => setConfirmDelete({ type: 'item', id })}
                onApplyTax={applyDefaultTax}
                cogsThresholds={cogsThresholds}
              />
            )}
          </section>
        </div>
      )}

      {/* ══ TAB: PRICE REPORT ════════════════════════════════════════════════ */}
      {activeTab === 'price-report' && (
        <PriceLevelTool
          data={priceReportData}
          loading={priceReportLoading}
          countries={countries}
          priceLevels={priceLevels}
          selectedLevel={priceSelectedLevel}
          currencyMode={priceCurrencyMode}
          singleCurrency={priceSingleCurrency}
          search={priceSearch}
          cat={priceCat}
          onLevelChange={v => { setPriceSelectedLevel(v); setPriceReportLoaded(false) }}
          onCurrencyMode={setPriceCurrencyMode}
          onSingleCurrency={setPriceSingleCurrency}
          onSearch={setPriceSearch}
          onCat={setPriceCat}
          onSavePrice={async (menuItemId, levelId, grossDisplay, dispRate) => {
            const localPrice = dispRate !== 0 ? grossDisplay / dispRate : grossDisplay
            await api.post('/menu-item-prices', { menu_item_id: menuItemId, price_level_id: levelId, sell_price: Math.round(localPrice * 10000) / 10000 })
            setPriceReportLoaded(false)
          }}
          showToast={showToast}
        />
      )}

      {/* ══ TAB: LEVEL REPORT ════════════════════════════════════════════════ */}
      {activeTab === 'level-report' && (
        <MarketPriceTool
          countries={countries}
          data={levelReportData}
          loading={levelReportLoading}
          countryId={lrCountryId}
          search={lrSearch}
          saving={lrSaving}
          saved={lrSaved}
          onCountryChange={v => setLrCountryId(v)}
          onSearch={setLrSearch}
          onSavePrice={saveLrPrice}
          showToast={showToast}
        />
      )}

      {/* ══ TAB: SCENARIO ═══════════════════════════════════════════════════ */}
      {activeTab === 'scenario' && (
        <>
          <div className="flex gap-4">
            <div className="flex-1 min-w-0">
              <ScenarioTool
                menus={menus}
                countries={countries}
                priceLevels={priceLevels}
                data={scenarioData}
                loading={scenarioLoading}
                menuId={scenarioMenuId}
                levelId={scenarioLevelId}
                qty={scenarioQty}
                refreshKey={scenarioRefreshKey}
                onMenuChange={id => {
                  setScenarioMenuId(id); setSelectedMenuId(id)
                  try { if (id) localStorage.setItem('me_last_menu_id', String(id)); else localStorage.removeItem('me_last_menu_id') } catch {}
                }}
                onLevelChange={setScenarioLevelId}
                onQtyChange={(key, q) => setScenarioQty(prev => ({ ...prev, [key]: q }))}
                onResetQty={() => setScenarioQty({})}
                onReplaceQty={(qMap) => setScenarioQty(qMap)}
                onAddItem={() => {
                  if (scenarioMenuId) {
                    setSelectedMenuId(scenarioMenuId)
                    resetMiModal()
                    setMenuItemModal('new')
                    setLevelPrices([])
                  }
                }}
                onEditItem={menuItemId => {
                  if (scenarioMenuId) {
                    const item = scenarioData?.items.find(i => i.menu_item_id === menuItemId)
                    if (item) {
                      setSelectedMenuId(scenarioMenuId)
                      openEditItemModal(item)
                    }
                  }
                }}
                onDeleteItem={(menuItemId) => {
                  setConfirmDelete({ type: 'item', id: menuItemId })
                }}
                onShare={(mId, sId) => {
                  setSpName(''); setSpMode('view'); setSpPassword(''); setSpNotes('')
                  setSpMenuId(mId); setSpCountryId(''); setSpScenarioId(sId ?? ''); setSpExpires('')
                  setSharedModal('new')
                }}
                onScenarioChange={setMeCurrentScenarioId}
                comments={meSharedPageId ? meChanges : undefined}
                commentsLoading={meChangesLoading}
                onAddComment={meSharedPageId ? addMeComment : undefined}
                onClearComments={clearMeComments}
              />
            </div>
          </div>
        </>
      )}

      {/* ══ TAB: SHARED LINKS ════════════════════════════════════════════ */}
      {activeTab === 'shared-links' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-text-1">Shared Links</h2>
              <p className="text-sm text-text-3 mt-0.5">
                Generate password-protected public URLs to share menus externally.
              </p>
            </div>
            <button className="btn btn-primary" onClick={openNewSharedModal}>+ New Link</button>
          </div>

          {sharedLoading && <div className="text-sm text-text-3 py-8 text-center">Loading…</div>}

          {!sharedLoading && sharedPages.length === 0 && (
            <div className="card p-10 text-center">
              <div className="text-4xl mb-3">🔗</div>
              <p className="text-text-2 font-medium mb-1">No shared links yet</p>
              <p className="text-sm text-text-3 mb-4">Create a link to share a menu with people outside the app.</p>
              <button className="btn btn-primary" onClick={openNewSharedModal}>+ New Link</button>
            </div>
          )}

          {!sharedLoading && sharedPages.length > 0 && (
            <div className="space-y-3">
              {sharedPages.map(p => {
                const url = `${window.location.origin}/share/${p.slug}`
                const expired = p.expires_at ? new Date(p.expires_at) < new Date() : false
                return (
                  <div key={p.id} className={`card p-4 flex items-start justify-between gap-4 ${!p.is_active || expired ? 'opacity-60' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-text-1">{p.name}</span>
                        <span className={`badge ${p.mode === 'edit' ? 'badge-yellow' : 'badge-neutral'} text-xs`}>
                          {p.mode === 'edit' ? '✏️ Edit' : '👁 View'}
                        </span>
                        {!p.is_active && <span className="badge badge-neutral text-xs">Disabled</span>}
                        {expired     && <span className="badge badge-neutral text-xs">Expired</span>}
                      </div>
                      <div className="text-xs text-text-3 mt-1 space-y-0.5">
                        {p.menu_name     && <div>Menu: <span className="text-text-2">{p.menu_name}</span></div>}
                        {p.country_name  && <div>Market: <span className="text-text-2">{p.country_name}</span></div>}
                        {p.scenario_name && <div>Scenario: <span className="text-amber-600 font-medium">{p.scenario_name}</span></div>}
                        {p.expires_at    && <div>Expires: <span className="text-text-2">{new Date(p.expires_at).toLocaleDateString()}</span></div>}
                        <div className="font-mono text-[11px] truncate max-w-xs text-text-3 mt-1">{url}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        className="btn btn-outline btn-sm text-xs"
                        onClick={() => copySharedLink(p.slug)}
                        title="Copy link"
                      >
                        {copiedSlug === p.slug ? '✓ Copied' : '📋 Copy'}
                      </button>
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-outline btn-sm text-xs"
                        title="Open link"
                      >↗ Open</a>
                      <button
                        className="btn btn-outline btn-sm text-xs"
                        onClick={() => openEditSharedModal(p)}
                        title="Edit"
                      >Edit</button>
                      <button
                        className="btn btn-danger btn-sm text-xs"
                        onClick={() => setSharedConfirm(p.id)}
                        title="Delete"
                      >Delete</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

        </div>
      )}

      {/* ══ MODALS ══════════════════════════════════════════════════════════ */}

      {/* Shared link — confirm delete */}
      {sharedConfirm !== null && (
        <ConfirmDialog
          message="Delete this shared link? Anyone with the URL will lose access."
          onConfirm={() => deleteSharedPage(sharedConfirm)}
          onCancel={() => setSharedConfirm(null)}
        />
      )}

      {/* Shared link — create / edit (global so it can be opened from any tab) */}
      {sharedModal !== null && (
        <Modal
          title={sharedModal === 'new' ? 'New Shared Link' : 'Edit Shared Link'}
          onClose={() => setSharedModal(null)}
        >
          <div className="space-y-4">
            <Field label="Link Name" required>
              <input className="input w-full" placeholder="e.g. Summer Menu — Partner Preview"
                value={spName} onChange={e => setSpName(e.target.value)} />
            </Field>
            <Field label="Mode" required>
              <select className="input w-full" value={spMode} onChange={e => setSpMode(e.target.value as 'view' | 'edit')}>
                <option value="view">👁 View Only</option>
                <option value="edit">✏️ Edit (can change prices)</option>
              </select>
            </Field>
            <Field label={sharedModal === 'new' ? 'Password' : 'New Password (leave blank to keep current)'} required={sharedModal === 'new'}>
              <input className="input w-full" type="password" placeholder={sharedModal === 'new' ? 'Required' : 'Leave blank to keep existing'}
                value={spPassword} onChange={e => setSpPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Lock to Menu (optional)">
              <select className="input w-full" value={spMenuId} onChange={e => setSpMenuId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— Any menu (viewer can switch) —</option>
                {menus.map(m => <option key={m.id} value={m.id}>{m.name} ({m.country_name})</option>)}
              </select>
            </Field>
            <Field label="Lock to Market (optional)">
              <select className="input w-full" value={spCountryId} onChange={e => setSpCountryId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— Any market —</option>
                {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Load Scenario (optional)">
              <select className="input w-full" value={spScenarioId} onChange={e => setSpScenarioId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— No scenario (live prices) —</option>
                {allScenarios.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.menu_name ? ` (${s.menu_name})` : ''}
                  </option>
                ))}
              </select>
              {spScenarioId && <p className="text-xs text-amber-600 mt-1">Scenario price overrides will be shown instead of live prices.</p>}
            </Field>
            <Field label="Welcome Notes (optional)" hint="Shown to users once after entering the password">
              <textarea
                className="input w-full h-24 resize-none"
                placeholder="e.g. Please review the pricing for Q3 and update delivery prices where needed."
                value={spNotes}
                onChange={e => setSpNotes(e.target.value)}
              />
            </Field>
            <Field label="Expiry Date (optional)">
              <input className="input w-full" type="date" value={spExpires} onChange={e => setSpExpires(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline" onClick={() => setSharedModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveSharedPage}
                disabled={spSaving || !spName || (sharedModal === 'new' && !spPassword)}>
                {spSaving ? 'Saving…' : sharedModal === 'new' ? 'Create Link' : 'Save Changes'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Menu modal */}
      {menuModal !== null && (
        <MenuFormModal
          menu={menuModal === 'new' ? null : menuModal}
          countries={countries}
          onSave={saveMenu}
          onClose={() => setMenuModal(null)}
        />
      )}

      {/* Menu item modal */}
      {menuItemModal !== null && selectedMenu && selectedCountry && (
        <MenuItemFormModal
          isEdit={menuItemModal !== 'new'}
          country={selectedCountry}
          priceLevels={priceLevels}
          taxRates={taxRates}
          countryLevelTax={countryLevelTax}
          recipes={recipes}
          ingredients={ingredients}
          miType={miType}
          miRecipeId={miRecipeId}
          miIngId={miIngId}
          miDisplayName={miDisplayName}
          miQty={miQty}
          miLevelInputs={miLevelInputs}
          onTypeChange={t => {
            setMiType(t)
            setMiDisplayName('')
          }}
          onRecipeChange={id => {
            setMiRecipeId(id)
            if (!miDisplayName) {
              const r = recipes.find(r => r.id === id)
              if (r) setMiDisplayName(r.name)
            }
          }}
          onIngChange={id => {
            setMiIngId(id)
            if (!miDisplayName) {
              const i = ingredients.find(i => i.id === id)
              if (i) setMiDisplayName(i.name)
            }
          }}
          onDisplayName={setMiDisplayName}
          onQty={setMiQty}
          onLevelInput={(levelId, field, value) =>
            setMiLevelInputs(prev => ({ ...prev, [levelId]: { ...prev[levelId], [field]: value } }))
          }
          onSave={saveMenuItem}
          onClose={() => setMenuItemModal(null)}
        />
      )}

      {/* Confirm delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={confirmDelete.type === 'menu'
            ? 'Delete this menu and all its items? This cannot be undone.'
            : 'Remove this item from the menu?'}
          onConfirm={() => {
            if (confirmDelete.type === 'menu') deleteMenu(confirmDelete.id)
            else deleteMenuItem(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Menu Detail panel ─────────────────────────────────────────────────────────

interface MenuDetailProps {
  menu: Menu; country: Country | null; cogsData: CogsData
  sortedItems: CogsItem[]; filteredItems: CogsItem[]
  priceLevels: PriceLevel[]; activeMenuLevel: number | ''; sym: string
  itemFilterQ: string; itemFilterType: string; itemFilterStatus: string; itemFilterCat: string
  itemSortCol: string; itemSortDir: 1 | -1
  cogsThresholds: CogsThresholds
  categories: string[]
  onLevelChange(v: number | ''): void
  onFilterQ(v: string): void; onFilterType(v: string): void; onFilterStatus(v: string): void; onFilterCat(v: string): void
  onSort(col: string): void
  onSavePrice(menuItemId: number, gross: number, levelId: number | ''): Promise<void>
  onEdit(m: Menu): void; onDelete(id: number): void
  onAddItem(): void; onEditItem(item: CogsItem): void; onDeleteItem(id: number): void
  onApplyTax(): void
}

function MenuDetail({ menu, country, cogsData, sortedItems, filteredItems, priceLevels, activeMenuLevel, sym,
  itemFilterQ, itemFilterType, itemFilterStatus, itemFilterCat, itemSortCol, itemSortDir, categories,
  cogsThresholds,
  onLevelChange, onFilterQ, onFilterType, onFilterStatus, onFilterCat, onSort, onSavePrice,
  onEdit, onDelete, onAddItem, onEditItem, onDeleteItem, onApplyTax }: MenuDetailProps) {

  const hasLevel = !!activeMenuLevel
  const items = cogsData.items
  const cogsVals  = items.filter(i => i.sell_price_gross > 0).map(i => i.cogs_pct_net)
  const priceVals = items.filter(i => i.sell_price_gross > 0).map(i => i.sell_price_net)
  const avgCogs   = cogsVals.length  ? cogsVals.reduce((a, b) => a + b, 0) / cogsVals.length  : 0
  const maxCogs   = cogsVals.length  ? Math.max(...cogsVals)  : 0
  const avgPrice  = priceVals.length ? priceVals.reduce((a, b) => a + b, 0) / priceVals.length : 0
  const maxPrice  = priceVals.length ? Math.max(...priceVals) : 0

  // ── local UI state ──────────────────────────────────────────────────────
  const [groupByCategory, setGroupByCategory] = useState(false)
  const [inlineEdit, setInlineEdit] = useState<{ menuItemId: number; value: string } | null>(null)
  const [savingPrice, setSavingPrice] = useState(false)

  async function commitInlinePrice(menuItemId: number) {
    if (!inlineEdit || inlineEdit.menuItemId !== menuItemId) return
    const gross = parseFloat(inlineEdit.value)
    if (!isNaN(gross) && gross >= 0) {
      setSavingPrice(true)
      try { await onSavePrice(menuItemId, gross, activeMenuLevel) }
      finally { setSavingPrice(false) }
    }
    setInlineEdit(null)
  }

  function sortArrow(col: string) {
    if (itemSortCol !== col) return <span className="opacity-25 ml-1 text-[10px]">↕</span>
    return <span className="text-accent ml-1 text-[10px]">{itemSortDir === 1 ? '↑' : '↓'}</span>
  }

  const dash = <span className="text-text-3">—</span>
  const colCount = groupByCategory ? 10 : 11

  function renderRow(item: CogsItem, inGroup: boolean) {
    const hasPrice = item.sell_price_gross > 0
    const cls = cogsClass(item.cogs_pct_net, cogsThresholds)
    const qty = item.qty % 1 === 0 ? String(item.qty) : item.qty.toFixed(2)
    const qtyLabel = `${qty} ${item.item_type === 'ingredient' ? item.base_unit_abbr : 'ptn'}`
    const isEditing = inlineEdit?.menuItemId === item.menu_item_id
    return (
      <tr key={item.menu_item_id} className={`border-b border-border last:border-0 hover:bg-surface-2/50 ${inGroup ? 'bg-surface' : ''}`}>
        <td className="px-3 py-2.5 font-medium text-text-1">{item.display_name}</td>
        {!groupByCategory && (
          <td className="px-3 py-2.5 text-xs text-text-3">{item.category || dash}</td>
        )}
        <td className="px-3 py-2.5">
          <span className="text-xs bg-surface-2 text-text-3 border border-border px-1.5 py-0.5 rounded">
            {item.item_type === 'ingredient' ? 'Ingredient' : 'Recipe'}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap text-text-2">{qtyLabel}</td>
        <td className="px-3 py-2.5 text-right font-mono text-xs text-text-2">{sym}{fmt2(item.cost_per_portion)}</td>
        {/* Gross Price — inline editable */}
        <td className="px-3 py-2.5 text-right font-mono text-xs">
          {isEditing ? (
            <div className="flex items-center justify-end gap-1">
              <span className="text-text-3 text-xs">{sym}</span>
              <input
                type="number" min="0" step="0.01"
                className="input text-xs font-mono w-20 py-0.5 px-1 text-right"
                value={inlineEdit!.value}
                disabled={savingPrice}
                autoFocus
                onChange={e => setInlineEdit(ie => ie ? { ...ie, value: e.target.value } : ie)}
                onKeyDown={async e => {
                  if (e.key === 'Enter') await commitInlinePrice(item.menu_item_id)
                  else if (e.key === 'Escape') setInlineEdit(null)
                }}
                onBlur={() => commitInlinePrice(item.menu_item_id)}
              />
            </div>
          ) : (
            <span
              className={`${hasLevel ? 'cursor-pointer hover:text-accent transition-colors' : ''} ${hasPrice ? 'text-text-1' : 'text-text-3'}`}
              title={hasLevel ? `Click to edit gross price (${sym})` : 'Select a price level to edit prices'}
              onClick={() => {
                if (!hasLevel) return
                setInlineEdit({ menuItemId: item.menu_item_id, value: hasPrice ? fmt2(item.sell_price_gross) : '' })
              }}
            >
              {hasPrice ? `${sym}${fmt2(item.sell_price_gross)}` : <span className="text-text-3 text-xs italic">{hasLevel ? 'set price' : '—'}</span>}
            </span>
          )}
        </td>
        <td className="px-3 py-2.5 text-center text-xs">
          {hasPrice
            ? <span className="bg-surface-2 text-text-2 border border-border px-1.5 py-0.5 rounded">{item.tax_rate_pct}%</span>
            : dash}
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-text-1">{hasPrice ? `${sym}${fmt2(item.sell_price_net)}` : dash}</td>
        <td className={`px-3 py-2.5 text-right font-mono text-xs ${hasPrice ? (item.gp_net >= 0 ? 'text-emerald-600' : 'text-red-500') : ''}`}>
          {hasPrice ? `${sym}${fmt2(item.gp_net)}` : dash}
        </td>
        <td
          className={`px-3 py-2.5 text-right text-xs font-semibold ${hasPrice ? cogsColourClass(item.cogs_pct_net, cogsThresholds) : ''}`}
          data-ai-context={hasPrice ? JSON.stringify({ type: 'cogs_pct', value: `${item.cogs_pct_net.toFixed(1)}%`, item: item.display_name, menu: menu.name }) : undefined}
        >{hasPrice ? `${item.cogs_pct_net.toFixed(1)}%` : dash}</td>
        <td className="px-3 py-2.5">
          {hasPrice ? (
            <span className={`text-xs font-semibold ${cls === 'green' ? 'text-emerald-600' : cls === 'yellow' ? 'text-amber-500' : 'text-red-500'}`}>
              {cls === 'green' ? '✓ Excellent' : cls === 'yellow' ? '~ Acceptable' : '! Review'}
            </span>
          ) : dash}
        </td>
        <td className="px-3 py-1.5">
          <div className="flex gap-1 items-center">
            <button
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors"
              onClick={() => onEditItem(item)}
              title="Edit item"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button
              className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 transition-colors"
              onClick={() => onDeleteItem(item.menu_item_id)}
              title="Remove from menu"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold text-gray-900 truncate">{menu.name}</h2>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded mt-1 inline-block">
            {country?.name ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button className="btn btn-sm btn-outline" onClick={() => onEdit(menu)}>✏️ Edit</button>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-gray-400 whitespace-nowrap">🏷 Level</label>
            <select
              className="select select-sm max-w-[160px]"
              value={activeMenuLevel}
              onChange={e => onLevelChange(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Cost only —</option>
              {priceLevels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-outline" onClick={onApplyTax} title="Apply country default tax to all items">
            % Tax
          </button>
          <button className="btn btn-sm btn-primary" onClick={onAddItem}>+ Add Item</button>
          <button className="btn btn-sm btn-ghost text-red-500" onClick={() => onDelete(menu.id)}>🗑</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        {[
          { label: 'Items', value: String(items.length), cls: '' },
          { label: 'Avg COGS %', value: hasLevel && avgCogs ? `${avgCogs.toFixed(1)}%` : hasLevel ? '—' : 'Select level', cls: hasLevel && avgCogs ? cogsClass(avgCogs, cogsThresholds) : '' },
          { label: 'Max COGS %', value: hasLevel && maxCogs ? `${maxCogs.toFixed(1)}%` : '—', cls: hasLevel && maxCogs ? cogsClass(maxCogs, cogsThresholds) : '' },
          { label: 'Avg Net Price', value: hasLevel && avgPrice ? `${sym}${avgPrice.toFixed(2)}` : '—', cls: '' },
          { label: 'Max Net Price', value: hasLevel && maxPrice ? `${sym}${maxPrice.toFixed(2)}` : '—', cls: '' },
        ].map(k => (
          <div key={k.label} className={`bg-white rounded-lg p-3 border text-center ${
            k.cls === 'green' ? 'border-green-200' : k.cls === 'yellow' ? 'border-yellow-200' : k.cls === 'red' ? 'border-red-200' : 'border-gray-200'
          }`}>
            <div className="text-xs text-gray-400 mb-1">{k.label}</div>
            <div className={`text-lg font-semibold ${
              k.cls === 'green' ? 'text-green-600' : k.cls === 'yellow' ? 'text-yellow-600' : k.cls === 'red' ? 'text-red-600' : 'text-gray-900'
            }`}>{k.value}</div>
          </div>
        ))}
      </div>

      {/* No level hint */}
      {!hasLevel && (
        <div className="bg-blue-50 text-blue-600 text-xs px-3 py-2 rounded mb-3">
          🏷 Select a price level above to see prices and COGS% for that channel.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-2 mb-3 items-center min-w-0">
        <input
          className="input text-sm flex-1 min-w-0"
          placeholder="Search items…"
          value={itemFilterQ}
          onChange={e => onFilterQ(e.target.value)}
        />
        <select className="input text-sm shrink-0" value={itemFilterType} onChange={e => onFilterType(e.target.value)}>
          <option value="">All Types</option>
          <option value="recipe">Recipe</option>
          <option value="ingredient">Ingredient</option>
        </select>
        {categories.length > 0 && (
          <select className="input text-sm shrink-0" value={itemFilterCat} onChange={e => onFilterCat(e.target.value)}>
            <option value="">All Categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <select className="input text-sm shrink-0" value={itemFilterStatus} onChange={e => onFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="green">✓ Excellent</option>
          <option value="yellow">~ Acceptable</option>
          <option value="red">! Review</option>
        </select>
        {/* Group / Column toggle */}
        <button
          className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors whitespace-nowrap ${groupByCategory ? 'border-accent bg-accent-dim text-accent font-semibold' : 'border-border text-text-3 hover:border-accent hover:text-accent'}`}
          onClick={() => setGroupByCategory(g => !g)}
          title={groupByCategory ? 'Switch to category column view' : 'Group rows by category'}
        >
          {groupByCategory ? '⊞ Grouped' : '☰ Group'}
        </button>
        <span className="text-xs text-text-3 whitespace-nowrap">
          {filteredItems.length < items.length
            ? `${filteredItems.length} of ${items.length} items`
            : `${items.length} item${items.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Items table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-200 border-b border-gray-300">
              <tr>
                {[
                  { key: 'name',  label: 'Item' },
                  ...(!groupByCategory ? [{ key: 'cat', label: 'Category' }] : []),
                  { key: 'type',  label: 'Type' },
                  { key: 'qty',   label: 'Qty' },
                  { key: 'cost',  label: 'Cost' },
                  { key: 'gross', label: 'Gross Price' },
                  { key: 'tax',   label: 'Tax', noSort: true },
                  { key: 'net',   label: 'Net Price' },
                  { key: 'gp',    label: 'GP (net)' },
                  { key: 'cogs',  label: 'COGS %' },
                  { key: 'status',label: 'Status', noSort: true },
                ].map(col => (
                  <th
                    key={col.key}
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-text-2 uppercase tracking-wide whitespace-nowrap ${!(col as any).noSort ? 'cursor-pointer select-none hover:text-text-1' : ''}`}
                    onClick={() => !(col as any).noSort && onSort(col.key)}
                  >
                    {col.label}{!(col as any).noSort && sortArrow(col.key)}
                  </th>
                ))}
                <th className="px-3 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedItems.length === 0 && (
                <tr><td colSpan={colCount} className="px-4 py-8 text-center text-sm text-text-3">
                  {items.length === 0 ? 'No items yet. Click + Add Item above.' : 'No items match the current filter.'}
                </td></tr>
              )}
              {(() => {
                if (!groupByCategory) {
                  // ── Flat list with Category column ──────────────────────
                  return sortedItems.map(item => renderRow(item, false))
                }
                // ── Grouped by category ─────────────────────────────────
                const groups: Map<string, CogsItem[]> = new Map()
                for (const item of sortedItems) {
                  const cat = item.category || '(Uncategorised)'
                  if (!groups.has(cat)) groups.set(cat, [])
                  groups.get(cat)!.push(item)
                }
                return [...groups.entries()].flatMap(([cat, catItems]) => [
                  <tr key={`cat-${cat}`} className="bg-accent-dim/40 border-y border-border">
                    <td colSpan={10} className="px-3 py-1.5 text-xs font-semibold text-accent uppercase tracking-wider">
                      {cat} <span className="font-normal text-text-3 normal-case">· {catItems.length} item{catItems.length !== 1 ? 's' : ''}</span>
                    </td>
                  </tr>,
                  ...catItems.map(item => renderRow(item, true)),
                ])
              })()}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Menu Form Modal ───────────────────────────────────────────────────────────

function MenuFormModal({ menu, countries, onSave, onClose }: {
  menu: Menu | null; countries: Country[]
  onSave(name: string, country_id: number, description: string): void
  onClose(): void
}) {
  const [name,        setName]        = useState(menu?.name ?? '')
  const [countryId,   setCountryId]   = useState<number | ''>(menu?.country_id ?? '')
  const [description, setDescription] = useState(menu?.description ?? '')

  return (
    <Modal title={menu ? 'Edit Menu' : 'New Menu'} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Menu Name *">
          <input className="input w-full" value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Country *">
          <select className="select w-full" value={countryId} onChange={e => setCountryId(Number(e.target.value))}>
            <option value="">— Select Country —</option>
            {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Description">
          <textarea className="input w-full" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => { if (name.trim() && countryId) onSave(name.trim(), Number(countryId), description.trim()) }}
          >
            Save Menu
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Menu Item Form Modal ──────────────────────────────────────────────────────

interface MenuItemFormProps {
  isEdit: boolean; country: Country
  priceLevels: PriceLevel[]; taxRates: TaxRate[]; countryLevelTax: CountryLevelTax[]
  recipes: Recipe[]; ingredients: Ingredient[]
  miType: 'recipe' | 'ingredient'; miRecipeId: number | ''; miIngId: number | ''
  miDisplayName: string; miQty: string
  miLevelInputs: Record<number, { price: string; taxId: number | '' }>
  onTypeChange(t: 'recipe' | 'ingredient'): void
  onRecipeChange(id: number): void; onIngChange(id: number): void
  onDisplayName(v: string): void; onQty(v: string): void
  onLevelInput(levelId: number, field: 'price' | 'taxId', value: string | number | ''): void
  onSave(): void; onClose(): void
}

function MenuItemFormModal({ isEdit, country, priceLevels, taxRates, countryLevelTax, recipes, ingredients,
  miType, miRecipeId, miIngId, miDisplayName, miQty, miLevelInputs,
  onTypeChange, onRecipeChange, onIngChange, onDisplayName, onQty, onLevelInput, onSave, onClose }: MenuItemFormProps) {

  const sym = country.currency_symbol
  const countryTaxRates = taxRates.filter(t => t.country_id === country.id)

  function getEffectiveDefaultTax(levelId: number) {
    const clt = countryLevelTax.find(r => r.country_id === country.id && r.price_level_id === levelId)
    if (clt) return taxRates.find(t => t.id === clt.tax_rate_id)
    return taxRates.find(t => t.country_id === country.id && t.is_default)
  }

  const selectedIng = ingredients.find(i => i.id === miIngId)

  // ── Searchable combobox state ──────────────────────────────────────────────
  const selectedRecipeName = recipes.find(r => r.id === miRecipeId)?.name ?? ''
  const selectedIngName    = ingredients.find(i => i.id === miIngId)
    ? `${ingredients.find(i => i.id === miIngId)!.name}${ingredients.find(i => i.id === miIngId)!.base_unit_abbr ? ` (${ingredients.find(i => i.id === miIngId)!.base_unit_abbr})` : ''}`
    : ''

  const [recipeSearch, setRecipeSearch] = useState(selectedRecipeName)
  const [recipeOpen,   setRecipeOpen]   = useState(false)
  const [ingSearch,    setIngSearch]    = useState(selectedIngName)
  const [ingOpen,      setIngOpen]      = useState(false)

  // Sync search text when parent changes the selection (e.g. when editing an existing item)
  useEffect(() => { setRecipeSearch(selectedRecipeName) }, [selectedRecipeName])
  useEffect(() => { setIngSearch(selectedIngName) }, [selectedIngName])

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.toLowerCase()
    return recipes.filter(r => r.name.toLowerCase().includes(q))
  }, [recipes, recipeSearch])

  const filteredIngredients = useMemo(() => {
    const q = ingSearch.toLowerCase()
    return ingredients.filter(i => i.name.toLowerCase().includes(q))
  }, [ingredients, ingSearch])

  function selectRecipe(r: Recipe) {
    onRecipeChange(r.id)
    setRecipeSearch(r.name)
    setRecipeOpen(false)
  }

  function selectIngredient(i: Ingredient) {
    onIngChange(i.id)
    setIngSearch(`${i.name}${i.base_unit_abbr ? ` (${i.base_unit_abbr})` : ''}`)
    setIngOpen(false)
  }

  return (
    <Modal title={isEdit ? 'Edit Menu Item' : 'Add Item to Menu'} onClose={onClose}>
      <div className="space-y-4">
        {/* Type toggle */}
        <Field label="Item Type">
          <div className="flex gap-2">
            <button
              className={`btn btn-sm flex-1 ${miType === 'recipe' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => { onTypeChange('recipe'); setRecipeSearch(''); setRecipeOpen(false) }}
            >📖 Recipe</button>
            <button
              className={`btn btn-sm flex-1 ${miType === 'ingredient' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => { onTypeChange('ingredient'); setIngSearch(''); setIngOpen(false) }}
            >📦 Ingredient</button>
          </div>
        </Field>

        {/* Selection */}
        {miType === 'recipe' ? (
          <Field label="Recipe *">
            <div className="relative">
              <input
                className="input w-full"
                placeholder="Search recipes…"
                value={recipeSearch}
                onChange={e => { setRecipeSearch(e.target.value); setRecipeOpen(true) }}
                onFocus={() => setRecipeOpen(true)}
                onBlur={() => setTimeout(() => setRecipeOpen(false), 150)}
                autoComplete="off"
              />
              {recipeOpen && (
                <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
                  {filteredRecipes.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">No recipes match "{recipeSearch}"</div>
                  ) : filteredRecipes.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${miRecipeId === r.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectRecipe(r)}
                    >
                      {miRecipeId === r.id && <span className="text-accent text-xs">✓</span>}
                      <span>{r.name}</span>
                      {r.category && <span className="ml-auto text-xs text-gray-400 shrink-0">{r.category}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        ) : (
          <Field label="Ingredient *">
            <div className="relative">
              <input
                className="input w-full"
                placeholder="Search ingredients…"
                value={ingSearch}
                onChange={e => { setIngSearch(e.target.value); setIngOpen(true) }}
                onFocus={() => setIngOpen(true)}
                onBlur={() => setTimeout(() => setIngOpen(false), 150)}
                autoComplete="off"
              />
              {ingOpen && (
                <div className="absolute top-full left-0 right-0 z-50 bg-white border border-gray-200 rounded-lg shadow-lg mt-0.5 max-h-52 overflow-y-auto">
                  {filteredIngredients.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-400">No ingredients match "{ingSearch}"</div>
                  ) : filteredIngredients.map(i => (
                    <button
                      key={i.id}
                      type="button"
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-accent-dim flex items-center gap-2 ${miIngId === i.id ? 'bg-accent-dim font-medium text-accent' : 'text-gray-800'}`}
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => selectIngredient(i)}
                    >
                      {miIngId === i.id && <span className="text-accent text-xs">✓</span>}
                      <span>{i.name}</span>
                      {i.base_unit_abbr && <span className="ml-auto text-xs text-gray-400 shrink-0">{i.base_unit_abbr}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        )}

        {/* Display name */}
        <Field label="Menu Display Name">
          <input className="input w-full" placeholder="Auto-filled from selection — override here"
            value={miDisplayName} onChange={e => onDisplayName(e.target.value)} />
        </Field>

        {/* Qty */}
        <Field label={`Qty${miType === 'ingredient' && selectedIng?.base_unit_abbr ? ` (${selectedIng.base_unit_abbr})` : ' (portions)'}`}>
          <input className="input w-32" type="number" min="0.01" step="0.01"
            value={miQty} onChange={e => onQty(e.target.value)} />
        </Field>

        {/* Price levels */}
        {priceLevels.length > 0 && (
          <div className="border-t pt-4">
            <div className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-3">Prices per Level</div>
            <div className="text-xs text-gray-400 mb-3">Set gross price + tax rate per level. Leave blank to exclude from that level.</div>
            <div className="grid gap-2">
              <div className="grid grid-cols-3 gap-2 text-xs text-gray-400 font-medium mb-1">
                <span>Level</span><span>Gross price (inc. tax)</span><span>Tax rate</span>
              </div>
              {priceLevels.map(level => {
                const inp = miLevelInputs[level.id] ?? { price: '', taxId: '' }
                const defTax = getEffectiveDefaultTax(level.id)
                const defLabel = defTax ? `Default: ${defTax.name} (${(defTax.rate * 100).toFixed(0)}%)` : 'Country default'
                return (
                  <div key={level.id} className="grid grid-cols-3 gap-2 items-center">
                    <span className="text-sm font-semibold text-gray-700">{level.name}</span>
                    <div className="flex items-center border rounded px-2 bg-white">
                      <span className="text-gray-400 text-sm mr-1">{sym}</span>
                      <input
                        type="number" min="0" step="0.01" placeholder="Not priced"
                        className="w-full py-1.5 text-sm outline-none"
                        value={inp.price}
                        onChange={e => onLevelInput(level.id, 'price', e.target.value)}
                      />
                    </div>
                    <select
                      className="select select-sm"
                      value={inp.taxId}
                      onChange={e => onLevelInput(level.id, 'taxId', e.target.value ? Number(e.target.value) : '')}
                    >
                      <option value="">{defLabel}</option>
                      {countryTaxRates.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} {(t.rate * 100).toFixed(0)}%{t.is_default ? ' ✓' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={onSave}>
            {isEdit ? 'Save Changes' : 'Add to Menu'}
          </button>
        </div>
      </div>
    </Modal>
  )
}


// ═══════════════════════════════════════════════════════════════════════════════
//  SHARED GRID HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function cogsBadge(pct: number | null, thr: CogsThresholds) {
  if (pct === null) return null
  if (pct <= thr.excellent)  return { cls: 'bg-green-100 text-green-700',  label: `${pct.toFixed(1)}%` }
  if (pct <= thr.acceptable) return { cls: 'bg-yellow-100 text-yellow-700', label: `${pct.toFixed(1)}%` }
  return                            { cls: 'bg-red-100 text-red-700',       label: `${pct.toFixed(1)}%` }
}

// Inline editable price cell — shared by both tools
function InlinePriceCell({
  value, sym, saving, saved, onCommit,
}: {
  value: number | null
  sym: string
  saving?: boolean
  saved?: boolean
  onCommit(v: number | null): void
}) {
  const fmt = (n: number | null) => n !== null && n > 0 ? n.toFixed(2) : ''
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(fmt(value))
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) setDraft(fmt(value))
  }, [value, editing])

  function commit() {
    setEditing(false)
    const n = draft.trim() === '' ? null : parseFloat(draft)
    if (n === null || (!isNaN(n) && n >= 0)) onCommit(n !== null && isNaN(n) ? null : n)
    else setDraft(fmt(value))
  }

  return (
    <div
      className={`flex items-center rounded px-1.5 py-1 min-w-[90px] border transition-all cursor-text
        ${saved  ? 'bg-green-50 border-green-300' : ''}
        ${saving ? 'opacity-50 pointer-events-none border-gray-200' : ''}
        ${!saving && !saved ? 'border-transparent hover:border-gray-300 focus-within:border-blue-400 focus-within:ring-1 focus-within:ring-blue-200' : ''}
      `}
      onClick={() => { setEditing(true); setTimeout(() => ref.current?.select(), 10) }}
    >
      <span className="text-gray-400 text-xs mr-0.5 select-none">{sym}</span>
      <input
        ref={ref}
        type="number"
        min="0"
        step="0.01"
        value={draft}
        placeholder="—"
        className="w-20 bg-transparent outline-none text-xs font-mono"
        onChange={e => setDraft(e.target.value)}
        onFocus={() => setEditing(true)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter')  { e.currentTarget.blur() }
          if (e.key === 'Escape') { setDraft(fmt(value)); setEditing(false); e.currentTarget.blur() }
        }}
      />
    </div>
  )
}




// ═══════════════════════════════════════════════════════════════════════════════
//  PRICE LEVEL TOOL
// ═══════════════════════════════════════════════════════════════════════════════

interface PriceLevelToolProps {
  data: PriceReportData | null
  loading: boolean
  countries: Country[]
  priceLevels: PriceLevel[]
  selectedLevel: number | ''
  currencyMode: 'own' | 'single'
  singleCurrency: string
  search: string
  cat: string
  onLevelChange(v: number | ''): void
  onCurrencyMode(v: 'own' | 'single'): void
  onSingleCurrency(v: string): void
  onSearch(v: string): void
  onCat(v: string): void
  onSavePrice(menuItemId: number, levelId: number, grossDisplay: number, dispRate: number): Promise<void>
  showToast(msg: string, type?: 'error'): void
}

function PriceLevelTool({
  data, loading, countries, priceLevels, selectedLevel, currencyMode, singleCurrency,
  search, cat, onLevelChange, onCurrencyMode, onSingleCurrency,
  onSearch, onCat, onSavePrice, showToast,
}: PriceLevelToolProps) {

  const cogsThresholds = useCogsThresholds()
  const [savingKey, setSavingKey] = useState<Record<string, boolean>>({})
  const [savedKey,  setSavedKey]  = useState<Record<string, boolean>>({})

  // All unique currencies from countries
  const allCurrencies = useMemo(() => {
    const seen = new Set<string>()
    const result: { code: string; symbol: string }[] = []
    countries.forEach(c => {
      if (!seen.has(c.currency_code)) {
        seen.add(c.currency_code)
        result.push({ code: c.currency_code, symbol: c.currency_symbol })
      }
    })
    if (data?.base_currency && !seen.has(data.base_currency.code)) {
      result.push({ code: data.base_currency.code, symbol: data.base_currency.symbol ?? '$' })
    }
    return result.sort((a, b) => a.code.localeCompare(b.code))
  }, [countries, data])

  // Exchange rate: country local → base (stored in country.exchange_rate)
  // To convert local → single display: price_base = price_local * rate
  // For "single currency" display: find the rate of the target currency to base
  const targetRate = useMemo(() => {
    if (currencyMode === 'own') return null
    // Base currency always has rate 1
    if (singleCurrency === data?.base_currency?.code) return 1
    const c = countries.find(c => c.currency_code === singleCurrency)
    return c ? Number(c.exchange_rate) : 1
  }, [currencyMode, singleCurrency, countries, data])

  const displaySym = useMemo(() => {
    if (currencyMode === 'own') return null
    // Look in allCurrencies which includes the base currency entry with correct symbol
    const c = allCurrencies.find(c => c.code === singleCurrency)
    return c?.symbol ?? singleCurrency
  }, [currencyMode, singleCurrency, allCurrencies])

  // Get country by id from data
  // Filter data
  const cats = useMemo(() => {
    const s = new Set((data?.recipes ?? []).map(r => r.category).filter(Boolean))
    return [...s].sort() as string[]
  }, [data])

  const filtered = useMemo(() => {
    if (!data) return []
    return data.recipes.filter(r => {
      if (search && !r.recipe_name.toLowerCase().includes(search.toLowerCase())) return false
      if (cat && r.category !== cat) return false
      return true
    })
  }, [data, search, cat])

  // Build display rows from the price report data
  interface PltGridRow {
    key: string
    recipe_id: number
    recipe_name: string
    category: string
    menu_id: number
    menu_name: string
    country_id: number
    country_name: string
    country_sym: string
    country_rate: number
    disp_rate: number
    cost_local: number
    cost_display: number
    sell_gross_local: number | null
    sell_gross_display: number | null
    cogs_pct: number | null
    menu_item_id: number | null
  }

  const gridRows: PltGridRow[] = useMemo(() => {
    if (!data) return []
    const result: PltGridRow[] = []
    filtered.forEach(recipe => {
      data.countries.forEach(c => {
        const entries = recipe.countries[c.id]
        if (!entries?.length) return

        // Convert to display currency
        // stored prices are in country local currency
        // local → target = local ÷ c.rate × targetRate  →  dispRate = targetRate / c.rate
        let dispRate = 1
        if (currencyMode === 'single' && targetRate) {
          dispRate = targetRate / (c.rate || 1)
        }

        entries.forEach(cd => {
          if (!cd.on_menu) return
          const costLocal    = cd.cost ?? 0
          const grossLocal   = cd.sell_gross ?? null
          const costDisplay  = costLocal * (currencyMode === 'single' ? dispRate : 1)
          const grossDisplay = grossLocal !== null ? grossLocal * (currencyMode === 'single' ? dispRate : 1) : null

          result.push({
            key:               `${recipe.recipe_id}_${c.id}_${cd.menu_id}`,
            recipe_id:         recipe.recipe_id,
            recipe_name:       recipe.recipe_name,
            category:          recipe.category || '',
            menu_id:           cd.menu_id ?? 0,
            menu_name:         cd.menu_name ?? '',
            country_id:        c.id,
            country_name:      c.name,
            country_sym:       currencyMode === 'own' ? c.symbol : (displaySym ?? c.symbol),
            country_rate:      c.rate,
            disp_rate:         currencyMode === 'single' ? dispRate : 1,
            cost_local:        costLocal,
            cost_display:      costDisplay,
            sell_gross_local:  grossLocal,
            sell_gross_display:grossDisplay,
            cogs_pct:          cd.cogs_pct ?? null,
            menu_item_id:      cd.menu_item_id ?? null,
          })
        })
      })
    })
    return result
  }, [data, filtered, currencyMode, targetRate, displaySym])

  const { sorted: sortedRows, getFilter, sortField, sortDir, setSort, setFilter } = useSortFilter(gridRows, 'recipe_name')

  async function handleSavePrice(row: PltGridRow, grossDisplay: number | null) {
    if (!row.menu_item_id || !selectedLevel) return
    if (grossDisplay === null) return
    const key = `${row.menu_item_id}_${selectedLevel}`
    setSavingKey(p => ({ ...p, [key]: true }))
    try {
      await onSavePrice(row.menu_item_id, Number(selectedLevel), grossDisplay, row.disp_rate)
      setSavedKey(p => ({ ...p, [key]: true }))
      setTimeout(() => setSavedKey(p => ({ ...p, [key]: false })), 700)
    } catch { showToast('Failed to save price', 'error') }
    finally { setSavingKey(p => ({ ...p, [key]: false })) }
  }

  function exportCSV() {
    if (!data) return
    const header = ['Menu', 'Recipe', 'Category', 'Country', `Cost`, `Gross Price`, 'COGS %']
    const csvRows = [header, ...sortedRows.map(r => [
      r.menu_name, r.recipe_name, r.category, r.country_name,
      r.cost_display.toFixed(2),
      r.sell_gross_display?.toFixed(2) ?? '',
      r.cogs_pct?.toFixed(1) ?? '',
    ])]
    const csv = csvRows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'price-level-tool.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="bg-white rounded-lg border border-gray-200">

        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <span className="font-semibold text-gray-700 text-sm">📈 Price Level Tool</span>

          {/* Level selector */}
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs text-gray-400">Level</span>
            <select className="select select-sm" value={selectedLevel} onChange={e => onLevelChange(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— All levels —</option>
              {priceLevels.map(l => <option key={l.id} value={l.id}>{l.name}{l.is_default ? ' ★' : ''}</option>)}
            </select>
          </div>

          {/* Currency mode */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Currency</span>
            <div className="flex rounded border border-gray-200 overflow-hidden">
              <button
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${currencyMode === 'own' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                onClick={() => onCurrencyMode('own')}
              >Own</button>
              <button
                className={`px-2.5 py-1 text-xs font-medium transition-colors border-l border-gray-200 ${currencyMode === 'single' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                onClick={() => onCurrencyMode('single')}
              >Single</button>
            </div>
            {currencyMode === 'single' && (
              <select className="select select-sm" value={singleCurrency} onChange={e => onSingleCurrency(e.target.value)}>
                <option value="">— Pick currency —</option>
                {allCurrencies.map(c => <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>)}
              </select>
            )}
          </div>

          <div className="flex gap-2 ml-auto flex-wrap items-center">
            <input className="input input-sm w-40" placeholder="Search recipes…" value={search} onChange={e => onSearch(e.target.value)} />
            <select className="select select-sm" value={cat} onChange={e => onCat(e.target.value)}>
              <option value="">All Categories</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button className="btn btn-sm btn-outline" onClick={exportCSV}>⬇ CSV</button>
          </div>
        </div>

        {/* Currency mode hint */}
        {currencyMode === 'single' && singleCurrency && (
          <div className="px-4 py-2 bg-blue-50 text-blue-700 text-xs border-b border-blue-100">
            Prices converted to <strong>{displaySym}{singleCurrency}</strong> using stored exchange rates. Edits will be converted back to each country's local currency before saving.
          </div>
        )}
        {!selectedLevel && (
          <div className="px-4 py-2 bg-yellow-50 text-yellow-700 text-xs border-b border-yellow-100">
            Select a price level above to see and edit sell prices. COGS% requires a level to be selected.
          </div>
        )}

        {loading && <div className="p-12 text-center"><Spinner /></div>}
        {!loading && !data && <div className="p-12 text-center text-sm text-gray-400">Loading…</div>}
        {!loading && data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-200 border-b border-gray-300">
                <tr>
                  <ColumnHeader<PltGridRow> label="Menu"     field="menu_name"          sortField={sortField} sortDir={sortDir} onSort={setSort}
                    filterOptions={[...new Set(gridRows.map(r => r.menu_name).filter(Boolean))].sort().map(m => ({ value: m, label: m }))}
                    filterValues={getFilter('menu_name')} onFilter={v => setFilter('menu_name', v)} />
                  <ColumnHeader<PltGridRow> label="Recipe"   field="recipe_name"        sortField={sortField} sortDir={sortDir} onSort={setSort} />
                  <ColumnHeader<PltGridRow> label="Category" field="category"           sortField={sortField} sortDir={sortDir} onSort={setSort}
                    filterOptions={[...new Set(gridRows.map(r => r.category).filter(Boolean))].sort().map(c => ({ value: c, label: c }))}
                    filterValues={getFilter('category')} onFilter={v => setFilter('category', v)} />
                  <ColumnHeader<PltGridRow> label="Country"  field="country_name"       sortField={sortField} sortDir={sortDir} onSort={setSort}
                    filterOptions={[...new Set(gridRows.map(r => r.country_name))].sort().map(c => ({ value: c, label: c }))}
                    filterValues={getFilter('country_name')} onFilter={v => setFilter('country_name', v)} />
                  <ColumnHeader<PltGridRow> label="Cost"     field="cost_display"       sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                  {selectedLevel ? (
                    <>
                      <ColumnHeader<PltGridRow> label="Gross Price" field="sell_gross_display" sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                      <ColumnHeader<PltGridRow> label="COGS %"      field="cogs_pct"           sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                    </>
                  ) : (
                    <th className="px-3 py-2.5 text-xs font-semibold text-gray-400 text-right">Gross Price</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedRows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">
                    No data. Make sure recipes are added to menus.
                  </td></tr>
                )}
                {sortedRows.map(row => {
                  const sym     = row.country_sym
                  const saveKey = `${row.menu_item_id}_${selectedLevel}`
                  const badge   = cogsBadge(row.cogs_pct, cogsThresholds)
                  return (
                    <tr key={row.key} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 text-gray-700 font-medium">{row.menu_name || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 font-medium text-gray-900">{row.recipe_name}</td>
                      <td className="px-3 py-2.5">
                        {row.category
                          ? <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{row.category}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{row.country_name}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{sym}{row.cost_display.toFixed(2)}</td>
                      {selectedLevel ? (
                        <>
                          <td className="px-2 py-1.5">
                            <div className="flex justify-end">
                              <InlinePriceCell
                                value={row.sell_gross_display}
                                sym={sym}
                                saving={savingKey[saveKey]}
                                saved={savedKey[saveKey]}
                                onCommit={v => { if (v !== null) handleSavePrice(row, v) }}
                              />
                            </div>
                          </td>
                          <td
                            className="px-3 py-2.5 text-right"
                            data-ai-context={row.cogs_pct != null ? JSON.stringify({ type: 'cogs_pct', value: `${row.cogs_pct.toFixed(1)}%`, item: row.recipe_name, price_level: priceLevels.find(l => l.id === Number(selectedLevel))?.name ?? '' }) : undefined}
                          >
                            {badge
                              ? <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                        </>
                      ) : (
                        <td className="px-3 py-2.5 text-right text-gray-300 text-xs">Select a level</td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MARKET PRICE TOOL  (formerly Level Report)
// ═══════════════════════════════════════════════════════════════════════════════

interface MarketPriceToolProps {
  countries: Country[]
  data: LevelReportData | null
  loading: boolean
  countryId: number | ''
  search: string
  saving: Record<string, boolean>
  saved: Record<string, boolean>
  onCountryChange(v: number | ''): void
  onSearch(v: string): void
  onSavePrice(menuItemId: number, levelId: number, grossDisplay: number): void
  showToast(msg: string, type?: 'error'): void
}

function MarketPriceTool({
  countries, data, loading, countryId, search,
  saving, saved, onCountryChange, onSearch, onSavePrice,
}: MarketPriceToolProps) {

  const cogsThresholds = useCogsThresholds()
  const [dispCurrCode, setDispCurrCode] = useState<string>('')  // '' = market's own currency

  const levels  = data?.levels ?? []
  const country = data?.country

  // Reset display currency whenever the selected market changes
  useEffect(() => { setDispCurrCode('') }, [countryId])

  // Deduplicated currency options: market own (default) + all others + USD base
  const mptCurrencyOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { value: string; label: string; sym: string; rate: number }[] = []
    if (country) {
      opts.push({ value: '', label: `${country.code} ${country.symbol} (market)`, sym: country.symbol, rate: country.rate })
      seen.add(country.code)
    }
    for (const c of countries) {
      if (!seen.has(c.currency_code)) {
        seen.add(c.currency_code)
        opts.push({ value: c.currency_code, label: `${c.currency_code} ${c.currency_symbol}`, sym: c.currency_symbol, rate: Number(c.exchange_rate) })
      }
    }
    if (!seen.has('USD')) {
      opts.push({ value: '__BASE__', label: 'USD $ (base)', sym: '$', rate: 1 })
    }
    return opts
  }, [countries, country])

  // Compute display rate (market local → chosen currency) and symbol
  const { dispRate, dispSym, dispCode } = useMemo(() => {
    const marketRate = country?.rate || 1
    if (!dispCurrCode || !country) return { dispRate: 1, dispSym: country?.symbol ?? '', dispCode: country?.code ?? '' }
    if (dispCurrCode === '__BASE__') return { dispRate: 1 / marketRate, dispSym: '$', dispCode: 'USD' }
    const target = countries.find(c => c.currency_code === dispCurrCode)
    if (!target) return { dispRate: 1, dispSym: country.symbol, dispCode: country.code }
    return { dispRate: Number(target.exchange_rate) / marketRate, dispSym: target.currency_symbol, dispCode: target.currency_code }
  }, [dispCurrCode, country, countries])

  const sym = dispSym

  const menuNames = useMemo(() => {
    const s = new Set((data?.items ?? []).map(i => i.menu_name))
    return [...s].sort()
  }, [data])

  // Flatten items for sorting
  interface MptRow {
    menu_item_id: number
    display_name: string
    item_type:    string
    menu_name:    string
    category:     string
    cost:         number
    [key: string]: any   // level_N_gross, level_N_cogs
  }

  const flatRows: MptRow[] = useMemo(() => {
    return (data?.items ?? []).map(item => {
      const row: MptRow = {
        menu_item_id: item.menu_item_id,
        display_name: item.display_name,
        item_type:    item.item_type,
        menu_name:    item.menu_name,
        category:     item.category || '',
        cost:         item.cost * dispRate,
      }
      levels.forEach(l => {
        const ld = item.levels[l.id]
        row[`lvl_${l.id}_gross`] = ld?.gross != null ? ld.gross * dispRate : null
        row[`lvl_${l.id}_cogs`]  = ld?.cogs_pct ?? null
        row[`lvl_${l.id}_net`]   = ld?.net   != null ? ld.net   * dispRate : null
        row[`lvl_${l.id}_set`]   = ld?.set ?? false
      })
      return row
    })
  }, [data, levels, dispRate])

  const filteredRows = useMemo(() => {
    if (!search) return flatRows
    return flatRows.filter(r => r.display_name.toLowerCase().includes(search.toLowerCase()))
  }, [flatRows, search])

  const { sorted: sortedRows, getFilter, sortField, sortDir, setSort, setFilter } = useSortFilter(filteredRows, 'display_name')

  function exportCSV() {
    if (!data) return
    const header = ['Item', 'Menu', 'Type', `Cost (${dispCode})`,
      ...levels.flatMap(l => [`${l.name} Gross (${dispCode})`, `${l.name} COGS%`])]
    const csvRows = [header, ...sortedRows.map(r => [
      r.display_name, r.menu_name, r.item_type, r.cost.toFixed(2),
      ...levels.flatMap(l => [
        r[`lvl_${l.id}_gross`]?.toFixed(2) ?? '',
        r[`lvl_${l.id}_cogs`]?.toFixed(1) ?? '',
      ])
    ])]
    const csv = csvRows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'market-price-tool.csv'; document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="bg-white rounded-lg border border-gray-200">

        {/* Toolbar */}
        <div className="p-4 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <span className="font-semibold text-gray-700 text-sm">🏷 Market Price Tool</span>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="text-xs text-gray-400">Market</span>
            <select className="select select-sm min-w-[160px]" value={countryId} onChange={e => onCountryChange(e.target.value ? Number(e.target.value) : '')}>
              <option value="">— Select market —</option>
              {countries.map(c => <option key={c.id} value={c.id}>{c.name} ({c.currency_code})</option>)}
            </select>
          </div>
          {country && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">Display</span>
              <select className="select select-sm min-w-[130px]" value={dispCurrCode} onChange={e => setDispCurrCode(e.target.value)}>
                {mptCurrencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-2 ml-auto flex-wrap items-center">
            <input className="input input-sm w-40" placeholder="Filter items…" value={search} onChange={e => onSearch(e.target.value)} />
            {data && <button className="btn btn-sm btn-outline" onClick={exportCSV}>⬇ CSV</button>}
          </div>
        </div>

        {!countryId && <div className="p-12 text-center text-sm text-gray-400">Select a market to load prices.</div>}
        {countryId && loading && <div className="p-12 text-center"><Spinner /></div>}

        {countryId && !loading && data && (
          <>
            <div className="px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
              {dispCurrCode
                ? <>Prices converted to <strong className="text-gray-600">{dispSym} {dispCode}</strong> from market local currency. Click any gross cell to edit — saved back in {country?.symbol} {country?.code}.</>
                : <>Prices in <strong className="text-gray-600">{sym} {country?.code}</strong>. Click any gross price cell to edit. COGS% updates after save.</>
              }
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-200 border-b border-gray-300">
                  <tr>
                    <ColumnHeader<MptRow> label="Item"     field="display_name" sortField={sortField} sortDir={sortDir} onSort={setSort} />
                    <ColumnHeader<MptRow> label="Category" field="category"     sortField={sortField} sortDir={sortDir} onSort={setSort}
                      filterOptions={[...new Set(flatRows.map(r => r.category).filter(Boolean))].sort().map(c => ({ value: c, label: c }))}
                      filterValues={getFilter('category')} onFilter={v => setFilter('category', v)} />
                    <ColumnHeader<MptRow> label="Menu"     field="menu_name"    sortField={sortField} sortDir={sortDir} onSort={setSort}
                      filterOptions={menuNames.map(m => ({ value: m, label: m }))}
                      filterValues={getFilter('menu_name')} onFilter={v => setFilter('menu_name', v)} />
                    <ColumnHeader<MptRow> label="Type"     field="item_type"    sortField={sortField} sortDir={sortDir} onSort={setSort}
                      filterOptions={[{ value: 'recipe', label: 'Recipe' }, { value: 'ingredient', label: 'Ingredient' }]}
                      filterValues={getFilter('item_type')} onFilter={v => setFilter('item_type', v)} />
                    <ColumnHeader<MptRow> label={`Cost (${dispCode})`} field="cost" sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />
                    {levels.flatMap(l => [
                      <ColumnHeader<MptRow> key={`${l.id}_g`} label={`${l.name} Gross`} field={`lvl_${l.id}_gross` as keyof MptRow} sortField={sortField} sortDir={sortDir} onSort={setSort} align="right" />,
                      <th key={`${l.id}_c`} className="px-3 py-2.5 text-xs font-semibold text-gray-500 text-right whitespace-nowrap">COGS %</th>,
                    ])}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sortedRows.length === 0 && (
                    <tr><td colSpan={4 + levels.length * 2} className="px-4 py-10 text-center text-sm text-gray-400">
                      No items match the current filter.
                    </td></tr>
                  )}
                  {sortedRows.map(row => (
                    <tr key={row.menu_item_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 font-medium text-gray-900">{row.display_name}</td>
                      <td className="px-3 py-2.5">
                        {row.category
                          ? <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{row.category}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs">{row.menu_name}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{row.item_type}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{sym}{row.cost.toFixed(2)}</td>
                      {levels.flatMap(l => {
                        const key   = `${row.menu_item_id}_${l.id}`
                        const gross = row[`lvl_${l.id}_gross`] as number | null
                        const cogs  = row[`lvl_${l.id}_cogs`]  as number | null
                        const badge = cogsBadge(cogs, cogsThresholds)
                        return [
                          <td key={`${l.id}_g`} className="px-2 py-1.5">
                            <div className="flex justify-end">
                              <InlinePriceCell
                                value={gross}
                                sym={sym}
                                saving={saving[key]}
                                saved={saved[key]}
                                onCommit={v => { if (v !== null) onSavePrice(row.menu_item_id, l.id, dispRate !== 0 ? v / dispRate : v) }}
                              />
                            </div>
                          </td>,
                          <td key={`${l.id}_c`} className="px-3 py-2.5 text-right">
                            {badge
                              ? <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${badge.cls}`}>{badge.label}</span>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>,
                        ]
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Sales Mix Generator Modal ─────────────────────────────────────────────────

interface SalesMixGenProps {
  data:           CogsData
  priceLevels:    PriceLevel[]
  menuId:         number
  currencySymbol: string
  currentQty:     Record<string, string>
  onGenerate(qMap: Record<string, string>): void
  onReset(): void
  onClose(): void
}

function SalesMixGeneratorModal({ data, priceLevels, menuId, currencySymbol, currentQty, onGenerate, onReset, onClose }: SalesMixGenProps) {
  const api = useApi()

  // Derive categories from current menu data
  const categories = useMemo(() => {
    const map: Record<string, number> = {}
    for (const item of data.items) {
      const cat = item.category || 'Uncategorised'
      map[cat] = (map[cat] || 0) + 1
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [data])

  // ── Category mix from current quantities ───────────────────────────────
  const catMix = useMemo(() => {
    const catQty:   Record<string, number> = {}
    const catCount: Record<string, number> = {}
    for (const item of data.items) {
      const cat    = item.category || 'Uncategorised'
      const natKey = item.item_type === 'recipe' ? `r_${item.recipe_id}` : `i_${item.ingredient_id}`
      // Sum per-level keys (e.g. "r_1__l2") falling back to shared key for single-level view
      const qPerLevel = priceLevels.reduce((s, l) => s + parseInt(currentQty[`${natKey}__l${l.id}`] || '0', 10), 0)
      const q = qPerLevel > 0 ? qPerLevel : parseInt(currentQty[natKey] || '0', 10)
      catQty[cat]   = (catQty[cat]   || 0) + q
      catCount[cat] = (catCount[cat] || 0) + 1
    }
    const totalQty = Object.values(catQty).reduce((s, v) => s + v, 0)
    const cats = Object.entries(catQty)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, qty]) => ({ cat, qty, count: catCount[cat] || 0, pct: totalQty > 0 ? (qty / totalQty) * 100 : 0 }))
    return { cats, totalQty }
  }, [data, currentQty, priceLevels])

  const existingRevenue = useMemo(() => {
    let total = 0
    for (const item of data.items) {
      const natKey = item.item_type === 'recipe' ? `r_${item.recipe_id}` : `i_${item.ingredient_id}`
      const qPerLevel = priceLevels.reduce((s, l) => s + parseInt(currentQty[`${natKey}__l${l.id}`] || '0', 10), 0)
      const q = qPerLevel > 0 ? qPerLevel : parseInt(currentQty[natKey] || '0', 10)
      total += q * (item.sell_price_gross || 0)
    }
    return total
  }, [data, currentQty, priceLevels])

  // ── State ────────────────────────────────────────────────────────────────
  const [targetRevenue, setTargetRevenue] = useState(() =>
    existingRevenue > 0 ? String(Math.round(existingRevenue)) : ''
  )

  // Category percentages — initialise with equal split
  const [catPcts, setCatPcts] = useState<Record<string, string>>(() => {
    const n   = categories.length
    if (!n) return {}
    const eq  = Math.floor(100 / n)
    const rem = 100 - eq * (n - 1)
    return Object.fromEntries(categories.map(([cat], i) => [cat, String(i === n - 1 ? rem : eq)]))
  })

  // Price-level percentages — initialise with equal split
  const [levelPcts, setLevelPcts] = useState<Record<number, string>>(() => {
    const n   = priceLevels.length
    if (!n) return {}
    const eq  = Math.floor(100 / n)
    const rem = 100 - eq * (n - 1)
    return Object.fromEntries(priceLevels.map((l, i) => [l.id, String(i === n - 1 ? rem : eq)]))
  })

  const [generating, setGenerating] = useState(false)
  const [error,      setError]      = useState('')
  const [preview,    setPreview]    = useState<{ label: string; qty: number; price: string }[] | null>(null)

  // Validation
  const catTotal   = categories.reduce((s, [c]) => s + (parseFloat(catPcts[c])    || 0), 0)
  const levelTotal = priceLevels.reduce((s, l)   => s + (parseFloat(levelPcts[l.id]) || 0), 0)
  const catValid   = Math.abs(catTotal   - 100) < 0.5
  const levelValid = priceLevels.length === 0 || Math.abs(levelTotal - 100) < 0.5
  const revValid   = parseFloat(targetRevenue) > 0
  const canGo      = catValid && levelValid && revValid

  async function generate() {
    setGenerating(true); setError(''); setPreview(null)
    try {
      const revenue     = parseFloat(targetRevenue)
      const activeLevels = priceLevels.filter(l => (parseFloat(String(levelPcts[l.id])) || 0) > 0)

      // Fetch COGS at each active price level to get per-item prices
      // (If no price levels configured, fall back to current data prices)
      const levelPriceMap: Record<number, Map<number, number>> = {}  // levelId → menu_item_id → sell_price_gross

      if (activeLevels.length > 0) {
        await Promise.all(activeLevels.map(async level => {
          const d: CogsData = await api.get(`/cogs/menu/${menuId}?price_level_id=${level.id}`)
          const m = new Map<number, number>()
          for (const item of d.items) m.set(item.menu_item_id, item.sell_price_gross)
          levelPriceMap[level.id] = m
        }))
      } else {
        // No level split — use current data as-is at level 0 (placeholder)
        const m = new Map<number, number>()
        for (const item of data.items) m.set(item.menu_item_id, item.sell_price_gross)
        levelPriceMap[0] = m
        activeLevels.push({ id: 0, name: 'default', is_default: true })
      }

      // Compute weighted effective gross price per menu item
      const effectivePrice: Record<number, number> = {}
      for (const item of data.items) {
        let p = 0
        for (const level of activeLevels) {
          const pct   = activeLevels.length === 1 ? 100 : (parseFloat(String(levelPcts[level.id])) || 0)
          const price = levelPriceMap[level.id]?.get(item.menu_item_id) ?? 0
          p += price * pct / 100
        }
        effectivePrice[item.menu_item_id] = p
      }

      // Group items by category
      const catItems: Record<string, CogsItem[]> = {}
      for (const item of data.items) {
        const cat = item.category || 'Uncategorised'
        if (!catItems[cat]) catItems[cat] = []
        catItems[cat].push(item)
      }

      // Distribute revenue → quantities
      // Within each category: equal revenue share per item, qty = rev_share / effective_price
      const qMap: Record<string, string> = {}
      const previewRows: { label: string; qty: number; price: string }[] = []

      for (const [cat, items] of Object.entries(catItems)) {
        const catRevenue  = revenue * (parseFloat(catPcts[cat]) || 0) / 100
        if (catRevenue <= 0) continue

        // Only items that have a real price set
        const pricedItems = items.filter(i => effectivePrice[i.menu_item_id] > 0)
        if (pricedItems.length === 0) continue

        const itemRevShare = catRevenue / pricedItems.length

        for (const item of pricedItems) {
          const price   = effectivePrice[item.menu_item_id]
          const totalQty = Math.max(1, Math.round(itemRevShare / price))
          const natKey  = item.item_type === 'recipe'
            ? `r_${item.recipe_id}`
            : `i_${item.ingredient_id}`

          if (activeLevels.length === 1 && activeLevels[0].id === 0) {
            // No price levels configured — use shared key
            qMap[natKey] = String(totalQty)
          } else {
            // Distribute totalQty across levels according to levelPcts
            let remaining = totalQty
            activeLevels.forEach((level, idx) => {
              const pct      = parseFloat(String(levelPcts[level.id])) || 0
              const levelQty = idx === activeLevels.length - 1
                ? remaining   // last level absorbs rounding remainder
                : Math.round(totalQty * pct / 100)
              remaining -= levelQty
              if (levelQty > 0) qMap[`${natKey}__l${level.id}`] = String(levelQty)
            })
          }

          previewRows.push({
            label: item.display_name,
            qty:   totalQty,
            price: `${currencySymbol}${price.toFixed(2)}`,
          })
        }
      }

      setPreview(previewRows)
      // Store qMap in a ref so Apply can use it
      pendingQMap.current = qMap
    } catch (err: any) {
      setError(err.message || 'Failed to generate mix')
    } finally {
      setGenerating(false)
    }
  }

  const pendingQMap = useRef<Record<string, string>>({})

  const sym = currencySymbol

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-[580px] max-h-[88vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">⚡ Mix Manager</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Enter revenue target + category &amp; price-level splits to auto-generate item quantities
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>

        {/* Body — scrollable */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

          {/* Current category mix — shown when qty already entered */}
          {catMix.totalQty > 0 && (
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-blue-700 font-semibold text-sm">Current category mix</span>
                <span className="text-xs text-blue-500">
                  {catMix.totalQty.toLocaleString()} sold · {currencySymbol}{existingRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })} est. revenue
                </span>
              </div>
              <div className="space-y-2">
                {catMix.cats.map((c, i) => (
                  <div key={c.cat} className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: `hsl(${(i * 47) % 360},60%,55%)` }} />
                    <span className="text-sm text-gray-700 flex-1 min-w-0 truncate">{c.cat}</span>
                    <span className="text-xs text-gray-400 shrink-0">{c.count} item{c.count !== 1 ? 's' : ''}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="w-20 h-1.5 bg-blue-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: `hsl(${(i * 47) % 360},60%,55%)` }} />
                      </div>
                      <span className="text-xs font-semibold tabular-nums text-blue-700 w-9 text-right">{c.pct.toFixed(0)}%</span>
                      <span className="text-xs text-gray-400 tabular-nums w-16 text-right">{c.qty.toLocaleString()} sold</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Revenue target */}
          <div>
            <label className="text-sm font-semibold text-gray-700 block mb-2">Revenue Target</label>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 font-medium">{sym}</span>
              <input
                autoFocus
                className="input w-44 text-lg font-semibold"
                type="number"
                min="1"
                step="100"
                placeholder="10,000"
                value={targetRevenue}
                onChange={e => setTargetRevenue(e.target.value)}
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">Gross sales value — quantities will be generated to match this target</p>
          </div>

          {/* Category split */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="text-sm font-semibold text-gray-700">Category Split</label>
              <div className="flex items-center gap-2">
                <div className="flex gap-0.5 h-2 w-32 rounded-full overflow-hidden bg-gray-100">
                  {categories.map(([cat], i) => {
                    const pct = Math.max(0, parseFloat(catPcts[cat]) || 0)
                    const hue = (i * 47) % 360
                    return <div key={cat} style={{ width: `${pct}%`, background: `hsl(${hue},60%,55%)` }} />
                  })}
                </div>
                <span className={`text-xs font-semibold tabular-nums ${catValid ? 'text-emerald-600' : 'text-red-500'}`}>
                  {catTotal.toFixed(0)}%{catValid ? ' ✓' : ''}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              {categories.map(([cat, count], i) => {
                const othersTotal = categories.filter(([c]) => c !== cat).reduce((s, [c]) => s + (parseFloat(catPcts[c]) || 0), 0)
                const remainder   = Math.max(0, Math.round((100 - othersTotal) * 10) / 10)
                return (
                  <div key={cat} className="flex items-center gap-3">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: `hsl(${(i * 47) % 360},60%,55%)` }}
                    />
                    <span className="text-sm text-gray-800 flex-1 min-w-0 truncate">{cat}</span>
                    <span className="text-xs text-gray-400 shrink-0">{count} item{count !== 1 ? 's' : ''}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        className="text-xs text-gray-300 hover:text-accent hover:underline px-1 tabular-nums"
                        title={`Fill to remainder: ${remainder}%`}
                        onClick={() => setCatPcts(prev => ({ ...prev, [cat]: String(remainder) }))}
                      >={remainder}%</button>
                      <input
                        className="input text-right w-16 text-sm tabular-nums"
                        type="number" min="0" max="100" step="1"
                        value={catPcts[cat] ?? '0'}
                        onChange={e => setCatPcts(prev => ({ ...prev, [cat]: e.target.value }))}
                      />
                      <span className="text-xs text-gray-400 w-4">%</span>
                    </div>
                  </div>
                )
              })}
            </div>
            {!catValid && (
              <p className="text-xs text-red-500 mt-2">
                Category percentages must total 100% (currently {catTotal.toFixed(1)}%)
              </p>
            )}
          </div>

          {/* Price level split */}
          {priceLevels.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-sm font-semibold text-gray-700">Price Level Split</label>
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5 h-2 w-32 rounded-full overflow-hidden bg-gray-100">
                    {priceLevels.map((l, i) => {
                      const pct = Math.max(0, parseFloat(String(levelPcts[l.id])) || 0)
                      return <div key={l.id} style={{ width: `${pct}%`, background: `hsl(${220 + i * 30},65%,55%)` }} />
                    })}
                  </div>
                  <span className={`text-xs font-semibold tabular-nums ${levelValid ? 'text-emerald-600' : 'text-red-500'}`}>
                    {levelTotal.toFixed(0)}%{levelValid ? ' ✓' : ''}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-2">
                Weights the effective price per item for the revenue target calculation — doesn't split quantities per level
              </p>
              <div className="space-y-2">
                {priceLevels.map((l, i) => {
                  const othersLvl  = priceLevels.filter(x => x.id !== l.id).reduce((s, x) => s + (parseFloat(String(levelPcts[x.id])) || 0), 0)
                  const remainderL = Math.max(0, Math.round((100 - othersLvl) * 10) / 10)
                  return (
                    <div key={l.id} className="flex items-center gap-3">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: `hsl(${220 + i * 30},65%,55%)` }}
                      />
                      <span className="text-sm text-gray-800 flex-1">
                        {l.name}{l.is_default ? ' ★' : ''}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          className="text-xs text-gray-300 hover:text-accent hover:underline px-1 tabular-nums"
                          title={`Fill to remainder: ${remainderL}%`}
                          onClick={() => setLevelPcts(prev => ({ ...prev, [l.id]: String(remainderL) }))}
                        >={remainderL}%</button>
                        <input
                          className="input text-right w-16 text-sm tabular-nums"
                          type="number" min="0" max="100" step="1"
                          value={levelPcts[l.id] ?? '0'}
                          onChange={e => setLevelPcts(prev => ({ ...prev, [l.id]: e.target.value }))}
                        />
                        <span className="text-xs text-gray-400 w-4">%</span>
                      </div>
                    </div>
                  )
                })}
              </div>
              {!levelValid && (
                <p className="text-xs text-red-500 mt-2">
                  Price level percentages must total 100% (currently {levelTotal.toFixed(1)}%)
                </p>
              )}
            </div>
          )}

          {/* Preview results */}
          {preview && (
            <div className="border border-emerald-200 bg-emerald-50 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-emerald-700 font-semibold text-sm">✓ Generated quantities</span>
                <span className="text-xs text-emerald-600">— click Apply to load into scenario</span>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {preview.map(row => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate flex-1 min-w-0">{row.label}</span>
                    <span className="text-gray-400 text-xs mx-3">{row.price}/ptn</span>
                    <span className="font-semibold tabular-nums text-gray-900 shrink-0">
                      {row.qty.toLocaleString()} sold
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 pt-2 border-t border-emerald-200 text-xs text-emerald-700">
                Est. gross revenue: {sym}{preview.reduce((s, r) => {
                  const price = parseFloat(r.price.replace(/[^0-9.]/g, ''))
                  return s + r.qty * price
                }, 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                {' '}(target: {sym}{parseFloat(targetRevenue).toLocaleString()})
              </div>
            </div>
          )}

          {error && (
            <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">⚠ {error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {catMix.totalQty > 0 && (
              <button
                className="btn btn-sm btn-outline text-xs text-amber-600 border-amber-300 hover:bg-amber-50"
                onClick={onReset}
                title="Clear all quantities in the scenario"
              >↺ Reset Quantities</button>
            )}
            <p className="text-xs text-gray-400 hidden sm:block">
              Revenue split equally per item within each category
            </p>
          </div>
          <div className="flex gap-2 items-center">
            <button className="btn btn-sm btn-outline" onClick={onClose}>Cancel</button>
            {!preview ? (
              <button
                className="btn btn-sm btn-primary"
                disabled={!canGo || generating}
                onClick={generate}
              >
                {generating ? (
                  <><Spinner /> Calculating…</>
                ) : '⚡ Generate'}
              </button>
            ) : (
              <>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => { setPreview(null); pendingQMap.current = {} }}
                >← Adjust</button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => onGenerate(pendingQMap.current)}
                >✓ Apply to Scenario</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Scenario Tool ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  ts:     string   // ISO timestamp
  action: string   // short code e.g. 'price' | 'cost' | 'whatif' | 'reset_prices' | 'reset_costs' | 'reset_qty'
  detail: string   // human-readable description
}

interface SavedScenario {
  id:               number
  name:             string
  menu_id:          number | null
  price_level_id:   number | null
  qty_data:         Record<string, number>   // "r_{recipe_id}" | "i_{ingredient_id}[__l{level_id}]"
  price_overrides:  Record<string, number>   // USD: "${menu_item_id}_l${level_id}" → sell_price
  cost_overrides:   Record<string, number>   // USD: nat_key → cost_per_portion
  history:          HistoryEntry[]
  notes:            string | null
  updated_at:       string
  menu_name:        string | null
  price_level_name: string | null
}

interface ScenarioToolProps {
  menus:       Menu[]
  countries:   Country[]
  priceLevels: PriceLevel[]
  data:        CogsData | null
  loading:     boolean
  menuId:      number | null
  levelId:     number | '' | 'ALL'
  qty:         Record<string, string>
  refreshKey?: number
  onMenuChange(id: number | null): void
  onLevelChange(id: number | '' | 'ALL'): void
  onQtyChange(key: string, q: string): void
  onResetQty(): void
  onReplaceQty(qMap: Record<string, string>): void
  onAddItem?(): void
  onEditItem?(menuItemId: number): void
  onDeleteItem?(menuItemId: number, displayName: string): void
  onShare?(menuId: number, scenarioId: number | null): void
  onScenarioChange?(scenarioId: number | null): void
  comments?: MeChange[]
  commentsLoading?: boolean
  onAddComment?(text: string, parentId?: number, sharedPageId?: number): Promise<void>
  onClearComments?(): void
}

function ScenarioTool({
  menus, countries, priceLevels, data, loading, menuId, levelId, qty,
  onMenuChange, onLevelChange, onQtyChange, onResetQty, onReplaceQty,
  onAddItem, onEditItem, onDeleteItem, onShare, onScenarioChange,
  comments, commentsLoading, onAddComment, onClearComments,
  refreshKey = 0,
}: ScenarioToolProps) {

  const api = useApi()
  const [scToast, setScToast] = useState<{ msg: string; type?: 'error' } | null>(null)
  const showToast = (msg: string, type?: 'error') => { setScToast({ msg, type }); setTimeout(() => setScToast(null), 3000) }

  // ── Row context menu ────────────────────────────────────────────────────────
  const [rowCtx, setRowCtx] = useState<{ x: number; y: number; menuItemId: number; displayName: string } | null>(null)

  // ── Mix generator ──────────────────────────────────────────────────────────
  const [showMixGen, setShowMixGen] = useState(false)

  // ── Collapsible categories ─────────────────────────────────────────────────
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set())
  useEffect(() => { setCollapsedCats(new Set()) }, [menuId])

  // ── All-levels mode ────────────────────────────────────────────────────────
  const [allLevelsData,    setAllLevelsData]    = useState<{ level: PriceLevel; data: CogsData }[]>([])
  const [allLevelsLoading, setAllLevelsLoading] = useState(false)
  const [allLevelsCompact, setAllLevelsCompact] = useState(false) // hides Qty + Revenue columns

  useEffect(() => {
    if (levelId !== 'ALL' || !menuId) { setAllLevelsData([]); return }
    setAllLevelsLoading(true)
    Promise.all(
      priceLevels.map(async level => {
        const d: CogsData = await api.get(`/cogs/menu/${menuId}?price_level_id=${level.id}`)
        return { level, data: d }
      })
    )
    .then(results => setAllLevelsData(results))
    .catch(() => {})
    .finally(() => setAllLevelsLoading(false))
  }, [levelId, menuId, priceLevels, api, refreshKey]) // eslint-disable-line

  // ── Display currency ───────────────────────────────────────────────────────
  const [dispCurrCode, setDispCurrCode] = useState<string>('')
  useEffect(() => { setDispCurrCode('') }, [menuId])

  // ── Save / Load state ──────────────────────────────────────────────────────
  const [savedScenarios,   setSavedScenarios]   = useState<SavedScenario[]>([])
  const [loadingScenarios, setLoadingScenarios] = useState(false)
  const [savedId,          setSavedId]          = useState<number | null>(null)
  const [savedName,        setSavedName]        = useState('')

  // Notify parent whenever the active scenario changes (for shared-page matching)
  useEffect(() => { onScenarioChange?.(savedId) }, [savedId, onScenarioChange]) // eslint-disable-line
  const [dirty,            setDirty]            = useState(false)
  const [saving,           setSaving]           = useState(false)

  // Load ALL scenarios (market-agnostic) — callable on mount and on manual refresh
  const loadScenarioList = useCallback(() => {
    setLoadingScenarios(true)
    api.get('/scenarios')
      .then((rows: SavedScenario[]) => setSavedScenarios(rows || []))
      .catch(() => {})
      .finally(() => setLoadingScenarios(false))
  }, [api])

  useEffect(() => { loadScenarioList() }, [loadScenarioList])

  // Auto-load first scenario for selected menu when ME tab mounts
  const autoLoadedRef = useRef(false)
  useEffect(() => {
    if (autoLoadedRef.current || !menuId || loadingScenarios || savedScenarios.length === 0) return
    const first = savedScenarios.find(s => s.menu_id === menuId)
    if (first) {
      autoLoadedRef.current = true
      loadScenario(first) // eslint-disable-line react-hooks/exhaustive-deps
    }
  }, [menuId, loadingScenarios, savedScenarios]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mark dirty when qty changes (skip programmatic loads via dirtyRef)
  const dirtyRef = useRef(false)
  useEffect(() => {
    if (dirtyRef.current) setDirty(true)
    else dirtyRef.current = true
  }, [qty])

  // ── Price / cost overrides ─────────────────────────────────────────────────
  // Stored in display currency strings (same pattern as qty).
  // Converted to USD on save, back to display on load.
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>({})
  const [costOverrides,  setCostOverrides]  = useState<Record<string, string>>({})

  // Tracks qty keys edited manually in this session (not loaded/generated)
  const [manualQtyKeys, setManualQtyKeys] = useState<Set<string>>(new Set())

  // ── Change history + notes ─────────────────────────────────────────────────
  const [history,          setHistory]          = useState<HistoryEntry[]>([])
  const [scenarioNotes,    setScenarioNotes]    = useState('')
  const [showHistoryNotes, setShowHistoryNotes] = useState(false)

  function addHistoryEntry(action: string, detail: string) {
    setHistory(prev => [...prev, { ts: new Date().toISOString(), action, detail }])
  }

  function markDirty() { dirtyRef.current = true; setDirty(true) }

  // ── Modals ─────────────────────────────────────────────────────────────────
  const [showWhatIf,       setShowWhatIf]       = useState(false)
  const [showScenarioModal, setShowScenarioModal] = useState(false)

  // ── Reset helpers ──────────────────────────────────────────────────────────
  function resetPrices() {
    setPriceOverrides({})
    addHistoryEntry('reset_prices', 'All price overrides reset to menu prices')
    markDirty()
  }

  function resetCosts() {
    setCostOverrides({})
    addHistoryEntry('reset_costs', 'All cost overrides reset to recipe costs')
    markDirty()
  }

  // ── What If ────────────────────────────────────────────────────────────────
  function applyWhatIf(pricePct: number, costPct: number) {
    if (pricePct !== 0 && allLevelRows.length) {
      const f = 1 + pricePct / 100
      const next: Record<string, string> = {}
      for (const row of allLevelRows) {
        for (const p of row.perLevel) {
          const base = p.is_price_overridden ? (parseFloat(priceOverrides[p.price_override_key]) || p.base_price_gross) : p.base_price_gross
          if (base > 0) next[p.price_override_key] = String(Math.round(base * f * 100) / 100)
        }
      }
      setPriceOverrides(next)
      addHistoryEntry('whatif', `Prices ${pricePct > 0 ? '+' : ''}${pricePct}%`)
    }
    if (costPct !== 0 && allLevelRows.length) {
      const f = 1 + costPct / 100
      const next: Record<string, string> = {}
      for (const row of allLevelRows) {
        const base = row.is_cost_overridden ? (parseFloat(costOverrides[row.cost_override_key]) || row.base_cost_display) : row.base_cost_display
        if (base > 0) next[row.cost_override_key] = String(Math.round(base * f * 100) / 100)
      }
      setCostOverrides(next)
      addHistoryEntry('whatif', `Costs ${costPct > 0 ? '+' : ''}${costPct}%`)
    }
    markDirty()
  }

  // ── Push prices to live menu ───────────────────────────────────────────────
  async function handlePushPrices() {
    const keys = Object.keys(priceOverrides)
    if (!keys.length) return
    if (!confirm(`Push ${keys.length} price override${keys.length > 1 ? 's' : ''} to the live menu? This will overwrite current menu prices.`)) return
    try {
      const safeDispRate = dispRate || 1
      const overrides = keys.map(key => {
        const [mid, lid] = key.replace('_l', '__l').split('__l')
        return { menu_item_id: Number(mid), price_level_id: Number(lid), sell_price: (parseFloat(priceOverrides[key]) || 0) / safeDispRate }
      }).filter(o => o.sell_price > 0 && o.menu_item_id && o.price_level_id)
      await api.post('/scenarios/push-prices', { overrides })
      addHistoryEntry('push_prices', `${overrides.length} prices pushed to live menu`)
      showToast('Prices pushed to menu ✓')
    } catch (err: any) {
      alert(err.message || 'Failed to push prices')
    }
  }

  async function saveScenario(name: string, forceNew = false) {
    setSaving(true)
    const safeRate = dispRate || 1
    try {
      const toUsd = (displayVals: Record<string, string>) =>
        Object.fromEntries(Object.entries(displayVals).map(([k, v]) => [k, (parseFloat(v) || 0) / safeRate]).filter(([, v]) => (v as number) > 0))
      const payload = {
        name,
        menu_id: menuId ?? null,
        price_level_id: (levelId && levelId !== 'ALL') ? levelId : null,
        qty_data: Object.fromEntries(
          Object.entries(qty).map(([k, v]) => [k, parseFloat(v) || 0]).filter(([, v]) => (v as number) > 0)
        ),
        price_overrides: toUsd(priceOverrides),
        cost_overrides:  toUsd(costOverrides),
        history,
        notes: scenarioNotes || null,
      }
      let row: SavedScenario
      if (savedId && !forceNew) {
        row = await api.put(`/scenarios/${savedId}`, payload)
      } else {
        row = await api.post('/scenarios', payload)
      }
      setSavedId(row.id); setSavedName(row.name); setDirty(false)
      dirtyRef.current = false
      setSavedScenarios(prev => {
        const idx = prev.findIndex(s => s.id === row.id)
        return idx >= 0 ? prev.map(s => s.id === row.id ? row : s) : [row, ...prev]
      })
      setShowScenarioModal(false)
    } catch (err: any) {
      alert(err.message || 'Failed to save')
    } finally { setSaving(false) }
  }

  function loadScenario(s: SavedScenario) {
    setManualQtyKeys(new Set())
    dirtyRef.current = false
    if (s.menu_id) onMenuChange(s.menu_id)
    // Qty
    const qMap: Record<string, string> = {}
    for (const [k, v] of Object.entries(s.qty_data || {})) {
      if (Number(v) > 0) qMap[k] = String(v)
    }
    onReplaceQty(qMap)
    // Price overrides — convert from USD to display currency
    const safeRate = dispRate || 1
    const pOv: Record<string, string> = {}
    for (const [k, v] of Object.entries(s.price_overrides || {})) {
      const d = (v as number) * safeRate
      if (d > 0) pOv[k] = String(Math.round(d * 100) / 100)
    }
    setPriceOverrides(pOv)
    const cOv: Record<string, string> = {}
    for (const [k, v] of Object.entries(s.cost_overrides || {})) {
      const d = (v as number) * safeRate
      if (d > 0) cOv[k] = String(Math.round(d * 100) / 100)
    }
    setCostOverrides(cOv)
    setHistory(s.history || [])
    setScenarioNotes(s.notes || '')
    setTimeout(() => {
      setSavedId(s.id); setSavedName(s.name); setDirty(false)
      dirtyRef.current = false
    }, 0)
  }

  async function deleteScenario(id: number) {
    if (!window.confirm('Delete this saved scenario?')) return
    await api.delete(`/scenarios/${id}`)
    setSavedScenarios(prev => prev.filter(s => s.id !== id))
    if (savedId === id) { setSavedId(null); setSavedName(''); setDirty(false) }
  }

  // Currency resolution
  const menuCountry = useMemo(() => {
    const menu = menus.find(m => m.id === menuId)
    return menu ? countries.find(c => c.id === menu.country_id) ?? null : null
  }, [menus, countries, menuId])

  const marketRate = Number(menuCountry?.exchange_rate ?? 1)

  const currencyOptions = useMemo(() => {
    const seen = new Set<string>()
    const opts: { value: string; label: string; sym: string }[] = []
    if (menuCountry) {
      opts.push({ value: '', label: `${menuCountry.currency_code} ${menuCountry.currency_symbol} (market)`, sym: menuCountry.currency_symbol })
      seen.add(menuCountry.currency_code)
    }
    for (const c of countries) {
      if (!seen.has(c.currency_code)) {
        seen.add(c.currency_code)
        opts.push({ value: c.currency_code, label: `${c.currency_code} ${c.currency_symbol}`, sym: c.currency_symbol })
      }
    }
    if (!seen.has('USD')) opts.push({ value: '__BASE__', label: 'USD $ (base)', sym: '$' })
    return opts
  }, [countries, menuCountry])

  const { dispRate, dispSym } = useMemo(() => {
    if (!dispCurrCode || !menuCountry) return { dispRate: 1, dispSym: menuCountry?.currency_symbol ?? '' }
    if (dispCurrCode === '__BASE__') return { dispRate: 1 / marketRate, dispSym: '$' }
    const t = countries.find(c => c.currency_code === dispCurrCode)
    return t ? { dispRate: Number(t.exchange_rate) / marketRate, dispSym: t.currency_symbol }
             : { dispRate: 1, dispSym: menuCountry.currency_symbol }
  }, [dispCurrCode, menuCountry, marketRate, countries])

  const sym = dispSym  // alias used in column headers

  // Auto-convert overrides when display rate changes (user switches currency)
  const prevDispRateRef = useRef<number | null>(null)
  useEffect(() => {
    const prev = prevDispRateRef.current
    prevDispRateRef.current = dispRate
    if (!prev || prev === dispRate) return
    const f = dispRate / prev
    const conv = (r: Record<string, string>) => {
      const n: Record<string, string> = {}
      for (const [k, v] of Object.entries(r)) n[k] = String(Math.round(parseFloat(v) * f * 100) / 100)
      return n
    }
    if (Object.keys(priceOverrides).length) setPriceOverrides(prev => conv(prev))
    if (Object.keys(costOverrides).length)  setCostOverrides(prev => conv(prev))
  }, [dispRate]) // eslint-disable-line

  // ── Per-item scenario calculations (revenue on NET price ex-tax) ──────────

  interface ScenRow {
    menu_item_id:       number
    nat_key:            string   // "r_{recipe_id}" | "i_{ingredient_id}" — market-agnostic key
    display_name:       string
    category:           string
    item_type:          string
    cost:               number   // cost per portion (display currency, after override)
    base_cost_display:  number   // unoverridden cost (display currency)
    price_gross:        number   // sell price inc. tax (display currency, after override)
    base_price_gross:   number   // unoverridden price (display currency)
    price_net:          number   // sell price ex. tax  (display currency)
    tax_pct:            number
    qty:                number
    gross_revenue:      number   // qty × price_gross — what customer pays
    net_revenue:        number   // qty × price_net   — revenue ex-tax (basis for COGS%)
    total_cost:         number   // qty × cost
    gp:                 number   // net_revenue - total_cost
    cogs_pct:           number | null  // total_cost / net_revenue × 100
  }

  const rows = useMemo((): ScenRow[] => {
    if (!data?.items) return []
    return data.items.map(item => {
      // Natural key matches across markets — same recipe appears in all market menus
      const key          = item.item_type === 'recipe'
        ? `r_${item.recipe_id}`
        : `i_${item.ingredient_id}`
      const q            = Math.max(0, parseFloat(qty[key] || '0') || 0)
      const baseCost     = item.cost_per_portion * dispRate
      const costOvStr    = costOverrides[key]
      const cost         = costOvStr !== undefined ? (parseFloat(costOvStr) || 0) : baseCost

      const basePriceGross = item.sell_price_gross * dispRate
      const basePriceNet   = item.sell_price_net   * dispRate
      const taxRatio       = basePriceGross > 0 ? basePriceNet / basePriceGross : 1
      const priceKey       = `${item.menu_item_id}_l${typeof levelId === 'number' ? levelId : ''}`
      const priceOvStr     = priceOverrides[priceKey]
      const price_gross    = priceOvStr !== undefined ? (parseFloat(priceOvStr) || 0) : basePriceGross
      const price_net      = priceOvStr !== undefined ? price_gross * taxRatio : basePriceNet

      const gross_rev   = q * price_gross
      const net_rev     = q * price_net
      const totalCost   = q * cost
      return {
        menu_item_id:      item.menu_item_id,
        nat_key:           key,
        display_name:      item.display_name,
        category:          item.category || 'Uncategorised',
        item_type:         item.item_type,
        cost, base_cost_display: baseCost,
        price_gross, base_price_gross: basePriceGross,
        price_net,
        tax_pct:           item.tax_rate_pct,
        qty:               q,
        gross_revenue:     gross_rev,
        net_revenue:       net_rev,
        total_cost:        totalCost,
        gp:                net_rev - totalCost,
        cogs_pct:          net_rev > 0 ? (totalCost / net_rev) * 100 : null,
      }
    })
  }, [data, qty, dispRate, costOverrides, priceOverrides, levelId])

  const totalQty     = rows.reduce((s, r) => s + r.qty, 0)
  const totalGross   = rows.reduce((s, r) => s + r.gross_revenue, 0)
  const totalNet     = rows.reduce((s, r) => s + r.net_revenue, 0)
  const totalCost    = rows.reduce((s, r) => s + r.total_cost, 0)
  const totalGP      = totalNet - totalCost
  const overallCogs  = totalNet > 0 ? (totalCost / totalNet) * 100 : null

  const categorised = useMemo(() => {
    const map: Record<string, ScenRow[]> = {}
    for (const r of rows) {
      if (!map[r.category]) map[r.category] = []
      map[r.category].push(r)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [rows])

  // ── Formatters ────────────────────────────────────────────────────────────

  const fmtMoney = (n: number) =>
    `${dispSym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const fmtNum = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const fmtPct   = (n: number | null) => n != null ? `${n.toFixed(1)}%` : '—'
  const fmtMix   = (n: number, total: number) => total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '—'

  const scCogsThresholds = useCogsThresholds()
  const cogsColour = (pct: number | null) => {
    if (pct === null) return 'text-gray-300'
    if (pct <= scCogsThresholds.excellent)  return 'text-emerald-600 font-semibold'
    if (pct <= scCogsThresholds.acceptable) return 'text-amber-500 font-semibold'
    return 'text-red-500 font-semibold'
  }

  // ── All-levels rows (one row per item, prices/revenues per level) ─────────

  interface AllLevelRow {
    menu_item_id:       number
    nat_key:            string
    display_name:       string
    category:           string
    item_type:          string
    cost:               number   // display currency (may be overridden)
    base_cost_display:  number   // original recipe cost in display currency
    cost_override_key:  string   // = nat_key
    is_cost_overridden: boolean
    total_qty:          number   // sum of per-level qtys
    total_cost:         number   // total_qty × cost
    perLevel: {
      level:               PriceLevel
      qty:                 number
      qty_key:             string   // e.g. "r_1__l2"
      price_gross:         number   // display currency (may be overridden)
      price_net:           number
      base_price_gross:    number   // original menu price in display currency
      price_override_key:  string   // "${menu_item_id}_l${level_id}"
      is_price_overridden: boolean
      revenue:             number
      cogs_pct:            number | null
    }[]
  }

  const allLevelRows = useMemo((): AllLevelRow[] => {
    if (levelId !== 'ALL' || !allLevelsData.length) return []
    const baseItems = allLevelsData[0]?.data?.items ?? []
    return baseItems.map(item => {
      const natKey         = item.item_type === 'recipe' ? `r_${item.recipe_id}` : `i_${item.ingredient_id}`
      const baseCostDisp   = item.cost_per_portion * dispRate
      const costOvKey      = natKey
      const costOvVal      = costOverrides[costOvKey]
      const cost           = costOvVal !== undefined ? (parseFloat(costOvVal) || 0) : baseCostDisp
      const isCostOv       = costOvKey in costOverrides
      // Per-level qty — each level has its own qty key e.g. "r_1__l2"
      const perLevel = allLevelsData.map(({ level, data }) => {
        const li             = data.items.find(i => i.menu_item_id === item.menu_item_id)
        const qty_key        = `${natKey}__l${level.id}`   // per-level key
        const q              = Math.max(0, parseFloat(qty[qty_key] || '0') || 0)
        const basePriceGross = (li?.sell_price_gross ?? 0) * dispRate
        const basePriceNet   = (li?.sell_price_net   ?? 0) * dispRate
        const taxRatio       = basePriceGross > 0 ? basePriceNet / basePriceGross : 1
        const priceOvKey     = `${item.menu_item_id}_l${level.id}`
        const priceOvVal     = priceOverrides[priceOvKey]
        const price_gross    = priceOvVal !== undefined ? (parseFloat(priceOvVal) || 0) : basePriceGross
        const price_net      = priceOvVal !== undefined ? price_gross * taxRatio        : basePriceNet
        const revenue        = q * price_net
        return {
          level, qty: q, qty_key,
          price_gross, price_net, base_price_gross: basePriceGross,
          price_override_key: priceOvKey, is_price_overridden: priceOvKey in priceOverrides,
          revenue,
          cogs_pct: revenue > 0 ? (q * cost / revenue) * 100 : null,
        }
      })
      // total_qty / total_cost sum across all levels (each level may have different qty)
      const total_qty  = perLevel.reduce((s, p) => s + p.qty, 0)
      const total_cost = perLevel.reduce((s, p) => s + p.qty * cost, 0)
      return {
        menu_item_id: item.menu_item_id,
        nat_key:      natKey,
        display_name: item.display_name,
        category:     item.category || 'Uncategorised',
        item_type:    item.item_type,
        cost, base_cost_display: baseCostDisp,
        cost_override_key: costOvKey, is_cost_overridden: isCostOv,
        total_qty, total_cost,
        perLevel,
      }
    })
  }, [levelId, allLevelsData, qty, dispRate, priceOverrides, costOverrides])

  const allLevelCategorised = useMemo(() => {
    const map: Record<string, AllLevelRow[]> = {}
    for (const r of allLevelRows) {
      if (!map[r.category]) map[r.category] = []
      map[r.category].push(r)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [allLevelRows])

  // ── Category collapse helpers ─────────────────────────────────────────────
  const allCats = useMemo(() => {
    const src = levelId === 'ALL' ? allLevelCategorised : categorised
    return src.map(([cat]) => cat)
  }, [levelId, allLevelCategorised, categorised])

  const allCollapsed = allCats.length > 0 && allCats.every(c => collapsedCats.has(c))

  function toggleCat(cat: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat); else next.add(cat)
      return next
    })
  }

  function toggleAllCats() {
    setCollapsedCats(allCollapsed ? new Set() : new Set(allCats))
  }

  // ── Export helpers ────────────────────────────────────────────────────────

  const menuName  = menus.find(m => m.id === menuId)?.name ?? 'Scenario'
  const levelName = levelId === 'ALL'
    ? 'All levels'
    : (priceLevels.find(l => l.id === levelId)?.name ?? 'No level')

  // Excel Export — SpreadsheetML with live formulas (no external deps) ─────────
  //
  //  Yellow cells = editable inputs (Cost/ptn, Price Gross, Qty Sold)
  //  Blue cells   = formula cells  (Price Net, Revenue, Mix%, Total Cost, COGS%)
  //
  //  ALL levels mode: one worksheet per price level in the same workbook.

  function exportExcel() {
    // ── XML / SpreadsheetML helpers ─────────────────────────────────────────
    const esc = (s: string) =>
      String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
    // SpreadsheetML uses R1C1 notation, NOT A1 (A1 causes #NAME? errors)
    const rAbs   = (row: number, col: number) => `R${row}C${col}` // absolute ref
    const rRange = (r1: number, r2: number)   => `R${r1}C:R${r2}C` // same-col range

    const cStr  = (st: string, v: string)  => `<Cell ss:StyleID="${st}"><Data ss:Type="String">${esc(v)}</Data></Cell>`
    const cNum  = (st: string, v: number)  => `<Cell ss:StyleID="${st}"><Data ss:Type="Number">${v}</Data></Cell>`
    const cFml  = (st: string, f: string)  => `<Cell ss:StyleID="${st}" ss:Formula="${esc('=' + f)}"><Data ss:Type="Number">0</Data></Cell>`
    const cBlnk = (st: string)             => `<Cell ss:StyleID="${st}"/>`
    const cMrg  = (st: string, span: number, v: string) =>
      `<Cell ss:StyleID="${st}" ss:MergeAcross="${span - 1}"><Data ss:Type="String">${esc(v)}</Data></Cell>`
    const row   = (...cells: string[])             => `<Row>${cells.join('')}</Row>`
    const rowH  = (h: number, ...cells: string[])  => `<Row ss:Height="${h}">${cells.join('')}</Row>`

    // ── Shared styles ───────────────────────────────────────────────────────
    const STYLES = `<Styles>
      <Style ss:ID="s0"/>
      <Style ss:ID="s_title"><Font ss:Bold="1" ss:Size="13" ss:Color="#146A34"/></Style>
      <Style ss:ID="s_sub"><Font ss:Size="9" ss:Color="#888888"/></Style>
      <Style ss:ID="s_ly"><Font ss:Italic="1" ss:Size="8" ss:Color="#7B5800"/><Interior ss:Color="#FFFDE7" ss:Pattern="Solid"/></Style>
      <Style ss:ID="s_lb"><Font ss:Italic="1" ss:Size="8" ss:Color="#1565C0"/><Interior ss:Color="#E3F2FD" ss:Pattern="Solid"/></Style>
      <Style ss:ID="s_hl"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="9"/><Interior ss:Color="#146A34" ss:Pattern="Solid"/><Alignment ss:Horizontal="Left"/></Style>
      <Style ss:ID="s_hc"><Font ss:Bold="1" ss:Color="#FFFFFF" ss:Size="8"/><Interior ss:Color="#146A34" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:WrapText="1"/></Style>
      <Style ss:ID="s_sp"><NumberFormat ss:Format="0.0%"/></Style>
      <Style ss:ID="s_en"><Interior ss:Color="#FFFDE7" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/></Style>
      <Style ss:ID="s_ei"><Interior ss:Color="#FFFDE7" ss:Pattern="Solid"/><NumberFormat ss:Format="0"/></Style>
      <Style ss:ID="s_fn"><Interior ss:Color="#E3F2FD" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/></Style>
      <Style ss:ID="s_fp"><Interior ss:Color="#E3F2FD" ss:Pattern="Solid"/><NumberFormat ss:Format="0.0%"/></Style>
      <Style ss:ID="s_tt"><Font ss:Bold="1"/><Interior ss:Color="#E8E8E8" ss:Pattern="Solid"/></Style>
      <Style ss:ID="s_tn"><Font ss:Bold="1"/><Interior ss:Color="#E8E8E8" ss:Pattern="Solid"/><NumberFormat ss:Format="#,##0.00"/></Style>
      <Style ss:ID="s_ti"><Font ss:Bold="1"/><Interior ss:Color="#E8E8E8" ss:Pattern="Solid"/><NumberFormat ss:Format="0"/></Style>
      <Style ss:ID="s_tp"><Font ss:Bold="1"/><Interior ss:Color="#E8E8E8" ss:Pattern="Solid"/><NumberFormat ss:Format="0.0%"/></Style>
    </Styles>`

    // ── Worksheet builder ───────────────────────────────────────────────────
    interface XRow { display_name: string; category: string; item_type: string; tax_pct: number; cost: number; price_gross: number; qty: number }

    function buildSheet(wsName: string, items: XRow[], currSym: string, lvlName: string): string {
      if (!items.length) return ''
      // R1C1 column numbers (1-based): A=1, B=2, C=3, D=4, E=5, F=6, G=7, H=8, I=9, J=10, K=11, L=12, M=13
      // Col offsets (relative to each formula cell) are hardcoded as comments below.
      const NCOLS  = 13
      const DFIRST = 6              // first data row (rows 1–5 are header)
      const N      = items.length
      const DLAST  = DFIRST + N - 1
      const GRAND  = DFIRST + N    // grand-total row

      const sorted = [...items].sort((a,b) => a.category.localeCompare(b.category) || a.display_name.localeCompare(b.display_name))

      let xml = ''
      // Row 1: title
      xml += row(cMrg('s_title', NCOLS, `${menuName} — ${lvlName}`))
      // Row 2: subtitle
      xml += row(cMrg('s_sub', NCOLS, `Currency: ${currSym} · Generated: ${new Date().toLocaleDateString()}`))
      // Row 3: colour legend (split across columns A–G and H–M)
      xml += row(
        cMrg('s_ly', 7, '✏  Yellow cells are editable inputs — change Cost/ptn, Price Gross and Qty to model scenarios'),
        cMrg('s_lb', NCOLS - 7, '🔢  Blue cells contain formulas — they recalculate automatically when you edit yellow cells')
      )
      // Row 4: spacer
      xml += `<Row ss:Height="6"/>`
      // Row 5: column headers
      xml += rowH(40,
        cStr('s_hl', 'Item'),
        cStr('s_hc', 'Category'),
        cStr('s_hc', 'Type'),
        cStr('s_hc', 'Tax\nRate'),
        cStr('s_hc', `Cost/ptn\n(${currSym})\n✏`),
        cStr('s_hc', `Price Gross\n(${currSym})\n✏`),
        cStr('s_hc', `Price Net\n(${currSym})\n=`),
        cStr('s_hc', 'Qty\nSold\n✏'),
        cStr('s_hc', 'Sales\nMix%\n='),
        cStr('s_hc', `Revenue\nNet (${currSym})\n=`),
        cStr('s_hc', 'Rev\nMix%\n='),
        cStr('s_hc', `Total\nCost (${currSym})\n=`),
        cStr('s_hc', 'COGS%\n=')
      )

      // Data rows — R1C1 column offsets relative to each formula cell:
      //   G(7): F=RC[-1], D=RC[-3]
      //   I(9): H=RC[-1], H_GRAND=R{GRAND}C8
      //   J(10): G=RC[-3], H=RC[-2]
      //   K(11): J=RC[-1], J_GRAND=R{GRAND}C10
      //   L(12): E=RC[-7], H=RC[-4]
      //   M(13): J=RC[-3], L=RC[-1]
      sorted.forEach((item) => {
        xml += row(
          cStr('s0',  item.display_name),
          cStr('s0',  item.category),
          cStr('s0',  item.item_type),
          cNum('s_sp', item.tax_pct / 100),                                        // D: tax rate decimal (shown as %)
          cNum('s_en', item.cost),                                                 // E: cost/ptn ✏
          cNum('s_en', item.price_gross),                                          // F: price gross ✏
          cFml('s_fn', `RC[-1]/(1+RC[-3])`),                                      // G: price net = F/(1+D)
          cNum('s_ei', item.qty),                                                  // H: qty ✏
          cFml('s_fp', `IF(${rAbs(GRAND,8)}>0,RC[-1]/${rAbs(GRAND,8)},0)`),      // I: sales mix%  H/H_grand
          cFml('s_fn', `RC[-3]*RC[-2]`),                                          // J: revenue = G*H
          cFml('s_fp', `IF(${rAbs(GRAND,10)}>0,RC[-1]/${rAbs(GRAND,10)},0)`),    // K: rev mix%  J/J_grand
          cFml('s_fn', `RC[-7]*RC[-4]`),                                          // L: total cost = E*H
          cFml('s_fp', `IF(RC[-3]>0,RC[-1]/RC[-3],0)`)                           // M: COGS% = L/J
        )
      })

      // Grand-total row — SUM uses R1C1 column-locked range (C = current column)
      xml += row(
        cStr('s_tt', 'Grand Total'),
        cBlnk('s_tt'), cBlnk('s_tt'), cBlnk('s_tt'), cBlnk('s_tt'), cBlnk('s_tt'), cBlnk('s_tt'),
        cFml('s_ti', `SUM(${rRange(DFIRST,DLAST)})`),  // H: total qty
        cStr('s_tt', '100%'),
        cFml('s_tn', `SUM(${rRange(DFIRST,DLAST)})`),  // J: total revenue
        cStr('s_tt', '100%'),
        cFml('s_tn', `SUM(${rRange(DFIRST,DLAST)})`),  // L: total cost
        cFml('s_tp', `IF(RC[-3]>0,RC[-1]/RC[-3],0)`)   // M: COGS% = L_grand/J_grand
      )

      // KPI summary strip
      xml += `<Row ss:Height="8"/><Row ss:Height="8"/>`
      xml += row(
        cStr('s_tt', 'Total Covers'),  cFml('s_ti', rAbs(GRAND,8)),
        cStr('s_tt', 'Revenue (net)'), cFml('s_tn', rAbs(GRAND,10)),
        cStr('s_tt', 'Total Cost'),    cFml('s_tn', rAbs(GRAND,12)),
        cStr('s_tt', 'Gross Profit'),  cFml('s_tn', `${rAbs(GRAND,10)}-${rAbs(GRAND,12)}`),
        cStr('s_tt', 'Overall COGS%'), cFml('s_tp', rAbs(GRAND,13))
      )

      const colW = [180, 90, 60, 55, 85, 90, 85, 60, 68, 100, 68, 90, 65]
        .map(w => `<Column ss:Width="${w}"/>`).join('')

      return `<Worksheet ss:Name="${esc(wsName.slice(0, 31))}"><Table>${colW}${xml}</Table></Worksheet>`
    }

    // ── Build workbook ───────────────────────────────────────────────────────
    let sheets = ''

    if (levelId === 'ALL' && allLevelRows.length) {
      sheets = allLevelsData.map(({ level }, k) =>
        buildSheet(
          level.name,
          allLevelRows.map(r => {
            const pl      = r.perLevel[k]
            const taxFrac = pl.price_gross > 0 && pl.price_net > 0
              ? pl.price_gross / pl.price_net - 1
              : 0
            return { display_name: r.display_name, category: r.category, item_type: r.item_type,
                     tax_pct: taxFrac * 100, cost: r.cost, price_gross: pl.price_gross, qty: pl.qty }
          }),
          dispSym, level.name
        )
      ).join('')
    } else if (rows.length) {
      sheets = buildSheet(
        `${menuName} ${levelName}`.slice(0, 31),
        rows.map(r => ({ display_name: r.display_name, category: r.category, item_type: r.item_type,
                         tax_pct: r.tax_pct, cost: r.cost, price_gross: r.price_gross, qty: r.qty })),
        dispSym, levelName
      )
    }

    if (!sheets) { showToast('No data to export', 'error'); return }

    const workbook = `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>\n<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" xmlns:x="urn:schemas-microsoft-com:office:excel">\n${STYLES}\n${sheets}\n</Workbook>`

    const blob = new Blob([workbook], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${menuName.replace(/[^a-z0-9]/gi, '_')}_scenario.xls`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(a.href)
  }

  // Print — opens a clean styled window and triggers print dialog ─────────────

  function handlePrint() {
    const win = window.open('', '_blank', 'width=1050,height=750')
    if (!win) return
    const kpiHtml = hasQty ? `
      <div class="kpi-strip">
        ${[['Total Covers', totalQty.toLocaleString()], ['Revenue (gross)', fmtMoney(totalGross)], ['Revenue (ex-tax)', fmtMoney(totalNet)], ['Total Cost', fmtMoney(totalCost)], ['GP (net)', fmtMoney(totalGP)], ['Overall COGS%', fmtPct(overallCogs)]].map(([l, v]) => `<div class="kpi"><div class="kpi-l">${l}</div><div class="kpi-v">${v}</div></div>`).join('')}
      </div>` : ''

    let tableHtml = ''
    if (levelId === 'ALL' && allLevelRows.length) {
      const lh = allLevelsData.map(({ level }) => `<th colspan="4">${level.name}</th>`).join('')
      const ls = allLevelsData.map(() => `<th>Qty</th><th>Price</th><th>Revenue (net)</th><th>COGS%</th>`).join('')
      let tbody = ''
      for (const [cat, catRows] of allLevelCategorised) {
        const catCols = 2 + allLevelsData.length * 4 + 1
        tbody += `<tr class="cat"><td colspan="${catCols}">${cat}</td></tr>`
        for (const r of catRows) {
          const totalRev = r.perLevel.reduce((s, p) => s + p.revenue, 0)
          const totalCogsPct = totalRev > 0 ? (r.total_cost / totalRev) * 100 : null
          const lvlCells = r.perLevel.map(p =>
            `<td>${p.qty > 0 ? p.qty : ''}</td><td>${p.price_gross > 0 ? fmtMoney(p.price_gross) : ''}</td><td>${p.revenue > 0 ? fmtMoney(p.revenue) : ''}</td><td class="cogs">${fmtPct(p.cogs_pct)}</td>`
          ).join('')
          tbody += `<tr><td class="indent">${r.display_name}</td><td>${r.cost > 0 ? fmtMoney(r.cost) : ''}</td>${lvlCells}<td class="cogs">${fmtPct(totalCogsPct)}</td></tr>`
        }
      }
      tableHtml = `<table><thead><tr><th rowspan="2">Item</th><th rowspan="2">Cost/ptn</th>${lh}<th rowspan="2">Total COGS%</th></tr><tr>${ls}</tr></thead><tbody>${tbody}</tbody></table>`
    } else {
      let tbody = ''
      for (const [cat, catRows] of categorised) {
        const cQ = catRows.reduce((s, r) => s + r.qty, 0), cR = catRows.reduce((s, r) => s + r.net_revenue, 0), cC = catRows.reduce((s, r) => s + r.total_cost, 0)
        const cP = cR > 0 ? (cC / cR) * 100 : null
        tbody += `<tr class="cat"><td colspan="4">${cat}</td><td>${cQ > 0 ? cQ : ''}</td><td>${cQ > 0 ? fmtMix(cQ, totalQty) : ''}</td><td>${cR > 0 ? fmtMoney(cR) : ''}</td><td>${cR > 0 ? fmtMix(cR, totalNet) : ''}</td><td>${cC > 0 ? fmtMoney(cC) : ''}</td><td class="cogs">${fmtPct(cP)}</td></tr>`
        for (const r of catRows) {
          tbody += `<tr><td class="indent">${r.display_name}</td><td>${r.item_type}</td><td>${fmtMoney(r.cost)}</td><td>${r.price_gross > 0 ? fmtMoney(r.price_gross) : ''}</td><td>${r.qty > 0 ? r.qty : ''}</td><td>${r.qty > 0 ? fmtMix(r.qty, totalQty) : ''}</td><td>${r.net_revenue > 0 ? fmtMoney(r.net_revenue) : ''}</td><td>${r.net_revenue > 0 ? fmtMix(r.net_revenue, totalNet) : ''}</td><td>${r.total_cost > 0 ? fmtMoney(r.total_cost) : ''}</td><td class="cogs">${fmtPct(r.cogs_pct)}</td></tr>`
        }
      }
      tableHtml = `<table><thead><tr><th>Item</th><th>Type</th><th>Cost/ptn</th><th>Price (gross)</th><th>Qty Sold</th><th>Sales Mix%</th><th>Revenue (net)</th><th>Rev Mix%</th><th>Total Cost</th><th>COGS%</th></tr></thead><tbody>${tbody}</tbody><tfoot><tr class="total"><td colspan="4">Grand Total</td><td>${totalQty}</td><td>100%</td><td>${fmtMoney(totalNet)}</td><td>100%</td><td>${fmtMoney(totalCost)}</td><td class="cogs">${fmtPct(overallCogs)}</td></tr></tfoot></table>`
    }

    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${menuName} Sales Scenario</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;font-size:11px;color:#111;padding:20px}
  h1{font-size:15px;color:#146A34;margin-bottom:3px}
  .meta{font-size:10px;color:#888;margin-bottom:14px}
  .kpi-strip{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}
  .kpi{background:#f7f9f8;border:1px solid #d8e6dd;padding:7px 12px;border-radius:6px;min-width:110px}
  .kpi-l{font-size:9px;color:#888;margin-bottom:1px}
  .kpi-v{font-size:14px;font-weight:700;color:#0f1f17}
  table{width:100%;border-collapse:collapse;font-size:10px}
  th{background:#146A34;color:#fff;padding:5px 6px;text-align:right;white-space:nowrap;font-size:9px}
  th:first-child{text-align:left}
  td{padding:3px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap}
  td:first-child,td.indent{text-align:left}
  td.indent{padding-left:14px}
  tr.cat td{background:#e8f5ed;font-weight:700;color:#146A34;text-align:left}
  tr.total td{background:#f0f0f0;font-weight:700;border-top:2px solid #999}
  .cogs{font-weight:700}
  .btn{margin-top:16px;padding:8px 16px;background:#146A34;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;margin-right:8px}
  @media print{.btn{display:none}body{padding:10px}}
</style></head><body>
<h1>📊 ${menuName} — ${levelName}</h1>
<div class="meta">Currency: ${dispSym} · Generated: ${new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}</div>
${kpiHtml}
${tableHtml}
<div style="margin-top:16px">
  <button class="btn" onclick="window.print()">🖨 Print</button>
  <button class="btn" style="background:#1e8a44" onclick="window.close()">✕ Close</button>
</div>
</body></html>`)
    win.document.close()
    win.focus()
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const hasQty = rows.some(r => r.qty > 0)

  return (
    <div className="flex-1 overflow-auto p-6">
      {scToast && <Toast message={scToast.msg} type={scToast.type === 'error' ? 'error' : 'success'} onClose={() => setScToast(null)} />}
      <div className="bg-white rounded-lg border border-gray-200">

        {/* Toolbar — row 1: selectors */}
        <div className="px-4 pt-4 pb-2 border-b border-gray-100 flex flex-wrap gap-3 items-center">
          <span className="font-semibold text-gray-700 text-sm shrink-0">📊 Scenario</span>

          {/* Scenario picker — before menu */}
          <div className="flex items-center gap-1.5">
            <button
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium
                ${savedId ? 'border-accent bg-accent-dim text-accent' : 'border-gray-200 bg-white text-gray-600'} hover:border-accent`}
              onClick={() => setShowScenarioModal(true)}
              disabled={loadingScenarios}
            >
              <span className="truncate max-w-[200px]">{savedName || '— New scenario —'}</span>
              {dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />}
              <span className="text-gray-400 text-xs">▾</span>
            </button>
            <button
              className="btn btn-sm btn-primary text-xs"
              onClick={() => setShowScenarioModal(true)}
              title="Save or update scenario"
            >💾 {savedId ? 'Update' : 'Save'}</button>
          </div>

          {/* Menu */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Menu</span>
            <select
              className="select select-sm min-w-[200px]"
              value={menuId ?? ''}
              onChange={e => onMenuChange(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">— Select menu —</option>
              {menus.map(m => <option key={m.id} value={m.id}>{m.name} ({m.country_name})</option>)}
            </select>
          </div>

          {/* Price level */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Level</span>
            <select
              className="select select-sm"
              value={levelId}
              onChange={e => {
                const v = e.target.value
                if (v === 'ALL') onLevelChange('ALL')
                else if (v) onLevelChange(Number(v))
                else onLevelChange('')
              }}
            >
              <option value="">— No level —</option>
              {priceLevels.length > 1 && <option value="ALL">📊 All levels</option>}
              {priceLevels.map(l => <option key={l.id} value={l.id}>{l.name}{l.is_default ? ' ★' : ''}</option>)}
            </select>
          </div>

          {/* Display currency */}
          {menuCountry && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">Display</span>
              <select
                className="select select-sm"
                value={dispCurrCode}
                onChange={e => setDispCurrCode(e.target.value)}
              >
                {currencyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {/* Compact + Excel / Print / Share — aligned right in the selector row */}
          {(levelId === 'ALL' || !!data) && (
            <div className="flex items-center gap-1.5 ml-auto">
              <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
                {levelId === 'ALL' && (
                  <button
                    className={`px-2.5 py-1.5 text-xs border-r border-gray-200 hover:bg-gray-50 ${allLevelsCompact ? 'bg-accent text-white hover:bg-accent' : ''}`}
                    onClick={() => setAllLevelsCompact(v => !v)}
                    title={allLevelsCompact ? 'Expand all levels' : 'Compact all levels'}
                  >{allLevelsCompact ? '⊞ Expand' : '⊟ Compact'}</button>
                )}
                {(data || (levelId === 'ALL' && allLevelRows.length > 0)) && (
                  <>
                    <button className="px-2.5 py-1.5 text-xs hover:bg-gray-50 border-r border-gray-200" onClick={exportExcel}>📊 Excel</button>
                    <button className="px-2.5 py-1.5 text-xs hover:bg-gray-50" onClick={handlePrint}>🖨 Print</button>
                  </>
                )}
              </div>
              {onShare && menuId && (
                <button
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50"
                  title="Create a shared link for this menu / scenario"
                  onClick={() => onShare(menuId, savedId)}
                >🔗 Share</button>
              )}
            </div>
          )}
        </div>

        {/* Toolbar — row 2: scenario picker + actions */}
        <div className="px-4 py-2 border-b border-gray-100 flex flex-wrap gap-1.5 items-center">

          {/* Mix Manager — first on this row */}
          {menuId && (
            <button className="btn btn-sm btn-primary text-xs" onClick={() => setShowMixGen(true)} title="Auto-generate quantities from a revenue target">⚡ Mix Manager</button>
          )}

          {/* What If */}
          {menuId && (
            <button className="btn btn-sm btn-outline text-xs" title="Model price/cost changes" onClick={() => setShowWhatIf(true)}>⚡ What If</button>
          )}

          {/* Override reset buttons */}
          {Object.keys(priceOverrides).length > 0 && (
            <button className="btn btn-sm btn-outline text-xs text-amber-600 border-amber-300 hover:bg-amber-50" title="Reset all price overrides to menu prices" onClick={resetPrices}>↺ Prices</button>
          )}
          {Object.keys(costOverrides).length > 0 && (
            <button className="btn btn-sm btn-outline text-xs text-amber-600 border-amber-300 hover:bg-amber-50" title="Reset all cost overrides to recipe costs" onClick={resetCosts}>↺ Costs</button>
          )}

          {/* Push prices to live menu — always visible when a menu is loaded */}
          {menuId && (
            <button
              className={`btn btn-sm btn-outline text-xs ${Object.keys(priceOverrides).length > 0 ? 'text-accent border-accent' : 'text-gray-300 border-gray-200 cursor-default'}`}
              title={Object.keys(priceOverrides).length > 0 ? 'Write scenario price overrides to the live menu' : 'No price differences — scenario matches live menu'}
              onClick={handlePushPrices}
            >
              → Menu
            </button>
          )}

          {/* Notes, History & Comments */}
          <button
            className={`btn btn-sm btn-ghost text-xs ${scenarioNotes || history.length > 0 || (comments && comments.length > 0) ? 'text-gray-600' : 'text-gray-400'}`}
            title="Notes, change history & comments"
            onClick={() => setShowHistoryNotes(true)}
          >
            📋 Notes
            {(history.length > 0 || (comments && comments.length > 0)) && (
              <span className="ml-1 text-[10px] text-gray-400">
                ({history.length + (comments?.length ?? 0)})
              </span>
            )}
          </button>

          {/* Add Item — far right */}
          {menuId && onAddItem && (
            <button className="btn btn-sm btn-primary text-xs ml-auto" onClick={onAddItem} title="Add a recipe or ingredient to this menu">+ Add Item</button>
          )}
        </div>

        {/* ── Scenario Modal ─────────────────────────────────────────────── */}
        {showScenarioModal && (
          <ScenarioModal
            scenarios={savedScenarios}
            loading={loadingScenarios}
            saving={saving}
            currentId={savedId}
            currentName={savedName}
            onLoad={s => { loadScenario(s); setShowScenarioModal(false) }}
            onDelete={deleteScenario}
            onSave={saveScenario}
            onNew={name => {
              onReplaceQty({})
              setPriceOverrides({})
              setCostOverrides({})
              setHistory([])
              setScenarioNotes('')
              onMenuChange(null)
              setSavedId(null)
              setSavedName(name)
              setDirty(false)
              dirtyRef.current = false
              setShowScenarioModal(false)
            }}
            onClose={() => setShowScenarioModal(false)}
          />
        )}

        {/* ── What If Modal ──────────────────────────────────────────────── */}
        {showWhatIf && (
          <WhatIfModal
            onApply={(pricePct, costPct) => { applyWhatIf(pricePct, costPct); setShowWhatIf(false) }}
            onClose={() => setShowWhatIf(false)}
          />
        )}

        {/* ── Notes & History Modal ──────────────────────────────────────── */}
        {showHistoryNotes && (
          <HistoryNotesModal
            entries={history}
            notes={scenarioNotes}
            onNotesChange={n => { setScenarioNotes(n); markDirty() }}
            onClear={() => { setHistory([]); markDirty() }}
            onClose={() => setShowHistoryNotes(false)}
            comments={comments}
            commentsLoading={commentsLoading}
            onAddComment={onAddComment}
            onClearComments={onClearComments}
          />
        )}

        {/* Mix generator modal */}
        {showMixGen && menuId && (data || allLevelsData.length > 0) && (
          <SalesMixGeneratorModal
            data={data ?? allLevelsData[0]?.data!}
            priceLevels={priceLevels}
            menuId={menuId}
            currencySymbol={dispSym || menuCountry?.currency_symbol || ''}
            currentQty={qty}
            onGenerate={qMap => {
              setManualQtyKeys(new Set())
              onReplaceQty(qMap)
              dirtyRef.current = true
              setDirty(true)
              setShowMixGen(false)
            }}
            onReset={() => {
              setManualQtyKeys(new Set())
              onResetQty()
              addHistoryEntry('reset_qty', 'Quantities reset')
              markDirty()
            }}
            onClose={() => setShowMixGen(false)}
          />
        )}

        {/* ── Row context menu ──────────────────────────────────────────── */}
        {rowCtx && createPortal(
          <>
            <div className="fixed inset-0 z-[9998]" onClick={() => setRowCtx(null)} />
            <div
              className="fixed z-[9999] bg-white rounded-xl shadow-xl border border-gray-200 py-1.5 min-w-[160px]"
              style={{ top: Math.min(rowCtx.y, window.innerHeight - 120), left: Math.min(rowCtx.x, window.innerWidth - 180) }}
            >
              <div className="px-3 py-1.5 border-b border-gray-100 mb-1">
                <p className="text-xs font-semibold text-gray-800 truncate max-w-[140px]">{rowCtx.displayName}</p>
              </div>
              {onEditItem && (
                <button
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                  onClick={() => { onEditItem(rowCtx.menuItemId); setRowCtx(null) }}
                >✏️ Edit item</button>
              )}
              {onDeleteItem && (
                <button
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                  onClick={() => { onDeleteItem(rowCtx.menuItemId, rowCtx.displayName); setRowCtx(null) }}
                >🗑 Remove from menu</button>
              )}
            </div>
          </>,
          document.body
        )}

        {/* KPI Strip */}
        {data && (
          <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-2 sm:grid-cols-6 gap-3">
            {[
              { label: 'Total Covers',          value: totalQty > 0 ? totalQty.toLocaleString() : '—',  cls: 'text-gray-900' },
              { label: 'Revenue (gross)',        value: hasQty ? fmtMoney(totalGross) : '—',             cls: 'text-blue-500' },
              { label: 'Revenue (ex-tax)',       value: hasQty ? fmtMoney(totalNet) : '—',               cls: 'text-blue-700' },
              { label: 'Total Cost',             value: hasQty ? fmtMoney(totalCost) : '—',              cls: 'text-gray-700' },
              { label: 'GP (net)',               value: hasQty ? fmtMoney(totalGP) : '—',                cls: totalGP >= 0 ? 'text-emerald-600' : 'text-red-600' },
              { label: 'Overall COGS %',         value: hasQty ? fmtPct(overallCogs) : '—',              cls: cogsColour(overallCogs) },
            ].map(kpi => (
              <div key={kpi.label} className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                <div className="text-xs text-gray-400 mb-0.5">{kpi.label}</div>
                <div className={`text-xl font-bold font-mono ${kpi.cls}`}>{kpi.value}</div>
              </div>
            ))}
          </div>
        )}

        {!menuId && (
          <div className="p-16 text-center text-sm text-gray-400">
            <div className="text-3xl mb-3">📊</div>
            <p className="font-medium text-gray-500 mb-1">Sales Mix Scenario</p>
            <p>Select a menu and price level above, then enter sales quantities to model your COGS and revenue.</p>
          </div>
        )}
        {menuId && !levelId && (
          <div className="px-4 py-2.5 bg-yellow-50 text-yellow-700 text-xs border-b border-yellow-100">
            Select a price level above to see sell prices and revenue calculations.
          </div>
        )}
        {menuId && (loading || (levelId === 'ALL' && allLevelsLoading)) && (
          <div className="p-12 text-center"><Spinner /></div>
        )}

        {menuId && !loading && data && data.items.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-400">No items in this menu.</div>
        )}

        {menuId && !loading && data && data.items.length > 0 && (
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 'calc(100vh - 320px)' }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-gray-200 border-b border-gray-300 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-500 bg-gray-200">
                    <div className="flex items-center gap-2">
                      Item
                      {allCats.length > 1 && (
                        <button
                          onClick={toggleAllCats}
                          className="text-[10px] font-normal text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 leading-none"
                          title={allCollapsed ? 'Expand all categories' : 'Collapse all categories'}
                        >
                          {allCollapsed ? '▶ All' : '▼ All'}
                        </button>
                      )}
                    </div>
                  </th>
                  <th className="px-3 py-2.5 text-left font-semibold text-gray-500 bg-gray-200">Type</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 min-w-[90px] bg-gray-200">Qty Sold</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 whitespace-nowrap bg-gray-200">Cost/ptn{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 whitespace-nowrap bg-gray-200">Price{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 bg-gray-200">Sales Mix</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 whitespace-nowrap bg-gray-200">Revenue{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 bg-gray-200">Rev Mix</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 whitespace-nowrap bg-gray-200">Cost{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                  <th className="px-3 py-2.5 text-right font-semibold text-gray-500 bg-gray-200">COGS %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {categorised.map(([cat, catRows]) => {
                  const cQ = catRows.reduce((s, r) => s + r.qty, 0)
                  const cR = catRows.reduce((s, r) => s + r.net_revenue, 0)
                  const cC = catRows.reduce((s, r) => s + r.total_cost, 0)
                  const cP = cR > 0 ? (cC / cR) * 100 : null
                  return (
                    <>
                      {/* ── Category header row ── */}
                      <tr key={`cat-${cat}`}
                        className="border-y cursor-pointer select-none transition-colors"
                        style={{ background: 'var(--accent-dim)', borderColor: 'var(--border)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = '#d4eddc')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'var(--accent-dim)')}
                        onClick={() => toggleCat(cat)}
                      >
                        <td className="px-3 py-1.5 font-bold text-xs uppercase tracking-wide" colSpan={2}
                          style={{ color: 'var(--accent-dark)' }}>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-[9px] w-2.5 shrink-0" style={{ color: 'var(--accent)' }}>{collapsedCats.has(cat) ? '▶' : '▼'}</span>
                            {cat}
                            {collapsedCats.has(cat) && (
                              <span className="text-[10px] font-normal text-gray-400 ml-1">({catRows.length} item{catRows.length !== 1 ? 's' : ''} hidden)</span>
                            )}
                          </span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-xs" style={{ color: 'var(--accent-dark)' }}>
                          {cQ > 0 ? cQ.toLocaleString() : '—'}
                        </td>
                        <td colSpan={2} />
                        <td className="px-3 py-1.5 text-right text-xs" style={{ color: 'var(--text-3)' }}>{fmtMix(cQ, totalQty)}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-xs" style={{ color: 'var(--accent-dark)' }}>
                          {cR > 0 ? fmtNum(cR) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right text-xs" style={{ color: 'var(--text-3)' }}>{cR > 0 ? fmtMix(cR, totalNet) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono font-semibold text-xs" style={{ color: 'var(--accent-dark)' }}>
                          {cC > 0 ? fmtMoney(cC) : '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right text-xs ${cogsColour(cP)}`}>{fmtPct(cP)}</td>
                      </tr>

                      {/* ── Item rows ── */}
                      {!collapsedCats.has(cat) && catRows.map(row => (
                        <tr
                          key={row.menu_item_id}
                          className="hover:bg-gray-50/80"
                          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setRowCtx({ x: e.clientX, y: e.clientY, menuItemId: row.menu_item_id, displayName: row.display_name }) }}
                        >
                          <td className="px-3 py-2.5 font-medium text-gray-900 pl-6">{row.display_name}</td>
                          <td className="px-3 py-2.5">
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded capitalize">{row.item_type}</span>
                          </td>
                          {/* Qty — moved before Cost/ptn */}
                          <td className="px-1.5 py-1.5 text-right">
                            <input
                              type="number"
                              min="0"
                              step="1"
                              value={qty[row.nat_key] ?? ''}
                              onChange={e => { setManualQtyKeys((prev: Set<string>) => new Set([...prev, row.nat_key])); onQtyChange(row.nat_key, e.target.value) }}
                              placeholder="0"
                              className={`w-20 text-right font-mono text-sm rounded px-1.5 py-1 focus:outline-none focus:ring-1
                                ${manualQtyKeys.has(row.nat_key)
                                  ? 'border border-amber-400 bg-amber-50 text-amber-800 focus:ring-amber-300'
                                  : 'border border-transparent bg-transparent text-gray-800 hover:border-gray-300 focus:border-gray-400 focus:ring-gray-200'}`}
                            />
                          </td>
                          {/* Cost/ptn — editable */}
                          <td className="px-1.5 py-1.5 text-right">
                            <div className="relative inline-flex items-center">
                              <input
                                type="number" min="0" step="0.01"
                                value={costOverrides[row.nat_key] ?? ''}
                                onChange={e => {
                                  const v = e.target.value
                                  setCostOverrides(prev => v === '' ? (({ [row.nat_key]: _, ...rest }) => rest)(prev) : { ...prev, [row.nat_key]: v })
                                  markDirty()
                                }}
                                onBlur={e => { if (e.target.value) addHistoryEntry('cost_override', `Cost: ${row.display_name} → ${e.target.value}`) }}
                                placeholder={row.base_cost_display > 0 ? String(Math.round(row.base_cost_display * 100) / 100) : ''}
                                className={`w-20 text-right font-mono text-sm rounded px-1.5 py-1 focus:outline-none focus:ring-1
                                  ${row.nat_key in costOverrides
                                    ? 'border border-amber-400 bg-amber-50 text-amber-800 focus:ring-amber-300'
                                    : 'border border-transparent bg-transparent text-gray-800 hover:border-gray-300 focus:border-gray-400 focus:ring-gray-200'}`}
                              />
                              {row.nat_key in costOverrides && (
                                <button className="ml-0.5 text-amber-400 hover:text-amber-600 text-xs leading-none" title="Reset to recipe cost"
                                  onClick={() => { setCostOverrides(prev => (({ [row.nat_key]: _, ...rest }) => rest)(prev)); markDirty() }}>↺</button>
                              )}
                            </div>
                          </td>
                          {/* Price (gross) — editable via single-level price_override_key */}
                          <td className="px-1.5 py-1.5 text-right">
                            {(() => {
                              const priceKey = `${row.menu_item_id}_l${typeof levelId === 'number' ? levelId : ''}`
                              const isOv = priceKey in priceOverrides
                              return (
                                <div className="relative inline-flex items-center">
                                  <input
                                    type="number" min="0" step="0.01"
                                    value={priceOverrides[priceKey] ?? ''}
                                    onChange={e => {
                                      const v = e.target.value
                                      setPriceOverrides(prev => v === '' ? (({ [priceKey]: _, ...rest }) => rest)(prev) : { ...prev, [priceKey]: v })
                                      markDirty()
                                    }}
                                    onBlur={e => { if (e.target.value) addHistoryEntry('price_override', `Price: ${row.display_name} → ${e.target.value}`) }}
                                    placeholder={row.base_price_gross > 0 ? String(Math.round(row.base_price_gross * 100) / 100) : '—'}
                                    className={`w-20 text-right font-mono text-sm rounded px-1.5 py-1 focus:outline-none focus:ring-1
                                      ${isOv
                                        ? 'border border-amber-400 bg-amber-50 text-amber-800 focus:ring-amber-300'
                                        : 'border border-transparent bg-transparent text-gray-800 hover:border-gray-300 focus:border-gray-400 focus:ring-gray-200'}`}
                                  />
                                  {isOv && (
                                    <button className="ml-0.5 text-amber-400 hover:text-amber-600 text-xs leading-none" title="Reset to menu price"
                                      onClick={() => { setPriceOverrides(prev => (({ [priceKey]: _, ...rest }) => rest)(prev)); markDirty() }}>↺</button>
                                  )}
                                </div>
                              )
                            })()}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-gray-500">
                            {row.qty > 0 ? fmtMix(row.qty, totalQty) : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-gray-400">
                            {row.net_revenue > 0 ? fmtNum(row.net_revenue) : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right text-xs text-gray-500">
                            {row.net_revenue > 0 ? fmtMix(row.net_revenue, totalNet) : <span className="text-gray-200">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs">
                            {row.total_cost > 0 ? fmtMoney(row.total_cost) : <span className="text-gray-200">—</span>}
                          </td>
                          <td
                            className={`px-3 py-2.5 text-right text-xs ${cogsColour(row.cogs_pct)}`}
                            data-ai-context={row.cogs_pct != null ? JSON.stringify({ type: 'cogs_pct', value: fmtPct(row.cogs_pct), item: row.display_name, price_level: levelName, menu: menuName }) : undefined}
                          >
                            {fmtPct(row.cogs_pct)}
                          </td>
                        </tr>
                      ))}
                    </>
                  )
                })}
              </tbody>

              {/* Grand total footer */}
              <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                <tr>
                  <td className="px-3 py-3 font-bold text-gray-900" colSpan={2}>Grand Total</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-gray-900">
                    {totalQty > 0 ? totalQty.toLocaleString() : '—'}
                  </td>
                  <td colSpan={2} />
                  <td className="px-3 py-3 text-right text-xs font-semibold text-gray-600">100%</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-gray-900">
                    {totalNet > 0 ? fmtNum(totalNet) : '—'}
                  </td>
                  <td className="px-3 py-3 text-right text-xs font-semibold text-gray-600">100%</td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-gray-900">
                    {totalCost > 0 ? fmtMoney(totalCost) : '—'}
                  </td>
                  <td className={`px-3 py-3 text-right font-bold text-sm ${cogsColour(overallCogs)}`}>
                    {fmtPct(overallCogs)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* ══ ALL LEVELS TABLE ════════════════════════════════════════════════ */}
        {menuId && levelId === 'ALL' && !allLevelsLoading && allLevelRows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-200 border-b border-gray-300 text-xs uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-gray-500" rowSpan={2}>
                    <div className="flex items-center gap-2">
                      Item
                      {allCats.length > 1 && (
                        <button
                          onClick={toggleAllCats}
                          className="text-[10px] font-normal text-gray-400 hover:text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 leading-none normal-case tracking-normal"
                          title={allCollapsed ? 'Expand all categories' : 'Collapse all categories'}
                        >
                          {allCollapsed ? '▶ All' : '▼ All'}
                        </button>
                      )}
                    </div>
                  </th>
                  {allLevelsData.map(({ level }) => (
                    <th key={level.id} colSpan={allLevelsCompact ? 4 : 5}
                      className="px-3 py-2 text-center font-semibold text-accent border-l border-gray-300 bg-accent-dim/30 whitespace-nowrap">
                      {level.name}{level.is_default ? ' ★' : ''}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold text-gray-500 border-l border-gray-300 whitespace-nowrap" rowSpan={2}>Total COGS%</th>
                </tr>
                <tr>
                  {allLevelsData.map(({ level }) => (
                    <>
                      <th key={`${level.id}-qh`} className="px-3 py-1.5 text-right font-medium text-gray-500 border-l border-gray-200 bg-accent-dim/10 normal-case min-w-[70px]">Qty</th>
                      <th key={`${level.id}-costh`} className="px-3 py-1.5 text-right font-medium text-gray-500 bg-accent-dim/10 whitespace-nowrap normal-case">Cost/ptn{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                      <th key={`${level.id}-ph`} className="px-3 py-1.5 text-right font-medium text-gray-500 bg-accent-dim/10 whitespace-nowrap normal-case">Price{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                      {!allLevelsCompact && (
                        <th key={`${level.id}-rh`} className="px-3 py-1.5 text-right font-medium text-gray-500 bg-accent-dim/10 whitespace-nowrap normal-case">Revenue{sym ? <span className="ml-0.5 font-normal text-gray-400 text-[10px]">({sym})</span> : ''}</th>
                      )}
                      <th key={`${level.id}-ch`} className="px-3 py-1.5 text-right font-medium text-gray-500 bg-accent-dim/10 normal-case">COGS%</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allLevelCategorised.map(([cat, catRows]) => {
                  // sum(cost per level) / sum(revenue per level) across all items in category
                  const cSumCost = catRows.reduce((s, r) => s + r.total_cost, 0)
                  const cSumRev  = catRows.reduce((s, r) => s + r.perLevel.reduce((ss, p) => ss + p.revenue, 0), 0)
                  const cTotalCogsPct = cSumRev > 0 ? (cSumCost / cSumRev) * 100 : null
                  return (
                    <>
                      <tr key={`cat-${cat}`}
                        className="bg-blue-50/40 border-y border-blue-100 cursor-pointer select-none hover:bg-blue-100/60"
                        onClick={() => toggleCat(cat)}
                      >
                        <td className="px-3 py-1.5 font-bold text-gray-700 text-xs uppercase tracking-wide">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="text-gray-400 text-[9px] w-2.5 shrink-0">{collapsedCats.has(cat) ? '▶' : '▼'}</span>
                            {cat}
                            {collapsedCats.has(cat) && (
                              <span className="text-[10px] font-normal text-gray-400 ml-1">({catRows.length} item{catRows.length !== 1 ? 's' : ''} hidden)</span>
                            )}
                          </span>
                        </td>
                        {allLevelsData.map(({ level }) => {
                          const cLvlQ = catRows.reduce((s, r) => s + (r.perLevel.find(p => p.level.id === level.id)?.qty ?? 0), 0)
                          const cR    = catRows.reduce((s, r) => s + (r.perLevel.find(p => p.level.id === level.id)?.revenue ?? 0), 0)
                          const cCost = catRows.reduce((s, r) => s + (r.perLevel.find(p => p.level.id === level.id)?.qty ?? 0) * r.cost, 0)
                          const cP    = cR > 0 ? (cCost / cR) * 100 : null
                          return (
                            <>
                              <td key={`${level.id}-ccost`} className="border-l border-gray-200" />
                              <td key={`${level.id}-cq`} className="px-2 py-1.5 text-center font-mono font-semibold text-gray-700 text-xs">
                                {cLvlQ > 0 ? cLvlQ.toLocaleString() : '—'}
                              </td>
                              <td key={`${level.id}-cp`} />
                              {!allLevelsCompact && (
                                <td key={`${level.id}-cr`} className="px-3 py-1.5 text-right font-mono font-semibold text-xs text-gray-700">
                                  {cR > 0 ? fmtMoney(cR) : '—'}
                                </td>
                              )}
                              <td key={`${level.id}-cc`} className={`px-3 py-1.5 text-right text-xs ${cogsColour(cP)}`}>
                                {fmtPct(cP)}
                              </td>
                            </>
                          )
                        })}
                        <td className={`px-3 py-1.5 text-right text-xs border-l border-gray-200 ${cogsColour(cTotalCogsPct)}`}>
                          {fmtPct(cTotalCogsPct)}
                        </td>
                      </tr>
                      {!collapsedCats.has(cat) && catRows.map(row => {
                        // total_cost is already Σ(qty_l × cost) across levels — just divide by total revenue
                        const sumRevAllLevels  = row.perLevel.reduce((s, p) => s + p.revenue, 0)
                        const totalCogsPct = sumRevAllLevels > 0 ? (row.total_cost / sumRevAllLevels) * 100 : null
                        return (
                          <tr
                            key={row.menu_item_id}
                            className="hover:bg-gray-50/80"
                            onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setRowCtx({ x: e.clientX, y: e.clientY, menuItemId: row.menu_item_id, displayName: row.display_name }) }}
                          >
                            <td className="px-3 py-2 font-medium text-gray-900 pl-6">{row.display_name}</td>
                            {row.perLevel.map(p => (
                              <>
                                {/* Qty per level — moved before Cost/ptn */}
                                <td key={`${p.level.id}-iq`} className="px-1 py-1 border-l border-gray-100">
                                  <div className="flex justify-end">
                                    <input
                                      type="number" min="0" step="1"
                                      value={qty[p.qty_key] ?? ''}
                                      onChange={e => { setManualQtyKeys((prev: Set<string>) => new Set([...prev, p.qty_key])); onQtyChange(p.qty_key, e.target.value) }}
                                      placeholder="0"
                                      className={`w-20 text-right font-mono text-sm rounded px-1.5 py-1 focus:outline-none focus:ring-1
                                        ${manualQtyKeys.has(p.qty_key)
                                          ? 'border border-amber-400 bg-amber-50 text-amber-800 focus:ring-amber-300'
                                          : 'border border-transparent bg-transparent text-gray-800 hover:border-gray-300 focus:border-gray-400 focus:ring-gray-200'}`}
                                    />
                                  </div>
                                </td>
                                {/* Cost/ptn per level — editable (all levels share same value) */}
                                <td key={`${p.level.id}-icost`} className="px-1 py-1">
                                  <div className="inline-flex items-center justify-end w-full">
                                    <input
                                      type="number" min="0" step="0.01"
                                      value={costOverrides[row.cost_override_key] ?? ''}
                                      onChange={e => {
                                        const v = e.target.value
                                        setCostOverrides(prev => v === '' ? (({ [row.cost_override_key]: _, ...rest }) => rest)(prev) : { ...prev, [row.cost_override_key]: v })
                                        markDirty()
                                      }}
                                      onBlur={e => { if (e.target.value) addHistoryEntry('cost_override', `Cost: ${row.display_name} → ${e.target.value}`) }}
                                      placeholder={row.base_cost_display > 0 ? String(Math.round(row.base_cost_display * 100) / 100) : ''}
                                      className={`w-20 text-right font-mono text-sm rounded px-1 py-1 focus:outline-none focus:ring-1
                                        ${row.is_cost_overridden
                                          ? 'border border-amber-400 bg-amber-50 text-amber-800 focus:ring-amber-300'
                                          : 'border border-transparent bg-transparent text-gray-800 hover:border-gray-300 focus:border-gray-400 focus:ring-gray-200'}`}
                                    />
                                    {row.is_cost_overridden && (
                                      <button className="ml-0.5 text-amber-400 hover:text-amber-600 text-xs" title="Reset cost"
                                        onClick={() => { setCostOverrides(prev => (({ [row.cost_override_key]: _, ...rest }) => rest)(prev)); markDirty() }}>↺</button>
                                    )}
                                  </div>
                                </td>
                                {/* Price — editable */}
                                <td key={`${p.level.id}-ip`} className="px-1 py-1">
                                  <div className="flex justify-end items-center">
                                    <input
                                      type="number" min="0" step="0.01"
                                      value={priceOverrides[p.price_override_key] ?? ''}
                                      onChange={e => {
                                        const v = e.target.value
                                        setPriceOverrides(prev => v === '' ? (({ [p.price_override_key]: _, ...rest }) => rest)(prev) : { ...prev, [p.price_override_key]: v })
                                        markDirty()
                                      }}
                                      onBlur={e => { if (e.target.value) addHistoryEntry('price_override', `Price: ${row.display_name} [${p.level.name}] → ${e.target.value}`) }}
                                      placeholder={p.base_price_gross > 0 ? String(Math.round(p.base_price_gross * 100) / 100) : ''}
                                      className={`w-20 text-right font-mono text-sm rounded px-1 py-1 focus:outline-none focus:ring-1
                                        ${p.is_price_overridden
                                          ? 'border border-amber-400 bg-amber-50 text-amber-800 focus:ring-amber-300'
                                          : 'border border-transparent bg-transparent text-gray-800 hover:border-gray-300 focus:border-gray-400 focus:ring-gray-200'}`}
                                    />
                                    {p.is_price_overridden && (
                                      <button className="ml-0.5 text-amber-400 hover:text-amber-600 text-xs" title="Reset price"
                                        onClick={() => { setPriceOverrides(prev => (({ [p.price_override_key]: _, ...rest }) => rest)(prev)); markDirty() }}>↺</button>
                                    )}
                                  </div>
                                </td>
                                {!allLevelsCompact && (
                                  <td key={`${p.level.id}-ir`} className="px-3 py-2 text-right font-mono text-xs font-semibold text-gray-400">
                                    {p.revenue > 0 ? fmtNum(p.revenue) : <span className="text-gray-200">—</span>}
                                  </td>
                                )}
                                <td key={`${p.level.id}-ic`}
                                  className={`px-3 py-2 text-right text-xs ${cogsColour(p.cogs_pct)}`}
                                  data-ai-context={p.cogs_pct != null ? JSON.stringify({ type: 'cogs_pct', value: fmtPct(p.cogs_pct), item: row.display_name, price_level: p.level.name, menu: menuName }) : undefined}
                                >
                                  {fmtPct(p.cogs_pct)}
                                </td>
                              </>
                            ))}
                            <td className={`px-3 py-2 text-right text-xs border-l border-gray-100 ${cogsColour(totalCogsPct)}`}>
                              {fmtPct(totalCogsPct)}
                            </td>
                          </tr>
                        )
                      })}
                    </>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-gray-300 bg-gray-50">
                {(() => {
                  // sum(cost per level) / sum(revenue per level) across all items and all levels
                  const gtSumCost = allLevelRows.reduce((s, r) => s + r.total_cost, 0)
                  const gtSumRev  = allLevelRows.reduce((s, r) => s + r.perLevel.reduce((ss, p) => ss + p.revenue, 0), 0)
                  const gtTotalCogsPct = gtSumRev > 0 ? (gtSumCost / gtSumRev) * 100 : null
                  return (
                    <tr>
                      <td className="px-3 py-3 font-bold text-gray-900">Grand Total</td>
                      {allLevelsData.map(({ level }) => {
                        const tQ = allLevelRows.reduce((s, r) => s + (r.perLevel.find(p => p.level.id === level.id)?.qty ?? 0), 0)
                        const tR = allLevelRows.reduce((s, r) => s + (r.perLevel.find(p => p.level.id === level.id)?.revenue ?? 0), 0)
                        const tC = allLevelRows.reduce((s, r) => s + (r.perLevel.find(p => p.level.id === level.id)?.qty ?? 0) * r.cost, 0)
                        const tP = tR > 0 ? (tC / tR) * 100 : null
                        return (
                          <>
                            <td key={`${level.id}-fq`} className="px-3 py-3 text-right font-mono font-bold text-gray-900 border-l border-gray-200">
                              {tQ > 0 ? tQ.toLocaleString() : '—'}
                            </td>
                            <td key={`${level.id}-fcost`} className="border-gray-200" />
                            <td key={`${level.id}-fp`} className="border-gray-200" />
                            {!allLevelsCompact && (
                              <td key={`${level.id}-fr`} className="px-3 py-3 text-right font-mono font-bold text-gray-900">
                                {tR > 0 ? fmtNum(tR) : '—'}
                              </td>
                            )}
                            <td key={`${level.id}-fc`} className={`px-3 py-3 text-right font-bold text-sm ${cogsColour(tP)}`}>
                              {fmtPct(tP)}
                            </td>
                          </>
                        )
                      })}
                      <td className={`px-3 py-3 text-right font-bold text-sm border-l border-gray-200 ${cogsColour(gtTotalCogsPct)}`}>
                        {fmtPct(gtTotalCogsPct)}
                      </td>
                    </tr>
                  )
                })()}
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── ScenarioModal ──────────────────────────────────────────────────────────────

interface ScenarioModalProps {
  scenarios:   SavedScenario[]
  loading:     boolean
  saving:      boolean
  currentId:   number | null
  currentName: string
  onLoad(s: SavedScenario): void
  onDelete(id: number): void
  onSave(name: string, forceNew?: boolean): void
  onNew(name: string): void
  onClose(): void
}

function ScenarioModal({ scenarios, loading, saving, currentId, currentName, onLoad, onDelete, onSave, onNew, onClose }: ScenarioModalProps) {
  const [nameInput,    setNameInput]    = useState(currentName || '')
  const [search,       setSearch]       = useState('')
  const [subForm,      setSubForm]      = useState<'saveAs' | 'new' | null>(null)
  const [subName,      setSubName]      = useState('')

  const filtered = scenarios.filter(s => !search || s.name.toLowerCase().includes(search.toLowerCase()))

  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return iso }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-800 text-base">Scenarios</h3>
          <button className="text-gray-400 hover:text-gray-600 text-lg leading-none" onClick={onClose}>✕</button>
        </div>

        {/* Saved list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center"><Spinner /></div>
          ) : (
            <>
              {/* Search */}
              {scenarios.length > 5 && (
                <div className="px-4 pt-3 pb-1">
                  <input
                    className="input w-full text-sm"
                    placeholder="Search scenarios…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    autoFocus
                  />
                </div>
              )}

              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400">
                  {scenarios.length === 0 ? 'No saved scenarios yet.' : 'No matches.'}
                </div>
              ) : (
                <ul className="divide-y divide-gray-50 px-2 py-2">
                  {filtered.map(s => (
                    <li key={s.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg group
                      ${s.id === currentId ? 'bg-accent-dim' : 'hover:bg-gray-50'}`}>
                      <div className="flex-1 min-w-0">
                        <div className={`font-medium text-sm truncate ${s.id === currentId ? 'text-accent' : 'text-gray-800'}`}>
                          {s.name}{s.id === currentId && <span className="ml-1.5 text-xs font-normal opacity-70">● loaded</span>}
                        </div>
                        <div className="text-xs text-gray-400 mt-0.5 flex gap-2 flex-wrap">
                          {s.menu_name && <span>📋 {s.menu_name}</span>}
                          {s.price_level_name && <span>💰 {s.price_level_name}</span>}
                          <span>{fmt(s.updated_at)}</span>
                        </div>
                      </div>
                      <button
                        className="btn btn-sm btn-outline text-xs opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={() => onLoad(s)}
                      >Load</button>
                      <button
                        className="text-gray-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 shrink-0 px-1"
                        onClick={() => onDelete(s.id)}
                        title="Delete scenario"
                      >🗑</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50 rounded-b-xl">

          {/* ── Sub-form: Save as New ── */}
          {subForm === 'saveAs' && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Save as New Scenario</p>
              <input
                className="input w-full text-sm"
                placeholder="New scenario name…"
                value={subName}
                autoFocus
                onChange={e => setSubName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && subName.trim()) { onSave(subName.trim(), true); setSubForm(null) }
                  if (e.key === 'Escape') setSubForm(null)
                }}
              />
              <div className="flex gap-2 justify-between">
                <button className="btn btn-sm btn-ghost text-xs text-gray-500" onClick={() => setSubForm(null)}>← Back</button>
                <button
                  className="btn btn-sm btn-primary shrink-0"
                  disabled={!subName.trim() || saving}
                  onClick={() => { onSave(subName.trim(), true); setSubForm(null) }}
                >{saving ? 'Saving…' : '💾 Save Copy'}</button>
              </div>
            </div>
          )}

          {/* ── Sub-form: New Scenario ── */}
          {subForm === 'new' && (
            <div className="space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">New Scenario</p>
              <p className="text-xs text-gray-400">All quantities, prices and overrides will be cleared.</p>
              <input
                className="input w-full text-sm"
                placeholder="Scenario name…"
                value={subName}
                autoFocus
                onChange={e => setSubName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && subName.trim()) { onNew(subName.trim()); setSubForm(null) }
                  if (e.key === 'Escape') setSubForm(null)
                }}
              />
              <div className="flex gap-2 justify-between">
                <button className="btn btn-sm btn-ghost text-xs text-gray-500" onClick={() => setSubForm(null)}>← Back</button>
                <button
                  className="btn btn-sm btn-primary shrink-0"
                  disabled={!subName.trim()}
                  onClick={() => { onNew(subName.trim()); setSubForm(null) }}
                >✓ Create</button>
              </div>
            </div>
          )}

          {/* ── Normal footer ── */}
          {!subForm && (
            <div className="space-y-3">
              <div className="flex gap-2 items-center">
                <input
                  className="input flex-1 text-sm"
                  placeholder="Scenario name…"
                  value={nameInput}
                  onChange={e => setNameInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && nameInput.trim()) onSave(nameInput.trim()) }}
                  autoFocus={scenarios.length === 0}
                />
                <button
                  className="btn btn-sm btn-primary shrink-0"
                  disabled={!nameInput.trim() || saving}
                  onClick={() => onSave(nameInput.trim())}
                >{saving ? 'Saving…' : currentId ? 'Update' : 'Save'}</button>
              </div>
              <div className="flex gap-2 items-center justify-between">
                {currentId ? (
                  <button
                    className="btn btn-sm btn-ghost text-xs text-gray-500"
                    onClick={() => { setSubName(nameInput); setSubForm('saveAs') }}
                  >Save as New…</button>
                ) : <div />}
                <div className="flex gap-2">
                  <button
                    className="btn btn-sm btn-primary text-xs"
                    onClick={() => { setSubName(''); setSubForm('new') }}
                  >+ New Scenario</button>
                  <button className="btn btn-sm btn-outline text-xs" onClick={onClose}>Close</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── WhatIfModal ────────────────────────────────────────────────────────────────

function WhatIfModal({ onApply, onClose }: { onApply(pricePct: number, costPct: number): void; onClose(): void }) {
  const [pricePct, setPricePct] = useState('')
  const [costPct,  setCostPct]  = useState('')

  const pN = parseFloat(pricePct) || 0
  const cN = parseFloat(costPct)  || 0

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-80" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">⚡ What If…</h3>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-gray-500">Apply a percentage shift to all prices and/or costs across the scenario.</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Price change (%)</label>
            <div className="flex gap-2 items-center">
              <input type="number" step="0.5" className="input flex-1 text-sm"
                placeholder="e.g. +5 or -10"
                value={pricePct} onChange={e => setPricePct(e.target.value)} autoFocus />
              <div className="flex gap-1">
                {[-10, -5, +5, +10].map(v => (
                  <button key={v} className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50"
                    onClick={() => setPricePct(String(v))}>{v > 0 ? '+' : ''}{v}%</button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Cost change (%)</label>
            <div className="flex gap-2 items-center">
              <input type="number" step="0.5" className="input flex-1 text-sm"
                placeholder="e.g. +3 or -5"
                value={costPct} onChange={e => setCostPct(e.target.value)} />
              <div className="flex gap-1">
                {[-10, -5, +5, +10].map(v => (
                  <button key={v} className="px-2 py-1 text-xs border border-gray-200 rounded hover:bg-gray-50"
                    onClick={() => setCostPct(String(v))}>{v > 0 ? '+' : ''}{v}%</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-end">
          <button className="btn btn-sm btn-outline" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-sm btn-primary"
            disabled={pN === 0 && cN === 0}
            onClick={() => { if (pN !== 0 || cN !== 0) onApply(pN, cN) }}
          >Apply</button>
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── HistoryNotesModal ──────────────────────────────────────────────────────────

function HistoryNotesModal({
  entries, notes, onNotesChange, onClear, onClose,
  comments, commentsLoading, onAddComment, onClearComments,
}: {
  entries: HistoryEntry[]
  notes: string
  onNotesChange(n: string): void
  onClear(): void
  onClose(): void
  comments?: MeChange[]
  commentsLoading?: boolean
  onAddComment?(text: string, parentId?: number, sharedPageId?: number): Promise<void>
  onClearComments?(): void
}) {
  const hasComments = comments !== undefined
  const [tab, setTab] = useState<'notes' | 'history' | 'comments'>('notes')
  const [commentText, setCommentText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replyTo, setReplyTo] = useState<MeChange | null>(null)
  const [replyText, setReplyText] = useState('')
  const [postingReply, setPostingReply] = useState(false)

  // Build comment tree: top-level + their replies (one level deep)
  const commentTree = useMemo(() => {
    if (!comments) return []
    const topLevel = comments.filter(c => c.change_type === 'comment' && !c.parent_id)
    const byParent: Record<number, MeChange[]> = {}
    for (const c of comments) {
      if (c.change_type === 'comment' && c.parent_id) {
        if (!byParent[c.parent_id]) byParent[c.parent_id] = []
        byParent[c.parent_id].push(c)
      }
    }
    return topLevel.map(c => ({ ...c, replies: (byParent[c.id] || []).sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) }))
  }, [comments])

  async function postComment() {
    if (!commentText.trim() || !onAddComment) return
    setPosting(true)
    try { await onAddComment(commentText.trim()); setCommentText('') }
    finally { setPosting(false) }
  }

  async function postReply() {
    if (!replyText.trim() || !replyTo || !onAddComment) return
    setPostingReply(true)
    try {
      // Route the reply to whichever shared view the parent comment came from
      await onAddComment(replyText.trim(), replyTo.id, replyTo.shared_page_id)
      setReplyText('')
      setReplyTo(null)
    }
    finally { setPostingReply(false) }
  }

  function fmtTime(iso: string) {
    try { return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
  }

  function fmtAction(a: string) {
    const map: Record<string, string> = {
      reset_prices: '↺ Prices reset',
      reset_costs:  '↺ Costs reset',
      reset_qty:    '↺ Qty reset',
      push_prices:  '→ Pushed to menu',
      whatif:       '⚡ What If',
    }
    return map[a] ?? a
  }
  function fmt(iso: string) {
    try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) } catch { return iso }
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-h-[70vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex gap-1">
            <button
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${tab === 'notes' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              onClick={() => setTab('notes')}
            >📋 Notes</button>
            <button
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors flex items-center gap-1.5 ${tab === 'history' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}
              onClick={() => setTab('history')}
            >
              🕐 History
              {(() => { const n = entries.length + (comments?.filter(c => c.change_type !== 'comment').length ?? 0); return n > 0 ? <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${tab === 'history' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>{n}</span> : null })()}
            </button>
            {hasComments && (
              <button
                className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors flex items-center gap-1.5 ${tab === 'comments' ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}
                onClick={() => setTab('comments')}
              >
                💬 Comments
                {(comments?.filter(c => c.change_type === 'comment').length ?? 0) > 0 && <span className={`text-[10px] rounded-full px-1.5 py-0.5 ${tab === 'comments' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>{comments!.filter(c => c.change_type === 'comment').length}</span>}
              </button>
            )}
          </div>
          <button className="text-gray-400 hover:text-gray-600" onClick={onClose}>✕</button>
        </div>

        {/* Notes tab */}
        {tab === 'notes' && (
          <div className="flex-1 px-5 py-4 flex flex-col gap-2">
            <p className="text-xs text-gray-400">Notes are saved with the scenario. Use for assumptions, pricing rationale, or review comments.</p>
            <textarea
              className="input flex-1 resize-none text-sm min-h-[200px]"
              placeholder="Add notes about this scenario…"
              value={notes}
              onChange={e => onNotesChange(e.target.value)}
              autoFocus
            />
          </div>
        )}

        {/* History tab */}
        {tab === 'history' && (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
            {/* Local scenario history */}
            {entries.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-4">No local changes recorded yet.</div>
            ) : (
              <ul className="space-y-1">
                {[...entries].reverse().map((e, i) => (
                  <li key={i} className="flex gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-gray-400 text-xs shrink-0 mt-0.5 w-28">{fmt(e.ts)}</span>
                    <div>
                      <span className="font-medium text-gray-700">{fmtAction(e.action)}</span>
                      {e.detail && <span className="text-gray-500 ml-1.5 text-xs">{e.detail}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {/* Shared view price/qty edits */}
            {comments && comments.filter(c => c.change_type !== 'comment').length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                  <span>✏️</span> Shared View Edits
                </div>
                <ul className="space-y-1">
                  {comments.filter(c => c.change_type !== 'comment').map(c => (
                    <li key={c.id} className="flex gap-3 text-sm py-1.5 border-b border-gray-50 last:border-0">
                      <span className="text-gray-400 text-xs shrink-0 mt-0.5 w-28">{fmtTime(c.created_at)}</span>
                      <div className="min-w-0">
                        <span className="font-medium text-gray-700 text-xs">{c.user_name}</span>
                        {c.display_name && <span className="text-gray-500 ml-1.5 text-xs truncate">· {c.display_name}</span>}
                        {c.level_name && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            {c.level_name}: <span className="line-through">{c.old_value !== null ? Number(c.old_value).toFixed(2) : 'unset'}</span>
                            {' → '}<span className="text-accent font-semibold">{Number(c.new_value ?? 0).toFixed(2)}</span>
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Comments tab */}
        {tab === 'comments' && hasComments && (
          <div className="flex flex-col flex-1 min-h-0">
            {/* New comment input */}
            {onAddComment && (
              <div className="px-4 py-3 border-b border-gray-100 flex-shrink-0">
                <textarea
                  className="input w-full text-sm resize-none"
                  rows={2}
                  placeholder="Add a comment…"
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment() }}
                />
                <div className="flex justify-end mt-1.5">
                  <button
                    className="btn btn-sm btn-primary text-xs"
                    disabled={!commentText.trim() || posting}
                    onClick={postComment}
                  >{posting ? 'Posting…' : '💬 Post Comment'}</button>
                </div>
              </div>
            )}

            {/* Comment feed */}
            <div className="flex-1 overflow-y-auto">
              {commentsLoading && <div className="py-8 text-center text-sm text-gray-400 animate-pulse">Loading…</div>}
              {!commentsLoading && comments && comments.filter(c => c.change_type === 'comment' && !c.parent_id).length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">No comments yet.</div>
              )}
              {!commentsLoading && commentTree.map(c => (
                <div key={c.id} className="border-b border-gray-100 last:border-0">
                  <div className="px-4 py-2.5 bg-blue-50/20">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-blue-400 text-xs flex-shrink-0">💬</span>
                        <span className="text-xs font-semibold text-gray-800 truncate">{c.user_name}</span>
                        {c.display_name && <span className="text-xs text-gray-400 truncate">· {c.display_name}</span>}
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-xs text-gray-400">{fmtTime(c.created_at)}</span>
                        {onAddComment && (
                          <button
                            className="text-xs text-blue-400 hover:text-blue-600 transition-colors"
                            onClick={() => { setReplyTo(replyTo?.id === c.id ? null : c); setReplyText('') }}
                          >↩ Reply</button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap break-words">{c.comment}</p>

                    {/* Reply input */}
                    {replyTo?.id === c.id && onAddComment && (
                      <div className="mt-2 pl-3 border-l-2 border-blue-200">
                        <textarea
                          className="input w-full text-xs resize-none"
                          rows={2}
                          placeholder={`Reply to ${c.user_name}…`}
                          value={replyText}
                          onChange={e => setReplyText(e.target.value)}
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postReply() }}
                        />
                        <div className="flex gap-1.5 justify-end mt-1">
                          <button className="btn btn-sm btn-ghost text-xs text-gray-500" onClick={() => setReplyTo(null)}>Cancel</button>
                          <button
                            className="btn btn-sm btn-primary text-xs"
                            disabled={!replyText.trim() || postingReply}
                            onClick={postReply}
                          >{postingReply ? 'Posting…' : '↩ Reply'}</button>
                        </div>
                      </div>
                    )}

                    {/* Replies */}
                    {c.replies && c.replies.length > 0 && (
                      <div className="mt-2 pl-3 border-l-2 border-blue-100 space-y-2">
                        {c.replies.map(r => (
                          <div key={r.id}>
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1 min-w-0">
                                <span className="text-blue-300 text-xs">↩</span>
                                <span className="text-xs font-semibold text-gray-700 truncate">{r.user_name}</span>
                              </div>
                              <span className="text-xs text-gray-400 flex-shrink-0">{fmtTime(r.created_at)}</span>
                            </div>
                            <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap break-words">{r.comment}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex gap-2 justify-between">
          {tab === 'history' && entries.length > 0 ? (
            <button className="btn btn-sm btn-ghost text-xs text-red-400 hover:text-red-600" onClick={onClear}>Clear history</button>
          ) : tab === 'comments' && comments && comments.some(c => c.change_type === 'comment') && onClearComments ? (
            <button className="btn btn-sm btn-ghost text-xs text-red-400 hover:text-red-600" onClick={onClearComments}>Clear comments</button>
          ) : (
            <div />
          )}
          <button className="btn btn-sm btn-outline" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
