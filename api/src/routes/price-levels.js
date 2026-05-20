const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');
const { setContentLanguage } = require('../helpers/translate');

// GET /api/price-levels
// Query params:
//   country_id — if present, filters to price levels enabled for that country
//                (see mcogs_country_price_levels). Missing junction row is
//                treated as enabled, so pre-feature behaviour is preserved
//                for countries whose matrix hasn't been curated yet.
router.get('/', async (req, res, next) => {
  try {
    const lang = req.language && req.language !== 'en' ? req.language : null;
    const countryId = req.query.country_id ? parseInt(req.query.country_id, 10) : null;

    const params = [];
    let pName = `p.name`;
    if (lang) { params.push(lang); pName = `COALESCE(p.translations->$${params.length}->>'name', p.name)`; }

    // When country_id is supplied, LEFT JOIN mcogs_country_price_levels and
    // drop rows that are explicitly disabled. Missing row -> COALESCE to TRUE.
    let sql;
    if (countryId) {
      params.push(countryId);
      sql = `SELECT p.id, ${pName} AS name, p.description, p.is_default, p.translations,
                    p.created_at, p.updated_at
             FROM   mcogs_price_levels p
             LEFT   JOIN mcogs_country_price_levels cpl
                    ON cpl.price_level_id = p.id AND cpl.country_id = $${params.length}
             WHERE  COALESCE(cpl.is_enabled, TRUE) = TRUE
             ORDER  BY name`;
    } else {
      sql = `SELECT p.id, ${pName} AS name, p.description, p.is_default, p.translations,
                    p.created_at, p.updated_at
             FROM   mcogs_price_levels p
             ORDER  BY name`;
    }
    const { rows } = await pool.query(sql, params);
    setContentLanguage(res, req);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/price-levels
router.post('/', async (req, res, next) => {
  try {
    const { name, description, is_default } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (is_default) {
        await client.query(`UPDATE mcogs_price_levels SET is_default = false, updated_at = NOW()`);
      }
      const { rows } = await client.query(
        `INSERT INTO mcogs_price_levels (name, description, is_default)
         VALUES ($1, $2, $3) RETURNING *`,
        [name, description || null, !!is_default]
      );
      await client.query('COMMIT');
      logAudit(pool, req, { action: 'create', entity_type: 'price_level', entity_id: rows[0].id, entity_label: rows[0].name });
      res.status(201).json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// PUT /api/price-levels/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, description, is_default } = req.body;
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_price_levels WHERE id=$1', [req.params.id]);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (is_default) {
        await client.query(
          `UPDATE mcogs_price_levels SET is_default = false, updated_at = NOW() WHERE id != $1`,
          [req.params.id]
        );
      }
      const { rows } = await client.query(
        `UPDATE mcogs_price_levels SET name=$1, description=$2, is_default=$3, updated_at=NOW()
         WHERE id=$4 RETURNING *`,
        [name, description || null, !!is_default, req.params.id]
      );
      await client.query('COMMIT');
      if (!rows.length) return res.status(404).json({ error: { message: 'Price level not found' } });
      logAudit(pool, req, { action: 'update', entity_type: 'price_level', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], ['name', 'is_default']) });
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// POST /api/price-levels/:id/set-default  — quick toggle without full edit
router.post('/:id/set-default', async (req, res, next) => {
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE mcogs_price_levels SET is_default = false, updated_at = NOW()`);
      const { rows } = await client.query(
        `UPDATE mcogs_price_levels SET is_default = true, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      await client.query('COMMIT');
      if (!rows.length) return res.status(404).json({ error: { message: 'Price level not found' } });
      logAudit(pool, req, { action: 'update', entity_type: 'price_level', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: { is_default: { old: false, new: true } } });
      res.json(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// DELETE /api/price-levels/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_price_levels WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_price_levels WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Price level not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'price_level', entity_id: old?.id, entity_label: old?.name });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
