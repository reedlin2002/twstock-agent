/* 技術指標（前端用真實股價計算） */

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
  else if (trendPass >= 4 && hasTrig) { regime = '趨勢成形＋出現進場訊號'; cls = 'go'; verdict = '趨勢結構偏多，且近期出現大師方法認定的進場訊號——這通常被歸類為「可考慮的買進區」。但訊號≠保證，務必先設好停損再行動。'; }
  else if (trendPass >= 4) { regime = '趨勢偏多，暫無明確訊號'; cls = 'wait'; verdict = '均線多頭、位置偏強，但近期沒有明確的突破或低檔轉折訊號。大師做法多會「等拉回到上彎均線獲得支撐，或帶量突破前高」再進場，而非追高。'; }
  else { regime = '中性整理'; cls = 'neutral'; verdict = '部分條件符合、部分未到位，屬於整理格局。可放進觀察清單，等趨勢與量能進一步轉強、出現明確買點再說。'; }

  const recentLow = Math.min(...low.slice(-20));
  const atr = ATR14[i] || Math.max(1, c * 0.025);
  const ma20 = MA20[i] || c;
  const ma60 = MA60[i] || c;
  const priorHigh = rh[i - 1] || c;
  const stopLine = bounded(Math.max(recentLow, ma60 * 0.98, c * 0.92), c * 0.86, c * 0.985);
  const risk = Math.max(c - stopLine, atr);
  let entryLow;
  let entryHigh;
  let mode;
  let planNote;
  if (c < ma60) {
    mode = '先觀察，不急著接';
    entryLow = ma60;
    entryHigh = ma60 * 1.02;
    planNote = '股價還在季線下方，先等重新站回季線並守住，再談進場。';
  } else if (trendPass >= 4 && hasTrig) {
    mode = '突破後回測觀察';
    entryLow = Math.max(ma60, ma20 - atr * 0.35);
    entryHigh = Math.min(c, Math.max(ma20, ma60) + atr * 0.8);
    planNote = '趨勢與訊號已成形，偏向等拉回不破短均或突破線附近，而不是盲目追高。';
  } else if (trendPass >= 4) {
    mode = '等拉回或突破';
    entryLow = Math.max(ma60, ma20 - atr * 0.5);
    entryHigh = Math.max(ma20, ma60) + atr * 0.5;
    planNote = '趨勢偏多但訊號不足，等量價確認或回測支撐再評估。';
  } else {
    mode = '整理區觀察';
    entryLow = ma60 * 0.98;
    entryHigh = ma60 * 1.02;
    planNote = '條件還沒有明顯站在多方，先看能不能站穩季線與量能轉強。';
  }
  if (entryLow > entryHigh) [entryLow, entryHigh] = [entryHigh, entryLow];
  const tradePlan = {
    cls,
    mode,
    entryLow,
    entryHigh,
    breakout: priorHigh,
    stopLine,
    takeProfit1: c + risk * 2,
    takeProfit2: c + risk * 3,
    trailStop: Math.max(ma20, c - atr * 1.5),
    risk,
    note: planNote,
  };
  return {
    close: c, ma60: MA60[i], k: K[i], d: D[i], rsi: RSI[i], trend, trigger, trendPass, hasTrig,
    regime, cls, verdict, recentLow, stopPct: c * 0.92, stopRef: Math.max(recentLow, MA60[i]), tradePlan,
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
      title: '可觀察買點，不追高',
      detail: '條件偏多，重點是等價格回到觀察區或突破後回測守住。',
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
