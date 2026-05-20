const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit, diffFields } = require('../helpers/audit');

// ══════════════════════════════════════════════════════════════════════════════
//  EQUIPMENT REGISTER
// ══════════════════════════════════════════════════════════════════════════════

// GET /haccp/equipment?location_id=
router.get('/equipment', async (req, res) => {
  const { location_id } = req.query;
  try {
    let query = `
      SELECT e.*,
             loc.name AS location_name,
             COUNT(tl.id)::int AS log_count,
             MAX(tl.logged_at) AS last_logged_at,
             (SELECT l2.temp_c   FROM mcogs_equipment_temp_logs l2 WHERE l2.equipment_id = e.id ORDER BY l2.logged_at DESC LIMIT 1) AS last_temp_c,
             (SELECT l2.in_range FROM mcogs_equipment_temp_logs l2 WHERE l2.equipment_id = e.id ORDER BY l2.logged_at DESC LIMIT 1) AS last_in_range
      FROM   mcogs_equipment e
      LEFT JOIN mcogs_locations loc ON loc.id = e.location_id
      LEFT JOIN mcogs_equipment_temp_logs tl ON tl.equipment_id = e.id
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;
    if (location_id) { query += ` AND e.location_id = $${p++}`; vals.push(location_id); }
    query += ` GROUP BY e.id, loc.name ORDER BY e.name ASC`;
    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch equipment' } });
  }
});

// POST /haccp/equipment
router.post('/equipment', async (req, res) => {
  const { name, type, location_id, location_desc, target_min_temp, target_max_temp } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  const validTypes = ['fridge', 'freezer', 'hot_hold', 'display', 'other'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: { message: `type must be one of: ${validTypes.join(', ')}` } });

  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_equipment (name, type, location_id, location_desc, target_min_temp, target_max_temp)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name.trim(), type, location_id || null, location_desc?.trim() || null, target_min_temp ?? null, target_max_temp ?? null]);
    logAudit(pool, req, { action: 'create', entity_type: 'equipment', entity_id: rows[0].id, entity_label: rows[0].name });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create equipment' } });
  }
});

// PUT /haccp/equipment/:id
router.put('/equipment/:id', async (req, res) => {
  const { name, type, location_id, location_desc, target_min_temp, target_max_temp, is_active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  const validTypes = ['fridge', 'freezer', 'hot_hold', 'display', 'other'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: { message: `type must be one of: ${validTypes.join(', ')}` } });

  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_equipment
      SET    name=$1, type=$2, location_id=$3, location_desc=$4,
             target_min_temp=$5, target_max_temp=$6, is_active=$7, updated_at=NOW()
      WHERE  id=$8
      RETURNING *
    `, [name.trim(), type, location_id || null, location_desc?.trim() || null, target_min_temp ?? null, target_max_temp ?? null, is_active !== false, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Equipment not found' } });
    logAudit(pool, req, { action: 'update', entity_type: 'equipment', entity_id: rows[0].id, entity_label: rows[0].name });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update equipment' } });
  }
});

// DELETE /haccp/equipment/:id
router.delete('/equipment/:id', async (req, res) => {
  try {
    const { rows: [old] } = await pool.query('SELECT * FROM mcogs_equipment WHERE id=$1', [req.params.id]);
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_equipment WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Equipment not found' } });
    logAudit(pool, req, { action: 'delete', entity_type: 'equipment', entity_id: old?.id, entity_label: old?.name });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete equipment' } });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  EQUIPMENT TEMPERATURE LOGS
// ══════════════════════════════════════════════════════════════════════════════

// GET /haccp/equipment/:id/logs?date_from=&date_to=&limit=90
router.get('/equipment/:id/logs', async (req, res) => {
  const { date_from, date_to, limit = 90 } = req.query;
  try {
    let query  = `SELECT * FROM mcogs_equipment_temp_logs WHERE equipment_id = $1`;
    const vals = [req.params.id];
    let p = 2;
    if (date_from) { query += ` AND logged_at >= $${p++}`; vals.push(date_from); }
    if (date_to)   { query += ` AND logged_at <= $${p++}`; vals.push(date_to); }
    query += ` ORDER BY logged_at DESC LIMIT $${p}`;
    vals.push(Math.min(Number(limit) || 90, 500));

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch temperature logs' } });
  }
});

// POST /haccp/equipment/:id/logs
router.post('/equipment/:id/logs', async (req, res) => {
  const { temp_c, logged_by, notes, corrective_action, logged_at } = req.body;
  if (temp_c == null) return res.status(400).json({ error: { message: 'temp_c is required' } });

  try {
    // Check if in range
    const { rows: [eq] } = await pool.query(
      `SELECT target_min_temp, target_max_temp FROM mcogs_equipment WHERE id=$1`, [req.params.id]
    );
    if (!eq) return res.status(404).json({ error: { message: 'Equipment not found' } });

    const t        = Number(temp_c);
    const inRange  = (eq.target_min_temp == null || t >= Number(eq.target_min_temp)) &&
                     (eq.target_max_temp == null || t <= Number(eq.target_max_temp));

    // Out-of-range requires corrective action
    if (!inRange && !corrective_action?.trim()) {
      return res.status(422).json({ error: { message: 'Corrective action is required for out-of-range temperatures' } });
    }

    const { rows } = await pool.query(`
      INSERT INTO mcogs_equipment_temp_logs
        (equipment_id, temp_c, in_range, corrective_action, logged_by, notes, logged_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [
      req.params.id, t, inRange,
      corrective_action?.trim() || null,
      logged_by?.trim()         || null,
      notes?.trim()             || null,
      logged_at                 || new Date().toISOString(),
    ]);
    logAudit(pool, req, { action: 'create', entity_type: 'temp_log', entity_id: rows[0].id, entity_label: `${t}°C on equipment #${req.params.id}` });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to log temperature' } });
  }
});

// DELETE /haccp/equipment-logs/:id
router.delete('/equipment-logs/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_equipment_temp_logs WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Log not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete log' } });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  CCP LOGS (cooking / cooling / delivery)
// ══════════════════════════════════════════════════════════════════════════════

// GET /haccp/ccp-logs?log_type=cooking&recipe_id=&location_id=&date_from=&date_to=&limit=100
router.get('/ccp-logs', async (req, res) => {
  const { log_type, recipe_id, location_id, date_from, date_to, limit = 100 } = req.query;
  try {
    let query = `
      SELECT cl.*, r.name AS recipe_name
      FROM   mcogs_ccp_logs cl
      LEFT JOIN mcogs_recipes r ON r.id = cl.recipe_id
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;
    if (log_type)   { query += ` AND cl.log_type = $${p++}`;     vals.push(log_type); }
    if (recipe_id)  { query += ` AND cl.recipe_id = $${p++}`;    vals.push(recipe_id); }
    if (location_id){ query += ` AND cl.location_id = $${p++}`;  vals.push(location_id); }
    if (date_from)  { query += ` AND cl.logged_at >= $${p++}`;   vals.push(date_from); }
    if (date_to)    { query += ` AND cl.logged_at <= $${p++}`;   vals.push(date_to); }
    query += ` ORDER BY cl.logged_at DESC LIMIT $${p}`;
    vals.push(Math.min(Number(limit) || 100, 1000));

    const { rows } = await pool.query(query, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch CCP logs' } });
  }
});

// POST /haccp/ccp-logs
router.post('/ccp-logs', async (req, res) => {
  const {
    log_type, recipe_id, item_name,
    target_min_temp, target_max_temp, actual_temp,
    corrective_action, logged_by, notes, logged_at,
    location_id,
  } = req.body;

  const validTypes = ['cooking', 'cooling', 'delivery'];
  if (!validTypes.includes(log_type)) return res.status(400).json({ error: { message: `log_type must be one of: ${validTypes.join(', ')}` } });
  if (!item_name?.trim())             return res.status(400).json({ error: { message: 'item_name is required' } });
  if (target_min_temp == null)        return res.status(400).json({ error: { message: 'target_min_temp is required' } });
  if (target_max_temp == null)        return res.status(400).json({ error: { message: 'target_max_temp is required' } });
  if (actual_temp == null)            return res.status(400).json({ error: { message: 'actual_temp is required' } });

  const t       = Number(actual_temp);
  const passed  = t >= Number(target_min_temp) && t <= Number(target_max_temp);

  if (!passed && !corrective_action?.trim()) {
    return res.status(422).json({ error: { message: 'Corrective action is required when CCP is not passed' } });
  }

  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_ccp_logs
        (log_type, recipe_id, item_name, target_min_temp, target_max_temp,
         actual_temp, passed, corrective_action, logged_by, notes, logged_at, location_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    `, [
      log_type,
      recipe_id || null,
      item_name.trim(),
      Number(target_min_temp),
      Number(target_max_temp),
      t, passed,
      corrective_action?.trim() || null,
      logged_by?.trim()         || null,
      notes?.trim()             || null,
      logged_at                 || new Date().toISOString(),
      location_id               || null,
    ]);
    logAudit(pool, req, { action: 'create', entity_type: 'ccp_log', entity_id: rows[0].id, entity_label: `${log_type}: ${item_name.trim()}` });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create CCP log' } });
  }
});

// DELETE /haccp/ccp-logs/:id
router.delete('/ccp-logs/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_ccp_logs WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'CCP log not found' } });
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete CCP log' } });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
//  COMPLIANCE REPORT
//  GET /haccp/report?date_from=&date_to=&location_id=
// ══════════════════════════════════════════════════════════════════════════════
router.get('/report', async (req, res) => {
  const { date_from, date_to, location_id } = req.query;

  // Build parameterised filter sets
  const eqVals    = [];
  const ccpVals   = [];
  const incEqVals = [];
  const incCpVals = [];
  let eqP = 1, ccpP = 1, incEqP = 1, incCpP = 1;

  function addFilters(vals, p, alias, tbl) {
    let w = '';
    if (location_id) { w += ` AND ${alias}.location_id = $${p++}`; vals.push(location_id); }
    if (date_from)   { w += ` AND ${tbl}.logged_at >= $${p++}`;    vals.push(date_from); }
    if (date_to)     { w += ` AND ${tbl}.logged_at <= $${p++}`;    vals.push(date_to); }
    return { w, p };
  }

  try {
    // Equipment log summary
    const eqF = addFilters(eqVals, eqP, 'e', 'l');
    const { rows: eqRows } = await pool.query(`
      SELECT e.id, e.name, e.type, e.target_min_temp, e.target_max_temp,
             COUNT(l.id)::int                                                        AS total_checks,
             COUNT(CASE WHEN l.in_range     THEN 1 END)::int                         AS in_range_count,
             COUNT(CASE WHEN NOT l.in_range THEN 1 END)::int                         AS out_of_range_count,
             COUNT(CASE WHEN NOT l.in_range AND l.corrective_action IS NOT NULL THEN 1 END)::int AS corrective_logged,
             MIN(l.logged_at) AS first_check,
             MAX(l.logged_at) AS last_check
      FROM   mcogs_equipment e
      LEFT JOIN mcogs_equipment_temp_logs l ON l.equipment_id = e.id
        AND (1=1 ${date_from ? `AND l.logged_at >= '${date_from}'` : ''} ${date_to ? `AND l.logged_at <= '${date_to}'` : ''})
      WHERE  e.is_active = true
        ${location_id ? `AND e.location_id = ${parseInt(location_id, 10)}` : ''}
      GROUP BY e.id
      ORDER BY e.name ASC
    `);

    // CCP log summary
    const ccpExtra = [
      location_id ? `AND location_id = ${parseInt(location_id, 10)}` : '',
      date_from   ? `AND logged_at >= '${date_from}'` : '',
      date_to     ? `AND logged_at <= '${date_to}'`   : '',
    ].filter(Boolean).join(' ');

    const { rows: ccpRows } = await pool.query(`
      SELECT log_type,
             COUNT(*)::int                                     AS total,
             COUNT(CASE WHEN passed     THEN 1 END)::int       AS passed_count,
             COUNT(CASE WHEN NOT passed THEN 1 END)::int       AS failed_count,
             COUNT(CASE WHEN NOT passed AND corrective_action IS NOT NULL THEN 1 END)::int AS corrective_logged
      FROM   mcogs_ccp_logs
      WHERE  1=1 ${ccpExtra}
      GROUP BY log_type
    `);

    // Recent incidents — out-of-range equipment
    const { rows: eqIncidents } = await pool.query(`
      SELECT 'equipment' AS source, e.name AS item, l.temp_c AS actual_temp,
             e.target_min_temp, e.target_max_temp, l.logged_at,
             l.logged_by, l.corrective_action, l.in_range AS passed
      FROM   mcogs_equipment_temp_logs l
      JOIN   mcogs_equipment e ON e.id = l.equipment_id
      WHERE  l.in_range = false
        ${location_id ? `AND e.location_id = ${parseInt(location_id, 10)}` : ''}
        ${date_from   ? `AND l.logged_at >= '${date_from}'` : ''}
        ${date_to     ? `AND l.logged_at <= '${date_to}'`   : ''}
      ORDER BY l.logged_at DESC LIMIT 10
    `);

    // Recent incidents — failed CCPs
    const { rows: ccpIncidents } = await pool.query(`
      SELECT 'ccp' AS source, item_name AS item, actual_temp, target_min_temp,
             target_max_temp, logged_at, logged_by, corrective_action, passed
      FROM   mcogs_ccp_logs
      WHERE  passed = false
        ${location_id ? `AND location_id = ${parseInt(location_id, 10)}` : ''}
        ${date_from   ? `AND logged_at >= '${date_from}'` : ''}
        ${date_to     ? `AND logged_at <= '${date_to}'`   : ''}
      ORDER BY logged_at DESC LIMIT 10
    `);

    res.json({
      period:      { date_from: date_from || null, date_to: date_to || null },
      equipment:   eqRows,
      ccp_summary: ccpRows,
      incidents:   [...eqIncidents, ...ccpIncidents]
        .sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at))
        .slice(0, 20),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to generate HACCP report' } });
  }
});

module.exports = router;
