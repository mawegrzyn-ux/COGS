const router = require('express').Router();
const pool   = require('../db/pool');

// GET /api/price-levels
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_price_levels ORDER BY name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/price-levels
router.post('/', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO mcogs_price_levels (name, description)
       VALUES ($1, $2) RETURNING *`,
      [name, description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/price-levels/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_price_levels SET name=$1, description=$2, updated_at=NOW()
       WHERE id=$3 RETURNING *`,
      [name, description || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Price level not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/price-levels/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_price_levels WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Price level not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
