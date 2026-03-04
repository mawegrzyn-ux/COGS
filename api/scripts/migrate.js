#!/usr/bin/env node
// =============================================================================
// Menu COGS — Database Migration
// Creates all 16 tables in PostgreSQL
// Usage: npm run migrate
// Safe to run multiple times (CREATE TABLE IF NOT EXISTS)
// =============================================================================

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const migrations = [

  // ── 1. Units ───────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_units (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    abbreviation VARCHAR(20) NOT NULL,
    type        VARCHAR(20) NOT NULL CHECK (type IN ('mass', 'volume', 'count')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 2. Price Levels ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_price_levels (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 3. Countries ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_countries (
    id                      SERIAL PRIMARY KEY,
    name                    VARCHAR(100) NOT NULL,
    currency_code           VARCHAR(10)  NOT NULL,
    currency_symbol         VARCHAR(10)  NOT NULL,
    exchange_rate           NUMERIC(18,8) NOT NULL DEFAULT 1,
    default_price_level_id  INTEGER REFERENCES mcogs_price_levels(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 4. Country Tax Rates ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_country_tax_rates (
    id          SERIAL PRIMARY KEY,
    country_id  INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE CASCADE,
    name        VARCHAR(100) NOT NULL,
    rate        NUMERIC(8,4) NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 5. Country Level Tax ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_country_level_tax (
    id              SERIAL PRIMARY KEY,
    country_id      INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE CASCADE,
    price_level_id  INTEGER NOT NULL REFERENCES mcogs_price_levels(id) ON DELETE CASCADE,
    tax_rate_id     INTEGER NOT NULL REFERENCES mcogs_country_tax_rates(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (country_id, price_level_id)
  )`,

  // ── 6. Categories ─────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    group_name  VARCHAR(100) NOT NULL DEFAULT 'Unassigned',
    type        VARCHAR(20)  NOT NULL CHECK (type IN ('ingredient', 'recipe')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 7. Vendors ────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_vendors (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    country_id  INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE RESTRICT,
    contact     VARCHAR(200),
    email       VARCHAR(200),
    phone       VARCHAR(50),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 8. Ingredients ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_ingredients (
    id                          SERIAL PRIMARY KEY,
    name                        VARCHAR(200) NOT NULL,
    category                    VARCHAR(100),
    base_unit_id                INTEGER REFERENCES mcogs_units(id) ON DELETE SET NULL,
    default_prep_unit           VARCHAR(50),
    default_prep_to_base_conversion NUMERIC(18,8) NOT NULL DEFAULT 1,
    notes                       TEXT,
    image_url                   VARCHAR(500),
    waste_pct                   NUMERIC(5,2) NOT NULL DEFAULT 0,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 9. Price Quotes ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_price_quotes (
    id                    SERIAL PRIMARY KEY,
    ingredient_id         INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
    vendor_id             INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE CASCADE,
    purchase_price        NUMERIC(18,4) NOT NULL,
    qty_in_base_units     NUMERIC(18,8) NOT NULL,
    purchase_unit         VARCHAR(50),
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    vendor_product_code   VARCHAR(100),
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 10. Ingredient Preferred Vendor ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_ingredient_preferred_vendor (
    id            SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
    country_id    INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE CASCADE,
    vendor_id     INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE CASCADE,
    quote_id      INTEGER NOT NULL REFERENCES mcogs_price_quotes(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ingredient_id, country_id)
  )`,

  // ── 11. Recipes ───────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_recipes (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(200) NOT NULL,
    category      VARCHAR(100),
    description   TEXT,
    yield_qty     NUMERIC(18,4) NOT NULL DEFAULT 1,
    yield_unit_id INTEGER REFERENCES mcogs_units(id) ON DELETE SET NULL,
    image_url     VARCHAR(500),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 12. Recipe Items ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_recipe_items (
    id                      SERIAL PRIMARY KEY,
    recipe_id               INTEGER NOT NULL REFERENCES mcogs_recipes(id) ON DELETE CASCADE,
    item_type               VARCHAR(20) NOT NULL CHECK (item_type IN ('ingredient', 'recipe')),
    ingredient_id           INTEGER REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
    recipe_item_id          INTEGER REFERENCES mcogs_recipes(id) ON DELETE CASCADE,
    prep_qty                NUMERIC(18,8) NOT NULL,
    prep_unit               VARCHAR(50),
    prep_to_base_conversion NUMERIC(18,8) NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (
      (item_type = 'ingredient' AND ingredient_id IS NOT NULL AND recipe_item_id IS NULL) OR
      (item_type = 'recipe'     AND recipe_item_id IS NOT NULL AND ingredient_id IS NULL)
    )
  )`,

  // ── 13. Menus ─────────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menus (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    country_id  INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE RESTRICT,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 14. Menu Items ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_items (
    id            SERIAL PRIMARY KEY,
    menu_id       INTEGER NOT NULL REFERENCES mcogs_menus(id) ON DELETE CASCADE,
    item_type     VARCHAR(20) NOT NULL CHECK (item_type IN ('recipe', 'ingredient')),
    recipe_id     INTEGER REFERENCES mcogs_recipes(id) ON DELETE CASCADE,
    ingredient_id INTEGER REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
    display_name  VARCHAR(200) NOT NULL DEFAULT '',
    qty           NUMERIC(10,4) NOT NULL DEFAULT 1,
    sell_price    NUMERIC(10,4) NOT NULL DEFAULT 0,
    tax_rate_id   INTEGER REFERENCES mcogs_country_tax_rates(id) ON DELETE SET NULL,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 15. Menu Item Prices ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_item_prices (
    id              SERIAL PRIMARY KEY,
    menu_item_id    INTEGER NOT NULL REFERENCES mcogs_menu_items(id) ON DELETE CASCADE,
    price_level_id  INTEGER NOT NULL REFERENCES mcogs_price_levels(id) ON DELETE CASCADE,
    sell_price      NUMERIC(18,4) NOT NULL,
    tax_rate_id     INTEGER REFERENCES mcogs_country_tax_rates(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (menu_item_id, price_level_id)
  )`,

  // ── 16. Locations (Phase 2 foundation — schema only, no UI yet) ───────────
  `CREATE TABLE IF NOT EXISTS mcogs_locations (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    type        VARCHAR(50),
    parent_id   INTEGER REFERENCES mcogs_locations(id) ON DELETE SET NULL,
    country_id  INTEGER REFERENCES mcogs_countries(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── Indexes ───────────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_price_quotes_ingredient  ON mcogs_price_quotes(ingredient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_price_quotes_vendor      ON mcogs_price_quotes(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe      ON mcogs_recipe_items(recipe_id)`,
  `CREATE INDEX IF NOT EXISTS idx_menu_items_menu          ON mcogs_menu_items(menu_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vendors_country          ON mcogs_vendors(country_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ingredients_category     ON mcogs_ingredients(category)`,
  `CREATE INDEX IF NOT EXISTS idx_recipes_category         ON mcogs_recipes(category)`,
  `CREATE INDEX IF NOT EXISTS idx_country_tax_country      ON mcogs_country_tax_rates(country_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pref_vendor_ingredient   ON mcogs_ingredient_preferred_vendor(ingredient_id)`,

  // ── Column migrations (safe to run on existing installs) ──────────────────
  // Adds columns introduced after initial schema — ALTER TABLE IF NOT EXISTS is idempotent
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS qty         NUMERIC(10,4) NOT NULL DEFAULT 1`,
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS sell_price  NUMERIC(10,4) NOT NULL DEFAULT 0`,
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS tax_rate_id INTEGER REFERENCES mcogs_country_tax_rates(id) ON DELETE SET NULL`,
  `ALTER TABLE mcogs_menu_items ALTER COLUMN display_name SET NOT NULL`,
  `ALTER TABLE mcogs_menu_items ALTER COLUMN display_name SET DEFAULT ''`,
];

async function migrate() {
  const client = await pool.connect();
  console.log('\n🗄  Menu COGS — Database Migration\n');

  try {
    await client.query('BEGIN');

    for (const sql of migrations) {
      // Extract a short label for logging
      const label = sql.trim().split('\n')[0].replace(/CREATE (TABLE|INDEX) IF NOT EXISTS /, '').split(' ')[0];
      process.stdout.write(`  → ${label.padEnd(45)}`);
      await client.query(sql);
      console.log('✔');
    }

    await client.query('COMMIT');
    console.log('\n✅ Migration complete — all tables ready\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
