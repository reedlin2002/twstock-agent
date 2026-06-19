# 010401 Finance｜台股 AI 分析助手

一款面向台股投資人的 AI 分析 App。它把股價走勢、技術指標、籌碼資料、風險控管與 AI 摘要整合在同一個畫面，讓使用者輸入股票代號或公司名稱後，就能快速得到一份可閱讀、可追蹤、可行動的分析報告。

> 本專案提供投資研究與資料整理輔助，不構成任何買賣建議或投資邀約。實際交易前請自行判斷風險。

## App 是什麼？

010401 Finance 是一個台股分析儀表板，核心目標是把「找資料、看技術線、看籌碼、整理觀點」這幾件事壓縮成一次查詢。

使用者只要輸入例如 `2330`、`台積電 2330` 或點選範例股票，App 會自動：

- 解析股票代號與公司名稱
- 抓取 Yahoo Finance 的近兩年日線價格
- 補充 FinMind 的法人買賣超、融資融券等籌碼資料
- 在前端即時計算技術指標與交易檢查表
- 將整理後的結構化資料交給 AI 產生分析摘要
- 顯示價格圖、均線、籌碼圖、進出場區間、停損與風險提醒


## 產品優勢

### 1. 不是只問 AI，而是先有資料再問 AI

App 會先抓取價格與籌碼資料，再由本地程式計算技術指標，最後才把結構化資料交給 AI。這讓 AI 的角色更像「研究助理」，不是憑空產生投資故事。

### 2. 台股使用情境優先

支援台股常見代號查詢，並以 FinMind 補充三大法人、融資融券等台股投資人熟悉的籌碼資料。使用者不用在多個網站之間切換。

### 3. 把技術分析轉成可執行檢查表

畫面不只顯示線圖，還會把趨勢條件、觸發訊號、進場區間、突破價、停損線、2R / 3R 停利區整理出來，降低主觀判斷的混亂。

### 4. 同時支援 Web 與行動端

前端使用 React + Vite，行動端使用 Capacitor 包裝，可快速轉成 Android App。

## 使用了哪些股票分析技術？

### 資料來源

- Yahoo Finance：近兩年日線價格、開高低收、成交量、股票名稱與交易所資訊
- FinMind：台股公司清單、三大法人買賣超、融資融券資料
- AI 模型：根據 App 已整理好的 `providedData` 產生可讀分析報告

### 技術指標

App 會在前端計算多組常見指標：

- 移動平均線：MA20、MA60、MA120、MA240
- 成交量均線：VOL20
- KD 指標：9 日 RSV，K / D 使用平滑計算
- MACD：EMA12、EMA26、DIF、DEA
- RSI：14 日相對強弱指標
- ATR14：用於風險與停損距離估算
- 52 週高低點：用來判斷股價相對強度與位置
- 60 日區間高點：用來偵測突破訊號

### 趨勢框架

分析邏輯參考多位成長股與趨勢交易方法：

- Stan Weinstein：階段分析、長期均線與 Stage 2 趨勢
- Mark Minervini：Trend Template、股價相對 52 週高低點位置
- William O'Neil / CANSLIM：突破、量能、相對強勢與風險控管

目前趨勢檢查會觀察：

- 收盤價是否站上 MA60 與 MA120
- MA20 > MA60 > MA120 是否形成多頭排列
- MA240 是否向上
- 股價是否接近 52 週高點
- 股價是否離 52 週低點已有足夠距離

### 觸發訊號

App 會檢查近 20 個交易日是否出現：

- KD 低檔黃金交叉
- 收盤價重新站回 MA60
- 放量突破近 60 日高點
- MACD DIF 向上穿越 DEA

### 交易計畫

系統會依照趨勢狀態產生一組風險框架：

- 進場觀察區間
- 突破確認價
- 停損線
- 2R / 3R 停利參考
- 移動停利參考線

這些數值是研究輔助，不是保證報酬的交易訊號。

### 籌碼分析

FinMind 資料會被整理成：

- 外資、投信、自營商近 20 日買賣超
- 三大法人近 5 日合計買賣超
- 融資餘額與近 5 日變化
- 融券餘額與近 5 日變化

這些資料可用來輔助判斷籌碼是否與技術走勢互相配合。

## AI 分析流程

AI 報告不是直接把股票代號丟給模型，而是採用資料驅動流程：

1. 使用者輸入股票名稱或代號
2. App 解析台股代號
3. 抓取 Yahoo Finance 與 FinMind 資料
4. 本地計算技術指標、趨勢檢查與籌碼統計
5. 組成 `providedData`
6. AI 只根據提供資料產生報告
7. App 解析 `@@NAME@@`、`@@TECHNICAL@@`、`@@RISKS@@` 等區塊並顯示在畫面上

這種設計可以降低 AI 幻覺，讓報告更貼近實際資料。

## 技術架構

- React 18：主要 UI 與互動
- Vite 6：開發伺服器、建置與 API proxy
- Recharts：價格與籌碼圖表
- lucide-react：介面圖示
- Capacitor 8：Android 行動端包裝
- Yahoo Finance API：價格資料
- FinMind API：台股籌碼與股票清單
- AI 分析生成

## 專案結構

```text
src/
  App.jsx                  # 主要 App 畫面與查詢流程
  components/              # Splash、統計卡、提示、檢查表、名詞解釋
  data/constants.js        # 範例股票、區塊設定、載入訊息
  lib/data.js              # Yahoo Finance / FinMind 資料處理
  lib/technicals.js        # 技術指標、趨勢檢查、交易計畫
  lib/prompts.js           # AI prompt 與資料驅動提示
  lib/parseReport.js       # AI 回覆區塊解析
  styles/app.css           # App 樣式

python/
  taiwan_stock_agent.py    # Python 版 HTML 技術分析報告產生器

reports/
  *_analysis.html          # 範例分析報告

docs/
  data-flow-explanation.html

vite.config.js             # Vite 設定與開發用 API proxy
capacitor.config.ts        # Capacitor Android 設定
```

## Python 報告產生器

如果只想用命令列產生 HTML 分析報告：

```bash
pip install yfinance pandas numpy plotly
python python/taiwan_stock_agent.py 2330
```

執行後會產生類似：

```text
2330_analysis.html
```

報告會包含 K 線、均線、成交量、KD、MACD、趨勢檢查與停損參考。

## 適合誰使用？

- 想快速整理台股技術面與籌碼面的投資人
- 想把 AI 放進投資研究流程的個人開發者
- 想學習 React + 資料視覺化 + AI 分析串接的工程師
- 想做行動版股票研究工具的產品團隊

## 重要聲明

本 App 產生的內容只供研究、學習與資訊整理使用。股票市場具有不確定性，技術指標與 AI 分析都可能失準。任何買進、賣出、停損或停利決策，皆應由使用者自行負責。
