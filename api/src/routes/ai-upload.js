// =============================================================================
// COGS AI Upload — multipart SSE endpoint for file-assisted AI interactions
// POST /api/ai-upload
//
// Accepted file types:
//   Text/data : text/csv, text/plain
//   Images    : image/png, image/jpeg, image/webp
//   Office    : .xlsx, .xls  (parsed to CSV via xlsx / SheetJS)
//               .docx        (extracted to plain text via mammoth)
//               .pptx        (slide text extracted from embedded XML)
//
// All Office files are converted to text before being sent to Claude —
// Claude never receives raw binary Office bytes.
// =============================================================================

const router   = require('express').Router();
const multer   = require('multer');
const mammoth  = require('mammoth');
const XLSX     = require('xlsx');
const JSZip    = require('jszip');
const Anthropic = require('@anthropic-ai/sdk');
const pool     = require('../db/pool');
const rag      = require('../helpers/rag');
const aiConfig = require('../helpers/aiConfig');
const { agenticStream }                        = require('../helpers/agenticStream');
const { TOOLS, executeTool, buildSystemPrompt } = require('./ai-chat');

// ── MIME type map ─────────────────────────────────────────────────────────────

const MIME_INFO = {
  // Plain text / CSV  — pass directly as UTF-8 string
  'text/csv':   { kind: 'text' },
  'text/plain': { kind: 'text' },

  // Images — base64 vision block
  'image/png':  { kind: 'image' },
  'image/jpeg': { kind: 'image' },
  'image/webp': { kind: 'image' },

  // PDF — native Claude document block (no extraction needed; Claude reads layout, tables, images)
  'application/pdf': { kind: 'pdf' },

  // Office spreadsheets — parse with SheetJS
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'xlsx' },  // .xlsx
  'application/vnd.ms-excel':                                          { kind: 'xlsx' },  // .xls
  'application/vnd.ms-excel.sheet.binary.macroenabled.12':             { kind: 'xlsx' },  // .xlsb
  'application/vnd.ms-excel.sheet.macroenabled.12':                    { kind: 'xlsx' },  // .xlsm

  // Word — parse with mammoth
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'docx' }, // .docx

  // PowerPoint — extract slide text from XML
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'pptx' }, // .pptx
};

const ALLOWED_MIMES = new Set(Object.keys(MIME_INFO));

// ── multer ────────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 10 * 1024 * 1024 }, // 10 MB — larger for Office files
  fileFilter: (_req, file, cb) => {
    // multer sometimes sends 'application/octet-stream' for unknown extensions.
    // Fall back to extension matching for common Office types.
    const mime = file.mimetype;
    const name = (file.originalname || '').toLowerCase();
    const byExt =
      name.endsWith('.pdf')  ||
      name.endsWith('.xlsx') || name.endsWith('.xls') ||
      name.endsWith('.xlsb') || name.endsWith('.xlsm') ||
      name.endsWith('.docx') || name.endsWith('.pptx');

    if (ALLOWED_MIMES.has(mime) || (mime === 'application/octet-stream' && byExt)) {
      cb(null, true);
    } else {
      cb(new Error(
        `Unsupported file type: ${mime} (${file.originalname}). ` +
        'Accepted: CSV, TXT, PNG, JPG, WebP, PDF, XLSX, XLS, DOCX, PPTX.'
      ));
    }
  },
});

// ── Office parsers ────────────────────────────────────────────────────────────

// Excel / .xlsx / .xls → CSV text (all sheets, separated by sheet name headers)
function parseXlsx(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const parts = [];
  for (const sheetName of wb.SheetNames) {
    const ws  = wb.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    if (csv.trim()) {
      parts.push(`### Sheet: ${sheetName}\n${csv}`);
    }
  }
  return parts.length
    ? `[Excel file: ${filename}]\n\n${parts.join('\n\n')}`
    : `[Excel file: ${filename} — no data found]`;
}

// Word / .docx → plain text via mammoth
async function parseDocx(buffer, filename) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value?.trim()
    ? `[Word document: ${filename}]\n\n${value.trim()}`
    : `[Word document: ${filename} — no text content found]`;
}

// PowerPoint / .pptx → extract text from slide XML inside the ZIP
async function parsePptx(buffer, filename) {
  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return `[PowerPoint: ${filename} — could not read file]`;
  }

  // Slide files are at ppt/slides/slide1.xml, slide2.xml, ...
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => {
      const numA = parseInt((a.match(/\d+/) || ['0'])[0], 10);
      const numB = parseInt((b.match(/\d+/) || ['0'])[0], 10);
      return numA - numB;
    });

  if (!slideFiles.length) {
    return `[PowerPoint: ${filename} — no slides found]`;
  }

  const slideTexts = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const xml = await zip.files[slideFiles[i]].async('string');
    // Extract text runs (<a:t>…</a:t>) from slide XML
    const matches = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(m => m[1]);
    const text = matches.filter(t => t.trim()).join(' ');
    if (text) slideTexts.push(`Slide ${i + 1}: ${text}`);
  }

  return slideTexts.length
    ? `[PowerPoint: ${filename}]\n\n${slideTexts.join('\n')}`
    : `[PowerPoint: ${filename} — slides contain no text]`;
}

// ── Resolve kind from MIME or file extension ──────────────────────────────────

function resolveKind(mime, filename) {
  if (MIME_INFO[mime]) return MIME_INFO[mime].kind;
  // Fallback for application/octet-stream or misidentified MIME
  const name = (filename || '').toLowerCase();
  if (name.endsWith('.pdf'))  return 'pdf';
  if (name.endsWith('.xlsx') || name.endsWith('.xls') ||
      name.endsWith('.xlsb') || name.endsWith('.xlsm')) return 'xlsx';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.pptx')) return 'pptx';
  if (name.endsWith('.csv'))  return 'text';
  if (name.endsWith('.txt'))  return 'text';
  return 'text'; // best-effort fallback
}

// ── Anthropic client ──────────────────────────────────────────────────────────

function getClient() {
  const key = aiConfig.get('ANTHROPIC_API_KEY');
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

// ── POST /ai-upload ───────────────────────────────────────────────────────────

router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: { message: err.message || 'File upload error' } });
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

  if (!message && !file) {
    return res.status(400).json({ error: { message: 'message or file is required' } });
  }

  let context = {};
  let history = [];
  try { context = JSON.parse(req.body.context || '{}'); } catch {}
  try { history = JSON.parse(req.body.history || '[]'); } catch {}
  const sessionId  = req.body.sessionId  || null;
  const userEmail  = req.body.userEmail  || null;
  const userSub    = req.body.userSub    || null;

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // RAG context
  const ragQuery    = message || (file ? `file: ${file.originalname}` : '');
  const helpContext = await rag.retrieve(ragQuery);
  const systemPrompt = buildSystemPrompt(context, helpContext);

  // Build the user content array
  const userContent = [];
  if (message) {
    userContent.push({ type: 'text', text: message });
  }

  if (file) {
    const kind = resolveKind(file.mimetype, file.originalname);

    if (kind === 'image') {
      // Vision block
      userContent.push({
        type: 'image',
        source: {
          type:       'base64',
          media_type: file.mimetype,
          data:       file.buffer.toString('base64'),
        },
      });
      userContent.push({
        type: 'text',
        text: `[Image attached: ${file.originalname}]\nPlease analyse this image, extract all relevant data fields (prices, product names, quantities, etc.), describe what you found, and ask for confirmation before creating any records.`,
      });

    } else if (kind === 'pdf') {
      // Native PDF document block — Claude reads layout, tables, images, scanned text
      userContent.push({
        type: 'document',
        source: {
          type:       'base64',
          media_type: 'application/pdf',
          data:       file.buffer.toString('base64'),
        },
      });
      userContent.push({
        type: 'text',
        text: `[PDF attached: ${file.originalname}]\nPlease read this document carefully. Extract any relevant structured data (ingredients, prices, recipes, supplier info, etc.), summarise what you found, and ask for confirmation before creating any records.`,
      });

    } else if (kind === 'xlsx') {
      const csvText = parseXlsx(file.buffer, file.originalname);
      userContent.push({
        type: 'text',
        text: `${csvText}\n\nPlease analyse this spreadsheet, summarise the full import plan (number of rows, columns, sample data), and ask for confirmation before creating any records.`,
      });

    } else if (kind === 'docx') {
      const docText = await parseDocx(file.buffer, file.originalname);
      userContent.push({
        type: 'text',
        text: `${docText}\n\nPlease summarise this document and identify any structured data (ingredients, prices, recipes, etc.) you can extract. Ask for confirmation before creating any records.`,
      });

    } else if (kind === 'pptx') {
      const pptText = await parsePptx(file.buffer, file.originalname);
      userContent.push({
        type: 'text',
        text: `${pptText}\n\nPlease summarise these slides and identify any structured data you can extract. Ask for confirmation before creating any records.`,
      });

    } else {
      // Plain text / CSV
      const textContent = file.buffer.toString('utf8');
      userContent.push({
        type: 'text',
        text: `[File attached: ${file.originalname}]\n\n${textContent}\n\nPlease analyse this file, summarise the full import plan (number of rows, fields, sample data), and ask for confirmation before creating any records.`,
      });
    }
  }

  // Unwrap single-text arrays for history compat
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

  pool.query(
    `INSERT INTO mcogs_ai_chat_log
       (user_message, response, tools_called, context, tokens_in, tokens_out, error, user_email, user_sub, session_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      message || `[file: ${file?.originalname}]`,
      responseText,
      JSON.stringify(toolsCalled),
      JSON.stringify(logContext),
      tokensIn,
      tokensOut,
      errorMsg,
      userEmail,
      userSub,
      sessionId,
    ]
  ).catch(e => console.error('[ai-upload] log error:', e.message));
});

module.exports = router;
