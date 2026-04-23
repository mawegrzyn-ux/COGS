// =============================================================================
// Regions — sub-country administrative divisions (ISO 3166-2 style).
// Consumed by:
//   - Market create/edit modal (multi-select "Which regions does this market cover?")
//   - Regions admin UI (CRUD)
//   - Dashboard map (eventual — per-region polygon rendering)
//
// Each region belongs to exactly one country (its parent_country_id on the
// country-level market row). Regions are a shared catalog — multiple markets
// within the same country can claim the same region (franchise overlaps).
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

// ── GET /regions?country_id=X ─────────────────────────────────────────────────
// Optionally filtered by country. Returns the catalog, not market assignments.
router.get('/', async (req, res) => {
  try {
    const countryId = req.query.country_id ? parseInt(req.query.country_id, 10) : null;
    const params = countryId ? [countryId] : [];
    const where  = countryId ? 'WHERE country_id = $1' : '';
    const { rows } = await pool.query(
      `SELECT id, country_id, name, iso_code, created_at, updated_at
       FROM   mcogs_regions
       ${where}
       ORDER  BY name ASC`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch regions' } });
  }
});

// ── POST /regions ─────────────────────────────────────────────────────────────
// Body: { country_id, name, iso_code? }
router.post('/', async (req, res) => {
  const { country_id, name, iso_code } = req.body;
  if (!country_id || !name?.trim()) {
    return res.status(400).json({ error: { message: 'country_id and name are required' } });
  }
  try {
    // Reject if the parent is itself a regional market — regions live under
    // country-level markets only.
    const { rows: [parent] } = await pool.query(
      'SELECT parent_country_id FROM mcogs_countries WHERE id = $1',
      [country_id]
    );
    if (!parent) return res.status(400).json({ error: { message: 'Country not found' } });
    if (parent.parent_country_id) {
      return res.status(400).json({ error: { message: 'Regions can only hang off country-level markets.' } });
    }

    const { rows } = await pool.query(
      `INSERT INTO mcogs_regions (country_id, name, iso_code)
       VALUES ($1, $2, $3) RETURNING *`,
      [country_id, name.trim(), iso_code ? iso_code.toUpperCase().trim() : null]
    );
    logAudit(pool, req, {
      action: 'create', entity_type: 'region',
      entity_id: rows[0].id, entity_label: rows[0].name,
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: { message: 'A region with that name already exists in this country.' } });
    }
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create region' } });
  }
});

// ── PUT /regions/:id ──────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { name, iso_code } = req.body;
  if (!name?.trim()) {
    return res.status(400).json({ error: { message: 'name is required' } });
  }
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_regions WHERE id = $1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_regions SET name = $1, iso_code = $2, updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [name.trim(), iso_code ? iso_code.toUpperCase().trim() : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Region not found' } });
    logAudit(pool, req, {
      action: 'update', entity_type: 'region',
      entity_id: rows[0].id, entity_label: rows[0].name,
      field_changes: diffFields(old, rows[0], ['name', 'iso_code']),
    });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update region' } });
  }
});

// ── GET /regions/catalog ──────────────────────────────────────────────────────
// Returns the keys of the ISO 3166-2 standard catalog so the UI can show
// "Import standard regions (X available)" for the countries we know about.
router.get('/catalog', (_req, res) => {
  const summary = Object.entries(ISO_3166_2_CATALOG).map(([iso, regions]) => ({
    country_iso: iso,
    count:       Array.isArray(regions) ? regions.length : 0,
  }));
  res.json(summary);
});

// ── POST /regions/import-standard ─────────────────────────────────────────────
// Body: { country_id }
// Looks up the country's country_iso, pulls the standard ISO 3166-2 list from
// the static catalog, and bulk-inserts any missing rows. Idempotent — runs
// again will be a no-op. Returns { imported, skipped, country_iso }.
router.post('/import-standard', async (req, res) => {
  const country_id = Number(req.body?.country_id);
  if (!country_id) {
    return res.status(400).json({ error: { message: 'country_id is required' } });
  }
  try {
    const { rows: [country] } = await pool.query(
      'SELECT id, name, country_iso, parent_country_id FROM mcogs_countries WHERE id = $1',
      [country_id]
    );
    if (!country) return res.status(404).json({ error: { message: 'Country not found' } });
    if (country.parent_country_id) {
      return res.status(400).json({ error: { message: 'Regions can only be imported onto country-level markets.' } });
    }
    const iso = (country.country_iso || '').toUpperCase();
    if (!iso) {
      return res.status(400).json({ error: { message: 'Country has no country_iso set — edit the market first and pick its ISO 3166-1 code.' } });
    }
    const catalog = ISO_3166_2_CATALOG[iso];
    if (!Array.isArray(catalog) || catalog.length === 0) {
      return res.status(404).json({
        error: { message: `No standard regions catalogued for country ISO "${iso}" yet. Add them manually or request a catalog update.` },
      });
    }

    let imported = 0, skipped = 0;
    for (const region of catalog) {
      const { rowCount } = await pool.query(
        `INSERT INTO mcogs_regions (country_id, name, iso_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (country_id, name) DO NOTHING`,
        [country_id, region.name, region.code]
      );
      if (rowCount > 0) imported++; else skipped++;
    }

    logAudit(pool, req, {
      action:       'import',
      entity_type:  'region',
      entity_id:    country_id,
      entity_label: `${country.name} — ${imported} regions imported, ${skipped} already present`,
      context:      { source: 'iso3166-2-standard', country_iso: iso, imported, skipped },
    });

    res.json({ imported, skipped, country_iso: iso, total: catalog.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to import regions' } });
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
      entity_id: old?.id, entity_label: old?.name,
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete region' } });
  }
});

module.exports = router;
