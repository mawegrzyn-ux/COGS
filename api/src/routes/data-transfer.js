const router = require('express').Router();
const pool   = require('../db/pool');
const multer = require('multer');

// ---------------------------------------------------------------------------
// Reuse table lists and core functions from the CLI scripts
// ---------------------------------------------------------------------------
const { EXPORT_ORDER, JUNCTION_TABLES, tableExists, exportTable } = require('../../scripts/export-data');
const { IMPORT_ORDER, importTable } = require('../../scripts/import-data-full');

// ---------------------------------------------------------------------------
// multer — in-memory upload, 50 MB limit
// ---------------------------------------------------------------------------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Table → group mapping
// ---------------------------------------------------------------------------
const TABLE_GROUPS = {};

function assignGroup(tables, group) {
  for (const t of tables) TABLE_GROUPS[t] = group;
}

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_units'),
  EXPORT_ORDER.indexOf('mcogs_settings') + 1
), 'Master Data');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_vendors'),
  EXPORT_ORDER.indexOf('mcogs_ingredient_preferred_vendor') + 1
), 'Inventory');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_recipes'),
  EXPORT_ORDER.indexOf('mcogs_recipe_market_pl_variations') + 1
), 'Recipes');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_sales_items'),
  EXPORT_ORDER.indexOf('mcogs_combo_template_step_options') + 1
), 'Sales Items');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_menus'),
  EXPORT_ORDER.indexOf('mcogs_shared_page_changes') + 1
), 'Menus');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_location_groups'),
  EXPORT_ORDER.indexOf('mcogs_kiosk_orders') + 1
), 'Locations & Stock');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_equipment'),
  EXPORT_ORDER.indexOf('mcogs_ccp_logs') + 1
), 'HACCP');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_qsc_questions'),
  EXPORT_ORDER.indexOf('mcogs_qsc_response_photos') + 1
), 'QSC');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_feedback'),
  EXPORT_ORDER.indexOf('mcogs_item_comments') + 1
), 'Backlog & Tracking');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_doc_categories'),
  EXPORT_ORDER.indexOf('mcogs_faq') + 1
), 'Documentation');

assignGroup(EXPORT_ORDER.slice(
  EXPORT_ORDER.indexOf('mcogs_media_categories'),
  EXPORT_ORDER.indexOf('mcogs_media_items') + 1
), 'Media');

assignGroup(['mcogs_changelog'], 'Changelog');

// ═══════════════════════════════════════════════════════════════════════════
// GET /data-transfer/tables
// Returns the list of exportable tables with live row counts.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/tables', async (_req, res) => {
  try {
    const client = await pool.connect();
    try {
      const tables = [];
      let totalRows = 0;

      for (const tableName of EXPORT_ORDER) {
        const exists = await tableExists(client, tableName);
        let rows = 0;
        if (exists) {
          const cnt = await client.query(`SELECT COUNT(*)::int AS n FROM ${tableName}`);
          rows = cnt.rows[0].n;
        }
        tables.push({
          name: tableName,
          group: TABLE_GROUPS[tableName] || 'Other',
          rows,
          exists,
        });
        totalRows += rows;
      }

      res.json({
        tables,
        total_tables: EXPORT_ORDER.length,
        total_rows: totalRows,
      });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('GET /data-transfer/tables error:', err);
    res.status(500).json({ error: { message: `Failed to fetch table list: ${err.message}` } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /data-transfer/export
// Exports database tables as a downloadable JSON file.
// Body (optional): { tables: [...], compact: false }
// ═══════════════════════════════════════════════════════════════════════════
router.post('/export', async (req, res) => {
  // Extend timeout — large DBs can take minutes to export all 87 tables
  req.setTimeout(5 * 60 * 1000);
  res.setTimeout(5 * 60 * 1000);

  try {
    const { tables: onlyTables, compact } = req.body || {};
    const tablesToExport = onlyTables && onlyTables.length
      ? EXPORT_ORDER.filter(t => onlyTables.includes(t))
      : EXPORT_ORDER;

    const client = await pool.connect();
    try {
      const tables = {};
      const rowCounts = {};
      let totalRows = 0;
      let tableCount = 0;

      for (const tableName of tablesToExport) {
        let rows;
        try {
          rows = await exportTable(client, tableName);
        } catch (tableErr) {
          console.error(`  ⚠ Export failed for ${tableName}:`, tableErr.message);
          rows = null;
        }
        if (rows !== null) {
          tables[tableName] = rows;
          rowCounts[tableName] = rows.length;
          totalRows += rows.length;
          tableCount++;
        }
      }

      const exportPayload = {
        exported_at: new Date().toISOString(),
        source: 'api',
        version: '1.0.0',
        table_count: tableCount,
        tables,
        row_counts: rowCounts,
      };

      const json = compact
        ? JSON.stringify(exportPayload)
        : JSON.stringify(exportPayload, null, 2);

      const today = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="mcogs-export-${today}.json"`);
      res.send(json);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /data-transfer/export error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: { message: `Export failed: ${err.message}` } });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /data-transfer/import
// Accepts a multipart file upload of an export JSON file and imports it.
// Query params: ?dry_run=true, ?tables=t1,t2, ?skip=t1,t2
// ═══════════════════════════════════════════════════════════════════════════
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { message: 'No file uploaded. Use multipart field "file".' } });
    }

    // Parse the uploaded JSON
    let exportData;
    try {
      exportData = JSON.parse(req.file.buffer.toString('utf8'));
    } catch {
      return res.status(400).json({ error: { message: 'Invalid JSON file' } });
    }

    // Validate structure
    if (!exportData.exported_at || !exportData.tables || typeof exportData.tables !== 'object') {
      return res.status(400).json({ error: { message: 'Invalid export file structure. Expected exported_at and tables fields.' } });
    }

    const dryRun = req.query.dry_run === 'true';
    const onlyTables = req.query.tables
      ? new Set(req.query.tables.split(',').map(s => s.trim()).filter(Boolean))
      : null;
    const skipTables = req.query.skip
      ? new Set(req.query.skip.split(',').map(s => s.trim()).filter(Boolean))
      : new Set();

    const client = await pool.connect();
    try {
      if (!dryRun) {
        await client.query('BEGIN');

        // Disable FK triggers on all tables we'll import into.
        // This replaces SET session_replication_role = replica which needs superuser.
        for (const tableName of IMPORT_ORDER) {
          if (onlyTables && !onlyTables.has(tableName)) continue;
          if (skipTables.has(tableName)) continue;
          const exists = await tableExists(client, tableName);
          if (exists) {
            await client.query(`ALTER TABLE ${tableName} DISABLE TRIGGER ALL`);
          }
        }
      }

      const details = [];
      let totalImported = 0;
      let tablesProcessed = 0;

      for (const tableName of IMPORT_ORDER) {
        if (onlyTables && !onlyTables.has(tableName)) continue;
        if (skipTables.has(tableName)) continue;

        const fileRows = exportData.tables[tableName] || [];

        if (!dryRun) {
          const exists = await tableExists(client, tableName);
          if (!exists) {
            details.push({ table: tableName, rows_imported: 0, rows_in_file: fileRows.length, status: 'table_not_found' });
            continue;
          }
        }

        const imported = await importTable(client, tableName, fileRows, dryRun);
        details.push({
          table: tableName,
          rows_imported: imported,
          rows_in_file: fileRows.length,
          status: 'ok',
        });
        totalImported += imported;
        tablesProcessed++;
      }

      if (!dryRun) {
        // Re-enable FK triggers
        for (const tableName of IMPORT_ORDER) {
          if (onlyTables && !onlyTables.has(tableName)) continue;
          if (skipTables.has(tableName)) continue;
          const exists = await tableExists(client, tableName);
          if (exists) {
            await client.query(`ALTER TABLE ${tableName} ENABLE TRIGGER ALL`);
          }
        }
        await client.query('COMMIT');
      }

      res.json({
        success: true,
        dry_run: dryRun,
        tables_imported: tablesProcessed,
        total_rows: totalImported,
        details,
      });
    } catch (importErr) {
      if (!dryRun) {
        try { await client.query('ROLLBACK'); } catch { /* ignore rollback errors */ }
      }
      throw importErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /data-transfer/import error:', err);
    res.status(500).json({ error: { message: `Import failed: ${err.message}` } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /data-transfer/history
// Returns recent export/import operations (placeholder for now).
// ═══════════════════════════════════════════════════════════════════════════
router.get('/history', async (_req, res) => {
  try {
    res.json({ history: [] });
  } catch (err) {
    console.error('GET /data-transfer/history error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch history' } });
  }
});

module.exports = router;
