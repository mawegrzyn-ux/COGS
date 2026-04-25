# COGS Manager

> **⚠️ DEVELOPER ONLY** — This file contains sensitive infrastructure details (server IPs, Auth0 config, database credentials, SSH key paths, API architecture). Access should be restricted to developers with the `is_dev` flag. Do not share with operators or external reviewers.

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
21. [Stock Manager Module](#21-stock-manager-module)
22. [Audit Log](#22-audit-log)

---

## 1. Project Overview

| Field | Value |
|---|---|
| **App** | Menu COGS Calculator |
| **Origin** | WordPress plugin v3.3.0 — migrated to React/Node/PostgreSQL |
| **Server** | AWS Lightsail instance "WRI" — Ubuntu 24.04, $10/mo, 2GB RAM, 1 vCPU |
| **IP** | `13.135.158.196` (static) |
| **Domain** | `cogs.macaroonie.com` |
| **SSL** | Let's Encrypt via Certbot — auto-renews |
| **Web Server** | Nginx (reverse proxy → Node API on port 3001) |
| **Process Manager** | PM2 running as `ubuntu` user (process name: `menu-cogs-api`) |
| **Auth** | Auth0 — tenant: `obscurekitty.uk.auth0.com` |
| **Database** | PostgreSQL 16 — database: `mcogs`, 88 tables (all prefixed `mcogs_`), 131 migration steps |
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
│       │   ├── AppLayout.tsx       # Main layout shell (sidebar + outlet + Pepper dock)
│       │   ├── Sidebar.tsx         # Collapsible left nav
│       │   ├── Logo.tsx            # SVG logo component
│       │   ├── LoadingScreen.tsx   # Auth0 loading spinner
│       │   ├── DataGrid.tsx        # Generic sortable/filterable grid
│       │   ├── ColumnHeader.tsx    # Sort + multi-select filter dropdown
│       │   ├── AiChat.tsx          # Pepper AI chat panel (SSE streaming, dockable)
│       │   ├── PermissionsProvider.tsx  # RBAC context provider (loads /me)
│       │   ├── MediaLibrary.tsx    # Reusable media library browser
│       │   ├── ImageUpload.tsx     # Image upload component
│       │   ├── ImageEditor.tsx     # Image crop/resize editor
│       │   ├── PwaInstallModal.tsx # PWA install prompt
│       │   └── ui.tsx              # Shared UI: PageHeader, Modal, Field,
│       │                           #   EmptyState, Spinner, ConfirmDialog,
│       │                           #   Toast, Badge, CalcInput, PepperHelpButton
│       └── pages/
│           ├── LoginPage.tsx
│           ├── PendingPage.tsx     # Shown when user status is 'pending'
│           ├── DashboardPage.tsx   # KPI tiles, coverage, menu tiles
│           ├── ConfigurationPage.tsx   # Unified config hub (replaces Settings/Markets/Categories/Import)
│           ├── SystemPage.tsx      # System info, architecture docs, DB management, audit log
│           ├── SettingsPage.tsx    # Legacy — embedded by ConfigurationPage/SystemPage
│           ├── CountriesPage.tsx   # Legacy — redirects to /configuration
│           ├── CategoriesPage.tsx  # Legacy — redirects to /configuration
│           ├── MarketsPage.tsx     # Legacy — redirects to /configuration
│           ├── LocationsPage.tsx   # Legacy — redirects to /configuration
│           ├── ImportPage.tsx      # AI-powered data import wizard
│           ├── InventoryPage.tsx   # Ingredients, vendors, price quotes
│           ├── RecipesPage.tsx     # Recipe builder with COGS calculation
│           ├── SalesItemsPage.tsx  # Sales item catalog (recipe/ingredient/manual/combo)
│           ├── MenusPage.tsx       # Menu builder (Menus/Menu Engineer/Shared Links tabs)
│           ├── AllergenMatrixPage.tsx  # Allergen matrix (EU/UK FIC 14)
│           ├── HACCPPage.tsx       # HACCP temp logs & CCP logs
│           ├── StockManagerPage.tsx # Stock Manager (8 tabs)
│           ├── BugsBacklogPage.tsx # Bug tracker + feature backlog
│           ├── MediaLibraryPage.tsx # Media library manager (images, S3/local)
│           ├── PosTesterPage.tsx   # POS functional mockup (System → POS Mockup)
│           ├── SharedMenuPage.tsx  # Public shared menu page (no auth, /share/:slug)
│           └── HelpPage.tsx        # Help & documentation (Guide + Library + FAQ tabs)
│
├── api/                            # Node.js/Express API
│   ├── package.json
│   ├── .env                        # NOT in git — see env vars section
│   └── src/
│       ├── jobs/
│       │   └── consolidateMemory.js  # Nightly memory consolidation job (cron + manual trigger)
│       ├── index.js                # Express entry point
│       ├── db/
│       │   ├── pool.js             # PostgreSQL connection pool (supports local + standalone)
│       │   └── config.js           # DB mode detection, pool config builder
│       ├── middleware/
│       │   └── auth.js             # requireAuth, requirePermission, applyMarketScope
│       ├── helpers/
│       │   ├── agenticStream.js    # Shared SSE agentic loop (ai-chat + ai-upload)
│       │   ├── audit.js            # Audit logger: logAudit() + diffFields()
│       │   └── github.js           # GitHub REST API wrapper (PAT-based)
│       └── routes/
│           ├── index.js            # Route registry (57+ routes)
│           ├── health.js
│           ├── me.js               # Current user profile + permissions
│           ├── users.js            # User management (approve/disable/role)
│           ├── roles.js            # RBAC role + permission matrix
│           ├── settings.js
│           ├── units.js
│           ├── price-levels.js
│           ├── sync-exchange-rates.js
│           ├── countries.js
│           ├── tax-rates.js
│           ├── country-level-tax.js
│           ├── categories.js
│           ├── category-groups.js  # Category groups CRUD
│           ├── vendors.js
│           ├── brand-partners.js   # Brand partners CRUD
│           ├── ingredients.js
│           ├── price-quotes.js
│           ├── preferred-vendors.js
│           ├── recipes.js
│           ├── menus.js
│           ├── scenarios.js        # Menu scenarios (qty/price/cost overrides, smart scenario)
│           ├── menu-items.js
│           ├── menu-item-prices.js
│           ├── shared-pages.js     # Shared menu engineer pages (public + auth)
│           ├── sales-items.js      # Sales item catalog CRUD
│           ├── combos.js           # Standalone combos CRUD
│           ├── combo-templates.js  # Combo templates CRUD
│           ├── modifier-groups.js  # Modifier groups + options CRUD
│           ├── menu-sales-items.js # Menu ↔ sales items link
│           ├── cogs.js             # COGS calculation engine
│           ├── allergens.js
│           ├── nutrition.js        # USDA nutrition proxy
│           ├── haccp.js
│           ├── locations.js
│           ├── location-groups.js
│           ├── import.js           # AI import pipeline — exports { router, stageFileContent }
│           ├── ai-chat.js          # Pepper AI chat (97 tools)
│           ├── ai-upload.js        # File upload → AI extraction (multipart)
│           ├── ai-config.js        # AI feature flag / config
│           ├── db-config.js        # Database management (local ↔ standalone switch)
│           ├── memory.js           # Pepper memory (pinned notes + user profile)
│           ├── media.js            # Media library CRUD (local disk + S3)
│           ├── media-file.js       # Public media file serving (no auth)
│           ├── upload.js           # Generic image upload (local/S3)
│           ├── docs.js             # CLAUDE.md viewer API
│           ├── feedback.js
│           ├── internal-feedback.js
│           ├── bugs.js             # Bug tracker CRUD
│           ├── backlog.js          # Feature backlog CRUD
│           ├── internal-bugs.js    # Internal bug submission (no auth)
│           ├── internal-backlog.js # Internal backlog submission (no auth)
│           ├── seed.js             # Test data seeder (admin only)
│           ├── stock-stores.js         # Stock stores CRUD (sub-locations)
│           ├── stock-levels.js         # Stock on hand, adjustments, movements
│           ├── purchase-orders.js      # Purchase order lifecycle
│           ├── order-templates.js      # Saved PO templates
│           ├── goods-received.js       # Goods received notes (GRN)
│           ├── invoices.js             # Invoice lifecycle
│           ├── credit-notes.js         # Credit notes
│           ├── waste.js                # Waste logging + reason codes
│           ├── stock-transfers.js      # Inter-store stock transfers
│           ├── stocktakes.js           # Stocktake sessions + counts
│           └── audit.js                # Central audit log (read-only)
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
| `/etc/letsencrypt/live/cogs.macaroonie.com/` | SSL certificate files |
| `~/.ssh/id_ed25519_cogs` | Deploy SSH key (read-only pull from GitHub) |
| `~/.ssh/config` | SSH config (routes `github.com` to the correct key) |

### API `.env` File (on server at `/var/www/menu-cogs/api/.env`)

```env
# Local mode — DB runs on the same box as the API (current production default)
DB_MODE=local
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mcogs
DB_USER=mcogs
DB_PASSWORD=<generated strong password — check server>
NODE_ENV=production
PORT=3001
CONFIG_STORE_SECRET=<64-char hex key for AES-256-GCM encryption — see below>
```

### Two-Database Architecture (Config Store)

The API uses a **two-database system**:

1. **`mcogs_config`** (always local) — stores encrypted DB connection settings and API keys via AES-256-GCM. Never moves to a remote host.
2. **`mcogs`** (local OR standalone) — all transactional/application data.

`CONFIG_STORE_SECRET` is a 64-character hex key used to encrypt sensitive values in the config store. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

The API also supports **standalone mode** for running PostgreSQL on a
separate host (e.g. AWS RDS). Set `DB_MODE=standalone`, point `DB_HOST` at
the remote endpoint (or use `DB_CONNECTION_STRING`), and SSL is enabled by
default. Admins can also switch modes — including **copying all data** from
the current database into a new target in one click — from the UI at
**System → Database** (gated by `settings:write`). See
[`docs/DATABASE.md`](./docs/DATABASE.md) and
[`api/.env.example`](./api/.env.example) for the full variable reference,
the Migrate Data & Switch walkthrough, and the AWS RDS setup steps.

### Database Management API (`/api/db-config`)

| Endpoint | Purpose |
|---|---|
| `GET /api/db-config` | Current stored + active config (password masked) |
| `POST /api/db-config/test` | Dry-run candidate config |
| `PUT /api/db-config` | Save & validate new config |
| `POST /api/db-config/restart` | Graceful exit for PM2 respawn |
| `POST /api/db-config/migrate` | Schema migrations on active pool |
| `POST /api/db-config/probe` | Ping current pool |
| `POST /api/db-config/migrate-preview` | Count rows on source vs target |
| `POST /api/db-config/migrate-data` | Copy schema + all data, then save |

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

> **Note:** Auth0 requires the callback URL `http://localhost:5173` to be in the **Allowed Callback URLs** list in the Auth0 dashboard. Add it alongside `https://cogs.macaroonie.com`.

---

## 6. CI/CD Pipeline

Every push to `main` triggers `.github/workflows/deploy.yml` automatically.

### Pipeline Steps

1. Checkout code
2. Install frontend npm dependencies (`app/`)
3. Build React app with Vite — env vars baked in from GitHub Secrets
4. SCP `app/dist/` to `/var/www/menu-cogs/frontend/` on server
5. SSH into server: `git pull` → `npm install` → `pm2 restart` → `nginx reload`
6. Health check: `GET https://cogs.macaroonie.com/api/health` must return `{"status":"ok"}`

### GitHub Secrets Required

| Secret | Value |
|---|---|
| `LIGHTSAIL_HOST` | `cogs.macaroonie.com` |
| `LIGHTSAIL_USER` | `ubuntu` |
| `LIGHTSAIL_SSH_KEY` | Full private SSH key content (including `-----BEGIN OPENSSH PRIVATE KEY-----`) |
| `VITE_API_URL` | `https://cogs.macaroonie.com/api` |
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
| **Allowed Callback URLs** | `https://cogs.macaroonie.com`, `http://localhost:5173` |
| **Allowed Logout URLs** | `https://cogs.macaroonie.com/login`, `http://localhost:5173/login` |
| **Allowed Web Origins** | `https://cogs.macaroonie.com`, `http://localhost:5173` |
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

| # | Table | Step | Purpose |
|---|---|---|---|
| 1 | `mcogs_units` | 1 | Measurement units (kg, litre, each, etc.) |
| 2 | `mcogs_price_levels` | 2 | Price levels (Dine In, Delivery) |
| 3 | `mcogs_countries` | 3 | Countries with currency codes, symbols, exchange rates, default price level |
| 4 | `mcogs_country_tax_rates` | 4 | Tax rates per country (e.g. UK VAT 20%) |
| 5 | `mcogs_country_level_tax` | 5 | Junction: which tax rate applies to which price level per country |
| 6 | `mcogs_categories` | 6 | Categories with `group_id` FK → `mcogs_category_groups` and scope flags (`for_ingredients`, `for_recipes`, `for_sales_items`) |
| 7 | `mcogs_vendors` | 7 | Suppliers/vendors, linked to a country |
| 8 | `mcogs_ingredients` | 8 | Ingredient master list with base unit, waste %, prep conversion |
| 9 | `mcogs_price_quotes` | 9 | Vendor pricing per ingredient: purchase price, qty, unit, active flag |
| 10 | `mcogs_ingredient_preferred_vendor` | 10 | Per ingredient+country: which vendor+quote is preferred |
| 11 | `mcogs_recipes` | 11 | Recipe definitions with yield qty and yield unit |
| 12 | `mcogs_recipe_items` | 12 | Recipe line items: ingredient or sub-recipe, `prep_qty`, prep unit, conversion |
| 13 | `mcogs_menus` | 13 | Menu definitions, linked to a country |
| 14 | `mcogs_menu_items` | 14 | Legacy menu line items (superseded by `mcogs_menu_sales_items`) |
| 15 | `mcogs_menu_item_prices` | 15 | Sell prices per menu item per price level, with tax rate |
| 16 | `mcogs_locations` | 16 | Physical store locations — linked to market, optional group, address, contact details |
| 17 | `mcogs_location_groups` | 22 | Clusters of locations (e.g. "London Central") — optional grouping |
| 18 | `mcogs_allergens` | 17 | EU/UK FIC reference allergens (14 regulated) |
| 19 | `mcogs_ingredient_allergens` | 18 | Junction: allergen status per ingredient (contains/may_contain/free_from) |
| 20 | `mcogs_equipment` | 19 | HACCP equipment register — linked to location |
| 21 | `mcogs_equipment_temp_logs` | 20 | Temperature readings per equipment |
| 22 | `mcogs_ccp_logs` | 21 | CCP logs (cooking/cooling/delivery) — linked to location |
| 23 | `mcogs_brand_partners` | 23 | Brand/franchise partners — linked to markets |
| 24 | `mcogs_feedback` | 24 | User feedback submissions |
| 25 | `mcogs_ai_chat_log` | 25 | Pepper AI conversation log: messages, tools_called, token counts, context JSONB |
| 26 | `mcogs_import_jobs` | 26 | AI import staging jobs: raw AI output, enriched rows, status, created_by |
| 27 | `mcogs_menu_scenarios` | 27-28 | Saved scenarios with qty_data, price_overrides, cost_overrides, history JSONB |
| 28 | `mcogs_shared_pages` | 29 | Shared menu engineer pages (slug, password, mode, expiry) |
| 29 | `mcogs_shared_page_changes` | 30 | Change log for shared page edits (price changes, comments) |
| 30 | `mcogs_recipe_pl_variations` | 31-32 | Recipe price-level and market+PL variations |
| 31 | `mcogs_roles` | 33 | RBAC roles (Admin/Operator/Viewer + custom). `is_system` protects built-in roles |
| 32 | `mcogs_role_permissions` | 34 | Permission level per role per feature: `none` / `read` / `write`. UNIQUE(role_id, feature) |
| 33 | `mcogs_users` | 35 | App users mapped from Auth0 sub. Stores status, role, `is_dev` flag, last login |
| 34 | `mcogs_user_brand_partners` | 36 | Market scope: which brand partners a user is allowed to see. Empty = unrestricted |
| 35 | `mcogs_sales_items` | 39 | Sales item catalog (item_type: recipe/ingredient/manual/combo, category_id, image_url) |
| 36 | `mcogs_sales_item_markets` | 40 | Per-item market visibility + `is_active` flag |
| 37 | `mcogs_sales_item_prices` | 41 | Default sell prices per item per price level |
| 38 | `mcogs_modifier_groups` | 42 | Reusable modifier group definitions (name, min/max_select, allow_repeat_selection, default_auto_show) |
| 39 | `mcogs_modifier_options` | 43 | Options within a modifier group (item_type, recipe/ingredient/manual, price_addon, qty) |
| 40 | `mcogs_sales_item_modifier_groups` | 44 | Junction: sales_items ↔ modifier_groups (auto_show nullable) |
| 41 | `mcogs_combo_steps` | 45 | Steps within a combo (linked via combo_id) |
| 42 | `mcogs_combo_step_options` | 46 | Options per combo step (item_type, recipe/ingredient/manual, price_addon) |
| 43 | `mcogs_combo_step_option_modifier_groups` | 47 | Junction: combo step options ↔ modifier_groups (auto_show nullable) |
| 44 | `mcogs_menu_sales_items` | 48 | Menu ↔ sales_items link (sort_order, allergen_notes, qty) |
| 45 | `mcogs_menu_sales_item_prices` | 49 | Per-menu price overrides per sales item per price level |
| 46 | `mcogs_category_groups` | 50 | Unified category groups (name, sort_order) — canonical grouping mechanism |
| 47 | `mcogs_combos` | 68 | Standalone combos table (name, description, image_url) |
| 48 | `mcogs_combo_templates` | 74 | Combo templates (reusable combo configurations) |
| 49 | `mcogs_combo_template_steps` | 75 | Template steps |
| 50 | `mcogs_combo_template_step_options` | 76 | Template step options |
| 51 | `mcogs_media_categories` | 83 | Media library categories (name, sort_order) |
| 52 | `mcogs_media_items` | 84 | Media items (original + thumb + web variants, local/S3, scope/form_key) |
| 53 | `mcogs_menu_combo_option_prices` | — | Menu-level combo step option price overrides per price level |
| 54 | `mcogs_menu_modifier_option_prices` | — | Menu-level modifier option price overrides per price level |
| 55 | `mcogs_stores` | 86 | Sub-locations within a location (kitchen, bar, walk-in). `is_store_itself` flag |
| 56 | `mcogs_stock_levels` | 87 | Materialized stock on hand per store per ingredient. UNIQUE(store_id, ingredient_id) |
| 57 | `mcogs_stock_movements` | 88 | Immutable audit ledger of all stock changes |
| 58 | `mcogs_purchase_orders` | 89 | PO lifecycle: draft → submitted → partial → received → cancelled |
| 59 | `mcogs_purchase_order_items` | 89 | PO line items with per-item store_id, quote_id link |
| 60 | `mcogs_order_templates` | 90 | Saved PO templates for recurring vendor orders |
| 61 | `mcogs_order_template_items` | 90 | Template line items |
| 62 | `mcogs_goods_received` | 91 | GRN lifecycle: draft → confirmed. On confirm: updates stock |
| 63 | `mcogs_goods_received_items` | 91 | GRN line items |
| 64 | `mcogs_invoices` | 92 | Invoice lifecycle: draft → pending → approved → paid → disputed |
| 65 | `mcogs_invoice_items` | 92 | Invoice line items (ingredient optional — supports non-ingredient charges) |
| 66 | `mcogs_credit_notes` | 93 | Credit note lifecycle: draft → submitted → approved → applied |
| 67 | `mcogs_credit_note_items` | 93 | Credit note line items |
| 68 | `mcogs_waste_reason_codes` | 94 | Configurable waste reason codes (Expired, Damaged, Spillage, etc.) |
| 69 | `mcogs_waste_log` | 94 | Waste events with quantity, cost, reason code |
| 70 | `mcogs_stock_transfers` | 95 | Two-step transfers: pending → in_transit → confirmed. CHECK(from != to) |
| 71 | `mcogs_stock_transfer_items` | 95 | Transfer line items with qty_sent and qty_received |
| 72 | `mcogs_stocktakes` | 96 | Stocktake sessions: full or spot_check. in_progress → completed → approved |
| 73 | `mcogs_stocktake_items` | 96 | Count items with expected/counted/variance. UNIQUE(stocktake_id, ingredient_id) |
| 74 | `mcogs_audit_log` | 100 | Central audit trail: action, entity, field_changes JSONB, context JSONB, related_entities JSONB |
| 75 | `mcogs_user_notes` | 102 | Pepper memory: pinned notes per user (user_sub, note TEXT, created_at) |
| 76 | `mcogs_user_profiles` | 103 | Pepper memory: user profile (user_sub UNIQUE, display_name, profile_json JSONB, long_term_summary TEXT) |
| 77 | `mcogs_bugs` | 107 | Bug tracker (key, summary, priority, status, severity, labels JSONB) |
| 78 | `mcogs_backlog` | 107 | Feature backlog (key, summary, item_type, priority, status, story_points) |
| 79 | `mcogs_memory_daily` | 117 | Nightly AI memory consolidation: daily summaries per user (user_sub, summary_date, summary, topics JSONB, tools_used JSONB) |
| 80 | `mcogs_memory_monthly` | 117 | Monthly AI memory consolidation: monthly overviews per user (user_sub, summary_month, summary, themes JSONB, focus_shifts JSONB, is_quarterly) |
| 81 | `mcogs_faq` | 118 | FAQ knowledge base: searchable Q&A entries (question, answer, category, tags JSONB, sort_order, is_published) |
| 82 | `mcogs_changelog` | 120 | Project change log: version, title, entries JSONB array of {type, description}. Read-only in UI, updated at EOS. |
| 83 | `mcogs_qsc_questions` | 124-125 | QSC audit question bank (150 seeded from Wingstop spec v1). Fields: code, version, department, category, title, risk_level, points, repeat_points, policy, auto_unacceptable, photo_required, temperature_input, cross_refs JSONB, sort_order, active. UNIQUE(code, version). |
| 84 | `mcogs_qsc_templates` | 126, 128 | Named subsets used for internal ad-hoc audits (7 system templates seeded). Fields: name, description, question_codes JSONB, is_system, created_by. |
| 85 | `mcogs_qsc_audits` | 127 | Audit runs. key (AUD-1001+), audit_type (external/internal), location_id FK, template_id FK, question_version (pinned at start), auditor_sub/name, status, overall_score, overall_rating, auto_unacceptable, notes. |
| 86 | `mcogs_qsc_responses` | 127 | One row per answered question per audit. status (compliant/not_compliant/not_observed/not_applicable/informational), is_repeat, points_deducted, comment, temperature_value/unit, product_name. UNIQUE(audit_id, question_code). |
| 87 | `mcogs_qsc_response_photos` | 127 | 0..N photos per response (url + caption). |

### Key Schema Details

**`mcogs_countries`**
```sql
id, name, currency_code, currency_symbol, exchange_rate (vs USD base),
default_price_level_id → mcogs_price_levels
```

**`mcogs_ingredients`**
```sql
id, name, category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL,
base_unit_id, default_prep_unit, default_prep_to_base_conversion,
waste_pct (0–100), notes, image_url, allergen_notes TEXT
-- category_id replaces the old denormalised category VARCHAR column
-- Queries JOIN mcogs_categories to resolve name: LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
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
id, name VARCHAR(100),
group_id INTEGER REFERENCES mcogs_category_groups(id) ON DELETE SET NULL,  -- FK to group table
group_name VARCHAR(100),                          -- legacy compat; group_id is canonical
for_ingredients BOOLEAN DEFAULT false,            -- scope flags (replace old 'type' column)
for_recipes     BOOLEAN DEFAULT false,
for_sales_items BOOLEAN DEFAULT false
-- Filter by scope: WHERE for_ingredients=true / WHERE for_recipes=true / WHERE for_sales_items=true
-- A category can have multiple scope flags set (e.g. for_recipes=true AND for_sales_items=true)
```

**`mcogs_category_groups`**
```sql
id, name VARCHAR(100) NOT NULL UNIQUE, sort_order INTEGER DEFAULT 0
-- Live table — groups are the canonical grouping mechanism for categories
-- The old group_name VARCHAR on mcogs_categories is kept for legacy compat but group_id FK is preferred
```

**`mcogs_recipes`**
```sql
id, name, category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL,
yield_qty, yield_unit_id
-- category_id replaces the old denormalised category VARCHAR column
-- Queries JOIN mcogs_categories: LEFT JOIN mcogs_categories cat ON cat.id = r.category_id
```

### Indexes

```sql
idx_price_quotes_ingredient     ON mcogs_price_quotes(ingredient_id)
idx_price_quotes_ingredient_act ON mcogs_price_quotes(ingredient_id, is_active)  -- covers LATERAL count
idx_price_quotes_vendor         ON mcogs_price_quotes(vendor_id)
idx_recipe_items_recipe        ON mcogs_recipe_items(recipe_id)
idx_menu_items_menu            ON mcogs_menu_items(menu_id)
idx_vendors_country            ON mcogs_vendors(country_id)
idx_ingredients_category_id    ON mcogs_ingredients(category_id)
idx_recipes_category_id        ON mcogs_recipes(category_id)
-- NOTE: old idx_ingredients_category / idx_recipes_category on the dropped VARCHAR column are gone
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
| `GET/POST/PUT/DELETE /api/ingredients` | `ingredients.js` | ✅ Active — GET uses LATERAL subquery for quote counts (avoids GROUP BY on full join) |
| `GET /api/ingredients/stats` | `ingredients.js` | ✅ Active — lightweight counts for Inventory header badges; returns `{ingredient_count, active_quote_count, vendor_count, country_count}` |
| `GET/POST/PUT/DELETE /api/price-quotes` | `price-quotes.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/preferred-vendors` | `preferred-vendors.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/recipes` | `recipes.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/menus` | `menus.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/scenarios` | `scenarios.js` | ✅ Active — menu scenarios (qty/price/cost overrides, history, smart scenario) |
| `POST /api/scenarios/push-prices` | `scenarios.js` | ✅ Active — push scenario price overrides to live menu |
| `POST /api/scenarios/smart` | `scenarios.js` | ✅ Active — Claude Haiku-powered price/cost change proposals |
| `POST /api/scenarios/analysis` | `scenarios.js` | ✅ Active — menu items with base cost, effective cost, price per level |
| `GET/POST/PUT/DELETE /api/menu-items` | `menu-items.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/menu-item-prices` | `menu-item-prices.js` | ✅ Active |
| `GET/POST/PUT/DELETE /api/shared-pages` | `shared-pages.js` | ✅ Active — shared menu engineer pages (auth routes) |
| `GET/POST /api/public/share/:slug` | `shared-pages.js` | ✅ Active — public shared pages (no auth) |
| `GET/POST/PUT/DELETE /api/sales-items` | `sales-items.js` | ✅ Active — sales item catalog (recipe/ingredient/manual/combo) |
| `GET/POST/PUT/DELETE /api/combos` | `combos.js` | ✅ Active — standalone combos + steps + options |
| `GET/POST/PUT/DELETE /api/combo-templates` | `combo-templates.js` | ✅ Active — reusable combo templates |
| `GET/POST/PUT/DELETE /api/modifier-groups` | `modifier-groups.js` | ✅ Active — modifier groups + options CRUD |
| `GET/POST/PUT/DELETE /api/menu-sales-items` | `menu-sales-items.js` | ✅ Active — menu ↔ sales items link + per-menu prices |
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
| `POST /api/ai-chat` | `ai-chat.js` | ✅ Active — SSE streaming Pepper chat with 96 tools (includes web search, GitHub, Excel export, audit log, and FAQ search) |
| `GET /api/ai-chat/my-usage` | `ai-chat.js` | ✅ Active — current period token usage stats |
| `POST /api/ai-upload` | `ai-upload.js` | ✅ Active — multipart file + chat message → SSE (vision/CSV) |
| `GET/PUT /api/ai-config` | `ai-config.js` | ✅ Active — AI feature flag configuration (stores ANTHROPIC/VOYAGE/BRAVE/GITHUB/JIRA keys + MAPBOX_ACCESS_TOKEN + OPENAI_API_KEY in the encrypted config store) |
| `POST /api/ai-transcribe` | `ai-transcribe.js` | ✅ Active — multipart audio → OpenAI Whisper → `{text}`. Used by the PWA voice-input fallback on Safari/iOS (Chromium uses native SpeechRecognition). 25 MB cap, 503 if `OPENAI_API_KEY` isn't configured. |
| `GET /api/ai-config/claude-code-key` | `ai-config.js` | ✅ Active — returns the self-generated Claude Code API key (only plaintext key ever returned) |
| `POST /api/ai-config/generate-claude-code-key` | `ai-config.js` | ✅ Active — (re)generates the Claude Code API key |
| `GET /api/ai-config/mapbox-token` | `ai-config.js` | ✅ Active — returns the Mapbox PUBLIC token (pk.*) for browser map widgets. Public tokens are safe to expose (expected to be URL-restricted in the Mapbox dashboard). |
| `GET/POST/PUT/DELETE /api/db-config` | `db-config.js` | ✅ Active — database management (local ↔ standalone switch, migrate data) |
| `GET/POST/PUT/DELETE /api/stock-stores` | `stock-stores.js` | ✅ Active — requires `stock_overview:read` / `stock_overview:write` |
| `GET/PUT/POST /api/stock-levels` | `stock-levels.js` | ✅ Active — stock on hand, adjustments, movements query |
| `GET/POST/PUT/DELETE /api/purchase-orders` | `purchase-orders.js` | ✅ Active — PO lifecycle + line items + quote-lookup |
| `GET/POST/PUT/DELETE /api/order-templates` | `order-templates.js` | ✅ Active — saved PO templates |
| `GET/POST/PUT/DELETE /api/goods-received` | `goods-received.js` | ✅ Active — GRN lifecycle, confirm updates stock |
| `GET/POST/PUT/DELETE /api/invoices` | `invoices.js` | ✅ Active — invoice lifecycle + from-GRN creation |
| `GET/POST/PUT/DELETE /api/credit-notes` | `credit-notes.js` | ✅ Active — credit note lifecycle |
| `GET/POST/DELETE /api/waste` | `waste.js` | ✅ Active — waste logging, reason codes, summary report |
| `GET/POST/PUT/DELETE /api/stock-transfers` | `stock-transfers.js` | ✅ Active — two-step transfer lifecycle |
| `GET/POST/PUT/DELETE /api/stocktakes` | `stocktakes.js` | ✅ Active — stocktake lifecycle + populate + approve |
| `GET /api/audit` | `audit.js` | ✅ Active — central audit log query (entity, field, stats) |
| `GET/POST/DELETE /api/memory/notes` | `memory.js` | ✅ Active — pinned notes for Pepper memory |
| `GET/PUT /api/memory/profile` | `memory.js` | ✅ Active — user profile for Pepper memory |
| `GET/POST/PUT/DELETE /api/media` | `media.js` | ✅ Active — media library CRUD (upload, categorize, bulk ops) |
| `POST /api/media/migrate-to-s3` | `media.js` | ✅ Active — SSE migration from local to S3 |
| `GET /api/media/img/:filename` | `media-file.js` | ✅ Active — public media file serving (no auth) |
| `POST /api/upload` | `upload.js` | ✅ Active — generic image upload (local disk or S3) |
| `GET /api/docs/claude-md` | `docs.js` | ✅ Active — CLAUDE.md raw content viewer |
| `POST /api/seed` | `seed.js` | ✅ Active — test data seeder (admin only) |
| `GET/POST /api/feedback` | `feedback.js` | ✅ Active — user feedback |
| `GET/POST/PUT/DELETE /api/bugs` | `bugs.js` | ✅ Active — bug tracker CRUD |
| `GET/POST/PUT/DELETE /api/backlog` | `backlog.js` | ✅ Active — feature backlog CRUD |
| `GET /api/jira`, `POST /api/jira/test` | `jira.js` | ✅ Active — Jira integration status + connection test. Admin-only (`settings:write`). |
| `POST /api/jira/push/:type/:id`, `POST /api/jira/push/bulk` | `jira.js` | ✅ Active — push bug/backlog items to Jira (create-or-update with status transition). |
| `POST /api/jira/pull/:type/:id`, `POST /api/jira/pull/all` | `jira.js` | ✅ Active — pull Jira fields (status + priority + summary + description + labels) back into local rows. Calls shared `syncAll()` helper which records outcome to `mcogs_settings.data.jira_sync_status`. |
| `GET /api/jira/sync-status` | `jira.js` | ✅ Active — returns `{configured, status}` for the UI banner on the Bugs & Backlog page. |
| `POST /api/jira/unlink/:type/:id` | `jira.js` | ✅ Active — drops the local→Jira link (leaves Jira issue alone). |
| `GET/PUT /api/qsc/questions[/:code]` | `qsc.js` | ✅ Active — QSC question bank (150 seeded). PUT gated by `audits_admin:write`. |
| `GET/POST/PUT/DELETE /api/qsc/templates[/:id]` | `qsc.js` | ✅ Active — audit templates for internal ad-hoc audits. System templates read-only. |
| `GET/POST/PUT/DELETE /api/qsc/audits[/:id]` | `qsc.js` | ✅ Active — audit lifecycle: in_progress → completed/cancelled. Delete refuses completed (immutable). |
| `GET /api/qsc/audits/:id/report` | `qsc.js` | ✅ Active — precomputed report: by department, by category, critical/NC/repeat findings, informational. |
| `GET /api/qsc/audits/:id/export.csv` | `qsc.js` | ✅ Active — one row per response CSV export. |
| `POST /api/qsc/audits/:id/complete` | `qsc.js` | ✅ Active — finalize: scoring engine, auto-unacceptable check, rating band. External audits require all scored questions answered. |
| `POST /api/qsc/audits/:id/cancel` | `qsc.js` | ✅ Active — cancel in-progress audit. |
| `PUT/DELETE /api/qsc/audits/:id/responses/:code` | `qsc.js` | ✅ Active — upsert/clear a single response (auto-save). |
| `POST/DELETE /api/qsc/audits/:id/responses/:code/photos` | `qsc.js` | ✅ Active — attach/detach pre-uploaded photo URL (upload via `/api/upload` first). |
| `GET /api/qsc/locations/:id/last-external` | `qsc.js` | ✅ Active — previous external audit for repeat-finding suggestion. |
| `GET/POST /api/category-groups` | `category-groups.js` | ✅ Active — category groups CRUD |
| `GET/POST/PUT/DELETE /api/faq` | `faq.js` | ✅ Active — FAQ knowledge base CRUD + search |
| `GET /api/faq/search` | `faq.js` | ✅ Active — FAQ full-text search (`?q=`) |
| `POST /api/memory/consolidate` | `memory.js` | ✅ Active — admin-only manual memory consolidation trigger |
| `GET /api/memory/consolidation-status` | `memory.js` | ✅ Active — last consolidation run status |

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
/share/:slug      → SharedMenuPage (public, no auth)
/                 → ProtectedRoute → AppLayout (Outlet)
  /dashboard      → DashboardPage
  /configuration  → ConfigurationPage   (unified config hub)
  /system         → SystemPage          (architecture, DB management, audit log)
  /inventory      �� InventoryPage
  /recipes        → RecipesPage
  /sales-items    → SalesItemsPage
  /menus          → MenusPage
  /allergens      → AllergenMatrixPage
  /haccp          → HACCPPage
  /audits                → AuditsPage            (QSC audit dashboard + list)
  /audits/templates      → AuditTemplatesPage    (internal-audit template CRUD)
  /audits/:id/run        → AuditRunnerPage       (question-by-question, auto-save, photo, temp)
  /audits/:id/report     → AuditReportPage       (scored report with print/CSV export)
  /stock-manager  → StockManagerPage
  /bugs-backlog   → redirects to /system (Bugs & Backlog embedded in SystemPage)
  /media          → MediaLibraryPage
  /help           → HelpPage
  /pos-tester     → PosTesterPage
  /settings       → redirects to /configuration
  /markets        → redirects to /configuration
  /countries      → redirects to /configuration
  /locations      → redirects to /configuration
  /categories     → redirects to /configuration
  /import         → redirects to /configuration
```

### Sidebar Navigation

```
Dashboard          feature: dashboard
Inventory          feature: inventory
Recipes            feature: recipes
Sales Items        feature: menus
Menus              feature: menus
─────────────────
Allergens          feature: allergens
HACCP              feature: haccp
Audits             feature: audits
Stock Manager      features: stock_overview + 6 granular stock features
─────────────────
Configuration      feature: settings
System             feature: null (always visible)  ← includes Bugs & Backlog section
Help               feature: null (always visible)
```

To activate a new page route:
1. Create the page component in `app/src/pages/`
2. Import it in `App.tsx`
3. Replace the `<Navigate>` placeholder with the new component

### Global App Switches

Three app-wide context switches live in `AppLayout` top bar and persist across navigation. All are user-controlled, scope what the rest of the app sees, and are consumed by both the frontend and the API. **All new pages and tools should respect them automatically by using the standard hooks (`useMarket`, `useCurrency`, `useApi`).**

| Switch | Mounted in | File / Context | Storage | Server signal | Default |
|---|---|---|---|---|---|
| **Market** | `AppLayout` top-bar | `app/src/components/MarketSwitcher.tsx` + `contexts/MarketContext.tsx` | `localStorage['cogs-market-country-id']` | Frontend filter only — widgets/pages call `useMarket().countryId` and pass it as a query param where relevant | `null` ("All markets") |
| **Display Currency** ("Show prices in") | `AppLayout` top-bar | `app/src/components/CurrencySwitcher.tsx` + `contexts/CurrencyContext.tsx` | `localStorage['cogs-display-currency']` | Frontend display only — pages call `useCurrency().currencyCode` and resolve the rate against their own active market context | `''` (market currency) |
| **Language** | `AppLayout` top-bar | `app/src/components/LanguageSwitcher.tsx` + `contexts/LanguageContext.tsx` | `localStorage['mcogs-language']` + `mcogs_user_profiles.profile_json.preferred_language` | `X-Language: <code>` header injected by `useApi.ts` on every request → resolved server-side into `req.language` (chain: header → profile → first allowedCountry default → system default → `'en'`) | `'en'` |

#### Market Switcher
- **RBAC-aware:** dropdown only lists countries in the user's `allowedCountries`. If a stored selection falls outside scope after a role change, it auto-clears.
- **Search:** built-in search input when ≥6 countries are visible.
- **Frontend consumers:** Dashboard widgets marked `marketScoped: true` (KPIs, MarketMap, MarketPicker, MarketStats, MarketHeader, MenuTopItemsChart). Other pages opt in by calling `useMarket()`.
- **Pepper integration:** market scope is enforced server-side via `req.user.allowedCountries` (RBAC), not via the dropdown selection — the AI sees the user's full permitted scope, not the currently focused market. See §14.

#### Language Switcher
- **Soft reload on change:** picking a new language reloads the SPA so cached query results re-run with the new `X-Language` header.
- **Static UI strings:** also calls `i18n.changeLanguage(code)` so `react-i18next` swaps Sidebar nav labels and other `t()`-wrapped strings live (no reload needed for those).
- **Backend coverage:** every translatable SELECT wraps the field in `COALESCE(translations->$lang->>'field', field)`. Helpers in `api/src/helpers/translate.js` (`tCol`, `getLangContext`, `setContentLanguage`). Response carries `Content-Language: <code>` and global middleware sets `Vary: X-Language` for CDN safety.
- **Pepper integration:** `req.language` threads into `userCtxWithLang` and `executeTool()` applies COALESCE to all key read tools (list_ingredients, list_recipes, list_menus, etc.). System prompt also instructs Pepper to reply in the user's language. See §23.

#### Co-existence rules
- **No race condition:** Market changes are pure client-side state updates; Language changes trigger a soft reload. If both are toggled in quick succession, the language reload wins and the new market selection is preserved via localStorage.
- **All-markets + non-English language** is fully supported — the global view shows all permitted markets with translated labels.
- **Per-market default language** (`mcogs_countries.default_language_code`) is consulted only when the user has no explicit language preference; once they pick a language manually it overrides the country default.

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

### ✅ Configuration Page (`/configuration`)

Unified configuration hub that replaced the separate Settings, Markets, Categories, and Import pages. All legacy routes (`/settings`, `/markets`, `/countries`, `/locations`, `/categories`, `/import`) redirect here.

**Sections:** Global Config | Location Structure | Categories | Base Units | Price Levels | Currency | COGS Thresholds | Users & Roles | Import | Media Library | Stock Config

- Full CRUD for Units (`mcogs_units`) and Price Levels (`mcogs_price_levels`)
- Exchange Rates syncs from Frankfurter API — no key needed
- COGS Thresholds: configure green/amber/red target percentages
- Users & Roles: user management (approve/disable/role/dev flag), RBAC permission matrix
- Import: AI-powered data import wizard (embedded from ImportPage)
- Media Library: media library settings and category management
- Stock Config: stock manager global settings

### ✅ System Page (`/system`)

System administration and documentation hub.

**Sections:** AI | Bugs & Backlog | Audit Log | Storage | Database | Test Data | Architecture | API Reference | Security | Troubleshooting | Domain Migration | POS Mockup | CLAUDE.md

- **AI** — Embeds Settings → AI (API keys, token usage, concise mode). Integration cards include Anthropic, Voyage, Brave, GitHub, Jira, and **Mapbox** (public `pk.*` access token for the dashboard map widgets — guards against `sk.*` secret tokens with a friendly error since GL JS only works with public tokens).
- **Bugs & Backlog** — Embedded `BugsBacklogPage` (previously standalone at `/bugs-backlog`, now redirects here). Two-tab tracker: bugs (BUG-1001+) and feature backlog (BACK-1001+). Visible to all users. Migration step 108 seeds known bugs and backlog items from CLAUDE.md. **Jira 2-way sync** via the integration: push creates/updates Jira issues; pull reads back status + priority + summary + description + labels (text fields only when Jira's `updated` timestamp is newer than local `updated_at` — conflict guard preserves fresh local edits). Cron `*/15 * * * *` runs `syncAll()` automatically; sync-status banner at the top of Bugs & Backlog reports last-run metrics + has a Sync Now button. Schema columns: `jira_key`, `jira_id`, `jira_url`, `jira_synced_at`, `jira_remote_updated_at` on both `mcogs_bugs` and `mcogs_backlog`. Last-run payload persisted to `mcogs_settings.data.jira_sync_status`. ADF-to-text helper in [jira.js](api/src/helpers/jira.js) flattens Jira's Atlassian Document Format into plain text for the `description` field.
- **Audit Log** — Central audit trail viewer with filters and expandable rows. Gated by `settings:write` (amber ADMIN badge)
- **Storage** — Media storage config (local vs S3). Gated by `settings:write` (amber ADMIN badge)
- **Database** — DB connection mode (local vs standalone/RDS), test/save/migrate/switch. Gated by `settings:write` (amber ADMIN badge)
- **Test Data** — Load Test / Load Small / Clear / Load Defaults. Gated by `is_dev` (purple DEV badge). All destructive actions behind `DateConfirmDialog` (ddmmyyyy)
- **POS Mockup** — Embedded POS functional tester
- **CLAUDE.md** — Project documentation viewer. Gated by `is_dev` (purple DEV badge)

### ✅ Countries Page (`/countries`) — Legacy, redirects to /configuration

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

1. **Ingredients** — full CRUD, category/unit assignment, waste %, prep conversion; **menu filter** dropdown narrows the list to only ingredients used in a selected menu's recipes
2. **Vendors** — full CRUD, country assignment
3. **Price Quotes** — full CRUD per ingredient+vendor, active/inactive flag, preferred vendor assignment per country; **menu filter** dropdown (hidden when "Missing quotes only" is active) narrows quotes to ingredients in a selected menu

### ✅ Recipes Page (`/recipes`)

- Recipe builder: name, category, yield qty + unit
- Recipe items: add ingredients or sub-recipes with qty + prep unit + conversion factor
- COGS calculation: cost per portion based on preferred vendor quotes, with a configurable fallback (see **Recipe Costing Method** below).
- **Market variations** — alternative ingredient lists per country/market (existing)
- **Price Level Recipes (PL Variations)** — alternative ingredient lists per price level. Create via the Price Level variant selector. Priority: PL variation > market variation > global recipe. Stored in `mcogs_recipe_pl_variations`; items linked via `pl_variation_id` on `mcogs_recipe_items`. Copy-to-global promotes a PL variation to the global recipe.

#### Recipe Costing Method

A global setting at `mcogs_settings.data.costing_method` (values: `'best'` default, or `'average'`) controls how ingredient cost resolves **when no preferred vendor is set** for an ingredient+country. Preferred vendor quotes **always** win regardless of method.

| Method | Fallback rule |
|---|---|
| `best` (default) | Cheapest active quote in the market — `DISTINCT ON (ingredient, country) … ORDER BY price ASC` |
| `average` | Arithmetic mean of every active quote's price-per-base-unit in the market, FX-normalised per vendor — `AVG((price / qty) / exchange_rate)` grouped by `(ingredient, country)` |

- Implemented in [`api/src/routes/cogs.js`](api/src/routes/cogs.js) (`loadQuoteLookup(method?)`, `resolveCostingMethodFromSettings()`) and mirrored in [`api/src/helpers/effectivePrice.js`](api/src/helpers/effectivePrice.js) (`getEffectivePrice`, `getEffectivePricesBulk`, exports `COSTING_METHODS` + `resolveCostingMethodFromSettings`).
- `loadQuoteLookup()` now returns `price_per_base_unit` already computed in SQL — the JS post-processing step that divided by vendor rate was removed, because `AVG(p/q/fx)` ≠ `AVG(p)/AVG(q)/AVG(fx)` and the SQL-side aggregation gives mathematically correct blended rates.
- Exposed in the UI under **Settings → COGS Thresholds** as a new "Recipe Costing Method" section with two radio options and explanatory copy. Saved via the same PATCH to `/settings`.
- No schema change — setting is added to the existing `mcogs_settings.data` JSONB blob. Existing deployments default to `'best'` (matches historical behaviour); users opt in to `'average'` by saving the radio.
- All existing callers (`cogs.js` internal routes, `scenarios.js`, `shared-pages.js`, tests) pick up the setting automatically — no signature changes.

### ✅ Menus Page (`/menus`)

Three tabs:

1. **Menus (Menu Builder)** — create menus per country, add Sales Items with display name + sort order + sell prices per price level
2. **Menu Engineer** (formerly "Scenario") — sales mix analysis and scenario planning per menu item
3. **Shared Links** — manage password-protected public links for external reviewer access

**Menu Engineer details:**
- Cross-tab sync: selecting a menu in Menu Builder also selects it in Menu Engineer and vice versa
- Mix Manager modal pre-populates with existing quantities when qty fields are already filled
- Currency symbol shown in column headers (e.g. `Cost/ptn (£)`)
- Categories are collapsible — click category row to collapse/expand items; "▼ All" / "▶ All" button next to Item column header
- **Per-level Qty Sold** — in All Levels view, each price level has its own Qty Sold column (keys: `{nat_key}__l{level_id}`)
- **Inline editable prices** — type a new price into any Price cell to override for this scenario only; amber styling when overridden with ↺ reset button; does not affect the live menu price until "Push Prices" is used
- **Inline editable costs** — Cost/ptn cells are also editable with the same amber override pattern
- **Push Prices** — permanently writes scenario price overrides back to the live menu via `POST /scenarios/push-prices`
- **What If modal** — apply a ±% change to all prices and/or all costs in one step
- **Reset Prices / Reset Costs** — buttons appear when overrides exist; clear all price or cost overrides respectively
- **History modal** — tracks all scenario actions (resets, pushes, What If changes) with timestamps
- **Scenario modal** — replaces old dropdown selector; modal with scenario list (search, Load/Delete per row), active scenario highlighted, save form with name input + Save/Update/New buttons
- **Generate Mix + Reset Qty** — always visible when a menu is selected (not just when data is loaded)
- **Scenarios** — save/load/delete named snapshots of qty_data + price_overrides + cost_overrides + history, stored in `mcogs_menu_scenarios`

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
- **Three view modes** (toggle in toolbar): **List** (default rich table with progress bars), **Excel** (compact spreadsheet with cell borders, category grouping, inline editing), **Grid** (card tiles)

**Currency conversion:**

- All prices stored in USD base
- Display rate: `dispRate = country.rate / targetCurrency.rate`
- Save-back: `localPrice = displayValue / dispRate`

**Menu item structure:**

All menu items are now stored in `mcogs_menu_sales_items` (FK → `mcogs_sales_items`). The legacy `mcogs_menu_items` table still exists but is no longer used for new menus. COGS is calculated via `/cogs/menu-sales/:id`. The `menu_item_id` alias in COGS responses maps to `menu_sales_item_id` for backwards compatibility with ScenarioTool price override keys.

### ✅ Sales Items Page (`/sales-items`)

The Sales Items page manages the catalog of items available to place on menus. Four item types:

| Type | Description | COGS source |
|---|---|---|
| `recipe` | Links to a recipe | `calcRecipeCost()` via preferred vendor quotes |
| `ingredient` | Links directly to an ingredient | Vendor pricing × prep qty |
| `manual` | No recipe/ingredient link; fixed cost entered manually | `manual_cost` field |
| `combo` | Structured bundle: steps → options | Sum of step costs |

**Sales Item features:**
- **Market visibility** — each item can be enabled/disabled per market via `mcogs_sales_item_markets`
- **Default sell prices** — per price level via `mcogs_sales_item_prices` (market-independent defaults; menu-specific overrides in `mcogs_menu_sales_item_prices`)
- **Modifier Groups** — reusable add-on lists attached to a sales item (or combo step option) via `mcogs_sales_item_modifier_groups`. Each group has `min_select`/`max_select` and a list of options (recipe/ingredient/manual + `price_addon` + `qty`)
- **Combo structure**: `mcogs_combo_steps` → `mcogs_combo_step_options` → optional `mcogs_combo_step_option_modifier_groups`
- **Category** — assigned via `category_id` FK referencing `mcogs_categories` (scope flag `for_sales_items = true`)
- **Image** — `image_url` stored on the sales item

**View modes (List | Excel) — BACK-1942:**
- Toggle in the Items-tab toolbar, persisted to `localStorage('sales-items-view-mode')`.
- **List view** — existing dense table with search + filters + bulk-select + side panel. No change.
- **Excel view** — spreadsheet grid with 4 frozen left columns (Name, Display, Type, Category), one column per `mcogs_price_levels` row, one column per `mcogs_countries` row (market toggle), plus an Actions column. Cell borders `#e5e7eb`, 12px body, gray/green/blue header bands matching the Menu Engineer Excel view. Inline-editing commits on blur / Enter with optimistic UI + rollback on failure. Amber cell tint + ⟳ dot while a PUT is in flight. Backed by `GET /api/sales-items?include_prices=true` (new param — one batched JOIN attaches `mcogs_sales_item_prices` rows to each item, avoiding N+1). Type, Linked Item, Description, and Image stay edit-in-panel; row duplicate + reorder deferred.

**Edit panel — three tabs:**
The right-side edit panel for sales items is divided into three tabs:
- **Details** — name, display name, type selector, linked item (recipe/ingredient/combo search or manual cost), category, description, image. Save button in footer.
- **Markets** — per-market enable/disable checkboxes. Auto-saves on toggle (no Save button needed).
- **Modifiers** — lists all assigned modifier groups as removable rows; "+ Add Modifier Group" portal dropdown to attach unassigned groups. Auto-saves.

Switching between items resets the panel tab to Details.

**Combos tab — side panel UI:**
- Left sidebar lists all combos. Clicking a combo loads its steps in the centre area.
- Each step header is **clickable** — click to expand/collapse options AND open the step's edit form in the right side panel simultaneously.
- The right side panel is resizable (drag handle at the left edge, inverted delta). It shows the edit form for whichever combo/step/option was last selected (`comboEditTarget` discriminated union: `'combo' | 'step' | 'option'`).
- No separate cogwheel buttons — step header click replaces this. Options row has group-hover trash icon.
- All delete buttons use SVG trash icons for visual consistency.

**Modifiers tab — side panel UI:**
- Header has "+ New Modifier Group" button → modal form.
- Left list of all modifier groups. Click a group row to expand its options list; clicking the group name also opens its edit form in the right side panel.
- Right side panel (resizable, same pattern as Combos) shows either a group edit form or an option edit form depending on what was selected (`mgEditTarget` discriminated union: `'group' | 'option'`).
- Each modifier option now has a **Qty** field (`mcogs_modifier_options.qty NUMERIC(12,4) DEFAULT 1`) — the quantity of the linked recipe/ingredient used per selection.
- Options can be reordered with ↑ ↓ arrow buttons; sort_order is persisted via API on each move.
- Duplicate button on group row creates a copy of the group and all its options.

**Database tables:**

| Table | Purpose |
|---|---|
| `mcogs_sales_items` | Item catalog (item_type, name, recipe_id/ingredient_id/manual_cost/combo_id, category_id) |
| `mcogs_sales_item_markets` | Per-item market visibility + `is_active` flag |
| `mcogs_sales_item_prices` | Default sell prices per item × price level |
| `mcogs_modifier_groups` | Reusable modifier group definitions (name, min/max_select) |
| `mcogs_modifier_options` | Options within a modifier group (item_type, recipe/ingredient/manual, price_addon) |
| `mcogs_sales_item_modifier_groups` | Junction: sales_items ↔ modifier_groups |
| `mcogs_combo_steps` | Steps within a combo (linked via `sales_item_id` on `mcogs_sales_items`) |
| `mcogs_combo_step_options` | Options per combo step (item_type, recipe/ingredient/manual, price_addon) |
| `mcogs_combo_step_option_modifier_groups` | Junction: combo step options ↔ modifier_groups |
| `mcogs_menu_sales_items` | Menu ↔ sales_items link (sort_order, allergen_notes, qty) |
| `mcogs_menu_sales_item_prices` | Per-menu price overrides per sales item × price level |

### ✅ Dashboard Page (`/dashboard`) — Configurable Widget Grid

The Dashboard is a **template-driven, user-customisable widget grid** (not a fixed layout). Users pick a template, then optionally add/remove/reorder/resize widgets. Config is persisted per-browser in `localStorage` under `cogs-dashboard-config-v1`.

**Templates (shipped):**
- **Executive** — default. KPIs + Menu Tiles + Menu Top Items chart + Coverage Bar + Recent/Missing Quotes.
- **Finance / Cost** — coverage-focused. KPIs + Coverage Bar + Missing Quotes + Recent Quotes + Menu Tiles.
- **Market Explorer** — Market Header banner + World Map + Market Stats + Market Picker + Menu Tiles + Recent Quotes + Quick Links.

**Widgets (21):**
| Category | Widgets |
|---|---|
| KPI tiles (¼ width) | `kpi-ingredients`, `kpi-recipes`, `kpi-menus`, `kpi-markets`, `kpi-vendors`, `kpi-active-quotes`, `kpi-categories`, `kpi-coverage` |
| Full-width cards | `coverage-bar`, `menu-tiles`, `quick-links` (with SVG icons), `market-selector`, `market-header`, `market-picker`, `market-map`, `mapbox-map`, `mapbox-country-map`, `country-region-map`, `menu-top-items` |
| Half-width cards | `missing-quotes`, `recent-quotes`, `market-stats`, `new-ingredient`, `new-price-quote` |

**Customise mode:**
- `✎ Customise` toggle in header → shows per-widget controls: `⠿` drag handle, ↑ ↓ keyboard fallback, width selector (¼ W / ½ W / ¾ W / Full W), height selector (1×H / 2×H / 3×H), pop-out, ✕ remove.
- **Drag-and-drop reordering** — native HTML5 DnD. Grab anywhere on the tile (the whole shell is `draggable` with `cursor-grab`) to reorder; source dims to 40% opacity; drop target gets an accent-ringed outline. Rename input captures `onDragStart` to let typing work. ↑ / ↓ buttons remain as a keyboard fallback.
- `+ Add widget` dropdown (edit mode only) lists widgets not yet on the board.
- Template selector + `↺ Reset` button (edit mode only) — Reset restores the current template's default slot list.
- In view mode, header is clean: just Dashboard title · Customise · Refresh.

**Widget grid:** 12-col CSS grid with `gridAutoRows: minmax(160px, auto)` + `gridAutoFlow: row dense`. Sizes map to col-spans: `sm=3 (¼)`, `md=6 (½)`, `lg=9 (¾)`, `xl=12 (full)`. Row-span via `WidgetHeight = 1 | 2 | 3` → `row-span-1/2/3` classes. Dense flow lets smaller widgets backfill gaps left by tall row-span widgets, so rows stay compact. Sizes gracefully collapse to 12 on mobile, 6 on tablet.

**Row-span defaults:** KPIs and banners stay at `1×H`; charts, tables, and the quick-add widgets default to `2×H`; maps (`market-map`, `mapbox-map`, `mapbox-country-map`, `country-region-map`) and `menu-top-items` default to `3×H`. Each widget's registry entry declares `defaultRowSpan` + `allowedRowSpans`; the height selector only appears when the allowed list has more than one option. User overrides are stored per-slot in `SlotConfig.rowSpan` so saved dashboards keep their layout.

**Market scope integration:** Widgets marked `marketScoped: true` auto-filter by the global market selection (top-bar `MarketSwitcher`). Non-scoped widgets (categories, recipes, markets count) always show global data. The market filter respects RBAC `allowedCountries`.

**Key files:**
- `app/src/pages/DashboardPage.tsx` — shell, template selector, customise mode, slot rendering
- `app/src/dashboard/types.ts` — `WidgetId`, `WidgetSize`, `SlotConfig`, `DashboardConfig`, `Template`
- `app/src/dashboard/templates.ts` — `WIDGET_REGISTRY` (meta per widget) + 3 `TEMPLATES`
- `app/src/dashboard/DashboardData.tsx` — shared data provider (one fetch, all widgets subscribe). Loads ingredients, recipes, vendors, countries, menus, categories, price-levels, quotes, settings. Also computes per-menu COGS tiles scoped to the active market.
- `app/src/dashboard/widgets.tsx` — widget components + registry mapping `WidgetId → Component`. `MarketMap`, `CountryRegionMap`, `MapboxMap`, `MapboxCountryMap`, and `MenuTopItemsChart` are lazy-loaded. Also exports the `WidgetLabelProvider` / `useWidgetLabel` and `WidgetPopoutProvider` / `useIsWidgetPopout` contexts.
- `app/src/dashboard/MarketMap.tsx` — 2D world map (react-simple-maps + d3-geo, natural-earth topojson from jsDelivr CDN). **Regions toggle disabled** — country-level only (the Mapbox widgets below cover the regions use case). Countries shaded by avg COGS% (green ≤30%, amber ≤40%, red >40%, accent-dim if no data, pale grey if outside RBAC scope). Click to set market, ZoomableGroup for zoom/pan. Name matching uses an alias table for USA/UK/Czechia/Myanmar/etc.
- `app/src/dashboard/CountryRegionMap.tsx` — existing zoom-in widget using react-simple-maps + natural-earth 50m admin-1 GeoJSON.
- `app/src/dashboard/MapboxMap.tsx` — **Mapbox GL JS world map widget** (`mapbox-map`). Uses `mapbox://styles/mapbox/light-v11` with clutter layers (road/POI/building/landuse/settlement-minor) hidden on `style.load`. Countries rendered via the bundled `mapbox.country-boundaries-v1` vector source with `promoteId: iso_3166_1` so hover uses `setFeatureState` for smooth transitions. Data-driven `match` expression colours countries by avg COGS%. Countries / Regions toggle adds our natural-earth 50m admin-1 GeoJSON as an overlay (lazy-loaded with AbortController when Regions clicked). In Regions view the base country fill switches to a whole-country-only dataset so region-scoped countries don't bleed a single colour across all their sub-regions. Popup styling (`.mapbox-widget` CSS in `index.css`) picks up design tokens. Auto-enters fullscreen when rendered in the popout window.
- `app/src/dashboard/MapboxCountryMap.tsx` — **Mapbox country drill-down widget** (`mapbox-country-map`). Zooms to the selected market's country via `d3-geo.geoBounds` + `map.fitBounds`. Draws an accent-green outline of the focused country (via a `country-boundaries-v1` line layer filtered on `iso_3166_1`). Admin-1 polygons from the same 50m GeoJSON coloured by which markets claim each region ISO 3166-2. City pins (Mapbox Markers) rendered for every `mcogs_locations` row in that country with captured `latitude` / `longitude`. **Focus masking:** a second `country-boundaries-v1` fill layer covers every country whose ISO ≠ the focused one (surface-2 at 0.95 opacity), and the default-style label layers (`country-label`, `state-label`, `settlement-major-label`, `settlement-subdivision-label`, `natural-point-label`, `water-point-label`, `waterway-label`, `airport-label`) are filtered via `setFilter` to only show features within the focused country — so in "India" focus you see India-only names and nothing from Iran / Pakistan / Saudi Arabia etc. Water bodies (Arabian Sea, Bay of Bengal) aren't part of `country_boundaries` and stay visible. Every `setFilter` is try/caught since layer ids are style-version-specific. Same hover feature-state + popup styling + popout auto-fullscreen as the world map.
- `app/src/hooks/useMapboxToken.ts` — shared hook that fetches `GET /api/ai-config/mapbox-token` once (module-level cache + inflight promise dedupe) so multiple map widgets don't refetch. Returns `{ token, loading, error }`.
- `app/src/dashboard/MenuTopItemsChart.tsx` — horizontal bar chart showing top 10 items per menu. Metric toggle (Cost / Revenue / COGS%). Per-menu price-level override dropdown when >1 level exists. Data from `/cogs/menu-sales/:id?price_level_id=X`.

**Widget popout behaviour:** `WidgetPopoutProvider` (set by `WidgetPopoutPage`) + `useIsWidgetPopout()` let widgets detect when they're being rendered in the standalone popped-out window (opened via the pop-out icon on each widget tile). Both Mapbox widgets call this hook in a one-shot `useEffect` that flips their local `fullscreen` state to `true`, so the popped-out window is maximised automatically and the now-redundant fullscreen toggle button is hidden. Pepper-aware CSS insets (`--pepper-left`/`--pepper-right`/`--pepper-bottom`) default to `0px` in the popout window (no Pepper dock there), so the fixed-positioned fullscreen layer fills the viewport cleanly.

**Dependencies added:** `react-simple-maps ^3.0.0`, `d3-geo ^3.1.1` (existing). `mapbox-gl` + `@types/mapbox-gl` (new, ~492 KB gzipped, lazy-loaded with both Mapbox widgets).

### Global Market Switcher

> **Full reference:** see §10 → "Global App Switches" for the consolidated description of all global switches (Market + Language), their storage keys, server signals, and Pepper integration.

Quick recap: top-bar dropdown in `AppLayout`, provided by `MarketContext` (`app/src/contexts/MarketContext.tsx`), persisted to `localStorage['cogs-market-country-id']`, RBAC-aware (filtered to `allowedCountries`), `null` = "All markets". Consumed by Dashboard widgets and any page that calls `useMarket()`.

### ✅ Allergen Matrix Page (`/allergens`)

Displays allergen status for all ingredients and menu items against the EU/UK FIC 14 regulated allergens.

**Two matrices:** Inventory (per ingredient) and Menu (per menu item).

- Both matrices have **sticky first row** (column headers) and **sticky first column(s)** — implemented using `border-separate border-spacing-0` (required because `border-collapse` breaks `position: sticky` in most browsers) with full `border border-border` on all cells individually.
- **Allergen Notes field**: Added to both matrices as an inline editable textarea per row:
  - Inventory matrix: saves to `mcogs_ingredients.allergen_notes` via `PATCH /allergens/ingredient/:id/notes`
  - Menu matrix: saves to `mcogs_menu_sales_items.allergen_notes` via `PATCH /allergens/menu-item/:id/notes`
  - Saves on blur with a spinner indicator during save

**Menu matrix data source (current):**
The menu allergen matrix queries `mcogs_menu_sales_items` (not the legacy `mcogs_menu_items`). The SQL joins `mcogs_sales_items` to resolve item type, then joins recipes/ingredients/categories as appropriate:

```sql
SELECT msi.id, COALESCE(si.display_name, si.name) AS display_name,
       si.item_type, si.recipe_id, si.ingredient_id, si.combo_id, msi.allergen_notes,
       r.name AS recipe_name, rcat.name AS recipe_category,
       ing.name AS ingredient_name, icat.name AS ingredient_category,
       sicat.name AS si_category          -- sales item's own category (for combo/manual)
FROM   mcogs_menu_sales_items msi
JOIN   mcogs_sales_items      si    ON si.id    = msi.sales_item_id
LEFT JOIN mcogs_recipes        r    ON r.id     = si.recipe_id
LEFT JOIN mcogs_categories     rcat ON rcat.id  = r.category_id
LEFT JOIN mcogs_ingredients    ing  ON ing.id   = si.ingredient_id
LEFT JOIN mcogs_categories     icat ON icat.id  = ing.category_id
LEFT JOIN mcogs_categories     sicat ON sicat.id = si.category_id   -- combo/manual category
WHERE  msi.menu_id = $1
ORDER  BY msi.sort_order, msi.id
```

**Category resolution per item type:**
- `ingredient` → `ingredient_category` or `si_category`
- `recipe` → `recipe_category` or `si_category`
- `combo` or `manual` → `si_category` (the category assigned directly on the sales item)

**Combo ingredient chain:** For combo items the allergen system resolves ingredients via two extra queries — direct ingredient options from `mcogs_combo_step_options` + recipe options (then their ingredients via `mcogs_recipe_items`).

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

### ✅ Stock Manager Page (`/stock-manager`)

Full inventory management module with 8 tabs. Requires `stock_manager` RBAC permission.

**Tab 1: Overview** — KPI cards (total items, low stock, out of stock, stores), stock levels grid with status badges (OK/Low/Out), recent movements feed.

**Tab 2: Stores** — Three-panel layout: locations list → stores within location → store detail. CRUD for stores (sub-locations within mcogs_locations). `is_store_itself` flag.

**Tab 3: Purchase Orders** — Three-panel: PO list with filters → PO detail with line items → smart add-item form. Auto-populates price/unit from vendor quotes via `/purchase-orders/quote-lookup`. No-quote warning with manual entry + "Save as price quote" option. Per-item store assignment. Status flow: draft → submitted → partial → received → cancelled.

**Tab 4: Goods In** — Three-panel: GRN list → GRN detail with items → item form. When linked to PO, auto-populates remaining quantities. Confirm action creates stock_movements + updates stock_levels + updates PO qty_received.

**Tab 5: Invoices** — Three-panel: invoice list with totals → invoice detail with subtotal/tax/total → item form. Status flow: draft → pending → approved → paid → disputed. Create from GRN or standalone.

**Tab 6: Waste** — Bulk entry form (multi-row: ingredient, qty, reason code, notes) + waste log history. Right panel: reason codes management. Each waste entry creates stock_movement + decrements stock_level.

**Tab 7: Transfers** — Three-panel: transfer list → transfer detail → item form. Two-step: dispatch (deducts source store) → confirm (adds destination store). Cancel reverses if dispatched.

**Tab 8: Stocktake** — Three-panel: session list → count entry grid → item detail. Full count: "Populate All" from stock_levels. Spot check: add specific items. Variance calculation on complete. Approve adjusts stock to counted quantities.

### ✅ Bugs & Backlog (embedded in System page)

Two-tab interface for tracking bugs and feature backlog items. Previously a standalone page at `/bugs-backlog` — now embedded as a section in the System page. The old route redirects to `/system`.

- **Bugs tab** — CRUD for bug reports with key (BUG-1001+), summary, priority, severity, status (open/in_progress/resolved/closed/wont_fix), labels JSONB, assignee, page reference, steps to reproduce
- **Backlog tab** — CRUD for feature requests with key (BACK-1001+), summary, item_type (story/task/epic/improvement), priority, status (backlog/todo/in_progress/in_review/done/wont_do), story points, sprint, acceptance criteria
- RBAC: `bugs` feature (everyone write), `backlog` feature (admin write, others read)
- **Seeded data** — Migration step 108 inserts all 23 known bug fixes from CLAUDE.md section 16 (status: resolved) and 9 backlog items from section 18. Idempotent via `ON CONFLICT (key) DO NOTHING`
- **Pepper RBAC** — AI chat tools `update_bug_status` and `update_backlog_status` check `bugs:write` / `backlog:write` permission + `is_dev` flag before allowing changes

### ✅ Media Library Page (`/media`)

Image management with local disk and S3 storage support.

- Upload images with automatic variant generation (original, _thumb 300px, _web 1200px)
- Category organization, scope filtering (shared/form-specific)
- Grid and list view with focus-vs-select model (single mode: click=focus, checkbox=add; multi mode: click anywhere=toggle)
- Bulk operations: move to category, bulk delete
- S3 migration via SSE progress stream
- Tables: `mcogs_media_categories`, `mcogs_media_items` (migration steps 83-85)

### ✅ POS Tester Page (`/pos-tester`)

POS functional mockup accessible via System → POS Mockup.

- Three-panel layout: check (order summary) | menu grid (category tiles) | order flow
- Combo step walker with auto-advance for single-choice steps
- Modifier groups with repeat selection (+/- stepper) and auto_show (inline vs popup)
- Fullscreen portal overlay, mock receipt modal with print
- Category-grouped tile grid, price level selector
- No DB tables — reads from `/cogs/menu-sales/:id`

### ✅ Shared Menu Page (`/share/:slug`)

Public password-protected page for external reviewers (no auth required).

- Mode: `view` (read-only) or `edit` (recipient can change sell prices)
- Optional: pin to specific scenario, expiry date, enable/disable
- Price changes logged and surfaced in Menu Engineer History tab
- Comments posted via shared links appear in Menu Engineer Comments tab

### ✅ QSC Audits (`/audits`, `/audits/templates`, `/audits/:id/run`, `/audits/:id/report`)

Wingstop-style **Quality / Service / Cleanliness** audit tool. Two modes sharing the same question bank (150 items seeded from [`docs/wingstop_audit_tool_spec.md`](docs/wingstop_audit_tool_spec.md)):

1. **External audit** — formal evaluation. Every scored question must be answered before finalize. Feeds the `is_repeat` flag on future audits.
2. **Internal audit** — ad-hoc self-check. Optional template from 7 seeded (Line Check, Walk-in & Cold Hold, Personal Hygiene, Expiration Sweep, Cleaning & Sanitizer, Opening Checklist, Front-of-House). Partial completion allowed; unanswered items record as `not_observed`.

**Scoring engine** ([`api/src/helpers/qsc-scoring.js`](api/src/helpers/qsc-scoring.js)):
- 100-point deduct; per-question weight by risk level (5/3/1 for First/Second/Third Priority, 0 for Information Only).
- Auto-unacceptable triggers — `A105`, `A127`, `A139`, `A141`, `A143`, `OF101`. Any NC on these forces overall rating to `Unacceptable` regardless of score.
- Rating bands: `≥ 90 Acceptable`, `70–89.9 Needs Improvement`, `< 70 Unacceptable`.

**Pages:**
- [`AuditsPage.tsx`](app/src/pages/audits/AuditsPage.tsx) — dashboard: stat cards, filterable list, "Start audit" modal with audit-type + location + template pickers.
- [`AuditRunnerPage.tsx`](app/src/pages/audits/AuditRunnerPage.tsx) — single-question runner. Sticky progress strip. Left sidebar groups questions by Department → Category with compliance dots. Main pane: risk chip, collapsible policy, 4 status buttons, repeat-finding checkbox (pre-flagged from previous external NC codes), optional temperature entry, product name, comment, photo upload, cross-ref chips.
- [`AuditReportPage.tsx`](app/src/pages/audits/AuditReportPage.tsx) — summary banner (score + rating), department/category tables, critical findings, all NC items with photos + cross-refs, repeat findings, informational observations. "Export CSV" button + `window.print()` (print stylesheet included).
- [`AuditTemplatesPage.tsx`](app/src/pages/audits/AuditTemplatesPage.tsx) — system templates + custom template CRUD. Editor lists all questions with dept/search filter and checkbox selection.

**Pepper tools (7 read-only):**
- `list_audits` — query audits by type/status/location.
- `get_audit_report` — full scored report for one audit (by id or key).
- `list_qsc_questions` — search the 150-question bank by department/category/risk/text.
- `get_qsc_question` — full detail for a single code including policy text.
- `list_audit_templates` — all templates with their code lists and question counts.
- `get_audit_nc_trends` — aggregates most frequently failed codes across completed audits (with date/location/type filters). Useful for remediation priorities.
- `get_location_audit_history` — chronological audit list for one location + running average score + rating distribution.

**Photos** — use the existing `/api/upload` endpoint (S3 or local disk). Attach returned URL via `POST /api/qsc/audits/:id/responses/:code/photos`. Max 5 MB.

**Repeat-finding detection** — when the runner loads, it calls `GET /qsc/locations/:id/last-external` to pre-flag NC codes from the location's previous external audit. Auditor confirms on the NC screen via the "Repeat finding" checkbox.

**Out of scope for v1** (tracked in [BACK-1500](https://cogs.macaroonie.com)):
- Offline-first service worker + IndexedDB queue (runner currently online-only).
- Escalation emails for A139/A141/A143.
- Branded Puppeteer PDF (current output is `window.print()`).
- Per-location RBAC scope via `mcogs_user_locations` junction (users today filter by country via brand partners).
- Admin UI for question-bank editing (endpoint exists; UI deferred).

---

## 13. Pages Remaining to Build

| Page | Route | Priority | Notes |
|---|---|---|---|
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

Pepper is the in-app AI assistant (Claude Haiku 4.5 via Anthropic API). It can be docked to the left, right, or bottom of the screen (no float mode). It uses server-sent events (SSE) for streaming responses and supports an agentic loop where Claude can call tools to read and write data.

### Architecture

- **Frontend:** `app/src/components/AiChat.tsx` — chat panel with history tab, file attachment, screenshot button, dockable panel
- **Chat endpoint:** `POST /api/ai-chat` — JSON body `{ messages, conversationId? }` → SSE stream
- **Upload endpoint:** `POST /api/ai-upload` — multipart `{ file, message, conversationId? }` → SSE stream (image/CSV/screenshot)
- **Shared agentic loop:** `api/src/helpers/agenticStream.js` — SSE helper, keepalive ping, `while(true)` tool loop, token counting
- **Logging:** all sessions logged to `mcogs_ai_chat_log` (messages, tools_called JSONB, token counts)
- **File support:** CSV/text (injected as text block), PNG/JPEG/WEBP (injected as base64 vision block); max 5MB; PDF not supported
- **Web search config:** `BRAVE_SEARCH_API_KEY` stored via `GET/PUT /api/ai-config` — if set, `search_web` tool uses Brave Search; otherwise DuckDuckGo instant answer fallback
- **GitHub config:** `GITHUB_PAT` and `GITHUB_REPO` stored via `GET/PUT /api/ai-config` — enables 8 GitHub tools when set. Helper: `api/src/helpers/github.js`
- **Market scope filtering:** all data-read and export tools respect `allowedCountries` from the user's RBAC scope (`mcogs_user_brand_partners`); `null` = unrestricted (Admin default), non-null = array of permitted country IDs injected from `req.user.allowedCountries`. Note: this is the user's **RBAC scope**, not the top-bar Market Switcher selection — Pepper sees everything the user is allowed to see, regardless of which market is currently focused in the UI. See §10 → "Global App Switches" for the relationship between the two.
- **Language:** `req.language` is threaded into `userCtxWithLang` and applied as a COALESCE bind param on translatable SELECTs in tools like `list_ingredients`, `list_recipes`, `list_menus`, `list_categories`, `list_price_levels`, `list_price_quotes`. The system prompt also instructs Pepper to reply in the user's language. See §10 → "Global App Switches" and §23 for the resolution chain.
- **Panel mode:** `PepperMode = 'docked-left' | 'docked-right' | 'docked-bottom'` — persisted in `localStorage('pepper-mode')`. Left/right render as full-height flex columns in `AppLayout`; bottom renders as a resizable panel (200px-60vh) below main content. **On mobile** (viewport < 640px) the dock mode is overridden to a full-viewport fixed sheet (`position: fixed; inset: 0; z-index: 50`) with a `visualViewport`-driven bottom inset so the on-screen keyboard doesn't cover the chat input. The stored mode preference is preserved — it applies again when the user goes back to desktop.

### Pepper on PWA (mobile-native features)

- **Mobile detection:** `app/src/hooks/useIsMobile.ts` exports `useIsMobile()` (matches the Tailwind `sm:` breakpoint) and `useKeyboardInset()` (tracks `window.visualViewport.height` to adjust the chat-sheet bottom when iOS/Android opens the keyboard).
- **Bigger tap targets + font on mobile:** `ChatPanel` reads the `isMobile` prop from `AiChat` and scales icon buttons from `w-7 h-7` to `w-11 h-11` (iOS HIG min), send button from `w-8` to `w-12`, textarea from `text-sm` to `text-base`.
- **Camera capture:** new `cameraInputRef` alongside `fileInputRef`. Camera button uses `<input type="file" accept="image/*" capture="environment">` which opens the native camera app on mobile and a regular file picker on desktop. Reuses the existing `handleFileChange` → `/api/ai-upload` → `stageFileContent` pipeline, so a photographed receipt lands as a staged import job the user can finish via the Continue-a-staged-import panel on `/import`.
- **Voice input (push-to-talk):** `app/src/hooks/useVoiceInput.ts` returns `{ recording, backend, available, start, stop, unavailableReason }`. Chromium-based browsers use native `SpeechRecognition` (free, on-device). Safari/iOS fall back to `MediaRecorder` → POST `/api/ai-transcribe` → OpenAI Whisper. The mic button is a `onPointerDown/Up/Leave` push-to-talk; pre-existing input is stashed in `preVoiceInputRef` so the transcript appends rather than overwrites.
- **Voice output (sentence-buffered TTS):** `app/src/hooks/useVoiceOutput.ts` returns `{ enabled, speaking, available, toggle, feed, flush, cancel }`. Wired into the SSE text-event handler in `AiChat.tsx` (`tts.feed(event.text)` per token, `tts.flush()` on stream end). Buffers on `. ? !` boundaries so whole sentences are spoken rather than token fragments. Strips markdown noise (asterisks, backticks, pipes) before speaking. Toggle lives in the Pepper header (speaker icon), persisted to `localStorage('pepper-tts-enabled')`.
- **Kitchen Mode:** toggle in the Pepper header → adds `body.kitchen-mode` class → CSS in `index.css` scales font-size to 17px + sets `min-height: 44px` on buttons/inputs/textareas. Scope is app-wide (not just Pepper) so operators on a shop-floor tablet can click it once and the whole app becomes greasy-finger-friendly. Persisted to `localStorage('pepper-kitchen-mode')`.
- **Whisper backend (`POST /api/ai-transcribe`):** [api/src/routes/ai-transcribe.js](api/src/routes/ai-transcribe.js). Multipart `audio` field (≤25 MB), optional `language` ISO-639-1, returns `{ text }`. Uses `OPENAI_API_KEY` from the config store (new entry in `AI_KEY_NAMES`; exposed as `openai_key_set` in `aiConfig.status()`). 503 with a friendly error when not configured — the client shows "Voice unavailable" and Chromium users keep working via native SpeechRecognition. Audits each call via `logAudit` (length + mimetype, no transcript content).
- **Settings → AI card:** OpenAI key input with "only needed for Safari/iOS" copy. Mapbox + OpenAI cards live side-by-side in the Integrations list.

### Tool Count: 121 (verified live via `require('./ai-chat').TOOLS.length`)

**Lookup / Read (15):**
`get_dashboard_stats`, `list_ingredients`, `get_ingredient`, `list_recipes`, `get_recipe`, `list_menus`, `get_menu_cogs`, `get_feedback`, `submit_feedback`, `list_vendors`, `list_markets`, `list_categories`, `list_units`, `list_price_levels`, `list_price_quotes`

**Feedback (2):**
`update_feedback_status`, `delete_feedback`

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

**Import (2):**
`start_import` — accepts file text content already in conversation, calls `stageFileContent()` with the current user's email (via `userCtx.email`) so the job shows up in their "Continue a staged import" list on the Import page. Returns `{ job_id, url: '/import?job=<id>', summary }` so the user can click through to the Import Wizard to review + commit.
`list_import_jobs` — lists the user's staged/unfinished import jobs with counts + filename + status + a `/import?job=<id>` URL. Defaults to current user's non-terminal jobs (staging, ready, failed). Used when the user asks "what imports do I have pending?" or "can I resume an earlier import?".

**Web Search (1):**
`search_web` — uses Brave Search API if `BRAVE_SEARCH_API_KEY` is configured in Settings → AI; falls back to DuckDuckGo Instant Answer API (free, no key, limited coverage). **Only invoked when the user explicitly asks to search the internet.** System prompt restricts autonomous use.

**GitHub (8) — requires GITHUB_PAT + GITHUB_REPO in Settings → AI:**
`github_list_files`, `github_read_file`, `github_search_code`, `github_create_or_update_file`, `github_create_branch`, `github_list_prs`, `github_get_pr_diff`, `github_create_pr`

**Excel Export (1):**
`export_to_excel` — generates a multi-sheet `.xlsx` workbook (ingredients, price quotes, recipes, menus, or full export) filtered to the user's market scope; triggers a browser download automatically

**Memory (3):**
`save_memory_note` — saves a pinned note that persists across sessions (user says "remember X")
`list_memory_notes` — lists all pinned notes for the current user
`delete_memory_note` — deletes a specific note by ID (user says "forget X")

**Audit Log (3):**
`query_audit_log` — search audit log with filters (entity type, user, action, date range, entity label search). Returns who changed what, when, with old/new field values
`get_entity_audit_history` — full change history for a specific entity (e.g. ingredient #5). Shows all changes over time
`get_audit_stats` — summary statistics: total changes, breakdown by action/entity type, most active users. Supports date range filtering

**FAQ (1):**
`search_faq` — searches the FAQ knowledge base (70+ entries across 12 categories). ILIKE on question + answer + tags, returns top 5 matches. Used when user asks how-to questions.

**Change Log (1):**
`get_changelog` — returns the project change log. Shows what was added, changed, fixed, or removed per session. Supports version filter and limit. Updated as part of the EOS protocol.

### Memory System

Pepper has a persistent memory system that survives across sessions. Two storage mechanisms:

1. **Pinned Notes** (`mcogs_user_notes`) — short facts, preferences, or instructions saved per user. User can say "remember that I always want UK prices in GBP" and Pepper calls `save_memory_note`. "What do you remember?" lists all notes via `list_memory_notes`. "Forget the note about GBP" deletes via `delete_memory_note`.
2. **User Profile** (`mcogs_user_profiles`) — `display_name`, `profile_json` (JSONB for structured preferences like primary markets, response style), and `long_term_summary` (TEXT for evolving context). Managed via `GET/PUT /api/memory/profile`.

Both are loaded into the system prompt at the start of every conversation (~100 tokens per note). If memory loading fails, chat works normally without it (graceful degradation). The memory API is at `/api/memory/notes` and `/api/memory/profile`.

3. **Nightly Memory Consolidation** (`api/src/jobs/consolidateMemory.js`) — A cron job (02:07 UTC daily via `node-cron`) that:
   - Reads each user's conversations from `mcogs_ai_chat_log` for the previous day
   - Reads their audit log changes from `mcogs_audit_log`
   - Calls Claude Haiku to generate a JSON summary (summary, topics, profile_updates)
   - Stores in `mcogs_memory_daily` (UNIQUE per user+date, idempotent via ON CONFLICT)
   - Additively merges profile updates into `mcogs_user_profiles.profile_json` (arrays unioned, strings overwritten only if non-null)
   - On 1st of month: consolidates daily summaries into `mcogs_memory_monthly`; on quarter boundaries updates `long_term_summary`
   - Admin can trigger manually via `POST /api/memory/consolidate` with optional `{ date, forceMonthly }`
   - Status tracked in `mcogs_settings.data.memory_consolidation`

4. **System Prompt Injection** — At session start, the memory block now includes:
   - User profile (display_name, primary_markets, response_preference, recurring_focus, long_term_summary)
   - Pinned notes
   - Last 3 daily summaries from `mcogs_memory_daily`
   - Activity digest: recent changes from `mcogs_audit_log` since the user's last conversation

### GitHub Integration

Pepper can read and write to GitHub when a PAT is configured. Key behaviours:

- **Read tools** (`list_files`, `read_file`, `search_code`, `list_prs`, `get_pr_diff`) — no confirmation required
- **Write tools** (`create_branch`, `create_or_update_file`, `create_pr`) — CONFIRMATION REQUIRED before calling
- **Hard safety rule:** `github_create_or_update_file` rejects `main` or `master` as target branch at the executor level — this cannot be bypassed by prompt injection
- **Default repo:** resolved from `GITHUB_REPO` config; individual tool calls can override with `repo: "owner/repo"` parameter
- **Helper module:** `api/src/helpers/github.js` wraps GitHub REST API v3 using the PAT; all calls use `application/vnd.github+json` Accept header and `X-GitHub-Api-Version: 2022-11-28`
- **PR diff truncation:** diffs are capped at 8,000 characters to avoid exceeding context window

**Typical workflow for code changes:**
1. `github_read_file` — read current file and get its `sha`
2. `github_create_branch` — create a feature branch (confirm first)
3. `github_create_or_update_file` — write the modified file, passing the `sha` (confirm first)
4. `github_create_pr` — open a PR for human review (confirm first)

**Setting up GitHub access:**
1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens
2. Select the target repo, enable **Contents** (read/write) + **Pull requests** (read/write)
3. Settings → AI in COGS → paste PAT into GitHub Personal Access Token field
4. Set GitHub Repository to `owner/repo` format

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
- **Markdown rendering**: Pepper responses are rendered with a full inline markdown parser (`renderMd` in `AiChat.tsx`). Supports: fenced code blocks, `#`/`##`/`###` headings, pipe tables (with alternating row shading), unordered lists (`-`/`*`/`•`), ordered lists (`1.`), inline code (`` `…` ``), `**bold**`, `*italic*`, `_italic_`. All output uses CSS design tokens for theme compatibility. HTML is escaped before inline formatting to prevent XSS.
- **Monthly token allowance**: Per-user monthly cap stored in `mcogs_settings.data.ai_monthly_token_limit` (0 = unlimited). Billing period runs 25th→24th each month. `checkTokenAllowance(userSub)` helper in `ai-chat.js` (exported and imported by `ai-upload.js`) queries `mcogs_ai_chat_log` for the period SUM and returns `{ allowed, periodTokens, limit, nextReset }`. If exceeded, a JSON `429` response is returned **before** SSE headers are set. Usage bar displayed in the Pepper panel header (green < 80%, amber ≥ 80%, red = exceeded). `GET /api/ai-chat/my-usage` returns current period stats. Settings → AI tab shows the limit field and a per-user table with period usage progress bars.

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

Custom roles can be created in Configuration → Users & Roles and assigned any combination.

### Features (23)

`dashboard` · `inventory` · `recipes` · `menus` · `allergens` · `haccp` · `markets` · `categories` · `settings` · `import` · `ai_chat` · `users` · `stock_overview` · `stock_purchase_orders` · `stock_goods_in` · `stock_invoices` · `stock_waste` · `stock_transfers` · `stock_stocktake` · `bugs` · `backlog` · `audits` · `audits_admin`

**QSC Audits feature gates:**
- `audits` — Admin/Operator get `write` (create audits, edit templates, answer questions), Viewer gets `read` (view reports). Seeded in migration step 129.
- `audits_admin` — Admin only gets `write`. Used to gate the question-bank editing endpoint (`PUT /api/qsc/questions/:code`). Non-admin attempts return 403.

> **Note:** The original single `stock_manager` feature was replaced by 7 granular stock features to allow per-tab RBAC control within the Stock Manager module. `bugs` and `backlog` were added in migration step 107b.

### User Lifecycle

```
Register (Auth0) → pending status → Admin approves → active → can sign in
First user ever  → auto-bootstrapped as Admin + active (no chicken-and-egg)
Disabled         → 403 on every request, shown disabled message
```

### Developer Flag (`is_dev`)

Individual users can be granted the **developer flag** (`mcogs_users.is_dev BOOLEAN DEFAULT FALSE`). This is toggled per-user by an Admin in Configuration → Users & Roles via the `</>` button in the Actions column.

**What `is_dev` unlocks:**

| Feature | Normal user | Dev user |
|---|---|---|
| **System → Test Data** section | Hidden | Visible (marked purple DEV badge) |
| **System → CLAUDE.md** section | Hidden | Visible (marked purple DEV badge) |
| **System → Test Data** section | Hidden | Visible (marked purple DEV badge) |

The flag is separate from roles — a Viewer or Operator can be granted dev access independently of their COGS permissions.

**Access chain:**
- Backend: `is_dev` is on `req.user` (loaded from DB via `loadOrCreateUser`)
- API `/me`: returns `is_dev: boolean`
- Frontend: `PermissionsContextValue.isDev` boolean, consumed via `usePermissions()`
- `SettingsPage.tsx`: filters `test-data` out of the visible tab list unless `isDev`; `{t === 'test-data' && isDev && <TestDataTab />}` guards the render
- `SystemPage.tsx`: `SECTIONS` entries declare a `gate: 'admin' | 'dev'` field. The sidebar hides any gated section the current user can't reach, a `useEffect` bounces them back to AI if they lose access mid-session, and a `GatedFallback` is shown as defence-in-depth if they somehow route into it directly
- Destructive actions on the Test Data tab (Load Test Data, Load Small, Clear Database, Load Defaults) are gated behind the `DateConfirmDialog` — the user must type today's date as `ddmmyyyy` before the confirm button activates

**Admin-gated vs dev-gated sections under `/system`:**

| Section | Gate | Icon badge | What it does |
|---|---|---|---|
| **AI** | — | none | Embeds Settings → AI (API keys, token usage, concise mode, Mapbox integration) |
| **Database** | `settings:write` (admin) | amber ADMIN | Embeds Settings → Database — DB connection mode (local vs standalone/RDS), test/save/migrate/switch |
| **Test Data** | `is_dev` (dev) | purple DEV | Embeds Settings → Test Data — Load Test / Load Small / Clear / Load Defaults, all gated by `DateConfirmDialog` (ddmmyyyy) |
| **CLAUDE.md** | `is_dev` (dev) | purple DEV | Project documentation viewer — reads raw CLAUDE.md from repo root via `GET /api/docs/claude-md` |
| Architecture / API Reference / Security / Troubleshooting / Domain Migration | — | none | Reference documentation |

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

- **`app/src/hooks/usePermissions.ts`** — `usePermissions()` hook, `Feature` type, `AccessLevel` type, `MeUser` interface (includes `is_dev: boolean`)
- **`app/src/components/PermissionsProvider.tsx`** — loads `/api/me` on auth change, provides `can(feature, level)`, `isDev`, and `allowedCountries`
- **`app/src/pages/PendingPage.tsx`** — shown when `user.status === 'pending'`
- **Sidebar** — hides nav items where `can(feature, 'read')` is false
- **Configuration → Users & Roles** — list/approve/disable/delete users, change role, assign BP scope, toggle `is_dev` (the `</>` button)
- **Configuration → Users & Roles** — permission matrix (features × roles), click cell to cycle `— → R → W`, saves instantly
- **System → Database** — only visible when `can('settings', 'write')`; marked with an amber `ADMIN` badge. Embeds `SettingsPage initialTab="database"` — the DB connection config (local vs standalone/RDS), test/save/migrate/switch flow.
- **System → Test Data** — only visible when `isDev`; marked with a purple `DEV` badge. Embeds `SettingsPage initialTab="test-data"`. All destructive actions (Load Test Data, Load Small, Clear Database, Load Defaults) are gated behind the `DateConfirmDialog` — the user must type today's date as `ddmmyyyy` before the confirm button activates.

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

### Fix 4 — ColumnHeader Dropdown Clipping

**Symptom:** Filter/sort dropdown in column headers clipped inside `overflow-x-auto` table wrapper.

**Fix:** Changed `ColumnHeader` and `DataGrid` `HeaderCell` to use fixed positioning (`position: fixed`) calculated from `getBoundingClientRect()`, placed at `z-index: 99999`.

**File:** `app/src/components/ColumnHeader.tsx`, `app/src/components/DataGrid.tsx`

---

### Fix 5 — TypeScript Build Failure (ImportPage)

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

### Fix 6 — import.js Router Export Shape

**Symptom:** After extracting `stageFileContent` from `import.js`, the route registration broke — Express threw "Router.use() requires a middleware function" at startup.

**Root Cause:** `import.js` was changed from `module.exports = router` to `module.exports = { router, stageFileContent }`. But `api/src/routes/index.js` still did `require('./import')` — which now returned a plain object, not a router.

**Fix:**
```js
// index.js
router.use('/import', require('./import').router);
```

**File:** `api/src/routes/index.js`

---

### Fix 7 — Recipe Import Silently Failing (Wrong Column Names)

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

### Fix 8 — Shared View Comment Count Mismatch

**Symptom:** The Comments badge in the ME Notes/History panel showed 9 but only 3 comments were visible.

**Root cause:** `meChanges` contains all change types — `'comment'` and `'price'`/`'qty'`. The badge was counting `comments.length` (all entries) rather than only `change_type === 'comment'` entries. The `commentTree` correctly filtered to comments only, so only 3 showed in the panel, but the badge showed the full count including price change events.

**Fix:** Badge and empty-state now filter to `change_type === 'comment'` only. Price/qty change events were moved to the History tab under "Shared View Edits".

---

### Fix 9 — Shared View Reply Posted to Wrong Shared Page

**Symptom:** When replying to a comment in Menu Engineer that came from shared view B, the reply was always posted to shared view A (active[0]).

**Root cause:** `addMeComment` always posted to `meSharedPageId` (= `active[0].id`), regardless of which shared page the original comment came from. When multiple shared views are linked to the same scenario, comments from view B would receive replies that land in view A.

**Fix:**
- Added `shared_page_id?: number` field to `MeChange` interface (tagged client-side when fetching)
- When fetching changes for multiple pages, each row is tagged with the page's ID: `.then(rows => rows.map(r => ({ ...r, shared_page_id: p.id })))`
- `addMeComment(text, parentId?, sharedPageId?)` now accepts an optional `sharedPageId` override
- `postReply()` passes `replyTo.shared_page_id` — the reply always routes to the same view as the parent comment

**Files:** `app/src/pages/MenusPage.tsx`

---

### Fix 10 — Pepper Conversation Lost on Panel Mode Switch

**Symptom:** Switching Pepper between float, docked-left, and docked-right modes cleared the conversation history.

**Root Cause:** `AppLayout` previously rendered three separate conditional branches — one `<AiChat />` mount per mode. React unmounted the old branch and mounted a fresh instance on every mode change, discarding all in-memory conversation state.

**Fix:** `AppLayout` now renders a single always-mounted `<AiChat />` instance. The panel's position is controlled entirely via CSS: the wrapper div uses `order` inside the flex row (`order-first` for docked-left, `order-last` for docked-right, fixed-position overlay for float) so the component never unmounts when switching modes and conversation state is fully preserved.

**File:** `app/src/components/AppLayout.tsx`

---

### Fix 11 — AI Chat Focus Loss on Every Keystroke

**Symptom:** Typing in the Pepper chat textarea loses focus after each character, requiring a click to re-focus. Also, focus was not restored to the textarea after an AI response finished streaming.

**Root Cause:** `ChatPanel` and `HistoryPanel` were defined as `const` functions **inside** `AiChat()`. On every render (triggered by each `setInput` keystroke), new function references were created, giving React unstable component identities. The `disabled={streaming}` attribute on the textarea caused the browser to drop focus when streaming started, and nothing restored it when streaming ended.

**Fix:**
1. Moved `ChatPanel` and `HistoryPanel` to **module level** (outside the component body), receiving all state via props. React now has a stable identity for these components across renders.
2. Added a `useEffect` with a `wasStreaming` ref that restores focus to `inputRef` 100 ms after `streaming` transitions `true → false`, so focus automatically returns after each AI response.

**File:** `app/src/components/AiChat.tsx`

---

### Fix 12 — Sidebar Does Not Span Full Viewport Height

**Symptom:** The sidebar's green border stopped short of the bottom of the screen, leaving a gap.

**Root Cause:** The sidebar wrapper div used `h-full` (height: 100%). Browser CSS engines do not always treat a flex-stretched height as a "definite" height for `h-full` children, so the `aside` inside could collapse.

**Fix:** Changed the wrapper div from `h-full` to `flex flex-col self-stretch`. As a flex column container, `self-stretch` guarantees the div fills the parent's cross-axis height definitively, so the `aside`'s own `h-full flex flex-col` resolves correctly all the way to the bottom of the viewport.

**File:** `app/src/components/AppLayout.tsx`

---

### Fix 13 — Anthropic 400 Error (`input_str` Extra Field) in Multi-Turn Tool Conversations

**Symptom:** `messages.N.content.0.text.input_str: Extra inputs are not permitted` — 400 error from the Anthropic API on the 9th+ message in conversations involving multiple tool calls.

**Root Cause:** `agenticStream.js` used `input_str: ''` as a local accumulator for streaming JSON input on tool-use content blocks. When `content_block_stop` fired, the block was pushed to `assistantContent` **with `input_str` still attached**. On the next API call this block was sent back to Anthropic as part of the messages array. Anthropic's schema validation rejects any content block with an unrecognised field.

**Fix:** Destructure `input_str` off the block before pushing to `assistantContent`:
```js
const { input_str, ...cleanBlock } = currentBlock;
assistantContent.push(cleanBlock);
```

**File:** `api/src/helpers/agenticStream.js`

---

### Fix 14 — `category-groups.js` PM2 Crash (Wrong `require` Path)

**Symptom:** PM2 crashed on startup with `Cannot find module '../db'` from `api/src/routes/category-groups.js`.

**Root Cause:** The file used `require('../db')` but the database pool module lives at `../db/pool` (consistent with all other route files in the project).

**Fix:**
```js
// BEFORE
const pool = require('../db')
// AFTER
const pool = require('../db/pool')
```

**File:** `api/src/routes/category-groups.js`

---

### Fix 15 — Migration Crash: `CREATE INDEX` on Already-Dropped `category` Column

**Symptom:** Running `npm run migrate` on production failed with `column "category" does not exist` at the early `CREATE INDEX IF NOT EXISTS idx_ingredients_category ON mcogs_ingredients(category)` statement. The server API would not start.

**Root Cause:** The migration script has two phases:
1. Early steps create tables (including `category VARCHAR` columns on `mcogs_ingredients` and `mcogs_recipes`)
2. Later steps (FK migration) drop those columns and replace them with `category_id INTEGER`

On a database where the FK migration had already run previously, re-running `migrate.js` hit the early `CREATE INDEX` on a column that no longer existed.

**Fix:** Wrapped both old index creations in `DO` blocks that check column existence first:
```sql
DO $ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='mcogs_ingredients' AND column_name='category') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ingredients_category ON mcogs_ingredients(category)';
  END IF;
END $
```

**File:** `api/scripts/migrate.js`

---

### Fix 16 — Combo Step Option Modal Missing Recipe/Ingredient Selector

**Symptom:** The "Add Option" / "Edit Option" modal for combo step options showed Type selector (Manual/Recipe/Ingredient) but had no recipe or ingredient search field — selecting "Recipe" or "Ingredient" showed a blank form with no way to link the option to an item.

**Root Cause:** `ComboOptionForm` only rendered the `manual_cost` field for manual type; the recipe and ingredient selector comboboxes were never implemented.

**Fix:**
- Added `recipes: Recipe[]` and `ingredients: Ingredient[]` to `SalesItemDetailProps` and `ComboOptionForm` props
- `<SalesItemDetail>` now passes `recipes={recipes}` and `ingredients={ingredients}` at the call site
- `ComboOptionForm` gains two comboboxes (same floating-dropdown pattern as `SalesItemModal`):
  - **Recipe** — shown when `item_type === 'recipe'`; searches by name, shows category in secondary slot; sets `form.recipe_id`
  - **Ingredient** — shown when `item_type === 'ingredient'`; searches by name, shows `base_unit_abbr`; sets `form.ingredient_id`
- `handleTypeChange()` clears linked IDs and search text when switching types
- Pre-populates search text from existing `recipe_id` / `ingredient_id` when editing an existing option

**Files:** `app/src/pages/MenusPage.tsx`

---

### Fix 17 — Allergen Matrix Showed "UNCATEGORISED" for Combo and Manual Items

**Symptom:** In the Menu allergen matrix, all combo-type and manual-type sales items showed "UNCATEGORISED" in the Category column, even when the sales item had a category assigned.

**Root Cause:** The matrix query joined `mcogs_categories` only through the recipe (`rcat`) and ingredient (`icat`) paths. Category resolution used:
```js
const category = mi.item_type === 'ingredient'
  ? (mi.ingredient_category || null)
  : (mi.recipe_category || null);  // null for combo/manual — no recipe linked directly
```
Combo and manual items have no `recipe_id` on the sales item, so `recipe_category` was always null.

**Fix:**
1. Added `LEFT JOIN mcogs_categories sicat ON sicat.id = si.category_id` to the query, selecting `sicat.name AS si_category`
2. Updated category logic:
```js
const category = mi.item_type === 'ingredient'
  ? (mi.ingredient_category || mi.si_category || null)
  : mi.item_type === 'recipe'
    ? (mi.recipe_category || mi.si_category || null)
    : (mi.si_category || null);  // combo, manual — use sales item's own category
```

**File:** `api/src/routes/allergens.js`

---

### Fix 18 — Sales Items Edit Panel: Markets and Modifiers Stacked in Details Form

**Symptom:** The Sales Items right-side edit panel showed all fields — form inputs, market checkboxes, AND modifier group badges — scrolled together in one long form. This made the panel cluttered and difficult to navigate for items with many markets or modifier groups.

**Fix:** Introduced a `panelTab` state (`'details' | 'markets' | 'modifiers'`). Added a 3-tab bar below the panel header. Each section now lives in its own isolated tab panel:
- **Details** — all item form fields + Save button in footer
- **Markets** — country checkboxes with auto-save; footer shows "Changes saved automatically"
- **Modifiers** — assigned modifier group rows (removable) + "+ Add Modifier Group" portal; footer shows "Changes saved automatically"

Tab resets to Details whenever a different sales item is selected. Delete button always visible in footer regardless of active tab.

**File:** `app/src/pages/SalesItemsPage.tsx`

---

### Fix 19 — Combos Tab: Cogwheel Button and × Delete Icons Inconsistent

**Symptom:** Combo step options used `×` text buttons for deletion (inconsistent with other pages using SVG trash icons). Steps had a separate `⚙` cogwheel button to open the side panel, separate from the expand/collapse action on the step header.

**Fix:**
- All `×` delete buttons on step options replaced with SVG trash icons (12px, group-hover reveal pattern)
- Step header click now **simultaneously expands/collapses options AND opens the step in the side panel** — the cogwheel button was removed entirely
- Collapsing an already-expanded step also clears the side panel if that step's form was open

**File:** `app/src/pages/SalesItemsPage.tsx`

---

### Fix 20 — Modifiers Tab Inline Edit Forms Replaced with Side Panel

**Symptom:** The Modifiers tab used three separate inline forms (new group inline card, inline group edit row, inline `ModifierOptionAddForm` component) resulting in cluttered, hard-to-use UI that was visually inconsistent with the Combos tab.

**Fix:** Full Modifiers tab refactor to match Combos tab side-panel pattern:
- Removed `ModifierOptionAddForm` component, `addMgOption` function, `editMg` state, `editingOption` state, `saveOptEdit` function
- Added `MgEditTarget` discriminated union (`'group' | 'option' | null`) and a resizable side panel
- "+ New Modifier Group" button in page header → compact modal form
- Clicking a group or option routes to the appropriate side panel form
- Modifier option rows now have **↑ ↓ sort arrows** (persisted via API) and group-hover trash icons
- Added `qty` field (NUMERIC(12,4) DEFAULT 1) to `mcogs_modifier_options` — migration step 80; exposed in API (POST/PUT `/modifier-groups/:id/options`)

**Files:** `app/src/pages/SalesItemsPage.tsx`, `api/src/routes/modifier-groups.js`, `api/scripts/migrate.js`

---

### Fix 21 — TransfersTab Wrong API Path

**Symptom:** Entire Transfers tab returned 404 on all operations.

**Root Cause:** Frontend called `/transfers` but API route is registered as `/stock-transfers`.

**Fix:** Replace all `/transfers` references with `/stock-transfers` in StockManagerPage.tsx TransfersTab.

**File:** `app/src/pages/StockManagerPage.tsx`

---

### Fix 22 — Invoice/Transfer/GRN Status Changes Used Wrong HTTP Method

**Symptom:** Status transitions (submit, approve, confirm, cancel) failed silently.

**Root Cause:** Frontend used `api.patch()` with `{ status: 'newStatus' }` but backend has dedicated POST endpoints (`/:id/submit`, `/:id/approve`, `/:id/confirm`, etc.).

**Fix:** Changed all status change handlers to use `api.post()` calling the dedicated endpoint.

**Files:** `app/src/pages/StockManagerPage.tsx` (InvoicesTab, TransfersTab, GoodsInTab)

---

### Fix 23 — Invoice From-GRN Created Items With Zero Values

**Symptom:** Creating an invoice from a confirmed GRN produced line items with zero quantity and price.

**Root Cause:** `invoices.js` from-grn endpoint referenced `gi.quantity_received` and `gi.unit_cost` but the actual columns are `qty_received` and `unit_price`.

**Fix:** Changed to correct column names.

**File:** `api/src/routes/invoices.js`

---

### Fix 24 — Excel Import Template Download Returned 401

**Symptom:** Users clicking "Download template.xlsx" on the Import wizard saw a generic "file not available" browser error. Server logs showed a 401 on `GET /api/import/template`.

**Root Cause:** The link was a bare `<a href="/api/import/template" download>`. Plain anchor tags don't attach headers, so the Auth0 bearer token was never sent. The route sits behind `requireAuth`, so the server correctly rejected the anonymous request — the browser surfaced that as a failed download.

**Fix:** Replaced the anchor with a `<button>` that calls a new `downloadTemplate()` function. It uses the existing `authHeader()` helper to fetch with the bearer token, converts the response to a Blob, creates an object URL, programmatically triggers a download, then revokes the URL. Status-aware error messages route into the existing `parseError` banner:
- 401 → "Session expired — please sign in again to download the template."
- Other HTTP → `Template download failed (HTTP NNN)`
- Network error → exception message

**File:** `app/src/pages/ImportPage.tsx`

---

### Fix 25 — Sidebar Flashed Disabled Modules for 1-2 Seconds

**Symptom:** On initial page load the sidebar briefly showed nav items for globally-disabled modules (Allergens / HACCP / Audits / Stock Manager), then hid them once `/settings` returned ~1-2 seconds later.

**Root Cause:** `FeatureFlagsContext.DEFAULT_FLAGS` had every flag set to `true`, so the first render used those defaults. Real flag values only arrived after the async `/settings` fetch.

**Fix:** Sidebar now reads `loading` from `useFeatureFlags()` alongside `flags`, and hides flag-gated items while `flagsLoading` is true. Safe degradation: if the fetch fails, `finally { setLoading(false) }` runs and `DEFAULT_FLAGS` is used, so the user sees all modules rather than nothing.

**File:** `app/src/components/Sidebar.tsx`

---

### Fix 26 — Imported Categories Appeared to Vanish

**Symptom:** After using the Import wizard to create categories, users couldn't find them anywhere on the Categories page.

**Root Cause:** The import creates categories with `group_id = null` (correct). The Categories page had a "No Group" bucket but it was tucked at the bottom of the groups sidebar and only rendered when the ungrouped count was > 0. First landing on the page with `selectedGroupId = null` showed an empty-state panel — imported categories were sitting one click away in a non-obvious place.

**Fix:**
- Hoisted the "No Group" bucket to the **top** of the sidebar, always visible (even when empty, so it's a stable drop target for DnD).
- Added an auto-select effect: if any ungrouped categories exist on first load, `setSelectedGroupId('ungrouped')` so users land directly on the imported rows. Otherwise opens the first group.

**File:** `app/src/pages/CategoriesPage.tsx`

---

### Fix 27 — Categories Drag-Drop Appeared to Do Nothing

**Symptom:** Dragging a category row to reorder updated state behind the scenes but the UI kept showing the old order.

**Root Cause:** `visibleCats` filtered by group + scope but didn't sort. The initial `/categories` response was in the right order, so the first render looked correct. After a drag, `persistReorder` updated `sort_order` values in component state but the array order didn't change — `setCategories(next)` was returning the same array topology. React rendered the stale visual order despite the underlying state being correct.

**Fix:** `visibleCats` useMemo now ends with `[...list].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)`. The optimistic reorder flashes immediately; backend is authoritative on reload.

**File:** `app/src/pages/CategoriesPage.tsx`

---

## 16a. Testing — Test Suite & QA Strategy

> **Full guide:** [`docs/TESTING.md`](./docs/TESTING.md). UAT scripts: [`docs/UAT/`](./docs/UAT/). Staging setup: [`docs/STAGING.md`](./docs/STAGING.md).

The project has a phased automated test suite plus a manual UAT process. **Every new feature, bug fix, and route should land with at least one regression test.**

### Layers in place

| Layer | Tool | Location | When it runs |
|---|---|---|---|
| Unit (API) | Vitest | `api/test/unit/` | Every PR + push |
| Integration (API + real Postgres) | Vitest + Supertest | `api/test/integration/` | Every PR + push |
| Schema validation (Pepper tools) | Vitest | `api/test/schema/` | Every PR + push |
| Unit/component (frontend) | Vitest + RTL | `app/test/unit/` | Every PR + push |
| E2E | Playwright | `app/test/e2e/` | Push to main only |
| Accessibility | axe-playwright | `app/test/e2e/a11y.spec.ts` | Push to main only |
| Pepper evals | Custom runner | `api/test/evals/` | Manual / weekly cron (not in CI) |
| Performance smoke | k6 | `api/test/perf/` | Manual / on demand |
| UAT | Markdown scripts | `docs/UAT/` | Pre-release, by humans |

### Critical files

- `.github/workflows/test.yml` — CI test pipeline (typecheck, lint, api-test, app-test, e2e)
- `.github/workflows/smoke-after-deploy.yml` — post-deploy smoke check on prod
- `api/vitest.config.js` + `app/vitest.config.ts` — vitest configs with coverage thresholds
- `app/playwright.config.ts` — Playwright with Auth0 storageState caching
- `api/scripts/test-setup.js` — creates `mcogs_test` DB + runs migration
- `api/test/setup.js` — vitest global setup (env vars, DB probe, pool teardown)
- `api/test/helpers/db.js` — `withTx()` for transaction-rolled isolation
- `api/test/helpers/factories.js` — `makeIngredient()`, `makeRecipe()`, etc.
- `api/test/helpers/auth.js` — `bypassAuthMiddleware()` for Supertest
- `api/scripts/validate-seed-import.js` — one-shot end-to-end validator for the Test Data + Clear Database tools. Run with `cd api && npm run validate:seed`. Snapshots preserved-table row counts, asserts `clearData()` leaves user tables empty + preserved tables untouched, runs `seedSmall()` and reports row counts for 11 core tables, round-trips an `mcogs_import_jobs` row, then re-clears. Uses your local `api/.env` DB creds. Safe to run repeatedly.

### Test database

- Separate database `mcogs_test` (default, override via `TEST_DB_*` env vars)
- One-time setup: `cd api && npm run test:setup`
- Per-test isolation via `BEGIN ... ROLLBACK` (`withTx()` helper) — 100x faster than truncating
- Migration runs once before the suite; migration-idempotency test verifies re-running is safe

### Auth in tests

- **API tests**: `bypassAuthMiddleware()` injects `req.user` directly. Refuses to run unless `NODE_ENV=test`
- **E2E tests**: `auth.setup.ts` logs in once via real Auth0 + saves storageState; all other specs reuse it

### Coverage thresholds (current baseline)

- API: `lines: 25%, functions: 25%, branches: 20%`
- Frontend: `lines: 10%`

**Rule:** every meaningful test addition should bump the threshold by 1–2% so we never regress. Threshold drops are blocked by CI.

### Required test additions (the policy)

| Trigger | Required new tests |
|---|---|
| Bug fix | At least one regression test in the same PR |
| New API route | Unit test + integration test |
| New page | At least one Playwright E2E happy-path |
| New Pepper tool | Schema test entry + add to `api/test/evals/prompts.json` |
| New migration step | Update expected count in `migration-idempotent.test.js` |
| New shared helper | Unit test |
| Security-sensitive change (RBAC, auth, token validation) | Integration test of the gate |

### Staging environment (NEW REQUIREMENT)

**Currently missing — must be set up before UAT can run.** See [`docs/STAGING.md`](./docs/STAGING.md) for the step-by-step Lightsail provision + DNS + Auth0 + auto-deploy guide. Cost: $10/mo. Unblocks: pre-deploy UAT, safe destructive testing, schema validation, Pepper experimentation, demo environment.

### UAT process

7 scripts in `docs/UAT/`, ~3 hours total per full pass. Run by 2 independent testers against staging before each major release. Severity scale: P1 (blocks release), P2 (mitigation required), P3 (capture for next sprint). All issues land in `mcogs_bugs` or `mcogs_backlog`.

### Cost & cadence

| Activity | Cost | Cadence |
|---|---|---|
| Unit + integration suite | Free (CI minutes only) | Every PR |
| E2E in CI | Free, ~5 min | Every push to main |
| Pepper evals | ~$0.10/run | Weekly cron (Sundays 03:00 UTC) |
| k6 perf smoke | Free | Pre-release manual |
| Full UAT pass | 3 hr × 2 testers | Pre-release |

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

### `category` Column Dropped — Always Use `category_id` FK

The `category VARCHAR` column has been **dropped** from `mcogs_ingredients`, `mcogs_recipes`, and `mcogs_sales_items`. All category references now use a foreign key:

```sql
category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL
```

Any query that selects or filters on the old `category` string column will fail with "column does not exist". Always resolve the name via JOIN:

```sql
-- CORRECT
SELECT i.*, cat.name AS category
FROM mcogs_ingredients i
LEFT JOIN mcogs_categories cat ON cat.id = i.category_id

-- WRONG — column no longer exists
SELECT i.*, i.category FROM mcogs_ingredients i
```

**Affected route files that were updated:** `ingredients.js`, `recipes.js`, `menus.js`, `allergens.js`, `scenarios.js`, `shared-pages.js`, `ai-chat.js`, `import.js`, `cogs.js`.

### `mcogs_categories` Scope Flags Replace the Old `type` Column

The old `type VARCHAR` column (`'ingredient'` | `'recipe'`) on `mcogs_categories` has been replaced by three boolean scope flags:

| Flag | Meaning |
|---|---|
| `for_ingredients` | This category can be applied to ingredients |
| `for_recipes` | This category can be applied to recipes |
| `for_sales_items` | This category can be applied to sales items / POS menu items |

**Filter pattern:**
```js
// Fetch categories for ingredients only
GET /api/categories?for_ingredients=true

// Fetch categories for recipes only
GET /api/categories?for_recipes=true
```

Frontend `ImportPage.tsx` uses `c.for_ingredients` and `c.for_recipes` (not `c.type === 'ingredient'`).

### `border-collapse` Breaks `position: sticky`

When `border-collapse` is set on a table, `position: sticky` on `<th>` and `<td>` elements does not work in most browsers. This affects sticky column headers and sticky first columns in data matrices.

**Fix:** Use `border-separate border-spacing-0` on the `<table>` element, then add full `border border-border` classes to each `<th>` and `<td>` cell individually to recreate the collapsed-border appearance.

**Affected component:** `AllergenMatrixPage.tsx`

### Local Dev Server Not Required

This project deploys via GitHub Actions to Lightsail. There is no local dev server workflow. Claude Code hooks that require a running local server (e.g., the Claude Preview plugin Stop hook) are suppressed via `"disableAllHooks": true` in `.claude/settings.local.json`.

### Query Performance — Use LATERAL Instead of JOIN + GROUP BY for Aggregates

When a list endpoint needs per-row aggregate counts (e.g. quote_count per ingredient), **never** use a `LEFT JOIN` on the child table followed by `GROUP BY` + `COUNT(DISTINCT ...)`. This forces PostgreSQL to build and collapse a large join before aggregating.

**Use a `LEFT JOIN LATERAL` subquery instead:**

```sql
-- BAD: O(n × m) hash aggregate — gets exponentially worse as quotes grow
SELECT i.*, COUNT(DISTINCT pq.id) AS quote_count
FROM mcogs_ingredients i
LEFT JOIN mcogs_price_quotes pq ON pq.ingredient_id = i.id
GROUP BY i.id, ...

-- GOOD: O(n) LATERAL — one tiny indexed scan per ingredient
SELECT i.*, pq_stats.quote_count, pq_stats.active_quote_count
FROM mcogs_ingredients i
LEFT JOIN LATERAL (
  SELECT COUNT(*)::int                                  AS quote_count,
         COUNT(*) FILTER (WHERE is_active = true)::int AS active_quote_count
  FROM   mcogs_price_quotes
  WHERE  ingredient_id = i.id           -- uses idx_price_quotes_ingredient_act
) pq_stats ON true
```

The LATERAL approach uses `idx_price_quotes_ingredient_act ON (ingredient_id, is_active)` for a near-instant index-only scan per row. The bad approach scales O(n×m) — catastrophic at 2,000+ ingredients with 5+ quotes each.

**Also applies to:** recipe items per recipe, menu items per menu, etc. Whenever you need a count of child rows on a parent list endpoint, use LATERAL.

### Lightweight Badge/Stats Endpoints

When the UI needs counts for header badges or KPI tiles, **never** fetch the full dataset just to `.length` it or `.filter().length` it. Add a dedicated `GET .../stats` endpoint with simple `SELECT COUNT(*)` subqueries:

```sql
SELECT
  (SELECT COUNT(*)::int FROM mcogs_ingredients)                         AS ingredient_count,
  (SELECT COUNT(*)::int FROM mcogs_price_quotes WHERE is_active = true) AS active_quote_count,
  ...
```

This pattern is used by `GET /ingredients/stats` for the Inventory page header badges. One round-trip, milliseconds, no joins.

### Start-of-Session (SOS) Checklist

When a new session begins, Claude should perform these checks **before** diving into the user's request:

**1. Orient — read the room:**
- Read `CLAUDE.md` (loaded automatically via system context)
- Read `MEMORY.md` at `~/.claude/projects/C--GitHubReps-COGS/memory/MEMORY.md` for session-persistent notes
- Check if there's a compacted session summary — if so, verify claims against actual codebase before referencing old items as "pending" or "incomplete"

**2. Verify codebase state:**
- `git log --oneline -5` — check recent commits to understand what changed since last session
- Scan for any uncommitted changes (`git status`) — the user may have WIP from manual edits
- If the user mentions a previous session's work, **grep the codebase** to confirm it exists before assuming it's still pending

**3. Fetch live data from production (via WebFetch + internal API key from MEMORY.md):**
- **Open bugs:** `WebFetch` → `https://cogs.macaroonie.com/api/internal/bugs?status=open&key=<CLAUDE_CODE_API_KEY>` — shows unresolved bugs
- **In-progress backlog:** `WebFetch` → `https://cogs.macaroonie.com/api/internal/backlog?status=in_progress&key=<CLAUDE_CODE_API_KEY>` — shows active work items
- **Latest changelog:** `WebFetch` → `https://cogs.macaroonie.com/api/changelog` (no key needed, auth route but changelog is also seeded in migrate.js — check migrate.js directly if auth blocks the fetch)
- Report findings to user: "There are X open bugs, Y in-progress backlog items. Last changelog: [version] — [title]"

**4. Check for issues:**
- Scan for any TypeScript build errors if frontend was recently modified
- Check if migration steps are sequential (no gaps, no duplicates)
- Cross-reference WebFetch results with codebase — if a bug is marked "open" in production but the fix exists in local code, flag it

**5. Review open items:**
- Use the WebFetch results from step 3 as the source of truth (live DB), NOT session summaries
- Do NOT assume items from a session summary are still open — **always verify against live data or codebase**
- If WebFetch fails (server down, key changed), fall back to checking migration seed data in `migrate.js`

**6. Establish session context:**
- Ask the user what they want to work on (don't assume)
- If the user provides a task list, create a TodoWrite immediately
- Note the current date for changelog entries and migration step references

**Critical rule:** Never reference backlog items, bugs, or features from a previous session summary as "pending" without first checking the codebase. The session summary may be stale. **Always verify.**

### Git / Deploy Workflow — Claude Does Not Run Git Commands

The user commits and pushes all changes themselves from their local machine. **Claude should never end a response with instructions to run `git add`, `git commit`, `git push`, or any terminal commands.** Once Claude has finished editing files, the work is done. The user pushes when ready, and `deploy.yml` (GitHub Actions) automatically builds the frontend and deploys to the Lightsail server.

### End-of-Session (EOS) Protocol

When the user initiates end of session (e.g. "wrap up", "end session", "that's all"), Claude must perform the following steps **in order**:

**1. Update all documentation:**
- `CLAUDE.md` — update any sections affected by this session's changes (tables, tool counts, page descriptions, schema, routes, etc.)
- `docs/user-guide.md` — update user-facing documentation if UI or workflow changed
- `app/src/pages/HelpPage.tsx` — update in-app help if relevant features changed
- `app/src/pages/SystemPage.tsx` — update system docs sections if architecture changed
- Any other relevant docs (`docs/AI.md`, `docs/DATABASE.md`, etc.)

**2. Update backlog and issue log:**
- Add new bugs found during the session to `mcogs_bugs` via migration step seed (append to `api/scripts/migrate.js` seed data)
- Add new backlog items discovered during the session to `mcogs_backlog` via migration step seed
- **Retrospective sweep — capture work that wasn't already logged.** Walk back through this session's commits / tool calls / TodoWrite history. For each fix or feature shipped, check whether a matching `mcogs_bugs` or `mcogs_backlog` row exists. If not, seed one **with status already set to the terminal state** (`resolved` for bugs, `done` for backlog) so the audit trail is complete even when the user requested the work mid-session without a pre-filed ticket.
- For any pending hand-off tasks (work the user paused or deferred), seed a new `mcogs_backlog` row in the appropriate non-terminal state (`backlog` / `todo` / `in_progress`) so nothing falls off the board.
- Update status of resolved bugs/backlog items if applicable
- Use `ON CONFLICT (key) DO NOTHING` pattern for idempotent seeding

**3. Impact analysis (retro):**
- List all files modified and created during the session
- Identify which existing features may be affected by the changes
- Flag any cross-cutting concerns (e.g. changes to shared hooks, UI components, API middleware)
- Note any regressions or breaking changes introduced

**4. Risk and gap assessment:**
- Identify untested edge cases or scenarios
- Flag any incomplete implementations or TODO items left behind
- Highlight security considerations if applicable
- Recommend specific actions for the user (e.g. "test the X flow manually", "run migration on staging first", "review Y before deploying")
- Present as a clear, actionable list

**5. Update the Change Log:**
- Append an entry to `mcogs_changelog` via migration seed or direct INSERT in the session's migration step
- Each entry: `version` (date-based, e.g. `2026-04-14`), `title` (session summary), `entries` JSONB array of `{ type: 'added'|'changed'|'fixed'|'removed', description: string }`
- The Change Log is read-only in the UI (System → Bugs & Backlog → Change Log tab) and queryable by Pepper via `get_changelog` tool
- Format follows Keep a Changelog conventions: Added, Changed, Fixed, Removed

### Media Library Selection Behaviour

The Media Library (`app/src/components/MediaLibrary.tsx`) uses a **focus-vs-select** model with two modes that transition automatically:

**SINGLE MODE (0 or 1 items selected):**
- Clicking the image/row = **FOCUS** — replaces selection with this item, opens detail panel
- Clicking the checkbox = **ADD** — adds to selection without removing the existing one
- When a second item is added via checkbox, the mode transitions to Multi Mode

**MULTI MODE (2+ items selected):**
- Clicking **anywhere** on the image, row, or checkbox = **TOGGLE** — adds or removes from selection
- All checkboxes are always visible (not just on hover)
- The bulk action panel appears (move to category, bulk delete)

**TRANSITION BACK:** When toggling off brings the count back to 1, the system returns to Single Mode automatically. The remaining item stays selected. The next click on a different image (not checkbox) will replace it.

**Implementation:** `selectItem(item, fromCheckbox)` in MediaLibrary.tsx checks `selectedIds.size >= 2` for multi mode. In single mode, `fromCheckbox=true` toggles, `fromCheckbox=false` replaces. In multi mode, both paths toggle. GridView and ListView pass `fromCheckbox=false` from the outer click and `fromCheckbox=true` from the checkbox `onClick` (with `e.stopPropagation()`).

**Critical:** Do not change this selection logic without understanding the mode transitions. The `fromCheckbox` parameter (not `toggle`) is the key discriminator.

### Express Route Ordering — Named Routes Before Wildcards

When a router has both named routes (e.g. `/quote-lookup`, `/config`) and parameterized routes (e.g. `/:id`), the named routes MUST be defined FIRST. Express matches routes in order — if `/:id` comes first, it will match `quote-lookup` as an ID parameter and the request will fail with a type error when the SQL tries to use a string as an integer.

**Pattern:**
```javascript
// CORRECT — named routes first
router.get('/config', ...)
router.get('/quote-lookup', ...)
router.get('/:id', ...)

// WRONG — /:id catches everything
router.get('/:id', ...)
router.get('/config', ...)     // never reached
router.get('/quote-lookup', ...) // never reached
```

**Affected file:** `api/src/routes/purchase-orders.js` — was the cause of 500 errors on quote lookup.

---

## 18. Backlog

### Category Groups — Migrated (cleanup pending)

**Current state:** `mcogs_category_groups` table is live. `mcogs_categories.group_id` FK is the canonical way to assign groups. The old `group_name VARCHAR(100)` column is still present for backwards compatibility.

**Remaining cleanup:**
- Drop `group_name` from `mcogs_categories` once all consumers are confirmed to use `group_id`
- The actual `mcogs_category_groups` table has `name` and `sort_order` (no `parent_id` — the original spec had parent-child nesting but the live table is flat)

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

**Note:** The data model, DB tables, API routes, and frontend components for Sales Items, Combos, Modifier Groups, and Combo Step Options are already built. The POS_MENU_FEATURES.md doc describes the full original specification. The remaining work is deeper POS-workflow features (kitchen display, order flows, etc.).

### Smart Scenario — Ingredient-Level Cost Overrides (enhancement)

**Current state:** The Smart Scenario feature is BUILT. The base feature (menu-item-level price and cost changes via `POST /scenarios/smart` using Claude Haiku) is complete. The enhancement below would add ingredient-level granularity. **Do not build until explicitly requested.**

**What exists:** `POST /scenarios/smart` endpoint calls Claude Haiku with restricted prompt, returns structured price/cost change proposals. `SmartScenarioModal` shows confirmation table with checkboxes. Supports both price and cost changes at the menu item level. Cost overrides apply to the total recipe cost (`costOverrides[nat_key]`).

**Desired enhancement:** Allow the AI to increase the cost of a **specific ingredient within recipes**. For example, "increase bone-in wings cost by 5%" should:
1. Identify which recipes contain the "bone-in wings" ingredient
2. Increase only that ingredient's cost assumption (not the total recipe cost)
3. Recalculate each affected recipe's cost bottom-up from the new ingredient cost
4. Flow the new costs up to menu item COGS%

**Why it's complex (estimated 2-3 days):**

| Challenge | Detail |
|---|---|
| **Ingredient identification** | AI needs full recipe → ingredient breakdown loaded into context. Requires `mcogs_recipe_items` for every recipe on the menu. |
| **Cost override granularity** | Current `costOverrides` keys are recipe-level (`r_5`). Need a new key format: `r_5_i_12` (recipe 5, ingredient 12) for ingredient-level overrides. |
| **COGS recalculation** | `calcRecipeCost()` in `cogs.js` reads costs from `quoteLookup`. Would need to accept ingredient-level override map and substitute values during calculation. |
| **Cascade** | One ingredient appears in multiple recipes → multiple menu items. AI must trace the full dependency tree. |
| **Sub-recipes** | If the ingredient is in a sub-recipe, the override must propagate through the recipe hierarchy. |
| **Scenario storage** | `mcogs_menu_scenarios.cost_overrides` JSONB would need the new key format. |

**Architecture when built:**
1. Extend `POST /scenarios/smart` to load recipe → ingredient data into the AI context
2. Add `field: "ingredient_cost"` change type with `ingredient_id` and list of affected `recipe_ids`
3. Extend `calcRecipeCost()` to accept an `ingredientCostOverrides` map: `{ ingredient_id: overridden_cost_per_base_unit }`
4. Frontend applies ingredient overrides → recalculates recipe costs → updates grid

**Do not build until explicitly requested.**

### POS Functional Mockup (Menu Tester) — BUILT

**Status:** Fully built as `PosTesterPage.tsx`. Accessible at System → POS Mockup. See Section 12 (Pages Built) for full details.

**Key features:** Three-panel layout (check / menu grid / order flow), combo step walker with auto-advance for single-choice steps, modifier groups with repeat selection (+/- stepper) and auto_show (inline vs popup), fullscreen portal overlay, mock receipt modal with print, category-grouped tile grid, price level selector.

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

### April 2026 — `obscurekitty.com` → `cogs.macaroonie.com`

Migrated from the original throwaway domain to a branded subdomain under `macaroonie.com`.

**What was changed:**

| Component | Change |
|---|---|
| DNS | A record `cogs` → `13.135.158.196` added to Lightsail DNS zone for `macaroonie.com` |
| Nginx | `server_name` updated in `/etc/nginx/sites-available/menu-cogs` |
| SSL | New Let's Encrypt cert issued via `sudo certbot --nginx -d cogs.macaroonie.com` |
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
| **Production App** | https://cogs.macaroonie.com |
| **GitHub Repo** | https://github.com/mawegrzyn-ux/COGS |
| **Auth0 Dashboard** | https://manage.auth0.com → tenant: `obscurekitty.uk.auth0.com` |
| **AWS Lightsail Console** | https://lightsail.aws.amazon.com |
| **Frankfurter API** (exchange rates) | https://api.frankfurter.app — free, no key |
| **Let's Encrypt / Certbot** | `sudo certbot renew --dry-run` |
| **Enterprise Scale-Up Plan** | [`docs/ENTERPRISE_SCALE.md`](docs/ENTERPRISE_SCALE.md) |

---

## 21. Stock Manager Module

### Architecture

The Stock Manager is a self-contained inventory management module at `/stock-manager`. It uses 7 granular RBAC features (one per tab: `stock_overview`, `stock_purchase_orders`, `stock_goods_in`, `stock_invoices`, `stock_waste`, `stock_transfers`, `stock_stocktake`) and creates only new database tables — no modifications to existing tables.

> **UI naming:** Stores are called **Centres** in the UI (database tables remain `mcogs_stores`). Centre management has moved to **Configuration page → Locations** tab rather than a dedicated Stock Manager tab.

**Key design principle:** Every stock-changing operation writes to both `mcogs_stock_movements` (immutable audit ledger) and `mcogs_stock_levels` (materialized balance) in a single transaction. Movements are the source of truth; levels can be rebuilt from movements.

### Database Tables (migration steps 86-101)

14 new tables created in steps 86-99, plus:
- Step 100: `mcogs_audit_log` — central audit trail
- Step 101: `store_id` column on `mcogs_purchase_order_items` for per-item store assignment

### Auto-Generated Numbers

PostgreSQL sequences (all START 1001):
- `mcogs_po_number_seq` → PO-1001, PO-1002, ...
- `mcogs_grn_number_seq` → GRN-1001, ...
- `mcogs_inv_number_seq` → INV-1001, ...
- `mcogs_cn_number_seq` → CN-1001, ...
- `mcogs_xfer_number_seq` → TRF-1001, ...

### Stock Level Consistency

Every operation that changes stock goes through this transaction pattern:
1. INSERT into `mcogs_stock_movements` (immutable record)
2. UPSERT into `mcogs_stock_levels` via `ON CONFLICT (store_id, ingredient_id) DO UPDATE SET qty_on_hand = ...`

Operations that modify stock:
- GRN confirm (goods_in / goods_in_no_po)
- Waste logging (waste)
- Transfer dispatch (transfer_out) and confirm (transfer_in)
- Stocktake approve (stocktake_adjust)
- Manual adjustments (manual_adjust)
- Credit note apply (credit_note)

### Purchase Order Smart Item Form

When adding items to a PO:
1. User selects ingredient → system calls `GET /purchase-orders/quote-lookup?ingredient_id=X&vendor_id=Y`
2. If active quote exists: auto-populates unit_price, purchase_unit, qty_in_base_units, quote_id
3. If no quote: shows amber warning with base unit info, prompts manual entry, offers "Save as price quote" checkbox
4. Per-item store assignment: defaults to PO-level store, can override per line item

---

## 22. Audit Log

### Overview

Central audit trail for all data changes. Stored in `mcogs_audit_log` with full context.

### Data Model

Each entry stores:
- **Who:** user_sub, user_email, user_name, ip_address
- **What:** entity_type, entity_id, entity_label, action
- **Changes:** field_changes JSONB — `{ field: { old, new } }` diffs
- **Why:** context JSONB — `{ source, tool, job_id, ... }` free-form metadata
- **Related:** related_entities JSONB — `[{ type, id, label }]` links to other records

### Actions

`create` · `update` · `delete` · `status_change` · `confirm` · `approve` · `reverse`

### API Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/audit` | List with filters (entity_type, entity_id, user, action, date range, search) + pagination |
| `GET /api/audit/entity/:type/:id` | Full history for one entity |
| `GET /api/audit/field/:type/:id/:field` | History of a specific field (for right-click "Audit trail") |
| `GET /api/audit/stats` | Summary stats (by action/entity, top users) |

### Wired Routes

Audit logging is integrated into **48 route files** with **209 logAudit calls** covering every write operation:

**Core data:** `ingredients.js`, `recipes.js`, `price-quotes.js`, `categories.js`, `category-groups.js`, `vendors.js`, `brand-partners.js`, `countries.js`, `country-level-tax.js`, `locations.js`, `location-groups.js`, `units.js`, `price-levels.js`, `tax-rates.js`, `settings.js`, `preferred-vendors.js`

**Menu/Sales:** `menus.js`, `menu-items.js`, `menu-item-prices.js`, `menu-sales-items.js`, `sales-items.js`, `modifier-groups.js`, `combos.js`, `combo-templates.js`, `scenarios.js`, `shared-pages.js`

**Stock Manager:** `purchase-orders.js`, `goods-received.js`, `invoices.js`, `credit-notes.js`, `stock-levels.js`, `stock-stores.js`, `stock-transfers.js`, `order-templates.js`, `waste.js`, `stocktakes.js`

**RBAC & Users:** `users.js`, `roles.js`

**Compliance:** `allergens.js`, `haccp.js`

**System:** `ai-config.js`, `db-config.js`, `media.js`, `docs-library.js`, `feedback.js`, `bugs.js`, `backlog.js`, `faq.js`

### Helper

`api/src/helpers/audit.js` exports:
- `logAudit(dbOrClient, req, opts)` — writes audit entry (never throws, fails silently)
- `diffFields(oldRow, newRow, fields)` — compares two objects, returns `{ field: { old, new } }` or null

### UI

System → Audit Log (admin-only, gated by `settings:read`). Features:
- Filter bar: search, action dropdown, entity type dropdown, user input, date range
- Paginated table (30 per page)
- Expandable rows showing field changes (old→new with color coding), context, related entities, metadata

---

## 23. Multi-Language Support (i18n)

> **See also:** §10 → "Global App Switches" for the consolidated user-facing description of the Language Switcher (location, storage, server signal, soft-reload behaviour) and how it co-exists with the Market Switcher. This section covers the i18n implementation details: storage schema, AI translation cron, COALESCE query pattern, helpers, and Pepper integration.

**Status:** Phases 1–3 shipped + i18next skeleton for static UI strings. Ingredients was the original COALESCE pilot; **all core entity routes now apply COALESCE** (recipes, menus, categories, vendors, sales-items, price-levels, modifier-groups). **TranslationEditor** is wired into every major edit form. **Pepper read tools** respect `userCtx.language`. Design: [`docs/LANGUAGE_IMPLEMENTATION_PLAN.md`](./docs/LANGUAGE_IMPLEMENTATION_PLAN.md).

### Storage
- **`mcogs_languages`** — reference table (code, name, native_name, is_default, is_rtl, is_active, sort_order). Seeded with 10 languages: EN (active, default), FR ES DE IT NL PL PT HI (inactive until admin enables).
- **`translations JSONB`** column added to 11 entities: `mcogs_ingredients`, `mcogs_recipes`, `mcogs_sales_items`, `mcogs_modifier_groups`, `mcogs_modifier_options`, `mcogs_combo_steps`, `mcogs_combo_step_options`, `mcogs_categories`, `mcogs_vendors`, `mcogs_price_levels`, `mcogs_menus`.
- **`mcogs_countries.default_language_code`** — optional FK to `mcogs_languages(code)`.

JSONB shape:
```json
{ "fr": { "name": "Poulet", "notes": "...",
          "_meta": { "source": "ai", "hash": "<sha256>", "reviewed": false, "updated_at": "..." } } }
```

Human translations (`source: 'human'`) are **never** overwritten by AI. `hash` is SHA-256 of the English source; when the base changes, AI entries are flagged stale and retranslated on the next cron run.

### Language resolution chain (backend)

In `requireAuth` at the end of every authenticated request:
```
X-Language header > user profile preferred_language > first allowedCountry default_language_code > system default > 'en'
```
Result is attached as `req.language`. In-memory 5-minute cache for the active-languages list (`getActiveLanguages()`) avoids hitting `mcogs_languages` every request.

### API routes

| Route | Purpose |
|---|---|
| `GET /api/languages` | List active/inactive languages (all authenticated users) |
| `POST/PUT/DELETE /api/languages/:code` | Admin CRUD. Refuses to delete `en` or the default. Invalidates language cache on mutate. |
| `GET /api/translations/:entityType/:entityId` | Fetch base + translations JSONB for an entity |
| `PUT /api/translations/:entityType/:entityId/:lang` | Save human translation (stamps `source:'human'`, `reviewed:true`) |
| `DELETE /api/translations/:entityType/:entityId/:lang` | Remove one language entry |
| `POST /api/translations/warm` | Admin-triggered synchronous AI pre-warm for a language |

Entity slugs accepted: `ingredient`, `recipe`, `sales_item`, `modifier_group`, `modifier_option`, `combo_step`, `combo_step_option`, `category`, `vendor`, `price_level`, `menu`.

### AI pre-warm cron

`api/src/jobs/translateEntities.js` — scheduled at **02:15 UTC daily** (right after memory consolidation). Uses Claude Haiku 4.5 with a food-service-aware prompt. Processes rows where the AI hash no longer matches the base English text, in batches of 50. Never touches `source:'human'` entries. Results logged to `mcogs_settings.translation_jobs`.

### Query pattern (COALESCE)

Every SELECT that returns a translatable field wraps it:
```sql
SELECT COALESCE(i.translations->$1->>'name', i.name) AS name
FROM mcogs_ingredients i
```
When `req.language === 'en'` or null, the COALESCE is skipped (fallback to the base column directly — no extra bind parameter).

Helper: `api/src/helpers/translate.js` → `tCol(alias, field, paramIdx, [outAs])`, `hashText(text)`, `mergeTranslations(existing, lang, fields, meta)`, `isStale(entry, sourceText)`, `staleLanguages(row, codes, sourceText)`.

**Coverage:** COALESCE applied in `ingredients.js` (pilot), `recipes.js`, `menus.js`, `categories.js`, `vendors.js`, `sales-items.js` (fetchFull + list, includes nested modifier_groups/prices), `price-levels.js`, `modifier-groups.js` (group + option names, with cross-JOINs to translated recipe/ingredient names). Every translated response sets a `Content-Language` header and a global `Vary: X-Language` middleware ensures CDN safety. `combos.js` remains English-only for now (rare translation use case).

**Helpers for route authors:**
- `tCol(alias, field, paramIdx, outAs?)` — returns `COALESCE(alias.translations->$n->>'field', alias.field) AS outAs`
- `getLangContext(req, baseParams)` — returns `{ active, lang, paramIdx, params }`; when `active` is false, the SQL skips the COALESCE entirely (uses base column, no extra bind parameter)
- `setContentLanguage(res, req)` — sets the `Content-Language` header when serving non-English data

### Pepper language support

`buildSystemPrompt()` now accepts `userLanguage` and injects:
```
## User Language
The user's preferred language is {Name} ({code}). Respond to the user in {Name}.
When you present data (ingredient names, recipe names, categories, etc.) use the
translations returned by the tools — do not re-translate them yourself.
```
**Tool-level translation is active.** `executeTool()` reads `userCtx.language` and applies COALESCE to the SELECT queries in the key read tools: `list_ingredients`, `get_ingredient`, `list_recipes`, `get_recipe`, `list_menus`, `list_vendors`, `list_markets` (translates `default_price_level_name`), `list_categories`, `list_price_levels`, `list_price_quotes`. `ai-chat` and `ai-upload` both thread `req.language` into `userCtxWithLang` before calling `executeTool`.

Country names are intentionally NOT translated — they're proper nouns, stored in English for system interoperability. Same for vendor names when they are brand/company names (operators can still override per-language via the TranslationEditor).

### Frontend

- **`app/src/contexts/LanguageContext.tsx`** — wraps the app, persists selection to `localStorage('mcogs-language')` and writes through to `mcogs_user_profiles.profile_json.preferred_language`.
- **`app/src/hooks/useApi.ts`** — injects `X-Language: <code>` header on every request (unless English).
- **`app/src/components/LanguageSwitcher.tsx`** — compact dropdown in the Sidebar footer. Globe icon + uppercase code. Picking a language soft-reloads so cached queries re-run.
- **`app/src/components/TranslationEditor.tsx`** — reusable tabbed editor. Props: `entityType`, `entityId`, `fields`. Per-language tab shows the English base as reference, saves trigger `PUT /api/translations/:type/:id/:lang`. Visual indicator: green dot = human-reviewed, amber dot = AI draft.
- **TranslationEditor wired in:**
  - Ingredients edit modal → Translations tab (`name`, `notes`)
  - Recipes edit modal → inline below form (`name`, `description`)
  - Menus edit modal → inline below form (`name`, `description`)
  - Sales Items edit panel → new Translations tab (`name`, `display_name`, `description`)
  - Vendors edit modal → inline below form (`name`, `notes`)
  - Categories edit modal → inline below form (`name`)

### Static UI strings (i18next)

Separate from entity data translation. Uses `i18next` + `react-i18next` + `i18next-browser-languagedetector` (installed in `app/package.json`).

- **Entry point:** `app/src/i18n/index.ts` — initialises i18n with 9 resource files (en, fr, es, de, it, nl, pl, pt, hi). Imported once at the top of `main.tsx`.
- **Locale files:** `app/src/i18n/locales/*.ts` — each file exports `{ common: {...}, nav: {...} }` with ~45 shared keys. EN is the source; other locales key-mirror it.
- **LanguageContext** calls `i18n.changeLanguage(code)` when the user picks a new language, so UI strings update live without a page reload.
- **Current surfaces using `t()`:**
  - Sidebar nav labels (Dashboard, Inventory, Recipes, Sales Items, Menus, Allergens, HACCP, Stock Manager, Configuration, System, Help)
  - Sign-out tooltip, Change-language tooltip

**To translate another surface:**
```tsx
import { useTranslation } from 'react-i18next'
const { t } = useTranslation()
<button>{t('common.save')}</button>
// or from a specific namespace:
const { t } = useTranslation('nav')
<span>{t('dashboard')}</span>
```

Adding keys is additive — add to `en.ts` first, mirror to the other 8 locales. Out-of-scope surfaces still render English and degrade gracefully.

### CORS

`X-Language` and `X-Internal-Service` added to `allowedHeaders`. `Content-Language` added to `exposedHeaders` so the frontend can inspect which language the server actually served.

### Follow-ups still in backlog

- **BACK-1425** — Import wizard: Source-Language dropdown (for non-English operators importing catalogs in their own language)
- **BACK-1426** — Shared-page language support (public `/share/:slug`, no auth: URL `?lang=` → `Accept-Language` → country default → English)
- **BACK-1427** — RTL layout (deferred until Arabic / Hebrew market confirmed)
- **combos.js** — intentionally not COALESCE'd; can be added if translation of combo step names becomes a visible gap
- **Full i18next string extraction** — current coverage is Sidebar + a few common keys. Page-specific surfaces (Dashboard widgets, Menus, Inventory labels) still use hardcoded English. Extraction is additive work against `common.ts` / `nav.ts` / new namespaces

BACK-1420 through BACK-1424 are all marked `done` via migration step 123.

---

*README last updated: April 2026 (session: Backlog Kanban + Suggest Priorities + Inventory grid sticky/default + + Quote stays in tab + group_name drop + widget click-to-add-quote + Pepper backlog tools + LanguageSwitcher fix. Big multi-feature drop. New Kanban view on the Bugs & Backlog page: 5 priority columns (Highest/High/Medium/Low/Lowest), drag tiles between columns to PUT priority, inline status dropdown on each tile (todo/in_progress/in_review/done/wont_do/backlog) with color-coded states, persisted view-mode toggle. New "✨ Suggest Priorities" button in kanban (dev-only) calls `POST /api/backlog/suggest-priorities` — Anthropic Haiku reads up to 200 open items and returns conservative priority adjustment proposals as `{summary, proposals: [{key, current, proposed, reasoning}]}`; frontend modal lets user accept/reject each before batch PUT. Inventory tabs default to grid view (persisted per browser); table headers sticky across DataGrid HeaderCell, ColumnHeader, and the standalone list-view tables. + Quote button on ingredient rows no longer switches tab — PriceQuotesTab is always-mounted via sr-only wrapper when triggered, modal portal renders over Ingredients. Dropped legacy `mcogs_categories.group_name` column (canonical is `group_id` FK since step 81). Two dashboard widgets (Missing Price Quotes + Unquoted in Recipes) gained click-through: tile click navigates to `/inventory?addQuote=<id>` which InventoryPage consumes via `useSearchParams` to auto-open the Add Quote modal pre-filled with the selected ingredient. Pepper backlog tools improved: `list_backlog` default 30→50, max 100→500, response now includes `{total, returned, truncated, rows}` + drops description from default SELECT to keep token use sane; new `get_backlog_stats` tool returns aggregate counts grouped by status / priority / item_type so Pepper can answer "how many?" in a single fast COUNT query without paginating. LanguageSwitcher dropdown now anchors top-down right-aligned (was bottom-up from sidebar footer) — fixes off-screen overflow now that the switcher lives in the top bar. Quick Links widget gained Grid/Column layout toggle in edit mode (column overrides per-tile width to col-span-12 for a single-column list). Migration steps 150-154 (BACK-1962/1001/1961 done + changelogs); step 155 = consolidated changelog for this session's user-flagged work. DB: 87 tables, 149→155 steps, tools: 121→122, widgets: 22.)*

*README previous session: Recipe duplicate + Unquoted-in-Recipes widget + sub-recipe yield unit display. New POST /api/recipes/:id/duplicate clones a recipe end-to-end in a single transaction. New dashboard widget recipe-unquoted-ingredients with optional menu filter. Sub-recipe yield unit now displayed in parent recipe ingredients table (was generic "portion"). Migration steps 147-149.*

*README previous session: Recipe detail redesign + global Display Currency / Language top bar. Recipe detail header gained inline-edit name + yield + image thumbnail (with modal) + CategoryPicker (allowCreate=false) + dropped standalone Edit button. Notes section moved out of header into its own inline-editable card. Market + Price Level + Display Currency selectors moved below KPIs to a slim toolbar above ingredients (Currency now lives globally in the top bar). Variant mode auto-derived from (Market, Price Level) — removed redundant Market / PL / Market+PL toggle buttons; activeItems falls back specific → market → PL → global. Contextual Create / Copy-to-Global / Delete Variation buttons next to selectors. Conversion column dropped, qty inline-editable via CalcInput. New helpers: fmtQty (3dp + strip trailing zeros), CopyIngredientsModal (Alt+I shortcut), CreateVariationModal (replaces window.confirm/prompt). New global CurrencyContext + CurrencyProvider + CurrencySwitcher in AppLayout top bar (banknote icon, label "Show prices in"). LanguageSwitcher moved out of Sidebar footer to top bar — labels for all three switchers. RecipesPage and MenusPage Menu Engineer wired to consume useCurrency(). CategoryPicker gained allowCreate prop (default true). Hotfixes: BUG-1024 MediaLibrary z-index, BUG-1025 GET /recipes/:id missing image_url. EOS protocol step 2 updated (BACK-1960) — retrospective sweep. Migration steps 143-146.*

*README previous session: Jira 2-way sync Phase A+B + BACK-1942 Sales Items Excel view. Jira pull now syncs summary + description + labels + status + priority with last-write-wins via `jira_remote_updated_at`. Every-15-min cron `api/src/jobs/syncJira.js` calls `syncAll()`. New `GET /api/jira/sync-status` endpoint + JiraSyncBanner. Sales Items got a List ↔ Excel view toggle (4 frozen columns, inline editing, optimistic save). Migration steps 140-142.*

*README previous session: Mobile Pepper + configurable shortcut widget + categories DnD + Recipes/Inventory CalcInput + import save-feature. PWA Pepper: full-viewport mobile sheet, 44px tap targets, camera button with `capture="environment"`, push-to-talk voice input (SpeechRecognition + Whisper fallback), sentence-buffered speechSynthesis voice output, Kitchen Mode. New `POST /api/ai-transcribe` route + OPENAI_API_KEY config entry. Quick Links widget config-driven. Categories page DnD + scope filter. 16 numeric fields migrated to CalcInput. list_import_jobs Pepper tool. Sidebar flash fix (Fix 25). Migration step 139.*

*README previous session: Seed/clear validator + Excel template download fix (Fix 24). Migration step 138.*

*README previous session: Dashboard DnD + row-span + Recipe Costing Method + MapboxCountryMap focus-masking. Drag-and-drop reordering via native HTML5 DnD. `WidgetHeight = 1 | 2 | 3` + grid-auto-flow dense + ×H selector. New `mcogs_settings.data.costing_method` (`'best'` default / `'average'`) — preferred vendor always wins; setting picks the fallback. `loadQuoteLookup()` + `effectivePrice.js` refactored so price_per_base_unit is computed in SQL. MapboxCountryMap masks every country outside the focused one via a second fill layer + setFilter on default-style label layers. Migration step 137.*

*README previous session: Mapbox integration + dashboard map polish. New MAPBOX_ACCESS_TOKEN config key (encrypted config store + aiConfig cache) + `GET /api/ai-config/mapbox-token` endpoint. System → AI → Mapbox Integration card. New dashboard widgets `mapbox-map` (world map, Mapbox GL JS + vector tiles + Countries/Regions toggle) and `mapbox-country-map` (zoomed country drill-down with admin-1 regions + city pins). New hook `useMapboxToken` with module-level cache. New `WidgetPopoutProvider` / `useIsWidgetPopout` context so popped-out Mapbox widgets auto-fullscreen. `.mapbox-widget` CSS overrides in index.css so popups pick up design tokens. Existing MarketMap Regions toggle disabled (country-level only). Mapbox Regions view now only colours whole-country markets at the country base layer so region-scoped countries don't bleed solid colour. `sk.*` secret-token guard with friendly message. Migration step 136. Widgets: 17→21.*

*README previous session: QSC Audit Tool v1 — all phases + full docs + expanded Pepper toolkit. Wingstop Quality/Service/Cleanliness audits. 5 new tables (mcogs_qsc_questions with 150 seeded, mcogs_qsc_templates with 7 seeded, mcogs_qsc_audits, mcogs_qsc_responses, mcogs_qsc_response_photos). New routes /api/qsc/* (questions, templates, audits, responses, photos, last-external lookup, CSV export). Scoring engine helper with auto-unacceptable triggers + rating bands. 4 new pages under /audits (dashboard, runner, report, templates). 7 new Pepper tools (list_audits, get_audit_report, list_qsc_questions, get_qsc_question, list_audit_templates, get_audit_nc_trends, get_location_audit_history). 2 new RBAC features (audits, audits_admin) + global feature-flag switch. 11 QSC FAQ entries seeded. User guide section added. Migration steps 124-131. DB: 82→87 tables, 123→131 migration steps, tools: 97→104, features: 21→23.*

*README previous session: HTML Validator + Memory Consolidation + FAQ + Audit Expansion + Change Log — HTML content validator with Ask Pepper escalation, nightly memory consolidation MVP (node-cron, Haiku, daily/monthly summaries, profile auto-update), FAQ knowledge base (70+ entries, HelpPage tab, Pepper search_faq tool), audit logging expanded from 10→48 route files (209 logAudit calls, full coverage), Change Log table + Pepper get_changelog tool + EOS protocol step 5.*

*README previous session: Full documentation audit — updated all 22 sections of CLAUDE.md to reflect current codebase state. Added 27 missing DB tables (78 total), 25+ missing API routes, 6 missing pages (Configuration, System, MediaLibrary, BugsBacklog, PosTester, SharedMenu). Updated repository structure with 20+ missing files. Added config store architecture, db-config API, sidebar navigation. Updated RBAC features 19→21 (bugs, backlog). Updated router structure with legacy redirects.*

*README two sessions ago: POS Mockup + Smart Scenario + CalcInput + Pepper docking redesign + modifier enhancements — POS Mockup built, Smart Scenario built, CalcInput component, Pepper docking (left/right/bottom), allow_repeat_selection + auto_show modifier flags, PO improvements, security fixes, 20+ bug fixes, docs: SECURITY_AUDIT.md, AI_MEMORY_REVIEW.md*

*README three sessions ago: Stock Manager module — 20 new DB tables (mcogs_stores through mcogs_audit_log, migration steps 86-101), 11 new API route files, StockManagerPage.tsx with 8 tabs, stock_manager RBAC feature, audit helper + logging wired into 8 routes, auto-generated PO/GRN/INV/CN/TRF numbers, dual-write stock consistency, PO smart item form with quote-lookup auto-populate*
