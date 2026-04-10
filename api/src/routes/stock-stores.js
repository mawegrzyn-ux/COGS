const router = require('express').Router();
const pool   = require('../db/pool');

// GET /stock-stores?location_id=&active=
router.get('/', async (req, res, next) => {
  try {
    const { location_id, active } = req.query;
    let query = `
      SELECT s.*,
             l.name        AS location_name,
             c.name        AS country_name
      FROM   mcogs_stores s
      LEFT JOIN mcogs_locations l ON l.id = s.location_id
      LEFT JOIN mcogs_countries c ON c.id = l.country_id
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;
    if (location_id)        { query += ` AND s.location_id = $${p++}`; vals.push(location_id); }
    if (active === 'true')    query += ` AND s.is_active = TRUE`;
    if (active === 'false')   query += ` AND s.is_active = FALSE`;
    query += ` ORDER BY l.name ASC, s.sort_order ASC, s.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /stock-stores/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*,
             l.name        AS location_name,
             c.name        AS country_name
      FROM   mcogs_stores s
      LEFT JOIN mcogs_locations l ON l.id = s.location_id
      LEFT JOIN mcogs_countries c ON c.id = l.country_id
      WHERE  s.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Store not found' } });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /stock-stores
router.post('/', async (req, res, next) => {
  const { location_id, name, code, store_type, is_store_itself, notes, sort_order } = req.body;
  if (!location_id) return res.status(400).json({ error: { message: 'location_id is required' } });
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_stores
        (location_id, name, code, store_type, is_store_itself, notes, sort_order)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      location_id,
      name.trim(),
      code?.trim()       || null,
      store_type?.trim() || null,
      is_store_itself === true,
      notes?.trim()      || null,
      sort_order         ?? 0,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { message: 'A store with this name already exists at this location' } });
    }
    if (err.code === '23503') {
      return res.status(400).json({ error: { message: 'Invalid location_id — location does not exist' } });
    }
    next(err);
  }
});

// POST /stock-stores/bulk-create
router.post('/bulk-create', async (req, res, next) => {
  const { location_id, stores } = req.body;
  if (!location_id) return res.status(400).json({ error: { message: 'location_id is required' } });
  if (!Array.isArray(stores) || !stores.length) {
    return res.status(400).json({ error: { message: 'stores array is required and must not be empty' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (let i = 0; i < stores.length; i++) {
      const s = stores[i];
      if (!s.name?.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { message: `stores[${i}].name is required` } });
      }
      const { rows } = await client.query(`
        INSERT INTO mcogs_stores
          (location_id, name, code, store_type, is_store_itself, notes, sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING *
      `, [
        location_id,
        s.name.trim(),
        s.code?.trim()       || null,
        s.store_type?.trim() || null,
        s.is_store_itself === true,
        s.notes?.trim()      || null,
        s.sort_order         ?? i,
      ]);
      created.push(rows[0]);
    }
    await client.query('COMMIT');
    res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: { message: 'Duplicate store name at this location' } });
    }
    if (err.code === '23503') {
      return res.status(400).json({ error: { message: 'Invalid location_id — location does not exist' } });
    }
    next(err);
  } finally {
    client.release();
  }
});

// PUT /stock-stores/:id
router.put('/:id', async (req, res, next) => {
  const { location_id, name, code, store_type, is_store_itself, is_active, notes, sort_order } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });

  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_stores
      SET    location_id=$1, name=$2, code=$3, store_type=$4,
             is_store_itself=$5, is_active=$6, notes=$7, sort_order=$8,
             updated_at=NOW()
      WHERE  id=$9
      RETURNING *
    `, [
      location_id    || null,
      name.trim(),
      code?.trim()       || null,
      store_type?.trim() || null,
      is_store_itself === true,
      is_active !== false,
      notes?.trim()      || null,
      sort_order         ?? 0,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Store not found' } });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { message: 'A store with this name already exists at this location' } });
    }
    next(err);
  }
});

// DELETE /stock-stores/:id
router.delete('/:id', async (req, res, next) => {
  try {
    // Check for referencing stock_levels or stock_movements
    const { rows: refs } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM mcogs_stock_levels    WHERE store_id = $1) AS level_count,
        (SELECT COUNT(*)::int FROM mcogs_stock_movements WHERE store_id = $1) AS movement_count
    `, [req.params.id]);
    const { level_count, movement_count } = refs[0];
    if (level_count > 0 || movement_count > 0) {
      return res.status(409).json({
        error: {
          message: `Cannot delete store — it has ${level_count} stock level(s) and ${movement_count} movement(s). Remove stock data first.`,
        },
      });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_stores WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Store not found' } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
