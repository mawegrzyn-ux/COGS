const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');

// GET /api/docs/claude-md  — returns raw CLAUDE.md content (dev-only on frontend)
router.get('/claude-md', async (req, res) => {
  try {
    // Try multiple possible locations for CLAUDE.md
    const candidates = [
      path.resolve(__dirname, '..', '..', '..', 'CLAUDE.md'),   // repo root (local dev)
      path.resolve(process.cwd(), 'CLAUDE.md'),                  // CWD (if run from api/)
      path.resolve(process.cwd(), '..', 'CLAUDE.md'),            // CWD parent (if CWD is api/src)
    ];

    let content = null;
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8');
        break;
      }
    }

    if (!content) {
      console.error('[docs] CLAUDE.md not found. Tried:', candidates);
      return res.status(404).json({ error: { message: 'CLAUDE.md not found on server' } });
    }

    res.json({ content });
  } catch (err) {
    console.error('[docs] Error reading CLAUDE.md:', err.message);
    res.status(500).json({ error: { message: 'Failed to read CLAUDE.md' } });
  }
});

module.exports = router;
