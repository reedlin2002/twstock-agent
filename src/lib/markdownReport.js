/* 個人化報告輸出：把分析 + 數據事件 + 持股紀錄 + 交易計畫 + 觀察重點 + 筆記
 * 組成一份可複製的 Markdown。空區塊自動略過。內容皆「研究輔助」語氣。
 */
import { pf, nf, sf, rangef } from './format.js';
import { computePnl, buildHoldingStatus } from './holdingStatus.js';

const today = () => new Date().toISOString().slice(0, 10);

export function buildMarkdownReport({ name, ticker, result = {}, ta, fm, note, events, latestClose }) {
  const out = [];
  const push = (...lines) => lines.forEach((l) => out.push(l));
  const sec = (title) => push('', `## ${title}`);

  const title = [name, ticker].filter(Boolean).join(' ') || '台股';
  push(`# ${title} 研究筆記`);
  push('', `> 產生時間：${today()}`);
  push('> 本報告為研究與資料整理輔助，非投資建議；技術與籌碼為量化數據，基本面／消息面／產業由 AI 整理，請自行查證。');

  const tags = [result.exchange, result.sector].filter(Boolean).join(' · ');
  if (tags) push('', `**${tags}**`);

  if (result.snapshot) { sec('快照'); push(result.snapshot); }

  // 技術面摘要（數據）
  if (ta) {
    sec('技術面摘要（數據）');
    if (ta.trendPass != null) push(`- 趨勢結構：${ta.trendPass} / 5`);
    if (ta.close != null) push(`- 收盤：${pf(ta.close)}　季線 MA60：${pf(ta.ma60)}`);
    if (ta.rsi != null) push(`- RSI：${Math.round(ta.rsi)}　KD：${Math.round(ta.k)} / ${Math.round(ta.d)}`);
    if (ta.regime) push(`- 狀態：${ta.regime}`);

    const p = ta.tradePlan;
    if (p) {
      push('', '**交易計畫（條件提醒，非買賣建議）**');
      push(`- 觀察區間：${rangef(p.entryLow, p.entryHigh)}`);
      push(`- 突破參考：${pf(p.breakout)}`);
      push(`- 跌破收手：${pf(p.stopLine)}`);
      push(`- 漲到分批收手：${pf(p.takeProfit1)} / ${pf(p.takeProfit2)}`);
      if (p.trailStop != null) push(`- 移動停利參考：${pf(p.trailStop)}`);
      if (p.note) push(`- 說明：${p.note}`);
    }
  }

  // 籌碼
  if (fm && (fm.sum || fm.margin)) {
    sec('籌碼（近 5 日 / 餘額）');
    if (fm.sum) push(`- 外資：${sf(fm.sum.外資)} 張　投信：${sf(fm.sum.投信)} 張　自營：${sf(fm.sum.自營)} 張`);
    if (fm.margin) {
      push(`- 融資餘額：${nf(fm.margin.marginBal)} 張（近 5 日 ${sf(fm.margin.marginChg)}）`);
      push(`- 融券餘額：${nf(fm.margin.shortBal)} 張（近 5 日 ${sf(fm.margin.shortChg)}）`);
    }
  }

  // 近期數據事件
  sec('近期數據事件（由數據推導）');
  const evList = Array.isArray(events) ? events : (events?.events || []);
  if (evList.length) evList.forEach((e) => push(`- ${e.text}`));
  else push('- 資料不足，目前沒有可由數據佐證的明確事件。');

  // AI 五大面向
  const fivePresent = ['fundamental', 'technical', 'chips', 'news', 'industry'].some((k) => result[k]);
  if (fivePresent) {
    sec('AI 五大面向');
    if (result.fundamental) push(`**基本面**：${result.fundamental}`, '');
    if (result.technical) push(`**技術面**：${result.technical}`, '');
    if (result.chips) push(`**籌碼面**：${result.chips}`, '');
    push(`**消息面**：${result.news || '資料不足（目前無可驗證之近期新聞來源）'}`, '');
    if (result.industry) push(`**產業地位**：${result.industry}`, '');
    push('> 基本面／消息面／產業由 AI 整理，可能不完整或有誤，請自行查證最新公告與新聞，勿據此直接買賣。');
  }

  if (result.buyPoint) { sec('買點條件觀察（研究輔助）'); push(result.buyPoint); }

  // 我的持股紀錄
  const n = note || {};
  const noteFields = ['buyPrice', 'shares', 'reason', 'stopLoss', 'takeProfit', 'exitRule'];
  const noteHasContent = n.held === true || noteFields.some((k) => n[k] != null && String(n[k]).trim() !== '');
  if (noteHasContent) {
    sec('我的持股紀錄');
    push(`- 是否持有：${n.held ? '持有' : '未持有'}`);
    if (String(n.buyPrice || '').trim()) push(`- 買進價格：${n.buyPrice}`);
    if (String(n.shares || '').trim()) push(`- 買進股數：${n.shares}`);
    const pnl = computePnl(n, latestClose);
    if (pnl) {
      const pct = pnl.pct == null ? '' : `（${pnl.pct >= 0 ? '+' : ''}${pnl.pct.toFixed(1)}%）`;
      push(`- 未實現損益：${pnl.pnl >= 0 ? '+' : ''}${Math.round(pnl.pnl).toLocaleString()} ${pct}（依最新收盤 ${pf(latestClose)} 估算）`);
    }
    if (String(n.reason || '').trim()) push(`- 買進理由：${n.reason}`);
    const hs = buildHoldingStatus(n, latestClose);
    if (String(n.stopLoss || '').trim()) {
      const d = hs?.stop && !hs.stop.hit ? `（距現價約 ${hs.stop.pct.toFixed(1)}%）` : hs?.stop?.hit ? '（已跌破）' : '';
      push(`- 預計停損：${n.stopLoss}${d}`);
    }
    if (String(n.takeProfit || '').trim()) {
      const d = hs?.take && !hs.take.hit ? `（距現價約 ${hs.take.pct.toFixed(1)}%）` : hs?.take?.hit ? '（已達成）' : '';
      push(`- 預計停利：${n.takeProfit}${d}`);
    }
    if (String(n.exitRule || '').trim()) push(`- 出場條件：${n.exitRule}`);
    if (hs?.alerts?.length) hs.alerts.forEach((a) => push(`- ⚠ 條件提醒：${a.text}`));
  }

  if (String(n.watchPoints || '').trim()) { sec('觀察重點'); push(n.watchPoints); }
  if (String(n.notes || '').trim()) { sec('個人筆記'); push(n.notes); }

  if (Array.isArray(result.risks) && result.risks.length) {
    sec('風險提示');
    result.risks.forEach((r) => push(`- ${r}`));
  }

  push('', '---');
  push('本報告由台股分析工具產生，僅供個人研究與資料整理，不構成任何投資建議或買賣推薦。投資有風險，請自行評估並嚴設停損。');

  return out.join('\n');
}
