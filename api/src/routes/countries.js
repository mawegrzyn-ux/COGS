const router  = require('express').Router();
const pool = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// GET /countries
// Each row includes `region_ids` — an array of mcogs_regions.id that this
// market covers (empty for country-level markets). Aggregated via LATERAL
// subquery so there's only one round trip.
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.*,
              COALESCE(r.region_ids, '{}'::int[]) AS region_ids
       FROM   mcogs_countries c
       LEFT   JOIN LATERAL (
         SELECT array_agg(mr.region_id ORDER BY mr.region_id) AS region_ids
         FROM   mcogs_market_regions mr
         WHERE  mr.market_id = c.id
       ) r ON true
       ORDER  BY c.name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch countries' } });
  }
});

// Validate COGS thresholds — values must be sane percentages when supplied.
function coerceThreshold(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n) || n <= 0 || n >= 100) {
    throw new Error('COGS thresholds must be a number between 0 and 100');
  }
  return n;
}

// POST /countries
router.post('/', async (req, res) => {
  const {
    name, currency_code, currency_symbol, exchange_rate,
    default_price_level_id, country_iso,
    parent_country_id,
    region_ids,                // optional array of mcogs_regions.id this market covers
    cogs_threshold_excellent,  // nullable — NULL means "inherit global setting"
    cogs_threshold_acceptable, // nullable — NULL means "inherit global setting"
  } = req.body;
  if (!name || !currency_code || !currency_symbol || exchange_rate == null)
    return res.status(400).json({ error: { message: 'name, currency_code, currency_symbol and exchange_rate are required' } });
  if (Number(exchange_rate) <= 0)
    return res.status(400).json({ error: { message: 'exchange_rate must be positive' } });
  // Guard against nested regions — a regional market's parent must itself be
  // a country-level market (parent_country_id NULL).
  if (parent_country_id) {
    const { rows: [parent] } = await pool.query(
      'SELECT parent_country_id FROM mcogs_countries WHERE id = $1',
      [parent_country_id]
    );
    if (!parent) return res.status(400).json({ error: { message: 'Parent market not found' } });
    if (parent.parent_country_id) {
      return res.status(400).json({ error: { message: 'Cannot nest a region under another region. Parent must be a country-level market.' } });
    }
  }
  let thrExc, thrAcc;
  try {
    thrExc = coerceThreshold(cogs_threshold_excellent);
    thrAcc = coerceThreshold(cogs_threshold_acceptable);
    if (thrExc != null && thrAcc != null && thrExc > thrAcc) {
      return res.status(400).json({ error: { message: 'Excellent threshold must be ≤ Acceptable threshold.' } });
    }
  } catch (err) {
    return res.status(400).json({ error: { message: err.message } });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO mcogs_countries
         (name, currency_code, currency_symbol, exchange_rate,
          default_price_level_id, country_iso, parent_country_id,
          cogs_threshold_excellent, cogs_threshold_acceptable)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        name.trim(), currency_code.toUpperCase().trim(), currency_symbol.trim(), exchange_rate,
        default_price_level_id || null,
        country_iso ? country_iso.toUpperCase().trim() : null,
        parent_country_id || null,
        thrExc, thrAcc,
      ]
    );
    const created = rows[0];
    // If caller supplied region_ids, attach them. Only meaningful for regional
    // markets — silently ignored for country-level markets to keep the API
    // tolerant of stale UI state.
    if (Array.isArray(region_ids) && region_ids.length && parent_country_id) {
      const values = region_ids.map((_, i) => `($1, $${i + 2})`).join(',');
      await client.query(
        `INSERT INTO mcogs_market_regions (market_id, region_id) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [created.id, ...region_ids]
      );
    }
    await client.query('COMMIT');
    logAudit(pool, req, { action: 'create', entity_type: 'country', entity_id: created.id, entity_label: created.name });
    res.status(201).json(created);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create country' } });
  } finally {
    client.release();
  }
});

// PUT /countries/:id
router.put('/:id', async (req, res) => {
  const {
    name, currency_code, currency_symbol, exchange_rate,
    default_price_level_id, country_iso,
    parent_country_id,
    region_ids,               // optional — when supplied, replaces the market's regions
    cogs_threshold_excellent,
    cogs_threshold_acceptable,
  } = req.body;
  if (!name || !currency_code || !currency_symbol || exchange_rate == null)
    return res.status(400).json({ error: { message: 'name, currency_code, currency_symbol and exchange_rate are required' } });
  if (Number(exchange_rate) <= 0)
    return res.status(400).json({ error: { message: 'exchange_rate must be positive' } });
  // Parent-market sanity: cannot be self, cannot be a regional market itself.
  if (parent_country_id && Number(parent_country_id) === Number(req.params.id)) {
    return res.status(400).json({ error: { message: 'Market cannot be its own parent.' } });
  }
  if (parent_country_id) {
    const { rows: [parent] } = await pool.query(
      'SELECT parent_country_id FROM mcogs_countries WHERE id = $1',
      [parent_country_id]
    );
    if (!parent) return res.status(400).json({ error: { message: 'Parent market not found' } });
    if (parent.parent_country_id) {
      return res.status(400).json({ error: { message: 'Cannot nest a region under another region. Parent must be a country-level market.' } });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [old] } = await client.query('SELECT * FROM mcogs_countries WHERE id=$1', [req.params.id]);
    let thrExc, thrAcc;
    try {
      thrExc = coerceThreshold(cogs_threshold_excellent);
      thrAcc = coerceThreshold(cogs_threshold_acceptable);
      if (thrExc != null && thrAcc != null && thrExc > thrAcc) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: { message: 'Excellent threshold must be ≤ Acceptable threshold.' } });
      }
    } catch (err) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { message: err.message } });
    }
    const { rows } = await client.query(
      `UPDATE mcogs_countries
       SET name=$1, currency_code=$2, currency_symbol=$3, exchange_rate=$4,
           default_price_level_id=$5, country_iso=$6, parent_country_id=$7,
           cogs_threshold_excellent=$8, cogs_threshold_acceptable=$9, updated_at=NOW()
       WHERE id=$10 RETURNING *`,
      [
        name.trim(), currency_code.toUpperCase().trim(), currency_symbol.trim(), exchange_rate,
        default_price_level_id || null,
        country_iso ? country_iso.toUpperCase().trim() : null,
        parent_country_id || null,
        thrExc, thrAcc,
        req.params.id,
      ]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: { message: 'Not found' } });
    }
    // If region_ids was supplied, fully replace the market's region set.
    // Undefined => leave existing rows alone (lets callers skip the junction).
    if (Array.isArray(region_ids)) {
      await client.query('DELETE FROM mcogs_market_regions WHERE market_id = $1', [req.params.id]);
      if (region_ids.length) {
        const values = region_ids.map((_, i) => `($1, $${i + 2})`).join(',');
        await client.query(
          `INSERT INTO mcogs_market_regions (market_id, region_id) VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [req.params.id, ...region_ids]
        );
      }
    }
    await client.query('COMMIT');
    logAudit(pool, req, {
      action: 'update', entity_type: 'country', entity_id: rows[0].id, entity_label: rows[0].name,
      field_changes: diffFields(old, rows[0], ['name', 'currency_code', 'currency_symbol', 'exchange_rate', 'default_price_level_id', 'parent_country_id']),
    });
    res.json(rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update country' } });
  } finally {
    client.release();
  }
});

// PATCH /countries/:id  (partial — used for default_price_level_id inline update)
router.patch('/:id', async (req, res) => {
  const allowed = ['name','currency_code','currency_symbol','exchange_rate','default_price_level_id','country_iso','brand_partner_id','parent_country_id','cogs_threshold_excellent','cogs_threshold_acceptable'];
  const fields  = Object.keys(req.body).filter(k => allowed.includes(k));
  if (!fields.length)
    return res.status(400).json({ error: { message: 'No valid fields to update' } });
  const sets   = fields.map((f, i) => `${f} = $${i + 1}`);
  const values = fields.map(f => req.body[f] === '' ? null : req.body[f]);
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_countries WHERE id=$1', [req.params.id]);
    const { rows } = await pool.query(
      `UPDATE mcogs_countries SET ${sets.join(', ')}, updated_at=NOW() WHERE id=$${fields.length+1} RETURNING *`,
      [...values, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'country', entity_id: rows[0].id, entity_label: rows[0].name, field_changes: diffFields(old, rows[0], fields) });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to patch country' } });
  }
});

// DELETE /countries/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_countries WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(`DELETE FROM mcogs_countries WHERE id=$1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'country', entity_id: old?.id, entity_label: old?.name });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete country' } });
  }
});

module.exports = router;
