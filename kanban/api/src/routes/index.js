const router = require('express').Router();

// ── Public routes ─────────────────────────────────────────────────────────────
router.use('/health',   require('./health'));
router.use('/vote',     require('./voting'));

// ── Board management ─────────────────────────────────────────────────────────
router.use('/boards',   require('./boards'));
router.use('/boards',   require('./columns'));
router.use('/boards',   require('./cards'));
router.use('/boards',   require('./import'));
router.use('/boards',   require('./sessions'));
router.use('/boards',   require('./results'));

// ── Top-level card routes (for /cards/:id endpoints) ─────────────────────────
router.use('/cards',    require('./cards').cardRouter);

// ── Top-level session routes (for /sessions/:id endpoints) ───────────────────
router.use('/sessions', require('./sessions').sessionRouter);

module.exports = router;
