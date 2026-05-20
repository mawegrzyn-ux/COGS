/**
 * Effective-price helper — mirrors api/src/routes/cogs.js loadQuoteLookup()
 * semantics so non-cogs routes (allergens, reports, etc.) see the same
 * costing picture.
 *
 * Costing method affects only the fallback path (when no preferred vendor
 * is set for an ingredient+country):
 *   - 'best'    : cheapest active quote (default)
 *   - 'average' : mean of all active quotes' price-per-base-unit
 *
 * When `method` isn't supplied, the setting is read from mcogs_settings.
 */

const COSTING_METHODS = ['best', 'average']

async function resolveCostingMethodFromSettings(pool) {
  try {
    const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`)
    const raw = rows[0]?.data?.costing_method
    if (COSTING_METHODS.includes(raw)) return raw
  } catch { /* settings row may not exist on first boot */ }
  return 'best'
}

/**
 * Get the effective price per base unit for an ingredient in a country.
 * Priority: preferred vendor quote → fallback (best or average) → null
 */
async function getEffectivePrice(pool, ingredientId, countryId, method) {
  if (!COSTING_METHODS.includes(method)) method = await resolveCostingMethodFromSettings(pool)

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

  // 2. Fallback — cheapest OR average across all active quotes in country
  if (method === 'average') {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::int                                                                 AS source_quote_count,
        ROUND(AVG(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0))::numeric, 6)   AS price_per_base_unit,
        FALSE                                                                         AS is_preferred,
        (SELECT currency_code   FROM mcogs_countries WHERE id = $2)                   AS currency_code,
        (SELECT currency_symbol FROM mcogs_countries WHERE id = $2)                   AS currency_symbol
      FROM mcogs_price_quotes pq
      JOIN mcogs_vendors v ON v.id = pq.vendor_id
      WHERE pq.ingredient_id = $1
        AND v.country_id     = $2
        AND pq.is_active     = TRUE
        AND pq.qty_in_base_units > 0
    `, [ingredientId, countryId])
    return (rows.length && rows[0].price_per_base_unit != null) ? rows[0] : null
  }

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
 */
async function getEffectivePricesBulk(pool, countryId, method) {
  if (!COSTING_METHODS.includes(method)) method = await resolveCostingMethodFromSettings(pool)

  const fallbackCte = method === 'average'
    ? `fallback AS (
         SELECT pq.ingredient_id,
                NULL::numeric AS purchase_price,
                NULL::numeric AS qty_in_base_units,
                NULL          AS purchase_unit,
                NULL::int     AS vendor_id,
                NULL          AS vendor_name,
                c.currency_code,
                c.currency_symbol,
                ROUND(AVG(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0))::numeric, 6) AS price_per_base_unit,
                FALSE AS is_preferred
         FROM   mcogs_price_quotes pq
         JOIN   mcogs_vendors   v ON v.id = pq.vendor_id
         JOIN   mcogs_countries c ON c.id = v.country_id
         WHERE  v.country_id = $1 AND pq.is_active = TRUE AND pq.qty_in_base_units > 0
         GROUP  BY pq.ingredient_id, c.currency_code, c.currency_symbol
       )`
    : `fallback AS (
         SELECT DISTINCT ON (pq.ingredient_id)
                pq.ingredient_id,
                pq.purchase_price,
                pq.qty_in_base_units,
                pq.purchase_unit,
                v.id    AS vendor_id,
                v.name  AS vendor_name,
                c.currency_code,
                c.currency_symbol,
                ROUND(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0), 6) AS price_per_base_unit,
                FALSE   AS is_preferred
         FROM   mcogs_price_quotes pq
         JOIN   mcogs_vendors v   ON v.id = pq.vendor_id
         JOIN   mcogs_countries c ON c.id = v.country_id
         WHERE  v.country_id = $1 AND pq.is_active = TRUE
         ORDER  BY pq.ingredient_id, price_per_base_unit ASC
       )`

  const { rows } = await pool.query(`
    WITH preferred AS (
      SELECT
        ipv.ingredient_id,
        pq.purchase_price,
        pq.qty_in_base_units,
        pq.purchase_unit,
        v.id    AS vendor_id,
        v.name  AS vendor_name,
        c.currency_code,
        c.currency_symbol,
        ROUND(pq.purchase_price / NULLIF(pq.qty_in_base_units, 0), 6) AS price_per_base_unit,
        TRUE    AS is_preferred
      FROM mcogs_ingredient_preferred_vendor ipv
      JOIN mcogs_price_quotes pq ON pq.id = ipv.quote_id
      JOIN mcogs_vendors v       ON v.id  = pq.vendor_id
      JOIN mcogs_countries c     ON c.id  = v.country_id
      WHERE ipv.country_id = $1 AND pq.is_active = TRUE
    ),
    ${fallbackCte}
    SELECT * FROM preferred
    UNION ALL
    SELECT * FROM fallback f
    WHERE f.ingredient_id NOT IN (SELECT ingredient_id FROM preferred)
  `, [countryId])

  return rows.reduce((acc, row) => {
    acc[row.ingredient_id] = row
    return acc
  }, {})
}

module.exports = { getEffectivePrice, getEffectivePricesBulk, COSTING_METHODS, resolveCostingMethodFromSettings }
