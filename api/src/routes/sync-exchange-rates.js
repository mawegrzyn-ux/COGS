const router = require('express').Router();
const pool   = require('../db/pool');

async function fetchRates(base = 'USD') {
  const url = `https://api.frankfurter.dev/v1/latest?base=${base}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Frankfurter API error: ${res.status} ${res.statusText}`);
  return res.json();
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
