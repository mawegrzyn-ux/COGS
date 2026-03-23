// =============================================================================
// COGS AI Upload — multipart SSE endpoint for file-assisted AI interactions
// POST /api/ai-upload
//
// Accepts: text/csv, text/plain, image/png, image/jpeg, image/webp (max 5MB)
// CSV/text → injected as a text content block alongside the user message
// Images   → injected as a base64 vision content block
// =============================================================================

const router  = require('express').Router();
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const pool    = require('../db/pool');
const rag     = require('../helpers/rag');
const aiConfig = require('../helpers/aiConfig');
const { agenticStream } = require('../helpers/agenticStream');
const { TOOLS, executeTool, buildSystemPrompt } = require('./ai-chat');

// ── multer — memory storage, 5MB limit, MIME whitelist ────────────────────────

const ALLOWED_MIMES = new Set([
  'text/csv',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', `Unsupported file type: ${file.mimetype}. Accepted: CSV, TXT, PNG, JPG, WebP.`));
    }
  },
});

function getClient() {
  const key = aiConfig.get('ANTHROPIC_API_KEY');
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ── POST /ai-upload ───────────────────────────────────────────────────────────

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: { message: err.message || 'File upload error' },
      });
    }
    next();
  });
}, async (req, res) => {
  const anthropic = getClient();
  if (!anthropic) {
    return res.status(503).json({ error: { message: 'Anthropic API key is not configured. Add it in Settings → AI.' } });
  }

  const message = req.body.message?.trim() || '';
  const file    = req.file;

  // At least a message or file is required
  if (!message && !file) {
    return res.status(400).json({ error: { message: 'message or file is required' } });
  }

  let context = {};
  let history = [];
  try { context = JSON.parse(req.body.context || '{}'); } catch {}
  try { history = JSON.parse(req.body.history || '[]'); } catch {}

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // RAG context
  const ragQuery   = message || (file ? `file: ${file.originalname}` : '');
  const helpContext = await rag.retrieve(ragQuery);
  const systemPrompt = buildSystemPrompt(context, helpContext);

  // Build the user content array (text + optional file block)
  const userContent = [];

  if (message) {
    userContent.push({ type: 'text', text: message });
  }

  if (file) {
    const isImage = file.mimetype.startsWith('image/');
    if (isImage) {
      // Vision content block
      userContent.push({
        type: 'image',
        source: {
          type:       'base64',
          media_type: file.mimetype,
          data:       file.buffer.toString('base64'),
        },
      });
      // Caption so Claude knows the filename
      userContent.push({
        type: 'text',
        text: `[Image attached: ${file.originalname}]\nPlease analyse this image, extract all relevant data fields (prices, product names, quantities, etc.), describe what you found, and ask for confirmation before creating any records.`,
      });
    } else {
      // CSV / text content block
      const textContent = file.buffer.toString('utf8');
      userContent.push({
        type: 'text',
        text: `[File attached: ${file.originalname}]\n\n${textContent}\n\nPlease analyse this file, summarise the full import plan (number of rows, fields, sample data), and ask for confirmation before creating any records.`,
      });
    }
  }

  // If the content array is just one text item, unwrap to a plain string
  // (keeps message shape compatible with history which stores strings)
  const userMessage = userContent.length === 1 && userContent[0].type === 'text'
    ? userContent[0].text
    : userContent;

  const messages = [
    ...history.slice(-20),
    { role: 'user', content: userMessage },
  ];

  const logContext = {
    ...context,
    has_file:  !!file,
    file_name: file?.originalname || null,
    file_type: file?.mimetype     || null,
  };

  const { responseText, toolsCalled, tokensIn, tokensOut, errorMsg } =
    await agenticStream({ anthropic, systemPrompt, messages, tools: TOOLS, executeTool, res });

  // Log to DB (best-effort)
  pool.query(
    `INSERT INTO mcogs_ai_chat_log (user_message, response, tools_called, context, tokens_in, tokens_out, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      message || `[file: ${file?.originalname}]`,
      responseText,
      JSON.stringify(toolsCalled),
      JSON.stringify(logContext),
      tokensIn,
      tokensOut,
      errorMsg,
    ]
  ).catch(e => console.error('[ai-upload] log error:', e.message));
});

module.exports = router;
