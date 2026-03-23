'use strict';
// =============================================================================
// seed-defaults.js
// Loads a minimal, production-ready default dataset.
//
// What it creates (in FK order):
//   Units          — Kilogram, Litre, Each
//   Price Levels   — Default (is_default = true)
//   Categories     — Food / Beverage / Other × ingredient + recipe
//   Country        — United Kingdom (GBP, exchange_rate ≈ 0.79 vs USD base)
//   Tax Rates      — Standard VAT 20% (default), Reduced VAT 5%, Zero Rate 0%
//   Country Tax    — Default price level → Standard VAT 20%
//   Brand Partner  — Default Brand
//   Vendor         — Default Vendor (linked to UK)
//   Location Group — Default
//   Location       — Default Location (linked to UK + Default group)
//
// No recipes, recipe items, or price quotes are created.
//
// Most tables have no UNIQUE constraints, so each row is guarded with
// "INSERT ... WHERE NOT EXISTS" to remain idempotent on repeated runs.
// =============================================================================

// Helper: insert a row only if no row with the given name already exists in the table.
// Returns the id (existing or newly inserted).
async function upsertByName(client, table, name, extraCols = {}, nameCol = 'name') {
  const existing = await client.query(
    `SELECT id FROM ${table} WHERE ${nameCol} = $1 LIMIT 1`, [name]
  );
  if (existing.rows.length) return existing.rows[0].id;

  const cols   = [nameCol, ...Object.keys(extraCols)];
  const vals   = [name,    ...Object.values(extraCols)];
  const nums   = vals.map((_, i) => `$${i + 1}`);
  const result = await client.query(
    `INSERT INTO ${table} (${cols.join(',')}) VALUES (${nums.join(',')}) RETURNING id`,
    vals
  );
  return result.rows[0].id;
}

async function seedDefaults(client, push) {
  const summary = {};

  // ── 1. Units ────────────────────────────────────────────────────────────────
  push('Creating units…');
  const unitDefs = [
    { name: 'Kilogram', abbreviation: 'kg', type: 'weight' },
    { name: 'Litre',    abbreviation: 'L',  type: 'volume' },
    { name: 'Each',     abbreviation: 'ea', type: 'count'  },
  ];
  let unitCount = 0;
  for (const u of unitDefs) {
    const exists = await client.query(
      `SELECT id FROM mcogs_units WHERE name = $1 LIMIT 1`, [u.name]
    );
    if (!exists.rows.length) {
      await client.query(
        `INSERT INTO mcogs_units (name, abbreviation, type) VALUES ($1,$2,$3)`,
        [u.name, u.abbreviation, u.type]
      );
      unitCount++;
    }
  }
  summary.units = unitCount;
  push(`  ✓ ${unitCount} new unit(s) created (Kilogram, Litre, Each)`);

  // ── 2. Price Levels ─────────────────────────────────────────────────────────
  push('Creating price level…');
  let defaultPriceLevelId;
  const existingPl = await client.query(
    `SELECT id FROM mcogs_price_levels WHERE name = 'Default' LIMIT 1`
  );
  if (existingPl.rows.length) {
    defaultPriceLevelId = existingPl.rows[0].id;
    // Make sure it is flagged as default
    await client.query(
      `UPDATE mcogs_price_levels SET is_default = true WHERE id = $1`,
      [defaultPriceLevelId]
    );
    push(`  ✓ Price level "Default" already exists (id ${defaultPriceLevelId}) — marked as default`);
    summary.price_levels = 0;
  } else {
    // Clear any existing default flag so ours is the only one
    await client.query(`UPDATE mcogs_price_levels SET is_default = false`);
    const pl = await client.query(
      `INSERT INTO mcogs_price_levels (name, description, is_default)
       VALUES ('Default','Standard price level', true) RETURNING id`
    );
    defaultPriceLevelId = pl.rows[0].id;
    summary.price_levels = 1;
    push(`  ✓ Price level "Default" created (id ${defaultPriceLevelId})`);
  }

  // ── 3. Categories ────────────────────────────────────────────────────────────
  push('Creating categories…');
  const catDefs = [
    ['Food',     'ingredient', 1],
    ['Beverage', 'ingredient', 2],
    ['Other',    'ingredient', 3],
    ['Food',     'recipe',     1],
    ['Beverage', 'recipe',     2],
    ['Other',    'recipe',     3],
  ];
  let catCount = 0;
  for (const [name, type, sort_order] of catDefs) {
    const exists = await client.query(
      `SELECT id FROM mcogs_categories WHERE name = $1 AND type = $2 LIMIT 1`, [name, type]
    );
    if (!exists.rows.length) {
      await client.query(
        `INSERT INTO mcogs_categories (name, type, group_name, sort_order)
         VALUES ($1,$2,$3,$4)`,
        [name, type, name, sort_order]
      );
      catCount++;
    }
  }
  summary.categories = catCount;
  push(`  ✓ ${catCount} new category row(s) created`);

  // ── 4. Country — United Kingdom ─────────────────────────────────────────────
  push('Creating United Kingdom market…');
  // exchange_rate: GBP vs USD base — Frankfurter returns ~0.79 (1 USD = 0.79 GBP)
  let ukId;
  const existingUk = await client.query(
    `SELECT id FROM mcogs_countries WHERE name = 'United Kingdom' LIMIT 1`
  );
  if (existingUk.rows.length) {
    ukId = existingUk.rows[0].id;
    await client.query(
      `UPDATE mcogs_countries
       SET currency_code='GBP', currency_symbol='£', exchange_rate=0.79,
           default_price_level_id=$1, country_iso='GB'
       WHERE id=$2`,
      [defaultPriceLevelId, ukId]
    );
    push(`  ✓ Country "United Kingdom" already exists — updated (id ${ukId})`);
    summary.markets = 0;
  } else {
    const uk = await client.query(
      `INSERT INTO mcogs_countries
         (name, currency_code, currency_symbol, exchange_rate, default_price_level_id, country_iso)
       VALUES ('United Kingdom','GBP','£',0.79,$1,'GB') RETURNING id`,
      [defaultPriceLevelId]
    );
    ukId = uk.rows[0].id;
    summary.markets = 1;
    push(`  ✓ Country "United Kingdom" created (id ${ukId})`);
  }

  // ── 5. UK Tax Rates ──────────────────────────────────────────────────────────
  push('Creating UK tax rates…');
  // Remove any stale tax rates for UK so we get a clean set
  await client.query(
    `DELETE FROM mcogs_country_tax_rates WHERE country_id = $1`, [ukId]
  );
  const taxResult = await client.query(
    `INSERT INTO mcogs_country_tax_rates (country_id, name, rate, is_default) VALUES
       ($1, 'Standard VAT',  20.00, true),
       ($1, 'Reduced VAT',    5.00, false),
       ($1, 'Zero Rate',      0.00, false)
     RETURNING id, name`,
    [ukId]
  );
  const standardVatId = taxResult.rows.find(r => r.name === 'Standard VAT').id;
  summary.tax_rates = 3;
  push(`  ✓ 3 tax rates created — Standard 20% (id ${standardVatId}), Reduced 5%, Zero 0%`);

  // ── 6. Allocate Standard VAT → Default price level (unique constraint exists) ─
  push('Allocating Standard VAT 20% to Default price level…');
  await client.query(
    `INSERT INTO mcogs_country_level_tax (country_id, price_level_id, tax_rate_id)
     VALUES ($1,$2,$3)
     ON CONFLICT (country_id, price_level_id) DO UPDATE SET tax_rate_id = EXCLUDED.tax_rate_id`,
    [ukId, defaultPriceLevelId, standardVatId]
  );
  push('  ✓ Standard VAT 20% → Default price level');

  // ── 7. Brand Partner ─────────────────────────────────────────────────────────
  push('Creating default brand partner…');
  const existingBrand = await client.query(
    `SELECT id FROM mcogs_brand_partners WHERE name = 'Default Brand' LIMIT 1`
  );
  if (!existingBrand.rows.length) {
    await client.query(
      `INSERT INTO mcogs_brand_partners (name) VALUES ('Default Brand')`
    );
    summary.brand_partners = 1;
    push('  ✓ Brand partner "Default Brand" created');
  } else {
    summary.brand_partners = 0;
    push('  ✓ Brand partner "Default Brand" already exists — skipped');
  }

  // ── 8. Vendor ────────────────────────────────────────────────────────────────
  push('Creating default vendor…');
  const existingVendor = await client.query(
    `SELECT id FROM mcogs_vendors WHERE name = 'Default Vendor' LIMIT 1`
  );
  if (!existingVendor.rows.length) {
    await client.query(
      `INSERT INTO mcogs_vendors (name, country_id) VALUES ('Default Vendor', $1)`, [ukId]
    );
    summary.vendors = 1;
    push('  ✓ Vendor "Default Vendor" created');
  } else {
    summary.vendors = 0;
    push('  ✓ Vendor "Default Vendor" already exists — skipped');
  }

  // ── 9. Location Group ────────────────────────────────────────────────────────
  push('Creating default location group…');
  let locationGroupId;
  const existingGroup = await client.query(
    `SELECT id FROM mcogs_location_groups WHERE name = 'Default' LIMIT 1`
  );
  if (existingGroup.rows.length) {
    locationGroupId = existingGroup.rows[0].id;
    push(`  ✓ Location group "Default" already exists (id ${locationGroupId}) — skipped`);
    summary.location_groups = 0;
  } else {
    const grp = await client.query(
      `INSERT INTO mcogs_location_groups (name, description)
       VALUES ('Default','Default location group') RETURNING id`
    );
    locationGroupId = grp.rows[0].id;
    summary.location_groups = 1;
    push(`  ✓ Location group "Default" created (id ${locationGroupId})`);
  }

  // ── 10. Location ─────────────────────────────────────────────────────────────
  push('Creating default location…');
  const existingLoc = await client.query(
    `SELECT id FROM mcogs_locations WHERE name = 'Default Location' LIMIT 1`
  );
  if (!existingLoc.rows.length) {
    await client.query(
      `INSERT INTO mcogs_locations (name, country_id, group_id, is_active)
       VALUES ('Default Location', $1, $2, true)`,
      [ukId, locationGroupId]
    );
    summary.locations = 1;
    push('  ✓ Location "Default Location" created');
  } else {
    summary.locations = 0;
    push('  ✓ Location "Default Location" already exists — skipped');
  }

  push('');
  push('✅ Default data loaded successfully.');
  return summary;
}

module.exports = { seedDefaults };
