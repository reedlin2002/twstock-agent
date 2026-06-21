/* 解析 AI 回應（用 @@欄位名@@ 標記分段，不用 JSON） */

const KEYMAP = {
  NAME: 'name', TICKER: 'ticker', EXCHANGE: 'exchange', SECTOR: 'sector', SNAPSHOT: 'snapshot',
  FUNDAMENTAL: 'fundamental', TECHNICAL: 'technical', CHIPS: 'chips', NEWS: 'news',
  INDUSTRY: 'industry', BUYPOINT: 'buyPoint', POSITION: 'position', RISKS: 'risks', DATANOTE: 'dataNote',
};

// AI 偶爾會把提示詞/JSON 裡的內部資料欄位名（providedData.* / tradePlan 等）寫進內文，
// 這裡當安全網把它們換成自然中文，避免「依據 providedData.technical」這種程式味字眼外洩。
const LEAK_TERMS = [
  [/providedData\s*\.\s*technical\s*\.\s*tradePlan/gi, '買賣計畫'],
  [/providedData\s*\.\s*priceSeries/gi, '股價走勢'],
  [/providedData\s*\.\s*technical/gi, '技術指標'],
  [/providedData\s*\.\s*chips/gi, '法人籌碼'],
  [/providedData\s*\.\s*margin/gi, '融資融券'],
  [/providedData\s*\.\s*fundamental/gi, '基本面數據'],
  [/providedData\s*\.\s*industry/gi, '產業數據'],
  [/providedData\s*\.\s*news/gi, '新聞資料'],
  [/providedData(?:\s*\.\s*[a-zA-Z]+)*/gi, '提供的數據'],
  [/\buserPosition\b/gi, '你的部位'],
  [/\btechnical\s*\.\s*tradePlan/gi, '買賣計畫'],
  [/\btradePlan\b/gi, '買賣計畫'],
  [/\bpriceSeries\b/gi, '股價走勢'],
  [/\btrendChecklist\b/gi, '趨勢檢查表'],
];

// 清理外洩欄位名，並收掉替換後殘留的空白
export function sanitizeLeaks(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [re, rep] of LEAK_TERMS) out = out.replace(re, rep);
  out = out
    .replace(/(依據|根據|依|據)[ \t]+/g, '$1')                  // 「依據 技術指標」→「依據技術指標」
    .replace(/([一-鿿])[ \t]+(?=[一-鿿])/g, '$1') // 兩個中文字之間的多餘空白
    .replace(/[ \t]+([，。、；：）」』】])/g, '$1')               // 全形標點前空白
    .replace(/([（「『【])[ \t]+/g, '$1')                        // 全形括號後空白
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
  return out;
}

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
  // 安全網：清掉所有文字欄位裡外洩的內部欄位名
  for (const k of Object.keys(out)) {
    if (typeof out[k] === 'string') out[k] = sanitizeLeaks(out[k]);
    else if (Array.isArray(out[k])) out[k] = out[k].map(sanitizeLeaks);
  }
  return Object.keys(out).length ? out : null;
}
