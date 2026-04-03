// Users management — CRUD for mcogs_users + BP scope assignments
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');

const auth  = requireAuth;
const admin = requirePermission('users', 'write');
const adminRead = requirePermission('users', 'read');

// GET /api/users — list all users with role + BP assignments
router.get('/', auth, adminRead, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.auth0_sub, u.email, u.name, u.picture,
        u.status, u.is_dev, u.created_at, u.last_login_at,
        u.role_id,
        r.name AS role_name,
        COALESCE(
          json_agg(
            json_build_object('id', bp.id, 'name', bp.name)
            ORDER BY bp.name
          ) FILTER (WHERE bp.id IS NOT NULL),
          '[]'
        ) AS brand_partners
      FROM mcogs_users u
      LEFT JOIN mcogs_roles r ON r.id = u.role_id
      LEFT JOIN mcogs_user_brand_partners ubp ON ubp.user_id = u.id
      LEFT JOIN mcogs_brand_partners bp ON bp.id = ubp.brand_partner_id
      GROUP BY u.id, r.name
      ORDER BY u.created_at ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// PUT /api/users/:id — update status, role, and BP assignments
router.put('/:id', auth, admin, async (req, res) => {
  const { id } = req.params;
  const { status, role_id, brand_partner_ids, is_dev } = req.body;

  // Prevent self-demotion from admin
  if (Number(id) === req.user.id && status === 'disabled') {
    return res.status(400).json({ error: { message: 'You cannot disable your own account.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updates = [];
    const vals    = [];
    let   idx     = 1;

    if (status !== undefined)  { updates.push(`status = $${idx++}`);  vals.push(status); }
    if (role_id !== undefined) { updates.push(`role_id = $${idx++}`); vals.push(role_id); }
    if (is_dev  !== undefined) { updates.push(`is_dev  = $${idx++}`); vals.push(!!is_dev); }

    if (updates.length > 0) {
      vals.push(id);
      await client.query(
        `UPDATE mcogs_users SET ${updates.join(', ')} WHERE id = $${idx}`,
        vals
      );
    }

    // Replace BP scope
    if (Array.isArray(brand_partner_ids)) {
      await client.query('DELETE FROM mcogs_user_brand_partners WHERE user_id = $1', [id]);
      for (const bpId of brand_partner_ids) {
        await client.query(
          'INSERT INTO mcogs_user_brand_partners (user_id, brand_partner_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [id, bpId]
        );
      }
    }

    await client.query('COMMIT');

    const { rows: [updated] } = await pool.query(`
      SELECT u.*, r.name AS role_name
      FROM mcogs_users u
      LEFT JOIN mcogs_roles r ON r.id = u.role_id
      WHERE u.id = $1
    `, [id]);
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: { message: err.message } });
  } finally {
    client.release();
  }
});

// DELETE /api/users/:id — remove user (cannot delete yourself)
router.delete('/:id', auth, admin, async (req, res) => {
  const { id } = req.params;
  if (Number(id) === req.user.id) {
    return res.status(400).json({ error: { message: 'You cannot delete your own account.' } });
  }
  try {
    await pool.query('DELETE FROM mcogs_users WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
