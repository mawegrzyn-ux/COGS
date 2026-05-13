// =============================================================================
// MenuEntryPage — BACK-2793
//
// Combines the Sales Items catalog (3 sub-tabs: Items / Combos / Modifiers)
// and the Menu Builder into one page with four top-level tabs:
//
//   1. Items       — POS catalog: recipes / ingredients / manual / combo wrappers
//   2. Combos      — combo definitions (steps + step options)
//   3. Modifiers   — modifier groups + their options
//   4. Menu Builder — drop sales items onto a menu, set per-level prices,
//                     attach modifier groups, etc.
//
// Why one page: the four tabs are the catalog-side workflow for any menu
// project — operators bounce between them often, and previously had to use
// the sidebar (or browser back) every time. Consolidating cuts one click on
// every switch, lets us preserve cross-tab state (e.g. "I just edited this
// modifier group, now I want to drop it onto a sales item, then onto a
// menu"), and frees a sidebar slot.
//
// Tabs 1-3 reuse SalesItemsPage in embedded mode (controlled `embeddedTab`
// prop + hidden internal header). Tab 4 mounts MenuBuilderPage as-is.
//
// We KEEP all four tabs mounted at once (display:none for the inactive
// ones) so per-tab state — selected item, scroll position, dirty edits —
// survives a tab switch. Initial mount is lazy: a tab is mounted only the
// first time it becomes active.
// =============================================================================

import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import SalesItemsPage from './SalesItemsPage'
import MenuBuilderPage from './MenuBuilderPage'

type EntryTab = 'items' | 'combos' | 'modifiers' | 'menu-builder'

const TAB_LABELS: Record<EntryTab, string> = {
  items:         'Items',
  combos:        'Combos',
  modifiers:     'Modifiers',
  'menu-builder':'Menu Builder',
}

const STORAGE_KEY = 'menu-entry-active-tab'

function readInitialTab(): EntryTab {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && (['items', 'combos', 'modifiers', 'menu-builder'] as const).includes(stored as EntryTab)) {
      return stored as EntryTab
    }
  } catch { /* localStorage unavailable */ }
  return 'items'
}

export default function MenuEntryPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // URL ?tab=… wins over localStorage so a deep-link or legacy redirect
  // (e.g. /sales-items → /menu-entry?tab=items) lands on the right tab.
  const [activeTab, setActiveTab] = useState<EntryTab>(() => {
    const fromUrl = searchParams.get('tab')
    if (fromUrl === 'items' || fromUrl === 'combos' || fromUrl === 'modifiers' || fromUrl === 'menu-builder') {
      return fromUrl
    }
    return readInitialTab()
  })

  // Track which tabs have been mounted at least once so inactive tabs are
  // not eagerly rendered. Once a tab has been visited it stays mounted
  // (display:none) so its internal state survives subsequent switches.
  const [mounted, setMounted] = useState<Set<EntryTab>>(() => new Set([activeTab]))
  useEffect(() => {
    setMounted(prev => prev.has(activeTab) ? prev : new Set(prev).add(activeTab))
  }, [activeTab])

  // Persist the active tab + sync with the URL so reloads land back where
  // the operator was. The localStorage write is best-effort.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, activeTab) } catch { /* ignore */ }
    const next = new URLSearchParams(searchParams)
    if (next.get('tab') !== activeTab) {
      next.set('tab', activeTab)
      setSearchParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  const tabs: EntryTab[] = useMemo(
    () => ['items', 'combos', 'modifiers', 'menu-builder'],
    []
  )

  return (
    <div className="flex flex-col h-full">
      {/* BACK-2837 — single "Menu Builder" title bar at the top, with the tab
          selector tucked underneath. MenuBuilderPage now skips its own
          internal PageHeader when embedded (hideHeader prop) so the title
          isn't duplicated when the Menu Builder tab is active. */}
      <div className="px-6 pt-5 pb-0 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">Menu Builder</h1>
        <div className="flex gap-1 mt-3 -mb-px">
          {tabs.map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >{TAB_LABELS[t]}</button>
          ))}
        </div>
      </div>

      {/* Body — every tab that has been visited stays in the DOM so its
          state persists; display:none hides the inactive ones. */}
      <div className="flex-1 min-h-0 relative">
        {mounted.has('items') && (
          <div className={`absolute inset-0 ${activeTab === 'items' ? 'flex flex-col' : 'hidden'}`}>
            <SalesItemsPage embeddedTab="items" hideHeader />
          </div>
        )}
        {mounted.has('combos') && (
          <div className={`absolute inset-0 ${activeTab === 'combos' ? 'flex flex-col' : 'hidden'}`}>
            <SalesItemsPage embeddedTab="combos" hideHeader />
          </div>
        )}
        {mounted.has('modifiers') && (
          <div className={`absolute inset-0 ${activeTab === 'modifiers' ? 'flex flex-col' : 'hidden'}`}>
            <SalesItemsPage embeddedTab="modifiers" hideHeader />
          </div>
        )}
        {mounted.has('menu-builder') && (
          <div className={`absolute inset-0 ${activeTab === 'menu-builder' ? 'flex flex-col' : 'hidden'}`}>
            <MenuBuilderPage hideHeader />
          </div>
        )}
      </div>
    </div>
  )
}
