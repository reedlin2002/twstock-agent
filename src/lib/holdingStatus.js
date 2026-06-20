/* 持股條件提醒：把被動的個人紀錄，對照目前股價算出損益、距停損/停利距離，
 * 並在觸及／接近時給「條件提醒」（研究輔助語氣，非買賣建議）。純本地計算。
 */

// 取得數字，無法解析回 null
const num = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 計算未實現損益（純本地）。資料不足回 null。
export function computePnl(note, latestClose) {
  if (!note || note.held !== true) return null;
  const bp = num(note.buyPrice);
  const sh = num(note.shares);
  const px = num(latestClose);
  if (bp == null || sh == null || px == null || bp <= 0 || sh <= 0) return null;
  const cost = bp * sh;
  const value = px * sh;
  const pnl = value - cost;
  const pct = cost ? (pnl / cost) * 100 : null;
  return { cost, value, pnl, pct };
}

const NEAR_PCT = 5; // 距離停損/停利 5% 內算「接近」

// 組出持股狀態與提醒。latestClose 為最新收盤價。
export function buildHoldingStatus(note, latestClose) {
  const n = note || {};
  const px = num(latestClose);
  const hasAny = n.held === true
    || ['buyPrice', 'shares', 'stopLoss', 'takeProfit'].some((k) => String(n[k] ?? '').trim() !== '');
  if (!hasAny) return null;

  const pnl = computePnl(n, latestClose);
  const alerts = [];
  const notes = []; // 非數字的文字型停損/停利，僅列出提醒

  const stopNum = num(n.stopLoss);
  const takeNum = num(n.takeProfit);
  const stopRaw = String(n.stopLoss ?? '').trim();
  const takeRaw = String(n.takeProfit ?? '').trim();

  let stop = null;
  let take = null;

  if (px != null && stopNum != null && stopNum > 0) {
    const pct = ((px - stopNum) / px) * 100; // 正：現價在停損之上還有的距離
    const hit = px <= stopNum;
    stop = { value: stopNum, pct, hit };
    if (hit) alerts.push({ level: 'warn', text: `目前價 ${px} 已跌破你設定的停損 ${stopNum}，請依出場條件檢視。` });
    else if (pct <= NEAR_PCT) alerts.push({ level: 'info', text: `目前價距停損 ${stopNum} 僅約 ${pct.toFixed(1)}%，接近中，請留意。` });
  } else if (stopRaw && stopNum == null) {
    notes.push(`停損條件：${stopRaw}`);
  }

  if (px != null && takeNum != null && takeNum > 0) {
    const pct = ((takeNum - px) / px) * 100; // 正：距停利還有多少
    const hit = px >= takeNum;
    take = { value: takeNum, pct, hit };
    if (hit) alerts.push({ level: 'info', text: `目前價 ${px} 已達你設定的停利 ${takeNum}，可檢視是否分批調節。` });
    else if (pct <= NEAR_PCT) alerts.push({ level: 'info', text: `目前價距停利 ${takeNum} 約 ${pct.toFixed(1)}%，接近中。` });
  } else if (takeRaw && takeNum == null) {
    notes.push(`停利條件：${takeRaw}`);
  }

  return { held: n.held === true, pnl, stop, take, alerts, notes, latestClose: px };
}
