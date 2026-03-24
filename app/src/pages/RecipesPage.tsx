import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, Spinner, ConfirmDialog, Toast, Badge } from '../components/ui'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Unit       { id: number; name: string; abbreviation: string }
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

interface CogsByCountry {
  country_id:       number
  country_name:     string
  currency_code:    string
  currency_symbol:  string
  exchange_rate:    number
  total_cost_base:  number
  total_cost_local: number
  cost_per_portion: number
  coverage: 'fully_preferred' | 'fully_quoted' | 'partially_quoted' | 'not_quoted'
  has_variation:    boolean
  variation_id:     number | null
  lines:            RecipeItem[]
}

interface RecipeVariation {
  id:           number
  country_id:   number
  country_name: string
  items:        RecipeItem[]
}

interface Country {
  id:             number
  name:           string
  currency_code:  string
  currency_symbol:string
  exchange_rate:  number
}

interface RecipeDetail extends Recipe {
  items:            RecipeItem[]
  variations:       RecipeVariation[]
  cogs_by_country:  CogsByCountry[]
}

interface MenuAssignment {
  menu_id: number
  menu_name: string
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const fmt     = (n: number | string | null | undefined, dp = 3) => Number(n ?? 0).toFixed(dp)
const fmtCost = (n: number | string | null | undefined) => Number(n ?? 0).toFixed(2)

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RecipesPage() {
  const api = useApi()

  const [recipes,      setRecipes]      = useState<Recipe[]>([])
  const [ingredients,  setIngredients]  = useState<Ingredient[]>([])
  const [units,        setUnits]        = useState<Unit[]>([])
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
  const [confirmDelete,setConfirmDelete]= useState<{ type: 'recipe' | 'item' | 'variation' | 'copy-to-global'; id: number } | null>(null)
  const [itemModalForVariation, setItemModalForVariation] = useState<number | null>(null) // variation_id when adding to a variation
  const [showComparison,        setShowComparison]        = useState(false)

  const [menus,               setMenus]               = useState<SimpleMenu[]>([])
  const [menuAssignments,     setMenuAssignments]      = useState<MenuAssignment[]>([])
  const [selectedMenuId,      setSelectedMenuId]       = useState<number | null>(null)
  const [loadingMenuAssign,   setLoadingMenuAssign]    = useState(false)

  // search/filter
  const [search,     setSearch]     = useState('')
  const [filterCat,  setFilterCat]  = useState('')
  const [sortField,  setSortField]  = useState<'name'|'category'|'yield_qty'>('name')
  const [sortDir,    setSortDir]    = useState<'asc'|'desc'>('asc')

  // toast
  const [toast, setToast] = useState<{ msg: string; type?: 'error' } | null>(null)
  const showToast = (msg: string, type?: 'error') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000) }

  useEffect(() => {
    api.get('/countries').then((d: Country[]) => setCountries(d || [])).catch(() => {})
  }, [api])

  useEffect(() => {
    api.get('/menus').then((d: SimpleMenu[]) => setMenus(d || [])).catch(() => {})
  }, [api])

  // ── Load ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [r, i, u, cats] = await Promise.all([
        api.get('/recipes'),
        api.get('/ingredients'),
        api.get('/units'),
        api.get('/categories?type=recipe'),
      ])
      setRecipes(r || [])
      setIngredients(i || [])
      setUnits(u || [])
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

  // Fetch menu assignments for this recipe in the selected market
  useEffect(() => {
    if (!selected || !selectedCountryId || selectedCountryId === 'GLOBAL') {
      setMenuAssignments([])
      setSelectedMenuId(null)
      return
    }
    const countryMenus = menus.filter(m => m.country_id === selectedCountryId)
    if (!countryMenus.length) { setMenuAssignments([]); setSelectedMenuId(null); return }

    setLoadingMenuAssign(true)
    Promise.all(
      countryMenus.map(m =>
        api.get(`/cogs/menu/${m.id}?market_id=${selectedCountryId}`)
          .then((res: any) => ({ menu_id: m.id, menu_name: m.name, res }))
          .catch(() => null)
      )
    ).then(results => {
      const found: MenuAssignment[] = []
      ;(results as Array<{ menu_id: number; menu_name: string; res: any } | null>).forEach(r => {
        if (!r) return
        const item = r.res?.items?.find((it: any) => it.recipe_id === selected.id)
        if (item) {
          found.push({
            menu_id:        r.menu_id,
            menu_name:      r.menu_name,
            menu_item_id:   item.menu_item_id,
            display_name:   item.display_name,
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
  }, [selected?.id, selectedCountryId, menus, api])

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
    return selected?.cogs_by_country.find(c => c.country_id === selectedCountryId) ?? selected?.cogs_by_country[0] ?? null
  }, [selected, selectedCountryId])

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

  const activeItems = useMemo(() =>
    activeVariation ? activeVariation.items : (selected?.items ?? [])
  , [activeVariation, selected])

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
      name:         form.name.trim(),
      category:     form.category.trim() || null,
      description:  form.description.trim() || null,
      yield_qty:    Number(form.yield_qty) || 1,
      yield_unit_id:form.yield_unit_id || null,
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
        subtitle="Build recipes from your ingredient library. COGS is calculated via preferred vendor quotes per country."
        action={
          <button className="btn-primary px-4 py-2 text-sm flex items-center gap-2" onClick={() => setRecipeModal('new')}>
            <PlusIcon /> New Recipe
          </button>
        }
      />

      {/* KPI strip */}
      <div className="flex gap-4 px-6 py-3 border-b border-border bg-surface">
        <KpiCard label="Recipes"     value={recipes.length} />
        <KpiCard label="Ingredients" value={ingredients.length} />
        <KpiCard label="Categories"  value={categories.length} />
      </div>

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
                        if (v === 'GLOBAL') setSelectedCountryId('GLOBAL')
                        else setSelectedCountryId(Number(v))
                        setSelectedCurrencyCode('')
                        setShowComparison(false)
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

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-3 whitespace-nowrap">Currency</span>
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
                const activeMenu = menuAssignments.find(m => m.menu_id === selectedMenuId) ?? menuAssignments[0] ?? null
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
                          <div className="text-xs text-text-3 shrink-0">Menu Price</div>
                          {menuAssignments.length > 1 ? (
                            <select
                              value={selectedMenuId ?? ''}
                              onChange={e => setSelectedMenuId(Number(e.target.value))}
                              className="text-xs text-text-3 bg-transparent border border-border rounded px-1 py-0 max-w-[100px]"
                            >
                              {menuAssignments.map(m => (
                                <option key={m.menu_id} value={m.menu_id}>{m.menu_name}</option>
                              ))}
                            </select>
                          ) : menuAssignments.length === 1 ? (
                            <span className="text-xs text-text-3 truncate max-w-[100px]" title={menuAssignments[0].menu_name}>{menuAssignments[0].menu_name}</span>
                          ) : null}
                        </div>
                        {activeMenu ? (
                          <>
                            <div className="text-lg font-bold font-mono text-text-1">
                              {displayCurrency.symbol}{fmtCost(activeMenu.sell_price_net * displayCurrency.rate)}
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
                        ) : loadingMenuAssign ? (
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
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-sm text-text-1 shrink-0">Ingredients</span>
                    {activeCogs?.has_variation
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold shrink-0">✦ Variation</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-surface-2 text-text-3 shrink-0">Global</span>
                    }
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selectedCountryId !== '' && selectedCountryId !== 'GLOBAL' && (
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
                    <button
                      className="btn-outline px-3 py-1.5 text-xs flex items-center gap-1.5"
                      onClick={() => { setItemModalForVariation(activeVariation?.id ?? null); setItemModal(true) }}
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
                            <tr className="border-b border-border text-xs text-text-2 uppercase tracking-wide bg-surface-2/50">
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
                                    <div className={`font-medium ${removed ? 'text-amber-700' : 'text-text-1'}`}>
                                      {item.item_type === 'ingredient' ? item.ingredient_name : `↳ ${item.sub_recipe_name}`}
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
                              <th className="px-3 py-2 text-right font-semibold">Cost ({displayCurrency.code})</th>
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
                                    <div className={`font-medium ${added ? 'text-emerald-700' : 'text-text-1'}`}>
                                      {item.item_type === 'ingredient' ? item.ingredient_name : `↳ ${item.sub_recipe_name}`}
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
                        <tr className="bg-surface-2 border-b border-border text-xs text-text-2 uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-left font-semibold">Ingredient</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Qty</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Conversion</th>
                          {activeCogs && <th className="px-4 py-2.5 text-right font-semibold">Cost ({displayCurrency.code})</th>}
                          <th className="w-16" />
                        </tr>
                      </thead>
                      <tbody>
                        {activeItems.map(item => {
                          const cogLine   = activeCogs?.lines.find(l => l.id === item.id)
                          const localCost = cogLine?.cost != null ? cogLine.cost * displayCurrency.rate : null
                          return (
                            <tr key={item.id} className="border-b border-border last:border-0 hover:bg-surface-2/50 group">
                              <td className="px-4 py-2.5">
                                <div className="font-medium text-text-1">
                                  {item.item_type === 'ingredient' ? item.ingredient_name : `↳ ${item.sub_recipe_name}`}
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
              {selectedCountryId !== 'GLOBAL' && selectedCountryId !== '' && (
                <div className="bg-surface border border-border rounded-xl overflow-hidden mb-5">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <span className="font-semibold text-sm text-text-1">Menus</span>
                    <span className="text-xs text-text-3">
                      {loadingMenuAssign ? 'Loading…' : menuAssignments.length === 0 ? 'Not assigned to any menu' : `${menuAssignments.length} menu${menuAssignments.length !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                  {loadingMenuAssign ? (
                    <div className="p-4 text-center"><Spinner /></div>
                  ) : menuAssignments.length === 0 ? (
                    <div className="px-4 py-6 text-center text-text-3 text-sm">
                      This recipe hasn't been added to any {activeCogs?.country_name ?? ''} menu yet.
                    </div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-surface-2 border-b border-border text-xs text-text-2 uppercase tracking-wide">
                          <th className="px-4 py-2.5 text-left font-semibold">Menu</th>
                          <th className="px-4 py-2.5 text-left font-semibold">Display Name</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Price (gross)</th>
                          <th className="px-4 py-2.5 text-right font-semibold">Price (net)</th>
                          <th className="px-4 py-2.5 text-right font-semibold">COGS%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {menuAssignments.map(m => (
                          <tr key={m.menu_id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                            <td className="px-4 py-2.5 font-medium text-text-1">{m.menu_name}</td>
                            <td className="px-4 py-2.5 text-text-2">{m.display_name}</td>
                            <td className="px-4 py-2.5 text-right font-mono text-text-2">
                              {m.sell_price_gross > 0 ? `${displayCurrency.symbol}${fmtCost(m.sell_price_gross * displayCurrency.rate)}` : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono font-semibold text-text-1">
                              {m.sell_price_net > 0 ? `${displayCurrency.symbol}${fmtCost(m.sell_price_net * displayCurrency.rate)}` : '—'}
                            </td>
                            <td className={`px-4 py-2.5 text-right font-semibold ${recipeCogsColour(m.cogs_pct_net)}`}>
                              {m.cogs_pct_net != null ? `${m.cogs_pct_net.toFixed(1)}%` : '—'}
                            </td>
                          </tr>
                        ))}
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
                        <tr className="bg-surface-2 border-b border-border text-xs text-text-2 uppercase tracking-wide">
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
          units={units}
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
              if (activeVariation) updateVariationItem(activeVariation.id, form)
              else                 updateItem(form)
            } else {
              if (itemModalForVariation != null) addVariationItem(itemModalForVariation, form)
              else                               addItem(form)
            }
          }}
          onClose={() => { setItemModal(false); setEditItemModal(null); setItemModalForVariation(null) }}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          message={
            confirmDelete.type === 'recipe'          ? 'This will permanently delete the recipe and all its ingredients.' :
            confirmDelete.type === 'variation'       ? 'Delete this market variation? The global recipe will be used for this country going forward.' :
            confirmDelete.type === 'copy-to-global'  ? 'Replace all global ingredients with this variation\'s ingredients? The global recipe will be overwritten. All other market variations are unaffected.' :
            'Remove this ingredient from the recipe?'
          }
          onConfirm={() => {
            if (confirmDelete.type === 'recipe')             deleteRecipe(confirmDelete.id)
            else if (confirmDelete.type === 'variation')     deleteVariation(confirmDelete.id)
            else if (confirmDelete.type === 'copy-to-global') copyVariationToGlobal(confirmDelete.id)
            else {
              if (activeVariation) deleteVariationItem(activeVariation.id, confirmDelete.id)
              else                 deleteItem(confirmDelete.id)
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
  name: string; category: string; description: string; yield_qty: string; yield_unit_id: number | ''
}

function RecipeFormModal({ recipe, units, categories, onSave, onClose }: {
  recipe: Recipe | null
  units: Unit[]
  categories: string[]
  onSave: (f: RecipeForm) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<RecipeForm>({
    name:         recipe?.name          ?? '',
    category:     recipe?.category      ?? '',
    description:  '',
    yield_qty:    String(recipe?.yield_qty ?? 1),
    yield_unit_id:recipe?.yield_unit_id  ?? '',
  })
  const [catOpen, setCatOpen] = useState(false)
  const set = (k: keyof RecipeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const filteredCats = categories.filter(c => c.toLowerCase().includes(form.category.toLowerCase()))

  return (
    <Modal title={recipe ? 'Edit Recipe' : 'New Recipe'} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <Field label="Recipe Name" required>
          <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Pad Thai" autoFocus />
        </Field>

        {/* Category combo */}
        <Field label="Category">
          <div className="relative">
            <input
              className="input"
              value={form.category}
              onChange={e => { setForm(f => ({ ...f, category: e.target.value })); setCatOpen(true) }}
              onFocus={() => setCatOpen(true)}
              onBlur={() => setTimeout(() => setCatOpen(false), 150)}
              placeholder="Select or type to add…"
              autoComplete="off"
            />
            {catOpen && filteredCats.length > 0 && (
              <div className="absolute z-50 top-full left-0 right-0 bg-surface border border-border rounded-lg shadow-lg mt-0.5 max-h-40 overflow-y-auto">
                {filteredCats.map(c => (
                  <button key={c} type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 transition-colors"
                    onMouseDown={() => { setForm(f => ({ ...f, category: c })); setCatOpen(false) }}
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
            <select className="input" value={form.yield_unit_id} onChange={set('yield_unit_id') as any}>
              <option value="">— portions —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>)}
            </select>
          </Field>
        </div>

        <Field label="Description / Notes">
          <textarea className="input" rows={3} value={form.description} onChange={set('description')} placeholder="Optional method notes…" />
        </Field>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button className="btn-ghost px-4 py-2 text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => onSave(form)}>
            {recipe ? 'Save Recipe' : 'Create Recipe'}
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

function ItemFormModal({ item, ingredients, recipes, onSave, onClose }: {
  item: RecipeItem | null
  ingredients: Ingredient[]
  recipes: Recipe[]
  onSave: (f: ItemForm) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<ItemForm>({
    item_type:               item?.item_type ?? 'ingredient',
    ingredient_id:           String(item?.ingredient_id ?? ''),
    recipe_item_id:          String(item?.recipe_item_id ?? ''),
    prep_qty:                String(item?.prep_qty ?? '1'),
    prep_unit:               item?.prep_unit ?? '',
    prep_to_base_conversion: String(item?.prep_to_base_conversion ?? '1'),
  })

  // Combo search state
  const [ingSearch,     setIngSearch]     = useState(() => {
    if (item?.ingredient_id) {
      return ingredients.find(i => i.id === item.ingredient_id)?.name ?? ''
    }
    return ''
  })
  const [ingOpen,       setIngOpen]       = useState(false)
  const [recipeSearch,  setRecipeSearch]  = useState(() => {
    if (item?.recipe_item_id) {
      return recipes.find(r => r.id === item.recipe_item_id)?.name ?? ''
    }
    return ''
  })
  const [recipeOpen,    setRecipeOpen]    = useState(false)

  const filteredIngs = ingredients.filter(i =>
    i.name.toLowerCase().includes(ingSearch.toLowerCase()) ||
    (i.category || '').toLowerCase().includes(ingSearch.toLowerCase())
  )
  const filteredRecipes = recipes.filter(r =>
    r.name.toLowerCase().includes(recipeSearch.toLowerCase())
  )

  const selIngredient = ingredients.find(i => String(i.id) === form.ingredient_id)
  const selRecipe     = recipes.find(r => String(r.id) === form.recipe_item_id)

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
      <div className="flex flex-col gap-4">
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
                  className="input w-full"
                  placeholder="Search ingredients…"
                  value={ingSearch}
                  autoFocus={!item}
                  onChange={e => { setIngSearch(e.target.value); setIngOpen(true); setForm(f => ({ ...f, ingredient_id: '' })) }}
                  onFocus={() => setIngOpen(true)}
                  onBlur={() => setTimeout(() => setIngOpen(false), 150)}
                />
                {ingOpen && filteredIngs.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-modal max-h-52 overflow-y-auto">
                    {filteredIngs.map(i => (
                      <button key={i.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex items-center justify-between gap-2"
                        onMouseDown={() => {
                          setForm(f => ({ ...f, ingredient_id: String(i.id) }))
                          setIngSearch(i.name)
                          setIngOpen(false)
                        }}
                      >
                        <span className="font-semibold text-text-1">{i.name}</span>
                        <span className="text-xs text-text-3 shrink-0">{i.category || ''}{i.base_unit_abbr ? ` · ${i.base_unit_abbr}` : ''}</span>
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
                  onChange={e => { setRecipeSearch(e.target.value); setRecipeOpen(true); setForm(f => ({ ...f, recipe_item_id: '' })) }}
                  onFocus={() => setRecipeOpen(true)}
                  onBlur={() => setTimeout(() => setRecipeOpen(false), 150)}
                />
                {recipeOpen && filteredRecipes.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-modal max-h-52 overflow-y-auto">
                    {filteredRecipes.map(r => (
                      <button key={r.id} type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex items-center justify-between gap-2"
                        onMouseDown={() => {
                          setForm(f => ({ ...f, recipe_item_id: String(r.id) }))
                          setRecipeSearch(r.name)
                          setRecipeOpen(false)
                        }}
                      >
                        <span className="font-semibold text-text-1">{r.name}</span>
                        <span className="text-xs text-text-3 shrink-0">{r.category || ''}{r.yield_unit_abbr ? ` · ${r.yield_qty} ${r.yield_unit_abbr}` : ''}</span>
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
          <button className="btn-primary px-4 py-2 text-sm" onClick={() => onSave(form)}>
            {item ? 'Save Changes' : 'Add to Recipe'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Small components ──────────────────────────────────────────────────────────

function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-2.5 min-w-[100px]">
      <div className="text-xs text-text-3 font-medium">{label}</div>
      <div className="text-xl font-extrabold text-text-1 mt-0.5">{value}</div>
    </div>
  )
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
