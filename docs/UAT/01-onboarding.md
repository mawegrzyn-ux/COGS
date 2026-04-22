# UAT 01 — Onboarding & First Menu

**Goal:** Confirm a brand-new user can log in, navigate, and complete the minimum chain to see a working COGS calculation.

**Prerequisites:**
- Staging environment fresh-deployed
- `uat-admin@example.com` exists in Auth0
- Chrome / Edge latest version

**Estimated time:** 25 min

---

## Steps

### Login

1. Navigate to `https://cogs-staging.macaroonie.com`
2. Click "Sign In"
3. Enter `uat-admin@example.com` + password
4. Expected: redirected to Dashboard, sidebar visible, user name in top right

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Configuration walkthrough

5. Open Configuration page
6. Verify all 11 sections render: Global Config, Location Structure, Categories, Base Units, Price Levels, Currency, COGS Thresholds, Users & Roles, Import, Media Library, Stock Config
7. Click "Currency" tab — verify exchange rates table displays
8. Click "Sync exchange rates" — wait for completion toast

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a market

9. Configuration → Currency → Add country
10. Enter: name=`UAT-UK`, currency code=`GBP`, symbol=`£`, exchange rate=`0.79`
11. Save
12. Expected: country appears in list

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a category

13. Configuration → Categories → Add
14. Name=`UAT-Proteins`, scope: ☑ ingredients ☑ recipes
15. Save
16. Expected: category visible in list

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a vendor

17. Inventory → Vendors tab → Add
18. Name=`UAT-Supplier`, country=`UAT-UK`
19. Save

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create an ingredient

20. Inventory → Ingredients tab → Add
21. Name=`UAT-Chicken`, category=`UAT-Proteins`, base unit=`kg`
22. Save

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Add a price quote

23. Inventory → Price Quotes tab → Add
24. Ingredient=`UAT-Chicken`, vendor=`UAT-Supplier`, price=`5.00`, qty in base units=`1`, unit=`kg`, active=☑
25. Save
26. Open Preferred Vendors → mark as preferred for `UAT-UK`

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a recipe

27. Recipes → Add
28. Name=`UAT-ChickenDish`, category=`UAT-Proteins`, yield qty=`1`, yield unit=`each`
29. Add ingredient: `UAT-Chicken`, prep qty=`0.2`, prep unit=`kg`
30. Save
31. Expected: recipe shows COGS card with cost per portion ≈ `£1.00`

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Create a sales item

32. Sales Items → Add
33. Type=`recipe`, name=`UAT-ChickenItem`, linked recipe=`UAT-ChickenDish`
34. Save

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Build a menu

35. Menus → Add menu
36. Name=`UAT-Menu`, country=`UAT-UK`
37. Save
38. Add `UAT-ChickenItem` to the menu
39. Set sell price for Dine In = `£5.00`
40. Expected: COGS column renders ≈ `20%` (1.00 / 5.00)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester name:** ___________________________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues

**Issues to log:**
- [ ] Issue 1: ___________________________ (severity: P_)
- [ ] Issue 2: ___________________________ (severity: P_)
