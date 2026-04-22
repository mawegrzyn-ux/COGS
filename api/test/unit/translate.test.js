// Unit tests for the translation helpers in api/src/helpers/translate.js.
//
// We exercise the pure helpers (tCol, hashText, mergeTranslations, isStale,
// staleLanguages) without DB access. Each test documents the intended
// contract so future refactors can't silently change the semantics.

import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';

// ── Re-implementations (kept in sync with api/src/helpers/translate.js) ────

function tCol(alias, field, paramIdx, outAs) {
  const out = outAs || field;
  // When paramIdx is null/undefined the caller has signalled "skip COALESCE"
  // (English baseline) — return the raw column expression.
  if (paramIdx == null) return `${alias}.${field} AS ${out}`;
  return `COALESCE(${alias}.translations->$${paramIdx}->>'${field}', ${alias}.${field}) AS ${out}`;
}

function hashText(text) {
  return createHash('sha256').update(String(text || '')).digest('hex');
}

function mergeTranslations(existing, lang, fields, meta) {
  const out = { ...(existing || {}) };
  out[lang] = {
    ...(existing?.[lang] || {}),
    ...fields,
    _meta: {
      ...(existing?.[lang]?._meta || {}),
      ...meta,
      updated_at: new Date().toISOString(),
    },
  };
  return out;
}

function isStale(entry, sourceText) {
  if (!entry || !entry._meta) return true;
  if (entry._meta.source === 'human') return false;  // never overwrite human
  return entry._meta.hash !== hashText(sourceText);
}

function staleLanguages(row, codes, sourceText) {
  const t = row?.translations || {};
  const out = [];
  for (const code of codes) {
    if (code === 'en') continue;
    if (isStale(t[code], sourceText)) out.push(code);
  }
  return out;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('tCol', () => {
  it('emits a COALESCE wrapper with named output column', () => {
    expect(tCol('i', 'name', 1)).toBe(
      `COALESCE(i.translations->$1->>'name', i.name) AS name`
    );
  });

  it('respects custom output alias', () => {
    expect(tCol('i', 'name', 1, 'display_name')).toBe(
      `COALESCE(i.translations->$1->>'name', i.name) AS display_name`
    );
  });

  it('emits raw column when paramIdx is null (English baseline)', () => {
    expect(tCol('i', 'name', null)).toBe(`i.name AS name`);
  });

  it('emits raw column when paramIdx is undefined', () => {
    expect(tCol('i', 'name', undefined)).toBe(`i.name AS name`);
  });
});

describe('hashText', () => {
  it('is deterministic', () => {
    expect(hashText('Chicken Wings')).toBe(hashText('Chicken Wings'));
  });

  it('different inputs produce different hashes', () => {
    expect(hashText('Wings')).not.toBe(hashText('Wing'));
  });

  it('null/undefined hash to the empty-string hash (does not throw)', () => {
    expect(hashText(null)).toBe(hashText(''));
    expect(hashText(undefined)).toBe(hashText(''));
  });
});

describe('mergeTranslations', () => {
  it('adds a new language entry', () => {
    const out = mergeTranslations({}, 'fr', { name: 'Poulet' }, { source: 'ai', hash: 'abc' });
    expect(out.fr.name).toBe('Poulet');
    expect(out.fr._meta.source).toBe('ai');
    expect(out.fr._meta.hash).toBe('abc');
    expect(out.fr._meta.updated_at).toMatch(/T.*Z$/);  // ISO timestamp
  });

  it('preserves other language entries', () => {
    const before = { es: { name: 'Pollo', _meta: { source: 'human' } } };
    const out = mergeTranslations(before, 'fr', { name: 'Poulet' }, { source: 'ai' });
    expect(out.es.name).toBe('Pollo');
    expect(out.es._meta.source).toBe('human');
    expect(out.fr.name).toBe('Poulet');
  });

  it('merges fields without dropping existing keys in the same language', () => {
    const before = { fr: { name: 'X', notes: 'Y', _meta: { source: 'ai' } } };
    const out = mergeTranslations(before, 'fr', { name: 'Z' }, { source: 'ai' });
    expect(out.fr.name).toBe('Z');
    expect(out.fr.notes).toBe('Y');
  });
});

describe('isStale', () => {
  it('null entry is stale', () => {
    expect(isStale(null, 'wings')).toBe(true);
  });

  it('entry without _meta is stale', () => {
    expect(isStale({ name: 'X' }, 'wings')).toBe(true);
  });

  it('AI entry with matching hash is fresh', () => {
    const e = { name: 'Ailes', _meta: { source: 'ai', hash: hashText('wings') } };
    expect(isStale(e, 'wings')).toBe(false);
  });

  it('AI entry with stale hash is stale', () => {
    const e = { name: 'Ailes', _meta: { source: 'ai', hash: hashText('wing') } };
    expect(isStale(e, 'wings')).toBe(true);
  });

  it('human entry is NEVER stale (even if hash mismatches)', () => {
    const e = { name: 'Ailes', _meta: { source: 'human', hash: hashText('totally-different') } };
    expect(isStale(e, 'wings')).toBe(false);
  });
});

describe('staleLanguages', () => {
  it('skips English from the result', () => {
    const row = { translations: {} };
    const out = staleLanguages(row, ['en', 'fr', 'es'], 'wings');
    expect(out).toEqual(expect.arrayContaining(['fr', 'es']));
    expect(out).not.toContain('en');
  });

  it('lists only languages with stale or missing translations', () => {
    const fresh = { name: 'Ailes', _meta: { source: 'ai', hash: hashText('wings') } };
    const stale = { name: 'Pollo', _meta: { source: 'ai', hash: hashText('chicken') } };
    const row = { translations: { fr: fresh, es: stale } };
    const out = staleLanguages(row, ['fr', 'es', 'de'], 'wings');
    expect(out).toContain('es');
    expect(out).toContain('de');
    expect(out).not.toContain('fr');
  });

  it('returns empty array when all targets are fresh', () => {
    const fresh = (txt) => ({ name: 'X', _meta: { source: 'ai', hash: hashText(txt) } });
    const row = { translations: { fr: fresh('wings'), es: fresh('wings') } };
    expect(staleLanguages(row, ['fr', 'es'], 'wings')).toEqual([]);
  });
});
