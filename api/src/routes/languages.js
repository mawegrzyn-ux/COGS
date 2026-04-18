// Languages CRUD — manage mcogs_languages reference table.
// Gated by settings:write for mutations; settings:read for listing.

const express = require('express');
const pool    = require('../db/pool');
const { requireAuth, requirePermission, invalidateLanguagesCache } = require('../middleware/auth');
const { logAudit, diffFields } = require('../helpers/audit');

const router = express.Router();
router.use(requireAuth);

// GET /api/languages — everyone authenticated can read the list (needed for the switcher)
router.get('/', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT code, name, native_name, is_default, is_rtl, is_active, sort_order FROM mcogs_languages ORDER BY sort_order, code'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/languages — admin-only
router.post('/', requirePermission('settings', 'write'), async (req, res) => {
  const { code, name, native_name, is_default, is_rtl, is_active, sort_order } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: { message: 'code and name are required' } });
  try {
    if (is_default) {
      await pool.query('UPDATE mcogs_languages SET is_default = FALSE');
    }
    const { rows } = await pool.query(
      `INSERT INTO mcogs_languages (code, name, native_name, is_default, is_rtl, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        String(code).toLowerCase(), name, native_name || null,
        !!is_default, !!is_rtl, is_active !== false,
        sort_order != null ? Number(sort_order) : 0,
      ]
    );
    invalidateLanguagesCache();
    await logAudit(pool, req, { action: 'create', entity_type: 'language', entity_id: null, entity_label: rows[0].code, field_changes: null });
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// PUT /api/languages/:code — admin-only
router.put('/:code', requirePermission('settings', 'write'), async (req, res) => {
  const code = String(req.params.code).toLowerCase();
  const { name, native_name, is_default, is_rtl, is_active, sort_order } = req.body || {};
  try {
    const { rows: [existing] } = await pool.query('SELECT * FROM mcogs_languages WHERE code = $1', [code]);
    if (!existing) return res.status(404).json({ error: { message: 'Language not found' } });

    if (is_default === true && !existing.is_default) {
      await pool.query('UPDATE mcogs_languages SET is_default = FALSE');
    }
    const { rows } = await pool.query(
      `UPDATE mcogs_languages SET
         name = COALESCE($2, name),
         native_name = COALESCE($3, native_name),
         is_default = COALESCE($4, is_default),
         is_rtl = COALESCE($5, is_rtl),
         is_active = COALESCE($6, is_active),
         sort_order = COALESCE($7, sort_order)
       WHERE code = $1 RETURNING *`,
      [code, name, native_name, is_default, is_rtl, is_active, sort_order]
    );
    invalidateLanguagesCache();
    await logAudit(pool, req, {
      action: 'update', entity_type: 'language', entity_id: null, entity_label: code,
      field_changes: diffFields(existing, rows[0], ['name','native_name','is_default','is_rtl','is_active','sort_order']),
    });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// DELETE /api/languages/:code — admin-only; refuses to delete default or English
router.delete('/:code', requirePermission('settings', 'write'), async (req, res) => {
  const code = String(req.params.code).toLowerCase();
  if (code === 'en') return res.status(400).json({ error: { message: 'Cannot delete English' } });
  try {
    const { rows: [existing] } = await pool.query('SELECT * FROM mcogs_languages WHERE code = $1', [code]);
    if (!existing) return res.status(404).json({ error: { message: 'Language not found' } });
    if (existing.is_default) return res.status(400).json({ error: { message: 'Cannot delete the default language' } });
    await pool.query('DELETE FROM mcogs_languages WHERE code = $1', [code]);
    invalidateLanguagesCache();
    await logAudit(pool, req, { action: 'delete', entity_type: 'language', entity_id: null, entity_label: code, field_changes: null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
