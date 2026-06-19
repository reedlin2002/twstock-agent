/* 開場：純圖標漸顯（icon 淡入 + 柔和金色光暈），約 1.1s 後整體淡出 */
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';

export default function AppSplash({ onDone }) {
  const [hide, setHide] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    // overlay 已上畫後才關閉原生 splash  同為 #15120E，無縫交棒、零閃色
    const raf = requestAnimationFrame(() => {
      if (Capacitor.isNativePlatform()) SplashScreen.hide().catch(() => {});
    });
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const hold = reduce ? 300 : 900;
    const t1 = setTimeout(() => setHide(true), hold);            // 觸發淡出
    const t2 = setTimeout(() => doneRef.current?.(), hold + 420); // 淡出後卸載
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className={`splash ${hide ? 'hide' : ''}`} aria-hidden="true">
      <div className="splash-stage">
        <div className="splash-glow" />
        <img className="splash-logo" src="/app-icon.png" width="96" height="96" alt="" />
      </div>
    </div>
  );
}
