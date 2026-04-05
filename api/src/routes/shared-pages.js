// =============================================================================
// Shared Menu Engineer Pages
// Management: GET/POST/PUT/DELETE /api/shared-pages   (authenticated)
// Public:     GET  /api/public/share/:slug            (meta)
//             POST /api/public/share/:slug/auth       (password → token)
//             GET  /api/public/share/:slug/data       (cogs data, Bearer)
//             POST /api/public/share/:slug/price      (save price, Bearer, edit mode)
//             GET  /api/public/share/:slug/breakdown/:menu_item_id  (ingredient cost modal)
// =============================================================================

const router    = require('express').Router();
const pool      = require('../db/pool');
const crypto    = require('crypto');

const {
  loadQuoteLookup,
  calcRecipeCost,
  loadAllRecipeItemsDeep,
  loadVariationItemsMap,
  loadPlVariationItemsMap,
  loadMarketPlVariationItemsMap,
  loadComboData,
  calcComboCost,
  resolveItemTax,
} = require('./cogs');

// ── Config ────────────────────────────────────────────────────────────────────

const HMAC_SECRET = process.env.SHARED_PAGE_SECRET || 'mcogs-shared-page-secret-change-me';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// ── Token helpers ─────────────────────────────────────────────────────────────

function signToken(payload) {
  const json = JSON.stringify(payload);
  const b64  = Buffer.from(json).toString('base64url');
  const sig  = crypto.createHmac('sha256', HMAC_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 1) return null;
  const b64 = token.slice(0, dotIdx);
  const sig  = token.slice(dotIdx + 1);
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

// ── Shared page loader ────────────────────────────────────────────────────────

async function fetchPage(slug) {
  const { rows: [page] } = await pool.query(`
    SELECT sp.*,
           m.name  AS menu_name,
           c.name  AS country_name,
           s.name  AS scenario_name,
           s.price_overrides AS scenario_price_overrides
    FROM   mcogs_shared_pages sp
    LEFT JOIN mcogs_menus            m ON m.id = sp.menu_id
    LEFT JOIN mcogs_countries        c ON c.id = sp.country_id
    LEFT JOIN mcogs_menu_scenarios   s ON s.id = sp.scenario_id
    WHERE  sp.slug = $1
  `, [slug]);
  return page || null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MANAGEMENT ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/shared-pages
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT sp.*,
             m.name  AS menu_name,
             c.name  AS country_name,
             c.currency_symbol,
             s.name  AS scenario_name
      FROM   mcogs_shared_pages sp
      LEFT JOIN mcogs_menus            m ON m.id = sp.menu_id
      LEFT JOIN mcogs_countries        c ON c.id = sp.country_id
      LEFT JOIN mcogs_menu_scenarios   s ON s.id = sp.scenario_id
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
  const { name, mode = 'view', password, menu_id, country_id, scenario_id, expires_at, notes } = req.body;
  if (!name)     return res.status(400).json({ error: { message: 'name is required' } });
  if (!password) return res.status(400).json({ error: { message: 'password is required' } });
  if (!['view', 'edit'].includes(mode)) return res.status(400).json({ error: { message: 'mode must be view or edit' } });

  try {
    const slug = crypto.randomBytes(8).toString('hex');
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);

    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_shared_pages
        (slug, name, mode, password_hash, password_salt, menu_id, country_id, scenario_id, expires_at, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [slug, name, mode, hash, salt,
        menu_id     || null,
        country_id  || null,
        scenario_id || null,
        expires_at  || null,
        notes       || null]);

    res.status(201).json({ ...row, url: `/share/${slug}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to create shared page' } });
  }
});

// PUT /api/shared-pages/:id
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, mode, password, menu_id, country_id, scenario_id, is_active, expires_at, notes } = req.body;

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
        scenario_id   = $7,
        is_active     = COALESCE($8, is_active),
        expires_at    = $9,
        notes         = $11,
        updated_at    = NOW()
      WHERE id = $10
      RETURNING *
    `, [
      name       ?? null,
      mode       ?? null,
      hash, salt,
      menu_id    !== undefined ? (menu_id    || null) : existing.menu_id,
      country_id !== undefined ? (country_id || null) : existing.country_id,
      scenario_id !== undefined ? (scenario_id || null) : existing.scenario_id,
      is_active  !== undefined ? is_active             : null,
      expires_at !== undefined ? (expires_at || null)  : existing.expires_at,
      id,
      notes      !== undefined ? (notes      || null)  : existing.notes,
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

// GET /api/shared-pages/:id/changes — management: view change log for a shared page
router.get('/:id/changes', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT * FROM mcogs_shared_page_changes
      WHERE shared_page_id = $1
      ORDER BY created_at DESC
      LIMIT 200
    `, [req.params.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch changes' } });
  }
});

// POST /api/shared-pages/:id/changes — add a comment from Menu Engineer (no Bearer required)
router.post('/:id/changes', async (req, res) => {
  const { comment, user_name, menu_item_id, display_name, parent_id } = req.body;
  if (!comment?.trim()) return res.status(400).json({ error: { message: 'comment is required' } });
  try {
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_shared_page_changes
        (shared_page_id, user_name, change_type, comment, menu_item_id, display_name, parent_id)
      VALUES ($1, $2, 'comment', $3, $4, $5, $6)
      RETURNING *
    `, [
      req.params.id,
      user_name?.trim() || 'Admin',
      comment.trim(),
      menu_item_id ? Number(menu_item_id) : null,
      display_name ? String(display_name).slice(0, 200) : null,
      parent_id    ? Number(parent_id)    : null,
    ]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add comment' } });
  }
});

// DELETE /api/shared-pages/:id/changes/comments — clear all comments for a shared page
router.delete('/:id/changes/comments', async (req, res) => {
  try {
    await pool.query(`
      DELETE FROM mcogs_shared_page_changes
      WHERE shared_page_id = $1 AND change_type = 'comment'
    `, [req.params.id]);
    res.json({ cleared: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to clear comments' } });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PUBLIC ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

const publicRouter = require('express').Router();

// ── Middleware: validate Bearer token for protected public routes ──────────────

function requirePublicToken(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const rawToken   = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const payload    = verifyToken(rawToken);
  if (!payload || payload.slug !== req.params.slug) {
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
  req.tokenPayload = payload;
  next();
}

// ── GET /api/public/share/:slug — meta ────────────────────────────────────────

publicRouter.get('/:slug', async (req, res) => {
  try {
    const page = await fetchPage(req.params.slug);
    if (!page)           return res.status(404).json({ error: { message: 'Page not found' } });
    if (!page.is_active) return res.status(403).json({ error: { message: 'This link is disabled' } });
    if (page.expires_at && new Date(page.expires_at) < new Date()) {
      return res.status(403).json({ error: { message: 'This link has expired' } });
    }
    res.json({
      name:          page.name,
      mode:          page.mode,
      notes:         page.notes || null,
      menu_locked:   !!page.menu_id,
      menu_id:       page.menu_id,
      menu_name:     page.menu_name,
      market_locked: !!page.country_id,
      country_id:    page.country_id,
      country_name:  page.country_name,
      scenario_id:   page.scenario_id,
      scenario_name: page.scenario_name,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

// ── POST /api/public/share/:slug/auth — password → token ─────────────────────

publicRouter.post('/:slug/auth', async (req, res) => {
  const { password, user_name } = req.body;
  if (!password)   return res.status(400).json({ error: { message: 'password is required' } });
  if (!user_name || !user_name.trim()) return res.status(400).json({ error: { message: 'Your name is required' } });

  try {
    const page = await fetchPage(req.params.slug);
    if (!page)           return res.status(404).json({ error: { message: 'Page not found' } });
    if (!page.is_active) return res.status(403).json({ error: { message: 'This link is disabled' } });
    if (page.expires_at && new Date(page.expires_at) < new Date()) {
      return res.status(403).json({ error: { message: 'This link has expired' } });
    }

    const ok = await verifyPassword(password, page.password_hash, page.password_salt);
    if (!ok) {
      await new Promise(r => setTimeout(r, 500));
      return res.status(401).json({ error: { message: 'Incorrect password' } });
    }

    const token = signToken({
      slug:        page.slug,
      mode:        page.mode,
      menu_id:     page.menu_id,
      country_id:  page.country_id,
      scenario_id: page.scenario_id,
      user_name:   user_name.trim(),
      exp:         Date.now() + TOKEN_TTL_MS,
    });

    res.json({ token, mode: page.mode, user_name: user_name.trim() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Server error' } });
  }
});

// ── POST /api/public/share/:slug/price — save sell price (edit mode) ──────────

publicRouter.post('/:slug/price', requirePublicToken, async (req, res) => {
  const { menu_id: tokenMenuId } = req.tokenPayload;

  const { menu_item_id, price_level_id, sell_price } = req.body;
  if (!menu_item_id || !price_level_id || sell_price === undefined) {
    return res.status(400).json({ error: { message: 'menu_item_id, price_level_id, and sell_price are required' } });
  }

  try {
    // Re-read mode from DB — token may have been issued before an admin changed the mode
    const page = await fetchPage(req.params.slug);
    if (!page || !page.is_active) return res.status(403).json({ error: { message: 'Page not found or disabled' } });
    if (page.mode !== 'edit') return res.status(403).json({ error: { message: 'This link is view-only' } });

    if (tokenMenuId) {
      const { rows: [mi] } = await pool.query(
        `SELECT id FROM mcogs_menu_sales_items WHERE id = $1 AND menu_id = $2`,
        [menu_item_id, tokenMenuId]
      );
      if (!mi) return res.status(403).json({ error: { message: 'Menu item not on this menu' } });
    }

    // Fetch old price for change log
    const { rows: [oldRow] } = await pool.query(
      `SELECT sell_price FROM mcogs_menu_sales_item_prices WHERE menu_sales_item_id = $1 AND price_level_id = $2`,
      [menu_item_id, price_level_id]
    );
    const oldValue = oldRow ? Number(oldRow.sell_price) : null;

    await pool.query(`
      INSERT INTO mcogs_menu_sales_item_prices (menu_sales_item_id, price_level_id, sell_price)
      VALUES ($1, $2, $3)
      ON CONFLICT (menu_sales_item_id, price_level_id)
      DO UPDATE SET sell_price = EXCLUDED.sell_price
    `, [menu_item_id, price_level_id, Math.round(sell_price * 10000) / 10000]);

    // Log the change
    const { rows: [miRow] } = await pool.query(`
      SELECT si.name AS display_name, pl.name AS level_name
      FROM   mcogs_menu_sales_items msi
      JOIN   mcogs_sales_items si ON si.id = msi.sales_item_id
      JOIN   mcogs_price_levels pl ON pl.id = $2
      WHERE  msi.id = $1
    `, [menu_item_id, price_level_id]);

    await pool.query(`
      INSERT INTO mcogs_shared_page_changes
        (shared_page_id, user_name, change_type, menu_item_id, price_level_id, display_name, level_name, old_value, new_value)
      VALUES ($1,$2,'price',$3,$4,$5,$6,$7,$8)
    `, [
      page.id,
      req.tokenPayload.user_name || 'Anonymous',
      menu_item_id,
      price_level_id,
      miRow?.display_name || null,
      miRow?.level_name   || null,
      oldValue,
      Math.round(sell_price * 10000) / 10000,
    ]);

    res.json({ saved: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to save price' } });
  }
});

// GET /api/public/share/:slug/changes — return change log (Bearer required)
publicRouter.get('/:slug/changes', requirePublicToken, async (req, res) => {
  try {
    const page = await fetchPage(req.params.slug);
    if (!page) return res.status(404).json({ error: { message: 'Not found' } });
    const { rows } = await pool.query(`
      SELECT * FROM mcogs_shared_page_changes
      WHERE shared_page_id = $1
      ORDER BY created_at DESC
      LIMIT 200
    `, [page.id]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch changes' } });
  }
});

// POST /api/public/share/:slug/comment — add a manual comment (Bearer required)
// Accepts optional menu_item_id and display_name to link comment to a specific item
publicRouter.post('/:slug/comment', requirePublicToken, async (req, res) => {
  const { comment, menu_item_id, display_name, parent_id } = req.body;
  if (!comment || !comment.trim()) return res.status(400).json({ error: { message: 'comment is required' } });
  try {
    const page = await fetchPage(req.params.slug);
    if (!page) return res.status(404).json({ error: { message: 'Not found' } });
    const { rows: [row] } = await pool.query(`
      INSERT INTO mcogs_shared_page_changes
        (shared_page_id, user_name, change_type, comment, menu_item_id, display_name, parent_id)
      VALUES ($1, $2, 'comment', $3, $4, $5, $6)
      RETURNING *
    `, [page.id, req.tokenPayload.user_name || 'Anonymous', comment.trim(),
        menu_item_id ? Number(menu_item_id) : null,
        display_name ? String(display_name).slice(0, 200) : null,
        parent_id    ? Number(parent_id)    : null]);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to add comment' } });
  }
});

// ── GET /api/public/share/:slug/breakdown/:menu_item_id ──────────────────────
// Returns per-ingredient cost breakdown for a recipe item. Used for hover modal.

publicRouter.get('/:slug/breakdown/:menu_item_id', requirePublicToken, async (req, res) => {
  const menuItemId = Number(req.params.menu_item_id);

  try {
    // Load menu sales item
    const { rows: [mi] } = await pool.query(`
      SELECT msi.id, si.item_type, si.recipe_id, si.ingredient_id, si.combo_id, msi.qty,
             si.name AS display_name,
             m.country_id, c.exchange_rate,
             r.name  AS recipe_name,  r.yield_qty,
             ing.name AS ingredient_name, ing.waste_pct,
             u.abbreviation AS base_unit_abbr
      FROM   mcogs_menu_sales_items msi
      JOIN   mcogs_sales_items       si  ON si.id   = msi.sales_item_id
      JOIN   mcogs_menus             m   ON m.id    = msi.menu_id
      JOIN   mcogs_countries         c   ON c.id    = m.country_id
      LEFT JOIN mcogs_recipes        r   ON r.id    = si.recipe_id
      LEFT JOIN mcogs_ingredients    ing ON ing.id  = si.ingredient_id
      LEFT JOIN mcogs_units          u   ON u.id    = ing.base_unit_id
      WHERE  msi.id = $1
    `, [menuItemId]);

    if (!mi) return res.status(404).json({ error: { message: 'Menu item not found' } });

    const countryId    = mi.country_id;
    const exchangeRate = Number(mi.exchange_rate) || 1;
    const qty          = Number(mi.qty || 1);

    // Single ingredient item — return trivial breakdown
    if (mi.item_type === 'ingredient') {
      const quoteLookup = await loadQuoteLookup();
      const q = quoteLookup[mi.ingredient_id]?.[countryId];
      const costUsd = q ? q.price_per_base_unit * qty : 0;
      return res.json({
        display_name: mi.display_name || mi.ingredient_name || '—',
        item_type:    'ingredient',
        lines: [{
          name:    mi.ingredient_name || '—',
          qty,
          unit:    mi.base_unit_abbr || '',
          waste_pct: Number(mi.waste_pct || 0),
          cost_local: Math.round(costUsd * exchangeRate * 10000) / 10000,
          is_sub_recipe: false,
        }],
        total_local: Math.round(costUsd * exchangeRate * 10000) / 10000,
      });
    }

    // Combo item — load steps/options and build per-step breakdown
    if (mi.item_type === 'combo') {
      const comboId = Number(mi.combo_id);
      if (!comboId) return res.json({ display_name: mi.display_name, item_type: 'combo', combo_steps: [], total_local: 0 });

      const qty          = Number(mi.qty || 1);
      const exchangeRate = Number(mi.exchange_rate) || 1;

      const comboData = await loadComboData([comboId]);
      const steps     = comboData[comboId] || [];

      // Collect recipe / ingredient IDs from all options for bulk loading
      const recipeIdsFromOpts = [];
      const ingIdsFromOpts    = [];
      for (const step of steps) {
        for (const opt of step.options || []) {
          if (opt.item_type === 'recipe'     && opt.recipe_id)     recipeIdsFromOpts.push(Number(opt.recipe_id));
          if (opt.item_type === 'ingredient' && opt.ingredient_id) ingIdsFromOpts.push(Number(opt.ingredient_id));
        }
      }
      const uniqueRecipeIds = [...new Set(recipeIdsFromOpts)];
      const uniqueIngIds    = [...new Set(ingIdsFromOpts)];

      const quoteLookup = await loadQuoteLookup();
      const [recipeItemsMap, variationMap, ingRows, subRecipeRows] = await Promise.all([
        uniqueRecipeIds.length ? loadAllRecipeItemsDeep(uniqueRecipeIds) : Promise.resolve({}),
        uniqueRecipeIds.length ? loadVariationItemsMap(uniqueRecipeIds) : Promise.resolve({}),
        uniqueIngIds.length
          ? pool.query(`SELECT i.id, i.name, u.abbreviation AS unit_abbr FROM mcogs_ingredients i LEFT JOIN mcogs_units u ON u.id = i.base_unit_id WHERE i.id = ANY($1::int[])`, [uniqueIngIds])
              .then(r => Object.fromEntries(r.rows.map(x => [x.id, x])))
          : Promise.resolve({}),
        uniqueRecipeIds.length
          ? pool.query(`SELECT id, name FROM mcogs_recipes WHERE id = ANY($1::int[])`, [uniqueRecipeIds])
              .then(r => Object.fromEntries(r.rows.map(x => [x.id, x.name])))
          : Promise.resolve({}),
      ]);

      // Collect recipe ingredient IDs for name lookup
      const recipeIngIds = [];
      for (const rid of uniqueRecipeIds) {
        for (const ri of (recipeItemsMap[rid] || [])) {
          if (ri.ingredient_id) recipeIngIds.push(Number(ri.ingredient_id));
        }
      }
      const uniqueRecipeIngIds = [...new Set(recipeIngIds)];
      const recipeIngNames = uniqueRecipeIngIds.length
        ? await pool.query(`SELECT id, name FROM mcogs_ingredients WHERE id = ANY($1::int[])`, [uniqueRecipeIngIds])
            .then(r => Object.fromEntries(r.rows.map(x => [x.id, x.name])))
        : {};

      const comboSteps = [];
      for (const step of steps) {
        const opts = step.options || [];
        const optResults = [];

        for (const opt of opts) {
          const optQty = Number(opt.qty || 1);
          let optCostUsd = 0;
          const lines = [];

          if (opt.item_type === 'manual') {
            optCostUsd = Number(opt.manual_cost || 0) * optQty;
          } else if (opt.item_type === 'ingredient' && opt.ingredient_id) {
            const q = quoteLookup[opt.ingredient_id]?.[countryId];
            optCostUsd = q ? q.price_per_base_unit * optQty : 0;
            const ing = ingRows[opt.ingredient_id];
            lines.push({
              name: ing?.name || opt.name || `Ingredient #${opt.ingredient_id}`,
              qty: optQty, unit: ing?.unit_abbr || '',
              waste_pct: 0,
              cost_local: Math.round(optCostUsd * exchangeRate * 10000) / 10000,
              is_sub_recipe: false,
            });
          } else if (opt.item_type === 'recipe' && opt.recipe_id) {
            const rItems   = recipeItemsMap[opt.recipe_id] || [];
            const yieldQty = Math.max(1, Number(opt.recipe_yield_qty || 1));
            const { cost } = calcRecipeCost(
              { id: opt.recipe_id, yield_qty: yieldQty },
              rItems, countryId, quoteLookup, variationMap, recipeItemsMap
            );
            optCostUsd = cost * optQty;

            // Ingredient lines for this recipe option
            const effectiveItems = variationMap?.[opt.recipe_id]?.[countryId] || rItems;
            for (const ri of effectiveItems) {
              if (ri.item_type === 'ingredient') {
                const q       = quoteLookup[ri.ingredient_id]?.[countryId];
                const baseQty = Number(ri.prep_qty) * Number(ri.prep_to_base_conversion || 1);
                const waste   = 1 + (Number(ri.waste_pct ?? 0) / 100);
                const cUsd    = q ? baseQty * waste * q.price_per_base_unit : 0;
                lines.push({
                  name:          recipeIngNames[ri.ingredient_id] || `Ingredient #${ri.ingredient_id}`,
                  qty:           Number(ri.prep_qty),
                  unit:          ri.prep_unit || '',
                  waste_pct:     Number(ri.waste_pct || 0),
                  cost_local:    Math.round((cUsd / yieldQty) * optQty * exchangeRate * 10000) / 10000,
                  is_sub_recipe: false,
                });
              } else if (ri.item_type === 'recipe' && ri.recipe_item_id) {
                const subId    = Number(ri.recipe_item_id);
                const subItems = recipeItemsMap[subId] || [];
                const subYield = Number(ri.sub_recipe_yield_qty || 1);
                const usage    = Number(ri.prep_qty) * Number(ri.prep_to_base_conversion || 1);
                const { cost: subCost } = calcRecipeCost(
                  { id: subId, yield_qty: subYield },
                  subItems, countryId, quoteLookup, variationMap, recipeItemsMap
                );
                lines.push({
                  name:          subRecipeRows[subId] || `Sub-recipe #${subId}`,
                  qty:           Number(ri.prep_qty),
                  unit:          ri.prep_unit || '',
                  waste_pct:     0,
                  cost_local:    Math.round((subCost * usage / yieldQty) * optQty * exchangeRate * 10000) / 10000,
                  is_sub_recipe: true,
                });
              }
            }
          }

          optResults.push({
            option_name:      opt.name,
            item_type:        opt.item_type,
            option_cost_local: Math.round(optCostUsd * exchangeRate * 10000) / 10000,
            lines,
          });
        }

        // Step cost = average of all option costs
        const stepCostLocal = opts.length > 0
          ? optResults.reduce((s, o) => s + o.option_cost_local, 0) / opts.length
          : 0;

        comboSteps.push({
          step_name:       step.name,
          step_cost_local: Math.round(stepCostLocal * 10000) / 10000,
          options:         optResults,
        });
      }

      const totalLocal = Math.round(comboSteps.reduce((s, st) => s + st.step_cost_local, 0) * qty * 10000) / 10000;
      return res.json({
        display_name: mi.display_name || '—',
        item_type:    'combo',
        cost_note:    'Each step cost = average cost across its options · Total = sum of all step costs',
        combo_steps:  comboSteps,
        total_local:  totalLocal,
      });
    }

    // Recipe item — load all ingredients (deep)
    const recipeId = mi.recipe_id;
    const recipeItemsMap = await loadAllRecipeItemsDeep([recipeId]);
    const variationMap   = await loadVariationItemsMap([recipeId]);
    const quoteLookup    = await loadQuoteLookup();

    // Get ingredient names for all items in this recipe (top level only)
    const topItems = recipeItemsMap[recipeId] || [];
    const ingIds   = [...new Set(topItems.filter(i => i.ingredient_id).map(i => Number(i.ingredient_id)))];
    const subIds   = [...new Set(topItems.filter(i => i.recipe_item_id).map(i => Number(i.recipe_item_id)))];

    const [ingNames, subNames] = await Promise.all([
      ingIds.length
        ? pool.query(`SELECT id, name FROM mcogs_ingredients WHERE id = ANY($1::int[])`, [ingIds])
            .then(r => Object.fromEntries(r.rows.map(x => [x.id, x.name])))
        : Promise.resolve({}),
      subIds.length
        ? pool.query(`SELECT id, name FROM mcogs_recipes WHERE id = ANY($1::int[])`, [subIds])
            .then(r => Object.fromEntries(r.rows.map(x => [x.id, x.name])))
        : Promise.resolve({}),
    ]);

    // Use the variation items for this country if available
    const items = variationMap?.[recipeId]?.[countryId] || topItems;
    const yieldQty = Math.max(1, Number(mi.yield_qty || 1));

    const lines = [];
    for (const item of items) {
      if (item.item_type === 'ingredient') {
        const q       = quoteLookup[item.ingredient_id]?.[countryId];
        const baseQty = Number(item.prep_qty) * Number(item.prep_to_base_conversion || 1);
        const waste   = 1 + (Number(item.waste_pct ?? 0) / 100);
        const costUsd = q ? baseQty * waste * q.price_per_base_unit : 0;
        lines.push({
          name:          ingNames[item.ingredient_id] || `Ingredient #${item.ingredient_id}`,
          qty:           Number(item.prep_qty),
          unit:          item.prep_unit || '',
          waste_pct:     Number(item.waste_pct || 0),
          cost_local:    Math.round((costUsd / yieldQty) * qty * exchangeRate * 10000) / 10000,
          is_sub_recipe: false,
        });
      } else if (item.item_type === 'recipe' && item.recipe_item_id) {
        const subId    = Number(item.recipe_item_id);
        const subItems = recipeItemsMap[subId] || [];
        const subYield = Number(item.sub_recipe_yield_qty || 1);
        const usage    = Number(item.prep_qty) * Number(item.prep_to_base_conversion || 1);
        const { cost: subCostPerPortion } = calcRecipeCost(
          { id: subId, yield_qty: subYield },
          subItems, countryId, quoteLookup, variationMap, recipeItemsMap
        );
        const costUsd = subCostPerPortion * usage;
        lines.push({
          name:          subNames[subId] || `Sub-recipe #${subId}`,
          qty:           Number(item.prep_qty),
          unit:          item.prep_unit || '',
          waste_pct:     0,
          cost_local:    Math.round((costUsd / yieldQty) * qty * exchangeRate * 10000) / 10000,
          is_sub_recipe: true,
        });
      }
    }

    const totalLocal = lines.reduce((s, l) => s + l.cost_local, 0);

    res.json({
      display_name: mi.display_name || mi.recipe_name || '—',
      item_type:    'recipe',
      recipe_name:  mi.recipe_name || '—',
      yield_qty:    yieldQty,
      lines,
      total_local:  Math.round(totalLocal * 10000) / 10000,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load ingredient breakdown' } });
  }
});

// ── GET /api/public/share/:slug/data — full COGS data ────────────────────────

publicRouter.get('/:slug/data', requirePublicToken, async (req, res) => {
  const payload = req.tokenPayload;
  const { menu_id: tokenMenuId, country_id: tokenCountryId, scenario_id: tokenScenarioId } = payload;
  const queryMenuId    = req.query.menu_id    ? Number(req.query.menu_id)    : tokenMenuId;
  const queryCountryId = req.query.country_id ? Number(req.query.country_id) : tokenCountryId;

  if (tokenMenuId    && queryMenuId    !== tokenMenuId)    return res.status(403).json({ error: { message: 'Menu locked' } });
  if (tokenCountryId && queryCountryId !== tokenCountryId) return res.status(403).json({ error: { message: 'Market locked' } });
  if (!queryMenuId) return res.status(400).json({ error: { message: 'menu_id is required' } });

  try {
    const { rows: [menu] } = await pool.query(`
      SELECT m.*, c.currency_symbol, c.currency_code, c.exchange_rate, c.name AS country_name
      FROM   mcogs_menus m
      JOIN   mcogs_countries c ON c.id = m.country_id
      WHERE  m.id = $1
    `, [queryMenuId]);
    if (!menu) return res.status(404).json({ error: { message: 'Menu not found' } });

    const countryId    = menu.country_id;
    const exchangeRate = Number(menu.exchange_rate) || 1;

    // Load scenario data (price overrides + qty_data for summary tiles)
    let scenarioPriceOv      = {};
    let scenarioQtyData      = {};
    let scenarioPriceLevelId = null;
    let scenarioName         = null;
    const scenarioId         = tokenScenarioId || null;
    if (scenarioId) {
      const { rows: [sc] } = await pool.query(
        `SELECT name, price_overrides, qty_data, price_level_id FROM mcogs_menu_scenarios WHERE id = $1`,
        [scenarioId]
      );
      if (sc) {
        scenarioPriceOv      = sc.price_overrides  || {};
        scenarioQtyData      = sc.qty_data          || {};
        scenarioPriceLevelId = sc.price_level_id    || null;
        scenarioName         = sc.name;
      }
    }

    // All items on this menu (via sales items)
    const { rows: items } = await pool.query(`
      SELECT msi.*,
             si.name        AS sales_item_name,
             si.item_type,
             si.recipe_id,
             si.ingredient_id,
             si.manual_cost,
             si.combo_id,
             CASE WHEN si.item_type = 'combo'
                  THEN COALESCE(combo_cat.name, cat.name)
                  ELSE cat.name
             END            AS category,
             r.yield_qty,
             r.name         AS recipe_name,
             ing.name       AS ingredient_name,
             u.abbreviation AS base_unit_abbr
      FROM   mcogs_menu_sales_items msi
      JOIN   mcogs_sales_items       si        ON si.id        = msi.sales_item_id
      LEFT JOIN mcogs_categories     cat       ON cat.id       = si.category_id
      LEFT JOIN mcogs_combos         co        ON co.id        = si.combo_id
      LEFT JOIN mcogs_categories     combo_cat ON combo_cat.id = co.category_id
      LEFT JOIN mcogs_recipes        r         ON r.id         = si.recipe_id
      LEFT JOIN mcogs_ingredients    ing       ON ing.id       = si.ingredient_id
      LEFT JOIN mcogs_units          u         ON u.id         = ing.base_unit_id
      WHERE  msi.menu_id = $1
      ORDER BY msi.sort_order, msi.id
    `, [queryMenuId]);

    if (!items.length) {
      return res.json({
        menu: { id: menu.id, name: menu.name, currency_code: menu.currency_code,
                currency_symbol: menu.currency_symbol, exchange_rate: exchangeRate,
                country_id: countryId, country_name: menu.country_name },
        price_levels: [], items: [], menus: [],
        scenario: scenarioName ? { id: scenarioId, name: scenarioName } : null,
      });
    }

    const { rows: levels } = await pool.query(`SELECT * FROM mcogs_price_levels ORDER BY name`);

    // All level prices in one query (from menu-sales-item prices table)
    const msiIds = items.map(i => i.id);
    const { rows: lpRows } = await pool.query(`
      SELECT * FROM mcogs_menu_sales_item_prices WHERE menu_sales_item_id = ANY($1::int[])
    `, [msiIds]);
    const lpMap = {};
    for (const lp of lpRows) {
      if (!lpMap[lp.menu_sales_item_id]) lpMap[lp.menu_sales_item_id] = {};
      lpMap[lp.menu_sales_item_id][lp.price_level_id] = lp;
    }

    // Collect recipe IDs (direct + from combo steps)
    const recipeIds = [...new Set(items.filter(i => i.item_type === 'recipe' && i.recipe_id).map(i => Number(i.recipe_id)))];
    const comboIds  = [...new Set(items.filter(i => i.item_type === 'combo' && i.combo_id).map(i => Number(i.combo_id)))];

    const [quoteLookup, { rows: defaultTaxRows }, comboData] = await Promise.all([
      loadQuoteLookup(),
      pool.query(`SELECT country_id, rate, name FROM mcogs_country_tax_rates WHERE is_default = true`),
      loadComboData(comboIds),
    ]);

    // Add recipe IDs from combo step options
    for (const steps of Object.values(comboData)) {
      for (const step of steps) {
        for (const opt of step.options || []) {
          if (opt.item_type === 'recipe' && opt.recipe_id) recipeIds.push(Number(opt.recipe_id));
          for (const mo of opt.mod_options || []) {
            if (mo.item_type === 'recipe' && mo.recipe_id) recipeIds.push(Number(mo.recipe_id));
          }
        }
      }
    }
    const uniqueRecipeIds = [...new Set(recipeIds)];

    const [recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap] = await Promise.all([
      loadAllRecipeItemsDeep(uniqueRecipeIds),
      loadVariationItemsMap(uniqueRecipeIds),
      loadPlVariationItemsMap(uniqueRecipeIds),
      loadMarketPlVariationItemsMap(uniqueRecipeIds),
    ]);

    const defaultTaxMap = {};
    for (const r of defaultTaxRows) defaultTaxMap[r.country_id] = { rate: Number(r.rate), name: r.name };

    const taxRateCache = {};

    function getCppForLevel(item, levelId) {
      const itemType = item.item_type;
      const qty      = Number(item.qty || 1);
      let cppUsd = 0;
      if (itemType === 'ingredient') {
        const q = quoteLookup[item.ingredient_id]?.[countryId];
        if (q) cppUsd = q.price_per_base_unit * qty;
      } else if (itemType === 'manual') {
        cppUsd = Number(item.manual_cost || 0) * qty;
      } else if (itemType === 'recipe') {
        const rItems = recipeItemsMap[item.recipe_id] || [];
        const recipe = { id: item.recipe_id, yield_qty: item.yield_qty || 1 };
        const { cost } = calcRecipeCost(recipe, rItems, countryId, quoteLookup, variationMap, recipeItemsMap, null, levelId, plVariationMap, marketPlVariationMap);
        cppUsd = cost * qty;
      } else if (itemType === 'combo') {
        const steps = comboData[Number(item.combo_id)] || [];
        cppUsd = calcComboCost(steps, countryId, quoteLookup, recipeItemsMap, variationMap, plVariationMap, marketPlVariationMap, levelId) * qty;
      }
      return Math.round(cppUsd * exchangeRate * 10000) / 10000;
    }

    const outItems = await Promise.all(items.map(async item => {
      const itemType = item.item_type || 'recipe';
      const display  = item.sales_item_name || '—';

      // Base cost (no price level)
      const cpp = getCppForLevel(item, null);

      const rowLevels = {};
      for (const level of levels) {
        const lid           = level.id;
        const ovKey         = `${item.id}_l${lid}`;
        const lp            = lpMap[item.id]?.[lid];
        const hasScenarioOv = ovKey in scenarioPriceOv;
        const gross         = hasScenarioOv
          ? Number(scenarioPriceOv[ovKey])
          : (lp ? Number(lp.sell_price) : null);

        if (gross === null) {
          rowLevels[lid] = { set: false, gross: null, net: null, cogs_pct: null, gp_net: null, is_scenario_override: false };
          continue;
        }

        const levelCpp = getCppForLevel(item, lid);
        const { rate: taxRate } = await resolveItemTax(lp?.tax_rate_id || null, countryId, lid, defaultTaxMap, taxRateCache);
        const net     = taxRate > 0 ? gross / (1 + taxRate) : gross;
        const cogsPct = net > 0 && levelCpp > 0 ? Math.round((levelCpp / net) * 10000) / 100 : null;
        rowLevels[lid] = {
          set:                  true,
          gross:                Math.round(gross    * 10000) / 10000,
          net:                  Math.round(net      * 10000) / 10000,
          cogs_pct:             cogsPct,
          gp_net:               Math.round((net - levelCpp) * 10000) / 10000,
          lp_id:                lp?.id ?? null,
          is_scenario_override: hasScenarioOv,
        };
      }

      return {
        menu_item_id: item.id,   // = menu_sales_item_id
        nat_key:      `si_${item.sales_item_id}`,
        display_name: display,
        item_type:    itemType,
        category:     item.category || '',
        cost:         cpp,
        levels:       rowLevels,
      };
    }));

    const { rows: marketMenus } = await pool.query(
      `SELECT id, name FROM mcogs_menus WHERE country_id = $1 ORDER BY name`, [countryId]
    );

    res.json({
      menu: {
        id:              menu.id,
        name:            menu.name,
        currency_code:   menu.currency_code,
        currency_symbol: menu.currency_symbol,
        exchange_rate:   exchangeRate,
        country_id:      countryId,
        country_name:    menu.country_name,
      },
      price_levels:             levels.map(l => ({ id: l.id, name: l.name })),
      items:                    outItems,
      menus:                    marketMenus,
      scenario:                 scenarioName ? { id: scenarioId, name: scenarioName } : null,
      scenario_qty_data:        scenarioQtyData,
      scenario_price_level_id:  scenarioPriceLevelId,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to load shared page data' } });
  }
});

module.exports = { router, publicRouter };
