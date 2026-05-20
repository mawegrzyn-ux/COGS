# UAT 02 — Menu Engineer Workflow

**Goal:** Validate the full Menu Engineer scenario lifecycle: build → analyse → adjust → save → push → share.

**Prerequisites:**
- UAT 01 completed (UAT-Menu exists with at least one item)
- At least 5 items on the menu spanning 2+ categories
- A second price level exists (e.g. `Delivery`)

**Estimated time:** 30 min

---

## Steps

### Open Menu Engineer

1. Menus → select `UAT-Menu`
2. Click "Menu Engineer" tab
3. Expected: empty grid, no errors, "Generate Mix" + "Reset Qty" buttons visible

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Generate sales mix

4. Click "Generate Mix"
5. Sales Mix Generator modal opens; categories listed
6. Set total covers = `100`, distribute across categories so total is 100%
7. Click "Apply"
8. Expected: every menu row gets a Qty Sold value, total revenue and COGS% appear

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Switch to All Levels view

9. Price level selector → All Levels
10. Expected: each level shows its own Qty Sold, Price, Revenue (net), COGS% columns
11. Verify: per-level qty cells are independent (entering qty in Dine In does not change Delivery)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Inline price override

12. Click any price cell, change value
13. Expected: cell turns amber with ↺ reset button
14. Verify: COGS% recalculates immediately
15. Click ↺ — price reverts to base, amber styling removed

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Inline cost override

16. Click any Cost/ptn cell, change value
17. Expected: amber styling, COGS% updates

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### What If modal

18. Click "⚡ What If"
19. Set price change = `+10%`, leave cost change = `0`
20. Click Apply
21. Expected: every price cell shows amber override, all values increased by 10%
22. History modal — verify a `whatif` entry was added

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Reset

23. Click "↺ Prices" button
24. Expected: all overrides cleared, prices return to base
25. History — entry `reset_prices` added

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Save scenario

26. Apply some overrides again
27. Click scenario button (top of toolbar)
28. Modal opens with scenario list + save form
29. Enter name = `UAT-Test-Scenario`, click Save
30. Expected: scenario saved, button shows the name with green background

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Reload scenario

31. Refresh page
32. Open scenario modal → click `UAT-Test-Scenario` → Load
33. Expected: all overrides + qty restored

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Push prices to live menu

34. Click "→ Menu" button (Push Prices)
35. Confirmation dialog — accept
36. Switch to Menu Builder tab → verify the new prices are now the menu's base prices

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a shared link

37. Click "Shared Links" tab
38. Add new link → set mode=`view`, password=`uat-test`, no expiry
39. Copy the link, open in incognito window
40. Enter password → verify menu renders correctly without auth

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester name:** ___________________________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues

**Issues to log:**
- [ ] Issue 1: ___________________________ (severity: P_)
