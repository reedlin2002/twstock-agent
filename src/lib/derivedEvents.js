/* 本地「近期數據事件」：完全由已抓取／已計算的資料推導的事實，
 * 不呼叫 AI、不編造新聞。每筆事件都能在 ta / fm 數據中被佐證。
 * tone: 'pos'（偏多事實）| 'neg'（偏空事實）| 'neutral'
 */

const lots = (n) => Math.round(Math.abs(Number(n))).toLocaleString();
const stripParen = (s) => String(s).replace(/（[^）]*）/g, '').trim();

export function buildDataEvents(ta, fm) {
  const events = [];
  const hasTa = ta && typeof ta === 'object';
  const sum = fm && fm.sum && typeof fm.sum === 'object' ? fm.sum : null;
  const margin = fm && fm.margin && typeof fm.margin === 'object' ? fm.margin : null;

  // 近 20 日已偵測到的進場類訊號（皆為事實，由程式計算）
  if (hasTa && Array.isArray(ta.trigger)) {
    ta.trigger.forEach(([label, ok]) => {
      if (ok) events.push({ text: `近 20 日：${stripParen(label)}`, tone: 'pos' });
    });
  }

  // 收盤相對季線位置
  if (hasTa && ta.close != null && ta.ma60 != null) {
    if (ta.close >= ta.ma60) {
      events.push({ text: '收盤站在季線 MA60 之上', tone: 'pos' });
    } else {
      events.push({ text: '收盤仍在季線 MA60 之下', tone: 'neg' });
    }
  }

  // 52 週高點相對位置（取自趨勢檢查的已通過項）
  if (hasTa && Array.isArray(ta.trend)) {
    const near52 = ta.trend.find(([l]) => /52\s*週高/.test(l));
    if (near52 && near52[1]) events.push({ text: '股價位於 52 週高點附近（相對強勢區）', tone: 'pos' });
  }

  // RSI 過熱／偏弱（純描述，不下買賣結論）
  if (hasTa && ta.rsi != null && !Number.isNaN(ta.rsi)) {
    const rsi = Math.round(ta.rsi);
    if (rsi >= 75) events.push({ text: `RSI ${rsi}，短線偏熱，留意追高風險`, tone: 'neg' });
    else if (rsi <= 25) events.push({ text: `RSI ${rsi}，短線偏弱／超賣`, tone: 'neutral' });
  }

  // 法人近 5 日買賣超（事實數字）
  if (sum) {
    if (sum.外資 != null && Math.abs(sum.外資) >= 1) {
      events.push(sum.外資 >= 0
        ? { text: `外資近 5 日合計買超約 ${lots(sum.外資)} 張`, tone: 'pos' }
        : { text: `外資近 5 日合計賣超約 ${lots(sum.外資)} 張`, tone: 'neg' });
    }
    if (sum.投信 != null && Math.abs(sum.投信) >= 1) {
      events.push(sum.投信 >= 0
        ? { text: `投信近 5 日合計買超約 ${lots(sum.投信)} 張`, tone: 'pos' }
        : { text: `投信近 5 日合計賣超約 ${lots(sum.投信)} 張`, tone: 'neg' });
    }
  }

  // 融資／融券近 5 日變化（事實數字）
  if (margin) {
    if (margin.marginChg != null && Math.abs(margin.marginChg) >= 1) {
      events.push(margin.marginChg >= 0
        ? { text: `融資近 5 日增加約 ${lots(margin.marginChg)} 張（追價意願升）`, tone: 'neutral' }
        : { text: `融資近 5 日減少約 ${lots(margin.marginChg)} 張（籌碼沉澱）`, tone: 'neutral' });
    }
    if (margin.shortChg != null && Math.abs(margin.shortChg) >= 1) {
      events.push(margin.shortChg >= 0
        ? { text: `融券近 5 日增加約 ${lots(margin.shortChg)} 張`, tone: 'neutral' }
        : { text: `融券近 5 日減少約 ${lots(margin.shortChg)} 張`, tone: 'neutral' });
    }
  }

  const hasData = events.length > 0;
  return { events, hasData };
}
