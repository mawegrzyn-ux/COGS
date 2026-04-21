// QSC Audit Tool — all endpoints live under /api/qsc.
// Mounted at the /qsc base to avoid colliding with the existing /api/audit
// (central change-audit log). Uses the `audits` RBAC feature for read/write
// and `audits_admin` for question-bank edits.

const router = require('express').Router();
const pool   = require('../db/pool');
const { requirePermission } = require('../middleware/auth');
const { logAudit, diffFields } = require('../helpers/audit');
const { scoreAudit } = require('../helpers/qsc-scoring');

// ─────────────────────────────────────────────────────────────────────────────
// QUESTION BANK
// ─────────────────────────────────────────────────────────────────────────────

// GET /qsc/questions?version=1&department=&category=&active=true
router.get('/questions', async (req, res) => {
  const { version, department, category, active, codes } = req.query;
  const where = [];
  const vals  = [];
  if (version)    { vals.push(parseInt(version, 10));         where.push(`version = $${vals.length}`); }
  if (department) { vals.push(department);                    where.push(`department = $${vals.length}`); }
  if (category)   { vals.push(category);                      where.push(`category = $${vals.length}`); }
  if (active !== undefined) {
    vals.push(active === 'true');
    where.push(`active = $${vals.length}`);
  }
  if (codes) {
    // ?codes=A101,A103,...
    const arr = String(codes).split(',').map(s => s.trim()).filter(Boolean);
    if (arr.length) { vals.push(arr); where.push(`code = ANY($${vals.length})`); }
  }
  const sql = `SELECT * FROM mcogs_qsc_questions
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY sort_order, code`;
  try {
    const { rows } = await pool.query(sql, vals);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch questions' } });
  }
});

// GET /qsc/questions/:code?version=1
router.get('/questions/:code', async (req, res) => {
  const version = parseInt(req.query.version || '1', 10);
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_qsc_questions WHERE code = $1 AND version = $2`,
      [req.params.code, version]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Question not found' } });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch question' } });
  }
});

// PUT /qsc/questions/:code — admin edit (audits_admin feature)
router.put('/questions/:code', requirePermission('audits_admin', 'write'), async (req, res) => {
  const version = parseInt(req.body.version || req.query.version || '1', 10);
  const { title, policy, active } = req.body;
  try {
    const old = await pool.query(
      `SELECT * FROM mcogs_qsc_questions WHERE code = $1 AND version = $2`,
      [req.params.code, version]
    );
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Question not found' } });

    const { rows } = await pool.query(
      `UPDATE mcogs_qsc_questions SET
         title  = COALESCE($1, title),
         policy = COALESCE($2, policy),
         active = COALESCE($3, active)
       WHERE code = $4 AND version = $5 RETURNING *`,
      [title ?? null, policy ?? null, active ?? null, req.params.code, version]
    );

    const changes = diffFields(old.rows[0], rows[0], ['title', 'policy', 'active']);
    if (changes) await logAudit(pool, req, {
      action: 'update', entity_type: 'qsc_question', entity_id: rows[0].id,
      entity_label: rows[0].code, field_changes: changes, context: { source: 'manual' }
    });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update question' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

// GET /qsc/templates
router.get('/templates', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_qsc_templates ORDER BY is_system DESC, name ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch templates' } });
  }
});

// POST /qsc/templates
router.post('/templates', async (req, res) => {
  const { name, description, question_codes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: { message: 'name is required' } });
  try {
    const { rows } = await pool.query(
      `INSERT INTO mcogs_qsc_templates (name, description, question_codes, created_by)
       VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
      [name.trim(), description?.trim() || null, JSON.stringify(question_codes || []), req.user?.sub || null]
    );
    await logAudit(pool, req, {
      action: 'create', entity_type: 'qsc_template', entity_id: rows[0].id,
      entity_label: rows[0].name, context: { source: 'manual' }
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create template' } });
  }
});

// PUT /qsc/templates/:id
router.put('/templates/:id', async (req, res) => {
  const { name, description, question_codes } = req.body;
  try {
    const old = await pool.query(`SELECT * FROM mcogs_qsc_templates WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Template not found' } });
    if (old.rows[0].is_system && !req.user?.is_dev) {
      return res.status(403).json({ error: { message: 'System templates can only be edited by developers' } });
    }
    const { rows } = await pool.query(
      `UPDATE mcogs_qsc_templates SET
         name           = COALESCE($1, name),
         description    = COALESCE($2, description),
         question_codes = COALESCE($3::jsonb, question_codes),
         updated_at     = NOW()
       WHERE id = $4 RETURNING *`,
      [name?.trim() || null, description?.trim() || null,
       question_codes !== undefined ? JSON.stringify(question_codes) : null,
       req.params.id]
    );
    const changes = diffFields(old.rows[0], rows[0], ['name', 'description', 'question_codes']);
    if (changes) await logAudit(pool, req, {
      action: 'update', entity_type: 'qsc_template', entity_id: rows[0].id,
      entity_label: rows[0].name, field_changes: changes, context: { source: 'manual' }
    });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update template' } });
  }
});

// DELETE /qsc/templates/:id
router.delete('/templates/:id', async (req, res) => {
  try {
    const old = await pool.query(`SELECT * FROM mcogs_qsc_templates WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Template not found' } });
    if (old.rows[0].is_system) {
      return res.status(403).json({ error: { message: 'System templates cannot be deleted' } });
    }
    await pool.query(`DELETE FROM mcogs_qsc_templates WHERE id = $1`, [req.params.id]);
    await logAudit(pool, req, {
      action: 'delete', entity_type: 'qsc_template', entity_id: parseInt(req.params.id, 10),
      entity_label: old.rows[0].name, context: { source: 'manual' }
    });
    res.json({ deleted: parseInt(req.params.id, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete template' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDITS — list / fetch / report / export
// ─────────────────────────────────────────────────────────────────────────────

// GET /qsc/audits?audit_type=&status=&location_id=&limit=&offset=
router.get('/audits', async (req, res) => {
  const { audit_type, status, location_id, limit = 50, offset = 0 } = req.query;
  const where = [];
  const vals  = [];
  if (audit_type)  { vals.push(audit_type);             where.push(`a.audit_type = $${vals.length}`); }
  if (status)      { vals.push(status);                 where.push(`a.status = $${vals.length}`); }
  if (location_id) { vals.push(parseInt(location_id));  where.push(`a.location_id = $${vals.length}`); }
  vals.push(parseInt(limit, 10) || 50);
  vals.push(parseInt(offset, 10) || 0);
  try {
    const { rows } = await pool.query(
      `SELECT a.*, l.name AS location_name,
              (SELECT COUNT(*)::int FROM mcogs_qsc_responses WHERE audit_id = a.id) AS response_count
       FROM   mcogs_qsc_audits a
       LEFT JOIN mcogs_locations l ON l.id = a.location_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY a.started_at DESC
       LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
      vals
    );
    const total = await pool.query(
      `SELECT COUNT(*)::int AS total FROM mcogs_qsc_audits a ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      vals.slice(0, vals.length - 2)
    );
    res.json({ rows, total: total.rows[0].total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch audits' } });
  }
});

// GET /qsc/audits/:id — audit + responses + photos
router.get('/audits/:id', async (req, res) => {
  try {
    const audit = await pool.query(
      `SELECT a.*, l.name AS location_name, t.name AS template_name
       FROM mcogs_qsc_audits a
       LEFT JOIN mcogs_locations  l ON l.id = a.location_id
       LEFT JOIN mcogs_qsc_templates t ON t.id = a.template_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!audit.rows.length) return res.status(404).json({ error: { message: 'Audit not found' } });

    const responses = await pool.query(
      `SELECT * FROM mcogs_qsc_responses WHERE audit_id = $1 ORDER BY question_code`,
      [req.params.id]
    );
    const photos = await pool.query(
      `SELECT p.*
       FROM   mcogs_qsc_response_photos p
       JOIN   mcogs_qsc_responses r ON r.id = p.response_id
       WHERE  r.audit_id = $1`,
      [req.params.id]
    );

    const photosByResp = {};
    for (const p of photos.rows) (photosByResp[p.response_id] ||= []).push(p);
    const withPhotos = responses.rows.map(r => ({ ...r, photos: photosByResp[r.id] || [] }));

    res.json({ audit: audit.rows[0], responses: withPhotos });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch audit' } });
  }
});

// GET /qsc/audits/:id/report — full precomputed report
router.get('/audits/:id/report', async (req, res) => {
  try {
    const audit = await pool.query(
      `SELECT a.*, l.name AS location_name, t.name AS template_name
       FROM mcogs_qsc_audits a
       LEFT JOIN mcogs_locations  l ON l.id = a.location_id
       LEFT JOIN mcogs_qsc_templates t ON t.id = a.template_id
       WHERE a.id = $1`,
      [req.params.id]
    );
    if (!audit.rows.length) return res.status(404).json({ error: { message: 'Audit not found' } });

    const version = audit.rows[0].question_version;
    const questions = await pool.query(
      `SELECT * FROM mcogs_qsc_questions WHERE version = $1`,
      [version]
    );
    const responses = await pool.query(
      `SELECT r.*, COALESCE(
          json_agg(p.* ORDER BY p.uploaded_at) FILTER (WHERE p.id IS NOT NULL), '[]'
        ) AS photos
       FROM   mcogs_qsc_responses r
       LEFT JOIN mcogs_qsc_response_photos p ON p.response_id = r.id
       WHERE  r.audit_id = $1
       GROUP  BY r.id`,
      [req.params.id]
    );

    const byCode = new Map(questions.rows.map(q => [q.code, q]));
    const enriched = responses.rows.map(r => ({ ...r, question: byCode.get(r.question_code) || null }));

    // Summary groupings
    const byDept = {};
    const byCategory = {};
    let critFindings = [];
    let ncAll = [];
    let repeatFindings = [];
    let informational = [];

    for (const r of enriched) {
      const q = r.question; if (!q) continue;
      const d = q.department || 'Unknown';
      const c = q.category   || 'Unknown';
      byDept[d] ||= { total_points: 0, deducted: 0, nc: 0, compliant: 0, not_observed: 0, not_applicable: 0 };
      byCategory[c] ||= { department: d, total_points: 0, deducted: 0, nc: 0, compliant: 0, not_observed: 0, not_applicable: 0 };
      byDept[d].total_points += q.points || 0;
      byCategory[c].total_points += q.points || 0;
      byDept[d].deducted += r.points_deducted || 0;
      byCategory[c].deducted += r.points_deducted || 0;
      if (r.status === 'not_compliant') {
        byDept[d].nc++; byCategory[c].nc++;
        ncAll.push(r);
        if (/critical/i.test(q.risk_level)) critFindings.push(r);
        if (r.is_repeat) repeatFindings.push(r);
      } else if (r.status === 'compliant') { byDept[d].compliant++; byCategory[c].compliant++; }
      else if (r.status === 'not_observed') { byDept[d].not_observed++; byCategory[c].not_observed++; }
      else if (r.status === 'not_applicable') { byDept[d].not_applicable++; byCategory[c].not_applicable++; }
      else if (r.status === 'informational') informational.push(r);
    }

    res.json({
      audit:               audit.rows[0],
      questions:           questions.rows,
      responses:           enriched,
      summary: {
        by_department:     byDept,
        by_category:       byCategory,
        critical_findings: critFindings,
        non_compliant:     ncAll,
        repeat_findings:   repeatFindings,
        informational:     informational,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to build report' } });
  }
});

// GET /qsc/audits/:id/export.csv
router.get('/audits/:id/export.csv', async (req, res) => {
  try {
    const audit = await pool.query(`SELECT * FROM mcogs_qsc_audits WHERE id = $1`, [req.params.id]);
    if (!audit.rows.length) return res.status(404).send('Audit not found');
    const rows = await pool.query(
      `SELECT q.code, q.department, q.category, q.title, q.risk_level, q.points,
              r.status, r.is_repeat, r.points_deducted, r.comment,
              r.temperature_value, r.temperature_unit, r.product_name, r.answered_at
       FROM   mcogs_qsc_responses r
       JOIN   mcogs_qsc_questions q ON q.code = r.question_code AND q.version = $2
       WHERE  r.audit_id = $1
       ORDER  BY q.sort_order, q.code`,
      [req.params.id, audit.rows[0].question_version]
    );
    const headers = ['code','department','category','title','risk_level','points','status','is_repeat','points_deducted','comment','temperature_value','temperature_unit','product_name','answered_at'];
    const esc = (v) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
      return /[",]/.test(s) ? `"${s}"` : s;
    };
    const lines = [headers.join(',')];
    for (const r of rows.rows) lines.push(headers.map(h => esc(r[h])).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="qsc-audit-${audit.rows[0].key || audit.rows[0].id}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to export CSV');
  }
});

// GET /qsc/locations/:id/last-external — last completed external audit for repeat-flagging
router.get('/locations/:id/last-external', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, key, completed_at FROM mcogs_qsc_audits
       WHERE location_id = $1 AND audit_type = 'external' AND status = 'completed'
       ORDER BY completed_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.json(null);
    const responses = await pool.query(
      `SELECT question_code FROM mcogs_qsc_responses
       WHERE audit_id = $1 AND status = 'not_compliant'`,
      [rows[0].id]
    );
    res.json({ audit: rows[0], nc_codes: responses.rows.map(r => r.question_code) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch last external audit' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDITS — create / update / complete / cancel / delete
// ─────────────────────────────────────────────────────────────────────────────

// POST /qsc/audits — start
router.post('/audits', async (req, res) => {
  const { audit_type, location_id, template_id, auditor_name, notes } = req.body;
  if (!['external', 'internal'].includes(audit_type)) {
    return res.status(400).json({ error: { message: 'audit_type must be external or internal' } });
  }
  if (!location_id) return res.status(400).json({ error: { message: 'location_id is required' } });

  try {
    const keyRes = await pool.query(`SELECT nextval('mcogs_qsc_audit_number_seq')::int AS n`);
    const key = `AUD-${keyRes.rows[0].n}`;
    const version = 1; // pin to current; if version tracking evolves, read from settings

    const { rows } = await pool.query(
      `INSERT INTO mcogs_qsc_audits
         (key, audit_type, location_id, template_id, question_version,
          auditor_sub, auditor_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [key, audit_type, location_id, template_id || null, version,
       req.user?.sub || null,
       auditor_name?.trim() || req.user?.name || req.user?.email || null,
       notes?.trim() || null]
    );
    await logAudit(pool, req, {
      action: 'create', entity_type: 'qsc_audit', entity_id: rows[0].id,
      entity_label: key, context: { audit_type, location_id, template_id }
    });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to start audit' } });
  }
});

// PUT /qsc/audits/:id — update notes / auditor_name (draft-only)
router.put('/audits/:id', async (req, res) => {
  const { notes, auditor_name } = req.body;
  try {
    const old = await pool.query(`SELECT * FROM mcogs_qsc_audits WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Audit not found' } });
    if (old.rows[0].status !== 'in_progress') {
      return res.status(400).json({ error: { message: 'Audit is locked (completed or cancelled)' } });
    }
    const { rows } = await pool.query(
      `UPDATE mcogs_qsc_audits SET
         notes        = COALESCE($1, notes),
         auditor_name = COALESCE($2, auditor_name),
         updated_at   = NOW()
       WHERE id = $3 RETURNING *`,
      [notes ?? null, auditor_name ?? null, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update audit' } });
  }
});

// POST /qsc/audits/:id/complete — finalize, compute score, lock
router.post('/audits/:id/complete', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const audit = await client.query(
      `SELECT * FROM mcogs_qsc_audits WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!audit.rows.length) { await client.query('ROLLBACK'); return res.status(404).json({ error: { message: 'Audit not found' } }); }
    if (audit.rows[0].status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: { message: 'Audit is already completed or cancelled' } });
    }

    const version = audit.rows[0].question_version;
    const questions = await client.query(
      `SELECT code, points, repeat_points, auto_unacceptable, risk_level
       FROM mcogs_qsc_questions WHERE version = $1`,
      [version]
    );

    // External audits require every scored question be answered.
    if (audit.rows[0].audit_type === 'external') {
      const answered = await client.query(
        `SELECT question_code FROM mcogs_qsc_responses WHERE audit_id = $1`,
        [req.params.id]
      );
      const answeredSet = new Set(answered.rows.map(r => r.question_code));
      const missing = questions.rows
        .filter(q => q.points > 0)
        .filter(q => !answeredSet.has(q.code))
        .map(q => q.code);
      if (missing.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: {
          message: `External audit requires all ${questions.rows.filter(q=>q.points>0).length} scored questions to be answered; missing ${missing.length}.`,
          missing_codes: missing.slice(0, 20),
        }});
      }
    }

    const responses = await client.query(
      `SELECT question_code, status, is_repeat FROM mcogs_qsc_responses WHERE audit_id = $1`,
      [req.params.id]
    );
    const result = scoreAudit(questions.rows, responses.rows);

    // Persist per-response deductions (keeps mcogs_qsc_responses.points_deducted in sync)
    for (const pr of result.per_response) {
      await client.query(
        `UPDATE mcogs_qsc_responses SET points_deducted = $1 WHERE audit_id = $2 AND question_code = $3`,
        [pr.points_deducted, req.params.id, pr.question_code]
      );
    }

    const { rows } = await client.query(
      `UPDATE mcogs_qsc_audits SET
         status            = 'completed',
         completed_at      = NOW(),
         overall_score     = $1,
         overall_rating    = $2,
         auto_unacceptable = $3,
         updated_at        = NOW()
       WHERE id = $4 RETURNING *`,
      [result.overall_score, result.overall_rating, result.auto_unacceptable, req.params.id]
    );
    await client.query('COMMIT');

    await logAudit(pool, req, {
      action: 'confirm', entity_type: 'qsc_audit', entity_id: rows[0].id,
      entity_label: rows[0].key,
      field_changes: {
        status:            { old: 'in_progress', new: 'completed' },
        overall_score:     { old: null, new: result.overall_score },
        overall_rating:    { old: null, new: result.overall_rating },
        auto_unacceptable: { old: false, new: result.auto_unacceptable },
      },
      context: { source: 'manual' }
    });

    res.json({ ...rows[0], score_detail: result });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to complete audit' } });
  } finally {
    client.release();
  }
});

// POST /qsc/audits/:id/cancel
router.post('/audits/:id/cancel', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE mcogs_qsc_audits SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status = 'in_progress' RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(400).json({ error: { message: 'Audit cannot be cancelled (not found or already finalized)' } });
    await logAudit(pool, req, {
      action: 'status_change', entity_type: 'qsc_audit', entity_id: rows[0].id,
      entity_label: rows[0].key,
      field_changes: { status: { old: 'in_progress', new: 'cancelled' } },
      context: { source: 'manual' }
    });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to cancel audit' } });
  }
});

// DELETE /qsc/audits/:id — admin/dev only; refuses completed audits
router.delete('/audits/:id', async (req, res) => {
  if (!req.user?.is_dev) {
    return res.status(403).json({ error: { message: 'Only developers can delete audits' } });
  }
  try {
    const old = await pool.query(`SELECT * FROM mcogs_qsc_audits WHERE id = $1`, [req.params.id]);
    if (!old.rows.length) return res.status(404).json({ error: { message: 'Audit not found' } });
    if (old.rows[0].status === 'completed') {
      return res.status(400).json({ error: { message: 'Completed audits cannot be deleted (immutable record)' } });
    }
    await pool.query(`DELETE FROM mcogs_qsc_audits WHERE id = $1`, [req.params.id]);
    await logAudit(pool, req, {
      action: 'delete', entity_type: 'qsc_audit', entity_id: parseInt(req.params.id, 10),
      entity_label: old.rows[0].key, context: { source: 'manual' }
    });
    res.json({ deleted: parseInt(req.params.id, 10) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete audit' } });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RESPONSES
// ─────────────────────────────────────────────────────────────────────────────

// PUT /qsc/audits/:id/responses/:code — upsert single response (auto-save)
router.put('/audits/:id/responses/:code', async (req, res) => {
  const { status, is_repeat, comment, temperature_value, temperature_unit, product_name } = req.body;
  const VALID = ['compliant', 'not_compliant', 'not_observed', 'not_applicable', 'informational'];
  if (status && !VALID.includes(status)) {
    return res.status(400).json({ error: { message: `status must be one of ${VALID.join(', ')}` } });
  }
  try {
    // Confirm audit is still mutable
    const audit = await pool.query(`SELECT status FROM mcogs_qsc_audits WHERE id = $1`, [req.params.id]);
    if (!audit.rows.length) return res.status(404).json({ error: { message: 'Audit not found' } });
    if (audit.rows[0].status !== 'in_progress') {
      return res.status(400).json({ error: { message: 'Audit is locked' } });
    }

    const { rows } = await pool.query(
      `INSERT INTO mcogs_qsc_responses
         (audit_id, question_code, status, is_repeat, comment,
          temperature_value, temperature_unit, product_name, answered_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
       ON CONFLICT (audit_id, question_code) DO UPDATE SET
         status            = EXCLUDED.status,
         is_repeat         = EXCLUDED.is_repeat,
         comment           = EXCLUDED.comment,
         temperature_value = EXCLUDED.temperature_value,
         temperature_unit  = EXCLUDED.temperature_unit,
         product_name      = EXCLUDED.product_name,
         answered_at       = NOW()
       RETURNING *`,
      [
        req.params.id, req.params.code,
        status || 'not_observed',
        !!is_repeat,
        comment?.trim() || null,
        temperature_value ?? null,
        temperature_unit || null,
        product_name?.trim() || null,
      ]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save response' } });
  }
});

// DELETE /qsc/audits/:id/responses/:code — clear response
router.delete('/audits/:id/responses/:code', async (req, res) => {
  try {
    const audit = await pool.query(`SELECT status FROM mcogs_qsc_audits WHERE id = $1`, [req.params.id]);
    if (!audit.rows.length) return res.status(404).json({ error: { message: 'Audit not found' } });
    if (audit.rows[0].status !== 'in_progress') {
      return res.status(400).json({ error: { message: 'Audit is locked' } });
    }
    await pool.query(
      `DELETE FROM mcogs_qsc_responses WHERE audit_id = $1 AND question_code = $2`,
      [req.params.id, req.params.code]
    );
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to clear response' } });
  }
});

// POST /qsc/audits/:id/responses/:code/photos — attach pre-uploaded photo URL
router.post('/audits/:id/responses/:code/photos', async (req, res) => {
  const { url, caption } = req.body;
  if (!url) return res.status(400).json({ error: { message: 'url is required' } });
  try {
    const resp = await pool.query(
      `SELECT id FROM mcogs_qsc_responses WHERE audit_id = $1 AND question_code = $2`,
      [req.params.id, req.params.code]
    );
    if (!resp.rows.length) return res.status(404).json({ error: { message: 'Response not found — answer the question first' } });
    const { rows } = await pool.query(
      `INSERT INTO mcogs_qsc_response_photos (response_id, url, caption)
       VALUES ($1, $2, $3) RETURNING *`,
      [resp.rows[0].id, url, caption?.trim() || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to attach photo' } });
  }
});

// DELETE /qsc/audits/:id/responses/:code/photos/:photoId
router.delete('/audits/:id/responses/:code/photos/:photoId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `DELETE FROM mcogs_qsc_response_photos
       WHERE id = $1
         AND response_id IN (SELECT id FROM mcogs_qsc_responses WHERE audit_id = $2 AND question_code = $3)
       RETURNING id`,
      [req.params.photoId, req.params.id, req.params.code]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Photo not found' } });
    res.json({ deleted: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete photo' } });
  }
});

module.exports = router;
