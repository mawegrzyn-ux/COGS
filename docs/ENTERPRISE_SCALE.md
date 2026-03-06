# COGS Manager — Enterprise Scale-Up Plan

*Written March 2026 — based on current v1 architecture assessment*

---

## Table of Contents

1. [Current Architecture Summary](#1-current-architecture-summary)
2. [Volume Limits — Where Things Break](#2-volume-limits--where-things-break)
3. [Critical Architecture Gaps](#3-critical-architecture-gaps)
4. [Phase 1 — Hardening (0–3 months)](#4-phase-1--hardening-03-months)
5. [Phase 2 — Scale (3–9 months)](#5-phase-2--scale-39-months)
6. [Phase 3 — Enterprise (9–18 months)](#6-phase-3--enterprise-918-months)
7. [Multi-Tenancy Strategy](#7-multi-tenancy-strategy)
8. [Database Scaling Path](#8-database-scaling-path)
9. [PgBouncer — Connection Pooling](#9-pgbouncer--connection-pooling)
10. [API & Compute Scaling](#10-api--compute-scaling)
11. [COGS Calculation Engine Redesign](#11-cogs-calculation-engine-redesign)
12. [Auth Hardening — JWT + RBAC](#12-auth-hardening--jwt--rbac)
13. [Frontend CDN & Static Delivery](#13-frontend-cdn--static-delivery)
14. [Key SQL Optimisations](#14-key-sql-optimisations)
15. [Cost Estimates by Phase](#15-cost-estimates-by-phase)

---

## 1. Current Architecture Summary

| Layer | Current (v1) | Notes |
|---|---|---|
| **Frontend** | React 18 + Vite + TypeScript | Served by Nginx from `/var/www/menu-cogs/frontend/` |
| **API** | Node.js + Express (single process) | Port 3001, managed by PM2 |
| **Database** | PostgreSQL 16 — single instance | On the same box as the API |
| **Auth** | Auth0 SPA — no JWT validation on API | Tokens not verified server-side |
| **Hosting** | AWS Lightsail `WRI` — 2GB RAM, 1 vCPU | $10/mo — dev/staging tier |
| **CI/CD** | GitHub Actions → SSH + SCP | Works well — keep this pattern |
| **Process Mgr** | PM2 (single instance, no cluster) | Configured as `ubuntu` user |
| **SSL** | Let's Encrypt via Certbot | Auto-renews, no action needed |

**Everything — web server, API, database, and SSL termination — runs on one $10/mo box.**

---

## 2. Volume Limits — Where Things Break

These are practical ceilings based on the current single-box setup. Beyond these numbers performance will degrade noticeably.

| Metric | Comfortable Ceiling | Starts Degrading | Hard Limit |
|---|---|---|---|
| **Ingredients** | ~10,000 | ~25,000 | ~50,000 (full-table scans) |
| **Price Quotes** | ~100,000 | ~300,000 | ~500,000 |
| **Recipes** | ~2,000 | ~5,000 | ~10,000 |
| **Recipe Items** | ~20,000 | ~50,000 | ~100,000 |
| **Markets / Countries** | ~50 | ~200 | ~500 |
| **Concurrent API Users** | 5–15 | 20–40 | ~60 (OOM / CPU saturation) |
| **DB Connections** | 20–30 | 60 (PG default max: 100) | 100 (connections blocked) |
| **Menu Item Prices** | ~50,000 | ~200,000 | ~500,000 |

**Why these limits exist on the current setup:**
- **1 vCPU**: JavaScript is single-threaded. One blocking query → all requests queue.
- **2GB RAM**: PostgreSQL shared buffers default to 128MB. No room for Redis or caching.
- **No connection pooling**: Every API request opens a new PG connection. At ~60 concurrent users the connection limit is hit.
- **COGS is synchronous**: Deep recipe nesting + join chains = slow queries under load.
- **No tenant isolation**: All franchise operators share one schema with no row-level filtering guarantee.

---

## 3. Critical Architecture Gaps

These are the three issues to fix before onboarding real franchise operators.

### Gap 1 — No JWT Validation on the API

**Current state:** Auth0 issues tokens to the frontend. The API accepts any request without verifying the token. Any caller that knows the API URL can read/write/delete all data.

**Risk:** Data exposure and data destruction by unauthenticated callers.

**Fix:** Add `express-jwt` + `jwks-rsa` middleware. See [Phase 1 → JWT Validation](#jwt-validation).

---

### Gap 2 — No Tenant Isolation

**Current state:** All data (ingredients, recipes, menus, markets) belongs to a single implicit "tenant". All logged-in users see and can edit everything.

**Risk:** Franchise operator A can read and overwrite franchise operator B's data. One super-admin can accidentally delete global data.

**Fix:** Add `tenant_id` to all core tables + Row Level Security (RLS) in PostgreSQL. See [Phase 1 → Multi-Tenancy](#7-multi-tenancy-strategy).

---

### Gap 3 — Single Point of Failure

**Current state:** One Lightsail instance hosts everything. If it goes down, the entire app is unavailable.

**Risk:** Unacceptable for production franchise operators. Any server maintenance = outage.

**Fix:** Migrate to RDS (managed DB) + ECS Fargate (managed compute) in Phase 2.

---

## 4. Phase 1 — Hardening (0–3 months)

**Goal:** Safe for real production traffic on the existing stack. Low cost, high impact.

### 4.1 JWT Validation on the API

**What:** Verify every API request carries a valid Auth0-issued JWT. Reject unauthenticated requests at the Express middleware layer.

**Install:**
```bash
cd api && npm install express-oauth2-jwt-bearer
```

**Add to `api/src/index.js`:**
```javascript
const { auth } = require('express-oauth2-jwt-bearer');

// Add AFTER app.set('trust proxy', 1) — BEFORE route registration
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,   // e.g. 'https://api.obscurekitty.com'
  issuerBaseURL: `https://${process.env.AUTH0_DOMAIN}/`,
  tokenSigningAlg: 'RS256',
});

app.use('/api', checkJwt);   // Protect all /api/* routes
```

**Add to `api/.env`:**
```env
AUTH0_AUDIENCE=https://api.obscurekitty.com
AUTH0_DOMAIN=obscurekitty.uk.auth0.com
```

**Add to Auth0 dashboard:**
1. Create a new API: `Identifier = https://api.obscurekitty.com`
2. Add the audience to `app/.env.local`:  `VITE_AUTH0_AUDIENCE=https://api.obscurekitty.com`
3. Pass audience in `app/src/main.tsx` `authorizationParams`

**Effort:** ~1 day.

---

### 4.2 PgBouncer Connection Pooling

**What:** Add PgBouncer between Express and PostgreSQL to pool connections and prevent connection exhaustion under load.

See [Section 9 — PgBouncer](#9-pgbouncer--connection-pooling) for full detail.

**Effort:** ~2 hours.

---

### 4.3 PM2 Cluster Mode

**What:** Run the Express API in PM2 cluster mode to use both virtual CPUs (once upgraded to 2 vCPU Lightsail).

**`pm2.config.cjs` (in `api/`):**
```javascript
module.exports = {
  apps: [{
    name: 'menu-cogs-api',
    script: 'src/index.js',
    instances: 'max',          // One worker per CPU core
    exec_mode: 'cluster',
    env: { NODE_ENV: 'production', PORT: 3001 },
  }]
}
```

**Start:**
```bash
pm2 start pm2.config.cjs
pm2 save
```

**Important:** Cluster mode requires session affinity if you ever add server-side sessions. Auth0 JWTs are stateless so no issue here.

**Effort:** ~1 hour.

---

### 4.4 Lightsail Snapshot + Upgrade to 2 vCPU

**What:** Take a snapshot of the current instance, then resize to the $20/mo plan (4GB RAM, 2 vCPU).

```
Current:  $10/mo — 2GB RAM, 1 vCPU, 60GB SSD
Target:   $20/mo — 4GB RAM, 2 vCPU, 80GB SSD
```

**Steps:**
1. AWS Lightsail Console → Instance → Snapshots → Create snapshot
2. From snapshot → Create new instance → Select $20/mo plan
3. Reassign static IP to new instance
4. Test, then terminate old instance

**Effort:** ~30 minutes (+ ~10 min downtime during IP reassignment).

---

### 4.5 Automated DB Backups

**What:** Lightsail has automated snapshots but they're manual. Add a daily `pg_dump` to S3.

```bash
# Add to crontab (crontab -e as ubuntu user)
0 3 * * * pg_dump -U mcogs mcogs | gzip > /tmp/mcogs-$(date +\%Y\%m\%d).sql.gz && \
  aws s3 cp /tmp/mcogs-$(date +\%Y\%m\%d).sql.gz s3://your-backup-bucket/ && \
  rm /tmp/mcogs-$(date +\%Y\%m\%d).sql.gz
```

**Effort:** ~2 hours (S3 bucket setup + IAM role + cron).

---

## 5. Phase 2 — Scale (3–9 months)

**Goal:** Decouple services. Remove single point of failure. Support 50–200 concurrent users.

### 5.1 Migrate Database to Amazon RDS

**What:** Move PostgreSQL from the Lightsail box to Amazon RDS (managed service).

**Why RDS vs self-hosted PostgreSQL:**

| Feature | Self-hosted (current) | RDS |
|---|---|---|
| Automated backups | Manual | Automated, point-in-time recovery |
| Failover | None | Multi-AZ option |
| Minor version upgrades | Manual | Automated |
| Monitoring | PM2 + manual | CloudWatch metrics + alerts |
| Vertical scaling | Downtime required | Some changes are live |
| Storage autoscaling | Manual | Automatic |

**Target:** `db.t4g.small` (2 vCPU, 2GB RAM) → ~$30/mo in `eu-west-2` (London).

**Migration steps:**
```bash
# 1. Dump from current server
pg_dump -U mcogs mcogs > mcogs_export.sql

# 2. Create RDS instance (via AWS Console or Terraform)
# 3. Import
psql -h <rds-endpoint> -U mcogs mcogs < mcogs_export.sql

# 4. Update api/.env
DB_HOST=<rds-endpoint>.eu-west-2.rds.amazonaws.com
```

**Effort:** ~1 day (including testing and switchover).

---

### 5.2 Read Replica for Reporting Queries

**What:** Add one RDS read replica. Route heavy COGS/dashboard reads to the replica; write operations stay on primary.

**Cost:** Additional ~$15–25/mo for the replica instance.

**API change:** Create two pool instances in `api/src/db/pool.js`:
```javascript
const writePool = new Pool({ host: process.env.DB_HOST_PRIMARY, ... });
const readPool  = new Pool({ host: process.env.DB_HOST_REPLICA, ... });

module.exports = { writePool, readPool };
```

Routes like `/cogs`, `/dashboard`, `/menus` (read-heavy) use `readPool`; all writes use `writePool`.

---

### 5.3 Migrate API to ECS Fargate (or Elastic Beanstalk)

**What:** Containerise the Express API and run it on AWS ECS Fargate. Enables horizontal scaling (multiple containers), zero-downtime deploys, and decouples the API from the database server.

**Dockerfile for API:**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY src ./src
EXPOSE 3001
CMD ["node", "src/index.js"]
```

**Fargate target config:**
- Task: 0.5 vCPU, 1GB RAM per container
- Min tasks: 1, Max tasks: 10 (autoscale on CPU > 60%)
- ALB (Application Load Balancer) in front — handles HTTPS termination
- Deploy via GitHub Actions: build image → push to ECR → update ECS service

**Effort:** ~3–5 days (Dockerfile + ECR setup + ECS task def + ALB config + CI/CD update).

**Cost:** ~$15–30/mo for small baseline + autoscaling costs.

---

### 5.4 Redis Caching Layer

**What:** Add Redis (ElastiCache) to cache expensive reads: COGS calculations, dashboard KPIs, ingredient lists.

**Use cases:**
- `GET /api/cogs?menu_id=X&country_id=Y` → cache 5 minutes (invalidate on recipe/price-quote write)
- `GET /api/dashboard/kpis` → cache 60 seconds
- `GET /api/ingredients` (full list) → cache 30 seconds

**Node.js integration:**
```javascript
const redis = require('ioredis');
const cache = new redis(process.env.REDIS_URL);

// In cogs route:
const cacheKey = `cogs:menu:${menu_id}:country:${country_id}`;
const cached = await cache.get(cacheKey);
if (cached) return res.json(JSON.parse(cached));

const result = await calculateCogs(menu_id, country_id);
await cache.setex(cacheKey, 300, JSON.stringify(result));  // 5 min TTL
res.json(result);
```

**Cost:** ElastiCache `cache.t4g.micro` ~$12/mo.

**Effort:** ~2 days.

---

### 5.5 Frontend — CloudFront CDN

**What:** Serve the React SPA from CloudFront + S3 instead of Nginx on the Lightsail box.

**Benefits:**
- Global edge locations → fast load times for all franchise markets
- S3 + CloudFront is effectively free at low traffic
- Nginx on the API box no longer serves static files → simplifies the stack

**Updated CI/CD (deploy.yml):**
```yaml
- name: Build frontend
  run: cd app && npm ci && npm run build
  env:
    VITE_API_URL: ${{ secrets.VITE_API_URL }}
    VITE_AUTH0_DOMAIN: ${{ secrets.VITE_AUTH0_DOMAIN }}
    VITE_AUTH0_CLIENT_ID: ${{ secrets.VITE_AUTH0_CLIENT_ID }}
    VITE_AUTH0_AUDIENCE: ${{ secrets.VITE_AUTH0_AUDIENCE }}

- name: Deploy to S3
  run: aws s3 sync app/dist/ s3://${{ secrets.S3_BUCKET }}/ --delete

- name: Invalidate CloudFront cache
  run: aws cloudfront create-invalidation --distribution-id ${{ secrets.CF_DIST_ID }} --paths "/*"
```

**Cost:** S3 + CloudFront for this scale = <$5/mo.

**Effort:** ~1 day (S3 bucket + CloudFront distribution setup + CI/CD update).

---

## 6. Phase 3 — Enterprise (9–18 months)

**Goal:** Multi-tenant SaaS. Supports multiple independent franchise groups. Audit logs. Role-based access. ERP integrations.

### 6.1 Full Multi-Tenancy with Row Level Security

See [Section 7](#7-multi-tenancy-strategy) for full detail.

**Summary of changes:**
- Add `tenant_id UUID` to all `mcogs_` tables
- Enable PostgreSQL Row Level Security (RLS) on all tables
- Map Auth0 user → tenant in a `mcogs_tenants` table
- Pass tenant context via JWT claim

---

### 6.2 RBAC — Role-Based Access Control

**Roles:**

| Role | Capabilities |
|---|---|
| `super_admin` | All tenants — read/write everything |
| `franchise_admin` | Own tenant — read/write everything |
| `market_manager` | Assigned markets — read/write own market data |
| `read_only` | Own tenant — read all, write nothing |

**Implementation:**
1. Store roles in Auth0 as JWT claims: `https://mcogs.com/roles: ["franchise_admin"]`
2. Express middleware extracts role from JWT
3. Route-level checks: `requireRole('franchise_admin')` guard
4. RLS policies reference role from the database session variable

---

### 6.3 Audit Log

**What:** Track every create/update/delete with `who`, `what`, `when`, `old value`, `new value`.

**Schema:**
```sql
CREATE TABLE mcogs_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  user_id     TEXT NOT NULL,               -- Auth0 sub
  table_name  TEXT NOT NULL,
  record_id   INTEGER NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data    JSONB,
  new_data    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_table ON mcogs_audit_log(tenant_id, table_name, created_at DESC);
```

**PostgreSQL trigger approach (no application code changes required):**
```sql
CREATE OR REPLACE FUNCTION mcogs_audit_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO mcogs_audit_log (tenant_id, user_id, table_name, record_id, action, old_data, new_data)
  VALUES (
    current_setting('app.tenant_id')::UUID,
    current_setting('app.user_id'),
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Apply to each table:
CREATE TRIGGER audit_ingredients
  AFTER INSERT OR UPDATE OR DELETE ON mcogs_ingredients
  FOR EACH ROW EXECUTE FUNCTION mcogs_audit_trigger();
```

---

### 6.4 Async COGS Calculation Queue

**What:** Replace synchronous COGS calculation with a Bull/BullMQ queue. Heavy COGS recalculations happen in background workers; results are cached and served from Redis.

**When COGS needs recalculation:**
- A price quote is updated → queue recalc for affected recipes/menus
- A recipe is updated → queue recalc for menus containing that recipe
- Exchange rates are synced → queue recalc for all markets

**Architecture:**
```
POST /api/price-quotes/:id  →  Update DB  →  Enqueue "recalc:cogs:market:X"
                                              ↓
                                         Bull Worker (separate process)
                                              ↓
                                    Calculate COGS recursively
                                              ↓
                                    Store in Redis (TTL: 1 hour)
                                    Write to mcogs_cogs_cache table

GET /api/cogs?menu_id=X&country_id=Y  →  Read from Redis (or DB cache)
                                          →  Return immediately (no live query)
```

**Packages:**
```bash
npm install bullmq ioredis
```

---

### 6.5 ERP / POS Integration Webhooks

**What:** Allow franchise operators to push data in/out via webhooks. Common integrations:

| System | Direction | Data |
|---|---|---|
| Lightspeed POS | Inbound | Actual sales → update COGS actuals |
| Fourth (HR/Inventory) | Bidirectional | Waste tracking, actual usage vs theoretical |
| Xero / QuickBooks | Outbound | Push COGS reports to accounting |
| Sysco / US Foods | Inbound | Live price feeds → update price quotes automatically |

**Webhook schema:**
```sql
CREATE TABLE mcogs_webhooks (
  id          SERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  name        TEXT NOT NULL,
  event       TEXT NOT NULL,  -- 'price_quote.updated', 'cogs.calculated', etc.
  url         TEXT NOT NULL,
  secret      TEXT NOT NULL,  -- HMAC signing key
  is_active   BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 7. Multi-Tenancy Strategy

### Option A — Schema-per-Tenant (Rejected)

Each tenant gets their own PostgreSQL schema (`tenant_abc.mcogs_ingredients`). Easy isolation but expensive: 50 tenants = 50× schema migrations, difficult cross-tenant reporting.

**Not recommended.**

### Option B — Row Level Security (Recommended) ✅

Single schema. All tables get `tenant_id UUID NOT NULL`. PostgreSQL RLS policies enforce isolation at the database level — the application cannot accidentally leak data between tenants.

**Migration steps:**

**Step 1 — Add `mcogs_tenants` table:**
```sql
CREATE TABLE mcogs_tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  auth0_org   TEXT UNIQUE,   -- Auth0 organization ID (for enterprise SSO)
  plan        TEXT NOT NULL DEFAULT 'standard',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**Step 2 — Add `tenant_id` to all core tables:**
```sql
ALTER TABLE mcogs_countries    ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
ALTER TABLE mcogs_vendors       ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
ALTER TABLE mcogs_ingredients   ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
ALTER TABLE mcogs_price_quotes  ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
ALTER TABLE mcogs_recipes       ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
ALTER TABLE mcogs_menus         ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
ALTER TABLE mcogs_categories    ADD COLUMN tenant_id UUID REFERENCES mcogs_tenants(id);
-- ... all other tables
```

**Step 3 — Enable RLS and create policies:**
```sql
ALTER TABLE mcogs_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON mcogs_ingredients
  USING (tenant_id = current_setting('app.tenant_id')::UUID);
```

**Step 4 — Set tenant context per request in Express middleware:**
```javascript
// After JWT validation, before routes
app.use('/api', async (req, res, next) => {
  const tenantId = await getTenantIdFromAuth0Sub(req.auth.sub);
  await pool.query(`SET app.tenant_id = '${tenantId}'`);
  await pool.query(`SET app.user_id = '${req.auth.sub}'`);
  next();
});
```

> **Important with PgBouncer:** Use `SET LOCAL` (not `SET`) in transaction mode, or use `pg_advisory_lock` to pin the connection for the duration of the request. Alternatively, use PgBouncer in **session mode** for tenant-context safety.

---

## 8. Database Scaling Path

```
Phase 1  →  Current Lightsail PG + PgBouncer
Phase 2  →  Amazon RDS db.t4g.small (multi-AZ) + RDS Proxy
Phase 3  →  Amazon RDS Aurora PostgreSQL Serverless v2 + read replicas
```

### RDS Proxy vs PgBouncer

| Feature | PgBouncer | RDS Proxy |
|---|---|---|
| Managed | No (self-hosted) | Yes (AWS managed) |
| Cost | Free | ~$15–30/mo |
| IAM auth support | No | Yes |
| Secrets Manager integration | No | Yes |
| Multi-AZ failover | Manual config | Automatic |
| Works with Lambda | Complex | Native |
| Transaction mode support | Yes | Yes |

**Recommendation:**
- Phase 1–2: PgBouncer (free, good enough)
- Phase 3 with RDS Aurora: Switch to RDS Proxy (native, fully managed)

### Aurora Serverless v2 — When to Consider

Aurora Serverless v2 auto-scales ACUs (Aurora Capacity Units) from 0.5 to 128 ACUs. At low usage you pay almost nothing; during peak COGS recalculation across all markets it scales instantly.

**Cost:** ~$0.12/ACU-hour. At 2 ACUs min → ~$10/mo baseline + burst.

**Recommended when:** 10+ concurrent franchise tenants, 1M+ price quotes, or complex cross-tenant reporting queries.

---

## 9. PgBouncer — Connection Pooling

### The Problem PgBouncer Solves

PostgreSQL spawns one OS process per connection (~5–10MB RAM each). At 100 concurrent API requests, PostgreSQL is managing 100 processes. At 200 requests, it hits the default `max_connections = 100` limit and new connections are rejected.

PgBouncer sits between Express and PostgreSQL. Express talks to PgBouncer (opens 200 client connections). PgBouncer maintains only 20 server connections to PostgreSQL, multiplexing traffic.

```
Express workers (200 connections)
        ↓
    PgBouncer
        ↓ (20 connections)
    PostgreSQL
```

### Pooling Modes

| Mode | How it works | Best for |
|---|---|---|
| **Session** | One server connection per client session | Apps using SET, LISTEN, temp tables |
| **Transaction** | Server connection held only during a transaction | Most stateless REST APIs ← use this |
| **Statement** | One statement per server connection | Rarely used — breaks multi-statement transactions |

**This app should use Transaction mode** — Express is stateless, no session variables (after Phase 1 JWT validation), no LISTEN/NOTIFY.

### What Breaks in Transaction Mode

If you add these features later, you must switch to Session mode or route those queries differently:

- `SET` / `SET LOCAL` (session variables) → Use `SET LOCAL` inside explicit transactions
- `LISTEN` / `NOTIFY` (real-time events) → Use a dedicated long-lived connection outside PgBouncer
- Prepared statements (`$1` params) → Disable with `server_reset_query` or use `pgbouncer_prepared_statements=0`
- `pg_advisory_lock` → Requires session mode
- `TEMP TABLE` → Requires session mode

### Installation on Ubuntu Lightsail

```bash
sudo apt update && sudo apt install -y pgbouncer

sudo nano /etc/pgbouncer/pgbouncer.ini
```

**`/etc/pgbouncer/pgbouncer.ini`:**
```ini
[databases]
mcogs = host=127.0.0.1 port=5432 dbname=mcogs

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 5432        ; PgBouncer takes port 5432, PG moves to 5433
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 200
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
reserve_pool_timeout = 3
server_idle_timeout = 600
log_connections = 0
log_disconnections = 0
```

**Move PostgreSQL to port 5433:**
```bash
sudo nano /etc/postgresql/16/main/postgresql.conf
# Change: port = 5432  →  port = 5433

sudo systemctl restart postgresql
```

**`/etc/pgbouncer/userlist.txt`:**
```
"mcogs" "md5<md5hash_of_password>"
```

**Generate the hash:**
```bash
echo -n "passwordmcogs" | md5sum
# Prepend 'md5' to the result
```

**Update `api/.env`:**
```env
DB_PORT=5432   ; PgBouncer port — unchanged from app's perspective
```

**Start PgBouncer:**
```bash
sudo systemctl enable pgbouncer
sudo systemctl start pgbouncer
```

---

## 10. API & Compute Scaling

### Current Bottlenecks

1. **Single Node.js process** — PM2 manages one worker. CPU-bound COGS calculations block all requests.
2. **Synchronous database queries** — No connection pooling (pre-PgBouncer).
3. **No HTTP caching headers** — Every identical request hits the DB.

### PM2 Cluster Mode (Phase 1)

Run one worker per CPU core using Node.js cluster module via PM2. Dramatically increases throughput for I/O-bound Express routes.

```javascript
// pm2.config.cjs
module.exports = {
  apps: [{
    name: 'menu-cogs-api',
    script: 'src/index.js',
    instances: 'max',
    exec_mode: 'cluster',
  }]
}
```

### ECS Fargate (Phase 2)

Replace PM2 on Lightsail with containerised API on ECS Fargate:

```
CloudFront (HTTPS) → ALB → ECS Fargate (1–10 tasks)
                              ↓
                         RDS PostgreSQL
                              ↑
                         ElastiCache Redis
```

**Autoscaling policy:**
- Scale out: CPU > 60% for 2 minutes → add 1 task
- Scale in: CPU < 20% for 10 minutes → remove 1 task
- Minimum: 1 task (always-on for zero cold-start latency)

### HTTP Cache Headers

Add cache headers to read-only endpoints that change infrequently:

```javascript
// In route handlers for lists that rarely change:
router.get('/units', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');  // 5 min client cache
  // ...
});

router.get('/price-levels', async (req, res) => {
  res.set('Cache-Control', 'private, max-age=300');
  // ...
});
```

---

## 11. COGS Calculation Engine Redesign

### Current State

COGS is calculated in real-time via `cogs.js` when the `/api/cogs` endpoint is called. For each call:
1. Fetch all recipe items for the menu
2. For each ingredient → find preferred vendor quote → get price per base unit
3. Apply waste % → calculate cost per recipe portion
4. Recurse for sub-recipes
5. Apply exchange rate conversion per market
6. Apply tax per price level

**Problem:** A menu with 20 recipes × 10 ingredients each = 200+ DB queries. At 50 markets, recalculating everything = 10,000+ queries.

### Phase 2 — Materialised View

Add a PostgreSQL materialised view that pre-calculates COGS per recipe per market. Refresh it on a schedule or on-demand after price changes.

```sql
CREATE MATERIALIZED VIEW mcogs_cogs_summary AS
SELECT
  ri.recipe_id,
  ipv.country_id,
  SUM(
    (ri.qty_in_base_units / NULLIF(pq.qty_in_base_units, 0)) * pq.purchase_price
    * (1 + COALESCE(i.waste_pct, 0) / 100.0)
    / c.exchange_rate
  ) AS cost_usd
FROM mcogs_recipe_items ri
JOIN mcogs_ingredients i ON i.id = ri.ingredient_id
JOIN mcogs_ingredient_preferred_vendor ipv ON ipv.ingredient_id = ri.ingredient_id
JOIN mcogs_price_quotes pq ON pq.id = ipv.quote_id AND pq.is_active = TRUE
JOIN mcogs_countries c ON c.id = ipv.country_id
GROUP BY ri.recipe_id, ipv.country_id;

CREATE UNIQUE INDEX ON mcogs_cogs_summary(recipe_id, country_id);
```

**Refresh triggers:**

```javascript
// After any price quote write:
await pool.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY mcogs_cogs_summary`);
```

`CONCURRENTLY` means reads are not blocked during refresh. Requires the unique index above.

### Phase 3 — Async Queue

For tenants with large datasets, move even the materialised view refresh to a Bull queue. See [Section 6.4](#64-async-cogs-calculation-queue).

---

## 12. Auth Hardening — JWT + RBAC

### JWT Validation Flow

```
Browser → Auth0 → JWT (RS256)
Browser → POST /api/... (Authorization: Bearer <token>)
Express middleware → Fetch Auth0 JWKS → Verify signature + expiry
Express → Extract: sub (user), org (tenant), roles (claims)
Express → SET app.tenant_id, SET app.user_id → Route handler
```

### Auth0 Custom Claims

Add tenant ID and roles to the JWT via an Auth0 Action (Post Login trigger):

```javascript
// Auth0 Action — runs after every login
exports.onExecutePostLogin = async (event, api) => {
  const namespace = 'https://mcogs.com';
  api.idToken.setCustomClaim(`${namespace}/tenant_id`, event.organization?.id);
  api.accessToken.setCustomClaim(`${namespace}/tenant_id`, event.organization?.id);
  api.accessToken.setCustomClaim(`${namespace}/roles`, event.authorization?.roles ?? []);
};
```

### Express Role Guard Middleware

```javascript
// middleware/requireRole.js
module.exports = function requireRole(...roles) {
  return (req, res, next) => {
    const userRoles = req.auth?.['https://mcogs.com/roles'] ?? [];
    if (roles.some(r => userRoles.includes(r))) return next();
    return res.status(403).json({ error: { message: 'Insufficient permissions' } });
  };
};

// Usage in routes:
router.delete('/:id', requireRole('franchise_admin', 'super_admin'), async (req, res) => {
  // Only admins can delete
});
```

---

## 13. Frontend CDN & Static Delivery

### Phase 2 — S3 + CloudFront

```
User → CloudFront edge (50+ global PoPs)
          → S3 bucket (React build assets)
          → CloudFront origin for /api/* → ALB → ECS API
```

**Benefits for franchise operators across multiple markets:**
- UK user hits London edge (low latency)
- US user hits Virginia edge (low latency)
- Same API in `eu-west-2` for all — data residency stays in one region

**CloudFront behaviour rules:**

| Path | Behaviour |
|---|---|
| `/api/*` | Forward to ALB (no caching) |
| `/*.js`, `/*.css` | Cache 1 year (content-hashed filenames) |
| `/index.html` | Cache 0 seconds (always latest SPA shell) |
| `/*` | Default to `/index.html` (SPA routing) |

---

## 14. Key SQL Optimisations

### Composite Indexes for Common Query Patterns

```sql
-- Price quotes: most queries filter by ingredient + active flag
CREATE INDEX CONCURRENTLY idx_pq_ingredient_active
  ON mcogs_price_quotes(ingredient_id, is_active)
  WHERE is_active = TRUE;

-- Preferred vendor: ingredient+country lookup is very hot
CREATE UNIQUE INDEX CONCURRENTLY idx_pv_ingredient_country
  ON mcogs_ingredient_preferred_vendor(ingredient_id, country_id);

-- Recipe items: always queried by recipe_id
CREATE INDEX CONCURRENTLY idx_ri_recipe_ingredient
  ON mcogs_recipe_items(recipe_id, ingredient_id);

-- Menu items: menu lookup
CREATE INDEX CONCURRENTLY idx_mi_menu_recipe
  ON mcogs_menu_items(menu_id, recipe_id);

-- Price per level: menu item + level lookups
CREATE INDEX CONCURRENTLY idx_mip_item_level
  ON mcogs_menu_item_prices(menu_item_id, price_level_id);
```

> `CONCURRENTLY` creates the index without locking the table — safe on production.

### EXPLAIN ANALYZE — Profiling Slow Queries

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT ri.*, pq.purchase_price, pq.qty_in_base_units
FROM mcogs_recipe_items ri
JOIN mcogs_ingredient_preferred_vendor ipv ON ipv.ingredient_id = ri.ingredient_id AND ipv.country_id = 3
JOIN mcogs_price_quotes pq ON pq.id = ipv.quote_id
WHERE ri.recipe_id = 42;
```

Look for:
- `Seq Scan` on large tables → add index
- `Hash Join` with high `Rows` estimate → check statistics with `ANALYZE`
- High `Buffers: shared hit=...` → working set fits in memory (good)
- High `Buffers: shared read=...` → reading from disk (increase `shared_buffers`)

### PostgreSQL Configuration Tuning (for 4GB RAM Lightsail)

In `/etc/postgresql/16/main/postgresql.conf`:

```ini
shared_buffers          = 1GB          # 25% of RAM
effective_cache_size    = 3GB          # 75% of RAM (hint for planner)
work_mem                = 16MB         # Per sort/hash operation
maintenance_work_mem    = 256MB        # For VACUUM, CREATE INDEX
max_connections         = 50           # Reduce — PgBouncer handles the rest
checkpoint_completion_target = 0.9
wal_buffers             = 16MB
random_page_cost        = 1.1          # SSD — lower than default 4.0
effective_io_concurrency = 200         # SSD concurrent I/O
```

Apply and reload:
```bash
sudo systemctl reload postgresql
```

---

## 15. Cost Estimates by Phase

### Phase 1 — Hardening

| Item | Current | After Phase 1 | Delta |
|---|---|---|---|
| Lightsail instance | $10/mo | $20/mo (upgraded) | +$10 |
| PgBouncer | — | $0 (runs on same box) | $0 |
| Auth0 | Free tier | Free tier (≤1,000 MAU) | $0 |
| S3 backups | $0 | ~$1/mo | +$1 |
| **Total** | **$10/mo** | **~$21/mo** | **+$11** |

---

### Phase 2 — Scale

| Item | Cost/mo | Notes |
|---|---|---|
| RDS db.t4g.small (multi-AZ) | ~$50 | Managed PG, automated backups, failover |
| ECS Fargate (1–3 tasks baseline) | ~$20–40 | 0.5 vCPU, 1GB RAM per task |
| ElastiCache Redis `cache.t4g.micro` | ~$12 | COGS cache, session cache |
| ALB (Application Load Balancer) | ~$18 | Fixed + per-LCU |
| CloudFront + S3 | ~$3–5 | Static hosting + CDN |
| Lightsail (decommissioned) | $0 | Eliminated |
| **Total** | **~$100–130/mo** | Handles 200+ concurrent users |

---

### Phase 3 — Enterprise

| Item | Cost/mo | Notes |
|---|---|---|
| RDS Aurora Serverless v2 | ~$30–100 | Scales with load (2–16 ACUs) |
| RDS read replica | ~$30 | Reporting queries |
| RDS Proxy | ~$20 | Replaces PgBouncer |
| ECS Fargate (autoscaling) | ~$50–150 | 2–10 tasks |
| ElastiCache Redis (cluster) | ~$30 | Multi-node |
| ALB | ~$18 | |
| CloudFront + S3 | ~$5–15 | Higher traffic |
| Bull queue workers (ECS) | ~$15 | COGS recalc workers |
| Auth0 (B2B plan) | ~$150+ | Multi-org, RBAC, SSO |
| CloudWatch + alerting | ~$10 | Monitoring |
| **Total** | **~$350–550/mo** | Full multi-tenant SaaS |

---

## Quick Reference — Decision Points

| Question | Answer |
|---|---|
| When to add PgBouncer? | **Now (Phase 1)** — before any production traffic |
| When to move DB to RDS? | When you add a second franchise tenant or need point-in-time restore |
| When to containerise the API? | When you need zero-downtime deploys or >40 concurrent users |
| When to add Redis? | When COGS calculations are noticeably slow (>2s) |
| When to add multi-tenancy? | Before onboarding a second independent franchise group |
| When to switch to Aurora? | When RDS storage or read IOPS become the bottleneck |
| When is Auth0 B2B plan needed? | When tenants need their own SSO (Okta/Azure AD) |

---

*Last updated: March 2026*
