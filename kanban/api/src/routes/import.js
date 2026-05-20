const router = require('express').Router({ mergeParams: true });
const pool   = require('../db/pool');
const multer = require('multer');
const { parse } = require('csv-parse/sync');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Priority mapping (Jira → kbn) ──────────────────────────────────────────
const PRIORITY_MAP = {
  highest:  'highest', blocker:  'highest', critical: 'highest',
  high:     'high',    major:    'high',
  medium:   'medium',  normal:   'medium',
  low:      'low',     minor:    'low',
  lowest:   'lowest',  trivial:  'lowest',
};

// ── Auto-detect column mapping (case-insensitive) ───────────────────────────
const FIELD_ALIASES = {
  title:        ['summary', 'issue summary', 'title', 'name'],
  description:  ['description'],
  status:       ['status'],
  priority:     ['priority'],
  labels:       ['labels', 'label'],
  story_points: ['story points', 'story_points', 'storypoints', 'sp'],
  epic:         ['epic link', 'epic', 'epic name'],
  jira_key:     ['issue key', 'key', 'issue_key', 'jira_key'],
};

function autoDetectMapping(headers) {
  const mapping = {};
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());

  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
    for (const alias of aliases) {
      const idx = lowerHeaders.indexOf(alias);
      if (idx !== -1) {
        mapping[field] = headers[idx]; // original-case header name
        break;
      }
    }
  }
  return mapping;
}

function normalizePriority(raw) {
  if (!raw) return null;
  const key = String(raw).toLowerCase().trim();
  return PRIORITY_MAP[key] || null;
}

function parseLabels(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map(l => String(l).trim()).filter(Boolean);
  return String(raw).split(',').map(l => l.trim()).filter(Boolean);
}

/**
 * Parse uploaded file content into an array of flat row objects.
 */
function parseFileContent(buffer, filename) {
  const ext = (filename || '').toLowerCase();
  if (ext.endsWith('.json')) {
    const data = JSON.parse(buffer.toString('utf-8'));
    // Handle Jira nested format: { issues: [{ fields: {...}, key: ... }] }
    if (data.issues && Array.isArray(data.issues)) {
      return {
        format: 'json',
        rows: data.issues.map(issue => {
          const f = issue.fields || {};
          return {
            key: issue.key || null,
            summary: f.summary || f.Summary || null,
            description: typeof f.description === 'string' ? f.description : (f.description?.content?.[0]?.content?.[0]?.text || null),
            status: f.status?.name || null,
            priority: f.priority?.name || null,
            labels: f.labels || null,
            story_points: f.customfield_10016 ?? f.story_points ?? f['Story Points'] ?? null,
            epic: f.epic?.name || f.customfield_10014 || f['Epic Link'] || null,
          };
        }),
      };
    }
    // Flat array of objects
    if (Array.isArray(data)) {
      return { format: 'json', rows: data };
    }
    throw new Error('JSON must be an array of objects or Jira export format { issues: [...] }');
  }

  // CSV
  const records = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  });
  return { format: 'csv', rows: records };
}

// POST /boards/:boardId/import/preview
router.post('/:boardId/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: { message: 'File is required' } });

    // Verify board exists
    const { rows: [board] } = await pool.query(
      `SELECT id FROM kbn_boards WHERE id = $1`, [req.params.boardId]
    );
    if (!board) return res.status(404).json({ error: { message: 'Board not found' } });

    const { format, rows } = parseFileContent(req.file.buffer, req.file.originalname);
    if (!rows.length) return res.status(400).json({ error: { message: 'No data rows found' } });

    const headers = Object.keys(rows[0]);
    const suggestedMapping = autoDetectMapping(headers);

    // Get existing columns for status mapping
    const { rows: columns } = await pool.query(
      `SELECT id, name FROM kbn_columns WHERE board_id = $1 ORDER BY sort_order`, [req.params.boardId]
    );

    res.json({
      filename: req.file.originalname,
      format,
      row_count: rows.length,
      headers,
      suggested_mapping: suggestedMapping,
      preview: rows.slice(0, 10),
      board_columns: columns,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: err.message || 'Failed to parse file' } });
  }
});

// POST /boards/:boardId/import/execute
router.post('/:boardId/import/execute', async (req, res) => {
  const { rows: dataRows, mapping, status_column_map, default_column_id, filename, format } = req.body;

  if (!Array.isArray(dataRows) || !dataRows.length) {
    return res.status(400).json({ error: { message: 'rows array is required' } });
  }
  if (!mapping || !mapping.title) {
    return res.status(400).json({ error: { message: 'mapping.title is required' } });
  }

  // Verify board exists and get columns
  const { rows: [board] } = await pool.query(
    `SELECT id FROM kbn_boards WHERE id = $1`, [req.params.boardId]
  );
  if (!board) return res.status(404).json({ error: { message: 'Board not found' } });

  const { rows: columns } = await pool.query(
    `SELECT id, name FROM kbn_columns WHERE board_id = $1`, [req.params.boardId]
  );
  const colByName = {};
  for (const c of columns) colByName[c.name.toLowerCase()] = c.id;
  const firstColId = columns.length > 0 ? columns[0].id : null;
  const fallbackColId = default_column_id || firstColId;

  if (!fallbackColId) {
    return res.status(400).json({ error: { message: 'Board has no columns. Create columns first.' } });
  }

  const client = await pool.connect();
  const errors = [];
  let cardsCreated = 0;

  try {
    await client.query('BEGIN');

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      try {
        const title = row[mapping.title];
        if (!title?.trim()) {
          errors.push({ row: i + 1, error: 'Missing title' });
          continue;
        }

        // Resolve column from status mapping
        let columnId = fallbackColId;
        if (mapping.status && row[mapping.status] && status_column_map) {
          const statusVal = String(row[mapping.status]).toLowerCase().trim();
          const mappedColId = status_column_map[statusVal] || status_column_map[row[mapping.status]];
          if (mappedColId) columnId = mappedColId;
          else if (colByName[statusVal]) columnId = colByName[statusVal];
        }

        const description  = mapping.description  ? (row[mapping.description]  || null) : null;
        const priority     = mapping.priority      ? normalizePriority(row[mapping.priority]) : null;
        const labels       = mapping.labels        ? parseLabels(row[mapping.labels]) : null;
        const storyPoints  = mapping.story_points  ? (parseFloat(row[mapping.story_points]) || null) : null;
        const epic         = mapping.epic          ? (row[mapping.epic] || null) : null;
        const jiraKey      = mapping.jira_key      ? (row[mapping.jira_key] || null) : null;

        await client.query(`
          INSERT INTO kbn_cards (board_id, column_id, title, description, priority, labels, story_points, epic, jira_key, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [req.params.boardId, columnId, title.trim(), description, priority, labels, storyPoints, epic, jiraKey, i]);

        cardsCreated++;
      } catch (rowErr) {
        errors.push({ row: i + 1, error: rowErr.message });
      }
    }

    // Record in kbn_imports
    await client.query(`
      INSERT INTO kbn_imports (board_id, filename, format, row_count, cards_created, column_mapping, errors)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      req.params.boardId,
      filename || 'unknown',
      format || 'csv',
      dataRows.length,
      cardsCreated,
      JSON.stringify(mapping),
      errors.length > 0 ? JSON.stringify(errors) : null,
    ]);

    await client.query('COMMIT');

    res.json({
      cards_created: cardsCreated,
      row_count: dataRows.length,
      errors: errors.length > 0 ? errors : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: { message: 'Import failed: ' + err.message } });
  } finally {
    client.release();
  }
});

module.exports = router;
