'use strict';
// =============================================================================
// Change Log — read-only API for the project changelog
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// GET /changelog — list all changelog entries (newest first)
router.get('/', async (req, res) => {
  try {
    const { limit } = req.query;
    const cap = Math.min(parseInt(limit) || 50, 200);
    const { rows } = await pool.query(
      'SELECT * FROM mcogs_changelog ORDER BY version DESC, id DESC LIMIT $1',
      [cap]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to fetch changelog' } });
  }
});

// GET /changelog/:version — entries for a specific version
router.get('/:version', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM mcogs_changelog WHERE version = $1 ORDER BY id',
      [req.params.version]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Version not found' } });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: 'Failed to fetch changelog version' } });
  }
});

module.exports = router;
