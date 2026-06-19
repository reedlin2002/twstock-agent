/* 數字／日期格式化小工具 */

// 日期 YYYY-MM-DD → M/D（給圖表 X 軸用）
export const fmtMD = (s) => { const p = String(s).split('-'); return p.length === 3 ? `${+p[1]}/${+p[2]}` : s; };

// 整數千分位（無號）
export const nf = (x) => (x == null || isNaN(x)) ? '—' : Math.round(x).toLocaleString();

// 整數千分位（帶正負號）
export const sf = (x) => (x == null || isNaN(x)) ? '—' : (x > 0 ? '+' : '') + Math.round(x).toLocaleString();

// 一位小數
export const pf = (x) => (x == null || isNaN(x)) ? '—' : Number(x).toLocaleString(undefined, { maximumFractionDigits: 1 });

// 區間字串 a-b
export const rangef = (a, b) => (a == null || b == null ? '—' : `${pf(a)}-${pf(b)}`);

// 四捨五入到指定小數位，無效值回 null
export const roundMaybe = (value, digits = 2) => {
  if (value == null || Number.isNaN(Number(value))) return null;
  return Number(Number(value).toFixed(digits));
};

// n 天前的日期字串（YYYY-MM-DD）
export const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
