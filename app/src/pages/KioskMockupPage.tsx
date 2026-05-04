// =============================================================================
// KioskMockupPage — self-service ordering kiosk mockup
//
// Renders a 9:16 portrait canvas scaled to viewport height — the way a real
// 32" kiosk panel sits in the wall. The flow is one customer journey:
//   1. Order Type     — pick price level (Dine-In / Takeaway / Delivery)
//   2. Browse         — category list left, product tiles right (with images
//                       and allergen badges)
//   3. Customise      — combo step walker / modifier prompts, one screen at a
//                       time, large tap targets
//   4. Basket modal   — review every line + modifier; tapping any line jumps
//                       back into that item's customise step for editing
//   5. Pay            — card (simulated) or transfer-to-till (cash) with QR
//   6. Receipt        — printable summary; tap to start over
//
// Bottom bar (visible on browse/customise):
//   • Accessibility (bottom-left)  — squashes the canvas to ~half height so
//     a wheelchair user can reach everything.
//   • Basket button + total (bottom-right of centre).
//   • Red PAY button (rightmost) — disabled when the basket is empty.
//
// Admin entry: /kiosk shows a menu picker first. Pick a menu → click LAUNCH;
// the canvas takes over the viewport. Top-left tiny "exit" chevron returns
// to the picker so the admin can swap menus.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApi } from '../hooks/useApi'

/* ── types — match POS mockup so we share the data shape ───────────────────── */

interface Menu   { id: number; name: string; country_id?: number; country_name?: string }
interface PLevel { id: number; name: string }

interface CogsItem {
  menu_item_id:         number
  menu_sales_item_id:   number
  sales_item_id:        number
  item_type:            string
  modifier_group_count: number
  display_name:         string
  category:             string
  sell_price_gross:     number
  tax_rate:             number
  cost_per_portion:     number
  image_url?:           string | null
  description?:         string | null
}

interface SubPriceData {
  item_type: string
  combo_steps: ComboStep[]
  modifier_groups: ModGroup[]
}
interface ComboStep {
  id: number; name: string; display_name: string | null
  min_select: number; max_select: number; auto_select: boolean
  options: ComboOption[]
}
interface ComboOption {
  id: number; name: string; display_name: string | null
  item_type: string
  prices: Record<number, number>
  modifier_groups?: ModGroup[]
}
interface ModGroup {
  modifier_group_id: number; name: string; display_name: string | null
  min_select: number; max_select: number
  allow_repeat_selection?: boolean; auto_show?: boolean
  options: ModOption[]
}
interface ModOption {
  id: number; name: string; display_name: string | null
  item_type: string
  prices: Record<number, number>
  image_url?: string | null
}

// One line in the basket. Modifiers are flat; displayLines preserves the
// hierarchy for rendering (step → option → modifier).
interface CartLine {
  id:           string                // local UUID for React keys + edit lookup
  menu_item_id: number                // backing CogsItem (for re-customise)
  name:         string
  basePrice:    number
  qty:          number
  taxRate:      number
  total:        number                // basePrice + addons (per unit)
  selections:   Selection[]           // flat for receipt + sum
  displayLines: DisplayLine[]         // hierarchical for the basket render
  // Stored config so re-customise can rehydrate the walker.
  _subPrices?:        SubPriceData
  _stepSelections?:   Record<number, number[]>     // stepId → [optId]
  _modSelections?:    Record<string, number[]>     // key → [optId]
  _modQty?:           Record<string, Record<number, number>>
}
interface Selection   { name: string; priceAddon: number }
interface DisplayLine { name: string; priceAddon: number; indent: number }

/* ── allergen lookup — keyed by menu_sales_item_id ─────────────────────────── */

interface AllergenItemRow {
  id: number   // menu_sales_item_id
  contains?: { code: string; name: string }[]
  allergen_notes?: string | null
}

/* ── small icons ───────────────────────────────────────────────────────────── */

function AllergenIcon({ size = 14, color = '#dc2626' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9"  x2="12" y2="13"/>
      <line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}

function AccessibilityIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="4" r="2"/>
      <path d="M19 13l-1.7-2.5a2 2 0 0 0-1.7-1H8.4a2 2 0 0 0-1.7 1L5 13"/>
      <path d="M12 6v9"/>
      <path d="M9 21l3-6 3 6"/>
    </svg>
  )
}

function BackChevron({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  )
}

/* ── helpers ───────────────────────────────────────────────────────────────── */

function formatMoney(n: number, sym: string) {
  return `${sym}${n.toFixed(2)}`
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

/* ── customise flow state machine ──────────────────────────────────────────── */

interface Walker {
  item:           CogsItem
  subPrices:      SubPriceData
  // Phase progression. Combo items walk steps first, queueing any option-level
  // modifier groups attached to the picked options; those play out as
  // 'option-modifier' screens between steps. Once all combo steps + their
  // option modifiers are done, any modifier groups attached at the SI level
  // play as 'modifier' screens. Then 'done' → commit to cart.
  phase:          'combo-step' | 'option-modifier' | 'modifier' | 'done'
  stepIdx:        number     // index into subPrices.combo_steps
  modGroupIdx:    number     // index into subPrices.modifier_groups (SI-level)
  // Per-step option selections (for combo).
  stepSelections: Record<number, number[]>          // stepId  → optionIds[]
  // Modifier selections — keyed either by mgId (SI-level) or `${stepId}_${mgId}` (option-level).
  modSelections:  Record<string, number[]>          // key → optionIds[]
  modQty:         Record<string, Record<number, number>>
  // Queued option-level modifier groups for the current combo step. Refilled
  // each time the user advances past a step using the picked options'
  // modifier_groups list. The head element is the screen currently shown
  // when phase === 'option-modifier'.
  pendingOptModGroups: { stepId: number; option: ComboOption; group: ModGroup }[]
  // If we're editing an existing cart line, the original ID so we can replace
  // it on commit instead of appending a duplicate.
  editingLineId:  string | null
  // Optional fast-forward target: edit-from-basket can drop the user straight
  // onto a specific step or modifier group rather than restarting the walker.
  jumpToTarget:   { kind: 'step'; stepId: number } | { kind: 'modifier'; mgId: number } | null
}

/* ── kiosk page ────────────────────────────────────────────────────────────── */

type Phase = 'setup' | 'order-type' | 'browse' | 'customise' | 'payment' | 'receipt'

export default function KioskMockupPage() {
  const api = useApi()

  /* setup state */
  const [menus,           setMenus]            = useState<Menu[]>([])
  const [levels,          setLevels]           = useState<PLevel[]>([])
  const [selectedMenuId,  setSelectedMenuId]   = useState<number | null>(null)
  const [phase,           setPhase]            = useState<Phase>('setup')

  /* live menu data */
  const [menuItems,       setMenuItems]        = useState<CogsItem[]>([])
  const [allergenMap,     setAllergenMap]      = useState<Record<number, boolean>>({})
  const [currencySymbol,  setCurrencySymbol]   = useState('$')
  const [loading,         setLoading]          = useState(false)

  /* customer flow */
  const [priceLevelId,    setPriceLevelId]     = useState<number | null>(null)
  const [activeCategory,  setActiveCategory]   = useState<string | null>(null)
  const [cart,            setCart]             = useState<CartLine[]>([])
  const [walker,          setWalker]           = useState<Walker | null>(null)
  const [basketOpen,      setBasketOpen]       = useState(false)
  const [payMethod,       setPayMethod]        = useState<'card' | 'cash' | null>(null)
  const [paying,          setPaying]           = useState(false)
  const [receipt,         setReceipt]          = useState<{ id: string; lines: CartLine[]; total: number; method: 'card' | 'cash'; ts: Date } | null>(null)
  const [accessibilityMode, setAccessibilityMode] = useState(false)

  /* ── load menus + levels on mount ───────────────────────────────────────── */
  const loadInit = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([api.get('/menus'), api.get('/price-levels')])
      setMenus(m || [])
      setLevels(l || [])
      if (m?.length && !selectedMenuId) setSelectedMenuId(m[0].id)
    } catch { /* silent */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  useEffect(() => { loadInit() }, [loadInit])

  /* ── refilter levels by the selected menu's country ─────────────────────── */
  const selectedMenuCountryId = menus.find(m => m.id === selectedMenuId)?.country_id ?? null
  useEffect(() => {
    if (selectedMenuCountryId == null) return
    let cancelled = false
    ;(async () => {
      try {
        const scoped = await api.get(`/price-levels?country_id=${selectedMenuCountryId}`) as PLevel[] | null
        if (!cancelled) setLevels(scoped || [])
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMenuCountryId, api])

  /* ── load menu items + allergens once a menu/level is locked in ─────────── */
  const loadMenu = useCallback(async () => {
    if (!selectedMenuId) return
    setLoading(true)
    try {
      const lvlParam = priceLevelId ? `?price_level_id=${priceLevelId}` : ''
      const [data, allergens] = await Promise.all([
        api.get(`/cogs/menu-sales/${selectedMenuId}${lvlParam}`),
        api.get(`/allergens/menu/${selectedMenuId}`).catch(() => null),
      ])
      setMenuItems(data?.items || [])
      setCurrencySymbol(data?.currency_symbol || '$')

      // Allergen lookup: any item with at least one regulated allergen OR any
      // allergen_notes field set is flagged for the badge. We don't render the
      // full FIC matrix here — operators see the small ⚠ as a "tap before
      // ordering" cue; the receipt / shared menu has the full breakdown.
      const flagged: Record<number, boolean> = {}
      const rows: AllergenItemRow[] = (allergens?.items || allergens || [])
      for (const r of rows) {
        if ((r.contains && r.contains.length) || (r.allergen_notes && r.allergen_notes.trim())) {
          flagged[r.id] = true
        }
      }
      setAllergenMap(flagged)
    } catch {
      setMenuItems([])
    } finally {
      setLoading(false)
    }
  }, [api, selectedMenuId, priceLevelId])

  // Load when phase advances past order-type (i.e. once price level is set).
  useEffect(() => {
    if (phase === 'browse' || phase === 'customise') loadMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, priceLevelId, selectedMenuId])

  /* ── derived ────────────────────────────────────────────────────────────── */
  const categories = useMemo(
    () => [...new Set(menuItems.map(i => i.category || 'Other'))].sort(),
    [menuItems],
  )

  // Auto-pick the first category when items first load.
  useEffect(() => {
    if (!activeCategory && categories.length) setActiveCategory(categories[0])
  }, [categories, activeCategory])

  const cartTotal = useMemo(
    () => cart.reduce((s, l) => s + l.total * l.qty, 0),
    [cart],
  )
  const cartCount = useMemo(
    () => cart.reduce((s, l) => s + l.qty, 0),
    [cart],
  )

  /* ── launch the kiosk (admin → customer-facing) ─────────────────────────── */
  function launchKiosk() {
    if (!selectedMenuId) return
    setCart([])
    setReceipt(null)
    setPriceLevelId(null)
    setPhase('order-type')
  }

  function backToSetup() {
    setPhase('setup')
    setCart([])
    setReceipt(null)
    setActiveCategory(null)
    setBasketOpen(false)
    setPayMethod(null)
  }

  /* ── start customise flow for a tapped product ──────────────────────────── */
  const startCustomise = useCallback(async (item: CogsItem) => {
    // Simple item — no combo / no modifiers — drop straight into the cart.
    if (item.item_type !== 'combo' && (!item.modifier_group_count || item.modifier_group_count === 0)) {
      addLine({
        id:           newId(),
        menu_item_id: item.menu_item_id,
        name:         item.display_name,
        basePrice:    item.sell_price_gross,
        selections:   [],
        displayLines: [],
        qty:          1,
        total:        item.sell_price_gross,
        taxRate:      item.tax_rate || 0,
      })
      return
    }

    try {
      const subPrices: SubPriceData = await api.get(`/menu-sales-items/${item.menu_sales_item_id}/sub-prices`)
      const isCombo  = item.item_type === 'combo' && (subPrices.combo_steps?.length ?? 0) > 0
      const hasMods  = (subPrices.modifier_groups?.length ?? 0) > 0

      setWalker({
        item, subPrices,
        phase:                isCombo ? 'combo-step' : (hasMods ? 'modifier' : 'done'),
        stepIdx:              0,
        modGroupIdx:          0,
        stepSelections:       {},
        modSelections:        {},
        modQty:               {},
        pendingOptModGroups:  [],
        editingLineId:        null,
        jumpToTarget:         null,
      })
      setPhase('customise')
    } catch {
      // Couldn't load sub-prices — drop into cart as a simple item so the
      // customer is never stuck.
      addLine({
        id:           newId(),
        menu_item_id: item.menu_item_id,
        name:         item.display_name,
        basePrice:    item.sell_price_gross,
        selections:   [],
        displayLines: [],
        qty:          1,
        total:        item.sell_price_gross,
        taxRate:      item.tax_rate || 0,
      })
    }
  }, [api])

  /* ── cart helpers ───────────────────────────────────────────────────────── */
  function addLine(line: CartLine) {
    // Aggregate identical lines (same fingerprint) so the basket doesn't
    // explode when a customer taps the same combo twice.
    setCart(prev => {
      const fp = fingerprint(line)
      const existing = prev.findIndex(l => fingerprint(l) === fp)
      if (existing >= 0) return prev.map((l, i) => i === existing ? { ...l, qty: l.qty + line.qty } : l)
      return [...prev, line]
    })
  }

  function fingerprint(l: CartLine) {
    return `${l.menu_item_id}|${l.name}|` + l.selections.map(s => `${s.name}:${s.priceAddon.toFixed(2)}`).join(',')
  }

  function bumpQty(id: string, delta: number) {
    setCart(prev =>
      prev
        .map(l => l.id === id ? { ...l, qty: l.qty + delta } : l)
        .filter(l => l.qty > 0),
    )
  }

  function removeLine(id: string) {
    setCart(prev => prev.filter(l => l.id !== id))
  }

  /* ── walker → cart commit ───────────────────────────────────────────────── */
  function commitWalker(w: Walker) {
    const selections: Selection[] = []
    const displayLines: DisplayLine[] = []

    // Combo steps first
    for (const step of w.subPrices.combo_steps) {
      const ids = w.stepSelections[step.id] || []
      for (const optId of ids) {
        const opt = step.options.find(o => o.id === optId)
        if (!opt) continue
        const addon = priceLevelId ? (opt.prices[priceLevelId] || 0) : 0
        selections.push({ name: opt.display_name || opt.name, priceAddon: addon })
        displayLines.push({ name: opt.display_name || opt.name, priceAddon: addon, indent: 0 })

        // Option-level modifiers attached to this option
        for (const mg of opt.modifier_groups || []) {
          const key = `${step.id}_${mg.modifier_group_id}`
          const modIds = w.modSelections[key] || []
          for (const moId of modIds) {
            const mo = mg.options.find(x => x.id === moId)
            if (!mo) continue
            const moAddon = priceLevelId ? (mo.prices[priceLevelId] || 0) : 0
            const repQty  = w.modQty[key]?.[moId] || 1
            for (let i = 0; i < repQty; i++) {
              selections.push({ name: mo.display_name || mo.name, priceAddon: moAddon })
              displayLines.push({ name: mo.display_name || mo.name, priceAddon: moAddon, indent: 1 })
            }
          }
        }
      }
    }

    // SI-level modifier groups
    for (const mg of w.subPrices.modifier_groups) {
      const key = String(mg.modifier_group_id)
      const ids = w.modSelections[key] || []
      for (const moId of ids) {
        const mo = mg.options.find(x => x.id === moId)
        if (!mo) continue
        const addon = priceLevelId ? (mo.prices[priceLevelId] || 0) : 0
        const rep = w.modQty[key]?.[moId] || 1
        for (let i = 0; i < rep; i++) {
          selections.push({ name: mo.display_name || mo.name, priceAddon: addon })
          displayLines.push({ name: mo.display_name || mo.name, priceAddon: addon, indent: 0 })
        }
      }
    }

    const addonTotal = selections.reduce((s, x) => s + x.priceAddon, 0)
    const baseUnit  = w.item.sell_price_gross + addonTotal
    const line: CartLine = {
      id:           w.editingLineId || newId(),
      menu_item_id: w.item.menu_item_id,
      name:         w.item.display_name,
      basePrice:    w.item.sell_price_gross,
      selections,
      displayLines,
      qty:          1,
      total:        baseUnit,
      taxRate:      w.item.tax_rate || 0,
      _subPrices:   w.subPrices,
      _stepSelections: w.stepSelections,
      _modSelections:  w.modSelections,
      _modQty:         w.modQty,
    }

    if (w.editingLineId) {
      // Replace existing line (preserve qty)
      setCart(prev => prev.map(l => l.id === w.editingLineId ? { ...line, qty: l.qty } : l))
    } else {
      addLine(line)
    }
    setWalker(null)
    setPhase('browse')
  }

  /* ── jump back into a cart line for editing ─────────────────────────────── */
  function editLine(line: CartLine, target: Walker['jumpToTarget'] = null) {
    if (!line._subPrices) return  // simple items have nothing to edit
    setWalker({
      item: {
        // synthesise a CogsItem stub from the cart line (we need the menu_item_id
        // to re-commit, plus a display name — sell_price_gross from basePrice).
        menu_item_id:         line.menu_item_id,
        menu_sales_item_id:   line.menu_item_id,
        sales_item_id:        0,
        item_type:            line._subPrices.item_type,
        modifier_group_count: line._subPrices.modifier_groups.length,
        display_name:         line.name,
        category:             '',
        sell_price_gross:     line.basePrice,
        tax_rate:             line.taxRate,
        cost_per_portion:     0,
      },
      subPrices:           line._subPrices,
      phase:               line._subPrices.combo_steps.length ? 'combo-step' : 'modifier',
      stepIdx:             0,
      modGroupIdx:         0,
      stepSelections:      Object.fromEntries(
        Object.entries(line._stepSelections || {}).map(([k, v]) => [k, [...(v as number[])]]),
      ),
      modSelections:       Object.fromEntries(
        Object.entries(line._modSelections || {}).map(([k, v]) => [k, [...(v as number[])]]),
      ),
      modQty:              JSON.parse(JSON.stringify(line._modQty || {})),
      pendingOptModGroups: [],
      editingLineId:       line.id,
      jumpToTarget:        target,
    })
    setBasketOpen(false)
    setPhase('customise')
  }

  /* ── payment ─────────────────────────────────────────────────────────────── */
  async function startPayment(method: 'card' | 'cash') {
    setPayMethod(method)
    setPaying(true)
    setPhase('payment')
    // Simulate processing
    await new Promise(r => setTimeout(r, method === 'card' ? 1800 : 1200))
    setPaying(false)
    setReceipt({
      id:     `ORD-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      lines:  cart,
      total:  cartTotal,
      method,
      ts:     new Date(),
    })
    setPhase('receipt')
  }

  function startOver() {
    setCart([])
    setReceipt(null)
    setPayMethod(null)
    setActiveCategory(categories[0] || null)
    setPhase('order-type')
    setPriceLevelId(null)
  }

  /* ── render ─────────────────────────────────────────────────────────────── */

  if (phase === 'setup') {
    return (
      <SetupScreen
        menus={menus}
        selectedMenuId={selectedMenuId}
        onSelect={setSelectedMenuId}
        onLaunch={launchKiosk}
      />
    )
  }

  return (
    <KioskFrame accessibility={accessibilityMode}>
      {/* Top-left tiny exit chevron — admin can swap menus */}
      <button
        className="absolute top-4 left-4 z-50 w-10 h-10 rounded-full bg-white/80 backdrop-blur flex items-center justify-center text-gray-500 hover:bg-white"
        title="Back to setup (admin)"
        onClick={backToSetup}
      ><BackChevron /></button>

      {phase === 'order-type' && (
        <OrderTypeScreen
          levels={levels}
          onPick={lvl => { setPriceLevelId(lvl); setPhase('browse') }}
        />
      )}

      {phase === 'browse' && (
        <BrowseScreen
          loading={loading}
          categories={categories}
          activeCategory={activeCategory}
          onCategory={setActiveCategory}
          items={menuItems.filter(i => (i.category || 'Other') === activeCategory)}
          allergenMap={allergenMap}
          sym={currencySymbol}
          onItemTap={startCustomise}
        />
      )}

      {phase === 'customise' && walker && (
        <CustomiseScreen
          walker={walker}
          setWalker={setWalker}
          priceLevelId={priceLevelId}
          sym={currencySymbol}
          onCommit={commitWalker}
          onCancel={() => { setWalker(null); setPhase('browse') }}
          accessibilityMode={accessibilityMode}
          onAccessibility={() => setAccessibilityMode(v => !v)}
        />
      )}

      {phase === 'payment' && (
        <PaymentScreen
          method={payMethod}
          paying={paying}
          total={cartTotal}
          sym={currencySymbol}
          onCancel={() => { setPayMethod(null); setPaying(false); setPhase('browse') }}
        />
      )}

      {phase === 'receipt' && receipt && (
        <ReceiptScreen
          receipt={receipt}
          sym={currencySymbol}
          onDone={startOver}
        />
      )}

      {/* Bottom bar — only on the browse phase. The customise screen renders
          its own footer (Cancel + Back + Next + Accessibility) so the two
          don't overlap and the progress button stays clearly visible. */}
      {phase === 'browse' && (
        <BottomBar
          cartCount={cartCount}
          cartTotal={cartTotal}
          sym={currencySymbol}
          accessibilityMode={accessibilityMode}
          onAccessibility={() => setAccessibilityMode(v => !v)}
          onBasket={() => setBasketOpen(true)}
          // PAY opens the same method-picker modal that BasketModal's
          // Checkout button opens — payMethod === '__pick__' is the
          // sentinel value that drives the modal render below.
          onPay={() => cartCount > 0 && setPayMethod('__pick__' as any)}
          payDisabled={cartCount === 0}
        />
      )}

      {/* Basket modal */}
      {basketOpen && (
        <BasketModal
          cart={cart}
          sym={currencySymbol}
          total={cartTotal}
          onClose={() => setBasketOpen(false)}
          onEdit={(line, target) => editLine(line, target)}
          onBump={bumpQty}
          onRemove={removeLine}
          onCheckout={() => { setBasketOpen(false); /* fall through to pay-method picker */ requestAnimationFrame(() => setPayMethod('__pick__' as any)) }}
        />
      )}

      {/* Pay-method picker — small modal triggered from BasketModal checkout
          OR from the bottom-bar PAY button. Two big buttons, customer picks. */}
      {((phase === 'browse' || phase === 'customise') && payMethod === ('__pick__' as any)) && (
        <PayMethodPicker
          total={cartTotal}
          sym={currencySymbol}
          onCard={() => { setPayMethod(null); startPayment('card') }}
          onCash={() => { setPayMethod(null); startPayment('cash') }}
          onCancel={() => setPayMethod(null)}
        />
      )}
    </KioskFrame>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Setup screen — admin-facing menu picker
   ════════════════════════════════════════════════════════════════════════════ */

function SetupScreen({ menus, selectedMenuId, onSelect, onLaunch }: {
  menus: Menu[]
  selectedMenuId: number | null
  onSelect: (id: number) => void
  onLaunch: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Kiosk Mockup</h1>
        <p className="text-sm text-gray-500 mb-6">
          Self-service ordering simulator. Pick the menu the kiosk should run, then launch — the canvas takes over the
          viewport at a 9:16 aspect ratio. Use the chevron in the top-left of the kiosk to return here.
        </p>
        <label className="block text-xs font-semibold text-gray-600 mb-1.5">Menu</label>
        <select
          className="input w-full mb-5"
          value={selectedMenuId ?? ''}
          onChange={e => onSelect(Number(e.target.value))}
        >
          {menus.map(m => (
            <option key={m.id} value={m.id}>{m.name}{m.country_name ? ` · ${m.country_name}` : ''}</option>
          ))}
        </select>
        <button
          className="btn btn-primary w-full text-base py-3"
          disabled={!selectedMenuId}
          onClick={onLaunch}
        >Launch Kiosk →</button>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   KioskFrame — 9:16 canvas scaled to viewport height
   ════════════════════════════════════════════════════════════════════════════ */

function KioskFrame({ children, accessibility }: { children: React.ReactNode; accessibility: boolean }) {
  // Full-mode width is derived from the 9:16 ratio at full viewport height
  // (100vh × 9/16 ≈ 56.25vh). In accessibility mode we KEEP that width and
  // only shrink the height to ~50vh — the screen literally lowers so a
  // seated user can reach all controls without the canvas going narrow.
  // Aspect ratio is therefore intentionally NOT applied; we set both
  // dimensions directly. Anchored to the bottom of the viewport so the
  // shrink animates downward from the top.
  const fullWidth = 'min(100vw, calc(100vh * 9 / 16))'
  return (
    <div className="fixed inset-0 bg-black flex justify-center items-end overflow-hidden">
      <div
        className="relative bg-white shadow-2xl overflow-hidden"
        style={{
          width:      fullWidth,
          height:     accessibility ? '50vh' : '100vh',
          transition: 'height 250ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Order Type screen — pick a price level
   ════════════════════════════════════════════════════════════════════════════ */

function OrderTypeScreen({ levels, onPick }: {
  levels: PLevel[]
  onPick: (id: number) => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-br from-emerald-50 via-white to-emerald-50 p-8">
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        <div className="text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-2">Welcome 👋</h2>
          <p className="text-xl text-gray-500">How would you like to order?</p>
        </div>
        <div className="grid grid-cols-1 gap-4 w-full max-w-md">
          {levels.length === 0 ? (
            <div className="text-center text-gray-400 italic">No order types configured for this menu.</div>
          ) : levels.map(l => (
            <button
              key={l.id}
              onClick={() => onPick(l.id)}
              className="w-full py-8 px-6 rounded-2xl bg-white border-2 border-emerald-200 hover:border-accent hover:bg-emerald-50 text-2xl font-bold text-gray-800 shadow-sm hover:shadow-lg transition-all"
            >{l.name}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Browse screen — categories + product tiles
   ════════════════════════════════════════════════════════════════════════════ */

function BrowseScreen({
  loading, categories, activeCategory, onCategory,
  items, allergenMap, sym, onItemTap,
}: {
  loading:        boolean
  categories:     string[]
  activeCategory: string | null
  onCategory:     (c: string) => void
  items:          CogsItem[]
  allergenMap:    Record<number, boolean>
  sym:            string
  onItemTap:      (item: CogsItem) => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900">Menu</h2>
      </div>

      <div className="flex-1 flex overflow-hidden pb-28">
        {/* Categories — left rail */}
        <aside className="w-44 shrink-0 border-r border-gray-100 overflow-y-auto py-2 bg-gray-50">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => onCategory(cat)}
              className={`w-full px-4 py-5 text-left text-base font-medium transition-colors border-l-4 ${
                activeCategory === cat
                  ? 'bg-white text-accent border-accent'
                  : 'text-gray-600 border-transparent hover:bg-white/60'
              }`}
            >{cat}</button>
          ))}
        </aside>

        {/* Product tiles */}
        <main className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center h-full text-gray-400">Loading menu…</div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">No items in this category.</div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {items.map(it => (
                <ProductTile
                  key={it.menu_sales_item_id}
                  item={it}
                  hasAllergens={!!allergenMap[it.menu_sales_item_id]}
                  sym={sym}
                  onTap={() => onItemTap(it)}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function ProductTile({ item, hasAllergens, sym, onTap }: {
  item: CogsItem; hasAllergens: boolean; sym: string; onTap: () => void
}) {
  const initials = (item.display_name || '?').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
  return (
    <button
      onClick={onTap}
      className="bg-white rounded-2xl border border-gray-200 hover:border-accent hover:shadow-md transition-all overflow-hidden text-left flex flex-col"
    >
      <div className="aspect-square bg-gradient-to-br from-emerald-100 to-emerald-50 flex items-center justify-center relative">
        {item.image_url ? (
          <img src={item.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-5xl font-bold text-emerald-700/40">{initials}</span>
        )}
        {hasAllergens && (
          <div className="absolute top-2 right-2 bg-white/95 rounded-full p-1.5 shadow-sm" title="Contains allergens — tap for details">
            <AllergenIcon size={16} />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="font-bold text-gray-900 text-base leading-tight line-clamp-2">{item.display_name}</div>
        <div className="text-emerald-700 font-bold text-lg mt-1">{formatMoney(item.sell_price_gross, sym)}</div>
      </div>
    </button>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Customise screen — combo step / modifier walker
   ════════════════════════════════════════════════════════════════════════════ */

function CustomiseScreen({ walker, setWalker, priceLevelId, sym, onCommit, onCancel, accessibilityMode, onAccessibility }: {
  walker:             Walker
  setWalker:          (w: Walker | null | ((prev: Walker | null) => Walker | null)) => void
  priceLevelId:       number | null
  sym:                string
  onCommit:           (w: Walker) => void
  onCancel:           () => void
  accessibilityMode:  boolean
  onAccessibility:    () => void
}) {
  const { item, subPrices, phase, stepIdx, modGroupIdx, pendingOptModGroups } = walker

  // Resolve current step / modifier group based on the walker's phase + index.
  const currentStep   = phase === 'combo-step'      ? subPrices.combo_steps[stepIdx]            : null
  const currentModGrp = phase === 'modifier'        ? subPrices.modifier_groups[modGroupIdx]    : null
  const currentOptMg  = phase === 'option-modifier' ? pendingOptModGroups[0]                    : null

  /* selection helpers */
  function toggleStepOpt(stepId: number, optId: number, maxSel: number) {
    setWalker(prev => {
      if (!prev) return prev
      const cur = new Set(prev.stepSelections[stepId] || [])
      if (cur.has(optId)) cur.delete(optId)
      else {
        if (maxSel === 1) cur.clear()
        if (cur.size < maxSel) cur.add(optId)
      }
      return { ...prev, stepSelections: { ...prev.stepSelections, [stepId]: [...cur] } }
    })
  }

  function toggleModOpt(key: string, optId: number, maxSel: number) {
    setWalker(prev => {
      if (!prev) return prev
      const cur = new Set(prev.modSelections[key] || [])
      if (cur.has(optId)) cur.delete(optId)
      else {
        if (maxSel === 1) cur.clear()
        if (cur.size < maxSel) cur.add(optId)
      }
      return { ...prev, modSelections: { ...prev.modSelections, [key]: [...cur] } }
    })
  }

  // Build the option-modifier queue for a step that just finished. Pulls every
  // modifier_groups list off the picked options in selection order, flattens
  // and de-dupes (same group attached to two picked options shows once).
  function buildOptModQueue(step: ComboStep, pickedOptIds: number[]): Walker['pendingOptModGroups'] {
    const queue: Walker['pendingOptModGroups'] = []
    const seen = new Set<string>()
    for (const optId of pickedOptIds) {
      const opt = step.options.find(o => o.id === optId)
      if (!opt?.modifier_groups) continue
      for (const g of opt.modifier_groups) {
        const key = `${step.id}_${opt.id}_${g.modifier_group_id}`
        if (seen.has(key)) continue
        seen.add(key)
        queue.push({ stepId: step.id, option: opt, group: g })
      }
    }
    return queue
  }

  function advance() {
    setWalker(prev => {
      if (!prev) return prev

      // Coming off a combo step → queue option modifiers attached to the
      // picked options. Walk those before moving to the next step.
      if (prev.phase === 'combo-step') {
        const step = prev.subPrices.combo_steps[prev.stepIdx]
        const picked = step ? (prev.stepSelections[step.id] || []) : []
        const queue = step ? buildOptModQueue(step, picked) : []
        if (queue.length > 0) {
          return { ...prev, phase: 'option-modifier', pendingOptModGroups: queue }
        }
        // No option-modifiers — go to next combo step or roll into SI mods.
        if (prev.stepIdx < prev.subPrices.combo_steps.length - 1) {
          return { ...prev, stepIdx: prev.stepIdx + 1 }
        }
        if (prev.subPrices.modifier_groups.length > 0) {
          return { ...prev, phase: 'modifier', modGroupIdx: 0 }
        }
        return { ...prev, phase: 'done' }
      }

      // Coming off an option-modifier screen → drop the head, show the next
      // queued one, or move on to the next combo step / SI modifiers / done.
      if (prev.phase === 'option-modifier') {
        const remaining = prev.pendingOptModGroups.slice(1)
        if (remaining.length > 0) {
          return { ...prev, pendingOptModGroups: remaining }
        }
        if (prev.stepIdx < prev.subPrices.combo_steps.length - 1) {
          return { ...prev, phase: 'combo-step', stepIdx: prev.stepIdx + 1, pendingOptModGroups: [] }
        }
        if (prev.subPrices.modifier_groups.length > 0) {
          return { ...prev, phase: 'modifier', modGroupIdx: 0, pendingOptModGroups: [] }
        }
        return { ...prev, phase: 'done', pendingOptModGroups: [] }
      }

      // SI-level modifier screen
      if (prev.phase === 'modifier') {
        if (prev.modGroupIdx < prev.subPrices.modifier_groups.length - 1) {
          return { ...prev, modGroupIdx: prev.modGroupIdx + 1 }
        }
        return { ...prev, phase: 'done' }
      }
      return prev
    })
  }

  function goBack() {
    setWalker(prev => {
      if (!prev) return prev
      if (prev.phase === 'modifier') {
        if (prev.modGroupIdx > 0) return { ...prev, modGroupIdx: prev.modGroupIdx - 1 }
        // Pop back to last combo step's last option-modifier (if any) or the
        // step itself.
        const lastStep = prev.subPrices.combo_steps[prev.subPrices.combo_steps.length - 1]
        if (lastStep) {
          const picked = prev.stepSelections[lastStep.id] || []
          const q = buildOptModQueue(lastStep, picked)
          if (q.length > 0) {
            return { ...prev, phase: 'option-modifier', pendingOptModGroups: [q[q.length - 1]] }
          }
          return { ...prev, phase: 'combo-step', stepIdx: prev.subPrices.combo_steps.length - 1 }
        }
      }
      if (prev.phase === 'option-modifier') {
        // Going back from an option-modifier screen lands on the parent step.
        // We re-queue the modifier groups so a forward swing doesn't lose the
        // user's choice on this group (their selection state is untouched).
        return { ...prev, phase: 'combo-step', pendingOptModGroups: [] }
      }
      if (prev.phase === 'combo-step' && prev.stepIdx > 0) {
        return { ...prev, stepIdx: prev.stepIdx - 1 }
      }
      // First screen — bail to browse
      onCancel()
      return prev
    })
  }

  // When the walker reaches phase=done we commit + return to browse.
  useEffect(() => {
    if (walker.phase === 'done') onCommit(walker)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walker.phase])

  // Apply jumpToTarget on first render after edit-from-basket entry.
  const jumpedRef = useRef(false)
  useEffect(() => {
    if (jumpedRef.current) return
    if (!walker.jumpToTarget) return
    jumpedRef.current = true
    const t = walker.jumpToTarget
    setWalker(prev => {
      if (!prev) return prev
      if (t.kind === 'step') {
        const idx = prev.subPrices.combo_steps.findIndex(s => s.id === t.stepId)
        if (idx >= 0) return { ...prev, phase: 'combo-step', stepIdx: idx, jumpToTarget: null }
      }
      if (t.kind === 'modifier') {
        const idx = prev.subPrices.modifier_groups.findIndex(g => g.modifier_group_id === t.mgId)
        if (idx >= 0) return { ...prev, phase: 'modifier', modGroupIdx: idx, jumpToTarget: null }
      }
      return { ...prev, jumpToTarget: null }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Total + current step counter for the header. Counts SI-level modifiers
  // and combo steps, but NOT option-modifiers (those are conditional on
  // selections — counter would jump unpredictably).
  const stepN = subPrices.combo_steps.length + subPrices.modifier_groups.length
  const stepI = phase === 'combo-step'
    ? stepIdx + 1
    : phase === 'modifier'
      ? subPrices.combo_steps.length + modGroupIdx + 1
      : stepIdx + 1   // option-modifier screens count under the parent combo step

  // Whether the next tap should commit (rather than advance to another screen).
  // True when this is the last screen in the entire walker journey.
  const isLastScreen =
    (phase === 'combo-step'      && stepIdx === subPrices.combo_steps.length - 1
                                  && subPrices.modifier_groups.length === 0
                                  && buildOptModForCurrentStep(walker).length === 0)
    || (phase === 'option-modifier' && pendingOptModGroups.length <= 1
                                     && stepIdx === subPrices.combo_steps.length - 1
                                     && subPrices.modifier_groups.length === 0)
    || (phase === 'modifier'        && modGroupIdx === subPrices.modifier_groups.length - 1)

  return (
    <div className="absolute inset-0 flex flex-col bg-white pb-24">
      {/* Header — item name + step counter (no buttons; nav lives in footer) */}
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-2xl font-bold text-gray-900">{item.display_name}</h2>
        {stepN > 0 && (
          <div className="text-sm text-gray-500 mt-1">
            Step {stepI} of {stepN}
            {phase === 'option-modifier' && (
              <span className="text-emerald-600 ml-2">· {currentOptMg?.option.display_name || currentOptMg?.option.name} extras</span>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {currentStep && (
          <>
            <h3 className="text-xl font-bold text-gray-900 mb-1">{currentStep.display_name || currentStep.name}</h3>
            <p className="text-sm text-gray-500 mb-4">
              Choose {currentStep.min_select === currentStep.max_select
                ? currentStep.min_select
                : `${currentStep.min_select}–${currentStep.max_select}`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {currentStep.options.map(opt => {
                const selected = (walker.stepSelections[currentStep.id] || []).includes(opt.id)
                const addon    = priceLevelId ? (opt.prices[priceLevelId] || 0) : 0
                return (
                  <OptionTile
                    key={opt.id}
                    name={opt.display_name || opt.name}
                    addon={addon}
                    sym={sym}
                    selected={selected}
                    onTap={() => toggleStepOpt(currentStep.id, opt.id, currentStep.max_select)}
                  />
                )
              })}
            </div>
          </>
        )}

        {currentOptMg && (
          <>
            <h3 className="text-xl font-bold text-gray-900 mb-1">{currentOptMg.group.display_name || currentOptMg.group.name}</h3>
            <p className="text-sm text-gray-500 mb-4">
              For your <strong>{currentOptMg.option.display_name || currentOptMg.option.name}</strong>
              {' · '}
              {currentOptMg.group.min_select === 0
                ? `optional · up to ${currentOptMg.group.max_select}`
                : `choose ${currentOptMg.group.min_select === currentOptMg.group.max_select
                    ? currentOptMg.group.min_select
                    : `${currentOptMg.group.min_select}–${currentOptMg.group.max_select}`}`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {currentOptMg.group.options.map(mo => {
                // Option-modifier key matches commitWalker: `${stepId}_${mgId}`
                const key      = `${currentOptMg.stepId}_${currentOptMg.group.modifier_group_id}`
                const selected = (walker.modSelections[key] || []).includes(mo.id)
                const addon    = priceLevelId ? (mo.prices[priceLevelId] || 0) : 0
                return (
                  <OptionTile
                    key={mo.id}
                    name={mo.display_name || mo.name}
                    addon={addon}
                    sym={sym}
                    selected={selected}
                    imageUrl={mo.image_url}
                    onTap={() => toggleModOpt(key, mo.id, currentOptMg.group.max_select)}
                  />
                )
              })}
            </div>
          </>
        )}

        {currentModGrp && (
          <>
            <h3 className="text-xl font-bold text-gray-900 mb-1">{currentModGrp.display_name || currentModGrp.name}</h3>
            <p className="text-sm text-gray-500 mb-4">
              {currentModGrp.min_select === 0
                ? `Optional · up to ${currentModGrp.max_select}`
                : `Choose ${currentModGrp.min_select === currentModGrp.max_select
                    ? currentModGrp.min_select
                    : `${currentModGrp.min_select}–${currentModGrp.max_select}`}`}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {currentModGrp.options.map(mo => {
                const key      = String(currentModGrp.modifier_group_id)
                const selected = (walker.modSelections[key] || []).includes(mo.id)
                const addon    = priceLevelId ? (mo.prices[priceLevelId] || 0) : 0
                return (
                  <OptionTile
                    key={mo.id}
                    name={mo.display_name || mo.name}
                    addon={addon}
                    sym={sym}
                    selected={selected}
                    imageUrl={mo.image_url}
                    onTap={() => toggleModOpt(key, mo.id, currentModGrp.max_select)}
                  />
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer — full-width single bar that replaces the browse-mode bottom
          bar during customise. Layout: [Accessibility] [Cancel] · spacer ·
          [Back] [Next/Add]. Sits flush with the bottom edge of the canvas
          (no overlap with anything else — the customise screen does not
          render the basket/pay bar). */}
      <div className="absolute left-0 right-0 bottom-0 p-3 border-t border-gray-100 bg-white flex items-center gap-2 z-30">
        <button
          onClick={onAccessibility}
          title={accessibilityMode ? 'Restore full height' : 'Lower the screen for easier reach'}
          className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${
            accessibilityMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        ><AccessibilityIcon /></button>
        <button
          onClick={onCancel}
          className="h-14 px-5 rounded-full bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200"
        >Cancel</button>
        <div className="flex-1" />
        <button
          onClick={goBack}
          className="h-14 px-5 rounded-full bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200 flex items-center gap-1"
        ><BackChevron size={18} /> Back</button>
        <button
          onClick={advance}
          disabled={!canAdvance(walker)}
          className="h-14 px-7 rounded-full bg-accent text-white text-lg font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        >{isLastScreen ? 'Add to basket' : 'Next →'}</button>
      </div>
    </div>
  )
}

/* Standalone helper — used only by isLastScreen. Mirrors the queueing logic
   in advance() so the footer button label flips to "Add to basket" on the
   true final screen. Doesn't mutate state. */
function buildOptModForCurrentStep(w: Walker): { stepId: number; option: ComboOption; group: ModGroup }[] {
  if (w.phase !== 'combo-step') return []
  const step = w.subPrices.combo_steps[w.stepIdx]
  if (!step) return []
  const picked = w.stepSelections[step.id] || []
  const out: { stepId: number; option: ComboOption; group: ModGroup }[] = []
  const seen = new Set<string>()
  for (const optId of picked) {
    const opt = step.options.find(o => o.id === optId)
    if (!opt?.modifier_groups) continue
    for (const g of opt.modifier_groups) {
      const key = `${step.id}_${opt.id}_${g.modifier_group_id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ stepId: step.id, option: opt, group: g })
    }
  }
  return out
}

function canAdvance(w: Walker): boolean {
  if (w.phase === 'combo-step') {
    const step = w.subPrices.combo_steps[w.stepIdx]
    if (!step) return true
    const picked = (w.stepSelections[step.id] || []).length
    return picked >= step.min_select
  }
  if (w.phase === 'modifier') {
    const mg = w.subPrices.modifier_groups[w.modGroupIdx]
    if (!mg) return true
    const picked = (w.modSelections[String(mg.modifier_group_id)] || []).length
    return picked >= mg.min_select
  }
  if (w.phase === 'option-modifier') {
    const head = w.pendingOptModGroups[0]
    if (!head) return true
    const key = `${head.stepId}_${head.group.modifier_group_id}`
    const picked = (w.modSelections[key] || []).length
    return picked >= head.group.min_select
  }
  return true
}

function OptionTile({ name, addon, sym, selected, onTap, imageUrl }: {
  name: string; addon: number; sym: string; selected: boolean; onTap: () => void
  // BACK-2717 — modifier / step options can carry an image_url. When set,
  // the tile shows a square thumbnail above the label. Falls back to the
  // existing text-only layout when null/undefined.
  imageUrl?: string | null
}) {
  return (
    <button
      onClick={onTap}
      className={`min-h-[110px] rounded-2xl border-2 text-left transition-all overflow-hidden flex flex-col ${
        selected
          ? 'border-accent bg-emerald-50 ring-4 ring-emerald-100'
          : 'border-gray-200 bg-white hover:border-emerald-300'
      }`}
    >
      {imageUrl && (
        <div className="aspect-square w-full bg-gradient-to-br from-emerald-100 to-emerald-50 overflow-hidden">
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="p-4 flex-1">
        <div className="font-bold text-gray-900 text-lg leading-tight">{name}</div>
        {addon > 0 && (
          <div className="text-sm text-gray-500 mt-1">+ {formatMoney(addon, sym)}</div>
        )}
        {selected && (
          <div className="text-xs text-accent font-semibold mt-2">✓ Selected</div>
        )}
      </div>
    </button>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Bottom bar — accessibility + basket + pay
   ════════════════════════════════════════════════════════════════════════════ */

function BottomBar({
  cartCount, cartTotal, sym,
  accessibilityMode, onAccessibility,
  onBasket, onPay, payDisabled,
}: {
  cartCount: number; cartTotal: number; sym: string
  accessibilityMode: boolean; onAccessibility: () => void
  onBasket: () => void; onPay: () => void; payDisabled: boolean
}) {
  return (
    <div className="absolute left-0 right-0 bottom-0 p-3 flex items-center gap-2 bg-white/95 backdrop-blur border-t border-gray-100 z-30">
      {/* Accessibility — bottom-left */}
      <button
        onClick={onAccessibility}
        title={accessibilityMode ? 'Restore full height' : 'Lower the screen for easier reach'}
        className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 ${
          accessibilityMode ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
        }`}
      ><AccessibilityIcon /></button>

      <div className="flex-1" />

      {/* Basket */}
      <button
        onClick={onBasket}
        className="h-14 px-5 rounded-full bg-gray-900 text-white font-bold flex items-center gap-2 hover:bg-black"
      >
        <span>🛒</span>
        <span className="text-base">{cartCount}</span>
        <span className="text-sm opacity-70">·</span>
        <span className="text-base tabular-nums">{formatMoney(cartTotal, sym)}</span>
      </button>

      {/* Pay */}
      <button
        onClick={onPay}
        disabled={payDisabled}
        className="h-14 px-6 rounded-full bg-red-600 text-white font-bold text-base shadow-lg hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
      >PAY →</button>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Basket modal
   ════════════════════════════════════════════════════════════════════════════ */

function BasketModal({
  cart, sym, total,
  onClose, onEdit, onBump, onRemove, onCheckout,
}: {
  cart: CartLine[]; sym: string; total: number
  onClose: () => void
  onEdit: (line: CartLine, target: Walker['jumpToTarget']) => void
  onBump: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onCheckout: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full bg-white rounded-t-3xl shadow-2xl max-h-[85%] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Your basket</h2>
          <button onClick={onClose} className="text-gray-400 text-xl">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {cart.length === 0 ? (
            <div className="text-center text-gray-400 py-12">Your basket is empty.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {cart.map(line => (
                <li key={line.id} className="py-4">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => onEdit(line, null)}
                      className="flex-1 text-left"
                    >
                      <div className="font-bold text-gray-900 text-lg">{line.name}</div>
                      <div className="text-sm text-gray-500">{formatMoney(line.basePrice, sym)}</div>
                      {line.displayLines.length > 0 && (
                        <ul className="mt-2 space-y-0.5">
                          {line.displayLines.map((dl, i) => (
                            <li
                              key={i}
                              className="text-sm"
                              style={{ paddingLeft: `${dl.indent * 12}px` }}
                            >
                              <span className="text-gray-700">{dl.name}</span>
                              {dl.priceAddon > 0 && (
                                <span className="text-gray-400 ml-2">+ {formatMoney(dl.priceAddon, sym)}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>

                    <div className="flex flex-col items-end gap-2">
                      <span className="font-bold text-gray-900 text-lg">
                        {formatMoney(line.total * line.qty, sym)}
                      </span>
                      <div className="flex items-center gap-2 bg-gray-100 rounded-full px-1 py-1">
                        <button onClick={() => onBump(line.id, -1)} className="w-8 h-8 rounded-full bg-white text-gray-700 font-bold">−</button>
                        <span className="w-6 text-center font-semibold">{line.qty}</span>
                        <button onClick={() => onBump(line.id, +1)} className="w-8 h-8 rounded-full bg-white text-gray-700 font-bold">+</button>
                      </div>
                      <button
                        onClick={() => onRemove(line.id)}
                        className="text-xs text-red-500 hover:text-red-700"
                      >Remove</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {cart.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
            <div>
              <div className="text-xs text-gray-500 uppercase tracking-wide">Total</div>
              <div className="text-3xl font-bold text-gray-900 tabular-nums">{formatMoney(total, sym)}</div>
            </div>
            <button
              onClick={onCheckout}
              className="flex-1 py-4 rounded-2xl bg-red-600 text-white text-xl font-bold hover:bg-red-700"
            >Checkout →</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Pay-method picker
   ════════════════════════════════════════════════════════════════════════════ */

function PayMethodPicker({ total, sym, onCard, onCash, onCancel }: {
  total: number; sym: string
  onCard: () => void; onCash: () => void; onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6">
        <div className="text-center mb-6">
          <div className="text-xs text-gray-500 uppercase tracking-wide">Total to pay</div>
          <div className="text-4xl font-bold text-gray-900 tabular-nums">{formatMoney(total, sym)}</div>
        </div>
        <div className="space-y-3">
          <button
            onClick={onCard}
            className="w-full py-6 rounded-2xl bg-emerald-600 text-white text-xl font-bold hover:bg-emerald-700 flex items-center justify-center gap-3"
          >💳 Card</button>
          <button
            onClick={onCash}
            className="w-full py-6 rounded-2xl bg-amber-500 text-white text-xl font-bold hover:bg-amber-600 flex items-center justify-center gap-3"
          >💵 Cash · pay at the till</button>
          <button
            onClick={onCancel}
            className="w-full py-3 text-gray-500 hover:text-gray-700"
          >Back</button>
        </div>
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Payment screen — simulated processing
   ════════════════════════════════════════════════════════════════════════════ */

function PaymentScreen({ method, paying, total, sym, onCancel }: {
  method: 'card' | 'cash' | null; paying: boolean; total: number; sym: string
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900 text-white p-8">
      <div className="text-center">
        {paying ? (
          <>
            <div className="w-20 h-20 mx-auto mb-6 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            <h2 className="text-3xl font-bold mb-2">
              {method === 'card' ? 'Tap or insert your card' : 'Sending order to till…'}
            </h2>
            <p className="text-gray-400">
              {method === 'card' ? 'Do not remove until payment is approved.' : 'Please proceed to the till to pay in cash.'}
            </p>
            <div className="text-5xl font-bold mt-6 tabular-nums">{formatMoney(total, sym)}</div>
          </>
        ) : (
          <button onClick={onCancel} className="text-gray-400">Cancel</button>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════════
   Receipt screen — printable summary + (cash) QR
   ════════════════════════════════════════════════════════════════════════════ */

function ReceiptScreen({ receipt, sym, onDone }: {
  receipt: { id: string; lines: CartLine[]; total: number; method: 'card' | 'cash'; ts: Date }
  sym: string
  onDone: () => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-emerald-50 p-6 overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-xl p-6 mx-auto w-full max-w-md">
        {/* Tick */}
        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <h2 className="text-2xl font-bold text-gray-900 text-center mb-1">
          {receipt.method === 'card' ? 'Payment approved' : 'Order received'}
        </h2>
        <p className="text-sm text-gray-500 text-center mb-5">
          {receipt.method === 'card' ? 'Thank you — your order is on the way.' : 'Show this QR at the till to settle in cash.'}
        </p>

        <div className="border-t border-b border-dashed border-gray-200 py-4 mb-4">
          <div className="flex justify-between text-sm text-gray-500 mb-1">
            <span>Order</span>
            <span className="font-mono">{receipt.id}</span>
          </div>
          <div className="flex justify-between text-sm text-gray-500">
            <span>Time</span>
            <span>{receipt.ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        <ul className="space-y-2 mb-4">
          {receipt.lines.map(l => (
            <li key={l.id} className="flex justify-between text-sm">
              <span className="text-gray-700">{l.qty} × {l.name}</span>
              <span className="font-semibold tabular-nums">{formatMoney(l.total * l.qty, sym)}</span>
            </li>
          ))}
        </ul>

        <div className="flex justify-between items-center pt-4 border-t border-gray-200">
          <span className="text-sm text-gray-500 uppercase tracking-wide">Total</span>
          <span className="text-2xl font-bold tabular-nums">{formatMoney(receipt.total, sym)}</span>
        </div>

        {receipt.method === 'cash' && (
          <div className="mt-5 flex flex-col items-center">
            <DummyQR value={receipt.id} />
            <p className="text-xs text-gray-500 mt-2">Show this code at the till.</p>
          </div>
        )}

        <button
          onClick={onDone}
          className="w-full mt-6 py-4 rounded-2xl bg-accent text-white font-bold"
        >Start a new order</button>
      </div>
    </div>
  )
}

// SVG-based dummy QR — deterministic from the order ID, just to fill the
// space. Real QR generation would pull in a library; this is a mockup.
function DummyQR({ value }: { value: string }) {
  // Hash the value into a 21x21 boolean matrix.
  const N = 21
  const cells: boolean[] = []
  let h = 0
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) | 0
  for (let i = 0; i < N * N; i++) {
    h = (h * 1103515245 + 12345) | 0
    cells.push(((h >> 16) & 1) === 1)
  }
  // Force the three corner finder squares.
  function corner(rx: number, ry: number) {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const on = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
      cells[(ry + r) * N + (rx + c)] = on
    }
  }
  corner(0, 0); corner(N - 7, 0); corner(0, N - 7)

  const SIZE = 168, S = SIZE / N
  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="bg-white p-2 rounded-lg border">
      {cells.map((on, i) => on ? (
        <rect key={i} x={(i % N) * S} y={Math.floor(i / N) * S} width={S} height={S} fill="#000" />
      ) : null)}
    </svg>
  )
}
