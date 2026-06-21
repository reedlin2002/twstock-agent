import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.twstock.agent',
  appName: '010401 Finance',
  webDir: 'dist',
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#15120E",
      showSpinner: false,
    },
    LocalNotifications: {
      smallIcon: "ic_launcher",
      iconColor: "#E2A636",
    },
    // 到價／停損停利提醒：背景週期檢查（最短 15 分，盤中才實際抓報價）。
    // runner 檔放在 public/runners/，build 後會落在 dist/runners/priceAlerts.js。
    BackgroundRunner: {
      label: "com.twstock.agent.pricealerts",
      src: "runners/priceAlerts.js",
      event: "priceAlerts",
      repeat: true,
      interval: 15,
      autoStart: true,
    },
  },
};

export default config;
