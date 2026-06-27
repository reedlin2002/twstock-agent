import crypto from 'node:crypto';

const LINE_REPLY_ENDPOINT = 'https://api.line.me/v2/bot/message/reply';
const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';

const ZH = {
  add2330: '\u52a0\u5165 2330',
  analysis: '\u6253\u958b\u5206\u6790',
  apk: '\u6700\u65b0APK',
  chips5d: '5\u65e5\u7c4c\u78bc',
  daily: '\u4eca\u65e5\u91cd\u9ede',
  disclaimer: '\u50c5\u4f9b\u7814\u7a76\u53c3\u8003\uff0c\u4e0d\u662f\u6295\u8cc7\u5efa\u8b70\u3002',
  emptyWatchlist: '\u76ee\u524d\u6c92\u6709\u89c0\u5bdf\u80a1\u7968\u3002',
  entry: '\u9032\u5834',
  lots: '\u5f35',
  noTradePlan: '\u5c1a\u672a\u5efa\u7acb\u4ea4\u6613\u8a08\u756b',
  plan: '\u8a08\u756b',
  price: '\u50f9\u683c',
  state: '\u72c0\u614b',
  stop: '\u505c\u640d',
  takeProfit: '\u505c\u5229',
  trend: '\u8da8\u52e2',
  updateTime: '\u66f4\u65b0\u6642\u9593',
  watchlist: '\u89c0\u5bdf\u6e05\u55ae',
  website: '\u6253\u958b\u7db2\u9801',
};

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

function numberText(value, suffix = '') {
  return value == null ? '-' : `${value}${suffix}`;
}

function signedNumberText(value, suffix = '') {
  if (value == null) return '-';
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

function pctText(value) {
  return signedNumberText(value, '%');
}

function toneColor(tone) {
  if (tone === 'good') return '#D83B36';
  if (tone === 'bad') return '#1F8A4C';
  if (tone === 'watch') return '#D08A00';
  return '#666666';
}

function planText(plan) {
  if (!plan) return ZH.noTradePlan;
  return `${ZH.entry} ${numberText(plan.entryLow)}-${numberText(plan.entryHigh)} / ${ZH.stop} ${numberText(plan.stopLine)} / ${ZH.takeProfit} ${numberText(plan.takeProfit1)}`;
}

function pageUrl(baseUrl, code = '') {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  return `${root || 'https://example.com'}/line${code ? `?code=${encodeURIComponent(code)}` : ''}`;
}

function smallText(text, options = {}) {
  return {
    type: 'text',
    text,
    size: options.size || 'sm',
    color: options.color || '#555555',
    wrap: true,
    ...(options.weight ? { weight: options.weight } : {}),
    ...(options.align ? { align: options.align } : {}),
    ...(options.flex != null ? { flex: options.flex } : {}),
  };
}

export function summaryLine(summary) {
  const label = summary.technical?.state?.label || summary.technical?.state?.key || '-';
  const chips = summary.chips?.fiveDay?.total;
  return `${summary.code} ${summary.name}: ${numberText(summary.price.close)} (${pctText(summary.price.changePct)}) / ${label} / ${ZH.trend} ${summary.technical?.trendPass ?? 0}/5 / ${ZH.chips5d} ${numberText(chips, ` ${ZH.lots}`)}`;
}

export function summaryFlex(summary, baseUrl) {
  const tone = summary.technical?.state?.tone || 'neutral';
  const color = toneColor(tone);
  const change = signedNumberText(summary.price.change);
  const changePct = pctText(summary.price.changePct);

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
          smallText(`${ZH.state}: ${summary.technical?.state?.label || '-'} / ${ZH.trend} ${summary.technical?.trendPass ?? 0}/5`),
          smallText(`${ZH.plan}: ${planText(summary.technical?.tradePlan)}`),
          smallText(`${ZH.chips5d}: ${numberText(summary.chips?.fiveDay?.total, ` ${ZH.lots}`)}`),
          { type: 'separator', margin: 'md' },
          smallText(ZH.disclaimer, { size: 'xs', color: '#888888' }),
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
            action: { type: 'uri', label: ZH.analysis, uri: pageUrl(baseUrl, summary.code) },
          },
        ],
      },
    },
  };
}

export function watchlistFlex(codes, baseUrl) {
  const rows = (codes || []).slice(0, 12);
  const contents = [
    { type: 'text', text: ZH.watchlist, weight: 'bold', size: 'xl', wrap: true },
    { type: 'separator', margin: 'md' },
  ];

  if (!rows.length) {
    contents.push(smallText(`${ZH.emptyWatchlist}\n${ZH.add2330}`, { color: '#555555' }));
  } else {
    rows.forEach((code, index) => {
      contents.push({
        type: 'box',
        layout: 'horizontal',
        margin: index === 0 ? 'md' : 'sm',
        contents: [
          smallText(`${index + 1}.`, { flex: 1, color: '#888888' }),
          { type: 'text', text: code, size: 'md', weight: 'bold', color: '#15120E', flex: 4 },
          {
            type: 'text',
            text: '\u67e5\u8a62',
            size: 'xs',
            color: '#2F6FED',
            align: 'end',
            flex: 2,
            action: { type: 'message', text: code },
          },
        ],
      });
    });
  }

  return {
    type: 'flex',
    altText: ZH.watchlist,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', color: '#15120E', action: { type: 'message', label: ZH.daily, text: ZH.daily } },
          { type: 'button', style: 'secondary', action: { type: 'uri', label: ZH.website, uri: pageUrl(baseUrl) } },
        ],
      },
    },
  };
}

function digestRow(row, index) {
  const summary = row.summary;
  const tone = summary.technical?.state?.tone || 'neutral';
  return {
    type: 'box',
    layout: 'vertical',
    margin: index === 0 ? 'md' : 'lg',
    spacing: 'xs',
    contents: [
      { type: 'text', text: `${index + 1}. ${summary.code} ${summary.name}`, weight: 'bold', size: 'sm', color: '#15120E', wrap: true },
      smallText(`${ZH.price}: ${numberText(summary.price.close)} (${pctText(summary.price.changePct)})`, { size: 'xs', color: toneColor(tone) }),
      smallText(`${ZH.state}: ${summary.technical?.state?.label || '-'} / ${ZH.trend} ${summary.technical?.trendPass ?? 0}/5`, { size: 'xs' }),
      smallText(`${ZH.chips5d}: ${numberText(summary.chips?.fiveDay?.total, ` ${ZH.lots}`)}`, { size: 'xs' }),
    ],
  };
}

export function dailyDigestFlex(digest, baseUrl) {
  const rows = digest.rows || [];
  const failed = digest.failed || [];
  const contents = [
    { type: 'text', text: ZH.daily, weight: 'bold', size: 'xl', wrap: true },
    smallText(`${ZH.updateTime}: ${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`, { size: 'xs', color: '#888888' }),
    { type: 'separator', margin: 'md' },
  ];

  if (!rows.length && !failed.length) {
    contents.push(smallText(`${ZH.emptyWatchlist}\n${ZH.add2330}`, { color: '#555555' }));
  } else {
    rows.slice(0, 10).forEach((row, index) => contents.push(digestRow(row, index)));
  }

  if (failed.length) {
    contents.push({ type: 'separator', margin: 'md' });
    contents.push(smallText(`\u67e5\u8a62\u5931\u6557: ${failed.map((row) => row.code).join(', ')}`, { size: 'xs', color: '#A33A3A' }));
  }

  if (digest.truncated || rows.length > 10) {
    contents.push(smallText('\u6e05\u55ae\u8f03\u9577\uff0c\u672c\u5361\u7247\u53ea\u986f\u793a\u524d 10 \u6a94\u3002', { size: 'xs', color: '#888888' }));
  }

  contents.push({ type: 'separator', margin: 'md' });
  contents.push(smallText(ZH.disclaimer, { size: 'xs', color: '#888888' }));

  return {
    type: 'flex',
    altText: ZH.daily,
    contents: {
      type: 'bubble',
      size: 'mega',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', color: '#15120E', action: { type: 'message', label: ZH.watchlist, text: '\u6e05\u55ae' } },
          { type: 'button', style: 'secondary', action: { type: 'uri', label: ZH.website, uri: pageUrl(baseUrl) } },
        ],
      },
    },
  };
}
