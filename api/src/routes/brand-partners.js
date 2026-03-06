const router = require('express').Router();
const pool   = require('../db/pool');

// GET /brand-partners
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_brand_partners ORDER BY name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch brand partners' } });
  }
});

// GET /brand-partners/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_brand_partners WHERE id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch brand partner' } });
  }
});

// POST /brand-partners
router.post('/', async (req, res) => {
  const { name, contact, email, phone, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_brand_partners (name, contact, email, phone, notes)
      VALUES ($1, $2, $3, $4, $5) RETURNING *
    `, [
      name.trim(),
      contact?.trim() || null,
      email?.trim()   || null,
      phone?.trim()   || null,
      notes?.trim()   || null,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create brand partner' } });
  }
});

// PUT /brand-partners/:id
router.put('/:id', async (req, res) => {
  const { name, contact, email, phone, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_brand_partners
      SET name=$1, contact=$2, email=$3, phone=$4, notes=$5, updated_at=NOW()
      WHERE id=$6 RETURNING *
    `, [
      name.trim(),
      contact?.trim() || null,
      email?.trim()   || null,
      phone?.trim()   || null,
      notes?.trim()   || null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update brand partner' } });
  }
});

// DELETE /brand-partners/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_brand_partners WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.status(204).send();
  } catch (err) {
    // FK violation — brand partner is still assigned to one or more markets
    if (err.code === '23503') {
      return res.status(409).json({
        error: { message: 'Cannot delete a brand partner assigned to markets. Unassign it first.' }
      });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete brand partner' } });
  }
});

module.exports = router;
