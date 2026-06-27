import crypto from 'node:crypto';

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';

export function verifyLineSignature(rawBody, signature) {
  const secret = process.env.LINE_CHANNEL_SECRET || '';
  if (!secret || !signature) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export async function replyMessage(replyToken, messages) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
  if (!token || !replyToken) return;
  const res = await fetch(LINE_REPLY_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      replyToken,
      messages: Array.isArray(messages) ? messages.slice(0, 5) : [messages],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LINE reply failed: ${res.status} ${body}`);
  }
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
      {
        type: 'action',
        action: { type: 'message', label: '查台積電', text: '2330' },
      },
      {
        type: 'action',
        action: { type: 'message', label: '查鴻海', text: '2317' },
      },
      {
        type: 'action',
        action: { type: 'message', label: '最新 APK', text: '最新APK' },
      },
    ],
  };
}

function numberText(value, suffix = '') {
  return value == null ? '-' : `${value}${suffix}`;
}

function planText(plan) {
  if (!plan) return '資料不足';
  return `觀察 ${numberText(plan.entryLow)}-${numberText(plan.entryHigh)} / 停損 ${numberText(plan.stopLine)} / 目標 ${numberText(plan.takeProfit1)}`;
}

export function summaryFlex(summary, baseUrl) {
  const tone = summary.technical?.state?.tone || 'neutral';
  const color = tone === 'good' ? '#D83B36' : tone === 'bad' ? '#1F8A4C' : tone === 'watch' ? '#D08A00' : '#666666';
  const change = summary.price.change == null ? '-' : `${summary.price.change >= 0 ? '+' : ''}${summary.price.change}`;
  const changePct = summary.price.changePct == null ? '-' : `${summary.price.changePct >= 0 ? '+' : ''}${summary.price.changePct}%`;
  const liffUrl = `${baseUrl}/line?code=${encodeURIComponent(summary.code)}`;

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
          { type: 'text', text: `狀態：${summary.technical?.state?.label || '無資料'}，趨勢 ${summary.technical?.trendPass ?? 0}/5`, size: 'sm', color: '#555555', wrap: true },
          { type: 'text', text: `買賣計畫：${planText(summary.technical?.tradePlan)}`, size: 'sm', color: '#555555', wrap: true },
          { type: 'text', text: `法人五日：合計 ${numberText(summary.chips?.fiveDay?.total, ' 張')}`, size: 'sm', color: '#555555', wrap: true },
          { type: 'separator', margin: 'md' },
          { type: 'text', text: '資訊整理用途，不構成買賣建議。', size: 'xs', color: '#888888', wrap: true },
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
            action: { type: 'uri', label: '開完整分析', uri: liffUrl },
          },
        ],
      },
    },
  };
}
