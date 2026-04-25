import { Template, WidgetMeta, WidgetId } from './types'

export const WIDGET_REGISTRY: Record<WidgetId, WidgetMeta> = {
  'kpi-ingredients':   { id: 'kpi-ingredients',   label: 'Ingredients',     description: 'Count of ingredients in the catalog', defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: false },
  'kpi-recipes':       { id: 'kpi-recipes',       label: 'Recipes',         description: 'Count of recipes',                    defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: false },
  'kpi-menus':         { id: 'kpi-menus',         label: 'Menus',           description: 'Count of menus',                      defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: true  },
  'kpi-markets':       { id: 'kpi-markets',       label: 'Markets',         description: 'Count of franchise markets',          defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: false },
  'kpi-vendors':       { id: 'kpi-vendors',       label: 'Vendors',         description: 'Count of suppliers',                  defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: true  },
  'kpi-active-quotes': { id: 'kpi-active-quotes', label: 'Active Quotes',   description: 'Current active price quotes',         defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: true  },
  'kpi-categories':    { id: 'kpi-categories',    label: 'Categories',      description: 'Count of categories',                 defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: false },
  'kpi-coverage':      { id: 'kpi-coverage',      label: 'Coverage %',      description: 'Percentage of ingredients with active quotes', defaultSize: 'sm', allowedSizes: ['sm'], marketScoped: false },

  'coverage-bar':      { id: 'coverage-bar',      label: 'Quote Coverage Bar', description: 'Progress bar showing quote coverage', defaultSize: 'xl', allowedSizes: ['md', 'lg', 'xl'], marketScoped: false, defaultRowSpan: 1, allowedRowSpans: [1, 2] },
  'menu-tiles':        { id: 'menu-tiles',        label: 'Menu COGS Tiles',    description: 'Menus with COGS % per price level',   defaultSize: 'xl', allowedSizes: ['lg', 'xl'],        marketScoped: true, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3]  },
  'missing-quotes':    { id: 'missing-quotes',    label: 'Missing Price Quotes', description: 'Ingredients with no active quote',  defaultSize: 'md', allowedSizes: ['md', 'lg', 'xl'], marketScoped: false, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3] },
  'recent-quotes':     { id: 'recent-quotes',     label: 'Recent Price Quotes',  description: 'Latest price quote updates',        defaultSize: 'md', allowedSizes: ['md', 'lg', 'xl'], marketScoped: true, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3]  },
  'quick-links':       { id: 'quick-links',       label: 'Quick Links',       description: 'Shortcut tiles to main sections',     defaultSize: 'xl', allowedSizes: ['md', 'lg', 'xl'], marketScoped: false, defaultRowSpan: 1, allowedRowSpans: [1, 2] },

  'market-selector':   { id: 'market-selector',   label: 'Market Selector',   description: 'Compact chip row that scopes the whole dashboard to a single market in one click.', defaultSize: 'xl', allowedSizes: ['xl'], marketScoped: false, defaultRowSpan: 1, allowedRowSpans: [1] },
  'market-picker':     { id: 'market-picker',     label: 'Market Picker',     description: 'Grid of markets with quick stats',   defaultSize: 'xl', allowedSizes: ['lg', 'xl'], marketScoped: false, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3] },
  'market-stats':      { id: 'market-stats',      label: 'Market Snapshot',   description: 'Headline stats for selected market', defaultSize: 'md', allowedSizes: ['md', 'lg', 'xl'], marketScoped: true, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3] },
  'market-header':     { id: 'market-header',     label: 'Market Header',     description: 'Large banner for the active market', defaultSize: 'xl', allowedSizes: ['xl'], marketScoped: true, defaultRowSpan: 1, allowedRowSpans: [1] },
  'market-map':        { id: 'market-map',        label: 'World Map',         description: '2D world map — click a country to set the active market', defaultSize: 'xl', allowedSizes: ['lg', 'xl'], marketScoped: false, defaultRowSpan: 3, allowedRowSpans: [2, 3] },
  'mapbox-map':        { id: 'mapbox-map',        label: 'Mapbox World Map',  description: 'Vector-tile world map powered by Mapbox GL JS. Requires a Mapbox public token set in System → AI → Mapbox Integration.', defaultSize: 'xl', allowedSizes: ['lg', 'xl'], marketScoped: false, defaultRowSpan: 3, allowedRowSpans: [2, 3] },
  'mapbox-country-map': { id: 'mapbox-country-map', label: 'Mapbox Country Regions', description: 'Zoomed-in Mapbox view of the selected market\u2019s country, with admin-1 regions coloured by market coverage and city pins for locations with captured lat/lng.', defaultSize: 'xl', allowedSizes: ['lg', 'xl'], marketScoped: true, defaultRowSpan: 3, allowedRowSpans: [2, 3] },
  'menu-top-items':    { id: 'menu-top-items',    label: 'Top 10 Items / Menu', description: 'Bar chart of top 10 items per menu in the active market (by cost, revenue or COGS%)', defaultSize: 'xl', allowedSizes: ['lg', 'xl'], marketScoped: true, defaultRowSpan: 3, allowedRowSpans: [2, 3] },

  'new-ingredient':    { id: 'new-ingredient',    label: 'New Ingredient',    description: 'Quick-add card — create a new ingredient (optionally with a first price quote) without leaving the dashboard.', defaultSize: 'md', allowedSizes: ['sm', 'md', 'lg'], marketScoped: false, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3] },
  'new-price-quote':   { id: 'new-price-quote',   label: 'New Price Quote',   description: 'Quick-add card — log a price quote for an existing ingredient + vendor in one click.',                                   defaultSize: 'md', allowedSizes: ['sm', 'md', 'lg'], marketScoped: false, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3] },
  'country-region-map': { id: 'country-region-map', label: 'Country Region Map', description: 'Zoomed-in map of the selected market\'s country, highlighting every region claimed by any market. City pins appear for locations with captured lat/lng.', defaultSize: 'xl', allowedSizes: ['lg', 'xl'], marketScoped: true, defaultRowSpan: 3, allowedRowSpans: [2, 3] },

  'recipe-unquoted-ingredients': { id: 'recipe-unquoted-ingredients', label: 'Unquoted Ingredients in Recipes', description: 'Ingredients that appear in at least one recipe but have no active price quote. Optional menu filter narrows the list to recipes used by a specific menu.', defaultSize: 'md', allowedSizes: ['md', 'lg', 'xl'], marketScoped: false, defaultRowSpan: 2, allowedRowSpans: [1, 2, 3] },
}

// ── Templates ──────────────────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [
  {
    id: 'executive',
    name: 'Executive',
    description: 'High-level KPIs, menu COGS across all markets, and recent activity.',
    slots: [
      { widgetId: 'market-selector',   size: 'xl' },
      { widgetId: 'kpi-ingredients',   size: 'sm' },
      { widgetId: 'kpi-recipes',       size: 'sm' },
      { widgetId: 'kpi-menus',         size: 'sm' },
      { widgetId: 'kpi-coverage',      size: 'sm' },
      { widgetId: 'menu-tiles',        size: 'xl' },
      { widgetId: 'menu-top-items',    size: 'xl' },
      { widgetId: 'coverage-bar',      size: 'xl' },
      { widgetId: 'recent-quotes',     size: 'md' },
      { widgetId: 'missing-quotes',    size: 'md' },
    ],
  },
  {
    id: 'finance',
    name: 'Finance / Cost',
    description: 'Quote coverage, missing quotes, and menu cost margins.',
    slots: [
      { widgetId: 'market-selector',   size: 'xl' },
      { widgetId: 'kpi-coverage',      size: 'sm' },
      { widgetId: 'kpi-active-quotes', size: 'sm' },
      { widgetId: 'kpi-vendors',       size: 'sm' },
      { widgetId: 'kpi-ingredients',   size: 'sm' },
      { widgetId: 'coverage-bar',      size: 'xl' },
      { widgetId: 'missing-quotes',    size: 'md' },
      { widgetId: 'recent-quotes',     size: 'md' },
      { widgetId: 'menu-tiles',        size: 'xl' },
    ],
  },
  {
    id: 'market-explorer',
    name: 'Market Explorer',
    description: 'Drill into a specific market. Pick on the map or card grid; stats update as you select.',
    slots: [
      { widgetId: 'market-selector',   size: 'xl' },
      { widgetId: 'market-header',     size: 'xl' },
      { widgetId: 'market-map',        size: 'xl' },
      { widgetId: 'market-stats',      size: 'md' },
      { widgetId: 'market-picker',     size: 'md' },
      { widgetId: 'menu-tiles',        size: 'xl' },
      { widgetId: 'recent-quotes',     size: 'md' },
      { widgetId: 'quick-links',       size: 'md' },
    ],
  },
]

export const DEFAULT_TEMPLATE_ID = 'executive'

export function getTemplate(id: string): Template {
  return TEMPLATES.find(t => t.id === id) ?? TEMPLATES[0]
}
