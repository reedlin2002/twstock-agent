import { buildDailyDigest } from '../_lib/daily.js';
import { errorMessage, handleOptions, methodNotAllowed, publicBaseUrl, sendJson, setCors } from '../_lib/http.js';
import { dailyDigestFlex, pushMessage } from '../_lib/line.js';
import { getWatchlist } from '../_lib/watchlist.js';

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET || '';
  if (!secret) return true;

  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (auth === `Bearer ${secret}`) return true;

  const url = new URL(req.url || '', `https://${req.headers.host || 'localhost'}`);
  return url.searchParams.get('secret') === secret;
}

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  if (!cronAuthorized(req)) {
    sendJson(res, 401, { error: { message: 'Invalid cron secret.' } });
    return;
  }

  const target = process.env.LINE_TARGET_ID || process.env.LINE_ALLOWED_USER_ID || '';
  if (!target) {
    sendJson(res, 500, { error: { message: 'LINE_TARGET_ID or LINE_ALLOWED_USER_ID is required.' } });
    return;
  }

  try {
    const codes = await getWatchlist(target);
    const digest = await buildDailyDigest(codes);
    await pushMessage(target, dailyDigestFlex(digest, publicBaseUrl(req)));
    sendJson(res, 200, {
      ok: true,
      pushed: true,
      target,
      codes,
      failed: digest.failed.map((row) => ({ code: row.code, error: row.error })),
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: { message: errorMessage(error) } });
  }
}
