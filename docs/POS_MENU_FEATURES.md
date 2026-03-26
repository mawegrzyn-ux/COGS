# POS Menu Features — Planning & Scope Document

**Version:** 1.0
**Date:** March 2026
**Status:** Planning
**Scope:** Three new menu item types and modifier system for the COGS Manager app

---

## Table of Contents

1. [Overview](#1-overview)
2. [Current State](#2-current-state)
3. [Feature 1 — Manual Menu Items](#3-feature-1--manual-menu-items)
4. [Feature 2 — Combo Menu Items](#4-feature-2--combo-menu-items)
5. [Feature 3 — Modifier Groups](#5-feature-3--modifier-groups)
6. [Database Schema Changes](#6-database-schema-changes)
7. [API Routes](#7-api-routes)
8. [COGS Calculation Logic](#8-cogs-calculation-logic)
9. [PLT / MPT Changes](#9-plt--mpt-changes)
10. [Allergen Matrix Changes](#10-allergen-matrix-changes)
11. [Frontend Changes — MenusPage](#11-frontend-changes--menuspage)
12. [Pepper AI New Tools](#12-pepper-ai-new-tools)
13. [User Stories](#13-user-stories)
14. [Detailed Scenarios](#14-detailed-scenarios)
15. [Implementation Phases](#15-implementation-phases)
16. [Open Questions & Future Scope](#16-open-questions--future-scope)

---

## 1. Overview

This document specifies three new features that extend the COGS Manager's menu item model to support real-world POS (point-of-sale) menu structures used by quick-service restaurant franchises.

| Feature | Summary |
|---|---|
| **Manual Menu Items** | A menu item with no recipe or inventory link — just a display name and a manually entered cost per portion, plus full allergen tagging |
| **Combo Menu Items** | A bundled menu item composed of ordered steps, each with one or more selectable options (recipes, ingredients, or manual items), with optional price add-ons and nested modifier groups |
| **Modifier Groups** | Reusable global groups of options (e.g., flavour choices, sauce choices) that can be assigned to standalone menu items or to individual combo step options |

These three features share common infrastructure: the same option item types (`recipe`, `ingredient`, `manual`), the same allergen tagging approach for manual items, and the same COGS averaging methodology for multi-option choices.

### Key Design Decisions

| Decision | Resolution |
|---|---|
| Modifier group ownership | Standalone — modifier groups are assigned explicitly to menu items or combo step options. NOT inherited from the recipe definition. |
| Optional modifier groups (min=0) | Always include average cost in COGS calculation regardless of whether selection is mandatory |
| Combo step cost | Average cost across all options for multi-option steps; direct cost for single-option (fixed) steps |
| PLT pricing | Two price columns for items with modifier add-ons (Base Price and Price + Modifiers); single column for items with no add-ons |
| Nested combos | Explicitly NOT supported — combo components cannot themselves be of type `combo` |
| Modifier groups scope | Global — not per-menu |

---

## 2. Current State

### Menu Item Model

The `mcogs_menu_items` table currently supports two item types:

```
item_type IN ('recipe', 'ingredient')
```

Every menu item must link to either a recipe (`recipe_id`) or an inventory ingredient (`ingredient_id`). COGS is calculated as:

- `ingredient` type: look up the preferred vendor quote price for the ingredient in the menu's country
- `recipe` type: recursively calculate recipe cost from ingredient items via `calcRecipeCost()`

### Current `mcogs_menu_items` Columns

| Column | Type | Notes |
|---|---|---|
| id | SERIAL | PK |
| menu_id | INTEGER | FK → mcogs_menus |
| item_type | VARCHAR(20) | CHECK IN ('recipe', 'ingredient') |
| recipe_id | INTEGER | FK → mcogs_recipes, nullable |
| ingredient_id | INTEGER | FK → mcogs_ingredients, nullable |
| display_name | VARCHAR(200) | |
| qty | NUMERIC(18,8) | Portion quantity |
| sell_price | NUMERIC(18,4) | Sell price (stored in USD base) |
| tax_rate_id | INTEGER | FK → mcogs_country_tax_rates, nullable |
| allergen_notes | TEXT | Free-text allergen notes |
| sort_order | INTEGER | |

### Gaps Addressed by These Features

1. **No way to represent a cost-only item** (e.g., a packaging charge, a manual drink priced by the operator) — requires `manual` type
2. **No way to represent a bundled meal deal** with choices — requires `combo` type with steps and options
3. **No way to model optional or mandatory choice modifiers** (e.g., flavour selection on wings, sauce selection) that affect both COGS and sell price — requires `modifier_groups`

---

## 3. Feature 1 — Manual Menu Items

### Description

A manual menu item has:
- A display name
- A manually entered cost per portion (in the menu's local currency — no recipe or vendor quote lookup required)
- Full EU/UK FIC allergen tagging using the same 14 allergens tracked for ingredients and recipes
- `item_type = 'manual'`

Manual items are used for items that cannot or should not be linked to the recipe or inventory systems — for example: a packaging charge, a third-party drink not stocked as an ingredient, or a promotional item with a known flat cost.

### Cost Handling

- `manual_cost` is stored in the **menu's local currency** (not USD base)
- No exchange rate conversion is applied during COGS calculation
- When the menu's country changes, the `manual_cost` value does not auto-convert — the operator is responsible for updating it

### Allergen Tagging

Manual items use the same 14 EU/UK FIC regulated allergens defined in `mcogs_allergens`. The allergen selection for a manual menu item is stored as a JSONB array of allergen IDs on `mcogs_menu_items.allergen_ids`. Each allergen ID can carry one of three statuses: `contains`, `may_contain`, or `free_from`.

The allergen tagging UI for manual menu items is a checkbox grid (one row per allergen, radio-style status selection per allergen).

### Relationship to Modifiers

Manual menu items CAN have modifier groups assigned to them (e.g., a flat-rate drink item with a size upgrade modifier). Modifier COGS for manual items follows the same averaging rules as other item types.

---

## 4. Feature 2 — Combo Menu Items

### Description

A combo menu item (`item_type = 'combo'`) bundles multiple components into a single priced unit. The combo is structured as an ordered list of **steps**, and each step contains one or more **options**.

### Step Structure

| Attribute | Description |
|---|---|
| `name` | Display label for the step (e.g., "Choose your wings") |
| `step_order` | Integer sort order |
| `min_select` | Minimum number of options the customer must choose (0 = optional step) |
| `max_select` | Maximum number of options the customer may choose |

A step with `min_select = 0` is an optional step (customer can skip it).

### Option Types

Each option within a step can be one of:

| `item_type` | Description |
|---|---|
| `recipe` | Links to a recipe in `mcogs_recipes` |
| `ingredient` | Links to an ingredient in `mcogs_ingredients` |
| `manual` | A manually costed option with optional allergen tags — no recipe/ingredient link |

Each option also has:
- `display_name` — label shown to the customer
- `price_addon` — additional charge on top of the combo's base price (default £0)
- `is_default` — whether this option is pre-selected
- `sort_order` — display order within the step

### Fixed vs Choice Steps

| Step type | Condition | COGS treatment |
|---|---|---|
| Fixed component | Step has exactly 1 option | Use that option's cost directly |
| Choice step | Step has 2+ options | Use the **average** cost across all options |

### Nested Modifier Groups on Combo Step Options

Each combo step option can have modifier groups assigned to it. For example, the "8pc Bone In" option within a "Choose your wings" step can have a "Bone In Flavours" modifier group attached, adding further choice (and average cost) to that option.

This creates a compound structure: combo step → option → modifier group → option.

**Nested combos are explicitly NOT supported.** An option within a combo step cannot itself be of type `combo`.

### Example Structure

```
Combo: "Wingstop Meal Deal"
│
├── Step 1: "Choose your wings" (min:1, max:1)
│   ├── Option A: 8pc Bone In (recipe)  [price_addon: £0]
│   │   └── Modifier Group: "Bone In Flavours" (min:1, max:1)
│   │       ├── Option: Lemon Pepper (recipe)  [+£0]
│   │       ├── Option: Mango Habanero (recipe)  [+£0]
│   │       ├── Option: Atomic (recipe)  [+£0]
│   │       └── Option: Korean BBQ (recipe)  [+£0]
│   └── Option B: 8pc Boneless (recipe)  [price_addon: £0]
│       └── Modifier Group: "Boneless Flavours" (min:1, max:1)
│
├── Step 2: "Choose your side" (min:1, max:1)
│   ├── Option A: Regular Fries (recipe)  [price_addon: £0]
│   └── Option B: Large Fries (recipe)  [price_addon: £1.00]
│
└── Step 3: "Choose your drink" (min:1, max:1)
    ├── Option A: Regular Drink (manual, cost: £0.80)  [price_addon: £0]
    └── Option B: Large Drink (manual, cost: £1.20)  [price_addon: £0.50]
```

---

## 5. Feature 3 — Modifier Groups

### Description

Modifier groups are **global** (not per-menu) reusable groups of options. They can be assigned to:

1. **Standalone menu items** (`recipe`, `ingredient`, or `manual` type) — via `mcogs_menu_item_modifier_groups`
2. **Combo step options** — via `mcogs_combo_step_option_modifier_groups`

A modifier group represents a customer choice that is offered alongside a menu item. Examples:
- "Bone In Flavours" — required choice (min:1, max:1), no price add-on
- "Dipping Sauce" — optional (min:0, max:1), some options have price add-ons
- "Extra Toppings" — optional multi-select (min:0, max:3)

### Modifier Group Attributes

| Attribute | Description |
|---|---|
| `name` | Display name (e.g., "Bone In Flavours") |
| `description` | Optional longer description |
| `min_select` | Minimum selections required (≥0; 0 = optional) |
| `max_select` | Maximum selections allowed (≥1) |

### Modifier Option Attributes

Each option within a modifier group has:

| Attribute | Description |
|---|---|
| `item_type` | `recipe`, `ingredient`, or `manual` |
| `recipe_id` / `ingredient_id` | Link to existing data (null for manual) |
| `display_name` | Customer-facing label |
| `manual_cost` | Cost for manual-type options (local currency) |
| `allergen_ids` | JSONB array of allergen IDs (for manual-type options) |
| `price_addon` | Additional price on top of the parent item's sell price |
| `is_default` | Whether this option is pre-selected |
| `sort_order` | Display order within the group |

### Many-to-Many Assignment

- A modifier group can be assigned to **many** menu items
- A menu item can have **many** modifier groups
- A combo step option can have **many** modifier groups
- The same modifier group can be used in both standalone item assignments and combo step option assignments simultaneously

### COGS for Modifier Groups

Modifier group COGS is always calculated as an **average** across all options in the group, regardless of `min_select`. Optional modifier groups (min=0) still contribute their average cost to the parent item's COGS.

This reflects the economic reality that across a large volume of transactions, the operator will incur approximately the average cost of the group even if some customers skip it.

---

## 6. Database Schema Changes

### 6.1 Modified Tables

#### `mcogs_menu_items` — new columns

| New Column | Type | Default | Notes |
|---|---|---|---|
| `manual_cost` | `NUMERIC(18,4)` | `NULL` | Cost per portion for `manual` type items, in menu's local currency |
| `allergen_ids` | `JSONB` | `'[]'` | Array of `{ allergen_id, status }` objects for `manual` type items |

The `item_type` CHECK constraint is extended:

```sql
-- Before
CHECK (item_type IN ('recipe', 'ingredient'))

-- After
CHECK (item_type IN ('recipe', 'ingredient', 'manual', 'combo'))
```

The existing constraint that exactly one of `recipe_id` / `ingredient_id` must be non-null should be relaxed to allow both to be null for `manual` and `combo` types. A new CHECK or trigger should enforce:

```sql
-- recipe: recipe_id required, ingredient_id null
-- ingredient: ingredient_id required, recipe_id null
-- manual: both null
-- combo: both null
```

### 6.2 New Tables

#### `mcogs_modifier_groups`

```sql
CREATE TABLE IF NOT EXISTS mcogs_modifier_groups (
  id           SERIAL PRIMARY KEY,
  name         VARCHAR(200) NOT NULL,
  description  TEXT,
  min_select   INTEGER NOT NULL DEFAULT 0,
  max_select   INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_select >= 0),
  CHECK (max_select >= 1),
  CHECK (min_select <= max_select)
);
```

#### `mcogs_modifier_options`

```sql
CREATE TABLE IF NOT EXISTS mcogs_modifier_options (
  id                  SERIAL PRIMARY KEY,
  modifier_group_id   INTEGER NOT NULL REFERENCES mcogs_modifier_groups(id) ON DELETE CASCADE,
  item_type           VARCHAR(20) NOT NULL CHECK (item_type IN ('recipe', 'ingredient', 'manual')),
  recipe_id           INTEGER REFERENCES mcogs_recipes(id) ON DELETE SET NULL,
  ingredient_id       INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
  display_name        VARCHAR(200) NOT NULL DEFAULT '',
  manual_cost         NUMERIC(18,4) DEFAULT 0,   -- only used when item_type = 'manual'
  allergen_ids        JSONB NOT NULL DEFAULT '[]', -- only used when item_type = 'manual'
  price_addon         NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_default          BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order          INTEGER NOT NULL DEFAULT 0
);
```

#### `mcogs_menu_item_modifier_groups`

Junction table linking modifier groups to standalone menu items.

```sql
CREATE TABLE IF NOT EXISTS mcogs_menu_item_modifier_groups (
  id                  SERIAL PRIMARY KEY,
  menu_item_id        INTEGER NOT NULL REFERENCES mcogs_menu_items(id) ON DELETE CASCADE,
  modifier_group_id   INTEGER NOT NULL REFERENCES mcogs_modifier_groups(id) ON DELETE CASCADE,
  sort_order          INTEGER NOT NULL DEFAULT 0,
  UNIQUE (menu_item_id, modifier_group_id)
);
```

#### `mcogs_combo_steps`

```sql
CREATE TABLE IF NOT EXISTS mcogs_combo_steps (
  id           SERIAL PRIMARY KEY,
  menu_item_id INTEGER NOT NULL REFERENCES mcogs_menu_items(id) ON DELETE CASCADE,
                 -- menu_item must have item_type = 'combo' (enforced in application layer)
  name         VARCHAR(200) NOT NULL DEFAULT '',
  step_order   INTEGER NOT NULL DEFAULT 0,
  min_select   INTEGER NOT NULL DEFAULT 1,
  max_select   INTEGER NOT NULL DEFAULT 1,
  CHECK (min_select >= 0),
  CHECK (max_select >= 1),
  CHECK (min_select <= max_select)
);
```

#### `mcogs_combo_step_options`

```sql
CREATE TABLE IF NOT EXISTS mcogs_combo_step_options (
  id             SERIAL PRIMARY KEY,
  combo_step_id  INTEGER NOT NULL REFERENCES mcogs_combo_steps(id) ON DELETE CASCADE,
  item_type      VARCHAR(20) NOT NULL CHECK (item_type IN ('recipe', 'ingredient', 'manual')),
  recipe_id      INTEGER REFERENCES mcogs_recipes(id) ON DELETE SET NULL,
  ingredient_id  INTEGER REFERENCES mcogs_ingredients(id) ON DELETE SET NULL,
  display_name   VARCHAR(200) NOT NULL DEFAULT '',
  manual_cost    NUMERIC(18,4) DEFAULT 0,    -- only used when item_type = 'manual'
  allergen_ids   JSONB NOT NULL DEFAULT '[]', -- only used when item_type = 'manual'
  price_addon    NUMERIC(18,4) NOT NULL DEFAULT 0,
  is_default     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order     INTEGER NOT NULL DEFAULT 0
);
```

#### `mcogs_combo_step_option_modifier_groups`

Junction table linking modifier groups to combo step options.

```sql
CREATE TABLE IF NOT EXISTS mcogs_combo_step_option_modifier_groups (
  id                    SERIAL PRIMARY KEY,
  combo_step_option_id  INTEGER NOT NULL REFERENCES mcogs_combo_step_options(id) ON DELETE CASCADE,
  modifier_group_id     INTEGER NOT NULL REFERENCES mcogs_modifier_groups(id) ON DELETE CASCADE,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  UNIQUE (combo_step_option_id, modifier_group_id)
);
```

### 6.3 Indexes

```sql
-- Modifier options lookup by group
CREATE INDEX idx_modifier_options_group
  ON mcogs_modifier_options(modifier_group_id);

-- Modifier group assignment lookup by menu item
CREATE INDEX idx_mimgr_menu_item
  ON mcogs_menu_item_modifier_groups(menu_item_id);

-- Combo steps lookup by combo menu item
CREATE INDEX idx_combo_steps_menu_item
  ON mcogs_combo_steps(menu_item_id);

-- Combo step options lookup by step
CREATE INDEX idx_combo_step_options_step
  ON mcogs_combo_step_options(combo_step_id);

-- Combo step option modifier group lookup by option
CREATE INDEX idx_csomg_option
  ON mcogs_combo_step_option_modifier_groups(combo_step_option_id);
```

### 6.4 Schema Relationship Diagram

```
mcogs_menu_items (item_type = 'recipe'|'ingredient'|'manual'|'combo')
  │
  ├── [manual/recipe/ingredient] ──► mcogs_menu_item_modifier_groups
  │                                        │
  │                                        └──► mcogs_modifier_groups
  │                                                  │
  │                                                  └──► mcogs_modifier_options
  │
  └── [combo] ──► mcogs_combo_steps
                        │
                        └──► mcogs_combo_step_options
                                    │
                                    └──► mcogs_combo_step_option_modifier_groups
                                                │
                                                └──► mcogs_modifier_groups
                                                          │
                                                          └──► mcogs_modifier_options
```

---

## 7. API Routes

### 7.1 New Route Files

#### `api/src/routes/modifier-groups.js`

| Method | Path | Description |
|---|---|---|
| GET | `/modifier-groups` | List all groups (includes option count and assigned menu item count) |
| POST | `/modifier-groups` | Create a new modifier group |
| GET | `/modifier-groups/:id` | Get a single group with all its options |
| PUT | `/modifier-groups/:id` | Update group metadata (name, description, min_select, max_select) |
| DELETE | `/modifier-groups/:id` | Delete group — responds with 409 and assignment summary if assigned to any items or combo step options |
| GET | `/modifier-groups/:id/options` | List options for a group |
| POST | `/modifier-groups/:id/options` | Add an option to a group |
| PUT | `/modifier-groups/:id/options/:optId` | Update an option |
| DELETE | `/modifier-groups/:id/options/:optId` | Delete an option |
| PUT | `/modifier-groups/:id/options/reorder` | Reorder options — body: `[{ id, sort_order }]` |

**GET /modifier-groups response shape:**

```json
[
  {
    "id": 1,
    "name": "Bone In Flavours",
    "description": null,
    "min_select": 1,
    "max_select": 1,
    "option_count": 4,
    "assigned_menu_item_count": 3,
    "assigned_combo_option_count": 2
  }
]
```

#### `api/src/routes/menu-item-modifier-groups.js`

| Method | Path | Description |
|---|---|---|
| GET | `/menu-item-modifier-groups?menu_item_id=X` | List modifier group assignments for a menu item (with full option data) |
| POST | `/menu-item-modifier-groups` | Assign a modifier group to a menu item — body: `{ menu_item_id, modifier_group_id, sort_order }` |
| DELETE | `/menu-item-modifier-groups/:id` | Unassign a modifier group from a menu item |
| PUT | `/menu-item-modifier-groups/reorder` | Reorder modifier groups on a menu item — body: `[{ id, sort_order }]` |

#### `api/src/routes/combo-steps.js`

| Method | Path | Description |
|---|---|---|
| GET | `/combo-steps?menu_item_id=X` | List all steps for a combo item, including options and their modifier group assignments |
| POST | `/combo-steps` | Create a new step — body: `{ menu_item_id, name, step_order, min_select, max_select }` |
| PUT | `/combo-steps/:id` | Update a step |
| DELETE | `/combo-steps/:id` | Delete a step (cascades to options and their modifier group assignments) |
| POST | `/combo-steps/:id/options` | Add an option to a step |
| PUT | `/combo-steps/:id/options/:optId` | Update an option |
| DELETE | `/combo-steps/:id/options/:optId` | Delete an option |
| POST | `/combo-steps/:id/options/:optId/modifier-groups` | Assign a modifier group to a combo step option — body: `{ modifier_group_id, sort_order }` |
| DELETE | `/combo-steps/:id/options/:optId/modifier-groups/:mgId` | Unassign a modifier group from a combo step option |

**GET /combo-steps?menu_item_id=X response shape:**

```json
[
  {
    "id": 10,
    "menu_item_id": 5,
    "name": "Choose your wings",
    "step_order": 0,
    "min_select": 1,
    "max_select": 1,
    "options": [
      {
        "id": 20,
        "item_type": "recipe",
        "recipe_id": 3,
        "display_name": "8pc Bone In",
        "price_addon": 0,
        "is_default": true,
        "sort_order": 0,
        "modifier_groups": [
          {
            "assignment_id": 7,
            "modifier_group_id": 1,
            "name": "Bone In Flavours",
            "min_select": 1,
            "max_select": 1,
            "sort_order": 0,
            "options": [...]
          }
        ]
      }
    ]
  }
]
```

### 7.2 Modified Route Files

#### `api/src/routes/menu-items.js`

**POST /menu-items:**
- `item_type` validation extended to accept `'manual'` and `'combo'`
- `recipe_id` and `ingredient_id` are both nullable when `item_type` is `'manual'` or `'combo'`
- Accept `manual_cost` and `allergen_ids` in request body for `manual` type
- For `combo` type: only `display_name`, `menu_id`, and `sort_order` are required at creation — steps are added separately

**PUT /menu-items/:id:**
- Same extensions as POST

**GET /menu-items response:**
- Include `manual_cost` and `allergen_ids` fields in all item responses

**Validation rules:**

| item_type | recipe_id | ingredient_id | manual_cost | allergen_ids |
|---|---|---|---|---|
| recipe | Required | Must be null | Ignored | Ignored |
| ingredient | Must be null | Required | Ignored | Ignored |
| manual | Must be null | Must be null | Required (≥0) | Optional (defaults to `[]`) |
| combo | Must be null | Must be null | Must be null | Ignored |

#### `api/src/routes/cogs.js`

Major update to COGS calculation — see [Section 8](#8-cogs-calculation-logic) for full pseudocode.

Summary of changes:
- Pre-load modifier groups, combo steps, and combo step option modifier groups in bulk (batch loading, not N+1)
- Add `manual` and `combo` branches to the per-item cost calculation
- Return `avg_modifier_price_addon`, `price_with_modifiers`, `cogs_pct_base`, `cogs_pct_with_modifiers`, and `has_modifiers` fields on every item in the response

#### `api/src/routes/allergens.js`

**GET /allergens/menu/:id:**
- Extended response to include modifier-sourced and combo-sourced allergens flagged separately
- See [Section 10](#10-allergen-matrix-changes) for full response shape

**PATCH /allergens/menu-item/:id/allergens (new):**
- Update `allergen_ids` JSONB on a `manual` type menu item
- Body: `{ allergen_ids: [{ allergen_id, status }] }`

#### `api/src/routes/index.js`

New route registrations:

```js
router.use('/modifier-groups', require('./modifier-groups'));
router.use('/menu-item-modifier-groups', require('./menu-item-modifier-groups'));
router.use('/combo-steps', require('./combo-steps'));
```

---

## 8. COGS Calculation Logic

### 8.1 Batch Loading Strategy

All supporting data is pre-loaded in bulk before the per-item calculation loop to avoid N+1 query patterns.

```
Pre-load for GET /cogs/menu/:id:

1. quoteLookup (existing)
   { ingredient_id: { country_id: { price_per_base_unit, unit } } }

2. recipeItemsMap (existing)
   { recipe_id: [{ item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, conversion }] }

3. variationMap (existing)
   { recipe_id: { country_id: variation_data } }

4. modifierGroupsMap
   { menu_item_id: [
     {
       group_id, name, min_select, max_select, sort_order,
       options: [{ item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order }]
     }
   ] }

5. comboStepsMap
   { menu_item_id: [
     {
       step_id, name, step_order, min_select, max_select,
       options: [{ option_id, item_type, recipe_id, ingredient_id, manual_cost, price_addon, sort_order }]
     }
   ] }

6. comboStepOptionModifierGroupsMap
   { combo_step_option_id: [
     {
       group_id, name, min_select, max_select, sort_order,
       options: [{ item_type, recipe_id, ingredient_id, manual_cost, price_addon }]
     }
   ] }

7. Collect all recipe_ids referenced inside modifier options and combo step options
   → load their recipe items into recipeItemsMap (extending the existing map)
```

### 8.2 Helper: `calcOptionCost(option, countryId, quoteLookup, recipeItemsMap)`

```
calcOptionCost(option, countryId, quoteLookup, recipeItemsMap):
  if option.item_type == 'recipe':
    return calcRecipeCost(option.recipe_id, recipeItemsMap, countryId, quoteLookup)
  elif option.item_type == 'ingredient':
    return quoteLookup[option.ingredient_id][countryId].price_per_base_unit
  else (manual):
    return option.manual_cost  // already in local currency; no exchange rate conversion
```

### 8.3 Helper: `calcModifierGroupsAvgCost(groups, countryId, quoteLookup, recipeItemsMap)`

Calculates the total average cost and average price add-on contribution across all modifier groups assigned to an item or combo step option.

```
calcModifierGroupsAvgCost(groups, countryId, quoteLookup, recipeItemsMap):
  total_avg_cost   = 0
  total_avg_addon  = 0

  for each group in groups:
    option_costs  = []
    option_addons = []

    for each option in group.options:
      cost = calcOptionCost(option, countryId, quoteLookup, recipeItemsMap)
      option_costs.append(cost)
      option_addons.append(option.price_addon)

    group_avg_cost  = sum(option_costs) / len(option_costs)
    group_avg_addon = sum(option_addons) / len(option_addons)

    total_avg_cost  += group_avg_cost
    total_avg_addon += group_avg_addon

  return {
    avg_cost:         total_avg_cost,
    avg_price_addon:  total_avg_addon
  }
```

Note: Groups with `min_select = 0` (optional) are still included in the average. This reflects expected COGS across a large volume of transactions.

### 8.4 Helper: `calcComboStepCost(step, comboStepOptionModifierGroupsMap, countryId, quoteLookup, recipeItemsMap)`

```
calcComboStepCost(step, comboStepOptionModifierGroupsMap, countryId, ...):
  if step.options.length == 1:
    // Fixed component — use direct cost
    option        = step.options[0]
    base_cost     = calcOptionCost(option, countryId, ...)
    opt_mods      = comboStepOptionModifierGroupsMap[option.option_id] or []
    modifier      = calcModifierGroupsAvgCost(opt_mods, countryId, ...)
    return {
      cost:            base_cost + modifier.avg_cost,
      avg_price_addon: option.price_addon + modifier.avg_price_addon
    }

  else:
    // Choice step — average across all options
    step_costs  = []
    step_addons = []

    for each option in step.options:
      base_cost = calcOptionCost(option, countryId, ...)
      opt_mods  = comboStepOptionModifierGroupsMap[option.option_id] or []
      modifier  = calcModifierGroupsAvgCost(opt_mods, countryId, ...)
      step_costs.append(base_cost + modifier.avg_cost)
      step_addons.append(option.price_addon + modifier.avg_price_addon)

    return {
      cost:            sum(step_costs) / len(step_costs),
      avg_price_addon: sum(step_addons) / len(step_addons)
    }
```

### 8.5 Full Per-Item Cost Calculation

```
for each menu_item in menu.items:

  if item_type == 'ingredient':
    cpp                    = quoteLookup[ingredient_id][countryId].price_per_base_unit * qty
    avg_modifier_price_addon = 0

  elif item_type == 'manual':
    cpp                    = manual_cost * qty   // local currency, no conversion
    avg_modifier_price_addon = 0
    // Note: manual items can also have modifier groups (handled below)

  elif item_type == 'recipe':
    cpp             = calcRecipeCost(recipe_id, recipeItemsMap, countryId, quoteLookup) * qty
    modifier_groups = modifierGroupsMap[item.id] or []
    modifier        = calcModifierGroupsAvgCost(modifier_groups, countryId, ...)
    cpp            += modifier.avg_cost
    avg_modifier_price_addon = modifier.avg_price_addon

  elif item_type == 'combo':
    combo_cost       = 0
    total_avg_addon  = 0
    steps            = comboStepsMap[item.id] or []

    for each step in steps:
      step_result      = calcComboStepCost(step, comboStepOptionModifierGroupsMap, countryId, ...)
      combo_cost      += step_result.cost
      total_avg_addon += step_result.avg_price_addon

    cpp = combo_cost * qty
    avg_modifier_price_addon = total_avg_addon

  // Apply modifier groups also to manual items and ingredient items
  // (modifierGroupsMap applies to any non-combo item_type)
  if item_type in ('manual', 'ingredient') and item.id in modifierGroupsMap:
    modifier_groups  = modifierGroupsMap[item.id]
    modifier         = calcModifierGroupsAvgCost(modifier_groups, countryId, ...)
    cpp             += modifier.avg_cost
    avg_modifier_price_addon = modifier.avg_price_addon

  // PLT enrichment
  sell_price_gross         = item.sell_price * exchange_rate_dispRate  // convert to display currency
  price_with_modifiers     = sell_price_gross + avg_modifier_price_addon
  has_modifiers            = avg_modifier_price_addon > 0 OR len(modifierGroupsMap[item.id]) > 0

  cogs_pct_base            = sell_price_gross > 0 ? cpp / sell_price_gross : null
  cogs_pct_with_modifiers  = price_with_modifiers > 0 ? cpp / price_with_modifiers : null
```

### 8.6 COGS API Response — New Fields Per Item

The existing COGS API response is extended with these fields on each item:

```json
{
  "menu_item_id": 5,
  "display_name": "Wingstop Meal Deal",
  "item_type": "combo",
  "cost_per_portion": 4.82,
  "sell_price_gross": 12.99,
  "cogs_pct_base": 0.371,
  "has_modifiers": true,
  "avg_modifier_price_addon": 0.25,
  "price_with_modifiers": 13.24,
  "cogs_pct_with_modifiers": 0.364
}
```

---

## 9. PLT / MPT Changes

### 9.1 PLT (Price Level Table)

The PLT currently shows one editable price column per price level per menu item. After this feature:

| Item condition | Price columns shown |
|---|---|
| No modifier groups, not a combo with add-ons | Single "Price (£)" column — unchanged |
| Has modifier groups with price add-ons OR is a combo with step price add-ons | Two columns: "Base (£)" (editable) and "w/ Modifiers (£)" (read-only, calculated) |

**"w/ Modifiers (£)" calculation:**

```
price_with_modifiers = base_price + avg_modifier_price_addon
```

This value is **read-only** in the PLT — it is derived from the COGS API response. The operator edits only the base price.

**COGS% display:**
- Items without modifiers: single COGS% column (existing behaviour)
- Items with modifiers: two COGS% columns — "COGS% (Base)" and "COGS% (w/ Mod)"
- Colour coding (green/amber/red) applies to both columns independently

**Visual indicator:**
- Items with modifier groups show a small pill badge "M" in the item name column
- Combo items show a "C" badge

### 9.2 MPT (Menu Performance Table)

The MPT mirrors the PLT treatment:
- Items with modifier price add-ons show two margin columns
- `avg_modifier_price_addon` is pre-calculated by the COGS API and included in the response — the MPT does not recalculate it client-side

---

## 10. Allergen Matrix Changes

### 10.1 Allergen Data Sources

After this feature, allergen data for a menu item row can come from four sources:

| Source | Storage location |
|---|---|
| Base recipe/ingredient allergens | `mcogs_ingredient_allergens` (existing) |
| Manual menu item allergens | `mcogs_menu_items.allergen_ids` (new JSONB column) |
| Manual modifier option allergens | `mcogs_modifier_options.allergen_ids` (new JSONB column) |
| Manual combo step option allergens | `mcogs_combo_step_options.allergen_ids` (new JSONB column) |

### 10.2 Allergen Aggregation Rules

When aggregating allergen status across sources for a single matrix cell:

1. `contains` overrides `may_contain` overrides `free_from` overrides `null`
2. If a recipe-linked or ingredient-linked option (not manual) appears in a modifier group or combo step, its allergens are resolved through the existing `mcogs_ingredient_allergens` lookup
3. Source tracking is preserved in the response so the frontend can flag modifier-sourced vs base allergens differently

### 10.3 Updated `GET /allergens/menu/:id` Response Shape

Each menu item row in the response is extended:

```json
{
  "menu_item_id": 5,
  "display_name": "Wingstop Meal Deal",
  "item_type": "combo",
  "allergens": {
    "1": {
      "status": "contains",
      "source": "modifier",
      "source_details": [
        {
          "source_type": "combo_step",
          "step_name": "Choose your wings",
          "option_name": "8pc Bone In",
          "modifier_group_name": "Bone In Flavours",
          "options": [
            { "name": "Korean BBQ", "allergen_status": "contains" },
            { "name": "Lemon Pepper", "allergen_status": "free_from" }
          ]
        }
      ]
    }
  }
}
```

`source` values:
- `"base"` — allergen comes from the item's own recipe/ingredient or manual allergen_ids
- `"modifier"` — allergen comes from a modifier group assigned to the item
- `"combo"` — allergen comes from a combo step option or its nested modifier group
- `"base+modifier"` — allergen present in both base and at least one modifier (use base styling)

### 10.4 AllergenMatrixPage.tsx Changes

**Matrix cell styling:**

| Allergen source | Cell appearance |
|---|---|
| Base only | Existing green/amber cell — unchanged |
| Modifier only | Amber/orange cell with small "M" badge |
| Combo step only | Amber/orange cell with small "C" badge |
| Base + modifier | Base styling — modifier source does not change the cell colour |

**Expandable rows:**

Clicking a menu item row in the matrix expands it to show allergen breakdown by source:
- If the item has modifier groups: each modifier group is listed, with each option and its per-allergen status shown as a sub-row
- If the item is a combo: each step is listed, each option is listed with its allergen flags, and any nested modifier groups are shown under the option

**Manual item support in inventory matrix:**

Manual menu items in the inventory-side allergen matrix show their `allergen_ids` values. These are editable inline via a checkbox UI — clicking the cell opens a popover with 14 allergen checkboxes (contains/may_contain/free_from per allergen). Saving calls `PATCH /allergens/menu-item/:id/allergens`.

---

## 11. Frontend Changes — MenusPage

### 11.1 Existing Menu Builder Tab

**"Add Item" modal — new item type options:**

| New type | Required fields | Optional fields |
|---|---|---|
| Manual | `display_name`, `manual_cost` (labelled with menu's currency symbol) | Allergen picker (14 allergens, contains/may_contain/free_from) |
| Combo | `display_name` | Nothing else at creation — steps are built in the Combo Step Builder |

**Item list row changes:**
- Item type badge updated to show `Manual` (grey badge) and `Combo` (purple badge) in addition to existing `Recipe` and `Ingredient` badges
- Non-combo rows with assigned modifier groups: show small pill badges for each group (e.g., "Bone In Flavours" and "+1 more" if multiple)
- Combo rows: "Edit Steps" button opens the Combo Step Builder modal
- Non-combo rows: "Edit Modifiers" button opens the Modifier Assignment panel (right-side drawer or modal)

### 11.2 New Tab: Modifiers

A new top-level tab added to MenusPage ("Modifiers") for managing global modifier groups.

**Layout — two-panel:**

**Left panel — Modifier Group List:**
- List of all modifier groups globally
- Each row: name, min/max select, option count, assigned menu item count
- "New Modifier Group" button at top
- Selecting a row loads it in the right panel

**Right panel — Group Editor (empty state until a group is selected):**
- Group metadata form: name, description, min_select, max_select
- Options list (drag-to-reorder):
  - Each option row shows: type badge (Recipe/Ingredient/Manual), item name (or display_name for manual), price_addon field, is_default toggle, allergen badges (for manual options), delete button
  - Inline editing of price_addon and display_name
- "Add Option" button — opens sub-form: type picker → item selector (recipe/ingredient picker or manual fields) → price_addon, display_name, is_default
- "Assign to Menu Items" section (collapsible):
  - Groups menus by market
  - Each menu expandable to show its items as a checklist
  - Toggle checkbox assigns/unassigns the modifier group to that menu item

### 11.3 Combo Step Builder (modal)

Opened from a combo item row in the Menu Builder tab via the "Edit Steps" button.

**Modal header:**
- Shows combo item name
- "Save" and "Cancel" buttons

**Body:**
- Ordered list of steps (drag handle for reordering)
- "Add Step" button at bottom

**Each step block:**
- Step header row: name input, min_select input, max_select input, "Delete Step" button
- Options list within the step (drag handle for reordering within the step)
- "Add Option" button at the bottom of the step

**Each option row within a step:**
- Type picker (Recipe / Ingredient / Manual)
- Item selector (recipe/ingredient search picker, or manual fields: display_name + manual_cost + allergen picker)
- `display_name` override field
- `price_addon` field (with currency symbol prefix)
- `is_default` toggle
- Allergen indicator badges (for manual options only)
- "Modifiers" button — opens a sub-panel (side sheet) showing modifier groups assigned to this specific step option
  - Sub-panel lists currently assigned modifier groups for the option
  - "Assign Modifier Group" button opens a global group picker (searchable list of all modifier groups)
  - Each assigned group shows its options as a read-only preview
  - Reorder handle and unassign button per assigned group

---

## 12. Pepper AI New Tools

Total tool count after this feature: **~92 tools** (74 existing + 18 new)

### 12.1 Modifier Group Tools (11 tools)

| Tool name | Description |
|---|---|
| `list_modifier_groups` | List all modifier groups globally — returns name, min/max, option count, assignment counts |
| `create_modifier_group` | Create a modifier group — params: name, description (optional), min_select, max_select |
| `update_modifier_group` | Update modifier group metadata — params: id, and any of name/description/min_select/max_select |
| `delete_modifier_group` | Delete a modifier group — Pepper warns if the group is currently assigned to items and asks for confirmation |
| `list_modifier_options` | List all options for a modifier group — params: modifier_group_id |
| `add_modifier_option` | Add an option to a modifier group — params: modifier_group_id, item_type, recipe_id/ingredient_id/manual fields, price_addon, display_name, is_default |
| `update_modifier_option` | Update a modifier option — params: option_id, and any updatable fields |
| `delete_modifier_option` | Delete a modifier option — params: option_id |
| `assign_modifier_group` | Assign a modifier group to a standalone menu item — params: menu_item_id, modifier_group_id, sort_order (optional) |
| `unassign_modifier_group` | Remove a modifier group assignment from a standalone menu item — params: assignment_id or (menu_item_id + modifier_group_id) |
| `assign_modifier_group_to_combo_option` | Assign a modifier group to a combo step option — params: combo_step_option_id, modifier_group_id, sort_order (optional) |

### 12.2 Combo Tools (7 tools)

| Tool name | Description |
|---|---|
| `list_combo_steps` | List all steps (with options and nested modifier group assignments) for a combo menu item — params: menu_item_id |
| `create_combo_step` | Create a step on a combo item — params: menu_item_id, name, step_order, min_select, max_select |
| `update_combo_step` | Update a combo step — params: step_id, and any of name/step_order/min_select/max_select |
| `delete_combo_step` | Delete a combo step and all its options — Pepper warns about cascade and asks for confirmation |
| `add_combo_step_option` | Add an option to a combo step — params: combo_step_id, item_type, recipe_id/ingredient_id/manual fields, display_name, price_addon, is_default, sort_order |
| `update_combo_step_option` | Update a combo step option — params: option_id, and any updatable fields |
| `delete_combo_step_option` | Delete a combo step option — params: option_id |

### 12.3 Confirmation Safety for New Tools

Consistent with the existing Pepper safety rules, Pepper must verbally describe any create/update/delete action and ask "Shall I proceed?" before calling the corresponding write tool.

Additional safety rules for new tools:
- `delete_modifier_group` — warns with "This modifier group is currently assigned to X menu items and Y combo step options. Deleting it will remove all those assignments."
- `delete_combo_step` — warns with "Deleting this step will also delete all [N] options within it and any modifier group assignments on those options."
- `assign_modifier_group_to_combo_option` — confirms which combo, step, and option the modifier group is being attached to

### 12.4 System Prompt Updates

The Pepper system prompt should be updated to include:
- Description of manual item type and when to use it
- Description of combo type — that steps must be created separately after creating the combo item
- Description of modifier groups as global/reusable — remind Pepper to check if an appropriate group already exists before creating a new one
- Reminder that nested combos are not supported (combo step options cannot be of type `combo`)

---

## 13. User Stories

### Feature 1 — Manual Menu Items

**US-1:** As a franchise operator, I want to add a menu item with a manual cost per portion (rather than linking it to a recipe or ingredient), so that I can include items like packaging charges, licensed drinks, or promotional items in my COGS analysis without needing to set them up in the inventory system.

**US-2:** As a franchise operator, I want to tag allergens directly on a manual menu item using the standard 14 EU/UK FIC allergen checkboxes, so that my allergen matrix remains accurate even for items that are not represented as recipes in the system.

### Feature 3 — Modifier Groups (standalone)

**US-3:** As a franchise operator, I want to create a reusable modifier group (e.g., "Bone In Flavours") with multiple options — some linked to recipes, some to inventory ingredients, and some entered manually — so that I can model choice-based upsells and flavour selections consistently across multiple menu items.

**US-4:** As a franchise operator, I want to assign the same modifier group to multiple menu items at once (e.g., assign "Dipping Sauce" to all eligible items on a menu), so that I do not have to set up the same options repeatedly for each item.

**US-5:** As a franchise operator, I want to see the average cost of all modifier group options automatically included in the COGS calculation for any menu item the group is assigned to, so that my food cost percentages reflect the real expected cost including accompaniments and flavour selections.

**US-6:** As a franchise operator, I want the PLT to show me both a "Base Price" column and a "Price + Modifiers" column for menu items with price add-on modifiers, so that I can evaluate COGS% against both the headline sell price and the expected price inclusive of modifier upcharges.

### Feature 2 — Combo Menu Items

**US-7:** As a franchise operator, I want to build a combo meal by defining ordered steps (e.g., "Choose your wings", "Choose your side", "Choose your drink"), each with one or more selectable options, so that the combo's COGS and sell price are accurately modelled as a single line item in my menu.

**US-8:** As a franchise operator, I want to mark a combo step as optional (min_select = 0) — for example, "Add a sauce (optional)" — so that customers can skip it, while its average cost is still included in my COGS model to reflect real expected usage.

**US-9:** As a franchise operator, I want to assign a price add-on to specific options within a combo step (e.g., "Large Fries" at +£1.00 over "Regular Fries"), so that the PLT shows both the base combo price and the expected average price inclusive of those upgrades.

**US-10:** As a franchise operator, I want to attach a modifier group to a specific option within a combo step (e.g., attach "Bone In Flavours" to the "8pc Bone In" wing option), so that the flavour choice COGS and any price add-ons from the modifier are included in the combo's total COGS calculation.

**US-11:** As a franchise operator, I want the COGS for a combo to be automatically calculated as the sum of each step's average option cost (including any nested modifier group costs), so that I have an accurate expected food cost for the combo even when steps involve customer choices.

### Feature 2 + 3 — Allergen Matrix

**US-12:** As a franchise operator, I want the allergen matrix to highlight cells where an allergen is introduced by a modifier group option (rather than the base item itself), so that I can quickly identify which allergens are conditional on customer choices versus always present.

**US-13:** As a franchise operator, I want to expand a menu item row in the allergen matrix to see a detailed breakdown of which modifier group and which specific option within that group is responsible for each allergen, so that I can make informed decisions about modifier option ingredient sourcing.

### Pepper AI

**US-14:** As a franchise operator using the Pepper AI assistant, I want to ask Pepper to create a modifier group and assign it to one or more menu items using natural language, so that I can set up complex modifier structures quickly without manually navigating multiple pages in the UI.

---

## 14. Detailed Scenarios

### Scenario 1: Simple Manual Item — Packaging Charge

**Context:** The operator wants to add a £0.10 packaging charge to account for box costs on takeaway items. This is not an ingredient in the inventory system.

**Steps:**

1. In MenusPage → Menu Builder tab, select the relevant takeaway menu.
2. Click "Add Item" → select type "Manual".
3. Enter:
   - Display name: "Packaging Charge"
   - Manual cost: £0.10 (shown in the menu's local currency, GBP in this case)
   - Allergens: none selected (all free_from or left null)
4. Save the item.

**Result in COGS:**
- The packaging charge appears as a line item with `cost_per_portion = £0.10`.
- No modifier groups are assigned, so `has_modifiers = false` and the PLT shows a single price column.
- The sell price for the packaging charge is set to £0.00 in the PLT (it is a hidden cost pass-through, not a customer-facing charge). COGS% is shown as null/infinity and displayed in red to alert the operator.
- The allergen matrix shows the packaging charge row with all cells blank.

---

### Scenario 2: Flavoured Wings — Standalone Item with Modifier Group

**Context:** "Lemon Pepper Wings" is a standalone menu item (a recipe). The customer must choose a flavour coating. The operator has a "Bone In Flavours" modifier group with four options: Lemon Pepper, Mango Habanero, Atomic, Korean BBQ — all at £0 add-on. The Korean BBQ sauce contains sesame (allergen 12).

**Steps:**

1. In the Modifiers tab, create a modifier group:
   - Name: "Bone In Flavours"
   - min_select: 1, max_select: 1
   - Options:
     - Lemon Pepper (recipe: "Lemon Pepper Sauce", price_addon: £0)
     - Mango Habanero (recipe: "Mango Habanero Sauce", price_addon: £0)
     - Atomic (recipe: "Atomic Sauce", price_addon: £0)
     - Korean BBQ (recipe: "Korean BBQ Sauce", price_addon: £0)

2. In the Menu Builder tab, open the "Bone In Wings" menu item row and click "Edit Modifiers".
3. Assign "Bone In Flavours" to the item.

**COGS calculation:**

Assume:
- Wings recipe cost: £2.40
- Lemon Pepper sauce cost: £0.18
- Mango Habanero sauce cost: £0.22
- Atomic sauce cost: £0.15
- Korean BBQ sauce cost: £0.20

```
avg_modifier_cost = (0.18 + 0.22 + 0.15 + 0.20) / 4 = £0.1875
avg_modifier_price_addon = (0 + 0 + 0 + 0) / 4 = £0

total cpp = 2.40 + 0.1875 = £2.5875
```

Since `avg_modifier_price_addon = 0`, `price_with_modifiers = sell_price_gross` — the PLT shows a single price column (no add-on uplift column needed).

**Allergen matrix:**
- The "Bone In Wings" row shows sesame (allergen 12) in an amber/orange cell with an "M" badge, indicating the allergen is introduced by a modifier option, not the base wings recipe.
- Expanding the row shows: "Bone In Flavours > Korean BBQ — contains sesame".
- The other three flavour options show sesame as free_from.

---

### Scenario 3: Full Wingstop Combo Meal

**Context:** A "Wingstop Meal Deal" combo. The customer chooses their wings, a side, and a drink. Wings options themselves have a mandatory flavour modifier. The side and drink steps have price add-ons for upgrades.

**Structure:**

```
Combo: "Wingstop Meal Deal"   (sell price: £12.99)

Step 1: "Choose your wings" (min:1, max:1)
  Option A: 8pc Bone In (recipe: "8pc Bone In Wings", price_addon: £0)
    → Modifier Group: "Bone In Flavours" (min:1, max:1)
       - Lemon Pepper (recipe cost: £0.18)
       - Mango Habanero (recipe cost: £0.22)
       - Atomic (recipe cost: £0.15)
       - Korean BBQ (recipe cost: £0.20)
  Option B: 8pc Boneless (recipe: "8pc Boneless Wings", price_addon: £0)
    → Modifier Group: "Boneless Flavours" (min:1, max:1)
       - Lemon Pepper (recipe cost: £0.18)
       - Mango Habanero (recipe cost: £0.22)

Step 2: "Choose your side" (min:1, max:1)
  Option A: Regular Fries (recipe: "Regular Fries", price_addon: £0)
  Option B: Large Fries (recipe: "Large Fries", price_addon: £1.00)

Step 3: "Choose your drink" (min:1, max:1)
  Option A: Regular Drink (manual, manual_cost: £0.80, price_addon: £0)
  Option B: Large Drink (manual, manual_cost: £1.20, price_addon: £0.50)
```

**Ingredient costs assumed:**
- 8pc Bone In Wings recipe: £2.40
- 8pc Boneless Wings recipe: £2.10
- Regular Fries recipe: £0.45
- Large Fries recipe: £0.65

**Full COGS walk-through:**

```
Step 1: "Choose your wings" — 2 options (choice step → average)
  Option A: 8pc Bone In
    base_cost = £2.40
    Modifier: "Bone In Flavours" (4 options)
      avg_mod_cost  = (0.18 + 0.22 + 0.15 + 0.20) / 4 = £0.1875
      avg_mod_addon = (0 + 0 + 0 + 0) / 4 = £0.00
    option_A_cost  = 2.40 + 0.1875 = £2.5875
    option_A_addon = 0 + 0 = £0.00

  Option B: 8pc Boneless
    base_cost = £2.10
    Modifier: "Boneless Flavours" (2 options)
      avg_mod_cost  = (0.18 + 0.22) / 2 = £0.20
      avg_mod_addon = (0 + 0) / 2 = £0.00
    option_B_cost  = 2.10 + 0.20 = £2.30
    option_B_addon = 0 + 0 = £0.00

  step_1_cost  = (2.5875 + 2.30) / 2 = £2.4438
  step_1_addon = (0 + 0) / 2 = £0.00

Step 2: "Choose your side" — 2 options (choice step → average)
  option_A_cost  = £0.45, option_A_addon = £0.00
  option_B_cost  = £0.65, option_B_addon = £1.00

  step_2_cost  = (0.45 + 0.65) / 2 = £0.55
  step_2_addon = (0 + 1.00) / 2 = £0.50

Step 3: "Choose your drink" — 2 options (choice step → average)
  option_A_cost  = £0.80 (manual), option_A_addon = £0.00
  option_B_cost  = £1.20 (manual), option_B_addon = £0.50

  step_3_cost  = (0.80 + 1.20) / 2 = £1.00
  step_3_addon = (0 + 0.50) / 2 = £0.25

Total:
  cpp                   = 2.4438 + 0.55 + 1.00 = £3.9938
  avg_modifier_price_addon = 0 + 0.50 + 0.25 = £0.75
```

**PLT price with modifiers:**

```
sell_price_gross      = £12.99  (base combo price)
price_with_modifiers  = 12.99 + 0.75 = £13.74

cogs_pct_base         = 3.9938 / 12.99 = 30.7%
cogs_pct_with_mods    = 3.9938 / 13.74 = 29.1%
```

**PLT display (UK menu, GBP):**

| Item | Base (£) | w/ Modifiers (£) | COGS% (Base) | COGS% (w/ Mod) |
|---|---|---|---|---|
| Wingstop Meal Deal | £12.99 | £13.74 | 30.7% | 29.1% |

Both COGS% values fall within the green threshold (assuming target ≤ 32%), shown in green.

---

### Scenario 4: Optional Modifier — Dipping Sauce on Fries

**Context:** "Regular Fries" is a standalone recipe item. A dipping sauce is offered optionally (customer can decline). The operator wants the average sauce cost included in COGS regardless of whether it is mandatory.

**Modifier group:** "Dipping Sauce" (min_select: 0, max_select: 1)
- No Sauce (manual, manual_cost: £0, price_addon: £0)
- Garlic Mayo (recipe: "Garlic Mayo", cost: £0.12, price_addon: £0)
- BBQ (recipe: "BBQ Sauce", cost: £0.10, price_addon: £0.20)

**COGS calculation:**

```
avg_mod_cost  = (0 + 0.12 + 0.10) / 3 = £0.073
avg_mod_addon = (0 + 0 + 0.20) / 3    = £0.067

cpp (fries) = fries_recipe_cost + avg_mod_cost
            = 0.45 + 0.073 = £0.523

price_with_modifiers = sell_price_gross + 0.067
```

Note: Although `min_select = 0` (the sauce is optional), the average cost of all three options — including the zero-cost "No Sauce" option — is included in COGS. This conservative approach reflects that across a large order volume, approximately 2/3 of customers will choose a sauce, and the weighted average aligns with actual cost.

---

### Scenario 5: Allergen Matrix — Modifier-Sourced Sesame Allergen

**Context:** The allergen matrix for a UK menu includes "Bone In Wings" (base recipe: no sesame). The "Bone In Flavours" modifier group has been assigned to this item. The Korean BBQ sauce recipe contains sesame (allergen ID 12, status: contains).

**GET /allergens/menu/:id response for this row:**

```json
{
  "menu_item_id": 3,
  "display_name": "Bone In Wings",
  "item_type": "recipe",
  "allergens": {
    "12": {
      "status": "contains",
      "source": "modifier",
      "source_details": [
        {
          "source_type": "modifier_group",
          "modifier_group_name": "Bone In Flavours",
          "options": [
            { "name": "Lemon Pepper",    "allergen_status": "free_from" },
            { "name": "Mango Habanero",  "allergen_status": "free_from" },
            { "name": "Atomic",          "allergen_status": "free_from" },
            { "name": "Korean BBQ",      "allergen_status": "contains"  }
          ]
        }
      ]
    }
  }
}
```

**AllergenMatrixPage rendering:**

| Item | ... | Sesame | ... |
|---|---|---|---|
| Bone In Wings | | 🟠 M | |

The sesame cell shows an amber/orange background with a small "M" badge (modifier-sourced).

Clicking the "Bone In Wings" row expands it:

```
▼ Bone In Wings
    Modifier Group: Bone In Flavours
      ├── Lemon Pepper     [sesame: free from]
      ├── Mango Habanero   [sesame: free from]
      ├── Atomic           [sesame: free from]
      └── Korean BBQ       [sesame: CONTAINS]  ← highlighted in red
```

The allergen declaration on the menu would need to note: "Bone In Wings — contains sesame when served with Korean BBQ flavour."

---

## 15. Implementation Phases

| Phase | Name | Scope | Estimated Effort |
|---|---|---|---|
| **1** | **Foundation** | DB schema migration (2 new columns on mcogs_menu_items + 7 new tables); `manual` item type in menu-items API + COGS calculation; "Manual" option in MenusPage Add Item modal; manual item COGS display in PLT/MPT | ~2 days |
| **2** | **Modifier Groups** | modifier-groups.js API; menu-item-modifier-groups.js API; Modifiers tab in MenusPage; modifier avg cost in COGS for standalone items (`recipe`, `ingredient`, `manual`); PLT two-column treatment for modifier items; `has_modifiers` badge in PLT | ~2.5 days |
| **3** | **Combos** | combo-steps.js API; `combo` item type in menu-items API; Combo option in Add Item modal; Combo Step Builder modal in MenusPage; modifier groups on combo step options; full combo COGS calculation including compound modifier scenario; PLT/MPT for combo items | ~3 days |
| **4** | **Allergen Matrix** | Manual item allergen tagging UI (checkbox grid in Add Item modal and inline in allergen matrix); modifier and combo allergen aggregation in allergens.js; GET /allergens/menu/:id extended response; AllergenMatrixPage expandable rows with modifier allergen detail; amber "M" / "C" cell highlighting for modifier- and combo-sourced allergens | ~2 days |
| **5** | **Pepper + Polish** | 18 new Pepper tools (11 modifier group tools + 7 combo tools); Pepper system prompt update for new item types; PLT/MPT two-column visual refinements; Import template extension notes for manual items (combos and modifier groups are out of scope for import in this phase) | ~1.5 days |
| **Total** | | | **~11 days** |

### Phase Dependencies

```
Phase 1 (Foundation: manual type + DB schema)
    │
    ├──► Phase 2 (Modifier Groups — requires mcogs_menu_item_modifier_groups table from Phase 1)
    │
    └──► Phase 3 (Combos — requires mcogs_combo_steps tables from Phase 1)
              │
              └──► Phase 4 (Allergen Matrix — requires modifier and combo data from Phases 2+3)
                        │
                        └──► Phase 5 (Pepper — requires all routes and UI from Phases 1–4)
```

Phases 2 and 3 can be developed in parallel once Phase 1 is complete. Phase 4 depends on both Phases 2 and 3. Phase 5 depends on all previous phases.

### Migration Safety Notes

- The DB schema migration (`api/scripts/migrate.js`) uses `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe to run multiple times.
- The `item_type` CHECK constraint extension on `mcogs_menu_items` requires dropping and recreating the constraint (not additive). This should be handled in the migration script with `ALTER TABLE mcogs_menu_items DROP CONSTRAINT IF EXISTS ... ; ALTER TABLE mcogs_menu_items ADD CONSTRAINT ...`.
- No data migration is required for existing rows — existing `recipe` and `ingredient` rows are unaffected by the new columns (`manual_cost` defaults to NULL, `allergen_ids` defaults to `[]`).

---

## 16. Open Questions & Future Scope

### 16.1 Open Questions (to be resolved before or during Phase 3)

| # | Question | Notes |
|---|---|---|
| Q1 | **Combo choice slots:** Should combo steps eventually support grouped options within a step (e.g., "8pc section" vs "10pc section" as sub-groups)? | Out of scope for this build. Current flat option list per step is sufficient. |
| Q2 | **Modifier take rates:** Should the avg cost calculation use equal weighting, or should real sales-data take rates per option be supported for more accurate COGS? | Out of scope. Equal weighting used throughout this phase. |
| Q3 | **Import template — combos and modifier groups:** Should the import wizard support combos and modifier groups via spreadsheet upload? | Out of scope for Phase 5. Add to backlog. Manual items can be added to the import template in Phase 5 (simpler). |
| Q4 | **POS export:** Once this data model is stable, a JSON export endpoint for till system integration would be a natural next step. | Separate feature — add to backlog after Phase 5 ships. |

### 16.2 Future Scope (backlog items)

**Modifier group versioning**
If a modifier group changes after it is assigned to menu items (e.g., a new option is added or a price_addon changes), the change takes effect immediately across all assigned items. There is currently no historical snapshot of modifier group state at the time a menu was costed. Future: consider a versioning or "locked" snapshot mechanism if historical COGS accuracy is required for audit purposes.

**Per-country modifier group overrides**
Modifier groups are currently global — the same options and price_addons apply regardless of which country's menu the group is assigned to. Future: a `mcogs_modifier_group_country_overrides` table could allow per-country price_addon overrides or option exclusions (e.g., a flavour not available in a particular market).

**Combo sales mix weighting**
Currently the average cost across combo step options uses equal weighting. Future: an operator could input actual sales mix percentages per option within a combo step (similar to the Menu Engineer mix management), resulting in a weighted average COGS rather than a simple average.

**Modifier group analytics**
The dashboard and reports currently have no visibility into modifier group performance. Future: a modifier group analytics view showing which groups are most used, which options are most commonly selected (if POS data is connected), and the COGS impact of modifier group assignments across the menu estate.

**Allergen declaration export**
Once modifier and combo allergen data is aggregated in the matrix, a structured allergen declaration export (PDF or structured JSON) for regulatory compliance would be a natural follow-on. This would include conditional allergen disclosures (e.g., "contains sesame when served with Korean BBQ flavour").

**Import template extensions (post-Phase 5)**
- Manual items column in Menus/Menu Items sheets
- New "Combos" sheet: combo_name, country, step_name, step_order, min_select, max_select, option_name, option_type, price_addon
- New "Modifier Groups" sheet: group_name, min_select, max_select, option_name, option_type, price_addon

---

*Document created: March 2026. Author: product planning session. For implementation questions, refer to [CLAUDE.md](../CLAUDE.md) for codebase conventions, DB migration patterns, and API route registration procedures.*
