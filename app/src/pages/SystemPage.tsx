import { useState, useEffect, useCallback, useMemo } from 'react'
import SettingsPage from './SettingsPage'
import { usePermissions } from '../hooks/usePermissions'
import { useApi } from '../hooks/useApi'

// ── Shared doc helpers ─────────────────────────────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const c: Record<string, string> = {
    GET:    'bg-blue-100 text-blue-700',
    POST:   'bg-green-100 text-green-700',
    PUT:    'bg-amber-100 text-amber-700',
    PATCH:  'bg-orange-100 text-orange-700',
    DELETE: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${c[method] ?? 'bg-gray-100 text-gray-700'}`}>
      {method}
    </span>
  )
}

type InfoType = 'info' | 'tip' | 'warning' | 'critical'
function InfoBox({ type = 'info', title, children }: { type?: InfoType; title?: string; children: React.ReactNode }) {
  const cfg: Record<InfoType, { border: string; bg: string; icon: string; def: string; tc: string }> = {
    info:     { border: 'border-blue-200',     bg: 'bg-blue-50',    icon: 'ℹ️', def: 'Note',     tc: 'text-blue-800' },
    tip:      { border: 'border-[#146A34]/30', bg: 'bg-[#E8F5ED]',  icon: '💡', def: 'Tip',      tc: 'text-[#146A34]' },
    warning:  { border: 'border-amber-200',    bg: 'bg-amber-50',   icon: '⚠️', def: 'Warning',  tc: 'text-amber-800' },
    critical: { border: 'border-red-200',      bg: 'bg-red-50',     icon: '🚨', def: 'Critical', tc: 'text-red-800' },
  }
  const { border, bg, icon, def, tc } = cfg[type]
  return (
    <div className={`border ${border} ${bg} rounded-lg px-4 py-3 my-3`}>
      <p className={`text-xs font-bold mb-1 ${tc}`}>{icon} {title ?? def}</p>
      <div className={`text-xs leading-relaxed ${tc}`}>{children}</div>
    </div>
  )
}

function ProcessFlow({ steps }: { steps: { label: string; sub?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 my-4 p-3 bg-white border border-[#D8E6DD] rounded-lg">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="bg-[#E8F5ED] border border-[#146A34]/20 rounded px-2.5 py-1.5 text-center">
            <div className="text-xs font-bold text-[#146A34]">{s.label}</div>
            {s.sub && <div className="text-[10px] text-[#6B7F74] leading-tight mt-0.5">{s.sub}</div>}
          </div>
          {i < steps.length - 1 && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7F74" strokeWidth="2.5" strokeLinecap="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

function H2({ icon, title }: { icon: string; title: string }) {
  return (
    <h2 className="text-lg font-bold text-[#0F1F17] mt-8 mb-3 pb-2 border-b-2 border-[#146A34]/20 flex items-center gap-2">
      <span className="text-xl">{icon}</span> {title}
    </h2>
  )
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="font-bold text-[#0F1F17] mt-5 mb-2 text-sm">{children}</h3>
}

function Mono({ children }: { children: string }) {
  return (
    <code className="bg-[#F7F9F8] border border-[#D8E6DD] rounded px-1.5 py-0.5 text-[11px] font-mono text-[#2D4A38]">
      {children}
    </code>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`py-2 px-3 border-b border-[#D8E6DD]/50 align-top ${mono ? 'font-mono text-[11px] text-[#2D4A38]' : 'text-sm text-[#2D4A38]'}`}>
      {children}
    </td>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2 px-3 text-xs font-bold text-[#6B7F74] text-left bg-[#F7F9F8] border-b border-[#D8E6DD]">{children}</th>
}

// ── Section content components ─────────────────────────────────────────────────

function ArchitectureSection() {
  return (
    <div className="p-6 max-w-4xl">
      <H2 icon="🏗️" title="System Architecture" />

      <H3>Technology Stack</H3>
      <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
        <thead><tr><Th>Layer</Th><Th>Technology</Th><Th>Notes</Th></tr></thead>
        <tbody>
          {([
            ['Frontend',      'React 18 + Vite + TypeScript',        'SPA, no SSR. Auth0 SPA SDK.'],
            ['Styling',       'Tailwind CSS 3 + CSS variables',       'Custom design tokens in tailwind.config.js'],
            ['API',           'Node.js 20 + Express 4',               'REST API on port 3001. Helmet, Morgan, rate-limit.'],
            ['Database',      'PostgreSQL 16',                        '26 tables, all prefixed mcogs_'],
            ['Auth',          'Auth0 (obscurekitty.uk.auth0.com)',     'Username/password + Google OAuth — tenant fixed, app domain separate'],
            ['Web Server',    'Nginx',                                 'Reverse proxy + SSL termination'],
            ['Process Mgr',  'PM2 (ubuntu user)',                     'Auto-restart + log rotation'],
            ['Hosting',       'AWS Lightsail',                        '$10/mo · 2 GB RAM · 1 vCPU · Ubuntu 24.04'],
            ['SSL',           "Let's Encrypt / Certbot",              'Auto-renews every 90 days'],
            ['CI/CD',         'GitHub Actions',                       'Push to main → build → SCP → SSH → health check'],
            ['AI Model',      'Claude Haiku 4.5',                     'SSE streaming via @anthropic-ai/sdk ^0.80'],
            ['AI Embeddings', 'Voyage AI voyage-3-lite',              'Optional RAG over documentation'],
            ['Exchange Rates','Frankfurter API',                      'Free, no API key — api.frankfurter.app'],
            ['Nutrition',     'USDA FoodData Central',                'Optional USDA proxy for ingredient nutrition data'],
          ] as [string, string, string][]).map(([layer, tech, notes]) => (
            <tr key={layer}><Td>{layer}</Td><Td mono>{tech}</Td><Td>{notes}</Td></tr>
          ))}
        </tbody>
      </table>

      <H3>Infrastructure Diagram</H3>
      <div className="bg-[#0F1F17] text-white rounded-lg p-4 my-3 font-mono text-xs leading-relaxed">
        <div className="text-[#6B7F74]">{'// Single AWS Lightsail instance — all services on one box'}</div>
        <div className="mt-2">
          <span className="text-[#E8F5ED]">Browser</span>
          <span className="text-[#6B7F74]"> (React SPA — https://cogs.flavorconnect.tech)</span>
        </div>
        <div className="text-[#1E8A44] ml-4">↕ HTTPS :443</div>
        <div><span className="text-[#E8F5ED]">Nginx</span><span className="text-[#6B7F74]"> (reverse proxy + Let's Encrypt SSL)</span></div>
        <div className="text-[#1E8A44] ml-4">↕ HTTP :3001 (internal loopback)</div>
        <div><span className="text-[#E8F5ED]">Node.js API</span><span className="text-[#6B7F74]"> (Express + PM2 · process: menu-cogs-api)</span></div>
        <div className="text-[#1E8A44] ml-4">↕ localhost:5432</div>
        <div><span className="text-[#E8F5ED]">PostgreSQL 16</span><span className="text-[#6B7F74]"> (database: mcogs · user: mcogs)</span></div>
        <div className="mt-3 text-[#6B7F74]">{'// External HTTPS outbound (from Node API)'}</div>
        <div className="mt-1 text-[#E8F5ED]">→ <span className="text-amber-400">api.anthropic.com</span>     <span className="text-[#6B7F74]">(AI chat)</span></div>
        <div className="text-[#E8F5ED]">→ <span className="text-amber-400">api.voyageai.com</span>      <span className="text-[#6B7F74]">(RAG embeddings, optional)</span></div>
        <div className="text-[#E8F5ED]">→ <span className="text-amber-400">api.frankfurter.app</span>   <span className="text-[#6B7F74]">(exchange rates)</span></div>
        <div className="text-[#E8F5ED]">→ <span className="text-amber-400">api.nal.usda.gov</span>      <span className="text-[#6B7F74]">(nutrition data, optional)</span></div>
      </div>

      <H3>Key Code Patterns</H3>
      <div className="space-y-3">
        {[
          { title: 'useApi() — Auth0-aware fetch hook',         path: 'app/src/hooks/useApi.ts',               detail: 'Wraps all API calls with Auth0 token injection. CRITICAL: the returned object is wrapped in useMemo() to give a stable reference and prevent infinite useEffect loops. Methods: get / post / put / patch / delete.' },
          { title: 'useSortFilter() — Sort + multi-select filter', path: 'app/src/hooks/useSortFilter.ts',     detail: 'Generic hook for managing sort state and multi-select filters over any data array. Returns: sorted array, sortField, sortDir, getFilter, setSort, setFilter, clearFilters, hasActiveFilters.' },
          { title: 'DataGrid — Inline-editable spreadsheet grid',  path: 'app/src/components/DataGrid.tsx',   detail: 'Generic editable grid supporting text / number / select / combo / derived cell types. Used in inventory and other data tables.' },
          { title: 'ColumnHeader — Sortable, filterable column',   path: 'app/src/components/ColumnHeader.tsx', detail: 'Multi-select filter dropdowns with fixed positioning (getBoundingClientRect) to avoid clipping inside overflow-x: auto containers.' },
          { title: 'AiChat — SSE streaming AI chat widget',        path: 'app/src/components/AiChat.tsx',     detail: 'Floating/docked chat panel. Uses native fetch + manual SSE parsing. Streams text, tool labels and errors in real time. Passes up to 10 messages of history per request.' },
          { title: 'agenticStream.js — Shared agentic loop',       path: 'api/src/helpers/agenticStream.js',  detail: 'SSE helper, keepalive ping every 10s, while(true) tool loop, token counting. Shared by ai-chat.js and ai-upload.js.' },
          { title: 'getEffectivePrice() — Preferred vendor fallback', path: 'api/src/helpers/effectivePrice.js', detail: 'Returns the preferred vendor quote for an ingredient+country pair. Falls back to lowest active quote if no preference is set. Used by recipes.js and cogs.js.' },
        ].map(b => (
          <div key={b.title} className="border border-[#D8E6DD] rounded-lg p-3 bg-white">
            <p className="text-sm font-bold text-[#0F1F17]">{b.title}</p>
            <p className="text-[11px] font-mono text-[#146A34] mt-0.5">{b.path}</p>
            <p className="text-xs text-[#2D4A38] mt-1.5 leading-relaxed">{b.detail}</p>
          </div>
        ))}
      </div>

      <H3>Database Schema</H3>
      <p className="text-sm text-[#2D4A38] mb-2">
        All tables are prefixed <Mono>mcogs_</Mono> for compatibility with the legacy WordPress plugin.
        Migration: <Mono>cd api && npm run migrate</Mono> (safe to run multiple times).
      </p>
      <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
        <thead><tr><Th>#</Th><Th>Table</Th><Th>Purpose</Th></tr></thead>
        <tbody>
          {([
            [1,  'mcogs_units',                       'Measurement units (kg, litre, each, etc.)'],
            [2,  'mcogs_price_levels',                'Price levels (Eat-in, Takeout, Delivery)'],
            [3,  'mcogs_countries',                   'Markets: currency, exchange rate, default price level'],
            [4,  'mcogs_country_tax_rates',           'Tax rates per country (e.g. UK VAT 20%)'],
            [5,  'mcogs_country_level_tax',           'Junction: which tax rate applies to which price level'],
            [6,  'mcogs_categories',                  'Ingredient/recipe categories with group_name + type'],
            [7,  'mcogs_vendors',                     'Suppliers linked to a country'],
            [8,  'mcogs_ingredients',                 'Ingredient master list: base unit, waste %, prep conversion'],
            [9,  'mcogs_price_quotes',                'Vendor pricing per ingredient: price, qty, unit, active'],
            [10, 'mcogs_ingredient_preferred_vendor', 'Preferred vendor per ingredient per country (UNIQUE)'],
            [11, 'mcogs_recipes',                     'Recipe definitions with yield qty and yield unit'],
            [12, 'mcogs_recipe_items',                'Recipe lines: ingredient or sub-recipe, qty, conversion'],
            [13, 'mcogs_menus',                       'Menu definitions linked to a country'],
            [14, 'mcogs_menu_items',                  'Menu items: recipe or ingredient, display name, sort order'],
            [15, 'mcogs_menu_item_prices',            'Sell prices per menu item per price level + tax rate'],
            [16, 'mcogs_locations',                   'Physical stores: market, group, address, contact'],
            [17, 'mcogs_location_groups',             'Clusters of locations (e.g. "London Central")'],
            [18, 'mcogs_allergens',                   'EU/UK FIC reference allergens (14 regulated)'],
            [19, 'mcogs_ingredient_allergens',        'Junction: allergen status per ingredient'],
            [20, 'mcogs_equipment',                   'HACCP equipment register linked to location'],
            [21, 'mcogs_equipment_temp_logs',         'Temperature readings per equipment item'],
            [22, 'mcogs_ccp_logs',                    'CCP logs (cooking/cooling/delivery) per location'],
            [23, 'mcogs_feedback',                    'User-submitted bug reports and feature requests'],
            [24, 'mcogs_ai_chat_log',                 'AI request/response log with token counts and tools called'],
            [25, 'mcogs_settings',                    'Single-row JSONB config: defaults, thresholds, AI keys'],
            [26, 'mcogs_brand_partners',              'Franchise brand partners linked to markets'],
            [27, 'mcogs_menu_scenarios',              'Saved Menu Engineer scenarios with price/cost overrides'],
          ] as [number, string, string][]).map(([n, table, purpose]) => (
            <tr key={n}><Td>{n}</Td><Td mono>{table}</Td><Td>{purpose}</Td></tr>
          ))}
        </tbody>
      </table>

      <H3>Data Flow: API Request Lifecycle</H3>
      <ProcessFlow steps={[
        { label: 'User action',    sub: 'e.g. save ingredient' },
        { label: 'useApi()',       sub: 'Auth0 token fetched' },
        { label: 'fetch()',        sub: 'POST /api/ingredients' },
        { label: 'Nginx',         sub: 'Proxy → :3001' },
        { label: 'Express route', sub: 'Validates + queries DB' },
        { label: 'PostgreSQL',    sub: 'Returns row' },
        { label: 'JSON 201',      sub: 'Response to browser' },
        { label: 'setState()',    sub: 'UI re-renders' },
      ]} />

      <H3>Data Flow: AI Assistant Request</H3>
      <ProcessFlow steps={[
        { label: 'User message',   sub: 'Chat input' },
        { label: 'POST /ai-chat',  sub: 'with history + ctx' },
        { label: 'rag.retrieve()', sub: 'Top-4 doc chunks' },
        { label: 'Claude Haiku',  sub: 'Interprets + plans' },
        { label: 'Tool calls',    sub: 'Queries DB live' },
        { label: 'Claude again',  sub: 'Formulates response' },
        { label: 'SSE stream',    sub: 'Text events to browser' },
        { label: 'AiChat.tsx',    sub: 'Renders streamed text' },
      ]} />
    </div>
  )
}

function ApiReferenceSection() {
  return (
    <div className="p-6 max-w-4xl">
      <H2 icon="📡" title="API Reference" />
      <p className="text-sm text-[#2D4A38] mb-1">
        Production base URL: <Mono>https://cogs.flavorconnect.tech/api</Mono>
      </p>
      <p className="text-sm text-[#2D4A38] mb-3">
        Local dev base URL: <Mono>http://localhost:3001/api</Mono>
      </p>
      <InfoBox type="info" title="Authentication">
        Every request from the React SPA includes an Auth0 Bearer token via <Mono>useApi()</Mono>.
        The server verifies it by calling Auth0's <Mono>/userinfo</Mono> endpoint (5-min cache).
      </InfoBox>

      <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
        <thead><tr><Th>Method</Th><Th>Endpoint</Th><Th>Description</Th></tr></thead>
        <tbody>
          {([
            ['GET',    '/health',                          'Health check — {"status":"ok"} if DB is reachable'],
            ['GET',    '/settings',                        'Retrieve system settings (JSONB blob)'],
            ['PUT',    '/settings',                        'Replace system settings'],
            ['PATCH',  '/settings',                        'Partial update system settings'],
            ['GET',    '/units',                           'List all units of measurement'],
            ['POST',   '/units',                           'Create a unit'],
            ['PUT',    '/units/:id',                       'Update a unit'],
            ['DELETE', '/units/:id',                       'Delete a unit'],
            ['GET',    '/price-levels',                    'List all price levels'],
            ['POST',   '/price-levels',                    'Create a price level'],
            ['PUT',    '/price-levels/:id',                'Update a price level'],
            ['DELETE', '/price-levels/:id',                'Delete a price level'],
            ['POST',   '/sync-exchange-rates',             'Sync exchange rates from Frankfurter API'],
            ['GET',    '/countries',                       'List all markets/countries'],
            ['POST',   '/countries',                       'Create a market'],
            ['PUT',    '/countries/:id',                   'Update a market'],
            ['DELETE', '/countries/:id',                   'Delete a market'],
            ['GET',    '/tax-rates',                       'List tax rates (filterable by ?country_id=)'],
            ['POST',   '/tax-rates',                       'Create a tax rate'],
            ['PUT',    '/tax-rates/:id',                   'Update a tax rate'],
            ['DELETE', '/tax-rates/:id',                   'Delete a tax rate'],
            ['GET',    '/country-level-tax',               'List country-level tax mappings'],
            ['POST',   '/country-level-tax',               'Create a mapping (country × price level × tax rate)'],
            ['DELETE', '/country-level-tax/:id',           'Delete a mapping'],
            ['GET',    '/categories',                      'List categories (?type=ingredient|recipe)'],
            ['POST',   '/categories',                      'Create a category'],
            ['PUT',    '/categories/:id',                  'Update a category'],
            ['DELETE', '/categories/:id',                  'Delete a category'],
            ['GET',    '/vendors',                         'List vendors'],
            ['POST',   '/vendors',                         'Create a vendor'],
            ['PUT',    '/vendors/:id',                     'Update a vendor'],
            ['DELETE', '/vendors/:id',                     'Delete a vendor'],
            ['GET',    '/ingredients',                     'List all ingredients'],
            ['POST',   '/ingredients',                     'Create an ingredient'],
            ['PUT',    '/ingredients/:id',                 'Update an ingredient'],
            ['DELETE', '/ingredients/:id',                 'Delete an ingredient'],
            ['GET',    '/price-quotes',                    'List price quotes (?ingredient_id=)'],
            ['POST',   '/price-quotes',                    'Create a price quote'],
            ['PUT',    '/price-quotes/:id',                'Update a quote'],
            ['DELETE', '/price-quotes/:id',                'Delete a quote'],
            ['GET',    '/preferred-vendors',               'List preferred vendor assignments'],
            ['POST',   '/preferred-vendors',               'Set a preferred vendor for ingredient+country'],
            ['DELETE', '/preferred-vendors/:id',           'Remove an assignment'],
            ['GET',    '/recipes',                         'List all recipes'],
            ['POST',   '/recipes',                         'Create a recipe'],
            ['PUT',    '/recipes/:id',                     'Update recipe header (name, yield, category)'],
            ['DELETE', '/recipes/:id',                     'Delete a recipe'],
            ['GET',    '/menus',                           'List menus (?country_id=)'],
            ['POST',   '/menus',                           'Create a menu for a market'],
            ['PUT',    '/menus/:id',                       'Update a menu'],
            ['DELETE', '/menus/:id',                       'Delete a menu'],
            ['GET',    '/menu-items',                      'List menu items (?menu_id=)'],
            ['POST',   '/menu-items',                      'Add item to a menu'],
            ['PUT',    '/menu-items/:id',                  'Update menu item (display name, sort order)'],
            ['DELETE', '/menu-items/:id',                  'Remove item from menu'],
            ['GET',    '/menu-item-prices',                'List sell prices (?menu_item_id= or ?menu_id=)'],
            ['POST',   '/menu-item-prices',                'Set a sell price for item × price level'],
            ['PUT',    '/menu-item-prices/:id',            'Update sell price'],
            ['DELETE', '/menu-item-prices/:id',            'Delete sell price record'],
            ['GET',    '/cogs/menu/:id',                   'Calculate COGS for all items on a menu'],
            ['GET',    '/allergens',                       'List all 14 EU FIC allergens'],
            ['GET',    '/allergens/ingredient/:id',        'Get allergen statuses for an ingredient'],
            ['PUT',    '/allergens/ingredient/:id',        'Set (bulk replace) allergen statuses'],
            ['PATCH',  '/allergens/ingredient/:id/notes',  'Save allergen_notes text for an ingredient'],
            ['GET',    '/allergens/menu/:id',              'Allergen matrix for a full menu'],
            ['PATCH',  '/allergens/menu-item/:id/notes',   'Save allergen_notes for a menu item'],
            ['GET',    '/nutrition/search',                'USDA + Open Food Facts nutrition search (?q=)'],
            ['GET',    '/haccp/equipment',                 'List equipment (?location_id=)'],
            ['POST',   '/haccp/equipment',                 'Register a piece of equipment'],
            ['PUT',    '/haccp/equipment/:id',             'Update equipment record'],
            ['DELETE', '/haccp/equipment/:id',             'Delete equipment'],
            ['GET',    '/haccp/equipment/:id/logs',        'List temperature logs for equipment'],
            ['POST',   '/haccp/equipment/:id/logs',        'Log a temperature reading'],
            ['GET',    '/haccp/ccp-logs',                  'List CCP logs (?location_id=)'],
            ['POST',   '/haccp/ccp-logs',                  'Create a CCP log entry'],
            ['DELETE', '/haccp/ccp-logs/:id',              'Delete a CCP log'],
            ['GET',    '/locations',                       'List locations (?market_id=&group_id=&active=)'],
            ['POST',   '/locations',                       'Create a location'],
            ['PUT',    '/locations/:id',                   'Update a location'],
            ['DELETE', '/locations/:id',                   'Delete a location'],
            ['GET',    '/location-groups',                 'List location groups'],
            ['POST',   '/location-groups',                 'Create a location group'],
            ['POST',   '/ai-chat',                         'SSE streaming AI chat — body: {messages, conversationId?}'],
            ['POST',   '/ai-upload',                       'Multipart file + AI chat — SSE streaming'],
            ['GET',    '/ai-chat/my-usage',                'Current period token usage for signed-in user'],
            ['GET',    '/ai-config',                       'Returns {anthropic_key_set: bool, …}'],
            ['PUT',    '/ai-config',                       'Save AI API keys'],
            ['POST',   '/feedback',                        'Submit feedback {title, type, description, page}'],
          ] as [string, string, string][]).map(([method, path, desc]) => (
            <tr key={method + path} className="hover:bg-[#F7F9F8]">
              <Td><MethodBadge method={method} /></Td>
              <Td mono>{`/api${path}`}</Td>
              <Td>{desc}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SecuritySection() {
  return (
    <div className="p-6 max-w-4xl">
      <H2 icon="🔒" title="Security" />

      <H3>Auth0 Authentication Flow</H3>
      <ProcessFlow steps={[
        { label: 'User visits',        sub: 'cogs.flavorconnect.tech' },
        { label: 'Auth0 check',        sub: 'Token valid?' },
        { label: 'Redirect to Auth0',  sub: 'If not authenticated' },
        { label: 'Login',              sub: 'Password or Google' },
        { label: 'Callback',           sub: 'Access token returned' },
        { label: 'React SPA',          sub: 'Token in memory' },
        { label: 'API request',        sub: 'Bearer token sent' },
        { label: 'Auth0 /userinfo',    sub: 'Token verified + cached' },
        { label: 'RBAC check',         sub: 'Role + permissions loaded' },
      ]} />

      <H3>Security Controls</H3>
      <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
        <thead><tr><Th>Control</Th><Th>Implementation</Th><Th>Status</Th></tr></thead>
        <tbody>
          {[
            ['HTTPS',                'Nginx + Let\'s Encrypt SSL',                                    '✅ Active'],
            ['Auth0 Frontend Guard', 'React ProtectedRoute + useAuth0()',                             '✅ Active'],
            ['Bearer Token',         'Auth0 access token in Authorization header on every request',   '✅ Active'],
            ['API Token Verify',     'requireAuth middleware calls Auth0 /userinfo — 5 min cache',    '✅ Active'],
            ['RBAC',                 'Role + per-feature permission check on every protected route',  '✅ Active'],
            ['Pending Approval',     'New users start as pending — admin must approve before access', '✅ Active'],
            ['Rate Limiting',        '500 req / 15 min (express-rate-limit)',                         '✅ Active'],
            ['Security Headers',     'Helmet.js (HSTS, CSP, X-Frame-Options, etc.)',                  '✅ Active'],
            ['Trust Proxy',          'app.set("trust proxy", 1) for Nginx X-Forwarded-For',           '✅ Active'],
            ['DB Credentials',       'Strong random password in .env — not in git',                   '✅ Active'],
            ['AI Key Storage',       'Stored in PostgreSQL JSONB — never sent to browser',            '✅ Active'],
            ['PM2 User',             'All processes run as ubuntu (not root, not mcogs)',              '✅ Active'],
          ].map(([ctrl, impl, status]) => (
            <tr key={ctrl}><Td>{ctrl}</Td><Td>{impl}</Td><Td>{status}</Td></tr>
          ))}
        </tbody>
      </table>

      <InfoBox type="info" title="Token verification approach">
        The API verifies tokens by calling Auth0's <Mono>/userinfo</Mono> endpoint on each request
        (responses cached 5 min). This works without configuring an Auth0 API audience.
        For higher-security deployments, full JWT signature verification can be added via{' '}
        <Mono>express-jwt</Mono> + Auth0 JWKS.
      </InfoBox>

      <H3>AI Key Storage Model</H3>
      <p className="text-sm text-[#2D4A38] leading-relaxed">
        API keys (Anthropic, Voyage AI, Brave Search, GitHub PAT) are entered via System → AI.
        They are written to the <Mono>mcogs_settings</Mono> table path <Mono>data→'ai_keys'</Mono> (PostgreSQL JSONB).
        On API startup, <Mono>aiConfig.init()</Mono> reads keys from the DB and loads them into a runtime memory store.{' '}
        <Mono>GET /api/ai-config</Mono> returns only boolean flags — never the raw key values.
        Keys can be updated at runtime without restarting the Node process.
      </p>
    </div>
  )
}

function TroubleshootingSection() {
  return (
    <div className="p-6 max-w-4xl">
      <H2 icon="🔧" title="Troubleshooting" />

      <H3>Known Bugs Fixed</H3>
      <div className="space-y-3">
        {[
          { title: 'Fix 1 — Mixed Content / 1,252 blocked requests',       symptom: 'All API calls going to http:// despite HTTPS.',                                                                                               fix: 'deploy.yml was hardcoding http:// prefix when constructing VITE_API_URL. Use ${{ secrets.VITE_API_URL }} directly.',                                                                                                    file: '.github/workflows/deploy.yml' },
          { title: 'Fix 2 — Infinite useEffect loop',                      symptom: 'Thousands of API requests per second. UI continuously re-rendering.',                                                                         fix: 'useApi() returned a new object on every render. Wrap return in useMemo(() => ({...}), [request]).',                                                                                                                     file: 'app/src/hooks/useApi.ts' },
          { title: 'Fix 3 — Express Trust Proxy error',                    symptom: 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR — all POST requests rejected.',                                                                            fix: 'Add app.set("trust proxy", 1) immediately after const app = express().',                                                                                                                                                 file: 'api/src/index.js' },
          { title: 'Fix 4 — ColumnHeader dropdown clipping',               symptom: 'Filter/sort dropdowns were cut off inside overflow-x: auto wrappers.',                                                                        fix: 'Changed to position: fixed with getBoundingClientRect() coordinates at z-index: 99999.',                                                                                                                                 file: 'app/src/components/ColumnHeader.tsx' },
          { title: 'Fix 5 — Pepper loses focus on every keystroke',        symptom: 'Typing in the chat textarea lost focus after each character. Focus not restored after AI response.',                                           fix: 'ChatPanel/HistoryPanel were defined inside AiChat(), creating new component identities on every render. Move both to module level. Add wasStreaming ref + useEffect to restore focus 100ms after streaming ends.',      file: 'app/src/components/AiChat.tsx' },
          { title: 'Fix 6 — Sidebar does not span full viewport height',   symptom: "The sidebar's green border stopped short of the bottom of the screen.",                                                                        fix: 'Change wrapper div from h-full to flex flex-col self-stretch so aside fills height definitively.',                                                                                                                       file: 'app/src/components/AppLayout.tsx' },
          { title: 'Fix 7 — Anthropic 400 error in multi-turn tool calls', symptom: 'messages.N.content.0.text.input_str: Extra inputs are not permitted — on message 9+ when Claude called multiple tools.',                     fix: 'agenticStream.js used input_str as a local streaming accumulator left on tool blocks. Destructure it off before pushing: const { input_str, ...cleanBlock } = currentBlock.',                                           file: 'api/src/helpers/agenticStream.js' },
        ].map(b => (
          <div key={b.title} className="border border-[#D8E6DD] rounded-lg p-3 bg-white">
            <p className="text-sm font-bold text-[#0F1F17]">{b.title}</p>
            <p className="text-xs text-[#6B7F74] mt-1"><span className="font-semibold text-red-600">Symptom:</span> {b.symptom}</p>
            <p className="text-xs text-[#2D4A38] mt-1"><span className="font-semibold text-[#146A34]">Fix:</span> {b.fix}</p>
            <p className="text-[10px] font-mono text-[#6B7F74] mt-1.5">📄 {b.file}</p>
          </div>
        ))}
      </div>

      <H3>Frequently Asked Questions</H3>
      <div className="space-y-2">
        {[
          { q: "Why are my recipe COGS calculations showing £0.00?",       a: "An ingredient in the recipe has no active price quote for the selected market. Go to Inventory → Price Quotes, add an active quote, then optionally set a Preferred Vendor." },
          { q: "Menu sell prices show wrong currency or amount.",           a: "Check the market's exchange rate in Markets. Use Settings → Exchange Rates → Sync to fetch live rates. All prices are stored in USD and converted to local currency using the exchange rate." },
          { q: 'The AI assistant says "API key not configured".',          a: 'Go to System → AI and enter your Anthropic API key (starts with sk-ant-…). Get one at console.anthropic.com.' },
          { q: 'Auth0 login is failing with a "callback URL mismatch".',   a: 'In Auth0 dashboard → Applications → Settings, ensure both https://cogs.flavorconnect.tech and http://localhost:5173 are in Allowed Callback URLs, Logout URLs, and Web Origins.' },
          { q: 'The CI/CD deploy is failing at the health check step.',    a: 'SSH in and check: (1) pm2 status (2) curl http://localhost:3001/api/health (3) pm2 logs menu-cogs-api --lines 50 for startup errors.' },
          { q: 'Exchange rate sync is failing.',                           a: 'Test from the server: curl https://api.frankfurter.app/latest. If blocked, check AWS Lightsail outbound networking rules for port 443.' },
          { q: 'PM2 is not running. How do I restart it?',                 a: 'SSH as ubuntu. Run: cd /var/www/menu-cogs/api && pm2 start src/index.js --name menu-cogs-api. Then pm2 save to persist across reboots.' },
        ].map(({ q, a }) => (
          <details key={q} className="border border-[#D8E6DD] rounded-lg group">
            <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-[#0F1F17] hover:bg-[#F7F9F8] rounded-lg list-none flex items-center justify-between gap-2">
              <span>{q}</span>
              <svg className="w-4 h-4 text-[#6B7F74] shrink-0 group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
            </summary>
            <div className="px-4 pb-3 pt-2 text-sm text-[#2D4A38] border-t border-[#D8E6DD] leading-relaxed">{a}</div>
          </details>
        ))}
      </div>

      <H3>Server Management Quick Reference</H3>
      <div className="bg-[#0F1F17] rounded-lg p-4 my-3 font-mono text-xs leading-relaxed space-y-1">
        <p className="text-[#1E8A44] font-bold"># Process management</p>
        <p className="text-white">pm2 status</p>
        <p className="text-[#6B7F74] ml-4"># Check API is running</p>
        <p className="text-white">pm2 restart menu-cogs-api</p>
        <p className="text-[#6B7F74] ml-4"># Restart after env/config changes</p>
        <p className="text-white">pm2 logs menu-cogs-api --lines 50</p>
        <p className="text-[#6B7F74] ml-4"># View recent API logs</p>
        <p className="text-white">pm2 save</p>
        <p className="text-[#6B7F74] ml-4"># Persist PM2 process list across reboots</p>
        <p className="text-[#1E8A44] font-bold mt-2"># Web server</p>
        <p className="text-white">sudo nginx -t &amp;&amp; sudo nginx -s reload</p>
        <p className="text-[#6B7F74] ml-4"># Test config then reload Nginx</p>
        <p className="text-[#1E8A44] font-bold mt-2"># Database</p>
        <p className="text-white">psql -U mcogs -d mcogs</p>
        <p className="text-[#6B7F74] ml-4"># Connect to PostgreSQL</p>
        <p className="text-white">cd /var/www/menu-cogs/api &amp;&amp; npm run migrate</p>
        <p className="text-[#6B7F74] ml-4"># Run DB migrations (idempotent)</p>
        <p className="text-[#1E8A44] font-bold mt-2"># SSL</p>
        <p className="text-white">sudo certbot renew --dry-run</p>
        <p className="text-[#6B7F74] ml-4"># Test Let's Encrypt renewal</p>
        <p className="text-[#1E8A44] font-bold mt-2"># Health check</p>
        <p className="text-white">curl https://cogs.flavorconnect.tech/api/health</p>
        <p className="text-[#6B7F74] ml-4"># Should return: {"{"}"status":"ok"{"}"}</p>
      </div>
    </div>
  )
}

function DomainMigrationSection() {
  return (
    <div className="p-6 max-w-4xl">
      <H2 icon="🌐" title="Domain Migration" />
      <p className="text-sm text-[#2D4A38] leading-relaxed mb-3">
        The app currently runs at <Mono>cogs.flavorconnect.tech</Mono> (migrated from <Mono>obscurekitty.com</Mono> in April 2026).
        Follow these steps if you ever need to change the domain or subdomain again.
        Full reference also in <Mono>docs/DOMAIN_MIGRATION.md</Mono>.
      </p>

      <H3>Prerequisites</H3>
      <p className="text-sm text-[#2D4A38] leading-relaxed mb-3">
        Before starting: purchase the domain, point its nameservers to AWS Route 53 / Lightsail, and create a DNS zone for the apex domain.
        For a subdomain (recommended), you only need an A record in the existing zone.
      </p>

      <H3>Step-by-Step Process</H3>
      <div className="space-y-3 my-3">
        {[
          { n: '1', title: 'Add DNS A record',         cmd: 'nslookup cogs.flavorconnect.tech',                                                                                                                 detail: 'In the Lightsail DNS zone for your apex domain, add an A record: subdomain → server IP 13.135.158.196. Wait for propagation (1–5 min), then verify:' },
          { n: '2', title: 'Update Nginx server_name', cmd: 'sudo nano /etc/nginx/sites-available/menu-cogs\n# change: server_name <new-domain>;\nsudo nginx -t && sudo nginx -s reload',                      detail: 'SSH into the server. Edit the Nginx site config and replace the server_name value. Test the config before reloading.' },
          { n: '3', title: 'Issue SSL certificate',    cmd: 'sudo certbot --nginx -d <new-domain>',                                                                                                             detail: "Certbot automatically issues the Let's Encrypt cert and patches Nginx. Requires DNS A record to be live first." },
          { n: '4', title: 'Update Auth0 URLs',        cmd: 'manage.auth0.com → Applications → Settings',                                                                                                      detail: 'Add the new domain to: Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins. Keep existing localhost entries until confirmed working. Auth0 tenant name does NOT change.' },
          { n: '5', title: 'Update GitHub Secrets',    cmd: 'LIGHTSAIL_HOST = <new-domain>\nVITE_API_URL   = https://<new-domain>/api',                                                                         detail: 'GitHub repo → Settings → Secrets and variables → Actions. Update both secrets. VITE_API_URL must include the full https:// prefix.' },
          { n: '6', title: 'Deploy & verify',          cmd: 'git commit --allow-empty -m "chore: switch domain to <new-domain>"\ngit push\ncurl https://<new-domain>/api/health',                             detail: 'Push an empty commit to trigger GitHub Actions. Health check must return {"status":"ok"}.' },
          { n: '7', title: 'Update documentation',     cmd: '',                                                                                                                                                 detail: 'Update CLAUDE.md, HelpPage.tsx, SystemPage.tsx, docs/user-guide.md, docs/DOMAIN_MIGRATION.md, and api/src/routes/nutrition.js (User-Agent contact email). Then remove old domain from Auth0 URLs.' },
        ].map(({ n, title, cmd, detail }) => (
          <div key={n} className="border border-[#D8E6DD] rounded-lg bg-white overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-2.5 bg-[#E8F5ED]">
              <span className="w-6 h-6 rounded-full bg-[#146A34] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{n}</span>
              <p className="text-sm font-semibold text-[#0F1F17]">{title}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-[#2D4A38] leading-relaxed mb-2">{detail}</p>
              {cmd && (
                <div className="bg-[#0F1F17] rounded-md px-3 py-2 font-mono text-xs text-white whitespace-pre-line">{cmd}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <InfoBox type="info" title="Auth0 tenant is independent of the app domain">
        The Auth0 tenant name (<Mono>obscurekitty.uk.auth0.com</Mono>) is a fixed identifier chosen at tenant creation and
        cannot be changed without creating a new tenant. Changing the app domain does not require changing the Auth0 tenant.
      </InfoBox>

      <InfoBox type="warning" title="Subdomain vs apex domain">
        Using a subdomain (e.g. <Mono>cogs.flavorconnect.tech</Mono>) is strongly recommended — it requires only an A record
        in the existing DNS zone. Moving to a different apex domain requires updating nameservers at the registrar.
      </InfoBox>
    </div>
  )
}

// ── Audit Log Section ─────────────────────────────────────────────────────────

interface AuditEntry {
  id: number
  user_sub: string | null
  user_email: string | null
  user_name: string | null
  action: string
  entity_type: string
  entity_id: number | null
  entity_label: string | null
  field_changes: Record<string, { old: any; new: any }> | null
  context: Record<string, any> | null
  related_entities: { type: string; id: number; label?: string }[] | null
  ip_address: string | null
  created_at: string
}

function AuditLogSection() {
  const api = useApi()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const pageSize = 30

  // Filters
  const [filterUser, setFilterUser] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterEntity, setFilterEntity] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterSearch, setFilterSearch] = useState('')

  // Expanded row
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterUser)   params.set('user_sub', filterUser)
      if (filterAction) params.set('action', filterAction)
      if (filterEntity) params.set('entity_type', filterEntity)
      if (filterFrom)   params.set('from', filterFrom)
      if (filterTo)     params.set('to', filterTo)
      if (filterSearch) params.set('q', filterSearch)
      params.set('limit', String(pageSize))
      params.set('offset', String(page * pageSize))
      const data = await api.get(`/audit?${params}`)
      setEntries(data.items || [])
      setTotal(data.total || 0)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [api, filterUser, filterAction, filterEntity, filterFrom, filterTo, filterSearch, page])

  useEffect(() => { load() }, [load])

  // Reset page when filters change
  useEffect(() => { setPage(0) }, [filterUser, filterAction, filterEntity, filterFrom, filterTo, filterSearch])

  // Unique users/actions/entities for filter dropdowns
  const uniqueUsers = useMemo(() => {
    const set = new Set(entries.map(e => e.user_email).filter(Boolean) as string[])
    return [...set].sort()
  }, [entries])

  const actions = ['create', 'update', 'delete', 'status_change', 'confirm', 'approve', 'reverse']
  const entityTypes = [
    'ingredient', 'recipe', 'recipe_item', 'price_quote',
    'purchase_order', 'goods_received', 'invoice', 'credit_note',
    'stock_level', 'waste_log', 'stock_transfer', 'stocktake',
  ]

  const totalPages = Math.ceil(total / pageSize)

  const actionColor: Record<string, string> = {
    create:        'bg-green-50 text-green-700',
    update:        'bg-blue-50 text-blue-700',
    delete:        'bg-red-50 text-red-600',
    status_change: 'bg-purple-50 text-purple-700',
    confirm:       'bg-emerald-50 text-emerald-700',
    approve:       'bg-emerald-50 text-emerald-700',
    reverse:       'bg-orange-50 text-orange-700',
  }

  function formatDate(iso: string) {
    const d = new Date(iso)
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
      + ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  return (
    <div className="p-6 max-w-full">
      <div className="mb-5">
        <h2 className="text-base font-bold text-text-1">Audit Log</h2>
        <p className="text-sm text-text-3 mt-0.5">Central trail of all data changes across the system</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 p-3 bg-surface-2 rounded-lg border border-border">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase text-text-3">Search</label>
          <input
            value={filterSearch} onChange={e => setFilterSearch(e.target.value)}
            placeholder="Entity label..."
            className="input text-sm py-1.5 w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase text-text-3">Action</label>
          <select value={filterAction} onChange={e => setFilterAction(e.target.value)} className="input text-sm py-1.5 w-36">
            <option value="">All actions</option>
            {actions.map(a => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase text-text-3">Entity</label>
          <select value={filterEntity} onChange={e => setFilterEntity(e.target.value)} className="input text-sm py-1.5 w-40">
            <option value="">All entities</option>
            {entityTypes.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase text-text-3">User</label>
          <input
            value={filterUser} onChange={e => setFilterUser(e.target.value)}
            placeholder="User sub or email"
            className="input text-sm py-1.5 w-44"
            list="audit-users"
          />
          <datalist id="audit-users">
            {uniqueUsers.map(u => <option key={u} value={u} />)}
          </datalist>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase text-text-3">From</label>
          <input type="date" value={filterFrom} onChange={e => setFilterFrom(e.target.value)} className="input text-sm py-1.5 w-36" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-semibold uppercase text-text-3">To</label>
          <input type="date" value={filterTo} onChange={e => setFilterTo(e.target.value)} className="input text-sm py-1.5 w-36" />
        </div>
        <div className="flex flex-col justify-end">
          <button onClick={() => { setFilterUser(''); setFilterAction(''); setFilterEntity(''); setFilterFrom(''); setFilterTo(''); setFilterSearch('') }}
            className="btn-ghost text-xs py-1.5 px-3 border border-border">
            Clear
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm text-text-3">
          {total} entr{total === 1 ? 'y' : 'ies'} found
          {total > pageSize && ` — showing ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)}`}
        </span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="btn-ghost text-xs py-1 px-2 border border-border disabled:opacity-40">
              ← Prev
            </button>
            <span className="text-xs text-text-3 px-2">Page {page + 1} of {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="btn-ghost text-xs py-1 px-2 border border-border disabled:opacity-40">
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <svg className="animate-spin w-6 h-6 text-accent" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-text-3">
          <p className="text-sm">No audit entries found</p>
          <p className="text-xs mt-1">Adjust your filters or wait for some data changes to be logged</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-2 text-xs text-text-3 uppercase tracking-wide">
                <th className="text-left px-3 py-2.5 font-semibold w-40">Timestamp</th>
                <th className="text-left px-3 py-2.5 font-semibold w-36">User</th>
                <th className="text-left px-3 py-2.5 font-semibold w-24">Action</th>
                <th className="text-left px-3 py-2.5 font-semibold w-28">Entity</th>
                <th className="text-left px-3 py-2.5 font-semibold">Label</th>
                <th className="text-left px-3 py-2.5 font-semibold w-16">Details</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <AuditRow key={e.id} entry={e} expanded={expandedId === e.id}
                  onToggle={() => setExpandedId(expandedId === e.id ? null : e.id)}
                  actionColor={actionColor} formatDate={formatDate} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bottom pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center mt-4">
          <div className="flex items-center gap-1">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
              className="btn-ghost text-xs py-1 px-2 border border-border disabled:opacity-40">
              ← Prev
            </button>
            <span className="text-xs text-text-3 px-2">Page {page + 1} of {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
              className="btn-ghost text-xs py-1 px-2 border border-border disabled:opacity-40">
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Audit Row (expandable) ───────────────────────────────────────────────────

function AuditRow({ entry: e, expanded, onToggle, actionColor, formatDate }: {
  entry: AuditEntry; expanded: boolean
  onToggle: () => void
  actionColor: Record<string, string>
  formatDate: (iso: string) => string
}) {
  return (
    <>
      <tr onClick={onToggle}
        className={`border-t border-border cursor-pointer transition-colors ${expanded ? 'bg-accent-dim' : 'hover:bg-surface-2'}`}>
        <td className="px-3 py-2 text-text-3 whitespace-nowrap text-xs font-mono">
          {formatDate(e.created_at)}
        </td>
        <td className="px-3 py-2 text-text-2 truncate max-w-[140px]" title={e.user_email || e.user_sub || ''}>
          {e.user_name || e.user_email || e.user_sub || '—'}
        </td>
        <td className="px-3 py-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${actionColor[e.action] || 'bg-gray-100 text-gray-600'}`}>
            {e.action.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="px-3 py-2 text-text-3 text-xs">
          {e.entity_type.replace(/_/g, ' ')}
          {e.entity_id != null && <span className="text-text-3 ml-1">#{e.entity_id}</span>}
        </td>
        <td className="px-3 py-2 text-text-1 truncate max-w-[250px]" title={e.entity_label || ''}>
          {e.entity_label || '—'}
        </td>
        <td className="px-3 py-2 text-center">
          <span className="text-text-3 text-xs">{expanded ? '▼' : '▶'}</span>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-white">
          <td colSpan={6} className="px-4 py-3 border-t border-border">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">

              {/* Field changes */}
              {e.field_changes && Object.keys(e.field_changes).length > 0 && (
                <div>
                  <p className="font-semibold text-text-1 mb-1.5 uppercase tracking-wide text-[10px]">Field Changes</p>
                  <table className="w-full text-xs border border-border rounded overflow-hidden">
                    <thead>
                      <tr className="bg-surface-2">
                        <th className="text-left px-2 py-1 font-semibold text-text-3">Field</th>
                        <th className="text-left px-2 py-1 font-semibold text-text-3">Old</th>
                        <th className="text-left px-2 py-1 font-semibold text-text-3">New</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(e.field_changes).map(([field, vals]) => (
                        <tr key={field} className="border-t border-border">
                          <td className="px-2 py-1 font-medium text-text-2">{field.replace(/_/g, ' ')}</td>
                          <td className="px-2 py-1 text-red-600 font-mono">
                            {vals.old != null ? String(vals.old) : <span className="italic text-text-3">null</span>}
                          </td>
                          <td className="px-2 py-1 text-green-700 font-mono">
                            {vals.new != null ? String(vals.new) : <span className="italic text-text-3">null</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Context */}
              {e.context && Object.keys(e.context).length > 0 && (
                <div>
                  <p className="font-semibold text-text-1 mb-1.5 uppercase tracking-wide text-[10px]">Context</p>
                  <div className="bg-surface-2 border border-border rounded p-2 space-y-1">
                    {Object.entries(e.context).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-text-3 font-medium shrink-0">{k}:</span>
                        <span className="text-text-1 font-mono break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Related entities */}
              {e.related_entities && e.related_entities.length > 0 && (
                <div>
                  <p className="font-semibold text-text-1 mb-1.5 uppercase tracking-wide text-[10px]">Related Entities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {e.related_entities.map((r, i) => (
                      <span key={i} className="bg-surface-2 border border-border rounded px-2 py-0.5 text-text-2">
                        {r.type.replace(/_/g, ' ')} #{r.id}
                        {r.label && <span className="text-text-3 ml-1">({r.label})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* IP + raw IDs */}
              <div>
                <p className="font-semibold text-text-1 mb-1.5 uppercase tracking-wide text-[10px]">Metadata</p>
                <div className="bg-surface-2 border border-border rounded p-2 space-y-1 text-text-3">
                  <div>Audit ID: <span className="font-mono text-text-1">{e.id}</span></div>
                  {e.user_sub && <div>User sub: <span className="font-mono text-text-1 break-all">{e.user_sub}</span></div>}
                  {e.ip_address && <div>IP: <span className="font-mono text-text-1">{e.ip_address}</span></div>}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── Section definitions ────────────────────────────────────────────────────────

type Section =
  | 'ai'
  | 'audit-log'      // Central audit trail — admin-only
  | 'storage'        // Media storage config (local vs S3) — admin-only
  | 'database'       // DB connection config (local vs standalone/AWS RDS) — admin-only
  | 'test-data'      // Seeding + clearing dummy data — dev-only, date-confirmed
  | 'architecture'
  | 'api-reference'
  | 'security'
  | 'troubleshooting'
  | 'domain-migration'

interface SectionDef {
  id:        Section
  icon:      string
  label:     string
  /** Permission level required: 'admin' = settings:write, 'dev' = is_dev flag. Omit for public. */
  gate?:     'admin' | 'dev'
}

const SECTIONS: SectionDef[] = [
  { id: 'ai',               icon: '🤖', label: 'AI' },
  { id: 'audit-log',        icon: '📋', label: 'Audit Log',        gate: 'admin' },
  { id: 'storage',          icon: '☁️', label: 'Storage',           gate: 'admin' },
  { id: 'database',         icon: '🗄️', label: 'Database',         gate: 'admin' },
  { id: 'test-data',        icon: '🧪', label: 'Test Data',        gate: 'dev'   },
  { id: 'architecture',     icon: '🏗️', label: 'Architecture' },
  { id: 'api-reference',    icon: '📡', label: 'API Reference' },
  { id: 'security',         icon: '🔒', label: 'Security' },
  { id: 'troubleshooting',  icon: '🔧', label: 'Troubleshooting' },
  { id: 'domain-migration', icon: '🌐', label: 'Domain Migration' },
]

// ── SystemPage ─────────────────────────────────────────────────────────────────

export default function SystemPage() {
  const { isDev, can } = usePermissions()
  const canManageSettings = can('settings', 'write')
  const [active, setActive] = useState<Section>('ai')

  // Only show sections the current user is allowed to see. Database needs
  // settings:write (it can switch the live transactional DB); Test Data needs
  // the is_dev flag (it wipes and re-seeds operational data).
  function sectionAllowed(s: SectionDef) {
    if (s.gate === 'admin') return canManageSettings
    if (s.gate === 'dev')   return isDev
    return true
  }
  const visibleSections = SECTIONS.filter(sectionAllowed)

  // If the user landed on a gated section but no longer has the permission
  // (e.g. role change or dev flag revoked mid-session), bounce them back to AI.
  useEffect(() => {
    const stillAllowed = SECTIONS.some(s => s.id === active && sectionAllowed(s))
    if (!stillAllowed) setActive('ai')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, isDev, canManageSettings])

  function renderContent() {
    switch (active) {
      case 'ai':               return <SettingsPage embedded initialTab="ai" />
      case 'audit-log':        return canManageSettings
                                  ? <AuditLogSection />
                                  : <GatedFallback reason="admin" />
      case 'storage':          return canManageSettings
                                  ? <SettingsPage embedded initialTab="storage" />
                                  : <GatedFallback reason="admin" />
      case 'database':         return canManageSettings
                                  ? <SettingsPage embedded initialTab="database" />
                                  : <GatedFallback reason="admin" />
      case 'test-data':        return isDev
                                  ? <SettingsPage embedded initialTab="test-data" />
                                  : <GatedFallback reason="dev" />
      case 'architecture':     return <ArchitectureSection />
      case 'api-reference':    return <ApiReferenceSection />
      case 'security':         return <SecuritySection />
      case 'troubleshooting':  return <TroubleshootingSection />
      case 'domain-migration': return <DomainMigrationSection />
      default:                 return null
    }
  }

  return (
    <div className="flex h-full">

      {/* ── Left secondary nav ──────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border bg-surface flex flex-col overflow-y-auto">
        <div className="px-4 pt-5 pb-3 border-b border-border">
          <h1 className="text-sm font-bold text-text-1">System</h1>
          <p className="text-xs text-text-3 mt-0.5">AI, architecture & ops</p>
        </div>

        <nav className="py-3 flex-1">
          {visibleSections.map(section => (
            <button
              key={section.id}
              onClick={() => setActive(section.id)}
              className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm font-medium transition-colors text-left
                ${active === section.id
                  ? 'bg-accent-dim text-accent font-semibold'
                  : 'text-text-2 hover:bg-surface-2 hover:text-text-1'
                }`}
            >
              <span className="text-base leading-none shrink-0">{section.icon}</span>
              <span className="flex-1">{section.label}</span>
              {section.gate === 'dev' && (
                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-purple-100 text-purple-700 leading-none">
                  DEV
                </span>
              )}
              {section.gate === 'admin' && (
                <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 leading-none">
                  ADMIN
                </span>
              )}
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

// ── Fallback shown if a user loses access mid-session ────────────────────────
function GatedFallback({ reason }: { reason: 'admin' | 'dev' }) {
  const copy = reason === 'dev'
    ? {
        title:   'Developer access required',
        body:    'This section is only visible to users with the dev flag enabled. An administrator can toggle it from Settings → Users.',
        ring:    'bg-purple-100',
        stroke:  '#7e22ce',
      }
    : {
        title:   'Admin access required',
        body:    'This section is only available to users with settings:write permission. Ask an administrator to grant your role the permission from Settings → Roles.',
        ring:    'bg-amber-100',
        stroke:  '#b45309',
      }
  return (
    <div className="flex-1 flex items-center justify-center p-10">
      <div className="max-w-md text-center">
        <div className={`w-12 h-12 rounded-full ${copy.ring} flex items-center justify-center mx-auto mb-3`}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={copy.stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
        <h2 className="text-base font-bold text-text-1 mb-1">{copy.title}</h2>
        <p className="text-sm text-text-3">{copy.body}</p>
      </div>
    </div>
  )
}
