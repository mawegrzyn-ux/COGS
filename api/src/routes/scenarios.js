const router = require('express').Router();
const pool   = require('../db/pool');

// Helper: fetch a single scenario with joined name fields
async function fetchScenario(id) {
  const { rows: [row] } = await pool.query(`
    SELECT s.id, s.name, s.menu_id, s.price_level_id, s.qty_data, s.notes,
           s.created_at, s.updated_at,
           m.name  AS menu_name,
           pl.name AS price_level_name
    FROM   mcogs_menu_scenarios s
    LEFT JOIN mcogs_menus        m  ON m.id  = s.menu_id
    LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
    WHERE  s.id = $1
  `, [id]);
  return row || null;
}

// ── GET /scenarios ─────────────────────────────────────────────────────────────
// Returns ALL scenarios (market-agnostic).
// qty_data keys are natural recipe/ingredient keys: "r_123", "i_456"
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.menu_id, s.price_level_id, s.qty_data, s.notes,
             s.created_at, s.updated_at,
             m.name  AS menu_name,
             pl.name AS price_level_name
      FROM   mcogs_menu_scenarios s
      LEFT JOIN mcogs_menus        m  ON m.id  = s.menu_id
      LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
      ORDER BY s.updated_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to list scenarios' } });
  }
});

// ── POST /scenarios ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, price_level_id, qty_data, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rows: [inserted] } = await pool.query(`
      INSERT INTO mcogs_menu_scenarios (name, price_level_id, qty_data, notes)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, [name.trim(), price_level_id || null,
        JSON.stringify(qty_data || {}), notes?.trim() || null]);
    const row = await fetchScenario(inserted.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save scenario' } });
  }
});

// ── PUT /scenarios/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, price_level_id, qty_data, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rowCount } = await pool.query(`
      UPDATE mcogs_menu_scenarios
      SET    name=$1, price_level_id=$2, qty_data=$3, notes=$4, updated_at=NOW()
      WHERE  id=$5
    `, [name.trim(), price_level_id || null,
        JSON.stringify(qty_data || {}), notes?.trim() || null, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Scenario not found' } });
    const row = await fetchScenario(req.params.id);
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
