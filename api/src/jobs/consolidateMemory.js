'use strict';
// =============================================================================
// Memory Consolidation Job
// Nightly: reads ai_chat_log + audit_log per user, summarises via Claude Haiku,
// stores in mcogs_memory_daily, updates mcogs_user_profiles.
// Monthly: consolidates daily summaries into monthly overview.
// =============================================================================

const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/pool');
const aiConfig  = require('../helpers/aiConfig');

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_CONVERSATIONS = 50;
const MAX_AUDIT_ENTRIES  = 100;
const MSG_TRUNCATE       = 300;

// ── Helpers ──────────────────────────────────────────────────────────────────

function yesterday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function truncate(str, max) {
  if (!str) return '';
  return str.length <= max ? str : str.slice(0, max) + '...';
}

function toDateStr(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// ── Daily consolidation prompt ───────────────────────────────────────────────

const DAILY_SYSTEM = `You are analysing a user's daily activity in a restaurant COGS (cost-of-goods) management system called COGS Manager. The user interacts with an AI assistant called Pepper.

Respond with ONLY valid JSON (no markdown fences, no explanation). Use this exact schema:
{
  "summary": "2-3 sentence summary of what the user worked on today",
  "topics": ["topic1", "topic2"],
  "profile_updates": {
    "primary_markets": ["market1"] or null,
    "recurring_focus": ["focus1"] or null,
    "response_preference": "concise" or null
  }
}

Rules:
- summary should capture goals and outcomes, not just list actions
- topics should be 2-5 short strings (e.g. "wings pricing", "allergen compliance")
- profile_updates fields should be null unless you see clear, repeated evidence
- primary_markets: only set if user explicitly works with specific country markets
- recurring_focus: only set if a topic appears in multiple conversations
- response_preference: only set if user explicitly asks for a style (concise, detailed, etc.)`;

// ── Monthly consolidation prompt ─────────────────────────────────────────────

const MONTHLY_SYSTEM = `You are analysing a user's monthly activity in a restaurant COGS management system. You will receive daily summaries from the past month.

Respond with ONLY valid JSON (no markdown fences, no explanation):
{
  "summary": "3-5 sentence overview of the user's month — key projects, patterns, and achievements",
  "themes": ["recurring theme 1", "recurring theme 2"],
  "focus_shifts": ["any notable changes in focus or priorities"]
}`;

// ── Core: process one user's daily data ──────────────────────────────────────

async function consolidateUserDay(client, userSub, dateStr) {
  // 1. Fetch conversations
  const { rows: chats } = await pool.query(`
    SELECT user_message, response, tools_called, tokens_in, tokens_out
    FROM   mcogs_ai_chat_log
    WHERE  user_sub = $1
      AND  created_at >= $2::date
      AND  created_at <  $2::date + INTERVAL '1 day'
    ORDER BY created_at ASC
    LIMIT  $3
  `, [userSub, dateStr, MAX_CONVERSATIONS]);

  if (!chats.length) return null;

  // 2. Fetch audit entries
  const { rows: audits } = await pool.query(`
    SELECT entity_type, action, entity_label, created_at
    FROM   mcogs_audit_log
    WHERE  user_sub = $1
      AND  created_at >= $2::date
      AND  created_at <  $2::date + INTERVAL '1 day'
    ORDER BY created_at ASC
    LIMIT  $3
  `, [userSub, dateStr, MAX_AUDIT_ENTRIES]);

  // 3. Build user message
  let totalTokens = 0;
  const toolSet = new Set();

  const chatBlock = chats.map((c, i) => {
    totalTokens += (c.tokens_in || 0) + (c.tokens_out || 0);
    if (Array.isArray(c.tools_called)) c.tools_called.forEach(t => toolSet.add(t));
    return `--- Conversation ${i + 1} ---\nUSER: ${truncate(c.user_message, MSG_TRUNCATE)}\nPEPPER: ${truncate(c.response, MSG_TRUNCATE)}\nTOOLS: ${(c.tools_called || []).join(', ') || 'none'}`;
  }).join('\n\n');

  const auditBlock = audits.length
    ? audits.map(a => `- ${a.action} ${a.entity_type}: ${a.entity_label || '(unnamed)'}`).join('\n')
    : '(no data changes recorded)';

  const userMsg = `Conversations from ${dateStr}:\n\n${chatBlock}\n\nData changes made:\n${auditBlock}`;

  // 4. Call Haiku
  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 600,
    system:     DAILY_SYSTEM,
    messages:   [{ role: 'user', content: userMsg }],
  });

  const rawText = response.content?.[0]?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Haiku returned non-JSON — store raw text, skip profile updates
    parsed = { summary: rawText, topics: [], profile_updates: null };
  }

  // 5. Upsert daily summary
  await pool.query(`
    INSERT INTO mcogs_memory_daily (user_sub, summary_date, summary, topics, tools_used, token_count)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_sub, summary_date)
    DO UPDATE SET summary = $3, topics = $4, tools_used = $5, token_count = $6, created_at = NOW()
  `, [
    userSub,
    dateStr,
    parsed.summary || rawText,
    JSON.stringify(parsed.topics || []),
    JSON.stringify([...toolSet]),
    totalTokens,
  ]);

  // 6. Merge profile updates (additive)
  if (parsed.profile_updates) {
    await mergeProfileUpdates(userSub, parsed.profile_updates);
  }

  return { summary: parsed.summary, topics: parsed.topics };
}

// ── Additive profile merge ───────────────────────────────────────────────────

async function mergeProfileUpdates(userSub, updates) {
  try {
    const { rows } = await pool.query(
      'SELECT profile_json FROM mcogs_user_profiles WHERE user_sub = $1',
      [userSub]
    );
    const existing = rows[0]?.profile_json || {};

    // Array fields: union (deduplicate)
    for (const field of ['primary_markets', 'recurring_focus']) {
      if (Array.isArray(updates[field]) && updates[field].length) {
        const merged = [...new Set([...(existing[field] || []), ...updates[field]])];
        existing[field] = merged;
      }
    }

    // String fields: overwrite only if non-null
    if (updates.response_preference) {
      existing.response_preference = updates.response_preference;
    }

    // Upsert
    await pool.query(`
      INSERT INTO mcogs_user_profiles (user_sub, profile_json, profile_updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_sub)
      DO UPDATE SET profile_json = $2, profile_updated_at = NOW()
    `, [userSub, JSON.stringify(existing)]);
  } catch (err) {
    console.error(`[memory] profile merge error for ${userSub}:`, err.message);
  }
}

// ── Monthly consolidation ────────────────────────────────────────────────────

async function consolidateUserMonth(client, userSub, monthDate) {
  const startOfMonth = monthDate.slice(0, 7) + '-01';

  const { rows: dailyRows } = await pool.query(`
    SELECT summary_date, summary, topics
    FROM   mcogs_memory_daily
    WHERE  user_sub = $1
      AND  summary_date >= $2::date
      AND  summary_date <  $2::date + INTERVAL '1 month'
    ORDER BY summary_date ASC
  `, [userSub, startOfMonth]);

  if (!dailyRows.length) return null;

  const summaryBlock = dailyRows.map(d =>
    `${d.summary_date}: ${d.summary} [Topics: ${(d.topics || []).join(', ')}]`
  ).join('\n');

  const response = await client.messages.create({
    model:      MODEL,
    max_tokens: 800,
    system:     MONTHLY_SYSTEM,
    messages:   [{ role: 'user', content: `Daily summaries for ${startOfMonth.slice(0, 7)}:\n\n${summaryBlock}` }],
  });

  const rawText = response.content?.[0]?.text || '';
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = { summary: rawText, themes: [], focus_shifts: [] };
  }

  // Check if quarter boundary (month is Jan/Apr/Jul/Oct)
  const monthNum = parseInt(startOfMonth.slice(5, 7), 10);
  const isQuarterly = [1, 4, 7, 10].includes(monthNum);

  await pool.query(`
    INSERT INTO mcogs_memory_monthly (user_sub, summary_month, summary, themes, focus_shifts, is_quarterly)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_sub, summary_month)
    DO UPDATE SET summary = $3, themes = $4, focus_shifts = $5, is_quarterly = $6, created_at = NOW()
  `, [
    userSub,
    startOfMonth,
    parsed.summary || rawText,
    JSON.stringify(parsed.themes || []),
    JSON.stringify(parsed.focus_shifts || []),
    isQuarterly,
  ]);

  // If quarterly, also update long_term_summary
  if (isQuarterly) {
    await pool.query(`
      UPDATE mcogs_user_profiles
      SET    long_term_summary = $2, profile_updated_at = NOW()
      WHERE  user_sub = $1
    `, [userSub, parsed.summary]);
  }

  return { summary: parsed.summary, themes: parsed.themes, isQuarterly };
}

// ── Main entry point ─────────────────────────────────────────────────────────

async function runConsolidation({ targetDate, forceMonthly } = {}) {
  const dateStr = targetDate ? toDateStr(targetDate) : yesterday();
  console.log(`[memory] Consolidation starting for ${dateStr}`);

  // Get Anthropic client
  const apiKey = aiConfig.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    console.warn('[memory] No Anthropic API key configured — skipping consolidation');
    return { status: 'skipped', reason: 'no_api_key' };
  }
  const client = new Anthropic({ apiKey });

  // Find users with conversations on target date
  const { rows: users } = await pool.query(`
    SELECT DISTINCT user_sub
    FROM   mcogs_ai_chat_log
    WHERE  user_sub IS NOT NULL
      AND  created_at >= $1::date
      AND  created_at <  $1::date + INTERVAL '1 day'
  `, [dateStr]);

  if (!users.length) {
    console.log(`[memory] No conversations on ${dateStr} — nothing to consolidate`);
    return { status: 'ok', date: dateStr, users_processed: 0 };
  }

  const errors = [];
  let processed = 0;

  // Daily consolidation
  for (const { user_sub } of users) {
    try {
      const result = await consolidateUserDay(client, user_sub, dateStr);
      if (result) {
        processed++;
        console.log(`[memory] ${user_sub}: ${result.topics?.join(', ') || 'summarised'}`);
      }
    } catch (err) {
      console.error(`[memory] Error consolidating ${user_sub}:`, err.message);
      errors.push({ user_sub, error: err.message });
    }
  }

  // Monthly consolidation check
  const targetDay = parseInt(dateStr.slice(8, 10), 10);
  let monthlyResults = null;
  if (forceMonthly || targetDay === 1) {
    // Consolidate previous month
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - (targetDay === 1 ? 1 : 0));
    const prevMonth = d.toISOString().slice(0, 10);

    console.log(`[memory] Running monthly consolidation for ${prevMonth.slice(0, 7)}`);
    monthlyResults = {};

    // Get all users who have daily summaries for that month
    const { rows: monthUsers } = await pool.query(`
      SELECT DISTINCT user_sub
      FROM   mcogs_memory_daily
      WHERE  summary_date >= $1::date
        AND  summary_date <  $1::date + INTERVAL '1 month'
    `, [prevMonth.slice(0, 7) + '-01']);

    for (const { user_sub } of monthUsers) {
      try {
        const mr = await consolidateUserMonth(client, user_sub, prevMonth);
        if (mr) monthlyResults[user_sub] = mr;
      } catch (err) {
        console.error(`[memory] Monthly error ${user_sub}:`, err.message);
        errors.push({ user_sub, error: `monthly: ${err.message}` });
      }
    }
  }

  // Record last run state in settings
  try {
    const state = {
      last_run: new Date().toISOString(),
      target_date: dateStr,
      users_processed: processed,
      errors: errors.slice(0, 10),
      monthly_run: !!monthlyResults,
    };
    await pool.query(`
      UPDATE mcogs_settings
      SET    data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('memory_consolidation', $1::jsonb)
      WHERE  id = 1
    `, [JSON.stringify(state)]);
  } catch (err) {
    console.error('[memory] Failed to save consolidation state:', err.message);
  }

  const result = { status: 'ok', date: dateStr, users_processed: processed, errors: errors.length };
  console.log(`[memory] Consolidation complete:`, JSON.stringify(result));
  return result;
}

module.exports = { runConsolidation };
