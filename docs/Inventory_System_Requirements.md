# Inventory Management System
## Requirements Specification & User Stories
**Restaurant / Retail Platform · Version 1.0 · April 2026**

| | |
|---|---|
| **Scope** | Inventory module only (Sales & Menu excluded) |
| **Status** | Draft — for internal review |
| **Owner** | Product / Engineering |
| **Last Updated** | April 2026 |

---

## 1. Purpose & Scope

This document defines the functional requirements and user stories for the Inventory Management module of a combined restaurant and retail point-of-sale platform. The sales and menu modules are handled separately; this specification covers only the storage, tracking, movement, and replenishment of physical stock items.

The system must serve two distinct but overlapping contexts:

- **Restaurant context:** ingredients, consumables, packaging, and raw materials tied to recipes and prep workflows.
- **Retail context:** finished goods sold directly to customers, with SKU-level tracking and supplier purchase orders.

---

## 2. Stakeholders & Roles

| Role | Responsibilities | Priority | Notes |
|---|---|---|---|
| Owner / Manager | Full access — configure system, approve POs, view all reports | — | — |
| Inventory Clerk | Receive stock, conduct counts, create transfers | — | — |
| Kitchen Manager | View ingredient levels, log waste, adjust par levels | — | — |
| Purchaser | Create and send purchase orders, manage suppliers | — | — |
| Staff / Line Cook | Read-only view of current stock; log usage/waste | — | — |
| Finance / Auditor | Read-only access to all cost and movement reports | — | — |

---

## 3. Key Functional Areas

The inventory module is broken into eight functional areas:

- INV-1 · Item Master & Catalogue
- INV-2 · Stock Tracking & Real-Time Levels
- INV-3 · Receiving & Purchase Orders
- INV-4 · Stock Adjustments & Waste Logging
- INV-5 · Stocktake / Physical Count
- INV-6 · Low-Stock Alerts & Auto-Replenishment
- INV-7 · Reporting & Analytics
- INV-8 · Kitchen Production

---

## INV-1 · Item Master & Catalogue

Central registry of every stockable item. Serves as the source of truth for both the restaurant ingredient list and retail product catalogue.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-1.1 | Create, edit, and archive stock items with name, SKU/PLU, category, unit of measure, and description | Must Have | Archived items remain on historical records |
| INV-1.2 | Support multiple units of measure per item (e.g. order in cases, track in kg, sell in portions) | Must Have | Conversion ratios stored per item |
| INV-1.3 | Assign items to one or more locations (storage room, fridge, bar, stockroom) | Must Have | Multi-location support |
| INV-1.4 | Tag items as ingredient-only, retail-only, or dual-use | Must Have | Drives menu integration hook |
| INV-1.5 | Store supplier details and preferred supplier per item | Must Have | Links to INV-3 |
| INV-1.6 | Attach images and documents (spec sheets, allergen info) to items | Should Have | File size limit TBD |
| INV-1.7 | Bulk import items via CSV template | Should Have | Include validation & error report |
| INV-1.8 | Support item variants (e.g. same wine in 750ml / 1.5L) | Could Have | Phase 2 candidate |

### User Stories

---

**US-1.1 — Create a New Stock Item**

| | |
|---|---|
| **Actor** | Inventory Clerk |
| **User Story** | As an inventory clerk, I want to create a new stock item with all relevant details so that the system can track it from the moment it arrives. |
| **Acceptance Criteria** | 1. I can enter item name, category, SKU, unit of measure, and default location. |
| | 2. The system rejects duplicate SKUs and shows a clear error. |
| | 3. I can set a cost price and link one or more suppliers. |
| | 4. The item appears immediately in stock search and receiving screens. |
| | 5. I can optionally upload a product image or spec sheet. |

---

**US-1.2 — Manage Units of Measure**

| | |
|---|---|
| **Actor** | Kitchen Manager |
| **User Story** | As a kitchen manager, I want to define that we order flour in 25 kg bags but track and use it in grams, so that stock levels always reflect reality without manual conversion. |
| **Acceptance Criteria** | 1. I can define an order UOM and a tracking UOM with a conversion ratio. |
| | 2. When stock is received in bags, the system automatically converts to grams. |
| | 3. Reports can show quantity in either UOM with a toggle. |
| | 4. Changing a conversion ratio prompts a warning and recalculates on-hand quantity. |

---

## INV-2 · Stock Tracking & Real-Time Levels

Maintains an accurate, live view of what is on hand, committed, and available across all locations.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-2.1 | Display real-time on-hand quantity per item per location | Must Have | Updates within seconds of any movement |
| INV-2.2 | Calculate available stock = on-hand minus committed (pending orders/production) | Must Have | Committed stock visible separately |
| INV-2.3 | Maintain a full audit trail of every stock movement (who, what, when, why) | Must Have | Immutable ledger, no deletions |
| INV-2.4 | Support inter-location stock transfers with a two-step confirm | Must Have | Transfer request + confirmation |
| INV-2.5 | Automatically deduct stock when a sale is recorded by the POS/Sales module | Must Have | Requires integration hook |
| INV-2.6 | Automatically deduct ingredients when a recipe/menu item is marked as prepared | Should Have | Connects to menu module |
| INV-2.7 | Allow manual on-hand corrections with mandatory reason code | Must Have | Feeds into adjustment report |
| INV-2.8 | Display stock age / FIFO layer information for perishables | Should Have | Requires batch tracking |

### User Stories

---

**US-2.1 — View Live Stock Dashboard**

| | |
|---|---|
| **Actor** | Owner / Manager |
| **User Story** | As a manager, I want to see the current stock level for every item at a glance so that I can make quick operational decisions without running a formal report. |
| **Acceptance Criteria** | 1. Dashboard loads in under 3 seconds for up to 2,000 SKUs. |
| | 2. I can filter by location, category, or search by name/SKU. |
| | 3. Each row shows: item name, UOM, on-hand, available (on-hand minus committed), and last updated timestamp. |
| | 4. Items below par level are visually highlighted (amber/red). |
| | 5. I can drill down to see the full movement history for any item. |

---

**US-2.2 — Transfer Stock Between Locations**

| | |
|---|---|
| **Actor** | Inventory Clerk |
| **User Story** | As an inventory clerk, I want to transfer wine from the main cellar to the bar so that the bar stock reflects what is actually available for service. |
| **Acceptance Criteria** | 1. I select source location, destination location, item, and quantity. |
| | 2. The system validates that source has sufficient stock before allowing submission. |
| | 3. The receiving location must confirm receipt; stock only moves on confirmation. |
| | 4. Both locations see a pending transfer on their dashboards until confirmed. |
| | 5. The audit log records both the request and the confirmation as separate events. |

---

## INV-3 · Receiving & Purchase Orders

Manages the procurement lifecycle from raising a purchase order (PO) through to confirming receipt and updating stock.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-3.1 | Create purchase orders with supplier, line items, quantities, and expected delivery date | Must Have | Draft, submitted, received states |
| INV-3.2 | Send POs to suppliers via email directly from the system | Should Have | Formatted PDF attachment |
| INV-3.3 | Record partial and over-deliveries against a PO | Must Have | Variance flagged for approval |
| INV-3.4 | Capture actual unit cost at receiving to support landed cost tracking | Must Have | Overrides catalogue cost if different |
| INV-3.5 | Receive stock without a PO (ad-hoc / direct delivery) | Must Have | Reason code required |
| INV-3.6 | Flag and quarantine items received with quality issues | Should Have | Quarantined stock not available for use |
| INV-3.7 | Automatically generate draft POs when items hit reorder point | Should Have | Links to INV-6 |
| INV-3.8 | Maintain supplier contact details, lead times, and MOQ per item | Must Have | Used in auto-PO generation |

### User Stories

---

**US-3.1 — Receive a Delivery Against a PO**

| | |
|---|---|
| **Actor** | Inventory Clerk |
| **User Story** | As an inventory clerk, I want to check off items as they arrive against the purchase order so that the system is updated accurately the moment stock lands. |
| **Acceptance Criteria** | 1. I can open a PO and see all expected line items with ordered quantities. |
| | 2. I confirm received quantity per line; the system pre-fills with ordered quantity. |
| | 3. I can enter a different received quantity and flag a variance with a note. |
| | 4. I can mark individual items as quarantined with a reason. |
| | 5. On final submission, stock levels increase immediately for non-quarantined items. |
| | 6. The PO status updates to Received or Partially Received automatically. |

---

**US-3.2 — Raise a Purchase Order**

| | |
|---|---|
| **Actor** | Purchaser |
| **User Story** | As a purchaser, I want to create a purchase order for a supplier so that I can formally request stock and have a record of what was ordered. |
| **Acceptance Criteria** | 1. I select a supplier and the system pre-populates their contact details. |
| | 2. I add line items by searching by name or SKU; the system shows current on-hand and par levels. |
| | 3. I can save as a draft and return later to edit. |
| | 4. On submission, the PO is assigned a unique PO number. |
| | 5. I can email the PO as a PDF to the supplier with one click. |
| | 6. The PO appears in the pending deliveries queue. |

---

## INV-4 · Stock Adjustments & Waste Logging

Provides structured mechanisms to record shrinkage, spoilage, breakage, theft, and other non-sale stock reductions.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-4.1 | Log waste events with item, quantity, reason code, and responsible staff member | Must Have | Reason codes configurable by manager |
| INV-4.2 | Support reason codes: spoilage, breakage, theft, staff meal, sampling, prep loss | Must Have | Custom codes addable |
| INV-4.3 | Calculate and display waste cost in real time (quantity x current cost) | Must Have | Uses latest received cost |
| INV-4.4 | Allow managers to approve or reject adjustment entries above a threshold | Should Have | Threshold configurable |
| INV-4.5 | Provide a daily/weekly waste summary by category and reason code | Must Have | Input to reporting module |
| INV-4.6 | Support positive adjustments (found stock, returned goods) with reason | Must Have | Separate from negative adjustments |
| INV-4.7 | Flag unusually high single-item adjustments for manager review | Should Have | Configurable threshold |

### User Stories

---

**US-4.1 — Log Waste During Service**

| | |
|---|---|
| **Actor** | Kitchen Manager |
| **User Story** | As a kitchen manager, I want to log wasted ingredients during service quickly so that stock records stay accurate without disrupting kitchen operations. |
| **Acceptance Criteria** | 1. I can access the waste log from a mobile-friendly interface. |
| | 2. I search or scan the item, enter quantity, and select a reason code in under 30 seconds. |
| | 3. The system shows the cost implication of the entry before I confirm. |
| | 4. My name is automatically captured as the logging user. |
| | 5. The entry appears immediately in the waste summary report. |
| | 6. Large waste entries (above configured threshold) trigger a notification to the manager. |

---

## INV-5 · Stocktake / Physical Count

Structured process to reconcile system stock levels with physical counts. Supports full stocktakes and targeted spot counts.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-5.1 | Initiate a stocktake for a selected location or category, locking system quantities at snapshot time | Must Have | Snapshot prevents count distortion |
| INV-5.2 | Generate count sheets (printable PDF or mobile entry screen) grouped by location/shelf | Must Have | Blind count option (hides expected qty) |
| INV-5.3 | Allow multiple counters to work simultaneously on different sections | Should Have | Merges results on completion |
| INV-5.4 | Calculate variance (counted vs snapshot) per item with cost impact | Must Have | Positive and negative variances |
| INV-5.5 | Require manager sign-off before applying variances to live stock | Must Have | Approval gate with audit record |
| INV-5.6 | Support spot counts (single item or category) without a full stocktake | Must Have | Useful for high-theft items |
| INV-5.7 | Store historical stocktake results for trend comparison | Must Have | Min. 3 years retention |

### User Stories

---

**US-5.1 — Conduct a Monthly Stocktake**

| | |
|---|---|
| **Actor** | Inventory Clerk / Manager |
| **User Story** | As a manager, I want to run a monthly stocktake so that I can identify shrinkage, correct system errors, and reconcile my books. |
| **Acceptance Criteria** | 1. I initiate the stocktake and select the scope (full store or specific location). |
| | 2. The system locks a snapshot of current quantities at initiation time. |
| | 3. I can assign sections to individual staff members for counting. |
| | 4. Staff enter counts on mobile devices; I see live completion progress. |
| | 5. On completion, the system displays a variance report showing every discrepancy and the cost impact. |
| | 6. I review and either approve or query individual variances before committing. |
| | 7. Approved variances are applied to live stock; the audit log records the stocktake ID. |

---

## INV-6 · Low-Stock Alerts & Auto-Replenishment

Proactively notifies staff when stock falls below par and optionally initiates replenishment without manual intervention.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-6.1 | Define par level and reorder point per item per location | Must Have | Par = ideal level; reorder = trigger point |
| INV-6.2 | Send real-time alerts (in-app, email, SMS) when stock hits reorder point | Must Have | Configurable per alert type/user role |
| INV-6.3 | Automatically generate a draft PO when reorder point is hit, using preferred supplier and standard order quantity | Should Have | Purchaser must approve before sending |
| INV-6.4 | Allow staff to snooze an alert for a configurable period with a reason | Should Have | Prevents alert fatigue |
| INV-6.5 | Display a daily replenishment to-do list prioritised by days-of-stock remaining | Must Have | Calculated from average daily usage |
| INV-6.6 | Track average daily usage per item based on last 7/14/30 days (configurable) | Must Have | Drives days-of-stock calculation |
| INV-6.7 | Allow seasonal par levels (e.g. summer vs winter profiles) | Could Have | Phase 2 candidate |

### User Stories

---

**US-6.1 — Receive a Low-Stock Alert**

| | |
|---|---|
| **Actor** | Purchaser / Manager |
| **User Story** | As a purchaser, I want to be notified the moment a key ingredient drops below its reorder level so that I can place an order before we run out during service. |
| **Acceptance Criteria** | 1. I receive an in-app notification and email when stock hits the reorder point. |
| | 2. The alert shows: item name, current level, reorder point, preferred supplier, and standard order quantity. |
| | 3. I can open the draft PO directly from the alert with one tap. |
| | 4. If I have already placed an order for this item, the alert is suppressed to avoid duplicates. |
| | 5. I can adjust the reorder point directly from the alert screen. |

---

## INV-7 · Reporting & Analytics

Provides actionable insight into stock value, movement, waste, and supplier performance to support both operational and financial decisions.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-7.1 | Stock Valuation Report: total inventory value by location, category, or item at any point in time | Must Have | Supports FIFO and weighted-average costing |
| INV-7.2 | Stock Movement Report: all receipts, sales deductions, adjustments, and transfers in a date range | Must Have | Filterable by item, location, user |
| INV-7.3 | Waste & Shrinkage Report: waste by reason code, category, and staff member with cost totals | Must Have | Daily, weekly, monthly views |
| INV-7.4 | Slow-Moving & Obsolete Stock Report: items with no movement in configurable period | Should Have | Helps reduce dead stock |
| INV-7.5 | Supplier Performance Report: on-time delivery rate, variance rate, and average lead time per supplier | Should Have | Feeds procurement decisions |
| INV-7.6 | Stocktake Variance Report: historical variance trends to identify recurring shrinkage | Must Have | Year-on-year comparison |
| INV-7.7 | Export all reports to CSV and PDF | Must Have | Scheduled email export option |
| INV-7.8 | Role-based report access — finance sees cost data; line staff do not | Must Have | RBAC on cost fields |

### User Stories

---

**US-7.1 — Review Weekly Waste Costs**

| | |
|---|---|
| **Actor** | Owner / Manager |
| **User Story** | As an owner, I want to review the total cost of waste each week broken down by reason and category so that I can identify patterns and take corrective action. |
| **Acceptance Criteria** | 1. I can navigate to the Waste Report and select any date range. |
| | 2. The report shows total waste cost, broken down by reason code and item category. |
| | 3. I can drill into any category to see individual waste events with staff names. |
| | 4. I can compare this week against the same period last week or last month. |
| | 5. I can export the full report to PDF or CSV for finance review. |
| | 6. The report loads in under 5 seconds for a 30-day date range. |

---

## INV-8 · Kitchen Production

Manages the conversion of raw ingredients into prepared or semi-prepared items — tracking what was made, what stock was consumed, and any yield variance against expected recipe quantities.

### Functional Requirements

| ID | Requirement | Priority | Notes |
|---|---|---|---|
| INV-8.1 | Create production orders linked to a recipe, specifying the quantity of finished product to produce | Must Have | Recipe integration hook; recipes managed in menu module |
| INV-8.2 | Automatically calculate required ingredient quantities from the recipe and target yield | Must Have | Uses recipe module Bill of Materials |
| INV-8.3 | Reserve (commit) ingredient stock when a production order is created, removing it from available quantity | Must Have | Committed stock visible on dashboard |
| INV-8.4 | Record actual ingredients consumed on completion, allowing variance from the recipe quantity | Must Have | Drives yield variance report |
| INV-8.5 | On production completion, increase finished/semi-finished product stock and deduct consumed ingredient stock | Must Have | Both movements in a single atomic transaction |
| INV-8.6 | Support partial completion — mark a production order as partially done and update stock proportionally | Should Have | Order remains open for remainder |
| INV-8.7 | Log the staff member who completed or partially completed each production order | Must Have | Captured from logged-in user |
| INV-8.8 | Record actual yield vs expected yield per production run and flag significant variances | Must Have | Configurable variance threshold |
| INV-8.9 | Support batch/lot number assignment to finished items for traceability (allergen, recall scenarios) | Should Have | Connects to INV-2.8 batch tracking |
| INV-8.10 | Allow a production order to be voided with a mandatory reason; reserved stock is released on void | Must Have | Full audit trail retained |
| INV-8.11 | Display a production queue showing upcoming, in-progress, and completed orders for the current shift | Must Have | Filterable by station or category |
| INV-8.12 | Support prep schedules — production orders created in advance and scheduled for a future date/shift | Should Have | Visible on daily prep plan view |
| INV-8.13 | Calculate and display the theoretical cost of a production run before committing | Should Have | Uses latest received cost per ingredient |
| INV-8.14 | Export daily/weekly production history including yield variances and cost totals | Must Have | CSV and PDF; feeds INV-7 reporting |

### User Stories

---

**US-8.1 — Start a Production Order**

| | |
|---|---|
| **Actor** | Kitchen Manager |
| **User Story** | As a kitchen manager, I want to create a production order for today's soup batch so that the system reserves the required ingredients and I have a checklist to work from. |
| **Acceptance Criteria** | 1. I select a recipe and enter the target quantity (e.g. 20 portions of soup). |
| | 2. The system calculates required ingredient quantities and checks availability. |
| | 3. If any ingredient has insufficient stock, the system warns me before I confirm. |
| | 4. On confirmation, the ingredients are reserved and removed from available stock. |
| | 5. The production order appears on the kitchen production queue with status In Progress. |
| | 6. I can print or view a mobile-friendly prep checklist with quantities per ingredient. |

---

**US-8.2 — Complete a Production Run and Record Actuals**

| | |
|---|---|
| **Actor** | Kitchen Manager / Line Cook |
| **User Story** | As a kitchen manager, I want to record what was actually used and produced when a batch is finished so that stock levels are accurate and any variance is captured. |
| **Acceptance Criteria** | 1. I open the in-progress production order and tap Complete. |
| | 2. The system pre-fills actual quantities with the expected recipe amounts. |
| | 3. I can edit any ingredient line to reflect what was truly used. |
| | 4. I enter the actual finished quantity produced (e.g. 18 portions instead of 20). |
| | 5. The system calculates yield variance and flags it if above the configured threshold. |
| | 6. On submission: ingredient stock is deducted by actual amounts; finished product stock increases by actual yield. |
| | 7. The order is closed and the audit log records the completing user, timestamp, and all variances. |

---

**US-8.3 — View the Daily Prep Plan**

| | |
|---|---|
| **Actor** | Kitchen Manager |
| **User Story** | As a kitchen manager, I want to see all production orders scheduled for today at a glance so that I can brief the team at the start of a shift. |
| **Acceptance Criteria** | 1. The prep plan view defaults to today and shows all production orders for the shift. |
| | 2. Each order shows: recipe name, target quantity, status (scheduled / in progress / complete), and assigned station. |
| | 3. I can reorder items by drag-and-drop to reflect priority. |
| | 4. I can tap any order to see the full ingredient checklist. |
| | 5. I can add an unplanned production order directly from this screen. |
| | 6. Completed orders are visually distinguished from pending ones. |

---

**US-8.4 — Review Yield Variance Report**

| | |
|---|---|
| **Actor** | Owner / Manager |
| **User Story** | As an owner, I want to review yield variances from production runs so that I can identify recipes where consistent over-use is inflating food cost. |
| **Acceptance Criteria** | 1. I can filter production history by date range, recipe, or staff member. |
| | 2. Each row shows expected yield, actual yield, variance %, and cost impact. |
| | 3. Rows with variance above the configured threshold are highlighted. |
| | 4. I can drill into any run to see the ingredient-level detail. |
| | 5. I can export the report to CSV or PDF. |
| | 6. I can adjust the variance alert threshold directly from this screen. |

---

## 4. Non-Functional Requirements

### Performance
- Dashboard and live stock levels must reflect any movement within 5 seconds.
- All report queries must return results within 10 seconds for up to 24 months of data.
- The system must support at least 50 concurrent users without degradation.

### Security & Access Control
- All access controlled by role-based permissions (RBAC).
- Cost and margin data hidden from non-management roles.
- All data encrypted in transit (TLS 1.2+) and at rest (AES-256).
- Full audit trail of every data change — immutable, non-deletable.

### Usability
- Mobile-responsive interface for warehouse and kitchen use (minimum 375px viewport).
- Barcode / QR scanner support for item lookup on mobile.
- Key tasks (log waste, receive delivery, log transfer) completable in under 60 seconds.

### Integrations
- Sales / POS module: stock deduction on sale (API hook, event-driven).
- Menu / Recipe module: ingredient deduction on recipe production (API hook).
- Accounting / Finance: stock valuation export in standard format (CSV / JSON).
- Email gateway: PO delivery and low-stock alerts.

### Data & Compliance
- Minimum 3-year retention of all stock movement and adjustment records.
- Stocktake records retained indefinitely for audit purposes.
- GDPR-compliant handling of staff identity data in audit logs.

---

## 5. Out of Scope (This Document)

The following are explicitly excluded from this requirements document and handled in separate specifications:

- Menu engineering, recipe costing, and dish profitability analysis.
- Sales recording, till/POS workflows, and payment processing.
- Customer loyalty programmes and CRM.
- Financial accounting, P&L, and payroll.
- Staff scheduling and labour management.

---

## 6. Open Questions & Decisions Required

| ID | Question | Priority | Notes |
|---|---|---|---|
| OQ-1 | Will the system support multiple business entities (e.g. group of restaurants) under one account? | High | Affects data model design |
| OQ-2 | Is FIFO or weighted-average costing the preferred stock valuation method? | High | Required before INV-7 build |
| OQ-3 | What ERP or accounting system must inventory valuation export integrate with? | High | Determines export format |
| OQ-4 | Should auto-POs be sent directly to suppliers, or always require human approval? | Medium | Impacts INV-6.3 scope |
| OQ-5 | Are there regulatory requirements for food traceability (batch/lot tracking)? | Medium | May add scope to INV-2 |
| OQ-6 | What is the maximum number of SKUs / locations the system must support? | Medium | Performance sizing input |
| OQ-7 | Will production orders be created manually by managers only, or can line cooks initiate them? | Medium | Affects RBAC design for INV-8 |
| OQ-8 | Should the system support sub-recipes (a prep item used as an ingredient in another recipe)? | High | Multi-level BOM; significant data model impact |

---

*— End of Document —*
