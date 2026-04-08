// =============================================================================
// RAG helper — loads claude.md + docs/user-guide.md at startup, embeds each
// section (split on ## headings) via Voyage AI, retrieves top-k relevant
// chunks per user query. Falls back to keyword search if VOYAGE_API_KEY is
// not set. Add more markdown sources in SOURCE_FILES below.
// =============================================================================

const fs       = require('fs');
const path     = require('path');
const aiConfig = require('./aiConfig');

// In-memory store (populated at startup)
const _chunks   = [];  // [{ key, text, vector }]
let   _ready    = false;

// ── Source files to index ─────────────────────────────────────────────────────
// All files are split by ## headings into individual chunks.
// Add paths here to extend the RAG knowledge base.

const SOURCE_FILES = [
  path.join(__dirname, '..', '..', '..', 'claude.md'),        // Technical/developer docs
  path.join(__dirname, '..', '..', '..', 'docs', 'user-guide.md'), // User tutorials & workflows
];

// ── Load & split markdown files into sections ──────────────────────────────────

function _parseMd(content, fileLabel) {
  const sections = [];
  let current = null;
  for (const line of content.split('\n')) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { key: `[${fileLabel}] ${line.replace(/^##\s+/, '').trim()}`, lines: [line] };
    } else if (line.startsWith('# ') && !current) {
      current = { key: `[${fileLabel}] ${line.replace(/^#\s+/, '').trim()}`, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections.map(s => ({ key: s.key, text: s.lines.join('\n').trim() }));
}

function _loadChunks() {
  const all = [];
  for (const mdPath of SOURCE_FILES) {
    if (!fs.existsSync(mdPath)) continue;
    const content  = fs.readFileSync(mdPath, 'utf8');
    const label    = path.basename(mdPath, '.md'); // e.g. 'claude' or 'user-guide'
    const sections = _parseMd(content, label);
    all.push(...sections);
  }
  return all;
}

// ── Voyage AI embedding ────────────────────────────────────────────────────────

async function _voyageEmbed(texts) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${aiConfig.get('VOYAGE_API_KEY')}`,
    },
    body: JSON.stringify({ model: 'voyage-3-lite', input: texts }),
  });
  if (!res.ok) throw new Error(`Voyage AI error: ${res.status}`);
  const data = await res.json();
  return data.data.map(d => d.embedding);
}

// ── Cosine similarity ──────────────────────────────────────────────────────────

function _cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na  += a[i] * a[i];
    nb  += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// ── Keyword fallback ──────────────────────────────────────────────────────────

function _keywordSearch(query, k) {
  const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return _chunks
    .map(c => ({
      ...c,
      score: words.reduce((s, w) => s + (c.text.toLowerCase().includes(w) ? 1 : 0), 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(c => c.text);
}

// ── Public API ────────────────────────────────────────────────────────────────

async function init() {
  const raw = _loadChunks();
  if (!raw.length) { console.log('[rag] No source files found — RAG disabled'); return; }

  if (!aiConfig.get('VOYAGE_API_KEY')) {
    for (const c of raw) _chunks.push({ key: c.key, text: c.text, vector: null });
    _ready = true;
    console.log(`[rag] Loaded ${_chunks.length} sections from ${SOURCE_FILES.length} file(s) (keyword fallback — no VOYAGE_API_KEY)`);
    return;
  }

  try {
    // Embed in batches of 20
    const BATCH = 20;
    for (let i = 0; i < raw.length; i += BATCH) {
      const batch  = raw.slice(i, i + BATCH);
      const vecs   = await _voyageEmbed(batch.map(c => c.text));
      batch.forEach((c, j) => _chunks.push({ key: c.key, text: c.text, vector: vecs[j] }));
    }
    _ready = true;
    console.log(`[rag] Embedded ${_chunks.length} sections from ${SOURCE_FILES.length} file(s) via Voyage AI`);
  } catch (err) {
    for (const c of raw) _chunks.push({ key: c.key, text: c.text, vector: null });
    _ready = true;
    console.warn('[rag] Voyage AI embedding failed, falling back to keyword search:', err.message);
  }
}

async function retrieve(query, k = 4) {
  if (!_chunks.length) return '';
  if (!aiConfig.get('VOYAGE_API_KEY') || _chunks[0].vector === null) {
    return _keywordSearch(query, k).join('\n\n---\n\n');
  }
  try {
    const [qVec] = await _voyageEmbed([query]);
    const scored = _chunks.map(c => ({ text: c.text, score: _cosineSim(qVec, c.vector) }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(c => c.text).join('\n\n---\n\n');
  } catch {
    return _keywordSearch(query, k).join('\n\n---\n\n');
  }
}

module.exports = { init, retrieve, isReady: () => _ready };
