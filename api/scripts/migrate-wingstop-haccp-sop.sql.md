# Migration stub — Wingstop HACCP / Checklist / SOP

**Status:** stub for review. Not yet appended to `api/scripts/migrate.js`.
**Companion:** `docs/WINGSTOP_HACCP_SOP_SCOPE.md`.

When approved, paste the statements below into `migrate.js` as the next "Step N" block, in the order shown. Every statement is `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` so the file stays re-runnable.

---

## Step A — HACCP adaptations (§3.1 of scope)

```sql
-- A.1  Per-product overrides on shared equipment
CREATE TABLE IF NOT EXISTS mcogs_equipment_products (
  id              SERIAL PRIMARY KEY,
  equipment_id    INTEGER NOT NULL REFERENCES mcogs_equipment(id) ON DELETE CASCADE,
  product_label   VARCHAR(200) NOT NULL,
  recipe_id       INTEGER REFERENCES mcogs_recipes(id) ON DELETE SET NULL,
  target_min_temp NUMERIC(5,1),
  target_max_temp NUMERIC(5,1),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A.2  Link existing temp logs to a product (nullable preserves equipment-only logs)
ALTER TABLE mcogs_equipment_temp_logs
  ADD COLUMN IF NOT EXISTS equipment_product_id INTEGER
  REFERENCES mcogs_equipment_products(id) ON DELETE SET NULL;

-- A.3  Recipe presets driving CCP cooking targets
ALTER TABLE mcogs_recipes ADD COLUMN IF NOT EXISTS cook_min_temp_c     NUMERIC(5,1);
ALTER TABLE mcogs_recipes ADD COLUMN IF NOT EXISTS cook_max_temp_c     NUMERIC(5,1);
ALTER TABLE mcogs_recipes ADD COLUMN IF NOT EXISTS hot_hold_min_temp_c NUMERIC(5,1);

-- A.4  Scheduled checks (Today grid + missed-slot detection)
CREATE TABLE IF NOT EXISTS mcogs_haccp_check_schedules (
  id                   SERIAL PRIMARY KEY,
  location_id          INTEGER REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  equipment_id         INTEGER REFERENCES mcogs_equipment(id) ON DELETE CASCADE,
  equipment_product_id INTEGER REFERENCES mcogs_equipment_products(id) ON DELETE CASCADE,
  slot                 VARCHAR(20) NOT NULL CHECK (slot IN ('AM','MIDDAY','PM','HOURLY','30MIN','2HOUR')),
  due_local_time       TIME,
  recurrence_cron      VARCHAR(50),
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A.5  Thermometer probes
CREATE TABLE IF NOT EXISTS mcogs_thermometers (
  id          SERIAL PRIMARY KEY,
  location_id INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  color_tag   VARCHAR(20),
  serial      VARCHAR(100),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A.6  Calibration log
CREATE TABLE IF NOT EXISTS mcogs_thermometer_calibration_logs (
  id                SERIAL PRIMARY KEY,
  thermometer_id    INTEGER NOT NULL REFERENCES mcogs_thermometers(id) ON DELETE CASCADE,
  method            VARCHAR(30) NOT NULL CHECK (method IN ('ice_point','boiling_point','reference_probe')),
  expected_c        NUMERIC(5,1) NOT NULL,
  measured_c        NUMERIC(5,1) NOT NULL,
  passed            BOOLEAN NOT NULL,
  corrective_action TEXT,
  logged_by         VARCHAR(200),
  logged_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A.7  Goods-inwards temperature on existing GRN line table
ALTER TABLE mcogs_goods_received_items
  ADD COLUMN IF NOT EXISTS received_temp_c                 NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS received_temp_passed            BOOLEAN,
  ADD COLUMN IF NOT EXISTS received_temp_corrective_action TEXT;

-- A.8  Indexes
CREATE INDEX IF NOT EXISTS idx_eq_products_equipment ON mcogs_equipment_products(equipment_id);
CREATE INDEX IF NOT EXISTS idx_temp_logs_eq_product  ON mcogs_equipment_temp_logs(equipment_product_id)
  WHERE equipment_product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_check_sched_loc       ON mcogs_haccp_check_schedules(location_id, slot);
CREATE INDEX IF NOT EXISTS idx_thermometers_loc      ON mcogs_thermometers(location_id);
CREATE INDEX IF NOT EXISTS idx_calib_thermometer     ON mcogs_thermometer_calibration_logs(thermometer_id);
CREATE INDEX IF NOT EXISTS idx_calib_logged_at       ON mcogs_thermometer_calibration_logs(logged_at DESC);
```

---

## Step B — Checklist engine (§4.1 of scope)

```sql
-- B.1  Templates
CREATE TABLE IF NOT EXISTS mcogs_checklist_templates (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50) UNIQUE NOT NULL,
  name        VARCHAR(200) NOT NULL,
  description TEXT,
  shift       VARCHAR(20) CHECK (shift IN ('opening','midday','closing','recurring')),
  role        VARCHAR(50),
  brand       VARCHAR(50),
  location_id INTEGER REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  is_system   BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- B.2  Items (sop_step_id is a forward reference; kept nullable & unconstrained
--       until Step C runs, then a follow-up FK can be added)
CREATE TABLE IF NOT EXISTS mcogs_checklist_items (
  id                  SERIAL PRIMARY KEY,
  template_id         INTEGER NOT NULL REFERENCES mcogs_checklist_templates(id) ON DELETE CASCADE,
  section             VARCHAR(100),
  label               TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  requires_photo      BOOLEAN NOT NULL DEFAULT FALSE,
  requires_signature  BOOLEAN NOT NULL DEFAULT FALSE,
  requires_temp_link  BOOLEAN NOT NULL DEFAULT FALSE,
  sop_step_id         INTEGER,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

-- B.3  Schedules
CREATE TABLE IF NOT EXISTS mcogs_checklist_schedules (
  id               SERIAL PRIMARY KEY,
  template_id      INTEGER NOT NULL REFERENCES mcogs_checklist_templates(id) ON DELETE CASCADE,
  location_id      INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  recurrence       VARCHAR(20) NOT NULL CHECK (recurrence IN ('daily','weekly','30min','hourly','2hour','custom')),
  start_local_time TIME,
  end_local_time   TIME,
  cron_expr        VARCHAR(50),
  is_active        BOOLEAN NOT NULL DEFAULT TRUE
);

-- B.4  Runs
CREATE TABLE IF NOT EXISTS mcogs_checklist_runs (
  id                       SERIAL PRIMARY KEY,
  template_id              INTEGER NOT NULL REFERENCES mcogs_checklist_templates(id) ON DELETE RESTRICT,
  location_id              INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  run_date                 DATE NOT NULL,
  slot_label               VARCHAR(50),
  started_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at             TIMESTAMPTZ,
  completed_by_user_sub    VARCHAR(200),
  manager_signoff_user_sub VARCHAR(200),
  manager_signoff_at       TIMESTAMPTZ,
  status                   VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                           CHECK (status IN ('in_progress','completed','missed','cancelled'))
);

-- B.5  Run items
CREATE TABLE IF NOT EXISTS mcogs_checklist_run_items (
  id          SERIAL PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES mcogs_checklist_runs(id) ON DELETE CASCADE,
  item_id     INTEGER NOT NULL REFERENCES mcogs_checklist_items(id) ON DELETE RESTRICT,
  status      VARCHAR(20) NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','done','skipped','na','failed')),
  value_text  TEXT,
  photo_id    INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  temp_log_id INTEGER REFERENCES mcogs_equipment_temp_logs(id) ON DELETE SET NULL,
  signed_by   VARCHAR(200),
  signed_at   TIMESTAMPTZ,
  notes       TEXT
);

-- B.6  Indexes
CREATE INDEX IF NOT EXISTS idx_checklist_items_tpl     ON mcogs_checklist_items(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_checklist_runs_loc_date ON mcogs_checklist_runs(location_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_checklist_run_items_run ON mcogs_checklist_run_items(run_id);
```

---

## Step C — Interactive SOP module (§5.1 of scope)

```sql
-- C.1  Documents
CREATE TABLE IF NOT EXISTS mcogs_sop_documents (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(50) UNIQUE NOT NULL,
  title           VARCHAR(200) NOT NULL,
  role            VARCHAR(50),
  brand           VARCHAR(50),
  locale          VARCHAR(10) NOT NULL DEFAULT 'en',
  version         INTEGER NOT NULL DEFAULT 1,
  status          VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  description     TEXT,
  cover_media_id  INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  est_minutes     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

-- C.2  Sections
CREATE TABLE IF NOT EXISTS mcogs_sop_sections (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES mcogs_sop_documents(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  est_minutes INTEGER
);

-- C.3  Steps
CREATE TABLE IF NOT EXISTS mcogs_sop_steps (
  id               SERIAL PRIMARY KEY,
  section_id       INTEGER NOT NULL REFERENCES mcogs_sop_sections(id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  body_md          TEXT NOT NULL,
  media_id         INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  interaction_type VARCHAR(30) NOT NULL DEFAULT 'read'
                   CHECK (interaction_type IN ('read','tap_confirm','photo_evidence','temp_input','quiz')),
  interaction_meta JSONB
);

-- C.4  Quizzes
CREATE TABLE IF NOT EXISTS mcogs_sop_quizzes (
  id            SERIAL PRIMARY KEY,
  section_id    INTEGER NOT NULL REFERENCES mcogs_sop_sections(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  options       JSONB NOT NULL,
  correct_index INTEGER NOT NULL,
  explanation   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0
);

-- C.5  Per-user step progress
CREATE TABLE IF NOT EXISTS mcogs_sop_user_progress (
  id           SERIAL PRIMARY KEY,
  user_sub     VARCHAR(200) NOT NULL,
  step_id      INTEGER NOT NULL REFERENCES mcogs_sop_steps(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_id     INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  value        TEXT,
  UNIQUE (user_sub, step_id)
);

-- C.6  Quiz attempts (history, not just last)
CREATE TABLE IF NOT EXISTS mcogs_sop_quiz_attempts (
  id             SERIAL PRIMARY KEY,
  user_sub       VARCHAR(200) NOT NULL,
  quiz_id        INTEGER NOT NULL REFERENCES mcogs_sop_quizzes(id) ON DELETE CASCADE,
  selected_index INTEGER NOT NULL,
  is_correct     BOOLEAN NOT NULL,
  attempted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C.7  Certifications
CREATE TABLE IF NOT EXISTS mcogs_sop_certifications (
  id                       SERIAL PRIMARY KEY,
  user_sub                 VARCHAR(200) NOT NULL,
  document_id              INTEGER NOT NULL REFERENCES mcogs_sop_documents(id) ON DELETE CASCADE,
  document_version         INTEGER NOT NULL,
  certified_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  manager_signoff_user_sub VARCHAR(200),
  manager_signoff_at       TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ,
  UNIQUE (user_sub, document_id, document_version)
);

-- C.8  Cross-links — checklist_item / equipment / recipe / qsc_question / ccp_log_type
CREATE TABLE IF NOT EXISTS mcogs_sop_links (
  id          SERIAL PRIMARY KEY,
  step_id     INTEGER NOT NULL REFERENCES mcogs_sop_steps(id) ON DELETE CASCADE,
  target_type VARCHAR(50) NOT NULL CHECK (target_type IN ('checklist_item','equipment','recipe','qsc_question','ccp_log_type')),
  target_id   VARCHAR(50) NOT NULL,
  UNIQUE (step_id, target_type, target_id)
);

-- C.9  Indexes
CREATE INDEX IF NOT EXISTS idx_sop_sections_doc  ON mcogs_sop_sections(document_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sop_steps_section ON mcogs_sop_steps(section_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_sop_progress_user ON mcogs_sop_user_progress(user_sub);
CREATE INDEX IF NOT EXISTS idx_sop_certs_user    ON mcogs_sop_certifications(user_sub);
CREATE INDEX IF NOT EXISTS idx_sop_links_target  ON mcogs_sop_links(target_type, target_id);

-- C.10  Late FK from Step B.2 (now that mcogs_sop_steps exists)
ALTER TABLE mcogs_checklist_items
  DROP CONSTRAINT IF EXISTS mcogs_checklist_items_sop_step_fk;
ALTER TABLE mcogs_checklist_items
  ADD  CONSTRAINT mcogs_checklist_items_sop_step_fk
       FOREIGN KEY (sop_step_id) REFERENCES mcogs_sop_steps(id) ON DELETE SET NULL;
```

---

## Step D — Seed pack hooks (no schema, just placeholders)

The actual seed data lives in JSON fixtures, loaded at migrate time the same way `qsc-questions.json` is. Three fixtures will be added under `api/scripts/fixtures/`:

- `wingstop-haccp-seed.json` — equipment template, products, recipe presets, schedules
- `wingstop-checklists-seed.json` — 12 templates + ~150 items (Opening / Midday / Closing / 30-min / 2-h)
- `wingstop-sops-seed.json` — initial SOP document skeletons (titles + section headings, populated by ops team)

Each loader follows the existing pattern in `migrate.js`:

```js
let WINGSTOP_HACCP_SEED = [];
try {
  const p = path.resolve(__dirname, 'fixtures/wingstop-haccp-seed.json');
  if (fs.existsSync(p)) WINGSTOP_HACCP_SEED = JSON.parse(fs.readFileSync(p, 'utf8'));
} catch (e) { console.warn('[migrate] wingstop-haccp-seed load failed:', e.message); }
```

Insert is gated on `WHERE NOT EXISTS (SELECT 1 FROM mcogs_equipment_products LIMIT 1)` so the seed runs once, never duplicates, and never touches a location whose admin has already populated it manually.

---

## Notes for the implementer

- **Where to paste in `migrate.js`:** Steps A, B, C should each be appended to the array of migration statements after the last existing step (currently in the 100-series). Use the existing comment-banner style (`// ── Step N: ... ──`).
- **Re-runnability:** every CREATE / ADD COLUMN uses `IF NOT EXISTS`. The Step C.10 FK uses `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT` so the reverse-then-forward pattern works even if a partial run added the constraint earlier.
- **Audit-log integration:** new write endpoints must call `logAudit(pool, req, { action, entity_type, entity_id, entity_label })` exactly as `haccp.js` already does; no schema change is needed for audit.
- **RBAC:** the new permission keys (§6.1 of scope) are added to the default role JSON in `mcogs_roles` via a one-shot `UPDATE` statement during the same migration step, again gated with `NOT EXISTS` so it only runs the first time.
- **Tests:** add `api/test/haccp-products.spec.js`, `api/test/checklists.spec.js`, `api/test/sops.spec.js` (vitest). Re-use the auth helper at `api/test/helpers/auth.js`.
