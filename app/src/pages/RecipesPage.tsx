import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import { useCogsThresholds } from '../hooks/useCogsThresholds'
import { PageHeader, Modal, Field, Spinner, ConfirmDialog, Toast, CalcInput, CategoryPicker } from '../components/ui'
import ImageUpload from '../components/ImageUpload'
import TranslationEditor from '../components/TranslationEditor'
import { useFeatureFlags } from '../contexts/FeatureFlagsContext'
import { useCurrency } from '../contexts/CurrencyContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Ingredient { id: number; name: string; category_name: string | null; base_unit_id: number | null; base_unit_abbr: string | null; default_prep_unit: string | null; default_prep_to_base_conversion: number; waste_pct: number }
interface Recipe     { id: number; name: string; category_id: number | null; category_name: string | null; description: string | null; yield_qty: number; yield_unit_id: number | null; yield_unit_abbr: string | null; item_count: number; image_url: string | null }

interface RecipeItem {
  id:                     number
  recipe_id:              number
  item_type:              'ingredient' | 'recipe'
  ingredient_id:          number | null
  recipe_item_id:         number | null
  prep_qty:               number
  prep_unit:              string | null
  prep_to_base_conversion:number
  // When true, this item's prep_qty becomes the multiplier applied to every
  // modifier-option cost on sales items / combo step options that use this
  // recipe (e.g. Bone-In 6 with Bone-In Wing flagged at 6 → 6× sauce per
  // portion). Single-flag-per-recipe enforced server-side. Honoured only
  // when the global modifier_multiplier_enabled setting is on.
  is_modifier_multiplier?: boolean
  ingredient_name?:       string
  base_unit_abbr?:        string
  sub_recipe_name?:       string
  sub_recipe_yield_qty?:  number
  sub_recipe_yield_unit?: string | null
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

interface LinkedSalesItem {
  id: number
  name: string
  item_type: string
  category_name: string | null
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

// Display qty with at most 3 decimals AND strip trailing zeros
// (4000.00000000 → "4000", 1.5 → "1.5", 0.001 → "0.001"). DB keeps full
// precision; only the displayed string is trimmed.
const fmtQty = (n: number | string | null | undefined): string => {
  const num = Number(n ?? 0)
  if (!isFinite(num)) return ''
  return parseFloat(num.toFixed(3)).toString()
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecipesPage() {
  const api            = useApi()
  const cogsThresholds = useCogsThresholds()
  const navigate       = useNavigate()
  const { flags }      = useFeatureFlags()
  const variationsEnabled = flags.variations

  const [recipes,      setRecipes]      = useState<Recipe[]>([])
  const [ingredients,  setIngredients]  = useState<Ingredient[]>([])
  const [apiCategories,setApiCategories]= useState<{id: number; name: string}[]>([])
  const [loading,      setLoading]      = useState(true)
  const [panelWidth,   setPanelWidth]   = useState(288) // px, default w-72
  const [selected,     setSelected]     = useState<RecipeDetail | null>(null)
  const [loadingDetail,setLoadingDetail]= useState(false)
  const [selectedCountryId, setSelectedCountryId] = useState<number | '' | 'GLOBAL'>('')
  const { currencyCode: selectedCurrencyCode } = useCurrency()
  const [countries, setCountries] = useState<Country[]>([])

  // modals
  const [recipeModal,  setRecipeModal]  = useState<'new' | Recipe | null>(null)
  const [itemModal,    setItemModal]    = useState(false)
  // item edit panel (right panel — replaces editItemModal for existing items)
  const [itemPanelWidth,  setItemPanelWidth]  = useState(340)
  const [selectedItemId,  setSelectedItemId]  = useState<number | null>(null)
  const [itemPanelForm,   setItemPanelForm]   = useState<ItemForm | null>(null)
  const [itemPanelSaving, setItemPanelSaving] = useState(false)
  const [confirmDelete,setConfirmDelete]= useState<{ type: 'recipe' | 'item' | 'variation' | 'copy-to-global' | 'pl-variation' | 'pl-copy-to-global' | 'market-pl-variation'; id: number } | null>(null)
  const [itemModalForVariation, setItemModalForVariation] = useState<number | null>(null) // variation_id when adding to a variation
  const [itemModalForPlVariation, setItemModalForPlVariation] = useState<number | null>(null) // pl_variation_id when adding to a PL variation
  const [itemModalForMarketPlVariation, setItemModalForMarketPlVariation] = useState<number | null>(null) // market_pl_variation_id when adding to a market+PL variation
  const [showComparison,        setShowComparison]        = useState(false)

  // Inline-edit state for recipe header (name / yield qty / yield unit)
  const [editingHeaderField, setEditingHeaderField] = useState<'name' | 'yield_qty' | 'yield_unit' | null>(null)
  const [headerDraft, setHeaderDraft] = useState('')
  const [showImageModal, setShowImageModal] = useState(false)

  // Inline-edit state for notes (recipe description)
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')

  // Copy-ingredients-from-recipe modal
  const [showCopyModal, setShowCopyModal] = useState(false)

  // Duplicate-recipe modal — when set, holds the proposed name (defaults to
  // "<original name> (Copy)"). Submitting POSTs to /recipes/:id/duplicate and
  // navigates the detail panel to the new recipe.
  const [duplicateDraft, setDuplicateDraft] = useState<string | null>(null)
  const [duplicating, setDuplicating] = useState(false)
  // When ticked, the duplicate flow also creates a sales item linked to the
  // new recipe so it can be added to a menu without a separate trip to the
  // Sales Items page. Defaults true — most duplicates are made specifically
  // to put on a menu with a tweaked variant.
  const [duplicateAlsoSalesItem, setDuplicateAlsoSalesItem] = useState(true)

  // Create-variation modal — replaces native window.confirm/prompt dialogs
  type CreateVariationCtx =
    | { kind: 'market';    countryId: number }
    | { kind: 'pl';        priceLevelId: number }
    | { kind: 'market-pl'; countryId: number; priceLevelId: number }
  const [createVariationCtx, setCreateVariationCtx] = useState<CreateVariationCtx | null>(null)

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

  // variantMode is DERIVED from (selectedCountryId, selectedPriceLevelId) — no
  // separate toggle. The combination of selectors fully determines which kind
  // of variant we're targeting:
  //   market = real, PL = none → market variation
  //   market = none/GLOBAL, PL = real → PL variation
  //   market = real, PL = real → market+PL variation
  //   market = GLOBAL/empty, PL = none → global recipe (variantMode='market'
  //     but activeVariation will be null → activeItems falls back to global)
  const variantMode = useMemo<'market' | 'price-level' | 'market-pl'>(() => {
    const hasMarket = typeof selectedCountryId === 'number'
    const hasPL     = !!selectedPriceLevelId
    if (hasMarket && hasPL) return 'market-pl'
    if (hasPL && !hasMarket) return 'price-level'
    return 'market'
  }, [selectedCountryId, selectedPriceLevelId])
  const [menuAssignVersion,   setMenuAssignVersion]   = useState(0)
  const [editingTilePrice,    setEditingTilePrice]    = useState<string | null>(null)

  const [linkedSalesItems,    setLinkedSalesItems]    = useState<LinkedSalesItem[]>([])
  const [loadingLinkedSI,     setLoadingLinkedSI]     = useState(false)

  // search/filter
  const [search,     setSearch]     = useState('')
  const [filterCat,  setFilterCat]  = useState('')
  const [sortField,  setSortField]  = useState<'name'|'category_name'|'yield_qty'>('name')
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
        api.get('/categories?for_recipes=true'),
      ])
      setRecipes(r || [])
      setIngredients(i || [])
      setApiCategories((cats || []).map((c: any) => ({ id: c.id, name: c.name })).sort((a: any, b: any) => a.name.localeCompare(b.name)))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  const loadDetail = useCallback(async (id: number) => {
    setLoadingDetail(true)
    setSelected(null)
    setSelectedItemId(null)
    setItemPanelForm(null)
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

  // Fetch sales items that reference this recipe
  useEffect(() => {
    if (!selected) { setLinkedSalesItems([]); return }
    setLoadingLinkedSI(true)
    api.get(`/sales-items?recipe_id=${selected.id}`)
      .then((d: LinkedSalesItem[]) => setLinkedSalesItems(d || []))
      .catch(() => setLinkedSalesItems([]))
      .finally(() => setLoadingLinkedSI(false))
  }, [selected?.id, api])

  // ── Derived ───────────────────────────────────────────────────────────────

  const categories = apiCategories

  const filtered = useMemo(() => {
    let r = [...recipes]
    if (search)    r = r.filter(x => x.name.toLowerCase().includes(search.toLowerCase()) || (x.category_name||'').toLowerCase().includes(search.toLowerCase()))
    if (filterCat) r = r.filter(x => String(x.category_id) === filterCat)
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

  // Fallback chain: most-specific variant first, then less-specific, then global.
  // This matches the pill in the ingredients header — e.g. when (India, Dine In)
  // is selected but no Market+PL variation exists yet, we still show India's
  // market variation items (and the pill shows "Market Variation").
  const activeItems = useMemo(() => {
    if (!selected) return []
    if (variantMode === 'market-pl') {
      if (activeMarketPlVariation) return activeMarketPlVariation.items
      if (activeVariation)         return activeVariation.items
      if (activePlVariation)       return activePlVariation.items
      return selected.items ?? []
    }
    if (variantMode === 'price-level' && activePlVariation) return activePlVariation.items
    if (variantMode === 'market' && activeVariation)        return activeVariation.items
    return selected.items ?? []
  }, [variantMode, activeMarketPlVariation, activePlVariation, activeVariation, selected])

  // Open Add Ingredient modal — wires up the correct variation context based
  // on the active variant mode. Wrapped in useCallback so the keyboard
  // shortcut (Alt+I) gets a stable reference.
  const openAddIngredient = useCallback(() => {
    if (!selected) return
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
  }, [selected, variantMode, activeMarketPlVariation, activePlVariation, activeVariation])

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

  // ── Inline header edits ───────────────────────────────────────────────────
  // Patch one or more recipe fields without opening the modal. Backend PUT
  // replaces the full row, so we merge `patch` over the currently-loaded
  // recipe state. Used by the inline-editable name / yield / yield-unit /
  // category / image controls in the detail header.
  const updateRecipeField = useCallback(async (patch: Partial<{
    name: string; category_id: number | null; description: string | null;
    yield_qty: number; yield_unit_text: string | null; image_url: string | null
  }>) => {
    if (!selected) return
    try {
      await api.put(`/recipes/${selected.id}`, {
        name:            patch.name        ?? selected.name,
        category_id:     'category_id'     in patch ? patch.category_id     : selected.category_id,
        description:     'description'     in patch ? patch.description     : (selected.description ?? null),
        yield_qty:       patch.yield_qty   ?? selected.yield_qty,
        yield_unit_text: 'yield_unit_text' in patch ? patch.yield_unit_text : (selected.yield_unit_abbr ?? null),
        image_url:       'image_url'       in patch ? patch.image_url       : (selected.image_url ?? null),
      })
      loadDetail(selected.id)
      // Refresh the row in the left list if name/category changed
      setRecipes(prev => prev.map(r => r.id === selected.id
        ? { ...r,
            name:        patch.name        ?? r.name,
            category_id: 'category_id' in patch ? patch.category_id ?? null : r.category_id,
          }
        : r
      ))
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    }
  }, [selected, api, loadDetail])

  // ── Recipe CRUD ───────────────────────────────────────────────────────────

  const saveRecipe = async (form: RecipeForm) => {
    const isNew = recipeModal === 'new'
    const payload = {
      name:            form.name.trim(),
      category_id:     Number(form.category_id) || null,
      description:     form.description.trim() || null,
      yield_qty:       Number(form.yield_qty) || 1,
      yield_unit_text: form.yield_unit_text.trim() || null,
      image_url:       form.image_url.trim() || null,
    }
    if (!payload.name) return showToast('Name is required', 'error')
    try {
      if (isNew) {
        const r = await api.post('/recipes', payload)
        if (form.createSalesItem) {
          // Carry the recipe's category onto the sales item so the user
          // doesn't have to re-pick it. The backend POST /sales-items will
          // also auto-flip the category's `for_sales_items` flag to true if
          // it wasn't already, so the new item is visible in Sales Items
          // category dropdowns straight away.
          try {
            await api.post('/sales-items', {
              name:        r.name,
              item_type:   'recipe',
              recipe_id:   r.id,
              category_id: r.category_id ?? null,
            })
          } catch {}
        }
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

  // Duplicate the selected recipe — copies metadata, global items, and every
  // variation (market / PL / market+PL) end-to-end. Backend handles all of
  // it in a transaction; we just refresh the list and load the new id.
  // When `alsoSalesItem` is true we also POST /sales-items with the new
  // recipe linked so the duplicate is immediately puttable on a menu. The
  // sales item inherits the recipe's category (the sales-items API
  // auto-flips for_sales_items=true on the linked category if needed).
  const duplicateRecipe = async (newName: string, alsoSalesItem: boolean) => {
    if (!selected) return
    setDuplicating(true)
    try {
      const r = await api.post(`/recipes/${selected.id}/duplicate`, { name: newName }) as Recipe
      setRecipes(prev => [...prev, r].sort((a, b) => a.name.localeCompare(b.name)))

      let salesItemMsg = ''
      if (alsoSalesItem) {
        try {
          await api.post('/sales-items', {
            item_type:    'recipe',
            name:         newName,
            display_name: newName,
            category_id:  r.category_id ?? null,
            recipe_id:    r.id,
          })
          salesItemMsg = ' (sales item created)'
        } catch (e: any) {
          // Non-fatal — the recipe duplicate succeeded; surface the failure
          // in the toast so the user knows to create the sales item manually.
          salesItemMsg = ` (⚠ sales item failed: ${e?.message || 'unknown error'})`
        }
      }

      setDuplicateDraft(null)
      showToast(`Duplicated "${selected.name}" → "${newName}"${salesItemMsg}`)
      loadDetail(r.id)
    } catch (err: any) {
      showToast(err.message || 'Duplicate failed', 'error')
    } finally {
      setDuplicating(false)
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

  // Copy a list of RecipeItems into the current recipe's active variant.
  // Targets the same variant the Add Ingredient button would target — global,
  // market variation, PL variation, or market+PL variation.
  const copyItemsFromSource = async (items: RecipeItem[]) => {
    if (!selected || items.length === 0) return
    let basePath = `/recipes/${selected.id}/items`
    if (variantMode === 'market-pl' && activeMarketPlVariation) {
      basePath = `/recipes/${selected.id}/market-pl-variations/${activeMarketPlVariation.id}/items`
    } else if (variantMode === 'price-level' && activePlVariation) {
      basePath = `/recipes/${selected.id}/pl-variations/${activePlVariation.id}/items`
    } else if (variantMode === 'market' && activeVariation) {
      basePath = `/recipes/${selected.id}/variations/${activeVariation.id}/items`
    }
    let ok = 0, fail = 0
    for (const it of items) {
      try {
        await api.post(basePath, {
          item_type:               it.item_type,
          ingredient_id:           it.item_type === 'ingredient' ? it.ingredient_id : null,
          recipe_item_id:          it.item_type === 'recipe'     ? it.recipe_item_id : null,
          prep_qty:                Number(it.prep_qty),
          prep_unit:               it.prep_unit ?? null,
          prep_to_base_conversion: Number(it.prep_to_base_conversion) || 1,
        })
        ok++
      } catch {
        fail++
      }
    }
    showToast(fail === 0
      ? `Copied ${ok} ingredient${ok !== 1 ? 's' : ''}`
      : `Copied ${ok}, ${fail} failed`, fail === 0 ? undefined : 'error')
    setShowCopyModal(false)
    loadDetail(selected.id)
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
    if (!selected || !selectedItemId) return
    setItemPanelSaving(true)
    try {
      await api.put(`/recipes/${selected.id}/items/${selectedItemId}`, {
        prep_qty:               Number(form.prep_qty),
        prep_unit:              form.prep_unit.trim() || null,
        prep_to_base_conversion:Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setSelectedItemId(null)
      setItemPanelForm(null)
      loadDetail(selected.id)
    } catch (err: any) {
      showToast(err.message || 'Update failed', 'error')
    } finally {
      setItemPanelSaving(false)
    }
  }

  // Inline qty save for the ingredient list — dispatches to the correct
  // endpoint based on which variant view is active, preserving prep_unit
  // and prep_to_base_conversion (we only patch prep_qty here). Optimistic
  // refresh via loadDetail on success.
  const saveItemQtyInline = async (item: { id: number; prep_qty: number | string; prep_unit: string | null; prep_to_base_conversion: number | string }, raw: string) => {
    if (!selected) return
    const trimmed = (raw ?? '').trim()
    if (trimmed === '' || Number.isNaN(Number(trimmed)) || Number(trimmed) < 0) {
      showToast('Quantity must be a non-negative number', 'error')
      return
    }
    const qty = Number(trimmed)
    // Display is rounded to 3dp — treat sub-millisecond differences as no-op
    // so opening then blurring an unchanged cell doesn't fire a phantom PUT
    // that would silently strip DB-side precision past the 3rd decimal.
    if (Math.abs(qty - Number(item.prep_qty)) < 0.0005) return

    const body = {
      prep_qty:                qty,
      prep_unit:               item.prep_unit ?? null,
      prep_to_base_conversion: Number(item.prep_to_base_conversion) || 1,
    }

    // Pick the endpoint matching the currently-shown variant.
    let path = `/recipes/${selected.id}/items/${item.id}`
    if (variantMode === 'market-pl' && activeMarketPlVariation) {
      path = `/recipes/${selected.id}/market-pl-variations/${activeMarketPlVariation.id}/items/${item.id}`
    } else if (variantMode === 'price-level' && activePlVariation) {
      path = `/recipes/${selected.id}/pl-variations/${activePlVariation.id}/items/${item.id}`
    } else if (variantMode === 'market' && activeVariation) {
      path = `/recipes/${selected.id}/variations/${activeVariation.id}/items/${item.id}`
    }

    try {
      await api.put(path, body)
      loadDetail(selected.id)
    } catch (err: any) {
      showToast(err.message || 'Save failed', 'error')
    }
  }

  // Toggle the modifier-multiplier flag on a recipe item. Only meaningful
  // for ingredient-typed items on the GLOBAL recipe (not variations) — server
  // enforces single-flag-per-recipe inside a transaction, clearing the flag
  // on every other row before setting it on the target. Optimistic UI swap
  // followed by loadDetail to pick up the cleared flags on other rows.
  const toggleMultiplierFlag = async (item: RecipeItem) => {
    if (!selected) return
    const next = !(item.is_modifier_multiplier ?? false)
    try {
      await api.put(`/recipes/${selected.id}/items/${item.id}`, {
        prep_qty:                Number(item.prep_qty),
        prep_unit:               item.prep_unit ?? null,
        prep_to_base_conversion: Number(item.prep_to_base_conversion) || 1,
        is_modifier_multiplier:  next,
      })
      loadDetail(selected.id)
    } catch (err: any) {
      showToast(err.message || 'Failed to update multiplier flag', 'error')
    }
  }

  // Multiplier UI is only visible / interactive when the user is looking at
  // the GLOBAL recipe (no specific market or PL variation). Variations
  // inherit the global flag value but cannot set their own (v1 simplification).
  // selectedCountryId is 'GLOBAL' | '' | number; both string forms mean
  // unscoped. PL must also be unset.
  const isGlobalView = (selectedCountryId === 'GLOBAL' || selectedCountryId === '') && !selectedPriceLevelId

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
    if (!selected || !selectedItemId) return
    setItemPanelSaving(true)
    try {
      await api.put(`/recipes/${selected.id}/variations/${varId}/items/${selectedItemId}`, {
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setSelectedItemId(null)
      setItemPanelForm(null)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Update failed', 'error') }
    finally { setItemPanelSaving(false) }
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
    if (!selected || !selectedItemId) return
    setItemPanelSaving(true)
    try {
      await api.put(`/recipes/${selected.id}/pl-variations/${varId}/items/${selectedItemId}`, {
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setSelectedItemId(null)
      setItemPanelForm(null)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Update failed', 'error') }
    finally { setItemPanelSaving(false) }
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
    if (!selected || !selectedItemId) return
    setItemPanelSaving(true)
    try {
      await api.put(`/recipes/${selected.id}/market-pl-variations/${varId}/items/${selectedItemId}`, {
        prep_qty:                Number(form.prep_qty),
        prep_unit:               form.prep_unit.trim() || null,
        prep_to_base_conversion: Number(form.prep_to_base_conversion) || 1,
      })
      showToast('Item updated')
      setSelectedItemId(null)
      setItemPanelForm(null)
      loadDetail(selected.id)
    } catch (err: any) { showToast(err.message || 'Update failed', 'error') }
    finally { setItemPanelSaving(false) }
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
    if (pct <= cogsThresholds.excellent)  return 'text-emerald-600'
    if (pct <= cogsThresholds.acceptable) return 'text-amber-500'
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

      {/* Alt+I → Add Ingredient (only when a recipe is selected and no other modal is open) */}
      <AltShortcut
        keyChar="i"
        onTrigger={openAddIngredient}
        active={!!selected && !itemModal && !showCopyModal && recipeModal === null && !showImageModal}
      />

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
                {categories.map(c => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
              </select>
              <select value={sortField} onChange={e => setSortField(e.target.value as any)} className="input text-xs w-28">
                <option value="name">Name</option>
                <option value="category_name">Category</option>
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
                    {r.category_name && <span className="text-xs text-text-3 truncate">{r.category_name}</span>}
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

        {/* ── Right: recipe detail + item panel ── */}
        <div className="flex flex-1 overflow-hidden">
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

              {/* Detail header — image thumb + inline editable name/category/yield */}
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-start gap-3 flex-1 min-w-0">

                  {/* Image thumbnail (clickable → modal) */}
                  <button
                    type="button"
                    onClick={() => setShowImageModal(true)}
                    title={selected.image_url ? 'Change image' : 'Add image'}
                    className="shrink-0 w-14 h-14 rounded-lg border border-border bg-surface-2 hover:border-accent hover:shadow-sm overflow-hidden flex items-center justify-center transition-all"
                  >
                    {selected.image_url ? (
                      <img src={selected.image_url} alt={selected.name} className="w-full h-full object-cover" />
                    ) : (
                      <ImagePlaceholderIcon size={22} />
                    )}
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Name — inline editable */}
                    {editingHeaderField === 'name' ? (
                      <input
                        autoFocus
                        className="input text-xl font-bold w-full"
                        value={headerDraft}
                        onChange={e => setHeaderDraft(e.target.value)}
                        onBlur={() => {
                          const v = headerDraft.trim()
                          if (v && v !== selected.name) updateRecipeField({ name: v })
                          setEditingHeaderField(null)
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                          else if (e.key === 'Escape') setEditingHeaderField(null)
                        }}
                      />
                    ) : (
                      <h2
                        className="text-xl font-bold text-text-1 cursor-text hover:bg-surface-2 -mx-1 px-1 rounded transition-colors truncate"
                        title="Click to edit name"
                        onClick={() => { setHeaderDraft(selected.name); setEditingHeaderField('name') }}
                      >
                        {selected.name}
                      </h2>
                    )}

                    {/* Category picker + yield + ingredient count */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <div style={{ minWidth: 180 }}>
                        <CategoryPicker
                          value={selected.category_id != null ? String(selected.category_id) : ''}
                          onChange={s => {
                            const n = s ? Number(s) : null
                            if (n !== selected.category_id) updateRecipeField({ category_id: n })
                          }}
                          categories={categories}
                          scope="for_recipes"
                          onCategoryCreated={cat => setApiCategories(prev =>
                            [...prev, cat].sort((a, b) => a.name.localeCompare(b.name)),
                          )}
                          apiPost={(p, b) => api.post(p, b)}
                          className="input text-xs py-1"
                          placeholder="Category…"
                          allowCreate={false}
                        />
                      </div>

                      <span className="text-sm text-text-3 flex items-center gap-1">
                        Yield:&nbsp;
                        {editingHeaderField === 'yield_qty' ? (
                          <CalcInput
                            autoFocus
                            className="input font-mono font-semibold text-text-2 w-20 text-sm py-0.5 px-1"
                            value={headerDraft}
                            // CalcInput.onChange fires on every keystroke for
                            // plain numeric input — only update local draft
                            // here; commit and unmount on blur/Enter so focus
                            // doesn't drop after the first digit.
                            onChange={v => setHeaderDraft(v)}
                            onBlur={() => {
                              const n = Number(headerDraft)
                              if (!Number.isNaN(n) && n > 0 && n !== Number(selected.yield_qty)) {
                                updateRecipeField({ yield_qty: n })
                              }
                              setEditingHeaderField(null)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              else if (e.key === 'Escape') setEditingHeaderField(null)
                            }}
                          />
                        ) : (
                          <span
                            className="font-mono font-semibold text-text-2 cursor-text hover:bg-surface-2 -mx-0.5 px-0.5 rounded"
                            title="Click to edit yield"
                            onClick={() => { setHeaderDraft(String(selected.yield_qty)); setEditingHeaderField('yield_qty') }}
                          >
                            {selected.yield_qty}
                          </span>
                        )}
                        &nbsp;
                        {editingHeaderField === 'yield_unit' ? (
                          <input
                            autoFocus
                            className="input w-20 text-sm py-0.5 px-1"
                            value={headerDraft}
                            onChange={e => setHeaderDraft(e.target.value)}
                            onBlur={() => {
                              const v = headerDraft.trim() || null
                              if (v !== (selected.yield_unit_abbr ?? null)) {
                                updateRecipeField({ yield_unit_text: v })
                              }
                              setEditingHeaderField(null)
                            }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                              else if (e.key === 'Escape') setEditingHeaderField(null)
                            }}
                            placeholder="unit"
                          />
                        ) : (
                          <span
                            className="text-text-2 cursor-text hover:bg-surface-2 -mx-0.5 px-0.5 rounded"
                            title="Click to edit yield unit"
                            onClick={() => { setHeaderDraft(selected.yield_unit_abbr ?? ''); setEditingHeaderField('yield_unit') }}
                          >
                            {selected.yield_unit_abbr || <span className="text-text-3 italic">unit</span>}
                          </span>
                        )}
                      </span>

                      <span className="text-sm text-text-3">·</span>
                      <span className="text-sm text-text-3">{activeItems.length} ingredient{activeItems.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                    onClick={() => setDuplicateDraft(`${selected.name} (Copy)`)}
                    title="Create a copy of this recipe with all ingredients and variations"
                  >
                    <CopyIcon size={12} /> Duplicate
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1.5"
                    onClick={() => setConfirmDelete({ type: 'recipe', id: selected.id })}
                  >
                    <TrashIcon size={12} /> Delete
                  </button>
                </div>
              </div>

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
                              <CalcInput
                                className="input text-sm font-mono w-24 py-0.5 px-1"
                                value={editingTilePrice}
                                onChange={v => setEditingTilePrice(v)}
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
                            empty:            { icon: '—', label: 'No ingredients',    cls: 'text-text-3',     sub: 'Add ingredients to see quote coverage',           subCls: 'text-text-3'      },
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

              {/* ── Market + Price Level + Currency selectors (moved here from above KPIs) ── */}
              {selected.cogs_by_country.length > 0 && (
                <div className="flex items-center gap-4 mb-3 flex-wrap">

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-3 whitespace-nowrap">Market</span>
                    <select
                      value={selectedCountryId}
                      onChange={e => {
                        const v = e.target.value
                        const newId = v === 'GLOBAL' ? 'GLOBAL' : Number(v)
                        setSelectedCountryId(newId)
                        setShowComparison(false)
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

                  {/* Contextual variant actions — driven entirely by the
                      Market + Price Level selection above. */}
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    {activeCogs && activeVariation && (
                      <button
                        onClick={() => setShowComparison(p => !p)}
                        className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${showComparison ? 'border-accent bg-accent text-white' : 'border-border text-text-2 hover:border-accent hover:text-accent bg-surface'}`}
                        title="Side-by-side comparison of global vs market variation ingredients"
                      >
                        ⇄ Compare
                      </button>
                    )}

                    {/* Market variation actions */}
                    {variantMode === 'market' && variationsEnabled && selectedCountryId !== '' && selectedCountryId !== 'GLOBAL' && (
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
                          onClick={() => setCreateVariationCtx({ kind: 'market', countryId: selectedCountryId as number })}
                          title="Create a market-specific variation of this recipe"
                        >
                          ✦ Create Variation
                        </button>
                      )
                    )}

                    {/* Price-level variation actions */}
                    {variantMode === 'price-level' && variationsEnabled && selectedPriceLevelId && (
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
                          onClick={() => setCreateVariationCtx({ kind: 'pl', priceLevelId: selectedPriceLevelId })}
                          title="Create a price-level-specific variation of this recipe"
                        >
                          ✦ Create Variation
                        </button>
                      )
                    )}

                    {/* Market+PL variation actions */}
                    {variantMode === 'market-pl' && variationsEnabled && selectedCountryId !== '' && selectedCountryId !== 'GLOBAL' && selectedPriceLevelId && (
                      activeMarketPlVariation ? (
                        <button
                          className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1"
                          onClick={() => setConfirmDelete({ type: 'market-pl-variation', id: activeMarketPlVariation.id })}
                          title="Delete this market+PL variation"
                        >
                          <TrashIcon size={11} /> Delete Variation
                        </button>
                      ) : (
                        <button
                          className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                          onClick={() => setCreateVariationCtx({ kind: 'market-pl', countryId: selectedCountryId as number, priceLevelId: selectedPriceLevelId })}
                          title="Create a market+price-level-specific variation"
                        >
                          ✦ Create Variation
                        </button>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* ── Ingredients table ── */}
              <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">

                {/* Table header bar */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <span className="font-semibold text-sm text-text-1 shrink-0">Ingredients</span>
                    {/* Variant pill — derived from current Market + Price Level selection */}
                    {variantMode === 'market-pl' && activeMarketPlVariation
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 font-semibold shrink-0">✦ Variation: {activeMarketPlVariation.country_name} · {activeMarketPlVariation.price_level_name}</span>
                      : variantMode === 'price-level' && activePlVariation
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-semibold shrink-0">✦ Variation: {activePlVariation.price_level_name}</span>
                        : activeCogs?.has_variation
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold shrink-0">✦ Variation: {selected.cogs_by_country.find(c => c.country_id === selectedCountryId)?.country_name ?? 'Market'}</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-text-3 shrink-0">🌍 Global recipe</span>
                    }
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                      onClick={() => setShowCopyModal(true)}
                      title="Copy ingredients from another recipe"
                    >
                      <CopyIcon size={11} /> Copy Ingredients
                    </button>
                    <button
                      className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                      onClick={openAddIngredient}
                      title="Add ingredient (Alt+I)"
                    >
                      <PlusIcon size={11} /> Add Ingredient
                      <kbd className="ml-1 hidden sm:inline-flex items-center px-1 py-px text-[10px] font-mono text-text-3 bg-surface-2 border border-border rounded">Alt+I</kbd>
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
                                    {fmtQty(item.prep_qty)} {item.prep_unit || item.base_unit_abbr || (item.item_type === 'recipe' ? (item.sub_recipe_yield_unit || 'portion') : '—')}
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
                                    {fmtQty(item.prep_qty)} {item.prep_unit || item.base_unit_abbr || (item.item_type === 'recipe' ? (item.sub_recipe_yield_unit || 'portion') : '—')}
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
                          {/* × mod — modifier multiplier flag. Only one item per
                              recipe can carry it; the flagged item's prep_qty
                              becomes the multiplier on attached modifier costs.
                              Hidden when looking at a market/PL variation
                              (variations inherit the global flag, can't override). */}
                          {isGlobalView && (
                            <th className="px-2 py-2.5 text-center text-xs font-semibold text-text-3" title="Modifier multiplier — flag the item whose qty multiplies modifier costs (e.g. Bone-In Wing × 6 → sauce × 6 per portion).">× mod</th>
                          )}
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
                              className={`border-b border-border last:border-0 group transition-colors cursor-pointer
                                ${isDragging ? 'opacity-40' : ''}
                                ${isOver ? 'border-t-2 border-t-accent bg-accent-dim/30' : selectedItemId === item.id ? 'bg-accent-dim border-l-2 border-l-accent' : 'hover:bg-surface-2/50'}
                              `}
                              draggable={itemSortField === 'custom'}
                              onDragStart={itemSortField === 'custom' ? () => setDragId(item.id) : undefined}
                              onDragOver={itemSortField === 'custom' ? e => { e.preventDefault(); setDragOverId(item.id) } : undefined}
                              onDragLeave={itemSortField === 'custom' ? () => setDragOverId(null) : undefined}
                              onDrop={itemSortField === 'custom' ? e => { e.preventDefault(); if (dragId !== null) reorderItems(dragId, item.id); setDragId(null); setDragOverId(null) } : undefined}
                              onClick={() => {
                                setSelectedItemId(item.id)
                                setItemPanelForm({
                                  item_type:               item.item_type,
                                  ingredient_id:           String(item.ingredient_id ?? ''),
                                  recipe_item_id:          String(item.recipe_item_id ?? ''),
                                  prep_qty:                String(item.prep_qty),
                                  prep_unit:               item.prep_unit ?? '',
                                  prep_to_base_conversion: String(item.prep_to_base_conversion),
                                })
                              }}
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
                              <td className="px-4 py-2.5 font-mono text-text-2"
                                  onClick={e => e.stopPropagation()}>
                                {/* Inline qty edit. CalcInput.onChange used to
                                    fire on every keystroke for plain numeric
                                    input — saveItemQtyInline ran per digit,
                                    loadDetail re-keyed the row, and the input
                                    lost focus mid-typing. Switched to
                                    onCommit (fires once on Enter / blur) and
                                    a no-op onChange so typing stays local. */}
                                <span className="inline-flex items-center gap-1.5">
                                  <CalcInput
                                    className="input w-24 py-0.5 px-1.5 font-mono text-sm"
                                    value={fmtQty(item.prep_qty)}
                                    onChange={() => { /* commit-only, see below */ }}
                                    onCommit={v => saveItemQtyInline(item, v)}
                                  />
                                  <span className="text-text-3">
                                    {item.prep_unit
                                      || item.base_unit_abbr
                                      || (item.item_type === 'recipe' ? (item.sub_recipe_yield_unit || `portion${Number(item.prep_qty) !== 1 ? 's' : ''}`) : '')}
                                  </span>
                                </span>
                              </td>
                              {/* × mod cell — checkbox toggling the
                                  is_modifier_multiplier flag. Single-flag-per
                                  recipe enforced server-side. Disabled for
                                  recipe-typed items (sub-recipes can't
                                  themselves carry the flag — flag the leaf
                                  ingredient instead) and on variations. */}
                              {isGlobalView && (
                                <td className="px-2 py-2.5 text-center" onClick={e => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    checked={!!item.is_modifier_multiplier}
                                    disabled={item.item_type !== 'ingredient'}
                                    onChange={() => toggleMultiplierFlag(item)}
                                    className="cursor-pointer"
                                    title={item.item_type !== 'ingredient'
                                      ? 'Only ingredient lines can be flagged as the multiplier'
                                      : (item.is_modifier_multiplier
                                          ? `Flagged — modifier costs scale by ${fmtQty(item.prep_qty)}× (this item''s qty)`
                                          : `Click to flag this item as the multiplier (sets modifier scale to ${fmtQty(item.prep_qty)}×)`)}
                                  />
                                </td>
                              )}
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
                              <td className="px-2 py-1" onClick={e => e.stopPropagation()}>
                                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                            <td className="px-4 py-2.5 font-semibold text-text-2" colSpan={itemSortField === 'custom' ? 3 : 2}>Total</td>
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

              {/* ── Linked Sales Items section ── */}
              {selected && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="font-semibold text-sm text-text-1">Linked Sales Items</span>
                    <span className="text-xs text-text-3">
                      {loadingLinkedSI ? 'Loading…' : linkedSalesItems.length === 0 ? 'None' : `${linkedSalesItems.length} item${linkedSalesItems.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  {loadingLinkedSI ? (
                    <div className="p-4 text-center"><Spinner /></div>
                  ) : linkedSalesItems.length === 0 ? (
                    <div className="px-4 py-6 text-center text-text-3 text-sm">
                      No sales items are linked to this recipe.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-200 border-b border-gray-300 text-xs text-text-2 uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Type</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linkedSalesItems.map(si => (
                          <tr key={si.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                            <td className="px-4 py-2.5 font-medium">
                              <button
                                className="text-accent hover:underline text-left"
                                onClick={() => navigate('/sales-items')}
                                title="Open in Sales Items"
                              >{si.name}</button>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="badge-neutral capitalize">{si.item_type}</span>
                            </td>
                            <td className="px-4 py-2.5 text-text-3">{si.category_name ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* ── Notes (inline editable, replaces Edit-modal description) ── */}
              {selected && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="font-semibold text-sm text-text-1">Notes</span>
                    {!editingNotes && (
                      <button
                        className="text-xs text-text-3 hover:text-accent flex items-center gap-1"
                        onClick={() => { setNotesDraft(selected.description ?? ''); setEditingNotes(true) }}
                      >
                        <EditIcon size={11} /> {selected.description ? 'Edit' : 'Add notes'}
                      </button>
                    )}
                  </div>
                  <div className="px-4 py-3">
                    {editingNotes ? (
                      <>
                        <textarea
                          autoFocus
                          className="input w-full"
                          rows={4}
                          value={notesDraft}
                          onChange={e => setNotesDraft(e.target.value)}
                          placeholder="Method, prep tips, allergen notes…"
                          onKeyDown={e => {
                            if (e.key === 'Escape') setEditingNotes(false)
                          }}
                        />
                        <div className="flex items-center justify-end gap-2 mt-2">
                          <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setEditingNotes(false)}>Cancel</button>
                          <button
                            className="btn-primary px-3 py-1.5 text-xs"
                            onClick={() => {
                              const trimmed = notesDraft.trim()
                              const next: string | null = trimmed === '' ? null : trimmed
                              if (next !== (selected.description ?? null)) updateRecipeField({ description: next })
                              setEditingNotes(false)
                            }}
                          >Save</button>
                        </div>
                      </>
                    ) : selected.description ? (
                      <p className="text-sm text-text-2 leading-relaxed whitespace-pre-wrap">{selected.description}</p>
                    ) : (
                      <p className="text-sm text-text-3 italic">No notes yet.</p>
                    )}
                  </div>
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

        {/* ── Item drag handle + edit panel ── */}
        {selectedItemId !== null && itemPanelForm !== null && (() => {
          const item = activeItems.find(i => i.id === selectedItemId)
          if (!item) return null
          const itemName = item.item_type === 'ingredient' ? item.ingredient_name : item.sub_recipe_name
          const isSubRecipe = item.item_type === 'recipe'
          const baseUnit = item.base_unit_abbr || ''
          const baseEquiv = !isSubRecipe ? Number(itemPanelForm.prep_qty) * Number(itemPanelForm.prep_to_base_conversion) : null
          return (
            <>
              <div
                className="w-1 hover:w-1.5 bg-border hover:bg-accent cursor-col-resize shrink-0 transition-all duration-100 active:bg-accent"
                onMouseDown={e => {
                  e.preventDefault()
                  const startX = e.clientX
                  const startW = itemPanelWidth
                  const onMove = (ev: MouseEvent) => setItemPanelWidth(Math.max(260, Math.min(520, startW - (ev.clientX - startX))))
                  const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                  window.addEventListener('mousemove', onMove)
                  window.addEventListener('mouseup', onUp)
                }}
              />
              <div
                className="flex flex-col bg-surface border-l border-border overflow-hidden shrink-0"
                style={{ width: itemPanelWidth, minWidth: 260, maxWidth: 520 }}
              >
                {/* Panel header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-text-1 truncate">{itemName || '—'}</div>
                    <div className="text-xs text-text-3 truncate">
                      {isSubRecipe ? 'Sub-recipe' : `Base unit: ${baseUnit || '—'}`}
                    </div>
                  </div>
                  <button
                    className="ml-2 w-6 h-6 flex items-center justify-center rounded hover:bg-surface-2 text-text-3 shrink-0"
                    onClick={() => { setSelectedItemId(null); setItemPanelForm(null) }}
                  >✕</button>
                </div>

                {/* Panel body */}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                  {isSubRecipe ? (
                    <Field label="Portions used">
                      <CalcInput
                        className="input w-full font-mono"
                        value={itemPanelForm.prep_qty}
                        onChange={v => setItemPanelForm(f => f ? { ...f, prep_qty: v } : f)}
                        autoFocus
                      />
                      <p className="text-xs text-text-3 mt-1">How many portions of this sub-recipe go into the parent recipe</p>
                    </Field>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <Field label="Quantity">
                          <CalcInput
                            className="input w-full font-mono"
                            value={itemPanelForm.prep_qty}
                            onChange={v => setItemPanelForm(f => f ? { ...f, prep_qty: v } : f)}
                            autoFocus
                          />
                        </Field>
                        <Field label="Prep Unit">
                          <input
                            className="input"
                            value={itemPanelForm.prep_unit}
                            onChange={e => setItemPanelForm(f => f ? { ...f, prep_unit: e.target.value } : f)}
                            placeholder={baseUnit || 'e.g. g'}
                          />
                        </Field>
                      </div>

                      <Field label={`Prep → Base Conversion${baseUnit ? ` (into ${baseUnit})` : ''}`}>
                        <CalcInput
                          className="input w-full font-mono"
                          value={itemPanelForm.prep_to_base_conversion}
                          onChange={v => setItemPanelForm(f => f ? { ...f, prep_to_base_conversion: v } : f)}
                        />
                        <p className="text-xs text-text-3 mt-1">
                          {itemPanelForm.prep_unit && baseUnit
                            ? <>1 <span className="font-mono">{itemPanelForm.prep_unit}</span> = <span className="font-mono">{itemPanelForm.prep_to_base_conversion}</span> <span className="font-mono">{baseUnit}</span></>
                            : 'How many base units equal 1 prep unit'
                          }
                        </p>
                      </Field>

                      {baseEquiv !== null && baseUnit && (
                        <div className="bg-accent-dim border border-accent/20 rounded-lg px-4 py-3 text-sm">
                          <span className="font-semibold text-accent">= </span>
                          <span className="font-mono text-text-1 font-bold">{fmt(baseEquiv, 3)} {baseUnit}</span>
                          {typeof item.waste_pct === 'number' && item.waste_pct > 0 && (
                            <span className="text-text-3 ml-2">(+{item.waste_pct}% waste → <span className="font-mono">{fmt(baseEquiv * (1 + item.waste_pct / 100), 3)} {baseUnit}</span>)</span>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Panel footer */}
                <div className="shrink-0 flex justify-end gap-2 px-4 py-3 border-t border-border bg-surface">
                  <button
                    className="btn-ghost px-3 py-1.5 text-sm"
                    onClick={() => { setSelectedItemId(null); setItemPanelForm(null) }}
                  >Cancel</button>
                  <button
                    className="btn-primary px-3 py-1.5 text-sm"
                    disabled={itemPanelSaving}
                    onClick={() => {
                      if (!itemPanelForm) return
                      if (activeMarketPlVariation && variantMode === 'market-pl') updateMarketPlVariationItem(activeMarketPlVariation.id, itemPanelForm)
                      else if (activePlVariation && variantMode === 'price-level') updatePlVariationItem(activePlVariation.id, itemPanelForm)
                      else if (activeVariation) updateVariationItem(activeVariation.id, itemPanelForm)
                      else updateItem(itemPanelForm)
                    }}
                  >{itemPanelSaving ? 'Saving…' : 'Save Changes'}</button>
                </div>
              </div>
            </>
          )
        })()}

        </div>{/* end flex flex-1 overflow-hidden for detail+panel */}
      </div>

      {/* ── Modals ── */}

      {recipeModal !== null && (
        <RecipeFormModal
          recipe={recipeModal === 'new' ? null : recipeModal}
          categories={categories}
          onSave={saveRecipe}
          onClose={() => setRecipeModal(null)}
          onCategoryCreated={cat => setApiCategories(prev =>
            [...prev, cat].sort((a, b) => a.name.localeCompare(b.name))
          )}
          apiPost={(p, b) => api.post(p, b)}
        />
      )}

      {duplicateDraft !== null && selected && (
        <Modal title={`Duplicate "${selected.name}"`} onClose={() => !duplicating && setDuplicateDraft(null)}>
          <div className="space-y-4">
            <p className="text-sm text-text-2">
              Creates a full copy of this recipe — all ingredients, variations, and metadata are preserved.
              Only the name needs to differ.
            </p>
            <Field label="New recipe name" required>
              <input
                autoFocus
                className="input w-full"
                value={duplicateDraft}
                onChange={e => setDuplicateDraft(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && duplicateDraft.trim() && !duplicating) {
                    duplicateRecipe(duplicateDraft.trim(), duplicateAlsoSalesItem)
                  }
                }}
                disabled={duplicating}
              />
            </Field>

            {/* Also create a sales item linked to the new recipe so the
                duplicate is ready to drop on a menu. The category gets
                for_sales_items=true automatically (sales-items API handles it). */}
            <label className="flex items-start gap-2 cursor-pointer p-2 rounded hover:bg-surface-2 -mx-2">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={duplicateAlsoSalesItem}
                onChange={e => setDuplicateAlsoSalesItem(e.target.checked)}
                disabled={duplicating}
              />
              <div className="text-sm">
                <div className="font-medium text-text-1">Create matching sales item</div>
                <div className="text-xs text-text-3">
                  Adds a recipe-type sales item with the same name + category, linked to the new recipe.
                  Lets you drop it on a menu without a separate trip to Sales Items.
                </div>
              </div>
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              <button
                className="btn-outline px-3 py-1.5 text-sm"
                onClick={() => setDuplicateDraft(null)}
                disabled={duplicating}
              >Cancel</button>
              <button
                className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50"
                disabled={!duplicateDraft.trim() || duplicating}
                onClick={() => duplicateRecipe(duplicateDraft.trim(), duplicateAlsoSalesItem)}
              >
                {duplicating ? 'Duplicating…' : (<><CopyIcon size={12} /> Duplicate</>)}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {showImageModal && selected && (
        <Modal title="Recipe image" onClose={() => setShowImageModal(false)}>
          <div className="space-y-4">
            {selected.image_url ? (
              <div className="rounded-lg border border-border overflow-hidden bg-surface-2">
                <img src={selected.image_url} alt={selected.name} className="w-full max-h-96 object-contain bg-surface-2" />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-text-3 text-sm">
                No image yet — upload one below.
              </div>
            )}
            <ImageUpload
              label={selected.image_url ? 'Replace image' : 'Upload image'}
              value={selected.image_url || null}
              onChange={url => updateRecipeField({ image_url: url || null })}
              formKey="recipe"
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
              {selected.image_url && (
                <button
                  className="px-3 py-1.5 text-xs border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors flex items-center gap-1.5"
                  onClick={() => { updateRecipeField({ image_url: null }); setShowImageModal(false) }}
                >
                  <TrashIcon size={12} /> Remove image
                </button>
              )}
              <button className="btn-outline px-3 py-1.5 text-xs" onClick={() => setShowImageModal(false)}>Close</button>
            </div>
          </div>
        </Modal>
      )}

      {itemModal && (
        <ItemFormModal
          item={null}
          ingredients={ingredients}
          recipes={recipes.filter(r => r.id !== selected?.id)}
          onSave={form => {
            if (itemModalForMarketPlVariation != null) addMarketPlVariationItem(itemModalForMarketPlVariation, form)
            else if (itemModalForPlVariation != null)  addPlVariationItem(itemModalForPlVariation, form)
            else if (itemModalForVariation != null)    addVariationItem(itemModalForVariation, form)
            else                                       addItem(form)
          }}
          onSaveAndNext={form => {
            if (itemModalForMarketPlVariation != null) addMarketPlVariationItemAndNext(itemModalForMarketPlVariation, form)
            else if (itemModalForPlVariation != null)  addPlVariationItemAndNext(itemModalForPlVariation, form)
            else if (itemModalForVariation != null)    addVariationItemAndNext(itemModalForVariation, form)
            else                                       addItemAndNext(form)
          }}
          onClose={() => { setItemModal(false); setItemModalForVariation(null); setItemModalForPlVariation(null); setItemModalForMarketPlVariation(null) }}
        />
      )}

      {showCopyModal && selected && (
        <CopyIngredientsModal
          recipes={recipes.filter(r => r.id !== selected.id)}
          api={api}
          targetLabel={
            variantMode === 'market-pl' && activeMarketPlVariation
              ? `Market+PL: ${activeMarketPlVariation.country_name} · ${activeMarketPlVariation.price_level_name}`
              : variantMode === 'price-level' && activePlVariation
                ? `Price Level: ${activePlVariation.price_level_name}`
                : variantMode === 'market' && activeVariation
                  ? `Market: ${activeVariation.country_name}`
                  : 'Global'
          }
          onCopy={copyItemsFromSource}
          onClose={() => setShowCopyModal(false)}
        />
      )}

      {createVariationCtx && selected && (
        <CreateVariationModal
          ctx={createVariationCtx}
          recipe={selected}
          priceLevels={priceLevels}
          onConfirm={({ copyFrom }) => {
            const ctx = createVariationCtx
            if (ctx.kind === 'market') {
              createVariation(ctx.countryId, copyFrom === 'global')
            } else if (ctx.kind === 'pl') {
              createPlVariation(ctx.priceLevelId, copyFrom === 'global')
            } else {
              createMarketPlVariation(ctx.countryId, ctx.priceLevelId, copyFrom)
            }
            setCreateVariationCtx(null)
          }}
          onClose={() => setCreateVariationCtx(null)}
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

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Recipe Form Modal ─────────────────────────────────────────────────────────

interface RecipeForm {
  name: string; category_id: string; description: string; yield_qty: string; yield_unit_text: string; image_url: string
  createSalesItem?: boolean
}

// ── Copy Ingredients Modal ────────────────────────────────────────────────
// Lets the user pick a source recipe, then a specific source variant
// (global / market / price-level / market+PL), and copies all of that variant's
// items into the *currently active* variant of the target recipe.
//
// Two-step flow: list of recipes → variant picker for the chosen recipe.
// Variants of the chosen recipe are loaded lazily via GET /recipes/:id.

interface CopyVariantRow {
  key:        string  // unique row id
  label:      string  // human readable
  itemCount:  number
  items:      RecipeItem[]
}

function CopyIngredientsModal({ recipes, api, targetLabel, onCopy, onClose }: {
  recipes: Recipe[]
  api: ReturnType<typeof useApi>
  targetLabel: string
  onCopy: (items: RecipeItem[]) => Promise<void>
  onClose: () => void
}) {
  const [search,        setSearch]        = useState('')
  const [pickedId,      setPickedId]      = useState<number | null>(null)
  const [variants,      setVariants]      = useState<CopyVariantRow[]>([])
  const [loading,       setLoading]       = useState(false)
  const [copying,       setCopying]       = useState(false)
  const [pickedVariant, setPickedVariant] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q
      ? recipes.filter(r => r.name.toLowerCase().includes(q) || (r.category_name ?? '').toLowerCase().includes(q))
      : recipes
  }, [recipes, search])

  // Load detail when a recipe is picked → enumerate variants
  useEffect(() => {
    if (pickedId == null) { setVariants([]); setPickedVariant(null); return }
    let cancelled = false
    setLoading(true)
    api.get(`/recipes/${pickedId}`)
      .then((d: RecipeDetail) => {
        if (cancelled) return
        const rows: CopyVariantRow[] = []
        rows.push({ key: 'global', label: '🌍 Global', itemCount: d.items?.length ?? 0, items: d.items ?? [] })
        for (const v of (d.variations ?? [])) {
          rows.push({ key: `m-${v.id}`, label: `🌍 ${v.country_name} (Market)`, itemCount: v.items.length, items: v.items })
        }
        for (const v of (d.pl_variations ?? [])) {
          rows.push({ key: `pl-${v.id}`, label: `💰 ${v.price_level_name} (PL)`, itemCount: v.items.length, items: v.items })
        }
        for (const v of (d.market_pl_variations ?? [])) {
          rows.push({ key: `mpl-${v.id}`, label: `🌍💰 ${v.country_name} · ${v.price_level_name}`, itemCount: v.items.length, items: v.items })
        }
        setVariants(rows)
        setPickedVariant(rows[0]?.key ?? null)
      })
      .catch(() => { if (!cancelled) setVariants([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [pickedId, api])

  const chosen = variants.find(v => v.key === pickedVariant)

  return (
    <Modal title="Copy ingredients from another recipe" onClose={onClose}>
      <div className="space-y-3">
        <div className="text-xs text-text-3">
          Will append into <span className="font-semibold text-text-2">{targetLabel}</span> on the current recipe.
        </div>

        {pickedId == null ? (
          <>
            <input
              autoFocus
              className="input w-full"
              placeholder="Search recipes…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="border border-border rounded-lg max-h-96 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="p-4 text-center text-sm text-text-3">No recipes match.</div>
              ) : (
                filtered.map(r => (
                  <button
                    key={r.id}
                    onClick={() => setPickedId(r.id)}
                    className="w-full text-left px-3 py-2 border-b border-border last:border-0 hover:bg-surface-2 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-text-1 truncate">{r.name}</div>
                      {r.category_name && <div className="text-xs text-text-3 truncate">{r.category_name}</div>}
                    </div>
                    <span className="text-xs text-text-3 shrink-0">{r.item_count} item{r.item_count !== 1 ? 's' : ''}</span>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-border">
              <div className="text-sm font-semibold text-text-1 truncate">
                {recipes.find(r => r.id === pickedId)?.name}
              </div>
              <button className="text-xs text-text-3 hover:text-accent" onClick={() => { setPickedId(null); setVariants([]); setPickedVariant(null) }}>← Pick another</button>
            </div>

            {loading ? (
              <div className="flex justify-center p-6"><Spinner /></div>
            ) : variants.length === 0 ? (
              <div className="text-sm text-text-3 italic">This recipe has no items.</div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden">
                {variants.map(v => (
                  <label
                    key={v.key}
                    className={`flex items-center justify-between gap-3 px-3 py-2 border-b border-border last:border-0 cursor-pointer transition-colors ${pickedVariant === v.key ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <input
                        type="radio"
                        name="copy-variant"
                        checked={pickedVariant === v.key}
                        onChange={() => setPickedVariant(v.key)}
                      />
                      <span className="text-sm font-medium text-text-1 truncate">{v.label}</span>
                    </div>
                    <span className="text-xs text-text-3 shrink-0">{v.itemCount} item{v.itemCount !== 1 ? 's' : ''}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button className="btn-outline px-3 py-1.5 text-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary px-3 py-1.5 text-sm flex items-center gap-1.5 disabled:opacity-50"
            disabled={!chosen || chosen.items.length === 0 || copying}
            onClick={async () => {
              if (!chosen) return
              setCopying(true)
              try { await onCopy(chosen.items) } finally { setCopying(false) }
            }}
          >
            <CopyIcon size={12} />
            {copying ? 'Copying…' : chosen ? `Copy ${chosen.itemCount} item${chosen.itemCount !== 1 ? 's' : ''}` : 'Copy'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Create Variation Modal ────────────────────────────────────────────────
// Replaces the old window.confirm + window.prompt flow. Picks the source to
// copy ingredients from (or empty start). Shows only options that make sense
// for the variant kind being created and the variations that already exist.

type CreateVariationCopyFrom = 'global' | 'market' | 'pl' | null

function CreateVariationModal({ ctx, recipe, priceLevels, onConfirm, onClose }: {
  ctx:
    | { kind: 'market';    countryId: number }
    | { kind: 'pl';        priceLevelId: number }
    | { kind: 'market-pl'; countryId: number; priceLevelId: number }
  recipe: RecipeDetail
  priceLevels: PriceLevel[]
  onConfirm: (opts: { copyFrom: CreateVariationCopyFrom }) => void
  onClose: () => void
}) {
  // Resolve labels
  const countryName = ctx.kind !== 'pl'
    ? recipe.cogs_by_country.find(c => c.country_id === ctx.countryId)?.country_name ?? 'this market'
    : null
  const levelName = ctx.kind !== 'market'
    ? priceLevels.find(l => l.id === ctx.priceLevelId)?.name ?? 'this price level'
    : null

  const scopeLabel = ctx.kind === 'market'
    ? countryName
    : ctx.kind === 'pl'
      ? levelName
      : `${countryName} · ${levelName}`

  // What can we copy from?
  const hasGlobal = (recipe.items?.length ?? 0) > 0
  const hasMarketSource = ctx.kind === 'market-pl'
    && recipe.variations?.some(v => v.country_id === ctx.countryId && v.items.length > 0)
  const hasPlSource = ctx.kind === 'market-pl'
    && recipe.pl_variations?.some(v => v.price_level_id === ctx.priceLevelId && v.items.length > 0)

  // Default selection — first available source, fall back to empty.
  const initialCopyFrom: CreateVariationCopyFrom =
    hasMarketSource ? 'market'
    : hasPlSource     ? 'pl'
    : hasGlobal       ? 'global'
    : null
  const [copyFrom, setCopyFrom] = useState<CreateVariationCopyFrom>(initialCopyFrom)

  // Count of items each option would copy (used in the labels).
  const globalCount = recipe.items?.length ?? 0
  const marketCount = ctx.kind === 'market-pl'
    ? (recipe.variations?.find(v => v.country_id === ctx.countryId)?.items.length ?? 0)
    : 0
  const plCount = ctx.kind === 'market-pl'
    ? (recipe.pl_variations?.find(v => v.price_level_id === ctx.priceLevelId)?.items.length ?? 0)
    : 0

  return (
    <Modal title={`Create variation — ${scopeLabel}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-text-2">
          Pick a starting point for this variation. The original recipe and any other
          variations are not changed.
        </p>

        <div className="border border-border rounded-lg overflow-hidden">
          {/* Market source — Market+PL only, shown first when present */}
          {ctx.kind === 'market-pl' && (
            <label className={`flex items-start gap-3 px-3 py-2 border-b border-border cursor-pointer transition-colors ${!hasMarketSource ? 'opacity-50 cursor-not-allowed' : copyFrom === 'market' ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}>
              <input
                type="radio"
                name="copy-from"
                className="mt-1"
                disabled={!hasMarketSource}
                checked={copyFrom === 'market'}
                onChange={() => setCopyFrom('market')}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-1">Copy from {countryName} market variation</div>
                <div className="text-xs text-text-3">
                  {hasMarketSource ? `${marketCount} ingredient${marketCount !== 1 ? 's' : ''} from the existing market variation.` : 'No market variation exists for this market.'}
                </div>
              </div>
            </label>
          )}

          {/* PL source — Market+PL only */}
          {ctx.kind === 'market-pl' && (
            <label className={`flex items-start gap-3 px-3 py-2 border-b border-border cursor-pointer transition-colors ${!hasPlSource ? 'opacity-50 cursor-not-allowed' : copyFrom === 'pl' ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}>
              <input
                type="radio"
                name="copy-from"
                className="mt-1"
                disabled={!hasPlSource}
                checked={copyFrom === 'pl'}
                onChange={() => setCopyFrom('pl')}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-1">Copy from {levelName} price-level variation</div>
                <div className="text-xs text-text-3">
                  {hasPlSource ? `${plCount} ingredient${plCount !== 1 ? 's' : ''} from the existing PL variation.` : 'No price-level variation exists for this level.'}
                </div>
              </div>
            </label>
          )}

          {/* Global */}
          <label className={`flex items-start gap-3 px-3 py-2 border-b border-border cursor-pointer transition-colors ${!hasGlobal ? 'opacity-50 cursor-not-allowed' : copyFrom === 'global' ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}>
            <input
              type="radio"
              name="copy-from"
              className="mt-1"
              disabled={!hasGlobal}
              checked={copyFrom === 'global'}
              onChange={() => setCopyFrom('global')}
            />
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-1">Copy from global recipe</div>
              <div className="text-xs text-text-3">
                {hasGlobal
                  ? `${globalCount} ingredient${globalCount !== 1 ? 's' : ''} from the base recipe.`
                  : 'Global recipe has no ingredients yet.'}
              </div>
            </div>
          </label>

          {/* Empty — last */}
          <label className={`flex items-start gap-3 px-3 py-2 last:border-0 cursor-pointer transition-colors ${copyFrom === null ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}>
            <input type="radio" name="copy-from" className="mt-1" checked={copyFrom === null} onChange={() => setCopyFrom(null)} />
            <div className="min-w-0">
              <div className="text-sm font-medium text-text-1">Empty variation</div>
              <div className="text-xs text-text-3">Add ingredients manually after creation.</div>
            </div>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
          <button className="btn-outline px-3 py-1.5 text-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary px-3 py-1.5 text-sm"
            onClick={() => onConfirm({ copyFrom })}
          >
            Create Variation
          </button>
        </div>
      </div>
    </Modal>
  )
}

function RecipeFormModal({ recipe, categories, onSave, onClose, onCategoryCreated, apiPost }: {
  recipe: Recipe | null
  categories: {id: number; name: string}[]
  onSave: (f: RecipeForm) => void
  onClose: () => void
  onCategoryCreated: (cat: { id: number; name: string }) => void
  apiPost: (path: string, body: unknown) => Promise<unknown>
}) {
  const [form, setForm] = useState<RecipeForm>({
    name:            recipe?.name           ?? '',
    category_id:     recipe?.category_id    ? String(recipe.category_id) : '',
    description:     recipe?.description    ?? '',
    yield_qty:       String(recipe?.yield_qty ?? 1),
    yield_unit_text: recipe?.yield_unit_abbr ?? '',
    image_url:       recipe?.image_url       ?? '',
  })

  const set = (k: keyof RecipeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  // Same as set() but accepts the raw string value — for CalcInput etc.
  const setV = (k: keyof RecipeForm) => (v: string) =>
    setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title={recipe ? 'Edit Recipe' : 'New Recipe'} onClose={onClose}>
      <div className="flex flex-col gap-4" onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onSave(form) } }}>
        <Field label="Recipe Name" required>
          <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Pad Thai" autoFocus />
        </Field>

        {!recipe && (
          <label className="flex items-center gap-2 text-sm cursor-pointer text-gray-600 -mt-1">
            <input type="checkbox" checked={form.createSalesItem ?? false}
              onChange={e => setForm(f => ({ ...f, createSalesItem: e.target.checked }))} />
            This is a Sales Item
          </label>
        )}

        {/* Category — picker with inline-create. New categories created from
            here are flagged `for_recipes=true` so they appear in this list
            immediately, plus `for_sales_items=true` if the user has the
            "Create Sales Item" toggle on (the same category will be needed
            on the resulting sales item). */}
        <Field label="Category">
          <CategoryPicker
            value={form.category_id}
            onChange={v => setForm(f => ({ ...f, category_id: v }))}
            categories={categories}
            scope="for_recipes"
            alsoSetScopes={form.createSalesItem ? ['for_sales_items'] : undefined}
            onCategoryCreated={onCategoryCreated}
            apiPost={apiPost}
            placeholder="No category…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Yield Quantity">
            <CalcInput className="input w-full font-mono" value={form.yield_qty} onChange={setV('yield_qty')} />
          </Field>
          <Field label="Yield Unit">
            <input className="input" value={form.yield_unit_text} onChange={set('yield_unit_text')}
              placeholder="portions, kg, litres…" autoComplete="off" />
          </Field>
        </div>

        <Field label="Description / Notes">
          <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Optional method notes…" />
        </Field>

        <ImageUpload
          label="Recipe Image"
          value={form.image_url || null}
          onChange={url => setForm(f => ({ ...f, image_url: url || '' }))}
          formKey="recipe"
        />

        {/* Translations — only shown for existing recipes */}
        {recipe && (
          <TranslationEditor
            entityType="recipe"
            entityId={recipe.id}
            fields={['name', 'description']}
            compact
          />
        )}

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
    (i.category_name || '').toLowerCase().includes(ingSearch.toLowerCase())
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
  // String-value variant for CalcInput.
  const setV = (k: keyof ItemForm) => (v: string) =>
    setForm(f => ({ ...f, [k]: v }))

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
                        <span className="text-xs shrink-0 opacity-70">{i.category_name || ''}{i.base_unit_abbr ? ` · ${i.base_unit_abbr}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selIngredient && (
                <p className="text-xs text-text-3 mt-1">
                  Base unit: <span className="font-mono font-semibold text-text-2">{selIngredient.base_unit_abbr || '—'}</span>
                  {selIngredient.category_name && <span className="ml-2">· {selIngredient.category_name}</span>}
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" required>
                <CalcInput className="input w-full font-mono" value={form.prep_qty} onChange={setV('prep_qty')} />
              </Field>
              <Field label="Prep Unit">
                <input className="input" value={form.prep_unit} onChange={set('prep_unit')} placeholder={baseUnit || 'e.g. g'} />
              </Field>
            </div>

            <Field label={`Prep → Base Conversion${baseUnit ? ` (into ${baseUnit})` : ''}`} required>
              <CalcInput className="input w-full font-mono" value={form.prep_to_base_conversion} onChange={setV('prep_to_base_conversion')} />
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
                        <span className="text-xs shrink-0 opacity-70">{r.category_name || ''}{r.yield_unit_abbr ? ` · ${r.yield_qty} ${r.yield_unit_abbr}` : ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {selRecipe && (
                <p className="text-xs text-text-3 mt-1">
                  Yield: <span className="font-mono">{selRecipe.yield_qty}</span>{selRecipe.yield_unit_abbr ? ` ${selRecipe.yield_unit_abbr}` : ''}
                  {selRecipe.category_name && <span className="ml-2">· {selRecipe.category_name}</span>}
                </p>
              )}
            </Field>
            <Field label="Portions used" required>
              <CalcInput className="input w-full font-mono" value={form.prep_qty} onChange={setV('prep_qty')} />
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

// Generic Alt+<key> shortcut. Skips when focus is in an input/textarea/select
// or contenteditable so typing the letter into a field doesn't fire the action.
function AltShortcut({ keyChar, onTrigger, active }: { keyChar: string; onTrigger: () => void; active: boolean }) {
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (!e.altKey) return
      if (e.key.toLowerCase() !== keyChar.toLowerCase()) return
      const t = e.target as HTMLElement | null
      const tag = t?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return
      e.preventDefault()
      onTrigger()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, keyChar, onTrigger])
  return null
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function PlusIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
}
function CopyIcon({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
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
function ImagePlaceholderIcon({ size = 22 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-text-3"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
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
