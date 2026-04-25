import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguage } from '../contexts/LanguageContext'

/**
 * Compact language dropdown — intended for the sidebar footer.
 * Clicking a language persists to localStorage + user profile, then
 * refreshes the page so all queries re-run with the new X-Language header.
 */
export default function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language, setLanguage, languages, loading } = useLanguage()
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (loading || !languages.length) return null

  const current = languages.find(l => l.code === language) || languages[0]

  function onPick(code: string) {
    setLanguage(code)
    setOpen(false)
    // Soft reload — fastest way to ensure all cached queries re-run
    setTimeout(() => window.location.reload(), 100)
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 rounded-lg border border-border bg-surface hover:bg-surface-2 transition-colors text-text-2 ${
          compact ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm'
        }`}
        title={t('change_language')}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
        <span className="font-mono uppercase tracking-wide">{current.code}</span>
      </button>

      {open && (
        // Anchored top-down + right-aligned to match MarketSwitcher / CurrencySwitcher
        // in the top bar. (The old bottom-up anchor was for the sidebar footer.)
        <div className="absolute top-full mt-1 right-0 w-40 bg-surface border border-border rounded-lg shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
          {languages.map(l => (
            <button
              key={l.code}
              onClick={() => onPick(l.code)}
              className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between hover:bg-surface-2 ${
                l.code === language ? 'text-accent font-medium' : 'text-text-1'
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-text-3 w-6">{l.code}</span>
                <span>{l.native_name || l.name}</span>
              </span>
              {l.code === language && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
