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
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
