import { createContext, useContext } from 'react'

export type AccessLevel = 'none' | 'read' | 'write'
export type Feature =
  | 'dashboard' | 'inventory' | 'recipes' | 'menus'
  | 'allergens' | 'haccp' | 'markets' | 'categories'
  | 'settings' | 'import' | 'ai_chat' | 'users'
  | 'stock_overview' | 'stock_purchase_orders' | 'stock_goods_in'
  | 'stock_invoices' | 'stock_waste' | 'stock_transfers' | 'stock_stocktake'
  | 'bugs' | 'backlog' | 'docs'
  | 'audits' | 'audits_admin'

export interface MarketAccess {
  roleId:      number | null
  roleName:    string | null
  permissions: Partial<Record<Feature, AccessLevel>>
}

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
  /** BACK-2563 — true if this user can pick the premium AI model in Pepper */
  ai_premium_access?: boolean
  /** BACK-2564 — configured tier→model-id mapping; set by admin in Settings → AI */
  ai_models?:      { default: string; premium: string }
  /** Union permissions across all allowed markets — used for nav-level checks */
  permissions:     Partial<Record<Feature, AccessLevel>>
  /** null = unrestricted; otherwise list of allowed country IDs */
  allowedCountries: number[] | null
  /** Per-market role + permissions snapshot. Only populated when user is restricted. */
  scopedAccess?:   Record<number, MarketAccess>
}

export interface PermissionsContextValue {
  user:    MeUser | null
  loading: boolean
  /**
   * Returns true if the current user has at least the given access level for a feature.
   * - With `marketId`: checks the user's permission in that specific market.
   * - Without `marketId`: checks the union (any market). Use this for nav / sidebar.
   */
  can: (feature: Feature, level: 'read' | 'write', marketId?: number | null) => boolean
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
