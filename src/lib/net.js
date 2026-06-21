/* 統一資料抓取層：收斂「dev 走 vite proxy / native 或正式環境直連」這套重複分支。
 *
 * - dev 瀏覽器：走 /api/* proxy（vite.config.js 提供，避免 CORS）。
 * - native / 正式：直接打 upstream。native 由 Capacitor 的 CapacitorHttp 接管全域 fetch，
 *   會自動繞過 CORS，所以這裡用一般 fetch 即可。
 *
 * 原則：沿用既有「壞了不要 crash」的風格——非 2xx 或例外一律回 null，由呼叫端決定後續。
 */

// 是否跑在原生（Android/iOS）容器內
export const isNativePlatform = () =>
  typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

// 是否該走 dev proxy（只有「非原生且 vite dev」時才走）
export const useDevProxy = () => {
  let dev = false;
  try { dev = !!import.meta.env.DEV; } catch { dev = false; }
  return !isNativePlatform() && dev;
};

// 依環境決定要打的網址：dev 用 proxyUrl，其餘用 directUrl
export const pickUrl = (proxyUrl, directUrl) => (useDevProxy() ? proxyUrl : directUrl);

// 抓 JSON：非 2xx 或解析失敗回 null
export async function fetchJson(url, init) {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// 抓純文字（給 RSS/XML 用）：非 2xx 或例外回 null
export async function fetchText(url, init) {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// 台股代號 → Yahoo symbol 候選（上市 .TW、上櫃 .TWO）。已帶後綴則原樣使用。
export const yahooSymbols = (code) => {
  const c = String(code || '').trim();
  if (!c) return [];
  return c.endsWith('.TW') || c.endsWith('.TWO') ? [c] : [`${c}.TW`, `${c}.TWO`];
};
