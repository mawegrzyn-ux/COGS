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
14. [Known Bugs Fixed](#14-known-bugs-fixed)
15. [Critical Gotchas & Lessons Learned](#15-critical-gotchas--lessons-learned)
16. [Backlog](#16-backlog)
17. [Key Contacts & Resources](#17-key-contacts--resources)

---

## 1. Project Overview

| Field | Value |
|---|---|
| **App** | Menu COGS Calculator |
| **Origin** | WordPress plugin v3.3.0 — migrated to React/Node/PostgreSQL |
| **Server** | AWS Lightsail instance "WRI" — Ubuntu 24.04, $10/mo, 2GB RAM, 1 vCPU |
| **IP** | `13.135.158.196` (static) |
| **Domain** | `obscurekitty.com` |
| **SSL** | Let's Encrypt via Certbot — auto-renews |
| **Web Server** | Nginx (reverse proxy → Node API on port 3001) |
| **Process Manager** | PM2 running as `ubuntu` user (process name: `menu-cogs-api`) |
| **Auth** | Auth0 — tenant: `obscurekitty.uk.auth0.com` |
| **Database** | PostgreSQL 16 — database: `mcogs`, 16 tables (all prefixed `mcogs_`) |
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
│           └── MenusPage.tsx       # Menu builder (PLT/MPT/Menu Builder tabs)
│
├── api/                            # Node.js/Express API
│   ├── package.json
│   ├── .env                        # NOT in git — see env vars section
│   └── src/
│       ├── index.js                # Express entry point
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
│           ├── ingredients.js
│           ├── price-quotes.js
│           ├── preferred-vendors.js
│           └── recipes.js
│           # menus.js  ← commented out in index.js, ready to uncomment
│           # cogs.js   ← commented out in index.js, ready to uncomment
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
| `/etc/letsencrypt/live/obscurekitty.com/` | SSL certificate files |
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
# Creates all 16 mcogs_ tables — safe to run multiple times
```

### Start Development Servers

```bash
# Terminal 1 — API (port 3001)
cd api && npm run dev

# Terminal 2 — Frontend (port 5173, proxies /api to port 3001)
cd app && npm run dev
```

Open `http://localhost:5173` — Auth0 login will redirect to `localhost` callback.

> **Note:** Auth0 requires the callback URL `http://localhost:5173` to be in the **Allowed Callback URLs** list in the Auth0 dashboard. Add it alongside `https://obscurekitty.com`.

---

## 6. CI/CD Pipeline

Every push to `main` triggers `.github/workflows/deploy.yml` automatically.

### Pipeline Steps

1. Checkout code
2. Install frontend npm dependencies (`app/`)
3. Build React app with Vite — env vars baked in from GitHub Secrets
4. SCP `app/dist/` to `/var/www/menu-cogs/frontend/` on server
5. SSH into server: `git pull` → `npm install` → `pm2 restart` → `nginx reload`
6. Health check: `GET https://obscurekitty.com/api/health` must return `{"status":"ok"}`

### GitHub Secrets Required

| Secret | Value |
|---|---|
| `LIGHTSAIL_HOST` | `obscurekitty.com` |
| `LIGHTSAIL_USER` | `ubuntu` |
| `LIGHTSAIL_SSH_KEY` | Full private SSH key content (including `-----BEGIN OPENSSH PRIVATE KEY-----`) |
| `VITE_API_URL` | `https://obscurekitty.com/api` |
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
| **Allowed Callback URLs** | `https://obscurekitty.com`, `http://localhost:5173` |
| **Allowed Logout URLs** | `https://obscurekitty.com/login`, `http://localhost:5173/login` |
| **Allowed Web Origins** | `https://obscurekitty.com`, `http://localhost:5173` |
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
| 12 | `mcogs_recipe_items` | Recipe line items: ingredient or sub-recipe, qty, prep unit, conversion |
| 13 | `mcogs_menus` | Menu definitions, linked to a country |
| 14 | `mcogs_menu_items` | Menu line items: recipe or ingredient, display name, sort order |
| 15 | `mcogs_menu_item_prices` | Sell prices per menu item per price level, with tax rate |
| 16 | `mcogs_locations` | Physical store locations — linked to market, optional group, address, contact details |
| 17 | `mcogs_location_groups` | Clusters of locations (e.g. "London Central") — optional grouping |
| 18 | `mcogs_allergens` | EU/UK FIC reference allergens (14 regulated) |
| 19 | `mcogs_ingredient_allergens` | Junction: allergen status per ingredient (contains/may_contain/free_from) |
| 20 | `mcogs_equipment` | HACCP equipment register — linked to location |
| 21 | `mcogs_equipment_temp_logs` | Temperature readings per equipment |
| 22 | `mcogs_ccp_logs` | CCP logs (cooking/cooling/delivery) — linked to location |

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
waste_pct (0–100), notes, image_url
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
| `GET /api/health` | `health.js` | ✅ Active |
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
| `GET /api/nutrition` | `nutrition.js` | ✅ Active (USDA proxy) |
| `GET/POST/PUT/DELETE /api/haccp/equipment` | `haccp.js` | ✅ Active — supports `?location_id=` |
| `GET/POST/DELETE /api/haccp/equipment/:id/logs` | `haccp.js` | ✅ Active |
| `GET/POST/DELETE /api/haccp/ccp-logs` | `haccp.js` | ✅ Active — supports `?location_id=` |
| `GET /api/haccp/report` | `haccp.js` | ✅ Active — supports `?location_id=` |
| `GET/POST/PUT/DELETE /api/locations` | `locations.js` | ✅ Active — supports `?market_id=&group_id=&active=` |
| `GET/POST/PUT/DELETE /api/location-groups` | `location-groups.js` | ✅ Active |

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
  /countries      → CountriesPage
  /categories     → CategoriesPage
  /inventory      → InventoryPage
  /recipes        → RecipesPage
  /menus          → MenusPage          ← currently redirects to /dashboard
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

**Tabs:** Units | Price Levels | Exchange Rates | System | COGS Thresholds

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

### ✅ Menus Page (`/menus`)

Three tabs:

1. **Menu Builder** — create menus per country, add recipe/ingredient items with display name + sort order
2. **PLT (Price Level Table)** — grid of sell prices per menu item per price level; inline editing with currency conversion
3. **MPT (Menu Performance Table)** — COGS% grid showing gross/net margins per item per price level

**Currency conversion in PLT/MPT:**

- All prices stored in USD base
- Display rate: `dispRate = country.rate / targetCurrency.rate`
- Save-back: `localPrice = displayValue / dispRate`
- MPT always shows local currency (`dispRate = 1`)

### ✅ Dashboard Page (`/dashboard`)

- 8 KPI cards: ingredients, recipes, vendors, markets, active quotes, categories, price levels, coverage %
- Price quote coverage progress bar (green/amber/red)
- Missing quotes panel: top 10 ingredients with no active price quote
- Recent active quotes list
- Quick links to all main pages
- Refresh button (silent re-fetch, shows last-updated time)

---

## 13. Pages Remaining to Build

| Page | Route | Priority | Notes |
|---|---|---|---|
| **Menus → API activation** | `/api/menus` | Now | Uncomment `menus.js` in `api/src/routes/index.js`; the UI is built |
| **COGS API** | `/api/cogs` | Now | Uncomment `cogs.js`; powers the MPT tab calculations |
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

## 14. Known Bugs Fixed

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

## 15. Critical Gotchas & Lessons Learned

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

---

## 16. Backlog

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

### Lightsail Upgrade

Current $10/mo instance (2GB RAM, 1 vCPU) is dev/staging tier. For production with real franchise operators, upgrade to $20/mo (4GB RAM, 2 vCPU). Take a Lightsail snapshot before upgrading.

---

## 17. Key Contacts & Resources

| Resource | URL/Value |
|---|---|
| **Production App** | https://obscurekitty.com |
| **GitHub Repo** | https://github.com/mawegrzyn-ux/COGS |
| **Auth0 Dashboard** | https://manage.auth0.com → tenant: `obscurekitty.uk.auth0.com` |
| **AWS Lightsail Console** | https://lightsail.aws.amazon.com |
| **Frankfurter API** (exchange rates) | https://api.frankfurter.app — free, no key |
| **Let's Encrypt / Certbot** | `sudo certbot renew --dry-run` |
| **Enterprise Scale-Up Plan** | [`docs/ENTERPRISE_SCALE.md`](docs/ENTERPRISE_SCALE.md) |

---

*README last updated: March 2026*
