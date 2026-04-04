'use strict';
// =============================================================================
// Import Staging — two-path import wizard
//
// Path A (template):  user downloads the COGS Excel template, fills it in,
//                     uploads it — columns are mapped directly, no AI needed.
//
// Path B (ai):        user uploads any file — Claude reads it and extracts
//                     vendors / ingredients / price quotes / recipes using a
//                     single structured tool call.
//
// In both cases the parsed data is saved as a staging job (mcogs_import_jobs)
// and returned to the frontend for review before being committed to live tables.
//
// Routes
//   GET  /api/import/template         — download blank Excel template
//   POST /api/import/upload           — multipart upload → parse → stage
//   GET  /api/import/:id              — get job (staged data + status)
//   PUT  /api/import/:id              — save amended staged data
//   POST /api/import/:id/execute      — commit staged data to live tables
//   DELETE /api/import/:id            — discard job
// =============================================================================

const router    = require('express').Router();
const pool      = require('../db/pool');
const multer    = require('multer');
const XLSX      = require('xlsx');
const mammoth   = require('mammoth');
const JSZip     = require('jszip');
const Anthropic = require('@anthropic-ai/sdk');
const aiConfig  = require('../helpers/aiConfig');
const crypto    = require('crypto');

// ── multer ────────────────────────────────────────────────────────────────────

const ALLOWED_MIMES = new Set([
  'text/csv', 'text/plain',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const ALLOWED_EXTS = new Set(['.csv', '.txt', '.xlsx', '.xls', '.xlsb', '.xlsm', '.docx', '.pptx']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const mime = file.mimetype;
    const ext  = '.' + (file.originalname || '').toLowerCase().split('.').pop();
    if (ALLOWED_MIMES.has(mime) || (mime === 'application/octet-stream' && ALLOWED_EXTS.has(ext))) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${mime} (${file.originalname})`));
    }
  },
});

// ── Unit aliases (imported unit → canonical metric abbreviation) ──────────────

const UNIT_ALIASES = {
  // Weight
  pound: 'kg', pounds: 'kg', lb: 'kg', lbs: 'kg',
  ounce: 'g',  ounces: 'g',  oz: 'g',
  gram: 'g', grams: 'g', gm: 'g', grm: 'g',
  kilogram: 'kg', kilograms: 'kg', kgs: 'kg',
  // Volume
  milliliter: 'ml', millilitre: 'ml', milliliters: 'ml', millilitres: 'ml', mls: 'ml',
  liter: 'L',  litre: 'L',  liters: 'L',  litres: 'L',
  lt: 'L', ltr: 'L', lts: 'L',
  centiliter: 'ml', centilitre: 'ml', cl: 'ml',
  'fl oz': 'ml', floz: 'ml',
  // Count
  piece: 'ea', pieces: 'ea', pcs: 'ea', pc: 'ea',
  each: 'ea', unit: 'ea', units: 'ea',
  portion: 'ea', serve: 'ea', serving: 'ea', servings: 'ea',
  pack: 'ea', packet: 'ea', packets: 'ea',
  can: 'ea', tin: 'ea', bottle: 'ea', jar: 'ea',
  bag: 'ea', box: 'ea', case: 'ea',
  tray: 'ea', bunch: 'ea', head: 'ea', loaf: 'ea',
};

/**
 * Resolves an imported unit string against DB units.
 * @param {string} unitStr  — raw imported value, e.g. "pound", "ml", "Kg"
 * @param {Array}  dbUnits  — rows from mcogs_units: { id, name, abbreviation }
 * @returns {{ resolved: string, source: string, method: string }}
 *   method: 'exact' | 'alias' | 'fuzzy' | 'unmatched'
 */
function resolveUnit(unitStr, dbUnits) {
  const src = (unitStr || '').trim();
  if (!src) return { resolved: '', source: '', method: 'none' };
  const lower = src.toLowerCase();

  // Build lookup maps
  const byAbbr = new Map(dbUnits.map(u => [u.abbreviation.toLowerCase(), u.abbreviation]));
  const byName = new Map(dbUnits.map(u => [u.name.toLowerCase(),         u.abbreviation]));

  // 1. Exact match
  if (byAbbr.has(lower)) return { resolved: byAbbr.get(lower), source: src, method: 'exact' };
  if (byName.has(lower)) return { resolved: byName.get(lower), source: src, method: 'exact' };

  // 2. Alias → check if canonical target is in DB
  const alias = UNIT_ALIASES[lower];
  if (alias) {
    const al = alias.toLowerCase();
    if (byAbbr.has(al)) return { resolved: byAbbr.get(al), source: src, method: 'alias' };
    if (byName.has(al)) return { resolved: byName.get(al), source: src, method: 'alias' };
    // Alias found but canonical not in DB — look for any unit whose abbr starts similarly
    for (const [k, v] of byAbbr) {
      if (k.startsWith(al[0]) && k.length <= 3) return { resolved: v, source: src, method: 'alias' };
    }
  }

  // 3. Fuzzy: DB abbr/name is a substring of the import string or vice-versa
  for (const [k, v] of byAbbr) {
    if (k.length >= 1 && (lower.startsWith(k) || lower.endsWith(k))) {
      return { resolved: v, source: src, method: 'fuzzy' };
    }
  }
  for (const [k, v] of byName) {
    if (k.length >= 3 && (lower.includes(k) || k.includes(lower))) {
      return { resolved: v, source: src, method: 'fuzzy' };
    }
  }

  return { resolved: src, source: src, method: 'unmatched' };
}

// ── Sheet schema analyser (deterministic, no AI) ─────────────────────────────
// Reads column headers from every sheet in an XLSX buffer and classifies what
// data each sheet contains.  The resulting hints are injected into the AI
// extraction prompt so Claude understands the file structure before extracting.

const COL_PRICE    = /price|cost|£|\$|€|usd|gbp|eur|rate|unit\s*price|purchase\s*price|price\s*per/i;
const COL_VENDOR   = /vendor|supplier/i;
const COL_PU       = /purchase[\s_-]?unit|buy[\s_-]?unit|pack[\s_-]?size|pack\s*desc|purch\s*unit/i;
const COL_CONV     = /conv|conversion|qty[\s_-]?in[\s_-]?base|base[\s_-]?qty|purchase[\s_\-→>]+base/i;
const COL_INGNAME  = /\bname\b|product[\s_]?name|ingredient|item[\s_]?name|description/i;
const COL_BASEUNIT = /\bbase[\s_]?unit\b|\buom\b|\bunit\b|\bmeasure\b/i;
const COL_CATEGORY = /categ|group\b|\btype\b/i;
const COL_SKU      = /sku|code|ref|product[\s_]?code|item[\s_]?no/i;

function analyseSheetHeaders(headers) {
  const h = headers.map(c => String(c || '').trim()).filter(Boolean);
  const has = pat => h.some(col => pat.test(col));
  const find = pat => h.find(col => pat.test(col)) || null;
  return {
    hasIngredientName: has(COL_INGNAME),
    hasCategory:       has(COL_CATEGORY),
    hasBaseUnit:       has(COL_BASEUNIT),
    hasPrice:          has(COL_PRICE),
    hasVendor:         has(COL_VENDOR),
    hasPurchaseUnit:   has(COL_PU),
    hasConversion:     has(COL_CONV),
    hasSku:            has(COL_SKU),
    priceCol:          find(COL_PRICE),
    vendorCol:         find(COL_VENDOR),
    puCol:             find(COL_PU),
    convCol:           find(COL_CONV),
    nameCol:           find(COL_INGNAME),
    baseUnitCol:       find(COL_BASEUNIT),
    categoryCol:       find(COL_CATEGORY),
    rawHeaders:        h,
  };
}

function buildSheetSchemas(buffer) {
  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const schemas = {};
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      // Find the first row that has ≥3 non-empty cells — treat as the header row
      const headerRow = rows.find(r => r.filter(c => String(c).trim()).length >= 3) || rows[0] || [];
      schemas[sheetName] = analyseSheetHeaders(headerRow);
    }
    return schemas;
  } catch { return {}; }
}

function schemaHintsToPrompt(schemas) {
  if (!Object.keys(schemas).length) return '';
  const lines = ['\nFILE STRUCTURE ANALYSIS (auto-detected from column headers):'];
  for (const [sheet, s] of Object.entries(schemas)) {
    const isCombined = s.hasIngredientName && s.hasPrice;
    lines.push(`\nSheet "${sheet}":`);
    lines.push(`  Headers: ${s.rawHeaders.join(' | ')}`);
    if (isCombined) {
      lines.push(`  ⚠ COMBINED SHEET — contains BOTH ingredient data AND pricing data`);
      lines.push(`  → Extract one ingredient AND one price_quote per data row`);
      if (s.vendorCol) lines.push(`  → Vendor column: "${s.vendorCol}" — use for ALL quotes in this sheet`);
      if (s.priceCol)  lines.push(`  → Price column: "${s.priceCol}" — strip currency symbols (£$€), parse as number`);
      if (s.puCol)     lines.push(`  → Purchase unit column: "${s.puCol}" → price_quote.purchase_unit`);
      if (s.convCol)   lines.push(`  → Conversion column: "${s.convCol}" → price_quote.qty_in_base_units`);
      if (s.baseUnitCol) lines.push(`  → Base unit column: "${s.baseUnitCol}" → ingredient.unit`);
    } else if (s.hasIngredientName) {
      lines.push(`  → Ingredient sheet (no price data detected)`);
    } else if (s.hasPrice && s.hasVendor) {
      lines.push(`  → Price quotes sheet`);
    }
  }
  return lines.join('\n');
}

// ── Deterministic quote synthesis (fallback when AI misses quotes) ────────────
// Runs AFTER AI extraction.  If the raw XLSX has sheets with both ingredient-
// name and price columns but AI returned 0 quotes, synthesise them directly.

function synthesiseMissingQuotes(buffer, staged) {
  // Only fill in if AI returned significantly fewer quotes than ingredients
  const ingCount   = (staged.ingredients || []).length;
  const quoteCount = (staged.price_quotes || []).length;
  if (!ingCount || quoteCount >= ingCount * 0.5) return; // already reasonably complete

  try {
    const wb = XLSX.read(buffer, { type: 'buffer' });

    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' });
      if (!rows.length) continue;

      const headers  = Object.keys(rows[0]).map(h => h.trim());
      const schemas  = analyseSheetHeaders(headers);
      if (!schemas.hasPrice || !schemas.hasIngredientName) continue;

      const nameCol  = schemas.nameCol;
      const priceCol = schemas.priceCol;
      const vendorCol= schemas.vendorCol;
      const puCol    = schemas.puCol;
      const convCol  = schemas.convCol;

      // Build a set of ingredient names that already have a quote
      const coveredNames = new Set(
        (staged.price_quotes || []).map(q => String(q.ingredient_name || '').toLowerCase().trim())
      );

      for (const row of rows) {
        const name  = String(row[nameCol] || '').trim();
        if (!name || coveredNames.has(name.toLowerCase())) continue;

        // Strip currency symbols and parse price
        const rawPrice = String(row[priceCol] || '').replace(/[£$€,\s]/g, '');
        const price    = parseFloat(rawPrice);
        if (!price || price <= 0) continue;

        const vendor   = vendorCol ? String(row[vendorCol] || 'Default Vendor').trim() : 'Default Vendor';
        const pu       = puCol     ? String(row[puCol]     || '').trim() : '';
        const conv     = convCol   ? parseFloat(row[convCol]) || 1 : 1;

        staged.price_quotes.push(blankRow({
          ingredient_name:   name,
          vendor_name:       vendor,
          purchase_price:    price,
          purchase_unit:     pu,
          qty_in_base_units: conv,
          _issues:           ['Auto-extracted from combined sheet (AI missed this quote — please verify)'],
          _status:           'warning',
        }));
        coveredNames.add(name.toLowerCase());

        // Also make sure vendor appears in vendor list
        const vendorExists = (staged.vendors || []).some(
          v => v.name.toLowerCase() === vendor.toLowerCase()
        );
        if (!vendorExists && vendor !== 'Default Vendor') {
          staged.vendors = staged.vendors || [];
          staged.vendors.push(blankRow({ name: vendor, country: '' }));
        }
      }
    }
  } catch (e) {
    console.error('[synthesiseMissingQuotes]', e.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const newId = () => crypto.randomUUID();

function blankRow(extra = {}) {
  return { _id: newId(), _action: 'create', _status: 'valid', _issues: [], _duplicate_of: null, ...extra };
}

// ── File parsers ──────────────────────────────────────────────────────────────

function parseXlsx(buffer, filename) {
  const wb    = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name], { blankrows: false });
    if (csv.trim()) parts.push(`### Sheet: ${name}\n${csv}`);
  }
  return parts.join('\n\n') || `[No data in ${filename}]`;
}

async function parseDocxText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value?.trim() || '';
}

async function parsePptxText(buffer) {
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch { return ''; }
  const slides = Object.keys(zip.files)
    .filter(n => /ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort();
  const parts = [];
  for (const sf of slides) {
    const xml   = await zip.files[sf].async('string');
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(m => m[1]).filter(Boolean);
    if (texts.length) parts.push(texts.join(' '));
  }
  return parts.join('\n');
}

async function fileToText(buffer, filename) {
  const name = filename.toLowerCase();
  if (name.endsWith('.docx'))                                                   return parseDocxText(buffer);
  if (name.endsWith('.pptx'))                                                   return parsePptxText(buffer);
  if (['.xlsx','.xls','.xlsb','.xlsm'].some(e => name.endsWith(e)))            return parseXlsx(buffer, filename);
  return buffer.toString('utf8');
}

// ── Template download ─────────────────────────────────────────────────────────

router.get('/template', (_req, res) => {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['COGS Import Template — Instructions'],
    [''],
    ['1. Fill in each sheet with your data. Do not change column headers.'],
    ['2. Country names must match what is already in COGS (e.g. "United Kingdom").'],
    ['3. Unit abbreviations must match existing units (e.g. "kg", "L", "ea").'],
    ['4. For Recipes: repeat the recipe_name on each row for each ingredient. Leave ingredient columns blank for recipe-name-only rows.'],
    ['5. prep_unit + prep_to_base: prep unit used in recipes and how many base units it equals (e.g. portion → 0.15 kg).'],
    ['6. For Menus: list menu name + country in "Menus" sheet. List items in "Menu Items" sheet.'],
    ['7. Leave optional columns blank — do not delete them.'],
    ['8. Delete these instructions before uploading, or leave them — the importer ignores non-data rows.'],
  ]), 'Instructions');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['name', 'country'],
    ['Example Vendor', 'United Kingdom'],
  ]), 'Vendors');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['name', 'category', 'unit', 'waste_pct', 'prep_unit', 'prep_to_base', 'notes'],
    ['Chicken Breast', 'Protein', 'kg', '2', 'kg', '1', ''],
    ['Wing Gold Sauce', 'Sauce', 'L', '5', 'L', '1', 'House sauce'],
  ]), 'Ingredients');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['ingredient_name', 'vendor_name', 'purchase_price', 'purchase_unit', 'qty_in_base_units'],
    ['Chicken Breast', 'Example Vendor', '5.50', 'kg', '1'],
    ['Wing Gold Sauce', 'Example Vendor', '8.20', 'L', '1'],
  ]), 'Price Quotes');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['recipe_name', 'category', 'yield_qty', 'yield_unit', 'ingredient_name', 'ingredient_qty', 'ingredient_unit'],
    ['Lemon Pepper Wings', 'Food', '1', 'ea', 'Chicken Breast',  '0.30', 'kg'],
    ['Lemon Pepper Wings', '',    '',  '',   'Wing Gold Sauce',  '0.05', 'L'],
    ['Garlic Parm Wings',  'Food', '1', 'ea', 'Chicken Breast',  '0.30', 'kg'],
  ]), 'Recipes');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['menu_name', 'country', 'description'],
    ['Lunch Menu', 'United Kingdom', 'Weekday lunch'],
    ['Dinner Menu', 'United Kingdom', ''],
  ]), 'Menus');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['menu_name', 'item_type', 'item_name', 'display_name', 'sort_order'],
    ['Lunch Menu', 'recipe',     'Lemon Pepper Wings', 'Lemon Pepper Wings', '1'],
    ['Lunch Menu', 'recipe',     'Garlic Parm Wings',  'Garlic Parm Wings',  '2'],
    ['Dinner Menu','recipe',     'Lemon Pepper Wings', 'Lemon Pepper Wings', '1'],
  ]), 'Menu Items');

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="cogs-import-template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// ── Template parser ───────────────────────────────────────────────────────────
// Reads a COGS-format Excel file with known sheet/column names.

function parseTemplateFile(buffer) {
  const wb       = XLSX.read(buffer, { type: 'buffer' });
  const getSheet = (name) => wb.Sheets[name]
    ? XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '' })
    : [];

  const vendors = getSheet('Vendors')
    .filter(r => r.name)
    .map(r => blankRow({ name: String(r.name).trim(), country: String(r.country || '').trim() }));

  const ingredients = getSheet('Ingredients')
    .filter(r => r.name)
    .map(r => blankRow({
      name:                     String(r.name).trim(),
      source_category:          String(r.category || '').trim(),
      unit:                     String(r.unit || '').trim(),
      waste_pct:                parseFloat(r.waste_pct) || 0,
      prep_unit:                String(r.prep_unit || '').trim(),
      prep_to_base_conversion:  parseFloat(r.prep_to_base || r.prep_to_base_conversion) || 1,
      notes:                    String(r.notes || '').trim(),
    }));

  const price_quotes = getSheet('Price Quotes')
    .filter(r => r.ingredient_name)
    .map(r => blankRow({
      ingredient_name:   String(r.ingredient_name).trim(),
      vendor_name:       String(r.vendor_name || '').trim(),
      purchase_price:    parseFloat(r.purchase_price) || 0,
      purchase_unit:     String(r.purchase_unit || '').trim(),
      qty_in_base_units: parseFloat(r.qty_in_base_units) || 1,
    }));

  // Recipes: group rows by recipe_name
  const recipeMap = new Map();
  for (const r of getSheet('Recipes')) {
    const name = String(r.recipe_name || '').trim();
    if (!name) continue;
    if (!recipeMap.has(name)) {
      recipeMap.set(name, blankRow({
        name,
        source_category: String(r.category || '').trim(),
        yield_qty:       parseFloat(r.yield_qty) || 1,
        yield_unit:      String(r.yield_unit || '').trim(),
        items:           [],
      }));
    }
    if (r.ingredient_name) {
      recipeMap.get(name).items.push({
        ingredient_name: String(r.ingredient_name).trim(),
        qty:             parseFloat(r.ingredient_qty) || 0,
        unit:            String(r.ingredient_unit || '').trim(),
      });
    }
  }

  // Menus: group rows by menu_name using both sheets
  const menuMap = new Map();
  for (const r of getSheet('Menus')) {
    const name = String(r.menu_name || '').trim();
    if (!name) continue;
    if (!menuMap.has(name)) {
      menuMap.set(name, blankRow({
        name,
        country:     String(r.country     || '').trim(),
        description: String(r.description || '').trim(),
        items:       [],
      }));
    }
  }
  for (const r of getSheet('Menu Items')) {
    const mname = String(r.menu_name || '').trim();
    if (!mname) continue;
    if (!menuMap.has(mname)) {
      menuMap.set(mname, blankRow({ name: mname, country: '', description: '', items: [] }));
    }
    const iname = String(r.item_name || '').trim();
    if (iname) {
      menuMap.get(mname).items.push({
        item_type:    String(r.item_type    || 'recipe').trim(),
        item_name:    iname,
        display_name: String(r.display_name || iname).trim(),
        sort_order:   parseInt(r.sort_order) || 0,
      });
    }
  }

  return { vendors, ingredients, price_quotes, recipes: Array.from(recipeMap.values()), menus: Array.from(menuMap.values()) };
}

// ── AI extraction tool ────────────────────────────────────────────────────────

const EXTRACT_TOOL = {
  name:        'submit_staged_data',
  description: 'Submit ALL extracted vendors, ingredients, price quotes and recipes from the file in one call.',
  input_schema: {
    type: 'object',
    properties: {
      vendors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:    { type: 'string' },
            country: { type: 'string', description: 'Country name as written in file' },
          },
          required: ['name'],
        },
      },
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:                    { type: 'string' },
            source_category:         { type: 'string', description: 'Category exactly as in source — do not normalise' },
            unit:                    { type: 'string', description: 'Base unit abbreviation: kg, g, L, ml, ea, etc.' },
            waste_pct:               { type: 'number', description: 'Waste % as a number 0-100 (e.g. 2 not 0.02)' },
            prep_unit:               { type: 'string', description: 'Prep unit used in recipes (e.g. "portion", "slice"). Leave blank if same as base unit.' },
            prep_to_base_conversion: { type: 'number', description: 'How many base units equal one prep unit (e.g. 1 portion = 0.15 kg → 0.15). Default 1.' },
            notes:                   { type: 'string' },
          },
          required: ['name'],
        },
      },
      price_quotes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ingredient_name:   { type: 'string' },
            vendor_name:       { type: 'string' },
            purchase_price:    { type: 'number' },
            purchase_unit:     { type: 'string' },
            qty_in_base_units: { type: 'number', description: 'Quantity that the price covers; default 1' },
          },
          required: ['ingredient_name', 'purchase_price'],
        },
      },
      recipes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:            { type: 'string' },
            source_category: { type: 'string' },
            yield_qty:       { type: 'number' },
            yield_unit:      { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item_name: { type: 'string', description: 'Name of the ingredient or sub-recipe' },
                  item_type: { type: 'string', enum: ['ingredient', 'recipe'],
                    description: 'Use "recipe" when this line is itself a sub-recipe or assembled component (sauce, side, dip, etc.)' },
                  qty:       { type: 'number' },
                  unit:      { type: 'string' },
                },
                required: ['item_name'],
              },
            },
          },
          required: ['name'],
        },
      },
      menus: {
        type: 'array',
        description: 'Only extract menus if the file explicitly contains a menu/price-list structure (menu name + items). Do not invent menus from recipe lists.',
        items: {
          type: 'object',
          properties: {
            name:        { type: 'string', description: 'Menu name' },
            country:     { type: 'string', description: 'Country/market name as written in file' },
            description: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  item_type:    { type: 'string', enum: ['recipe', 'ingredient'], description: 'Usually "recipe"' },
                  item_name:    { type: 'string', description: 'Exact name of the recipe or ingredient' },
                  display_name: { type: 'string', description: 'Display name on menu (may differ from item_name)' },
                  sort_order:   { type: 'integer' },
                },
                required: ['item_name'],
              },
            },
          },
          required: ['name'],
        },
      },
    },
  },
};

async function extractWithAI(client, fileContent, schemaHints) {
  const response = await client.messages.create({
    model:       'claude-haiku-4-5-20251001',
    max_tokens:  8192,
    tool_choice: { type: 'any' },
    tools:       [EXTRACT_TOOL],
    system: `You are a data extraction assistant for a restaurant cost-of-goods (COGS) platform.
Extract all vendors, ingredients, price quotes and recipes from the file.
${schemaHints || ''}

════════════════════════════════════════════════════════════════
CRITICAL: COMBINED ROW FILES (supplier price lists)
════════════════════════════════════════════════════════════════
Many real-world files are supplier product lists where EVERY ROW contains BOTH:
  • Ingredient data  (name, category, base unit)
  • Price quote data (vendor, price, purchase unit, conversion)

When a sheet has ingredient-name columns AND price/vendor columns together, you MUST:
  1. Extract one INGREDIENT per row   (name + category + base unit)
  2. Extract one PRICE QUOTE per row  (ingredient_name, vendor_name, purchase_price, purchase_unit, qty_in_base_units)

Do NOT extract only ingredients and skip the quotes. Do NOT extract only quotes and skip the ingredients.
If there are 80 rows with prices, you must produce 80 ingredients AND 80 price_quotes.

COLUMN → FIELD MAPPING for combined files:
  "Product Name" / "Name" / "Description" / "Item"   → ingredient.name AND price_quote.ingredient_name (must match exactly)
  "Category" / "Group" / "Type"                       → ingredient.source_category
  "Base Unit" / "Unit" / "UOM"                        → ingredient.unit (metric abbreviation: kg, g, L, ml, ea)
  "Vendor" / "Supplier"                               → price_quote.vendor_name (if single vendor column, use for ALL rows)
  "Price" / "Cost" / "Price per Purchase Unit" / "£"  → price_quote.purchase_price (strip £$€ symbols, parse as number)
  "Purchase Unit" / "Pack Size" / "Pack"              → price_quote.purchase_unit (e.g. "1x20kg bag", "6x2900ml")
  "Conversion (Purchase→Base)" / "Conv" / "Conv Factor" → price_quote.qty_in_base_units (numeric; how many base units in one purchase unit)

EXAMPLE — a sheet with these columns:
  SKU | Product Name | Category | Purchase Unit | Base Unit | Conversion | Vendor | Price per Purchase Unit (£)
  Row: RIC102 | Thai Jasmine Rice | Rice | 1x20kg bag | kg | 20 | JJ Food Services | £26.99

Should produce:
  ingredient: { name: "Thai Jasmine Rice", source_category: "Rice", unit: "kg" }
  price_quote: { ingredient_name: "Thai Jasmine Rice", vendor_name: "JJ Food Services", purchase_price: 26.99, purchase_unit: "1x20kg bag", qty_in_base_units: 20 }
════════════════════════════════════════════════════════════════

GENERAL COLUMN MAPPING
- "cost"/"price"/"unit cost"/"INR"/"Cost per UOM" → purchase_price (always strip currency symbols)
- "UOM"/"Recipe Use"/"Unit of Measure"/"measure" → unit
- Keep source_category EXACTLY as it appears in the source file — do not normalise
- waste_pct as 0-100 (e.g. "2%" → 2, not 0.02)
- If costs are listed without a vendor name, use vendor_name "Default Vendor"
- Extract ALL ingredients even if they have no cost yet
- A single vendor listed once at the top of a sheet applies to all rows in that sheet

UNITS — always use metric abbreviations:
- pounds/lb/lbs → kg  |  oz/ounce → g  |  gram/grams/gm → g  |  kilogram/kgs → kg
- milliliter/ml/mls → ml  |  liter/litre/L → L  |  lt/ltr/litre → L
- piece/pieces/per piece/each/ea → ea  |  per 100g → use unit "100g"
- "Conversion Factor" / "Conv Factor" / "Conversion (Purchase→Base)" → qty_in_base_units

MULTI-TIER RECIPE STRUCTURES
- Many spreadsheets have THREE tiers: raw ingredients → sub-recipes (sauces, dips, sides) → main menu items
- Sheets named "Sauces", "Dips", "Sides", "Components", "Sub-recipes" contain sub-recipes — extract each as a recipe
- When a main recipe references a sub-recipe name, set item_type="recipe"
- Blended averages like "Sauce Average" or "Avg Per Wing" are NOT real sub-recipes — skip them`,
    messages: [{ role: 'user', content: fileContent }],
  });

  const tool = response.content.find(b => b.type === 'tool_use' && b.name === 'submit_staged_data');
  if (!tool) throw new Error('AI extraction did not return structured data — try the Template import path instead');

  const raw = tool.input;
  return {
    vendors:      (raw.vendors      || []).map(v => blankRow({ name: String(v.name||'').trim(), country: String(v.country||'').trim() })),
    ingredients:  (raw.ingredients  || []).map(i => blankRow({ name: String(i.name||'').trim(), source_category: String(i.source_category||'').trim(), unit: String(i.unit||'').trim(), waste_pct: parseFloat(i.waste_pct)||0, prep_unit: String(i.prep_unit||'').trim(), prep_to_base_conversion: parseFloat(i.prep_to_base_conversion)||1, notes: String(i.notes||'').trim() })),
    price_quotes: (raw.price_quotes || []).map(p => blankRow({ ingredient_name: String(p.ingredient_name||'').trim(), vendor_name: String(p.vendor_name||'').trim(), purchase_price: parseFloat(p.purchase_price)||0, purchase_unit: String(p.purchase_unit||'').trim(), qty_in_base_units: parseFloat(p.qty_in_base_units)||1 })),
    recipes:      (raw.recipes      || []).map(r => blankRow({ name: String(r.name||'').trim(), source_category: String(r.source_category||'').trim(), yield_qty: parseFloat(r.yield_qty)||1, yield_unit: String(r.yield_unit||'').trim(), items: (r.items||[]).map(i => ({ item_name: String(i.item_name || i.ingredient_name || '').trim(), item_type: i.item_type === 'recipe' ? 'recipe' : 'ingredient', qty: parseFloat(i.qty)||0, unit: String(i.unit||'').trim() })) })),
    menus:        (raw.menus        || []).map(m => blankRow({ name: String(m.name||'').trim(), country: String(m.country||'').trim(), description: String(m.description||'').trim(), items: (m.items||[]).map(i => ({ item_type: i.item_type === 'ingredient' ? 'ingredient' : 'recipe', item_name: String(i.item_name||'').trim(), display_name: String(i.display_name || i.item_name || '').trim(), sort_order: parseInt(i.sort_order)||0 })) })),
  };
}

// ── Duplicate detection ───────────────────────────────────────────────────────

async function detectDuplicates(staged) {
  const [{ rows: exI }, { rows: exR }, { rows: exV }, { rows: exM }] = await Promise.all([
    pool.query('SELECT id, LOWER(name) AS n FROM mcogs_ingredients'),
    pool.query('SELECT id, LOWER(name) AS n FROM mcogs_recipes'),
    pool.query('SELECT id, LOWER(name) AS n FROM mcogs_vendors'),
    pool.query('SELECT id, LOWER(name) AS n FROM mcogs_menus'),
  ]);
  const iMap = new Map(exI.map(r => [r.n, r.id]));
  const rMap = new Map(exR.map(r => [r.n, r.id]));
  const vMap = new Map(exV.map(r => [r.n, r.id]));
  const mMap = new Map(exM.map(r => [r.n, r.id]));

  const check = (name, map) => {
    const l = name.toLowerCase().trim();
    if (map.has(l)) return { id: map.get(l), name };
    for (const [k, id] of map) {
      if (l.length > 3 && (k.includes(l) || l.includes(k))) return { id, name: k };
    }
    return null;
  };

  for (const r of staged.ingredients  || []) { const d = check(r.name, iMap); if (d) { r._duplicate_of = d; r._action = 'skip'; r._status = 'warning'; r._issues = [`Possible duplicate of existing ingredient "${d.name}"`]; } }
  for (const r of staged.recipes      || []) { const d = check(r.name, rMap); if (d) { r._duplicate_of = d; r._action = 'skip'; r._status = 'warning'; r._issues = [`Possible duplicate of existing recipe "${d.name}"`]; } }
  for (const r of staged.vendors      || []) { const d = check(r.name, vMap); if (d) { r._duplicate_of = d; r._action = 'skip'; r._status = 'warning'; r._issues = [`Vendor "${d.name}" already exists`]; } }
  for (const r of staged.menus        || []) { const d = check(r.name, mMap); if (d) { r._duplicate_of = d; r._action = 'skip'; r._status = 'warning'; r._issues = [`Menu "${d.name}" already exists`]; } }
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateStaged(staged) {
  for (const r of staged.vendors || []) {
    if (!r.name) { r._status = 'error'; r._issues.push('Name is required'); }
    if (!r.country) { if (r._status !== 'error') r._status = 'warning'; r._issues.push('No country set — vendor will be saved without a country'); }
  }
  for (const r of staged.ingredients  || []) { if (!r.name) { r._status = 'error'; r._issues.push('Name is required'); } if (!r.source_category) r._issues.push('No category — will remain uncategorised'); }
  for (const r of staged.price_quotes || []) { if (!r.ingredient_name) { r._status = 'error'; r._issues.push('Ingredient name required'); } if (!(r.purchase_price > 0)) { r._status = r._status === 'error' ? 'error' : 'warning'; r._issues.push('Purchase price is zero'); } }
  for (const r of staged.recipes      || []) { if (!r.name) { r._status = 'error'; r._issues.push('Name is required'); } if (!r.items?.length) r._issues.push('No ingredient lines — recipe name only (you can add ingredients later in the Recipes page)'); }
  for (const r of staged.menus        || []) { if (!r.name) { r._status = 'error'; r._issues.push('Name is required'); } if (!r.country) { r._status = r._status === 'error' ? 'error' : 'warning'; r._issues.push('No country — menu will be skipped (country is required)'); } if (!r.items?.length) r._issues.push('No items — menu will be created empty'); }
}

// ── Prerequisites detection + unit resolution ─────────────────────────────────

async function detectPrerequisites(staged) {
  const [{ rows: units }, { rows: countries }] = await Promise.all([
    pool.query('SELECT id, name, abbreviation FROM mcogs_units'),
    pool.query('SELECT LOWER(name) AS n FROM mcogs_countries'),
  ]);
  const countrySet = new Set(countries.map(c => c.n));

  const mu = new Set(), mc = new Set();

  // Resolve every ingredient unit against DB units
  for (const r of staged.ingredients || []) {
    if (!r.unit) continue;
    const res = resolveUnit(r.unit, units);
    if (res.method === 'exact') {
      // Already matched — ensure we're storing the DB abbreviation form
      r.unit = res.resolved;
    } else if (res.method !== 'none' && res.method !== 'unmatched') {
      // Auto-resolved via alias or fuzzy match
      r.unit_source = r.unit;           // keep original for display
      r.unit_method = res.method;
      r.unit        = res.resolved;     // replace with matched DB abbreviation
      r._issues = [...(r._issues || []),
        `Unit "${res.source}" auto-matched to "${res.resolved}" (${res.method}) — check it is correct`];
      if (r._status !== 'error') r._status = 'warning';
    } else if (res.method === 'unmatched') {
      mu.add(r.unit);
    }
  }

  for (const r of staged.vendors || []) {
    if (r.country && !countrySet.has(r.country.toLowerCase())) mc.add(r.country);
  }
  return { missing_units: [...mu], missing_countries: [...mc] };
}

// ── AI category mapping ───────────────────────────────────────────────────────

async function suggestCategoryMapping(client, staged) {
  const sourceCats = new Set();
  for (const r of [...(staged.ingredients||[]), ...(staged.recipes||[])]) {
    if (r.source_category) sourceCats.add(r.source_category);
  }
  if (!sourceCats.size) return {};

  const { rows: dbCats } = await pool.query('SELECT id, name, for_ingredients, for_recipes, for_sales_items FROM mcogs_categories ORDER BY name');

  // No DB categories yet — suggest creating all
  if (!dbCats.length) {
    const out = {};
    for (const cat of sourceCats) out[cat] = { action: 'create', suggested_name: cat, suggested_type: 'ingredient', confidence: 0 };
    return out;
  }

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [{
      role:    'user',
      content: `Map each import category to the closest existing database category. Return ONLY valid JSON, no explanation.

Import categories: ${JSON.stringify([...sourceCats])}

Existing database categories (id, name):
${JSON.stringify(dbCats.map(c => ({ id: c.id, name: c.name })))}

JSON format — keys are the import category names, values are one of:
- Good match (confidence ≥ 0.70): {"action":"map","maps_to_id":<id>,"maps_to_name":"<name>","suggested_type":"ingredient","confidence":<float>}
- No match: {"action":"create","suggested_name":"<clean name>","suggested_type":"ingredient","confidence":0}

Examples: "Chicken"→Protein, "Sauces"→Sauce, "Drinks"→Beverage, "Paper"→Other, "Packaging"→create`,
    }],
  });

  try {
    const text  = response.content.find(b => b.type === 'text')?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* fall through */ }
  return {};
}

// ── Shared staging pipeline ───────────────────────────────────────────────────
// Called by the upload route (AI path) and the chatbot start_import tool.
// Takes already-extracted text content, runs AI extraction + enrichment,
// saves a job row, and returns { job_id, staged_data }.

async function stageFileContent(client, fileContent, filename, userEmail, rawBuffer) {
  // Build schema hints from raw XLSX (if available) to guide AI extraction
  const schemas     = rawBuffer ? buildSheetSchemas(rawBuffer) : {};
  const schemaHints = schemaHintsToPrompt(schemas);

  const staged = await extractWithAI(client, `File: ${filename}\n\n${fileContent}`, schemaHints);

  // Deterministic fallback: synthesise any quotes the AI missed from raw XLSX
  if (rawBuffer) synthesiseMissingQuotes(rawBuffer, staged);

  await detectDuplicates(staged);
  validateStaged(staged);
  staged.prerequisites    = await detectPrerequisites(staged);
  staged.category_mapping = await suggestCategoryMapping(client, staged);

  const { rows } = await pool.query(
    `INSERT INTO mcogs_import_jobs (user_email, source_file, status, staged_data) VALUES ($1,$2,'staging',$3) RETURNING id`,
    [userEmail || null, filename, JSON.stringify(staged)]
  );
  return { job_id: rows[0].id, staged_data: staged };
}

// ── POST /upload ──────────────────────────────────────────────────────────────

router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const importPath = (req.body.importPath || 'ai').trim();
    const userEmail  = req.body.userEmail || null;
    const file       = req.file;
    if (!file) return res.status(400).json({ error: { message: 'No file uploaded' } });

    let staged;

    if (importPath === 'template') {
      staged = parseTemplateFile(file.buffer);

      // Enrichment for template path
      await detectDuplicates(staged);
      validateStaged(staged);
      staged.menus            = staged.menus || [];
      staged.prerequisites    = await detectPrerequisites(staged);
      staged.category_mapping = {};
      const key = aiConfig.get('ANTHROPIC_API_KEY');
      if (key) staged.category_mapping = await suggestCategoryMapping(new Anthropic({ apiKey: key }), staged);

      const { rows } = await pool.query(
        `INSERT INTO mcogs_import_jobs (user_email, source_file, status, staged_data) VALUES ($1,$2,'staging',$3) RETURNING id`,
        [userEmail, file.originalname, JSON.stringify(staged)]
      );
      return res.json({ job_id: rows[0].id, staged_data: staged });
    }

    // AI path
    const key = aiConfig.get('ANTHROPIC_API_KEY');
    if (!key) return res.status(503).json({ error: { message: 'AI import requires an Anthropic API key — configure it in Settings → AI, or use the Template import path.' } });
    const client  = new Anthropic({ apiKey: key });
    const content = await fileToText(file.buffer, file.originalname);
    const result  = await stageFileContent(client, content, file.originalname, userEmail, file.buffer);
    res.json({ job_id: result.job_id, staged_data: result.staged_data });

  } catch (err) {
    console.error('[import/upload]', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /from-text — used by the Pepper chatbot import tool ──────────────────
// Accepts pre-extracted text content (already in the conversation) and runs
// the AI staging pipeline. Returns the same shape as /upload.

router.post('/from-text', async (req, res) => {
  try {
    const { file_content, filename = 'upload', user_email = null } = req.body;
    if (!file_content) return res.status(400).json({ error: { message: 'file_content is required' } });
    const key = aiConfig.get('ANTHROPIC_API_KEY');
    if (!key) return res.status(503).json({ error: { message: 'AI import requires an Anthropic API key.' } });
    const client = new Anthropic({ apiKey: key });
    const result = await stageFileContent(client, file_content, filename, user_email);
    res.json({ job_id: result.job_id, staged_data: result.staged_data });
  } catch (err) {
    console.error('[import/from-text]', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── GET /:id ──────────────────────────────────────────────────────────────────

router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM mcogs_import_jobs WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: { message: 'Import job not found' } });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── PUT /:id — save amended staged data ──────────────────────────────────────

router.put('/:id', async (req, res) => {
  try {
    const { staged_data } = req.body;
    const { rows } = await pool.query(
      `UPDATE mcogs_import_jobs SET staged_data=$1, status='ready', updated_at=NOW() WHERE id=$2 RETURNING id`,
      [JSON.stringify(staged_data), req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: { message: 'Import job not found' } });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── POST /:id/execute ─────────────────────────────────────────────────────────

router.post('/:id/execute', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows: jobs } = await pool.query('SELECT * FROM mcogs_import_jobs WHERE id=$1', [id]);
    if (!jobs.length) return res.status(404).json({ error: { message: 'Import job not found' } });
    const job = jobs[0];
    if (['importing','done'].includes(job.status))
      return res.status(400).json({ error: { message: `Job is already ${job.status}` } });

    await pool.query(`UPDATE mcogs_import_jobs SET status='importing', updated_at=NOW() WHERE id=$1`, [id]);

    const staged = job.staged_data;
    const catMap = staged.category_mapping || {};

    const results = {
      categories: 0,
      vendors: 0, vendors_skipped: 0, vendors_updated: 0,
      ingredients: 0, ingredients_skipped: 0, ingredients_updated: 0,
      price_quotes: 0, price_quotes_skipped: 0,
      recipes: 0, recipes_skipped: 0, recipes_updated: 0, recipe_items: 0,
      recipe_ings_created: 0,
      menus: 0, menus_skipped: 0, menu_items: 0,
      errors: [],
    };

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Create new categories
      for (const [, m] of Object.entries(catMap)) {
        if (m.action !== 'create' || !m.suggested_name) continue;
        const ex = await client.query('SELECT id FROM mcogs_categories WHERE name=$1 LIMIT 1', [m.suggested_name]);
        if (!ex.rows.length) {
          const forIngredients = !m.suggested_type || m.suggested_type === 'ingredient';
          const forRecipes     = m.suggested_type === 'recipe';
          await client.query(
            'INSERT INTO mcogs_categories (name,for_ingredients,for_recipes,for_sales_items) VALUES ($1,$2,$3,false)',
            [m.suggested_name, forIngredients, forRecipes]
          );
          results.categories++;
        }
      }

      // Build category name→id lookup for FK resolution (after new categories are created above)
      const { rows: allCats } = await client.query('SELECT id, LOWER(name) AS n FROM mcogs_categories');
      const catIdLookup = {};
      for (const c of allCats) catIdLookup[c.n] = c.id;

      // Helper: resolve source category string → integer category_id (or null)
      const catId = (src) => {
        if (!src) return null;
        const m = catMap[src];
        let name;
        if (!m) name = src;
        else name = m.action === 'map' ? (m.maps_to_name || src) : (m.suggested_name || src);
        return catIdLookup[name.toLowerCase()] || null;
      };

      // 2. Lookups
      const { rows: units }     = await client.query('SELECT id, LOWER(name) AS n, LOWER(abbreviation) AS a FROM mcogs_units');
      const { rows: countries } = await client.query('SELECT id, LOWER(name) AS n FROM mcogs_countries');
      const unitLookup    = {};
      for (const u of units) { unitLookup[u.n] = u.id; unitLookup[u.a] = u.id; }
      const countryLookup = {};
      for (const c of countries) countryLookup[c.n] = c.id;

      // 3. Vendors
      const vendorLookup = {};
      const { rows: exV } = await client.query('SELECT id, LOWER(name) AS n FROM mcogs_vendors');
      for (const v of exV) vendorLookup[v.n] = v.id;

      for (const row of staged.vendors || []) {
        if (row._action === 'skip') { results.vendors_skipped++; continue; }
        if (!row.name) continue;
        const cid     = row.country ? countryLookup[row.country.toLowerCase()] || null : null;
        const contact = row.contact || null;
        const email   = row.email   || null;
        const phone   = row.phone   || null;
        const notes   = row.notes   || null;
        if (row._action === 'override' && row._duplicate_of?.id) {
          await client.query(
            `UPDATE mcogs_vendors SET name=$1,country_id=$2,contact=$3,email=$4,phone=$5,notes=$6,updated_at=NOW() WHERE id=$7`,
            [row.name, cid, contact, email, phone, notes, row._duplicate_of.id]
          );
          vendorLookup[row.name.toLowerCase()] = row._duplicate_of.id;
          results.vendors_updated++;
          continue;
        }
        const { rows } = await client.query(
          `INSERT INTO mcogs_vendors (name,country_id,contact,email,phone,notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [row.name, cid, contact, email, phone, notes]
        );
        vendorLookup[row.name.toLowerCase()] = rows[0].id;
        results.vendors++;
      }

      // 4. Ingredients
      const ingLookup = {};
      const { rows: exI } = await client.query('SELECT id, LOWER(name) AS n FROM mcogs_ingredients');
      for (const i of exI) ingLookup[i.n] = i.id;

      for (const row of staged.ingredients || []) {
        if (row._action === 'skip') { results.ingredients_skipped++; continue; }
        if (!row.name) continue;
        const uid = row.unit ? unitLookup[row.unit.toLowerCase()] || null : null;
        if (row._action === 'override' && row._duplicate_of?.id) {
          await client.query(
            'UPDATE mcogs_ingredients SET name=$1,category_id=$2,base_unit_id=$3,waste_pct=$4,notes=$5,default_prep_unit=$6,default_prep_to_base_conversion=$7,updated_at=NOW() WHERE id=$8',
            [row.name, catId(row.source_category), uid, row.waste_pct||0, row.notes||null, row.prep_unit||null, row.prep_to_base_conversion||1, row._duplicate_of.id]
          );
          ingLookup[row.name.toLowerCase()] = row._duplicate_of.id;
          results.ingredients_updated++;
          continue;
        }
        const { rows } = await client.query(
          'INSERT INTO mcogs_ingredients (name,category_id,base_unit_id,waste_pct,notes,default_prep_unit,default_prep_to_base_conversion) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [row.name, catId(row.source_category), uid, row.waste_pct||0, row.notes||null, row.prep_unit||null, row.prep_to_base_conversion||1]
        );
        ingLookup[row.name.toLowerCase()] = rows[0].id;
        results.ingredients++;
      }

      // 4.5 Recipe ingredient mappings — resolve ingredients referenced in recipes
      // that weren't found in the import. This adds them to ingLookup before recipes are processed.
      const recipeIngMap = staged.recipe_ingredient_mapping || {};
      for (const [origName, m] of Object.entries(recipeIngMap)) {
        const nameLower = origName.toLowerCase();
        if (ingLookup[nameLower]) continue; // already resolved from import
        if (m.action === 'skip') continue;
        if (m.action === 'map' && m.maps_to_id) {
          ingLookup[nameLower] = m.maps_to_id;
          continue;
        }
        if (m.action === 'create') {
          const { rows: newIng } = await client.query(
            'INSERT INTO mcogs_ingredients (name, default_prep_unit) VALUES ($1, $2) RETURNING id',
            [origName, m.new_prep_unit || null]
          );
          ingLookup[nameLower] = newIng[0].id;
          results.recipe_ings_created++;
        }
      }

      // 5. Price Quotes
      for (const row of staged.price_quotes || []) {
        if (row._action === 'skip') { results.price_quotes_skipped++; continue; }
        const iid = row.ingredient_name ? ingLookup[row.ingredient_name.toLowerCase()] : null;
        const vid = row.vendor_name     ? vendorLookup[row.vendor_name.toLowerCase()]  : null;
        if (!iid) { results.errors.push(`Quote skipped: ingredient "${row.ingredient_name}" not found`); continue; }
        await client.query(
          'INSERT INTO mcogs_price_quotes (ingredient_id,vendor_id,purchase_price,purchase_unit,qty_in_base_units,is_active) VALUES ($1,$2,$3,$4,$5,true)',
          [iid, vid || null, row.purchase_price, row.purchase_unit || '', row.qty_in_base_units || 1]
        );
        results.price_quotes++;
      }

      // 6a. Recipes — first pass: create all recipe shells (so sub-recipe refs resolve)
      const recipeLookup = {};
      const { rows: exR } = await client.query('SELECT id, LOWER(name) AS n FROM mcogs_recipes');
      for (const r of exR) recipeLookup[r.n] = r.id;

      const recipeRows = []; // keep for second pass
      for (const row of staged.recipes || []) {
        if (row._action === 'skip') { results.recipes_skipped++; continue; }
        if (!row.name) continue;
        const yuid = row.yield_unit ? unitLookup[row.yield_unit.toLowerCase()] || null : null;
        if (row._action === 'override' && row._duplicate_of?.id) {
          const existingRid = row._duplicate_of.id;
          await client.query(
            'UPDATE mcogs_recipes SET name=$1,category_id=$2,yield_qty=$3,yield_unit_id=$4,updated_at=NOW() WHERE id=$5',
            [row.name, catId(row.source_category), row.yield_qty||1, yuid, existingRid]
          );
          // Remove existing items so they get re-added in pass 2
          await client.query('DELETE FROM mcogs_recipe_items WHERE recipe_id=$1', [existingRid]);
          recipeLookup[row.name.toLowerCase()] = existingRid;
          recipeRows.push({ row, rid: existingRid });
          results.recipes_updated++;
          continue;
        }
        const { rows: ins } = await client.query(
          'INSERT INTO mcogs_recipes (name,category_id,yield_qty,yield_unit_id) VALUES ($1,$2,$3,$4) RETURNING id',
          [row.name, catId(row.source_category), row.yield_qty || 1, yuid]
        );
        const rid = ins[0].id;
        recipeLookup[row.name.toLowerCase()] = rid;
        recipeRows.push({ row, rid });
        results.recipes++;
      }

      // 6b. Recipes — second pass: add items (ingredients or sub-recipe refs)
      for (const { row, rid } of recipeRows) {
        for (const item of row.items || []) {
          const name = (item.item_name || item.ingredient_name || '').toLowerCase().trim();
          if (!name) continue;

          if (item.item_type === 'recipe') {
            const subId = recipeLookup[name] || null;
            if (!subId) { results.errors.push(`Recipe item skipped: sub-recipe "${name}" not found in this import`); continue; }
            await client.query(
              'INSERT INTO mcogs_recipe_items (recipe_id,item_type,recipe_item_id,prep_qty,prep_unit) VALUES ($1,\'recipe\',$2,$3,$4)',
              [rid, subId, item.qty || 0, item.unit || '']
            );
          } else {
            const iid = ingLookup[name] || null;
            if (!iid) { results.errors.push(`Recipe item skipped: ingredient "${name}" not found`); continue; }
            await client.query(
              'INSERT INTO mcogs_recipe_items (recipe_id,item_type,ingredient_id,prep_qty,prep_unit) VALUES ($1,\'ingredient\',$2,$3,$4)',
              [rid, iid, item.qty || 0, item.unit || '']
            );
          }
          results.recipe_items++;
        }
      }

      // 7. Menus
      const menuLookup = {};
      const { rows: exMn } = await client.query('SELECT id, LOWER(name) AS n FROM mcogs_menus');
      for (const m of exMn) menuLookup[m.n] = m.id;

      for (const row of staged.menus || []) {
        if (row._action === 'skip') { results.menus_skipped++; continue; }
        if (!row.name) continue;
        const cid = row.country ? countryLookup[row.country.toLowerCase()] || null : null;
        if (!cid) {
          results.errors.push(`Menu "${row.name}" skipped: country "${row.country}" not found — create the market first`);
          continue;
        }
        const { rows: ins } = await client.query(
          'INSERT INTO mcogs_menus (name,country_id,description) VALUES ($1,$2,$3) RETURNING id',
          [row.name, cid, row.description || null]
        );
        const mid = ins[0].id;
        menuLookup[row.name.toLowerCase()] = mid;
        let sortIdx = 1;
        for (const item of row.items || []) {
          const iname = (item.item_name || '').toLowerCase().trim();
          if (!iname) continue;
          const displayName = item.display_name || item.item_name || iname;
          let recipe_id = null, ingredient_id = null, itemType = item.item_type || 'recipe';
          if (itemType === 'ingredient') {
            ingredient_id = ingLookup[iname] || null;
            if (!ingredient_id) { results.errors.push(`Menu item skipped: ingredient "${iname}" not found`); continue; }
          } else {
            recipe_id = recipeLookup[iname] || null;
            if (!recipe_id) { results.errors.push(`Menu item skipped: recipe "${iname}" not found (import recipes first or check spelling)`); continue; }
          }
          const so = item.sort_order || sortIdx;
          await client.query(
            'INSERT INTO mcogs_menu_items (menu_id,item_type,recipe_id,ingredient_id,display_name,sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
            [mid, itemType, recipe_id, ingredient_id, String(displayName).trim(), so]
          );
          results.menu_items++;
          sortIdx++;
        }
        results.menus++;
      }

      await client.query('COMMIT');
      await pool.query(`UPDATE mcogs_import_jobs SET status='done', results=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(results), id]);
      res.json({ success: true, results });

    } catch (err) {
      await client.query('ROLLBACK');
      await pool.query(`UPDATE mcogs_import_jobs SET status='failed', updated_at=NOW() WHERE id=$1`, [id]);
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[import/execute]', err);
    res.status(500).json({ error: { message: err.message } });
  }
});

// ── DELETE /:id ───────────────────────────────────────────────────────────────

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM mcogs_import_jobs WHERE id=$1', [req.params.id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = { router, stageFileContent };
