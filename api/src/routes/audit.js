'use strict';
// =============================================================================
// Audit Log — read-only query API for the central audit trail
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// GET /api/audit — list audit entries with filters
// Query params:
//   entity_type  — filter by entity type (e.g. 'price_quote')
//   entity_id    — filter by specific entity
//   user_sub     — filter by user
//   action       — filter by action type
//   from         — date range start (ISO date)
//   to           — date range end (ISO date)
//   q            — free text search in entity_label
//   limit        — default 50, max 500
//   offset       — default 0
router.get('/', async (req, res) => {
  try {
    const { entity_type, entity_id, user_sub, action, from, to, q } = req.query;
    const limit  = Math.min(parseInt(req.query.limit) || 50, 500);
    const offset = parseInt(req.query.offset) || 0;

    const conditions = [];
    const params = [];
    let idx = 1;

    if (entity_type) { conditions.push(`a.entity_type = $${idx++}`); params.push(entity_type); }
    if (entity_id)   { conditions.push(`a.entity_id = $${idx++}`);   params.push(entity_id); }
    if (user_sub)    { conditions.push(`a.user_sub = $${idx++}`);    params.push(user_sub); }
    if (action)      { conditions.push(`a.action = $${idx++}`);      params.push(action); }
    if (from)        { conditions.push(`a.created_at >= $${idx++}`); params.push(from); }
    if (to)          { conditions.push(`a.created_at < ($${idx++})::date + 1`); params.push(to); }
    if (q)           { conditions.push(`a.entity_label ILIKE '%' || $${idx++} || '%'`); params.push(q); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total for pagination
    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM mcogs_audit_log a ${where}`, params
    );

    // Fetch page
    const { rows } = await pool.query(`
      SELECT a.*
      FROM   mcogs_audit_log a
      ${where}
      ORDER BY a.created_at DESC
      LIMIT  $${idx++}
      OFFSET $${idx++}
    `, [...params, limit, offset]);

    res.json({ items: rows, total, limit, offset });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to query audit log' } });
  }
});

// GET /api/audit/entity/:type/:id — full audit history for a specific entity
// Returns all audit entries for a given entity, ordered chronologically (oldest first)
router.get('/entity/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { rows } = await pool.query(`
      SELECT *
      FROM   mcogs_audit_log
      WHERE  entity_type = $1 AND entity_id = $2
      ORDER BY created_at ASC
    `, [type, id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to query entity audit history' } });
  }
});

// GET /api/audit/field/:type/:id/:field — history of a specific field on a specific entity
// Returns only entries where field_changes contains the given field key
router.get('/field/:type/:id/:field', async (req, res) => {
  try {
    const { type, id, field } = req.params;
    const { rows } = await pool.query(`
      SELECT *
      FROM   mcogs_audit_log
      WHERE  entity_type = $1
        AND  entity_id = $2
        AND  field_changes ? $3
      ORDER BY created_at ASC
    `, [type, id, field]);

    // Extract just the field values for a cleaner response
    const history = rows.map(r => ({
      id: r.id,
      action: r.action,
      user_email: r.user_email,
      user_name: r.user_name,
      old_value: r.field_changes?.[field]?.old ?? null,
      new_value: r.field_changes?.[field]?.new ?? null,
      context: r.context,
      related_entities: r.related_entities,
      created_at: r.created_at,
    }));

    res.json(history);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to query field audit history' } });
  }
});

// GET /api/audit/stats — summary stats for dashboard
router.get('/stats', async (req, res) => {
  try {
    const { from, to } = req.query;
    const conditions = [];
    const params = [];
    let idx = 1;
    if (from) { conditions.push(`created_at >= $${idx++}`); params.push(from); }
    if (to)   { conditions.push(`created_at < ($${idx++})::date + 1`); params.push(to); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT
        action,
        entity_type,
        COUNT(*)::int AS count
      FROM mcogs_audit_log
      ${where}
      GROUP BY action, entity_type
      ORDER BY count DESC
    `, params);

    const { rows: [{ total }] } = await pool.query(
      `SELECT COUNT(*)::int AS total FROM mcogs_audit_log ${where}`, params
    );

    const { rows: recentUsers } = await pool.query(`
      SELECT user_email, user_name, COUNT(*)::int AS action_count,
             MAX(created_at) AS last_action
      FROM   mcogs_audit_log
      ${where}
      GROUP BY user_email, user_name
      ORDER BY action_count DESC
      LIMIT 20
    `, params);

    res.json({ total, by_action_entity: rows, recent_users: recentUsers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to query audit stats' } });
  }
});

module.exports = router;
