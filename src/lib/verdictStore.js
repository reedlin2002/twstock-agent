/* AI 看法戰績：把每次 AI 給的「傾向＋信心度＋推翻價位」連同當下股價存起來，
 * 之後自動回查兌現情況（命中率），並把「推翻價位」交給背景監看當活的停損哨。 */
import { STORAGE_KEYS, safeGet, safeSet } from './storage.js';

const PER_CODE_MAX = 20; // 每檔最多保留 20 筆看法
const CODES_MAX = 60;    // 最多保留 60 檔

const cleanCode = (c) => (c == null ? '' : String(c).trim());

// 傾向文字 → 方向（與結果頁 AI 看法卡同一套判斷）
export const leanDir = (text = '') => {
  if (/偏多|看多|多方|轉強|偏向多/.test(text)) return 'up';
  if (/偏空|看空|空方|轉弱|偏向空/.test(text)) return 'down';
  return 'neutral';
};

// 解析 @@INVLEVEL@@ → { level, dir }；容忍兩種語序（"560 below" 或 "跌破 88"）
export const parseInvLevel = (s) => {
  if (!s) return { level: null, dir: null };
  const str = String(s);
  const num = str.match(/\d+(?:\.\d+)?/);
  if (!num) return { level: null, dir: null };
  const level = Number(num[0]);
  const dir = /below|跌破|以下|破/i.test(str) ? 'below' : /above|站上|以上|突破/i.test(str) ? 'above' : null;
  if (!Number.isFinite(level) || !dir) return { level: null, dir: null };
  return { level, dir };
};

const readAll = () => {
  const all = safeGet(STORAGE_KEYS.verdicts, {});
  return (all && typeof all === 'object' && !Array.isArray(all)) ? all : {};
};

export function saveVerdict(code, name, v) {
  const c = cleanCode(code);
  if (!c || !v) return;
  const map = readAll();
  const prev = Array.isArray(map[c]?.list) ? map[c].list : [];
  prev.unshift({
    ts: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    price: Number.isFinite(v.price) ? v.price : null,
    lean: v.lean || 'neutral',
    confidence: v.confidence || '',
    invalidate: v.invalidate || '',
    invLevel: Number.isFinite(v.invLevel) ? v.invLevel : null,
    invDir: v.invDir || null,
  });
  map[c] = { name: name ? String(name) : (map[c]?.name || ''), list: prev.slice(0, PER_CODE_MAX) };
  const trimmed = Object.entries(map)
    .sort((a, b) => (b[1]?.list?.[0]?.ts || 0) - (a[1]?.list?.[0]?.ts || 0))
    .slice(0, CODES_MAX);
  safeSet(STORAGE_KEYS.verdicts, Object.fromEntries(trimmed));
}

export function loadVerdicts(code) {
  const c = cleanCode(code);
  if (!c) return [];
  const map = readAll();
  return Array.isArray(map[c]?.list) ? map[c].list : [];
}

// 戰績：只看「有方向」且已過 minAgeDays（給它時間兌現）的看法
export function scoreVerdicts(code, currentPrice, { minAgeDays = 3 } = {}) {
  const list = loadVerdicts(code);
  const now = Date.now();
  const ageMs = minAgeDays * 86400000;
  let total = 0;
  let hits = 0;
  const judged = [];
  for (const v of list) {
    if (v.lean === 'neutral' || v.price == null || !Number.isFinite(currentPrice)) continue;
    if (now - v.ts < ageMs) continue;
    const ret = (currentPrice - v.price) / v.price;
    const hit = (v.lean === 'up' && ret > 0) || (v.lean === 'down' && ret < 0);
    total += 1;
    if (hit) hits += 1;
    judged.push({ ...v, ret, hit });
  }
  return { total, hits, rate: total ? hits / total : null, judged, pending: list.length - total };
}

// 背景監看用：某檔最新一筆「有推翻價位」的看法
export function latestInvalidation(code) {
  const v = loadVerdicts(code).find((x) => x.invLevel != null && x.invDir);
  return v ? { level: v.invLevel, dir: v.invDir, lean: v.lean, date: v.date } : null;
}
