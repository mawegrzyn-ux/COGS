import { useState, useEffect } from 'react'

// ─── Utility components ──────────────────────────────────────────────────────

function MethodBadge({ method }: { method: string }) {
  const c: Record<string, string> = {
    GET:    'bg-blue-100 text-blue-700',
    POST:   'bg-green-100 text-green-700',
    PUT:    'bg-amber-100 text-amber-700',
    PATCH:  'bg-orange-100 text-orange-700',
    DELETE: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${c[method] ?? 'bg-gray-100 text-gray-700'}`}>
      {method}
    </span>
  )
}

type InfoType = 'info' | 'tip' | 'warning' | 'critical'
function InfoBox({ type = 'info', title, children }: { type?: InfoType; title?: string; children: React.ReactNode }) {
  const cfg: Record<InfoType, { border: string; bg: string; icon: string; def: string; tc: string }> = {
    info:     { border: 'border-blue-200',  bg: 'bg-blue-50',    icon: 'ℹ️', def: 'Note',     tc: 'text-blue-800' },
    tip:      { border: 'border-[#146A34]/30', bg: 'bg-[#E8F5ED]', icon: '💡', def: 'Tip',    tc: 'text-[#146A34]' },
    warning:  { border: 'border-amber-200', bg: 'bg-amber-50',   icon: '⚠️', def: 'Warning',  tc: 'text-amber-800' },
    critical: { border: 'border-red-200',   bg: 'bg-red-50',     icon: '🚨', def: 'Critical', tc: 'text-red-800' },
  }
  const { border, bg, icon, def, tc } = cfg[type]
  return (
    <div className={`border ${border} ${bg} rounded-lg px-4 py-3 my-3`}>
      <p className={`text-xs font-bold mb-1 ${tc}`}>{icon} {title ?? def}</p>
      <div className={`text-xs leading-relaxed ${tc}`}>{children}</div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 my-3">
      <div className="w-6 h-6 rounded-full bg-[#146A34] text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</div>
      <div>
        <p className="font-semibold text-sm text-[#0F1F17]">{title}</p>
        <p className="text-sm text-[#2D4A38] mt-0.5">{children}</p>
      </div>
    </div>
  )
}

function ProcessFlow({ steps }: { steps: { label: string; sub?: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 my-4 p-3 bg-white border border-[#D8E6DD] rounded-lg">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="bg-[#E8F5ED] border border-[#146A34]/20 rounded px-2.5 py-1.5 text-center">
            <div className="text-xs font-bold text-[#146A34]">{s.label}</div>
            {s.sub && <div className="text-[10px] text-[#6B7F74] leading-tight mt-0.5">{s.sub}</div>}
          </div>
          {i < steps.length - 1 && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6B7F74" strokeWidth="2.5" strokeLinecap="round">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          )}
        </div>
      ))}
    </div>
  )
}

function H2({ id, icon, title }: { id: string; icon: string; title: string }) {
  return (
    <h2 id={id} className="text-lg font-bold text-[#0F1F17] mt-10 mb-3 pb-2 border-b-2 border-[#146A34]/20 flex items-center gap-2 scroll-mt-4">
      <span className="text-xl">{icon}</span> {title}
    </h2>
  )
}

function H3({ id, children }: { id: string; children: React.ReactNode }) {
  return <h3 id={id} className="font-bold text-[#0F1F17] mt-5 mb-2 text-sm scroll-mt-4">{children}</h3>
}

function Mono({ children }: { children: string }) {
  return (
    <code className="bg-[#F7F9F8] border border-[#D8E6DD] rounded px-1.5 py-0.5 text-[11px] font-mono text-[#2D4A38]">
      {children}
    </code>
  )
}

function Td({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <td className={`py-2 px-3 border-b border-[#D8E6DD]/50 align-top ${mono ? 'font-mono text-[11px] text-[#2D4A38]' : 'text-sm text-[#2D4A38]'}`}>
      {children}
    </td>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2 px-3 text-xs font-bold text-[#6B7F74] text-left bg-[#F7F9F8] border-b border-[#D8E6DD]">{children}</th>
}

// ─── Navigation config ────────────────────────────────────────────────────────

const SECTIONS = [
  { id: 'quick-start',      icon: '🚀', label: 'Quick Start' },
  { id: 'dashboard',        icon: '📊', label: 'Dashboard' },
  { id: 'markets',          icon: '🌍', label: 'Markets' },
  { id: 'categories',       icon: '🏷️', label: 'Categories' },
  { id: 'inventory',        icon: '📦', label: 'Inventory' },
  { id: 'recipes',          icon: '🍽️', label: 'Recipes' },
  { id: 'menus',            icon: '📋', label: 'Menus' },
  { id: 'allergen-matrix',  icon: '⚠️', label: 'Allergen Matrix' },
  { id: 'haccp',            icon: '🛡️', label: 'HACCP' },
  { id: 'settings',         icon: '⚙️', label: 'Settings' },
  { id: 'user-management',  icon: '👥', label: 'User Management' },
  { id: 'ai-assistant',     icon: '🤖', label: 'Pepper (AI)' },
  { id: 'architecture',     icon: '🏗️', label: 'Architecture' },
  { id: 'api-reference',    icon: '📡', label: 'API Reference' },
  { id: 'security',         icon: '🔒', label: 'Security' },
  { id: 'troubleshooting',  icon: '🔧', label: 'Troubleshooting' },
  { id: 'domain-migration', icon: '🌐', label: 'Domain Migration' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function HelpPage() {
  const [active, setActive] = useState('quick-start')
  const [search, setSearch] = useState('')

  // Track active section as user scrolls within `main`
  useEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const onScroll = () => {
      let cur = SECTIONS[0].id
      for (const sec of SECTIONS) {
        const el = document.getElementById(sec.id)
        if (el && el.offsetTop - 100 <= main.scrollTop) cur = sec.id
      }
      setActive(cur)
    }
    main.addEventListener('scroll', onScroll, { passive: true })
    return () => main.removeEventListener('scroll', onScroll)
  }, [])

  function scrollTo(id: string) {
    const main = document.querySelector('main')
    const el = document.getElementById(id)
    if (el && main) {
      main.scrollTo({ top: el.offsetTop - 16, behavior: 'smooth' })
    }
    setActive(id)
  }

  const filtered = SECTIONS.filter(s =>
    search === '' || s.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex">

      {/* ── TOC sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="w-52 shrink-0 border-r border-[#D8E6DD] bg-white overflow-y-auto"
        style={{ position: 'sticky', top: 0, height: '100vh', alignSelf: 'flex-start' }}
      >
        <div className="px-4 py-3 border-b border-[#D8E6DD]">
          <p className="text-xs font-bold text-[#0F1F17]">Help Centre</p>
          <p className="text-[10px] text-[#6B7F74] mt-0.5">COGS Manager v2.3</p>
        </div>
        <div className="px-2 pt-2">
          <input
            type="search"
            placeholder="Search topics…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full text-xs rounded border border-[#D8E6DD] px-2.5 py-1.5 outline-none focus:border-[#146A34] bg-[#F7F9F8] placeholder-[#6B7F74]"
          />
        </div>
        <nav className="p-1.5 pb-4">
          {filtered.map(s => (
            <button
              key={s.id}
              onClick={() => scrollTo(s.id)}
              className={`w-full text-left px-2.5 py-1.5 rounded text-xs font-medium transition-colors mb-0.5
                ${active === s.id
                  ? 'bg-[#E8F5ED] text-[#146A34] font-semibold'
                  : 'text-[#2D4A38] hover:bg-[#F7F9F8] hover:text-[#0F1F17]'
                }`}
            >
              {s.icon} {s.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="flex-1 px-8 py-6 pb-24 max-w-3xl">

        {/* ═══════════════════════════════════ QUICK START */}
        <H2 id="quick-start" icon="🚀" title="Quick Start" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          <strong>COGS Manager</strong> is a menu cost-of-goods calculator for restaurant franchise operators.
          It delivers accurate, real-time food cost visibility across menus, recipes, ingredients, and
          vendor pricing — segmented by market and country. Originally a WordPress plugin (v3.3.0),
          it has been rebuilt as a full React + Node.js + PostgreSQL application.
        </p>

        <H3 id="what-you-can-do">What You Can Do</H3>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed">
          <li>Build a <strong>master ingredient library</strong> with waste percentages and prep unit conversions</li>
          <li>Manage <strong>vendor pricing</strong> per ingredient — multiple competing quotes, active/inactive flags</li>
          <li>Assign <strong>preferred vendors by market</strong> so each country uses its best-sourced price</li>
          <li>Build <strong>recipes</strong> with nested sub-recipes and automatic COGS per market</li>
          <li>Construct <strong>menus</strong> and view sell price vs. food cost in multiple currencies</li>
          <li>Generate <strong>allergen matrices</strong> compliant with EU/UK FIC Regulation 1169/2011</li>
          <li>Log <strong>HACCP food safety data</strong> — equipment registers, temperature checks, CCP logs</li>
          <li>Ask the built-in <strong>AI Assistant</strong> questions about your live data in natural language</li>
        </ul>

        <H3 id="recommended-order">Recommended First-Time Setup Order</H3>
        <p className="text-sm text-[#2D4A38] mb-2">Follow this sequence when configuring a fresh instance:</p>
        <ProcessFlow steps={[
          { label: 'Settings', sub: 'Units & price levels' },
          { label: 'Markets', sub: 'Countries, currencies, tax rates' },
          { label: 'Categories', sub: 'Ingredient & recipe types' },
          { label: 'Vendors', sub: 'Supplier accounts' },
          { label: 'Ingredients', sub: 'Master library' },
          { label: 'Price Quotes', sub: 'Vendor pricing' },
          { label: 'Preferred Vendors', sub: 'Best source per market' },
          { label: 'Recipes', sub: 'Build dishes' },
          { label: 'Menus', sub: 'Assemble menus' },
          { label: 'Compare Markets / Market Price Tool', sub: 'Set prices, review COGS' },
        ]} />
        <InfoBox type="tip">
          You must create at least one <strong>Market</strong>, one <strong>Price Level</strong>, and one{' '}
          <strong>Unit</strong> before ingredients and recipes will function correctly.
        </InfoBox>

        <H3 id="navigation">Navigation</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The collapsible left sidebar links to all main pages. Click the <strong>arrow icon</strong> at the top of
          the sidebar to collapse it to icon-only view, freeing horizontal space. Your preference is saved
          in browser local storage. The <strong>AI Assistant</strong> is always accessible via the{' '}
          <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#146A34] text-white text-xs">🤖</span>{' '}
          button in the bottom-right corner of every page.
        </p>

        {/* ═══════════════════════════════════ DASHBOARD */}
        <H2 id="dashboard" icon="📊" title="Dashboard" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The Dashboard gives a live health snapshot of your COGS data. Hit the <strong>Refresh</strong> button
          (top-right) to re-fetch all metrics. The last-updated timestamp is shown next to the button.
        </p>

        <H3 id="kpi-cards">KPI Cards</H3>
        <div className="grid grid-cols-2 gap-2.5 my-3">
          {[
            { label: 'Ingredients',   desc: 'Total distinct ingredients in the master library' },
            { label: 'Recipes',       desc: 'Total recipes built in the system' },
            { label: 'Vendors',       desc: 'Total supplier records across all markets' },
            { label: 'Markets',       desc: 'Active country/market configurations' },
            { label: 'Active Quotes', desc: 'Live price quotes from vendors (is_active = true)' },
            { label: 'Categories',    desc: 'Ingredient and recipe category count' },
            { label: 'Menu Tiles',    desc: 'One clickable tile per menu — shows market, item count, and COGS% per price level, loaded in background' },
            { label: 'Coverage %',    desc: 'Percentage of ingredients with at least one active preferred-vendor quote' },
          ].map(k => (
            <div key={k.label} className="bg-white border border-[#D8E6DD] rounded-lg p-3">
              <p className="text-xs font-bold text-[#146A34]">{k.label}</p>
              <p className="text-xs text-[#6B7F74] mt-0.5 leading-snug">{k.desc}</p>
            </div>
          ))}
        </div>

        <H3 id="coverage-meter">Coverage Meter</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The progress bar shows what percentage of ingredients have an active price quote.
          Green = &gt;80%, Amber = 50–80%, Red = &lt;50%. Low coverage means recipe COGS calculations
          will produce £0 for unpriced ingredients.
        </p>

        <H3 id="missing-quotes">Missing Quotes Panel</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Shows the top 10 ingredients used in recipes that have <em>no active price quote</em> anywhere.
          These are the highest-priority gaps to fill in <strong>Inventory → Price Quotes</strong>.
        </p>

        {/* ═══════════════════════════════════ MARKETS */}
        <H2 id="markets" icon="🌍" title="Markets" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Markets are the core geographic unit. Everything market-specific — vendor pricing, preferred vendors,
          menu sell prices, tax rates, and COGS calculations — is linked to a Market (Country). The Markets page
          consolidates all geographic configuration into one place.
        </p>

        <H3 id="countries-currencies">Countries & Currencies</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Each market stores a <strong>country name</strong>, <strong>ISO currency code</strong> (e.g. GBP),
          <strong> currency symbol</strong> (£), and an <strong>exchange rate vs USD</strong>.
          Exchange rates convert all prices (stored in USD base) to local display currency.
        </p>
        <InfoBox type="info">
          All prices are stored in <strong>USD</strong>. Display conversion:{' '}
          <Mono>dispRate = market.exchange_rate / targetCurrency.exchange_rate</Mono>.
          Sync live rates via <strong>Settings → Exchange Rates</strong>.
        </InfoBox>

        <H3 id="tax-rates">Tax Rates</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Each market supports <strong>multiple tax rates</strong> (e.g. Standard 20%, Reduced 5%, Zero 0%).
          One rate is flagged as <strong>default</strong>. Rates are mapped to price levels via the
          Country-Level Tax junction — for example, UK Delivery might carry 20% VAT while a different
          rate applies to eat-in (cold takeaway food at 0% in the UK).
        </p>

        <H3 id="price-levels-per-market">Price Levels Per Market</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Price levels (Eat-in, Takeout, Delivery) are global but each market has a
          <strong> default price level</strong> pre-selected when viewing menus for that market.
        </p>

        <H3 id="locations">Locations & Location Groups</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Physical store locations are linked to a market and optionally to a <strong>Location Group</strong>
          (e.g. "London Central"). Location Groups allow clustering of sites for reporting. Locations store
          address, contact details, and are the scope for all HACCP records. <strong>Brand Partners</strong>
          (franchise operators) are also associated at the market level.
        </p>

        {/* ═══════════════════════════════════ CATEGORIES */}
        <H2 id="categories" icon="🏷️" title="Categories" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Categories organise your ingredients and recipes into logical groups. There are two category{' '}
          <strong>types</strong>: <em>ingredient</em> and <em>recipe</em>. Each category also has a{' '}
          <strong>Group Name</strong> (e.g. "Dairy", "Produce") to cluster similar categories together.
        </p>
        <InfoBox type="tip">
          Suggested ingredient groups: <strong>Dairy · Proteins · Produce · Dry Goods · Beverages ·
          Sauces & Condiments · Packaging · Cleaning</strong>. Suggested recipe categories:
          <strong> Mains · Sides · Desserts · Drinks · Sauces</strong>.
        </InfoBox>
        <InfoBox type="info">
          Category Group Names are currently stored as flat strings. A future migration will introduce a
          proper hierarchical <Mono>mcogs_category_groups</Mono> table with parent-child nesting.
        </InfoBox>

        {/* ═══════════════════════════════════ INVENTORY */}
        <H2 id="inventory" icon="📦" title="Inventory" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Inventory has four tabs: <strong>Ingredients</strong>, <strong>Price Quotes</strong>,
          <strong> Vendors</strong>, and <strong>Allergens</strong>. This is where the foundation of
          all recipe costing is built.
        </p>

        <H3 id="ingredients">Ingredients</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Field</Th><Th>Purpose</Th></tr></thead>
          <tbody>
            <tr><Td mono>name</Td><Td>Ingredient name — appears in recipe builder autocomplete</Td></tr>
            <tr><Td mono>category</Td><Td>Ingredient category (created in Categories page)</Td></tr>
            <tr><Td mono>base_unit</Td><Td>The unit all prices are stored in (e.g. kg, litre, each)</Td></tr>
            <tr><Td mono>waste_pct</Td><Td>% of ingredient discarded in preparation (0–100). Increases effective cost per usable unit.</Td></tr>
            <tr><Td mono>default_prep_unit</Td><Td>The unit chefs measure in recipes (e.g. grams, ml)</Td></tr>
            <tr><Td mono>prep_to_base_conversion</Td><Td>How many prep units equal 1 base unit (e.g. 1000 g = 1 kg)</Td></tr>
            <tr><Td mono>notes</Td><Td>Free-text notes for buyers / kitchen team</Td></tr>
            <tr><Td mono>nutrition fields</Td><Td>Optional kcal, protein, fat, carbs, sugar, salt per 100g — sourced from USDA FoodData Central</Td></tr>
          </tbody>
        </table>

        <H3 id="waste-prep">Understanding Waste % and Prep Conversion</H3>
        <ProcessFlow steps={[
          { label: 'Purchase price', sub: '£2.00 / kg' },
          { label: '÷ (1 − waste%)', sub: '÷ 0.80 (20% waste)' },
          { label: 'Effective cost', sub: '£2.50 / kg usable' },
          { label: '× recipe qty', sub: '× 0.150 kg' },
          { label: 'Line cost', sub: '£0.375 / portion' },
        ]} />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          A 20% waste factor means for every 1 kg purchased, only 800 g is usable. The system
          adjusts cost per usable unit automatically so recipe COGS reflects true food cost, not
          just purchase price.
        </p>

        <H3 id="vendors">Vendors</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Vendors are ingredient suppliers, each linked to a <strong>country/market</strong>. You can have
          multiple vendors per market and multiple vendors offering the same ingredient at competing prices.
          Vendor records store name, country, and optional contact details.
        </p>

        <H3 id="price-quotes">Price Quotes</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Field</Th><Th>Purpose</Th></tr></thead>
          <tbody>
            <tr><Td mono>ingredient</Td><Td>The ingredient this quote is for</Td></tr>
            <tr><Td mono>vendor</Td><Td>The supplier offering this price</Td></tr>
            <tr><Td mono>purchase_price</Td><Td>Price paid per purchase unit (in local currency, converted to USD on save)</Td></tr>
            <tr><Td mono>qty_in_base_units</Td><Td>How many base units per purchase unit (e.g. 12.5 kg per sack)</Td></tr>
            <tr><Td mono>purchase_unit</Td><Td>The unit the vendor sells in (sack, case, litre, each, etc.)</Td></tr>
            <tr><Td mono>is_active</Td><Td>Only active quotes contribute to COGS calculations and coverage metrics</Td></tr>
            <tr><Td mono>vendor_product_code</Td><Td>Optional vendor SKU / order code</Td></tr>
          </tbody>
        </table>

        <H3 id="menu-filter">Menu Filter</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Both the <strong>Ingredients</strong> and <strong>Price Quotes</strong> tabs include a{' '}
          <strong>Filter by menu</strong> dropdown in the toolbar. Selecting a menu resolves all
          ingredient IDs used in that menu's recipe items and narrows the displayed list to only those
          ingredients (and their quotes). Useful when checking coverage or prices for a specific menu
          before launch.
        </p>
        <InfoBox type="info">
          The filter resolves one level of recipe nesting — direct ingredient items on recipe lines.
          Sub-recipes of sub-recipes are not followed. Clear the filter to return to the full list.
          The menu filter is hidden on the Price Quotes tab when "Missing quotes only" is active.
        </InfoBox>

        <H3 id="preferred-vendors">Preferred Vendors</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          For each <strong>ingredient × market</strong> combination you can designate a Preferred Vendor —
          the single quote used for COGS calculations in that market. There is a unique constraint:
          one preferred vendor record per ingredient per country.
        </p>
        <InfoBox type="tip">
          If no preferred vendor is set for an ingredient in a market, the system automatically falls back
          to the <strong>lowest active quote</strong> for that ingredient. Set preferred vendors to
          ensure COGS reflects the actual supplier each franchise uses.
        </InfoBox>

        <H3 id="allergens-inventory">Allergens</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The Allergens tab displays a matrix of all ingredients vs. the 14 EU/UK FIC regulated allergens.
          For each cell you can set one of three statuses:
        </p>
        <div className="flex gap-3 my-3 flex-wrap">
          <span className="inline-block bg-green-100 text-green-800 text-xs font-semibold px-3 py-1 rounded-full">Contains</span>
          <span className="inline-block bg-amber-100 text-amber-800 text-xs font-semibold px-3 py-1 rounded-full">May Contain</span>
          <span className="inline-block bg-gray-100 text-gray-600 text-xs font-semibold px-3 py-1 rounded-full">Free From</span>
        </div>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The 14 regulated allergens: <em>Celery, Cereals containing gluten, Crustaceans, Eggs, Fish,
          Lupin, Milk, Molluscs, Mustard, Peanuts, Sesame, Soybeans, Sulphur dioxide/Sulphites, Tree nuts.</em>
        </p>

        {/* ═══════════════════════════════════ RECIPES */}
        <H2 id="recipes" icon="🍽️" title="Recipes" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Recipes define the ingredients (and quantities) that make a dish. The system calculates{' '}
          <strong>cost per portion</strong> for each recipe using live vendor pricing per market. Recipes
          support nested sub-recipes — a sauce recipe can be an ingredient inside a main-dish recipe.
        </p>

        <H3 id="recipe-builder">Building a Recipe</H3>
        <Step n={1} title="Create the recipe header">
          Name, recipe category, yield quantity and yield unit (e.g. 4 portions). The yield divides total cost
          to give cost per portion.
        </Step>
        <Step n={2} title="Add ingredient lines">
          Click Add Item → Ingredient. Select the ingredient and enter the quantity in the ingredient's
          prep unit (e.g. 150 g of flour). The system converts prep → base unit via the conversion factor
          and applies waste % to get the true cost.
        </Step>
        <Step n={3} title="Add sub-recipes (optional)">
          Set item type to Recipe and select a sub-recipe. Useful for pre-made sauces, marinades, or
          components shared across multiple dishes. Sub-recipe cost is costed recursively.
        </Step>
        <Step n={4} title="Select a market">
          Use the market selector dropdown to view COGS for a specific country. The preferred vendor
          quote for each ingredient in that market is used for the calculation.
        </Step>

        <H3 id="cogs-recipe">How Recipe COGS is Calculated</H3>
        <ProcessFlow steps={[
          { label: 'Recipe qty', sub: 'e.g. 150 g' },
          { label: '÷ prep-to-base', sub: '÷ 1000 → 0.15 kg' },
          { label: '÷ (1 − waste%)', sub: 'effective qty' },
          { label: '× vendor price', sub: 'preferred or lowest' },
          { label: '= line cost' },
          { label: 'Σ all lines' },
          { label: '÷ yield qty', sub: 'cost per portion' },
        ]} />
        <InfoBox type="info">
          If an ingredient has no active quote in the selected market, its line cost shows £0.00 and is
          flagged. These gaps also appear on the Dashboard Missing Quotes panel.
        </InfoBox>

        {/* ═══════════════════════════════════ MENUS */}
        <H2 id="menus" icon="📋" title="Menus" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Menus are the top-level sales unit. Each menu belongs to a <strong>market/country</strong> and
          contains menu items (recipes or individual ingredients). The Menus page has four tabs.
        </p>

        <H3 id="menu-builder">Tab 1 — Menu Builder</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Create menus and add items to them. Each item carries a <strong>display name</strong> (what
          appears to the customer), a link to a recipe or ingredient, and a <strong>sort order</strong> for
          consistent menu sequencing.
        </p>

        <H3 id="menu-engineer">Tab 2 — Menu Engineer</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The Menu Engineer models your menu's sales mix, revenue, and profitability. Select a menu and a price level (or "All Levels") to see every item's cost, sell price, and COGS%. Selecting a menu in the Builder tab automatically syncs the selection here and vice versa.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Qty Sold</strong> — enter quantities per item to model your sales mix. Revenue, COGS%, and grand totals update in real time.</li>
          <li><strong>Mix Manager</strong> — opens a modal to set quantities or enter a revenue target for auto-distribution. Pre-populates with any quantities already entered.</li>
          <li><strong>Price overrides</strong> — type a new price directly into any Price cell to override the live menu price for this scenario only. The live menu price in Compare Markets is unchanged until you use Push Prices.</li>
          <li><strong>Push Prices</strong> — permanently writes the scenario's price overrides back to the live menu. Confirm carefully — this replaces live prices.</li>
          <li><strong>What If tool</strong> — apply a % uplift or reduction across all prices or all costs simultaneously. Models "what if food costs rise 5%?" or "what if we raise all prices 10%?".</li>
          <li><strong>Scenarios</strong> — save named snapshots of the current quantities, price overrides, and notes. Reload any scenario to restore the full state. Delete scenarios you no longer need.</li>
          <li><strong>Collapsible categories</strong> — click any category row to collapse/expand its items. Use ▼ All / ▶ All beside the Item header to toggle all at once.</li>
          <li><strong>Currency symbols</strong> shown in column headers (e.g. Cost/ptn (£)) based on the selected menu's market.</li>
        </ul>
        <H3 id="me-notes-history">Notes, History &amp; Comments</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Click the clock icon (<strong>Notes / History</strong>) to open the panel. Three tabs:
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Notes</strong> — free-text scratchpad saved with the scenario. Use for pricing rationale, assumptions, or review commentary.</li>
          <li><strong>History</strong> — timestamped log of local actions (price resets, cost resets, qty resets, What If applications, pushes). Also shows a <em>Shared View Edits</em> sub-section with every price change made by external reviewers via shared links (user, item, price level, old → new value).</li>
          <li><strong>Comments</strong> — all text comments posted by reviewers via any shared link linked to this menu/scenario. Comments from multiple shared views are merged into one feed. You can post new comments and reply to existing ones directly from here. Replies are automatically routed to the same shared view the original comment came from. The badge count shows only text comments — price change events appear in History.</li>
        </ul>
        <H3 id="shared-links">Shared Links</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Click <strong>🔗 Share</strong> (or the Shared Links tab) to create password-protected public links for external reviewers. Recipients visit <Mono>{'/share/<slug>'}</Mono>, enter the password, and see the pricing grid.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>View mode</strong> — read-only; recipients see prices and COGS% but cannot edit.</li>
          <li><strong>Edit mode</strong> — recipients can type new sell prices into the grid. Each change is logged and appears in the ME History tab as a Shared View Edit.</li>
          <li><strong>Scenario lock</strong> — optionally pin a shared link to a specific scenario. The link shows scenario prices instead of live menu prices.</li>
          <li><strong>Expires</strong> — optional expiry date. The link becomes inaccessible after this date.</li>
          <li><strong>Multiple views per scenario</strong> — create several links for the same menu/scenario (e.g. one per franchisee). Comments and edits from all active matching links are merged in the ME panel automatically.</li>
          <li><strong>Copy link</strong> — click the copy icon to copy the full URL to the clipboard.</li>
        </ul>

        <H3 id="pl-recipes">Price Level Recipes (PL Variations)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          A <strong>Price Level Recipe</strong> is an alternate ingredient list for a recipe that activates only when that recipe is sold under a specific price level. Useful when the same dish uses different ingredients depending on the sales channel (e.g. premium bun for Eat-in, standard bun for Delivery).
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li>Open the recipe, switch the variant selector to <strong>Price Level</strong>, choose a level, then click <strong>⊞ Create PL Variation</strong>.</li>
          <li>Choose to start from a copy of the global recipe or an empty list.</li>
          <li>Edit ingredients for that price level independently. Changes do not affect the global recipe or other variations.</li>
          <li>Priority order in COGS calculations: <strong>PL variation &gt; market variation &gt; global recipe</strong>.</li>
          <li>Use <strong>Copy to Global</strong> to promote a PL variation's ingredients to become the global recipe.</li>
          <li>Use <strong>Delete PL Variation</strong> to revert that price level back to the global recipe.</li>
        </ul>

        <H3 id="plt">Tab 3 — Compare Markets</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Set <strong>sell prices</strong> for each menu item × price level (e.g. Classic Burger —
          Eat-in: £12.50 · Takeout: £11.50 · Delivery: £13.00). Prices are entered in <em>display currency</em>
          and stored in USD.
        </p>
        <InfoBox type="info" title="Currency conversion in Compare Markets">
          <p>Entered value → stored USD: <Mono>stored = displayValue / dispRate</Mono></p>
          <p className="mt-1">Display USD → local: <Mono>display = storedUSD × dispRate</Mono></p>
          <p className="mt-1">where <Mono>dispRate = market.exchange_rate / baseCurrency.exchange_rate</Mono></p>
        </InfoBox>

        <H3 id="mpt">Tab 4 — Market Price Tool</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Shows <strong>COGS%</strong> for each menu item × price level, colour-coded against your target:
        </p>
        <div className="flex gap-4 my-3 flex-wrap text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-green-600"></div>
            <span className="text-[#2D4A38]">≤ Target COGS% — Good</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-amber-500"></div>
            <span className="text-[#2D4A38]">Target → Target+10% — Acceptable</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm bg-red-600"></div>
            <span className="text-[#2D4A38]">&gt; Target+10% — Alert</span>
          </div>
        </div>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          <strong>COGS%</strong> = (Recipe Cost ÷ Sell Price excl. tax) × 100. Both gross (incl. tax) and
          net (excl. tax) sell prices are shown. Set thresholds in <strong>Settings → COGS Thresholds</strong>.
        </p>

        {/* ═══════════════════════════════════ ALLERGEN MATRIX */}
        <H2 id="allergen-matrix" icon="⚠️" title="Allergen Matrix" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The Allergen Matrix page has two tabs: <strong>Inventory</strong> (all ingredients vs. 14 allergens) and <strong>Menu</strong> (allergen matrix for a selected menu, rolling up from ingredient → recipe → menu item). Both matrices have <strong>sticky column headers</strong> and a <strong>sticky first column</strong> so names remain visible when scrolling horizontally.
        </p>

        <H3 id="eu-fic">EU FIC Compliance</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Under EU/UK FIC, all 14 major allergens must be declared in food sold to the public. COGS Manager
          tracks allergen status at ingredient level. The matrix propagates through recipes: if any
          ingredient in a recipe <em>contains</em> an allergen, the recipe and its menu items are flagged.
          <em>May Contain</em> is similarly propagated.
        </p>

        <H3 id="allergen-viewing">Viewing & Filtering</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Select a <strong>menu</strong> to view its allergen matrix. Columns = 14 allergens.
          Rows = menu items. Filter by recipe category to focus on a menu section (e.g. just Desserts).
          The matrix uses bold for <strong>Contains</strong>, italic for <em>May Contain</em>,
          and blank for Free From.
        </p>

        <H3 id="allergen-notes">Allergen Notes</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Both the Inventory and Menu matrices include an editable <strong>Notes</strong> column at the right edge.
          Click into any Notes cell and type free-text notes about allergen specifics for that ingredient or menu item
          (e.g. "sourced from gluten-controlled facility", "contains due to shared fryer"). Notes auto-save on blur
          and are stored on <Mono>mcogs_ingredients.allergen_notes</Mono> (Inventory tab) or{' '}
          <Mono>mcogs_menu_items.allergen_notes</Mono> (Menu tab).
        </p>

        <H3 id="allergen-print">Printing</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Click <strong>Print</strong> to open the browser print dialog. Print-specific CSS hides the sidebar
          and navigation, scales the matrix to A4 landscape, and adds a legend. The printed sheet is
          suitable for customer-facing display or authority inspection.
        </p>

        {/* ═══════════════════════════════════ HACCP */}
        <H2 id="haccp" icon="🛡️" title="HACCP" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The HACCP module enables franchise locations to manage food safety records digitally. All data is
          scoped to a <strong>Location</strong> — select a location from the top dropdown before adding records.
        </p>

        <H3 id="haccp-equipment">Equipment Register</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Register all refrigeration, cooking, and holding equipment at each location. Capture equipment
          type, description, and location. Each registered piece of equipment then has{' '}
          <strong>temperature logs</strong> linked to it.
        </p>

        <H3 id="haccp-temp">Temperature Logs</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Log temperature readings against specific equipment. Each log captures temperature (°C/°F), timestamp,
          and any corrective actions taken. Readings outside safe range should include a corrective action note.
          Full history is retained per equipment item.
        </p>

        <H3 id="haccp-ccp">CCP Logs (Critical Control Points)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Log Critical Control Point checks — cooking temperatures, cooling records, delivery temperatures.
          Each CCP log records the type, measured value, pass/fail status, and corrective action notes.
          All CCP logs are scoped to the selected location.
        </p>

        <H3 id="haccp-reports">HACCP Reports</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The Report tab aggregates all equipment and CCP log data for a selected location and date range
          into a printable summary. Use this for local authority inspections, internal audits, or
          franchise compliance reviews.
        </p>

        {/* ═══════════════════════════════════ SETTINGS */}
        <H2 id="settings" icon="⚙️" title="Settings" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Settings has seven tabs covering system-wide configuration.
        </p>

        <H3 id="units-settings">Units of Measurement</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Define the units used across the system. Common units are pre-seeded (kg, g, litre, ml, each).
          Each unit has a <strong>type</strong>: mass, volume, or count. Units are assigned to ingredients
          as their base unit and used in recipe item quantities.
        </p>

        <H3 id="price-levels-tab">Price Levels</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Create and manage price levels (Eat-in, Takeout, Delivery, etc.). One level is marked as{' '}
          <strong>default</strong> — changing the default is an atomic transaction to avoid conflicts.
          Price levels drive the Compare Markets and Market Price Tool columns in Menus.
        </p>

        <H3 id="exchange-rates-tab">Exchange Rates</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Click <strong>Sync Exchange Rates</strong> to fetch live rates from the{' '}
          <a href="https://www.frankfurter.app" className="text-[#146A34] underline" target="_blank" rel="noreferrer">Frankfurter API</a>{' '}
          (free, no API key needed). Rates are stored against each market country and drive all currency
          conversion across the app. Base currency is USD — all rates are stored as <em>units per 1 USD</em>.
        </p>

        <H3 id="cogs-thresholds-tab">COGS Thresholds</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Set the target COGS% for colour-coding in the Market Price Tool. Three bands:
          <span className="text-green-700 font-semibold"> Excellent</span> (green ≤ target),{' '}
          <span className="text-amber-600 font-semibold">Acceptable</span> (amber, target+10%),{' '}
          <span className="text-red-600 font-semibold">Alert</span> (red, above acceptable). A typical
          QSR target is 28–32% food cost.
        </p>

        <H3 id="ai-settings">AI Configuration</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Key</Th><Th>Required</Th><Th>Purpose</Th><Th>Where to get</Th></tr></thead>
          <tbody>
            <tr>
              <Td mono>ANTHROPIC_API_KEY</Td>
              <Td>Yes</Td>
              <Td>Powers the AI Assistant (Claude Haiku 4.5)</Td>
              <Td><a href="https://console.anthropic.com" className="text-[#146A34] underline" target="_blank" rel="noreferrer">console.anthropic.com</a></Td>
            </tr>
            <tr>
              <Td mono>VOYAGE_API_KEY</Td>
              <Td>No</Td>
              <Td>Enables semantic documentation search (RAG) — improves AI context quality</Td>
              <Td><a href="https://dash.voyageai.com" className="text-[#146A34] underline" target="_blank" rel="noreferrer">dash.voyageai.com</a></Td>
            </tr>
            <tr>
              <Td mono>BRAVE_SEARCH_API_KEY</Td>
              <Td>No</Td>
              <Td>Full web search for Pepper — falls back to DuckDuckGo instant answers if not set</Td>
              <Td><a href="https://brave.com/search/api" className="text-[#146A34] underline" target="_blank" rel="noreferrer">brave.com/search/api</a> (free: 2k/mo)</Td>
            </tr>
            <tr>
              <Td mono>GITHUB_PAT</Td>
              <Td>No</Td>
              <Td>Lets Pepper read and write files in your GitHub repository. Fine-grained PAT with Contents (read/write) + Pull requests (read/write) on the target repo.</Td>
              <Td><a href="https://github.com/settings/tokens" className="text-[#146A34] underline" target="_blank" rel="noreferrer">github.com/settings/tokens</a></Td>
            </tr>
            <tr>
              <Td mono>GITHUB_REPO</Td>
              <Td>No</Td>
              <Td>Default repository for Pepper's GitHub tools, e.g. <code>mawegrzyn-ux/COGS</code>. Can be overridden per request.</Td>
              <Td>owner/repo format</Td>
            </tr>
          </tbody>
        </table>
        <InfoBox type="warning">
          Keys are stored in the database and <strong>never sent to the browser</strong>. The Settings UI
          only shows whether each key is configured (true/false). Without an Anthropic key, the AI
          Assistant will display "API key not configured".
        </InfoBox>

        <H3 id="ai-concise-mode">Concise Mode</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The <strong>Response Behaviour</strong> toggle in Settings → AI switches Pepper to concise mode.
          When enabled, Pepper skips preamble ("Let me check…", "I'll look that up…"), calls tools silently,
          and returns bullet-point answers in the fewest words possible. Ideal for quick data lookups.
          The setting is saved in the database and persists across sessions.
        </p>

        <H3 id="ai-token-allowance">Monthly Token Allowance</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The <strong>Monthly Token Allowance</strong> field in Settings → AI sets a per-user token cap
          for each billing period. The billing period runs from the <strong>25th of the previous month
          to the 24th of the current month</strong> and resets automatically each 25th.
        </p>
        <ul className="text-sm text-[#2D4A38] leading-relaxed list-disc list-inside space-y-1 mb-2">
          <li>Set to <strong>0</strong> (default) to disable the limit — all users have unrestricted access.</li>
          <li>When a user reaches their limit, Pepper returns a friendly message explaining when the allowance resets.</li>
          <li>The <strong>Pepper panel header</strong> shows a live usage bar: green (under 80%), amber (80–99%), red (exceeded).</li>
          <li>The <strong>Token Usage</strong> table in Settings → AI shows every user's period consumption with a mini progress bar.</li>
        </ul>
        <InfoBox type="info" title="Fail-open design">
          If the allowance check fails (e.g. database temporarily unreachable), Pepper allows the request
          rather than blocking the user. The limit is a soft guard, not a hard billing control.
        </InfoBox>

        {/* ═══════════════════════════════════ USER MANAGEMENT */}
        <H2 id="user-management" icon="👥" title="User Management" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          COGS Manager has a built-in role-based access control (RBAC) system. Every user has a{' '}
          <strong>role</strong>, and every role has a <strong>permission level</strong> per feature:{' '}
          <em>none</em>, <em>read</em>, or <em>write</em>. Manage users and roles in{' '}
          <strong>Settings → Users</strong> and <strong>Settings → Roles</strong>.
        </p>

        <H3 id="rbac-roles">Built-in Roles</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Role</Th><Th>Default access</Th><Th>Notes</Th></tr></thead>
          <tbody>
            {[
              ['Admin',    'Write on all 12 features',                          'Full access. Cannot be deleted.'],
              ['Operator', 'Write on most features; Read on settings; None on users', 'Day-to-day operators. Cannot manage users/roles.'],
              ['Viewer',   'Read on all features except settings/import/users (None)', 'Read-only. Cannot make any changes.'],
            ].map(([role, access, note]) => (
              <tr key={role}><Td><strong>{role}</strong></Td><Td>{access}</Td><Td>{note}</Td></tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Custom roles can be created in <strong>Settings → Roles</strong> by copying an existing role
          and adjusting the permission matrix.
        </p>

        <H3 id="rbac-features">Features</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The 12 controllable features map directly to the sidebar navigation:
        </p>
        <div className="grid grid-cols-3 gap-1.5 my-3">
          {['Dashboard','Inventory','Recipes','Menus','Allergens','HACCP','Markets','Categories','Settings','Import','AI Chat','Users'].map(f => (
            <span key={f} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded px-2 py-1 text-xs font-mono text-[#2D4A38] text-center">{f}</span>
          ))}
        </div>

        <H3 id="rbac-lifecycle">User Lifecycle</H3>
        <ProcessFlow steps={[
          { label: 'Register', sub: 'Via Auth0 login' },
          { label: 'Pending', sub: 'Awaiting approval' },
          { label: 'Admin approves', sub: 'Settings → Users' },
          { label: 'Active', sub: 'Can sign in' },
        ]} />
        <InfoBox type="tip" title="First user">
          The very first person to log in is automatically set to <strong>Admin + active</strong> — no
          chicken-and-egg problem. Every subsequent user starts as <strong>pending</strong> until
          an admin approves them.
        </InfoBox>
        <InfoBox type="info" title="Disabling vs deleting">
          <strong>Disable</strong> blocks access immediately but preserves the account record.{' '}
          <strong>Delete</strong> removes the record entirely — the person can re-register but will
          start as pending again.
        </InfoBox>

        <H3 id="rbac-market-scope">Market Scope</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Users can be restricted to specific markets by assigning <strong>Brand Partners</strong> in
          the edit modal (Settings → Users → pencil icon). A user with brand partner assignments can
          only see markets/countries linked to those partners. Leaving all brand partners unchecked
          grants <strong>unrestricted access</strong> to all markets (Admin default).
        </p>

        <H3 id="rbac-roles-matrix">Editing the Permission Matrix</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Settings → Roles shows a matrix of all roles × features. Click any cell to cycle its level:
        </p>
        <div className="flex gap-3 my-3 flex-wrap">
          {[['—','No access','bg-gray-100 text-gray-500'],['R','Read-only','bg-blue-50 text-blue-700'],['W','Write (full)','bg-[#E8F5ED] text-[#146A34]']].map(([badge, label, cls]) => (
            <div key={badge} className="flex items-center gap-2">
              <span className={`w-8 h-7 rounded-md text-xs font-bold font-mono flex items-center justify-center ${cls}`}>{badge}</span>
              <span className="text-sm text-[#2D4A38]">{label}</span>
            </div>
          ))}
        </div>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Changes save <strong>instantly</strong> — no Save button needed. A spinner appears in the
          cell while the update is in flight. System roles (Admin/Operator/Viewer) cannot be renamed
          or deleted. Custom roles have a pencil (rename) and ✕ (delete) icon in their column header.
        </p>

        <H3 id="rbac-dev-flag">Developer Access</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Individual users can be granted a <strong>developer flag</strong> that unlocks dev-only features.
          This is separate from roles — any user regardless of their role can be a dev.
        </p>
        <div className="flex items-center gap-3 my-3 p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <span className="font-mono text-xs font-bold px-2 py-1.5 bg-purple-100 text-purple-700 rounded">{'</>'}</span>
          <div>
            <p className="text-sm font-semibold text-[#0F1F17]">Dev toggle in Settings → Users → Actions column</p>
            <p className="text-xs text-[#6B7F74] mt-0.5">Purple = dev access on · Grey = dev access off · Click to toggle instantly</p>
          </div>
        </div>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Feature</Th><Th>Normal user</Th><Th>Dev user</Th></tr></thead>
          <tbody>
            {[
              ['Test Data tab in Settings', 'Hidden', 'Visible — marked with purple DEV badge'],
            ].map(([feature, normal, dev]) => (
              <tr key={feature}><Td>{feature}</Td><Td><span className="text-[#6B7F74]">{normal}</span></Td><Td><span className="text-purple-700 font-semibold">{dev}</span></Td></tr>
            ))}
          </tbody>
        </table>
        <InfoBox type="warning" title="Test Data is destructive">
          The Test Data tab includes <strong>Clear Database</strong> (wipes all data) and <strong>Load Test Data</strong> (wipes then loads dummy data).
          Only grant dev access to users who understand these operations cannot be undone.
        </InfoBox>

        {/* ═══════════════════════════════════ AI ASSISTANT */}
        <H2 id="ai-assistant" icon="🤖" title="Pepper — AI Assistant" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          <strong>Pepper</strong> is the built-in AI assistant powered by <strong>Claude Haiku 4.5</strong>.
          It can read and write to your live database, answer questions using the documentation knowledge
          base, and help you build and manage your menu data through natural conversation.
        </p>

        <H3 id="ai-panel">Opening &amp; Positioning Pepper</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Pepper defaults to a <strong>floating button</strong> in the bottom-right corner. Click it to open
          the chat panel. Three layout modes are available via the icons in the Pepper panel header:
        </p>
        <ul className="text-sm text-[#2D4A38] leading-relaxed list-disc list-inside mb-2 space-y-1">
          <li><strong>Float</strong> — fixed popup overlay (default)</li>
          <li><strong>Dock left</strong> — full-height panel between the sidebar and main content</li>
          <li><strong>Dock right</strong> — full-height panel to the right of main content</li>
        </ul>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Mode is remembered across sessions (stored in your browser). The close button (float mode only)
          collapses the panel back to the floating button.
        </p>

        <H3 id="ai-input">Sending Messages &amp; Attachments</H3>
        <ul className="text-sm text-[#2D4A38] leading-relaxed list-disc list-inside space-y-1 mb-2">
          <li><strong>Type &amp; send</strong> — press Enter or click Send</li>
          <li><strong>Paperclip icon</strong> — attach a file: CSV, XLSX, DOCX, PPTX, PDF, PNG, JPEG, WEBP (max 10 MB).</li>
          <li><strong>Camera icon</strong> — captures a screenshot of the current page and attaches it to your next message. Pepper's own UI is excluded from the capture. Type your question then send.</li>
          <li><strong>Paste image</strong> — Ctrl+V / Cmd+V pastes an image from your clipboard directly into the chat input as an attachment.</li>
          <li><strong>Right-click → Ask Pepper</strong> — right-click on any highlighted data element (COGS%, coverage bar, cost figures) to open a contextual prompt with an auto-captured screenshot already attached.</li>
          <li><strong>Markdown responses</strong> — Pepper's replies are fully rendered: tables, code blocks, headings, bullet lists, numbered lists, bold, italic, and inline code are all formatted for easy reading.</li>
          <li><strong>Usage bar</strong> — if a monthly token allowance is configured in Settings → AI, a colour-coded progress bar appears below the Pepper header showing your current period usage.</li>
        </ul>
        <InfoBox type="tip" title="Tutorial buttons">
          Small <strong>?</strong> icons appear next to page headers and tab labels. Clicking one sends a
          pre-written tutorial prompt to Pepper for that specific section — useful for a quick walkthrough
          of any feature.
        </InfoBox>

        <H3 id="ai-how-it-works">How It Works — Two Knowledge Layers</H3>
        <ProcessFlow steps={[
          { label: 'Your question', sub: 'Natural language' },
          { label: 'Layer 1: RAG', sub: 'Docs context injected' },
          { label: 'Claude Haiku', sub: 'Interprets request' },
          { label: 'Layer 2: Tools', sub: 'Queries live DB' },
          { label: 'SSE stream', sub: 'Response in real time' },
        ]} />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Every request automatically uses both layers simultaneously — Claude receives documentation
          context <em>and</em> can call tools to fetch live data before constructing its answer.
          Responses stream via Server-Sent Events so you see text appear as Claude writes it.
          Up to 10 messages of conversation history are passed per request.
        </p>

        <H3 id="ai-rag">Layer 1 — What Is Vectorised (RAG)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          RAG stands for <strong>Retrieval-Augmented Generation</strong>. At API startup, the system
          reads two source files, splits each into sections by <Mono>##</Mono> heading, and embeds
          every section using Voyage AI's <Mono>voyage-3-lite</Mono> model.
        </p>

        <div className="border border-[#D8E6DD] rounded-lg overflow-hidden my-3">
          <div className="bg-[#F7F9F8] px-3 py-2 border-b border-[#D8E6DD]">
            <p className="text-xs font-bold text-[#0F1F17]">Sources vectorised at startup</p>
          </div>
          <div className="p-3 flex flex-col gap-3">
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">📄</span>
              <div>
                <p className="text-sm font-semibold text-[#0F1F17]">CLAUDE.md — Technical &amp; developer documentation</p>
                <p className="text-xs text-[#6B7F74] mt-0.5">Infrastructure, CI/CD, database schema, API routes, code patterns, known bugs, deployment</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-lg shrink-0">📄</span>
              <div>
                <p className="text-sm font-semibold text-[#0F1F17]">docs/user-guide.md — User documentation</p>
                <p className="text-xs text-[#6B7F74] mt-0.5">All pages, features, workflows, field explanations, setup guide, troubleshooting</p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-[#2D4A38] leading-relaxed">
          When you ask a question, it is also embedded and compared to all stored section vectors
          using <strong>cosine similarity</strong>. The top 4 most relevant sections are retrieved
          and injected into Pepper's system prompt as context before it sees your question.
        </p>
        <InfoBox type="info" title="Fallback behaviour">
          If no <strong>Voyage AI key</strong> is configured, the system falls back to{' '}
          <strong>keyword search</strong> (word-frequency scoring over section text).
          Less accurate but still functional. Configure your Voyage key in Settings → AI
          for semantic search quality.
        </InfoBox>
        <InfoBox type="warning" title="What RAG does NOT cover">
          RAG covers the two static documentation files above. It does not index your
          live data (ingredients, recipes, prices, etc.) — that is handled by Layer 2 (tools).
          It also does not index this Help page. The knowledge base updates automatically on every
          server restart (each deploy re-indexes from the latest file versions).
        </InfoBox>

        <H3 id="ai-tools">Layer 2 — What the AI Can Query & Write (Tools)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Pepper has <strong>87 tools</strong> spanning full read and write access to your live <Mono>mcogs</Mono> database, plus optional GitHub integration and Excel export.
          Tool calls happen automatically — Pepper determines which tools to call based on your question or request.
        </p>
        <div className="grid grid-cols-2 gap-2 my-3">
          {[
            { label: 'Dashboard & Stats',  note: 'get_dashboard_stats' },
            { label: 'Ingredients',         note: 'list, get, create, update, delete' },
            { label: 'Vendors',             note: 'list, create, update, delete' },
            { label: 'Price Quotes',        note: 'list, create, update, delete, set preferred vendor' },
            { label: 'Recipes & Items',     note: 'list, get, create, update, delete recipe + recipe items' },
            { label: 'Menus & Items',       note: 'list, create, update, delete menus + items + sell prices' },
            { label: 'Markets',             note: 'list, create, update, delete markets + brand partners' },
            { label: 'Tax Rates',           note: 'list, create, update, set default, delete' },
            { label: 'Categories',          note: 'list, create, update, delete' },
            { label: 'Price Levels',        note: 'list, create, update, delete' },
            { label: 'Settings',            note: 'get + update system settings' },
            { label: 'Locations & Groups',  note: 'full CRUD for locations and location groups' },
            { label: 'HACCP',               note: 'equipment register, temp logs, CCP logs' },
            { label: 'Allergens',           note: 'list, read/write per ingredient, menu matrix' },
            { label: 'Import',              note: 'start_import — stage a spreadsheet for the Import Wizard' },
            { label: 'Web Search',          note: 'search_web — only when you explicitly ask to search the web' },
            { label: 'Menu Engineer',       note: 'list_scenarios, get_scenario_analysis, save_scenario, push_scenario_prices' },
            { label: 'Feedback',            note: 'get_feedback, submit_feedback' },
            { label: 'GitHub (optional)',   note: 'list_files, read_file, search_code, create_branch, create_or_update_file, list_prs, get_pr_diff, create_pr' },
          ].map(({ label, note }) => (
            <div key={label} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-2">
              <p className="text-xs font-semibold text-[#0F1F17]">{label}</p>
              <p className="text-[10px] text-[#6B7F74] mt-0.5 leading-snug font-mono">{note}</p>
            </div>
          ))}
        </div>

        <H3 id="ai-no-access">What the AI Cannot Access</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Pepper has full read and write access to all 27 database tables. The only things outside its reach are:
        </p>
        <div className="grid grid-cols-2 gap-2 my-3">
          {[
            { label: 'AI chat logs', note: 'Cannot access previous conversation history beyond the current session' },
            { label: 'Raw SQL / migrations', note: 'Cannot run arbitrary SQL or schema changes' },
            { label: 'Server / OS config', note: 'No access to Nginx, PM2, environment variables, or SSH' },
            { label: 'Auth0 user records', note: 'Cannot list users, roles, or authentication data' },
          ].map(({ label, note }) => (
            <div key={label} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-2">
              <p className="text-xs font-semibold text-[#0F1F17]">{label}</p>
              <p className="text-[10px] text-[#6B7F74] mt-0.5 leading-snug">{note}</p>
            </div>
          ))}
        </div>
        <InfoBox type="tip" title="Getting the best answers">
          Ask Pepper anything about your live data — ingredients, costs, COGS%, recipes, vendors, markets,
          allergens, HACCP logs, or scenarios. For bulk imports, Pepper can stage your spreadsheet and
          provide a link to the Import Wizard review page.
        </InfoBox>

        <H3 id="example-questions">Example Questions</H3>
        <div className="space-y-1.5 my-3">
          {[
            { q: '"What is the COGS% for the Classic Burger on the UK menu at eat-in prices?"', layer: 'Tools' },
            { q: '"Which ingredients have no active price quote?"',                             layer: 'Tools' },
            { q: '"List all recipes that contain chicken breast"',                              layer: 'Tools' },
            { q: '"Show me the allergen status of the Caesar Salad recipe"',                   layer: 'Tools' },
            { q: '"What\'s our total ingredient coverage across all markets?"',                layer: 'Tools' },
            { q: '"How do I set a preferred vendor for an ingredient?"',                       layer: 'RAG' },
            { q: '"What does waste % do to the COGS calculation?"',                           layer: 'RAG' },
            { q: '"Submit a bug report: Compare Markets isn\'t saving prices for the France menu"',   layer: 'Tools' },
            { q: '"What is the recommended setup order for a new instance?"',                 layer: 'RAG' },
            { q: '"Create a vendor called Fresh Farms in the UK market"',                     layer: 'Tools' },
            { q: '"Set the preferred vendor for Chicken Breast in the UK to Fresh Farms"',   layer: 'Tools' },
            { q: '"Which menu items have no allergen data at all?"',                          layer: 'Tools' },
          ].map(({ q, layer }) => (
            <div key={q} className="flex items-start gap-2 text-sm">
              <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5
                ${layer === 'Tools' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {layer}
              </span>
              <span className="text-[#2D4A38] italic">{q}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-[#6B7F74] mt-1">
          <span className="inline-block bg-green-100 text-green-700 text-[10px] font-bold px-1.5 py-0.5 rounded">Tools</span>
          {' '}= answered from live DB data &nbsp;·&nbsp;
          <span className="inline-block bg-blue-100 text-blue-700 text-[10px] font-bold px-1.5 py-0.5 rounded">RAG</span>
          {' '}= answered from vectorised CLAUDE.md documentation
        </p>

        <H3 id="ai-github">GitHub Integration</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          When a <strong>GitHub PAT</strong> and <strong>GitHub Repo</strong> are configured in Settings → AI,
          Pepper gains 8 additional tools that let it read and write code in your repository.
        </p>
        <div className="grid grid-cols-2 gap-2 my-3">
          {[
            { label: 'github_list_files',           note: 'Browse directories and find files' },
            { label: 'github_read_file',             note: 'Read the full content of any file (+ SHA for updates)' },
            { label: 'github_search_code',           note: 'Search code by keyword across the repo' },
            { label: 'github_create_branch',         note: 'Create a new feature branch — confirm required' },
            { label: 'github_create_or_update_file', note: 'Write a file to a branch — confirm required, main/master blocked' },
            { label: 'github_list_prs',              note: 'List open or closed pull requests' },
            { label: 'github_get_pr_diff',           note: 'View the diff/patch for a pull request' },
            { label: 'github_create_pr',             note: 'Open a pull request — confirm required' },
          ].map(({ label, note }) => (
            <div key={label} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-2">
              <p className="text-[10px] font-mono font-semibold text-[#146A34]">{label}</p>
              <p className="text-[10px] text-[#6B7F74] mt-0.5 leading-snug">{note}</p>
            </div>
          ))}
        </div>
        <InfoBox type="tip" title="How to set up GitHub access">
          <ol className="space-y-1 list-decimal list-inside">
            <li>Go to <strong>github.com → Settings → Developer settings → Personal access tokens → Fine-grained tokens</strong></li>
            <li>Create a token with <strong>Contents</strong> (read/write) and <strong>Pull requests</strong> (read/write) on your repo</li>
            <li>Paste the token into <strong>Settings → AI → GitHub Personal Access Token</strong></li>
            <li>Set <strong>GitHub Repository</strong> to <code>owner/repo</code> (e.g. <code>mawegrzyn-ux/COGS</code>)</li>
          </ol>
        </InfoBox>
        <InfoBox type="warning" title="Write safety guardrails">
          Pepper <strong>cannot write directly to main or master</strong> — this is enforced at the server level, not just the system prompt.
          All file changes must go to a feature branch, then a PR is created for human review. Confirmation is required before every branch create, file write, or PR creation.
        </InfoBox>
        <div className="space-y-1.5 my-3">
          {[
            { q: '"Show me what\'s in the api/src/routes directory"',           layer: 'GitHub' },
            { q: '"Read the ai-chat.js file"',                                  layer: 'GitHub' },
            { q: '"Search the codebase for executeTool"',                       layer: 'GitHub' },
            { q: '"Create a branch called pepper/fix-cogs and update the README"', layer: 'GitHub' },
            { q: '"What open PRs are there?"',                                  layer: 'GitHub' },
            { q: '"Show me the diff for PR #42"',                               layer: 'GitHub' },
          ].map(({ q, layer }) => (
            <div key={q} className="flex items-start gap-2 text-sm">
              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded mt-0.5 bg-purple-100 text-purple-700">{layer}</span>
              <span className="text-[#2D4A38] italic">{q}</span>
            </div>
          ))}
        </div>

        {/* ═══════════════════════════════════ ARCHITECTURE */}
        <H2 id="architecture" icon="🏗️" title="System Architecture" />

        <H3 id="tech-stack">Technology Stack</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Layer</Th><Th>Technology</Th><Th>Notes</Th></tr></thead>
          <tbody>
            {([
              ['Frontend',       'React 18 + Vite + TypeScript', 'SPA, no SSR. Auth0 SPA SDK.'],
              ['Styling',        'Tailwind CSS 3 + CSS variables', 'Custom design tokens in tailwind.config.js'],
              ['API',            'Node.js 20 + Express 4',        'REST API on port 3001. Helmet, Morgan, rate-limit.'],
              ['Database',       'PostgreSQL 16',                  '26 tables, all prefixed mcogs_'],
              ['Auth',           'Auth0 (obscurekitty.uk.auth0.com)', 'Username/password + Google OAuth — tenant fixed, app domain separate'],
              ['Web Server',     'Nginx',                          'Reverse proxy + SSL termination'],
              ['Process Mgr',   'PM2 (ubuntu user)',               'Auto-restart + log rotation'],
              ['Hosting',        'AWS Lightsail',                  '$10/mo · 2 GB RAM · 1 vCPU · Ubuntu 24.04'],
              ['SSL',            "Let's Encrypt / Certbot",        'Auto-renews every 90 days'],
              ['CI/CD',          'GitHub Actions',                 'Push to main → build → SCP → SSH → health check'],
              ['AI Model',       'Claude Haiku 4.5',               'SSE streaming via @anthropic-ai/sdk ^0.80'],
              ['AI Embeddings', 'Voyage AI voyage-3-lite',         'Optional RAG over documentation'],
              ['Exchange Rates', 'Frankfurter API',                'Free, no API key — api.frankfurter.app'],
              ['Nutrition',      'USDA FoodData Central',          'Optional USDA proxy for ingredient nutrition data'],
            ] as [string, string, string][]).map(([layer, tech, notes]) => (
              <tr key={layer}><Td>{layer}</Td><Td mono>{tech}</Td><Td>{notes}</Td></tr>
            ))}
          </tbody>
        </table>

        <H3 id="infrastructure">Infrastructure Diagram</H3>
        <div className="bg-[#0F1F17] text-white rounded-lg p-4 my-3 font-mono text-xs leading-relaxed">
          <div className="text-[#6B7F74]">{'// Single AWS Lightsail instance — all services on one box'}</div>
          <div className="mt-2">
            <span className="text-[#E8F5ED]">Browser</span>
            <span className="text-[#6B7F74]"> (React SPA — https://cogs.flavorconnect.tech)</span>
          </div>
          <div className="text-[#1E8A44] ml-4">↕ HTTPS :443</div>
          <div>
            <span className="text-[#E8F5ED]">Nginx</span>
            <span className="text-[#6B7F74]"> (reverse proxy + Let's Encrypt SSL)</span>
          </div>
          <div className="text-[#1E8A44] ml-4">↕ HTTP :3001 (internal loopback)</div>
          <div>
            <span className="text-[#E8F5ED]">Node.js API</span>
            <span className="text-[#6B7F74]"> (Express + PM2 · process: menu-cogs-api)</span>
          </div>
          <div className="text-[#1E8A44] ml-4">↕ localhost:5432</div>
          <div>
            <span className="text-[#E8F5ED]">PostgreSQL 16</span>
            <span className="text-[#6B7F74]"> (database: mcogs · user: mcogs)</span>
          </div>
          <div className="mt-3 text-[#6B7F74]">{'// External HTTPS outbound (from Node API)'}</div>
          <div className="mt-1 text-[#E8F5ED]">→ <span className="text-amber-400">api.anthropic.com</span>     <span className="text-[#6B7F74]">(AI chat)</span></div>
          <div className="text-[#E8F5ED]">→ <span className="text-amber-400">api.voyageai.com</span>      <span className="text-[#6B7F74]">(RAG embeddings, optional)</span></div>
          <div className="text-[#E8F5ED]">→ <span className="text-amber-400">api.frankfurter.app</span>   <span className="text-[#6B7F74]">(exchange rates)</span></div>
          <div className="text-[#E8F5ED]">→ <span className="text-amber-400">api.nal.usda.gov</span>      <span className="text-[#6B7F74]">(nutrition data, optional)</span></div>
        </div>

        <H3 id="key-code-patterns">Key Code Patterns</H3>
        <div className="space-y-3">
          {[
            {
              title: 'useApi() — Auth0-aware fetch hook',
              path: 'app/src/hooks/useApi.ts',
              detail: 'Wraps all API calls with Auth0 token injection. CRITICAL: the returned object is wrapped in useMemo() to give a stable reference and prevent infinite useEffect loops. Methods: get / post / put / patch / delete.',
            },
            {
              title: 'useSortFilter() — Sort + multi-select filter hook',
              path: 'app/src/hooks/useSortFilter.ts',
              detail: 'Generic hook for managing sort state and multi-select filters over any data array. Returns: sorted array, sortField, sortDir, getFilter, setSort, setFilter, clearFilters, hasActiveFilters.',
            },
            {
              title: 'DataGrid — Inline-editable spreadsheet grid',
              path: 'app/src/components/DataGrid.tsx',
              detail: 'Generic editable grid supporting text / number / select / combo / derived cell types. Save states: idle / saving / saved / error. Used in Compare Markets and Market Price Tool tabs.',
            },
            {
              title: 'ColumnHeader — Sortable, filterable column header',
              path: 'app/src/components/ColumnHeader.tsx',
              detail: 'Implements multi-select filter dropdowns with fixed positioning (position: fixed + getBoundingClientRect) to avoid clipping inside overflow-x: auto containers.',
            },
            {
              title: 'AiChat — SSE streaming AI chat widget',
              path: 'app/src/components/AiChat.tsx',
              detail: 'Floating chat panel. Uses native fetch + manual SSE parsing of data: lines. Streams text, tool execution labels, and errors in real time. Passes up to 10 messages of history per request.',
            },
            {
              title: 'getEffectivePrice() — Preferred vendor fallback',
              path: 'api/src/helpers/effectivePrice.js',
              detail: 'Returns the preferred vendor quote for an ingredient+country pair. Falls back to lowest active quote if no preference is set. Used by recipes.js and cogs.js.',
            },
            {
              title: 'rag.js — RAG retrieval helper',
              path: 'api/src/helpers/rag.js',
              detail: 'Loads CLAUDE.md sections, embeds via Voyage AI (voyage-3-lite), computes cosine similarity to find the top-k relevant chunks for each AI query. Falls back to keyword matching if Voyage key is absent.',
            },
          ].map(b => (
            <div key={b.title} className="border border-[#D8E6DD] rounded-lg p-3 bg-white">
              <p className="text-sm font-bold text-[#0F1F17]">{b.title}</p>
              <p className="text-[11px] font-mono text-[#146A34] mt-0.5">{b.path}</p>
              <p className="text-xs text-[#2D4A38] mt-1.5 leading-relaxed">{b.detail}</p>
            </div>
          ))}
        </div>

        <H3 id="database-schema">Database Schema</H3>
        <p className="text-sm text-[#2D4A38] mb-2">
          All tables are prefixed <Mono>mcogs_</Mono> for compatibility with the legacy WordPress plugin.
          Migration script: <Mono>cd api && npm run migrate</Mono> (safe to run multiple times).
        </p>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>#</Th><Th>Table</Th><Th>Purpose</Th></tr></thead>
          <tbody>
            {([
              [1,  'mcogs_units',                      'Measurement units (kg, litre, each, etc.)'],
              [2,  'mcogs_price_levels',               'Price levels (Eat-in, Takeout, Delivery)'],
              [3,  'mcogs_countries',                  'Markets: currency, exchange rate, default price level'],
              [4,  'mcogs_country_tax_rates',          'Tax rates per country (e.g. UK VAT 20%)'],
              [5,  'mcogs_country_level_tax',          'Junction: which tax rate applies to which price level'],
              [6,  'mcogs_categories',                 'Ingredient/recipe categories with group_name + type'],
              [7,  'mcogs_vendors',                    'Suppliers linked to a country'],
              [8,  'mcogs_ingredients',                'Ingredient master list: base unit, waste %, prep conversion'],
              [9,  'mcogs_price_quotes',               'Vendor pricing per ingredient: price, qty, unit, active'],
              [10, 'mcogs_ingredient_preferred_vendor','Preferred vendor per ingredient per country (UNIQUE)'],
              [11, 'mcogs_recipes',                    'Recipe definitions with yield qty and yield unit'],
              [12, 'mcogs_recipe_items',               'Recipe lines: ingredient or sub-recipe, qty, conversion'],
              [13, 'mcogs_menus',                      'Menu definitions linked to a country'],
              [14, 'mcogs_menu_items',                 'Menu items: recipe or ingredient, display name, sort order'],
              [15, 'mcogs_menu_item_prices',           'Sell prices per menu item per price level + tax rate'],
              [16, 'mcogs_locations',                  'Physical stores: market, group, address, contact'],
              [17, 'mcogs_location_groups',            'Clusters of locations (e.g. "London Central")'],
              [18, 'mcogs_allergens',                  'EU/UK FIC reference allergens (14 regulated)'],
              [19, 'mcogs_ingredient_allergens',       'Junction: allergen status per ingredient'],
              [20, 'mcogs_equipment',                  'HACCP equipment register linked to location'],
              [21, 'mcogs_equipment_temp_logs',        'Temperature readings per equipment item'],
              [22, 'mcogs_ccp_logs',                   'CCP logs (cooking/cooling/delivery) per location'],
              [23, 'mcogs_feedback',                   'User-submitted bug reports and feature requests'],
              [24, 'mcogs_ai_chat_log',                'AI request/response log with token counts and tools called'],
              [25, 'mcogs_settings',                   'Single-row JSONB config: defaults, thresholds, AI keys'],
              [26, 'mcogs_brand_partners',             'Franchise brand partners linked to markets'],
              [27, 'mcogs_menu_scenarios',             'Saved Menu Engineer scenarios with price/cost overrides and history'],
            ] as [number, string, string][]).map(([n, table, purpose]) => (
              <tr key={n}><Td>{n}</Td><Td mono>{table}</Td><Td>{purpose}</Td></tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-[#6B7F74] mt-2">
          Notable additional columns: <Mono>mcogs_ingredients.allergen_notes</Mono> (free-text allergen notes) ·{' '}
          <Mono>mcogs_menu_items.allergen_notes</Mono> (menu-item-level allergen notes).
          Run <Mono>npm run migrate</Mono> in <Mono>api/</Mono> to apply all schema additions safely.
        </p>

        <H3 id="data-flow">Data Flow: API Request Lifecycle</H3>
        <ProcessFlow steps={[
          { label: 'User action',    sub: 'e.g. save ingredient' },
          { label: 'useApi()',       sub: 'Auth0 token fetched' },
          { label: 'fetch()',        sub: 'POST /api/ingredients' },
          { label: 'Nginx',         sub: 'Proxy → :3001' },
          { label: 'Express route', sub: 'Validates + queries DB' },
          { label: 'PostgreSQL',    sub: 'Returns row' },
          { label: 'JSON 201',      sub: 'Response to browser' },
          { label: 'setState()',    sub: 'UI re-renders' },
        ]} />

        <H3 id="data-flow-ai">Data Flow: AI Assistant Request</H3>
        <ProcessFlow steps={[
          { label: 'User message',  sub: 'Chat input' },
          { label: 'POST /ai-chat', sub: 'with history + page ctx' },
          { label: 'rag.retrieve()', sub: 'Top-4 doc chunks' },
          { label: 'Claude Haiku', sub: 'Interprets + plans' },
          { label: 'Tool calls',   sub: 'Queries DB live' },
          { label: 'Claude again', sub: 'Formulates response' },
          { label: 'SSE stream',   sub: 'Text events to browser' },
          { label: 'AiChat.tsx',   sub: 'Renders streamed text' },
        ]} />

        {/* ═══════════════════════════════════ API REFERENCE */}
        <H2 id="api-reference" icon="📡" title="API Reference" />
        <p className="text-sm text-[#2D4A38] mb-1">
          Base URL (production): <Mono>https://cogs.flavorconnect.tech/api</Mono>
        </p>
        <p className="text-sm text-[#2D4A38] mb-3">
          Base URL (local dev): <Mono>http://localhost:3001/api</Mono>
        </p>
        <InfoBox type="warning" title="Authentication note">
          The API does not yet enforce JWT validation on incoming requests — this is a planned enhancement.
          The React SPA sends an Auth0 Bearer token on every request via <Mono>useApi()</Mono>, but Express
          does not currently verify it. See the Security section.
        </InfoBox>

        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Method</Th><Th>Endpoint</Th><Th>Description</Th></tr></thead>
          <tbody>
            {([
              ['GET',    '/health',                     'Health check — {"status":"ok"} if DB is reachable'],
              ['GET',    '/settings',                   'Retrieve system settings (JSONB blob)'],
              ['PUT',    '/settings',                   'Replace system settings'],
              ['PATCH',  '/settings',                   'Partial update system settings'],
              ['GET',    '/units',                      'List all units of measurement'],
              ['POST',   '/units',                      'Create a unit'],
              ['PUT',    '/units/:id',                  'Update a unit'],
              ['DELETE', '/units/:id',                  'Delete a unit'],
              ['GET',    '/price-levels',               'List all price levels'],
              ['POST',   '/price-levels',               'Create a price level'],
              ['PUT',    '/price-levels/:id',           'Update a price level'],
              ['DELETE', '/price-levels/:id',           'Delete a price level'],
              ['POST',   '/sync-exchange-rates',        'Sync exchange rates from Frankfurter API'],
              ['GET',    '/countries',                  'List all markets/countries'],
              ['POST',   '/countries',                  'Create a market'],
              ['PUT',    '/countries/:id',              'Update a market'],
              ['DELETE', '/countries/:id',              'Delete a market'],
              ['GET',    '/tax-rates',                  'List tax rates (filterable by ?country_id=)'],
              ['POST',   '/tax-rates',                  'Create a tax rate'],
              ['PUT',    '/tax-rates/:id',              'Update a tax rate'],
              ['DELETE', '/tax-rates/:id',              'Delete a tax rate'],
              ['GET',    '/country-level-tax',          'List country-level tax mappings'],
              ['POST',   '/country-level-tax',          'Create a mapping (country × price level × tax rate)'],
              ['DELETE', '/country-level-tax/:id',      'Delete a mapping'],
              ['GET',    '/categories',                 'List categories (?type=ingredient|recipe)'],
              ['POST',   '/categories',                 'Create a category'],
              ['PUT',    '/categories/:id',             'Update a category'],
              ['DELETE', '/categories/:id',             'Delete a category'],
              ['GET',    '/vendors',                    'List vendors'],
              ['POST',   '/vendors',                    'Create a vendor'],
              ['PUT',    '/vendors/:id',                'Update a vendor'],
              ['DELETE', '/vendors/:id',                'Delete a vendor'],
              ['GET',    '/ingredients',                'List all ingredients'],
              ['POST',   '/ingredients',                'Create an ingredient'],
              ['PUT',    '/ingredients/:id',            'Update an ingredient'],
              ['DELETE', '/ingredients/:id',            'Delete an ingredient'],
              ['GET',    '/price-quotes',               'List price quotes (?ingredient_id=)'],
              ['POST',   '/price-quotes',               'Create a price quote'],
              ['PUT',    '/price-quotes/:id',           'Update a quote'],
              ['DELETE', '/price-quotes/:id',           'Delete a quote'],
              ['GET',    '/preferred-vendors',          'List preferred vendor assignments'],
              ['POST',   '/preferred-vendors',          'Set a preferred vendor for ingredient+country'],
              ['PUT',    '/preferred-vendors/:id',      'Update an assignment'],
              ['DELETE', '/preferred-vendors/:id',      'Remove an assignment'],
              ['GET',    '/recipes',                    'List all recipes'],
              ['POST',   '/recipes',                    'Create a recipe'],
              ['PUT',    '/recipes/:id',                'Update recipe header (name, yield, category)'],
              ['DELETE', '/recipes/:id',                'Delete a recipe'],
              ['GET',    '/menus',                      'List menus (?country_id=)'],
              ['POST',   '/menus',                      'Create a menu for a market'],
              ['PUT',    '/menus/:id',                  'Update a menu'],
              ['DELETE', '/menus/:id',                  'Delete a menu'],
              ['GET',    '/menu-items',                 'List menu items (?menu_id=)'],
              ['POST',   '/menu-items',                 'Add item to a menu'],
              ['PUT',    '/menu-items/:id',             'Update menu item (display name, sort order)'],
              ['DELETE', '/menu-items/:id',             'Remove item from menu'],
              ['GET',    '/menu-item-prices',           'List sell prices (?menu_item_id= or ?menu_id=)'],
              ['POST',   '/menu-item-prices',           'Set a sell price for item × price level'],
              ['PUT',    '/menu-item-prices/:id',       'Update sell price'],
              ['DELETE', '/menu-item-prices/:id',       'Delete sell price record'],
              ['GET',    '/cogs/menu/:id',              'Calculate COGS for all items on a menu (?country_id=)'],
              ['GET',    '/allergens',                  'List all 14 EU FIC allergens'],
              ['GET',    '/allergens/ingredient/:id',   'Get allergen statuses for a specific ingredient'],
              ['PUT',    '/allergens/ingredient/:id',   'Set (bulk replace) allergen statuses for an ingredient'],
              ['PATCH',  '/allergens/ingredient/:id/notes', 'Save allergen_notes text for an ingredient'],
              ['GET',    '/allergens/menu/:id',         'Allergen matrix for a full menu (includes allergen_notes per item)'],
              ['PATCH',  '/allergens/menu-item/:id/notes', 'Save allergen_notes text for a menu item'],
              ['GET',    '/nutrition',                  'USDA FoodData Central proxy (?query=flour)'],
              ['GET',    '/haccp/equipment',            'List equipment (?location_id=)'],
              ['POST',   '/haccp/equipment',            'Register a piece of equipment'],
              ['PUT',    '/haccp/equipment/:id',        'Update equipment record'],
              ['DELETE', '/haccp/equipment/:id',        'Delete equipment'],
              ['GET',    '/haccp/equipment/:id/logs',   'List temperature logs for equipment'],
              ['POST',   '/haccp/equipment/:id/logs',   'Log a temperature reading'],
              ['DELETE', '/haccp/equipment/:id/logs/:logId', 'Delete a temperature log'],
              ['GET',    '/haccp/ccp-logs',             'List CCP logs (?location_id=)'],
              ['POST',   '/haccp/ccp-logs',             'Create a CCP log entry'],
              ['DELETE', '/haccp/ccp-logs/:id',         'Delete a CCP log'],
              ['GET',    '/haccp/report',               'HACCP report for location (?location_id=&from=&to=)'],
              ['GET',    '/locations',                  'List locations (?market_id=&group_id=&active=)'],
              ['POST',   '/locations',                  'Create a location'],
              ['PUT',    '/locations/:id',              'Update a location'],
              ['DELETE', '/locations/:id',              'Delete a location'],
              ['GET',    '/location-groups',            'List location groups'],
              ['POST',   '/location-groups',            'Create a location group'],
              ['PUT',    '/location-groups/:id',        'Update a location group'],
              ['DELETE', '/location-groups/:id',        'Delete a location group'],
              ['POST',   '/ai-chat',                    'SSE streaming AI assistant — body: {message, history, context}'],
              ['GET',    '/ai-config',                  'Returns {anthropic_key_set: bool, voyage_key_set: bool}'],
              ['PATCH',  '/ai-config',                  'Save/update AI API keys to DB + runtime'],
              ['DELETE', '/ai-config/:key',             'Clear ANTHROPIC_API_KEY or VOYAGE_API_KEY'],
              ['POST',   '/feedback',                   'Submit feedback {title, type, description, page}'],
              ['GET',    '/internal/feedback',          'List feedback tickets (requires INTERNAL_API_KEY header)'],
              ['PATCH',  '/internal/feedback/:id',      'Update feedback status: open|in_progress|resolved'],
            ] as [string, string, string][]).map(([method, path, desc]) => (
              <tr key={method + path} className="hover:bg-[#F7F9F8]">
                <Td><MethodBadge method={method} /></Td>
                <Td mono>{`/api${path}`}</Td>
                <Td>{desc}</Td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* ═══════════════════════════════════ SECURITY */}
        <H2 id="security" icon="🔒" title="Security" />

        <H3 id="auth0-flow">Auth0 Authentication Flow</H3>
        <ProcessFlow steps={[
          { label: 'User visits', sub: 'cogs.macaroonie.com' },
          { label: 'Auth0 check', sub: 'Token valid?' },
          { label: 'Redirect to Auth0', sub: 'If not authenticated' },
          { label: 'Login', sub: 'Password or Google' },
          { label: 'Callback', sub: 'Access token returned' },
          { label: 'React SPA', sub: 'Token in memory' },
          { label: 'API request', sub: 'Bearer token sent' },
          { label: 'Auth0 /userinfo', sub: 'Token verified + cached' },
          { label: 'RBAC check', sub: 'Role + permissions loaded' },
        ]} />

        <H3 id="security-controls">Security Controls</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Control</Th><Th>Implementation</Th><Th>Status</Th></tr></thead>
          <tbody>
            {[
              ['HTTPS', "Nginx + Let's Encrypt SSL", '✅ Active'],
              ['Auth0 Frontend Guard', 'React ProtectedRoute + useAuth0()', '✅ Active'],
              ['Bearer Token', 'Auth0 access token in Authorization header on every request', '✅ Active'],
              ['API Token Verification', 'requireAuth middleware calls Auth0 /userinfo — 5 min cache', '✅ Active'],
              ['RBAC', 'Role + per-feature permission check on every protected route', '✅ Active'],
              ['Pending Approval', 'New users start as pending — admin must approve before access', '✅ Active'],
              ['Rate Limiting', '500 req / 15 min (express-rate-limit)', '✅ Active'],
              ['Security Headers', 'Helmet.js (HSTS, CSP, X-Frame-Options, etc.)', '✅ Active'],
              ['Trust Proxy', 'app.set("trust proxy", 1) for Nginx X-Forwarded-For', '✅ Active'],
              ['DB Credentials', 'Strong random password in .env — not in git', '✅ Active'],
              ['AI Key Storage', 'Stored in PostgreSQL JSONB — never sent to browser', '✅ Active'],
              ['Internal API Key', 'INTERNAL_API_KEY for /api/internal/feedback admin endpoint', '✅ Active'],
              ['PM2 User', 'All processes run as ubuntu (not root, not mcogs)', '✅ Active'],
            ].map(([ctrl, impl, status]) => (
              <tr key={ctrl}><Td>{ctrl}</Td><Td>{impl}</Td><Td>{status}</Td></tr>
            ))}
          </tbody>
        </table>

        <InfoBox type="info" title="Token verification approach">
          The API verifies tokens by calling Auth0's <Mono>/userinfo</Mono> endpoint on each request
          (responses cached 5 min). This works without configuring an Auth0 API audience.
          For higher-security deployments, full JWT signature verification can be added via{' '}
          <Mono>express-jwt</Mono> + Auth0 JWKS — see <Mono>docs/ENTERPRISE_SCALE.md</Mono>.
        </InfoBox>

        <H3 id="key-storage">AI Key Storage Model</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          API keys (Anthropic, Voyage AI) are entered via Settings → AI tab. They are written to the
          <Mono>mcogs_settings</Mono> table at path <Mono>data→'ai_keys'</Mono> (PostgreSQL JSONB).
          On API startup, <Mono>aiConfig.init()</Mono> reads keys from the DB and loads them into
          a runtime memory store. <Mono>GET /api/ai-config</Mono> returns only boolean flags —
          never the raw key values. Keys can be updated at runtime without restarting the Node process.
        </p>

        {/* ═══════════════════════════════════ TROUBLESHOOTING */}
        <H2 id="troubleshooting" icon="🔧" title="Troubleshooting" />

        <H3 id="known-bugs">Known Bugs Fixed</H3>
        <div className="space-y-3">
          {[
            {
              title: 'Fix 1 — Mixed Content / 1,252 blocked requests',
              symptom: 'All API calls going to http:// despite HTTPS being configured.',
              fix: 'deploy.yml was constructing VITE_API_URL with a hardcoded http:// prefix. Fix: use ${{ secrets.VITE_API_URL }} directly — never interpolate the URL.',
              file: '.github/workflows/deploy.yml',
            },
            {
              title: 'Fix 2 — Infinite useEffect loop',
              symptom: 'Thousands of API requests per second after HTTPS fix. UI continuously re-rendering.',
              fix: 'useApi() returned a new object literal on every render, causing useCallback + useEffect to re-fire. Fix: wrap return in useMemo(() => ({...}), [request]).',
              file: 'app/src/hooks/useApi.ts',
            },
            {
              title: 'Fix 3 — Express Trust Proxy error',
              symptom: 'ERR_ERL_UNEXPECTED_X_FORWARDED_FOR — all POST requests rejected by rate limiter.',
              fix: 'Nginx passes X-Forwarded-For headers but Express does not trust the proxy by default. Fix: app.set("trust proxy", 1) immediately after const app = express().',
              file: 'api/src/index.js',
            },
            {
              title: 'Fix 4 — Currency conversion bug in Compare Markets',
              symptom: 'Editing a price in a non-USD market saved the wrong value (e.g. entering €15 saved as ~€17.41).',
              fix: 'Save-back formula used c.rate instead of dispRate (= c.rate / targetRate). Fix: pass dispRate through to onSavePrice and use it in the reverse conversion.',
              file: 'app/src/pages/MenusPage.tsx',
            },
            {
              title: 'Fix 5 — ColumnHeader dropdown clipping',
              symptom: 'Filter/sort dropdowns were cut off inside overflow-x: auto table wrappers.',
              fix: 'Changed dropdown to position: fixed with coordinates from getBoundingClientRect(), placed at z-index: 99999 to escape any overflow container.',
              file: 'app/src/components/ColumnHeader.tsx',
            },
            {
              title: 'Fix 6 — Pepper loses focus on every keystroke',
              symptom: 'Typing in the Pepper chat textarea lost focus after each character. Focus was also not restored after an AI response finished streaming.',
              fix: 'ChatPanel and HistoryPanel were const functions defined inside AiChat(), causing React to create new component identities on every render. Fixed by moving both to module level. A wasStreaming ref + useEffect restores focus 100 ms after streaming ends.',
              file: 'app/src/components/AiChat.tsx',
            },
            {
              title: 'Fix 7 — Sidebar does not span full viewport height',
              symptom: "The sidebar's green border stopped short of the bottom of the screen.",
              fix: 'Wrapper div used h-full, which browsers do not always resolve definitively against a flex-stretched parent. Fixed by changing to flex flex-col self-stretch so the aside fills the full height reliably.',
              file: 'app/src/components/AppLayout.tsx',
            },
            {
              title: 'Fix 8 — Anthropic 400 error in multi-turn tool conversations',
              symptom: 'messages.N.content.0.text.input_str: Extra inputs are not permitted — 400 from Anthropic API on message 9+ when Claude called multiple tools.',
              fix: 'agenticStream.js used input_str as a local streaming accumulator on tool-use blocks. The field was still attached when blocks were pushed to assistantContent and sent back to Anthropic. Fixed by destructuring input_str off each block before pushing: const { input_str, ...cleanBlock } = currentBlock.',
              file: 'api/src/helpers/agenticStream.js',
            },
          ].map(b => (
            <div key={b.title} className="border border-[#D8E6DD] rounded-lg p-3 bg-white">
              <p className="text-sm font-bold text-[#0F1F17]">{b.title}</p>
              <p className="text-xs text-[#6B7F74] mt-1">
                <span className="font-semibold text-red-600">Symptom:</span> {b.symptom}
              </p>
              <p className="text-xs text-[#2D4A38] mt-1">
                <span className="font-semibold text-[#146A34]">Fix:</span> {b.fix}
              </p>
              <p className="text-[10px] font-mono text-[#6B7F74] mt-1.5">📄 {b.file}</p>
            </div>
          ))}
        </div>

        <H3 id="faq">Frequently Asked Questions</H3>
        <div className="space-y-2">
          {[
            {
              q: 'Why are my recipe COGS calculations showing £0.00?',
              a: 'An ingredient in the recipe has no active price quote for the selected market. Go to Inventory → Price Quotes, ensure the ingredient has at least one active quote, then optionally set a Preferred Vendor for that market.',
            },
            {
              q: 'Prices in Compare Markets are showing in the wrong currency or wrong amount.',
              a: "Check the market's exchange rate in Markets. Rates must be stored relative to USD (e.g. UK: 0.79, EU: 0.92). Use Settings → Exchange Rates → Sync to fetch live rates from Frankfurter. Then re-open Compare Markets — display values recalculate on load.",
            },
            {
              q: 'The AI assistant says "API key not configured".',
              a: 'Go to Settings → AI tab and enter your Anthropic API key (starts with sk-ant-…). Get one at console.anthropic.com. The key is stored securely in the database and never sent to the browser.',
            },
            {
              q: 'Auth0 login is failing with a "callback URL mismatch" error.',
              a: 'In the Auth0 dashboard (manage.auth0.com), go to Applications → your app → Settings. Ensure both https://cogs.flavorconnect.tech and http://localhost:5173 are in Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.',
            },
            {
              q: 'The CI/CD deploy is failing at the health check step.',
              a: 'SSH into the server and check: (1) pm2 status — is menu-cogs-api running? (2) curl http://localhost:3001/api/health — does it respond with {"status":"ok"}? (3) pm2 logs menu-cogs-api --lines 50 to see startup errors.',
            },
            {
              q: 'Exchange rate sync is failing.',
              a: 'Frankfurter API is free with no key. Test from the server: curl https://api.frankfurter.app/latest. If blocked, the server may have outbound firewall rules on port 443. Check AWS Lightsail networking rules.',
            },
            {
              q: 'How do I add a new page to the app?',
              a: '(1) Create api/src/routes/newpage.js with CRUD routes. (2) Register in api/src/routes/index.js. (3) Create app/src/pages/NewPage.tsx. (4) Import and add <Route path="newpage" element={<NewPage />} /> in App.tsx. (5) Add nav link to Sidebar.tsx NAV_ITEMS array. (6) Push to main — CI/CD auto-deploys.',
            },
            {
              q: 'PM2 is not running. How do I restart it?',
              a: 'SSH into the server as ubuntu. Run: cd /var/www/menu-cogs/api && pm2 start src/index.js --name menu-cogs-api. Then pm2 save to persist across reboots. Check pm2 status to confirm.',
            },
          ].map(({ q, a }) => (
            <details key={q} className="border border-[#D8E6DD] rounded-lg group">
              <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-[#0F1F17] hover:bg-[#F7F9F8] rounded-lg list-none flex items-center justify-between gap-2">
                <span>{q}</span>
                <svg className="w-4 h-4 text-[#6B7F74] shrink-0 group-open:rotate-180 transition-transform" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6"/>
                </svg>
              </summary>
              <div className="px-4 pb-3 pt-2 text-sm text-[#2D4A38] border-t border-[#D8E6DD] leading-relaxed">{a}</div>
            </details>
          ))}
        </div>

        <H3 id="server-commands">Server Management Quick Reference</H3>
        <div className="bg-[#0F1F17] rounded-lg p-4 my-3 font-mono text-xs leading-relaxed space-y-1">
          <p className="text-[#1E8A44] font-bold"># Process management</p>
          <p className="text-white">pm2 status</p>
          <p className="text-[#6B7F74] ml-4"># Check API is running</p>
          <p className="text-white">pm2 restart menu-cogs-api</p>
          <p className="text-[#6B7F74] ml-4"># Restart after env/config changes</p>
          <p className="text-white">pm2 logs menu-cogs-api --lines 50</p>
          <p className="text-[#6B7F74] ml-4"># View recent API logs</p>
          <p className="text-white">pm2 save</p>
          <p className="text-[#6B7F74] ml-4"># Persist PM2 process list across reboots</p>
          <p className="text-[#1E8A44] font-bold mt-2"># Web server</p>
          <p className="text-white">sudo nginx -t &amp;&amp; sudo nginx -s reload</p>
          <p className="text-[#6B7F74] ml-4"># Test config then reload Nginx</p>
          <p className="text-[#1E8A44] font-bold mt-2"># Database</p>
          <p className="text-white">psql -U mcogs -d mcogs</p>
          <p className="text-[#6B7F74] ml-4"># Connect to PostgreSQL</p>
          <p className="text-white">cd /var/www/menu-cogs/api &amp;&amp; npm run migrate</p>
          <p className="text-[#6B7F74] ml-4"># Run DB migrations (idempotent)</p>
          <p className="text-[#1E8A44] font-bold mt-2"># SSL</p>
          <p className="text-white">sudo certbot renew --dry-run</p>
          <p className="text-[#6B7F74] ml-4"># Test Let's Encrypt renewal</p>
          <p className="text-[#1E8A44] font-bold mt-2"># Health check</p>
          <p className="text-white">curl https://cogs.flavorconnect.tech/api/health</p>
          <p className="text-[#6B7F74] ml-4"># Should return: {"{"}"status":"ok"{"}"}</p>
        </div>

        {/* ═══════════════════════════════════ DOMAIN MIGRATION */}
        <H2 id="domain-migration" icon="🌐" title="Domain Migration" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-3">
          The app currently runs at <Mono>cogs.flavorconnect.tech</Mono> (migrated from <Mono>obscurekitty.com</Mono> in April 2026).
          Follow the steps below if you ever need to change the domain or subdomain again.
          A full reference is also in <Mono>docs/DOMAIN_MIGRATION.md</Mono>.
        </p>

        <H3 id="domain-prereqs">Prerequisites</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-3">
          Before starting: purchase the domain, point its nameservers to AWS Route 53 / Lightsail, and create a DNS zone in Lightsail for the apex domain.
          If using a subdomain (recommended — no complications), you only need an A record in the existing zone.
        </p>

        <H3 id="domain-steps">Step-by-Step Process</H3>
        <div className="space-y-3 my-3">
          {[
            {
              n: '1', title: 'Add DNS A record',
              cmd: 'nslookup cogs.flavorconnect.tech',
              detail: 'In the Lightsail DNS zone for your apex domain, add an A record: subdomain (e.g. "cogs") → server IP 13.135.158.196. Wait for propagation (usually 1–5 min), then verify:',
            },
            {
              n: '2', title: 'Update Nginx server_name',
              cmd: 'sudo nano /etc/nginx/sites-available/menu-cogs\n# change: server_name <new-domain>;\nsudo nginx -t && sudo nginx -s reload',
              detail: 'SSH into the server. Edit the Nginx site config and replace the server_name value. Test the config before reloading.',
            },
            {
              n: '3', title: 'Issue SSL certificate',
              cmd: 'sudo certbot --nginx -d <new-domain>',
              detail: 'Certbot automatically issues the Let\'s Encrypt cert and patches the Nginx config. The cert auto-renews via a scheduled task. Requires the DNS A record to be live first.',
            },
            {
              n: '4', title: 'Update Auth0 URLs',
              cmd: 'manage.auth0.com → Applications → Settings',
              detail: 'Add the new domain to: Allowed Callback URLs, Allowed Logout URLs, Allowed Web Origins. Keep the existing localhost and old entries until the switch is confirmed working. Auth0 tenant name (obscurekitty.uk.auth0.com) does NOT change.',
            },
            {
              n: '5', title: 'Update GitHub Secrets',
              cmd: 'LIGHTSAIL_HOST = <new-domain>\nVITE_API_URL   = https://<new-domain>/api',
              detail: 'GitHub repo → Settings → Secrets and variables → Actions. Update both secrets. VITE_API_URL must include the full https:// prefix — never interpolate the host variable into a partial URL in deploy.yml.',
            },
            {
              n: '6', title: 'Deploy & verify',
              cmd: 'git commit --allow-empty -m "chore: switch domain to <new-domain>"\ngit push\ncurl https://<new-domain>/api/health',
              detail: 'Push an empty commit to trigger GitHub Actions. The pipeline builds the frontend with the new VITE_API_URL baked in, deploys to the server, and runs a health check. Health check must return {"status":"ok"}.',
            },
            {
              n: '7', title: 'Update documentation',
              cmd: '',
              detail: 'Update CLAUDE.md (sections 1, 6, 7, 18, 19), HelpPage.tsx, docs/user-guide.md, docs/DOMAIN_MIGRATION.md, and api/src/routes/nutrition.js (User-Agent contact email). Then remove old domain from Auth0 URLs.',
            },
          ].map(({ n, title, cmd, detail }) => (
            <div key={n} className="border border-[#D8E6DD] rounded-lg bg-white overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-2.5 bg-[#E8F5ED]">
                <span className="w-6 h-6 rounded-full bg-[#146A34] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{n}</span>
                <p className="text-sm font-semibold text-[#0F1F17]">{title}</p>
              </div>
              <div className="px-4 py-3">
                <p className="text-xs text-[#2D4A38] leading-relaxed mb-2">{detail}</p>
                {cmd && (
                  <div className="bg-[#0F1F17] rounded-md px-3 py-2 font-mono text-xs text-white whitespace-pre-line">{cmd}</div>
                )}
              </div>
            </div>
          ))}
        </div>

        <InfoBox type="info" title="Auth0 tenant is independent of the app domain">
          The Auth0 tenant name (<Mono>obscurekitty.uk.auth0.com</Mono>) is a fixed identifier chosen at tenant creation and
          cannot be changed without creating a new tenant. It has no effect on the app domain and does not need updating when the domain changes.
        </InfoBox>

        <InfoBox type="warning" title="Subdomain vs apex domain">
          Using a subdomain (e.g. <Mono>cogs.flavorconnect.tech</Mono>) is recommended — it requires only an A record in the existing DNS zone and works identically to an apex domain.
          Moving to a different apex domain requires updating nameservers at the registrar and creating a new Lightsail DNS zone.
        </InfoBox>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-[#D8E6DD] text-center">
          <p className="text-xs text-[#6B7F74]">COGS Manager v2.1 · React 18 + Node.js 20 + PostgreSQL 16</p>
          <p className="text-xs text-[#6B7F74] mt-1.5 space-x-3">
            <a href="https://cogs.flavorconnect.tech" className="text-[#146A34] hover:underline" target="_blank" rel="noreferrer">Production App</a>
            <span>·</span>
            <a href="https://github.com/mawegrzyn-ux/COGS" className="text-[#146A34] hover:underline" target="_blank" rel="noreferrer">GitHub Repo</a>
            <span>·</span>
            <a href="https://console.anthropic.com" className="text-[#146A34] hover:underline" target="_blank" rel="noreferrer">Anthropic Console</a>
            <span>·</span>
            <a href="https://dash.voyageai.com" className="text-[#146A34] hover:underline" target="_blank" rel="noreferrer">Voyage AI</a>
          </p>
        </div>

      </div>
    </div>
  )
}
