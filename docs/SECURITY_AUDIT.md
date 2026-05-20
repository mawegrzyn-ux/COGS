# Security Audit — COGS Manager
**Audit Date:** April 2026
**Scope:** Full-stack application security review (authentication, authorization, input validation, file uploads, infrastructure, secrets, headers, data exposure)

---

## Executive Summary

The COGS application demonstrates strong security practices overall with properly implemented authentication, authorization, encryption, and input validation. No critical vulnerabilities found. One high-severity issue (hardcoded fallback secret) and two medium-severity issues identified.

**Critical: 0 | High: 1 | Medium: 2 | Low/Advisory: 5**

---

## Measures Already in Place

### Authentication & Authorization
- Auth0 token validation via `/userinfo` endpoint with 5-minute cache (500 entries max)
- Timing-safe comparison (`crypto.timingSafeEqual`) for internal service key validation
- Full RBAC: 13-feature permission matrix (none/read/write), 3 system roles + custom roles
- Market scope filtering via `mcogs_user_brand_partners` → `allowedCountries` enforced in middleware and Pepper AI tools
- User lifecycle enforcement: pending → active → disabled states checked on every request
- First-user auto-bootstrap as Admin (prevents chicken-and-egg on fresh installs)

### SQL Injection Prevention
- Parameterized queries (`$1, $2, ...`) used across all 30+ route files — no exceptions found
- Field allowlists on PATCH endpoints (only explicitly listed fields reach SQL)
- No `eval()`, `Function()`, or `child_process.exec()` with user input anywhere in codebase

### File Upload Security
- MIME type whitelist: only `image/jpeg`, `image/png`, `image/webp`, `image/gif` accepted
- File size limits: 5 MB (upload.js), 20 MB (media.js)
- Random filenames: `${Date.now()}-${randomString}` — original filename stored in DB only
- Path traversal protection: `path.resolve()` + `startsWith(UPLOADS_DIR)` check on file serving

### HTTP Security Headers (via Helmet)
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- Strict-Transport-Security (HSTS) enabled
- Content-Security-Policy included

### Rate Limiting
- Global: 500 requests per 15-minute window via `express-rate-limit`

### CORS
- Scoped to `CORS_ORIGIN` environment variable (production domain or localhost)
- Credentials allowed for authenticated requests
- Methods restricted to GET, POST, PUT, PATCH, DELETE, OPTIONS

### Encryption
- AES-256-GCM for API keys at rest (Anthropic, Voyage, GitHub PAT) via config store
- `crypto.scrypt()` + random salt for shared page passwords
- HMAC-SHA256 for shared page access tokens with 24-hour TTL
- TLS via Let's Encrypt (Certbot auto-renew) on Nginx

### Error Handling
- Stack traces only in development mode (`NODE_ENV === 'development'`)
- Production returns generic `{ error: { message } }` JSON

### Audit Trail
- `mcogs_audit_log` table: records all create/update/delete/status_change actions
- Stores: user identity, entity type+id, field-level diffs (old→new JSONB), context, related entities, IP address
- Wired into 8 route files: ingredients, recipes, price-quotes, purchase-orders, goods-received, stock-levels, waste, stocktakes

### XSS Prevention
- No `dangerouslySetInnerHTML` usage found in React codebase
- Pepper markdown renderer (`renderMd` in AiChat.tsx) escapes HTML before inline formatting
- All API responses are JSON — no server-rendered HTML

---

## Issues Found

### HIGH — Hardcoded Shared Page Secret Fallback

| Field | Value |
|---|---|
| **File** | `api/src/routes/shared-pages.js`, line 29 |
| **Code** | `const HMAC_SECRET = process.env.SHARED_PAGE_SECRET \|\| 'mcogs-shared-page-secret-change-me'` |
| **Impact** | If `SHARED_PAGE_SECRET` env var is not set on the server, shared menu page tokens are generated with a predictable secret. An attacker who knows the fallback value could forge valid access tokens for any shared page. |
| **Likelihood** | Medium — requires the env var to be missing AND knowledge of the codebase |
| **Fix** | Remove the fallback. Fail at startup if `SHARED_PAGE_SECRET` is not configured. Generate a random secret if needed: `const HMAC_SECRET = process.env.SHARED_PAGE_SECRET; if (!HMAC_SECRET) throw new Error('SHARED_PAGE_SECRET environment variable is required')` |

### MEDIUM — Health Check Exposes Server Uptime

| Field | Value |
|---|---|
| **File** | `api/src/routes/health.js` |
| **Code** | `res.json({ status: 'ok', db: 'connected', time: ..., uptime: Math.floor(process.uptime()) })` |
| **Impact** | Exposes server uptime which aids fingerprinting and reveals deployment/restart patterns. Public endpoint (no auth required). |
| **Fix** | Remove `uptime` from the public response. If needed for monitoring, create a separate authenticated `/api/health/detailed` endpoint. |

### MEDIUM — Auth0 Domain Hardcoded Fallback

| Field | Value |
|---|---|
| **File** | `api/src/middleware/auth.js`, line 10 |
| **Code** | `const AUTH0_DOMAIN = process.env.VITE_AUTH0_DOMAIN \|\| 'obscurekitty.uk.auth0.com'` |
| **Impact** | If the environment variable is missing, authentication falls back to a specific Auth0 tenant. Not exploitable per se, but violates the principle that production config should never have silent fallbacks. |
| **Fix** | Remove the fallback. Fail at startup if not configured. |

---

## Recommendations

### Immediate Priority
1. **Fix SHARED_PAGE_SECRET fallback** — remove hardcoded default, fail at startup if missing
2. **Add `SHARED_PAGE_SECRET` to deployment** — generate with `openssl rand -hex 32`, add to server `.env`

### High Priority
3. **Add `npm audit` to CI/CD pipeline** — add a step in `.github/workflows/deploy.yml` to run `npm audit --audit-level=moderate` and fail the build on vulnerabilities
4. **Add per-user rate limiting** — current global rate limit (500/15min) means one user doing bulk operations can exhaust the pool for all users. Add per-IP or per-user token bucket.
5. **Remove Auth0 domain fallback** — fail at startup if `VITE_AUTH0_DOMAIN` is not set

### Medium Priority
6. **Strip uptime from health endpoint** — or gate behind auth
7. **Add startup validation for all required env vars** — check DB_HOST, DB_NAME, AUTH0 domain, SHARED_PAGE_SECRET at boot and fail fast with clear errors
8. **Implement Auth0 API audience** — currently empty. Adding audience enables local JWT verification instead of calling Auth0 `/userinfo` on every request (faster, more reliable)

### Low Priority / Future
9. **Add request correlation IDs** — generate a UUID per request, include in audit log and error responses for debugging
10. **Consider WAF** — when scaling beyond single Lightsail instance, add CloudFront with AWS WAF for DDoS protection and geographic filtering
11. **Add IP allowlisting for admin endpoints** — optional layer for sensitive operations (user management, database config, test data)
12. **Document incident response plan** — required for enterprise compliance (SOC 2, referenced in BNO gap analysis)
13. **Enable PostgreSQL at-rest encryption** — not currently documented/enforced
14. **Add automated penetration testing** — schedule periodic security scans

---

## What's Not in Scope (and Why It's OK)

- **No CSRF tokens**: State-changing operations require `Authorization: Bearer` header which is not sent by browser form submissions. CORS + auth header requirement is sufficient CSRF protection for this SPA architecture.
- **No Content-Security-Policy nonce for inline scripts**: Vite bundles all JS at build time — no inline scripts exist in production. Helmet's default CSP is adequate.
- **No subresource integrity (SRI)**: All assets are first-party, served from the same origin. SRI is relevant for CDN-served third-party scripts.

---

## Files Reviewed

Authentication: `auth.js`, `index.js` (middleware stack), `shared-pages.js`
Authorization: `roles.js`, `users.js`, `index.js` (route registration)
Input validation: All route files (30+) — SQL parameterization verified
File handling: `media.js`, `media-file.js`, `upload.js`, `ai-upload.js`
Secrets: `.env.example`, `crypto.js`, `aiConfig.js`, `deploy.yml`
Headers: `index.js` (helmet, cors, rate-limit)
Frontend: `auth0.ts`, `useApi.ts`, `AiChat.tsx` (markdown renderer)
Infrastructure: `deploy.yml`, `health.js`, `db/config.js`
