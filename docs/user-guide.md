# COGS Manager User Guide

Comprehensive user-facing documentation for COGS Manager — a menu cost-of-goods calculator for restaurant franchise operators. This guide covers every feature, workflow, and troubleshooting scenario.

---

## What Is COGS Manager

COGS Manager calculates the food cost (cost of goods sold) for restaurant menus. It gives franchise operators accurate, real-time food cost visibility across menus, recipes, ingredients, and vendor pricing — segmented by market and country.

Core capabilities:
- Build a master ingredient library with waste percentages and prep unit conversions
- Manage vendor pricing per ingredient with multiple competing quotes
- Assign preferred vendors by market so each country uses its best-sourced price
- Build recipes with nested sub-recipes and automatic COGS per market
- Construct menus and view sell price vs. food cost in multiple currencies
- Generate allergen matrices compliant with EU/UK FIC Regulation 1169/2011
- Log HACCP food safety data: equipment registers, temperature checks, CCP logs
- Ask the built-in AI Assistant questions about live data in natural language

---

## Recommended First-Time Setup Order

Follow this sequence when configuring a fresh instance. Skipping steps will cause missing dropdowns and broken COGS calculations.

Step 1 — Settings: Create units of measurement (kg, g, litre, ml, each) and price levels (Eat-in, Takeout, Delivery).

Step 2 — Markets: Create countries with currency codes, exchange rates, and tax rates.

Step 3 — Categories: Create ingredient categories (Dairy, Proteins, Produce, etc.) and recipe categories (Mains, Sides, Desserts).

Step 4 — Vendors: Create supplier records linked to markets.

Step 5 — Ingredients: Build the master ingredient library with base units, waste %, and prep conversions.

Step 6 — Price Quotes: Add vendor pricing for each ingredient.

Step 7 — Preferred Vendors: Assign the best vendor quote per ingredient per market.

Step 8 — Recipes: Build dishes using ingredients and sub-recipes.

Step 9 — Menus: Assemble menu items from recipes.

Step 10 — PLT and MPT: Set sell prices and review COGS performance.

You must create at least one Market, one Price Level, and one Unit before ingredients and recipes will work correctly.

---

## Dashboard: Understanding KPIs and Coverage

The Dashboard shows a live health snapshot of COGS data. Use the Refresh button (top-right) to re-fetch all metrics.

KPI cards:
- Ingredients: Total distinct ingredients in the master library
- Recipes: Total recipes built in the system
- Vendors: Total supplier records across all markets
- Markets: Active country/market configurations
- Active Quotes: Live price quotes with is_active = true
- Categories: Ingredient and recipe category count
- Price Levels: Eat-in / Takeout / Delivery configurations
- Coverage %: Percentage of ingredients with at least one active preferred-vendor quote

Coverage meter: Green = greater than 80%, Amber = 50–80%, Red = less than 50%. Low coverage means recipe COGS will show £0 for unpriced ingredients.

Missing Quotes panel: Shows the top 10 ingredients used in recipes that have no active price quote anywhere. These are the highest-priority gaps to fill in Inventory → Price Quotes.

Recent Quotes: Lists the most recently added active price quotes.

---

## Markets: Countries, Currencies and Tax Rates

Markets are the core geographic unit. Everything market-specific — vendor pricing, preferred vendors, menu sell prices, tax rates, and COGS calculations — is linked to a Market.

Each market stores: country name, ISO currency code (e.g. GBP), currency symbol (£), and exchange rate vs USD.

All prices are stored in USD. Display conversion: dispRate = market.exchange_rate / targetCurrency.exchange_rate. Sync live rates via Settings → Exchange Rates.

Tax rates: Each market supports multiple tax rates (e.g. Standard 20%, Reduced 5%, Zero 0%). One is flagged as default. Rates are mapped to price levels via the Country-Level Tax junction — for example, UK Delivery at 20% VAT while cold takeaway food uses 0%.

Price levels per market: Each market has a default price level pre-selected when viewing menus.

Locations: Physical store locations are linked to a market and optionally to a Location Group (e.g. "London Central"). Location Groups allow clustering of sites. Locations are the scope for all HACCP records.

Brand Partners: Franchise operators are associated at the market level.

---

## Categories: Organising Ingredients and Recipes

Categories organise ingredients and recipes into logical groups. There are two category types: ingredient and recipe. Each category also has a Group Name (a flat string label, e.g. "Dairy", "Produce") to cluster similar categories together.

Suggested ingredient groups: Dairy, Proteins, Produce, Dry Goods, Beverages, Sauces and Condiments, Packaging, Cleaning.

Suggested recipe categories: Mains, Sides, Desserts, Drinks, Sauces.

---

## Ingredients: Creating and Managing the Master Library

The ingredient master list is the foundation of all recipe and menu costing.

Fields:
- name: Ingredient name, used in recipe builder autocomplete
- category: Ingredient category from the Categories page
- base_unit: The unit all prices are stored in (e.g. kg, litre, each)
- waste_pct: Percentage of ingredient discarded in preparation (0–100). Increases effective cost per usable unit.
- default_prep_unit: The unit chefs measure in recipes (e.g. grams, ml)
- prep_to_base_conversion: How many prep units equal one base unit (e.g. 1000 g = 1 kg)
- notes: Free-text notes for buyers or kitchen team
- nutrition fields: Optional kcal, protein, fat, carbs, sugar, salt per 100g — sourced from USDA FoodData Central

---

## Understanding Waste Percentage and Prep Conversion

Waste % accounts for the portion of an ingredient that is discarded during preparation (peeling, trimming, bones, shells, cooking loss).

Example with 20% waste: If flour costs £2.00 per kg and waste is 0%, cost per kg usable = £2.00. If chicken breast costs £6.00 per kg and waste is 25% (trim loss), effective cost per kg usable = £6.00 / (1 - 0.25) = £8.00 per kg of usable meat.

The formula: Effective cost = purchase_price / (1 - waste_pct / 100)

Prep conversion converts between the unit the vendor sells in (base unit, e.g. kg) and the unit the recipe uses (prep unit, e.g. grams). If base unit is kg and prep unit is g, then prep_to_base_conversion = 1000, meaning 1000 g = 1 kg.

Recipe line cost calculation:
1. Take recipe quantity in prep units (e.g. 150 g)
2. Divide by prep_to_base_conversion to get base units (150 / 1000 = 0.15 kg)
3. Divide by (1 - waste_pct/100) to get effective qty
4. Multiply by vendor price per base unit
5. Result is the cost contribution of that ingredient line

---

## Vendors: Managing Suppliers

Vendors are ingredient suppliers. Each vendor is linked to a country/market. You can have multiple vendors per market and multiple vendors offering the same ingredient at competing prices.

Vendor records store: name, country, and optional contact details.

Vendor pricing is managed through Price Quotes, not on the vendor record itself.

---

## Price Quotes: Setting Vendor Pricing

Price quotes link a vendor to an ingredient at a specific price. Each quote records:
- purchase_price: Price paid per purchase unit (entered in local currency, stored in USD)
- qty_in_base_units: How many base units per purchase unit (e.g. 12.5 kg per sack)
- purchase_unit: The unit the vendor sells in (sack, case, litre, each)
- is_active: Only active quotes are used in COGS calculations and coverage metrics
- vendor_product_code: Optional vendor SKU for ordering reference

To deactivate a quote without deleting it (e.g. when a vendor changes pricing), set is_active to false. The quote is retained for historical reference.

---

## Preferred Vendors: Choosing the Best Source Per Market

For each ingredient and market combination, you can designate a Preferred Vendor — the single quote used for COGS calculations in that market. The database enforces one preferred vendor per ingredient per country (UNIQUE constraint).

If no preferred vendor is set for an ingredient in a market, the system automatically falls back to the lowest active quote for that ingredient. Set preferred vendors to ensure COGS reflects the actual supplier each franchise location uses, not just any available price.

Preferred vendors are set in the Inventory → Price Quotes tab.

---

## Allergen Management: EU FIC Compliance

The EU/UK Food Information to Consumers (FIC) Regulation 1169/2011 requires food businesses to declare the 14 major allergens in all food sold.

The 14 regulated allergens: Celery, Cereals containing gluten, Crustaceans, Eggs, Fish, Lupin, Milk, Molluscs, Mustard, Peanuts, Sesame, Soybeans, Sulphur dioxide and Sulphites, Tree nuts.

For each ingredient and allergen combination, set one of three statuses:
- Contains: The ingredient definitely contains this allergen
- May Contain: Risk of cross-contamination (e.g. processed in same facility)
- Free From: No allergen present

Allergen status is set at ingredient level in Inventory → Allergens (the matrix view). The status propagates through recipes to menus: if any ingredient in a recipe contains an allergen, the recipe and its menu items are flagged.

---

## Recipes: Building and Costing Dishes

Recipes define the ingredients and quantities that make a dish. The system calculates cost per portion for each recipe using live vendor pricing per market.

How to create a recipe:
Step 1 — Create the recipe header: Give it a name, assign a recipe category, set yield quantity and yield unit (e.g. 4 portions). The yield divides total cost to give cost per portion.

Step 2 — Add ingredient lines: Click Add Item, choose Ingredient, select the ingredient, and enter the quantity in the ingredient's prep unit (e.g. 150 g of flour). The system converts prep to base unit automatically.

Step 3 — Add sub-recipes (optional): Set item type to Recipe and select a sub-recipe. Useful for pre-made sauces, marinades, or components shared across multiple dishes. Sub-recipe cost is calculated recursively.

Step 4 — Select a market: Use the market selector dropdown to view COGS for a specific country. The preferred vendor quote for each ingredient in that market is used.

If an ingredient has no active quote in the selected market, its line cost shows £0.00 and is flagged. These gaps also appear on the Dashboard Missing Quotes panel.

---

## Understanding How Recipe COGS is Calculated

The COGS calculation for a recipe line item:

1. Get the quantity in prep units (e.g. 200 g of chicken)
2. Convert to base units: 200 / 1000 = 0.2 kg
3. Apply waste adjustment: 0.2 / (1 - 0.25) = 0.267 kg effective
4. Get effective price from preferred vendor or lowest active quote
5. Line cost = 0.267 × price per kg

Sum all line costs, then divide by yield quantity = cost per portion.

The effective price formula: effective_price = purchase_price / qty_in_base_units

This converts the vendor's pack price to a price per base unit (e.g. £15.00 for a 12.5 kg sack = £1.20 per kg).

---

## Menus: Building the Menu Builder

Menus are the top-level sales unit. Each menu belongs to a market/country and contains menu items (recipes or individual ingredients). The Menus page has three tabs.

Tab 1 — Menu Builder: Create menus and add items to them. Each item carries a display name (what appears to the customer), a link to a recipe or ingredient, and a sort order for consistent menu sequencing.

To add an item to a menu: select the menu from the dropdown, click Add Item, choose whether it links to a recipe or ingredient, enter the display name, and set sort order.

---

## PLT: Setting Sell Prices with Currency Conversion

The Price Level Table (PLT) is where you set sell prices for each menu item and price level combination. For example: Classic Burger — Eat-in: £12.50, Takeout: £11.50, Delivery: £13.00.

All prices are stored in USD. When you enter a price in the PLT, enter it in the display currency (local market currency). The system converts to USD for storage.

Currency conversion formula:
- Display to stored: stored_USD = displayed_price / dispRate
- Stored to display: displayed_price = stored_USD × dispRate
- dispRate = market.exchange_rate / baseCurrency.exchange_rate

If you see a price displaying incorrectly, check that the market's exchange rate is correct in Markets. Use Settings → Exchange Rates → Sync to fetch live rates.

---

## MPT: Analysing Menu Performance and COGS Percentage

The Menu Performance Table (MPT) shows COGS% for each menu item and price level, colour-coded against your target thresholds.

COGS% = (Recipe Cost ÷ Sell Price excl. tax) × 100

Colour coding:
- Green: COGS% is at or below your target (e.g. ≤ 30%) — Good
- Amber: COGS% is between target and target + 10% (e.g. 30–40%) — Acceptable
- Red: COGS% is above target + 10% (e.g. > 40%) — Alert

Both gross (including tax) and net (excluding tax) sell prices are shown. The COGS% is calculated against the net (ex-tax) sell price because tax is collected on behalf of the government, not revenue.

Set your target COGS threshold in Settings → COGS Thresholds. A typical quick-service restaurant target is 28–32% food cost.

---

## Allergen Matrix: EU FIC Menu Declaration

The Allergen Matrix page generates a menu-level allergen declaration compliant with EU Regulation 1169/2011 and UK Food Information Regulations. It maps all 14 regulated allergens across every item on a selected menu.

How to use:
1. Select a menu from the dropdown
2. Optionally filter by recipe category to focus on a section (e.g. just Desserts)
3. The matrix shows columns (14 allergens) and rows (menu items)
4. Bold = Contains, italic = May Contain, blank = Free From

Printing: Click Print to open the browser print dialog. The sidebar and navigation are hidden automatically. The matrix scales to A4 landscape. The printed sheet is suitable for customer-facing display or authority inspection.

The allergen status propagates from ingredients through recipes to menu items. If any ingredient in a recipe contains an allergen, the menu item is flagged as Contains.

---

## HACCP: Food Safety Records

The HACCP module enables franchise locations to manage food safety records digitally. All records are scoped to a Location — select a location from the top dropdown before adding records.

Equipment Register: Register all refrigeration, cooking, and holding equipment at each location. Equipment records capture type, description, and location. Each piece of equipment can then have temperature logs attached.

Temperature Logs: Log temperature readings against specific equipment. Each log captures temperature (in Celsius or Fahrenheit), timestamp, and any corrective actions taken. Readings outside the safe range should include a corrective action note. Full history is retained per equipment item.

CCP Logs (Critical Control Points): Log key food safety checks — cooking temperatures, cooling records, delivery temperatures. Each CCP log records the type, measured value, pass/fail status, and corrective action notes. All CCP logs are location-scoped.

HACCP Reports: The Report tab aggregates all equipment and CCP log data for a selected location into a printable summary. Use this for local authority inspections, internal audits, or franchise compliance reviews.

---

## Settings: Units, Price Levels and Exchange Rates

Units of Measurement: Define the units used across the system. Common units are pre-seeded (kg, g, litre, ml, each). Each unit has a type: mass, volume, or count. Units are assigned to ingredients as their base unit.

Price Levels: Create and manage price levels (Eat-in, Takeout, Delivery, etc.). One level is marked as default. Changing the default is an atomic database transaction to avoid conflicts. Price levels drive the PLT and MPT columns in Menus.

Exchange Rates: Click Sync Exchange Rates to fetch live rates from the Frankfurter API (free, no API key needed). Rates are stored against each market country. Base currency is USD — all rates are stored as units per 1 USD. For example, if USD to GBP is 0.79, the UK market should have exchange_rate = 0.79.

COGS Thresholds: Set the target COGS% for colour-coding in the Menu Performance Table. The three bands are Excellent (green, at or below target), Acceptable (amber, target to target+10%), and Alert (red, above acceptable). A typical QSR target is 28–32% food cost.

System tab: Shows database information and provides tools for test data management.

---

## COGS Thresholds: Target Food Cost Percentages

COGS thresholds determine the colour-coding in the Menu Performance Table (MPT). They are set in Settings → COGS Thresholds.

Three threshold bands:
- Excellent (green): COGS% is at or below your target percentage — the item is well-priced
- Acceptable (amber): COGS% is between the target and target plus 10 percentage points — acceptable but worth reviewing
- Alert (red): COGS% is above the acceptable band — the item is likely underpriced or ingredient cost has risen

Example: If target is 30%, then Excellent = ≤30%, Acceptable = 30–40%, Alert = >40%.

A typical quick-service restaurant target food cost is 28–32%. Fine dining may target 35–40% due to higher ingredient quality. Delivery channels typically need lower COGS% due to platform commission fees.

If an item shows amber or red, options are: (1) raise the sell price in PLT, (2) reduce recipe portion size, (3) switch to a lower-cost ingredient or vendor, (4) negotiate a better vendor price.

---

## AI Assistant: What It Can and Cannot Do

The COGS Assistant is a floating AI chat widget at the bottom-right of every page. It is powered by Claude Haiku 4.5 and uses two knowledge layers: vectorised documentation (RAG) and live database tools.

The AI can answer questions about:
- Ingredient costs, recipe COGS%, and menu performance — using live database tools
- How features work, setup instructions, process explanations — using documentation RAG
- Troubleshooting guidance — using documentation RAG
- Feedback submission (bug reports, feature requests) — using live database tool

The AI cannot directly query:
- Markets, vendors, categories, settings, tax rates — no live tools for these
- HACCP equipment and logs — no live tools for these
- Locations and location groups — no live tools for these
- Its own previous conversation history beyond the current chat session

For the best results, ask about ingredient costs, recipe costs, menu COGS%, or coverage stats for live data answers. Ask "how do I..." or "what does X mean?" for documentation-based answers.

---

## AI Assistant: Vectorised Knowledge (RAG)

RAG stands for Retrieval-Augmented Generation. At API startup, the system reads two markdown source files, splits them into sections by double-hash (##) headings, and embeds each section using Voyage AI's voyage-3-lite model.

Source files indexed for RAG:
1. CLAUDE.md — technical project documentation: infrastructure, CI/CD, database schema, code patterns, known bugs, deployment
2. docs/user-guide.md — this file: user tutorials, workflow guides, field explanations, troubleshooting, FAQ

When you ask a question, the query is also embedded and compared to all stored section vectors using cosine similarity. The top 4 most relevant sections are retrieved and injected into Claude's system prompt as context before Claude sees your question.

Fallback behaviour: If no Voyage AI key is configured, the system falls back to keyword frequency search (simple word scoring over section text). Less accurate but still functional. Configure the Voyage key in Settings → AI for semantic search quality.

What RAG does not cover: RAG does not index live data (ingredients, recipes, prices, menus). That is handled by database tools. RAG also does not update automatically when you change settings or add ingredients — it only covers these static documentation files.

---

## AI Assistant: Live Database Tools

Claude has 9 tools that run real queries against the live mcogs PostgreSQL database. Tools are called automatically when Claude determines it needs data to answer your question.

get_dashboard_stats: Returns total counts of ingredients, recipes, menus, vendors, markets, and the price quote coverage percentage. Queries all mcogs_ tables.

list_ingredients: Lists all ingredients with id, name, and category. Accepts an optional name search filter (case-insensitive partial match). Use this before get_ingredient to find an ID.

get_ingredient: Returns full details for a single ingredient including nutrition data, all vendor price quotes (active and inactive), and allergen statuses for all 14 EU FIC allergens. Requires ingredient ID.

list_recipes: Lists all recipes with id and name. Accepts an optional name search filter.

get_recipe: Returns a recipe with all its ingredient lines, quantities, units, and the cost breakdown per country. Uses preferred vendor pricing per market. Requires recipe ID.

list_menus: Lists all menus with id, name, and market (country) name.

get_menu_cogs: Returns all menu items for a specific menu with their sell prices per price level and the calculated COGS% per item per price level. Requires menu ID.

get_feedback: Returns submitted feedback tickets. Filterable by type (bug, feature, general) and status (open, in_progress, resolved).

submit_feedback: Creates a new feedback record in the database. This is the only write operation the AI can perform. Requires type and title. Submitting feedback through the AI is equivalent to submitting via the app UI.

---

## Troubleshooting: COGS Showing Zero

If recipe COGS or menu COGS shows £0.00 for an ingredient line:

Cause 1 (most common): The ingredient has no active price quote for the selected market. Solution: Go to Inventory → Price Quotes, find the ingredient, and add an active quote from a vendor in that market. Then set a preferred vendor for that ingredient in that market.

Cause 2: There is a price quote but it is marked is_active = false. Solution: Edit the quote and toggle it to active.

Cause 3: A preferred vendor was set but the quote was later deactivated. Solution: Go to Inventory → Price Quotes, set a new preferred vendor with an active quote.

Cause 4: The ingredient has no preferred vendor set and no active quotes at all. Solution: Add a vendor for the market, add a price quote, set it as active, then assign as preferred vendor.

The Dashboard Missing Quotes panel lists the top 10 ingredients with no active quotes anywhere — check this first.

---

## Troubleshooting: PLT Currency Issues

If prices in the Price Level Table (PLT) appear in the wrong currency or the wrong amount:

Cause 1: The market has an incorrect exchange rate. Solution: Go to Markets, check the exchange rate for that country. The rate should be units of the local currency per 1 USD (e.g. GBP: 0.79, EUR: 0.92). Use Settings → Exchange Rates → Sync to fetch live rates.

Cause 2: You entered a price in PLT but it saved incorrectly. Solution: The PLT converts your entered value from display currency to USD for storage using dispRate = market.rate / baseCurrency.rate. If the market rate is wrong, re-enter the price after correcting the exchange rate.

Cause 3: The target currency selector in PLT is set to the wrong currency. Solution: Check the currency dropdown at the top of the PLT tab and ensure the correct target currency is selected.

---

## Troubleshooting: AI Assistant Not Working

If the AI assistant shows "API key not configured": Go to Settings → AI tab and enter your Anthropic API key (starts with sk-ant-...). Get one at console.anthropic.com. The key is stored securely in the database.

If the AI assistant is unresponsive or times out: The Anthropic API may be temporarily unavailable. Try again in a few minutes. Check status at status.anthropic.com.

If the AI gives vague or incorrect answers about your data: The AI relies on database tools for live data. If asking about a specific ingredient, recipe, or menu, make sure you're asking clearly (include the name). The AI will call list_ingredients or list_recipes first to find the ID, then fetch details.

If the Voyage AI key is not set, the RAG falls back to keyword search which may retrieve less relevant documentation sections. Configure the Voyage key in Settings → AI for better context quality.

---

## Troubleshooting: Login and Auth Issues

If Auth0 login fails with a callback URL mismatch error: In the Auth0 dashboard (manage.auth0.com), go to Applications → your app → Settings. Ensure both https://obscurekitty.com and http://localhost:5173 are listed in Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.

If the login page loads but clicking Google OAuth does nothing: Google OAuth must be configured in the Auth0 dashboard under Authentication → Social. Ensure Google is enabled and the Google client ID and secret are configured.

If users are authenticated but the app shows an empty dashboard: Check the API health at https://obscurekitty.com/api/health. If it returns an error, the Node.js API may be down. SSH to the server and run: pm2 status and pm2 restart menu-cogs-api.

---

## Troubleshooting: Deployment and Server Issues

If the GitHub Actions CI/CD deploy fails at the health check step:
1. SSH into the server as the ubuntu user
2. Run pm2 status — confirm menu-cogs-api is running and online
3. Run curl http://localhost:3001/api/health — should return {"status":"ok"}
4. Run pm2 logs menu-cogs-api --lines 50 — look for startup errors
5. If the API crashed, check for missing environment variables in /var/www/menu-cogs/api/.env

If Nginx is not serving the app:
1. Run sudo nginx -t to test the configuration
2. Run sudo nginx -s reload to reload
3. Check logs at /var/log/nginx/error.log

If the SSL certificate has expired:
1. Run sudo certbot renew --dry-run to test
2. Run sudo certbot renew to force renewal
3. Reload Nginx after renewal

Exchange rate sync failing: The Frankfurter API (api.frankfurter.app) is free with no key. Test from the server: curl https://api.frankfurter.app/latest. If blocked, check AWS Lightsail networking firewall rules for outbound HTTPS.

---

## How to Add a New Page to the Application

Adding a new page requires changes to both the API and the frontend.

Backend steps:
1. Create api/src/routes/newpage.js with CRUD route handlers
2. Register it in api/src/routes/index.js: router.use('/newpage', require('./newpage'))
3. If the page needs new database tables, add them to api/scripts/migrate.js and run npm run migrate

Frontend steps:
4. Create app/src/pages/NewPage.tsx following the standard page pattern: import useApi, load data in useEffect with useCallback, display with PageHeader and Modal from ui.tsx
5. Import NewPage in app/src/App.tsx and add: Route path="newpage" element={NewPage}
6. Add a nav item to app/src/components/Sidebar.tsx in the NAV_ITEMS array with a path, label, and SVG icon path

Deployment:
7. Push to main branch — GitHub Actions CI/CD auto-builds and deploys
8. Monitor the Actions tab in GitHub for build status
9. Verify at https://obscurekitty.com/newpage

---

## Server Management Commands

Connect to the server: SSH as ubuntu user to the server IP or domain.

Process management:
- pm2 status — check if API is running
- pm2 restart menu-cogs-api — restart after config changes
- pm2 logs menu-cogs-api --lines 50 — view recent API logs
- pm2 save — persist PM2 process list across reboots

Web server:
- sudo nginx -t — test Nginx configuration
- sudo nginx -s reload — reload Nginx after config changes
- sudo nginx -s stop then sudo nginx — full restart

Database:
- psql -U mcogs -d mcogs — connect to PostgreSQL
- cd /var/www/menu-cogs/api and npm run migrate — run DB migrations (safe to repeat)

SSL:
- sudo certbot renew --dry-run — test Let's Encrypt renewal
- sudo certbot renew — force certificate renewal

Health check:
- curl https://obscurekitty.com/api/health — should return {"status":"ok"}
- curl http://localhost:3001/api/health — direct API check bypassing Nginx

---

## Exchange Rate Sync and Currency Conversion Explained

Exchange rates are fetched from the Frankfurter API (api.frankfurter.app). This is a free service with no API key required. All rates are relative to USD as the base currency.

To sync rates: Go to Settings → Exchange Rates → click Sync Exchange Rates. The system fetches current rates for all currencies used in your configured markets and updates them in the database.

How rates are stored: Each market/country has an exchange_rate field. This is the number of local currency units per 1 USD. For example: UK (GBP) = 0.79 means £0.79 = $1.00.

Display conversion formula: dispRate = market.exchange_rate / targetCurrency.exchange_rate

Entering prices in PLT: When you type £12.50 in the PLT for a UK menu, the system stores it as: 12.50 / dispRate (in USD). When displaying it back, it multiplies by dispRate to show the local price again.

Cross-currency PLT: If you select a different target currency (e.g. viewing a UK menu with EUR prices), dispRate uses both the UK rate and EUR rate to convert between them.

Why prices look wrong after changing exchange rates: The stored USD values do not change when you update exchange rates. Only the display conversion changes. If rates shift significantly, you may want to re-enter prices in PLT to ensure they are correct at current rates.

---

## Understanding the Coverage Percentage

Price quote coverage is the percentage of ingredients in the system that have at least one active price quote with a preferred vendor assignment (or at least one active quote if no preferred vendor is set).

Coverage = (ingredients with active quote / total ingredients) × 100

Why coverage matters: If coverage is below 100%, some ingredients have no pricing data. Any recipe containing those ingredients will show a partial or zero COGS. The Dashboard Missing Quotes panel shows the most critical gaps.

How to improve coverage:
1. Check the Missing Quotes panel on the Dashboard for the top unpriced ingredients
2. Go to Inventory → Price Quotes and add a quote from a vendor
3. Set the quote as active (is_active = true)
4. Optionally set a preferred vendor in the same tab

Coverage is calculated globally (not per market). An ingredient counts as covered if it has at least one active quote anywhere, even if that vendor does not serve all markets.
