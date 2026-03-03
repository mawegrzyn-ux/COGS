const router = require('express').Router();
const pool   = require('../db/pool');
const https  = require('https');

function fetchRates(base = 'EUR') {
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
    // Fetch latest rates from Frankfurter (base EUR)
    const ratesData = await fetchRates('EUR');
    const rates = { EUR: 1, ...ratesData.rates };

    // Get all countries
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
      base:      'EUR',
      updated:   results,
    });
  } catch (err) { next(err); }
});

module.exports = router;
