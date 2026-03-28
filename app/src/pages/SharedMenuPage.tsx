// =============================================================================
// Shared Menu Engineer Page — public, no Auth0, password-protected
// URL: /share/:slug
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
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
}

interface PriceLevel { id: number; name: string }

interface LevelEntry {
  set:      boolean
  gross:    number | null
  net:      number | null
  cogs_pct: number | null
  gp_net:   number | null
  lp_id?:   number
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL || '/api') as string

const fmt2   = (n: number | null | undefined) => Number(n ?? 0).toFixed(2)
const cogsCls = (pct: number | null): string => {
  if (pct === null) return 'text-gray-400'
  if (pct <= 28) return 'text-emerald-600 font-semibold'
  if (pct <= 35) return 'text-amber-500 font-semibold'
  return 'text-red-500 font-semibold'
}

function tokenKey(slug: string) { return `sp_token_${slug}` }

// ── Component ─────────────────────────────────────────────────────────────────

export default function SharedMenuPage() {
  const { slug } = useParams<{ slug: string }>()

  const [meta,         setMeta]         = useState<PageMeta | null>(null)
  const [metaError,    setMetaError]    = useState('')
  const [metaLoading,  setMetaLoading]  = useState(true)

  const [password,     setPassword]     = useState('')
  const [authError,    setAuthError]    = useState('')
  const [authLoading,  setAuthLoading]  = useState(false)

  const [token,        setToken]        = useState<string | null>(null)
  const [data,         setData]         = useState<SharedData | null>(null)
  const [dataLoading,  setDataLoading]  = useState(false)
  const [dataError,    setDataError]    = useState('')

  const [selectedMenuId, setSelectedMenuId] = useState<number | null>(null)
  const [editCell,     setEditCell]     = useState<{ itemId: number; levelId: number; value: string } | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [saveOk,       setSaveOk]       = useState<string | null>(null)

  // ── Load meta ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!slug) return
    setMetaLoading(true)
    fetch(`${API_BASE}/public/share/${slug}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setMetaError(d.error.message); return }
        setMeta(d)
        // Restore token from sessionStorage
        const stored = sessionStorage.getItem(tokenKey(slug))
        if (stored) setToken(stored)
      })
      .catch(() => setMetaError('Could not load this page.'))
      .finally(() => setMetaLoading(false))
  }, [slug])

  // ── Load data when token is available ────────────────────────────────────────

  const loadData = useCallback(async (tok: string, menuId?: number | null) => {
    if (!slug) return
    setDataLoading(true)
    setDataError('')
    const mid = menuId ?? selectedMenuId ?? meta?.menu_id
    const url  = `${API_BASE}/public/share/${slug}/data${mid ? `?menu_id=${mid}` : ''}`
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${tok}` },
      })
      const d = await r.json()
      if (d.error) {
        setDataError(d.error.message)
        if (r.status === 401) {
          // Token expired — clear it
          sessionStorage.removeItem(tokenKey(slug))
          setToken(null)
        }
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

  // ── Auth submit ───────────────────────────────────────────────────────────────

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

  // ── Inline price save (edit mode only) ───────────────────────────────────────

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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          menu_item_id:   editCell.itemId,
          price_level_id: editCell.levelId,
          sell_price:     Math.round(gross * 10000) / 10000,
        }),
      })
      const d = await r.json()
      if (d.error) { setSaveError(d.error.message); return }
      setSaveOk('Saved')
      setTimeout(() => setSaveOk(null), 2000)
      await loadData(token, selectedMenuId)
    } catch {
      setSaveError('Failed to save price.')
    } finally {
      setSaving(false)
      setEditCell(null)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (metaLoading) return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center">
      <div className="text-text-3 text-sm">Loading…</div>
    </div>
  )

  if (metaError) return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
      <div className="card max-w-sm w-full p-8 text-center">
        <div className="text-4xl mb-4">🔗</div>
        <h1 className="text-xl font-bold text-text-1 mb-2">Link unavailable</h1>
        <p className="text-text-3 text-sm">{metaError}</p>
      </div>
    </div>
  )

  // ── Password gate ─────────────────────────────────────────────────────────────

  if (!token) return (
    <div className="min-h-screen bg-surface-2 flex items-center justify-center p-6">
      <div className="card max-w-sm w-full p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-accent-dim flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-text-1">{meta?.name}</h1>
            <p className="text-xs text-text-3">Password protected</p>
          </div>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-2 mb-1">Password</label>
            <input
              type="password"
              className="input w-full"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
              placeholder="Enter access password"
            />
          </div>
          {authError && <p className="text-red-500 text-sm">{authError}</p>}
          <button type="submit" className="btn btn-primary w-full" disabled={authLoading || !password}>
            {authLoading ? 'Checking…' : 'View Menu'}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-text-3">
          Powered by <span className="font-semibold text-accent">COGS Manager</span>
        </p>
      </div>
    </div>
  )

  // ── Authenticated view ────────────────────────────────────────────────────────

  const isEdit = meta?.mode === 'edit'
  const sym    = data?.menu.currency_symbol ?? ''
  const levels = data?.price_levels ?? []

  return (
    <div className="min-h-screen bg-surface-2">
      {/* Header */}
      <header className="bg-white border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-accent-dim flex items-center justify-center">
            <span className="text-accent font-bold text-sm">C</span>
          </div>
          <div>
            <h1 className="font-bold text-text-1 text-sm">{meta?.name}</h1>
            <p className="text-xs text-text-3">
              {meta?.mode === 'edit' ? '✏️ Edit mode' : '👁 View only'}
              {meta?.market_locked && meta?.country_name ? ` · ${meta.country_name}` : ''}
            </p>
          </div>
        </div>
        {data && (
          <div className="text-right">
            <div className="font-semibold text-text-1 text-sm">{data.menu.name}</div>
            <div className="text-xs text-text-3">{data.menu.country_name} · {data.menu.currency_code}</div>
          </div>
        )}
      </header>

      {/* Menu switcher (if not locked and multiple menus available) */}
      {token && data && !meta?.menu_locked && data.menus.length > 1 && (
        <div className="bg-white border-b border-border px-6 py-2 flex items-center gap-3">
          <span className="text-sm text-text-3">Menu:</span>
          <select
            className="input input-sm"
            value={selectedMenuId ?? ''}
            onChange={e => {
              const id = Number(e.target.value)
              setSelectedMenuId(id)
              loadData(token, id)
            }}
          >
            {data.menus.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      )}

      {/* Notifications */}
      {saving    && <div className="bg-blue-50  text-blue-700  text-sm px-6 py-2">Saving…</div>}
      {saveOk    && <div className="bg-green-50 text-green-700 text-sm px-6 py-2">{saveOk}</div>}
      {saveError && <div className="bg-red-50   text-red-700   text-sm px-6 py-2">{saveError}</div>}
      {dataError && <div className="bg-red-50   text-red-700   text-sm px-6 py-2">{dataError}</div>}

      {/* Data table */}
      {dataLoading && (
        <div className="flex items-center justify-center py-20 text-text-3 text-sm">Loading data…</div>
      )}

      {!dataLoading && data && data.items.length === 0 && (
        <div className="flex items-center justify-center py-20 text-text-3 text-sm">No items on this menu.</div>
      )}

      {!dataLoading && data && data.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-white border-b border-border sticky top-0 z-10">
                <th className="text-left px-4 py-3 font-semibold text-text-2 whitespace-nowrap">Item</th>
                <th className="text-left px-4 py-3 font-semibold text-text-2 whitespace-nowrap">Category</th>
                <th className="text-right px-4 py-3 font-semibold text-text-2 whitespace-nowrap">
                  Cost ({data.menu.currency_code})
                </th>
                {levels.map(l => (
                  <th key={l.id} className="text-right px-3 py-3 font-semibold text-text-2 whitespace-nowrap min-w-[100px]">
                    {l.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((item, idx) => (
                <tr key={item.menu_item_id}
                  className={`border-b border-border ${idx % 2 === 0 ? 'bg-white' : 'bg-surface-2'} hover:bg-accent-dim/30 transition-colors`}>
                  <td className="px-4 py-2.5 text-text-1 whitespace-nowrap max-w-[220px] truncate">
                    {item.display_name}
                  </td>
                  <td className="px-4 py-2.5 text-text-3 text-xs whitespace-nowrap">{item.category || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-text-2 whitespace-nowrap tabular-nums">
                    {sym}{fmt2(item.cost)}
                  </td>
                  {levels.map(l => {
                    const entry = item.levels[l.id]
                    const isEditing = editCell?.itemId === item.menu_item_id && editCell?.levelId === l.id

                    if (!entry?.set) {
                      return (
                        <td key={l.id} className="px-3 py-2.5 text-center">
                          {isEdit ? (
                            isEditing ? (
                              <input
                                className="input input-sm w-20 text-right tabular-nums"
                                type="number"
                                step="0.01"
                                min="0"
                                autoFocus
                                value={editCell?.value ?? ''}
                                onChange={e => setEditCell(prev => prev ? { ...prev, value: e.target.value } : null)}
                                onBlur={commitEdit}
                                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }}
                              />
                            ) : (
                              <button
                                className="text-text-3 text-xs hover:text-accent"
                                onClick={() => setEditCell({ itemId: item.menu_item_id, levelId: l.id, value: '' })}
                              >
                                + set
                              </button>
                            )
                          ) : (
                            <span className="text-text-3 text-xs">—</span>
                          )}
                        </td>
                      )
                    }

                    return (
                      <td key={l.id} className="px-3 py-2.5 text-right whitespace-nowrap">
                        {isEdit && isEditing ? (
                          <input
                            className="input input-sm w-20 text-right tabular-nums"
                            type="number"
                            step="0.01"
                            min="0"
                            autoFocus
                            value={editCell?.value ?? ''}
                            onChange={e => setEditCell(prev => prev ? { ...prev, value: e.target.value } : null)}
                            onBlur={commitEdit}
                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditCell(null) }}
                          />
                        ) : (
                          <button
                            className={`text-right w-full ${isEdit ? 'hover:bg-accent-dim/50 rounded px-1 cursor-pointer' : 'cursor-default'}`}
                            onClick={isEdit ? () => setEditCell({ itemId: item.menu_item_id, levelId: l.id, value: fmt2(entry.gross) }) : undefined}
                            disabled={!isEdit}
                          >
                            <div className="font-medium text-text-1 tabular-nums">{sym}{fmt2(entry.gross)}</div>
                            <div className={`text-xs tabular-nums ${cogsCls(entry.cogs_pct)}`}>
                              {entry.cogs_pct !== null ? `${fmt2(entry.cogs_pct)}%` : '—'}
                            </div>
                          </button>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer */}
      <footer className="px-6 py-4 text-center text-xs text-text-3 border-t border-border mt-4">
        <span className="font-medium text-accent">COGS Manager</span>
        {isEdit && (
          <span className="ml-2 text-amber-600">· Edit mode — changes save to the live database</span>
        )}
      </footer>
    </div>
  )
}
