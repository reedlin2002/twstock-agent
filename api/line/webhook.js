import { buildStockSummary } from '../_lib/stock.js';
import { errorMessage, publicBaseUrl, readRawBody, sendJson, sendText } from '../_lib/http.js';
import { helpQuickReply, replyMessage, summaryFlex, textMessage, verifyLineSignature } from '../_lib/line.js';

function allowedUser(event) {
  const allowed = process.env.LINE_ALLOWED_USER_ID || process.env.LINE_TARGET_ID || '';
  if (!allowed) return true;
  return event?.source?.userId === allowed;
}

function codeFromText(text) {
  const normalized = String(text || '').trim();
  const match = normalized.match(/\d{4,6}/);
  return match ? match[0] : '';
}

async function handleText(event, baseUrl) {
  const text = event.message?.text || '';
  const compact = text.replace(/\s+/g, '').toLowerCase();

  if (!allowedUser(event)) {
    await replyMessage(event.replyToken, textMessage('目前這個 LINE OA 是私用版，尚未開放其他使用者。'));
    return;
  }

  if (/^(help|使用|說明|查股票|股票)$/i.test(compact)) {
    await replyMessage(event.replyToken, textMessage('輸入台股代號即可查詢，例如：2330。', helpQuickReply()));
    return;
  }

  if (/最新apk|apk|下載/.test(compact)) {
    const releases = process.env.GITHUB_RELEASES_URL || 'https://github.com/reedlin2002/twstock-agent/releases';
    await replyMessage(event.replyToken, textMessage(`最新 APK 下載頁：\n${releases}`));
    return;
  }

  const code = codeFromText(text);
  if (!code) {
    await replyMessage(event.replyToken, textMessage('我看不出股票代號。請輸入 4-6 位台股代號，例如：2330。', helpQuickReply()));
    return;
  }

  const summary = await buildStockSummary(code);
  await replyMessage(event.replyToken, summaryFlex(summary, baseUrl));
}

async function handleEvent(event, baseUrl) {
  if (event.type === 'follow') {
    await replyMessage(event.replyToken, textMessage('歡迎使用 010401 Finance。輸入台股代號，例如 2330，我會回你快速摘要卡。', helpQuickReply()));
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
