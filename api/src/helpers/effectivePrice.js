/**
 * Get the effective price per base unit for an ingredient in a country.
 * Priority: preferred vendor quote → lowest active quote → null
 */
async function getEffectivePrice(pool, ingredientId, countryId) {
  // 1. Try preferred vendor
  const { rows: pref } = await pool.query(`
    SELECT
      pq.purchase_price,
      pq.qty_in_base_units,
      pq.purchase_unit,
      v.id        as vendor_id,
      v.name      as vendor_name,
      c.currency_code,
      c.currency_symbol,
      ROUND(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0), 6) as price_per_base_unit,
      TRUE        as is_preferred
    FROM mcogs_ingredient_preferred_vendor ipv
    JOIN mcogs_price_quotes pq ON pq.id  = ipv.quote_id
    JOIN mcogs_vendors v       ON v.id   = pq.vendor_id
    JOIN mcogs_countries c     ON c.id   = v.country_id
    WHERE ipv.ingredient_id = $1
      AND ipv.country_id    = $2
      AND pq.is_active      = TRUE
    LIMIT 1
  `, [ingredientId, countryId])

  if (pref.length) return pref[0]

  // 2. Fall back to lowest active quote in country
  const { rows: lowest } = await pool.query(`
    SELECT
      pq.purchase_price,
      pq.qty_in_base_units,
      pq.purchase_unit,
      v.id        as vendor_id,
      v.name      as vendor_name,
      c.currency_code,
      c.currency_symbol,
      ROUND(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0), 6) as price_per_base_unit,
      FALSE       as is_preferred
    FROM mcogs_price_quotes pq
    JOIN mcogs_vendors v   ON v.id = pq.vendor_id
    JOIN mcogs_countries c ON c.id = v.country_id
    WHERE pq.ingredient_id = $1
      AND v.country_id     = $2
      AND pq.is_active     = TRUE
    ORDER BY price_per_base_unit ASC
    LIMIT 1
  `, [ingredientId, countryId])

  return lowest.length ? lowest[0] : null
}

/**
 * Get effective prices for ALL ingredients in a country in one shot.
 * Returns a map: { ingredientId -> effectivePriceRow }
 * Much more efficient than calling getEffectivePrice() in a loop.
 */
async function getEffectivePricesBulk(pool, countryId) {
  const { rows } = await pool.query(`
    WITH preferred AS (
      SELECT
        ipv.ingredient_id,
        pq.purchase_price,
        pq.qty_in_base_units,
        pq.purchase_unit,
        v.id    as vendor_id,
        v.name  as vendor_name,
        c.currency_code,
        c.currency_symbol,
        ROUND(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0), 6) as price_per_base_unit,
        TRUE    as is_preferred
      FROM mcogs_ingredient_preferred_vendor ipv
      JOIN mcogs_price_quotes pq ON pq.id  = ipv.quote_id
      JOIN mcogs_vendors v       ON v.id   = pq.vendor_id
      JOIN mcogs_countries c     ON c.id   = v.country_id
      WHERE ipv.country_id  = $1
        AND pq.is_active    = TRUE
    ),
    lowest AS (
      SELECT DISTINCT ON (pq.ingredient_id)
        pq.ingredient_id,
        pq.purchase_price,
        pq.qty_in_base_units,
        pq.purchase_unit,
        v.id    as vendor_id,
        v.name  as vendor_name,
        c.currency_code,
        c.currency_symbol,
        ROUND(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0), 6) as price_per_base_unit,
        FALSE   as is_preferred
      FROM mcogs_price_quotes pq
      JOIN mcogs_vendors v   ON v.id = pq.vendor_id
      JOIN mcogs_countries c ON c.id = v.country_id
      WHERE v.country_id  = $1
        AND pq.is_active  = TRUE
      ORDER BY pq.ingredient_id, price_per_base_unit ASC
    )
    SELECT * FROM preferred
    UNION ALL
    SELECT * FROM lowest
    WHERE ingredient_id NOT IN (SELECT ingredient_id FROM preferred)
  `, [countryId])

  // Return as a map for O(1) lookup
  return rows.reduce((acc, row) => {
    acc[row.ingredient_id] = row
    return acc
  }, {})
}

module.exports = { getEffectivePrice, getEffectivePricesBulk }
