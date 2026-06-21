/* Samsung One UI 省電提醒卡：原生 App 首次使用時顯示一次，引導關閉省電最佳化、允許通知，
 * 讓「分析中／分析完成」與「到價提醒」通知能準時送達。Web 不顯示，按關閉後不再出現。
 */
import { useState } from 'react';
import { BatteryWarning, X } from 'lucide-react';
import { isNative } from '../lib/native.js';

const KEY = 'twstock.tip.battery.v1';

export default function BatteryTipCard() {
  const [hidden, setHidden] = useState(() => {
    try { return !isNative() || localStorage.getItem(KEY) === '1'; } catch { return true; }
  });
  if (hidden) return null;

  const close = () => {
    try { localStorage.setItem(KEY, '1'); } catch { /* no-op */ }
    setHidden(true);
  };

  return (
    <div className="battip">
      <span className="battip-ic"><BatteryWarning size={18} /></span>
      <div className="battip-bd">
        <div className="battip-t">讓通知準時送達（Samsung 必看）</div>
        <div className="battip-d">
          One UI 的省電會延後或擋掉背景提醒。請到「設定 → 應用程式 → 010401 Finance → 電池」選「不受限制」，
          並允許通知；分析中／分析完成與到價提醒才會穩定送達。
        </div>
      </div>
      <button className="battip-x" onClick={close} aria-label="關閉提醒"><X size={16} /></button>
    </div>
  );
}
