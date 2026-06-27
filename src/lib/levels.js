/* 真實支撐壓力（依 2 年 OHLCV 算真實價位結構，取代純 MA±ATR 公式）
 * 來源四種：前高/前低 swing、成交密集區 volume-by-price、未回補缺口、整數心理關卡。
 * 把候選價位群聚（相近的合併）、評強度，再依現價切成上方壓力 / 下方支撐。
 * 純函式、不依賴 technicals（避免 import 循環）；最終要對齊台股升降單位由呼叫端 roundToTick 處理。 */

const round2 = (x) => Number(Number(x).toFixed(2));
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// 依價位給「整數心理關卡」的級距（價越高、關卡越疏）
const roundStep = (p) => {
  const v = Math.abs(p);
  if (v < 20) return 1;
  if (v < 50) return 5;
  if (v < 100) return 5;
  if (v < 200) return 10;
  if (v < 500) return 25;
  if (v < 1000) return 50;
  return 100;
};

// 1) swing 高低點：以 fractal 視窗 k，high[i] 為 ±k 根內最大 → swing high（low 反之）
const findSwings = (rows, k = 5) => {
  const highs = [];
  const lows = [];
  const n = rows.length;
  for (let i = k; i < n - k; i++) {
    let isHi = true;
    let isLo = true;
    for (let j = i - k; j <= i + k; j++) {
      if (rows[j].high > rows[i].high) isHi = false;
      if (rows[j].low < rows[i].low) isLo = false;
    }
    if (isHi) highs.push({ price: rows[i].high, idx: i });
    if (isLo) lows.push({ price: rows[i].low, idx: i });
  }
  return { highs, lows };
};

// 2) 成交密集區：把價格範圍切 bins 個價帶，累加各 bar 的量到其典型價所屬價帶，量大者為密集區
const volumeByPrice = (rows, bins = 24) => {
  const prices = rows.map((r) => (r.high + r.low + r.close) / 3);
  const lo = Math.min(...rows.map((r) => r.low));
  const hi = Math.max(...rows.map((r) => r.high));
  if (!(hi > lo)) return [];
  const w = (hi - lo) / bins;
  const buckets = Array.from({ length: bins }, () => 0);
  rows.forEach((r, i) => {
    let b = Math.floor((prices[i] - lo) / w);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    buckets[b] += r.vol || 0;
  });
  const totalVol = buckets.reduce((s, x) => s + x, 0) || 1;
  return buckets
    .map((vol, b) => ({ price: round2(lo + (b + 0.5) * w), volShare: vol / totalVol }))
    .filter((x) => x.volShare > 0)
    .sort((a, b) => b.volShare - a.volShare);
};

// 3) 未回補缺口：跳空且現價尚未填補 → 缺口邊緣是一道支撐/壓力
const findGaps = (rows, lookback = 180) => {
  const out = [];
  const start = Math.max(1, rows.length - lookback);
  const last = rows[rows.length - 1].close;
  for (let i = start; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (cur.low > prev.high) {
      // 向上跳空，缺口區 [prev.high, cur.low]；未被回補（現價仍在其上）才算有效支撐
      if (last > prev.high) out.push({ price: round2(prev.high), idx: i, dir: 'up' });
    } else if (cur.high < prev.low) {
      // 向下跳空，缺口區 [cur.high, prev.low]；未被回補（現價仍在其下）才算壓力
      if (last < prev.low) out.push({ price: round2(prev.low), idx: i, dir: 'down' });
    }
  }
  return out;
};

// 4) 現價附近的整數心理關卡（上下各取幾檔）
const roundLevels = (price, span = 4) => {
  const step = roundStep(price);
  const base = Math.round(price / step) * step;
  const out = [];
  for (let i = -span; i <= span; i++) {
    const p = round2(base + i * step);
    if (p > 0) out.push(p);
  }
  return out;
};

const tierOf = (s) => (s >= 0.66 ? '強' : s >= 0.4 ? '中' : '弱');

/**
 * 主函式：rows = 由舊到新的 OHLCV [{open,high,low,close,vol,date}]
 * 回傳 { current, supports[], resistances[], nearestSupport, nearestResistance }
 *  每個 level: { price, strength(0-1), tier, kinds:[..], dist, distPct }
 */
export function computeLevels(rows, { recentBars = 250 } = {}) {
  if (!Array.isArray(rows) || rows.length < 60) return null;
  // 用近 recentBars 根算結構（兼顧「夠久看得到前高前低」與「太舊的關卡參考度低」）
  const data = rows.slice(-recentBars);
  const n = data.length;
  const current = round2(data[n - 1].close);
  const tol = current * 0.012; // 群聚容差 ~1.2%

  const { highs, lows } = findSwings(data, 5);
  const vnodes = volumeByPrice(data, 24).slice(0, 6);
  const gaps = findGaps(data);
  const rounds = roundLevels(current);

  // 收集候選（kind, price, 基礎權重、最近出現位置 idx 給 recency 用）
  const cand = [];
  const recency = (idx) => 0.3 * (idx / (n - 1)); // 越近的結構越重，最多 +0.3
  highs.forEach((h) => cand.push({ price: h.price, w: 0.5 + recency(h.idx), kind: '前高' }));
  lows.forEach((l) => cand.push({ price: l.price, w: 0.5 + recency(l.idx), kind: '前低' }));
  vnodes.forEach((v, i) => cand.push({ price: v.price, w: 0.55 + Math.min(0.35, v.volShare * 4) - i * 0.02, kind: '成交密集區' }));
  gaps.forEach((g) => cand.push({ price: g.price, w: 0.4 + recency(g.idx), kind: '缺口' }));
  rounds.forEach((p) => cand.push({ price: p, w: 0.22, kind: '整數關' }));

  // 群聚：價格排序後合併相近候選；強度累加（confluence 越多越強），合併種類
  cand.sort((a, b) => a.price - b.price);
  const clusters = [];
  for (const c of cand) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(c.price - last._sumP / last._cnt) <= tol) {
      last._sumP += c.price;
      last._cnt += 1;
      last.strength += c.w;
      last.kinds.add(c.kind);
    } else {
      clusters.push({ _sumP: c.price, _cnt: 1, strength: c.w, kinds: new Set([c.kind]) });
    }
  }

  // 觸碰次數：現價結構上被測試越多次越可靠 → 再加一點強度
  const levels = clusters.map((cl) => {
    const price = round2(cl._sumP / cl._cnt);
    let touches = 0;
    for (const r of data) if (r.low - tol <= price && price <= r.high + tol) touches += 1;
    const strength = clamp01(cl.strength + Math.min(0.2, touches * 0.01));
    return {
      price,
      strength: round2(strength),
      tier: tierOf(strength),
      kinds: [...cl.kinds],
      dist: round2(price - current),
      distPct: round2(((price - current) / current) * 100),
    };
  });

  const supports = levels
    .filter((l) => l.price < current)
    .sort((a, b) => b.price - a.price); // 由近到遠（價高在前）
  const resistances = levels
    .filter((l) => l.price > current)
    .sort((a, b) => a.price - b.price); // 由近到遠（價低在前）

  return {
    current,
    supports: supports.slice(0, 4),
    resistances: resistances.slice(0, 4),
    nearestSupport: supports[0] || null,
    nearestResistance: resistances[0] || null,
  };
}

// 給 AI prompt 用的精簡描述（中文、含強度，不含任何英文欄位名）
export function summarizeLevels(lv) {
  if (!lv) return null;
  const fmt = (l) => `${l.price}（${l.kinds.join('＋')}，${l.tier}）`;
  return {
    現價: lv.current,
    上方壓力由近到遠: lv.resistances.map(fmt),
    下方支撐由近到遠: lv.supports.map(fmt),
  };
}
