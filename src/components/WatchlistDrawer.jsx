/* 自選股抽屜（v2 群組版）：右上漢堡點開後從右側滑出。
 * - 以群組分區顯示，每個群組標頭附「總覽」（漲/跌家數、平均漲跌）。
 * - 群組可新增、改名、刪除、上下排序；個股可搬到其他群組、上下移、移除。
 * - 底部提供資料備份（匯出／匯入）。互動沿用 GlossaryModal 那套。
 */
import { useEffect, useState } from 'react';
import {
  Star, X, RefreshCw, Search, Clock, Plus, ChevronDown, ChevronRight,
  FolderInput, MoreVertical, Pencil, Trash2, ArrowUp, ArrowDown, Check,
  FolderPlus, DatabaseBackup, Copy,
} from 'lucide-react';
import { useScrollLock } from '../lib/useScrollLock.js';
import { getNote } from '../lib/storage.js';
import { computePnl } from '../lib/holdingStatus.js';
import { pf } from '../lib/format.js';
import { buildBackup, parseBackup, applyBackup, summarizeBackup } from '../lib/backup.js';

// 複製文字到剪貼簿（含舊環境 fallback）
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  try {
    const el = document.createElement('textarea');
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch { return false; }
}

// 單列報價（紅漲綠跌；載入中顯示骨架；無資料顯示「—」）
function Quote({ quote, loading }) {
  if (!quote) return loading ? <span className="wl-sk" /> : <span className="wl-prc dim">—</span>;
  if (quote.close == null) return <span className="wl-prc dim">—</span>;
  const up = quote.chg == null ? null : quote.chg >= 0;
  return (
    <span className="wl-q">
      <span className="wl-prc">{pf(quote.close)}</span>
      {quote.chgPct != null && (
        <span className={`wl-chg ${up ? 'u' : 'd'}`}>
          {up ? '▲' : '▼'} {Math.abs(quote.chgPct).toFixed(2)}%
        </span>
      )}
    </span>
  );
}

// 群組總覽：漲 X / 跌 Y 家、平均漲跌
function GroupOverview({ items, quotes }) {
  const s = items.reduce((a, it) => {
    const q = quotes[it.code];
    if (q && q.chgPct != null) {
      a.n += 1; a.sum += q.chgPct;
      if (q.chgPct > 0) a.up += 1; else if (q.chgPct < 0) a.down += 1;
    }
    return a;
  }, { n: 0, up: 0, down: 0, sum: 0 });
  if (s.n === 0) return <span className="wl-ov dim">{items.length} 檔</span>;
  const avg = s.sum / s.n;
  return (
    <span className="wl-ov">
      <span className="u">▲{s.up}</span>
      <span className="d">▼{s.down}</span>
      <span className={avg >= 0 ? 'u' : 'd'}>均 {avg >= 0 ? '+' : ''}{avg.toFixed(2)}%</span>
    </span>
  );
}

export default function WatchlistDrawer({
  open, onClose,
  groups = [], items = [], recent = [],
  quotes = {}, quotesLoading = false,
  currentCode, currentName, currentWatched,
  onSelect, onRemove, onSearch, onRefresh,
  onAddCurrent,           // (groupId) => void
  onCreateGroup,          // (name) => newId
  onRenameGroup,          // (id, name) => void
  onDeleteGroup,          // (id) => void
  onMoveGroup,            // (id, 'up'|'down') => void
  onMoveToGroup,          // (code, groupId) => void
  onMoveItem,             // (code, 'up'|'down') => void
  onAfterImport,          // () => void  匯入後讓 App 重新載入
}) {
  useScrollLock(open);
  const [term, setTerm] = useState('');
  const [collapsed, setCollapsed] = useState({});           // { [groupId]: true }
  const [editing, setEditing] = useState(null);             // 正在改名的 groupId
  const [editName, setEditName] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);       // 待確認刪除的 groupId
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [addPick, setAddPick] = useState(false);            // 「加入自選」群組選單
  const [itemMenu, setItemMenu] = useState(null);           // 開著選單的個股 code
  const [backupOpen, setBackupOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [hint, setHint] = useState('');                     // 備份區提示訊息

  // ESC 關閉；關閉抽屜時收掉所有臨時狀態
  useEffect(() => {
    if (!open) { setItemMenu(null); setEditing(null); setConfirmDel(null); setAddPick(false); return; }
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const submitSearch = () => {
    const t = term.trim();
    if (!t) return;
    onSearch(t);
    setTerm('');
  };

  const groupName = (id) => groups.find((g) => g.id === id)?.name || '我的自選';

  const startRename = (g) => { setEditing(g.id); setEditName(g.name); };
  const commitRename = () => {
    if (editing && editName.trim()) onRenameGroup(editing, editName.trim());
    setEditing(null); setEditName('');
  };
  const submitNew = () => {
    const nm = newName.trim();
    if (nm) onCreateGroup(nm);
    setNewName(''); setNewOpen(false);
  };

  const doExport = async () => {
    const ok = await copyText(buildBackup());
    setHint(ok ? '已複製備份字串到剪貼簿，貼到記事本或雲端保存即可。' : '複製失敗，請改用支援剪貼簿的環境。');
  };
  const doImport = (mode) => {
    const data = parseBackup(importText);
    if (!data) { setHint('字串格式不正確，請確認貼上的是本 App 匯出的備份。'); return; }
    const s = summarizeBackup(data);
    applyBackup(data, mode);
    setImportText('');
    setHint(`已${mode === 'replace' ? '覆蓋' : '合併'}匯入：${s.items} 檔自選、${s.groups} 群組、${s.notes} 筆紀錄。`);
    onAfterImport?.();
  };

  return (
    <div className={`wl-overlay ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="wl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="自選股選單">
        <div className="wl-hd">
          <div className="wl-tt">
            <Star size={18} />自選股
            <span className="wl-badge">{items.length}</span>
          </div>
          <div className="wl-hd-acts">
            <button className="wl-icon" onClick={() => setNewOpen((v) => !v)} title="新增群組" aria-label="新增群組">
              <FolderPlus size={16} />
            </button>
            <button className="wl-icon" onClick={onRefresh} disabled={quotesLoading || items.length === 0} title="刷新報價" aria-label="刷新報價">
              <RefreshCw size={16} className={quotesLoading ? 'spin' : ''} />
            </button>
            <button className="wl-icon" onClick={onClose} title="關閉" aria-label="關閉"><X size={18} /></button>
          </div>
        </div>

        <div className="wl-bd">
          {/* 抽屜內直接搜尋 */}
          <div className="wl-search">
            <Search size={16} />
            <input
              className="wl-in"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
              placeholder="輸入代號或名稱，例如 2330 / 華通"
            />
          </div>

          {/* 新增群組 inline 輸入 */}
          {newOpen && (
            <div className="wl-newgrp">
              <input
                className="wl-in" autoFocus value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitNew(); if (e.key === 'Escape') { setNewOpen(false); setNewName(''); } }}
                placeholder="新群組名稱，例如 存股 / 短線 / 觀察"
              />
              <button className="wl-mini on" onClick={submitNew}><Check size={14} /></button>
              <button className="wl-mini" onClick={() => { setNewOpen(false); setNewName(''); }}><X size={14} /></button>
            </div>
          )}

          {/* 一鍵把目前個股加入自選（可選群組） */}
          {currentCode && !currentWatched && (
            <div className="wl-addwrap">
              <button className="wl-add" onClick={() => (groups.length > 1 ? setAddPick((v) => !v) : onAddCurrent('default'))}>
                <Plus size={15} />把「{currentName || currentCode}」加入自選
                {groups.length > 1 && <ChevronDown size={14} style={{ marginInlineStart: 'auto' }} />}
              </button>
              {addPick && groups.length > 1 && (
                <div className="wl-pick">
                  {groups.map((g) => (
                    <button key={g.id} className="wl-pick-it" onClick={() => { onAddCurrent(g.id); setAddPick(false); }}>
                      {g.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 群組分區 */}
          {items.length === 0 ? (
            <div className="wl-empty">
              <Star size={22} />
              <div>還沒有自選股</div>
              <div className="wl-empty-d">查詢個股後點「收藏」即可加入；用上方 <FolderPlus size={12} /> 建立群組來分類。</div>
            </div>
          ) : (
            groups.map((g, gi) => {
              const groupItems = items.filter((it) => it.groupId === g.id);
              const isCol = collapsed[g.id];
              return (
                <div className="wl-group" key={g.id}>
                  <div className="wl-group-hd">
                    <button className="wl-group-tt" onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}>
                      {isCol ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                      {editing === g.id ? (
                        <input
                          className="wl-in wl-rename" autoFocus value={editName}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditing(null); }}
                        />
                      ) : (
                        <span className="wl-group-name">{g.name}<span className="wl-group-n">{groupItems.length}</span></span>
                      )}
                    </button>
                    <GroupOverview items={groupItems} quotes={quotes} />
                    <div className="wl-group-acts">
                      {editing === g.id ? (
                        <button className="wl-mini on" onClick={commitRename} title="完成"><Check size={14} /></button>
                      ) : (
                        <>
                          <button className="wl-mini" onClick={() => onMoveGroup(g.id, 'up')} disabled={gi === 0} title="上移"><ArrowUp size={13} /></button>
                          <button className="wl-mini" onClick={() => onMoveGroup(g.id, 'down')} disabled={gi === groups.length - 1} title="下移"><ArrowDown size={13} /></button>
                          <button className="wl-mini" onClick={() => startRename(g)} title="改名"><Pencil size={13} /></button>
                          {g.id !== 'default' && (
                            confirmDel === g.id ? (
                              <button className="wl-mini danger" onClick={() => { onDeleteGroup(g.id); setConfirmDel(null); }} title="確定刪除">確定?</button>
                            ) : (
                              <button className="wl-mini" onClick={() => setConfirmDel(g.id)} title="刪除群組"><Trash2 size={13} /></button>
                            )
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {!isCol && (
                    groupItems.length === 0 ? (
                      <div className="wl-group-empty">此群組還沒有股票，用個股選單「移到群組」把股票放進來。</div>
                    ) : (
                      <div className="wl-list">
                        {groupItems.map((it, ii) => {
                          const q = quotes[it.code];
                          const pnl = q && q.close != null ? computePnl(getNote(it.code), q.close) : null;
                          const menuOpen = itemMenu === it.code;
                          return (
                            <div key={it.code} className={`wl-row ${it.code === currentCode ? 'cur' : ''}`}>
                              <div className="wl-main" onClick={() => onSelect(it.code, it.name)}>
                                <div className="wl-meta">
                                  <div className="wl-name">{it.name || it.code}<span className="wl-code">{it.code}</span></div>
                                  {pnl && pnl.pct != null && (
                                    <div className={`wl-pnl ${pnl.pnl >= 0 ? 'u' : 'd'}`}>持有 {pnl.pnl >= 0 ? '+' : ''}{pnl.pct.toFixed(1)}%</div>
                                  )}
                                </div>
                                <Quote quote={q} loading={quotesLoading} />
                              </div>
                              <button className="wl-rm" title="更多" aria-label="更多" onClick={() => setItemMenu(menuOpen ? null : it.code)}>
                                <MoreVertical size={15} />
                              </button>
                              {menuOpen && (
                                <div className="wl-itemmenu" onClick={(e) => e.stopPropagation()}>
                                  <div className="wl-itemmenu-sec"><FolderInput size={12} />移到群組</div>
                                  {groups.filter((gg) => gg.id !== g.id).map((gg) => (
                                    <button key={gg.id} className="wl-itemmenu-it" onClick={() => { onMoveToGroup(it.code, gg.id); setItemMenu(null); }}>{gg.name}</button>
                                  ))}
                                  <div className="wl-itemmenu-row">
                                    <button className="wl-mini" disabled={ii === 0} onClick={() => onMoveItem(it.code, 'up')}><ArrowUp size={13} /></button>
                                    <button className="wl-mini" disabled={ii === groupItems.length - 1} onClick={() => onMoveItem(it.code, 'down')}><ArrowDown size={13} /></button>
                                    <button className="wl-mini danger" onClick={() => { onRemove(it.code); setItemMenu(null); }}><Trash2 size={13} />移除</button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )
                  )}
                </div>
              );
            })
          )}

          {/* 最近查詢 */}
          {recent.length > 0 && (
            <div className="wl-recent">
              <div className="wl-sec"><Clock size={13} />最近查詢</div>
              <div className="wl-chips">
                {recent.map((it) => (
                  <button key={it.code} className="wl-chip" onClick={() => onSelect(it.code, it.name)}>
                    {it.name || it.code}<span className="wl-code">{it.code}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 資料備份 */}
          <div className="wl-backup">
            <button className="wl-sec wl-sec-btn" onClick={() => setBackupOpen((v) => !v)}>
              <DatabaseBackup size={13} />資料備份（匯出／匯入）{backupOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </button>
            {backupOpen && (
              <div className="wl-backup-bd">
                <button className="wl-add" onClick={doExport}><Copy size={14} />複製目前資料（自選＋群組＋紀錄）</button>
                <textarea
                  className="wl-ta" rows={3} value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="把先前匯出的備份字串貼在這裡，再選合併或覆蓋還原"
                />
                <div className="wl-backup-acts">
                  <button className="wl-mini2" disabled={!importText.trim()} onClick={() => doImport('merge')}>合併匯入</button>
                  <button className="wl-mini2 danger" disabled={!importText.trim()} onClick={() => doImport('replace')}>覆蓋匯入</button>
                </div>
                {hint && <div className="wl-backup-hint">{hint}</div>}
              </div>
            )}
          </div>

          <div className="wl-foot">
            報價來源 Yahoo Finance，盤中約即時、可能延遲；非交易時段顯示最新收盤。僅供研究參考，不構成投資建議。
          </div>
        </div>
      </div>
    </div>
  );
}
