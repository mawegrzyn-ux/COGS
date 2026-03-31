import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ingredient { id: number; name: string; category: string | null; base_unit_id: number | null; base_unit_abbr: string | null; default_prep_unit: string | null; default_prep_to_base_conversion: number; waste_pct: number }
interface Recipe     { id: number; name: string; category: string | null; description: string | null; yield_qty: number; yield_unit_id: number | null; yield_unit_abbr: string | null; item_count: number }

interface RecipeItem {
  id:                     number
  recipe_id:              number
  item_type:              'ingredient' | 'recipe'
  ingredient_id:          number | null
  recipe_item_id:         number | null
  prep_qty:               number
  prep_unit:              string | null
  prep_to_base_conversion:number
  ingredient_name?:       string
  base_unit_abbr?:        string
  sub_recipe_name?:       string
  sub_recipe_yield_qty?:  number
  waste_pct?:             number
  cost?:                  number | null
  quote_is_preferred?:    boolean | null
}

interface PlVariationCost {
  lines:            RecipeItem[]
  total_cost_base:  number
  total_cost_local: number
  cost_per_portion: number
  coverage: 'fully_preferred' | 'fully_quoted' | 'partially_quoted' | 'not_quoted'
  variant_source?:  'market_pl' | 'market' | 'pl' | 'global'
}

interface CogsByCountry {
  country_id:          number
  country_name:        string
  currency_code:       string
  currency_symbol:     string
  exchange_rate:       number
  total_cost_base:     number
  total_cost_local:    number
  cost_per_portion:    number
  coverage: 'fully_preferred' | 'fully_quoted' | 'partially_quoted' | 'not_quoted'
  has_variation:       boolean
  variation_id:        number | null
  lines:               RecipeItem[]
  pl_variation_costs:  Record<string, PlVariationCost>  // keyed by price_level_id string
}

interface RecipeVariation {
  id:           number
  country_id:   number
  country_name: string
  items:        RecipeItem[]
}

interface PlVariation {
  id:               number
  price_level_id:   number
  price_level_name: string
  items:            RecipeItem[]
}

interface MarketPlVariation {
  id:               number
  country_id:       number
  price_level_id:   number
  country_name:     string
  price_level_name: string
  items:            RecipeItem[]
}

interface Country {
  id:             number
  name:           string
  currency_code:  string
  currency_symbol:string
  exchange_rate:  number
}

interface PriceLevel {
  id:         number
  name:       string
  is_default: boolean
}

interface RecipeDetail extends Recipe {
  items:                RecipeItem[]
  variations:           RecipeVariation[]
  pl_variations?:       PlVariation[]
  market_pl_variations?: MarketPlVariation[]
  cogs_by_country:      CogsByCountry[]
}

type ItemSortField = 'custom' | 'name' | 'qty' | 'cost'

interface MenuAssignment {
  menu_id: number
  menu_name: string
  country_name: string
  country_id: number
  exchange_rate: number
  currency_symbol: string
  menu_item_id: number
  display_name: string
  sell_price_gross: number
  sell_price_net: number
  cogs_pct_net: number | null
  tax_name: string
}

interface SimpleMenu {
  id: number
  name: string
  country_id: number
  country_name: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt     = (n: number | string | null | undefined, dp = 3) => Number(n ?? 0).toFixed(dp)
const fmtCost = (n: number | string | null | undefined) => Number(n ?? 0).toFixed(2)

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecipesPage() {
  const api      = useApi()
  const navigate = useNavigate()

  const [recipes,      setRecipes]      = useState<Recipe[]>([])
  const [ingredients,  setIngredients]  = useState<Ingredient[]>([])
  const [apiCategories,setApiCategories]= useState<string[]>([])
  const [loading,      setLoading]      = useState(true)
  const [panelWidth,   setPanelWidth]   = useState(288) // px, default w-72
  const [selected,     setSelected]     = useState<RecipeDetail | null>(null)
  const [loadingDetail,setLoadingDetail]= useState(false)
  const [selectedCountryId, setSelectedCountryId] = useState<number | '' | 'GLOBAL'>('')
  const [selectedCurrencyCode, setSelectedCurrencyCode] = useState<string>('')
  const [countries, setCountries] = useState<Country[]>([])

  // modals
  const [recipeModal,  setRecipeModal]  = useState<'new' | Recipe | null>(null)
  const [itemModal,    setItemModal]    = useState(false)
  const [editItemModal,setEditItemModal]= useState<RecipeItem | null>(null)
  const [confirmDelete,setConfirmDelete]= useState<{ type: 'recipe' | 'item' | 'variation' | 'copy-to-global' | 'pl-variation' | 'pl-copy-to-global' | 'market-pl-variation'; id: number } | null>(null)
  const [itemModalForVariation, setItemModalForVariation] = useState<number | null>(null) // variation_id when adding to a variation
  const [itemModalForPlVariation, setItemModalForPlVariation] = useState<number | null>(null) // pl_variation_id when adding to a PL variation
  const [itemModalForMarketPlVariation, setItemModalForMarketPlVariation] = useState<number | null>(null) // market_pl_variation_id when adding to a market+PL variation
  const [variantMode, setVariantMode] = useState<'market' | 'price-level' | 'market-pl'>('market')
  const [showComparison,        setShowComparison]        = useState(false)

  // ── Ingredient list sort + drag-to-reorder ────────────────────────────────
  const [itemSortField, setItemSortField] = useState<ItemSortField>('custom')
  const [itemSortDir,   setItemSortDir]   = useState<'asc' | 'desc'>('asc')
  const [dragId,        setDragId]        = useState<number | null>(null)
  const [dragOverId,    setDragOverId]    = useState<number | null>(null)

  const [menus,               setMenus]               = useState<SimpleMenu[]>([])
  const [menuAssignments,     setMenuAssignments]      = useState<MenuAssignment[]>([])
  const [selectedMenuId,      setSelectedMenuId]       = useState<number | null>(null)
  const [loadingMenuAssign,   setLoadingMenuAssign]    = useState(false)
  const [priceLevels,         setPriceLevels]         = useState<PriceLevel[]>([])
  const [selectedPriceLevelId,setSelectedPriceLevelId]= useState<number | null>(null)
  const [addToMenuModal,      setAddToMenuModal]      = useState(false)
  const [addToMenuTargetId,   setAddToMenuTargetId]   = useState<number | null>(null)
  const [addToMenuDisplayName,setAddToMenuDisplayName]= useState('')
  const [addToMenuPrices,     setAddToMenuPrices]     = useState<Record<number, string>>({})
  const [addToMenuSaving,     setAddToMenuSaving]     = useState(false)
  const [menuAssignVersion,   setMenuAssignVersion]   = useState(0)
  const [editingMenuPrice,    setEditingMenuPrice]    = useState<{ menu_item_id: number; level_id: number; value: string } | null>(null)
  const [editingTilePrice,    setEditingTilePrice]    = useState<string | null>(null)

  // search/filter
  const [search,     setSearch]     = useState('')
  const [filterCat,  setFilterCat]  = useState('')
  const [sortField,  setSortField]  = useState<'name'|'category'|'yield_qty'>('name')
  const [sortDir,    setSortDir]    = useState<'asc'|'desc'>('asc')

  // toast
  const [toast, setToast] = useState<{ msg: string; type?: 'error' } | null>(null)
  const showToast = (msg: string, type?: 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  // allergen map — loaded once, used in ingredient rows
  const [ingAllergenMap, setIngAllergenMap] = useState<Map<number, { code: string; status: string }[]>>(new Map())
  useEffect(() => {
    api.get('/allergens/ingredients').then((rows: { ingredient_id: number; code: string; status: string }[]) => {
      const m = new Map<number, { code: string; status: string }[]>()
      for (const row of (rows || [])) {
        if (!m.has(row.ingredient_id)) m.set(row.ingredient_id, [])
        m.get(row.ingredient_id)!.push({ code: row.code, status: row.status })
      }
      setIngAllergenMap(m)
    }).catch(() => {})
  }, [api])

  useEffect(() => {
    api.get('/countries').then((d: Country[]) => setCountries(d || [])).catch(() => {})
  }, [api])

  useEffect(() => {
    api.get('/menus').then((d: SimpleMenu[]) => setMenus(d || [])).catch(() => {})
  }, [api])

  useEffect(() => {
    api.get('/price-levels').then((d: PriceLevel[]) => {
      const levels = d || []
      setPriceLevels(levels)
      // Default to the is_default level
      const def = levels.find(l => l.is_default)
      if (def) setSelectedPriceLevelId(def.id)
    }).catch(() => {})
  }, [api])

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, i, cats] = await Promise.all([
        api.get('/recipes'),
        api.get('/ingredients'),
        api.get('/categories?type=recipe'),
      ])
      setRecipes(r || [])
      setIngredients(i || [])
      setApiCategories((cats || []).map((c: { name: string }) => c.name).sort())
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (id: number) => {
    setLoadingDetail(true)
    setSelected(null)
    try {
      const d = await api.get(`/recipes/${id}`)
      setSelected(d)
      setSelectedCountryId(prev => {
        if (prev === 'GLOBAL') return 'GLOBAL'
        const available = d.cogs_by_country?.map((c: CogsByCountry) => c.country_id) ?? []
        if (typeof prev === 'number' && available.includes(prev)) return prev
        return d.cogs_by_country?.[0]?.country_id ?? ''
      })
    } finally {
      setLoadingDetail(false)
    }
  }, [api])

  // Fetch menu assignments for this recipe across ALL markets
  useEffect(() => {
    if (!selected || !menus.length) {
      setMenuAssignments([])
      setSelectedMenuId(null)
      return
    }

    setLoadingMenuAssign(true)
    const lvlParam = selectedPriceLevelId ? `&price_level_id=${selectedPriceLevelId}` : ''
    Promise.all(
      menus.map(m =>
        api.get(`/cogs/menu/${m.id}?market_id=${m.country_id}${lvlParam}`)
          .then((res: any) => ({ menu: m, res }))
          .catch(() => null)
      )
    ).then(results => {
      const found: MenuAssignment[] = []
      ;(results as Array<{ menu: SimpleMenu; res: any } | null>).forEach(r => {
        if (!r) return
        const item = r.res?.items?.find((it: any) => it.recipe_id === selected.id)
        if (item) {
          const country = countries.find(c => c.id === r.menu.country_id)
          found.push({
            menu_id:          r.menu.id,
            menu_name:        r.menu.name,
            country_name:     r.menu.country_name,
            country_id:       r.menu.country_id,
            exchange_rate:    country?.exchange_rate ?? 1,
            currency_symbol:  country?.currency_symbol ?? '$',
            menu_item_id:     item.menu_item_id,
            display_name:     item.display_name,
            sell_price_gross: item.sell_price_gross ?? 0,
            sell_price_net:   item.sell_price_net   ?? 0,
            cogs_pct_net:     item.cogs_pct_net     ?? null,
            tax_name:         item.tax_name         ?? '',
          })
        }
      })
      setMenuAssignments(found)
      setSelectedMenuId(found.length > 0 ? found[0].menu_id : null)
    }).finally(() => setLoadingMenuAssign(false))
  }, [selected?.id, selectedPriceLevelId, menus, countries, api, menuAssignVersion])

  // ── Derived ───────────────────────────────────────────────────────────────

  const categories = useMemo(() => {
    const fromRecipes = recipes.map(r => r.category).filter(Boolean) as string[]
    return [...new Set([...apiCategories, ...fromRecipes])].sort()
  }, [recipes, apiCategories])

  const filtered = useMemo(() => {
    let r = [...recipes]
    if (search)    r = r.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || (x.category||'').toLowerCase().includes(search.toLowerCase()))
    if (filterCat) r = r.filter(x => x.category === filterCat)
    r.sort((a, b) => {
      const av = a[sortField] ?? '', bv = b[sortField] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return r
  }, [recipes, search, filterCat, sortField, sortDir])

  const activeCogs = useMemo(() => {
    if (selectedCountryId === 'GLOBAL') return null
    const base = selected?.cogs_by_country.find(c => c.country_id === selectedCountryId)
      ?? selected?.cogs_by_country[0]
      ?? null
    if (!base) return null
    // market+PL and price-level modes both use pl_variation_costs (backend already applies 4-level priority)
    if ((variantMode === 'market-pl' || variantMode === 'price-level') && selectedPriceLevelId) {
      const plCost = base.pl_variation_costs?.[String(selectedPriceLevelId)]
      if (plCost) {
        return {
          ...base,
          lines:            plCost.lines,
          total_cost_base:  plCost.total_cost_base,
          total_cost_local: plCost.total_cost_local,
          cost_per_portion: plCost.cost_per_portion,
          coverage:         plCost.coverage,
        }
      }
    }
    return base
  }, [selected, selectedCountryId, variantMode, selectedPriceLevelId])

  // Currency display
  const displayCurrency = useMemo(() => {
    if (selectedCurrencyCode === '__BASE__') return { code: 'USD', symbol: '$', rate: 1 }
    if (selectedCurrencyCode && selectedCurrencyCode !== '__MARKET__') {
      const c = countries.find(c => c.currency_code === selectedCurrencyCode)
      if (c) return { code: c.currency_code, symbol: c.currency_symbol, rate: Number(c.exchange_rate) }
    }
    // __MARKET__ or empty → use market/active country currency
    if (activeCogs) return { code: activeCogs.currency_code, symbol: activeCogs.currency_symbol, rate: Number(activeCogs.exchange_rate) }
    return { code: 'USD', symbol: '$', rate: 1 }
  }, [selectedCurrencyCode, countries, activeCogs])

  // Active items for display: variation items if a variation exists for selected country, else global
  const activeVariation = useMemo(() => {
    if (!selected || selectedCountryId === '' || selectedCountryId === 'GLOBAL') return null
    return selected.variations?.find(v => v.country_id === selectedCountryId) ?? null
  }, [selected, selectedCountryId])

  const activePlVariation = useMemo(() => {
    if (!selected || !selectedPriceLevelId || variantMode !== 'price-level') return null
    return selected.pl_variations?.find(v => v.price_level_id === selectedPriceLevelId) ?? null
  }, [selected, selectedPriceLevelId, variantMode])

  const activeMarketPlVariation = useMemo(() => {
    if (!selected || !selectedPriceLevelId || variantMode !== 'market-pl' || selectedCountryId === '' || selectedCountryId === 'GLOBAL') return null
    return selected.market_pl_variations?.find(
      v => v.country_id === selectedCountryId && v.price_level_id === selectedPriceLevelId
    ) ?? null
  }, [selected, selectedPriceLevelId, variantMode, selectedCountryId])

  const activeItems = useMemo(() => {
    if (variantMode === 'market-pl' && activeMarketPlVariation) return activeMarketPlVariation.items
    if (variantMode === 'price-level' && activePlVariation) return activePlVariation.items
    if (variantMode === 'market' && activeVariation) return activeVariation.items
    return selected?.items ?? []
  }, [variantMode, activeMarketPlVariation, activePlVariation, activeVariation, selected])

  // Sorted view of activeItems — 'custom' preserves DB sort_order
  const displayItems = useMemo(() => {
    if (itemSortField === 'custom') return activeItems
    const costFor = (item: RecipeItem) => {
      const line = activeCogs?.lines.find(l => l.id === item.id)
      return line?.cost ?? -1
    }
    return [...activeItems].sort((a, b) => {
      let cmp = 0
      if (itemSortField === 'name') {
        const an = (a.ingredient_name || a.sub_recipe_name || '').toLowerCase()
        const bn = (b.ingredient_name || b.sub_recipe_name || '').toLowerCase()
        cmp = an < bn ? -1 : an > bn ? 1 : 0
      } else if (itemSortField === 'qty') {
        cmp = Number(a.prep_qty) - Number(b.prep_qty)
      } else if (itemSortField === 'cost') {
        cmp = costFor(a) - costFor(b)
      }
      return itemSortDir === 'asc' ? cmp : -cmp
    })
  }, [activeItems, itemSortField, itemSortDir, activeCogs])

  // Unique currencies for the selector (deduplicated by code)
  const currencyOptions = useMemo(() => {
    const seen = new Set<string>()
    return countries
      .filter(c => { if (seen.has(c.currency_code)) return false; seen.add(c.currency_code); return true })
      .map(c => ({ code: c.currency_code, symbol: c.currency_symbol }))
      .sort((a, b) => a.code.localeCompare(b.code))
  }, [countries])

  // Comparison data: ingredient diff between global and active variation
  const comparisonData = useMemo(() => {
    if (!showComparison || !activeVariation || !selected) return null
    const globalItems = selected.items
    const varItems    = activeVariation.items
    const getName     = (i: RecipeItem) => i.ingredient_name || i.sub_recipe_name || String(i.id)
    const globalNames = new Set(globalItems.map(getName))
    const varNames    = new Set(varItems.map(getName))
    return { globalItems, varItems, globalNames, varNames }
  }, [showComparison, activeVariation, selected])

  // ── Recipe CRUD ───────────────────────────────────────────────────────────

  const saveRecipe = async (form: RecipeForm) => {
    const isNew = recipeModal === 'new'
    const payload = {
      name:            form.name.trim(),
      category:        form.category.trim() || null,
      description:     form.description.trim() || null,
      yield_qty:       Number(form.yield_qty) || 1,
      yield_unit_text: form.yield_unit_text.trim() || null,
    }
    if (!payload.name) return showToast('Name is required', 'error')
    try {
      if (isNew) {
        const r = await api.post('/recipes', payload)
        setRecipes(prev => [...prev, r].sort((a,b) => a.name.localeCompare(b.name)))
        showToast('Recipe created')
        setRecipeModal(null)
        loadDetail(r.id)
      } else {
        const r = await api.put(`/recipes/${(recipeModal as Recipe).id}`, payload)
        setRecipes(prev => prev.map(x => x.id === r.id ? { ...x, ...r } : x))
        if (selected?.id === r.id) setSelected(prev => prev ? { ...prev, ...r } : prev)
        showToast('Recipe saved')
        setRecipeModal(null)
      }
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    }
  }

  const deleteRecipe = async (id: number) => {
    try {
      await api.delete(`/recipes/${id}`)
      setRecipes(prev => prev.filter(r => r.id !== id))
      if (selected?.id === id) setSelected(null)
      showToast('Recipe deleted')
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  const addItem = async (form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/items`, {
        item_type:              form.item_type,
        ingredient_id:          form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:         form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:               Number(form.prep_qty),
        prep_unit:              form.prep_unit.trim() || null,
        prep_to_base_conversion:Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added')
      setItemModal(false)
      loadDetail(selected.id)
    } catch (err: any) {
      showToast(err.message || 'Add failed', 'error')
    }
  }

  // Save & stay open for rapid sequential entry
  const addItemAndNext = async (form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/items`, {
        item_type:              form.item_type,
        ingredient_id:          form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:         form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:               Number(form.prep_qty),
        prep_unit:              form.prep_unit.trim() || null,
        prep_to_base_conversion:Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added')
      loadDetail(selected.id)
      // modal stays open — ItemFormModal resets itself
    } catch (err: any) {
      showToast(err.message || 'Add failed', 'error')
    }
  }

  const updateItem = async (form: ItemForm) => {
    if (!selected || !editItemModal) return
    try {
      await api.put(`/recipes/${selected.id}/items/${editItemModal.id}`, {
        prep_qty:               Number(form.prep_qty),
        prep_unit:              form.prep_unit.trim() || null,
        prep_to_base_conversion:Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setEditItemModal(null)
      loadDetail(selected.id)
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    }
  }

  // ── Column sort toggle ────────────────────────────────────────────────────
  function cycleItemSort(field: ItemSortField) {
    if (itemSortField === field) {
      if (itemSortDir === 'asc') { setItemSortDir('desc') }
      else { setItemSortField('custom'); setItemSortDir('asc') }
    } else {
      setItemSortField(field); setItemSortDir('asc')
    }
  }

  // ── Drag-to-reorder ───────────────────────────────────────────────────────
  const reorderItems = useCallback(async (fromId: number, toId: number) => {
    if (!selected || fromId === toId) return
    const list = activeMarketPlVariation ? activeMarketPlVariation.items : activePlVariation ? activePlVariation.items : activeVariation ? activeVariation.items : selected.items
    const fromIdx = list.findIndex(i => i.id === fromId)
    const toIdx   = list.findIndex(i => i.id === toId)
    if (fromIdx < 0 || toIdx < 0) return

    const next = [...list]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)

    // Optimistic update
    setSelected(prev => {
      if (!prev) return prev
      if (activeMarketPlVariation) {
        return {
          ...prev,
          market_pl_variations: (prev.market_pl_variations ?? []).map(v =>
            v.id === activeMarketPlVariation.id ? { ...v, items: next } : v
          ),
        }
      }
      if (activePlVariation) {
        return {
          ...prev,
          pl_variations: (prev.pl_variations ?? []).map(v =>
            v.id === activePlVariation.id ? { ...v, items: next } : v
          ),
        }
      }
      if (activeVariation) {
        return {
          ...prev,
          variations: prev.variations.map(v =>
            v.id === activeVariation.id ? { ...v, items: next } : v
          ),
        }
      }
      return { ...prev, items: next }
    })

    try {
      await api.patch(`/recipes/${selected.id}/items/reorder`, { order: next.map(i => i.id) })
    } catch {
      showToast('Failed to save order', 'error')
      loadDetail(selected.id)
    }
  }, [selected, activePlVariation, activeVariation, api, loadDetail])

  const deleteItem = async (itemId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/items/${itemId}`)
      showToast('Item removed')
      loadDetail(selected.id)
    } catch (err: any) {
      showToast(err.message || 'Delete failed', 'error')
    }
  }

  const createVariation = async (countryId: number, copyGlobal: boolean) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/variations`, { country_id: countryId, copy_global: copyGlobal })
      showToast(`Market variation created`)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to create variation', 'error') }
  }

  const deleteVariation = async (varId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/variations/${varId}`)
      showToast('Variation deleted — reverted to global recipe')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to delete variation', 'error') }
  }

  const copyVariationToGlobal = async (varId: number) => {
    if (!selected) return
    try {
      const { copied } = await api.post(`/recipes/${selected.id}/variations/${varId}/copy-to-global`, {})
      showToast(`Copied ${copied} ingredient${copied !== 1 ? 's' : ''} to global recipe`)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to copy to global', 'error') }
  }

  const addVariationItem = async (varId: number, form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/variations/${varId}/items`, {
        item_type:               form.item_type,
        ingredient_id:           form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:          form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added to variation')
      setItemModal(false)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Add failed', 'error') }
  }

  const addVariationItemAndNext = async (varId: number, form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/variations/${varId}/items`, {
        item_type:               form.item_type,
        ingredient_id:           form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:          form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added to variation')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Add failed', 'error') }
  }

  const updateVariationItem = async (varId: number, form: ItemForm) => {
    if (!selected || !editItemModal) return
    try {
      await api.put(`/recipes/${selected.id}/variations/${varId}/items/${editItemModal.id}`, {
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setEditItemModal(null)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Update failed', 'error') }
  }

  const deleteVariationItem = async (varId: number, itemId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/variations/${varId}/items/${itemId}`)
      showToast('Item removed from variation')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error') }
  }

  // ── PL Variation CRUD ─────────────────────────────────────────────────────

  const createPlVariation = async (priceLevelId: number, copyGlobal: boolean) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/pl-variations`, { price_level_id: priceLevelId, copy_global: copyGlobal })
      showToast('Price level variation created')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to create PL variation', 'error') }
  }

  const deletePlVariation = async (varId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/pl-variations/${varId}`)
      showToast('Price level variation deleted — reverted to global recipe')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to delete PL variation', 'error') }
  }

  const copyPlVariationToGlobal = async (varId: number) => {
    if (!selected) return
    try {
      const { copied } = await api.post(`/recipes/${selected.id}/pl-variations/${varId}/copy-to-global`, {})
      showToast(`Copied ${copied} ingredient${copied !== 1 ? 's' : ''} to global recipe`)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to copy to global', 'error') }
  }

  const addPlVariationItem = async (varId: number, form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/pl-variations/${varId}/items`, {
        item_type:               form.item_type,
        ingredient_id:           form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:          form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added to PL variation')
      setItemModal(false)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Add failed', 'error') }
  }

  const addPlVariationItemAndNext = async (varId: number, form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/pl-variations/${varId}/items`, {
        item_type:               form.item_type,
        ingredient_id:           form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:          form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added to PL variation')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Add failed', 'error') }
  }

  const updatePlVariationItem = async (varId: number, form: ItemForm) => {
    if (!selected || !editItemModal) return
    try {
      await api.put(`/recipes/${selected.id}/pl-variations/${varId}/items/${editItemModal.id}`, {
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setEditItemModal(null)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Update failed', 'error') }
  }

  const deletePlVariationItem = async (varId: number, itemId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/pl-variations/${varId}/items/${itemId}`)
      showToast('Item removed from PL variation')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error') }
  }

  // ── Market+PL Variation CRUD ───────────────────────────────────────────────

  const createMarketPlVariation = async (countryId: number, priceLevelId: number, copyFrom: 'global' | 'market' | 'pl' | null) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/market-pl-variations`, {
        country_id:     countryId,
        price_level_id: priceLevelId,
        copy_from:      copyFrom,
      })
      showToast('Market+PL variation created')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to create market+PL variation', 'error') }
  }

  const deleteMarketPlVariation = async (varId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/market-pl-variations/${varId}`)
      showToast('Market+PL variation deleted')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Failed to delete market+PL variation', 'error') }
  }

  const addMarketPlVariationItem = async (varId: number, form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/market-pl-variations/${varId}/items`, {
        item_type:               form.item_type,
        ingredient_id:           form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:          form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added to market+PL variation')
      setItemModal(false)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Add failed', 'error') }
  }

  const addMarketPlVariationItemAndNext = async (varId: number, form: ItemForm) => {
    if (!selected) return
    try {
      await api.post(`/recipes/${selected.id}/market-pl-variations/${varId}/items`, {
        item_type:               form.item_type,
        ingredient_id:           form.item_type === 'ingredient' ? Number(form.ingredient_id) : null,
        recipe_item_id:          form.item_type === 'recipe'     ? Number(form.recipe_item_id) : null,
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Ingredient added to market+PL variation')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Add failed', 'error') }
  }

  const updateMarketPlVariationItem = async (varId: number, form: ItemForm) => {
    if (!selected || !editItemModal) return
    try {
      await api.put(`/recipes/${selected.id}/market-pl-variations/${varId}/items/${editItemModal.id}`, {
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setEditItemModal(null)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Update failed', 'error') }
  }

  const deleteMarketPlVariationItem = async (varId: number, itemId: number) => {
    if (!selected) return
    try {
      await api.delete(`/recipes/${selected.id}/market-pl-variations/${varId}/items/${itemId}`)
      showToast('Item removed from market+PL variation')
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Delete failed', 'error') }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const recipeCogsColour = (pct: number | null): string => {
    if (pct == null) return 'text-text-3'
    if (pct <= 30)   return 'text-emerald-600'
    if (pct <= 40)   return 'text-amber-500'
    return 'text-red-500'
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Recipes"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-1">
            <span>Build recipes from your ingredient library. COGS is calculated via preferred vendor quotes per country.</span>
            {recipes.length > 0 && (
              <span className="flex items-center gap-x-2 ml-2 text-text-3">
                <span><span className="font-semibold text-text-1">{recipes.length}</span> recipes</span>
                <span className="text-border select-none">·</span>
                <span><span className="font-semibold text-text-1">{ingredients.length}</span> ingredients</span>
                <span className="text-border select-none">·</span>
                <span><span className="font-semibold text-text-1">{categories.length}</span> categories</span>
              </span>
            )}
          </span>
        }
        tutorialPrompt="Walk me through building a Recipe in COGS Manager. How do I create a recipe, add ingredients with quantities and units, use sub-recipes, set yield, and what does the COGS cost-per-portion figure mean and how is it calculated?"
        action={
          <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={() => setRecipeModal('new')}
            title="New Recipe (Alt+N)">
            <PlusIcon /> New Recipe <kbd className="ml-0.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Alt+N</kbd>
          </button>
        }
      />

      {/* Alt+N → New Recipe */}
      <AltNShortcut onTrigger={() => setRecipeModal('new')} active={recipeModal === null} />

      {/* Split layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: recipe list ── */}
        <div className="flex flex-col border-r border-border bg-surface overflow-hidden" style={{ width: panelWidth, minWidth: 200, maxWidth: 520, flexShrink: 0 }}>
          {/* Search + filter */}
          <div className="p-3 border-b border-border flex flex-col gap-2">
            <div className="relative">
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-3" />
              <input
                type="search" placeholder="Search recipes…"
                value={search} onChange={e => setSearch(e.target.value)}
                className="input pl-8 w-full text-sm"
              />
            </div>
            <div className="flex gap-2">
              <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className="input text-xs flex-1">
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={sortField} onChange={e => setSortField(e.target.value as any)} className="input text-xs w-28">
                <option value="name">Name</option>
                <option value="category">Category</option>
                <option value="yield_qty">Yield</option>
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                className="btn-outline px-2 text-xs"
                title="Toggle sort direction"
              >{sortDir === 'asc' ? '↑' : '↓'}</button>
            </div>
          </div>

          {/* Recipe list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center p-8"><Spinner /></div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-center text-text-3 text-sm">
                {search || filterCat ? 'No recipes match.' : 'No recipes yet.'}
              </div>
            ) : (
              filtered.map(r => (
                <button
                  key={r.id}
                  onClick={() => loadDetail(r.id)}
                  className={[
                    'w-full text-left px-4 py-3 border-b border-border transition-colors',
                    selected?.id === r.id
                      ? 'bg-accent-dim border-l-2 border-l-accent'
                      : 'hover:bg-surface-2',
                  ].join(' ')}
                >
                  <div className="font-semibold text-sm text-text-1 truncate">{r.name}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {r.category && <span className="text-xs text-text-3 truncate">{r.category}</span>}
                    <span className="text-xs text-text-3 ml-auto shrink-0">
                      {r.item_count} item{r.item_count !== 1 ? 's' : ''}
                      {r.yield_qty !== 1 && ` · ${r.yield_qty}${r.yield_unit_abbr ? ' ' + r.yield_unit_abbr : ''}`}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* ── Drag handle */}
        <div
          className="w-1 hover:w-1.5 bg-border hover:bg-accent cursor-col-resize shrink-0 transition-all duration-100 active:bg-accent"
          onMouseDown={e => {
            e.preventDefault()
            const startX = e.clientX
            const startW = panelWidth
            const onMove = (ev: MouseEvent) => {
              const next = Math.max(200, Math.min(520, startW + ev.clientX - startX))
              setPanelWidth(next)
            }
            const onUp = () => {
              window.removeEventListener('mousemove', onMove)
              window.removeEventListener('mouseup', onUp)
            }
            window.addEventListener('mousemove', onMove)
            window.addEventListener('mouseup', onUp)
          }}
        />

        {/* ── Right: recipe detail ── */}
        <div className="flex-1 overflow-y-auto bg-surface-2">
          {loadingDetail ? (
            <div className="flex justify-center p-16"><Spinner /></div>
          ) : !selected ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-3">
              <BookOpenIcon size={40} />
              <p className="text-sm">Select a recipe to view details</p>
            </div>
          ) : (
            <div className="p-6 max-w-4xl mx-auto">

              {/* Detail header */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-bold text-text-1">{selected.name}</h2>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {selected.category && <Badge label={selected.category} variant="neutral" />}
                    <span className="text-sm text-text-3">
                      Yield: <span className="font-mono font-semibold text-text-2">{selected.yield_qty}{selected.yield_unit_abbr ? ' ' + selected.yield_unit_abbr : ''}</span>
                    </span>
                    <span className="text-sm text-text-3">·</span>
                    <span className="text-sm text-text-3">{activeItems.length} ingredient{activeItems.length !== 1 ? 's' : ''}</span>
                  </div>
                  {selected.description && <p className="mt-2 text-sm text-text-2 leading-relaxed">{selected.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5" onClick={() => setRecipeModal(selected)}>
                    <EditIcon size={12} /> Edit
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1.5"
                    onClick={() => setConfirmDelete({ type: 'recipe', id: selected.id })}
                  >
                    <TrashIcon size={12} /> Delete
                  </button>
                </div>
              </div>

              {/* ── Market + Currency selectors ── */}
              {selected.cogs_by_country.length > 0 && (
                <div className="flex items-center gap-4 mb-4 flex-wrap">

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-3 whitespace-nowrap">Market</span>
                    <select
                      value={selectedCountryId}
                      onChange={e => {
                        const v = e.target.value
                        const newId = v === 'GLOBAL' ? 'GLOBAL' : Number(v)
                        setSelectedCountryId(newId)
                        setSelectedCurrencyCode('')
                        setShowComparison(false)
                        // Reset tile menu selector to first menu in the new market
                        const firstInMarket = typeof newId === 'number'
                          ? menuAssignments.find(m => m.country_id === newId)
                          : menuAssignments[0]
                        setSelectedMenuId(firstInMarket?.menu_id ?? null)
                      }}
                      className="input text-sm"
                      style={{ minWidth: 160 }}
                    >
                      <option value="GLOBAL">🌍 Global</option>
                      {selected.cogs_by_country.map(c => (
                        <option key={c.country_id} value={c.country_id}>
                          {c.country_name}{c.has_variation ? ' ✦' : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {priceLevels.length > 1 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-text-3 whitespace-nowrap">Price Level</span>
                      <select
                        value={selectedPriceLevelId ?? ''}
                        onChange={e => setSelectedPriceLevelId(e.target.value ? Number(e.target.value) : null)}
                        className="input text-sm"
                        style={{ minWidth: 120 }}
                      >
                        <option value="">— any —</option>
                        {priceLevels.map(l => (
                          <option key={l.id} value={l.id}>{l.name}{l.is_default ? ' ★' : ''}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-3 whitespace-nowrap">Display Currency</span>
                    <select
                      value={selectedCurrencyCode || '__MARKET__'}
                      onChange={e => setSelectedCurrencyCode(e.target.value === '__MARKET__' ? '' : e.target.value)}
                      className="input text-sm"
                      style={{ minWidth: 120 }}
                    >
                      <option value="__MARKET__">Market Currency</option>
                      <option value="__BASE__">System (USD $)</option>
                      {currencyOptions.map(c => (
                        <option key={c.code} value={c.code}>{c.code} {c.symbol}</option>
                      ))}
                    </select>
                  </div>

                  {activeCogs && (
                    <div className="flex items-center gap-2 ml-auto">
                      {activeCogs.has_variation
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold">✦ Market Variation</span>
                        : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-2 text-text-3 text-xs">🌍 Global Recipe</span>
                      }
                      {activeVariation && (
                        <button
                          onClick={() => setShowComparison(p => !p)}
                          className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${showComparison ? 'border-accent bg-accent text-white' : 'border-border text-text-2 hover:border-accent hover:text-accent bg-surface'}`}
                          title="Side-by-side comparison of global vs market variation ingredients"
                        >
                          ⇄ Compare
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* ── COGS KPIs ── */}
              {activeCogs && (() => {
                const showBase = displayCurrency.code !== 'USD'
                // Only show menus that belong to the currently selected market in the Price tile
                const tileMenus = typeof selectedCountryId === 'number'
                  ? menuAssignments.filter(m => m.country_id === selectedCountryId)
                  : menuAssignments
                const activeMenu = tileMenus.find(m => m.menu_id === selectedMenuId) ?? tileMenus[0] ?? null
                return (
                  <div className="bg-surface border border-border rounded-xl p-4 mb-5">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {/* Tile 1 — Per Portion */}
                      <div className="bg-surface-2 rounded-lg p-3">
                        <div className="text-xs text-text-3 mb-1">Per Portion</div>
                        <div className="text-lg font-bold font-mono text-text-1">
                          {displayCurrency.symbol}{fmtCost(activeCogs.cost_per_portion * displayCurrency.rate)}
                        </div>
                        {showBase && (
                          <div className="text-xs font-mono text-text-3 mt-0.5">${fmtCost(activeCogs.cost_per_portion)}</div>
                        )}
                      </div>

                      {/* Tile 2 — Total Cost */}
                      <div className="bg-surface-2 rounded-lg p-3">
                        <div className="text-xs text-text-3 mb-1">Total Cost</div>
                        <div className="text-lg font-bold font-mono text-text-1">
                          {displayCurrency.symbol}{fmtCost(activeCogs.total_cost_base * displayCurrency.rate)}
                        </div>
                        {showBase && (
                          <div className="text-xs font-mono text-text-3 mt-0.5">${fmtCost(activeCogs.total_cost_base)}</div>
                        )}
                      </div>

                      {/* Tile 3 — Menu Price */}
                      <div className="bg-surface-2 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1 gap-1">
                          <div className="text-xs text-text-3 shrink-0">Price</div>
                          <div className="flex items-center gap-1">
                            {/* Menu selector — filtered to active market */}
                            {tileMenus.length > 1 ? (
                              <select
                                value={selectedMenuId ?? ''}
                                onChange={e => setSelectedMenuId(Number(e.target.value))}
                                className="text-xs text-text-3 bg-transparent border border-border rounded px-1 py-0 max-w-[120px]"
                              >
                                {tileMenus.map(m => (
                                  <option key={m.menu_id} value={m.menu_id}>{m.menu_name}</option>
                                ))}
                              </select>
                            ) : tileMenus.length === 1 ? (
                              <span className="text-xs text-text-3 truncate max-w-[110px]" title={tileMenus[0].menu_name}>{tileMenus[0].menu_name}</span>
                            ) : null}
                          </div>
                        </div>
                        {activeMenu ? (() => {
                          // Convert menu's local price → display currency for read-only display
                          const menuRate = activeMenu.exchange_rate || 1
                          const dispNet  = activeMenu.sell_price_net / menuRate * displayCurrency.rate
                          return editingTilePrice !== null ? (
                            // Edit always in the menu's own market currency to avoid conversion rounding
                            <div className="flex items-center gap-1 mt-1">
                              <span className="text-sm text-text-3">{activeMenu.currency_symbol}</span>
                              <input
                                type="number" min="0" step="0.01"
                                className="input text-sm font-mono w-24 py-0.5 px-1"
                                value={editingTilePrice}
                                onChange={e => setEditingTilePrice(e.target.value)}
                                onKeyDown={async e => {
                                  if (e.key === 'Enter') {
                                    const gross = parseFloat(editingTilePrice)
                                    if (!isNaN(gross) && gross >= 0 && selectedPriceLevelId) {
                                      // Store directly in menu's local currency — no conversion
                                      await api.post('/menu-item-prices', { menu_item_id: activeMenu.menu_item_id, price_level_id: selectedPriceLevelId, sell_price: Math.round(gross * 10000) / 10000 })
                                      setMenuAssignVersion(v => v + 1)
                                      showToast('Price updated')
                                    }
                                    setEditingTilePrice(null)
                                  } else if (e.key === 'Escape') {
                                    setEditingTilePrice(null)
                                  }
                                }}
                                autoFocus
                              />
                              <button className="text-xs text-text-3 hover:text-accent" onClick={() => setEditingTilePrice(null)}>✕</button>
                            </div>
                          ) : (
                            <>
                              <div
                                className="text-lg font-bold font-mono text-text-1 cursor-pointer hover:text-accent transition-colors"
                                title={`Click to edit price (${activeMenu.currency_symbol})`}
                                onClick={() => setEditingTilePrice(fmtCost(activeMenu.sell_price_gross > 0 ? activeMenu.sell_price_gross : 0))}
                              >
                                {displayCurrency.symbol}{fmtCost(dispNet)}
                              </div>
                              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                <span className="text-xs text-text-3">net ex-tax</span>
                                {activeMenu.cogs_pct_net != null && (
                                  <span className={`text-xs font-semibold ${recipeCogsColour(activeMenu.cogs_pct_net)}`}>
                                    {activeMenu.cogs_pct_net.toFixed(1)}% COGS
                                  </span>
                                )}
                              </div>
                            </>
                          )
                        })() : loadingMenuAssign ? (
                          <div className="text-xs text-text-3 mt-1">Loading…</div>
                        ) : (
                          <div className="text-sm font-mono text-text-3 italic mt-1">Not on menu</div>
                        )}
                      </div>

                      {/* Tile 4 — Quote Coverage (unchanged) */}
                      <div className="bg-surface-2 rounded-lg p-3">
                        <div className="text-xs text-text-3 mb-1">Quote Coverage</div>
                        {(() => {
                          const c = activeCogs.coverage
                          const cfg = {
                            fully_preferred:  { icon: '✓', label: 'Fully Preferred',  cls: 'text-emerald-600', sub: 'All ingredients have preferred vendor quotes',   subCls: 'text-emerald-500' },
                            fully_quoted:     { icon: '✓', label: 'Fully Quoted',      cls: 'text-blue-600',   sub: 'All quoted, but some not from preferred vendors', subCls: 'text-blue-400'    },
                            partially_quoted: { icon: '⚠', label: 'Partially Quoted',  cls: 'text-amber-500',  sub: 'Some ingredients are missing quotes',             subCls: 'text-amber-400'   },
                            not_quoted:       { icon: '✕', label: 'Not Quoted',        cls: 'text-red-500',    sub: 'No price quotes found for this country',          subCls: 'text-red-400'     },
                          }[c] ?? { icon: '?', label: c, cls: 'text-text-3', sub: '', subCls: '' }
                          return (
                            <>
                              <div className={`text-lg font-bold font-mono ${cfg.cls}`}>{cfg.icon} {cfg.label}</div>
                              {cfg.sub && <div className={`text-xs mt-0.5 ${cfg.subCls}`}>{cfg.sub}</div>}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* ── Ingredients table ── */}
              <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">

                {/* Table header bar */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-semibold text-sm text-text-1 shrink-0">Ingredients</span>
                    {variantMode === 'market-pl' && activeMarketPlVariation
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-semibold shrink-0">🌍💰 {activeMarketPlVariation.country_name} · {activeMarketPlVariation.price_level_name}</span>
                      : variantMode === 'price-level' && activePlVariation
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold shrink-0">💰 PL Variation ({activePlVariation.price_level_name})</span>
                        : activeCogs?.has_variation
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold shrink-0">✦ Market Variation</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-text-3 shrink-0">Global</span>
                    }
                    {/* Variant mode toggle */}
                    {priceLevels.length > 0 && (
                      <div className="flex items-center gap-1">
                        <button
                          className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${variantMode === 'market' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          onClick={() => setVariantMode('market')}
                          title="Market variations — different ingredients per country"
                        >🌍 Market</button>
                        <button
                          className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${variantMode === 'price-level' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          onClick={() => setVariantMode('price-level')}
                          title="Price level variations — different ingredients per price level (global)"
                        >💰 Price Level</button>
                        <button
                          className={`px-2 py-0.5 text-xs rounded-md font-medium transition-colors ${variantMode === 'market-pl' ? 'bg-accent text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                          onClick={() => setVariantMode('market-pl')}
                          title="Market+PL variations — specific ingredients for a market+price level combination"
                        >🌍💰 Market+PL</button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {variantMode === 'market' && selectedCountryId !== '' && selectedCountryId !== 'GLOBAL' && (
                      activeCogs?.has_variation && activeCogs.variation_id ? (
                        <>
                          <button
                            className="px-3 py-1.5 text-xs border border-accent text-accent hover:bg-accent-dim rounded-lg transition-colors flex items-center gap-1"
                            onClick={() => setConfirmDelete({ type: 'copy-to-global', id: activeCogs.variation_id! })}
                            title="Replace global recipe ingredients with this variation's ingredients"
                          >
                            ↑ Copy to Global
                          </button>
                          <button
                            className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1"
                            onClick={() => setConfirmDelete({ type: 'variation', id: activeCogs.variation_id! })}
                            title="Delete market variation — reverts to global recipe"
                          >
                            <TrashIcon size={11} /> Delete Variation
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                          onClick={() => {
                            const countryName = selected.cogs_by_country.find(c => c.country_id === selectedCountryId)?.country_name ?? 'this country'
                            if (window.confirm(`Create a market variation for ${countryName}?\n\nThis lets you define different ingredients for this market. The global recipe remains unchanged.\n\nCopy global ingredients as a starting point?`)) {
                              createVariation(selectedCountryId as number, true)
                            } else if (window.confirm('Create empty variation instead?')) {
                              createVariation(selectedCountryId as number, false)
                            }
                          }}
                          title="Create a market-specific variation of this recipe"
                        >
                          ✦ Create Variation
                        </button>
                      )
                    )}
                    {variantMode === 'price-level' && selectedPriceLevelId && (
                      activePlVariation ? (
                        <>
                          <button
                            className="px-3 py-1.5 text-xs border border-accent text-accent hover:bg-accent-dim rounded-lg transition-colors flex items-center gap-1"
                            onClick={() => setConfirmDelete({ type: 'pl-copy-to-global', id: activePlVariation.id })}
                            title="Replace global recipe ingredients with this PL variation's ingredients"
                          >
                            ↑ Copy to Global
                          </button>
                          <button
                            className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1"
                            onClick={() => setConfirmDelete({ type: 'pl-variation', id: activePlVariation.id })}
                            title="Delete price level variation — reverts to global recipe"
                          >
                            <TrashIcon size={11} /> Delete PL Variation
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                          onClick={() => {
                            const levelName = priceLevels.find(l => l.id === selectedPriceLevelId)?.name ?? 'this price level'
                            if (window.confirm(`Create a price level variation for ${levelName}?\n\nThis lets you define different ingredients for this price level. The global recipe remains unchanged.\n\nCopy global ingredients as a starting point?`)) {
                              createPlVariation(selectedPriceLevelId, true)
                            } else if (window.confirm('Create empty PL variation instead?')) {
                              createPlVariation(selectedPriceLevelId, false)
                            }
                          }}
                          title="Create a price-level-specific variation of this recipe"
                        >
                          ⊞ Create PL Variation
                        </button>
                      )
                    )}
                    {variantMode === 'market-pl' && selectedCountryId !== '' && selectedCountryId !== 'GLOBAL' && selectedPriceLevelId && (
                      activeMarketPlVariation ? (
                        <button
                          className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1"
                          onClick={() => setConfirmDelete({ type: 'market-pl-variation', id: activeMarketPlVariation.id })}
                          title="Delete this market+PL variation"
                        >
                          <TrashIcon size={11} /> Delete Market+PL
                        </button>
                      ) : (
                        <button
                          className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                          onClick={() => {
                            const countryName = selected.cogs_by_country.find(c => c.country_id === selectedCountryId)?.country_name ?? 'this country'
                            const levelName   = priceLevels.find(l => l.id === selectedPriceLevelId)?.name ?? 'this price level'
                            const hasMktVar   = selected.variations.some(v => v.country_id === selectedCountryId)
                            const hasPlVar    = selected.pl_variations?.some(v => v.price_level_id === selectedPriceLevelId)
                            const choices = ['global', hasMktVar && 'market', hasPlVar && 'pl'].filter(Boolean) as string[]
                            const copyLabel = choices.length > 1
                              ? `\n\nCopy from: global (G), market variation (M)${hasPlVar ? ', PL variation (P)' : ''}?\nEnter G, M${hasPlVar ? ', P' : ''} or leave blank for empty.`
                              : `\n\nCopy global ingredients as starting point?`
                            const ans = window.prompt(`Create Market+PL variation for ${countryName} · ${levelName}?${copyLabel}`)
                            if (ans === null) return
                            const copyFrom = ans.trim().toUpperCase() === 'M' ? 'market'
                              : ans.trim().toUpperCase() === 'P' ? 'pl'
                              : ans.trim() === '' ? null
                              : 'global'
                            createMarketPlVariation(selectedCountryId as number, selectedPriceLevelId, copyFrom)
                          }}
                          title="Create a market+price-level-specific variation"
                        >
                          🌍💰 Create Market+PL
                        </button>
                      )
                    )}
                    <button
                      className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                      onClick={() => {
                        if (variantMode === 'market-pl' && activeMarketPlVariation) {
                          setItemModalForMarketPlVariation(activeMarketPlVariation.id)
                          setItemModalForVariation(null)
                          setItemModalForPlVariation(null)
                        } else if (variantMode === 'price-level' && activePlVariation) {
                          setItemModalForPlVariation(activePlVariation.id)
                          setItemModalForVariation(null)
                          setItemModalForMarketPlVariation(null)
                        } else {
                          setItemModalForVariation(activeVariation?.id ?? null)
                          setItemModalForPlVariation(null)
                          setItemModalForMarketPlVariation(null)
                        }
                        setItemModal(true)
                      }}
                    >
                      <PlusIcon size={11} /> Add Ingredient
                    </button>
                  </div>
                </div>

                {/* ── Comparison view ── */}
                {comparisonData ? (
                  <div className="grid grid-cols-2 divide-x divide-border">

                    {/* Left — Global */}
                    <div>
                      <div className="px-3 py-2 bg-surface-2 border-b border-border text-xs font-semibold text-text-3 uppercase tracking-wide">
                        🌍 Global
                      </div>
                      {comparisonData.globalItems.length === 0 ? (
                        <div className="p-6 text-center text-text-3 text-xs">No global ingredients</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs text-text-2 uppercase tracking-wide bg-gray-200">
                              <th className="px-3 py-2 text-left font-semibold">Ingredient</th>
                              <th className="px-3 py-2 text-left font-semibold">Qty</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonData.globalItems.map(item => {
                              const name    = item.ingredient_name || item.sub_recipe_name || ''
                              const removed = !comparisonData.varNames.has(name)
                              return (
                                <tr key={item.id} className={`border-b border-border last:border-0 ${removed ? 'bg-amber-50' : 'hover:bg-surface-2/40'}`}>
                                  <td className="px-3 py-2.5">
                                    <div className={`font-medium flex items-center flex-wrap gap-x-1 ${removed ? 'text-amber-700' : 'text-text-1'}`}>
                                      {item.item_type === 'ingredient' ? item.ingredient_name : `↳ ${item.sub_recipe_name}`}
                                      {item.item_type === 'ingredient' && item.ingredient_id != null &&
                                        <AllergenBadge allergens={ingAllergenMap.get(item.ingredient_id)} />}
                                      {removed && <span className="ml-1.5 text-[10px] bg-amber-100 text-amber-600 px-1 rounded">removed</span>}
                                    </div>
                                    {item.item_type === 'ingredient' && item.base_unit_abbr && (
                                      <div className="text-xs text-text-3">{item.base_unit_abbr}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-xs text-text-2 whitespace-nowrap">
                                    {fmt(item.prep_qty)} {item.prep_unit || item.base_unit_abbr || '—'}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    {/* Right — Variation */}
                    <div>
                      <div className="px-3 py-2 bg-blue-50 border-b border-border text-xs font-semibold text-blue-700 uppercase tracking-wide">
                        ✦ {activeCogs?.country_name}
                      </div>
                      {comparisonData.varItems.length === 0 ? (
                        <div className="p-6 text-center text-text-3 text-xs">No variation ingredients</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border text-xs text-text-2 uppercase tracking-wide bg-blue-50/40">
                              <th className="px-3 py-2 text-left font-semibold">Ingredient</th>
                              <th className="px-3 py-2 text-left font-semibold">Qty</th>
                              <th className="px-3 py-2 text-right font-semibold">Cost ({activeCogs?.currency_code})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {comparisonData.varItems.map(item => {
                              const name     = item.ingredient_name || item.sub_recipe_name || ''
                              const added    = !comparisonData.globalNames.has(name)
                              const cogLine  = activeCogs?.lines.find(l => l.id === item.id)
                              const localCost = cogLine?.cost != null ? cogLine.cost * displayCurrency.rate : null
                              return (
                                <tr key={item.id} className={`border-b border-border last:border-0 ${added ? 'bg-emerald-50' : 'hover:bg-surface-2/40'}`}>
                                  <td className="px-3 py-2.5">
                                    <div className={`font-medium flex items-center flex-wrap gap-x-1 ${added ? 'text-emerald-700' : 'text-text-1'}`}>
                                      {item.item_type === 'ingredient' ? item.ingredient_name : `↳ ${item.sub_recipe_name}`}
                                      {item.item_type === 'ingredient' && item.ingredient_id != null &&
                                        <AllergenBadge allergens={ingAllergenMap.get(item.ingredient_id)} />}
                                      {added && <span className="ml-1.5 text-[10px] bg-emerald-100 text-emerald-600 px-1 rounded">added</span>}
                                    </div>
                                    {item.item_type === 'ingredient' && item.base_unit_abbr && (
                                      <div className="text-xs text-text-3">{item.base_unit_abbr}</div>
                                    )}
                                  </td>
                                  <td className="px-3 py-2.5 font-mono text-xs text-text-2 whitespace-nowrap">
                                    {fmt(item.prep_qty)} {item.prep_unit || item.base_unit_abbr || '—'}
                                  </td>
                                  <td className="px-3 py-2.5 text-right font-mono text-xs">
                                    {localCost != null
                                      ? <div className="flex flex-col items-end">
                                          <span className="text-text-1">{displayCurrency.symbol}{fmtCost(localCost)}</span>
                                          {cogLine?.quote_is_preferred === false && <span className="text-[10px] text-amber-400 mt-0.5">best avail.</span>}
                                        </div>
                                      : <span className="text-red-400">—</span>
                                    }
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                          {activeCogs && activeCogs.total_cost_base > 0 && (
                            <tfoot>
                              <tr className="border-t-2 border-border bg-blue-50/30">
                                <td className="px-3 py-2 font-semibold text-text-2 text-xs" colSpan={2}>Total</td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-text-1 text-xs">
                                  {displayCurrency.symbol}{fmtCost(activeCogs.total_cost_base * displayCurrency.rate)}
                                </td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      )}
                    </div>
                  </div>

                ) : (
                  /* ── Normal single-panel view ── */
                  activeItems.length === 0 ? (
                    <div className="px-4 py-8 text-center text-text-3 text-sm">
                      {activeCogs?.has_variation
                        ? 'No ingredients in this market variation yet. Add ingredients above.'
                        : 'No ingredients yet. Add your first ingredient.'}
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-200 border-b border-gray-300 text-xs text-text-2 uppercase tracking-wide">
                          {/* drag handle spacer */}
                          {itemSortField === 'custom' && <th className="w-6" />}
                          <SortTh label="Ingredient" field="name" sortField={itemSortField} sortDir={itemSortDir} onSort={cycleItemSort} align="left" className="px-4 py-2.5" />
                          <SortTh label="Qty"        field="qty"  sortField={itemSortField} sortDir={itemSortDir} onSort={cycleItemSort} align="left" className="px-4 py-2.5" />
                          <th className="px-4 py-2.5 text-left font-semibold">Conversion</th>
                          {activeCogs && <SortTh label={`Cost (${displayCurrency.code})`} field="cost" sortField={itemSortField} sortDir={itemSortDir} onSort={cycleItemSort} align="right" className="px-4 py-2.5" />}
                          <th className="w-16" />
                        </tr>
                      </thead>
                      <tbody>
                        {displayItems.map(item => {
                          const cogLine   = activeCogs?.lines.find(l => l.id === item.id)
                          const localCost = cogLine?.cost != null ? cogLine.cost * displayCurrency.rate : null
                          const isDragging = dragId === item.id
                          const isOver    = dragOverId === item.id && dragId !== item.id
                          return (
                            <tr
                              key={item.id}
                              className={`border-b border-border last:border-0 group transition-colors
                                ${isDragging ? 'opacity-40' : ''}
                                ${isOver ? 'border-t-2 border-t-accent bg-accent-dim/30' : 'hover:bg-surface-2/50'}
                              `}
                              draggable={itemSortField === 'custom'}
                              onDragStart={itemSortField === 'custom' ? () => setDragId(item.id) : undefined}
                              onDragOver={itemSortField === 'custom' ? e => { e.preventDefault(); setDragOverId(item.id) } : undefined}
                              onDragLeave={itemSortField === 'custom' ? () => setDragOverId(null) : undefined}
                              onDrop={itemSortField === 'custom' ? e => { e.preventDefault(); if (dragId !== null) reorderItems(dragId, item.id); setDragId(null); setDragOverId(null) } : undefined}
                            >
                              {/* Drag handle — only in custom sort mode */}
                              {itemSortField === 'custom' && (
                                <td className="pl-2 pr-0 py-2.5 text-text-3 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing">
                                  <DragHandleIcon size={14} />
                                </td>
                              )}
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-text-1 flex items-center flex-wrap gap-x-1">
                                  {item.item_type === 'ingredient' ? item.ingredient_name : `↳ ${item.sub_recipe_name}`}
                                  {item.item_type === 'ingredient' && item.ingredient_id != null &&
                                    <AllergenBadge allergens={ingAllergenMap.get(item.ingredient_id)} />}
                                </div>
                                {item.item_type === 'ingredient' && item.base_unit_abbr && (
                                  <div className="text-xs text-text-3">base unit: {item.base_unit_abbr}</div>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-text-2">
                                {fmt(item.prep_qty)} {item.prep_unit || item.base_unit_abbr || '—'}
                              </td>
                              <td className="px-4 py-2.5 font-mono text-text-3 text-xs">
                                {item.item_type === 'ingredient'
                                  ? `× ${fmt(item.prep_to_base_conversion, 6)} → ${fmt(Number(item.prep_qty) * Number(item.prep_to_base_conversion))} ${item.base_unit_abbr || ''}`
                                  : `${fmt(item.prep_qty)} portion${Number(item.prep_qty) !== 1 ? 's' : ''}`
                                }
                              </td>
                              {activeCogs && (
                                <td className="px-4 py-2.5 text-right font-mono">
                                  {localCost != null
                                    ? <div className="flex flex-col items-end">
                                        <span className="text-text-1">{displayCurrency.symbol}{fmtCost(localCost)}</span>
                                        {cogLine?.quote_is_preferred === false && (
                                          <span className="text-[10px] text-amber-400 leading-none mt-0.5">best available</span>
                                        )}
                                      </div>
                                    : <span className="text-red-400 text-xs">no quote</span>
                                  }
                                </td>
                              )}
                              <td className="px-2 py-1">
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 hover:text-accent"
                                    onClick={() => setEditItemModal(item)}
                                  ><EditIcon size={11}/></button>
                                  <button
                                    className="w-6 h-6 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50"
                                    onClick={() => setConfirmDelete({ type: 'item', id: item.id })}
                                  ><TrashIcon size={11}/></button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {activeCogs && activeCogs.total_cost_base > 0 && (
                        <tfoot>
                          <tr className="border-t-2 border-border bg-surface-2">
                            <td className="px-4 py-2.5 font-semibold text-text-2" colSpan={3}>Total</td>
                            <td className="px-4 py-2.5 text-right font-mono font-bold text-text-1">
                              {displayCurrency.symbol}{fmtCost(activeCogs.total_cost_base * displayCurrency.rate)}
                            </td>
                            <td />
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  )
                )}
              </div>

              {/* ── Menus section ── */}
              {selected && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="font-semibold text-sm text-text-1">Menus</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-3">
                        {loadingMenuAssign ? 'Loading…' : menuAssignments.length === 0 ? 'Not on any menu' : `${menuAssignments.length} menu${menuAssignments.length !== 1 ? 's' : ''}`}
                      </span>
                      {menus.length > 0 && (
                        <button
                          onClick={() => {
                            setAddToMenuTargetId(menus[0]?.id ?? null)
                            setAddToMenuDisplayName(selected?.name ?? '')
                            setAddToMenuModal(true)
                          }}
                          className="px-2.5 py-1 text-xs btn-outline rounded-lg"
                        >+ Add to Menu</button>
                      )}
                    </div>
                  </div>
                  {loadingMenuAssign ? (
                    <div className="p-4 text-center"><Spinner /></div>
                  ) : menuAssignments.length === 0 ? (
                    <div className="px-4 py-6 text-center text-text-3 text-sm">
                      This recipe hasn't been added to any menu yet.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-200 border-b border-gray-300 text-xs text-text-2 uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-left font-semibold">Market</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Menu</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Display Name</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Price (gross)</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Price (net)</th>
                          <th className="px-4 py-2.5 text-right font-semibold">COGS%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menuAssignments.map(m => {
                          const isEditing = editingMenuPrice?.menu_item_id === m.menu_item_id && editingMenuPrice?.level_id === (selectedPriceLevelId ?? 0)
                          // Prices displayed in each menu's own market currency
                          const sym = m.currency_symbol
                          return (
                            <tr key={m.menu_id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                              <td className="px-4 py-2.5 text-text-3 text-xs">{m.country_name}</td>
                              <td className="px-4 py-2.5 font-medium">
                                <button
                                  className="text-accent hover:underline text-left"
                                  onClick={() => navigate(`/menus?menu=${m.menu_id}`)}
                                  title="Open in Menu Builder"
                                >{m.menu_name}</button>
                              </td>
                              <td className="px-4 py-2.5 text-text-2">{m.display_name}</td>
                              <td className="px-4 py-2.5 text-right font-mono text-text-2">
                                {isEditing ? (
                                  <div className="flex items-center justify-end gap-1">
                                    <span className="text-text-3">{sym}</span>
                                    <input
                                      type="number" min="0" step="0.01"
                                      className="input text-sm font-mono w-24 py-0.5 px-1 text-right"
                                      value={editingMenuPrice!.value}
                                      onChange={e => setEditingMenuPrice(p => p ? { ...p, value: e.target.value } : p)}
                                      onKeyDown={async e => {
                                        if (e.key === 'Enter') {
                                          const gross = parseFloat(editingMenuPrice!.value)
                                          if (!isNaN(gross) && gross >= 0 && selectedPriceLevelId) {
                                            // price stored in market's local currency (base USD * exchRate)
                                            await api.post('/menu-item-prices', { menu_item_id: m.menu_item_id, price_level_id: selectedPriceLevelId, sell_price: Math.round(gross * 10000) / 10000 })
                                            setMenuAssignVersion(v => v + 1)
                                            showToast('Price updated')
                                          }
                                          setEditingMenuPrice(null)
                                        } else if (e.key === 'Escape') {
                                          setEditingMenuPrice(null)
                                        }
                                      }}
                                      onBlur={() => setEditingMenuPrice(null)}
                                      autoFocus
                                    />
                                  </div>
                                ) : (
                                  <span
                                    className="cursor-pointer hover:text-accent transition-colors"
                                    title={selectedPriceLevelId ? 'Click to edit gross price' : 'Select a price level to edit'}
                                    onClick={() => {
                                      if (!selectedPriceLevelId) return
                                      const grossDisplay = m.sell_price_gross > 0 ? fmtCost(m.sell_price_gross) : ''
                                      setEditingMenuPrice({ menu_item_id: m.menu_item_id, level_id: selectedPriceLevelId, value: grossDisplay })
                                    }}
                                  >
                                    {m.sell_price_gross > 0 ? `${sym}${fmtCost(m.sell_price_gross)}` : '—'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 text-right font-mono font-semibold text-text-1">
                                {m.sell_price_net > 0 ? `${sym}${fmtCost(m.sell_price_net)}` : '—'}
                              </td>
                              <td className={`px-4 py-2.5 text-right font-semibold ${recipeCogsColour(m.cogs_pct_net)}`}>
                                {m.cogs_pct_net != null ? `${m.cogs_pct_net.toFixed(1)}%` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── Global view: Cost by Market ── */}
              {selectedCountryId === 'GLOBAL' && selected && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
                  <div className="px-4 py-3 border-b border-border">
                    <span className="font-semibold text-sm text-text-1">Cost by Market</span>
                  </div>
                  {selected.cogs_by_country.length === 0 ? (
                    <div className="px-4 py-6 text-center text-text-3 text-sm">No market data available.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-200 border-b border-gray-300 text-xs text-text-2 uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-left font-semibold">Market</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Recipe</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Per Portion</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Total Cost</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Coverage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.cogs_by_country.map(c => (
                          <tr key={c.country_id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                            <td className="px-4 py-2.5 font-medium text-text-1">{c.country_name}</td>
                            <td className="px-4 py-2.5">
                              {c.has_variation
                                ? <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">✦ Variation</span>
                                : <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface-2 text-text-3">🌍 Global</span>
                              }
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-text-1">
                              {c.currency_symbol}{fmtCost(c.cost_per_portion)}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono text-text-2">
                              {c.currency_symbol}{fmtCost(c.total_cost_local)}
                            </td>
                            <td className="px-4 py-2.5">
                              {(() => {
                                const cfg: Record<string, { label: string; cls: string }> = {
                                  fully_preferred:  { label: '✓ Preferred',  cls: 'text-emerald-600 bg-emerald-50' },
                                  fully_quoted:     { label: '✓ Quoted',     cls: 'text-blue-600 bg-blue-50'      },
                                  partially_quoted: { label: '⚠ Partial',    cls: 'text-amber-500 bg-amber-50'    },
                                  not_quoted:       { label: '✕ No Quotes',  cls: 'text-red-500 bg-red-50'        },
                                }
                                const cv = cfg[c.coverage] ?? { label: c.coverage, cls: 'text-text-3 bg-surface-2' }
                                return <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${cv.cls}`}>{cv.label}</span>
                              })()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {recipeModal !== null && (
        <RecipeFormModal
          recipe={recipeModal === 'new' ? null : recipeModal}
          categories={categories}
          onSave={saveRecipe}
          onClose={() => setRecipeModal(null)}
        />
      )}

      {(itemModal || editItemModal) && (
        <ItemFormModal
          item={editItemModal}
          ingredients={ingredients}
          recipes={recipes.filter(r => r.id !== selected?.id)}
          onSave={form => {
            if (editItemModal) {
              if (activeMarketPlVariation && variantMode === 'market-pl') updateMarketPlVariationItem(activeMarketPlVariation.id, form)
              else if (activePlVariation && variantMode === 'price-level') updatePlVariationItem(activePlVariation.id, form)
              else if (activeVariation) updateVariationItem(activeVariation.id, form)
              else                      updateItem(form)
            } else {
              if (itemModalForMarketPlVariation != null) addMarketPlVariationItem(itemModalForMarketPlVariation, form)
              else if (itemModalForPlVariation != null)  addPlVariationItem(itemModalForPlVariation, form)
              else if (itemModalForVariation != null)    addVariationItem(itemModalForVariation, form)
              else                                       addItem(form)
            }
          }}
          onSaveAndNext={editItemModal ? undefined : form => {
            if (itemModalForMarketPlVariation != null) addMarketPlVariationItemAndNext(itemModalForMarketPlVariation, form)
            else if (itemModalForPlVariation != null)  addPlVariationItemAndNext(itemModalForPlVariation, form)
            else if (itemModalForVariation != null)    addVariationItemAndNext(itemModalForVariation, form)
            else                                       addItemAndNext(form)
          }}
          onClose={() => { setItemModal(false); setEditItemModal(null); setItemModalForVariation(null); setItemModalForPlVariation(null); setItemModalForMarketPlVariation(null) }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={
            confirmDelete.type === 'recipe'                ? 'This will permanently delete the recipe and all its ingredients.' :
            confirmDelete.type === 'variation'             ? 'Delete this market variation? The global recipe will be used for this country going forward.' :
            confirmDelete.type === 'copy-to-global'        ? 'Replace all global ingredients with this variation\'s ingredients? The global recipe will be overwritten. All other market variations are unaffected.' :
            confirmDelete.type === 'pl-variation'          ? 'Delete this price level variation? The global recipe will be used for this price level going forward.' :
            confirmDelete.type === 'pl-copy-to-global'     ? 'Replace all global ingredients with this price level variation\'s ingredients? The global recipe will be overwritten. All other variations are unaffected.' :
            confirmDelete.type === 'market-pl-variation'   ? 'Delete this market+PL variation? The next applicable tier (market, PL, or global recipe) will be used for this country+price level going forward.' :
            'Remove this ingredient from the recipe?'
          }
          onConfirm={() => {
            if (confirmDelete.type === 'recipe')                  deleteRecipe(confirmDelete.id)
            else if (confirmDelete.type === 'variation')          deleteVariation(confirmDelete.id)
            else if (confirmDelete.type === 'copy-to-global')     copyVariationToGlobal(confirmDelete.id)
            else if (confirmDelete.type === 'pl-variation')       deletePlVariation(confirmDelete.id)
            else if (confirmDelete.type === 'pl-copy-to-global')  copyPlVariationToGlobal(confirmDelete.id)
            else if (confirmDelete.type === 'market-pl-variation') deleteMarketPlVariation(confirmDelete.id)
            else {
              if (variantMode === 'market-pl' && activeMarketPlVariation) deleteMarketPlVariationItem(activeMarketPlVariation.id, confirmDelete.id)
              else if (variantMode === 'price-level' && activePlVariation) deletePlVariationItem(activePlVariation.id, confirmDelete.id)
              else if (activeVariation) deleteVariationItem(activeVariation.id, confirmDelete.id)
              else                      deleteItem(confirmDelete.id)
            }
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {addToMenuModal && selected && (
        <Modal title="Add to Menu" onClose={() => { setAddToMenuModal(false); setAddToMenuPrices({}) }}>
          <div className="space-y-4 min-w-[320px]">
            <Field label="Menu">
              <select
                className="input w-full"
                value={addToMenuTargetId ?? ''}
                onChange={e => setAddToMenuTargetId(Number(e.target.value))}
              >
                {menus.filter(m => m.country_id === selectedCountryId).map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Display Name">
              <input
                className="input w-full"
                value={addToMenuDisplayName}
                onChange={e => setAddToMenuDisplayName(e.target.value)}
                placeholder={selected.name}
              />
            </Field>
            {priceLevels.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-text-3 mb-2">
                  Prices ({displayCurrency.code}) — optional
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {priceLevels.map(l => (
                    <Field key={l.id} label={l.name + (l.is_default ? ' ★' : '')}>
                      <input
                        className="input w-full"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="0.00"
                        value={addToMenuPrices[l.id] ?? ''}
                        onChange={e => setAddToMenuPrices(p => ({ ...p, [l.id]: e.target.value }))}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-outline px-4 py-2 text-sm" onClick={() => { setAddToMenuModal(false); setAddToMenuPrices({}) }}>Cancel</button>
              <button
                className="btn-primary px-4 py-2 text-sm"
                disabled={!addToMenuTargetId || addToMenuSaving}
                onClick={async () => {
                  if (!addToMenuTargetId) return
                  setAddToMenuSaving(true)
                  try {
                    const newItem = await api.post('/menu-items', {
                      menu_id:      addToMenuTargetId,
                      item_type:    'recipe',
                      recipe_id:    selected.id,
                      display_name: addToMenuDisplayName.trim() || selected.name,
                      qty:          1,
                    })
                    const exchRate = activeCogs?.exchange_rate ?? 1
                    for (const [levelIdStr, priceStr] of Object.entries(addToMenuPrices)) {
                      const gross = parseFloat(priceStr)
                      if (!isNaN(gross) && gross > 0) {
                        const localGross = gross * exchRate / displayCurrency.rate
                        await api.post('/menu-item-prices', {
                          menu_item_id: newItem.id,
                          price_level_id: Number(levelIdStr),
                          sell_price: Math.round(localGross * 10000) / 10000,
                        })
                      }
                    }
                    setMenuAssignVersion(v => v + 1)
                    setAddToMenuModal(false)
                    setAddToMenuPrices({})
                    setToast({ msg: 'Recipe added to menu' })
                  } catch {
                    setToast({ msg: 'Failed to add to menu', type: 'error' })
                  } finally {
                    setAddToMenuSaving(false)
                  }
                }}
              >{addToMenuSaving ? 'Saving…' : 'Add to Menu'}</button>
            </div>
          </div>
        </Modal>
      )}

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Recipe Form Modal ─────────────────────────────────────────────────────────

interface RecipeForm {
  name: string; category: string; description: string; yield_qty: string; yield_unit_text: string
}

function RecipeFormModal({ recipe, categories, onSave, onClose }: {
  recipe: Recipe | null
  categories: string[]
  onSave: (f: RecipeForm) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<RecipeForm>({
    name:            recipe?.name           ?? '',
    category:        recipe?.category       ?? '',
    description:     recipe?.description    ?? '',
    yield_qty:       String(recipe?.yield_qty ?? 1),
    yield_unit_text: recipe?.yield_unit_abbr ?? '',
  })
  const [catOpen,           setCatOpen]           = useState(false)
  const [catHighlightedIdx, setCatHighlightedIdx] = useState(-1)
  const catItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const set = (k: keyof RecipeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const filteredCats = categories.filter(c => c.toLowerCase().includes(form.category.toLowerCase()))

  useEffect(() => {
    if (catHighlightedIdx >= 0) catItemRefs.current[catHighlightedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [catHighlightedIdx])

  function handleCatKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = filteredCats.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!catOpen && total > 0) { setCatOpen(true); setCatHighlightedIdx(0); return }
      setCatHighlightedIdx(i => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCatHighlightedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!catOpen || catHighlightedIdx < 0 || catHighlightedIdx >= total) return
      e.preventDefault()
      setForm(f => ({ ...f, category: filteredCats[catHighlightedIdx] }))
      setCatOpen(false); setCatHighlightedIdx(-1)
    } else if (e.key === 'Escape') {
      setCatOpen(false); setCatHighlightedIdx(-1)
    }
  }

  return (
    <Modal title={recipe ? 'Edit Recipe' : 'New Recipe'} onClose={onClose}>
      <div className="flex flex-col gap-4" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onSave(form) } }}>
        <Field label="Recipe Name" required>
          <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Pad Thai" autoFocus />
        </Field>

        {/* Category combo */}
        <Field label="Category">
          <div className="relative">
            <input
              className="input"
              value={form.category}
              onChange={e => { setForm(f => ({ ...f, category: e.target.value })); setCatOpen(true); setCatHighlightedIdx(-1) }}
              onFocus={() => setCatOpen(true)}
              onBlur={() => setTimeout(() => { setCatOpen(false); setCatHighlightedIdx(-1) }, 150)}
              onKeyDown={handleCatKeyDown}
              placeholder="Select or type to add…"
              autoComplete="off"
            />
            {catOpen && filteredCats.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 bg-surface border border-border rounded-lg shadow-lg mt-0.5 max-h-40 overflow-y-auto">
                {filteredCats.map((c, idx) => (
                  <button key={c} ref={el => { catItemRefs.current[idx] = el }} type="button"
                    className={`w-full text-left px-3 py-2 text-sm transition-colors ${catHighlightedIdx === idx ? 'bg-accent-dim text-accent font-semibold' : 'hover:bg-surface-2'}`}
                    onMouseDown={() => { setForm(f => ({ ...f, category: c })); setCatOpen(false); setCatHighlightedIdx(-1) }}
                  >{c}</button>
                ))}
              </div>
            )}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Yield Quantity">
            <input className="input font-mono" type="number" min="0.0001" step="0.0001" value={form.yield_qty} onChange={set('yield_qty')} />
          </Field>
          <Field label="Yield Unit">
            <input className="input" value={form.yield_unit_text} onChange={set('yield_unit_text')}
              placeholder="portions, kg, litres…" autoComplete="off" />
          </Field>
        </div>

        <Field label="Description / Notes">
          <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Optional method notes…" />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => onSave(form)}>
            {recipe ? 'Save Recipe' : 'Create Recipe'} <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Ctrl+↵</kbd>
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Item Form Modal ───────────────────────────────────────────────────────────

interface ItemForm {
  item_type: 'ingredient' | 'recipe'
  ingredient_id: string
  recipe_item_id: string
  prep_qty: string
  prep_unit: string
  prep_to_base_conversion: string
}

function ItemFormModal({ item, ingredients, recipes, onSave, onSaveAndNext, onClose }: {
  item: RecipeItem | null
  ingredients: Ingredient[]
  recipes: Recipe[]
  onSave: (f: ItemForm) => void
  onSaveAndNext?: (f: ItemForm) => void
  onClose: () => void
}) {
  const blankForm = (): ItemForm => ({
    item_type:               item?.item_type ?? 'ingredient',
    ingredient_id:           String(item?.ingredient_id ?? ''),
    recipe_item_id:          String(item?.recipe_item_id ?? ''),
    prep_qty:                String(item?.prep_qty ?? '1'),
    prep_unit:               item?.prep_unit ?? '',
    prep_to_base_conversion: String(item?.prep_to_base_conversion ?? '1'),
  })
  const [form, setForm] = useState<ItemForm>(blankForm)

  // Combo search state
  const ingInputRef = useRef<HTMLInputElement>(null)
  const [ingSearch,          setIngSearch]          = useState(() => {
    if (item?.ingredient_id) {
      return ingredients.find(i => i.id === item.ingredient_id)?.name ?? ''
    }
    return ''
  })
  const [ingOpen,            setIngOpen]            = useState(false)
  const [ingHighlightedIdx,  setIngHighlightedIdx]  = useState(-1)
  const ingItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const [recipeSearch,          setRecipeSearch]          = useState(() => {
    if (item?.recipe_item_id) {
      return recipes.find(r => r.id === item.recipe_item_id)?.name ?? ''
    }
    return ''
  })
  const [recipeOpen,            setRecipeOpen]            = useState(false)
  const [recipeHighlightedIdx,  setRecipeHighlightedIdx]  = useState(-1)
  const recipeItemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const filteredIngs = ingredients.filter(i =>
    i.name.toLowerCase().includes(ingSearch.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(ingSearch.toLowerCase())
  )
  const filteredRecipes = recipes.filter(r =>
    r.name.toLowerCase().includes(recipeSearch.toLowerCase())
  )

  const selIngredient = ingredients.find(i => String(i.id) === form.ingredient_id)
  const selRecipe     = recipes.find(r => String(r.id) === form.recipe_item_id)

  // Scroll highlighted items into view
  useEffect(() => {
    if (ingHighlightedIdx >= 0) ingItemRefs.current[ingHighlightedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [ingHighlightedIdx])
  useEffect(() => {
    if (recipeHighlightedIdx >= 0) recipeItemRefs.current[recipeHighlightedIdx]?.scrollIntoView({ block: 'nearest' })
  }, [recipeHighlightedIdx])

  function handleIngKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = filteredIngs.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!ingOpen && total > 0) { setIngOpen(true); setIngHighlightedIdx(0); return }
      setIngHighlightedIdx(i => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIngHighlightedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!ingOpen || ingHighlightedIdx < 0 || ingHighlightedIdx >= total) return
      e.preventDefault()
      const sel = filteredIngs[ingHighlightedIdx]
      setForm(f => ({ ...f, ingredient_id: String(sel.id) }))
      setIngSearch(sel.name); setIngOpen(false); setIngHighlightedIdx(-1)
    } else if (e.key === 'Escape') {
      setIngOpen(false); setIngHighlightedIdx(-1)
    }
  }

  function handleRecipeKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const total = filteredRecipes.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!recipeOpen && total > 0) { setRecipeOpen(true); setRecipeHighlightedIdx(0); return }
      setRecipeHighlightedIdx(i => Math.min(i + 1, total - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setRecipeHighlightedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (!recipeOpen || recipeHighlightedIdx < 0 || recipeHighlightedIdx >= total) return
      e.preventDefault()
      const sel = filteredRecipes[recipeHighlightedIdx]
      setForm(f => ({ ...f, recipe_item_id: String(sel.id) }))
      setRecipeSearch(sel.name); setRecipeOpen(false); setRecipeHighlightedIdx(-1)
    } else if (e.key === 'Escape') {
      setRecipeOpen(false); setRecipeHighlightedIdx(-1)
    }
  }

  // Add & Next — save then reset form for rapid entry
  function handleSaveAndNext() {
    if (!onSaveAndNext) return
    onSaveAndNext(form)
    // Reset to a blank add-ingredient form, keep item_type
    const nextType = form.item_type
    setForm({ item_type: nextType, ingredient_id: '', recipe_item_id: '', prep_qty: '1', prep_unit: '', prep_to_base_conversion: '1' })
    setIngSearch(''); setIngOpen(false); setIngHighlightedIdx(-1)
    setRecipeSearch(''); setRecipeOpen(false); setRecipeHighlightedIdx(-1)
    setTimeout(() => ingInputRef.current?.focus(), 50)
  }

  // Alt+A → Add & Next shortcut
  useEffect(() => {
    if (!onSaveAndNext) return
    function onKey(e: KeyboardEvent) {
      if (e.altKey && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); handleSaveAndNext() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSaveAndNext, form])

  // Auto-fill prep_unit and conversion from ingredient defaults
  useEffect(() => {
    if (!selIngredient || item) return
    setForm(f => ({
      ...f,
      prep_unit:               selIngredient.default_prep_unit || selIngredient.base_unit_abbr || '',
      prep_to_base_conversion: String(selIngredient.default_prep_to_base_conversion ?? 1),
    }))
  }, [selIngredient, item])

  const set = (k: keyof ItemForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const baseEquiv = selIngredient
    ? Number(form.prep_qty) * Number(form.prep_to_base_conversion)
    : null

  const baseUnit = selIngredient?.base_unit_abbr || ''

  return (
    <Modal title={item ? 'Edit Ingredient' : 'Add Ingredient'} onClose={onClose}>
      <div className="flex flex-col gap-4" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onSave(form) } }}>
        {/* Type toggle (only for new items) */}
        {!item && (
          <div className="flex gap-2 p-1 bg-surface-2 rounded-lg">
            {(['ingredient', 'recipe'] as const).map(t => (
              <button key={t} type="button"
                className={`flex-1 py-1.5 text-sm font-semibold rounded-md transition-colors capitalize
                  ${form.item_type === t ? 'bg-surface shadow text-text-1' : 'text-text-3 hover:text-text-2'}`}
                onClick={() => setForm(f => ({ ...f, item_type: t }))}
              >{t === 'recipe' ? 'Sub-recipe' : 'Ingredient'}</button>
            ))}
          </div>
        )}

        {form.item_type === 'ingredient' ? (
          <>
            <Field label="Ingredient" required>
              <div className="relative">
                <input
                  ref={ingInputRef}
                  className="input w-full"
                  placeholder="Search ingredients…"
                  value={ingSearch}
                  autoFocus={!item}
                  onChange={e => { setIngSearch(e.target.value); setIngOpen(true); setIngHighlightedIdx(-1); setForm(f => ({ ...f, ingredient_id: '' })) }}
                  onFocus={() => setIngOpen(true)}
                  onBlur={() => setTimeout(() => { setIngOpen(false); setIngHighlightedIdx(-1) }, 150)}
                  onKeyDown={handleIngKeyDown}
                />
                {ingOpen && filteredIngs.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-modal max-h-52 overflow-y-auto">
                    {filteredIngs.map((i, idx) => (
                      <button key={i.id} ref={el => { ingItemRefs.current[idx] = el }} type="button"
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${ingHighlightedIdx === idx ? 'bg-accent-dim text-accent' : 'hover:bg-surface-2'}`}
                        onMouseDown={() => {
                          setForm(f => ({ ...f, ingredient_id: String(i.id) }))
                          setIngSearch(i.name); setIngOpen(false); setIngHighlightedIdx(-1)
                        }}
                      >
                        <span className="font-semibold">{i.name}</span>
                        <span className="text-xs shrink-0 opacity-70">{i.category || ''}{i.base_unit_abbr ? ` · ${i.base_unit_abbr}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selIngredient && (
                <p className="text-xs text-text-3 mt-1">
                  Base unit: <span className="font-mono font-semibold text-text-2">{selIngredient.base_unit_abbr || '—'}</span>
                  {selIngredient.category && <span className="ml-2">· {selIngredient.category}</span>}
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" required>
                <input className="input font-mono" type="number" min="0.0001" step="0.0001" value={form.prep_qty} onChange={set('prep_qty')} />
              </Field>
              <Field label="Prep Unit">
                <input className="input" value={form.prep_unit} onChange={set('prep_unit')} placeholder={baseUnit || 'e.g. g'} />
              </Field>
            </div>

            <Field label={`Prep → Base Conversion${baseUnit ? ` (into ${baseUnit})` : ''}`} required>
              <input className="input font-mono" type="number" min="0.000001" step="0.000001" value={form.prep_to_base_conversion} onChange={set('prep_to_base_conversion')} />
              <p className="text-xs text-text-3 mt-1">
                {form.prep_unit && baseUnit
                  ? <>1 <span className="font-mono">{form.prep_unit}</span> = <span className="font-mono">{form.prep_to_base_conversion}</span> <span className="font-mono">{baseUnit}</span></>
                  : 'How many base units equal 1 prep unit'
                }
              </p>
            </Field>

            {baseEquiv !== null && selIngredient && (
              <div className="bg-accent-dim border border-accent/20 rounded-lg px-4 py-3 text-sm">
                <span className="font-semibold text-accent">= </span>
                <span className="font-mono text-text-1 font-bold">{fmt(baseEquiv, 3)} {baseUnit}</span>
                {Number(selIngredient.waste_pct) > 0 && (
                  <span className="text-text-3 ml-2">(+{selIngredient.waste_pct}% waste → <span className="font-mono">{fmt(baseEquiv * (1 + Number(selIngredient.waste_pct)/100), 3)} {baseUnit}</span>)</span>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <Field label="Sub-recipe" required>
              <div className="relative">
                <input
                  className="input w-full"
                  placeholder="Search recipes…"
                  value={recipeSearch}
                  autoFocus
                  onChange={e => { setRecipeSearch(e.target.value); setRecipeOpen(true); setRecipeHighlightedIdx(-1); setForm(f => ({ ...f, recipe_item_id: '' })) }}
                  onFocus={() => setRecipeOpen(true)}
                  onBlur={() => setTimeout(() => { setRecipeOpen(false); setRecipeHighlightedIdx(-1) }, 150)}
                  onKeyDown={handleRecipeKeyDown}
                />
                {recipeOpen && filteredRecipes.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-modal max-h-52 overflow-y-auto">
                    {filteredRecipes.map((r, idx) => (
                      <button key={r.id} ref={el => { recipeItemRefs.current[idx] = el }} type="button"
                        className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 transition-colors ${recipeHighlightedIdx === idx ? 'bg-accent-dim text-accent' : 'hover:bg-surface-2'}`}
                        onMouseDown={() => {
                          setForm(f => ({ ...f, recipe_item_id: String(r.id) }))
                          setRecipeSearch(r.name); setRecipeOpen(false); setRecipeHighlightedIdx(-1)
                        }}
                      >
                        <span className="font-semibold">{r.name}</span>
                        <span className="text-xs shrink-0 opacity-70">{r.category || ''}{r.yield_unit_abbr ? ` · ${r.yield_qty} ${r.yield_unit_abbr}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selRecipe && (
                <p className="text-xs text-text-3 mt-1">
                  Yield: <span className="font-mono">{selRecipe.yield_qty}</span>{selRecipe.yield_unit_abbr ? ` ${selRecipe.yield_unit_abbr}` : ''}
                  {selRecipe.category && <span className="ml-2">· {selRecipe.category}</span>}
                </p>
              )}
            </Field>
            <Field label="Portions used" required>
              <input className="input font-mono" type="number" min="0.0001" step="0.0001" value={form.prep_qty} onChange={set('prep_qty')} />
              <p className="text-xs text-text-3 mt-1">How many portions of this sub-recipe go into the parent recipe</p>
            </Field>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          {!item && onSaveAndNext && (
            <button className="btn-outline px-4 py-2 text-sm" onClick={handleSaveAndNext}
              title="Add this ingredient and open a new form (Alt+A)">
              Add &amp; Next <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Alt+A</kbd>
            </button>
          )}
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => onSave(form)}>
            {item ? 'Save Changes' : 'Add to Recipe'} <kbd className="ml-1.5 text-[10px] opacity-60 font-mono border border-current rounded px-1">Ctrl+↵</kbd>
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Small components ──────────────────────────────────────────────────────────

// KpiCard removed — stats now inline in PageHeader subtitle

// ── Alt+N shortcut helper ─────────────────────────────────────────────────────

function AltNShortcut({ onTrigger, active }: { onTrigger: () => void; active: boolean }) {
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.altKey && (e.key === 'n' || e.key === 'N')) { e.preventDefault(); onTrigger() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, onTrigger])
  return null
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
}
function EditIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
}
function TrashIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>
}
function SearchIcon({ className }: { className?: string }) {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={className}><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
}
function BookOpenIcon({ size = 24 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
}
function DragHandleIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9"  cy="5"  r="1.5"/><circle cx="15" cy="5"  r="1.5"/>
      <circle cx="9"  cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
      <circle cx="9"  cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/>
    </svg>
  )
}
function SortTh({ label, field, sortField, sortDir, onSort, align = 'left', className = '' }: {
  label: string
  field: ItemSortField
  sortField: ItemSortField
  sortDir: 'asc' | 'desc'
  onSort: (f: ItemSortField) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const active = sortField === field
  return (
    <th
      className={`${className} font-semibold select-none cursor-pointer whitespace-nowrap ${align === 'right' ? 'text-right' : 'text-left'}`}
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {align === 'right' && (
          <span className="text-[10px] leading-none text-text-3">
            {active ? (sortDir === 'asc' ? '↑' : '↓') : <span className="opacity-30">↕</span>}
          </span>
        )}
        {label}
        {align !== 'right' && (
          <span className="text-[10px] leading-none text-text-3">
            {active ? (sortDir === 'asc' ? '↑' : '↓') : <span className="opacity-30">↕</span>}
          </span>
        )}
      </span>
    </th>
  )
}

// ── Allergen badge ─────────────────────────────────────────────────────────────

function AllergenBadge({ allergens }: { allergens: { code: string; status: string }[] | undefined }) {
  if (!allergens || allergens.length === 0) return null
  const contains    = allergens.filter(a => a.status === 'contains')
  const mayContain  = allergens.filter(a => a.status === 'may_contain')
  if (contains.length === 0 && mayContain.length === 0) return null

  const tooltipLines: string[] = []
  if (contains.length)   tooltipLines.push(`Contains: ${contains.map(a => a.code).join(', ')}`)
  if (mayContain.length) tooltipLines.push(`May contain: ${mayContain.map(a => a.code).join(', ')}`)
  const tooltip = tooltipLines.join('\n')

  const hasContains = contains.length > 0
  const codes = [...contains, ...mayContain].map(a => a.code).join(' · ')

  return (
    <span className="relative group/allergen inline-flex items-center ml-1.5 align-middle">
      <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-semibold leading-none cursor-default
        ${hasContains ? 'bg-amber-100 text-amber-700' : 'bg-yellow-50 text-yellow-600'}`}>
        ⚠ {codes}
      </span>
      {/* Tooltip */}
      <span className="pointer-events-none absolute bottom-full left-0 mb-1.5 z-50 hidden group-hover/allergen:block
        whitespace-pre bg-gray-900 text-white text-xs rounded px-2 py-1.5 shadow-lg min-w-max leading-relaxed">
        {tooltip}
        <span className="absolute top-full left-3 border-4 border-transparent border-t-gray-900" />
      </span>
    </span>
  )
}
