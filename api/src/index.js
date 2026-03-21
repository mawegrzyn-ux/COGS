require('dotenv').config();

// Initialise RAG (non-blocking — runs in background after startup)
require('./helpers/rag').init().catch(err => console.error('[rag] init error:', err.message));

const express      = require('express');
const helmet       = require('helmet');
const cors         = require('cors');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const routes       = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const notFound     = require('./middleware/notFound');

const app  = express()
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

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[api] Menu COGS API running on port ${PORT} (${process.env.NODE_ENV})`);
});

module.exports = app;
