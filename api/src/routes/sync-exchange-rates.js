const router = require('express').Router();
const pool   = require('../db/pool');
const https  = require('https');

function fetchRates(base = 'USD') {
  return new Promise((resolve, reject) => {
    const url = `https://api.frankfurter.app/latest?base=${base}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// POST /api/sync-exchange-rates
router.post('/', async (req, res, next) => {
  try {
    // Read base currency from settings
    let baseCurrency = 'USD';
    try {
      const { rows } = await pool.query(`SELECT data FROM mcogs_settings WHERE id = 1`);
      baseCurrency = rows[0]?.data?.base_currency?.code || 'USD';
    } catch {
      // settings table may not exist yet — fall back to USD
    }

    const ratesData = await fetchRates(baseCurrency);
    // Include the base currency itself at rate 1
    const rates = { [baseCurrency]: 1, ...ratesData.rates };

    const { rows: countries } = await pool.query(
      `SELECT id, currency_code FROM mcogs_countries`
    );

    const results = [];
    const client  = await pool.connect();

    try {
      await client.query('BEGIN');
      for (const country of countries) {
        const rate = rates[country.currency_code];
        if (rate !== undefined) {
          await client.query(
            `UPDATE mcogs_countries SET exchange_rate=$1, updated_at=NOW() WHERE id=$2`,
            [rate, country.id]
          );
          results.push({ currency_code: country.currency_code, rate });
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      synced_at: new Date().toISOString(),
      base:      baseCurrency,
      updated:   results,
    });
  } catch (err) { next(err); }
});

module.exports = router;
