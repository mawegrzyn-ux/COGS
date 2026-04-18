import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react'
import { useApi } from '../hooks/useApi'
import { usePermissions } from '../hooks/usePermissions'

// Feature flags control which top-level modules are surfaced in the UI.
// They do NOT replace RBAC — RBAC still enforces per-user access. These
// flags let an Admin hide modules that aren't in use at the organisation
// level (e.g. a single-site operator who doesn't need HACCP).
export interface FeatureFlags {
  stock_manager: boolean
  haccp:         boolean
  allergens:     boolean
  variations:    boolean
}

export const DEFAULT_FLAGS: FeatureFlags = {
  stock_manager: true,
  haccp:         true,
  allergens:     true,
  variations:    true,
}

interface FeatureFlagsContextValue {
  flags:   FeatureFlags
  loading: boolean
  reload:  () => Promise<void>
  /** Partial update — merges into existing flags and saves. Admin only. */
  update:  (patch: Partial<FeatureFlags>) => Promise<void>
}

const FeatureFlagsContext = createContext<FeatureFlagsContextValue>({
  flags:   DEFAULT_FLAGS,
  loading: true,
  reload:  async () => {},
  update:  async () => {},
})

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const api = useApi()
  const { user } = usePermissions()
  const [flags, setFlags] = useState<FeatureFlags>(DEFAULT_FLAGS)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const settings = await api.get('/settings').catch(() => ({}))
      const stored = (settings?.feature_flags ?? {}) as Partial<FeatureFlags>
      setFlags({ ...DEFAULT_FLAGS, ...stored })
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (!user) return
    reload()
  }, [user, reload])

  const update = useCallback(async (patch: Partial<FeatureFlags>) => {
    const next = { ...flags, ...patch }
    setFlags(next) // optimistic
    try {
      await api.patch('/settings', { feature_flags: next })
    } catch {
      // revert on failure
      setFlags(flags)
      throw new Error('Failed to save feature flags')
    }
  }, [api, flags])

  const value = useMemo<FeatureFlagsContextValue>(() => ({
    flags, loading, reload, update,
  }), [flags, loading, reload, update])

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>
}

export function useFeatureFlags() {
  return useContext(FeatureFlagsContext)
}
