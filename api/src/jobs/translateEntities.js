'use strict';
// =============================================================================
// Entity Translation Pre-Warm Job
// For each active language (except English) and each translatable entity table,
// finds rows whose translation for that language is missing or stale (AI source
// hash doesn't match current English). Sends a batch to Claude Haiku and
// writes the results back. Never overwrites human-reviewed entries.
// =============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/pool');
const aiConfig  = require('../helpers/aiConfig');
const { hashText, mergeTranslations } = require('../helpers/translate');

const MODEL        = 'claude-haiku-4-5-20251001';
const BATCH_SIZE   = 50;
const MAX_ATTEMPTS = 2;

// Entity table → translatable fields + friendly description
const ENTITIES = [
  { table: 'mcogs_ingredients',        fields: ['name', 'notes'],          desc: 'restaurant ingredient names and notes' },
  { table: 'mcogs_recipes',            fields: ['name', 'description'],    desc: 'restaurant recipe names and descriptions' },
  { table: 'mcogs_sales_items',        fields: ['name', 'display_name', 'description'], desc: 'point-of-sale menu items' },
  { table: 'mcogs_modifier_groups',    fields: ['name', 'description'],    desc: 'menu modifier group names (e.g. "Sauces", "Add-ons")' },
  { table: 'mcogs_modifier_options',   fields: ['name'],                   desc: 'modifier option names' },
  { table: 'mcogs_combo_steps',        fields: ['name'],                   desc: 'combo step names (e.g. "Pick a drink")' },
  { table: 'mcogs_combo_step_options', fields: ['name'],                   desc: 'combo step option names' },
  { table: 'mcogs_categories',         fields: ['name'],                   desc: 'ingredient/recipe categories' },
  { table: 'mcogs_vendors',            fields: ['name', 'notes'],          desc: 'vendor/supplier names (keep proper nouns unchanged where appropriate)' },
  { table: 'mcogs_price_levels',       fields: ['name'],                   desc: 'price level names (e.g. "Dine In", "Delivery")' },
  { table: 'mcogs_menus',              fields: ['name', 'description'],    desc: 'menu names and descriptions' },
];

async function getActiveLanguages(onlyLang) {
  const where = onlyLang ? "WHERE code = $1 AND is_active = TRUE AND code != 'en'" : "WHERE is_active = TRUE AND code != 'en'";
  const params = onlyLang ? [onlyLang] : [];
  const { rows } = await pool.query(`SELECT code, name, native_name FROM mcogs_languages ${where} ORDER BY sort_order, code`, params);
  return rows;
}

/**
 * For a given entity + language, returns rows that need translation
 * (missing OR stale AI translations; skips human-reviewed entries).
 */
async function findStaleRows(entity, langCode) {
  const fieldsList = entity.fields.join(', ');
  const { rows } = await pool.query(
    `SELECT id, translations, ${fieldsList} FROM ${entity.table}`
  );
  const stale = [];
  for (const row of rows) {
    const current = row.translations?.[langCode];
    if (current?._meta?.source === 'human') continue; // don't touch human
    const sourceText = row[entity.fields[0]]; // primary field drives hash
    if (!sourceText) continue;
    const currentHash = hashText(sourceText);
    if (!current || current._meta?.hash !== currentHash) {
      // Include only fields that actually have a value
      const payload = { id: row.id };
      for (const f of entity.fields) if (row[f] != null) payload[f] = row[f];
      stale.push({ row: payload, sourceText });
    }
  }
  return stale;
}

async function callHaiku(client, langName, entityDesc, items) {
  // items: [{ id, name, description, ... }]
  const itemsJson = JSON.stringify(items, null, 2);
  const prompt = `You are translating ${entityDesc} from English to ${langName}.

Rules:
- Keep translations concise and appropriate for food service / restaurant context.
- Preserve brand names, trademarks, measurements, and abbreviations unchanged.
- Keep the same tone (casual menu language, not formal prose).
- Return ONLY a JSON array with the same IDs and same field keys. No prose, no preamble.

Items:
${itemsJson}

Return a JSON array in the exact shape:
[{"id": 1, "name": "...", "description": "..."}, ...]`;

  const result = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  });
  const text = (result.content?.[0]?.text || '').trim();
  // Strip possible code fence
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    // Try to extract first JSON array
    const m = cleaned.match(/\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch {}
    throw new Error('Haiku returned non-JSON output');
  }
}

async function writeTranslations(entity, langCode, translated, byId) {
  // translated: array of {id, field1, field2, ...}
  // byId: Map(id → sourceText) for hashing
  for (const item of translated) {
    const id = Number(item.id);
    if (!Number.isFinite(id)) continue;
    const sourceText = byId.get(id);
    if (!sourceText) continue;
    const fields = {};
    for (const f of entity.fields) if (item[f] != null) fields[f] = String(item[f]);
    if (!Object.keys(fields).length) continue;

    // Fetch current translations, merge, write back
    const { rows: [cur] } = await pool.query(`SELECT translations FROM ${entity.table} WHERE id = $1`, [id]);
    if (!cur) continue;
    const merged = mergeTranslations(cur.translations, langCode, fields, {
      source: 'ai',
      sourceText,
    });
    await pool.query(`UPDATE ${entity.table} SET translations = $1 WHERE id = $2`, [merged, id]);
  }
}

async function translateEntityForLang(client, entity, lang, dryRun) {
  const stale = await findStaleRows(entity, lang.code);
  if (!stale.length) return { entity: entity.table, lang: lang.code, translated: 0, skipped: 0 };

  let translatedCount = 0;
  let errors = 0;

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    const batch = stale.slice(i, i + BATCH_SIZE);
    const items = batch.map(s => s.row);
    const byId = new Map(batch.map(s => [s.row.id, s.sourceText]));

    if (dryRun) {
      translatedCount += items.length;
      continue;
    }

    let attempt = 0, ok = false, result;
    while (attempt < MAX_ATTEMPTS && !ok) {
      attempt++;
      try {
        result = await callHaiku(client, lang.native_name || lang.name, entity.desc, items);
        if (!Array.isArray(result)) throw new Error('Non-array response');
        ok = true;
      } catch (err) {
        console.warn(`[translate] ${entity.table}/${lang.code} batch ${i}-${i+batch.length} attempt ${attempt} failed: ${err.message}`);
        if (attempt >= MAX_ATTEMPTS) errors++;
      }
    }
    if (ok) {
      await writeTranslations(entity, lang.code, result, byId);
      translatedCount += result.length;
    }
  }

  return { entity: entity.table, lang: lang.code, translated: translatedCount, errors, total: stale.length };
}

/**
 * Run the translation pre-warm. Options:
 *   onlyLang — limit to one language (used by /translations/warm)
 *   onlyEntity — limit to one entity table
 *   dryRun — report what would be translated without calling Haiku
 */
async function runTranslation({ onlyLang, onlyEntity, dryRun = false } = {}) {
  const apiKey = aiConfig.get('ANTHROPIC_API_KEY');
  if (!apiKey && !dryRun) {
    console.warn('[translate] No Anthropic API key — skipping');
    return { ok: false, reason: 'no_api_key' };
  }
  const client = apiKey ? new Anthropic({ apiKey }) : null;

  const langs = await getActiveLanguages(onlyLang);
  if (!langs.length) return { ok: true, reason: 'no_active_languages', results: [] };

  const entities = onlyEntity ? ENTITIES.filter(e => e.table === onlyEntity) : ENTITIES;
  const results = [];
  for (const lang of langs) {
    for (const entity of entities) {
      try {
        const r = await translateEntityForLang(client, entity, lang, dryRun);
        results.push(r);
      } catch (err) {
        console.error(`[translate] ${entity.table}/${lang.code} failed:`, err.message);
        results.push({ entity: entity.table, lang: lang.code, error: err.message });
      }
    }
  }

  const startedAt = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO mcogs_settings (key, data) VALUES ('translation_jobs', $1)
       ON CONFLICT (key) DO UPDATE SET data = $1`,
      [{ last_run_at: startedAt, results }]
    );
  } catch {}

  return { ok: true, started_at: startedAt, results };
}

module.exports = { runTranslation };
