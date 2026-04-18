import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import i18n from '../i18n'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'

export interface Language {
  code: string
  name: string
  native_name: string | null
  is_default: boolean
  is_rtl: boolean
  is_active: boolean
  sort_order: number
}

interface LanguageContextValue {
  language: string                          // current code (e.g. 'en')
  setLanguage: (code: string) => void       // persists + notifies
  languages: Language[]                     // active languages the user can pick
  loading: boolean
  reload: () => Promise<void>
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  setLanguage: () => {},
  languages: [],
  loading: true,
  reload: async () => {},
})

const STORAGE_KEY = 'mcogs-language'

// Exported helper used by useApi.ts to read the current language synchronously
// without subscribing to context (avoids coupling the hook to React tree state).
export function getCurrentLanguage(): string {
  return localStorage.getItem(STORAGE_KEY) || 'en'
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const { user } = usePermissions()
  const [languages, setLanguages] = useState<Language[]>([])
  const [loading, setLoading] = useState(true)
  const [language, setLanguageState] = useState<string>(() => getCurrentLanguage())

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const rows: Language[] = await api.get('/languages').catch(() => [])
      const active = rows.filter(l => l.is_active).sort((a, b) => a.sort_order - b.sort_order)
      setLanguages(active)
      // If current selection is no longer active, fall back to default
      if (language && !active.find(l => l.code === language)) {
        const def = (active.find(l => l.is_default) || active[0])?.code || 'en'
        setLanguageState(def)
        localStorage.setItem(STORAGE_KEY, def)
      }
    } finally {
      setLoading(false)
    }
  }, [api, language])

  useEffect(() => {
    if (!user) return
    reload()
  }, [user, reload])

  const setLanguage = useCallback((code: string) => {
    setLanguageState(code)
    localStorage.setItem(STORAGE_KEY, code)
    // Swap i18next language immediately so UI strings update without reload
    try { i18n.changeLanguage(code) } catch { /* i18n not initialised yet */ }
    // Persist on the user profile so future sessions inherit it (fire-and-forget).
    // The profile_json field is flat JSONB so partial update is fine.
    api.put('/memory/profile', { profile_json: { preferred_language: code } }).catch(() => {})
    // Trigger a full re-fetch so any in-flight queries re-run with the new X-Language header
    window.dispatchEvent(new CustomEvent('mcogs-language-changed', { detail: { code } }))
  }, [api])

  // Ensure i18n is synced with the initial stored language
  useEffect(() => {
    if (i18n.language !== language) {
      try { i18n.changeLanguage(language) } catch {}
    }
  }, [language])

  const value = useMemo<LanguageContextValue>(() => ({
    language, setLanguage, languages, loading, reload,
  }), [language, setLanguage, languages, loading, reload])

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  return useContext(LanguageContext)
}
