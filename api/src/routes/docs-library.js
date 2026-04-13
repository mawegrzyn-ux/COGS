const router = require('express').Router();
const pool   = require('../db/pool');
const multer = require('multer');
const { logAudit, diffFields } = require('../helpers/audit');

// Server-side HTML sanitisation
let DOMPurify;
try { DOMPurify = require('isomorphic-dompurify'); } catch { DOMPurify = null; }

function sanitize(html) {
  if (!DOMPurify) return html;          // graceful degradation
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1','h2','h3','h4','h5','h6','p','br','hr','blockquote','pre','code',
      'ul','ol','li','dl','dt','dd','table','thead','tbody','tfoot','tr','th','td',
      'a','img','strong','em','u','s','sub','sup','span','div','figure','figcaption',
      'colgroup','col','caption','details','summary','mark','abbr','small',
    ],
    ALLOWED_ATTR: [
      'href','src','alt','title','class','style','id','colspan','rowspan','width',
      'height','target','rel','align','valign','scope','headers','data-*',
    ],
    ALLOW_DATA_ATTR: true,
  });
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 200);
}

// ── Categories ────────────────────────────────────────────────────────────────

router.get('/categories', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_doc_categories ORDER BY sort_order, name`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load doc categories' } });
  }
});

router.post('/categories', async (req, res) => {
  const { name, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: { message: 'Name is required' } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_doc_categories (name, sort_order) VALUES ($1, $2) RETURNING *`,
      [name, sort_order || 0]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create category' } });
  }
});

router.put('/categories/:id', async (req, res) => {
  const { name, sort_order } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_doc_categories SET name = COALESCE($1, name), sort_order = COALESCE($2, sort_order) WHERE id = $3 RETURNING *`,
      [name, sort_order, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Category not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update category' } });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    await pool.query(`DELETE FROM mcogs_doc_categories WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete category' } });
  }
});

// ── HTML file upload — extract body content ──────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/upload-html', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'No file uploaded' } });
    const html = req.file.buffer.toString('utf-8');
    // Extract body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const content = bodyMatch ? bodyMatch[1].trim() : html;
    // Extract title from <title> tag if present
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : req.file.originalname.replace(/\.html?$/i, '');
    // Extract <style> blocks to preserve styling
    const styles = [];
    html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => { styles.push(css); return ''; });
    const styleBlock = styles.length ? `<style>${styles.join('\n')}</style>` : '';
    res.json({ title, content_html: styleBlock + content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to process HTML file' } });
  }
});

// ── Docs CRUD ─────────────────────────────────────────────────────────────────

// Named routes BEFORE :id
router.get('/by-slug/:slug', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM mcogs_docs WHERE slug = $1`, [req.params.slug]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Document not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load document' } });
  }
});

// GET / — list docs
router.get('/', async (req, res) => {
  const { location, category_id, search, published } = req.query;
  const conditions = [];
  const vals = [];
  if (location)    conditions.push(`d.location = $${vals.push(location)}`);
  if (category_id) conditions.push(`d.category_id = $${vals.push(parseInt(category_id, 10))}`);
  if (published !== undefined) conditions.push(`d.is_published = $${vals.push(published === 'true')}`);
  if (search)      conditions.push(`(d.title ILIKE $${vals.push(`%${search}%`)} OR d.description ILIKE $${vals.length})`);
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  try {
    const { rows } = await pool.query(`
      SELECT d.id, d.title, d.slug, d.description, d.content_type, d.location,
             d.category_id, c.name AS category_name, d.skip_sanitize,
             d.is_published, d.created_by, d.updated_by, d.created_at, d.updated_at
      FROM mcogs_docs d
      LEFT JOIN mcogs_doc_categories c ON c.id = d.category_id
      ${where}
      ORDER BY d.updated_at DESC
    `, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load documents' } });
  }
});

// GET /:id — single doc (full content)
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT d.*, c.name AS category_name
      FROM mcogs_docs d
      LEFT JOIN mcogs_doc_categories c ON c.id = d.category_id
      WHERE d.id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Document not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load document' } });
  }
});

// POST / — create doc
router.post('/', async (req, res) => {
  const { title, description, content_html, content_type, location, category_id, skip_sanitize, is_published } = req.body;
  if (!title) return res.status(400).json({ error: { message: 'Title is required' } });

  // skip_sanitize requires is_dev
  if (skip_sanitize && !req.user?.is_dev) {
    return res.status(403).json({ error: { message: 'Only developers can skip HTML sanitization' } });
  }

  const slug = slugify(req.body.slug || title);
  const finalHtml = skip_sanitize ? (content_html || '') : sanitize(content_html || '');

  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_docs (title, slug, description, content_html, content_type, location, category_id, skip_sanitize, is_published, created_by, updated_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
      RETURNING *`,
      [title, slug, description || null, finalHtml, content_type || 'wysiwyg',
       location || 'help', category_id || null, !!skip_sanitize,
       is_published !== false, req.user?.email || req.user?.sub]);

    logAudit(pool, req, { action: 'create', entity_type: 'doc', entity_id: rows[0].id, entity_label: title });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505' && err.constraint?.includes('slug')) {
      return res.status(409).json({ error: { message: 'A document with this slug already exists' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create document' } });
  }
});

// PUT /:id — update doc
router.put('/:id', async (req, res) => {
  const { title, description, content_html, content_type, location, category_id, skip_sanitize, is_published } = req.body;

  if (skip_sanitize && !req.user?.is_dev) {
    return res.status(403).json({ error: { message: 'Only developers can skip HTML sanitization' } });
  }

  try {
    const old = await pool.query(`SELECT * FROM mcogs_docs WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Document not found' } });

    const shouldSkip = skip_sanitize !== undefined ? !!skip_sanitize : old.rows[0].skip_sanitize;
    const finalHtml = content_html !== undefined
      ? (shouldSkip ? content_html : sanitize(content_html))
      : old.rows[0].content_html;
    const slug = req.body.slug ? slugify(req.body.slug) : old.rows[0].slug;

    const { rows } = await pool.query(`
      UPDATE mcogs_docs SET
        title         = COALESCE($1, title),
        slug          = $2,
        description   = COALESCE($3, description),
        content_html  = $4,
        content_type  = COALESCE($5, content_type),
        location      = COALESCE($6, location),
        category_id   = $7,
        skip_sanitize = $8,
        is_published  = COALESCE($9, is_published),
        updated_by    = $10,
        updated_at    = NOW()
      WHERE id = $11 RETURNING *`,
      [title, slug, description, finalHtml, content_type, location,
       category_id !== undefined ? category_id : old.rows[0].category_id,
       shouldSkip,
       is_published, req.user?.email || req.user?.sub, req.params.id]);

    const changes = diffFields(old.rows[0], rows[0], ['title','slug','description','location','category_id','skip_sanitize','is_published','content_type']);
    if (changes) logAudit(pool, req, { action: 'update', entity_type: 'doc', entity_id: rows[0].id, entity_label: rows[0].title, field_changes: changes });

    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505' && err.constraint?.includes('slug')) {
      return res.status(409).json({ error: { message: 'A document with this slug already exists' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update document' } });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const old = await pool.query(`SELECT id, title FROM mcogs_docs WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Document not found' } });
    await pool.query(`DELETE FROM mcogs_docs WHERE id = $1`, [req.params.id]);
    logAudit(pool, req, { action: 'delete', entity_type: 'doc', entity_id: old.rows[0].id, entity_label: old.rows[0].title });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete document' } });
  }
});

module.exports = router;
