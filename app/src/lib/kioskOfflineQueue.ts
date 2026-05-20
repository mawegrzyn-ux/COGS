// BACK-2728 — Kiosk PWA offline queue.
//
// Orders placed while the device is offline (or while the API is briefly
// unreachable) are persisted to IndexedDB so they survive a page reload,
// a tab crash, or a multi-hour outage. A drainer (kioskOrderDrainer.ts)
// retries each pending order against POST /api/kiosk-orders until it
// succeeds — the server is idempotent on order_uuid so repeated drains
// never produce duplicates.
//
// We use raw IndexedDB rather than a wrapper library to keep the bundle
// small and avoid a new dep just for this surface.

const DB_NAME    = 'kiosk-offline'
const DB_VERSION = 1
const STORE      = 'orders'

export type QueueStatus = 'queued' | 'syncing' | 'failed' | 'synced'

export interface QueuedOrder {
  order_uuid:        string
  payload:           Record<string, unknown>
  status:            QueueStatus
  attempts:          number
  last_error?:       string | null
  created_at:        number          // epoch ms
  last_attempt_at?:  number | null
  synced_at?:        number | null
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'order_uuid' })
        store.createIndex('status', 'status', { unique: false })
        store.createIndex('created_at', 'created_at', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  return dbPromise
}

function txStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return openDB().then((db) => db.transaction(STORE, mode).objectStore(STORE))
}

/**
 * Add a new order to the queue. Returns the queued record.
 * Idempotent — re-enqueuing the same order_uuid is a no-op (order already
 * present). Caller should generate order_uuid via crypto.randomUUID().
 */
export async function enqueueOrder(
  order_uuid: string,
  payload: Record<string, unknown>,
): Promise<QueuedOrder> {
  const store = await txStore('readwrite')
  return new Promise((resolve, reject) => {
    const existing = store.get(order_uuid)
    existing.onsuccess = () => {
      if (existing.result) { resolve(existing.result as QueuedOrder); return }
      const row: QueuedOrder = {
        order_uuid,
        payload,
        status:     'queued',
        attempts:   0,
        created_at: Date.now(),
      }
      const put = store.put(row)
      put.onsuccess = () => resolve(row)
      put.onerror   = () => reject(put.error)
    }
    existing.onerror = () => reject(existing.error)
  })
}

/** All orders that still need to be sent. */
export async function listPending(): Promise<QueuedOrder[]> {
  const store = await txStore('readonly')
  return new Promise((resolve, reject) => {
    const rows: QueuedOrder[] = []
    const cursor = store.openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(rows); return }
      const row = c.value as QueuedOrder
      if (row.status === 'queued' || row.status === 'failed' || row.status === 'syncing') {
        rows.push(row)
      }
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })
}

/** All orders, regardless of status — used by the diagnostic panel. */
export async function listAll(): Promise<QueuedOrder[]> {
  const store = await txStore('readonly')
  return new Promise((resolve, reject) => {
    const req = store.getAll()
    req.onsuccess = () => resolve((req.result as QueuedOrder[] | undefined) || [])
    req.onerror   = () => reject(req.error)
  })
}

/** Count of orders that still need to be sent. Cheap — uses status index. */
export async function countPending(): Promise<number> {
  const store = await txStore('readonly')
  return new Promise((resolve, reject) => {
    const idx = store.index('status')
    let total = 0
    const cursor = idx.openCursor(IDBKeyRange.bound('failed', 'syncing'))
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(total); return }
      const row = c.value as QueuedOrder
      if (row.status === 'queued' || row.status === 'failed' || row.status === 'syncing') total += 1
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })
}

async function patchRow(
  order_uuid: string,
  patch: (row: QueuedOrder) => QueuedOrder,
): Promise<void> {
  const store = await txStore('readwrite')
  return new Promise((resolve, reject) => {
    const get = store.get(order_uuid)
    get.onsuccess = () => {
      const row = get.result as QueuedOrder | undefined
      if (!row) { resolve(); return }
      const next = patch(row)
      const put = store.put(next)
      put.onsuccess = () => resolve()
      put.onerror   = () => reject(put.error)
    }
    get.onerror = () => reject(get.error)
  })
}

export function markSyncing(order_uuid: string) {
  return patchRow(order_uuid, (row) => ({
    ...row,
    status:           'syncing',
    attempts:         row.attempts + 1,
    last_attempt_at:  Date.now(),
    last_error:       null,
  }))
}

export function markSynced(order_uuid: string) {
  return patchRow(order_uuid, (row) => ({
    ...row,
    status:     'synced',
    synced_at:  Date.now(),
    last_error: null,
  }))
}

export function markFailed(order_uuid: string, err: string) {
  return patchRow(order_uuid, (row) => ({
    ...row,
    status:      'failed',
    last_error:  err,
  }))
}

/**
 * Sweep synced orders older than `olderThanMs` (default 24h) so the
 * IndexedDB doesn't grow unboundedly. Called opportunistically by the
 * drainer; never runs in a hot path.
 */
export async function pruneSynced(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - olderThanMs
  const store  = await txStore('readwrite')
  return new Promise((resolve, reject) => {
    let removed  = 0
    const cursor = store.openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (!c) { resolve(removed); return }
      const row = c.value as QueuedOrder
      if (row.status === 'synced' && (row.synced_at || 0) < cutoff) {
        c.delete()
        removed += 1
      }
      c.continue()
    }
    cursor.onerror = () => reject(cursor.error)
  })
}
