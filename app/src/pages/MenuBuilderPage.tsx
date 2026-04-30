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
import { PageHeader, Spinner, EmptyState, Field, Toast, PepperHelpButton, CalcInput, CategoryPicker } from '../components/ui'
import ImageUpload from '../components/ImageUpload'

// ── Types ───────────────────────────────────────────────────────────────────

interface Menu {
  id: number
  name: string
  country_id: number
  country_name: string
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

interface Country {
  id: number
  name: string
  currency_code: string
  currency_symbol: string
}

interface TaxRate {
  id: number
  country_id: number
  name: string
  rate_percent: number
  is_default: boolean
}

interface SalesItemMarket {
  sales_item_id: number
  country_id: number
  is_active: boolean
  country_name: string
}

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
}

interface CategoryRow {
  id: number
  name: string
  for_sales_items?: boolean
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

  // Edit-item side panel (Story 6 — click an item to open Pricing / Markets)
  const [editingMsi,   setEditingMsi]   = useState<MenuSalesItem | null>(null)
  // Tax rates filtered to the selected menu's country, lazy-loaded.
  const [taxRates,     setTaxRates]     = useState<TaxRate[]>([])
  // All countries — used by the markets tab and by the user-RBAC scope.
  const [countries,    setCountries]    = useState<Country[]>([])

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
    if (!panelOpen && !editingMsi) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (panelOpen) setPanelOpen(false)
        if (editingMsi) setEditingMsi(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panelOpen, editingMsi])

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

  // Story 6 — load tax rates for the active menu's country, and all countries
  // for the markets tab. Lazy on selectedMenu change so we don't pay the cost
  // before the user opens the edit panel.
  useEffect(() => {
    if (!selectedMenu) return
    api.get(`/tax-rates?country_id=${selectedMenu.country_id}`)
      .then((d: TaxRate[]) => setTaxRates(d || []))
      .catch(() => setTaxRates([]))
  }, [api, selectedMenu])

  useEffect(() => {
    api.get('/countries')
      .then((d: Country[]) => setCountries(d || []))
      .catch(() => setCountries([]))
  }, [api])

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
              <button
                className="btn-primary"
                onClick={() => { setEditingMsi(null); setAddMode('search'); setPanelOpen(true) }}
                disabled={!selectedMenu}
              >+ Add item</button>
            </div>

            {/* ── Items list ── */}
            <div className="flex-1 overflow-y-auto bg-surface-2/40">
              {!selectedMenu ? (
                <div className="p-8 text-center text-text-3 text-sm">Pick a menu above.</div>
              ) : itemsLoading ? (
                <div className="flex justify-center p-12"><Spinner /></div>
              ) : items.length === 0 ? (
                <div className="p-8 text-center text-text-3 text-sm">
                  No items on this menu yet. Click <strong>+ Add item</strong> to start.
                </div>
              ) : (
                <ul className="divide-y divide-border bg-surface">
                  {items.map(it => {
                    const overridden = it.has_price_override
                    const selected = editingMsi?.id === it.id
                    return (
                      <li
                        key={it.id}
                        className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                          selected ? 'bg-accent-dim/50 border-l-2 border-accent' : 'hover:bg-surface-2/60'
                        }`}
                        onClick={() => { setPanelOpen(false); setEditingMsi(it) }}
                      >
                        {/* Type badge */}
                        <span
                          className={`shrink-0 w-6 h-6 rounded text-[11px] font-bold flex items-center justify-center ${TYPE_BADGE[it.item_type].cls}`}
                          title={TYPE_LABELS[it.item_type]}
                        >{TYPE_BADGE[it.item_type].label}</span>

                        {/* Image thumb if any */}
                        {it.si_image_url ? (
                          <img src={it.si_image_url} alt="" className="shrink-0 w-10 h-10 rounded object-cover border border-border" />
                        ) : (
                          <div className="shrink-0 w-10 h-10 rounded bg-surface-2 border border-border" />
                        )}

                        {/* Name + meta */}
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm text-text-1 truncate">
                            {it.sales_item_name}
                            {overridden && (
                              <span className="ml-2 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded" title="At least one price level has a per-menu override">price override</span>
                            )}
                          </div>
                          <div className="text-xs text-text-3 truncate">
                            {it.category || 'Uncategorised'} · {TYPE_LABELS[it.item_type]}
                            {it.qty !== 1 ? ` · qty ${it.qty}` : ''}
                          </div>
                        </div>

                        {/* Remove */}
                        <button
                          className="text-text-3 hover:text-red-600 text-xs px-2"
                          onClick={(e) => { e.stopPropagation(); removeItem(it) }}
                          title="Remove from menu (does not delete the sales item)"
                        >Remove</button>
                      </li>
                    )
                  })}
                </ul>
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

          {/* ── Edit-item side panel (Story 6) ── */}
          {editingMsi && selectedMenu && !panelOpen && (
            <EditItemPanel
              key={editingMsi.id}
              menu={selectedMenu}
              msi={editingMsi}
              taxRates={taxRates}
              countries={countries}
              width={panelWidth}
              onResize={setPanelWidth}
              onChanged={() => loadItems(selectedMenu.id)}
              onClose={() => setEditingMsi(null)}
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

// ── Shared bits ─────────────────────────────────────────────────────────────

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
          <div className="text-[10px] uppercase tracking-wide text-text-3 font-semibold">{menu.name} <span className="text-text-3/60">›</span> Add item</div>
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
          />
        ) : (
          <CreateNewTab
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
  search, setSearch, results, loading, onPick,
}: {
  search: string
  setSearch: (s: string) => void
  results: SalesItemRow[]
  loading: boolean
  onPick: (si: SalesItemRow) => void | Promise<void>
}) {
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
        <div className="text-xs text-text-3 italic py-6 text-center">
          {search ? 'No matches.' : 'No sales items in the catalog yet — switch to “Create new”.'}
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
  catalog, categories, onCategoryCreated, onAttachExisting, onCreateAndAttach, onCreateComboAndAttach, onAskReuse, onCancel,
}: {
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
        <div className="text-xs font-semibold text-text-2 mb-2">Type</div>
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
  mode, catalog, onAttachExisting, onCreateAndAttach, onAskReuse,
}: {
  mode: 'recipe' | 'ingredient'
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

  // Lazy-load whichever catalog matches the active mode. Cached locally so
  // flipping between recipe ↔ ingredient doesn't refetch.
  useEffect(() => {
    if (mode === 'recipe' && recipes === null) {
      setLoading(true)
      api.get('/recipes')
        .then((d: RecipeRow[]) => setRecipes(d || []))
        .catch(() => setRecipes([]))
        .finally(() => setLoading(false))
    } else if (mode === 'ingredient' && ingredients === null) {
      setLoading(true)
      api.get('/ingredients')
        .then((d: IngredientRow[]) => setIngredients(d || []))
        .catch(() => setIngredients([]))
        .finally(() => setLoading(false))
    }
  }, [api, mode, recipes, ingredients])

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
            return (
              <li
                key={row.id}
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
                    {mode === 'ingredient' && 'base_unit_abbr' in row && row.base_unit_abbr && (
                      <> · {row.base_unit_abbr}</>
                    )}
                  </div>
                </div>
                {exists && (
                  <span className="shrink-0 text-[10px] font-semibold text-accent bg-accent-dim/60 px-1.5 py-0.5 rounded" title="Already wrapped by an existing sales item — picking will reuse it">in catalog</span>
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
  menu, msi, taxRates, countries, width, onResize, onChanged, onClose, onToast,
}: {
  menu: Menu
  msi: MenuSalesItem
  taxRates: TaxRate[]
  countries: Country[]
  width: number
  onResize: (w: number) => void
  onChanged: () => void
  onClose: () => void
  onToast: (t: { message: string; type?: 'success' | 'error' }) => void
}) {
  const api = useApi()
  type EditTab = 'pricing' | 'markets' | 'modifiers'
  const [tab,    setTab]    = useState<EditTab>('pricing')
  const [prices, setPrices] = useState<MenuItemPrice[]>(msi.prices || [])
  const [markets, setMarkets] = useState<SalesItemMarket[]>([])
  const [marketsLoading, setMarketsLoading] = useState(false)
  const [savingPriceLevels, setSavingPriceLevels] = useState<Set<number>>(new Set())
  // Story 5 — modifier groups
  const [allModGroups,    setAllModGroups]    = useState<ModifierGroup[]>([])
  const [attachedGroups,  setAttachedGroups]  = useState<AttachedModifierGroup[]>([])
  const [modsLoading,     setModsLoading]     = useState(false)

  // Load fresh pricing on open — the catalog row may be slightly stale.
  useEffect(() => {
    api.get(`/menu-sales-items/${msi.id}/price-diff`)
      .then((d: { price_level_id: number; price_level_name: string; default_price: number | null; menu_price: number | null; is_overridden: boolean }[]) => {
        // Map price-diff response into the MenuItemPrice shape our UI uses.
        // The diff endpoint only returns price-level meta + numbers, not row
        // ids — we treat it as the source of truth on open and patch back
        // through PUT /menu-sales-items/:id/prices on save.
        setPrices(d.map((row) => ({
          id: 0,
          menu_sales_item_id: msi.id,
          price_level_id:    row.price_level_id,
          price_level_name:  row.price_level_name,
          sell_price:        row.menu_price ?? row.default_price ?? 0,
          default_price:     row.default_price,
          is_overridden:     row.is_overridden,
          tax_rate_id:       null,  // tax-rate edits handled separately
        })))
      })
      .catch(() => { /* fall back to msi.prices already in state */ })
  }, [api, msi.id])

  // Load markets on first switch to the markets tab.
  useEffect(() => {
    if (tab !== 'markets' || markets.length) return
    setMarketsLoading(true)
    api.get(`/sales-items/${msi.sales_item_id}`)
      .then((si: { markets?: SalesItemMarket[] }) => setMarkets(si.markets || []))
      .catch(() => setMarkets([]))
      .finally(() => setMarketsLoading(false))
  }, [api, tab, msi.sales_item_id, markets.length])

  // Story 5 — load modifier-group catalog + currently attached groups on
  // first switch to the modifiers tab. Both refresh after every save so the
  // attached list reflects server state.
  const loadMods = useCallback(async () => {
    setModsLoading(true)
    try {
      const [catalog, full] = await Promise.all([
        api.get('/modifier-groups') as Promise<ModifierGroup[]>,
        api.get(`/sales-items/${msi.sales_item_id}`) as Promise<{ modifier_groups?: AttachedModifierGroup[] }>,
      ])
      setAllModGroups(catalog || [])
      setAttachedGroups(full?.modifier_groups || [])
    } catch {
      // surfaced via empty state
    } finally {
      setModsLoading(false)
    }
  }, [api, msi.sales_item_id])

  useEffect(() => {
    if (tab !== 'modifiers' || allModGroups.length) return
    loadMods()
  }, [tab, allModGroups.length, loadMods])

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

  // Save a single price row (ON CONFLICT upsert server-side).
  const savePrice = async (p: MenuItemPrice, newSell: number) => {
    setSavingPriceLevels(prev => new Set(prev).add(p.price_level_id))
    try {
      await api.put(`/menu-sales-items/${msi.id}/prices`, {
        price_level_id: p.price_level_id,
        sell_price:     newSell,
        tax_rate_id:    p.tax_rate_id,
      })
      // Optimistic update
      setPrices(prev => prev.map(x =>
        x.price_level_id === p.price_level_id
          ? { ...x, sell_price: newSell, is_overridden: x.default_price !== null && newSell !== x.default_price }
          : x
      ))
      onChanged()
      onToast({ message: 'Price saved', type: 'success' })
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message || 'Failed to save price'
      onToast({ message: msg, type: 'error' })
    } finally {
      setSavingPriceLevels(prev => {
        const next = new Set(prev); next.delete(p.price_level_id); return next
      })
    }
  }

  // Toggle a country's active flag for this sales item. Auto-save.
  // The PUT /sales-items/:id/markets endpoint takes { country_ids: [...] } —
  // the FULL list of currently-active country IDs (everything else is set to
  // inactive on the server side).
  const toggleMarket = async (countryId: number, checked: boolean) => {
    const previousMarkets = markets
    // Compute the next list optimistically
    const nextMarkets = (() => {
      const existing = markets.find(m => m.country_id === countryId)
      if (existing) return markets.map(m => m.country_id === countryId ? { ...m, is_active: checked } : m)
      const country = countries.find(c => c.id === countryId)
      return [...markets, { sales_item_id: msi.sales_item_id, country_id: countryId, is_active: checked, country_name: country?.name || '' }]
    })()
    setMarkets(nextMarkets)
    try {
      const activeIds = nextMarkets.filter(m => m.is_active).map(m => m.country_id)
      await api.put(`/sales-items/${msi.sales_item_id}/markets`, { country_ids: activeIds })
    } catch (err: unknown) {
      // Rollback
      setMarkets(previousMarkets)
      const msg = (err as { message?: string })?.message || 'Failed to update market visibility'
      onToast({ message: msg, type: 'error' })
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

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${tab === 'pricing' ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-1'}`}
          onClick={() => setTab('pricing')}
        >Pricing</button>
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${tab === 'markets' ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-1'}`}
          onClick={() => setTab('markets')}
        >Markets</button>
        <button
          className={`flex-1 px-3 py-2 text-xs font-semibold transition-colors ${tab === 'modifiers' ? 'text-accent border-b-2 border-accent' : 'text-text-3 hover:text-text-1'}`}
          onClick={() => setTab('modifiers')}
        >Modifiers{attachedGroups.length > 0 && <span className="ml-1 text-[10px] text-text-3 font-mono">({attachedGroups.length})</span>}</button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'pricing' ? (
          <PricingTab
            menu={menu}
            prices={prices}
            taxRates={taxRates}
            saving={savingPriceLevels}
            onSave={savePrice}
            onTaxChange={(p, taxId) => {
              setPrices(prev => prev.map(x => x.price_level_id === p.price_level_id ? { ...x, tax_rate_id: taxId } : x))
              savePrice({ ...p, tax_rate_id: taxId }, p.sell_price)
            }}
          />
        ) : tab === 'markets' ? (
          <MarketsTab
            countries={countries}
            markets={markets}
            loading={marketsLoading}
            onToggle={toggleMarket}
          />
        ) : (
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
          />
        )}
      </div>
    </aside>
  )
}

function PricingTab({
  menu, prices, taxRates, saving, onSave, onTaxChange,
}: {
  menu: Menu
  prices: MenuItemPrice[]
  taxRates: TaxRate[]
  saving: Set<number>
  onSave: (p: MenuItemPrice, newSell: number) => void
  onTaxChange: (p: MenuItemPrice, taxId: number | null) => void
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-3 italic">
        Per-menu price overrides are saved to <code className="text-[10px]">mcogs_menu_sales_item_prices</code>. Defaults come from the sales-item catalog. Reset clears the override.
      </p>
      {prices.length === 0 ? (
        <div className="text-xs text-text-3 italic py-4 text-center">No price levels configured.</div>
      ) : (
        <ul className="space-y-2">
          {prices.map(p => (
            <PriceLevelRow
              key={p.price_level_id}
              menu={menu}
              price={p}
              taxRates={taxRates}
              saving={saving.has(p.price_level_id)}
              onSave={(v) => onSave(p, v)}
              onTaxChange={(taxId) => onTaxChange(p, taxId)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function PriceLevelRow({
  menu, price, taxRates, saving, onSave, onTaxChange,
}: {
  menu: Menu
  price: MenuItemPrice
  taxRates: TaxRate[]
  saving: boolean
  onSave: (newSell: number) => void
  onTaxChange: (taxId: number | null) => void
}) {
  const [draft, setDraft] = useState<string>(String(price.sell_price ?? 0))
  // Reset draft when the underlying price changes (e.g. after a save)
  useEffect(() => { setDraft(String(price.sell_price ?? 0)) }, [price.sell_price])

  const dirty = Number(draft) !== Number(price.sell_price)

  return (
    <li className="rounded-lg border border-border px-3 py-2.5 bg-surface-2/30">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-text-2">{price.price_level_name}</div>
        {price.is_overridden && (
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded" title={`Default: ${menu.country_name} ${price.default_price ?? '—'}`}>override</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <CalcInput
          className="input flex-1 font-mono text-sm"
          value={draft}
          onChange={setDraft}
        />
        <select
          className="input text-xs w-28"
          value={price.tax_rate_id ?? ''}
          onChange={(e) => onTaxChange(e.target.value ? Number(e.target.value) : null)}
          title="Tax rate"
        >
          <option value="">No tax</option>
          {taxRates.map(t => (
            <option key={t.id} value={t.id}>{t.name} {t.rate_percent}%</option>
          ))}
        </select>
        <button
          className="btn-primary text-xs px-3 py-1.5"
          disabled={!dirty || saving}
          onClick={() => onSave(Number(draft))}
        >{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {price.default_price !== null && (
        <div className="text-[10px] text-text-3 mt-1.5 flex items-center gap-2">
          <span>Default: <span className="font-mono">{price.default_price}</span></span>
          {price.is_overridden && (
            <button
              className="text-accent hover:underline"
              onClick={() => { setDraft(String(price.default_price)); onSave(price.default_price as number) }}
            >Reset to default</button>
          )}
        </div>
      )}
    </li>
  )
}

// ── Modifiers tab (Story 5 / BACK-2521) ────────────────────────────────────
// Shows currently attached modifier groups with detach + auto-show toggle.
// Two add actions: attach existing (multi-select catalog) or create new
// (inline form + immediate attach).

function ModifiersTab({
  allGroups, attached, loading,
  onDetach, onToggleAutoShow, onAttach, onCreated,
}: {
  allGroups: ModifierGroup[]
  attached: AttachedModifierGroup[]
  loading: boolean
  onDetach: (modifier_group_id: number) => void | Promise<void>
  onToggleAutoShow: (modifier_group_id: number, autoShow: boolean) => void | Promise<void>
  onAttach: (toAttach: ModifierGroup[]) => void | Promise<void>
  onCreated: (newGroup: ModifierGroup) => void | Promise<void>
}) {
  type Mode = 'list' | 'attach' | 'create'
  const [mode, setMode] = useState<Mode>('list')

  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>

  if (mode === 'attach') {
    return (
      <AttachExistingMods
        allGroups={allGroups}
        attachedIds={attached.map(a => a.modifier_group_id)}
        onCancel={() => setMode('list')}
        onAttach={async (gs) => { await onAttach(gs); setMode('list') }}
      />
    )
  }

  if (mode === 'create') {
    return (
      <CreateModifierGroupForm
        onCancel={() => setMode('list')}
        onCreated={async (g) => { await onCreated(g); setMode('list') }}
      />
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-text-3 italic">
        Modifier groups attached to this sales item appear in the customer flow / kiosk. Detach removes the link only — the group itself stays in the catalog.
      </p>

      {attached.length === 0 ? (
        <div className="text-xs text-text-3 italic py-4 text-center">No modifier groups attached.</div>
      ) : (
        <ul className="space-y-2">
          {attached.map(g => (
            <li key={g.modifier_group_id} className="rounded-lg border border-border px-3 py-2.5 bg-surface-2/30">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-1 truncate">{g.name}</div>
                  <div className="text-[11px] text-text-3 mt-0.5">
                    Pick {g.min_select === g.max_select ? `${g.min_select}` : `${g.min_select}–${g.max_select}`}
                  </div>
                </div>
                <button
                  className="text-text-3 hover:text-red-600 text-xs px-2 shrink-0"
                  onClick={() => onDetach(g.modifier_group_id)}
                  title="Detach (does not delete the group)"
                >Detach</button>
              </div>
              <label className="flex items-center gap-2 mt-2 text-[11px] text-text-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={g.auto_show}
                  onChange={(e) => onToggleAutoShow(g.modifier_group_id, e.target.checked)}
                />
                Show inline (un-tick to hide behind a button)
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2 pt-1">
        <button className="btn-outline flex-1 text-xs" onClick={() => setMode('attach')}>+ Attach existing</button>
        <button className="btn-primary flex-1 text-xs" onClick={() => setMode('create')}>+ Create new</button>
      </div>
    </div>
  )
}

function AttachExistingMods({
  allGroups, attachedIds, onCancel, onAttach,
}: {
  allGroups: ModifierGroup[]
  attachedIds: number[]
  onCancel: () => void
  onAttach: (gs: ModifierGroup[]) => void | Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allGroups
      .filter(g => !attachedIds.includes(g.id))
      .filter(g => !q || g.name.toLowerCase().includes(q))
  }, [allGroups, attachedIds, search])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button className="text-text-3 hover:text-text-1 text-xs" onClick={onCancel}>← Back</button>
        <div className="text-xs font-semibold text-text-2">Attach existing modifier groups</div>
      </div>
      <input
        className="input w-full"
        autoFocus
        placeholder="Search modifier groups…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {candidates.length === 0 ? (
        <div className="text-xs text-text-3 italic py-4 text-center">
          {allGroups.length === 0 ? 'No modifier groups in the catalog yet.' : 'All groups already attached.'}
        </div>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {candidates.map(g => {
            const checked = picked.has(g.id)
            return (
              <li key={g.id}>
                <label className="flex items-center gap-2 px-2.5 py-2 hover:bg-surface-2/70 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setPicked(prev => {
                      const next = new Set(prev)
                      if (next.has(g.id)) next.delete(g.id); else next.add(g.id)
                      return next
                    })}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text-1 truncate">{g.name}</div>
                    <div className="text-[11px] text-text-3">
                      Pick {g.min_select === g.max_select ? `${g.min_select}` : `${g.min_select}–${g.max_select}`}
                      {g.option_count != null ? ` · ${g.option_count} option${g.option_count === 1 ? '' : 's'}` : ''}
                    </div>
                  </div>
                </label>
              </li>
            )
          })}
        </ul>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-ghost text-xs" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary text-xs"
          disabled={picked.size === 0}
          onClick={() => onAttach(allGroups.filter(g => picked.has(g.id)))}
        >Attach {picked.size > 0 ? `(${picked.size})` : ''}</button>
      </div>
    </div>
  )
}

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

function MarketsTab({
  countries, markets, loading, onToggle,
}: {
  countries: Country[]
  markets: SalesItemMarket[]
  loading: boolean
  onToggle: (countryId: number, checked: boolean) => void
}) {
  if (loading) return <div className="flex justify-center py-8"><Spinner /></div>
  if (countries.length === 0) {
    return <div className="text-xs text-text-3 italic py-4 text-center">No countries in scope.</div>
  }
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-text-3 italic">
        Sales-item market visibility. Items not active in a market won't be addable to that market's menus. Auto-saves on toggle.
      </p>
      <ul className="space-y-1">
        {countries.map(c => {
          // Default: if no row exists, treat as active (matches server-side
          // logic in POST /menu-sales-items which only blocks when an explicit
          // is_active=false row is present).
          const row = markets.find(m => m.country_id === c.id)
          const active = row ? row.is_active : true
          return (
            <li key={c.id} className="flex items-center gap-2">
              <label className="flex items-center gap-2 cursor-pointer flex-1 px-2.5 py-1.5 rounded hover:bg-surface-2/60">
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(e) => onToggle(c.id, e.target.checked)}
                />
                <span className="text-sm text-text-1 flex-1">{c.name}</span>
                <span className="text-[10px] text-text-3 font-mono">{c.currency_symbol || c.currency_code}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
