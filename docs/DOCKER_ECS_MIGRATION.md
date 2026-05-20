# Docker + ECS Migration Plan

> **Status:** Approved design. Not yet implemented.
> **Date:** April 2026
> **Complements:** [`ENTERPRISE_SCALE.md`](./ENTERPRISE_SCALE.md) Phase 2 — this doc is the concrete implementation guide.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current vs Target Architecture](#2-current-vs-target-architecture)
3. [Dockerfile Design](#3-dockerfile-design)
4. [Config Store Decision](#4-config-store-decision)
5. [AWS Infrastructure](#5-aws-infrastructure)
6. [ECS Task Definitions](#6-ecs-task-definitions)
7. [Database Migration to RDS](#7-database-migration-to-rds)
8. [Frontend Delivery — S3 + CloudFront](#8-frontend-delivery--s3--cloudfront)
9. [Secrets Management](#9-secrets-management)
10. [CI/CD Pipeline Rewrite](#10-cicd-pipeline-rewrite)
11. [SSE + ALB Configuration](#11-sse--alb-configuration)
12. [Cron Jobs as Scheduled Tasks](#12-cron-jobs-as-scheduled-tasks)
13. [File Uploads — S3 Only](#13-file-uploads--s3-only)
14. [Code Changes Required](#14-code-changes-required)
15. [Migration Runbook](#15-migration-runbook)
16. [Rollback Strategy](#16-rollback-strategy)
17. [Cost Estimate](#17-cost-estimate)
18. [Risk Register](#18-risk-register)

---

## 1. Executive Summary

Migrate from a single Lightsail instance ($10/mo) to a production-grade AWS stack:

| Component | Current | Target |
|---|---|---|
| **API** | PM2 on bare metal | ECS Fargate (auto-scaling) |
| **Frontend** | Nginx on same box | S3 + CloudFront CDN |
| **Database** | PostgreSQL on same box | AWS RDS (managed) |
| **Uploads** | Local disk | S3 |
| **Secrets** | `.env` file | AWS Secrets Manager |
| **CI/CD** | SSH + SCP | Docker build → ECR → ECS deploy |
| **SSL** | Certbot | ACM (auto-renewing) |
| **Load Balancer** | None (Nginx reverse proxy) | Application Load Balancer |

**Estimated effort:** 5-7 days across 3 phases.
**Estimated monthly cost:** $50-80/mo at baseline (see Section 17).

---

## 2. Current vs Target Architecture

### Current (Single Box)

```
Internet → Nginx (SSL) → Express API (port 3001) → PostgreSQL (localhost)
                       → Static frontend (/frontend/)
                       → Local uploads (/uploads/)
```

### Target (AWS Managed)

```
Internet → CloudFront → S3 (frontend static assets)
        → ALB (HTTPS via ACM) → ECS Fargate Service (port 3001)
                                  ↓
                               RDS PostgreSQL (private subnet)
                               S3 (uploads bucket)
                               Secrets Manager
                               CloudWatch Logs

CloudWatch Events → ECS Scheduled Task (memory consolidation cron)
```

---

## 3. Dockerfile Design

### API Dockerfile (`api/Dockerfile`)

Multi-stage build for minimal image size:

```dockerfile
# ── Stage 1: Build ───────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
# sharp needs native binaries — install separately for alpine
RUN npm rebuild sharp

# ── Stage 2: Runtime ─────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# curl for health check
RUN apk add --no-cache curl

# Copy production dependencies only
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
COPY src/ ./src/
COPY scripts/ ./scripts/

# RDS CA bundle for SSL connections
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds/global-bundle.pem

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

CMD ["node", "src/index.js"]
```

**Image size target:** ~180MB (alpine + node_modules + sharp native).

### Frontend Build (in CI, not a container)

The frontend is static HTML/JS/CSS — no container needed. Built in CI, pushed to S3.

---

## 4. Config Store Decision

The two-database architecture (`mcogs_config` + `mcogs`) is the biggest migration challenge. `mcogs_config` currently assumes localhost.

### Option A: Eliminate Config Store (Recommended)

Move all config-store values to **AWS Secrets Manager** and environment variables. The config store exists because the app needed encrypted storage on a single box — AWS Secrets Manager replaces that need entirely.

**Changes required:**
- `api/src/db/config.js` — read DB credentials from env vars directly (already supported via `DB_HOST`, `DB_PASSWORD`, etc.)
- `api/src/helpers/agenticStream.js` / `ai-chat.js` — read `ANTHROPIC_API_KEY` from env var instead of config store
- `api/src/routes/ai-config.js` — read/write AI keys from Secrets Manager (or make them env-var-only, configured in ECS task)
- Remove `api/src/config-store/` dependency from startup path
- Keep config store code in repo for backward compatibility with local dev

**Pros:** No second database, simpler architecture, secrets managed properly.
**Cons:** Loses the UI-based "Settings → Database" switch (admin switches DB mode from the browser). This feature would need to be removed or adapted for ECS.

### Option B: Config Store on RDS

Create `mcogs_config` as a second database on the same RDS instance. Change `config-store/pool.js` to accept `CONFIG_DB_HOST` from env vars instead of hardcoding localhost.

**Pros:** Zero functional changes, UI database switching still works.
**Cons:** Two databases on RDS, config store holds encrypted secrets alongside unencrypted RDS access — layered encryption is redundant when Secrets Manager exists.

### Recommendation

**Option A for production ECS, Option B for development.** The Settings → Database UI is a dev/admin tool — in production ECS, the infrastructure is managed via IaC (Terraform/CDK), not a browser UI.

---

## 5. AWS Infrastructure

### VPC Layout

```
VPC: 10.0.0.0/16
├── Public Subnets (2 AZs)
│   ├── 10.0.1.0/24 (eu-west-2a) — ALB, NAT Gateway
│   └── 10.0.2.0/24 (eu-west-2b) — ALB
├── Private Subnets (2 AZs)
│   ├── 10.0.10.0/24 (eu-west-2a) — ECS tasks, RDS primary
│   └── 10.0.20.0/24 (eu-west-2b) — ECS tasks, RDS standby
```

### Security Groups

| SG | Inbound | Source |
|---|---|---|
| `sg-alb` | 443 (HTTPS) | 0.0.0.0/0 |
| `sg-ecs` | 3001 (API) | `sg-alb` only |
| `sg-rds` | 5432 (PostgreSQL) | `sg-ecs` only |

### AWS Services Required

| Service | Purpose | Config |
|---|---|---|
| **ECR** | Docker image registry | 1 repository: `menu-cogs-api` |
| **ECS Fargate** | Container runtime | 1 service, min 1 / max 4 tasks |
| **ALB** | Load balancer + SSL termination | HTTPS listener, ACM cert |
| **RDS PostgreSQL 16** | Managed database | `db.t4g.small` (2 vCPU, 2GB), Multi-AZ optional |
| **S3** | Frontend hosting + uploads | 2 buckets: `cogs-frontend`, `cogs-uploads` |
| **CloudFront** | CDN for frontend | Origin: S3 bucket |
| **ACM** | SSL certificate | `cogs.macaroonie.com`, `api.cogs.macaroonie.com` |
| **Secrets Manager** | Credentials storage | DB password, API keys, signing secrets |
| **CloudWatch** | Logs + alarms | Log group: `/ecs/menu-cogs-api` |
| **Route 53** | DNS (if migrating from Lightsail DNS) | A/ALIAS records to ALB + CloudFront |

---

## 6. ECS Task Definitions

### API Service Task

```json
{
  "family": "menu-cogs-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::ACCOUNT:role/ecsTaskRole",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "ACCOUNT.dkr.ecr.eu-west-2.amazonaws.com/menu-cogs-api:latest",
      "portMappings": [{ "containerPort": 3001, "protocol": "tcp" }],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3001" },
        { "name": "DB_MODE", "value": "standalone" },
        { "name": "DB_HOST", "value": "mcogs.xxxxx.eu-west-2.rds.amazonaws.com" },
        { "name": "DB_PORT", "value": "5432" },
        { "name": "DB_NAME", "value": "mcogs" },
        { "name": "DB_USER", "value": "mcogs" },
        { "name": "DB_SSL", "value": "true" },
        { "name": "DB_SSL_CA", "value": "/etc/ssl/rds/global-bundle.pem" },
        { "name": "DB_SSL_REJECT_UNAUTHORIZED", "value": "true" },
        { "name": "CORS_ORIGIN", "value": "https://cogs.macaroonie.com" },
        { "name": "APP_URL", "value": "https://cogs.macaroonie.com" },
        { "name": "DISABLE_CRON", "value": "true" }
      ],
      "secrets": [
        { "name": "DB_PASSWORD", "valueFrom": "arn:aws:secretsmanager:...:mcogs-db-password" },
        { "name": "CONFIG_STORE_SECRET", "valueFrom": "arn:aws:secretsmanager:...:config-store-secret" },
        { "name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:...:anthropic-key" },
        { "name": "USDA_API_KEY", "valueFrom": "arn:aws:secretsmanager:...:usda-key" },
        { "name": "SHARED_PAGE_SECRET", "valueFrom": "arn:aws:secretsmanager:...:shared-page-secret" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/menu-cogs-api",
          "awslogs-region": "eu-west-2",
          "awslogs-stream-prefix": "api"
        }
      }
    }
  ]
}
```

### Migration Task (one-off)

Same image, different command:

```json
{
  "family": "menu-cogs-migrate",
  "containerDefinitions": [{
    "name": "migrate",
    "command": ["node", "scripts/migrate.js"],
    "essential": true
  }]
}
```

Run before each deploy: `aws ecs run-task --task-definition menu-cogs-migrate`.

### Memory Consolidation Scheduled Task

```json
{
  "family": "menu-cogs-consolidate",
  "cpu": "256",
  "memory": "512",
  "containerDefinitions": [{
    "name": "consolidate",
    "command": ["node", "-e", "require('./src/jobs/consolidateMemory.js').run()"],
    "essential": true
  }]
}
```

Triggered by CloudWatch Events rule: `cron(7 2 * * ? *)` (02:07 UTC daily).

---

## 7. Database Migration to RDS

### RDS Instance Configuration

| Setting | Value |
|---|---|
| Engine | PostgreSQL 16 |
| Instance | `db.t4g.small` (2 vCPU, 2GB RAM) — upgrade to `db.t4g.medium` when needed |
| Storage | 20GB gp3, autoscale to 100GB |
| Multi-AZ | No (start single-AZ, enable later for HA) |
| Backup | 7-day retention, automated daily |
| Encryption | At rest (AWS KMS), in transit (SSL enforced) |
| Security Group | Port 5432 from ECS SG only |
| Parameter Group | `rds-pg16-cogs` — `max_connections: 200`, `shared_buffers: 512MB` |

### Data Migration Steps

1. On Lightsail: `pg_dump -Fc -U mcogs mcogs > mcogs_backup.dump`
2. Create RDS instance via console/CLI
3. Restore: `pg_restore -h rds-endpoint -U mcogs -d mcogs mcogs_backup.dump`
4. Verify table count: `SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'mcogs_%'` → expect 82
5. Run migration: `npm run migrate` against RDS to ensure schema is current
6. Test from local: point `DB_HOST` at RDS, confirm app works

### Connection Pooling

For 1-4 ECS tasks with `DB_POOL_MAX=10` each, max connections = 40. RDS `db.t4g.small` supports 200 connections. No PgBouncer needed initially.

If scaling beyond 10 tasks, add **RDS Proxy** ($0.015/vCPU-hour) for connection multiplexing.

---

## 8. Frontend Delivery — S3 + CloudFront

### S3 Bucket: `cogs-frontend`

- Static website hosting enabled
- Block all public access (CloudFront uses OAC)
- Bucket policy: allow `s3:GetObject` from CloudFront distribution only

### CloudFront Distribution

| Setting | Value |
|---|---|
| Origin | S3 bucket `cogs-frontend` |
| Alternate domain | `cogs.macaroonie.com` |
| Certificate | ACM cert for `cogs.macaroonie.com` |
| Default root object | `index.html` |
| Error pages | 403/404 → `/index.html` (SPA routing) |
| Cache policy | CachingOptimized for static assets, disabled for `index.html` |
| Compression | Gzip + Brotli |

### API Routing

Two approaches:

**Option A: Subdomain split (recommended)**
- `cogs.macaroonie.com` → CloudFront → S3 (frontend)
- `api.cogs.macaroonie.com` → ALB → ECS (API)
- Frontend env var: `VITE_API_URL=https://api.cogs.macaroonie.com/api`

**Option B: Path-based routing (single domain)**
- `cogs.macaroonie.com` → CloudFront
  - `/api/*` behaviour → ALB origin
  - Everything else → S3 origin
- More complex CloudFront config, but no CORS issues

**Recommendation:** Option A — cleaner separation, simpler cache rules.

---

## 9. Secrets Management

### AWS Secrets Manager Entries

| Secret Name | Value | Used By |
|---|---|---|
| `mcogs/db-password` | PostgreSQL password | ECS task env |
| `mcogs/config-store-secret` | 64-hex AES key | ECS task env |
| `mcogs/anthropic-key` | Anthropic API key | ECS task env |
| `mcogs/usda-key` | USDA API key | ECS task env |
| `mcogs/shared-page-secret` | Signing key for public URLs | ECS task env |
| `mcogs/brave-search-key` | Brave Search API key (optional) | ECS task env |
| `mcogs/github-pat` | GitHub PAT (optional) | ECS task env |

**Cost:** $0.40/secret/month × 7 = ~$2.80/mo + $0.05 per 10,000 API calls.

### IAM Roles

**Task Execution Role** (`ecsTaskExecutionRole`):
- `secretsmanager:GetSecretValue` for all `mcogs/*` secrets
- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`
- `logs:CreateLogStream`, `logs:PutLogEvents`

**Task Role** (`ecsTaskRole`):
- `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on `cogs-uploads` bucket
- No RDS IAM auth (use password from Secrets Manager)

---

## 10. CI/CD Pipeline Rewrite

### New `.github/workflows/deploy.yml`

```yaml
name: Deploy to ECS

on:
  push:
    branches: [main]
  workflow_dispatch:

env:
  AWS_REGION: eu-west-2
  ECR_REPO: menu-cogs-api
  ECS_CLUSTER: menu-cogs
  ECS_SERVICE: menu-cogs-api
  S3_FRONTEND: cogs-frontend
  CLOUDFRONT_ID: EXXXXXXXXXX

jobs:
  # ── Build & Push API Docker Image ──────────────────────────
  api:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Login to ECR
        uses: aws-actions/amazon-ecr-login@v2

      - name: Build and push Docker image
        working-directory: api
        run: |
          IMAGE=${{ secrets.AWS_ACCOUNT_ID }}.dkr.ecr.${{ env.AWS_REGION }}.amazonaws.com/${{ env.ECR_REPO }}
          docker build -t $IMAGE:${{ github.sha }} -t $IMAGE:latest .
          docker push $IMAGE:${{ github.sha }}
          docker push $IMAGE:latest

      - name: Run database migration
        run: |
          aws ecs run-task \
            --cluster ${{ env.ECS_CLUSTER }} \
            --task-definition menu-cogs-migrate \
            --launch-type FARGATE \
            --network-configuration "awsvpcConfiguration={subnets=[${{ secrets.PRIVATE_SUBNET_A }}],securityGroups=[${{ secrets.ECS_SG }}]}" \
            --overrides '{"containerOverrides":[{"name":"migrate","image":"'$IMAGE:${{ github.sha }}'"}]}'
          # Wait for migration task to complete
          aws ecs wait tasks-stopped --cluster ${{ env.ECS_CLUSTER }} --tasks $(aws ecs list-tasks --cluster ${{ env.ECS_CLUSTER }} --family menu-cogs-migrate --query 'taskArns[0]' --output text)

      - name: Deploy to ECS
        run: |
          aws ecs update-service \
            --cluster ${{ env.ECS_CLUSTER }} \
            --service ${{ env.ECS_SERVICE }} \
            --force-new-deployment

      - name: Wait for stable deployment
        run: |
          aws ecs wait services-stable \
            --cluster ${{ env.ECS_CLUSTER }} \
            --services ${{ env.ECS_SERVICE }}

  # ── Build & Deploy Frontend ────────────────────────────────
  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install and build
        working-directory: app
        env:
          VITE_AUTH0_DOMAIN: ${{ secrets.VITE_AUTH0_DOMAIN }}
          VITE_AUTH0_CLIENT_ID: ${{ secrets.VITE_AUTH0_CLIENT_ID }}
          VITE_AUTH0_AUDIENCE: ''
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
        run: |
          npm ci
          npm run build

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: ${{ env.AWS_REGION }}

      - name: Sync to S3
        run: |
          aws s3 sync app/dist/ s3://${{ env.S3_FRONTEND }}/ --delete
          # Cache index.html for 0s (always fetch latest), assets for 1 year
          aws s3 cp s3://${{ env.S3_FRONTEND }}/index.html s3://${{ env.S3_FRONTEND }}/index.html \
            --cache-control "no-cache, no-store, must-revalidate"

      - name: Invalidate CloudFront
        run: |
          aws cloudfront create-invalidation \
            --distribution-id ${{ env.CLOUDFRONT_ID }} \
            --paths "/index.html"

  # ── Health Check ───────────────────────────────────────────
  health:
    needs: [api, frontend]
    runs-on: ubuntu-latest
    steps:
      - name: Health check
        run: |
          sleep 10
          curl --fail --silent --max-time 10 \
            https://api.cogs.macaroonie.com/api/health \
            | grep '"status":"ok"' \
            && echo "✔ Health check passed" \
            || (echo "✘ Health check failed" && exit 1)
```

### New GitHub Secrets Required

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | IAM deploy user access key |
| `AWS_SECRET_ACCESS_KEY` | IAM deploy user secret key |
| `AWS_ACCOUNT_ID` | AWS account number |
| `PRIVATE_SUBNET_A` | Private subnet ID for ECS tasks |
| `ECS_SG` | ECS security group ID |
| `VITE_API_URL` | `https://api.cogs.macaroonie.com/api` |
| Existing Auth0 secrets | Same as current |

---

## 11. SSE + ALB Configuration

The AI chat and file upload endpoints use Server-Sent Events (SSE) with 10-second keepalive pings.

### ALB Settings

| Setting | Value | Why |
|---|---|---|
| Idle timeout | 120 seconds | SSE responses can take 30-60s for complex tool chains |
| Target group deregistration delay | 120 seconds | Allow in-flight SSE streams to complete during deploy |
| Stickiness | Disabled | SSE requests are stateless (no session affinity needed) |
| Health check path | `/api/health` | |
| Health check interval | 30s | |
| Healthy threshold | 2 | |
| Unhealthy threshold | 3 | |

### No WebSocket Upgrade Needed

The app uses SSE (unidirectional server→client), not WebSocket. ALB handles SSE natively over HTTP/1.1 — no protocol upgrade required.

---

## 12. Cron Jobs as Scheduled Tasks

### Problem

The memory consolidation job (`node-cron` at 02:07 UTC) runs inside the Express process. With multiple ECS tasks, it would run N times per day.

### Solution

1. Add `DISABLE_CRON` env var check in `api/src/index.js`:
   ```javascript
   if (process.env.DISABLE_CRON !== 'true') {
     cron.schedule('7 2 * * *', () => consolidateMemory());
   }
   ```
2. Set `DISABLE_CRON=true` in ECS API task definition
3. Create a CloudWatch Events rule → ECS scheduled task:
   - Schedule: `cron(7 2 * * ? *)`
   - Target: ECS task `menu-cogs-consolidate`
   - Single execution (no parallel runs)

---

## 13. File Uploads — S3 Only

In ECS, there is no persistent local disk. All uploads must go to S3.

### Changes Required

1. Set storage config to S3 mode (already supported — `mcogs_settings.data.storage.type = 's3'`)
2. S3 credentials via IAM task role (no access key needed — use instance role)
3. Modify `upload.js` and `media.js` to use IAM-based S3 client when no explicit key is provided
4. Run one-time migration of existing local files via `POST /api/media/migrate-to-s3`

### S3 Bucket: `cogs-uploads`

- Private (no public access)
- Lifecycle: transition to IA after 90 days, Glacier after 365 days
- Versioning: enabled (protects against accidental deletion)

### Serving Uploads

Two options:
- **Option A:** Proxy through API (`GET /api/media/img/:filename` → S3 GetObject → pipe to response) — current pattern, works as-is
- **Option B:** CloudFront → S3 with signed URLs — better performance, needs code change

Start with Option A (zero code change), migrate to B later if performance requires it.

---

## 14. Code Changes Required

### Must Change (blocking)

| File | Change | Reason |
|---|---|---|
| `api/src/index.js:59` | `app.listen(PORT)` — remove `'127.0.0.1'` host binding | ALB can't reach loopback |
| `api/src/index.js:66` | Wrap cron in `DISABLE_CRON` check | Prevent duplicate cron in multi-task |
| `api/src/jobs/consolidateMemory.js` | Export `run()` function for standalone execution | ECS scheduled task entry point |
| `api/Dockerfile` | Create (see Section 3) | Container image |
| `.github/workflows/deploy.yml` | Rewrite (see Section 10) | ECR + ECS deploy |
| `.dockerignore` | Create: `node_modules`, `.env`, `.git`, `app/` | Keep image lean |

### Should Change (recommended)

| File | Change | Reason |
|---|---|---|
| `api/src/db/config.js` | Accept `DB_SSL_CA` env var for RDS CA bundle path | Secure RDS connection |
| `api/src/routes/upload.js` | Fall back to IAM role when no S3 keys configured | ECS uses task role, not access keys |
| `api/src/routes/media.js` | Same IAM role fallback for S3 client | Consistent with upload.js |

### Optional (can defer)

| File | Change | Reason |
|---|---|---|
| Config store elimination | Refactor `ai-config.js` to read from env vars | Simplify architecture (see Section 4) |
| `api/src/routes/db-config.js` | Disable or hide in ECS mode | DB switching via UI doesn't apply in ECS |

---

## 15. Migration Runbook

### Phase 1: Containerise (Day 1-2)

1. Create `api/Dockerfile` and `api/.dockerignore`
2. Change `index.js` listen binding to `0.0.0.0`
3. Add `DISABLE_CRON` check
4. Export `consolidateMemory.run()`
5. Build and test locally: `docker build -t menu-cogs-api . && docker run -p 3001:3001 --env-file .env menu-cogs-api`
6. Verify health check: `curl http://localhost:3001/api/health`

### Phase 2: AWS Infrastructure (Day 3-4)

1. Create VPC, subnets, security groups (or use default VPC for simplicity)
2. Create RDS PostgreSQL 16 instance
3. Migrate data: `pg_dump` from Lightsail → `pg_restore` to RDS
4. Run `npm run migrate` against RDS
5. Create ECR repository, push Docker image
6. Create ECS cluster, task definitions, service
7. Create ALB, target group, HTTPS listener (ACM cert)
8. Create S3 buckets (frontend + uploads)
9. Create CloudFront distribution
10. Create Secrets Manager entries
11. Update DNS: `api.cogs.macaroonie.com` → ALB, `cogs.macaroonie.com` → CloudFront

### Phase 3: CI/CD + Cutover (Day 5-6)

1. Rewrite `deploy.yml` for ECR/ECS
2. Update GitHub Secrets
3. Update Auth0 callback URLs (add new domain if changed)
4. Migrate local uploads to S3 (`POST /api/media/migrate-to-s3`)
5. Set up CloudWatch Events rule for memory consolidation cron
6. Push to `main` — verify end-to-end deploy
7. Smoke test: login, create ingredient, run COGS, check Pepper
8. Monitor CloudWatch logs for 24h
9. Decommission Lightsail instance (keep snapshot for 30 days)

### Phase 4: Post-Migration (Day 7)

1. Set up CloudWatch alarms (CPU >70%, error rate >5%, unhealthy hosts)
2. Configure ECS auto-scaling (CPU target 60%, min 1, max 4)
3. Enable RDS automated backups
4. Test rollback: deploy previous image tag
5. Update CLAUDE.md infrastructure section

---

## 16. Rollback Strategy

### API Rollback

```bash
# Deploy previous image
aws ecs update-service --cluster menu-cogs --service menu-cogs-api \
  --task-definition menu-cogs-api:<previous-revision>
```

ECS rolling deployment ensures zero downtime. Previous task definition revision always available.

### Database Rollback

Migrations are forward-only (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`). If a migration breaks:
1. Restore from RDS automated backup (point-in-time, up to 5 minutes ago)
2. Or restore from manual snapshot taken before deploy

### Full Rollback to Lightsail

Keep Lightsail instance running (but stopped) for 30 days after migration. DNS switch back takes 5 minutes.

---

## 17. Cost Estimate

### Baseline (minimal traffic)

| Service | Spec | Monthly Cost |
|---|---|---|
| **ECS Fargate** | 1 task × 0.5 vCPU × 1GB | ~$15 |
| **RDS** | `db.t4g.small`, single-AZ, 20GB | ~$25 |
| **ALB** | 1 ALB + minimal LCUs | ~$18 |
| **S3** | Frontend (~50MB) + uploads (~1GB) | ~$1 |
| **CloudFront** | Minimal traffic | ~$1 |
| **Secrets Manager** | 7 secrets | ~$3 |
| **CloudWatch** | Logs + 2 alarms | ~$3 |
| **ECR** | ~200MB image | ~$0.10 |
| **Total** | | **~$66/mo** |

### Growth (moderate traffic, 50+ users)

| Service | Spec | Monthly Cost |
|---|---|---|
| **ECS Fargate** | 2-4 tasks (autoscale) | ~$30-60 |
| **RDS** | `db.t4g.medium`, Multi-AZ | ~$70 |
| **RDS Proxy** | If >10 tasks | ~$15 |
| **Total** | | **~$120-160/mo** |

### vs Current

| | Current | ECS Baseline | Difference |
|---|---|---|---|
| Cost | $10/mo | ~$66/mo | +$56 |
| Availability | Single box | Multi-AZ ALB + auto-restart | Much higher |
| Scaling | Manual SSH | Auto-scaling | Automatic |
| Backups | Manual | Automated daily | Automated |
| Deploy | 2min SSH | 5min zero-downtime rolling | Safer |

---

## 18. Risk Register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | Express listens on 127.0.0.1 — ALB can't reach container | **Critical** | Code change to `0.0.0.0` (Section 14) — must be done first |
| 2 | Config store assumes localhost PostgreSQL | **High** | Option A (eliminate) or Option B (remote config DB) — see Section 4 |
| 3 | Cron runs on every ECS task replica | **Medium** | `DISABLE_CRON` env var + ECS scheduled task (Section 12) |
| 4 | Local uploads lost on container restart | **Medium** | S3-only storage in ECS (Section 13) |
| 5 | SSE streams dropped during rolling deploy | **Low** | ALB deregistration delay 120s (Section 11) |
| 6 | Database migration data loss | **Low** | `pg_dump` + verify row counts before cutover |
| 7 | Auth0 callback URL mismatch | **Low** | Add new domains to Auth0 before DNS switch |
| 8 | Cost increase from $10 to $66/mo | **Info** | Expected — enterprise reliability costs more |
| 9 | sharp native binary fails on Alpine | **Low** | Multi-stage build with `npm rebuild sharp` (Section 3) |

---

*Document created April 2026. Complements ENTERPRISE_SCALE.md Phase 2 with concrete implementation details for Docker + ECS Fargate migration.*
