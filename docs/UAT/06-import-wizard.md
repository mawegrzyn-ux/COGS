# UAT 06 — Import Wizard End-to-End

**Goal:** Validate the AI-powered import wizard handles real spreadsheet inputs.

**Prerequisites:**
- A test CSV with ingredients, vendors, recipes, menus
- Anthropic API key configured

**Estimated time:** 20 min

---

## Steps

### Download templates

1. Configuration → Import → Download templates
2. Verify all 6 templates download as XLSX: Ingredients, Vendors, Price Quotes, Recipes, Menus, Menu Items

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Prepare test data

3. Open the Ingredients template → add 3 rows: `UAT-Pasta`, `UAT-Tomato`, `UAT-Cheese` with categories + base units
4. Open Vendors template → add 1 row: `UAT-ImportSupplier`, country=`UAT-UK`
5. Open Price Quotes template → add 3 rows linking each ingredient to the vendor
6. Open Recipes template → add 1 recipe: `UAT-PizzaMargherita` using all 3 ingredients
7. Open Menus + Menu Items templates → add a menu with the pizza
8. Save all files

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Upload + extract

9. Configuration → Import → Upload CSV/XLSX
10. Drag in the Ingredients file
11. Wait for AI extraction to complete (≤ 30s)
12. Expected: Review tab shows the 3 ingredient rows with all fields parsed

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Categories mapping

13. Move to step 3 (Categories)
14. Expected: any imported categories are listed; test the inline "+ Create new category" option

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Vendors mapping

15. Step 4 (Vendors)
16. Map `UAT-ImportSupplier` → existing or create new

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Execute

17. Step 5 → click Execute
18. Expected: success toast, all ingredients/vendors/quotes/recipes/menus visible in their pages

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Verify imports

19. Inventory → Ingredients → confirm 3 new ingredients
20. Recipes → confirm `UAT-PizzaMargherita` exists with the 3 items
21. Menus → confirm the imported menu exists

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Pepper-triggered import

22. Open Pepper → upload the same Ingredients CSV
23. Type: "Import this file"
24. Expected: Pepper calls `start_import` and replies with a clickable link
25. Click link → ImportPage opens at step 2 (Review) with the staged job

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Override action

26. Re-upload the Ingredients template (same data)
27. In Review, look for the duplicate-detection UI offering Create / Skip / Override per row
28. Choose Override for one row → execute
29. Verify that row was UPDATED (not duplicated)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester name:** ___________________________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues
