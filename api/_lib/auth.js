const PROFILE_ENDPOINT = 'https://api.line.me/v2/profile';

function bearerToken(req) {
  const value = req.headers.authorization || req.headers.Authorization || '';
  const match = String(value).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function lineProfile(accessToken) {
  const res = await fetch(PROFILE_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export async function requireLineUser(req) {
  const allowed = process.env.LINE_ALLOWED_USER_ID || process.env.LINE_TARGET_ID || '';
  if (!allowed) return { userId: null, enforced: false };

  const token = bearerToken(req);
  if (token) {
    const profile = await lineProfile(token);
    const userId = profile?.userId || null;
    if (userId === allowed) return { userId, enforced: true };
    const error = new Error('This LINE user is not allowed to use this private app.');
    error.statusCode = 403;
    throw error;
  }

  if (process.env.LINE_REQUIRE_LIFF_AUTH === 'true') {
    const error = new Error('LIFF login is required.');
    error.statusCode = 401;
    throw error;
  }

  return { userId: null, enforced: false };
}
