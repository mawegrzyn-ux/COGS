# Multi-Language Support — Implementation Plan

> **Status:** Approved design. Not yet implemented.
> **Date:** April 2026
> **Source:** 6-agent architecture review (DB Architect, Backend Engineer, Frontend Engineer, AI Strategist, Devil's Advocate, Synthesis Architect)
> **Replaces:** Original BACK-1350 through BACK-1355 backlog spec (16-19 days, 11 per-entity tables)

---

## Executive Summary

AI-powered translation using the existing Claude Haiku infrastructure, stored in JSONB columns on each translatable entity. Single `mcogs_languages` reference table. Nightly cron job pre-warms translations. Operators can correct AI translations via a TranslationEditor component. Total MVP: **12-14 days** across 4 independent phases.

**Cost:** Under $0.10/month for 1,000 entities x 10 languages via Haiku.

---

## Table of Contents

1. [Storage Decision](#1-storage-decision)
2. [Schema Design](#2-schema-design)
3. [Language Resolution Chain](#3-language-resolution-chain)
4. [AI Translation Engine](#4-ai-translation-engine)
5. [Backend Integration](#5-backend-integration)
6. [Pepper AI Language Support](#6-pepper-ai-language-support)
7. [Frontend Integration](#7-frontend-integration)
8. [UI Localisation](#8-ui-localisation)
9. [Import Wizard](#9-import-wizard)
10. [Shared Pages](#10-shared-pages)
11. [RTL Support](#11-rtl-support)
12. [Phased Implementation](#12-phased-implementation)
13. [Risk Register](#13-risk-register)

---

## 1. Storage Decision

**JSONB column on each entity** (not EAV table, not per-entity tables).

### Why JSONB wins

| Factor | JSONB column | EAV table | Per-entity tables (original) |
|---|---|---|---|
| New tables | 1 (`mcogs_languages`) | 2 | 12 |
| JOINs for translation | None | Post-query lookup | LEFT JOIN per query |
| Nested objects (sales items -> modifiers -> options) | Handled inline | Requires multiple `applyTranslations()` calls per nesting level | Multiple JOINs |
| FK cascade on delete | Automatic (column on row) | No FK (polymorphic entity_id) — orphans accumulate | FK per table |
| Cache invalidation | Co-located on row | Explicit DELETE + re-translate | Explicit DELETE + re-translate |
| Fits existing patterns | Yes (25+ JSONB columns already in schema) | No (new query pattern) | No (11 new JOINs) |
| SQL changes per route | Add COALESCE to SELECT | Add 2-3 lines after query (but breaks on nested objects) | Add LEFT JOIN to every query |
| Migration complexity | 11 ALTER TABLE statements | 1 CREATE TABLE | 11 CREATE TABLE + FKs |

### What the Devil's Advocate found

The Backend Engineer's `applyTranslations()` post-query helper claim of "2-3 lines per route" is false for:
- `sales-items.js` `fetchFull()` — returns nested objects (markets, prices, modifier_groups with options) — 3 levels deep
- `cogs.js` — joins ingredients + recipes + menus + categories + sales items in one computation pipeline
- `combos.js` — combo -> steps -> options -> modifier_groups, each with translatable names

JSONB avoids this by putting translations on the row — `COALESCE(i.translations->$lang->>'name', i.name)` works at any nesting level in any JOIN.

---

## 2. Schema Design

### `mcogs_languages` reference table (new)

```sql
CREATE TABLE IF NOT EXISTS mcogs_languages (
  code        VARCHAR(10) PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  native_name VARCHAR(100),
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  is_rtl      BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed English as default
INSERT INTO mcogs_languages (code, name, native_name, is_default)
VALUES ('en', 'English', 'English', TRUE)
ON CONFLICT (code) DO NOTHING;
```

### `translations` JSONB column (added to 11 entities)

```sql
ALTER TABLE mcogs_ingredients      ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_recipes          ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_sales_items      ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_modifier_groups  ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_modifier_options ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_combo_steps      ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_combo_step_options ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_categories       ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_vendors          ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_price_levels     ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
ALTER TABLE mcogs_menus            ADD COLUMN IF NOT EXISTS translations JSONB NOT NULL DEFAULT '{}';
```

### JSONB structure per row

```json
{
  "fr": {
    "name": "Poulet",
    "description": "Poulet fermier entier",
    "_meta": { "source": "ai", "hash": "a1b2c3...", "reviewed": false }
  },
  "de": {
    "name": "Huhn",
    "_meta": { "source": "human", "reviewed": true, "reviewed_by": "operator@example.com" }
  }
}
```

- Only translated fields appear (missing = fall back to English base column)
- `_meta.source`: `"ai"` or `"human"` — human translations are never overwritten by AI
- `_meta.hash`: SHA-256 of the English source text at time of translation — used for stale detection
- `_meta.reviewed`: whether an operator has confirmed the AI translation

### `default_language_code` on countries

```sql
ALTER TABLE mcogs_countries ADD COLUMN IF NOT EXISTS default_language_code VARCHAR(10)
  REFERENCES mcogs_languages(code) ON DELETE SET NULL;
```

---

## 3. Language Resolution Chain

**Priority (most specific wins):**

```
X-Language header > user profile preferred_language > country default_language_code > system default > 'en'
```

### Middleware: `resolveLanguage`

Extends `requireAuth` in `api/src/middleware/auth.js`. After user is loaded, resolve language and set `req.language`.

```javascript
// At the end of requireAuth, after req.user is set:
req.language = req.headers['x-language']
  || req.user?.profile_json?.preferred_language
  || req.user?.countryDefaultLang  // from allowedCountries[0]
  || 'en';
```

Cache the resolved language in the token cache (already exists in auth.js) to avoid re-querying on every request.

### CORS update

Add `'X-Language'` to `allowedHeaders` in `api/src/index.js`.

---

## 4. AI Translation Engine

### Nightly cron job: `api/src/jobs/translateEntities.js`

Runs after memory consolidation at ~02:15 UTC. Follows the same pattern as `consolidateMemory.js`.

**Flow:**
1. Read `enabled_languages` from `mcogs_languages WHERE is_active = TRUE AND code != 'en'`
2. For each entity type x language:
   a. Query all entities: `SELECT id, name, description, translations FROM mcogs_ingredients`
   b. For each row, check if translation exists and is fresh (`_meta.hash` matches current SHA-256 of English name)
   c. Skip rows where `_meta.source = 'human'` (never overwrite human corrections)
   d. Batch untranslated/stale entities (groups of 50)
   e. Call Claude Haiku with structured prompt
   f. Update each row: `UPDATE mcogs_ingredients SET translations = jsonb_set(...) WHERE id = $1`
3. Log results to `mcogs_settings.data.translation_jobs`

### Haiku prompt template

```
You are translating restaurant menu and ingredient terminology from English to {language}.
Context: These are names and descriptions used in a restaurant franchise COGS management system.

Translate each item. Keep translations concise and appropriate for food service context.
Preserve brand names, measurements, and abbreviations unchanged.
Return ONLY a JSON array: [{"id": 1, "name": "translated name", "description": "translated desc"}, ...]

Items to translate:
{items_json}
```

### "Translate Now" button

When admin adds a new language, trigger synchronous batch translation with progress bar (not wait for nightly cron). Endpoint: `POST /api/translations/warm` with `{ language_code: 'fr' }`.

---

## 5. Backend Integration

### Query modification pattern

Each SELECT that returns translatable fields adds COALESCE resolution:

**Before:**
```sql
SELECT i.name, cat.name AS category_name FROM mcogs_ingredients i
LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
```

**After:**
```sql
SELECT COALESCE(i.translations->$lang->>'name', i.name) AS name,
       COALESCE(cat.translations->$lang->>'name', cat.name) AS category_name
FROM mcogs_ingredients i
LEFT JOIN mcogs_categories cat ON cat.id = i.category_id
```

The `$lang` parameter comes from `req.language`. When `req.language === 'en'`, the query can skip the COALESCE entirely (pass `NULL` for `$lang` and PostgreSQL short-circuits).

### Helper for route handlers

```javascript
// api/src/helpers/translate.js
function tCol(alias, table, field, langParam) {
  return `COALESCE(${table}.translations->$${langParam}->>'${field}', ${table}.${field}) AS ${alias}`
}
```

Usage: `tCol('name', 'i', 'name', langIdx)` generates the COALESCE clause.

### Cache invalidation

When an entity's English `name` or `description` is updated via PUT:
1. Compute new SHA-256 of the English value
2. For each language in `row.translations`, check if `_meta.hash` matches
3. If stale AND `_meta.source === 'ai'`, delete that language entry from the JSONB
4. Human translations are preserved regardless of staleness (operator chose that translation deliberately)

This happens inline in the PUT handler — no separate cleanup job needed.

### Translation CRUD endpoint: `api/src/routes/translations.js`

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /api/translations/:entityType/:entityId` | GET | Get all translations for an entity |
| `PUT /api/translations/:entityType/:entityId/:lang` | PUT | Set/update translation (marks `source: 'human'`, `reviewed: true`) |
| `DELETE /api/translations/:entityType/:entityId/:lang` | DELETE | Remove a specific language translation |
| `POST /api/translations/warm` | POST | Admin: trigger batch AI translation for a language (with progress) |

---

## 6. Pepper AI Language Support

**This is a blocker for non-English deployments.** The Devil's Advocate identified this as the most significant gap.

### Changes needed

1. **System prompt**: Inject `user_language` instruction:
   ```
   The user's preferred language is French (fr). Respond in French.
   When presenting data (ingredient names, recipe names, etc.), use the translated
   names from the translations JSONB column when available.
   ```

2. **Tool executors**: Every tool that returns entity names must respect `req.language`. Since tools execute via `executeTool(name, input, send, userCtx)`, add `userCtx.language` and pass it through. In each tool's SELECT query, add the COALESCE pattern.

3. **Tool results**: Claude sees the tool results and presents them to the user. If tool results contain French names, Claude will naturally use them in its response.

4. **Effort**: ~2 days to update the 15 read tools that return entity names. Write tools don't need translation (they operate on IDs).

---

## 7. Frontend Integration

### Language switcher

Location: sidebar footer (next to user email/logout). Compact dropdown showing current language code with flag/globe icon.

Persistence: `localStorage('mcogs-language')` + save to `user_profiles.profile_json.preferred_language` via API.

### `X-Language` header injection

In `app/src/hooks/useApi.ts`, read language from localStorage and inject on every request:

```typescript
const lang = localStorage.getItem('mcogs-language') || 'en'
headers['X-Language'] = lang
```

### TranslationEditor component

Reusable component for edit forms. Shows language tabs above the name/description fields. Each tab displays the translation for that language, or a dimmed English fallback with "untranslated" badge.

```tsx
<TranslationEditor
  entityType="ingredient"
  entityId={item.id}
  translations={item.translations}
  fields={['name', 'description']}
  onSave={(lang, field, value) => api.put(`/translations/ingredient/${item.id}/${lang}`, { [field]: value })}
/>
```

### Visual indicators

- AI-translated (unreviewed): amber dot next to the name
- Human-reviewed: no indicator (clean)
- Untranslated (fallback to English): dotted underline + tooltip "No {language} translation"

---

## 8. UI Localisation (Static Strings)

Separate from data translation. Uses react-i18next.

### Setup

- Install: `i18next`, `react-i18next`, `i18next-browser-languagedetector`
- 3 namespaces: `common` (buttons, labels), `nav` (sidebar, page titles), `pages` (page-specific)
- AI-generate initial locale JSON files from English source using Claude
- Pilot languages: English + French

### Process

1. Extract ~200 hardcoded strings into `en/common.json`, `en/nav.json`, `en/pages.json`
2. Generate `fr/*.json` via Claude Haiku (one-time, committed to repo)
3. Replace hardcoded strings with `t()` calls progressively (start with Sidebar + ui.tsx)

---

## 9. Import Wizard

### The language identity problem

When a French operator imports "Poulet" as an ingredient name, is that the English base or a French translation?

**Decision:** The `name` column is the "canonical" name in whatever language the operator uses. Translations cover OTHER languages. This is the pragmatic choice that avoids forcing operators to think in English.

### Implementation

- Add a "Source Language" dropdown to the import wizard (defaults to the operator's preferred language)
- If source language is not English, the imported `name` IS the translation for that language, and AI generates the English base name
- If source language is English (or unset), current behaviour is preserved

---

## 10. Shared Pages

Shared pages (`/share/:slug`) are public (no auth). Language resolution:

1. `?lang=xx` URL parameter (allows link sharing in specific language)
2. Browser `Accept-Language` header
3. Country default language (from the menu's country)
4. English fallback

---

## 11. RTL Support

**Deferred.** Estimated 7-10 days (not the originally estimated 3-5). Only needed when Arabic/Hebrew markets are confirmed.

Key challenges: sidebar mirroring, Pepper dock panel positioning, DataGrid sticky columns, resize handles, directional icons, and hundreds of `ml-*`/`mr-*` Tailwind classes needing `ms-*`/`me-*` conversion.

---

## 12. Phased Implementation

| Phase | Delivers | Days | Ships independently? |
|---|---|---|---|
| **1: Foundation** | `mcogs_languages` table, `translations` JSONB columns on 11 entities, `resolveLanguage` middleware, Settings UI for language management, CORS update | 3 | Yes |
| **2: Backend + AI** | AI translation cron job, "Translate Now" button, COALESCE resolution in 10+ entity routes, translation CRUD API, Pepper language support, cache invalidation on entity update | 6-8 | Yes (after Phase 1) |
| **3: Frontend** | Language switcher in sidebar, `X-Language` header in useApi, TranslationEditor component, shared page language support | 3 | Yes (after Phase 2) |
| **4: UI Localisation** | react-i18next setup, AI-generated locale JSONs, progressive `t()` replacement across all pages | 3 | Yes (independent of 2-3) |
| **5: RTL** | Tailwind RTL variants, layout mirroring, icon flipping | 7-10 | Deferred |

**Total MVP (Phases 1-3): 12-14 days**
**Full feature (Phases 1-4): 15-17 days**

---

## 13. Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Haiku returns inconsistent translations for same term | Low | Cache after first translation; `source_hash` detects staleness, not variance |
| 2 | No Anthropic API key configured | Medium | Manual translation still works; AI features gracefully degrade (same pattern as Pepper) |
| 3 | Import wizard stores French name as English base | High | Source language dropdown on import; AI generates English base if needed |
| 4 | Pepper tools return English names to French user | High | Phase 2 includes Pepper language support — tool executors use COALESCE |
| 5 | First French user sees all English before cron runs | Medium | "Translate Now" button on language add; synchronous batch with progress bar |
| 6 | JSONB column adds storage overhead | Low | ~2-3 KB per row at 5 languages — negligible at restaurant scale |
| 7 | SQL COALESCE changes are error-prone across 60+ routes | Medium | Start with 5 highest-traffic routes; use `tCol()` helper for consistency |
| 8 | RTL estimated at 3-5 days but actually 7-10 | Low | Deferred; corrected estimate documented |
| 9 | Human-reviewed translations overwritten by AI | None | Architecture prevents: `_meta.source === 'human'` entries are never touched by cron |

---

*Document generated from 6-agent architecture review. Agents: DB Architect, Backend Engineer, Frontend Engineer, AI Product Strategist, Devil's Advocate, Synthesis Architect.*
