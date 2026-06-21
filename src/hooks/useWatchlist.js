/* 自選股（v2 群組）狀態與操作集中於此 hook，讓 App.jsx 不再直接管理這塊。
 * 同時負責批次報價（開抽屜時抓、清單變動時重抓，不輪詢）。
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { quickQuotes } from '../lib/data.js';
import {
  loadWatchlistV2, isWatchedV2, toggleWatchV2, moveItemToGroupV2, removeItemV2, moveItemV2,
  createGroupV2, renameGroupV2, deleteGroupV2, moveGroupV2, saveWatchlistV2,
} from '../lib/storage.js';

export function useWatchlist() {
  const [data, setData] = useState({ version: 2, groups: [], items: [] });
  const [quotes, setQuotes] = useState({});
  const [quotesLoading, setQuotesLoading] = useState(false);

  useEffect(() => { setData(loadWatchlistV2()); }, []);

  const codes = useMemo(() => data.items.map((it) => it.code), [data.items]);

  const refreshQuotes = useCallback(() => {
    if (codes.length === 0) { setQuotes({}); return; }
    setQuotesLoading(true);
    quickQuotes(codes)
      .then(setQuotes)
      .finally(() => setQuotesLoading(false));
  }, [codes]);

  // 操作小工具：呼叫 storage（回傳已正規化並落地的新 data）後更新 state
  const apply = useCallback((fn) => setData((cur) => fn(cur)), []);

  const isWatched = useCallback((code) => isWatchedV2(data, code), [data]);

  const toggleWatch = useCallback((code, name, groupId) => apply((d) => toggleWatchV2(d, code, name, groupId)), [apply]);
  const addToGroup = useCallback((code, name, groupId) => apply((d) => moveItemToGroupV2(d, code, groupId, name)), [apply]);
  const moveToGroup = useCallback((code, groupId) => apply((d) => moveItemToGroupV2(d, code, groupId)), [apply]);
  const removeItem = useCallback((code) => apply((d) => removeItemV2(d, code)), [apply]);
  const moveItem = useCallback((code, dir) => apply((d) => moveItemV2(d, code, dir)), [apply]);
  const renameGroup = useCallback((id, name) => apply((d) => renameGroupV2(d, id, name)), [apply]);
  const deleteGroup = useCallback((id) => apply((d) => deleteGroupV2(d, id)), [apply]);
  const moveGroup = useCallback((id, dir) => apply((d) => moveGroupV2(d, id, dir)), [apply]);
  const createGroup = useCallback((name) => {
    let newId = null;
    setData((cur) => { const { data: next, groupId } = createGroupV2(cur, name); newId = groupId; return next; });
    return newId;
  }, []);

  // 匯入/還原後直接覆蓋（已是 v2 形狀）
  const replaceAll = useCallback((next) => setData(saveWatchlistV2(next)), []);
  // 從 storage 重新載入（applyBackup 直接寫了 storage 後用）
  const reload = useCallback(() => setData(loadWatchlistV2()), []);

  return {
    data, groups: data.groups, items: data.items, codes,
    quotes, quotesLoading, refreshQuotes,
    isWatched, toggleWatch, addToGroup, moveToGroup, removeItem, moveItem,
    createGroup, renameGroup, deleteGroup, moveGroup, replaceAll, reload,
  };
}
