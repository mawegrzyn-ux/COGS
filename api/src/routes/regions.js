// =============================================================================
// Regions — sub-country administrative divisions (ISO 3166-2 style).
// Consumed by:
//   - Market create/edit modal (multi-select "Which regions does this market cover?")
//   - Regions admin UI (CRUD, grouped by country_iso)
//   - Dashboard map (eventual — per-region polygon rendering)
//
// The regions catalog is keyed by ISO 3166-1 alpha-2 country code (`country_iso`)
// so it's independent of the mcogs_countries (a.k.a. "markets") table. Multiple
// markets under the same country_iso may each claim their own subset of regions.
// Regions can be shared across markets (franchise overlaps allowed).
// =============================================================================

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// ISO 3166-2 standard region catalog — keyed by ISO 3166-1 alpha-2 country code.
// Loaded once at module init; reused on every import request. Covers ~30
// franchise-relevant countries. Adding more countries is a JSON edit away.
const ISO_3166_2_CATALOG = (() => {
  try {
    const p = path.resolve(__dirname, '../../data/iso3166-2.json');
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    delete obj._comment;
    return obj;
  } catch (err) {
    console.warn('[regions] Could not load ISO 3166-2 catalog:', err.message);
    return {};
  }
})();

function normIso(s) {
  return (s || '').toString().toUpperCase().trim();
}

// ── GET /regions?country_iso=XX ───────────────────────────────────────────────
// Optionally filtered by ISO 3166-1 alpha-2. Returns the catalog, not market
// assignments.
router.get('/', async (req, res) => {
  try {
    const iso = normIso(req.query.country_iso);
    const params = iso ? [iso] : [];
    const where  = iso ? 'WHERE country_iso = $1' : '';
    const { rows } = await pool.query(
      `SELECT id, country_iso, name, iso_code, created_at, updated_at
       FROM   mcogs_regions
       ${where}
       ORDER  BY country_iso, name`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch regions' } });
  }
});

// ── GET /regions/catalog ──────────────────────────────────────────────────────
// Returns the ISO 3166-2 standard catalog summary so the UI can show
// "Import standard regions (X available)" per country.
router.get('/catalog', (_req, res) => {
  const summary = Object.entries(ISO_3166_2_CATALOG).map(([iso, regions]) => ({
    country_iso: iso,
    count:       Array.isArray(regions) ? regions.length : 0,
  }));
  res.json(summary);
});

// ── POST /regions ─────────────────────────────────────────────────────────────
// Body: { country_iso, name, iso_code? }
router.post('/', async (req, res) => {
  const iso  = normIso(req.body?.country_iso);
  const name = (req.body?.name || '').trim();
  const isoCode = req.body?.iso_code ? normIso(req.body.iso_code) : null;
  if (!iso || !/^[A-Z]{2,3}$/.test(iso)) {
    return res.status(400).json({ error: { message: 'country_iso is required (2-letter ISO 3166-1)' } });
  }
  if (!name) {
    return res.status(400).json({ error: { message: 'name is required' } });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_regions (country_iso, name, iso_code)
       VALUES ($1, $2, $3) RETURNING *`,
      [iso, name, isoCode]
    );
    logAudit(pool, req, {
      action: 'create', entity_type: 'region',
      entity_id: rows[0].id, entity_label: `${iso} — ${rows[0].name}`,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { message: `A region with that name already exists for ${iso}.` } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create region' } });
  }
});

// ── POST /regions/import-standard ─────────────────────────────────────────────
// Body: { country_iso }
// Pulls the standard ISO 3166-2 list from the static catalog and bulk-inserts
// any missing rows for that ISO. Idempotent — re-runs are no-ops.
router.post('/import-standard', async (req, res) => {
  const iso = normIso(req.body?.country_iso);
  if (!iso) return res.status(400).json({ error: { message: 'country_iso is required' } });
  try {
    const catalog = ISO_3166_2_CATALOG[iso];
    if (!Array.isArray(catalog) || catalog.length === 0) {
      return res.status(404).json({
        error: { message: `No standard regions catalogued for country ISO "${iso}" yet.` },
      });
    }
    let imported = 0, skipped = 0;
    for (const region of catalog) {
      const { rowCount } = await pool.query(
        `INSERT INTO mcogs_regions (country_iso, name, iso_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (country_iso, name) DO NOTHING`,
        [iso, region.name, region.code]
      );
      if (rowCount > 0) imported++; else skipped++;
    }
    logAudit(pool, req, {
      action:       'import',
      entity_type:  'region',
      entity_label: `${iso} — imported ${imported}, skipped ${skipped}`,
      context:      { source: 'iso3166-2-standard', country_iso: iso, imported, skipped },
    });
    res.json({ imported, skipped, country_iso: iso, total: catalog.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to import regions' } });
  }
});

// ── PUT /regions/:id ──────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const name = (req.body?.name || '').trim();
  const isoCode = req.body?.iso_code ? normIso(req.body.iso_code) : null;
  if (!name) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_regions WHERE id = $1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_regions SET name = $1, iso_code = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [name, isoCode, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Region not found' } });
    logAudit(pool, req, {
      action: 'update', entity_type: 'region',
      entity_id: rows[0].id, entity_label: `${rows[0].country_iso} — ${rows[0].name}`,
      field_changes: diffFields(old, rows[0], ['name', 'iso_code']),
    });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update region' } });
  }
});

// ── DELETE /regions/:id ───────────────────────────────────────────────────────
// Cascade removes any mcogs_market_regions rows referencing this region.
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_regions WHERE id = $1', [req.params.id]);
    const { rowCount } = await pool.query('DELETE FROM mcogs_regions WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Region not found' } });
    logAudit(pool, req, {
      action: 'delete', entity_type: 'region',
      entity_id: old?.id, entity_label: `${old?.country_iso} — ${old?.name}`,
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete region' } });
  }
});

module.exports = router;
