import { useState, useEffect } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useTranslation } from 'react-i18next'
import Logo from './Logo'
import { usePermissions } from '../hooks/usePermissions'
import type { Feature } from '../hooks/usePermissions'
import PwaInstallModal, { PwaInstallLink } from './PwaInstallModal'
import LanguageSwitcher from './LanguageSwitcher'
import { useFeatureFlags, FeatureFlags } from '../contexts/FeatureFlagsContext'

// A null entry renders as a divider line between groups
// `feature` = single feature check; `features` = show if ANY has read access
// `labelKey` = i18n key under the `nav` namespace; `label` kept as English fallback
// `flag` = module-level feature flag; nav hides when the flag is disabled
type NavItem = { path: string; label: string; labelKey?: string; icon: string; feature: Feature | null; features?: Feature[]; flag?: keyof FeatureFlags } | null

const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',      label: 'Dashboard',      labelKey: 'dashboard',      feature: 'dashboard',  icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  { path: '/inventory',      label: 'Inventory',      labelKey: 'inventory',      feature: 'inventory',  icon: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
  { path: '/recipes',        label: 'Recipes',        labelKey: 'recipes',        feature: 'recipes',    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { path: '/sales-items',    label: 'Sales Items',    labelKey: 'sales_items',    feature: 'menus',      icon: 'M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z' },
  { path: '/menus',          label: 'Menus',          labelKey: 'menus',          feature: 'menus',      icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
  null, // ── divider ────────────────────────────────────────────────────────
  { path: '/allergens',      label: 'Allergens',      labelKey: 'allergens',      feature: 'allergens',  flag: 'allergens',     icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
  { path: '/haccp',          label: 'HACCP',          labelKey: 'haccp',          feature: 'haccp',      flag: 'haccp',         icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
  { path: '/stock-manager',  label: 'Stock Manager',  labelKey: 'stock_manager',  feature: null, flag: 'stock_manager', features: ['stock_overview','stock_purchase_orders','stock_goods_in','stock_invoices','stock_waste','stock_transfers','stock_stocktake'], icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  null, // ── divider ────────────────────────────────────────────────────────
  { path: '/configuration',  label: 'Configuration',  labelKey: 'configuration',  feature: 'settings',   icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4' },
  { path: '/system',         label: 'System',         labelKey: 'system',         feature: null,         icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01' },
  { path: '/help',           label: 'Help',           labelKey: 'help',           feature: null,         icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
]

const STORAGE_KEY = 'mcogs_sidebar_collapsed'

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === 'true' } catch { return false }
  })
  const [showPwa, setShowPwa] = useState(false)
  const { logout, user } = useAuth0()
  const { can } = usePermissions()
  const { flags } = useFeatureFlags()
  const { t } = useTranslation('nav')

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
          // features[] = show if ANY feature in the array has read access
          if (item.features?.length) {
            if (!item.features.some(f => can(f, 'read'))) return null
          } else if (item.feature && !can(item.feature, 'read')) return null
          // Hide whole modules when their Global Config feature flag is off
          if (item.flag && !flags[item.flag]) return null
          // Prefer translated label if labelKey is set; fall back to English.
          const displayLabel = item.labelKey ? t(item.labelKey, { defaultValue: item.label }) : item.label
          return (
            <NavLink
              key={item.path}
              to={item.path}
              title={collapsed ? displayLabel : undefined}
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
              {!collapsed && <span>{displayLabel}</span>}
            </NavLink>
          )
        })}
      </nav>

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
          <>
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
                title={t('sign_out', { ns: 'common', defaultValue: 'Sign out' })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                </svg>
              </button>
            </div>
            <div className="mt-2">
              <LanguageSwitcher />
            </div>
          </>
        )}
      </div>

      {showPwa && <PwaInstallModal onClose={() => setShowPwa(false)} />}
    </aside>
  )
}
