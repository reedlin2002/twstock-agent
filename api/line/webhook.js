import { buildDailyDigest, formatDailyDigest } from '../_lib/daily.js';
import { buildStockSummary } from '../_lib/stock.js';
import { addCodes, getWatchlist, hasPersistentWatchlist, parseCodes, removeCodes } from '../_lib/watchlist.js';
import { errorMessage, publicBaseUrl, readRawBody, sendJson, sendText } from '../_lib/http.js';
import { helpQuickReply, replyMessage, summaryFlex, textMessage, verifyLineSignature } from '../_lib/line.js';

function allowedUser(event) {
  const allowed = process.env.LINE_ALLOWED_USER_ID || process.env.LINE_TARGET_ID || '';
  if (!allowed) return true;
  return event?.source?.userId === allowed;
}

function helpText() {
  return [
    '可用指令:',
    '2330 - 查單檔股票',
    '加入 2330 - 加入觀察清單',
    '移除 2330 - 從觀察清單移除',
    '清單 - 查看觀察清單',
    '今日重點 - 產生觀察清單摘要',
    '最新APK - 下載最新版 Android APK',
  ].join('\n');
}

function formatWatchlist(codes) {
  if (!codes.length) return '觀察清單目前是空的。請傳「加入 2330」先加入一檔。';
  return ['目前觀察清單:', ...codes.map((code, index) => `${index + 1}. ${code}`)].join('\n');
}

function commandKind(text) {
  const compact = String(text || '').replace(/\s+/g, '').toLowerCase();
  if (/^(help|說明|幫助|查股票)$/.test(compact)) return 'help';
  if (/^(清單|觀察清單|watchlist|list)$/.test(compact)) return 'list';
  if (/^(今日|今日重點|每日摘要|daily)$/.test(compact)) return 'daily';
  if (/^(最新apk|apk|下載|download)$/.test(compact)) return 'apk';
  if (/^(richmenu|選單|功能選單)$/.test(compact)) return 'rich-menu';
  if (/^(加入|新增|追蹤|add|watch)\d{4,6}/.test(compact)) return 'add';
  if (/^(移除|刪除|取消|remove|delete|unwatch)\d{4,6}/.test(compact)) return 'remove';
  if (/^(加入|新增|追蹤|add|watch)/.test(compact)) return 'add';
  if (/^(移除|刪除|取消|remove|delete|unwatch)/.test(compact)) return 'remove';
  return 'stock';
}

async function handleAdd(event, text) {
  const codes = parseCodes(text);
  if (!codes.length) {
    await replyMessage(event.replyToken, textMessage('請用「加入 2330」這種格式。'));
    return;
  }

  try {
    const updated = await addCodes(event.source?.userId, codes);
    await replyMessage(event.replyToken, textMessage(`已加入: ${codes.join(', ')}\n\n${formatWatchlist(updated)}`));
  } catch (error) {
    if (error.statusCode === 501) {
      await replyMessage(event.replyToken, textMessage('還沒設定 Redis，所以無法永久儲存觀察清單。請先在 Vercel 設定 KV_REST_API_URL/KV_REST_API_TOKEN，或先用 WATCHLIST_CODES。'));
      return;
    }
    throw error;
  }
}

async function handleRemove(event, text) {
  const codes = parseCodes(text);
  if (!codes.length) {
    await replyMessage(event.replyToken, textMessage('請用「移除 2330」這種格式。'));
    return;
  }

  try {
    const updated = await removeCodes(event.source?.userId, codes);
    await replyMessage(event.replyToken, textMessage(`已移除: ${codes.join(', ')}\n\n${formatWatchlist(updated)}`));
  } catch (error) {
    if (error.statusCode === 501) {
      await replyMessage(event.replyToken, textMessage('還沒設定 Redis，所以無法永久儲存觀察清單。請先在 Vercel 設定 KV_REST_API_URL/KV_REST_API_TOKEN，或先用 WATCHLIST_CODES。'));
      return;
    }
    throw error;
  }
}

async function handleDaily(event) {
  const codes = await getWatchlist(event.source?.userId);
  const digest = await buildDailyDigest(codes);
  await replyMessage(event.replyToken, textMessage(formatDailyDigest(digest, {
    storageReady: hasPersistentWatchlist(),
  })));
}

async function handleText(event, baseUrl) {
  const text = event.message?.text || '';
  const kind = commandKind(text);

  if (!allowedUser(event)) {
    await replyMessage(event.replyToken, textMessage('這個 LINE OA 目前是私人助理，尚未開放其他使用者。'));
    return;
  }

  if (kind === 'help') {
    await replyMessage(event.replyToken, textMessage(helpText(), helpQuickReply()));
    return;
  }

  if (kind === 'list') {
    const codes = await getWatchlist(event.source?.userId);
    await replyMessage(event.replyToken, textMessage(formatWatchlist(codes), helpQuickReply()));
    return;
  }

  if (kind === 'add') {
    await handleAdd(event, text);
    return;
  }

  if (kind === 'remove') {
    await handleRemove(event, text);
    return;
  }

  if (kind === 'daily') {
    await handleDaily(event);
    return;
  }

  if (kind === 'apk') {
    const releases = process.env.GITHUB_RELEASES_URL || 'https://github.com/reedlin2002/twstock-agent/releases';
    await replyMessage(event.replyToken, textMessage(`最新版 APK:\n${releases}`));
    return;
  }

  if (kind === 'rich-menu') {
    await replyMessage(event.replyToken, textMessage('Rich Menu 需要用 LINE API 建立。部署後可參考 docs/line-oa.md 的 Rich Menu 區塊。'));
    return;
  }

  const codes = parseCodes(text);
  if (!codes.length) {
    await replyMessage(event.replyToken, textMessage('看不出股票代碼。請傳 2330，或傳「說明」看可用指令。', helpQuickReply()));
    return;
  }

  const summary = await buildStockSummary(codes[0]);
  await replyMessage(event.replyToken, summaryFlex(summary, baseUrl));
}

async function handleEvent(event, baseUrl) {
  if (event.type === 'follow') {
    await replyMessage(event.replyToken, textMessage(`歡迎使用 010401 Finance。\n\n${helpText()}`, helpQuickReply()));
    return;
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    await handleText(event, baseUrl);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    sendText(res, 200, 'LINE webhook is ready.');
    return;
  }

  const rawBody = await readRawBody(req);
  const signature = req.headers['x-line-signature'];
  if (!verifyLineSignature(rawBody, signature)) {
    sendJson(res, 401, { error: { message: 'Invalid LINE signature.' } });
    return;
  }

  let payload = null;
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch {
    sendJson(res, 400, { error: { message: 'Invalid JSON body.' } });
    return;
  }

  const baseUrl = publicBaseUrl(req);
  try {
    await Promise.all((payload.events || []).map((event) => handleEvent(event, baseUrl)));
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('LINE webhook failed', error);
    sendJson(res, error.statusCode || 500, { error: { message: errorMessage(error) } });
  }
}
