# Recipe Screen Optimization

## Overview

Analysis of the Recipe Builder screen (Recipes page) identified significant UI crowding and inefficient variant workflows. This document outlines UX improvements to reduce visual clutter and streamline the recipe editing experience.

**Status:** Feature recommendation  
**Requested by:** Pepper AI analysis  
**Last updated:** 2026-04-24

---

## Current State Problems

### 1. Crowded Header Section
**Issue:** Four dropdowns/toggles squeezed into one row:
- Market selector
- Price Level dropdown
- Display Currency toggle
- Market Currency toggle

**Result:** Visually overwhelming, unclear hierarchy, difficult to parse.

### 2. Confusing Tab Navigation
**Issue:** Five tabs crammed together:
- Ingredients (active view)
- Global (variant view)
- Price Level (variant view)
- Market-PL (variant view)
- Two emoji badges (🔒 + 🍽️) — unclear purpose

**Result:** Users don't understand variant workflow. Tabs vs. buttons inconsistency.

### 3. Fragmented Variant Management
**Issue:** Variants scattered across three separate places:
- "Market" dropdown selector (top)
- "Price Level" dropdown selector (top)
- "+ Create Variation" button (top-right)
- Three tabs at bottom (Global, Price Level, Market-PL)

**Result:** No clear mental model. Users don't know how to create/switch variants. Button placement is unclear.

### 4. Scattered Button Placement
**Issue:** Action buttons distributed across header:
- "+ Create Variation" (top)
- "+ Add Ingredient" (top, next to tabs)
- "Edit" button (top-right)
- "Delete" button (top-right)

**Result:** Unprofessional layout. No clear primary action.

### 5. Hidden Quote Coverage
**Issue:** "✓ Fully Quoted" badge floats in pricing card, not visible in ingredients table.

**Result:** Users can't see at a glance which ingredients have price quotes.

---

## Recommended Changes

### **1. Restructure Header (40% Clutter Reduction)**

**Remove:** Display Currency and Market Currency toggles from recipe header.

**Why:** 
- These are global user preferences, not recipe-specific
- Should live in Settings → Currency Preferences (or a collapsed card in the recipe)
- Takes up 20% of header real estate

**New header layout:**
```
┌──────────────────────────────────────────────────────────────┐
│ House Fries (Regular) · 1.0000 portion                        │
│                                                   🇮🇳 India    │
└──────────────────────────────────────────────────────────────┘
```

Market selector moves to the right (primary context signal). Everything else is below.

---

### **2. Consolidate Variants into Single Card**

**Replace:** Market dropdown + Price Level dropdown + "+ Create Variation" button + 3 tabs

**With:** Single "Variants" collapsible card showing:
- **Clickable variant pills** (not tabs):
  - `[Global]` — global recipe (no market/level scope)
  - `[🇮🇳 India]` — market-specific variant
  - `[Promo Lv]` — price-level-specific variant
  - `[🇮🇳 + Promo Lv]` — market + price-level combined variant
- **"+ Add Variant"** button (single, not multiple)
- **"Edit/Delete"** icons per pill (right-click menu or hover)

**Layout:**
```
┌─ Variants [▼ Collapse] ───────────────────────────────────┐
│ Current: [Global] ✓                                        │
│ Available: [🇮🇳 India] [Promo Lv] [🇮🇳 + Promo Lv]         │
│ + Add Variant                                              │
└──────────────────────────────────────────────────────────┘
```

**Benefits:**
- Variants are now grouped in one semantic block
- Pills are clearer than tabs (visual affordance)
- Single "+" button instead of scattered UI
- Scrollable pill list if many variants exist

---

### **3. Simplify Tab Bar**

**Current:** Ingredients | Global | Price Level | Market-PL | 🔒 | 🍽️

**New:** Remove all tabs except "Ingredients" (or rename to "Recipe Items")

**Why:** 
- Variant switching is now in the pills above (section 2)
- Global/Price Level/Market-PL views are redundant once you've selected the variant pill
- Emojis are unexplained noise

---

### **4. Professional Button Toolbar**

**Replace:** Scattered "+ Create Variation", "+ Add Ingredient", "Edit", "Delete" buttons

**With:** Top-right toolbar:
```
┌────────────────────────────────────────────────────┐
│  Recipe name + yield   [+ Add Ingredient]  [⋮ More]  │
└────────────────────────────────────────────────────┘
```

**"+ Add Ingredient"** = Primary button (most common action)  
**"⋮ More" menu** includes:
- Edit recipe header
- Duplicate recipe
- Delete recipe
- Export as CSV
- View linked sales items

**Benefits:**
- Clear primary action (add ingredient)
- Destructive actions (delete) grouped in menu, not one-click
- Professional toolbar pattern

---

### **5. Add Quote Coverage Column to Table**

**Current:** Quote coverage badge floats in the pricing card.

**New:** Add a "Coverage" column to the ingredients table:

```
┌─ Recipe Items ────────────────────────────────────────────┐
│ INGREDIENT │ QTY │ CONVERSION │ COST (INR) │ COVERAGE     │
├────────────┼─────┼────────────┼────────────┼──────────────┤
│ French ... │ 138 │ 0.130 kg   │ ₹13.30     │ ✓            │
│ Fry seas.. │ 1.3 │ 0.001 kg   │ ₹0.43      │ ✓            │
│ Boat L     │ 1.0 │ 1.000 ea   │ ₹1.09      │ ✓            │
│ Liner ..   │ 1.0 │ 1.000 ea   │ ₹1.00      │ ⚠ (warning) │
├────────────┴─────┴────────────┼────────────┤              │
│ Total                         │ ₹17.82     │ ✓            │
└───────────────────────────────┴────────────┴──────────────┘
```

**Column values:**
- `✓` = Preferred vendor quote exists in current market
- `⚠` = Only active quotes (no preferred vendor set)
- `✗` = No quotes at all (cost = unknown)

**Benefits:**
- Visibility at a glance
- Users can spot pricing gaps before saving
- Actionable (click the cell to add quote)

---

### **6. Move Currency Preferences**

**Current:** Display Currency / Market Currency toggles in recipe header

**New:** Move to collapsible "Display Options" card (or Settings → Currency Preferences)

```
┌─ Display Options [▼] ─────────────────────────────┐
│ ☐ Show prices in market currency (₹)              │
│ ☐ Show prices in USD base                         │
│ ☐ Hide conversion factors (simplified view)       │
└───────────────────────────────────────────────────┘
```

**Benefits:**
- Frees up header real estate
- Global setting (applies to all recipes, not per-recipe)
- Optional collapse saves space

---

## Restructured Layout (Mockup)

```
╔════════════════════════════════════════════════════════════╗
║ House Fries (Regular) · 1.0000 portion            🇮🇳 India ║
╚════════════════════════════════════════════════════════════╝

╭─ Pricing ────────────────────────────────────────────────╮
│ Per Portion: ₹17.82  │  Total Cost: ₹17.82  │ Not on menu │
╰──────────────────────────────────────────────────────────╯

╭─ Variants [▼ Collapse] ──────────────────────────────────╮
│ Current: [Global] ✓                                      │
│ Available: [🇮🇳 India] [Promo Lv] [🇮🇳 + Promo Lv]      │
│ + Add Variant                                            │
╰──────────────────────────────────────────────────────────╯

╭─ Recipe Items ───────────────────────────────────────────╮
│ INGREDIENT │ QTY │ CONVERSION │ COST (INR) │ COVERAGE   │
├────────────┼─────┼────────────┼────────────┼────────────┤
│ French ... │ 138 │ 0.130 kg   │ ₹13.30     │ ✓          │
│ Fry seas.. │ 1.3 │ 0.001 kg   │ ₹0.43      │ ✓          │
│ Boat L     │ 1.0 │ 1.000 ea   │ ₹1.09      │ ✓          │
│ Liner ..   │ 1.0 │ 1.000 ea   │ ₹1.00      │ ✓          │
├────────────┴─────┴────────────┼────────────┴────────────┤
│ Total                         │ ₹17.82                   │
├───────────────────────────────┴──────────────────────────┤
│ [+ Add Ingredient] [⋮ More]                              │
╰──────────────────────────────────────────────────────────╯

╭─ Sales Links ────────────────────────────────────────────╮
│ • House Fries (Regular) · Recipe                         │
╰──────────────────────────────────────────────────────────╯

╭─ Display Options [▼] ─────────────────────────────────────╮
│ ☐ Show prices in market currency (₹)                    │
│ ☐ Show prices in USD base                               │
╰──────────────────────────────────────────────────────────╯
```

---

## Implementation Notes

### Phase 1 (Foundation)
1. Remove Display Currency / Market Currency toggles from header
2. Add Quote Coverage column to ingredients table
3. Consolidate variant dropdowns + button into pills

### Phase 2 (UI Refinement)
4. Replace tabs with variant pills (full interaction)
5. Create collapsible Display Options card
6. Implement top-right toolbar pattern

### Phase 3 (Polish)
7. Add variant edit/delete context menus
8. Add quick-add quote flow (clicking ⚠ or ✗ in Coverage column)
9. Keyboard shortcuts for common actions (e.g., Cmd+K to add ingredient)

---

## Impact Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Header dropdowns/toggles | 4 | 1 | -75% |
| Tab clutter | 5 tabs + 2 badges | 1 card + pills | 70% reduction |
| Primary action clarity | Scattered buttons | Single "+Add" button | Clearer |
| Variant discoverability | Hidden in tabs | Visible pills | Much better |
| Quote coverage visibility | In pricing card only | In table column | 100% visible |
| Overall visual density | High | Medium | 40% less crowded |

---

## Backwards Compatibility

- **Market selector:** Still present (top-right), just cleaner
- **Price Level:** Now accessed via variant pills (no breaking change)
- **Ingredients table:** New column added, no data changes
- **Recipe costing:** No changes to calculation logic
- **Variant storage:** No schema changes, just UI reorganization

---

## Open Questions

1. Should "Global" variant always be first in the pills, or sorted by recency?
2. Should "+ Add Variant" show a modal or inline form?
3. Is the "⋮ More" menu (Edit, Delete, Duplicate, Export) the right approach, or should some of these be moved elsewhere?
4. Should Display Options be collapsible or moved to Settings entirely?
5. Should quote coverage clicking open the price quote form, or navigate to Inventory?

---

## References

- **Related improvements:** BACK-1928 (unified ingredient flow), BACK-1929 (keyboard shortcuts for add ingredient)
- **Issue tracker:** Logged as design recommendation
- **User feedback:** Screen analysis from Pepper AI, India market setup flow

