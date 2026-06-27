/* localStorage 安全層（防呆）＋ 個人化資料 helpers
 * 原則：所有讀寫都包 try/catch，壞資料一律回預設值，絕不讓 App crash。
 */

export const STORAGE_KEYS = {
  notes: 'twstock.notes.v1',
  watchlist: 'twstock.watchlist.v1',
  watchlistV2: 'twstock.watchlist.v2',
  recent: 'twstock.recent.v1',
  aiResults: 'twstock.ai.results.v1',
  aiPending: 'twstock.ai.pending.v1',
  verdicts: 'twstock.ai.verdicts.v1',
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
  alertOn: false,    // 是否開啟「到價推播」
  alertTarget: '',   // 額外的上方目標價（碰到就推播）
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
    if (k === 'held' || k === 'alertOn') return rec[k] === true;
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

/* ---------- 自選股 v2：群組（groups + items），相容遷移自 v1 ---------- */

export const DEFAULT_GROUP = { id: 'default', name: '我的自選' };

const genGroupId = () => `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// 群組陣列正規化：去重 id、補名稱、確保 default 永遠存在且排第一
const normalizeGroups = (groups) => {
  const arr = (Array.isArray(groups) ? groups : [])
    .filter((g) => g && typeof g === 'object' && cleanCode(g.id))
    .map((g) => ({ id: cleanCode(g.id), name: g.name ? String(g.name) : '未命名群組' }));
  const seen = new Set();
  const out = [];
  for (const g of arr) { if (!seen.has(g.id)) { seen.add(g.id); out.push(g); } }
  if (!out.some((g) => g.id === 'default')) out.unshift({ ...DEFAULT_GROUP });
  return out;
};

// 個股陣列正規化：清代號、群組失效則退回 default、同代號去重（留第一筆）
const normalizeItemsV2 = (items, groupIds) => {
  const valid = new Set(groupIds);
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && typeof it === 'object' && cleanCode(it.code))
    .map((it) => ({
      code: cleanCode(it.code),
      name: it.name ? String(it.name) : '',
      groupId: valid.has(cleanCode(it.groupId)) ? cleanCode(it.groupId) : 'default',
      ts: it.ts,
    }))
    .filter((it, i, a) => a.findIndex((x) => x.code === it.code) === i);
};

const normalizeWatchlistV2 = (raw) => {
  const groups = normalizeGroups(raw?.groups);
  const items = normalizeItemsV2(raw?.items, groups.map((g) => g.id));
  return { version: 2, groups, items };
};

// 載入 v2；若尚無 v2 但有 v1，將 v1 全部包進預設群組並寫出 v2（v1 保留作來源）
export function loadWatchlistV2() {
  const rawV2 = safeGet(STORAGE_KEYS.watchlistV2, null);
  if (rawV2 && typeof rawV2 === 'object' && Array.isArray(rawV2.groups)) {
    return normalizeWatchlistV2(rawV2);
  }
  const v1 = loadWatchlist(); // [{ code, name, ts }]
  const data = {
    version: 2,
    groups: [{ ...DEFAULT_GROUP }],
    items: v1.map((it) => ({ code: it.code, name: it.name, groupId: 'default', ts: it.ts })),
  };
  return saveWatchlistV2(data);
}

export function saveWatchlistV2(data) {
  const norm = normalizeWatchlistV2(data);
  safeSet(STORAGE_KEYS.watchlistV2, norm);
  return norm;
}

export function isWatchedV2(data, code) {
  const c = cleanCode(code);
  return (data?.items || []).some((it) => it.code === c);
}

// 切換收藏：已在清單→移除；不在→加進指定群組（預設 default）
export function toggleWatchV2(data, code, name, groupId = 'default') {
  const c = cleanCode(code);
  if (!c) return normalizeWatchlistV2(data);
  if (isWatchedV2(data, c)) {
    return saveWatchlistV2({ ...data, items: data.items.filter((it) => it.code !== c) });
  }
  const gid = (data.groups || []).some((g) => g.id === groupId) ? groupId : 'default';
  const items = [{ code: c, name: name ? String(name) : '', groupId: gid, ts: Date.now() }, ...data.items];
  return saveWatchlistV2({ ...data, items });
}

// 把某代號搬到指定群組（不存在則新增到該群組）
export function moveItemToGroupV2(data, code, groupId, name) {
  const c = cleanCode(code);
  if (!c) return normalizeWatchlistV2(data);
  const gid = (data.groups || []).some((g) => g.id === groupId) ? groupId : 'default';
  if (isWatchedV2(data, c)) {
    return saveWatchlistV2({ ...data, items: data.items.map((it) => (it.code === c ? { ...it, groupId: gid } : it)) });
  }
  const items = [{ code: c, name: name ? String(name) : '', groupId: gid, ts: Date.now() }, ...data.items];
  return saveWatchlistV2({ ...data, items });
}

export function removeItemV2(data, code) {
  const c = cleanCode(code);
  return saveWatchlistV2({ ...data, items: data.items.filter((it) => it.code !== c) });
}

// 個股在「同群組內」上/下移動（影響顯示順序）
export function moveItemV2(data, code, dir) {
  const c = cleanCode(code);
  const items = [...data.items];
  const idx = items.findIndex((it) => it.code === c);
  if (idx < 0) return normalizeWatchlistV2(data);
  const gid = items[idx].groupId;
  // 找同群組中相鄰的索引
  const sameGroupIdx = items.map((it, i) => (it.groupId === gid ? i : -1)).filter((i) => i >= 0);
  const pos = sameGroupIdx.indexOf(idx);
  const swapPos = dir === 'up' ? pos - 1 : pos + 1;
  if (swapPos < 0 || swapPos >= sameGroupIdx.length) return normalizeWatchlistV2(data);
  const j = sameGroupIdx[swapPos];
  [items[idx], items[j]] = [items[j], items[idx]];
  return saveWatchlistV2({ ...data, items });
}

export function createGroupV2(data, name) {
  const nm = String(name || '').trim() || '未命名群組';
  const group = { id: genGroupId(), name: nm };
  return { data: saveWatchlistV2({ ...data, groups: [...data.groups, group] }), groupId: group.id };
}

export function renameGroupV2(data, id, name) {
  const nm = String(name || '').trim();
  if (!nm) return normalizeWatchlistV2(data);
  return saveWatchlistV2({ ...data, groups: data.groups.map((g) => (g.id === id ? { ...g, name: nm } : g)) });
}

// 刪除群組（default 不可刪）；成員退回 default
export function deleteGroupV2(data, id) {
  if (id === 'default') return normalizeWatchlistV2(data);
  const groups = data.groups.filter((g) => g.id !== id);
  const items = data.items.map((it) => (it.groupId === id ? { ...it, groupId: 'default' } : it));
  return saveWatchlistV2({ ...data, groups, items });
}

export function moveGroupV2(data, id, dir) {
  const groups = [...data.groups];
  const idx = groups.findIndex((g) => g.id === id);
  if (idx < 0) return normalizeWatchlistV2(data);
  const swap = dir === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= groups.length) return normalizeWatchlistV2(data);
  [groups[idx], groups[swap]] = [groups[swap], groups[idx]];
  return saveWatchlistV2({ ...data, groups });
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
