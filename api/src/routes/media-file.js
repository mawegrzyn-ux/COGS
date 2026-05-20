'use strict';
// Public image server for locally-stored media library files.
// Mounted at /api/media/img (no auth) so <img src> tags work.
//
// URL format: GET /api/media/img?f=filename.jpg
// Query-param avoids Nginx extension-based static rules (location ~* \.jpg$)
// that would intercept /api/media/file/foo.jpg before the /api proxy block.

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');

const UPLOADS_DIR = path.resolve(path.join(__dirname, '../../../uploads'));

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// GET /api/media/img?f=filename.jpg
router.get('/', (req, res) => {
  const raw = req.query.f;
  if (!raw) return res.status(400).end();

  const filename = decodeURIComponent(raw);

  // Reject path traversal
  const filePath = path.resolve(path.join(UPLOADS_DIR, filename));
  if (!filePath.startsWith(UPLOADS_DIR)) {
    return res.status(403).end();
  }

  // BUG-1173 — files are content-addressed (timestamp + nanoid in the
  // name) so they never change in place. A 1-year immutable cache header
  // saves the conditional If-Modified-Since round-trip on every <img>
  // render, which keeps the rate-limited surface tiny even before the
  // skip rule in index.js kicks in.
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(filePath, err => {
    if (err) res.status(404).end();
  });
});

module.exports = router;
