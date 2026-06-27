import { buildStockSummary } from './stock.js';
import { summaryLine } from './line.js';

const MAX_DAILY_CODES = 12;

function sortDigestRows(rows) {
  const toneRank = { good: 0, watch: 1, neutral: 2, bad: 3 };
  return [...rows].sort((a, b) => {
    const ar = toneRank[a.summary?.technical?.state?.tone] ?? 9;
    const br = toneRank[b.summary?.technical?.state?.tone] ?? 9;
    if (ar !== br) return ar - br;
    return (b.summary?.technical?.trendPass ?? 0) - (a.summary?.technical?.trendPass ?? 0);
  });
}

export async function buildDailyDigest(codes) {
  const selected = [...new Set((codes || []).filter(Boolean))].slice(0, MAX_DAILY_CODES);
  const settled = await Promise.allSettled(selected.map((code) => buildStockSummary(code)));
  const rows = settled.map((result, index) => ({
    code: selected[index],
    ok: result.status === 'fulfilled',
    summary: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? result.reason?.message || 'Request failed.' : '',
  }));

  return {
    rows: sortDigestRows(rows.filter((row) => row.ok)),
    failed: rows.filter((row) => !row.ok),
    truncated: selected.length < (codes || []).length,
  };
}

export function formatDailyDigest(digest, options = {}) {
  const rows = digest.rows || [];
  const failed = digest.failed || [];
  const lines = [
    '今日觀察清單',
    `更新時間: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
    '',
  ];

  if (!rows.length && !failed.length) {
    lines.push('目前沒有觀察股票。請傳「加入 2330」先加入一檔。');
  }

  rows.forEach((row, index) => {
    lines.push(`${index + 1}. ${summaryLine(row.summary)}`);
  });

  if (failed.length) {
    lines.push('');
    lines.push('查詢失敗:');
    for (const row of failed) lines.push(`- ${row.code}: ${row.error}`);
  }

  if (digest.truncated) {
    lines.push('');
    lines.push('清單超過上限，本次只整理前 12 檔。');
  }

  if (options.storageReady === false) {
    lines.push('');
    lines.push('提醒: 尚未設定 Redis，清單只能從 WATCHLIST_CODES 讀取，無法用 LINE 指令永久新增/移除。');
  }

  lines.push('');
  lines.push('僅供研究參考，非投資建議。');
  return lines.join('\n').slice(0, 4900);
}
