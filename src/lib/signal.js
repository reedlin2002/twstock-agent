/* 自選股首頁的「便宜訊號層」：只用輕量報價／迷你走勢計算，不跑 AI、不打額外請求。
 * 給訊號燈（偏多/偏空/中性）用，對齊免費模型 rate limit 的限制（背景只刷這層，不刷 AI）。 */

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

// 迷你走勢動能訊號：up（偏多）/ down（偏空）/ neutral（中性）；資料不足回 neutral
export function quickSignal(spark) {
  const a = (spark || []).filter((x) => x != null);
  if (a.length < 6) return 'neutral';
  const last = a[a.length - 1];
  const maShort = mean(a.slice(-5));
  const maLong = mean(a.slice(-Math.min(a.length, 20)));
  if (last >= maShort && maShort >= maLong) return 'up';
  if (last <= maShort && maShort <= maLong) return 'down';
  return 'neutral';
}

// 紅漲綠跌：偏多紅、偏空綠、中性灰
export const SIGNAL_META = {
  up: { label: '偏多', color: '#E0413C' },
  down: { label: '偏空', color: '#26A269' },
  neutral: { label: '中性', color: '#7E7464' },
};
