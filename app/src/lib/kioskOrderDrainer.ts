// BACK-2728 — Kiosk PWA queue drainer.
//
// Iterates queued/failed orders in IndexedDB and POSTs each to
// /api/kiosk-orders. Drains run on:
//   - app mount (kiosk page)
//   - online event
//   - 30s interval while online
//   - immediately after each enqueue
//
// The server endpoint is idempotent on order_uuid, so repeated drains never
// produce duplicates. Auth is provided by the caller (Auth0 access token
// from the kiosk page's React tree).

import {
  listPending,
  markSyncing,
  markSynced,
  markFailed,
  pruneSynced,
  countPending,
  type QueuedOrder,
} from './kioskOfflineQueue'

const API_BASE = import.meta.env.VITE_API_URL || '/api'

export type DrainResult = {
  attempted: number
  synced:    number
  failed:    number
  pending:   number   // remaining after this drain
}

export type DrainListener = (info: DrainResult & { running: boolean }) => void

let inFlight = false
const listeners = new Set<DrainListener>()

export function onDrainerEvent(cb: DrainListener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function emit(info: DrainResult & { running: boolean }) {
  for (const cb of listeners) {
    try { cb(info) } catch { /* listener error — never block */ }
  }
}

/**
 * Attempt to drain every pending queued order.
 *
 * `getAccessToken` returns a fresh Auth0 access token (typically the
 * useAuth0().getAccessTokenSilently). When offline OR the token fetch
 * fails, the drain bails out without marking anything failed — those
 * orders stay 'queued' and we'll retry next cycle.
 */
export async function drainKioskQueue(
  getAccessToken: () => Promise<string>,
): Promise<DrainResult> {
  if (inFlight) return { attempted: 0, synced: 0, failed: 0, pending: await countPending() }
  inFlight = true

  let synced  = 0
  let failed  = 0
  let attempted = 0

  try {
    const pending = await listPending()
    if (!pending.length) {
      const result = { attempted: 0, synced: 0, failed: 0, pending: 0 }
      emit({ ...result, running: false })
      return result
    }

    // Bail if we're offline — every POST will fail in the same way; better
    // to wait for the online event rather than burn through the queue and
    // mark everything 'failed'.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      const result = { attempted: 0, synced: 0, failed: 0, pending: pending.length }
      emit({ ...result, running: false })
      return result
    }

    let token: string
    try {
      token = await getAccessToken()
    } catch {
      // No token, can't drain. Don't mark anything failed — try again later.
      const result = { attempted: 0, synced: 0, failed: 0, pending: pending.length }
      emit({ ...result, running: false })
      return result
    }

    emit({ attempted: 0, synced: 0, failed: 0, pending: pending.length, running: true })

    for (const order of pending) {
      attempted += 1
      try {
        await markSyncing(order.order_uuid)
        const ok = await postOrder(token, order)
        if (ok) {
          await markSynced(order.order_uuid)
          synced += 1
        } else {
          await markFailed(order.order_uuid, 'non-ok response')
          failed += 1
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'unknown error'
        await markFailed(order.order_uuid, msg)
        failed += 1
        // Network blip mid-drain — stop the loop and try the rest later.
        // We don't want to thrash through 50 queued orders when the radio
        // is down.
        if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) break
      }
    }

    // Opportunistic cleanup of synced rows >24h old.
    pruneSynced().catch(() => {})

    const remaining = await countPending()
    const result = { attempted, synced, failed, pending: remaining }
    emit({ ...result, running: false })
    return result
  } finally {
    inFlight = false
  }
}

async function postOrder(token: string, order: QueuedOrder): Promise<boolean> {
  const res = await fetch(`${API_BASE}/kiosk-orders`, {
    method: 'POST',
    headers: {
      'Content-Type':   'application/json',
      'Authorization':  `Bearer ${token}`,
    },
    body: JSON.stringify(order.payload),
  })
  // 200 = inserted or duplicate-acknowledged; either counts as synced.
  if (res.ok) return true
  // 4xx = malformed payload — won't get better with retries. Mark failed
  // so a human can spot it; don't keep hammering.
  if (res.status >= 400 && res.status < 500) return false
  // 5xx — transient; raise to caller so it knows to stop the loop.
  throw new Error(`kiosk-orders POST ${res.status}`)
}
