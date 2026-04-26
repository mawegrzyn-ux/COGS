// =============================================================================
// RBAC Auth Middleware
// Uses Auth0 /userinfo to verify tokens and maps to local mcogs_users + roles
// =============================================================================

const crypto = require('crypto');
const https  = require('https');
const pool   = require('../db/pool');

const AUTH0_DOMAIN = process.env.VITE_AUTH0_DOMAIN || 'obscurekitty.uk.auth0.com';

// ── Internal service key ─────────────────────────────────────────────────────
// Generated once at startup. Used by tool executors that need to call loopback
// API endpoints (e.g. COGS calculation, scenario analysis) without a real JWT.
const INTERNAL_SERVICE_KEY = crypto.randomBytes(32).toString('hex');

// ── In-memory cache: token → { sub, email, name, picture, expiresAt } ────────
const tokenCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── Active language cache (small, 5-minute TTL) ──────────────────────────────
// Avoids querying mcogs_languages for every request. Cleared on language CRUD.
let activeLanguagesCache = null;
let activeLanguagesCacheExpires = 0;
const LANG_CACHE_TTL_MS = 5 * 60 * 1000;

async function getActiveLanguages() {
  if (activeLanguagesCache && Date.now() < activeLanguagesCacheExpires) return activeLanguagesCache;
  try {
    const { rows } = await pool.query(
      "SELECT code, is_default FROM mcogs_languages WHERE is_active = TRUE ORDER BY sort_order, code"
    );
    activeLanguagesCache = {
      codes: rows.map(r => r.code),
      defaultCode: (rows.find(r => r.is_default) || rows[0] || { code: 'en' }).code,
    };
    activeLanguagesCacheExpires = Date.now() + LANG_CACHE_TTL_MS;
  } catch {
    // Table may not exist yet (pre-migration) — degrade gracefully
    activeLanguagesCache = { codes: ['en'], defaultCode: 'en' };
    activeLanguagesCacheExpires = Date.now() + 10_000;
  }
  return activeLanguagesCache;
}

function invalidateLanguagesCache() {
  activeLanguagesCache = null;
  activeLanguagesCacheExpires = 0;
}

function getCached(token) {
  const entry = tokenCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { tokenCache.delete(token); return null; }
  return entry;
}

function setCache(token, data) {
  // Evict oldest entries if cache grows large
  if (tokenCache.size > 500) {
    const firstKey = tokenCache.keys().next().value;
    tokenCache.delete(firstKey);
  }
  tokenCache.set(token, { ...data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Call Auth0 /userinfo ──────────────────────────────────────────────────────
function fetchUserInfo(token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: AUTH0_DOMAIN,
      path:     '/userinfo',
      method:   'GET',
      headers:  { Authorization: `Bearer ${token}` },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Auth0 userinfo returned ${res.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('Invalid Auth0 userinfo response')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Load user from DB (or create pending on first login) ─────────────────────
async function loadOrCreateUser(userInfo) {
  const { sub, email, name, picture } = userInfo;

  // Check if this is the very first user ever (auto-bootstrap as admin)
  const { rows: [existing] } = await pool.query(
    'SELECT u.*, r.name AS role_name FROM mcogs_users u LEFT JOIN mcogs_roles r ON r.id = u.role_id WHERE u.auth0_sub = $1',
    [sub]
  );

  if (existing) {
    // Update last login + profile fields
    await pool.query(
      'UPDATE mcogs_users SET last_login_at = NOW(), email = $2, name = $3, picture = $4 WHERE id = $1',
      [existing.id, email || existing.email, name || existing.name, picture || existing.picture]
    );
    return existing;
  }

  // New user — check if first ever user
  const { rows: [{ count }] } = await pool.query('SELECT COUNT(*)::int AS count FROM mcogs_users');
  const isFirst = count === 0;

  // Get admin role id (or null)
  const { rows: [adminRole] } = await pool.query("SELECT id FROM mcogs_roles WHERE name = 'Admin' LIMIT 1");

  const newStatus  = isFirst ? 'active'  : 'pending';
  const newRoleId  = isFirst ? (adminRole?.id || null) : null;

  const { rows: [newUser] } = await pool.query(
    `INSERT INTO mcogs_users (auth0_sub, email, name, picture, role_id, status, last_login_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     RETURNING *`,
    [sub, email, name, picture, newRoleId, newStatus]
  );

  if (isFirst) {
    console.log(`[auth] First user bootstrap: ${email} → Admin`);
  }

  return { ...newUser, role_name: isFirst ? 'Admin' : null };
}

// ── Load user's full permissions ──────────────────────────────────────────────
async function loadPermissions(roleId) {
  if (!roleId) return {};
  const { rows } = await pool.query(
    'SELECT feature, access FROM mcogs_role_permissions WHERE role_id = $1',
    [roleId]
  );
  const perms = {};
  for (const row of rows) perms[row.feature] = row.access;
  return perms;
}

// ── Load user's scoped access — resolves per-market role + permissions ────────
//
// Returns: { allowedCountries, scopedAccess, unionPermissions }
//   allowedCountries  - number[] | null (null = unrestricted, no scope rows)
//   scopedAccess      - Map(country_id → { roleId, roleName, permissions })
//   unionPermissions  - { feature: 'none'|'read'|'write' } across all allowed
//                       markets. Used by requirePermission() for nav-level
//                       gating where market context isn't relevant.
//
// Resolution per country:
//   1. start with the user's default role from mcogs_users.role_id
//   2. apply BP grants for any BP that owns this country
//      (BP role override beats user default)
//   3. apply BP denies — remove the country if denied
//   4. apply country grants — adds country if not already, role override
//      beats BP role override
//   5. apply country denies — remove the country (final word)
async function loadScopedAccess(userId, defaultRoleId) {
  const { rows: scopeRows } = await pool.query(
    'SELECT scope_type, scope_id, access_mode, role_id FROM mcogs_user_scope WHERE user_id = $1',
    [userId]
  );

  // No scope rows → unrestricted (current admin default)
  if (scopeRows.length === 0) {
    const perms = await loadPermissions(defaultRoleId);
    return { allowedCountries: null, scopedAccess: {}, unionPermissions: perms };
  }

  // Pre-load every country's BP linkage in one query (cheap)
  const { rows: countriesAll } = await pool.query(
    'SELECT id, brand_partner_id FROM mcogs_countries WHERE brand_partner_id IS NOT NULL'
  );
  const bpToCountries = new Map();
  for (const c of countriesAll) {
    if (!bpToCountries.has(c.brand_partner_id)) bpToCountries.set(c.brand_partner_id, []);
    bpToCountries.get(c.brand_partner_id).push(c.id);
  }

  // Bucket scope rows
  const bpGrants     = new Map(); // bp_id → role_id|null
  const bpDenies     = new Set(); // bp_id
  const countryGrant = new Map(); // country_id → role_id|null
  const countryDeny  = new Set(); // country_id
  for (const r of scopeRows) {
    if (r.scope_type === 'brand_partner') {
      if (r.access_mode === 'grant') bpGrants.set(r.scope_id, r.role_id);
      else                            bpDenies.add(r.scope_id);
    } else if (r.scope_type === 'country') {
      if (r.access_mode === 'grant') countryGrant.set(r.scope_id, r.role_id);
      else                            countryDeny.add(r.scope_id);
    }
  }

  // Build country → effective role_id
  const effectiveRole = new Map();
  // 1. BP grants → contribute every country owned by the BP, with the BP's role override (or user default)
  for (const [bpId, roleId] of bpGrants) {
    if (bpDenies.has(bpId)) continue;
    const countries = bpToCountries.get(bpId) || [];
    for (const cid of countries) {
      effectiveRole.set(cid, roleId ?? defaultRoleId);
    }
  }
  // 2. Country grants override BP role
  for (const [cid, roleId] of countryGrant) {
    effectiveRole.set(cid, roleId ?? defaultRoleId);
  }
  // 3. Country denies remove the country entirely
  for (const cid of countryDeny) effectiveRole.delete(cid);

  // Resolve permissions per unique role
  const allowedCountries = Array.from(effectiveRole.keys());
  const uniqueRoleIds = [...new Set(Array.from(effectiveRole.values()).filter(Boolean))];
  const permsByRole = {};
  await Promise.all(uniqueRoleIds.map(async (rid) => {
    permsByRole[rid] = await loadPermissions(rid);
  }));
  if (defaultRoleId && !permsByRole[defaultRoleId]) {
    permsByRole[defaultRoleId] = await loadPermissions(defaultRoleId);
  }

  // Build per-country snapshot + role names
  const { rows: roleRows } = uniqueRoleIds.length
    ? await pool.query('SELECT id, name FROM mcogs_roles WHERE id = ANY($1::int[])', [uniqueRoleIds])
    : { rows: [] };
  const roleNameById = new Map(roleRows.map(r => [r.id, r.name]));

  const scopedAccess = {};
  for (const [cid, rid] of effectiveRole) {
    const perms = permsByRole[rid] || {};
    scopedAccess[cid] = {
      roleId:      rid || null,
      roleName:    rid ? (roleNameById.get(rid) || null) : null,
      permissions: perms,
    };
  }

  // Union permissions: take the strongest level (write > read > none) across
  // every market the user has access to. Sidebar / non-market routes use this.
  const unionPermissions = {};
  const rank = (lvl) => lvl === 'write' ? 2 : lvl === 'read' ? 1 : 0;
  for (const cid of Object.keys(scopedAccess)) {
    const perms = scopedAccess[cid].permissions || {};
    for (const [feat, lvl] of Object.entries(perms)) {
      if (rank(lvl) > rank(unionPermissions[feat] || 'none')) {
        unionPermissions[feat] = lvl;
      }
    }
  }

  return { allowedCountries, scopedAccess, unionPermissions };
}

// ── requireAuth middleware ────────────────────────────────────────────────────
// Attaches req.user = { id, sub, email, name, status, role_id, role_name,
//                       is_dev, permissions, allowedCountries }
async function requireAuth(req, res, next) {
  // Internal loopback calls (tool executor → COGS/scenarios endpoints)
  // bypass JWT validation using the process-scoped service key.
  if (req.headers['x-internal-service'] === INTERNAL_SERVICE_KEY) {
    req.user = {
      id:              0,
      sub:             'internal',
      email:           null,
      name:            'Internal Service',
      status:          'active',
      role_id:         null,
      role_name:       null,
      is_dev:          false,
      permissions:     { dashboard:'write', inventory:'write', recipes:'write', menus:'write',
                         allergens:'write', haccp:'write', markets:'write', categories:'write',
                         settings:'write', import:'write', ai_chat:'write', users:'write' },
      allowedCountries: null, // unrestricted — tool executor applies user scope itself
      scopedAccess:     {},
    };
    req.language = (req.headers['x-language'] || 'en').toString().toLowerCase();
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { message: 'Missing authorization header' } });
  }
  const token = authHeader.slice(7);

  try {
    // Check cache first
    let userInfo = getCached(token);
    let dbUser, permissions, allowedCountries;

    if (userInfo) {
      // Still need fresh DB data for status/role (but cache the userinfo)
      dbUser = await loadOrCreateUser(userInfo);
    } else {
      userInfo = await fetchUserInfo(token);
      setCache(token, userInfo);
      dbUser = await loadOrCreateUser(userInfo);
    }

    if (dbUser.status === 'pending') {
      return res.status(403).json({ error: { code: 'PENDING', message: 'Your account is pending approval by an administrator.' } });
    }
    if (dbUser.status === 'disabled') {
      return res.status(403).json({ error: { code: 'DISABLED', message: 'Your account has been disabled.' } });
    }

    const scoped = await loadScopedAccess(dbUser.id, dbUser.role_id);
    allowedCountries = scoped.allowedCountries;
    // Sidebar / non-market routes still expect req.user.permissions to be a
    // flat { feature: level } map. We use the union of every market the user
    // can access — so a user with read in any one market still sees the nav
    // entry. Per-market write enforcement is up to the route via
    // requirePermissionInMarket().
    permissions = allowedCountries === null
      ? await loadPermissions(dbUser.role_id) // unrestricted = single role
      : scoped.unionPermissions;

    req.user = {
      id:              dbUser.id,
      sub:             dbUser.auth0_sub,
      email:           dbUser.email,
      name:            dbUser.name,
      picture:         dbUser.picture,
      status:          dbUser.status,
      role_id:         dbUser.role_id,
      role_name:       dbUser.role_name,
      is_dev:          !!dbUser.is_dev,
      permissions,
      allowedCountries, // null = unrestricted, number[] = restricted
      scopedAccess:    scoped.scopedAccess, // { country_id: { roleId, roleName, permissions } }
    };

    // ── Resolve preferred language ──────────────────────────────────────────
    // Priority: X-Language header > user profile preferred_language > first
    // allowed country's default_language_code > system default > 'en'
    try {
      const langs = await getActiveLanguages();
      const headerLang = (req.headers['x-language'] || '').toString().toLowerCase();
      let resolved = null;

      if (headerLang && langs.codes.includes(headerLang)) resolved = headerLang;

      if (!resolved) {
        // user profile
        const { rows: [profile] } = await pool.query(
          'SELECT profile_json FROM mcogs_user_profiles WHERE user_sub = $1 LIMIT 1',
          [dbUser.auth0_sub]
        ).catch(() => ({ rows: [] }));
        const prefLang = profile?.profile_json?.preferred_language;
        if (prefLang && langs.codes.includes(prefLang)) resolved = prefLang;
      }

      if (!resolved && allowedCountries && allowedCountries.length) {
        const { rows: [countryRow] } = await pool.query(
          'SELECT default_language_code FROM mcogs_countries WHERE id = $1 LIMIT 1',
          [allowedCountries[0]]
        ).catch(() => ({ rows: [] }));
        const cLang = countryRow?.default_language_code;
        if (cLang && langs.codes.includes(cLang)) resolved = cLang;
      }

      req.language = resolved || langs.defaultCode || 'en';
    } catch {
      req.language = 'en';
    }

    next();
  } catch (err) {
    console.error('[auth] requireAuth error:', err.message);
    return res.status(401).json({ error: { message: 'Invalid or expired token' } });
  }
}

// ── requirePermission(feature, level) middleware factory ─────────────────────
// level: 'read' | 'write'
function requirePermission(feature, level) {
  return (req, res, next) => {
    const access = req.user?.permissions?.[feature] || 'none';
    const ok = level === 'read'
      ? (access === 'read' || access === 'write')
      : access === 'write';
    if (!ok) {
      return res.status(403).json({ error: { message: `Insufficient permission for ${feature}` } });
    }
    next();
  };
}

// ── applyMarketScope — injects allowed country IDs into req.marketScope ───────
// Routes that filter by country should use: req.marketScope (null = all)
function applyMarketScope(req, res, next) {
  req.marketScope = req.user?.allowedCountries || null;
  next();
}

// ── getMarketPermission — per-market permission lookup ────────────────────────
// Returns 'none' | 'read' | 'write' for the given (req, country_id, feature).
// When the user is unrestricted (allowedCountries === null) falls back to
// the user's default role permissions. When the user has scopedAccess and
// the country isn't covered, returns 'none'.
function getMarketPermission(req, countryId, feature) {
  const u = req.user;
  if (!u) return 'none';
  if (u.allowedCountries === null) return u.permissions?.[feature] || 'none';
  const cid = Number(countryId);
  if (!Number.isFinite(cid)) return 'none';
  const entry = u.scopedAccess?.[cid];
  return entry?.permissions?.[feature] || 'none';
}

// ── requirePermissionInMarket — enforce write/read in a specific market ───────
// Use for routes that mutate market-scoped data. `getCountryId` extracts the
// country_id from the request (params, query, or body). If the user has no
// market context for the call, the resolver may return null → 403.
//
// Usage:
//   router.put('/recipes/:id',
//     requirePermissionInMarket('recipes', 'write', req => req.body.country_id),
//     handler)
function requirePermissionInMarket(feature, level, getCountryId) {
  return (req, res, next) => {
    const cid = getCountryId(req);
    if (cid == null) return res.status(403).json({ error: { message: `Market context required for ${feature}` } });
    const access = getMarketPermission(req, cid, feature);
    const ok = level === 'read'
      ? (access === 'read' || access === 'write')
      : access === 'write';
    if (!ok) return res.status(403).json({ error: { message: `Insufficient permission for ${feature} in this market` } });
    next();
  };
}

module.exports = {
  requireAuth, requirePermission, requirePermissionInMarket,
  applyMarketScope, getMarketPermission,
  INTERNAL_SERVICE_KEY,
  getActiveLanguages, invalidateLanguagesCache,
};
