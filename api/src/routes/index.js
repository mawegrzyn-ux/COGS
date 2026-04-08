const router = require('express').Router();
const { requireAuth, requirePermission } = require('../middleware/auth');

// ── Helpers ────────────────────────────────────────────────────────────────────
const auth = requireAuth;

// can(f, l) — auth + permission check for ALL HTTP methods at mount level.
const can  = (f, l) => [auth, requirePermission(f, l)];

// write(f) — additionally enforces write permission for mutation methods.
// Used alongside can(f, 'read') so read-only users can GET but not mutate.
// Read permission already implies the user is authenticated, so no extra auth
// check is needed here — just the permission level gate.
const write = (f) => (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return requirePermission(f, 'write')(req, res, next);
  }
  next();
};

// ── Public routes — no auth ────────────────────────────────────────────────────
router.use('/health',            require('./health'));
router.use('/public/share',      require('./shared-pages').publicRouter);

// ── Auth identity ──────────────────────────────────────────────────────────────
// me.js applies requireAuth internally
router.use('/me',                require('./me'));

// ── User + Role management ────────────────────────────────────────────────────
// users.js and roles.js apply their own auth + admin guards internally
router.use('/users',             require('./users'));
router.use('/roles',             require('./roles'));

// ── Settings (read: operator+, write: admin only) ──────────────────────────────
router.use('/settings',           ...can('settings', 'read'),    write('settings'),    require('./settings'));
router.use('/units',              ...can('settings', 'read'),    write('settings'),    require('./units'));
router.use('/price-levels',       ...can('settings', 'read'),    write('settings'),    require('./price-levels'));
router.use('/sync-exchange-rates',...can('settings', 'write'),                         require('./sync-exchange-rates'));

// ── Markets ────────────────────────────────────────────────────────────────────
router.use('/countries',          ...can('markets', 'read'),     write('markets'),     require('./countries'));
router.use('/tax-rates',          ...can('markets', 'read'),     write('markets'),     require('./tax-rates'));
router.use('/country-level-tax',  ...can('markets', 'read'),     write('markets'),     require('./country-level-tax'));
router.use('/brand-partners',     ...can('markets', 'read'),     write('markets'),     require('./brand-partners'));

// ── Categories ─────────────────────────────────────────────────────────────────
router.use('/category-groups',    ...can('categories', 'read'),  write('categories'),  require('./category-groups'));
router.use('/categories',         ...can('categories', 'read'),  write('categories'),  require('./categories'));

// ── Inventory ──────────────────────────────────────────────────────────────────
router.use('/vendors',            ...can('inventory', 'read'),   write('inventory'),   require('./vendors'));
router.use('/ingredients',        ...can('inventory', 'read'),   write('inventory'),   require('./ingredients'));
router.use('/price-quotes',       ...can('inventory', 'read'),   write('inventory'),   require('./price-quotes'));
router.use('/preferred-vendors',  ...can('inventory', 'read'),   write('inventory'),   require('./preferred-vendors'));

// ── Recipes ────────────────────────────────────────────────────────────────────
router.use('/recipes',            ...can('recipes', 'read'),     write('recipes'),     require('./recipes'));

// ── Menus ──────────────────────────────────────────────────────────────────────
router.use('/menus',              ...can('menus', 'read'),       write('menus'),       require('./menus'));
router.use('/scenarios',          ...can('menus', 'read'),       write('menus'),       require('./scenarios'));
router.use('/menu-items',         ...can('menus', 'read'),       write('menus'),       require('./menu-items'));
router.use('/menu-item-prices',   ...can('menus', 'read'),       write('menus'),       require('./menu-item-prices'));
router.use('/shared-pages',       ...can('menus', 'read'),       write('menus'),       require('./shared-pages').router);

// ── Sales Items (product catalog + menu links + modifier groups) ───────────────
router.use('/combo-templates',    ...can('menus', 'read'),       write('menus'),       require('./combo-templates'));
router.use('/combos',             ...can('menus', 'read'),       write('menus'),       require('./combos'));
router.use('/sales-items',        ...can('menus', 'read'),       write('menus'),       require('./sales-items'));
router.use('/modifier-groups',    ...can('menus', 'read'),       write('menus'),       require('./modifier-groups'));
router.use('/menu-sales-items',   ...can('menus', 'read'),       write('menus'),       require('./menu-sales-items'));

// ── COGS calculation (read-only, called by Menus page + Pepper tools) ──────────
router.use('/cogs',               auth,                                               require('./cogs').router);

// ── Allergens ──────────────────────────────────────────────────────────────────
router.use('/allergens',          ...can('allergens', 'read'),   write('allergens'),   require('./allergens'));

// ── HACCP ──────────────────────────────────────────────────────────────────────
router.use('/haccp',              ...can('haccp', 'read'),       write('haccp'),       require('./haccp'));
router.use('/locations',          ...can('haccp', 'read'),       write('haccp'),       require('./locations'));
router.use('/location-groups',    ...can('haccp', 'read'),       write('haccp'),       require('./location-groups'));

// ── Import ─────────────────────────────────────────────────────────────────────
router.use('/import',             ...can('import', 'read'),      write('import'),      require('./import').router);

// ── AI ─────────────────────────────────────────────────────────────────────────
// ai-chat and ai-upload: chatting is a read-level capability; individual tool
// calls enforce write permission via the RBAC system prompt + confirmation rules.
router.use('/ai-chat',            ...can('ai_chat', 'read'),                          require('./ai-chat').router);
router.use('/ai-upload',          ...can('ai_chat', 'read'),                          require('./ai-upload'));
router.use('/ai-config',          ...can('settings', 'read'),    write('settings'),   require('./ai-config'));

// ── DB Config (admin-only — switch between local and standalone PostgreSQL) ───
router.use('/db-config',          ...can('settings', 'write'),                        require('./db-config'));

// ── Nutrition proxy (USDA lookup + ingredient enrichment) ──────────────────────
router.use('/nutrition',          ...can('inventory', 'read'),   write('inventory'),  require('./nutrition'));

// ── Image upload (local disk or S3) ───────────────────────────────────────────
router.use('/upload',             auth,                                               require('./upload'));

// ── Media library ──────────────────────────────────────────────────────────────
router.use('/media',              auth,                                               require('./media'));

// ── Misc / internal ────────────────────────────────────────────────────────────
router.use('/seed',               ...can('settings', 'write'),                        require('./seed'));
router.use('/feedback',           auth,                                               require('./feedback'));
router.use('/internal/feedback',                                                       require('./internal-feedback'));

module.exports = router;
