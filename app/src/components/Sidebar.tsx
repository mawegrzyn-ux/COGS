import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import Logo from './Logo'

// A null entry renders as a divider line between groups
type NavItem = { path: string; label: string; icon: string } | null

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',  label: 'Dashboard',  icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/inventory',  label: 'Inventory',  icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { path: '/recipes',    label: 'Recipes',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { path: '/menus',      label: 'Menus',      icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  null, // ── divider ────────────────────────────────────────────────────────
  { path: '/allergens',  label: 'Allergens',  icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { path: '/haccp',      label: 'HACCP',      icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  null, // ── divider ────────────────────────────────────────────────────────
  { path: '/markets',    label: 'Markets',    icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064' },
  { path: '/categories', label: 'Categories', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
  { path: '/settings',   label: 'Settings',   icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  { path: '/help',       label: 'Help',       icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
]

const STORAGE_KEY = 'mcogs_sidebar_collapsed'

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })
  const { logout, user } = useAuth0()

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(collapsed)) } catch {}
  }, [collapsed])

  return (
    <aside
      className="h-full flex flex-col bg-surface border-r border-border transition-all duration-200 shrink-0"
      style={{ width: collapsed ? '64px' : '220px' }}
    >
      {/* Logo + collapse toggle */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-border min-h-[60px]">
        {!collapsed && <Logo size="sm" />}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="ml-auto p-1.5 rounded hover:bg-surface-2 text-text-3 hover:text-text-1 transition-colors"
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
        {NAV_ITEMS.map((item, idx) =>
          item === null ? (
            <div key={`divider-${idx}`} className="mx-4 my-1.5 border-t border-border opacity-60" />
          ) : (
            <NavLink
              key={item.path}
              to={item.path}
              title={collapsed ? item.label : undefined}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-2.5 mx-2 rounded transition-all duration-150 text-sm font-semibold
                 ${isActive
                   ? 'bg-accent-dim text-accent'
                   : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                 }`
              }
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <path d={item.icon}/>
              </svg>
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          )
        )}
      </nav>

      {/* User + logout */}
      <div className="border-t border-border p-3">
        {collapsed ? (
          <button
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/login' } })}
            className="w-full flex justify-center p-2 rounded hover:bg-surface-2 text-text-3 hover:text-red-500 transition-colors"
            title="Sign out"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-accent-dim flex items-center justify-center text-accent text-xs font-bold shrink-0">
              {user?.email?.[0]?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-3 truncate">{user?.email}</div>
            </div>
            <button
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/login' } })}
              className="p-1 rounded hover:bg-surface-2 text-text-3 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
