// =============================================================================
// COGS AI Chat — SSE streaming endpoint powered by Claude Haiku 4.5
// POST /api/ai-chat        — send a message, receive SSE stream
// GET  /api/ai-chat-log    — paginated chat history
// =============================================================================

const router    = require('express').Router();
const Anthropic = require('@anthropic-ai/sdk');
const pool      = require('../db/pool');
const rag       = require('../helpers/rag');
const aiConfig  = require('../helpers/aiConfig');

// Client is created per-request so it always picks up the latest key
function getClient() {
  const key = aiConfig.get('ANTHROPIC_API_KEY');
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'get_dashboard_stats',
    description: 'Returns high-level counts: total ingredients, recipes, menus, vendors, markets, price quote coverage.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_ingredients',
    description: 'Lists all ingredients with id, name, and category. Use before get_ingredient to find an ID.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional name filter (case-insensitive partial match)' },
      },
      required: [],
    },
  },
  {
    name: 'get_ingredient',
    description: 'Returns full details for a single ingredient including nutrition, allergens, and price quotes.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Ingredient ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_recipes',
    description: 'Lists all recipes with id, name, and description.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Optional name filter' },
      },
      required: [],
    },
  },
  {
    name: 'get_recipe',
    description: 'Returns a recipe with all its ingredient lines and their costs per country.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: 'Recipe ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_menus',
    description: 'Lists all menus with id, name, and market (country).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_menu_cogs',
    description: 'Returns menu items with sell prices and COGS for a specific menu.',
    input_schema: {
      type: 'object',
      properties: {
        menu_id: { type: 'integer', description: 'Menu ID' },
      },
      required: ['menu_id'],
    },
  },
  {
    name: 'get_feedback',
    description: 'Returns feedback tickets from the feedback table, filterable by type and status.',
    input_schema: {
      type: 'object',
      properties: {
        type:   { type: 'string', enum: ['bug', 'feature', 'general'] },
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved'] },
        limit:  { type: 'integer', description: 'Max rows to return (default 20)' },
      },
      required: [],
    },
  },
  {
    name: 'submit_feedback',
    description: 'Submits a bug report, feature request, or general feedback. No confirmation required.',
    input_schema: {
      type: 'object',
      properties: {
        type:        { type: 'string', enum: ['bug', 'feature', 'general'] },
        title:       { type: 'string' },
        description: { type: 'string' },
        page:        { type: 'string', description: 'Which page/section the feedback relates to' },
      },
      required: ['type', 'title'],
    },
  },
];

// ── Tool executor ─────────────────────────────────────────────────────────────

async function executeTool(name, input) {
  switch (name) {

    case 'get_dashboard_stats': {
      const queries = [
        pool.query('SELECT COUNT(*) FROM mcogs_ingredients'),
        pool.query('SELECT COUNT(*) FROM mcogs_recipes'),
        pool.query('SELECT COUNT(*) FROM mcogs_menus'),
        pool.query('SELECT COUNT(*) FROM mcogs_vendors'),
        pool.query('SELECT COUNT(*) FROM mcogs_countries'),
        pool.query('SELECT COUNT(*) FROM mcogs_price_quotes'),
        pool.query('SELECT COUNT(*) FROM mcogs_ingredients WHERE id IN (SELECT ingredient_id FROM mcogs_price_quotes)'),
      ];
      const [ing, rec, men, ven, mkt, pq, covIng] = await Promise.all(queries);
      const total = parseInt(ing.rows[0].count, 10);
      const covered = parseInt(covIng.rows[0].count, 10);
      return {
        ingredients: total,
        recipes:     parseInt(rec.rows[0].count, 10),
        menus:       parseInt(men.rows[0].count, 10),
        vendors:     parseInt(ven.rows[0].count, 10),
        markets:     parseInt(mkt.rows[0].count, 10),
        price_quotes: parseInt(pq.rows[0].count, 10),
        quote_coverage_pct: total ? Math.round((covered / total) * 100) : 0,
      };
    }

    case 'list_ingredients': {
      const { search } = input;
      const q = search
        ? `SELECT i.id, i.name, c.name as category FROM mcogs_ingredients i LEFT JOIN mcogs_categories c ON c.id = i.category_id WHERE i.name ILIKE $1 ORDER BY i.name LIMIT 100`
        : `SELECT i.id, i.name, c.name as category FROM mcogs_ingredients i LEFT JOIN mcogs_categories c ON c.id = i.category_id ORDER BY i.name LIMIT 100`;
      const vals = search ? [`%${search}%`] : [];
      const { rows } = await pool.query(q, vals);
      return rows;
    }

    case 'get_ingredient': {
      const { id } = input;
      const [ing, quotes, allergens] = await Promise.all([
        pool.query(`SELECT i.*, c.name as category FROM mcogs_ingredients i LEFT JOIN mcogs_categories c ON c.id = i.category_id WHERE i.id = $1`, [id]),
        pool.query(`SELECT pq.*, v.name as vendor_name, co.name as country_name, co.currency_symbol FROM mcogs_price_quotes pq JOIN mcogs_vendors v ON v.id = pq.vendor_id LEFT JOIN mcogs_countries co ON co.id = pq.country_id WHERE pq.ingredient_id = $1 ORDER BY co.name`, [id]),
        pool.query(`SELECT a.name, a.code, ia.status FROM mcogs_ingredient_allergens ia JOIN mcogs_allergens a ON a.id = ia.allergen_id WHERE ia.ingredient_id = $1`, [id]),
      ]);
      if (!ing.rows.length) return { error: 'Ingredient not found' };
      return { ...ing.rows[0], price_quotes: quotes.rows, allergens: allergens.rows };
    }

    case 'list_recipes': {
      const { search } = input;
      const q = search
        ? `SELECT id, name, description FROM mcogs_recipes WHERE name ILIKE $1 ORDER BY name LIMIT 100`
        : `SELECT id, name, description FROM mcogs_recipes ORDER BY name LIMIT 100`;
      const { rows } = await pool.query(q, search ? [`%${search}%`] : []);
      return rows;
    }

    case 'get_recipe': {
      const { id } = input;
      const [rec, items] = await Promise.all([
        pool.query(`SELECT r.*, c.name as category FROM mcogs_recipes r LEFT JOIN mcogs_categories c ON c.id = r.category_id WHERE r.id = $1`, [id]),
        pool.query(`
          SELECT ri.*, i.name as ingredient_name, u.abbreviation as unit_abbr,
                 pq.unit_price, pq.currency_code,
                 co.name as country_name, co.currency_symbol
          FROM mcogs_recipe_items ri
          LEFT JOIN mcogs_ingredients i ON i.id = ri.ingredient_id
          LEFT JOIN mcogs_units u ON u.id = ri.unit_id
          LEFT JOIN LATERAL (
            SELECT pq2.unit_price, pq2.currency_code, pq2.country_id
            FROM mcogs_price_quotes pq2
            JOIN mcogs_ingredient_preferred_vendor ipv
              ON ipv.vendor_id = pq2.vendor_id
             AND ipv.ingredient_id = ri.ingredient_id
             AND ipv.country_id = pq2.country_id
            LIMIT 1
          ) pq ON TRUE
          LEFT JOIN mcogs_countries co ON co.id = pq.country_id
          WHERE ri.recipe_id = $1
          ORDER BY ri.sort_order
        `, [id]),
      ]);
      if (!rec.rows.length) return { error: 'Recipe not found' };
      return { ...rec.rows[0], items: items.rows };
    }

    case 'list_menus': {
      const { rows } = await pool.query(`
        SELECT m.id, m.name, c.name as market, c.currency_symbol
        FROM mcogs_menus m LEFT JOIN mcogs_countries c ON c.id = m.country_id
        ORDER BY c.name, m.name
      `);
      return rows;
    }

    case 'get_menu_cogs': {
      const { menu_id } = input;
      const { rows } = await pool.query(`
        SELECT mi.id, mi.display_name, mi.sell_price, mi.qty,
               r.name as recipe_name, i.name as ingredient_name,
               co.currency_symbol, co.name as market
        FROM mcogs_menu_items mi
        LEFT JOIN mcogs_menus m ON m.id = mi.menu_id
        LEFT JOIN mcogs_countries co ON co.id = m.country_id
        LEFT JOIN mcogs_recipes r ON r.id = mi.recipe_id
        LEFT JOIN mcogs_ingredients i ON i.id = mi.ingredient_id
        WHERE mi.menu_id = $1
        ORDER BY mi.display_name
      `, [menu_id]);
      return rows;
    }

    case 'get_feedback': {
      const { type, status, limit = 20 } = input;
      const conditions = [];
      const vals = [];
      if (type)   conditions.push(`type = $${vals.push(type)}`);
      if (status) conditions.push(`status = $${vals.push(status)}`);
      vals.push(limit);
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const { rows } = await pool.query(
        `SELECT * FROM mcogs_feedback ${where} ORDER BY created_at DESC LIMIT $${vals.length}`,
        vals
      );
      return rows;
    }

    case 'submit_feedback': {
      const { type = 'general', title, description, page } = input;
      const { rows } = await pool.query(
        `INSERT INTO mcogs_feedback (type, title, description, page) VALUES ($1,$2,$3,$4) RETURNING *`,
        [type, title, description || null, page || null]
      );
      return rows[0];
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildSystemPrompt(context, helpContext) {
  const page = context?.currentPage || 'unknown';
  return `You are the COGS Assistant — an AI helper embedded in the COGS Manager platform, a tool for restaurant franchise operators to manage menu cost-of-goods (COGS).

You help users:
- Understand their ingredient costs, recipe COGS, and menu profitability
- Navigate the platform and explain how features work
- Surface feedback and submit bug reports or feature requests
- Answer questions using live data from the COGS database

Your tools give you read access to ingredients, recipes, menus, vendors, markets, and feedback. You can also submit new feedback entries.

Always use tools to retrieve live data rather than guessing. If you do not have a tool for something, say so clearly.

Be concise and practical. For numbers, include currency symbols and units. Format data as readable lists or tables where appropriate.

${helpContext ? `## Relevant COGS Documentation\n\n${helpContext}` : ''}

## Current Context
- Active page: ${page}`.trim();
}

// ── POST /ai-chat ─────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  const anthropic = getClient();
  if (!anthropic) {
    return res.status(503).json({ error: { message: 'Anthropic API key is not configured. Add it in Settings → AI.' } });
  }

  const { message, context = {}, history = [] } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: { message: 'message is required' } });

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 10000);

  let fullResponse = '';
  const toolsCalled = [];
  let tokensIn = 0, tokensOut = 0;
  let errorMsg = null;

  try {
    // RAG — retrieve relevant help context
    const helpContext = await rag.retrieve(message);
    const systemPrompt = buildSystemPrompt(context, helpContext);

    // Build messages array (enforce max 20 history items)
    const messages = [
      ...history.slice(-20),
      { role: 'user', content: message.trim() },
    ];

    // Agentic loop
    while (true) {
      const stream = anthropic.messages.stream({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system:     systemPrompt,
        tools:      TOOLS,
        messages,
      });

      let assistantContent = [];
      let currentBlock = null;

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          currentBlock = { ...event.content_block, input_str: '' };
          if (currentBlock.type === 'tool_use') {
            send({ type: 'tool', name: currentBlock.name });
            toolsCalled.push(currentBlock.name);
          }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            send({ type: 'text', text: event.delta.text });
            fullResponse += event.delta.text;
            if (currentBlock) currentBlock.text = (currentBlock.text || '') + event.delta.text;
          }
          if (event.delta.type === 'input_json_delta' && currentBlock) {
            currentBlock.input_str = (currentBlock.input_str || '') + event.delta.partial_json;
          }
        }

        if (event.type === 'content_block_stop' && currentBlock) {
          if (currentBlock.type === 'tool_use' && currentBlock.input_str) {
            try { currentBlock.input = JSON.parse(currentBlock.input_str); } catch { currentBlock.input = {}; }
          }
          assistantContent.push(currentBlock);
          currentBlock = null;
        }

        if (event.type === 'message_delta' && event.usage) {
          tokensOut += event.usage.output_tokens || 0;
        }
        if (event.type === 'message_start' && event.message?.usage) {
          tokensIn += event.message.usage.input_tokens || 0;
        }
      }

      const finalMsg = await stream.finalMessage();

      if (finalMsg.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: assistantContent });
        break;
      }

      if (finalMsg.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: assistantContent });

        const toolBlocks = assistantContent.filter(b => b.type === 'tool_use');
        const toolResults = await Promise.all(
          toolBlocks.map(async (b) => {
            let result;
            try {
              result = await executeTool(b.name, b.input || {});
            } catch (err) {
              result = { error: err.message };
            }
            return {
              type:        'tool_result',
              tool_use_id: b.id,
              content:     JSON.stringify(result),
            };
          })
        );
        messages.push({ role: 'user', content: toolResults });
        continue;
      }

      break;
    }

  } catch (err) {
    errorMsg = err.message;
    if (err.status === 429) {
      send({ type: 'error', message: 'Rate limit reached. Please wait a moment before trying again.', retryAfter: 60 });
    } else {
      send({ type: 'error', message: err.message });
    }
  }

  // Log to DB (best-effort, don't block response)
  pool.query(
    `INSERT INTO mcogs_ai_chat_log (user_message, response, tools_called, context, tokens_in, tokens_out, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [message, fullResponse, JSON.stringify(toolsCalled), JSON.stringify(context), tokensIn, tokensOut, errorMsg]
  ).catch(e => console.error('[ai-chat] log error:', e.message));

  clearInterval(keepalive);
  send({ type: 'done' });
  res.end();
});

// ── GET /ai-chat-log ──────────────────────────────────────────────────────────

router.get('/log', async (req, res) => {
  const page  = Math.max(1, parseInt(req.query.page,  10) || 1);
  const limit = Math.min(100, parseInt(req.query.limit, 10) || 50);
  const offset = (page - 1) * limit;
  try {
    const [rows, total] = await Promise.all([
      pool.query(
        `SELECT * FROM mcogs_ai_chat_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        [limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM mcogs_ai_chat_log`),
    ]);
    res.json({ logs: rows.rows, total: parseInt(total.rows[0].count, 10), page });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Failed to fetch chat log' } });
  }
});

module.exports = router;
