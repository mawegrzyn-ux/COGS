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

// ── QSC question bank — loaded once at module load time ────────────────────
// Fixture is produced by api/scripts/parse-qsc-spec.js from the Wingstop spec.
// If the fixture is missing (e.g. fresh clone before parser runs) the seed
// step becomes a no-op so migrations still succeed.
const path = require('path');
const fs   = require('fs');
let QSC_QUESTIONS = [];
try {
  const fixturePath = path.resolve(__dirname, 'fixtures/qsc-questions.json');
  if (fs.existsSync(fixturePath)) {
    QSC_QUESTIONS = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  }
} catch (e) {
  console.warn('[migrate] QSC fixture load failed:', e.message);
}

// PostgreSQL literal escape: 'that''s' — replaces each apostrophe with two.
const sqlEscape = (s) => (s == null ? '' : String(s).replace(/'/g, "''"));

function buildQscSeedSql() {
  if (!QSC_QUESTIONS.length) {
    return `-- QSC fixture not found; skip seed (parse-qsc-spec.js must be run)
            SELECT 1`;
  }
  const values = QSC_QUESTIONS.map(q => {
    const crossRefs = JSON.stringify(q.cross_refs || []).replace(/'/g, "''");
    return `('${sqlEscape(q.code)}', ${q.version | 0},
             ${q.department ? `'${sqlEscape(q.department)}'` : 'NULL'},
             ${q.category   ? `'${sqlEscape(q.category)}'`   : 'NULL'},
             '${sqlEscape(q.title)}',
             '${sqlEscape(q.risk_level)}',
             ${q.points | 0}, ${q.repeat_points | 0},
             '${sqlEscape(q.policy)}',
             ${q.auto_unacceptable ? 'TRUE' : 'FALSE'},
             ${q.photo_required    ? 'TRUE' : 'FALSE'},
             ${q.temperature_input ? 'TRUE' : 'FALSE'},
             '${crossRefs}'::jsonb,
             ${q.sort_order | 0}, TRUE)`;
  }).join(',\n        ');

  return `INSERT INTO mcogs_qsc_questions
      (code, version, department, category, title, risk_level, points, repeat_points,
       policy, auto_unacceptable, photo_required, temperature_input, cross_refs,
       sort_order, active)
    VALUES
        ${values}
    ON CONFLICT (code, version) DO NOTHING`;
}

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
  // PREVIOUS BUG: the "drop old FK" check used information_schema.table_constraints
  // which matches by NAME only — it would match the *new* FK (pointing at
  // mcogs_brand_partners) just as easily as the legacy one (pointing at
  // mcogs_vendors). On every deploy after the initial migration, this branch
  // fired, dropped the (correct) FK, and the UPDATE cleared every operator's
  // brand-partner-to-market allocation. Replaced with a pg_constraint join
  // that filters on `ref.relname = 'mcogs_vendors'` so it only ever fires
  // once — when the legacy FK is still in place. Subsequent deploys see the
  // FK pointing at mcogs_brand_partners → IF returns false → no data loss.
  `DO $$
  BEGIN
    -- Drop old FK ONLY if it currently points at the legacy mcogs_vendors table
    IF EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_class ref ON ref.oid = con.confrelid
      WHERE con.contype = 'f'
        AND rel.relname = 'mcogs_countries'
        AND ref.relname = 'mcogs_vendors'
        AND con.conname = 'mcogs_countries_brand_partner_id_fkey'
    ) THEN
      ALTER TABLE mcogs_countries DROP CONSTRAINT mcogs_countries_brand_partner_id_fkey;
      -- Clear stale vendor IDs — they no longer map to brand partners.
      -- This only runs on the FIRST deploy after the FK was repointed, never again.
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

  // ── Step 119: Seed backlog — RAID log, server monitoring, AWS backups ──────
  `DO $$ DECLARE sort_n INTEGER; eid INTEGER;
   BEGIN
     SELECT COALESCE(MAX(sort_order), 0) + 1 INTO sort_n FROM mcogs_backlog;

     -- Epic: Infrastructure & Ops
     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
     VALUES ('BACK-1400', 'Infrastructure & Ops',
       'Server monitoring, AWS backups, health checks, and operational tooling for Pepper and the API.',
       'epic', 'high', 'backlog', '["infrastructure","ops","devops"]'::jsonb, sort_n)
     ON CONFLICT (key) DO NOTHING;

     SELECT id INTO eid FROM mcogs_backlog WHERE key = 'BACK-1400';

     INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id) VALUES
       ('BACK-1401', 'RAID Log — Risks, Assumptions, Issues, Dependencies tracker',
        'New tab in System page. CRUD table with columns: type (R/A/I/D), summary, description, status (open/mitigated/closed), owner, priority, impact, due_date. Filter by type/status. Pepper tool to query/create RAID items. Migration for mcogs_raid_log table.',
        'story', 'medium', 'backlog', '["system","tracking","raid"]'::jsonb, sort_n+1, eid),

       ('BACK-1402', 'Server Monitoring Tier 1 — Local vitals via Pepper tools',
        'Pepper tools that read /proc/meminfo (RAM), df (disk), PM2 status (process health), pg_stat_activity (DB connections), Certbot cert expiry. No AWS SDK needed. Zero cost. User asks "how is the server?" and gets real-time vitals.',
        'story', 'high', 'backlog', '["infrastructure","monitoring","pepper"]'::jsonb, sort_n+2, eid),

       ('BACK-1403', 'Server Monitoring Tier 2 — CloudWatch integration',
        'Add @aws-sdk/client-cloudwatch. Pepper tools for historical metrics: CPU, memory, network, disk. IAM scoped to cloudwatch:GetMetricData read-only. Works for both Lightsail and EC2. Historical graphs via data export.',
        'story', 'medium', 'backlog', '["infrastructure","monitoring","aws","cloudwatch"]'::jsonb, sort_n+3, eid),

       ('BACK-1404', 'AWS Lightsail Backup — Pepper-triggered snapshots',
        'Add @aws-sdk/client-lightsail or aws-cli. Pepper tool: trigger_backup calls CreateInstanceSnapshotCommand. Confirmation required before execution. IAM scoped to Lightsail snapshots only. Optional: schedule daily snapshot via node-cron (same infra as memory consolidation).',
        'story', 'medium', 'backlog', '["infrastructure","backup","aws","lightsail"]'::jsonb, sort_n+4, eid),

       ('BACK-1405', 'Database backup — pg_dump to S3',
        'Alternative to full Lightsail snapshots. Pepper tool or cron job runs pg_dump, compresses, uploads to S3. Cheaper and faster than instance snapshots. Retention policy: keep last 7 daily + 4 weekly.',
        'story', 'medium', 'backlog', '["infrastructure","backup","database","s3"]'::jsonb, sort_n+5, eid),

       ('BACK-1406', 'Nightly health check in consolidation cron',
        'Extend the 02:07 UTC cron job to also check: disk usage > 80%, memory > 90%, PM2 restart count, SSL cert expiry < 14 days. Log alerts to mcogs_settings or a new mcogs_health_alerts table. Surface in System page.',
        'task', 'medium', 'backlog', '["infrastructure","monitoring","cron","health"]'::jsonb, sort_n+6, eid)

     ON CONFLICT (key) DO NOTHING;

     PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1410));
   END $$`,

  // ── Step 120: Change Log table ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_changelog (
    id          SERIAL PRIMARY KEY,
    version     VARCHAR(20) NOT NULL,
    title       VARCHAR(500) NOT NULL,
    entries     JSONB NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_changelog_version ON mcogs_changelog(version DESC)`,

  // ── Step 120b: Seed changelog + SSH terminal backlog ───────────────────────
  `DO $$ BEGIN
    -- Seed this session's changelog entry
    INSERT INTO mcogs_changelog (version, title, entries) VALUES
    ('2026-04-14', 'HTML Validator + Memory Consolidation + FAQ + Audit Expansion', '${JSON.stringify([
      { type: 'added', description: 'HTML Content Validator — scans uploaded HTML for security violations, shows report card with Ask Pepper escalation button' },
      { type: 'added', description: 'FAQ Knowledge Base — 70+ searchable FAQ entries across 12 categories, HelpPage FAQ tab with instant search and category filters' },
      { type: 'added', description: 'Pepper search_faq tool — searches FAQ knowledge base for how-to answers (tool #96)' },
      { type: 'added', description: 'Pepper audit log tools — query_audit_log, get_entity_audit_history, get_audit_stats (3 new tools)' },
      { type: 'added', description: 'Memory Consolidation MVP — nightly cron job (02:07 UTC) reads chat + audit logs, summarises via Claude Haiku, stores daily/monthly summaries, auto-updates user profiles' },
      { type: 'added', description: 'Pepper keyboard shortcut — Ctrl+Shift+P opens and focuses the chat input' },
      { type: 'added', description: 'System prompt now includes: last 3 daily summaries + activity digest (changes since last conversation)' },
      { type: 'added', description: 'Change Log table and System page tab (read-only, updated as part of EOD protocol)' },
      { type: 'changed', description: 'Audit logging expanded from 10 to 48 route files (209 logAudit calls) — full coverage of every write operation' },
      { type: 'changed', description: 'End-of-Session Protocol updated with step 5: update the Change Log' },
      { type: 'fixed', description: 'Pepper user message text colour — renderMd now uses color:inherit for user messages instead of hardcoded dark colours on green background' },
      { type: 'fixed', description: 'Test data clearData — added 30 missing tables (stock manager, media, docs, bugs, backlog, memory, FAQ) to both seed scripts' }
    ]).replace(/'/g, "''")}')
    ON CONFLICT DO NOTHING;

    -- SSH Terminal backlog item
    INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order, epic_id)
    VALUES ('BACK-1407', 'Web SSH Terminal — xterm.js + node-pty in System page',
      'Full interactive browser-based terminal. Frontend: xterm.js terminal emulator in a System page tab. Backend: WebSocket endpoint spawns PTY shell via node-pty. Gated by is_dev. Major security surface — needs careful access control.',
      'story', 'low', 'backlog', '["infrastructure","system","terminal","ssh"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM mcogs_backlog),
      (SELECT id FROM mcogs_backlog WHERE key = 'BACK-1400'))
    ON CONFLICT (key) DO NOTHING;

    PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1410));
  END $$`,

  // ── Step 121: Configurable Dashboard + MarketContext + Map/Chart widgets ──
  `DO $$ BEGIN
    INSERT INTO mcogs_changelog (version, title, entries) VALUES
    ('2026-04-18', 'Configurable Dashboard + Global Market Switcher + World Map widget', '${JSON.stringify([
      { type: 'added', description: 'Configurable dashboard — 3 templates (Executive, Finance, Market Explorer), per-widget reorder/resize/remove, + Add widget dropdown, localStorage persistence (cogs-dashboard-config-v1)' },
      { type: 'added', description: 'Dashboard widget framework — 17 widgets in a 12-col grid with ¼/½/¾/Full sizes. New files: dashboard/types.ts, dashboard/templates.ts, dashboard/DashboardData.tsx, dashboard/widgets.tsx' },
      { type: 'added', description: 'Global Market Switcher — top-bar dropdown in AppLayout scoping the app to a selected country. Persisted to localStorage, RBAC-aware (allowedCountries), auto-clamps stale selections' },
      { type: 'added', description: 'MarketContext provider — app/src/contexts/MarketContext.tsx. Wrapped routes in App.tsx. Consumable via useMarket() hook in any page' },
      { type: 'added', description: 'World Map widget (market-map) — 2D world map via react-simple-maps + d3-geo. Countries shaded by avg COGS% (green/amber/red), click to set market, hover tooltip, zoom/pan. Lazy-loaded' },
      { type: 'added', description: 'Menu Top Items widget (menu-top-items) — bar chart of top 10 items per menu in market scope. Metric toggle (Cost / Revenue / COGS%), per-menu price-level override. Lazy-loaded' },
      { type: 'added', description: 'Market widgets — market-picker (country card grid), market-stats (snapshot), market-header (active-market banner)' },
      { type: 'changed', description: 'Dashboard Quick Links — each link now has an SVG icon in a rounded badge above the label (Inventory, Recipes, Menus, Sales Items, Stock, HACCP, Allergens, Config)' },
      { type: 'changed', description: 'Dashboard header — template selector, + Add widget, Reset buttons are visible only in Customise mode. View mode is clean: title · Customise · Refresh' },
      { type: 'changed', description: 'Dependencies — react-simple-maps ^3.0.0 + d3-geo ^3.1.1 added to app/package.json (with @types/*)' }
    ]).replace(/'/g, "''")}')
    ON CONFLICT DO NOTHING;

    -- Backlog items uncovered during this session
    INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
    VALUES
    ('BACK-1410', 'Dashboard config sync across devices (DB-backed)',
      'Current dashboard config is per-browser (localStorage). Add an optional DB-backed user dashboard table (mcogs_user_dashboards) + API route so configs sync across devices. Keep localStorage as write-through cache.',
      'story', 'low', 'backlog', '["dashboard","ux","enhancement"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM mcogs_backlog)),
    ('BACK-1411', 'Market-scoped API — inject country_id on list endpoints',
      'MarketContext currently only scopes the dashboard. Extend useApi() to inject ?country_id=X on list endpoints when the global market is set, and update list routes (inventory, menus, vendors, stock) to respect it. Completes the "market-driven UX" vision.',
      'story', 'medium', 'backlog', '["api","ux","market-scope"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 2 FROM mcogs_backlog)),
    ('BACK-1412', 'Role-driven dashboard view modes (Operator / Manager / Admin)',
      'Three simplified view modes gated by RBAC role: Operator (task-focused tiles, hides admin config), Manager (current layout minus System/Config admin), Admin (full layout = current default). Layer on top of the existing template system.',
      'story', 'medium', 'backlog', '["rbac","ux","dashboard"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 3 FROM mcogs_backlog)),
    ('BACK-1413', 'Map tooltip enhancements — show menu count + vendor count',
      'Currently the map hover tooltip shows country name, currency and avg COGS. Add menu count, vendor count, and item-count rolled up.',
      'task', 'low', 'backlog', '["dashboard","map","enhancement"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 4 FROM mcogs_backlog)),
    ('BACK-1414', 'Menu Top Items — use scenario qty data for revenue metric',
      'Revenue metric currently uses qty from /cogs/menu-sales response. When no scenario exists, qty is 0 → revenue shows zero. Fall back to the active scenario qty when one is loaded, or average across all scenarios for the menu.',
      'task', 'low', 'backlog', '["dashboard","chart","enhancement"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 5 FROM mcogs_backlog)),
    ('BACK-1415', 'Cross-market Reports page',
      'Dedicated /reports page for power users with cross-market comparisons: COGS% comparison for the same recipe across markets, missing quotes per market, waste spend by location/period, stock value by market, sales mix rollup. Uses existing tables — no new schema.',
      'story', 'medium', 'backlog', '["reports","analytics"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 6 FROM mcogs_backlog))
    ON CONFLICT (key) DO NOTHING;

    PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1416));
  END $$`,

  // ── Step 122: Multi-language support — Phase 1 Foundation ──────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_languages (
    code        VARCHAR(10) PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    native_name VARCHAR(100),
    is_default  BOOLEAN NOT NULL DEFAULT FALSE,
    is_rtl      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_languages_active ON mcogs_languages(is_active)`,

  // Seed English as default + 9 additional languages (inactive by default — admin can enable)
  `INSERT INTO mcogs_languages (code, name, native_name, is_default, is_rtl, is_active, sort_order) VALUES
    ('en', 'English',    'English',    TRUE,  FALSE, TRUE,  0),
    ('fr', 'French',     'Français',   FALSE, FALSE, FALSE, 10),
    ('es', 'Spanish',    'Español',    FALSE, FALSE, FALSE, 20),
    ('de', 'German',     'Deutsch',    FALSE, FALSE, FALSE, 30),
    ('it', 'Italian',    'Italiano',   FALSE, FALSE, FALSE, 40),
    ('nl', 'Dutch',      'Nederlands', FALSE, FALSE, FALSE, 50),
    ('pl', 'Polish',     'Polski',     FALSE, FALSE, FALSE, 60),
    ('pt', 'Portuguese', 'Português',  FALSE, FALSE, FALSE, 70),
    ('hi', 'Hindi',      'हिन्दी',      FALSE, FALSE, FALSE, 80)
   ON CONFLICT (code) DO NOTHING`,

  // Translations JSONB column on 11 entities
  `ALTER TABLE mcogs_ingredients        ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_recipes            ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_sales_items        ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_modifier_groups    ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_modifier_options   ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_combo_steps        ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_combo_step_options ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_categories         ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_vendors            ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_price_levels       ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,
  `ALTER TABLE mcogs_menus              ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}'::jsonb`,

  // default_language_code on countries (FK to languages)
  `ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS default_language_code VARCHAR(10)
    REFERENCES mcogs_languages(code) ON DELETE SET NULL`,

  // Seed changelog entry for Phase 1
  `DO $$ BEGIN
    INSERT INTO mcogs_changelog (version, title, entries) VALUES
    ('2026-04-18b', 'Multi-Language Support — Foundation + Backend AI + FE skeleton', '${JSON.stringify([
      { type: 'added', description: 'mcogs_languages reference table seeded with 10 languages (EN active, FR ES DE IT NL PL PT HI inactive by default)' },
      { type: 'added', description: 'translations JSONB column on 11 entities (ingredients, recipes, sales_items, modifier_groups, modifier_options, combo_steps, combo_step_options, categories, vendors, price_levels, menus)' },
      { type: 'added', description: 'default_language_code on mcogs_countries (FK to mcogs_languages)' },
      { type: 'added', description: 'resolveLanguage middleware — chain: X-Language header > user profile > country default > system default > en' },
      { type: 'added', description: 'Translation helpers (api/src/helpers/translate.js) — tCol() for COALESCE, hashText() for staleness detection, mergeTranslations() for safe writes' },
      { type: 'added', description: 'CRUD routes: GET/POST/PUT/DELETE /api/languages + GET/PUT/DELETE /api/translations/:entityType/:entityId/:lang + POST /api/translations/warm' },
      { type: 'added', description: 'Nightly cron job translateEntities.js — runs at 02:15 UTC, uses Claude Haiku, never overwrites human-reviewed translations' },
      { type: 'added', description: 'Ingredients route — COALESCE translation resolution on GET (pilot for other entities)' },
      { type: 'added', description: 'Pepper AI — system prompt injects user_language, respects req.language for responses' },
      { type: 'added', description: 'Frontend: LanguageContext + LanguageSwitcher in sidebar + X-Language header in useApi + TranslationEditor component (wired to Ingredients edit form as pilot)' },
      { type: 'added', description: 'CORS: X-Language added to allowed headers' }
    ]).replace(/'/g, "''")}')
    ON CONFLICT DO NOTHING;

    -- Follow-up backlog items for the remaining 10 entities and Phase 4
    INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order)
    VALUES
    ('BACK-1420', 'Translations: extend COALESCE to recipes/menus/sales-items/categories/vendors routes',
      'Phase 1 shipped with Ingredients as the COALESCE pilot. Apply the same pattern to recipes.js, menus.js, sales-items.js, categories.js, vendors.js, price-levels.js, modifier-groups.js, combos.js using the tCol() helper.',
      'story', 'high', 'todo', '["i18n","backend"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM mcogs_backlog)),
    ('BACK-1421', 'Translations: wire TranslationEditor into remaining edit forms',
      'Component built and wired for ingredients. Apply to recipes edit, menus edit, sales items edit (Details tab), categories, vendors. Each needs the fields prop customised.',
      'story', 'medium', 'todo', '["i18n","frontend"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 2 FROM mcogs_backlog)),
    ('BACK-1422', 'Translations: Pepper tool executor language support',
      'Pepper system prompt now respects user language, but tool SELECT queries still return English names. Update the 15 read tools in ai-chat.js to use tCol() pattern so tool results are returned in the user language.',
      'story', 'medium', 'todo', '["i18n","pepper"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 3 FROM mcogs_backlog)),
    ('BACK-1423', 'i18next UI localisation (Phase 4)',
      'Install i18next + react-i18next. Extract ~200 hardcoded UI strings into namespaces (common/nav/pages). Generate FR/ES/DE locale JSONs via Haiku. Progressive t() rollout starting with Sidebar + ui.tsx.',
      'story', 'medium', 'backlog', '["i18n","frontend","ux"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 4 FROM mcogs_backlog)),
    ('BACK-1424', 'Translations: Vary: X-Language response header',
      'If CDN caching is enabled on /api/* responses, add Vary: X-Language to prevent cross-language cache contamination. Not a concern right now but critical for scale-out.',
      'task', 'low', 'backlog', '["i18n","infrastructure"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 5 FROM mcogs_backlog)),
    ('BACK-1425', 'Import wizard: Source Language dropdown',
      'When a non-English operator imports data, the canonical name is in their language. Add Source Language selector to import wizard. If not English, AI generates English base name and stores operator value as the translation.',
      'story', 'medium', 'backlog', '["i18n","import"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 6 FROM mcogs_backlog)),
    ('BACK-1426', 'Shared pages language support',
      '/share/:slug needs language resolution without auth: ?lang URL param > Accept-Language > country default > en. Scope includes translating the price-change form and comment feed UI.',
      'story', 'low', 'backlog', '["i18n","shared-pages"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 7 FROM mcogs_backlog)),
    ('BACK-1427', 'RTL layout support (Arabic/Hebrew)',
      'Deferred until RTL market is confirmed. Est. 7-10 days: Tailwind rtl: variants, sidebar mirroring, Pepper dock positioning, DataGrid sticky column flip, ms-/me- conversion across ~300 class occurrences.',
      'epic', 'low', 'backlog', '["i18n","rtl","deferred"]'::jsonb,
      (SELECT COALESCE(MAX(sort_order), 0) + 8 FROM mcogs_backlog))
    ON CONFLICT (key) DO NOTHING;

    PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1428));
  END $$`,

  // ── Step 123: Complete BACK-1420 through BACK-1424 ─────────────────────────
  `DO $$ BEGIN
    INSERT INTO mcogs_changelog (version, title, entries) VALUES
    ('2026-04-18c', 'i18n follow-ups — COALESCE across entities, Pepper tools, TranslationEditor in all edit forms, i18next skeleton, Vary header', '${JSON.stringify([
      { type: 'added', description: 'BACK-1420 shipped — COALESCE translation resolution added to recipes, menus, categories, vendors, sales-items (fetchFull + list), price-levels, modifier-groups routes. Plus getLangContext() / setContentLanguage() helpers.' },
      { type: 'added', description: 'BACK-1421 shipped — TranslationEditor wired into recipes edit modal, menus edit modal, sales-items edit panel (new Translations tab), vendors edit modal, categories edit modal.' },
      { type: 'added', description: 'BACK-1422 shipped — Pepper tool executors now apply COALESCE via userCtx.language. Updated: list_ingredients, get_ingredient, list_recipes, get_recipe, list_menus, list_vendors, list_markets (price_level_name), list_categories, list_price_levels, list_price_quotes. ai-chat + ai-upload thread req.language into userCtx.' },
      { type: 'added', description: 'BACK-1423 shipped — i18next + react-i18next + i18next-browser-languagedetector installed. i18n skeleton with 9 locales (EN FR ES DE IT NL PL PT HI), common + nav namespaces, ~50 keys each. Sidebar nav labels now use t(). LanguageContext syncs i18n.changeLanguage() on switch.' },
      { type: 'added', description: 'BACK-1424 shipped — Vary: X-Language response header added globally via middleware. Prevents CDN cache contamination across languages.' },
      { type: 'changed', description: 'Dependencies added to app/package.json: i18next ^23.15.1, react-i18next ^15.0.2, i18next-browser-languagedetector ^8.0.0.' }
    ]).replace(/'/g, "''")}')
    ON CONFLICT DO NOTHING;

    -- Mark follow-up backlog items as done
    UPDATE mcogs_backlog SET status = 'done' WHERE key IN ('BACK-1420', 'BACK-1421', 'BACK-1422', 'BACK-1423', 'BACK-1424');
  END $$`,

  // ── Step 124: QSC Audit Tool — Question bank ─────────────────────────────
  `CREATE TABLE IF NOT EXISTS mcogs_qsc_questions (
    id                SERIAL PRIMARY KEY,
    code              VARCHAR(10)  NOT NULL,
    version           INTEGER      NOT NULL DEFAULT 1,
    department        VARCHAR(50),
    category          VARCHAR(100),
    title             TEXT         NOT NULL,
    risk_level        VARCHAR(40)  NOT NULL,
    points            INTEGER      NOT NULL DEFAULT 0,
    repeat_points     INTEGER      NOT NULL DEFAULT 0,
    policy            TEXT,
    auto_unacceptable BOOLEAN      NOT NULL DEFAULT FALSE,
    photo_required    BOOLEAN      NOT NULL DEFAULT FALSE,
    temperature_input BOOLEAN      NOT NULL DEFAULT FALSE,
    cross_refs        JSONB        NOT NULL DEFAULT '[]',
    sort_order        INTEGER      NOT NULL DEFAULT 0,
    active            BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (code, version)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_q_dept    ON mcogs_qsc_questions(department, category)`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_q_version ON mcogs_qsc_questions(version)`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_q_active  ON mcogs_qsc_questions(active, sort_order)`,

  // ── Step 125: Seed QSC question bank from fixture ───────────────────────
  buildQscSeedSql(),

  // ── Step 126: QSC Audit templates (for internal ad-hoc audits) ──────────
  `CREATE TABLE IF NOT EXISTS mcogs_qsc_templates (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    question_codes  JSONB        NOT NULL DEFAULT '[]',
    is_system       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by      VARCHAR(200),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,

  // ── Step 127: Audit runs + responses + photos ───────────────────────────
  `CREATE SEQUENCE IF NOT EXISTS mcogs_qsc_audit_number_seq START 1001`,
  `CREATE TABLE IF NOT EXISTS mcogs_qsc_audits (
    id                SERIAL PRIMARY KEY,
    key               VARCHAR(20)  NOT NULL UNIQUE,
    audit_type        VARCHAR(20)  NOT NULL CHECK (audit_type IN ('external','internal')),
    location_id       INTEGER      REFERENCES mcogs_locations(id) ON DELETE SET NULL,
    template_id       INTEGER      REFERENCES mcogs_qsc_templates(id) ON DELETE SET NULL,
    question_version  INTEGER      NOT NULL DEFAULT 1,
    auditor_sub       VARCHAR(200),
    auditor_name      VARCHAR(200),
    started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at      TIMESTAMPTZ,
    status            VARCHAR(20)  NOT NULL DEFAULT 'in_progress'
                        CHECK (status IN ('in_progress','completed','cancelled')),
    overall_score     NUMERIC(6,2),
    overall_rating    VARCHAR(30),
    auto_unacceptable BOOLEAN      NOT NULL DEFAULT FALSE,
    notes             TEXT,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_audits_location      ON mcogs_qsc_audits(location_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_audits_type_status   ON mcogs_qsc_audits(audit_type, status)`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_audits_completed     ON mcogs_qsc_audits(completed_at DESC) WHERE completed_at IS NOT NULL`,

  `CREATE TABLE IF NOT EXISTS mcogs_qsc_responses (
    id                SERIAL PRIMARY KEY,
    audit_id          INTEGER NOT NULL REFERENCES mcogs_qsc_audits(id) ON DELETE CASCADE,
    question_code     VARCHAR(10) NOT NULL,
    status            VARCHAR(20) NOT NULL
                        CHECK (status IN ('compliant','not_compliant','not_observed','not_applicable','informational')),
    is_repeat         BOOLEAN NOT NULL DEFAULT FALSE,
    points_deducted   INTEGER NOT NULL DEFAULT 0,
    comment           TEXT,
    temperature_value NUMERIC(8,2),
    temperature_unit  VARCHAR(2) CHECK (temperature_unit IN ('F','C')),
    product_name      VARCHAR(200),
    answered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (audit_id, question_code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_resp_audit ON mcogs_qsc_responses(audit_id)`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_resp_code  ON mcogs_qsc_responses(question_code)`,

  `CREATE TABLE IF NOT EXISTS mcogs_qsc_response_photos (
    id           SERIAL PRIMARY KEY,
    response_id  INTEGER NOT NULL REFERENCES mcogs_qsc_responses(id) ON DELETE CASCADE,
    url          TEXT NOT NULL,
    caption      VARCHAR(500),
    uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_qsc_photos_response ON mcogs_qsc_response_photos(response_id)`,

  // ── Step 128: Seed v1 internal audit templates ──────────────────────────
  `INSERT INTO mcogs_qsc_templates (name, description, question_codes, is_system) VALUES
    ('Line Check (Peak)',
     'Quick peak-service line check across cooking, sauce and make stations.',
     '["KM201","KM202","KM203","KM204","KM205","KM206","KL201","KL208","KC201","KC202","KC203"]'::jsonb, TRUE),
    ('Walk-in & Cold Hold',
     'Cold hold and walk-in cooler deep dive.',
     '["A101","A105","B211","C305","C307"]'::jsonb, TRUE),
    ('Personal Hygiene Spot Check',
     'Hand-washing, glove use, and general hygiene standards.',
     '["A131","A133","A135","B219","B221","B221a","C330","C331"]'::jsonb, TRUE),
    ('Expiration Date Sweep',
     'Product-dating and rotation compliance sweep.',
     '["A119","A119a","B225","B225a","B225b","B225c","B225d"]'::jsonb, TRUE),
    ('Cleaning & Sanitizer',
     'Sanitizer concentration + cleanliness of food-contact surfaces.',
     '["A125","A127","B235","B237","B239","C315","C319","C321","C325","C329"]'::jsonb, TRUE),
    ('Opening Checklist',
     'Pre-open standards across dining room, front counter, line.',
     '["DR301","FC301","KL301","KL302","KM301","KC302"]'::jsonb, TRUE),
    ('Front-of-House Guest Experience',
     'Dining room + front counter guest experience standards.',
     '["DR201","DR204","FC203","FC204","FC205","FC206"]'::jsonb, TRUE)
   ON CONFLICT DO NOTHING`,

  // ── Step 129: RBAC — seed audits + audits_admin features ────────────────
  `DO $$ DECLARE r RECORD; BEGIN
    FOR r IN SELECT id, name FROM mcogs_roles LOOP
      -- audits: admin/operator get write, viewer gets read
      INSERT INTO mcogs_role_permissions (role_id, feature, access)
      VALUES (r.id, 'audits',
        CASE WHEN r.name IN ('Admin','Operator') THEN 'write' ELSE 'read' END)
      ON CONFLICT (role_id, feature) DO NOTHING;

      -- audits_admin: only Admin gets write (edit question bank)
      INSERT INTO mcogs_role_permissions (role_id, feature, access)
      VALUES (r.id, 'audits_admin',
        CASE WHEN r.name = 'Admin' THEN 'write' ELSE 'none' END)
      ON CONFLICT (role_id, feature) DO NOTHING;
    END LOOP;
  END $$`,

  // ── Step 130: Changelog entry + backlog epic for QSC rollout ────────────
  `DO $$ BEGIN
    INSERT INTO mcogs_changelog (version, title, entries) VALUES
    ('2026-04-21-qsc', 'QSC Audit Tool v1 — all phases', '${JSON.stringify([
      { type: 'added', description: 'QSC Audit Tool — new Audits module at /audits with external and internal modes, question-by-question runner, photo/temperature capture, auto-save, report view, CSV export, print-friendly PDF.' },
      { type: 'added', description: '5 new tables: mcogs_qsc_questions (150 seeded from Wingstop spec), mcogs_qsc_templates (7 seeded), mcogs_qsc_audits, mcogs_qsc_responses, mcogs_qsc_response_photos.' },
      { type: 'added', description: 'Scoring engine: 100-point deduct, auto-unacceptable triggers (A105/A127/A139/A141/A143/OF101), rating bands (Acceptable ≥90, Needs Improvement 70-89.9, Unacceptable <70).' },
      { type: 'added', description: 'RBAC: 2 new features — audits (admin/operator write, viewer read) and audits_admin (admin only, for question-bank editing).' },
      { type: 'added', description: 'Pepper tools: list_audits, get_audit_report.' },
      { type: 'added', description: 'Sidebar nav link under the HACCP block; legacy /audits routes redirect through standard ProtectedRoute.' }
    ]).replace(/'/g, "''")}'::jsonb)
    ON CONFLICT DO NOTHING;

    INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
    ('BACK-1500', 'QSC Audit Tool — v2 follow-ups',
     'Offline-first service worker + IndexedDB queue; scheduling & evaluator role; escalation emails for A139/A141/A143; branded PDF via Puppeteer; question-bank admin UI; per-location RBAC scope (mcogs_user_locations junction); reconcile question count against xlsx source.',
     'epic', 'medium', 'backlog', '["qsc","v2"]'::jsonb,
     (SELECT COALESCE(MAX(sort_order), 0) + 10 FROM mcogs_backlog))
    ON CONFLICT (key) DO NOTHING;

    PERFORM setval('mcogs_backlog_number_seq', GREATEST(nextval('mcogs_backlog_number_seq'), 1500));
  END $$`,

  // ── Step 131: FAQ entries for QSC Audits ───────────────────────────────────
  `DO $$ BEGIN
    INSERT INTO mcogs_faq (question, answer, category, tags, sort_order) VALUES

    ('What is the QSC Audit Tool?',
     'QSC stands for Quality, Service, Cleanliness — a Wingstop audit framework. The module at /audits lets you run scored audits against a bank of 150 questions covering Food Safety and Brand Standards. Two modes: External (formal, scored, every question required) and Internal (ad-hoc, optional template, partial completion OK).',
     'Audits', '["qsc","audits","overview","wingstop"]'::jsonb, 100),

    ('How do I start a QSC audit?',
     'Go to /audits and click "+ Start audit" (top right). Pick a type (External or Internal), choose a location, optionally pick a template for internal audits, and enter the auditor name. Clicking Start creates an AUD-xxxx key and drops you into the question runner.',
     'Audits', '["qsc","start","audit","beginner"]'::jsonb, 101),

    ('What is the difference between external and internal audits?',
     'External = formal evaluation, every scored question must be answered before finalize, score is the audit-of-record for the location. Internal = ad-hoc self-check, can use a template or custom selection, partial completion allowed (unanswered items record as Not Observed), tagged visually with an Internal badge and never replaces the external score.',
     'Audits', '["external","internal","difference"]'::jsonb, 102),

    ('How is the audit score calculated?',
     'Start at 100 points. Each Not Compliant answer deducts points by risk level: First Priority = 5, Second Priority = 3, Third Priority = 1, Information Only = 0. If the same code was NC on the previous external audit, the "Repeat finding" checkbox adds the same deduction (kept as a separate field for future divergence). Ratings: >= 90 Acceptable, 70-89.9 Needs Improvement, < 70 Unacceptable.',
     'Audits', '["score","scoring","rating","calculation"]'::jsonb, 103),

    ('What is an auto-unacceptable trigger?',
     'Six codes force the overall rating to Unacceptable regardless of the numeric score: A105 (walk-in cooler TCS foods out of temp due to equipment), A127 (no sanitizer available), A139 (sewage backup / no working toilet), A141 (no potable water), A143 (live rodents or roaches), and OF101. Marking any of them Not Compliant flips the rating at finalize.',
     'Audits', '["auto-unacceptable","critical","A105","A127","A139","A141","A143"]'::jsonb, 104),

    ('Can I attach photos to an audit response?',
     'Yes. On any question, click "+ Attach photo" to upload an image (max 5 MB). Photos are stored via the same media upload path as the rest of the app (local disk or S3). Some questions are marked with a "Photo required" badge — for those, a photo is strongly encouraged and flagged in the report if missing.',
     'Audits', '["photo","upload","evidence","attach"]'::jsonb, 105),

    ('How does repeat-finding detection work?',
     'When you start an audit for a location, the runner fetches the previous external audit at that same location and preloads its Not Compliant codes. When you mark one of those codes NC this time, the "Repeat finding" checkbox is pre-suggested. You can accept it or uncheck it if the context differs.',
     'Audits', '["repeat","previous","location","history"]'::jsonb, 106),

    ('How do I export an audit report?',
     'On the report page (/audits/:id/report) use the two top-right buttons: "Export CSV" downloads one row per response for spreadsheet analysis; "Print / PDF" opens your browser print dialog with a clean single-column layout — save as PDF from there. Branded PDF via Puppeteer is planned for v2.',
     'Audits', '["export","csv","pdf","print","report"]'::jsonb, 107),

    ('Can I create my own audit templates?',
     'Yes — Admin and Operator users can create, edit, and delete custom templates at /audits/templates. 7 system templates ship with the product (Line Check Peak, Walk-in & Cold Hold, Personal Hygiene, Expiration Sweep, Cleaning & Sanitizer, Opening Checklist, Front-of-House); these cannot be deleted and only developers can edit them.',
     'Audits', '["template","custom","system","create"]'::jsonb, 108),

    ('How do I hide the Audits module entirely?',
     'An Admin can turn the module off at Configuration -> Global Config -> Feature Toggles -> QSC Audits. When off, the Audits sidebar entry disappears for everyone and /audits/* routes redirect to the dashboard. RBAC permissions (audits feature) still apply on top of this when the module is on.',
     'Audits', '["global","switch","toggle","disable","feature-flag"]'::jsonb, 109),

    ('What can Pepper do with audit data?',
     'Pepper has seven read-only QSC tools: list_audits (filter by type/status/location), get_audit_report (full scored report), list_qsc_questions (search the 150-question bank), get_qsc_question (single code detail), list_audit_templates, get_audit_nc_trends (most frequently failed codes across audits for remediation priorities), and get_location_audit_history (timeline for one location). Ask "which codes fail most often?" or "show me the audit history for London Victoria".',
     'Audits', '["pepper","ai","tools","query","trends"]'::jsonb, 110)
    ON CONFLICT DO NOTHING;
  END $$`,

  // ── Step 132: Per-country price-level enablement ──────────────────────────
  // Lets admins disable specific price levels for specific countries. Every
  // component that renders price-level columns (Menus, Menu Engineer, Shared
  // pages, POS tester, dashboard charts) respects this by filtering
  // /price-levels?country_id=X. Missing junction row defaults to enabled, so
  // pre-feature behaviour is preserved on upgrade.
  `CREATE TABLE IF NOT EXISTS mcogs_country_price_levels (
     id              SERIAL PRIMARY KEY,
     country_id      INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE CASCADE,
     price_level_id  INTEGER NOT NULL REFERENCES mcogs_price_levels(id) ON DELETE CASCADE,
     is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
     created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (country_id, price_level_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_cpl_country ON mcogs_country_price_levels(country_id)`,
  `CREATE INDEX IF NOT EXISTS idx_cpl_level   ON mcogs_country_price_levels(price_level_id)`,

  // Seed: every existing (country, price_level) pair is enabled by default so
  // the first deploy doesn't change any visible behaviour.
  `INSERT INTO mcogs_country_price_levels (country_id, price_level_id, is_enabled)
   SELECT c.id, p.id, TRUE
   FROM   mcogs_countries c
   CROSS JOIN mcogs_price_levels p
   ON CONFLICT (country_id, price_level_id) DO NOTHING`,

  // ── Step 133: Regional markets (sub-country) ──────────────────────────────
  // Markets can optionally be scoped to one or more regions inside a country
  // via mcogs_market_regions. The regions catalog is keyed by ISO 3166-1
  // alpha-2 country code so it lives independently of the mcogs_countries
  // (a.k.a. "markets") table — you don't need a country-level market row
  // for a country in order to catalogue its regions, and multiple markets
  // under the same country_iso can each claim their own subset.
  //
  // Hard rule (enforced at the API layer in countries.js + regions.js):
  //   a market cannot cover regions that belong to a different country than
  //   its own country_iso. A market may cover no regions (country-wide) or
  //   any subset; it can never exceed its country.
  //
  // Regions CAN be claimed by multiple markets (no UNIQUE on region_id) —
  // franchise arrangements may overlap geographically.
  `CREATE TABLE IF NOT EXISTS mcogs_regions (
     id           SERIAL PRIMARY KEY,
     country_iso  VARCHAR(10) NOT NULL,         -- ISO 3166-1 alpha-2, e.g. 'US', 'GB'
     name         VARCHAR(120) NOT NULL,
     iso_code     VARCHAR(10),                  -- ISO 3166-2: "US-CA", "GB-SCT", "IN-KA"
     created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (country_iso, name)
   )`,

  // Legacy cleanup — if an earlier iteration of this feature left
  // mcogs_regions with country_id (FK to mcogs_countries) instead of
  // country_iso, upgrade in place: add country_iso, backfill from the
  // parent country's iso, then drop country_id. Runs BEFORE the indexes
  // on country_iso so they don't fail on a legacy schema.
  `DO $$
   BEGIN
     IF EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = 'mcogs_regions' AND column_name = 'country_id'
     ) THEN
       -- Ensure country_iso column exists (nullable for now) so the backfill
       -- has somewhere to write.
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'mcogs_regions' AND column_name = 'country_iso'
       ) THEN
         ALTER TABLE mcogs_regions ADD COLUMN country_iso VARCHAR(10);
       END IF;
       -- Backfill from the legacy FK.
       UPDATE mcogs_regions r
       SET    country_iso = UPPER(c.country_iso)
       FROM   mcogs_countries c
       WHERE  r.country_id = c.id
         AND  (r.country_iso IS NULL OR r.country_iso = '');
       -- Drop the legacy FK column + its UNIQUE(country_id, name) via CASCADE.
       ALTER TABLE mcogs_regions DROP COLUMN country_id CASCADE;
       -- Enforce NOT NULL now that every row has a value.
       IF NOT EXISTS (SELECT 1 FROM mcogs_regions WHERE country_iso IS NULL) THEN
         ALTER TABLE mcogs_regions ALTER COLUMN country_iso SET NOT NULL;
       END IF;
       -- Restore the UNIQUE on the new key pair.
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE  conname = 'mcogs_regions_country_iso_name_key'
       ) THEN
         ALTER TABLE mcogs_regions
           ADD CONSTRAINT mcogs_regions_country_iso_name_key UNIQUE (country_iso, name);
       END IF;
     END IF;
   END $$`,
  `ALTER TABLE mcogs_countries DROP COLUMN IF EXISTS parent_country_id`,

  `CREATE INDEX IF NOT EXISTS idx_regions_country_iso ON mcogs_regions(country_iso)`,
  `CREATE INDEX IF NOT EXISTS idx_regions_iso_code    ON mcogs_regions(iso_code)`,

  `CREATE TABLE IF NOT EXISTS mcogs_market_regions (
     id          SERIAL PRIMARY KEY,
     market_id   INTEGER NOT NULL REFERENCES mcogs_countries(id) ON DELETE CASCADE,
     region_id   INTEGER NOT NULL REFERENCES mcogs_regions(id)   ON DELETE CASCADE,
     created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (market_id, region_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_mr_market ON mcogs_market_regions(market_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mr_region ON mcogs_market_regions(region_id)`,

  // ── Step 133c: Hotfix — missing updated_at on mcogs_modifier_groups ────────
  // The translations commit (904d5b6) started selecting mg.updated_at in
  // api/src/routes/modifier-groups.js without adding the column, so
  // /api/modifier-groups has been returning 500 since that ship. The Sales
  // Items page loads modifier-groups for its combos/modifiers panels, so the
  // knock-on is the whole Sales Items page looks broken. Add the column with
  // a sensible default.
  `ALTER TABLE mcogs_modifier_groups ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`,

  // ── Step 134: Market-specific COGS thresholds ─────────────────────────────
  // Previously COGS colour thresholds lived only in mcogs_settings.data
  // (cogs_thresholds.excellent / .acceptable) — one global pair. Markets with
  // different margin profiles (e.g. UK quick-serve @ 28/35 vs Indian fine
  // dining @ 32/40) need their own cut-offs. Added as nullable columns on
  // mcogs_countries; NULL means "inherit the global default", so the first
  // deploy changes no behaviour.
  `ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS cogs_threshold_excellent  NUMERIC(5,2)`,
  `ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS cogs_threshold_acceptable NUMERIC(5,2)`,

  // ── Step 133b: Seed regions for common countries ───────────────────────────
  // Short catalog keyed by ISO 3166-1 alpha-2. Independent of whether a
  // country-level market exists for these ISOs — the regions catalog is
  // self-contained. Admins can extend via the Regions admin UI or the
  // standard-catalog import endpoint (POST /regions/import-standard).
  `INSERT INTO mcogs_regions (country_iso, name, iso_code) VALUES
     ('US','Alabama','US-AL'),('US','Alaska','US-AK'),('US','Arizona','US-AZ'),
     ('US','Arkansas','US-AR'),('US','California','US-CA'),('US','Colorado','US-CO'),
     ('US','Connecticut','US-CT'),('US','Delaware','US-DE'),('US','Florida','US-FL'),
     ('US','Georgia','US-GA'),('US','Hawaii','US-HI'),('US','Idaho','US-ID'),
     ('US','Illinois','US-IL'),('US','Indiana','US-IN'),('US','Iowa','US-IA'),
     ('US','Kansas','US-KS'),('US','Kentucky','US-KY'),('US','Louisiana','US-LA'),
     ('US','Maine','US-ME'),('US','Maryland','US-MD'),('US','Massachusetts','US-MA'),
     ('US','Michigan','US-MI'),('US','Minnesota','US-MN'),('US','Mississippi','US-MS'),
     ('US','Missouri','US-MO'),('US','Montana','US-MT'),('US','Nebraska','US-NE'),
     ('US','Nevada','US-NV'),('US','New Hampshire','US-NH'),('US','New Jersey','US-NJ'),
     ('US','New Mexico','US-NM'),('US','New York','US-NY'),('US','North Carolina','US-NC'),
     ('US','North Dakota','US-ND'),('US','Ohio','US-OH'),('US','Oklahoma','US-OK'),
     ('US','Oregon','US-OR'),('US','Pennsylvania','US-PA'),('US','Rhode Island','US-RI'),
     ('US','South Carolina','US-SC'),('US','South Dakota','US-SD'),('US','Tennessee','US-TN'),
     ('US','Texas','US-TX'),('US','Utah','US-UT'),('US','Vermont','US-VT'),
     ('US','Virginia','US-VA'),('US','Washington','US-WA'),('US','West Virginia','US-WV'),
     ('US','Wisconsin','US-WI'),('US','Wyoming','US-WY'),('US','District of Columbia','US-DC'),
     ('GB','England','GB-ENG'),('GB','Scotland','GB-SCT'),
     ('GB','Wales','GB-WLS'),('GB','Northern Ireland','GB-NIR'),
     ('CA','Alberta','CA-AB'),('CA','British Columbia','CA-BC'),
     ('CA','Manitoba','CA-MB'),('CA','New Brunswick','CA-NB'),
     ('CA','Newfoundland and Labrador','CA-NL'),('CA','Nova Scotia','CA-NS'),
     ('CA','Ontario','CA-ON'),('CA','Prince Edward Island','CA-PE'),
     ('CA','Quebec','CA-QC'),('CA','Saskatchewan','CA-SK'),
     ('CA','Northwest Territories','CA-NT'),('CA','Nunavut','CA-NU'),
     ('CA','Yukon','CA-YT'),
     ('IN','Andhra Pradesh','IN-AP'),('IN','Arunachal Pradesh','IN-AR'),
     ('IN','Assam','IN-AS'),('IN','Bihar','IN-BR'),('IN','Chhattisgarh','IN-CT'),
     ('IN','Delhi','IN-DL'),('IN','Goa','IN-GA'),('IN','Gujarat','IN-GJ'),
     ('IN','Haryana','IN-HR'),('IN','Himachal Pradesh','IN-HP'),
     ('IN','Jharkhand','IN-JH'),('IN','Karnataka','IN-KA'),('IN','Kerala','IN-KL'),
     ('IN','Madhya Pradesh','IN-MP'),('IN','Maharashtra','IN-MH'),
     ('IN','Manipur','IN-MN'),('IN','Meghalaya','IN-ML'),('IN','Mizoram','IN-MZ'),
     ('IN','Nagaland','IN-NL'),('IN','Odisha','IN-OR'),('IN','Punjab','IN-PB'),
     ('IN','Rajasthan','IN-RJ'),('IN','Sikkim','IN-SK'),('IN','Tamil Nadu','IN-TN'),
     ('IN','Telangana','IN-TG'),('IN','Tripura','IN-TR'),('IN','Uttar Pradesh','IN-UP'),
     ('IN','Uttarakhand','IN-UT'),('IN','West Bengal','IN-WB'),
     ('AU','New South Wales','AU-NSW'),('AU','Victoria','AU-VIC'),
     ('AU','Queensland','AU-QLD'),('AU','Western Australia','AU-WA'),
     ('AU','South Australia','AU-SA'),('AU','Tasmania','AU-TAS'),
     ('AU','Australian Capital Territory','AU-ACT'),
     ('AU','Northern Territory','AU-NT')
   ON CONFLICT (country_iso, name) DO NOTHING`,

  // ── Step 135: Location coordinates (for the country-region map widget) ────
  // Admin-2 polygons (city boundaries) aren't available as a clean world
  // dataset, so location-level cartography uses point markers instead. Capture
  // lat/lng on each location so the dashboard's country-region map can plot
  // franchise stores as pins over their country's regional polygons. Nullable
  // — existing rows keep working without coordinates, they simply aren't
  // plotted.
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS latitude  NUMERIC(10, 7)`,
  `ALTER TABLE mcogs_locations ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 7)`,

  // ── Step 136: Changelog entry — Mapbox integration + widget popout ────────
  // Idempotent: skips the insert if an entry with this (version, title) pair
  // already exists so re-running migrate.js doesn't duplicate the row.
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-23', 'Mapbox integration + dashboard map polish', '[
     {"type":"added","description":"MAPBOX_ACCESS_TOKEN added to the encrypted config store + aiConfig runtime cache; new GET /api/ai-config/mapbox-token endpoint serving the public token to the browser."},
     {"type":"added","description":"System \u2192 AI \u2192 Mapbox Integration card for saving / clearing the public token (pk.*)."},
     {"type":"added","description":"New dashboard widget mapbox-map \u2014 Mapbox GL JS world map with vector tiles, hover feature-state, clean country choropleth, Countries / Regions toggle, design-token popup styling."},
     {"type":"added","description":"New dashboard widget mapbox-country-map \u2014 zoomed-in Mapbox view of the selected market\u2019s country with admin-1 region polygons, accent-green country outline, and city pins for locations with captured lat/lng."},
     {"type":"added","description":"WidgetPopoutContext / useIsWidgetPopout hook \u2014 widgets can detect when rendered in the standalone popout window; both Mapbox widgets auto-enable fullscreen so the popped-out window is maximised."},
     {"type":"added","description":".mapbox-widget CSS overrides in index.css so Mapbox popups, nav controls and attribution pick up design tokens (rounded, accent colours, Nunito)."},
     {"type":"added","description":"useMapboxToken hook with module-level cache so multiple map widgets share one /ai-config fetch."},
     {"type":"changed","description":"Existing MarketMap widget: Regions toggle disabled \u2014 country-level only (the Mapbox widgets now cover the regions use case)."},
     {"type":"changed","description":"Mapbox world map Regions view now only colours countries at the base layer when they have whole-country markets, so region-scoped countries (e.g. 4 Indian states claimed) no longer show as solid green underneath."},
     {"type":"fixed","description":"MapboxMap guards against sk.* secret tokens with a friendly \u201CWrong token type\u201D message instead of Mapbox GL\u2019s raw error."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-23' AND title = 'Mapbox integration + dashboard map polish'
   )`,

  // ── Step 137: Changelog — Dashboard DnD + row-span + costing method + map polish ──
  // Idempotent via WHERE NOT EXISTS on (version, title).
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-23', 'Dashboard drag-and-drop + multi-row widgets + new costing method', '[
     {"type":"added","description":"Dashboard widgets are draggable in edit mode via native HTML5 DnD \u2014 grab anywhere on the tile (or the \u2820 handle next to the rename input) to reorder. Source tile dims to 40% opacity; hovered drop target shows an accent-ringed outline. Keyboard \u2191 / \u2193 buttons kept as a fallback."},
     {"type":"added","description":"Widgets can now span multiple rows. New WidgetHeight = 1 | 2 | 3 type + SlotConfig.rowSpan override + WidgetMeta.defaultRowSpan / allowedRowSpans. Editing toolbar gets a new \u201C\u00d7 H\u201D selector next to the existing width selector. Maps default to 3\u00d7H, charts/tables 2\u00d7H, KPIs 1\u00d7H."},
     {"type":"changed","description":"Dashboard grid now uses grid-auto-rows: minmax(160px, auto) with grid-auto-flow: row dense so smaller widgets backfill gaps left by tall row-span widgets. Width-selector labels clarified to \u201C\u00bc W / \u00bd W / \u00be W / Full W\u201D."},
     {"type":"added","description":"Recipe Costing Method setting (mcogs_settings.data.costing_method). Preferred vendor quotes always win; the setting controls the fallback \u2014 \u201cbest\u201d (cheapest active quote, default + historical) or \u201caverage\u201d (arithmetic mean of all active quotes in the market, FX-normalised per vendor). Exposed in Settings \u2192 Thresholds tab as a new \u201cRecipe Costing Method\u201d section."},
     {"type":"changed","description":"loadQuoteLookup() in cogs.js now computes price_per_base_unit in SQL (not JS) so AVG(p/q/fx) is mathematically correct for the new average method. All existing callers pick up the setting automatically \u2014 no API changes."},
     {"type":"changed","description":"getEffectivePrice / getEffectivePricesBulk in effectivePrice.js mirror the same semantics; also exports COSTING_METHODS + resolveCostingMethodFromSettings for callers that need to branch explicitly."},
     {"type":"added","description":"MapboxCountryMap: focus-country masking. A fill layer covers every country whose ISO \u2260 the focused one (surface-2 at 0.95 opacity), and country-label / state-label / settlement-major-label / natural-point / water-point / airport labels are filtered to the focused country only. Water bodies around the focused country stay visible."},
     {"type":"changed","description":"Height defaults tuned per widget: mapbox-map / mapbox-country-map / market-map / country-region-map / menu-top-items default to 3\u00d7H, menu-tiles / market-picker / market-stats / missing-quotes / recent-quotes / new-ingredient / new-price-quote default to 2\u00d7H, KPIs and banners stay at 1\u00d7H."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-23' AND title = 'Dashboard drag-and-drop + multi-row widgets + new costing method'
   )`,

  // ── Step 138: Changelog — Seed validator + Excel template download fix ────
  // Idempotent via WHERE NOT EXISTS on (version, title).
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-23', 'Excel import template download fix + seed/clear validator', '[
     {"type":"fixed","description":"Import wizard \u201CDownload template.xlsx\u201D was returning a 401 / \u201Cfile not available\u201D error. Root cause: the button used a bare <a href> which skipped the Auth0 bearer token. Replaced with an authenticated fetch + Blob + programmatic download. Clear error messages for 401 (session expired) and other HTTP statuses route into the existing parseError banner."},
     {"type":"added","description":"New npm script \u0060npm run validate:seed\u0060 in api/ \u2014 one-shot end-to-end validator for clearData() + seedSmall() + mcogs_import_jobs round-trip. Snapshots preserved-table row counts, asserts clear leaves user tables empty and preserved tables untouched, runs seedSmall and reports row counts for 11 core tables, then re-clears to leave the DB neutral. Safe to run repeatedly."},
     {"type":"changed","description":"Preserve-list comment in both seed-test-data.js and seed-test-data-small.js updated to explicitly list mcogs_settings / mcogs_changelog / mcogs_languages / mcogs_regions / mcogs_qsc_questions / mcogs_qsc_templates (previously implicitly preserved but undocumented). Also documents that mcogs_qsc_audits + children cascade-truncate via mcogs_locations despite ON DELETE SET NULL."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-23' AND title = 'Excel import template download fix + seed/clear validator'
   )`,

  // ── Step 139: Changelog — Mobile Pepper + categories DnD + shortcut widget ──
  // Idempotent via WHERE NOT EXISTS.
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-24', 'Mobile Pepper (voice + camera + kitchen mode), configurable shortcut widget, categories DnD, Recipes/Inventory CalcInput rollout', '[
     {"type":"added","description":"Mobile-first Pepper on PWA \u2014 full-viewport sheet below the sm: breakpoint (640px), 44px tap targets, larger fonts, dock buttons hidden. Powered by new useIsMobile + useKeyboardInset hooks (visualViewport API keeps the chat input above the on-screen keyboard). Dedicated camera button with capture=\\"environment\\" hits the native camera app on iOS/Android; reuses /api/ai-upload to stage receipt imports."},
     {"type":"added","description":"Voice input (push-to-talk) \u2014 new useVoiceInput hook. Chromium browsers use native SpeechRecognition (free, on-device); Safari/iOS fall back to MediaRecorder \u2192 POST /api/ai-transcribe (new Whisper proxy route). Pre-existing input text is preserved so transcripts append instead of overwrite."},
     {"type":"added","description":"Voice output (sentence-buffered TTS) \u2014 new useVoiceOutput hook. Feeds SSE text chunks into speechSynthesis, splitting on sentence boundaries. Markdown is stripped before speaking. Speaker toggle in the Pepper header, persisted to localStorage (pepper-tts-enabled)."},
     {"type":"added","description":"Kitchen Mode toggle in the Pepper header \u2014 applies a body.kitchen-mode class with 17px font-size and 44px min-heights across all design-token components. Persisted to localStorage (pepper-kitchen-mode). Global across the whole app, not just Pepper."},
     {"type":"added","description":"OPENAI_API_KEY added to the encrypted config store + aiConfig status flag (openai_key_set). Settings \u2192 AI gains a new Whisper configuration card explaining that the key is only needed for Safari/iOS voice input."},
     {"type":"added","description":"POST /api/ai-transcribe \u2014 new multipart endpoint, gated by ai_chat:read, proxies audio (<=25MB) to OpenAI Whisper. Returns 503 when no key is configured so the client can degrade gracefully."},
     {"type":"added","description":"Quick Links (shortcut) widget fully customisable in dashboard edit mode: per-link width (\u00bc/\u00bd/\u00be/full), per-link height (1/2/3 rows), drag-to-reorder, add from catalog, remove, reset to defaults. Hard-respects RBAC (can(feature,read)) and global feature flags (hides links for disabled modules, with loading-state flash-guard). Config persists to localStorage (cogs-quick-links-v1) with auto-rehydration against the catalog so renamed routes pick up new hrefs automatically."},
     {"type":"added","description":"WidgetEditingProvider / useIsWidgetEditing context \u2014 lets widgets detect when the dashboard is in Customise mode and switch to their own inline-edit UI (consumed by Quick Links; any future widget can opt in)."},
     {"type":"added","description":"Categories page drag-and-drop: drag rows to reorder within a group, drop onto a group sidebar item to move. Backend POST /categories/reorder (idempotent batch update of group_id + sort_order) wraps the full batch in a transaction. Page auto-follows a moved category to its new group."},
     {"type":"added","description":"Categories page scope filter \u2014 4 mutually-exclusive chips (All / Inventory / Recipes / Sales) in the right-panel header, combined with the existing group filter."},
     {"type":"added","description":"Continue a staged import panel on the Import page \u2014 lists the user\u2019s unfinished import jobs (staging/ready/failed) with counts + filename + status, Resume and Discard buttons. Restore flow mirrors the existing ?job= URL deep-link from Pepper."},
     {"type":"added","description":"list_import_jobs Pepper tool \u2014 user can ask \\"what imports do I have pending?\\" and Pepper lists them with clickable /import?job=<id> URLs. Respects per-user scoping via userCtx.email."},
     {"type":"added","description":"start_import attributes Pepper-staged jobs to the current user\u2019s email so they appear in the Continue panel and in list_import_jobs output."},
     {"type":"added","description":"CalcInput extended with onKeyDown + onBlur + autoFocus + style pass-through; Enter now evaluates the expression before firing the caller\u2019s handler. Wired into 7 numeric fields on RecipesPage (yield_qty, prep_qty x2, prep_to_base x2, itemPanel x2, inline tile price) and 9 numeric fields on InventoryPage (purchase_price x4, qty_in_base_units x4, nutrition loop)."},
     {"type":"fixed","description":"Sidebar flash of disabled modules (Fix 25) \u2014 feature-flag DEFAULTS were all-true, causing disabled modules to briefly appear and then disappear once /settings returned. Sidebar now hides flag-gated items while flagsLoading is true; safe degradation on fetch failure (defaults surface after 1 tick)."},
     {"type":"fixed","description":"Imported categories appeared invisible (Fix 26) \u2014 categories created via the Import wizard land with group_id = null; the No Group bucket was hidden until clicked and at the bottom of the sidebar. Now hoisted to the top, always visible, and auto-selected on first load when ungrouped categories exist."},
     {"type":"fixed","description":"Categories DnD optimistic reorder appeared to do nothing (Fix 27) \u2014 visibleCats filter didn\u2019t sort by sort_order, so state updates didn\u2019t reorder the list. Added [...list].sort((a,b) => a.sort_order - b.sort_order || a.id - b.id) inside the useMemo."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-24' AND title = 'Mobile Pepper (voice + camera + kitchen mode), configurable shortcut widget, categories DnD, Recipes/Inventory CalcInput rollout'
   )`,

  // ── Step 140: Jira 2-way sync — remote-updated-at columns ──────────────────
  // Timestamp columns let us detect which side is newer when pulling, so we
  // only overwrite local data when Jira is actually more recent. Without this
  // a manual pull could stomp on a freshly-edited local description with an
  // older Jira state.
  `DO $$ BEGIN ALTER TABLE mcogs_bugs    ADD COLUMN jira_remote_updated_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$`,
  `DO $$ BEGIN ALTER TABLE mcogs_backlog ADD COLUMN jira_remote_updated_at TIMESTAMPTZ; EXCEPTION WHEN duplicate_column THEN NULL; END $$`,

  // ── Step 141: Changelog — Jira 2-way sync + cron + UI banner ───────────────
  // Idempotent via WHERE NOT EXISTS on (version, title).
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-24', 'Jira 2-way sync (broader pull + 15-min cron + Sync banner)', '[
     {"type":"added","description":"Jira pull now syncs summary + description + labels back to COGS (previously only status + priority). Uses Atlassian Document Format (ADF) flatten helper in jira.js (paragraphs, headings, hardBreaks, bullet/ordered lists)."},
     {"type":"added","description":"Timestamp-based conflict resolution: the pull only overwrites text fields when Jira\u2019s updated timestamp is newer than the local updated_at. Freshly-edited local rows are preserved; next push sends them up instead."},
     {"type":"added","description":"jira_remote_updated_at column on mcogs_bugs + mcogs_backlog via migration step 140 \u2014 stores the last known Jira-side updated_at for conflict detection and \u201cJira is newer\u201d hints in the UI."},
     {"type":"added","description":"Every-15-minute pull cron (api/src/jobs/syncJira.js, */15 * * * * scheduled in index.js). Calls the shared syncAll() helper; no-op when Jira isn\u2019t configured. Only logs on changes or errors so healthy cycles don\u2019t spam the log."},
     {"type":"added","description":"Sync status persistence in mcogs_settings.data.jira_sync_status \u2014 tracks trigger (cron|manual), startedAt, finishedAt, durationMs, pulled count, changedCount, and errors. Lets the UI report \u201cLast synced N min ago.\u201d"},
     {"type":"added","description":"GET /api/jira/sync-status \u2014 new endpoint returning {configured, status} for the Bugs & Backlog banner."},
     {"type":"added","description":"JiraSyncBanner on the Bugs & Backlog page: one-line status strip with trigger source, last-run timestamp, counts, errors, and a Sync Now button. Shown only when Jira is configured AND at least one item is linked (no useless \u201cnever synced\u201d noise)."},
     {"type":"changed","description":"POST /api/jira/pull/all now delegates to syncAll({trigger:manual}) so both the cron path and the Sync Now button produce the same shape of sync-status log."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-24' AND title = 'Jira 2-way sync (broader pull + 15-min cron + Sync banner)'
   )`,

  // ── Step 142: Changelog — BACK-1942 Sales Items Excel view ─────────────────
  // Idempotent via WHERE NOT EXISTS.
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-24', 'Sales Items: Excel grid view with inline editing (BACK-1942)', '[
     {"type":"added","description":"Excel view mode on the Sales Items page \u2014 dense spreadsheet grid with 4 frozen left columns (Name, Display, Type, Category), one column per price level, one column per country for market toggles, and a trailing actions column. Matches the Menu Engineer Excel aesthetic (12px cell font, #e5e7eb borders, gray/green/blue header bands)."},
     {"type":"added","description":"View-mode toggle (List | Excel) in the Sales Items toolbar \u2014 persisted per browser (localStorage key sales-items-view-mode). Three-button pattern reused from SharedMenuPage."},
     {"type":"added","description":"Inline cell editing with auto-save on blur / Enter: Name, Display Name, Category, Default Prices (per level), Market visibility (per country). Optimistic UI updates with rollback on failure + toast. Amber cell background + small ⟳ dot while a PUT is in flight."},
     {"type":"added","description":"GET /api/sales-items?include_prices=true \u2014 new query param attaches mcogs_sales_item_prices rows to each item in one batched JOIN so the Excel view renders from a single round-trip (no N+1)."},
     {"type":"added","description":"CSS position:sticky-based frozen columns (Name, Display, Type, Category) that pin during horizontal scroll through price + market columns. Requires borderCollapse:separate to prevent border bleed."},
     {"type":"added","description":"Row delete action in Excel view. Row duplicate + reorder deliberately deferred to a follow-up ticket; Linked Item + Description + Image inline edits stay in the side panel since they need complex comboboxes / textareas that don\u2019t fit a cell."},
     {"type":"added","description":"BACK-1942 marked done in production via the internal API."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-24' AND title = 'Sales Items: Excel grid view with inline editing (BACK-1942)'
   )`,

  // ── Step 143: Bugs (resolved this session) ────────────────────────────────
  // Idempotent via ON CONFLICT (key) DO NOTHING.
  `INSERT INTO mcogs_bugs (key, summary, description, priority, severity, status, labels, page, resolution) VALUES
    ('BUG-1024', 'MediaLibrary modal rendered behind ImageUpload modal',
     'When opening Browse Library from inside the recipe image upload modal, the library appeared underneath. Modal stacking was z-50 vs the ui.tsx Modal at z-[9999].',
     'medium', 'minor', 'resolved', '["recipes","media","modal-stacking"]'::jsonb, 'Recipes',
     'Bumped MediaLibrary modal portal to z-[10000] so it stacks above any other ui.tsx Modal.'),
    ('BUG-1025', 'GET /api/recipes/:id missing image_url field',
     'Recipe detail SELECT did not include r.image_url, so even though PUT saved the URL correctly, loadDetail() re-read it as undefined and the header thumbnail always fell back to the placeholder. Made image upload look broken.',
     'high', 'major', 'resolved', '["recipes","api","sql"]'::jsonb, 'Recipes',
     'Added r.image_url to the SELECT list in GET /recipes/:id.')
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 144: Backlog (done this session) ─────────────────────────────────
  // Captures every feature shipped — including ones the user requested
  // mid-session without a pre-filed ticket (per EOS retrospective sweep).
  `INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
    ('BACK-1953', 'Recipe detail page redesign',
     'Eight-item restructuring of the recipe detail panel: inline-edit name + yield + portion name in the header (replaces standalone Edit modal); image thumbnail icon before the name with click-to-open modal (change/remove image); CategoryPicker after recipe name (with allowCreate=false to suppress overkill + New); inline Notes section after Linked Sales Items; Market + Price Level + Currency selectors moved below KPIs to a slim toolbar above ingredients; conversion column dropped, qty column inline-editable via CalcInput.',
     'epic', 'high', 'done', '["recipes","ui","redesign"]'::jsonb, 1953),
    ('BACK-1954', 'Global Display Currency + Language switchers in top bar',
     'New CurrencyContext + CurrencyProvider + CurrencySwitcher (banknote icon, "Show prices in" label). Mounted alongside MarketSwitcher in AppLayout top bar with explicit "Market" / "Show prices in" / "Language" labels. RecipesPage and MenusPage Menu Engineer wired to consume the global context — local Display Currency dropdowns removed from both pages. LanguageSwitcher moved from Sidebar footer to top bar. Selection persisted via localStorage("cogs-display-currency").',
     'story', 'high', 'done', '["currency","i18n","layout"]'::jsonb, 1954),
    ('BACK-1955', 'Auto-derive variantMode from Market+PriceLevel selection',
     'Removed redundant 🌍 Market / 💰 PL / 🌍💰 Market+PL toggle buttons from the ingredients header. variantMode now computed via useMemo from (selectedCountryId, selectedPriceLevelId): Market only → market, PL only → price-level, both → market-pl, neither → global. Contextual Create / Copy-to-Global / Delete Variation buttons live next to the selectors that drive them. activeItems gained a fallback chain (specific → market → PL → global) so the displayed list matches what the variant pill claims when no exact-match variation exists.',
     'story', 'high', 'done', '["recipes","variations"]'::jsonb, 1955),
    ('BACK-1956', 'Copy Ingredients modal + Alt+I shortcut for Add Ingredient',
     '+ Copy Ingredients button opens a two-step modal: pick a source recipe (with search), then pick a specific source variant (Global / Market / PL / Market+PL) shown as radio rows with item counts. "Copy N items" appends them into the currently active variant of the target recipe via the appropriate POST endpoint. Generic AltShortcut helper (skips when typing in inputs) wires Alt+I to openAddIngredient when a recipe is selected and no other modal is open.',
     'story', 'medium', 'done', '["recipes","productivity"]'::jsonb, 1956),
    ('BACK-1957', 'CreateVariationModal replaces window.confirm/prompt',
     'New app-style modal for creating variations — replaces the ugly browser confirm + prompt dialogs (which silently created empty variations on blank prompt input). Radio rows show available copy sources with item counts; defaults to first available source (market > PL > global > empty); disables sources with no items. Single component handles all three variation types (Market, PL, Market+PL).',
     'story', 'medium', 'done', '["recipes","ux","variations"]'::jsonb, 1957),
    ('BACK-1958', 'Recipe ingredient qty display capped at 3 decimals',
     'New fmtQty() helper rounds to 3dp and strips trailing zeros (4000.00000000 → "4000", 1.00000000 → "1", 0.001 → "0.001"). Applied to the inline-edit CalcInput in the recipe ingredients table. Phantom-PUT guard added to saveItemQtyInline: differences below 0.0005 are treated as no-op so opening + blurring an unchanged cell does not silently truncate DB-side precision past the 3rd decimal.',
     'task', 'medium', 'done', '["recipes","ui"]'::jsonb, 1958),
    ('BACK-1959', 'CategoryPicker allowCreate prop',
     'Added allowCreate prop (default true) to CategoryPicker. When false the inline + New button is suppressed — used on the recipe header where creating a category from the dropdown is overkill (full categories admin is one click away).',
     'task', 'low', 'done', '["recipes","ui","ux"]'::jsonb, 1959),
    ('BACK-1960', 'EOS protocol — retrospective backlog sweep',
     'Updated CLAUDE.md End-of-Session protocol step 2 to require sweeping for items that were worked on but never logged. Each fix or feature shipped during the session must be matched against existing mcogs_bugs / mcogs_backlog rows; if not present, seed one with terminal status (resolved / done) so the audit trail is complete even when the user requested work mid-session without a pre-filed ticket. Pending hand-off tasks get seeded in non-terminal status.',
     'task', 'medium', 'done', '["process","claude-md"]'::jsonb, 1960)
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 145: Backlog (paused for EOS — pending follow-up) ────────────────
  // User asked for these mid-session but paused to run EOS first. Seeded
  // with non-terminal status so they don't fall off the board.
  `INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
    ('BACK-1961', 'Inventory: + Quote button should not switch tabs',
     'Clicking + Quote on an ingredient row currently switches the user to the Price Quotes tab and opens the Add Quote modal. The user expects the Add Quote modal to appear over the Ingredients tab instead, so they keep their context. Likely fix: render a global Add Quote modal at the InventoryPage level (or always-mount PriceQuotesTab in a hidden container) so the modal portal opens on top of the active tab without a tab switch.',
     'task', 'medium', 'todo', '["inventory","ux"]'::jsonb, 1961),
    ('BACK-1962', 'Inventory: grid view default + fixed table header',
     'Default the Ingredients and Price Quotes tabs to the grid view (currently default to list). Make column headers stick to top while body scrolls (position: sticky on the thead row, so headers stay visible during long scroll). Apply to both tabs.',
     'story', 'medium', 'todo', '["inventory","ui"]'::jsonb, 1962)
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 147: Bugs (resolved this session) ────────────────────────────────
  `INSERT INTO mcogs_bugs (key, summary, description, priority, severity, status, labels, page, resolution) VALUES
    ('BUG-1026', 'Sub-recipe yield unit displayed as generic "portion"',
     'When a sub-recipe is added as an ingredient in a parent recipe, the unit shown next to the qty was the hardcoded word "portion" / "portions" instead of the sub-recipe''s actual yield_unit_text. e.g. a "Blue Cheese Dip Batch" with yield_unit_text="50ml portion" still rendered as "1 portion" in the parent recipe.',
     'medium', 'minor', 'resolved', '["recipes","ui"]'::jsonb, 'Recipes',
     'Backend GET /recipes/:id queries (global + 3 variations) now select COALESCE(sr.yield_unit_text, su.abbreviation) AS sub_recipe_yield_unit (joining mcogs_units via sr.yield_unit_id). Frontend RecipeItem interface gained sub_recipe_yield_unit; ingredient table + comparison view fall back through prep_unit → base_unit_abbr → sub_recipe_yield_unit → "portion".')
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 148: Backlog (done this session) ─────────────────────────────────
  `INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
    ('BACK-1963', 'Dashboard widget: Unquoted Ingredients in Recipes (with optional menu filter)',
     'New dashboard widget "recipe-unquoted-ingredients" that lists ingredients used in at least one recipe but without any active price quote. Different from the existing "missing-quotes" widget which lists *all* unquoted ingredients (including orphaned catalog rows that no recipe references). Backed by a new endpoint GET /api/ingredients/unquoted-in-recipes?menu_id=<id> — optional menu filter narrows the list to ingredients used by recipes that the menu serves (via mcogs_menu_sales_items → mcogs_sales_items.recipe_id). Combo recipes within sales items are not traversed in v1. Empty state shows a "Full coverage" badge. Each row shows ingredient name, category, recipe count + names (when ≤3), and base unit. Registered in types.ts + templates.ts; defaultSize=md, allowedSizes=md/lg/xl, marketScoped=false, defaultRowSpan=2.',
     'story', 'medium', 'done', '["dashboard","widgets","reporting"]'::jsonb, 1963),
    ('BACK-1964', 'Recipe duplicate (full clone)',
     'New POST /api/recipes/:id/duplicate endpoint clones a recipe end-to-end in a single transaction: recipe row (name overridden, everything else preserved — category_id, description, yield_qty, yield_unit_id, yield_unit_text, image_url, translations); global items; every market variation + its items; every PL variation + its items; every market+PL variation + its items. Sort order preserved. Audit log entry tagged source="duplicate" with source_recipe_id. Frontend gets a "Duplicate" button (Copy icon, btn-outline) next to Delete in the recipe header. App modal pre-fills the new name with "<original> (Copy)"; Enter to confirm, Esc/Cancel to dismiss; "Duplicating…" while in flight; on success the new row appears in the alphabetically-sorted left list and the detail panel auto-loads it.',
     'story', 'high', 'done', '["recipes","productivity"]'::jsonb, 1964)
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 149: Changelog — recipe duplicate + new widget + sub-recipe unit ─
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-25', 'Recipe duplicate + Unquoted-in-Recipes widget + sub-recipe yield unit', '[
     {"type":"added","description":"Recipe duplicate (BACK-1964). New POST /api/recipes/:id/duplicate clones a recipe end-to-end in a single transaction — recipe row + global items + every market / PL / market+PL variation with its items (sort_order preserved, translations carried). Frontend Duplicate button (Copy icon, btn-outline) next to Delete in the recipe header. App modal pre-fills the name with “<original> (Copy)”; Enter to confirm, Esc/Cancel to dismiss. On success the new recipe loads in the detail panel and the left list re-sorts."},
     {"type":"added","description":"Dashboard widget: Unquoted Ingredients in Recipes (BACK-1963). Lists ingredients that appear in at least one recipe but have no active price quote — differs from the existing Missing Price Quotes widget by ignoring orphaned catalog rows. Optional menu filter narrows to recipes used by a specific menu (via mcogs_menu_sales_items → sales_items.recipe_id). Backed by GET /api/ingredients/unquoted-in-recipes?menu_id=<id>. Add via dashboard customise mode → + Add widget."},
     {"type":"fixed","description":"BUG-1026: sub-recipe yield unit not displayed. When a sub-recipe was added as an ingredient in a parent recipe, the unit shown was the hardcoded word “portion” instead of the sub-recipe''s actual yield_unit_text. Backend GET /recipes/:id queries (global + 3 variations) now select COALESCE(sr.yield_unit_text, su.abbreviation) AS sub_recipe_yield_unit; frontend falls back through prep_unit → base_unit_abbr → sub_recipe_yield_unit → “portion”. A “Blue Cheese Dip Batch” sub-recipe with yield_unit_text=“50ml portion” now correctly displays “50ml portion” in the parent recipe ingredients list."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-25' AND title = 'Recipe duplicate + Unquoted-in-Recipes widget + sub-recipe yield unit'
   )`,

  // ── Step 146: Changelog — recipe redesign + global switchers + hotfixes ───
  // Idempotent via WHERE NOT EXISTS.
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-25', 'Recipe detail redesign + global Display Currency / Language top bar', '[
     {"type":"changed","description":"Recipe detail page redesigned (BACK-1953). Header now has an image thumbnail, inline-edit name + yield qty + yield unit, CategoryPicker, and a delete button — the standalone Edit button is gone. Notes section moved out of the header into its own inline-editable card after Linked Sales Items. Market + Price Level + Currency selectors moved from above the KPI tiles down to a slim toolbar just above the Ingredients table, where the Create / Copy-to-Global / Delete Variation buttons live too."},
     {"type":"changed","description":"Variant mode is now auto-derived from the Market + Price Level selection (BACK-1955). Removed the redundant 🌍 Market / 💰 PL / 🌍💰 Market+PL toggle buttons; the combination of selectors fully determines which variant is active. activeItems now falls back specific → market → PL → global so the displayed list matches the pill (no more “shows global ingredients but pill says Market Variation” divergence)."},
     {"type":"added","description":"Global Display Currency switcher (BACK-1954) in the top bar — banknote icon, label “Show prices in”. New CurrencyContext exposes the user-selected currency code; RecipesPage and MenusPage Menu Engineer consume it via useCurrency() and the local Display Currency dropdowns are gone. LanguageSwitcher moved from Sidebar footer to the top bar. All three top-bar switchers (Market / Show prices in / Language) now have explicit labels."},
     {"type":"added","description":"Copy Ingredients modal (BACK-1956) — pick a source recipe, then a specific variant (Global / Market / PL / Market+PL) with item counts, Copy N items into the active variant on the target recipe. Alt+I keyboard shortcut opens Add Ingredient when a recipe is selected and no other modal is open."},
     {"type":"added","description":"CreateVariationModal (BACK-1957) replaces the old window.confirm + window.prompt dialogs. Radio rows show available copy sources with item counts; defaults to the first available source so blank input never silently creates an empty variation."},
     {"type":"added","description":"Inline-editable Quantity column (BACK-1958) on the recipe ingredients table — CalcInput supports math expressions (4000/8 → 500). Display capped at 3 decimal places via fmtQty() with trailing-zero stripping; phantom-PUT guard treats sub-millisecond differences as no-op so opening + blurring an unchanged cell does not silently truncate stored precision."},
     {"type":"added","description":"CategoryPicker allowCreate prop (BACK-1959). Default true; recipe header passes false to suppress the + New button (creating a category from a recipe header is overkill)."},
     {"type":"changed","description":"Variant pill text clarified: “🌍💰 United Kingdom · Delivery” → “✦ Variation: United Kingdom · Delivery”. Global pill now reads “🌍 Global recipe”."},
     {"type":"fixed","description":"BUG-1024: MediaLibrary modal rendered behind the recipe image modal. Bumped the library portal to z-[10000] so it stacks above any other ui.tsx Modal."},
     {"type":"fixed","description":"BUG-1025: image upload looked broken because GET /api/recipes/:id was not selecting r.image_url, so loadDetail() re-read the field as undefined after a successful PUT. SELECT now includes image_url."},
     {"type":"changed","description":"EOS protocol step 2 (BACK-1960) — retrospective sweep. Each fix or feature shipped during a session must be matched against the bug + backlog tables; if not present, seed it with terminal status so the audit trail is complete. Pending hand-off tasks get seeded in non-terminal status so nothing falls off the board."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-25' AND title = 'Recipe detail redesign + global Display Currency / Language top bar'
   )`,

  // ── Step 150: BACK-1962 done — Inventory grid default + sticky headers ────
  // BACK-1962 was seeded as 'todo' in step 145; now shipped, flip to done.
  // Idempotent — only updates if still in a non-terminal state.
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-1962' AND status <> 'done'`,

  // ── Step 151: Changelog — Inventory grid default + sticky headers ─────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-25', 'Inventory: grid view default + sticky table headers (BACK-1962)', '[
     {"type":"changed","description":"Inventory Ingredients and Price Quotes tabs now default to grid view (was list). Choice persists per browser via localStorage keys inventory-ingredients-view and inventory-quotes-view, so returning users see whichever view they last picked."},
     {"type":"added","description":"Sticky column headers across Inventory tabs — DataGrid HeaderCell, ColumnHeader, and the standalone list-view tables (missing-quotes view, ingredient list view, quotes list view) all gained position:sticky, top:0 with bg-surface-2 / bg-gray-200. Headers stay pinned at the top during long vertical scrolls instead of disappearing off-screen."},
     {"type":"changed","description":"BACK-1962 marked done."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-25' AND title = 'Inventory: grid view default + sticky table headers (BACK-1962)'
   )`,

  // ── Step 152: BACK-1001 done — drop mcogs_categories.group_name ───────────
  // Legacy VARCHAR column kept for back-compat once mcogs_category_groups +
  // group_id FK became canonical (back in migration step 81). Verified all
  // current routes resolve "group_name" via the JOIN to mcogs_category_groups
  // (categories.js, ingredients.js, recipes.js, sales-items.js, ai-chat.js,
  // combos.js) — no INSERT/UPDATE writes to the legacy column anywhere. Safe
  // to drop. Idempotent via IF EXISTS.
  `ALTER TABLE mcogs_categories DROP COLUMN IF EXISTS group_name`,

  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-1001' AND status <> 'done'`,

  // ── Step 153: BACK-1961 done — + Quote stays on Ingredients tab ───────────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-1961' AND status <> 'done'`,

  // ── Step 154: Changelog — BACK-1001 + BACK-1961 ───────────────────────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-25', 'BACK-1001 (group_name drop) + BACK-1961 (+ Quote stays on tab)', '[
     {"type":"removed","description":"BACK-1001: dropped the legacy mcogs_categories.group_name VARCHAR column. group_id FK to mcogs_category_groups has been the canonical mechanism since migration step 81 — every read path already resolves the human-readable name via JOIN. Verified no INSERT/UPDATE writes to the column anywhere; CategoriesPage UI already reads group_name from the JOIN response, not the column. ALTER TABLE DROP COLUMN IF EXISTS in step 152 is idempotent."},
     {"type":"changed","description":"BACK-1961: clicking + Quote on an ingredient row no longer switches the user to the Price Quotes tab. The Add Quote modal now appears over the Ingredients tab instead, so the user keeps their context and the modal is just a popover, not a tab switch + UI shift."},
     {"type":"changed","description":"Both items marked done."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-25' AND title = 'BACK-1001 (group_name drop) + BACK-1961 (+ Quote stays on tab)'
   )`,

  // ── Step 155: Changelog — Kanban + Suggest Priorities + widget click-to-add-quote + Pepper backlog tools + LanguageSwitcher fix + QuickLinks column layout
  // No new mcogs_backlog rows for these — user requested no backlog noise for this batch.
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-25', 'Backlog Kanban + AI Suggest Priorities + widget click-to-add-quote + Pepper backlog tools', '[
     {"type":"added","description":"Backlog Kanban view on the Bugs & Backlog page. View toggle (☰ List | ▦ Kanban), persisted per browser. Five priority columns (Highest / High / Medium / Low / Lowest) with native HTML5 drag-and-drop between columns; drop fires PUT /api/backlog/:id { priority } with optimistic state + rollback on failure. Each tile also has an inline status dropdown (dev-only — server gates) with colour-coded states for todo / in_progress / in_review / done / wont_do / backlog. Tile click opens the existing detail modal."},
     {"type":"added","description":"AI Suggest Priorities. New POST /api/backlog/suggest-priorities (dev-only) loads up to 200 open backlog items, calls Claude Haiku 4.5 with a conservative prompt, returns structured proposals JSON: {summary, proposals: [{key, current, proposed, reasoning}]}. Server-side validation drops invalid / unchanged proposals. Frontend ✨ Suggest Priorities button in the kanban toolbar opens a modal with all proposals pre-checked; user toggles individual rows or uses Select all / Clear all; Apply N changes batches PUT /backlog/:id calls. AI call logged to mcogs_ai_chat_log."},
     {"type":"added","description":"Pepper get_backlog_stats tool — returns aggregate counts grouped by status / priority / item_type via cheap COUNT queries. Use this for how-many questions instead of list_backlog. list_backlog itself bumped: default 30→50, max 100→500; response now includes {total, returned, truncated, rows}; description column dropped from default SELECT to cut token use. Avoids the previous 5-minute hang where Pepper iterated through paginated results."},
     {"type":"added","description":"Dashboard widget click-to-add-quote: Missing Price Quotes and Unquoted in Recipes tiles are now buttons that navigate to /inventory?addQuote=<ingredient_id>. InventoryPage reads the param via useSearchParams, sets autoOpenAddIngId, and strips the param via { replace: true } so reload does not re-open the modal. Combined with BACK-1961 the modal opens over the Ingredients tab without a tab switch."},
     {"type":"added","description":"Quick Links widget Grid/Column layout toggle in edit mode. Column mode forces every tile to col-span-12 regardless of per-tile width, giving a single-column list layout. Persisted to localStorage(cogs-quick-links-layout). Per-tile width selector still works in Grid mode."},
     {"type":"fixed","description":"LanguageSwitcher dropdown anchored top-down right-aligned (was bottom-up from sidebar footer). Now that the switcher lives in the top bar, the old anchor caused the menu to overflow off-screen above the viewport."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-25' AND title = 'Backlog Kanban + AI Suggest Priorities + widget click-to-add-quote + Pepper backlog tools'
   )`,

  // ── Step 156: mcogs_user_scope — granular RBAC scope ──────────────────────
  // Replaces mcogs_user_brand_partners with a richer model that supports:
  //   - BP grants (current behaviour) AND deny overrides
  //   - Direct country grants (markets outside any of the user's BPs)
  //   - Direct country denies (limit BP coverage)
  //   - Per-scope role override (different role on different markets/BPs;
  //     NULL means inherit user.role_id)
  //
  // Resolution order for a given country: country grant > country deny >
  // BP grant > BP deny > user default. Country override beats BP override
  // beats user default for the role too.
  `CREATE TABLE IF NOT EXISTS mcogs_user_scope (
     id          SERIAL PRIMARY KEY,
     user_id     INTEGER NOT NULL REFERENCES mcogs_users(id) ON DELETE CASCADE,
     scope_type  VARCHAR(20) NOT NULL CHECK (scope_type IN ('brand_partner', 'country')),
     scope_id    INTEGER NOT NULL,
     access_mode VARCHAR(10) NOT NULL DEFAULT 'grant' CHECK (access_mode IN ('grant', 'deny')),
     role_id     INTEGER REFERENCES mcogs_roles(id) ON DELETE SET NULL,
     created_at  TIMESTAMPTZ DEFAULT NOW(),
     updated_at  TIMESTAMPTZ DEFAULT NOW(),
     UNIQUE(user_id, scope_type, scope_id)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_user_scope_user ON mcogs_user_scope(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_scope_country ON mcogs_user_scope(scope_id) WHERE scope_type = 'country'`,
  `CREATE INDEX IF NOT EXISTS idx_user_scope_bp      ON mcogs_user_scope(scope_id) WHERE scope_type = 'brand_partner'`,

  // Test env: drop legacy mcogs_user_brand_partners (per user direction).
  `DROP TABLE IF EXISTS mcogs_user_brand_partners`,

  // ── Step 156b: User scope templates — reusable scope presets ──────────────
  // Store a named bundle of scope rows so admins don't have to rebuild the
  // same BP/market layout for every new user. Saved as JSONB so the shape
  // matches mcogs_user_scope rows directly: [{scope_type, scope_id, access_mode, role_id}]
  `CREATE TABLE IF NOT EXISTS mcogs_user_scope_templates (
     id          SERIAL PRIMARY KEY,
     name        VARCHAR(100) NOT NULL UNIQUE,
     description TEXT,
     scope       JSONB NOT NULL DEFAULT '[]'::jsonb,
     created_by  VARCHAR(255),
     created_at  TIMESTAMPTZ DEFAULT NOW(),
     updated_at  TIMESTAMPTZ DEFAULT NOW()
   )`,

  // ── Step 157: Changelog — granular RBAC ───────────────────────────────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-26', 'Granular user scope (Phase 1 — schema + auth middleware)', '[
     {"type":"added","description":"New mcogs_user_scope table replaces mcogs_user_brand_partners. Supports BP grants/denies, direct country grants/denies, and a per-scope role override (NULL = inherit user.role_id). Resolution order: country grant > country deny > BP grant > BP deny > user default."},
     {"type":"changed","description":"Auth middleware loadScopedAccess() resolves the per-market role + permissions map. req.user now exposes scopedAccess (per-country roleId/roleName/permissions) and req.user.permissions is the union of all per-market permissions, so feature gating at the sidebar / nav level still works without callsite changes."},
     {"type":"added","description":"requirePermissionInMarket(feature, level, getCountryId) factory for routes that mutate market-scoped data — enforces the user has write access in the specific country being acted on."},
     {"type":"removed","description":"Legacy mcogs_user_brand_partners table dropped (test env, no data migration needed)."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-26' AND title = 'Granular user scope (Phase 1 — schema + auth middleware)'
   )`,

  // ── Step 158: Bugs (resolved this session) ────────────────────────────────
  `INSERT INTO mcogs_bugs (key, summary, description, priority, severity, status, labels, page, resolution) VALUES
    ('BUG-1027', 'Mix Manager ignored scenario prices — items with no menu price excluded',
     'Mix Manager fetched per-level menu prices via /cogs/menu-sales but did not overlay scenario priceOverrides. Items priced only in the scenario (no live menu price set in the Menu Builder) were filtered out of the mix because effectivePrice resolved to 0 → pricedItems.filter(i => effectivePrice > 0) dropped them. existingRevenue (the suggested target) suffered the same gap.',
     'high', 'major', 'resolved', '["menu-engineer","scenario","mix-manager"]'::jsonb, 'Menus',
     'SalesMixGeneratorModal now accepts priceOverrides + dispRate. After fetching levelPriceMap from /cogs/menu-sales, it overlays each scenario override (display currency / dispRate → market currency) per level, so items with only a scenario price now contribute. existingRevenue rewritten to use the same effective-price helper so the suggested target reflects what is shown in Menu Engineer.'),

    ('BUG-1028', 'What If clickable before menu data loaded — silent no-op',
     'In ALL Levels mode allLevelRows is empty until the per-level fetches finish. applyWhatIf returned silently when there were no rows, so clicking Apply did nothing with no feedback. User reported "What If does not apply changes either manual or smart".',
     'medium', 'minor', 'resolved', '["menu-engineer","scenario","what-if"]'::jsonb, 'Menus',
     'What If button now disabled until rows.length > 0 (single-level) or allLevelRows.length > 0 (ALL mode), with title text explaining the wait. applyWhatIf gained a toast fallback if hasData is false. Diagnostic [whatif] / [mix-gen] console.logs added so the next failure surfaces a concrete cause.'),

    ('BUG-1029', 'Single-level qty input empty after Mix Manager generate',
     'Mix Manager always writes per-level keys (si_X__lN) when priceLevels.length > 0, but the single-level Menu Engineer qty input read qty[row.nat_key] (e.g. si_5) directly. After a generate, the displayed input was empty even though the underlying total was computed correctly via the existing fallback in row.qty.',
     'medium', 'minor', 'resolved', '["menu-engineer","scenario"]'::jsonb, 'Menus',
     'Qty input wrapped in an IIFE that resolves a perLevelKey fallback for both display (qty[row.nat_key] ?? qty[perLevelKey]) and write (writeKey = perLevelKey || row.nat_key) when in single-level mode. ALL Levels view already used per-level keys correctly and was unaffected.'),

    ('BUG-1030', 'Recipe yield_qty inline edit lost focus on every keystroke',
     'CalcInput.onChange fires on every keystroke for plain numeric input (despite an outdated comment claiming it only fired on commit). The recipe header yield_qty cell called setEditingHeaderField(null) inside its onChange handler, so the first valid digit unmounted the input and dropped focus.',
     'high', 'major', 'resolved', '["recipes","ui","forms"]'::jsonb, 'Recipes',
     'yield_qty cell rewired to match the yield_unit/name pattern: onChange only updates a local headerDraft, onBlur runs the validation + updateRecipeField + setEditingHeaderField(null), Enter blurs to commit, Escape cancels. Focus stays put through typing. yield_unit and name fields already used this pattern and were unaffected.'),

    ('BUG-1031', 'Quote Coverage tile claimed "Fully Preferred" for empty recipes',
     'deriveCoverage in /api/recipes returned ''fully_preferred'' when leafCount === 0 — vacuous truth ("all zero ingredients have preferred quotes"). Newly created recipes with no items showed a green "✓ Fully Preferred · All ingredients have preferred vendor quotes" tile, which is misleading.',
     'low', 'minor', 'resolved', '["recipes","ui","copy"]'::jsonb, 'Recipes',
     'Backend now returns ''empty'' when leafCount === 0 (kept separate from fully_preferred). Frontend tile config gained an empty entry: "— No ingredients · Add ingredients to see quote coverage" in muted grey. cogs.js''s sub-recipe propagation logic was left unchanged to preserve menu-level coverage semantics for sub-recipes.'),

    ('BUG-1032', 'modifier_cost_adder always 0 — modifier-option recipes missing from recipeItemsMap',
     'The "Modifiers in COGS" toggle silently added 0 because /cogs/menu-sales only pre-loaded recipes referenced by top-level items + combo step options. Modifier-option recipes (e.g. flavour sub-recipes attached to a sales item) were never gathered, so resolveOptionCost returned 0, the avg collapsed to 0, and adder = 0. The avg_cost displayed in the modifier group header (loaded by /sub-prices) was correct because that endpoint loaded its own recipe map — masking the bug to the user.',
     'high', 'major', 'resolved', '["menu-engineer","cogs","modifiers"]'::jsonb, 'Menus',
     'loadModifierCostAdders refactored to pull both query result sets first, scan for any modifier-option recipe ids missing from the caller''s recipeItemsMap, call loadAllRecipeItemsDeep on the gap, and merge into the map before computing costs. The shared-pages.js endpoint inherits the fix automatically because it calls the same helper. Bone-In 6 with 2× flavours @ avg ₹16.89 + 1× dip @ avg ₹1.03 now correctly bumps cost from ₹59.84 to ~₹94.65 with the toggle on.'),

    ('BUG-1033', 'Recipe ingredient qty inline edit refreshed on every keystroke',
     'The Inline Qty cell on the recipe ingredients table wired CalcInput.onChange directly to saveItemQtyInline. CalcInput.onChange fires on every keystroke for plain numeric input, so each digit triggered a PUT → loadDetail → row re-render with the just-saved value, which re-keyed the input and reset cursor / typed value. User had to retype repeatedly to get past the first digit.',
     'high', 'major', 'resolved', '["recipes","ui","forms"]'::jsonb, 'Recipes',
     'Added new onCommit prop to CalcInput in ui.tsx — fires once on Enter and once on blur, after the expression has been evaluated. Recipe ingredient qty cell now uses onCommit={v => saveItemQtyInline(item, v)} with a no-op onChange, so typing stays local until the user Tabs / Enters / clicks away. Math expressions like 24*0.5 still evaluate. Side-panel edit click on the row is preserved (qty cell e.stopPropagation() unchanged).')
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 159: Backlog (done this session) ─────────────────────────────────
  `INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
    ('BACK-1965', 'Modifier cost display in Menu Engineer expanded view',
     'When a sales item is expanded in Menu Engineer (▼), each combo / modifier option now shows its own cost in the Cost/ptn column, in display currency. Each modifier group / combo step header shows the cost summary that flows into the parent COGS: "avg ₹X.XX (₹min–₹max)". Backed by per-option cost + per-group avg/min/max fields added to /menu-sales-items/:id/sub-prices. SubPriceRow + SubPriceRowME accept dispRate and render the cost cell; pad-cell count corrected (was off by one after adding the Cost cell). qty per modifier option is applied (e.g. 50g sauce vs 100g) so the displayed cost reflects actual consumption.',
     'story', 'medium', 'done', '["menu-engineer","modifiers","cogs"]'::jsonb, 1965),

    ('BACK-1966', '"Modifiers in COGS" toggle (Menu Engineer + Shared View)',
     'New toggle next to ⚡ What If (Menu Engineer) and in the Shared view toolbar. Defaults ON — required modifiers are part of true plate cost; user can turn off. Persisted to localStorage scoped per slug for shared view. Backend exposes a new shared helper loadModifierCostAdders(salesItemIds, comboIds, ctx) in cogs.js — full × min_select for SI-level groups (not in cost_per_portion); delta avg × (min_select − 1) for combo step option groups (since calcComboCost already adds avg×1). Returned as modifier_cost_adder per CogsItem and per SharedItem (market currency × qty applied). Cost cells show "59.84 (+₹34.81)" — recipe cost stays editable in the input, the modifier portion is read-only in brackets next to it. Toggle on min_select=0 ("optional, up to 2") correctly resolves to 0 — combo path uses delta avg × −1 to cancel the implicit avg×1 from calcComboCost. Shared view applies the adder + recomputes cogs_pct/gp_net per level on the fly via effectiveItems useMemo, so summary tiles, category breakdown, level breakdown, and table/excel/grid views update instantly.',
     'story', 'high', 'done', '["menu-engineer","shared-view","modifiers","cogs"]'::jsonb, 1966),

    ('BACK-1967', 'Standalone Pepper PWA at /pepper',
     'Full-viewport Pepper chat at https://cogs.macaroonie.com/pepper. New PepperPage.tsx renders AiChat with isMobile=true (so phones AND tablets get the touch-optimised layout — 44px tap targets, larger text, push-to-talk mic, camera button). visualViewport-driven keyboard inset so iOS/Android keyboards don''t cover the input. env(safe-area-inset-*) for iPhone notch / home-bar. Dedicated /pepper-manifest.webmanifest (start_url + scope = /pepper, name "Pepper") swapped in via PepperPage useEffect; Add-to-Home-Screen from /pepper installs as a Pepper-only app icon. PWA shortcut added to the main Menu COGS manifest so long-press / right-click of the regular icon offers "Ask Pepper" launching directly into chat. Auth0 switched to useRefreshTokens + cacheLocation:"localstorage" + offline_access scope — installed PWAs aggressively block the third-party cookies the default silent-iframe token refresh depends on, which manifested as "fetch error" responses inside the standalone PWA on every API call. Refresh-token rotation must be enabled on the Auth0 SPA application in the dashboard for this to take effect. Diagnostic console.error("[pepper] chat request failed:", err) added to AiChat so any future PWA-only failure surfaces a real cause instead of generic "Network error". index.html viewport meta gained viewport-fit=cover.',
     'story', 'high', 'done', '["pepper","pwa","mobile","tablet"]'::jsonb, 1967)
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 160a: Backlog audit — flip stale rows to done ─────────────────────
  // Reviewed live backlog vs codebase reality. 8 items were marked
  // backlog/todo despite the underlying feature having shipped (often under a
  // different key, or via a different shape than the original spec). Flipping
  // them here keeps a fresh DB build in step with production.
  // Idempotent — no-op when status is already 'done'.
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE status <> 'done' AND key IN (
     'BACK-1005',  -- Voice Tier 1 — useVoiceInput / useVoiceOutput shipped
     'BACK-1351',  -- mcogs_languages + /api/languages + Settings → Localisation
     'BACK-1352',  -- delivered as JSONB columns on 11 entities (vs separate tables)
     'BACK-1353',  -- resolveLanguage middleware + tCol/getLangContext on 9 routes
     'BACK-1354',  -- useApi X-Language header + TranslationEditor in 6 forms
     'BACK-1355',  -- i18next + 9 locales + LanguageSwitcher (RTL still in BACK-1427)
     'BACK-1940',  -- duplicate of BACK-1942 (Sales Items Excel grid)
     'BACK-1941'   -- duplicate of BACK-1942 (Sales Items Excel grid)
   )`,

  // ── Step 160: Changelog — modifier costs in COGS + standalone Pepper PWA ──
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-28', 'Modifier costs in COGS + standalone Pepper PWA + inline-edit focus fixes', '[
     {"type":"added","description":"Modifier cost display in Menu Engineer expanded view (BACK-1965). Each combo / modifier option now shows its cost in the Cost/ptn column when expanded; group/step headers show “avg ₹X.XX (₹min–₹max)” — the average that flows into parent COGS. /menu-sales-items/:id/sub-prices enriched with per-option cost + per-group avg/min/max. SubPriceRow + SubPriceRowME accept dispRate; padding column count corrected after adding the Cost cell. qty multiplier on modifier options applied so 50g vs 100g show correct figures."},
     {"type":"added","description":"“Modifiers in COGS” toggle (BACK-1966). New button next to ⚡ What If in Menu Engineer and in the Shared view toolbar. Defaults ON. Backend exposes shared helper loadModifierCostAdders() in cogs.js — full × min_select for SI-level groups, delta avg × (min_select − 1) for combo step option groups (since calcComboCost already includes avg×1). Cost cells now show “59.84 (+₹34.81)” with the recipe cost still editable in the input and the modifier portion read-only in brackets. min_select=0 (optional) correctly resolves to 0 — the combo delta cancels the implicit avg×1. Shared view recomputes cogs_pct/gp_net per level on the fly via effectiveItems useMemo so summary tiles, category breakdown, and all view modes update instantly."},
     {"type":"added","description":"Standalone Pepper PWA at /pepper (BACK-1967). Full-viewport AiChat with isMobile=true forced for phones AND tablets. visualViewport-driven keyboard inset, env(safe-area-inset-*) for iPhone notch. Dedicated /pepper-manifest.webmanifest (start_url + scope = /pepper, name “Pepper”) swapped via PepperPage useEffect — Add-to-Home-Screen from /pepper installs a Pepper-only app icon. PWA shortcut added to the main manifest so long-press / right-click of the regular icon offers “Ask Pepper”. index.html viewport meta gained viewport-fit=cover."},
     {"type":"changed","description":"Auth0 switched to useRefreshTokens + cacheLocation:“localstorage” + offline_access scope. Installed PWAs aggressively block third-party cookies the default silent-iframe token refresh depends on, manifesting as “fetch error” on every API call inside the standalone Pepper PWA. Refresh-token rotation must be enabled on the SPA application in the Auth0 dashboard. Diagnostic [pepper] chat request failed console.error added to AiChat so future PWA-only failures surface a real cause."},
     {"type":"added","description":"CalcInput onCommit prop. Fires once on Enter and once on blur after expression evaluation, separately from onChange (which still fires on every keystroke for plain numeric input). Designed for inline-save cells where the parent re-renders after each save — the consumer uses onCommit={save} with a no-op onChange, so typing stays local until commit."},
     {"type":"fixed","description":"BUG-1027: Mix Manager ignored scenario prices. Items with no live menu price but a scenario override were filtered out of the mix because effectivePrice resolved to 0. SalesMixGeneratorModal now accepts priceOverrides + dispRate and overlays each scenario override (display currency / dispRate → market currency) on the per-level price map before computing effective prices. existingRevenue rewritten to use the same effective-price helper."},
     {"type":"fixed","description":"BUG-1028: What If clickable before menu data loaded → silent no-op. Button now disabled until rows / allLevelRows are populated; applyWhatIf gained a toast fallback. Diagnostic [whatif] / [mix-gen] console.logs added so future failures surface a concrete cause."},
     {"type":"fixed","description":"BUG-1029: single-level qty input empty after Mix Manager generate. Mix Manager always writes per-level keys (si_X__lN); single-level qty input now falls back to the per-level key for both display and write."},
     {"type":"fixed","description":"BUG-1030: recipe yield_qty inline edit lost focus on every keystroke. CalcInput.onChange fires per keystroke (despite an outdated comment); the cell called setEditingHeaderField(null) inside onChange so the first digit unmounted the input. Rewired to onBlur commit pattern to match yield_unit / name."},
     {"type":"fixed","description":"BUG-1031: Quote Coverage claimed “Fully Preferred” for empty recipes. deriveCoverage now returns empty when leafCount === 0; frontend tile shows “— No ingredients · Add ingredients to see quote coverage” in muted grey."},
     {"type":"fixed","description":"BUG-1032: modifier_cost_adder always 0. /cogs/menu-sales only pre-loaded recipes for top-level items + combo step options — modifier-option recipes were missing from recipeItemsMap, so resolveOptionCost returned 0 and the avg collapsed to 0. loadModifierCostAdders now augments the recipe map inline (loadAllRecipeItemsDeep on the gap) before computing costs. Bone-In 6 (2× flavours @ ₹16.89 + 1× dip @ ₹1.03) now correctly bumps from ₹59.84 to ~₹94.65 with the toggle on."},
     {"type":"fixed","description":"BUG-1033: recipe ingredient qty inline edit refreshed on every keystroke. CalcInput.onChange wired directly to saveItemQtyInline meant each digit triggered a PUT → loadDetail → re-render → focus loss. Switched to the new onCommit prop with a no-op onChange. Math expressions still evaluate; side-panel edit click on the row preserved."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-28' AND title = 'Modifier costs in COGS + standalone Pepper PWA + inline-edit focus fixes'
   )`,

  // ── Step 161: Bugs (resolved this session) ────────────────────────────────
  `INSERT INTO mcogs_bugs (key, summary, description, priority, severity, status, labels, page, resolution) VALUES
    ('BUG-1034', 'Pepper missed BACK-#### / BUG-#### lookups when search past first 50 rows',
     'list_backlog and list_bugs default to LIMIT 50 ordered by sort_order ASC. Items with high sort_order (BACK-1400, BACK-1928, etc.) sit past the cutoff and the existing search filter only matched summary + description — not key — so passing "BACK-1400" as search returned nothing. Pepper concluded the row didn''t exist instead of recognising it had been truncated.',
     'high', 'major', 'resolved', '["pepper","search"]'::jsonb, 'AI Chat',
     'Search filter on both list_backlog and list_bugs now matches key ILIKE alongside summary + description. Tool descriptions updated so Pepper knows to pass the key as the search term when the user names a specific item.'),

    ('BUG-1035', 'Migration step 160 changelog rejected — Token "avg" is invalid',
     'Step 160 INSERT into mcogs_changelog used \\"avg ₹X.XX\\" inside a JS template literal that holds the raw SQL. JS evaluates \\" to a literal " character so the SQL Postgres received had unescaped quotes inside the JSONB string ("group/step headers show "avg ₹X.XX (₹min–₹max)" — …"), breaking JSON parse at column 155. Deploy aborted; migration rolled back.',
     'highest', 'critical', 'resolved', '["migrations","jsonb"]'::jsonb, 'API',
     'Replaced every \\"…\\" inside JSONB string contents with typographic curly quotes (U+201C / U+201D). Same fix pattern as a prior session''s changelog escape bug. JSONB parses cleanly now; node-eval JSON.parse validation added to the EOS workflow before commit.'),

    ('BUG-1036', 'Languages admin UI missing — BACK-1351 marked done prematurely',
     'BACK-1351 (Foundation — mcogs_languages table + /api/languages CRUD + Settings → Localisation tab) was flipped to done during yesterday''s EOS audit. Table + API + LanguageSwitcher + LanguageContext all exist, but there''s no admin UI to flip is_active per language — the Configuration / System pages have a "Localization" doc page marked PLANNED, not a working CRUD form. Operator complaint: only English appears in the top-bar dropdown despite 10 languages being seeded.',
     'high', 'major', 'resolved', '["languages","admin-ui"]'::jsonb, 'Configuration',
     'New Configuration → Languages section (🌐 icon, gated by settings:write). Lists every row from /api/languages with toggles for is_active, is_rtl, "make default" link, edit + delete (refuses English and the current default at both client and server). Add-language modal posts to /api/languages. LanguageProvider already filters by is_active so toggling rebuilds the top-bar dropdown on next session.'),

    ('BUG-1037', 'Combo edit form used raw URL input instead of ImageUpload',
     'Edit Combo modal''s Image URL field was a plain <input> with placeholder https://… while every other image field on the same Sales Items page (sales item form, modifier option form, panel detail form) used the shared ImageUpload component (browse media library + drag-drop upload + preview). Inconsistent UX and forced operators to paste image URLs manually.',
     'medium', 'minor', 'resolved', '["sales-items","ui"]'::jsonb, 'Sales Items',
     'Swapped the bare URL input for <ImageUpload formKey="combo" /> matching the surrounding pattern. Removed the manual <img> tag with onError fallback — ImageUpload renders preview itself.'),

    ('BUG-1038', 'Modifier rows in Menu Builder list-view not visibly indented',
     'In the Menu Builder''s combo expand view, modifier group + modifier option rows nested under a combo step option appeared at almost the same horizontal position as their parent option, making the hierarchy step → option → modifier illegible at a glance.',
     'medium', 'minor', 'resolved', '["menus","ui"]'::jsonb, 'Menus',
     'Modifier group row paddingLeft 3rem→5rem and inner marginLeft 1.5rem→2.5rem (effective indent 4.5rem→7.5rem). Modifier option SubPriceRow marginLeft 3rem→5rem. Visual cascade now reads cleanly.'),

    ('BUG-1039', 'Kiosk customise screen progress button hidden behind browse bottom bar',
     'The kiosk page rendered the browse-mode bottom bar (basket count + total + red PAY button) on both browse and customise phases. During customise, the customise screen''s own "Next →" button sat at the same position as the BottomBar — the Next button was almost invisible behind it.',
     'high', 'major', 'resolved', '["kiosk","ui"]'::jsonb, 'Kiosk Mockup',
     'Page-level BottomBar now only renders on phase === "browse". CustomiseScreen renders its own footer flush with the bottom edge (single bar with [Accessibility][Cancel] · spacer · [← Back][Next/Add]) so there is no overlap and the progress button is always clearly visible.'),

    ('BUG-1040', 'Kiosk combo flow never walked option-level modifier groups',
     'Combos with modifier groups attached to a step option (e.g. "Sides Seasoning" attached to the Fries combo option) didn''t prompt the customer for those modifiers. The Walker had a pendingOptModGroups field but it was never populated — the customer skipped straight to the next combo step or SI-level modifiers.',
     'highest', 'major', 'resolved', '["kiosk","combos","modifiers"]'::jsonb, 'Kiosk Mockup',
     'New "option-modifier" walker phase. After a combo step''s options are picked and the customer taps Next, advance() builds a queue of every modifier_groups attached to the picked options (de-duped) and walks them as separate screens between combo steps. Header reads "Step N of M · Fries extras" so the customer knows which option the modifier belongs to. Selection key (stepId_modifierGroupId) matches what commitWalker already expected, so totals flow through.'),

    ('BUG-1041', 'Kiosk accessibility mode shrank width as well as height',
     'KioskFrame used CSS aspect-ratio 9/16 with height: 50vh in accessibility mode. Aspect-ratio forces width to follow → the canvas became 50vh × 28vh (a tall narrow strip) instead of "lower the screen for a seated user".',
     'medium', 'minor', 'resolved', '["kiosk","accessibility"]'::jsonb, 'Kiosk Mockup',
     'Dropped aspect-ratio. Width now fixed at min(100vw, calc(100vh × 9 / 16)) in both modes; only height toggles between 100vh and 50vh. Canvas literally lowers from above; nothing reflows horizontally.')
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 162: Backlog (done this session) ─────────────────────────────────
  `INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, labels, sort_order) VALUES
    ('BACK-1968', 'Languages admin UI (Configuration → Languages section)',
     'Configuration page gains a new 🌐 Languages section gated by settings:write. Lists every row from /api/languages with: Active checkbox (cannot deactivate English or the current default), "make default" link (disabled until active), RTL flag toggle, edit/delete (delete refuses English and the default at both client and server). Add-language modal collects code + English name + native name + RTL flag, posts to /api/languages. Optimistic updates with auto-revert on failure. Toast notifications.',
     'story', 'high', 'done', '["languages","admin","configuration"]'::jsonb, 1968),

    ('BACK-1969', 'Hash-based section deep-linking for /system and /configuration',
     'Both pages now read window.location.hash on mount (and on hashchange) to set their initial active section — e.g. /system#bugs-backlog opens the Bugs & Backlog section directly. Unknown / missing hashes fall through to the default section. Existing internal sidebar clicks do NOT write the hash (the address bar stays clean for users who got there normally). Pairs with the navigate_to_page Pepper tool extension below.',
     'task', 'medium', 'done', '["routing","navigation"]'::jsonb, 1969),

    ('BACK-1970', 'Pepper navigate_to_page tool gains optional section param + pepper page',
     'navigate_to_page now accepts an optional section parameter that becomes the URL hash. Tool description teaches Pepper the supported sections per page (system: ai/bugs-backlog/jira/audit-log/storage/database/test-data/tests/doc-library/pos-tester/localization/architecture/api-reference/security/troubleshooting/domain-migration/claude-doc; configuration: global-config/location-structure/categories/units/price-levels/currency/cogs-thresholds/users-roles/import/media/stock-config/languages). Page enum also gained "pepper" so "open pepper" routes to the standalone PWA. "Open backlog" now actually lands on the Bugs & Backlog section instead of the AI default.',
     'task', 'high', 'done', '["pepper","navigation"]'::jsonb, 1970),

    ('BACK-1971', 'Backlog kanban: vertical sort within a priority column',
     'Tiles in the kanban view can now be reordered within their priority column by drag-drop. New kanbanDragOverTileId state tracks the hover-target tile and renders an accent-coloured top border as a "drop above" indicator. onKanbanDrop(id, newPriority, beforeTileId) rebuilds the full backlog ordering — removes dragged item, stamps the new priority, inserts before beforeTileId (or appends to the column if dropped on empty space), then PUTs priority (only when changed) followed by /backlog/reorder with the new sort_order list. Same-priority drops are silent (no toast spam); cross-column drops still toast.',
     'story', 'medium', 'done', '["backlog","kanban","ui"]'::jsonb, 1971),

    ('BACK-1972', 'Self-service ordering kiosk mockup at /kiosk',
     'New full-screen kiosk page rendering a 9:16 portrait canvas scaled to viewport height (the way a real 32-inch wall-mount kiosk sits). Setup: admin picks a menu, taps Launch. Customer flow: order-type tile picker (price levels) → browse with categories left + product tiles right (image fallback to initials, allergen ⚠ badge from /api/allergens/menu/:id) → customise screen with combo step walker / modifier prompts (large tap targets, step counter) → bottom-sheet basket modal (qty stepper + remove + tap-line-to-edit) → pay-method picker (💳 Card simulated 1.8s, 💵 Cash 1.2s with QR for till settlement) → receipt with deterministic dummy QR for cash orders. Backend touch: cogs.js /menu-sales SELECT augmented with si.image_url and si.description. Auth-gated; rendered outside AppLayout for full bleed.',
     'epic', 'high', 'done', '["kiosk","mockup","ui"]'::jsonb, 1972),

    ('BACK-1973', 'Kiosk improvements — option modifiers + footer redesign + accessibility width',
     'Five hits on the same review. (1) Combo flow now walks option-level modifier groups — new "option-modifier" walker phase queues the groups attached to picked combo options and shows them between steps. (2) Customise screen no longer overlaps the browse-mode bottom bar (page-level BottomBar suppressed during customise; CustomiseScreen renders its own footer). (3) Footer redesign: [Accessibility][Cancel] · spacer · [← Back][Next/Add]. (4) Cancel moved from the customise header into the new footer next to accessibility. (5) Accessibility mode now keeps width — KioskFrame uses min(100vw, 100vh × 9/16) for width in both modes; only height toggles between 100vh and 50vh.',
     'story', 'high', 'done', '["kiosk","modifiers","accessibility"]'::jsonb, 1973)
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 162a: BACK-1413 done — map tooltip enhancements ───────────────────
  // Already flipped on production via the internal API; this UPDATE keeps a
  // fresh DB rebuild in step. Idempotent.
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-1413' AND status <> 'done'`,

  // ── Step 162b: Modifier multiplier flag ───────────────────────────────────
  // Adds is_modifier_multiplier to mcogs_recipe_items. When set on a global
  // recipe item (variation_id IS NULL), the item''s prep_qty becomes the
  // multiplier applied to every modifier-option cost on sales items / combo
  // step options that use this recipe — so a Bone-In 6 with its Bone-In Wing
  // line flagged (qty=6) makes attached Flavour-Choice modifiers consume 6×
  // sauce per portion. Only one item per recipe can carry the flag (partial
  // unique index). Behaviour gated by mcogs_settings.data.modifier_multiplier_enabled
  // (default off — existing menus don''t change cost silently).
  `ALTER TABLE mcogs_recipe_items ADD COLUMN IF NOT EXISTS is_modifier_multiplier BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_recipe_items_modifier_multiplier_global
     ON mcogs_recipe_items(recipe_id)
     WHERE is_modifier_multiplier = TRUE
       AND variation_id IS NULL
       AND pl_variation_id IS NULL
       AND market_pl_variation_id IS NULL`,

  // ── Step 163: Changelog — Apr 29 — kiosk + map tooltips + languages admin ─
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-29', 'Kiosk mockup + map tooltip counts + Languages admin UI + kanban vertical sort', '[
     {"type":"added","description":"Self-service ordering kiosk mockup at /kiosk (BACK-1972). Full-screen 9:16 portrait canvas scaled to viewport height. Customer flow: order-type → browse → customise (combo step walker + modifier prompts) → basket → pay → receipt. Accessibility mode squashes height to 50vh keeping width. Auth-gated; rendered outside AppLayout. Backend: cogs.js /menu-sales SELECT now returns si.image_url + si.description."},
     {"type":"added","description":"Map tooltip enhancements (BACK-1413). Both world-map widgets now show menu count + vendor count + rolled-up item count chips below the per-market COGS list. MapboxMap country and region popups + MarketMap (react-simple-maps) tooltip both updated. Counts derive from existing useDashboardData collections (no extra API)."},
     {"type":"added","description":"Configuration → Languages admin UI (BACK-1968). Toggle is_active per language (controls top-bar LanguageSwitcher), set default, edit name / native name, RTL flag, add/delete with system-language guards. Backed by /api/languages CRUD. Operators can now activate French / Hindi / Czech / etc. without touching SQL."},
     {"type":"added","description":"Backlog kanban vertical reorder (BACK-1971). Drag a tile onto a sibling tile to insert above; cross-column moves still work via column drop. Persists via /backlog/reorder. Same-priority drops are silent."},
     {"type":"added","description":"Hash-based section deep-linking on /system + /configuration (BACK-1969). External links and Pepper''s navigate_to_page can drop the user onto a specific section (e.g. /system#bugs-backlog opens Bugs & Backlog directly)."},
     {"type":"changed","description":"Pepper navigate_to_page tool extended (BACK-1970). New optional section parameter; tool description teaches every supported section per page. Page enum gained pepper so the standalone PWA is reachable. Fixes “open backlog” landing on the AI default section."},
     {"type":"changed","description":"Combo edit form on Sales Items now uses the shared <ImageUpload> component (browse media library + drag-drop upload + preview) for parity with every other image field on the page. Was a raw URL input."},
     {"type":"changed","description":"Modifier rows in Menu Builder list-view bumped indent — paddingLeft 3rem→5rem, marginLeft 1.5rem→2.5rem on the group header; option marginLeft 3rem→5rem. Visual cascade step → option → modifier now reads at a glance."},
     {"type":"fixed","description":"BUG-1034: Pepper missed BACK-#### / BUG-#### items past the default 50-row LIMIT. list_backlog + list_bugs search now matches key ILIKE alongside summary + description; tool descriptions updated so Pepper passes the key as the search term instead of assuming the row is missing."},
     {"type":"fixed","description":"BUG-1035: migration step 160 changelog INSERT was rejected (Token “avg” is invalid). Escaped \\\" inside the JS template literal evaluated to a literal “ inside the JSONB string, breaking parse. Replaced with curly quotes throughout."},
     {"type":"fixed","description":"BUG-1036: Languages admin UI was missing despite BACK-1351 being marked done. Now built (see BACK-1968) — the dropdown will show every language whose Active toggle is on."},
     {"type":"fixed","description":"BUG-1037: combo edit form used raw URL input instead of ImageUpload (see “Changed” entry above)."},
     {"type":"fixed","description":"BUG-1038: modifier rows not visibly indented in Menu Builder list-view (see “Changed” entry above)."},
     {"type":"fixed","description":"BUG-1039: kiosk customise progress button hidden behind the browse-mode bottom bar. Page-level BottomBar now only renders on the browse phase; customise screen owns its own footer."},
     {"type":"fixed","description":"BUG-1040: kiosk combo flow never walked option-level modifier groups. Added a new “option-modifier” walker phase that queues every modifier_groups attached to picked combo options and shows them as separate screens between steps. Header indicates which option the modifier belongs to."},
     {"type":"fixed","description":"BUG-1041: kiosk accessibility mode shrank width as well as height. Dropped aspect-ratio; KioskFrame width is now fixed at min(100vw, 100vh × 9/16) in both modes; only height toggles."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-29' AND title = 'Kiosk mockup + map tooltip counts + Languages admin UI + kanban vertical sort'
   )`,

  // ── Step 164: Bugs (resolved this session) ────────────────────────────────
  `INSERT INTO mcogs_bugs (key, summary, description, priority, severity, status, labels, page, resolution) VALUES
    ('BUG-1042', 'Modifier multiplier × mod column hidden when Market or Price Level dropdown was set',
     'isGlobalView heuristic checked the dropdowns directly: (selectedCountryId === GLOBAL/empty) AND no PL. But operators routinely have a Market and PL selected while still viewing the global recipe (because no variation exists for that combo) — the "🌍 Global recipe" badge confirms that state. The × mod column was hidden whenever a dropdown was set, even though the view was still global.',
     'medium', 'minor', 'resolved', '["recipes","ui","multiplier"]'::jsonb, 'Recipes',
     'isGlobalView now mirrors the exact logic that drives the "Global recipe" badge: not in a market+PL variation, not in a PL variation, and activeCogs.has_variation is false. Badge visibility and × mod column visibility are now in lockstep.')
   ON CONFLICT (key) DO NOTHING`,

  // ── Step 165: Backlog (done this session) ─────────────────────────────────
  // BACK-2426 (Modifier multiplier) was filed externally before this session;
  // already flipped to done on production via the internal API. UPDATE keeps
  // a fresh DB rebuild in step. Idempotent.
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-2426' AND status <> 'done'`,

  // ── Step 166: Changelog — Apr 29 (evening) — Modifier multiplier shipped ──
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-29', 'Modifier multiplier feature + README rewrite', '[
     {"type":"added","description":"Modifier multiplier (BACK-2426). Flag a recipe ingredient as the qty driver and modifier costs scale by that qty. Bone-In 6 with Bone-In Wing × 6 flagged → attached Flavour Choice modifiers consume 6× sauce per portion. New mcogs_recipe_items.is_modifier_multiplier column (BOOLEAN, default false) + partial unique index so one item per recipe can carry the flag. Server-side enforcement in the recipe-items PUT endpoint (transaction clears the flag on every other global row before stamping it on the target). New resolveRecipeMultiplier helper exported from cogs.js. Threaded through loadModifierCostAdders (multiplierForSi + multiplierForOption resolvers — different combo step options can carry different multipliers), calcComboCost (modifier blend × per-option recipe multiplier), and the menu-sales-items /sub-prices endpoint (per-option cost + per-group avg/min/max all scale)."},
     {"type":"added","description":"Modifier multiplier UI. Configuration → COGS Thresholds gains a new Modifier Multiplier section with a single Apply checkbox + helper copy. Recipes page ingredient table gains a × mod column on the global view; tickbox per ingredient row, disabled for sub-recipe rows, single-flag-per-recipe enforced server-side. Tooltip per cell explains the multiplier value (e.g. “Click to flag this item as the multiplier (sets modifier scale to 6×)”). Default off — existing menus see no change until both the global toggle and a per-recipe flag are set."},
     {"type":"changed","description":"README.md rewritten. Was three lines of throwaway notes (“COGS2.1”, “minor change to domain”, “08/04/2026 - triggering deploy manually”). Now a proper repo landing page covering what the app does, the Pepper-centric AI workflow, operator + developer toolkits, feedback channels, architecture, getting-started commands, and pointers to CLAUDE.md / docs/."},
     {"type":"fixed","description":"BUG-1042: × mod column hidden when Market or Price Level dropdown was set even though the view was still global. isGlobalView heuristic now mirrors the exact logic behind the “🌍 Global recipe” badge — column visibility and badge visibility are in lockstep."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-29' AND title = 'Modifier multiplier feature + README rewrite'
   )`,

  // ── Step 166b: Flip BACK-2353/2429/2430/2431 to done ───────────────────────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key IN ('BACK-2353','BACK-2429','BACK-2430','BACK-2431') AND status <> 'done'`,

  // ── Step 167: Backlog — derived directives done this session ──────────────
  `INSERT INTO mcogs_backlog (key, summary, description, item_type, priority, status, story_points)
   VALUES (
     'BACK-2427',
     'Auto-derived directives — nightly Pepper memory audit',
     'Nightly cron at 02:30 UTC scans all users chat history (last 7 days, 800-row cap) and pinned memory notes (500-row cap). Sends an anonymised corpus to Claude Haiku 4.5 with strict safety prompt: REJECT directives that bypass RBAC scope, reveal credentials/identities, codify single-user preferences (must observe pattern across 2+ distinct users), or contradict safety defaults (accuracy, write-confirmation, audit logging). Belt-and-braces server-side regex filter catches anything Claude misses. Persists kept directives to mcogs_settings.data.pepper_derived_directives. buildSystemPrompt now injects manual + derived directives in two sub-sections so they are distinguishable. Settings → AI gains a read-only panel under the manual textarea showing each derived directive with confidence badge + evidence count + last-derived timestamp + corpus stats. Run-now button triggers an on-demand derivation; Clear button wipes the blob (manual directives untouched).',
     'story', 'medium', 'done', 5
   )
   ON CONFLICT (key) DO UPDATE SET status = 'done', updated_at = NOW()`,

  // ── Step 166a: BACK-2429 — due_date on backlog + priority-based estimate seed ─
  // New nullable due_date column. Existing non-terminal items (status not in
  // done / wont_do) are auto-populated from priority + story_points using a
  // single AI-assisted developer cadence:
  //
  //   base offset by priority:  highest=2d  high=7d  medium=21d  low=60d  lowest=120d
  //   per-story-point bump:     +0.7d × story_points  (capped at +21d)
  //
  // Idempotent: only fills NULL rows on non-terminal status, so re-running
  // doesn't reshuffle dates the user has already adjusted.
  `ALTER TABLE mcogs_backlog ADD COLUMN IF NOT EXISTS due_date DATE`,

  `UPDATE mcogs_backlog SET due_date = (
     CURRENT_DATE
     + (CASE priority
          WHEN 'highest' THEN 2
          WHEN 'high'    THEN 7
          WHEN 'medium'  THEN 21
          WHEN 'low'     THEN 60
          WHEN 'lowest'  THEN 120
          ELSE 21
        END)::int
     + LEAST(21, GREATEST(0, FLOOR(COALESCE(story_points, 0) * 0.7)))::int
   )
   WHERE due_date IS NULL
     AND status NOT IN ('done', 'wont_do')`,

  `CREATE INDEX IF NOT EXISTS idx_backlog_due_date ON mcogs_backlog(due_date) WHERE due_date IS NOT NULL`,

  // ── Step 167a: BUG-1093 + BUG-1124 resolved ───────────────────────────────
  `UPDATE mcogs_bugs
   SET status = 'resolved',
       resolution = 'Inventory → Ingredient edit panel hardcoded the tab list as [details, allergens, nutrition, translations] regardless of feature flags. Added a new nutrition feature flag alongside the existing allergens flag, surfaced both in Configuration → Feature Flags. The Ingredient edit panel now derives visibleIngTabs from the flags (details + translations always; allergens / nutrition gated by their respective flags) and snaps back to details if the active tab gets hidden by a flag flip. Defence in depth: the tab body renders are also gated on the same flags, so a stale ingModalTab cannot render an allergens/nutrition tab body when the flag is off.',
       updated_at = NOW()
   WHERE key = 'BUG-1093' AND status <> 'resolved'`,

  `UPDATE mcogs_bugs
   SET status = 'resolved',
       resolution = 'Tracking note, not a bug. The localization implementation completed (CLAUDE.md §11, README) — closed.',
       updated_at = NOW()
   WHERE key = 'BUG-1124' AND status <> 'resolved'`,

  // ── Step 167b: BUG-1148 resolved — pinned-notes staleness ─────────────────
  `UPDATE mcogs_bugs
   SET status = 'resolved',
       resolution = 'Pinned notes are baked into the system prompt at session start. After a save_memory_note / delete_memory_note tool call, the snapshot in the Memory section was stale, but the system prompt still said "use the Memory section to answer". Claude often answered "list my notes" from the stale snapshot rather than calling list_memory_notes — so the just-saved note appeared missing. Third attempt would eventually trigger a real list_memory_notes call. Fix: (1) reword the Memory section to flag it as a session-start snapshot, (2) make the Memory Tools system-prompt section explicitly require a list_memory_notes call when the user asks to see/verify notes, (3) save_memory_note + delete_memory_note return strings now end with a reminder that the snapshot is stale, (4) save_memory_note now does an INSERT...RETURNING + verify SELECT round-trip on the same pool to catch any pooler-level surprises.',
       updated_at = NOW()
   WHERE key = 'BUG-1148' AND status <> 'resolved'`,

  // ── Step 168: Changelog — Apr 30 — derived directives shipped ─────────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-30', 'Pepper auto-derived directives', '[
     {"type":"added","description":"Nightly derived-directives job (BACK-2427) — api/src/jobs/deriveDirectives.js runs at 02:30 UTC daily, pulls last 7 days of chat + up to 500 pinned memory notes across all users, anonymises user identifiers (u1/u2/...), asks Claude Haiku to extract globally-applicable directives. Rejects RBAC-bypass / single-user / credential-revealing / safety-loosening candidates via dual defence — strict prompt rules + server-side regex filter (RBAC_BYPASS_PATTERNS). Caps at 12 directives sorted by confidence. Output persisted to mcogs_settings.data.pepper_derived_directives as { directives: [{text, evidence_count, confidence}], derived_at, stats }. No-op when ANTHROPIC_API_KEY is not configured."},
     {"type":"changed","description":"buildSystemPrompt() in api/src/routes/ai-chat.js now reads both pepper_directives (manual) and pepper_derived_directives (auto) from mcogs_settings.data and renders them as two sub-sections under a single Operator Directives header — “Set by administrator” and “Auto-derived from usage patterns”. Manual directives take precedence in conflicts."},
     {"type":"added","description":"GET/POST/DELETE /api/ai-config/derived-directives endpoints. GET returns the current blob; POST /run triggers on-demand derivation (admin convenience when corpus has just changed); DELETE clears the blob. All gated by settings:read / settings:write."},
     {"type":"added","description":"Settings → AI tab gains an Auto-derived directives panel below the manual directives textarea. Lists each derived directive with a coloured confidence badge (low/medium/high), evidence count, full text. Run now button triggers immediate derivation; Clear button (with ConfirmDialog) wipes the blob. Footer shows last-derived relative time + corpus stats (chats / notes / kept-vs-proposed)."},
     {"type":"fixed","description":"BUG-1148: save_memory_note appeared to silently fail intermittently — note seemed missing on follow-up list_memory_notes for two attempts before showing up on the third. Root cause: pinned notes are baked into the system prompt as a session-start snapshot. The system prompt told Claude to use that snapshot for personalization, so when the user said “list my notes” after a save, Claude often answered from the stale snapshot rather than calling the live list_memory_notes tool. Fix: (1) Memory section now flags itself as a session-start snapshot, (2) Memory Tools instructions now require a list_memory_notes call whenever the user asks to see/verify their notes, (3) save_memory_note + delete_memory_note return strings end with an explicit “snapshot now stale — call list_memory_notes” reminder, (4) save_memory_note now performs INSERT...RETURNING + a verify SELECT on the same pool to catch any pooler surprises before reporting success."},
     {"type":"added","description":"New nutrition feature flag (paired with existing allergens flag in Configuration → Feature Flags). When disabled, the Nutrition tab on the Inventory → Ingredient edit panel is hidden. Mirrors the existing allergens flag pattern."},
     {"type":"fixed","description":"BUG-1093: global allergens / nutrition feature flags didn’t hide the matching tabs on the Inventory → Ingredient edit panel. The tab list was hardcoded. Now the panel derives visibleIngTabs from feature flags (details + translations always shown; allergens and nutrition gated). Active tab snaps back to details if the user disables the current flag mid-session. Tab body renders are also gated for defence in depth."},
     {"type":"removed","description":"BUG-1124: closed as not-a-bug. It was a tracking note that the localization feature was complete (already documented in CLAUDE.md §11 and README)."},
     {"type":"added","description":"BACK-2429: due_date column on mcogs_backlog (nullable DATE). Auto-populated for existing non-terminal rows from priority + story_points (highest=2d, high=7d, medium=21d, low=60d, lowest=120d, plus 0.7d × story_points capped at +21d). New idx_backlog_due_date partial index. Backlog API accepts due_date on POST and PUT (empty / null clears, value sets, omitted keeps). Sort selector includes Due date (NULLS LAST). Backlog list table gains a Due column with red/amber colour-coding for overdue or soon-due (≤3d) items; kanban tiles show 📅 due-date chip with the same colour rules."},
     {"type":"added","description":"BACK-2430: time-window filter dropdown on the Backlog (Last 24h / 3 days / 7 days / Any age). Applied client-side over created_at, persists to localStorage(‘backlog-time-window’) so the user lands back on their last selection. Default is Any age."},
     {"type":"changed","description":"BACK-2431: Doc Library section moved from the functional sections to the Documentation block in System page (alongside Localization, Architecture, API Reference, Security, Troubleshooting, Domain Migration, CLAUDE.md). Hash-based deep-link /system#doc-library still resolves correctly."},
     {"type":"added","description":"BACK-2353: Recipe list grouped by category with expand/collapse. Each group header shows ▼/▶ glyph + uppercase category name + recipe count, sticky at the top of its block. Recipes without a category bucket under “Uncategorised” pinned to the top. Collapsed-state set persists to localStorage (recipes-collapsed-groups). Active search auto-expands every group so matches are never hidden. New ▼ All / ▶ All toolbar toggle collapses or expands every group at once. Item rows no longer show their category inline — the group header carries that information."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-30' AND title = 'Pepper auto-derived directives'
   )`,

  // ── Step 168b: Flip BACK-2517 to done (Story 1 of Menu Builder epic) ──────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-2517' AND status <> 'done'`,

  // ── Step 168c: Flip Menu Builder epic + remaining stories to done ─────────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key IN ('BACK-2516','BACK-2518','BACK-2519','BACK-2520','BACK-2521','BACK-2522','BACK-2523')
     AND status <> 'done'`,

  // ── Step 168d: Flip Menu Builder follow-ups (BACK-2545..2550) to done ─────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key IN ('BACK-2545','BACK-2546','BACK-2547','BACK-2548','BACK-2549','BACK-2550')
     AND status <> 'done'`,

  // ── Step 168e: Changelog — May 03 — Menu Builder follow-ups ───────────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Menu Builder follow-ups', '[
     {"type":"changed","description":"BACK-2545: + Add Sales Item button label (was “+ Add item”). Same change to the panel breadcrumb and the empty-state hint so the wording is consistent across the page."},
     {"type":"added","description":"BACK-2546: empty-state for the Search existing tab. When every catalog item is already on the menu, the panel says so explicitly and points the user to the Create new tab. Distinct from the no-catalog and no-search-match cases."},
     {"type":"changed","description":"BACK-2547: Linked to label (was “Type”) on the Create new tab radio. Clearer about what recipe / ingredient / manual / combo means in context."},
     {"type":"added","description":"BACK-2548: Ingredient picker shows market cost. New optional country_id query param on GET /api/ingredients adds a market-scoped cost LATERAL: preferred-vendor first, falling back to the cheapest active quote whose vendor sits in the same country. Picker rows in the menu builder now show {symbol}{cost}/{base_unit} and a star when the quote is the preferred one. When no active quote exists in the menu market, the row shows a + Add quote pill that opens an inline form for vendor (pick existing or inline-create) + price + qty in base units. Save fires POST /price-quotes and reloads the catalog so the cost shows up immediately."},
     {"type":"removed","description":"BACK-2549: Markets tab gone from the Edit-item panel. Sales-item market visibility is managed exclusively from the Sales Items page now — the menu is already scoped to one country, so the tab was redundant. Country / SalesItemMarket interfaces, the markets state, the toggle handler, the MarketsTab component, and the page-level countries fetch were all removed."},
     {"type":"changed","description":"BACK-2550: Modifiers tab flattened to one screen. Attached groups list at the top, Available groups list below — clicking any Available row attaches it in one click, no multi-select dialog. + New group button opens the create form. Optional search input appears only when the catalog has more than 6 groups."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Menu Builder follow-ups'
   )`,

  // ── Step 169: Changelog — Apr 30 — Recipes side-panel + optimistic edits ──
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-04-30', 'Recipes side panel + optimistic inline edits', '[
     {"type":"added","description":"Modifier multiplier checkbox now appears in the Recipes side panel as well as the inline × mod column. Visible only on the global view for ingredient items (matches the existing column behaviour). Includes inline copy explaining how the multiplier works and that saving here clears the flag on every other item in the same recipe (server-side single-flag-per-recipe rule)."},
     {"type":"changed","description":"Recipe inline edits no longer trigger a full detail reload. Quantity inline edits, the side-panel save, and the × mod toggle now patch the local items array optimistically (and mirror the server-side single-flag-per-recipe rule for the multiplier toggle). loadDetail still fires in the background so server-recalculated COGS replaces the stale per-row cost without holding up the UI. Failed saves still roll back via loadDetail."},
     {"type":"fixed","description":"Step 168 changelog INSERT had unescaped single quotes inside localStorage(‘backlog-time-window’) which terminated the outer SQL string literal early and rolled back the previous deploy. Replaced with curly quotes."},
     {"type":"added","description":"BACK-2516 epic: Unified Menu Builder. Story 1 (BACK-2517) shipped — new /menu-builder page (sidebar entry under Menus). Top-bar menu picker (persists last selection to localStorage), middle-pane items list (type badge + image + remove button), Add item side panel with two tabs: Search existing (live filter against the sales-item catalog, auto-hides items already on the menu, click to attach via POST /menu-sales-items) and Create new (type radio: recipe / ingredient / manual / combo + roadmap pointers to BACK-2518/2519/2520). Shell sets up the surface for stories 2–7 to plug branch-specific UI into without further refactoring."},
     {"type":"added","description":"Menu Builder Story 2 (BACK-2518) — Recipe / ingredient picker. When the user picks Create new → recipe, the panel now shows a search-only picker over /recipes (lazy-loaded, cached). Same for ingredient → /ingredients. Picking a row creates a wrapping mcogs_sales_items row of the matching type, then attaches it to the menu in one user action. Duplicate detection: if a sales item already wraps the picked recipe / ingredient, a confirm dialog offers Reuse existing or Make a new one. No recipe / ingredient creation here — the spec keeps those flows in the Recipes / Inventory modules respectively."},
     {"type":"added","description":"Menu Builder Story 3 (BACK-2519) — Manual sales item capture inline. New form on the Create new tab when type=manual: name (required), display name, category (CategoryPicker scoped to for_sales_items, allow create), manual cost (CalcInput so users can type expressions), image (ImageUpload with MediaLibrary integration), description. Save creates the sales item AND attaches to the menu in one user action."},
     {"type":"added","description":"Menu Builder Story 4 (BACK-2520) — Inline combo builder MVP. Create new → type=combo opens a single-form inline builder: combo header (name, category, image, description) + N steps + per-step options. Each step has min/max select + allow-repeat + auto-advance flags. Each option has type radio (recipe / ingredient / manual), a search picker for recipe / ingredient, manual cost input, price add-on, and qty. Save fires the full multi-step POST sequence: POST /combos → POST /sales-items {combo_id} → POST /menu-sales-items → POST /combos/:id/steps × N → POST /combos/:id/steps/:sid/options × M. Per-option modifier groups + drag-to-reorder + transactional rollback on partial failure deferred to a follow-up."},
     {"type":"added","description":"Menu Builder Story 5 (BACK-2521) — Inline modifier groups. New Modifiers tab on the Edit-item panel (click any item on the menu items list to open). Lists currently attached groups (from /sales-items/:id) with detach + show-inline toggle. Two add actions: Attach existing (search + multi-select against /modifier-groups, persists via PUT /sales-items/:id/modifier-groups with the FULL group list since the endpoint is replace-set semantics) or Create new (inline form: name + min/max select + allow_repeat + default_auto_show, fires POST /modifier-groups then auto-attaches). Per-option modifier groups on combo step options deferred."},
     {"type":"added","description":"Menu Builder Story 6 (BACK-2522) — Per-menu pricing + market visibility. Click any menu item row to open the Edit panel. Pricing tab loads via GET /menu-sales-items/:id/price-diff and shows one row per price level with default vs override + Save + tax-rate selector + Reset-to-default. Saves go to PUT /menu-sales-items/:id/prices per row. Markets tab toggles per-country active flag, auto-saves via PUT /sales-items/:id/markets (passes the full active country_ids list — replace semantics). Optimistic UI throughout with rollback on failure. Items with overrides show an amber price override badge in the items list."},
     {"type":"added","description":"Menu Builder Story 7 (BACK-2523) — Walker shell polish. Both panels (Add item + Edit item) gain a left-edge drag handle to resize between 320–720 px; width persists to localStorage(‘menu-builder-panel-width’) and is shared between both panels. Esc key closes any open panel. Panel headers gain a breadcrumb-style top line (menu › phase). Manual-item form persists draft state to sessionStorage(‘menu-builder-manual-draft’) so an accidental panel close does not throw away typed work; draft is cleared on successful save. Combo walker draft persistence + Ctrl/Cmd+Enter save shortcut deferred to a follow-up."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-04-30' AND title = 'Recipes side panel + optimistic inline edits'
   )`,

  // ── Step 169a: Per-conversation model id + tier on the chat log ───────────
  // Lets Settings → AI break out usage by tier (Story 6 / BACK-2568) — and
  // is generally useful for cost analysis once a deployment runs both Haiku
  // and Opus side by side.
  `ALTER TABLE mcogs_ai_chat_log ADD COLUMN IF NOT EXISTS model_id   VARCHAR(100)`,
  `ALTER TABLE mcogs_ai_chat_log ADD COLUMN IF NOT EXISTS model_tier VARCHAR(20)`,

  // ── Step 170: BACK-2563 — AI premium access flag + default model config ────
  // Two-tier Pepper: a default (cheap) model and a premium (newest) model.
  // Per-user toggle stored on mcogs_users.ai_premium_access; tier-to-model
  // mapping is configurable via mcogs_settings.data.ai_models so an admin
  // can promote to whichever Anthropic flagship is current without a deploy.
  `ALTER TABLE mcogs_users ADD COLUMN IF NOT EXISTS ai_premium_access BOOLEAN NOT NULL DEFAULT FALSE`,

  `UPDATE mcogs_settings
   SET data = COALESCE(data, '{}'::jsonb)
              || jsonb_build_object('ai_models',
                   COALESCE(data->'ai_models',
                     jsonb_build_object(
                       'default', 'claude-haiku-4-5-20251001',
                       'premium', 'claude-opus-4-7'
                     )
                   )
                 ),
       updated_at = NOW()
   WHERE id = 1`,

  // ── Step 170a: Flip Pepper-tier epic + all stories to done ────────────────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key IN ('BACK-2561','BACK-2562','BACK-2563','BACK-2564','BACK-2565','BACK-2566','BACK-2567','BACK-2568',
                 'BACK-2570','BACK-2571','BACK-2572','BACK-2573','BACK-2574',
                 'BACK-2585','BACK-2586','BACK-2587',
                 'BACK-2598','BACK-2599','BACK-2600',
                 'BACK-2611','BACK-2612','BACK-2613','BACK-2614','BACK-2615',
                 'BACK-2626','BACK-2627')
     AND status <> 'done'`,

  // ── Step 170b: Changelog — May 03 — Pepper model tier switcher shipped ────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Pepper — per-user model tier (cheap + premium switcher)', '[
     {"type":"added","description":"BACK-2563: Schema + plumbing. New mcogs_users.ai_premium_access boolean column, mcogs_settings.data.ai_models JSON object (default + premium model IDs, seeded with claude-haiku-4-5-20251001 + claude-opus-4-7), new mcogs_ai_chat_log.model_id + model_tier columns. /api/me now returns ai_premium_access + ai_models so the frontend can render the picker. PUT /api/users/:id accepts ai_premium_access for admin toggling. middleware/auth.js threads the flag onto req.user."},
     {"type":"added","description":"BACK-2564: Settings → AI gains a Model Tiers section with two text inputs for default + premium model IDs. Saves via PATCH /settings { ai_models: { default, premium } }. Admin-only (settings:write). Validation rejects values that do not start with claude-. Empty fields fall back to the hardcoded defaults so a fresh deployment still works without saving anything."},
     {"type":"added","description":"BACK-2565: POST /api/ai-chat and POST /api/ai-upload accept an optional model field (values: default | premium). Server resolves the requested tier to the actual Anthropic model ID via the new helpers/aiModels.js helper. Premium requests from users without ai_premium_access are rejected with 403 — never trust the client. Selected model id + tier persist to mcogs_ai_chat_log on every turn."},
     {"type":"added","description":"BACK-2566: Pepper header gains a Fast / Smart dropdown — only renders when the user has ai_premium_access. Selection persists to localStorage(pepper-model-tier) and snaps back to default if access is revoked. SSE stream now emits a {type: model, model: <id>} event before the first token so each assistant message can render a tiny model badge (Haiku / Sonnet / ✨ Opus). Subtitle under Pepper title shows the active model id when premium is granted."},
     {"type":"added","description":"BACK-2567: Configuration → Users & Roles gains a ✨ button next to the existing </> dev-flag toggle. Toggles ai_premium_access via PUT /users/:id with optimistic update and rollback on failure. Tooltip warns that premium burns the monthly token cap ~5× faster."},
     {"type":"added","description":"BACK-2568: Per-tier usage reporting. /api/ai-chat/my-usage now returns by_tier: { default, premium } alongside the rollup so users can see how much of their cap each model consumed. /api/ai-chat/usage gains premium_tokens + premium_period_tokens columns on the per-user breakdown so admins can spot heavy Opus users when deciding access."},
     {"type":"changed","description":"BACK-2561: Menu Builder button relabel — “+ Add Sales Item” is now “+ Add Sales Item to Menu” (button + empty-state hint, both kept consistent). No functional change."},
     {"type":"changed","description":"BACK-2570: Menu Builder pricing UX. Per-menu price overrides now edit inline on the items list — one editable cell per country-enabled price level (filtered via /country-price-levels/:countryId where is_enabled=true). Save on blur with optimistic patch + rollback. Pricing tab + PricingTab + PriceLevelRow components removed; the side panel is now single-purpose (modifier groups). Tax-rate selector removed from the inline cell — the cell saves with tax_rate_id null and existing per-item tax assignment is untouched."},
     {"type":"added","description":"BACK-2571: Group items by category toggle on the Menu Builder. Header gains a checkbox; when on, items render under sticky category headers (Uncategorised pinned to the top). Persisted to localStorage(menu-builder-group-by-category). Drag-drop is auto-disabled while grouping is on (in-group reorder is a follow-up)."},
     {"type":"added","description":"BACK-2572: Drag-drop sort for menu items. Native HTML5 DnD with accent-coloured drop indicator and 40% opacity on the dragged row. Persisted via new POST /api/menu-sales-items/reorder which updates sort_order in a single transaction. Optimistic UI + rollback on failure. Disabled while group-by-category is on."},
     {"type":"added","description":"BACK-2573: Menu Builder shows attached modifier groups inline below each item, collapsible via a caret on the parent row. Each modifier option renders one editable price cell per country-enabled price level — same column layout as the parent. Per-menu overrides save via PUT /menu-sales-items/:id/modifier-option-price; the catalog price_addon is the fallback display when no override exists. Override cells get the amber tint. Sub-prices are lazy-loaded via GET /menu-sales-items/:id/sub-prices on first expand and cached in-memory. /sub-prices loadModifierGroupsForItem now returns mo.price_addon on every option."},
     {"type":"added","description":"BACK-2574: Menu Builder shows full combo structure inline below combo items — steps → step options → step-option modifier groups → modifier options. Step options have per-level editable prices (PUT /menu-sales-items/:id/combo-option-price) and their own modifier groups expand into editable per-option/per-level cells. Indented to make the hierarchy obvious. /sub-prices loadComboStructure returns cso.price_addon on each step option and mo.price_addon on each step-option modifier option. Both stories share the same expand state + caret + ExpandedItemContent component."},
     {"type":"changed","description":"GET /api/menu-sales-items now returns modifier_group_count per row so the items list can decide whether to render the expand caret without an extra fetch."},
     {"type":"added","description":"BACK-2587: Right panel becomes context-aware via a discriminated EditTarget union — { kind: sales-item | modifier-group | combo-step }. Clicking a modifier-group header in the expanded inline view (or a group in the attached list) opens the group editor; clicking a combo-step header opens the step editor. Both editors share a common look: settings card up top, options list below with full CRUD + drag-drop reorder. Breadcrumb back to the SI panel."},
     {"type":"added","description":"BACK-2585: Modifier-group editor panel — full options CRUD inline. Settings auto-save on blur (name + min/max + allow_repeat + default_auto_show). Options list shows each option with name + type radio (recipe / ingredient / manual) + recipe/ingredient picker OR manual_cost + price_addon + qty. Drag-drop reorder via new POST /api/modifier-groups/:id/options/reorder (transactional sort_order UPDATE). + Add option creates a manual placeholder ready for editing. Per-option spinner during save."},
     {"type":"added","description":"BACK-2587: Combo-step editor panel — same shape as the modifier-group editor but for combo steps. Settings include auto_select. Options persist into mcogs_combo_step_options via the existing PUT /combos/:id/steps/:sid/options/:oid endpoint. Drag-drop via new POST /combos/:id/steps/:sid/options/reorder."},
     {"type":"added","description":"BACK-2586: Drag-drop sort attached modifier groups inside the side-panel attached list. New order persists via the existing replace-set PUT /sales-items/:id/modifier-groups (sort_order implied by array index). Drop indicator + 40% opacity on the dragged item match the parent items-list pattern."},
     {"type":"changed","description":"BACK-2598: Inside an expanded item, modifier groups + combo steps + per-step-option modifier groups are now collapsed by default. Each header gains its own caret toggle; the existing Edit › pill still routes to the right-panel editor. Per-key expand state persists to localStorage(menu-builder-expanded-inner-keys) so the operator does not have to re-collapse on every reload."},
     {"type":"added","description":"BACK-2599: Right panel sales-item context now shows a full Details section above the Modifier groups list. Auto-saves every field on blur (image, name, display_name, category with create, description, type-specific picker — manual_cost / linked recipe / linked ingredient / read-only combo pointer). The operator can edit every sales-item field without leaving Menu Builder."},
     {"type":"added","description":"BACK-2600: Quick-edit recipe + ingredient modals. Edit ✎ button next to the linked-recipe / linked-ingredient picker opens a focused modal with the entity core fields (name, category, image, plus type-specific fields: yield_qty + yield_unit_text for recipes; base_unit_id + default_prep_unit + waste_pct for ingredients). Save fires PUT /api/recipes/:id or /api/ingredients/:id and reloads the right panel so name + image changes flow through immediately. Each modal links out to the parent module (Recipes / Inventory) for deep edits."},
     {"type":"changed","description":"BACK-2611: Menu Builder rows now have a dedicated drag handle (⠿) at the very left. Drag works only from that handle; the rest of the row is a normal click target."},
     {"type":"changed","description":"BACK-2612: Clicking anywhere on a menu item row opens the side panel for that sales item. The Modifiers › button keeps its prior behaviour (opens the panel directly to the Modifiers tab); row-body click opens to the Details tab."},
     {"type":"added","description":"BACK-2613: Side panel for sales-item context now has Details + Modifiers tabs. The initial tab is driven by what was clicked: row body → Details, Modifiers button → Modifiers. Tab state persists across the panel session; closing the panel resets it on next open."},
     {"type":"added","description":"BACK-2614: Details tab gains a Type radio (Recipe / Ingredient / Manual / Combo). Switching wipes any previously linked entity ids so a recipe-typed sales item never carries an ingredient_id, etc. The matching field appears below — recipe picker, ingredient picker, manual cost, or read-only combo pointer."},
     {"type":"changed","description":"BACK-2615: Recipe + Ingredient quick-edit modals Open in Recipes / Open in Inventory now deep-link to the specific entity. Recipes page reads ?recipe_id=X and auto-opens that recipe; Inventory page reads ?ingredient_id=X and auto-opens the edit modal for that ingredient on the Ingredients tab. Param consumed once and removed from the URL so reloads do not re-trigger."},
     {"type":"changed","description":"BACK-2626: Type field on the Details tab is now a locked select with an Edit ✎ toggle, replacing the previous radio-row that fired changeType on every click and accidentally wiped linked recipe / ingredient / combo / manual_cost. Unlock state is amber-styled with an explicit warning that changing wipes the linked entity. Selecting a different value commits and re-locks the field."},
     {"type":"fixed","description":"Recipes page deep-link (?recipe_id=) was firing the auto-open call against a still-null loadDetail ref because the ref-assignment effect ran AFTER the deep-link effect on the first render where recipes populated. Inlined loadDetail into the effect dep array (it is useCallback-wrapped on api so stays stable) and removed the ref indirection."},
     {"type":"changed","description":"BACK-2627: Combo branch in the Create new tab now uses the same search picker as recipes and ingredients — pick an existing combo from /api/combos, the wrapping sales item is created with combo_id set and attached to the menu. Combo creation moves to the Sales Items module (where combos live). The previous inline ComboBuilderForm + createComboAndAttach pipeline are kept in code as dead-but-leaving-intact for now; they can be removed once the new flow is confirmed in production. Recipe + Ingredient quick-edit modals from earlier turns also fully removed in this change since they had been replaced with direct deep-links to the full modules."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Pepper — per-user model tier (cheap + premium switcher)'
   )`,

  // ── Step 170c: Flip Menu Builder follow-up trio to done ───────────────────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key IN ('BACK-2638','BACK-2639','BACK-2640')
     AND status <> 'done'`,

  // ── Step 170d: Changelog — May 03 — Menu Builder cost + manual + add-new ──
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Menu Builder — COGS column, manual picker, Add new shortcuts', '[
     {"type":"added","description":"BACK-2638: Menu Builder items list now shows the cost per item in its own Cost column (market currency, two-decimal). Cost is sourced from /api/cogs/menu-sales/:menuId — fetched alongside /menu-sales-items on every load — and mapped by menu_sales_item id. Each per-level price cell now also renders a small COGS% beneath it (cost ÷ price × 100, rounded to one decimal); the percentage hides when the price is zero. Modifier rows and combo step-option rows still show their own price-addon column, unchanged."},
     {"type":"changed","description":"BACK-2639: Manual sales items now use the same picker pattern as recipes / ingredients / combos in the Add new sales item side panel. The Manual tab lists every existing item_type=manual sales item from the catalog with its name, category, and image — pick one and it is attached straight to the menu via the existing onAttachExisting flow. The previous inline ManualItemForm (name + cost + category) is removed from the create path. Manual creation moves to the Sales Items module (consistent with the combo move in BACK-2627)."},
     {"type":"added","description":"BACK-2640: Each picker tab in the Add new sales item side panel now shows a + Add new ↗ link next to the search input. Recipe → /recipes, Ingredient → /inventory, Combo → /sales-items, Manual → /sales-items. Links open in a new tab via target=_blank + rel=noopener,noreferrer so the operator can create an entity in the source module without losing their place in the menu builder. Empty-state and bottom-hint copy updated to point at the new shortcut."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Menu Builder — COGS column, manual picker, Add new shortcuts'
   )`,

  // ── Step 170e: Flip BACK-2651 to done (price-cell cost + COGS% stack) ─────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-2651' AND status <> 'done'`,

  // ── Step 170f: Changelog — May 03 — Cost + COGS% folded into the price ───
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Menu Builder — Cost + COGS% folded into the price cell', '[
     {"type":"changed","description":"BACK-2651: Menu Builder items list drops the standalone Cost column. Each per-level price cell now stacks the sell-price input on top, the cost in the market currency just below it (₹20.46), and the COGS% under that (1.9%). Saves horizontal space and keeps cost / sell-price / margin together for each level. Column header tooltip on the level name now reads Sell price · cost · COGS%."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Menu Builder — Cost + COGS% folded into the price cell'
   )`,

  // ── Step 170g: Flip BACK-2652 to done (seamless Add new flow + banner) ────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-2652' AND status <> 'done'`,

  // ── Step 170h: Changelog — May 03 — Seamless Add new + Return banner ─────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Menu Builder — Seamless Add new with Return-to-Menu-Builder banner', '[
     {"type":"changed","description":"BACK-2652: Menu Builder + Add new picker shortcut no longer opens a new tab. It now stashes the menu + item type in sessionStorage and same-tab navigates to the source module (/recipes for recipe, /inventory for ingredient, /sales-items?new=combo for combo, /sales-items?new=manual for manual). The source page auto-opens its Create modal and renders a sticky ReturnToMenuBuilderBanner at the top while the user builds the entity at their own pace — multi-step flows like recipes-with-variants and combos-with-steps-and-modifiers are fully supported because the banner does not constrain the source modules Save / Cancel buttons."},
     {"type":"added","description":"New shared component ReturnToMenuBuilderBanner reads the handoff + pending-attach state from sessionStorage and shows two states: Awaiting save while the user is still building, then + Add <name> to <menu> once the source module saves. Click attaches the new entity to the originating menu (wrapping recipe / ingredient / combo in a fresh sales-item where needed via POST /sales-items, then POST /menu-sales-items) and bounces back to /menu-builder?menu=X&attached=Y. Cancel button on the banner clears the handoff without attaching anything."},
     {"type":"added","description":"New helper module app/src/lib/menuBuilderHandoff.ts owns the sessionStorage keys (menu-builder-handoff + menu-builder-pending-attach), exposes typed setters / getters, fires a custom event so the same-tab banner flips state without polling, and TTLs stale handoffs after 24 hours so an abandoned flow does not haunt the UI."},
     {"type":"changed","description":"Menu Builder mount now reads ?menu=<id> + ?attached=<msi_id> on return: the menu= half overrides the localStorage-restored selection so the user lands on the originating menu, and the attached= half surfaces a confirmation toast Added <name> to <menu>. Both params are stripped from the URL after consumption so a reload does not re-fire the toast."},
     {"type":"added","description":"Recipes / Inventory / Sales Items pages each: (a) mount ReturnToMenuBuilderBanner at the top of the layout, (b) auto-open their Create modal when ?new= is set AND a handoff is present (the handoff guard means a stray ?new= is a no-op), and (c) call setPendingAttach after a successful new-entity save so the banner flips into Add-to-menu state. Sales Items handles ?new=combo (opens Combo create modal on combos tab) and ?new=manual (opens Sales Item modal pre-selected to manual on items tab). The IngredientsTab gains autoOpenNew + onAutoOpenNewConsumed props; SalesItemsPage gains a parallel newManualMode flag alongside the existing newComboMode."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Menu Builder — Seamless Add new with Return-to-Menu-Builder banner'
   )`,

  // ── Step 170i: Flip BUG-1164 to resolved (170h JSONB parse fix) ──────────
  `UPDATE mcogs_bugs SET status = 'resolved', updated_at = NOW()
   WHERE key = 'BUG-1164' AND status <> 'resolved'`,

  // ── Step 170k: Flip BACK-2673 to done (tax + cost layout in price cell) ──
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-2673' AND status <> 'done'`,

  // ── Step 170l: Changelog — May 03 — Tax + cost beside the price ──────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Menu Builder — Tax before price, cost + COGS% beside it', '[
     {"type":"changed","description":"BACK-2673: Each per-level price cell now lays out horizontally — Tax % on the left, the sell-price input in the middle, cost stacked above COGS% on the right. Replaces the previous below-the-input stack so the operator can see all four numbers without vertical scanning. Tax is the assigned country + level rate from mcogs_country_level_tax; it shows an em-dash when no rate is assigned for the level in this market. Hover title on the tax cell reveals the rate name and exact percentage."},
     {"type":"added","description":"GET /api/country-price-levels/:countryId now joins mcogs_country_level_tax + mcogs_country_tax_rates and returns tax_rate_id + tax_rate_name + tax_rate alongside the existing price_level_id / price_level_name / is_enabled. Frontend CountryPriceLevel type extended to match. No additional API calls — the tax lookup piggybacks on the existing per-menu price-level fetch."},
     {"type":"changed","description":"Items list column header for each price level widened from w-24 to w-58 to fit the tax · price · cost layout, with right-padding so the level name still aligns over the price input. Header tooltip updated to read Tax % · sell price · cost / COGS%."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Menu Builder — Tax before price, cost + COGS% beside it'
   )`,

  // ── Step 170m: Flip BACK-2684 to done (preserve filename on upload) ──────
  `UPDATE mcogs_backlog SET status = 'done', updated_at = NOW()
   WHERE key = 'BACK-2684' AND status <> 'done'`,

  // ── Step 170n: Changelog — May 03 — Media Library filename preserved ─────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Media Library — preserve original filename on upload', '[
     {"type":"fixed","description":"BACK-2684: POST /api/media/upload was overwriting both filename and original_filename in mcogs_media_items with a random unique base (timestamp + random base36), so the operator only ever saw cryptic labels like 1730841234567-abc.jpg in the library list. Now the user-facing label (filename column) and the original_filename column both store path.basename(file.originalname). The on-disk storage_key / thumb_key / web_key still use the unique random base so two simultaneous uploads of logo.png do not collide on disk. URLs and image-serving routes are unchanged. Existing legacy rows keep their random labels — operators can rename via the existing inline-edit affordance in the library list."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Media Library — preserve original filename on upload'
   )`,

  // ── Step 170j: Changelog — May 03 — Migration JSONB parse fix ────────────
  `INSERT INTO mcogs_changelog (version, title, entries)
   SELECT '2026-05-03', 'Deploy fix — migration step 170h JSONB parse', '[
     {"type":"fixed","description":"BUG-1164: Migration step 170h failed on production with invalid input syntax for type json (Token < is invalid). Cause: changelog description used a single-backslash escape sequence inside a JS template literal, which JavaScript collapses to a bare double-quote before PostgreSQL parses the JSON string — so the inner quote closed the string prematurely and the next character (an angle bracket) was unparseable. Same failure mode as BUG-1035. Removed the unnecessary inner quotes from the placeholder text (they were just emphasis around the name and menu placeholders). Added scripts/_validate-changelog.js — a one-shot Node validator that simulates JS template-literal evaluation on every mcogs_changelog INSERT in migrate.js and runs JSON.parse on the result. Pre-flight validation is now mandatory in the EOS protocol before any changelog commit."}
   ]'::jsonb
   WHERE NOT EXISTS (
     SELECT 1 FROM mcogs_changelog
     WHERE version = '2026-05-03' AND title = 'Deploy fix — migration step 170h JSONB parse'
   )`,
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
