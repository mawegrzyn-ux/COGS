#!/usr/bin/env node
// =============================================================================
// Menu COGS — Database Migration
// Creates all 16 tables in PostgreSQL
// Usage: npm run migrate
// Safe to run multiple times (CREATE TABLE IF NOT EXISTS)
// =============================================================================

// When this script is run directly (e.g. `npm run migrate`) it opens its own
// Pool against whatever config it can resolve. When required as a module (e.g.
// from the /api/db-config/migrate admin endpoint) it only exports `migrations`
// so the caller can run them against the live pool.

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

  // ── 11b. Recipe Variations ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_recipe_variations (
    id         SERIAL PRIMARY KEY,
    recipe_id  INTEGER NOT NULL REFERENCES mcogs_recipes(id) ON DELETE CASCADE,
    country_id INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE CASCADE,
    notes      TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(recipe_id, country_id)
  )`,

  // ── 11c. Add variation_id column to mcogs_recipe_items ────────────────────
  `ALTER TABLE mcogs_recipe_items
     ADD COLUMN IF NOT EXISTS variation_id INTEGER REFERENCES mcogs_recipe_variations(id) ON DELETE CASCADE`,

  // ── Index for variation lookup ─────────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_recipe_items_variation ON mcogs_recipe_items(variation_id)`,

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
  `CREATE INDEX IF NOT EXISTS idx_price_quotes_ingredient     ON mcogs_price_quotes(ingredient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_price_quotes_ingredient_act ON mcogs_price_quotes(ingredient_id, is_active)`,
  `CREATE INDEX IF NOT EXISTS idx_price_quotes_vendor         ON mcogs_price_quotes(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recipe_items_recipe      ON mcogs_recipe_items(recipe_id)`,
  `CREATE INDEX IF NOT EXISTS idx_menu_items_menu          ON mcogs_menu_items(menu_id)`,
  `CREATE INDEX IF NOT EXISTS idx_vendors_country          ON mcogs_vendors(country_id)`,
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcogs_ingredients' AND column_name='category') THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_ingredients_category ON mcogs_ingredients(category)';
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mcogs_recipes' AND column_name='category') THEN
      EXECUTE 'CREATE INDEX IF NOT EXISTS idx_recipes_category ON mcogs_recipes(category)';
    END IF;
  END $$`,
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

  // ── 24. Feedback ──────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_feedback (
    id          SERIAL PRIMARY KEY,
    type        VARCHAR(50)  NOT NULL DEFAULT 'general'
                CHECK (type IN ('bug', 'feature', 'general')),
    status      VARCHAR(50)  NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'in_progress', 'resolved')),
    title       VARCHAR(500) NOT NULL,
    description TEXT,
    page        VARCHAR(200),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_status ON mcogs_feedback(status)`,
  `CREATE INDEX IF NOT EXISTS idx_feedback_type   ON mcogs_feedback(type)`,
  `ALTER TABLE mcogs_feedback ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'`,

  // ── 25. AI Chat Log ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_ai_chat_log (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_email   TEXT,
    user_message TEXT,
    response     TEXT,
    tools_called JSONB,
    context      JSONB,
    tokens_in    INTEGER,
    tokens_out   INTEGER,
    error        TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ai_chat_log_created_at ON mcogs_ai_chat_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ai_chat_log_user_email ON mcogs_ai_chat_log(user_email)`,

  // ── AI Chat Log — phase 2 columns (session tracking) ─────────────────────
  `ALTER TABLE mcogs_ai_chat_log ADD COLUMN IF NOT EXISTS user_sub   TEXT`,
  `ALTER TABLE mcogs_ai_chat_log ADD COLUMN IF NOT EXISTS session_id TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_ai_chat_log_user_sub   ON mcogs_ai_chat_log(user_sub)   WHERE user_sub   IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ai_chat_log_session_id ON mcogs_ai_chat_log(session_id) WHERE session_id IS NOT NULL`,

  // ── 26. Import Jobs ────────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_import_jobs (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_email  TEXT,
    source_file TEXT,
    status      TEXT        NOT NULL DEFAULT 'staging'
                CHECK (status IN ('staging','ready','importing','done','failed')),
    staged_data JSONB       NOT NULL DEFAULT '{}',
    results     JSONB
  )`,
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_created_at ON mcogs_import_jobs(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_import_jobs_user_email ON mcogs_import_jobs(user_email) WHERE user_email IS NOT NULL`,

  // ── 27. Menu Scenarios ────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_scenarios (
    id             SERIAL PRIMARY KEY,
    name           VARCHAR(200) NOT NULL,
    menu_id        INTEGER REFERENCES mcogs_menus(id) ON DELETE SET NULL,
    price_level_id INTEGER REFERENCES mcogs_price_levels(id) ON DELETE SET NULL,
    qty_data       JSONB NOT NULL DEFAULT '{}',
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_menu_scenarios_menu ON mcogs_menu_scenarios(menu_id)`,

  // ── 27b. Scenarios v2 — make menu_id nullable (market-agnostic) ───────────
  // qty_data is now keyed by recipe/ingredient natural keys (r_123, i_456)
  // allowing a single scenario to apply across any market
  `DO $$ BEGIN
    ALTER TABLE mcogs_menu_scenarios ALTER COLUMN menu_id DROP NOT NULL;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE mcogs_menu_scenarios DROP CONSTRAINT mcogs_menu_scenarios_menu_id_fkey;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE mcogs_menu_scenarios
      ADD CONSTRAINT mcogs_menu_scenarios_menu_id_fkey
      FOREIGN KEY (menu_id) REFERENCES mcogs_menus(id) ON DELETE SET NULL;
  EXCEPTION WHEN OTHERS THEN NULL; END $$`,

  // ── 28. Scenario overrides & history ─────────────────────────────────────
  `DO $$ BEGIN ALTER TABLE mcogs_menu_scenarios ADD COLUMN price_overrides JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_menu_scenarios ADD COLUMN cost_overrides  JSONB NOT NULL DEFAULT '{}'; EXCEPTION WHEN OTHERS THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_menu_scenarios ADD COLUMN history         JSONB NOT NULL DEFAULT '[]'; EXCEPTION WHEN OTHERS THEN NULL; END $$`,

  // ── Allergen Notes columns ────────────────────────────────────────────────
  `ALTER TABLE mcogs_ingredients ADD COLUMN IF NOT EXISTS allergen_notes TEXT`,
  `ALTER TABLE mcogs_menu_items  ADD COLUMN IF NOT EXISTS allergen_notes TEXT`,

  // ── Recipes — free-text yield unit (replaces yield_unit_id FK in UI) ──────
  `ALTER TABLE mcogs_recipes ADD COLUMN IF NOT EXISTS yield_unit_text VARCHAR(50)`,

  // ── Recipe Items — manual sort order ──────────────────────────────────────
  `ALTER TABLE mcogs_recipe_items ADD COLUMN IF NOT EXISTS sort_order INTEGER`,

  // ── 29. Shared Menu Engineer Pages ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_shared_pages (
    id            SERIAL PRIMARY KEY,
    slug          CHAR(16)     NOT NULL UNIQUE,
    name          VARCHAR(200) NOT NULL,
    mode          VARCHAR(10)  NOT NULL DEFAULT 'view' CHECK (mode IN ('view', 'edit')),
    password_hash TEXT         NOT NULL,
    password_salt TEXT         NOT NULL,
    menu_id       INTEGER REFERENCES mcogs_menus(id) ON DELETE SET NULL,
    country_id    INTEGER REFERENCES mcogs_countries(id) ON DELETE SET NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    expires_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_shared_pages_slug      ON mcogs_shared_pages(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_shared_pages_menu_id   ON mcogs_shared_pages(menu_id)  WHERE menu_id  IS NOT NULL`,
  `ALTER TABLE mcogs_shared_pages ADD COLUMN IF NOT EXISTS scenario_id INTEGER REFERENCES mcogs_menu_scenarios(id) ON DELETE SET NULL`,

  // ── 30. Shared page: notes + changes table ────────────────────────────────
  `ALTER TABLE mcogs_shared_pages ADD COLUMN IF NOT EXISTS notes TEXT`,
  `CREATE TABLE IF NOT EXISTS mcogs_shared_page_changes (
    id              SERIAL PRIMARY KEY,
    shared_page_id  INTEGER NOT NULL REFERENCES mcogs_shared_pages(id) ON DELETE CASCADE,
    user_name       VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
    change_type     VARCHAR(20) NOT NULL DEFAULT 'price' CHECK (change_type IN ('price', 'comment')),
    menu_item_id    INTEGER,
    price_level_id  INTEGER,
    display_name    VARCHAR(200),
    level_name      VARCHAR(100),
    old_value       NUMERIC(18,4),
    new_value       NUMERIC(18,4),
    comment         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sp_changes_page ON mcogs_shared_page_changes(shared_page_id, created_at DESC)`,
  `ALTER TABLE mcogs_shared_page_changes ADD COLUMN IF NOT EXISTS parent_id INTEGER REFERENCES mcogs_shared_page_changes(id) ON DELETE CASCADE`,

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

  // ── 31. Recipe Price-Level Variations ────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_recipe_pl_variations (
  id              SERIAL PRIMARY KEY,
  recipe_id       INTEGER NOT NULL REFERENCES mcogs_recipes(id) ON DELETE CASCADE,
  price_level_id  INTEGER NOT NULL REFERENCES mcogs_price_levels(id) ON DELETE CASCADE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(recipe_id, price_level_id)
)`,

  // ── 31b. Add pl_variation_id column to mcogs_recipe_items ─────────────────
  `ALTER TABLE mcogs_recipe_items ADD COLUMN IF NOT EXISTS pl_variation_id INTEGER REFERENCES mcogs_recipe_pl_variations(id) ON DELETE CASCADE`,

  // ── 32. Recipe Market+PL Variations (country + price-level specific) ──────
  `CREATE TABLE IF NOT EXISTS mcogs_recipe_market_pl_variations (
  id              SERIAL PRIMARY KEY,
  recipe_id       INTEGER NOT NULL REFERENCES mcogs_recipes(id)        ON DELETE CASCADE,
  country_id      INTEGER NOT NULL REFERENCES mcogs_countries(id)      ON DELETE CASCADE,
  price_level_id  INTEGER NOT NULL REFERENCES mcogs_price_levels(id)   ON DELETE CASCADE,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(recipe_id, country_id, price_level_id)
)`,

  // ── 32b. Add market_pl_variation_id column to mcogs_recipe_items ──────────
  `ALTER TABLE mcogs_recipe_items ADD COLUMN IF NOT EXISTS market_pl_variation_id INTEGER REFERENCES mcogs_recipe_market_pl_variations(id) ON DELETE CASCADE`,

  // ── 33. RBAC — Roles ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_roles (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 34. RBAC — Role Permissions ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_role_permissions (
    id        SERIAL PRIMARY KEY,
    role_id   INTEGER NOT NULL REFERENCES mcogs_roles(id) ON DELETE CASCADE,
    feature   VARCHAR(50) NOT NULL,
    access    VARCHAR(10) NOT NULL DEFAULT 'none' CHECK (access IN ('none','read','write')),
    UNIQUE(role_id, feature)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON mcogs_role_permissions(role_id)`,

  // ── 35. RBAC — Users ──────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_users (
    id            SERIAL PRIMARY KEY,
    auth0_sub     VARCHAR(200) NOT NULL UNIQUE,
    email         VARCHAR(200),
    name          VARCHAR(200),
    picture       TEXT,
    role_id       INTEGER REFERENCES mcogs_roles(id) ON DELETE SET NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','disabled')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
  )`,
  `CREATE INDEX IF NOT EXISTS idx_users_auth0_sub ON mcogs_users(auth0_sub)`,
  `CREATE INDEX IF NOT EXISTS idx_users_status    ON mcogs_users(status)`,

  // ── 35b. Users — dev flag ────────────────────────────────────────────────
  `ALTER TABLE mcogs_users ADD COLUMN IF NOT EXISTS is_dev BOOLEAN NOT NULL DEFAULT FALSE`,

  // ── 36. RBAC — User Brand Partner Scope ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_user_brand_partners (
    user_id          INTEGER NOT NULL REFERENCES mcogs_users(id) ON DELETE CASCADE,
    brand_partner_id INTEGER NOT NULL REFERENCES mcogs_brand_partners(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, brand_partner_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_bp_user ON mcogs_user_brand_partners(user_id)`,

  // ── 37. Base units — default recipe unit fields ───────────────────────────
  `ALTER TABLE mcogs_units ADD COLUMN IF NOT EXISTS default_recipe_unit            VARCHAR(50)`,
  `ALTER TABLE mcogs_units ADD COLUMN IF NOT EXISTS default_recipe_unit_conversion NUMERIC(18,8)`,

  // ── 38. Menu Items — image URL ────────────────────────────────────────────
  `ALTER TABLE mcogs_menu_items ADD COLUMN IF NOT EXISTS image_url VARCHAR(500)`,

  // ── 39. Sales Items catalog ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_sales_items (
    id            SERIAL PRIMARY KEY,
    item_type     TEXT NOT NULL CHECK (item_type IN ('recipe','ingredient','manual','combo')),
    name          TEXT NOT NULL,
    category      TEXT,
    description   TEXT,
    recipe_id     INTEGER REFERENCES mcogs_recipes(id)     ON DELETE SET NULL,
    ingredient_id INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
    manual_cost   NUMERIC(12,4),
    image_url     TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 40. Sales Item Markets (visibility per country) ──────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_sales_item_markets (
    id            SERIAL PRIMARY KEY,
    sales_item_id INTEGER NOT NULL REFERENCES mcogs_sales_items(id) ON DELETE CASCADE,
    country_id    INTEGER NOT NULL REFERENCES mcogs_countries(id)   ON DELETE CASCADE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (sales_item_id, country_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sim_country ON mcogs_sales_item_markets(country_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sim_item    ON mcogs_sales_item_markets(sales_item_id)`,

  // ── 41. Sales Item Default Prices (per price level) ──────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_sales_item_prices (
    id             SERIAL PRIMARY KEY,
    sales_item_id  INTEGER NOT NULL REFERENCES mcogs_sales_items(id)  ON DELETE CASCADE,
    price_level_id INTEGER NOT NULL REFERENCES mcogs_price_levels(id) ON DELETE CASCADE,
    sell_price     NUMERIC(12,4) NOT NULL DEFAULT 0,
    tax_rate_id    INTEGER REFERENCES mcogs_country_tax_rates(id) ON DELETE SET NULL,
    UNIQUE (sales_item_id, price_level_id)
  )`,

  // ── 42. Modifier Groups ───────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_modifier_groups (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    min_select  INTEGER NOT NULL DEFAULT 0,
    max_select  INTEGER NOT NULL DEFAULT 1,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 43. Modifier Options ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_modifier_options (
    id                SERIAL PRIMARY KEY,
    modifier_group_id INTEGER NOT NULL REFERENCES mcogs_modifier_groups(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    item_type         TEXT NOT NULL CHECK (item_type IN ('recipe','ingredient','manual')),
    recipe_id         INTEGER REFERENCES mcogs_recipes(id)     ON DELETE SET NULL,
    ingredient_id     INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
    manual_cost       NUMERIC(12,4),
    price_addon       NUMERIC(12,4) NOT NULL DEFAULT 0,
    sort_order        INTEGER NOT NULL DEFAULT 0
  )`,

  // ── 44. Sales Item Modifier Groups (junction) ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_sales_item_modifier_groups (
    id                SERIAL PRIMARY KEY,
    sales_item_id     INTEGER NOT NULL REFERENCES mcogs_sales_items(id)     ON DELETE CASCADE,
    modifier_group_id INTEGER NOT NULL REFERENCES mcogs_modifier_groups(id) ON DELETE CASCADE,
    sort_order        INTEGER NOT NULL DEFAULT 0,
    UNIQUE (sales_item_id, modifier_group_id)
  )`,

  // ── 45. Combo Steps ───────────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combo_steps (
    id            SERIAL PRIMARY KEY,
    sales_item_id INTEGER NOT NULL REFERENCES mcogs_sales_items(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    description   TEXT,
    sort_order    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cs_sales_item ON mcogs_combo_steps(sales_item_id)`,

  // ── 46. Combo Step Options ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combo_step_options (
    id            SERIAL PRIMARY KEY,
    combo_step_id INTEGER NOT NULL REFERENCES mcogs_combo_steps(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    item_type     TEXT NOT NULL CHECK (item_type IN ('recipe','ingredient','manual')),
    recipe_id     INTEGER REFERENCES mcogs_recipes(id)     ON DELETE SET NULL,
    ingredient_id INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
    manual_cost   NUMERIC(12,4),
    price_addon   NUMERIC(12,4) NOT NULL DEFAULT 0,
    sort_order    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cso_step ON mcogs_combo_step_options(combo_step_id)`,

  // ── 47. Combo Step Option Modifier Groups (junction) ─────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combo_step_option_modifier_groups (
    id                   SERIAL PRIMARY KEY,
    combo_step_option_id INTEGER NOT NULL REFERENCES mcogs_combo_step_options(id) ON DELETE CASCADE,
    modifier_group_id    INTEGER NOT NULL REFERENCES mcogs_modifier_groups(id)    ON DELETE CASCADE,
    sort_order           INTEGER NOT NULL DEFAULT 0,
    UNIQUE (combo_step_option_id, modifier_group_id)
  )`,

  // ── 48. Menu Sales Items (menus ↔ sales items link) ───────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_sales_items (
    id            SERIAL PRIMARY KEY,
    menu_id       INTEGER NOT NULL REFERENCES mcogs_menus(id)       ON DELETE CASCADE,
    sales_item_id INTEGER NOT NULL REFERENCES mcogs_sales_items(id) ON DELETE CASCADE,
    qty           NUMERIC(12,4) NOT NULL DEFAULT 1,
    sort_order    INTEGER NOT NULL DEFAULT 0,
    allergen_notes TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (menu_id, sales_item_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msi_menu ON mcogs_menu_sales_items(menu_id)`,

  // ── 49. Menu Sales Item Prices (per-menu price overrides) ─────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_sales_item_prices (
    id                 SERIAL PRIMARY KEY,
    menu_sales_item_id INTEGER NOT NULL REFERENCES mcogs_menu_sales_items(id) ON DELETE CASCADE,
    price_level_id     INTEGER NOT NULL REFERENCES mcogs_price_levels(id)     ON DELETE CASCADE,
    sell_price         NUMERIC(12,4) NOT NULL DEFAULT 0,
    tax_rate_id        INTEGER REFERENCES mcogs_country_tax_rates(id) ON DELETE SET NULL,
    UNIQUE (menu_sales_item_id, price_level_id)
  )`,

  // ── 50. Category Groups (unified, no type — groups span all item types) ────
  `CREATE TABLE IF NOT EXISTS mcogs_category_groups (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(100) NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 51. Categories — add group_id FK + three scope flags ─────────────────
  `ALTER TABLE mcogs_categories
    ADD COLUMN IF NOT EXISTS group_id        INTEGER REFERENCES mcogs_category_groups(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS for_ingredients BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS for_recipes     BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS for_sales_items BOOLEAN NOT NULL DEFAULT FALSE`,

  // ── 52. Seed groups from existing group_name + populate booleans from type
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='mcogs_categories' AND column_name='group_name') THEN
      INSERT INTO mcogs_category_groups (name)
      SELECT DISTINCT group_name FROM mcogs_categories
      WHERE group_name IS NOT NULL AND group_name <> 'Unassigned'
      ON CONFLICT (name) DO NOTHING;

      UPDATE mcogs_categories c SET group_id = g.id
      FROM mcogs_category_groups g
      WHERE g.name = c.group_name AND c.group_id IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='mcogs_categories' AND column_name='type') THEN
      UPDATE mcogs_categories SET for_ingredients = TRUE
        WHERE type = 'ingredient' AND NOT for_ingredients;
      UPDATE mcogs_categories SET for_recipes = TRUE
        WHERE type = 'recipe' AND NOT for_recipes;
    END IF;
  END $$`,

  // ── 53. Ingredients — add category_id FK ─────────────────────────────────
  `ALTER TABLE mcogs_ingredients
    ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL`,

  // ── 54. Recipes — add category_id FK ─────────────────────────────────────
  `ALTER TABLE mcogs_recipes
    ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL`,

  // ── 55. Sales Items — add category_id FK ─────────────────────────────────
  `ALTER TABLE mcogs_sales_items
    ADD COLUMN IF NOT EXISTS category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL`,

  // ── 56. Populate category_id from existing VARCHAR category fields ─────────
  `DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='mcogs_ingredients' AND column_name='category') THEN
      UPDATE mcogs_ingredients i SET category_id = c.id
      FROM mcogs_categories c
      WHERE c.name = i.category AND c.for_ingredients = TRUE AND i.category_id IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='mcogs_recipes' AND column_name='category') THEN
      UPDATE mcogs_recipes r SET category_id = c.id
      FROM mcogs_categories c
      WHERE c.name = r.category AND c.for_recipes = TRUE AND r.category_id IS NULL;
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name='mcogs_sales_items' AND column_name='category') THEN
      UPDATE mcogs_sales_items s SET category_id = c.id
      FROM mcogs_categories c
      WHERE c.name = s.category AND c.for_sales_items = TRUE AND s.category_id IS NULL;
    END IF;
  END $$`,

  // ── 57–61. Drop old VARCHAR category columns (idempotent via IF EXISTS) ───
  `ALTER TABLE mcogs_categories  DROP COLUMN IF EXISTS group_name`,
  `ALTER TABLE mcogs_categories  DROP COLUMN IF EXISTS type`,
  `ALTER TABLE mcogs_ingredients DROP COLUMN IF EXISTS category`,
  `ALTER TABLE mcogs_recipes      DROP COLUMN IF EXISTS category`,
  `ALTER TABLE mcogs_sales_items  DROP COLUMN IF EXISTS category`,

  // ── 68. Standalone Combos table ──────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combos (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES mcogs_categories(id) ON DELETE SET NULL,
    image_url   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_combos_category ON mcogs_combos(category_id)`,

  // ── 69. Combo Steps — swap FK from sales_item_id → combo_id ─────────────
  `ALTER TABLE mcogs_combo_steps
     ADD COLUMN IF NOT EXISTS combo_id     INTEGER REFERENCES mcogs_combos(id) ON DELETE CASCADE,
     ADD COLUMN IF NOT EXISTS min_select   INTEGER NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS max_select   INTEGER NOT NULL DEFAULT 1,
     ADD COLUMN IF NOT EXISTS allow_repeat BOOLEAN NOT NULL DEFAULT false,
     ADD COLUMN IF NOT EXISTS auto_select  BOOLEAN NOT NULL DEFAULT false`,

  // ── 70. Sales Items — add combo_id FK ────────────────────────────────────
  `ALTER TABLE mcogs_sales_items
     ADD COLUMN IF NOT EXISTS combo_id INTEGER REFERENCES mcogs_combos(id) ON DELETE SET NULL`,

  // ── 71. Migrate existing combo-type sales items → mcogs_combos ───────────
  `DO $$
   DECLARE
     si  RECORD;
     cid INTEGER;
   BEGIN
     FOR si IN
       SELECT * FROM mcogs_sales_items
       WHERE item_type = 'combo' AND combo_id IS NULL
     LOOP
       INSERT INTO mcogs_combos (name, description, category_id, image_url, sort_order)
       VALUES (si.name, si.description, si.category_id, si.image_url, si.sort_order)
       RETURNING id INTO cid;

       UPDATE mcogs_combo_steps SET combo_id = cid
       WHERE sales_item_id = si.id AND combo_id IS NULL;

       UPDATE mcogs_sales_items SET combo_id = cid WHERE id = si.id;
     END LOOP;
   END $$`,

  // ── 72. Make sales_item_id nullable on combo_steps (kept for compat) ─────
  `DO $$ BEGIN
     ALTER TABLE mcogs_combo_steps ALTER COLUMN sales_item_id DROP NOT NULL;
   EXCEPTION WHEN others THEN NULL;
   END $$`,

  // ── 73. Add qty to combo_step_options (default 1 portion/unit) ───────────
  `ALTER TABLE mcogs_combo_step_options ADD COLUMN IF NOT EXISTS qty NUMERIC(12,4) NOT NULL DEFAULT 1`,

  // ── 74. Combo Templates ──────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combo_templates (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,

  // ── 75. Combo Template Steps ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combo_template_steps (
    id           SERIAL PRIMARY KEY,
    template_id  INTEGER NOT NULL REFERENCES mcogs_combo_templates(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    min_select   INTEGER NOT NULL DEFAULT 1,
    max_select   INTEGER NOT NULL DEFAULT 1,
    allow_repeat BOOLEAN NOT NULL DEFAULT false,
    auto_select  BOOLEAN NOT NULL DEFAULT false
  )`,

  // ── 76. Combo Template Step Options ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_combo_template_step_options (
    id               SERIAL PRIMARY KEY,
    template_step_id INTEGER NOT NULL REFERENCES mcogs_combo_template_steps(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    item_type        TEXT NOT NULL CHECK (item_type IN ('recipe','ingredient','manual','sales_item')),
    recipe_id        INTEGER REFERENCES mcogs_recipes(id) ON DELETE SET NULL,
    ingredient_id    INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
    sales_item_id    INTEGER REFERENCES mcogs_sales_items(id) ON DELETE SET NULL,
    manual_cost      NUMERIC(12,4),
    price_addon      NUMERIC(12,4) NOT NULL DEFAULT 0,
    qty              NUMERIC(12,4) NOT NULL DEFAULT 1,
    sort_order       INTEGER NOT NULL DEFAULT 0
  )`,

  // ── 77. Add sales_item support to combo_step_options ─────────────────────
  `ALTER TABLE mcogs_combo_step_options ADD COLUMN IF NOT EXISTS sales_item_id INTEGER REFERENCES mcogs_sales_items(id) ON DELETE SET NULL`,
  `DO $$ BEGIN
     ALTER TABLE mcogs_combo_step_options DROP CONSTRAINT IF EXISTS mcogs_combo_step_options_item_type_check;
     ALTER TABLE mcogs_combo_step_options ADD CONSTRAINT mcogs_combo_step_options_item_type_check
       CHECK (item_type IN ('recipe','ingredient','manual','sales_item'));
   EXCEPTION WHEN others THEN NULL;
   END $$`,

  // ── 78. Add display_name to modifier groups, options, combo steps + options
  `ALTER TABLE mcogs_modifier_groups     ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,
  `ALTER TABLE mcogs_modifier_options    ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,
  `ALTER TABLE mcogs_combo_steps         ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,
  `ALTER TABLE mcogs_combo_step_options  ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,

  // ── 79. Add display_name to sales items ──────────────────────────────────
  `ALTER TABLE mcogs_sales_items ADD COLUMN IF NOT EXISTS display_name VARCHAR(255)`,

  // ── 80. Add qty to modifier options ──────────────────────────────────────
  `ALTER TABLE mcogs_modifier_options ADD COLUMN IF NOT EXISTS qty NUMERIC(12,4) NOT NULL DEFAULT 1`,

  // ── 81. Add qty to sales items ────────────────────────────────────────────
  `ALTER TABLE mcogs_sales_items ADD COLUMN IF NOT EXISTS qty NUMERIC(12,4) NOT NULL DEFAULT 1`,

  // ── 82. Add image_url to modifier options ─────────────────────────────────
  `ALTER TABLE mcogs_modifier_options ADD COLUMN IF NOT EXISTS image_url TEXT`,

  // ── 83. Media library — categories ───────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_media_categories (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`,

  // ── 84. Media library — items (stores original + thumb + web variants) ───
  `CREATE TABLE IF NOT EXISTS mcogs_media_items (
  id                SERIAL PRIMARY KEY,
  filename          VARCHAR(500) NOT NULL,
  original_filename VARCHAR(500) NOT NULL,
  url               TEXT NOT NULL,
  thumb_url         TEXT,
  web_url           TEXT,
  storage_type      VARCHAR(10)  NOT NULL DEFAULT 'local',
  storage_key       TEXT,
  thumb_key         TEXT,
  web_key           TEXT,
  mime_type         VARCHAR(100) NOT NULL DEFAULT 'image/jpeg',
  size_bytes        INTEGER      NOT NULL DEFAULT 0,
  width             INTEGER,
  height            INTEGER,
  scope             VARCHAR(10)  NOT NULL DEFAULT 'shared',
  form_key          VARCHAR(100),
  category_id       INTEGER REFERENCES mcogs_media_categories(id) ON DELETE SET NULL,
  uploaded_by       TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
)`,

  // ── 85. Media library — indexes ───────────────────────────────────────────
  `CREATE INDEX IF NOT EXISTS idx_media_items_category  ON mcogs_media_items(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_media_items_scope     ON mcogs_media_items(scope, form_key)`,
  `CREATE INDEX IF NOT EXISTS idx_media_items_created   ON mcogs_media_items(created_at DESC)`,

  // ── 62–67. Drop old category indexes, create FK indexes ──────────────────
  `DROP INDEX IF EXISTS idx_ingredients_category`,
  `DROP INDEX IF EXISTS idx_recipes_category`,
  `CREATE INDEX IF NOT EXISTS idx_ingredients_category_id ON mcogs_ingredients(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recipes_category_id     ON mcogs_recipes(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_items_category_id ON mcogs_sales_items(category_id)`,

  // ── 33–36 Seed: default system roles + permission matrix ─────────────────
  `INSERT INTO mcogs_roles (name, description, is_system) VALUES
    ('Admin',    'Full access including user management', true),
    ('Operator', 'Full read/write to COGS data, no user management', true),
    ('Viewer',   'Read-only access to all COGS data', true)
  ON CONFLICT (name) DO NOTHING`,

  `DO $$ DECLARE
    admin_id    INTEGER;
    operator_id INTEGER;
    viewer_id   INTEGER;
    features    TEXT[] := ARRAY['dashboard','inventory','recipes','menus','allergens','haccp','markets','categories','settings','import','ai_chat','users'];
    f           TEXT;
  BEGIN
    SELECT id INTO admin_id    FROM mcogs_roles WHERE name = 'Admin';
    SELECT id INTO operator_id FROM mcogs_roles WHERE name = 'Operator';
    SELECT id INTO viewer_id   FROM mcogs_roles WHERE name = 'Viewer';

    FOREACH f IN ARRAY features LOOP
      INSERT INTO mcogs_role_permissions (role_id, feature, access)
        VALUES (admin_id, f, 'write')
        ON CONFLICT (role_id, feature) DO NOTHING;

      INSERT INTO mcogs_role_permissions (role_id, feature, access)
        VALUES (operator_id, f,
          CASE WHEN f IN ('users') THEN 'none'
               WHEN f IN ('settings') THEN 'read'
               ELSE 'write' END)
        ON CONFLICT (role_id, feature) DO NOTHING;

      INSERT INTO mcogs_role_permissions (role_id, feature, access)
        VALUES (viewer_id, f,
          CASE WHEN f IN ('users','settings','import') THEN 'none'
               ELSE 'read' END)
        ON CONFLICT (role_id, feature) DO NOTHING;
    END LOOP;
  END $$`,

  // ── Menu-level combo step option prices ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_combo_option_prices (
     menu_sales_item_id   INTEGER NOT NULL REFERENCES mcogs_menu_sales_items(id)  ON DELETE CASCADE,
     combo_step_option_id INTEGER NOT NULL REFERENCES mcogs_combo_step_options(id) ON DELETE CASCADE,
     price_level_id       INTEGER NOT NULL REFERENCES mcogs_price_levels(id)       ON DELETE CASCADE,
     sell_price           NUMERIC(12,4) NOT NULL DEFAULT 0,
     PRIMARY KEY (menu_sales_item_id, combo_step_option_id, price_level_id)
  )`,

  // ── Menu-level modifier option prices ────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_menu_modifier_option_prices (
     menu_sales_item_id INTEGER NOT NULL REFERENCES mcogs_menu_sales_items(id)  ON DELETE CASCADE,
     modifier_option_id INTEGER NOT NULL REFERENCES mcogs_modifier_options(id)  ON DELETE CASCADE,
     price_level_id     INTEGER NOT NULL REFERENCES mcogs_price_levels(id)      ON DELETE CASCADE,
     sell_price         NUMERIC(12,4) NOT NULL DEFAULT 0,
     PRIMARY KEY (menu_sales_item_id, modifier_option_id, price_level_id)
  )`,

  // ══════════════════════════════════════════════════════════════════════════════
  // ██  STOCK MANAGER MODULE — Steps 86-99
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Step 86: Stores (sub-locations within mcogs_locations) ─────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_stores (
     id              SERIAL PRIMARY KEY,
     location_id     INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
     name            VARCHAR(200) NOT NULL,
     code            VARCHAR(50),
     store_type      VARCHAR(50),
     is_store_itself BOOLEAN NOT NULL DEFAULT FALSE,
     is_active       BOOLEAN NOT NULL DEFAULT TRUE,
     notes           TEXT,
     sort_order      INTEGER NOT NULL DEFAULT 0,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (location_id, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stores_location ON mcogs_stores(location_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stores_active   ON mcogs_stores(is_active) WHERE is_active = TRUE`,

  // ── Step 87: Stock Levels (materialized on-hand per store per ingredient) ──
  `CREATE TABLE IF NOT EXISTS mcogs_stock_levels (
     id              SERIAL PRIMARY KEY,
     store_id        INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE CASCADE,
     ingredient_id   INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
     qty_on_hand     NUMERIC(18,4) NOT NULL DEFAULT 0,
     min_stock_level NUMERIC(18,4),
     max_stock_level NUMERIC(18,4),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (store_id, ingredient_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_levels_store      ON mcogs_stock_levels(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_levels_ingredient ON mcogs_stock_levels(ingredient_id)`,

  // ── Step 88: Stock Movements (immutable audit ledger) ──────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_stock_movements (
     id              SERIAL PRIMARY KEY,
     store_id        INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     ingredient_id   INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     movement_type   VARCHAR(30) NOT NULL CHECK (movement_type IN (
       'goods_in','goods_in_no_po','waste','transfer_out','transfer_in',
       'stocktake_adjust','credit_note','manual_adjust'
     )),
     quantity        NUMERIC(18,4) NOT NULL,
     unit_cost       NUMERIC(18,4),
     reference_type  VARCHAR(30),
     reference_id    INTEGER,
     notes           TEXT,
     created_by      VARCHAR(200),
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mov_store      ON mcogs_stock_movements(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mov_ingredient ON mcogs_stock_movements(ingredient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mov_type       ON mcogs_stock_movements(movement_type)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mov_ref        ON mcogs_stock_movements(reference_type, reference_id) WHERE reference_type IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_stock_mov_created    ON mcogs_stock_movements(created_at DESC)`,

  // ── Step 89: Purchase Orders + Line Items ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_purchase_orders (
     id              SERIAL PRIMARY KEY,
     store_id        INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     vendor_id       INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE RESTRICT,
     po_number       VARCHAR(100) NOT NULL,
     status          VARCHAR(30) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','submitted','partial','received','cancelled')),
     order_date      DATE NOT NULL DEFAULT CURRENT_DATE,
     expected_date   DATE,
     notes           TEXT,
     template_id     INTEGER,
     created_by      VARCHAR(200),
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_purchase_order_items (
     id                SERIAL PRIMARY KEY,
     po_id             INTEGER NOT NULL REFERENCES mcogs_purchase_orders(id) ON DELETE CASCADE,
     ingredient_id     INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     quote_id          INTEGER REFERENCES mcogs_price_quotes(id) ON DELETE SET NULL,
     qty_ordered       NUMERIC(18,4) NOT NULL,
     qty_received      NUMERIC(18,4) NOT NULL DEFAULT 0,
     unit_price        NUMERIC(18,4) NOT NULL,
     purchase_unit     VARCHAR(50),
     qty_in_base_units NUMERIC(18,8),
     sort_order        INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_po_store  ON mcogs_purchase_orders(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_po_vendor ON mcogs_purchase_orders(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_po_status ON mcogs_purchase_orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_po_date   ON mcogs_purchase_orders(order_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_poi_po    ON mcogs_purchase_order_items(po_id)`,
  `CREATE INDEX IF NOT EXISTS idx_poi_ing   ON mcogs_purchase_order_items(ingredient_id)`,

  // ── Step 90: Order Templates ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_order_templates (
     id          SERIAL PRIMARY KEY,
     store_id    INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE CASCADE,
     vendor_id   INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE RESTRICT,
     name        VARCHAR(200) NOT NULL,
     notes       TEXT,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_order_template_items (
     id            SERIAL PRIMARY KEY,
     template_id   INTEGER NOT NULL REFERENCES mcogs_order_templates(id) ON DELETE CASCADE,
     ingredient_id INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     quote_id      INTEGER REFERENCES mcogs_price_quotes(id) ON DELETE SET NULL,
     default_qty   NUMERIC(18,4) NOT NULL DEFAULT 0,
     purchase_unit VARCHAR(50),
     sort_order    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ot_store  ON mcogs_order_templates(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ot_vendor ON mcogs_order_templates(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_oti_tmpl  ON mcogs_order_template_items(template_id)`,

  // ── Step 91: Goods Received Notes (GRN) + Line Items ───────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_goods_received (
     id            SERIAL PRIMARY KEY,
     store_id      INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     po_id         INTEGER REFERENCES mcogs_purchase_orders(id) ON DELETE SET NULL,
     vendor_id     INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE RESTRICT,
     grn_number    VARCHAR(100) NOT NULL,
     status        VARCHAR(30) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','confirmed')),
     received_date DATE NOT NULL DEFAULT CURRENT_DATE,
     notes         TEXT,
     created_by    VARCHAR(200),
     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_goods_received_items (
     id                SERIAL PRIMARY KEY,
     grn_id            INTEGER NOT NULL REFERENCES mcogs_goods_received(id) ON DELETE CASCADE,
     ingredient_id     INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     po_item_id        INTEGER REFERENCES mcogs_purchase_order_items(id) ON DELETE SET NULL,
     qty_received      NUMERIC(18,4) NOT NULL,
     unit_price        NUMERIC(18,4) NOT NULL,
     purchase_unit     VARCHAR(50),
     qty_in_base_units NUMERIC(18,8),
     sort_order        INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_grn_store  ON mcogs_goods_received(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grn_po     ON mcogs_goods_received(po_id) WHERE po_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_grn_vendor ON mcogs_goods_received(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_grn_date   ON mcogs_goods_received(received_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_grni_grn   ON mcogs_goods_received_items(grn_id)`,

  // ── Step 92: Invoices + Line Items ─────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_invoices (
     id             SERIAL PRIMARY KEY,
     store_id       INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     vendor_id      INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE RESTRICT,
     grn_id         INTEGER REFERENCES mcogs_goods_received(id) ON DELETE SET NULL,
     invoice_number VARCHAR(100) NOT NULL,
     status         VARCHAR(30) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','pending','approved','paid','disputed')),
     invoice_date   DATE NOT NULL DEFAULT CURRENT_DATE,
     due_date       DATE,
     subtotal       NUMERIC(18,4) NOT NULL DEFAULT 0,
     tax_amount     NUMERIC(18,4) NOT NULL DEFAULT 0,
     total          NUMERIC(18,4) NOT NULL DEFAULT 0,
     currency_code  VARCHAR(10),
     notes          TEXT,
     created_by     VARCHAR(200),
     created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_invoice_items (
     id            SERIAL PRIMARY KEY,
     invoice_id    INTEGER NOT NULL REFERENCES mcogs_invoices(id) ON DELETE CASCADE,
     ingredient_id INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
     description   VARCHAR(500),
     quantity      NUMERIC(18,4) NOT NULL,
     unit_price    NUMERIC(18,4) NOT NULL,
     line_total    NUMERIC(18,4) NOT NULL DEFAULT 0,
     sort_order    INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inv_store  ON mcogs_invoices(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inv_vendor ON mcogs_invoices(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inv_grn    ON mcogs_invoices(grn_id) WHERE grn_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_inv_status ON mcogs_invoices(status)`,
  `CREATE INDEX IF NOT EXISTS idx_inv_date   ON mcogs_invoices(invoice_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_invi_inv   ON mcogs_invoice_items(invoice_id)`,

  // ── Step 93: Credit Notes + Line Items ─────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_credit_notes (
     id            SERIAL PRIMARY KEY,
     store_id      INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     vendor_id     INTEGER NOT NULL REFERENCES mcogs_vendors(id) ON DELETE RESTRICT,
     invoice_id    INTEGER REFERENCES mcogs_invoices(id) ON DELETE SET NULL,
     grn_id        INTEGER REFERENCES mcogs_goods_received(id) ON DELETE SET NULL,
     credit_number VARCHAR(100) NOT NULL,
     status        VARCHAR(30) NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','submitted','approved','applied')),
     credit_date   DATE NOT NULL DEFAULT CURRENT_DATE,
     reason        TEXT,
     total         NUMERIC(18,4) NOT NULL DEFAULT 0,
     created_by    VARCHAR(200),
     created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_credit_note_items (
     id              SERIAL PRIMARY KEY,
     credit_note_id  INTEGER NOT NULL REFERENCES mcogs_credit_notes(id) ON DELETE CASCADE,
     ingredient_id   INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
     description     VARCHAR(500),
     quantity        NUMERIC(18,4) NOT NULL,
     unit_price      NUMERIC(18,4) NOT NULL,
     line_total      NUMERIC(18,4) NOT NULL DEFAULT 0,
     sort_order      INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cn_store  ON mcogs_credit_notes(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cn_vendor ON mcogs_credit_notes(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cn_inv    ON mcogs_credit_notes(invoice_id) WHERE invoice_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_cni_cn    ON mcogs_credit_note_items(credit_note_id)`,

  // ── Step 94: Waste Reason Codes + Waste Log ────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_waste_reason_codes (
     id          SERIAL PRIMARY KEY,
     name        VARCHAR(200) NOT NULL UNIQUE,
     description TEXT,
     is_active   BOOLEAN NOT NULL DEFAULT TRUE,
     sort_order  INTEGER NOT NULL DEFAULT 0,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_waste_log (
     id              SERIAL PRIMARY KEY,
     store_id        INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     ingredient_id   INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     reason_code_id  INTEGER REFERENCES mcogs_waste_reason_codes(id) ON DELETE SET NULL,
     quantity        NUMERIC(18,4) NOT NULL,
     unit_cost       NUMERIC(18,4),
     waste_date      DATE NOT NULL DEFAULT CURRENT_DATE,
     notes           TEXT,
     created_by      VARCHAR(200),
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_waste_store      ON mcogs_waste_log(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_waste_ingredient ON mcogs_waste_log(ingredient_id)`,
  `CREATE INDEX IF NOT EXISTS idx_waste_date       ON mcogs_waste_log(waste_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_waste_reason     ON mcogs_waste_log(reason_code_id) WHERE reason_code_id IS NOT NULL`,

  // ── Step 95: Stock Transfers + Line Items ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_stock_transfers (
     id               SERIAL PRIMARY KEY,
     from_store_id    INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     to_store_id      INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     transfer_number  VARCHAR(100) NOT NULL,
     status           VARCHAR(30) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','in_transit','confirmed','cancelled')),
     transfer_date    DATE NOT NULL DEFAULT CURRENT_DATE,
     notes            TEXT,
     created_by       VARCHAR(200),
     confirmed_by     VARCHAR(200),
     confirmed_at     TIMESTAMPTZ,
     created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CHECK (from_store_id != to_store_id)
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_stock_transfer_items (
     id              SERIAL PRIMARY KEY,
     transfer_id     INTEGER NOT NULL REFERENCES mcogs_stock_transfers(id) ON DELETE CASCADE,
     ingredient_id   INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     qty_sent        NUMERIC(18,4) NOT NULL,
     qty_received    NUMERIC(18,4),
     sort_order      INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_xfer_from   ON mcogs_stock_transfers(from_store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_xfer_to     ON mcogs_stock_transfers(to_store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_xfer_status ON mcogs_stock_transfers(status)`,
  `CREATE INDEX IF NOT EXISTS idx_xfer_date   ON mcogs_stock_transfers(transfer_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_xferi_xfer  ON mcogs_stock_transfer_items(transfer_id)`,

  // ── Step 96: Stocktakes + Count Items ──────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_stocktakes (
     id              SERIAL PRIMARY KEY,
     store_id        INTEGER NOT NULL REFERENCES mcogs_stores(id) ON DELETE RESTRICT,
     stocktake_type  VARCHAR(30) NOT NULL DEFAULT 'full'
                     CHECK (stocktake_type IN ('full','spot_check')),
     status          VARCHAR(30) NOT NULL DEFAULT 'in_progress'
                     CHECK (status IN ('in_progress','completed','approved')),
     started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     completed_at    TIMESTAMPTZ,
     approved_by     VARCHAR(200),
     approved_at     TIMESTAMPTZ,
     notes           TEXT,
     created_by      VARCHAR(200),
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS mcogs_stocktake_items (
     id              SERIAL PRIMARY KEY,
     stocktake_id    INTEGER NOT NULL REFERENCES mcogs_stocktakes(id) ON DELETE CASCADE,
     ingredient_id   INTEGER NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE RESTRICT,
     expected_qty    NUMERIC(18,4),
     counted_qty     NUMERIC(18,4),
     variance        NUMERIC(18,4),
     notes           TEXT,
     counted_by      VARCHAR(200),
     counted_at      TIMESTAMPTZ,
     UNIQUE (stocktake_id, ingredient_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_st_store  ON mcogs_stocktakes(store_id)`,
  `CREATE INDEX IF NOT EXISTS idx_st_status ON mcogs_stocktakes(status)`,
  `CREATE INDEX IF NOT EXISTS idx_st_type   ON mcogs_stocktakes(stocktake_type)`,
  `CREATE INDEX IF NOT EXISTS idx_sti_st    ON mcogs_stocktake_items(stocktake_id)`,

  // ── Step 97: Seed default waste reason codes ───────────────────────────────
  `INSERT INTO mcogs_waste_reason_codes (name, sort_order) VALUES
     ('Expired', 1), ('Damaged', 2), ('Spillage', 3),
     ('Over-production', 4), ('Quality issue', 5), ('Staff meal', 6), ('Other', 7)
   ON CONFLICT DO NOTHING`,

  // ── Step 98: RBAC — add granular stock features to existing roles ───────────
  `DO $$ DECLARE r RECORD; feat TEXT; BEGIN
     FOR r IN SELECT id, name FROM mcogs_roles LOOP
       FOREACH feat IN ARRAY ARRAY['stock_overview','stock_purchase_orders','stock_goods_in','stock_invoices','stock_waste','stock_transfers','stock_stocktake'] LOOP
         INSERT INTO mcogs_role_permissions (role_id, feature, access)
         VALUES (r.id, feat,
           CASE
             WHEN r.name = 'Admin'    THEN 'write'
             WHEN r.name = 'Operator' THEN 'write'
             WHEN r.name = 'Viewer'   THEN 'read'
             ELSE 'none'
           END
         ) ON CONFLICT (role_id, feature) DO NOTHING;
       END LOOP;
     END LOOP;
   END $$`,

  // ── Step 99: Number sequences for auto-generated document numbers ──────────
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='mcogs_po_number_seq')
     THEN CREATE SEQUENCE mcogs_po_number_seq START 1001; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='mcogs_grn_number_seq')
     THEN CREATE SEQUENCE mcogs_grn_number_seq START 1001; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='mcogs_inv_number_seq')
     THEN CREATE SEQUENCE mcogs_inv_number_seq START 1001; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='mcogs_cn_number_seq')
     THEN CREATE SEQUENCE mcogs_cn_number_seq START 1001; END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname='public' AND sequencename='mcogs_xfer_number_seq')
     THEN CREATE SEQUENCE mcogs_xfer_number_seq START 1001; END IF;
   END $$`,

  // ══════════════════════════════════════════════════════════════════════════════
  // ██  AUDIT LOG — Step 100
  // ══════════════════════════════════════════════════════════════════════════════

  // ── Step 100: Central audit log ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_audit_log (
     id               SERIAL PRIMARY KEY,
     user_sub         VARCHAR(200),
     user_email       VARCHAR(200),
     user_name        VARCHAR(200),
     action           VARCHAR(30) NOT NULL CHECK (action IN ('create','update','delete','status_change','confirm','approve','reverse')),
     entity_type      VARCHAR(50) NOT NULL,
     entity_id        INTEGER,
     entity_label     VARCHAR(500),
     field_changes    JSONB,
     context          JSONB,
     related_entities JSONB,
     ip_address       VARCHAR(45),
     created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity     ON mcogs_audit_log(entity_type, entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_user       ON mcogs_audit_log(user_sub)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_action     ON mcogs_audit_log(action)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_created    ON mcogs_audit_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_context    ON mcogs_audit_log USING gin(context jsonb_path_ops)`,

  // ── Step 101: Add store_id to PO items for per-item location assignment ────
  `ALTER TABLE mcogs_purchase_order_items ADD COLUMN IF NOT EXISTS store_id INTEGER REFERENCES mcogs_stores(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS idx_poi_store ON mcogs_purchase_order_items(store_id) WHERE store_id IS NOT NULL`,

  // ── Step 102: User notes (Pepper memory — pinned notes) ────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_user_notes (
    id          SERIAL PRIMARY KEY,
    user_sub    VARCHAR(200) NOT NULL,
    note        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_notes_sub ON mcogs_user_notes(user_sub)`,

  // ── Step 103: User profiles (Pepper memory — long-term profile) ────────────
  `CREATE TABLE IF NOT EXISTS mcogs_user_profiles (
    id                  SERIAL PRIMARY KEY,
    user_sub            VARCHAR(200) NOT NULL UNIQUE,
    display_name        VARCHAR(200),
    profile_json        JSONB NOT NULL DEFAULT '{}',
    long_term_summary   TEXT,
    profile_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_profiles_sub ON mcogs_user_profiles(user_sub)`,

  // ── Step 104: Allow repeat selection on modifier groups ─────────────────────
  `ALTER TABLE mcogs_modifier_groups ADD COLUMN IF NOT EXISTS allow_repeat_selection BOOLEAN NOT NULL DEFAULT FALSE`,

  // ── Step 105: auto_show flag on modifier group junctions ───────────────────
  `ALTER TABLE mcogs_sales_item_modifier_groups ADD COLUMN IF NOT EXISTS auto_show BOOLEAN NOT NULL DEFAULT TRUE`,
  `ALTER TABLE mcogs_combo_step_option_modifier_groups ADD COLUMN IF NOT EXISTS auto_show BOOLEAN NOT NULL DEFAULT TRUE`,

  // ── Step 106: default_auto_show on modifier groups + make junction auto_show nullable ──
  `ALTER TABLE mcogs_modifier_groups ADD COLUMN IF NOT EXISTS default_auto_show BOOLEAN NOT NULL DEFAULT TRUE`,
  // Change junction columns from NOT NULL to nullable (NULL = use group default)
  `ALTER TABLE mcogs_sales_item_modifier_groups ALTER COLUMN auto_show DROP NOT NULL`,
  `ALTER TABLE mcogs_sales_item_modifier_groups ALTER COLUMN auto_show SET DEFAULT NULL`,
  `ALTER TABLE mcogs_combo_step_option_modifier_groups ALTER COLUMN auto_show DROP NOT NULL`,
  `ALTER TABLE mcogs_combo_step_option_modifier_groups ALTER COLUMN auto_show SET DEFAULT NULL`,
  // Set existing TRUE values to NULL (follow group default)
  `UPDATE mcogs_sales_item_modifier_groups SET auto_show = NULL WHERE auto_show = TRUE`,
  `UPDATE mcogs_combo_step_option_modifier_groups SET auto_show = NULL WHERE auto_show = TRUE`,

  // ── Step 107: Bugs log + Backlog tables ────────────────────────────────────
  `CREATE SEQUENCE IF NOT EXISTS mcogs_bug_number_seq START 1001`,
  `CREATE TABLE IF NOT EXISTS mcogs_bugs (
    id                  SERIAL PRIMARY KEY,
    key                 VARCHAR(20)  NOT NULL UNIQUE,
    summary             VARCHAR(500) NOT NULL,
    description         TEXT,
    priority            VARCHAR(20)  NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('highest','high','medium','low','lowest')),
    status              VARCHAR(30)  NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','resolved','closed','wont_fix')),
    severity            VARCHAR(20)  NOT NULL DEFAULT 'minor'
                        CHECK (severity IN ('critical','major','minor','trivial')),
    reported_by         VARCHAR(200),
    reported_by_email   VARCHAR(200),
    assigned_to         VARCHAR(200),
    page                VARCHAR(200),
    steps_to_reproduce  TEXT,
    environment         TEXT,
    labels              JSONB NOT NULL DEFAULT '[]',
    attachments         JSONB NOT NULL DEFAULT '[]',
    resolution          TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bugs_status      ON mcogs_bugs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_bugs_priority     ON mcogs_bugs(priority)`,
  `CREATE INDEX IF NOT EXISTS idx_bugs_assigned     ON mcogs_bugs(assigned_to) WHERE assigned_to IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_bugs_reported     ON mcogs_bugs(reported_by)`,

  `CREATE SEQUENCE IF NOT EXISTS mcogs_backlog_number_seq START 1001`,
  `CREATE TABLE IF NOT EXISTS mcogs_backlog (
    id                  SERIAL PRIMARY KEY,
    key                 VARCHAR(20)  NOT NULL UNIQUE,
    summary             VARCHAR(500) NOT NULL,
    description         TEXT,
    item_type           VARCHAR(20)  NOT NULL DEFAULT 'story'
                        CHECK (item_type IN ('story','task','epic','improvement')),
    priority            VARCHAR(20)  NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('highest','high','medium','low','lowest')),
    status              VARCHAR(30)  NOT NULL DEFAULT 'backlog'
                        CHECK (status IN ('backlog','todo','in_progress','in_review','done','wont_do')),
    requested_by        VARCHAR(200),
    requested_by_email  VARCHAR(200),
    assigned_to         VARCHAR(200),
    labels              JSONB NOT NULL DEFAULT '[]',
    acceptance_criteria TEXT,
    story_points        INTEGER,
    sprint              VARCHAR(100),
    sort_order          INTEGER NOT NULL DEFAULT 0,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_status    ON mcogs_backlog(status)`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_priority   ON mcogs_backlog(priority)`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_assigned   ON mcogs_backlog(assigned_to) WHERE assigned_to IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_sort       ON mcogs_backlog(sort_order)`,

  // ── Step 107b: RBAC — seed bugs + backlog features ─────────────────────────
  `DO $$ DECLARE r RECORD; feat TEXT; BEGIN
     FOR r IN SELECT id, name FROM mcogs_roles LOOP
       -- bugs: everyone gets write (anyone can log)
       INSERT INTO mcogs_role_permissions (role_id, feature, access)
       VALUES (r.id, 'bugs', 'write')
       ON CONFLICT (role_id, feature) DO NOTHING;

       -- backlog: admin=write, operator/viewer=read
       INSERT INTO mcogs_role_permissions (role_id, feature, access)
       VALUES (r.id, 'backlog',
         CASE WHEN r.name = 'Admin' THEN 'write'
              ELSE 'read' END
       ) ON CONFLICT (role_id, feature) DO NOTHING;
     END LOOP;
   END $$`,

  // ── Step 108: Seed Known Bugs Fixed + Backlog from CLAUDE.md ────────────
  // Idempotent — ON CONFLICT (key) DO NOTHING.  Sequences are bumped past
  // the highest seeded key so that future manual entries start above.

  `DO $$ BEGIN
    -- ── Bugs (known fixes, all resolved) ─────────────────────────────────
    INSERT INTO mcogs_bugs (key, summary, description, priority, severity, status, labels, page, resolution) VALUES
      ('BUG-1001', 'Mixed Content Error (HTTP vs HTTPS)',
       'deploy.yml was hardcoding http:// when constructing VITE_API_URL at build time. 1,252+ blocked network requests.',
       'highest', 'critical', 'resolved', '["from-claude-md","ci-cd"]'::jsonb, 'CI/CD',
       'Use the GitHub secret reference directly instead of hardcoding http:// prefix.'),

      ('BUG-1002', 'Infinite useEffect Loop',
       'useApi() returned a new object literal on every render, causing useCallback/useEffect to re-fire infinitely. Thousands of API requests per second.',
       'highest', 'critical', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'All Pages',
       'Wrap useApi return object in useMemo.'),

      ('BUG-1003', 'Express Trust Proxy Error',
       'express-rate-limit throwing ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request. API errors preventing any POST requests.',
       'high', 'major', 'resolved', '["from-claude-md","api"]'::jsonb, 'API',
       'Added app.set(''trust proxy'', 1) in index.js.'),

      ('BUG-1004', 'ColumnHeader Dropdown Clipping',
       'Filter/sort dropdown in column headers clipped inside overflow-x-auto table wrapper.',
       'medium', 'minor', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'DataGrid',
       'Changed to fixed positioning calculated from getBoundingClientRect().'),

      ('BUG-1005', 'TypeScript Build Failure (ImportPage)',
       'CI/CD failed at Vite build: PageHeader called with description prop (should be subtitle), TD self-closing without optional children.',
       'high', 'major', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Import',
       'Renamed prop to subtitle, made TD children optional.'),

      ('BUG-1006', 'import.js Router Export Shape',
       'Express threw Router.use() requires a middleware function after extracting stageFileContent. Route registration broke.',
       'high', 'major', 'resolved', '["from-claude-md","api"]'::jsonb, 'Import',
       'Changed index.js to require(''./import'').router.'),

      ('BUG-1007', 'Recipe Import Silently Failing (Wrong Column Names)',
       'Recipes never appeared in DB after import. insert used qty instead of prep_qty, and included non-existent sort_order column.',
       'highest', 'critical', 'resolved', '["from-claude-md","api"]'::jsonb, 'Import',
       'Corrected to prep_qty, removed sort_order from INSERT.'),

      ('BUG-1008', 'Shared View Comment Count Mismatch',
       'Comments badge showed 9 but only 3 comments visible. Badge counted all change types instead of only comment type.',
       'medium', 'minor', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Menus',
       'Filter badge count to change_type = comment only. Price changes moved to History tab.'),

      ('BUG-1009', 'Shared View Reply Posted to Wrong Shared Page',
       'Reply from ME always posted to shared view A (active[0]) regardless of originating view. Multi-shared-view replies misrouted.',
       'high', 'major', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Menus',
       'Tag each change row with shared_page_id; pass replyTo.shared_page_id when posting.'),

      ('BUG-1010', 'Pepper Conversation Lost on Panel Mode Switch',
       'Switching Pepper between float, docked-left, and docked-right cleared conversation history. Three conditional branches each remounted AiChat.',
       'high', 'major', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Pepper AI',
       'Render single always-mounted AiChat, control position via CSS order.'),

      ('BUG-1011', 'AI Chat Focus Loss on Every Keystroke',
       'Typing in Pepper chat textarea lost focus after each character. ChatPanel/HistoryPanel defined inside AiChat body created unstable component identities.',
       'high', 'major', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Pepper AI',
       'Moved ChatPanel and HistoryPanel to module level. Added useEffect to restore focus after streaming.'),

      ('BUG-1012', 'Sidebar Does Not Span Full Viewport Height',
       'Sidebar green border stopped short of bottom of screen. Wrapper div used h-full which does not always resolve inside flex.',
       'low', 'minor', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Layout',
       'Changed wrapper from h-full to flex flex-col self-stretch.'),

      ('BUG-1013', 'Anthropic 400 Error (input_str Extra Field)',
       'messages.N.content.0.text.input_str: Extra inputs are not permitted — 400 error on 9th+ message in multi-turn tool conversations.',
       'highest', 'critical', 'resolved', '["from-claude-md","api"]'::jsonb, 'Pepper AI',
       'Destructure input_str off block before pushing to assistantContent.'),

      ('BUG-1014', 'category-groups.js PM2 Crash (Wrong require Path)',
       'PM2 crashed on startup with Cannot find module ../db from category-groups.js.',
       'high', 'major', 'resolved', '["from-claude-md","api"]'::jsonb, 'API',
       'Changed require(''../db'') to require(''../db/pool'').'),

      ('BUG-1015', 'Migration Crash: CREATE INDEX on Already-Dropped category Column',
       'npm run migrate failed with column category does not exist. Early CREATE INDEX on column that was dropped by later FK migration.',
       'high', 'major', 'resolved', '["from-claude-md","api"]'::jsonb, 'Migration',
       'Wrapped old index creations in DO blocks that check column existence first.'),

      ('BUG-1016', 'Combo Step Option Modal Missing Recipe/Ingredient Selector',
       'Add/Edit Option modal for combo step options had no recipe or ingredient search field. Only manual_cost field rendered.',
       'high', 'major', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Sales Items',
       'Added recipe and ingredient combobox selectors to ComboOptionForm.'),

      ('BUG-1017', 'Allergen Matrix Showed UNCATEGORISED for Combo/Manual Items',
       'Combo-type and manual-type sales items showed UNCATEGORISED in Category column even when category was assigned.',
       'medium', 'minor', 'resolved', '["from-claude-md","api"]'::jsonb, 'Allergens',
       'Added LEFT JOIN on si.category_id and updated category resolution per item type.'),

      ('BUG-1018', 'Sales Items Edit Panel Markets/Modifiers Stacked in Details Form',
       'All fields, market checkboxes, AND modifier badges scrolled together in one long form. Panel was cluttered.',
       'medium', 'minor', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Sales Items',
       'Introduced panelTab state with Details/Markets/Modifiers tabs.'),

      ('BUG-1019', 'Combos Tab Inconsistent Delete Icons',
       'Combo step options used x text buttons for deletion instead of SVG trash icons. Separate cogwheel button was redundant.',
       'low', 'trivial', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Sales Items',
       'Replaced with SVG trash icons. Step header click now expands AND opens side panel.'),

      ('BUG-1020', 'Modifiers Tab Inline Edit Forms Cluttered',
       'Three separate inline forms resulted in cluttered hard-to-use UI inconsistent with Combos tab.',
       'medium', 'minor', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Sales Items',
       'Full refactor to match Combos tab side-panel pattern. Added qty field and sort arrows.'),

      ('BUG-1021', 'TransfersTab Wrong API Path',
       'Entire Transfers tab returned 404 on all operations. Frontend called /transfers but API route is /stock-transfers.',
       'high', 'major', 'resolved', '["from-claude-md","frontend"]'::jsonb, 'Stock Manager',
       'Replaced all /transfers references with /stock-transfers.'),

      ('BUG-1022', 'Invoice/Transfer/GRN Status Changes Used Wrong HTTP Method',
       'Status transitions failed silently. Frontend used api.patch() but backend has dedicated POST endpoints.',
       'high', 'major', 'resolved', '["from-claude-md","api"]'::jsonb, 'Stock Manager',
       'Changed all status change handlers to use api.post() with dedicated endpoints.'),

      ('BUG-1023', 'Invoice From-GRN Created Items With Zero Values',
       'Creating invoice from confirmed GRN produced line items with zero quantity and price. Wrong column names in query.',
       'high', 'major', 'resolved', '["from-claude-md","api"]'::jsonb, 'Stock Manager',
       'Changed to correct column names: qty_received and unit_price.')

    ON CONFLICT (key) DO NOTHING;

    -- Bump bug sequence past highest seeded key
    PERFORM setval('mcogs_bug_number_seq', GREATEST(nextval('mcogs_bug_number_seq'), 1024));

    -- ── Backlog items ────────────────────────────────────────────────────────
    INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
      ('BACK-1001', 'Category Groups cleanup — drop group_name VARCHAR',
       'mcogs_category_groups table is live. group_id FK is canonical. Old group_name VARCHAR column on mcogs_categories should be dropped once all consumers are confirmed to use group_id.',
       'task', 'low', 'backlog', '["from-claude-md","cleanup"]'::jsonb, 1),

      ('BACK-1002', 'Missing Price Quotes Report',
       'Report that surfaces ingredients used in menu recipes that have no preferred vendor quote for a selected market/country. Useful for identifying pricing gaps before costing a menu in a new region.',
       'story', 'medium', 'backlog', '["from-claude-md","reports"]'::jsonb, 2),

      ('BACK-1003', 'Auth0 API Audience — JWT validation',
       'Add proper API-level JWT validation. Create Auth0 API, get audience identifier, add VITE_AUTH0_AUDIENCE secret, pass audience in authorizationParams, add JWT verification middleware.',
       'task', 'medium', 'backlog', '["from-claude-md","auth"]'::jsonb, 3),

      ('BACK-1004', 'Smart Scenario — Ingredient-Level Cost Overrides',
       'Allow AI to increase cost of a specific ingredient within recipes. Requires ingredient identification, cost override granularity (r_5_i_12 key format), COGS recalculation, cascade through sub-recipes. Estimated 2-3 days.',
       'epic', 'medium', 'backlog', '["from-claude-md","menus","ai"]'::jsonb, 4),

      ('BACK-1005', 'Voice Interface for Pepper (Tier 1 — Browser APIs)',
       'Push-to-talk mic button with SpeechRecognition API, voice output via speechSynthesis. Browser-only, zero cost, ~2 days. Chromium-only for input.',
       'story', 'low', 'backlog', '["from-claude-md","ai","pepper"]'::jsonb, 5),

      ('BACK-1006', 'Voice Interface for Pepper (Tier 2 — External APIs)',
       'Whisper/Deepgram for transcription, OpenAI TTS/ElevenLabs for playback. Requires new API key fields, server-side proxy endpoint, streaming audio queue manager. ~$15-50/mo.',
       'story', 'lowest', 'backlog', '["from-claude-md","ai","pepper"]'::jsonb, 6),

      ('BACK-1007', 'Lightsail Upgrade to $20/mo',
       'Current $10/mo instance (2GB RAM, 1 vCPU) is dev/staging tier. Upgrade to $20/mo (4GB RAM, 2 vCPU) for production. Take Lightsail snapshot before upgrading.',
       'task', 'medium', 'backlog', '["from-claude-md","infrastructure"]'::jsonb, 7),

      ('BACK-1008', 'Reports Page',
       'Missing price quotes report; cross-market COGS comparison. Route TBD, medium priority.',
       'story', 'medium', 'backlog', '["from-claude-md","reports"]'::jsonb, 8),

      ('BACK-1009', 'AI Chat get_menu_cogs does not return price-level prices',
       'Pepper get_menu_cogs tool queries legacy mcogs_menu_items.sell_price instead of mcogs_menu_sales_item_prices per price level. Also list_markets does not return default_price_level_id.',
       'task', 'high', 'todo', '["ai","pepper","bug-adjacent"]'::jsonb, 9)

    ON CONFLICT (key) DO NOTHING;

    -- Bump backlog sequence past highest seeded key
    PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1010));
  END $$`,

  // ── Step 109: Item Comments (threaded, unified for bugs + backlog) ──────
  `CREATE TABLE IF NOT EXISTS mcogs_item_comments (
     id          SERIAL PRIMARY KEY,
     entity_type VARCHAR(20)  NOT NULL CHECK (entity_type IN ('bug','backlog')),
     entity_id   INTEGER      NOT NULL,
     user_sub    VARCHAR(255),
     user_email  VARCHAR(255),
     user_name   VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
     comment     TEXT         NOT NULL,
     parent_id   INTEGER      REFERENCES mcogs_item_comments(id) ON DELETE CASCADE,
     created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_item_comments_entity ON mcogs_item_comments(entity_type, entity_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_item_comments_parent ON mcogs_item_comments(parent_id) WHERE parent_id IS NOT NULL`,

  // ── Step 110: epic_id on backlog (stories → epics) ──────────────────────
  `DO $$ BEGIN
     ALTER TABLE mcogs_backlog ADD COLUMN epic_id INTEGER REFERENCES mcogs_backlog(id) ON DELETE SET NULL;
   EXCEPTION WHEN duplicate_column THEN NULL;
   END $$`,
  `CREATE INDEX IF NOT EXISTS idx_backlog_epic ON mcogs_backlog(epic_id) WHERE epic_id IS NOT NULL`,

  // ── Step 111: Seed feature epics + stories ──────────────────────────────
  `DO $$ DECLARE
     eid INTEGER;
     sort_n INTEGER := 100;
   BEGIN
     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 1: Dashboard & KPIs
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1101', 'Dashboard & KPIs',
       'Dashboard page with KPI cards, coverage tracking, menu tiles, and quick links.',
       'epic', 'medium', 'done', '["feature-doc","dashboard"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1101';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1102', 'KPI cards — ingredients, recipes, vendors, markets, active quotes, categories, coverage', NULL, 'story', 'medium', 'done', '["feature-doc","dashboard"]'::jsonb, sort_n, eid),
       ('BACK-1103', 'Menu tiles — clickable cards linking to /menus with COGS% per price level', NULL, 'story', 'medium', 'done', '["feature-doc","dashboard"]'::jsonb, sort_n+1, eid),
       ('BACK-1104', 'Price quote coverage progress bar (green/amber/red)', NULL, 'story', 'medium', 'done', '["feature-doc","dashboard"]'::jsonb, sort_n+2, eid),
       ('BACK-1105', 'Missing quotes panel — top 10 ingredients with no active price quote', NULL, 'story', 'medium', 'done', '["feature-doc","dashboard"]'::jsonb, sort_n+3, eid),
       ('BACK-1106', 'Silent refresh with last-updated timestamp', NULL, 'story', 'low', 'done', '["feature-doc","dashboard"]'::jsonb, sort_n+4, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 2: Inventory Management
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1110', 'Inventory Management',
       'Ingredients, vendors, and price quotes management with three-tab layout.',
       'epic', 'high', 'done', '["feature-doc","inventory"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1110';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1111', 'Ingredients CRUD — category, unit, waste %, prep conversion, image', NULL, 'story', 'high', 'done', '["feature-doc","inventory"]'::jsonb, sort_n, eid),
       ('BACK-1112', 'Vendors CRUD — name, country assignment, contact details', NULL, 'story', 'high', 'done', '["feature-doc","inventory"]'::jsonb, sort_n+1, eid),
       ('BACK-1113', 'Price Quotes CRUD — vendor pricing per ingredient, active/inactive, vendor product code', NULL, 'story', 'high', 'done', '["feature-doc","inventory"]'::jsonb, sort_n+2, eid),
       ('BACK-1114', 'Preferred vendor assignment per ingredient per country', NULL, 'story', 'high', 'done', '["feature-doc","inventory"]'::jsonb, sort_n+3, eid),
       ('BACK-1115', 'Menu filter dropdown — narrow ingredients/quotes to a specific menu', NULL, 'story', 'medium', 'done', '["feature-doc","inventory"]'::jsonb, sort_n+4, eid),
       ('BACK-1116', 'Header badges with lightweight stats endpoint (/ingredients/stats)', NULL, 'story', 'low', 'done', '["feature-doc","inventory"]'::jsonb, sort_n+5, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 3: Recipes
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1120', 'Recipe Builder',
       'Recipe management with ingredient/sub-recipe line items, COGS calculation, and market/PL variations.',
       'epic', 'high', 'done', '["feature-doc","recipes"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1120';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1121', 'Recipe CRUD — name, category, yield qty + unit', NULL, 'story', 'high', 'done', '["feature-doc","recipes"]'::jsonb, sort_n, eid),
       ('BACK-1122', 'Recipe items — add ingredients or sub-recipes with qty, prep unit, conversion', NULL, 'story', 'high', 'done', '["feature-doc","recipes"]'::jsonb, sort_n+1, eid),
       ('BACK-1123', 'COGS calculation — cost per portion from preferred vendor quotes', NULL, 'story', 'high', 'done', '["feature-doc","recipes"]'::jsonb, sort_n+2, eid),
       ('BACK-1124', 'Market variations — alternative ingredient lists per country', NULL, 'story', 'medium', 'done', '["feature-doc","recipes"]'::jsonb, sort_n+3, eid),
       ('BACK-1125', 'Price Level variations — alternative ingredient lists per price level', NULL, 'story', 'medium', 'done', '["feature-doc","recipes"]'::jsonb, sort_n+4, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 4: Sales Items & POS Catalog
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1130', 'Sales Items & POS Catalog',
       'Sales item catalog with recipe/ingredient/manual/combo types, modifier groups, market visibility, and default sell prices.',
       'epic', 'high', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1130';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1131', 'Sales item CRUD — 4 types: recipe, ingredient, manual, combo', NULL, 'story', 'high', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n, eid),
       ('BACK-1132', 'Market visibility — per-item enable/disable per market', NULL, 'story', 'high', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n+1, eid),
       ('BACK-1133', 'Default sell prices per price level', NULL, 'story', 'high', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n+2, eid),
       ('BACK-1134', 'Modifier groups — reusable add-on lists with min/max select, repeat selection, auto_show', NULL, 'story', 'high', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n+3, eid),
       ('BACK-1135', 'Combos — structured bundles: steps → options with price addons', NULL, 'story', 'high', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n+4, eid),
       ('BACK-1136', 'Combo templates — reusable combo configurations', NULL, 'story', 'medium', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n+5, eid),
       ('BACK-1137', 'Three-tab edit panel — Details, Markets, Modifiers', NULL, 'story', 'medium', 'done', '["feature-doc","sales-items"]'::jsonb, sort_n+6, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 5: Menu Builder & Menu Engineer
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1140', 'Menu Builder & Menu Engineer',
       'Menu management with sales item linking, scenario planning, price overrides, shared links, and three view modes.',
       'epic', 'highest', 'done', '["feature-doc","menus"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1140';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1141', 'Menu CRUD — create menus per country, link sales items with sort order', NULL, 'story', 'highest', 'done', '["feature-doc","menus"]'::jsonb, sort_n, eid),
       ('BACK-1142', 'Menu Engineer — sales mix analysis, per-level qty, COGS% calculation', NULL, 'story', 'highest', 'done', '["feature-doc","menus"]'::jsonb, sort_n+1, eid),
       ('BACK-1143', 'Price overrides — editable prices in scenario, push to live menu', NULL, 'story', 'high', 'done', '["feature-doc","menus"]'::jsonb, sort_n+2, eid),
       ('BACK-1144', 'Cost overrides — editable cost per portion in scenario', NULL, 'story', 'high', 'done', '["feature-doc","menus"]'::jsonb, sort_n+3, eid),
       ('BACK-1145', 'What If tool — bulk % change to prices and/or costs', NULL, 'story', 'medium', 'done', '["feature-doc","menus"]'::jsonb, sort_n+4, eid),
       ('BACK-1146', 'Scenario save/load/delete with named snapshots', NULL, 'story', 'high', 'done', '["feature-doc","menus"]'::jsonb, sort_n+5, eid),
       ('BACK-1147', 'Smart Scenario — AI-powered price/cost change proposals via Claude Haiku', NULL, 'story', 'medium', 'done', '["feature-doc","menus"]'::jsonb, sort_n+6, eid),
       ('BACK-1148', 'Shared Links — password-protected public pages for external reviewers', NULL, 'story', 'high', 'done', '["feature-doc","menus"]'::jsonb, sort_n+7, eid),
       ('BACK-1149', 'Three view modes — List (rich table), Excel (compact), Grid (card tiles)', NULL, 'story', 'medium', 'done', '["feature-doc","menus"]'::jsonb, sort_n+8, eid),
       ('BACK-1150', 'Cross-tab sync — menu selection syncs between Menu Builder and Menu Engineer', NULL, 'story', 'medium', 'done', '["feature-doc","menus"]'::jsonb, sort_n+9, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 15;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 6: Configuration Hub
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1160', 'Configuration Hub',
       'Unified configuration page replacing Settings, Markets, Categories, and Import. All legacy routes redirect here.',
       'epic', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1160';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1161', 'Units CRUD — measurement units (kg, litre, each)', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n, eid),
       ('BACK-1162', 'Price Levels CRUD — Dine In, Delivery, etc.', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+1, eid),
       ('BACK-1163', 'Countries/Markets — CRUD with currency, exchange rate, default price level, tax rates', NULL, 'story', 'high', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+2, eid),
       ('BACK-1164', 'Exchange rate sync from Frankfurter API', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+3, eid),
       ('BACK-1165', 'Categories CRUD — scope flags (for_ingredients, for_recipes, for_sales_items)', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+4, eid),
       ('BACK-1166', 'Category groups — canonical grouping mechanism', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+5, eid),
       ('BACK-1167', 'COGS thresholds — configure green/amber/red target percentages', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+6, eid),
       ('BACK-1168', 'Locations CRUD — physical stores with market, group, address, contact', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+7, eid),
       ('BACK-1169', 'Location groups — clusters of locations (e.g. London Central)', NULL, 'story', 'low', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+8, eid),
       ('BACK-1170', 'Brand partners — franchise partners linked to markets', NULL, 'story', 'medium', 'done', '["feature-doc","configuration"]'::jsonb, sort_n+9, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 15;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 7: RBAC & User Management
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1180', 'RBAC & User Management',
       'Role-based access control with 21 features, 3 system roles, custom roles, market scope filtering, and developer flag.',
       'epic', 'high', 'done', '["feature-doc","rbac","users"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1180';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1181', 'User lifecycle — register → pending → approved → active/disabled', NULL, 'story', 'high', 'done', '["feature-doc","rbac"]'::jsonb, sort_n, eid),
       ('BACK-1182', 'Roles CRUD — Admin/Operator/Viewer system roles + custom roles', NULL, 'story', 'high', 'done', '["feature-doc","rbac"]'::jsonb, sort_n+1, eid),
       ('BACK-1183', 'Permission matrix — features × roles, click to cycle none/read/write', NULL, 'story', 'high', 'done', '["feature-doc","rbac"]'::jsonb, sort_n+2, eid),
       ('BACK-1184', 'Market scope — user restricted to specific brand partners/countries', NULL, 'story', 'high', 'done', '["feature-doc","rbac"]'::jsonb, sort_n+3, eid),
       ('BACK-1185', 'Developer flag (is_dev) — toggle per user, gates System sections', NULL, 'story', 'medium', 'done', '["feature-doc","rbac"]'::jsonb, sort_n+4, eid),
       ('BACK-1186', '21 granular RBAC features including 7 stock features', NULL, 'story', 'medium', 'done', '["feature-doc","rbac"]'::jsonb, sort_n+5, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 8: Pepper AI Assistant
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1190', 'Pepper AI Assistant',
       'In-app AI assistant (Claude Haiku) with 92 tools, SSE streaming, memory system, dockable panel, and agentic loop.',
       'epic', 'high', 'done', '["feature-doc","ai","pepper"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1190';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1191', '92 tools — lookup, create, update, delete across all entities', NULL, 'story', 'high', 'done', '["feature-doc","ai"]'::jsonb, sort_n, eid),
       ('BACK-1192', 'SSE streaming responses with agentic tool loop', NULL, 'story', 'high', 'done', '["feature-doc","ai"]'::jsonb, sort_n+1, eid),
       ('BACK-1193', 'Memory system — pinned notes + user profiles persisted across sessions', NULL, 'story', 'medium', 'done', '["feature-doc","ai"]'::jsonb, sort_n+2, eid),
       ('BACK-1194', 'Dockable panel — left, right, bottom modes with conversation preservation', NULL, 'story', 'medium', 'done', '["feature-doc","ai"]'::jsonb, sort_n+3, eid),
       ('BACK-1195', 'File upload — CSV/text injection, image vision (base64), screenshot capture', NULL, 'story', 'medium', 'done', '["feature-doc","ai"]'::jsonb, sort_n+4, eid),
       ('BACK-1196', 'Web search tool — Brave Search API with DuckDuckGo fallback', NULL, 'story', 'low', 'done', '["feature-doc","ai"]'::jsonb, sort_n+5, eid),
       ('BACK-1197', 'GitHub integration — 8 tools for read/write to GitHub repo', NULL, 'story', 'medium', 'done', '["feature-doc","ai"]'::jsonb, sort_n+6, eid),
       ('BACK-1198', 'Excel export tool — multi-sheet .xlsx with market scope filtering', NULL, 'story', 'medium', 'done', '["feature-doc","ai"]'::jsonb, sort_n+7, eid),
       ('BACK-1199', 'Monthly token allowance — per-user cap, usage bar, period 25th→24th', NULL, 'story', 'medium', 'done', '["feature-doc","ai"]'::jsonb, sort_n+8, eid),
       ('BACK-1200', 'Right-click Ask Pepper — context menu with screenshot', NULL, 'story', 'low', 'done', '["feature-doc","ai"]'::jsonb, sort_n+9, eid),
       ('BACK-1201', 'Contextual help buttons (PepperHelpButton) on page headers and tabs', NULL, 'story', 'low', 'done', '["feature-doc","ai"]'::jsonb, sort_n+10, eid),
       ('BACK-1202', 'Markdown rendering in chat responses', NULL, 'story', 'low', 'done', '["feature-doc","ai"]'::jsonb, sort_n+11, eid),
       ('BACK-1203', 'Concise mode — toggle in Settings → AI', NULL, 'story', 'low', 'done', '["feature-doc","ai"]'::jsonb, sort_n+12, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 20;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 9: AI-Powered Import
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1220', 'AI-Powered Data Import',
       '5-step import wizard: upload → AI extraction → categories mapping → vendors mapping → execute. Supports CSV, XLSX, XLSB.',
       'epic', 'high', 'done', '["feature-doc","import"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1220';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1221', 'File upload — drag-and-drop CSV/XLSX/XLSB', NULL, 'story', 'high', 'done', '["feature-doc","import"]'::jsonb, sort_n, eid),
       ('BACK-1222', 'AI extraction — Claude parses spreadsheet into structured data', NULL, 'story', 'high', 'done', '["feature-doc","import"]'::jsonb, sort_n+1, eid),
       ('BACK-1223', 'Category mapping — map imported categories to COGS categories or create new', NULL, 'story', 'high', 'done', '["feature-doc","import"]'::jsonb, sort_n+2, eid),
       ('BACK-1224', 'Vendor mapping — map imported vendors to existing or create new', NULL, 'story', 'high', 'done', '["feature-doc","import"]'::jsonb, sort_n+3, eid),
       ('BACK-1225', 'Unit fuzzy-matching with UNIT_ALIASES map', NULL, 'story', 'medium', 'done', '["feature-doc","import"]'::jsonb, sort_n+4, eid),
       ('BACK-1226', 'Sub-recipe recognition — three-tier recipe hierarchies', NULL, 'story', 'medium', 'done', '["feature-doc","import"]'::jsonb, sort_n+5, eid),
       ('BACK-1227', 'Override action — create/skip/override for duplicate rows', NULL, 'story', 'medium', 'done', '["feature-doc","import"]'::jsonb, sort_n+6, eid),
       ('BACK-1228', 'Chatbot integration — Pepper triggers import via start_import tool', NULL, 'story', 'medium', 'done', '["feature-doc","import"]'::jsonb, sort_n+7, eid),
       ('BACK-1229', 'Template sheet download for each entity type', NULL, 'story', 'low', 'done', '["feature-doc","import"]'::jsonb, sort_n+8, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 15;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 10: Allergen Matrix
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1240', 'Allergen Matrix',
       'EU/UK FIC 14 allergen status matrix for ingredients and menu items with sticky headers and allergen notes.',
       'epic', 'medium', 'done', '["feature-doc","allergens"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1240';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1241', 'Inventory matrix — allergen status per ingredient (contains/may_contain/free_from)', NULL, 'story', 'medium', 'done', '["feature-doc","allergens"]'::jsonb, sort_n, eid),
       ('BACK-1242', 'Menu matrix — allergen status per menu item including combo ingredient chains', NULL, 'story', 'medium', 'done', '["feature-doc","allergens"]'::jsonb, sort_n+1, eid),
       ('BACK-1243', 'Sticky headers and first columns with border-separate workaround', NULL, 'story', 'low', 'done', '["feature-doc","allergens"]'::jsonb, sort_n+2, eid),
       ('BACK-1244', 'Allergen notes — inline editable textarea per row', NULL, 'story', 'low', 'done', '["feature-doc","allergens"]'::jsonb, sort_n+3, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 11: HACCP
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1250', 'HACCP Compliance',
       'HACCP temperature logs and CCP logs linked to locations and equipment.',
       'epic', 'medium', 'done', '["feature-doc","haccp"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1250';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1251', 'Equipment register — CRUD linked to locations', NULL, 'story', 'medium', 'done', '["feature-doc","haccp"]'::jsonb, sort_n, eid),
       ('BACK-1252', 'Temperature logging per equipment', NULL, 'story', 'medium', 'done', '["feature-doc","haccp"]'::jsonb, sort_n+1, eid),
       ('BACK-1253', 'CCP logs — cooking/cooling/delivery linked to locations', NULL, 'story', 'medium', 'done', '["feature-doc","haccp"]'::jsonb, sort_n+2, eid),
       ('BACK-1254', 'HACCP report endpoint', NULL, 'story', 'low', 'done', '["feature-doc","haccp"]'::jsonb, sort_n+3, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 12: Stock Manager
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1260', 'Stock Manager',
       'Full inventory management module with 8 tabs: overview, stores, purchase orders, goods in, invoices, waste, transfers, stocktake.',
       'epic', 'high', 'done', '["feature-doc","stock"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1260';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1261', 'Stock overview — KPI cards, stock levels grid, recent movements', NULL, 'story', 'high', 'done', '["feature-doc","stock"]'::jsonb, sort_n, eid),
       ('BACK-1262', 'Stores (centres) — sub-locations within locations, is_store_itself flag', NULL, 'story', 'high', 'done', '["feature-doc","stock"]'::jsonb, sort_n+1, eid),
       ('BACK-1263', 'Purchase orders — lifecycle: draft → submitted → partial → received → cancelled', NULL, 'story', 'high', 'done', '["feature-doc","stock"]'::jsonb, sort_n+2, eid),
       ('BACK-1264', 'PO smart item form — auto-populate from vendor quotes, no-quote warning', NULL, 'story', 'medium', 'done', '["feature-doc","stock"]'::jsonb, sort_n+3, eid),
       ('BACK-1265', 'Goods received — GRN lifecycle, confirm updates stock levels', NULL, 'story', 'high', 'done', '["feature-doc","stock"]'::jsonb, sort_n+4, eid),
       ('BACK-1266', 'Invoices — lifecycle: draft → pending → approved → paid → disputed', NULL, 'story', 'high', 'done', '["feature-doc","stock"]'::jsonb, sort_n+5, eid),
       ('BACK-1267', 'Waste logging — bulk entry form with reason codes, stock movement', NULL, 'story', 'medium', 'done', '["feature-doc","stock"]'::jsonb, sort_n+6, eid),
       ('BACK-1268', 'Stock transfers — two-step: dispatch → confirm, inter-store', NULL, 'story', 'medium', 'done', '["feature-doc","stock"]'::jsonb, sort_n+7, eid),
       ('BACK-1269', 'Stocktake — full/spot check, populate, variance, approve adjusts stock', NULL, 'story', 'medium', 'done', '["feature-doc","stock"]'::jsonb, sort_n+8, eid),
       ('BACK-1270', 'Stock movements — immutable audit ledger, dual-write consistency', NULL, 'story', 'medium', 'done', '["feature-doc","stock"]'::jsonb, sort_n+9, eid),
       ('BACK-1271', 'Order templates — saved PO templates for recurring orders', NULL, 'story', 'low', 'done', '["feature-doc","stock"]'::jsonb, sort_n+10, eid),
       ('BACK-1272', 'Credit notes — lifecycle: draft → submitted → approved → applied', NULL, 'story', 'medium', 'done', '["feature-doc","stock"]'::jsonb, sort_n+11, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 20;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 13: System & Administration
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1290', 'System & Administration',
       'System page with AI config, bugs & backlog, audit log, storage, database management, test data, architecture docs.',
       'epic', 'medium', 'done', '["feature-doc","system"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1290';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1291', 'Central audit log — action, entity, field_changes JSONB, context', NULL, 'story', 'high', 'done', '["feature-doc","system"]'::jsonb, sort_n, eid),
       ('BACK-1292', 'Bugs & Backlog tracker — two-tab interface embedded in System page', NULL, 'story', 'medium', 'done', '["feature-doc","system"]'::jsonb, sort_n+1, eid),
       ('BACK-1293', 'Database management — local/standalone switch, migrate data, test/save', NULL, 'story', 'medium', 'done', '["feature-doc","system"]'::jsonb, sort_n+2, eid),
       ('BACK-1294', 'Two-database architecture — config store (encrypted) + main DB', NULL, 'story', 'medium', 'done', '["feature-doc","system"]'::jsonb, sort_n+3, eid),
       ('BACK-1295', 'Test data seeder — load test/small/clear/defaults, date confirm dialog', NULL, 'story', 'low', 'done', '["feature-doc","system"]'::jsonb, sort_n+4, eid),
       ('BACK-1296', 'Architecture docs — API reference, security, troubleshooting, domain migration', NULL, 'story', 'low', 'done', '["feature-doc","system"]'::jsonb, sort_n+5, eid),
       ('BACK-1297', 'POS Mockup — functional POS simulator embedded in System', NULL, 'story', 'medium', 'done', '["feature-doc","system"]'::jsonb, sort_n+6, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 14: Media Library
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1300', 'Media Library',
       'Image management with local disk and S3 storage, variant generation, category organization, bulk operations.',
       'epic', 'medium', 'done', '["feature-doc","media"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1300';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1301', 'Image upload with automatic variant generation (original, thumb 300px, web 1200px)', NULL, 'story', 'medium', 'done', '["feature-doc","media"]'::jsonb, sort_n, eid),
       ('BACK-1302', 'Category organization and scope filtering', NULL, 'story', 'medium', 'done', '["feature-doc","media"]'::jsonb, sort_n+1, eid),
       ('BACK-1303', 'Grid and list view with focus-vs-select model', NULL, 'story', 'medium', 'done', '["feature-doc","media"]'::jsonb, sort_n+2, eid),
       ('BACK-1304', 'Bulk operations — move to category, bulk delete', NULL, 'story', 'low', 'done', '["feature-doc","media"]'::jsonb, sort_n+3, eid),
       ('BACK-1305', 'S3 migration via SSE progress stream', NULL, 'story', 'low', 'done', '["feature-doc","media"]'::jsonb, sort_n+4, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 15: Auth & Infrastructure
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1310', 'Auth & Infrastructure',
       'Auth0 SSO, CI/CD pipeline, Nginx reverse proxy, PM2 process management, SSL via Certbot.',
       'epic', 'high', 'done', '["feature-doc","infrastructure"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1310';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1311', 'Auth0 SPA integration — username/password + Google OAuth', NULL, 'story', 'high', 'done', '["feature-doc","infrastructure"]'::jsonb, sort_n, eid),
       ('BACK-1312', 'CI/CD — GitHub Actions push to main → build → deploy → health check', NULL, 'story', 'high', 'done', '["feature-doc","infrastructure"]'::jsonb, sort_n+1, eid),
       ('BACK-1313', 'AWS Lightsail — Nginx reverse proxy, PM2 process manager', NULL, 'story', 'high', 'done', '["feature-doc","infrastructure"]'::jsonb, sort_n+2, eid),
       ('BACK-1314', 'SSL — Let''s Encrypt via Certbot with auto-renewal', NULL, 'story', 'high', 'done', '["feature-doc","infrastructure"]'::jsonb, sort_n+3, eid),
       ('BACK-1315', 'Domain migration — obscurekitty.com → cogs.macaroonie.com', NULL, 'story', 'medium', 'done', '["feature-doc","infrastructure"]'::jsonb, sort_n+4, eid)
     ON CONFLICT (key) DO NOTHING;
     sort_n := sort_n + 10;

     -- ═══════════════════════════════════════════════════════════════════════
     -- EPIC 16: Shared Menu Pages
     -- ═══════════════════════════════════════════════════════════════════════
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1320', 'Shared Menu Pages',
       'Password-protected public pages for external reviewers with view/edit mode, price change tracking, and comments.',
       'epic', 'medium', 'done', '["feature-doc","shared-pages"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1320';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1321', 'Public shared page at /share/:slug — no auth required', NULL, 'story', 'medium', 'done', '["feature-doc","shared-pages"]'::jsonb, sort_n, eid),
       ('BACK-1322', 'View and edit modes — read-only or price editing for external reviewers', NULL, 'story', 'medium', 'done', '["feature-doc","shared-pages"]'::jsonb, sort_n+1, eid),
       ('BACK-1323', 'Price change tracking — logged and surfaced in ME History tab', NULL, 'story', 'medium', 'done', '["feature-doc","shared-pages"]'::jsonb, sort_n+2, eid),
       ('BACK-1324', 'Comments — posted via shared links, merged in ME Comments tab', NULL, 'story', 'medium', 'done', '["feature-doc","shared-pages"]'::jsonb, sort_n+3, eid),
       ('BACK-1325', 'Multiple shared links per scenario — separate per franchisee', NULL, 'story', 'low', 'done', '["feature-doc","shared-pages"]'::jsonb, sort_n+4, eid)
     ON CONFLICT (key) DO NOTHING;

     -- Bump backlog sequence past highest seeded key
     PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1400));
   END $$`,

  // ── Step 112: Jira integration columns on bugs + backlog ──────────────
  `DO $$ BEGIN ALTER TABLE mcogs_bugs ADD COLUMN jira_key VARCHAR(50); EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_bugs ADD COLUMN jira_id VARCHAR(50); EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_bugs ADD COLUMN jira_synced_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_bugs ADD COLUMN jira_url VARCHAR(500); EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bugs_jira_key ON mcogs_bugs(jira_key) WHERE jira_key IS NOT NULL`,

  `DO $$ BEGIN ALTER TABLE mcogs_backlog ADD COLUMN jira_key VARCHAR(50); EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_backlog ADD COLUMN jira_id VARCHAR(50); EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_backlog ADD COLUMN jira_synced_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_backlog ADD COLUMN jira_url VARCHAR(500); EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_backlog_jira_key ON mcogs_backlog(jira_key) WHERE jira_key IS NOT NULL`,

  // ── Step 112b: Seed Jira Integration epic + stories ────────────────────
  `DO $$ DECLARE
     eid INTEGER;
     sort_n INTEGER;
   BEGIN
     SELECT COALESCE(MAX(sort_order), 0) + 1 INTO sort_n FROM mcogs_backlog;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1330', 'Jira Integration',
       'Two-way sync between COGS Bugs & Backlog and Jira Cloud. Encrypted credential storage, push/pull individual or bulk, status/priority mapping, Jira badges in UI.',
       'epic', 'high', 'done', '["feature-doc","jira"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1330';
     sort_n := sort_n + 1;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1331', 'Jira credential storage — 4 keys in encrypted config store (base URL, email, token, project key)', NULL, 'story', 'high', 'done', '["feature-doc","jira"]'::jsonb, sort_n, eid),
       ('BACK-1332', 'Jira REST API v3 helper — create/update/get/transition issues, search, comments, test connection', NULL, 'story', 'high', 'done', '["feature-doc","jira"]'::jsonb, sort_n+1, eid),
       ('BACK-1333', 'Jira sync API route — push/pull single + bulk, unlink, status endpoint', NULL, 'story', 'high', 'done', '["feature-doc","jira"]'::jsonb, sort_n+2, eid),
       ('BACK-1334', 'DB migration — jira_key, jira_id, jira_synced_at, jira_url columns on bugs + backlog', NULL, 'story', 'medium', 'done', '["feature-doc","jira"]'::jsonb, sort_n+3, eid),
       ('BACK-1335', 'Settings → AI — Jira config card with test connection button', NULL, 'story', 'medium', 'done', '["feature-doc","jira"]'::jsonb, sort_n+4, eid),
       ('BACK-1336', 'Bugs & Backlog page — Jira badges, sync buttons, bulk sync, per-item push/pull in modals', NULL, 'story', 'high', 'done', '["feature-doc","jira"]'::jsonb, sort_n+5, eid),
       ('BACK-1337', 'System → Jira Sync section — dashboard with linked counts, bulk ops, status mapping reference', NULL, 'story', 'medium', 'done', '["feature-doc","jira"]'::jsonb, sort_n+6, eid)
     ON CONFLICT (key) DO NOTHING;
   END $$`,

  // ── Step 113: Link orphan stories/tasks to relevant epics ─────────────
  `DO $$ DECLARE
     rep_eid INTEGER;
     sort_n  INTEGER;
   BEGIN
     SELECT COALESCE(MAX(sort_order), 0) + 1 INTO sort_n FROM mcogs_backlog;

     -- Create "Reports & Analytics" epic for BACK-1002 + BACK-1008
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1340', 'Reports & Analytics',
       'Reporting features: missing price quotes report, cross-market COGS comparison, coverage reports.',
       'epic', 'medium', 'backlog', '["reports"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;
     SELECT id INTO rep_eid FROM mcogs_backlog WHERE key = 'BACK-1340';

     -- Link BACK-1002 (Missing Price Quotes Report) → Reports & Analytics
     UPDATE mcogs_backlog SET epic_id = rep_eid, updated_at = NOW()
     WHERE key = 'BACK-1002' AND epic_id IS NULL;

     -- Link BACK-1008 (Reports Page) → Reports & Analytics
     UPDATE mcogs_backlog SET epic_id = rep_eid, updated_at = NOW()
     WHERE key = 'BACK-1008' AND epic_id IS NULL;

     -- Link BACK-1009 (AI get_menu_cogs bug) → Pepper AI Assistant (BACK-1190)
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1190'), updated_at = NOW()
     WHERE key = 'BACK-1009' AND epic_id IS NULL;

     -- Link BACK-1005 (Voice Tier 1) → Pepper AI Assistant
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1190'), updated_at = NOW()
     WHERE key = 'BACK-1005' AND epic_id IS NULL;

     -- Link BACK-1006 (Voice Tier 2) → Pepper AI Assistant
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1190'), updated_at = NOW()
     WHERE key = 'BACK-1006' AND epic_id IS NULL;

     -- Link BACK-1001 (Category Groups cleanup) → Configuration Hub (BACK-1160)
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1160'), updated_at = NOW()
     WHERE key = 'BACK-1001' AND epic_id IS NULL;

     -- Link BACK-1014 (Help: Brand Partners) → Configuration Hub
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1160'), updated_at = NOW()
     WHERE key = 'BACK-1014' AND epic_id IS NULL;

     -- Link BACK-1015 (Help: base currency) → Configuration Hub
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1160'), updated_at = NOW()
     WHERE key = 'BACK-1015' AND epic_id IS NULL;

     -- Link BACK-1003 (Auth0 JWT) → Auth & Infrastructure (BACK-1310)
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1310'), updated_at = NOW()
     WHERE key = 'BACK-1003' AND epic_id IS NULL;

     -- Link BACK-1007 (Lightsail Upgrade) → Auth & Infrastructure
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1310'), updated_at = NOW()
     WHERE key = 'BACK-1007' AND epic_id IS NULL;

     -- Link BACK-1016 (Help: Recipe variations) → Recipe Builder (BACK-1120)
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1120'), updated_at = NOW()
     WHERE key = 'BACK-1016' AND epic_id IS NULL;

     -- Link BACK-1401 (Update button scenario) → Menu Builder & Menu Engineer (BACK-1140)
     UPDATE mcogs_backlog SET epic_id = (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1140'), updated_at = NOW()
     WHERE key = 'BACK-1401' AND epic_id IS NULL;

     -- BACK-1009 was already fixed in a previous session — mark as done
     UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
     WHERE key = 'BACK-1009' AND status != 'done';

     -- Bump sequence past new key
     PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1400));
   END $$`,

  // ── Step 114: Doc Library tables ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_doc_categories (
     id          SERIAL PRIMARY KEY,
     name        VARCHAR(200) NOT NULL,
     sort_order  INTEGER DEFAULT 0,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS mcogs_docs (
     id              SERIAL PRIMARY KEY,
     title           VARCHAR(500) NOT NULL,
     slug            VARCHAR(500) NOT NULL UNIQUE,
     description     TEXT,
     content_html    TEXT NOT NULL DEFAULT '',
     content_type    VARCHAR(20) NOT NULL DEFAULT 'wysiwyg',
     location        VARCHAR(20) NOT NULL DEFAULT 'help',
     category_id     INTEGER REFERENCES mcogs_doc_categories(id) ON DELETE SET NULL,
     skip_sanitize   BOOLEAN NOT NULL DEFAULT FALSE,
     is_published    BOOLEAN NOT NULL DEFAULT TRUE,
     created_by      TEXT,
     updated_by      TEXT,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_docs_location ON mcogs_docs(location)`,
  `CREATE INDEX IF NOT EXISTS idx_docs_slug ON mcogs_docs(slug)`,

  // ── Step 114b: RBAC — seed docs feature ────────────────────────────────────
  `DO $$ DECLARE r RECORD; BEGIN
     FOR r IN SELECT id, name FROM mcogs_roles LOOP
       INSERT INTO mcogs_role_permissions (role_id, feature, access)
       VALUES (r.id, 'docs',
         CASE WHEN r.name = 'Admin' THEN 'write' ELSE 'read' END)
       ON CONFLICT (role_id, feature) DO NOTHING;
     END LOOP;
   END $$`,

  // ── Step 115: Seed backlog — Pepper tongue tab + TS build fixes ───────────
  `DO $$ DECLARE sort_n INTEGER;
   BEGIN
     SELECT COALESCE(MAX(sort_order), 0) + 1 INTO sort_n FROM mcogs_backlog;

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES
       ('BACK-1410', 'Pepper button redesign — floating tongue tab on bottom edge',
        'Moved Pepper AI button from sidebar to a floating tongue tab centered on the bottom screen edge. Small rounded-top pill with Pepper icon + name. Toggles the Pepper panel open/closed. Uses accent green when active, subtle border when inactive. Removed old sidebar Pepper button entirely.',
        'improvement', 'medium', 'done', '["ui","pepper"]'::jsonb, sort_n),
       ('BACK-1411', 'Fix TS build errors — DocLibrary unused handleEdit, HelpPage type narrowing',
        'Removed unused handleEdit function from DocLibrary.tsx (TS6133). Fixed HelpPage.tsx type narrowing issue where mode toggle buttons had unreachable comparisons (TS2367) — hardcoded the active/inactive styles in each branch since the mode is already known.',
        'task', 'low', 'done', '["bugfix","typescript"]'::jsonb, sort_n + 1)
     ON CONFLICT (key) DO NOTHING;

     -- Bump backlog sequence past new keys
     PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1411));
   END $$`,

  // ── Step 116: Seed Localization epic + stories ─────────────────────────────
  `DO $$ DECLARE sort_n INTEGER; eid INTEGER;
   BEGIN
     SELECT COALESCE(MAX(sort_order), 0) + 1 INTO sort_n FROM mcogs_backlog;

     -- Epic
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1350', 'Localization — Multi-Language Support',
       'Translate ingredient names, recipes, sales items, categories, and all customer-facing content into any language. Separate layer for UI localisation (buttons, labels, navigation). ~16–19 days estimated.',
       'epic', 'high', 'backlog', '["localization","i18n"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;

     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1350';

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id)
     VALUES
       ('BACK-1351', 'Foundation — mcogs_languages table + /api/languages CRUD + Settings → Localisation tab',
        'Create languages table (code, name, is_default, is_rtl). Build CRUD API. Add Localisation tab to Settings/Configuration page. ~3 days.',
        'story', 'high', 'backlog', '["localization","backend"]'::jsonb, sort_n+1, eid),
       ('BACK-1352', 'Translation tables — 11 per-entity translation tables in migrate.js',
        'Create mcogs_ingredient_translations, mcogs_recipe_translations, mcogs_sales_item_translations, mcogs_modifier_group_translations, mcogs_modifier_option_translations, mcogs_combo_step_translations, mcogs_combo_step_option_translations, mcogs_category_translations, mcogs_vendor_translations, mcogs_price_level_translations, mcogs_menu_translations. Add sub-routes on each entity router. ~4 days.',
        'story', 'high', 'backlog', '["localization","backend","database"]'::jsonb, sort_n+2, eid),
       ('BACK-1353', 'Backend resolution — resolveLanguage middleware + COALESCE queries',
        'Add resolveLanguage middleware that reads X-Language header. Update all entity GET endpoints to use COALESCE chain: requested lang → country default → system default → base (English) column. ~4 days.',
        'story', 'high', 'backlog', '["localization","backend"]'::jsonb, sort_n+3, eid),
       ('BACK-1354', 'Frontend wiring — X-Language header in useApi.ts + TranslationEditor component',
        'Inject X-Language header in useApi.ts from user preference. Build TranslationEditor component for detail panels — inline editing of translated names/descriptions per language. ~4 days.',
        'story', 'high', 'backlog', '["localization","frontend"]'::jsonb, sort_n+4, eid),
       ('BACK-1355', 'UI localisation — react-i18next setup + locale JSON files + LanguageSwitcher + RTL',
        'Install react-i18next + i18next-http-backend. Extract static labels into locale JSON per page namespace. Add LanguageSwitcher component in app header. Add RTL layout variants for Arabic/Hebrew. Pilot: English + French. ~4–5 days.',
        'story', 'high', 'backlog', '["localization","frontend","i18n"]'::jsonb, sort_n+5, eid)
     ON CONFLICT (key) DO NOTHING;

     -- Bump backlog sequence past new keys
     PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1355));
   END $$`,

  // ── Step 117: Memory consolidation tables ──────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_memory_daily (
    id            SERIAL PRIMARY KEY,
    user_sub      VARCHAR(200) NOT NULL,
    summary_date  DATE NOT NULL,
    summary       TEXT NOT NULL,
    topics        JSONB NOT NULL DEFAULT '[]',
    tools_used    JSONB NOT NULL DEFAULT '[]',
    token_count   INTEGER,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_sub, summary_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_daily_sub_date ON mcogs_memory_daily(user_sub, summary_date DESC)`,

  `CREATE TABLE IF NOT EXISTS mcogs_memory_monthly (
    id              SERIAL PRIMARY KEY,
    user_sub        VARCHAR(200) NOT NULL,
    summary_month   DATE NOT NULL,
    summary         TEXT NOT NULL,
    themes          JSONB NOT NULL DEFAULT '[]',
    focus_shifts    JSONB NOT NULL DEFAULT '[]',
    is_quarterly    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_sub, summary_month)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memory_monthly_sub ON mcogs_memory_monthly(user_sub, summary_month DESC)`,

  // ── Step 118: FAQ knowledge base ───────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_faq (
    id            SERIAL PRIMARY KEY,
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    category      VARCHAR(100) NOT NULL DEFAULT 'General',
    tags          JSONB NOT NULL DEFAULT '[]',
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_published  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_faq_category ON mcogs_faq(category)`,
  `CREATE INDEX IF NOT EXISTS idx_faq_published ON mcogs_faq(is_published) WHERE is_published = TRUE`,

  // ── Step 118b: Seed FAQ entries ────────────────────────────────────────────
  `DO $$ BEGIN
    INSERT INTO mcogs_faq (question, answer, category, tags, sort_order) VALUES

    -- ═══ Getting Started ═══════════════════════════════════════════════════
    ('How do I add my first ingredient?',
     'Go to Inventory → Ingredients tab → click "+ Add Ingredient". Enter the name, select a category and base unit (e.g. kg, litre), optionally set waste % and prep conversion. Save, then add a price quote from a vendor on the Quotes tab.',
     'Getting Started', '["ingredient","create","beginner"]'::jsonb, 1),

    ('How do I create a recipe?',
     'Go to Recipes → click "+ New Recipe". Enter the name, category, yield quantity and yield unit. Then add line items — each line is an ingredient (or sub-recipe) with a prep quantity and unit. The COGS is calculated automatically from vendor quotes.',
     'Getting Started', '["recipe","create","beginner"]'::jsonb, 2),

    ('How do I set up a new market/country?',
     'Go to Configuration → scroll to the Markets/Countries section → click "+ Add Country". Enter the country name, currency code (e.g. GBP), currency symbol (e.g. £), and exchange rate vs USD. Set a default price level and tax rate.',
     'Getting Started', '["market","country","create","beginner"]'::jsonb, 3),

    ('What is a price level?',
     'A price level represents a pricing tier such as "Dine In" or "Delivery". Each menu item can have different sell prices per price level. One price level is marked as the default per country. Manage them in Configuration → Price Levels.',
     'Getting Started', '["price-level","concept"]'::jsonb, 4),

    ('How do I set up tax rates?',
     'Go to Configuration → find your country → Tax Rates section. Add tax rates (e.g. "Standard VAT 20%"). Then assign which tax rate applies to which price level via the Country Level Tax mapping. One rate per country can be marked as default.',
     'Getting Started', '["tax","vat","setup"]'::jsonb, 5),

    -- ═══ Ingredients & Vendors ════════════════════════════════════════════
    ('How do I add a vendor?',
     'Go to Inventory → Vendors tab → click "+ Add Vendor". Enter the vendor name and select the country/market they supply. You can also add contact details, email, phone, and notes.',
     'Ingredients & Vendors', '["vendor","create"]'::jsonb, 10),

    ('How do I set a preferred vendor for an ingredient?',
     'Go to Inventory → Quotes tab. Find the ingredient, then click the star icon next to the vendor quote you want to set as preferred for that market. Each ingredient can have one preferred vendor per country.',
     'Ingredients & Vendors', '["vendor","preferred","quote"]'::jsonb, 11),

    ('What does waste % mean?',
     'Waste % is the proportion of an ingredient lost during preparation (peeling, trimming, bones, etc.). If chicken wings have 15% waste, the system assumes you need to purchase 15% more than the recipe quantity to account for unusable portions. This increases the effective cost per usable unit.',
     'Ingredients & Vendors', '["waste","cost","ingredient"]'::jsonb, 12),

    ('How does prep conversion work?',
     'Prep conversion translates between the unit you buy in (base unit, e.g. kg) and the unit you use in recipes (prep unit, e.g. pieces). If 1 kg = 20 pieces, set prep unit to "piece" and conversion factor to 20. Recipes can then specify quantities in pieces while costs are calculated from the kg price.',
     'Ingredients & Vendors', '["prep","conversion","unit"]'::jsonb, 13),

    ('Why is my ingredient showing no cost?',
     'An ingredient shows no cost when it has no active price quote from a preferred vendor in the selected market. Check: 1) Does the ingredient have at least one active quote? 2) Is a preferred vendor set for the target country? 3) Is the quote marked as active (not disabled)?',
     'Ingredients & Vendors', '["cost","troubleshoot","quote"]'::jsonb, 14),

    ('How do I import ingredients from a spreadsheet?',
     'Go to Configuration → Import section (or ask Pepper to start an import). Upload a CSV or Excel file. The AI will extract ingredients, vendors, quotes, and recipes. Review the extracted data, map categories and vendors, then execute. Download the template from the Import page for the correct format.',
     'Ingredients & Vendors', '["import","spreadsheet","csv","excel"]'::jsonb, 15),

    -- ═══ Recipes ══════════════════════════════════════════════════════════
    ('How do I add a sub-recipe to a recipe?',
     'In the recipe editor, click "+ Add Item" and switch the type from "Ingredient" to "Recipe". Search for the sub-recipe by name. Set the quantity (how many portions of the sub-recipe this recipe uses). Sub-recipe costs cascade — changes to the sub-recipe automatically update the parent.',
     'Recipes', '["recipe","sub-recipe","nested"]'::jsonb, 20),

    ('What is yield qty/unit?',
     'Yield is how much finished product one batch of the recipe produces. For example, a soup recipe might yield 5 litres, or a dough recipe might yield 20 portions. COGS per portion = total ingredient cost / yield qty. Set yield unit to match how you serve the item (portions, kg, litres, etc.).',
     'Recipes', '["recipe","yield","portion","cost"]'::jsonb, 21),

    ('Why is my recipe COGS showing as 0?',
     'Recipe COGS is 0 when one or more ingredients lack a preferred vendor quote. Check each ingredient in the recipe: does it have an active, preferred quote for the target market? Also check that yield qty is not 0 (division by zero returns 0 cost per portion).',
     'Recipes', '["recipe","cogs","troubleshoot","zero"]'::jsonb, 22),

    ('How do market variations work?',
     'Market variations let you substitute different ingredients for specific countries. For example, a recipe might use "UK Flour" in the UK market and "US All-Purpose Flour" in the US. Create a variation in the recipe editor by selecting a country and specifying alternative ingredients. The system uses the variation when calculating COGS for that market.',
     'Recipes', '["recipe","market","variation","country"]'::jsonb, 23),

    ('How do price level variations work?',
     'Price level (PL) variations let you use different ingredients based on the price level (e.g. Dine In vs Delivery). Create a PL variation in the recipe editor. Priority: PL variation > market variation > global recipe. Use "Copy to Global" to promote a PL variation to the base recipe.',
     'Recipes', '["recipe","price-level","variation"]'::jsonb, 24),

    -- ═══ Menus & COGS ═════════════════════════════════════════════════════
    ('How do I create a menu?',
     'Go to Menus → Menu Builder tab → click "+ New Menu". Enter a name and select the country/market. The menu will use that country''s currency and tax rates. Then add sales items to the menu from the catalog.',
     'Menus & COGS', '["menu","create"]'::jsonb, 30),

    ('How do I add items to a menu?',
     'In the Menu Builder, select a menu, then click "+ Add Item". Search for sales items from the catalog. Set the display name, sort order, and sell prices per price level. Items must exist in the Sales Items catalog first.',
     'Menus & COGS', '["menu","item","add"]'::jsonb, 31),

    ('What does COGS % mean?',
     'COGS % (Cost of Goods Sold percentage) = (food cost / sell price) × 100. A COGS% of 30% means 30p of every £1 in revenue goes to food cost. Lower is better for profitability. The app colour-codes: green (≤ target), amber (target to +10%), red (> target + 10%). Default targets are configurable in Configuration → COGS Thresholds.',
     'Menus & COGS', '["cogs","percentage","concept","profitability"]'::jsonb, 32),

    ('How are menu prices stored?',
     'All prices are stored in USD as the base currency. When displaying, prices are converted using the country''s exchange rate. The formula: display price = USD price × (country rate / target currency rate). When saving, the reverse: USD price = display price / exchange rate.',
     'Menus & COGS', '["price","currency","usd","conversion"]'::jsonb, 33),

    ('Why are my menu prices showing 0?',
     'Menu prices show 0 when sell prices have not been set for the menu items at the relevant price level. Go to Menu Builder → select the menu → check the Price columns. Enter sell prices for each item at each price level. Also ensure the country has a default price level assigned.',
     'Menus & COGS', '["price","zero","troubleshoot"]'::jsonb, 34),

    ('How does currency conversion work?',
     'The system uses USD as the base currency with exchange rates per country (synced from the Frankfurter API). Display rate = country rate / target currency rate. For example, if GBP rate is 0.79 and you view in GBP, prices are multiplied by 0.79. Exchange rates can be synced or manually overridden in Configuration.',
     'Menus & COGS', '["currency","exchange","rate","conversion"]'::jsonb, 35),

    -- ═══ Menu Engineer / Scenarios ════════════════════════════════════════
    ('How do I use the Sales Mix Generator?',
     'In Menu Engineer, click "Generate Mix". Set the total weekly covers and the distribution per category (e.g. 40% Mains, 25% Starters). The generator distributes quantities across items within each category. Use the per-row fill button (=X%) to auto-calculate remaining percentages.',
     'Menu Engineer', '["scenario","mix","generator","quantity"]'::jsonb, 40),

    ('How do I save a scenario?',
     'In Menu Engineer, click the scenario button in the toolbar → the Scenario Modal opens. Enter a name and click Save. Scenarios store: quantities, price overrides, cost overrides, notes, and change history. Load a saved scenario to restore all values.',
     'Menu Engineer', '["scenario","save","load"]'::jsonb, 41),

    ('How do I push scenario prices to the live menu?',
     'After making price overrides in a scenario (type new prices in the Price cells), click "→ Menu" in the toolbar. This permanently writes your scenario prices to the actual menu. A confirmation dialog shows how many overrides will be pushed. This action cannot be undone.',
     'Menu Engineer', '["scenario","push","price","override"]'::jsonb, 42),

    ('What does the What If tool do?',
     'The What If tool applies a percentage change to all prices and/or all costs in one step. Click "What If" → enter a price % change (e.g. +5%) and/or cost % change (e.g. +3%) → Apply. The changes are applied as overrides — they do not affect the live menu until you push them.',
     'Menu Engineer', '["scenario","whatif","percentage"]'::jsonb, 43),

    ('How do I share a menu with an external reviewer?',
     'In Menus → Shared Links tab, click "+ New Link". Set a password, choose view or edit mode, optionally pin to a scenario and set an expiry date. Share the generated URL with the reviewer. In edit mode, their price changes are tracked and visible in the Menu Engineer History tab.',
     'Menu Engineer', '["share","link","external","reviewer"]'::jsonb, 44),

    -- ═══ Sales Items & POS ════════════════════════════════════════════════
    ('What are the different sales item types?',
     'Four types: 1) Recipe — linked to a recipe, COGS from ingredient costs. 2) Ingredient — linked directly to an ingredient. 3) Manual — no link, cost entered manually. 4) Combo — structured bundle with steps and options, COGS = sum of step costs. All types can have modifier groups attached.',
     'Sales Items', '["sales-item","type","recipe","ingredient","manual","combo"]'::jsonb, 50),

    ('How do combos work?',
     'A combo has ordered steps (e.g. Step 1: Choose a drink, Step 2: Choose a side). Each step has options the customer can select from. Options can be recipes, ingredients, or manual-cost items. COGS is calculated from the selected options. Manage combos in Sales Items → Combos tab.',
     'Sales Items', '["combo","step","option","structure"]'::jsonb, 51),

    ('How do modifier groups work?',
     'Modifier groups are reusable add-on lists (e.g. "Extra Toppings", "Sauce Options") that can be attached to any sales item or combo step option. Each group has min/max selection rules and a list of options with optional price add-ons. Manage in Sales Items → Modifiers tab.',
     'Sales Items', '["modifier","group","addon"]'::jsonb, 52),

    ('What is auto_show on modifiers?',
     'auto_show controls whether a modifier group appears automatically inline when ordering (true) or is hidden behind a "Customise" button (false). For example, cooking temperature might be auto_show (always ask), while extra toppings might be hidden until requested. Set per attachment, or use the group default.',
     'Sales Items', '["modifier","auto-show","pos"]'::jsonb, 53),

    -- ═══ Stock Manager ════════════════════════════════════════════════════
    ('How do I create a purchase order?',
     'Go to Stock Manager → Purchase Orders tab → "+ New PO". Select a vendor and location. Add items — the system auto-populates price and unit from the vendor''s active quotes. If no quote exists, enter manually and optionally save as a new quote. Submit when ready.',
     'Stock Manager', '["purchase-order","create","po"]'::jsonb, 60),

    ('How does goods receiving work?',
     'When goods arrive, go to Stock Manager → Goods In tab → create a GRN (linked to PO or standalone). Enter the quantities actually received. On confirm, the system: 1) Creates stock movements, 2) Updates stock levels, 3) Updates PO received quantities.',
     'Stock Manager', '["goods-received","grn","receive"]'::jsonb, 61),

    ('How do I log waste?',
     'Go to Stock Manager → Waste tab. Select ingredient, enter qty wasted, choose a reason code (Expired, Damaged, Spillage, etc.), add notes. Each waste entry deducts from stock levels and creates an audit trail. Manage reason codes in the right panel.',
     'Stock Manager', '["waste","log","reason"]'::jsonb, 62),

    ('How do stock transfers work?',
     'Go to Stock Manager → Transfers tab → "+ New Transfer". Select source and destination stores, add items with quantities. Dispatch (deducts from source) → Confirm at destination (adds to destination). Cancel reverses the dispatch if needed.',
     'Stock Manager', '["transfer","stock","move"]'::jsonb, 63),

    ('How does stocktake approval adjust stock?',
     'A stocktake compares expected stock (system qty) against counted stock (physical count). When approved, the system: 1) Calculates variance per item, 2) Creates adjustment movements for any differences, 3) Sets stock levels to match the counted quantities.',
     'Stock Manager', '["stocktake","count","variance","adjust"]'::jsonb, 64),

    -- ═══ Allergens & HACCP ════════════════════════════════════════════════
    ('What are the EU/UK FIC 14 allergens?',
     'The 14 regulated allergens: Celery, Cereals (gluten), Crustaceans, Eggs, Fish, Lupin, Milk, Molluscs, Mustard, Nuts, Peanuts, Sesame, Soya, Sulphur dioxide. Each ingredient can be marked as Contains, May Contain, or Free From for each allergen. The allergen matrix shows this across all ingredients or menu items.',
     'Allergens & HACCP', '["allergen","fic","eu","uk","14"]'::jsonb, 70),

    ('How do I set allergen status for an ingredient?',
     'Go to Allergens → Inventory Matrix. Find the ingredient row and click the cell for each allergen to cycle through: Contains (red C), May Contain (amber M), Free From (green F), or Unknown (blank). Changes save automatically. You can also add free-text allergen notes per ingredient.',
     'Allergens & HACCP', '["allergen","ingredient","set","matrix"]'::jsonb, 71),

    ('How do I log a temperature reading?',
     'Go to HACCP → select the location → Equipment tab. Click on a piece of equipment to see its log. Click "+ Log Temperature" — enter the temperature and any notes. Readings are timestamped and stored for compliance reporting.',
     'Allergens & HACCP', '["haccp","temperature","log","equipment"]'::jsonb, 72),

    -- ═══ Configuration & Admin ════════════════════════════════════════════
    ('How do I approve a new user?',
     'When someone registers via Auth0, they land in "pending" status. Go to Configuration → Users & Roles. Find the pending user and click Approve. Assign them a role (Admin, Operator, or Viewer). Optionally restrict their market scope via brand partner assignment.',
     'Configuration', '["user","approve","pending","role"]'::jsonb, 80),

    ('How do I set up RBAC roles?',
     'Go to Configuration → Users & Roles → Roles tab. Three system roles exist (Admin, Operator, Viewer). Create custom roles by clicking "+ New Role" and setting permission levels (none/read/write) for each of the 21 features. Assign roles to users in the Users tab.',
     'Configuration', '["rbac","role","permission","access"]'::jsonb, 81),

    ('How do I restrict a user to specific markets?',
     'In Configuration → Users & Roles, find the user and click the market scope button. Assign brand partners — the user will only see data from countries linked to those brand partners. Leave empty for unrestricted access (Admin default).',
     'Configuration', '["user","market","scope","restrict","brand"]'::jsonb, 82),

    ('What is the developer (is_dev) flag?',
     'The is_dev flag gives a user access to developer-only features: System → Test Data (load/clear test data) and System → CLAUDE.md (project documentation viewer). It is separate from RBAC roles — any role can have dev access. Toggle via the </> button in Users & Roles.',
     'Configuration', '["developer","dev","flag","system"]'::jsonb, 83),

    -- ═══ Pepper AI ════════════════════════════════════════════════════════
    ('What can Pepper do?',
     'Pepper is an AI assistant with 96 tools. It can: read and write ingredients, recipes, menus, vendors, quotes, and categories; manage allergens, HACCP, locations, markets, and brand partners; run the import wizard; export data to Excel; search the web; read/write GitHub; query the audit log; search the FAQ; and remember things you tell it across sessions.',
     'Pepper AI', '["pepper","ai","tools","capabilities"]'::jsonb, 90),

    ('How do I teach Pepper to remember something?',
     'Say "remember that I always want prices in GBP" or "note that John handles UK allergens". Pepper saves this as a pinned note that persists across all future sessions. Say "what do you remember?" to see all notes, or "forget the note about GBP" to delete one.',
     'Pepper AI', '["pepper","memory","remember","note"]'::jsonb, 91),

    ('How do I export data to Excel via Pepper?',
     'Ask Pepper "export ingredients to Excel" or "download a full export". Pepper generates an .xlsx workbook with sheets for ingredients, price quotes, recipes, and menus — filtered to your market scope. The file downloads automatically in your browser.',
     'Pepper AI', '["pepper","export","excel","download"]'::jsonb, 92),

    ('Can Pepper search the web?',
     'Yes, if a Brave Search API key is configured in Settings → AI. Ask Pepper to "search the web for..." and it will use Brave Search (or DuckDuckGo fallback). Pepper only searches when you explicitly ask — it does not search autonomously.',
     'Pepper AI', '["pepper","web","search","brave"]'::jsonb, 93),

    ('What is the monthly token limit?',
     'Each user has a monthly token allowance (configurable in Settings → AI, 0 = unlimited). The billing period runs 25th to 24th. Usage is shown as a progress bar in the Pepper panel header. When exceeded, Pepper returns a 429 error until the next period.',
     'Pepper AI', '["pepper","token","limit","usage","billing"]'::jsonb, 94),

    -- ═══ Import ═══════════════════════════════════════════════════════════
    ('What file formats does import support?',
     'CSV, TXT, XLSX, XLS, XLSB, XLSM, DOCX, and PPTX files up to 10 MB. The AI extraction engine handles any column layout — it maps your data to the COGS schema automatically. Download the template from the Import page for the recommended format.',
     'Import', '["import","format","csv","excel","file"]'::jsonb, 100),

    ('How does the AI import wizard work?',
     'Upload a file → AI extracts structured data (ingredients, vendors, quotes, recipes, menus) → Review in tabbed tables → Map categories and vendors to existing or new entries → Execute to write to the database. Each step validates and allows corrections before committing.',
     'Import', '["import","wizard","ai","pipeline"]'::jsonb, 101),

    ('What if my import has duplicate ingredients?',
     'The wizard detects duplicates by name matching. For each duplicate, you choose: Create (new entry), Skip (ignore), or Override (update existing record). Override is useful for updating prices or categories without creating duplicates.',
     'Import', '["import","duplicate","override","skip"]'::jsonb, 102)

    ON CONFLICT DO NOTHING;
  END $$`,

  // ── Step 118c: Additional deep-dive FAQ entries ────────────────────────────
  `DO $$ BEGIN
    INSERT INTO mcogs_faq (question, answer, category, tags, sort_order) VALUES

    -- ═══ Deeper Menus & COGS ══════════════════════════════════════════════
    ('How do I set sell prices per price level?',
     'In Menu Builder, select a menu and click on an item. The right panel shows price fields for each price level (e.g. Dine In, Delivery). Enter the gross sell price — the system calculates the net price using the country''s tax rate. You can also set default prices on the Sales Items page under the Details tab, which apply unless overridden per-menu.',
     'Menus & COGS', '["price","price-level","sell","menu"]'::jsonb, 36),

    ('How do I compare COGS across markets?',
     'Use the Dashboard — each menu tile shows COGS% per price level. For detailed comparison, go to Menu Engineer, select a menu, and view the COGS% column. Switch between menus to compare. You can also ask Pepper: "compare wings COGS between UK and India" and it will query both menus.',
     'Menus & COGS', '["cogs","compare","market","cross-market"]'::jsonb, 37),

    ('What is the difference between gross and net price?',
     'Gross price includes tax (what the customer pays). Net price excludes tax (your revenue before tax). COGS% is calculated against net price: (food cost / net sell price) × 100. The tax rate is determined by the country + price level tax mapping in Configuration.',
     'Menus & COGS', '["price","gross","net","tax"]'::jsonb, 38),

    -- ═══ Deeper Scenarios ═════════════════════════════════════════════════
    ('How do shared link comments work?',
     'When you create a shared link in edit mode, external reviewers can post comments and change prices. Comments appear in the Menu Engineer → Notes/History panel → Comments tab, merged from all active shared links for that menu/scenario. Replies from ME are routed back to the correct shared view. Price changes appear in the History tab under "Shared View Edits".',
     'Menu Engineer', '["share","comment","reviewer","history"]'::jsonb, 45),

    ('How do category collapsing and compact view work in Menu Engineer?',
     'In Menu Engineer, items are grouped by category. Click a category header row to collapse/expand its items. Use the "All" button next to the Item column header to collapse or expand all categories at once. Compact view reduces column widths and hides the Revenue column for a denser spreadsheet-like layout.',
     'Menu Engineer', '["scenario","category","collapse","compact"]'::jsonb, 46),

    ('How do per-level quantities work in All Levels view?',
     'When viewing "All Levels" in Menu Engineer, each price level gets its own Qty column. This lets you model different sales volumes per channel — e.g. 100 Dine In, 50 Delivery. The COGS% for each level is calculated independently. Total COGS% uses the weighted sum across all levels.',
     'Menu Engineer', '["scenario","quantity","all-levels","per-level"]'::jsonb, 47),

    ('What is the Smart Scenario feature?',
     'Smart Scenario uses Claude AI to suggest price and cost changes based on your targets. Click the Smart Scenario button, describe your goal (e.g. "reduce overall COGS to 28%"), and the AI proposes specific item-level price or cost adjustments. Review and accept/reject each suggestion before applying.',
     'Menu Engineer', '["scenario","smart","ai","suggestion"]'::jsonb, 48),

    -- ═══ Deeper Sales Items ═══════════════════════════════════════════════
    ('How do I set default prices for a sales item?',
     'Go to Sales Items → select an item → Details tab. Scroll to the price section showing each price level. Enter the default sell price per level. These defaults apply when the item is added to any menu, but can be overridden per-menu in the Menu Builder. Market-level defaults are not yet supported — defaults are global.',
     'Sales Items', '["sales-item","default","price"]'::jsonb, 54),

    ('How do I manage market visibility for sales items?',
     'Select a sales item → Markets tab. Toggle each market on/off with checkboxes. When a market is disabled, the item won''t appear in menus for that country. Changes save automatically. Use bulk operations to update visibility for multiple items at once.',
     'Sales Items', '["sales-item","market","visibility","toggle"]'::jsonb, 55),

    ('How do I duplicate a combo or modifier group?',
     'In Sales Items → Combos tab, click the duplicate icon on a combo row. This creates a copy with all steps and options. For modifier groups, go to Modifiers tab → click the duplicate icon on a group row. The copy includes all options with their prices and settings.',
     'Sales Items', '["combo","modifier","duplicate","copy"]'::jsonb, 56),

    -- ═══ Deeper Stock Manager ═════════════════════════════════════════════
    ('What are stores (centres) and how do I set them up?',
     'Stores are sub-locations within a physical location — e.g. kitchen, bar, walk-in fridge. Go to Configuration → Locations → select a location → Centres section. Add centres to track stock at a granular level. The "is_store_itself" flag marks the main location as its own store.',
     'Stock Manager', '["store","centre","location","sub-location"]'::jsonb, 65),

    ('How do I create an invoice from a GRN?',
     'After confirming a Goods Received Note, go to Stock Manager → Invoices tab → click "+ From GRN". Select the confirmed GRN — the invoice auto-populates with the received items and prices. Review, adjust if needed, then save. The invoice starts in draft status.',
     'Stock Manager', '["invoice","grn","create","from-grn"]'::jsonb, 66),

    ('What are order templates?',
     'Order templates save a standard set of items for recurring purchase orders (e.g. weekly wing restock). Create a PO, then save it as a template. Next time, load the template to pre-populate a new PO with the same items and quantities. Edit as needed before submitting.',
     'Stock Manager', '["purchase-order","template","reorder"]'::jsonb, 67),

    ('How do credit notes work?',
     'Credit notes record returns or price adjustments from vendors. Create one in Stock Manager → (via invoices or standalone). Add items with quantities and values. Submit → Approve → Apply. When applied, credit notes can adjust stock levels and create a financial record for reconciliation.',
     'Stock Manager', '["credit-note","return","vendor","adjustment"]'::jsonb, 68),

    -- ═══ Deeper Configuration ═════════════════════════════════════════════
    ('How do I switch database modes (local vs standalone)?',
     'Go to System → Database (admin only). You can switch between local PostgreSQL (same server as the API) and standalone (remote, e.g. AWS RDS). Test the connection first, then save. Use "Migrate Data & Switch" to copy all data from the current database to a new target in one operation.',
     'Configuration', '["database","mode","local","standalone","rds"]'::jsonb, 84),

    ('How do COGS threshold colours work?',
     'COGS thresholds determine the colour coding: Green = COGS% at or below target (excellent). Amber = between target and target + 10% (acceptable). Red = above target + 10% (alert). Configure the target percentages in Configuration → COGS Thresholds. Default is typically 28-32%.',
     'Configuration', '["cogs","threshold","colour","target"]'::jsonb, 85),

    ('How do brand partners and market scope work?',
     'Brand partners represent franchise brands linked to specific markets/countries. Users can be restricted to see only data from their assigned brand partners'' markets. This creates market-scoped views — a UK operator only sees UK menus, vendors, and quotes. Assign via Configuration → Users & Roles.',
     'Configuration', '["brand","partner","market","scope","rbac"]'::jsonb, 86),

    -- ═══ Deeper Import ════════════════════════════════════════════════════
    ('How do I use the import template?',
     'Download the template from Configuration → Import → "Download template". It contains sheets for Ingredients, Vendors, Price Quotes, Recipes, Menus, and Menu Items. Fill in your data following the column headers. Upload the file and the AI will map your data to the COGS schema. Unit names are auto-matched (e.g. "pound" → kg).',
     'Import', '["import","template","download","format"]'::jsonb, 103),

    ('Can I import menus and menu items?',
     'Yes. The import template has two sheets: Menus (menu_name, country, description) and Menu Items (menu_name, item_type, item_name, display_name, sort_order). The import wizard creates the menus and links items from your imported recipes/ingredients. Existing menus with the same name are detected as duplicates.',
     'Import', '["import","menu","menu-item"]'::jsonb, 104),

    ('How does Pepper handle imports?',
     'Paste or upload data directly in the Pepper chat. Pepper calls the import pipeline, extracts structured data via AI, and returns a link to the Import Wizard pre-loaded with your data. Click the link to review, map categories/vendors, and execute. This skips the manual upload step.',
     'Import', '["import","pepper","ai","chat"]'::jsonb, 105),

    -- ═══ Deeper Allergens ═════════════════════════════════════════════════
    ('How does the allergen matrix work for combo items?',
     'For combo-type sales items, the allergen system traces the full ingredient chain: direct ingredient options from combo step options, plus recipe options (then their ingredients via recipe items). The matrix aggregates allergen status across all possible paths through the combo.',
     'Allergens & HACCP', '["allergen","combo","matrix","chain"]'::jsonb, 73),

    ('What are allergen notes?',
     'Each ingredient and menu item has an optional free-text allergen notes field. Use it for information that doesn''t fit the 14-allergen matrix — e.g. "May contain traces of tree nuts due to shared facility" or "Vegan-certified supplier". Notes are editable inline in both the Inventory and Menu allergen matrices.',
     'Allergens & HACCP', '["allergen","notes","free-text"]'::jsonb, 74),

    -- ═══ Troubleshooting ══════════════════════════════════════════════════
    ('Why am I getting a 403 Forbidden error?',
     'A 403 means your role lacks permission for that feature. Check your role in Configuration → Users & Roles. Each feature has three access levels: none (hidden + 403), read (view only), write (full access). Ask an Admin to update your role permissions.',
     'Troubleshooting', '["error","403","forbidden","permission","rbac"]'::jsonb, 110),

    ('Why is the app showing "Pending" after I log in?',
     'New users start in "pending" status after registering via Auth0. An Admin must approve your account in Configuration → Users & Roles. The first-ever user is auto-approved as Admin. Contact your system administrator to get approved.',
     'Troubleshooting', '["pending","login","approve","new-user"]'::jsonb, 111),

    ('Why are exchange rates not updating?',
     'Exchange rates are synced from the Frankfurter API (free, no key required). Go to Configuration → Currency section → click "Sync Rates". If it fails, check your server''s internet connectivity. Rates are relative to USD base. You can also manually override any rate.',
     'Troubleshooting', '["exchange","rate","sync","currency","frankfurter"]'::jsonb, 112),

    ('How do I fix missing COGS on a menu item?',
     'COGS shows 0 or blank when the cost chain is incomplete. Check in order: 1) Does the sales item link to a recipe or ingredient? 2) Does the recipe have all ingredients added? 3) Does each ingredient have an active price quote? 4) Is a preferred vendor set for the target market? 5) Is the recipe yield qty > 0?',
     'Troubleshooting', '["cogs","missing","zero","troubleshoot","checklist"]'::jsonb, 113),

    ('Pepper is not responding — what should I check?',
     'Check: 1) Is the Anthropic API key configured in Settings → AI? 2) Have you exceeded your monthly token limit? (check the usage bar in the Pepper header). 3) Is the server running? (check /api/health). 4) Try refreshing the page — SSE connections can drop on unstable networks.',
     'Troubleshooting', '["pepper","error","not-responding","troubleshoot"]'::jsonb, 114)

    ON CONFLICT DO NOTHING;
  END $$`,
];

async function runMigrations(pool) {
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
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { migrations, runMigrations };

// CLI entry point — only runs when invoked directly (`node migrate.js` or
// `npm run migrate`), never when required as a module.
if (require.main === module) {
  require('dotenv').config();
  const { Pool } = require('pg');
  const { buildPoolConfig, describeTarget } = require('../src/db/config');

  const { mode, config } = buildPoolConfig();
  console.log(`[migrate] Target: ${describeTarget({ mode, config })}`);
  const pool = new Pool(config);

  runMigrations(pool)
    .then(() => pool.end())
    .catch((err) => {
      pool.end().catch(() => {});
      console.error('[migrate] Fatal:', err.message);
      process.exit(1);
    });
}
