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
| **Database** | PostgreSQL 16 — database: `mcogs`, 82 tables (all prefixed `mcogs_`), 121 migration steps |
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
| `GET/PUT /api/ai-config` | `ai-config.js` | ✅ Active — AI feature flag configuration |
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

- **AI** — Embeds Settings → AI (API keys, token usage, concise mode)
- **Bugs & Backlog** — Embedded `BugsBacklogPage` (previously standalone at `/bugs-backlog`, now redirects here). Two-tab tracker: bugs (BUG-1001+) and feature backlog (BACK-1001+). Visible to all users. Migration step 108 seeds known bugs and backlog items from CLAUDE.md
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
- COGS calculation: cost per portion based on preferred vendor quotes
- **Market variations** — alternative ingredient lists per country/market (existing)
- **Price Level Recipes (PL Variations)** — alternative ingredient lists per price level. Create via the Price Level variant selector. Priority: PL variation > market variation > global recipe. Stored in `mcogs_recipe_pl_variations`; items linked via `pl_variation_id` on `mcogs_recipe_items`. Copy-to-global promotes a PL variation to the global recipe.

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

**Widgets (17):**
| Category | Widgets |
|---|---|
| KPI tiles (¼ width) | `kpi-ingredients`, `kpi-recipes`, `kpi-menus`, `kpi-markets`, `kpi-vendors`, `kpi-active-quotes`, `kpi-categories`, `kpi-coverage` |
| Full-width cards | `coverage-bar`, `menu-tiles`, `quick-links` (with SVG icons), `market-header`, `market-picker`, `market-map`, `menu-top-items` |
| Half-width cards | `missing-quotes`, `recent-quotes`, `market-stats` |

**Customise mode:**
- `✎ Customise` toggle in header → shows per-widget controls (↑ ↓ reorder, size selector ¼/½/¾/Full, ✕ remove)
- `+ Add widget` dropdown (edit mode only) lists widgets not yet on the board
- Template selector + `↺ Reset` button (edit mode only) — Reset restores the current template's default slot list
- In view mode, header is clean: just Dashboard title · Customise · Refresh

**Widget grid:** 12-col CSS grid. Sizes map to col-spans: `sm=3 (¼)`, `md=6 (½)`, `lg=9 (¾)`, `xl=12 (full)`. Sizes gracefully collapse to 12 on mobile, 6 on tablet.

**Market scope integration:** Widgets marked `marketScoped: true` auto-filter by the global market selection (top-bar `MarketSwitcher`). Non-scoped widgets (categories, recipes, markets count) always show global data. The market filter respects RBAC `allowedCountries`.

**Key files:**
- `app/src/pages/DashboardPage.tsx` — shell, template selector, customise mode, slot rendering
- `app/src/dashboard/types.ts` — `WidgetId`, `WidgetSize`, `SlotConfig`, `DashboardConfig`, `Template`
- `app/src/dashboard/templates.ts` — `WIDGET_REGISTRY` (meta per widget) + 3 `TEMPLATES`
- `app/src/dashboard/DashboardData.tsx` — shared data provider (one fetch, all widgets subscribe). Loads ingredients, recipes, vendors, countries, menus, categories, price-levels, quotes, settings. Also computes per-menu COGS tiles scoped to the active market.
- `app/src/dashboard/widgets.tsx` — 15 widget components + registry mapping `WidgetId → Component`. `MarketMap` and `MenuTopItemsChart` are lazy-loaded.
- `app/src/dashboard/MarketMap.tsx` — 2D world map (react-simple-maps + d3-geo, natural-earth topojson from jsDelivr CDN). Countries shaded by avg COGS% (green ≤30%, amber ≤40%, red >40%, accent-dim if no data, pale grey if outside RBAC scope). Click to set market, ZoomableGroup for zoom/pan. Name matching uses an alias table for USA/UK/Czechia/Myanmar/etc.
- `app/src/dashboard/MenuTopItemsChart.tsx` — horizontal bar chart showing top 10 items per menu. Metric toggle (Cost / Revenue / COGS%). Per-menu price-level override dropdown when >1 level exists. Data from `/cogs/menu-sales/:id?price_level_id=X`.

**Dependencies added:** `react-simple-maps ^3.0.0`, `d3-geo ^3.1.1` (plus their `@types/*`). Lazy-loaded so bundle stays lean when map isn't used.

### Global Market Switcher

Top-bar dropdown in `AppLayout` (right side) — the central control for scoping the app to a single market. Provided by `MarketContext` (`app/src/contexts/MarketContext.tsx`).

- **Persistence:** selected `countryId` saved to `localStorage['cogs-market-country-id']`, restored on page load
- **RBAC-aware:** the dropdown only lists countries in the user's `allowedCountries`. If a stored selection falls outside scope after a role change, it auto-clears
- **Search:** built-in search input in the dropdown when ≥6 countries
- **"All markets" default** — `countryId === null` means global view
- **Consumers:** Dashboard widgets (`useMarket().countryId`), `MarketMap`, `MarketPicker`, `MarketStats`, `MarketHeader`, `MenuTopItemsChart`. Other pages can opt in by calling `useMarket()`.

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
- **Market scope filtering:** all data-read and export tools respect `allowedCountries` from the user's RBAC scope (`mcogs_user_brand_partners`); `null` = unrestricted (Admin default), non-null = array of permitted country IDs injected from `req.user.allowedCountries`
- **Panel mode:** `PepperMode = 'docked-left' | 'docked-right' | 'docked-bottom'` — persisted in `localStorage('pepper-mode')`. Left/right render as full-height flex columns in `AppLayout`; bottom renders as a resizable panel (200px-60vh) below main content

### Tool Count: 97

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

**Import (1):**
`start_import` — accepts file text content already in conversation, calls `stageFileContent()`, returns `{ job_id, url: '/import?job=<id>', summary }` so the user can click through to the Import Wizard

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

### Features (21)

`dashboard` · `inventory` · `recipes` · `menus` · `allergens` · `haccp` · `markets` · `categories` · `settings` · `import` · `ai_chat` · `users` · `stock_overview` · `stock_purchase_orders` · `stock_goods_in` · `stock_invoices` · `stock_waste` · `stock_transfers` · `stock_stocktake` · `bugs` · `backlog`

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
| **AI** | — | none | Embeds Settings → AI (API keys, token usage, concise mode) |
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

*README last updated: April 2026 (session: HTML Validator + Memory Consolidation + FAQ + Audit Expansion + Change Log — HTML content validator with Ask Pepper escalation, nightly memory consolidation MVP (node-cron, Haiku, daily/monthly summaries, profile auto-update), FAQ knowledge base (70+ entries, HelpPage tab, Pepper search_faq tool), audit logging expanded from 10→48 route files (209 logAudit calls, full coverage), Change Log table + Pepper get_changelog tool + EOS protocol step 5, Pepper keyboard shortcut Ctrl+Shift+P, user message text colour fix in renderMd, test data clearData fixed (30 missing tables added), EOS protocol documented. DB: 78→82 tables, 107→120 migration steps, tools: 92→97.)*

*README previous session: Full documentation audit — updated all 22 sections of CLAUDE.md to reflect current codebase state. Added 27 missing DB tables (78 total), 25+ missing API routes, 6 missing pages (Configuration, System, MediaLibrary, BugsBacklog, PosTester, SharedMenu). Updated repository structure with 20+ missing files. Added config store architecture, db-config API, sidebar navigation. Updated RBAC features 19→21 (bugs, backlog). Updated router structure with legacy redirects.*

*README two sessions ago: POS Mockup + Smart Scenario + CalcInput + Pepper docking redesign + modifier enhancements — POS Mockup built, Smart Scenario built, CalcInput component, Pepper docking (left/right/bottom), allow_repeat_selection + auto_show modifier flags, PO improvements, security fixes, 20+ bug fixes, docs: SECURITY_AUDIT.md, AI_MEMORY_REVIEW.md*

*README three sessions ago: Stock Manager module — 20 new DB tables (mcogs_stores through mcogs_audit_log, migration steps 86-101), 11 new API route files, StockManagerPage.tsx with 8 tabs, stock_manager RBAC feature, audit helper + logging wired into 8 routes, auto-generated PO/GRN/INV/CN/TRF numbers, dual-write stock consistency, PO smart item form with quote-lookup auto-populate*
