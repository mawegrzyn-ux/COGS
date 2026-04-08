const { Pool } = require('pg');
require('dotenv').config();

const { buildPoolConfig, describeTarget } = require('./config');

const { mode, config } = buildPoolConfig();
const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

pool.query('SELECT NOW()')
  .then(() => console.log(`[db] PostgreSQL connected (${describeTarget({ mode, config })})`))
  .catch(err => {
    console.error(`[db] PostgreSQL connection failed (${describeTarget({ mode, config })}): ${err.message}`);
    process.exit(1);
  });

module.exports = pool;
