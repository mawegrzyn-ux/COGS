// =============================================================================
// Country ↔ Price Level enablement matrix.
// Lets admins disable specific price levels per country. Consumed by:
//   - Configuration UI (admin matrix)
//   - GET /api/price-levels?country_id=X  (filter on the main list endpoint)
//   - Menus, Menu Engineer, Shared pages, POS tester, dashboard charts
//
// Missing junction row = enabled (preserves behaviour for countries that
// haven't been curated yet).
// =============================================================================

const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// ── GET /country-price-levels ─────────────────────────────────────────────────
// Full matrix of every (country, price_level) pair with enablement flag.
// Output: [{ country_id, country_name, price_level_id, price_level_name, is_enabled }]
router.get('/', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id                                     AS country_id,
              c.name                                   AS country_name,
              p.id                                     AS price_level_id,
              p.name                                   AS price_level_name,
              COALESCE(cpl.is_enabled, TRUE)           AS is_enabled
       FROM   mcogs_countries c
       CROSS  JOIN mcogs_price_levels p
       LEFT   JOIN mcogs_country_price_levels cpl
              ON cpl.country_id = c.id AND cpl.price_level_id = p.id
       ORDER  BY c.name, p.name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── GET /country-price-levels/:countryId ─────────────────────────────────────
// Single country's view.
router.get('/:countryId', async (req, res, next) => {
  try {
    const countryId = parseInt(req.params.countryId, 10);
    if (!countryId) return res.status(400).json({ error: { message: 'Invalid country id' } });
    const { rows } = await pool.query(
      `SELECT p.id                                   AS price_level_id,
              p.name                                 AS price_level_name,
              COALESCE(cpl.is_enabled, TRUE)         AS is_enabled
       FROM   mcogs_price_levels p
       LEFT   JOIN mcogs_country_price_levels cpl
              ON cpl.price_level_id = p.id AND cpl.country_id = $1
       ORDER  BY p.name`,
      [countryId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── PUT /country-price-levels/:countryId/:priceLevelId ───────────────────────
// Body: { is_enabled: boolean }
// Upserts the row. Missing row is treated as enabled — the first time a level
// is disabled for a country, this inserts the record.
router.put('/:countryId/:priceLevelId', async (req, res, next) => {
  try {
    const countryId = parseInt(req.params.countryId, 10);
    const levelId   = parseInt(req.params.priceLevelId, 10);
    if (!countryId || !levelId) return res.status(400).json({ error: { message: 'Invalid ids' } });
    const isEnabled = !!req.body?.is_enabled;

    const { rows } = await pool.query(
      `INSERT INTO mcogs_country_price_levels (country_id, price_level_id, is_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (country_id, price_level_id)
       DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW()
       RETURNING *`,
      [countryId, levelId, isEnabled]
    );

    // Audit — small surface but useful when a menu suddenly loses a column.
    const { rows: ctx } = await pool.query(
      `SELECT c.name AS country_name, p.name AS price_level_name
       FROM mcogs_countries c, mcogs_price_levels p
       WHERE c.id = $1 AND p.id = $2`,
      [countryId, levelId]
    );
    const label = ctx[0] ? `${ctx[0].country_name} · ${ctx[0].price_level_name}` : `country ${countryId} · level ${levelId}`;
    logAudit(pool, req, {
      action:       'update',
      entity_type:  'country_price_level',
      entity_id:    rows[0].id,
      entity_label: label,
      field_changes: { is_enabled: { new: isEnabled } },
    });

    res.json(rows[0]);
  } catch (err) { next(err); }
});

module.exports = router;
