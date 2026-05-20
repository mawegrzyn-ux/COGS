import { useState, useRef, useEffect } from 'react'
import { useMarket } from '../contexts/MarketContext'

/**
 * Top-bar market switcher. Surfaces the currently-selected country (or "All markets")
 * and opens a dropdown scoped to the user's allowedCountries. Writes through to
 * MarketContext which all dashboard widgets listen to.
 */
export default function MarketSwitcher() {
  const { countryId, setCountryId, countries, selected, loading } = useMarket()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dismiss on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Reset search each time the dropdown opens
  useEffect(() => { if (!open) setSearch('') }, [open])

  if (loading) return (
    <div className="h-9 w-48 rounded-lg bg-surface-2 animate-pulse" />
  )

  if (!countries.length) return null

  const filtered = search.trim()
    ? countries.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
    : countries

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          selected
            ? 'border-accent/40 bg-accent-dim text-accent hover:bg-accent/10'
            : 'border-border bg-surface text-text-2 hover:bg-surface-2'
        }`}
        title="Switch market"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span className="font-medium">
          {selected ? selected.name : 'All markets'}
        </span>
        {selected && (
          <span className="text-xs font-mono opacity-70">{selected.currency_symbol}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1 w-64 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 max-h-[420px] overflow-y-auto"
        >
          {countries.length > 6 && (
            <div className="px-2 pb-1 pt-0.5 sticky top-0 bg-surface">
              <input
                autoFocus
                className="input text-sm w-full"
                placeholder="Search markets…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          )}

          <button
            onClick={() => { setCountryId(null); setOpen(false) }}
            className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-surface-2 ${
              countryId === null ? 'text-accent font-medium' : 'text-text-1'
            }`}
          >
            <span>All markets</span>
            {countryId === null && <CheckIcon />}
          </button>

          <div className="border-t border-border my-1" />

          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-3 text-center">No match</div>
          ) : filtered.map(c => (
            <button
              key={c.id}
              onClick={() => { setCountryId(c.id); setOpen(false) }}
              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-surface-2 ${
                countryId === c.id ? 'text-accent font-medium' : 'text-text-1'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="w-6 text-center text-xs font-mono text-text-3">{c.currency_symbol}</span>
                <span>{c.name}</span>
              </span>
              {countryId === c.id && <CheckIcon />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  )
}
