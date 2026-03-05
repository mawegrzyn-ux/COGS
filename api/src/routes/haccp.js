const router = require('express').Router();
const pool   = require('../db/pool');

// ══════════════════════════════════════════════════════════════════════════════
//  EQUIPMENT REGISTER
// ══════════════════════════════════════════════════════════════════════════════

// GET /haccp/equipment
router.get('/equipment', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT e.*,
             COUNT(l.id)::int                                          AS log_count,
             MAX(l.logged_at)                                          AS last_logged_at,
             (SELECT l2.temp_c FROM mcogs_equipment_temp_logs l2
              WHERE  l2.equipment_id = e.id ORDER BY l2.logged_at DESC LIMIT 1) AS last_temp_c,
             (SELECT l2.in_range FROM mcogs_equipment_temp_logs l2
              WHERE  l2.equipment_id = e.id ORDER BY l2.logged_at DESC LIMIT 1) AS last_in_range
      FROM   mcogs_equipment e
      LEFT JOIN mcogs_equipment_temp_logs l ON l.equipment_id = e.id
      GROUP BY e.id
      ORDER BY e.name ASC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch equipment' } });
  }
});

// POST /haccp/equipment
router.post('/equipment', async (req, res) => {
  const { name, type, location_desc, target_min_temp, target_max_temp } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  const validTypes = ['fridge', 'freezer', 'hot_hold', 'display', 'other'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: { message: `type must be one of: ${validTypes.join(', ')}` } });

  try {
    const { rows } = await pool.query(`
      INSERT INTO mcogs_equipment (name, type, location_desc, target_min_temp, target_max_temp)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [name.trim(), type, location_desc?.trim() || null, target_min_temp ?? null, target_max_temp ?? null]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create equipment' } });
  }
});

// PUT /haccp/equipment/:id
router.put('/equipment/:id', async (req, res) => {
  const { name, type, location_desc, target_min_temp, target_max_temp, is_active } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  const validTypes = ['fridge', 'freezer', 'hot_hold', 'display', 'other'];
  if (!validTypes.includes(type)) return res.status(400).json({ error: { message: `type must be one of: ${validTypes.join(', ')}` } });

  try {
    const { rows } = await pool.query(`
      UPDATE mcogs_equipment
      SET    name=$1, type=$2, location_desc=$3, target_min_temp=$4,
             target_max_temp=$5, is_active=$6, updated_at=NOW()
      WHERE  id=$7
      RETURNING *
    `, [name.trim(), type, location_desc?.trim() || null, target_min_temp ?? null, target_max_temp ?? null, is_active !== false, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Equipment not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update equipment' } });
  }
});

// DELETE /haccp/equipment/:id
router.delete('/equipment/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_equipment WHERE id=$1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Equipment not found' } });
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

// GET /haccp/ccp-logs?log_type=cooking&recipe_id=&date_from=&date_to=&limit=100
router.get('/ccp-logs', async (req, res) => {
  const { log_type, recipe_id, date_from, date_to, limit = 100 } = req.query;
  try {
    let query = `
      SELECT cl.*, r.name AS recipe_name
      FROM   mcogs_ccp_logs cl
      LEFT JOIN mcogs_recipes r ON r.id = cl.recipe_id
      WHERE  1=1
    `;
    const vals = [];
    let p = 1;
    if (log_type)  { query += ` AND cl.log_type = $${p++}`;   vals.push(log_type); }
    if (recipe_id) { query += ` AND cl.recipe_id = $${p++}`;  vals.push(recipe_id); }
    if (date_from) { query += ` AND cl.logged_at >= $${p++}`; vals.push(date_from); }
    if (date_to)   { query += ` AND cl.logged_at <= $${p++}`; vals.push(date_to); }
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
  const { log_type, recipe_id, item_name, target_min_temp, target_max_temp, actual_temp, corrective_action, logged_by, notes, logged_at } = req.body;

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
         actual_temp, passed, corrective_action, logged_by, notes, logged_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
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
    ]);
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
//  GET /haccp/report?date_from=&date_to=
// ══════════════════════════════════════════════════════════════════════════════
router.get('/report', async (req, res) => {
  const { date_from, date_to } = req.query;

  const dateFilter   = (alias) => {
    const parts = [];
    if (date_from) parts.push(`${alias}.logged_at >= '${date_from}'`);
    if (date_to)   parts.push(`${alias}.logged_at <= '${date_to}'`);
    return parts.length ? ' AND ' + parts.join(' AND ') : '';
  };

  try {
    // Equipment log summary
    const { rows: eqRows } = await pool.query(`
      SELECT e.id, e.name, e.type, e.target_min_temp, e.target_max_temp,
             COUNT(l.id)::int                                           AS total_checks,
             COUNT(CASE WHEN l.in_range     THEN 1 END)::int           AS in_range_count,
             COUNT(CASE WHEN NOT l.in_range THEN 1 END)::int           AS out_of_range_count,
             COUNT(CASE WHEN NOT l.in_range AND l.corrective_action IS NOT NULL THEN 1 END)::int AS corrective_logged,
             MIN(l.logged_at)  AS first_check,
             MAX(l.logged_at)  AS last_check
      FROM   mcogs_equipment e
      LEFT JOIN mcogs_equipment_temp_logs l ON l.equipment_id = e.id
        ${date_from || date_to ? `AND (1=1 ${dateFilter('l')})` : ''}
      WHERE  e.is_active = true
      GROUP BY e.id
      ORDER BY e.name ASC
    `);

    // CCP log summary
    const { rows: ccpRows } = await pool.query(`
      SELECT log_type,
             COUNT(*)::int                                     AS total,
             COUNT(CASE WHEN passed     THEN 1 END)::int      AS passed_count,
             COUNT(CASE WHEN NOT passed THEN 1 END)::int      AS failed_count,
             COUNT(CASE WHEN NOT passed AND corrective_action IS NOT NULL THEN 1 END)::int AS corrective_logged
      FROM   mcogs_ccp_logs
      WHERE  1=1 ${dateFilter({ logged_at: 'logged_at' }).replace(/l\./g, '')}
      GROUP BY log_type
    `);

    // Recent incidents (last 10 out-of-range equipment + failed CCPs)
    const { rows: eqIncidents } = await pool.query(`
      SELECT 'equipment' AS source, e.name AS item, l.temp_c AS actual_temp,
             e.target_min_temp, e.target_max_temp, l.logged_at,
             l.logged_by, l.corrective_action, l.in_range AS passed
      FROM   mcogs_equipment_temp_logs l
      JOIN   mcogs_equipment e ON e.id = l.equipment_id
      WHERE  l.in_range = false ${dateFilter('l')}
      ORDER BY l.logged_at DESC LIMIT 10
    `);

    const { rows: ccpIncidents } = await pool.query(`
      SELECT 'ccp' AS source, item_name AS item, actual_temp, target_min_temp,
             target_max_temp, logged_at, logged_by, corrective_action, passed
      FROM   mcogs_ccp_logs
      WHERE  passed = false ${dateFilter({ logged_at: 'logged_at' }).replace(/l\./g, '')}
      ORDER BY logged_at DESC LIMIT 10
    `);

    res.json({
      period:        { date_from: date_from || null, date_to: date_to || null },
      equipment:     eqRows,
      ccp_summary:   ccpRows,
      incidents:     [...eqIncidents, ...ccpIncidents].sort((a, b) => new Date(b.logged_at) - new Date(a.logged_at)).slice(0, 20),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to generate HACCP report' } });
  }
});

module.exports = router;
