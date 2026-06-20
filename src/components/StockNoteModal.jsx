/* 個人股票紀錄編輯彈窗：沿用投資小辭典的 bottom-sheet 模式。
 * 資料以 localStorage 保存（由 App 透過 onSave / onClear 寫入）。
 */
import { useEffect, useState } from 'react';
import { Notebook, X, Trash2, Check } from 'lucide-react';
import { useScrollLock } from '../lib/useScrollLock.js';
import { DEFAULT_NOTE } from '../lib/storage.js';
import { computePnl } from '../lib/holdingStatus.js';
import { pf } from '../lib/format.js';

export default function StockNoteModal({ open, onClose, code, name, record, latestClose, onSave, onClear }) {
  useScrollLock(open);
  const [draft, setDraft] = useState(DEFAULT_NOTE);

  // 開啟或切換股票時，把表單重置成該股目前的紀錄
  useEffect(() => {
    if (open) setDraft({ ...DEFAULT_NOTE, ...(record || {}) });
  }, [open, record, code]);

  const set = (k) => (e) => {
    const v = e?.target?.type === 'checkbox' ? e.target.checked : e.target.value;
    setDraft((prev) => ({ ...prev, [k]: v }));
  };

  const pnl = computePnl(draft, latestClose);

  const field = (k, label, props = {}) => (
    <label className="nm-field">
      <span className="nm-lab">{label}</span>
      <input className="nm-in" value={draft[k] ?? ''} onChange={set(k)} {...props} />
    </label>
  );
  const area = (k, label, ph) => (
    <label className="nm-field nm-full">
      <span className="nm-lab">{label}</span>
      <textarea className="nm-ta" rows={2} value={draft[k] ?? ''} onChange={set(k)} placeholder={ph} />
    </label>
  );

  return (
    <div className={`glos-overlay ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="glos-panel" onClick={(e) => e.stopPropagation()}>
        <div className="glos-hd">
          <div className="glos-tt"><Notebook size={20} />我的紀錄
            <span className="nm-code">{name || ''} {code || ''}</span>
          </div>
          <button className="glos-cls" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="glos-bd">
          <div className="nm-hold">
            <span className="nm-lab">是否持有</span>
            <button
              type="button"
              className={`nm-toggle ${draft.held ? 'on' : ''}`}
              onClick={() => setDraft((p) => ({ ...p, held: !p.held }))}
            >
              {draft.held ? <><Check size={14} />持有中</> : '未持有'}
            </button>
          </div>

          <div className="nm-grid">
            {field('buyPrice', '買進價格', { inputMode: 'decimal', placeholder: '例如 92.5' })}
            {field('shares', '買進股數', { inputMode: 'numeric', placeholder: '例如 1000' })}
          </div>

          {pnl && (
            <div className="nm-pnl">
              <span>未實現損益（依最新收盤 {pf(latestClose)} 估算）</span>
              <b className={pnl.pnl >= 0 ? 'u' : 'd'}>
                {pnl.pnl >= 0 ? '+' : ''}{Math.round(pnl.pnl).toLocaleString()}
                {pnl.pct != null && <>　{pnl.pct >= 0 ? '+' : ''}{pnl.pct.toFixed(1)}%</>}
              </b>
            </div>
          )}

          <div className="nm-grid">
            {field('stopLoss', '預計停損', { placeholder: '例如 85 或 跌破季線' })}
            {field('takeProfit', '預計停利', { placeholder: '例如 110 或 +20%' })}
          </div>

          {area('reason', '買進理由', '當初為什麼想買 / 看好什麼')}
          {area('exitRule', '出場條件', '什麼情況我會出場')}
          {area('watchPoints', '觀察重點', '要持續追蹤的指標、事件或價位')}
          {area('notes', '個人筆記', '其他想記的事')}

          <div className="nm-foot">
            <button className="nm-clear" type="button" onClick={() => onClear?.()}>
              <Trash2 size={14} />清除此股紀錄
            </button>
            <button className="nm-save" type="button" onClick={() => onSave?.(draft)}>
              <Check size={15} />儲存
            </button>
          </div>
          <div className="nm-tip">資料只存在這台裝置的瀏覽器（localStorage），不會上傳。</div>
        </div>
      </div>
    </div>
  );
}
