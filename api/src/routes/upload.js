const router = require('express').Router();
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const pool   = require('../db/pool');

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ACCEPTED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, WebP and GIF images are accepted'));
  },
});

async function getStorageCfg() {
  try {
    const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id=1`);
    return rows[0]?.data?.storage || { type: 'local' };
  } catch {
    return { type: 'local' };
  }
}

// POST /api/upload
router.post('/', upload.single('image'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'No image file provided' } });

    const cfg = await getStorageCfg();

    // ── S3 path ─────────────────────────────────────────────────────────────
    if (cfg.type === 's3' && cfg.s3_bucket && cfg.s3_access_key && cfg.s3_secret_key) {
      let S3Client, PutObjectCommand;
      try {
        ({ S3Client, PutObjectCommand } = require('@aws-sdk/client-s3'));
      } catch {
        return res.status(500).json({ error: { message: 'S3 is configured but @aws-sdk/client-s3 is not installed. Run: npm install @aws-sdk/client-s3' } });
      }
      const region = cfg.s3_region || 'us-east-1';
      const s3 = new S3Client({
        region,
        credentials: { accessKeyId: cfg.s3_access_key, secretAccessKey: cfg.s3_secret_key },
      });
      const ext = path.extname(req.file.originalname).toLowerCase() || '.jpg';
      const key = `images/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket:      cfg.s3_bucket,
        Key:         key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype,
      }));
      const baseUrl = (cfg.s3_base_url || `https://${cfg.s3_bucket}.s3.${region}.amazonaws.com`).replace(/\/$/, '');
      return res.json({ url: `${baseUrl}/${key}` });
    }

    // ── Local disk path ──────────────────────────────────────────────────────
    const uploadsDir = path.join(__dirname, '../../../uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const ext  = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, name), req.file.buffer);
    const baseUrl = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
    return res.json({ url: `${baseUrl}/uploads/${name}` });

  } catch (err) { next(err); }
});

// Multer error handler
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: { message: 'Image too large — maximum 5 MB' } });
  if (err.message) return res.status(400).json({ error: { message: err.message } });
  next(err);
});

module.exports = router;
