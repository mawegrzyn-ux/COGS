export function useApi() {
  const base = '/kanban/api'

  async function request(method: string, path: string, body?: unknown) {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
    }
    if (body) opts.body = JSON.stringify(body)
    const res = await fetch(`${base}${path}`, opts)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
      throw new Error(err.error?.message || err.message || res.statusText)
    }
    if (res.status === 204) return null
    return res.json()
  }

  return {
    get:  (path: string) => request('GET', path),
    post: (path: string, body?: unknown) => request('POST', path, body),
    put:  (path: string, body?: unknown) => request('PUT', path, body),
    del:  (path: string) => request('DELETE', path),
  }
}
