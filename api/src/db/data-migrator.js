// =============================================================================
// Data migrator — copies all mcogs_* tables from a source pool to a target pool
//
// Strategy:
//   1. Discover every mcogs_* table on the source via pg_catalog.
//   2. Discover FK edges between those tables and topologically sort them so
//      parents are inserted before children. This avoids any need for
//      session_replication_role (which requires elevated privileges on RDS).
//   3. On the target:
//        • TRUNCATE in REVERSE topo order so child rows clear before parents,
//          avoiding the need for CASCADE.
//        • INSERT in topo order, batched and parameterized.
//        • After each table, advance its serial sequence past max(id) so
//          subsequent inserts via the API don't collide.
//   4. Wrap the whole target side in a single transaction so a failure leaves
//      the target untouched.
//
// The source is read with a single dedicated client (not from the live pool)
// so the migration doesn't starve in-flight requests. Both sides use streaming
// row reads when available; for now we use a paged SELECT for portability.
// =============================================================================

const SCHEMA = 'public';
const TABLE_PREFIX = 'mcogs_';
const BATCH_SIZE = 500;

// ── Discovery ────────────────────────────────────────────────────────────────

async function listTables(client) {
  const { rows } = await client.query(
    `SELECT tablename
       FROM pg_catalog.pg_tables
      WHERE schemaname = $1
        AND tablename LIKE $2
      ORDER BY tablename`,
    [SCHEMA, TABLE_PREFIX + '%']
  );
  return rows.map(r => r.tablename);
}

async function listForeignKeys(client) {
  const { rows } = await client.query(
    `SELECT
       cl.relname  AS from_table,
       rcl.relname AS to_table
     FROM pg_constraint c
     JOIN pg_class cl  ON cl.oid  = c.conrelid
     JOIN pg_class rcl ON rcl.oid = c.confrelid
     WHERE c.contype = 'f'
       AND cl.relname  LIKE $1
       AND rcl.relname LIKE $1`,
    [TABLE_PREFIX + '%']
  );
  return rows; // [{ from_table, to_table }]
}

// Topological sort: parents before children. Self-references and cycles are
// tolerated — the offending edge is dropped and a warning is returned alongside
// the order.
function topoSort(tables, edges) {
  const tableSet = new Set(tables);
  const deps = new Map();   // table → Set of tables it depends on
  for (const t of tables) deps.set(t, new Set());

  const warnings = [];
  for (const e of edges) {
    if (!tableSet.has(e.from_table) || !tableSet.has(e.to_table)) continue;
    if (e.from_table === e.to_table) {
      warnings.push(`self-reference on ${e.from_table} — rows copied in id order`);
      continue;
    }
    deps.get(e.from_table).add(e.to_table);
  }

  const sorted = [];
  const visited  = new Set();
  const visiting = new Set();

  function visit(t) {
    if (visited.has(t)) return;
    if (visiting.has(t)) {
      warnings.push(`FK cycle involving ${t} — order may be incorrect`);
      return;
    }
    visiting.add(t);
    for (const dep of deps.get(t)) visit(dep);
    visiting.delete(t);
    visited.add(t);
    sorted.push(t);
  }
  for (const t of tables) visit(t);
  return { order: sorted, warnings };
}

async function discoverOrder(client) {
  const tables = await listTables(client);
  const edges  = await listForeignKeys(client);
  return topoSort(tables, edges);
}

// ── Counts ───────────────────────────────────────────────────────────────────

async function countRows(client, tables) {
  const out = {};
  let total = 0;
  for (const t of tables) {
    try {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
      out[t] = rows[0].n;
      total += rows[0].n;
    } catch {
      out[t] = null; // table missing on this side
    }
  }
  return { per_table: out, total };
}

// ── Copy ─────────────────────────────────────────────────────────────────────

function quoteIdent(name) {
  return '"' + String(name).replace(/"/g, '""') + '"';
}

async function getColumnsInOrder(client, table) {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [SCHEMA, table]
  );
  return rows.map(r => r.column_name);
}

async function tableHasSelfReference(client, table) {
  const { rows } = await client.query(
    `SELECT 1
       FROM pg_constraint c
       JOIN pg_class cl  ON cl.oid  = c.conrelid
       JOIN pg_class rcl ON rcl.oid = c.confrelid
      WHERE c.contype = 'f'
        AND cl.relname  = $1
        AND rcl.relname = $1
      LIMIT 1`,
    [table]
  );
  return rows.length > 0;
}

async function copyTable(sourceClient, targetClient, table, log) {
  const cols = await getColumnsInOrder(sourceClient, table);
  if (!cols.length) {
    log(`  ${table}: no columns — skipped`);
    return { rows: 0 };
  }

  const colList     = cols.map(quoteIdent).join(', ');
  const orderBy     = cols.includes('id')
    ? 'ORDER BY id'
    : (await tableHasSelfReference(sourceClient, table) ? '' : '');

  const { rows } = await sourceClient.query(
    `SELECT ${colList} FROM ${quoteIdent(table)} ${orderBy}`
  );
  if (!rows.length) {
    log(`  ${table}: 0 rows`);
    return { rows: 0 };
  }

  // Build batched INSERTs.
  let copied = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const slice = rows.slice(i, i + BATCH_SIZE);
    const params = [];
    const valueGroups = [];
    for (const row of slice) {
      const placeholders = [];
      for (const col of cols) {
        params.push(row[col] === undefined ? null : row[col]);
        placeholders.push('$' + params.length);
      }
      valueGroups.push('(' + placeholders.join(', ') + ')');
    }
    const sql =
      `INSERT INTO ${quoteIdent(table)} (${colList}) VALUES ${valueGroups.join(', ')}`;
    await targetClient.query(sql, params);
    copied += slice.length;
  }

  // Advance the serial sequence past max(id) so future inserts don't collide.
  if (cols.includes('id')) {
    await targetClient.query(
      `SELECT setval(
         pg_get_serial_sequence($1, 'id'),
         COALESCE((SELECT MAX(id) FROM ${quoteIdent(table)}), 0) + 1,
         false
       )`,
      [table]
    );
  }

  log(`  ${table}: ${copied} rows`);
  return { rows: copied };
}

// ── Public API ───────────────────────────────────────────────────────────────

// migrate(sourcePool, targetPool, opts)
//   sourcePool / targetPool: pg Pool instances (caller owns lifecycle)
//   opts.log: optional console-like fn for progress messages
//   opts.allowOverwrite: must be true if any target mcogs_* table is non-empty
//
// Returns:
//   {
//     order: [table, ...],
//     source: { per_table: {...}, total: N },
//     target_before: { per_table: {...}, total: M },
//     copied: { per_table: {...}, total: K },
//     warnings: [...],
//   }
//
// On failure throws — the target is rolled back, source is untouched.
async function migrate(sourcePool, targetPool, opts = {}) {
  const log = opts.log || (() => {});
  const allowOverwrite = !!opts.allowOverwrite;

  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();

  try {
    log('[migrate] Discovering source schema…');
    const { order, warnings } = await discoverOrder(sourceClient);
    log(`[migrate] ${order.length} tables in FK-safe order`);

    log('[migrate] Counting rows…');
    const source        = await countRows(sourceClient, order);
    const target_before = await countRows(targetClient, order);

    if (target_before.total > 0 && !allowOverwrite) {
      const e = new Error(
        `Target database is not empty (${target_before.total} rows across ${
          Object.values(target_before.per_table).filter(n => n > 0).length
        } tables). Pass allowOverwrite=true to replace its data.`
      );
      e.code = 'TARGET_NOT_EMPTY';
      e.target_before = target_before;
      throw e;
    }

    log('[migrate] Beginning transaction on target…');
    await targetClient.query('BEGIN');

    // TRUNCATE in REVERSE topo order (children before parents) so we never
    // need CASCADE.
    log('[migrate] Truncating target tables (reverse FK order)…');
    for (const table of [...order].reverse()) {
      try {
        await targetClient.query(`TRUNCATE TABLE ${quoteIdent(table)}`);
      } catch (err) {
        // Table might not exist on target yet — skip and let the copy below
        // surface the real error if any.
        log(`  truncate skipped (${table}): ${err.message}`);
      }
    }

    log('[migrate] Copying data (FK order)…');
    const copied_per_table = {};
    let copied_total = 0;
    for (const table of order) {
      try {
        const { rows } = await copyTable(sourceClient, targetClient, table, log);
        copied_per_table[table] = rows;
        copied_total += rows;
      } catch (err) {
        throw new Error(`Copy failed at table ${table}: ${err.message}`);
      }
    }

    await targetClient.query('COMMIT');
    log(`[migrate] Done — ${copied_total} rows copied across ${order.length} tables`);

    return {
      order,
      source,
      target_before,
      copied: { per_table: copied_per_table, total: copied_total },
      warnings,
    };
  } catch (err) {
    try { await targetClient.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    sourceClient.release();
    targetClient.release();
  }
}

// preview(sourcePool, targetPool) — counts only, no writes.
async function preview(sourcePool, targetPool) {
  const sourceClient = await sourcePool.connect();
  const targetClient = await targetPool.connect();
  try {
    const { order, warnings } = await discoverOrder(sourceClient);
    const source        = await countRows(sourceClient, order);
    const target_before = await countRows(targetClient, order);
    return { order, source, target_before, warnings };
  } finally {
    sourceClient.release();
    targetClient.release();
  }
}

module.exports = { migrate, preview, discoverOrder, listTables, listForeignKeys, topoSort };
