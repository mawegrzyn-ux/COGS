import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import Logo from './Logo'
import { usePermissions } from '../hooks/usePermissions'
import type { Feature } from '../hooks/usePermissions'
import PwaInstallModal, { PwaInstallLink } from './PwaInstallModal'
import type { PepperMode } from './AiChat'

// A null entry renders as a divider line between groups
type NavItem = { path: string; label: string; icon: string; feature: Feature | null } | null

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',      label: 'Dashboard',      feature: 'dashboard',  icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/inventory',      label: 'Inventory',      feature: 'inventory',  icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { path: '/recipes',        label: 'Recipes',        feature: 'recipes',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { path: '/sales-items',    label: 'Sales Items',    feature: 'menus',      icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
  { path: '/menus',          label: 'Menus',          feature: 'menus',      icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  null, // ── divider ────────────────────────────────────────────────────────
  { path: '/allergens',      label: 'Allergens',      feature: 'allergens',  icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { path: '/haccp',          label: 'HACCP',          feature: 'haccp',      icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { path: '/media',          label: 'Media Library',  feature: null,         icon: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
  null, // ── divider ────────────────────────────────────────────────────────
  { path: '/configuration',  label: 'Configuration',  feature: 'settings',   icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
  { path: '/system',         label: 'System',         feature: null,         icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01' },
  { path: '/help',           label: 'Help',           feature: null,         icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
]

const STORAGE_KEY = 'mcogs_sidebar_collapsed'

export default function Sidebar({ pepperMode = 'float', pepperOpen = false, onPepperToggle }: {
  pepperMode?: PepperMode
  pepperOpen?: boolean
  onPepperToggle?: () => void
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })
  const [showPwa, setShowPwa] = useState(false)
  const { logout, user } = useAuth0()
  const { can } = usePermissions()

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
        {NAV_ITEMS.map((item, idx) => {
          if (item === null) {
            return <div key={`divider-${idx}`} className="mx-4 my-1.5 border-t border-border opacity-60" />
          }
          // Hide nav items the user has no access to (feature: null = always visible)
          if (item.feature && !can(item.feature, 'read')) return null
          return (
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
        })}
      </nav>

      {/* Pepper AI button — float mode: toggles panel; docked modes: always active */}
      <div className={`px-2 pb-1 ${collapsed ? 'flex justify-center' : ''}`}>
        <button
          onClick={() => pepperMode === 'float' && onPepperToggle?.()}
          title={pepperMode !== 'float' ? 'Pepper (docked)' : pepperOpen ? 'Close Pepper' : 'Open Pepper'}
          className={[
            'flex items-center gap-3 rounded px-2 py-2 transition-colors text-sm font-semibold w-full',
            pepperOpen
              ? 'bg-accent-dim text-accent'
              : 'text-text-2 hover:bg-surface-2 hover:text-text-1',
            pepperMode !== 'float' ? 'opacity-60 cursor-default' : 'cursor-pointer',
          ].join(' ')}
        >
          {/* Pepper cog icon — monochrome, inherits text color */}
          <svg viewBox="-100 -100 200 200" width="18" height="18" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <circle cx="0" cy="0" r="66" fill="currentColor"/>
            <g fill="currentColor">
              {[0,30,60,90,120,150,180,210,240,270,300,330].map(deg => (
                <rect key={deg} x="-9" y="-80" width="18" height="20" rx="3" transform={`rotate(${deg})`}/>
              ))}
            </g>
            <circle cx="0" cy="0" r="44" fill="var(--surface)"/>
            <circle cx="0" cy="0" r="26" fill="currentColor"/>
          </svg>
          {!collapsed && <span>Pepper</span>}
        </button>
      </div>

      {/* Install as app */}
      {!collapsed && (
        <div className="px-3 pb-1">
          <PwaInstallLink
            onClick={() => setShowPwa(true)}
            className="text-text-3 hover:text-accent w-full justify-center py-1"
          />
        </div>
      )}

      {/* User + logout */}
      <div className="border-t border-border p-3">
        {collapsed ? (
          <>
            <button
              onClick={() => setShowPwa(true)}
              className="w-full flex justify-center p-2 rounded hover:bg-surface-2 text-text-3 hover:text-accent transition-colors mb-1"
              title="Install as app"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                <line x1="12" y1="18" x2="12.01" y2="18"/>
              </svg>
            </button>
            <button
              onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/login' } })}
              className="w-full flex justify-center p-2 rounded hover:bg-surface-2 text-text-3 hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
              </svg>
            </button>
          </>
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

      {showPwa && <PwaInstallModal onClose={() => setShowPwa(false)} />}
    </aside>
  )
}
