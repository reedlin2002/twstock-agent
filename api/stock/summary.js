import { requireLineUser } from '../_lib/auth.js';
import { errorMessage } from '../_lib/http.js';
import { buildStockSummary } from '../_lib/stock.js';
import { handleOptions, methodNotAllowed, sendJson, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    methodNotAllowed(res);
    return;
  }

  try {
    await requireLineUser(req);
    const url = new URL(req.url || '', `https://${req.headers.host || 'localhost'}`);
    const query = url.searchParams.get('query') || url.searchParams.get('code') || '';
    const summary = await buildStockSummary(query);
    sendJson(res, 200, { summary });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: { message: errorMessage(error) } });
  }
}
