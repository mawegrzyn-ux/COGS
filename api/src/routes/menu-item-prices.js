const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// GET /menu-item-prices?menu_item_id=X  or  ?menu_id=X
router.get('/', async (req, res) => {
  const { menu_item_id, menu_id } = req.query;
  try {
    let rows;
    if (menu_item_id) {
      ({ rows } = await pool.query(
        `SELECT * FROM mcogs_menu_item_prices WHERE menu_item_id = $1 ORDER BY price_level_id`,
        [menu_item_id]
      ));
    } else if (menu_id) {
      ({ rows } = await pool.query(`
        SELECT mip.*
        FROM   mcogs_menu_item_prices mip
        JOIN   mcogs_menu_items mi ON mi.id = mip.menu_item_id
        WHERE  mi.menu_id = $1
        ORDER BY mip.menu_item_id, mip.price_level_id
      `, [menu_id]));
    } else {
      return res.status(400).json({ error: { message: 'menu_item_id or menu_id is required' } });
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch menu item prices' } });
  }
});

// POST /menu-item-prices  — upsert by (menu_item_id, price_level_id)
router.post('/', async (req, res) => {
  const { menu_item_id, price_level_id, sell_price, tax_rate_id } = req.body;
  if (!menu_item_id)    return res.status(400).json({ error: { message: 'menu_item_id is required' } });
  if (!price_level_id)  return res.status(400).json({ error: { message: 'price_level_id is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_menu_item_prices (menu_item_id, price_level_id, sell_price, tax_rate_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (menu_item_id, price_level_id)
      DO UPDATE SET sell_price = EXCLUDED.sell_price,
                    tax_rate_id = EXCLUDED.tax_rate_id
      RETURNING *
    `, [menu_item_id, price_level_id, Number(sell_price) || 0, tax_rate_id || null]);
    logAudit(pool, req, { action: 'create', entity_type: 'menu_item_price', entity_id: row.id, entity_label: `item:${menu_item_id} level:${price_level_id}` });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to upsert menu item price' } });
  }
});

// DELETE /menu-item-prices/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_menu_item_prices WHERE id = $1`, [req.params.id]);
    logAudit(pool, req, { action: 'delete', entity_type: 'menu_item_price', entity_id: Number(req.params.id), entity_label: `id:${req.params.id}` });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete menu item price' } });
  }
});

module.exports = router;
