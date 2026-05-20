# UAT 07 — RBAC & Market Scope

**Goal:** Verify role-based access control and market scope filtering work correctly across all user types.

**Prerequisites:**
- Three test users: `uat-admin@`, `uat-operator@`, `uat-viewer@`
- `uat-viewer@` is restricted to UK market only via brand partner assignment
- All three users exist in Auth0

**Estimated time:** 30 min (10 min per user × 3 users)

---

## Admin user (uat-admin@example.com)

### Sidebar visibility

1. Login as Admin
2. Verify all sidebar items visible: Dashboard, Inventory, Recipes, Sales Items, Menus, Allergens, HACCP, Stock Manager, Configuration, System, Help

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### System sections (admin-gated)

3. Open System → Database — verify amber `ADMIN` badge, page renders
4. Open System → Audit Log — verify renders, can filter

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Dev sections (is_dev gated)

5. Set `is_dev=true` on uat-admin in Configuration → Users & Roles
6. Open System → Test Data — verify purple `DEV` badge visible
7. Open System → CLAUDE.md — verify document loads

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Pepper unrestricted access

8. Open Pepper → "List ingredients in all markets"
9. Expected: returns ingredients from every country (allowedCountries=null)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Operator user (uat-operator@example.com)

### Sidebar

10. Logout, login as Operator
11. Verify sidebar shows operational items but Configuration → Users & Roles section may be limited

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Settings restriction

12. Configuration → Users & Roles
13. Expected: section is read-only or hidden depending on role permissions
14. Try to edit a permission cell — should fail or be disabled

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### System sections hidden

15. Try to navigate to System → Database directly
16. Expected: gated fallback shown, OR redirected to AI tab

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Test Data hidden

17. System → expect Test Data NOT in sidebar
18. Direct URL `/system?tab=test-data` → gated fallback

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Viewer user (uat-viewer@example.com, UK-scoped)

### Sidebar — read-only items only

19. Logout, login as Viewer
20. Verify nav items present (Dashboard, Inventory, Recipes, Menus, Allergens) but reduced

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Cannot modify

21. Navigate to Inventory
22. Expected: + Add buttons hidden or disabled
23. Click any row → edit modal renders read-only fields (no Save button)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Market scope — UK only

24. Top-bar market switcher dropdown
25. Expected: only UAT-UK option present (no India, no other countries)
26. Dashboard widgets showing per-market data show UK only

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Pepper market-restricted

27. Open Pepper → "List markets"
28. Expected: only UAT-UK returned (or markets in allowedCountries)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Direct URL access denied

29. Manually navigate to `/system`
30. Expected: redirected back to Dashboard or shown 403

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Bug + Backlog access

31. Bugs & Backlog (now embedded in System) — verify Viewer can read but not write
32. Try to create a new bug — button should be hidden or 403

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Pending user (new signup)

### Self-register

33. Logout
34. Sign up with a brand new email via Auth0
35. Auto-redirected to PendingPage
36. Cannot navigate anywhere else

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Admin approves

37. Login as Admin → Configuration → Users & Roles → find the new pending user
38. Set role + approve
39. Logout, login as the new user — now has access

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester names:** Admin: ____________ | Operator: ____________ | Viewer: ____________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues
