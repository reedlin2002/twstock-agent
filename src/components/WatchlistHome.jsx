/* 國泰式自選股首頁儀表板：打開 App 直接看到自選股的走勢＋即時報價＋訊號燈。
 * - 走勢用輕量報價附帶的迷你序列（spark）畫 sparkline，不另外打請求。
 * - 訊號燈來自便宜的動能訊號層（signal.js），不跑 AI。
 * - 點任一檔即開該股進入既有的分析流程。 */
import { Star, RefreshCw, ChevronRight } from 'lucide-react';
import { getNote } from '../lib/storage.js';
import { computePnl } from '../lib/holdingStatus.js';
import { pf } from '../lib/format.js';
import { quickSignal, SIGNAL_META } from '../lib/signal.js';

// 迷你走勢線（紅漲綠跌，以區間首尾判方向）
function Sparkline({ data, w = 76, h = 26 }) {
  const a = (data || []).filter((x) => x != null);
  if (a.length < 2) return <svg className="wh-spark" width={w} height={h} aria-hidden="true" />;
  const min = Math.min(...a);
  const max = Math.max(...a);
  const span = max - min || 1;
  const stepX = w / (a.length - 1);
  const pts = a
    .map((v, i) => `${(i * stepX).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`)
    .join(' ');
  const color = a[a.length - 1] >= a[0] ? '#E0413C' : '#26A269';
  return (
    <svg className="wh-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function WatchlistHome({ items = [], quotes = {}, quotesLoading = false, onSelect, onRefresh }) {
  if (!items.length) return null;
  const ov = items.reduce((a, it) => {
    const q = quotes[it.code];
    if (q && q.chgPct != null) { a.n += 1; if (q.chgPct > 0) a.up += 1; else if (q.chgPct < 0) a.down += 1; }
    return a;
  }, { n: 0, up: 0, down: 0 });

  return (
    <div className="wh-wrap">
      <div className="wh-head">
        <span className="wh-tt"><Star size={15} />我的自選股<span className="wh-n">{items.length}</span></span>
        {ov.n > 0 && (
          <span className="wh-ov"><span className="u">▲{ov.up}</span><span className="d">▼{ov.down}</span></span>
        )}
        <button className="wh-icon" onClick={onRefresh} disabled={quotesLoading} title="刷新報價" aria-label="刷新報價">
          <RefreshCw size={14} className={quotesLoading ? 'spin' : ''} />
        </button>
      </div>

      <div className="wh-list">
        {items.map((it) => {
          const q = quotes[it.code];
          const sig = SIGNAL_META[quickSignal(q?.spark)];
          const up = q?.chg == null ? null : q.chg >= 0;
          const pnl = q && q.close != null ? computePnl(getNote(it.code), q.close) : null;
          return (
            <button key={it.code} className="wh-row" onClick={() => onSelect(it.code, it.name)}>
              <span className="wh-left">
                <span className="wh-name">{it.name || it.code}<span className="wh-code">{it.code}</span></span>
                <span className="wh-sub">
                  <span className="wh-sig" style={{ background: sig.color }} />{sig.label}
                  {pnl && pnl.pct != null && (
                    <span className={`wh-pnl ${pnl.pnl >= 0 ? 'u' : 'd'}`}>持有 {pnl.pnl >= 0 ? '+' : ''}{pnl.pct.toFixed(1)}%</span>
                  )}
                </span>
              </span>

              <Sparkline data={q?.spark} />

              <span className="wh-right">
                {q && q.close != null ? (
                  <>
                    <span className="wh-prc">{pf(q.close)}</span>
                    {q.chgPct != null && (
                      <span className={`wh-chg ${up ? 'u' : 'd'}`}>{up ? '▲' : '▼'} {Math.abs(q.chgPct).toFixed(2)}%</span>
                    )}
                  </>
                ) : (
                  <span className="wh-prc dim">{quotesLoading ? '…' : '—'}</span>
                )}
              </span>
              <ChevronRight size={16} className="wh-arrow" />
            </button>
          );
        })}
      </div>
      <div className="wh-foot">訊號燈為迷你走勢動能（偏多/偏空/中性），非投資建議；點任一檔看完整分析。</div>
    </div>
  );
}
