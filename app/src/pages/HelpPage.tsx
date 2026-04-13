import { useState, useEffect } from 'react'
import DocLibrary from '../components/DocLibrary'

// ─── Utility components ──────────────────────────────────────────────────────

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
  { id: 'quick-start',     icon: '🚀', label: 'Quick Start' },
  { id: 'dashboard',       icon: '📊', label: 'Dashboard' },
  { id: 'inventory',       icon: '📦', label: 'Inventory' },
  { id: 'recipes',         icon: '🍽️', label: 'Recipes' },
  { id: 'sales-items',     icon: '🏷️', label: 'Sales Items' },
  { id: 'menus',           icon: '📋', label: 'Menus' },
  { id: 'allergen-matrix', icon: '⚠️', label: 'Allergen Matrix' },
  { id: 'haccp',           icon: '🛡️', label: 'HACCP' },
  { id: 'stock-manager',   icon: '📦', label: 'Stock Manager' },
  { id: 'configuration',   icon: '⚙️', label: 'Configuration' },
  { id: 'import',          icon: '📥', label: 'Import Wizard' },
  { id: 'media-library',   icon: '🖼️', label: 'Media Library' },
  { id: 'system',          icon: '🖥️', label: 'System' },
  { id: 'user-management', icon: '👥', label: 'User Management' },
  { id: 'ai-assistant',    icon: '🤖', label: 'Pepper (AI)' },
  { id: 'roadmap',         icon: '🗺️', label: 'Roadmap' },
]

// ─── Main component ───────────────────────────────────────────────────────────

export default function HelpPage() {
  const [helpMode, setHelpMode] = useState<'guide' | 'library'>('guide')
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

  if (helpMode === 'library') {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-surface shrink-0">
          <button className="px-3 py-1.5 text-xs rounded-lg font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
            onClick={() => setHelpMode('guide')}>Guide</button>
          <button className="px-3 py-1.5 text-xs rounded-lg font-medium bg-accent text-white"
            onClick={() => setHelpMode('library')}>Library</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <DocLibrary location="help" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex">

      {/* ── TOC sidebar ─────────────────────────────────────────────────────── */}
      <aside
        className="w-52 shrink-0 border-r border-[#D8E6DD] bg-white overflow-y-auto"
        style={{ position: 'sticky', top: 0, height: '100vh', alignSelf: 'flex-start' }}
      >
        <div className="px-4 py-3 border-b border-[#D8E6DD]">
          <div className="flex items-center gap-1 mb-2">
            <button className="px-2 py-1 text-[10px] rounded font-medium bg-accent text-white"
              onClick={() => setHelpMode('guide')}>Guide</button>
            <button className="px-2 py-1 text-[10px] rounded font-medium bg-gray-100 text-gray-600 hover:bg-gray-200"
              onClick={() => setHelpMode('library')}>Library</button>
          </div>
          <p className="text-xs font-bold text-[#0F1F17]">Help Centre</p>
          <p className="text-[10px] text-[#6B7F74] mt-0.5">COGS Manager v2.5</p>
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
          { label: 'Menu Engineer', sub: 'Model sales mix, review COGS' },
        ]} />
        <InfoBox type="tip">
          You must create at least one <strong>Market</strong>, one <strong>Price Level</strong>, and one{' '}
          <strong>Unit</strong> before ingredients and recipes will function correctly.
        </InfoBox>

        <H3 id="navigation">Navigation</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The collapsible left sidebar links to all main pages. Click the <strong>arrow icon</strong> at the top of
          the sidebar to collapse it to icon-only view, freeing horizontal space. Your preference is saved
          in browser local storage. The <strong>Pepper AI Assistant</strong> can be docked to the left, right, or
          bottom of the screen via the mode icons in its panel header — it is always accessible from any page.
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

        <InfoBox type="info" title="Before diving in">
          Before using Inventory, Recipes, or Menus, ensure you have configured at least one <strong>Market</strong>,
          one <strong>Price Level</strong>, and <strong>Units</strong> in the <strong>Configuration</strong> section.
          See the Configuration section below for details on Markets, Tax Rates, Locations, and Categories.
        </InfoBox>

        {/* ═══════════════════════════════════ INVENTORY */}
        <H2 id="inventory" icon="📦" title="Inventory" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Inventory has three tabs: <strong>Ingredients</strong>, <strong>Vendors</strong>, and{' '}
          <strong>Price Quotes</strong>. This is where the foundation of all recipe costing is built.
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

        <H3 id="pl-recipes">Price Level Recipes (PL Variations)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          A <strong>Price Level Recipe</strong> is an alternate ingredient list for a recipe that activates
          only when that recipe is sold under a specific price level. Useful when the same dish uses different
          ingredients depending on the sales channel (e.g. premium bun for Eat-in, standard bun for Delivery).
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li>Open the recipe, switch the variant selector to <strong>Price Level</strong>, choose a level, then click <strong>Create PL Variation</strong>.</li>
          <li>Choose to start from a copy of the global recipe or an empty list.</li>
          <li>Edit ingredients for that price level independently. Changes do not affect the global recipe or other variations.</li>
          <li>Priority order in COGS calculations: <strong>PL variation &gt; market variation &gt; global recipe</strong>.</li>
          <li>Use <strong>Copy to Global</strong> to promote a PL variation&apos;s ingredients to become the global recipe.</li>
          <li>Use <strong>Delete PL Variation</strong> to revert that price level back to the global recipe.</li>
        </ul>

        {/* ═══════════════════════════════════ SALES ITEMS */}
        <H2 id="sales-items" icon="🏷️" title="Sales Items" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The <strong>Sales Items</strong> page is the catalog of everything that can appear on a menu. It has four tabs:
          <strong> Items</strong> (the main catalog), <strong>Combos</strong> (structured bundles), <strong>Modifiers</strong> (reusable add-on groups), and <strong>Templates</strong> (reusable combo configurations).
          Each sales item has one of four types:
        </p>
        <table className="w-full text-sm border-collapse rounded overflow-hidden border border-[#D8E6DD] my-3">
          <thead><tr><Th>Type</Th><Th>When to use</Th><Th>COGS source</Th></tr></thead>
          <tbody>
            <tr><Td><span className="bg-blue-100 text-blue-700 text-xs font-semibold px-2 py-0.5 rounded">Recipe</span></Td><Td>Item is a built recipe in the system</Td><Td>Recipe cost per portion from ingredient pricing</Td></tr>
            <tr><Td><span className="bg-green-100 text-green-700 text-xs font-semibold px-2 py-0.5 rounded">Ingredient</span></Td><Td>Item sold directly without a recipe (e.g. a bottled drink)</Td><Td>Ingredient cost from vendor pricing</Td></tr>
            <tr><Td><span className="bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5 rounded">Manual</span></Td><Td>Cost entered manually — no recipe in system</Td><Td>Manually entered fixed cost</Td></tr>
            <tr><Td><span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5 rounded">Combo</span></Td><Td>Bundled meal deal with customer-selectable components</Td><Td>Sum of step costs (average across options)</Td></tr>
          </tbody>
        </table>

        <H3 id="si-edit-panel">Editing a Sales Item — Three-Tab Panel</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Click any row in the Items list to open the right-side edit panel. The panel has three tabs:
        </p>
        <div className="grid grid-cols-3 gap-2 my-3">
          {[
            { tab: 'Details', desc: 'Name, display name, type, linked item (recipe/ingredient/combo search or manual cost), category, description, image. Save button in footer.' },
            { tab: 'Markets', desc: 'Enable/disable the item per market. Saves automatically on each checkbox toggle.' },
            { tab: 'Modifiers', desc: 'Attach or remove modifier groups. Saves automatically on each change.' },
          ].map(({ tab, desc }) => (
            <div key={tab} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded-lg p-3">
              <p className="text-xs font-bold text-[#146A34] mb-1">{tab}</p>
              <p className="text-xs text-[#6B7F74] leading-snug">{desc}</p>
            </div>
          ))}
        </div>
        <InfoBox type="tip">
          The panel tab resets to <strong>Details</strong> each time you select a different item.
          Markets and Modifiers auto-save — no Save button click needed on those tabs.
        </InfoBox>

        <H3 id="si-combos">Combos</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          A <strong>Combo</strong> is a structured sales item made up of <strong>steps</strong> (e.g.
          &ldquo;Choose your burger&rdquo;, &ldquo;Choose your side&rdquo;), each with one or more <strong>options</strong>.
          Each option links to a recipe, ingredient, or a manual cost.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li>Steps have <strong>min/max selection</strong> rules — e.g. exactly 1 burger (min=max=1) or up to 2 extras (min=0, max=2).</li>
          <li>Step options can have a <strong>price add-on</strong> (e.g. +$1.00 for a premium burger) and a <strong>Qty</strong> field (how much of the linked recipe/ingredient is used).</li>
          <li>Combo COGS = sum of all step costs, using the average cost across options when a step allows multiple choices.</li>
          <li>Step options can also have <strong>Modifier Groups</strong> attached — e.g. the &ldquo;Classic Burger&rdquo; option in step 1 gets its own &ldquo;Sauce choice&rdquo; modifier.</li>
          <li><strong>UI:</strong> Click a step header to expand/collapse its options <em>and</em> open the step&apos;s edit form in the resizable right panel simultaneously. Click an option row to edit that option.</li>
        </ul>

        <H3 id="si-modifiers">Modifier Groups</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          <strong>Modifier Groups</strong> are reusable add-on lists (e.g. &ldquo;Sauce choice&rdquo;, &ldquo;Extra toppings&rdquo;,
          &ldquo;Bone-in flavours&rdquo;). They can be attached to standalone Sales Items <em>or</em> to individual
          Combo step options.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li>Each group has <strong>min/max select</strong> — e.g. &ldquo;choose exactly 1 sauce&rdquo; or &ldquo;up to 3 toppings&rdquo;.</li>
          <li><strong>Allow repeat selection</strong> — when enabled, customers can select the same option multiple times (e.g. double sauce). A +/- stepper replaces the checkbox in the POS Mockup.</li>
          <li><strong>Auto-show</strong> — per-junction flag. When enabled, the modifier group appears inline automatically. When disabled, it appears behind a &ldquo;Customise&rdquo; button (popup overlay in POS Mockup).</li>
          <li>Each modifier option links to a recipe, ingredient, or manual cost, has an optional <strong>price add-on</strong>, and a <strong>Qty</strong> field (quantity used per selection, default 1).</li>
          <li>Options can be <strong>reordered</strong> using arrow buttons. Use <strong>Duplicate</strong> on any group to copy it with all options.</li>
        </ul>

        <H3 id="si-market-visibility">Market Visibility</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Each sales item can be enabled or disabled per market via the <strong>Markets</strong> tab in the edit panel.
          This controls which items are available when building a menu for a specific country. Items disabled for a market
          will not appear in the menu builder&apos;s item selector for menus in that market.
        </p>

        {/* ═══════════════════════════════════ MENUS */}
        <H2 id="menus" icon="📋" title="Menus" />
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Menus are the top-level sales unit. Each menu belongs to a <strong>market/country</strong> and
          contains <strong>Sales Items</strong> from the catalog. The Menus page has three tabs.
        </p>

        <H3 id="menu-builder">Tab 1 — Menu Builder</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Create menus and add <strong>Sales Items</strong> to them. From the Menu Builder you add existing
          Sales Items from the catalog (see <strong>Sales Items</strong> section above) to a menu, set the
          display order, and configure sell prices per price level. Each menu is linked to a market/country,
          which determines the currency and tax rates.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Add items</strong> — click &ldquo;+ Add Item&rdquo; and search for a sales item by name. The item&apos;s type (recipe/ingredient/manual/combo) determines how COGS is calculated.</li>
          <li><strong>Sell prices</strong> — set a sell price per price level (Dine In, Delivery, etc.) for each item on the menu. Prices are stored in USD and displayed in the menu&apos;s market currency.</li>
          <li><strong>Sort order</strong> — drag or use sort controls to arrange items in the desired display order.</li>
          <li><strong>Three view modes</strong> — toggle between <strong>List</strong> (rich table with progress bars), <strong>Excel</strong> (compact spreadsheet with inline editing), and <strong>Grid</strong> (card tiles).</li>
        </ul>

        <H3 id="menu-engineer">Tab 2 — Menu Engineer</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The Menu Engineer models your menu's sales mix, revenue, and profitability. Select a menu and a price level (or "All Levels") to see every item's cost, sell price, and COGS%. Selecting a menu in the Builder tab automatically syncs the selection here and vice versa.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Qty Sold</strong> — enter quantities per item to model your sales mix. Revenue, COGS%, and grand totals update in real time.</li>
          <li><strong>Mix Manager</strong> — opens a modal to set quantities or enter a revenue target for auto-distribution. Pre-populates with any quantities already entered.</li>
          <li><strong>Price overrides</strong> — type a new price directly into any Price cell to override the live menu price for this scenario only. The live menu price is unchanged until you use Push Prices.</li>
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

        <InfoBox type="tip">
          Sales Items are created and configured in the <strong>Sales Items</strong> page (see above).
          The Menu Builder references items from that catalog — you don&apos;t create new items here.
        </InfoBox>

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
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Select a <strong>menu</strong> to view its allergen matrix. Columns = 14 allergens.
          Rows = all sales items on the menu. Filter by category to focus on a section (e.g. just Desserts).
          The matrix uses bold for <strong>Contains</strong>, italic for <em>May Contain</em>,
          and blank for Free From.
        </p>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The <strong>Category</strong> column shows the category of the linked recipe (for recipe items),
          the ingredient's category (for ingredient items), or the category assigned directly on the sales item
          (for combo and manual items).
        </p>

        <H3 id="allergen-notes">Allergen Notes</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Both the Inventory and Menu matrices include an editable <strong>Notes</strong> column at the right edge.
          Click into any Notes cell and type free-text notes about allergen specifics for that ingredient or menu item
          (e.g. "sourced from gluten-controlled facility", "contains due to shared fryer"). Notes auto-save on blur
          and are stored on <Mono>mcogs_ingredients.allergen_notes</Mono> (Inventory tab) or{' '}
          <Mono>mcogs_menu_sales_items.allergen_notes</Mono> (Menu tab).
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

        {/* ═══════════════════════════════════ STOCK MANAGER */}
        <H2 id="stock-manager" icon="📦" title="Stock Manager" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The Stock Manager is a full inventory management module for tracking stock on hand, purchase orders,
          goods received, invoices, waste, inter-store transfers, and stocktakes. It has <strong>8 tabs</strong>,
          each with its own RBAC permission for granular access control.
        </p>
        <InfoBox type="info">
          Stores are called <strong>Centres</strong> in the UI. Centres are sub-locations within a Location
          (e.g. Kitchen, Bar, Walk-in Fridge). Manage centres in <strong>Configuration → Locations</strong>.
        </InfoBox>

        <H3 id="sm-overview">Tab 1 — Overview</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          KPI cards showing total items, low stock count, out of stock count, and number of centres. A stock
          levels grid with colour-coded status badges (OK / Low / Out) and a recent movements feed showing the
          latest stock changes across all centres.
        </p>

        <H3 id="sm-stores">Tab 2 — Centres (Stores)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Three-panel layout: locations list → centres within a location → centre detail. Create and manage
          sub-locations within each physical site. The <strong>is_store_itself</strong> flag marks a centre
          that represents the location as a whole (rather than a subdivided area).
        </p>

        <H3 id="sm-purchase-orders">Tab 3 — Purchase Orders</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Three-panel layout: PO list with status filters → PO detail with line items → smart add-item form.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Smart item form</strong> — select an ingredient and the system auto-populates price, unit, and purchase qty from the vendor&apos;s active quote. If no quote exists, a warning appears with manual entry and an option to &ldquo;Save as price quote&rdquo;.</li>
          <li><strong>Per-item centre assignment</strong> — each line item can target a different centre (defaults to PO-level centre).</li>
          <li><strong>Status flow:</strong> Draft → Submitted → Partial → Received → Cancelled.</li>
          <li>Auto-numbered: PO-1001, PO-1002, etc.</li>
        </ul>

        <H3 id="sm-goods-in">Tab 4 — Goods In (GRN)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Goods Received Notes track what actually arrived. When linked to a PO, quantities auto-populate
          from the remaining undelivered amounts. <strong>Confirming</strong> a GRN creates stock movements
          and updates stock levels in a single transaction. Auto-numbered: GRN-1001+.
        </p>

        <H3 id="sm-invoices">Tab 5 — Invoices</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Invoice lifecycle with subtotal, tax, and total calculation. Can be created from a confirmed GRN
          (auto-populates items) or standalone. Supports non-ingredient charges (e.g. delivery fees).
          <strong> Status flow:</strong> Draft → Pending → Approved → Paid → Disputed. Auto-numbered: INV-1001+.
        </p>

        <H3 id="sm-waste">Tab 6 — Waste</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Bulk waste entry form with multi-row input: ingredient, quantity, reason code, and notes. Each entry
          creates a stock movement and decrements the centre&apos;s stock level. The right panel manages
          configurable <strong>reason codes</strong> (Expired, Damaged, Spillage, Over-production, etc.).
          A waste log history shows all recorded waste events.
        </p>

        <H3 id="sm-transfers">Tab 7 — Transfers</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Two-step inter-centre stock transfers. <strong>Dispatch</strong> deducts from the source centre
          and marks the transfer as in-transit. <strong>Confirm</strong> at the receiving centre adds to
          the destination. Cancel reverses the dispatch. Auto-numbered: TRF-1001+.
        </p>

        <H3 id="sm-stocktake">Tab 8 — Stocktake</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Physical stock counting sessions. Two modes: <strong>Full count</strong> (&ldquo;Populate All&rdquo; loads every
          ingredient from stock levels) and <strong>Spot check</strong> (add specific items only).
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li>Enter counted quantities for each item. The system shows expected qty, counted qty, and variance.</li>
          <li><strong>Complete</strong> locks the count. <strong>Approve</strong> adjusts stock levels to match the counted quantities, creating adjustment movements for every variance.</li>
          <li>Useful for monthly inventory audits and shrinkage tracking.</li>
        </ul>
        <ProcessFlow steps={[
          { label: 'Create session', sub: 'Full or spot check' },
          { label: 'Populate items', sub: 'All or selected' },
          { label: 'Count stock', sub: 'Enter actual qty' },
          { label: 'Complete', sub: 'Lock count' },
          { label: 'Approve', sub: 'Adjust stock levels' },
        ]} />

        {/* ═══════════════════════════════════ CONFIGURATION */}
        <H2 id="configuration" icon="⚙️" title="Configuration" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The Configuration page (in the left sidebar) is a unified hub that covers all system-wide settings.
          It replaces the old separate Settings, Markets, Categories, and Import pages. Sections include:
          Global Config, Location Structure, Categories, Base Units, Price Levels, Currency, COGS Thresholds,
          Users &amp; Roles, Import, Media Library, and Stock Config.
        </p>

        <H3 id="markets">Markets (Countries &amp; Currencies)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Markets are the core geographic unit. Everything market-specific — vendor pricing, preferred vendors,
          menu sell prices, tax rates, and COGS calculations — is linked to a Market (Country).
          Each market stores a <strong>country name</strong>, <strong>ISO currency code</strong> (e.g. GBP),
          <strong> currency symbol</strong>, and an <strong>exchange rate vs USD</strong>.
        </p>
        <InfoBox type="info">
          All prices are stored in <strong>USD</strong>. Display conversion:{' '}
          <Mono>{'dispRate = market.rate / targetCurrency.rate'}</Mono>.
          Sync live rates via Configuration → Exchange Rates.
        </InfoBox>

        <H3 id="tax-rates">Tax Rates</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Each market supports <strong>multiple tax rates</strong> (e.g. Standard 20%, Reduced 5%, Zero 0%).
          One rate is flagged as <strong>default</strong>. Rates are mapped to price levels via the
          Country-Level Tax junction — for example, UK Delivery might carry 20% VAT while a different
          rate applies to eat-in.
        </p>

        <H3 id="locations">Locations, Groups &amp; Centres</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Physical store locations are linked to a market and optionally to a <strong>Location Group</strong>
          (e.g. &ldquo;London Central&rdquo;). <strong>Centres</strong> (sub-locations within a site — Kitchen, Bar, Walk-in)
          are managed here and used by the Stock Manager. <strong>Brand Partners</strong> (franchise operators)
          are also associated at the market level and control user-level market scope.
        </p>

        <H3 id="categories">Categories</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Categories organise ingredients, recipes, and sales items. Each category has three <strong>scope flags</strong>:
        </p>
        <div className="flex gap-2 my-3 flex-wrap">
          <span className="bg-[#E8F5ED] border border-[#146A34]/20 text-[#146A34] text-xs font-semibold px-3 py-1 rounded">for_ingredients</span>
          <span className="bg-blue-50 border border-blue-200 text-blue-700 text-xs font-semibold px-3 py-1 rounded">for_recipes</span>
          <span className="bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold px-3 py-1 rounded">for_sales_items</span>
        </div>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          A category can have any combination — e.g. &ldquo;Mains&rdquo; might apply to both recipes and sales items.
          Categories belong to <strong>Category Groups</strong> (e.g. Dairy, Proteins) for hierarchical organisation.
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
          Price levels drive the Menu Engineer columns and sell price entry in the Menu Builder.
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
          Set the target COGS% for colour-coding in the Menu Engineer. Three bands:
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

        {/* ═══════════════════════════════════ IMPORT WIZARD */}
        <H2 id="import" icon="📥" title="Import Wizard" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The AI-powered Import Wizard lets you import data from spreadsheets (CSV, XLSX, XLSB). It uses
          Claude to extract and structure your data, then stages it for review before writing to the database.
        </p>
        <H3 id="import-steps">5-Step Wizard</H3>
        <ProcessFlow steps={[
          { label: '1. Upload', sub: 'Drag-and-drop file' },
          { label: '2. Review', sub: 'AI-extracted data' },
          { label: '3. Categories', sub: 'Map to existing' },
          { label: '4. Vendors', sub: 'Map to existing' },
          { label: '5. Execute', sub: 'Write to DB' },
        ]} />
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Upload</strong> — drag-and-drop or click to select a file. Pepper can also initiate an import from a chat conversation.</li>
          <li><strong>Review</strong> — AI-extracted data displayed in tabbed tables (Ingredients, Price Quotes, Recipes, Menus). Check for accuracy and correct any errors.</li>
          <li><strong>Categories</strong> — map each imported category to an existing COGS category, or create new ones inline via the dropdown.</li>
          <li><strong>Vendors</strong> — map imported vendor names to existing vendors, or create new ones.</li>
          <li><strong>Execute</strong> — write all staged data to the database. Uses transactions for safety.</li>
        </ul>
        <H3 id="import-features">Key Features</H3>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Unit fuzzy-matching</strong> — auto-resolves imported unit strings (e.g. &ldquo;pound&rdquo; → kg) with an amber badge showing the original.</li>
          <li><strong>Sub-recipe recognition</strong> — three-tier recipe hierarchies (ingredient → sub-recipe → main recipe).</li>
          <li><strong>Override action</strong> — when duplicates are detected, choose Create / Skip / Override per row.</li>
          <li><strong>Prep unit import</strong> — supports prep_unit and prep_to_base columns for ingredient preparation conversions.</li>
          <li><strong>Menu import</strong> — import menus and their item assignments in one go.</li>
          <li><strong>Download template</strong> — click &ldquo;Download template&rdquo; to get a pre-formatted spreadsheet with all supported sheets.</li>
        </ul>
        <InfoBox type="tip">
          Pepper can also trigger an import: paste spreadsheet content into the AI chat, and Pepper will
          stage it as an import job and provide a link to the wizard&apos;s review step.
        </InfoBox>

        {/* ═══════════════════════════════════ MEDIA LIBRARY */}
        <H2 id="media-library" icon="🖼️" title="Media Library" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The Media Library manages all images used across the application (sales item photos, recipe images, etc.).
          It supports both <strong>local disk</strong> and <strong>Amazon S3</strong> storage backends.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>Upload</strong> — drag-and-drop images. The system automatically generates three variants: original, thumbnail (300px), and web-optimised (1200px).</li>
          <li><strong>Categories</strong> — organise images into categories for easy browsing.</li>
          <li><strong>Grid / List view</strong> — toggle between visual grid and compact list views.</li>
          <li><strong>Selection model</strong> — single-click focuses an item (opens detail panel); checkbox adds to multi-selection. Once 2+ items are selected, clicking anywhere toggles selection for bulk operations.</li>
          <li><strong>Bulk operations</strong> — move multiple images to a category or bulk delete.</li>
          <li><strong>S3 migration</strong> — migrate all images from local disk to S3 via a progress-streamed operation (System → Storage).</li>
        </ul>
        <InfoBox type="info">
          Images are served publicly via <Mono>/api/media/img/:filename</Mono> — no authentication required.
          This allows images to work in shared links and external contexts.
        </InfoBox>

        {/* ═══════════════════════════════════ SYSTEM */}
        <H2 id="system" icon="🖥️" title="System" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The System page is the administration and documentation hub. It contains multiple sections,
          some of which are gated by admin permissions or the developer flag.
        </p>
        <div className="grid grid-cols-2 gap-2 my-3">
          {[
            { label: 'AI', desc: 'API keys, token usage, concise mode configuration', gate: '' },
            { label: 'Bugs & Backlog', desc: 'Bug tracker (BUG-1001+) and feature backlog (BACK-1001+). Visible to all users.', gate: '' },
            { label: 'Audit Log', desc: 'Central audit trail with filters and expandable rows showing field-level diffs.', gate: 'ADMIN' },
            { label: 'Storage', desc: 'Media storage config — switch between local disk and S3.', gate: 'ADMIN' },
            { label: 'Database', desc: 'DB connection mode (local vs standalone/RDS), test, save, migrate data, switch.', gate: 'ADMIN' },
            { label: 'Test Data', desc: 'Load test/small data, clear database, load defaults. All behind date confirmation.', gate: 'DEV' },
            { label: 'POS Mockup', desc: 'Functional POS simulator — test combos, modifiers, and order flows.', gate: '' },
            { label: 'CLAUDE.md', desc: 'Project documentation viewer for developers.', gate: 'DEV' },
            { label: 'Architecture', desc: 'System architecture reference documentation.', gate: '' },
            { label: 'API Reference', desc: 'Complete API routes documentation.', gate: '' },
          ].map(({ label, desc, gate }) => (
            <div key={label} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-2">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-[#0F1F17]">{label}</p>
                {gate === 'ADMIN' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">ADMIN</span>}
                {gate === 'DEV' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">DEV</span>}
              </div>
              <p className="text-[10px] text-[#6B7F74] mt-0.5 leading-snug">{desc}</p>
            </div>
          ))}
        </div>

        <H3 id="system-pos">POS Mockup</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          A functional POS simulator that reads live menu data. Use it to test your combos, modifier groups,
          and pricing before deploying to a real POS system. Features:
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li>Three-panel layout: check (order summary) | menu grid (category tiles) | order flow</li>
          <li>Combo step walker with auto-advance for single-choice steps</li>
          <li>Modifier groups with repeat selection (+/- stepper) and auto-show (inline vs popup)</li>
          <li>Price level selector to test pricing at different service types</li>
          <li>Mock receipt with print support</li>
        </ul>

        <H3 id="system-audit">Audit Log</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          The Audit Log records all data changes across the system with full context: who made the change,
          what changed (field-level old → new diffs), when, and why (source context). Filter by entity type,
          action, user, or date range. Expandable rows show the complete change detail. Admin access required.
        </p>

        <H3 id="system-bugs">Bugs &amp; Backlog</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Two-tab interface for tracking bugs (BUG-1001+) and feature backlog items (BACK-1001+). All users
          can view and submit. Bugs track priority, severity, status, labels, and reproduction steps. Backlog
          items track item type (story/task/epic), priority, status, and story points.
        </p>

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
              ['Admin',    'Write on all 21 features',                          'Full access. Cannot be deleted.'],
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

        <H3 id="rbac-features">Features (21)</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          The 21 controllable features map to sidebar pages and Stock Manager tabs:
        </p>
        <div className="grid grid-cols-3 gap-1.5 my-3">
          {['Dashboard','Inventory','Recipes','Menus','Allergens','HACCP','Markets','Categories','Settings','Import','AI Chat','Users',
            'Stock Overview','Stock Purchase Orders','Stock Goods In','Stock Invoices','Stock Waste','Stock Transfers','Stock Stocktake',
            'Bugs','Backlog'].map(f => (
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
              ['System → Test Data section', 'Hidden', 'Visible — marked with purple DEV badge'],
              ['System → CLAUDE.md section', 'Hidden', 'Visible — marked with purple DEV badge'],
            ].map(([feature, normal, dev]) => (
              <tr key={feature}><Td>{feature}</Td><Td><span className="text-[#6B7F74]">{normal}</span></Td><Td><span className="text-purple-700 font-semibold">{dev}</span></Td></tr>
            ))}
          </tbody>
        </table>
        <InfoBox type="warning" title="Test Data actions are destructive">
          The <strong>System → Test Data</strong> section exposes <strong>Load Test Data</strong>, <strong>Load Small Data</strong>, <strong>Clear Database</strong> and <strong>Load Defaults</strong>.
          Every destructive action is guarded by a date-confirmation modal — the user must type today&apos;s date as <span className="font-mono">ddmmyyyy</span> before the button activates.
          Only grant dev access to users who understand these operations cannot be undone.
          <br /><br />
          <em>Note:</em> <strong>System → Database</strong> is a different section — it&apos;s admin-gated (<code>settings:write</code>) and controls which PostgreSQL instance the API connects to, not seeding.
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
          Pepper is always visible as a docked panel. Three layout modes are available via the icons in the
          Pepper panel header:
        </p>
        <ul className="text-sm text-[#2D4A38] leading-relaxed list-disc list-inside mb-2 space-y-1">
          <li><strong>Dock left</strong> — full-height panel between the sidebar and main content</li>
          <li><strong>Dock right</strong> — full-height panel to the right of main content</li>
          <li><strong>Dock bottom</strong> — resizable horizontal panel below main content (drag the top edge to resize, 200px–60vh)</li>
        </ul>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Mode is remembered across sessions (stored in your browser). Switching modes preserves your
          conversation — the panel never unmounts, so history is kept intact.
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
          Pepper has <strong>92 tools</strong> spanning full read and write access to your live <Mono>mcogs</Mono> database, plus memory, Excel export, web search, and optional GitHub integration.
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
            { label: 'Excel Export',        note: 'export_to_excel — multi-sheet .xlsx (ingredients, quotes, recipes, menus, or full)' },
            { label: 'Memory',             note: 'save_memory_note, list_memory_notes, delete_memory_note — persistent notes across sessions' },
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
          Pepper has read and write access to the application database (78 tables). The only things outside its reach are:
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
            { q: '"Submit a bug report: Menu Engineer isn\'t loading COGS data for the France menu"',   layer: 'Tools' },
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

        <H3 id="ai-memory">Pepper Memory</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-2">
          Pepper has a <strong>persistent memory system</strong> that survives across sessions. Tell Pepper to
          remember things and it will recall them in future conversations.
        </p>
        <ul className="text-sm text-[#2D4A38] space-y-1.5 ml-4 list-disc leading-relaxed mb-2">
          <li><strong>&ldquo;Remember that I always want UK prices in GBP&rdquo;</strong> — saves a pinned note via <Mono>save_memory_note</Mono>.</li>
          <li><strong>&ldquo;What do you remember about me?&rdquo;</strong> — lists all saved notes via <Mono>list_memory_notes</Mono>.</li>
          <li><strong>&ldquo;Forget the note about GBP&rdquo;</strong> — deletes a specific note via <Mono>delete_memory_note</Mono>.</li>
        </ul>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Notes are loaded into Pepper&apos;s context at the start of every conversation. A user profile
          stores display name and structured preferences. If memory loading fails, chat works normally
          without it (graceful degradation).
        </p>

        <H3 id="ai-excel">Excel Export</H3>
        <p className="text-sm text-[#2D4A38] leading-relaxed">
          Ask Pepper to export data and it generates a multi-sheet <Mono>.xlsx</Mono> workbook
          (ingredients, price quotes, recipes, menus, or a full export). The file downloads automatically
          in your browser. Exports respect your market scope — if you&apos;re restricted to specific markets,
          only data for those markets is included.
        </p>

        <InfoBox type="tip" title="Technical documentation">
          Architecture, API Reference, Security, Troubleshooting and Domain Migration guides
          are available in <strong>System</strong> in the left navigation menu.
        </InfoBox>

        {/* ═══════════════════════════════════ ROADMAP */}
        <H2 id="roadmap" icon="🗺️" title="Roadmap" />
        <p className="text-sm text-[#2D4A38] leading-relaxed mb-4">
          Planned features that have been scoped and designed but not yet implemented.
          Each item below includes a summary of the planned approach and effort estimate.
        </p>

        {/* ── Language Support ── */}
        <div className="border border-[#D8E6DD] rounded-xl overflow-hidden my-5">
          {/* Header */}
          <div className="flex items-start gap-3 px-4 py-3 bg-white border-b border-[#D8E6DD]">
            <span className="text-2xl shrink-0 mt-0.5">🌍</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-[#0F1F17] text-base">Multi-Language Support</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">ROADMAP</span>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[#F7F9F8] text-[#6B7F74] border border-[#D8E6DD]">~16–19 days</span>
              </div>
              <p className="text-xs text-[#6B7F74] mt-1">
                Translate ingredient names, recipes, sales items, categories, and all customer-facing content into any language.
                Separate layer for UI localisation (buttons, labels, navigation).
              </p>
            </div>
          </div>

          {/* Two-layer summary */}
          <div className="grid grid-cols-2 divide-x divide-[#D8E6DD] bg-[#F7F9F8]">
            <div className="p-4">
              <p className="text-xs font-bold text-[#0F1F17] mb-2">Layer 1 — Content Translation</p>
              <p className="text-xs text-[#2D4A38] leading-relaxed mb-3">
                Per-entity translation tables store translated names and descriptions. A
                SQL <Mono>COALESCE</Mono> chain resolves the right language at query time —
                requested lang → country default → system default → base (English) column.
              </p>
              <div className="space-y-1">
                {[
                  'Ingredients (name, notes)',
                  'Recipes (name)',
                  'Sales Items + Combos (name, display_name)',
                  'Modifier Groups & Options',
                  'Categories, Vendors, Menus',
                  'Price Levels',
                ].map(item => (
                  <div key={item} className="flex items-center gap-1.5 text-xs text-[#2D4A38]">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#146A34" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4">
              <p className="text-xs font-bold text-[#0F1F17] mb-2">Layer 2 — UI Localisation</p>
              <p className="text-xs text-[#2D4A38] leading-relaxed mb-3">
                Static app labels (buttons, headings, tooltips, error messages) are extracted
                into locale JSON files and loaded via <Mono>react-i18next</Mono>.
                Language switching persists in <Mono>localStorage</Mono> and applies immediately.
              </p>
              <div className="space-y-1">
                {[
                  'react-i18next + i18next-http-backend',
                  'Locale files per page namespace',
                  'LanguageSwitcher in app header',
                  'Settings → Localisation tab',
                  'RTL layout variants (Arabic, Hebrew)',
                  'Pilot: English + French',
                ].map(item => (
                  <div key={item} className="flex items-center gap-1.5 text-xs text-[#2D4A38]">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#146A34" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* DB schema preview */}
          <div className="px-4 py-3 border-t border-[#D8E6DD] bg-white">
            <p className="text-xs font-bold text-[#0F1F17] mb-2">New database tables</p>
            <div className="grid grid-cols-3 gap-1.5">
              {[
                { t: 'mcogs_languages',                    note: 'code, name, is_default, is_rtl' },
                { t: 'mcogs_ingredient_translations',       note: 'ingredient_id × language_code' },
                { t: 'mcogs_recipe_translations',           note: 'recipe_id × language_code' },
                { t: 'mcogs_sales_item_translations',       note: 'sales_item_id × language_code' },
                { t: 'mcogs_modifier_group_translations',   note: 'modifier_group_id × lang' },
                { t: 'mcogs_modifier_option_translations',  note: 'modifier_option_id × lang' },
                { t: 'mcogs_combo_step_translations',       note: 'combo_step_id × lang' },
                { t: 'mcogs_combo_step_option_translations',note: 'combo_step_option_id × lang' },
                { t: 'mcogs_category_translations',         note: 'category_id × language_code' },
                { t: 'mcogs_vendor_translations',           note: 'vendor_id × language_code' },
                { t: 'mcogs_price_level_translations',      note: 'price_level_id × lang' },
                { t: 'mcogs_menu_translations',             note: 'menu_id × language_code' },
              ].map(({ t, note }) => (
                <div key={t} className="bg-[#F7F9F8] border border-[#D8E6DD] rounded p-1.5">
                  <p className="font-mono text-[9px] font-semibold text-[#146A34] leading-snug">{t}</p>
                  <p className="text-[9px] text-[#6B7F74] mt-0.5 leading-tight">{note}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Build phases */}
          <div className="px-4 py-3 border-t border-[#D8E6DD] bg-[#F7F9F8]">
            <p className="text-xs font-bold text-[#0F1F17] mb-3">Implementation phases</p>
            <div className="space-y-2">
              {[
                { phase: '1', days: '3 days',    title: 'Foundation',              desc: 'mcogs_languages table + /api/languages CRUD + Settings → Localisation tab' },
                { phase: '2', days: '4 days',    title: 'Translation Tables',      desc: '11 translation tables in migrate.js + sub-routes on each entity router' },
                { phase: '3', days: '4 days',    title: 'Backend Resolution',      desc: 'resolveLanguage middleware + COALESCE queries on all entity GET endpoints' },
                { phase: '4', days: '4 days',    title: 'Frontend Wiring',         desc: 'X-Language header in useApi.ts + TranslationEditor component in detail panels' },
                { phase: '5', days: '4–5 days',  title: 'UI Localisation',         desc: 'react-i18next setup + locale JSON files + LanguageSwitcher + RTL variants' },
              ].map(({ phase, days, title, desc }) => (
                <div key={phase} className="flex items-start gap-2.5">
                  <div className="w-5 h-5 rounded-full bg-[#146A34] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">{phase}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[#0F1F17]">{title}</span>
                      <span className="text-[10px] text-[#6B7F74] bg-white border border-[#D8E6DD] rounded px-1.5 py-0.5">{days}</span>
                    </div>
                    <p className="text-[11px] text-[#6B7F74] mt-0.5 leading-snug">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Open questions */}
          <div className="px-4 py-3 border-t border-[#D8E6DD] bg-white">
            <p className="text-xs font-bold text-[#0F1F17] mb-2">Design decisions to confirm before starting</p>
            <div className="space-y-1.5">
              {[
                { n: 1, q: 'Default language', detail: 'English-only initially, or multi-language from day 1?' },
                { n: 2, q: 'Translation workflow', detail: 'Manual admin entry, AI-assisted (Claude translates on save), or external CMS sync?' },
                { n: 3, q: 'Country ↔ language', detail: 'Should each country have a default_language_code, or do users pick language per-session?' },
                { n: 4, q: 'Shared Link language', detail: 'Auto-resolve from recipient\'s country, or add ?lang= param to the share URL?' },
                { n: 5, q: 'RTL day-1 requirement', detail: 'Arabic / Hebrew needed at launch, or deferred to a later phase?' },
                { n: 6, q: 'UI localisation scope', detail: 'Full app (all 12 pages), or priority pages only (Menus, Sales Items, Inventory)?' },
              ].map(({ n, q, detail }) => (
                <div key={n} className="flex items-start gap-2 text-xs">
                  <span className="shrink-0 w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-[9px] font-bold flex items-center justify-center mt-0.5">{n}</span>
                  <div>
                    <span className="font-semibold text-[#0F1F17]">{q}</span>
                    <span className="text-[#6B7F74]"> — {detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer link */}
          <div className="px-4 py-2.5 border-t border-[#D8E6DD] bg-[#F7F9F8] flex items-center gap-2">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#6B7F74" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <p className="text-[11px] text-[#6B7F74]">
              Full specification: <Mono>docs/LANGUAGE_SUPPORT.md</Mono> in the repository
            </p>
          </div>
        </div>

        <InfoBox type="info" title="How to request a roadmap item">
          To start implementation of any roadmap feature, open a work order and reference the
          specification document. Each item has a fully detailed technical plan ready to execute.
        </InfoBox>

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-[#D8E6DD] text-center">
          <p className="text-xs text-[#6B7F74]">COGS Manager v2.5 · React 18 + Node.js 20 + PostgreSQL 16</p>
          <p className="text-xs text-[#6B7F74] mt-1.5 space-x-3">
            <a href="https://cogs.macaroonie.com" className="text-[#146A34] hover:underline" target="_blank" rel="noreferrer">Production App</a>
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
