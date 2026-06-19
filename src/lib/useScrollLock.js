import { useEffect } from 'react';

/**
 * locked=true 時鎖住整頁捲動（保留當前捲動位置），false 解除。
 * Android WebView（Chromium）會尊重 <html> 的 overflow:hidden 且不會跳位。
 */
export function useScrollLock(locked) {
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    const prev = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => { html.style.overflow = prev; };
  }, [locked]);
}
