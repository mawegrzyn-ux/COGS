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
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
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

  // ── 17. Allergens (Phase 4 — EU/UK FIC 1169/2011 reference table) ──────────
  `CREATE TABLE IF NOT EXISTS mcogs_allergens (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    code         VARCHAR(30)  NOT NULL UNIQUE,
    description  VARCHAR(300),
    sort_order   INTEGER NOT NULL DEFAULT 0
  )`,

  // ── 18. Ingredient Allergens (junction) ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_ingredient_allergens (
    id            SERIAL PRIMARY KEY,
    ingredient_id INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
    allergen_id   INTEGER NOT NULL REFERENCES mcogs_allergens(id)   ON DELETE CASCADE,
    status        VARCHAR(20) NOT NULL DEFAULT 'contains'
                  CHECK (status IN ('contains', 'may_contain', 'free_from')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (ingredient_id, allergen_id)
  )`,

  // ── 19. HACCP Equipment register ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_equipment (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    type            VARCHAR(50)  NOT NULL
                    CHECK (type IN ('fridge', 'freezer', 'hot_hold', 'display', 'other')),
    location_desc   VARCHAR(200),
    target_min_temp NUMERIC(5,1),
    target_max_temp NUMERIC(5,1),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 20. Equipment Temperature Logs ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_equipment_temp_logs (
    id                SERIAL PRIMARY KEY,
    equipment_id      INTEGER NOT NULL REFERENCES mcogs_equipment(id) ON DELETE CASCADE,
    logged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    temp_c            NUMERIC(5,1) NOT NULL,
    in_range          BOOLEAN NOT NULL,
    corrective_action TEXT,
    logged_by         VARCHAR(200),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 21. CCP Logs (cooking / cooling / delivery) ────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_ccp_logs (
    id                SERIAL PRIMARY KEY,
    log_type          VARCHAR(20) NOT NULL
                      CHECK (log_type IN ('cooking', 'cooling', 'delivery')),
    recipe_id         INTEGER REFERENCES mcogs_recipes(id) ON DELETE SET NULL,
    item_name         VARCHAR(200) NOT NULL,
    target_min_temp   NUMERIC(5,1) NOT NULL,
    target_max_temp   NUMERIC(5,1) NOT NULL,
    actual_temp       NUMERIC(5,1) NOT NULL,
    passed            BOOLEAN NOT NULL,
    corrective_action TEXT,
    logged_by         VARCHAR(200),
    logged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── Phase 4 column additions to existing tables ────────────────────────────

  // Ingredients — nutrition (per 100g), dietary flags, barcode, temp-sensitive
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS barcode               VARCHAR(100)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS temp_sensitive         BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS storage_type           VARCHAR(50)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS dietary_flags          JSONB NOT NULL DEFAULT '{}'`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS energy_kcal            NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS protein_g              NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS carbs_g                NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS fat_g                  NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS fibre_g                NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS sugar_g                NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS salt_g                 NUMERIC(8,2)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS nutrition_source       VARCHAR(50)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS nutrition_source_id    VARCHAR(100)`,
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS nutrition_updated_at   TIMESTAMPTZ`,

  // Recipes — dietary flags (propagated from ingredients)
  `ALTER TABLE mcogs_recipes ADD COLUMN IF NOT EXISTS dietary_flags JSONB NOT NULL DEFAULT '{}'`,

  // ── Phase 4 indexes ────────────────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_ingredient_allergens_ingredient ON mcogs_ingredient_allergens(ingredient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ingredient_allergens_allergen   ON mcogs_ingredient_allergens(allergen_id)`,
  `CREATE INDEX IF NOT EXISTS idx_equipment_temp_logs_equipment   ON mcogs_equipment_temp_logs(equipment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_equipment_temp_logs_logged_at   ON mcogs_equipment_temp_logs(logged_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ccp_logs_logged_at              ON mcogs_ccp_logs(logged_at)`,
  `CREATE INDEX IF NOT EXISTS idx_ccp_logs_recipe                 ON mcogs_ccp_logs(recipe_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ingredients_barcode             ON mcogs_ingredients(barcode)`,

  // ── 22. Location Groups ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_location_groups (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 23. Brand Partners (franchisees that operate markets) ──────────────────
  // Distinct from mcogs_vendors (ingredient/price-quote suppliers)
  `CREATE TABLE IF NOT EXISTS mcogs_brand_partners (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(200) NOT NULL,
    contact     VARCHAR(200),
    email       VARCHAR(200),
    phone       VARCHAR(50),
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── Column migrations (safe to run on existing installs) ──────────────────
  // Adds columns introduced after initial schema — ALTER TABLE IF NOT EXISTS is idempotent
  `ALTER TABLE mcogs_price_levels ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS qty         NUMERIC(10,4) NOT NULL DEFAULT 1`,
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS sell_price  NUMERIC(10,4) NOT NULL DEFAULT 0`,
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS tax_rate_id INTEGER REFERENCES mcogs_country_tax_rates(id) ON DELETE SET NULL`,
  `ALTER TABLE mcogs_menu_items ALTER COLUMN display_name SET NOT NULL`,
  `ALTER TABLE mcogs_menu_items ALTER COLUMN display_name SET DEFAULT ''`,
  `ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS country_iso CHAR(2)`,
  `ALTER TABLE mcogs_vendors  ALTER COLUMN country_id DROP NOT NULL`,
  // brand_partner_id: add column without FK first so the DO block below can safely migrate the reference
  `ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS brand_partner_id INTEGER`,

  // Migrate brand_partner_id FK from mcogs_vendors → mcogs_brand_partners (idempotent)
  `DO $$
  BEGIN
    -- Drop old FK to mcogs_vendors if it exists
    IF EXISTS (
      SELECT 1 FROM information_schema.table_constraints
      WHERE constraint_name = 'mcogs_countries_brand_partner_id_fkey'
        AND table_name = 'mcogs_countries'
    ) THEN
      ALTER TABLE mcogs_countries DROP CONSTRAINT mcogs_countries_brand_partner_id_fkey;
      -- Clear stale vendor IDs — they no longer map to brand partners
      UPDATE mcogs_countries SET brand_partner_id = NULL WHERE brand_partner_id IS NOT NULL;
    END IF;

    -- Add new FK to mcogs_brand_partners if not already present
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_class ref ON ref.oid = con.confrelid
      WHERE con.contype = 'f'
        AND rel.relname = 'mcogs_countries'
        AND ref.relname = 'mcogs_brand_partners'
        AND con.conname = 'mcogs_countries_brand_partner_id_fkey'
    ) THEN
      ALTER TABLE mcogs_countries
        ADD CONSTRAINT mcogs_countries_brand_partner_id_fkey
        FOREIGN KEY (brand_partner_id) REFERENCES mcogs_brand_partners(id) ON DELETE SET NULL;
    END IF;
  END
  $$`,

  // Locations — full property set (Phase 2 upgrade from skeleton schema)
  // NOTE: group_id must be added BEFORE indexes that reference it
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS group_id       INTEGER REFERENCES mcogs_location_groups(id) ON DELETE SET NULL`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS address        TEXT`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS email          VARCHAR(200)`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS phone          VARCHAR(50)`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS contact_name   VARCHAR(200)`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS contact_email  VARCHAR(200)`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS contact_phone  VARCHAR(50)`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS is_active      BOOLEAN NOT NULL DEFAULT TRUE`,

  // Equipment — link to location
  `ALTER TABLE mcogs_equipment ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES mcogs_locations(id) ON DELETE SET NULL`,

  // CCP Logs — link to location
  `ALTER TABLE mcogs_ccp_logs ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES mcogs_locations(id) ON DELETE SET NULL`,

  // ── Location + HACCP indexes (must come AFTER the column ALTER TABLEs above)
  `CREATE INDEX IF NOT EXISTS idx_locations_market    ON mcogs_locations(country_id)`,
  `CREATE INDEX IF NOT EXISTS idx_locations_group     ON mcogs_locations(group_id)    WHERE group_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_equipment_location  ON mcogs_equipment(location_id) WHERE location_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ccp_logs_location   ON mcogs_ccp_logs(location_id)  WHERE location_id IS NOT NULL`,

  // ── Seed: 14 EU/UK regulated allergens (FIC Regulation 1169/2011) ─────────
  `INSERT INTO mcogs_allergens (code, name, description, sort_order) VALUES
    ('GLUTEN',      'Gluten',              'Cereals containing gluten: wheat, rye, barley, oats and their hybridised strains', 1),
    ('CRUSTACEANS', 'Crustaceans',         'Crustaceans and crustacean products (e.g. shrimp, crab, lobster)', 2),
    ('EGGS',        'Eggs',                'Eggs and egg products', 3),
    ('FISH',        'Fish',                'Fish and fish products', 4),
    ('PEANUTS',     'Peanuts',             'Peanuts and peanut products', 5),
    ('SOYBEANS',    'Soybeans',            'Soybeans and soy products', 6),
    ('MILK',        'Milk',                'Milk and dairy products (including lactose)', 7),
    ('NUTS',        'Nuts',                'Tree nuts: almonds, hazelnuts, walnuts, cashews, pecans, Brazil nuts, pistachios, macadamia', 8),
    ('CELERY',      'Celery',              'Celery and celeriac', 9),
    ('MUSTARD',     'Mustard',             'Mustard and mustard products', 10),
    ('SESAME',      'Sesame seeds',        'Sesame seeds and sesame products', 11),
    ('SULPHITES',   'Sulphur dioxide',     'Sulphur dioxide and sulphites at concentrations of more than 10mg/kg or 10mg/litre', 12),
    ('LUPIN',       'Lupin',               'Lupin and lupin products', 13),
    ('MOLLUSCS',    'Molluscs',            'Molluscs and mollusc products (e.g. clams, mussels, oysters, squid)', 14)
  ON CONFLICT (code) DO NOTHING`,
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
