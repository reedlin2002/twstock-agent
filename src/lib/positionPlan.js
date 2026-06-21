/* 個人化進出場（本地計算，研究輔助語氣，不喊買賣、不保證獲利）
 *
 * 兩種情境：
 * - 已持有：用買進價/股數對照現價，算成本、未實現損益、距停損停利、已實現 R 倍數。
 * - 未持有：用「可投入金額」或「股數」＋預計買價，算整張部位大小、每股/總風險、占資金%，
 *           並依系統買賣計畫給分批進場參考。
 *
 * 風險（R）定義：以「買價 − 停損」為 1R。停損優先採使用者自設（數字），否則用系統計畫 stopLine。
 */
import { roundToTick } from './technicals.js';

const LOT = 1000; // 台股一張 = 1000 股

const num = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 取停損基準：優先使用者自設（數字 > 0），否則系統計畫的 stopLine
const resolveStop = (userStop, tradePlan) => {
  const u = num(userStop);
  if (u != null && u > 0) return { value: u, source: 'user' };
  const s = tradePlan ? num(tradePlan.stopLine) : null;
  if (s != null && s > 0) return { value: s, source: 'plan' };
  return null;
};

// position: { held, buyPrice, shares, stopLoss, takeProfit, capital, plannedShares, plannedBuyPrice }
export function buildPositionPlan({ position, latestClose, tradePlan }) {
  const p = position || {};
  const px = num(latestClose);
  const warnings = [];

  if (p.held === true) {
    const bp = num(p.buyPrice);
    const sh = num(p.shares);
    if (bp == null || sh == null || bp <= 0 || sh <= 0 || px == null) return null;

    const cost = bp * sh;
    const marketValue = px * sh;
    const pnl = marketValue - cost;
    const pnlPct = cost ? (pnl / cost) * 100 : null;

    const stop = resolveStop(p.stopLoss, tradePlan);
    const take = num(p.takeProfit) ?? (tradePlan ? num(tradePlan.takeProfit1) : null);

    let rMultiple = null;        // 以買價為基準的「已走了幾個 R」
    let openRiskToStop = null;   // 從現價到停損，這個部位還會損失多少
    let toStopPct = null;
    if (stop) {
      const initRisk = bp - stop.value;
      if (initRisk > 0) rMultiple = (px - bp) / initRisk;
      openRiskToStop = (px - stop.value) * sh;
      toStopPct = px ? ((px - stop.value) / px) * 100 : null;
      if (stop.value >= px) warnings.push('目前股價已在停損價之下，部位處於計畫的出場條件區，請依紀律檢視。');
    } else {
      warnings.push('尚未設定停損；先在「我的紀錄」填停損或用系統計畫帶入，風險才算得清楚。');
    }
    const toTakePct = take && px ? ((take - px) / px) * 100 : null;

    return {
      kind: 'held',
      buyPrice: bp, shares: sh, cost, marketValue, pnl, pnlPct,
      stop: stop ? stop.value : null, stopSource: stop?.source || null,
      take, rMultiple, openRiskToStop, toStopPct, toTakePct, warnings,
    };
  }

  // 未持有：規劃進場
  const entryRaw = num(p.plannedBuyPrice) ?? (tradePlan ? num(tradePlan.entryHigh) : null) ?? px;
  if (entryRaw == null || entryRaw <= 0) return null;
  const entry = roundToTick(entryRaw, 'nearest') ?? entryRaw;
  const stop = resolveStop(p.stopLoss, tradePlan);
  const riskPerShare = stop && entry > stop.value ? entry - stop.value : null;
  if (stop && riskPerShare == null) warnings.push('預計買價低於或等於停損價，風險無法估算，請調整買價或停損。');

  const capital = num(p.capital);
  let shares = num(p.plannedShares);
  let lots = null;
  let oddShares = 0;
  if (shares == null && capital != null && capital > 0) {
    const lotCost = entry * LOT;
    lots = Math.floor(capital / lotCost);
    shares = lots * LOT;
    const leftover = capital - shares * entry;
    oddShares = Math.max(0, Math.floor(leftover / entry));
    if (lots === 0) warnings.push(`可投入金額不足一張（一張約 ${Math.round(lotCost).toLocaleString()} 元），可考慮零股約 ${oddShares} 股或加碼資金。`);
  } else if (shares != null) {
    lots = Math.floor(shares / LOT);
  }

  const positionCost = shares != null ? shares * entry : null;
  const totalRisk = riskPerShare != null && shares ? riskPerShare * shares : null;
  const riskPctOfCapital = totalRisk != null
    ? (capital ? (totalRisk / capital) * 100 : (positionCost ? (totalRisk / positionCost) * 100 : null))
    : null;
  if (riskPctOfCapital != null && riskPctOfCapital > 8) {
    warnings.push(`若停損觸發，最大虧損約占投入資金 ${riskPctOfCapital.toFixed(1)}%，偏高；常見作法是把單筆風險控制在資金的 1–2% 內，可縮小股數或拉近停損。`);
  }

  // 分批進場參考（依系統觀察區與突破價）
  const staged = [];
  if (tradePlan) {
    const lo = num(tradePlan.entryLow);
    const hi = num(tradePlan.entryHigh);
    const bk = num(tradePlan.breakout);
    if (lo != null && hi != null) staged.push({ label: '第一批：拉回觀察區', from: lo, to: hi, portion: 0.5 });
    if (bk != null) staged.push({ label: '第二批：站穩突破後回測', at: bk, portion: 0.5 });
  }

  return {
    kind: 'plan',
    entry, stop: stop ? stop.value : null, stopSource: stop?.source || null,
    riskPerShare, capital, shares, lots, oddShares, positionCost, totalRisk, riskPctOfCapital,
    breakout: tradePlan ? num(tradePlan.breakout) : null,
    take1: tradePlan ? num(tradePlan.takeProfit1) : null,
    take2: tradePlan ? num(tradePlan.takeProfit2) : null,
    staged, warnings,
  };
}

// 金額轉成「不需 AI 再換算」的字串：原數字（千分位）＋括號內中文萬，避免 AI 把元誤算成萬
const money元 = (x) => {
  if (x == null) return null;
  const n = Math.round(x);
  const wan = n / 10000;
  const wanStr = Math.abs(wan) >= 1
    ? `約${(wan >= 0 ? '' : '-') + Math.abs(wan).toFixed(Math.abs(wan) >= 100 ? 0 : 1)}萬元`
    : `${n.toLocaleString()}元`;
  return `${n.toLocaleString()}元（${wanStr}）`;
};

// 給 AI 提示用的精簡區塊：金額一律附上換算好的字串，數值欄位精簡明確，降低 AI 位數/單位出錯
export function positionForAi(plan) {
  if (!plan) return null;
  if (plan.kind === 'held') {
    return {
      狀態: '已持有',
      每股買進價_元: plan.buyPrice,
      股數: plan.shares,
      總成本: money元(plan.cost),
      目前市值: money元(plan.marketValue),
      未實現損益: money元(plan.pnl),
      報酬率: plan.pnlPct != null ? `${plan.pnlPct >= 0 ? '+' : ''}${plan.pnlPct.toFixed(1)}%` : null,
      參考停損價_元: plan.stop,
      參考停利價_元: plan.take,
      已走R倍數: plan.rMultiple != null ? Number(plan.rMultiple.toFixed(1)) : null,
      目前距停損: plan.toStopPct != null ? `${plan.toStopPct.toFixed(1)}%` : null,
      說明: '金額欄位已換算好，請照字串敘述，不要再自行換算成萬或億',
    };
  }
  return {
    狀態: '尚未持有_規劃進場',
    預計買價_元: plan.entry,
    參考停損價_元: plan.stop,
    每股風險_元: plan.riskPerShare != null ? Number(plan.riskPerShare.toFixed(2)) : null,
    可投入金額: money元(plan.capital),
    建議張數: plan.lots,
    建議股數: plan.shares,
    零股: plan.oddShares || 0,
    部位成本: money元(plan.positionCost),
    停損觸發最大虧損: money元(plan.totalRisk),
    風險佔資金: plan.riskPctOfCapital != null ? `${plan.riskPctOfCapital.toFixed(1)}%` : null,
    突破參考價_元: plan.breakout,
    分批停利參考價_元: [plan.take1, plan.take2].filter((x) => x != null),
    說明: '金額欄位已換算好，請照字串敘述，不要再自行換算成萬或億',
  };
}
