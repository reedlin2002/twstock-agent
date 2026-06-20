/* 詳細數據底部彈窗：趨勢/進場檢查表 ‧ 法人籌碼 ‧ 近期數據事件 */
import { useState } from 'react';
import { BarChart3, X, Users, Newspaper, ListChecks } from 'lucide-react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts';
import { fmtMD } from '../lib/format.js';
import { useScrollLock } from '../lib/useScrollLock.js';
import { Stat } from './Stat.jsx';
import { Rows } from './Checklist.jsx';
import { ChipTip } from './Tooltips.jsx';

const TABS = [
  { key: 'check', label: '檢查表', Icon: ListChecks },
  { key: 'chips', label: '法人籌碼', Icon: Users },
  { key: 'events', label: '數據事件', Icon: Newspaper },
];

export default function StockDetailsModal({ open, onClose, ta, fm, dataEvents }) {
  useScrollLock(open);
  const [tab, setTab] = useState('check');
  const ok = fm?.status === 'ok';

  return (
    <div className={`glos-overlay ${open ? 'open' : ''}`} onClick={onClose}>
      <div className="glos-panel" onClick={(e) => e.stopPropagation()}>
        <div className="glos-hd">
          <div className="glos-tt"><BarChart3 size={20} />詳細數據</div>
          <button className="glos-cls" onClick={onClose} aria-label="關閉"><X size={20} /></button>
        </div>

        <div className="dt-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`dt-tab ${tab === t.key ? 'on' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <t.Icon size={15} />{t.label}
            </button>
          ))}
        </div>

        <div className="glos-bd">
          {/* ===== 檢查表 ===== */}
          {tab === 'check' && (
            ta ? (
              <div className="dt-stack">
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
            ) : (
              <div className="insuf">資料不足：股價資料無法載入，暫無檢查表。</div>
            )
          )}

          {/* ===== 法人籌碼 ===== */}
          {tab === 'chips' && (
            ok ? (
              <div className="dt-stack">
                <div className="psb">三大法人每日買賣超（張）‧ 紅買超 / 綠賣超</div>
                {fm.chips && fm.chips.length > 0 && (
                  <ResponsiveContainer width="100%" height={172}>
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
              </div>
            ) : (
              <div className="insuf">資料不足：籌碼資料無法載入。</div>
            )
          )}

          {/* ===== 近期數據事件 ===== */}
          {tab === 'events' && (
            <div className="dt-stack">
              <div className="psb">以下皆可由已抓取的價量與籌碼數據佐證，屬事實觀察、非新聞推測</div>
              {dataEvents?.hasData ? (
                <div className="evs">
                  {dataEvents.events.map((e, i) => (
                    <div className={`ev ${e.tone}`} key={i}><i className="evd" /><span>{e.text}</span></div>
                  ))}
                </div>
              ) : (
                <div className="insuf">資料不足：目前沒有可由數據明確佐證的事件。</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
