import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, BarChart3, Bot, ExternalLink, Loader2, Search, Sparkles, Star } from 'lucide-react';

import './styles/line.css';

const money = (value) => (value == null ? '-' : Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 2 }));
const pct = (value) => (value == null ? '-' : `${value >= 0 ? '+' : ''}${Number(value).toFixed(2)}%`);

function useLiffAuth() {
  const [state, setState] = useState({ ready: false, token: '', profile: null, error: '' });

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const liffId = import.meta.env.VITE_LIFF_ID || '';
      const liff = window.liff;
      if (!liff || !liffId) {
        setState({ ready: true, token: '', profile: null, error: '' });
        return;
      }
      try {
        await liff.init({ liffId });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const [profile, token] = await Promise.all([
          liff.getProfile().catch(() => null),
          Promise.resolve(liff.getAccessToken() || ''),
        ]);
        if (!cancelled) setState({ ready: true, token, profile, error: '' });
      } catch (error) {
        if (!cancelled) setState({ ready: true, token: '', profile: null, error: error?.message || 'LIFF 初始化失敗' });
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

async function apiJson(path, init = {}, token = '') {
  const headers = {
    ...(init.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(path, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `Request failed: ${response.status}`);
  return body;
}

function MiniChart({ rows = [] }) {
  const points = rows.filter((row) => Number.isFinite(row.close)).slice(-90);
  const path = useMemo(() => {
    if (points.length < 2) return '';
    const values = points.map((row) => row.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return points.map((row, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 44 - ((row.close - min) / span) * 38;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
  }, [points]);

  if (!path) return <div className="empty-chart">走勢資料不足</div>;
  return (
    <svg className="mini-chart" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label="Price trend">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function Section({ title, children, icon: Icon = Activity }) {
  return (
    <section className="line-section">
      <div className="section-title"><Icon size={17} />{title}</div>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Analysis({ analysis }) {
  const parsed = analysis?.parsed;
  if (!analysis) return null;
  if (!parsed) return <pre className="raw-ai">{analysis.raw || 'AI 未回傳內容'}</pre>;
  return (
    <div className="analysis-grid">
      {parsed.lean && <Section title="AI 傾向" icon={Sparkles}>{parsed.lean}</Section>}
      {parsed.confidence && <Section title="信心度" icon={Star}>{parsed.confidence}</Section>}
      {parsed.technical && <Section title="技術面" icon={BarChart3}>{parsed.technical}</Section>}
      {parsed.chips && <Section title="籌碼面" icon={Activity}>{parsed.chips}</Section>}
      {parsed.buyPoint && <Section title="買賣計畫" icon={Search}>{parsed.buyPoint}</Section>}
      {parsed.invalidate && <Section title="推翻條件" icon={AlertTriangle}>{parsed.invalidate}</Section>}
      {Array.isArray(parsed.risks) && parsed.risks.length > 0 && (
        <Section title="風險" icon={AlertTriangle}>
          <ul>{parsed.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul>
        </Section>
      )}
      {parsed.dataNote && <p className="data-note">{parsed.dataNote}</p>}
    </div>
  );
}

function App() {
  const liff = useLiffAuth();
  const params = new URLSearchParams(window.location.search);
  const initial = params.get('code') || params.get('query') || '';
  const [query, setQuery] = useState(initial);
  const [summary, setSummary] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState('');

  const search = async (nextQuery = query) => {
    const q = String(nextQuery || '').trim();
    if (!q) return;
    setLoading(true);
    setError('');
    setAnalysis(null);
    try {
      const body = await apiJson(`/api/stock/summary?query=${encodeURIComponent(q)}`, {}, liff.token);
      setSummary(body.summary);
      setQuery(`${body.summary.name} ${body.summary.code}`);
      window.history.replaceState(null, '', `/line?code=${encodeURIComponent(body.summary.code)}`);
    } catch (err) {
      setError(err.message || '查詢失敗');
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const runAi = async () => {
    if (!summary || aiLoading) return;
    setAiLoading(true);
    setError('');
    try {
      const body = await apiJson('/api/stock/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      }, liff.token);
      setAnalysis(body.analysis);
    } catch (err) {
      setError(err.message || 'AI 分析失敗');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    if (liff.ready && initial) search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liff.ready]);

  const changeTone = summary?.price?.changePct >= 0 ? 'up' : 'down';
  const plan = summary?.technical?.tradePlan;

  return (
    <main className="line-app">
      <header className="line-hero">
        <div className="brand-row"><Bot size={19} />010401 Finance LINE</div>
        <h1>台股快速分析</h1>
        <p>輸入代號取得即時摘要，必要時再產生 AI 完整分析。</p>
        {liff.profile && <span className="profile-pill">已連線：{liff.profile.displayName}</span>}
      </header>

      <form className="search-row" onSubmit={(event) => { event.preventDefault(); search(); }}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="輸入股票代號，例如 2330"
          inputMode="numeric"
        />
        <button type="submit" disabled={loading || !liff.ready}>
          {loading ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
          查詢
        </button>
      </form>

      {liff.error && <div className="notice warn">{liff.error}</div>}
      {error && <div className="notice error">{error}</div>}

      {summary && (
        <article className="stock-card">
          <div className="stock-head">
            <div>
              <div className="stock-name">{summary.name}</div>
              <div className="stock-code">{summary.code} · {summary.symbol}</div>
            </div>
            <span className={`state ${summary.technical?.state?.tone || 'neutral'}`}>
              {summary.technical?.state?.label || '無資料'}
            </span>
          </div>

          <div className="price-row">
            <strong>{money(summary.price.close)}</strong>
            <span className={changeTone}>{money(summary.price.change)} / {pct(summary.price.changePct)}</span>
          </div>
          <MiniChart rows={summary.technical?.chart || []} />

          <div className="metric-grid">
            <div><span>趨勢</span><b>{summary.technical?.trendPass ?? 0}/5</b></div>
            <div><span>RSI</span><b>{money(summary.technical?.rsi)}</b></div>
            <div><span>KD</span><b>{money(summary.technical?.kd?.k)} / {money(summary.technical?.kd?.d)}</b></div>
            <div><span>法人五日</span><b>{money(summary.chips?.fiveDay?.total)} 張</b></div>
          </div>

          {plan && (
            <Section title="買賣計畫" icon={BarChart3}>
              <div className="plan-grid">
                <div><span>觀察區</span><b>{money(plan.entryLow)} - {money(plan.entryHigh)}</b></div>
                <div><span>突破</span><b>{money(plan.breakout)}</b></div>
                <div><span>停損</span><b>{money(plan.stopLine)}</b></div>
                <div><span>目標</span><b>{money(plan.takeProfit1)} / {money(plan.takeProfit2)}</b></div>
              </div>
            </Section>
          )}

          <button className="ai-button" onClick={runAi} disabled={aiLoading}>
            {aiLoading ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
            {aiLoading ? 'AI 分析中' : '產生 AI 完整分析'}
          </button>

          <Analysis analysis={analysis} />

          <p className="disclaimer">{summary.disclaimer}</p>
        </article>
      )}

      <footer className="line-footer">
        <a href="https://github.com/reedlin2002/twstock-agent/releases" target="_blank" rel="noreferrer">
          最新 APK <ExternalLink size={13} />
        </a>
      </footer>
    </main>
  );
}

createRoot(document.getElementById('line-root')).render(<App />);
