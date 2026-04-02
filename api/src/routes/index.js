const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');

// ── Helpers ────────────────────────────────────────────────────────────────────
const auth = requireAuth;
const can  = (f, l) => [auth, requirePermission(f, l)];

// ── Public routes — no auth ────────────────────────────────────────────────────
router.use('/health',            require('./health'));
router.use('/public/share',      require('./shared-pages').publicRouter);

// ── Auth identity ──────────────────────────────────────────────────────────────
router.use('/me',                require('./me'));

// ── User + Role management ────────────────────────────────────────────────────
router.use('/users',             require('./users'));
router.use('/roles',             require('./roles'));

// ── Settings (read: operator+, write: admin only) ──────────────────────────────
router.use('/settings',          ...can('settings', 'read'), require('./settings'));
router.use('/units',             ...can('settings', 'read'), require('./units'));
router.use('/price-levels',      ...can('settings', 'read'), require('./price-levels'));
router.use('/sync-exchange-rates',...can('settings', 'write'), require('./sync-exchange-rates'));

// ── Markets ────────────────────────────────────────────────────────────────────
router.use('/countries',         ...can('markets', 'read'), require('./countries'));
router.use('/tax-rates',         ...can('markets', 'read'), require('./tax-rates'));
router.use('/country-level-tax', ...can('markets', 'read'), require('./country-level-tax'));
router.use('/brand-partners',    ...can('markets', 'read'), require('./brand-partners'));

// ── Categories ─────────────────────────────────────────────────────────────────
router.use('/categories',        ...can('categories', 'read'), require('./categories'));

// ── Inventory ──────────────────────────────────────────────────────────────────
router.use('/vendors',           ...can('inventory', 'read'), require('./vendors'));
router.use('/ingredients',       ...can('inventory', 'read'), require('./ingredients'));
router.use('/price-quotes',      ...can('inventory', 'read'), require('./price-quotes'));
router.use('/preferred-vendors', ...can('inventory', 'read'), require('./preferred-vendors'));

// ── Recipes ────────────────────────────────────────────────────────────────────
router.use('/recipes',           ...can('recipes', 'read'), require('./recipes'));

// ── Menus ──────────────────────────────────────────────────────────────────────
router.use('/menus',             ...can('menus', 'read'), require('./menus'));
router.use('/scenarios',         ...can('menus', 'read'), require('./scenarios'));
router.use('/menu-items',        ...can('menus', 'read'), require('./menu-items'));
router.use('/menu-item-prices',  ...can('menus', 'read'), require('./menu-item-prices'));
router.use('/shared-pages',      ...can('menus', 'read'), require('./shared-pages').router);

// ── COGS ───────────────────────────────────────────────────────────────────────
router.use('/cogs',              auth, require('./cogs').router);

// ── Allergens ──────────────────────────────────────────────────────────────────
router.use('/allergens',         ...can('allergens', 'read'), require('./allergens'));

// ── HACCP ──────────────────────────────────────────────────────────────────────
router.use('/haccp',             ...can('haccp', 'read'), require('./haccp'));
router.use('/locations',         ...can('haccp', 'read'), require('./locations'));
router.use('/location-groups',   ...can('haccp', 'read'), require('./location-groups'));

// ── Import ─────────────────────────────────────────────────────────────────────
router.use('/import',            ...can('import', 'read'), require('./import').router);

// ── AI ─────────────────────────────────────────────────────────────────────────
router.use('/ai-chat',           ...can('ai_chat', 'read'), require('./ai-chat').router);
router.use('/ai-upload',         ...can('ai_chat', 'read'), require('./ai-upload'));
router.use('/ai-config',         ...can('settings', 'read'), require('./ai-config'));

// ── Nutrition proxy ────────────────────────────────────────────────────────────
router.use('/nutrition',         auth, require('./nutrition'));

// ── Misc / internal ────────────────────────────────────────────────────────────
router.use('/seed',              ...can('settings', 'write'), require('./seed'));
router.use('/feedback',          auth, require('./feedback'));
router.use('/internal/feedback', auth, require('./internal-feedback'));

module.exports = router;
