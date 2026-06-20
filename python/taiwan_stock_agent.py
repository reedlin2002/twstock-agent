#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
台股證券分析 Agent —— 真實資料 + 大師買點判讀 + 互動式圖表報告
================================================================

抓取台股真實歷史股價，計算技術指標，依據三位實戰大師
（William O'Neil / Mark Minervini / Stan Weinstein）以及台股常用的
KD、均線、籌碼觀念，標出「買點訊號」並判讀目前是否處於好的進場區，
最後輸出一份漂亮的互動式 HTML 報告（不是難看的 JSON）。

大師買點的共同精神（程式邏輯即由此而來）：
  1. 趨勢優先：只在「上升趨勢」找買點，價格要站上長期均線
     （Weinstein 的 30 週線 / 200 日線、Minervini 的 50/150/200 日線排列）。
  2. 兩種低風險買點：
     (a) 突破型 —— 帶量突破整理區/前高（O'Neil 杯柄、Weinstein Stage 2 突破）。
     (b) 拉回型 —— 強勢股回測上彎均線後再起（Weinstein/台股「拉回季線」）。
  3. 量能確認：突破要有 1.5～3 倍的均量，否則容易是假突破。
  4. 動能與位置：靠近 52 週高點、相對強勢（Minervini 趨勢樣板）。
  5. 紀律最重要：進場前先設好停損（多在 -7~8% 或跌破支撐/均線）。
  台股實戰再加：KD 低檔黃金交叉、站上季線（60MA）、法人/投信連續買超。

使用方式：
  pip install yfinance pandas numpy plotly
  python taiwan_stock_agent.py 2330
  （不帶參數會詢問代號，預設 2330 台積電；上櫃股自動嘗試 .TWO）

或直接貼到 Google Colab 執行，圖表會內嵌顯示，報告檔可下載。

⚠ 本工具僅供研究與教育參考，不構成投資建議。技術訊號不保證未來表現，
   法人籌碼需另接資料源（見檔尾說明），投資請自行評估並嚴設停損。
"""

import sys
import math
import datetime as dt

import numpy as np
import pandas as pd

try:
    import yfinance as yf
except ImportError:
    sys.exit("缺少套件，請先執行：pip install yfinance pandas numpy plotly")

import plotly.graph_objects as go
from plotly.subplots import make_subplots

IS_COLAB = "google.colab" in sys.modules

# 台股顏色慣例：紅漲、綠跌
C_UP = "#E0413C"
C_DOWN = "#26A269"
C_INK = "#15120E"
C_PANEL = "#1E1A15"
C_LINE = "#2C261E"
C_TEXT = "#EBE3D4"
C_DIM = "#9D927E"
C_GOLD = "#E2A636"
C_BLUE = "#5AA9FF"
C_PURPLE = "#B98BFF"
C_PINK = "#FF85B9"
C_GRAY = "#8C8472"


# ─────────────────────────────────────────────────────────────
# 1. 抓取真實資料
# ─────────────────────────────────────────────────────────────
def fetch_data(code: str, period: str = "2y"):
    code = code.strip().upper()
    candidates = [code] if code.endswith((".TW", ".TWO")) else [code + ".TW", code + ".TWO"]
    last_err = None
    for sym in candidates:
        try:
            df = yf.download(sym, period=period, interval="1d",
                             auto_adjust=True, progress=False)
        except Exception as e:  # noqa
            last_err = e
            continue
        if df is None or len(df) < 60:
            continue
        # 攤平可能的 MultiIndex 欄位
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = df.columns.get_level_values(0)
        df = df[["Open", "High", "Low", "Close", "Volume"]].dropna()
        df.index = pd.to_datetime(df.index)
        return df, sym
    raise ValueError(f"查無「{code}」的資料，請確認股票代號是否正確。{last_err or ''}")


def try_get_name(sym: str, code: str) -> str:
    try:
        info = yf.Ticker(sym).info
        for k in ("longName", "shortName"):
            if info.get(k):
                return info[k]
    except Exception:  # noqa
        pass
    return code


# ─────────────────────────────────────────────────────────────
# 2. 技術指標
# ─────────────────────────────────────────────────────────────
def add_indicators(df: pd.DataFrame) -> pd.DataFrame:
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]

    for n in (5, 10, 20, 60, 120, 240):
        df[f"MA{n}"] = c.rolling(n, min_periods=1).mean()
    df["VOL_MA20"] = v.rolling(20, min_periods=1).mean()
    df["VOL_MA5"] = v.rolling(5, min_periods=1).mean()

    # 布林通道 (20, 2)
    ma20 = c.rolling(20, min_periods=1).mean()
    sd20 = c.rolling(20, min_periods=1).std().fillna(0)
    df["BB_UP"] = ma20 + 2 * sd20
    df["BB_DN"] = ma20 - 2 * sd20

    # KD (9,3,3)：台股最常用
    low9 = l.rolling(9, min_periods=1).min()
    high9 = h.rolling(9, min_periods=1).max()
    rsv = ((c - low9) / (high9 - low9).replace(0, np.nan) * 100).fillna(50)
    df["K"] = rsv.ewm(alpha=1 / 3, adjust=False).mean()
    df["D"] = df["K"].ewm(alpha=1 / 3, adjust=False).mean()

    # MACD (12,26,9)
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    df["DIF"] = ema12 - ema26
    df["DEA"] = df["DIF"].ewm(span=9, adjust=False).mean()
    df["OSC"] = df["DIF"] - df["DEA"]

    # RSI(14) Wilder
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    df["RSI"] = 100 - 100 / (1 + gain / loss.replace(0, np.nan))

    # ATR(14)：真實波幅的移動平均（與前端 technicals.js 一致，供交易計畫用）
    prev_c = c.shift()
    tr = pd.concat([h - l, (h - prev_c).abs(), (l - prev_c).abs()], axis=1).max(axis=1)
    df["ATR14"] = tr.rolling(14, min_periods=1).mean()

    # 52 週高低（約 240 交易日）
    df["HI52"] = c.rolling(240, min_periods=20).max()
    df["LO52"] = c.rolling(240, min_periods=20).min()

    return df


# ─────────────────────────────────────────────────────────────
# 3. 買點訊號偵測（標在圖上，各自對應一種大師方法）
# ─────────────────────────────────────────────────────────────
def detect_signals(df: pd.DataFrame) -> dict:
    c, v, o = df["Close"], df["Volume"], df["Open"]

    # (a) KD 低檔黃金交叉：K 上穿 D 且 K < 30  → 台股波段起漲點
    kd_gold = (df["K"] > df["D"]) & (df["K"].shift() <= df["D"].shift()) & (df["K"] < 30)

    # (b) 站上季線且季線上彎：趨勢由弱轉強（Weinstein Stage 1→2 的味道）
    reclaim_ma60 = (c > df["MA60"]) & (c.shift() <= df["MA60"].shift()) & \
                   (df["MA60"] > df["MA60"].shift(5))

    # (c) 帶量突破近 60 日前高：O'Neil / Weinstein 的突破買點
    prior_high = c.rolling(60, min_periods=20).max().shift(1)
    vol_breakout = (c > prior_high) & (v > 1.5 * df["VOL_MA20"]) & (c > o)

    return {
        "KD 低檔黃金交叉": (kd_gold, C_BLUE, "triangle-up"),
        "站上季線(趨勢轉強)": (reclaim_ma60, C_GOLD, "diamond"),
        "帶量突破前高": (vol_breakout, C_UP, "star"),
    }


# ─────────────────────────────────────────────────────────────
# 台股最小升降單位（tick）：讓停損／停利／買點都是可實際掛單的價
# ─────────────────────────────────────────────────────────────
def tick_size(p: float) -> float:
    v = abs(p)
    if v < 10:
        return 0.01
    if v < 50:
        return 0.05
    if v < 100:
        return 0.1
    if v < 500:
        return 0.5
    if v < 1000:
        return 1.0
    return 5.0


def round_to_tick(p, mode: str = "nearest"):
    if p is None or not np.isfinite(p):
        return None
    t = tick_size(p)
    if mode == "down":
        return round(math.floor(p / t) * t, 2)
    if mode == "up":
        return round(math.ceil(p / t) * t, 2)
    return round(round(p / t) * t, 2)


def _clamp(x, lo, hi):
    return max(lo, min(hi, x))


# ─────────────────────────────────────────────────────────────
# 4. 目前是否為好買點？依大師檢查表判讀
# ─────────────────────────────────────────────────────────────
def assess_now(df: pd.DataFrame, signals: dict) -> dict:
    last = df.iloc[-1]
    c = float(last["Close"])

    def val(x):
        return float(x) if pd.notna(x) else None

    ma20, ma60, ma120, ma240 = val(last["MA20"]), val(last["MA60"]), val(last["MA120"]), val(last["MA240"])
    hi52, lo52 = val(last["HI52"]), val(last["LO52"])
    ma240_up = pd.notna(df["MA240"].iloc[-1]) and df["MA240"].iloc[-1] > df["MA240"].iloc[-21]

    # 趨勢結構（Weinstein / Minervini 趨勢樣板，套用台股均線）
    trend = []
    trend.append(("收盤站上季線MA60、半年線MA120",
                  ma60 is not None and ma120 is not None and c > ma60 and c > ma120))
    trend.append(("均線多頭排列 MA20 > MA60 > MA120",
                  None not in (ma20, ma60, ma120) and ma20 > ma60 > ma120))
    trend.append(("年線MA240 上彎（長期趨勢向上）", bool(ma240_up)))
    trend.append(("距 52 週高點 ≤ 25%（強勢）",
                  hi52 is not None and c >= 0.75 * hi52))
    trend.append(("高於 52 週低點 ≥ 30%（已脫離底部）",
                  lo52 is not None and c >= 1.30 * lo52))

    # 近 20 交易日是否出現進場觸發
    win = 20
    trigger = []
    for name, (series, _, _) in signals.items():
        trigger.append((name, bool(series.tail(win).any())))
    macd_turn = (df["DIF"] > df["DEA"]) & (df["DIF"].shift() <= df["DEA"].shift())
    trigger.append(("MACD 由下往上翻多（DIF 上穿 DEA）", bool(macd_turn.tail(win).any())))

    trend_pass = sum(1 for _, ok in trend if ok)
    has_trigger = any(ok for _, ok in trigger)

    # 量能/籌碼提示
    vol_ratio = float(last["VOL_MA5"] / last["VOL_MA20"]) if last["VOL_MA20"] else float("nan")

    # 綜合判讀（描述方法會怎麼歸類，不下買賣指令）
    if ma60 is None:
        regime, verdict = "資料不足", "歷史資料太短，僅供參考。"
    elif c < ma60:
        regime = "弱勢／季線之下"
        verdict = ("收盤在季線之下，趨勢尚未轉強。Weinstein、Minervini 等方法在這個階段"
                   "多半『避開不買』，會等底部型態完成、重新站上長期均線再說。")
    elif trend_pass >= 4 and has_trigger:
        regime = "趨勢成形＋出現進場訊號"
        verdict = ("趨勢結構偏多，且近期出現大師方法認定的進場訊號——這通常被歸類為"
                   "『可考慮的買進區』。但訊號≠保證，務必先設好停損再行動。")
    elif trend_pass >= 4:
        regime = "趨勢偏多，暫無明確訊號"
        verdict = ("均線多頭、位置偏強，但近期沒有明確的突破或低檔轉折訊號。大師做法多會"
                   "『等拉回到上彎均線獲得支撐，或帶量突破前高』再進場，而非追高。")
    else:
        regime = "中性整理"
        verdict = ("部分條件符合、部分未到位，屬於整理格局。可把它放進觀察清單，"
                   "等趨勢與量能進一步轉強、出現明確買點再說。")

    # 交易計畫（與前端 technicals.js 同一套規則：以觀察區上緣為假設買價，
    # 停損／停利皆對齊台股最小升降單位；2R/3R 與停損距離名實相符）
    recent_low = float(df["Low"].tail(20).min())
    atr = val(last["ATR14"]) or max(1.0, c * 0.025)
    ma20v = ma20 if ma20 else c
    ma60v = ma60 if ma60 else c
    ph = df["Close"].rolling(60, min_periods=20).max().shift(1).iloc[-1]
    prior_high = float(ph) if pd.notna(ph) else c

    if ma60 is None or c < ma60v:
        plan_mode = "先觀察，不急著接"
        entry_low, entry_high = ma60v, ma60v * 1.02
        plan_note = "股價還在季線下方，先等重新站回季線並守住，再談進場。"
    elif trend_pass >= 4 and has_trigger:
        plan_mode = "突破後回測觀察"
        entry_low = max(ma60v, ma20v - atr * 0.35)
        entry_high = min(c, max(ma20v, ma60v) + atr * 0.8)
        plan_note = "趨勢與訊號已成形，偏向等拉回不破短均或突破線附近，而不是盲目追高。"
    elif trend_pass >= 4:
        plan_mode = "等拉回或突破"
        entry_low = max(ma60v, ma20v - atr * 0.5)
        entry_high = max(ma20v, ma60v) + atr * 0.5
        plan_note = "趨勢偏多但訊號不足，等量價確認或回測支撐再評估。"
    else:
        plan_mode = "整理區觀察"
        entry_low, entry_high = ma60v * 0.98, ma60v * 1.02
        plan_note = "條件還沒有明顯站在多方，先看能不能站穩季線與量能轉強。"

    if entry_low > entry_high:
        entry_low, entry_high = entry_high, entry_low
    entry_low = round_to_tick(entry_low, "nearest")
    entry_high = round_to_tick(entry_high, "nearest")
    if entry_low > entry_high:
        entry_low, entry_high = entry_high, entry_low

    ref_entry = entry_high  # 假設買在觀察區上緣（保守）
    stop_line = _clamp(max(recent_low, ma60v * 0.98, ref_entry * 0.92),
                       ref_entry * 0.86, ref_entry * 0.985)
    min_stop = max(atr, ref_entry * 0.03)            # 停損與買價至少相隔 1×ATR 或 3%
    if ref_entry - stop_line < min_stop:
        stop_line = ref_entry - min_stop             # 太近就放寬停損，而非灌大目標
    stop_line = _clamp(stop_line, ref_entry * 0.86, ref_entry * 0.985)
    stop_line = round_to_tick(stop_line, "down")
    R = ref_entry - stop_line                         # 單一一致的 1R
    plan = dict(
        mode=plan_mode,
        entry_low=entry_low, entry_high=entry_high,
        breakout=round_to_tick(prior_high, "up"),
        stop_line=stop_line,
        take_profit1=round_to_tick(ref_entry + 2 * R, "nearest"),
        take_profit2=round_to_tick(ref_entry + 3 * R, "nearest"),
        trail_stop=round_to_tick(max(ma20v, ref_entry - atr * 1.5), "down"),
        risk=R, note=plan_note,
    )

    return dict(
        close=c, ma20=ma20, ma60=ma60, ma120=ma120, ma240=ma240,
        hi52=hi52, lo52=lo52, trend=trend, trigger=trigger,
        trend_pass=trend_pass, has_trigger=has_trigger,
        regime=regime, verdict=verdict, vol_ratio=vol_ratio,
        recent_low=recent_low, atr=atr, plan=plan,
        k=float(last["K"]), d=float(last["D"]), rsi=float(last["RSI"]),
        dif=float(last["DIF"]), dea=float(last["DEA"]),
    )


# ─────────────────────────────────────────────────────────────
# 5. 互動式圖表
# ─────────────────────────────────────────────────────────────
def build_figure(df: pd.DataFrame, signals: dict, title: str) -> go.Figure:
    x = df.index
    fig = make_subplots(
        rows=4, cols=1, shared_xaxes=True, vertical_spacing=0.035,
        row_heights=[0.52, 0.13, 0.17, 0.18],
        subplot_titles=("K線 ‧ 均線 ‧ 布林通道 ‧ 買點訊號", "成交量", "KD (9,3,3)", "MACD (12,26,9)"),
    )

    # 布林通道（先畫，墊底）
    fig.add_trace(go.Scatter(x=x, y=df["BB_UP"], line=dict(width=0), showlegend=False,
                             hoverinfo="skip"), row=1, col=1)
    fig.add_trace(go.Scatter(x=x, y=df["BB_DN"], line=dict(width=0), fill="tonexty",
                             fillcolor="rgba(120,110,90,0.10)", showlegend=False,
                             hoverinfo="skip", name="布林"), row=1, col=1)

    # K 線（紅漲綠跌）
    fig.add_trace(go.Candlestick(
        x=x, open=df["Open"], high=df["High"], low=df["Low"], close=df["Close"],
        name="K線", increasing_line_color=C_UP, increasing_fillcolor=C_UP,
        decreasing_line_color=C_DOWN, decreasing_fillcolor=C_DOWN, line=dict(width=1),
    ), row=1, col=1)

    # 均線
    for col, color, lbl, w in [
        ("MA5", C_GRAY, "5日", 1), ("MA20", C_GOLD, "月線20", 1.3),
        ("MA60", C_BLUE, "季線60", 1.3), ("MA120", C_PURPLE, "半年線120", 1.1),
        ("MA240", C_PINK, "年線240", 1.3),
    ]:
        fig.add_trace(go.Scatter(x=x, y=df[col], mode="lines", name=lbl,
                                 line=dict(color=color, width=w)), row=1, col=1)

    # 買點訊號標記
    for name, (series, color, symbol) in signals.items():
        idx = series[series].index
        if len(idx) == 0:
            continue
        ys = df.loc[idx, "Low"] * 0.975
        fig.add_trace(go.Scatter(
            x=idx, y=ys, mode="markers", name=name,
            marker=dict(symbol=symbol, size=11, color=color,
                        line=dict(width=1, color="#0f0d0a")),
            hovertemplate=name + "<br>%{x|%Y-%m-%d}<extra></extra>",
        ), row=1, col=1)

    # 成交量（依漲跌上色）
    vol_colors = np.where(df["Close"] >= df["Open"], C_UP, C_DOWN)
    fig.add_trace(go.Bar(x=x, y=df["Volume"], marker_color=vol_colors, name="成交量",
                         showlegend=False, opacity=0.65), row=2, col=1)
    fig.add_trace(go.Scatter(x=x, y=df["VOL_MA20"], line=dict(color=C_GOLD, width=1),
                             name="量能20MA", showlegend=False), row=2, col=1)

    # KD
    fig.add_trace(go.Scatter(x=x, y=df["K"], line=dict(color=C_GOLD, width=1.3), name="K"),
                  row=3, col=1)
    fig.add_trace(go.Scatter(x=x, y=df["D"], line=dict(color=C_BLUE, width=1.3), name="D"),
                  row=3, col=1)
    fig.add_hline(y=80, line=dict(color=C_DOWN, width=0.8, dash="dot"), row=3, col=1)
    fig.add_hline(y=20, line=dict(color=C_UP, width=0.8, dash="dot"), row=3, col=1)

    # MACD
    osc_colors = np.where(df["OSC"] >= 0, C_UP, C_DOWN)
    fig.add_trace(go.Bar(x=x, y=df["OSC"], marker_color=osc_colors, name="OSC",
                         showlegend=False, opacity=0.6), row=4, col=1)
    fig.add_trace(go.Scatter(x=x, y=df["DIF"], line=dict(color=C_GOLD, width=1.2), name="DIF"),
                  row=4, col=1)
    fig.add_trace(go.Scatter(x=x, y=df["DEA"], line=dict(color=C_BLUE, width=1.2), name="MACD"),
                  row=4, col=1)

    fig.update_layout(
        title=dict(text=title, font=dict(size=18, color=C_TEXT)),
        template="plotly_dark", paper_bgcolor=C_INK, plot_bgcolor=C_INK,
        font=dict(color=C_TEXT, family="PingFang TC, Microsoft JhengHei, sans-serif", size=12),
        height=940, margin=dict(l=55, r=25, t=70, b=30),
        legend=dict(orientation="h", yanchor="bottom", y=1.012, x=0, font=dict(size=11),
                    bgcolor="rgba(0,0,0,0)"),
        hovermode="x unified", bargap=0.05,
    )
    fig.update_xaxes(rangeslider_visible=False, gridcolor=C_LINE, showspikes=True,
                     spikecolor=C_DIM, spikethickness=1)
    fig.update_yaxes(gridcolor=C_LINE, zeroline=False)
    # 只在最底圖顯示完整日期軸，並隱藏台股休市日造成的空隙
    fig.update_xaxes(rangebreaks=[dict(bounds=["sat", "mon"])])
    return fig


# ─────────────────────────────────────────────────────────────
# 6. 組裝 HTML 報告
# ─────────────────────────────────────────────────────────────
REPORT_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{background:#15120E;color:#EBE3D4;font-family:"PingFang TC","Microsoft JhengHei","Noto Sans TC",sans-serif;line-height:1.7}
.wrap{max-width:1080px;margin:0 auto;padding:26px 20px 60px}
.head{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;border-bottom:1px solid #2C261E;padding-bottom:16px;margin-bottom:8px}
.h-name{font-size:26px;font-weight:800;letter-spacing:-.01em}
.h-tick{font-family:"SF Mono",Consolas,monospace;font-size:19px;color:#E2A636;font-weight:600}
.h-meta{margin-left:auto;font-size:12px;color:#8C8472;font-family:"SF Mono",Consolas,monospace}
.legend{font-size:12px;color:#9D927E;margin:10px 0 4px}
.legend b.up{color:#E0413C}.legend b.dn{color:#26A269}
.regime{display:inline-block;margin:16px 0 6px;padding:9px 16px;border-radius:10px;font-weight:700;font-size:15px;
        background:rgba(226,166,54,.12);border:1px solid rgba(226,166,54,.35);color:#F0D89A}
.verdict{font-size:14.5px;color:#D8CFBE;background:#1E1A15;border:1px solid #2C261E;border-radius:12px;padding:15px 17px;margin:8px 0 22px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:6px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:#1E1A15;border:1px solid #2C261E;border-radius:14px;padding:16px 18px}
.card h3{font-size:14px;color:#E2A636;margin-bottom:4px}
.card .sub{font-size:11.5px;color:#8C8472;margin-bottom:12px}
.row{display:flex;align-items:flex-start;gap:10px;padding:7px 0;font-size:13.5px;border-top:1px solid #241f18}
.row:first-of-type{border-top:none}
.row .txt{flex:1;color:#CFC6B4}
.ok{color:#E2A636;font-weight:700;white-space:nowrap;font-size:12.5px}
.no{color:#6E6555;white-space:nowrap;font-size:12.5px}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin-top:6px}
.stat{background:#1E1A15;border:1px solid #2C261E;border-radius:10px;padding:9px 13px;min-width:104px}
.stat .k{font-size:11px;color:#8C8472}
.stat .v{font-size:16px;font-weight:700;font-family:"SF Mono",Consolas,monospace;margin-top:2px}
.stop{margin-top:20px;background:rgba(224,65,60,.08);border:1px solid rgba(224,65,60,.3);border-radius:12px;padding:15px 17px;font-size:13.5px;color:#F2C8C5}
.stop b{color:#FF9B97}
.chart{margin:22px 0 4px;background:#15120E;border:1px solid #2C261E;border-radius:14px;overflow:hidden}
.note{margin-top:24px;font-size:11.5px;color:#7C7263;font-family:"SF Mono",Consolas,monospace;line-height:1.7}
.disc{margin-top:18px;padding-top:16px;border-top:1px solid #2C261E;font-size:11.5px;color:#7C7263;text-align:center;line-height:1.8}
.disc b{color:#9D927E}
"""


def _rows(items):
    out = []
    for txt, ok in items:
        tag = '<span class="ok">✓ 符合</span>' if ok else '<span class="no">— 未到位</span>'
        out.append(f'<div class="row"><span class="txt">{txt}</span>{tag}</div>')
    return "\n".join(out)


def build_report(df, signals, name, sym, a) -> str:
    chart = build_figure(df, signals, f"{name}（{sym}）").to_html(
        include_plotlyjs="cdn", full_html=False,
        config={"displayModeBar": True, "scrollZoom": True})

    today = dt.date.today().isoformat()
    last_date = df.index[-1].date().isoformat()

    def f(x, d=2):
        return f"{x:,.{d}f}" if x is not None and pd.notna(x) else "—"

    stats = "".join([
        f'<div class="stat"><div class="k">收盤</div><div class="v">{f(a["close"])}</div></div>',
        f'<div class="stat"><div class="k">月線 MA20</div><div class="v">{f(a["ma20"])}</div></div>',
        f'<div class="stat"><div class="k">季線 MA60</div><div class="v">{f(a["ma60"])}</div></div>',
        f'<div class="stat"><div class="k">年線 MA240</div><div class="v">{f(a["ma240"])}</div></div>',
        f'<div class="stat"><div class="k">KD</div><div class="v">{a["k"]:.0f}/{a["d"]:.0f}</div></div>',
        f'<div class="stat"><div class="k">RSI(14)</div><div class="v">{a["rsi"]:.0f}</div></div>',
        f'<div class="stat"><div class="k">52週高</div><div class="v">{f(a["hi52"])}</div></div>',
        f'<div class="stat"><div class="k">52週低</div><div class="v">{f(a["lo52"])}</div></div>',
    ])

    vol_txt = "放大" if a["vol_ratio"] > 1.1 else ("萎縮" if a["vol_ratio"] < 0.9 else "持平")
    p = a["plan"]

    html = (
        "<!DOCTYPE html><html lang='zh-Hant'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        f"<title>{name} {sym} 證券分析報告</title><style>{REPORT_CSS}</style></head><body><div class='wrap'>"
        f"<div class='head'><span class='h-name'>{name}</span><span class='h-tick'>{sym}</span>"
        f"<span class='h-meta'>產生日期 {today} ‧ 最新資料 {last_date}</span></div>"
        "<div class='legend'>台股慣例 <b class='up'>■ 紅漲</b> <b class='dn'>■ 綠跌</b> ｜ "
        "買點標記：▲ KD低檔黃金交叉 ◆ 站上季線 ★ 帶量突破前高</div>"

        f"<div class='regime'>目前狀態：{a['regime']}</div>"
        f"<div class='verdict'>{a['verdict']}</div>"

        "<div class='stats'>" + stats + "</div>"

        f"<div class='chart'>{chart}</div>"

        "<div class='grid'>"
        "<div class='card'><h3>趨勢結構檢查表</h3>"
        "<div class='sub'>Weinstein 階段分析 ＋ Minervini 趨勢樣板（套用台股均線）</div>"
        + _rows(a["trend"]) +
        f"<div class='row'><span class='txt'>通過項目</span>"
        f"<span class='ok'>{a['trend_pass']} / {len(a['trend'])}</span></div></div>"

        "<div class='card'><h3>進場訊號（近 20 個交易日）</h3>"
        "<div class='sub'>O'Neil 突破 ‧ 拉回均線 ‧ 台股 KD／MACD 轉折</div>"
        + _rows(a["trigger"]) +
        f"<div class='row'><span class='txt'>近5日均量 vs 月均量</span>"
        f"<span class='ok'>{a['vol_ratio']:.2f}× ({vol_txt})</span></div></div>"
        "</div>"

        f"<div class='stop'>⚠ <b>交易計畫</b>（條件提醒，非買賣建議；以觀察區上緣為假設買價，"
        f"停損／停利皆已對齊台股最小升降單位）：<br>"
        f"觀察買點 <b>{f(p['entry_low'])}–{f(p['entry_high'])}</b> ｜ 突破參考 <b>{f(p['breakout'])}</b><br>"
        f"跌破收手（停損）<b>{f(p['stop_line'])}</b> ｜ 移動停利參考 <b>{f(p['trail_stop'])}</b><br>"
        f"漲到分批收手（停利）約 <b>{f(p['take_profit1'])}</b> / <b>{f(p['take_profit2'])}</b>（+2R / +3R）。<br>"
        f"另參考近月低點 {f(a['recent_low'])} 與季線 {f(a['ma60'])}；實際停損請依個人資金與風險承受度調整。</div>"

        "<div class='note'>資料來源：Yahoo Finance（yfinance），為日線調整後股價，可能與券商看盤的"
        "未還原價有些微差異。<br>本報告為純技術面分析；法人買賣超、融資融券等籌碼資料未納入"
        "（可加掛 FinMind 等資料源延伸）。</div>"

        "<div class='disc'>本報告由程式自動產生，<b>僅供研究與教育參考，不構成任何投資建議或買賣推薦</b>。<br>"
        "技術訊號不保證未來表現，投資有風險，請自行評估並嚴設停損。</div>"

        "</div></body></html>"
    )
    return html


# ─────────────────────────────────────────────────────────────
# 7. 主程式
# ─────────────────────────────────────────────────────────────
def console_summary(name, sym, a):
    print("\n" + "═" * 58)
    print(f"  {name}（{sym}）  證券分析")
    print("═" * 58)
    print(f"  收盤 {a['close']:.2f} ｜ 季線 {a['ma60']:.2f} ｜ "
          f"KD {a['k']:.0f}/{a['d']:.0f} ｜ RSI {a['rsi']:.0f}")
    print(f"\n  ▍目前狀態：{a['regime']}（趨勢符合 {a['trend_pass']}/{len(a['trend'])} 項）")
    print("  " + a["verdict"].replace("\n", "\n  "))
    print("\n  ▍趨勢結構：")
    for txt, ok in a["trend"]:
        print(f"    [{'✓' if ok else ' '}] {txt}")
    print("  ▍進場訊號（近20日）：")
    for txt, ok in a["trigger"]:
        print(f"    [{'✓' if ok else ' '}] {txt}")
    p = a["plan"]
    print("\n  ▍交易計畫（以觀察區上緣為假設買價，已對齊台股 tick）：")
    print(f"    觀察買點 {p['entry_low']:.2f}–{p['entry_high']:.2f} ｜ 突破 {p['breakout']:.2f}")
    print(f"    停損 {p['stop_line']:.2f} ｜ 停利 {p['take_profit1']:.2f} / {p['take_profit2']:.2f}"
          f"（+2R/+3R）｜ 移動停利 {p['trail_stop']:.2f}")
    print(f"    另參考近月低點 {a['recent_low']:.2f} / 季線 {a['ma60']:.2f}")
    print("═" * 58)


def main():
    code = sys.argv[1] if len(sys.argv) > 1 else (
        input("輸入台股代號（預設 2330）：").strip() or "2330")

    print(f"\n抓取「{code}」歷史資料中…")
    df, sym = fetch_data(code)
    name = try_get_name(sym, code)
    df = add_indicators(df)
    signals = detect_signals(df)
    a = assess_now(df, signals)

    console_summary(name, sym, a)

    html = build_report(df, signals, name, sym, a)
    out = f"{code.replace('.', '_')}_analysis.html"
    with open(out, "w", encoding="utf-8") as fp:
        fp.write(html)
    print(f"\n✓ 已輸出互動式報告：{out}")

    if IS_COLAB:
        # Colab：圖表內嵌顯示 + 報告下載
        build_figure(df, signals, f"{name}（{sym}）").show()
        try:
            from google.colab import files  # type: ignore
            files.download(out)
        except Exception:  # noqa
            pass
    else:
        import webbrowser
        import os
        webbrowser.open("file://" + os.path.realpath(out))


if __name__ == "__main__":
    main()
