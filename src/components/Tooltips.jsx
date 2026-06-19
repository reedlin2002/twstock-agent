/* Recharts 自訂 tooltip：股價走勢圖、法人籌碼圖 */
import { nf, sf } from '../lib/format.js';

export function PriceTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const g = (k) => { const f = payload.find((p) => p.dataKey === k); return f ? f.value : null; };
  return (
    <div className="tip"><div className="d">{label}</div>
      <div className="r"><span>收盤</span><b style={{ color: '#E2A636' }}>{nf(g('close'))}</b></div>
      <div className="r"><span>月線</span><b style={{ color: '#5AA9FF' }}>{nf(g('ma20'))}</b></div>
      <div className="r"><span>季線</span><b style={{ color: '#FF85B9' }}>{nf(g('ma60'))}</b></div>
    </div>
  );
}

export function ChipTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  return (
    <div className="tip"><div className="d">{label}（張）</div>
      {['外資', '投信', '自營'].map((k) => (
        <div className="r" key={k}><span>{k}</span><b style={{ color: d[k] >= 0 ? '#E0413C' : '#26A269' }}>{sf(d[k])}</b></div>
      ))}
    </div>
  );
}
