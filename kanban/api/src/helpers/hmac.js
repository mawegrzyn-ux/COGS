const crypto = require('crypto');

const HMAC_SECRET = process.env.HMAC_SECRET || 'kanban-voter-secret-change-me';
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Sign a voter token for public voting routes.
 * Replicates the HMAC pattern from COGS shared-pages.
 */
function signVoterToken(voterId, sessionId, slug) {
  const payload = {
    voter_id: voterId,
    session_id: sessionId,
    slug,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const json = JSON.stringify(payload);
  const b64  = Buffer.from(json).toString('base64url');
  const sig  = crypto.createHmac('sha256', HMAC_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

/**
 * Verify a voter token. Returns the decoded payload or null.
 */
function verifyVoterToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 1) return null;

  const b64 = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expected = crypto.createHmac('sha256', HMAC_SECRET).update(b64).digest('base64url');

  const sigBuf      = Buffer.from(sig, 'base64url');
  const expectedBuf = Buffer.from(expected, 'base64url');
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload; // { voter_id, session_id, slug }
  } catch {
    return null;
  }
}

module.exports = { signVoterToken, verifyVoterToken };
