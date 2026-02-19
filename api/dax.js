// ═══════════════════════════════════════════════════════════════
// DAX40 API — Serverless Dukascopy Wrapper
// Déployé sur Vercel, appelé par n8n Cloud
//
// Endpoints:
//   GET /api/dax?date=2026-02-19          → M1 bougies du jour (batch soir)
//   GET /api/dax?date=2026-02-19&tf=m5    → M5 bougies du jour
//   GET /api/dax?live=true                → dernière bougie M1 (live intraday)
//   GET /api/dax?ping=true                → health check
//
// Sécurité: header x-api-key obligatoire (configuré dans Vercel env vars)
// ═══════════════════════════════════════════════════════════════

const { getHistoricalRates } = require('dukascopy-node');

// ── Config ──
const INSTRUMENT = 'deuidxeur';  // DAX40 CFD chez Dukascopy
const PRICE_TYPE = 'bid';
const SESSION_START_H = 8;       // 08:00 UTC = 09:00 CET (hiver)
const SESSION_END_H = 16;        // 16:00 UTC = 17:00 CET (fin de session +1h marge)

module.exports = async (req, res) => {
  try {
    // ── Sécurité ──
    const apiKey = process.env.DAX_API_KEY || '';
    if (apiKey) {
      const provided = req.headers['x-api-key'] || req.query.key || '';
      if (provided !== apiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
    }

    // ── Health check ──
    if (req.query.ping) {
      return res.status(200).json({
        status: 'ok',
        instrument: INSTRUMENT,
        timestamp: new Date().toISOString()
      });
    }

    // ── Live mode (dernière bougie) ──
    if (req.query.live === 'true') {
      const now = new Date();
      // Chercher les 10 dernières minutes
      const from = new Date(now.getTime() - 10 * 60 * 1000);

      const data = await getHistoricalRates({
        instrument: INSTRUMENT,
        dates: { from, to: now },
        timeframe: 'm1',
        priceType: PRICE_TYPE,
        format: 'json',
        volumes: true,
        retryCount: 3,
        pauseBetweenRetriesMs: 500
      });

      if (!data || data.length === 0) {
        return res.status(200).json({
          status: 'no_data',
          message: 'Marché probablement fermé',
          timestamp: now.toISOString()
        });
      }

      // Dernière bougie
      const last = data[data.length - 1];
      return res.status(200).json({
        status: 'ok',
        mode: 'live',
        candle: {
          timestamp: new Date(last.timestamp).toISOString(),
          open: last.open,
          high: last.high,
          low: last.low,
          close: last.close,
          volume: last.volume || 0
        },
        n_candles: data.length,
        fetched_at: now.toISOString()
      });
    }

    // ── Batch mode (journée complète) ──
    const dateStr = req.query.date;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({
        error: 'Paramètre date requis (format YYYY-MM-DD)',
        example: '/api/dax?date=2026-02-19'
      });
    }

    // Timeframe (défaut: m1)
    const tf = req.query.tf || 'm1';
    const validTf = ['m1', 'm5', 'm15', 'm30', 'h1'];
    if (!validTf.includes(tf)) {
      return res.status(400).json({
        error: `Timeframe invalide. Valeurs: ${validTf.join(', ')}`
      });
    }

    // Construire les dates de session (08:00 - 16:00 UTC)
    const from = new Date(`${dateStr}T${String(SESSION_START_H).padStart(2, '0')}:00:00.000Z`);
    const to = new Date(`${dateStr}T${String(SESSION_END_H).padStart(2, '0')}:00:00.000Z`);

    // Vérifier que la date n'est pas dans le futur
    const now = new Date();
    if (from > now) {
      return res.status(400).json({
        error: 'Date dans le futur',
        date: dateStr
      });
    }

    // Fetch via dukascopy-node
    const data = await getHistoricalRates({
      instrument: INSTRUMENT,
      dates: { from, to },
      timeframe: tf,
      priceType: PRICE_TYPE,
      format: 'json',
      volumes: true,
      retryCount: 3,
      pauseBetweenRetriesMs: 500,
      batchSize: 10
    });

    if (!data || data.length === 0) {
      return res.status(200).json({
        status: 'no_data',
        message: `Aucune bougie pour ${dateStr} (jour férié ou weekend ?)`,
        date: dateStr,
        timeframe: tf
      });
    }

    // Formater les bougies
    const candles = data.map(c => ({
      timestamp: new Date(c.timestamp).toISOString(),
      hour: new Date(c.timestamp).getUTCHours(),
      minute: new Date(c.timestamp).getUTCMinutes(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));

    // Stats rapides
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const dayHigh = Math.max(...highs);
    const dayLow = Math.min(...lows);

    return res.status(200).json({
      status: 'ok',
      date: dateStr,
      timeframe: tf,
      instrument: INSTRUMENT,
      price_type: PRICE_TYPE,
      session: `${SESSION_START_H}:00-${SESSION_END_H}:00 UTC`,
      n_candles: candles.length,
      summary: {
        open: candles[0].open,
        high: dayHigh,
        low: dayLow,
        close: candles[candles.length - 1].close,
        range: Math.round((dayHigh - dayLow) * 10) / 10
      },
      candles
    });

  } catch (err) {
    console.error('DAX API Error:', err);
    return res.status(500).json({
      error: 'Erreur interne',
      message: err.message || String(err)
    });
  }
};
