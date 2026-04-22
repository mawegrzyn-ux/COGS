# User Acceptance Testing — COGS Manager

## Purpose

UAT scripts are **scripted, scenario-based release tests** run by humans against a staging environment before each significant release. They cover the kind of multi-step user journeys that automated tests can't economically guarantee — visual layout, copy quality, real-feel performance, and end-to-end task completability.

## When UAT runs

| Event | Required scripts |
|---|---|
| Major release (any new page/feature) | All scripts in this folder |
| Minor release (bug fixes, small tweaks) | Smoke (01) + any script touching the changed area |
| Hotfix to production | Smoke (01) only |
| Quarterly | Full re-run by 2 independent testers |

## Process

1. **Deploy candidate to staging** — `cogs-staging.macaroonie.com` (see [`../STAGING.md`](../STAGING.md))
2. **Confirm automated suite is green** — `Tests` workflow on GitHub Actions
3. **Pick the testers** — at minimum 2 people, ideally one product + one non-product
4. **Walk every script** in this folder. Each tester records:
   - ✅ Pass / ❌ Fail / ⚠️ Issue (works but feels wrong)
   - Screenshots for any failure
   - Time-to-complete the script
5. **Triage results** — every fail/issue → log to `mcogs_bugs` or `mcogs_backlog`
6. **Decide release** — go/no-go is based on:
   - All P1 (critical path) issues = 0
   - P2 (important) issues ≤ 2, with mitigations documented
   - P3 (nice-to-have) issues — capture for next sprint, not blocking

## Script index

| # | Script | Estimated time | Role required |
|---|---|---|---|
| 01 | [Onboarding & First Menu](./01-onboarding.md) | 25 min | Admin |
| 02 | [Menu Engineer Workflow](./02-menu-engineer.md) | 30 min | Admin |
| 03 | [Stock Cycle (PO → GRN → Invoice → Stocktake)](./03-stock-cycle.md) | 40 min | Admin |
| 04 | [Multi-Market Recipe Variations](./04-multi-market.md) | 25 min | Admin |
| 05 | [Pepper AI Tasks](./05-pepper-tasks.md) | 30 min | Admin |
| 06 | [Import Wizard End-to-End](./06-import-wizard.md) | 20 min | Admin |
| 07 | [RBAC & Market Scope](./07-rbac-scope.md) | 30 min | Admin + Operator + Viewer |

**Total time per full UAT pass: ~3 hours**

## Severity Definitions

| Level | Meaning | Example |
|---|---|---|
| **P1** | Blocks core workflow; data corruption risk | COGS calc returns wrong value; can't save a recipe |
| **P2** | Workaround exists but UX is degraded | Sort doesn't persist; toast doesn't disappear |
| **P3** | Cosmetic / nice-to-have | Spacing slightly off; copy could be clearer |

## Test User Accounts

Each staging environment must have at minimum:

| Email | Role | Markets allowed | Purpose |
|---|---|---|---|
| `uat-admin@example.com` | Admin (`is_dev=true`) | All | Full access for scripts 01–06 |
| `uat-operator@example.com` | Operator | All | Operator perspective for script 07 |
| `uat-viewer@example.com` | Viewer | UK only | Restricted view + market scope for script 07 |

**Passwords stored in 1Password vault: `COGS — UAT`.**
