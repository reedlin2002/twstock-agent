import { buildDailyDigest, formatDailyDigest } from '../_lib/daily.js';
import { buildStockSummary } from '../_lib/stock.js';
import { addCodes, getWatchlist, hasPersistentWatchlist, parseCodes, removeCodes } from '../_lib/watchlist.js';
import { errorMessage, publicBaseUrl, readRawBody, sendJson, sendText } from '../_lib/http.js';
import { helpQuickReply, replyMessage, summaryFlex, textMessage, verifyLineSignature } from '../_lib/line.js';

const T = {
  help: '\u8aaa\u660e',
  add: '\u52a0\u5165',
  remove: '\u79fb\u9664',
  list: '\u6e05\u55ae',
  daily: '\u4eca\u65e5\u91cd\u9ede',
  apk: '\u6700\u65b0APK',
};

function allowedUser(event) {
  const allowed = process.env.LINE_ALLOWED_USER_ID || process.env.LINE_TARGET_ID || '';
  if (!allowed) return true;
  return event?.source?.userId === allowed;
}

function helpText() {
  return [
    '\u53ef\u7528\u6307\u4ee4:',
    '2330 - \u67e5\u55ae\u6a94\u80a1\u7968',
    `${T.add} 2330 - \u52a0\u5165\u89c0\u5bdf\u6e05\u55ae`,
    `${T.remove} 2330 - \u5f9e\u89c0\u5bdf\u6e05\u55ae\u79fb\u9664`,
    `${T.list} - \u67e5\u770b\u89c0\u5bdf\u6e05\u55ae`,
    `${T.daily} - \u7522\u751f\u89c0\u5bdf\u6e05\u55ae\u6458\u8981`,
    `${T.apk} - \u4e0b\u8f09\u6700\u65b0\u7248 Android APK`,
  ].join('\n');
}

function formatWatchlist(codes) {
  if (!codes.length) return '\u89c0\u5bdf\u6e05\u55ae\u76ee\u524d\u662f\u7a7a\u7684\u3002\u8acb\u50b3\u300c\u52a0\u5165 2330\u300d\u5148\u52a0\u5165\u4e00\u6a94\u3002';
  return ['\u76ee\u524d\u89c0\u5bdf\u6e05\u55ae:', ...codes.map((code, index) => `${index + 1}. ${code}`)].join('\n');
}

function commandKind(text) {
  const compact = String(text || '').replace(/\s+/g, '').toLowerCase();
  if (['help', T.help, '\u5e6b\u52a9', '\u67e5\u80a1\u7968'].includes(compact)) return 'help';
  if ([T.list, '\u89c0\u5bdf\u6e05\u55ae', 'watchlist', 'list'].includes(compact)) return 'list';
  if ([T.daily, '\u4eca\u65e5', '\u6bcf\u65e5\u6458\u8981', 'daily'].includes(compact)) return 'daily';
  if ([T.apk.toLowerCase(), 'apk', '\u4e0b\u8f09', 'download'].includes(compact)) return 'apk';
  if (['richmenu', '\u9078\u55ae', '\u529f\u80fd\u9078\u55ae'].includes(compact)) return 'rich-menu';
  if (compact.startsWith(T.add) || compact.startsWith('\u65b0\u589e') || compact.startsWith('\u8ffd\u8e64') || compact.startsWith('add') || compact.startsWith('watch')) return 'add';
  if (compact.startsWith(T.remove) || compact.startsWith('\u522a\u9664') || compact.startsWith('\u53d6\u6d88') || compact.startsWith('remove') || compact.startsWith('delete') || compact.startsWith('unwatch')) return 'remove';
  return 'stock';
}

function redisFailureText(error) {
  if (error.statusCode === 501) {
    return '\u9084\u6c92\u8a2d\u5b9a Redis\u3002\u8acb\u5728 Vercel \u8a2d\u5b9a Redis REST URL/TOKEN\uff0c\u6216\u5148\u7528 WATCHLIST_CODES\u3002';
  }
  return `\u89c0\u5bdf\u6e05\u55ae\u5132\u5b58\u5931\u6557: ${errorMessage(error)}\n\n\u8acb\u78ba\u8a8d\u6c92\u6709\u7528 READ_ONLY_TOKEN\uff0c\u800c\u662f\u7528\u53ef\u5beb\u5165\u7684 TOKEN\u3002`;
}

async function handleAdd(event, text) {
  const codes = parseCodes(text);
  if (!codes.length) {
    await replyMessage(event.replyToken, textMessage('\u8acb\u7528\u300c\u52a0\u5165 2330\u300d\u9019\u7a2e\u683c\u5f0f\u3002'));
    return;
  }

  try {
    const updated = await addCodes(event.source?.userId, codes);
    await replyMessage(event.replyToken, textMessage(`\u5df2\u52a0\u5165: ${codes.join(', ')}\n\n${formatWatchlist(updated)}`));
  } catch (error) {
    await replyMessage(event.replyToken, textMessage(redisFailureText(error)));
  }
}

async function handleRemove(event, text) {
  const codes = parseCodes(text);
  if (!codes.length) {
    await replyMessage(event.replyToken, textMessage('\u8acb\u7528\u300c\u79fb\u9664 2330\u300d\u9019\u7a2e\u683c\u5f0f\u3002'));
    return;
  }

  try {
    const updated = await removeCodes(event.source?.userId, codes);
    await replyMessage(event.replyToken, textMessage(`\u5df2\u79fb\u9664: ${codes.join(', ')}\n\n${formatWatchlist(updated)}`));
  } catch (error) {
    await replyMessage(event.replyToken, textMessage(redisFailureText(error)));
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
    await replyMessage(event.replyToken, textMessage('\u9019\u500b LINE OA \u76ee\u524d\u662f\u79c1\u4eba\u52a9\u7406\uff0c\u5c1a\u672a\u958b\u653e\u5176\u4ed6\u4f7f\u7528\u8005\u3002'));
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
    await replyMessage(event.replyToken, textMessage(`\u6700\u65b0\u7248 APK:\n${releases}`));
    return;
  }

  if (kind === 'rich-menu') {
    await replyMessage(event.replyToken, textMessage('Rich Menu \u8acb\u5728 LINE OA Manager \u5efa\u7acb\uff0c\u53ef\u53c3\u8003 docs/line-oa.md\u3002'));
    return;
  }

  const codes = parseCodes(text);
  if (!codes.length) {
    await replyMessage(event.replyToken, textMessage('\u770b\u4e0d\u51fa\u80a1\u7968\u4ee3\u78bc\u3002\u8acb\u50b3 2330\uff0c\u6216\u50b3\u300c\u8aaa\u660e\u300d\u770b\u53ef\u7528\u6307\u4ee4\u3002', helpQuickReply()));
    return;
  }

  const summary = await buildStockSummary(codes[0]);
  await replyMessage(event.replyToken, summaryFlex(summary, baseUrl));
}

async function handleEvent(event, baseUrl) {
  if (event.type === 'follow') {
    await replyMessage(event.replyToken, textMessage(`\u6b61\u8fce\u4f7f\u7528 010401 Finance\u3002\n\n${helpText()}`, helpQuickReply()));
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
