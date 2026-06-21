/* 背景到價提醒 runner（@capacitor/background-runner，獨立 JS 引擎執行）。
 *
 * 限制與設計：
 * - 與 App 不共用 localStorage；設定由 App 端用 BackgroundRunner.dispatchEvent('saveConfig') 寫進 CapacitorKV。
 * - 每次最多 ~30 秒、最短 15 分鐘一次（由系統排程），盤中（台灣週一~五 09:00–13:35）才實際抓報價。
 * - 觸發後記錄於 CapacitorKV.alertFired 去重；價格回到區間內會重置，之後再碰才會再提醒。
 * 可用的全域：addEventListener / fetch / CapacitorKV / CapacitorNotifications / console。
 */

// 字串 → 穩定的正整數通知 id（避開前景/分析通知用的 1001/1002/4101）
function hashId(s) {
  var h = 0;
  for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; }
  return (Math.abs(h) % 2000000000) + 5000;
}

// 台灣時間（UTC+8，無日光節約）盤中判斷
function inMarketHours() {
  var now = new Date();
  var tpe = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  var day = tpe.getDay();
  if (day === 0 || day === 6) return false;
  var mins = tpe.getHours() * 60 + tpe.getMinutes();
  return mins >= 9 * 60 && mins <= 13 * 60 + 35;
}

// 抓最新價：先用 meta.regularMarketPrice，否則退回最後一筆收盤
async function fetchClose(code) {
  var syms = (code.indexOf('.TW') >= 0) ? [code] : [code + '.TW', code + '.TWO'];
  for (var i = 0; i < syms.length; i++) {
    try {
      var r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(syms[i]) + '?range=1d&interval=5m');
      if (!r.ok) continue;
      var j = await r.json();
      var res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) continue;
      var meta = res.meta;
      if (meta && typeof meta.regularMarketPrice === 'number') return meta.regularMarketPrice;
      var q = res.indicators && res.indicators.quote && res.indicators.quote[0];
      var closes = q && q.close;
      if (closes && closes.length) {
        for (var k = closes.length - 1; k >= 0; k--) { if (closes[k] != null) return closes[k]; }
      }
    } catch (e) { /* try next symbol */ }
  }
  return null;
}

// App 端推送設定 → 存進 KV 供排程事件讀取
addEventListener('saveConfig', function (resolve, reject, args) {
  try {
    var config = (args && args.config) ? args.config : [];
    CapacitorKV.set('alertConfig', JSON.stringify(config));
    resolve();
  } catch (e) { reject(e); }
});

// 排程事件：盤中檢查每檔是否碰到停損/停利/目標價，碰到就推播
addEventListener('priceAlerts', async function (resolve, reject) {
  try {
    if (!inMarketHours()) { resolve(); return; }

    var config = [];
    try { var raw = CapacitorKV.get('alertConfig'); config = (raw && raw.value) ? JSON.parse(raw.value) : []; } catch (e) { config = []; }
    if (!config.length) { resolve(); return; }

    var fired = {};
    try { var f = CapacitorKV.get('alertFired'); fired = (f && f.value) ? JSON.parse(f.value) : {}; } catch (e) { fired = {}; }

    var notes = [];
    for (var i = 0; i < config.length; i++) {
      var item = config[i];
      if (!item || !item.code) continue;
      var px = await fetchClose(item.code);
      if (px == null) continue;

      var checks = [];
      if (typeof item.stopLoss === 'number') checks.push({ t: 'stop', hit: px <= item.stopLoss, msg: '已跌破停損 ' + item.stopLoss });
      if (typeof item.takeProfit === 'number') checks.push({ t: 'take', hit: px >= item.takeProfit, msg: '已達停利 ' + item.takeProfit });
      if (typeof item.target === 'number') checks.push({ t: 'target', hit: px >= item.target, msg: '已達目標價 ' + item.target });

      for (var c = 0; c < checks.length; c++) {
        var chk = checks[c];
        var key = item.code + ':' + chk.t;
        if (chk.hit && !fired[key]) {
          fired[key] = Date.now();
          notes.push({ id: hashId(key), title: (item.name || item.code) + ' 到價提醒', body: '現價 ' + px + '，' + chk.msg });
        } else if (!chk.hit && fired[key]) {
          delete fired[key];
        }
      }
    }

    try { CapacitorKV.set('alertFired', JSON.stringify(fired)); } catch (e) { /* no-op */ }
    if (notes.length) { try { CapacitorNotifications.schedule(notes); } catch (e) { /* no-op */ } }
    resolve();
  } catch (e) { reject(e); }
});
