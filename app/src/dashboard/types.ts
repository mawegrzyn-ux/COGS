// Widget IDs — the canonical registry of dashboard widgets
export type WidgetId =
  | 'kpi-ingredients'
  | 'kpi-recipes'
  | 'kpi-menus'
  | 'kpi-markets'
  | 'kpi-vendors'
  | 'kpi-active-quotes'
  | 'kpi-categories'
  | 'kpi-coverage'
  | 'coverage-bar'
  | 'menu-tiles'
  | 'missing-quotes'
  | 'recent-quotes'
  | 'quick-links'
  | 'market-selector'   // Compact full-width market chooser — scopes the whole dashboard
  | 'market-picker'
  | 'market-stats'
  | 'market-header'
  | 'market-map'
  | 'mapbox-map'        // Mapbox GL JS world map (vector tiles, requires token)
  | 'menu-top-items'
  | 'new-ingredient'    // Quick-add ingredient (optionally with price quote) from the dashboard
  | 'new-price-quote'   // Quick-add a price quote for an existing ingredient
  | 'country-region-map' // Zoomed-in map of one country's regions (follows the selected market)

// Widget size — maps to CSS grid col-span (out of 12)
export type WidgetSize = 'sm' | 'md' | 'lg' | 'xl'

export const sizeSpan: Record<WidgetSize, string> = {
  sm: 'col-span-12 sm:col-span-6 md:col-span-3',   // 1/4 width on desktop
  md: 'col-span-12 md:col-span-6',                 // 1/2
  lg: 'col-span-12 md:col-span-9',                 // 3/4
  xl: 'col-span-12',                               // full
}

export interface SlotConfig {
  widgetId: WidgetId
  size: WidgetSize
  /** Optional user-provided label shown in a title bar above the widget.
   *  When absent, the widget renders without any external title and uses
   *  whatever internal heading it ships with. */
  customLabel?: string
}

export interface DashboardConfig {
  templateId: string        // which template was last picked
  slots: SlotConfig[]       // ordered list of widgets
}

export interface Template {
  id: string
  name: string
  description: string
  slots: SlotConfig[]
}

export interface WidgetMeta {
  id: WidgetId
  label: string
  description: string
  defaultSize: WidgetSize
  allowedSizes: WidgetSize[]
  /** If true, this widget respects the global market selection */
  marketScoped: boolean
}
