const router = require('express').Router();

router.use('/health',              require('./health'));
router.use('/units',               require('./units'));
router.use('/price-levels',        require('./price-levels'));
router.use('/sync-exchange-rates', require('./sync-exchange-rates'));
router.use('/countries',           require('./countries'));
router.use('/tax-rates',           require('./tax-rates'));
router.use('/country-level-tax',   require('./country-level-tax'));

// Uncomment as pages are built:
// router.use('/categories',        require('./categories'));
// router.use('/vendors',           require('./vendors'));
// router.use('/ingredients',       require('./ingredients'));
// router.use('/price-quotes',      require('./price-quotes'));
// router.use('/recipes',           require('./recipes'));
// router.use('/menus',             require('./menus'));
// router.use('/cogs',              require('./cogs'));

module.exports = router;
