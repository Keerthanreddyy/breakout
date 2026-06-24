const express = require('express');
const cors    = require('cors');
const axios   = require('axios');

const app  = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

// ─── Config ────────────────────────────────────────────────────────────────
const SCAN_CONDITIONS = {
  minClose:       30,
  minPctChange:   6.5,
  minVolume:      50_000,
  minAvgVol50:    25_000,
  volMultiplier:  3,
};

// Yahoo Finance: 5 concurrent, 250ms between batches → ~1200 stocks in ~60s
const BATCH_SIZE     = 5;
const BATCH_DELAY_MS = 250;
const CACHE_TTL_MS   = 5 * 60 * 1000;  // 5 min

const cache = new Map();  // symbol -> { data, ts }

// ─── Full NSE symbol list (~1200 stocks) ────────────────────────────────────
const RAW_NSE_SYMBOLS = require('./nse_symbols.js');
const DEFAULT_SYMBOLS = RAW_NSE_SYMBOLS.map(s => s + '.NS');

// ─── Helpers ───────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runBatched(symbols) {
  const results = [];
  const errors  = [];
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch   = symbols.slice(i, i + BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(fetchYahooQuote));
    settled.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        const q     = r.value;
        const conds = applyConditions(q);
        results.push({ ...q, conditions: conds, pass: Object.values(conds).every(Boolean) });
      } else {
        errors.push({ symbol: batch[idx], error: r.reason?.message });
      }
    });
    if (i + BATCH_SIZE < symbols.length) await sleep(BATCH_DELAY_MS);
  }
  return { results, errors };
}

async function fetchYahooQuote(symbol) {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.data;

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
  const { data } = await axios.get(url, {
    params: { interval: '1d', range: '3mo', includePrePost: false },
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; breakout-scanner/1.0)' },
    timeout: 8000,
  });

  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const meta        = result.meta;
  const closes      = result.indicators?.quote?.[0]?.close  ?? [];
  const vols        = result.indicators?.quote?.[0]?.volume ?? [];
  const cleanCloses = closes.filter(Boolean);
  const cleanVols   = vols.filter(v => v != null && v > 0);

  const currentClose = meta.regularMarketPrice ?? cleanCloses.at(-1);
  const prevClose    = meta.chartPreviousClose  ?? cleanCloses.at(-2);
  const currentVol   = meta.regularMarketVolume ?? cleanVols.at(-1);

  const last50vols   = cleanVols.slice(-50);
  const avgVol50     = last50vols.length
    ? Math.round(last50vols.reduce((a, b) => a + b, 0) / last50vols.length)
    : 0;

  const pctChange = prevClose ? ((currentClose - prevClose) / prevClose) * 100 : 0;

  const out = {
    symbol:     symbol.replace('.NS', '').replace('.BO', ''),
    fullSymbol: symbol,
    close:      currentClose,
    prevClose,
    pctChange:  parseFloat(pctChange.toFixed(2)),
    volume:     currentVol,
    avgVol50,
    volRatio:   avgVol50 > 0 ? parseFloat((currentVol / avgVol50).toFixed(2)) : 0,
    name:       meta.longName || meta.shortName || symbol,
    currency:   meta.currency || 'INR',
    exchange:   meta.exchangeName || 'NSE',
  };

  cache.set(symbol, { data: out, ts: Date.now() });
  return out;
}

function applyConditions(q) {
  const C = SCAN_CONDITIONS;
  return {
    c1_volSurge:  q.volume   > q.avgVol50 * C.volMultiplier,
    c2_minClose:  q.close    > C.minClose,
    c3_pctChange: q.pctChange >= C.minPctChange,
    c4_avgVol:    q.avgVol50 >= C.minAvgVol50,
    c5_minVol:    q.volume   > C.minVolume,
  };
}

// ─── Routes ────────────────────────────────────────────────────────────────

// GET /api/scan  — scan full NSE list or ?symbols=A,B,C
app.get('/api/scan', async (req, res) => {
  const symbols = req.query.symbols
    ? req.query.symbols.split(',').map(s => s.trim().toUpperCase() + '.NS')
    : DEFAULT_SYMBOLS;

  const { results, errors } = await runBatched(symbols);
  res.json({
    scannedAt:  new Date().toISOString(),
    total:      results.length,
    passed:     results.filter(r => r.pass).length,
    results:    results.sort((a, b) => b.pctChange - a.pctChange),
    errors,
    conditions: SCAN_CONDITIONS,
  });
});

// POST /api/scan/custom  — body: { symbols: ["RELIANCE", ...] }
app.post('/api/scan/custom', async (req, res) => {
  const raw = req.body.symbols;
  if (!Array.isArray(raw) || !raw.length)
    return res.status(400).json({ error: 'Provide a symbols array' });

  const symbols = raw.map(s => {
    const u = s.trim().toUpperCase();
    return u.endsWith('.NS') || u.endsWith('.BO') ? u : u + '.NS';
  });

  const { results, errors } = await runBatched(symbols);
  res.json({
    scannedAt: new Date().toISOString(),
    total:     results.length,
    passed:    results.filter(r => r.pass).length,
    results:   results.sort((a, b) => b.pctChange - a.pctChange),
    errors,
  });
});

// GET /api/quote/:symbol
app.get('/api/quote/:symbol', async (req, res) => {
  const sym  = req.params.symbol.toUpperCase();
  const full = sym.endsWith('.NS') || sym.endsWith('.BO') ? sym : sym + '.NS';
  try {
    const quote = await fetchYahooQuote(full);
    const conds = applyConditions(quote);
    res.json({ ...quote, conditions: conds, pass: Object.values(conds).every(Boolean) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cache/clear
app.get('/api/cache/clear', (_, res) => {
  cache.clear();
  res.json({ ok: true, message: 'Cache cleared' });
});

// GET /api/conditions
app.get('/api/conditions', (_, res) => res.json(SCAN_CONDITIONS));

// GET /api/status
app.get('/api/status', (_, res) => res.json({
  totalSymbols: DEFAULT_SYMBOLS.length,
  cacheSize:    cache.size,
  batchSize:    BATCH_SIZE,
  batchDelayMs: BATCH_DELAY_MS,
  estimatedScanSeconds: Math.ceil((DEFAULT_SYMBOLS.length / BATCH_SIZE) * BATCH_DELAY_MS / 1000),
}));

app.listen(PORT, () => {
  const est = Math.ceil((DEFAULT_SYMBOLS.length / BATCH_SIZE) * BATCH_DELAY_MS / 1000);
  console.log(`\n✅  Breakout Scanner backend  →  http://localhost:${PORT}`);
  console.log(`    Scanning ${DEFAULT_SYMBOLS.length} NSE stocks`);
  console.log(`    Batch: ${BATCH_SIZE} concurrent · ${BATCH_DELAY_MS}ms delay`);
  console.log(`    Estimated full scan time: ~${est}s (cached: ~${Math.ceil(est*0.1)}s)\n`);
});
