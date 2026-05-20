'use strict';
// BACK-2728 — Kiosk PWA order receiver.
//
// The kiosk renders a self-service ordering UX that is fully client-side.
// Orders placed while the device is offline are queued in IndexedDB and
// drained here when the network is back. The drain is idempotent because
// the client generates `order_uuid` (crypto.randomUUID) and we ON CONFLICT
// DO NOTHING on the unique column — replaying a queued order any number
// of times always results in exactly one row.

const router = require('express').Router();
const pool   = require('../db/pool');
const { logAudit } = require('../helpers/audit');

// POST /api/kiosk-orders
// Body: {
//   order_uuid:        string  (required, client-generated UUID)
//   menu_id:           number
//   country_id:        number
//   price_level_id:    number | null
//   order_type:        'dine_in' | 'takeaway' | 'delivery'  (free-form text)
//   payment_method:    'card' | 'cash'
//   currency_code:     string
//   currency_symbol:   string
//   subtotal:          number
//   tax:               number
//   total:             number
//   items:             array  (full receipt payload — see KioskMockupPage CartLine)
//   placed_at_client:  ISO timestamp (when the customer hit Pay)
// }
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.order_uuid || typeof b.order_uuid !== 'string') {
      return res.status(400).json({ error: { message: 'order_uuid is required' } });
    }
    // UUID-ish guard — reject anything that does not look like a uuid v4-style
    // string. Defence against accidental ID collision via predictable values.
    if (!/^[0-9a-f-]{32,40}$/i.test(b.order_uuid)) {
      return res.status(400).json({ error: { message: 'order_uuid must be a uuid' } });
    }

    const items = Array.isArray(b.items) ? b.items : [];

    const { rows } = await pool.query(
      `INSERT INTO mcogs_kiosk_orders
         (order_uuid, menu_id, country_id, price_level_id,
          order_type, payment_method, currency_code, currency_symbol,
          subtotal, tax, total, items,
          placed_at_client, source, user_sub, user_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15,$16)
       ON CONFLICT (order_uuid) DO NOTHING
       RETURNING *`,
      [
        b.order_uuid,
        b.menu_id          || null,
        b.country_id       || null,
        b.price_level_id   || null,
        b.order_type       || null,
        b.payment_method   || null,
        b.currency_code    || null,
        b.currency_symbol  || null,
        Number(b.subtotal) || 0,
        Number(b.tax)      || 0,
        Number(b.total)    || 0,
        JSON.stringify(items),
        b.placed_at_client || null,
        'kiosk_pwa',
        req.user?.sub      || null,
        req.user?.email    || null,
      ]
    );

    if (rows.length === 0) {
      // Duplicate — the order was already accepted on a prior drain attempt.
      // Look it up and return it so the client can mark its local copy synced
      // and remove it from the queue.
      const { rows: existing } = await pool.query(
        `SELECT * FROM mcogs_kiosk_orders WHERE order_uuid = $1`,
        [b.order_uuid]
      );
      return res.json({ order: existing[0] || null, duplicate: true });
    }

    const order = rows[0];
    logAudit(pool, req, {
      action:        'create',
      entity_type:   'kiosk_order',
      entity_id:     order.id,
      entity_label:  order.order_uuid,
      context:       { source: 'kiosk_pwa', total: Number(order.total), items_count: items.length },
    });

    res.json({ order, duplicate: false });
  } catch (err) {
    console.error('kiosk-orders POST', err);
    res.status(500).json({ error: { message: err.message || 'Failed to record kiosk order' } });
  }
});

// GET /api/kiosk-orders — admin/operator listing for the back-of-house
// reconciliation. Defaults to the last 100 orders ordered by placed_at_server.
// Filterable by menu_id + date range.
router.get('/', async (req, res) => {
  try {
    const { menu_id, since, limit } = req.query;
    const conds = [];
    const vals  = [];
    if (menu_id) { vals.push(Number(menu_id)); conds.push(`menu_id = $${vals.length}`); }
    if (since)   { vals.push(since);            conds.push(`placed_at_server >= $${vals.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    vals.push(Math.min(Number(limit) || 100, 500));
    const { rows } = await pool.query(
      `SELECT * FROM mcogs_kiosk_orders ${where}
       ORDER BY placed_at_server DESC
       LIMIT $${vals.length}`,
      vals
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
