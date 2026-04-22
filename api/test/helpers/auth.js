// Test auth helpers.
//
// In production, requireAuth verifies an Auth0 access token via the /userinfo
// endpoint. In tests we use a different approach to avoid hitting Auth0:
//
// Option A — `mockAuthContext(req, user)`: injects a faked req.user object,
//            useful for unit-testing route handlers in isolation.
//
// Option B — `bypassAuthMiddleware(app, user)`: monkey-patches the auth
//            middleware on a test Express app so all subsequent requests
//            see `user` as the authenticated principal. Used for Supertest.
//
// Both helpers refuse to run when NODE_ENV !== 'test' so they cannot
// accidentally leak into production.

function assertTestEnv() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('test/helpers/auth.js may only be used with NODE_ENV=test');
  }
}

/**
 * Returns a partial req.user shape consistent with what middleware/auth.js
 * loadOrCreateUser() returns. Override fields as needed per test.
 */
function makeUserContext(overrides = {}) {
  return {
    id:                1,
    auth0_sub:        overrides.auth0_sub        || 'auth0|test',
    email:            overrides.email            || 'test@example.com',
    name:             overrides.name             || 'Test User',
    status:           overrides.status           || 'active',
    is_dev:           overrides.is_dev           ?? false,
    role_id:          overrides.role_id          ?? 1,
    role_name:        overrides.role_name        || 'Admin',
    permissions:      overrides.permissions      || {
      // Default to Admin-write everywhere; override in tests that need restriction.
      dashboard: 'write', inventory: 'write', recipes: 'write', menus: 'write',
      allergens: 'write', haccp: 'write', markets: 'write', categories: 'write',
      settings: 'write', import: 'write', ai_chat: 'write', users: 'write',
      stock_overview: 'write', stock_purchase_orders: 'write',
      stock_goods_in: 'write', stock_invoices: 'write', stock_waste: 'write',
      stock_transfers: 'write', stock_stocktake: 'write',
      bugs: 'write', backlog: 'write',
    },
    allowedCountries: overrides.allowedCountries ?? null,  // null = unrestricted
    language:         overrides.language         || 'en',
    ...overrides,
  };
}

/**
 * Mount a fake auth middleware on a test Express app that injects
 * `userContext` onto every request as req.user. Use this in Supertest
 * tests so handlers see an authenticated user without hitting Auth0.
 *
 * @param {import('express').Express} app
 * @param {object} userContext  return value of makeUserContext()
 */
function bypassAuthMiddleware(app, userContext) {
  assertTestEnv();
  app.use((req, _res, next) => {
    req.user = userContext;
    req.language = userContext.language || 'en';
    next();
  });
}

module.exports = {
  makeUserContext,
  bypassAuthMiddleware,
};
