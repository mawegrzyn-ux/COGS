import { createContext, useContext, useState, useCallback, useMemo, ReactNode, lazy, Suspense } from 'react'

/**
 * AddQuote overlay — renders the existing PriceQuotesTab in a hidden wrapper
 * when triggered, so its Add Quote modal appears over whatever page the user
 * is currently on (e.g. the Dashboard widgets). The actual modal is rendered
 * by PriceQuotesTab via createPortal(document.body), so the user sees it
 * stacked on top of the active page without a navigation.
 *
 * Widgets opt in by calling `useAddQuote().trigger(ingredientId)`.
 */

interface AddQuoteContextValue {
  trigger: (ingredientId: number) => void
}

const AddQuoteContext = createContext<AddQuoteContextValue>({ trigger: () => {} })

// Lazy-load PriceQuotesTab so we don't pay its bundle/data cost until the user
// actually triggers an Add Quote from somewhere outside the inventory page.
const PriceQuotesTab = lazy(() => import('../pages/InventoryPage').then(m => ({ default: m.PriceQuotesTab })))

export function AddQuoteProvider({ children }: { children: ReactNode }) {
  const [autoOpenIngId, setAutoOpenIngId] = useState<number | undefined>(undefined)

  const trigger = useCallback((ingredientId: number) => {
    if (Number.isFinite(ingredientId) && ingredientId > 0) setAutoOpenIngId(ingredientId)
  }, [])

  const value = useMemo(() => ({ trigger }), [trigger])

  return (
    <AddQuoteContext.Provider value={value}>
      {children}
      {/* Hidden PriceQuotesTab — only rendered when triggered. The Modal uses
          createPortal(document.body) so it overlays the active page. */}
      {autoOpenIngId !== undefined && (
        <div className="sr-only" aria-hidden>
          <Suspense fallback={null}>
            <PriceQuotesTab
              initialIngredientId={autoOpenIngId}
              autoOpenAddIngredientId={autoOpenIngId}
              onAutoOpenConsumed={() => setAutoOpenIngId(undefined)}
            />
          </Suspense>
        </div>
      )}
    </AddQuoteContext.Provider>
  )
}

export function useAddQuote() {
  return useContext(AddQuoteContext)
}
