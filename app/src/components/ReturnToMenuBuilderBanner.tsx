// BACK-2652 — Banner shown at the top of /recipes, /inventory, /sales-items
// when the user came from the Menu Builder "+ Add new" shortcut. Stays
// pinned while the user builds the new entity (multi-step flows like
// recipes-with-variants or combos-with-steps are fully supported because
// the banner doesn't constrain the source module's Save/Cancel buttons —
// it just sits there until clicked).
//
// Two visible states:
//   1) Awaiting save  — the user hasn't created the entity yet. Body says
//      "Create your <type> to add it to <menu name>", no primary action.
//   2) Ready to attach — the source module's save handler stashed a
//      pending-attach payload. Banner shows "Add <name> to <menu>".
//
// On click the banner wraps the new entity in a sales-item if needed,
// POSTs /menu-sales-items, clears the handoff + pending-attach, and
// navigates back to /menu-builder?menu=<id>&attached=<msi_id>.

import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '../hooks/useApi'
import {
  getHandoff,
  getPendingAttach,
  clearHandoff,
  onHandoffChanged,
  type Handoff,
  type PendingAttach,
} from '../lib/menuBuilderHandoff'

const TYPE_LABEL = {
  recipe:     'recipe',
  ingredient: 'ingredient',
  manual:     'manual sales item',
  combo:      'combo',
}

export default function ReturnToMenuBuilderBanner() {
  const api      = useApi()
  const navigate = useNavigate()
  const [handoff, setHandoff]               = useState<Handoff | null>(() => getHandoff())
  const [pending, setPending]               = useState<PendingAttach | null>(() => getPendingAttach())
  const [attaching, setAttaching]           = useState(false)
  const [error, setError]                   = useState<string | null>(null)

  // Subscribe to handoff/pending changes so the banner flips state without
  // a manual reload after the source module's save handler stashes the
  // pending-attach.
  useEffect(() => {
    const refresh = () => {
      setHandoff(getHandoff())
      setPending(getPendingAttach())
    }
    return onHandoffChanged(refresh)
  }, [])

  const cancel = useCallback(() => {
    clearHandoff()
    setHandoff(null)
    setPending(null)
  }, [])

  const attach = useCallback(async () => {
    if (!handoff || !pending) return
    setAttaching(true)
    setError(null)
    try {
      // Step 1: get a sales-item id. If pending is already a sales_item,
      // use it. Otherwise wrap the recipe / ingredient / combo in a fresh
      // sales-item with the right item_type + linked id.
      let salesItemId: number
      if (pending.type === 'sales_item') {
        salesItemId = pending.id
      } else {
        const itemType = pending.type
        const payload: Record<string, unknown> = {
          item_type: itemType,
          name:      pending.name,
        }
        if (pending.type === 'recipe')     payload.recipe_id     = pending.id
        if (pending.type === 'ingredient') payload.ingredient_id = pending.id
        if (pending.type === 'combo')      payload.combo_id      = pending.id
        if ('category_id' in pending && pending.category_id != null) {
          payload.category_id = pending.category_id
        }
        const created = await api.post('/sales-items', payload) as { id: number }
        salesItemId = created.id
      }

      // Step 2: attach to the originating menu.
      const msi = await api.post('/menu-sales-items', {
        menu_id:       handoff.menu_id,
        sales_item_id: salesItemId,
      }) as { id: number }

      // Step 3: clear state + bounce back. The Menu Builder reads ?attached
      // on mount and shows a confirmation toast.
      clearHandoff()
      navigate(`/menu-builder?menu=${handoff.menu_id}&attached=${msi.id}`, { replace: true })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Attach failed'
      setError(msg)
    } finally {
      setAttaching(false)
    }
  }, [handoff, pending, api, navigate])

  if (!handoff) return null

  const typeWord = TYPE_LABEL[handoff.item_type]
  const ready    = pending != null

  return (
    <div className="bg-accent-dim border-b border-accent/40 px-6 py-2.5 flex items-center gap-3 text-sm">
      <span className="text-accent text-base shrink-0" aria-hidden>↩</span>

      <div className="flex-1 min-w-0">
        {ready ? (
          <span>
            <span className="text-text-2">Ready to add</span>{' '}
            <span className="font-semibold text-text-1 truncate">{pending!.name}</span>{' '}
            <span className="text-text-2">to menu</span>{' '}
            <span className="font-semibold text-text-1 truncate">{handoff.menu_name}</span>
          </span>
        ) : (
          <span className="text-text-2">
            From <span className="font-semibold text-text-1">{handoff.menu_name}</span> · Save your new {typeWord} below to add it to the menu.
          </span>
        )}
        {error && <div className="text-xs text-rose-600 mt-0.5">{error}</div>}
      </div>

      <button
        type="button"
        className="btn-primary text-xs px-3 py-1.5 shrink-0 disabled:opacity-50"
        disabled={!ready || attaching}
        onClick={attach}
        title={ready ? `Add ${pending!.name} to ${handoff.menu_name}` : `Save the ${typeWord} first`}
      >
        {attaching ? 'Adding…' : ready ? '+ Add to menu' : 'Awaiting save'}
      </button>

      <button
        type="button"
        className="btn-ghost text-xs px-3 py-1.5 shrink-0"
        onClick={cancel}
        disabled={attaching}
        title="Cancel — won't add anything to the menu"
      >Cancel</button>
    </div>
  )
}
