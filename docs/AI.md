# AI in COGS Manager

Single source of truth for all AI features in COGS Manager — current implementation, architecture, configuration, and future design.

---

## Table of Contents

1. [Pepper — Current Implementation](#1-pepper--current-implementation)
   - 1.1 Architecture Overview
   - 1.2 Model and API Key
   - 1.3 Panel Modes
   - 1.4 Input Methods
   - 1.5 SSE Streaming and Agentic Loop
   - 1.6 RAG System
   - 1.7 Conversation Logging
   - 1.8 AI Configuration
   - 1.9 Concise Mode
   - 1.10 Web Search
   - 1.11 Import Integration
   - 1.12 Internal Feedback API
   - 1.13 Confirmation Safety Rules
   - 1.14 Animated Waiting Indicator
   - 1.15 Tool Inventory (74 tools)
2. [Memory System — Designed, Not Yet Built](#2-memory-system--designed-not-yet-built)
   - 2.1 Problem Statement
   - 2.2 Design Goal
   - 2.3 Architecture Diagram
   - 2.4 Key Design Decisions
   - 2.5 User Profile Schema
   - 2.6 Activity Log
   - 2.7 Memory Hierarchy (5 layers)
   - 2.8 Retrieval at Query Time
   - 2.9 Consolidation Jobs
   - 2.10 Database Schema
   - 2.11 New API Routes
   - 2.12 Cost Estimate
   - 2.13 Implementation Phases
   - 2.14 Open Questions
3. [Voice Interface — Scoped, Parked](#3-voice-interface--scoped-parked)
   - 3.1 Overview
   - 3.2 Capability 1: Voice Input
   - 3.3 Capability 2: Voice Output
   - 3.4 Implementation Tiers
   - 3.5 Streaming TTS Technical Challenge
   - 3.6 UI Changes Required
   - 3.7 Backend Changes (Tier 2 only)
   - 3.8 Risks
   - 3.9 Recommendation
4. [Reference](#4-reference)

---

## 1. Pepper — Current Implementation

### 1.1 Architecture Overview

Pepper is the in-app AI assistant powered by Claude (Anthropic API). It appears as a floating panel (bottom-right) or docked to the left or right side of the screen. It uses Server-Sent Events (SSE) for streaming responses and supports a full agentic loop where Claude can call tools to read and write data in the COGS database.

| Layer | Detail |
|---|---|
| **Frontend** | `app/src/components/AiChat.tsx` — chat panel, SSE streaming, file attachments, screenshot, dock modes |
| **Chat endpoint** | `POST /api/ai-chat` — JSON `{ messages, conversationId? }` → SSE stream |
| **Upload endpoint** | `POST /api/ai-upload` — multipart `{ file, message, conversationId? }` → SSE stream (vision/CSV/screenshot) |
| **Shared agentic loop** | `api/src/helpers/agenticStream.js` — SSE helper, keepalive ping, `while(true)` tool loop, token counting |
| **AI config helper** | `api/src/helpers/aiConfig.js` — reads `mcogs_settings.ai_config` JSONB from DB |
| **Config endpoint** | `GET/PUT /api/ai-config` — persists API keys and feature flags |
| **Logging** | All sessions → `mcogs_ai_chat_log` (messages, tools_called JSONB, token counts, context JSONB) |

### 1.2 Model and API Key

| Setting | Value |
|---|---|
| **Model** | `claude-haiku-4-5` (Claude Haiku 4.5 via Anthropic SDK) |
| **API key** | Stored in `mcogs_settings.ai_config` under key `ANTHROPIC_API_KEY`. Read from DB on every chat request. Set via Settings → AI. |

The `aiConfig.js` helper provides a cached read of the AI config JSONB. It is imported by `ai-chat.js`, `ai-upload.js`, and `internal-feedback.js`.

### 1.3 Panel Modes

`PepperMode = 'float' | 'docked-left' | 'docked-right'` — type exported from `AiChat.tsx`.

| Mode | Behaviour |
|---|---|
| `float` | Fixed-position FAB button (bottom-right) + popup panel that expands on click |
| `docked-left` | Full-height flex column rendered between sidebar and `<main>` content area |
| `docked-right` | Full-height flex column rendered to the right of `<main>` |

**Persistence:** Mode stored in `localStorage('pepper-mode')`. `AppLayout.tsx` reads this on mount, exposes `pepperMode` state, and renders the docked slots conditionally.

**Mode switching:** Switching mode remounts the `AiChat` component. The current conversation is cleared on every mode change.

**CSS class `pepper-ui`:** Applied to all Pepper UI elements. Used to exclude them from html2canvas screenshots — so Pepper's own panel never appears in screenshots sent to Pepper.

### 1.4 Input Methods

| Method | Detail |
|---|---|
| **Text** | Standard textarea. Enter to send (Shift+Enter for newline). |
| **File upload** | Paperclip icon. CSV/text files injected as text block. PNG/JPEG/WEBP injected as base64 vision block. Max 5MB. PDF not supported. |
| **Paste images** | Ctrl+V / Cmd+V in textarea detects image MIME types from clipboard. Creates a `File` object and attaches it as the current file attachment. Preview thumbnail shown in the attachment badge. |
| **Screenshot button** | Camera icon in the input bar. Captures the `<main>` element via html2canvas at 65% scale → converts to JPEG → attaches as file. User types a message and sends manually. Elements with CSS class `pepper-ui` are excluded from the capture. |
| **Right-click "Ask Pepper"** | Any element with a `data-ai-context` JSON attribute shows a custom "Ask Pepper" context menu item on right-click. Builds a contextual prompt from the element's data and captures a screenshot via html2canvas. Sends both via `POST /api/ai-upload`. Supported context types: `cogs_pct`, `coverage`, `cost_per_portion`, `menu_cogs`, `tutorial`. |
| **PepperHelpButton** | Component in `ui.tsx`. Renders a gear icon next to `PageHeader` titles and tab labels. Clicking fires a pre-written tutorial prompt for that section. Also sets `data-ai-context` so right-click support works on the same element. |

### 1.5 SSE Streaming and Agentic Loop

The shared loop is implemented in `api/src/helpers/agenticStream.js` and called by both `ai-chat.js` and `ai-upload.js`.

**Loop flow:**

```
1. Build messages array (system prompt + conversation history + any injected context blocks)
2. POST to Claude API with tool definitions
3. Stream response chunks → emit SSE:  data: {"type":"text","text":"..."}
4. If Claude emits tool_use blocks:
     a. Extract tool name + input JSON
     b. Execute tool against PostgreSQL (defined in ai-chat.js)
     c. Push tool result message into messages array
     d. Loop → back to step 2
5. When Claude emits end_turn with no tool calls:
     → emit SSE:  data: {"type":"done"}
     → close stream
```

**Keepalive:** SSE `data: {"type":"ping"}` event emitted every 15 seconds. Prevents proxy timeout on long-running tool chains.

**Token counting:** Input and output token counts logged to `mcogs_ai_chat_log` on every completed session.

### 1.6 RAG System

File: `api/src/helpers/rag.js`

The RAG system provides context-relevant documentation to Claude's system prompt, reducing hallucination on app-specific questions.

**Source files indexed at API startup:**

| File | Content |
|---|---|
| `claude.md` | Technical/developer documentation |
| `docs/user-guide.md` | User-facing documentation |

**Process:**

1. Read source files at startup
2. Split each file into chunks on `##` heading boundaries
3. If `VOYAGE_API_KEY` is configured: embed each chunk using Voyage AI `voyage-3-lite` model, store chunks + vectors in memory (`_chunks` array)
4. If no `VOYAGE_API_KEY`: fall back to keyword frequency scoring (word overlap between query and chunk text) — less accurate but functional with no external dependency
5. On each user query: embed query → cosine similarity against all stored chunk vectors → return top 4 sections
6. Inject those 4 sections into Claude's system prompt as a `<documentation>` context block

**Configuration:** `VOYAGE_API_KEY` is set via `PUT /api/ai-config` and stored in `mcogs_settings.ai_config` JSONB.

**Fallback behaviour:** If `VOYAGE_API_KEY` is absent, the system continues to function using keyword scoring. No error is thrown.

### 1.7 Conversation Logging

All Pepper sessions are logged to `mcogs_ai_chat_log`:

| Column | Type | Content |
|---|---|---|
| `id` | UUID | Primary key |
| `conversation_id` | VARCHAR | Optional client-supplied ID for threading |
| `messages` | JSONB | Full messages array (user + assistant + tool) |
| `tools_called` | JSONB | Array of tool names invoked in the session |
| `input_tokens` | INTEGER | Token count for input |
| `output_tokens` | INTEGER | Token count for output |
| `context` | JSONB | Arbitrary context metadata |
| `created_at` | TIMESTAMPTZ | Session timestamp |

### 1.8 AI Configuration

`GET/PUT /api/ai-config` — stores all AI configuration in `mcogs_settings.ai_config` JSONB column.

| Key | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API key — Pepper does not function without this | Yes |
| `VOYAGE_API_KEY` | Enables semantic RAG search via Voyage AI `voyage-3-lite` | Optional |
| `BRAVE_SEARCH_API_KEY` | Enables high-quality web search via Brave Search API | Optional |
| `ai_concise_mode` | Boolean — controls concise response behaviour | Optional |
| `CLAUDE_CODE_API_KEY` | Internal key for Claude Code developer access to the feedback API. Format: `ccak_` followed by 48 hex characters. Generated via `POST /api/ai-config/generate-claude-code-key`. | Optional |

All keys are read from DB on every `POST /api/ai-chat` and `POST /api/ai-upload` request — no restart required after changes.

### 1.9 Concise Mode

Toggle in **Settings → AI → Response Behaviour**.

When enabled, a system prompt section is injected that instructs Claude to:

- Skip narration ("Let me check…", "I'll now look at…")
- Call tools silently without announcing them
- Return bullet-point results instead of prose
- Be direct and terse — no filler phrases

Stored as `ai_concise_mode` boolean in `mcogs_settings.ai_config` JSONB. Read from DB on every chat request.

### 1.10 Web Search

`search_web` tool — **only invoked when the user explicitly asks to search the internet.** The system prompt restricts autonomous use.

| Config | Behaviour |
|---|---|
| `BRAVE_SEARCH_API_KEY` set | Calls Brave Search API — full web results |
| No key configured | Falls back to DuckDuckGo Instant Answer API (free, no key required, limited coverage) |

### 1.11 Import Integration

`start_import` tool enables Pepper to trigger the full Import Wizard flow from within chat.

**Flow:**

```
1. User pastes or uploads spreadsheet content in the Pepper chat
2. Pepper calls start_import tool with the text content already in the conversation
3. Server-side: calls stageFileContent() — the same function used by POST /api/import
       → AI extraction via Claude
       → Writes staged job to mcogs_import_jobs
4. Tool returns: { job_id, url: '/import?job=<id>', summary }
5. Pepper replies with a clickable link
6. User clicks → ImportPage mounts → reads ?job param from URL
       → skips the Upload step → lands directly on the Review tab
```

`stageFileContent()` is defined in `api/src/routes/import.js` and exported alongside the router. When requiring it in `ai-chat.js`:

```js
const { stageFileContent } = require('./import');
```

### 1.12 Internal Feedback API

Protected endpoints for developer/AI tooling access to user feedback data.

```
GET   /api/internal/feedback
PATCH /api/internal/feedback/:id
```

**Authentication:** `X-Internal-Key` request header. Key is validated against `CLAUDE_CODE_API_KEY` in `mcogs_ai_config`, with fallback to `process.env.INTERNAL_API_KEY`.

**`GET /api/internal/feedback` query parameters:**

| Param | Values |
|---|---|
| `type` | `bug`, `feature`, `general` |
| `status` | `open`, `in_progress`, `resolved` |
| `limit` | integer |
| `offset` | integer |

**`PATCH /api/internal/feedback/:id`** — update status field only.

### 1.13 Confirmation Safety Rules

All write operations require Pepper to verbally describe the intended action and ask "Shall I proceed?" before calling any write tool. Batch operations affecting more than 3 records get one combined plan description followed by one confirmation request.

**Special-case warnings:**

| Tool | Warning given before proceeding |
|---|---|
| `delete_menu` | Warns that all menu items and menu item prices will also be deleted (cascade) |
| `delete_market` | Warns that associated vendors, menus, and tax rates will also be removed |
| `delete_location` | Warns if HACCP equipment is assigned and must be unlinked first |
| `set_ingredient_allergens` | Warns that this call REPLACES the entire allergen profile for the ingredient |
| `delete_ingredient` / `delete_vendor` | FK violations (PostgreSQL error 23503) are caught and returned as a friendly error string rather than throwing an unhandled exception |

### 1.14 Animated Waiting Indicator

While awaiting an AI response, three dots animate with a wave effect using scale and opacity transforms.

- CSS: `@keyframes pepper-dot` defined in `app/src/index.css`
- Applied via `animate-pepper-dot` utility class with staggered `animation-delay` on each dot
- All Pepper UI elements carry the `pepper-ui` CSS class, which excludes them from html2canvas screenshot captures

### 1.15 Tool Inventory — 74 tools total

#### Read / Lookup (15)

`get_dashboard_stats`, `list_ingredients`, `get_ingredient`, `list_recipes`, `get_recipe`, `list_menus`, `get_menu_cogs`, `get_feedback`, `submit_feedback`, `list_vendors`, `list_markets`, `list_categories`, `list_units`, `list_price_levels`, `list_price_quotes`

#### Write — Create (10)

`create_ingredient`, `create_vendor`, `create_price_quote`, `set_preferred_vendor`, `create_recipe`, `add_recipe_item`, `create_menu`, `add_menu_item`, `set_menu_item_price`, `create_category`

#### Write — Update (5)

`update_ingredient`, `update_vendor`, `update_price_quote`, `update_recipe`, `update_recipe_item`

#### Write — Delete (5)

`delete_ingredient`, `delete_vendor`, `delete_price_quote`, `delete_recipe_item`, `delete_menu`

#### Markets / Brand Partners (9)

`create_market`, `update_market`, `delete_market`, `assign_brand_partner`, `list_brand_partners`, `create_brand_partner`, `update_brand_partner`, `delete_brand_partner`, `unassign_brand_partner`

#### Categories (2)

`update_category`, `delete_category`

#### Tax Rates (5)

`list_tax_rates`, `create_tax_rate`, `update_tax_rate`, `set_default_tax_rate`, `delete_tax_rate`

#### Price Levels (3)

`create_price_level`, `update_price_level`, `delete_price_level`

#### Settings (2)

`get_settings`, `update_settings`

#### HACCP (8)

`list_haccp_equipment`, `create_haccp_equipment`, `update_haccp_equipment`, `delete_haccp_equipment`, `log_temperature`, `list_temp_logs`, `list_ccp_logs`, `add_ccp_log`

#### Locations (8)

`list_locations`, `create_location`, `update_location`, `delete_location`, `list_location_groups`, `create_location_group`, `update_location_group`, `delete_location_group`

#### Allergens (4)

`list_allergens`, `get_ingredient_allergens`, `set_ingredient_allergens`, `get_menu_allergens`

#### Import (1)

`start_import` — accepts file text content already in the conversation. Calls `stageFileContent()`. Returns `{ job_id, url: '/import?job=<id>', summary }`.

#### Web Search (1)

`search_web` — Brave Search if `BRAVE_SEARCH_API_KEY` configured, otherwise DuckDuckGo Instant Answer fallback. Only invoked on explicit user request.

---

## 2. Memory System — Designed, Not Yet Built

> This entire section is a design specification. None of the tables, CRON jobs, or pipeline code described here exist in the current codebase. The `mcogs_ai_chat_log` table is live; all other memory tables are planned.

### 2.1 Problem Statement

Pepper currently has no memory between sessions. Every conversation starts cold. For a franchise management tool used daily by operators, this creates friction:

- Pepper does not know the user's preferred markets, recurring concerns, or working patterns
- Pepper cannot say "welcome back — it's been 3 weeks"
- Patterns that would be visible across weeks of use are entirely invisible to Pepper
- Returning users must re-establish context on every session

### 2.2 Design Goal

Emulate human short-term and long-term memory using a hierarchical consolidation pipeline:

- **Working memory** — always loaded, small, instant: user profile + recent interaction context
- **Episodic memory** — recent events, retrievable by similarity: last few active days
- **Semantic memory** — stable patterns, slowly changing: consolidated from months of history

The result: Pepper behaves like a long-term colleague who remembers your priorities, notices when you've been away, and can surface what changed in your absence.

### 2.3 Architecture Diagram

```
CONVERSATION ENDS
    └─► extract_memories()
            Writes to: mcogs_memory_extracts
            Content:   facts, preferences, decisions, topics, events

NIGHTLY CRON (per user, 02:00 UTC)
    └─► daily_consolidation()
            Reads:   mcogs_memory_extracts  (today's unprocessed, this user)
            Writes:  mcogs_memory_daily     (text + embedding vector)
            Also:    updates mcogs_user_profiles (structured JSON)

MONTHLY CRON (per user, 1st of month, 03:00 UTC)
    └─► monthly_consolidation()
            Reads:   mcogs_memory_daily     (last 30 days, this user)
            Writes:  mcogs_memory_monthly   (text + embedding vector)
            Focus:   pattern identification, focus shifts, references specific days

QUARTERLY CRON (per user, 1st of quarter, 04:00 UTC)
    └─► quarterly_consolidation()
            Reads:   mcogs_memory_monthly   (last 3 months, this user)
            Writes:  mcogs_memory_quarterly (text + embedding vector)
            Also:    reads last 8 quarterly summaries (~2 years)
            Also:    rebuilds mcogs_user_profiles.long_term_summary

AT QUERY TIME (every Pepper message)
    └─► assembleMemoryContext()
            Always inject:  user profile JSON              (~300 tokens)
            Always inject:  last 3 stored interaction days (~500 tokens)
            Always inject:  top 2 quarterly records        (stable long-term patterns)
            Vector search:  top 3 relevant monthly records (medium-term recall)
            Total memory context: ~1,200–1,500 tokens per request
```

### 2.4 Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| "Last N days" definition | Last 3 **stored interaction days** (not last 3 calendar days) | If a user returns after 6 weeks, the last 3 calendar days are empty rows. Stored interaction days give real conversational continuity. |
| User profile loading | Always loaded — every request | Core context that must never be missing; small enough to always include (~300 tokens) |
| Quarterly records | Top 2 always loaded (not just via vector search) | Most stable long-term patterns should always be present, not dependent on retrieval relevance |
| Quarterly alignment | Calendar quarters, not 90-day rolling | Cleaner alignment; 90-day rolling creates drift and awkward boundary conditions |
| Permanent memory input window | Last 8 quarterly summaries (~2 years of history) | Sufficient history depth without over-weighting stale data |
| Vector database | pgvector extension on existing PostgreSQL | No new infrastructure; sufficient at this scale; no operational overhead |
| Embedding model | OpenAI `text-embedding-3-small` | $0.02/1M tokens; 1536 dimensions; excellent quality-to-cost ratio |
| Summarisation model | Claude Haiku (daily/monthly) and Claude Sonnet (quarterly) | Haiku is fast and cheap for routine summarisation; Sonnet used for the deeper quarterly synthesis |

### 2.5 User Profile Schema

Always loaded into every Pepper system prompt. Target: ~300 tokens.

```json
{
  "user_id": "auth0|...",
  "display_name": "Michael",
  "role": "franchise operator",
  "primary_markets": ["UK", "Germany"],
  "response_preference": "concise",
  "recurring_focus": ["COGS targets", "allergen compliance", "UK menu pricing"],
  "last_interaction": "2026-02-28",
  "days_since_last_interaction": 25,
  "avg_sessions_per_week": 3.2,
  "total_sessions": 147,
  "interaction_pattern": "returning_after_gap",
  "long_term_summary": "Focuses primarily on UK and German markets. Consistently reviews allergen compliance before menu updates. Prefers bullet-point responses. Has been expanding into delivery pricing over the past 6 months.",
  "profile_updated_at": "2026-03-01"
}
```

**`interaction_pattern` values:**

| Value | Condition |
|---|---|
| `new_user` | Fewer than 5 sessions total |
| `regular` | More than 2 sessions per week on average |
| `occasional` | 1–2 sessions per week |
| `returning_after_gap` | More than 14 days since last session |

Pepper uses this profile to acknowledge returning users naturally ("Welcome back — it's been about 3 weeks") and to adjust response depth and tone based on `response_preference`.

### 2.6 Activity Log

`mcogs_activity_log` records significant write operations across the app. It enables the "what changed since you were last here" digest shown to returning users.

**Sample Pepper greeting using activity digest:**
> "Welcome back. Since your last visit 3 weeks ago: 2 new recipes were added, the UK menu was updated, and price quotes were refreshed for 12 ingredients."

**What gets logged:**

- Recipe created / updated / deleted
- Menu created / updated / deleted
- Menu items added / removed
- Ingredients created / updated
- Price quotes added / updated / set as preferred
- Import jobs executed
- Settings changed (COGS thresholds, exchange rates synced)

**What does not get logged:**

- Read operations
- Auth0 login / logout events
- Individual allergen note edits (too granular)
- Pepper conversation turns (that is `mcogs_ai_chat_log`'s job)

**How activity log is used:**

1. Daily consolidation job includes a "changes since last interaction" digest in each day's memory summary
2. Query-time context assembly: if `days_since_last_interaction > 7`, pulls activity since `last_interaction` date and injects a change digest block into the system prompt

### 2.7 Memory Hierarchy (5 layers)

**Layer 0 — Per-conversation extraction (immediate, triggered at conversation end)**

Claude reads the completed conversation and extracts structured facts:

| Extract type | Example |
|---|---|
| `fact` | "User manages UK and Germany markets" |
| `preference` | "Prefers concise bullet-point responses" |
| `decision` | "Decided to switch UK chicken supplier to Farm Fresh" |
| `topic` | "Asked about COGS target methodology for new menu" |
| `event` | "Ran first import of French market data" |

Each extract is stored as a row in `mcogs_memory_extracts` with an `importance` score (1–5).

**Layer 1 — Daily consolidation (nightly CRON)**

Reads all unprocessed extracts for a user. Calls Claude Haiku to deduplicate, merge, and write a coherent daily summary. Embeds the summary and stores it in `mcogs_memory_daily`. Updates `mcogs_user_profiles` with any changed fields. Marks all processed extracts.

**Layer 2 — Monthly consolidation (monthly CRON)**

Reads the last 30 daily summaries. Calls Claude Haiku to identify recurring themes, notable shifts in focus, and key decisions. Stores as `mcogs_memory_monthly` with embedding.

**Layer 3 — Quarterly consolidation (quarterly CRON)**

Reads the last 3 monthly summaries. Calls Claude Sonnet to build a comprehensive quarterly profile — distinguishing stable patterns from short-term shifts, referencing specific months. Stores as `mcogs_memory_quarterly` with embedding.

Also reads the last 8 quarterly records (approximately 2 years) and calls Claude Sonnet to synthesise a permanent long-term summary. Writes result to `mcogs_user_profiles.long_term_summary`.

**Layer 4 — Activity log digest (part of daily consolidation)**

The daily CRON includes a "changes since last interaction" segment derived from `mcogs_activity_log`. This is included in the daily summary so future context assembly can surface it.

### 2.8 Retrieval at Query Time

```javascript
async function assembleMemoryContext(userId, currentMessage) {

  // 1. Always-loaded: structured profile (~300 tokens)
  const profile = await getProfile(userId);
  const profileBlock = formatProfileJSON(profile);

  // 2. Always-loaded: last 3 stored interaction days (~500 tokens)
  //    NOTE: "stored interaction days" = days where a daily summary exists
  //    This correctly handles users returning after a long absence
  const recentDays = await db.query(`
    SELECT summary, day_date
    FROM mcogs_memory_daily
    WHERE user_id = $1
    ORDER BY day_date DESC
    LIMIT 3
  `, [userId]);

  // 3. Always-loaded: top 2 most recent quarterly memories (~400 tokens)
  //    Most stable long-term patterns — always present, not gated on retrieval
  const topQuarterly = await db.query(`
    SELECT summary, quarter_start
    FROM mcogs_memory_quarterly
    WHERE user_id = $1
    ORDER BY quarter_start DESC
    LIMIT 2
  `, [userId]);

  // 4. Vector search: top 3 relevant monthly memories (~300 tokens)
  const queryEmbedding = await embed(currentMessage);
  const relevantMonthly = await db.query(`
    SELECT summary, month_start
    FROM mcogs_memory_monthly
    WHERE user_id = $1
    ORDER BY embedding <=> $2
    LIMIT 3
  `, [userId, queryEmbedding]);

  // 5. Activity digest (only if returning after a gap)
  let activityDigest = null;
  if (profile.days_since_last_interaction > 7) {
    activityDigest = await buildActivityDigest(userId, profile.last_interaction);
  }

  // 6. Assemble final memory block and inject into system prompt
  return buildMemoryBlock({
    profile:         profileBlock,
    recentDays:      recentDays.rows,
    topQuarterly:    topQuarterly.rows,
    relevantMonthly: relevantMonthly.rows,
    activityDigest
  });
  // Total: ~1,200–1,500 tokens injected per request
}
```

### 2.9 Consolidation Jobs

#### Nightly — `daily_consolidation` (02:00 UTC)

```
For each user with unprocessed mcogs_memory_extracts:

  1. Pull all extracts for this user where processed_at IS NULL
  2. Also pull mcogs_activity_log entries since user's last_interaction

  3. Call Claude Haiku:
     "Consolidate these conversation extracts into a coherent daily summary.
      Identify: key topics, decisions made, preferences expressed, facts learned,
      and summarise what changed in the app since this user's last interaction."

  4. Embed the summary text → store in mcogs_memory_daily

  5. Update mcogs_user_profiles:
     - Update recurring_focus and response_preference if extracts indicate a change
     - Set last_interaction = today
     - Recalculate avg_sessions_per_week
     - Recalculate days_since_last_interaction
     - Set interaction_pattern based on updated values

  6. Mark all pulled extracts as processed (set processed_at = NOW())
```

#### Monthly — `monthly_consolidation` (1st of month, 03:00 UTC)

```
For each user with daily summaries in the previous month:

  1. Pull all mcogs_memory_daily rows for the last 30 days

  2. Call Claude Haiku:
     "Analyse these daily summaries. Identify:
      - Recurring themes and consistent focus areas
      - Notable shifts in focus (reference specific dates where possible)
      - Key decisions or conclusions reached during this period
      - Patterns in how this user works with the app"

  3. Embed the monthly summary text → store in mcogs_memory_monthly
```

#### Quarterly — `quarterly_consolidation` (1st of quarter, 04:00 UTC)

```
For each user with monthly summaries in the previous quarter:

  1. Pull last 3 mcogs_memory_monthly summaries

  2. Call Claude Sonnet:
     "Build a comprehensive quarterly profile.
      Distinguish stable, long-term patterns from short-term focus shifts.
      Reference specific months where relevant.
      Note any major changes in the user's workflow or priorities."

  3. Embed → store in mcogs_memory_quarterly

  4. Pull last 8 mcogs_memory_quarterly summaries (approximately 2 years of history)

  5. Call Claude Sonnet:
     "Synthesise these quarterly profiles into a permanent long-term summary
      of this user's working style, primary focus areas, and patterns.
      This summary will be shown to a new AI session as the user's baseline profile."

  6. Update mcogs_user_profiles.long_term_summary with the synthesised text
```

### 2.10 Database Schema

```sql
-- Enable pgvector extension (run once per database)
CREATE EXTENSION IF NOT EXISTS vector;

-- User profiles — one row per Auth0 user
CREATE TABLE mcogs_user_profiles (
  id                  SERIAL PRIMARY KEY,
  user_id             VARCHAR(200) NOT NULL UNIQUE,  -- Auth0 sub claim
  display_name        VARCHAR(200),
  profile_json        JSONB NOT NULL DEFAULT '{}',   -- structured profile (section 2.5)
  long_term_summary   TEXT,                           -- rebuilt by quarterly job
  profile_updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Raw per-conversation memory extracts
CREATE TABLE mcogs_memory_extracts (
  id               SERIAL PRIMARY KEY,
  user_id          VARCHAR(200) NOT NULL,
  conversation_id  VARCHAR(200),
  extract_type     VARCHAR(50) NOT NULL
                     CHECK (extract_type IN ('fact','preference','decision','topic','event')),
  content          TEXT NOT NULL,
  importance       SMALLINT NOT NULL DEFAULT 3
                     CHECK (importance BETWEEN 1 AND 5),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ           -- set by nightly job when consolidated
);

-- Daily consolidated summaries — one row per user per active day
CREATE TABLE mcogs_memory_daily (
  id          SERIAL PRIMARY KEY,
  user_id     VARCHAR(200) NOT NULL,
  summary     TEXT NOT NULL,
  embedding   vector(1536),              -- text-embedding-3-small (1536 dims)
  day_date    DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, day_date)
);

-- Monthly pattern reports
CREATE TABLE mcogs_memory_monthly (
  id           SERIAL PRIMARY KEY,
  user_id      VARCHAR(200) NOT NULL,
  summary      TEXT NOT NULL,
  embedding    vector(1536),
  month_start  DATE NOT NULL,            -- first day of the month
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, month_start)
);

-- Quarterly profiles
CREATE TABLE mcogs_memory_quarterly (
  id             SERIAL PRIMARY KEY,
  user_id        VARCHAR(200) NOT NULL,
  summary        TEXT NOT NULL,
  embedding      vector(1536),
  quarter_start  DATE NOT NULL,          -- first day of the quarter (Jan 1, Apr 1, Jul 1, Oct 1)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, quarter_start)
);

-- Activity log — write event audit trail
CREATE TABLE mcogs_activity_log (
  id           SERIAL PRIMARY KEY,
  user_id      VARCHAR(200),             -- NULL for system-initiated actions
  action       VARCHAR(100) NOT NULL,    -- e.g. 'recipe.created', 'menu.updated'
  entity_type  VARCHAR(100),             -- e.g. 'recipe', 'ingredient', 'menu'
  entity_id    INTEGER,
  entity_name  VARCHAR(200),             -- denormalised display name at time of action
  meta         JSONB,                    -- additional context (e.g. market, before/after values)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Standard indexes
CREATE INDEX idx_memory_extracts_user    ON mcogs_memory_extracts (user_id, created_at DESC);
CREATE INDEX idx_memory_extracts_unproc  ON mcogs_memory_extracts (processed_at)
                                           WHERE processed_at IS NULL;
CREATE INDEX idx_memory_daily_user       ON mcogs_memory_daily (user_id, day_date DESC);
CREATE INDEX idx_memory_monthly_user     ON mcogs_memory_monthly (user_id, month_start DESC);
CREATE INDEX idx_memory_quarterly_user   ON mcogs_memory_quarterly (user_id, quarter_start DESC);
CREATE INDEX idx_activity_log_user       ON mcogs_activity_log (user_id, created_at DESC);
CREATE INDEX idx_activity_log_entity     ON mcogs_activity_log (entity_type, entity_id);

-- Vector similarity indexes (IVFFlat)
-- NOTE: lists parameter should be ~sqrt(row_count). Start at 10; REINDEX as data grows.
CREATE INDEX idx_memory_daily_vec     ON mcogs_memory_daily
                                        USING ivfflat (embedding vector_cosine_ops)
                                        WITH (lists = 10);
CREATE INDEX idx_memory_monthly_vec   ON mcogs_memory_monthly
                                        USING ivfflat (embedding vector_cosine_ops)
                                        WITH (lists = 10);
CREATE INDEX idx_memory_quarterly_vec ON mcogs_memory_quarterly
                                        USING ivfflat (embedding vector_cosine_ops)
                                        WITH (lists = 10);
```

### 2.11 New API Routes

These routes do not exist yet. They would be added when the memory system is implemented.

```
GET  /api/memory/profile             — get current authenticated user's profile JSON
PUT  /api/memory/profile             — update profile fields manually (admin override)

GET  /api/memory/daily?limit=10      — list recent daily summaries (debug / admin)
GET  /api/memory/activity?since=     — list activity log entries since a given ISO date

POST /api/memory/extract             — internal: trigger extraction for a completed conversation
POST /api/memory/run-daily           — internal: manual trigger for nightly consolidation (admin)
POST /api/memory/run-monthly         — internal: manual trigger for monthly consolidation (admin)
```

**Integration with existing routes:** `POST /api/ai-chat` and `POST /api/ai-upload` are extended to call `assembleMemoryContext(userId)` before building the messages array passed to Claude.

### 2.12 Cost Estimate

At 100 active users:

| Component | Calculation | Annual cost |
|---|---|---|
| Embeddings (text-embedding-3-small, $0.02/1M tokens) | 500 tokens/summary × 1/day × 365 × 100 users = 18.25M tokens | ~$0.37 |
| Nightly Haiku consolidation ($0.25/1M input tokens) | 2,000 tokens/user/day × 365 × 100 = 73M tokens | ~$18 |
| Monthly Haiku consolidation | 5,000 tokens/user/month × 12 × 100 = 6M tokens | ~$1.50 |
| Quarterly Sonnet consolidation ($3/1M input tokens) | 10,000 tokens/user/quarter × 4 × 100 = 4M tokens | ~$12 |
| Memory context injection overhead | ~1,500 extra tokens per request | Negligible vs base chat cost |
| **Total memory system** | | **~$32/year** |

Storage: `vector(1536)` = ~6KB per record. Approximately 38,100 records per year across all layers for 100 users → ~230MB.

### 2.13 Implementation Phases

| Phase | Scope | Effort |
|---|---|---|
| 1 — Foundation | pgvector extension, 6 new DB tables, activity log write hooks on all mutation routes, `assembleMemoryContext()` stub (returns empty) | 2 days |
| 2 — Extraction | Post-conversation extraction job, populate `mcogs_memory_extracts`, auto-create user profile on first session | 1.5 days |
| 3 — Daily consolidation | Nightly CRON job, daily summary generation, profile updates, last-3-days injection active in system prompt | 1.5 days |
| 4 — Monthly + Quarterly | Monthly and quarterly CRON jobs, full vector retrieval pipeline active | 1.5 days |
| 5 — Activity digest | Activity log populated across all write routes, "since your last visit" digest injected when `days_since_last_interaction > 7` | 1 day |
| **Total** | | **~7.5 days** |

### 2.14 Open Questions

1. **Multi-user vs single-user:** Memory assumes `user_id` from Auth0 sub. Does each Auth0 user need separate memory, or is there a shared franchise team account scenario to handle?
2. **Memory deletion / GDPR:** Users should be able to clear their memory profile. GDPR right to erasure applies if EU franchise operators use this system.
3. **Memory editing:** Should users be able to view and correct their inferred profile (e.g., remove an incorrect preference)?
4. **Cross-user global memory:** An overall daily analysis across all users for aggregate patterns was noted in early scoping. Not included in this design — add as Phase 6 if needed.
5. **IVFFlat tuning:** The `lists` parameter for IVFFlat indexes should be approximately `sqrt(row_count)`. Currently set to 10 as a starting value. Requires `REINDEX` as data volume grows beyond a few thousand rows per table.

---

## 3. Voice Interface — Scoped, Parked

> Not yet built. Scoped and parked pending explicit request to implement.

### 3.1 Overview

Two independent capabilities that can ship separately:

1. **Voice Input** — user speaks, transcript appears in the chat textarea, user reviews and sends
2. **Voice Output** — Pepper's text responses read aloud sentence-by-sentence as the SSE stream arrives

Either capability can be built without the other. Voice input is the higher-value feature for kitchen/back-of-house use where hands are occupied.

### 3.2 Capability 1: Voice Input

**User flow:** User taps mic button → browser requests microphone permission → live transcript appears in textarea as user speaks → user sends message (manually or on silence).

**Requirements:**

- Push-to-talk mic button in the input bar (alongside camera and paperclip icons)
- Live transcript displayed in textarea while recording
- Auto-send on silence OR manual send — configurable as a user preference toggle
- Visual recording indicator (pulsing ring or animated border)
- Cancel/stop recording without sending
- Graceful handling when microphone permission is denied
- Button disabled if `SpeechRecognition` is not available (non-Chromium browsers in Tier 1)

### 3.3 Capability 2: Voice Output

**User flow:** Pepper responds via SSE stream as normal. Text chunks are buffered, split on sentence boundaries, and queued to the TTS engine. Audio plays sentence-by-sentence in real time.

**Requirements:**

- Speaker toggle icon in the Pepper header — persisted to `localStorage('pepper-voice-output')`
- Sentence-by-sentence playback starts while the response is still streaming (not after it completes)
- Playback stops immediately when the user starts typing their next message
- Stop/interrupt button available during active playback
- Concise mode integration: shorter responses produce shorter audio

### 3.4 Implementation Tiers

| Tier | Input | Output | Cost | Effort | Browser support |
|---|---|---|---|---|---|
| **1 — Browser APIs** | `window.SpeechRecognition` | `window.speechSynthesis` | Free — no API keys | ~2 days | SpeechRecognition: Chrome/Edge only (~65% share). SpeechSynthesis: all browsers, robotic voice. |
| **2 — External APIs** | OpenAI Whisper (~$0.006/min) or Deepgram (~$0.0043/min) | OpenAI TTS (~$15/1M chars) or ElevenLabs | ~$15–50/mo at moderate usage | +3 days on top of Tier 1 | All browsers |

Tier 2 builds on top of Tier 1 — it replaces the API calls while reusing the UI layer.

### 3.5 Streaming TTS Technical Challenge

Pepper's response arrives as partial SSE text chunks, not complete sentences. To achieve real-time audio playback:

1. Buffer incoming text chunks as they arrive
2. Detect sentence boundaries: periods, question marks, or exclamation marks followed by whitespace or end-of-chunk
3. On each detected sentence: pass to TTS engine, queue the resulting audio
4. Play queued audio segments sequentially without gaps

**Browser `speechSynthesis`** handles this adequately in Tier 1 — the API accepts utterance objects and queues them natively.

**Tier 2 external TTS** requires a more complex implementation:

- A server-side proxy endpoint accepts a sentence, calls the TTS API, and returns an audio stream
- A client-side playback queue manager (`AudioContext` + `BufferSourceNode`) coordinates sequential playback
- The queue manager exposes a `stop()` method for interruption

### 3.6 UI Changes Required

| Element | Detail |
|---|---|
| Mic button | In chat input bar, next to camera and paperclip icons. Disabled state when SpeechRecognition unavailable. |
| Recording indicator | Pulsing ring or animated border on the textarea while recording |
| Speaker toggle | Icon in the Pepper panel header. Persisted to `localStorage('pepper-voice-output')`. |
| Stop/interrupt button | Visible during active audio playback. Stops queue and cancels current utterance. |
| Settings → AI (Tier 2 only) | Voice input engine selector, voice output engine selector, voice/speed controls |

### 3.7 Backend Changes (Tier 2 only)

- New server-side proxy endpoint: `POST /api/voice/tts` — accepts `{ text, voice? }`, proxies to OpenAI TTS or ElevenLabs, returns audio stream
- New API key fields in `mcogs_settings.ai_config`: `OPENAI_API_KEY` (or `DEEPGRAM_API_KEY`), `ELEVENLABS_API_KEY`
- New fields exposed in `GET/PUT /api/ai-config`

No backend changes are required for Tier 1.

### 3.8 Risks

| Risk | Detail |
|---|---|
| Browser compatibility | `SpeechRecognition` is Chromium-only. Approximately 35% of users (Firefox, Safari) get no voice input in Tier 1. |
| Kitchen background noise | Background noise in kitchen environments degrades browser SpeechRecognition accuracy significantly. Whisper (Tier 2) handles it materially better. |
| No Anthropic speech API | Requires mixing in OpenAI or Deepgram alongside the existing Anthropic setup, adding a second AI vendor dependency. |
| Mobile / touch | Push-to-talk works on mobile Chrome. Touch targets must be large enough for use with kitchen gloves. |
| Streaming TTS sentence detection | Sentence-boundary detection on streaming text is fiddly. Fragments like "e.g." or "Fig. 3" can produce false splits. Requires a tested boundary detection function. |

### 3.9 Recommendation

Start with **Tier 1** (browser-only, approximately 2 days, zero cost). This covers the core use case and is most valuable in back-of-house environments where hands are occupied. Upgrade to Tier 2 only if voice quality becomes a sustained user complaint or if Firefox/Safari support is required.

---

## 4. Reference

### 4.1 Related Documents

| Document | Description |
|---|---|
| [`docs/POS_MENU_FEATURES.md`](POS_MENU_FEATURES.md) | Manual items, combos, modifier groups — designed, not yet built |
| [`docs/ENTERPRISE_SCALE.md`](ENTERPRISE_SCALE.md) | Infrastructure scaling plan |
| [`CLAUDE.md`](../CLAUDE.md) | Full project reference — Section 14 covers Pepper summary |

### 4.2 Key Files

| File | Purpose |
|---|---|
| `app/src/components/AiChat.tsx` | Pepper chat panel — all frontend UI, SSE client, panel modes |
| `app/src/components/AppLayout.tsx` | Docked panel layout slots, right-click context menu handler, html2canvas integration |
| `api/src/routes/ai-chat.js` | Chat endpoint — all 74 tool definitions and implementations |
| `api/src/routes/ai-upload.js` | File/image upload endpoint |
| `api/src/helpers/agenticStream.js` | Shared SSE agentic loop (used by ai-chat and ai-upload) |
| `api/src/helpers/aiConfig.js` | AI config helper — reads `mcogs_settings.ai_config` from DB |
| `api/src/helpers/rag.js` | RAG system — chunk indexing, embedding, cosine similarity retrieval |
| `api/src/routes/ai-config.js` | AI config CRUD endpoint |
| `api/src/routes/import.js` | Exports `{ router, stageFileContent }` — stageFileContent used by ai-chat start_import tool |
| `api/src/routes/internal-feedback.js` | Claude Code internal feedback access endpoints |
| `api/scripts/migrate.js` | DB migration — includes `mcogs_ai_chat_log` table |

### 4.3 Database Tables (AI-related)

| Table | Status | Purpose |
|---|---|---|
| `mcogs_ai_chat_log` | Live | All Pepper conversation logs with tool calls and token counts |
| `mcogs_settings` | Live | Stores `ai_config` JSONB with API keys and feature flags |
| `mcogs_feedback` | Live | User-submitted bugs, feature requests, and general feedback |
| `mcogs_import_jobs` | Live | AI import staging jobs (used by start_import tool) |
| `mcogs_user_profiles` | Planned | Per-user structured profile JSON for memory system |
| `mcogs_memory_extracts` | Planned | Raw per-conversation memory extracts (unprocessed facts/events) |
| `mcogs_memory_daily` | Planned | Daily consolidated summaries with embedding vectors |
| `mcogs_memory_monthly` | Planned | Monthly pattern reports with embedding vectors |
| `mcogs_memory_quarterly` | Planned | Quarterly profiles with embedding vectors (permanent memory input) |
| `mcogs_activity_log` | Planned | App-wide write event log for "what changed since last visit" digest |

---

*AI.md last updated: March 2026 — covers Pepper current implementation (Claude Haiku 4.5, 74 tools, RAG system with Voyage AI, panel modes, screenshot, paste images, right-click context menu, PepperHelpButton, import wizard flow, concise mode, internal feedback API); Memory System full design specification (hierarchical consolidation pipeline, pgvector, user profile schema, activity log, 5-phase implementation plan); Voice Interface scope (Tier 1 browser APIs, Tier 2 external APIs, streaming TTS challenge — parked pending request)*
