# Staging Environment Setup

## Why staging matters

Until we add a staging environment, every push to `main` deploys straight to production. UAT becomes impossible without it — testers can't safely run "delete this market" scripts against live data.

A staging environment costs **~$10/month** on Lightsail (same tier as prod) and unlocks:
- Pre-deploy UAT
- Safe destructive testing
- Schema migrations validated against a real Postgres before they touch production
- Pepper write-tool experimentation without polluting prod data
- Demo / sales environment

## One-time setup

### 1. Provision the Lightsail instance

```bash
# AWS Console → Lightsail → Create instance
# - Instance name: WRI-Staging
# - Plan: $10/mo (2GB RAM, 1 vCPU)
# - OS: Ubuntu 24.04
# - Static IP: assign immediately after launch
```

### 2. Install dependencies (same as prod)

```bash
ssh ubuntu@<staging-ip>
sudo apt update && sudo apt upgrade -y
sudo apt install -y postgresql-16 nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

### 3. Create the staging database

```bash
sudo -u postgres psql
postgres=# CREATE USER mcogs WITH PASSWORD '<generated-password>';
postgres=# CREATE DATABASE mcogs OWNER mcogs;
postgres=# \q
```

### 4. Set up DNS

In Lightsail DNS for `macaroonie.com`, add an A record:
- `cogs-staging` → `<staging-ip>`

Verify:
```bash
nslookup cogs-staging.macaroonie.com
```

### 5. SSL

```bash
sudo certbot --nginx -d cogs-staging.macaroonie.com
```

### 6. Deploy

Clone the repo, install dependencies, run migrations, copy frontend build:

```bash
cd /var/www
sudo mkdir menu-cogs
sudo chown ubuntu:ubuntu menu-cogs
cd menu-cogs
git clone git@github.com:mawegrzyn-ux/COGS.git .
git checkout staging  # branch is dedicated to staging deploys
cd api
npm install --production
node scripts/migrate.js
pm2 start src/index.js --name menu-cogs-api
pm2 save
pm2 startup
```

### 7. Auth0 configuration

In the Auth0 dashboard:
- **Allowed Callback URLs**: add `https://cogs-staging.macaroonie.com`
- **Allowed Logout URLs**: add `https://cogs-staging.macaroonie.com/login`
- **Allowed Web Origins**: add `https://cogs-staging.macaroonie.com`

### 8. Auto-deploy

Create a `staging` branch in the repo. Add a new GitHub Actions workflow `deploy-staging.yml` (mirror `deploy.yml` but key off `branches: [staging]` and use staging secrets):

```yaml
# Required new secrets:
LIGHTSAIL_HOST_STAGING       # cogs-staging.macaroonie.com
LIGHTSAIL_SSH_KEY_STAGING    # generate a separate deploy key
VITE_API_URL_STAGING         # https://cogs-staging.macaroonie.com/api
```

Deploy by merging to `staging` branch. Promote to prod by merging `staging` → `main`.

## Test users

Create these in Auth0 (or seed via the bootstrap-first-user flow):

| Email | Auth0 password | DB role | Markets allowed |
|---|---|---|---|
| uat-admin@cogs-staging.macaroonie.com | (1Password) | Admin (`is_dev=true`) | All |
| uat-operator@cogs-staging.macaroonie.com | (1Password) | Operator | All |
| uat-viewer@cogs-staging.macaroonie.com | (1Password) | Viewer | UAT-UK only |

To restrict the viewer to UK:
1. Configuration → Users & Roles → uat-viewer → Brand Partners
2. Assign only the brand partner(s) linked to UAT-UK
3. Save

## Seeding test data

For consistent UAT runs, seed staging with a known dataset:

```bash
ssh ubuntu@<staging-ip>
cd /var/www/menu-cogs/api
NODE_ENV=production node -e "
  const fetch = require('node-fetch');
  fetch('http://localhost:3001/api/seed', {
    method: 'POST',
    headers: { 'x-internal-key': 'YOUR_KEY' },
    body: JSON.stringify({ size: 'small' })
  }).then(r => r.text()).then(console.log);
"
```

Or trigger via the System → Test Data UI as an admin user.

## Reset between UAT cycles

To reset staging to a clean baseline:

```bash
# SSH in
sudo systemctl stop menu-cogs-api
sudo -u postgres psql -d mcogs -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
cd /var/www/menu-cogs/api
node scripts/migrate.js
# Re-seed
sudo systemctl start menu-cogs-api
```

Schedule this as a weekly cron (Sunday 02:00 UTC) so staging is always fresh on Monday morning.

## Monitoring

- **Health check**: `https://cogs-staging.macaroonie.com/api/health`
- **PM2 status**: `pm2 status` + `pm2 logs menu-cogs-api --lines 50`
- **Postgres**: `psql -U mcogs -d mcogs -c "SELECT count(*) FROM mcogs_users;"`
- **Disk usage**: `df -h` (alert if > 80%)

## When staging diverges from prod

Staging may temporarily contain experimental DB schema changes. Always verify:
1. Migration runs cleanly on staging FIRST
2. UAT passes on staging
3. Migration runs cleanly on prod (via deploy pipeline)

Never apply schema changes to production that haven't been validated on staging.
