const router = require('express').Router();
const pool   = require('../db/pool');

// POST /feedback — submit feedback from the app
router.post('/', async (req, res) => {
  const { type = 'general', title, description, page } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: { message: 'title is required' } });
  const validTypes = ['bug', 'feature', 'general'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: { message: `type must be one of: ${validTypes.join(', ')}` } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_feedback (type, title, description, page)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [type, title.trim(), description?.trim() || null, page?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to submit feedback' } });
  }
});

module.exports = router;
