// =============================================================================
// Shared Menu Engineer Page — public, no Auth0, password-protected
// URL: /share/:slug
// =============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams } from 'react-router-dom'

// ── Types ─────────────────────────────────────────────────────────────────────

interface PageMeta {
  name:          string
  mode:          'view' | 'edit'
  notes:         string | null
  menu_locked:   boolean
  menu_id:       number | null
  menu_name:     string | null
  market_locked: boolean
  country_id:    number | null
  country_name:  string | null
  scenario_id:   number | null
  scenario_name: string | null
}

interface PriceLevel { id: number; name: string }

interface LevelEntry {
  set:                  boolean
  gross:                number | null
  net:                  number | null
  cogs_pct:             number | null
  gp_net:               number | null
  lp_id?:               number
  is_scenario_override: boolean
}

interface SharedItem {
  menu_item_id: number
  nat_key:      string
  display_name: string
  item_type:    'recipe' | 'ingredient'
  category:     string
  cost:         number
  levels:       Record<number, LevelEntry>
}

interface SharedMenuInfo {
  id:              number
  name:            string
  currency_code:   string
  currency_symbol: string
  exchange_rate:   number
  country_id:      number
  country_name:    string
}

interface SharedData {
  menu:                    SharedMenuInfo
  price_levels:            PriceLevel[]
  items:                   SharedItem[]
  menus:                   { id: number; name: string }[]
  scenario:                { id: number; name: string } | null
  scenario_qty_data:       Record<string, number>   // nat_key → qty sold
  scenario_price_level_id: number | null            // which price level the qty applies to
}

interface BreakdownLine {
  name:          string
  qty:           number
  unit:          string
  waste_pct:     number
  cost_local:    number
  is_sub_recipe: boolean
}

interface BreakdownData {
  display_name: string
  item_type:    string
  recipe_name?: string
  lines:        BreakdownLine[]
  total_local:  number
}

interface ChangeEntry {
  id:             number
  user_name:      string
  change_type:    'price' | 'comment'
  menu_item_id:   number | null
  price_level_id: number | null
  display_name:   string | null
  level_name:     string | null
  old_value:      number | null
  new_value:      number | null
  comment:        string | null
  created_at:     string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL || '/api') as string

const fmt2    = (n: number | null | undefined) => Number(n ?? 0).toFixed(2)
const cogsCls = (pct: number | null): string => {
  if (pct === null) return 'text-gray-400'
  if (pct <= 28)   return 'text-emerald-600 font-semibold'
  if (pct <= 35)   return 'text-amber-500  font-semibold'
  return 'text-red-500 font-semibold'
}
const cogsBarCls = (pct: number | null) => {
  if (pct === null) return 'bg-gray-200'
  if (pct <= 28)   return 'bg-emerald-400'
  if (pct <= 35)   return 'bg-amber-400'
  return 'bg-red-400'
}

function tokenKey(slug: string) { return `sp_token_${slug}` }
function nameKey(slug: string)  { return `sp_name_${slug}` }
function notesKey(slug: string) { return `sp_notes_seen_${slug}` }
function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SharedMenuPage() {
  const { slug } = useParams<{ slug: string }>()

  // meta + auth
  const [meta,        setMeta]        = useState<PageMeta | null>(null)
  const [metaError,   setMetaError]   = useState('')
  const [metaLoading, setMetaLoading] = useState(true)
  const [password,    setPassword]    = useState('')
  const [authError,   setAuthError]   = useState('')
  const [authLoading, setAuthLoading] = useState(false)
  const [token,       setToken]       = useState<string | null>(null)

  // data
  const [data,        setData]        = useState<SharedData | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataError,   setDataError]   = useState('')
  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null)

  // edit
  const [editCell,  setEditCell]  = useState<{ itemId: number; levelId: number; value: string } | null>(null)
  const [saving,    setSaving]    = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveOk,    setSaveOk]    = useState<string | null>(null)

  // auth extras
  const [userName,    setUserName]    = useState(() => (slug ? sessionStorage.getItem(nameKey(slug)) || '' : ''))
  const [showNotes,   setShowNotes]   = useState(false)

  // changes
  const [changes,          setChanges]          = useState<ChangeEntry[]>([])
  const [changesLoading,   setChangesLoading]   = useState(false)
  const [changePanelOpen,  setChangePanelOpen]  = useState(false)
  const [newComment,       setNewComment]       = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)

  // UI
  const [collapsedCats,   setCollapsedCats]   = useState<Set<string>>(new Set())
  const [breakdown,       setBreakdown]       = useState<{ itemId: number; data: BreakdownData | null; loading: boolean } | null>(null)

  // ── Load meta ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!slug) return
    setMetaLoading(true)
    fetch(`${API_BASE}/public/share/${slug}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setMetaError(d.error.message); return }
        setMeta(d)
        const stored = sessionStorage.getItem(tokenKey(slug))
        if (stored) setToken(stored)
      })
      .catch(() => setMetaError('Could not load this page.'))
      .finally(() => setMetaLoading(false))
  }, [slug])

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadData = useCallback(async (tok: string, menuId?: number | null) => {
    if (!slug) return
    setDataLoading(true)
    setDataError('')
    const mid = menuId ?? selectedMenuId ?? meta?.menu_id
    const url  = `${API_BASE}/public/share/${slug}/data${mid ? `?menu_id=${mid}` : ''}`
    try {
      const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } })
      const d = await r.json()
      if (d.error) {
        setDataError(d.error.message)
        if (r.status === 401) { sessionStorage.removeItem(tokenKey(slug)); setToken(null) }
        return
      }
      setData(d)
      setSelectedMenuId(d.menu.id)
    } catch {
      setDataError('Failed to load menu data.')
    } finally {
      setDataLoading(false)
    }
  }, [slug, selectedMenuId, meta?.menu_id])

  useEffect(() => {
    if (token) {
      loadData(token)
      loadChanges(token)
    }
  }, [token]) // eslint-disable-line

  // ── Auth ─────────────────────────────────────────────────────────────────────

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!slug || !password || !userName.trim()) return
    setAuthLoading(true)
    setAuthError('')
    try {
      const r = await fetch(`${API_BASE}/public/share/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, user_name: userName.trim() }),
      })
      const d = await r.json()
      if (d.error) { setAuthError(d.error.message); return }
      sessionStorage.setItem(tokenKey(slug), d.token)
      sessionStorage.setItem(nameKey(slug), userName.trim())
      setToken(d.token)
      // Show notes modal once per browser if notes exist
      if (meta?.notes && !localStorage.getItem(notesKey(slug))) {
        setShowNotes(true)
      }
    } catch {
      setAuthError('Authentication failed. Please try again.')
    } finally {
      setAuthLoading(false)
    }
  }

  // ── Inline price save ────────────────────────────────────────────────────────

  async function commitEdit() {
    if (!editCell || !token || !slug) return
    const gross = parseFloat(editCell.value)
    if (isNaN(gross) || gross < 0) { setEditCell(null); return }

    setSaving(true)
    setSaveError('')
    setSaveOk(null)
    try {
      const r = await fetch(`${API_BASE}/public/share/${slug}/price`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          menu_item_id:   editCell.itemId,
          price_level_id: editCell.levelId,
          sell_price:     Math.round(gross * 10000) / 10000,
        }),
      })
      const d = await r.json()
      if (d.error) { setSaveError(d.error.message); return }
      setSaveOk('✓ Saved')
      setTimeout(() => setSaveOk(null), 2000)
      await Promise.all([loadData(token, selectedMenuId), loadChanges(token)])
    } catch {
      setSaveError('Failed to save price.')
    } finally {
      setSaving(false)
      setEditCell(null)
    }
  }

  // ── Ingredient breakdown ─────────────────────────────────────────────────────

  async function openBreakdown(itemId: number) {
    if (!token || !slug) return
    setBreakdown({ itemId, data: null, loading: true })
    try {
      const r = await fetch(`${API_BASE}/public/share/${slug}/breakdown/${itemId}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const d = await r.json()
      if (d.error) { setBreakdown(null); return }
      setBreakdown({ itemId, data: d, loading: false })
    } catch {
      setBreakdown(null)
    }
  }

  // ── Load changes ─────────────────────────────────────────────────────────────

  const loadChanges = useCallback(async (tok: string) => {
    if (!slug) return
    setChangesLoading(true)
    try {
      const r = await fetch(`${API_BASE}/public/share/${slug}/changes`, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      const d = await r.json()
      if (!d.error) setChanges(d)
    } catch { /* silent */ }
    finally { setChangesLoading(false) }
  }, [slug])

  // ── Category helpers ─────────────────────────────────────────────────────────

  const categories = useMemo(() => {
    if (!data) return []
    const cats = [...new Set(data.items.map(i => i.category || 'Uncategorised'))].sort()
    return cats
  }, [data])

  function toggleCat(cat: string) {
    setCollapsedCats(prev => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  function collapseAll()  { setCollapsedCats(new Set(categories)) }
  function expandAll()    { setCollapsedCats(new Set()) }

  // ── Changed cells lookup ──────────────────────────────────────────────────────
  // keyed: "${menu_item_id}_l${price_level_id}" → most recent ChangeEntry
  const changedCells = useMemo(() => {
    const map: Record<string, ChangeEntry> = {}
    // changes are ordered DESC, so first hit per key is most recent
    for (const c of [...changes].reverse()) {
      if (c.change_type === 'price' && c.menu_item_id && c.price_level_id) {
        map[`${c.menu_item_id}_l${c.price_level_id}`] = c
      }
    }
    return map
  }, [changes])

  // ── Summary metrics ──────────────────────────────────────────────────────────

  const summary = useMemo(() => {
    if (!data || !data.items.length) return null

    const qtyData    = data.scenario_qty_data       || {}
    const scenLvlId  = data.scenario_price_level_id || null
    const levels     = data.price_levels
    const items      = data.items
    const hasQty     = Object.values(qtyData).some(v => Number(v) > 0)

    // ── KPI aggregates ────────────────────────────────────────────────────────
    // Weighted (by scenario qty) or simple average (no qty)
    let totalCost    = 0
    let totalRevGross = 0
    let totalRevNet  = 0
    let qtyTotal     = 0

    if (hasQty && scenLvlId) {
      for (const item of items) {
        const qty   = Number(qtyData[item.nat_key] ?? 0)
        if (!qty) continue
        const entry = item.levels[scenLvlId]
        if (!entry?.set) continue
        totalCost     += item.cost      * qty
        totalRevGross += (entry.gross ?? 0) * qty
        totalRevNet   += (entry.net   ?? 0) * qty
        qtyTotal      += qty
      }
    }

    // Avg COGS% per level — simple average across all priced items
    const levelStats: Record<number, { sum: number; count: number; revenue: number; cost: number }> = {}
    for (const l of levels) {
      levelStats[l.id] = { sum: 0, count: 0, revenue: 0, cost: 0 }
    }
    for (const item of items) {
      for (const l of levels) {
        const entry = item.levels[l.id]
        if (!entry?.set || entry.gross === null) continue
        levelStats[l.id].sum     += entry.cogs_pct ?? 0
        levelStats[l.id].count   += 1
        levelStats[l.id].revenue += entry.gross
        levelStats[l.id].cost    += item.cost
      }
    }

    // ── Category breakdown ────────────────────────────────────────────────────
    // Revenue or cost per category (use qty-weighted if available, else item-count)
    const catMap: Record<string, { cost: number; revenue: number; items: number }> = {}
    for (const item of items) {
      const cat = item.category || 'Uncategorised'
      if (!catMap[cat]) catMap[cat] = { cost: 0, revenue: 0, items: 0 }
      catMap[cat].items += 1
      catMap[cat].cost  += item.cost

      if (hasQty && scenLvlId) {
        const qty   = Number(qtyData[item.nat_key] ?? 0)
        const entry = item.levels[scenLvlId]
        if (entry?.set) catMap[cat].revenue += (entry.gross ?? 0) * qty
      } else {
        // Use sum of all set prices as proxy
        for (const l of levels) {
          const entry = item.levels[l.id]
          if (entry?.set) catMap[cat].revenue += entry.gross ?? 0
        }
      }
    }

    const totalCatRevenue = Object.values(catMap).reduce((s, c) => s + c.revenue, 0)
    const totalCatCost    = Object.values(catMap).reduce((s, c) => s + c.cost, 0)

    const catBreakdown = Object.entries(catMap)
      .map(([name, v]) => ({
        name,
        items:      v.items,
        revPct:     totalCatRevenue > 0 ? (v.revenue / totalCatRevenue) * 100 : 0,
        costPct:    totalCatCost    > 0 ? (v.cost    / totalCatCost)    * 100 : 0,
        cogsPct:    v.revenue > 0 ? (v.cost / v.revenue) * 100 : null,
      }))
      .sort((a, b) => b.revPct - a.revPct)

    // ── Price level breakdown ─────────────────────────────────────────────────
    const totalLevelRevenue = Object.values(levelStats).reduce((s, v) => s + v.revenue, 0)
    const levelBreakdown = levels.map(l => {
      const s = levelStats[l.id]
      return {
        id:       l.id,
        name:     l.name,
        avgCogs:  s.count > 0 ? s.sum / s.count : null,
        revenue:  s.revenue,
        revPct:   totalLevelRevenue > 0 ? (s.revenue / totalLevelRevenue) * 100 : 0,
        priced:   s.count,
        total:    items.length,
      }
    })

    // hasWeightedData: qty exists AND a specific price level is set → can compute revenue
    // hasQty without scenLvlId means ALL-levels scenario: charts use price sums as fallback,
    // but KPI tiles must not show zeros — fall back to the count/avg view instead
    const hasWeightedData = hasQty && scenLvlId !== null

    const weightedCogs = totalRevNet > 0 ? (totalCost / totalRevNet) * 100 : null
    const avgCogs = (() => {
      let sum = 0, n = 0
      for (const l of levels) {
        if (levelStats[l.id].count > 0) { sum += levelStats[l.id].sum; n += levelStats[l.id].count }
      }
      return n > 0 ? sum / n : null
    })()

    return {
      hasQty,
      hasWeightedData,
      totalCost:      Math.round(totalCost      * 100) / 100,
      totalRevGross:  Math.round(totalRevGross   * 100) / 100,
      totalRevNet:    Math.round(totalRevNet     * 100) / 100,
      gp:             Math.round((totalRevGross - totalCost) * 100) / 100,
      weightedCogs:   weightedCogs !== null ? Math.round(weightedCogs * 10) / 10 : null,
      avgCogs:        avgCogs      !== null ? Math.round(avgCogs      * 10) / 10 : null,
      qtyTotal,
      catBreakdown,
      levelBreakdown,
    }
  }, [data])

  // ── Render: loading / error ───────────────────────────────────────────────────

  if (metaLoading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-gray-400 text-sm animate-pulse">Loading…</div>
    </div>
  )

  if (metaError) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 max-w-sm w-full p-8 text-center">
        <div className="text-5xl mb-4">🔗</div>
        <h1 className="text-xl font-bold text-gray-800 mb-2">Link unavailable</h1>
        <p className="text-gray-500 text-sm">{metaError}</p>
      </div>
    </div>
  )

  // ── Notes modal (shown once after first successful auth) ──────────────────────
  if (showNotes && meta?.notes) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 max-w-md w-full p-8">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0 text-xl">📋</div>
          <div>
            <h2 className="font-bold text-gray-900 text-lg leading-tight">{meta.name}</h2>
            <p className="text-xs text-gray-400">Notes from the organiser</p>
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed mb-6">
          {meta.notes}
        </div>
        <button
          className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition"
          onClick={() => {
            if (slug) localStorage.setItem(notesKey(slug), '1')
            setShowNotes(false)
          }}
        >
          Got it — View Menu →
        </button>
      </div>
    </div>
  )

  // ── Render: password gate ────────────────────────────────────────────────────

  if (!token) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 max-w-sm w-full p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-lg leading-tight">{meta?.name}</h1>
            <p className="text-sm text-gray-400">Password protected · {meta?.mode === 'edit' ? 'Edit mode' : 'View only'}</p>
          </div>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Your name <span className="text-red-400">*</span></label>
            <input
              type="text"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
              value={userName}
              onChange={e => setUserName(e.target.value)}
              autoFocus
              placeholder="e.g. John Smith"
              maxLength={80}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Access password <span className="text-red-400">*</span></label>
            <input
              type="password"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>
          {authError && <p className="text-red-500 text-sm">{authError}</p>}
          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
            disabled={authLoading || !password || !userName.trim()}
          >
            {authLoading ? 'Checking…' : 'View Menu →'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-300">
          Powered by <span className="font-semibold text-emerald-600">COGS Manager</span>
        </p>
      </div>
    </div>
  )

  // ── Comment submit ────────────────────────────────────────────────────────────

  async function submitComment() {
    if (!newComment.trim() || !token || !slug) return
    setSubmittingComment(true)
    try {
      const r = await fetch(`${API_BASE}/public/share/${slug}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ comment: newComment.trim() }),
      })
      const d = await r.json()
      if (!d.error) {
        setChanges(prev => [d, ...prev])
        setNewComment('')
      }
    } catch { /* silent */ }
    finally { setSubmittingComment(false) }
  }

  // ── Render: authenticated ────────────────────────────────────────────────────

  const isEdit = meta?.mode === 'edit'
  const sym    = data?.menu.currency_symbol ?? ''
  const levels = data?.price_levels ?? []

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-screen-xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-xs">C</span>
            </div>
            <div className="min-w-0">
              <h1 className="font-bold text-gray-900 text-sm truncate">{meta?.name}</h1>
              <div className="flex items-center gap-2 text-xs text-gray-400 flex-wrap">
                {isEdit
                  ? <span className="text-amber-600 font-medium">✏ Edit mode</span>
                  : <span>👁 View only</span>}
                {data?.scenario && (
                  <span className="text-amber-600 font-medium">· Scenario: {data.scenario.name}</span>
                )}
              </div>
            </div>
          </div>

          {data && (
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${changePanelOpen ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                onClick={() => setChangePanelOpen(p => !p)}
                title="Toggle change log"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                </svg>
                Changes {changes.length > 0 && <span className="font-bold">{changes.filter(c => c.change_type === 'price').length}</span>}
              </button>
              <div className="text-right">
                <div className="font-semibold text-gray-800 text-sm">{data.menu.name}</div>
                <div className="text-xs text-gray-400">{data.menu.country_name} · {data.menu.currency_code}</div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* ── Menu switcher ────────────────────────────────────────────────────── */}
      {data && !meta?.menu_locked && data.menus.length > 1 && (
        <div className="bg-white border-b border-gray-100 px-4 sm:px-6 py-2">
          <div className="max-w-screen-xl mx-auto flex items-center gap-3">
            <span className="text-xs text-gray-400 whitespace-nowrap">Switch menu:</span>
            <select
              className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              value={selectedMenuId ?? ''}
              onChange={e => { const id = Number(e.target.value); setSelectedMenuId(id); if (token) loadData(token, id) }}
            >
              {data.menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        </div>
      )}

      {/* ── Toast notifications (fixed overlay, non-intrusive) ──────────────── */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
        {saving && (
          <div className="flex items-center gap-2.5 bg-gray-800 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg pointer-events-auto animate-fade-in">
            <svg className="w-4 h-4 animate-spin text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
            </svg>
            Saving…
          </div>
        )}
        {saveOk && !saving && (
          <div className="flex items-center gap-2.5 bg-emerald-700 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg pointer-events-auto">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/>
            </svg>
            {saveOk}
          </div>
        )}
        {saveError && (
          <div className="flex items-center gap-2.5 bg-red-600 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg max-w-xs pointer-events-auto">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
            <span className="truncate">{saveError}</span>
            <button className="ml-auto flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity" onClick={() => setSaveError('')}>✕</button>
          </div>
        )}
        {dataError && (
          <div className="flex items-center gap-2.5 bg-red-600 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg max-w-xs pointer-events-auto">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span className="truncate">{dataError}</span>
            <button className="ml-auto flex-shrink-0 opacity-70 hover:opacity-100 transition-opacity" onClick={() => setDataError('')}>✕</button>
          </div>
        )}
      </div>

      {/* ── Content area ─────────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0">
      <main className={`flex-1 min-w-0 px-4 sm:px-6 py-6 transition-all ${changePanelOpen ? 'max-w-[calc(100%-320px)]' : 'max-w-screen-xl mx-auto w-full'}`}>

        {dataLoading && (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm animate-pulse">Loading data…</div>
        )}

        {!dataLoading && data && data.items.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-16 text-center text-gray-400 text-sm">
            No items on this menu.
          </div>
        )}

        {!dataLoading && data && data.items.length > 0 && summary && (
          <>
            {/* ── Header ──────────────────────────────────────────────────────── */}
            <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{data.menu.name}</h2>
                <p className="text-sm text-gray-400 mt-0.5">
                  {data.menu.country_name} · {data.menu.currency_code} ({sym})
                  {data.scenario && <span className="ml-2 px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded-full font-medium">📊 {data.scenario.name}</span>}
                  {summary.hasWeightedData && <span className="ml-2 px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full font-medium">{summary.qtyTotal} covers</span>}
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>{data.items.length} items · {categories.length} categories</span>
                <button onClick={expandAll}  className="text-emerald-600 hover:underline">Expand all</button>
                <span className="text-gray-200">|</span>
                <button onClick={collapseAll} className="text-emerald-600 hover:underline">Collapse all</button>
              </div>
            </div>

            {/* ── KPI tiles ────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <KpiTile
                label={summary.hasWeightedData ? 'Weighted COGS' : 'Avg COGS'}
                value={`${fmt2(summary.hasWeightedData ? summary.weightedCogs : summary.avgCogs)}%`}
                sub={summary.hasWeightedData ? 'across sold items' : 'across all price levels'}
                colour={
                  (summary.hasWeightedData ? summary.weightedCogs : summary.avgCogs) === null ? 'gray'
                  : ((summary.hasWeightedData ? summary.weightedCogs! : summary.avgCogs!) <= 28) ? 'green'
                  : ((summary.hasWeightedData ? summary.weightedCogs! : summary.avgCogs!) <= 35) ? 'amber'
                  : 'red'
                }
              />
              {summary.hasWeightedData ? (
                <>
                  <KpiTile
                    label="Total Revenue"
                    value={`${sym}${fmt2(summary.totalRevGross)}`}
                    sub="gross sales"
                    colour="blue"
                  />
                  <KpiTile
                    label="Total Cost"
                    value={`${sym}${fmt2(summary.totalCost)}`}
                    sub="ingredient cost"
                    colour="gray"
                  />
                  <KpiTile
                    label="Gross Profit"
                    value={`${sym}${fmt2(summary.gp)}`}
                    sub={summary.totalRevGross > 0 ? `${fmt2(((summary.gp) / summary.totalRevGross) * 100)}% GP` : '—'}
                    colour={summary.gp >= 0 ? 'green' : 'red'}
                  />
                </>
              ) : (
                <>
                  <KpiTile label="Menu Items"  value={String(data.items.length)} sub="total items" colour="blue" />
                  <KpiTile label="Categories"  value={String(categories.length)} sub="item groups" colour="gray" />
                  <KpiTile label="Price Levels" value={String(levels.length)} sub="pricing tiers" colour="gray" />
                </>
              )}
            </div>

            {/* ── Split charts ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-4">

              {/* Category split */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Revenue &amp; COGS by Category
                </h3>
                <div className="space-y-2.5">
                  {summary.catBreakdown.map(cat => (
                    <div key={cat.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700 truncate max-w-[160px]">{cat.name}</span>
                        <div className="flex items-center gap-3 text-xs text-gray-500 flex-shrink-0">
                          {cat.cogsPct !== null && (
                            <span className={cogsCls(cat.cogsPct)}>{fmt2(cat.cogsPct)}% COGS</span>
                          )}
                          <span className="font-semibold text-gray-700 text-right">
                            <span className="text-gray-400 font-normal mr-0.5">{summary.hasQty ? 'rev' : 'cost'}</span>{fmt2(summary.hasQty ? cat.revPct : cat.costPct)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${cogsBarCls(cat.cogsPct)}`}
                          style={{ width: `${Math.max(2, summary.hasQty ? cat.revPct : cat.costPct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Price level split */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Revenue &amp; COGS by Price Level
                </h3>
                <div className="space-y-2.5">
                  {summary.levelBreakdown.map(lvl => (
                    <div key={lvl.id}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-700">{lvl.name}</span>
                        <div className="flex items-center gap-3 text-xs flex-shrink-0">
                          <span className="text-gray-400">{lvl.priced}/{lvl.total} priced</span>
                          {lvl.avgCogs !== null && (
                            <span className={`font-semibold ${cogsCls(lvl.avgCogs)}`}>{fmt2(lvl.avgCogs)}% COGS</span>
                          )}
                          <span className="text-gray-700 font-semibold text-right">
                            {lvl.revPct > 0 ? <><span className="text-gray-400 font-normal mr-0.5">rev</span>{fmt2(lvl.revPct)}%</> : '—'}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${cogsBarCls(lvl.avgCogs)}`}
                          style={{ width: `${Math.max(2, lvl.revPct)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Table card */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">

              {/* Table header */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide sticky left-0 bg-gray-50 whitespace-nowrap min-w-[200px]">
                        Item
                      </th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap">
                        Cost ({data.menu.currency_code})
                      </th>
                      {levels.map(l => (
                        <th key={l.id} className="text-right px-4 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide whitespace-nowrap min-w-[120px]">
                          {l.name}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {categories.map(cat => {
                      const catItems = data.items.filter(i => (i.category || 'Uncategorised') === cat)
                      const isCollapsed = collapsedCats.has(cat)
                      const setPriced   = catItems.filter(i => levels.some(l => i.levels[l.id]?.set))
                      const avgCogs     = (() => {
                        const vals = catItems.flatMap(i => levels.map(l => i.levels[l.id]?.cogs_pct).filter((v): v is number => v !== null && v !== undefined))
                        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
                      })()

                      return [
                        // Category header row
                        <tr
                          key={`cat-${cat}`}
                          className="bg-gray-50/80 border-t border-b border-gray-100 cursor-pointer hover:bg-gray-100/60 transition-colors select-none"
                          onClick={() => toggleCat(cat)}
                        >
                          <td className="px-4 py-2.5 sticky left-0 bg-gray-50/80" colSpan={1}>
                            <div className="flex items-center gap-2">
                              <span className="text-gray-400 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                              <span className="font-semibold text-gray-700 text-xs uppercase tracking-wide">{cat}</span>
                              <span className="text-gray-400 text-xs font-normal ml-1">
                                {catItems.length} item{catItems.length !== 1 ? 's' : ''}
                                {setPriced.length < catItems.length ? ` · ${catItems.length - setPriced.length} unpriced` : ''}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {/* empty — cost */}
                          </td>
                          {levels.map(l => (
                            <td key={l.id} className="px-4 py-2.5 text-right">
                              {avgCogs !== null && (
                                <span className={`text-xs font-medium ${cogsCls(avgCogs)}`}>
                                  avg {fmt2(avgCogs)}%
                                </span>
                              )}
                            </td>
                          ))}
                        </tr>,

                        // Item rows
                        ...(isCollapsed ? [] : catItems.map((item, idx) => (
                          <tr
                            key={item.menu_item_id}
                            className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'} hover:bg-emerald-50/20 transition-colors`}
                          >
                            {/* Item name */}
                            <td className="px-4 py-3 sticky left-0 bg-inherit">
                              <span className="font-medium text-gray-800">{item.display_name}</span>
                            </td>

                            {/* Cost cell — click to open breakdown modal */}
                            <td className="px-4 py-3 text-right">
                              <button
                                className="group relative text-right"
                                onClick={() => item.item_type === 'recipe' && openBreakdown(item.menu_item_id)}
                                title={item.item_type === 'recipe' ? 'Click for ingredient breakdown' : undefined}
                              >
                                <span className={`font-mono text-gray-700 ${item.item_type === 'recipe' ? 'group-hover:text-emerald-600 transition-colors underline decoration-dotted underline-offset-2 cursor-pointer' : ''}`}>
                                  {sym}{fmt2(item.cost)}
                                </span>
                              </button>
                            </td>

                            {/* Price level columns */}
                            {levels.map(l => {
                              const entry    = item.levels[l.id]
                              const isEditing = editCell?.itemId === item.menu_item_id && editCell?.levelId === l.id

                              if (!entry?.set) {
                                const changeKey = `${item.menu_item_id}_l${l.id}`
                                const cellChange = changedCells[changeKey]
                                return (
                                  <td key={l.id} className={`px-4 py-3 text-center ${cellChange ? 'bg-amber-50/40' : ''}`}>
                                    {isEdit ? (
                                      isEditing ? (
                                        <InlineInput
                                          value={editCell!.value}
                                          onChange={v => setEditCell(prev => prev ? { ...prev, value: v } : null)}
                                          onCommit={commitEdit}
                                          onCancel={() => setEditCell(null)}
                                        />
                                      ) : (
                                        <button
                                          className="text-xs text-gray-300 hover:text-emerald-500 transition-colors"
                                          onClick={() => setEditCell({ itemId: item.menu_item_id, levelId: l.id, value: '' })}
                                        >
                                          + set price
                                        </button>
                                      )
                                    ) : (
                                      <span className="text-gray-200 text-xs">—</span>
                                    )}
                                  </td>
                                )
                              }

                              const changeKey = `${item.menu_item_id}_l${l.id}`
                              const cellChange = changedCells[changeKey]
                              return (
                                <td key={l.id} className={`px-4 py-3 ${cellChange ? 'relative' : ''}`}>
                                  {isEdit && isEditing ? (
                                    <InlineInput
                                      value={editCell!.value}
                                      onChange={v => setEditCell(prev => prev ? { ...prev, value: v } : null)}
                                      onCommit={commitEdit}
                                      onCancel={() => setEditCell(null)}
                                    />
                                  ) : (
                                    <div className={`group relative ${cellChange ? 'rounded-md ring-1 ring-amber-300 bg-amber-50/40 px-1' : ''}`}>
                                      <button
                                        className={`w-full text-right ${isEdit ? 'hover:bg-emerald-50 rounded-md px-1 -mx-1 cursor-pointer transition-colors' : 'cursor-default'}`}
                                        onClick={isEdit ? () => setEditCell({ itemId: item.menu_item_id, levelId: l.id, value: fmt2(entry.gross) }) : undefined}
                                        disabled={!isEdit}
                                      >
                                        <div className="flex items-center justify-end gap-1">
                                          {cellChange && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Recently changed" />
                                          )}
                                          {entry.is_scenario_override && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" title="Scenario override" />
                                          )}
                                          <span className="font-semibold text-gray-800 tabular-nums">
                                            {sym}{fmt2(entry.gross)}
                                          </span>
                                        </div>
                                        <div className={`text-xs tabular-nums mt-0.5 ${cogsCls(entry.cogs_pct)}`}>
                                          {entry.cogs_pct !== null ? `${fmt2(entry.cogs_pct)}%` : '—'}
                                        </div>
                                        {entry.cogs_pct !== null && (
                                          <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden flex justify-end">
                                            <div
                                              className={`h-full rounded-full ${cogsBarCls(entry.cogs_pct)} transition-all`}
                                              style={{ width: `${Math.min(100, Math.max(0, 100 - (entry.cogs_pct ?? 0)))}%` }}
                                            />
                                          </div>
                                        )}
                                      </button>
                                      {cellChange && (
                                        <div className="absolute right-0 bottom-full mb-1.5 z-30 hidden group-hover:block pointer-events-none">
                                          <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
                                            <p className="font-semibold mb-0.5">{cellChange.user_name}</p>
                                            <p className="text-gray-300">{fmtTime(cellChange.created_at)}</p>
                                            {cellChange.old_value !== null && (
                                              <p className="mt-1 text-amber-300">{sym}{Number(cellChange.old_value).toFixed(2)} → {sym}{Number(cellChange.new_value ?? 0).toFixed(2)}</p>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </td>
                              )
                            })}
                          </tr>
                        )))
                      ]
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex items-center gap-4 text-xs text-gray-400 px-1 flex-wrap">
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-400" /> ≤ 28% Good</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400"   /> 28–35% Watch</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-400"     /> &gt; 35% High</span>
              {data.items.some(i => levels.some(l => i.levels[l.id]?.is_scenario_override)) && (
                <span className="flex items-center gap-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400" /> Scenario override</span>
              )}
              {isEdit && <span className="text-amber-600 font-medium">Edit mode — changes save to the live database</span>}
            </div>
          </>
        )}
      </main>

      {/* ── Change log panel ─────────────────────────────────────────────────── */}
      {changePanelOpen && (
        <aside className="w-80 flex-shrink-0 border-l border-gray-100 bg-white flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">Change Log</h3>
            <button className="text-gray-300 hover:text-gray-500 transition-colors text-lg leading-none" onClick={() => setChangePanelOpen(false)}>×</button>
          </div>

          {/* Comment input */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex gap-2">
              <input
                className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                placeholder="Add a comment…"
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComment() } }}
                maxLength={500}
              />
              <button
                className="flex-shrink-0 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition disabled:opacity-40"
                onClick={submitComment}
                disabled={submittingComment || !newComment.trim()}
              >Post</button>
            </div>
          </div>

          {/* Change list */}
          <div className="flex-1 overflow-y-auto">
            {changesLoading && (
              <div className="py-8 text-center text-gray-300 text-xs animate-pulse">Loading…</div>
            )}
            {!changesLoading && changes.length === 0 && (
              <div className="py-8 text-center text-gray-300 text-xs">No changes yet</div>
            )}
            {!changesLoading && changes.map(c => (
              <div key={c.id} className={`px-4 py-3 border-b border-gray-50 ${c.change_type === 'comment' ? 'bg-blue-50/30' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-gray-700">{c.user_name}</span>
                  <span className="text-xs text-gray-300">{fmtTime(c.created_at)}</span>
                </div>
                {c.change_type === 'price' ? (
                  <div>
                    <p className="text-xs text-gray-600 truncate font-medium">{c.display_name}</p>
                    <p className="text-xs text-gray-400">{c.level_name}: <span className="line-through">{c.old_value !== null ? `${sym}${Number(c.old_value).toFixed(2)}` : 'unset'}</span> → <span className="text-emerald-600 font-semibold">{sym}{Number(c.new_value ?? 0).toFixed(2)}</span></p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 italic">"{c.comment}"</p>
                )}
              </div>
            ))}
          </div>
        </aside>
      )}
      </div>

      {/* ── Ingredient breakdown modal ───────────────────────────────────────── */}
      {breakdown && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setBreakdown(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="font-bold text-gray-900 text-base">
                  {breakdown.data?.display_name ?? 'Ingredient breakdown'}
                </h3>
                {breakdown.data?.recipe_name && breakdown.data.recipe_name !== breakdown.data.display_name && (
                  <p className="text-xs text-gray-400 mt-0.5">Recipe: {breakdown.data.recipe_name}</p>
                )}
              </div>
              <button
                className="text-gray-300 hover:text-gray-500 transition-colors text-xl leading-none"
                onClick={() => setBreakdown(null)}
              >×</button>
            </div>

            {/* Modal body */}
            <div className="p-5">
              {breakdown.loading && (
                <div className="py-8 text-center text-gray-400 text-sm animate-pulse">Loading…</div>
              )}
              {!breakdown.loading && breakdown.data && (
                <>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-gray-400 border-b border-gray-100">
                        <th className="text-left pb-2 font-semibold">Ingredient</th>
                        <th className="text-right pb-2 font-semibold">Qty</th>
                        <th className="text-right pb-2 font-semibold">Waste</th>
                        <th className="text-right pb-2 font-semibold">Cost ({data?.menu?.currency_code ?? ''})</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown.data.lines.map((line, i) => (
                        <tr key={i} className="border-b border-gray-50">
                          <td className="py-2 text-gray-700">
                            {line.is_sub_recipe && <span className="mr-1 text-gray-400 text-xs">📋</span>}
                            {line.name}
                          </td>
                          <td className="py-2 text-right text-gray-500 tabular-nums">
                            {fmt2(line.qty)}{line.unit ? ` ${line.unit}` : ''}
                          </td>
                          <td className="py-2 text-right text-gray-400 tabular-nums text-xs">
                            {line.waste_pct > 0 ? `${line.waste_pct}%` : '—'}
                          </td>
                          <td className="py-2 text-right font-mono text-gray-700 tabular-nums">
                            {sym}{fmt2(line.cost_local)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200">
                        <td colSpan={3} className="pt-2.5 font-bold text-gray-700 text-xs uppercase tracking-wide">Total cost</td>
                        <td className="pt-2.5 text-right font-bold text-gray-900 tabular-nums font-mono">
                          {sym}{fmt2(breakdown.data.total_local)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="py-6 text-center text-xs text-gray-300">
        Powered by <span className="font-semibold text-emerald-600">COGS Manager</span>
      </footer>
    </div>
  )
}

// ── KPI tile ─────────────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, colour }: {
  label:  string
  value:  string
  sub:    string
  colour: 'green' | 'amber' | 'red' | 'blue' | 'gray'
}) {
  const bg   = colour === 'green' ? 'bg-emerald-50'
             : colour === 'amber' ? 'bg-amber-50'
             : colour === 'red'   ? 'bg-red-50'
             : colour === 'blue'  ? 'bg-blue-50'
             : 'bg-gray-50'
  const text = colour === 'green' ? 'text-emerald-700'
             : colour === 'amber' ? 'text-amber-700'
             : colour === 'red'   ? 'text-red-600'
             : colour === 'blue'  ? 'text-blue-700'
             : 'text-gray-700'
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold ${text} tabular-nums`}>{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  )
}

// ── Inline price input ────────────────────────────────────────────────────────

function InlineInput({
  value, onChange, onCommit, onCancel,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  return (
    <input
      className="w-20 text-right border border-emerald-400 rounded-md px-2 py-1 text-sm tabular-nums outline-none focus:ring-2 focus:ring-emerald-400/30 bg-white"
      type="number"
      step="0.01"
      min="0"
      autoFocus
      value={value}
      onChange={e => onChange(e.target.value)}
      onBlur={onCommit}
      onKeyDown={e => {
        if (e.key === 'Enter')  onCommit()
        if (e.key === 'Escape') onCancel()
      }}
    />
  )
}
