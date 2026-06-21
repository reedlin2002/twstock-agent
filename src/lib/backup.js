/* 個人資料備份：把自選股群組、我的紀錄、最近查詢序列化成一段 JSON，
 * 可複製保存或在另一台裝置還原。匯入支援「合併」與「覆蓋」。沿用 storage 防呆層。
 */
import {
  STORAGE_KEYS, safeGet, safeSet, loadNotes, loadWatchlistV2, saveWatchlistV2,
} from './storage.js';

const BACKUP_VERSION = 1;

// 產生備份字串（給使用者複製或存檔）
export function buildBackup() {
  return JSON.stringify({
    app: 'twstock-agent',
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      notes: safeGet(STORAGE_KEYS.notes, {}),
      watchlistV2: loadWatchlistV2(),
      recent: safeGet(STORAGE_KEYS.recent, []),
    },
  }, null, 2);
}

// 解析貼上的備份字串；格式不符回 null
export function parseBackup(text) {
  try {
    const obj = JSON.parse(text);
    if (!obj || obj.app !== 'twstock-agent' || !obj.data || typeof obj.data !== 'object') return null;
    return obj.data;
  } catch {
    return null;
  }
}

// 摘要：給匯入確認畫面顯示「將還原 X 檔自選 / Y 群組 / Z 筆紀錄」
export function summarizeBackup(data) {
  const wl = data?.watchlistV2 || {};
  return {
    items: Array.isArray(wl.items) ? wl.items.length : 0,
    groups: Array.isArray(wl.groups) ? wl.groups.length : 0,
    notes: data?.notes && typeof data.notes === 'object' ? Object.keys(data.notes).length : 0,
  };
}

// 套用備份。mode：'replace' 覆蓋 | 'merge' 合併（既有資料優先保留）
export function applyBackup(data, mode = 'merge') {
  if (!data || typeof data !== 'object') return false;

  // 我的紀錄
  if (data.notes && typeof data.notes === 'object') {
    const next = mode === 'replace' ? data.notes : { ...data.notes, ...loadNotes() };
    safeSet(STORAGE_KEYS.notes, next);
  }

  // 自選股 v2（合併時把既有放前面，normalize 會以「先出現者」為準保留既有 id/code）
  if (data.watchlistV2 && typeof data.watchlistV2 === 'object') {
    if (mode === 'replace') {
      saveWatchlistV2(data.watchlistV2);
    } else {
      const cur = loadWatchlistV2();
      saveWatchlistV2({
        version: 2,
        groups: [...cur.groups, ...(data.watchlistV2.groups || [])],
        items: [...cur.items, ...(data.watchlistV2.items || [])],
      });
    }
  }

  // 最近查詢
  if (Array.isArray(data.recent)) {
    if (mode === 'replace') safeSet(STORAGE_KEYS.recent, data.recent);
    else {
      const cur = safeGet(STORAGE_KEYS.recent, []);
      const seen = new Set();
      const merged = [...cur, ...data.recent].filter((it) => {
        const c = it && it.code ? String(it.code) : '';
        if (!c || seen.has(c)) return false;
        seen.add(c);
        return true;
      }).slice(0, 12);
      safeSet(STORAGE_KEYS.recent, merged);
    }
  }

  return true;
}
