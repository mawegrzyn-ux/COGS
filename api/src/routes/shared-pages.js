// =============================================================================
// Shared Menu Engineer Pages
// Management: GET/POST/PUT/DELETE /api/shared-pages   (authenticated)
// Public:     GET  /api/public/share/:slug            (meta, no auth)
//             POST /api/public/share/:slug/auth       (password → token)
//             GET  /api/public/share/:slug/data       (cogs data, Bearer token)
// =============================================================================

const router    = require('express').Router();
const pool      = require('../db/pool');
const crypto    = require('crypto');

const {
  loadQuoteLookup,
  calcRecipeCost,
  loadAllRecipeItemsDeep,
  loadVariationItemsMap,
} = require('./cogs');

// ── Config ────────────────────────────────────────────────────────────────────

const HMAC_SECRET = process.env.SHARED_PAGE_SECRET || 'mcogs-shared-page-secret-change-me';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ── Token helpers ─────────────────────────────────────────────────────────────

function signToken(payload) {
  const json = JSON.stringify(payload);
  const b64  = Buffer.from(json).toString('base64url');
  const sig  = crypto.createHmac('sha256', HMAC_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(b64).digest('base64url');
  const sigBuf      = Buffer.from(sig,      'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Password helpers ──────────────────────────────────────────────────────────

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => {
      if (err) reject(err);
      else resolve(derived.toString('hex'));
    });
  });
}

async function verifyPassword(password, storedHash, storedSalt) {
  const hash = await hashPassword(password, storedSalt);
  const hashBuf   = Buffer.from(hash,       'hex');
  const storedBuf = Buffer.from(storedHash, 'hex');
  if (hashBuf.length !== storedBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, storedBuf);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MANAGEMENT ROUTES (authenticated — called from within the app)
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/shared-pages
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sp.*,
             m.name  AS menu_name,
             c.name  AS country_name,
             c.currency_symbol
      FROM   mcogs_shared_pages sp
      LEFT JOIN mcogs_menus     m ON m.id = sp.menu_id
      LEFT JOIN mcogs_countries c ON c.id = sp.country_id
      ORDER BY sp.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch shared pages' } });
  }
});

// POST /api/shared-pages
router.post('/', async (req, res) => {
  const { name, mode = 'view', password, menu_id, country_id, expires_at } = req.body;
  if (!name)     return res.status(400).json({ error: { message: 'name is required' } });
  if (!password) return res.status(400).json({ error: { message: 'password is required' } });
  if (!['view', 'edit'].includes(mode)) return res.status(400).json({ error: { message: 'mode must be view or edit' } });

  try {
    const slug = crypto.randomBytes(8).toString('hex'); // 16-char hex
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_shared_pages
        (slug, name, mode, password_hash, password_salt, menu_id, country_id, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *
    `, [slug, name, mode, hash, salt,
        menu_id   || null,
        country_id || null,
        expires_at || null]);

    res.status(201).json({ ...row, url: `/share/${slug}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create shared page' } });
  }
});

// PUT /api/shared-pages/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, mode, password, menu_id, country_id, is_active, expires_at } = req.body;

  try {
    const { rows: [existing] } = await pool.query(
      `SELECT * FROM mcogs_shared_pages WHERE id = $1`, [id]
    );
    if (!existing) return res.status(404).json({ error: { message: 'Not found' } });

    let hash = existing.password_hash;
    let salt = existing.password_salt;

    if (password) {
      salt = generateSalt();
      hash = await hashPassword(password, salt);
    }

    const { rows: [row] } = await pool.query(`
      UPDATE mcogs_shared_pages SET
        name          = COALESCE($1, name),
        mode          = COALESCE($2, mode),
        password_hash = $3,
        password_salt = $4,
        menu_id       = $5,
        country_id    = $6,
        is_active     = COALESCE($7, is_active),
        expires_at    = $8,
        updated_at    = NOW()
      WHERE id = $9
      RETURNING *
    `, [
      name       ?? null,
      mode       ?? null,
      hash, salt,
      menu_id    !== undefined ? (menu_id    || null) : existing.menu_id,
      country_id !== undefined ? (country_id || null) : existing.country_id,
      is_active  !== undefined ? is_active             : null,
      expires_at !== undefined ? (expires_at || null) : existing.expires_at,
      id,
    ]);

    res.json({ ...row, url: `/share/${row.slug}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to update shared page' } });
  }
});

// DELETE /api/shared-pages/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM mcogs_shared_pages WHERE id = $1`, [req.params.id]
    );
    if (!rowCount) return res.status(404).json({ error: { message: 'Not found' } });
    res.json({ deleted: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to delete shared page' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES (no authentication — open to the world)
// ═══════════════════════════════════════════════════════════════════════════════

const publicRouter = require('express').Router();

// GET /api/public/share/:slug — meta (name, mode, locked menu/market)
publicRouter.get('/:slug', async (req, res) => {
  try {
    const { rows: [page] } = await pool.query(`
      SELECT sp.id, sp.slug, sp.name, sp.mode, sp.menu_id, sp.country_id,
             sp.is_active, sp.expires_at,
             m.name  AS menu_name,
             c.name  AS country_name
      FROM   mcogs_shared_pages sp
      LEFT JOIN mcogs_menus     m ON m.id = sp.menu_id
      LEFT JOIN mcogs_countries c ON c.id = sp.country_id
      WHERE  sp.slug = $1
    `, [req.params.slug]);

    if (!page)             return res.status(404).json({ error: { message: 'Page not found' } });
    if (!page.is_active)   return res.status(403).json({ error: { message: 'This link is disabled' } });
    if (page.expires_at && new Date(page.expires_at) < new Date()) {
      return res.status(403).json({ error: { message: 'This link has expired' } });
    }

    res.json({
      name:         page.name,
      mode:         page.mode,
      menu_locked:  !!page.menu_id,
      menu_id:      page.menu_id,
      menu_name:    page.menu_name,
      market_locked: !!page.country_id,
      country_id:   page.country_id,
      country_name: page.country_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

// POST /api/public/share/:slug/auth — password → token
publicRouter.post('/:slug/auth', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: { message: 'password is required' } });

  try {
    const { rows: [page] } = await pool.query(
      `SELECT id, slug, mode, password_hash, password_salt, menu_id, country_id,
              is_active, expires_at
       FROM   mcogs_shared_pages WHERE slug = $1`,
      [req.params.slug]
    );

    if (!page)           return res.status(404).json({ error: { message: 'Page not found' } });
    if (!page.is_active) return res.status(403).json({ error: { message: 'This link is disabled' } });
    if (page.expires_at && new Date(page.expires_at) < new Date()) {
      return res.status(403).json({ error: { message: 'This link has expired' } });
    }

    const ok = await verifyPassword(password, page.password_hash, page.password_salt);
    if (!ok) {
      // Artificial delay to slow brute-force
      await new Promise(r => setTimeout(r, 500));
      return res.status(401).json({ error: { message: 'Incorrect password' } });
    }

    const token = signToken({
      slug:       page.slug,
      mode:       page.mode,
      menu_id:    page.menu_id,
      country_id: page.country_id,
      exp:        Date.now() + TOKEN_TTL_MS,
    });

    res.json({ token, mode: page.mode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

// POST /api/public/share/:slug/price — save a sell price (edit mode only, requires Bearer token)
publicRouter.post('/:slug/price', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const rawToken   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload    = verifyToken(rawToken);

  if (!payload || payload.slug !== req.params.slug) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
  if (payload.mode !== 'edit') {
    return res.status(403).json({ error: { message: 'This link is view-only' } });
  }

  const { menu_item_id, price_level_id, sell_price } = req.body;
  if (!menu_item_id || !price_level_id || sell_price === undefined) {
    return res.status(400).json({ error: { message: 'menu_item_id, price_level_id, and sell_price are required' } });
  }

  try {
    // Verify the menu item belongs to the locked menu (if applicable)
    if (payload.menu_id) {
      const { rows: [mi] } = await pool.query(
        `SELECT id FROM mcogs_menu_items WHERE id = $1 AND menu_id = $2`,
        [menu_item_id, payload.menu_id]
      );
      if (!mi) return res.status(403).json({ error: { message: 'Menu item not on this menu' } });
    }

    await pool.query(`
      INSERT INTO mcogs_menu_item_prices (menu_item_id, price_level_id, sell_price)
      VALUES ($1, $2, $3)
      ON CONFLICT (menu_item_id, price_level_id)
      DO UPDATE SET sell_price = EXCLUDED.sell_price, updated_at = NOW()
    `, [menu_item_id, price_level_id, Math.round(sell_price * 10000) / 10000]);

    res.json({ saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save price' } });
  }
});

// GET /api/public/share/:slug/data — full COGS data (requires Bearer token)
publicRouter.get('/:slug/data', async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const rawToken   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload    = verifyToken(rawToken);

  if (!payload || payload.slug !== req.params.slug) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }

  const { menu_id: tokenMenuId, country_id: tokenCountryId } = payload;
  const queryMenuId    = req.query.menu_id    ? Number(req.query.menu_id)    : tokenMenuId;
  const queryCountryId = req.query.country_id ? Number(req.query.country_id) : tokenCountryId;

  // If the page has a locked menu/country, enforce it
  if (tokenMenuId    && queryMenuId    !== tokenMenuId)    return res.status(403).json({ error: { message: 'Menu locked' } });
  if (tokenCountryId && queryCountryId !== tokenCountryId) return res.status(403).json({ error: { message: 'Market locked' } });

  try {
    // --- Resolve what to show ---
    // Need either menu_id (show single menu) OR country_id (show all menus in market)
    // For the shared page we require menu_id
    if (!queryMenuId) {
      return res.status(400).json({ error: { message: 'menu_id is required' } });
    }

    const { rows: [menu] } = await pool.query(`
      SELECT m.*, c.currency_symbol, c.currency_code, c.exchange_rate, c.name AS country_name
      FROM   mcogs_menus m
      JOIN   mcogs_countries c ON c.id = m.country_id
      WHERE  m.id = $1
    `, [queryMenuId]);
    if (!menu) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId = menu.country_id;

    // All items on this menu
    const { rows: items } = await pool.query(`
      SELECT mi.*,
             r.name         AS recipe_name,
             r.category     AS recipe_category,
             r.yield_qty,
             ing.name       AS ingredient_name,
             u.abbreviation AS base_unit_abbr
      FROM   mcogs_menu_items mi
      LEFT JOIN mcogs_recipes     r   ON r.id   = mi.recipe_id
      LEFT JOIN mcogs_ingredients ing ON ing.id = mi.ingredient_id
      LEFT JOIN mcogs_units       u   ON u.id   = ing.base_unit_id
      WHERE  mi.menu_id = $1
      ORDER BY mi.id ASC
    `, [queryMenuId]);

    if (!items.length) {
      return res.json({
        menu: { id: menu.id, name: menu.name, currency_code: menu.currency_code,
                currency_symbol: menu.currency_symbol, exchange_rate: Number(menu.exchange_rate),
                country_id: countryId, country_name: menu.country_name },
        price_levels: [],
        items: [],
        menus: [],
      });
    }

    // Get all price levels
    const { rows: levels } = await pool.query(
      `SELECT * FROM mcogs_price_levels ORDER BY name`
    );

    // All level prices for these items
    const itemIds = items.map(i => i.id);
    const { rows: lpRows } = await pool.query(`
      SELECT * FROM mcogs_menu_item_prices WHERE menu_item_id = ANY($1::int[])
    `, [itemIds]);
    const lpMap = {};
    for (const lp of lpRows) {
      if (!lpMap[lp.menu_item_id]) lpMap[lp.menu_item_id] = {};
      lpMap[lp.menu_item_id][lp.price_level_id] = lp;
    }

    // Recipe items deep
    const recipeIds = [...new Set(items.filter(i => i.recipe_id).map(i => Number(i.recipe_id)))];
    const recipeItemsMap = await loadAllRecipeItemsDeep(recipeIds);
    const variationMap   = await loadVariationItemsMap(recipeIds);

    // Tax data
    const [quoteLookup, { rows: defaultTaxRows }, { rows: cltRows }, { rows: taxRateRows }] = await Promise.all([
      loadQuoteLookup(),
      pool.query(`SELECT country_id, rate, name FROM mcogs_country_tax_rates WHERE is_default = true`),
      pool.query(`
        SELECT clt.country_id, clt.price_level_id, tr.rate, tr.name
        FROM   mcogs_country_level_tax clt
        JOIN   mcogs_country_tax_rates tr ON tr.id = clt.tax_rate_id
      `),
      pool.query(`SELECT id, rate, name FROM mcogs_country_tax_rates`),
    ]);

    const defaultTaxMap = {};
    for (const r of defaultTaxRows) defaultTaxMap[r.country_id] = { rate: Number(r.rate), name: r.name };
    const cltMap = {};
    for (const r of cltRows) cltMap[`${r.country_id}-${r.price_level_id}`] = { rate: Number(r.rate), name: r.name };
    const taxById = {};
    for (const r of taxRateRows) taxById[r.id] = { rate: Number(r.rate), name: r.name };

    function getEffectiveTax(taxRateId, levelId) {
      if (taxRateId && taxById[taxRateId]) return taxById[taxRateId];
      const clt = cltMap[`${countryId}-${levelId}`];
      if (clt) return clt;
      return defaultTaxMap[countryId] || { rate: 0, name: 'No Tax' };
    }

    const outItems = items.map(item => {
      const itemType = item.item_type || 'recipe';
      const display  = item.display_name?.trim() ||
                       (itemType === 'ingredient' ? item.ingredient_name : item.recipe_name) || '—';
      const qty      = Number(item.qty || 1);

      let cpp = 0;
      if (itemType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) cpp = q.price_per_base_unit * qty;
      } else {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const { cost } = calcRecipeCost(
          { id: item.recipe_id, yield_qty: item.yield_qty || 1 },
          rItems, countryId, quoteLookup, variationMap, recipeItemsMap
        );
        cpp = cost * qty;
      }
      cpp = Math.round(cpp * Number(menu.exchange_rate) * 10000) / 10000;

      const rowLevels = {};
      for (const level of levels) {
        const lid = level.id;
        const lp  = lpMap[item.id]?.[lid];
        if (!lp) {
          rowLevels[lid] = { set: false, gross: null, net: null, cogs_pct: null, gp_net: null };
          continue;
        }
        const gross = Number(lp.sell_price);
        const { rate: taxRate } = getEffectiveTax(lp.tax_rate_id, lid);
        const net     = taxRate > 0 ? gross / (1 + taxRate) : gross;
        const cogsPct = net > 0 && cpp > 0 ? Math.round((cpp / net) * 10000) / 100 : null;
        rowLevels[lid] = {
          set:      true,
          gross:    Math.round(gross * 10000) / 10000,
          net:      Math.round(net   * 10000) / 10000,
          cogs_pct: cogsPct,
          gp_net:   Math.round((net - cpp) * 10000) / 10000,
          lp_id:    lp.id,
        };
      }

      return {
        menu_item_id: item.id,
        display_name: display,
        item_type:    itemType,
        category:     item.recipe_category || '',
        cost:         cpp,
        levels:       rowLevels,
      };
    });

    // Menus for the same market (if market is not locked the viewer can switch menus)
    const { rows: marketMenus } = await pool.query(`
      SELECT id, name FROM mcogs_menus WHERE country_id = $1 ORDER BY name
    `, [countryId]);

    res.json({
      menu: {
        id:              menu.id,
        name:            menu.name,
        currency_code:   menu.currency_code,
        currency_symbol: menu.currency_symbol,
        exchange_rate:   Number(menu.exchange_rate),
        country_id:      countryId,
        country_name:    menu.country_name,
      },
      price_levels: levels.map(l => ({ id: l.id, name: l.name })),
      items:        outItems,
      menus:        marketMenus,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load shared page data' } });
  }
});

module.exports = { router, publicRouter };
