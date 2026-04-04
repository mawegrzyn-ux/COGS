// =============================================================================
// Menu Sales Items — link between menus and the Sales Items catalog
// Prices auto-copied from SI defaults on add; per-menu overrides tracked separately
// =============================================================================
const router = require('express').Router();
const pool   = require('../db/pool');

// ─── helper: full row with prices + override flags ───────────────────────────
async function fetchRow(id, client) {
  const db = client || pool;
  const { rows } = await db.query(
    `SELECT msi.*,
            si.name       AS sales_item_name,
            si.item_type,
            si.image_url  AS si_image_url,
            cat.name      AS category
     FROM   mcogs_menu_sales_items msi
     JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
     LEFT JOIN mcogs_categories cat ON cat.id = si.category_id
     WHERE  msi.id = $1`,
    [id]
  );
  if (!rows.length) return null;
  const row = rows[0];

  // Attach per-menu prices with override flag
  const { rows: prices } = await db.query(
    `SELECT msip.*,
            pl.name AS price_level_name,
            sip.sell_price AS default_price,
            (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
     FROM   mcogs_menu_sales_item_prices msip
     JOIN   mcogs_price_levels pl ON pl.id = msip.price_level_id
     LEFT JOIN mcogs_sales_item_prices sip
               ON sip.sales_item_id = $2 AND sip.price_level_id = msip.price_level_id
     WHERE  msip.menu_sales_item_id = $1
     ORDER  BY pl.id`,
    [id, row.sales_item_id]
  );
  return { ...row, prices };
}

// ─── GET /menu-sales-items?menu_id=X ─────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { menu_id } = req.query;
    if (!menu_id) return res.status(400).json({ error: { message: 'menu_id is required' } });

    const { rows: items } = await pool.query(
      `SELECT msi.*,
              si.name      AS sales_item_name,
              si.item_type,
              si.image_url AS si_image_url,
              cat.name     AS category
       FROM   mcogs_menu_sales_items msi
       JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
       LEFT JOIN mcogs_categories cat ON cat.id = si.category_id
       WHERE  msi.menu_id = $1
       ORDER  BY msi.sort_order, msi.id`,
      [menu_id]
    );

    if (!items.length) return res.json([]);

    // Batch-load prices + override flags
    const msiIds    = items.map(r => r.id);
    const siIds     = items.map(r => r.sales_item_id);

    const { rows: prices } = await pool.query(
      `SELECT msip.*,
              pl.name AS price_level_name,
              sip.sell_price AS default_price,
              (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
       FROM   mcogs_menu_sales_item_prices msip
       JOIN   mcogs_price_levels pl ON pl.id = msip.price_level_id
       LEFT JOIN mcogs_sales_item_prices sip
                 ON sip.sales_item_id = (
                   SELECT sales_item_id FROM mcogs_menu_sales_items WHERE id = msip.menu_sales_item_id
                 ) AND sip.price_level_id = msip.price_level_id
       WHERE  msip.menu_sales_item_id = ANY($1)
       ORDER  BY msip.menu_sales_item_id, pl.id`,
      [msiIds]
    );

    const priceMap = {};
    for (const p of prices) {
      if (!priceMap[p.menu_sales_item_id]) priceMap[p.menu_sales_item_id] = [];
      priceMap[p.menu_sales_item_id].push(p);
    }

    const result = items.map(item => ({
      ...item,
      prices: priceMap[item.id] || [],
      has_price_override: (priceMap[item.id] || []).some(p => p.is_overridden),
    }));

    // Suppress unused variable warning
    void siIds;

    res.json(result);
  } catch (err) { next(err); }
});

// ─── POST /menu-sales-items ───────────────────────────────────────────────────
// Validates market visibility, inserts row, copies default prices in same transaction
router.post('/', async (req, res, next) => {
  try {
    const { menu_id, sales_item_id, qty, sort_order } = req.body;
    if (!menu_id || !sales_item_id) {
      return res.status(400).json({ error: { message: 'menu_id and sales_item_id are required' } });
    }

    // Verify Sales Item exists and check market visibility
    const { rows: siRows } = await pool.query(
      'SELECT * FROM mcogs_sales_items WHERE id=$1', [sales_item_id]
    );
    if (!siRows.length) return res.status(404).json({ error: { message: 'Sales item not found' } });

    const { rows: menuRows } = await pool.query(
      'SELECT country_id FROM mcogs_menus WHERE id=$1', [menu_id]
    );
    if (!menuRows.length) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId = menuRows[0].country_id;

    // Check: if the SI has any market rows for this country, it must be active
    const { rows: marketRows } = await pool.query(
      `SELECT is_active FROM mcogs_sales_item_markets
       WHERE sales_item_id=$1 AND country_id=$2`,
      [sales_item_id, countryId]
    );
    if (marketRows.length && !marketRows[0].is_active) {
      return res.status(400).json({
        error: { message: 'This Sales Item is not active in the menu\'s market' }
      });
    }

    const client = await pool.connect();
    let newMsi;
    try {
      await client.query('BEGIN');

      const { rows: inserted } = await client.query(
        `INSERT INTO mcogs_menu_sales_items (menu_id, sales_item_id, qty, sort_order)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (menu_id, sales_item_id) DO UPDATE SET qty=$3, sort_order=$4
         RETURNING *`,
        [menu_id, sales_item_id, qty || 1, sort_order || 0]
      );
      newMsi = inserted[0];

      // Copy default prices from mcogs_sales_item_prices (if not already present)
      await client.query(
        `INSERT INTO mcogs_menu_sales_item_prices (menu_sales_item_id, price_level_id, sell_price, tax_rate_id)
         SELECT $1, sip.price_level_id, sip.sell_price, sip.tax_rate_id
         FROM   mcogs_sales_item_prices sip
         WHERE  sip.sales_item_id = $2
         ON CONFLICT (menu_sales_item_id, price_level_id) DO NOTHING`,
        [newMsi.id, sales_item_id]
      );

      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); throw e; }
    finally { client.release(); }

    const full = await fetchRow(newMsi.id);
    res.status(201).json(full);
  } catch (err) { next(err); }
});

// ─── PUT /menu-sales-items/:id ────────────────────────────────────────────────
router.put('/:id', async (req, res, next) => {
  try {
    const { qty, sort_order, allergen_notes } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_menu_sales_items SET qty=$1, sort_order=$2, allergen_notes=$3
       WHERE id=$4 RETURNING *`,
      [qty || 1, sort_order || 0, allergen_notes || null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    const full = await fetchRow(rows[0].id);
    res.json(full);
  } catch (err) { next(err); }
});

// ─── DELETE /menu-sales-items/:id ─────────────────────────────────────────────
router.delete('/:id', async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM mcogs_menu_sales_items WHERE id=$1', [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// ─── PUT /menu-sales-items/:id/prices ─────────────────────────────────────────
// Upsert a single price level override
router.put('/:id/prices', async (req, res, next) => {
  try {
    const { price_level_id, sell_price, tax_rate_id } = req.body;
    if (!price_level_id) return res.status(400).json({ error: { message: 'price_level_id is required' } });

    await pool.query(
      `INSERT INTO mcogs_menu_sales_item_prices (menu_sales_item_id, price_level_id, sell_price, tax_rate_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (menu_sales_item_id, price_level_id)
       DO UPDATE SET sell_price=$3, tax_rate_id=$4`,
      [req.params.id, price_level_id, sell_price ?? 0, tax_rate_id || null]
    );

    const full = await fetchRow(req.params.id);
    if (!full) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    res.json(full);
  } catch (err) { next(err); }
});

// ─── GET /menu-sales-items/:id/price-diff ─────────────────────────────────────
// Returns per price level: default vs menu price + is_overridden flag
router.get('/:id/price-diff', async (req, res, next) => {
  try {
    const { rows: msiRows } = await pool.query(
      'SELECT sales_item_id FROM mcogs_menu_sales_items WHERE id=$1', [req.params.id]
    );
    if (!msiRows.length) return res.status(404).json({ error: { message: 'Menu sales item not found' } });
    const siId = msiRows[0].sales_item_id;

    const { rows } = await pool.query(
      `SELECT pl.id AS price_level_id,
              pl.name AS price_level_name,
              sip.sell_price AS default_price,
              msip.sell_price AS menu_price,
              (msip.sell_price IS DISTINCT FROM sip.sell_price) AS is_overridden
       FROM   mcogs_price_levels pl
       LEFT JOIN mcogs_sales_item_prices sip
                 ON sip.sales_item_id = $1 AND sip.price_level_id = pl.id
       LEFT JOIN mcogs_menu_sales_item_prices msip
                 ON msip.menu_sales_item_id = $2 AND msip.price_level_id = pl.id
       ORDER  BY pl.id`,
      [siId, req.params.id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
