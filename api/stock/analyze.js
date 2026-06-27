import { requireLineUser } from '../_lib/auth.js';
import { analyzeSummary } from '../_lib/ai.js';
import { buildStockSummary } from '../_lib/stock.js';
import { errorMessage, handleOptions, methodNotAllowed, readJson, sendJson, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(req, res);
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  try {
    await requireLineUser(req);
    const body = await readJson(req);
    const query = body.query || body.code || '';
    const summary = body.summary || await buildStockSummary(query);
    const analysis = await analyzeSummary(summary);
    sendJson(res, 200, { summary, analysis });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: { message: errorMessage(error) } });
  }
}
