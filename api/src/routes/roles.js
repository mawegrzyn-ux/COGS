// Roles management — CRUD for mcogs_roles + permission matrix
const router = require('express').Router();
const pool   = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');

const auth  = requireAuth;
const admin = requirePermission('users', 'write');

const FEATURES = ['dashboard','inventory','recipes','menus','allergens','haccp','markets','categories','settings','import','ai_chat','users'];

// GET /api/roles — list all roles with their permissions
router.get('/', auth, requirePermission('users', 'read'), async (req, res) => {
  try {
    const { rows: roles } = await pool.query(
      'SELECT * FROM mcogs_roles ORDER BY is_system DESC, name ASC'
    );
    const { rows: perms } = await pool.query(
      'SELECT * FROM mcogs_role_permissions'
    );
    const permsByRole = {};
    for (const p of perms) {
      if (!permsByRole[p.role_id]) permsByRole[p.role_id] = {};
      permsByRole[p.role_id][p.feature] = p.access;
    }
    res.json(roles.map(r => ({
      ...r,
      permissions: permsByRole[r.id] || {},
    })));
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// POST /api/roles — create a custom role (copy permissions from another role)
router.post('/', auth, admin, async (req, res) => {
  const { name, description, copy_from_role_id } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'Name is required' } });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [role] } = await client.query(
      `INSERT INTO mcogs_roles (name, description, is_system)
       VALUES ($1, $2, false) RETURNING *`,
      [name.trim(), description?.trim() || null]
    );

    // Seed permissions — copy from another role or default to 'none'
    let sourcePerms = {};
    if (copy_from_role_id) {
      const { rows } = await client.query(
        'SELECT feature, access FROM mcogs_role_permissions WHERE role_id = $1',
        [copy_from_role_id]
      );
      for (const p of rows) sourcePerms[p.feature] = p.access;
    }
    for (const f of FEATURES) {
      await client.query(
        'INSERT INTO mcogs_role_permissions (role_id, feature, access) VALUES ($1, $2, $3)',
        [role.id, f, sourcePerms[f] || 'none']
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ ...role, permissions: { ...sourcePerms } });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: { message: 'A role with that name already exists' } });
    res.status(500).json({ error: { message: err.message } });
  } finally {
    client.release();
  }
});

// PUT /api/roles/:id — update name/description and full permission matrix
router.put('/:id', auth, admin, async (req, res) => {
  const { id } = req.params;
  const { name, description, permissions } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Don't allow renaming system roles
    const { rows: [role] } = await client.query('SELECT * FROM mcogs_roles WHERE id = $1', [id]);
    if (!role) return res.status(404).json({ error: { message: 'Role not found' } });

    if (!role.is_system && name?.trim()) {
      await client.query(
        'UPDATE mcogs_roles SET name = $1, description = $2, updated_at = NOW() WHERE id = $3',
        [name.trim(), description?.trim() || null, id]
      );
    } else if (description !== undefined) {
      await client.query(
        'UPDATE mcogs_roles SET description = $1, updated_at = NOW() WHERE id = $2',
        [description?.trim() || null, id]
      );
    }

    // Update permissions
    if (permissions && typeof permissions === 'object') {
      for (const [feature, access] of Object.entries(permissions)) {
        if (!FEATURES.includes(feature)) continue;
        if (!['none','read','write'].includes(access)) continue;
        // Enforce: users feature always 'none' for non-admin system roles
        if (role.is_system && role.name !== 'Admin' && feature === 'users') continue;
        await client.query(
          `INSERT INTO mcogs_role_permissions (role_id, feature, access)
           VALUES ($1, $2, $3)
           ON CONFLICT (role_id, feature) DO UPDATE SET access = EXCLUDED.access`,
          [id, feature, access]
        );
      }
    }

    await client.query('COMMIT');

    const { rows: [updated] } = await pool.query('SELECT * FROM mcogs_roles WHERE id = $1', [id]);
    const { rows: perms }     = await pool.query('SELECT feature, access FROM mcogs_role_permissions WHERE role_id = $1', [id]);
    const permMap = {};
    for (const p of perms) permMap[p.feature] = p.access;
    res.json({ ...updated, permissions: permMap });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: { message: err.message } });
  } finally {
    client.release();
  }
});

// DELETE /api/roles/:id — delete custom role (cannot delete system roles)
router.delete('/:id', auth, admin, async (req, res) => {
  try {
    const { rows: [role] } = await pool.query('SELECT * FROM mcogs_roles WHERE id = $1', [req.params.id]);
    if (!role) return res.status(404).json({ error: { message: 'Role not found' } });
    if (role.is_system) return res.status(400).json({ error: { message: 'Cannot delete a system role' } });
    await pool.query('DELETE FROM mcogs_roles WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
