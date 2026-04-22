// Test data factories.
//
// Each factory takes an active pg client (from withTx) and an overrides
// object, inserts a row, and returns the inserted row. They are designed
// to chain — use makeRecipe() and it will create the category + units it needs.
//
// USAGE:
//   await withTx(async (c) => {
//     const ing = await makeIngredient(c, { name: 'Test Flour' });
//     const r   = await makeRecipe(c, { name: 'Test Bread', items: [{ ingredient_id: ing.id, prep_qty: 0.5 }] });
//     // ...assertions
//   });
//
// Naming convention: every factory-created row ends with '__test' to make
// stray records (if rollback fails) easy to spot in dev DBs.

let _suffix = 0;
const tag = () => `__test_${Date.now()}_${++_suffix}`;

async function makeUnit(c, overrides = {}) {
  const r = await c.query(
    `INSERT INTO mcogs_units (name, abbreviation, type)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [
      overrides.name         || `unit${tag()}`,
      overrides.abbreviation || 'kg',
      overrides.type         || 'mass',
    ]
  );
  return r.rows[0];
}

async function makePriceLevel(c, overrides = {}) {
  const r = await c.query(
    `INSERT INTO mcogs_price_levels (name, is_default)
     VALUES ($1, $2)
     RETURNING *`,
    [overrides.name || `Dine In${tag()}`, overrides.is_default ?? true]
  );
  return r.rows[0];
}

async function makeCountry(c, overrides = {}) {
  const r = await c.query(
    `INSERT INTO mcogs_countries (name, currency_code, currency_symbol, exchange_rate, default_price_level_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      overrides.name              || `UK${tag()}`,
      overrides.currency_code     || 'GBP',
      overrides.currency_symbol   || '£',
      overrides.exchange_rate     ?? 0.79,
      overrides.default_price_level_id ?? null,
    ]
  );
  return r.rows[0];
}

async function makeCategory(c, overrides = {}) {
  const r = await c.query(
    `INSERT INTO mcogs_categories
       (name, for_ingredients, for_recipes, for_sales_items)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      overrides.name            || `Cat${tag()}`,
      overrides.for_ingredients ?? true,
      overrides.for_recipes     ?? false,
      overrides.for_sales_items ?? false,
    ]
  );
  return r.rows[0];
}

async function makeVendor(c, overrides = {}) {
  const country_id = overrides.country_id ?? (await makeCountry(c)).id;
  const r = await c.query(
    `INSERT INTO mcogs_vendors (name, country_id) VALUES ($1, $2) RETURNING *`,
    [overrides.name || `Vendor${tag()}`, country_id]
  );
  return r.rows[0];
}

async function makeIngredient(c, overrides = {}) {
  const base_unit_id = overrides.base_unit_id ?? (await makeUnit(c)).id;
  const category_id  = overrides.category_id  ?? (await makeCategory(c, { for_ingredients: true })).id;
  const r = await c.query(
    `INSERT INTO mcogs_ingredients
       (name, base_unit_id, category_id, waste_pct, default_prep_unit, default_prep_to_base_conversion)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      overrides.name      || `Ing${tag()}`,
      base_unit_id,
      category_id,
      overrides.waste_pct ?? 0,
      overrides.default_prep_unit                   || 'kg',
      overrides.default_prep_to_base_conversion     ?? 1,
    ]
  );
  return r.rows[0];
}

async function makePriceQuote(c, overrides = {}) {
  if (!overrides.ingredient_id) throw new Error('makePriceQuote: ingredient_id required');
  if (!overrides.vendor_id)     throw new Error('makePriceQuote: vendor_id required');
  const r = await c.query(
    `INSERT INTO mcogs_price_quotes
       (ingredient_id, vendor_id, purchase_price, qty_in_base_units, purchase_unit, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      overrides.ingredient_id,
      overrides.vendor_id,
      overrides.purchase_price    ?? 5.00,
      overrides.qty_in_base_units ?? 1.00,
      overrides.purchase_unit     || 'kg',
      overrides.is_active         ?? true,
    ]
  );
  return r.rows[0];
}

async function setPreferredVendor(c, { ingredient_id, country_id, quote_id, vendor_id }) {
  // `vendor_id` is NOT NULL on mcogs_ingredient_preferred_vendor. Derive it from
  // the quote when not supplied so call-sites stay terse.
  if (!vendor_id) {
    const { rows } = await c.query(
      `SELECT vendor_id FROM mcogs_price_quotes WHERE id = $1`,
      [quote_id]
    );
    if (!rows[0]?.vendor_id) {
      throw new Error(`setPreferredVendor: quote ${quote_id} not found or missing vendor_id`);
    }
    vendor_id = rows[0].vendor_id;
  }
  const r = await c.query(
    `INSERT INTO mcogs_ingredient_preferred_vendor (ingredient_id, country_id, vendor_id, quote_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ingredient_id, country_id)
     DO UPDATE SET vendor_id = EXCLUDED.vendor_id, quote_id = EXCLUDED.quote_id
     RETURNING *`,
    [ingredient_id, country_id, vendor_id, quote_id]
  );
  return r.rows[0];
}

async function makeRecipe(c, overrides = {}) {
  const category_id = overrides.category_id ?? (await makeCategory(c, { for_recipes: true })).id;
  const yield_unit_id = overrides.yield_unit_id ?? (await makeUnit(c, { abbreviation: 'each', is_base: true, type: 'count' })).id;
  const r = await c.query(
    `INSERT INTO mcogs_recipes (name, category_id, yield_qty, yield_unit_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      overrides.name      || `Recipe${tag()}`,
      category_id,
      overrides.yield_qty ?? 1,
      yield_unit_id,
    ]
  );

  // Optional inline items
  if (Array.isArray(overrides.items)) {
    for (const item of overrides.items) {
      await c.query(
        `INSERT INTO mcogs_recipe_items
           (recipe_id, item_type, ingredient_id, recipe_item_id, prep_qty, prep_unit, prep_to_base_conversion)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          r.rows[0].id,
          item.item_type || (item.recipe_item_id ? 'recipe' : 'ingredient'),
          item.ingredient_id || null,
          item.recipe_item_id || null,
          item.prep_qty ?? 1,
          item.prep_unit || 'kg',
          item.prep_to_base_conversion ?? 1,
        ]
      );
    }
  }
  return r.rows[0];
}

async function makeMenu(c, overrides = {}) {
  const country_id = overrides.country_id ?? (await makeCountry(c)).id;
  const r = await c.query(
    `INSERT INTO mcogs_menus (name, country_id, description)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [overrides.name || `Menu${tag()}`, country_id, overrides.description || null]
  );
  return r.rows[0];
}

async function makeSalesItem(c, overrides = {}) {
  const r = await c.query(
    `INSERT INTO mcogs_sales_items
       (item_type, name, display_name, recipe_id, ingredient_id, manual_cost, category_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      overrides.item_type    || 'recipe',
      overrides.name         || `Item${tag()}`,
      overrides.display_name || null,
      overrides.recipe_id    ?? null,
      overrides.ingredient_id ?? null,
      overrides.manual_cost  ?? null,
      overrides.category_id  ?? null,
    ]
  );
  return r.rows[0];
}

async function makeStore(c, overrides = {}) {
  if (!overrides.location_id) throw new Error('makeStore: location_id required');
  const r = await c.query(
    `INSERT INTO mcogs_stores (location_id, name, is_store_itself)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [overrides.location_id, overrides.name || `Store${tag()}`, overrides.is_store_itself ?? false]
  );
  return r.rows[0];
}

async function makeLocation(c, overrides = {}) {
  const country_id = overrides.country_id ?? (await makeCountry(c)).id;
  const r = await c.query(
    `INSERT INTO mcogs_locations (name, country_id, is_active)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [overrides.name || `Loc${tag()}`, country_id, overrides.is_active ?? true]
  );
  return r.rows[0];
}

async function makeUser(c, overrides = {}) {
  const role_id = overrides.role_id ?? null;
  const r = await c.query(
    `INSERT INTO mcogs_users
       (auth0_sub, email, name, role_id, status, is_dev)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      overrides.auth0_sub || `auth0|test_${tag()}`,
      overrides.email     || `test${tag()}@example.com`,
      overrides.name      || 'Test User',
      role_id,
      overrides.status    || 'active',
      overrides.is_dev    ?? false,
    ]
  );
  return r.rows[0];
}

module.exports = {
  makeUnit,
  makePriceLevel,
  makeCountry,
  makeCategory,
  makeVendor,
  makeIngredient,
  makePriceQuote,
  setPreferredVendor,
  makeRecipe,
  makeMenu,
  makeSalesItem,
  makeLocation,
  makeStore,
  makeUser,
};
