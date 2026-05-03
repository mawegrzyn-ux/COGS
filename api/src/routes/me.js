// GET /api/me — returns current user's profile, role, permissions, and market scope
const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const { getModelTiers } = require('../helpers/aiModels');

router.get('/', requireAuth, async (req, res) => {
  // BACK-2563 — surface AI premium access + the active default/premium model
  // IDs so the frontend can render the model picker with human-readable
  // labels and gate it on access.
  let aiModels = { default: '', premium: '' };
  try {
    aiModels = await getModelTiers();
  } catch (err) {
    console.error('[me] aiModels lookup failed:', err.message);
  }

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
    ai_premium_access: !!req.user.ai_premium_access,
    ai_models:        aiModels,                    // { default, premium }
    permissions:      req.user.permissions,        // union across all markets
    allowedCountries: req.user.allowedCountries,    // null = unrestricted
    scopedAccess:     req.user.scopedAccess || {},  // { country_id: { roleId, roleName, permissions } }
  });
});

module.exports = router;
