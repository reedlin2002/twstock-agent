/* AI 分析結果與「進行中」狀態的持久化。
 * 用途：手機把 App 從多工列滑掉會殺掉 WebView、中斷分析；把已完成結果與進行中標記寫進
 * localStorage，重開 App 時可還原上次結果，或提示上次分析未完成、一鍵重試。
 */
import { STORAGE_KEYS, safeGet, safeSet } from './storage.js';

const RESULT_MAX = 30; // 最多保留最近 30 檔的分析結果

const cleanCode = (code) => (code == null ? '' : String(code).trim());

// 讀某代號的上次分析結果：{ result, name, ts } 或 null
export function loadAiResult(code) {
  const c = cleanCode(code);
  if (!c) return null;
  const all = safeGet(STORAGE_KEYS.aiResults, {});
  const rec = all && typeof all === 'object' ? all[c] : null;
  return rec && rec.result ? rec : null;
}

// 存某代號的分析結果（result 為 parseReport 後的物件，可序列化）
export function saveAiResult(code, name, result) {
  const c = cleanCode(code);
  if (!c || !result) return;
  const all = safeGet(STORAGE_KEYS.aiResults, {});
  const map = all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  map[c] = { result, name: name ? String(name) : '', ts: Date.now() };
  // 控制筆數：保留最近的 RESULT_MAX 檔
  const trimmed = Object.entries(map)
    .sort((a, b) => (b[1]?.ts || 0) - (a[1]?.ts || 0))
    .slice(0, RESULT_MAX);
  safeSet(STORAGE_KEYS.aiResults, Object.fromEntries(trimmed));
}

/* ---------- 進行中標記 ---------- */

export function savePending(code, name) {
  const c = cleanCode(code);
  if (!c) return;
  safeSet(STORAGE_KEYS.aiPending, { code: c, name: name ? String(name) : '', startedAt: Date.now() });
}

export function loadPending() {
  const p = safeGet(STORAGE_KEYS.aiPending, null);
  return p && p.code ? p : null;
}

export function clearPending() {
  safeSet(STORAGE_KEYS.aiPending, null);
}

// 上次是否有「最近啟動但未完成」的分析（預設 10 分鐘內才算，避免久遠殘留）
export function stalelessPending(maxAgeMs = 10 * 60 * 1000) {
  const p = loadPending();
  if (!p) return null;
  if (Date.now() - (p.startedAt || 0) > maxAgeMs) { clearPending(); return null; }
  return p;
}
