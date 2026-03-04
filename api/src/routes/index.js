const router = require('express').Router();

router.use('/health',              require('./health'));
router.use('/settings',            require('./settings'));
router.use('/units',               require('./units'));
router.use('/price-levels',        require('./price-levels'));
router.use('/sync-exchange-rates', require('./sync-exchange-rates'));
router.use('/countries',           require('./countries'));
router.use('/tax-rates',           require('./tax-rates'));
router.use('/country-level-tax',   require('./country-level-tax'));
router.use('/categories',          require('./categories'));
router.use('/vendors',             require('./vendors'));
router.use('/ingredients',         require('./ingredients'));
router.use('/price-quotes',        require('./price-quotes'));
router.use('/preferred-vendors',   require('./preferred-vendors'));
router.use('/recipes',             require('./recipes'));
router.use('/menus',               require('./menus'));
router.use('/menu-items',          require('./menu-items'));
router.use('/menu-item-prices',    require('./menu-item-prices'));
router.use('/cogs',                require('./cogs'));

module.exports = router;
