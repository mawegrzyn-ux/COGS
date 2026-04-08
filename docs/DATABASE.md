# Database Deployment Modes

Menu COGS can connect to PostgreSQL in two modes:

| Mode | Use Case | Where PostgreSQL runs |
|------|----------|------------------------|
| **local** | Dev laptops, single-box deployments | Same host as the API |
| **standalone** | Production / multi-AZ / horizontal scale | Separate host (AWS RDS, Lightsail managed DB, any remote Postgres) |

The same codebase and the same env vars work for both — only the values
differ. This means you can develop locally against a Postgres on your
laptop and point the exact same build at AWS RDS just by changing `.env`.

---

## Selecting a mode

Set `DB_MODE` in `api/.env`:

```env
DB_MODE=local         # or: standalone
```

When `DB_MODE` is unset, it is inferred:

- If `DB_CONNECTION_STRING` (or `DATABASE_URL`) is set → **standalone**
- If `DB_HOST` is a non-loopback hostname → **standalone**
- Otherwise → **local**

`DB_MODE` primarily controls SSL defaults (see below). Connection fields are
always read from the same env vars regardless of mode.

---

## Local mode

Runs against PostgreSQL on the same machine — `localhost` sockets, no TLS.

```env
DB_MODE=local
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mcogs
DB_USER=mcogs
DB_PASSWORD=changeme
```

```bash
cd api
npm install
npm run migrate   # creates mcogs_ tables
npm run dev       # starts the API on port 3001
```

---

## Standalone mode (AWS RDS or any remote Postgres)

### 1. Provision the database

**AWS RDS for PostgreSQL (recommended):**
1. Create a PostgreSQL 16 RDS instance in the same VPC / region as the API
   host (e.g. `eu-west-2`).
2. Security group: allow inbound TCP/5432 **only** from the API host's
   security group. Do not expose the database to the public internet.
3. Note the endpoint, e.g.
   `mcogs.abcdef1234.eu-west-2.rds.amazonaws.com`.
4. Create a database named `mcogs` and a user `mcogs` with ownership over it.
5. Download the [AWS RDS global CA bundle][rds-ca] and install it on the API
   host (e.g. `/etc/ssl/rds/global-bundle.pem`).

[rds-ca]: https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

**Other managed Postgres (Lightsail managed DB, Supabase, etc.):** the same
approach works — point `DB_HOST` at the remote hostname and enable SSL.

### 2. Configure the API

Either use individual fields:

```env
DB_MODE=standalone
DB_HOST=mcogs.abcdef1234.eu-west-2.rds.amazonaws.com
DB_PORT=5432
DB_NAME=mcogs
DB_USER=mcogs
DB_PASSWORD=<rds-password>
DB_SSL=true
DB_SSL_CA=/etc/ssl/rds/global-bundle.pem
```

Or a connection string:

```env
DB_MODE=standalone
DB_CONNECTION_STRING=postgresql://mcogs:<password>@mcogs.abcdef1234.eu-west-2.rds.amazonaws.com:5432/mcogs
DB_SSL=true
DB_SSL_CA=/etc/ssl/rds/global-bundle.pem
```

Individual `DB_*` fields override fields inside a connection string, so you
can rotate the password by updating only `DB_PASSWORD` without rewriting
the URI.

### 3. Run the migration

From the API host (or any host with network access to RDS):

```bash
cd api
npm run migrate
# [migrate] Target: standalone → mcogs.abcdef1234.eu-west-2.rds.amazonaws.com:5432/mcogs
```

### 4. Start the API

```bash
npm start
# [db] PostgreSQL connected (standalone → mcogs.abcdef1234.eu-west-2.rds.amazonaws.com:5432/mcogs)
```

---

## SSL / TLS reference

| Variable | Default (local) | Default (standalone) | Purpose |
|----------|-----------------|----------------------|---------|
| `DB_SSL` | `false` | `true` | Enable/disable TLS |
| `DB_SSL_CA` | unset | unset | Path to CA bundle (strict verification) |
| `DB_SSL_REJECT_UNAUTHORIZED` | n/a | auto (`true` iff `DB_SSL_CA` set) | Force/relax cert verification |

- With `DB_SSL=true` and no `DB_SSL_CA`, the connection is encrypted but
  the certificate is not pinned — this matches the default for AWS RDS
  clients that have not yet installed the global bundle.
- With `DB_SSL_CA=<path>`, certificates are verified against the bundle,
  and `DB_SSL_REJECT_UNAUTHORIZED` defaults to `true`.

---

## Switching an existing deployment from local to standalone

1. Provision the standalone database (step 1 above).
2. Back up the local DB: `pg_dump -Fc mcogs > mcogs.dump`
3. Restore into the standalone DB: `pg_restore -h <rds-endpoint> -U mcogs -d mcogs --no-owner --no-acl mcogs.dump`
4. Update `api/.env` to standalone mode (step 2 above).
5. Restart the API — you should see `[db] PostgreSQL connected (standalone → …)` in the logs.
6. Once verified, stop the local PostgreSQL service to free resources.

---

## Pool tuning (optional)

```env
DB_POOL_MAX=10                 # max connections per API process
DB_IDLE_TIMEOUT_MS=30000       # idle connection reaper
DB_CONNECTION_TIMEOUT_MS=10000 # fail-fast on connect
```

For production behind RDS you may want to raise `DB_POOL_MAX` to fit your
instance's `max_connections`, or put PgBouncer in front of RDS — see
[`ENTERPRISE_SCALE.md`](./ENTERPRISE_SCALE.md) for that pattern.
