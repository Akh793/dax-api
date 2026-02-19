// ═══════════════════════════════════════════════════════════════
// DAX40 API — Serverless Dukascopy Wrapper
// Déployé sur Vercel, appelé par n8n Cloud
//
// Endpoints:
//   GET /api/dax?date=2026-02-19              → M1 bougies du jour (batch soir)
//   GET /api/dax?date=2026-02-19&days=10      → M1 bougies sur 10 jours
//   GET /api/dax?date=2026-02-19&tf=m5        → M5 bougies du jour
//   GET /api/dax?live=true                    → dernière bougie M1 (live intraday)
//   GET /api/dax?ping=true                    → health check
//
// Sécurité: header x-api-key ou query param key obligatoire
// ═══════════════════════════════════════════════════════════════

const { getHistoricalRates } = require('dukascopy-node');

// ── Config ──
const INSTRUMENT = 'deuidxeur';  // DAX40 CFD chez Dukascopy
const PRICE_TYPE = 'bid';
const SESSION_START_H = 8;       // 08:00 UTC = 09:00 CET (hiver)
const SESSION_END_H = 16;        // 16:00 UTC = 17:00 CET

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

      const last = data[data.length - 1];
      return res.status(200).json({
        status: 'ok',
        mode: 'live',
        candle: {
          timestamp: new Date(last.timestamp).toISOString(),
          hour: new Date(last.timestamp).getUTCHours(),
          minute: new Date(last.timestamp).getUTCMinutes(),
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

    // ── Batch mode (journée complète ou multi-jours) ──
    const dateStr = req.query.date;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return res.status(400).json({
        error: 'Paramètre date requis (format YYYY-MM-DD)',
        example: '/api/dax?date=2026-02-19'
      });
    }

    const tf = req.query.tf || 'm1';
    const validTf = ['m1', 'm5', 'm15', 'm30', 'h1'];
    if (!validTf.includes(tf)) {
      return res.status(400).json({
        error: `Timeframe invalide. Valeurs: ${validTf.join(', ')}`
      });
    }

    // Nombre de jours (défaut: 1, max: 15)
    const days = Math.min(parseInt(req.query.days) || 1, 15);

    // Calculer les dates de trading (reculer en sautant weekends)
    const tradingDates = [];
    let d = new Date(dateStr + 'T00:00:00Z');
    while (tradingDates.length < days) {
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6) {
        tradingDates.push(new Date(d));
      }
      d.setUTCDate(d.getUTCDate() - 1);
    }
    tradingDates.reverse();

    // Vérifier que la date n'est pas dans le futur
    const now = new Date();
    const firstFrom = new Date(`${dateStr}T${String(SESSION_START_H).padStart(2, '0')}:00:00.000Z`);
    if (firstFrom > now) {
      return res.status(400).json({ error: 'Date dans le futur', date: dateStr });
    }

    // Fetch chaque jour
    const allCandles = [];
    const dailySummaries = [];

    for (const td of tradingDates) {
      const ds = td.toISOString().slice(0, 10);
      const from = new Date(`${ds}T${String(SESSION_START_H).padStart(2, '0')}:00:00.000Z`);
      const to = new Date(`${ds}T${String(SESSION_END_H).padStart(2, '0')}:00:00.000Z`);

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

      const candles = (data || []).map(c => ({
        timestamp: new Date(c.timestamp).toISOString(),
        date: ds,
        hour: new Date(c.timestamp).getUTCHours(),
        minute: new Date(c.timestamp).getUTCMinutes(),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0
      }));

      allCandles.push(...candles);

      if (candles.length > 0) {
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        dailySummaries.push({
          date: ds,
          open: candles[0].open,
          high: Math.max(...highs),
          low: Math.min(...lows),
          close: candles[candles.length - 1].close,
          range: Math.round((Math.max(...highs) - Math.min(...lows)) * 10) / 10,
          n_candles: candles.length
        });
      }
    }

    if (allCandles.length === 0) {
      return res.status(200).json({
        status: 'no_data',
        message: 'Aucune bougie (jour férié ou weekend ?)',
        date: dateStr,
        days: days,
        timeframe: tf
      });
    }

    const allHighs = allCandles.map(c => c.high);
    const allLows = allCandles.map(c => c.low);

    return res.status(200).json({
      status: 'ok',
      date: dateStr,
      days: days,
      timeframe: tf,
      instrument: INSTRUMENT,
      price_type: PRICE_TYPE,
      session: `${SESSION_START_H}:00-${SESSION_END_H}:00 UTC`,
      n_candles: allCandles.length,
      n_trading_days: dailySummaries.length,
      summary: {
        open: allCandles[0].open,
        high: Math.max(...allHighs),
        low: Math.min(...allLows),
        close: allCandles[allCandles.length - 1].close,
        range: Math.round((Math.max(...allHighs) - Math.min(...allLows)) * 10) / 10
      },
      daily_summaries: dailySummaries,
      candles: allCandles
    });

  } catch (err) {
    console.error('DAX API Error:', err);
    return res.status(500).json({
      error: 'Erreur interne',
      message: err.message || String(err)
    });
  }
};
