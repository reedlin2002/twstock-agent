import { useState, useEffect, useRef } from 'react';
import {
  Search, Newspaper, AlertTriangle, BarChart3,
  Compass, Loader2, Info, RefreshCw, TrendingUp,
  Star, Notebook, Copy, Check, Sparkles, Menu,
} from 'lucide-react';
import {
  ComposedChart, Area, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

import './styles/app.css';
import { EXAMPLES, SECTIONS, LOAD_MSGS } from './data/constants.js';
import { fmtMD, pf, sf, rangef, daysAgo } from './lib/format.js';
import { planSummary, toneForText } from './lib/technicals.js';
import {
  finmind, yahooPrice, processFinmind, resolveTickerAsync, buildProvidedData, extractAiText, googleNews, quickQuotes,
} from './lib/data.js';
import { parseReport, sanitizeLeaks } from './lib/parseReport.js';
import {
  LOCAL_DATA_SYSTEM_PROMPT, LIVE_SEARCH_SYSTEM_PROMPT, buildDataDrivenPrompt, buildNewsBlock,
} from './lib/prompts.js';
import { PriceTip } from './components/Tooltips.jsx';
import GlossaryModal from './components/GlossaryModal.jsx';
import AppSplash from './components/AppSplash.jsx';
import StockNoteModal from './components/StockNoteModal.jsx';
import StockDetailsModal from './components/StockDetailsModal.jsx';
import WatchlistDrawer from './components/WatchlistDrawer.jsx';
import { buildDataEvents } from './lib/derivedEvents.js';
import { buildMarkdownReport } from './lib/markdownReport.js';
import { buildHoldingStatus } from './lib/holdingStatus.js';
import {
  loadWatchlist, toggleWatch, isWatched,
  loadRecent, pushRecent,
  getNote, saveNote, clearNote, hasNote, DEFAULT_NOTE,
} from './lib/storage.js';

export default function TaiwanStockAgentPro() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false); // 快速階段：抓股價/籌碼中
  const [stock, setStock] = useState(null);       // 目前開啟的個股 { code, name }
  const [result, setResult] = useState(null);      // AI 產物（按需）
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [liveSearch, setLiveSearch] = useState(false); // 即時新聞（按需用 Google News 抓新聞做消息面，免費），預設關
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const [fm, setFm] = useState({ status: 'idle' });
  const [activeCode, setActiveCode] = useState(null);
  const [showGlossary, setShowGlossary] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const [watchlist, setWatchlist] = useState([]);
  const [recent, setRecent] = useState([]);
  const [note, setNote] = useState(DEFAULT_NOTE);
  const [showNote, setShowNote] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showWatch, setShowWatch] = useState(false); // 自選股抽屜開關
  const [quotes, setQuotes] = useState({});            // 自選股即時報價 { [code]: quote }
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [showDetails, setShowDetails] = useState(false); // 詳細數據彈窗開關
  const [aiHl, setAiHl] = useState(false);               // AI 結果出現時的高亮脈動
  const aiSecRef = useRef(null);                          // AI 區錨點（按下後自動捲到此）

  // 啟動時載入個人化資料（localStorage，已防呆）
  useEffect(() => {
    setWatchlist(loadWatchlist());
    setRecent(loadRecent());
  }, []);

  // 跑動載入文案（AI 深入分析較久時）
  useEffect(() => {
    if (!aiLoading) return;
    setMsgIdx(0);
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % LOAD_MSGS.length), 2200);
    return () => clearInterval(id);
  }, [aiLoading]);

  // AI 結果出現時，高亮脈動一次（提示結果落在這）
  useEffect(() => {
    if (!result) return;
    setAiHl(true);
    const id = setTimeout(() => setAiHl(false), 1500);
    return () => clearTimeout(id);
  }, [result]);

  // 開抽屜時抓自選股即時報價（清單變動也重抓；不輪詢）
  useEffect(() => {
    if (!showWatch || watchlist.length === 0) return;
    let cancelled = false;
    setQuotesLoading(true);
    quickQuotes(watchlist.map((it) => it.code))
      .then((map) => { if (!cancelled) setQuotes(map); })
      .finally(() => { if (!cancelled) setQuotesLoading(false); });
    return () => { cancelled = true; };
  }, [showWatch, watchlist]);

  const refreshQuotes = () => {
    if (watchlist.length === 0) return;
    setQuotesLoading(true);
    quickQuotes(watchlist.map((it) => it.code))
      .then(setQuotes)
      .finally(() => setQuotesLoading(false));
  };

  const loadFinmind = async (code) => {
    setActiveCode(code); setFm({ status: 'loading' });
    const [pricePack, inst, margin] = await Promise.all([
      yahooPrice(code),
      finmind('TaiwanStockInstitutionalInvestorsBuySell', code, daysAgo(45)),
      finmind('TaiwanStockMarginPurchaseShortSale', code, daysAgo(45)),
    ]);
    if (!pricePack?.rows?.length) { setFm({ status: 'fail' }); return null; }
    const data = {
      status: 'ok',
      ...processFinmind(pricePack.rows, inst, margin),
      sources: {
        price: `Yahoo Finance ${pricePack.symbol || code}`,
        chips: inst ? 'FinMind institutional investors' : null,
        margin: margin ? 'FinMind margin and short-sale' : null,
      },
      priceMeta: {
        symbol: pricePack.symbol,
        name: pricePack.name,
        shortName: pricePack.shortName,
        longName: pricePack.longName,
        currency: pricePack.currency,
        exchangeName: pricePack.exchangeName,
      },
    };
    setFm(data);
    return data;
  };

  // 階段一（快）：開啟個股，只抓股價/籌碼並本地計算，不呼叫 AI
  const openStock = async (override) => {
    const q = (override ?? query).trim();
    if (!q || loading) return;
    setQuery(q);
    setLoading(true);
    setError(null);
    setResult(null);
    setAiError(null);
    setStock(null);
    setFm({ status: 'idle' });
    const resolved = await resolveTickerAsync(q);
    const ticker = resolved?.code;
    if (!ticker) {
      setError('請輸入股票代號或正確的公司名稱（例如 2330 或 華通）。');
      setLoading(false);
      return;
    }
    if (resolved?.name && !q.includes(resolved.name)) {
      setQuery(`${resolved.name} ${ticker}`);
    }
    try {
      const fmData = await loadFinmind(ticker);
      if (!fmData) throw new Error('無法取得 Yahoo Finance 股價資料，請稍後再試或換個代號。');
      const companyName = resolved?.name || fmData.priceMeta?.longName || fmData.priceMeta?.shortName || fmData.priceMeta?.name || q.replace(/\d{4,6}/, '').trim() || ticker;
      setRecent((prev) => pushRecent(prev, ticker, companyName));
      setNote(getNote(ticker));
      setStock({ code: ticker, name: companyName });
    } catch (e) {
      setError(e.message || '發生未知錯誤，請稍後再試。');
    } finally {
      setLoading(false);
    }
  };

  // 階段二（慢，按需）：用已抓到的數據跑 AI 五大面向
  const runAi = async () => {
    if (!stock || fm.status !== 'ok' || aiLoading) return;
    setAiLoading(true);
    setAiError(null);
    // 立即捲到底部 AI 區，讓使用者看到分析進度（結果就落在這）
    setTimeout(() => aiSecRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    const q = `${stock.name} ${stock.code}`.trim();
    try {
      const providedData = buildProvidedData({ query: q, ticker: stock.code, companyName: stock.name, fmData: fm });
      // 即時新聞：用公司名抓 Google News（命中台股中文新聞最準），缺名才退回完整查詢字串
      const newsItems = liveSearch ? await googleNews(stock.name || q) : [];
      const newsBlock = liveSearch ? buildNewsBlock(newsItems) : '';
      const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY || '';
      const endpoint = import.meta.env.VITE_AI_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
      const model = import.meta.env.VITE_AI_MODEL || 'openrouter/free';
      const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        'X-OpenRouter-Title': import.meta.env.VITE_OPENROUTER_APP_TITLE || 'Taiwan Stock Agent',
      };
      const upstreamPayload = {
        model,
        messages: [
          { role: 'system', content: liveSearch ? LIVE_SEARCH_SYSTEM_PROMPT : LOCAL_DATA_SYSTEM_PROMPT },
          { role: 'user', content: buildDataDrivenPrompt(q, providedData, newsBlock) },
        ],
        max_tokens: 1400,
        temperature: 0.35,
      };
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(upstreamPayload) });
      if (!res.ok) {
        let message = `分析服務回應錯誤（${res.status}），請稍後再試。`;
        try {
          const body = await res.json();
          message = body?.error?.message || body?.message || message;
        } catch { /* keep fallback */ }
        throw new Error(message);
      }
      const data = await res.json();
      const text = extractAiText(data);
      const sources = liveSearch ? newsItems : [];
      const parsed = parseReport(text);
      if (parsed) {
        setResult({
          ...parsed,
          name: parsed.name && parsed.name !== stock.code ? parsed.name : stock.name,
          ticker: parsed.ticker || stock.code,
          _sources: sources,
        });
      } else if (text && text.trim()) setResult({ _raw: sanitizeLeaks(text), name: stock.name, _sources: sources });
      else throw new Error('沒有取得分析結果，請稍後再試。');
    } catch (e) {
      setAiError(e.message || 'AI 分析發生錯誤，請稍後再試。');
    } finally {
      setAiLoading(false);
    }
  };

  const home = !stock && !loading;
  const ta = fm.status === 'ok' ? fm.ta : null;
  const planView = planSummary(ta);

  const curCode = stock?.code || activeCode;
  const curName = stock?.name || (query || '').replace(/\d{4,6}/, '').trim() || curCode;
  const latestClose = (fm.status === 'ok' && fm.price && fm.price.length)
    ? fm.price[fm.price.length - 1].close
    : (ta?.close ?? null);
  const dataEvents = buildDataEvents(ta, fm);
  const triggerHit = ta ? ta.trigger.filter(([, ok]) => ok).length : 0; // 進場訊號命中數
  const sum = fm.status === 'ok' ? fm.sum : null;                        // 三大法人近5日彙總
  const holding = buildHoldingStatus(note, latestClose);
  const watched = curCode ? isWatched(watchlist, curCode) : false;
  const noteFilled = curCode ? hasNote(curCode) : false;

  // 標題即時價格讀數（最新收盤 + 當日漲跌，紅漲綠跌）
  const priceInfo = (() => {
    if (fm.status !== 'ok' || !fm.price || !fm.price.length) return null;
    const arr = fm.price;
    const last = arr[arr.length - 1];
    const prev = arr.length > 1 ? arr[arr.length - 2] : null;
    const chg = prev ? last.close - prev.close : null;
    const chgPct = prev && prev.close ? (chg / prev.close) * 100 : null;
    return { close: last.close, date: last.date, chg, chgPct };
  })();

  const onToggleWatch = () => {
    if (!curCode) return;
    setWatchlist((prev) => toggleWatch(prev, curCode, curName));
  };
  // 回首頁：清掉目前個股，回到搜尋首頁
  const goHome = () => {
    setStock(null);
    setResult(null);
    setError(null);
    setAiError(null);
    setFm({ status: 'idle' });
    setActiveCode(null);
    setQuery('');
  };
  // 抽屜：點自選股 / 最近查詢 → 直接開股並關抽屜
  const onDrawerSelect = (code, name) => {
    setShowWatch(false);
    openStock(`${name || ''} ${code}`.trim());
  };
  // 抽屜內搜尋 → 開股並關抽屜
  const onDrawerSearch = (text) => {
    setShowWatch(false);
    openStock(text);
  };
  // 抽屜：移除自選
  const onDrawerRemove = (code) => {
    setWatchlist((prev) => toggleWatch(prev, code));
  };
  const onSaveNote = (rec) => {
    if (!curCode) return;
    setNote(saveNote(curCode, rec));
    setShowNote(false);
  };
  const onClearNote = () => {
    if (curCode) clearNote(curCode);
    setNote({ ...DEFAULT_NOTE });
    setShowNote(false);
  };
  const copyReport = async () => {
    const md = buildMarkdownReport({ name: curName, ticker: curCode, result, ta, fm, note, events: dataEvents, latestClose });
    let ok = false;
    try {
      await navigator.clipboard.writeText(md);
      ok = true;
    } catch {
      try {
        const el = document.createElement('textarea');
        el.value = md;
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        ok = document.execCommand('copy');
        document.body.removeChild(el);
      } catch {
        ok = false;
      }
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1800); }
  };

  return (
    <>
      {!splashDone && <AppSplash onDone={() => setSplashDone(true)} />}
      <div className="ts">
      <div className="sh">
          <header className="hd">
            <button type="button" className="mbtn" onClick={() => setShowWatch(true)} title="自選股選單" aria-label="自選股選單">
              <Menu size={20} />
              {watchlist.length > 0 && <span className="badge">{watchlist.length}</span>}
            </button>
            <button type="button" className="bd bd-btn" onClick={goHome} title="回首頁" aria-label="回首頁">
              <span className="mk">
                <img src="/app-icon.png" width="26" height="26" alt="App Icon" style={{ borderRadius: '4px' }} />
              </span>
              <div>
                <div className="tt">台股分析 <span className="ag">Spectrum</span></div>
                <div className="su">大師買點檢查表 ‧ AI 數據解讀 ‧ Yahoo Finance 股價</div>
              </div>
            </button>
            <span className="hd-spacer" aria-hidden="true" />
          </header>

          <div className="ba">
            <div className="iw">
              <input className="in" value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') openStock(); }}
                placeholder="輸入股票代號，例如 2330；常見股票也可按下方快速鍵" />
            </div>
            <button className="go" onClick={() => openStock()} disabled={loading}>
              {loading ? <Loader2 size={17} className="spin" /> : <Search size={17} />}查詢
            </button>
          </div>

          {/* 首頁才顯示：熱門（單行橫向滑動）。自選股 / 最近查詢 已在左上 ☰ 抽屜，首頁不重複 */}
          {home && (
            <div className="hot">
              <span className="hotlabel"><Star size={13} />熱門</span>
              <div className="hotrow">
                {EXAMPLES.map((ex) => (
                  <button key={ex.code} className="cp" onClick={() => openStock(`${ex.name} ${ex.code}`)}>
                    {ex.name}<span className="cd">{ex.code}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && <div className="er"><AlertTriangle size={18} style={{ flex: 'none', marginTop: 1 }} /><span>{error}</span></div>}

          {loading && (
            <div className="ld"><Loader2 size={30} className="spin" style={{ color: 'var(--gold)' }} />
              <div className="lm">讀取股價與籌碼資料中…</div>
              <div className="ls">只抓資料與本地計算，約幾秒；AI 分析改由下方按鈕按需執行</div>
            </div>
          )}

          {home && !error && (
            <div className="mt"><div className="t">輸入任一台股，先看價格與技術面</div>
              <div className="d">查詢即時出價格走勢、買點檢查表與法人籌碼；需要時再按「AI 深入分析」</div>
              <div className="d2">自選股與最近查詢都收在左上角 <Menu size={13} /> 選單裡</div>
            </div>
          )}

          {/* ===== 個股頁（快，不需 AI） ===== */}
          {stock && (
            <div>
              <div className="qu">
                <div className="qt"><span className="qn">{curName || '—'}</span>
                  {curCode && <span className="qk">{curCode}</span>}</div>
                {priceInfo && (
                  <div className="prc">
                    <span className="prv">{pf(priceInfo.close)}</span>
                    {priceInfo.chg != null && (
                      <span className={`prc-chg ${priceInfo.chg >= 0 ? 'u' : 'd'}`}>
                        {priceInfo.chg >= 0 ? '▲' : '▼'} {pf(Math.abs(priceInfo.chg))}
                        {priceInfo.chgPct != null && <>（{priceInfo.chgPct >= 0 ? '+' : ''}{priceInfo.chgPct.toFixed(2)}%）</>}
                      </span>
                    )}
                    <span className="prd">收盤 {priceInfo.date}</span>
                  </div>
                )}
                {(result?.exchange || result?.sector) && (
                  <div className="tg">
                    {result.exchange && <span className="tag">{result.exchange}</span>}
                    {result.sector && <span className="tag">{result.sector}</span>}
                  </div>
                )}
                {result?.snapshot && <div className="snp">{result.snapshot}</div>}
                <div className="qacts">
                  <button className={`qbtn ${watched ? 'on' : ''}`} onClick={onToggleWatch} disabled={!curCode}>
                    <Star size={14} fill={watched ? 'currentColor' : 'none'} />{watched ? '已收藏' : '收藏'}
                  </button>
                  <button className={`qbtn ${noteFilled ? 'on' : ''}`} onClick={() => setShowNote(true)} disabled={!curCode}>
                    <Notebook size={14} />我的紀錄{noteFilled ? '（已填）' : ''}
                  </button>
                  <button className="qbtn" onClick={copyReport}>
                    {copied ? <><Check size={14} />已複製</> : <><Copy size={14} />複製報告</>}
                  </button>
                </div>
              </div>

              {/* 置頂 AI 主按鈕：按下後結果落在最下方 AI 區並自動捲過去 */}
              {fm.status === 'ok' && (
                <div className="aitop">
                  <button className="aibtn aitop-btn" onClick={runAi} disabled={aiLoading}>
                    {aiLoading
                      ? <><Loader2 size={16} className="spin" />AI 分析中…</>
                      : <><Sparkles size={16} />{result ? '重新 AI 分析' : 'AI 深入分析'}{liveSearch ? '（含 Google 新聞）' : ''}</>}
                  </button>
                  <label className="aitoggle aitop-toggle">
                    <input type="checkbox" checked={liveSearch} onChange={(e) => setLiveSearch(e.target.checked)} />
                    <span className="aiswitch" />
                    <span className="aitoggletx">
                      即時新聞（Google News）<span className="aitoggled">抓近期新聞・附標題日期來源，免費（預設關）</span>
                    </span>
                  </label>
                  <div className="aitop-hint"><Info size={12} />整理基本面 / 消息面 / 產業 / 買點 / 風險，約 20–40 秒。結果會出現在最下方，按下自動帶你過去。</div>
                </div>
              )}

              {/* 持股條件提醒（依我的紀錄 + 目前股價） */}
              {holding && (
                <div className="hold">
                  <div className="holdh"><span className="ic"><Notebook size={16} /></span>
                    <h3>我的持股提醒</h3>
                    <button className="holde" onClick={() => setShowNote(true)}>編輯</button>
                  </div>
                  <div className="holdgrid">
                    <div className="holdi"><div className="k">是否持有</div><div className="v">{holding.held ? '持有中' : '未持有'}</div></div>
                    {holding.pnl && (
                      <div className="holdi"><div className="k">未實現損益</div>
                        <div className={`v ${holding.pnl.pnl >= 0 ? 'u' : 'd'}`}>
                          {holding.pnl.pnl >= 0 ? '+' : ''}{Math.round(holding.pnl.pnl).toLocaleString()}
                          {holding.pnl.pct != null && <span className="sub">（{holding.pnl.pct >= 0 ? '+' : ''}{holding.pnl.pct.toFixed(1)}%）</span>}
                        </div>
                      </div>
                    )}
                    {holding.stop && (
                      <div className="holdi"><div className="k">距停損 {pf(holding.stop.value)}</div>
                        <div className={`v ${holding.stop.hit ? 'd' : ''}`}>{holding.stop.hit ? '已跌破' : `約 ${holding.stop.pct.toFixed(1)}%`}</div>
                      </div>
                    )}
                    {holding.take && (
                      <div className="holdi"><div className="k">距停利 {pf(holding.take.value)}</div>
                        <div className="v">{holding.take.hit ? '已達成' : `約 ${holding.take.pct.toFixed(1)}%`}</div>
                      </div>
                    )}
                  </div>
                  {holding.alerts.map((a, i) => (
                    <div className={`holda ${a.level}`} key={i}><AlertTriangle size={14} /><span>{a.text}</span></div>
                  ))}
                  {holding.notes.map((t, i) => (
                    <div className="holdn" key={i}>{t}</div>
                  ))}
                </div>
              )}

              {/* 股價走勢圖 */}
              <div className="pn">
                <div className="ph"><span className="ic"><TrendingUp size={17} /></span><h3>股價走勢</h3><span className="src">Yahoo Finance</span></div>
                {fm.status === 'loading' && <div className="mn"><Loader2 size={15} className="spin" />載入即時行情中…</div>}
                {fm.status === 'fail' && <div className="mn">Yahoo Finance 股價無法載入{activeCode && <button className="rt" onClick={() => loadFinmind(activeCode)}><RefreshCw size={12} />重試</button>}</div>}
                {fm.status === 'ok' && fm.price && (
                  <>
                    <div className="clg">
                      <span><i style={{ background: '#E2A636' }} />收盤</span>
                      <span><i style={{ background: '#5AA9FF' }} />月線 MA20</span>
                      <span><i style={{ background: '#FF85B9' }} />季線 MA60</span>
                    </div>
                    <ResponsiveContainer width="100%" height={244}>
                      <ComposedChart data={fm.price} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                        <defs><linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#E2A636" stopOpacity={0.32} />
                          <stop offset="100%" stopColor="#E2A636" stopOpacity={0} />
                        </linearGradient></defs>
                        <CartesianGrid stroke="#2C261E" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={fmtMD} minTickGap={42} tick={{ fill: '#8C8472', fontSize: 10 }} stroke="#3A3025" />
                        <YAxis domain={['auto', 'auto']} width={42} tick={{ fill: '#8C8472', fontSize: 10 }} stroke="#3A3025" />
                        <Tooltip content={<PriceTip />} />
                        <Area type="monotone" dataKey="close" stroke="#E2A636" strokeWidth={1.7} fill="url(#gc)" dot={false} />
                        <Line type="monotone" dataKey="ma20" stroke="#5AA9FF" strokeWidth={1} dot={false} />
                        <Line type="monotone" dataKey="ma60" stroke="#FF85B9" strokeWidth={1} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </>
                )}
              </div>

              {/* 大師買點檢查表（真實股價計算） */}
              {ta && (
                <>
                  {ta.tradePlan && (
                    <div className={`plan ${ta.tradePlan.cls}`}>
                      <div className="plh">
                        <div className="plcopy">
                          <span className="plt">{planView?.title || ta.tradePlan.mode}</span>
                          <div className="pld">{planView?.detail || ta.tradePlan.note}</div>
                          <span className="plb">趨勢 {ta.trendPass}/5 · RSI {Math.round(ta.rsi)} · KD {Math.round(ta.k)}/{Math.round(ta.d)}</span>
                        </div>
                      </div>
                      <div className="plgrid">
                        <div className="pli good" title="靠近區間再看量價">
                          <div className="k">觀察買點</div>
                          <div className="v">{rangef(ta.tradePlan.entryLow, ta.tradePlan.entryHigh)}</div>
                        </div>
                        <div className="pli good" title="放量站上才算加分">
                          <div className="k">突破參考</div>
                          <div className="v">{pf(ta.tradePlan.breakout)}</div>
                        </div>
                        <div className="pli bad" title="先定義錯了怎麼辦">
                          <div className="k">跌破就收手</div>
                          <div className="v">{pf(ta.tradePlan.stopLine)}</div>
                        </div>
                        <div className="pli take" title={`約 2R / 3R；續強看 ${pf(ta.tradePlan.trailStop)}`}>
                          <div className="k">漲到分批收手</div>
                          <div className="v">{pf(ta.tradePlan.takeProfit1)} / {pf(ta.tradePlan.takeProfit2)}</div>
                        </div>
                      </div>
                      <div className="plnote">{ta.tradePlan.note} 以上是規則化參考，不是保證獲利或投資建議。</div>
                    </div>
                  )}
                </>
              )}

              {/* 摘要數字列：headline 數字 inline，明細收進「詳細數據」彈窗 */}
              {(ta || fm.status === 'ok') && (
                <div className="sumstrip">
                  <div className="sumchips">
                    {ta && <span className="sumchip"><b>趨勢</b>{ta.trendPass}/5</span>}
                    {ta && <span className="sumchip"><b>進場</b>{triggerHit} 命中</span>}
                    {sum && <span className={`sumchip ${sum.外資 >= 0 ? 'u' : 'd'}`}><b>外資5日</b>{sf(sum.外資)}</span>}
                    {sum && <span className={`sumchip ${sum.投信 >= 0 ? 'u' : 'd'}`}><b>投信5日</b>{sf(sum.投信)}</span>}
                  </div>
                  <button className="sumbtn" onClick={() => setShowDetails(true)}>
                    <BarChart3 size={14} />詳細數據 ▾
                  </button>
                </div>
              )}

              {/* ===== AI 深入分析區（慢，按需）：結果落在這，按上方按鈕觸發並自動捲到此 ===== */}
              <div className={`aisec ${aiHl ? 'hl' : ''}`} ref={aiSecRef}>
                <div className="aihd"><Sparkles size={16} />AI 深入分析</div>
                {aiError && (
                  <div className="er" style={{ marginTop: 14 }}>
                    <AlertTriangle size={18} style={{ flex: 'none', marginTop: 1 }} />
                    <span>{aiError}　<button className="rt" onClick={runAi}><RefreshCw size={12} />重試</button></span>
                  </div>
                )}

                {!result && !aiLoading && !aiError && (
                  <div className="aiph">
                    <Sparkles size={22} />
                    <div className="aiph-t">分析結果會出現在這裡</div>
                    <div className="aiph-d">按上方「AI 深入分析」按鈕，約 20–40 秒後會整理出基本面、消息面、產業地位、買點條件與風險。</div>
                  </div>
                )}

                {aiLoading && (
                  <div className="ld"><Loader2 size={30} className="spin" style={{ color: 'var(--gold)' }} />
                    <div className="lm">{LOAD_MSGS[msgIdx]}…</div>
                    <div className="ls">AI 正在整理基本面 / 消息面 / 產業，約 20–40 秒</div>
                  </div>
                )}

                {result && !result._raw && (
                  <>
                    {result.buyPoint && (
                      <div className="buy">
                        <div className="h"><span className="ic"><Compass size={17} /></span><h3>買點條件觀察（研究輔助）</h3></div>
                        <div className="b">{result.buyPoint}</div>
                      </div>
                    )}

                    <div className="sech">五大面向分析</div>
                    <div className="gr">
                      {SECTIONS.map((s, i) => {
                        const val = result[s.key];
                        // 消息面即使空白也顯示卡片並標示「資料不足」
                        if (!val && s.key !== 'news') return null;
                        return (
                          <div className={`cd ${val ? toneForText(val, s.key) : 'neutral'}`} key={s.key} style={{ animationDelay: `${i * 55}ms` }}>
                            <div className="cdh"><span className="cdi"><s.Icon size={18} /></span>
                              <div><div className="cdt">{s.title}</div><div className="cdn">{s.hint}</div></div></div>
                            <div className="cdb">
                              {val || <span className="insuf">資料不足：AI 未找到可佐證的近期新聞，可參考上方「近期數據事件」。</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {Array.isArray(result.risks) && result.risks.length > 0 && (
                      <div className="risk">
                        <div className="h"><span className="ic"><AlertTriangle size={18} /></span><h3>風險提示</h3></div>
                        <ul className="rls">{result.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                      </div>
                    )}

                    {result.dataNote && <div className="nt"><Info size={15} style={{ flex: 'none', marginTop: 1 }} /><span>{result.dataNote}</span></div>}
                  </>
                )}

                {result && result._raw && (
                  <div className="pn fb">{result._raw.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
                )}

                {result?._sources?.length > 0 && (
                  <div className="srcs">
                    <div className="srcsh"><Newspaper size={15} />新聞來源（Google News）</div>
                    {result._sources.map((s, i) => (
                      <a className="srcrow" key={i} href={s.url} target="_blank" rel="noopener noreferrer">
                        <span className="srctt">{s.title}</span>
                        {(s.source || s.date) && (
                          <span className="srcdate">{[s.source, s.date].filter(Boolean).join(' ‧ ')}</span>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <footer className="ds">
            檢查表由 Yahoo Finance 股價與本機技術指標計算，籌碼數據若可用則補充 FinMind，文字由 AI 根據已抓取資料生成，<b>僅供研究與教育參考，不構成任何投資建議或買賣推薦</b>。<br />
            技術訊號與法人動向皆不保證未來表現，投資有風險，請自行評估並嚴設停損。
          </footer>
        </div>

        <GlossaryModal
          open={showGlossary}
          onOpen={() => setShowGlossary(true)}
          onClose={() => setShowGlossary(false)}
        />

        <StockNoteModal
          open={showNote}
          onClose={() => setShowNote(false)}
          code={curCode}
          name={curName}
          record={note}
          latestClose={latestClose}
          onSave={onSaveNote}
          onClear={onClearNote}
        />

        <StockDetailsModal
          open={showDetails}
          onClose={() => setShowDetails(false)}
          ta={ta}
          fm={fm}
          dataEvents={dataEvents}
        />

        <WatchlistDrawer
          open={showWatch}
          onClose={() => setShowWatch(false)}
          watchlist={watchlist}
          recent={recent}
          quotes={quotes}
          quotesLoading={quotesLoading}
          currentCode={curCode}
          currentName={curName}
          currentWatched={watched}
          onSelect={onDrawerSelect}
          onSearch={onDrawerSearch}
          onRemove={onDrawerRemove}
          onRefresh={refreshQuotes}
          onAddCurrent={onToggleWatch}
        />
      </div>
    </>
  );
}
