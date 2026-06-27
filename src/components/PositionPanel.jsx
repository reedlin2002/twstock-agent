/* 我的部位（個人化進出場）輸入面板：放在「AI 深入分析」按鈕附近。
 * - 已持有：填買進價／股數（自「我的紀錄」預帶），即時看成本、未實現損益、距停損、已走 R。
 * - 未持有：填可投入金額（與可選預計買價），即時試算張數、部位成本、最大風險與風險佔資金%。
 * 勾選「納入 AI 分析」後，按 AI 分析時會把這些數字一起帶入，產生個人化進出場說明。
 */
import { useEffect, useState } from 'react';
import { Wallet, Sparkles, ChevronDown } from 'lucide-react';
import { buildPositionPlan } from '../lib/positionPlan.js';
import { pf } from '../lib/format.js';

const money = (x) => (x == null ? '—' : Math.round(x).toLocaleString());

export default function PositionPanel({ note, latestClose, tradePlan, enabled, onEnabledChange, onPositionChange }) {
  const [open, setOpen] = useState(false); // 預設收起，點開才展開（減少個股頁資訊量）
  const [held, setHeld] = useState(false);
  const [buyPrice, setBuyPrice] = useState('');
  const [shares, setShares] = useState('');
  const [capital, setCapital] = useState('');
  const [plannedBuyPrice, setPlannedBuyPrice] = useState('');

  // 切換個股（note 變動）時，用該股紀錄預帶
  useEffect(() => {
    setHeld(note?.held === true);
    setBuyPrice(note?.buyPrice || '');
    setShares(note?.shares || '');
  }, [note]);

  // 組出要回報與試算用的 position；輸入變動就往上同步
  const position = {
    held,
    buyPrice, shares,
    stopLoss: note?.stopLoss, takeProfit: note?.takeProfit,
    capital, plannedBuyPrice, plannedShares: null,
  };
  useEffect(() => {
    onPositionChange?.(position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, buyPrice, shares, capital, plannedBuyPrice, note]);

  const plan = buildPositionPlan({ position, latestClose, tradePlan });

  return (
    <div className={`pos ${enabled ? 'on' : ''}`}>
      <div className="pos-hd">
        <button type="button" className="pos-tt pos-tt-btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Wallet size={15} />我的部位 · 個人化進出場
          <ChevronDown size={15} className="pos-chev" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
        </button>
        <label className="pos-switch">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange?.(e.target.checked)} />
          <span className="aiswitch" />
          <span className="pos-switch-tx">納入 AI 分析</span>
        </label>
      </div>

      {open && (
        <>
      <div className="pos-seg">
        <button type="button" className={held ? 'on' : ''} onClick={() => setHeld(true)}>持有中</button>
        <button type="button" className={!held ? 'on' : ''} onClick={() => setHeld(false)}>還沒買（規劃）</button>
      </div>

      {held ? (
        <div className="pos-grid">
          <label className="pos-f"><span>買進價</span>
            <input inputMode="decimal" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} placeholder="例如 92.5" />
          </label>
          <label className="pos-f"><span>股數</span>
            <input inputMode="numeric" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="例如 1000" />
          </label>
        </div>
      ) : (
        <div className="pos-grid">
          <label className="pos-f"><span>可投入金額</span>
            <input inputMode="numeric" value={capital} onChange={(e) => setCapital(e.target.value)} placeholder="例如 100000" />
          </label>
          <label className="pos-f"><span>預計買價</span>
            <input inputMode="decimal" value={plannedBuyPrice} onChange={(e) => setPlannedBuyPrice(e.target.value)}
              placeholder={tradePlan?.entryHigh ? `留白用 ${pf(tradePlan.entryHigh)}` : '留白用觀察區'} />
          </label>
        </div>
      )}

      {/* 本地即時試算 */}
      {plan && plan.kind === 'held' && (
        <div className="pos-calc">
          <span className="pos-chip"><b>成本</b>{money(plan.cost)}</span>
          <span className={`pos-chip ${plan.pnl >= 0 ? 'u' : 'd'}`}><b>損益</b>{plan.pnl >= 0 ? '+' : ''}{money(plan.pnl)}{plan.pnlPct != null && `（${plan.pnlPct >= 0 ? '+' : ''}${plan.pnlPct.toFixed(1)}%）`}</span>
          {plan.toStopPct != null && <span className="pos-chip"><b>距停損</b>{plan.toStopPct.toFixed(1)}%</span>}
          {plan.rMultiple != null && <span className="pos-chip"><b>已走</b>{plan.rMultiple.toFixed(2)}R</span>}
        </div>
      )}
      {plan && plan.kind === 'plan' && (
        <div className="pos-calc">
          {plan.shares != null && <span className="pos-chip"><b>建議</b>{plan.lots} 張{plan.oddShares ? ` +${plan.oddShares} 股` : ''}</span>}
          {plan.positionCost != null && <span className="pos-chip"><b>部位</b>{money(plan.positionCost)}</span>}
          {plan.totalRisk != null && <span className="pos-chip d"><b>最大風險</b>{money(plan.totalRisk)}{plan.riskPctOfCapital != null && `（${plan.riskPctOfCapital.toFixed(1)}%）`}</span>}
          {plan.riskPerShare != null && <span className="pos-chip"><b>每股風險</b>{pf(plan.riskPerShare)}</span>}
        </div>
      )}
      {plan?.warnings?.map((w, i) => <div className="pos-warn" key={i}>{w}</div>)}

      {enabled && (
        <div className="pos-hint"><Sparkles size={12} />按下「AI 深入分析」會一起帶入你的部位，產出個人化進出場說明（條件提醒，非買賣建議）。</div>
      )}
        </>
      )}
    </div>
  );
}
