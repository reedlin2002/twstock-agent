/* 資料抓取（Yahoo Finance / FinMind）與資料整形 */
import { computeTA, rollMean } from './technicals.js';
import { roundMaybe } from './format.js';
import { EXAMPLES } from '../data/constants.js';
import { useDevProxy, pickUrl, fetchJson, fetchText, yahooSymbols } from './net.js';

const FINMIND_ENDPOINT = 'https://api.finmindtrade.com/api/v4/data';
const YAHOO_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_QUOTE_ENDPOINT = 'https://query1.finance.yahoo.com/v7/finance/quote';
const GOOGLE_NEWS_ENDPOINT = 'https://news.google.com/rss/search';
const PTT_BASE = 'https://www.ptt.cc';
const PTT_SEARCH_ENDPOINT = `${PTT_BASE}/bbs/Stock/search`;
const CMONEY_FORUM_ENDPOINT = 'https://www.cmoney.tw/forum/stock';

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
  const payload = await fetchJson(`${YAHOO_QUOTE_ENDPOINT}?symbols=${encodeURIComponent(symbol)}`);
  return payload?.quoteResponse?.result?.[0] || {};
};

export async function finmind(dataset, id, start, token) {
  let q = `dataset=${dataset}&data_id=${id}&start_date=${start}`;
  if (token) q += `&token=${encodeURIComponent(token)}`;
  const j = await fetchJson(pickUrl(`/api/finmind?${q}`, `${FINMIND_ENDPOINT}?${q}`));
  return j && Array.isArray(j.data) ? j.data : null;
}

export async function yahooPrice(code) {
  // dev 瀏覽器：proxy 會在 server 端輪詢 .TW/.TWO 並回最完整的一檔
  if (useDevProxy()) {
    const j = await fetchJson(`/api/yahoo-price?code=${encodeURIComponent(code)}&range=2y&interval=1d`);
    return j && Array.isArray(j.rows) && j.rows.length ? j : null;
  }

  // native / 正式：client 端輪詢 symbol
  for (const symbol of yahooSymbols(code)) {
    const payload = await fetchJson(`${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?range=2y&interval=1d&events=history&includeAdjustedClose=true`);
    if (!payload) continue;
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
  }
  return null;
}

// 輕量報價：只抓近幾日（range=5d），給自選股清單即時顯示用，比 yahooPrice（2 年）省很多。
// 回傳 { code, symbol, close, prevClose, chg, chgPct, date } 或 null（單檔失敗不影響其他檔）。
export async function yahooQuote(code) {
  const c = String(code || '').trim();
  if (!c) return null;

  const fromRows = (rows, symbol) => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const last = rows[rows.length - 1];
    if (!last || last.close == null) return null;
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    const prevClose = prev?.close ?? null;
    const chg = prevClose != null ? last.close - prevClose : null;
    const chgPct = prevClose ? (chg / prevClose) * 100 : null;
    // spark：近一個月日收盤，給首頁自選股迷你走勢線用（不另打請求）
    const spark = rows.slice(-22).map((r) => r.close).filter((x) => x != null);
    return { code: c, symbol: symbol || null, close: last.close, prevClose, chg, chgPct, date: last.date, spark };
  };

  if (useDevProxy()) {
    const j = await fetchJson(`/api/yahoo-quote?code=${encodeURIComponent(c)}&range=1mo`);
    return j ? fromRows(j.rows, j.symbol) : null;
  }

  for (const symbol of yahooSymbols(c)) {
    const payload = await fetchJson(`${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?range=1mo&interval=1d&includeAdjustedClose=true`);
    if (!payload) continue;
    const parsed = parseYahooChart(payload, symbol);
    if (parsed.rows.length) return fromRows(parsed.rows, symbol);
  }
  return null;
}

// 批次抓多檔報價，回 { [code]: quote|null }
export async function quickQuotes(codes) {
  const list = Array.isArray(codes)
    ? [...new Set(codes.map((x) => String(x || '').trim()).filter(Boolean))]
    : [];
  const results = await Promise.all(list.map((c) => yahooQuote(c)));
  const out = {};
  list.forEach((c, i) => { out[c] = results[i]; });
  return out;
}

// 連續同向天數：series 由舊到新，取數字欄位，回 { dir:+1連買/-1連賣/0, days }
const netStreak = (rows, key) => {
  let dir = 0;
  let days = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const s = Math.sign(rows[i][key] || 0);
    if (s === 0) break;
    if (dir === 0) { dir = s; days = 1; }
    else if (s === dir) days += 1;
    else break;
  }
  return { dir, days };
};

// 集保股權分散：把張數級距的下界 parse 出來（"400,001-600,000"→400001、"more than 1,000,001"→1000001）
const holdingLowerBound = (lvl) => {
  const s = String(lvl);
  if (/total|合計/i.test(s)) return null;
  const m = s.replace(/,/g, '').match(/(\d+)/);
  return m ? +m[1] : null;
};

export function processFinmind(price, inst, margin, holding) {
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
    // 法人連買／連賣天數（外資與三大法人合計），呈現「籌碼有沒有在站隊」
    out.streak = { 外資: netStreak(rows, '外資'), 三大法人: netStreak(rows, 'net') };
  }
  if (margin && margin.length) {
    const m = margin.sort((a, b) => a.date.localeCompare(b.date)), t = m[m.length - 1], p5 = m[m.length - 6];
    const mb = t.MarginPurchaseTodayBalance != null ? +t.MarginPurchaseTodayBalance : null;
    const sb = t.ShortSaleTodayBalance != null ? +t.ShortSaleTodayBalance : null;
    out.margin = {
      marginBal: mb, shortBal: sb,
      marginChg: mb != null && p5 ? mb - (+p5.MarginPurchaseTodayBalance) : null,
      shortChg: sb != null && p5 ? sb - (+p5.ShortSaleTodayBalance) : null,
      // 券資比＝融券餘額／融資餘額×100（高代表空方相對積極、亦可能是軋空題材）
      shortMarginRatio: mb != null && sb != null && mb > 0 ? Number(((sb / mb) * 100).toFixed(1)) : null,
    };
  }
  // 集保股權分散：大戶（>400 張）與千張大戶（>1000 張）持股比率與週變化
  if (holding && holding.length) {
    const byDate = {};
    holding.forEach((r) => {
      const lb = holdingLowerBound(r.HoldingSharesLevel ?? r.level);
      if (lb == null) return;
      const pct = +(r.percent ?? r.percentage ?? 0);
      if (!Number.isFinite(pct)) return;
      byDate[r.date] = byDate[r.date] || { date: r.date, big: 0, mega: 0 };
      if (lb >= 400000) byDate[r.date].big += pct;
      if (lb >= 1000000) byDate[r.date].mega += pct;
    });
    const series = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    const last = series[series.length - 1];
    const prev = series[series.length - 2];
    if (last) {
      out.holding = {
        asOf: last.date,
        bigPct: Number(last.big.toFixed(1)),
        megaPct: Number(last.mega.toFixed(1)),
        bigChg: prev ? Number((last.big - prev.big).toFixed(2)) : null,
        megaChg: prev ? Number((last.mega - prev.mega).toFixed(2)) : null,
      };
    }
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

export const buildProvidedData = ({ query, ticker, companyName, fmData, userPosition = null }) => {
  const priceSeries = (fmData?.price || []).slice(-90).map((row) => ({
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
        // 真實支撐壓力（前高前低／成交密集區／缺口／整數關），AI 講進出場時請以這些「真實價位」為主
        keyLevels: ta.levelsSummary || null,
        tradePlan: ta.tradePlan
          ? {
            mode: ta.tradePlan.mode,
            entryLow: roundMaybe(ta.tradePlan.entryLow),
            entryHigh: roundMaybe(ta.tradePlan.entryHigh),
            support: roundMaybe(ta.tradePlan.support),
            resistance: roundMaybe(ta.tradePlan.resistance),
            breakout: roundMaybe(ta.tradePlan.breakout),
            stopLine: roundMaybe(ta.tradePlan.stopLine),
            takeProfit1: roundMaybe(ta.tradePlan.takeProfit1),
            takeProfit2: roundMaybe(ta.tradePlan.takeProfit2),
            target1IsResistance: ta.tradePlan.target1IsResistance,
            rr1: ta.tradePlan.rr1,
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
      institutionalStreak: fmData?.streak || null, // 外資／三大法人連買連賣天數
      bigHolders: fmData?.holding || null,         // 集保大戶（>400張）與千張大戶持股趨勢
    },
    margin: fmData?.margin || null,
    // 使用者實際部位（已持有成本/股數，或未持有的進場規劃），供 AI 做個人化進出場說明
    ...(userPosition ? { userPosition } : {}),
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

// 解析 Google News RSS（XML）→ [{ url, title, date, source }]
// Google News 標題慣例為「標題 - 來源」，會把尾端來源去掉；pubDate 轉成 YYYY-MM-DD
const parseGoogleNewsRss = (xmlText, limit) => {
  try {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) return [];
    const items = Array.from(doc.querySelectorAll('item')).slice(0, limit);
    return items
      .map((it) => {
        const rawTitle = it.querySelector('title')?.textContent?.trim() || '';
        const source = it.querySelector('source')?.textContent?.trim() || '';
        const title = source && rawTitle.endsWith(` - ${source}`)
          ? rawTitle.slice(0, -(source.length + 3)).trim()
          : rawTitle;
        const url = it.querySelector('link')?.textContent?.trim() || '';
        const pub = it.querySelector('pubDate')?.textContent?.trim();
        const d = pub ? new Date(pub) : null;
        const date = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
        return { url, title, date, source: source || null };
      })
      .filter((n) => n.title && n.url);
  } catch {
    return [];
  }
};

// 用 Google News RSS 抓「這檔台股相關」的近期新聞，回傳 [{ url, title, date, source }]
// 與 finmind/yahooPrice 相同策略：DEV 瀏覽器走 /api/news 代理避免 CORS，native/正式環境直連
export async function googleNews(query, limit = 8) {
  if (!query) return [];
  const text = await fetchText(pickUrl(
    `/api/news?q=${encodeURIComponent(query)}`,
    `${GOOGLE_NEWS_ENDPOINT}?q=${encodeURIComponent(query)}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`,
  ));
  return text ? parseGoogleNewsRss(text, limit) : [];
}

// PTT 推文數（nrec）→ 數字：爆=100、純數字=該數、X開頭視為負向（噓多/有爭議）
const parsePttPush = (s) => {
  const t = String(s || '').replace(/<[^>]+>/g, '').trim();
  if (!t) return 0;
  if (t === '爆') return 100;
  if (/^X/i.test(t)) { const n = parseInt(t.slice(1), 10); return Number.isFinite(n) ? -n * 10 : -50; }
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? n : 0;
};

// 解析 PTT 看板搜尋頁（HTML）→ [{ title, url, push, date }]；已刪除文章（無 <a>）略過
const parsePttSearch = (html, limit = 12) => {
  const blocks = String(html).split('<div class="r-ent">').slice(1);
  const out = [];
  for (const b of blocks) {
    const a = b.match(/<div class="title">\s*<a href="([^"]+)">([\s\S]*?)<\/a>/);
    if (!a) continue;
    const nrec = (b.match(/<div class="nrec">([\s\S]*?)<\/div>/) || [])[1] || '';
    const date = (b.match(/<div class="date">([\s\S]*?)<\/div>/) || [])[1] || '';
    out.push({
      title: a[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
      url: a[1].startsWith('http') ? a[1] : `${PTT_BASE}${a[1]}`,
      push: parsePttPush(nrec),
      date: date.replace(/<[^>]+>/g, '').trim(),
    });
    if (out.length >= limit) break;
  }
  return out;
};

// PTT 股板散戶風向：以股票代號搜尋近期討論，回 { posts, stats }；壞了回 null（不影響整體分析）
export async function pttSentiment(code, limit = 12) {
  const c = String(code || '').trim();
  if (!c) return null;
  const text = await fetchText(pickUrl(
    `/api/ptt?q=${encodeURIComponent(c)}`,
    `${PTT_SEARCH_ENDPOINT}?q=${encodeURIComponent(c)}`,
  ));
  if (!text) return null;
  const posts = parsePttSearch(text, limit);
  if (!posts.length) return { posts: [], stats: null };
  const count = posts.length;
  const targets = posts.filter((p) => /\[標的\]/.test(p.title)).length;
  const avgPush = Math.round(posts.reduce((s, p) => s + p.push, 0) / count);
  const hottest = [...posts].sort((a, b) => b.push - a.push).slice(0, 5);
  return { posts, stats: { count, targets, avgPush, hottest } };
}

// CMoney 爆料同學會（best-effort）：SPA 頁、雜訊多，盡量抓文章標題，壞了/抓不到回 []
const parseCmoneyTitles = (html, limit = 8) => {
  const ts = [...String(html).matchAll(/class="nav__articleItemTitle"[^>]*>([\s\S]*?)<\//g)]
    .map((m) => m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t));
  return [...new Set(ts)].slice(0, limit);
};

export async function cmoneyBuzz(code, limit = 8) {
  const c = String(code || '').trim();
  if (!c) return [];
  const text = await fetchText(pickUrl(
    `/api/cmoney?code=${encodeURIComponent(c)}`,
    `${CMONEY_FORUM_ENDPOINT}/${encodeURIComponent(c)}`,
  ));
  return text ? parseCmoneyTitles(text, limit) : [];
}
