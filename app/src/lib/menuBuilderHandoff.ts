// Handoff state for the Menu Builder → source-module Create flow (BACK-2652).
//
// User clicks "+ Add new" on the Menu Builder add-item picker → we stash a
// handoff in sessionStorage and same-tab navigate to the relevant source
// module (/recipes, /inventory, /sales-items). The source module renders a
// ReturnToMenuBuilderBanner at the top of the page and auto-opens its
// Create modal. After the user has saved (and finished any multi-step
// flow — recipe variants, combo steps + modifiers, etc.), they click the
// banner to wrap the new entity in a sales item (if needed) and attach it
// to the originating menu, then navigate back to /menu-builder.
//
// Two sessionStorage entries:
//   menu-builder-handoff          set on Menu Builder navigation, cleared on
//                                 banner click or banner cancel
//   menu-builder-pending-attach   set by the source module's save handler,
//                                 cleared on banner click or banner cancel

export type HandoffItemType = 'recipe' | 'ingredient' | 'manual' | 'combo'

export type Handoff = {
  menu_id:    number
  menu_name:  string
  item_type:  HandoffItemType
  ts:         number
}

export type PendingAttach =
  | { type: 'recipe';     id: number; name: string; category_id?: number | null }
  | { type: 'ingredient'; id: number; name: string; category_id?: number | null }
  | { type: 'combo';      id: number; name: string }
  | { type: 'sales_item'; id: number; name: string }

const HANDOFF_KEY        = 'menu-builder-handoff'
const PENDING_ATTACH_KEY = 'menu-builder-pending-attach'
const CHANGE_EVENT       = 'mb-handoff-changed'
// Expire stale handoffs after 24h so an abandoned flow doesn't haunt the UI
// forever. The handoff is also cleared on every successful attach + cancel.
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000

export function setHandoff(h: Omit<Handoff, 'ts'>) {
  try {
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ ...h, ts: Date.now() }))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch { /* quota — ignore */ }
}

export function getHandoff(): Handoff | null {
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Handoff
    if (!parsed?.ts || Date.now() - parsed.ts > HANDOFF_TTL_MS) {
      sessionStorage.removeItem(HANDOFF_KEY)
      return null
    }
    return parsed
  } catch { return null }
}

export function clearHandoff() {
  sessionStorage.removeItem(HANDOFF_KEY)
  sessionStorage.removeItem(PENDING_ATTACH_KEY)
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

export function setPendingAttach(p: PendingAttach) {
  try {
    sessionStorage.setItem(PENDING_ATTACH_KEY, JSON.stringify(p))
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
  } catch { /* quota — ignore */ }
}

export function getPendingAttach(): PendingAttach | null {
  try {
    const raw = sessionStorage.getItem(PENDING_ATTACH_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PendingAttach
  } catch { return null }
}

export function clearPendingAttach() {
  sessionStorage.removeItem(PENDING_ATTACH_KEY)
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT))
}

// Banner subscribes via this — fired on every set/clear in the same tab so
// the banner can flip between awaiting and ready states without polling.
export function onHandoffChanged(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb)
  // Cross-tab safety net: another tab editing sessionStorage doesn't fire
  // 'storage' for sessionStorage, but we listen anyway in case a future
  // localStorage mirror is added.
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}
