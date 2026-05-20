# Pepper AI Memory System — Design Review & Recommendations
**Review Date:** April 2026
**Status:** Original design documented in `docs/AI.md` section 2. Not yet implemented. This document captures a critical review with a simplified alternative approach.

---

## Original Design Summary

The design in `AI.md` section 2 proposes a 5-layer memory hierarchy:
- Layer 0: Per-conversation extraction (structured facts → `mcogs_memory_extracts`)
- Layer 1: Daily consolidation (nightly CRON → `mcogs_memory_daily` with embeddings)
- Layer 2: Monthly consolidation (monthly CRON → `mcogs_memory_monthly` with embeddings)
- Layer 3: Quarterly consolidation (quarterly CRON → `mcogs_memory_quarterly` with embeddings)
- Layer 4: Activity log digest (changes since last visit)

Total: 6 new DB tables, pgvector extension, OpenAI embedding dependency, 3 CRON jobs at different frequencies. Estimated effort: 7.5 days.

---

## What's Good About the Design

1. **The hierarchy concept is sound** — extract → daily → monthly → quarterly mirrors how human memory consolidation works (working memory → episodic → semantic)
2. **Token budget is realistic** — 1,200-1,500 tokens per request is modest and won't significantly impact costs or latency
3. **"Stored interaction days" not calendar days** — this is a smart detail. If a user returns after 6 weeks, the last 3 *active* days are loaded, not 3 empty calendar days
4. **Cost estimate is honest** — ~$32/year for 100 users is negligible relative to the base chat costs
5. **User profile schema is well-structured** — interaction_pattern values (`new_user`, `regular`, `occasional`, `returning_after_gap`) are a clean abstraction

---

## Problems with the Design

### 1. Activity Log Is Now Redundant

The design proposes `mcogs_activity_log` (section 2.6) to track write operations across the app for the "what changed since your last visit" digest. Since the design was written, COGS now has `mcogs_audit_log` — a central audit trail that records every create/update/delete with full field diffs, user identity, context, and related entities, wired into 8 route files.

**Recommendation:** Do not build `mcogs_activity_log`. Point the consolidation jobs at `mcogs_audit_log` instead. The "what changed since your last visit" digest becomes a simple query:
```sql
SELECT entity_type, action, COUNT(*) as count
FROM mcogs_audit_log
WHERE created_at > $last_interaction_date
GROUP BY entity_type, action
ORDER BY count DESC
```

### 2. The Extract Step Is Over-Engineered for Current Scale

The design has Claude read every completed conversation and extract structured facts into `mcogs_memory_extracts` (Layer 0), then a nightly job re-reads them to consolidate (Layer 1). That's two LLM calls per conversation per day.

At the current scale (1-5 users, maybe 5-15 conversations/day total), this adds complexity, a database table, and latency at conversation end for minimal benefit.

**Recommendation:** Skip `mcogs_memory_extracts` entirely. Have the nightly job read `mcogs_ai_chat_log` directly and summarise the day's conversations in one Haiku call per user. The extract table becomes useful at 50+ daily active users where pre-processing saves consolidation time.

### 3. pgvector Is Infrastructure Overhead You Don't Need Yet

Vector similarity search is only used for monthly records ("top 3 relevant"). At current scale, there will be maybe 12 monthly records per user per year. Loading all of them (~3,600 tokens for a full year) would be simpler and equally effective.

pgvector requires:
- Installing a PostgreSQL extension (may need superuser access on the Lightsail instance)
- Managing IVFFlat indexes with `lists` parameter tuning
- Depending on OpenAI or another embedding API
- Generating embeddings for every summary

**Recommendation:** Defer pgvector until monthly record count exceeds ~50 per user. Until then, recency-based retrieval (which the design already uses for daily and quarterly) is sufficient. When you do add vector search, consider Voyage AI embeddings (already have an API key field in Settings → AI) instead of OpenAI — keeps the vendor footprint within Anthropic's ecosystem.

### 4. The Embedding Model Creates an Unnecessary Vendor Dependency

The design uses OpenAI `text-embedding-3-small` for embeddings while everything else runs on Anthropic Claude. Adding OpenAI as a dependency means:
- A second API key to manage and rotate
- A second vendor's uptime to depend on
- A second billing relationship
- A second set of rate limits to handle

**Recommendation:** When embeddings are eventually needed:
- **Option A (preferred):** Use Voyage AI `voyage-3-lite` — $0.02/1M tokens, 512 dimensions, optimised for retrieval. Already has a key field in COGS Settings → AI. Anthropic-aligned vendor.
- **Option B:** Use a local embedding model (e.g., `all-MiniLM-L6-v2` via ONNX runtime) — zero API cost, no external dependency, runs on the Lightsail instance. Quality is slightly lower but sufficient for <1000 records.
- **Option C (simplest):** Don't use embeddings at all. Use keyword/TF-IDF matching on summary text via PostgreSQL full-text search (`tsvector`/`tsquery`). Already built into Postgres, no extension needed.

### 5. Three CRON Jobs at Different Frequencies = Operational Risk

Nightly, monthly, and quarterly jobs need to be reliable, observable, and recoverable:
- If the quarterly job fails, you don't notice for 3 months
- If the nightly job misses a night due to server restart, daily summaries have a gap
- Monthly and quarterly jobs process incomplete data if upstream jobs failed

**Recommendation:** Run a **single nightly job** that:
1. Does daily consolidation
2. Checks if a monthly consolidation is due (first run after month boundary)
3. Checks if a quarterly consolidation is due (first run after quarter boundary)
4. Stores last-run timestamps in `mcogs_settings` under a `memory_jobs` key
5. If it missed any runs (server was down), catches up on next execution

This reduces operational surface from 3 jobs to 1, with automatic catch-up.

### 6. No Graceful Degradation Specified

What happens when the memory system is partially broken? If the nightly job fails for a week, daily summaries are missing, the "last 3 interaction days" block is stale, and the monthly job processes incomplete data.

**Recommendation:** The `assembleMemoryContext()` function must catch ALL errors and return an empty string rather than breaking the chat. Pepper must work perfectly with zero memory (which it does today). Memory should only enhance, never be required. Add a `try/catch` wrapper:
```javascript
async function assembleMemoryContext(userId, currentMessage) {
  try {
    // ... all memory retrieval logic ...
    return buildMemoryBlock({ ... });
  } catch (err) {
    console.error('[memory] Failed to assemble context:', err.message);
    return ''; // Graceful degradation — chat works without memory
  }
}
```

### 7. User Profile Is Updated by AI Inference — Fragile Without User Control

The consolidation job infers `response_preference`, `recurring_focus`, `primary_markets` etc. from conversations. AI inference is probabilistic — it might incorrectly label a user's preference, miss a market, or over-index on a one-time topic.

**Recommendation:** Let users see and edit their profile. Add a "What Pepper knows about me" panel accessible from the Pepper header or Settings → AI. Users can correct inferred data or add explicit preferences. The open questions in AI.md mention this (#3) but it should be a core requirement, not an afterthought.

### 8. No Conversation-Level Memory (the Most Impactful, Cheapest Win)

The biggest gap in the original design: there's no way for a user to say "remember that I always want UK prices in GBP" and have Pepper retain it across sessions. The full pipeline (extract → consolidate → retrieve) would eventually surface this, but only after daily consolidation runs — and only if the inference correctly identifies it as a preference.

**Recommendation:** Before building any of the pipeline, ship a simple **pinned notes** feature:
- New table: `mcogs_user_notes (id, user_sub, note TEXT, created_at)`
- User types "remember X" or "/remember X" → saved as a pinned note
- Every Pepper session loads all pinned notes (~100 tokens) into the system prompt
- Users can view and delete their notes from the Pepper panel
- Delivers 80% of the perceived "Pepper remembers me" value with ~2 hours of work

---

## Recommended Implementation Order

| Phase | What | Effort | Value |
|---|---|---|---|
| **0 — Pinned Notes** | `/remember` command, `mcogs_user_notes` table, always loaded into system prompt, view/delete UI in Pepper panel | 2 hours | Very high — immediate "memory" feel |
| **1 — User Profile** | `mcogs_user_profiles` table, auto-created on first login, editable by user in Settings → AI, always loaded (~300 tokens) | 0.5 days | High — personalised greetings, tone |
| **2 — Daily Summary** | Single nightly job reads `mcogs_ai_chat_log` + `mcogs_audit_log`, summarises with Haiku, stores in `mcogs_memory_daily` | 1.5 days | High — cross-session continuity |
| **3 — Activity Digest** | "Since your last visit" block from `mcogs_audit_log` for returning users (days_since > 7) | 0.5 days | Medium — welcome-back experience |
| **4 — Monthly/Quarterly** | Add monthly and quarterly consolidation to the nightly job (triggered by date checks). Only worth building after 2+ months of daily summaries prove valuable. | 1.5 days | Medium — long-term pattern recognition |
| **5 — Vector Retrieval** | Only if monthly record count exceeds ~50 per user. Use Voyage AI or PostgreSQL full-text search instead of pgvector + OpenAI. | 1 day | Low at current scale |

**Total MVP (phases 0-3): ~2.5 days** vs 7.5 days in original design.
**Same user-perceived value.** The pipeline layers (4-5) are deferred until data volume justifies them.

---

## Key Principles

1. **Memory must never break chat.** Every memory function wraps in try/catch. Pepper works at 100% without memory.
2. **No OpenAI dependency.** Use Voyage AI (if embeddings needed) or PostgreSQL full-text search. Keep the vendor footprint within the Anthropic ecosystem.
3. **One CRON job, not three.** Single nightly job handles all consolidation tiers with automatic catch-up.
4. **Users control their profile.** AI inference populates defaults; users can view, edit, and delete.
5. **Ship `/remember` first.** The simplest feature delivers the most user-visible value.
6. **Reuse `mcogs_audit_log`.** Don't build a second activity log table.

---

## Tables (Revised — 4 instead of 6)

| Table | Purpose | From Original? |
|---|---|---|
| `mcogs_user_notes` | Pinned notes from `/remember` command | NEW |
| `mcogs_user_profiles` | Structured user profile JSON + long-term summary | Yes (unchanged) |
| `mcogs_memory_daily` | Daily consolidated summaries (text only, no embedding initially) | Yes (simplified — no vector column initially) |
| `mcogs_memory_monthly` | Monthly pattern reports (text only initially) | Yes (simplified) |

**Removed:**
- `mcogs_memory_extracts` — unnecessary intermediate layer at current scale
- `mcogs_memory_quarterly` — folded into monthly job (quarterly synthesis stored as a monthly record with `is_quarterly = true` flag)
- `mcogs_activity_log` — replaced by existing `mcogs_audit_log`
