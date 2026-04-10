'use strict';
// =============================================================================
// Audit Logger — central audit trail for all data changes
//
// Usage in route handlers:
//
//   const { logAudit, diffFields } = require('../helpers/audit');
//
//   // Simple create
//   await logAudit(pool, req, {
//     action: 'create',
//     entity_type: 'price_quote',
//     entity_id: newQuote.id,
//     entity_label: `${ingredientName} — ${vendorName}`,
//     context: { source: 'manual' },
//   });
//
//   // Update with field diff
//   const oldRow = await pool.query('SELECT * FROM ... WHERE id=$1', [id]);
//   // ... do the update ...
//   const newRow = await pool.query('SELECT * FROM ... WHERE id=$1', [id]);
//   await logAudit(pool, req, {
//     action: 'update',
//     entity_type: 'price_quote',
//     entity_id: id,
//     entity_label: `${ingredientName} — ${vendorName}`,
//     field_changes: diffFields(oldRow, newRow, ['purchase_price', 'qty_in_base_units', 'is_active']),
//     context: { source: 'manual' },
//   });
//
//   // With related entities
//   await logAudit(pool, req, {
//     action: 'confirm',
//     entity_type: 'goods_received',
//     entity_id: grn.id,
//     entity_label: grn.grn_number,
//     context: { source: 'goods_received', items_count: items.length },
//     related_entities: [
//       { type: 'purchase_order', id: grn.po_id },
//       { type: 'store', id: grn.store_id },
//     ],
//   });
//
// The helper also works with a transaction client:
//   await logAudit(client, req, { ... });
// =============================================================================

/**
 * Compare two objects and return a JSONB diff of changed fields.
 * Only compares the fields listed in `fields`. Returns null if nothing changed.
 *
 * @param {object} oldRow — the row BEFORE the change
 * @param {object} newRow — the row AFTER the change
 * @param {string[]} fields — which fields to compare
 * @returns {object|null} — { field: { old, new } } or null if no diff
 */
function diffFields(oldRow, newRow, fields) {
  if (!oldRow || !newRow || !fields?.length) return null;
  const diff = {};
  let hasDiff = false;
  for (const f of fields) {
    const oldVal = oldRow[f];
    const newVal = newRow[f];
    // Normalise for comparison: stringify to handle numeric/boolean/null
    const oldStr = oldVal == null ? null : String(oldVal);
    const newStr = newVal == null ? null : String(newVal);
    if (oldStr !== newStr) {
      diff[f] = { old: oldVal ?? null, new: newVal ?? null };
      hasDiff = true;
    }
  }
  return hasDiff ? diff : null;
}

/**
 * Write an audit log entry.
 *
 * @param {object} dbOrClient — pool or transaction client (anything with .query)
 * @param {object} req — Express request (for user info + IP)
 * @param {object} opts
 * @param {'create'|'update'|'delete'|'status_change'|'confirm'|'approve'|'reverse'} opts.action
 * @param {string} opts.entity_type — e.g. 'price_quote', 'ingredient', 'purchase_order'
 * @param {number} [opts.entity_id]
 * @param {string} [opts.entity_label] — human-readable label for display
 * @param {object} [opts.field_changes] — JSONB diff from diffFields()
 * @param {object} [opts.context] — free-form context: { source, tool, job_id, ... }
 * @param {Array}  [opts.related_entities] — [{ type, id, label? }, ...]
 */
async function logAudit(dbOrClient, req, opts) {
  try {
    const user = req?.user || {};
    await dbOrClient.query(`
      INSERT INTO mcogs_audit_log
        (user_sub, user_email, user_name, action, entity_type, entity_id,
         entity_label, field_changes, context, related_entities, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `, [
      user.sub || null,
      user.email || null,
      user.name || null,
      opts.action,
      opts.entity_type,
      opts.entity_id || null,
      opts.entity_label || null,
      opts.field_changes ? JSON.stringify(opts.field_changes) : null,
      opts.context ? JSON.stringify(opts.context) : null,
      opts.related_entities ? JSON.stringify(opts.related_entities) : null,
      req?.ip || req?.headers?.['x-forwarded-for'] || null,
    ]);
  } catch (err) {
    // Audit logging should never break the main operation
    console.error('[audit] Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit, diffFields };
