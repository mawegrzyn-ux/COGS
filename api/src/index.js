require('dotenv').config();

const path         = require('path');
const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');

const pool         = require('./db/pool');
const aiConfig     = require('./helpers/aiConfig');
const rag          = require('./helpers/rag');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Language', 'X-Internal-Service'],
  exposedHeaders: ['Content-Language'],
  credentials: true,
}));
// Rate limit — split by auth state. Unauthenticated requests are still
// throttled tightly (brute-force / scraping), but authenticated users get a
// much higher cap because dashboards + benchmarks legitimately fire 100s of
// requests in normal use. Brute-force on auth itself is handled by Auth0.
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => (req.headers.authorization?.startsWith('Bearer ') ? 10000 : 500),
  standardHeaders: true,
  legacyHeaders: false,
  // Internal service-to-service calls (Pepper tool executor, etc.) bypass
  // entirely — they already authenticate via INTERNAL_SERVICE_KEY.
  skip: (req) => req.headers['x-internal-service'] != null,
}));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Vary: X-Language on every response — prevents CDN/proxy caches from
// serving a French response to an English user (and vice versa).
app.use((_req, res, next) => {
  res.append('Vary', 'X-Language');
  next();
});

// Note: local uploads are served via GET /api/media/file/:filename route
// (in api/src/routes/media.js) so they flow through the /api Nginx proxy.
// No separate static file serving or additional Nginx location is needed.

// =============================================================================
// Startup sequence
// 1. Bootstrap the local config store (creates schema, seeds from .env)
// 2. Open the main DB pool using config-store values (or .env fallback)
// 3. Load AI keys from the config store into the runtime key cache
// 4. Register routes + error handlers
// 5. Start listening
// Each step is awaited so a failure in any step aborts startup with a clear
// error rather than leaving the API half-wired.
// =============================================================================
(async () => {
  try {
    await pool.ensureReady();

    await aiConfig.init();
    rag.init().catch(err => console.error('[startup] rag init error:', err.message));

    const routes       = require('./routes');
    const errorHandler = require('./middleware/errorHandler');
    const notFound     = require('./middleware/notFound');

    app.use('/api', routes);
    app.use(notFound);
    app.use(errorHandler);

    app.listen(PORT, '127.0.0.1', () => {
      console.log(`[api] Menu COGS API running on port ${PORT} (${process.env.NODE_ENV})`);

      // ── Nightly memory consolidation — 02:07 UTC daily ──────────────────────
      try {
        const cron = require('node-cron');
        const { runConsolidation } = require('./jobs/consolidateMemory');
        cron.schedule('7 2 * * *', async () => {
          console.log('[cron] Starting memory consolidation...');
          try {
            const result = await runConsolidation();
            console.log('[cron] Memory consolidation complete:', JSON.stringify(result));
          } catch (err) {
            console.error('[cron] Memory consolidation failed:', err.message);
          }
        }, { timezone: 'UTC' });
        console.log('[cron] Memory consolidation scheduled at 02:07 UTC daily');

        // ── Nightly translation pre-warm — 02:15 UTC daily ─────────────────
        try {
          const { runTranslation } = require('./jobs/translateEntities');
          cron.schedule('15 2 * * *', async () => {
            console.log('[cron] Starting entity translation pre-warm...');
            try {
              const result = await runTranslation();
              console.log('[cron] Translation pre-warm complete:', JSON.stringify(result));
            } catch (err) {
              console.error('[cron] Translation pre-warm failed:', err.message);
            }
          }, { timezone: 'UTC' });
          console.log('[cron] Translation pre-warm scheduled at 02:15 UTC daily');
        } catch (err) {
          console.warn('[cron] Translation pre-warm disabled:', err.message);
        }

        // ── Jira pull-sync — every 15 minutes ───────────────────────────────
        // Fetches status/priority/summary/description/labels for every linked
        // bug + backlog row. No-op when Jira isn't configured. Logs only on
        // changes or errors so healthy cycles don't spam the log.
        try {
          const { runJiraSync } = require('./jobs/syncJira');
          cron.schedule('*/15 * * * *', async () => {
            try {
              const result = await runJiraSync();
              if (result?.error) {
                console.log('[cron] Jira sync skipped:', result.error);
              } else if (result?.changedCount > 0 || (result?.errors?.length ?? 0) > 0) {
                console.log(`[cron] Jira sync: pulled ${result.pulled}, changed ${result.changedCount}, errors ${result.errors.length}`);
              }
            } catch (err) {
              console.error('[cron] Jira sync failed:', err.message);
            }
          }, { timezone: 'UTC' });
          console.log('[cron] Jira sync scheduled every 15 minutes');
        } catch (err) {
          console.warn('[cron] Jira sync disabled:', err.message);
        }
      } catch (err) {
        console.warn('[cron] node-cron not available — memory consolidation disabled:', err.message);
      }
    });
  } catch (err) {
    console.error('[startup] Fatal error:', err.message);
    process.exit(1);
  }
})();

module.exports = app;
