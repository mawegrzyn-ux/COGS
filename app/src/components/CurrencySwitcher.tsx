import { useState, useRef, useEffect } from 'react'
import { useCurrency } from '../contexts/CurrencyContext'

/**
 * Top-bar Display Currency switcher. Pairs with MarketSwitcher.
 * Stores the selected currency code globally (CurrencyContext) — every consuming
 * page resolves the actual exchange rate against its own market context.
 */
export default function CurrencySwitcher() {
  const { currencyCode, setCurrencyCode, options, loading } = useCurrency()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (loading) return <div className="h-9 w-32 rounded-lg bg-surface-2 animate-pulse" />

  const active = options.find(o => o.value === currencyCode) ?? options[0]
  const isCustom = currencyCode !== ''

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
          isCustom
            ? 'border-accent/40 bg-accent-dim text-accent hover:bg-accent/10'
            : 'border-border bg-surface text-text-2 hover:bg-surface-2'
        }`}
        title="Display currency"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="1" x2="12" y2="23"/>
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
        </svg>
        <span className="font-medium">
          {currencyCode === '' ? 'Market' : currencyCode === '__BASE__' ? 'USD' : currencyCode}
        </span>
        {active.symbol && currencyCode !== '' && (
          <span className="text-xs font-mono opacity-70">{active.symbol}</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-56 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 max-h-[420px] overflow-y-auto">
          {options.map(opt => (
            <button
              key={opt.value || 'market'}
              onClick={() => { setCurrencyCode(opt.value); setOpen(false) }}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between transition-colors ${
                opt.value === currencyCode
                  ? 'bg-accent-dim text-accent font-medium'
                  : 'text-text-1 hover:bg-surface-2'
              }`}
            >
              <span>{opt.label}</span>
              {opt.symbol && <span className="font-mono text-xs text-text-3">{opt.symbol}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
