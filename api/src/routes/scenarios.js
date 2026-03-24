const router = require('express').Router();
const pool   = require('../db/pool');

// Helper: fetch a single scenario with joined name fields
async function fetchScenario(id) {
  const { rows: [row] } = await pool.query(`
    SELECT s.id, s.name, s.menu_id, s.price_level_id,
           s.qty_data, s.price_overrides, s.cost_overrides, s.history,
           s.notes, s.created_at, s.updated_at,
           m.name  AS menu_name,
           pl.name AS price_level_name
    FROM   mcogs_menu_scenarios s
    LEFT JOIN mcogs_menus        m  ON m.id  = s.menu_id
    LEFT JOIN mcogs_price_levels pl ON pl.id = s.price_level_id
    WHERE  s.id = $1
  `, [id]);
  return row || null;
}

// ── GET /scenarios ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.name, s.menu_id, s.price_level_id,
             s.qty_data, s.price_overrides, s.cost_overrides, s.history,
             s.notes, s.created_at, s.updated_at,
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

// ── POST /scenarios/push-prices ──────────────────────────────────────────────
// Write price overrides to mcogs_menu_item_prices (makes them live on the menu).
// Body: { overrides: [{ menu_item_id, price_level_id, sell_price }] }
// sell_price is in USD base (same unit as mcogs_menu_item_prices.sell_price).
router.post('/push-prices', async (req, res) => {
  const { overrides } = req.body;
  if (!Array.isArray(overrides) || !overrides.length) return res.json({ pushed: 0 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const { menu_item_id, price_level_id, sell_price } of overrides) {
      await client.query(`
        INSERT INTO mcogs_menu_item_prices (menu_item_id, price_level_id, sell_price)
        VALUES ($1, $2, $3)
        ON CONFLICT (menu_item_id, price_level_id)
        DO UPDATE SET sell_price = EXCLUDED.sell_price
      `, [menu_item_id, price_level_id, sell_price]);
    }
    await client.query('COMMIT');
    res.json({ pushed: overrides.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to push prices to menu' } });
  } finally {
    client.release();
  }
});

// ── POST /scenarios ───────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { name, price_level_id, qty_data, price_overrides, cost_overrides, history, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rows: [inserted] } = await pool.query(`
      INSERT INTO mcogs_menu_scenarios
        (name, price_level_id, qty_data, price_overrides, cost_overrides, history, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      name.trim(),
      price_level_id || null,
      JSON.stringify(qty_data         || {}),
      JSON.stringify(price_overrides  || {}),
      JSON.stringify(cost_overrides   || {}),
      JSON.stringify(history          || []),
      notes?.trim() || null,
    ]);
    const row = await fetchScenario(inserted.id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save scenario' } });
  }
});

// ── PUT /scenarios/:id ────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, price_level_id, qty_data, price_overrides, cost_overrides, history, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rowCount } = await pool.query(`
      UPDATE mcogs_menu_scenarios
      SET name=$1, price_level_id=$2, qty_data=$3,
          price_overrides=$4, cost_overrides=$5, history=$6,
          notes=$7, updated_at=NOW()
      WHERE id=$8
    `, [
      name.trim(),
      price_level_id || null,
      JSON.stringify(qty_data         || {}),
      JSON.stringify(price_overrides  || {}),
      JSON.stringify(cost_overrides   || {}),
      JSON.stringify(history          || []),
      notes?.trim() || null,
      req.params.id,
    ]);
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
