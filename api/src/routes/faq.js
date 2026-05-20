'use strict';
// =============================================================================
// FAQ Knowledge Base — CRUD + search API
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// GET /faq — list FAQs (optional filters: category, search, published)
router.get('/', async (req, res) => {
  try {
    const { category, search, published } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (published !== 'false') {
      conditions.push('is_published = TRUE');
    }
    if (category) {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }
    if (search) {
      conditions.push(`(question ILIKE '%' || $${idx} || '%' OR answer ILIKE '%' || $${idx} || '%' OR tags::text ILIKE '%' || $${idx} || '%')`);
      params.push(search);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pool.query(`
      SELECT * FROM mcogs_faq ${where}
      ORDER BY category, sort_order, id
    `, params);

    // Also return distinct categories for filter pills
    const { rows: cats } = await pool.query(
      'SELECT DISTINCT category FROM mcogs_faq WHERE is_published = TRUE ORDER BY category'
    );

    res.json({ items: rows, categories: cats.map(c => c.category) });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to fetch FAQs' } });
  }
});

// GET /faq/search — dedicated search endpoint (for Pepper tool)
router.get('/search', async (req, res) => {
  try {
    const { q, category } = req.query;
    if (!q) return res.json({ items: [] });

    const conditions = ['is_published = TRUE'];
    const params = [];
    let idx = 1;

    // Full-text search across question + answer + tags
    conditions.push(`(question ILIKE '%' || $${idx} || '%' OR answer ILIKE '%' || $${idx} || '%' OR tags::text ILIKE '%' || $${idx} || '%')`);
    params.push(q);
    idx++;

    if (category) {
      conditions.push(`category = $${idx++}`);
      params.push(category);
    }

    const { rows } = await pool.query(`
      SELECT id, question, answer, category, tags
      FROM   mcogs_faq
      WHERE  ${conditions.join(' AND ')}
      ORDER BY sort_order, id
      LIMIT  5
    `, params);

    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: { message: 'FAQ search failed' } });
  }
});

// GET /faq/:id — single FAQ
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mcogs_faq WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'FAQ not found' } });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to fetch FAQ' } });
  }
});

// POST /faq — create (admin only)
router.post('/', async (req, res) => {
  if (req.user?.permissions?.settings !== 'write') {
    return res.status(403).json({ error: { message: 'Admin access required' } });
  }
  try {
    const { question, answer, category, tags, sort_order, is_published } = req.body;
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_faq (question, answer, category, tags, sort_order, is_published)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [question, answer, category || 'General', JSON.stringify(tags || []), sort_order || 0, is_published !== false]);
    logAudit(pool, req, { action: 'create', entity_type: 'faq', entity_id: row.id, entity_label: question });
    res.status(201).json(row);
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to create FAQ' } });
  }
});

// PUT /faq/:id — update (admin only)
router.put('/:id', async (req, res) => {
  if (req.user?.permissions?.settings !== 'write') {
    return res.status(403).json({ error: { message: 'Admin access required' } });
  }
  try {
    const { id } = req.params;
    const { question, answer, category, tags, sort_order, is_published } = req.body;
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_faq WHERE id = $1', [id]);
    if (!old) return res.status(404).json({ error: { message: 'FAQ not found' } });

    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_faq SET question=$1, answer=$2, category=$3, tags=$4, sort_order=$5, is_published=$6, updated_at=NOW()
      WHERE id=$7 RETURNING *
    `, [question, answer, category || 'General', JSON.stringify(tags || []), sort_order || 0, is_published !== false, id]);

    logAudit(pool, req, {
      action: 'update', entity_type: 'faq', entity_id: row.id, entity_label: question,
      field_changes: diffFields(old, row, ['question', 'answer', 'category', 'is_published']),
    });
    res.json(row);
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to update FAQ' } });
  }
});

// DELETE /faq/:id — delete (admin only)
router.delete('/:id', async (req, res) => {
  if (req.user?.permissions?.settings !== 'write') {
    return res.status(403).json({ error: { message: 'Admin access required' } });
  }
  try {
    const { rows: [old] } = await pool.query('DELETE FROM mcogs_faq WHERE id = $1 RETURNING *', [req.params.id]);
    if (!old) return res.status(404).json({ error: { message: 'FAQ not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'faq', entity_id: old.id, entity_label: old.question });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to delete FAQ' } });
  }
});

module.exports = router;
