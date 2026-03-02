const router = require('express').Router();

router.use('/health', require('./health'));

// Phase 1 routes — uncomment as you migrate from WordPress:
// router.use('/ingredients',    require('./ingredients'));
// router.use('/recipes',        require('./recipes'));
// router.use('/menus',          require('./menus'));
// router.use('/countries',      require('./countries'));
// router.use('/vendors',        require('./vendors'));
// router.use('/categories',     require('./categories'));
// router.use('/price-quotes',   require('./priceQuotes'));
// router.use('/price-levels',   require('./priceLevels'));
// router.use('/cogs',           require('./cogs'));
// router.use('/settings',       require('./settings'));

module.exports = router;
