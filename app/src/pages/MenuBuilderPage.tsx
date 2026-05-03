// =============================================================================
// Menu Builder — unified all-in-one menu setup page (BACK-2516 epic)
// =============================================================================
// One screen does everything: pick a menu, see its items, add items inline
// either by searching the existing sales-item catalog OR by creating a new
// one (recipe / ingredient / manual / combo) without leaving the page.
//
// This page deliberately overlaps with the existing Menus page (which keeps
// the Menu Engineer / Shared Links / pricing-grid features). Menu Builder is
// the *editing* surface; Menus is the *analysis* surface.
//
// Story 1 (BACK-2517): shell — menu picker, items list, "+ Add item" side
//   panel with search-existing + create-new tabs + type radio. Branches
//   (recipe-pick, manual capture, combo builder, modifier groups) plug into
//   this shell in stories 2–7.
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Spinner, EmptyState, Field, Toast, PepperHelpButton, CalcInput, CategoryPicker } from '../components/ui'
import ImageUpload from '../components/ImageUpload'

// ── Types ───────────────────────────────────────────────────────────────────

interface Menu {
  id: number
  name: string
  country_id: number
  country_name: string
  currency_code?: string | null
  currency_symbol?: string | null
  description: string | null
}

interface MenuSalesItem {
  id: number                     // menu_sales_item_id
  menu_id: number
  sales_item_id: number
  qty: number
  sort_order: number
  sales_item_name: string
  item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
  si_image_url: string | null
  category: string | null
  prices?: MenuItemPrice[]       // story 6 — already in the GET response
  has_price_override?: boolean
  modifier_group_count?: number  // BACK-2573 — surfaced via the GET join
}

// BACK-2573 / BACK-2574 — sub-prices payload from
// GET /menu-sales-items/:id/sub-prices. Both modifier groups (for non-combo
// items) and combo step structure are returned in one shot.
interface SubPricesResp {
  item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
  modifier_groups: SubModifierGroup[]
  combo_steps: SubComboStep[]
}

interface SubModifierGroup {
  modifier_group_id: number
  name: string
  min_select: number
  max_select: number
  options: SubOption[]
}

interface SubComboStep {
  id: number
  name: string
  min_select: number
  max_select: number
  options: SubComboOption[]
}

interface SubOption {
  id: number              // modifier_option_id
  name: string
  display_name: string | null
  item_type: 'recipe' | 'ingredient' | 'manual'
  price_addon: number
  prices: Record<string, number>  // { [price_level_id]: sell_price }
}

interface SubComboOption {
  id: number              // combo_step_option_id
  name: string
  display_name: string | null
  item_type: 'recipe' | 'ingredient' | 'manual'
  price_addon: number
  prices: Record<string, number>
  modifier_groups: SubModifierGroup[]
}

interface MenuItemPrice {
  id: number
  menu_sales_item_id: number
  price_level_id: number
  price_level_name: string
  sell_price: number
  default_price: number | null   // from mcogs_sales_item_prices
  is_overridden: boolean
  tax_rate_id: number | null
}

// BACK-2569 — country-scoped price-level row used to filter the inline price
// columns. Returned by GET /api/country-price-levels/:countryId. is_enabled
// false means the level is configured but turned off for that country and
// should NOT appear as a column.
interface CountryPriceLevel {
  price_level_id: number
  price_level_name: string
  is_enabled: boolean
}

// TaxRate interface removed in BACK-2569 — inline price cells are tax-rate-
// agnostic for now (sales-item-level tax_rate_id stays untouched on save).

interface ModifierGroup {
  id: number
  name: string
  display_name: string | null
  min_select: number
  max_select: number
  allow_repeat_selection: boolean
  default_auto_show: boolean
  option_count?: number
}

interface AttachedModifierGroup {
  modifier_group_id: number
  sort_order: number
  auto_show: boolean
  name: string
  description: string | null
  min_select: number
  max_select: number
}

// Story 4 — combo builder definition shape passed up to createComboAndAttach
interface ComboDef {
  name: string
  category_id: number | null
  description: string | null
  image_url: string | null
  steps: Array<{
    name: string
    min_select: number
    max_select: number
    allow_repeat: boolean
    auto_select: boolean
    options: Array<{
      name: string
      item_type: 'recipe' | 'ingredient' | 'manual'
      recipe_id: number | null
      ingredient_id: number | null
      manual_cost: number | null
      price_addon: number
      qty: number
    }>
  }>
}

interface SalesItemRow {
  id: number
  name: string
  display_name: string | null
  item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
  category_id: number | null
  category_name?: string | null
  image_url: string | null
  // Used by Story 2 to detect when a recipe/ingredient already has a wrapping
  // sales item — instead of creating a duplicate, the picker offers to reuse.
  recipe_id: number | null
  ingredient_id: number | null
}

// Story 2 — recipe + ingredient catalog rows for the create-new picker.
interface RecipeRow {
  id: number
  name: string
  category_name: string | null
  yield_qty: number
  yield_unit_abbr: string | null
  item_count: number
}

interface IngredientRow {
  id: number
  name: string
  category_name: string | null
  base_unit_abbr: string | null
  image_url: string | null
  // BACK-2548 — when fetched with ?country_id=X, the API attaches market-
  // specific cost data so we can show cost in the picker + offer "+ Add quote"
  // when none exists for the current market.
  has_market_quote?: boolean
  market_cost_per_base_unit?: number | null
  market_purchase_unit?: string | null
  market_purchase_price?: number | null
  market_qty_in_base_units?: number | null
  market_vendor_name?: string | null
  market_quote_is_preferred?: boolean
}

interface VendorRow {
  id: number
  name: string
  country_id: number
  country_name?: string | null
  currency_code?: string | null
  currency_symbol?: string | null
}

interface CategoryRow {
  id: number
  name: string
  for_sales_items?: boolean
}

// BACK-2599 — full sales item from GET /api/sales-items/:id. Used by the
// right-panel Details section so the operator can edit every field without
// leaving Menu Builder.
interface FullSalesItem {
  id: number
  item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
  name: string
  display_name: string | null
  category_id: number | null
  category_name?: string | null
  description: string | null
  recipe_id: number | null
  recipe_name?: string | null
  ingredient_id: number | null
  ingredient_name?: string | null
  combo_id: number | null
  combo_name?: string | null
  manual_cost: number | null
  image_url: string | null
  sort_order: number
  qty: number
  modifier_groups?: AttachedModifierGroup[]
}

type SalesItemType = 'recipe' | 'ingredient' | 'manual' | 'combo'

// Side-panel mode: search existing catalog vs. create-new walker
type AddMode = 'search' | 'create'

// ── Helpers ─────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<SalesItemType, string> = {
  recipe:     'Recipe',
  ingredient: 'Ingredient',
  manual:     'Manual',
  combo:      'Combo',
}

const TYPE_DESCRIPTIONS: Record<SalesItemType, string> = {
  recipe:     'Link to an existing recipe. Cost flows from preferred-vendor quotes.',
  ingredient: 'Link to a single ingredient. Cost flows from its active price quote.',
  manual:     'Fixed cost typed by hand. Use for items with no recipe or ingredient link.',
  combo:      'Bundle of steps, each with one or more options. Cost is the sum / average of step costs.',
}

const TYPE_BADGE: Record<SalesItemType, { label: string; cls: string }> = {
  recipe:     { label: 'R',  cls: 'bg-emerald-100 text-emerald-700' },
  ingredient: { label: 'I',  cls: 'bg-sky-100      text-sky-700' },
  manual:     { label: 'M',  cls: 'bg-amber-100    text-amber-700' },
  combo:      { label: 'C',  cls: 'bg-violet-100   text-violet-700' },
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function MenuBuilderPage() {
  const api = useApi()

  const [menus,        setMenus]        = useState<Menu[]>([])
  const [selectedMenu, setSelectedMenu] = useState<Menu | null>(null)
  const [items,        setItems]        = useState<MenuSalesItem[]>([])
  const [loading,      setLoading]      = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [toast,        setToast]        = useState<{ message: string; type?: 'success' | 'error' } | null>(null)

  // Add-item side panel
  const [panelOpen,    setPanelOpen]    = useState(false)
  const [addMode,      setAddMode]      = useState<AddMode>('search')

  // Right-side editor target. BACK-2587 — panel becomes context-aware:
  //   • sales-item    → modifier-groups list for the active SI (default mode)
  //   • modifier-group → single group editor with options CRUD (BACK-2585)
  //   • combo-step    → single combo step editor with options CRUD
  // Setting null closes the panel entirely.
  type EditTarget =
    | { kind: 'sales-item';     msi: MenuSalesItem }
    | { kind: 'modifier-group'; msi: MenuSalesItem; modifierGroupId: number }
    | { kind: 'combo-step';     msi: MenuSalesItem; comboStepId:     number }
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  // Convenience accessor — most read-sites only need the parent MSI.
  const editingMsi = editTarget?.msi ?? null
  // BACK-2569 — price levels enabled in the selected menu's country. Drives
  // the inline price columns on the items list. Filtered to is_enabled=true.
  const [enabledPriceLevels, setEnabledPriceLevels] = useState<CountryPriceLevel[]>([])
  // BACK-2571 — group items by category toggle. Persisted to localStorage so
  // each user's preference sticks across sessions.
  const [groupByCategory, setGroupByCategory] = useState<boolean>(() => {
    try { return window.localStorage.getItem('menu-builder-group-by-category') === '1' } catch { return false }
  })
  useEffect(() => {
    try { window.localStorage.setItem('menu-builder-group-by-category', groupByCategory ? '1' : '0') } catch { /* ignore */ }
  }, [groupByCategory])
  // BACK-2572 — drag-drop reorder state.
  const [dragId,    setDragId]    = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  // BACK-2573/2574 — per-row expansion of modifiers / combo structure.
  // expanded keyed by msi.id; subPrices cached by msi.id once fetched.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  const [subPricesById, setSubPricesById] = useState<Record<number, SubPricesResp>>({})
  const [subPricesLoading, setSubPricesLoading] = useState<Set<number>>(new Set())
  // BACK-2598 — inner expansion within an expanded item. Keys:
  //   • `${msiId}:mg:${modifier_group_id}`     — modifier group
  //   • `${msiId}:cs:${combo_step_id}`         — combo step
  //   • `${msiId}:csmg:${cso_id}:${mg_id}`     — modifier group on a combo step option
  // Default: not in the set → collapsed. Persists across reloads so the
  // operator does not have to re-collapse every time.
  const [expandedInnerKeys, setExpandedInnerKeys] = useState<Set<string>>(() => {
    try {
      const raw = window.localStorage.getItem('menu-builder-expanded-inner-keys')
      return new Set(raw ? JSON.parse(raw) : [])
    } catch { return new Set() }
  })
  useEffect(() => {
    try { window.localStorage.setItem('menu-builder-expanded-inner-keys', JSON.stringify([...expandedInnerKeys])) } catch { /* ignore */ }
  }, [expandedInnerKeys])
  const toggleInnerKey = useCallback((key: string) => {
    setExpandedInnerKeys(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }, [])
  // Per-cell saving for nested option price edits.
  const [savingOptionCells, setSavingOptionCells] = useState<Set<string>>(new Set())
  // Per-cell saving state — keyed by `${msi_id}:${price_level_id}` so each
  // price cell shows its own spinner without blocking the others.
  const [savingPriceCells, setSavingPriceCells] = useState<Set<string>>(new Set())

  // Story 7 — shared panel width (px). Persisted across reloads so the user
  // gets their preferred width back. Clamped 320–720.
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const stored = window.localStorage.getItem('menu-builder-panel-width')
      const n = stored ? Number(stored) : NaN
      if (Number.isFinite(n) && n >= 320 && n <= 720) return n
    } catch { /* ignore */ }
    return 416  // 26rem default
  })
  useEffect(() => {
    try { window.localStorage.setItem('menu-builder-panel-width', String(panelWidth)) } catch { /* ignore */ }
  }, [panelWidth])

  // Story 7 — Esc closes any open panel.
  useEffect(() => {
    if (!panelOpen && !editTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (panelOpen) setPanelOpen(false)
        if (editTarget) setEditTarget(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, editTarget])

  // Confirm-reuse modal — story 2 duplicate detection. When the user picks a
  // recipe/ingredient that already has a wrapping sales item in the catalog,
  // we ask whether to reuse the existing SI or create a new one.
  const [reuseConfirm, setReuseConfirm] = useState<{
    existing: SalesItemRow
    onReuse: () => void
    onCreateNew: () => void
  } | null>(null)

  // Persist last-selected menu across reloads so the page reopens where the
  // user left off.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('menu-builder-selected-menu')
      if (stored) {
        const id = Number(stored)
        if (Number.isFinite(id)) {
          // Hold the id for restoration after menus arrive.
          ;(window as unknown as { __mbRestoreId?: number }).__mbRestoreId = id
        }
      }
    } catch { /* ignore */ }
  }, [])

  // Load menus on mount
  useEffect(() => {
    setLoading(true)
    api.get('/menus')
      .then((data: Menu[]) => {
        setMenus(data || [])
        const restoreId = (window as unknown as { __mbRestoreId?: number }).__mbRestoreId
        const initial = (restoreId && data?.find(m => m.id === restoreId)) || data?.[0] || null
        setSelectedMenu(initial)
      })
      .catch(() => setToast({ message: 'Failed to load menus', type: 'error' }))
      .finally(() => setLoading(false))
  }, [api])

  // Persist selected menu
  useEffect(() => {
    if (selectedMenu) {
      try { window.localStorage.setItem('menu-builder-selected-menu', String(selectedMenu.id)) } catch { /* ignore */ }
    }
  }, [selectedMenu])

  // Load items whenever the selected menu changes
  const loadItems = useCallback(async (menuId: number) => {
    setItemsLoading(true)
    try {
      const data = await api.get(`/menu-sales-items?menu_id=${menuId}`) as MenuSalesItem[]
      setItems(data || [])
    } catch {
      setToast({ message: 'Failed to load menu items', type: 'error' })
    } finally {
      setItemsLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (selectedMenu) loadItems(selectedMenu.id)
    else setItems([])
  }, [selectedMenu, loadItems])

  // BACK-2569 — load the price levels enabled for this menu's country so the
  // inline price columns only show columns the operator can actually use.
  useEffect(() => {
    if (!selectedMenu) { setEnabledPriceLevels([]); return }
    api.get(`/country-price-levels/${selectedMenu.country_id}`)
      .then((d: CountryPriceLevel[]) => setEnabledPriceLevels((d || []).filter(l => l.is_enabled)))
      .catch(() => setEnabledPriceLevels([]))
  }, [api, selectedMenu])

  // BACK-2573 / BACK-2574 — toggle expansion + lazy-load /sub-prices.
  // Cached once fetched so collapsing-then-expanding is instant. Reload on
  // demand happens after a nested price save so the override marker updates.
  const loadSubPrices = useCallback(async (msiId: number) => {
    setSubPricesLoading(prev => { const n = new Set(prev); n.add(msiId); return n })
    try {
      const data = await api.get(`/menu-sales-items/${msiId}/sub-prices`) as SubPricesResp
      setSubPricesById(prev => ({ ...prev, [msiId]: data }))
    } catch {
      // empty state will render
    } finally {
      setSubPricesLoading(prev => { const n = new Set(prev); n.delete(msiId); return n })
    }
  }, [api])

  const toggleExpand = useCallback((msiId: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(msiId)) {
        next.delete(msiId)
      } else {
        next.add(msiId)
        // Lazy-fetch on first expand
        if (!subPricesById[msiId]) loadSubPrices(msiId)
      }
      return next
    })
  }, [subPricesById, loadSubPrices])

  // Save a per-menu override on a nested option price (modifier OR combo step).
  // Uses the appropriate PUT depending on `kind`. Optimistic patch on the
  // cached SubPricesResp; reload from server on failure to recover state.
  const saveOptionPrice = useCallback(async (
    kind: 'modifier' | 'combo',
    msiId: number,
    optionId: number,
    priceLevelId: number,
    newSell: number,
  ) => {
    const cellKey = `${kind}:${msiId}:${optionId}:${priceLevelId}`
    setSavingOptionCells(prev => { const n = new Set(prev); n.add(cellKey); return n })

    // Optimistic patch into the cached SubPricesResp
    setSubPricesById(prev => {
      const sp = prev[msiId]; if (!sp) return prev
      const patchOption = (o: SubOption | SubComboOption): SubOption | SubComboOption => ({
        ...o,
        prices: { ...o.prices, [String(priceLevelId)]: newSell },
      })
      const patchedModGroups = (groups: SubModifierGroup[]): SubModifierGroup[] =>
        groups.map(g => ({ ...g, options: g.options.map(o => o.id === optionId && kind === 'modifier' ? patchOption(o) as SubOption : o) }))
      const next: SubPricesResp = {
        ...sp,
        modifier_groups: patchedModGroups(sp.modifier_groups),
        combo_steps: sp.combo_steps.map(step => ({
          ...step,
          options: step.options.map(opt => {
            if (opt.id === optionId && kind === 'combo') return patchOption(opt) as SubComboOption
            return { ...opt, modifier_groups: patchedModGroups(opt.modifier_groups) }
          }),
        })),
      }
      return { ...prev, [msiId]: next }
    })

    try {
      const url = kind === 'modifier'
        ? `/menu-sales-items/${msiId}/modifier-option-price`
        : `/menu-sales-items/${msiId}/combo-option-price`
      const body = kind === 'modifier'
        ? { modifier_option_id: optionId, price_level_id: priceLevelId, sell_price: newSell }
        : { combo_step_option_id: optionId, price_level_id: priceLevelId, sell_price: newSell }
      await api.put(url, body)
    } catch (err: unknown) {
      // Rollback by re-fetching from server
      loadSubPrices(msiId)
      const msg = (err as { message?: string })?.message || 'Failed to save price'
      setToast({ message: msg, type: 'error' })
    } finally {
      setSavingOptionCells(prev => { const n = new Set(prev); n.delete(cellKey); return n })
    }
  }, [api, loadSubPrices])

  // BACK-2572 — drag-drop reorder. Persist via POST /menu-sales-items/reorder
  // (transactional sort_order update). Optimistic local reorder + reload on
  // failure. Disabled while group-by-category is on (sort within category is
  // a separate follow-up).
  const reorderItems = useCallback(async (sourceId: number, targetId: number) => {
    if (!selectedMenu || sourceId === targetId) return
    const before = items
    const reordered = (() => {
      const arr = [...items]
      const fromIdx = arr.findIndex(i => i.id === sourceId)
      const toIdx   = arr.findIndex(i => i.id === targetId)
      if (fromIdx < 0 || toIdx < 0) return arr
      const [moved] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, moved)
      return arr.map((it, idx) => ({ ...it, sort_order: idx }))
    })()
    setItems(reordered)
    try {
      await api.post('/menu-sales-items/reorder', {
        menu_id: selectedMenu.id,
        order:   reordered.map(i => i.id),
      })
    } catch (err: unknown) {
      setItems(before)
      const msg = (err as { message?: string })?.message || 'Failed to save new order'
      setToast({ message: msg, type: 'error' })
    }
  }, [api, selectedMenu, items])

  // Save a single price cell. Optimistic patch on items[]; rolls back on
  // failure. Used by the inline editor in the items list.
  const savePriceCell = useCallback(async (msi: MenuSalesItem, priceLevel: CountryPriceLevel, newSell: number) => {
    if (!selectedMenu) return
    const cellKey = `${msi.id}:${priceLevel.price_level_id}`
    setSavingPriceCells(prev => { const next = new Set(prev); next.add(cellKey); return next })

    // Optimistic patch
    const previous = items
    setItems(prev => prev.map(it => {
      if (it.id !== msi.id) return it
      const existing = (it.prices || []).find(p => p.price_level_id === priceLevel.price_level_id)
      const updatedPrices = existing
        ? (it.prices || []).map(p => p.price_level_id === priceLevel.price_level_id ? { ...p, sell_price: newSell, is_overridden: p.default_price !== null && newSell !== p.default_price } : p)
        : [...(it.prices || []), {
            id: 0,
            menu_sales_item_id: msi.id,
            price_level_id: priceLevel.price_level_id,
            price_level_name: priceLevel.price_level_name,
            sell_price: newSell,
            default_price: null,
            is_overridden: true,
            tax_rate_id: null,
          } as MenuItemPrice]
      return { ...it, prices: updatedPrices, has_price_override: updatedPrices.some(p => p.is_overridden) }
    }))
    try {
      await api.put(`/menu-sales-items/${msi.id}/prices`, {
        price_level_id: priceLevel.price_level_id,
        sell_price:     newSell,
        tax_rate_id:    null,
      })
    } catch (err: unknown) {
      setItems(previous)
      const msg = (err as { message?: string })?.message || 'Failed to save price'
      setToast({ message: msg, type: 'error' })
    } finally {
      setSavingPriceCells(prev => { const next = new Set(prev); next.delete(cellKey); return next })
    }
  }, [api, selectedMenu, items])


  // Attach an existing sales item to the current menu
  const attachExisting = useCallback(async (si: SalesItemRow) => {
    if (!selectedMenu) return
    try {
      const nextSort = items.length ? Math.max(...items.map(i => i.sort_order)) + 1 : 0
      await api.post('/menu-sales-items', {
        menu_id:       selectedMenu.id,
        sales_item_id: si.id,
        sort_order:    nextSort,
      })
      setToast({ message: `Added “${si.display_name || si.name}” to ${selectedMenu.name}`, type: 'success' })
      loadItems(selectedMenu.id)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to attach item'
      setToast({ message: msg, type: 'error' })
    }
  }, [api, selectedMenu, items, loadItems])

  // Story 2: create a sales item that wraps the picked recipe / ingredient,
  // then attach it to the menu. Single user action, two server calls. If the
  // sales-item create succeeds but the menu link fails, we surface a clear
  // error and leave the SI in the catalog (the user can retry the attach
  // from the search-existing tab on the next try).
  const createAndAttach = useCallback(async (payload: {
    item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
    name: string
    display_name?: string | null
    category_id?: number | null
    recipe_id?: number | null
    ingredient_id?: number | null
    manual_cost?: number | null
    image_url?: string | null
    description?: string | null
  }): Promise<SalesItemRow | null> => {
    if (!selectedMenu) return null
    try {
      const newSi = await api.post('/sales-items', payload) as SalesItemRow
      const nextSort = items.length ? Math.max(...items.map(i => i.sort_order)) + 1 : 0
      try {
        await api.post('/menu-sales-items', {
          menu_id:       selectedMenu.id,
          sales_item_id: newSi.id,
          sort_order:    nextSort,
        })
        setToast({ message: `Created and added “${newSi.display_name || newSi.name}”`, type: 'success' })
        loadItems(selectedMenu.id)
        return newSi
      } catch (linkErr: unknown) {
        const msg = (linkErr as { message?: string })?.message || 'Sales item created but failed to attach to menu'
        setToast({ message: msg, type: 'error' })
        return newSi
      }
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to create sales item'
      setToast({ message: msg, type: 'error' })
      return null
    }
  }, [api, selectedMenu, items, loadItems])

  // Story 4 — Combo builder save sequence. Creates the combo shell, the
  // wrapping sales item, the menu link, and every step + option in order.
  // Not transactional across the API boundary; if a step / option POST fails
  // partway, we surface the error and leave the partial combo in place so
  // the user can retry from the catalog (or delete the half-built combo
  // from the Sales Items page).
  const createComboAndAttach = useCallback(async (def: {
    name: string
    category_id: number | null
    description: string | null
    image_url: string | null
    steps: Array<{
      name: string
      min_select: number
      max_select: number
      allow_repeat: boolean
      auto_select: boolean
      options: Array<{
        name: string
        item_type: 'recipe' | 'ingredient' | 'manual'
        recipe_id: number | null
        ingredient_id: number | null
        manual_cost: number | null
        price_addon: number
        qty: number
      }>
    }>
  }): Promise<boolean> => {
    if (!selectedMenu) return false
    try {
      // 1) Create the combo shell
      const combo = await api.post('/combos', {
        name:        def.name,
        description: def.description,
        category_id: def.category_id,
        image_url:   def.image_url,
      }) as { id: number; name: string }

      // 2) Create the wrapping sales item pointing at the new combo
      const newSi = await api.post('/sales-items', {
        item_type:    'combo',
        name:         def.name,
        category_id:  def.category_id,
        description:  def.description,
        image_url:    def.image_url,
        combo_id:     combo.id,
      }) as SalesItemRow

      // 3) Attach to the active menu
      const nextSort = items.length ? Math.max(...items.map(i => i.sort_order)) + 1 : 0
      await api.post('/menu-sales-items', {
        menu_id:       selectedMenu.id,
        sales_item_id: newSi.id,
        sort_order:    nextSort,
      })

      // 4) Steps + options in order
      for (let stepIdx = 0; stepIdx < def.steps.length; stepIdx++) {
        const s = def.steps[stepIdx]
        const step = await api.post(`/combos/${combo.id}/steps`, {
          name:         s.name,
          min_select:   s.min_select,
          max_select:   s.max_select,
          allow_repeat: s.allow_repeat,
          auto_select:  s.auto_select,
          sort_order:   stepIdx,
        }) as { id: number }

        for (let optIdx = 0; optIdx < s.options.length; optIdx++) {
          const o = s.options[optIdx]
          await api.post(`/combos/${combo.id}/steps/${step.id}/options`, {
            name:          o.name,
            item_type:     o.item_type,
            recipe_id:     o.recipe_id,
            ingredient_id: o.ingredient_id,
            manual_cost:   o.manual_cost,
            price_addon:   o.price_addon,
            qty:           o.qty,
            sort_order:    optIdx,
          })
        }
      }

      setToast({ message: `Combo “${def.name}” created with ${def.steps.length} step${def.steps.length === 1 ? '' : 's'}`, type: 'success' })
      loadItems(selectedMenu.id)
      return true
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to create combo'
      setToast({ message: `${msg} — partial combo may have been saved; check Sales Items.`, type: 'error' })
      return false
    }
  }, [api, selectedMenu, items, loadItems])

  // Remove an item from the menu (does NOT delete the sales item itself)
  const removeItem = useCallback(async (msi: MenuSalesItem) => {
    if (!selectedMenu) return
    try {
      await api.delete(`/menu-sales-items/${msi.id}`)
      setToast({ message: `Removed “${msi.sales_item_name}”`, type: 'success' })
      setItems(prev => prev.filter(i => i.id !== msi.id))
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to remove item'
      setToast({ message: msg, type: 'error' })
    }
  }, [api, selectedMenu])

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Menu Builder"
        subtitle="Build menus end-to-end: search or create sales items inline, build combos, attach modifiers, set prices — all on one screen."
        action={<PepperHelpButton prompt="How do I use the Menu Builder page?" />}
      />

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Spinner /></div>
      ) : menus.length === 0 ? (
        <EmptyState
          message="You have no menus yet. Create one on the Menus page first."
          action={<a href="/menus" className="btn-primary">Open Menus</a>}
        />
      ) : (
        <div className="flex-1 flex overflow-hidden">

          {/* ── Top toolbar: menu picker + actions ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface flex-wrap">
              <Field label="Menu">
                <select
                  className="input min-w-[16rem]"
                  value={selectedMenu?.id ?? ''}
                  onChange={e => {
                    const m = menus.find(x => x.id === Number(e.target.value)) || null
                    setSelectedMenu(m)
                  }}
                >
                  {menus.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.name} — {m.country_name}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="flex-1" />
              {/* BACK-2571 — group-by-category toggle */}
              <label className="flex items-center gap-1.5 text-xs text-text-2 cursor-pointer select-none mr-2">
                <input
                  type="checkbox"
                  checked={groupByCategory}
                  onChange={(e) => setGroupByCategory(e.target.checked)}
                />
                Group by category
              </label>
              <button
                className="btn-primary"
                onClick={() => { setEditTarget(null); setAddMode('search'); setPanelOpen(true) }}
                disabled={!selectedMenu}
              >+ Add Sales Item to Menu</button>
            </div>

            {/* ── Items list ── */}
            <div className="flex-1 overflow-y-auto bg-surface-2/40">
              {!selectedMenu ? (
                <div className="p-8 text-center text-text-3 text-sm">Pick a menu above.</div>
              ) : itemsLoading ? (
                <div className="flex justify-center p-12"><Spinner /></div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center text-text-3 text-sm">
                  No items on this menu yet. Click <strong>+ Add Sales Item to Menu</strong> to start.
                </div>
              ) : (
                <ItemsList
                  items={items}
                  enabledPriceLevels={enabledPriceLevels}
                  selectedMsiId={editingMsi?.id}
                  groupByCategory={groupByCategory}
                  savingPriceCells={savingPriceCells}
                  dragId={dragId}
                  dragOverId={dragOverId}
                  expandedRows={expandedRows}
                  subPricesById={subPricesById}
                  subPricesLoading={subPricesLoading}
                  savingOptionCells={savingOptionCells}
                  expandedInnerKeys={expandedInnerKeys}
                  onToggleInnerKey={toggleInnerKey}
                  onPriceSave={(it, lvl, v) => savePriceCell(it, lvl, v)}
                  onOpenModifiers={(it) => { setPanelOpen(false); setEditTarget({ kind: 'sales-item', msi: it }) }}
                  onOpenModifierGroup={(it, mgid) => { setPanelOpen(false); setEditTarget({ kind: 'modifier-group', msi: it, modifierGroupId: mgid }) }}
                  onOpenComboStep={(it, sid) => { setPanelOpen(false); setEditTarget({ kind: 'combo-step', msi: it, comboStepId: sid }) }}
                  onRemove={(it) => removeItem(it)}
                  onToggleExpand={toggleExpand}
                  onSaveOptionPrice={saveOptionPrice}
                  onDragStart={(id) => setDragId(id)}
                  onDragOver={(e, id) => { e.preventDefault(); setDragOverId(id) }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={() => {
                    if (dragId !== null && dragOverId !== null && dragId !== dragOverId) {
                      reorderItems(dragId, dragOverId)
                    }
                    setDragId(null); setDragOverId(null)
                  }}
                  onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                />
              )}
            </div>
          </div>

          {/* ── Add-item side panel ── */}
          {panelOpen && selectedMenu && (
            <AddItemPanel
              menu={selectedMenu}
              currentItemIds={items.map(i => i.sales_item_id)}
              addMode={addMode}
              setAddMode={setAddMode}
              width={panelWidth}
              onResize={setPanelWidth}
              onAttach={async (si) => {
                await attachExisting(si)
                setPanelOpen(false)
              }}
              onCreateAndAttach={async (payload) => {
                const result = await createAndAttach(payload)
                if (result) setPanelOpen(false)
              }}
              onCreateComboAndAttach={async (def) => {
                const ok = await createComboAndAttach(def)
                if (ok) setPanelOpen(false)
              }}
              onAskReuse={(existing, onReuse, onCreateNew) =>
                setReuseConfirm({ existing, onReuse, onCreateNew })
              }
              onClose={() => setPanelOpen(false)}
            />
          )}

          {/* ── Right-side editor — context-aware (BACK-2587) ── */}
          {editTarget && selectedMenu && !panelOpen && editTarget.kind === 'sales-item' && (
            <EditItemPanel
              key={`si-${editTarget.msi.id}`}
              menu={selectedMenu}
              msi={editTarget.msi}
              width={panelWidth}
              onResize={setPanelWidth}
              onChanged={() => { loadItems(selectedMenu.id); if (subPricesById[editTarget.msi.id]) loadSubPrices(editTarget.msi.id) }}
              onOpenGroupEditor={(mgid) => setEditTarget({ kind: 'modifier-group', msi: editTarget.msi, modifierGroupId: mgid })}
              onClose={() => setEditTarget(null)}
              onToast={(t) => setToast(t)}
            />
          )}
          {editTarget && selectedMenu && !panelOpen && editTarget.kind === 'modifier-group' && (
            <ModifierGroupEditorPanel
              key={`mg-${editTarget.modifierGroupId}`}
              menu={selectedMenu}
              msi={editTarget.msi}
              modifierGroupId={editTarget.modifierGroupId}
              width={panelWidth}
              onResize={setPanelWidth}
              onBack={() => setEditTarget({ kind: 'sales-item', msi: editTarget.msi })}
              onClose={() => setEditTarget(null)}
              onChanged={() => { loadItems(selectedMenu.id); loadSubPrices(editTarget.msi.id) }}
              onToast={(t) => setToast(t)}
            />
          )}
          {editTarget && selectedMenu && !panelOpen && editTarget.kind === 'combo-step' && (
            <ComboStepEditorPanel
              key={`cs-${editTarget.comboStepId}`}
              menu={selectedMenu}
              msi={editTarget.msi}
              comboStepId={editTarget.comboStepId}
              width={panelWidth}
              onResize={setPanelWidth}
              onBack={() => setEditTarget({ kind: 'sales-item', msi: editTarget.msi })}
              onClose={() => setEditTarget(null)}
              onChanged={() => { loadItems(selectedMenu.id); loadSubPrices(editTarget.msi.id) }}
              onToast={(t) => setToast(t)}
            />
          )}
        </div>
      )}

      {/* Story 2: duplicate-detection confirm dialog */}
      {reuseConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setReuseConfirm(null)} />
          <div className="relative bg-surface rounded-xl shadow-modal w-full max-w-md p-5">
            <div className="font-semibold text-text-1 mb-1">A sales item already wraps this</div>
            <p className="text-sm text-text-2 mb-4">
              <strong>“{reuseConfirm.existing.display_name || reuseConfirm.existing.name}”</strong> already exists in the catalog and points at the same {reuseConfirm.existing.recipe_id ? 'recipe' : 'ingredient'}. Reusing it keeps the catalog tidy.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setReuseConfirm(null)}>Cancel</button>
              <button
                className="btn-outline"
                onClick={() => { reuseConfirm.onCreateNew(); setReuseConfirm(null) }}
              >Make a new one</button>
              <button
                className="btn-primary"
                onClick={() => { reuseConfirm.onReuse(); setReuseConfirm(null) }}
              >Reuse existing</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

// ── Items list (BACK-2569 / 2571 / 2572) ───────────────────────────────────
// Pulls flat-vs-grouped rendering, drag-drop sort, and the inline price
// columns into one component. Drag-drop is disabled while group-by-category
// is on (in-group reorder is a follow-up).

function ItemsList({
  items, enabledPriceLevels, selectedMsiId, groupByCategory, savingPriceCells,
  dragId, dragOverId,
  expandedRows, subPricesById, subPricesLoading, savingOptionCells,
  expandedInnerKeys, onToggleInnerKey,
  onPriceSave, onOpenModifiers, onOpenModifierGroup, onOpenComboStep, onRemove, onToggleExpand, onSaveOptionPrice,
  onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
}: {
  items: MenuSalesItem[]
  enabledPriceLevels: CountryPriceLevel[]
  selectedMsiId?: number
  groupByCategory: boolean
  savingPriceCells: Set<string>
  dragId: number | null
  dragOverId: number | null
  expandedRows: Set<number>
  subPricesById: Record<number, SubPricesResp>
  subPricesLoading: Set<number>
  savingOptionCells: Set<string>
  expandedInnerKeys: Set<string>
  onToggleInnerKey: (key: string) => void
  onPriceSave: (it: MenuSalesItem, lvl: CountryPriceLevel, v: number) => void | Promise<void>
  onOpenModifiers: (it: MenuSalesItem) => void
  onOpenModifierGroup: (it: MenuSalesItem, modifierGroupId: number) => void
  onOpenComboStep: (it: MenuSalesItem, comboStepId: number) => void
  onRemove: (it: MenuSalesItem) => void
  onToggleExpand: (msiId: number) => void
  onSaveOptionPrice: (kind: 'modifier' | 'combo', msiId: number, optionId: number, priceLevelId: number, newSell: number) => void | Promise<void>
  onDragStart: (id: number) => void
  onDragOver: (e: React.DragEvent, id: number) => void
  onDragLeave: () => void
  onDrop: () => void
  onDragEnd: () => void
}) {
  const draggable = !groupByCategory  // disabled in grouped mode

  // BACK-2571 — bucket items by category. Uncategorised pinned to the top.
  const groups = useMemo(() => {
    const buckets = new Map<string, MenuSalesItem[]>()
    for (const it of items) {
      const key = (it.category || '').trim() || 'Uncategorised'
      if (!buckets.has(key)) buckets.set(key, [])
      buckets.get(key)!.push(it)
    }
    return Array.from(buckets.entries())
      .sort(([a], [b]) => {
        if (a === 'Uncategorised') return -1
        if (b === 'Uncategorised') return 1
        return a.localeCompare(b, undefined, { sensitivity: 'base' })
      })
  }, [items])

  const renderRow = (it: MenuSalesItem) => {
    const selected = selectedMsiId === it.id
    const isDragging  = dragId === it.id
    const isDropOver  = dragOverId === it.id && dragId !== it.id
    const expandable  = it.item_type === 'combo' || (it.modifier_group_count ?? 0) > 0
    const isExpanded  = expandedRows.has(it.id)
    const sub         = subPricesById[it.id]
    const loadingSub  = subPricesLoading.has(it.id)
    return (
      <li key={it.id}>
        <div
          draggable={draggable}
          onDragStart={draggable ? () => onDragStart(it.id) : undefined}
          onDragOver={draggable ? (e) => onDragOver(e, it.id) : undefined}
          onDragLeave={draggable ? onDragLeave : undefined}
          onDrop={draggable ? onDrop : undefined}
          onDragEnd={draggable ? onDragEnd : undefined}
          className={`flex items-center gap-3 px-4 py-3 transition-colors ${
            selected     ? 'bg-accent-dim/50 border-l-2 border-accent' :
            isDropOver   ? 'bg-accent-dim/30 border-t-2 border-accent' :
                           'hover:bg-surface-2/60 border-l-2 border-transparent'
          } ${isDragging ? 'opacity-40' : ''} ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
        >
          {/* Expand caret — only for items with modifiers OR combos */}
          {expandable ? (
            <button
              type="button"
              className="shrink-0 w-4 h-4 flex items-center justify-center text-text-3 hover:text-text-1 text-xs"
              onClick={(e) => { e.stopPropagation(); onToggleExpand(it.id) }}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >{isExpanded ? '▼' : '▶'}</button>
          ) : (
            <span className="shrink-0 w-4" />
          )}

          <span
            className={`shrink-0 w-6 h-6 rounded text-[11px] font-bold flex items-center justify-center ${TYPE_BADGE[it.item_type].cls}`}
            title={TYPE_LABELS[it.item_type]}
          >{TYPE_BADGE[it.item_type].label}</span>

          {it.si_image_url ? (
            <img src={it.si_image_url} alt="" className="shrink-0 w-10 h-10 rounded object-cover border border-border" />
          ) : (
            <div className="shrink-0 w-10 h-10 rounded bg-surface-2 border border-border" />
          )}

          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-text-1 truncate">{it.sales_item_name}</div>
            <div className="text-xs text-text-3 truncate">
              {it.category || 'Uncategorised'} · {TYPE_LABELS[it.item_type]}
              {it.qty !== 1 ? ` · qty ${it.qty}` : ''}
              {(it.modifier_group_count ?? 0) > 0 && <> · {it.modifier_group_count} mod{it.modifier_group_count === 1 ? '' : 's'}</>}
            </div>
          </div>

          {enabledPriceLevels.map(lvl => {
            const price = (it.prices || []).find(p => p.price_level_id === lvl.price_level_id)
            const cellKey = `${it.id}:${lvl.price_level_id}`
            return (
              <PriceCell
                key={lvl.price_level_id}
                value={price?.sell_price ?? 0}
                isOverride={price?.is_overridden ?? false}
                defaultPrice={price?.default_price ?? null}
                saving={savingPriceCells.has(cellKey)}
                onSave={(v) => onPriceSave(it, lvl, v)}
              />
            )
          })}

          <button
            className={`shrink-0 w-20 text-xs px-2 py-1 rounded transition-colors text-right ${selected ? 'bg-accent text-white' : 'text-accent hover:bg-accent-dim/40'}`}
            onClick={(e) => { e.stopPropagation(); onOpenModifiers(it) }}
            title="Open modifiers"
          >Modifiers ›</button>

          <button
            className="shrink-0 w-14 text-text-3 hover:text-red-600 text-xs text-right"
            onClick={(e) => { e.stopPropagation(); onRemove(it) }}
            title="Remove from menu (does not delete the sales item)"
          >Remove</button>
        </div>

        {/* BACK-2573 / BACK-2574 — nested expanded section */}
        {expandable && isExpanded && (
          <div className="bg-surface-2/30 border-t border-border">
            {loadingSub && !sub ? (
              <div className="px-12 py-3 text-xs text-text-3 italic">Loading…</div>
            ) : sub ? (
              <ExpandedItemContent
                msiId={it.id}
                sub={sub}
                enabledPriceLevels={enabledPriceLevels}
                savingOptionCells={savingOptionCells}
                expandedInnerKeys={expandedInnerKeys}
                onToggleInnerKey={onToggleInnerKey}
                onSaveOptionPrice={onSaveOptionPrice}
                onOpenModifierGroup={(mgid) => onOpenModifierGroup(it, mgid)}
                onOpenComboStep={(sid) => onOpenComboStep(it, sid)}
              />
            ) : (
              <div className="px-12 py-3 text-xs text-text-3 italic">Failed to load sub-prices.</div>
            )}
          </div>
        )}
      </li>
    )
  }

  return (
    <div className="bg-surface">
      {enabledPriceLevels.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border bg-surface-2/40 text-[10px] uppercase tracking-wide text-text-3 font-semibold">
          <span className="shrink-0 w-4" />
          <span className="shrink-0 w-6" />
          <span className="shrink-0 w-10" />
          <span className="flex-1 min-w-0">Item</span>
          {enabledPriceLevels.map(lvl => (
            <span key={lvl.price_level_id} className="shrink-0 w-24 text-right">{lvl.price_level_name}</span>
          ))}
          <span className="shrink-0 w-20 text-right">Modifiers</span>
          <span className="shrink-0 w-14 text-right" />
        </div>
      )}

      {groupByCategory ? (
        groups.map(([category, rows]) => (
          <div key={category}>
            <div className="px-4 py-1.5 bg-surface-2/70 border-b border-border text-[10px] uppercase tracking-wide font-semibold text-text-2 sticky top-0 z-[1]">
              {category} <span className="ml-1 font-mono text-text-3">({rows.length})</span>
            </div>
            <ul className="divide-y divide-border">
              {rows.map(renderRow)}
            </ul>
          </div>
        ))
      ) : (
        <ul className="divide-y divide-border">
          {items.map(renderRow)}
        </ul>
      )}
    </div>
  )
}

// ── Expanded item content (BACK-2573 / BACK-2574) ──────────────────────────
// Renders the nested structure under an expanded row:
//   • Modifier groups → options (per-level price cells)            [BACK-2573]
//   • Combo steps → step options (per-level prices) → step-option
//     modifier groups → modifier options (per-level prices)        [BACK-2574]
// Each option-level price cell saves via the appropriate per-menu override
// endpoint. Indented to make the hierarchy visually obvious.

function ExpandedItemContent({
  msiId, sub, enabledPriceLevels, savingOptionCells, expandedInnerKeys, onToggleInnerKey, onSaveOptionPrice,
  onOpenModifierGroup, onOpenComboStep,
}: {
  msiId: number
  sub: SubPricesResp
  enabledPriceLevels: CountryPriceLevel[]
  savingOptionCells: Set<string>
  expandedInnerKeys: Set<string>
  onToggleInnerKey: (key: string) => void
  onSaveOptionPrice: (kind: 'modifier' | 'combo', msiId: number, optionId: number, priceLevelId: number, newSell: number) => void | Promise<void>
  onOpenModifierGroup: (modifierGroupId: number) => void
  onOpenComboStep: (comboStepId: number) => void
}) {
  // Stable nested renderers — small helpers to keep the JSX tree readable.
  // BACK-2598 — modifier groups + combo steps are collapsed by default; the
  // user toggles each individually via the caret on the header.
  const renderModGroup = (g: SubModifierGroup, indentPx: number, parentKey?: string) => {
    // parentKey distinguishes a top-level mod group (`mg:N`) from one nested
    // under a combo step option (`csmg:OPT_ID:MG_ID`) so the collapse state
    // is independent.
    const innerKey = parentKey ? `${msiId}:${parentKey}:${g.modifier_group_id}` : `${msiId}:mg:${g.modifier_group_id}`
    const open = expandedInnerKeys.has(innerKey)
    return (
      <NestedGroup
        key={g.modifier_group_id}
        title={g.name}
        subtitle={`Pick ${g.min_select === g.max_select ? g.min_select : `${g.min_select}–${g.max_select}`} · ${g.options.length} option${g.options.length === 1 ? '' : 's'}`}
        indentPx={indentPx}
        collapsed={!open}
        onToggleCollapse={() => onToggleInnerKey(innerKey)}
        onEdit={() => onOpenModifierGroup(g.modifier_group_id)}
      >
        {open && g.options.map(o => (
          <NestedOption
            key={o.id}
            title={o.display_name || o.name}
            subtitle={`+${o.price_addon.toFixed(2)} addon`}
            indentPx={indentPx + 16}
          >
            {enabledPriceLevels.map(lvl => {
              const overrideKey = String(lvl.price_level_id)
              const override = o.prices[overrideKey]
              const value = override != null ? override : o.price_addon
              const isOverride = override != null
              const cellKey = `modifier:${msiId}:${o.id}:${lvl.price_level_id}`
              return (
                <PriceCell
                  key={lvl.price_level_id}
                  value={value}
                  isOverride={isOverride}
                  defaultPrice={o.price_addon}
                  saving={savingOptionCells.has(cellKey)}
                  onSave={(v) => onSaveOptionPrice('modifier', msiId, o.id, lvl.price_level_id, v)}
                />
              )
            })}
          </NestedOption>
        ))}
      </NestedGroup>
    )
  }

  return (
    <div className="py-2">
      {/* Combo structure (BACK-2574) — only rendered for combo items */}
      {sub.item_type === 'combo' && sub.combo_steps.length > 0 && (
        <div>
          {sub.combo_steps.map((step, idx) => {
            // BACK-2598 — combo steps default collapsed.
            const stepKey = `${msiId}:cs:${step.id}`
            const stepOpen = expandedInnerKeys.has(stepKey)
            return (
              <div key={step.id} className="border-b border-border/40 last:border-b-0 py-1">
                <div className="flex items-center" style={{ paddingLeft: 16 }}>
                  <button
                    type="button"
                    className="shrink-0 w-5 h-5 flex items-center justify-center text-text-3 hover:text-text-1 text-[10px]"
                    onClick={() => onToggleInnerKey(stepKey)}
                    title={stepOpen ? 'Collapse step' : 'Expand step'}
                  >{stepOpen ? '▼' : '▶'}</button>
                  <button
                    type="button"
                    className="flex-1 flex items-center gap-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-2 hover:bg-accent-dim/30 transition-colors text-left"
                    onClick={() => onToggleInnerKey(stepKey)}
                    title={stepOpen ? 'Collapse step' : 'Expand step'}
                  >
                    <span className="text-text-3">Step {idx + 1}</span>
                    <span className="text-accent">{step.name}</span>
                    <span className="text-text-3 font-mono normal-case tracking-normal">· Pick {step.min_select === step.max_select ? step.min_select : `${step.min_select}–${step.max_select}`} · {step.options.length} option{step.options.length === 1 ? '' : 's'}</span>
                  </button>
                  <button
                    type="button"
                    className="shrink-0 text-accent text-[10px] hover:underline px-2"
                    onClick={(e) => { e.stopPropagation(); onOpenComboStep(step.id) }}
                    title="Edit step (settings + options)"
                  >Edit ›</button>
                </div>
                {stepOpen && step.options.map(o => (
                  <div key={o.id}>
                    <NestedOption
                      title={o.display_name || o.name}
                      subtitle={`Combo option · +${o.price_addon.toFixed(2)} addon`}
                      indentPx={48}
                    >
                      {enabledPriceLevels.map(lvl => {
                        const overrideKey = String(lvl.price_level_id)
                        const override = o.prices[overrideKey]
                        const value = override != null ? override : o.price_addon
                        const isOverride = override != null
                        const cellKey = `combo:${msiId}:${o.id}:${lvl.price_level_id}`
                        return (
                          <PriceCell
                            key={lvl.price_level_id}
                            value={value}
                            isOverride={isOverride}
                            defaultPrice={o.price_addon}
                            saving={savingOptionCells.has(cellKey)}
                            onSave={(v) => onSaveOptionPrice('combo', msiId, o.id, lvl.price_level_id, v)}
                          />
                        )
                      })}
                    </NestedOption>
                    {/* Per-step-option modifier groups (BACK-2574) — collapsed by default */}
                    {o.modifier_groups.length > 0 && (
                      <div>
                        {o.modifier_groups.map(g => renderModGroup(g, 64, `csmg:${o.id}`))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {/* Modifier groups for non-combo items (BACK-2573) */}
      {sub.modifier_groups.length > 0 && (
        <div>
          {sub.modifier_groups.map(g => renderModGroup(g, 16))}
        </div>
      )}

      {sub.modifier_groups.length === 0 && sub.combo_steps.length === 0 && (
        <div className="px-12 py-2 text-xs text-text-3 italic">Nothing nested under this item.</div>
      )}
    </div>
  )
}

// Section header for a modifier group inside the expanded view. The caret on
// the left toggles collapse (BACK-2598); the Edit › pill on the right routes
// to the group editor in the side panel (BACK-2587).
function NestedGroup({
  title, subtitle, indentPx, collapsed, onToggleCollapse, onEdit, children,
}: {
  title: string
  subtitle?: string
  indentPx: number
  collapsed?: boolean
  onToggleCollapse?: () => void
  onEdit?: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
        {onToggleCollapse ? (
          <button
            type="button"
            className="shrink-0 w-5 h-5 flex items-center justify-center text-text-3 hover:text-text-1 text-[10px]"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expand' : 'Collapse'}
          >{collapsed ? '▶' : '▼'}</button>
        ) : (
          <span className="shrink-0 w-5" />
        )}
        <button
          type="button"
          className="flex-1 flex items-center gap-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-text-2 hover:bg-accent-dim/30 transition-colors text-left"
          onClick={onToggleCollapse}
          disabled={!onToggleCollapse}
        >
          <span>{title}</span>
          {subtitle && <span className="text-text-3 font-normal normal-case tracking-normal">· {subtitle}</span>}
        </button>
        {onEdit && (
          <button
            type="button"
            className="shrink-0 text-accent text-[10px] hover:underline px-2"
            onClick={(e) => { e.stopPropagation(); onEdit() }}
            title="Edit group (settings + options)"
          >Edit ›</button>
        )}
      </div>
      {children}
    </div>
  )
}

// Single nested option row — keeps the column alignment matching the parent
// list (item info on the left, price-level cells on the right).
function NestedOption({
  title, subtitle, indentPx, children,
}: {
  title: string
  subtitle?: string
  indentPx: number
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-1.5" style={{ paddingLeft: indentPx, paddingRight: 16 }}>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-text-1 truncate">{title}</div>
        {subtitle && <div className="text-[10px] text-text-3 truncate">{subtitle}</div>}
      </div>
      {children}
      <span className="shrink-0 w-20" />
      <span className="shrink-0 w-14" />
    </div>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────

// Inline price cell for the items list (BACK-2569). Each cell is a small
// editable input that saves on blur when the value has changed. Shows an
// amber tint when the per-menu override differs from the catalog default,
// and a saving spinner while the PUT is in flight.
function PriceCell({
  value, isOverride, defaultPrice, saving, onSave,
}: {
  value: number
  isOverride: boolean
  defaultPrice: number | null
  saving: boolean
  onSave: (v: number) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<string>(String(value ?? 0))
  // Re-sync local draft when the upstream value changes (e.g. after a save
  // bumps is_overridden or after a parent reload).
  useEffect(() => { setDraft(String(value ?? 0)) }, [value])

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === '') return
    const n = Number(trimmed)
    if (!Number.isFinite(n)) { setDraft(String(value ?? 0)); return }
    if (Math.abs(n - Number(value)) < 0.0005) return // no-op: within rounding
    onSave(n)
  }

  return (
    <div className="shrink-0 w-24 relative">
      <input
        type="text"
        inputMode="decimal"
        className={`input w-full text-right text-sm font-mono px-2 py-1 ${isOverride ? 'border-amber-300 bg-amber-50/40' : ''}`}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        title={defaultPrice != null ? `Default: ${defaultPrice}${isOverride ? ' (overridden)' : ''}` : (isOverride ? 'Per-menu override' : '')}
      />
      {saving && (
        <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-accent" title="Saving…">●</span>
      )}
    </div>
  )
}

// Drag handle on the LEFT edge of a right-side panel. Left-side mouse drag
// changes width inversely (drag left → wider). Clamped 320–720.
function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  return (
    <div
      className="absolute left-0 top-0 bottom-0 w-1 hover:w-1.5 bg-transparent hover:bg-accent/40 cursor-col-resize z-10 transition-all"
      onMouseDown={(e) => {
        e.preventDefault()
        const startX = e.clientX
        const startW = width
        const onMove = (ev: MouseEvent) => {
          const next = Math.max(320, Math.min(720, startW - (ev.clientX - startX)))
          onResize(next)
        }
        const onUp = () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
      }}
      title="Drag to resize"
    />
  )
}

// ── Add-item side panel ─────────────────────────────────────────────────────

function AddItemPanel({
  menu, currentItemIds, addMode, setAddMode, width, onResize, onAttach, onCreateAndAttach, onCreateComboAndAttach, onAskReuse, onClose,
}: {
  menu: Menu
  currentItemIds: number[]
  addMode: AddMode
  setAddMode: (m: AddMode) => void
  width: number
  onResize: (w: number) => void
  onAttach: (si: SalesItemRow) => void | Promise<void>
  onCreateAndAttach: (payload: {
    item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
    name: string
    display_name?: string | null
    category_id?: number | null
    recipe_id?: number | null
    ingredient_id?: number | null
    manual_cost?: number | null
    image_url?: string | null
    description?: string | null
  }) => void | Promise<void>
  onCreateComboAndAttach: (def: ComboDef) => void | Promise<void>
  onAskReuse: (existing: SalesItemRow, onReuse: () => void, onCreateNew: () => void) => void
  onClose: () => void
}) {
  const api = useApi()
  const [catalog, setCatalog] = useState<SalesItemRow[]>([])
  const [searchText, setSearchText] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(false)
  // Categories scoped to sales_items — used by both the manual capture form
  // (Story 3) and any future create-new branch that needs a category dropdown.
  const [categories, setCategories] = useState<CategoryRow[]>([])

  // Sales-item catalog: lazy-load on first open of either tab. Both tabs need
  // it (search-existing for picking, create-new for duplicate detection on
  // the recipe / ingredient picker).
  useEffect(() => {
    if (catalog.length) return
    setCatalogLoading(true)
    api.get('/sales-items?include_prices=false')
      .then((d: SalesItemRow[]) => setCatalog(d || []))
      .catch(() => { /* surfaced via empty state */ })
      .finally(() => setCatalogLoading(false))
  }, [api, catalog.length])

  // Categories: load once on panel open. Filter to sales-item-scoped categories
  // for the picker; CategoryPicker can still create new ones with for_sales_items.
  useEffect(() => {
    api.get('/categories?for_sales_items=true')
      .then((d: CategoryRow[]) => setCategories(d || []))
      .catch(() => { /* non-fatal */ })
  }, [api])

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    const list = catalog.filter(c => !currentItemIds.includes(c.id))
    if (!q) return list.slice(0, 50)
    return list
      .filter(c => (c.name + ' ' + (c.display_name || '') + ' ' + (c.category_name || '')).toLowerCase().includes(q))
      .slice(0, 50)
  }, [catalog, searchText, currentItemIds])

  return (
    <aside
      className="shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      <ResizeHandle width={width} onResize={onResize} />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-text-3 font-semibold">{menu.name} <span className="text-text-3/60">›</span> Add Sales Item</div>
          <div className="font-semibold text-sm text-text-1">{addMode === 'search' ? 'Search existing' : 'Create new'}</div>
        </div>
        <button onClick={onClose} className="text-text-3 hover:text-text-1 text-sm px-2" title="Close (Esc)">✕</button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${addMode === 'search' ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-1'}`}
          onClick={() => setAddMode('search')}
        >Search existing</button>
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${addMode === 'create' ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-1'}`}
          onClick={() => setAddMode('create')}
        >Create new</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {addMode === 'search' ? (
          <SearchExistingTab
            search={searchText}
            setSearch={setSearchText}
            results={filtered}
            loading={catalogLoading}
            onPick={onAttach}
            catalogTotal={catalog.length}
            alreadyOnMenuCount={catalog.filter(c => currentItemIds.includes(c.id)).length}
          />
        ) : (
          <CreateNewTab
            menu={menu}
            catalog={catalog}
            categories={categories}
            onCategoryCreated={(c) => setCategories(prev => [...prev, c])}
            onAttachExisting={onAttach}
            onCreateAndAttach={onCreateAndAttach}
            onCreateComboAndAttach={onCreateComboAndAttach}
            onAskReuse={onAskReuse}
            onCancel={onClose}
          />
        )}
      </div>
    </aside>
  )
}

// ── Tab: search existing catalog ────────────────────────────────────────────

function SearchExistingTab({
  search, setSearch, results, loading, onPick, catalogTotal, alreadyOnMenuCount,
}: {
  search: string
  setSearch: (s: string) => void
  results: SalesItemRow[]
  loading: boolean
  onPick: (si: SalesItemRow) => void | Promise<void>
  catalogTotal: number
  alreadyOnMenuCount: number
}) {
  // Distinguish three empty states (BACK-2546):
  //   1. no catalog at all                  → suggest Create new
  //   2. catalog exists but every item already on the menu  → say so explicitly
  //   3. search yielded nothing             → No matches
  const allOnMenu = !loading && !search && catalogTotal > 0 && results.length === 0 && alreadyOnMenuCount === catalogTotal
  return (
    <div className="space-y-3">
      <input
        className="input w-full"
        autoFocus
        placeholder="Search the sales-item catalog…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : results.length === 0 ? (
        <div className="text-xs text-text-3 italic py-6 text-center px-3">
          {search
            ? 'No matches.'
            : allOnMenu
              ? <>Every sales item in the catalog is already on this menu. Switch to <strong>Create new</strong> to add a fresh one.</>
              : <>No sales items in the catalog yet — switch to <strong>Create new</strong>.</>}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {results.map(si => (
            <li
              key={si.id}
              className="flex items-center gap-2 px-2.5 py-2 hover:bg-surface-2/70 cursor-pointer"
              onClick={() => onPick(si)}
            >
              <span
                className={`shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${TYPE_BADGE[si.item_type].cls}`}
                title={TYPE_LABELS[si.item_type]}
              >{TYPE_BADGE[si.item_type].label}</span>
              {si.image_url ? (
                <img src={si.image_url} alt="" className="shrink-0 w-7 h-7 rounded object-cover border border-border" />
              ) : (
                <div className="shrink-0 w-7 h-7 rounded bg-surface-2 border border-border" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-1 truncate">{si.display_name || si.name}</div>
                <div className="text-[11px] text-text-3 truncate">
                  {si.category_name || 'Uncategorised'} · {TYPE_LABELS[si.item_type]}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-text-3 italic">
        Picking an item attaches it to the menu using its default prices. You can override prices per menu in story 6.
      </p>
    </div>
  )
}

// ── Tab: create new ────────────────────────────────────────────────────────
// Type radio + branch-specific picker. Story 2 ships the recipe + ingredient
// branches via RecipeOrIngredientPicker; manual + combo still show roadmap
// stubs awaiting BACK-2519 / BACK-2520.

function CreateNewTab({
  menu, catalog, categories, onCategoryCreated, onAttachExisting, onCreateAndAttach, onCreateComboAndAttach, onAskReuse, onCancel,
}: {
  menu: Menu
  catalog: SalesItemRow[]
  categories: CategoryRow[]
  onCategoryCreated: (c: CategoryRow) => void
  onAttachExisting: (si: SalesItemRow) => void | Promise<void>
  onCreateAndAttach: (payload: {
    item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
    name: string
    display_name?: string | null
    category_id?: number | null
    recipe_id?: number | null
    ingredient_id?: number | null
    manual_cost?: number | null
    image_url?: string | null
    description?: string | null
  }) => void | Promise<void>
  onCreateComboAndAttach: (def: ComboDef) => void | Promise<void>
  onAskReuse: (existing: SalesItemRow, onReuse: () => void, onCreateNew: () => void) => void
  onCancel: () => void
}) {
  const [type, setType] = useState<SalesItemType>('recipe')
  const TYPES: SalesItemType[] = ['recipe', 'ingredient', 'manual', 'combo']

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-text-2 mb-2">Linked to</div>
        <div className="grid grid-cols-2 gap-2">
          {TYPES.map(t => (
            <label
              key={t}
              className={`flex items-start gap-2 cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                type === t
                  ? 'border-accent bg-accent-dim/40'
                  : 'border-border hover:border-accent/40 bg-surface-2/30'
              }`}
            >
              <input
                type="radio"
                name="si-type"
                className="mt-0.5"
                checked={type === t}
                onChange={() => setType(t)}
              />
              <span className="flex-1 min-w-0">
                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold`}>
                  <span className={`w-4 h-4 rounded text-[10px] font-bold flex items-center justify-center ${TYPE_BADGE[t].cls}`}>{TYPE_BADGE[t].label}</span>
                  {TYPE_LABELS[t]}
                </span>
                <span className="block text-[10px] text-text-3 mt-1 leading-snug">{TYPE_DESCRIPTIONS[t]}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Branch by type */}
      {(type === 'recipe' || type === 'ingredient') && (
        <RecipeOrIngredientPicker
          mode={type}
          menu={menu}
          catalog={catalog}
          onAttachExisting={onAttachExisting}
          onCreateAndAttach={onCreateAndAttach}
          onAskReuse={onAskReuse}
        />
      )}

      {type === 'manual' && (
        <ManualItemForm
          categories={categories}
          onCategoryCreated={onCategoryCreated}
          onCreateAndAttach={onCreateAndAttach}
        />
      )}

      {type === 'combo' && (
        <ComboBuilderForm
          categories={categories}
          onCategoryCreated={onCategoryCreated}
          onSave={onCreateComboAndAttach}
        />
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// ── Recipe / ingredient picker (Story 2 / BACK-2518) ───────────────────────
// Search-only picker. Click a row → if a sales item already wraps the picked
// recipe/ingredient, prompt to reuse; else create a new sales item that wraps
// it and immediately attach to the menu.

function RecipeOrIngredientPicker({
  mode, menu, catalog, onAttachExisting, onCreateAndAttach, onAskReuse,
}: {
  mode: 'recipe' | 'ingredient'
  menu: Menu
  catalog: SalesItemRow[]
  onAttachExisting: (si: SalesItemRow) => void | Promise<void>
  onCreateAndAttach: (payload: {
    item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
    name: string
    display_name?: string | null
    category_id?: number | null
    recipe_id?: number | null
    ingredient_id?: number | null
  }) => void | Promise<void>
  onAskReuse: (existing: SalesItemRow, onReuse: () => void, onCreateNew: () => void) => void
}) {
  const api = useApi()
  const [recipes,     setRecipes]     = useState<RecipeRow[] | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [search,  setSearch]  = useState('')
  // BACK-2548 — track which ingredient row has the inline add-quote form open
  const [addQuoteFor, setAddQuoteFor] = useState<IngredientRow | null>(null)

  const reloadIngredients = useCallback(() => {
    setLoading(true)
    return api.get(`/ingredients?country_id=${menu.country_id}`)
      .then((d: IngredientRow[]) => setIngredients(d || []))
      .catch(() => setIngredients([]))
      .finally(() => setLoading(false))
  }, [api, menu.country_id])

  // Lazy-load whichever catalog matches the active mode. Cached locally so
  // flipping between recipe ↔ ingredient doesn't refetch. The ingredient
  // call is scoped to the menu's country so each row carries cost data.
  useEffect(() => {
    if (mode === 'recipe' && recipes === null) {
      setLoading(true)
      api.get('/recipes')
        .then((d: RecipeRow[]) => setRecipes(d || []))
        .catch(() => setRecipes([]))
        .finally(() => setLoading(false))
    } else if (mode === 'ingredient' && ingredients === null) {
      reloadIngredients()
    }
  }, [api, mode, recipes, ingredients, reloadIngredients])

  // Active source list + filter
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (mode === 'recipe') {
      const list = recipes || []
      if (!q) return list.slice(0, 50)
      return list.filter(r => (r.name + ' ' + (r.category_name || '')).toLowerCase().includes(q)).slice(0, 50)
    } else {
      const list = ingredients || []
      if (!q) return list.slice(0, 50)
      return list.filter(i => (i.name + ' ' + (i.category_name || '')).toLowerCase().includes(q)).slice(0, 50)
    }
  }, [mode, recipes, ingredients, search])

  // Click a row → duplicate-detect against the existing sales-item catalog,
  // then either reuse or create-and-attach.
  const handlePick = useCallback((row: RecipeRow | IngredientRow) => {
    const existing = catalog.find(si =>
      (mode === 'recipe'      && si.item_type === 'recipe'     && si.recipe_id     === row.id) ||
      (mode === 'ingredient'  && si.item_type === 'ingredient' && si.ingredient_id === row.id)
    )
    const createNew = () => {
      onCreateAndAttach({
        item_type: mode,
        name: row.name,
        display_name: null,
        category_id: null,
        recipe_id:     mode === 'recipe'     ? row.id : null,
        ingredient_id: mode === 'ingredient' ? row.id : null,
      })
    }
    if (existing) {
      onAskReuse(existing, () => onAttachExisting(existing), createNew)
    } else {
      createNew()
    }
  }, [mode, catalog, onAttachExisting, onCreateAndAttach, onAskReuse])

  return (
    <div className="space-y-3">
      <input
        className="input w-full"
        autoFocus
        placeholder={mode === 'recipe' ? 'Search recipes…' : 'Search ingredients…'}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-text-3 italic py-6 text-center">
          {search ? 'No matches.' : (mode === 'recipe' ? 'No recipes yet — build one in the Recipes module.' : 'No ingredients yet — add one in Inventory.')}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {filtered.map(row => {
            const exists = catalog.some(si =>
              (mode === 'recipe'      && si.recipe_id     === row.id) ||
              (mode === 'ingredient'  && si.ingredient_id === row.id)
            )
            // BACK-2548 — for ingredient mode, surface market cost / "no quote" badges.
            const ingRow = mode === 'ingredient' ? (row as IngredientRow) : null
            const cost = ingRow?.market_cost_per_base_unit
            const hasQuote = !!ingRow?.has_market_quote
            const symbol = menu.currency_symbol || menu.currency_code || ''
            return (
              <li key={row.id} className="border-b border-border last:border-b-0">
                <div
                  className="flex items-center gap-2 px-2.5 py-2 hover:bg-surface-2/70 cursor-pointer"
                  onClick={() => handlePick(row)}
                >
                  {mode === 'ingredient' && 'image_url' in row && row.image_url ? (
                    <img src={row.image_url} alt="" className="shrink-0 w-7 h-7 rounded object-cover border border-border" />
                  ) : (
                    <div className="shrink-0 w-7 h-7 rounded bg-surface-2 border border-border" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-1 truncate">{row.name}</div>
                    <div className="text-[11px] text-text-3 truncate">
                      {row.category_name || 'Uncategorised'}
                      {mode === 'recipe' && 'yield_qty' in row && (
                        <> · yield {row.yield_qty}{row.yield_unit_abbr ? ' ' + row.yield_unit_abbr : ''}</>
                      )}
                      {mode === 'ingredient' && ingRow?.base_unit_abbr && (
                        <> · {ingRow.base_unit_abbr}</>
                      )}
                      {mode === 'ingredient' && hasQuote && cost != null && (
                        <> · <span className="text-accent font-semibold">{symbol}{Number(cost).toFixed(4)}</span>/{ingRow!.base_unit_abbr || 'unit'}{ingRow!.market_quote_is_preferred ? ' ★' : ''}</>
                      )}
                    </div>
                  </div>
                  {mode === 'ingredient' && !hasQuote && (
                    <button
                      className="shrink-0 text-[10px] font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 px-1.5 py-0.5 rounded"
                      onClick={(e) => { e.stopPropagation(); setAddQuoteFor(addQuoteFor?.id === row.id ? null : (row as IngredientRow)) }}
                      title="No active quote in this market — click to add one"
                    >+ Add quote</button>
                  )}
                  {exists && (
                    <span className="shrink-0 text-[10px] font-semibold text-accent bg-accent-dim/60 px-1.5 py-0.5 rounded" title="Already wrapped by an existing sales item — picking will reuse it">in catalog</span>
                  )}
                </div>
                {/* Inline add-quote form (BACK-2548) */}
                {mode === 'ingredient' && addQuoteFor?.id === row.id && (
                  <AddQuoteInline
                    ingredient={row as IngredientRow}
                    countryId={menu.country_id}
                    currencySymbol={symbol}
                    onCancel={() => setAddQuoteFor(null)}
                    onCreated={async () => {
                      setAddQuoteFor(null)
                      await reloadIngredients()
                    }}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-text-3 italic">
        {mode === 'recipe'
          ? 'No recipe creation here — build new recipes in the Recipes module.'
          : 'No ingredient creation here — add new ingredients in Inventory.'}
      </p>
    </div>
  )
}

// ── Inline add-quote form (BACK-2548) ──────────────────────────────────────
// Surfaced when an ingredient has no active price quote in the menu's market.
// Lazy-loads the vendor list scoped to the menu's country, lets the user pick
// or create a vendor, then POSTs to /price-quotes. On success the parent
// reloads the ingredient catalog so the cost shows up immediately.

function AddQuoteInline({
  ingredient, countryId, currencySymbol, onCancel, onCreated,
}: {
  ingredient: IngredientRow
  countryId: number
  currencySymbol: string
  onCancel: () => void
  onCreated: () => void | Promise<void>
}) {
  const api = useApi()
  const [vendors,        setVendors]        = useState<VendorRow[]>([])
  const [vendorsLoading, setVendorsLoading] = useState(false)
  const [vendorId,       setVendorId]       = useState<string>('')
  const [purchasePrice,  setPurchasePrice]  = useState<string>('')
  const [qtyBase,        setQtyBase]        = useState<string>('1')
  const [purchaseUnit,   setPurchaseUnit]   = useState<string>(ingredient.base_unit_abbr || '')
  // Inline vendor creation
  const [creatingVendor, setCreatingVendor] = useState(false)
  const [newVendorName,  setNewVendorName]  = useState('')
  const [saving,         setSaving]         = useState(false)
  const [error,          setError]          = useState<string | null>(null)

  useEffect(() => {
    setVendorsLoading(true)
    api.get(`/vendors?country_id=${countryId}`)
      .then((d: VendorRow[]) => setVendors(d || []))
      .catch(() => setVendors([]))
      .finally(() => setVendorsLoading(false))
  }, [api, countryId])

  const submit = async () => {
    setError(null)
    let vendorIdNum = vendorId ? Number(vendorId) : null
    // If the user typed a new vendor name, create it first.
    if (creatingVendor) {
      if (!newVendorName.trim()) { setError('Vendor name is required'); return }
      try {
        const v = await api.post('/vendors', {
          name:       newVendorName.trim(),
          country_id: countryId,
        }) as VendorRow
        vendorIdNum = v.id
        setVendors(prev => [...prev, v])
      } catch (err: unknown) {
        setError((err as { message?: string })?.message || 'Failed to create vendor')
        return
      }
    }
    if (!vendorIdNum) { setError('Pick or create a vendor'); return }
    const price = Number(purchasePrice)
    if (!Number.isFinite(price) || price <= 0) { setError('Purchase price must be > 0'); return }
    const qty = Number(qtyBase)
    if (!Number.isFinite(qty) || qty <= 0) { setError('Qty in base units must be > 0'); return }
    setSaving(true)
    try {
      await api.post('/price-quotes', {
        ingredient_id:     ingredient.id,
        vendor_id:         vendorIdNum,
        purchase_price:    price,
        qty_in_base_units: qty,
        purchase_unit:     purchaseUnit.trim() || ingredient.base_unit_abbr || null,
        is_active:         true,
      })
      await onCreated()
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to save quote')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-amber-50/40 border-t border-amber-200 px-3 py-3 space-y-2" onClick={(e) => e.stopPropagation()}>
      <div className="text-[11px] font-semibold text-amber-800">
        Add a price quote for <strong>{ingredient.name}</strong> in {currencySymbol ? <>{currencySymbol} </> : ''}this market
      </div>

      {/* Vendor picker / inline-create toggle */}
      <Field label="Vendor" required>
        {creatingVendor ? (
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              autoFocus
              value={newVendorName}
              onChange={e => setNewVendorName(e.target.value)}
              placeholder="New vendor name…"
            />
            <button className="btn-ghost text-[11px] px-2" onClick={() => { setCreatingVendor(false); setNewVendorName('') }}>← Pick existing</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <select
              className="input flex-1 text-sm"
              value={vendorId}
              onChange={e => setVendorId(e.target.value)}
              disabled={vendorsLoading}
            >
              <option value="">— Pick a vendor —</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button className="btn-ghost text-[11px] px-2" onClick={() => setCreatingVendor(true)}>+ New</button>
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Purchase price" required>
          <CalcInput
            className="input w-full font-mono text-sm"
            value={purchasePrice}
            onChange={setPurchasePrice}
            placeholder="0.00"
          />
        </Field>
        <Field label={`Qty in ${ingredient.base_unit_abbr || 'base unit'}`} required>
          <CalcInput
            className="input w-full font-mono text-sm"
            value={qtyBase}
            onChange={setQtyBase}
            placeholder="1"
          />
        </Field>
      </div>

      <Field label="Purchase unit (label only)" hint="e.g. case, kg, bag">
        <input
          className="input w-full text-sm"
          value={purchaseUnit}
          onChange={e => setPurchaseUnit(e.target.value)}
          placeholder={ingredient.base_unit_abbr || 'unit'}
        />
      </Field>

      {error && <div className="text-[11px] text-rose-700 font-medium">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost text-xs" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary text-xs"
          disabled={saving}
          onClick={submit}
        >{saving ? 'Saving…' : 'Save quote'}</button>
      </div>
    </div>
  )
}

// ── Manual sales item form (Story 3 / BACK-2519) ───────────────────────────
// Capture display name + manual_cost + image + description inline. Saves a
// new mcogs_sales_items row of type=manual and attaches it to the menu in
// one user action via createAndAttach (which fires both POSTs back-to-back).

function ManualItemForm({
  categories, onCategoryCreated, onCreateAndAttach,
}: {
  categories: CategoryRow[]
  onCategoryCreated: (c: CategoryRow) => void
  onCreateAndAttach: (payload: {
    item_type: 'recipe' | 'ingredient' | 'manual' | 'combo'
    name: string
    display_name?: string | null
    category_id?: number | null
    manual_cost?: number | null
    image_url?: string | null
    description?: string | null
  }) => void | Promise<void>
}) {
  const api = useApi()
  // Story 7 — restore draft from sessionStorage on mount so an accidental
  // panel close doesn't lose typed work.
  const draftKey = 'menu-builder-manual-draft'
  const initialDraft = (() => {
    try {
      const raw = window.sessionStorage.getItem(draftKey)
      if (!raw) return null
      return JSON.parse(raw) as { name: string; displayName: string; categoryId: string; manualCost: string; imageUrl: string | null; description: string }
    } catch { return null }
  })()
  const [name,        setName]        = useState(initialDraft?.name || '')
  const [displayName, setDisplayName] = useState(initialDraft?.displayName || '')
  const [categoryId,  setCategoryId]  = useState<string>(initialDraft?.categoryId || '')
  const [manualCost,  setManualCost]  = useState<string>(initialDraft?.manualCost || '')
  const [imageUrl,    setImageUrl]    = useState<string | null>(initialDraft?.imageUrl || null)
  const [description, setDescription] = useState(initialDraft?.description || '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  // Persist draft on every change.
  useEffect(() => {
    const draft = { name, displayName, categoryId, manualCost, imageUrl, description }
    const isEmpty = !name && !displayName && !categoryId && !manualCost && !imageUrl && !description
    try {
      if (isEmpty) window.sessionStorage.removeItem(draftKey)
      else         window.sessionStorage.setItem(draftKey, JSON.stringify(draft))
    } catch { /* quota — ignore */ }
  }, [name, displayName, categoryId, manualCost, imageUrl, description])

  const canSave = name.trim().length > 0 && !saving

  const submit = async () => {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }
    const cost = manualCost === '' ? null : Number(manualCost)
    if (manualCost !== '' && !Number.isFinite(cost)) {
      setError('Manual cost must be a number')
      return
    }
    setSaving(true)
    try {
      await onCreateAndAttach({
        item_type:    'manual',
        name:         name.trim(),
        display_name: displayName.trim() || null,
        category_id:  categoryId ? Number(categoryId) : null,
        manual_cost:  cost,
        image_url:    imageUrl || null,
        description:  description.trim() || null,
      })
      // Clear draft + reset local state on successful save.
      try { window.sessionStorage.removeItem(draftKey) } catch { /* ignore */ }
      setName(''); setDisplayName(''); setCategoryId(''); setManualCost('')
      setImageUrl(null); setDescription('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <Field label="Name" required>
        <input
          className="input w-full"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Takeaway bag"
        />
      </Field>

      <Field label="Display name" hint="Shown on menus / receipts. Falls back to Name if blank.">
        <input
          className="input w-full"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
      </Field>

      <Field label="Category">
        <CategoryPicker
          value={categoryId}
          onChange={setCategoryId}
          categories={categories}
          scope="for_sales_items"
          onCategoryCreated={(c) => {
            onCategoryCreated(c)
            setCategoryId(String(c.id))
          }}
          apiPost={(p, b) => api.post(p, b)}
        />
      </Field>

      <Field label="Manual cost" hint="Currency follows the menu's market. Type a number or expression (e.g. 0.25 + 0.10).">
        <CalcInput
          className="input w-full font-mono"
          value={manualCost}
          onChange={setManualCost}
          placeholder="0.00"
        />
      </Field>

      <Field label="Image">
        <ImageUpload
          value={imageUrl}
          onChange={setImageUrl}
          formKey="sales-item-manual"
        />
      </Field>

      <Field label="Description">
        <textarea
          className="input w-full"
          rows={2}
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
      </Field>

      {error && (
        <div className="text-xs text-rose-600 font-medium">{error}</div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button
          className="btn-primary"
          disabled={!canSave}
          onClick={submit}
        >{saving ? 'Saving…' : 'Create & add to menu'}</button>
      </div>
    </div>
  )
}

// ── Edit-item side panel (Story 6 / BACK-2522) ─────────────────────────────
// Opens when the user clicks an item row in the menu items list. Surfaces the
// per-menu pricing overrides + per-market visibility for that sales item, in
// two tabs. Save fires server roundtrip per row; markets toggle auto-saves.

function EditItemPanel({
  menu, msi, width, onResize, onChanged, onOpenGroupEditor, onClose, onToast,
}: {
  menu: Menu
  msi: MenuSalesItem
  width: number
  onResize: (w: number) => void
  onChanged: () => void
  onOpenGroupEditor: (modifierGroupId: number) => void
  onClose: () => void
  onToast: (t: { message: string; type?: 'success' | 'error' }) => void
}) {
  const api = useApi()
  // BACK-2569 — Pricing tab removed. Pricing is now edited inline on the
  // items list (one editable cell per country-enabled price level).
  // BACK-2549 — Markets tab also gone (managed from Sales Items only).
  // BACK-2599 — panel now has TWO sections: Details (full sales-item edit)
  // and Modifier groups.
  const [allModGroups,    setAllModGroups]    = useState<ModifierGroup[]>([])
  const [attachedGroups,  setAttachedGroups]  = useState<AttachedModifierGroup[]>([])
  const [modsLoading,     setModsLoading]     = useState(false)
  // BACK-2599 — full sales-item record for the Details section.
  const [siFull, setSiFull] = useState<FullSalesItem | null>(null)
  const [siLoading, setSiLoading] = useState(false)
  const [categories, setCategories] = useState<CategoryRow[]>([])

  // Load modifier-group catalog + the full sales item (which already returns
  // attached modifier_groups in the same shape). One round-trip covers both.
  const loadAll = useCallback(async () => {
    setModsLoading(true)
    setSiLoading(true)
    try {
      const [catalog, full, cats] = await Promise.all([
        api.get('/modifier-groups') as Promise<ModifierGroup[]>,
        api.get(`/sales-items/${msi.sales_item_id}`) as Promise<FullSalesItem>,
        api.get('/categories?for_sales_items=true') as Promise<CategoryRow[]>,
      ])
      setAllModGroups(catalog || [])
      setSiFull(full)
      setAttachedGroups(full?.modifier_groups || [])
      setCategories(cats || [])
    } catch {
      // surfaced via empty state
    } finally {
      setModsLoading(false)
      setSiLoading(false)
    }
  }, [api, msi.sales_item_id])

  useEffect(() => { loadAll() }, [loadAll])
  // Back-compat alias used in the rollback path of the modifier-group save.
  const loadMods = loadAll

  // BACK-2599 — auto-save patch on the full sales item via PUT /sales-items/:id.
  // Optimistic local merge + reload on failure. onChanged also bubbles up so
  // the items list refreshes (name / image changes are visible right away).
  const saveSiPatch = async (patch: Partial<FullSalesItem>) => {
    if (!siFull) return
    const next = { ...siFull, ...patch } as FullSalesItem
    setSiFull(next)
    try {
      await api.put(`/sales-items/${siFull.id}`, {
        name:          next.name,
        display_name:  next.display_name,
        category_id:   next.category_id,
        description:   next.description,
        recipe_id:     next.recipe_id,
        ingredient_id: next.ingredient_id,
        combo_id:      next.combo_id,
        manual_cost:   next.manual_cost,
        image_url:     next.image_url,
        sort_order:    next.sort_order,
        qty:           next.qty,
      })
      onChanged()
    } catch (err: unknown) {
      // Recover authoritative state on failure
      loadAll()
      onToast({ message: (err as { message?: string })?.message || 'Failed to save sales item', type: 'error' })
    }
  }

  // Persist the attached set to the server. PUT replaces — we send the FULL
  // list of {modifier_group_id, auto_show} entries.
  const persistAttachedGroups = async (next: AttachedModifierGroup[]) => {
    try {
      await api.put(`/sales-items/${msi.sales_item_id}/modifier-groups`, {
        groups: next.map(g => ({ modifier_group_id: g.modifier_group_id, auto_show: g.auto_show })),
      })
      setAttachedGroups(next)
      onChanged()
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to update modifier groups'
      onToast({ message: msg, type: 'error' })
      // Reload to recover authoritative state
      loadMods()
    }
  }


  return (
    <aside
      className="shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      <ResizeHandle width={width} onResize={onResize} />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-text-3 font-semibold truncate">{menu.name} <span className="text-text-3/60">›</span> Edit item</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center ${TYPE_BADGE[msi.item_type].cls}`}
              title={TYPE_LABELS[msi.item_type]}
            >{TYPE_BADGE[msi.item_type].label}</span>
            <span className="font-semibold text-sm text-text-1 truncate">{msi.sales_item_name}</span>
          </div>
        </div>
        <button onClick={onClose} className="text-text-3 hover:text-text-1 text-sm px-2" title="Close (Esc)">✕</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {/* BACK-2599 — full sales-item Details section (auto-saves on blur) */}
        <div className="px-3 py-2 border-b border-border bg-surface-2/40 text-[11px] font-semibold text-text-2">
          Details
        </div>
        <div className="p-3">
          {siLoading || !siFull ? (
            <div className="flex justify-center py-4"><Spinner /></div>
          ) : (
            <SalesItemDetailsForm
              si={siFull}
              categories={categories}
              onCategoryCreated={(c) => setCategories(prev => [...prev, c])}
              onPatch={saveSiPatch}
              onReload={loadAll}
              onToast={onToast}
              api={api}
            />
          )}
        </div>

        <div className="px-3 py-2 border-y border-border bg-surface-2/40 text-[11px] font-semibold text-text-2">
          Modifier groups{attachedGroups.length > 0 && <span className="ml-1 text-text-3 font-mono">({attachedGroups.length})</span>}
        </div>
        <div className="p-3">
        <ModifiersTab
          allGroups={allModGroups}
          attached={attachedGroups}
          loading={modsLoading}
          onDetach={(mgid) => persistAttachedGroups(attachedGroups.filter(g => g.modifier_group_id !== mgid))}
          onToggleAutoShow={(mgid, autoShow) => persistAttachedGroups(
            attachedGroups.map(g => g.modifier_group_id === mgid ? { ...g, auto_show: autoShow } : g)
          )}
          onAttach={(toAttach) => {
            const merged = [
              ...attachedGroups,
              ...toAttach
                .filter(g => !attachedGroups.some(a => a.modifier_group_id === g.id))
                .map((g, idx) => ({
                  modifier_group_id: g.id,
                  sort_order: attachedGroups.length + idx,
                  auto_show: g.default_auto_show,
                  name: g.name,
                  description: null,
                  min_select: g.min_select,
                  max_select: g.max_select,
                } satisfies AttachedModifierGroup)),
            ]
            return persistAttachedGroups(merged)
          }}
          onCreated={(newGroup) => {
            setAllModGroups(prev => [...prev, newGroup])
            const merged = [...attachedGroups, {
              modifier_group_id: newGroup.id,
              sort_order: attachedGroups.length,
              auto_show: newGroup.default_auto_show,
              name: newGroup.name,
              description: null,
              min_select: newGroup.min_select,
              max_select: newGroup.max_select,
            } satisfies AttachedModifierGroup]
            return persistAttachedGroups(merged)
          }}
          onReorder={(newOrder) => persistAttachedGroups(newOrder)}
          onOpenEditor={(mgid) => onOpenGroupEditor(mgid)}
        />
        </div>
      </div>
    </aside>
  )
}

// PricingTab + PriceLevelRow removed in BACK-2569 — pricing now edits inline
// on the items list via the PriceCell component.

// ── Modifier-group editor panel (BACK-2585 / BACK-2587) ────────────────────
// Single-purpose panel that opens when the user clicks a modifier group in
// the attached list OR in the expanded inline view. Lets them edit group
// settings + manage options end-to-end (CRUD + drag-drop reorder).

interface FullModifierOption {
  id: number
  modifier_group_id: number
  name: string
  display_name: string | null
  item_type: 'recipe' | 'ingredient' | 'manual'
  recipe_id: number | null
  ingredient_id: number | null
  manual_cost: number | null
  price_addon: number
  qty: number
  sort_order: number
  recipe_name?: string | null
  ingredient_name?: string | null
}

interface FullModifierGroup {
  id: number
  name: string
  display_name: string | null
  description: string | null
  min_select: number
  max_select: number
  allow_repeat_selection: boolean
  default_auto_show: boolean
  options: FullModifierOption[]
}

function ModifierGroupEditorPanel({
  menu, msi, modifierGroupId, width, onResize, onBack, onClose, onChanged, onToast,
}: {
  menu: Menu
  msi: MenuSalesItem
  modifierGroupId: number
  width: number
  onResize: (w: number) => void
  onBack: () => void
  onClose: () => void
  onChanged: () => void
  onToast: (t: { message: string; type?: 'success' | 'error' }) => void
}) {
  const api = useApi()
  const [group, setGroup] = useState<FullModifierGroup | null>(null)
  const [loading, setLoading] = useState(true)
  // Catalogs for option pickers — loaded lazily.
  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[] | null>(null)
  // Drag-drop reorder state.
  const [dragId,    setDragId]    = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  // Per-option saving spinner.
  const [savingOpts, setSavingOpts] = useState<Set<number>>(new Set())

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get(`/modifier-groups/${modifierGroupId}`) as FullModifierGroup
      setGroup(data)
    } catch {
      onToast({ message: 'Failed to load modifier group', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [api, modifierGroupId, onToast])

  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    if (recipes === null) {
      api.get('/recipes').then((d: RecipeRow[]) => setRecipes(d || [])).catch(() => setRecipes([]))
    }
    if (ingredients === null) {
      api.get('/ingredients').then((d: IngredientRow[]) => setIngredients(d || [])).catch(() => setIngredients([]))
    }
  }, [api, recipes, ingredients])

  // ── Group settings save (debounced via blur) ──────────────────────────────
  const saveGroupSettings = async (patch: Partial<FullModifierGroup>) => {
    if (!group) return
    const next = { ...group, ...patch }
    setGroup(next)
    try {
      await api.put(`/modifier-groups/${group.id}`, {
        name: next.name,
        display_name: next.display_name,
        description: next.description,
        min_select: next.min_select,
        max_select: next.max_select,
        allow_repeat_selection: next.allow_repeat_selection,
        default_auto_show: next.default_auto_show,
      })
      onChanged()
    } catch (err: unknown) {
      reload()
      onToast({ message: (err as { message?: string })?.message || 'Failed to save settings', type: 'error' })
    }
  }

  // ── Option CRUD ───────────────────────────────────────────────────────────
  const addOption = async () => {
    if (!group) return
    const nextSort = group.options.length
    try {
      const created = await api.post(`/modifier-groups/${group.id}/options`, {
        name: `Option ${nextSort + 1}`,
        item_type: 'manual',
        manual_cost: 0,
        price_addon: 0,
        qty: 1,
        sort_order: nextSort,
      }) as FullModifierOption
      setGroup({ ...group, options: [...group.options, created] })
      onChanged()
    } catch (err: unknown) {
      onToast({ message: (err as { message?: string })?.message || 'Failed to add option', type: 'error' })
    }
  }

  const saveOption = async (opt: FullModifierOption, patch: Partial<FullModifierOption>) => {
    if (!group) return
    const next = { ...opt, ...patch }
    // Optimistic
    setGroup({ ...group, options: group.options.map(o => o.id === opt.id ? next : o) })
    setSavingOpts(prev => { const s = new Set(prev); s.add(opt.id); return s })
    try {
      await api.put(`/modifier-groups/${group.id}/options/${opt.id}`, {
        name: next.name,
        display_name: next.display_name,
        item_type: next.item_type,
        recipe_id: next.recipe_id,
        ingredient_id: next.ingredient_id,
        manual_cost: next.manual_cost,
        price_addon: next.price_addon,
        qty: next.qty,
        sort_order: next.sort_order,
      })
      onChanged()
    } catch (err: unknown) {
      reload()
      onToast({ message: (err as { message?: string })?.message || 'Failed to save option', type: 'error' })
    } finally {
      setSavingOpts(prev => { const s = new Set(prev); s.delete(opt.id); return s })
    }
  }

  const deleteOption = async (opt: FullModifierOption) => {
    if (!group) return
    const before = group
    setGroup({ ...group, options: group.options.filter(o => o.id !== opt.id) })
    try {
      await api.delete(`/modifier-groups/${group.id}/options/${opt.id}`)
      onChanged()
    } catch (err: unknown) {
      setGroup(before)
      onToast({ message: (err as { message?: string })?.message || 'Failed to delete option', type: 'error' })
    }
  }

  const reorderOptions = async (sourceId: number, targetId: number) => {
    if (!group || sourceId === targetId) return
    const fromIdx = group.options.findIndex(o => o.id === sourceId)
    const toIdx   = group.options.findIndex(o => o.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = [...group.options]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    const reindexed = next.map((o, i) => ({ ...o, sort_order: i }))
    setGroup({ ...group, options: reindexed })
    try {
      await api.post(`/modifier-groups/${group.id}/options/reorder`, { order: reindexed.map(o => o.id) })
      onChanged()
    } catch (err: unknown) {
      reload()
      onToast({ message: (err as { message?: string })?.message || 'Failed to reorder', type: 'error' })
    }
  }

  return (
    <aside
      className="shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      <ResizeHandle width={width} onResize={onResize} />
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <button
            type="button"
            className="text-[10px] uppercase tracking-wide text-text-3 hover:text-accent font-semibold flex items-center gap-1"
            onClick={onBack}
          >‹ {menu.name} <span className="text-text-3/60">›</span> {msi.sales_item_name}</button>
          <div className="font-semibold text-sm text-text-1 truncate mt-0.5">
            Modifier group: {group?.name || '…'}
          </div>
        </div>
        <button onClick={onClose} className="text-text-3 hover:text-text-1 text-sm px-2" title="Close (Esc)">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading || !group ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
            {/* Settings */}
            <div className="rounded-lg border border-border bg-surface-2/30 px-3 py-3 space-y-2">
              <div className="text-xs font-semibold text-text-2">Settings</div>
              <Field label="Name" required>
                <input
                  className="input w-full text-sm"
                  defaultValue={group.name}
                  onBlur={(e) => { if (e.target.value.trim() !== group.name) saveGroupSettings({ name: e.target.value.trim() }) }}
                />
              </Field>
              <Field label="Description">
                <input
                  className="input w-full text-sm"
                  defaultValue={group.description || ''}
                  onBlur={(e) => { if ((e.target.value || null) !== group.description) saveGroupSettings({ description: e.target.value || null }) }}
                />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min select">
                  <input
                    className="input w-full font-mono text-sm" type="number" min={0}
                    defaultValue={group.min_select}
                    onBlur={(e) => { const n = Math.max(0, Math.floor(Number(e.target.value)||0)); if (n !== group.min_select) saveGroupSettings({ min_select: n }) }}
                  />
                </Field>
                <Field label="Max select">
                  <input
                    className="input w-full font-mono text-sm" type="number" min={1}
                    defaultValue={group.max_select}
                    onBlur={(e) => { const n = Math.max(1, Math.floor(Number(e.target.value)||1)); if (n !== group.max_select) saveGroupSettings({ max_select: n }) }}
                  />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
                <input type="checkbox" checked={group.allow_repeat_selection}
                  onChange={(e) => saveGroupSettings({ allow_repeat_selection: e.target.checked })} />
                Allow the same option to be picked multiple times
              </label>
              <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
                <input type="checkbox" checked={group.default_auto_show}
                  onChange={(e) => saveGroupSettings({ default_auto_show: e.target.checked })} />
                Show inline by default (vs. behind a button)
              </label>
              <div className="text-[10px] text-text-3 italic">Settings auto-save on blur.</div>
            </div>

            {/* Options */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-text-2">Options{group.options.length > 0 && <span className="ml-1 text-text-3 font-mono">({group.options.length})</span>}</div>
                <button className="btn-primary text-xs px-2.5 py-1" onClick={addOption}>+ Add option</button>
              </div>
              {group.options.length === 0 ? (
                <div className="text-xs text-text-3 italic py-3 text-center border border-dashed border-border rounded">No options yet — click + Add option.</div>
              ) : (
                <ul className="space-y-2">
                  {group.options.map(o => (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={() => setDragId(o.id)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverId(o.id) }}
                      onDragLeave={() => setDragOverId(null)}
                      onDrop={() => { if (dragId !== null) reorderOptions(dragId, o.id); setDragId(null); setDragOverId(null) }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                      className={`rounded border bg-surface-2/30 px-2.5 py-2 cursor-grab active:cursor-grabbing transition-colors ${
                        dragOverId === o.id && dragId !== o.id ? 'border-accent border-t-2' : 'border-border'
                      } ${dragId === o.id ? 'opacity-40' : ''} ${savingOpts.has(o.id) ? 'ring-1 ring-accent/30' : ''}`}
                    >
                      <ModifierOptionEditor
                        option={o}
                        recipes={recipes}
                        ingredients={ingredients}
                        onChange={(patch) => saveOption(o, patch)}
                        onDelete={() => deleteOption(o)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

// Inline editor for a single modifier option.
function ModifierOptionEditor({
  option, recipes, ingredients, onChange, onDelete,
}: {
  option: FullModifierOption
  recipes: RecipeRow[] | null
  ingredients: IngredientRow[] | null
  onChange: (patch: Partial<FullModifierOption>) => void | Promise<void>
  onDelete: () => void
}) {
  const [recipeSearch, setRecipeSearch] = useState('')
  const [ingredientSearch, setIngredientSearch] = useState('')

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase()
    return (recipes || []).filter(r => !q || r.name.toLowerCase().includes(q)).slice(0, 12)
  }, [recipes, recipeSearch])
  const filteredIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase()
    return (ingredients || []).filter(i => !q || i.name.toLowerCase().includes(q)).slice(0, 12)
  }, [ingredients, ingredientSearch])

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="text-text-3 text-xs">⠿</span>
        <input
          className="input flex-1 text-sm"
          defaultValue={option.name}
          onBlur={(e) => { if (e.target.value.trim() !== option.name) onChange({ name: e.target.value.trim() }) }}
          placeholder="Option name"
        />
        <button className="text-text-3 hover:text-red-600 text-xs" onClick={onDelete} title="Delete option">✕</button>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-text-2">
        {(['recipe','ingredient','manual'] as const).map(t => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name={`opt-type-${option.id}`} checked={option.item_type === t}
              onChange={() => onChange({ item_type: t, recipe_id: null, ingredient_id: null, manual_cost: t === 'manual' ? 0 : null })} />
            <span className="capitalize">{t}</span>
          </label>
        ))}
      </div>

      {option.item_type === 'recipe' && (
        <div>
          <input
            className="input w-full text-xs"
            value={option.recipe_id ? (option.recipe_name || `Recipe #${option.recipe_id}`) : recipeSearch}
            onChange={(e) => setRecipeSearch(e.target.value)}
            onFocus={() => { if (option.recipe_id) onChange({ recipe_id: null }); setRecipeSearch('') }}
            placeholder="Search recipe…"
          />
          {!option.recipe_id && recipeSearch && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded border border-border">
              {filteredRecipes.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredRecipes.map(r => (
                <button key={r.id} type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => { onChange({ recipe_id: r.id, recipe_name: r.name, name: option.name || r.name }); setRecipeSearch('') }}
                >{r.name}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {option.item_type === 'ingredient' && (
        <div>
          <input
            className="input w-full text-xs"
            value={option.ingredient_id ? (option.ingredient_name || `Ingredient #${option.ingredient_id}`) : ingredientSearch}
            onChange={(e) => setIngredientSearch(e.target.value)}
            onFocus={() => { if (option.ingredient_id) onChange({ ingredient_id: null }); setIngredientSearch('') }}
            placeholder="Search ingredient…"
          />
          {!option.ingredient_id && ingredientSearch && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded border border-border">
              {filteredIngredients.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredIngredients.map(i => (
                <button key={i.id} type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => { onChange({ ingredient_id: i.id, ingredient_name: i.name, name: option.name || i.name }); setIngredientSearch('') }}
                >{i.name} <span className="text-text-3">{i.base_unit_abbr}</span></button>
              ))}
            </div>
          )}
        </div>
      )}

      {option.item_type === 'manual' && (
        <input
          className="input w-full text-xs font-mono"
          defaultValue={option.manual_cost ?? 0}
          onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== Number(option.manual_cost)) onChange({ manual_cost: n }) }}
          placeholder="Manual cost (e.g. 0.25)"
        />
      )}

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-3">
          <span className="block">Price add-on</span>
          <input className="input w-full text-xs font-mono"
            defaultValue={option.price_addon}
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== Number(option.price_addon)) onChange({ price_addon: n }) }}
          />
        </label>
        <label className="text-[10px] text-text-3">
          <span className="block">Qty</span>
          <input className="input w-full text-xs font-mono"
            defaultValue={option.qty}
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0 && n !== Number(option.qty)) onChange({ qty: n }) }}
          />
        </label>
      </div>
    </div>
  )
}

// ── Combo step editor panel (BACK-2587) ────────────────────────────────────
// Mirror of ModifierGroupEditorPanel but for a combo step. Settings include
// auto_select. Options point at the same recipe / ingredient / manual model
// but persist into mcogs_combo_step_options.

interface FullComboStepOption {
  id: number
  combo_step_id: number
  name: string
  display_name: string | null
  item_type: 'recipe' | 'ingredient' | 'manual'
  recipe_id: number | null
  ingredient_id: number | null
  sales_item_id: number | null
  manual_cost: number | null
  price_addon: number
  qty: number
  sort_order: number
}

interface FullComboStep {
  id: number
  combo_id: number
  name: string
  display_name: string | null
  description: string | null
  sort_order: number
  min_select: number
  max_select: number
  allow_repeat: boolean
  auto_select: boolean
  options: FullComboStepOption[]
}

function ComboStepEditorPanel({
  menu, msi, comboStepId, width, onResize, onBack, onClose, onChanged, onToast,
}: {
  menu: Menu
  msi: MenuSalesItem
  comboStepId: number
  width: number
  onResize: (w: number) => void
  onBack: () => void
  onClose: () => void
  onChanged: () => void
  onToast: (t: { message: string; type?: 'success' | 'error' }) => void
}) {
  const api = useApi()
  const [step, setStep] = useState<FullComboStep | null>(null)
  const [comboId, setComboId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [recipes, setRecipes] = useState<RecipeRow[] | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[] | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  const [savingOpts, setSavingOpts] = useState<Set<number>>(new Set())

  // Resolve combo_id from the parent SI, then fetch the full combo and pick
  // out the matching step.
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const si = await api.get(`/sales-items/${msi.sales_item_id}`) as { combo_id: number | null }
      if (!si.combo_id) { setStep(null); return }
      setComboId(si.combo_id)
      const combo = await api.get(`/combos/${si.combo_id}`) as { steps: FullComboStep[] }
      const found = combo.steps?.find(s => s.id === comboStepId) || null
      setStep(found)
    } catch {
      onToast({ message: 'Failed to load combo step', type: 'error' })
    } finally {
      setLoading(false)
    }
  }, [api, msi.sales_item_id, comboStepId, onToast])

  useEffect(() => { reload() }, [reload])
  useEffect(() => {
    if (recipes === null)     api.get('/recipes').then((d: RecipeRow[]) => setRecipes(d || [])).catch(() => setRecipes([]))
    if (ingredients === null) api.get('/ingredients').then((d: IngredientRow[]) => setIngredients(d || [])).catch(() => setIngredients([]))
  }, [api, recipes, ingredients])

  const saveStepSettings = async (patch: Partial<FullComboStep>) => {
    if (!step || !comboId) return
    const next = { ...step, ...patch }
    setStep(next)
    try {
      await api.put(`/combos/${comboId}/steps/${step.id}`, {
        name: next.name,
        display_name: next.display_name,
        description: next.description,
        sort_order: next.sort_order,
        min_select: next.min_select,
        max_select: next.max_select,
        allow_repeat: next.allow_repeat,
        auto_select: next.auto_select,
      })
      onChanged()
    } catch (err: unknown) {
      reload()
      onToast({ message: (err as { message?: string })?.message || 'Failed to save settings', type: 'error' })
    }
  }

  const addOption = async () => {
    if (!step || !comboId) return
    try {
      const created = await api.post(`/combos/${comboId}/steps/${step.id}/options`, {
        name: `Option ${step.options.length + 1}`,
        item_type: 'manual',
        manual_cost: 0,
        price_addon: 0,
        qty: 1,
        sort_order: step.options.length,
      }) as FullComboStepOption
      setStep({ ...step, options: [...step.options, created] })
      onChanged()
    } catch (err: unknown) {
      onToast({ message: (err as { message?: string })?.message || 'Failed to add option', type: 'error' })
    }
  }

  const saveOption = async (opt: FullComboStepOption, patch: Partial<FullComboStepOption>) => {
    if (!step || !comboId) return
    const next = { ...opt, ...patch }
    setStep({ ...step, options: step.options.map(o => o.id === opt.id ? next : o) })
    setSavingOpts(prev => { const s = new Set(prev); s.add(opt.id); return s })
    try {
      await api.put(`/combos/${comboId}/steps/${step.id}/options/${opt.id}`, {
        name: next.name,
        display_name: next.display_name,
        item_type: next.item_type,
        recipe_id: next.recipe_id,
        ingredient_id: next.ingredient_id,
        sales_item_id: next.sales_item_id,
        manual_cost: next.manual_cost,
        price_addon: next.price_addon,
        qty: next.qty,
        sort_order: next.sort_order,
      })
      onChanged()
    } catch (err: unknown) {
      reload()
      onToast({ message: (err as { message?: string })?.message || 'Failed to save option', type: 'error' })
    } finally {
      setSavingOpts(prev => { const s = new Set(prev); s.delete(opt.id); return s })
    }
  }

  const deleteOption = async (opt: FullComboStepOption) => {
    if (!step || !comboId) return
    const before = step
    setStep({ ...step, options: step.options.filter(o => o.id !== opt.id) })
    try {
      await api.delete(`/combos/${comboId}/steps/${step.id}/options/${opt.id}`)
      onChanged()
    } catch (err: unknown) {
      setStep(before)
      onToast({ message: (err as { message?: string })?.message || 'Failed to delete option', type: 'error' })
    }
  }

  const reorderOptions = async (sourceId: number, targetId: number) => {
    if (!step || !comboId || sourceId === targetId) return
    const fromIdx = step.options.findIndex(o => o.id === sourceId)
    const toIdx   = step.options.findIndex(o => o.id === targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const next = [...step.options]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    const reindexed = next.map((o, i) => ({ ...o, sort_order: i }))
    setStep({ ...step, options: reindexed })
    try {
      await api.post(`/combos/${comboId}/steps/${step.id}/options/reorder`, { order: reindexed.map(o => o.id) })
      onChanged()
    } catch (err: unknown) {
      reload()
      onToast({ message: (err as { message?: string })?.message || 'Failed to reorder', type: 'error' })
    }
  }

  return (
    <aside
      className="shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden relative"
      style={{ width: `${width}px` }}
    >
      <ResizeHandle width={width} onResize={onResize} />
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="min-w-0">
          <button
            type="button"
            className="text-[10px] uppercase tracking-wide text-text-3 hover:text-accent font-semibold flex items-center gap-1"
            onClick={onBack}
          >‹ {menu.name} <span className="text-text-3/60">›</span> {msi.sales_item_name}</button>
          <div className="font-semibold text-sm text-text-1 truncate mt-0.5">
            Combo step: {step?.name || '…'}
          </div>
        </div>
        <button onClick={onClose} className="text-text-3 hover:text-text-1 text-sm px-2" title="Close (Esc)">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading || !step ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : (
          <>
            <div className="rounded-lg border border-border bg-surface-2/30 px-3 py-3 space-y-2">
              <div className="text-xs font-semibold text-text-2">Settings</div>
              <Field label="Name" required>
                <input className="input w-full text-sm" defaultValue={step.name}
                  onBlur={(e) => { if (e.target.value.trim() !== step.name) saveStepSettings({ name: e.target.value.trim() }) }} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Min select">
                  <input className="input w-full font-mono text-sm" type="number" min={0}
                    defaultValue={step.min_select}
                    onBlur={(e) => { const n = Math.max(0, Math.floor(Number(e.target.value)||0)); if (n !== step.min_select) saveStepSettings({ min_select: n }) }} />
                </Field>
                <Field label="Max select">
                  <input className="input w-full font-mono text-sm" type="number" min={1}
                    defaultValue={step.max_select}
                    onBlur={(e) => { const n = Math.max(1, Math.floor(Number(e.target.value)||1)); if (n !== step.max_select) saveStepSettings({ max_select: n }) }} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
                <input type="checkbox" checked={step.auto_select}
                  onChange={(e) => saveStepSettings({ auto_select: e.target.checked })} />
                Auto-advance when only one option
              </label>
              <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
                <input type="checkbox" checked={step.allow_repeat}
                  onChange={(e) => saveStepSettings({ allow_repeat: e.target.checked })} />
                Allow same option picked multiple times
              </label>
              <div className="text-[10px] text-text-3 italic">Settings auto-save on blur.</div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-text-2">Options{step.options.length > 0 && <span className="ml-1 text-text-3 font-mono">({step.options.length})</span>}</div>
                <button className="btn-primary text-xs px-2.5 py-1" onClick={addOption}>+ Add option</button>
              </div>
              {step.options.length === 0 ? (
                <div className="text-xs text-text-3 italic py-3 text-center border border-dashed border-border rounded">No options yet — click + Add option.</div>
              ) : (
                <ul className="space-y-2">
                  {step.options.map(o => (
                    <li
                      key={o.id}
                      draggable
                      onDragStart={() => setDragId(o.id)}
                      onDragOver={(e) => { e.preventDefault(); setDragOverId(o.id) }}
                      onDragLeave={() => setDragOverId(null)}
                      onDrop={() => { if (dragId !== null) reorderOptions(dragId, o.id); setDragId(null); setDragOverId(null) }}
                      onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                      className={`rounded border bg-surface-2/30 px-2.5 py-2 cursor-grab active:cursor-grabbing transition-colors ${
                        dragOverId === o.id && dragId !== o.id ? 'border-accent border-t-2' : 'border-border'
                      } ${dragId === o.id ? 'opacity-40' : ''} ${savingOpts.has(o.id) ? 'ring-1 ring-accent/30' : ''}`}
                    >
                      <ComboStepOptionEditor
                        option={o}
                        recipes={recipes}
                        ingredients={ingredients}
                        onChange={(patch) => saveOption(o, patch)}
                        onDelete={() => deleteOption(o)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

function ComboStepOptionEditor({
  option, recipes, ingredients, onChange, onDelete,
}: {
  option: FullComboStepOption
  recipes: RecipeRow[] | null
  ingredients: IngredientRow[] | null
  onChange: (patch: Partial<FullComboStepOption>) => void | Promise<void>
  onDelete: () => void
}) {
  const [recipeSearch, setRecipeSearch] = useState('')
  const [ingredientSearch, setIngredientSearch] = useState('')

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase()
    return (recipes || []).filter(r => !q || r.name.toLowerCase().includes(q)).slice(0, 12)
  }, [recipes, recipeSearch])
  const filteredIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase()
    return (ingredients || []).filter(i => !q || i.name.toLowerCase().includes(q)).slice(0, 12)
  }, [ingredients, ingredientSearch])

  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-2">
        <span className="text-text-3 text-xs">⠿</span>
        <input
          className="input flex-1 text-sm"
          defaultValue={option.name}
          onBlur={(e) => { if (e.target.value.trim() !== option.name) onChange({ name: e.target.value.trim() }) }}
          placeholder="Option name"
        />
        <button className="text-text-3 hover:text-red-600 text-xs" onClick={onDelete} title="Delete option">✕</button>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-text-2">
        {(['recipe','ingredient','manual'] as const).map(t => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input type="radio" name={`cs-opt-type-${option.id}`} checked={option.item_type === t}
              onChange={() => onChange({ item_type: t, recipe_id: null, ingredient_id: null, manual_cost: t === 'manual' ? 0 : null })} />
            <span className="capitalize">{t}</span>
          </label>
        ))}
      </div>
      {option.item_type === 'recipe' && (
        <div>
          <input
            className="input w-full text-xs"
            value={option.recipe_id ? `Recipe #${option.recipe_id}` : recipeSearch}
            onChange={(e) => setRecipeSearch(e.target.value)}
            onFocus={() => { if (option.recipe_id) onChange({ recipe_id: null }); setRecipeSearch('') }}
            placeholder="Search recipe…"
          />
          {!option.recipe_id && recipeSearch && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded border border-border">
              {filteredRecipes.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredRecipes.map(r => (
                <button key={r.id} type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => { onChange({ recipe_id: r.id, name: option.name || r.name }); setRecipeSearch('') }}
                >{r.name}</button>
              ))}
            </div>
          )}
        </div>
      )}
      {option.item_type === 'ingredient' && (
        <div>
          <input
            className="input w-full text-xs"
            value={option.ingredient_id ? `Ingredient #${option.ingredient_id}` : ingredientSearch}
            onChange={(e) => setIngredientSearch(e.target.value)}
            onFocus={() => { if (option.ingredient_id) onChange({ ingredient_id: null }); setIngredientSearch('') }}
            placeholder="Search ingredient…"
          />
          {!option.ingredient_id && ingredientSearch && (
            <div className="mt-1 max-h-32 overflow-y-auto rounded border border-border">
              {filteredIngredients.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredIngredients.map(i => (
                <button key={i.id} type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => { onChange({ ingredient_id: i.id, name: option.name || i.name }); setIngredientSearch('') }}
                >{i.name} <span className="text-text-3">{i.base_unit_abbr}</span></button>
              ))}
            </div>
          )}
        </div>
      )}
      {option.item_type === 'manual' && (
        <input
          className="input w-full text-xs font-mono"
          defaultValue={option.manual_cost ?? 0}
          onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== Number(option.manual_cost)) onChange({ manual_cost: n }) }}
          placeholder="Manual cost"
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-text-3">
          <span className="block">Price add-on</span>
          <input className="input w-full text-xs font-mono"
            defaultValue={option.price_addon}
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== Number(option.price_addon)) onChange({ price_addon: n }) }}
          />
        </label>
        <label className="text-[10px] text-text-3">
          <span className="block">Qty</span>
          <input className="input w-full text-xs font-mono"
            defaultValue={option.qty}
            onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0 && n !== Number(option.qty)) onChange({ qty: n }) }}
          />
        </label>
      </div>
    </div>
  )
}

// ── Sales-item details form (BACK-2599) ────────────────────────────────────
// Surfaces every field on mcogs_sales_items so the operator can edit a sales
// item end-to-end without leaving Menu Builder. Auto-saves on blur for text
// fields and on change for everything else.

function SalesItemDetailsForm({
  si, categories, onCategoryCreated, onPatch, onReload, onToast, api,
}: {
  si: FullSalesItem
  categories: CategoryRow[]
  onCategoryCreated: (c: CategoryRow) => void
  onPatch: (patch: Partial<FullSalesItem>) => void | Promise<void>
  onReload: () => void | Promise<void>
  onToast: (t: { message: string; type?: 'success' | 'error' }) => void
  api: {
    post: (p: string, b: unknown) => Promise<unknown>;
    get: (p: string) => Promise<unknown>;
    put: (p: string, b: unknown) => Promise<unknown>;
  }
}) {
  // Recipe / ingredient pickers — lazy-loaded on demand for the relevant types.
  const [recipes,     setRecipes]     = useState<RecipeRow[] | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[] | null>(null)
  const [recipeSearch, setRecipeSearch] = useState('')
  const [ingredientSearch, setIngredientSearch] = useState('')
  // BACK-2600 — quick-edit modal target ('recipe' | 'ingredient' | null)
  const [quickEditing, setQuickEditing] = useState<'recipe' | 'ingredient' | null>(null)

  useEffect(() => {
    if (si.item_type === 'recipe' && recipes === null) {
      api.get('/recipes').then((d) => setRecipes((d as RecipeRow[]) || [])).catch(() => setRecipes([]))
    }
    if (si.item_type === 'ingredient' && ingredients === null) {
      api.get('/ingredients').then((d) => setIngredients((d as IngredientRow[]) || [])).catch(() => setIngredients([]))
    }
  }, [api, si.item_type, recipes, ingredients])

  const filteredRecipes = useMemo(() => {
    const q = recipeSearch.trim().toLowerCase()
    return (recipes || []).filter(r => !q || r.name.toLowerCase().includes(q)).slice(0, 12)
  }, [recipes, recipeSearch])
  const filteredIngredients = useMemo(() => {
    const q = ingredientSearch.trim().toLowerCase()
    return (ingredients || []).filter(i => !q || i.name.toLowerCase().includes(q)).slice(0, 12)
  }, [ingredients, ingredientSearch])

  return (
    <div className="space-y-3">
      {/* Image — always editable */}
      <Field label="Image">
        <ImageUpload
          value={si.image_url}
          onChange={(url) => onPatch({ image_url: url })}
          formKey={`sales-item-${si.item_type}`}
        />
      </Field>

      <Field label="Name" required>
        <input
          className="input w-full text-sm"
          defaultValue={si.name}
          onBlur={(e) => { if (e.target.value.trim() !== si.name) onPatch({ name: e.target.value.trim() }) }}
        />
      </Field>

      <Field label="Display name" hint="Shown on menus / receipts. Falls back to Name if blank.">
        <input
          className="input w-full text-sm"
          defaultValue={si.display_name || ''}
          onBlur={(e) => { const v = e.target.value || null; if (v !== si.display_name) onPatch({ display_name: v }) }}
        />
      </Field>

      <Field label="Category">
        <CategoryPicker
          value={si.category_id != null ? String(si.category_id) : ''}
          onChange={(idStr) => onPatch({ category_id: idStr ? Number(idStr) : null })}
          categories={categories}
          scope="for_sales_items"
          onCategoryCreated={(c) => { onCategoryCreated(c); onPatch({ category_id: c.id }) }}
          apiPost={(p, b) => api.post(p, b)}
        />
      </Field>

      <Field label="Description">
        <textarea
          className="input w-full text-sm"
          rows={2}
          defaultValue={si.description || ''}
          onBlur={(e) => { const v = e.target.value || null; if (v !== si.description) onPatch({ description: v }) }}
        />
      </Field>

      {/* Type-specific link (changeable) */}
      {si.item_type === 'manual' && (
        <Field label="Manual cost" hint="Currency follows the menu's market.">
          <CalcInput
            className="input w-full text-sm font-mono"
            value={si.manual_cost == null ? '' : String(si.manual_cost)}
            onChange={(v) => {
              const n = v === '' ? null : Number(v)
              if (Number.isFinite(n) || n === null) onPatch({ manual_cost: n })
            }}
            placeholder="0.00"
          />
        </Field>
      )}

      {si.item_type === 'recipe' && (
        <Field label="Linked recipe">
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              value={si.recipe_id ? (si.recipe_name || `Recipe #${si.recipe_id}`) : recipeSearch}
              onChange={(e) => { setRecipeSearch(e.target.value); if (si.recipe_id) onPatch({ recipe_id: null }) }}
              placeholder="Search recipe…"
            />
            {si.recipe_id && (
              <button
                type="button"
                className="btn-ghost text-xs px-2 shrink-0"
                onClick={() => setQuickEditing('recipe')}
                title="Quick-edit this recipe without leaving Menu Builder"
              >Edit ✎</button>
            )}
          </div>
          {!si.recipe_id && recipeSearch && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border">
              {filteredRecipes.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredRecipes.map(r => (
                <button key={r.id} type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => { onPatch({ recipe_id: r.id, recipe_name: r.name }); setRecipeSearch('') }}
                >{r.name}</button>
              ))}
            </div>
          )}
        </Field>
      )}

      {si.item_type === 'ingredient' && (
        <Field label="Linked ingredient">
          <div className="flex gap-2">
            <input
              className="input flex-1 text-sm"
              value={si.ingredient_id ? (si.ingredient_name || `Ingredient #${si.ingredient_id}`) : ingredientSearch}
              onChange={(e) => { setIngredientSearch(e.target.value); if (si.ingredient_id) onPatch({ ingredient_id: null }) }}
              placeholder="Search ingredient…"
            />
            {si.ingredient_id && (
              <button
                type="button"
                className="btn-ghost text-xs px-2 shrink-0"
                onClick={() => setQuickEditing('ingredient')}
                title="Quick-edit this ingredient without leaving Menu Builder"
              >Edit ✎</button>
            )}
          </div>
          {!si.ingredient_id && ingredientSearch && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border">
              {filteredIngredients.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredIngredients.map(i => (
                <button key={i.id} type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => { onPatch({ ingredient_id: i.id, ingredient_name: i.name }); setIngredientSearch('') }}
                >{i.name} <span className="text-text-3">{i.base_unit_abbr}</span></button>
              ))}
            </div>
          )}
        </Field>
      )}

      {/* BACK-2600 — quick-edit modal */}
      {quickEditing === 'recipe' && si.recipe_id && (
        <RecipeQuickEditModal
          recipeId={si.recipe_id}
          categories={categories}
          onCategoryCreated={onCategoryCreated}
          onClose={() => setQuickEditing(null)}
          onSaved={() => { setQuickEditing(null); onReload(); onToast({ message: 'Recipe updated', type: 'success' }) }}
          api={api}
        />
      )}
      {quickEditing === 'ingredient' && si.ingredient_id && (
        <IngredientQuickEditModal
          ingredientId={si.ingredient_id}
          categories={categories}
          onCategoryCreated={onCategoryCreated}
          onClose={() => setQuickEditing(null)}
          onSaved={() => { setQuickEditing(null); onReload(); onToast({ message: 'Ingredient updated', type: 'success' }) }}
          api={api}
        />
      )}

      {si.item_type === 'combo' && (
        <Field label="Linked combo">
          <div className="text-xs text-text-3 italic px-2 py-1.5 border border-border rounded bg-surface-2/40">
            {si.combo_name || `Combo #${si.combo_id ?? '—'}`}. Edit steps and options by clicking a step header in the expanded inline view.
          </div>
        </Field>
      )}

      <div className="text-[10px] text-text-3 italic">All fields auto-save on blur (image, category and pickers save on change).</div>
    </div>
  )
}

// ── Recipe quick-edit modal (BACK-2600) ────────────────────────────────────
// Lets the operator update a recipe's core fields without navigating away
// from Menu Builder. Heavier operations (recipe items, allergens, market
// variations) still live in the Recipes module — the modal links there.

interface RecipeFull {
  id: number
  name: string
  category_id: number | null
  description: string | null
  yield_qty: number
  yield_unit_text: string | null
  yield_unit_abbr?: string | null
  image_url: string | null
}

function RecipeQuickEditModal({
  recipeId, categories, onCategoryCreated, onClose, onSaved, api,
}: {
  recipeId: number
  categories: CategoryRow[]
  onCategoryCreated: (c: CategoryRow) => void
  onClose: () => void
  onSaved: () => void
  api: { post: (p: string, b: unknown) => Promise<unknown>; get: (p: string) => Promise<unknown>; put: (p: string, b: unknown) => Promise<unknown> }
}) {
  const [recipe, setRecipe] = useState<RecipeFull | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.get(`/recipes/${recipeId}`)
      .then((d) => setRecipe(d as RecipeFull))
      .catch(() => setError('Failed to load recipe'))
      .finally(() => setLoading(false))
  }, [api, recipeId])

  const submit = async () => {
    if (!recipe || !recipe.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    try {
      await api.put(`/recipes/${recipe.id}`, {
        name:            recipe.name.trim(),
        category_id:     recipe.category_id,
        description:     recipe.description,
        yield_qty:       recipe.yield_qty,
        yield_unit_text: recipe.yield_unit_text,
        image_url:       recipe.image_url,
      })
      onSaved()
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit recipe" onClose={onClose}>
      {loading || !recipe ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="space-y-3">
          <Field label="Image">
            <ImageUpload
              value={recipe.image_url}
              onChange={(url) => setRecipe({ ...recipe, image_url: url })}
              formKey="recipe"
            />
          </Field>
          <Field label="Name" required>
            <input className="input w-full" autoFocus
              value={recipe.name}
              onChange={(e) => setRecipe({ ...recipe, name: e.target.value })} />
          </Field>
          <Field label="Category">
            <CategoryPicker
              value={recipe.category_id != null ? String(recipe.category_id) : ''}
              onChange={(idStr) => setRecipe({ ...recipe, category_id: idStr ? Number(idStr) : null })}
              categories={categories}
              scope="for_recipes"
              onCategoryCreated={(c) => { onCategoryCreated(c); setRecipe({ ...recipe, category_id: c.id }) }}
              apiPost={(p, b) => api.post(p, b)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Yield qty">
              <CalcInput
                className="input w-full font-mono"
                value={String(recipe.yield_qty ?? 1)}
                onChange={(v) => setRecipe({ ...recipe, yield_qty: Number(v) || 1 })}
              />
            </Field>
            <Field label="Yield unit">
              <input className="input w-full text-sm"
                value={recipe.yield_unit_text || ''}
                onChange={(e) => setRecipe({ ...recipe, yield_unit_text: e.target.value || null })}
                placeholder="e.g. portion, kg, ea" />
            </Field>
          </div>
          <Field label="Description">
            <textarea className="input w-full" rows={2}
              value={recipe.description || ''}
              onChange={(e) => setRecipe({ ...recipe, description: e.target.value || null })} />
          </Field>
          <p className="text-[11px] text-text-3 italic">
            For ingredients, allergens, market variations, and full COGS — open this recipe in the Recipes module.
          </p>
          {error && <div className="text-xs text-rose-600 font-medium">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <a className="btn-ghost text-xs" href={`/recipes`} target="_blank" rel="noopener noreferrer">Open in Recipes ↗</a>
            <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={saving || !recipe.name.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Ingredient quick-edit modal (BACK-2600) ────────────────────────────────

interface IngredientFull {
  id: number
  name: string
  category_id: number | null
  base_unit_id: number | null
  base_unit_abbr?: string | null
  default_prep_unit: string | null
  default_prep_to_base_conversion: number | null
  notes: string | null
  image_url: string | null
  waste_pct: number | null
}

interface UnitRow { id: number; name: string; abbreviation: string | null }

function IngredientQuickEditModal({
  ingredientId, categories, onCategoryCreated, onClose, onSaved, api,
}: {
  ingredientId: number
  categories: CategoryRow[]
  onCategoryCreated: (c: CategoryRow) => void
  onClose: () => void
  onSaved: () => void
  api: { post: (p: string, b: unknown) => Promise<unknown>; get: (p: string) => Promise<unknown>; put: (p: string, b: unknown) => Promise<unknown> }
}) {
  const [ing, setIng] = useState<IngredientFull | null>(null)
  const [units, setUnits] = useState<UnitRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([
      api.get(`/ingredients/${ingredientId}`),
      api.get('/units'),
    ])
      .then(([i, u]) => { setIng(i as IngredientFull); setUnits((u as UnitRow[]) || []) })
      .catch(() => setError('Failed to load ingredient'))
      .finally(() => setLoading(false))
  }, [api, ingredientId])

  const submit = async () => {
    if (!ing || !ing.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError(null)
    try {
      await api.put(`/ingredients/${ing.id}`, {
        name:                            ing.name.trim(),
        category_id:                     ing.category_id,
        base_unit_id:                    ing.base_unit_id,
        default_prep_unit:               ing.default_prep_unit,
        default_prep_to_base_conversion: ing.default_prep_to_base_conversion,
        notes:                           ing.notes,
        image_url:                       ing.image_url,
        waste_pct:                       ing.waste_pct,
      })
      onSaved()
    } catch (err: unknown) {
      setError((err as { message?: string })?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Edit ingredient" onClose={onClose}>
      {loading || !ing ? (
        <div className="flex justify-center py-6"><Spinner /></div>
      ) : (
        <div className="space-y-3">
          <Field label="Image">
            <ImageUpload
              value={ing.image_url}
              onChange={(url) => setIng({ ...ing, image_url: url })}
              formKey="ingredient"
            />
          </Field>
          <Field label="Name" required>
            <input className="input w-full" autoFocus
              value={ing.name}
              onChange={(e) => setIng({ ...ing, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Category">
              <CategoryPicker
                value={ing.category_id != null ? String(ing.category_id) : ''}
                onChange={(idStr) => setIng({ ...ing, category_id: idStr ? Number(idStr) : null })}
                categories={categories}
                scope="for_ingredients"
                onCategoryCreated={(c) => { onCategoryCreated(c); setIng({ ...ing, category_id: c.id }) }}
                apiPost={(p, b) => api.post(p, b)}
              />
            </Field>
            <Field label="Base unit">
              <select className="input w-full text-sm"
                value={ing.base_unit_id ?? ''}
                onChange={(e) => setIng({ ...ing, base_unit_id: e.target.value ? Number(e.target.value) : null })}>
                <option value="">— Select —</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>{u.name}{u.abbreviation ? ` (${u.abbreviation})` : ''}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Default prep unit" hint="e.g. cup, tbsp">
              <input className="input w-full text-sm"
                value={ing.default_prep_unit || ''}
                onChange={(e) => setIng({ ...ing, default_prep_unit: e.target.value || null })} />
            </Field>
            <Field label="Prep → base conversion">
              <CalcInput
                className="input w-full font-mono"
                value={ing.default_prep_to_base_conversion == null ? '' : String(ing.default_prep_to_base_conversion)}
                onChange={(v) => setIng({ ...ing, default_prep_to_base_conversion: v === '' ? null : Number(v) })}
                placeholder="1"
              />
            </Field>
          </div>
          <Field label="Waste %" hint="0–100">
            <input className="input w-full text-sm font-mono" type="number" min={0} max={100} step={0.1}
              value={ing.waste_pct == null ? '' : ing.waste_pct}
              onChange={(e) => setIng({ ...ing, waste_pct: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Notes">
            <textarea className="input w-full" rows={2}
              value={ing.notes || ''}
              onChange={(e) => setIng({ ...ing, notes: e.target.value || null })} />
          </Field>
          <p className="text-[11px] text-text-3 italic">
            For price quotes, vendors, and allergens — open this ingredient in Inventory.
          </p>
          {error && <div className="text-xs text-rose-600 font-medium">{error}</div>}
          <div className="flex justify-end gap-2 pt-1">
            <a className="btn-ghost text-xs" href={`/inventory`} target="_blank" rel="noopener noreferrer">Open in Inventory ↗</a>
            <button className="btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="btn-primary" onClick={submit} disabled={saving || !ing.name.trim()}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Modifiers tab (Story 5 / BACK-2521) ────────────────────────────────────
// Shows currently attached modifier groups with detach + auto-show toggle.
// Two add actions: attach existing (multi-select catalog) or create new
// (inline form + immediate attach).

function ModifiersTab({
  allGroups, attached, loading,
  onDetach, onToggleAutoShow, onAttach, onCreated, onReorder, onOpenEditor,
}: {
  allGroups: ModifierGroup[]
  attached: AttachedModifierGroup[]
  loading: boolean
  onDetach: (modifier_group_id: number) => void | Promise<void>
  onToggleAutoShow: (modifier_group_id: number, autoShow: boolean) => void | Promise<void>
  onAttach: (toAttach: ModifierGroup[]) => void | Promise<void>
  onCreated: (newGroup: ModifierGroup) => void | Promise<void>
  /** BACK-2586 — reorder attached groups via drag-drop. */
  onReorder: (newOrder: AttachedModifierGroup[]) => void | Promise<void>
  /** BACK-2587 — click an attached group to open its editor in this same panel. */
  onOpenEditor: (modifier_group_id: number) => void
}) {
  // BACK-2586 — drag-drop reorder state for attached groups.
  const [dragId,    setDragId]    = useState<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)
  // BACK-2550 — flattened to a single screen. Two sections:
  //   (a) Currently attached  — detach + auto-show toggle
  //   (b) Available to attach — one-click row attach (no multi-select)
  // "Create new" still toggles its own form.
  const [creating, setCreating] = useState(false)
  const [search,   setSearch]   = useState('')

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>

  if (creating) {
    return (
      <CreateModifierGroupForm
        onCancel={() => setCreating(false)}
        onCreated={async (g) => { await onCreated(g); setCreating(false) }}
      />
    )
  }

  const attachedIds = new Set(attached.map(a => a.modifier_group_id))
  const q = search.trim().toLowerCase()
  const available = allGroups
    .filter(g => !attachedIds.has(g.id))
    .filter(g => !q || g.name.toLowerCase().includes(q))

  return (
    <div className="space-y-4">
      {/* Attached section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-text-2">Attached{attached.length > 0 && <span className="ml-1 font-mono text-text-3">({attached.length})</span>}</div>
          <button className="btn-primary text-xs px-2.5 py-1" onClick={() => setCreating(true)}>+ New group</button>
        </div>
        {attached.length === 0 ? (
          <div className="text-xs text-text-3 italic py-3 text-center border border-dashed border-border rounded-lg">No modifier groups attached. Click any row below to attach.</div>
        ) : (
          <ul className="space-y-2">
            {attached.map(g => (
              <li
                key={g.modifier_group_id}
                draggable
                onDragStart={() => setDragId(g.modifier_group_id)}
                onDragOver={(e) => { e.preventDefault(); setDragOverId(g.modifier_group_id) }}
                onDragLeave={() => setDragOverId(null)}
                onDrop={() => {
                  if (dragId !== null && dragId !== g.modifier_group_id) {
                    const fromIdx = attached.findIndex(a => a.modifier_group_id === dragId)
                    const toIdx   = attached.findIndex(a => a.modifier_group_id === g.modifier_group_id)
                    if (fromIdx >= 0 && toIdx >= 0) {
                      const next = [...attached]
                      const [m] = next.splice(fromIdx, 1)
                      next.splice(toIdx, 0, m)
                      onReorder(next.map((a, i) => ({ ...a, sort_order: i })))
                    }
                  }
                  setDragId(null); setDragOverId(null)
                }}
                onDragEnd={() => { setDragId(null); setDragOverId(null) }}
                className={`rounded-lg border px-3 py-2.5 bg-surface-2/30 cursor-grab active:cursor-grabbing transition-colors ${
                  dragOverId === g.modifier_group_id && dragId !== g.modifier_group_id ? 'border-accent border-t-2' : 'border-border'
                } ${dragId === g.modifier_group_id ? 'opacity-40' : ''}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="min-w-0 text-left flex-1 cursor-pointer hover:text-accent"
                    onClick={() => onOpenEditor(g.modifier_group_id)}
                    title="Edit group (settings + options)"
                  >
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                      <span className="text-text-3 text-[10px]">⠿</span>
                      {g.name}
                      <span className="ml-auto text-accent text-[10px] font-normal">Edit ›</span>
                    </div>
                    <div className="text-[11px] text-text-3 mt-0.5">
                      Pick {g.min_select === g.max_select ? `${g.min_select}` : `${g.min_select}–${g.max_select}`}
                    </div>
                  </button>
                  <button
                    className="text-text-3 hover:text-red-600 text-xs px-2 shrink-0"
                    onClick={(e) => { e.stopPropagation(); onDetach(g.modifier_group_id) }}
                    title="Detach (does not delete the group)"
                  >Detach</button>
                </div>
                <label className="flex items-center gap-2 mt-2 text-[11px] text-text-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={g.auto_show}
                    onChange={(e) => onToggleAutoShow(g.modifier_group_id, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  Show inline (un-tick to hide behind a button)
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Available section — one-click attach */}
      <div className="pt-3 border-t border-border">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-text-2">Available{allGroups.length - attached.length > 0 && <span className="ml-1 font-mono text-text-3">({allGroups.length - attached.length})</span>}</div>
        </div>
        {allGroups.length === 0 ? (
          <div className="text-xs text-text-3 italic py-3 text-center">No modifier groups in the catalog. Use <strong>+ New group</strong> to create one.</div>
        ) : available.length === 0 && !search ? (
          <div className="text-xs text-text-3 italic py-3 text-center">All groups already attached.</div>
        ) : (
          <>
            {allGroups.length > 6 && (
              <input
                className="input w-full mb-2"
                placeholder="Search groups…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            )}
            {available.length === 0 ? (
              <div className="text-xs text-text-3 italic py-3 text-center">No matches.</div>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {available.map(g => (
                  <li key={g.id}>
                    <button
                      type="button"
                      className="w-full text-left px-2.5 py-2 hover:bg-accent-dim/40 flex items-center gap-2"
                      onClick={() => onAttach([g])}
                      title="Click to attach"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-text-1 truncate">{g.name}</div>
                        <div className="text-[11px] text-text-3">
                          Pick {g.min_select === g.max_select ? `${g.min_select}` : `${g.min_select}–${g.max_select}`}
                          {g.option_count != null ? ` · ${g.option_count} option${g.option_count === 1 ? '' : 's'}` : ''}
                        </div>
                      </div>
                      <span className="text-[10px] text-accent font-semibold shrink-0">+ Attach</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// AttachExistingMods removed in BACK-2550 — replaced by inline click-to-attach
// list inside ModifiersTab.

function CreateModifierGroupForm({
  onCancel, onCreated,
}: {
  onCancel: () => void
  onCreated: (g: ModifierGroup) => void | Promise<void>
}) {
  const api = useApi()
  const [name,         setName]         = useState('')
  const [minSelect,    setMinSelect]    = useState('0')
  const [maxSelect,    setMaxSelect]    = useState('1')
  const [allowRepeat,  setAllowRepeat]  = useState(false)
  const [autoShow,     setAutoShow]     = useState(true)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!name.trim()) { setError('Name required'); return }
    const min = Math.max(0, Math.floor(Number(minSelect) || 0))
    const max = Math.max(min, Math.floor(Number(maxSelect) || min || 1))
    setSaving(true)
    try {
      const g = await api.post('/modifier-groups', {
        name: name.trim(),
        min_select: min,
        max_select: max,
        allow_repeat_selection: allowRepeat,
        default_auto_show: autoShow,
      }) as ModifierGroup
      await onCreated(g)
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to create modifier group'
      setError(msg)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="text-text-3 hover:text-text-1 text-xs" onClick={onCancel}>← Back</button>
        <div className="text-xs font-semibold text-text-2">Create new modifier group</div>
      </div>

      <Field label="Name" required>
        <input
          className="input w-full"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Flavour Choice"
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Min select">
          <input
            className="input w-full font-mono"
            type="number"
            min={0}
            value={minSelect}
            onChange={e => setMinSelect(e.target.value)}
          />
        </Field>
        <Field label="Max select">
          <input
            className="input w-full font-mono"
            type="number"
            min={1}
            value={maxSelect}
            onChange={e => setMaxSelect(e.target.value)}
          />
        </Field>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
        <input type="checkbox" checked={allowRepeat} onChange={e => setAllowRepeat(e.target.checked)} />
        Allow the same option to be picked multiple times (e.g. extra cheese ×2)
      </label>

      <label className="flex items-center gap-2 text-xs text-text-2 cursor-pointer">
        <input type="checkbox" checked={autoShow} onChange={e => setAutoShow(e.target.checked)} />
        Show inline by default (vs. behind a button)
      </label>

      <p className="text-[11px] text-text-3 italic">
        Options live in the Sales Items module — once the group exists, edit options there. (Inline option editor coming.)
      </p>

      {error && <div className="text-xs text-rose-600 font-medium">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost text-xs" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary text-xs"
          disabled={saving || !name.trim()}
          onClick={submit}
        >{saving ? 'Creating…' : 'Create & attach'}</button>
      </div>
    </div>
  )
}

// ── Combo builder form (Story 4 / BACK-2520) ───────────────────────────────
// Inline MVP — captures combo header + N steps + per-step options in a single
// scrolling form, then fires the multi-step POST sequence on save. Per-option
// modifier groups are deferred to a follow-up.

interface DraftOption {
  id: string  // local-only client id for React keys
  name: string
  item_type: 'recipe' | 'ingredient' | 'manual'
  recipe_id: number | null
  ingredient_id: number | null
  recipeSearch: string
  ingredientSearch: string
  manual_cost: string
  price_addon: string
  qty: string
}

interface DraftStep {
  id: string  // local-only client id
  name: string
  min_select: string
  max_select: string
  allow_repeat: boolean
  auto_select: boolean
  options: DraftOption[]
}

let comboDraftIdSeq = 0
const nextDraftId = () => `d${++comboDraftIdSeq}`

function blankOption(): DraftOption {
  return {
    id: nextDraftId(),
    name: '',
    item_type: 'recipe',
    recipe_id: null,
    ingredient_id: null,
    recipeSearch: '',
    ingredientSearch: '',
    manual_cost: '',
    price_addon: '0',
    qty: '1',
  }
}

function blankStep(): DraftStep {
  return {
    id: nextDraftId(),
    name: '',
    min_select: '1',
    max_select: '1',
    allow_repeat: false,
    auto_select: false,
    options: [blankOption()],
  }
}

function ComboBuilderForm({
  categories, onCategoryCreated, onSave,
}: {
  categories: CategoryRow[]
  onCategoryCreated: (c: CategoryRow) => void
  onSave: (def: ComboDef) => void | Promise<void>
}) {
  const api = useApi()
  const [name,        setName]        = useState('')
  const [categoryId,  setCategoryId]  = useState('')
  const [description, setDescription] = useState('')
  const [imageUrl,    setImageUrl]    = useState<string | null>(null)
  const [steps,       setSteps]       = useState<DraftStep[]>([blankStep()])
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  // Recipe + ingredient catalogs for option pickers — load lazily and share
  // across all steps / options inside this form instance.
  const [recipes,     setRecipes]     = useState<RecipeRow[] | null>(null)
  const [ingredients, setIngredients] = useState<IngredientRow[] | null>(null)
  useEffect(() => {
    api.get('/recipes').then((d: RecipeRow[]) => setRecipes(d || [])).catch(() => setRecipes([]))
    api.get('/ingredients').then((d: IngredientRow[]) => setIngredients(d || [])).catch(() => setIngredients([]))
  }, [api])

  const addStep = () => setSteps(prev => [...prev, blankStep()])
  const removeStep = (id: string) => setSteps(prev => prev.filter(s => s.id !== id))
  const updateStep = (id: string, patch: Partial<DraftStep>) => setSteps(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  const addOption = (stepId: string) => updateStep(stepId, { options: [...(steps.find(s => s.id === stepId)?.options || []), blankOption()] })
  const removeOption = (stepId: string, optId: string) => {
    const s = steps.find(x => x.id === stepId); if (!s) return
    updateStep(stepId, { options: s.options.filter(o => o.id !== optId) })
  }
  const updateOption = (stepId: string, optId: string, patch: Partial<DraftOption>) => {
    const s = steps.find(x => x.id === stepId); if (!s) return
    updateStep(stepId, { options: s.options.map(o => o.id === optId ? { ...o, ...patch } : o) })
  }

  // Validate + transform draft state into the shape the server expects.
  const validate = (): ComboDef | string => {
    if (!name.trim()) return 'Combo name is required'
    if (steps.length === 0) return 'At least one step is required'
    const out: ComboDef = {
      name: name.trim(),
      category_id: categoryId ? Number(categoryId) : null,
      description: description.trim() || null,
      image_url: imageUrl || null,
      steps: [],
    }
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]
      if (!s.name.trim()) return `Step ${i + 1}: name is required`
      const min = Math.max(0, Math.floor(Number(s.min_select) || 0))
      const max = Math.max(min || 1, Math.floor(Number(s.max_select) || 1))
      if (s.options.length === 0) return `Step ${i + 1} (${s.name}): at least one option is required`
      const outOpts: ComboDef['steps'][number]['options'] = []
      for (let j = 0; j < s.options.length; j++) {
        const o = s.options[j]
        if (!o.name.trim()) return `Step ${i + 1} option ${j + 1}: name is required`
        if (o.item_type === 'recipe' && !o.recipe_id) return `Step ${i + 1} option “${o.name}”: pick a recipe`
        if (o.item_type === 'ingredient' && !o.ingredient_id) return `Step ${i + 1} option “${o.name}”: pick an ingredient`
        const cost = o.item_type === 'manual'
          ? (o.manual_cost === '' ? null : Number(o.manual_cost))
          : null
        if (o.item_type === 'manual' && o.manual_cost !== '' && !Number.isFinite(cost)) {
          return `Step ${i + 1} option “${o.name}”: manual cost must be a number`
        }
        outOpts.push({
          name:          o.name.trim(),
          item_type:     o.item_type,
          recipe_id:     o.item_type === 'recipe'     ? o.recipe_id     : null,
          ingredient_id: o.item_type === 'ingredient' ? o.ingredient_id : null,
          manual_cost:   o.item_type === 'manual'     ? cost            : null,
          price_addon:   Number(o.price_addon) || 0,
          qty:           Number(o.qty) || 1,
        })
      }
      out.steps.push({
        name: s.name.trim(),
        min_select: min,
        max_select: max,
        allow_repeat: s.allow_repeat,
        auto_select: s.auto_select,
        options: outOpts,
      })
    }
    return out
  }

  const submit = async () => {
    setError(null)
    const v = validate()
    if (typeof v === 'string') { setError(v); return }
    setSaving(true)
    try {
      await onSave(v)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Combo name" required>
        <input
          className="input w-full"
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Chicken Combo Meal"
        />
      </Field>

      <Field label="Category">
        <CategoryPicker
          value={categoryId}
          onChange={setCategoryId}
          categories={categories}
          scope="for_sales_items"
          onCategoryCreated={(c) => {
            onCategoryCreated(c)
            setCategoryId(String(c.id))
          }}
          apiPost={(p, b) => api.post(p, b)}
        />
      </Field>

      <Field label="Image">
        <ImageUpload value={imageUrl} onChange={setImageUrl} formKey="combo" />
      </Field>

      <Field label="Description">
        <textarea className="input w-full" rows={2} value={description} onChange={e => setDescription(e.target.value)} />
      </Field>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-text-2">Steps</div>
          <button type="button" className="btn-ghost text-xs" onClick={addStep}>+ Add step</button>
        </div>

        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={s.id} className="rounded-lg border border-border bg-surface-2/30 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-text-3 shrink-0">#{i + 1}</span>
                <input
                  className="input flex-1 text-sm"
                  value={s.name}
                  onChange={e => updateStep(s.id, { name: e.target.value })}
                  placeholder="Step name (e.g. Pick a side)"
                />
                {steps.length > 1 && (
                  <button
                    className="text-text-3 hover:text-red-600 text-xs px-2 shrink-0"
                    onClick={() => removeStep(s.id)}
                  >Remove</button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Min">
                  <input
                    className="input w-full font-mono text-sm"
                    type="number"
                    min={0}
                    value={s.min_select}
                    onChange={e => updateStep(s.id, { min_select: e.target.value })}
                  />
                </Field>
                <Field label="Max">
                  <input
                    className="input w-full font-mono text-sm"
                    type="number"
                    min={1}
                    value={s.max_select}
                    onChange={e => updateStep(s.id, { max_select: e.target.value })}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-3 text-[11px] text-text-2">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={s.allow_repeat} onChange={e => updateStep(s.id, { allow_repeat: e.target.checked })} />
                  Allow repeats
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={s.auto_select} onChange={e => updateStep(s.id, { auto_select: e.target.checked })} />
                  Auto-advance when single option
                </label>
              </div>

              <div className="pt-1 border-t border-border/60">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-[11px] font-semibold text-text-2">Options</div>
                  <button type="button" className="text-accent text-[11px] hover:underline" onClick={() => addOption(s.id)}>+ Add option</button>
                </div>
                <div className="space-y-2">
                  {s.options.map((o, oi) => (
                    <ComboOptionEditor
                      key={o.id}
                      option={o}
                      index={oi}
                      recipes={recipes}
                      ingredients={ingredients}
                      onPatch={(patch) => updateOption(s.id, o.id, patch)}
                      onRemove={s.options.length > 1 ? () => removeOption(s.id, o.id) : null}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-text-3 italic">
        Per-option modifier groups (e.g. flavour choice on each wing option) come in a follow-up. For now you can attach modifier groups to the whole combo from its sales-item edit panel after save.
      </p>

      {error && <div className="text-xs text-rose-600 font-medium">{error}</div>}

      <div className="flex justify-end gap-2 pt-1">
        <button
          className="btn-primary"
          disabled={saving || !name.trim()}
          onClick={submit}
        >{saving ? 'Saving…' : 'Create combo & add to menu'}</button>
      </div>
    </div>
  )
}

function ComboOptionEditor({
  option, index, recipes, ingredients, onPatch, onRemove,
}: {
  option: DraftOption
  index: number
  recipes: RecipeRow[] | null
  ingredients: IngredientRow[] | null
  onPatch: (patch: Partial<DraftOption>) => void
  onRemove: (() => void) | null
}) {
  const filteredRecipes = useMemo(() => {
    const q = option.recipeSearch.trim().toLowerCase()
    const list = recipes || []
    if (!q) return list.slice(0, 12)
    return list.filter(r => r.name.toLowerCase().includes(q)).slice(0, 12)
  }, [recipes, option.recipeSearch])

  const filteredIngredients = useMemo(() => {
    const q = option.ingredientSearch.trim().toLowerCase()
    const list = ingredients || []
    if (!q) return list.slice(0, 12)
    return list.filter(i => i.name.toLowerCase().includes(q)).slice(0, 12)
  }, [ingredients, option.ingredientSearch])

  return (
    <div className="rounded-md border border-border bg-surface px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-3 shrink-0 font-mono">{index + 1}.</span>
        <input
          className="input flex-1 text-xs"
          value={option.name}
          onChange={e => onPatch({ name: e.target.value })}
          placeholder="Option label (e.g. Fries)"
        />
        {onRemove && (
          <button
            className="text-text-3 hover:text-red-600 text-[11px] shrink-0"
            onClick={onRemove}
            title="Remove option"
          >✕</button>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px]">
        {(['recipe', 'ingredient', 'manual'] as const).map(t => (
          <label key={t} className="flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name={`opt-type-${option.id}`}
              checked={option.item_type === t}
              onChange={() => onPatch({ item_type: t, recipe_id: null, ingredient_id: null })}
            />
            <span className="capitalize">{t}</span>
          </label>
        ))}
      </div>

      {option.item_type === 'recipe' && (
        <div>
          <input
            className="input w-full text-xs"
            value={option.recipeSearch}
            onChange={e => onPatch({ recipeSearch: e.target.value, recipe_id: null })}
            placeholder="Search recipe…"
          />
          {option.recipeSearch && !option.recipe_id && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border">
              {filteredRecipes.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredRecipes.map(r => (
                <button
                  key={r.id}
                  type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => onPatch({ recipe_id: r.id, recipeSearch: r.name, name: option.name || r.name })}
                >{r.name}</button>
              ))}
            </div>
          )}
          {option.recipe_id && (
            <div className="text-[10px] text-accent mt-0.5">✓ Linked: recipe #{option.recipe_id}</div>
          )}
        </div>
      )}

      {option.item_type === 'ingredient' && (
        <div>
          <input
            className="input w-full text-xs"
            value={option.ingredientSearch}
            onChange={e => onPatch({ ingredientSearch: e.target.value, ingredient_id: null })}
            placeholder="Search ingredient…"
          />
          {option.ingredientSearch && !option.ingredient_id && (
            <div className="mt-1 max-h-40 overflow-y-auto rounded border border-border">
              {filteredIngredients.length === 0 ? (
                <div className="text-[11px] text-text-3 italic px-2 py-1.5">No matches.</div>
              ) : filteredIngredients.map(i => (
                <button
                  key={i.id}
                  type="button"
                  className="block w-full text-left text-xs px-2 py-1 hover:bg-surface-2"
                  onClick={() => onPatch({ ingredient_id: i.id, ingredientSearch: i.name, name: option.name || i.name })}
                >{i.name} <span className="text-text-3">{i.base_unit_abbr}</span></button>
              ))}
            </div>
          )}
          {option.ingredient_id && (
            <div className="text-[10px] text-accent mt-0.5">✓ Linked: ingredient #{option.ingredient_id}</div>
          )}
        </div>
      )}

      {option.item_type === 'manual' && (
        <div>
          <input
            className="input w-full text-xs font-mono"
            value={option.manual_cost}
            onChange={e => onPatch({ manual_cost: e.target.value })}
            placeholder="Manual cost (e.g. 0.25)"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[10px] text-text-3">
          <span className="block">Price add-on</span>
          <input
            className="input w-full text-xs font-mono"
            value={option.price_addon}
            onChange={e => onPatch({ price_addon: e.target.value })}
            placeholder="0"
          />
        </label>
        <label className="text-[10px] text-text-3">
          <span className="block">Qty</span>
          <input
            className="input w-full text-xs font-mono"
            value={option.qty}
            onChange={e => onPatch({ qty: e.target.value })}
            placeholder="1"
          />
        </label>
      </div>
    </div>
  )
}

// MarketsTab removed in BACK-2549 — sales-item market visibility is managed
// from the Sales Items page only. The Country / SalesItemMarket interfaces
// remain exported above for any future feature that needs them.
