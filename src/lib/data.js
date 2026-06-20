/* 資料抓取（Yahoo Finance / FinMind）與資料整形 */
import { computeTA, rollMean } from './technicals.js';
import { roundMaybe } from './format.js';
import { EXAMPLES } from '../data/constants.js';

const FINMIND_ENDPOINT = 'https://api.finmindtrade.com/api/v4/data';
const YAHOO_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_QUOTE_ENDPOINT = 'https://query1.finance.yahoo.com/v7/finance/quote';

const parseYahooChart = (payload, symbol) => {
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
    instrumentType: result?.meta?.instrumentType || null,
  };
};

const fetchYahooQuote = async (symbol) => {
  try {
    const upstream = await fetch(`${YAHOO_QUOTE_ENDPOINT}?symbols=${encodeURIComponent(symbol)}`);
    if (!upstream.ok) return {};
    const payload = await upstream.json();
    return payload?.quoteResponse?.result?.[0] || {};
  } catch {
    return {};
  }
};

export async function finmind(dataset, id, start, token) {
  let q = `dataset=${dataset}&data_id=${id}&start_date=${start}`;
  if (token) q += `&token=${encodeURIComponent(token)}`;

  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  if (!isNative && import.meta.env.DEV) {
    try {
      const r = await fetch(`/api/finmind?${q}`);
      if (!r.ok) return null;
      const j = await r.json();
      return j && Array.isArray(j.data) ? j.data : null;
    } catch {
      return null;
    }
  }

  try {
    const r = await fetch(`${FINMIND_ENDPOINT}?${q}`);
    if (!r.ok) return null;
    const j = await r.json();
    return j && Array.isArray(j.data) ? j.data : null;
  } catch {
    return null;
  }
}

export async function yahooPrice(code) {
  const isNative = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();

  if (!isNative && import.meta.env.DEV) {
    try {
      const r = await fetch(`/api/yahoo-price?code=${encodeURIComponent(code)}&range=2y&interval=1d`);
      if (!r.ok) return null;
      const j = await r.json();
      return j && Array.isArray(j.rows) && j.rows.length ? j : null;
    } catch {
      return null;
    }
  }

  try {
    const symbols = code.endsWith('.TW') || code.endsWith('.TWO')
      ? [code]
      : [`${code}.TW`, `${code}.TWO`];

    for (const symbol of symbols) {
      const r = await fetch(`${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=history&includeAdjustedClose=true`);
      const payload = await r.json();
      const parsed = parseYahooChart(payload, symbol);
      if (r.ok && parsed.rows.length >= 60) {
        const quote = await fetchYahooQuote(symbol);
        return {
          ...parsed,
          name: quote.longName || quote.shortName || quote.displayName || null,
          shortName: quote.shortName || null,
          longName: quote.longName || null,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function processFinmind(price, inst, margin) {
  const out = {};
  if (price && price.length) {
    const praw = price.filter((d) => d.close != null).sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        open: +(d.open ?? d.close),
        high: +(d.max ?? d.high ?? d.close),
        low: +(d.min ?? d.low ?? d.close),
        close: +d.close,
        vol: +(d.Trading_Volume ?? d.vol ?? d.volume ?? 0),
      }));
    out.ta = computeTA(praw);
    const cl = praw.map((d) => d.close), ma20 = rollMean(cl, 20), ma60 = rollMean(cl, 60);
    out.price = praw.map((d, i) => ({ date: d.date, close: d.close, ma20: ma20[i], ma60: ma60[i] })).slice(-150);
  }
  if (inst && inst.length) {
    const cat = (s) => /Foreign/i.test(s) ? '外資' : /Investment_Trust/i.test(s) ? '投信' : /Dealer/i.test(s) ? '自營' : '其他';
    const by = {};
    inst.forEach((r) => {
      const c = cat(r.name), net = ((+r.buy) - (+r.sell)) / 1000;
      by[r.date] = by[r.date] || { date: r.date, 外資: 0, 投信: 0, 自營: 0, net: 0 };
      if (c !== '其他') { by[r.date][c] += net; by[r.date].net += net; }
    });
    const rows = Object.values(by).sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
    out.chips = rows;
    const s5 = (k) => rows.slice(-5).reduce((s, r) => s + r[k], 0);
    out.sum = { 外資: s5('外資'), 投信: s5('投信'), 自營: s5('自營') };
  }
  if (margin && margin.length) {
    const m = margin.sort((a, b) => a.date.localeCompare(b.date)), t = m[m.length - 1], p5 = m[m.length - 6];
    const mb = t.MarginPurchaseTodayBalance != null ? +t.MarginPurchaseTodayBalance : null;
    const sb = t.ShortSaleTodayBalance != null ? +t.ShortSaleTodayBalance : null;
    out.margin = {
      marginBal: mb, shortBal: sb,
      marginChg: mb != null && p5 ? mb - (+p5.MarginPurchaseTodayBalance) : null,
      shortChg: sb != null && p5 ? sb - (+p5.ShortSaleTodayBalance) : null,
    };
  }
  return out;
}

let stockInfoCache = null;
export const resolveTickerAsync = async (q) => {
  let code = null;
  let name = null;

  const direct = q.match(/\d{4,6}/);
  if (direct) {
    code = direct[0];
  } else {
    const hit = EXAMPLES.find((ex) => q.includes(ex.name) || q.includes(ex.code));
    if (hit) { code = hit.code; name = hit.name; }
  }

  if (!stockInfoCache) {
    try {
      const data = await finmind('TaiwanStockInfo', '', '');
      if (data) stockInfoCache = data;
    } catch (e) {
      console.error('Failed to fetch stock info', e);
    }
  }

  if (stockInfoCache) {
    if (code && !name) {
      const found = stockInfoCache.find(s => s.stock_id === code);
      if (found) name = found.stock_name;
    } else if (!code) {
      const found = stockInfoCache.find(s => q.includes(s.stock_name) || s.stock_name.includes(q));
      if (found) { code = found.stock_id; name = found.stock_name; }
    }
  }

  if (code) return { code, name };
  return null;
};

export const buildProvidedData = ({ query, ticker, companyName, fmData }) => {
  const priceSeries = (fmData?.price || []).slice(-60).map((row) => ({
    date: row.date,
    close: roundMaybe(row.close),
    ma20: roundMaybe(row.ma20),
    ma60: roundMaybe(row.ma60),
  }));
  const latestPrice = priceSeries[priceSeries.length - 1] || null;
  const ta = fmData?.ta || null;

  return {
    query,
    ticker,
    companyName,
    sources: fmData?.sources || {},
    source: 'Yahoo Finance price data + optional FinMind chip data + local technical indicator calculations',
    generatedAt: new Date().toISOString(),
    priceRange: priceSeries.length
      ? { start: priceSeries[0].date, end: priceSeries[priceSeries.length - 1].date, rows: priceSeries.length }
      : null,
    latestPrice,
    priceMeta: fmData?.priceMeta || null,
    priceSeries,
    technical: ta
      ? {
        regime: ta.regime,
        verdict: ta.verdict,
        trendPass: ta.trendPass,
        close: roundMaybe(ta.close),
        ma60: roundMaybe(ta.ma60),
        kd: { k: roundMaybe(ta.k), d: roundMaybe(ta.d) },
        rsi: roundMaybe(ta.rsi),
        recentLow: roundMaybe(ta.recentLow),
        stopPct: roundMaybe(ta.stopPct),
        stopRef: roundMaybe(ta.stopRef),
        tradePlan: ta.tradePlan
          ? {
            mode: ta.tradePlan.mode,
            entryLow: roundMaybe(ta.tradePlan.entryLow),
            entryHigh: roundMaybe(ta.tradePlan.entryHigh),
            breakout: roundMaybe(ta.tradePlan.breakout),
            stopLine: roundMaybe(ta.tradePlan.stopLine),
            takeProfit1: roundMaybe(ta.tradePlan.takeProfit1),
            takeProfit2: roundMaybe(ta.tradePlan.takeProfit2),
            trailStop: roundMaybe(ta.tradePlan.trailStop),
            note: ta.tradePlan.note,
          }
          : null,
        trendChecklist: ta.trend?.map(([label, passed]) => ({ label, passed })),
        triggerChecklist: ta.trigger?.map(([label, passed]) => ({ label, passed })),
      }
      : null,
    chips: {
      recentRows: (fmData?.chips || []).slice(-20),
      fiveDaySum: fmData?.sum || null,
    },
    margin: fmData?.margin || null,
    limitations: [
      'Price data comes from Yahoo Finance chart data, similar to the yfinance source used by the Python script.',
      'Chip and margin data are optional FinMind supplements and may be missing or delayed.',
      'No financial statements, revenue, valuation, news, or industry dataset is included in this request.',
      'AI must not infer missing fundamental, news, or industry facts.',
    ],
  };
};

export const extractAiText = (data) => {
  if (typeof data?.text === 'string') return data.text;
  if (Array.isArray(data?.content)) {
    return data.content
      .filter((b) => b?.type === 'text' || typeof b?.text === 'string')
      .map((b) => b.text || '')
      .join('\n');
  }
  if (Array.isArray(data?.choices)) {
    return data.choices
      .map((c) => c?.message?.content || c?.text || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
};

// 從 OpenRouter web 搜尋回應取出來源（message.annotations 的 url_citation）
// 回傳 [{ url, title, date }]，以 url 去重；date 盡量從 title/content 抓，抓不到就省略
const pickCitationDate = (text) => {
  if (!text) return null;
  const iso = text.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${String(iso[2]).padStart(2, '0')}-${String(iso[3]).padStart(2, '0')}`;
  const cn = text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?/);
  if (cn) return cn[3] ? `${cn[1]}-${String(cn[2]).padStart(2, '0')}-${String(cn[3]).padStart(2, '0')}` : `${cn[1]}-${String(cn[2]).padStart(2, '0')}`;
  return null;
};

export const extractAiSources = (data) => {
  const annotations = data?.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations)) return [];
  const seen = new Set();
  const out = [];
  for (const a of annotations) {
    if (a?.type !== 'url_citation') continue;
    const c = a.url_citation || {};
    const url = c.url;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: (c.title || url).trim(),
      date: pickCitationDate(c.title) || pickCitationDate(c.content) || null,
    });
  }
  return out;
};
