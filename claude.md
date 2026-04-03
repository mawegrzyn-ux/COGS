# COGS Manager

**Menu cost-of-goods calculator for restaurant franchise operators.**

Migrated from a WordPress plugin (v3.3.0) to a modern React + Node.js + PostgreSQL full-stack application. Gives franchise operators accurate, real-time food cost visibility across menus, recipes, ingredients, and vendor pricing by market/country.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Repository Structure](#3-repository-structure)
4. [Infrastructure & Hosting](#4-infrastructure--hosting)
5. [Local Development Setup](#5-local-development-setup)
6. [CI/CD Pipeline](#6-cicd-pipeline)
7. [Auth0 Configuration](#7-auth0-configuration)
8. [Database Schema](#8-database-schema)
9. [API Routes Reference](#9-api-routes-reference)
10. [Frontend Architecture](#10-frontend-architecture)
11. [Design System & Conventions](#11-design-system--conventions)
12. [Pages Built](#12-pages-built)
13. [Pages Remaining to Build](#13-pages-remaining-to-build)
14. [Pepper AI Assistant](#14-pepper-ai-assistant)
15. [RBAC — Role-Based Access Control](#15-rbac--role-based-access-control)
16. [Known Bugs Fixed](#16-known-bugs-fixed)
17. [Critical Gotchas & Lessons Learned](#17-critical-gotchas--lessons-learned)
18. [Backlog](#18-backlog)
19. [Domain Migration Log](#19-domain-migration-log)
20. [Key Contacts & Resources](#20-key-contacts--resources)

---

## 1. Project Overview

| Field | Value |
|---|---|
| **App** | Menu COGS Calculator |
| **Origin** | WordPress plugin v3.3.0 — migrated to React/Node/PostgreSQL |
| **Server** | AWS Lightsail instance "WRI" — Ubuntu 24.04, $10/mo, 2GB RAM, 1 vCPU |
| **IP** | `13.135.158.196` (static) |
| **Domain** | `cogs.flavorconnect.tech` |
| **SSL** | Let's Encrypt via Certbot — auto-renews |
| **Web Server** | Nginx (reverse proxy → Node API on port 3001) |
| **Process Manager** | PM2 running as `ubuntu` user (process name: `menu-cogs-api`) |
| **Auth** | Auth0 — tenant: `obscurekitty.uk.auth0.com` |
| **Database** | PostgreSQL 16 — database: `mcogs`, 25 tables (all prefixed `mcogs_`) |
| **CI/CD** | GitHub Actions — push to `main` → build → deploy → health check |
| **Repo** | `github.com/mawegrzyn-ux/COGS` |

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| **Frontend** | React 18 + Vite + TypeScript + Tailwind CSS 3 | SPA, no SSR |
| **API** | Node.js + Express | REST, no GraphQL |
| **Database** | PostgreSQL 16 | All tables prefixed `mcogs_` |
| **Auth** | Auth0 SPA (`@auth0/auth0-react`) | Username/password + Google OAuth |
| **Hosting** | AWS Lightsail | Single instance (all services on one box) |
| **CI/CD** | GitHub Actions | Push to `main` auto-deploys |
| **Font** | Nunito (Google Fonts) | Matches original WP plugin |
| **Design** | Deep forest green (`#146A34`) | Matches original WP plugin |

---

## 3. Repository Structure

```
COGS/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Actions CI/CD pipeline
│
├── app/                            # React frontend (Vite + TypeScript)
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx                # Entry — Auth0Provider wrapper
│       ├── App.tsx                 # Router + ProtectedRoute
│       ├── index.css               # Tailwind + CSS design tokens
│       ├── config/
│       │   └── auth0.ts            # Auth0 config from env vars
│       ├── hooks/
│       │   ├── useApi.ts           # Auth0-aware API fetch hook ← CRITICAL
│       │   └── useSortFilter.ts    # Sort + multi-select filter hook
│       ├── components/
│       │   ├── AppLayout.tsx       # Main layout shell (sidebar + outlet)
│       │   ├── Sidebar.tsx         # Collapsible left nav
│       │   ├── Logo.tsx            # SVG logo component
│       │   ├── LoadingScreen.tsx   # Auth0 loading spinner
│       │   ├── DataGrid.tsx        # Generic sortable/filterable grid
│       │   ├── ColumnHeader.tsx    # Sort + multi-select filter dropdown
│       │   ├── AiChat.tsx          # Pepper AI chat panel (SSE streaming)
│       │   └── ui.tsx              # Shared UI: PageHeader, Modal, Field,
│       │                           #   EmptyState, Spinner, ConfirmDialog,
│       │                           #   Toast, Badge
│       └── pages/
│           ├── LoginPage.tsx
│           ├── DashboardPage.tsx   # KPI tiles, coverage, recent quotes
│           ├── SettingsPage.tsx    # Units, Price Levels, Exchange Rates
│           ├── CountriesPage.tsx   # Countries + currencies + tax rates
│           ├── CategoriesPage.tsx  # Ingredient/recipe categories
│           ├── InventoryPage.tsx   # Ingredients, vendors, price quotes
│           ├── RecipesPage.tsx     # Recipe builder with COGS calculation
│           ├── MenusPage.tsx       # Menu builder (Menus/Menu Engineer/Compare Markets/Market Price Tool tabs)
│           ├── ImportPage.tsx      # AI-powered data import wizard
│           ├── AllergenMatrixPage.tsx  # Allergen matrix (EU/UK FIC 14)
│           ├── HACCPPage.tsx       # HACCP temp logs & CCP logs
│           ├── MarketsPage.tsx     # Markets (countries) + brand partners
│           └── HelpPage.tsx        # Help & documentation
│
├── api/                            # Node.js/Express API
│   ├── package.json
│   ├── .env                        # NOT in git — see env vars section
│   └── src/
│       ├── index.js                # Express entry point
│       ├── helpers/
│       │   └── agenticStream.js    # Shared SSE agentic loop (ai-chat + ai-upload)
│       └── routes/
│           ├── index.js            # Route registry
│           ├── health.js
│           ├── settings.js
│           ├── units.js
│           ├── price-levels.js
│           ├── sync-exchange-rates.js
│           ├── countries.js
│           ├── tax-rates.js
│           ├── country-level-tax.js
│           ├── categories.js
│           ├── vendors.js
│           ├── brand-partners.js   # Brand partners CRUD
│           ├── ingredients.js
│           ├── price-quotes.js
│           ├── preferred-vendors.js
│           ├── recipes.js
│           ├── menus.js
│           ├── menu-items.js
│           ├── menu-item-prices.js
│           ├── cogs.js
│           ├── allergens.js
│           ├── nutrition.js        # USDA nutrition proxy
│           ├── haccp.js
│           ├── locations.js
│           ├── location-groups.js
│           ├── import.js           # AI import pipeline — exports { router, stageFileContent }
│           ├── ai-chat.js          # Pepper AI chat (74 tools)
│           ├── ai-upload.js        # File upload → AI extraction (multipart)
│           ├── ai-config.js        # AI feature flag / config
│           ├── feedback.js
│           └── internal-feedback.js
│
└── api/scripts/
    ├── migrate.js                  # DB schema migration (npm run migrate)
    └── import-data.js              # WP data import script
```

---

## 4. Infrastructure & Hosting

### Server

- **Provider:** AWS Lightsail — instance named "WRI"
- **OS:** Ubuntu 24.04 LTS
- **Specs:** 2GB RAM, 1 vCPU, $10/mo (dev/staging tier)
- **All services run on one box:** Nginx → Node API → PostgreSQL

### Key Server Commands

```bash
# Process management
pm2 status                          # Check API is running
pm2 restart menu-cogs-api           # Restart Node API
pm2 logs menu-cogs-api --lines 50   # View recent API logs

# Web server
sudo nginx -s reload                # Reload Nginx config (after changes)
sudo nginx -t                       # Test Nginx config

# Code
cd /var/www/menu-cogs && git pull   # Pull latest code manually
cd /var/www/menu-cogs/api && npm install --production   # Install API deps
cd /var/www/menu-cogs/api && npm run migrate            # Run DB migration

# Database
psql -U mcogs -d mcogs              # Connect to PostgreSQL
```

### Important File Locations on Server

| Path | Description |
|---|---|
| `/var/www/menu-cogs/` | App root (git repo) |
| `/var/www/menu-cogs/api/` | Node.js API |
| `/var/www/menu-cogs/api/.env` | API environment variables (DB password etc.) |
| `/var/www/menu-cogs/frontend/` | React build output (served by Nginx) |
| `/etc/nginx/sites-available/menu-cogs` | Nginx site config |
| `/etc/letsencrypt/live/cogs.flavorconnect.tech/` | SSL certificate files |
| `~/.ssh/id_ed25519_cogs` | Deploy SSH key (read-only pull from GitHub) |
| `~/.ssh/config` | SSH config (routes `github.com` to the correct key) |

### API `.env` File (on server at `/var/www/menu-cogs/api/.env`)

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mcogs
DB_USER=mcogs
DB_PASSWORD=<generated strong password — check server>
NODE_ENV=production
PORT=3001
```

---

## 5. Local Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16 running locally
- A local `.env` file in `api/`

### Clone & Install

```bash
git clone git@github.com:mawegrzyn-ux/COGS.git
cd COGS

# Install API dependencies
cd api && npm install

# Install frontend dependencies
cd ../app && npm install
```

### Configure Environment

**`api/.env`** (create locally):
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mcogs
DB_USER=postgres
DB_PASSWORD=yourpassword
NODE_ENV=development
PORT=3001
```

**`app/.env.local`** (create from `.env.example`):
```env
VITE_AUTH0_DOMAIN=obscurekitty.uk.auth0.com
VITE_AUTH0_CLIENT_ID=B7JlaVzsljdFDCX7BkbofYYA2bCsTc69
VITE_AUTH0_AUDIENCE=
VITE_API_URL=http://localhost:3001/api
```

### Run Database Migration

```bash
cd api && npm run migrate
# Creates all mcogs_ tables — safe to run multiple times
```

### Start Development Servers

```bash
# Terminal 1 — API (port 3001)
cd api && npm run dev

# Terminal 2 — Frontend (port 5173, proxies /api to port 3001)
cd app && npm run dev
```

Open `http://localhost:5173` — Auth0 login will redirect to `localhost` callback.

> **Note:** Auth0 requires the callback URL `http://localhost:5173` to be in the **Allowed Callback URLs** list in the Auth0 dashboard. Add it alongside `https://cogs.flavorconnect.tech`.

---

## 6. CI/CD Pipeline

Every push to `main` triggers `.github/workflows/deploy.yml` automatically.

### Pipeline Steps

1. Checkout code
2. Install frontend npm dependencies (`app/`)
3. Build React app with Vite — env vars baked in from GitHub Secrets
4. SCP `app/dist/` to `/var/www/menu-cogs/frontend/` on server
5. SSH into server: `git pull` → `npm install` → `pm2 restart` → `nginx reload`
6. Health check: `GET https://cogs.flavorconnect.tech/api/health` must return `{"status":"ok"}`

### GitHub Secrets Required

| Secret | Value |
|---|---|
| `LIGHTSAIL_HOST` | `cogs.flavorconnect.tech` |
| `LIGHTSAIL_USER` | `ubuntu` |
| `LIGHTSAIL_SSH_KEY` | Full private SSH key content (including `-----BEGIN OPENSSH PRIVATE KEY-----`) |
| `VITE_API_URL` | `https://cogs.flavorconnect.tech/api` |
| `VITE_AUTH0_DOMAIN` | `obscurekitty.uk.auth0.com` |
| `VITE_AUTH0_CLIENT_ID` | `B7JlaVzsljdFDCX7BkbofYYA2bCsTc69` |

### ⚠️ Critical CI/CD Rules

- **`VITE_API_URL` must be the full secret reference** — `${{ secrets.VITE_API_URL }}` — never hardcode `http://` prefix. This was the cause of a major bug (1,252+ blocked requests).
- **`LIGHTSAIL_USER` must be `ubuntu`** — not `mcogs` (old PM2 user from early setup).
- **Health check uses `https://`** — ensure the curl command in deploy.yml uses HTTPS.

---

## 7. Auth0 Configuration

| Setting | Value |
|---|---|
| **Tenant** | `obscurekitty.uk.auth0.com` |
| **Application type** | Single Page Application (SPA) |
| **Client ID** | `B7JlaVzsljdFDCX7BkbofYYA2bCsTc69` |
| **Allowed Callback URLs** | `https://cogs.flavorconnect.tech`, `http://localhost:5173` |
| **Allowed Logout URLs** | `https://cogs.flavorconnect.tech/login`, `http://localhost:5173/login` |
| **Allowed Web Origins** | `https://cogs.flavorconnect.tech`, `http://localhost:5173` |
| **Audience** | Empty — add later if API token validation is needed |
| **Login methods** | Username/password + Google OAuth |

> **Auth0 requires HTTPS in production.** It will throw "must run on a secure origin" on plain HTTP. SSL (Let's Encrypt) must be configured before Auth0 works on the server.

---

## 8. Database Schema

PostgreSQL 16, database name: `mcogs`. All tables prefixed `mcogs_`. Run migration with:

```bash
cd api && npm run migrate
```

Safe to run multiple times (uses `CREATE TABLE IF NOT EXISTS`).

### Tables

| # | Table | Purpose |
|---|---|---|
| 1 | `mcogs_units` | Measurement units (kg, litre, each, etc.) |
| 2 | `mcogs_price_levels` | Price levels (Eat-in, Takeout, Delivery) |
| 3 | `mcogs_countries` | Countries with currency codes, symbols, exchange rates, default price level |
| 4 | `mcogs_country_tax_rates` | Tax rates per country (e.g. UK VAT 20%) |
| 5 | `mcogs_country_level_tax` | Junction: which tax rate applies to which price level per country |
| 6 | `mcogs_categories` | Ingredient/recipe categories with group_name and type (`ingredient`/`recipe`) |
| 7 | `mcogs_vendors` | Suppliers/vendors, linked to a country |
| 8 | `mcogs_ingredients` | Ingredient master list with base unit, waste %, prep conversion |
| 9 | `mcogs_price_quotes` | Vendor pricing per ingredient: purchase price, qty, unit, active flag |
| 10 | `mcogs_ingredient_preferred_vendor` | Per ingredient+country: which vendor+quote is preferred |
| 11 | `mcogs_recipes` | Recipe definitions with yield qty and yield unit |
| 12 | `mcogs_recipe_items` | Recipe line items: ingredient or sub-recipe, `prep_qty`, prep unit, conversion |
| 13 | `mcogs_menus` | Menu definitions, linked to a country |
| 14 | `mcogs_menu_items` | Menu line items: recipe or ingredient, display name, sort order, allergen_notes |
| 15 | `mcogs_menu_item_prices` | Sell prices per menu item per price level, with tax rate |
| 16 | `mcogs_locations` | Physical store locations — linked to market, optional group, address, contact details |
| 17 | `mcogs_location_groups` | Clusters of locations (e.g. "London Central") — optional grouping |
| 18 | `mcogs_allergens` | EU/UK FIC reference allergens (14 regulated) |
| 19 | `mcogs_ingredient_allergens` | Junction: allergen status per ingredient (contains/may_contain/free_from) |
| 20 | `mcogs_equipment` | HACCP equipment register — linked to location |
| 21 | `mcogs_equipment_temp_logs` | Temperature readings per equipment |
| 22 | `mcogs_ccp_logs` | CCP logs (cooking/cooling/delivery) — linked to location |
| 23 | `mcogs_brand_partners` | Brand/franchise partners (e.g. "McDonald's UK") — linked to markets |
| 24 | `mcogs_import_jobs` | AI import staging jobs: raw AI output, enriched rows, status, created_by |
| 25 | `mcogs_ai_chat_log` | Pepper AI conversation log: messages, tools_called, token counts, context JSONB |
| 26 | `mcogs_roles` | RBAC roles (Admin/Operator/Viewer + custom). `is_system` protects built-in roles |
| 27 | `mcogs_role_permissions` | Permission level per role per feature: `none` / `read` / `write`. UNIQUE(role_id, feature) |
| 28 | `mcogs_users` | App users mapped from Auth0 sub. Stores status (`pending`/`active`/`disabled`), role, last login |
| 29 | `mcogs_user_brand_partners` | Market scope: which brand partners a user is allowed to see. Empty = unrestricted |

### Key Schema Details

**`mcogs_countries`**
```sql
id, name, currency_code, currency_symbol, exchange_rate (vs USD base),
default_price_level_id → mcogs_price_levels
```

**`mcogs_ingredients`**
```sql
id, name, category (string — denormalised), base_unit_id,
default_prep_unit, default_prep_to_base_conversion,
waste_pct (0–100), notes, image_url, allergen_notes TEXT
```

**`mcogs_price_quotes`**
```sql
id, ingredient_id, vendor_id, purchase_price, qty_in_base_units,
purchase_unit, is_active, vendor_product_code
```

**`mcogs_ingredient_preferred_vendor`**
```sql
UNIQUE(ingredient_id, country_id)
-- One preferred vendor per ingredient per country
```

**`mcogs_recipe_items`**
```sql
item_type: 'ingredient' | 'recipe'   -- supports sub-recipes
-- CHECK constraint ensures only one of ingredient_id/recipe_item_id is set
```

**`mcogs_categories`**
```sql
group_name VARCHAR(100) -- currently flat string (e.g. 'Dairy', 'Produce')
-- Planned migration: separate mcogs_category_groups table with parent_id
```

### Indexes

```sql
idx_price_quotes_ingredient   ON mcogs_price_quotes(ingredient_id)
idx_price_quotes_vendor        ON mcogs_price_quotes(vendor_id)
idx_recipe_items_recipe        ON mcogs_recipe_items(recipe_id)
idx_menu_items_menu            ON mcogs_menu_items(menu_id)
idx_vendors_country            ON mcogs_vendors(country_id)
idx_ingredients_category       ON mcogs_ingredients(category)
idx_recipes_category           ON mcogs_recipes(category)
idx_country_tax_country        ON mcogs_country_tax_rates(country_id)
idx_pref_vendor_ingredient     ON mcogs_ingredient_preferred_vendor(ingredient_id)
```

---

## 9. API Routes Reference

Base path: `/api`

All routes registered in `api/src/routes/index.js`.

| Route | File | Status |
|---|---|---|
| `GET /api/health` | `health.js` | ✅ Active — public, no auth |
| `GET /api/me` | `me.js` | ✅ Active — returns current user profile, permissions, allowedCountries |
| `GET/PUT/DELETE /api/users` | `users.js` | ✅ Active — requires `users:read` / `users:write` |
| `GET/POST/PUT/DELETE /api/roles` | `roles.js` | ✅ Active — requires `users:read` / `users:write` |
| `GET/PUT /api/settings` | `settings.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/units` | `units.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/price-levels` | `price-levels.js` | ✅ Active |
| `POST /api/sync-exchange-rates` | `sync-exchange-rates.js` | ✅ Active (uses Frankfurter API) |
| `GET/POST/PUT/DELETE /api/countries` | `countries.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/tax-rates` | `tax-rates.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/country-level-tax` | `country-level-tax.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/categories` | `categories.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/vendors` | `vendors.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/ingredients` | `ingredients.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/price-quotes` | `price-quotes.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/preferred-vendors` | `preferred-vendors.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/recipes` | `recipes.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/menus` | `menus.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/menu-items` | `menu-items.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/menu-item-prices` | `menu-item-prices.js` | ✅ Active |
| `GET /api/cogs` | `cogs.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/allergens` | `allergens.js` | ✅ Active |
| `PATCH /api/allergens/ingredient/:id/notes` | `allergens.js` | ✅ Active — saves allergen_notes to mcogs_ingredients |
| `PATCH /api/allergens/menu-item/:id/notes` | `allergens.js` | ✅ Active — saves allergen_notes to mcogs_menu_items |
| `GET /api/allergens/menu/:id` | `allergens.js` | ✅ Active — includes allergen_notes in each item row |
| `GET /api/nutrition` | `nutrition.js` | ✅ Active (USDA proxy) |
| `GET/POST/PUT/DELETE /api/haccp/equipment` | `haccp.js` | ✅ Active — supports `?location_id=` |
| `GET/POST/DELETE /api/haccp/equipment/:id/logs` | `haccp.js` | ✅ Active |
| `GET/POST/DELETE /api/haccp/ccp-logs` | `haccp.js` | ✅ Active — supports `?location_id=` |
| `GET /api/haccp/report` | `haccp.js` | ✅ Active — supports `?location_id=` |
| `GET/POST/PUT/DELETE /api/locations` | `locations.js` | ✅ Active — supports `?market_id=&group_id=&active=` |
| `GET/POST/PUT/DELETE /api/location-groups` | `location-groups.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/brand-partners` | `brand-partners.js` | ✅ Active |
| `POST /api/import` | `import.js` | ✅ Active — multipart file upload → AI extraction → staging job |
| `GET /api/import/job/:id` | `import.js` | ✅ Active — fetch staged job data |
| `POST /api/import/execute/:id` | `import.js` | ✅ Active — write staged job to DB |
| `POST /api/import/from-text` | `import.js` | ✅ Active — text content → AI extraction (used by Pepper) |
| `POST /api/ai-chat` | `ai-chat.js` | ✅ Active — SSE streaming Pepper chat with 74 tools (includes web search) |
| `POST /api/ai-upload` | `ai-upload.js` | ✅ Active — multipart file + chat message → SSE (vision/CSV) |
| `GET/PUT /api/ai-config` | `ai-config.js` | ✅ Active — AI feature flag configuration |

### Exchange Rate Sync

`POST /api/sync-exchange-rates` calls the free [Frankfurter API](https://api.frankfurter.app) — no API key required. Syncs all rates relative to USD base and stores them in `mcogs_countries.exchange_rate`.

---

## 10. Frontend Architecture

### `useApi.ts` — Auth0-Aware API Hook

**Located at:** `app/src/hooks/useApi.ts`

This is the most critical hook in the app. It wraps all API calls with Auth0 token injection.

```typescript
const api = useApi()

// Usage
const data = await api.get('/ingredients')
await api.post('/ingredients', { name: 'Flour', ... })
await api.put(`/ingredients/${id}`, payload)
await api.delete(`/ingredients/${id}`)
```

#### ⚠️ Critical Implementation Rule

`useApi()` **must** return a `useMemo`-wrapped object. Without this, every render creates a new object reference, which triggers `useEffect` deps to re-fire infinitely.

```typescript
// CORRECT — stable reference via useMemo
return useMemo(() => ({ get, post, put, patch, delete: del }), [request])

// WRONG — causes infinite loop
return { get, post, put, patch, delete: del }
```

### `useSortFilter.ts` — Sort + Filter Hook

Generic hook for managing sort state and multi-select filters over any array of objects.

```typescript
const {
  sorted,           // filtered + sorted array
  sortField,        // current sort field
  sortDir,          // 'asc' | 'desc'
  getFilter,        // (field) => string[]
  setSort,          // (field, dir) => void
  setFilter,        // (field, values) => void
  clearFilters,     // () => void
  hasActiveFilters, // boolean
} = useSortFilter(items, 'name', 'asc')
```

Filters use multi-select (array of values) — `values.includes(String(item[field]))`.

### `DataGrid.tsx` — Sortable Filterable Grid

Generic data grid with:
- Column headers with sort + multi-select filter dropdown
- Fixed-position dropdown (avoids clipping inside `overflow-x-auto`)
- Inline editing support
- Search within filter panel

### Router Structure (`App.tsx`)

```tsx
/login            → LoginPage (public)
/                 → ProtectedRoute → AppLayout (Outlet)
  /dashboard      → DashboardPage
  /settings       → SettingsPage
  /markets        → MarketsPage        (countries/currencies/brand partners)
  /categories     → CategoriesPage
  /inventory      → InventoryPage
  /recipes        → RecipesPage
  /menus          → MenusPage
  /allergens      → AllergenMatrixPage
  /haccp          → HACCPPage
  /import         → ImportPage
  /help           → HelpPage
  /countries      → redirects to /markets
  /locations      → redirects to /markets
```

To activate a new page route:
1. Create the page component in `app/src/pages/`
2. Import it in `App.tsx`
3. Replace the `<Navigate>` placeholder with the new component

### Page Pattern

Every page follows this structure:

```typescript
import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { PageHeader, Modal, Field, EmptyState, Spinner, ConfirmDialog, Toast } from '../components/ui'

export default function ExamplePage() {
  const api = useApi()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api.get('/example')
      setItems(data || [])
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { load() }, [load])

  return (...)
}
```

---

## 11. Design System & Conventions

### Colour Tokens

Defined in `tailwind.config.js` and mirrored as CSS variables in `index.css`:

| Token | Hex | Usage |
|---|---|---|
| `accent` | `#146A34` | Primary green — buttons, active states, focus rings |
| `accent-mid` | `#1E8A44` | Hover state for accent |
| `accent-dim` | `#E8F5ED` | Light green backgrounds, active nav items |
| `accent-dark` | `#0D4D26` | Active/pressed state |
| `surface` | `#FFFFFF` | Card backgrounds |
| `surface-2` | `#F7F9F8` | Page background |
| `text-1` | `#0F1F17` | Primary text |
| `text-2` | `#2D4A38` | Secondary text |
| `text-3` | `#6B7F74` | Muted/placeholder text |
| `border` | `#D8E6DD` | All borders |

### Typography

- **Font:** Nunito (Google Fonts) — loaded in `index.html`
- **Base size:** 15px
- **Mono:** `ui-monospace, SFMono-Regular`

### Tailwind Component Classes

Defined in `@layer components` in `index.css`:

```
.btn-primary    — Green filled button
.btn-outline    — Green outline button
.btn-ghost      — Transparent button
.btn-danger     — Red filled button
.card           — White card with shadow
.badge-green    — Green pill badge
.badge-yellow   — Yellow pill badge
.badge-neutral  — Grey pill badge
.input          — Standard form input with focus ring
```

### COGS % Colour Coding

Used in Menus page and anywhere COGS% is displayed:

| Range | Colour | Meaning |
|---|---|---|
| ≤ target | Green (`#146A34`) | Good |
| target → +10% | Amber (`#D97706`) | Acceptable |
| > target + 10% | Red (`#DC2626`) | Alert |

Default target COGS: stored in `mcogs_settings` as `cogs_thresholds.excellent` and `cogs_thresholds.acceptable`.

---

## 12. Pages Built

### ✅ Settings Page (`/settings`)

**Tabs:** Units | Price Levels | Exchange Rates | System | COGS Thresholds | AI | Import | Users | Roles

- Full CRUD for Units (`mcogs_units`) and Price Levels (`mcogs_price_levels`)
- Exchange Rates tab syncs from Frankfurter API — no key needed
- System tab: database info, future admin tools
- COGS Thresholds: configure green/amber/red target percentages

### ✅ Countries Page (`/countries`)

- CRUD for countries with currency code, symbol, exchange rate
- Per-country tax rates (supports multiple rates per country with `is_default` flag)
- Country-level tax: maps which tax rate applies to which price level per country
- Default price level per country

### ✅ Categories Page (`/categories`)

- CRUD for ingredient and recipe categories
- Group name (flat string — migration to proper groups table is in backlog)
- Type filter: `ingredient` | `recipe`

### ✅ Inventory Page (`/inventory`)

Three tabs:

1. **Ingredients** — full CRUD, category/unit assignment, waste %, prep conversion
2. **Vendors** — full CRUD, country assignment
3. **Price Quotes** — full CRUD per ingredient+vendor, active/inactive flag, preferred vendor assignment per country

### ✅ Recipes Page (`/recipes`)

- Recipe builder: name, category, yield qty + unit
- Recipe items: add ingredients or sub-recipes with qty + prep unit + conversion factor
- COGS calculation: cost per portion based on preferred vendor quotes
- **Market variations** — alternative ingredient lists per country/market (existing)
- **Price Level Recipes (PL Variations)** — alternative ingredient lists per price level. Create via the Price Level variant selector. Priority: PL variation > market variation > global recipe. Stored in `mcogs_recipe_pl_variations`; items linked via `pl_variation_id` on `mcogs_recipe_items`. Copy-to-global promotes a PL variation to the global recipe.

### ✅ Menus Page (`/menus`)

Five tabs:

1. **Menus (Menu Builder)** — create menus per country, add recipe/ingredient items with display name + sort order
2. **Menu Engineer** (formerly "Scenario") — sales mix analysis and scenario planning per menu item
3. **Compare Markets** — grid of sell prices per menu item per price level; inline editing with currency conversion (internally called PLT/price-report)
4. **Market Price Tool** — COGS% grid showing gross/net margins per item per price level (internally called MPT/level-report)
5. **Shared Links** — manage password-protected public links for external reviewer access

**Menu Engineer details:**
- Cross-tab sync: selecting a menu in Menu Builder also selects it in Menu Engineer and vice versa
- Mix Manager modal pre-populates with existing quantities when qty fields are already filled
- Currency symbol shown in column headers (e.g. `Cost/ptn (£)`)
- Categories are collapsible — click category row to collapse/expand items; "▼ All" / "▶ All" button next to Item column header
- **Price overrides** — type a new price into any Price cell to override the live price for this scenario only; does not affect Compare Markets until "Push Prices" is used
- **Push Prices** — permanently writes scenario price overrides back to the live menu
- **What If tool** — apply a % change to all prices or all costs in one step
- **Scenarios** — save/load/delete named snapshots of qty_data + price_overrides + notes, stored in `mcogs_menu_scenarios`

**Notes / History / Comments panel (clock icon in ME):**
- **Notes tab** — free-text scratchpad saved with the scenario
- **History tab** — local action log (resets, pushes, What If). Also shows a "Shared View Edits" sub-section with price changes made by external reviewers via shared links (user, item, level, old → new). Badge count = local entries + shared view edits.
- **Comments tab** — merged feed of text comments from ALL active shared links matching the current menu/scenario (multiple shared views supported). Badge count = comment-type entries only (price changes go to History). Replies are routed back to the correct shared view the parent comment came from.

**Shared Links:**
- Create password-protected links at `/share/<slug>` for external reviewers
- Mode: `view` (read-only) or `edit` (recipient can change sell prices)
- Optional: pin to a specific scenario, set an expiry date, enable/disable without deleting
- Multiple shared links per scenario are supported — e.g. one per franchisee
- In edit mode, each recipient price change is logged and surfaced in the ME History tab
- Comments posted via shared links appear in ME Comments tab, merged and sorted by timestamp
- Reply from ME routes to the correct originating shared view via `shared_page_id` tagging

**Currency conversion in Compare Markets / Market Price Tool:**

- All prices stored in USD base
- Display rate: `dispRate = country.rate / targetCurrency.rate`
- Save-back: `localPrice = displayValue / dispRate`
- Market Price Tool always shows local currency (`dispRate = 1`)

### ✅ Dashboard Page (`/dashboard`)

- 8 KPI cards: ingredients, recipes, vendors, markets, active quotes, categories, coverage %, plus menu tiles
- The **Price Levels** tile has been replaced with **Menu Tiles**. Menu tiles section shows all menus as clickable cards linking to `/menus`, each card showing: Menu Name, Market, item count, and a list of price level name → COGS% rows. Menu tile COGS data loaded in background.
- Price quote coverage progress bar (green/amber/red)
- Missing quotes panel: top 10 ingredients with no active price quote
- Recent active quotes list
- Quick links to all main pages
- Refresh button (silent re-fetch, shows last-updated time)

### ✅ Allergen Matrix Page (`/allergens`)

Displays allergen status for all ingredients and menu items against the EU/UK FIC 14 regulated allergens.

**Two matrices:** Inventory (per ingredient) and Menu (per menu item).

- Both matrices have **sticky first row** (column headers) and **sticky first column(s)** — implemented using `border-separate border-spacing-0` (required because `border-collapse` breaks `position: sticky` in most browsers) with full `border border-border` on all cells individually.
- **Allergen Notes field**: Added to both matrices as an inline editable textarea per row:
  - Inventory matrix: saves to `mcogs_ingredients.allergen_notes` via `PATCH /allergens/ingredient/:id/notes`
  - Menu matrix: saves to `mcogs_menu_items.allergen_notes` via `PATCH /allergens/menu-item/:id/notes`
  - Saves on blur with a spinner indicator during save

### ✅ Import Page (`/import`)

AI-powered data import wizard. Accepts spreadsheet exports (CSV, XLSX, XLSB) and runs them through Claude to extract structured data.

**5-step wizard:**
1. **Upload** — drag-and-drop file or initiate from Pepper chatbot (`?job=<id>` URL param auto-skips to step 2)
2. **Review** — AI-extracted data shown in tabbed tables (Ingredients, Price Quotes, Recipes, Menus)
3. **Categories** — map each "Imported Category" to an existing COGS category (or create new inline via dropdown)
4. **Vendors** — map imported vendor names to existing vendors (or create new)
5. **Execute** — write all staged data to the database

**Key features:**
- Unit fuzzy-matching: auto-resolves imported unit strings (e.g. "pound" → `kg`) via `UNIT_ALIASES` map; shows amber `was: <original>` badge when auto-resolved
- Price Quotes table: "Conv. to Base" column shows base unit from matched ingredient
- Sub-recipe recognition: three-tier recipe hierarchies (raw ingredient → sub-recipe → main recipe); sub-recipe items show 📋 icon + green badge
- **Override action**: rows with duplicates offer Create / Skip / Override; Override updates the existing record in place instead of inserting a new one
- **Prep unit import**: Ingredients sheet supports `prep_unit` and `prep_to_base` columns — maps to `default_prep_unit` / `default_prep_to_base_conversion` on `mcogs_ingredients`
- **Menu import**: Menus sheet (`menu_name`, `country`, `description`) + Menu Items sheet (`menu_name`, `item_type`, `item_name`, `display_name`, `sort_order`) — creates menus and links items from imported recipes/ingredients
- **Category inline create**: In the Categories mapping step, selecting "+ Create new category" from the COGS Category dropdown auto-switches the row action to "create" and pre-fills the suggested name — no need to use the Action column separately
- Chatbot integration: Pepper can trigger an import job with `start_import` tool; ImportPage reads `?job` param on mount

**Template sheets** (download via Import page → "Download template"):
- `Ingredients` — name, category, base_unit, waste_pct, prep_unit, prep_to_base, notes
- `Vendors` — name, country
- `Price Quotes` — ingredient_name, vendor_name, purchase_price, qty_in_base_units, purchase_unit
- `Recipes` — recipe_name, category, yield_qty, yield_unit, item_type, item_name, qty, unit
- `Menus` — menu_name, country, description
- `Menu Items` — menu_name, item_type, item_name, display_name, sort_order

---

## 13. Pages Remaining to Build

| Page | Route | Priority | Notes |
|---|---|---|---|
| **System Admin** | `/settings` → System tab | Medium | DB migration runner, import/export, health info |
| **Reports** | TBD | Medium | Missing price quotes report; cross-market COGS comparison |

### Adding a New Page — Checklist

1. Create `api/src/routes/newpage.js` with CRUD endpoints
2. Register in `api/src/routes/index.js`: `router.use('/newpage', require('./newpage'))`
3. Create `app/src/pages/NewPage.tsx`
4. Import and add route in `app/src/App.tsx` (replace `<Navigate>` placeholder)
5. Add nav link to `app/src/components/Sidebar.tsx`
6. Push to `main` — CI/CD auto-deploys

---

## 14. Pepper AI Assistant

> **Full AI documentation:** [`docs/AI.md`](docs/AI.md) — covers current implementation, memory system design, voice interface scope, all DB tables, API routes, and cost estimates.

Pepper is the in-app AI assistant (Claude Haiku 4.5 via Anthropic API). It appears as a floating chat panel (bottom-right) or can be docked to the left or right side of the screen. It uses server-sent events (SSE) for streaming responses and supports an agentic loop where Claude can call tools to read and write data.

### Architecture

- **Frontend:** `app/src/components/AiChat.tsx` — chat panel with history tab, file attachment, screenshot button, dockable panel
- **Chat endpoint:** `POST /api/ai-chat` — JSON body `{ messages, conversationId? }` → SSE stream
- **Upload endpoint:** `POST /api/ai-upload` — multipart `{ file, message, conversationId? }` → SSE stream (image/CSV/screenshot)
- **Shared agentic loop:** `api/src/helpers/agenticStream.js` — SSE helper, keepalive ping, `while(true)` tool loop, token counting
- **Logging:** all sessions logged to `mcogs_ai_chat_log` (messages, tools_called JSONB, token counts)
- **File support:** CSV/text (injected as text block), PNG/JPEG/WEBP (injected as base64 vision block); max 5MB; PDF not supported
- **Web search config:** `BRAVE_SEARCH_API_KEY` stored via `GET/PUT /api/ai-config` — if set, `search_web` tool uses Brave Search; otherwise DuckDuckGo instant answer fallback
- **Panel mode:** `PepperMode = 'float' | 'docked-left' | 'docked-right'` — persisted in `localStorage('pepper-mode')`. Docked modes render as a full-height flex column in `AppLayout`; float is fixed-position popup

### Tool Count: 74

**Lookup / Read (15):**
`get_dashboard_stats`, `list_ingredients`, `get_ingredient`, `list_recipes`, `get_recipe`, `list_menus`, `get_menu_cogs`, `get_feedback`, `submit_feedback`, `list_vendors`, `list_markets`, `list_categories`, `list_units`, `list_price_levels`, `list_price_quotes`

**Write — Create (10):**
`create_ingredient`, `create_vendor`, `create_price_quote`, `set_preferred_vendor`, `create_recipe`, `add_recipe_item`, `create_menu`, `add_menu_item`, `set_menu_item_price`, `create_category`

**Write — Update (5):**
`update_ingredient`, `update_vendor`, `update_price_quote`, `update_recipe`, `update_recipe_item`

**Write — Delete (5):**
`delete_ingredient`, `delete_vendor`, `delete_price_quote`, `delete_recipe_item`, `delete_menu`

**Market / Brand (9):**
`create_market`, `update_market`, `delete_market`, `assign_brand_partner`, `list_brand_partners`, `create_brand_partner`, `update_brand_partner`, `delete_brand_partner`, `unassign_brand_partner`

**Categories (2):**
`update_category`, `delete_category`

**Tax Rates (5):**
`list_tax_rates`, `create_tax_rate`, `update_tax_rate`, `set_default_tax_rate`, `delete_tax_rate`

**Price Levels (3):**
`create_price_level`, `update_price_level`, `delete_price_level`

**Settings (2):**
`get_settings`, `update_settings`

**HACCP (8):**
`list_haccp_equipment`, `create_haccp_equipment`, `update_haccp_equipment`, `delete_haccp_equipment`, `log_temperature`, `list_temp_logs`, `list_ccp_logs`, `add_ccp_log`

**Locations (8):**
`list_locations`, `create_location`, `update_location`, `delete_location`, `list_location_groups`, `create_location_group`, `update_location_group`, `delete_location_group`

**Allergens (4):**
`list_allergens`, `get_ingredient_allergens`, `set_ingredient_allergens`, `get_menu_allergens`

**Import (1):**
`start_import` — accepts file text content already in conversation, calls `stageFileContent()`, returns `{ job_id, url: '/import?job=<id>', summary }` so the user can click through to the Import Wizard

**Web Search (1):**
`search_web` — uses Brave Search API if `BRAVE_SEARCH_API_KEY` is configured in Settings → AI; falls back to DuckDuckGo Instant Answer API (free, no key, limited coverage). **Only invoked when the user explicitly asks to search the internet.** System prompt restricts autonomous use.

### Confirmation Safety

Enforced via system prompt: Claude must verbally describe any create/update/delete action and ask "Shall I proceed?" before calling write tools. Batch operations (>3 records) get one plan + one confirm. Additional safety rules:
- `delete_menu` — always warns that all menu items and prices will also be deleted (cascade)
- `delete_market` — warns that associated vendors, menus, and tax rates will also be removed
- `delete_location` — warns if equipment is assigned and must be removed first
- `set_ingredient_allergens` — warns that this REPLACES the full allergen profile for the ingredient
- FK violations on `delete_ingredient` / `delete_vendor` return a friendly error string rather than throwing (catches PG error 23503)

### Chatbot → Import Wizard Flow

1. User pastes or uploads spreadsheet content in chat
2. Pepper calls `start_import` with the text content
3. Server calls `stageFileContent()` (shared with the `/import` upload route) — AI extraction + DB staging
4. Pepper replies with a link: `/import?job=<id>`
5. User clicks link → ImportPage mounts → reads `?job` param → skips upload step → lands on Review tab

### Additional AI Chat Features

- **Concise mode**: Settings → AI tab has a "Response Behaviour" toggle. When enabled, injects a system prompt section that tells Claude to skip narration, not say "Let me check…", call tools silently, and give bullet-point results. Saved to `mcogs_settings` as `ai_concise_mode`. Read from DB on every `POST /ai-chat` and `POST /ai-upload` request.
- **Animated waiting dots**: While waiting for an AI response, three dots animate with a wave effect (scale + opacity) using `@keyframes pepper-dot` defined in `index.css`.
- **Paste images**: Users can paste images directly from clipboard into the AI chat textarea (Ctrl+V / Cmd+V). Clipboard event handler detects image MIME types, creates a File object, and attaches it as the file attachment. An image preview thumbnail is shown in the attachment badge.
- **Screenshot button**: Camera icon in the chat input bar (next to paperclip). Captures the current `<main>` element via `html2canvas` at 65% scale, converts to JPEG, and attaches it as the file — user can then add a message and send. Elements with class `pepper-ui` are excluded from the capture.
- **Right-click Ask Pepper**: Any element with `data-ai-context` JSON attribute triggers a custom context menu on right-click. The menu shows "Ask Pepper" which builds a contextual prompt from the element's data and dispatches a `pepper-ask` CustomEvent. The handler in `AiChat.tsx` also captures a screenshot via `html2canvas` and sends it alongside the prompt via `ai-upload`. Supported context types: `cogs_pct`, `coverage`, `cost_per_portion`, `menu_cogs`, `tutorial`.
- **Dockable panel**: Three mode icons in the Pepper header toggle between `float` (fixed popup), `docked-left` (panel between sidebar and main), `docked-right` (panel right of main). `AppLayout` manages the mode in `pepperMode` state, persisted to `localStorage('pepper-mode')`. Switching mode remounts the component (conversation is cleared).
- **Contextual help buttons**: `PepperHelpButton` component (`app/src/components/ui.tsx`) renders a small cog icon next to `PageHeader` titles and tab labels. Clicking fires a pre-written tutorial prompt for that section. Also sets `data-ai-context` so right-click works too.

---

## 15. RBAC — Role-Based Access Control

### Overview

Every user has a **role**, and every role has a **permission level** per feature: `none`, `read`, or `write`.

| Level | Effect |
|---|---|
| `none` | Nav item hidden, API returns 403 |
| `read` | Can view data, cannot create/edit/delete |
| `write` | Full access |

Three system roles are seeded automatically and cannot be deleted:

| Role | Default access |
|---|---|
| **Admin** | `write` on all 12 features |
| **Operator** | `write` on most features; `read` on settings; `none` on users |
| **Viewer** | `read` on all features except settings/import/users (`none`) |

Custom roles can be created in Settings → Roles and assigned any combination.

### Features (12)

`dashboard` · `inventory` · `recipes` · `menus` · `allergens` · `haccp` · `markets` · `categories` · `settings` · `import` · `ai_chat` · `users`

### User Lifecycle

```
Register (Auth0) → pending status → Admin approves → active → can sign in
First user ever  → auto-bootstrapped as Admin + active (no chicken-and-egg)
Disabled         → 403 on every request, shown disabled message
```

### Market Scope (Brand Partner Filtering)

Users can be restricted to specific markets via brand partner assignments (`mcogs_user_brand_partners`). The scope chain is:

```
mcogs_user_brand_partners → mcogs_brand_partners → mcogs_countries
```

`allowedCountries = null` means unrestricted (Admin default). Non-null = array of country IDs the user may access.

### Backend Architecture

- **`api/src/middleware/auth.js`** — `requireAuth`, `requirePermission(feature, level)`, `applyMarketScope`
- Token verification: calls Auth0 `/userinfo` endpoint; responses cached 5 min (500-entry cap)
- `loadOrCreateUser()` — creates pending user on first login; bootstraps first-ever user as Admin
- All routes (except `/health` and `/public/share/*`) require `requireAuth`

### Frontend Architecture

- **`app/src/hooks/usePermissions.ts`** — `usePermissions()` hook, `Feature` type, `AccessLevel` type, `MeUser` interface
- **`app/src/components/PermissionsProvider.tsx`** — loads `/api/me` on auth change, provides `can(feature, level)` and `allowedCountries`
- **`app/src/pages/PendingPage.tsx`** — shown when `user.status === 'pending'`
- **Sidebar** — hides nav items where `can(feature, 'read')` is false
- **Settings → Users tab** — list/approve/disable/delete users, change role, assign BP scope
- **Settings → Roles tab** — permission matrix (features × roles), click cell to cycle `— → R → W`, saves instantly

### Pepper AI Auth Fix

Pepper (`AiChat.tsx`) uses raw `fetch()` calls for SSE streaming — not `useApi()`. These calls had no auth header before RBAC. Fix: `getAccessTokenSilently()` from `useAuth0()` is called before each fetch and injected as `Authorization: Bearer <token>`.

---

## 16. Known Bugs Fixed

### Fix 1 — Mixed Content Error (HTTP vs HTTPS)

**Symptom:** 1,252+ blocked network requests. All API calls going to `http://` despite HTTPS being configured. Browser correctly blocking all requests.

**Root Cause:** `deploy.yml` was hardcoding `http://` when constructing `VITE_API_URL` at build time:
```yaml
# BROKEN — overrides the secret entirely
VITE_API_URL: http://${{ secrets.LIGHTSAIL_HOST }}/api
```

**Fix:**
```yaml
# CORRECT — use the secret directly
VITE_API_URL: ${{ secrets.VITE_API_URL }}
```

**File:** `.github/workflows/deploy.yml`

---

### Fix 2 — Infinite `useEffect` Loop

**Symptom:** Thousands of API requests per second after the HTTPS fix. UI flashing continuously. Network tab showed `price-levels` requests accumulating endlessly.

**Root Cause:** `useApi()` returned a new object literal on every render. React reference equality check failed on every render, causing `useCallback([api])` and then `useEffect` to re-fire in an infinite loop:

```
api recreated → useCallback fires → useEffect fires → load() → setLoading(true)
→ re-render → api recreated → ...
```

**Fix:** Wrap the returned object in `useMemo`:
```typescript
// app/src/hooks/useApi.ts
return useMemo(() => ({ get, post, put, patch, delete: del }), [request])
```

**File:** `app/src/hooks/useApi.ts`

---

### Fix 3 — Express Trust Proxy Error

**Symptom:** `express-rate-limit` throwing `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` on every request. API errors preventing any POST requests from succeeding.

**Root Cause:** Nginx passes `X-Forwarded-For` headers to Express, but Express does not trust the proxy by default, causing the rate limiter to reject requests.

**Fix:**
```javascript
// api/src/index.js — add immediately after: const app = express()
app.set('trust proxy', 1)
```

**File:** `api/src/index.js`

---

### Fix 4 — Currency Conversion (PLT Save-Back)

**Symptom:** Editing a price in PLT always converted incorrectly unless the base currency was USD. For example, Italy (EUR) with EUR target: entering €15 saved as ~€17.41.

**Root Cause:** The save-back formula used only `c.rate` instead of the display rate (`c.rate / targetRate`):

```typescript
// WRONG
const localPrice = grossDisplay / c.rate

// CORRECT
const localPrice = grossDisplay / dispRate  // where dispRate = c.rate / targetRate
```

**Fix:** Pass `dispRate` through to `onSavePrice`, store as `disp_rate` on `PltGridRow`, use in save-back.

**File:** `app/src/pages/MenusPage.tsx`

---

### Fix 5 — ColumnHeader Dropdown Clipping

**Symptom:** Filter/sort dropdown in column headers clipped inside `overflow-x-auto` table wrapper.

**Fix:** Changed `ColumnHeader` and `DataGrid` `HeaderCell` to use fixed positioning (`position: fixed`) calculated from `getBoundingClientRect()`, placed at `z-index: 99999`.

**File:** `app/src/components/ColumnHeader.tsx`, `app/src/components/DataGrid.tsx`

---

### Fix 6 — TypeScript Build Failure (ImportPage)

**Symptom:** GitHub Actions CI/CD failed at the Vite build step with two TypeScript errors in `ImportPage.tsx`.

**Error 1:** `PageHeader` called with `description` prop — but `ui.tsx` defines it as `subtitle`.

**Error 2:** `<TD />` used self-closing (no children) but `TD`'s type declared `children: React.ReactNode` (required, not optional).

**Fix:**
```tsx
// Error 1
<PageHeader description="...">  →  <PageHeader subtitle="...">

// Error 2
children: React.ReactNode  →  children?: React.ReactNode
```

**File:** `app/src/pages/ImportPage.tsx`, `app/src/pages/ImportPage.tsx` (`TD` component)

---

### Fix 7 — import.js Router Export Shape

**Symptom:** After extracting `stageFileContent` from `import.js`, the route registration broke — Express threw "Router.use() requires a middleware function" at startup.

**Root Cause:** `import.js` was changed from `module.exports = router` to `module.exports = { router, stageFileContent }`. But `api/src/routes/index.js` still did `require('./import')` — which now returned a plain object, not a router.

**Fix:**
```js
// index.js
router.use('/import', require('./import').router);
```

**File:** `api/src/routes/index.js`

---

### Fix 8 — Recipe Import Silently Failing (Wrong Column Names)

**Symptom:** Recipes never appeared in the database after running the import wizard, even when using the built-in template file. No visible error — the wizard reported success.

**Root Cause:** The `execute` function in `import.js` was inserting recipe items with two wrong column names:
1. `qty` — the actual column is `prep_qty` (a `NUMERIC(18,8)` column defined in `migrate.js`)
2. `sort_order` — this column does not exist in `mcogs_recipe_items` at all

Both invalid column names caused PostgreSQL to throw inside the transaction, which rolled back silently, leaving zero recipe items (and therefore zero recipe shells due to dependent logic).

**Fix:**
```js
// BEFORE (broken):
'INSERT INTO mcogs_recipe_items (recipe_id,item_type,ingredient_id,qty,prep_unit,sort_order) VALUES ...'
[rid, iid, item.qty || 0, item.unit || '', sort++]

// AFTER (correct):
'INSERT INTO mcogs_recipe_items (recipe_id,item_type,ingredient_id,prep_qty,prep_unit) VALUES ($1,\'ingredient\',$2,$3,$4)'
[rid, iid, item.qty || 0, item.unit || '']
```

**File:** `api/src/routes/import.js`

---

### Fix 9 — Shared View Comment Count Mismatch

**Symptom:** The Comments badge in the ME Notes/History panel showed 9 but only 3 comments were visible.

**Root cause:** `meChanges` contains all change types — `'comment'` and `'price'`/`'qty'`. The badge was counting `comments.length` (all entries) rather than only `change_type === 'comment'` entries. The `commentTree` correctly filtered to comments only, so only 3 showed in the panel, but the badge showed the full count including price change events.

**Fix:** Badge and empty-state now filter to `change_type === 'comment'` only. Price/qty change events were moved to the History tab under "Shared View Edits".

---

### Fix 10 — Shared View Reply Posted to Wrong Shared Page

**Symptom:** When replying to a comment in Menu Engineer that came from shared view B, the reply was always posted to shared view A (active[0]).

**Root cause:** `addMeComment` always posted to `meSharedPageId` (= `active[0].id`), regardless of which shared page the original comment came from. When multiple shared views are linked to the same scenario, comments from view B would receive replies that land in view A.

**Fix:**
- Added `shared_page_id?: number` field to `MeChange` interface (tagged client-side when fetching)
- When fetching changes for multiple pages, each row is tagged with the page's ID: `.then(rows => rows.map(r => ({ ...r, shared_page_id: p.id })))`
- `addMeComment(text, parentId?, sharedPageId?)` now accepts an optional `sharedPageId` override
- `postReply()` passes `replyTo.shared_page_id` — the reply always routes to the same view as the parent comment

**Files:** `app/src/pages/MenusPage.tsx`

---

## 17. Critical Gotchas & Lessons Learned

### Server User Context

The original setup script ran everything as the `mcogs` user. **All services have been migrated to the `ubuntu` user.** Do not switch back to `mcogs`.

- All file ownership: `ubuntu:ubuntu`
- PM2 runs as `ubuntu` — do **not** use `ecosystem.config.js` (it has `user: mcogs`)
- Start API with: `pm2 start src/index.js --name menu-cogs-api`
- `.env` file: `chmod 644` (not 600) — API runs as `ubuntu`, not root

### GitHub Authentication

GitHub dropped password auth. Always use SSH remote:
```bash
git remote set-url origin git@github.com:mawegrzyn-ux/COGS.git
```

One-time push from the server requires:
```bash
GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519_cogs" git push
```

### Git Safe Directory

If git throws a "dubious ownership" error on the server:
```bash
git config --global --add safe.directory /var/www/menu-cogs
```
This was needed because the repo was originally owned by `mcogs`.

### Auth0 + HTTPS

Auth0 will throw "must run on a secure origin" on plain HTTP. SSL via Let's Encrypt/Certbot must be active before Auth0 works on the server. Certbot auto-renews — check with:
```bash
sudo certbot renew --dry-run
```

### React Hook Stability

**Always return stable references from custom hooks.** Any object or function returned from a hook that is used in a `useEffect` dependency array must be wrapped in `useMemo` or `useCallback` to prevent infinite loops. This is the most common source of silent performance bugs in this codebase.

### `VITE_API_URL` in GitHub Actions

Never interpolate the API URL in deploy.yml — always reference the secret directly:
```yaml
VITE_API_URL: ${{ secrets.VITE_API_URL }}   # ✅ correct
VITE_API_URL: http://${{ secrets.LIGHTSAIL_HOST }}/api   # ❌ breaks HTTPS
```

### `mcogs_` Table Prefix

The `mcogs_` prefix on all PostgreSQL tables matches the original WordPress plugin naming. **Keep this prefix** — it is required for data migration compatibility with the legacy import script.

### DataGrid vs ColumnHeader

The codebase has two filter/sort implementations:
- `ColumnHeader.tsx` — standalone header cell used in custom table layouts (e.g., Inventory)
- `DataGrid.tsx` `HeaderCell` — built-in header for the generic DataGrid component

Both implement the same multi-select filter + sort pattern. If updating filter logic, update both.

### import.js Dual Export Shape

`api/src/routes/import.js` exports **both** the Express router and the `stageFileContent` helper:

```js
module.exports = { router, stageFileContent };
```

When registering in `index.js` use `.router`:
```js
router.use('/import', require('./import').router);   // ✅
router.use('/import', require('./import'));            // ❌ — breaks Express
```

When requiring `stageFileContent` from `ai-chat.js`:
```js
const { stageFileContent } = require('./import');
```

### `mcogs_recipe_items` Column is `prep_qty`, Not `qty`

The quantity column in `mcogs_recipe_items` is named **`prep_qty`** (not `qty`). This is easy to get wrong because the template CSV uses the header `qty` and the JavaScript objects carry a `qty` property. Always map to `prep_qty` when inserting into this table. The table also has **no `sort_order` column** — do not attempt to insert one.

```js
// CORRECT
INSERT INTO mcogs_recipe_items (recipe_id, item_type, ingredient_id, prep_qty, prep_unit)

// WRONG — fails silently, transaction rolls back, no records saved
INSERT INTO mcogs_recipe_items (recipe_id, item_type, ingredient_id, qty, prep_unit, sort_order)
```

### `border-collapse` Breaks `position: sticky`

When `border-collapse` is set on a table, `position: sticky` on `<th>` and `<td>` elements does not work in most browsers. This affects sticky column headers and sticky first columns in data matrices.

**Fix:** Use `border-separate border-spacing-0` on the `<table>` element, then add full `border border-border` classes to each `<th>` and `<td>` cell individually to recreate the collapsed-border appearance.

**Affected component:** `AllergenMatrixPage.tsx`

### Local Dev Server Not Required

This project deploys via GitHub Actions to Lightsail. There is no local dev server workflow. Claude Code hooks that require a running local server (e.g., the Claude Preview plugin Stop hook) are suppressed via `"disableAllHooks": true` in `.claude/settings.local.json`.

### Git / Deploy Workflow — Claude Does Not Run Git Commands

The user commits and pushes all changes themselves from their local machine. **Claude should never end a response with instructions to run `git add`, `git commit`, `git push`, or any terminal commands.** Once Claude has finished editing files, the work is done. The user pushes when ready, and `deploy.yml` (GitHub Actions) automatically builds the frontend and deploys to the Lightsail server.

---

## 18. Backlog

### Category Groups Migration

**Current state:** `mcogs_categories` has a flat `group_name VARCHAR(100)` column.

**Planned:** Migrate to a proper `mcogs_category_groups` table:
```sql
CREATE TABLE mcogs_category_groups (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(100) NOT NULL,
  parent_id INTEGER REFERENCES mcogs_category_groups(id) ON DELETE SET NULL,
  type      VARCHAR(20) NOT NULL CHECK (type IN ('ingredient', 'recipe')),
  sort_order INTEGER NOT NULL DEFAULT 0
)
```
Then add `group_id INTEGER REFERENCES mcogs_category_groups(id)` to `mcogs_categories` and remove `group_name`.

**Benefits:** Nested group support, better analytics reporting, proper foreign key integrity.

### Missing Price Quotes Report

A report that surfaces ingredients used in menu recipes that have no preferred vendor quote for a selected market/country. Useful for identifying pricing gaps before costing a menu in a new region.

**Implementation notes:**
- Query: `mcogs_recipe_items` → `mcogs_menu_items` → join `mcogs_ingredient_preferred_vendor` LEFT join → WHERE preferred vendor IS NULL for target country
- Can also be a filtered view on the Inventory page (Quotes tab → filter by "No preferred vendor")
- Dashboard already surfaces a simplified version (top 10 unpriced ingredients by count)

### Auth0 API Audience

Currently the Auth0 audience is set to empty string. To add proper API-level JWT validation:
1. Create an Auth0 API in the dashboard, get the audience identifier
2. Add `VITE_AUTH0_AUDIENCE` as a GitHub secret
3. Pass audience in `authorizationParams` in `main.tsx`
4. Add JWT verification middleware to Express API

### POS Menu Features — Manual Items, Combos & Modifiers

**Full specification:** [`docs/POS_MENU_FEATURES.md`](docs/POS_MENU_FEATURES.md)

Three interconnected features that extend the menu builder towards a full POS backend configuration system. **Do not build until explicitly requested.**

| Feature | Summary |
|---|---|
| **Manual Items** | Menu items with no recipe/ingredient link — manually entered cost and allergen tags. `item_type = 'manual'` |
| **Combos** | `item_type = 'combo'` — ordered steps, each step has 1+ options (fixed or customer choice). COGS = sum of step costs, avg for multi-option steps. |
| **Modifier Groups** | Global reusable groups (e.g., "Bone In Flavours") with min/max selection, attachable to both standalone menu items and combo step options via many-to-many junctions. |

**7 new DB tables:** `mcogs_modifier_groups`, `mcogs_modifier_options`, `mcogs_menu_item_modifier_groups`, `mcogs_combo_steps`, `mcogs_combo_step_options`, `mcogs_combo_step_option_modifier_groups` + 2 column changes on `mcogs_menu_items`.

**~11 days total** across 5 phases. See full doc for data model, API routes, COGS pseudocode, PLT two-column modifier pricing, allergen matrix changes, Pepper tools, user stories and scenarios.

### Lightsail Upgrade

Current $10/mo instance (2GB RAM, 1 vCPU) is dev/staging tier. For production with real franchise operators, upgrade to $20/mo (4GB RAM, 2 vCPU). Take a Lightsail snapshot before upgrading.

### Voice Interface for Pepper — PARKED

Full scope documented below. **Do not build until explicitly requested.**

**What it covers:** Two independent capabilities that can ship separately:
1. **Voice Input** — push-to-talk mic button, live transcript in textarea, auto-send or manual
2. **Voice Output** — Pepper's responses read aloud sentence-by-sentence as the SSE stream arrives

**Two implementation tiers:**

| Tier | Approach | Cost | Effort |
|---|---|---|---|
| **1 — Browser APIs** | `SpeechRecognition` (input) + `speechSynthesis` (output) | Free | ~2 days |
| **2 — External APIs** | Whisper/Deepgram (input) + OpenAI TTS/ElevenLabs (output) | ~$15–50/mo at moderate usage | +3 days |

**Tier 1 details (browser-only):**
- `window.SpeechRecognition` — Chrome/Edge only (Chromium). Firefox/Safari unsupported.
- `window.speechSynthesis` — all browsers, robotic voice but functional
- No backend changes, no new API keys, no new dependencies
- HTTPS required — already satisfied by production SSL

**Tier 2 details (quality):**
- Whisper API (OpenAI) ~$0.006/min or Deepgram ~$0.0043/min for transcription
- OpenAI TTS ~$15/1M chars or ElevenLabs for playback
- Requires: new API key fields in Settings → AI, server-side proxy endpoint for audio, streaming audio queue manager

**Key technical challenge — streaming TTS:**
Pepper's response arrives as SSE text chunks, not complete sentences. For real-time playback, the stream must be buffered, split on sentence boundaries (`. ? !` followed by whitespace), and queued to the TTS engine sentence-by-sentence. Browser `speechSynthesis` handles this acceptably. External TTS APIs require an audio queue manager and playback coordination layer.

**UI changes needed:**
- Mic button in chat input bar (next to camera/paperclip icons)
- Pulsing recording indicator while listening
- Speaker toggle icon in Pepper header (persisted to `localStorage`)
- Stop/interrupt button during playback
- Settings → AI: voice engine selector, voice/speed controls (Tier 2)

**Risks:**
- Browser Speech API is Chromium-only — ~65% browser coverage
- Kitchen background noise degrades browser API accuracy significantly; Whisper handles it better
- Anthropic has no speech API — requires mixing in OpenAI or Deepgram alongside existing Anthropic setup

**Recommended start point:** Tier 1 (browser-only, ~2 days, zero cost). Upgrade to Tier 2 if voice quality is a user complaint.

---

## 19. Domain Migration Log

### April 2026 — `obscurekitty.com` → `cogs.flavorconnect.tech`

Migrated from the original throwaway domain to a branded subdomain under `flavorconnect.tech`.

**What was changed:**

| Component | Change |
|---|---|
| DNS | A record `cogs` → `13.135.158.196` added to Lightsail DNS zone for `flavorconnect.tech` |
| Nginx | `server_name` updated in `/etc/nginx/sites-available/menu-cogs` |
| SSL | New Let's Encrypt cert issued via `sudo certbot --nginx -d cogs.flavorconnect.tech` |
| Auth0 | Callback / Logout / Web Origins updated in Auth0 dashboard |
| GitHub Secrets | `LIGHTSAIL_HOST` and `VITE_API_URL` updated |
| CI/CD | Deploy triggered via empty commit — health check passed |

**Full step-by-step process:** [`docs/DOMAIN_MIGRATION.md`](docs/DOMAIN_MIGRATION.md)

**Quick checklist:**

1. Add A record in DNS zone (Lightsail) → `<subdomain>` → server IP
2. Verify with `nslookup <new-domain>` — must return the correct IP
3. Update `server_name` in `/etc/nginx/sites-available/menu-cogs` → `sudo nginx -t && sudo nginx -s reload`
4. `sudo certbot --nginx -d <new-domain>` — issues cert + updates Nginx automatically
5. Auth0 dashboard → add new domain to Callback / Logout / Web Origins (keep localhost entries)
6. GitHub → update `LIGHTSAIL_HOST` and `VITE_API_URL` secrets
7. Push to `main` (or empty commit) to trigger deploy — health check must pass
8. Update docs: CLAUDE.md, HelpPage.tsx, docs/user-guide.md, docs/DOMAIN_MIGRATION.md

> **Note:** Auth0 tenant name (`obscurekitty.uk.auth0.com`) does not change with the app domain — it is a fixed Auth0 identifier.

---

## 20. Key Contacts & Resources

| Resource | URL/Value |
|---|---|
| **Production App** | https://cogs.flavorconnect.tech |
| **GitHub Repo** | https://github.com/mawegrzyn-ux/COGS |
| **Auth0 Dashboard** | https://manage.auth0.com → tenant: `obscurekitty.uk.auth0.com` |
| **AWS Lightsail Console** | https://lightsail.aws.amazon.com |
| **Frankfurter API** (exchange rates) | https://api.frankfurter.app — free, no key |
| **Let's Encrypt / Certbot** | `sudo certbot renew --dry-run` |
| **Enterprise Scale-Up Plan** | [`docs/ENTERPRISE_SCALE.md`](docs/ENTERPRISE_SCALE.md) |

---

*README last updated: April 2026 (session: Domain migrated to cogs.macaroonie.com; RBAC system built — mcogs_roles/mcogs_role_permissions/mcogs_users/mcogs_user_brand_partners tables, requireAuth middleware via Auth0 /userinfo with 5-min cache, requirePermission factory, Settings → Users tab (approve/disable/delete/role/scope), Settings → Roles tab (feature×role matrix, click-to-cycle instant save), Sidebar permission filtering, PermissionsProvider + usePermissions hook, PendingPage, Pepper AiChat.tsx auth header fix; Roles tab redesigned as matrix; section 15 RBAC added to CLAUDE.md; HelpPage User Management section added, Security section updated)*
