// Users management — CRUD for mcogs_users + scope assignments
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { logAudit } = require('../helpers/audit');

const auth      = requireAuth;
const admin     = requirePermission('users', 'write');
const adminRead = requirePermission('users', 'read');

// ── GET /api/users — list every user with role + scope rows ──────────────────
router.get('/', auth, adminRead, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.auth0_sub, u.email, u.name, u.picture,
        u.status, u.is_dev, u.created_at, u.last_login_at,
        u.role_id,
        r.name AS role_name,
        COALESCE((
          SELECT json_agg(json_build_object(
            'id',          us.id,
            'scope_type',  us.scope_type,
            'scope_id',    us.scope_id,
            'scope_name',
              CASE us.scope_type
                WHEN 'brand_partner' THEN (SELECT name FROM mcogs_brand_partners WHERE id = us.scope_id)
                WHEN 'country'       THEN (SELECT name FROM mcogs_countries      WHERE id = us.scope_id)
              END,
            'access_mode', us.access_mode,
            'role_id',     us.role_id,
            'role_name',   (SELECT name FROM mcogs_roles WHERE id = us.role_id)
          ) ORDER BY us.scope_type, us.scope_id)
          FROM mcogs_user_scope us
          WHERE us.user_id = u.id
        ), '[]') AS scope
      FROM mcogs_users u
      LEFT JOIN mcogs_roles r ON r.id = u.role_id
      ORDER BY u.created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── GET /api/users/:id/scope — the user's scope rows ──────────────────────────
router.get('/:id/scope', auth, adminRead, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT us.id, us.scope_type, us.scope_id, us.access_mode, us.role_id,
             CASE us.scope_type
               WHEN 'brand_partner' THEN (SELECT name FROM mcogs_brand_partners WHERE id = us.scope_id)
               WHEN 'country'       THEN (SELECT name FROM mcogs_countries      WHERE id = us.scope_id)
             END AS scope_name,
             (SELECT name FROM mcogs_roles WHERE id = us.role_id) AS role_name
      FROM mcogs_user_scope us
      WHERE us.user_id = $1
      ORDER BY us.scope_type, us.scope_id
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── PUT /api/users/:id/scope — replace the user's scope rows in one call ─────
// Body: { scope: [{ scope_type, scope_id, access_mode, role_id|null }, ...] }
//
// Diffs against the current set so the audit log records add/remove/change
// rather than a single opaque "scope updated" entry. Bulk add uses this:
// the UI sends the full desired state, we figure out the deltas.
router.put('/:id/scope', auth, admin, async (req, res) => {
  const { id } = req.params;
  const incoming = Array.isArray(req.body?.scope) ? req.body.scope : null;
  if (!incoming) return res.status(400).json({ error: { message: 'scope (array) is required' } });

  // Validate each row
  const valid = [];
  for (const row of incoming) {
    const scope_type  = String(row.scope_type || '').trim();
    const scope_id    = Number(row.scope_id);
    const access_mode = String(row.access_mode || 'grant').trim();
    const role_id     = row.role_id == null ? null : Number(row.role_id);
    if (!['brand_partner', 'country'].includes(scope_type)) return res.status(400).json({ error: { message: `Invalid scope_type "${scope_type}"` } });
    if (!Number.isFinite(scope_id) || scope_id <= 0)        return res.status(400).json({ error: { message: 'scope_id must be a positive integer' } });
    if (!['grant', 'deny'].includes(access_mode))           return res.status(400).json({ error: { message: `Invalid access_mode "${access_mode}"` } });
    valid.push({ scope_type, scope_id, access_mode, role_id });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Snapshot the existing scope rows so the audit log can describe deltas.
    const { rows: existing } = await client.query(
      'SELECT scope_type, scope_id, access_mode, role_id FROM mcogs_user_scope WHERE user_id = $1',
      [id]
    );
    const keyOf = r => `${r.scope_type}:${r.scope_id}`;
    const oldByKey = new Map(existing.map(r => [keyOf(r), r]));
    const newByKey = new Map(valid.map(r => [keyOf(r), r]));

    const added   = [];
    const removed = [];
    const changed = [];
    for (const [k, row] of newByKey) {
      const prev = oldByKey.get(k);
      if (!prev) { added.push(row); continue; }
      if (prev.access_mode !== row.access_mode || prev.role_id !== row.role_id) {
        changed.push({ from: prev, to: row });
      }
    }
    for (const [k, row] of oldByKey) {
      if (!newByKey.has(k)) removed.push(row);
    }

    // Replace in one go (DELETE + INSERT) — simpler than ON CONFLICT for a
    // small per-user set, and we already have the diff for audit logging.
    await client.query('DELETE FROM mcogs_user_scope WHERE user_id = $1', [id]);
    for (const row of valid) {
      await client.query(
        `INSERT INTO mcogs_user_scope (user_id, scope_type, scope_id, access_mode, role_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, row.scope_type, row.scope_id, row.access_mode, row.role_id]
      );
    }

    await client.query('COMMIT');

    // Audit — one entry per delta so the trail is granular
    const { rows: [user] } = await pool.query('SELECT email, name FROM mcogs_users WHERE id=$1', [id]);
    const label = user?.email || user?.name || `user:${id}`;
    for (const a of added) {
      await logAudit(pool, req, {
        action: 'create', entity_type: 'user_scope', entity_id: Number(id), entity_label: label,
        field_changes: { added: { old: null, new: a } },
        context: { source: 'scope-editor' },
      });
    }
    for (const r of removed) {
      await logAudit(pool, req, {
        action: 'delete', entity_type: 'user_scope', entity_id: Number(id), entity_label: label,
        field_changes: { removed: { old: r, new: null } },
        context: { source: 'scope-editor' },
      });
    }
    for (const c of changed) {
      await logAudit(pool, req, {
        action: 'update', entity_type: 'user_scope', entity_id: Number(id), entity_label: label,
        field_changes: { changed: { old: c.from, new: c.to } },
        context: { source: 'scope-editor' },
      });
    }

    res.json({ ok: true, added: added.length, removed: removed.length, changed: changed.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: { message: err.message } });
  } finally {
    client.release();
  }
});

// ── PUT /api/users/:id — update status, default role, is_dev (NOT scope) ─────
// Scope changes go through PUT /:id/scope so the audit trail is granular.
router.put('/:id', auth, admin, async (req, res) => {
  const { id } = req.params;
  const { status, role_id, is_dev } = req.body;

  // Prevent self-disable
  if (Number(id) === req.user.id && status === 'disabled') {
    return res.status(400).json({ error: { message: 'You cannot disable your own account.' } });
  }

  try {
    const updates = [];
    const vals    = [];
    let   idx     = 1;

    if (status !== undefined)  { updates.push(`status = $${idx++}`);  vals.push(status); }
    if (role_id !== undefined) { updates.push(`role_id = $${idx++}`); vals.push(role_id); }
    if (is_dev  !== undefined) { updates.push(`is_dev  = $${idx++}`); vals.push(!!is_dev); }

    if (updates.length === 0) {
      const { rows: [u] } = await pool.query('SELECT u.*, r.name AS role_name FROM mcogs_users u LEFT JOIN mcogs_roles r ON r.id=u.role_id WHERE u.id=$1', [id]);
      return res.json(u);
    }

    vals.push(id);
    await pool.query(`UPDATE mcogs_users SET ${updates.join(', ')} WHERE id = $${idx}`, vals);

    const { rows: [updated] } = await pool.query(`
      SELECT u.*, r.name AS role_name
      FROM mcogs_users u
      LEFT JOIN mcogs_roles r ON r.id = u.role_id
      WHERE u.id = $1
    `, [id]);
    logAudit(pool, req, { action: 'update', entity_type: 'user', entity_id: Number(id), entity_label: updated?.email || updated?.name });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── DELETE /api/users/:id — remove user (cannot delete yourself) ─────────────
router.delete('/:id', auth, admin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: { message: 'You cannot delete your own account.' } });
  }
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_users WHERE id=$1', [id]);
    await pool.query('DELETE FROM mcogs_users WHERE id = $1', [id]);
    logAudit(pool, req, { action: 'delete', entity_type: 'user', entity_id: Number(id), entity_label: old?.email || old?.name });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
