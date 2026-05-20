# UAT 04 — Multi-Market Recipe Variations

**Goal:** Confirm the same recipe can be costed differently in different markets via market-specific quotes and PL variations.

**Prerequisites:**
- UAT 01 completed
- A second market exists (e.g. `UAT-India`, currency=`INR`, rate=`93.85`)
- A vendor in `UAT-India` exists (`UAT-IndiaSupplier`)

**Estimated time:** 25 min

---

## Steps

### Add Indian price quote

1. Inventory → Price Quotes → Add
2. Ingredient=`UAT-Chicken`, vendor=`UAT-IndiaSupplier`, price=`450`, qty in base units=`1`, unit=`kg`
3. Save → mark preferred for `UAT-India`

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Verify recipe COGS in both markets

4. Recipes → open `UAT-ChickenDish`
5. Switch market selector to `UAT-UK`
6. Expected: cost ≈ `£1.00`
7. Switch market selector to `UAT-India`
8. Expected: cost ≈ `₹90` (450 × 0.2)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create market variation

9. Recipes → `UAT-ChickenDish` → Market Variations panel
10. Add variation for `UAT-India`
11. Replace `UAT-Chicken` with a substitute ingredient (or change qty to `0.15`)
12. Save
13. Verify: switching market to UAT-India now uses the variation cost

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create PL variation

14. Recipes → `UAT-ChickenDish` → PL Variations panel
15. Add variation for price level=`Delivery` in `UAT-UK`
16. Reduce ingredient qty by 10%
17. Save
18. Open the menu in Menu Engineer, switch level to Delivery — verify cost reflects PL variation

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Verify priority chain

19. Per CLAUDE.md: PL variation > Market variation > Global recipe
20. Test the priority by making all three exist and verifying which one is used in each combination

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Currency display

21. Switch global market switcher (top-bar) between UK and India
22. Expected: every currency value across the app updates immediately
23. Dashboard widgets respect the market scope

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester name:** ___________________________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues
