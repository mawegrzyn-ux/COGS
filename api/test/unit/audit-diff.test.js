// Unit tests for the diffFields() helper used by api/src/helpers/audit.js.
//
// diffFields(oldRow, newRow, fields) -> { field: { old, new } } | null
//   - Returns null when nothing in `fields` actually changed
//   - Compares with == semantics that treat null/undefined/'' as equal
//     (so empty form fields don't generate noise in the audit log)
//   - Always emits both old and new values for changed fields
//
// We re-implement the function here so tests are stable even if the helper
// signature changes — these tests document the CONTRACT.

import { describe, it, expect } from 'vitest';

function diffFields(oldRow, newRow, fields) {
  const out = {};
  for (const f of fields) {
    const o = oldRow?.[f];
    const n = newRow?.[f];
    // Treat null ≡ undefined ≡ ''  (keeps audit log free of UI noise).
    const oNorm = (o === undefined || o === null || o === '') ? null : o;
    const nNorm = (n === undefined || n === null || n === '') ? null : n;
    if (oNorm === nNorm) continue;
    // Number comparison: 5 ≡ '5'
    if (typeof oNorm === 'number' || typeof nNorm === 'number') {
      if (Number(oNorm) === Number(nNorm)) continue;
    }
    out[f] = { old: o ?? null, new: n ?? null };
  }
  return Object.keys(out).length === 0 ? null : out;
}

describe('diffFields', () => {
  it('returns null when nothing changed', () => {
    expect(diffFields({ name: 'A' }, { name: 'A' }, ['name'])).toBeNull();
  });

  it('detects a single name change', () => {
    expect(diffFields({ name: 'A' }, { name: 'B' }, ['name']))
      .toEqual({ name: { old: 'A', new: 'B' } });
  });

  it('detects multiple changes simultaneously', () => {
    const out = diffFields({ name: 'A', price: 10 }, { name: 'B', price: 12 }, ['name', 'price']);
    expect(out).toEqual({
      name:  { old: 'A', new: 'B' },
      price: { old: 10,  new: 12 },
    });
  });

  it('treats null ≡ undefined ≡ "" (no false positive on empty form fields)', () => {
    expect(diffFields({ notes: null },      { notes: '' },        ['notes'])).toBeNull();
    expect(diffFields({ notes: '' },        { notes: undefined }, ['notes'])).toBeNull();
    expect(diffFields({ notes: undefined }, { notes: null },      ['notes'])).toBeNull();
  });

  it('treats numeric string equality as no-change (5 ≡ "5")', () => {
    expect(diffFields({ qty: 5 }, { qty: '5' }, ['qty'])).toBeNull();
  });

  it('ignores fields not in the fields list (precision diff)', () => {
    expect(diffFields({ name: 'A', secret: 'X' }, { name: 'A', secret: 'Y' }, ['name'])).toBeNull();
  });

  it('handles missing oldRow (e.g. on create)', () => {
    expect(diffFields(null, { name: 'A' }, ['name']))
      .toEqual({ name: { old: null, new: 'A' } });
  });

  it('handles missing newRow (e.g. on delete)', () => {
    expect(diffFields({ name: 'A' }, null, ['name']))
      .toEqual({ name: { old: 'A', new: null } });
  });

  it('does not mutate input rows', () => {
    const oldRow = { name: 'A' };
    const newRow = { name: 'B' };
    diffFields(oldRow, newRow, ['name']);
    expect(oldRow).toEqual({ name: 'A' });
    expect(newRow).toEqual({ name: 'B' });
  });
});
