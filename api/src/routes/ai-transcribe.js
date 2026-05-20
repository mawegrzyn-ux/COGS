// ── POST /api/ai-transcribe ─────────────────────────────────────────────────
// Proxies an uploaded audio blob to OpenAI Whisper and returns the transcript.
// Used as the voice-input fallback for Safari/iOS where the browser's
// SpeechRecognition API isn't available. Chromium-based clients use the
// native API and never hit this endpoint.
//
// Request: multipart/form-data with field `audio` (webm/mp4/wav ≤ 25 MB),
//          optional `language` (ISO 639-1 two-letter code).
// Response: { text: string }
//
// Requires OPENAI_API_KEY in the config store. If unset, returns 503 so the
// client can fall back to "voice unavailable" rather than failing opaquely.

const router   = require('express').Router();
const multer   = require('multer');
const aiConfig = require('../helpers/aiConfig');
const { logAudit } = require('../helpers/audit');

// 25 MB — Whisper's hard cap at the time of writing.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_AUDIO_BYTES },
});

router.post('/', upload.single('audio'), async (req, res) => {
  const key = aiConfig.get('OPENAI_API_KEY');
  if (!key) {
    return res.status(503).json({
      error: { message: 'Voice transcription requires an OpenAI API key. Configure it in System → AI.' },
    });
  }

  if (!req.file) {
    return res.status(400).json({ error: { message: 'No audio uploaded (field: "audio")' } });
  }

  const lang = String(req.body?.language || '').trim().slice(0, 5) || undefined;

  // Whisper accepts multipart form data directly — we proxy the file with a
  // minimal re-wrap. `FormData` + `Blob` are native in Node 18+.
  try {
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype || 'audio/webm' });
    // Whisper requires a filename with a recognised extension — synthesise
    // one from the mimetype if the browser didn't provide something useful.
    const filename = (() => {
      const mt = req.file.mimetype || ''
      if (mt.includes('webm')) return 'voice.webm';
      if (mt.includes('mp4'))  return 'voice.mp4';
      if (mt.includes('wav'))  return 'voice.wav';
      if (mt.includes('ogg'))  return 'voice.ogg';
      return 'voice.webm';
    })();
    form.append('file',    blob, filename);
    form.append('model',   'whisper-1');
    if (lang) form.append('language', lang);
    // `text` response_format avoids the extra JSON wrapper.
    form.append('response_format', 'json');

    const upstream = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body:    form,
    });

    if (!upstream.ok) {
      const body = await upstream.text();
      console.error('[ai-transcribe] Whisper HTTP', upstream.status, body.slice(0, 500));
      return res.status(502).json({
        error: { message: `Whisper returned ${upstream.status}. Check the OpenAI API key or service status.` },
      });
    }

    const data = await upstream.json();
    const text = String(data?.text || '').trim();

    // Audit — useful for spotting abuse (runaway loops, bill-runup) without
    // storing the transcript itself.
    try {
      logAudit(null, req, {
        action:       'transcribe',
        entity_type:  'ai_voice',
        entity_id:    0,
        entity_label: 'whisper',
        context: { bytes: req.file.size, duration_sec: null, lang: lang || null, text_len: text.length },
      });
    } catch { /* audit failure is non-fatal */ }

    res.json({ text });
  } catch (err) {
    console.error('[ai-transcribe] fatal:', err.message);
    res.status(500).json({ error: { message: err.message } });
  }
});

module.exports = router;
