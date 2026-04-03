import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import {
  PermissionsContext,
  type MeUser,
  type Feature,
  type AccessLevel,
} from '../hooks/usePermissions'

const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

export default function PermissionsProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, getAccessTokenSilently } = useAuth0()
  const [user,    setUser]    = useState<MeUser | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    if (!isAuthenticated) { setUser(null); setLoading(false); return }
    try {
      const token = await getAccessTokenSilently()
      const res   = await fetch(`${API_BASE}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setUser(await res.json())
      } else {
        // 403 PENDING or DISABLED — still set user to null so pending screen shows
        setUser(null)
        const body = await res.json().catch(() => ({}))
        if (body?.error?.code === 'PENDING') {
          setUser({ status: 'pending' } as MeUser)
        }
      }
    } catch {
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [isAuthenticated, getAccessTokenSilently])

  useEffect(() => { reload() }, [reload])

  const can = useCallback((feature: Feature, level: 'read' | 'write'): boolean => {
    if (!user || user.status !== 'active') return false
    const access: AccessLevel = user.permissions?.[feature] || 'none'
    return level === 'read' ? (access === 'read' || access === 'write') : access === 'write'
  }, [user])

  const value = useMemo(() => ({
    user,
    loading,
    can,
    isDev:            !!(user?.is_dev),
    allowedCountries: user?.allowedCountries ?? null,
    reload,
  }), [user, loading, can, reload])

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  )
}
