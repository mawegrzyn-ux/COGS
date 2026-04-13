const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// GET /menus
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*, c.name AS country_name
      FROM   mcogs_menus m
      LEFT JOIN mcogs_countries c ON c.id = m.country_id
      ORDER BY m.name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch menus' } });
  }
});

// GET /menus/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows: [row] } = await pool.query(`
      SELECT m.*, c.name AS country_name
      FROM   mcogs_menus m
      LEFT JOIN mcogs_countries c ON c.id = m.country_id
      WHERE  m.id = $1
    `, [req.params.id]);
    if (!row) return res.status(404).json({ error: { message: 'Menu not found' } });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch menu' } });
  }
});

// POST /menus
router.post('/', async (req, res) => {
  const { name, country_id, description } = req.body;
  if (!name?.trim())    return res.status(400).json({ error: { message: 'name is required' } });
  if (!country_id)      return res.status(400).json({ error: { message: 'country_id is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_menus (name, country_id, description)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [name.trim(), country_id, description?.trim() || null]);
    logAudit(pool, req, { action: 'create', entity_type: 'menu', entity_id: row.id, entity_label: row.name });
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create menu' } });
  }
});

// PUT /menus/:id
router.put('/:id', async (req, res) => {
  const { name, country_id, description } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: { message: 'name is required' } });
  if (!country_id)    return res.status(400).json({ error: { message: 'country_id is required' } });
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_menus WHERE id=$1', [req.params.id]);
    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_menus
      SET    name=$1, country_id=$2, description=$3
      WHERE  id=$4
      RETURNING *
    `, [name.trim(), country_id, description?.trim() || null, req.params.id]);
    if (!row) return res.status(404).json({ error: { message: 'Menu not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'menu', entity_id: row.id, entity_label: row.name, field_changes: diffFields(old, row, ['name', 'country_id', 'description']) });
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update menu' } });
  }
});

// DELETE /menus/:id  — cascades to menu_items (and their prices)
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_menus WHERE id=$1', [req.params.id]);
    await client.query('BEGIN');
    // Delete level prices for items on this menu
    await client.query(`
      DELETE FROM mcogs_menu_item_prices
      WHERE  menu_item_id IN (
        SELECT id FROM mcogs_menu_items WHERE menu_id = $1
      )
    `, [req.params.id]);
    await client.query(`DELETE FROM mcogs_menu_items  WHERE menu_id = $1`, [req.params.id]);
    await client.query(`DELETE FROM mcogs_menus       WHERE id = $1`,      [req.params.id]);
    await client.query('COMMIT');
    logAudit(pool, req, { action: 'delete', entity_type: 'menu', entity_id: old?.id, entity_label: old?.name });
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete menu' } });
  } finally {
    client.release();
  }
});

module.exports = router;
