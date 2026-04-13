import { useAuth0 } from '@auth0/auth0-react'
import { useCallback, useMemo } from 'react'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

export function useApi() {
  const { getAccessTokenSilently } = useAuth0()

  const request = useCallback(async (
    method: string,
    path: string,
    body?: unknown
  ) => {
    let headers: Record<string, string> = { 'Content-Type': 'application/json' }
    try {
      const token = await getAccessTokenSilently()
      if (token) headers['Authorization'] = `Bearer ${token}`
    } catch {
      // No audience configured — skip auth header (dev mode)
    }
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    if (res.status === 204) return null
    const data = await res.json()
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`)
    return data
  }, [getAccessTokenSilently])

  return useMemo(() => ({
    get:    (path: string)                => request('GET',    path),
    post:   (path: string, body?: unknown) => request('POST',   path, body),
    put:    (path: string, body?: unknown) => request('PUT',    path, body),
    patch:  (path: string, body?: unknown) => request('PATCH',  path, body),
    delete: (path: string)               => request('DELETE', path),
  }), [request])
}
