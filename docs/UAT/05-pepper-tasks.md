# UAT 05 — Pepper AI Tasks

**Goal:** Validate Pepper's behaviour across read, write, confirmation, memory, and error paths.

**Prerequisites:**
- Anthropic API key configured in System → AI
- Token allowance >= 50,000 (so no rate limit during UAT)
- Test data from UAT 01 exists

**Estimated time:** 30 min

---

## Read tasks

### List ingredients

1. Open Pepper (any docked mode)
2. Type: "List my ingredients"
3. Expected: Pepper calls `list_ingredients`, replies with at least UAT-Chicken in the list, no errors

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Get menu COGS

4. Type: "What's the COGS for UAT-ChickenDish?"
5. Expected: Pepper calls `get_recipe` and reports cost ≈ £1.00

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Cross-market check

6. Type: "What does UAT-Chicken cost in India?"
7. Expected: Pepper resolves the India market, reads its preferred quote, returns ₹450/kg

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Web search

8. Type: "Search the web for the average cost of chicken in the UK"
9. Expected: Pepper calls `search_web`, returns a paraphrased summary with source links

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Write tasks (CONFIRMATION REQUIRED)

### Create ingredient

10. Type: "Create an ingredient called UAT-Pepper-Test, base unit g, category UAT-Proteins"
11. Expected: Pepper describes the action and asks "Shall I proceed?"
12. Reply "yes"
13. Verify the ingredient now exists in Inventory

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Update price

14. Type: "Update the price of UAT-Chicken from UAT-Supplier to £6.00"
15. Expected: Pepper confirms before calling `update_price_quote`
16. Reply "yes" → verify Price Quotes table

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Delete with cascade warning

17. Type: "Delete UAT-Menu"
18. Expected: Pepper warns that all menu items + prices will also be deleted (cascade), asks for confirmation
19. Reply "no" → verify menu is NOT deleted
20. Reply "yes" only after re-creating data needed by other UAT scripts (or skip this delete during full-run)

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Memory

### Save a note

21. Type: "Remember that I prefer prices in GBP"
22. Expected: Pepper calls `save_memory_note`, confirms the note is saved

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Recall the note

23. New conversation (clear chat)
24. Type: "What do you remember about my preferences?"
25. Expected: Pepper lists the GBP note from previous session

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Forget

26. Type: "Forget the GBP note"
27. Expected: Pepper deletes the note via `delete_memory_note`, confirms

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Audit log

28. Type: "Show me everything I changed today"
29. Expected: Pepper calls `query_audit_log`, returns a chronological list

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Error handling

### Token allowance

30. Set token allowance to 1,000 in System → AI
31. Send a long-context prompt (e.g. paste the menu items list)
32. Expected: graceful 429 response: "Token allowance exceeded for this period"
33. Reset allowance to original

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

### Invalid tool input

34. Type: "Update ingredient with id 99999999 to have name X"
35. Expected: Pepper handles the FK error gracefully, doesn't crash

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Language

### Switch language

36. Sidebar footer → switch to French
37. Page reloads
38. Open Pepper → type "Bonjour, list mes ingrédients"
39. Expected: Pepper replies in French; ingredient names render their French translations if present

✅ Pass / ❌ Fail / ⚠️ Issue: ___________________________

---

## Outcome

**Tester name:** ___________________________

**Time taken:** ____ min

**Overall result:** ✅ Pass / ❌ Fail / ⚠️ Issues

**Notes on conversation quality:** ___________________________
