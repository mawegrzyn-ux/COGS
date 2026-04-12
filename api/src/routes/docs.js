const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');

// GET /api/docs/claude-md  — returns raw CLAUDE.md content
router.get('/claude-md', async (_req, res) => {
  try {
    const filePath = path.resolve(__dirname, '..', '..', '..', 'CLAUDE.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (err) {
    res.status(404).json({ error: { message: 'CLAUDE.md not found' } });
  }
});

module.exports = router;
