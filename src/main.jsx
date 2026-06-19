import React from 'react';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import TaiwanStockAgentPro from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TaiwanStockAgentPro />
  </React.StrictMode>,
);

if (Capacitor.isNativePlatform()) {
  // 狀態列與 #15120E 融合、圖示為亮色（深底用 Style.Dark）
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
  StatusBar.setBackgroundColor({ color: '#15120E' }).catch(() => {});
  // 保險：launchAutoHide:false 下，若 AppSplash 未能關閉原生 splash，3s 後強制關閉
  setTimeout(() => SplashScreen.hide().catch(() => {}), 3000);
}
