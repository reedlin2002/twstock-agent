import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const DEFAULT_OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openrouter/free';
const FINMIND_ENDPOINT = 'https://api.finmindtrade.com/api/v4/data';
const YAHOO_CHART_ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';
const YAHOO_QUOTE_ENDPOINT = 'https://query1.finance.yahoo.com/v7/finance/quote';

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });

const sendJson = (res, statusCode, payload) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
};

const parseJson = (text) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
};

const buildMessages = (body) => {
  const messages = Array.isArray(body.messages) ? [...body.messages] : [];
  if (body.system) messages.unshift({ role: 'system', content: body.system });
  return messages;
};

const parseYahooChart = (payload, symbol) => {
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const adjclose = result?.indicators?.adjclose?.[0]?.adjclose || [];
  const rows = timestamps
    .map((ts, index) => {
      const close = adjclose[index] ?? quote.close?.[index];
      if (close == null) return null;
      return {
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: quote.open?.[index] ?? close,
        high: quote.high?.[index] ?? close,
        low: quote.low?.[index] ?? close,
        close,
        vol: quote.volume?.[index] ?? 0,
      };
    })
    .filter(Boolean);

  return {
    symbol,
    rows,
    currency: result?.meta?.currency || null,
    exchangeName: result?.meta?.exchangeName || null,
    instrumentType: result?.meta?.instrumentType || null,
  };
};

const fetchYahooQuote = async (symbol) => {
  try {
    const upstream = await fetch(`${YAHOO_QUOTE_ENDPOINT}?symbols=${encodeURIComponent(symbol)}`);
    if (!upstream.ok) return {};
    const payload = await upstream.json();
    return payload?.quoteResponse?.result?.[0] || {};
  } catch {
    return {};
  }
};

const aiProxy = (env) => ({
  name: 'ai-proxy',
  configureServer(server) {
    server.middlewares.use('/api/yahoo-price', async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: { message: 'Method not allowed.' } });
        return;
      }

      try {
        const requestUrl = new URL(req.url || '', 'http://localhost');
        const code = requestUrl.searchParams.get('code')?.trim();
        const range = requestUrl.searchParams.get('range') || '2y';
        const interval = requestUrl.searchParams.get('interval') || '1d';

        if (!code || !/^\d{4,6}$/.test(code)) {
          sendJson(res, 400, { error: { message: 'Missing or invalid code.' } });
          return;
        }

        const symbols = code.endsWith('.TW') || code.endsWith('.TWO')
          ? [code]
          : [`${code}.TW`, `${code}.TWO`];

        let lastPayload = null;
        for (const symbol of symbols) {
          const upstream = await fetch(
            `${YAHOO_CHART_ENDPOINT}/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=history&includeAdjustedClose=true`,
          );
          const payload = await upstream.json();
          lastPayload = payload;
          const parsed = parseYahooChart(payload, symbol);
          if (upstream.ok && parsed.rows.length >= 60) {
            const quote = await fetchYahooQuote(symbol);
            sendJson(res, 200, {
              ...parsed,
              name: quote.longName || quote.shortName || quote.displayName || null,
              shortName: quote.shortName || null,
              longName: quote.longName || null,
            });
            return;
          }
        }

        sendJson(res, 404, {
          error: {
            message: lastPayload?.chart?.error?.description || 'Yahoo Finance did not return enough price data.',
          },
        });
      } catch (error) {
        sendJson(res, 502, {
          error: {
            message: `Yahoo Finance request failed: ${error?.message || 'unknown error'}`,
          },
        });
      }
    });

    server.middlewares.use('/api/finmind', async (req, res) => {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: { message: 'Method not allowed.' } });
        return;
      }

      try {
        const requestUrl = new URL(req.url || '', 'http://localhost');
        const params = requestUrl.searchParams;
        const dataset = params.get('dataset');
        const dataId = params.get('data_id');
        const startDate = params.get('start_date');

        if (!dataset) {
          sendJson(res, 400, {
            error: { message: 'Missing dataset.' },
          });
          return;
        }

        const upstreamParams = new URLSearchParams({ dataset });
        if (dataId) upstreamParams.set('data_id', dataId);
        if (startDate) upstreamParams.set('start_date', startDate);
        const token = env.FINMIND_TOKEN || process.env.FINMIND_TOKEN || params.get('token');
        if (token) upstreamParams.set('token', token);

        const upstream = await fetch(`${FINMIND_ENDPOINT}?${upstreamParams.toString()}`);
        const responseBody = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        );
        res.end(responseBody);
      } catch (error) {
        sendJson(res, 502, {
          error: {
            message: `FinMind request failed: ${error?.message || 'unknown error'}`,
          },
        });
      }
    });

    server.middlewares.use('/api/analyze', async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: { message: 'Method not allowed.' } });
        return;
      }

      const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
      const endpoint = env.AI_ENDPOINT || process.env.AI_ENDPOINT || DEFAULT_OPENROUTER_ENDPOINT;
      const model = env.AI_MODEL || process.env.AI_MODEL || DEFAULT_MODEL;

      if (!apiKey && endpoint.includes('openrouter.ai')) {
        sendJson(res, 500, {
          error: {
            message:
              'OpenRouter needs an API key even when using free models. Create .env.local with OPENROUTER_API_KEY=your_key, then restart npm run dev.',
          },
        });
        return;
      }

      try {
        const rawBody = await readRequestBody(req);
        const body = parseJson(rawBody);
        const upstreamPayload = {
          model,
          messages: buildMessages(body),
          max_tokens: body.max_tokens ?? body.max_completion_tokens ?? 1000,
          temperature: body.temperature ?? 0.35,
        };

        const headers = {
          'Content-Type': 'application/json',
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(env.OPENROUTER_HTTP_REFERER
            ? { 'HTTP-Referer': env.OPENROUTER_HTTP_REFERER }
            : {}),
          'X-OpenRouter-Title': env.OPENROUTER_APP_TITLE || 'Taiwan Stock Agent',
        };

        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(upstreamPayload),
        });

        const responseBody = await upstream.text();
        res.statusCode = upstream.status;
        res.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        );
        res.end(responseBody);
      } catch (error) {
        sendJson(res, 502, {
          error: {
            message: `AI endpoint request failed: ${error?.message || 'unknown error'}`,
          },
        });
      }
    });
  },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react(), aiProxy(env)],
  };
});
