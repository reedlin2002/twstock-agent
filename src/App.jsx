import { useState, useEffect } from 'react';
import {
  Search, Users, Newspaper, AlertTriangle,
  Compass, Loader2, Info, RefreshCw, TrendingUp,
} from 'lucide-react';
import {
  ComposedChart, Area, Line, BarChart, Bar, Cell, XAxis, YAxis,
  Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';

import './styles/app.css';
import { EXAMPLES, SECTIONS, LOAD_MSGS } from './data/constants.js';
import { fmtMD, pf, rangef, daysAgo } from './lib/format.js';
import { planSummary, toneForText } from './lib/technicals.js';
import {
  finmind, yahooPrice, processFinmind, resolveTickerAsync, buildProvidedData, extractAiText,
} from './lib/data.js';
import { parseReport } from './lib/parseReport.js';
import { LOCAL_DATA_SYSTEM_PROMPT, buildDataDrivenPrompt } from './lib/prompts.js';
import { PriceTip, ChipTip } from './components/Tooltips.jsx';
import { Stat } from './components/Stat.jsx';
import { Rows } from './components/Checklist.jsx';
import GlossaryModal from './components/GlossaryModal.jsx';
import AppSplash from './components/AppSplash.jsx';

export default function TaiwanStockAgentPro() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);
  const [fm, setFm] = useState({ status: 'idle' });
  const [activeCode, setActiveCode] = useState(null);
  const [showGlossary, setShowGlossary] = useState(false);
  const [splashDone, setSplashDone] = useState(false);

  useEffect(() => {
    if (!loading) return;
    setMsgIdx(0);
    const id = setInterval(() => setMsgIdx((i) => (i + 1) % LOAD_MSGS.length), 2200);
    return () => clearInterval(id);
  }, [loading]);

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

  const analyze = async (override) => {
    const q = (override ?? query).trim();
    if (!q || loading) return;
    setQuery(q); setLoading(true); setError(null); setResult(null); setFm({ status: 'idle' });
    const resolved = await resolveTickerAsync(q);
    const ticker = resolved?.code;
    if (!ticker) {
      setError('請輸入股票代號或正確的公司名稱（例如 2330 或 華通）。為了避免 AI 猜資料，沒有代號時先不進行分析。');
      setLoading(false);
      return;
    }
    if (resolved?.name && !q.includes(resolved.name)) {
      setQuery(`${resolved.name} ${ticker}`);
    }
    try {
      const fmData = await loadFinmind(ticker);
      if (!fmData) throw new Error('無法取得 Yahoo Finance 股價資料，先不進行 AI 分析，避免用猜的。');
      const companyName = resolved?.name || fmData.priceMeta?.longName || fmData.priceMeta?.shortName || fmData.priceMeta?.name || q.replace(/\d{4,6}/, '').trim() || ticker;
      const providedData = buildProvidedData({ query: q, ticker, companyName, fmData });
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
          { role: 'system', content: LOCAL_DATA_SYSTEM_PROMPT },
          { role: 'user', content: buildDataDrivenPrompt(q, providedData) }
        ],
        max_tokens: 1400,
        temperature: 0.35,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(upstreamPayload),
      });
      if (!res.ok) {
        let message = `分析服務回應錯誤（${res.status}），請稍後再試。`;
        try {
          const body = await res.json();
          message = body?.error?.message || body?.message || message;
        } catch {
          /* keep fallback message */
        }
        throw new Error(message);
      }
      const data = await res.json();
      const text = extractAiText(data);
      const parsed = parseReport(text);
      if (parsed) {
        setResult({
          ...parsed,
          name: parsed.name && parsed.name !== ticker ? parsed.name : companyName,
          ticker: parsed.ticker || ticker,
        });
      } else if (text && text.trim()) setResult({ _raw: text, name: q });
      else throw new Error('沒有取得分析結果，請換個代號或名稱再試。');
    } catch (e) {
      setError(e.message || '發生未知錯誤，請稍後再試。');
    } finally { setLoading(false); }
  };

  const idle = !result && !loading && !error;
  const ta = fm.status === 'ok' ? fm.ta : null;
  const planView = planSummary(ta);

  return (
    <>
      {!splashDone && <AppSplash onDone={() => setSplashDone(true)} />}
      <div className="ts">
      <div className="sh">
          <header className="hd">
            <div className="bd">
              <span className="mk">
                <img src="/app-icon.png" width="26" height="26" alt="App Icon" style={{ borderRadius: '4px' }} />
              </span>
              <div>
                <div className="tt">台股分析 <span className="ag">Spectrum</span></div>
                <div className="su">大師買點檢查表 ‧ AI 數據解讀 ‧ Yahoo Finance 股價</div>
              </div>
            </div>
            <div className="lg" title="台股慣例：紅漲、綠跌">
              <span className="li"><i className="dot u" />漲</span>
              <span className="li"><i className="dot d" />跌</span>
            </div>
          </header>

          <div className="ba">
            <div className="iw">
              <input className="in" value={query} onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') analyze(); }}
                placeholder="輸入股票代號，例如 2330；常見股票也可按下方快速鍵" />
            </div>
            <button className="go" onClick={() => analyze()} disabled={loading}>
              {loading ? <Loader2 size={17} className="spin" /> : <Search size={17} />}分析
            </button>
          </div>
          <div className="cps">
            {EXAMPLES.map((ex) => (
              <button key={ex.code} className="cp" disabled={loading} onClick={() => analyze(`${ex.name} ${ex.code}`)}>
                {ex.name}<span className="cd">{ex.code}</span>
              </button>
            ))}
          </div>

          {error && <div className="er"><AlertTriangle size={18} style={{ flex: 'none', marginTop: 1 }} /><span>{error}</span></div>}
          {loading && (
            <div className="ld"><Loader2 size={30} className="spin" style={{ color: 'var(--gold)' }} />
              <div className="lm">{LOAD_MSGS[msgIdx]}…</div>
              <div className="ls">資料抓取與分析約需 20–40 秒，技術檢查表同步載入</div>
            </div>
          )}
          {idle && (
            <div className="mt"><div className="t">輸入任一台股，開始分析</div>
              <div className="d">大師買點檢查表 ‧ 五大面向白話解讀 ‧ 法人買賣超與融資融券真實數據</div>
            </div>
          )}

          {result && !result._raw && (
            <div>
              <div className="qu">
                <div className="qt"><span className="qn">{result.name || '—'}</span>
                  {result.ticker && <span className="qk">{result.ticker}</span>}</div>
                {(result.exchange || result.sector) && (
                  <div className="tg">
                    {result.exchange && <span className="tag">{result.exchange}</span>}
                    {result.sector && <span className="tag">{result.sector}</span>}
                  </div>
                )}
                {result.snapshot && <div className="snp">{result.snapshot}</div>}
              </div>

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

                  <div className="cg">
                    <div className="chk">
                      <h3>趨勢結構檢查表</h3>
                      <div className="sb">Weinstein 階段分析 ＋ Minervini 趨勢樣板（套用台股均線）</div>
                      <Rows items={ta.trend} />
                      <div className="pg">
                        <div className="trk"><div className="fl" style={{ width: `${(ta.trendPass / 5) * 100}%` }} /></div>
                        <span className="pc">{ta.trendPass} / 5</span>
                      </div>
                    </div>
                    <div className="chk">
                      <h3>進場訊號（近 20 個交易日）</h3>
                      <div className="sb">O'Neil 突破 ‧ 拉回均線 ‧ 台股 KD／MACD 轉折</div>
                      <Rows items={ta.trigger} />
                    </div>
                  </div>

                </>
              )}

              {/* 法人籌碼動向 */}
              <div className="pn">
                <div className="ph"><span className="ic"><Users size={17} /></span><h3>法人籌碼動向</h3><span className="src">FinMind</span></div>
                <div className="psb">三大法人每日買賣超（張）‧ 紅買超 / 綠賣超</div>
                {fm.status === 'loading' && <div className="mn"><Loader2 size={15} className="spin" />載入法人籌碼中…</div>}
                {fm.status === 'fail' && <div className="mn">籌碼資料無法載入（請見下方文字分析）</div>}
                {fm.status === 'ok' && (
                  <>
                    {fm.chips && fm.chips.length > 0 && (
                      <ResponsiveContainer width="100%" height={158}>
                        <BarChart data={fm.chips} margin={{ top: 4, right: 6, left: -10, bottom: 0 }}>
                          <CartesianGrid stroke="#2C261E" vertical={false} />
                          <XAxis dataKey="date" tickFormatter={fmtMD} minTickGap={36} tick={{ fill: '#8C8472', fontSize: 10 }} stroke="#3A3025" />
                          <YAxis width={42} tick={{ fill: '#8C8472', fontSize: 10 }} stroke="#3A3025" />
                          <ReferenceLine y={0} stroke="#5b5346" />
                          <Tooltip content={<ChipTip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                          <Bar dataKey="net" radius={[2, 2, 0, 0]}>
                            {fm.chips.map((d, i) => <Cell key={i} fill={d.net >= 0 ? '#E0413C' : '#26A269'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                    {fm.sum && (
                      <div className="sts">
                        <Stat k="外資 近5日" v={fm.sum.外資} signed unit="張" />
                        <Stat k="投信 近5日" v={fm.sum.投信} signed unit="張" />
                        <Stat k="自營 近5日" v={fm.sum.自營} signed unit="張" />
                      </div>
                    )}
                    {fm.margin && (
                      <div className="sts">
                        <Stat k="融資餘額" v={fm.margin.marginBal} unit="張" />
                        <Stat k="融資 近5日增減" v={fm.margin.marginChg} signed unit="張" />
                        <Stat k="融券餘額" v={fm.margin.shortBal} unit="張" />
                        <Stat k="融券 近5日增減" v={fm.margin.shortChg} signed unit="張" />
                      </div>
                    )}
                    {fm.sum && (
                      <div className="tk">
                        {fm.sum.外資 >= 0 ? '外資近5日站在買方' : '外資近5日站在賣方'}、
                        {fm.sum.投信 >= 0 ? '投信買超' : '投信賣超'}
                        {fm.margin && fm.margin.marginChg != null ? `，融資${fm.margin.marginChg >= 0 ? '增加（追價意願較高）' : '減少（散戶退場/籌碼沉澱）'}` : ''}
                        。法人是否與股價同步，是台股研判籌碼的關鍵。
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* 買點判讀 */}
              {result.buyPoint && (
                <div className="buy">
                  <div className="h"><span className="ic"><Compass size={17} /></span><h3>買點判讀（白話）</h3></div>
                  <div className="b">{result.buyPoint}</div>
                </div>
              )}

              {/* 五大面向 */}
              <div className="sech">五大面向分析</div>
              <div className="gr">
                {SECTIONS.map((s, i) => result[s.key] ? (
                  <div className={`cd ${toneForText(result[s.key], s.key)}`} key={s.key} style={{ animationDelay: `${i * 55}ms` }}>
                    <div className="cdh"><span className="cdi"><s.Icon size={18} /></span>
                      <div><div className="cdt">{s.title}</div><div className="cdn">{s.hint}</div></div></div>
                    <div className="cdb">{result[s.key]}</div>
                  </div>
                ) : null)}
              </div>

              {/* 風險 */}
              {Array.isArray(result.risks) && result.risks.length > 0 && (
                <div className="risk">
                  <div className="h"><span className="ic"><AlertTriangle size={18} /></span><h3>風險提示</h3></div>
                  <ul className="rls">{result.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}

              {result.dataNote && <div className="nt"><Info size={15} style={{ flex: 'none', marginTop: 1 }} /><span>{result.dataNote}</span></div>}
            </div>
          )}

          {result && result._raw && (
            <div className="pn fb">{result._raw.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}</div>
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
      </div>
    </>
  );
}
