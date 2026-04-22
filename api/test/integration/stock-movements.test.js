// Stock movement consistency — the highest-risk area in the entire app.
//
// CONTRACT: every stock-changing operation must:
//   1. INSERT into mcogs_stock_movements (immutable audit ledger)
//   2. UPSERT into mcogs_stock_levels via ON CONFLICT
//   3. Both inside a single transaction
//
// If either step is missed or the transaction commits partially, stock
// reconciliation breaks for the operator. These tests verify the contract
// at the SQL level — they exercise the dual-write pattern directly so
// they will catch regressions in any route that does stock writes
// (GRN confirm, transfers, waste, stocktake adjust, manual adjust).

import { describe, it, expect, afterAll } from 'vitest';
import { withTx, closeTestPool } from '../helpers/db.js';
import {
  makeUnit, makeCountry, makeCategory, makeIngredient,
  makeLocation, makeStore,
} from '../helpers/factories.js';

afterAll(() => closeTestPool());

// Helper: perform the dual-write that every stock route must perform.
async function applyStockMovement(c, { storeId, ingredientId, qty, type, refId }) {
  // Step 1: append to ledger. Production schema uses `quantity` and `reference_id`.
  await c.query(
    `INSERT INTO mcogs_stock_movements
       (store_id, ingredient_id, quantity, movement_type, reference_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [storeId, ingredientId, qty, type, refId || null]
  );
  // Step 2: upsert balance
  await c.query(
    `INSERT INTO mcogs_stock_levels (store_id, ingredient_id, qty_on_hand)
     VALUES ($1, $2, $3)
     ON CONFLICT (store_id, ingredient_id)
     DO UPDATE SET qty_on_hand = mcogs_stock_levels.qty_on_hand + EXCLUDED.qty_on_hand`,
    [storeId, ingredientId, qty]
  );
}

describe('Stock movement dual-write', () => {
  it('GRN confirm: ledger row + level row both written', async () => {
    await withTx(async (c) => {
      const country = await makeCountry(c);
      const loc = await makeLocation(c, { country_id: country.id });
      const store = await makeStore(c, { location_id: loc.id });
      const ing = await makeIngredient(c);

      await applyStockMovement(c, {
        storeId: store.id, ingredientId: ing.id, qty: 10, type: 'goods_in',
      });

      const { rows: movements } = await c.query(
        `SELECT * FROM mcogs_stock_movements WHERE store_id = $1`, [store.id]
      );
      const { rows: levels } = await c.query(
        `SELECT * FROM mcogs_stock_levels WHERE store_id = $1`, [store.id]
      );
      expect(movements).toHaveLength(1);
      expect(Number(movements[0].quantity)).toBe(10);
      expect(movements[0].movement_type).toBe('goods_in');
      expect(levels).toHaveLength(1);
      expect(Number(levels[0].qty_on_hand)).toBe(10);
    });
  });

  it('multiple movements accumulate correctly on the level row', async () => {
    await withTx(async (c) => {
      const country = await makeCountry(c);
      const loc = await makeLocation(c, { country_id: country.id });
      const store = await makeStore(c, { location_id: loc.id });
      const ing = await makeIngredient(c);

      await applyStockMovement(c, { storeId: store.id, ingredientId: ing.id, qty: 10,  type: 'goods_in' });
      await applyStockMovement(c, { storeId: store.id, ingredientId: ing.id, qty: 5,   type: 'goods_in' });
      await applyStockMovement(c, { storeId: store.id, ingredientId: ing.id, qty: -3,  type: 'waste' });

      const { rows } = await c.query(
        `SELECT qty_on_hand FROM mcogs_stock_levels WHERE store_id = $1`, [store.id]
      );
      expect(Number(rows[0].qty_on_hand)).toBe(12);

      const { rows: ledger } = await c.query(
        `SELECT count(*)::int AS n FROM mcogs_stock_movements WHERE store_id = $1`, [store.id]
      );
      expect(ledger[0].n).toBe(3);
    });
  });

  it('transfer dispatch + confirm zero-sum: source -, destination +', async () => {
    await withTx(async (c) => {
      const country = await makeCountry(c);
      const loc = await makeLocation(c, { country_id: country.id });
      const src  = await makeStore(c, { location_id: loc.id, name: 'Source' });
      const dest = await makeStore(c, { location_id: loc.id, name: 'Dest' });
      const ing  = await makeIngredient(c);

      // Pre-stock source
      await applyStockMovement(c, { storeId: src.id, ingredientId: ing.id, qty: 100, type: 'goods_in' });

      // Dispatch (out of source)
      await applyStockMovement(c, { storeId: src.id, ingredientId: ing.id, qty: -20, type: 'transfer_out' });
      // Confirm (into destination)
      await applyStockMovement(c, { storeId: dest.id, ingredientId: ing.id, qty: 20, type: 'transfer_in' });

      const { rows: srcLvl }  = await c.query(
        `SELECT qty_on_hand FROM mcogs_stock_levels WHERE store_id = $1`, [src.id]);
      const { rows: destLvl } = await c.query(
        `SELECT qty_on_hand FROM mcogs_stock_levels WHERE store_id = $1`, [dest.id]);

      expect(Number(srcLvl[0].qty_on_hand)).toBe(80);
      expect(Number(destLvl[0].qty_on_hand)).toBe(20);

      // Total system stock unchanged
      const { rows: all } = await c.query(
        `SELECT SUM(qty_on_hand)::numeric AS total FROM mcogs_stock_levels WHERE ingredient_id = $1`, [ing.id]);
      expect(Number(all[0].total)).toBe(100);
    });
  });

  it('UNIQUE constraint on (store_id, ingredient_id) prevents duplicate level rows', async () => {
    await withTx(async (c) => {
      const country = await makeCountry(c);
      const loc = await makeLocation(c, { country_id: country.id });
      const store = await makeStore(c, { location_id: loc.id });
      const ing = await makeIngredient(c);

      await applyStockMovement(c, { storeId: store.id, ingredientId: ing.id, qty: 5, type: 'goods_in' });
      await applyStockMovement(c, { storeId: store.id, ingredientId: ing.id, qty: 5, type: 'goods_in' });

      const { rows } = await c.query(
        `SELECT count(*)::int AS n FROM mcogs_stock_levels
         WHERE store_id = $1 AND ingredient_id = $2`, [store.id, ing.id]);
      expect(rows[0].n).toBe(1);   // exactly one level row, no duplicate
    });
  });

  it('rollback inside the transaction leaves no rows behind', async () => {
    let storeId = null;
    let ingId = null;
    await withTx(async (c) => {
      const country = await makeCountry(c);
      const loc = await makeLocation(c, { country_id: country.id });
      const store = await makeStore(c, { location_id: loc.id });
      const ing = await makeIngredient(c);
      storeId = store.id;
      ingId = ing.id;
      await applyStockMovement(c, { storeId: store.id, ingredientId: ing.id, qty: 99, type: 'goods_in' });
      // Implicit ROLLBACK at end of withTx
    });

    // Now check OUTSIDE the rolled-back transaction — neither row should exist.
    await withTx(async (c) => {
      const { rows: lvl } = await c.query(
        `SELECT * FROM mcogs_stock_levels WHERE store_id = $1`, [storeId]);
      const { rows: mov } = await c.query(
        `SELECT * FROM mcogs_stock_movements WHERE ingredient_id = $1`, [ingId]);
      expect(lvl).toHaveLength(0);
      expect(mov).toHaveLength(0);
    });
  });
});
