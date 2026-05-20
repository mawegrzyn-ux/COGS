import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

const STORAGE_KEY = 'kanban_sidebar_collapsed'

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(collapsed)) } catch { /* noop */ }
  }, [collapsed])

  return (
    <div className="flex h-screen overflow-hidden bg-surface-2">
      {/* Sidebar */}
      <aside
        className="h-full flex flex-col bg-surface border-r border-border transition-all duration-200 shrink-0"
        style={{ width: collapsed ? '64px' : '220px' }}
      >
        {/* Logo + collapse toggle */}
        <div className="flex items-center justify-between px-4 py-4 border-b border-border min-h-[60px]">
          {!collapsed && (
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center flex-shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7"/>
                  <rect x="14" y="3" width="7" height="9"/>
                  <rect x="3" y="14" width="7" height="7"/>
                  <rect x="14" y="16" width="7" height="5"/>
                </svg>
              </div>
              <span className="font-bold text-text-1 text-base">Kanban</span>
            </div>
          )}
          {collapsed && (
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center mx-auto flex-shrink-0">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="7"/>
                <rect x="14" y="3" width="7" height="9"/>
                <rect x="3" y="14" width="7" height="7"/>
                <rect x="14" y="16" width="7" height="5"/>
              </svg>
            </div>
          )}
          <button
            onClick={() => setCollapsed(c => !c)}
            className={`p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors ${collapsed ? 'mx-auto mt-2' : 'ml-auto'}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {collapsed
                ? <path d="M9 18l6-6-6-6"/>
                : <path d="M15 18l-6-6 6-6"/>
              }
            </svg>
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-3 overflow-y-auto">
          <NavLink
            to="/"
            end
            title={collapsed ? 'Boards' : undefined}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 mx-2 rounded transition-all duration-150 text-sm font-semibold
               ${isActive
                 ? 'bg-accent-dim text-accent'
                 : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
               }`
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <rect x="3" y="3" width="7" height="7"/>
              <rect x="14" y="3" width="7" height="9"/>
              <rect x="3" y="14" width="7" height="7"/>
              <rect x="14" y="16" width="7" height="5"/>
            </svg>
            {!collapsed && <span>Boards</span>}
          </NavLink>
        </nav>

        {/* Footer */}
        <div className="border-t border-border p-3">
          {!collapsed && (
            <div className="text-xs text-text-3 text-center">
              Kanban Prioritiser
            </div>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
