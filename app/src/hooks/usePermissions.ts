import { createContext, useContext } from 'react'

export type AccessLevel = 'none' | 'read' | 'write'
export type Feature =
  | 'dashboard' | 'inventory' | 'recipes' | 'menus'
  | 'allergens' | 'haccp' | 'markets' | 'categories'
  | 'settings' | 'import' | 'ai_chat' | 'users'
  | 'stock_manager'

export interface MeUser {
  id:              number
  sub:             string
  email:           string | null
  name:            string | null
  picture:         string | null
  status:          'pending' | 'active' | 'disabled'
  role_id:         number | null
  role_name:       string | null
  is_dev:          boolean
  permissions:     Partial<Record<Feature, AccessLevel>>
  allowedCountries: number[] | null   // null = unrestricted
}

export interface PermissionsContextValue {
  user:    MeUser | null
  loading: boolean
  /** Returns true if the current user has at least the given access level for a feature */
  can: (feature: Feature, level: 'read' | 'write') => boolean
  /** True if the current user has the developer flag enabled */
  isDev: boolean
  /** Allowed country IDs (null = all) */
  allowedCountries: number[] | null
  reload: () => Promise<void>
}

export const PermissionsContext = createContext<PermissionsContextValue>({
  user:    null,
  loading: true,
  can:     () => false,
  isDev:   false,
  allowedCountries: null,
  reload:  async () => {},
})

export function usePermissions() {
  return useContext(PermissionsContext)
}
