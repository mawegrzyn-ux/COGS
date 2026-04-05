# Language Support — Scope & Implementation Plan

> **Status: Roadmap** — Not yet implemented. This document captures the full specification agreed during the April 2026 planning session. Implementation will be triggered by a separate work order.

---

## Overview

Language support covers two independent but complementary layers:

| Layer | What it does | Effort |
|---|---|---|
| **Content translation** | Stores translated names/descriptions for ingredients, recipes, sales items, categories, and other user-managed entities | ~12–15 days |
| **UI localisation** | Translates static labels, buttons, tooltips, and navigation throughout the React app | ~4–5 days |

Total estimated effort: **~16–19 working days** for a single developer. The two layers can be shipped independently — content translation first, then UI localisation.

---

## Layer 1 — Content Translation

### Entities to Translate

| Entity | Fields | Table |
|---|---|---|
| Ingredients | `name`, `notes` | `mcogs_ingredients` |
| Recipes | `name` | `mcogs_recipes` |
| Sales Items | `name`, `display_name` | `mcogs_sales_items` |
| Modifier Groups | `name`, `display_name` | `mcogs_modifier_groups` |
| Modifier Options | `name`, `display_name` | `mcogs_modifier_options` |
| Combo Steps | `name`, `display_name` | `mcogs_combo_steps` |
| Combo Step Options | `name`, `display_name` | `mcogs_combo_step_options` |
| Categories | `name` | `mcogs_categories` |
| Vendors | `name` | `mcogs_vendors` |
| Price Levels | `name` | `mcogs_price_levels` |
| Menus | `name`, `description` | `mcogs_menus` |

### New Table: `mcogs_languages`

```sql
CREATE TABLE IF NOT EXISTS mcogs_languages (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(10)  NOT NULL UNIQUE,   -- BCP-47: 'en', 'fr', 'es', 'de', 'zh-CN'
  name        VARCHAR(100) NOT NULL,           -- 'English', 'French'
  native_name VARCHAR(100) NOT NULL,           -- 'English', 'Français'
  is_default  BOOLEAN      NOT NULL DEFAULT FALSE,
  is_rtl      BOOLEAN      NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
-- Only one default language allowed (enforce via partial unique index or trigger)
CREATE UNIQUE INDEX IF NOT EXISTS uq_languages_default ON mcogs_languages (is_default) WHERE is_default = TRUE;
```

### Per-Entity Translation Tables (Pattern)

Each translatable entity gets one translation table following this pattern:

```sql
-- Example: ingredient translations
CREATE TABLE IF NOT EXISTS mcogs_ingredient_translations (
  ingredient_id INTEGER      NOT NULL REFERENCES mcogs_ingredients(id) ON DELETE CASCADE,
  language_code VARCHAR(10)  NOT NULL REFERENCES mcogs_languages(code)  ON DELETE CASCADE,
  name          VARCHAR(255),
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (ingredient_id, language_code)
);
```

Full list of translation tables:

```
mcogs_ingredient_translations       (ingredient_id, language_code, name, notes)
mcogs_recipe_translations           (recipe_id, language_code, name)
mcogs_sales_item_translations       (sales_item_id, language_code, name, display_name)
mcogs_modifier_group_translations   (modifier_group_id, language_code, name, display_name)
mcogs_modifier_option_translations  (modifier_option_id, language_code, name, display_name)
mcogs_combo_step_translations       (combo_step_id, language_code, name, display_name)
mcogs_combo_step_option_translations (combo_step_option_id, language_code, name, display_name)
mcogs_category_translations         (category_id, language_code, name)
mcogs_vendor_translations           (vendor_id, language_code, name)
mcogs_price_level_translations      (price_level_id, language_code, name)
mcogs_menu_translations             (menu_id, language_code, name, description)
```

### Language Resolution Chain

```
Requested language
  → found in translation table?        → use translation
  → country's default language?        → use country-default translation
  → system default language?           → use system-default translation
  → base column (always in English)    → use base value
```

SQL pattern using `COALESCE`:

```sql
SELECT
  i.id,
  COALESCE(it_req.name, it_def.name, i.name)  AS name,
  COALESCE(it_req.notes, it_def.notes, i.notes) AS notes
FROM mcogs_ingredients i
LEFT JOIN mcogs_ingredient_translations it_req
  ON it_req.ingredient_id = i.id AND it_req.language_code = $lang_requested
LEFT JOIN mcogs_ingredient_translations it_def
  ON it_def.ingredient_id = i.id AND it_def.language_code = $lang_default
```

### Express Middleware: `resolveLanguage`

```js
// api/src/middleware/language.js
async function resolveLanguage(req, res, next) {
  const requested = req.headers['x-language'] || req.query.lang
  const countryId  = req.query.country_id

  // 1. Explicit request header / query param
  if (requested) { req.language = requested; return next() }

  // 2. Country default (if country_id passed)
  if (countryId) {
    const { rows } = await pool.query(
      'SELECT default_language_code FROM mcogs_countries WHERE id=$1', [countryId]
    )
    if (rows[0]?.default_language_code) {
      req.language = rows[0].default_language_code; return next()
    }
  }

  // 3. System default
  const { rows } = await pool.query(
    'SELECT code FROM mcogs_languages WHERE is_default=true LIMIT 1'
  )
  req.language = rows[0]?.code || 'en'
  next()
}
```

All GET routes that return translatable entities would use this middleware and inject `req.language` into the COALESCE query.

### API Changes

#### New route: `GET/POST/PUT/DELETE /api/languages`

Full CRUD for `mcogs_languages`. Registered in `routes/index.js`.

```
GET  /languages              — list all active languages
POST /languages              — create language { code, name, native_name, is_default, is_rtl, sort_order }
PUT  /languages/:code        — update language
DELETE /languages/:code      — soft-delete (set is_active=false) or hard-delete if no translations
```

#### Translation sub-routes (per entity)

```
GET  /ingredients/:id/translations          — all translations for one ingredient
PUT  /ingredients/:id/translations/:lang    — upsert a translation { name, notes }
DELETE /ingredients/:id/translations/:lang  — remove a specific translation
```

Same pattern for recipes, sales items, modifier groups, modifier options, combo steps, combo step options, categories, vendors, price levels, menus.

#### Modified GET list/detail endpoints

All existing `GET /ingredients`, `GET /recipes`, `GET /sales-items`, etc. endpoints gain:
- `?lang=fr` query parameter (or `X-Language: fr` request header)
- `COALESCE` name resolution in all SELECT queries
- Return `translation_coverage: { [lang_code]: boolean }` on individual detail responses

#### New column on `mcogs_countries`

```sql
ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS default_language_code VARCHAR(10) REFERENCES mcogs_languages(code) ON DELETE SET NULL;
```

---

## Layer 2 — UI Localisation

### Library

**`react-i18next`** — the standard i18n library for React. Works with `i18next` backend for lazy-loading translation files.

```bash
npm install i18next react-i18next i18next-http-backend i18next-browser-languagedetector
```

### File Structure

```
app/src/
└── i18n/
    ├── index.ts               — i18next initialisation
    └── locales/
        ├── en/
        │   ├── common.json    — shared: buttons, labels, errors
        │   ├── inventory.json
        │   ├── recipes.json
        │   ├── menus.json
        │   └── settings.json
        ├── fr/
        │   └── ... (same structure)
        ├── es/
        └── de/
```

### i18n Configuration

```ts
// app/src/i18n/index.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import HttpBackend from 'i18next-http-backend'
import LanguageDetector from 'i18next-browser-languagedetector'

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    ns: ['common', 'inventory', 'recipes', 'menus', 'settings'],
    defaultNS: 'common',
    backend: { loadPath: '/locales/{{lng}}/{{ns}}.json' },
    interpolation: { escapeValue: false },
  })

export default i18n
```

### Component Usage

```tsx
import { useTranslation } from 'react-i18next'

function InventoryPage() {
  const { t } = useTranslation('inventory')
  return (
    <button className="btn-primary">{t('add_ingredient')}</button>
  )
}
```

### Language Selector UI

A `<LanguageSwitcher>` dropdown component added to:
- The app header (top-right corner)
- Settings → Localisation tab (new tab)

The selected language code is stored in `localStorage('app-language')` and injected into all API requests as `X-Language: <code>`.

### RTL Support

When `is_rtl=true` for the active language, the `<html>` element gains `dir="rtl"`. Tailwind CSS has built-in RTL variant support (`rtl:mr-0 rtl:ml-2`). The major layout components (Sidebar, AppLayout, modals) would need RTL variant classes added.

---

## Translation Editor Component

A shared `<TranslationEditor entityType="ingredient" entityId={id} />` component provides an inline translation management UI:

```
┌─ Translations ──────────────────────────────────┐
│  🇬🇧 English (base)     Chicken Breast  [locked] │
│  🇫🇷 French             Blanc de poulet  [edit]  │
│  🇩🇪 German             [empty]          [add]   │
│  🇪🇸 Spanish            [empty]          [add]   │
└─────────────────────────────────────────────────┘
```

- Base language row is read-only (always edit via the main form)
- Other rows show existing translations with inline edit
- Empty rows show "Add translation" link
- `PUT /[entity]/:id/translations/:lang` called on blur/save
- Shown in: Ingredient detail, Recipe detail, Sales Item right panel, Category editor, etc.

---

## Pages Affected

| Page | Changes required |
|---|---|
| **InventoryPage** | Ingredient name/notes display via `?lang=`, `<TranslationEditor>` in detail panel |
| **RecipesPage** | Recipe name display + translation editor in recipe form |
| **SalesItemsPage** | Sales item / combo step / modifier group names + translation editors in right panel |
| **CategoriesPage** | Category name translation editor |
| **MenusPage** | Menu name, display names in expand rows resolved by lang; `?lang=` on COGS queries |
| **AllergenMatrixPage** | Ingredient names resolved by lang |
| **SharedPage** (`/share/:slug`) | Menu builder expand rows and item names resolved by the shared link's target country language |
| **SettingsPage** | New **Localisation** tab: manage languages (CRUD for `mcogs_languages`), set default, RTL flag |

---

## Build Sequence

### Phase 1 — Foundation (Days 1–3)
1. `migrate.js` — `mcogs_languages` table + `default_language_code` on `mcogs_countries`
2. `routes/languages.js` — CRUD for languages
3. `routes/index.js` — register `/languages`
4. Settings → Localisation tab — language management UI

### Phase 2 — Translation Tables (Days 4–7)
5. `migrate.js` — all 11 translation tables (ADD IF NOT EXISTS)
6. Translation sub-routes on each entity router
7. `TranslationEditor` React component (shared)

### Phase 3 — Backend Resolution (Days 8–11)
8. `middleware/language.js` — `resolveLanguage`
9. Update all entity GET queries with `COALESCE` resolution
10. `mcogs_countries` gains `default_language_code`

### Phase 4 — Frontend Content Resolution (Days 12–15)
11. `useApi.ts` — inject `X-Language` header from localStorage
12. All list/detail pages consume resolved names (no code change needed if API returns translated name in `name` field)
13. `TranslationEditor` wired into Ingredient, Recipe, Sales Item, Category detail views

### Phase 5 — UI Localisation (Days 16–19)
14. Install `react-i18next`, create `i18n/index.ts`
15. Extract all static UI strings into `en/` locale files
16. `LanguageSwitcher` component in header
17. Translate `fr` locale as pilot (subset first)
18. RTL layout variants (if Arabic/Hebrew/Farsi required)

---

## Design Decisions to Confirm

Before implementation begins, the following questions should be resolved:

| # | Question | Options |
|---|---|---|
| 1 | **Default language** | English only, or multi-language from day 1? |
| 2 | **Who translates?** | Manual (admin enters), AI-assisted (Claude translates on save), or external CMS sync? |
| 3 | **Country ↔ language mapping** | Should each country have a `default_language_code`? Or do users pick language per-session? |
| 4 | **Shared Link language** | Auto-resolve to recipient's country language, or use a separate `?lang=` param on the share URL? |
| 5 | **RTL day-1 requirement** | Arabic/Hebrew support needed from launch, or deferred to Phase 5+? |
| 6 | **UI localisation scope** | Full app (all 12 pages), or priority pages only (Menus, Sales Items, Inventory)? |

---

## Effort Estimate

| Phase | Tasks | Days |
|---|---|---|
| Foundation (languages table + routes + settings UI) | 4 | 3 |
| Translation tables (11 tables + sub-routes) | ~22 | 4 |
| Backend resolution middleware + COALESCE queries | ~11 files | 4 |
| Frontend content wiring + TranslationEditor | ~8 pages | 4 |
| UI localisation (react-i18next + locale files) | ~12 pages × 2 locales | 4–5 |
| **Total** | | **~16–19 days** |

---

## Not In Scope

The following are explicitly excluded from this plan:

- Machine translation pipeline (auto-translating via Google Translate / DeepL API) — can be added as a Phase 6 extension
- Translating price quotes, vendor codes, or numeric data — these are language-neutral
- Translating HACCP logs — regulatory records should remain in the original language of entry
- Translating historical import job data — translations are forward-only
- Translating system roles and permission names — these are internal identifiers

---

*Document created: April 2026. Author: Planning session with Pepper AI.*
