const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// Ensure the settings row exists
async function ensureRow() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcogs_settings (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      data       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT single_row CHECK (id = 1)
    )
  `);
  await pool.query(`
    INSERT INTO mcogs_settings (id, data) VALUES (1, '{}')
    ON CONFLICT (id) DO NOTHING
  `);
}

// GET /settings
router.get('/', async (req, res) => {
  try {
    await ensureRow();
    const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`);
    res.json(rows[0]?.data || {});
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch settings' } });
  }
});

// PUT /settings  (full replace of data blob)
router.put('/', async (req, res) => {
  try {
    await ensureRow();
    const { rows } = await pool.query(
      `UPDATE mcogs_settings SET data = $1, updated_at = NOW() WHERE id = 1 RETURNING data`,
      [JSON.stringify(req.body)]
    );
    logAudit(pool, req, { action: 'update', entity_type: 'settings', entity_id: 1, entity_label: 'global' });
    res.json(rows[0].data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save settings' } });
  }
});

// PATCH /settings  (merge into existing data)
router.patch('/', async (req, res) => {
  try {
    await ensureRow();
    const { rows } = await pool.query(
      `UPDATE mcogs_settings
       SET data = data || $1::jsonb, updated_at = NOW()
       WHERE id = 1
       RETURNING data`,
      [JSON.stringify(req.body)]
    );
    logAudit(pool, req, { action: 'update', entity_type: 'settings', entity_id: 1, entity_label: 'global' });
    res.json(rows[0].data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update settings' } });
  }
});

module.exports = router;
