/* 解析 AI 回應（用 @@欄位名@@ 標記分段，不用 JSON） */

const KEYMAP = {
  NAME: 'name', TICKER: 'ticker', EXCHANGE: 'exchange', SECTOR: 'sector', SNAPSHOT: 'snapshot',
  FUNDAMENTAL: 'fundamental', TECHNICAL: 'technical', CHIPS: 'chips', NEWS: 'news',
  INDUSTRY: 'industry', BUYPOINT: 'buyPoint', RISKS: 'risks', DATANOTE: 'dataNote',
};

export function parseReport(text) {
  if (!text) return null;
  const re = /@@([A-Z]+)@@/g;
  const ms = []; let m;
  while ((m = re.exec(text)) !== null) ms.push({ key: m[1], s: m.index, e: re.lastIndex });
  if (ms.length === 0) return null;
  const out = {};
  for (let i = 0; i < ms.length; i++) {
    const cur = ms[i], nx = ms[i + 1];
    const val = text.slice(cur.e, nx ? nx.s : text.length).trim();
    const key = KEYMAP[cur.key] || cur.key.toLowerCase();
    if (val) out[key] = val;
  }
  if (out.risks) out.risks = out.risks.split(/\||\n/).map((s) => s.replace(/^[-•\s]+/, '').trim()).filter(Boolean);
  return Object.keys(out).length ? out : null;
}
