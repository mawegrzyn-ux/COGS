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
      const fileUrl = `${baseUrl}/${key}`;
      // Backfill into media library (non-blocking)
      pool.query(
        `INSERT INTO mcogs_media_items (filename, original_filename, url, thumb_url, web_url, storage_type, storage_key, mime_type, size_bytes, scope, form_key, uploaded_by)
         VALUES ($1,$2,$3,$3,$3,'s3',$4,$5,$6,'shared',$7,$8)
         ON CONFLICT DO NOTHING`,
        [path.basename(key), req.file.originalname, fileUrl, key, req.file.mimetype, req.file.size, req.body?.form_key || null, req.user?.sub || null]
      ).catch(() => {});
      return res.json({ url: fileUrl });
    }

    // ── Local disk path ──────────────────────────────────────────────────────
    const uploadsDir = path.join(__dirname, '../../../uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });
    const ext  = path.extname(req.file.originalname).toLowerCase() || '.jpg';
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, name), req.file.buffer);
    // Use relative query-param URL to avoid domain/cert issues (same pattern as media.js)
    const fileUrl = `/api/media/img?f=${encodeURIComponent(name)}`;
    // Backfill into media library (non-blocking)
    pool.query(
      `INSERT INTO mcogs_media_items (filename, original_filename, url, thumb_url, web_url, storage_type, storage_key, mime_type, size_bytes, scope, form_key, uploaded_by)
       VALUES ($1,$2,$3,$3,$3,'local',$4,$5,$6,'shared',$7,$8)
       ON CONFLICT DO NOTHING`,
      [name, req.file.originalname, fileUrl, name, req.file.mimetype, req.file.size, req.body?.form_key || null, req.user?.sub || null]
    ).catch(() => {});
    return res.json({ url: fileUrl });

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
