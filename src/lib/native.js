/* 原生能力薄封裝（守門層）：App 其餘程式一律透過這裡用原生外掛，不直接 import 外掛。
 *
 * 原則：
 * - 一切都先過 isNative()；Web/dev 一律安全 no-op，回傳保守預設（false / null / undefined）。
 * - 任一外掛呼叫都包 try/catch，外掛缺席或平台不支援都不讓 App crash。
 * - 通知 / 前景服務 / KV 鏡像集中在此，方便日後抽換實作。
 */
import { registerPlugin } from '@capacitor/core';
import { isNativePlatform } from './net.js';

export const isNative = isNativePlatform;

// 動態載入外掛，缺席（例如 Web 端 tree-shake 後）回 null
const loadLocalNotifications = async () => {
  try { return (await import('@capacitor/local-notifications')).LocalNotifications; }
  catch { return null; }
};
const loadApp = async () => {
  try { return (await import('@capacitor/app')).App; }
  catch { return null; }
};

// 自製前景服務外掛（Android）：android/ 內以 Kotlin 實作，Web/未實作時呼叫會被 try/catch 吞掉
const AnalysisService = registerPlugin('AnalysisService');

/* ---------- 通知 ---------- */

// 固定通知 ID（同一用途覆蓋更新，不洗版）
export const NOTIF = {
  analysisOngoing: 1001, // 分析進行中（常駐）
  analysisDone: 1002,    // 分析完成 / 失敗
};

let notifyPermAsked = false;
let notifyPermGranted = false;

// 請求一次通知權限（Android 13+ 需 runtime 授權）。回傳是否已授權。
export async function ensureNotifyPermission() {
  if (!isNative()) return false;
  if (notifyPermAsked) return notifyPermGranted;
  notifyPermAsked = true;
  const LN = await loadLocalNotifications();
  if (!LN) return false;
  try {
    let perm = await LN.checkPermissions();
    if (perm.display !== 'granted') perm = await LN.requestPermissions();
    notifyPermGranted = perm.display === 'granted';
  } catch {
    notifyPermGranted = false;
  }
  return notifyPermGranted;
}

// 發一則即時通知。code 會帶進 extra，供點擊後深連結到該股。
export async function notify({ id, title, body, code }) {
  if (!isNative()) return;
  const LN = await loadLocalNotifications();
  if (!LN) return;
  try {
    await LN.schedule({
      notifications: [{
        id: id ?? Math.floor(Math.random() * 100000) + 2000,
        title,
        body,
        smallIcon: 'ic_launcher',
        extra: code ? { code: String(code) } : undefined,
      }],
    });
  } catch { /* 通知失敗不影響主流程 */ }
}

// 常駐（ongoing）通知：分析進行中時顯示，不可滑除、不自動消失
export async function setOngoing({ id, title, body }) {
  if (!isNative()) return;
  const LN = await loadLocalNotifications();
  if (!LN) return;
  try {
    await LN.schedule({
      notifications: [{
        id: id ?? NOTIF.analysisOngoing,
        title,
        body,
        smallIcon: 'ic_launcher',
        ongoing: true,
        autoCancel: false,
      }],
    });
  } catch { /* no-op */ }
}

export async function cancelNotify(id) {
  if (!isNative()) return;
  const LN = await loadLocalNotifications();
  if (!LN) return;
  try { await LN.cancel({ notifications: [{ id }] }); } catch { /* no-op */ }
}

/* ---------- 前景服務（保活，Android 自製外掛） ---------- */

export async function startForeground({ title, body } = {}) {
  if (!isNative()) return false;
  try {
    await AnalysisService.start({ title: title || '分析進行中', body: body || '' });
    return true;
  } catch {
    return false; // 外掛未安裝/未實作 → 退回「只有常駐通知」
  }
}

export async function stopForeground() {
  if (!isNative()) return;
  try { await AnalysisService.stop(); } catch { /* no-op */ }
}

/* ---------- 到價提醒設定 → 背景 runner（runner 沒有 localStorage，改用其 KV） ---------- */

const RUNNER_LABEL = 'com.twstock.agent.pricealerts';

const loadBackgroundRunner = async () => {
  try { return (await import('@capacitor/background-runner')).BackgroundRunner; }
  catch { return null; }
};

// 把「到價提醒」設定丟給 runner，由 runner 存進自己的 KV，供排程事件讀取
export async function mirrorAlertConfig(list) {
  if (!isNative()) return;
  const BR = await loadBackgroundRunner();
  if (!BR) return;
  try {
    await BR.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'saveConfig',
      details: { config: Array.isArray(list) ? list : [] },
    });
  } catch { /* runner 不在或失敗都不影響主流程 */ }
}

// 把整份自選股清單（code+name）丟給 runner，供背景「便宜訊號層」監看（有狀況才亮燈）
export async function mirrorWatchConfig(list) {
  if (!isNative()) return;
  const BR = await loadBackgroundRunner();
  if (!BR) return;
  try {
    await BR.dispatchEvent({
      label: RUNNER_LABEL,
      event: 'saveWatch',
      details: { watch: Array.isArray(list) ? list : [] },
    });
  } catch { /* runner 不在或失敗都不影響主流程 */ }
}

/* ---------- App 生命週期 / 通知點擊 ---------- */

// 註冊「點擊通知」回呼，cb 收到 { code }。回傳取消註冊函式。
export async function onNotificationTap(cb) {
  if (!isNative()) return () => {};
  const LN = await loadLocalNotifications();
  if (!LN) return () => {};
  try {
    const handle = await LN.addListener('localNotificationActionPerformed', (action) => {
      const code = action?.notification?.extra?.code;
      if (code) cb(String(code));
    });
    return () => { try { handle.remove(); } catch { /* no-op */ } };
  } catch { return () => {}; }
}

// 註冊 App 回前景回呼。回傳取消註冊函式。
export async function onAppResume(cb) {
  if (!isNative()) return () => {};
  const App = await loadApp();
  if (!App) return () => {};
  try {
    const handle = await App.addListener('resume', () => cb());
    return () => { try { handle.remove(); } catch { /* no-op */ } };
  } catch { return () => {}; }
}
