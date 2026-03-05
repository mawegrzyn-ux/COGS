import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'

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
  menu_id: number
  items: CogsItem[]
  summary: CogsSummary
}

// Price report types
interface PriceReportCountry {
  id: number; name: string; code: string; symbol: string; rate: number
}
interface PriceReportRecipe {
  recipe_id: number
  recipe_name: string
  category: string
  countries: Record<number, {
    on_menu: boolean
    sell_gross?: number
    sell_net?: number
    cost?: number
    cogs_pct?: number | null
    count?: number
    menu_item_id?: number | null
    rate?: number
  }>
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
  cost: number
  levels: Record<number, { set: boolean; gross: number | null; net: number | null; cogs_pct: number | null; gp_net: number | null; lp_id?: number }>
}
interface LevelReportData {
  country: { id: number; name: string; symbol: string; code: string; rate: number }
  levels: PriceLevel[]
  items: LevelReportItem[]
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt2 = (n: number | null | undefined) => Number(n ?? 0).toFixed(2)
const cogsClass = (pct: number): 'green' | 'yellow' | 'red' =>
  pct <= 28 ? 'green' : pct <= 35 ? 'yellow' : 'red'

function exportCSV(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MenusPage() {
  const api = useApi()

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
  const [activeTab, setActiveTab] = useState<'builder' | 'price-report' | 'level-report'>('builder')

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
  const [priceReportData,    setPriceReportData]    = useState<PriceReportData | null>(null)
  const [priceReportLoading, setPriceReportLoading] = useState(false)
  const [priceReportLoaded,  setPriceReportLoaded]  = useState(false)
  const [priceSelectedLevel, setPriceSelectedLevel] = useState<number | ''>('')
  const [priceGrossNet,      setPriceGrossNet]      = useState<'gross' | 'net'>('gross')
  const [priceSelCountries,  setPriceSelCountries]  = useState<Record<number, boolean>>({})
  const [priceSearch,        setPriceSearch]        = useState('')
  const [priceCat,           setPriceCat]           = useState('')
  const [priceGroupBy,       setPriceGroupBy]       = useState(false)

  // level report
  const [levelReportData,    setLevelReportData]    = useState<LevelReportData | null>(null)
  const [levelReportLoading, setLevelReportLoading] = useState(false)
  const [lrCountryId,        setLrCountryId]        = useState<number | ''>('')
  const [lrGrossNet,         setLrGrossNet]         = useState<'gross' | 'net'>('gross')
  const [lrSearch,           setLrSearch]           = useState('')
  const [lrMenuFilter,       setLrMenuFilter]       = useState('')
  const [lrSaveTimers,       setLrSaveTimers]       = useState<Record<string, ReturnType<typeof setTimeout>>>({})
  const [lrSaving,           setLrSaving]           = useState<Record<string, boolean>>({})
  const [lrSaved,            setLrSaved]            = useState<Record<string, boolean>>({})

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

  // ── Open menu / load COGS ──────────────────────────────────────────────────

  const openMenu = useCallback(async (id: number) => {
    setSelectedMenuId(id)
    setItemFilterQ(''); setItemFilterType(''); setItemFilterStatus('')
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
      if (itemFilterStatus) {
        const hasPrice = item.sell_price_gross > 0
        if (!hasPrice || cogsClass(item.cogs_pct_net) !== itemFilterStatus) return false
      }
      return true
    })
  }, [cogsData, itemFilterQ, itemFilterType, itemFilterStatus])

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let av: number | string = 0, bv: number | string = 0
      if (itemSortCol === 'name')   { av = a.display_name.toLowerCase(); bv = b.display_name.toLowerCase() }
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

  // ── Tax helpers ───────────────────────────────────────────────────────────

  function getDefaultTaxForCountryLevel(countryId: number, levelId: number | '') {
    if (levelId) {
      const clt = countryLevelTax.find(r => r.country_id === countryId && r.price_level_id === Number(levelId))
      if (clt) return taxRates.find(t => t.id === clt.tax_rate_id) ?? null
    }
    return taxRates.find(t => t.country_id === countryId && t.is_default) ?? null
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
      const sel: Record<number, boolean> = {}
      data.countries.forEach(c => { sel[c.id] = true })
      setPriceSelCountries(sel)
    } catch { showToast('Failed to load price report.', 'error') }
    finally { setPriceReportLoading(false) }
  }, [api, priceSelectedLevel])

  useEffect(() => {
    if (activeTab === 'price-report' && !priceReportLoaded) loadPriceReport()
  }, [activeTab, priceReportLoaded, loadPriceReport])

  useEffect(() => {
    if (activeTab === 'price-report') { setPriceReportLoaded(false) }
  }, [priceSelectedLevel]) // eslint-disable-line

  const priceReportFiltered = useMemo(() => {
    if (!priceReportData) return []
    return priceReportData.recipes.filter(r => {
      const matchQ   = !priceSearch || r.recipe_name.toLowerCase().includes(priceSearch.toLowerCase())
      const matchCat = !priceCat || r.category === priceCat
      return matchQ && matchCat
    })
  }, [priceReportData, priceSearch, priceCat])

  const priceReportCountries = useMemo(() =>
    (priceReportData?.countries ?? []).filter(c => priceSelCountries[c.id]),
    [priceReportData, priceSelCountries]
  )

  const priceReportCats = useMemo(() => {
    const cats = new Set((priceReportData?.recipes ?? []).map(r => r.category).filter(Boolean))
    return [...cats].sort() as string[]
  }, [priceReportData])

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

  const lrFilteredItems = useMemo(() => {
    if (!levelReportData) return []
    return levelReportData.items.filter(item => {
      const matchQ = !lrSearch || item.display_name.toLowerCase().includes(lrSearch.toLowerCase())
      const matchM = !lrMenuFilter || item.menu_name === lrMenuFilter
      return matchQ && matchM
    })
  }, [levelReportData, lrSearch, lrMenuFilter])

  const lrMenuNames = useMemo(() => {
    const names = new Set((levelReportData?.items ?? []).map(i => i.menu_name))
    return [...names].sort()
  }, [levelReportData])

  async function saveLrPrice(menuItemId: number, levelId: number, value: string, origValue: string) {
    const key = `${menuItemId}_${levelId}`
    if (value === origValue) return
    const price = value === '' ? 0 : parseFloat(value)
    if (isNaN(price) || price < 0) return
    setLrSaving(prev => ({ ...prev, [key]: true }))
    try {
      await api.post('/menu-item-prices', { menu_item_id: menuItemId, price_level_id: levelId, sell_price: price })
      setLrSaved(prev => ({ ...prev, [key]: true }))
      setTimeout(() => setLrSaved(prev => ({ ...prev, [key]: false })), 700)
      // debounced reload
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
        action={
          activeTab === 'builder'
            ? <button className="btn btn-primary" onClick={() => setMenuModal('new')}>+ New Menu</button>
            : undefined
        }
      />

      {/* ── Tabs ── */}
      <div className="flex gap-1 px-6 border-b border-gray-200 mb-0">
        {([
          { key: 'builder',      label: '🍽 Menus' },
          { key: 'price-report', label: '📈 Price Level Tool' },
          { key: 'level-report', label: '🏷 Market Price Tool' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.key
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
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
                itemSortCol={itemSortCol}
                itemSortDir={itemSortDir}
                onLevelChange={v => { setActiveMenuLevel(v); setLevelOverridden(true) }}
                onFilterQ={setItemFilterQ}
                onFilterType={setItemFilterType}
                onFilterStatus={setItemFilterStatus}
                onSort={toggleSort}
                onEdit={m => setMenuModal(m)}
                onDelete={id => setConfirmDelete({ type: 'menu', id })}
                onAddItem={openNewItemModal}
                onEditItem={openEditItemModal}
                onDeleteItem={id => setConfirmDelete({ type: 'item', id })}
                onApplyTax={applyDefaultTax}
              />
            )}
          </section>
        </div>
      )}

      {/* ══ TAB: PRICE REPORT ════════════════════════════════════════════════ */}
      {activeTab === 'price-report' && (
        <PriceReport
          data={priceReportData}
          loading={priceReportLoading}
          priceLevels={priceLevels}
          selectedLevel={priceSelectedLevel}
          grossNet={priceGrossNet}
          selCountries={priceSelCountries}
          search={priceSearch}
          cat={priceCat}
          cats={priceReportCats}
          filtered={priceReportFiltered}
          groupBy={priceGroupBy}
          onLevelChange={v => { setPriceSelectedLevel(v); setPriceReportLoaded(false) }}
          onGrossNetChange={setPriceGrossNet}
          onToggleCountry={(id, val) => setPriceSelCountries(prev => ({ ...prev, [id]: val }))}
          onAllCountries={() => {
            const sel: Record<number, boolean> = {}
            priceReportData?.countries.forEach(c => { sel[c.id] = true })
            setPriceSelCountries(sel)
          }}
          onNoneCountries={() => {
            const sel: Record<number, boolean> = {}
            priceReportData?.countries.forEach(c => { sel[c.id] = false })
            setPriceSelCountries(sel)
          }}
          onSearch={setPriceSearch}
          onCat={setPriceCat}
          onGroupBy={() => setPriceGroupBy(v => !v)}
          onExport={() => {
            if (!priceReportData) return
            const cols = priceReportCountries
            const field = priceGrossNet === 'gross' ? 'sell_gross' : 'sell_net'
            const header = ['Recipe', 'Category', ...cols.map(c => `${c.name} (${c.code} ${priceGrossNet})`)]
            const rows = [header, ...priceReportFiltered.map(r => [
              r.recipe_name, r.category,
              ...cols.map(c => {
                const cd = r.countries[c.id]
                if (!cd?.on_menu) return ''
                return String((cd as any)[field] ?? '')
              })
            ])]
            exportCSV(rows, 'menu-price-report.csv')
          }}
        />
      )}

      {/* ══ TAB: LEVEL REPORT ════════════════════════════════════════════════ */}
      {activeTab === 'level-report' && (
        <LevelReport
          countries={countries}
          data={levelReportData}
          loading={levelReportLoading}
          countryId={lrCountryId}
          grossNet={lrGrossNet}
          search={lrSearch}
          menuFilter={lrMenuFilter}
          menuNames={lrMenuNames}
          filteredItems={lrFilteredItems}
          saving={lrSaving}
          saved={lrSaved}
          onCountryChange={v => setLrCountryId(v)}
          onGrossNetChange={setLrGrossNet}
          onSearch={setLrSearch}
          onMenuFilter={setLrMenuFilter}
          onSavePrice={saveLrPrice}
          onExport={() => {
            if (!levelReportData) return
            const levels = levelReportData.levels
            const field  = lrGrossNet === 'gross' ? 'gross' : 'net'
            const code   = levelReportData.country.code
            const header = ['Item', 'Menu', 'Type', `Cost (${code})`,
              ...levels.flatMap(l => [`${l.name} ${lrGrossNet} (${code})`, `${l.name} COGS%`])]
            const rows = [header, ...lrFilteredItems.map(item => [
              item.display_name, item.menu_name, item.item_type,
              fmt2(item.cost),
              ...levels.flatMap(l => {
                const ld = item.levels[l.id]
                if (!ld?.set) return ['', '']
                return [fmt2((ld as any)[field]), ld.cogs_pct != null ? ld.cogs_pct.toFixed(2) : '']
              })
            ])]
            exportCSV(rows, 'market-price-tool.csv')
          }}
        />
      )}

      {/* ══ MODALS ══════════════════════════════════════════════════════════ */}

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
  itemFilterQ: string; itemFilterType: string; itemFilterStatus: string
  itemSortCol: string; itemSortDir: 1 | -1
  onLevelChange(v: number | ''): void
  onFilterQ(v: string): void; onFilterType(v: string): void; onFilterStatus(v: string): void
  onSort(col: string): void
  onEdit(m: Menu): void; onDelete(id: number): void
  onAddItem(): void; onEditItem(item: CogsItem): void; onDeleteItem(id: number): void
  onApplyTax(): void
}

function MenuDetail({ menu, country, cogsData, sortedItems, filteredItems, priceLevels, activeMenuLevel, sym,
  itemFilterQ, itemFilterType, itemFilterStatus, itemSortCol, itemSortDir,
  onLevelChange, onFilterQ, onFilterType, onFilterStatus, onSort,
  onEdit, onDelete, onAddItem, onEditItem, onDeleteItem, onApplyTax }: MenuDetailProps) {

  const hasLevel = !!activeMenuLevel
  const items = cogsData.items
  const cogsVals  = items.filter(i => i.sell_price_gross > 0).map(i => i.cogs_pct_net)
  const priceVals = items.filter(i => i.sell_price_gross > 0).map(i => i.sell_price_net)
  const avgCogs   = cogsVals.length  ? cogsVals.reduce((a, b) => a + b, 0) / cogsVals.length  : 0
  const maxCogs   = cogsVals.length  ? Math.max(...cogsVals)  : 0
  const avgPrice  = priceVals.length ? priceVals.reduce((a, b) => a + b, 0) / priceVals.length : 0
  const maxPrice  = priceVals.length ? Math.max(...priceVals) : 0

  function sortArrow(col: string) {
    if (itemSortCol !== col) return <span className="opacity-25 ml-1 text-xs">⇅</span>
    return itemSortDir === 1
      ? <span className="text-blue-500 ml-1 text-xs">↑</span>
      : <span className="text-blue-500 ml-1 text-xs">↓</span>
  }

  const dash = <span className="text-gray-300">—</span>

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">{menu.name}</h2>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded mt-1 inline-block">
            {country?.name ?? '—'}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-sm btn-outline" onClick={() => onEdit(menu)}>✏️ Edit</button>
          <div className="flex items-center gap-2">
            <label className="text-xs text-gray-400 whitespace-nowrap">🏷 Level</label>
            <select
              className="select select-sm"
              value={activeMenuLevel}
              onChange={e => onLevelChange(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Cost only (no prices) —</option>
              {priceLevels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <button className="btn btn-sm btn-outline" onClick={onApplyTax} title="Apply country default tax to all items">
            % Apply Tax
          </button>
          <button className="btn btn-sm btn-primary" onClick={onAddItem}>+ Add Item</button>
          <button className="btn btn-sm btn-ghost text-red-500" onClick={() => onDelete(menu.id)}>🗑</button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-5 gap-3 mb-4">
        {[
          { label: 'Items', value: String(items.length), cls: '' },
          { label: 'Avg COGS %', value: hasLevel && avgCogs ? `${avgCogs.toFixed(1)}%` : hasLevel ? '—' : 'Select level', cls: hasLevel && avgCogs ? cogsClass(avgCogs) : '' },
          { label: 'Max COGS %', value: hasLevel && maxCogs ? `${maxCogs.toFixed(1)}%` : '—', cls: hasLevel && maxCogs ? cogsClass(maxCogs) : '' },
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
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <input
          className="input input-sm flex-1 min-w-[160px]"
          placeholder="Search items…"
          value={itemFilterQ}
          onChange={e => onFilterQ(e.target.value)}
        />
        <select className="select select-sm" value={itemFilterType} onChange={e => onFilterType(e.target.value)}>
          <option value="">All Types</option>
          <option value="recipe">Recipe</option>
          <option value="ingredient">Ingredient</option>
        </select>
        <select className="select select-sm" value={itemFilterStatus} onChange={e => onFilterStatus(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="green">✓ Excellent</option>
          <option value="yellow">~ Acceptable</option>
          <option value="red">! Review</option>
        </select>
        <span className="text-xs text-gray-400 whitespace-nowrap">
          {filteredItems.length < items.length
            ? `${filteredItems.length} of ${items.length} items`
            : `${items.length} item${items.length !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Items table */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {[
                  { key: 'name',  label: 'Item' },
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
                    className={`px-3 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap ${!col.noSort ? 'cursor-pointer select-none hover:text-gray-700' : ''}`}
                    onClick={() => !col.noSort && onSort(col.key)}
                  >
                    {col.label}{!col.noSort && sortArrow(col.key)}
                  </th>
                ))}
                <th className="px-3 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sortedItems.length === 0 && (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400">
                  {items.length === 0 ? 'No items yet. Click Add Item above.' : 'No items match the current filter.'}
                </td></tr>
              )}
              {sortedItems.map(item => {
                const hasPrice = item.sell_price_gross > 0
                const cls = cogsClass(item.cogs_pct_net)
                const qty = item.qty % 1 === 0 ? String(item.qty) : item.qty.toFixed(2)
                const qtyLabel = `${qty} ${item.item_type === 'ingredient' ? item.base_unit_abbr : 'ptn'}`
                return (
                  <tr key={item.menu_item_id} className="hover:bg-gray-50">
                    <td className="px-3 py-2.5 font-medium text-gray-900">{item.display_name}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                        {item.item_type === 'ingredient' ? 'Ingredient' : 'Recipe'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs whitespace-nowrap">{qtyLabel}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{sym}{fmt2(item.cost_per_portion)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs">{hasPrice ? `${sym}${fmt2(item.sell_price_gross)}` : dash}</td>
                    <td className="px-3 py-2.5 text-center text-xs">
                      {hasPrice
                        ? <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{item.tax_rate_pct}%</span>
                        : dash}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold">{hasPrice ? `${sym}${fmt2(item.sell_price_net)}` : dash}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-xs ${item.gp_net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {hasPrice ? `${sym}${fmt2(item.gp_net)}` : dash}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs font-semibold">{hasPrice ? `${item.cogs_pct_net.toFixed(1)}%` : dash}</td>
                    <td className="px-3 py-2.5">
                      {hasPrice ? (
                        <Badge
                          label={cls === 'green' ? '✓ Excellent' : cls === 'yellow' ? '~ Acceptable' : '! Review'}
                          variant="neutral"
                        />
                      ) : dash}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1">
                        <button className="btn btn-xs btn-ghost" onClick={() => onEditItem(item)}>✏️</button>
                        <button className="btn btn-xs btn-ghost text-red-500" onClick={() => onDeleteItem(item.menu_item_id)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
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

  return (
    <Modal title={isEdit ? 'Edit Menu Item' : 'Add Item to Menu'} onClose={onClose}>
      <div className="space-y-4">
        {/* Type toggle */}
        <Field label="Item Type">
          <div className="flex gap-2">
            <button
              className={`btn btn-sm flex-1 ${miType === 'recipe' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onTypeChange('recipe')}
            >📖 Recipe</button>
            <button
              className={`btn btn-sm flex-1 ${miType === 'ingredient' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => onTypeChange('ingredient')}
            >📦 Ingredient</button>
          </div>
        </Field>

        {/* Selection */}
        {miType === 'recipe' ? (
          <Field label="Recipe *">
            <select className="select w-full" value={miRecipeId} onChange={e => onRecipeChange(Number(e.target.value))}>
              <option value="">— Select Recipe —</option>
              {recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Ingredient *">
            <select className="select w-full" value={miIngId} onChange={e => onIngChange(Number(e.target.value))}>
              <option value="">— Select Ingredient —</option>
              {ingredients.map(i => <option key={i.id} value={i.id}>{i.name}{i.base_unit_abbr ? ` (${i.base_unit_abbr})` : ''}</option>)}
            </select>
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

// ── Price Report ──────────────────────────────────────────────────────────────

interface PriceReportProps {
  data: PriceReportData | null; loading: boolean
  priceLevels: PriceLevel[]; selectedLevel: number | ''; grossNet: 'gross' | 'net'
  selCountries: Record<number, boolean>
  search: string; cat: string; cats: string[]; filtered: PriceReportRecipe[]
  groupBy: boolean
  onLevelChange(v: number | ''): void; onGrossNetChange(v: 'gross' | 'net'): void
  onToggleCountry(id: number, val: boolean): void
  onAllCountries(): void; onNoneCountries(): void
  onSearch(v: string): void; onCat(v: string): void
  onGroupBy(): void; onExport(): void
}

function PriceReport({ data, loading, priceLevels, selectedLevel, grossNet, selCountries,
  search, cat, cats, filtered, groupBy, onLevelChange, onGrossNetChange, onToggleCountry,
  onAllCountries, onNoneCountries, onSearch, onCat, onGroupBy, onExport }: PriceReportProps) {

  const [countryDropdown, setCountryDropdown] = useState(false)
  const allCols = data?.countries ?? []
  const cols    = allCols.filter(c => selCountries[c.id])
  const nSel    = cols.length
  const field   = grossNet === 'gross' ? 'sell_gross' : 'sell_net'

  const groups = useMemo(() => {
    if (!groupBy) return null
    const map: Record<string, PriceReportRecipe[]> = {}
    filtered.forEach(r => { const k = r.category || 'Uncategorised'; if (!map[k]) map[k] = []; map[k].push(r) })
    return map
  }, [filtered, groupBy])

  function renderRows(rows: PriceReportRecipe[]) {
    return rows.map(recipe => {
      const vals = cols.map(c => {
        const cd = recipe.countries[c.id]
        if (!cd?.on_menu) return null
        return (cd as any)[field] as number ?? null
      })
      const nums = vals.filter((v): v is number => v !== null)
      const avg  = nums.length && grossNet !== 'gross' ? nums.reduce((a, b) => a + b, 0) / nums.length : null
      const min  = nums.length > 1 ? Math.min(...nums) : null
      const max  = nums.length > 1 ? Math.max(...nums) : null

      return (
        <tr key={recipe.recipe_id} className="hover:bg-gray-50">
          <td className="px-3 py-2.5 font-medium text-gray-900 sticky left-0 bg-white">{recipe.recipe_name}</td>
          <td className="px-3 py-2.5 sticky left-[180px] bg-white">
            {recipe.category
              ? <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{recipe.category}</span>
              : <span className="text-gray-300 text-xs">—</span>}
          </td>
          {vals.map((v, i) => {
            if (v === null) return <td key={i} className="px-3 py-2.5 text-right text-gray-300 text-xs">—</td>
            const hl = v === min ? 'bg-green-50' : v === max ? 'bg-red-50' : ''
            return (
              <td key={i} className={`px-3 py-2.5 text-right font-mono text-xs ${hl}`}>
                {cols[i].symbol}{v.toFixed(2)}
              </td>
            )
          })}
          {avg !== null && (
            <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold bg-gray-50">
              {avg.toFixed(2)}
            </td>
          )}
        </tr>
      )
    })
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Controls */}
      <div className="bg-white rounded-lg border border-gray-200 mb-4">
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-gray-100">
          <span className="font-semibold text-gray-700">📈 Price Level Tool</span>
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            <input className="input input-sm w-40" placeholder="Filter recipes…" value={search} onChange={e => onSearch(e.target.value)} />
            <select className="select select-sm" value={cat} onChange={e => onCat(e.target.value)}>
              <option value="">All Categories</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {/* Country picker */}
            <div className="relative">
              <button className="btn btn-sm btn-outline" onClick={() => setCountryDropdown(v => !v)}>
                🌐 Countries {nSel < allCols.length ? `(${nSel}/${allCols.length})` : ''}
              </button>
              {countryDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 min-w-[180px]">
                  <div className="flex gap-2 p-2 border-b border-gray-100">
                    <button className="btn btn-xs btn-ghost" onClick={onAllCountries}>All</button>
                    <button className="btn btn-xs btn-ghost" onClick={onNoneCountries}>None</button>
                  </div>
                  <div className="max-h-52 overflow-y-auto p-1">
                    {allCols.map(c => (
                      <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 text-sm">
                        <input type="checkbox" checked={!!selCountries[c.id]} onChange={e => onToggleCountry(c.id, e.target.checked)} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">Level</span>
              <select className="select select-sm" value={selectedLevel} onChange={e => onLevelChange(e.target.value ? Number(e.target.value) : '')}>
                <option value="">Default price</option>
                {priceLevels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">Price</span>
              <select className="select select-sm" value={grossNet} onChange={e => onGrossNetChange(e.target.value as 'gross' | 'net')}>
                <option value="gross">Gross (incl. tax)</option>
                <option value="net">Net (excl. tax)</option>
              </select>
            </div>
            <button className={`btn btn-sm btn-outline ${groupBy ? 'ring-1 ring-blue-400' : ''}`} onClick={onGroupBy}>⬛ Group</button>
            <button className="btn btn-sm btn-outline" onClick={onExport}>⬇ Export CSV</button>
          </div>
        </div>

        {loading && <div className="p-8 text-center text-gray-400"><Spinner /></div>}
        {!loading && !data && <div className="p-8 text-center text-gray-400 text-sm">No data loaded yet.</div>}
        {!loading && data && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 min-w-[180px]">Recipe</th>
                  <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 sticky left-[180px] bg-gray-50 min-w-[110px]">Category</th>
                  {cols.map(c => (
                    <th key={c.id} className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 min-w-[130px]">
                      <div>{c.name}</div>
                      <div className="font-normal text-gray-400">{c.symbol} {c.code} · {grossNet}</div>
                    </th>
                  ))}
                  {grossNet === 'net' && cols.length > 1 && (
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 bg-gray-100 min-w-[110px]">Avg</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.length === 0 && (
                  <tr><td colSpan={2 + cols.length + 1} className="px-4 py-8 text-center text-sm text-gray-400">No recipes found.</td></tr>
                )}
                {groups
                  ? Object.entries(groups).map(([groupName, rows]) => (
                    <>
                      <tr key={groupName} className="bg-gray-50">
                        <td colSpan={2 + cols.length + 1} className="px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                          {groupName} <span className="font-normal text-gray-400">({rows.length})</span>
                        </td>
                      </tr>
                      {renderRows(rows)}
                    </>
                  ))
                  : renderRows(filtered)
                }
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Level Report ──────────────────────────────────────────────────────────────

interface LevelReportProps {
  countries: Country[]; data: LevelReportData | null; loading: boolean
  countryId: number | ''; grossNet: 'gross' | 'net'
  search: string; menuFilter: string; menuNames: string[]
  filteredItems: LevelReportItem[]; saving: Record<string, boolean>; saved: Record<string, boolean>
  onCountryChange(v: number | ''): void; onGrossNetChange(v: 'gross' | 'net'): void
  onSearch(v: string): void; onMenuFilter(v: string): void
  onSavePrice(menuItemId: number, levelId: number, value: string, orig: string): void
  onExport(): void
}

function LevelReport({ countries, data, loading, countryId, grossNet, search, menuFilter, menuNames,
  filteredItems, saving, saved, onCountryChange, onGrossNetChange, onSearch, onMenuFilter, onSavePrice, onExport }: LevelReportProps) {

  const levels  = data?.levels ?? []
  const country = data?.country
  const sym     = country?.symbol ?? ''

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="p-4 flex flex-wrap gap-3 items-center border-b border-gray-100">
          <span className="font-semibold text-gray-700">🏷 Market Price Tool</span>
          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-xs text-gray-400">Market</span>
            <select
              className="select select-sm min-w-[160px]"
              value={countryId}
              onChange={e => onCountryChange(e.target.value ? Number(e.target.value) : '')}
            >
              <option value="">— Select market —</option>
              {countries.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-gray-400">Price</span>
            <select className="select select-sm" value={grossNet} onChange={e => onGrossNetChange(e.target.value as 'gross' | 'net')}>
              <option value="gross">Gross (incl. tax)</option>
              <option value="net">Net (excl. tax)</option>
            </select>
          </div>
          <input className="input input-sm w-40" placeholder="Filter items…" value={search} onChange={e => onSearch(e.target.value)} />
          <select className="select select-sm" value={menuFilter} onChange={e => onMenuFilter(e.target.value)}>
            <option value="">All Menus</option>
            {menuNames.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn btn-sm btn-outline" onClick={onExport}>⬇ Export CSV</button>
        </div>

        {!countryId && <div className="p-8 text-center text-sm text-gray-400">Select a market to load the report.</div>}
        {countryId && loading && <div className="p-8 text-center"><Spinner /></div>}
        {countryId && !loading && data && (
          <>
            <div className="px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
              {grossNet === 'gross'
                ? `Gross prices in ${sym} ${country?.code}. Click any cell to edit.`
                : `Net prices in ${sym} ${country?.code}. Switch to Gross to edit.`}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 sticky left-0 bg-gray-50 min-w-[180px]">Item</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 sticky left-[180px] bg-gray-50 min-w-[110px]">Menu</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 min-w-[90px]">Cost</th>
                    {levels.map(l => (
                      <th key={l.id} className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 min-w-[130px]">{l.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredItems.length === 0 && (
                    <tr><td colSpan={3 + levels.length} className="px-4 py-8 text-center text-sm text-gray-400">No items match the current filter.</td></tr>
                  )}
                  {filteredItems.map(item => (
                    <tr key={item.menu_item_id} className="hover:bg-gray-50">
                      <td className="px-3 py-2.5 sticky left-0 bg-white">
                        <div className="font-medium text-gray-900">{item.display_name}</div>
                        {item.item_type === 'ingredient' && (
                          <div className="text-xs text-gray-400">ingredient</div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 sticky left-[180px] bg-white text-sm text-gray-600">{item.menu_name}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">{sym}{fmt2(item.cost)}</td>
                      {levels.map(level => {
                        const ld = item.levels[level.id]
                        const key = `${item.menu_item_id}_${level.id}`
                        const isSaving = saving[key]
                        const isSaved  = saved[key]

                        if (grossNet === 'gross') {
                          const orig = ld?.set && ld.gross !== null ? fmt2(ld.gross) : ''
                          return (
                            <LrPriceCell
                              key={level.id}
                              sym={sym}
                              gross={ld?.gross ?? null}
                              cogs={ld?.cogs_pct ?? null}
                              saving={isSaving}
                              saved={isSaved}
                              onBlur={(val) => onSavePrice(item.menu_item_id, level.id, val, orig)}
                            />
                          )
                        } else {
                          const net = ld?.set && ld.net !== null ? `${sym}${fmt2(ld.net)}` : null
                          const cogs = ld?.cogs_pct ?? null
                          return (
                            <td key={level.id} className="px-3 py-2.5 text-right">
                              <div className="font-mono text-xs font-semibold">{net ?? <span className="text-gray-300">—</span>}</div>
                              {cogs !== null && net && (
                                <div className={`text-xs mt-0.5 inline-block px-1 rounded ${
                                  cogs <= 28 ? 'bg-green-100 text-green-700' : cogs <= 35 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
                                }`}>{cogs.toFixed(1)}%</div>
                              )}
                            </td>
                          )
                        }
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

// ── Level Report Price Cell (inline editable) ─────────────────────────────────

function LrPriceCell({ sym, gross, cogs, saving, saved, onBlur }: {
  sym: string; gross: number | null; cogs: number | null
  saving?: boolean; saved?: boolean
  onBlur(val: string): void
}) {
  const origRef = useRef(gross !== null ? fmt2(gross) : '')
  const [val, setVal] = useState(gross !== null ? fmt2(gross) : '')

  useEffect(() => {
    const v = gross !== null ? fmt2(gross) : ''
    origRef.current = v
    setVal(v)
  }, [gross])

  const cogsCls = cogs !== null
    ? cogs <= 28 ? 'bg-green-100 text-green-700' : cogs <= 35 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'
    : ''

  return (
    <td className={`px-2 py-2 ${saving ? 'opacity-50' : ''} ${saved ? 'bg-green-50' : ''}`}>
      <div className="flex items-center border rounded px-1.5 bg-white focus-within:ring-1 focus-within:ring-blue-400">
        <span className="text-gray-400 text-xs mr-0.5">{sym}</span>
        <input
          type="number" min="0" step="0.01"
          className="w-20 py-1 text-xs font-mono outline-none bg-transparent"
          value={val}
          placeholder="—"
          onChange={e => setVal(e.target.value)}
          onBlur={() => onBlur(val)}
          onKeyDown={e => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { setVal(origRef.current); e.currentTarget.blur() }
          }}
        />
      </div>
      {cogs !== null && gross !== null && gross > 0 && (
        <div className={`text-xs mt-0.5 inline-block px-1 rounded ${cogsCls}`}>{cogs.toFixed(1)}%</div>
      )}
    </td>
  )
}
