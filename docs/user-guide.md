# COGS Manager User Guide

Comprehensive user-facing documentation for COGS Manager — a menu cost-of-goods calculator for restaurant franchise operators. This guide covers every feature, workflow, and troubleshooting scenario.

Production URL: https://cogs.flavorconnect.tech

---

## What Is COGS Manager

COGS Manager calculates the food cost (cost of goods sold) for restaurant menus. It gives franchise operators accurate, real-time food cost visibility across menus, recipes, ingredients, and vendor pricing — segmented by market and country.

Built on React 18 + Vite + TypeScript (frontend), Node.js + Express (API), and PostgreSQL 16 (database). All prices are stored in USD and converted for display using live exchange rates.

---

## Recommended First-Time Setup Order

Follow this sequence on a fresh instance. Skipping steps causes missing dropdowns and broken COGS calculations.

1. **Settings → Units** — create kg, g, litre, ml, each
2. **Settings → Price Levels** — create Eat-in, Takeout, Delivery
3. **Markets** — create countries/markets with currency codes and exchange rates
4. **Markets → Tax Rates** — add VAT or sales tax rates per market
5. **Categories** — create ingredient and recipe categories
6. **Inventory → Vendors** — create supplier records per market
7. **Inventory → Ingredients** — build the master ingredient library
8. **Inventory → Price Quotes** — add vendor pricing for each ingredient
9. **Inventory → Price Quotes → Preferred Vendors** — assign the best quote per ingredient per market
10. **Recipes** — build your dishes
11. **Sales Items** — build your sales item catalog (link recipes/ingredients, create combos, configure modifiers)
12. **Menus → Menu Builder** — create menus and add sales items with sell prices per price level
13. **Menu Engineer** — model sales mix and review COGS% performance

---

## Dashboard

The Dashboard is the home screen at `/dashboard`. It gives you a live summary of your data and a quick health check of your pricing coverage.

### KPI Cards

Eight tiles display at the top of the page:

| Tile | What it shows |
|---|---|
| Ingredients | Total ingredients in the master library |
| Recipes | Total recipe records |
| Vendors | Total supplier records |
| Markets | Total market/country records |
| Active Quotes | Total active price quote entries |
| Categories | Total categories (ingredient + recipe) |
| Coverage % | Percentage of ingredients that have at least one active preferred vendor quote |
| Menu Tiles | All menus shown as clickable cards (see below) |

### Menu Tiles

The Menu Tiles section replaces a simple count tile. It shows every menu in the system as a clickable card that links to `/menus`. Each card displays:

- Menu name
- Market (country)
- Number of items in the menu
- A row per price level showing the price level name and the overall COGS% for that level

COGS data for menu tiles loads in the background after the page renders. Tiles update once the calculation completes.

### Coverage Meter

The Coverage % tile uses colour to signal the health of your pricing data:

| Coverage | Colour | Meaning |
|---|---|---|
| Above 80% | Green | Good — most ingredients are priced |
| 50–80% | Amber | Acceptable — some gaps to fill |
| Below 50% | Red | Alert — significant pricing gaps |

### Missing Quotes Panel

Below the KPI tiles, the Missing Quotes panel lists the top 10 ingredients that have no active price quote anywhere in the system. These are the highest-priority items to price up before costing menus.

### Recent Active Quotes

A list of the most recently added or updated active price quotes, showing ingredient name, vendor, and price. Useful for confirming that recent data entry is visible in the system.

### Refresh Button

A Refresh button in the page header silently re-fetches all Dashboard data without a full page reload. After refreshing, the header shows the last-updated timestamp.

### Quick Links

The Dashboard includes quick navigation links to all main sections of the app.

---

## Settings

Settings are at `/settings`. The tab bar includes **Base Units**, **Price Levels**, **Currency**, **COGS Thresholds**, **AI**, **Storage**, **Database**, **Test Data**, **Import**, **Users**, and **Roles**. The **Database** tab is only visible to users with `settings:write` (admin) and controls which PostgreSQL instance the API talks to (local vs standalone/RDS). The **Test Data** tab is only visible to users with the developer flag (`is_dev`) and houses the seed/clear controls — every destructive action requires typing today's date as `ddmmyyyy`. Both tabs are also surfaced as top-level sections in the **System** page — see that section below for details.

### Units Tab

Units define the measurement system for the app. Every ingredient has a base unit, and every price quote and recipe line item uses units from this list.

Fields per unit:

| Field | Description |
|---|---|
| Name | Display name, e.g. Kilogram |
| Abbreviation | Short form, e.g. kg |
| Type | mass, volume, or count |

Default units to create: kg, g, litre, ml, each.

Full CRUD: create, edit, and delete units. You cannot delete a unit that is in use by an ingredient or recipe.

### Price Levels Tab

Price Levels represent channels or contexts in which a menu item is sold: for example, Eat-in, Takeout, and Delivery. Every sell price on a menu item is tied to a price level.

One price level is marked as the default. This default is used when a new country is created without specifying a price level. Changing the default is atomic — only one level can be default at a time.

Full CRUD: create, edit, and delete price levels. You cannot delete a price level that is referenced by existing prices.

### Exchange Rates Tab

All prices in COGS Manager are stored internally in USD. Exchange rates are used to convert display prices into each market's local currency.

Rates are stored as units of the local currency per 1 USD. For example:

- GBP = 0.79 means 1 USD = 0.79 GBP
- EUR = 0.92 means 1 USD = 0.92 EUR

Use the **Sync** button to fetch current live rates from the Frankfurter API (free, no API key required). Rates are updated in the database for all markets with a matching currency code.

You can also edit rates manually per market on the Markets page.

### COGS Thresholds Tab

Configure the target COGS% bands used for colour coding throughout the app, particularly in the Menu Engineer.

| Band | Colour | When applied |
|---|---|---|
| Excellent | Green | COGS% at or below target |
| Acceptable | Amber | COGS% between target and target + 10% |
| Alert | Red | COGS% above the acceptable ceiling |

Typical targets:

- Quick-service restaurant (QSR): 28–32%
- Casual dining: 30–35%
- Fine dining: 35–40%
- Delivery channels: often need lower COGS% to absorb platform commission fees

### AI Tab

Configure the Pepper AI assistant. All keys entered here are stored in the database and used server-side only — they are never exposed to the browser.

| Field | Description |
|---|---|
| Anthropic API Key | Required for Pepper to function. Without this, all Pepper requests fail. |
| Voyage AI Key | Enables semantic vector search for Pepper's knowledge base (RAG). Without it, falls back to keyword frequency scoring, which is less accurate. |
| Brave Search API Key | Enables real web search in Pepper. Without it, Pepper falls back to DuckDuckGo instant answers, which have limited coverage. |
| Response Behaviour | Concise mode toggle. When on, Pepper skips narration, calls tools silently, and returns bullet-point results instead of prose paragraphs. |
| Monthly Token Allowance | Per-user monthly token cap. Billing period runs from the 25th of the previous month to the 24th of the current month, resetting automatically each 25th. Set to 0 for unlimited. When a user reaches their limit, Pepper returns a clear message with the reset date. The Pepper panel header shows a live usage bar. |
| Claude Code API Key | Generate or regenerate a bearer token for the Claude Code developer tool to query the internal feedback API. Not required for end users. |

---

## Markets

The Markets page at `/markets` manages the countries and regions in which your brand operates. It has three tabs.

### Markets Tab

Each market record defines a country or trading region. Fields:

| Field | Description |
|---|---|
| Name | Market name, e.g. United Kingdom |
| Currency Code | ISO 4217 code, e.g. GBP, EUR, USD |
| Currency Symbol | Display symbol, e.g. £, €, $ |
| Exchange Rate | Units of this currency per 1 USD |
| Default Price Level | Which price level is the default for this market |

Full CRUD. All prices stored in USD are converted for display using `dispRate = market.exchange_rate / baseCurrency.exchange_rate`.

### Tax Rates Tab

Each market can have multiple tax rates (e.g. UK VAT Standard 20%, Reduced 5%, Zero 0%). One rate per market is marked as the default.

Tax rates map to price levels via Country-Level Tax configuration. For example:

- UK Eat-in → Standard 20%
- UK Cold Takeaway → Zero 0%
- UK Hot Takeaway → Standard 20%

This mapping ensures the Menu Engineer correctly applies the right tax rate per channel when calculating net sell prices and COGS%.

Full CRUD for tax rates. Set the default tax rate flag per market.

### Brand Partners and Locations Tab

**Brand Partners** are franchise or brand records linked to a market. They represent the operator or brand running locations in that market. Fields: name, market.

**Locations** are physical store addresses. Each location is linked to a market and optionally to a Location Group (e.g. "London Central", "North West England"). Location Groups let you cluster locations for HACCP reporting.

Fields per location: name, market, location group (optional), address, contact details, active flag.

Locations scope all HACCP records — every temperature log and CCP log is tied to a specific location.

---

## Categories

Categories at `/categories` organise your ingredients, recipes, and sales items into logical groups.

| Field | Description |
|---|---|
| Name | Category name, e.g. Dairy, Proteins, Mains |
| Group | Assigns the category to a Category Group (e.g. "Produce", "Proteins") — select from the group dropdown |
| For Ingredients | Tick if this category should appear in the ingredient category picker |
| For Recipes | Tick if this category should appear in the recipe category picker |
| For Sales Items | Tick if this category should appear in the sales item category picker |

A category can have any combination of the three scope flags enabled — e.g. "Mains" might apply to both recipes and sales items. Category Groups are managed from within the category form and stored in the `mcogs_category_groups` table.

Suggested ingredient categories: Dairy, Proteins, Produce, Dry Goods, Beverages, Sauces, Packaging.

Suggested recipe/sales item categories: Mains, Sides, Desserts, Drinks, Sauces.

Full CRUD. You cannot delete a category that is currently assigned to an ingredient, recipe, or sales item.

---

## Inventory

The Inventory page at `/inventory` is where you manage your master ingredient library, your supplier list, and all pricing data. It has three tabs.

### Ingredients Tab

The Ingredients tab is the master list of every ingredient in your system. An ingredient record defines what an item is and how it is measured — pricing is handled separately in Price Quotes.

Fields per ingredient:

| Field | Description |
|---|---|
| Name | Ingredient name |
| Category | Links to a category record (ingredient type) |
| Base Unit | The fundamental unit used for purchase quantities (e.g. kg) |
| Waste % | Percentage of purchased weight lost during preparation (peeling, trimming, cooking shrinkage, bones). Range: 0–100. |
| Default Prep Unit | The unit chefs measure in (e.g. grams when base unit is kg) |
| Prep to Base Conversion | How many prep units equal one base unit (e.g. 1000 g per 1 kg) |
| Notes | Free-text notes |
| Image URL | Optional link to an image of the ingredient |
| Allergen Notes | Free-text field for supplementary allergen information |

**Optional nutrition fields** (per 100g of ingredient):

| Field | Unit |
|---|---|
| Calories | kcal |
| Protein | g |
| Fat | g |
| Carbohydrates | g |
| Sugar | g |
| Salt | g |

Nutrition data is sourced from the USDA FoodData Central database. Use the USDA lookup in the ingredient form to search and auto-populate these fields.

### Vendors Tab

The Vendors tab lists your suppliers. Vendor records are intentionally simple — pricing detail lives in Price Quotes, not here.

Fields per vendor:

| Field | Description |
|---|---|
| Name | Supplier name |
| Country / Market | Which market this supplier operates in |

Full CRUD. You cannot delete a vendor that has active price quotes.

### Price Quotes Tab

Price Quotes link a vendor to an ingredient at a specific price. Every COGS calculation in the system ultimately traces back to a price quote.

Fields per quote:

| Field | Description |
|---|---|
| Ingredient | The ingredient being priced |
| Vendor | The supplier providing this price |
| Purchase Price | The price paid, entered in the vendor's local currency — stored in USD |
| Qty in Base Units | The quantity of the ingredient supplied per purchase unit (e.g. 12.5 kg per sack) |
| Purchase Unit | The commercial unit used by the vendor (e.g. sack, case, litre, each) |
| Active | Whether this quote is currently valid. Inactive quotes are excluded from COGS. |
| Vendor Product Code | Optional reference code from the supplier's catalogue |

**Preferred Vendor assignment:** For each ingredient, you can designate one preferred vendor per market. The preferred vendor's quote is used for all COGS calculations in that market. Only one preferred vendor per ingredient per country is permitted. If no preferred vendor is set, the system falls back to the cheapest active quote for that ingredient in that market.

To set a preferred vendor: find the quote in the Price Quotes list, select the market, and mark it as preferred.

### Menu Filter

Both the **Ingredients** and **Price Quotes** tabs include a **Filter by menu** dropdown in the toolbar. Selecting a menu resolves all ingredient IDs used in that menu's recipe items and narrows the displayed list to only those ingredients (and their quotes). This makes it easy to check pricing coverage or update costs for a specific menu before launch.

The filter resolves one level of recipe nesting — ingredients directly on recipe lines. Clear the filter to return to the full list. On the Price Quotes tab, the menu filter is hidden when the "Missing quotes only" toggle is active.

---

## Recipes

The Recipes page at `/recipes` is where you build the dishes that populate your menus.

### Recipe Header

Each recipe has the following header fields:

| Field | Description |
|---|---|
| Name | Recipe name |
| Category | Recipe category (recipe type only) |
| Yield Quantity | How many portions (or units) this recipe produces |
| Yield Unit | The unit for the yield (e.g. portions, litres, each) |

The yield quantity divides the total recipe cost to produce a cost per portion.

### Recipe Line Items

Each line item is either an ingredient or a sub-recipe.

For an **ingredient line item**:
- Select the ingredient from the master library
- Enter the quantity in the ingredient's prep unit
- The system auto-converts to base units using the prep_to_base_conversion

For a **sub-recipe line item**:
- Select another recipe from the library
- The cost of that sub-recipe is calculated recursively and used as the line cost
- This enables multi-tier recipes: raw ingredients feed sub-recipes, which feed main recipes

### COGS Calculation

The COGS calculation for each ingredient line item follows these steps:

1. Quantity in prep units ÷ prep_to_base_conversion = quantity in base units
2. Quantity in base units ÷ (1 − waste_pct / 100) = effective quantity (accounting for prep waste)
3. Effective quantity × (purchase_price ÷ qty_in_base_units) = line cost in USD

All line costs are summed, then divided by the yield quantity to produce the cost per portion.

### Market Selector

A market selector at the top of the recipe view lets you see COGS for any specific market using that market's preferred vendor quotes and exchange rates. Switching the market recalculates all line costs and the cost per portion in the selected market's currency.

### Price Level Recipes (PL Variations)

A **Price Level Recipe** (internally called a PL variation) is an alternate set of ingredients for a recipe that applies only when that recipe is sold under a specific price level.

**Example use case:** Your Eat-in burger uses premium brioche buns, but your Delivery burger uses a standard bun to reduce cost. Rather than maintaining two separate recipes, you create a Delivery price level variation of the same recipe with the substituted ingredient.

**How to create:**
1. Open the recipe in the Recipes page.
2. Select the **Price Level** tab (next to the Market tab in the variant selector).
3. Choose a price level from the dropdown.
4. Click **⊞ Create PL Variation**.
5. Choose whether to start from a copy of the global recipe (recommended) or start empty.
6. Edit the line items for this price level version — add, remove, or change quantities.

**Priority order in COGS calculations:** PL variation > market variation > global recipe. If a PL variation exists for the relevant price level, it takes precedence over the market variation for that price level.

**Promoting to global:** Use **Copy to Global** to replace the global recipe's ingredients with this PL variation's ingredients. This does not affect other market or PL variations.

**Deleting a PL variation:** Click **Delete PL Variation** to remove it. The recipe reverts to using the global (or market) version for that price level going forward.

---

## Sales Items

The Sales Items page at `/sales-items` is the catalog of items available to add to menus. Before building menus you should create your sales items here.

Each sales item has one of four types:

| Type | Description | COGS source |
|---|---|---|
| Recipe | Links to a recipe in the system | Calculated from recipe ingredients and vendor pricing |
| Ingredient | Links directly to an ingredient | Calculated from vendor pricing |
| Manual | No recipe/ingredient link — cost entered directly | Fixed cost you specify |
| Combo | Structured bundle with selectable steps | Sum of step option costs |

### Editing a Sales Item — Panel Tabs

Click any item row to open the right-side edit panel. The panel has three tabs:

| Tab | Contents | Saves when |
|---|---|---|
| **Details** | Name, display name, type, linked item (recipe/ingredient/combo or manual cost), category, description, image | Click **Save** button |
| **Markets** | Per-market enable/disable checkboxes | Automatically on each toggle |
| **Modifiers** | Assigned modifier groups (remove or add) | Automatically on each change |

Switching to a different item always resets the tab back to Details.

### Sales Item Fields (Details tab)

| Field | Description |
|---|---|
| Name | Internal name for the item |
| Display Name | Customer-facing name (leave blank to use Name) |
| Type | recipe / ingredient / manual / combo |
| Linked Item | Recipe, ingredient, or combo to link (shown based on type) |
| Manual Cost | Fixed cost in USD (manual type only) |
| Category | Sales item category (scope flag `for_sales_items = true`) |
| Description | Optional description |
| Image | Upload or paste an image URL |

### Combos

The **Combos** tab manages structured bundle items. A Combo is built from **Steps** (e.g. "Choose your burger", "Choose your side"), each with one or more **Options** that link to a recipe, ingredient, or manual cost.

**UI workflow:**
- The left sidebar lists all combos. Click a combo to load its steps.
- Click a **step header** to expand/collapse its options list and simultaneously open that step's edit form in the right side panel.
- Click an **option row** to open its edit form in the side panel.
- Use the **Edit** button in the centre toolbar to edit the combo's top-level details.
- The right side panel is resizable — drag the left edge to adjust width.
- Delete buttons use the trash icon; they appear on hover for options and on the step header for steps.

**Step settings:**

| Field | Description |
|---|---|
| Name | Step label (e.g. "Choose your burger") |
| Display Name | Customer-facing label |
| Min Select | Minimum options the customer must pick |
| Max Select | Maximum options allowed |
| Allow Repeat | Whether the same option can be chosen more than once |
| Auto Select | Automatically select when only one option exists |

**Option settings:**

| Field | Description |
|---|---|
| Type | recipe / ingredient / manual (what is linked to this option) |
| Qty | Quantity of the linked item used per selection |
| Price Add-on | Extra charge applied when this option is chosen |
| Modifier Groups | Attach modifier groups to this specific option |

Combo COGS is calculated as the sum of all step costs, using the average cost across options where a step allows multiple choices.

### Modifier Groups

The **Modifiers** tab manages reusable add-on lists (e.g. "Sauce choice", "Extra toppings"). Groups are defined once and can be attached to any sales item or combo step option.

**Creating a group:** Click **+ New Modifier Group** in the page header to open the creation form.

**Editing a group or option:** Click a group row or option row to open its edit form in the right side panel (same resizable pattern as Combos). Save from the panel footer.

| Field | Description |
|---|---|
| Name | Group name shown to staff/POS system |
| Min Select | Minimum number of options the customer must choose (0 = optional) |
| Max Select | Maximum options allowed |

**Option fields:**

| Field | Description |
|---|---|
| Name | Option label |
| Type | recipe / ingredient / manual |
| Linked Item | Recipe or ingredient linked to this option |
| Qty | Quantity of the linked recipe/ingredient per selection (default 1) |
| Price Add-on | Extra charge when this option is selected |

Options can be **reordered** using the ↑ ↓ arrow buttons on each row. The sort order is saved to the database immediately.

Use the **Duplicate** button on any group to create a copy with all its options.

---

## Menus

The Menus page at `/menus` is where you build and cost your menu offerings. It has three tabs.

### Menu Builder Tab

Create menus and populate them with Sales Items.

Each menu is linked to a market (country). You can have multiple menus per market (e.g. Dine-in Menu, Delivery Menu).

Each menu item record contains:

| Field | Description |
|---|---|
| Sales Item | The sales item being added to this menu |
| Display Name | The name shown to customers on the menu |
| Sort Order | Integer controlling the display order within the menu |
| Allergen Notes | Free text shown alongside allergen matrix data for this item |
| Sell Prices | Set a sell price per price level (gross, tax-inclusive) |

Items are grouped by their sales item category within the menu view.

### Menu Engineer Tab

The Menu Engineer tab provides a sales mix analysis and scenario planning workspace. Select a menu and a price level (or "All Levels") to see every item's cost, sell price, COGS%, revenue, and contribution margin.

**Cross-tab sync:** Selecting a menu in Menu Builder automatically selects the same menu here, and vice versa. No need to reselect when switching tabs.

**Category collapsing:** Items are grouped by category. Click a category row to collapse or expand its items. Use the ▼ All / ▶ All button next to the Item column header to toggle all categories at once.

**Currency display:** Currency symbols are shown in column headers (e.g. `Cost/ptn (£)`) based on the selected menu's market.

#### Sales Mix

Enter quantities in the **Qty Sold** column to model your sales mix. The table updates in real time, showing:

| Column | Meaning |
|---|---|
| Cost/ptn | Ingredient cost per portion in local currency |
| Price | Sell price (gross, incl. tax) |
| Qty Sold | Units sold in the period modelled |
| Sales Mix | This item's share of total units sold |
| Revenue | Net revenue (excl. tax) for this item |
| Rev Mix | This item's share of total net revenue |
| Cost | Total ingredient cost for all units sold |
| COGS % | Cost ÷ Net revenue × 100 |

The grand total row summarises the full menu.

**Mix Manager:** Click **Mix Manager** to open a modal where you set quantities per item (or enter a revenue target and auto-distribute). The modal pre-populates with any quantities already entered.

#### Scenarios

A scenario saves a named snapshot of the quantities, any price overrides you have set, and your notes. Scenarios belong to a menu.

- **Save scenario** — click the save button to name and save the current state. The name and notes are stored alongside the qty_data and price_overrides in `mcogs_menu_scenarios`.
- **Load scenario** — click any saved scenario in the scenario list to restore its quantities and price overrides.
- **Delete scenario** — remove a saved scenario permanently.
- **Price overrides** — in the ME table you can type a new sell price directly into any Price cell. This overrides the live menu price for the purposes of this scenario only. The override is stored as part of the scenario; the actual menu price is not changed unless you use **Push Prices**.
- **Push Prices** — replaces the live sell prices in the menu (across all markets) with the price overrides from the current scenario. This is a permanent write; confirm carefully.
- **What If tool** — apply a percentage uplift or reduction to all prices or all costs in one operation. Useful for modelling "what if food costs rise by 5%?" or "what if we raise all prices by 10%?".

#### Notes, History, and Comments

Click the **Notes / History** button (clock icon) to open the panel. It has three tabs:

**Notes tab:** Free-text scratchpad saved with the scenario. Use for pricing rationale, assumptions, or review commentary.

**History tab:** A timestamped log of local actions taken in this session — price resets, cost resets, qty resets, What If applications, and price pushes. Also shows a **Shared View Edits** sub-section listing every price change made by external users via shared links, with the user's name, item, price level, and old → new value.

**Comments tab:** Shows all comments posted by external reviewers via any shared link that is linked to this menu/scenario. Comments from multiple shared views are merged into a single chronological feed. You can:
- Post a new top-level comment from the Menu Engineer without leaving the page.
- Reply to any comment — the reply is automatically routed back to the same shared view the original comment came from, even if multiple shared views are active.
- Clear all comments (removes all comment-type entries from all matching shared views).

The Comments badge count shows only actual text comments, not price change entries (those appear in the History tab).

#### Shared Links

Click the **🔗 Share** button (or go to the **Shared Links** tab) to manage public-access links to this menu's pricing and COGS data.

Each shared link has:

| Field | Description |
|---|---|
| Name | Label for this link (e.g. "UK Franchisee Review") |
| Mode | **View** — read-only; **Edit** — recipient can change sell prices |
| Password | Required to access the shared page (set on creation; update anytime) |
| Menu | Which menu is displayed |
| Country / Market | Which market's prices and exchange rates are used |
| Scenario | Optionally lock the link to a specific saved scenario (shows scenario prices instead of live menu prices) |
| Expires | Optional expiry date — link becomes inaccessible after this date |
| Active | Toggle to enable/disable without deleting |

**Multiple shared views per scenario:** You can create several shared links pointing at the same menu and scenario — for example, one per franchisee or market review partner. Comments and edits from all active matching links are merged into the ME Comments and History tabs automatically.

**Shared page (public view):** Recipients open the link at `/share/<slug>`, enter the password, and see the menu pricing grid. In edit mode they can type new prices directly in the grid; each save is logged as a price change event visible in the ME History tab.

**Copying a link:** Click the copy icon next to any shared link to copy the full URL to the clipboard. The icon briefly confirms the copy.

---

## Allergen Matrix

The Allergen Matrix page at `/allergens` displays allergen information for your ingredients and menu items against the 14 allergens regulated under EU/UK FIC Regulation 1169/2011.

**The 14 regulated allergens:**

1. Celery
2. Cereals containing gluten
3. Crustaceans
4. Eggs
5. Fish
6. Lupin
7. Milk
8. Molluscs
9. Mustard
10. Peanuts
11. Sesame
12. Soybeans
13. Sulphur dioxide and Sulphites
14. Tree nuts

There are two matrix views.

### Inventory Matrix

Shows all ingredients in your master library against all 14 allergens. For each ingredient × allergen combination, the status can be:

| Status | Meaning |
|---|---|
| Contains | The ingredient definitively contains this allergen |
| May Contain | The ingredient may contain traces due to cross-contamination |
| Free From | The ingredient is confirmed free from this allergen |
| (blank) | Not assessed |

The first column (ingredient name) and the header row are sticky — they remain visible as you scroll horizontally or vertically through the matrix.

**Allergen Notes column:** The last column of the Inventory matrix is an inline-editable text area per ingredient. Use it to record additional allergen context that does not fit into the Contains/May Contain/Free From schema (e.g. "Produced on equipment shared with tree nuts"). Notes save automatically when you click away from the field. A spinner indicates that the save is in progress.

### Menu Matrix

Select a menu from the dropdown to see its items in the matrix. Allergen status propagates upward through the data hierarchy:

- Allergen status is set at ingredient level
- Recipe-level allergen status is the combined status of all its ingredients (Contains overrides May Contain)
- Menu item allergen status reflects the recipe (or ingredient) it is linked to
- Combo items resolve allergens through all their step options (both recipe and ingredient options are followed)

The **Category** column shows:
- For recipe items: the recipe's category
- For ingredient items: the ingredient's category
- For combo and manual items: the category assigned directly on the sales item

**Allergen Notes column:** The Menu matrix also has a per-row Allergen Notes field for each menu item. This field is separate from the ingredient-level notes and saves to the menu item record. It is useful for recording preparation notes relevant to allergen management at the point of service (e.g. "Served with separate gluten-free bun on request").

Both matrices use `border-separate` with `border-spacing-0` on the table element. This is necessary because `border-collapse` disables `position: sticky` in most browsers — a known CSS limitation.

---

## HACCP

The HACCP page at `/haccp` provides digital food safety logs for temperature monitoring and critical control point (CCP) checks.

**Location selector:** All HACCP records are scoped to a physical location. Select your location from the dropdown at the top of the page before entering or viewing any records. Locations are managed on the Markets page.

### Equipment Register

Register all temperature-monitored equipment at the selected location.

Fields per equipment record:

| Field | Description |
|---|---|
| Type | Equipment type (e.g. Refrigerator, Freezer, Hot Hold, Oven) |
| Description | Identifying description (e.g. "Walk-in chiller unit 1") |
| Location | The store location this equipment is assigned to |

Full CRUD. Equipment must be registered before temperature logs can be entered against it.

### Temperature Logs

Log temperature readings against registered equipment.

Fields per log entry:

| Field | Description |
|---|---|
| Equipment | Which registered equipment was checked |
| Temperature | Reading in °C or °F |
| Timestamp | Date and time of the reading |
| Corrective Action | Notes on any action taken if the reading was outside acceptable range |

### CCP Logs

CCP logs capture critical control point checks: cooking temperatures, cooling records, and delivery temperature checks.

Fields per CCP log:

| Field | Description |
|---|---|
| Type | Check type: cooking, cooling, or delivery |
| Measured Value | The recorded value (temperature, time, or other measurement) |
| Pass / Fail | Whether the check met the required standard |
| Corrective Action | Notes on actions taken if the check failed |

### Report Tab

The Report tab generates a summary of all equipment records, temperature logs, and CCP logs for the selected location. The report is formatted for printing and can be presented to environmental health officers or food safety auditors during inspections.

---

## Import

The Import page at `/import` provides an AI-powered data import wizard that accepts spreadsheet files and extracts structured data into COGS Manager. Use it to bulk-load ingredients, vendors, price quotes, recipes, and menus from existing spreadsheets.

Supported file formats: CSV, XLSX, XLSB. PDF is not supported. Maximum file size: 5 MB.

The wizard has five steps.

### Step 1: Upload

Drag and drop your file onto the upload area, or click to browse for it. The AI extraction runs automatically once the file is uploaded.

If you arrive at the Import page via a link from Pepper (e.g. `/import?job=<id>`), the wizard automatically skips to Step 2 (Review) using the already-staged job.

### Step 2: Review

The extracted data is shown in tabbed tables: Ingredients, Price Quotes, Recipes, Menus. Review the data carefully before proceeding.

Sub-recipe items are identified with a 📋 icon and a green badge.

**Duplicate handling:** If an extracted row matches an existing record, you are offered three actions:

| Action | Effect |
|---|---|
| Create | Insert as a new record (may create a duplicate) |
| Skip | Do not import this row |
| Override | Update the existing matched record with the imported values |

**Unit fuzzy-matching:** The import engine automatically resolves common unit strings to their base equivalents (e.g. "pound" → kg, "fl oz" → ml). When a unit is auto-resolved, an amber badge is shown: `was: <original>`. Check these carefully to confirm the conversion is correct.

### Step 3: Categories

Map each category name found in the imported data to an existing COGS Manager category, or create a new one.

- Select an existing category from the dropdown to map to it
- Select **+ Create new category** to create a new category inline. When you select this option, the row automatically switches to create mode and pre-fills the suggested name from the imported data. You do not need to use the Action column separately.

### Step 4: Vendors

Map each vendor name found in the imported data to an existing vendor record, or create a new one. The same inline create pattern applies as in the Categories step.

### Step 5: Execute

Click Execute to write all staged and mapped data to the database. A progress indicator shows the import status. A summary is shown on completion.

### Download Templates

The Import page provides downloadable CSV templates with the correct column headers for each data type.

| Template | Columns |
|---|---|
| Ingredients | name, category, base_unit, waste_pct, prep_unit, prep_to_base, notes |
| Vendors | name, country |
| Price Quotes | ingredient_name, vendor_name, purchase_price, qty_in_base_units, purchase_unit |
| Recipes | recipe_name, category, yield_qty, yield_unit, item_type, item_name, qty, unit |
| Menus | menu_name, country, description |
| Menu Items | menu_name, item_type, item_name, display_name, sort_order |

Use these templates to prepare your data before importing. Column headers must match exactly.

---

## Pepper AI Assistant

Pepper is the built-in AI assistant powered by Claude (Anthropic). It can read and write live data in COGS Manager, answer questions, perform calculations, and help you navigate the app. It uses server-sent events (SSE) for streaming responses.

### Accessing Pepper

Pepper is available on every page of the app.

- **Floating mode (default):** A green circular button sits in the bottom-right corner. Click it to open the chat panel.
- **Docked modes:** Use the three layout icons in the Pepper panel header to switch between float, docked-left, and docked-right. Your chosen mode persists across sessions.

### Panel Controls

| Control | Location | Action |
|---|---|---|
| Dock left | Header icon (left) | Attaches Pepper panel to the left edge of the main content area |
| Float | Header icon (centre) | Returns Pepper to the floating popup mode |
| Dock right | Header icon (right) | Attaches Pepper panel to the right edge of the main content area |
| History tab | Panel header | Opens a log of past Pepper conversations stored in the database |
| Close (X) | Panel header (float mode only) | Collapses the panel back to the floating button |

Switching between dock modes clears the current conversation. The conversation history is saved to the database and accessible via the History tab.

### Sending Messages

- **Text:** Type in the text area and press Enter or click the Send button.
- **Paste images:** Paste an image directly from your clipboard (Ctrl+V or Cmd+V). Pepper accepts screenshots and photos. An image preview thumbnail appears in the attachment badge.
- **Upload files:** Click the paperclip icon to attach a file. Supported formats: CSV, XLSX, DOCX, PPTX, PDF, PNG, JPEG, WEBP. Maximum 10 MB.
- **Screenshot button:** Click the camera icon in the chat input bar to capture the current page view. Pepper's own UI is excluded from the capture. The screenshot is attached to your next message automatically — add your question and send.
- **Right-click Ask Pepper:** On any data element in the app that supports it, right-click to reveal a context menu with "Ask Pepper". Selecting it opens Pepper with a pre-built contextual prompt and an auto-screenshot of that element. Supported context types include COGS%, coverage, cost per portion, menu COGS summaries, and page tutorials.

### Tutorial Help Buttons

Small help icons (?) appear next to page headers and tab labels throughout the app. Clicking them sends a pre-written tutorial prompt to Pepper for that specific section, walking you through how to use that feature.

### Markdown Responses

Pepper renders its responses with full markdown formatting. Tables, code blocks, headings, bullet lists, numbered lists, bold, italic, and inline code are all formatted for easy reading rather than displayed as raw text.

### Concise Mode

Toggle Concise Mode in Settings → AI → Response Behaviour. When on:

- Pepper skips narration phrases such as "Let me check that for you…"
- Tools are called silently without verbal commentary
- Results are returned as bullet points rather than prose

Useful when you are doing repetitive data tasks and want fast, clean output.

### Monthly Token Allowance

If a **Monthly Token Allowance** is configured in Settings → AI, a colour-coded progress bar appears below the Pepper panel header showing your usage for the current billing period (25th to 24th each month):

- **Green** — under 80% of the limit used
- **Amber** — 80–99% used
- **Red** — limit reached

When the limit is reached, Pepper displays a message indicating when the allowance resets. Users with the limit set to 0 have unlimited access.

### What Pepper Can Do

Pepper has 87 tools covering every data operation in the app.

**Read / Lookup (15 tools):**

| Tool | What it does |
|---|---|
| get_dashboard_stats | Returns the KPI summary figures from the Dashboard |
| list_ingredients | Lists all ingredients in the master library |
| get_ingredient | Returns detail for a single ingredient |
| list_recipes | Lists all recipes |
| get_recipe | Returns detail and line items for a single recipe |
| list_menus | Lists all menus |
| get_menu_cogs | Returns COGS% data for a menu |
| get_feedback | Retrieves logged feedback entries |
| submit_feedback | Submits a feedback entry |
| list_vendors | Lists all vendors |
| list_markets | Lists all markets |
| list_categories | Lists all categories |
| list_units | Lists all measurement units |
| list_price_levels | Lists all price levels |
| list_price_quotes | Lists all price quotes |

**Write — Create (10 tools):**

| Tool | What it does |
|---|---|
| create_ingredient | Creates a new ingredient record |
| create_vendor | Creates a new vendor record |
| create_price_quote | Creates a new price quote |
| set_preferred_vendor | Sets the preferred vendor for an ingredient in a market |
| create_recipe | Creates a new recipe header |
| add_recipe_item | Adds an ingredient or sub-recipe line to a recipe |
| create_menu | Creates a new menu |
| add_menu_item | Adds an item to a menu |
| set_menu_item_price | Sets a sell price for a menu item at a price level |
| create_category | Creates a new category |

**Write — Update (5 tools):**

| Tool | What it does |
|---|---|
| update_ingredient | Updates an ingredient record |
| update_vendor | Updates a vendor record |
| update_price_quote | Updates a price quote |
| update_recipe | Updates a recipe header |
| update_recipe_item | Updates a recipe line item |

**Write — Delete (5 tools):**

| Tool | What it does |
|---|---|
| delete_ingredient | Deletes an ingredient (fails if referenced by active quotes or recipes) |
| delete_vendor | Deletes a vendor (fails if referenced by active quotes) |
| delete_price_quote | Deletes a specific price quote |
| delete_recipe_item | Removes a line item from a recipe |
| delete_menu | Deletes a menu and all its items and prices (cascade) |

**Market / Brand (9 tools):**

| Tool | What it does |
|---|---|
| create_market | Creates a new market record |
| update_market | Updates a market record |
| delete_market | Deletes a market (warns about cascade: vendors, menus, tax rates) |
| assign_brand_partner | Links a brand partner to a market |
| list_brand_partners | Lists all brand partner records |
| create_brand_partner | Creates a new brand partner |
| update_brand_partner | Updates a brand partner |
| delete_brand_partner | Deletes a brand partner |
| unassign_brand_partner | Removes a brand partner's link to a market |

**Categories (2 tools):**

| Tool | What it does |
|---|---|
| update_category | Updates a category record |
| delete_category | Deletes a category (fails if in use) |

**Tax Rates (5 tools):**

| Tool | What it does |
|---|---|
| list_tax_rates | Lists all tax rates |
| create_tax_rate | Creates a new tax rate for a market |
| update_tax_rate | Updates a tax rate |
| set_default_tax_rate | Marks a tax rate as the default for its market |
| delete_tax_rate | Deletes a tax rate |

**Price Levels (3 tools):**

| Tool | What it does |
|---|---|
| create_price_level | Creates a new price level |
| update_price_level | Updates a price level |
| delete_price_level | Deletes a price level |

**Settings (2 tools):**

| Tool | What it does |
|---|---|
| get_settings | Reads the current system settings |
| update_settings | Updates system settings |

**HACCP (8 tools):**

| Tool | What it does |
|---|---|
| list_haccp_equipment | Lists registered equipment for a location |
| create_haccp_equipment | Registers new equipment at a location |
| update_haccp_equipment | Updates an equipment record |
| delete_haccp_equipment | Removes an equipment record |
| log_temperature | Records a temperature reading for a piece of equipment |
| list_temp_logs | Lists temperature logs for equipment or a location |
| list_ccp_logs | Lists CCP logs for a location |
| add_ccp_log | Records a new CCP check |

**Locations (8 tools):**

| Tool | What it does |
|---|---|
| list_locations | Lists all store locations |
| create_location | Creates a new location |
| update_location | Updates a location record |
| delete_location | Deletes a location (warns if equipment is assigned) |
| list_location_groups | Lists all location groups |
| create_location_group | Creates a new location group |
| update_location_group | Updates a location group |
| delete_location_group | Deletes a location group |

**Allergens (4 tools):**

| Tool | What it does |
|---|---|
| list_allergens | Lists the 14 FIC regulated allergens |
| get_ingredient_allergens | Returns the full allergen profile for an ingredient |
| set_ingredient_allergens | Sets the allergen profile for an ingredient — replaces the entire profile |
| get_menu_allergens | Returns allergen data for all items in a menu |

**Import (1 tool):**

| Tool | What it does |
|---|---|
| start_import | Accepts file content from the conversation, stages an AI import job, and returns a link to the Import Wizard at `/import?job=<id>` |

**Web Search (1 tool):**

| Tool | What it does |
|---|---|
| search_web | Searches the web. Uses Brave Search if a key is configured, otherwise DuckDuckGo instant answers. Only called when you explicitly ask Pepper to search the internet. |

**GitHub (8 tools — requires GITHUB_PAT + GITHUB_REPO in Settings → AI):**

| Tool | What it does |
|---|---|
| github_list_files | Browses directories and finds files in the configured repository |
| github_read_file | Reads the full content of any file (including its SHA for subsequent updates) |
| github_search_code | Searches code by keyword across the repository |
| github_create_branch | Creates a new feature branch — confirmation required |
| github_create_or_update_file | Writes a file to a branch — confirmation required; writing to main or master is blocked at the server level |
| github_list_prs | Lists open or closed pull requests |
| github_get_pr_diff | Returns the diff/patch for a pull request |
| github_create_pr | Opens a pull request for human review — confirmation required |

**Excel Export (1 tool):**

| Tool | What it does |
|---|---|
| export_to_excel | Generates a multi-sheet .xlsx workbook (ingredients, price quotes, recipes, menus, or a full export) filtered to your market scope. Triggers an automatic browser download. |

**Memory (3 tools):**

| Tool | What it does |
|---|---|
| save_memory_note | Saves a pinned note that persists across sessions (e.g. "remember that I prefer GBP") |
| list_memory_notes | Lists all pinned notes for the current user |
| delete_memory_note | Deletes a specific note by ID (e.g. "forget the note about GBP") |

### Safety Rules for Write Operations

Pepper always confirms before making any change to your data:

- Before any create, update, or delete action, Pepper describes what it is about to do and asks "Shall I proceed?"
- For batch operations involving more than three records, Pepper presents a full plan first and asks for a single confirmation before executing.
- **delete_menu:** Pepper warns that deleting a menu also permanently deletes all menu items and sell prices for that menu (cascade delete).
- **delete_market:** Pepper warns that deleting a market removes associated vendors, menus, and tax rates.
- **delete_location:** Pepper warns if equipment is assigned to the location, as it must be removed first.
- **set_ingredient_allergens:** Pepper warns that this call replaces the entire allergen profile for the ingredient — all previous allergen statuses are overwritten.

### Chatbot to Import Wizard Flow

If you have a spreadsheet open or have already pasted its contents into the chat, Pepper can stage an import job for you:

1. Paste or upload your spreadsheet content in the Pepper chat
2. Ask Pepper to import it (e.g. "Can you import this spreadsheet?")
3. Pepper calls `start_import` and the server runs AI extraction and staging
4. Pepper replies with a link: `/import?job=<id>`
5. Click the link — the Import Wizard opens directly at the Review step with your data pre-loaded

### Pepper's Knowledge Base (RAG)

Pepper has a knowledge base built from two documents that are indexed at API startup:

1. `claude.md` — Technical project documentation (infrastructure, schema, code architecture)
2. `docs/user-guide.md` — This document (user tutorials, workflows, field explanations)

Each document is split into sections at `##` heading boundaries. Each section is embedded using Voyage AI (voyage-3-lite model) and stored in memory as a vector. When you send a message, your query is also embedded and compared against all stored sections using cosine similarity. The four most relevant sections are injected into Pepper's context before it replies.

If no Voyage AI key is configured in Settings → AI, the system falls back to keyword frequency scoring, which matches sections based on word overlap. This is less accurate for natural language questions but still functional.

### What Pepper Cannot Do

- Write HACCP records — there are no write tools for HACCP. Use the HACCP page directly.
- Update Settings values — there is no tool to change settings like the Anthropic API key or COGS thresholds. Use the Settings page.
- Access conversation history from a different device or browser session unless you open the History tab and load a past session.
- Search the web autonomously — `search_web` is only invoked when you explicitly ask Pepper to search the internet.

---

## System

The **System** page at `/system` is the administrative and operational hub. Its left sidebar groups several sections — AI, Database, Test Data, Architecture, API Reference, Security, Troubleshooting, and Domain Migration. Most sections are documentation; three (AI, Database, Test Data) embed live controls from the Settings page.

Two sections are permission-gated:

- **Database** requires `settings:write` (admin). It is marked with an amber **ADMIN** badge in the sidebar. This section controls which PostgreSQL instance the API talks to and is admin-only because switching databases affects every user on the system.
- **Test Data** requires the **developer flag** (`is_dev` on `mcogs_users`). It is marked with a purple **DEV** badge. This section exposes destructive seed/clear actions that wipe operational data, so it's restricted to users with dev access. An Admin toggles the `is_dev` flag per-user from Settings → Users via the `</>` button.

Users who don't meet a section's gate simply don't see the entry in the sidebar. If a user loses permission mid-session (e.g. their role changes or their dev flag is revoked) they are automatically bounced back to AI, and a fallback "Admin access required" or "Developer access required" message is shown as defence-in-depth if they somehow route into the section directly.

### AI Section

Embeds the Settings → AI tab inside the System layout. Shows the same Anthropic/Voyage/Brave/Concise Mode/Monthly Token Allowance/Claude Code fields as Settings → AI. Changes made here persist to the same backend and affect Pepper immediately.

### Database Section (admin only)

Controls the **database connection mode** for the API. Not to be confused with the Test Data section — this tab does not seed or clear data; it picks which PostgreSQL instance the API talks to.

Two modes are supported:

- **Local** — the PostgreSQL instance running on the API server itself (the default for dev/self-hosted deployments).
- **Standalone** — a managed PostgreSQL host such as **AWS RDS**, connected over the network with SSL.

For Standalone mode the form collects host, port, database name, username, password, SSL toggle + CA path, and pool max. A **Test** button opens a throwaway connection to verify the credentials before saving. Saving writes the config into the encrypted config store and requires an **API restart** for the new pool to take effect — a confirmation banner and restart button handle this.

The section also exposes a **Migrate Data & Switch** flow: given a target connection, it applies the schema migrations on the target, previews row counts for every table on both sides, warns if the target isn't empty, then copies every operational row from the current DB to the target in dependency order. On success it updates the stored config to point at the new target so the next restart picks it up.

### Test Data Section (dev only)

This is where test data seeding and database-clear actions live. The section is only visible to users with the `is_dev` flag on. It exposes four actions:

| Action | What it does |
|---|---|
| **Load Test Data** | Wipes ALL existing operational data, then inserts the full dummy dataset: 4 countries with realistic tax rates, 3 price levels, 10 vendors + 3 brand partners, 1,000 ingredients across 12 categories with allergen tags, 500 price quotes, 48 recipes with line items, 4 menus with items priced across all levels, 12 sales items (11 recipe/ingredient-backed + 1 "Classic Meal Deal" combo), 2 modifier groups (Extras, Dip Choice) with 8 options, and 1 standalone combo with 3 steps. |
| **Load Small Data** | Same shape as Load Test Data but only 200 ingredients + 400 quotes. Faster for development. |
| **Clear Database** | Permanently removes all rows from every operational table (ingredients, recipes, menus, sales items, combos, modifiers, menu scenarios, shared pages, HACCP logs, recipe variations, category groups, etc.). The schema and reference data (allergens, roles, users, AI chat log, feedback, import jobs) are preserved. |
| **Load Default Data** | Adds a minimal production-ready starting point — 1 UK market, 3 units, 3 categories scoped for ingredients/recipes/sales-items, 1 default price level, 1 vendor, UK VAT rates. **Does not** clear existing records first, so it's safe to run after Clear Database. |

**Date confirmation safeguard.** Every destructive action in the Test Data section requires the user to type **today's date as `ddmmyyyy`** into a confirmation modal before the action button activates. For example, if today is 8 April 2026 the user must type `08042026`. The date is computed from the browser's local time. The confirm button stays disabled and shows a red "That isn't today's date" error until the input matches, so an accidental double-click or muscle-memory Enter press cannot wipe the database. Pressing Enter while the input matches commits the action; pressing Escape cancels the modal.

This is a deliberately stronger gate than the plain "Are you sure?" dialog used elsewhere — the date has to be thought about, not just clicked through. Combined with the `is_dev` visibility gate, it means only developers can see the controls and only a conscious typed action will fire them.

### Architecture / API Reference / Security / Troubleshooting / Domain Migration

These are reference documentation sections rendered in-page. They describe the code layout, REST endpoints, the Auth0 + RBAC model, common support scenarios, and the domain migration runbook. They're read-only and visible to everyone with access to the System page.

---

## Core Concepts

### Waste Percentage

Waste % accounts for ingredient loss during preparation: peeling vegetables, trimming fat, removing bones, or cooking shrinkage. It ensures your COGS reflects the real cost of usable ingredient, not just what you paid for the raw weight.

Formula:
```
effective_cost_per_base_unit = purchase_price_per_base_unit / (1 - waste_pct / 100)
```

Example: Chicken breast purchased at £6.00/kg with 25% waste:
- effective cost = £6.00 / (1 − 0.25) = £6.00 / 0.75 = **£8.00 per kg usable**

A recipe using 200g of this chicken therefore costs £8.00 × 0.2 = £1.60, not £6.00 × 0.2 = £1.20.

### Prep Unit Conversion

Most suppliers sell ingredients by weight (kg, litre) but chefs measure in smaller prep units (g, ml). The prep unit conversion tells the system how to translate between them.

| Field | Example |
|---|---|
| Base unit | kg (what the vendor sells per unit of price) |
| Prep unit | g (what the chef measures in the recipe) |
| Prep to base conversion | 1000 (1000 g = 1 kg) |

In a recipe: 150g of an ingredient → 150 ÷ 1000 = 0.15 kg base units → apply waste % → calculate cost.

### Preferred Vendors

One preferred vendor per ingredient per market. Only the preferred vendor's quote is used for COGS calculations in that market.

- If a preferred vendor is set, that vendor's active quote is used
- If no preferred vendor is set, the system falls back to the lowest active price quote for that ingredient in that market
- A preferred vendor quote must be marked as active to be included in COGS

Set preferred vendors in Inventory → Price Quotes.

### Currency Conversion

All prices are stored internally in USD. When displaying prices in a market's local currency, the system applies:

```
dispRate = market.exchange_rate / baseCurrency.exchange_rate
displayed_price = stored_USD × dispRate
```

When saving a price entered in local currency:

```
stored_USD = displayed_price / dispRate
```

If prices appear wrong, the most common cause is an incorrect exchange rate on the Markets page. Use Settings → Exchange Rates → Sync to fetch current live rates from the Frankfurter API.

### COGS% Colour Coding

COGS% = recipe cost per portion ÷ net sell price × 100

Colour thresholds (configured in Settings → COGS Thresholds):

| Band | Colour | Applied when |
|---|---|---|
| Excellent | Green | COGS% ≤ target |
| Acceptable | Amber | COGS% between target and target + 10% |
| Alert | Red | COGS% > target + 10% |

Typical targets: QSR 28–32%, casual dining 30–35%, fine dining 35–40%. Delivery menus often need a lower target to account for platform commission fees.

---

## Stock Manager

The Stock Manager module provides full inventory management across your locations. Access it from the sidebar at `/stock-manager` (requires the Stock Manager permission).

### Stores

Stores are physical stock-holding areas within your locations — for example, Main Kitchen, Bar, Walk-in Fridge, or Dry Store. Each store belongs to a location.

When creating a store, tick **"Location is the store"** if the location itself is the only stock-holding area (no sub-stores needed). This creates a 1:1 mapping between the location and the store.

Manage stores from the **Stores** tab. Each store shows its location, type, and whether it is active.

### Stock Overview

The **Overview** tab is the stock dashboard. It shows:

| Section | What it displays |
|---|---|
| KPI cards | Total items in stock, low stock alerts, out of stock count, active stores |
| Stock levels grid | Current quantity on hand per ingredient per store, with min/max thresholds |
| Status badges | **OK** (green) — above minimum; **Low** (amber) — below minimum threshold; **Out** (red) — zero or below |
| Recent movements | The last 20 stock changes across all stores |

Stock levels are updated automatically by purchase order receiving, waste logging, transfers, and stocktake approvals. Every change is recorded in the stock movements ledger for full traceability.

### Purchase Orders

Create purchase orders for your vendors from the **Purchase Orders** tab.

**Creating a PO:**

1. Click **"+ New PO"** and select a vendor. Optionally select a default store for line items.
2. Add ingredients — the system automatically looks up the active price quote from that vendor via the quote lookup.
3. If a quote exists: price, purchase unit, and base unit conversion are auto-populated from the quote.
4. If no quote exists: an amber warning shows the ingredient's base unit. Enter the price and unit details manually. Optionally tick **"Save as price quote"** to create a new quote from this line item's data.
5. Each line item can have its own store (defaults to the PO-level store if set).
6. Submit the PO when ready — status changes from **Draft** to **Submitted**.

**PO status flow:** Draft → Submitted → Partial (some items received) → Received (all items received) or Cancelled.

### Goods In (Receiving)

Record deliveries from the **Goods In** tab.

1. Create a **GRN** (Goods Received Note) — optionally link it to a purchase order to auto-populate the expected items and quantities.
2. Enter received quantities for each item (pre-filled from the PO if linked).
3. **Confirm** the GRN — stock levels are updated automatically, and the linked PO status updates to Partial or Received based on quantities received.

### Invoices

Track vendor invoices from the **Invoices** tab.

- Create an invoice from a confirmed GRN (items are auto-copied) or create a standalone invoice.
- Add line items with quantities, unit prices, and descriptions.
- **Status flow:** Draft → Pending → Approved → Paid (or Disputed at any stage).
- Issue **credit notes** against invoices when needed — for returns, overcharges, or damaged goods.

### Waste

Log waste events from the **Waste** tab.

- **Bulk entry mode:** add multiple waste items in one go — select ingredient, enter quantity, choose a reason code, and add optional notes.
- Stock levels are automatically decremented when waste is logged.
- **Reason codes** are configurable: Expired, Damaged, Spillage, Over-production, Quality Issue, Staff Meal, Other.
- View waste history and summary filtered by date range.

### Stock Transfers

Move stock between stores from the **Transfers** tab. Transfers use a two-step process:

1. **Create** a transfer — select source and destination stores, add items with quantities.
2. **Dispatch** — deducts stock from the source store. Status changes to Dispatched.
3. **Confirm** — adds stock to the destination store. You can record actual received quantities if they differ from the dispatched amounts.
4. **Cancel** — if the transfer has been dispatched, cancelling it reverses the deduction from the source store.

### Stocktake

Conduct inventory counts from the **Stocktake** tab. Two count types are supported:

| Type | How it works |
|---|---|
| **Full count** | Start a stocktake, click **"Populate All"** to load every ingredient with stock in that store, then enter counted quantities for each item. |
| **Spot check** | Start a spot check, then add only the specific ingredients you want to count. |

**Stocktake workflow:**

1. Create a stocktake (full or spot check) for a store.
2. Enter counted quantities for each item.
3. **Complete** the stocktake — the system calculates variances (expected quantity vs counted quantity) for each item.
4. **Approve** the stocktake — stock levels are adjusted to match the counted quantities. Variances are recorded in the stock movements ledger.

---

## Audit Log

The **Audit Log** is available under System → Audit Log (admin only, requires `settings:read` permission). It provides a central trail of all data changes across the system.

Every create, update, delete, and status change is recorded with:

| Field | What it captures |
|---|---|
| User | Name and email of the person who made the change |
| Action | Create, Update, Delete, or Status Change |
| Entity | The type (e.g. purchase_order, ingredient, recipe) and its ID and label |
| Changes | Field-level diffs showing old value and new value for each changed field |
| Context | Source (manual, import, AI), related entities (linked POs, GRNs, stores) |
| Timestamp | When the change occurred |

**Filtering the audit log:**

Use the filter controls at the top of the page to narrow results by user, action type, entity type, date range, or search by entity label. Click any row to expand it and see the full change details including field-level diffs.

**Routes with audit logging:** Purchase Orders, Goods Received, Stocktakes, Waste, Stock Levels, Ingredients, Recipes, and Price Quotes all write to the audit log on every data mutation.

---

## POS Mockup

The POS Mockup is a functional point-of-sale simulator for testing menu structure, combos, modifiers, and pricing flow. It does not save any transactions to the database — it is purely for menu validation and staff training.

**Access:** System → POS Mockup (requires `settings:read` or `menus:read` permission).

### Layout

The screen is divided into three panels:

| Panel | Purpose |
|---|---|
| **Current Check** (left) | Running order with line items, modifiers as indented sub-lines, qty +/- buttons, remove button, subtotal, tax, and total |
| **Menu Grid** (centre) | Category tabs across the top, item tiles below. Each tile shows name, price, and type badge (recipe/combo/manual) |
| **Order Flow** (right) | Activated when a combo or item with modifiers is selected. Shows step-by-step options and modifier groups |

### How to Use

1. Select a menu from the dropdown in the header bar. Choose a price level (Dine In / Takeout / Delivery).
2. Click a category tab to filter items. Click an item tile to add it to the check.
3. For combos: the Order Flow panel walks through each step. Select options, then click "Next Step" or "Add to Order" when all required steps are complete. Single-choice steps auto-advance.
4. For items with modifiers: required modifier groups appear inline (if auto_show is enabled) or behind a "Customise" button. Select options respecting min/max rules.
5. Modifier groups with repeat selection enabled show +/- stepper buttons instead of checkboxes.
6. Adjust quantities on the check with +/- buttons. Remove items with the X button.
7. Click **PAY** to close the check and see a mock receipt styled like a thermal printer printout. Click "Print" to use the browser print dialog, or "New Order" to start fresh.

### Fullscreen Mode

Click the expand button in the header to enter fullscreen mode. The sidebar and app header are hidden, giving you the full browser window. Press ESC or click the collapse button to exit.

---

## Smart Scenario

The Smart Scenario tool uses AI to propose price or cost changes across your menu items in the Menu Engineer.

### How to Use

1. Open a menu in the **Menu Engineer** tab.
2. Click the brain icon button in the toolbar.
3. Type a natural language prompt describing what you want. Examples:
   - "Increase all prices by 5%"
   - "Set food cost target to 30% and adjust prices accordingly"
   - "Reduce costs on all wing items by 10%"
4. The AI analyses your menu data and returns a table of proposed changes.
5. Review each proposal in the confirmation modal. Each row shows the item name, the field being changed (price or cost), old value, new value, and the change amount.
6. Use the checkboxes to select which proposals to apply. Click "Apply Selected" to update the scenario grid.
7. The changes are applied as scenario overrides only — they do not affect your live menu prices until you use "Push Prices".

---

## CalcInput (Math Expressions in Number Fields)

Several number input fields in the application support inline math expressions. Instead of typing a final number, you can type a calculation and the system evaluates it for you.

**Supported operators:** `+`, `-`, `*`, `/`, and parentheses `()`.

**Where it works:**
- Purchase Order item form: quantity and unit price fields
- Inventory page: prep-to-base conversion and waste percentage fields

**How to use:**

1. Click into a supported number field.
2. Type a math expression, for example `500 * 1.2` or `(100 + 50) / 3`.
3. A preview tooltip appears below the field showing the calculated result.
4. Press Enter or Tab to accept the result — the field updates to the evaluated number.
5. If the expression is invalid, the preview shows an error and the field retains its previous value.

---

## Troubleshooting

**Recipe shows £0 COGS or zero cost per portion**

No preferred vendor (or no active quote) exists for one or more ingredients in the selected market. Go to Inventory → Price Quotes, verify that an active quote exists for the ingredient, and assign a preferred vendor for the market.

**Menu sell prices are displaying incorrectly**

Check that the market's exchange rate is set correctly in Markets. Use Settings → Exchange Rates → Sync to fetch current live rates. Also confirm the base currency is USD and that the target market's currency code matches the ISO 4217 code in the exchange rate table.

**Allergen matrix is missing an allergen status for an ingredient**

Allergen status is set at ingredient level on the Allergen Matrix page (Inventory tab). Status propagates automatically through recipes to menu items — but only after the ingredient has been tagged. Go to the Inventory matrix, find the ingredient, and set its allergen status.

**Coverage % is low on the Dashboard**

The Missing Quotes panel on the Dashboard shows the top 10 unpriced ingredients. Add active price quotes for these ingredients in Inventory → Price Quotes, and assign a preferred vendor per market.

**Pepper responds with "No API key configured"**

Add your Anthropic API key in Settings → AI → Anthropic API Key. Pepper cannot function without this key.

**Pepper answers are vague or miss relevant detail**

If no Voyage AI key is set in Settings → AI, Pepper's knowledge base uses keyword scoring instead of semantic vector matching. Adding a Voyage AI key significantly improves the relevance of the context injected into Pepper's replies.

**Import wizard shows no data in the Review step**

The uploaded file may not match the expected column headers. Download the CSV template from the Import page and confirm that your column headers exactly match the template. Column names are case-sensitive.

**Import wizard unit badge shows "was: \<original\>"**

The import engine auto-resolved an unrecognised unit string to a base unit. Check that the resolved unit is correct before executing the import. If it is wrong, correct the unit in your source file and re-upload.

**Exchange rate sync fails**

The Frankfurter API is a free external service (api.frankfurter.app) that requires no API key. If the sync fails, check your server's outbound internet access. You can also set exchange rates manually in Markets.

---

## Pepper Memory

Pepper now remembers things across sessions. You can tell Pepper to remember facts, preferences, or instructions:

- **"Remember that I always want UK prices in GBP"** — saves a pinned note
- **"What do you remember?"** — shows all saved notes
- **"Forget the note about GBP"** — removes a specific note

Pinned notes are loaded into every conversation, so Pepper always has your preferences available. You can also view and manage your notes via the API at `/api/memory/notes`.

Your user profile (preferred name, primary markets, response preferences) is also loaded into each session and can be updated at `/api/memory/profile`.

**Menu tiles on the Dashboard show no COGS%**

COGS data for menu tiles loads in the background. If it does not appear after a few seconds, the most likely cause is missing preferred vendor quotes for the recipes in those menus. Check the Missing Quotes panel.

**Pepper's monthly token allowance has been reached**

The per-user monthly token limit set in Settings → AI has been consumed for the current billing period (25th to 24th). The Pepper panel header shows the reset date. Admins can raise or remove the limit in Settings → AI → Monthly Token Allowance.

**Pepper shows a 400 error or stops mid-conversation after several tool calls**

This was a known bug (Fix 8) caused by an internal tracking field (`input_str`) being accidentally sent back to the Anthropic API in multi-turn conversations. It has been fixed in `agenticStream.js`. If you see this on a deployed instance, ensure the latest code is deployed.

**Inventory Ingredients or Price Quotes list is unexpectedly short**

A menu filter may be active in the toolbar. Check for a selected menu in the "Filter by menu" dropdown and clear it to return to the full list.

---

*User guide last updated: April 2026 (POS Mockup, Smart Scenario, CalcInput, Pepper Memory sections added; Stock Manager and Audit Log from previous session)*
