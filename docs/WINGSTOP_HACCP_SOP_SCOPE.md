# Wingstop HACCP Adaptation & Interactive SOP — Scope & Plan

**Status:** Draft for review
**Branch:** `claude/wingstop-haccp-analysis-Z0Kf7`
**Source docs analysed:**
- `docs/Safety records book - training.pdf` (15 slides — weekly logbook the team fills in by hand)
- `docs/OPS Manual (1).pdf` (63 slides — station-based training/SOP deck)

**Existing in-app references:**
- `api/src/routes/haccp.js` + `app/src/pages/HACCPPage.tsx` (Equipment / Temp Logs / CCP Logs / Report)
- `api/src/routes/qsc.js` + `app/src/pages/audits/*` (Wingstop QSC audit module — 150 scored items seeded from `Wingstop_QSC_12_17_24.xlsx`)
- `api/scripts/migrate.js` (single source of truth for schema)
- `docs/wingstop_audit_tool_spec.md` (the QSC tool spec — companion to this doc)

---

## 1. Document analysis

### 1.1 `Safety records book - training.pdf`

A 7-day paper logbook with the following sections:

| # | Section | What it captures | Frequency |
|---|---|---|---|
| 1 | Hot-hold log | Wings 63 °C, Cheese sauce 63 °C | AM / Midday / PM × 7 days |
| 2 | Cooked-to-order log | Wings **93–99 °C**, Boneless **79–91 °C**, Tenders **79–91 °C** | AM / Midday / PM |
| 3 | Cold-hold log | Wings on line / BOH wings / Ranch / Bleu cheese / Honey mustard / Slaw → **1–4 °C**; Milkshake mix **2–5 °C max 5 °C** | AM / Midday / PM |
| 4 | Equipment temps | 10 fryers @ 350 °F / 177 °C; 8 chillers 1–4 °C; 8 freezers −18 °C to −23 °C; walk-in chiller 1–4 °C; walk-in freezer −18 °C to −23 °C | AM / Midday / PM |
| 5 | Required actions | Free-text corrective-action notes | As needed |
| 6 | Opening checklist | Manager/SL block (10 items) + FOH (18 items) + BOH (24 items) | Once per opening |
| 7 | Midday checklist | Manager/SL (7) + FOH (11) + BOH (16) | Once per midday |
| 8 | Closing checklist | Manager/SL (7) + FOH (15) + BOH split by station: Bombardier (7), Gunner (7), Wingman (10), Paratrooper (5) | Once per closing |
| 9 | Daily inventory | Wings / Boneless / Tenders / Fries × On-line / Walk-in / Total | Daily |
| 10 | Wastes management | Wings / Boneless / Tenders / Fries / Other × AM shift / PM shift | Per shift |
| 11 | Chicken counts | Wings / Boneless / Tenders × Count 1 / Count 2 / Mis-cuts | Daily |
| 12 | Par-level prep planner | Par / On-hand / Prep | Daily |
| 13 | Figure-8 30-min check | Initials in 30-min slots from 10:00 to 23:00 | Every 30 min |
| 14 | 2-hour sanitiser rule | Sanitiser change at comp sink / bowls / tongs / sanitise stations | Every 2 hr 09:00–23:00 |
| 15 | Delivery log | Day / Chilled temp / Frozen temp / Signature | Per delivery |
| 16 | Thermometer calibration | Red / Yellow / White probes — date & result | Per calibration |
| 17 | Position chart AM/PM | Bombardier / Wingman / Gunner / Pilot / Runner zones 1–4 / Host / Manager (tablet) / Manager 2 | Per shift |
| 18 | Communication board | Today sales target, last-week sales / TRX, OSAT 85 %, Accuracy 89 %, SOS 80 %, Taste 85 %, Last QSC visit, Focus, Employee of the Month | Per shift |
| 19 | Protein-size QA | Tenders ≥ 90 mm (10 % tolerance, C-shape exception); Boneless red-square 2.5 cm – 7 cm grid | Per supplier delivery / spot-check |

### 1.2 `OPS Manual (1).pdf`

A 63-slide PowerPoint deck. The textual extract is sparse because the slides are heavily graphical (diagrams, photos, role icons), but the structure is unambiguous:

- Dress-code & food-safety basics (slides 1–2)
- Eight-station kitchen layout SOPs, each ~6–8 slides:
  - **Bombardier** — chicken handling, RIC stocking, raw-classic-wing drawers
  - **Wingman** — sauce table, dip rotation, sauce pan dating
  - **Gunner** — fryers, fry/corn/churro line, boil-out
  - **Pilot** — dips, take-away bags, packaging, expo
  - **Paratrooper** — dish, sanitation, prep walls
  - **Runner / Host / Manager** — FOH flow, shift huddle, deployment
- Daily / weekly checklist execution flow (linked to the safety book)
- Customer-experience scripts ("Great Guest Experience" — ambience, FOH roles, responsibilities)
- Protein-size reference page (mirrors §1.1 row 19)

This deck is the natural source corpus for the **interactive SOP module** (§4).

---

## 2. What's already implemented

### 2.1 HACCP module (in place)

**Schema (from `api/scripts/migrate.js`):**

| Table | Purpose |
|---|---|
| `mcogs_equipment` | id, name, type ∈ {fridge, freezer, hot_hold, display, other}, location_id, location_desc, target_min_temp, target_max_temp, is_active |
| `mcogs_equipment_temp_logs` | id, equipment_id, logged_at, temp_c, in_range, corrective_action, logged_by, notes |
| `mcogs_ccp_logs` | id, log_type ∈ {cooking, cooling, delivery}, recipe_id, item_name, target_min_temp, target_max_temp, actual_temp, passed, corrective_action, logged_by, location_id |

**API (`api/src/routes/haccp.js`):**
- `GET/POST/PUT/DELETE /haccp/equipment` (location-scoped)
- `GET/POST /haccp/equipment/:id/logs` (out-of-range requires `corrective_action` — 422)
- `DELETE /haccp/equipment-logs/:id`
- `GET/POST/DELETE /haccp/ccp-logs`
- `GET /haccp/report?date_from=&date_to=&location_id=` — equipment & CCP summaries + 20 most recent incidents

**UI (`app/src/pages/HACCPPage.tsx`):**
- Four tabs: Equipment / Temp Logs / CCP Logs / Report
- Location selector at the top (`/locations?active=true`)
- Pepper AI tutorial hooks per tab (already wired)
- Standard ConfirmDialog / Toast / Modal / EmptyState patterns

### 2.2 QSC audit module (in place)

`mcogs_qsc_questions` (150 scored items + 10 information-only seeded from the Wingstop spec), `mcogs_qsc_templates` (7 system templates), `mcogs_qsc_audits` (sequence-numbered), `mcogs_qsc_responses`, `mcogs_qsc_response_photos`. Fully separate from HACCP — covers the periodic *inspection* side, not the daily *log* side.

### 2.3 What is **not** in place

- Daily / shift checklists of any kind (Opening / Midday / Closing)
- Recurring scheduled checks (figure-8 30-min, 2-h sanitiser)
- Thermometer probe register & calibration log
- Goods-in / delivery temperature capture tied to a PO/GRN
- Per-product hot-hold or per-product override on shared equipment
- Recipe-level cooked-to-order temperature presets enforced at log time
- Protein-size QA spot-check
- Position-chart / role-deployment log
- Communication-board / shift-huddle KPI capture
- Any SOP authoring, reading, or training-progress module

---

## 3. Workstream A — Adapt HACCP to the Wingstop logbook

Goal: a manager opens the app at the start of a shift and sees a single screen that mirrors the paper book, with red cells for anything missed.

### 3.1 Schema deltas (additive, low-risk)

All new tables use the `mcogs_` prefix and are appended to `migrate.js` after the existing HACCP block (~line 366). All existing rows are untouched.

```sql
-- Per-product overrides on shared equipment (cheese sauce vs wings in same hot hold;
-- milkshake mix at 2-5 C in a 1-4 C chiller)
CREATE TABLE mcogs_equipment_products (
  id              SERIAL PRIMARY KEY,
  equipment_id    INTEGER NOT NULL REFERENCES mcogs_equipment(id) ON DELETE CASCADE,
  product_label   VARCHAR(200) NOT NULL,         -- "Wings", "Cheese sauce", "Milkshake mix"
  recipe_id       INTEGER REFERENCES mcogs_recipes(id) ON DELETE SET NULL,
  target_min_temp NUMERIC(5,1),
  target_max_temp NUMERIC(5,1),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Allow temp logs to attach to a product (nullable — preserves equipment-only logs)
ALTER TABLE mcogs_equipment_temp_logs
  ADD COLUMN equipment_product_id INTEGER
    REFERENCES mcogs_equipment_products(id) ON DELETE SET NULL;

-- Recipe-level cooked-to-order presets (drives CCP cooking log targets)
ALTER TABLE mcogs_recipes ADD COLUMN cook_min_temp_c NUMERIC(5,1);
ALTER TABLE mcogs_recipes ADD COLUMN cook_max_temp_c NUMERIC(5,1);
ALTER TABLE mcogs_recipes ADD COLUMN hot_hold_min_temp_c NUMERIC(5,1);

-- Scheduled checks (the engine behind the Daily Sheet and missed-slot detection)
CREATE TABLE mcogs_haccp_check_schedules (
  id                SERIAL PRIMARY KEY,
  location_id       INTEGER REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  equipment_id      INTEGER REFERENCES mcogs_equipment(id) ON DELETE CASCADE,
  equipment_product_id INTEGER REFERENCES mcogs_equipment_products(id) ON DELETE CASCADE,
  slot              VARCHAR(20) NOT NULL CHECK (slot IN ('AM','MIDDAY','PM','HOURLY','30MIN','2HOUR')),
  due_local_time    TIME,                        -- e.g. 09:00, 13:00, 17:00 for AM/Midday/PM
  recurrence_cron   VARCHAR(50),                 -- for HOURLY/30MIN/2HOUR slots
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Thermometer probes
CREATE TABLE mcogs_thermometers (
  id           SERIAL PRIMARY KEY,
  location_id  INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  color_tag    VARCHAR(20),                      -- 'red'|'yellow'|'white' or freeform
  serial       VARCHAR(100),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcogs_thermometer_calibration_logs (
  id              SERIAL PRIMARY KEY,
  thermometer_id  INTEGER NOT NULL REFERENCES mcogs_thermometers(id) ON DELETE CASCADE,
  method          VARCHAR(30) NOT NULL CHECK (method IN ('ice_point','boiling_point','reference_probe')),
  expected_c      NUMERIC(5,1) NOT NULL,
  measured_c      NUMERIC(5,1) NOT NULL,
  passed          BOOLEAN NOT NULL,
  corrective_action TEXT,
  logged_by       VARCHAR(200),
  logged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Goods-inwards temperature (separate from CCP "delivery" log; tied to GRN line)
ALTER TABLE mcogs_goods_received_items
  ADD COLUMN received_temp_c NUMERIC(5,1),
  ADD COLUMN received_temp_passed BOOLEAN,
  ADD COLUMN received_temp_corrective_action TEXT;

-- Indexes
CREATE INDEX idx_eq_products_equipment ON mcogs_equipment_products(equipment_id);
CREATE INDEX idx_temp_logs_eq_product  ON mcogs_equipment_temp_logs(equipment_product_id)
  WHERE equipment_product_id IS NOT NULL;
CREATE INDEX idx_check_sched_loc       ON mcogs_haccp_check_schedules(location_id, slot);
CREATE INDEX idx_thermometers_loc      ON mcogs_thermometers(location_id);
CREATE INDEX idx_calib_thermometer     ON mcogs_thermometer_calibration_logs(thermometer_id);
CREATE INDEX idx_calib_logged_at       ON mcogs_thermometer_calibration_logs(logged_at DESC);
```

### 3.2 API additions

| Verb | Path | Purpose |
|---|---|---|
| GET / POST / PUT / DELETE | `/haccp/equipment/:id/products` | Per-product overrides |
| POST | `/haccp/equipment/:id/products/:pid/logs` | Log a product temperature on shared equipment |
| GET / POST / PUT / DELETE | `/haccp/schedules` | CRUD for scheduled checks |
| GET | `/haccp/today?location_id=` | Today's grid (rows = equipment+products, cols = AM/Midday/PM/etc., cells = last log + slot status) |
| GET / POST / PUT / DELETE | `/haccp/thermometers` | Probe register |
| GET / POST | `/haccp/thermometers/:id/calibrations` | Calibration log |
| GET | `/haccp/report` (extended) | Add `coverage_pct` (logs / scheduled), per-slot heatmap |

### 3.3 UI changes to `HACCPPage.tsx`

- New leading tab: **Today** — grid view that mirrors the paper logbook. Rows = equipment + products; columns = AM / Midday / PM (configurable). Cells: green if logged & in range, amber if logged & out-of-range with corrective action, red if missing slot, grey if not scheduled. One tap on a cell opens the log modal pre-filled with the equipment + product target range.
- New tab: **Calibration** — list of probes + last calibration + "Calibrate" CTA.
- Existing **Equipment** / **Temp Logs** / **CCP Logs** / **Report** tabs retained; Equipment gets a "Products" expander row.
- Pepper tutorials extended to cover the new tabs.

### 3.4 Wingstop seed pack

A new fixture `api/scripts/fixtures/wingstop-haccp-seed.json` plus an idempotent seed step keyed to a brand flag. When a location's brand is "Wingstop" and the seed has not been applied, insert:

- 10 fryers, 8 chillers, 8 freezers, 1 walk-in chiller, 1 walk-in freezer, 1 hot holder
- Hot-holder products: Wings (≥ 63 °C), Cheese sauce (≥ 63 °C)
- Chiller products with overrides: Milkshake mix (2–5 °C)
- Recipe presets: Wings (93–99 °C cook), Boneless (79–91 °C), Tenders (79–91 °C)
- Schedules: AM @ 09:00, Midday @ 13:00, PM @ 17:00; Figure-8 every 30 min 10:00–23:00; Sanitiser every 2 hr 09:00–23:00

### 3.5 Effort

| Item | Days |
|---|---|
| Schema migration + tests | 1.5 |
| Per-product overrides API + UI | 2 |
| Cooked-to-order recipe presets + CCP enforcement | 1 |
| Schedule engine + Today grid API | 2 |
| Today tab UI | 2 |
| Thermometer + calibration tab | 1.5 |
| Goods-in temperature on GRN | 2 |
| Wingstop seed pack | 1 |
| Compliance % roll-up + dashboard | 1.5 |
| QA, docs, i18n strings | 2 |
| **Subtotal** | **~16.5 days** |

---

## 4. Workstream B — Checklist engine (Opening / Midday / Closing / Figure-8 / Sanitiser)

The paper book's checklists don't fit HACCP — they're scheduled task lists with sign-offs. Build a **generic** engine once and seed Wingstop templates.

### 4.1 Schema

```sql
CREATE TABLE mcogs_checklist_templates (
  id           SERIAL PRIMARY KEY,
  code         VARCHAR(50) UNIQUE NOT NULL,       -- 'wingstop_opening_boh'
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  shift        VARCHAR(20) CHECK (shift IN ('opening','midday','closing','recurring')),
  role         VARCHAR(50),                       -- 'manager','foh','boh','bombardier', ...
  brand        VARCHAR(50),                       -- 'wingstop' or NULL
  location_id  INTEGER REFERENCES mcogs_locations(id) ON DELETE CASCADE,  -- NULL = all
  is_system    BOOLEAN NOT NULL DEFAULT FALSE,    -- protected from delete
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  version      INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcogs_checklist_items (
  id                  SERIAL PRIMARY KEY,
  template_id         INTEGER NOT NULL REFERENCES mcogs_checklist_templates(id) ON DELETE CASCADE,
  section             VARCHAR(100),                -- 'Manager/Shift Leader','Front of House','Back of House','Bombardier'...
  label               TEXT NOT NULL,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  requires_photo      BOOLEAN NOT NULL DEFAULT FALSE,
  requires_signature  BOOLEAN NOT NULL DEFAULT FALSE,
  requires_temp_link  BOOLEAN NOT NULL DEFAULT FALSE, -- "Verify time and temp logs..." links to HACCP
  sop_step_id         INTEGER,                     -- nullable FK to mcogs_sop_steps (see §5)
  is_active           BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE mcogs_checklist_schedules (
  id              SERIAL PRIMARY KEY,
  template_id     INTEGER NOT NULL REFERENCES mcogs_checklist_templates(id) ON DELETE CASCADE,
  location_id     INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  recurrence      VARCHAR(20) NOT NULL CHECK (recurrence IN ('daily','weekly','30min','hourly','2hour','custom')),
  start_local_time TIME,
  end_local_time   TIME,
  cron_expr       VARCHAR(50),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE mcogs_checklist_runs (
  id            SERIAL PRIMARY KEY,
  template_id   INTEGER NOT NULL REFERENCES mcogs_checklist_templates(id) ON DELETE RESTRICT,
  location_id   INTEGER NOT NULL REFERENCES mcogs_locations(id) ON DELETE CASCADE,
  run_date      DATE NOT NULL,
  slot_label    VARCHAR(50),                       -- 'opening', '10:30', '11:00' ...
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  completed_by_user_sub VARCHAR(200),
  manager_signoff_user_sub VARCHAR(200),
  manager_signoff_at TIMESTAMPTZ,
  status        VARCHAR(20) NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','missed','cancelled'))
);

CREATE TABLE mcogs_checklist_run_items (
  id           SERIAL PRIMARY KEY,
  run_id       INTEGER NOT NULL REFERENCES mcogs_checklist_runs(id) ON DELETE CASCADE,
  item_id      INTEGER NOT NULL REFERENCES mcogs_checklist_items(id) ON DELETE RESTRICT,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','done','skipped','na','failed')),
  value_text   TEXT,
  photo_id     INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  temp_log_id  INTEGER REFERENCES mcogs_equipment_temp_logs(id) ON DELETE SET NULL,
  signed_by    VARCHAR(200),
  signed_at    TIMESTAMPTZ,
  notes        TEXT
);

CREATE INDEX idx_checklist_items_tpl    ON mcogs_checklist_items(template_id, sort_order);
CREATE INDEX idx_checklist_runs_loc_date ON mcogs_checklist_runs(location_id, run_date DESC);
CREATE INDEX idx_checklist_run_items_run ON mcogs_checklist_run_items(run_id);
```

### 4.2 API

| Verb | Path | Purpose |
|---|---|---|
| GET / POST / PUT / DELETE | `/checklists/templates` | Template CRUD (system templates protected) |
| GET / POST / PUT / DELETE | `/checklists/templates/:id/items` | Item CRUD |
| GET / POST / PUT / DELETE | `/checklists/schedules` | Schedule CRUD |
| POST | `/checklists/runs` | Start a run (`template_id`, `location_id`, `slot_label`) |
| GET | `/checklists/runs?location_id=&date_from=&date_to=` | List runs |
| GET | `/checklists/runs/:id` | Run + items detail |
| PATCH | `/checklists/runs/:id/items/:itemId` | Tick / skip / fail / attach photo / link temp log |
| POST | `/checklists/runs/:id/complete` | Final completion + manager sign-off |
| GET | `/checklists/today?location_id=` | All scheduled runs due today + status |
| GET | `/checklists/coverage?date_from=&date_to=&location_id=` | Compliance roll-up |

### 4.3 UI

A new top-level page `app/src/pages/ChecklistsPage.tsx` (sidebar entry under Operations):

- **Today** tab — list of scheduled runs grouped by slot, with progress bars. Tap a run → step-through wizard (one item per screen on mobile, table on desktop). Items requiring a temp link open the HACCP log modal inline.
- **History** tab — runs by date, filterable by template/role, downloadable as CSV/PDF for inspectors.
- **Templates** tab — admin-only authoring (RBAC: `checklists.write`).
- **Coverage** tab — heatmap of completed-vs-scheduled by template × day.

### 4.4 Wingstop checklist seed

Seed templates & items verbatim from the safety book:
- `wingstop_opening_manager`, `wingstop_opening_foh`, `wingstop_opening_boh`
- `wingstop_midday_manager`, `wingstop_midday_foh`, `wingstop_midday_boh`
- `wingstop_closing_manager`, `wingstop_closing_foh`, `wingstop_closing_bombardier`, `wingstop_closing_gunner`, `wingstop_closing_wingman`, `wingstop_closing_paratrooper`
- `wingstop_figure8_30min` (recurrence `30min`, 10:00–23:00, 1 item: "Floor walk — initials")
- `wingstop_sanitiser_2h` (recurrence `2hour`, 09:00–23:00, 1 item: "Sanitiser change at comp sink, bowls, tongs, sanitise stations")

Fixture file: `api/scripts/fixtures/wingstop-checklists-seed.json`.

### 4.5 RBAC

Add three permissions to `mcogs_roles` defaults: `checklists.read`, `checklists.write` (template authoring), `checklists.signoff` (manager sign-off).

### 4.6 Effort

| Item | Days |
|---|---|
| Schema + migration tests | 1 |
| Templates / items API + RBAC | 1.5 |
| Schedules engine (recurrence resolver) | 2 |
| Runs API (start, patch, complete, manager sign-off) | 2 |
| Today / History / Templates / Coverage UI | 4 |
| Step-through wizard (mobile-first) | 2 |
| HACCP cross-link (temp log inline from item) | 1 |
| Wingstop seed pack (12 templates, ~150 items) | 1.5 |
| QA, docs, i18n strings | 2 |
| **Subtotal** | **~17 days** |

---

## 5. Workstream C — Interactive SOP module

Goal: turn the OPS Manual deck into a role-based, stepwise, trackable training & reference module that cross-links into HACCP, the checklist engine, and the QSC audit module.

### 5.1 Schema

```sql
CREATE TABLE mcogs_sop_documents (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50) UNIQUE NOT NULL,        -- 'wingstop_bombardier'
  title       VARCHAR(200) NOT NULL,
  role        VARCHAR(50),                        -- 'bombardier','wingman','gunner','pilot','paratrooper','runner','host','manager'
  brand       VARCHAR(50),
  locale      VARCHAR(10) NOT NULL DEFAULT 'en',
  version     INTEGER NOT NULL DEFAULT 1,
  status      VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  description TEXT,
  cover_media_id INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  est_minutes INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

CREATE TABLE mcogs_sop_sections (
  id          SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES mcogs_sop_documents(id) ON DELETE CASCADE,
  title       VARCHAR(200) NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  est_minutes INTEGER
);

CREATE TABLE mcogs_sop_steps (
  id               SERIAL PRIMARY KEY,
  section_id       INTEGER NOT NULL REFERENCES mcogs_sop_sections(id) ON DELETE CASCADE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  body_md          TEXT NOT NULL,
  media_id         INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  interaction_type VARCHAR(30) NOT NULL DEFAULT 'read'
                   CHECK (interaction_type IN ('read','tap_confirm','photo_evidence','temp_input','quiz')),
  interaction_meta JSONB                            -- e.g. {"target_min":1,"target_max":4,"equipment_id":42}
);

CREATE TABLE mcogs_sop_quizzes (
  id          SERIAL PRIMARY KEY,
  section_id  INTEGER NOT NULL REFERENCES mcogs_sop_sections(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  options     JSONB NOT NULL,                     -- ["A","B","C","D"]
  correct_index INTEGER NOT NULL,
  explanation TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE mcogs_sop_user_progress (
  id           SERIAL PRIMARY KEY,
  user_sub     VARCHAR(200) NOT NULL,
  step_id      INTEGER NOT NULL REFERENCES mcogs_sop_steps(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_id     INTEGER REFERENCES mcogs_media(id) ON DELETE SET NULL,
  value        TEXT,
  UNIQUE (user_sub, step_id)
);

CREATE TABLE mcogs_sop_quiz_attempts (
  id            SERIAL PRIMARY KEY,
  user_sub      VARCHAR(200) NOT NULL,
  quiz_id       INTEGER NOT NULL REFERENCES mcogs_sop_quizzes(id) ON DELETE CASCADE,
  selected_index INTEGER NOT NULL,
  is_correct    BOOLEAN NOT NULL,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mcogs_sop_certifications (
  id            SERIAL PRIMARY KEY,
  user_sub      VARCHAR(200) NOT NULL,
  document_id   INTEGER NOT NULL REFERENCES mcogs_sop_documents(id) ON DELETE CASCADE,
  document_version INTEGER NOT NULL,
  certified_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  manager_signoff_user_sub VARCHAR(200),
  manager_signoff_at TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,                      -- optional re-cert window
  UNIQUE (user_sub, document_id, document_version)
);

-- Cross-links: a step can be the canonical "how" for a checklist item, a HACCP CCP, a recipe step, or a QSC question
CREATE TABLE mcogs_sop_links (
  id            SERIAL PRIMARY KEY,
  step_id       INTEGER NOT NULL REFERENCES mcogs_sop_steps(id) ON DELETE CASCADE,
  target_type   VARCHAR(50) NOT NULL CHECK (target_type IN ('checklist_item','equipment','recipe','qsc_question','ccp_log_type')),
  target_id     VARCHAR(50) NOT NULL,             -- string to accommodate qsc question codes ('A101')
  UNIQUE (step_id, target_type, target_id)
);

CREATE INDEX idx_sop_sections_doc      ON mcogs_sop_sections(document_id, sort_order);
CREATE INDEX idx_sop_steps_section     ON mcogs_sop_steps(section_id, sort_order);
CREATE INDEX idx_sop_progress_user     ON mcogs_sop_user_progress(user_sub);
CREATE INDEX idx_sop_certs_user        ON mcogs_sop_certifications(user_sub);
CREATE INDEX idx_sop_links_target      ON mcogs_sop_links(target_type, target_id);
```

### 5.2 API

| Verb | Path | Purpose |
|---|---|---|
| GET | `/sops?role=&brand=&status=published` | Library |
| GET | `/sops/:id` | Document + sections + steps + quizzes |
| POST / PUT / DELETE | `/sops` and `/sops/:id` | Authoring (RBAC) |
| POST | `/sops/:id/publish` | Status → published, sets `published_at` |
| POST | `/sops/:id/sections`, `/sops/sections/:id/steps`, `/sops/sections/:id/quizzes` | Authoring |
| POST | `/sops/steps/:id/complete` | Mark step done (+ photo / value) |
| POST | `/sops/quizzes/:id/attempts` | Submit quiz answer |
| POST | `/sops/:id/certify` | User self-certification (after all steps + quizzes pass threshold) |
| POST | `/sops/certifications/:id/signoff` | Manager sign-off |
| GET | `/sops/me/progress` | Current user's progress across all docs |
| GET | `/sops/users/:sub/progress` | Manager view |
| GET | `/sops/links?target_type=&target_id=` | "Show me how" lookup from a checklist item / HACCP row / QSC question |

### 5.3 UI

New top-level page `app/src/pages/SOPsPage.tsx` plus a reader page `app/src/pages/sops/SopReaderPage.tsx`:

- **Library** — filter by role / brand / status. Cards show progress badge + est. minutes.
- **Reader** — step-by-step wizard. Each step renders body markdown + media. Interaction types:
  - `read` — Next button only
  - `tap_confirm` — single tap to confirm action ("I have turned on the fryers")
  - `photo_evidence` — upload via existing `/upload` route, stored in `mcogs_media`
  - `temp_input` — numeric input that POSTs to `/haccp/equipment/:id/logs` using `interaction_meta`
  - `quiz` — multiple choice; correct answer required to advance, explanation shown after first wrong
- **Section quizzes** at section end; pass threshold configurable per doc.
- **Certification view** — shows pending steps & quiz score; once 100 % steps + ≥ 80 % quiz → "Request manager sign-off".
- **Manager view** — per-user / per-station certification matrix → drives "who can be deployed to Bombardier today".
- **Cross-link buttons** — every checklist item, HACCP equipment row, and QSC question gets a "?" / "Show me how" icon that resolves via `/sops/links?target_type=...&target_id=...` and opens the matching step in a side-drawer.
- **Pepper integration** — the SOP corpus is added to the AI tutorial retrieval index; "How do I filter the fryers?" returns the matching SOP step.

### 5.4 Authoring tooling

- Markdown editor with image / short-clip upload (≤ 30 s) reusing the existing media library.
- Versioning: publishing v2 archives v1 (existing progress preserved on v1 unless manager toggles "require re-cert on v2").
- i18n: every text field translated via the existing `mcogs_translations` infra (already wired for ingredient/recipe names).
- **OPS-Manual import**: a one-shot script `api/scripts/import-ops-manual.js` that:
  1. Runs `pdftoppm` to slice `OPS Manual (1).pdf` into 63 PNGs at 200 DPI.
  2. Uploads each PNG into `mcogs_media`.
  3. Seeds a draft document `wingstop_ops_manual_full` with one section per role grouping and one `read` step per slide carrying the image as `media_id`.
  4. Ops team rewrites the body text and re-groups into role-specific docs.

### 5.5 Phased delivery

| Phase | Scope | Days |
|---|---|---|
| **1. Read-only library** | Schema, CRUD API, library + reader UI, OPS-Manual import script. Useable as a reference. | 6 |
| **2. Interactive steps** | tap_confirm, photo_evidence, temp_input bound to HACCP, progress tracking, "Show me how" cross-links | 5 |
| **3. Quizzes & certification** | Quiz authoring, scoring, certification flow, manager sign-off, deployment-readiness matrix | 4 |
| **4. Pepper integration** | Add SOP corpus to AI retrieval, deep-link from chat answers to SOP steps | 2 |
| **Subtotal** | | **~17 days** |

Content authoring (rewriting the imported deck into structured SOPs) is owned by the ops team and runs in parallel — estimate 2–3 days per role × 8 roles ≈ 20 days of ops-team time.

---

## 6. Cross-cutting concerns

### 6.1 Permissions
Add to default role matrix:
- `haccp.read`, `haccp.write` (existing)
- `checklists.read`, `checklists.write`, `checklists.signoff` (new)
- `sops.read`, `sops.write`, `sops.signoff` (new)
- `thermometers.read`, `thermometers.write` (new)

Default mapping: Crew = read-only on SOPs + checklists, write own checklist runs; Shift Leader = signoff on checklists; GM = signoff on certifications; HQ Admin = full template authoring.

### 6.2 i18n
All new user-facing strings go through the existing locale files in `app/src/i18n/locales/` (en, fr, es, pt, it, nl, hi, de, pl). Estimated ~120 new keys across the three workstreams.

### 6.3 Audit logging
Every write to checklist runs, SOP certifications, and HACCP schedule changes goes through the existing `logAudit(pool, req, ...)` helper used in `haccp.js` and `qsc.js`. No new audit infrastructure needed.

### 6.4 Mobile
Checklist runner and SOP reader are the two flows expected to be used on a tablet/phone behind the line. Both are built mobile-first with Tailwind breakpoints already in use across the app.

### 6.5 Offline
Out of scope for v1. If the kitchen tablet drops Wi-Fi mid-shift, partially completed runs are kept in component state; an explicit "Save" button posts to the API. A proper service-worker / IndexedDB queue is a separate ticket.

### 6.6 Tests
- API: extend `api/test/` with route-level tests per new endpoint (the repo uses vitest).
- UI: Playwright flows in `app/test/` for: open shift → complete opening checklist → log AM temps → start an SOP → quiz → cert request.

### 6.7 Reporting & export
- Daily PDF export of the safety book equivalent (HACCP grid + checklist runs + sanitiser + figure-8 + delivery + calibration) — print-ready for Environmental Health visits. ~2 days, deferred to phase 5.

---

## 7. Sequencing & total effort

| Week | Workstream |
|---|---|
| 1–2 | Checklist engine: schema, API, runner UI, Wingstop seed |
| 2–3 | HACCP adapt: products, schedules, Today grid, calibration, GRN temp |
| 4 | SOP Phase 1: read-only library + OPS-Manual import script |
| 5 | HACCP Wingstop seed + compliance roll-up + Pepper tutorials |
| 6–7 | SOP Phase 2: interactive steps + cross-links into HACCP/checklists/QSC |
| 8 | SOP Phase 3: quizzes + certification + deployment matrix; SOP Phase 4: Pepper retrieval |
| 9 | QA, e2e tests, i18n round-trip, EH-PDF export, hardening |

**Engineering total: ~50.5 days ≈ 9 weeks of one full-stack engineer**, on the assumption that:
- The ops team supplies exact preset values, equipment lists per location, and rewritten SOP step text in parallel.
- No offline mode required in v1.
- Existing media library, translation infra, audit log, and RBAC are reused as-is.

---

## 8. Open questions for the ops team

1. **Hot-hold target** — the safety book lists 63 °C; the QSC standard A103 lists 60 °C / 140 °F as the legal floor with Wingstop policy "must be 140 °F" specifically for cheese. Should the in-app preset be 60 °C (legal) or 63 °C (safety-book buffer)? Recommend 63 °C with a 60 °C "warning, not fail" band.
2. **Which markets does this serve?** The OPS Manual is in English with imperial+metric. Confirm the locales required at launch (UK & EU = metric; US = imperial; both supported by HACCP schema today).
3. **Closing-manager sign-off** — is sign-off required *per checklist* or *per shift* (single signature covering all closing checklists)? Recommend per shift to reduce friction.
4. **Re-certification window** — should SOP certs auto-expire (e.g. annually) and force re-completion? Default proposal: 12 months for food-safety SOPs, no expiry for FOH service SOPs.
5. **Deployment gating** — should the position chart in the comms-board area refuse to assign uncertified staff to a station, or just warn? Recommend warn-only at v1 to avoid blocking rosters during rollout.
6. **OPS Manual licensing** — confirm we have rights to import the Wingstop OPS deck images into our media library and re-render them inside the SOP reader. If not, content team rebuilds illustrations.

---

## 9. Deliverables produced alongside this scope doc

- `docs/WINGSTOP_HACCP_SOP_SCOPE.md` — this file
- `api/scripts/migrate-wingstop-haccp-sop.sql.md` — annotated migration stub for review (not yet wired into `migrate.js`; merge after sign-off on §3.1, §4.1, §5.1)

Both are committed on branch `claude/wingstop-haccp-analysis-Z0Kf7`.
