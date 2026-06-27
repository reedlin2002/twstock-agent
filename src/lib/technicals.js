/* 技術指標（前端用真實股價計算） */
import { computeLevels, summarizeLevels } from './levels.js';

const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
export const rollMean = (a, n) => a.map((_, i) => (i < n - 1 ? null : mean(a.slice(i - n + 1, i + 1))));
const rollExt = (a, n, mp, mx) => a.map((_, i) => {
  const w = a.slice(Math.max(0, i - n + 1), i + 1);
  if (w.length < mp) return null;
  return mx ? Math.max(...w) : Math.min(...w);
});
const emaA = (a, al) => { const o = []; let p; a.forEach((v, i) => { p = i === 0 ? v : v * al + p * (1 - al); o.push(p); }); return o; };
const emaS = (a, sp) => emaA(a, 2 / (sp + 1));
const bounded = (x, min, max) => Math.max(min, Math.min(max, x));

// 台股最小升降單位（上市櫃股票六級距）；以「該價位」決定 tick
export const tickSize = (p) => {
  const v = Math.abs(Number(p));
  if (v < 10) return 0.01;
  if (v < 50) return 0.05;
  if (v < 100) return 0.1;
  if (v < 500) return 0.5;
  if (v < 1000) return 1;
  return 5;
};
// 把價格對齊到合法的台股跳動單位；dir = 'down' | 'up' | 'nearest'
export const roundToTick = (p, dir = 'nearest') => {
  if (p == null || !Number.isFinite(Number(p))) return null;
  const v = Number(p);
  const t = tickSize(v);
  const f = dir === 'down' ? Math.floor : dir === 'up' ? Math.ceil : Math.round;
  return Number((f(v / t) * t).toFixed(2));
};

export function computeTA(pr) {
  const n = pr.length; if (n < 60) return null;
  const close = pr.map((d) => d.close), high = pr.map((d) => d.high), low = pr.map((d) => d.low),
    open = pr.map((d) => d.open), vol = pr.map((d) => d.vol);
  const MA20 = rollMean(close, 20), MA60 = rollMean(close, 60), MA120 = rollMean(close, 120), MA240 = rollMean(close, 240);
  const VOL20 = rollMean(vol, 20);
  const low9 = rollExt(low, 9, 1, false), high9 = rollExt(high, 9, 1, true);
  const rsv = close.map((c, i) => { const den = high9[i] - low9[i]; return den ? ((c - low9[i]) / den) * 100 : 50; });
  const K = emaA(rsv, 1 / 3), D = emaA(K, 1 / 3);
  const e12 = emaS(close, 12), e26 = emaS(close, 26);
  const DIF = e12.map((v, i) => v - e26[i]), DEA = emaS(DIF, 9);
  const delta = close.map((c, i) => (i === 0 ? 0 : c - close[i - 1]));
  const gain = emaA(delta.map((d) => Math.max(d, 0)), 1 / 14), loss = emaA(delta.map((d) => Math.max(-d, 0)), 1 / 14);
  const RSI = gain.map((g, i) => (loss[i] ? 100 - 100 / (1 + g / loss[i]) : 100));
  const tr = close.map((c, j) => (j === 0 ? high[j] - low[j] : Math.max(high[j] - low[j], Math.abs(high[j] - close[j - 1]), Math.abs(low[j] - close[j - 1]))));
  const ATR14 = rollMean(tr, 14);
  const HI52 = rollExt(close, 240, 20, true), LO52 = rollExt(close, 240, 20, false);
  const rh = rollExt(close, 60, 20, true);

  const i = n - 1, c = close[i];
  const trend = [
    ['收盤站上季線MA60、半年線MA120', c > MA60[i] && c > MA120[i]],
    ['均線多頭排列 MA20 > MA60 > MA120', MA20[i] > MA60[i] && MA60[i] > MA120[i]],
    ['年線MA240 上彎（長期趨勢向上）', MA240[i] != null && MA240[i - 20] != null && MA240[i] > MA240[i - 20]],
    ['距 52 週高點 ≤ 25%（強勢）', HI52[i] != null && c >= 0.75 * HI52[i]],
    ['高於 52 週低點 ≥ 30%（已脫離底部）', LO52[i] != null && c >= 1.3 * LO52[i]],
  ];
  const anyN = (fn) => { for (let j = Math.max(5, n - 20); j < n; j++) if (fn(j)) return true; return false; };
  const trigger = [
    ['KD 低檔黃金交叉', anyN((j) => K[j] > D[j] && K[j - 1] <= D[j - 1] && K[j] < 30)],
    ['站上季線（趨勢轉強）', anyN((j) => close[j] > MA60[j] && close[j - 1] <= MA60[j - 1] && MA60[j] > MA60[j - 5])],
    ['帶量突破前高', anyN((j) => rh[j - 1] != null && close[j] > rh[j - 1] && vol[j] > 1.5 * VOL20[j] && close[j] > open[j])],
    ['MACD 由下往上翻多（DIF 上穿 DEA）', anyN((j) => DIF[j] > DEA[j] && DIF[j - 1] <= DEA[j - 1])],
  ];
  const trendPass = trend.filter((t) => t[1]).length, hasTrig = trigger.some((t) => t[1]);

  let regime, cls, verdict;
  if (c < MA60[i]) { regime = '弱勢／季線之下'; cls = 'avoid'; verdict = '收盤在季線之下，趨勢尚未轉強。Weinstein、Minervini 等方法在這階段多半「避開不買」，會等底部完成、重新站上長期均線再說。'; }
  else if (trendPass >= 4 && hasTrig) { regime = '趨勢成形＋出現進場訊號'; cls = 'go'; verdict = '趨勢結構偏多，且近期出現大師方法認定的進場訊號——這通常被歸類為「趨勢較強的觀察區」。但訊號≠保證，這只是條件提醒、不是買賣建議，務必先設好停損並自行評估。'; }
  else if (trendPass >= 4) { regime = '趨勢偏多，暫無明確訊號'; cls = 'wait'; verdict = '均線多頭、位置偏強，但近期沒有明確的突破或低檔轉折訊號。大師做法多會「等拉回到上彎均線獲得支撐，或帶量突破前高」再進場，而非追高。'; }
  else { regime = '中性整理'; cls = 'neutral'; verdict = '部分條件符合、部分未到位，屬於整理格局。可放進觀察清單，等趨勢與量能進一步轉強、出現明確買點再說。'; }

  const recentLow = Math.min(...low.slice(-20));
  const atr = ATR14[i] || Math.max(1, c * 0.025);
  const ma20 = MA20[i] || c;
  const ma60 = MA60[i] || c;
  const priorHigh = rh[i - 1] || c;

  // 真實支撐壓力（前高前低／成交密集區／缺口／整數關），取代純 MA±ATR 公式
  const levels = computeLevels(pr);
  const sup = levels?.nearestSupport?.price ?? null;    // 定義多方論點的最近支撐
  const res = levels?.nearestResistance?.price ?? null; // 上方最近壓力
  const res2 = levels?.resistances?.[1]?.price ?? null; // 次一壓力（給第二目標）

  // 1) 觀察買點區：以「最近真實支撐」為下緣，上緣取支撐到現價的下半段（不追高到現價）
  let entryLow;
  let entryHigh;
  let mode;
  let planNote;
  if (sup != null && sup < c) {
    entryLow = sup;
    entryHigh = Math.min(c, sup + Math.max((c - sup) * 0.5, sup * 0.01));
    if (entryHigh <= entryLow) entryHigh = sup * 1.01;
  } else {
    // 沒有可靠支撐資料時，退回季線附近觀察
    entryLow = ma60 * 0.98;
    entryHigh = ma60 * 1.02;
  }
  if (c < ma60) {
    mode = '先觀察，不急著接';
    planNote = sup != null
      ? `股價在季線下方，偏弱；若要觀察，重點是能否守住 ${roundToTick(sup, 'nearest')} 附近支撐並重新站回季線。`
      : '股價還在季線下方，先等重新站回季線並守住，再談進場。';
  } else if (trendPass >= 4 && hasTrig) {
    mode = '拉回支撐或突破壓力後觀察';
    planNote = `趨勢與訊號已成形，偏向等拉回 ${roundToTick(entryLow, 'nearest')}–${roundToTick(entryHigh, 'nearest')} 支撐不破，或帶量突破 ${res != null ? roundToTick(res, 'up') : '上方壓力'} 後回測守住，而不是盲目追高。`;
  } else if (trendPass >= 4) {
    mode = '等拉回支撐或量價確認';
    planNote = '趨勢偏多但訊號不足，等回測支撐獲得守住、或量價突破壓力再評估。';
  } else {
    mode = '整理區觀察';
    planNote = '條件還沒有明顯站在多方，先看能不能站穩支撐與量能轉強。';
  }
  if (entryLow > entryHigh) [entryLow, entryHigh] = [entryHigh, entryLow];
  entryLow = roundToTick(entryLow, 'nearest');
  entryHigh = roundToTick(entryHigh, 'nearest');
  if (entryLow > entryHigh) [entryLow, entryHigh] = [entryHigh, entryLow];

  // 2) 停損：跌破「定義多方論點的支撐」就收手 → 支撐下緣留緩衝；以觀察區上緣為假設買價
  const refEntry = entryHigh;
  const stopBase = sup != null ? sup : Math.max(recentLow, ma60 * 0.98);
  let stopLine = stopBase * 0.985; // 支撐下方約 1.5% 緩衝，避免被巧合掃到
  const minStop = Math.max(atr, refEntry * 0.03); // 停損與買價至少相隔 1×ATR 或 3%
  if (refEntry - stopLine < minStop) stopLine = refEntry - minStop; // 太近就放寬停損，而非灌大目標
  stopLine = bounded(stopLine, refEntry * 0.85, refEntry * 0.985);
  stopLine = roundToTick(stopLine, 'down'); // 停損向下對齊（稍遠一點、較不易被巧合掃到）

  const risk = refEntry - stopLine; // 單一一致的 1R
  // 3) 停利／目標：優先用真實壓力，壓力不足才用 R 倍數補；突破參考用真實最近壓力
  let tp1 = res != null && res > refEntry ? res : refEntry + risk * 2;
  let tp2 = res2 != null && res2 > tp1 ? res2 : Math.max(tp1 + risk, refEntry + risk * 3);
  const target1IsResistance = res != null && res > refEntry;
  const rr1 = risk > 0 ? (tp1 - refEntry) / risk : null; // 第一目標的風險報酬比

  const tradePlan = {
    cls,
    mode,
    entryLow,
    entryHigh,
    support: sup != null ? roundToTick(sup, 'nearest') : null,
    resistance: res != null ? roundToTick(res, 'nearest') : null,
    breakout: roundToTick(res != null ? res : priorHigh, 'up'),
    stopLine,
    takeProfit1: roundToTick(tp1, 'nearest'),
    takeProfit2: roundToTick(tp2, 'nearest'),
    target1IsResistance,
    rr1: rr1 != null ? Number(rr1.toFixed(2)) : null,
    trailStop: roundToTick(Math.max(ma20, refEntry - atr * 1.5), 'down'),
    risk,
    note: planNote,
  };
  return {
    close: c, ma60: MA60[i], k: K[i], d: D[i], rsi: RSI[i], trend, trigger, trendPass, hasTrig,
    regime, cls, verdict, recentLow, tradePlan, levels, levelsSummary: summarizeLevels(levels),
  };
}

export const planSummary = (ta) => {
  const p = ta?.tradePlan;
  if (!p) return null;
  if (p.cls === 'avoid') {
    return {
      title: '先不要碰',
      detail: '價格結構還沒有站回多方，先等重新站穩季線與量能轉強。',
    };
  }
  if (p.cls === 'go') {
    return {
      title: '趨勢較強，觀察不追高',
      detail: '條件偏多，重點是等價格回到觀察區或突破後回測守住，這是觀察提醒不是買賣建議。',
    };
  }
  if (p.cls === 'wait') {
    return {
      title: '等回測或突破',
      detail: '趨勢不差，但訊號還不夠完整，先把價位放進觀察清單。',
    };
  }
  return {
    title: '先觀察',
    detail: '條件仍在整理，等方向與量能更明確再判斷。',
  };
};

export const toneForText = (text = '', key = '') => {
  if (key === 'risks') return 'bad';
  const bad = /(風險|下滑|衰退|減少|賣超|跌破|弱勢|壓力|警訊|過熱|轉弱|不利|虧損|缺乏|未包含|不能|資料未提供)/;
  const good = /(偏多|轉強|成長|增加|買超|突破|站上|支撐|改善|強勢|有利|上彎|續強|優勢|放量)/;
  if (bad.test(text)) return 'bad';
  if (good.test(text)) return 'good';
  return 'neutral';
};
