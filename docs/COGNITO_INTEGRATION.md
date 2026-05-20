# AWS Cognito Integration — Plan & Setup Guide

> **Status:** Phase 1 groundwork landed (non-breaking). Phase 2 (Cognito provisioning + verifier) requires an AWS account before any further code changes. **No Cognito traffic flows yet.**
> **Ticket:** [BACK-2364](https://cogs.macaroonie.com)
> **Strategy:** Dual-auth — Auth0 and Cognito coexist indefinitely. Users see one or the other based on which IdP they signed up with. No forced migration.

---

## 1. Why this exists

The COGS app currently authenticates every user through a single Auth0 tenant (`obscurekitty.uk.auth0.com`). The acceptance criteria on [BACK-2364](https://cogs.macaroonie.com) ask for AWS Cognito as an **alternative** identity provider, with MFA, refresh/logout, dual-auth during a transition period, and an admin-visible record of which IdP each user is using.

This doc is the spec + runbook. It is the single source of truth for the integration until it is delivered — when reality and the doc disagree, the doc is wrong.

---

## 2. Strategy — dual-auth, indefinitely

| | Approach | Decision |
|---|---|---|
| (a) | **Dual-auth** — Auth0 and Cognito both work. Each user is permanently tied to one IdP (whichever they signed up with). | **Picked.** |
| (b) | Migration — Cognito becomes default, Auth0 read-only, then off. | Deferred. Can be done later by flipping a flag and walking existing users through a re-auth flow. |

**Why dual-auth:** lowest risk. Auth0 keeps working unchanged for every existing user. New users (or specific markets) can be steered to Cognito without forcing anyone to re-register. If Cognito misbehaves we disable the Cognito login button on the frontend and nothing else changes.

**Per-user binding, not per-session.** A user's `auth_provider` is decided once (at first login) and never changes implicitly. An "Auth0 user" cannot start signing in via Cognito to the same `mcogs_users` row — they would create a fresh pending row. If we ever want to merge identities, that's a deliberate admin action (deferred work, not in scope).

---

## 3. Phases

### Phase 1 — Non-breaking groundwork (LANDED)

Code change only. Zero behaviour change for existing users. Safe to deploy any time.

- New column `mcogs_users.auth_provider VARCHAR(20) NOT NULL DEFAULT 'auth0'` with a CHECK constraint allowing `'auth0' | 'cognito'`. Existing rows backfill to `'auth0'`.
- New index `idx_users_auth_provider`.
- [api/src/middleware/auth.js](../api/src/middleware/auth.js) writes `'auth0'` on user creation and exposes `req.user.auth_provider`. Verification path is still Auth0-only — there is no Cognito branch yet, just the data model + plumbing.
- `GET /api/me` and `GET /api/users` return `auth_provider`.
- `MeUser` and `AppUser` TypeScript types gain `auth_provider`.
- Configuration → Users & Roles gains an **IdP** column (small badge: "Auth0" / "Cognito"). Only shows when at least one non-Auth0 user exists, so existing single-IdP deployments don't see UI noise.

**Rollback:** drop the column. No code path other than the new column relies on it.

### Phase 2 — Cognito provisioning + verifier (BLOCKED on AWS account)

Cannot start until the User Pool exists. See §4 for the setup runbook.

- Add Cognito JWKS verifier (probably `aws-jwt-verify` npm package — it handles RS256 + the standard Cognito claim shape).
- Extend `requireAuth`:
  - Inspect token issuer (`iss`) claim. Cognito tokens carry `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`. Auth0 tokens don't.
  - Route to Cognito verifier when `iss` matches the pool. Existing Auth0 path unchanged.
  - On first Cognito login, create a fresh `mcogs_users` row with `auth_provider = 'cognito'` and `auth0_sub` set to the Cognito `sub` claim. (Column name stays `auth0_sub` — see §5.)
- Server-side env vars:
  - `COGNITO_REGION` (e.g. `eu-west-2`)
  - `COGNITO_USER_POOL_ID`
  - `COGNITO_APP_CLIENT_ID`
  - `COGNITO_ENABLED=true` (kill switch — when false, all Cognito tokens 401 even if the pool exists)
- API `.env.example` updated. `db-config` / `ai-config` patterns followed for the in-app config screen.

### Phase 3 — Frontend dual login UI

- New `app/src/config/cognito.ts` — region, user pool id, app client id, hosted UI domain.
- Login page renders **two buttons**: "Continue with Auth0" and "Continue with AWS Cognito". The Cognito button only shows when `VITE_COGNITO_ENABLED=true`.
- Use `aws-amplify` (auth subset only — not the full Amplify framework) or a plain `oidc-client-ts` flow. Bias toward `oidc-client-ts` because it's a tenth of the bundle size and we already have an OIDC-shaped auth model from Auth0.
- `useApi.ts` must transparently get a fresh token from whichever provider the user signed in through. Probably means a thin `getAccessToken()` wrapper that asks Auth0's `getAccessTokenSilently` *or* Cognito's refresh-token flow depending on which provider hydrated the session.
- Logout calls the right provider's `/logout` endpoint, then clears local session.

### Phase 4 — Admin migration tools (optional, deferred)

- "Re-invite as Cognito" button per user — emails them a Cognito signup link, disables the Auth0 row on success.
- Bulk import users into Cognito via CSV (mostly a Cognito console feature, no app code needed).
- Per-market default IdP — `mcogs_countries.default_auth_provider` so a new franchise can be steered to Cognito without touching anyone else.

---

## 4. AWS setup runbook (do this before Phase 2)

You don't have a Cognito User Pool yet. This is the minimum to provision one and wire it up to Phase 2.

### 4.1 Create the User Pool

1. AWS Console → Cognito → Create user pool.
2. **Sign-in options:** Email. (Matches Auth0's username/password setup. Add Google later by adding a federated IdP.)
3. **Password policy:** Cognito default is fine (8+ chars, uppercase, lowercase, number, symbol).
4. **MFA:** Required → SMS + TOTP. Or "Optional" if you want to roll it out gradually. AC says MFA must be supported, not enforced.
5. **User account recovery:** Email only (no SMS by default — adding SMS triggers an AWS SNS spend approval).
6. **Self-service sign-up:** Enabled. Required attributes: `email`, `name`.
7. **Email provider:** "Send email with Cognito" for now. Switch to SES later if email volume justifies it.
8. **App client:**
   - Type: **Public client** (SPA — no client secret).
   - Auth flows: **ALLOW_USER_SRP_AUTH** + **ALLOW_REFRESH_TOKEN_AUTH**. Disable `ALLOW_USER_PASSWORD_AUTH` (legacy, insecure).
   - Token expiration: access 1h, ID 1h, refresh 30 days. Match Auth0 defaults.
9. **Hosted UI:**
   - Cognito domain prefix: `cogs-macaroonie` (or whatever's available — must be globally unique within the region).
   - Callback URL: `https://cogs.macaroonie.com/auth/callback/cognito`
   - Sign-out URL: `https://cogs.macaroonie.com/login`
   - OAuth grant types: **Authorization code grant** only.
   - Scopes: `openid`, `email`, `profile`.

### 4.2 Capture these values

Once the pool is created, you need:

| Value | Where |
|---|---|
| Region | `eu-west-2` (or whichever you pick — match Lightsail region for latency) |
| User Pool ID | `eu-west-2_XXXXXXXXX` |
| App Client ID | `1a2b3c4d5e6f7g8h9i0j` (no secret for SPA) |
| Hosted UI domain | `cogs-macaroonie.auth.eu-west-2.amazoncognito.com` |
| Issuer URL | `https://cognito-idp.eu-west-2.amazonaws.com/<user-pool-id>` |
| JWKS URI | `<issuer>/.well-known/jwks.json` |

### 4.3 Add to staging first

We don't have a staging environment yet ([`docs/STAGING.md`](./STAGING.md) covers what's missing). When that lands, create a second User Pool for staging — separate dev and prod IdP state. Until then, point staging-mode local dev at the same pool but use a separate app client.

### 4.4 Server env vars (Phase 2)

Add to `/var/www/menu-cogs/api/.env` on the server:

```env
COGNITO_REGION=eu-west-2
COGNITO_USER_POOL_ID=eu-west-2_XXXXXXXXX
COGNITO_APP_CLIENT_ID=1a2b3c4d5e6f7g8h9i0j
COGNITO_ENABLED=true
```

Add to GitHub Secrets for the SPA build:

| Secret | Value |
|---|---|
| `VITE_COGNITO_ENABLED` | `true` |
| `VITE_COGNITO_REGION` | matches server |
| `VITE_COGNITO_USER_POOL_ID` | matches server |
| `VITE_COGNITO_APP_CLIENT_ID` | matches server |
| `VITE_COGNITO_DOMAIN` | `cogs-macaroonie.auth.eu-west-2.amazoncognito.com` |

Kill-switch: setting `VITE_COGNITO_ENABLED=false` hides the Cognito login button. Setting `COGNITO_ENABLED=false` on the server 401s every Cognito-issued token. Either alone is enough to take the feature out.

---

## 5. Schema notes

### Why we keep the column name `auth0_sub`

The existing column is called `auth0_sub`. Renaming it to `idp_sub` would:
- Touch ~40 SQL files
- Force every Pepper tool that reads user records to change
- Require a doc audit

Instead, we store Cognito's `sub` value in the same column. The name is historical. Adding a comment to the migration step ([api/scripts/migrate.js](../api/scripts/migrate.js)) makes that explicit. Both Auth0 and Cognito subs are opaque strings — they don't clash because Cognito subs are UUIDs and Auth0 subs look like `auth0|abc123` or `google-oauth2|123`. A `UNIQUE(auth0_sub)` constraint stays correct.

### Schema delta (Phase 1)

```sql
ALTER TABLE mcogs_users
  ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'auth0'
  CHECK (auth_provider IN ('auth0', 'cognito'));

CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON mcogs_users(auth_provider);
```

That's it. No new tables. No FK changes. Backfill is the column default — existing rows are all Auth0 users, and the default writes `'auth0'` onto every existing row at ALTER time.

---

## 6. Risks and how we handle them

| Risk | Mitigation |
|---|---|
| Cognito verifier crashes the API | Wrap the new branch in try/catch. On any unexpected error, log + 401. Never let a Cognito-token request crash the Auth0 path. |
| Token cache collides | `tokenCache` is keyed on the bearer token string. Auth0 and Cognito tokens are different opaque strings — no collision. |
| User signs up twice (Auth0 + Cognito with the same email) | They get two `mcogs_users` rows, both pending. Admin merges manually (or rejects one). Email is not unique in the table. Acceptable for v1; revisit if it becomes a support burden. |
| Cognito hosted UI redirect breaks | Don't deploy Phase 3 until Phase 2 is verified end-to-end against a real pool. Use Postman / curl against `/api/me` with a Cognito token first. |
| Forgot to set `COGNITO_ENABLED=true` on the server | Cognito tokens 401. Admin sees the 401 in the API log + the user sees "invalid or expired token" in the UI. Fix by flipping the flag — no data corruption. |
| Existing Auth0 users lose access during the rollout | Impossible by design. Phase 1 is a column add. Phase 2 only adds a *second* verifier branch. The Auth0 path stays bit-identical until we deliberately rip it out. |

---

## 7. What landed in Phase 1

| File | Change |
|---|---|
| [api/scripts/migrate.js](../api/scripts/migrate.js) | New migration steps adding `auth_provider` column + index + CHECK + the BACK-2364 status flip + changelog entry. |
| [api/src/middleware/auth.js](../api/src/middleware/auth.js) | `loadOrCreateUser` writes `auth_provider = 'auth0'` on insert. `req.user.auth_provider` exposed. Comment marks where the Cognito branch will plug in. |
| [api/src/routes/me.js](../api/src/routes/me.js) | Response includes `auth_provider`. |
| [api/src/routes/users.js](../api/src/routes/users.js) | List query returns `auth_provider`. |
| [app/src/hooks/usePermissions.ts](../app/src/hooks/usePermissions.ts) | `MeUser` gains `auth_provider`. |
| [app/src/pages/SettingsPage.tsx](../app/src/pages/SettingsPage.tsx) | `AppUser` interface gains `auth_provider`. Users table renders an "IdP" cell (badge) when any user has a non-Auth0 provider. |

No code path *consumes* `auth_provider` for an access-control decision yet — it's pure metadata. That's deliberate. If a future change wants to gate something by provider (e.g. force MFA for Cognito-only users) it has the data it needs without a second migration.

---

## 8. Open questions before Phase 2

1. **Region** — `eu-west-2` (London) is closest to Lightsail. Confirm before pool creation.
2. **Email branding** — Cognito's default sender is `no-reply@verificationemail.com`, which looks spammy. Set up SES for the production pool, or accept the default for v1.
3. **SSO / federation** — AC says "SSO capabilities". Cognito supports SAML + OIDC federation out of the box (Google, Microsoft, Apple). Default plan is *not* to enable federation in Phase 2 — get the direct user-pool path working first, then bolt on Google as a Phase-3.1 extension.
4. **Pricing** — Cognito is free up to 50,000 MAU. Beyond that, $0.0055 per MAU. Not a blocker at current scale.

---

## 9. Reference

- AWS Cognito User Pools: https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-identity-pools.html
- `aws-jwt-verify`: https://github.com/awslabs/aws-jwt-verify (npm package — handles JWKS + claim validation for both Cognito and other JWT issuers)
- `oidc-client-ts`: https://github.com/authts/oidc-client-ts (browser OIDC client — tenth the bundle of `aws-amplify`)
- Existing Auth0 setup: see CLAUDE.md §7.

---

*Last updated: 2026-05-12 — Phase 1 groundwork landed.*
