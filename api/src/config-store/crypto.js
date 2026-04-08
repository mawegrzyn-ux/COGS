// =============================================================================
// Config store — AES-256-GCM helpers
// Used to encrypt secrets (DB passwords, API keys) at rest in the local
// Postgres config database. The master key is supplied via the env var
// CONFIG_STORE_SECRET — 32 bytes, hex or base64 encoded.
//
// Format of an encrypted value:
//   {"v":1,"iv":"<hex>","tag":"<hex>","ct":"<hex>"}
//
// null / empty inputs round-trip as null so callers can use a single code
// path for "unset" and "encrypted".
// =============================================================================

const crypto = require('crypto');

const ALG = 'aes-256-gcm';
const VERSION = 1;

let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;

  const raw = process.env.CONFIG_STORE_SECRET;
  if (!raw) {
    throw new Error(
      '[config-store] CONFIG_STORE_SECRET is not set. Generate one with ' +
      '`node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` ' +
      'and add it to api/.env before starting the API.'
    );
  }

  let key;
  if (/^[0-9a-fA-F]+$/.test(raw) && raw.length === 64) {
    key = Buffer.from(raw, 'hex');
  } else {
    // Accept base64 as a convenience
    try { key = Buffer.from(raw, 'base64'); } catch { key = null; }
  }
  if (!key || key.length !== 32) {
    throw new Error(
      '[config-store] CONFIG_STORE_SECRET must be 32 bytes (64 hex chars or ' +
      '44-char base64).'
    );
  }

  cachedKey = key;
  return cachedKey;
}

function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return null;
  }
  const key = loadKey();
  const iv  = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, key, iv);
  const ct  = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v:   VERSION,
    iv:  iv.toString('hex'),
    tag: tag.toString('hex'),
    ct:  ct.toString('hex'),
  });
}

function decrypt(payload) {
  if (payload === null || payload === undefined || payload === '') {
    return null;
  }
  const key = loadKey();
  let obj;
  try {
    obj = typeof payload === 'string' ? JSON.parse(payload) : payload;
  } catch (err) {
    throw new Error(`[config-store] Malformed ciphertext: ${err.message}`);
  }
  if (!obj || obj.v !== VERSION || !obj.iv || !obj.tag || !obj.ct) {
    throw new Error('[config-store] Unsupported ciphertext version or shape');
  }
  const iv  = Buffer.from(obj.iv, 'hex');
  const tag = Buffer.from(obj.tag, 'hex');
  const ct  = Buffer.from(obj.ct, 'hex');
  const decipher = crypto.createDecipheriv(ALG, key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  } catch (err) {
    throw new Error(`[config-store] Failed to decrypt value: ${err.message}`);
  }
}

// Used to check whether the secret is correctly configured before the server
// starts handling requests. Throws with a clear error if misconfigured.
function assertReady() {
  loadKey();
}

module.exports = { encrypt, decrypt, assertReady };
