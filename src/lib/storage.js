/* localStorage 安全層（防呆）＋ 個人化資料 helpers
 * 原則：所有讀寫都包 try/catch，壞資料一律回預設值，絕不讓 App crash。
 */

export const STORAGE_KEYS = {
  notes: 'twstock.notes.v1',
  watchlist: 'twstock.watchlist.v1',
  recent: 'twstock.recent.v1',
};

// 個人紀錄預設形狀（欄位皆字串，計算時再轉數字）
export const DEFAULT_NOTE = {
  held: false,
  buyPrice: '',
  shares: '',
  reason: '',
  stopLoss: '',
  takeProfit: '',
  exitRule: '',
  watchPoints: '',
  notes: '',
  updatedAt: null,
};

const hasStorage = () => {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
};

// 安全讀取：解析失敗 / 型別不符一律回 fallback
export function safeGet(key, fallback) {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    if (parsed == null) return fallback;
    // 形狀粗略檢查：fallback 是陣列就必須是陣列；是物件就必須是非陣列物件
    if (Array.isArray(fallback) && !Array.isArray(parsed)) return fallback;
    if (!Array.isArray(fallback) && typeof fallback === 'object'
      && (typeof parsed !== 'object' || Array.isArray(parsed))) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

// 安全寫入：吞掉 quota / 無痕模式錯誤，回傳是否成功
export function safeSet(key, value) {
  if (!hasStorage()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const cleanCode = (code) => (code == null ? '' : String(code).trim());

/* ---------- 個人紀錄（依代號存） ---------- */

// 全部紀錄 map：{ [code]: note }
export function loadNotes() {
  const obj = safeGet(STORAGE_KEYS.notes, {});
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
}

// 取單一代號的紀錄（補齊缺漏欄位，永遠回完整形狀）
export function getNote(code) {
  const c = cleanCode(code);
  const all = loadNotes();
  const rec = c && all[c] && typeof all[c] === 'object' ? all[c] : {};
  return { ...DEFAULT_NOTE, ...rec };
}

// 存單一代號的紀錄
export function saveNote(code, record) {
  const c = cleanCode(code);
  if (!c) return getNote(code);
  const all = loadNotes();
  const next = { ...DEFAULT_NOTE, ...record, updatedAt: new Date().toISOString() };
  all[c] = next;
  safeSet(STORAGE_KEYS.notes, all);
  return next;
}

// 清除單一代號的紀錄
export function clearNote(code) {
  const c = cleanCode(code);
  const all = loadNotes();
  if (c && all[c]) {
    delete all[c];
    safeSet(STORAGE_KEYS.notes, all);
  }
  return { ...DEFAULT_NOTE };
}

// 判斷某代號是否已有實質紀錄（用來決定是否顯示「有筆記」標記）
export function hasNote(code) {
  const c = cleanCode(code);
  const all = loadNotes();
  const rec = all[c];
  if (!rec || typeof rec !== 'object') return false;
  return Object.keys(DEFAULT_NOTE).some((k) => {
    if (k === 'updatedAt') return false;
    if (k === 'held') return rec.held === true;
    return rec[k] != null && String(rec[k]).trim() !== '';
  });
}

/* ---------- 自選股 ---------- */

// 過濾出合法 { code, name } 陣列
const normalizeList = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((it) => it && typeof it === 'object' && cleanCode(it.code))
    .map((it) => ({ code: cleanCode(it.code), name: it.name ? String(it.name) : '', ts: it.ts }));

export function loadWatchlist() {
  return normalizeList(safeGet(STORAGE_KEYS.watchlist, []));
}

export function isWatched(list, code) {
  const c = cleanCode(code);
  return normalizeList(list).some((it) => it.code === c);
}

// 切換收藏，回傳新清單
export function toggleWatch(list, code, name) {
  const c = cleanCode(code);
  if (!c) return normalizeList(list);
  const cur = normalizeList(list);
  const exists = cur.some((it) => it.code === c);
  const next = exists
    ? cur.filter((it) => it.code !== c)
    : [{ code: c, name: name ? String(name) : '' }, ...cur];
  safeSet(STORAGE_KEYS.watchlist, next);
  return next;
}

/* ---------- 最近查詢 ---------- */

const RECENT_MAX = 12;

export function loadRecent() {
  return normalizeList(safeGet(STORAGE_KEYS.recent, []));
}

// 推入一筆最近查詢（依代號去重、最新在前、上限 12）
export function pushRecent(list, code, name) {
  const c = cleanCode(code);
  if (!c) return normalizeList(list);
  const cur = normalizeList(list).filter((it) => it.code !== c);
  const next = [{ code: c, name: name ? String(name) : '', ts: Date.now() }, ...cur].slice(0, RECENT_MAX);
  safeSet(STORAGE_KEYS.recent, next);
  return next;
}
