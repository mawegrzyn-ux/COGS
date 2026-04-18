// Translation helpers for multi-language data.
// Plan: docs/LANGUAGE_IMPLEMENTATION_PLAN.md

const crypto = require('crypto');

/**
 * Generate a SELECT expression that resolves a translatable field via the
 * translations JSONB column, falling back to the base column.
 *
 *   tCol('i', 'name', 2)  →  COALESCE(i.translations->$2->>'name', i.name) AS name
 *
 * When langParam is null/undefined or resolves to 'en', callers can skip the
 * COALESCE entirely for performance.
 *
 * @param {string} alias    table alias in the FROM/JOIN clause (e.g. 'i')
 * @param {string} field    column name on the base table (e.g. 'name')
 * @param {number} paramIdx 1-indexed parameter position for the language code
 * @param {string} [outAs]  alias for the SELECT expression (defaults to field)
 */
function tCol(alias, field, paramIdx, outAs) {
  const as = outAs || field;
  return `COALESCE(${alias}.translations->$${paramIdx}->>'${field}', ${alias}.${field}) AS ${as}`;
}

/**
 * SHA-256 of the source English text, used to detect stale AI translations
 * when the English source is edited.
 */
function hashText(text) {
  if (text == null) return null;
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

/**
 * Safely merge a partial translation into the existing JSONB blob.
 * - Human translations are never overwritten by AI unless force=true.
 * - Stamps _meta with source, hash (of source text), reviewed flag.
 *
 * @param {object} existing   current translations JSONB from the row
 * @param {string} lang       target language code (e.g. 'fr')
 * @param {object} fields     field → translated value  (e.g. { name: 'Poulet' })
 * @param {object} meta       { source: 'ai'|'human', sourceText?: string, reviewer?: string, force?: boolean }
 * @returns {object}          new translations blob (don't mutate `existing`)
 */
function mergeTranslations(existing, lang, fields, meta = {}) {
  const next = { ...(existing || {}) };
  const prev = next[lang] || {};

  // Protect human-reviewed entries from AI overwrite unless forced
  if (prev._meta?.source === 'human' && meta.source === 'ai' && !meta.force) {
    return existing || {};
  }

  const entry = { ...prev, ...fields };
  entry._meta = {
    source:     meta.source || 'ai',
    hash:       meta.sourceText != null ? hashText(meta.sourceText) : prev._meta?.hash,
    reviewed:   meta.source === 'human' ? true : (prev._meta?.reviewed ?? false),
    reviewed_by: meta.reviewer || prev._meta?.reviewed_by,
    updated_at: new Date().toISOString(),
  };
  next[lang] = entry;
  return next;
}

/**
 * Detects whether an AI translation is stale relative to the current English
 * source. Human-reviewed entries are never considered stale.
 */
function isStale(translationEntry, currentSourceText) {
  if (!translationEntry) return true;
  if (translationEntry._meta?.source === 'human') return false;
  const currentHash = hashText(currentSourceText);
  return translationEntry._meta?.hash !== currentHash;
}

/**
 * Returns an array of language codes that need re-translation for a given row.
 * Used by the nightly cron.
 */
function staleLanguages(row, activeLangCodes, sourceText) {
  const translations = row.translations || {};
  return activeLangCodes.filter(lang => isStale(translations[lang], sourceText));
}

/**
 * Convenience for route handlers. Returns a small object describing whether
 * translation is active and the bind-parameter position for the lang code.
 *
 *   const { active, lang, paramIdx, params } = getLangContext(req, [extra])
 *   // active = true if req.language is set and not 'en'
 *   // lang   = 'fr' | null
 *   // paramIdx = 1-indexed position of lang in params, or null
 *   // params = the existing params array with lang prepended when active
 */
function getLangContext(req, baseParams = []) {
  const lang = req?.language && req.language !== 'en' ? req.language : null;
  if (!lang) return { active: false, lang: null, paramIdx: null, params: baseParams };
  return {
    active: true,
    lang,
    paramIdx: 1,
    params: [lang, ...baseParams],
  };
}

/**
 * Set the Content-Language response header when a non-English response was served.
 */
function setContentLanguage(res, req) {
  if (req?.language && req.language !== 'en') res.setHeader('Content-Language', req.language);
}

module.exports = { tCol, hashText, mergeTranslations, isStale, staleLanguages, getLangContext, setContentLanguage };

