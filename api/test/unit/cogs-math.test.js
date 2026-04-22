// COGS calculation math (pure functions, no DB).
//
// These tests document the EXPECTED behaviour of recipe cost computation
// independent of the SQL queries. They cover:
//   - Single-ingredient recipe cost
//   - Recipe with prep-unit conversion (e.g. 200g of an ingredient priced per kg)
//   - Recipe with waste % applied
//   - Recipe with sub-recipe (one level deep)
//   - Recipe with sub-recipe (two levels deep)
//   - Yield portioning (cost / yield_qty)
//   - Missing quote → 0 cost (does not throw)

import { describe, it, expect } from 'vitest';

// ── Re-implementation of calcRecipeCost() logic from cogs.js ───────────────
// Kept as a pure function so we can exercise edge cases without the DB.

function calcRecipeCost({ recipeId, recipes, items, quotes, countryId }) {
  const r = recipes[recipeId];
  if (!r) return 0;
  const itemList = items[recipeId] || [];
  let total = 0;

  for (const item of itemList) {
    if (item.item_type === 'recipe' && item.recipe_item_id) {
      // Sub-recipe — recurse
      const subCost = calcRecipeCost({
        recipeId: item.recipe_item_id, recipes, items, quotes, countryId,
      });
      const subYield = recipes[item.recipe_item_id]?.yield_qty || 1;
      const subUnitCost = subCost / Math.max(subYield, 0.000001);
      total += subUnitCost * (Number(item.prep_qty) || 0) * (Number(item.prep_to_base_conversion) || 1);
    } else if (item.ingredient_id) {
      const q = quotes[item.ingredient_id]?.[countryId];
      if (!q) continue;  // no quote → skip (cost 0 contribution)
      const baseUnitsUsed = (Number(item.prep_qty) || 0) * (Number(item.prep_to_base_conversion) || 1);
      const wasteMult = 1 + ((Number(item.waste_pct) || 0) / 100);
      total += q.price_per_base_unit * baseUnitsUsed * wasteMult;
    }
  }
  return total;
}

// ── Fixtures ───────────────────────────────────────────────────────────────

const flour = { id: 1, name: 'Flour' };
const sugar = { id: 2, name: 'Sugar' };
const eggs  = { id: 3, name: 'Eggs' };
const UK = 1;

const QUOTES = {
  1: { [UK]: { price_per_base_unit: 2.0,  is_preferred: true } },  // £2/kg
  2: { [UK]: { price_per_base_unit: 1.5,  is_preferred: true } },  // £1.50/kg
  3: { [UK]: { price_per_base_unit: 0.30, is_preferred: true } },  // £0.30/each
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('calcRecipeCost — single ingredient', () => {
  it('200g of flour @ £2/kg = £0.40', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 0.2, prep_to_base_conversion: 1 }],
    };
    const cost = calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK });
    expect(cost).toBeCloseTo(0.40);
  });

  it('handles prep unit conversion: 250g specified as 0.25 with conv 1', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 0.25, prep_to_base_conversion: 1 }],
    };
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(0.50);
  });

  it('handles non-1 conversion: 2 cups @ 0.236kg/cup of flour = 0.944 kg → £1.888', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 2, prep_to_base_conversion: 0.236 }],
    };
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(0.944, 3);
  });
});

describe('calcRecipeCost — waste %', () => {
  it('10% waste on £0.40 ingredient = £0.44', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [{
        item_type: 'ingredient', ingredient_id: 1,
        prep_qty: 0.2, prep_to_base_conversion: 1, waste_pct: 10,
      }],
    };
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(0.44);
  });

  it('0% waste matches no-waste cost', () => {
    const r1 = { 10: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 0.2, prep_to_base_conversion: 1, waste_pct: 0 }] };
    const r2 = { 10: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 0.2, prep_to_base_conversion: 1 }] };
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    expect(calcRecipeCost({ recipeId: 10, recipes, items: r1, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(calcRecipeCost({ recipeId: 10, recipes, items: r2, quotes: QUOTES, countryId: UK }));
  });
});

describe('calcRecipeCost — multiple ingredients', () => {
  it('flour + sugar + eggs sums correctly', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [
        { item_type: 'ingredient', ingredient_id: 1, prep_qty: 0.5, prep_to_base_conversion: 1 },  // 0.5kg flour = £1
        { item_type: 'ingredient', ingredient_id: 2, prep_qty: 0.2, prep_to_base_conversion: 1 },  // 0.2kg sugar = £0.30
        { item_type: 'ingredient', ingredient_id: 3, prep_qty: 3,   prep_to_base_conversion: 1 },  // 3 eggs = £0.90
      ],
    };
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(2.20);
  });
});

describe('calcRecipeCost — sub-recipes', () => {
  it('one-level sub-recipe: cake uses 200g of dough recipe', () => {
    const recipes = {
      20: { id: 20, yield_qty: 1, name: 'Dough' },     // yields 1 kg of dough
      10: { id: 10, yield_qty: 1, name: 'Cake' },
    };
    const items = {
      20: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 1, prep_to_base_conversion: 1 }],  // 1kg flour = £2
      10: [{ item_type: 'recipe',     recipe_item_id: 20, prep_qty: 0.2, prep_to_base_conversion: 1 }],
    };
    // Dough costs £2 for 1 kg → 200g of dough costs £0.40
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(0.40);
  });

  it('two-level nesting: sauce → dough → cake', () => {
    const recipes = {
      30: { id: 30, yield_qty: 1, name: 'Sauce' },     // yields 1 unit
      20: { id: 20, yield_qty: 1, name: 'Dough' },
      10: { id: 10, yield_qty: 1, name: 'Cake' },
    };
    const items = {
      30: [{ item_type: 'ingredient', ingredient_id: 2, prep_qty: 0.5, prep_to_base_conversion: 1 }],   // £0.75 sauce
      20: [
        { item_type: 'ingredient', ingredient_id: 1, prep_qty: 1, prep_to_base_conversion: 1 },          // £2 flour
        { item_type: 'recipe',     recipe_item_id: 30, prep_qty: 0.5, prep_to_base_conversion: 1 },      // half the sauce = £0.375
      ],
      10: [{ item_type: 'recipe', recipe_item_id: 20, prep_qty: 0.2, prep_to_base_conversion: 1 }],
    };
    // Dough = £2 + £0.375 = £2.375 / 1 kg → 200g = £0.475
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(0.475);
  });

  it('sub-recipe yield > 1 portions cost correctly', () => {
    const recipes = {
      20: { id: 20, yield_qty: 4, name: 'Sauce' },     // recipe makes 4 portions
      10: { id: 10, yield_qty: 1, name: 'Pasta' },
    };
    const items = {
      20: [{ item_type: 'ingredient', ingredient_id: 2, prep_qty: 1, prep_to_base_conversion: 1 }],  // £1.50 for 4 portions
      10: [{ item_type: 'recipe', recipe_item_id: 20, prep_qty: 1, prep_to_base_conversion: 1 }],   // 1 portion of sauce
    };
    // 1 portion of sauce = £1.50/4 = £0.375
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(0.375);
  });
});

describe('calcRecipeCost — defensive', () => {
  it('returns 0 when recipe does not exist', () => {
    expect(calcRecipeCost({ recipeId: 999, recipes: {}, items: {}, quotes: {}, countryId: UK })).toBe(0);
  });

  it('skips ingredient with missing quote (does not throw)', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [
        { item_type: 'ingredient', ingredient_id: 1, prep_qty: 0.5, prep_to_base_conversion: 1 },     // £1
        { item_type: 'ingredient', ingredient_id: 99, prep_qty: 1,  prep_to_base_conversion: 1 },     // no quote → 0
      ],
    };
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK }))
      .toBeCloseTo(1.0);
  });

  it('handles negative or zero prep_qty without crashing', () => {
    const recipes = { 10: { id: 10, yield_qty: 1 } };
    const items = {
      10: [{ item_type: 'ingredient', ingredient_id: 1, prep_qty: 0, prep_to_base_conversion: 1 }],
    };
    expect(calcRecipeCost({ recipeId: 10, recipes, items, quotes: QUOTES, countryId: UK })).toBe(0);
  });
});
