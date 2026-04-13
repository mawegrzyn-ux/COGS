const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

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
    const { name, abbreviation, type, default_recipe_unit, default_recipe_unit_conversion } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO mcogs_units (name, abbreviation, type, default_recipe_unit, default_recipe_unit_conversion)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, abbreviation, type, default_recipe_unit || null, default_recipe_unit_conversion || null]
    );
    logAudit(pool, req, { action: 'create', entity_type: 'unit', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json(rows[0]);
  } catch (err) { next(err); }
});

// PUT /api/units/:id
router.put('/:id', async (req, res, next) => {
  try {
    const { name, abbreviation, type, default_recipe_unit, default_recipe_unit_conversion } = req.body;
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_units WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_units
          SET name=$1, abbreviation=$2, type=$3,
              default_recipe_unit=$4, default_recipe_unit_conversion=$5,
              updated_at=NOW()
        WHERE id=$6 RETURNING *`,
      [name, abbreviation, type, default_recipe_unit || null, default_recipe_unit_conversion || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Unit not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'unit', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], ['name', 'abbreviation']) });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// DELETE /api/units/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_units WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_units WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Unit not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'unit', entity_id: old?.id, entity_label: old?.name });
    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
