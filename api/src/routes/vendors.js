const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');
const { setContentLanguage } = require('../helpers/translate');

// GET /vendors?country_id=
router.get('/', async (req, res) => {
  try {
    const { country_id } = req.query;
    const lang = req.language && req.language !== 'en' ? req.language : null;
    const vName = lang ? `COALESCE(v.translations->$LANG->>'name', v.name)` : `v.name`;
    const vNotes = lang ? `COALESCE(v.translations->$LANG->>'notes', v.notes)` : `v.notes`;

    const vals = [];
    if (lang) vals.push(lang);
    let whereIdx = null;
    if (country_id) { vals.push(country_id); whereIdx = vals.length; }
    const langIdx = lang ? 1 : null;
    const sub = (sql) => sql.replace(/\$LANG/g, `$${langIdx}`);

    let query = sub(`
      SELECT v.id, ${vName} AS name, ${vNotes} AS notes,
             v.country_id, v.contact, v.email, v.phone, v.translations,
             v.created_at, v.updated_at,
             c.name as country_name, c.currency_code, c.currency_symbol
      FROM mcogs_vendors v
      LEFT JOIN mcogs_countries c ON c.id = v.country_id
    `);
    if (whereIdx) query += ` WHERE v.country_id = $${whereIdx}`;
    query += ` ORDER BY name ASC`;
    const { rows } = await pool.query(query, vals);
    setContentLanguage(res, req);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch vendors' } });
  }
});

// GET /vendors/:id
router.get('/:id', async (req, res) => {
  try {
    const lang = req.language && req.language !== 'en' ? req.language : null;
    const vName = lang ? `COALESCE(v.translations->$2->>'name', v.name)` : `v.name`;
    const vNotes = lang ? `COALESCE(v.translations->$2->>'notes', v.notes)` : `v.notes`;
    const vals = [req.params.id];
    if (lang) vals.push(lang);

    const { rows } = await pool.query(`
      SELECT v.id, ${vName} AS name, ${vNotes} AS notes,
             v.country_id, v.contact, v.email, v.phone, v.translations,
             v.created_at, v.updated_at,
             c.name as country_name, c.currency_code, c.currency_symbol
      FROM mcogs_vendors v
      LEFT JOIN mcogs_countries c ON c.id = v.country_id
      WHERE v.id = $1
    `, vals);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    setContentLanguage(res, req);
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch vendor' } });
  }
});

// POST /vendors
router.post('/', async (req, res) => {
  const { name, country_id, contact, email, phone, notes } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_vendors (name, country_id, contact, email, phone, notes)
      VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
    `, [name.trim(), country_id || null, contact?.trim() || null, email?.trim() || null, phone?.trim() || null, notes?.trim() || null]);
    logAudit(pool, req, { action: 'create', entity_type: 'vendor', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create vendor' } });
  }
});

// PUT /vendors/:id
router.put('/:id', async (req, res) => {
  const { name, country_id, contact, email, phone, notes } = req.body;
  if (!name?.trim())  return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_vendors WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(`
      UPDATE mcogs_vendors
      SET name=$1, country_id=$2, contact=$3, email=$4, phone=$5, notes=$6, updated_at=NOW()
      WHERE id=$7 RETURNING *
    `, [name.trim(), country_id || null, contact?.trim() || null, email?.trim() || null, phone?.trim() || null, notes?.trim() || null, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'vendor', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], ['name', 'country_id', 'contact', 'email', 'phone', 'notes']) });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update vendor' } });
  }
});

// DELETE /vendors/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_vendors WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_vendors WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'vendor', entity_id: old?.id, entity_label: old?.name });
    res.status(204).send();
  } catch (err) {
    // FK violation — vendor has price quotes
    if (err.code === '23503') {
      return res.status(409).json({ error: { message: 'Cannot delete vendor with existing price quotes. Remove quotes first.' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete vendor' } });
  }
});

module.exports = router;
