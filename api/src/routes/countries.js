const router  = require('express').Router();
const pool = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// GET /countries
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_countries ORDER BY name ASC`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch countries' } });
  }
});

// POST /countries
router.post('/', async (req, res) => {
  const { name, currency_code, currency_symbol, exchange_rate, default_price_level_id, country_iso } = req.body;
  if (!name || !currency_code || !currency_symbol || exchange_rate == null)
    return res.status(400).json({ error: { message: 'name, currency_code, currency_symbol and exchange_rate are required' } });
  if (Number(exchange_rate) <= 0)
    return res.status(400).json({ error: { message: 'exchange_rate must be positive' } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_countries (name, currency_code, currency_symbol, exchange_rate, default_price_level_id, country_iso)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name.trim(), currency_code.toUpperCase().trim(), currency_symbol.trim(), exchange_rate, default_price_level_id || null, country_iso ? country_iso.toUpperCase().trim() : null]
    );
    logAudit(pool, req, { action: 'create', entity_type: 'country', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create country' } });
  }
});

// PUT /countries/:id
router.put('/:id', async (req, res) => {
  const { name, currency_code, currency_symbol, exchange_rate, default_price_level_id, country_iso } = req.body;
  if (!name || !currency_code || !currency_symbol || exchange_rate == null)
    return res.status(400).json({ error: { message: 'name, currency_code, currency_symbol and exchange_rate are required' } });
  if (Number(exchange_rate) <= 0)
    return res.status(400).json({ error: { message: 'exchange_rate must be positive' } });
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_countries WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_countries
       SET name=$1, currency_code=$2, currency_symbol=$3, exchange_rate=$4,
           default_price_level_id=$5, country_iso=$6, updated_at=NOW()
       WHERE id=$7 RETURNING *`,
      [name.trim(), currency_code.toUpperCase().trim(), currency_symbol.trim(), exchange_rate, default_price_level_id || null, country_iso ? country_iso.toUpperCase().trim() : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'country', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], ['name', 'currency_code', 'currency_symbol', 'exchange_rate', 'default_price_level_id']) });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update country' } });
  }
});

// PATCH /countries/:id  (partial — used for default_price_level_id inline update)
router.patch('/:id', async (req, res) => {
  const allowed = ['name','currency_code','currency_symbol','exchange_rate','default_price_level_id','country_iso','brand_partner_id'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length)
    return res.status(400).json({ error: { message: 'No valid fields to update' } });
  const sets   = fields.map((f, i) => `${f} = $${i + 1}`);
  const values = fields.map(f => req.body[f] === '' ? null : req.body[f]);
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_countries WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_countries SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${fields.length+1} RETURNING *`,
      [...values, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'country', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], fields) });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to patch country' } });
  }
});

// DELETE /countries/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_countries WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(`DELETE FROM mcogs_countries WHERE id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'country', entity_id: old?.id, entity_label: old?.name });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete country' } });
  }
});

module.exports = router;
