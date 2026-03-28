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
  menu:         SharedMenuInfo
  price_levels: PriceLevel[]
  items:        SharedItem[]
  menus:        { id: number; name: string }[]
  scenario:     { id: number; name: string } | null
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
    if (token) loadData(token)
  }, [token]) // eslint-disable-line

  // ── Auth ─────────────────────────────────────────────────────────────────────

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    if (!slug || !password) return
    setAuthLoading(true)
    setAuthError('')
    try {
      const r = await fetch(`${API_BASE}/public/share/${slug}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const d = await r.json()
      if (d.error) { setAuthError(d.error.message); return }
      sessionStorage.setItem(tokenKey(slug), d.token)
      setToken(d.token)
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
      await loadData(token, selectedMenuId)
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
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Access password</label>
            <input
              type="password"
              className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              placeholder="Enter password"
            />
          </div>
          {authError && <p className="text-red-500 text-sm">{authError}</p>}
          <button
            type="submit"
            className="w-full py-2.5 px-4 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition disabled:opacity-50"
            disabled={authLoading || !password}
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

  // ── Render: authenticated ────────────────────────────────────────────────────

  const isEdit = meta?.mode === 'edit'
  const sym    = data?.menu.currency_symbol ?? ''
  const levels = data?.price_levels ?? []

  return (
    <div className="min-h-screen bg-gray-50">

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
            <div className="text-right flex-shrink-0">
              <div className="font-semibold text-gray-800 text-sm">{data.menu.name}</div>
              <div className="text-xs text-gray-400">{data.menu.country_name} · {data.menu.currency_code}</div>
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

      {/* ── Notifications ────────────────────────────────────────────────────── */}
      {saving    && <div className="bg-blue-50  text-blue-700  text-sm px-6 py-2 text-center">Saving…</div>}
      {saveOk    && <div className="bg-green-50 text-green-700 text-sm px-6 py-2 text-center font-medium">{saveOk}</div>}
      {saveError && <div className="bg-red-50   text-red-600   text-sm px-6 py-2 text-center">{saveError}</div>}
      {dataError && <div className="bg-red-50   text-red-600   text-sm px-6 py-2 text-center">{dataError}</div>}

      {/* ── Content area ─────────────────────────────────────────────────────── */}
      <main className="max-w-screen-xl mx-auto px-4 sm:px-6 py-6">

        {dataLoading && (
          <div className="flex items-center justify-center py-24 text-gray-400 text-sm animate-pulse">Loading data…</div>
        )}

        {!dataLoading && data && data.items.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-100 p-16 text-center text-gray-400 text-sm">
            No items on this menu.
          </div>
        )}

        {!dataLoading && data && data.items.length > 0 && (
          <>
            {/* Summary card */}
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{data.menu.name}</h2>
                  <p className="text-sm text-gray-400 mt-0.5">
                    {data.menu.country_name} · {data.menu.currency_code} ({sym})
                    {data.scenario && <span className="ml-2 text-amber-600 font-medium">Scenario: {data.scenario.name}</span>}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400">{data.items.length} items across {categories.length} categories</span>
                  <button onClick={expandAll}  className="text-xs text-emerald-600 hover:underline">Expand all</button>
                  <span className="text-gray-200">|</span>
                  <button onClick={collapseAll} className="text-xs text-emerald-600 hover:underline">Collapse all</button>
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
                                return (
                                  <td key={l.id} className="px-4 py-3 text-center">
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

                              return (
                                <td key={l.id} className="px-4 py-3">
                                  {isEdit && isEditing ? (
                                    <InlineInput
                                      value={editCell!.value}
                                      onChange={v => setEditCell(prev => prev ? { ...prev, value: v } : null)}
                                      onCommit={commitEdit}
                                      onCancel={() => setEditCell(null)}
                                    />
                                  ) : (
                                    <button
                                      className={`w-full text-right ${isEdit ? 'hover:bg-emerald-50 rounded-md px-1 -mx-1 cursor-pointer transition-colors' : 'cursor-default'}`}
                                      onClick={isEdit ? () => setEditCell({ itemId: item.menu_item_id, levelId: l.id, value: fmt2(entry.gross) }) : undefined}
                                      disabled={!isEdit}
                                    >
                                      <div className="flex items-center justify-end gap-1">
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
                                        <div className="mt-1 h-1 rounded-full bg-gray-100 overflow-hidden">
                                          <div
                                            className={`h-full rounded-full ${cogsBarCls(entry.cogs_pct)} transition-all`}
                                            style={{ width: `${Math.min(100, entry.cogs_pct)}%` }}
                                          />
                                        </div>
                                      )}
                                    </button>
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
