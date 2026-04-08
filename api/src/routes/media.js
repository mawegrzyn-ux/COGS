'use strict';
// =============================================================================
// Media Library — upload, browse, organise, delete images
//
// Variants generated per upload (via sharp, with graceful fallback):
//   original  — as uploaded, stored at storage_key
//   _thumb    — 300px longest edge, used in library grid
//   _web      — 1200px longest edge, stored as image_url on entities
//
// Storage backends: 'local' (disk at /uploads/) or 's3' (AWS S3).
// Each item carries its own storage_type so both can coexist; switching the
// setting only affects new uploads — old items stay where they are.
//
// Routes
//   GET    /api/media                    list items + categories
//   POST   /api/media/upload             multi-file upload
//   PUT    /api/media/:id                rename / change category / change scope
//   DELETE /api/media/:id                delete file(s) + DB record
//   POST   /api/media/bulk               bulk move-to-category or bulk delete
//   GET    /api/media/categories         list categories with item counts
//   POST   /api/media/categories         create category
//   PUT    /api/media/categories/:id     rename category
//   DELETE /api/media/categories/:id     delete category (items become uncategorised)
//   POST   /api/media/migrate-to-s3      SSE stream: migrate all local items to S3
// =============================================================================

const router = require('express').Router();
const pool   = require('../db/pool');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

// ── sharp (optional — graceful fallback if not installed) ──────────────────
let sharp = null;
try { sharp = require('sharp'); } catch { /* not installed yet — variants = original */ }

// ── multer ────────────────────────────────────────────────────────────────────
const ACCEPTED = ['image/jpeg','image/png','image/webp','image/gif','image/avif'];
const upload   = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => ACCEPTED.includes(file.mimetype) ? cb(null, true) : cb(new Error(`Unsupported type: ${file.mimetype}`)),
});

// ── Storage helpers ────────────────────────────────────────────────────────────

async function getStorageCfg() {
  try {
    const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id=1`);
    return rows[0]?.data?.storage || { type: 'local' };
  } catch { return { type: 'local' }; }
}

function getUploadsDir() {
  const dir = path.join(__dirname, '../../../uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getAppBaseUrl() {
  return (process.env.APP_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
}

function localUrl(filename) {
  return `${getAppBaseUrl()}/uploads/${filename}`;
}

async function s3Upload(cfg, key, buffer, mimeType) {
  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const region = cfg.s3_region || 'us-east-1';
  const s3 = new S3Client({ region, credentials: { accessKeyId: cfg.s3_access_key, secretAccessKey: cfg.s3_secret_key } });
  await s3.send(new PutObjectCommand({ Bucket: cfg.s3_bucket, Key: key, Body: buffer, ContentType: mimeType }));
  const baseUrl = (cfg.s3_base_url || `https://${cfg.s3_bucket}.s3.${region}.amazonaws.com`).replace(/\/$/, '');
  return `${baseUrl}/${key}`;
}

async function s3Delete(cfg, key) {
  try {
    const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: cfg.s3_region || 'us-east-1', credentials: { accessKeyId: cfg.s3_access_key, secretAccessKey: cfg.s3_secret_key } });
    await s3.send(new DeleteObjectCommand({ Bucket: cfg.s3_bucket, Key: key }));
  } catch { /* best-effort */ }
}

function makeKey(baseName, suffix, ext) {
  return `media/${baseName}${suffix}${ext}`;
}

// Generate a unique base name (timestamp + random)
function uniqueBase() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ── Image variant generation ──────────────────────────────────────────────────

async function generateVariants(buffer, mimeType) {
  if (!sharp || mimeType === 'image/gif') {
    // No sharp or animated GIF — serve original for all variants
    return { original: buffer, thumb: buffer, web: buffer, width: null, height: null };
  }
  try {
    const img      = sharp(buffer);
    const meta     = await img.metadata();
    const width    = meta.width  || null;
    const height   = meta.height || null;
    const thumbBuf = await sharp(buffer).resize(300, 300, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const webBuf   = await sharp(buffer).resize(1200, 1200, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
    return { original: buffer, thumb: thumbBuf, web: webBuf, width, height };
  } catch {
    return { original: buffer, thumb: buffer, web: buffer, width: null, height: null };
  }
}

// ── Save one file (all variants) to the configured storage backend ─────────────

async function saveFile(cfg, base, ext, mimeType, variants, uploadedBy, categoryId, scope, formKey) {
  const origKey  = makeKey(base, '',       ext);
  const thumbKey = makeKey(base, '_thumb', ext === '.gif' ? ext : '.jpg');
  const webKey   = makeKey(base, '_web',   ext === '.gif' ? ext : '.jpg');
  let   url, thumbUrl, webUrl, storageType;

  if (cfg.type === 's3' && cfg.s3_bucket && cfg.s3_access_key && cfg.s3_secret_key) {
    storageType = 's3';
    [url, thumbUrl, webUrl] = await Promise.all([
      s3Upload(cfg, origKey,  variants.original, mimeType),
      s3Upload(cfg, thumbKey, variants.thumb,    variants.thumb === variants.original ? mimeType : 'image/jpeg'),
      s3Upload(cfg, webKey,   variants.web,      variants.web   === variants.original ? mimeType : 'image/jpeg'),
    ]);
  } else {
    storageType = 'local';
    const dir = getUploadsDir();
    fs.writeFileSync(path.join(dir, path.basename(origKey)),  variants.original);
    fs.writeFileSync(path.join(dir, path.basename(thumbKey)), variants.thumb);
    fs.writeFileSync(path.join(dir, path.basename(webKey)),   variants.web);
    url      = localUrl(path.basename(origKey));
    thumbUrl = localUrl(path.basename(thumbKey));
    webUrl   = localUrl(path.basename(webKey));
  }

  const { rows } = await pool.query(
    `INSERT INTO mcogs_media_items
       (filename, original_filename, url, thumb_url, web_url,
        storage_type, storage_key, thumb_key, web_key,
        mime_type, size_bytes, width, height, scope, form_key,
        category_id, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     RETURNING *`,
    [path.basename(origKey), base + ext, url, thumbUrl, webUrl,
     storageType, origKey, thumbKey, webKey,
     mimeType, variants.original.length,
     variants.width, variants.height,
     scope || 'shared', formKey || null,
     categoryId || null, uploadedBy || null]
  );
  return rows[0];
}

// ── Delete one item from storage ──────────────────────────────────────────────

async function deleteItemStorage(item) {
  if (item.storage_type === 's3') {
    const cfg = await getStorageCfg();
    await Promise.all([
      item.storage_key ? s3Delete(cfg, item.storage_key) : Promise.resolve(),
      item.thumb_key   ? s3Delete(cfg, item.thumb_key)   : Promise.resolve(),
      item.web_key     ? s3Delete(cfg, item.web_key)     : Promise.resolve(),
    ]);
  } else {
    const dir = getUploadsDir();
    for (const key of [item.storage_key, item.thumb_key, item.web_key]) {
      if (!key) continue;
      try { fs.unlinkSync(path.join(dir, path.basename(key))); } catch { /* gone already */ }
    }
  }
}

// ── Category item count helper ────────────────────────────────────────────────

async function fetchCategories() {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.sort_order,
           COUNT(m.id)::int AS item_count
    FROM   mcogs_media_categories c
    LEFT JOIN mcogs_media_items m ON m.category_id = c.id
    GROUP  BY c.id
    ORDER  BY c.sort_order, c.name
  `);
  return rows;
}

// ── GET /api/media ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { category_id, scope, form_key, q } = req.query;
    const conds = [];
    const vals  = [];

    if (category_id === 'none') {
      conds.push('m.category_id IS NULL');
    } else if (category_id) {
      vals.push(Number(category_id));
      conds.push(`m.category_id = $${vals.length}`);
    }
    if (scope) {
      vals.push(scope);
      conds.push(`m.scope = $${vals.length}`);
    }
    if (form_key) {
      vals.push(form_key);
      conds.push(`(m.form_key = $${vals.length} OR m.scope = 'shared')`);
    }
    if (q) {
      vals.push(`%${q.toLowerCase()}%`);
      conds.push(`LOWER(m.filename) LIKE $${vals.length}`);
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows: items } = await pool.query(`
      SELECT m.*, c.name AS category_name
      FROM   mcogs_media_items m
      LEFT JOIN mcogs_media_categories c ON c.id = m.category_id
      ${where}
      ORDER BY m.created_at DESC
    `, vals);

    const categories = await fetchCategories();
    res.json({ items, categories });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /api/media/upload ────────────────────────────────────────────────────
// Bulk routes must come BEFORE /:id

router.post('/upload', upload.array('images', 50), async (req, res) => {
  try {
    const files      = req.files || [];
    if (!files.length) return res.status(400).json({ error: { message: 'No images uploaded' } });

    const cfg        = await getStorageCfg();
    const categoryId = req.body.category_id ? Number(req.body.category_id) : null;
    const scope      = req.body.scope      || 'shared';
    const formKey    = req.body.form_key   || null;
    const uploadedBy = req.user?.sub       || null;

    // Duplicate check per file
    const { rows: existing } = await pool.query(
      `SELECT original_filename FROM mcogs_media_items WHERE scope = $1 AND (form_key = $2 OR form_key IS NULL)`,
      [scope, formKey]
    );
    const existingNames = new Set(existing.map(r => r.original_filename.toLowerCase()));

    const results = [];
    for (const file of files) {
      const ext      = path.extname(file.originalname).toLowerCase() || '.jpg';
      const base     = uniqueBase();
      const isDupe   = existingNames.has(file.originalname.toLowerCase());
      const variants = await generateVariants(file.buffer, file.mimetype);
      const item     = await saveFile(cfg, base, ext, file.mimetype, variants, uploadedBy, categoryId, scope, formKey);
      results.push({ ...item, duplicate_of: isDupe ? file.originalname : null });
    }

    res.json({ items: results });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /api/media/bulk ──────────────────────────────────────────────────────

router.post('/bulk', async (req, res) => {
  try {
    const { ids, action, category_id } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: { message: 'ids required' } });

    if (action === 'move_category') {
      await pool.query(
        `UPDATE mcogs_media_items SET category_id=$1, updated_at=NOW() WHERE id = ANY($2::int[])`,
        [category_id || null, ids]
      );
      return res.json({ ok: true, updated: ids.length });
    }

    if (action === 'delete') {
      const { rows } = await pool.query(`SELECT * FROM mcogs_media_items WHERE id = ANY($1::int[])`, [ids]);
      await Promise.all(rows.map(deleteItemStorage));
      await pool.query(`DELETE FROM mcogs_media_items WHERE id = ANY($1::int[])`, [ids]);
      return res.json({ ok: true, deleted: ids.length });
    }

    res.status(400).json({ error: { message: `Unknown action: ${action}` } });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /api/media/migrate-to-s3 — SSE stream ───────────────────────────────

router.post('/migrate-to-s3', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const cfg = await getStorageCfg();
    if (cfg.type !== 's3' || !cfg.s3_bucket) {
      send({ error: 'S3 is not configured. Set bucket/region/keys in Storage settings first.' });
      return res.end();
    }

    const { rows } = await pool.query(`SELECT * FROM mcogs_media_items WHERE storage_type = 'local' ORDER BY id`);
    send({ total: rows.length, done: 0, message: `Found ${rows.length} local items to migrate` });

    let done = 0;
    for (const item of rows) {
      try {
        const dir = getUploadsDir();
        const readFile = (key) => {
          try { return fs.readFileSync(path.join(dir, path.basename(key))); } catch { return null; }
        };
        const origBuf  = readFile(item.storage_key);
        const thumbBuf = readFile(item.thumb_key);
        const webBuf   = readFile(item.web_key);

        if (!origBuf) { send({ skip: item.id, reason: 'local file not found' }); done++; continue; }

        const [url, thumbUrl, webUrl] = await Promise.all([
          s3Upload(cfg, item.storage_key,  origBuf,           item.mime_type),
          thumbBuf ? s3Upload(cfg, item.thumb_key, thumbBuf, 'image/jpeg') : Promise.resolve(item.thumb_url),
          webBuf   ? s3Upload(cfg, item.web_key,   webBuf,   'image/jpeg') : Promise.resolve(item.web_url),
        ]);

        await pool.query(
          `UPDATE mcogs_media_items SET storage_type='s3', url=$1, thumb_url=$2, web_url=$3, updated_at=NOW() WHERE id=$4`,
          [url, thumbUrl, webUrl, item.id]
        );

        // Clean up local files
        for (const key of [item.storage_key, item.thumb_key, item.web_key]) {
          if (key) try { fs.unlinkSync(path.join(dir, path.basename(key))); } catch {}
        }

        done++;
        send({ done, total: rows.length, item_id: item.id, filename: item.filename });
      } catch (err) {
        done++;
        send({ error_item: item.id, reason: err.message });
      }
    }

    send({ complete: true, migrated: done });
    res.end();
  } catch (err) {
    send({ error: err.message });
    res.end();
  }
});

// ── Category routes (before /:id) ─────────────────────────────────────────────

router.get('/categories', async (_req, res) => {
  try { res.json(await fetchCategories()); }
  catch (err) { res.status(500).json({ error: { message: err.message } }); }
});

router.post('/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: { message: 'Name required' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_media_categories (name) VALUES ($1) RETURNING *`,
      [name.trim()]
    );
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});

router.put('/categories/:id', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: { message: 'Name required' } });
    const { rows } = await pool.query(
      `UPDATE mcogs_media_categories SET name=$1 WHERE id=$2 RETURNING *`,
      [name.trim(), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await pool.query(`UPDATE mcogs_media_items SET category_id=NULL WHERE category_id=$1`, [req.params.id]);
    await pool.query(`DELETE FROM mcogs_media_categories WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});

// ── PUT /api/media/:id ────────────────────────────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const { filename, category_id, scope, form_key } = req.body;
    const sets  = [];
    const vals  = [];

    if (filename !== undefined) { vals.push(filename); sets.push(`filename=$${vals.length}`); }
    if (category_id !== undefined) { vals.push(category_id || null); sets.push(`category_id=$${vals.length}`); }
    if (scope !== undefined) { vals.push(scope); sets.push(`scope=$${vals.length}`); }
    if (form_key !== undefined) { vals.push(form_key || null); sets.push(`form_key=$${vals.length}`); }

    if (!sets.length) return res.status(400).json({ error: { message: 'Nothing to update' } });
    sets.push('updated_at=NOW()');
    vals.push(req.params.id);

    const { rows } = await pool.query(
      `UPDATE mcogs_media_items SET ${sets.join(',')} WHERE id=$${vals.length} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});

// ── DELETE /api/media/:id ──────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_media_items WHERE id=$1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    await deleteItemStorage(rows[0]);
    await pool.query(`DELETE FROM mcogs_media_items WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: { message: err.message } }); }
});

module.exports = router;
