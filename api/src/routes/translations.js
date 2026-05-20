// Translation CRUD per-entity.
// GET    /api/translations/:entityType/:entityId            → full translations JSONB
// PUT    /api/translations/:entityType/:entityId/:lang      → set/update (source: 'human', reviewed: true)
// DELETE /api/translations/:entityType/:entityId/:lang      → remove one language entry
// POST   /api/translations/warm                             → trigger AI batch translation for a language

const express = require('express');
const pool    = require('../db/pool');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { mergeTranslations } = require('../helpers/translate');
const { logAudit } = require('../helpers/audit');

const router = express.Router();
router.use(requireAuth);

// Map entity-type slug to (table, translatable fields). Keep this list in sync
// with the tables receiving a translations JSONB column in migration step 122.
const ENTITY_MAP = {
  ingredient:         { table: 'mcogs_ingredients',        fields: ['name', 'notes'] },
  recipe:             { table: 'mcogs_recipes',            fields: ['name', 'description'] },
  sales_item:         { table: 'mcogs_sales_items',        fields: ['name', 'display_name', 'description'] },
  modifier_group:     { table: 'mcogs_modifier_groups',    fields: ['name', 'description'] },
  modifier_option:    { table: 'mcogs_modifier_options',   fields: ['name'] },
  combo_step:         { table: 'mcogs_combo_steps',        fields: ['name'] },
  combo_step_option:  { table: 'mcogs_combo_step_options', fields: ['name'] },
  category:           { table: 'mcogs_categories',         fields: ['name'] },
  vendor:             { table: 'mcogs_vendors',            fields: ['name', 'notes'] },
  price_level:        { table: 'mcogs_price_levels',       fields: ['name'] },
  menu:               { table: 'mcogs_menus',              fields: ['name', 'description'] },
};

function resolveEntity(slug) {
  const cfg = ENTITY_MAP[slug];
  if (!cfg) return null;
  return cfg;
}

// ── GET all translations for an entity ─────────────────────────────────────
router.get('/:entityType/:entityId', async (req, res) => {
  const cfg = resolveEntity(req.params.entityType);
  if (!cfg) return res.status(404).json({ error: { message: 'Unknown entity type' } });
  const id = Number(req.params.entityId);
  if (!Number.isFinite(id)) return res.status(400).json({ error: { message: 'entityId must be a number' } });

  try {
    const selectFields = cfg.fields.map(f => `${f} AS base_${f}`).join(', ');
    const { rows: [row] } = await pool.query(
      `SELECT id, translations, ${selectFields} FROM ${cfg.table} WHERE id = $1`,
      [id]
    );
    if (!row) return res.status(404).json({ error: { message: 'Entity not found' } });

    const base = {};
    for (const f of cfg.fields) base[f] = row[`base_${f}`];
    res.json({ id: row.id, fields: cfg.fields, base, translations: row.translations || {} });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── PUT translation for one language (human-sourced, marked reviewed) ──────
router.put('/:entityType/:entityId/:lang', requirePermission('settings', 'write'), async (req, res) => {
  const cfg = resolveEntity(req.params.entityType);
  if (!cfg) return res.status(404).json({ error: { message: 'Unknown entity type' } });
  const id = Number(req.params.entityId);
  const lang = String(req.params.lang).toLowerCase();
  if (!Number.isFinite(id)) return res.status(400).json({ error: { message: 'entityId must be a number' } });
  if (lang === 'en') return res.status(400).json({ error: { message: 'English is the base language (edit the entity directly)' } });

  const payload = req.body || {};
  const filtered = {};
  for (const f of cfg.fields) if (payload[f] != null) filtered[f] = String(payload[f]);
  if (!Object.keys(filtered).length) return res.status(400).json({ error: { message: 'No translatable fields supplied' } });

  try {
    const { rows: [row] } = await pool.query(
      `SELECT id, translations, ${cfg.fields.join(', ')} FROM ${cfg.table} WHERE id = $1`, [id]
    );
    if (!row) return res.status(404).json({ error: { message: 'Entity not found' } });

    // Use first translated field's source text for hash (usually 'name')
    const sourceText = row[cfg.fields[0]];
    const merged = mergeTranslations(row.translations, lang, filtered, {
      source: 'human',
      sourceText,
      reviewer: req.user?.email || req.user?.name || null,
    });
    await pool.query(`UPDATE ${cfg.table} SET translations = $1 WHERE id = $2`, [merged, id]);
    await logAudit(pool, req, {
      action: 'update', entity_type: `${req.params.entityType}_translation`, entity_id: id, entity_label: `${lang}`,
      field_changes: { [lang]: { old: row.translations?.[lang] || null, new: merged[lang] } },
    });
    res.json({ id, lang, translations: merged });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── DELETE one language entry ──────────────────────────────────────────────
router.delete('/:entityType/:entityId/:lang', requirePermission('settings', 'write'), async (req, res) => {
  const cfg = resolveEntity(req.params.entityType);
  if (!cfg) return res.status(404).json({ error: { message: 'Unknown entity type' } });
  const id = Number(req.params.entityId);
  const lang = String(req.params.lang).toLowerCase();
  try {
    const { rows: [row] } = await pool.query(
      `SELECT id, translations FROM ${cfg.table} WHERE id = $1`, [id]
    );
    if (!row) return res.status(404).json({ error: { message: 'Entity not found' } });
    const next = { ...(row.translations || {}) };
    if (!next[lang]) return res.status(404).json({ error: { message: `No ${lang} translation exists` } });
    delete next[lang];
    await pool.query(`UPDATE ${cfg.table} SET translations = $1 WHERE id = $2`, [next, id]);
    await logAudit(pool, req, {
      action: 'delete', entity_type: `${req.params.entityType}_translation`, entity_id: id, entity_label: lang,
      field_changes: null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /warm — admin triggers an immediate AI pre-warm for a language ────
router.post('/warm', requirePermission('settings', 'write'), async (req, res) => {
  const lang = String(req.body?.lang || '').toLowerCase();
  const dryRun = !!req.body?.dry_run;
  if (!lang || lang === 'en') return res.status(400).json({ error: { message: 'Pass a non-English lang code' } });
  try {
    const { rows: [langRow] } = await pool.query('SELECT code, name FROM mcogs_languages WHERE code = $1 AND is_active = TRUE', [lang]);
    if (!langRow) return res.status(400).json({ error: { message: 'Language not found or inactive' } });

    const { runTranslation } = require('../jobs/translateEntities');
    const result = await runTranslation({ onlyLang: lang, dryRun });
    res.json({ ok: true, language: langRow, result });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
