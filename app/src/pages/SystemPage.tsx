import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react'
import SettingsPage from './SettingsPage'
import PosTesterPage from './PosTesterPage'
import BugsBacklogPage from './BugsBacklogPage'
import DocLibrary from '../components/DocLibrary'
import { usePermissions } from '../hooks/usePermissions'
import { useApi } from '../hooks/useApi'
import { Spinner } from '../components/ui'

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
            ['Database',      'PostgreSQL 16',                        '78 tables, all prefixed mcogs_'],
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
          <span className="text-[#6B7F74]"> (React SPA — https://cogs.macaroonie.com)</span>
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
        Production base URL: <Mono>https://cogs.macaroonie.com/api</Mono>
      </p>
      <p className="text-sm text-[#2D4A38] mb-3">
        Local dev base URL: <Mono>http://localhost:3001/api</Mono>
      </p>
      <InfoBox type="info" title="Authentication">
        Every request from the React SPA includes an Auth0 Bearer token via <Mono>useApi()</Mono>.
        The server verifies it by calling Auth0's <Mono>/userinfo</Mono> endpoint (5-min cache).
      </InfoBox>

      <p className="text-xs text-[#6B7F74] mb-2">53+ routes across all modules. Key groups shown below — full reference in CLAUDE.md section 9.</p>
      <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
        <thead><tr><Th>Method</Th><Th>Endpoint</Th><Th>Description</Th></tr></thead>
        <tbody>
          {([
            ['GET',    '/health',                          'Health check — returns {"status":"ok"}'],
            ['—',      '',                                 ''],
            ['CRUD',   '/settings',                        'System settings (JSONB blob)'],
            ['CRUD',   '/units',                           'Units of measurement'],
            ['CRUD',   '/price-levels',                    'Price levels (Dine In, Delivery, etc.)'],
            ['POST',   '/sync-exchange-rates',             'Sync rates from Frankfurter API (free, no key)'],
            ['CRUD',   '/countries',                       'Markets/countries with currency + exchange rate'],
            ['CRUD',   '/tax-rates',                       'Tax rates per country'],
            ['CRUD',   '/country-level-tax',               'Country × price level × tax rate mappings'],
            ['CRUD',   '/categories',                      'Categories (?for_ingredients=true / ?for_recipes=true)'],
            ['CRUD',   '/category-groups',                 'Category groups'],
            ['—',      '',                                 ''],
            ['CRUD',   '/vendors',                         'Supplier/vendor records'],
            ['CRUD',   '/ingredients',                     'Ingredient master list'],
            ['GET',    '/ingredients/stats',               'Lightweight counts for header badges'],
            ['CRUD',   '/price-quotes',                    'Vendor pricing per ingredient'],
            ['CRUD',   '/preferred-vendors',               'Preferred vendor per ingredient × country'],
            ['CRUD',   '/recipes',                         'Recipe definitions + items'],
            ['—',      '',                                 ''],
            ['CRUD',   '/sales-items',                     'Sales item catalog (recipe/ingredient/manual/combo)'],
            ['CRUD',   '/combos',                          'Standalone combos + steps + options'],
            ['CRUD',   '/combo-templates',                 'Reusable combo templates'],
            ['CRUD',   '/modifier-groups',                 'Modifier groups + options'],
            ['—',      '',                                 ''],
            ['CRUD',   '/menus',                           'Menu definitions per market'],
            ['CRUD',   '/menu-sales-items',                'Menu ↔ sales items link + per-menu prices'],
            ['CRUD',   '/scenarios',                       'Menu scenarios (qty/price/cost overrides)'],
            ['POST',   '/scenarios/push-prices',           'Push scenario price overrides to live menu'],
            ['POST',   '/scenarios/smart',                 'AI-powered price/cost proposals'],
            ['CRUD',   '/shared-pages',                    'Shared menu engineer pages (password-protected)'],
            ['GET',    '/cogs/menu-sales/:id',             'Calculate COGS for menu via sales items'],
            ['—',      '',                                 ''],
            ['CRUD',   '/allergens',                       'EU/UK FIC 14 allergens + per-ingredient statuses'],
            ['GET',    '/allergens/menu/:id',              'Allergen matrix for a full menu'],
            ['GET',    '/nutrition/search',                'USDA nutrition proxy (?q=)'],
            ['CRUD',   '/haccp/*',                         'Equipment, temp logs, CCP logs'],
            ['CRUD',   '/locations',                       'Physical store locations'],
            ['CRUD',   '/location-groups',                 'Location groupings'],
            ['CRUD',   '/brand-partners',                  'Brand/franchise partners'],
            ['—',      '',                                 ''],
            ['CRUD',   '/stock-stores',                    'Sub-locations within locations (centres)'],
            ['CRUD',   '/stock-levels',                    'Stock on hand, adjustments, movements'],
            ['CRUD',   '/purchase-orders',                 'PO lifecycle + line items'],
            ['CRUD',   '/goods-received',                  'GRN lifecycle → stock updates on confirm'],
            ['CRUD',   '/invoices',                        'Invoice lifecycle'],
            ['CRUD',   '/credit-notes',                    'Credit note lifecycle'],
            ['CRUD',   '/waste',                           'Waste logging + reason codes'],
            ['CRUD',   '/stock-transfers',                 'Inter-store stock transfers'],
            ['CRUD',   '/stocktakes',                      'Stocktake sessions + counts'],
            ['—',      '',                                 ''],
            ['CRUD',   '/bugs',                            'Bug tracker + comments'],
            ['CRUD',   '/backlog',                         'Feature backlog + comments'],
            ['GET',    '/audit',                           'Central audit log (filters, stats, field history)'],
            ['—',      '',                                 ''],
            ['POST',   '/ai-chat',                         'SSE streaming AI chat (92+ tools)'],
            ['POST',   '/ai-upload',                       'Multipart file + AI chat — SSE streaming'],
            ['GET',    '/ai-chat/my-usage',                'Current period token usage'],
            ['CRUD',   '/ai-config',                       'AI feature flag / API key config'],
            ['CRUD',   '/memory/notes',                    'Pepper memory — pinned notes'],
            ['CRUD',   '/memory/profile',                  'Pepper memory — user profile'],
            ['—',      '',                                 ''],
            ['POST',   '/import',                          'AI-powered data import (multipart)'],
            ['CRUD',   '/media',                           'Media library (local disk + S3)'],
            ['CRUD',   '/db-config',                       'Database management (local ↔ standalone)'],
            ['CRUD',   '/users',                           'User management (approve/disable/role)'],
            ['CRUD',   '/roles',                           'RBAC role + permission matrix'],
            ['POST',   '/feedback',                        'User feedback submissions'],
          ] as [string, string, string][]).map(([method, path, desc], idx) => (
            method === '—' ? (
              <tr key={`sep-${idx}`}><td colSpan={3} className="h-1 bg-[#F7F9F8]" /></tr>
            ) : (
              <tr key={method + path} className="hover:bg-[#F7F9F8]">
                <Td><MethodBadge method={method} /></Td>
                <Td mono>{path ? `/api${path}` : ''}</Td>
                <Td>{desc}</Td>
              </tr>
            )
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
        { label: 'User visits',        sub: 'cogs.macaroonie.com' },
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

      <H3>Known Bugs &amp; Backlog</H3>
      <div className="border border-[#D8E6DD] rounded-lg p-4 bg-white flex items-start gap-3">
        <span className="text-xl leading-none">🐛</span>
        <div>
          <p className="text-sm font-semibold text-[#0F1F17]">All known bugs and backlog items are tracked in the Bugs &amp; Backlog section.</p>
          <p className="text-xs text-[#6B7F74] mt-1">Click <strong>Bugs &amp; Backlog</strong> in the System sidebar to view, search, and comment on issues. 23 historical bug fixes and 9 backlog items were imported from the project documentation.</p>
        </div>
      </div>

      <H3>Frequently Asked Questions</H3>
      <div className="space-y-2">
        {[
          { q: "Why are my recipe COGS calculations showing £0.00?",       a: "An ingredient in the recipe has no active price quote for the selected market. Go to Inventory → Price Quotes, add an active quote, then optionally set a Preferred Vendor." },
          { q: "Menu sell prices show wrong currency or amount.",           a: "Check the market's exchange rate in Configuration → Currency. Use the Sync button to fetch live rates from Frankfurter API. All prices are stored in USD and converted to local currency using the exchange rate." },
          { q: 'The AI assistant says "API key not configured".',          a: 'Go to System → AI and enter your Anthropic API key (starts with sk-ant-…). Get one at console.anthropic.com.' },
          { q: 'Auth0 login is failing with a "callback URL mismatch".',   a: 'In Auth0 dashboard → Applications → Settings, ensure both https://cogs.macaroonie.com and http://localhost:5173 are in Allowed Callback URLs, Logout URLs, and Web Origins.' },
          { q: "I can't edit a bug or backlog item I created.",            a: "Only the original author or a developer can edit items. If you're the author but still blocked, check that your Auth0 user sub matches the reported_by / requested_by field. Ask an admin to check in Configuration → Users & Roles." },
          { q: 'The CI/CD deploy is failing at the health check step.',    a: 'SSH in and check: (1) pm2 status (2) curl http://localhost:3001/api/health (3) pm2 logs menu-cogs-api --lines 50 for startup errors.' },
          { q: 'Exchange rate sync is failing.',                           a: 'Test from the server: curl https://api.frankfurter.app/latest. If blocked, check AWS Lightsail outbound networking rules for port 443.' },
          { q: 'PM2 is not running. How do I restart it?',                 a: 'SSH as ubuntu. Run: cd /var/www/menu-cogs/api && pm2 start src/index.js --name menu-cogs-api. Then pm2 save to persist across reboots.' },
          { q: 'How do I run database migrations?',                        a: 'SSH as ubuntu. Run: cd /var/www/menu-cogs/api && npm run migrate. Migrations are idempotent (CREATE IF NOT EXISTS) — safe to run multiple times.' },
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
        <p className="text-white">curl https://cogs.macaroonie.com/api/health</p>
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
        The app currently runs at <Mono>cogs.macaroonie.com</Mono> (migrated from <Mono>obscurekitty.com</Mono> in April 2026).
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
          { n: '1', title: 'Add DNS A record',         cmd: 'nslookup cogs.macaroonie.com',                                                                                                                 detail: 'In the Lightsail DNS zone for your apex domain, add an A record: subdomain → server IP 13.135.158.196. Wait for propagation (1–5 min), then verify:' },
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
        Using a subdomain (e.g. <Mono>cogs.macaroonie.com</Mono>) is strongly recommended — it requires only an A record
        in the existing DNS zone. Moving to a different apex domain requires updating nameservers at the registrar.
      </InfoBox>
    </div>
  )
}

// ── Localization Section ──────────────────────────────────────────────────────

function LocalizationSection() {
  const checkSvg = (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#146A34" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  )
  return (
    <div className="p-6 max-w-4xl">
      <H2 icon="🌍" title="Localization" />
      <p className="text-sm text-[#2D4A38] leading-relaxed mb-4">
        Multi-language support for translating content and UI elements across all markets and languages.
        Each item below includes a summary of the planned approach and effort estimate.
      </p>

      {/* ── Language Support ── */}
      <div className="border border-[#D8E6DD] rounded-xl overflow-hidden my-5">
        {/* Header */}
        <div className="flex items-start gap-3 px-4 py-3 bg-white border-b border-[#D8E6DD]">
          <span className="text-2xl shrink-0 mt-0.5">🌍</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-bold text-[#0F1F17] text-base">Multi-Language Support</h3>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">PLANNED</span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#F7F9F8] text-[#6B7F74] border border-[#D8E6DD]">~16–19 days</span>
            </div>
            <p className="text-xs text-[#6B7F74] mt-1">
              Translate ingredient names, recipes, sales items, categories, and all customer-facing content into any language.
              Separate layer for UI localisation (buttons, labels, navigation).
            </p>
          </div>
        </div>

        {/* Two-layer summary */}
        <div className="grid grid-cols-2 divide-x divide-[#D8E6DD] bg-[#F7F9F8]">
          <div className="p-4">
            <p className="text-xs font-bold text-[#0F1F17] mb-2">Layer 1 — Content Translation</p>
            <p className="text-xs text-[#2D4A38] leading-relaxed mb-3">
              Per-entity translation tables store translated names and descriptions. A
              SQL <Mono>COALESCE</Mono> chain resolves the right language at query time —
              requested lang → country default → system default → base (English) column.
            </p>
            <div className="space-y-1">
              {[
                'Ingredients (name, notes)',
                'Recipes (name)',
                'Sales Items + Combos (name, display_name)',
                'Modifier Groups & Options',
                'Categories, Vendors, Menus',
                'Price Levels',
              ].map(item => (
                <div key={item} className="flex items-center gap-1.5 text-xs text-[#2D4A38]">
                  {checkSvg}
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="p-4">
            <p className="text-xs font-bold text-[#0F1F17] mb-2">Layer 2 — UI Localisation</p>
            <p className="text-xs text-[#2D4A38] leading-relaxed mb-3">
              Static app labels (buttons, headings, tooltips, error messages) are extracted
              into locale JSON files and loaded via <Mono>react-i18next</Mono>.
              Language switching persists in <Mono>localStorage</Mono> and applies immediately.
            </p>
            <div className="space-y-1">
              {[
                'react-i18next + i18next-http-backend',
                'Locale files per page namespace',
                'LanguageSwitcher in app header',
                'Settings → Localisation tab',
                'RTL layout variants (Arabic, Hebrew)',
                'Pilot: English + French',
              ].map(item => (
                <div key={item} className="flex items-center gap-1.5 text-xs text-[#2D4A38]">
                  {checkSvg}
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* DB schema preview */}
        <div className="px-4 py-3 border-t border-[#D8E6DD] bg-white">
          <p className="text-xs font-bold text-[#0F1F17] mb-2">New database tables</p>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { t: 'mcogs_languages',                     note: 'code, name, is_default, is_rtl' },
              { t: 'mcogs_ingredient_translations',        note: 'ingredient_id × language_code' },
              { t: 'mcogs_recipe_translations',            note: 'recipe_id × language_code' },
              { t: 'mcogs_sales_item_translations',        note: 'sales_item_id × language_code' },
              { t: 'mcogs_modifier_group_translations',    note: 'modifier_group_id × lang' },
              { t: 'mcogs_modifier_option_translations',   note: 'modifier_option_id × lang' },
              { t: 'mcogs_combo_step_translations',        note: 'combo_step_id × lang' },
              { t: 'mcogs_combo_step_option_translations', note: 'combo_step_option_id × lang' },
              { t: 'mcogs_category_translations',          note: 'category_id × language_code' },
              { t: 'mcogs_vendor_translations',            note: 'vendor_id × language_code' },
              { t: 'mcogs_price_level_translations',       note: 'price_level_id × lang' },
              { t: 'mcogs_menu_translations',              note: 'menu_id × language_code' },
            ].map(({ t, note }) => (
              <div key={t} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-1.5">
                <p className="font-mono text-[9px] font-semibold text-[#146A34] leading-snug">{t}</p>
                <p className="text-[9px] text-[#6B7F74] mt-0.5 leading-tight">{note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Build phases */}
        <div className="px-4 py-3 border-t border-[#D8E6DD] bg-[#F7F9F8]">
          <p className="text-xs font-bold text-[#0F1F17] mb-3">Implementation phases</p>
          <div className="space-y-2">
            {[
              { phase: '1', days: '3 days',   title: 'Foundation',         desc: 'mcogs_languages table + /api/languages CRUD + Settings → Localisation tab' },
              { phase: '2', days: '4 days',   title: 'Translation Tables', desc: '11 translation tables in migrate.js + sub-routes on each entity router' },
              { phase: '3', days: '4 days',   title: 'Backend Resolution', desc: 'resolveLanguage middleware + COALESCE queries on all entity GET endpoints' },
              { phase: '4', days: '4 days',   title: 'Frontend Wiring',   desc: 'X-Language header in useApi.ts + TranslationEditor component in detail panels' },
              { phase: '5', days: '4–5 days', title: 'UI Localisation',   desc: 'react-i18next setup + locale JSON files + LanguageSwitcher + RTL variants' },
            ].map(({ phase, days, title, desc }) => (
              <div key={phase} className="flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-[#146A34] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{phase}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#0F1F17]">{title}</span>
                    <span className="text-[10px] text-[#6B7F74] bg-white border border-[#D8E6DD] rounded px-1.5 py-0.5">{days}</span>
                  </div>
                  <p className="text-[11px] text-[#6B7F74] mt-0.5 leading-snug">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Open questions */}
        <div className="px-4 py-3 border-t border-[#D8E6DD] bg-white">
          <p className="text-xs font-bold text-[#0F1F17] mb-2">Design decisions to confirm before starting</p>
          <div className="space-y-1.5">
            {[
              { n: 1, q: 'Default language',        detail: 'English-only initially, or multi-language from day 1?' },
              { n: 2, q: 'Translation workflow',     detail: 'Manual admin entry, AI-assisted (Claude translates on save), or external CMS sync?' },
              { n: 3, q: 'Country ↔ language',       detail: 'Should each country have a default_language_code, or do users pick language per-session?' },
              { n: 4, q: 'Shared Link language',     detail: "Auto-resolve from recipient's country, or add ?lang= param to the share URL?" },
              { n: 5, q: 'RTL day-1 requirement',    detail: 'Arabic / Hebrew needed at launch, or deferred to a later phase?' },
              { n: 6, q: 'UI localisation scope',    detail: 'Full app (all 12 pages), or priority pages only (Menus, Sales Items, Inventory)?' },
            ].map(({ n, q, detail }) => (
              <div key={n} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold flex items-center justify-center mt-0.5">{n}</span>
                <div>
                  <span className="font-semibold text-[#0F1F17]">{q}</span>
                  <span className="text-[#6B7F74]"> — {detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer link */}
        <div className="px-4 py-2.5 border-t border-[#D8E6DD] bg-[#F7F9F8] flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7F74" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <p className="text-[11px] text-[#6B7F74]">
            Full specification: <Mono>docs/LANGUAGE_SUPPORT.md</Mono> in the repository
          </p>
        </div>
      </div>

      <InfoBox type="info" title="How to request implementation">
        To start implementation of any localization feature, open a work order and reference the
        specification document. Each item has a fully detailed technical plan ready to execute.
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

// ── CLAUDE.md viewer ──────────────────────────────────────────────────────────

function ClaudeDocSection() {
  const api = useApi()
  const [md, setMd]         = useState('')
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.get('/docs/claude-md')
        if (!cancelled) setMd((res as any)?.content ?? '')
      } catch { if (!cancelled) setMd('Failed to load CLAUDE.md') }
      finally   { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [api])

  // Simple markdown → JSX renderer
  const rendered = useMemo(() => {
    if (!md) return null
    let lines = md.split('\n')

    // Optional search filter: show only sections containing search term
    if (search.trim()) {
      const term = search.toLowerCase()
      // Group lines by h2 sections, keep sections that match
      const sections: string[][] = []
      let cur: string[] = []
      for (const line of lines) {
        if (line.startsWith('## ') && cur.length) { sections.push(cur); cur = [] }
        cur.push(line)
      }
      if (cur.length) sections.push(cur)
      const matched = sections.filter(s => s.some(l => l.toLowerCase().includes(term)))
      lines = matched.flat()
    }

    const elements: React.ReactNode[] = []
    let i = 0
    let inCode = false
    let codeBuf: string[] = []

    const inlineFormat = (text: string) => {
      // Bold, inline code, links
      return text
        .replace(/`([^`]+)`/g, '<code class="bg-[#F7F9F8] border border-[#D8E6DD] rounded px-1 py-0.5 text-[11px] font-mono text-[#2D4A38]">$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-accent underline">$1</a>')
    }

    while (i < lines.length) {
      const line = lines[i]

      // Fenced code block
      if (line.startsWith('```')) {
        if (!inCode) {
          inCode = true
          codeBuf = []
          i++; continue
        } else {
          inCode = false
          elements.push(
            <pre key={i} className="bg-[#1a1a2e] text-green-300 text-xs font-mono rounded-lg p-4 my-3 overflow-x-auto whitespace-pre">
              {codeBuf.join('\n')}
            </pre>
          )
          i++; continue
        }
      }
      if (inCode) { codeBuf.push(line); i++; continue }

      // Headings
      if (line.startsWith('### ')) {
        elements.push(<h3 key={i} className="font-bold text-[#0F1F17] mt-5 mb-2 text-sm">{line.slice(4)}</h3>)
        i++; continue
      }
      if (line.startsWith('## ')) {
        elements.push(
          <h2 key={i} className="text-lg font-bold text-[#0F1F17] mt-8 mb-3 pb-2 border-b-2 border-[#146A34]/20">
            {line.slice(3)}
          </h2>
        )
        i++; continue
      }
      if (line.startsWith('# ')) {
        elements.push(<h1 key={i} className="text-xl font-bold text-[#0F1F17] mt-6 mb-4">{line.slice(2)}</h1>)
        i++; continue
      }

      // Table (pipe-delimited)
      if (line.includes('|') && line.trim().startsWith('|')) {
        const tableRows: string[][] = []
        while (i < lines.length && lines[i].includes('|') && lines[i].trim().startsWith('|')) {
          const cells = lines[i].split('|').slice(1, -1).map(c => c.trim())
          // Skip separator rows (---|---)
          if (!cells.every(c => /^[-:]+$/.test(c))) tableRows.push(cells)
          i++
        }
        if (tableRows.length) {
          const [header, ...body] = tableRows
          elements.push(
            <div key={i} className="overflow-x-auto my-3">
              <table className="w-full text-sm border-collapse border border-[#D8E6DD] rounded">
                <thead>
                  <tr>{header.map((h, j) => <th key={j} className="py-2 px-3 text-xs font-bold text-[#6B7F74] text-left bg-[#F7F9F8] border-b border-[#D8E6DD]">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {body.map((row, ri) => (
                    <tr key={ri} className={ri % 2 ? 'bg-[#F7F9F8]' : ''}>
                      {row.map((cell, ci) => (
                        <td key={ci} className="py-2 px-3 border-b border-[#D8E6DD]/50 text-sm text-[#2D4A38]"
                            dangerouslySetInnerHTML={{ __html: inlineFormat(cell) }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        continue
      }

      // Unordered list
      if (/^[-*] /.test(line.trim())) {
        const items: string[] = []
        while (i < lines.length && /^[-*] /.test(lines[i].trim())) {
          items.push(lines[i].trim().slice(2))
          i++
        }
        elements.push(
          <ul key={i} className="list-disc list-inside my-2 space-y-1 text-sm text-[#2D4A38]">
            {items.map((item, j) => <li key={j} dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />)}
          </ul>
        )
        continue
      }

      // Blank line
      if (!line.trim()) { i++; continue }

      // Paragraph
      elements.push(
        <p key={i} className="text-sm text-[#2D4A38] my-2 leading-relaxed"
           dangerouslySetInnerHTML={{ __html: inlineFormat(line) }} />
      )
      i++
    }
    return elements
  }, [md, search])

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F1F17] flex items-center gap-2">
            <span>CLAUDE.md</span>
            <span className="text-xs font-normal text-text-3">Project documentation</span>
          </h2>
        </div>
        <input
          type="text"
          placeholder="Search sections..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input w-64 text-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-12 justify-center text-text-3">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
          Loading...
        </div>
      ) : (
        <div className="bg-white border border-[#D8E6DD] rounded-xl p-6 shadow-sm">
          {rendered}
        </div>
      )}
    </div>
  )
}

// ── Tests Section ────────────────────────────────────────────────────────────
// Triggers the GitHub Actions test.yml workflow and polls its status. Requires
// a configured GitHub PAT (Settings → AI → GitHub). Dev-only.

type TestRun = {
  id: number
  name?: string
  display_title?: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'action_required' | 'timed_out' | 'neutral' | null
  event: string
  head_branch: string
  head_sha: string
  actor?: string
  run_number: number
  run_attempt: number
  created_at: string
  updated_at: string
  run_started_at: string
  html_url: string
}

type TestJob = {
  id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: TestRun['conclusion']
  started_at: string | null
  completed_at: string | null
  html_url: string
}

type TestArtifact = {
  id: number
  name: string
  size_in_bytes: number
  expired: boolean
  created_at: string
  archive_download_url: string
}

function runBadge(run: Pick<TestRun, 'status' | 'conclusion'>) {
  if (run.status !== 'completed') {
    return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-blue-100 text-blue-700">⏳ {run.status.replace('_', ' ')}</span>
  }
  const c = run.conclusion
  if (c === 'success')   return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-green-100 text-green-700">✓ passed</span>
  if (c === 'failure' || c === 'timed_out') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700">✗ {c}</span>
  if (c === 'cancelled') return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">⊘ cancelled</span>
  if (c === 'skipped')   return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">skipped</span>
  return <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">{c || '—'}</span>
}

function formatDuration(start: string | null, end: string | null) {
  if (!start) return '—'
  const s = new Date(start).getTime()
  const e = end ? new Date(end).getTime() : Date.now()
  const secs = Math.max(0, Math.round((e - s) / 1000))
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60), r = secs % 60
  return r ? `${m}m ${r}s` : `${m}m`
}

function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 60)   return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60)   return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24)   return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function TestsSection() {
  const api = useApi()
  const [runs, setRuns]       = useState<TestRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [ref, setRef]         = useState('main')
  const [triggering, setTriggering] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [detail, setDetail]   = useState<Record<number, { jobs: TestJob[]; artifacts: TestArtifact[] }>>({})
  const [detailLoading, setDetailLoading] = useState<number | null>(null)

  const loadRuns = useCallback(async () => {
    try {
      const data = await api.get('/tests/runs?per_page=10') as TestRun[] | null
      setRuns(data || [])
      setError(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to load runs')
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { loadRuns() }, [loadRuns])

  // Auto-poll while any run is queued or in progress.
  const anyInFlight = useMemo(
    () => runs.some(r => r.status !== 'completed'),
    [runs]
  )
  useEffect(() => {
    if (!anyInFlight) return
    const t = setInterval(loadRuns, 10_000)
    return () => clearInterval(t)
  }, [anyInFlight, loadRuns])

  // Also refresh the currently-expanded run's detail while it's running.
  useEffect(() => {
    if (expandedId == null) return
    const run = runs.find(r => r.id === expandedId)
    if (!run || run.status === 'completed') return
    const t = setInterval(() => { loadDetail(expandedId, true) }, 10_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedId, runs])

  async function loadDetail(id: number, silent = false) {
    if (!silent) setDetailLoading(id)
    try {
      const d = await api.get(`/tests/runs/${id}`) as { run: TestRun; jobs: TestJob[]; artifacts: TestArtifact[] }
      setDetail(prev => ({ ...prev, [id]: { jobs: d.jobs, artifacts: d.artifacts } }))
    } catch (e: any) {
      if (!silent) setError(e?.message || 'Failed to load run detail')
    } finally {
      if (!silent) setDetailLoading(null)
    }
  }

  async function toggleExpand(id: number) {
    if (expandedId === id) { setExpandedId(null); return }
    setExpandedId(id)
    if (!detail[id]) await loadDetail(id)
  }

  async function triggerRun() {
    if (!ref.trim()) return
    setTriggering(true)
    setError(null)
    try {
      await api.post('/tests/run', { ref: ref.trim() })
      // Workflow_dispatch returns no run id, so poll a few times to pick up the
      // freshly queued run. GitHub usually surfaces it within 2–5 seconds.
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 1500))
        await loadRuns()
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to trigger run')
    } finally {
      setTriggering(false)
    }
  }

  if (loading) return <div className="p-6"><Spinner /></div>

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-text-1 flex items-center gap-2">
          <span className="text-xl">✅</span> Tests
        </h2>
        <p className="text-sm text-text-3 mt-1">
          Trigger the <code className="text-xs bg-surface-2 px-1 rounded">test.yml</code> workflow on GitHub Actions and watch its progress. Requires a GitHub PAT in System → AI → GitHub with <em>actions: write</em> scope.
        </p>
      </div>

      {error && (
        <div className="card p-3 bg-red-50 border-red-200 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Trigger bar */}
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-xs font-semibold text-text-2 mb-1">Branch / tag / SHA</label>
          <input
            className="input text-sm"
            value={ref}
            onChange={e => setRef(e.target.value)}
            placeholder="main"
            disabled={triggering}
          />
        </div>
        <button
          className="btn-primary text-sm px-4 py-2"
          onClick={triggerRun}
          disabled={triggering || !ref.trim()}
        >
          {triggering ? 'Triggering…' : '▶ Run tests'}
        </button>
        <button
          className="btn-ghost text-sm px-3 py-2"
          onClick={loadRuns}
          disabled={triggering}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Runs table */}
      <div className="card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-1">Recent runs</h3>
          {anyInFlight && <span className="text-xs text-text-3">Auto-refreshing every 10s</span>}
        </div>
        {runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-3">No runs yet. Trigger one above.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-3 bg-surface-2 border-b border-border">
                <th className="px-4 py-2 font-semibold">#</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold">Event</th>
                <th className="px-4 py-2 font-semibold">Branch / SHA</th>
                <th className="px-4 py-2 font-semibold">Actor</th>
                <th className="px-4 py-2 font-semibold">Started</th>
                <th className="px-4 py-2 font-semibold">Duration</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => {
                const expanded = expandedId === r.id
                const d = detail[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr
                      className={`border-b border-border hover:bg-surface-2 cursor-pointer ${expanded ? 'bg-surface-2' : ''}`}
                      onClick={() => toggleExpand(r.id)}
                    >
                      <td className="px-4 py-2 font-mono text-xs text-text-3">{r.run_number}{r.run_attempt > 1 ? `.${r.run_attempt}` : ''}</td>
                      <td className="px-4 py-2">{runBadge(r)}</td>
                      <td className="px-4 py-2 text-xs">{r.event}</td>
                      <td className="px-4 py-2 text-xs">
                        <span className="font-mono">{r.head_branch}</span>
                        <span className="text-text-3"> · {r.head_sha.slice(0, 7)}</span>
                      </td>
                      <td className="px-4 py-2 text-xs">{r.actor || '—'}</td>
                      <td className="px-4 py-2 text-xs text-text-3" title={r.run_started_at}>
                        {formatRelative(r.run_started_at)}
                      </td>
                      <td className="px-4 py-2 text-xs text-text-3">
                        {formatDuration(r.run_started_at, r.status === 'completed' ? r.updated_at : null)}
                      </td>
                      <td className="px-4 py-2 text-xs text-right">
                        <a
                          href={r.html_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="text-accent hover:underline"
                        >
                          GitHub ↗
                        </a>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-border bg-surface-2">
                        <td colSpan={8} className="px-4 py-4">
                          {detailLoading === r.id ? (
                            <Spinner />
                          ) : d ? (
                            <div className="space-y-3">
                              <div>
                                <div className="text-xs font-semibold text-text-2 mb-1.5">Jobs</div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {d.jobs.map(j => (
                                    <div key={j.id} className="flex items-center justify-between bg-surface px-3 py-1.5 rounded border border-border">
                                      <div className="flex items-center gap-2 min-w-0">
                                        {runBadge(j)}
                                        <span className="text-sm truncate">{j.name}</span>
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-text-3 shrink-0">
                                        <span>{formatDuration(j.started_at, j.completed_at)}</span>
                                        <a href={j.html_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">log ↗</a>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                              {d.artifacts.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold text-text-2 mb-1.5">Artifacts</div>
                                  <div className="flex flex-wrap gap-2">
                                    {d.artifacts.map(a => (
                                      <a
                                        key={a.id}
                                        href={r.html_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className={`text-xs px-2 py-1 rounded border ${a.expired ? 'text-text-3 border-border' : 'text-accent border-accent-dim hover:bg-accent-dim'}`}
                                        title={a.expired ? 'Expired' : `${(a.size_in_bytes / 1024).toFixed(0)} KB — download via GitHub run page`}
                                      >
                                        📦 {a.name}{a.expired ? ' (expired)' : ''}
                                      </a>
                                    ))}
                                  </div>
                                  <p className="text-[11px] text-text-3 mt-1.5">
                                    Artifact downloads require a GitHub login — click through to the run page.
                                  </p>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="text-xs text-text-3">No detail loaded.</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      <ApiBenchmarkPanel />

      <div className="card p-4 text-xs text-text-3 leading-relaxed">
        <strong className="text-text-2">Tip:</strong> E2E (Playwright) only runs on push to <code className="bg-surface-2 px-1 rounded">main</code> in the default CI config — a manual dispatch on any branch will execute typecheck, lint, api-test and app-test. Adjust <code className="bg-surface-2 px-1 rounded">.github/workflows/test.yml</code> if you want E2E on feature branches too.
      </div>
    </div>
  )
}

// ── ApiBenchmarkPanel — measure response times across read endpoints ─────────
//
// Issues a HEAD-like read across a config list of GET endpoints and records
// how long each call takes. Runs are issued sequentially by default to give a
// realistic single-user latency profile (parallel runs hit max-conn limits on
// pg, which would skew toward errors).
//
// Each endpoint has a soft threshold: under it = green ✓, 1-2× over = amber ⚠,
// > 2× over = red ✕. The total badge sums up everything.

interface BenchEndpoint {
  label:     string
  path:      string  // appended to /api
  threshold: number  // ms — soft target for "fast"
}

const BENCH_ENDPOINTS: BenchEndpoint[] = [
  { label: 'health',                path: '/health',                threshold: 50 },
  { label: '/me',                   path: '/me',                    threshold: 200 },
  { label: 'ingredients/stats',     path: '/ingredients/stats',     threshold: 200 },
  { label: 'ingredients (list)',    path: '/ingredients',           threshold: 800 },
  { label: 'recipes (list)',        path: '/recipes',               threshold: 800 },
  { label: 'menus (list)',          path: '/menus',                 threshold: 400 },
  { label: 'sales-items',           path: '/sales-items',           threshold: 800 },
  { label: 'price-quotes',          path: '/price-quotes',          threshold: 800 },
  { label: 'vendors',               path: '/vendors',               threshold: 300 },
  { label: 'countries',             path: '/countries',             threshold: 300 },
  { label: 'categories',            path: '/categories',            threshold: 300 },
  { label: 'units',                 path: '/units',                 threshold: 200 },
  { label: 'price-levels',          path: '/price-levels',          threshold: 200 },
  { label: 'backlog (50 rows)',     path: '/backlog?limit=50',      threshold: 600 },
  { label: 'bugs (50 rows)',        path: '/bugs?limit=50',         threshold: 600 },
  { label: 'audit (last 30)',       path: '/audit?limit=30',        threshold: 600 },
]

interface BenchResult {
  ms:       number
  status:   number
  bytes:    number | null
  error?:   string
}

// localStorage key for user-customised thresholds (per-endpoint ms target)
const BENCH_THRESHOLDS_KEY = 'cogs-bench-thresholds'

function loadCustomThresholds(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(BENCH_THRESHOLDS_KEY) || '{}') } catch { return {} }
}
function saveCustomThresholds(t: Record<string, number>) {
  try { localStorage.setItem(BENCH_THRESHOLDS_KEY, JSON.stringify(t)) } catch { /* ignore */ }
}

function ApiBenchmarkPanel() {
  const api = useApi()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, BenchResult | null>>({})
  const [iterations, setIterations] = useState(1)
  const [parallel, setParallel] = useState(false)
  // User-customised thresholds. Empty for an endpoint = use the default
  // baked-in soft target. Persisted per-browser.
  const [customThresholds, setCustomThresholds] = useState<Record<string, number>>(() => loadCustomThresholds())
  // Aborts a running batch — useful for the high-iteration mini-load tests.
  const cancelRef = useRef(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  // Cycle through endpoints. For multi-iteration runs we keep the latest
  // single-call timing per endpoint plus the running average — so the table
  // updates live as the run progresses.
  const [history, setHistory] = useState<Record<string, number[]>>({})

  // Resolved threshold for an endpoint (custom override OR baked-in default).
  function thresholdFor(path: string): number {
    return customThresholds[path] ?? BENCH_ENDPOINTS.find(e => e.path === path)?.threshold ?? 1000
  }

  async function callOnce(ep: BenchEndpoint): Promise<BenchResult> {
    const t0 = performance.now()
    try {
      const data = await api.get(ep.path)
      const ms    = Math.round(performance.now() - t0)
      const bytes = (() => { try { return JSON.stringify(data).length } catch { return null } })()
      return { ms, status: 200, bytes }
    } catch (e: any) {
      const ms = Math.round(performance.now() - t0)
      return { ms, status: e?.status ?? 0, bytes: null, error: e?.message || 'Request failed' }
    }
  }

  async function run() {
    setRunning(true)
    setResults({})
    setHistory({})
    cancelRef.current = false
    const total = iterations * BENCH_ENDPOINTS.length
    setProgress({ done: 0, total })
    let done = 0
    try {
      for (let it = 0; it < iterations; it++) {
        if (cancelRef.current) break
        const tasks = BENCH_ENDPOINTS.map(async ep => {
          if (cancelRef.current) return
          const r = await callOnce(ep)
          setResults(prev => ({ ...prev, [ep.path]: r }))
          setHistory(prev => ({ ...prev, [ep.path]: [...(prev[ep.path] || []), r.ms] }))
          done++
          setProgress({ done, total })
        })
        if (parallel) {
          await Promise.all(tasks)
        } else {
          for (const t of tasks) {
            if (cancelRef.current) break
            await t
          }
        }
      }
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  function stop() {
    cancelRef.current = true
  }

  // Set custom thresholds based on the current run averages × multiplier.
  // Useful to "calibrate to my actual stack" — accept whatever this server +
  // network combo gives you, then use deviations from that as the signal.
  function calibrateFromRun(multiplier = 1.5) {
    if (!confirm(`Replace all thresholds with the current avg × ${multiplier}? Endpoints with no data are left alone.`)) return
    const next = { ...customThresholds }
    for (const ep of BENCH_ENDPOINTS) {
      const arr = history[ep.path] || []
      if (arr.length === 0) continue
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length
      next[ep.path] = Math.round(avg * multiplier)
    }
    setCustomThresholds(next)
    saveCustomThresholds(next)
  }

  function resetThresholds() {
    if (!confirm('Reset all thresholds to defaults?')) return
    setCustomThresholds({})
    saveCustomThresholds({})
  }

  function setThreshold(path: string, ms: number) {
    const next = { ...customThresholds, [path]: ms }
    setCustomThresholds(next)
    saveCustomThresholds(next)
  }

  const total = useMemo(() => {
    let sum = 0
    let count = 0
    for (const ep of BENCH_ENDPOINTS) {
      const arr = history[ep.path] || []
      if (arr.length === 0) continue
      sum += arr.reduce((a, b) => a + b, 0)
      count += arr.length
    }
    return { sum, count, avg: count ? Math.round(sum / count) : 0 }
  }, [history])

  function bandClass(ms: number, threshold: number): string {
    if (ms <= threshold)      return 'text-emerald-600'
    if (ms <= threshold * 2)  return 'text-amber-600'
    return 'text-red-600'
  }

  function summaryFor(path: string, threshold: number) {
    const arr = history[path] || []
    if (arr.length === 0) return null
    const avg = Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
    const min = Math.min(...arr)
    const max = Math.max(...arr)
    return { avg, min, max, runs: arr.length, threshold }
  }

  const totalCalls = iterations * BENCH_ENDPOINTS.length
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-surface-2 flex items-center justify-between flex-wrap gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-text-1">API benchmark</h3>
          <p className="text-xs text-text-3 leading-snug">
            Read-only GET requests with per-endpoint soft thresholds.
            <strong className="text-text-2"> Thresholds are heuristics</strong> — your stack adds ~400-500ms fixed overhead
            (cross-region SSL + Auth0 + nginx + pg pool). Use <em>Calibrate</em> after a clean run to set
            realistic targets for your environment.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <label className="flex items-center gap-1 text-text-2">
            Iterations
            <select
              className="input text-xs py-0.5 px-1"
              value={iterations}
              onChange={e => setIterations(Number(e.target.value))}
              disabled={running}
            >
              {[1, 3, 5, 10, 25, 50, 100, 250].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1 text-text-2">
            <input type="checkbox" checked={parallel} onChange={e => setParallel(e.target.checked)} disabled={running} />
            Parallel
          </label>
          {!running ? (
            <button
              className="btn-primary text-xs px-3 py-1.5 disabled:opacity-50"
              onClick={run}
              title={`${totalCalls.toLocaleString()} requests total`}
            >▶ Run ({totalCalls.toLocaleString()} calls)</button>
          ) : (
            <button
              className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
              onClick={stop}
            >■ Stop</button>
          )}
          <button
            className="btn-outline text-xs px-2.5 py-1 disabled:opacity-50"
            onClick={() => calibrateFromRun(1.5)}
            disabled={running || Object.keys(history).length === 0}
            title="Set all thresholds to (current avg × 1.5) so the live response patterns become the baseline"
          >Calibrate (×1.5)</button>
          <button
            className="btn-ghost text-xs px-2 py-1 text-text-3"
            onClick={resetThresholds}
            disabled={running}
            title="Restore default thresholds"
          >Reset</button>
        </div>
      </div>

      {/* Progress bar — visible during a run */}
      {progress && (
        <div className="px-4 py-2 bg-accent-dim/30 border-b border-border flex items-center gap-3 text-xs">
          <div className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </div>
          <span className="font-mono text-text-3 shrink-0">
            {progress.done.toLocaleString()} / {progress.total.toLocaleString()}
          </span>
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-text-3 border-b border-border bg-surface-2/50">
            <th className="px-4 py-2 font-semibold">Endpoint</th>
            <th className="px-4 py-2 font-semibold text-right">Threshold</th>
            <th className="px-4 py-2 font-semibold text-right">Latest</th>
            <th className="px-4 py-2 font-semibold text-right">Avg</th>
            <th className="px-4 py-2 font-semibold text-right">Min / Max</th>
            <th className="px-4 py-2 font-semibold text-right">Runs</th>
            <th className="px-4 py-2 font-semibold text-right">Bytes</th>
            <th className="px-4 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {BENCH_ENDPOINTS.map(ep => {
            const r  = results[ep.path]
            const tr = thresholdFor(ep.path)
            const s  = summaryFor(ep.path, tr)
            const customised = customThresholds[ep.path] != null
            return (
              <tr key={ep.path} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <span className="font-mono text-xs text-text-2">{ep.path}</span>
                  <span className="ml-2 text-xs text-text-3">{ep.label}</span>
                </td>
                <td className="px-4 py-2 text-right text-xs">
                  <input
                    type="number"
                    min={1}
                    step={50}
                    className={`input text-xs py-0 px-1 w-20 text-right font-mono ${customised ? 'text-accent font-semibold' : 'text-text-3'}`}
                    value={tr}
                    onChange={e => setThreshold(ep.path, Math.max(1, Number(e.target.value) || 0))}
                    title={customised ? 'Custom threshold (click Reset to restore default)' : 'Default threshold — type a new value to override'}
                  />
                  <span className="ml-1 text-text-3">ms</span>
                </td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${r ? bandClass(r.ms, tr) : 'text-text-3'}`}>
                  {r ? `${r.ms} ms` : '—'}
                </td>
                <td className={`px-4 py-2 text-right font-mono text-xs ${s ? bandClass(s.avg, tr) : 'text-text-3'}`}>
                  {s ? `${s.avg} ms` : '—'}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs text-text-3">
                  {s ? `${s.min} / ${s.max}` : '—'}
                </td>
                <td className="px-4 py-2 text-right text-xs text-text-3">{s ? s.runs : '—'}</td>
                <td className="px-4 py-2 text-right text-xs text-text-3">
                  {r?.bytes != null ? `${(r.bytes / 1024).toFixed(1)} KB` : '—'}
                </td>
                <td className="px-4 py-2 text-xs">
                  {!r ? <span className="text-text-3">—</span>
                    : r.error ? <span className="text-red-600">✕ {r.error}</span>
                    : r.status === 200 ? <span className="text-emerald-600">✓ {r.status}</span>
                    : <span className="text-amber-600">⚠ {r.status}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-surface-2/50 text-xs">
            <td className="px-4 py-2 font-semibold text-text-2" colSpan={3}>
              Total: {total.count} call{total.count !== 1 ? 's' : ''} · {total.sum.toLocaleString()} ms
            </td>
            <td className="px-4 py-2 text-right font-mono font-semibold text-text-1">
              {total.avg ? `${total.avg} ms avg` : '—'}
            </td>
            <td colSpan={4} />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ── Jira Sync Section ─────────────────────────────────────────────────────────

function JiraSyncSection() {
  const api = useApi()
  const [status, setStatus] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [result, setResult] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/jira')
      setStatus(data)
    } catch { setStatus(null) }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-6"><Spinner /></div>

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-bold text-text-1 flex items-center gap-2">
          <span className="text-xl">🔗</span> Jira Sync
        </h2>
        <p className="text-sm text-text-3 mt-1">Sync bugs and backlog items with a Jira Cloud project.</p>
      </div>

      {!status?.configured ? (
        <div className="card p-6 text-center space-y-3">
          <div className="text-4xl">⚙️</div>
          <h3 className="font-semibold text-text-1">Not Configured</h3>
          <p className="text-sm text-text-3 max-w-md mx-auto">
            Set up your Jira credentials in <strong>System → AI → Jira Integration</strong> to enable two-way sync between COGS and your Jira board.
          </p>
        </div>
      ) : (
        <>
          {/* Status cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4">
              <div className="text-xs text-text-3 mb-1">Project</div>
              <div className="text-lg font-bold font-mono text-accent">{status.projectKey}</div>
              <div className="text-[10px] text-text-3 mt-1 truncate">{status.baseUrl}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-text-3 mb-1">Linked Bugs</div>
              <div className="text-lg font-bold text-text-1">{status.linkedBugs}</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-text-3 mb-1">Linked Backlog</div>
              <div className="text-lg font-bold text-text-1">{status.linkedBacklog}</div>
            </div>
          </div>

          {/* Bulk actions */}
          <div className="card p-5 space-y-4">
            <h3 className="font-semibold text-text-1 text-sm">Bulk Operations</h3>

            <div className="flex flex-wrap gap-3">
              <button className="btn-primary text-sm px-4 py-2" disabled={!!syncing}
                onClick={async () => {
                  setSyncing('push-all')
                  try {
                    // Fetch all unlinked items
                    const [bugsData, backlogData] = await Promise.all([
                      api.get('/bugs?limit=500'),
                      api.get('/backlog?limit=500'),
                    ])
                    const bugIds = (bugsData?.rows || []).filter((b: any) => !b.jira_key).map((b: any) => b.id)
                    const backlogIds = (backlogData?.rows || []).filter((b: any) => !b.jira_key).map((b: any) => b.id)
                    if (!bugIds.length && !backlogIds.length) {
                      setResult({ message: 'Everything is already linked to Jira', type: 'success' })
                      return
                    }
                    const r = await api.post('/jira/push/bulk', { bugs: bugIds, backlog: backlogIds })
                    setResult({ message: `Pushed ${r.pushed} items${r.errors?.length ? ` (${r.errors.length} errors)` : ''}`, type: r.errors?.length ? 'error' : 'success' })
                    load()
                  } catch { setResult({ message: 'Bulk push failed', type: 'error' }) }
                  finally { setSyncing(null) }
                }}>
                {syncing === 'push-all' ? 'Pushing…' : '↑ Push All Unlinked to Jira'}
              </button>

              <button className="btn-outline text-sm px-4 py-2" disabled={!!syncing}
                onClick={async () => {
                  setSyncing('pull-all')
                  try {
                    const r = await api.post('/jira/pull/all')
                    setResult({ message: `Pulled ${r.pulled} items${r.errors?.length ? ` (${r.errors.length} errors)` : ''}`, type: r.errors?.length ? 'error' : 'success' })
                    load()
                  } catch { setResult({ message: 'Bulk pull failed', type: 'error' }) }
                  finally { setSyncing(null) }
                }}>
                {syncing === 'pull-all' ? 'Pulling…' : '↓ Pull All from Jira'}
              </button>
            </div>

            {result && (
              <div className={`text-sm px-3 py-2 rounded ${result.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {result.type === 'success' ? '✓' : '✗'} {result.message}
              </div>
            )}
          </div>

          {/* Mapping reference */}
          <div className="card p-5 space-y-3">
            <h3 className="font-semibold text-text-1 text-sm">Status Mapping</h3>
            <div className="grid grid-cols-2 gap-6 text-xs">
              <div>
                <div className="font-medium text-text-2 mb-2">Bugs</div>
                <table className="w-full">
                  <tbody>
                    {[['open', 'To Do'], ['in_progress', 'In Progress'], ['resolved', 'Done'], ['closed', 'Done'], ['wont_fix', "Won't Do"]].map(([cogs, jira]) => (
                      <tr key={cogs} className="border-b border-border/30">
                        <td className="py-1 font-mono text-text-2">{cogs}</td>
                        <td className="py-1 text-text-3">→</td>
                        <td className="py-1 text-text-2">{jira}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div className="font-medium text-text-2 mb-2">Backlog</div>
                <table className="w-full">
                  <tbody>
                    {[['backlog', 'Backlog'], ['todo', 'To Do'], ['in_progress', 'In Progress'], ['in_review', 'In Review'], ['done', 'Done'], ['wont_do', "Won't Do"]].map(([cogs, jira]) => (
                      <tr key={cogs} className="border-b border-border/30">
                        <td className="py-1 font-mono text-text-2">{cogs}</td>
                        <td className="py-1 text-text-3">→</td>
                        <td className="py-1 text-text-2">{jira}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Section definitions ────────────────────────────────────────────────────────

type Section =
  | 'ai'
  | 'bugs-backlog'   // Bugs & Backlog tracker
  | 'jira'           // Jira sync dashboard — admin-only
  | 'audit-log'      // Central audit trail — admin-only
  | 'storage'        // Media storage config (local vs S3) — admin-only
  | 'database'       // DB connection config (local vs standalone/AWS RDS) — admin-only
  | 'test-data'      // Seeding + clearing dummy data — dev-only, date-confirmed
  | 'tests'          // In-app CI test runner (dispatches test.yml) — dev-only
  | 'architecture'
  | 'api-reference'
  | 'security'
  | 'troubleshooting'
  | 'domain-migration'
  | 'doc-library'
  | 'pos-tester'
  | 'localization'
  | 'claude-doc'

interface SectionDef {
  id:        Section
  icon:      string
  label:     string
  /** Permission level required: 'admin' = settings:write, 'dev' = is_dev flag. Omit for public. */
  gate?:     'admin' | 'dev'
  /** If true, this section is a documentation/reference page (rendered below separator). */
  isDoc?:    boolean
}

const SECTIONS: SectionDef[] = [
  // ── Functional sections ──
  { id: 'ai',               icon: '🤖', label: 'AI & Integrations' },
  { id: 'bugs-backlog',     icon: '🐛', label: 'Bugs & Backlog' },
  { id: 'jira',             icon: '🔗', label: 'Jira Sync',        gate: 'admin' },
  { id: 'audit-log',        icon: '📋', label: 'Audit Log',        gate: 'admin' },
  { id: 'storage',          icon: '☁️', label: 'Storage',           gate: 'admin' },
  { id: 'database',         icon: '🗄️', label: 'Database',         gate: 'admin' },
  { id: 'test-data',        icon: '🧪', label: 'Test Data',        gate: 'dev'   },
  { id: 'tests',            icon: '✅', label: 'Tests',            gate: 'dev'   },
  { id: 'doc-library',      icon: '📄', label: 'Doc Library' },
  { id: 'pos-tester',       icon: '🏪', label: 'POS Mockup' },
  // ── Documentation / reference ──
  { id: 'localization',     icon: '🌍', label: 'Localization',     isDoc: true },
  { id: 'architecture',     icon: '🏗️', label: 'Architecture',     isDoc: true },
  { id: 'api-reference',    icon: '📡', label: 'API Reference',    isDoc: true },
  { id: 'security',         icon: '🔒', label: 'Security',         isDoc: true },
  { id: 'troubleshooting',  icon: '🔧', label: 'Troubleshooting',  isDoc: true },
  { id: 'domain-migration', icon: '🌐', label: 'Domain Migration', isDoc: true },
  { id: 'claude-doc',       icon: '📄', label: 'CLAUDE.md',       gate: 'dev', isDoc: true },
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
      case 'bugs-backlog':     return <BugsBacklogPage embedded />
      case 'jira':             return canManageSettings
                                  ? <JiraSyncSection />
                                  : <GatedFallback reason="admin" />
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
      case 'tests':            return isDev
                                  ? <TestsSection />
                                  : <GatedFallback reason="dev" />
      case 'architecture':     return <ArchitectureSection />
      case 'api-reference':    return <ApiReferenceSection />
      case 'security':         return <SecuritySection />
      case 'troubleshooting':  return <TroubleshootingSection />
      case 'domain-migration': return <DomainMigrationSection />
      case 'doc-library':      return <DocLibrary location="system" />
      case 'pos-tester':       return <PosTesterPage />
      case 'localization':    return <LocalizationSection />
      case 'claude-doc':       return isDev
                                  ? <ClaudeDocSection />
                                  : <GatedFallback reason="dev" />
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
          {(() => {
            const functional = visibleSections.filter(s => !s.isDoc)
            const docs       = visibleSections.filter(s =>  s.isDoc)
            const renderBtn  = (section: SectionDef) => (
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
            )
            return (
              <>
                {functional.map(renderBtn)}
                {docs.length > 0 && (
                  <div className="mx-4 my-2 border-t border-border">
                    <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wider mt-2 mb-0.5 px-0">Documentation</p>
                  </div>
                )}
                {docs.map(renderBtn)}
              </>
            )
          })()}
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
        body:    'This section is only visible to users with the dev flag enabled. An administrator can toggle it from Configuration → Users & Roles.',
        ring:    'bg-purple-100',
        stroke:  '#7e22ce',
      }
    : {
        title:   'Admin access required',
        body:    'This section is only available to users with settings:write permission. Ask an administrator to grant your role the permission from Configuration → Users & Roles.',
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
