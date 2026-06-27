import { computeTA, rollMean } from '../../src/lib/technicals.js';

const FINMIND_ENDPOINT = 'https://api.finmindtrade.com/api/v4/data';
const YAHOO_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_QUOTE_ENDPOINT = 'https://query1.finance.yahoo.com/v7/finance/quote';

let stockInfoCache = null;

export function daysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export function yahooSymbols(code) {
  const c = String(code || '').trim();
  if (!c) return [];
  return c.endsWith('.TW') || c.endsWith('.TWO') ? [c] : [`${c}.TW`, `${c}.TWO`];
}

export function roundMaybe(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const error = new Error(`Upstream request failed with ${res.status}.`);
    error.statusCode = res.status;
    throw error;
  }
  return res.json();
}

function parseYahooChart(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const rows = timestamps
    .map((ts, index) => {
      const close = adjclose[index] ?? quote.close?.[index];
      if (close == null) return null;
      return {
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: quote.open?.[index] ?? close,
        high: quote.high?.[index] ?? close,
        low: quote.low?.[index] ?? close,
        close,
        vol: quote.volume?.[index] ?? 0,
      };
    })
    .filter(Boolean);

  return {
    symbol,
    rows,
    currency: result?.meta?.currency || null,
    exchangeName: result?.meta?.exchangeName || null,
  };
}

async function fetchYahooQuote(symbol) {
  try {
    const payload = await fetchJson(`${YAHOO_QUOTE_ENDPOINT}?symbols=${encodeURIComponent(symbol)}`);
    return payload?.quoteResponse?.result?.[0] || {};
  } catch {
    return {};
  }
}

async function yahooPrice(code) {
  let lastError = null;
  for (const symbol of yahooSymbols(code)) {
    try {
      const payload = await fetchJson(
        `${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=history&includeAdjustedClose=true`,
      );
      const parsed = parseYahooChart(payload, symbol);
      if (parsed.rows.length >= 60) {
        const quote = await fetchYahooQuote(symbol);
        return {
          ...parsed,
          name: quote.longName || quote.shortName || quote.displayName || null,
          shortName: quote.shortName || null,
          longName: quote.longName || null,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }
  const error = new Error(lastError?.message || 'Yahoo Finance did not return enough price data.');
  error.statusCode = 404;
  throw error;
}

async function finmind(dataset, id = '', start = '') {
  const params = new URLSearchParams({ dataset });
  if (id) params.set('data_id', id);
  if (start) params.set('start_date', start);
  const token = process.env.FINMIND_TOKEN || '';
  if (token) params.set('token', token);

  try {
    const payload = await fetchJson(`${FINMIND_ENDPOINT}?${params.toString()}`);
    return Array.isArray(payload?.data) ? payload.data : null;
  } catch {
    return null;
  }
}

async function stockInfo() {
  if (stockInfoCache) return stockInfoCache;
  stockInfoCache = await finmind('TaiwanStockInfo');
  return stockInfoCache || [];
}

export async function resolveTicker(query) {
  const q = String(query || '').trim();
  if (!q) return null;

  const direct = q.match(/\d{4,6}/);
  let code = direct ? direct[0] : null;
  let name = null;

  const info = await stockInfo();
  if (code) {
    const found = info.find((item) => item.stock_id === code);
    name = found?.stock_name || null;
  } else {
    const found = info.find((item) => q.includes(item.stock_name) || item.stock_name.includes(q));
    code = found?.stock_id || null;
    name = found?.stock_name || null;
  }

  return code ? { code, name } : null;
}

function institutionalCategory(name) {
  const text = String(name || '');
  if (/Foreign/i.test(text)) return 'foreign';
  if (/Investment_Trust/i.test(text)) return 'trust';
  if (/Dealer/i.test(text)) return 'dealer';
  return 'other';
}

function buildChips(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;

  const byDate = new Map();
  for (const row of rows) {
    const date = row.date;
    if (!date) continue;
    if (!byDate.has(date)) byDate.set(date, { date, foreign: 0, trust: 0, dealer: 0, total: 0 });
    const rec = byDate.get(date);
    const net = (Number(row.buy || 0) - Number(row.sell || 0)) / 1000;
    const cat = institutionalCategory(row.name);
    if (cat !== 'other') {
      rec[cat] += net;
      rec.total += net;
    }
  }

  const series = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
  const last5 = series.slice(-5);
  const sum = (key) => roundMaybe(last5.reduce((acc, row) => acc + row[key], 0), 1);
  return {
    rows: series.map((row) => ({
      ...row,
      foreign: roundMaybe(row.foreign, 1),
      trust: roundMaybe(row.trust, 1),
      dealer: roundMaybe(row.dealer, 1),
      total: roundMaybe(row.total, 1),
    })),
    fiveDay: {
      foreign: sum('foreign'),
      trust: sum('trust'),
      dealer: sum('dealer'),
      total: sum('total'),
    },
  };
}

function buildMargin(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const latest = sorted[sorted.length - 1];
  const previous = sorted[Math.max(0, sorted.length - 6)];
  const marginBal = Number(latest.MarginPurchaseTodayBalance);
  const shortBal = Number(latest.ShortSaleTodayBalance);
  const prevMarginBal = Number(previous?.MarginPurchaseTodayBalance);
  const prevShortBal = Number(previous?.ShortSaleTodayBalance);
  return {
    asOf: latest.date || null,
    marginBalance: Number.isFinite(marginBal) ? marginBal : null,
    shortBalance: Number.isFinite(shortBal) ? shortBal : null,
    marginChange5d: Number.isFinite(marginBal) && Number.isFinite(prevMarginBal) ? marginBal - prevMarginBal : null,
    shortChange5d: Number.isFinite(shortBal) && Number.isFinite(prevShortBal) ? shortBal - prevShortBal : null,
    shortMarginRatio: Number.isFinite(marginBal) && marginBal > 0 && Number.isFinite(shortBal)
      ? roundMaybe((shortBal / marginBal) * 100, 1)
      : null,
  };
}

function stateMeta(cls) {
  if (cls === 'go') return { key: 'go', label: '偏多可追蹤', tone: 'good' };
  if (cls === 'wait') return { key: 'wait', label: '趨勢偏多，等觸發', tone: 'watch' };
  if (cls === 'avoid') return { key: 'avoid', label: '弱勢觀望', tone: 'bad' };
  return { key: 'neutral', label: '中性整理', tone: 'neutral' };
}

function buildTechnical(rows) {
  const ta = computeTA(rows);
  const closes = rows.map((row) => row.close);
  const ma20 = rollMean(closes, 20);
  const ma60 = rollMean(closes, 60);
  const chart = rows.map((row, index) => ({
    date: row.date,
    close: roundMaybe(row.close),
    ma20: roundMaybe(ma20[index]),
    ma60: roundMaybe(ma60[index]),
  })).slice(-150);

  if (!ta) {
    return {
      state: stateMeta('neutral'),
      trendPass: 0,
      chart,
      tradePlan: null,
    };
  }

  return {
    state: stateMeta(ta.cls),
    trendPass: ta.trendPass,
    hasTrigger: !!ta.hasTrig,
    close: roundMaybe(ta.close),
    ma60: roundMaybe(ta.ma60),
    rsi: roundMaybe(ta.rsi, 1),
    kd: { k: roundMaybe(ta.k, 1), d: roundMaybe(ta.d, 1) },
    tradePlan: ta.tradePlan
      ? {
          entryLow: roundMaybe(ta.tradePlan.entryLow),
          entryHigh: roundMaybe(ta.tradePlan.entryHigh),
          breakout: roundMaybe(ta.tradePlan.breakout),
          stopLine: roundMaybe(ta.tradePlan.stopLine),
          takeProfit1: roundMaybe(ta.tradePlan.takeProfit1),
          takeProfit2: roundMaybe(ta.tradePlan.takeProfit2),
          trailStop: roundMaybe(ta.tradePlan.trailStop),
          rr1: roundMaybe(ta.tradePlan.rr1, 2),
        }
      : null,
    chart,
  };
}

export async function buildStockSummary(query) {
  const resolved = await resolveTicker(query);
  if (!resolved?.code) {
    const error = new Error('找不到這檔股票，請輸入台股代號，例如 2330。');
    error.statusCode = 404;
    throw error;
  }

  const [pricePack, inst, margin] = await Promise.all([
    yahooPrice(resolved.code),
    finmind('TaiwanStockInstitutionalInvestorsBuySell', resolved.code, daysAgo(45)),
    finmind('TaiwanStockMarginPurchaseShortSale', resolved.code, daysAgo(45)),
  ]);

  const rows = pricePack.rows;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2] || null;
  const change = prev ? last.close - prev.close : null;
  const changePct = prev?.close ? (change / prev.close) * 100 : null;
  const name = resolved.name || pricePack.longName || pricePack.shortName || pricePack.name || resolved.code;

  return {
    code: resolved.code,
    name,
    symbol: pricePack.symbol,
    generatedAt: new Date().toISOString(),
    source: {
      price: `Yahoo Finance ${pricePack.symbol}`,
      chips: inst ? 'FinMind institutional investors' : null,
      margin: margin ? 'FinMind margin and short-sale' : null,
    },
    price: {
      date: last.date,
      close: roundMaybe(last.close),
      previousClose: roundMaybe(prev?.close),
      change: roundMaybe(change),
      changePct: roundMaybe(changePct, 2),
    },
    technical: buildTechnical(rows),
    chips: buildChips(inst),
    margin: buildMargin(margin),
    disclaimer: '資訊整理用途，不構成買賣建議。請自行確認資料與風險。',
  };
}
