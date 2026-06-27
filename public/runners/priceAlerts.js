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

// 台北日期 YYYYMMDD（給「每檔每日只提醒一次」去重）
function ymdTaipei() {
  var now = new Date();
  var tpe = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  return '' + tpe.getFullYear() + (tpe.getMonth() + 1) + tpe.getDate();
}

// 抓近一個月日收盤＋現價＋昨收：給自選股「便宜訊號層」用（動能訊號＋當日漲跌）
async function fetchDaily(code) {
  var syms = (code.indexOf('.TW') >= 0) ? [code] : [code + '.TW', code + '.TWO'];
  for (var i = 0; i < syms.length; i++) {
    try {
      var r = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(syms[i]) + '?range=1mo&interval=1d');
      if (!r.ok) continue;
      var j = await r.json();
      var res = j && j.chart && j.chart.result && j.chart.result[0];
      if (!res) continue;
      var meta = res.meta || {};
      var q = res.indicators && res.indicators.quote && res.indicators.quote[0];
      var raw = (q && q.close) ? q.close : [];
      var closes = [];
      for (var k = 0; k < raw.length; k++) { if (raw[k] != null) closes.push(raw[k]); }
      if (!closes.length) continue;
      var price = (typeof meta.regularMarketPrice === 'number') ? meta.regularMarketPrice : closes[closes.length - 1];
      var prevClose = (typeof meta.chartPreviousClose === 'number') ? meta.chartPreviousClose
        : (typeof meta.previousClose === 'number') ? meta.previousClose
        : (closes.length > 1 ? closes[closes.length - 2] : null);
      return { closes: closes, price: price, prevClose: prevClose };
    } catch (e) { /* try next symbol */ }
  }
  return null;
}

// 迷你走勢動能訊號（與前端 signal.js 同邏輯）：up / down / neutral
function quickSignal(spark) {
  var a = [];
  for (var i = 0; i < spark.length; i++) { if (spark[i] != null) a.push(spark[i]); }
  if (a.length < 6) return 'neutral';
  function mean(arr) { var s = 0; for (var k = 0; k < arr.length; k++) s += arr[k]; return arr.length ? s / arr.length : 0; }
  var last = a[a.length - 1];
  var maShort = mean(a.slice(-5));
  var maLong = mean(a.slice(-Math.min(a.length, 20)));
  if (last >= maShort && maShort >= maLong) return 'up';
  if (last <= maShort && maShort <= maLong) return 'down';
  return 'neutral';
}

// 抓全市場「當日重大訊息」（TWSE OpenAPI），過濾出自選股代號 → { code: 主旨 }
async function fetchMopsEvents(codes) {
  try {
    var r = await fetch('https://openapi.twse.com.tw/v1/opendata/t187ap04_L');
    if (!r.ok) return {};
    var arr = await r.json();
    if (!arr || !arr.length) return {};
    var want = {};
    for (var i = 0; i < codes.length; i++) want[codes[i]] = true;
    var out = {};
    for (var j = 0; j < arr.length; j++) {
      var row = arr[j];
      var code = row['公司代號'];
      if (want[code] && !out[code]) out[code] = row['主旨 '] || row['主旨'] || '有重大訊息';
    }
    return out;
  } catch (e) { return {}; }
}

// 每日盤後自選股簡報：一天一次，彙整偏多/偏空家數 + 重大訊息（用收盤後維持的 signalState）
async function maybeDailyBrief() {
  var now = new Date();
  var tpe = new Date(now.getTime() + (now.getTimezoneOffset() + 480) * 60000);
  var day = tpe.getDay();
  if (day === 0 || day === 6) return;
  var mins = tpe.getHours() * 60 + tpe.getMinutes();
  if (mins < 13 * 60 + 35 || mins > 22 * 60) return; // 只在收盤後到晚間發
  var today = ymdTaipei();
  var bf = '';
  try { var b = CapacitorKV.get('briefFired'); bf = (b && b.value) ? b.value : ''; } catch (e) { bf = ''; }
  if (bf === today) return;
  var watch = [];
  try { var rw = CapacitorKV.get('watchConfig'); watch = (rw && rw.value) ? JSON.parse(rw.value) : []; } catch (e) { watch = []; }
  if (!watch.length) return;
  var lastSig = {};
  try { var ls = CapacitorKV.get('signalState'); lastSig = (ls && ls.value) ? JSON.parse(ls.value) : {}; } catch (e) { lastSig = {}; }
  var ups = 0;
  var downs = 0;
  var codes = [];
  var nameByCode = {};
  for (var i = 0; i < watch.length; i++) {
    var s = lastSig[watch[i].code];
    if (s === 'up') ups += 1; else if (s === 'down') downs += 1;
    codes.push(watch[i].code);
    nameByCode[watch[i].code] = watch[i].name || watch[i].code;
  }
  var events = await fetchMopsEvents(codes);
  var evList = [];
  for (var c in events) { if (Object.prototype.hasOwnProperty.call(events, c)) evList.push(nameByCode[c] || c); }
  var parts = ['偏多 ' + ups + '／偏空 ' + downs + '（共 ' + watch.length + ' 檔）'];
  if (evList.length) parts.push('重大訊息：' + evList.slice(0, 4).join('、'));
  try { CapacitorNotifications.schedule([{ id: hashId('dailybrief'), title: '今日自選股簡報', body: parts.join('｜') + '（點開看分析）' }]); } catch (e) { /* no-op */ }
  try { CapacitorKV.set('briefFired', today); } catch (e) { /* no-op */ }
}

// App 端推送設定 → 存進 KV 供排程事件讀取
addEventListener('saveConfig', function (resolve, reject, args) {
  try {
    var config = (args && args.config) ? args.config : [];
    CapacitorKV.set('alertConfig', JSON.stringify(config));
    resolve();
  } catch (e) { reject(e); }
});

// App 端推送「整份自選股清單」→ 存進 KV，供背景便宜訊號層監看（有狀況才亮燈）
addEventListener('saveWatch', function (resolve, reject, args) {
  try {
    var watch = (args && args.watch) ? args.watch : [];
    CapacitorKV.set('watchConfig', JSON.stringify(watch));
    resolve();
  } catch (e) { reject(e); }
});

// 排程事件：盤中檢查每檔是否碰到停損/停利/目標價，碰到就推播
addEventListener('priceAlerts', async function (resolve, reject) {
  try {
    if (!inMarketHours()) { await maybeDailyBrief(); resolve(); return; }

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

    // 自選股「便宜訊號層」：大漲/大跌或動能訊號翻轉就亮燈（每檔每日去重，不洗版、不跑 AI）
    var watch = [];
    try { var rw = CapacitorKV.get('watchConfig'); watch = (rw && rw.value) ? JSON.parse(rw.value) : []; } catch (e) { watch = []; }
    if (watch.length) {
      var lastSig = {};
      try { var ls = CapacitorKV.get('signalState'); lastSig = (ls && ls.value) ? JSON.parse(ls.value) : {}; } catch (e) { lastSig = {}; }
      var watchFired = {};
      try { var wf = CapacitorKV.get('watchFired'); watchFired = (wf && wf.value) ? JSON.parse(wf.value) : {}; } catch (e) { watchFired = {}; }
      var today = ymdTaipei();
      for (var w = 0; w < watch.length; w++) {
        var wit = watch[w];
        if (!wit || !wit.code) continue;
        var d = await fetchDaily(wit.code);
        if (!d) continue;
        var sig = quickSignal(d.closes);
        var chgPct = (d.prevClose && d.price != null) ? ((d.price - d.prevClose) / d.prevClose) * 100 : null;
        var prevSig = lastSig[wit.code] || null;
        var flipped = prevSig && sig !== 'neutral' && sig !== prevSig;
        var bigMove = chgPct != null && Math.abs(chgPct) >= 4;
        lastSig[wit.code] = sig;
        if ((flipped || bigMove) && watchFired[wit.code] !== today) {
          watchFired[wit.code] = today;
          var label = bigMove
            ? ((chgPct >= 0 ? '大漲 +' : '大跌 ') + chgPct.toFixed(1) + '%')
            : ('動能轉' + (sig === 'up' ? '多' : '空'));
          notes.push({ id: hashId('watch:' + wit.code), title: (wit.name || wit.code) + ' 有狀況', body: '現價 ' + (d.price != null ? d.price : '—') + '，' + label + '（點開看完整分析）' });
        }

        // AI 看法推翻監看：價格觸發 AI 給的推翻價位就提醒（每檔每日去重，key 用 :inv）
        if (wit.invLevel != null && wit.invDir && d.price != null) {
          var crossed = (wit.invDir === 'below') ? (d.price <= wit.invLevel) : (d.price >= wit.invLevel);
          var invKey = wit.code + ':inv';
          if (crossed && watchFired[invKey] !== today) {
            watchFired[invKey] = today;
            var leanTx = wit.lean === 'up' ? '偏多' : (wit.lean === 'down' ? '偏空' : '');
            notes.push({ id: hashId('inv:' + wit.code), title: (wit.name || wit.code) + '：AI 看法可能被推翻', body: '現價 ' + d.price + '，' + (wit.invDir === 'below' ? '跌破' : '站上') + ' ' + wit.invLevel + (leanTx ? ('（' + leanTx + '看法觸發推翻條件，建議重看）') : '') });
          } else if (!crossed && watchFired[invKey]) {
            delete watchFired[invKey];
          }
        }
      }
      try { CapacitorKV.set('signalState', JSON.stringify(lastSig)); } catch (e) { /* no-op */ }
      try { CapacitorKV.set('watchFired', JSON.stringify(watchFired)); } catch (e) { /* no-op */ }
    }

    if (notes.length) { try { CapacitorNotifications.schedule(notes); } catch (e) { /* no-op */ } }
    resolve();
  } catch (e) { reject(e); }
});
