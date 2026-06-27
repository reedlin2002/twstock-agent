const WATCHLIST_LIMIT = 30;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function watchlistKey(userId) {
  const owner = userId || process.env.LINE_ALLOWED_USER_ID || process.env.LINE_TARGET_ID || 'default';
  return `twstock-agent:watchlist:${owner}`;
}

async function redisCommand(parts) {
  const config = redisConfig();
  if (!config) return null;

  const path = parts.map((part) => encodeURIComponent(String(part))).join('/');
  const res = await fetch(`${config.url}/${path}`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(payload?.error || `Redis request failed with ${res.status}.`);
    error.statusCode = res.status;
    throw error;
  }
  return payload.result;
}

export function hasPersistentWatchlist() {
  return Boolean(redisConfig());
}

export function parseCodes(text) {
  const codes = String(text || '').match(/\d{4,6}/g) || [];
  return [...new Set(codes.map((code) => code.trim()))];
}

export function envWatchlist() {
  return parseCodes(process.env.WATCHLIST_CODES || '');
}

export async function getWatchlist(userId) {
  const key = watchlistKey(userId);
  const stored = await redisCommand(['get', key]);
  if (stored) {
    try {
      const codes = JSON.parse(stored);
      return Array.isArray(codes) ? codes.filter(Boolean).slice(0, WATCHLIST_LIMIT) : [];
    } catch {
      return [];
    }
  }
  return envWatchlist();
}

export async function setWatchlist(userId, codes) {
  if (!hasPersistentWatchlist()) {
    const error = new Error('Watchlist storage is not configured. Add Vercel Redis or Upstash env vars first.');
    error.statusCode = 501;
    throw error;
  }

  const normalized = [...new Set((codes || []).map((code) => String(code).trim()).filter(Boolean))].slice(0, WATCHLIST_LIMIT);
  await redisCommand(['set', watchlistKey(userId), JSON.stringify(normalized)]);
  return normalized;
}

export async function addCodes(userId, codes) {
  const current = await getWatchlist(userId);
  return setWatchlist(userId, [...current, ...codes]);
}

export async function removeCodes(userId, codes) {
  const remove = new Set(codes);
  const current = await getWatchlist(userId);
  return setWatchlist(userId, current.filter((code) => !remove.has(code)));
}
