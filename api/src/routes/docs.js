const router = require('express').Router();
const fs     = require('fs');
const path   = require('path');

// GET /api/docs/claude-md  — returns raw CLAUDE.md content (dev-only on frontend)
router.get('/claude-md', async (req, res) => {
  try {
    // Try multiple possible locations and case variants (Linux is case-sensitive)
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const cwdRoot  = process.cwd();
    const cwdParent = path.resolve(cwdRoot, '..');
    const candidates = [
      path.join(repoRoot,  'CLAUDE.md'),
      path.join(repoRoot,  'claude.md'),
      path.join(cwdRoot,   'CLAUDE.md'),
      path.join(cwdRoot,   'claude.md'),
      path.join(cwdParent, 'CLAUDE.md'),
      path.join(cwdParent, 'claude.md'),
      '/var/www/menu-cogs/CLAUDE.md',
      '/var/www/menu-cogs/claude.md',
    ];

    let content = null;
    for (const filePath of candidates) {
      if (fs.existsSync(filePath)) {
        content = fs.readFileSync(filePath, 'utf-8');
        break;
      }
    }

    if (!content) {
      console.error('[docs] CLAUDE.md not found. __dirname:', __dirname, 'cwd:', process.cwd(), 'Tried:', candidates);
      return res.status(404).json({
        error: { message: 'CLAUDE.md not found on server' },
        debug: { __dirname, cwd: process.cwd(), candidates },
      });
    }

    res.json({ content });
  } catch (err) {
    console.error('[docs] Error reading CLAUDE.md:', err.message);
    res.status(500).json({ error: { message: 'Failed to read CLAUDE.md' } });
  }
});

module.exports = router;
