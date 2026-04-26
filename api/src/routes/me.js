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
    is_dev:           req.user.is_dev,
    permissions:      req.user.permissions,        // union across all markets
    allowedCountries: req.user.allowedCountries,    // null = unrestricted
    scopedAccess:     req.user.scopedAccess || {},  // { country_id: { roleId, roleName, permissions } }
  });
});

module.exports = router;
