import { parseReport } from '../../src/lib/parseReport.js';

const DEFAULT_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/free';

function fmt(value) {
  return value == null ? '無資料' : String(value);
}

export function buildAnalysisPrompt(summary) {
  const tp = summary.technical?.tradePlan || {};
  const chips = summary.chips?.fiveDay || {};
  const margin = summary.margin || {};

  return `請用繁體中文分析這檔台股，僅根據提供資料，不要補不存在的基本面或新聞。

股票：${summary.name} ${summary.code}
收盤：${fmt(summary.price.close)}（${summary.price.date}），漲跌幅 ${fmt(summary.price.changePct)}%
技術狀態：${summary.technical?.state?.label || '無資料'}，趨勢條件 ${fmt(summary.technical?.trendPass)}/5，RSI ${fmt(summary.technical?.rsi)}，KD ${fmt(summary.technical?.kd?.k)}/${fmt(summary.technical?.kd?.d)}
交易計畫：觀察區 ${fmt(tp.entryLow)}-${fmt(tp.entryHigh)}，突破 ${fmt(tp.breakout)}，停損 ${fmt(tp.stopLine)}，停利 ${fmt(tp.takeProfit1)}/${fmt(tp.takeProfit2)}
法人五日合計（張）：外資 ${fmt(chips.foreign)}，投信 ${fmt(chips.trust)}，自營 ${fmt(chips.dealer)}，合計 ${fmt(chips.total)}
融資融券：融資餘額 ${fmt(margin.marginBalance)}，融券餘額 ${fmt(margin.shortBalance)}，券資比 ${fmt(margin.shortMarginRatio)}%

請依以下標籤輸出，保留標籤原樣：
@@NAME@@
@@TICKER@@
@@SNAPSHOT@@
@@LEAN@@
@@CONFIDENCE@@
@@TECHNICAL@@
@@CHIPS@@
@@BUYPOINT@@
@@INVALIDATE@@
@@INVLEVEL@@
@@RISKS@@
@@DATANOTE@@`;
}

export function extractAiText(data) {
  if (typeof data?.text === 'string') return data.text;
  if (Array.isArray(data?.content)) {
    return data.content
      .map((block) => block?.text || '')
      .filter(Boolean)
      .join('\n');
  }
  if (Array.isArray(data?.choices)) {
    return data.choices
      .map((choice) => choice?.message?.content || choice?.text || '')
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export async function analyzeSummary(summary) {
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.VITE_OPENROUTER_API_KEY || '';
  const endpoint = process.env.AI_ENDPOINT || process.env.VITE_AI_ENDPOINT || DEFAULT_ENDPOINT;
  const model = process.env.AI_MODEL || process.env.VITE_AI_MODEL || DEFAULT_MODEL;

  if (!apiKey && endpoint.includes('openrouter.ai')) {
    const error = new Error('OPENROUTER_API_KEY is required for AI analysis.');
    error.statusCode = 500;
    throw error;
  }

  const upstream = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'X-OpenRouter-Title': process.env.OPENROUTER_APP_TITLE || '010401 Finance LINE OA',
      ...(process.env.OPENROUTER_HTTP_REFERER ? { 'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: '你是台股研究助理。只做資料整理與風險提示，不提供保證獲利或絕對買賣建議。',
        },
        { role: 'user', content: buildAnalysisPrompt(summary) },
      ],
      max_tokens: 1400,
      temperature: 0.35,
    }),
  });

  const body = await upstream.text();
  let payload = null;
  try {
    payload = JSON.parse(body);
  } catch {
    payload = { text: body };
  }

  if (!upstream.ok) {
    const error = new Error(payload?.error?.message || payload?.message || `AI request failed with ${upstream.status}.`);
    error.statusCode = upstream.status;
    throw error;
  }

  const text = extractAiText(payload);
  return {
    raw: text,
    parsed: parseReport(text),
  };
}
