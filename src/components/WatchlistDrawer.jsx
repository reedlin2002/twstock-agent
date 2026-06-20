/* 自選股抽屜：右上漢堡選單點開後，從右側滑出。
 * 隨時可達（首頁與個股頁都點得到），列出自選股 + 即時報價（紅漲綠跌），
 * 點任一檔直接開線圖與價格，不必再按搜尋。互動沿用 GlossaryModal 那套。
 */
import { useEffect, useState } from 'react';
import { Star, X, RefreshCw, Search, Clock, Plus } from 'lucide-react';
import { useScrollLock } from '../lib/useScrollLock.js';
import { getNote } from '../lib/storage.js';
import { computePnl } from '../lib/holdingStatus.js';
import { pf } from '../lib/format.js';

// 單列報價（紅漲綠跌；載入中顯示骨架；無資料顯示「—」）
function Quote({ quote, loading }) {
  if (!quote) return loading ? <span className="wl-sk" /> : <span className="wl-prc dim">—</span>;
  if (quote.close == null) return <span className="wl-prc dim">—</span>;
  const up = quote.chg == null ? null : quote.chg >= 0;
  return (
    <span className="wl-q">
      <span className="wl-prc">{pf(quote.close)}</span>
      {quote.chgPct != null && (
        <span className={`wl-chg ${up ? 'u' : 'd'}`}>
          {up ? '▲' : '▼'} {Math.abs(quote.chgPct).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

export default function WatchlistDrawer({
  open,
  onClose,
  watchlist = [],
  recent = [],
  quotes = {},
  quotesLoading = false,
  currentCode,
  currentName,
  currentWatched,
  onSelect,
  onRemove,
  onSearch,
  onRefresh,
  onAddCurrent,
}) {
  useScrollLock(open);
  const [term, setTerm] = useState('');

  // ESC 關閉
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const submitSearch = () => {
    const t = term.trim();
    if (!t) return;
    onSearch(t);
    setTerm('');
  };

  return (
    <div className={`wl-overlay ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="wl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="自選股選單">
        <div className="wl-hd">
          <div className="wl-tt">
            <Star size={18} />自選股
            <span className="wl-badge">{watchlist.length}</span>
          </div>
          <div className="wl-hd-acts">
            <button
              className="wl-icon"
              onClick={onRefresh}
              disabled={quotesLoading || watchlist.length === 0}
              title="刷新報價"
              aria-label="刷新報價"
            >
              <RefreshCw size={16} className={quotesLoading ? 'spin' : ''} />
            </button>
            <button className="wl-icon" onClick={onClose} title="關閉" aria-label="關閉"><X size={18} /></button>
          </div>
        </div>

        <div className="wl-bd">
          {/* 抽屜內直接搜尋 */}
          <div className="wl-search">
            <Search size={16} />
            <input
              className="wl-in"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
              placeholder="輸入代號或名稱，例如 2330 / 華通"
            />
          </div>

          {/* 一鍵把目前個股加入自選 */}
          {currentCode && !currentWatched && (
            <button className="wl-add" onClick={onAddCurrent}>
              <Plus size={15} />把「{currentName || currentCode}」加入自選
            </button>
          )}

          {/* 自選股清單 */}
          {watchlist.length === 0 ? (
            <div className="wl-empty">
              <Star size={22} />
              <div>還沒有自選股</div>
              <div className="wl-empty-d">查詢個股後點「收藏」即可加入，這裡就能隨時看價格與線圖。</div>
            </div>
          ) : (
            <div className="wl-list">
              {watchlist.map((it) => {
                const q = quotes[it.code];
                const pnl = q && q.close != null ? computePnl(getNote(it.code), q.close) : null;
                return (
                  <div
                    key={it.code}
                    className={`wl-row ${it.code === currentCode ? 'cur' : ''}`}
                    onClick={() => onSelect(it.code, it.name)}
                  >
                    <div className="wl-meta">
                      <div className="wl-name">
                        {it.name || it.code}<span className="wl-code">{it.code}</span>
                      </div>
                      {pnl && pnl.pct != null && (
                        <div className={`wl-pnl ${pnl.pnl >= 0 ? 'u' : 'd'}`}>
                          持有 {pnl.pnl >= 0 ? '+' : ''}{pnl.pct.toFixed(1)}%
                        </div>
                      )}
                    </div>
                    <Quote quote={q} loading={quotesLoading} />
                    <button
                      className="wl-rm"
                      title="移除自選"
                      aria-label="移除自選"
                      onClick={(e) => { e.stopPropagation(); onRemove(it.code); }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 最近查詢 */}
          {recent.length > 0 && (
            <div className="wl-recent">
              <div className="wl-sec"><Clock size={13} />最近查詢</div>
              <div className="wl-chips">
                {recent.map((it) => (
                  <button key={it.code} className="wl-chip" onClick={() => onSelect(it.code, it.name)}>
                    {it.name || it.code}<span className="wl-code">{it.code}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="wl-foot">
            報價來源 Yahoo Finance，盤中約即時、可能延遲；非交易時段顯示最新收盤。僅供研究參考，不構成投資建議。
          </div>
        </div>
      </div>
    </div>
  );
}
