# COGS Data Export Schema

**Version:** 1.0.0
**Generated:** 2026-06-06

## Overview

The COGS export tool (`node scripts/export-data.js`) produces a single JSON file containing all operational data from a COGS instance. This file can be imported into another instance using `node scripts/import-data-full.js`.

**Excluded from export:** User accounts, roles, permissions, AI chat logs, audit logs, import job history, and AI memory tables. These are instance-specific or seeded by the migration script.

---

## Export File Format

```json
{
  "exported_at": "ISO 8601 timestamp",
  "source": "host:port/database",
  "version": "1.0.0",
  "table_count": 87,
  "tables": {
    "table_name": [ { ...row }, { ...row } ]
  },
  "row_counts": {
    "table_name": 42
  }
}
```

---

## Table Groups & Dependencies

Tables are listed in **import order** — parent tables before children. Foreign key dependencies are noted with `→ parent_table`.

### 1. Master Data (14 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 1 | `mcogs_units` | Units of measure (kg, g, L, ml, each, etc.) | `id`, `name`, `abbreviation` | — |
| 2 | `mcogs_price_levels` | Price tiers (Dine-in, Takeaway, Delivery, etc.) | `id`, `name`, `sort_order` | — |
| 3 | `mcogs_brand_partners` | Brand partner organisations | `id`, `name`, `code`, `logo_url` | — |
| 4 | `mcogs_countries` | Markets / countries with currency and tax config | `id`, `name`, `code`, `currency_code`, `currency_symbol`, `brand_partner_id` | → `mcogs_brand_partners` |
| 5 | `mcogs_country_tax_rates` | Tax rates per market (VAT, GST, etc.) | `id`, `country_id`, `name`, `rate` | → `mcogs_countries` |
| 6 | `mcogs_country_level_tax` | Tax rates applied per price level per market | `country_id`, `price_level_id`, `tax_rate_id` | → `mcogs_countries`, `mcogs_price_levels`, `mcogs_country_tax_rates` |
| 7 | `mcogs_country_price_levels` | Which price levels are active in which market | `country_id`, `price_level_id` | → `mcogs_countries`, `mcogs_price_levels` |
| 8 | `mcogs_regions` | Geographic regions for grouping markets | `id`, `name` | — |
| 9 | `mcogs_market_regions` | Market-to-region mapping (junction) | `country_id`, `region_id` | → `mcogs_countries`, `mcogs_regions` |
| 10 | `mcogs_categories` | Ingredient / recipe / sales item categories | `id`, `name`, `for_ingredients`, `for_recipes`, `for_sales_items`, `parent_id`, `category_group_id` | → self, → `mcogs_category_groups` |
| 11 | `mcogs_category_groups` | Category groupings | `id`, `name` | — |
| 12 | `mcogs_allergens` | Allergen definitions (EU 14, etc.) | `id`, `name`, `code`, `icon_url` | — |
| 13 | `mcogs_languages` | Supported languages | `id`, `code`, `name` | — |
| 14 | `mcogs_settings` | Application settings (JSON blob) | `id` (always 1), `data` (JSONB) | — |

### 2. Inventory (5 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 15 | `mcogs_vendors` | Suppliers / vendors | `id`, `name`, `country_id`, `contact_email` | → `mcogs_countries` |
| 16 | `mcogs_ingredients` | Raw ingredients / stock items | `id`, `name`, `category_id`, `unit_id`, `pack_size`, `pack_unit_id` | → `mcogs_categories`, → `mcogs_units` |
| 17 | `mcogs_ingredient_allergens` | Ingredient-allergen mapping (junction) | `ingredient_id`, `allergen_id`, `level` | → `mcogs_ingredients`, → `mcogs_allergens` |
| 18 | `mcogs_price_quotes` | Vendor price quotes for ingredients | `id`, `ingredient_id`, `vendor_id`, `price`, `currency_code` | → `mcogs_ingredients`, → `mcogs_vendors` |
| 19 | `mcogs_ingredient_preferred_vendor` | Preferred vendor per ingredient per market | `ingredient_id`, `country_id`, `vendor_id`, `price_quote_id` | → `mcogs_ingredients`, → `mcogs_countries`, → `mcogs_vendors`, → `mcogs_price_quotes` |

### 3. Recipes (5 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 20 | `mcogs_recipes` | Recipe definitions | `id`, `name`, `category_id`, `yield_qty`, `yield_unit_id`, `method` | → `mcogs_categories`, → `mcogs_units` |
| 21 | `mcogs_recipe_items` | Recipe ingredients (BOM lines) | `id`, `recipe_id`, `ingredient_id`, `sub_recipe_id`, `qty`, `unit_id`, `variation_id` | → `mcogs_recipes`, → `mcogs_ingredients`, → `mcogs_units` |
| 22 | `mcogs_recipe_variations` | Market-level recipe cost overrides | `id`, `recipe_id`, `country_id` | → `mcogs_recipes`, → `mcogs_countries` |
| 23 | `mcogs_recipe_pl_variations` | Price-level recipe variations | `id`, `recipe_id`, `price_level_id` | → `mcogs_recipes`, → `mcogs_price_levels` |
| 24 | `mcogs_recipe_market_pl_variations` | Market + price-level recipe variations | `id`, `recipe_id`, `country_id`, `price_level_id` | → `mcogs_recipes`, → `mcogs_countries`, → `mcogs_price_levels` |

### 4. Sales Items & Modifiers (13 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 25 | `mcogs_sales_items` | Sellable items (simple, combo, modifier-based) | `id`, `name`, `item_type`, `recipe_id`, `category_id` | → `mcogs_recipes`, → `mcogs_categories` |
| 26 | `mcogs_sales_item_markets` | Which markets a sales item is available in | `sales_item_id`, `country_id` | → `mcogs_sales_items`, → `mcogs_countries` |
| 27 | `mcogs_sales_item_prices` | Sell prices per price level per market | `id`, `sales_item_id`, `country_id`, `price_level_id`, `sell_price`, `tax_rate_id` | → `mcogs_sales_items`, → `mcogs_countries`, → `mcogs_price_levels`, → `mcogs_country_tax_rates` |
| 28 | `mcogs_modifier_groups` | Modifier group definitions (e.g. "Choose a sauce") | `id`, `name`, `min_select`, `max_select` | — |
| 29 | `mcogs_modifier_options` | Individual modifier options | `id`, `modifier_group_id`, `name`, `recipe_id`, `ingredient_id`, `price_addon` | → `mcogs_modifier_groups`, → `mcogs_recipes`, → `mcogs_ingredients` |
| 30 | `mcogs_sales_item_modifier_groups` | Junction: sales items ↔ modifier groups | `sales_item_id`, `modifier_group_id`, `sort_order` | → `mcogs_sales_items`, → `mcogs_modifier_groups` |
| 31 | `mcogs_combos` | Standalone combo definitions | `id`, `name`, `category_id` | → `mcogs_categories` |
| 32 | `mcogs_combo_steps` | Combo steps ("Choose a burger", "Choose a side") | `id`, `combo_id`, `sales_item_id`, `name`, `min_select`, `max_select` | → `mcogs_combos`, → `mcogs_sales_items` |
| 33 | `mcogs_combo_step_options` | Options within a combo step | `id`, `step_id`, `name`, `item_type`, `recipe_id`, `ingredient_id`, `sales_item_id` | → `mcogs_combo_steps`, → `mcogs_recipes`, → `mcogs_ingredients`, → `mcogs_sales_items` |
| 34 | `mcogs_combo_step_option_modifier_groups` | Modifiers attached to combo step options | `combo_step_option_id`, `modifier_group_id` | → `mcogs_combo_step_options`, → `mcogs_modifier_groups` |
| 35 | `mcogs_combo_templates` | Reusable combo structure templates | `id`, `name` | — |
| 36 | `mcogs_combo_template_steps` | Steps in a combo template | `id`, `template_id`, `name` | → `mcogs_combo_templates` |
| 37 | `mcogs_combo_template_step_options` | Options in a combo template step | `id`, `template_step_id`, `name`, `item_type` | → `mcogs_combo_template_steps` |

### 5. Menus (10 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 38 | `mcogs_menus` | Menu definitions | `id`, `name`, `country_id` | → `mcogs_countries` |
| 39 | `mcogs_menu_items` | Legacy menu items (recipe-based) | `id`, `menu_id`, `recipe_id`, `name`, `sell_price` | → `mcogs_menus`, → `mcogs_recipes` |
| 40 | `mcogs_menu_item_prices` | Legacy menu item price overrides per price level | `id`, `menu_item_id`, `price_level_id`, `sell_price` | → `mcogs_menu_items`, → `mcogs_price_levels` |
| 41 | `mcogs_menu_sales_items` | Menu ↔ sales item assignments | `id`, `menu_id`, `sales_item_id` | → `mcogs_menus`, → `mcogs_sales_items` |
| 42 | `mcogs_menu_sales_item_prices` | Menu-level sell prices for sales items | `id`, `menu_sales_item_id`, `price_level_id`, `sell_price`, `tax_rate_id` | → `mcogs_menu_sales_items`, → `mcogs_price_levels`, → `mcogs_country_tax_rates` |
| 43 | `mcogs_menu_combo_option_prices` | Menu-level combo option price overrides | `menu_sales_item_id`, `combo_step_option_id`, `price_level_id`, `sell_price` | → `mcogs_menu_sales_items`, → `mcogs_combo_step_options`, → `mcogs_price_levels` |
| 44 | `mcogs_menu_modifier_option_prices` | Menu-level modifier option price overrides | `menu_sales_item_id`, `modifier_option_id`, `price_level_id`, `sell_price` | → `mcogs_menu_sales_items`, → `mcogs_modifier_options`, → `mcogs_price_levels` |
| 45 | `mcogs_menu_scenarios` | Menu what-if scenarios | `id`, `menu_id`, `name`, `data` | → `mcogs_menus` |
| 46 | `mcogs_shared_pages` | Shareable menu pages (slug-based) | `id`, `menu_id`, `slug`, `name`, `config` | → `mcogs_menus` |
| 47 | `mcogs_shared_page_changes` | Change tracking on shared pages | `id`, `shared_page_id`, `change_type`, `data` | → `mcogs_shared_pages` |

### 6. Locations & Stock (22 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 48 | `mcogs_location_groups` | Location groupings (regions, districts) | `id`, `name` | — |
| 49 | `mcogs_locations` | Physical locations / restaurants | `id`, `name`, `country_id`, `group_id` | → `mcogs_countries`, → `mcogs_location_groups` |
| 50 | `mcogs_stores` | Sub-locations / storage areas within a location | `id`, `location_id`, `name`, `store_type` | → `mcogs_locations` |
| 51 | `mcogs_stock_levels` | Current on-hand stock per store per ingredient | `id`, `store_id`, `ingredient_id`, `qty` | → `mcogs_stores`, → `mcogs_ingredients` |
| 52 | `mcogs_stock_movements` | Stock movement audit trail | `id`, `store_id`, `ingredient_id`, `qty`, `movement_type`, `reference_type`, `reference_id` | → `mcogs_stores`, → `mcogs_ingredients` |
| 53 | `mcogs_purchase_orders` | Purchase orders to vendors | `id`, `location_id`, `vendor_id`, `status`, `order_date` | → `mcogs_locations`, → `mcogs_vendors` |
| 54 | `mcogs_purchase_order_items` | Line items on purchase orders | `id`, `purchase_order_id`, `ingredient_id`, `qty`, `unit_price` | → `mcogs_purchase_orders`, → `mcogs_ingredients` |
| 55 | `mcogs_order_templates` | Reusable order templates | `id`, `location_id`, `vendor_id`, `name` | → `mcogs_locations`, → `mcogs_vendors` |
| 56 | `mcogs_order_template_items` | Items in an order template | `id`, `template_id`, `ingredient_id` | → `mcogs_order_templates`, → `mcogs_ingredients` |
| 57 | `mcogs_goods_received` | Goods received notes (GRNs) | `id`, `location_id`, `vendor_id`, `purchase_order_id` | → `mcogs_locations`, → `mcogs_vendors`, → `mcogs_purchase_orders` |
| 58 | `mcogs_goods_received_items` | Line items on GRNs | `id`, `goods_received_id`, `ingredient_id`, `qty_received` | → `mcogs_goods_received`, → `mcogs_ingredients` |
| 59 | `mcogs_invoices` | Vendor invoices | `id`, `location_id`, `vendor_id`, `goods_received_id` | → `mcogs_locations`, → `mcogs_vendors`, → `mcogs_goods_received` |
| 60 | `mcogs_invoice_items` | Invoice line items | `id`, `invoice_id`, `ingredient_id`, `qty`, `unit_price` | → `mcogs_invoices`, → `mcogs_ingredients` |
| 61 | `mcogs_credit_notes` | Credit notes from vendors | `id`, `location_id`, `vendor_id` | → `mcogs_locations`, → `mcogs_vendors` |
| 62 | `mcogs_credit_note_items` | Credit note line items | `id`, `credit_note_id`, `ingredient_id` | → `mcogs_credit_notes`, → `mcogs_ingredients` |
| 63 | `mcogs_waste_reason_codes` | Waste reason codes | `id`, `name`, `code` | — |
| 64 | `mcogs_waste_log` | Waste entries | `id`, `location_id`, `store_id`, `ingredient_id`, `reason_code_id` | → `mcogs_locations`, → `mcogs_stores`, → `mcogs_ingredients`, → `mcogs_waste_reason_codes` |
| 65 | `mcogs_stock_transfers` | Inter-store stock transfers | `id`, `from_store_id`, `to_store_id` | → `mcogs_stores` |
| 66 | `mcogs_stock_transfer_items` | Transfer line items | `id`, `transfer_id`, `ingredient_id`, `qty` | → `mcogs_stock_transfers`, → `mcogs_ingredients` |
| 67 | `mcogs_stocktakes` | Stocktake / inventory count sessions | `id`, `store_id`, `status` | → `mcogs_stores` |
| 68 | `mcogs_stocktake_items` | Stocktake count lines | `id`, `stocktake_id`, `ingredient_id`, `counted_qty` | → `mcogs_stocktakes`, → `mcogs_ingredients` |
| 69 | `mcogs_kiosk_orders` | Kiosk order records | `id`, `location_id`, `menu_id`, `order_data` | → `mcogs_locations`, → `mcogs_menus` |

### 7. HACCP (3 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 70 | `mcogs_equipment` | Equipment register (fridges, freezers, etc.) | `id`, `name`, `location_id`, `equipment_type` | → `mcogs_locations` |
| 71 | `mcogs_equipment_temp_logs` | Temperature log readings | `id`, `equipment_id`, `temperature`, `logged_at` | → `mcogs_equipment` |
| 72 | `mcogs_ccp_logs` | Critical Control Point logs | `id`, `recipe_id`, `location_id`, `logged_at` | → `mcogs_recipes`, → `mcogs_locations` |

### 8. QSC — Quality, Service, Cleanliness (5 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 73 | `mcogs_qsc_questions` | QSC audit question definitions | `id`, `text`, `category`, `sort_order` | — |
| 74 | `mcogs_qsc_templates` | QSC audit templates | `id`, `name`, `questions` (JSONB) | — |
| 75 | `mcogs_qsc_audits` | QSC audit sessions | `id`, `template_id`, `location_id`, `auditor_name`, `status` | → `mcogs_qsc_templates`, → `mcogs_locations` |
| 76 | `mcogs_qsc_responses` | Individual question responses | `id`, `audit_id`, `question_id`, `score`, `notes` | → `mcogs_qsc_audits`, → `mcogs_qsc_questions` |
| 77 | `mcogs_qsc_response_photos` | Photos attached to responses | `id`, `response_id`, `url` | → `mcogs_qsc_responses` |

### 9. Backlog & Tracking (4 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 78 | `mcogs_feedback` | User feedback / feature requests | `id`, `title`, `description`, `status`, `type` | — |
| 79 | `mcogs_bugs` | Bug reports | `id`, `title`, `description`, `status`, `severity` | — |
| 80 | `mcogs_backlog` | Product backlog items | `id`, `title`, `description`, `status`, `priority`, `jira_key` | — |
| 81 | `mcogs_item_comments` | Comments on feedback/bugs/backlog items | `id`, `item_type`, `item_id`, `body`, `author` | — |

### 10. Documentation (3 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 82 | `mcogs_doc_categories` | Documentation categories | `id`, `name`, `sort_order` | — |
| 83 | `mcogs_docs` | Documentation pages | `id`, `category_id`, `title`, `content` | → `mcogs_doc_categories` |
| 84 | `mcogs_faq` | FAQ entries | `id`, `question`, `answer`, `sort_order` | — |

### 11. Media (2 tables)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 85 | `mcogs_media_categories` | Media library categories | `id`, `name` | — |
| 86 | `mcogs_media_items` | Media files (images, documents) | `id`, `category_id`, `filename`, `url`, `mime_type` | → `mcogs_media_categories` |

### 12. Changelog (1 table)

| # | Table | Description | Key Columns | Dependencies |
|---|-------|-------------|-------------|--------------|
| 87 | `mcogs_changelog` | Application changelog / release notes | `id`, `version`, `title`, `entries` (JSONB) | — |

---

## Excluded Tables (13 tables)

These tables are **not exported** because they contain instance-specific or transient data:

| Table | Reason |
|-------|--------|
| `mcogs_users` | User accounts — instance-specific |
| `mcogs_user_brand_partners` | User ↔ brand partner assignments |
| `mcogs_user_notes` | Per-user notes |
| `mcogs_user_profiles` | User display preferences |
| `mcogs_user_scope` | User data access scoping |
| `mcogs_user_scope_templates` | Scope templates |
| `mcogs_roles` | System-seeded by migration |
| `mcogs_role_permissions` | System-seeded by migration |
| `mcogs_ai_chat_log` | AI conversation history |
| `mcogs_audit_log` | Audit trail — instance-specific |
| `mcogs_import_jobs` | Import job history — transient |
| `mcogs_memory_daily` | AI daily memory — transient |
| `mcogs_memory_monthly` | AI monthly memory — transient |

---

## Usage

### Export

```bash
cd api

# Export to timestamped file (default)
npm run export
# → writes mcogs-export-2026-06-06.json

# Export to specific file
npm run export -- my-backup.json

# Compact JSON (smaller file size)
npm run export -- --compact

# Compact + custom filename
npm run export -- --compact my-backup.json
```

### Import

```bash
cd api

# Full import (replaces all data)
npm run import:full -- mcogs-export-2026-06-06.json

# Dry run (show what would be imported)
npm run import:full -- mcogs-export-2026-06-06.json --dry-run

# Import only specific tables
npm run import:full -- mcogs-export.json --tables=mcogs_units,mcogs_vendors,mcogs_ingredients

# Skip specific tables
npm run import:full -- mcogs-export.json --skip=mcogs_stock_movements,mcogs_equipment_temp_logs
```

### Import Notes

- **The import TRUNCATES target tables** before inserting. All existing data in imported tables will be replaced.
- Foreign key constraints are temporarily disabled during import via `SET session_replication_role = replica`.
- Serial sequences are reset to `MAX(id) + 1` after each table is imported.
- Junction tables (composite primary keys) skip the sequence reset.
- The import runs in a single transaction — if any table fails, the entire import is rolled back.

---

## Data Types & Serialisation

| PostgreSQL Type | JSON Representation |
|-----------------|---------------------|
| `INTEGER`, `SERIAL` | Number |
| `NUMERIC(n,m)` | String (preserves precision) |
| `VARCHAR`, `TEXT` | String |
| `BOOLEAN` | Boolean (`true`/`false`) |
| `TIMESTAMPTZ` | String (ISO 8601: `"2026-06-06T12:00:00.000Z"`) |
| `JSONB` | Object or Array (embedded JSON) |
| `TEXT[]` | Array of strings |
| `INTEGER[]` | Array of numbers |
| `NULL` | `null` |

---

## Dependency Graph (simplified)

```
units ─────────────────────────────────┐
price_levels ──────────────────────────┤
brand_partners ────┐                   │
                   ├→ countries ───────┤
                   │    ├→ tax_rates   │
                   │    ├→ vendors ────┤
                   │    │              │
allergens ─────────┤    │              │
categories ────────┤    │              │
                   │    │              │
                   ├→ ingredients ─────┤
                   │    ├→ allergen    │
                   │    ├→ quotes ─────┤
                   │    └→ pref vendor │
                   │                   │
                   ├→ recipes ─────────┤
                   │    ├→ items       │
                   │    └→ variations  │
                   │                   │
                   ├→ sales_items ─────┤
                   │    ├→ modifiers   │
                   │    ├→ combos      │
                   │    └→ prices      │
                   │                   │
                   ├→ menus ───────────┤
                   │    ├→ menu_items  │
                   │    ├→ scenarios   │
                   │    └→ shared_pages│
                   │                   │
location_groups ───┤                   │
                   ├→ locations ───────┤
                   │    ├→ stores      │
                   │    ├→ stock       │
                   │    ├→ POs         │
                   │    └→ equipment   │
                   │                   │
                   └→ backlog, bugs,   │
                      feedback, docs   │
```
