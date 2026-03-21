# SignFlow AI — McFry Assistant
## Purpose, Architecture, Tools & Implementation Guide

> Last updated: 2026-03-20
> For use by external developers, AI assistants, or systems integrating with or extending the McFry feature.

---

## 1. Overview & Purpose

**McFry** is an embedded AI assistant built into the SignFlow admin panel. It is powered by Anthropic Claude (Haiku 4.5) and augmented with semantic search over the platform's own help documentation via Voyage AI embeddings.

### Primary Goals

- **Reduce friction for admins** — enable natural-language control of the platform without requiring deep knowledge of the UI
- **Explain the platform** — answer questions about how SignFlow works, drawing from contextually relevant help docs
- **Execute write operations** — create forms, update configs, manage design templates, all with a confirmation-first safety policy
- **Surface analytics & subscriber data** — query live stats without leaving the chat panel
- **Capture feedback** — let admins report bugs, request changes, or suggest features through conversation
- **Brand analysis** — extract colour palettes, fonts, and logos from external websites or uploaded images and apply them to forms

### Intended Users

- **Super-admins** — receive full technical detail in responses; can perform all write operations
- **Market admins** — receive plain-language responses; limited to read-only operations on their assigned forms

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────┐
│  Admin Browser (admin/index.html)                    │
│                                                      │
│  ┌─────────────────────────────────────────────┐    │
│  │  McFry Chat Panel (floating sidebar UI)     │    │
│  │  - Text input + image upload                │    │
│  │  - SSE streaming display                    │    │
│  │  - Context builder (tab, form, role)        │    │
│  └─────────────┬───────────────────────────────┘    │
└────────────────┼─────────────────────────────────────┘
                 │ POST /api/admin/ai-chat
                 │ { message, context, history, imageUrls }
                 ▼
┌──────────────────────────────────────────────────────┐
│  server.js — /api/admin/ai-chat handler              │
│                                                      │
│  1. Auth check (adminAuth middleware)                │
│  2. Build system prompt                              │
│     └─ Role-specific guidance                        │
│     └─ Injected help context (RAG — see §4)          │
│     └─ Current page context (tab, form, modal)       │
│  3. Agentic loop (Anthropic SDK, streaming)          │
│     └─ Send message to Claude Haiku 4.5              │
│     └─ Handle tool_use blocks → _executeAiTool()     │
│     └─ Return tool results → continue loop           │
│     └─ End loop on stop_reason: end_turn             │
│  4. Log conversation → ai_chat_log table             │
│  5. Stream SSE events to browser                     │
└──────────────────────────────────────────────────────┘
                 │
        ┌────────┴────────┐
        ▼                 ▼
┌──────────────┐  ┌───────────────────┐
│ Anthropic    │  │ Voyage AI         │
│ Claude       │  │ voyage-3-lite     │
│ Haiku 4.5    │  │ (1024-dim vectors)│
│              │  │ Semantic RAG over │
│ Tool use     │  │ Help docs         │
│ Streaming    │  └───────────────────┘
└──────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────┐
│  _executeAiTool() — dispatches tool calls to:        │
│  - PostgreSQL (forms, analytics, subscribers,        │
│                bug_reports, design_templates)        │
│  - Amazon S3 (form configs, images)                  │
│  - External websites (brand analysis via fetch)      │
└──────────────────────────────────────────────────────┘
```

### Transport: Server-Sent Events (SSE)

The API endpoint `POST /api/admin/ai-chat` responds with a streaming SSE connection. Events are emitted as:

```
data: {"type": "text", "text": "..."}
data: {"type": "tool", "name": "get_form"}
data: {"type": "done"}
data: {"type": "error", "message": "..."}
```

A keepalive comment (`: ping`) is sent every 10 seconds to prevent Nginx from closing the connection.

---

## 3. API Endpoints

### `POST /api/admin/ai-chat`
Main SSE stream. Requires Auth0 session.

**Request body:**
```json
{
  "message": "What's the subscriber count for wingstop-uk?",
  "context": {
    "currentTab": "subscribers",
    "currentFormSlug": "wingstop-uk",
    "activeModal": null,
    "panelTab": null,
    "userRole": "super-admin"
  },
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "imageUrls": ["https://bucket.s3.region.amazonaws.com/chat-uploads/uuid.jpg"]
}
```

**Response:** SSE stream (see §2 above)

**Error handling:**
- `429` — rate limit hit; response includes `Retry-After` header; client renders countdown timer
- `400` (credit balance) — billing error; response includes link to console.anthropic.com

---

### `POST /api/admin/chat-upload`
Upload an image for use in the AI chat (brand analysis, etc.). Requires Auth0 session.

**Request:** `multipart/form-data` with field `image`
**Accepted MIME types:** `image/jpeg`, `image/png`, `image/gif`, `image/webp`
**Max size:** 10 MB
**Storage:** S3 under `chat-uploads/{uuid}.{ext}` — NOT tracked in the `media` table

**Response:**
```json
{ "url": "https://bucket.s3.region.amazonaws.com/chat-uploads/uuid.jpg" }
```

---

### `GET /api/admin/ai-chat-log`
Paginated log of all McFry conversations. Requires Auth0 session.

**Query params:** `?page=1&limit=50&user=email@example.com`

**Response:**
```json
{
  "logs": [
    {
      "id": "uuid",
      "created_at": "ISO8601",
      "user_email": "admin@example.com",
      "user_message": "...",
      "response": "...",
      "tools_called": ["get_form", "update_form_config"],
      "context": { "currentTab": "build", "currentFormSlug": "wingstop-uk" },
      "tokens_in": 1200,
      "tokens_out": 380,
      "error": null
    }
  ],
  "total": 142,
  "page": 1
}
```

---

### `GET /api/admin/ai-chat-log/export`
CSV export of the full chat log. Requires Auth0 session.

---

### `GET /api/admin/bug-reports`
List all feedback entries (bugs, change requests, feature ideas) submitted by McFry.

**Query params:** `?type=bug|change|feature&status=open|in-progress|resolved|wont-fix`

---

### `PATCH /api/admin/bug-reports/:id`
Update the status of a feedback entry.

**Request body:** `{ "status": "in-progress" }`

---

### `DELETE /api/admin/bug-reports/:id`
Delete a feedback entry.

---

### `GET /api/internal/feedback` (Claude Code / external tool access)
Read-only bridge to the bug_reports table. Protected by `INTERNAL_API_KEY` query param (stored in `.env`, never committed).

**URL:** `https://wingvibes.com/api/internal/feedback?key=<INTERNAL_API_KEY>`

**Optional filters:** `&type=bug|change|feature`, `&status=open|in-progress|resolved|wont-fix`, `&limit=N`

---

## 4. Retrieval-Augmented Generation (RAG)

McFry uses Voyage AI to perform semantic search over the platform's built-in Help documentation before constructing each system prompt.

### Pipeline (runs at server startup)

1. **Load Help sections** — `_loadHelpContext()` parses all `<section data-help>` blocks from `admin/index.html`, extracting `data-key` and text content
2. **Chunk & embed** — each section is embedded via `_voyageEmbed()` using the `voyage-3-lite` model (1024-dimensional float32 vectors)
3. **Store in-memory** — vectors are held in the `_helpChunks` array on `app.locals`
4. **`_helpReady` flag** — set to `true` once all embeddings are complete

### Per-request retrieval

1. The incoming user message is embedded using the same `voyage-3-lite` model
2. Cosine similarity is computed between the query vector and all stored help-chunk vectors (`_cosineSim()`)
3. Top 4 highest-scoring chunks are selected
4. Their text is injected into the system prompt under the heading `Relevant SignFlow Documentation`

### Fallback

If `VOYAGE_API_KEY` is not set or embeddings are not ready, `_keywordFallback()` is used — a simple keyword frequency match against help text.

### Environment variable required

```
VOYAGE_API_KEY=<from dash.voyageai.com>
```

---

## 5. AI Tools

McFry has access to 12 tools. Tools are defined in `server.js` at approximately line 2440 and dispatched via `_executeAiTool()` at approximately line 2563.

### Read-Only Tools

| Tool | Description | Returns |
|------|-------------|---------|
| `get_form` | Fetch the full config JSONB of a specific form | Full form config object |
| `get_analytics` | Return visit, submit, and error event counts for a form | `{ visit, submit, error }` |
| `get_subscribers_summary` | Subscriber counts by status + 5 most recent emails | `{ total, active, unsubscribed, recent[] }` |
| `get_form_list` | List all forms with slugs and names | Array of `{ slug, name, status }` |
| `get_feedback` | Query the bug_reports table, filterable by type/status | Array of feedback records |
| `list_design_templates` | List all saved design templates | Array of `{ id, name, created_at }` |
| `analyze_website` | Fetch an external URL and extract brand colours, fonts, and logos | `{ colors[], fonts[], logoUrl, title }` |

### Write Tools (require explicit user confirmation before executing)

| Tool | Description | Confirmation policy |
|------|-------------|-------------------|
| `submit_feedback` | Save a bug report, change request, or feature idea to the `bug_reports` table | Auto — no confirmation needed (non-destructive) |
| `create_form` | Create a new form with a given slug and name | Must ask "Shall I proceed?" before calling |
| `update_form_config` | Update any part of a form's config JSONB (design, sections, fields, etc.) | Must ask "Shall I proceed?" before calling |
| `create_design_template` | Save a named design template | Must ask "Shall I proceed?" before calling |
| `apply_design_template` | Apply a saved design template to a form | Must ask "Shall I proceed?" before calling |

### Tool Input Schemas (summary)

```js
get_form:               { slug: string }
get_analytics:          { slug: string }
get_subscribers_summary:{ slug: string }
get_form_list:          {}
get_feedback:           { type?: "bug"|"change"|"feature", status?: "open"|"in-progress"|"resolved"|"wont-fix" }
submit_feedback:        { type: "bug"|"change"|"feature", title: string, description: string, steps?: string }
create_form:            { slug: string, name: string }
update_form_config:     { slug: string, patch: object }  // deep-merged into existing config
list_design_templates:  {}
create_design_template: { name: string, design: object }
apply_design_template:  { template_id: string, slug: string }
analyze_website:        { url: string }
```

---

## 6. System Prompt Design

The system prompt is constructed per-request in `server.js` at approximately line 2779.

### Components

1. **Role identity** — McFry is described as a helpful assistant for the SignFlow platform
2. **Role-based verbosity** — super-admin gets full technical detail; market admin gets plain-language summaries
3. **Write confirmation policy** — all write tools must be preceded by an explicit "Shall I proceed?" check with a plain-English description of the change
4. **Tool guidance** — when to use each tool, what to infer vs. ask
5. **TILE GRID (iconselect) documentation** — detailed field type docs injected because this is the most complex field type and frequently misunderstood
6. **Platform stack description** — PostgreSQL, S3, Auth0, Express, PM2, Nginx
7. **Injected help context** — top-4 semantically relevant Help sections (see §4)
8. **Current context block** — live state from the browser:

```
Current admin context:
- Active tab: build
- Current form: wingstop-uk
- Active modal: field-editor-modal
- Panel tab: response
- User role: super-admin
```

---

## 7. Context Injection (Frontend → Backend)

The browser sends a `context` object with every message. It is built by `buildAiContext()` in `admin/index.html`:

```js
{
  currentTab:       string,   // e.g. "build", "subscribers", "embed", "help"
  currentFormSlug:  string,   // slug of the form currently open in the editor
  activeModal:      string,   // DOM id of the currently open modal, or null
  panelTab:         string,   // sub-panel tab (e.g. "response" for confirmation panel)
  userRole:         string    // "super-admin" or "admin"
}
```

This context is injected at the bottom of the system prompt and also stored in the `ai_chat_log` for audit purposes.

---

## 8. Chat Activity Log

Every McFry conversation turn is persisted in the `ai_chat_log` PostgreSQL table.

### Schema

```sql
CREATE TABLE ai_chat_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  user_email  TEXT,
  user_message TEXT,
  response    TEXT,
  tools_called JSONB,   -- array of tool names called during this turn
  context     JSONB,    -- snapshot of buildAiContext() at request time
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  error       TEXT
);
CREATE INDEX ON ai_chat_log (created_at DESC);
CREATE INDEX ON ai_chat_log (user_email);
```

### Access

- UI: Platform Settings → Logs → McFry Chat
- API: `GET /api/admin/ai-chat-log` (paginated), `GET /api/admin/ai-chat-log/export` (CSV)

---

## 9. Feedback / Bug Reports

McFry can autonomously submit structured feedback to the `bug_reports` table using the `submit_feedback` tool. This is the primary mechanism for surfacing bugs, change requests, and feature ideas discovered during chat.

### Schema

```sql
CREATE TABLE bug_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT CHECK (type IN ('bug', 'change', 'feature')),
  title       TEXT NOT NULL,
  description TEXT,
  steps       TEXT,
  context     JSONB,         -- { tab, form } at time of report
  reported_by TEXT,          -- user email
  status      TEXT DEFAULT 'open' CHECK (status IN ('open','in-progress','resolved','wont-fix')),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Workflow

1. Admin describes a bug or requests a feature in chat
2. McFry calls `submit_feedback` (no confirmation required — non-destructive)
3. Entry appears in Help → Feedback tab in admin UI
4. Status can be updated to `in-progress`, `resolved`, or `wont-fix` by any admin

---

## 10. Brand Analysis

McFry can analyse an external website or an uploaded image to extract branding for use in form design.

### URL-based analysis
- Tool: `analyze_website`
- McFry fetches the URL server-side, parses HTML for `<meta>` tags, inline styles, stylesheet colour declarations, `<link rel="icon">`, and Google Fonts references
- Returns: dominant colours (hex), font names, logo URL, page title

### Image-based analysis
- Admin uploads image via 🖼 button in chat UI → `POST /api/admin/chat-upload` → returns S3 URL
- Image URL is passed in `imageUrls[]` in the chat request
- Claude's vision capability is used directly — no separate tool required
- McFry reads colours, logos, and design style from the image

### Typical workflow
```
Admin: "Here's our website: https://example.com — can you match the design to our brand?"
McFry: calls analyze_website → extracts colors/fonts
McFry: "I found these brand colors: #1a1a2e, #e94560. Shall I apply them to the wingstop-uk form?"
Admin: "Yes"
McFry: calls update_form_config with design patch → confirms change applied
```

---

## 11. Model & Configuration

| Parameter | Value |
|-----------|-------|
| Model | `claude-haiku-4-5` |
| SDK | `@anthropic-ai/sdk` (Node.js) |
| Streaming | Yes — via `stream()` method |
| Max tokens | 4096 (output) |
| Tool choice | `auto` |
| Embedding model | `voyage-3-lite` (Voyage AI) |
| Embedding dimensions | 1024 |
| RAG top-k | 4 |

### Environment Variables Required

```env
ANTHROPIC_API_KEY=<from console.anthropic.com>
VOYAGE_API_KEY=<from dash.voyageai.com>
INTERNAL_API_KEY=<random secret — for Claude Code read-only access>
```

Both AI services are optional — if keys are missing, McFry will be unavailable (Anthropic) or fall back to keyword search (Voyage). The integrations health board at `/admin/integrations` shows live status for both.

---

## 12. Frontend UI

McFry renders as a **floating sidebar panel** in the admin SPA (`admin/index.html`).

### Key UI elements

| Element | Description |
|---------|-------------|
| Toggle button | Fixed bottom-right button (🐔 icon, Wingstop green `#5cb85c`) |
| Chat panel | Slides in from the right; shows message history |
| Input bar | Text input + 🖼 image upload button + send button |
| Streaming display | Text appears token-by-token as SSE events arrive |
| Tool indicators | Shows tool name while a tool call is in progress |
| Image preview | Thumbnail shown before sending, with ✕ remove button |
| Reset button | Clears message history but keeps panel open |
| Close button | Closes panel; history preserved until page reload |
| Rate-limit countdown | Rendered by `_aiStartCooldown()` when a 429 is received |

### Markdown rendering

`_aiMd()` provides lightweight markdown → HTML conversion for McFry's responses:
- `**bold**` → `<strong>`
- `` `code` `` → `<code>`
- Newlines → `<br>`

### Key frontend functions (admin/index.html)

| Function | Purpose |
|----------|---------|
| `buildAiContext()` | Snapshot current tab/form/modal/role state |
| `toggleAiChat()` | Open/close the panel |
| `sendAiMessage()` | POST to `/api/admin/ai-chat`, read SSE stream |
| `resetAiContext()` | Clear history, reset panel state |
| `clearAiChat()` | Clear everything including pending images |
| `_aiUploadImage()` | Upload image to `/api/admin/chat-upload` |
| `_aiRenderPendingImages()` | Show image preview in input bar |
| `_aiRemoveImage()` | Remove a pending image before send |
| `_aiAppend()` | Append a message bubble to the chat |
| `_aiMd()` | Render markdown → HTML |
| `_aiStartCooldown(seconds)` | Render rate-limit countdown timer |

---

## 13. Integration Health Checks

The `/admin/integrations` board tracks the health of both AI services.

### Anthropic check (`checkAnthropic()` in `routes/integrations.js`)
- Validates that `ANTHROPIC_API_KEY` is set
- Calls a minimal Anthropic API probe to confirm key validity and model availability
- Reports: status (ok / error / unconfigured), latency (ms), detail message

### Voyage AI check
- Validates that `VOYAGE_API_KEY` is set
- Checks `_helpReady` flag on `app.locals` to confirm embeddings were successfully generated
- Reports: status (ok / error / unconfigured), number of help sections embedded

Both cards show a [Test] button that triggers a live re-check and report updated latency/status.

---

## 14. Security Considerations

- All AI endpoints require a valid Auth0 session (`adminAuth` middleware)
- All mutation requests (write tools) require a valid CSRF token (`X-CSRF-Token` header)
- Write tools include an explicit confirmation policy — McFry must ask before executing
- Chat upload images are stored in a separate S3 path (`chat-uploads/`) and NOT recorded in the `media` table — they are not visible to the form editor
- The `INTERNAL_API_KEY` provides read-only external access to the `bug_reports` table only — it does not expose subscribers, form configs, or any other data
- API rate limits apply to `/api/admin/ai-chat` (via Express rate-limit middleware)
- McFry responses are streamed — there is no buffering of full LLM output before sending to the browser

---

## 15. Extending McFry

### Adding a new tool

1. Add a tool definition object to the `tools` array in `server.js` (around line 2440):
```js
{
  name: "my_new_tool",
  description: "What the tool does",
  input_schema: {
    type: "object",
    properties: {
      my_param: { type: "string", description: "..." }
    },
    required: ["my_param"]
  }
}
```

2. Add a case to `_executeAiTool()` (around line 2563):
```js
case 'my_new_tool': {
  const { my_param } = input;
  // ... execute logic ...
  return { result: ... };
}
```

3. If it is a write operation, add the tool name to the confirmation-required list in the system prompt narrative so McFry knows to ask before calling it.

### Adding help content to RAG

Add a new `<section data-help data-key="unique-key">` block inside the Help tab in `admin/index.html`. On next server restart, `_loadHelpContext()` will pick it up and embed it automatically.

### Changing the model

Update the model string in the `messages.stream()` call within the `/api/admin/ai-chat` handler in `server.js`. Available Claude models:
- `claude-haiku-4-5` — current (fast, cheap)
- `claude-sonnet-4-6` — higher quality (4× slower, 3× more expensive)
- `claude-opus-4-6` — highest quality (most expensive)

---

## 16. Overarching Objectives

McFry is designed around three principles:

### 1. Low floor, high ceiling
Any admin — regardless of technical skill — should be able to make meaningful changes to their forms and understand platform data through natural language. At the same time, super-admins can issue precise technical instructions and receive detailed structured output.

### 2. Safety over speed
Write operations always require explicit confirmation. McFry is not permitted to mutate data without clearly describing what it intends to do and receiving a "yes" from the user. This prevents accidental changes to live forms.

### 3. Platform-aware, not generic
McFry knows the SignFlow data model, form config schema, field types, analytics schema, and admin workflows. Every response is grounded in the platform's actual capabilities. The RAG pipeline ensures that answers about "how does X work" are drawn from the real help documentation, not hallucinated.
