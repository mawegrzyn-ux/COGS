# Database Deployment Modes

Menu COGS can connect to PostgreSQL in two modes:

| Mode | Use Case | Where PostgreSQL runs |
|------|----------|------------------------|
| **local** | Dev laptops, single-box deployments | Same host as the API |
| **standalone** | Production / multi-AZ / horizontal scale | Separate host (AWS RDS, Lightsail managed DB, any remote Postgres) |

The same codebase serves both. Admins can switch modes from the UI at
**Settings → Database** without redeploying — see
[Switching modes via the UI](#switching-modes-via-the-ui) below.

---

## Architecture: two stores

Menu COGS uses **two separate Postgres databases**:

```
                            ┌──────────────────────────────────┐
                            │   Config store  (always local)   │
                            │   db: mcogs_config               │
   API host  ───────────►   │   • DB connection (encrypted)    │
                            │   • AI / integration keys        │
                            │     (encrypted, AES-256-GCM)     │
                            └──────────────────────────────────┘
                                          │
                                          │ reads at startup
                                          ▼
                            ┌──────────────────────────────────┐
                            │   Transactional DB  (local OR    │
                            │   standalone — selected by store)│
                            │   db: mcogs                      │
                            │   • all 28 mcogs_* tables        │
                            │   • recipes, ingredients, menus  │
                            └──────────────────────────────────┘
```

The **config store** is a tiny local Postgres database (`mcogs_config`) that
holds the connection settings for the **transactional DB** plus encrypted
copies of the AI / integration API keys. It's always on the same host as the
API so the API can boot even when the transactional DB is unreachable, and so
admins can repoint the transactional DB through the UI at runtime.

The **transactional DB** (`mcogs`) holds all 28 `mcogs_*` business tables and
can run **either** on the same host as the API (local mode) **or** on a
separate host such as AWS RDS (standalone mode).

### One-time bootstrap

On first start the API:

1. Validates `CONFIG_STORE_SECRET` is set in `api/.env` (32 bytes / 64 hex chars).
2. Creates the config-store schema in `mcogs_config` if it does not exist.
3. Seeds the connection row from `DB_HOST` / `DB_PORT` / `DB_NAME` / etc. in
   `api/.env`. After this, the `.env` values become a break-glass fallback.
4. Seeds AI keys from `process.env` (`ANTHROPIC_API_KEY`, etc.).
5. Connects to the transactional DB using the values it just persisted.

You need to create the config DB once per host before the first start:

```bash
createdb mcogs_config
```

If the database does not exist, the API logs a warning and falls back to
reading the connection from `.env` for that boot.

---

## Selecting a mode

For a fresh deployment, set the initial mode in `api/.env`. After the first
boot, switch from the UI (or by editing the `mcogs_config_db_connection` row
directly).

```env
CONFIG_STORE_SECRET=<64 hex chars — see api/.env.example>
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

## Switching modes via the UI

Once the config store is set up (see the bootstrap section above), admins
can switch between local and standalone modes from the running app — no
deploy, no `.env` editing required.

1. Sign in as a user with `settings:write` permission (Admin role by default).
2. Go to **Settings → Database**. The current connection status is shown
   at the top.
3. Pick **Local** or **Standalone (AWS RDS or remote Postgres)** and fill in
   host, port, database, user, password. SSL is enabled by default for
   Standalone.
4. Click **Test Connection** to verify the API can reach the new target. The
   probe runs against a throwaway pool — your live traffic is unaffected.
5. Click **Save**. The API validates the candidate config one more time before
   persisting it (encrypted) to `mcogs_config_db_connection`.
6. Click **Restart** in the confirmation dialog. The API process exits and is
   respawned by PM2 (or nodemon in dev). On restart it picks up the new
   connection from the config store.
7. If the new target is empty (e.g. a freshly provisioned RDS database),
   click **Run Migrations on Active DB** *after* the restart to create the
   `mcogs_*` tables.

> **Want to move your data too?** Use the **Migrate Data & Switch** button
> instead of **Save** — it runs the schema migration and copies every row
> from your current DB into the target before saving the new connection.
> See [Migrate Data & Switch](#migrate-data--switch-automatic-data-copy) below.

The endpoints powering this UI:

| Method | Path                                  | Purpose |
|--------|---------------------------------------|---------|
| GET    | `/api/db-config`                      | Current stored + active config (password masked) |
| POST   | `/api/db-config/test`                 | Dry-run a candidate config |
| POST   | `/api/db-config/probe`                | Ping the live pool |
| PUT    | `/api/db-config`                      | Save (validates first) |
| POST   | `/api/db-config/restart`              | Graceful exit (PM2 respawns) |
| POST   | `/api/db-config/migrate`              | `CREATE TABLE IF NOT EXISTS …` against the live pool |
| POST   | `/api/db-config/migrate-preview`      | Count source + target rows for a candidate config (read-only) |
| POST   | `/api/db-config/migrate-data`         | Copy schema + all data source → candidate target, then save |

All routes require `settings:write` (Admin role).

---

## Migrate Data & Switch (automatic data copy)

The fastest way to move from local to standalone — or between any two
databases — is the **Migrate Data & Switch** button on the Database tab.
It replaces the manual `pg_dump` / `pg_restore` path described further
below with a single guided flow inside the UI.

### What it does

1. Connects to the target database with the credentials you entered above.
2. Runs `CREATE TABLE IF NOT EXISTS …` on the target (idempotent).
3. Discovers every `mcogs_*` table on the **source** from `pg_catalog`.
4. Topologically sorts them by foreign-key dependencies — parents before
   children, so no `CASCADE` or `session_replication_role` tricks are
   needed, and no special database privileges are required beyond the
   usual `SELECT / INSERT / UPDATE / DELETE` + `TRUNCATE` on `mcogs_*`.
5. `TRUNCATE`s the target tables in reverse order, then `INSERT`s all
   source rows in forward order, 500 at a time, inside a single
   target-side transaction. A failure anywhere rolls the target back —
   the source is never touched.
6. Resets every serial sequence past `max(id)` so subsequent API inserts
   don't collide on primary keys.
7. Persists the new connection to the config store (encrypted).
8. Prompts you to restart the API.

### Using it

1. **System → Database**, fill in the target host/port/db/user/password,
   SSL settings.
2. Click **Test Connection** → confirms the credentials are valid.
3. Click **Migrate Data & Switch**. A modal opens showing:
   - Total row count on the **source** (your current DB)
   - Total row count on the **target** (the DB you're about to switch to)
   - An expandable per-table breakdown
4. If the target is empty, the card is green and you can click
   **Start Migration** immediately.
5. If the target already has data, the target card turns amber, a red
   warning banner appears, and **Start Migration is disabled** until you
   tick the checkbox "I understand this will overwrite existing data on
   the remote database". This is the only way to destructively replace
   target data — there is no silent overwrite.
6. Click **Start Migration**. Progress is logged to `pm2 logs` (look for
   `[migrate]` lines) — for typical installs (<50k rows) it finishes in
   a few seconds. The UI times out after 10 minutes.
7. On success you see per-table copied row counts and a **Restart API
   now** button.

### What is and isn't copied

**Copied** — every `mcogs_*` table in the transactional database:
recipes, ingredients, menus, price quotes, users, roles, settings, and
so on. Including `mcogs_settings` (legacy app settings) and
`mcogs_users` (user accounts and role assignments).

**Not copied** — the local config store (`mcogs_config` database). It
stays on the API host and never moves. That's by design: the config
store holds the connection credentials for the transactional DB, so it
has to be accessible before the API can connect to anything else.

### Caveats

- **Users table is overwritten.** If the target DB had locally-created
  users that don't exist on the source, they'll be wiped by the TRUNCATE
  + INSERT. Export them first if you need to preserve them.
- **This is a one-way operation at the moment of the click.** Source
  rows written to the source DB *after* the migration starts are not
  included (the migration reads a single point-in-time snapshot). For
  near-zero-downtime migrations, stop write traffic on the source before
  clicking the button, or run the migration during a maintenance window.
- **The serial sequences are advanced past `max(id)`** so that the API
  doesn't collide on PK inserts after the switch. This means the target
  DB's sequences are rewound forward, not backward — harmless unless
  another app shares the same sequences (which it shouldn't, since
  sequences are per-table).
- **Target schema is created fresh** via `CREATE TABLE IF NOT EXISTS`
  before the copy. This will **not** add new columns to existing tables
  on the target — if your source schema is newer than what's on the
  target, you need to apply the schema changes manually first. For fresh
  targets this is not an issue.

---

## Switching an existing deployment from local to standalone

**Recommended path — Migrate Data & Switch (in the UI):**

1. Provision the standalone database (see the AWS RDS section above).
   It only needs to exist and be reachable — you don't need to run
   `npm run migrate` against it, the flow does that for you.
2. Sign in as an Admin → **System → Database**.
3. Fill in the target host / port / database / user / password / SSL.
4. Click **Test Connection** → green.
5. Click **Migrate Data & Switch** → review the row-count summary → **Start Migration**.
6. On success, click **Restart API now**.
7. Verify with `[db] PostgreSQL connected (standalone → …)` in `pm2 logs`.
8. Once verified, stop the local PostgreSQL service if you no longer need it.

**Manual / scripted equivalent (useful for very large databases or when
you want more control):**

1. Provision the standalone database.
2. Back up the local DB: `pg_dump -Fc mcogs > mcogs.dump`
3. Restore into the standalone DB: `pg_restore -h <rds-endpoint> -U mcogs -d mcogs --no-owner --no-acl mcogs.dump`
4. In the UI: Settings → Database → Standalone, fill in fields, **Test**, **Save**, **Restart**.
   (Or: edit `api/.env` and restart — the values are picked up if the config store is empty,
   otherwise the UI is the source of truth.)
5. Verify with `[db] PostgreSQL connected (standalone → …)` in the logs.
6. Once verified, stop the local PostgreSQL service to free resources.

Note: the local `mcogs_config` database is **not** moved to RDS. It always
stays on the API host so the API can always boot and so admins can repoint
the transactional DB through the UI.

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
