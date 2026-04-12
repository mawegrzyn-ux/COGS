import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useApi } from '../hooks/useApi'

/* ── types ──────────────────────────────────────────────────────────────────── */

interface Menu   { id: number; name: string; country_name?: string }
interface PLevel { id: number; name: string }

interface CogsItem {
  menu_item_id: number
  menu_sales_item_id: number
  sales_item_id: number
  item_type: string
  modifier_group_count: number
  display_name: string
  category: string
  sell_price_gross: number
  sell_price_net: number
  tax_rate: number
  cost_per_portion: number
}

interface SubPriceData {
  item_type: string
  combo_steps: ComboStep[]
  modifier_groups: ModGroup[]
}

interface ComboStep {
  id: number
  name: string
  display_name: string | null
  min_select: number
  max_select: number
  auto_select: boolean
  options: ComboOption[]
}

interface ComboOption {
  id: number
  name: string
  display_name: string | null
  item_type: string
  prices: Record<number, number>
  modifier_groups?: ModGroup[]
}

interface ModGroup {
  modifier_group_id: number
  name: string
  display_name: string | null
  min_select: number
  max_select: number
  allow_repeat_selection?: boolean
  auto_show?: boolean
  options: ModOption[]
}

interface ModOption {
  id: number
  name: string
  display_name: string | null
  item_type: string
  prices: Record<number, number>
}

interface Selection { name: string; priceAddon: number }

interface CheckItem {
  name: string
  basePrice: number
  selections: Selection[]   // flat list for receipt/totals
  displayLines: DisplayLine[]  // hierarchical for left panel display
  total: number             // per-unit total (basePrice + addons)
  qty: number               // aggregated count of identical items
  taxRate: number
  // Stored state for recall/editing
  _item?: CogsItem
  _subPrices?: SubPriceData
  _stepSelections?: Record<number, Set<number>>
  _modSelections?: Record<string, Set<number>>
  _modQty?: Record<string, Record<number, number>>
  _resolvedSelections?: Selection[]
}

interface DisplayLine {
  name: string
  priceAddon: number
  indent: number       // 0 = step/option, 1 = modifier under step
}

interface OrderFlow {
  item: CogsItem
  subPrices: SubPriceData
  phase: 'combo' | 'modifiers'
  currentStepIdx: number
  stepSelections: Record<number, Set<number>>   // stepId -> set of option IDs
  modSelections: Record<string, Set<number>>      // modGroupId or "stepId_mgId" -> set of option IDs
  modQty: Record<string, Record<number, number>>  // key -> { optionId: qty } for allow_repeat_selection groups
  resolvedSelections: Selection[]                // accumulated from finished combo steps
}

/* ── icons ──────────────────────────────────────────────────────────────────── */

function ExpandIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
      <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}

function ShrinkIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
      <line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/>
    </svg>
  )
}

/* ── main component ─────────────────────────────────────────────────────────── */

export default function PosTesterPage() {
  const api = useApi()

  // ── menu / level selectors ──
  const [menus, setMenus] = useState<Menu[]>([])
  const [levels, setLevels] = useState<PLevel[]>([])
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null)
  const [selectedLevelId, setSelectedLevelId] = useState<number | null>(null)

  // ── menu data ──
  const [menuItems, setMenuItems] = useState<CogsItem[]>([])
  const [currencySymbol, setCurrencySymbol] = useState('$')
  const [loading, setLoading] = useState(false)

  // ── categories (for grouped display) ──
  const categories = useMemo(
    () => [...new Set(menuItems.map(i => i.category || 'Other'))].sort(),
    [menuItems],
  )

  // ── check (order) ──
  const [checkItems, setCheckItems] = useState<CheckItem[]>([])

  // ── order flow (combo/modifier config) ──
  const [orderFlow, setOrderFlow] = useState<OrderFlow | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)  // index in checkItems being edited

  // ── receipt modal ──
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptData, setReceiptData] = useState<CheckItem[]>([])

  // ── fullscreen ──
  const [isFullscreen, setIsFullscreen] = useState(false)

  // ── modifier popup (for hidden/optional modifiers) ──
  const [modPopup, setModPopup] = useState<ModGroup | null>(null)

  /* ── load menus + levels on mount ──────────────────────────────────────────── */

  const loadInit = useCallback(async () => {
    try {
      const [m, l] = await Promise.all([api.get('/menus'), api.get('/price-levels')])
      setMenus(m || [])
      setLevels(l || [])
      if (m?.length) setSelectedMenuId(m[0].id)
      if (l?.length) setSelectedLevelId(l[0].id)
    } catch { /* silent */ }
  }, [api])

  useEffect(() => { loadInit() }, [loadInit])

  /* ── load menu items when menu/level change ────────────────────────────────── */

  const loadMenu = useCallback(async () => {
    if (!selectedMenuId) return
    setLoading(true)
    try {
      const lvlParam = selectedLevelId ? `?price_level_id=${selectedLevelId}` : ''
      const data = await api.get(`/cogs/menu-sales/${selectedMenuId}${lvlParam}`)
      setMenuItems(data?.items || [])
      setCurrencySymbol(data?.currency_symbol || '$')
    } catch {
      setMenuItems([])
    } finally {
      setLoading(false)
    }
  }, [api, selectedMenuId, selectedLevelId])

  useEffect(() => { loadMenu() }, [loadMenu])

  /* ── check helpers ──────────────────────────────────────────────────────────── */

  const addToCheck = useCallback((item: CheckItem) => {
    setCheckItems(prev => {
      // Check if an identical item exists (same name + same selections fingerprint)
      const fingerprint = item.name + '|' + item.selections.map(s => `${s.name}:${s.priceAddon}`).join(',')
      const existingIdx = prev.findIndex(ci => {
        const fp = ci.name + '|' + ci.selections.map(s => `${s.name}:${s.priceAddon}`).join(',')
        return fp === fingerprint
      })
      if (existingIdx >= 0) {
        // Aggregate — increment qty
        return prev.map((ci, i) => i === existingIdx ? { ...ci, qty: ci.qty + 1 } : ci)
      }
      return [...prev, { ...item, qty: item.qty || 1 }]
    })
  }, [])

  const removeFromCheck = useCallback((idx: number) => {
    setCheckItems(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const clearCheck = useCallback(() => setCheckItems([]), [])

  const sym = currencySymbol

  const subtotal = useMemo(() => checkItems.reduce((s, i) => s + i.total * i.qty, 0), [checkItems])
  const tax = useMemo(
    () => checkItems.reduce((s, i) => { const t = i.total * i.qty; return s + (i.taxRate > 0 ? t - t / (1 + i.taxRate) : 0) }, 0),
    [checkItems],
  )
  const total = subtotal

  /* ── item tap ───────────────────────────────────────────────────────────────── */

  const handleItemTap = useCallback(async (item: CogsItem) => {
    // Simple item — add directly
    if (item.item_type !== 'combo' && (!item.modifier_group_count || item.modifier_group_count === 0)) {
      addToCheck({
        name: item.display_name,
        basePrice: item.sell_price_gross,
        selections: [],
        displayLines: [],
        total: item.sell_price_gross,
        qty: 1,
        taxRate: item.tax_rate || 0,
      })
      return
    }

    // Complex item — load sub-prices
    try {
      const subPrices: SubPriceData = await api.get(
        `/menu-sales-items/${item.menu_sales_item_id}/sub-prices`,
      )
      const isCombo = item.item_type === 'combo' && subPrices.combo_steps?.length > 0
      setOrderFlow({
        item,
        subPrices,
        phase: isCombo ? 'combo' : 'modifiers',
        currentStepIdx: 0,
        stepSelections: {},
        modSelections: {},
        modQty: {},
        resolvedSelections: [],
      })
    } catch {
      // fallback — add as simple
      addToCheck({
        name: item.display_name,
        basePrice: item.sell_price_gross,
        selections: [],
        displayLines: [],
        total: item.sell_price_gross,
        qty: 1,
        taxRate: item.tax_rate || 0,
      })
    }
  }, [api, addToCheck])

  /* ── order flow helpers ─────────────────────────────────────────────────────── */

  function toggleStepOption(stepId: number, optId: number, maxSelect: number) {
    setOrderFlow(prev => {
      if (!prev) return prev
      const cur = new Set(prev.stepSelections[stepId] || [])
      if (cur.has(optId)) { cur.delete(optId) }
      else {
        if (maxSelect === 1) cur.clear()
        if (cur.size < maxSelect) cur.add(optId)
      }
      return { ...prev, stepSelections: { ...prev.stepSelections, [stepId]: cur } }
    })
  }

  function toggleModOption(mgId: number, optId: number, maxSelect: number) {
    setOrderFlow(prev => {
      if (!prev) return prev
      const cur = new Set(prev.modSelections[mgId] || [])
      if (cur.has(optId)) { cur.delete(optId) }
      else {
        if (maxSelect === 1) cur.clear()
        if (cur.size < maxSelect) cur.add(optId)
      }
      return { ...prev, modSelections: { ...prev.modSelections, [mgId]: cur } }
    })
  }

  function toggleComboStepModifier(key: string, optId: number, _minSel: number, maxSel: number) {
    setOrderFlow(prev => {
      if (!prev) return prev
      const current = prev.modSelections[key] || new Set()
      const next = new Set(current)
      if (next.has(optId)) {
        next.delete(optId)
      } else {
        if (maxSel === 1) {
          // Radio: replace
          next.clear()
          next.add(optId)
        } else if (next.size < maxSel) {
          next.add(optId)
        }
      }
      return { ...prev, modSelections: { ...prev.modSelections, [key]: next } }
    })
  }

  function adjustModQty(key: string, optId: number, delta: number, maxSelect: number) {
    setOrderFlow(prev => {
      if (!prev) return prev
      const existing = prev.modQty?.[key] || {}
      const current = existing[optId] || 0
      const next = Math.max(0, current + delta)

      // Enforce max_select: total count across all options in this group must not exceed max
      if (delta > 0 && maxSelect > 0) {
        const totalOthers = Object.entries(existing).reduce((sum, [id, q]) => sum + (String(id) === String(optId) ? 0 : (q as number)), 0)
        if (totalOthers + next > maxSelect) return prev
      }

      const newQty = { ...prev.modQty, [key]: { ...existing, [optId]: next } }

      // Keep modSelections in sync for validation
      const newSel = { ...prev.modSelections }
      if (!newSel[key]) newSel[key] = new Set()
      if (next > 0) {
        newSel[key] = new Set([...newSel[key], optId])
      } else {
        const s = new Set(newSel[key])
        s.delete(optId)
        newSel[key] = s
      }

      return { ...prev, modQty: newQty, modSelections: newSel }
    })
  }

  function advanceStep() {
    if (!orderFlow) return
    const steps = orderFlow.subPrices.combo_steps
    const step = steps[orderFlow.currentStepIdx]
    if (!step) return

    // Resolve selections for this step
    const selectedIds = orderFlow.stepSelections[step.id] || new Set()
    const newSels: Selection[] = []
    for (const opt of step.options) {
      if (selectedIds.has(opt.id)) {
        const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
        newSels.push({ name: opt.display_name || opt.name, priceAddon: price })
      }
    }
    const merged = [...orderFlow.resolvedSelections, ...newSels]

    const nextIdx = orderFlow.currentStepIdx + 1
    if (nextIdx < steps.length) {
      setOrderFlow({ ...orderFlow, currentStepIdx: nextIdx, resolvedSelections: merged })
    } else {
      // Done with combo steps — move to modifiers (item-level)
      if (orderFlow.subPrices.modifier_groups?.length > 0) {
        setOrderFlow({ ...orderFlow, phase: 'modifiers', resolvedSelections: merged })
      } else {
        // No item-level modifiers — add to check (but keep combo step modifiers)
        finalizeOrderFlow(merged)
      }
    }
  }

  function finalizeOrderFlow(sels?: Selection[], modSels?: Record<string, Set<number>>) {
    if (!orderFlow) return
    const selections = sels || orderFlow.resolvedSelections
    const modSelections = modSels || orderFlow.modSelections

    // Resolve item-level modifier selections (with repeat qty support)
    const modSelsArr: Selection[] = []
    const qtyMap = orderFlow.modQty || {}
    for (const mg of (orderFlow.subPrices.modifier_groups || [])) {
      const mgKey = String(mg.modifier_group_id)
      const chosen = modSelections[mg.modifier_group_id] || new Set()
      for (const opt of mg.options) {
        const qty = mg.allow_repeat_selection ? (qtyMap[mgKey]?.[opt.id] || 0) : (chosen.has(opt.id) ? 1 : 0)
        if (qty > 0) {
          const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
          modSelsArr.push({ name: qty > 1 ? `${opt.display_name || opt.name} x${qty}` : (opt.display_name || opt.name), priceAddon: price * qty })
        }
      }
    }

    // Resolve combo step option modifier selections (keys: "stepId_mgId")
    for (const step of (orderFlow.subPrices.combo_steps || [])) {
      const selectedOptIds = orderFlow.stepSelections[step.id] || new Set()
      for (const stepOpt of step.options) {
        if (!selectedOptIds.has(stepOpt.id)) continue
        for (const mg of (stepOpt.modifier_groups || [])) {
          const modKey = `${step.id}_${mg.modifier_group_id}`
          const chosen = modSelections[modKey] || new Set()
          for (const opt of mg.options) {
            const qty = mg.allow_repeat_selection ? (qtyMap[modKey]?.[opt.id] || 0) : (chosen.has(opt.id) ? 1 : 0)
            if (qty > 0) {
              const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
              modSelsArr.push({ name: qty > 1 ? `${opt.display_name || opt.name} x${qty}` : (opt.display_name || opt.name), priceAddon: price * qty })
            }
          }
        }
      }
    }

    const allSels = [...selections, ...modSelsArr]
    const addonTotal = allSels.reduce((s, sel) => s + sel.priceAddon, 0)

    // Build hierarchical display lines: step options with their modifiers nested below
    const displayLines: DisplayLine[] = []

    // Combo step selections with their modifiers
    for (const step of (orderFlow.subPrices.combo_steps || [])) {
      const selectedOptIds = orderFlow.stepSelections[step.id] || new Set()
      for (const stepOpt of step.options) {
        if (!selectedOptIds.has(stepOpt.id)) continue
        const optPrice = selectedLevelId ? (stepOpt.prices?.[selectedLevelId] || 0) : 0
        displayLines.push({ name: stepOpt.display_name || stepOpt.name, priceAddon: optPrice, indent: 0 })
        // Modifiers for this step option
        for (const mg of (stepOpt.modifier_groups || [])) {
          const modKey = `${step.id}_${mg.modifier_group_id}`
          const chosen = modSelections[modKey] || new Set()
          for (const opt of mg.options) {
            const qty = mg.allow_repeat_selection ? (qtyMap[modKey]?.[opt.id] || 0) : (chosen.has(opt.id) ? 1 : 0)
            if (qty > 0) {
              const price = selectedLevelId ? (opt.prices?.[selectedLevelId] || 0) : 0
              displayLines.push({ name: qty > 1 ? `${opt.display_name || opt.name} x${qty}` : (opt.display_name || opt.name), priceAddon: price * qty, indent: 1 })
            }
          }
        }
      }
    }

    // Item-level modifier selections
    for (const mg of (orderFlow.subPrices.modifier_groups || [])) {
      const mgKey = String(mg.modifier_group_id)
      const chosen = modSelections[mg.modifier_group_id] || new Set()
      for (const opt of mg.options) {
        const qty = mg.allow_repeat_selection ? (qtyMap[mgKey]?.[opt.id] || 0) : (chosen.has(opt.id) ? 1 : 0)
        if (qty > 0) {
          const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
          displayLines.push({ name: qty > 1 ? `${opt.display_name || opt.name} x${qty}` : (opt.display_name || opt.name), priceAddon: price * qty, indent: 0 })
        }
      }
    }

    const checkItem: CheckItem = {
      name: orderFlow.item.display_name,
      basePrice: orderFlow.item.sell_price_gross,
      selections: allSels,
      displayLines,
      total: orderFlow.item.sell_price_gross + addonTotal,
      qty: 1,
      taxRate: orderFlow.item.tax_rate || 0,
      // Store state for recall
      _item: orderFlow.item,
      _subPrices: orderFlow.subPrices,
      _stepSelections: orderFlow.stepSelections,
      _modSelections: orderFlow.modSelections,
      _modQty: orderFlow.modQty,
      _resolvedSelections: selections,
    }

    if (editingIdx !== null) {
      // Replace existing item
      setCheckItems(prev => prev.map((ci, i) => i === editingIdx ? checkItem : ci))
      setEditingIdx(null)
    } else {
      addToCheck(checkItem)
    }
    setOrderFlow(null)
    setModPopup(null)
  }

  /* ── order flow validation ──────────────────────────────────────────────────── */

  const canAdvanceStep = useMemo(() => {
    if (!orderFlow || orderFlow.phase !== 'combo') return false
    const step = orderFlow.subPrices.combo_steps[orderFlow.currentStepIdx]
    if (!step) return false
    const chosen = orderFlow.stepSelections[step.id] || new Set()
    if (chosen.size < step.min_select) return false
    // Also check modifier requirements on selected options
    for (const optId of Array.from(chosen)) {
      const opt = step.options.find((o: any) => o.id === optId)
      if (!opt?.modifier_groups?.length) continue
      for (const mg of opt.modifier_groups) {
        const modKey = `${step.id}_${mg.modifier_group_id}`
        if (mg.allow_repeat_selection) {
          const qtyMap = orderFlow.modQty?.[modKey] || {}
          const totalQty = Object.values(qtyMap).reduce((sum: number, q) => sum + (q as number), 0)
          if (totalQty < mg.min_select) return false
        } else {
          const modCount = (orderFlow.modSelections[modKey] || new Set()).size
          if (modCount < mg.min_select) return false
        }
      }
    }
    return true
  }, [orderFlow])

  const allModsMet = useMemo(() => {
    if (!orderFlow) return true
    for (const mg of (orderFlow.subPrices.modifier_groups || [])) {
      if (mg.allow_repeat_selection) {
        // For repeat groups, count total qty across all options
        const qtyMap = orderFlow.modQty?.[String(mg.modifier_group_id)] || {}
        const totalQty = Object.values(qtyMap).reduce((sum: number, q) => sum + (q as number), 0)
        if (totalQty < mg.min_select) return false
      } else {
        const count = (orderFlow.modSelections[mg.modifier_group_id] || new Set()).size
        if (count < mg.min_select) return false
      }
    }
    return true
  }, [orderFlow])

  /* ── order flow running total ───────────────────────────────────────────────── */

  const itemRunningTotal = useMemo(() => {
    if (!orderFlow) return 0
    let total = orderFlow.item.sell_price_gross
    // Combo step selections
    for (const sel of orderFlow.resolvedSelections) total += sel.priceAddon
    // Current step (combo)
    if (orderFlow.phase === 'combo') {
      const step = orderFlow.subPrices.combo_steps[orderFlow.currentStepIdx]
      if (step) {
        const chosen = orderFlow.stepSelections[step.id] || new Set()
        for (const opt of step.options) {
          if (chosen.has(opt.id)) {
            total += selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
          }
        }
      }
    }
    // Item-level modifier selections (with repeat qty)
    const qtyMap = orderFlow.modQty || {}
    for (const mg of (orderFlow.subPrices.modifier_groups || [])) {
      const mgKey = String(mg.modifier_group_id)
      const chosen = orderFlow.modSelections[mg.modifier_group_id] || new Set()
      for (const opt of mg.options) {
        const qty = mg.allow_repeat_selection ? (qtyMap[mgKey]?.[opt.id] || 0) : (chosen.has(opt.id) ? 1 : 0)
        if (qty > 0) total += (selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0) * qty
      }
    }
    // Combo step option modifier selections (with repeat qty)
    for (const step of (orderFlow.subPrices.combo_steps || [])) {
      const selectedOptIds = orderFlow.stepSelections[step.id] || new Set()
      for (const stepOpt of step.options) {
        if (!selectedOptIds.has(stepOpt.id)) continue
        for (const mg of (stepOpt.modifier_groups || [])) {
          const modKey = `${step.id}_${mg.modifier_group_id}`
          const chosen = orderFlow.modSelections[modKey] || new Set()
          for (const opt of mg.options) {
            const qty = mg.allow_repeat_selection ? (qtyMap[modKey]?.[opt.id] || 0) : (chosen.has(opt.id) ? 1 : 0)
            if (qty > 0) total += (selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0) * qty
          }
        }
      }
    }
    return total
  }, [orderFlow, selectedLevelId])

  /* ── pay / receipt ──────────────────────────────────────────────────────────── */

  function handlePay() {
    setReceiptData([...checkItems])
    setShowReceipt(true)
  }

  /* ── fullscreen ─────────────────────────────────────────────────────────────── */

  function toggleFullscreen() { setIsFullscreen(f => !f) }

  // ESC exits fullscreen overlay
  useEffect(() => {
    if (!isFullscreen) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setIsFullscreen(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isFullscreen])

  /* ── auto-advance single-choice combo steps ─────────────────────────────────── */

  useEffect(() => {
    if (!orderFlow) return
    if (orderFlow.phase !== 'combo') return
    const steps = orderFlow.subPrices.combo_steps
    if (!steps?.length) return
    const step = steps[orderFlow.currentStepIdx]
    if (!step) return
    // Auto-select and advance if single option with min=max=1 AND no modifiers on the option
    if (step.options.length === 1 && step.min_select === 1 && step.max_select === 1) {
      const opt = step.options[0]
      const hasModifiers = (opt.modifier_groups?.length ?? 0) > 0
      // Auto-select the option (even if it has modifiers — user still needs to see it selected)
      setOrderFlow(prev => {
        if (!prev) return prev
        const alreadySelected = prev.stepSelections[step.id]?.has(opt.id)
        if (alreadySelected && !hasModifiers) {
          // Already selected + no modifiers → advance
          const nextIdx = prev.currentStepIdx + 1
          if (nextIdx < prev.subPrices.combo_steps.length) {
            return { ...prev, currentStepIdx: nextIdx }
          }
          return prev
        }
        // Select the option but DON'T advance if it has modifiers (user needs to choose mods)
        const newStepSel = { ...prev.stepSelections, [step.id]: new Set([opt.id]) }
        if (!hasModifiers) {
          const nextIdx = prev.currentStepIdx + 1
          if (nextIdx < prev.subPrices.combo_steps.length) {
            return { ...prev, stepSelections: newStepSel, currentStepIdx: nextIdx }
          }
        }
        return { ...prev, stepSelections: newStepSel }
      })
    }
  }, [orderFlow?.currentStepIdx, orderFlow?.phase])

  /* ── receipt totals ─────────────────────────────────────────────────────────── */

  const receiptSubtotal = useMemo(() => receiptData.reduce((s, i) => s + i.total * i.qty, 0), [receiptData])
  const receiptTax = useMemo(
    () => receiptData.reduce((s, i) => { const t = i.total * i.qty; return s + (i.taxRate > 0 ? t - t / (1 + i.taxRate) : 0) }, 0),
    [receiptData],
  )
  const receiptTotal = receiptSubtotal

  /* ── render: current combo step / modifier content ──────────────────────────── */

  // Top block: combo step navigation + step options (compact)
  function renderComboStepSection() {
    if (!orderFlow || orderFlow.phase !== 'combo') return null
    const subPrices = orderFlow.subPrices
    const step = subPrices.combo_steps[orderFlow.currentStepIdx]
    if (!step) return null
    const chosen = orderFlow.stepSelections[step.id] || new Set()
    const isRadio = step.max_select === 1

    return (
      <div>
        {/* Step navigation pills */}
        {subPrices.combo_steps.length > 1 && (
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {subPrices.combo_steps.map((s: any, idx: number) => {
              const isActive = idx === orderFlow.currentStepIdx
              const isCompleted = (orderFlow.stepSelections[s.id]?.size || 0) >= s.min_select
              return (
                <button key={s.id} onClick={() => setOrderFlow((prev: any) => prev ? { ...prev, currentStepIdx: idx } : prev)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors
                    ${isActive ? 'bg-accent text-white' : isCompleted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  <span>{idx + 1} {s.display_name || s.name}</span>
                  {isCompleted && !isActive && <span>&#10003;</span>}
                </button>
              )
            })}
          </div>
        )}

        <p className="text-xs font-semibold text-gray-700 mb-1.5">
          {step.name}
          <span className="text-gray-400 font-normal ml-1">
            ({isRadio ? `choose ${step.min_select}` : `${step.min_select}-${step.max_select}`})
          </span>
        </p>
        <div className="space-y-1">
          {step.options.map((opt: any) => {
            const sel = chosen.has(opt.id)
            const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
            return (
              <button key={opt.id} onClick={() => toggleStepOption(step.id, opt.id, step.max_select)}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-left text-base transition-all active:scale-[0.98]
                  ${sel ? 'border-accent bg-accent/5 ring-1 ring-accent/30' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                <div className={`w-5 h-5 rounded-${isRadio ? 'full' : 'md'} border-2 flex items-center justify-center shrink-0
                  ${sel ? 'border-accent bg-accent' : 'border-gray-300'}`}>
                  {sel && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>}
                </div>
                <span className="flex-1 truncate">{opt.display_name || opt.name}</span>
                {price > 0 && <span className="text-[10px] text-gray-500 shrink-0">+{sym}{price.toFixed(2)}</span>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Bottom block: modifiers for selected combo step option
  function renderComboStepModifiers() {
    if (!orderFlow || orderFlow.phase !== 'combo') return null
    const step = orderFlow.subPrices.combo_steps[orderFlow.currentStepIdx]
    if (!step) return null
    const chosen = orderFlow.stepSelections[step.id] || new Set()
    const selectedOptIds = Array.from(chosen)
    const selectedOption = selectedOptIds.length === 1 ? step.options.find((o: any) => o.id === selectedOptIds[0]) : null

    if (!selectedOption?.modifier_groups?.length) {
      return (
        <div className="flex items-center justify-center h-full text-gray-300 text-xs">
          {chosen.size === 0 ? 'Select an option above' : 'No modifiers for this option'}
        </div>
      )
    }

    return (
      <div className="space-y-3">
        <p className="text-[10px] font-bold uppercase tracking-wider text-purple-500">Modifiers</p>
        {selectedOption.modifier_groups.map((mg: any) => (
          <div key={mg.modifier_group_id}>
            <p className="text-xs font-semibold text-gray-700 mb-1">
              {mg.display_name || mg.name}
              <span className="text-gray-400 font-normal ml-1">
                (choose {mg.min_select === mg.max_select ? mg.min_select : `${mg.min_select}-${mg.max_select}`})
              </span>
            </p>
            <div className="space-y-1">
              {mg.options.map((opt: any) => {
                const modKey = `${step.id}_${mg.modifier_group_id}`
                const isSelected = orderFlow.modSelections[modKey]?.has(opt.id)
                const priceAddon = selectedLevelId ? (opt.prices?.[selectedLevelId] || 0) : 0
                const qty = orderFlow.modQty?.[modKey]?.[opt.id] || 0
                return mg.allow_repeat_selection ? (
                  <div key={opt.id} className={`flex items-center gap-2 px-3 py-3 rounded-lg border ${qty > 0 ? 'border-purple-300 bg-purple-50/50' : 'border-gray-200'}`}>
                    <button onClick={() => adjustModQty(modKey, opt.id, -1, mg.max_select)} disabled={qty === 0}
                      className="w-9 h-9 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-20 text-base font-bold shrink-0 active:scale-95">−</button>
                    <span className={`w-6 text-center text-base font-bold shrink-0 ${qty > 0 ? 'text-purple-700' : 'text-gray-300'}`}>{qty}</span>
                    <button onClick={() => adjustModQty(modKey, opt.id, 1, mg.max_select)}
                      className="flex-1 text-left text-base text-gray-800 hover:text-purple-700 transition-colors py-1">
                      {opt.display_name || opt.name}
                    </button>
                    <span className="text-xs text-gray-400 shrink-0">{priceAddon > 0 ? `+${sym}${priceAddon.toFixed(2)}/ea` : 'incl.'}</span>
                  </div>
                ) : (
                  <button key={opt.id}
                    onClick={() => toggleComboStepModifier(modKey, opt.id, mg.min_select, mg.max_select)}
                    className={`w-full flex items-center justify-between px-3 py-3 rounded-lg border text-sm transition-colors
                      ${isSelected ? 'border-purple-300 bg-purple-50 text-purple-800' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                    <span>{opt.display_name || opt.name}</span>
                    <span className="text-[10px] text-gray-500">{priceAddon > 0 ? `+${sym}${priceAddon.toFixed(2)}` : 'incl.'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  function renderOrderFlowContent() {
    if (!orderFlow) return null

    if (orderFlow.phase === 'combo') {
      const subPrices = orderFlow.subPrices
      const step = subPrices.combo_steps[orderFlow.currentStepIdx]
      if (!step) return null
      const chosen = orderFlow.stepSelections[step.id] || new Set()
      const isRadio = step.max_select === 1

      // Find the selected option for this step (to show its modifiers)
      const selectedOptIds = Array.from(chosen)
      const selectedOption = selectedOptIds.length === 1
        ? step.options.find(o => o.id === selectedOptIds[0]) || null
        : null

      const isStepComplete = chosen.size >= step.min_select

      return (
        <div>
          {/* Step navigation dots/tabs */}
          {subPrices.combo_steps.length > 1 && (
            <div className="flex items-center gap-1 mb-3 flex-wrap">
              {subPrices.combo_steps.map((s, idx) => {
                const isActive = idx === orderFlow.currentStepIdx
                const isCompleted = (orderFlow.stepSelections[s.id]?.size || 0) >= s.min_select
                return (
                  <button key={s.id} onClick={() => setOrderFlow(prev => prev ? { ...prev, currentStepIdx: idx } : prev)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors
                      ${isActive ? 'bg-accent text-white' : isCompleted ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                    <span>{idx + 1}</span>
                    <span className="hidden sm:inline truncate max-w-[80px]">{s.display_name || s.name}</span>
                    {isCompleted && !isActive && <span className="ml-0.5">&#10003;</span>}
                  </button>
                )
              })}
            </div>
          )}

          <div className="mb-3">
            <p className="text-sm font-bold text-gray-800">{step.name}</p>
            <p className="text-xs text-gray-500">
              {isRadio
                ? `Choose ${step.min_select}`
                : `Select ${step.min_select}${step.max_select > step.min_select ? ` to ${step.max_select}` : ''}`}
            </p>
          </div>
          <div className="space-y-1.5">
            {step.options.map(opt => {
              const sel = chosen.has(opt.id)
              const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
              return (
                <button key={opt.id} onClick={() => toggleStepOption(step.id, opt.id, step.max_select)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all
                    ${sel
                      ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                      : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <div className={`w-5 h-5 rounded-${isRadio ? 'full' : 'md'} border-2 flex items-center justify-center shrink-0 transition-colors
                    ${sel ? 'border-accent bg-accent' : 'border-gray-300'}`}>
                    {sel && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{opt.display_name || opt.name}</p>
                  </div>
                  {price > 0 && (
                    <span className="text-xs font-medium text-gray-500 shrink-0">+{sym}{price.toFixed(2)}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Modifiers for selected option (within combo step) */}
          {selectedOption?.modifier_groups && selectedOption.modifier_groups.length > 0 && (() => {
            const comboAutoShow = selectedOption.modifier_groups.filter(mg => mg.auto_show !== false)
            const comboHidden = selectedOption.modifier_groups.filter(mg => mg.auto_show === false && mg.min_select === 0)
            return (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <p className="text-[10px] font-bold uppercase tracking-wider text-purple-500 mb-2">Modifiers</p>
              {/* Hidden optional combo modifiers — compact buttons */}
              {comboHidden.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {comboHidden.map(mg => {
                    const modKey = `${step.id}_${mg.modifier_group_id}`
                    const chosen = orderFlow.modSelections[modKey] || new Set()
                    return (
                      <button key={mg.modifier_group_id}
                        onClick={() => setModPopup({ ...mg, _comboStepId: step.id } as any)}
                        className={`px-3 py-2 rounded-lg border border-dashed text-xs font-medium transition-colors
                          ${chosen.size > 0 ? 'border-purple-400 text-purple-600 bg-purple-50' : 'border-gray-300 text-gray-500 hover:border-purple-400 hover:text-purple-600'}`}>
                        + {mg.display_name || mg.name}
                        {chosen.size > 0 && <span className="ml-1 text-[10px]">&#10003;</span>}
                      </button>
                    )
                  })}
                </div>
              )}
              {/* Auto-show combo modifiers — inline */}
              {comboAutoShow.map(mg => (
                <div key={mg.modifier_group_id} className="mb-3">
                  <p className="text-xs font-semibold text-gray-700 mb-1">
                    {mg.display_name || mg.name}
                    <span className="text-gray-400 font-normal ml-1">
                      (choose {mg.min_select === mg.max_select ? mg.min_select : `${mg.min_select}-${mg.max_select}`})
                    </span>
                  </p>
                  <div className="space-y-1">
                    {mg.options.map(opt => {
                      const modKey = `${step.id}_${mg.modifier_group_id}`
                      const isSelected = orderFlow.modSelections[modKey]?.has(opt.id)
                      const priceAddon = selectedLevelId ? (opt.prices?.[selectedLevelId] || 0) : 0
                      return (
                        <button key={opt.id}
                          onClick={() => toggleComboStepModifier(modKey, opt.id, mg.min_select, mg.max_select)}
                          className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-sm transition-colors
                            ${isSelected ? 'border-purple-300 bg-purple-50 text-purple-800' : 'border-gray-200 text-gray-700 hover:border-gray-300'}`}>
                          <span>{opt.display_name || opt.name}</span>
                          <span className="text-xs text-gray-500">
                            {priceAddon > 0 ? `+${sym}${priceAddon.toFixed(2)}` : 'incl.'}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            )
          })()}

          <div className="flex items-center justify-between mt-4">
            <button disabled={orderFlow.currentStepIdx === 0}
              onClick={() => setOrderFlow(prev => prev ? { ...prev, currentStepIdx: prev.currentStepIdx - 1 } : prev)}
              className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-30">
              &larr; Previous
            </button>
            <span className="text-xs text-gray-400">Step {orderFlow.currentStepIdx + 1} of {subPrices.combo_steps.length}</span>
            {orderFlow.currentStepIdx < subPrices.combo_steps.length - 1 ? (
              <button disabled={!isStepComplete}
                onClick={advanceStep}
                className="text-xs text-accent hover:text-accent-mid disabled:opacity-30 font-medium">
                Next &rarr;
              </button>
            ) : (
              <button onClick={advanceStep} disabled={!canAdvanceStep}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent-mid disabled:bg-gray-300 transition-colors">
                Continue
              </button>
            )}
          </div>
        </div>
      )
    }

    // Modifiers phase — split into auto-show (inline) and hidden (popup buttons)
    const autoShowGroups = orderFlow.subPrices.modifier_groups.filter(mg => mg.auto_show !== false)
    const hiddenGroups = orderFlow.subPrices.modifier_groups.filter(mg => mg.auto_show === false && mg.min_select === 0)

    return (
      <div className="space-y-5">
        {/* Hidden optional modifier groups — shown as compact buttons */}
        {hiddenGroups.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {hiddenGroups.map(mg => {
              const chosen = orderFlow.modSelections[mg.modifier_group_id] || new Set()
              const hasSelections = chosen.size > 0 || (orderFlow.modQty?.[String(mg.modifier_group_id)] && Object.values(orderFlow.modQty[String(mg.modifier_group_id)]).some(q => q > 0))
              return (
                <button key={mg.modifier_group_id}
                  onClick={() => setModPopup(mg)}
                  className={`px-3 py-2 rounded-lg border border-dashed text-xs font-medium transition-colors
                    ${hasSelections ? 'border-accent text-accent bg-accent/5' : 'border-gray-300 text-gray-500 hover:border-accent hover:text-accent'}`}>
                  + {mg.display_name || mg.name}
                  {hasSelections && <span className="ml-1 text-[10px]">&#10003;</span>}
                </button>
              )
            })}
          </div>
        )}

        {/* Auto-show modifier groups — rendered inline */}
        {autoShowGroups.map(mg => {
          const chosen = orderFlow.modSelections[mg.modifier_group_id] || new Set()
          const isRadio = mg.max_select === 1
          const metMin = chosen.size >= mg.min_select

          return (
            <div key={mg.modifier_group_id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-gray-800">{mg.display_name || mg.name}</p>
                  <p className="text-xs text-gray-500">
                    {mg.min_select === 0
                      ? `Optional (up to ${mg.max_select})`
                      : isRadio
                        ? `Choose ${mg.min_select}`
                        : `Select ${mg.min_select} to ${mg.max_select}`}
                  </p>
                </div>
                {metMin && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#146A34" strokeWidth="2.5" strokeLinecap="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
              <div className="space-y-1">
                {mg.options.map(opt => {
                  const sel = chosen.has(opt.id)
                  const price = selectedLevelId ? (opt.prices[selectedLevelId] || 0) : 0
                  const modKey = String(mg.modifier_group_id)
                  const qty = orderFlow.modQty?.[modKey]?.[opt.id] || 0
                  return mg.allow_repeat_selection ? (
                    <div key={opt.id} className={`flex items-center gap-2 px-3 py-3 rounded-lg border transition-colors ${qty > 0 ? 'border-accent bg-accent/5' : 'border-gray-200'}`}>
                      <button onClick={() => adjustModQty(modKey, opt.id, -1, mg.max_select)} disabled={qty === 0}
                        className="w-9 h-9 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-20 text-base font-bold shrink-0 active:scale-95">&#8722;</button>
                      <span className={`w-6 text-center text-base font-bold shrink-0 ${qty > 0 ? 'text-accent' : 'text-gray-300'}`}>{qty}</span>
                      <button onClick={() => adjustModQty(modKey, opt.id, 1, mg.max_select)}
                        className="flex-1 text-left text-base text-gray-800 hover:text-accent transition-colors truncate py-1">
                        {opt.display_name || opt.name}
                      </button>
                      <span className="text-xs text-gray-400 shrink-0">{price > 0 ? `+${sym}${price.toFixed(2)}/ea` : 'incl.'}</span>
                    </div>
                  ) : (
                    <button key={opt.id} onClick={() => toggleModOption(mg.modifier_group_id, opt.id, mg.max_select)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg border text-left text-base transition-all active:scale-[0.98]
                        ${sel
                          ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                          : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                      <div className={`w-5 h-5 rounded-${isRadio ? 'full' : 'md'} border-2 flex items-center justify-center shrink-0 transition-colors
                        ${sel ? 'border-accent bg-accent' : 'border-gray-300'}`}>
                        {sel && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        )}
                      </div>
                      <span className="flex-1 text-sm text-gray-800 truncate">{opt.display_name || opt.name}</span>
                      {price > 0 && (
                        <span className="text-xs font-medium text-gray-500 shrink-0">+{sym}{price.toFixed(2)}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  /* ── render ──────────────────────────────────────────────────────────────────── */

  const posContent = (
    <div className={`flex flex-col bg-gray-100 ${isFullscreen ? 'fixed inset-0 z-[9999]' : 'h-full'}`}>
      {/* ── header bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 text-white shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide">POS Mockup</h1>
          <select
            value={selectedMenuId ?? ''}
            onChange={e => setSelectedMenuId(Number(e.target.value) || null)}
            className="bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-gray-500"
          >
            {menus.map(m => (
              <option key={m.id} value={m.id}>{m.name}{m.country_name ? ` (${m.country_name})` : ''}</option>
            ))}
          </select>
          <select
            value={selectedLevelId ?? ''}
            onChange={e => setSelectedLevelId(Number(e.target.value) || null)}
            className="bg-gray-800 text-white text-sm rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-gray-500"
          >
            {levels.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={toggleFullscreen} className="text-gray-400 hover:text-white p-1" title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
            {isFullscreen ? <ShrinkIcon /> : <ExpandIcon />}
          </button>
          <button onClick={() => window.history.back()} className="text-gray-400 hover:text-white text-xs px-2 py-1">
            &larr; Back
          </button>
        </div>
      </div>

      {/* ── main panels ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: current check ───────────────────────────────────────────────── */}
        <div className="w-72 bg-white border-r border-gray-200 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-gray-800">Current Order</h2>
              <p className="text-xs text-gray-500">{checkItems.reduce((s, i) => s + i.qty, 0)} item{checkItems.reduce((s, i) => s + i.qty, 0) !== 1 ? 's' : ''}</p>
            </div>
            {checkItems.length > 0 && (
              <button onClick={clearCheck} title="Clear order"
                className="w-7 h-7 flex items-center justify-center rounded border border-red-200 text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/>
                </svg>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {checkItems.map((item, idx) => (
              <div key={idx}
                onClick={() => {
                  if (item._item && item._subPrices) {
                    const isCombo = !!(item._subPrices.combo_steps?.length)
                    setEditingIdx(idx)
                    setOrderFlow({
                      item: item._item,
                      subPrices: item._subPrices,
                      phase: isCombo ? 'combo' : 'modifiers',
                      currentStepIdx: 0,
                      stepSelections: item._stepSelections || {},
                      modSelections: item._modSelections || {},
                      modQty: item._modQty || {},
                      // When re-entering combo phase, start with empty resolvedSelections
                      // because advanceStep() will rebuild them from stepSelections.
                      // If we restore old resolvedSelections, they get doubled on each edit.
                      resolvedSelections: isCombo ? [] : (item._resolvedSelections || []),
                    })
                  }
                }}
                className={`px-4 py-2 border-b border-gray-100 group cursor-pointer transition-colors ${editingIdx === idx ? 'bg-accent-dim' : 'hover:bg-gray-50'}`}>
                <div className="flex items-start gap-2">
                  {/* Qty controls */}
                  <div className="flex items-center gap-1 shrink-0 pt-0.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => {
                      if (item.qty <= 1) removeFromCheck(idx)
                      else setCheckItems(prev => prev.map((ci, i) => i === idx ? { ...ci, qty: ci.qty - 1 } : ci))
                    }}
                      className="w-5 h-5 rounded border border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-100 text-[10px] font-bold">−</button>
                    <span className="w-4 text-center text-xs font-bold text-gray-700">{item.qty}</span>
                    <button onClick={() => setCheckItems(prev => prev.map((ci, i) => i === idx ? { ...ci, qty: ci.qty + 1 } : ci))}
                      className="w-5 h-5 rounded border border-accent/40 bg-accent/5 flex items-center justify-center text-accent text-[10px] font-bold hover:bg-accent/10">+</button>
                  </div>
                  {/* Name + selections */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{item.name}</p>
                    {(item.displayLines || item.selections)?.map((line, si) => {
                      const indent = 'indent' in line ? (line as DisplayLine).indent : 0
                      return (
                        <p key={si} className={`text-xs text-gray-500 ${indent === 0 ? 'pl-2' : 'pl-5 text-gray-400'}`}>
                          {indent === 0 ? '+ ' : '· '}{line.name}{line.priceAddon > 0 ? ` +${sym}${line.priceAddon.toFixed(2)}` : ''}
                        </p>
                      )
                    })}
                  </div>
                  {/* Price */}
                  <span className="text-sm font-mono font-semibold text-gray-800 shrink-0">{sym}{(item.total * item.qty).toFixed(2)}</span>
                </div>
              </div>
            ))}
            {checkItems.length === 0 && (
              <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="mb-2 opacity-40">
                  <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 01-8 0"/>
                </svg>
                <p className="text-sm">No items yet</p>
                <p className="text-xs mt-1">Tap menu items to add</p>
              </div>
            )}
          </div>

          {/* totals */}
          <div className="border-t-2 border-gray-300 px-4 py-3 bg-gray-50 space-y-1">
            <div className="flex justify-between text-xs text-gray-600">
              <span>Subtotal</span><span>{sym}{subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-600">
              <span>Tax (incl.)</span><span>{sym}{tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-gray-900 pt-1 border-t border-gray-200">
              <span>TOTAL</span><span>{sym}{total.toFixed(2)}</span>
            </div>
          </div>

          {/* buttons */}
          <div className="px-3 pb-3 space-y-2">
            <button onClick={handlePay} disabled={checkItems.length === 0}
              className="w-full py-3.5 rounded-lg text-white text-lg font-bold transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed bg-accent hover:bg-accent-mid active:bg-accent-dark">
              PAY {sym}{total.toFixed(2)}
            </button>
          </div>
        </div>

        {/* ── CENTRE: menu grid ─────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Items grouped by category */}
          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-gray-400">
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-gray-300 border-t-accent rounded-full animate-spin" />
                  <p className="text-sm">Loading menu...</p>
                </div>
              </div>
            ) : menuItems.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-gray-400">
                <p className="text-sm">No items in this menu</p>
              </div>
            ) : (
              categories.map(cat => {
                const catItems = menuItems.filter(i => (i.category || 'Other') === cat)
                if (!catItems.length) return null
                return (
                  <div key={cat} className="mb-4">
                    {/* Category divider */}
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{cat}</span>
                      <div className="flex-1 border-t border-gray-200" />
                    </div>
                    {/* Item tiles */}
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2">
                      {catItems.map(item => (
                        <button key={item.menu_sales_item_id} onClick={() => handleItemTap(item)}
                          className="bg-white rounded-lg border border-gray-200 p-3 text-left hover:border-accent hover:shadow-sm transition-all active:scale-95 relative flex flex-col justify-between"
                          style={{ minHeight: '80px' }}>
                          <p className="text-sm font-medium text-gray-800 leading-tight line-clamp-2">{item.display_name}</p>
                          <div className="flex items-center justify-between mt-auto pt-1.5">
                            <div className="flex gap-1">
                              {item.item_type === 'combo' && <span className="text-[9px] bg-blue-100 text-blue-700 w-4 h-4 rounded-full flex items-center justify-center font-bold">C</span>}
                              {(item.modifier_group_count || 0) > 0 && item.item_type !== 'combo' && <span className="text-[9px] bg-purple-100 text-purple-700 w-4 h-4 rounded-full flex items-center justify-center font-bold">M</span>}
                            </div>
                            <span className="text-sm font-bold text-accent">{sym}{item.sell_price_gross?.toFixed(2)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* ── RIGHT: order flow panel (always visible) ──────────────────────────── */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col shrink-0">
          {orderFlow ? (
            <>
            {/* Header */}
            <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 flex items-center justify-between shrink-0">
              <div>
                <h3 className="text-sm font-bold text-gray-800">{orderFlow.item.display_name}</h3>
                <p className="text-[10px] text-gray-500">{sym}{itemRunningTotal.toFixed(2)}</p>
              </div>
              <button onClick={() => { setOrderFlow(null); setEditingIdx(null); setModPopup(null) }} className="text-gray-400 hover:text-gray-600 p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            {/* Split content: combo steps (top, compact) + modifiers (bottom, scrollable) */}
            {orderFlow.phase === 'combo' ? (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Top: combo step options (compact, auto-height) */}
                <div className="p-3 border-b border-gray-100 overflow-y-auto" style={{ height: '30%', minHeight: '30%', maxHeight: '30%' }}>
                  {renderComboStepSection()}
                </div>
                {/* Bottom: modifiers for selected option (scrollable) */}
                <div className="flex-1 overflow-y-auto p-3">
                  {renderComboStepModifiers()}
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto p-4">
                {renderOrderFlowContent()}
              </div>
            )}

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 shrink-0">
              {orderFlow.phase === 'combo' ? (
                <div className="flex items-center gap-2">
                  <button disabled={orderFlow.currentStepIdx === 0}
                    onClick={() => setOrderFlow(prev => prev ? { ...prev, currentStepIdx: prev.currentStepIdx - 1 } : prev)}
                    className="flex-1 py-3 rounded-lg border-2 border-gray-300 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-20 disabled:hover:bg-transparent active:scale-95 transition-all">
                    &larr; Previous
                  </button>
                  {orderFlow.currentStepIdx < orderFlow.subPrices.combo_steps.length - 1 ? (
                    <button disabled={!canAdvanceStep}
                      onClick={advanceStep}
                      className="flex-1 py-3 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-mid disabled:bg-gray-300 active:scale-95 transition-all">
                      Next &rarr;
                    </button>
                  ) : (
                    <button onClick={advanceStep} disabled={!canAdvanceStep}
                      className="flex-1 py-3 rounded-lg bg-accent text-white text-sm font-bold hover:bg-accent-mid disabled:bg-gray-300 active:scale-95 transition-all">
                      Continue
                    </button>
                  )}
                </div>
              ) : (
                <button onClick={() => finalizeOrderFlow()} disabled={!allModsMet}
                  className="w-full py-3 rounded-lg bg-accent text-white font-bold text-sm hover:bg-accent-mid disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                  {editingIdx !== null ? 'Update' : 'Add to Order'} — {sym}{itemRunningTotal.toFixed(2)}
                </button>
              )}
            </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-gray-300 px-6 text-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="mb-3">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
              </svg>
              <p className="text-sm font-medium">Order Details</p>
              <p className="text-xs mt-1">Tap a combo or item with modifiers to configure</p>
            </div>
          )}
        </div>
      </div>

      {/* ── modifier popup overlay (for hidden/optional groups) ─────────────────── */}
      {modPopup && orderFlow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setModPopup(null)}>
          <div className="absolute inset-0 bg-black/30" />
          <div className="relative bg-white rounded-xl shadow-2xl w-80 max-h-[60vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-800">{modPopup.display_name || modPopup.name}</h3>
                <p className="text-xs text-gray-500">Optional &middot; up to {modPopup.max_select}</p>
              </div>
              <button onClick={() => setModPopup(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            {/* Options */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {modPopup.options.map(opt => {
                const isComboMod = !!(modPopup as any)._comboStepId
                const mgKey = isComboMod
                  ? `${(modPopup as any)._comboStepId}_${modPopup.modifier_group_id}`
                  : String(modPopup.modifier_group_id)
                const sel = orderFlow.modSelections[mgKey]?.has(opt.id)
                const qty = orderFlow.modQty?.[mgKey]?.[opt.id] || 0
                const price = selectedLevelId ? (opt.prices?.[selectedLevelId] || 0) : 0

                return modPopup.allow_repeat_selection ? (
                  <div key={opt.id} className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border transition-colors ${qty > 0 ? 'border-accent bg-accent/5' : 'border-gray-200'}`}>
                    <button onClick={() => adjustModQty(mgKey, opt.id, -1, modPopup.max_select)} disabled={qty === 0}
                      className="w-8 h-8 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-500 hover:bg-gray-100 disabled:opacity-20 text-sm font-bold shrink-0 active:scale-95">&#8722;</button>
                    <span className={`w-5 text-center text-sm font-bold shrink-0 ${qty > 0 ? 'text-accent' : 'text-gray-300'}`}>{qty}</span>
                    <button onClick={() => adjustModQty(mgKey, opt.id, 1, modPopup.max_select)}
                      className="flex-1 text-left text-sm text-gray-800 hover:text-accent transition-colors truncate py-0.5">
                      {opt.display_name || opt.name}
                    </button>
                    <span className="text-xs text-gray-400 shrink-0">{price > 0 ? `+${sym}${price.toFixed(2)}/ea` : 'incl.'}</span>
                  </div>
                ) : (
                  <button key={opt.id}
                    onClick={() => isComboMod
                      ? toggleComboStepModifier(mgKey, opt.id, modPopup.min_select, modPopup.max_select)
                      : toggleModOption(modPopup.modifier_group_id, opt.id, modPopup.max_select)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all active:scale-[0.98]
                      ${sel
                        ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                        : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors
                      ${sel ? 'border-accent bg-accent' : 'border-gray-300'}`}>
                      {sel && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </div>
                    <span className="flex-1 text-sm text-gray-800 truncate">{opt.display_name || opt.name}</span>
                    {price > 0 && (
                      <span className="text-xs font-medium text-gray-500 shrink-0">+{sym}{price.toFixed(2)}</span>
                    )}
                  </button>
                )
              })}
            </div>
            {/* Done button */}
            <div className="px-4 py-3 border-t border-gray-200">
              <button onClick={() => setModPopup(null)} className="w-full py-2.5 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent-mid transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── receipt modal ───────────────────────────────────────────────────────── */}
      {showReceipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-2xl w-80 max-h-[80vh] flex flex-col">
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 font-mono text-xs space-y-3">
                <div className="text-center">
                  <p className="text-sm font-bold">COGS POS Mockup</p>
                  <p className="text-gray-500">--- MOCK RECEIPT ---</p>
                  <p className="text-gray-500">{new Date().toLocaleString()}</p>
                </div>
                <hr className="border-dashed border-gray-300" />
                {receiptData.map((item, i) => (
                  <div key={i}>
                    <div className="flex justify-between gap-2">
                      <span className="truncate">{item.qty > 1 ? `${item.qty}x ` : ''}{item.name}</span>
                      <span className="shrink-0">{sym}{(item.total * item.qty).toFixed(2)}</span>
                    </div>
                    {item.selections?.map((sel, si) => (
                      <div key={si} className="flex justify-between text-gray-500 pl-2">
                        <span className="truncate">+ {sel.name}</span>
                        {sel.priceAddon > 0 && <span className="shrink-0">+{sym}{sel.priceAddon.toFixed(2)}</span>}
                      </div>
                    ))}
                  </div>
                ))}
                <hr className="border-dashed border-gray-300" />
                <div className="flex justify-between"><span>Subtotal</span><span>{sym}{receiptSubtotal.toFixed(2)}</span></div>
                <div className="flex justify-between"><span>Tax (incl.)</span><span>{sym}{receiptTax.toFixed(2)}</span></div>
                <div className="flex justify-between text-sm font-bold pt-1 border-t border-dashed border-gray-300">
                  <span>TOTAL</span><span>{sym}{receiptTotal.toFixed(2)}</span>
                </div>
                <hr className="border-dashed border-gray-300" />
                <p className="text-center text-gray-500">Thank you!</p>
                <p className="text-center text-gray-400 text-[10px]">This is a test receipt -- no transaction recorded</p>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t border-gray-200 shrink-0">
              <button onClick={() => { setShowReceipt(false); clearCheck() }}
                className="flex-1 py-2 rounded-lg bg-accent text-white font-medium text-sm hover:bg-accent-mid transition-colors">
                New Order
              </button>
              <button onClick={() => setShowReceipt(false)}
                className="flex-1 py-2 rounded-lg border border-gray-300 text-gray-700 font-medium text-sm hover:bg-gray-50 transition-colors">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  // In fullscreen mode, render via portal to cover sidebar + header
  return isFullscreen ? createPortal(posContent, document.body) : posContent
}
