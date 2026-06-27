import crypto from 'node:crypto';

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

export function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET || '';
  if (!secret || !signature) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

async function sendLineRequest(endpoint, payload) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
  if (!token) {
    const error = new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured.');
    error.statusCode = 500;
    throw error;
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE request failed: ${res.status} ${body}`);
  }
}

export async function replyMessage(replyToken, messages) {
  if (!replyToken) return;
  await sendLineRequest(LINE_REPLY_ENDPOINT, {
    replyToken,
    messages: Array.isArray(messages) ? messages.slice(0, 5) : [messages],
  });
}

export async function pushMessage(to, messages) {
  if (!to) {
    const error = new Error('LINE push target is not configured.');
    error.statusCode = 500;
    throw error;
  }
  await sendLineRequest(LINE_PUSH_ENDPOINT, {
    to,
    messages: Array.isArray(messages) ? messages.slice(0, 5) : [messages],
  });
}

export function textMessage(text, quickReply) {
  return {
    type: 'text',
    text,
    ...(quickReply ? { quickReply } : {}),
  };
}

export function helpQuickReply() {
  return {
    items: [
      { type: 'action', action: { type: 'message', label: '2330', text: '2330' } },
      { type: 'action', action: { type: 'message', label: 'Add 2330', text: '加入 2330' } },
      { type: 'action', action: { type: 'message', label: 'Watchlist', text: '清單' } },
      { type: 'action', action: { type: 'message', label: 'Daily', text: '今日重點' } },
      { type: 'action', action: { type: 'message', label: 'APK', text: '最新APK' } },
    ],
  };
}

function numberText(value, suffix = '') {
  return value == null ? '-' : `${value}${suffix}`;
}

function signedNumberText(value, suffix = '') {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

function planText(plan) {
  if (!plan) return 'No trade plan yet';
  return `Entry ${numberText(plan.entryLow)}-${numberText(plan.entryHigh)} / Stop ${numberText(plan.stopLine)} / TP ${numberText(plan.takeProfit1)}`;
}

export function summaryLine(summary) {
  const label = summary.technical?.state?.label || summary.technical?.state?.key || 'neutral';
  const chips = summary.chips?.fiveDay?.total;
  return `${summary.code} ${summary.name}: ${numberText(summary.price.close)} (${signedNumberText(summary.price.changePct, '%')}), ${label}, trend ${summary.technical?.trendPass ?? 0}/5, chips ${numberText(chips, ' lots')}`;
}

export function summaryFlex(summary, baseUrl) {
  const tone = summary.technical?.state?.tone || 'neutral';
  const color = tone === 'good' ? '#D83B36' : tone === 'bad' ? '#1F8A4C' : tone === 'watch' ? '#D08A00' : '#666666';
  const change = signedNumberText(summary.price.change);
  const changePct = signedNumberText(summary.price.changePct, '%');
  const pageUrl = `${baseUrl}/line?code=${encodeURIComponent(summary.code)}`;

  return {
    type: 'flex',
    altText: `${summary.name} ${summary.code} ${summary.technical?.state?.label || ''}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `${summary.name} ${summary.code}`, weight: 'bold', size: 'lg', wrap: true },
          {
            type: 'box',
            layout: 'horizontal',
            contents: [
              { type: 'text', text: numberText(summary.price.close), size: 'xxl', weight: 'bold', color, flex: 2 },
              { type: 'text', text: `${change} (${changePct})`, size: 'sm', color, align: 'end', gravity: 'center', flex: 3 },
            ],
          },
          { type: 'text', text: `State: ${summary.technical?.state?.label || 'neutral'} / trend ${summary.technical?.trendPass ?? 0}/5`, size: 'sm', color: '#555555', wrap: true },
          { type: 'text', text: `Plan: ${planText(summary.technical?.tradePlan)}`, size: 'sm', color: '#555555', wrap: true },
          { type: 'text', text: `5-day chips: ${numberText(summary.chips?.fiveDay?.total, ' lots')}`, size: 'sm', color: '#555555', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: 'For research only. Not financial advice.', size: 'xs', color: '#888888', wrap: true },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#15120E',
            action: { type: 'uri', label: 'Open analysis', uri: pageUrl },
          },
        ],
      },
    },
  };
}
