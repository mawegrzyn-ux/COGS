# Requirements Gap Analysis — COGS vs Enterprise Brand Partner Requirements

Cross-reference of supplied requirements against current COGS Manager capabilities (as of 2026-04-09). No planning or implementation — observation only.

Status legend:
- ✅ **Met** — capability exists in current COGS
- 🟡 **Partial** — some supporting pieces exist but the requirement is not fully satisfied
- ❌ **Gap** — not present in COGS today

---

## Reporting & Analytics

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 1 | Multi-unit dashboard (Brand Partner, Power BI) | 🟡 | DashboardPage has KPI tiles, menu tiles, coverage %, recent quotes. Market scope filtering via `allowedCountries` (RBAC). | No portfolio roll-up across brand partners; no store-level drill-down; no Power BI connector/export; no franchise benchmarking export. |
| 2 | Automated scheduled reports (email/dashboard alerts) | ❌ | None. | No scheduling engine, no email delivery, no alert subscriptions. |
| 3 | Benchmarking across peer groups (Brand Partner) | ❌ | None. | No peer-group definitions, no comparative analytics. |
| 4 | Multi-unit compliance reporting (District Manager — counts, orders, variance tasks) | ❌ | None. | No task/completion tracking; COGS has no inventory count or order workflows. |
| 5 | Trend reporting (historical food cost/waste/labor, export) | ❌ | None. | No historical snapshots or trend views; no waste/labor data in model. |
| 6 | Multi-unit consolidated reporting with drill-down (System Admin) | 🟡 | Dashboard shows aggregated counts. | No store-level hierarchy roll-up; no expand/collapse per-store stacking. |

---

## Finance & Accounting

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 7 | Automated COGS calculation (store/region/enterprise, daily) | 🟡 | Recipe + menu COGS computed on demand via `/api/cogs` using preferred vendor quotes. Menu Engineer supports scenario COGS. | No store level (COGS has no stores concept for costing, only Locations for HACCP); no region/enterprise roll-up; no daily automated snapshot; no actual-vs-theoretical (no POS depletion). |
| 8 | GL export integration (ERP/Oracle HCM) | ❌ | None. | No ERP export; no GL mapping. |
| 9 | P&L visibility with drill-down (food/labor/waste) | ❌ | None. | No P&L model; no labor/waste data. |
| 10 | Price variance tracking (alerts vs contract price) | ❌ | Price quotes stored with `purchase_price` and history via multiple quotes, but no contract-price concept and no alerting. | No contracted-price field; no variance engine; no alerts. |
| 11 | Inventory valuation (real-time) | ❌ | No on-hand inventory. | No stock levels, receiving, counts, or valuation. |
| 12 | Audit trail (cost/recipe/inventory/user actions) | ❌ | No global audit log. `mcogs_ai_chat_log` covers Pepper only. | No cross-entity change log. |
| 13 | Franchise benchmarking KPIs (Brand Partner) | ❌ | None. | Same as #3. |
| 14 | Invoice matching / 3-way match + price variance alerts (GSC, PFG) | ❌ | None. | No POs, no GRN, no invoices. |
| 15 | Automated invoice ingestion (electronic from distributor) | ❌ | None. | No distributor EDI/API integration. |
| 16 | Credit invoice pop-up alert (GM) | ❌ | None. | No invoice model. |
| 17 | Credit memo → invoice linkage | ❌ | None. | Same as #16. |
| 18 | Multi-currency + configurable tax (International) | ✅ | `mcogs_countries` with currency code/symbol/exchange rate; `mcogs_country_tax_rates` + `mcogs_country_level_tax`; Frankfurter sync; display conversion in Menus. | Exchange rate sync is manual-trigger; no per-market pricing overrides on ingredients (vendor quotes are per country via preferred vendor, which is close). |
| 19 | Regional pricing management (by market/currency) | ✅ | Preferred vendor per `(ingredient, country)` in `mcogs_ingredient_preferred_vendor`; tax per country + level. | None material. |

---

## Forecasting

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 20 | Sales forecasting by day/daypart w/ promo impact (DM) | ❌ | None. | No POS/sales data; no forecasting engine. |
| 21 | Promo-aware forecasting (GM) | ❌ | None. | Same as #20. |
| 22 | Enterprise demand planning (aggregate cross-region) | ❌ | None. | Same as #20. |

---

## Inventory Management

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 23 | Real-time theoretical vs actual variance | ❌ | None. | No POS depletion feed, no counts. |
| 24 | Mobile inventory counting (tablet, offline) | ❌ | None. | No count workflow; UI responsive but no offline. |
| 25 | Simplified guided count workflow | ❌ | None. | Same as #24. |
| 26 | Variance alert dashboard | ❌ | None. | No variance data. |
| 27 | Catch weight (variable-weight products) | ❌ | Ingredients have `base_unit` + prep conversion + waste %. | No variable-weight/per-case weight capture. |
| 28 | Inter-store transfer tracking | ❌ | None. | No stores-as-costing entities; no transfer model. |

---

## Waste & Variance Control

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 29 | Waste tracking with reason codes | ❌ | Ingredient-level `waste_pct` exists (theoretical only). | No event-level waste logging; no reason codes. |
| 30 | Quick waste entry (<30s in shift) | ❌ | None. | Same as #29. |

---

## Purchasing & Order Management

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 31 | Suggested ordering (forecast + par + usage) | ❌ | None. | No ordering module. |
| 32 | Order approval workflow | ❌ | None. | Same. |
| 33 | Centralized order guide management | 🟡 | Vendors + ingredients + preferred vendors per market exist and can serve as a master catalog. | No order-guide concept, no SKU restriction, no push-sync to stores, no ordering UI. |
| 34 | Par level management | ❌ | None. | No pars. |
| 35 | Self-order vs corporate-order configuration | ❌ | None. | Same as #31. |
| 36 | Photos of items while ordering | 🟡 | `mcogs_ingredients.image_url` exists; media library present. | No ordering UI to display them in. |
| 37 | Track-your-truck ETA | ❌ | None. | No distributor logistics integration. |
| 38 | Direct OpCo CSR communication | ❌ | None. | No messaging/ticketing. |
| 39 | Distributor direct integration (PFG EDI) | ❌ | None. | No integration. |

---

## Recipe & Menu Management

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 40 | Multi-level recipe management (ingredient/sub-recipe/finished) w/ yield + version history | 🟡 | `mcogs_recipes` + `mcogs_recipe_items` support sub-recipes (`item_type='recipe'`), yield qty/unit. Market variations + PL variations exist. | No version history / audit log on recipe edits. |
| 41 | UOM conversion (corporate grams/oz ↔ restaurant pieces/bags/cases) | 🟡 | Ingredients have `base_unit` + `default_prep_unit` + `default_prep_to_base_conversion`; recipe items carry `prep_unit`. | No formalized "restaurant count unit" separate from prep unit; no case-pack/bag definitions; no auto-conversion at a receiving/counting layer. |

---

## Invoice & Price Reconciliation

Covered under Finance (#14–#17). All ❌ except the currency/tax pieces.

---

## International Capabilities

Covered under Finance #18, #19. ✅ / ✅.

---

## Security & Access Control / Compliance

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 42 | Role-based permissions + audit log | 🟡 | Full RBAC: `mcogs_roles`, `mcogs_role_permissions` (12 features × none/read/write), system roles, custom roles, user lifecycle, `is_dev` flag, market scope via brand partners. | No audit log of permission/role changes or data edits. |
| 43 | Least-privilege + franchise data segmentation | ✅ | `mcogs_user_brand_partners` → `allowedCountries` enforced in middleware and Pepper tools. | None material. |
| 44 | MFA (GSC/Above Restaurant/BP/Admin) | 🟡 | Auth0 handles authentication; MFA is an Auth0 tenant configuration, not enforced by the app per role. | No per-role MFA enforcement policy in-app. |
| 45 | SSO (Okta/Azure) | 🟡 | Auth0 supports IdP federation; Google OAuth currently configured. | Okta/Azure AD not yet wired; no SCIM provisioning. |
| 46 | SOC 2 Type II | ❌ | N/A — organizational, not product. | No certification; single Lightsail instance infra. |
| 47 | End-to-end encryption (TLS 1.2+, AES-256 at rest) | 🟡 | TLS via Let's Encrypt on Nginx. | PostgreSQL at-rest encryption not documented/enforced; backups not documented. |
| 48 | Documented IR / breach notification | ❌ | N/A. | No documented plan. |

---

## Systems Integration / APIs

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 49 | Open API framework (Salesforce, FoodLogiQ, loyalty, payroll, BI) | 🟡 | REST API under `/api`, Auth0-protected. | No public API docs, no API keys/scopes for 3rd parties, no webhooks, no rate-limited partner surface. |
| 50 | Distributor direct integration (PFG) | ❌ | None. | |
| 51 | Supplier performance tracking (fill rate, shortages, substitutions, price deviation) | ❌ | None. | |

---

## Support & SLA

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 52 | Enterprise SLA / 99.9% uptime | ❌ | Single $10 Lightsail instance. | No HA, no SLA. |
| 53 | In-app support / ticket submission | 🟡 | `feedback` and `internal-feedback` routes exist; Help page present. | No Salesforce integration; no ticket lifecycle. |
| 54 | No forced clock-outs due to downtime | ❌ | N/A — COGS has no time/attendance. | |
| 55 | Maintenance window governance | ❌ | No formal process. | |

---

## Implementation & Data Migration

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 56 | Historical data migration from NBO | ❌ | AI Import Wizard can ingest spreadsheets (ingredients, vendors, price quotes, recipes, menus) but not sales/inventory/cost history. | No historical sales/inventory import path. |

---

## User Experience

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 57 | Mobile/tablet access with responsive UI | 🟡 | Tailwind responsive, but layouts primarily desktop-focused (DataGrid, side panels). | Not validated for tablet; no offline. |

---

## System Management

| # | Requirement | Status | COGS Today | Gap |
|---|---|---|---|---|
| 58 | Invoice split case handling (map to alt case size per Vendor Code) | ❌ | No invoices. | |
| 59 | Hierarchical model with site-level overrides + revert | ❌ | No site/group hierarchy for costing; market variations and PL variations exist for recipes only. | No generic override-and-revert for items/settings across a group→site tree. |
| 60 | Bulk update of item/vendor attributes | 🟡 | AI Import Wizard can create/override in bulk via spreadsheets. | No in-UI bulk edit selection. |
| 61 | Role-based user management (group permissions) | ✅ | See #42. | — |
| 62 | Bulk data import/export with validation | 🟡 | Import Wizard covers import side with validation and error surfacing. | No matching bulk export (beyond Pepper `export_to_excel`); no vendor order-guide import schema. |
| 63 | Automated report/alert scheduling | ❌ | None. | Same as #2. |
| 64 | Multi-unit consolidated reporting with drill-down | 🟡 | Same as #6. | Same. |

---

## Summary by Status

| Status | Count |
|---|---|
| ✅ Met | 3 (#18 multi-currency/tax, #19 regional pricing, #43 data segmentation, #61 RBAC — effectively 4) |
| 🟡 Partial | ~17 |
| ❌ Gap | ~44 |

## Thematic Gaps (areas where COGS has essentially nothing today)

1. **Stores / physical inventory** — no store-as-costing-entity, no on-hand stock, counts, receiving, transfers, valuation, variance.
2. **Purchasing & ordering** — no POs, order guides (beyond vendor+preferred), pars, approvals, distributor EDI, truck tracking, CSR messaging.
3. **Invoicing / AP** — no invoice ingestion, 3-way match, price variance alerts, credit memos, GL export.
4. **Forecasting & POS depletion** — no sales feed, no forecasts, no theoretical depletion, no actual vs theoretical variance.
5. **Waste events** — only `waste_pct` on ingredients; no event logging or reason codes.
6. **Reporting platform** — no scheduling, alerts, Power BI connector, peer benchmarking, P&L, trend reports, audit trail.
7. **Enterprise hosting & compliance** — single-node Lightsail, no SLA, no SOC 2, no documented IR, no per-role MFA enforcement, no SSO to Okta/Azure, no at-rest encryption documentation.
8. **Integrations** — no partner API surface, no webhooks, no distributor/loyalty/payroll/BI connectors.
9. **Labor & time** — entirely out of scope today.
10. **Hierarchy & site-level overrides** — no group→site tree with override/revert outside of recipe market/PL variations.

## Areas where COGS is strong relative to the requirements

- Multi-currency, multi-tax, per-market vendor pricing.
- Multi-level recipes with sub-recipes, yields, market and price-level variations.
- RBAC with market-scope data segmentation (feeds Pepper tool calls too).
- AI-assisted bulk import of master data with validation, preview, and override semantics.
- Menu Engineer scenario modeling and shared-link review workflow.
- Allergen matrix aligned with EU/UK FIC 14.
