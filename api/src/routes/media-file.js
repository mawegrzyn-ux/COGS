'use strict';
// Public static file server for locally-stored media library images.
// Registered WITHOUT requireAuth in routes/index.js so <img src> tags work.

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');

const UPLOADS_DIR = path.resolve(path.join(__dirname, '../../../uploads'));

// Ensure the directory exists on startup
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// GET /api/media/file/:filename
router.get('/:filename', (req, res) => {
  const filename = decodeURIComponent(req.params.filename);

  // Reject path traversal
  const filePath = path.resolve(path.join(UPLOADS_DIR, filename));
  if (!filePath.startsWith(UPLOADS_DIR + path.sep) && filePath !== UPLOADS_DIR) {
    return res.status(403).end();
  }

  res.sendFile(filePath, err => {
    if (err) res.status(404).end();
  });
});

module.exports = router;
