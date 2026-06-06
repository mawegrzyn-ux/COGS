# COGS Data Transfer — Feature Documentation

**Version:** 1.0.0
**Last updated:** 2026-06-06

---

## 1. Purpose

The Data Transfer feature provides backup, restore, and migration capabilities for COGS instances. It allows administrators to:

- **Export** a complete snapshot of all operational data as a single JSON file
- **Import** a previously exported file to restore data or clone an instance
- **Validate** an import file before committing via dry-run mode
- **Selectively** export or import specific data groups

This is designed for migrating data between environments (e.g. staging → production), creating backups before major changes, or spinning up new COGS instances pre-loaded with data.

---

## 2. Architecture

### Components

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend                                                       │
│                                                                 │
│  ConfigurationPage.tsx                                          │
│    └─ DataTransferPage.tsx  (🔄 Data Transfer section)          │
│         ├─ Export card       select groups, download JSON        │
│         ├─ Import card       upload JSON, dry-run, execute       │
│         └─ Table inventory   live row counts, existence status   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  API                                                            │
│                                                                 │
│  /api/data-transfer/tables     GET    live table inventory       │
│  /api/data-transfer/export     POST   download export JSON       │
│  /api/data-transfer/import     POST   upload + import JSON       │
│  /api/data-transfer/history    GET    (placeholder)              │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  CLI Scripts (also used as modules by the API)                  │
│                                                                 │
│  scripts/export-data.js        npm run export                   │
│  scripts/import-data-full.js   npm run import:full              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### File Locations

| File | Purpose |
|------|---------|
| `app/src/pages/DataTransferPage.tsx` | Frontend UI component |
| `app/src/pages/ConfigurationPage.tsx` | Host page (Data Transfer is a section) |
| `api/src/routes/data-transfer.js` | API route (4 endpoints) |
| `api/src/routes/index.js` | Route mounting |
| `api/scripts/export-data.js` | CLI export + shared module |
| `api/scripts/import-data-full.js` | CLI import + shared module |
| `docs/export-schema.md` | Full table-by-table schema reference |

### Access Control

- **Permission required:** `settings:write` (admin only)
- **Auth:** All endpoints require Auth0 JWT authentication
- **Route mounting:** `router.use('/data-transfer', ...can('settings', 'write'), require('./data-transfer'))`

---

## 3. Data Scope

### Exported (87 tables across 12 groups)

| Group | Tables | Description |
|-------|--------|-------------|
| **Master Data** | 14 | Units, price levels, brand partners, countries, tax rates, categories, allergens, languages, settings |
| **Inventory** | 5 | Vendors, ingredients, allergen mappings, price quotes, preferred vendors |
| **Recipes** | 5 | Recipes, recipe items (BOM), market/price-level/combined variations |
| **Sales Items** | 13 | Sales items, market assignments, prices, modifier groups + options, combos, combo templates |
| **Menus** | 10 | Menus, menu items (legacy + sales-item-based), prices, combo/modifier price overrides, scenarios, shared pages |
| **Locations & Stock** | 22 | Location groups, locations, stores, stock levels, movements, purchase orders, GRNs, invoices, credit notes, waste, transfers, stocktakes, kiosk orders |
| **HACCP** | 3 | Equipment, temperature logs, CCP logs |
| **QSC** | 5 | Questions, templates, audits, responses, response photos |
| **Backlog & Tracking** | 4 | Feedback, bugs, backlog items, comments |
| **Documentation** | 3 | Doc categories, docs, FAQ |
| **Media** | 2 | Media categories, media items |
| **Changelog** | 1 | Application changelog entries |

### Excluded (13 tables)

| Table | Reason |
|-------|--------|
| `mcogs_users` | User accounts are instance-specific |
| `mcogs_user_brand_partners` | User ↔ brand partner assignments |
| `mcogs_user_notes` | Per-user notes |
| `mcogs_user_profiles` | User display preferences |
| `mcogs_user_scope` | User data access scoping |
| `mcogs_user_scope_templates` | Scope templates |
| `mcogs_roles` | System-seeded by the migration script |
| `mcogs_role_permissions` | System-seeded by the migration script |
| `mcogs_ai_chat_log` | AI conversation history — transient |
| `mcogs_audit_log` | Audit trail — instance-specific |
| `mcogs_import_jobs` | Data import job history — transient |
| `mcogs_memory_daily` | AI daily memory — transient |
| `mcogs_memory_monthly` | AI monthly memory — transient |

---

## 4. Export File Format

```json
{
  "exported_at": "2026-06-06T12:00:00.000Z",
  "source": "localhost:5432/mcogs",
  "version": "1.0.0",
  "table_count": 87,
  "tables": {
    "mcogs_units": [
      { "id": 1, "name": "Kilogram", "abbreviation": "kg", ... },
      { "id": 2, "name": "Gram", "abbreviation": "g", ... }
    ],
    "mcogs_vendors": [ ... ],
    ...
  },
  "row_counts": {
    "mcogs_units": 15,
    "mcogs_vendors": 42,
    ...
  }
}
```

### Data Type Serialisation

| PostgreSQL Type | JSON Representation | Example |
|-----------------|---------------------|---------|
| `INTEGER` / `SERIAL` | Number | `42` |
| `NUMERIC(n,m)` | String | `"12.5000"` |
| `VARCHAR` / `TEXT` | String | `"Tomato"` |
| `BOOLEAN` | Boolean | `true` |
| `TIMESTAMPTZ` | ISO 8601 string | `"2026-06-06T12:00:00.000Z"` |
| `JSONB` | Object or Array | `{"key": "value"}` |
| `TEXT[]` | Array of strings | `["gluten", "dairy"]` |
| `INTEGER[]` | Array of numbers | `[1, 3, 7]` |
| `NULL` | null | `null` |

---

## 5. API Reference

### GET /api/data-transfer/tables

Returns all exportable tables with live row counts from the database.

**Authentication:** Required (Bearer JWT)
**Permission:** `settings:write`

**Response:**
```json
{
  "tables": [
    {
      "name": "mcogs_units",
      "group": "Master Data",
      "rows": 15,
      "exists": true
    },
    {
      "name": "mcogs_vendors",
      "group": "Inventory",
      "rows": 42,
      "exists": true
    }
  ],
  "total_tables": 87,
  "total_rows": 12345
}
```

### POST /api/data-transfer/export

Triggers a database export and returns the JSON file as a download.

**Authentication:** Required (Bearer JWT)
**Permission:** `settings:write`

**Request body (JSON, optional):**
```json
{
  "tables": ["mcogs_units", "mcogs_vendors"],
  "compact": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tables` | `string[]` | all 87 | Subset of table names to export. Omit to export all. |
| `compact` | `boolean` | `false` | If `true`, produces minified JSON (no whitespace). |

**Response:** File download
- `Content-Type: application/json`
- `Content-Disposition: attachment; filename="mcogs-export-2026-06-06.json"`

### POST /api/data-transfer/import

Accepts a multipart file upload of an export JSON file and imports it into the database.

**Authentication:** Required (Bearer JWT)
**Permission:** `settings:write`

**Request:** `multipart/form-data`
- Field `file`: The JSON export file (max 50 MB)

**Query parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `dry_run` | `boolean` | `false` | If `true`, validates the file and reports what would be imported without writing data. |
| `tables` | `string` | all | Comma-separated list of table names to import. Others are skipped. |
| `skip` | `string` | none | Comma-separated list of table names to skip. |

**Response:**
```json
{
  "success": true,
  "dry_run": false,
  "tables_imported": 87,
  "total_rows": 12345,
  "details": [
    {
      "table": "mcogs_units",
      "rows_imported": 15,
      "rows_in_file": 15,
      "status": "ok"
    },
    {
      "table": "mcogs_qsc_questions",
      "rows_imported": 0,
      "rows_in_file": 0,
      "status": "table_not_found"
    }
  ]
}
```

**Status values:** `ok`, `skipped`, `table_not_found`, `error`

### GET /api/data-transfer/history

Placeholder endpoint for future import/export history tracking.

**Response:**
```json
{ "history": [] }
```

---

## 6. Import Process (Technical Detail)

The import executes within a single PostgreSQL transaction. If any step fails, the entire import is rolled back and no data is changed.

### Steps

1. **Parse** — uploaded JSON file is parsed from the multipart buffer
2. **Validate** — checks for required fields (`exported_at`, `tables` object)
3. **Disable constraints** — `SET session_replication_role = replica` (disables FK triggers)
4. **For each table** (in dependency order — parents before children):
   a. `TRUNCATE TABLE table_name RESTART IDENTITY CASCADE`
   b. Insert rows one-by-one: `INSERT INTO table_name (col1, col2, ...) VALUES ($1, $2, ...)`
   c. Reset serial sequence: `SELECT setval(pg_get_serial_sequence('table_name', 'id'), MAX(id) + 1, false)`
   d. Junction tables (composite PKs) skip the sequence reset
5. **Re-enable constraints** — `SET session_replication_role = DEFAULT`
6. **Commit** transaction

### Junction Tables (no serial ID — skip sequence reset)

- `mcogs_ingredient_allergens`
- `mcogs_ingredient_preferred_vendor`
- `mcogs_country_level_tax`
- `mcogs_country_price_levels`
- `mcogs_market_regions`
- `mcogs_sales_item_markets`
- `mcogs_sales_item_modifier_groups`
- `mcogs_combo_step_option_modifier_groups`
- `mcogs_menu_combo_option_prices`
- `mcogs_menu_modifier_option_prices`

### Dry Run Behaviour

When `dry_run=true`:
- No `BEGIN`/`COMMIT` is issued
- No `TRUNCATE` or `INSERT` is executed
- Table existence is not checked (assumed all exist)
- Row counts from the file are reported as `rows_imported`
- Returns the same response shape so the UI can preview results

---

## 7. Frontend UI

The Data Transfer page is embedded within the Configuration hub at **Configuration → 🔄 Data Transfer**. It requires `settings:write` permission (admin only).

### Layout

The page has three sections arranged in a two-column grid:

#### Export Card (left column)

- **Group selector** — 12 checkboxes, one per data group. Each shows table count and row count. "All" / "None" quick toggles at the top.
- **Compact toggle** — checkbox for minified JSON output.
- **Summary bar** — shows selected table count and row total.
- **Download Export button** — triggers `POST /api/data-transfer/export`, receives the file as a blob, creates a temporary `<a download>` link, and clicks it to trigger the browser download. Shows a spinner while exporting.

#### Import Card (right column)

- **File picker** — drag-and-drop zone or click-to-browse. Accepts `.json` files only. Shows filename and size once selected. "Remove" link to clear.
- **Dry run toggle** — checkbox. When checked, the import button changes to "Validate File" with outline styling instead of danger red.
- **Import button** — `POST /api/data-transfer/import` with the file as multipart `FormData`. Red "Import & Replace Data" button (danger style) for real imports, outline style for dry runs.
- **Results panel** — appears after import/dry-run completes. Shows:
  - Success/failure indicator
  - Total tables and rows imported
  - Scrollable table: per-table row count and status badge (green `ok` / yellow `skipped` / red `error`)
  - After a successful dry run: "Looks good — Import for real" button to immediately re-run without dry_run

#### Table Inventory (full width, below cards)

- Shows all 87 exportable tables in a table: table name (monospace), group, row count, existence status (green checkmark or yellow dash).
- Provides a quick overview of what's in the database before exporting.

---

## 8. CLI Usage

Both scripts work standalone from the command line and are also imported as modules by the API route.

### Export

```bash
cd api

# Export all tables to timestamped file
npm run export
# → mcogs-export-2026-06-06.json

# Export to specific filename
npm run export -- my-backup.json

# Compact JSON (smaller file, no whitespace)
npm run export -- --compact

# Compact + custom filename
npm run export -- --compact production-backup.json
```

**Output example:**
```
📤 Menu COGS — Data Export
   Output: mcogs-export-2026-06-06.json

  ✔ mcogs_units                                       15 rows
  ✔ mcogs_price_levels                                 4 rows
  ✔ mcogs_brand_partners                               2 rows
  ...
  ✔ mcogs_changelog                                   28 rows

✅ Export complete
   Tables: 87
   Rows:   12345
   File:   mcogs-export-2026-06-06.json (8.42 MB)
```

### Import

```bash
cd api

# Full import — replaces all data
npm run import:full -- mcogs-export-2026-06-06.json

# Dry run — validate without writing
npm run import:full -- mcogs-export.json --dry-run

# Import only specific tables
npm run import:full -- mcogs-export.json --tables=mcogs_units,mcogs_vendors,mcogs_ingredients

# Skip specific tables (import everything else)
npm run import:full -- mcogs-export.json --skip=mcogs_stock_movements,mcogs_equipment_temp_logs
```

**Output example:**
```
📥 Menu COGS — Data Import
   Source: mcogs-export-2026-06-06.json
   Exported at: 2026-06-06T12:00:00.000Z

  ✔ mcogs_units                                  15/15 rows
  ✔ mcogs_price_levels                            4/4 rows
  ...
  ✔ mcogs_changelog                             28/28 rows

✅ Import complete
```

---

## 9. Table Dependency Order

Tables are always processed in this order to satisfy foreign key constraints. The import disables FK checks as a safety net, but the ordering ensures correctness even without that.

```
 1. mcogs_units
 2. mcogs_price_levels
 3. mcogs_brand_partners
 4. mcogs_countries                    → brand_partners
 5. mcogs_country_tax_rates            → countries
 6. mcogs_country_level_tax            → countries, price_levels, tax_rates
 7. mcogs_country_price_levels         → countries, price_levels
 8. mcogs_regions
 9. mcogs_market_regions               → countries, regions
10. mcogs_categories                   → self (parent_id), category_groups
11. mcogs_category_groups
12. mcogs_allergens
13. mcogs_languages
14. mcogs_settings
15. mcogs_vendors                      → countries
16. mcogs_ingredients                  → categories, units
17. mcogs_ingredient_allergens         → ingredients, allergens
18. mcogs_price_quotes                 → ingredients, vendors
19. mcogs_ingredient_preferred_vendor  → ingredients, countries, vendors, price_quotes
20. mcogs_recipes                      → categories, units
21. mcogs_recipe_items                 → recipes, ingredients, units
22. mcogs_recipe_variations            → recipes, countries
23. mcogs_recipe_pl_variations         → recipes, price_levels
24. mcogs_recipe_market_pl_variations  → recipes, countries, price_levels
25. mcogs_sales_items                  → recipes, categories
26. mcogs_sales_item_markets           → sales_items, countries
27. mcogs_sales_item_prices            → sales_items, countries, price_levels, tax_rates
28. mcogs_modifier_groups
29. mcogs_modifier_options             → modifier_groups, recipes, ingredients
30. mcogs_sales_item_modifier_groups   → sales_items, modifier_groups
31. mcogs_combos                       → categories
32. mcogs_combo_steps                  → combos, sales_items
33. mcogs_combo_step_options           → combo_steps, recipes, ingredients, sales_items
34. mcogs_combo_step_option_modifier_groups → combo_step_options, modifier_groups
35. mcogs_combo_templates
36. mcogs_combo_template_steps         → combo_templates
37. mcogs_combo_template_step_options  → combo_template_steps
38. mcogs_menus                        → countries
39. mcogs_menu_items                   → menus, recipes
40. mcogs_menu_item_prices             → menu_items, price_levels
41. mcogs_menu_sales_items             → menus, sales_items
42. mcogs_menu_sales_item_prices       → menu_sales_items, price_levels, tax_rates
43. mcogs_menu_combo_option_prices     → menu_sales_items, combo_step_options, price_levels
44. mcogs_menu_modifier_option_prices  → menu_sales_items, modifier_options, price_levels
45. mcogs_menu_scenarios               → menus
46. mcogs_shared_pages                 → menus
47. mcogs_shared_page_changes          → shared_pages
48. mcogs_location_groups
49. mcogs_locations                    → countries, location_groups
50. mcogs_stores                       → locations
51. mcogs_stock_levels                 → stores, ingredients
52. mcogs_stock_movements              → stores, ingredients
53. mcogs_purchase_orders              → locations, vendors
54. mcogs_purchase_order_items         → purchase_orders, ingredients
55. mcogs_order_templates              → locations, vendors
56. mcogs_order_template_items         → order_templates, ingredients
57. mcogs_goods_received               → locations, vendors, purchase_orders
58. mcogs_goods_received_items         → goods_received, ingredients
59. mcogs_invoices                     → locations, vendors, goods_received
60. mcogs_invoice_items                → invoices, ingredients
61. mcogs_credit_notes                 → locations, vendors
62. mcogs_credit_note_items            → credit_notes, ingredients
63. mcogs_waste_reason_codes
64. mcogs_waste_log                    → locations, stores, ingredients, waste_reason_codes
65. mcogs_stock_transfers              → stores
66. mcogs_stock_transfer_items         → stock_transfers, ingredients
67. mcogs_stocktakes                   → stores
68. mcogs_stocktake_items              → stocktakes, ingredients
69. mcogs_kiosk_orders                 → locations, menus
70. mcogs_equipment                    → locations
71. mcogs_equipment_temp_logs          → equipment
72. mcogs_ccp_logs                     → recipes, locations
73. mcogs_qsc_questions
74. mcogs_qsc_templates
75. mcogs_qsc_audits                   → qsc_templates, locations
76. mcogs_qsc_responses                → qsc_audits, qsc_questions
77. mcogs_qsc_response_photos          → qsc_responses
78. mcogs_feedback
79. mcogs_bugs
80. mcogs_backlog
81. mcogs_item_comments
82. mcogs_doc_categories
83. mcogs_docs                         → doc_categories
84. mcogs_faq
85. mcogs_media_categories
86. mcogs_media_items                  → media_categories
87. mcogs_changelog
```

---

## 10. Dependency Graph

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

---

## 11. Safety & Limitations

### Warnings

- **Import replaces data.** `TRUNCATE ... CASCADE` is called on each table before inserting. All existing rows are deleted. There is no merge/upsert mode.
- **No media files.** The export contains database records only. Image URLs reference S3 or local `/uploads/` paths. The files themselves are not included in the export.
- **No user data.** User accounts, roles, and permissions are not exported. After importing into a new instance, users must be set up separately.
- **File size.** Large databases may produce exports exceeding 50 MB. The CLI scripts have no size limit; the API upload is capped at 50 MB.

### Safety Features

- **Transaction-wrapped imports** — if any table fails, the entire import rolls back. No partial state.
- **Dry run mode** — validate an import file before committing. Shows exact table-by-table results.
- **Admin-only access** — requires `settings:write` permission. Not available to operators or viewers.
- **Dependency ordering** — tables are always processed parents-before-children. FK constraints are also temporarily disabled as a safety net.
- **Graceful table skipping** — tables that don't exist in the target database (e.g. from an older migration) are skipped with a warning, not an error.

---

## 12. Typical Workflows

### Backup before a major change

1. Open **Configuration → 🔄 Data Transfer**
2. Leave all groups selected
3. Click **Download Export**
4. Save the file. If things go wrong, import it back.

### Clone an instance

1. On the source instance: **Download Export** (all groups)
2. On the target instance: run `npm run migrate` to create tables
3. Open **Configuration → 🔄 Data Transfer**
4. Drop the export file into the Import card
5. Check **Dry run** and click **Validate File**
6. Review the results table
7. Click **Looks good — Import for real**

### Migrate specific data

1. On the export card, uncheck all groups except the ones you need (e.g. only "Master Data" + "Inventory")
2. **Download Export**
3. On the target instance, upload and import — only the selected tables will be in the file, so only those are affected.

### CLI backup (cron job)

```bash
cd /var/www/menu-cogs/api
node scripts/export-data.js --compact /backups/mcogs-$(date +%Y-%m-%d).json
```
