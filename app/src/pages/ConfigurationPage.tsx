import { useState } from 'react'
import MarketsPage    from './MarketsPage'
import CategoriesPage from './CategoriesPage'
import ImportPage     from './ImportPage'
import SettingsPage   from './SettingsPage'
import { usePermissions } from '../hooks/usePermissions'

// ── Section definitions ────────────────────────────────────────────────────────

type Section =
  | 'location-structure'
  | 'categories'
  | 'units'
  | 'price-levels'
  | 'currency'
  | 'cogs-thresholds'
  | 'users-roles'
  | 'import'

interface SectionDef {
  id:      Section
  icon:    string
  label:   string
  feature: string | null   // RBAC feature key, null = always visible
}

const SECTIONS: SectionDef[] = [
  { id: 'location-structure', icon: '🌍', label: 'Location Structure', feature: 'markets'    },
  { id: 'categories',         icon: '🏷️', label: 'Categories',         feature: 'categories' },
  { id: 'units',              icon: '📐', label: 'Base Units',          feature: 'settings'   },
  { id: 'price-levels',       icon: '💰', label: 'Price Levels',        feature: 'settings'   },
  { id: 'currency',           icon: '💱', label: 'Currency',            feature: 'settings'   },
  { id: 'cogs-thresholds',    icon: '🎯', label: 'COGS Thresholds',     feature: 'settings'   },
  { id: 'users-roles',        icon: '👥', label: 'Users & Roles',       feature: 'users'      },
  { id: 'import',             icon: '📥', label: 'Import',              feature: 'import'     },
]

// ── Users & Roles combined section ────────────────────────────────────────────

function UsersRolesSection() {
  const [subTab, setSubTab] = useState<'users' | 'roles'>('users')
  return (
    <div className="flex flex-col h-full">
      {/* Mini tab bar */}
      <div className="flex gap-1 px-6 pt-4 bg-surface border-b border-border">
        {(['users', 'roles'] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t transition-colors whitespace-nowrap capitalize
              ${subTab === t
                ? 'text-accent border-b-2 border-accent bg-accent-dim/50'
                : 'text-text-3 hover:text-text-1'
              }`}
          >
            {t === 'users' ? 'Users' : 'Roles'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <SettingsPage embedded initialTab={subTab} />
      </div>
    </div>
  )
}

// ── ConfigurationPage ──────────────────────────────────────────────────────────

export default function ConfigurationPage() {
  const [active, setActive] = useState<Section>('location-structure')
  const { can } = usePermissions()

  const visibleSections = SECTIONS.filter(s =>
    !s.feature || can(s.feature as any, 'read')
  )

  // Default to first visible section
  const effectiveActive = visibleSections.find(s => s.id === active)
    ? active
    : (visibleSections[0]?.id ?? 'location-structure')

  function renderContent() {
    switch (effectiveActive) {
      case 'location-structure': return <MarketsPage />
      case 'categories':         return <CategoriesPage />
      case 'units':              return <SettingsPage embedded initialTab="units" />
      case 'price-levels':       return <SettingsPage embedded initialTab="price-levels" />
      case 'currency':           return <SettingsPage embedded initialTab="currency" />
      case 'cogs-thresholds':    return <SettingsPage embedded initialTab="thresholds" />
      case 'users-roles':        return <UsersRolesSection />
      case 'import':             return <ImportPage />
      default:                   return null
    }
  }

  return (
    <div className="flex h-full">

      {/* ── Left secondary nav ──────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border bg-surface flex flex-col overflow-y-auto">
        <div className="px-4 pt-5 pb-3 border-b border-border">
          <h1 className="text-sm font-bold text-text-1">Configuration</h1>
          <p className="text-xs text-text-3 mt-0.5">System-wide settings</p>
        </div>

        <nav className="py-3 flex-1">
          {visibleSections.map(section => (
            <button
              key={section.id}
              onClick={() => setActive(section.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left
                ${effectiveActive === section.id
                  ? 'bg-accent-dim text-accent font-semibold'
                  : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                }`}
            >
              <span className="text-base leading-none shrink-0">{section.icon}</span>
              <span>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main content panel ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {renderContent()}
      </div>

    </div>
  )
}
