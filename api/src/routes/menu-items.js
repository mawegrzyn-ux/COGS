const router = require('express').Router();
const pool   = require('../db/pool');

// ── shared row fetch ──────────────────────────────────────────────────────────
async function getMenuItemRow(id) {
  const { rows: [row] } = await pool.query(`
    SELECT mi.*,
           r.name              AS recipe_name,
           r.yield_qty,
           ing.name            AS ingredient_name,
           u.abbreviation      AS base_unit_abbr
    FROM   mcogs_menu_items mi
    LEFT JOIN mcogs_recipes     r   ON r.id   = mi.recipe_id
    LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
    LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
    WHERE  mi.id = $1
  `, [id]);
  return row || null;
}

// GET /menu-items?menu_id=X
router.get('/', async (req, res) => {
  const { menu_id } = req.query;
  if (!menu_id) return res.status(400).json({ error: { message: 'menu_id is required' } });
  try {
    const { rows } = await pool.query(`
      SELECT mi.*,
             r.name              AS recipe_name,
             r.yield_qty,
             ing.name            AS ingredient_name,
             u.abbreviation      AS base_unit_abbr
      FROM   mcogs_menu_items mi
      LEFT JOIN mcogs_recipes     r   ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
      WHERE  mi.menu_id = $1
      ORDER BY mi.id ASC
    `, [menu_id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch menu items' } });
  }
});

// POST /menu-items
router.post('/', async (req, res) => {
  const { menu_id, item_type = 'recipe', recipe_id, ingredient_id, display_name, qty = 1, sell_price = 0, tax_rate_id, image_url } = req.body;
  if (!menu_id) return res.status(400).json({ error: { message: 'menu_id is required' } });
  if (!['recipe', 'ingredient'].includes(item_type))
    return res.status(400).json({ error: { message: 'item_type must be recipe or ingredient' } });
  if (item_type === 'recipe' && !recipe_id)
    return res.status(400).json({ error: { message: 'recipe_id is required for type recipe' } });
  if (item_type === 'ingredient' && !ingredient_id)
    return res.status(400).json({ error: { message: 'ingredient_id is required for type ingredient' } });
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_menu_items
        (menu_id, item_type, recipe_id, ingredient_id, display_name, qty, sell_price, tax_rate_id, image_url)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [
      menu_id,
      item_type,
      item_type === 'recipe'      ? recipe_id     : null,
      item_type === 'ingredient'  ? ingredient_id : null,
      display_name?.trim() || '',
      Number(qty) || 1,
      Number(sell_price) || 0,
      tax_rate_id || null,
      image_url?.trim() || null,
    ]);
    res.status(201).json(await getMenuItemRow(row.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create menu item' } });
  }
});

// PUT /menu-items/:id
router.put('/:id', async (req, res) => {
  const { item_type = 'recipe', recipe_id, ingredient_id, display_name, qty = 1, sell_price = 0, tax_rate_id, image_url } = req.body;
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_menu_items
      SET    item_type=$1, recipe_id=$2, ingredient_id=$3,
             display_name=$4, qty=$5, sell_price=$6, tax_rate_id=$7, image_url=$8
      WHERE  id=$9
      RETURNING *
    `, [
      item_type,
      item_type === 'recipe'     ? recipe_id     : null,
      item_type === 'ingredient' ? ingredient_id : null,
      display_name?.trim() || '',
      Number(qty) || 1,
      Number(sell_price) || 0,
      tax_rate_id || null,
      image_url?.trim() || null,
      req.params.id,
    ]);
    if (!row) return res.status(404).json({ error: { message: 'Menu item not found' } });
    res.json(await getMenuItemRow(row.id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update menu item' } });
  }
});

// PATCH /menu-items/:id/sell-price  — quick price update used by Price Level Tool
router.post('/:id/sell-price', async (req, res) => {
  const { sell_price } = req.body;
  try {
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_menu_items SET sell_price=$1 WHERE id=$2 RETURNING *
    `, [Number(sell_price) || 0, req.params.id]);
    if (!row) return res.status(404).json({ error: { message: 'Menu item not found' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update sell price' } });
  }
});

// DELETE /menu-items/:id
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM mcogs_menu_item_prices WHERE menu_item_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM mcogs_menu_items        WHERE id = $1`,           [req.params.id]);
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete menu item' } });
  } finally {
    client.release();
  }
});

module.exports = router;
