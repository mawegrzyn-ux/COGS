// GET /api/me — returns current user's profile, role, permissions, and market scope
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, (req, res) => {
  res.json({
    id:              req.user.id,
    sub:             req.user.sub,
    email:           req.user.email,
    name:            req.user.name,
    picture:         req.user.picture,
    status:          req.user.status,
    role_id:         req.user.role_id,
    role_name:       req.user.role_name,
    permissions:     req.user.permissions,
    allowedCountries: req.user.allowedCountries,
  });
});

module.exports = router;
