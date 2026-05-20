# UAT 03 — Stock Cycle (PO → GRN → Invoice → Stocktake)

**Goal:** Validate the full Stock Manager lifecycle and confirm stock balances stay consistent across operations.

**Prerequisites:**
- UAT 01 completed (UAT-Chicken ingredient + UAT-Supplier vendor exist)
- A location exists in `UAT-UK` (e.g. `UAT-Store-1`) with at least one store/centre

**Estimated time:** 40 min

---

## Steps

### Verify zero starting stock

1. Stock Manager → Overview tab
2. Filter by ingredient `UAT-Chicken`
3. Expected: shows 0 qty on hand or "no stock" state

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a Purchase Order

4. Stock Manager → Purchase Orders tab → New PO
5. Vendor=`UAT-Supplier`, store=`UAT-Store-1`, expected delivery date=tomorrow
6. Add item: `UAT-Chicken`, qty=`50`, unit=`kg`
7. Expected: unit price auto-populates from preferred quote (`£5.00`)
8. Save → status=`draft`
9. Click "Submit" → status=`submitted`, PO number assigned (e.g. PO-1001)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create Goods Received Note

10. Stock Manager → Goods In tab → New GRN
11. Link to PO `PO-1001`
12. Expected: line items pre-populated with remaining qty=50
13. Set qty received = `48` (partial delivery)
14. Save → status=`draft`
15. Click "Confirm" → status=`confirmed`
16. Expected toast: "Stock updated"

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Verify stock level

17. Back to Overview tab
18. Filter `UAT-Chicken` at `UAT-Store-1`
19. Expected: 48 kg on hand
20. Click into ingredient → see movements list with the `goods_in` entry

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Verify PO status

21. Purchase Orders → find `PO-1001`
22. Expected: status=`partial` (not fully received)
23. qty_received column shows 48/50

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create Invoice from GRN

24. Stock Manager → Invoices tab → New from GRN
25. Select the GRN → line items pre-populate with qty + unit price
26. Add a tax line (5% VAT or per UAT-UK config)
27. Save → status=`draft` → Submit → status=`pending`
28. Approve → status=`approved`
29. Mark paid → status=`paid`

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Log waste

30. Stock Manager → Waste tab
31. Add row: ingredient=`UAT-Chicken`, qty=`3`, reason code=`Expired`
32. Save
33. Verify Overview tab now shows 45 kg on hand (48 - 3)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Stocktake

34. Stock Manager → Stocktake tab → New stocktake
35. Type=`full`, location=`UAT-Store-1`
36. Click "Populate All" → all current stock items appear
37. Manually adjust counted qty for `UAT-Chicken` to `40` (variance: -5)
38. Complete → variance shown
39. Approve
40. Verify Overview now shows 40 kg (the counted value), with a `stocktake_adjust` movement

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Audit log verification

41. System → Audit Log
42. Filter by entity_type=`stock_movement`, date=today
43. Expected: at least 4 rows (goods_in, waste, stocktake_adjust, manual? if any)
44. Each row has user_name, action, qty before/after

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester name:** ___________________________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues

**Issues:**
- [ ] ___________________________
