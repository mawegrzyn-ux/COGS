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
  { id: 'ai-assistant',     icon: '🤖', label: 'McFry (AI)' },
  { id: 'architecture',     icon: '🏗️', label: 'Architecture' },
  { id: 'api-reference',    icon: '📡', label: 'API Reference' },
  { id: 'security',         icon: '🔒', label: 'Security' },
  { id: 'troubleshooting',  icon: '🔧', label: 'Troubleshooting' },
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
          <p className="text-[10px] text-[#6B7F74] mt-0.5">COGS Manager v2.1</p>
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
          { label: 'PLT / MPT', sub: 'Set prices, review COGS' },
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
            { label: 'Price Levels',  desc: 'Eat-in / Takeout / Delivery level configurations' },
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
          contains menu items (recipes or individual ingredients). The Menus page has three tabs.
        </p>

        <H3 id="menu-builder">Tab 1 — Menu Builder</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Create menus and add items to them. Each item carries a <strong>display name</strong> (what
          appears to the customer), a link to a recipe or ingredient, and a <strong>sort order</strong> for
          consistent menu sequencing.
        </p>

        <H3 id="plt">Tab 2 — PLT (Price Level Table)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Set <strong>sell prices</strong> for each menu item × price level (e.g. Classic Burger —
          Eat-in: £12.50 · Takeout: £11.50 · Delivery: £13.00). Prices are entered in <em>display currency</em>
          and stored in USD.
        </p>
        <InfoBox type="info" title="Currency conversion in PLT">
          <p>Entered value → stored USD: <Mono>stored = displayValue / dispRate</Mono></p>
          <p className="mt-1">Display USD → local: <Mono>display = storedUSD × dispRate</Mono></p>
          <p className="mt-1">where <Mono>dispRate = market.exchange_rate / baseCurrency.exchange_rate</Mono></p>
        </InfoBox>

        <H3 id="mpt">Tab 3 — MPT (Menu Performance Table)</H3>
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
          Generates a <strong>menu-level allergen declaration</strong> compliant with EU Regulation
          1169/2011 (FIC) and UK Food Information Regulations. Maps all 14 regulated allergens across
          every item on a selected menu, rolling up from ingredient → recipe → menu item.
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
          Price levels drive the PLT/MPT columns in Menus.
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
          Set the target COGS% for colour-coding in the Menu Performance Table. Three bands:
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
          </tbody>
        </table>
        <InfoBox type="warning">
          Keys are stored in the database and <strong>never sent to the browser</strong>. The Settings UI
          only shows whether each key is configured (true/false). Without an Anthropic key, the AI
          Assistant will display "API key not configured".
        </InfoBox>

        {/* ═══════════════════════════════════ AI ASSISTANT */}
        <H2 id="ai-assistant" icon="🤖" title="McFry — AI Assistant" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          <strong>McFry</strong> is a floating AI chat widget (bottom-right of every page) powered by{' '}
          <strong>Claude Haiku 4.5</strong>. It combines two complementary knowledge sources —
          vectorised documentation and live database queries — to answer questions in natural language.
          McFry can also create, update, and delete records as a full sysadmin assistant.
        </p>

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
          reads a single source file — <Mono>CLAUDE.md</Mono> (the project documentation at the repo
          root) — splits it into sections by <Mono>##</Mono> heading, and embeds each section using
          Voyage AI's <Mono>voyage-3-lite</Mono> model.
        </p>

        <div className="border border-[#D8E6DD] rounded-lg overflow-hidden my-3">
          <div className="bg-[#F7F9F8] px-3 py-2 border-b border-[#D8E6DD]">
            <p className="text-xs font-bold text-[#0F1F17]">Source vectorised</p>
          </div>
          <div className="p-3">
            <div className="flex items-start gap-2 mb-2">
              <span className="text-lg shrink-0">📄</span>
              <div>
                <p className="text-sm font-semibold text-[#0F1F17]">CLAUDE.md — Project documentation</p>
                <p className="text-xs text-[#6B7F74] mt-0.5">~17 sections split by ## headings, each embedded as a separate vector</p>
              </div>
            </div>
            <p className="text-xs text-[#2D4A38] leading-relaxed">
              Sections include: Project Overview · Tech Stack · Repository Structure · Infrastructure ·
              Local Dev Setup · CI/CD Pipeline · Auth0 Config · Database Schema · API Routes ·
              Frontend Architecture · Design System · Pages Built · Known Bugs Fixed · Gotchas &amp;
              Lessons Learned · Backlog
            </p>
          </div>
        </div>

        <p className="text-sm text-[#2D4A38] leading-relaxed">
          When you ask a question, the query is also embedded and compared to the stored section
          vectors using <strong>cosine similarity</strong>. The top 4 most relevant sections are
          retrieved and injected into Claude's system prompt as documentation context — before Claude
          sees your question.
        </p>
        <InfoBox type="info" title="Fallback behaviour">
          If no <strong>Voyage AI key</strong> is configured, the system falls back to{' '}
          <strong>keyword search</strong> (simple word-frequency scoring over CLAUDE.md sections).
          This is less accurate but still functional. Configure your Voyage key in Settings → AI
          for semantic search quality.
        </InfoBox>
        <InfoBox type="warning" title="What RAG does NOT cover">
          RAG only covers the static <Mono>CLAUDE.md</Mono> documentation. It does not index your
          live data (ingredients, recipes, prices, etc.) — that is handled by Layer 2 (tools).
          It also does not index this Help page or any other runtime content.
        </InfoBox>

        <H3 id="ai-tools">Layer 2 — What the AI Can Query Live (Tools)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Claude has 9 tools that execute real PostgreSQL queries against your live{' '}
          <Mono>mcogs</Mono> database. Tool calls happen automatically when Claude determines
          it needs data to answer your question.
        </p>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Tool</Th><Th>DB tables queried</Th><Th>What it returns</Th></tr></thead>
          <tbody>
            {[
              ['get_dashboard_stats', 'All mcogs_ tables (COUNT queries)', 'Totals: ingredients, recipes, menus, vendors, markets, coverage %'],
              ['list_ingredients',   'mcogs_ingredients', 'All ingredients with id, name, category — filterable by name keyword'],
              ['get_ingredient',     'mcogs_ingredients + mcogs_price_quotes + mcogs_ingredient_allergens', 'Full ingredient: nutrition, all vendor quotes, allergen statuses'],
              ['list_recipes',       'mcogs_recipes', 'All recipes with id, name — filterable by name keyword'],
              ['get_recipe',         'mcogs_recipes + mcogs_recipe_items + mcogs_price_quotes (via preferred vendor logic)', 'Recipe header + all ingredient lines + cost per country'],
              ['list_menus',         'mcogs_menus + mcogs_countries', 'All menus with market name'],
              ['get_menu_cogs',      'mcogs_menu_items + mcogs_menu_item_prices + cogs calculation', 'Full menu: sell prices + COGS% per item per price level'],
              ['get_feedback',       'mcogs_feedback', 'Feedback tickets — filterable by type (bug/feature/general) and status'],
              ['submit_feedback',    'mcogs_feedback (INSERT)', 'Creates a new feedback record — the only write operation available'],
            ].map(([tool, tables, returns]) => (
              <tr key={tool}>
                <Td mono>{tool}</Td>
                <Td mono>{tables}</Td>
                <Td>{returns}</Td>
              </tr>
            ))}
          </tbody>
        </table>

        <H3 id="ai-no-access">What the AI Cannot Access Directly</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The following data is <strong>not exposed via tools</strong>. The AI can discuss these topics
          using its RAG documentation context (general knowledge about the system), but it cannot
          query live records for these areas:
        </p>
        <div className="grid grid-cols-2 gap-2 my-3">
          {[
            { label: 'Markets / Countries', note: 'Can describe the data model but not list your live markets' },
            { label: 'Vendors', note: 'Can explain vendors but cannot list your actual vendor records' },
            { label: 'Categories', note: 'Cannot list your ingredient/recipe categories' },
            { label: 'Tax rates', note: 'Cannot query your configured tax rates' },
            { label: 'Price levels', note: 'Cannot list your eat-in/takeout/delivery configuration' },
            { label: 'Settings / Thresholds', note: 'Cannot read your COGS target thresholds or units' },
            { label: 'HACCP data', note: 'No access to equipment registers, temp logs, or CCP logs' },
            { label: 'Locations', note: 'Cannot list your store locations or groups' },
            { label: 'Allergen matrix (menu level)', note: 'Can access allergens via get_ingredient but not menu-level matrix' },
            { label: 'AI chat logs', note: 'Cannot access its own previous conversation history beyond the current session' },
          ].map(({ label, note }) => (
            <div key={label} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-2">
              <p className="text-xs font-semibold text-[#0F1F17]">{label}</p>
              <p className="text-[10px] text-[#6B7F74] mt-0.5 leading-snug">{note}</p>
            </div>
          ))}
        </div>
        <InfoBox type="tip" title="Getting the best answers">
          For questions about markets, vendors, categories, or settings — navigate to the relevant page
          directly. For questions about <strong>ingredient costs, recipe COGS, or menu performance</strong>,
          the AI can give full answers with live numbers.
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
            { q: '"Submit a bug report: the PLT isn\'t saving prices for the France menu"',   layer: 'Tools' },
            { q: '"What is the recommended setup order for a new instance?"',                 layer: 'RAG' },
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
              ['Auth',           'Auth0 (obscurekitty.uk.auth0.com)', 'Username/password + Google OAuth'],
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
            <span className="text-[#6B7F74]"> (React SPA — https://obscurekitty.com)</span>
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
              detail: 'Generic editable grid supporting text / number / select / combo / derived cell types. Save states: idle / saving / saved / error. Used in PLT and MPT tabs.',
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
            ] as [number, string, string][]).map(([n, table, purpose]) => (
              <tr key={n}><Td>{n}</Td><Td mono>{table}</Td><Td>{purpose}</Td></tr>
            ))}
          </tbody>
        </table>

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
          Base URL (production): <Mono>https://obscurekitty.com/api</Mono>
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
              ['POST',   '/allergens/ingredient/:id',   'Set allergen statuses for an ingredient'],
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
          { label: 'User visits', sub: 'obscurekitty.com' },
          { label: 'Auth0 check', sub: 'Token valid?' },
          { label: 'Redirect to Auth0', sub: 'If not authenticated' },
          { label: 'Login', sub: 'Password or Google' },
          { label: 'Callback', sub: 'Access token returned' },
          { label: 'React SPA', sub: 'Token in memory' },
          { label: 'useApi() calls', sub: 'Bearer token sent' },
          { label: 'API responds', sub: '(JWT not yet verified)' },
        ]} />

        <H3 id="security-controls">Security Controls</H3>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Control</Th><Th>Implementation</Th><Th>Status</Th></tr></thead>
          <tbody>
            {[
              ['HTTPS', "Nginx + Let's Encrypt SSL", '✅ Active'],
              ['Auth0 Frontend Guard', 'React ProtectedRoute + useAuth0()', '✅ Active'],
              ['Bearer Token', 'Auth0 JWT in Authorization header via useApi()', '✅ Sent'],
              ['API JWT Verification', 'Express middleware to verify JWT signature', '⚠️ Not implemented — planned'],
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

        <InfoBox type="critical" title="JWT Verification Gap">
          The Express API does not currently verify Auth0 JWT tokens. Any request reaching the API with
          correct headers would be accepted. This is acceptable for the current single-operator deployment
          but <strong>must be implemented before multi-tenant or production launch</strong>.
          See <Mono>docs/ENTERPRISE_SCALE.md</Mono> for the Auth0 API audience + express-jwt middleware plan.
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
              title: 'Fix 4 — Currency conversion bug in PLT',
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
              q: 'Prices in PLT are showing in the wrong currency or wrong amount.',
              a: "Check the market's exchange rate in Markets. Rates must be stored relative to USD (e.g. UK: 0.79, EU: 0.92). Use Settings → Exchange Rates → Sync to fetch live rates from Frankfurter. Then re-open the PLT — display values recalculate on load.",
            },
            {
              q: 'The AI assistant says "API key not configured".',
              a: 'Go to Settings → AI tab and enter your Anthropic API key (starts with sk-ant-…). Get one at console.anthropic.com. The key is stored securely in the database and never sent to the browser.',
            },
            {
              q: 'Auth0 login is failing with a "callback URL mismatch" error.',
              a: 'In the Auth0 dashboard (manage.auth0.com), go to Applications → your app → Settings. Ensure both https://obscurekitty.com and http://localhost:5173 are in Allowed Callback URLs, Allowed Logout URLs, and Allowed Web Origins.',
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
          <p className="text-white">curl https://obscurekitty.com/api/health</p>
          <p className="text-[#6B7F74] ml-4"># Should return: {"{"}"status":"ok"{"}"}</p>
        </div>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-[#D8E6DD] text-center">
          <p className="text-xs text-[#6B7F74]">COGS Manager v2.1 · React 18 + Node.js 20 + PostgreSQL 16</p>
          <p className="text-xs text-[#6B7F74] mt-1.5 space-x-3">
            <a href="https://obscurekitty.com" className="text-[#146A34] hover:underline" target="_blank" rel="noreferrer">Production App</a>
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
