# COGS Manager

Menu cost-of-goods management for restaurant franchise operators — built around an AI assistant ("Pepper") that lets operators query and edit their data in plain language. Originally a WordPress plugin (v3.3.0), now a modern React + Node + PostgreSQL stack hosted on AWS Lightsail.

**Live:** https://cogs.macaroonie.com

---

## What it does

Keep accurate, real-time food-cost visibility across menus, recipes, ingredients, and vendor pricing — across multiple markets and currencies. The headline modules:

| Module | Purpose |
|---|---|
| **Inventory** | Ingredients, vendors, price quotes, preferred-vendor mapping per market |
| **Recipes** | Ingredient lists with prep qty / unit conversion / waste %, sub-recipes, market & price-level variations |
| **Sales Items** | POS catalogue — recipes, ingredients, manual items, combos with steps and modifier groups |
| **Menus** | Assemble sales items per market, set prices per price level, run Menu Engineer scenarios, share read-only links |
| **Stock Manager** | Purchase orders, goods received notes, invoices, waste, transfers, stocktake |
| **Audits** | Wingstop-style QSC audit tool — 150-question bank, scoring engine, photo capture, Pepper trend analysis |
| **Allergens** | EU/UK FIC 14-allergen matrix per ingredient and per menu item |
| **HACCP** | Temperature logs, CCP logs, equipment register |
| **Kiosk** | Self-service ordering kiosk mockup at `/kiosk` (9:16 canvas, customer order flow) |

---

## Pepper — the AI at the centre

Pepper is the in-app assistant (Claude Haiku 4.5 with ~120 tools). It is the most-used surface in the app and the primary way operators interact with their data once they're past first-time setup.

**What it does:**

- **Look up anything** — "how many ingredients in inventory?", "what's the COGS on Bone-In 6 in India?", "show me last week's audit failures"
- **Make changes** — "add Atomic sauce to Garlic Parmesan recipe at 30g per portion" (always confirms before any write)
- **Run imports** — drop a CSV / Excel sheet into chat, Pepper extracts the data and stages an Import Wizard job for one-click commit
- **Open code PRs** — read the repo, draft a fix, raise a PR for human review (when a GitHub PAT is configured)
- **Voice + camera on mobile** — push-to-talk speech recognition, sentence-buffered TTS replies, camera-capture for receipts on the PWA
- **Standalone PWA** — `/pepper` is an installable mobile/tablet app, full-screen chat, scoped to its own home-screen icon
- **Memory layer** — pinned notes, daily/monthly auto-consolidated summaries, RAG over CLAUDE.md and the FAQ knowledge base — Pepper remembers context across sessions

**Three ways to reach it:**

1. Embedded panel inside any page (dock left / right / bottom)
2. Standalone PWA at `/pepper`
3. Right-click any element with a `data-ai-context` attribute → "Ask Pepper" with screenshot

---

## Toolkit for operators

- **Menu Engineer** — sales-mix scenario planner with COGS / revenue modelling, Mix Manager auto-populator, "What If" % shifts, AI-suggested per-item adjustments via Smart Scenario, push-prices-to-menu, scenario history + comments
- **Modifier multiplier** — flag a recipe ingredient as the "qty driver" so modifier costs scale with portion size (e.g. 6 wings → 6× sauce per portion). Default off; turned on globally in Settings.
- **Configurable dashboard** — 20+ widgets across Executive / Finance / Market Explorer templates, drag-drop layout with row-span control, world map (Mapbox + react-simple-maps fallback), per-country drill-down with city pins
- **Shared menu links** — password-protected read-only links for franchisees, optional edit mode with full change tracking and reply-threaded comments
- **Multi-language** — 10 languages seeded, JSONB translations on 11 entities, AI-translated nightly with stale detection. UI strings localised via `react-i18next`.
- **POS Mockup** — three-panel POS simulator (`/system → POS Mockup`) for staff training and combo-flow design
- **Self-service kiosk** — full customer-facing ordering flow at `/kiosk`, 32-inch touch-screen optimised, accessibility mode for seated users

---

## Toolkit for developers

- **CLAUDE.md** — every architectural decision, gotcha, lesson learned, and convention. Loaded into Pepper's system prompt every session, so the AI knows the codebase conventions as well as a long-term contributor.
- **Single-file migrations** — `api/scripts/migrate.js` is idempotent and re-runnable; ~430 step entries. Safe on a fresh DB or against production.
- **Audit log** — every write is tracked centrally (`mcogs_audit_log`) with who / what / when / old → new field diffs / free-form context JSONB. Queryable by Pepper.
- **Test suite** — Vitest (unit + integration with real Postgres + transaction-rolled isolation), Playwright E2E with Auth0 storageState reuse, axe-playwright accessibility, k6 perf smoke, Pepper evals
- **Internal API** — read/write endpoints with key-based auth (`/api/internal/*`) for cron jobs, CI scripts, and the Claude Code agent in this repo
- **Bugs & Backlog tracker** — built into the app (`/system → Bugs & Backlog`) with kanban + AI-suggested priorities + 2-way Jira sync. New session learnings get filed automatically by the EOS protocol.
- **Change Log** — release notes stored in `mcogs_changelog`, queryable by Pepper via the `get_changelog` tool.

---

## Architecture at a glance

| Layer | Stack |
|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind 3, deployed as a PWA |
| API | Node.js + Express, ~50+ route modules, ~120 Pepper tools |
| Database | PostgreSQL 16, ~87 `mcogs_*` tables |
| Auth | Auth0 SPA with refresh-token rotation + per-market RBAC |
| AI | Anthropic (Claude Haiku 4.5), Voyage (RAG), Brave Search, OpenAI Whisper (voice on Safari/iOS) |
| Hosting | Single AWS Lightsail instance, Nginx → PM2 → Node, $10/mo dev tier |
| CI/CD | GitHub Actions — push to `main` → build → SCP → migrate → PM2 restart → health check |

---

## Feedback, bugs, and ideas

Multiple channels, all funnel into the same backlog/bug tables — operators and developers see the same board.

- **In-app:** `System → Bugs & Backlog → + Add Item`. Categorise as bug or backlog story, drag tiles between priority columns, inline status dropdown.
- **Ask Pepper:** "log a bug: tooltip is cut off on mobile" or "add to backlog: support per-market modifier multipliers" — the AI files it with the right priority + labels.
- **Jira:** if the integration is configured, items push/pull both ways every 15 minutes.
- **GitHub Issues:** also welcomed; the Bugs & Backlog tracker treats them as a separate channel.

---

## Getting started locally

Prerequisites: Node.js 20+, PostgreSQL 16, an `.env` file in `api/`.

```bash
git clone git@github.com:mawegrzyn-ux/COGS.git
cd COGS

# API
cd api && npm install
cp .env.example .env       # set DB_PASSWORD + CONFIG_STORE_SECRET
npm run migrate

# Frontend
cd ../app && npm install
cp .env.example .env.local # set VITE_AUTH0_DOMAIN + VITE_AUTH0_CLIENT_ID

# Run
cd ../api && npm run dev   # :3001
cd ../app && npm run dev   # :5173
```

Open `http://localhost:5173`. The first user to sign in is auto-bootstrapped as Admin; subsequent users register as `pending` until an Admin approves them.

---

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** — full architecture reference, schema, route catalogue, gotchas, design rules, EOS protocol
- **[docs/user-guide.md](./docs/user-guide.md)** — operator-facing how-to
- **[docs/AI.md](./docs/AI.md)** — Pepper internals (tool catalogue, memory system, agentic loop)
- **[docs/STAGING.md](./docs/STAGING.md)** — staging-environment provisioning
- **[docs/TESTING.md](./docs/TESTING.md)** — test layers and coverage policy
- **[docs/UAT/](./docs/UAT/)** — manual UAT scripts (run pre-release)
- **[docs/DOMAIN_MIGRATION.md](./docs/DOMAIN_MIGRATION.md)** — DNS / Auth0 / Nginx migration runbook

---

## Contributing

This is currently a private project for a single franchise group. External PRs aren't accepted, but bug reports and feature suggestions through GitHub Issues are appreciated. Operators with portal access should use the in-app Bugs & Backlog tracker — Pepper will help you file it cleanly.

---

## License

Private — all rights reserved.
