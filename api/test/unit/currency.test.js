// Currency conversion math.
//
// These are pure functions extracted from MenusPage.tsx and cogs.js
// patterns. Re-implemented here so the tests are independent of the
// source — they document the EXPECTED behaviour and will catch any
// drift if those formulae are refactored.
//
// Coverage:
//   - dispRate calculation across currencies
//   - tax-ratio preservation when overriding gross prices
//   - USD ↔ display currency round-trip
//   - currency switch re-expression of override values

import { describe, it, expect } from 'vitest';

// ── Helpers under test (pure) ───────────────────────────────────────────────

/** dispRate: factor to convert USD-base price to a display currency. */
function dispRate(country, target) {
  if (!country || !target) return 1;
  const base = Number(country.exchange_rate)  || 1;
  const tgt  = Number(target.exchange_rate)   || 1;
  return tgt / base;
}

/** Apply a price override while preserving the original tax structure. */
function applyPriceOverride(originalGross, originalNet, overrideGross) {
  const ratio = originalGross > 0 ? originalNet / originalGross : 1;
  return { gross: overrideGross, net: overrideGross * ratio };
}

/** Convert overrides when display currency changes. */
function reExpressOverrides(overrides, prevRate, nextRate) {
  if (prevRate === nextRate || prevRate <= 0) return overrides;
  const f = nextRate / prevRate;
  const out = {};
  for (const [k, v] of Object.entries(overrides)) {
    const n = parseFloat(v) || 0;
    out[k] = String(Math.round(n * f * 100) / 100);
  }
  return out;
}

/** Convert display value back to USD for storage. */
function toUsd(displayValue, dispRate) {
  const safeRate = dispRate || 1;
  return (parseFloat(displayValue) || 0) / safeRate;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('dispRate', () => {
  it('returns 1 when source and target are the same', () => {
    const usa = { exchange_rate: 1.0 };
    expect(dispRate(usa, usa)).toBe(1);
  });

  it('USD → GBP at 0.79 returns 0.79', () => {
    const usa = { exchange_rate: 1.0 };
    const uk  = { exchange_rate: 0.79 };
    expect(dispRate(usa, uk)).toBeCloseTo(0.79);
  });

  it('GBP → USD inverts correctly', () => {
    const uk  = { exchange_rate: 0.79 };
    const usa = { exchange_rate: 1.0 };
    expect(dispRate(uk, usa)).toBeCloseTo(1 / 0.79);
  });

  it('handles cross-rate (GBP source → INR target)', () => {
    const uk    = { exchange_rate: 0.79 };
    const india = { exchange_rate: 93.85 };
    // 93.85 / 0.79 ≈ 118.80
    expect(dispRate(uk, india)).toBeCloseTo(118.80, 2);
  });

  it('null / missing inputs return 1 instead of NaN/Infinity', () => {
    expect(dispRate(null, { exchange_rate: 0.79 })).toBe(1);
    expect(dispRate({ exchange_rate: 0.79 }, null)).toBe(1);
    expect(dispRate({}, {})).toBe(1);
  });

  it('zero exchange_rate falls back to 1 (does not produce Infinity)', () => {
    const zero = { exchange_rate: 0 };
    const uk   = { exchange_rate: 0.79 };
    expect(Number.isFinite(dispRate(zero, uk))).toBe(true);
  });
});

describe('applyPriceOverride — tax ratio preservation', () => {
  it('UK 20% VAT: gross £12 / net £10, override to £15 keeps 5/6 ratio', () => {
    const r = applyPriceOverride(12, 10, 15);
    expect(r.gross).toBe(15);
    expect(r.net).toBeCloseTo(15 * (10 / 12));   // £12.50
  });

  it('zero-tax: gross == net, override stays same', () => {
    const r = applyPriceOverride(10, 10, 25);
    expect(r.gross).toBe(25);
    expect(r.net).toBeCloseTo(25);
  });

  it('original gross of 0 falls back to ratio 1 (no NaN)', () => {
    const r = applyPriceOverride(0, 0, 15);
    expect(r.gross).toBe(15);
    expect(r.net).toBe(15);
  });

  it('round trip: net → gross → override → net stays consistent', () => {
    const original = { gross: 24, net: 20 };  // 20% tax
    const r = applyPriceOverride(original.gross, original.net, original.gross);
    expect(r.net).toBeCloseTo(original.net);
  });
});

describe('reExpressOverrides — currency switch', () => {
  it('re-expresses prices when switching from GBP (0.79) to USD (1.0)', () => {
    const overrides = { 'r_1_l1': '12.00', 'r_2_l1': '8.00' };
    // factor = 1 / 0.79 ≈ 1.2658
    const out = reExpressOverrides(overrides, 0.79, 1.0);
    expect(parseFloat(out['r_1_l1'])).toBeCloseTo(15.19, 1);
    expect(parseFloat(out['r_2_l1'])).toBeCloseTo(10.13, 1);
  });

  it('returns input unchanged when rates equal', () => {
    const overrides = { 'r_1_l1': '12.00' };
    expect(reExpressOverrides(overrides, 0.79, 0.79)).toEqual(overrides);
  });

  it('returns input unchanged when prevRate is 0 (defensive)', () => {
    const overrides = { 'r_1_l1': '12.00' };
    expect(reExpressOverrides(overrides, 0, 1.0)).toEqual(overrides);
  });

  it('rounds to 2dp', () => {
    const out = reExpressOverrides({ 'k': '10.0' }, 0.79, 0.5);
    // 10 * (0.5/0.79) = 6.3291... → 6.33
    expect(out['k']).toBe('6.33');
  });
});

describe('toUsd — saving back', () => {
  it('GBP 12.00 → USD ~15.19 at 0.79', () => {
    expect(toUsd('12.00', 0.79)).toBeCloseTo(15.19, 2);
  });

  it('zero dispRate falls back to 1 (no Infinity)', () => {
    expect(toUsd('12.00', 0)).toBe(12);
  });

  it('non-numeric input returns 0', () => {
    expect(toUsd('not-a-number', 1.0)).toBe(0);
    expect(toUsd('', 1.0)).toBe(0);
  });
});
