/* 數據格（法人買賣超 / 融資融券） */
import { nf, sf } from '../lib/format.js';

export const Stat = ({ k, v, signed, unit }) => {
  const num = typeof v === 'number', cls = signed && num ? (v >= 0 ? 'u' : 'd') : '';
  return (<div className="st"><div className="k">{k}</div>
    <div className={`v ${cls}`}>{num ? (signed ? sf(v) : nf(v)) : v}<span style={{ fontSize: 11, color: 'var(--faint)', marginLeft: 3 }}>{unit}</span></div></div>);
};
