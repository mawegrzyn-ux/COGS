'use strict';
/**
 * Seed / clear routes — for development and testing only.
 *
 * POST /api/seed         — clear + seed test data
 * POST /api/seed/clear   — clear all table data (keeps schema)
 */

const router = require('express').Router();
const pool   = require('../db/pool');
const { seedData, clearData } = require('../../scripts/seed-test-data');

// POST /seed — clear existing data then load test data
router.post('/', async (req, res) => {
  const client = await pool.connect();
  const log    = [];
  const push   = (msg) => { log.push(msg); };

  try {
    await client.query('BEGIN');

    push('Clearing existing data…');
    await clearData(client);
    push('Database cleared.');

    push('Seeding test data…');
    const summary = await seedData(client, push);

    await client.query('COMMIT');

    res.json({
      success: true,
      summary,
      log,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Error:', err.message);
    res.status(500).json({ error: { message: err.message }, log });
  } finally {
    client.release();
  }
});

// POST /seed/clear — wipe all data, keep schema
router.post('/clear', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await clearData(client);
    await client.query('COMMIT');
    res.json({ success: true, log: ['All table data cleared. Schema preserved.'] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed/clear] Error:', err.message);
    res.status(500).json({ error: { message: err.message } });
  } finally {
    client.release();
  }
});

module.exports = router;
