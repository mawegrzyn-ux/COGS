const router = require('express').Router();
const pool   = require('../db/pool');

// ── GET /scenarios?menu_id=X ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const menuId = req.query.menu_id ? Number(req.query.menu_id) : null;
  try {
    const where  = menuId ? 'WHERE s.menu_id = $1' : '';
    const params = menuId ? [menuId] : [];
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.menu_id, s.price_level_id, s.qty_data, s.notes,
             s.created_at, s.updated_at,
             m.name  AS menu_name,
             pl.name AS price_level_name
      FROM   mcogs_menu_scenarios s
      LEFT JOIN mcogs_menus        m  ON m.id  = s.menu_id
      LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
      ${where}
      ORDER BY s.updated_at DESC
    `, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to list scenarios' } });
  }
});

// ── POST /scenarios ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, menu_id, price_level_id, qty_data, notes } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: { message: 'Name is required' } });
  if (!menu_id)       return res.status(400).json({ error: { message: 'menu_id is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_menu_scenarios (name, menu_id, price_level_id, qty_data, notes)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name.trim(), menu_id, price_level_id || null,
        JSON.stringify(qty_data || {}), notes?.trim() || null]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save scenario' } });
  }
});

// ── PUT /scenarios/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, menu_id, price_level_id, qty_data, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_menu_scenarios
      SET    name=$1, menu_id=$2, price_level_id=$3, qty_data=$4, notes=$5, updated_at=NOW()
      WHERE  id=$6
      RETURNING *
    `, [name.trim(), menu_id, price_level_id || null,
        JSON.stringify(qty_data || {}), notes?.trim() || null, req.params.id]);
    if (!row) return res.status(404).json({ error: { message: 'Scenario not found' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update scenario' } });
  }
});

// ── DELETE /scenarios/:id ─────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_menu_scenarios WHERE id=$1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete scenario' } });
  }
});

module.exports = router;
