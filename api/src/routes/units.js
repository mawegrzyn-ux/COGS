const router = require('express').Router();
const pool   = require('../db/pool');

// GET /api/units
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_units ORDER BY type, name`
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/units
router.post('/', async (req, res, next) => {
  try {
    const { name, abbreviation, type } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO mcogs_units (name, abbreviation, type)
       VALUES ($1, $2, $3) RETURNING *`,
      [name, abbreviation, type]
    );
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/units/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, abbreviation, type } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_units SET name=$1, abbreviation=$2, type=$3, updated_at=NOW()
       WHERE id=$4 RETURNING *`,
      [name, abbreviation, type, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Unit not found' } });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/units/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_units WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Unit not found' } });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
