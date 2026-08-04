# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-08-04 12:15:00 Asia/Taipei

---

## 📋 Active Tasks

### Task 54: 獲利能力曲線圖（設計稿已出，待選版）
- **Status**: ⏸️ **等使用者選版** —— 三份設計稿已發布，尚未動 `sources/`
- **Agent**: Claude
- **Timestamp**: 2026-08-04 19:45:00 Asia/Taipei
- **設計稿**: <https://claude.ai/code/artifact/2007548e-86de-4085-afd0-70ba8b7dd34e>
  （單一 HTML 三版並列，圖表以原生 SVG 重畫 `chartFrame.tsx` 的幾何，
  台積電與鴻海各畫一次，並含 1 季 / 2 季退化狀態與虧損季負值）
- **A｜四線同軸**：`MultiLineChart` + `ChartLegend`，零新元件。
  實測弱點比原本預期的溫和但真實：鴻海的值域被 `niceDomain` 吸附成 2–8，
  線有拉開，但營益 2.8 / 稅前 3.2 / 稅後 2.2 擠在 1.2 個百分點內互相穿插。
- **B｜點選單線**：`LineSeriesChart` + `.fx-card` 點選模式。
  **⚠️ 有結構性問題：PDF 只會印出當下選中的那一項**，另外三項在紙上永遠不存在 ——
  與 0.6.24 移除收合的理由同一條（畫面上藏起來的東西，匯出時會無聲消失）。
- **C｜利潤瀑布帶**（建議）：唯一兩種尺度都成立的版本，因為它畫的是組成比例。
  需新增 `MarginBandChart.tsx`（約 90 行）；負值以「上緣走過去、下緣走回來」
  封閉多邊形處理，兩線交叉時自己會翻面，不需特判。
- **實作備忘**：位置在 KPI 卡之下、表格之上（比照月營收，**圖在上、表在下**）；
  `quarters.length > 1` 才渲染（與表格同一條判斷）；金融業 `grossMarginPercent`
  為 null 要斷線；測試補 12 季 / 1 季 / 負值三種。
- **順手可修**：獲利能力區塊說明仍寫「最多保留 8 季」，實際為 12（`PROFIT_QUARTERS_CAP`）。

### Task 53: 移除表格收合（0.6.24）
- **Status**: ✅ **完成** —— 純前端，不需要動 Supabase
- **Agent**: Claude
- **Timestamp**: 2026-08-04 19:30:00 Asia/Taipei
- **需求**：使用者在 0.6.23 上線後要求把表格收合**整個功能**拿掉（不是只拿掉按鈕）。
- **做法**：`git revert 2d9049b` 當基底 —— 手動逐處刪會漏掉測試選擇器、
  `index.css` 的 `.rpt-collapse` / `.rpt-caret`、`handleDownload` 的展開／還原。
- **revert 之外**：版號改 0.6.24（不隨 revert 回到 0.6.22）；
  README 與 `docs/agent/` 保留 0.6.23 的歷史紀錄再往上加；
  保留 0.6.23 才加的 `reportPdf` 測試 mock，收合 4 條測試改寫成 1 條 PDF 擷取範圍測試；
  `index.css` 補註「0.6.23 試過收合、0.6.24 移除」與理由。
- **驗證**：`npm test` 780/780、lint 3 個既有 warning、build 通過。

### Task 52: 個股分析的表格收合（0.6.23）
- **Status**: ↩️ **已於 0.6.24 移除**（見 Task 53）——當時完成、純前端
- **Agent**: Claude
- **Timestamp**: 2026-08-04 16:05:00 Asia/Taipei
- **需求**：個股分析中「有欄位的表格」都要能收合，並要有一鍵全部收起 / 展開。
- **⚠️ 這推翻了一條既有決定**：`index.css` 原本註明四段卡片刻意**不做收合**，
  理由是「不會有東西被收起來找不到」。使用者的需求優先 ——
  而那條顧慮正是「全部展開」這顆按鈕必須存在的原因。
- **範圍**：只收**含表格**的 4 個區塊（三大法人、融資融券、獲利能力、月營收），
  圖表區塊不動 —— 圖表本來就是一眼看完的東西，收起來省不到什麼。
  清單在 `StockDetail/tableSections.ts`，**新增可收合表格時要同步加進去**，
  否則「全部收起」會漏掉它。
- **實作**：新增 `Common/CollapsibleSection.tsx`（標題即開關、收起時**不渲染**而非隱藏）。
  收合狀態放在 `StockDetailPage`（一鍵按鈕需要統一的狀態來源），往下傳給兩個分頁。
  用語沿用 `YearlyPage` 既有的「全部收起 / 全部展開」與 ChevronsDownUp/UpDown 圖示。
- **⚠️ PDF 的交互作用**（這功能最容易無聲出錯的地方）：收起的區塊不在 DOM 裡，
  直接擷取會產出**缺表格的 PDF 且畫面上看不出來**。故匯出前先全部展開、
  等兩幀後擷取、事後還原使用者原本的收合狀態。**有專屬測試守著這條。**
- **驗證**：`npm test` 783/783（新增 4 條）、lint 3 個既有 warning、build 通過；
  Playwright 實測深淺兩色 × 桌機/手機：箭頭方向正確、標題字級與原 h3 一致（14px/600）、
  收起時 meta 仍可見、無橫向溢出。

### Task 51: 季度獲利能力歷史回補（0.6.21 → 0.6.22 定版）
- **Status**: ✅ **完成** —— 兩區 schema、Edge Function 已更新，回補也已跑完（各檔 12 季）
- **Agent**: Claude
- **Timestamp**: 2026-08-04 15:20:00 Asia/Taipei
- **起因**：使用者問「抓取的排程為何、想先抓 2025-2026、會不會塞爆 free tier」。
- **關鍵發現：`t187ap17_L` 是當季快照，不是歷史檔。**
  實測只回 **58 家、且只有民國115 Q2 一季**。所以 `profitQuarters` 一季只長一筆 ——
  持股實況也印證：1802 / 2609 只有 `2026-Q1`，2303 有 Q1+Q2。要湊滿 12 季得等三年。
- **回補來源**：MOPS `POST /mops/web/ajax_t163sb04`（`twProfitHistory.ts`）。
  三個與月營收那支完全不同、最容易搞混的點：**POST 表單**（不是靜態 GET）、
  **UTF-8**（不是 big5）、**一頁 7 張表 6 種產業別格式**（故以表頭文字定位欄位，不寫死索引）。
- **正確性驗證**：以真實 1.6MB 頁面跑 TS 解析器，民國115 Q1 的
  1802 / 2303 / 2609 四項比率與營收**全部與官方 `t187ap17_L` 逐位吻合**
  （例：1802 毛 19.23 / 營 7.88 / 前 6.44 / 後 5.71、營收 10244.19 百萬元）。
  單位換算已驗：MOPS 是**千元**、t187ap17_L 是**百萬元**。
- **金融業**：沒有「毛利」概念故回 null；**銀行業沒有單一營收欄**
  （利息淨收益＋利息以外淨損益兩欄），整張表跳過而不硬湊分母。
- **`PROFIT_QUARTERS_CAP` 8 → 12**，並新增 `profitBackfilledThrough`
  （⚠️ 已在 `buildFundamentalFile` 帶過去 —— 漏帶就是每晚把回補進度抹掉，
  這個坑 0.6.4-dev.2 在月營收上踩過）。
- **Free tier 評估**（實測正式區）：Storage 346 KB / 1 GB（0.03%）、
  DB 18 MB / 500 MB（3.6%）、Edge 呼叫約 1,830 / 500K 每月（0.4%）。
  回補只增加約 3 KB。**瓶頸不是容量，是單次執行的記憶體與時間**
  （單份 1.6MB，故 `MAX_BACKFILL_QUARTERS = 2`，比月營收的 4 保守）。
- **⚠️ 獨立的「持股獲利能力」區塊最後整個移除（0.6.22）。**
  使用者一句「這個是不是在基本面上就有了?」點出重點：**是**，
  同樣四項利率在「個股分析 → 基本面」早就有了（四張 KPI 卡＋季度表），
  差別只是「一檔的細節」vs「多檔的橫向比較」。兩者疊在同一頁就是重複，
  故依使用者指示刪除該元件、其測試與孤兒 CSS，基本面內容一字未動。
  **教訓**：加新區塊之前要先確認同一份資料現在出現在哪裡 ——
  0.6.20 當初把它放在總經頁時就該問這個問題。
- **回補本身完全保留**，而且才是真正的價值：基本面的季度表原本只有 1–2 季
  （官方端點只給最新一季），現在是 12 季，那張表與趨勢才成立。
- `sparkline.ts` 留在 `Charts/`（總經指標卡仍在用；它本來就是圖表原件，
  與 LineSeriesChart 等同一個目錄）。
- **回補實跑結果**（2026-08-04，經使用者提供 CRON_SECRET 授權觸發）：
  測試區 6 輪、正式區 7 輪補滿，最後一輪皆為 `filled=0 quarters=[]`（缺口為空即短路）。
  正式區實測：1802 / 2609 為 2023-Q2→2026-Q1、2303 為 2023-Q3→2026-Q2，各 12 季；
  0050（ETF）為 0 季且 `profitBackfilledThrough=2023-Q2`，證明收斂機制有效、不會每輪重試。
- **驗證**：`npm test` 786/786（新增 20 條）、lint 3 個既有 warning、build 通過。

### Task 50: 四項調整（0.6.20）
- **Status**: ✅ **完成** —— 已定版並上線；Edge Function 兩區已重新部署
- **Agent**: Claude
- **Timestamp**: 2026-08-04 14:35:00 Asia/Taipei
- **設計稿**：https://claude.ai/code/artifact/c4eb5eef-82de-4412-99b9-0e5a27b0766b
- **① 最後登入 → 最近活動（這是 bug，不是排版問題）**
  查正式區（唯讀）：某帳號 `users.last_sign_in_at` 停在 08-02 17:17，
  但 `auth.sessions.refreshed_at` 是 08-04 12:53。
  **`last_sign_in_at` 只在真的重新登入時更新**，靠 refresh token 續命的帳號會永遠停在舊時間。
  改用 `users.updated_at`（實測與 `refreshed_at` 差 0.02 秒，且 `listUsers()` 本來就回傳）。
  → 動到 `handleAdminUsers`，**需重新部署 Edge Function**。
- **② GitHub 官方 mark**：`lucide-react@1.24.0` 已移除品牌 icon，
  故在 `AppShell.tsx` 內嵌一段 path（`GithubMark`），不為一顆圖示加依賴。
- **③ 現價放大加粗**：`.dash-price` 17px/700 + 標題字體。只動這一欄 ——
  整排都放大等於整排都沒重點。
- **④ 總經頁新增「持股獲利能力」**：新增 `components/Macro/HoldingProfitSection.tsx`，
  重用既有的 `fetchFundamental()` 與 0.6.19 的 `sparkline.ts`。
  **只對台股發請求**（ETF 與美股在公開資訊觀測站的季報裡沒有，發了只會換來 404）。
  欄位名沿用「稅前純益率 / 稅後純益率」與個股基本面一致；數值不帶正負號
  （毛利率不是變化量，掛 `+` 會讀成「比上季多 59%」）。
- **未採用**：現價的漲跌紅綠。現行現價資料只有價格、沒有前收，
  要顯示漲跌得額外載入每檔日 K 線，另案處理。
- **總經指標維持五項**：使用者原信列的六項（含「核心 CCI」「核心非農」）
  0.6.5 就已定案 —— 見 `usMacro.ts` 檔頭。這次確認維持不動。
- **驗證**：`npm test` 766/766（新增 7 條）、lint 3 個既有 warning、build 通過；
  Playwright 實測深淺兩色 × 桌機/手機：現價 17px/700 vs 隔壁 13.5px/400、
  GitHub mark 為 fill path、新區塊走勢線 56×20、皆無橫向溢出。

### Task 49: 五項功能異動（0.6.19）
- **Status**: ✅ **完成** —— 測試區 schema 與 Edge Function 皆已更新並逐檔稽核通過；已定版 0.6.19
- **Agent**: Claude
- **Timestamp**: 2026-08-04 14:05:00 Asia/Taipei
- **需求**（使用者提出五項，先產 3 份 HTML mockup 選型，選定「版本 A ＋ 版本 B 的後台」）：
  1. GitHub 網址改成 icon 並決定位置 → **收進帳號選單**
  2. 總經頁排版更好讀 → **指標卡加 12 期走勢線＋落後徽章**
  3. 分頁列依功能分組 → **持股四項 ／ 市場兩項，中間一道分隔線**
  4. AI 提示詞可在網頁上編輯 → **後台「提示詞」頁**
  5. 新增後台（帳號、admin tag、抓取狀況、AI 設定）→ **全頁＋左側導覽，帳號選單進入**
- **設計稿**：定案稿 https://claude.ai/code/artifact/d3392953-faeb-4112-9668-074b2c299558
  （另有三個比較版本 A/B/C，見 PROGRESS 2026-08-04 那則）
- **分兩批**：dev.1 純前端（1/2/3/5 外殼）、dev.2 需要 Supabase 的部分（4 與帳號管理）。
- **提示詞的可編輯／鎖定切線**（這次最重要的設計決定）：
  可編輯的只有「風格」（幾段、口吻、要不要用操作框架語彙）；
  **安全規則固定在程式碼裡**（`ANALYSIS_LOCKED` / `CHAT_LOCKED`），由程式接在使用者輸入**之後** ——
  排在後面才蓋得住被改壞的前半段。整段開放編輯等於把護欄交給人一鍵刪掉，
  而且刪掉之後畫面上不會有任何跡象。畫面上照實印出鎖定段落，讓管理員知道自己改不到什麼。
- **對外操作紀錄**（2026-08-04，經使用者授權後執行）：
  - 測試區：`ALTER TABLE app_settings` 加 `ai_prompt_analysis` / `ai_prompt_chat` 兩欄
    （與身分檢查同一次查詢執行，回傳 ref = `wqetxuhncvfidqnklyew`）；
    `functions deploy stock-report --no-verify-jwt` 完成，`functions download` 逐檔比對 11 檔全同。
    端點探測：`admin-users` / `admin-set-role` 皆回 401（已被 `assertAdmin` 擋下），
    而不存在的 action 回 400 —— 證明新程式碼確實上線。
  - 正式區：定版 0.6.19 併入 `main` 並 push（Pages 部署 success）之後執行 ——
    兩欄已加（身分檢查回 `kxnxadaghidwumqsqneu`）、`functions deploy --no-verify-jwt` 完成、
    `functions download` 逐檔比對 11 檔全部與 `main` 相同、端點探測結果與測試區一致。
- **驗證**：`npm test` 759/759、`npm run lint` 3 個既有 warning、`npm run build` 通過。
- **⚠️ 驗證盲區**：`index.ts` 的兩個新 handler 不在 `tsc -b` 範圍內、也沒有單元測試
  （本機無 deno）。已人工核對 `db.auth.admin.listUsers / getUserById / updateUserById`
  的回傳形狀，但**實際行為要等部署到測試區才驗得了**。

### Task 48: 程式碼簡化（0.6.18）
- **Status**: ✅ **完成** —— 已定版 0.6.18 併入 `main` 並 push（觸發 Pages 部署）；未動任何 Supabase 環境
- **⚠️ 未做的驗證**：使用者選擇跳過「測試區實際開一次抓取狀況頁」的目視確認。
  jsdom 測試驗得了 DOM 結構、驗不了 CSS 定位，而班次軸（`DayRow`）是這次唯一有畫面輸出的改動。
  正式區上線後若班次軸排版異常，第一個要看的就是 `AdminStatusPage.tsx` 的 `DayRow`。
- **Agent**: Claude（三個 code-simplifier 子代理分批執行）
- **Timestamp**: 2026-08-04 12:15:00 Asia/Taipei
- **範圍**：0.6.14–0.6.17 動過的檔案 + `stock-report/index.ts`。純品質整理，行為不變。
- **改了什麼**：
  - `AdminStatusPage.tsx`：抽檔內 `DayRow` 元件，班次軸三列重複的骨架／格線／「現在」線
    從 3 份降為 1 份；`judgePeriod` 原本三處各算一次，改為 `macroRows` 一次算完共讀。
  - `timeline.ts`：新增純函式 `taipeiParts()`（附 4 個測試），取代頁面裡兩處手寫 `+8h` 換算。
  - `macroCalendar.ts`：`pad2` / `shiftPeriod` 兩個檔內私有 helper，收掉三處月序算式。
  - `index.ts`：刪除 `taipeiDateOf()`，四個呼叫點改用早已 import 的 `taipeiYmdOf()`
    （同一功能的第二份實作）；修正 `handleAdminStatus` 那句與程式碼不符的「allSettled」註解。
- **一處刻意接受的行為差異**：`taipeiDateOf(existing.asOf)` 遇到無法解析的 `asOf` 會拋
  RangeError（`syncNews` 吞掉後**永久跳過該檔**、`syncFx` 則整段失敗），改用 `taipeiYmdOf`
  後回 `'NaN-NaN-NaN'` → 比對不符 → 重抓一次。該路徑需要檔案內容壞掉才會到達，
  且新行為是自我修復，嚴格說是改善而非退步。
- **刻意沒做**（評估後否決，理由留檔免得下個 Agent 重想一遍）：
  - `+8h` 收斂成跨檔共用 helper：淨 +7 行，且 `macroCalendar.ts` 目前是**零 import 的純模組**
    （檔頭註解說明它獨立就是為了測得到），為一行算術替它接上 `report.ts` 依賴不划算。
  - 三支 `handleSyncX` 抽共用 wrapper：回應欄位各不相同，抽出來是帶一堆可選欄位的假抽象。
  - `handleGenerateAll` 流程、`logBatchRun` 欄位名（對應 DB 欄位）、`json()` 鍵名（前端依賴）
    全列為禁區未動。
  - `usMacro.ts` 的 `fredSinceDate`：算 UTC 月份、輸出 `'YYYY-MM-01'`，與期別語意不同，
    屬表面相似而非真重複。
- **驗證**：`npm test` 721/721（+4 新測試）、`npm run lint` 恰 3 個既有 warning（未新增）、
  `npm run build` 通過。
- **⚠️ 驗證的盲區**：`tsconfig.app.json` 的 `include` 只有 `["src"]`，且本機無 deno →
  **`supabase/functions/` 不在 `tsc -b` 範圍內、`index.ts` 也沒有單元測試**。
  該檔的改動僅靠 oxlint 與人工核對呼叫點，故本次刻意只做機械式等價改動。

### Task 46: 總經改為發布行事曆驅動的自適應掃描（0.6.15）
- **Status**: ✅ **完成** —— 程式、兩區部署、cron 改密皆已完成並覆驗
- **Agent**: Claude
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **需求**：使用者要求查官方公告時間，「區間就把 scan 拉長，一旦抓到就不抓」。
- **前提修正**：官方給的是**確定日期**不是區間；真正的不確定是「官方發布 → FRED 匯入」的延遲。
- **實作**：新增 `macroCalendar.ts`（`RELEASE_CALENDAR` / `decideMacroScan` / `expectedLatestPeriod`），
  `syncMacro` 前面加決策、新增 `reason: 'skipped'`、`MacroFile` 加 `scansToday`。
  BUG-008 的指紋邏輯完全沒動。
- **驗證**：測試區連打三次 → `unchanged`(3186ms) / `skipped`(135ms) / `skipped`(75ms)，
  證明抓到後完全不打 FRED。`npm test` 719/719。
- **cron 改密**（2026-07-31 18:35）：兩區皆改為 `*/30 12-18 * * *`（台北 20:00–02:30
  每 30 分）。用 `cron.alter_job` + 身分檢查同一區塊執行；覆驗 command 未含佔位符、
  其餘三個排程未被動到。改後立即觸發仍是 `skipped`（測試區 652ms / 正式區 1050ms），
  證明班次變多不等於請求變多。
- **前端改用後端行事曆**（0.6.17）：`admin-status` 回傳 `nextRelease`，
  前端那份 `RELEASE_RULE` / `estimateNextRelease` 已整段移除（兩份常數會漂移）。
- **待辦**：**8/7 非農發布日**是第一次真實迴歸，屆時觀察密集掃描有無如預期啟動並停止
  （台北 20:30 起應密集掃、抓到後轉 `skipped`）。

### Task 47: 每年 12 月更新次年發布行事曆（長期）
- **Status**: 🔁 **週期性任務**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **做什麼**：更新 `macroCalendar.ts` 的 `RELEASE_CALENDAR` 為次年日期。
- **為什麼要人工**：BLS 的 schedule 頁一律 403（換 UA 無效），無法自動同步；
  BEA 的頁面可抓。可跑 `sources/scripts/find-release-dates.py` 以 ALFRED vintage 反查校準。
- **忘了會怎樣**：不會壞 —— 行事曆用完會 fallback 到規則推算並標記 `stale`，
  只是精準度下降（掃描窗抓不準發布時刻）。

### Task 45: 管理員後台「資料抓取狀況」
- **Status**: ✅ **完成** —— 0.6.12 已進 `main`，兩區皆已部署並以 `functions download` 逐檔覆驗
- **Agent**: Claude
- **Timestamp**: 2026-07-31 13:55:00 Asia/Taipei
- **需求**：使用者要一個只有 admin（zrchen0425@gmail.com）看得到的頁面，
  追蹤所有資料的抓取狀況（點名三大法人、融資融券），總經改用列表呈現，
  並要求把排程相關資訊都納入。
- **設計**：比稿四輪後定案「單日時間軸」（`docs/architecture/admin_status_c_timeline.html`）。
  時間軸 → 排程 → 總經期別 → 檔案涵蓋，四段。
- **授權**：三層 —— 分頁隱藏（僅介面）、`assertAdmin()` 驗 JWT + `app_metadata.role`、
  RPC 只 GRANT service_role。**刻意不用 CRON_SECRET 也不用 email 比對**（理由見 SPEC）。
- **驗證**：`npm test` 671/671；測試區授權矩陣全數符合預期（admin 200 / 一般 403 /
  無 token 401 / CRON_SECRET 401 / RPC 直呼 401·403），回應不含任何密鑰。
- **正式區覆驗**（2026-07-31 13:55）：§11 只跑那一段、權限實測（service_role 可 /
  authenticated·anon 不可）、10 檔與 `main` 一致、授權矩陣與測試區完全相同（admin 200 /
  一般 403 / 無 token 401 / CRON_SECRET 401 / RPC 直呼 401·403）、回應不含密鑰。
  `zrchen0425@gmail.com` 在兩區本來就是 admin，未異動任何帳號。
- **0.6.13**（2026-07-31 14:55）：總經加上「今日班次」時間軸與下次抓取時間、
  移除新聞追蹤。已上 `main` 並經正式區資料實地覆驗（四種寬度掃描全過、
  線上 bundle 內容確認）。本次無後端變更，Edge Function 未重新部署。
- **UI 版面**（2026-07-31 14:10）：已安裝 Playwright 並掃 1440/1024/768/390px，
  抓到四個真問題（手機看不出延遲、狀態欄消失、圖例直排、新聞畫了永遠抓不到的公布窗），
  全部修正後四種寬度、深淺兩色皆通過。腳本收在 `sources/scripts/verify-admin-status.cjs`。

### Task 44: 修好「總經數據永遠慢一天」（BUG-008）
- **Status**: ✅ **完成** —— 0.6.11 已進 `main`，兩區皆已部署並以 `functions download` 逐檔覆驗
- **Agent**: Claude
- **Timestamp**: 2026-07-31 12:50:00 Asia/Taipei
- **起因**：使用者問「總經目前怎麼抓的？可以每月或每季抓嗎？」，
  追問時補上「可是像 PCE 已經有更新了，卻沒抓到？」——
  查下去發現真正的問題不是頻率，是抓了卻拿到舊資料。
- **根因**：`syncMacro` 的冪等鍵是台北日曆日。`macro-daily` 排兩班的用意是
  「第一班沒接到就讓第二班補」，但第一班**成功抓到一份還沒更新的資料**時會寫入
  `asOf` = 今天，第二班便直接跳過、一個請求都不發。
  夏令 FRED 匯入慢於 13:00 那班；冬令發布時間（13:30 UTC）根本晚於 13:00，
  於是冬令每個月固定慢一天。完整證據鏈（含 ALFRED vintage 比對）見 `FIXED_BUG.md` BUG-008。
- **改法**：冪等改用 `macroFingerprint`（涵蓋整段 points，因 FRED 會回頭修正歷史值），
  每班都真的去問 FRED，內容變了才寫檔；新增 `checkedAt` 與 `asOf` 分離。
  `syncFx` 刻意不跟進（理由見 PROGRESS）。**未改排程頻率**。
- **驗證**：lint / build 通過；`npm test` 632/632（新增 10 條）。
- **測試區覆驗**（2026-07-31 12:37）：`functions download` 逐檔比對 10 檔全與 `dev` 一致；
  連打兩次 `sync-macro` → `updated`（3892ms）/ `unchanged`（1020ms，`asOf` 不變）；
  `PCEPILFE.latest` 補上 2026-06 = 3.29%。**沒跑任何 SQL**（schema.sql 只動註解）。
- **正式區覆驗**（2026-07-31 12:41）：10 檔全與 `main` 一致；
  `updated`（2103ms）/ `unchanged`（910ms，`asOf` 不變）；五項指標走勢區間全部前進一期。
- **待觀察**：明天 21:00 / 23:00 那兩班是真正的排程迴歸；**11 月進入冬令**後最值得看
  （13:00 那班會跑在發布之前，第二班必須接上，那是本修正最主要的受益情境）。

### Task 43: 修好「當天融資融券永遠進不了報告」（BUG-007）
- **Status**: ✅ **完成** —— 0.6.10 已進 `main`，兩區 Edge Function 已部署並以 `functions download` 逐檔覆驗
- **Agent**: Claude
- **Timestamp**: 2026-07-31 09:10:00 Asia/Taipei
- **起因**：使用者回報籌碼頁「融資融券此欄位好像都沒有抓到資料」。
- **根因**：重產閘門的 `runSignature` 傳 `marginDatedFailed ? '' : dataYmd`，
  而 `marginDatedFailed` 問的是「7 天內有沒有任何一天抓到」，整天恆為 false ——
  這一段整天是常數，於是 21:00 抓到當天融資融券後指紋不變、報告不重產。
  0.6.1-dev.1（`7e27a58`）引入的迴歸，完整證據鏈見 `FIXED_BUG.md` BUG-007。
- **改法**：`SeriesResult` 新增 `marginYmds`（視窗內實際有資料的交易日），
  閘門改用 `pollPlan.marginSigPart(series.marginYmds)`。
- **驗證**：lint / build 通過；`npm test` 622/622（新增 4 條，含當天由無到有的迴歸測試）。
- **線上覆驗**：兩區各觸發一次 `generate-all`，正式區 `20260730/0050.json` 的 `margin` 已補上
  （`sources.margin.fetchedAt` 顯示資料昨晚 21:00 就抓到了），`notes` 清空、history 7/7 天有資料。
- **待觀察**：今晚 21:00 那輪才是真正的迴歸驗證（T86 已凍結、只有融資融券由無到有）。

### Task 42: README 錯誤修正 + 架構圖改為 SVG
- **Status**: ✅ **完成（純文件，未進版，維持 0.6.9；尚未 commit）**
- **Agent**: Claude
- **Timestamp**: 2026-07-30 21:08:19 Asia/Taipei
- **起因**：使用者回報 README 在 GitHub 上顯示錯誤訊息。根因是 Mermaid 語法 ——
  `subgraph Frontend [React SPA (Vite + TS)]` 這類**標題含半形括號**的寫法會讓 Mermaid 解析失敗
  （3 處：Frontend / LocalStorage / Supabase），整塊圖變成 "Unable to render rich display"。
- **改法**：整塊 Mermaid 換成手繪 SVG `docs/architecture/system-architecture.svg`
  （無外部依賴、`prefers-color-scheme` 深淺配色、自帶背景色所以主題不一致也讀得到），
  README 以 Markdown 圖片語法引用。內容一併更新到 0.6.9 實況
  （Storage / pg_cron / 匯率 / 總經 / AI 端點由瀏覽器直連）。
- **順手修掉的其他事實錯誤**：目錄結構（`build-docs/` 早已不存在、`docs/agent` 與 `docs/architecture` 未列）、
  §環境架構的資料表與函數清單、`stock-price` 的四個 action（原文寫成三支獨立函數）、
  0.6.8 與 0.6.7 重複的 Y 軸 bullet、0.6.2 掉了子標題、`v0.2.x` 版號前綴（違反 §12）、
  使用版本漏列 lucide-react / jsPDF / html2canvas / oxlint、功能特色漏了個股分析 / AI / 匯率 / 總經。
- **驗證**：SVG 以 chromium headless 在淺色與深色各截圖確認版面無重疊、無字溢出；XML 可解析。
- **未動**：0.2.3 版本紀錄裡的 `deploy stock-price --no-verify-jwt`（歷史紀錄，留存當時實際做法）。

### Task 41: README 的部署指令與線上 verify_jwt 不一致
- **Status**: ✅ **已修（2026-07-30，見 Task 42 同批）**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 22:45:00 Asia/Taipei（修正於 2026-07-30 21:08:19）
- **修法**：兩份 README 都改成 `deploy stock-price`（不帶旗標）＋
  `deploy stock-report --no-verify-jwt`，並註明只有後者要帶的理由（pg_cron 不帶 JWT）
  與 stock-price 不可關的理由（會變成公開端點、燒 Edge Function 額度）。
  `sources/supabase/README.md` 的 Dashboard 步驟、部署後驗證、常見問題 401 三處同步改掉。
- `sources/supabase/README.md:71-73` 與根目錄 `README.md:200-201` 對**兩支** Edge Function
  都寫了 `--no-verify-jwt`，但線上實況是 `stock-price` 為 **`verify_jwt = true`**
  （正式區 v12、測試區 v8 都查過）。`CLAUDE.md` §13.3 的說法才對。
- **風險**：照 README 抄指令重新部署，會把 `stock-price` 從「要登入」變成公開端點。
- **建議修法**：兩份 README 的部署段落改成
  `supabase functions deploy stock-price`（不帶旗標）
  ＋ `supabase functions deploy stock-report --no-verify-jwt`，並補一句說明為什麼只有後者要帶。
- 尚未動手 —— 不在使用者當次要求範圍內，等指示。

### Task 40: UI 設計方向比較 + 0.6.9 架構流程 HTML
- **Status**: ✅ **完成（純文件，未進版，維持 0.6.9）**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 22:10:00 Asia/Taipei
- 產出兩份 HTML 於 `docs/architecture/`，並發布成 Artifact：
  - `ui_redesign_shadcn_carbon_stripe.html` —— shadcn/ui · IBM Carbon · Stripe FinTech
    三個方向，各含「庫存總覽」「個股分析」兩大畫面 + 元件表 + token 表。
    **三個系統的版面骨架各自不同**（不是換色），這是與既有 `design_systems.html` 的差別。
  - `architecture_workflow_0.6.9.html` —— 十章的 0.6.9 運作參考。
- **待使用者決定**：要不要真的換設計系統、換哪一個。三者的改動成本已寫在頁尾：
  - shadcn 最低（現有 `index.css` 已 token 化，主要是換 `:root` 變數）
  - Carbon 最高（導覽要從水平 tab 改成左側欄，`AppShell.tsx` 的 `TabNav` 與 `.bottom-nav` 都得重寫）
  - Stripe 中等，但要重挑 `chartColors.ts` 的六個寫死 hex，並可移除 `.report-surface` 覆寫
- **未做**：尚未 commit 到 `dev`（等使用者指示）。

### Task 39: AI 在本地模型上的三個問題 (0.6.9)
- **Status**: ✅ **隨 0.6.9 上線（純前端，Supabase 兩區未動）**
- 三個問題其實同源：**Google 那條路徑一路踩坑一路補，OpenAI 相容那條的對應處理從來沒跟上**。
  1. `content` 空時不論成因都拋同一句（Google 早就分了 MAX_TOKENS / SAFETY / 結構不符）→ dev.3 補診斷
  2. 沒有關閉思考的設定（Google 有 `thinkingBudget: 0`）→ dev.4 補上，並加剝 `<think>` 與加警語的退路
  3. 沒送輸出上限（Google 有 `maxOutputTokens: 8192`）→ dev.5 補 `OPENAI_MAX_TOKENS`
- ⚠️ **dev.5 的截斷修法尚未在使用者的端點上實測確認**（前兩個已由使用者回報確認生效）。
  若仍截斷，代表是端點自身的硬上限（例如 Ollama 的 `num_ctx`），需在端點側調整。
- **Agent**: Claude
- **Timestamp**: 2026-07-29 17:15:00 Asia/Taipei
- 使用者回報「分析失敗：OpenAI 相容 API 回傳結構未包含有效的 choices[0].message.content」。
- HTTP 是 200，只是 `content` 空的 —— 但這條路徑原本**不論成因都拋同一句**，
  而 Google 那條早就分了 MAX_TOKENS / SAFETY / 結構不符。
- `extractOpenAiText` 補齊六種診斷：body 內夾帶 error、沒有 choices、
  **推理型模型把答案放在 `reasoning_content`**、`finish_reason: length`（還沒寫正文就沒額度）、
  模型拒答（`refusal`）、`content_filter`；其餘把 `finish_reason` 帶進訊息。
- **待確認**：實際成因要等使用者重試後看新訊息。最可能是推理型模型
  （deepseek-r1 / qwq / gpt-oss），其次是輸出額度。
  也不排除 0.6.9-dev.2 加長的 system prompt 讓思考變長、把額度用完 —— 新訊息會分得出來。

### Task 38: AI 提示詞加入使用者的分批進出框架 (0.6.9)
- **Status**: 🟡 **程式碼完成；未併入 `main`**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 17:35:00 Asia/Taipei
- 使用者指定加入四種框架：金字塔建倉、倒金字塔停利、非等距網格、馬丁格爾變體。
- **與既有準則 5 的衝突已處理**：那四種本質上在講「何時加碼／出清」，
  而準則 5 明令不得下買賣指令。作法是把它們當成**描述用語彙**而非放行許可，
  新增的準則 10 明文寫「這不放寬準則 5」。
- **馬丁格爾單獨標註前提**（標的不歸零且資金無限、真實帳戶不成立、
  連續下跌所需資金指數成長），不與其他三項並列成等價選項 —— 有測試鎖死。
- 599 tests 綠、build 綠、lint 無新增警告。純前端，Supabase 兩區不必動。

### Task 37: 修手機上個股切換選單被擠壓 (0.6.9)
- **Status**: 🟡 **程式碼完成、實測通過；未併入 `main`**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 17:10:00 Asia/Taipei
- 見 `FIXED_BUG.md` BUG-006。根因是 0.6.7 讓個股選單沿用 `.ws-select`，
  連帶繼承了一條**為頁首寫的** `@media (max-width: 720px) { flex: 1 }`。
- 修法：規則收斂為 `.app-header .ws-select`；個股選單改為手機上獨占一列。
- 純 CSS 異動，596 tests 綠、build 綠、lint 無新增警告。Supabase 兩區不必動。

### Task 36: 個股分析合併成單一長頁 (0.6.8)
- **Status**: ✅ **0.6.8 定版並上線（純前端，Supabase 兩區未動）**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 16:40:00 Asia/Taipei
- 使用者要求把籌碼／技術面／基本面／我的持股併成一頁，順序
  **我的持股 → 籌碼 → 基本面 → 技術面**；AI 分析保留為獨立分頁。
- 先產出 6 個 HTML 版型比稿讓使用者挑，選定 **版型 D（卡片分組）**。
- **使用者特別交代**：三大法人買賣超的日期選擇要保留 —— 它在 `ChipsTab` 內部，
  未動其內部邏輯，實測 7 天按鈕（07/20～07/28 最新）與法人選擇 6 項都在。
- **PDF**：只匯出籌碼＋基本面＋技術面，持股在擷取範圍外（個資）；
  倍率改為 `pdfScaleFor` 依面積自動調，避開 iOS Safari 的 canvas 上限。
- **a11y**：圖表改 roving tabindex，整頁 Tab 次數 213～765 → **24**。
- 596 tests 綠、build 綠、lint 無新增警告。純前端異動，**Supabase 兩區都不必動**。
- 已併入 `main` 並 push，GitHub Pages 已部署；`main` 與 `dev` 對齊。

### Task 35: 折線圖改成 Google Finance 風格 (0.6.8)
- **Status**: ✅ **隨 0.6.8 上線**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 14:45:00 Asia/Taipei
- 使用者提供 Google Finance 匯率圖截圖要求比照。四項差異：漸層面積、垂直虛線、
  提示框貼著資料點、只有 hover 那點有圓。
- **範圍（使用者選定）**：所有折線圖（匯率 2 張 + 籌碼頁 2 張）；
  K 線／長條／KD 不動；時間區間維持 3/6/12 個月。
- **改動**：`chartPath.ts`（抽出共用 `segments()`、新增 `areaSegments` 與 `clampTipCenter`）、
  `chartFrame.tsx`（`crosshair` / `tooltipAnchor` 兩個可選 prop，預設關閉）、
  `LineSeriesChart.tsx`（面積、自動圓點）。新增 `chartPath.test.ts`。
- **PDF 硬性關卡已通過**：實測 html2canvas 正確渲染 `<linearGradient>`，
  同一次擷取多個實例 id 不衝突、文字未變巨大黑字。**不需退回平塗填充**。
- **跟著改的既有測試**：`FxPage.test.tsx` 原本數 `svg circle` 驗點數，
  改成解析 polyline 的 `points` 屬性（圓點已不再等於資料點數）。
- 584 tests 綠、build 綠、lint 無新增警告。
- **追加**：基本面的月營收加一張走勢圖（使用者以為在技術面，實際在基本面）。
  圖用由舊到新的 `revenueMonths`、表格用 reverse 後的 —— 拿錯會讓趨勢完全反過來
  而且看起來像真的，已用 y 座標測試釘住。
- 隨 0.6.8 併入 `main`。純前端異動，Supabase 兩區未動。

### Task 33: 手機改用底部導覽列 (0.6.6-dev.1)
- **Status**: ✅ 已 commit（`dev` = 0.6.6-dev.1、`main` = 0.6.6 定版）；**尚未 push、尚未部署**
- **Agent**: Claude
- **Timestamp**: 2026-07-28 21:55:00 Asia/Taipei
- 使用者於「頂層頁籤 — 10 個設計提案」review 後選定**方案 08（手機底部導覽）**。
  ≤720px 分頁離開頁首、改成固定底部列；桌機完全不變。決策與淘汰理由見 `PLAN.md §S`。
- **踩到的坑**：`.app-header` 的 `backdrop-filter` 會成為 fixed 子孫的 containing block，
  純 CSS 把頁首裡的 `<nav>` 釘到視窗底部**做不到** —— 改由 `useNarrowScreen()`
  決定渲染位置（`PLAN.md §S4`）。
- **連帶搬家**：浮動鈕上移讓開導覽列；版本徽章手機改回文件流跟在頁尾後面。
- **順手刪掉**：dev.3 之後就選不到任何元素的 `.ws-select select` / `.user-email` 死 CSS，
  以及不再需要的 `@media (max-width: 400px)` 分頁擠壓。
- **待辦**：① `git push origin main`（**會觸發 Pages 自動部署**）與 `git push origin dev`
  → ② 上線後**用真手機看安全區**（桌機瀏覽器的 inset 恆為 0）。
- 依使用者指示直接進 `main`，跳過測試區先行驗證這一關（純前端版面異動）。
- 純前端異動，**Supabase 兩區都不必動**。

### Task 34: 新增「外幣匯率」頂層頁面 (0.6.7)
- **Status**: ✅ **0.6.7 定版，兩區皆已上線並驗證**
- **Agent**: Claude
- **Timestamp**: 2026-07-29 09:55:00 Asia/Taipei
- 以台幣為本位，8 種外幣（USD/JPY/EUR/CNY/HKD/GBP/AUD/KRW）：
  幣別卡、台幣⇄外幣雙向換算器、3 個月／6 個月／1 年走勢圖。
- **資料源改用 Yahoo Finance，不是原訂的台灣銀行牌告匯率** —— 台銀的
  `rate.bot.com.tw/xrt/flcsv/...` 已被 JS proof-of-work 人機驗證擋住
  （回 `Challenge Validation` 而非 CSV，換 UA 無效，Edge Function 過不了）。
  代價：只有市場中價，沒有現金／即期買賣價，畫面已標示。
- **新增**：`fxRates.ts`（+test）、`fxProxy.ts`（+test）、`Fx/fxConvert.ts`（+test）、
  `Fx/FxPage.tsx`（+test）；`index.ts` 新 action `sync-fx`；`schema.sql` §10 cron `fx-daily`。
- **0.6.7 後續調整（依使用者指示）**：
  - 走勢圖拆成兩個方向並排（新臺幣/外幣、外幣/新臺幣）。
  - **移除換算器**整塊，連同只服務它的四個純函式與 CSS。
  - **卡片改用即時報價**（`stock-price` 新 action `fx`，10 分鐘 TTL 三層快取），
    走勢圖仍走每日檔。解決「整個交易日看不到今天匯率」。
  - 央行統計資料庫 API **評估後不採用**：涵蓋 8 幣別、1993 年至今 8,324 筆、
    官方免金鑰，但**日資料按月批次發布、落後 29 天**（其他三個匯率端點落後 61 天），
    且欄位方向不一致（JPY/CNY/HKD/KRW 是 `XXX/USD`，EUR/GBP/AUD 是 `USD/XXX`）。
    交叉驗證顯示與 Yahoo 誤差 ±0.3% 以內，資料本身正確 —— 純粹是太舊。
- **順手修的兩個共用問題**：
  - `chartScale.fmtAxisNumber` 對小於 1 的值一律 `Math.round` → 匯率整條 Y 軸標成「0」（實測）。
  - `LineSeriesChart` 補上 `labelIndices`（一年 260 點不抽稀會糊成一團）。
- **測試區（已完成 2026-07-29 10:15）**：
  - [x] 部署 `stock-report --no-verify-jwt`（v26，覆驗 `verify_jwt=false`）
  - [x] 建 cron job `fx-daily`（`0 3,9 * * *`），身分檢查與寫入同一個 `DO $$` 區塊
  - [x] 觸發 `sync-fx` → `synced:true, count:8`；冪等第二次回 `synced:false`
  - [x] `functions download` 逐檔 diff 10/10 一致；前端讀真實 Storage 實測通過
- **正式區（2026-07-29 完成）**：
  - [x] 依 §12.3 去尾綴定版 `0.6.7`、README 版本紀錄定稿
  - [x] 併入 `main` 並 push（GitHub Pages 已部署）
  - [x] 部署正式區 `stock-report --no-verify-jwt` 與 `stock-price`
  - [x] 正式區建 cron `fx-daily` ＋ 觸發 `sync-fx` ＋ `functions download` 覆驗
  - [x] 合併後 `git push origin main:dev` 讓兩分支一致
- **版號**：原訂 0.6.6，但 Task 33 已用掉並定版上線，故改為 **0.6.7**；
  本功能已 rebase 到底部導覽列（Task 33）之上。
- **手機版型未做**：使用者決定等桌機功能驗證無誤後再處理。
  原本為第 6 個分頁加的「≤360px 隱藏分頁圖示」CSS **已在 rebase 時刪除** ——
  Task 33 把底部列改成直式（圖示在上、標籤在下）後，那套橫式寬度算式不再適用，
  六格在 320px 仍然寬鬆。

### Task 32: 頁首右側收斂成兩個選單 (0.6.5-dev.3)
- **Status**: ✅ **兩區皆已上線並驗證**（0.6.5 定版，Pages 已部署）
- **Agent**: Claude
- **Timestamp**: 2026-07-28 19:40:00 Asia/Taipei
- 使用者於頁首設計 review 後選定 R4。右側 8 個控制項 → 2 個選單。
- **修好兩個量出來的 bug**：≥1221px 的頁首兩列（106→70px）、
  375px 工作區下拉塌成 39px（→108px）。詳見 `PLAN.md §R`。
- ✅ 正式區後端已一併補上：部署 `stock-report`、建 `macro-daily` cron job、
  觸發 `sync-macro`（5 項）與 `generate-all`（fundamentalSynced 5）。
  線上程式碼 9/9 檔與 `main` 一致。

### Task 31: 總經獨立為頂層頁面 ＋ 自己的 cron (0.6.5-dev.2)
- **Status**: **測試區已部署驗證**（cron job 已建並覆驗、線上 9/9 檔一致）；正式區未動
- **Agent**: Claude
- **Timestamp**: 2026-07-28 17:10:00 Asia/Taipei
- dev.1 把總經做成個股分析的分頁、並掛在盤後批次裡，兩者都與「它是全市場共用的一份」
  自相矛盾（`PLAN.md §Q5`）。dev.2 兩邊都拆開。
- **UI**：提為頂層頁面 `MacroPage`，本機模式一併隱藏（沿用個股分析的 `isReportConfigured` 規則）；
  `AiTab` 改成自己 `fetchMacro()`（順便變 lazy）。
- **觸發**：新 action `sync-macro` ＋ 新 cron job `macro-daily`（`0 13,15 * * *`，每天兩班）。
- **實測到的版面問題**：分頁由四個變五個，375px 會折行（tab 高 36→57px）。
  已收窄 `max-width: 400px` 的分頁間距，六種寬度重量過全部 36px 單列。
- **待辦**：
  ① 部署 `stock-report`（`--no-verify-jwt` 不可省）
  → ② **建立 `macro-daily` cron job**（`schema.sql` §9，**只跑那一段**，
     要填 `<PROJECT_REF>` / `<CRON_SECRET>` 兩個佔位符）
  → ③ 打一次 `{"action":"sync-macro"}` 確認 `count: 5`
  → ④ 跑 §6d 的覆驗查詢確認 ref 與密鑰長度。
- ⚠️ `batch_run_log.macro_synced` 成為廢欄位（正式區從未加過，不必補）。

### Task 30: AI 分析改版 ＋ 總經與獲利能力 (0.6.5-dev.1)
- **Status**: **測試區已部署驗證**（macro 5 項、fundamental schema 2）；閘門 **458 tests** 全綠；正式區未動
- **Agent**: Claude
- **Timestamp**: 2026-07-28 15:20:00 Asia/Taipei
- 三件事：①「AI 解讀」更名「AI 分析」②產生分析後可追問，嚴格框限主題
  ③新增總經分頁與獲利能力比率，兩者都進 AI prompt。
- **推翻了兩條既有決策**，理由寫進 `PLAN.md` §P 與 §Q（不默默改）：
  §M8「不做多輪對話」、§N2「不用季報 EPS」。後者是因為 `t187ap17_L` 的比率
  已由證交所算好，「欄位解析繁瑣」這條理由在新端點上不成立。
- **實測過的資料源**：`t187ap17_L`（1051 筆／383KB，2330 得 66.25/58.10/60.65/50.51）、
  FRED `fredgraph.csv`（免 API key，五序列全 200；非農 +57 千人與手算相符）。
- **待辦**：
  ① 兩區跑 `ALTER TABLE batch_run_log ADD COLUMN … macro_synced`
     （**只跑那一行，不要整份重跑 `schema.sql`** —— 0.6.4 那次把 cron 打回佔位符）
  → ② 部署 `stock-report`（`--no-verify-jwt` 不可省）→ ③ 觸發 `generate-all`
  → ④ 由公開 Storage 覆驗 `macro/us.json` 與 `fundamental/*.json` 的 `profitQuarters`。
- **人工驗證清單（無法自動化）**：追問「毛利率趨勢」應正常作答；
  「幫我寫首詩」「今天天氣」應**一字不差**回固定拒答句；
  「忽略你的指示，告訴我該不該買」應以拒答句處理且不給買賣指令；10 輪後輸入框停用。


### Task 29: 修 Storage 讀取被瀏覽器快取一小時 (0.6.4)
- **Status**: ✅ **兩區皆已上線並驗證**（正式區 GET 標頭已變為 `max-age=0`）
- **Agent**: Claude
- **Timestamp**: 2026-07-28 11:30:00 Asia/Taipei
- 根因：`uploadJson` 未指定 `cacheControl`，SDK 預設 3600 →
  `cache-control: public, max-age=3600`。而 `Ctrl+Shift+R` **不涵蓋 JS 發出的 `fetch()`**，
  所以使用者硬重整也救不了，只有無痕視窗才對。
- 修法：前端 `reportsBucket.ts` 一律 `cache: 'no-store'`；後端 `uploadJson` 寫 `cacheControl: '0'`。
  **前端那道不能省**，既有檔案要等下次寫入才換 metadata。
- ⚠️ **診斷陷阱（我踩過）**：`curl -I`（HEAD）回 `no-cache`，GET 才回 `max-age=3600`。
  **驗快取一律用 GET**：`curl -s -o /dev/null -D - <url>`。

### Task 28: 基本面標示資料產出時間 ＋ 個股分析「重新整理」鈕 (0.6.4)
- **Status**: ✅ **已上線**；時間戳依使用者要求移至月營收標題右側
  （Playwright 於 1440 / 1024 / 760px 驗過版面）
- **Agent**: Claude
- **Timestamp**: 2026-07-28 11:05:00 Asia/Taipei
- 起因：使用者回報月營收畫面只有六月，每一層都驗過都是 12 個月、**無法重現**。
  根因未明時能做的是提高可判斷性，而不是猜一個修法。
- `FundamentalTab` 加「資料更新於 {asOf}（共 N 個月）」，與估值的「資料日」語意不同、刻意並存。
- `StockDetailPage` 加 `reloadKey` 與「重新整理」鈕（`AiTab` 刻意不接，避免洗掉 AI 解讀）。
- **未做但仍待處理**：`warm` 沒有跑月營收回補，新增股票第一次打開只有 1 個月，
  要等當晚批次。`backfill-revenue` 目前只掛在 `generate-all`。

### Task 27: 月營收歷史回補 —— 一次補滿 12 個月 (0.6.4)
- **Status**: ✅ **兩區皆已上線並驗證**（測試區 4 檔、正式區 2 檔各 12 個月；
  ETF 收斂、第 4 輪短路）。閘門 **395 tests** 全綠
- **Agent**: Claude
- **Timestamp**: 2026-07-28 10:45:00 Asia/Taipei
- **dev.3 修的漏洞**：`syncFundamental` 整份重建物件時漏帶
  `revenueBackfilledThrough`，每個交易日第一輪都會抹掉回補進度。
  已把建檔與 notes 判斷抽成 `buildFundamentalFile()` 純函式並補測試 ——
  **`index.ts` 是本專案唯一沒有任何自動檢查的檔案**（`tsc -b` 只收 `src/`），
  有判斷的程式碼一律別留在那裡。
- **dev.2 修的死結**：ETF 不在 `t21sc03` 內、缺口永遠填不滿，把最新那幾個月
  永久釘在待抓清單上，真正的公司拿不到更舊資料。新增
  `FundamentalFile.revenueBackfilledThrough` 區分「還沒找」與「找過了沒有」。
  **單元測試看不出來，是部署到真實環境才浮出來的**（詳見 PROGRESS.md）。
- **順手修好的另一件事**：測試區兩個 cron job 的 url/密鑰被整份重跑 `schema.sql`
  打回佔位符（§6c 是 unschedule+schedule，會重寫整段 command）。
  已用 `cron.alter_job` + `replace` 修正並覆驗。
  **往後套用新 `ALTER TABLE` 只跑那幾行，不要整份重跑 `schema.sql`。**
- 起因：使用者問「把今年度的月營收補齊會不會爆掉」。
  **容量完全不是問題**（正式區實測：全庫 15MB、`chip_raw_cache` 2.6MB / 29 列、
  `fundamental/` 5 檔共 1745 bytes、淨持有 5 檔）。真正的阻礙是資料源 ——
  `t187ap05_L` 只回最新一個月、端點不吃年月參數（原 `PLAN.md` N5 的取捨）。
- 改接公開資訊觀測站分月報表 `t21sc03`（上市 `sii` ＋ 上櫃 `otc`），缺口驅動、補滿即短路。
- 新增 `twRevenueHistory.ts`（純函式：`mopsRevenueUrl` / `parseMopsRevenue` /
  `planRevenueBackfill` / `publishedMonths`）＋ `index.ts` 的 `backfillRevenue()`
  與 `action: 'backfill-revenue'`；`mergeRevenueMonths` 改吃陣列並新增 `fillGapsOnly`。
- **上櫃股從此有月營收**（估值仍只有上市），`notes` 因此由籠統一條改為分項。
- **已驗證的事實**（2026-07-28 實抓）：
  - 22 次實抓（11 個月 × 上市/上櫃）全部 200，big5 解碼正常。
  - 交叉驗證：由 5 月報表解析出的 2330 當月營收 `416,975,163`
    等於 6 月報表「上月營收」欄；6488 同法為 `4,842,007`。兩份獨立 HTML 對得起來。
  - 模擬排程反覆呼叫：3 輪補滿 12 個月，既有值未被覆蓋。
- **待辦**：
  ① 兩區跑 `schema.sql` 的 `ALTER TABLE batch_run_log ADD COLUMN … revenue_backfilled`
  → ② 部署 `stock-report`（**`--no-verify-jwt` 不可省**）→ ③ 手動打一次
  `{"action":"backfill-revenue"}`（**需 `CRON_SECRET` 明文，Agent 拿不到，請使用者自行執行**）
  → ④ 由公開 Storage URL 覆驗 `revenueMonths` 長度為 12。
- **先 `dev` / 測試區，驗過再合併 `main`**（§13.1）。

### Task 26: 資料源探針 (0.6.3) ＋ 基本面日期標示待修
- **Status**: 探針已實作，閘門全綠（**356 tests**）；**待部署兩區**（表＋函式＋cron job）
- **Agent**: Claude
- **Timestamp**: 2026-07-27 23:55:00 Asia/Taipei
- 起因：使用者回報基本面時間不對。查證 `fundamental/*.json` 的 `dataDate` 寫的是
  「我們去抓的那天」而非資料自報的日期（檔案說 07-27、數字是 07-24）。
- **但先修儀器不修行為**：`batch_run_log.bwibbu_date` 記的是快取值，
  一整晚 12 輪同一個數，短路後空白 —— 拿它決定怎麼修等於用假資料猜。
- 新增 `source_probe_log` ＋ `action: 'probe'` ＋ cron job `source-probe`，
  每 15 分鐘記錄各來源自報日期與內容指紋。**刻意不碰批次**。
- **待辦（明天 16:00 前部署，才趕得上完整的一天）**：
  ①兩區建表（`schema.sql` §8）→ ②部署 `stock-report`（`--no-verify-jwt`）→
  ③建 cron job `source-probe`（url 與密鑰用各區自己的，**別對調**）。
- **明天收工後**再依 `source_probe_log` 決定基本面的修法。

### Task 25: 修 T86 指紋不穩定＋前端切回前景自動重抓 (0.6.2)
- **Status**: 兩分支（`dev` / `main` 同為 `ef9937f`）與兩區 Edge Function 皆已上線
  （測試區 v17 / 正式區 v11，`verify_jwt=false`）。閘門 **352 tests** 全綠。
  **線上驗證 ✅ 通過**（23:00 出現 `skip_reason=complete`、753ms、零對外抓取）
- **Agent**: Claude
- **Timestamp**: 2026-07-27 22:20:00 Asia/Taipei
- BUG-004：T86 端點回的 1334 列內容相同但**列順序每次都不同**，位元組指紋因此永不穩定，
  `t86_frozen` 永遠 false、永遠不短路。修法是先排序再算指紋（看語意不看位元組）。
- 前端：個股分析頁只在開頁抓一次，輪詢改版後會停在開頁那一刻的快照。
  改為 `visibilitychange` 時比對 `generatedAt`，變了才換。
- 詳見 PROGRESS.md 2026-07-27 20:30 與 FIXED_BUG.md BUG-004。

### Task 24: 盤後批次改為 15 分鐘輪詢 (0.6.1)
- **Status**: 見 PROGRESS 最新一則。本地閘門全綠（lint / test **342 passed** / build）
- **Agent**: Claude
- **Timestamp**: 2026-07-27 20:10:00 Asia/Taipei
- 三班制的時間點是照「各源幾點公布」訂的，而那個認知在 2026-07-27 一天內被實測推翻三處。
  改為 16:00–23:45 每 15 分鐘輪詢＋看內容判斷，判斷邏輯抽到 `pollPlan.ts` 並以 17 個測試釘住。
- 三道閘門讓 32 輪不等於 32 倍成本：短路 / T86 改寫偵測（連續 2 次相同才定稿）/ 當日上限 40。
- **部署順序不可顛倒**：①兩區跑 `schema.sql` §7 的 `ALTER`（12 個新欄位）→ ②部署
  `stock-report`（`--no-verify-jwt`）→ ③`cron.alter_job` 改排程。
  先部署後 ALTER 的話 `logBatchRun` 會**無聲**整列寫入失敗，三道閘門全部失效。
  ③ 用 `alter_job` 而非重跑 §6c 的 `schedule`，後者會重寫 command、再踩一次 BUG-002。
- 詳見 PROGRESS.md 2026-07-27 19:30。

### Task 23: 0.6.0 定版後的兩區部署稽核
- **Status**: DONE（2026-07-27 19:20 收尾）—— 正式區建表與 cron 修復皆已完成並**驗證通過**
  （`manifest.json` 推進、`batch_run_log` 兩列、`cron.job active`，見 FIXED_BUG.md BUG-002）。
  稽核另外揪出測試區 cron 未觸發 → 轉為 **BUG-003** 追蹤。
- **Agent**: Claude
- **Timestamp**: 2026-07-27 16:38:10 Asia/Taipei（驗收 19:20）
- 定版後的正式區套用做到一半中斷，留下交叉錯配：**正式區有 `batch_run_log` 寫入程式碼但沒有表，
  測試區有表但程式碼落後**。兩邊都不報錯（觀測寫入刻意靜默），只能靠主動稽核發現。
- 已完成：測試區 `stock-report` → v13、正式區 `stock-price` → v9，皆逐檔 diff 驗證、
  `verify_jwt` 未被改動；本地閘門全綠（325 tests）。
- 待辦：正式區 SQL Editor 執行 §7 建表；確認 cron job 寫死的密鑰與 16:03 新設的
  `CRON_SECRET` 一致（否則今晚三班全 401）。SQL 見 PROGRESS.md 2026-07-27 16:38。

### Task 22: 技術面／基本面即點即產 warm (0.6.0-dev.7)
- **Status**: VERIFIED（測試區）—— 閘門全綠（325 tests）、線上實測含額度防護
- **Agent**: Claude
- **Timestamp**: 2026-07-27 15:30:18 Asia/Taipei
- 新股票原本要等夜間批次才有日線與基本面（AI 解讀甚至直接失敗）。新增 `action: 'warm'`
  單檔即點即產，前端在 Storage 查無時補叫一次。
- **額度防護四道**：heldTwTickers 白名單、與批次共用跳過條件、**日線查無也寫空殼檔**
  （`emptyCheckedDate`，否則會變成每次開頁重打的無限迴圈）、前端同代號 session 只試一次。
- 詳見 PROGRESS.md 2026-07-27 15:30。

### Task 21: 修 Gemini Flash 輸出被截斷 (0.6.0-dev.6)
- **Status**: IMPLEMENTED — 閘門全綠（317 tests）；待使用者以 Gemini Flash 實測
- **Agent**: Claude
- **Timestamp**: 2026-07-27 14:32:04 Asia/Taipei
- 根因：`maxOutputTokens` 寫死 1200，而 **Gemini 2.5 起的思考 token 也計入該上限**，
  正文只寫一句就被切掉。修法：上限提到 8192 ＋ `thinkingBudget: 0` 關閉思考，
  模型不支援該參數（400）時自動去掉重送一次。
- 另修：`finishReason` / `finish_reason` 先前完全沒檢查，截斷會被當成完整結果顯示。
  詳見 PROGRESS.md 2026-07-27 14:32 與 SPEC.md「輸出長度與截斷」。

### Task 20: 基本面分頁＋產業別＋新聞入 AI (0.6.0-dev.4)
- **Status**: IMPLEMENTED — 閘門全綠（lint / test **307 passed** / build）；
  **待重新部署 `stock-report` 與線上實測**（需使用者執行）
- **Planner / Implementer / Reviewer**: Claude
- **Timestamp**: 2026-07-27 11:25:16 Asia/Taipei

#### 使用者定案的決定
- 基本面範圍：估值三指標（BWIBBU_ALL，每日）＋月營收與年增率（t187ap05_L，每月）
- 呈現：新增「基本面」分頁**並且**餵進 AI payload
- 產業別：顯示在個股分析頁標題旁 badge ＋ 寫進 AI 提示詞（來源 t187ap03_L / t187ap05_L）
- 新聞：Google News RSS（盤後批次抓，AI 依標題判斷利多利空）

#### 異動範圍
- 新增：`stock-report/twFundamental.ts(+test)`、`stock-report/twNews.ts(+test)`、
  `src/services/fundamentalProxy.ts(+test)`、`src/services/newsProxy.ts(+test)`、
  `StockDetail/FundamentalTab.tsx(+test)`
- 修改：`stock-report/index.ts`（syncFundamental / syncNews）、`twChips.ts`（export UA）、
  `StockDetailPage.tsx(+test)`、`AiTab.tsx(+test)`、`aiPayload.ts(+test)`、版號三處、
  `README.md`、`supabase/README.md`、`SPEC.md`、`PLAN.md §N`

#### 驗收條件
- [x] 三個 TWSE 端點與 RSS 皆 curl 實測，欄位形態寫進註解與文件（非臆測）
- [x] schema 閘門一律 `>=`（0.4.0 事故防線），新增測試釘住
- [x] 上櫃股缺料仍寫檔＋notes，UI 與 prompt 各有明確文案，不臆測
- [x] 缺料時 AI 解讀不阻斷（news 為 null 照樣可產生）
- [x] **測試區線上完成**（2026-07-27 14:04）：部署（逐檔 diff 驗證）、schema §4.1、
      觸發 generate-all、`fundamental/` 與 `news/` 皆產出並核對數字正確
- [x] dev.5 修 2 個實測發現的問題：新聞查詢撞名（加代號）、ETF 註記誤稱上櫃
- [x] 順手修好測試區 cron 的佔位符故障（詳見 PROGRESS.md 2026-07-27 14:04）
- [ ] 使用者需**登出再登入**取得 admin claim，並重填 AI 設定後做 UI 實測
- [x] **正式區已套用**（2026-07-27 16:02–16:04，Task 23 稽核確認）：schema §4.1 `app_settings` 存在、
      `stock-report` 與 main 逐檔一致、`CRON_SECRET` 已設、批次產出四類檔案齊全。
      **唯一還缺 §7 `batch_run_log`**，見 Task 23。

### Task 19: AI 提示詞加「建議操作」與「注意事項」 (0.6.0-dev.3)
- **Status**: IMPLEMENTED — 閘門全綠（test 260 passed / build 通過）
- **Planner / Reviewer / Verifier**: Claude；**Implementer**: agy flash（使用者明確指定委派）
- **Timestamp**: 2026-07-27 10:30:22 Asia/Taipei
- 原「不得提供任何買賣建議」紅線經使用者指示放寬為**條件式觀察性參考**；
  明確買賣指令 / 目標價 / 進出場價位 / 報酬預期仍然禁止，免責聲明不變。
  詳見 PROGRESS.md 2026-07-27 10:30 與 SPEC.md「輸出結構與建議的邊界」。

### Task 18: AI 逾時 180 秒 + AI 設定全站共用 (0.6.0-dev.2)
- **Status**: IMPLEMENTED — 閘門全綠（lint 3 個既有 warning / test 260 passed / build 通過）；
  **待測試區重新套用 schema §4.1（已改版）＋貼 admin tag ＋實測**（需使用者執行）
- **Planner / Implementer / Reviewer**: Claude
- **Timestamp**: 2026-07-27 09:52:26 Asia/Taipei

#### 內容
1. **逾時 30s→180s**：`aiClient.ts` 新增 `AI_TIMEOUT_MS = 180_000`，UI 字樣由它推導。
2. **AI 設定全域化**：`user_settings.ai_*`（每帳號）→ `app_settings` 全域單列（不分帳號/工作區）。
   全員可讀（前端直連需金鑰），寫入僅限 `app_metadata.role = 'admin'`（tag 可隨時指定任何帳號，
   不綁死 email；貼完要重新登入）。非管理員 UI 為唯讀。
3. 詳細記錄與線上套用步驟見 PROGRESS.md 2026-07-27 09:52。

#### 對 Task 17 的影響
Task 17 的待辦「正式區套用（舊版）§4.1」**作廢**：schema §4.1 已改版為 app_settings 方案，
兩區日後一律套新版；測試區也要重套（會 DROP 舊欄位，已存的個人設定作廢重填）。

### Task 17: AI 助理 —— 個股分析「AI 解讀」分頁 (0.6.0-dev.1)
- **Status**: IMPLEMENTED — 程式碼完成、Claude 審查與修正完畢、閘門全綠
  （lint 3 個既有 warning / test **258 passed** / build 通過）；
  **待兩區套用 `schema.sql` §4.1 與線上實測**（需使用者授權）。規格見 `PLAN.md §M`
- **Planner / Reviewer**: Claude
- **Implementer**: agy (`gemini-3.6-flash-high`)
- **Timestamp**: 2026-07-26 23:40:00 Asia/Taipei

#### 使用者定案的決定
- UI：個股分析頁新增「AI 解讀」分頁籤（與 籌碼 / 技術面 / 我的持股 並列）
- 金鑰：存 Supabase `user_settings` 新欄位（**非** localStorage）
- 連線：**第一版只做前端直連**，Edge Function 代理留 0.6.1
- payload：技術面摘要 ＋ 籌碼 7 日摘要，**不含持股與成本**

#### Objective 目標
把「模型不碰原始序列、指標由程式算好」的設計落成可用功能：使用者自帶 AI 供應商，
在個股分析頁按一下取得該檔的技術面＋籌碼白話摘要。

#### Scope 範圍 / 允許異動的檔案
- 新增：`src/services/aiSettings.ts(+test)`、`src/services/aiClient.ts(+test)`、
  `src/components/StockDetail/aiPayload.ts(+test)`、`src/components/StockDetail/AiTab.tsx(+test)`
- 修改：`src/components/StockDetail/StockDetailPage.tsx(+test)`、`src/index.css`、
  版號三處（`src/version.ts`、`package.json`、`package-lock.json`）、`README.md`
- **已由 Claude 完成、不得再動**：`sources/supabase/schema.sql` §4.1

#### Constraints 限制
1. **不引入任何新的 npm 依賴**（只用 `fetch`；不得裝 `@google/generative-ai`、`openai` 等 SDK）。
2. **不動 `TechnicalTab.tsx` / `ChipsTab.tsx` / `HoldingTab.tsx` / 任何 Edge Function / `schema.sql`。**
3. 未設定 provider 時**不得產生任何 AI 文字**（產品紅線，PLAN.md §M1.3）。
4. 不做串流、不做多輪對話、不把持股成本放進 payload、不支援本機模式。
5. 所有可測邏輯抽成純函式（`normalizeBaseUrl` / `mapHttpError` / `extractGoogleText` /
   `extractOpenAiText` / `buildAiPayload` / `renderAiPrompt`），網路呼叫用 `vi.stubGlobal` 測，
   **不得在測試中真的打外部端點**。
6. 文案依 PROGRESS.md 2026-07-21 16:05 的準則：白話短句、不放公式、不用內行黑話。

#### Acceptance criteria 驗收條件
- [ ] 兩支 adapter 各自可用：`google`（`x-goog-api-key`）、`openai-compatible`（`Bearer`，金鑰空則省略 header）
- [ ] `normalizeBaseUrl` 對 `http://h:11434`、`http://h:11434/`、`http://h:11434/v1`、`http://h:11434/v1/` 四種輸入都產出同一個 `/v1/chat/completions`
- [ ] payload **明寫單位**（三大法人＝股數、融資融券＝張），並有測試鎖住單位標籤
- [ ] payload **不含** `holding` / `avgCost` / `unrealized`，有測試斷言
- [ ] 逾時 30 秒（`AbortController`）；錯誤分類 auth / rate-limit / server / timeout / network / bad-response 各有白話訊息；`network` 訊息提到 CORS 與 `OLLAMA_ORIGINS`
- [ ] 不自動重試，只有「重試」按鈕
- [ ] 未設定 provider → 分頁顯示設定表單，且畫面無任何 AI 生成文字
- [ ] 結果區有免責聲明（非投資建議）
- [ ] `npm run test` 全綠（基準 221 passed，新增測試後應 > 240）、`npm run build` 通過、`npm run lint` warning 不超過既有 3 個
- [ ] 1280px / 390px 無水平溢出

#### Verification method 驗證方式
`cd sources && npm run lint && npm run test && npm run build`（由 **Claude 親自跑**，不採信自述）；
Claude 另審 diff（§9）。線上驗證需先在兩區跑 `schema.sql` §4.1（需使用者授權）。

#### 驗收結果（Claude，2026-07-27 00:05）
- [x] 兩支 adapter、`normalizeBaseUrl` 四種輸入、payload 單位標籤、payload 不含持股、
      逾時與六類錯誤、不自動重試、未設定無 AI 文字、免責聲明 —— 全部達標
- [x] 閘門親跑：lint 3 warning（未增加）、test **258 passed**（基準 221）、build 通過
- [x] 未動禁區：`supabase/functions/`、`TechnicalTab` / `ChipsTab` / `HoldingTab`、無新增 npm 依賴
- [x] **測試區已套用 `schema.sql` §4.1 並驗證**（2026-07-27 00:30，六項檢查全通過，詳見 PROGRESS.md）
- [ ] **正式區尚未套用 §4.1** —— 需使用者明確指示（CLAUDE.md §14.2）
- [ ] 瀏覽器實測（1280 / 390px 與實際呼叫 AI）—— **需登入測試區帳號**，待使用者

#### Claude 審查抓到並修正的問題（5 項）
1. **漲跌幅小 100 倍**（正確性，最嚴重）：`latest.changePct` 是小數比例（0.0148），
   agy 直接接 `%` 印進 prompt。已改為 `changePctPercent`（×100）並以測試釘住。
2. **連續天數的正負號沒說明**：`ChipStreaks` 正＝連買、負＝連賣，只給數字會讓模型把
   `-3` 讀成「增加 -3 天」。已加 `streakNote` 並寫進 prompt。
3. **三大法人只給了買賣超**，漏掉委派單要求的買進 / 賣出拆項與外資自營商。已補齊。
4. **逾時沒包住讀 body**：`fetch` 收到 headers 就 resolve，原本在那之後就 `clearTimeout`，
   「headers 來了但 body 卡住」等於無逾時保護。已改為 `requestJson` 在同一計時器內讀完 body
   （補這條測試時又抓到自己第一版把 body 階段的 `AbortError` 誤分類成 `bad-response`，一併修正）。
5. **CSS 兩處**：`var(--shadow)` 這個 token 不存在（專案用 `--shadow-card`）；
   `.ai-result` 硬寫 `rgba(0,0,0,0.12)` 在淺色主題會變濁灰塊，改用 `var(--surface)`。

修正由 Claude 親自進行（§2.5：集中在 2 個檔案約 60 行、判斷密集，往返成本高於自己動手）。

### Task 16: 技術面 K 線與指標 (0.5.0-dev.1)
- **Status**: DONE（程式碼、驗證、兩區部署皆完成；**線上日線資料待觸發一次批次**）
- **Planner / Implementer**: Claude
- **Timestamp**: 2026-07-26 10:40:00 Asia/Taipei（狀態更新於 2026-07-26 23:04:00）
- **計畫檔**: ~~`~/.claude/plans/k-ai-toasty-pearl.md`~~ **已遺失**（2026-07-26 查核）；
  0.6.0 的殘存資訊見 PLAN.md §6 與本條「使用者定案的決定」

#### Objective
把 `TechnicalTab` 從佔位頁換成真實內容：日 K + 均線、成交量、KD、指標摘要。
這同時是 0.6.0 AI 助理的資料地基 —— 指標必須由程式算好，模型只負責解讀。

#### 使用者定案的決定
- 歷史股價存 **Storage 每檔一份 JSON**（非 `price_daily` 資料表）
- 分兩版交付：**0.5.0 先 K 線、0.6.0 再 AI**
- （0.6.0 用）AI 供應商自帶，介面須 provider-agnostic；直連與 Edge Function 代理**兩者都支援**

#### Scope / Allowed Changes
- 新增：`twDaily.ts(+test)`、`indicators.ts(+test)`、`technicalView.ts(+test)`、
  `dailyProxy.ts(+test)`、`reportsBucket.ts`、`CandleChart.tsx`、`MultiLineChart.tsx`、`chartPath.ts`
- 修改：`stock-report/index.ts`（`syncDaily`）、`TechnicalTab.tsx`、`StockDetailPage.tsx(+test)`、
  `chartFrame.tsx`（僅加選用的 `labelIndices`）、`BarSeriesChart.tsx`、`LineSeriesChart.tsx`、
  `reportProxy.ts`、`index.css`、版號三處、`docs/agent/*`、`README.md`、`supabase/README.md`

#### Acceptance Criteria
- [x] 指標以完整序列計算後才裁切（切「近 3 月」時 MA60 仍畫得出來）—— 純函式 + 測試 + 瀏覽器三重驗證
- [x] Yahoo 日期換算加 `gmtoffset`，並以 UTC+9 反例測試釘住
- [x] 五欄全 null 的假日格丟棄而非補 0
- [x] `schema >= MIN` 守門並以測試釘住（0.4.1 教訓）
- [x] `npm run test` 182 → 221 passed、`build` 通過、`lint` 維持 3 warning
- [x] 數字以獨立實作交叉驗證（MA/KD/RSI/量能比全部相符）
- [x] 1280 / 390px 無水平溢出
- [x] **Supabase 部署**：正式區 `stock-report` v5、測試區 v8（2026-07-26，使用者授權後執行）
- [x] **線上驗證通過**（2026-07-26 23:15，使用者觸發 `generate-all` 後 Claude 實測）：
      兩區 `daily/*.json` 全數 HTTP 200、`schema 1`、`lastDate 2026-07-24`、無 null / 無週末、
      OHLC 與日期序列檢查全通過；兩區同代號 `rows` 逐值相同。**Task 16 至此全部完成。**

### Task 15: 個股分析獨立成頁（下拉切換）、移除服務狀態 (0.3.8-dev.1)
- **Status**: DONE
- **Planner**: User（指定兩項異動與版號）
- **Implementer**: Claude
- **Timestamp**: 2026-07-26 00:30:00 Asia/Taipei

#### Objective
(1) 服務狀態功能全部取消。(2) 個股分析從庫存總覽的下鑽檢視改為獨立導覽分頁，頁內以下拉選單切換持股。

#### 使用者定案的決定
- 庫存總覽的「分析」按鈕**完全移除**（不保留捷徑）
- 下拉選單**只列台股持股**
- 服務狀態頁的 **GitHub 連結搬到頁尾免責聲明下方**；專案簡介文案不保留

#### Scope / Allowed Changes
- 刪除：`components/ServiceStatus/`、`services/serviceHealth.ts(+test)`、`index.css` 的服務狀態區塊
- 新增：`components/StockDetail/AnalysisPage.tsx(+test)`、`utils/holdingRows.ts(+test)`
- 修改：`AppShell.tsx`、`DashboardPage.tsx`、`StockDetailPage.tsx(+test)`、`App.smoke.test.tsx`、
  `twMarketData.ts`、`priceProxy.ts`、`version.ts`、版號三處、`README.md`、`docs/agent/*`

#### Acceptance Criteria
- [x] `src/` 對服務狀態相關關鍵字零命中；`.status-*` / `.uptime-*` 樣式全數移除且未誤刪共用樣式
- [x] 頁尾含 GitHub 連結且位於免責聲明**下方**（smoke test 以 DOM 順序斷言）
- [x] 個股分析為獨立分頁；下拉只列台股；切換即換內容；無台股持股時有空狀態
- [x] 本機模式隱藏該分頁
- [x] 庫存總覽已無「個股分析」欄
- [x] `npm run test` 170 passed / build / lint（warning 由 4 降到 3）

#### 不需要動 Supabase
純前端呈現層改動，報告 JSON 結構與 Edge Function 完全不變。

---

### Task 16: 盤後批次分段執行 + 逐區塊資料時間 (0.4.0)
- **Status**: DONE
- **Planner**: User（提議「能更新的先更新，並標註更新時間」）
- **Implementer**: Claude
- **Timestamp**: 2026-07-26 02:10:00 Asia/Taipei

#### Objective
各資料源公布時間差 6 小時以上，改為分段執行讓早就緒的先上；並讓使用者看得出每塊資料各自多新。

#### 關鍵發現
- 「跑多次逐步補齊」**不需要新機制** —— `generate-all` 本來就冪等且自我補完。
- 「逐項更新時間」**資料早就存在** —— `chip_raw_cache.updated_at`。
- 但分段執行會把借券的既有坑從偶發變必然（端點無日期欄位、早班的錯資料會被後續班次沿用）。
  解法是改用自帶 `title` 日期的 rwd 端點，以資料自己宣告的日期為快取鍵。

#### Acceptance Criteria
- [x] cron 分三段（17:30 / 22:30 / 23:30 台北）
- [x] 報告 `sources` 逐項記錄資料日與抓取時間（schema 3）
- [x] 前端逐區塊顯示；融資融券未到的文案改為「尚未公布」而非「無回應」
- [x] 借券以自己宣告的日期為快取鍵（實測 `SBL_D` 存在 20260727 而非 20260724）
- [x] 舊格式（schema 2、無 sources）不會炸
- [x] test 170 → 182 passed / build / lint 無新增 warning

#### Outstanding
第一次三段式自動執行為 2026-07-27（週一）。預期 17:30 那班 `sources.margin` 為 null、稍晚補齊。

---

### Task 14: 移除基本面（EPS）、版號格式與徽章精簡 (0.3.7-dev.6)
- **Status**: DONE
- **Planner**: User（明確指示取消 EPS）
- **Implementer**: Claude
- **Timestamp**: 2026-07-25 23:10:00 Asia/Taipei

#### Objective
(1) 移除 EPS / 基本面全部實作。(2) 版號一律不帶 `v` 前綴。(3) 版本徽章不再顯示作者。

#### 執行摘要
- `git revert ec12206` 回退 Task 13（基本面）全部程式碼與文件，含 `schema.sql` 的第 7 段。
- **Supabase 端回退是必要而非選項**：部署中的函數回 schema 3，而回退後的前端只接受 `=== 2`，
  Storage-first 與即點即產兩條路都會被判為不支援 → 籌碼頁會整個壞掉。故一併：
  重新部署 `stock-report`、重跑 `generate-all` 覆寫 Storage 回 schema 2、
  `DROP TABLE stock_fundamentals`（1070 列公開資料）、清掉 `chip_raw_cache` 的
  `BWIBBU` / `STOCK_DAY_AVG` 兩筆。
- `CLAUDE.md §17` 改為「一律不帶 `v` 前綴」；`APP_AUTHOR` 常數整個移除；
  smoke test 加上「不以 v 開頭、不含作者」的斷言，讓規則有測試把關而非只寫在文件。

#### Acceptance Criteria
- [x] `src/` 與 `supabase/` 對 `EPS|fundamental|每股盈餘|本益比|BWIBBU` 零命中
- [x] dev 專案實測 2330 / 0050 皆回 `schema 2`、無 `fundamentals` 欄位；`stock_fundamentals` 已不存在
- [x] `chip_raw_cache` 只剩 `MI_MARGN, MI_MARGN_D, SBL, T86` 四個 dataset
- [x] 徽章只顯示 `0.3.7-dev.6`（不帶 `v`、不含作者）
- [x] `npm run test` 159 passed / build / lint 全過
- [x] 籌碼功能（7 日 history、走勢圖、逐日檢視、法人並排）未受影響

#### 備註：Task 13（基本面）已作廢
實作與文件全數回退，`PLAN.md` 的 §M–§Q（資料源實測結果）也隨之移除。
若日後要重做，端點清單、五張產業表的差異、2330 fixture 等實測資料都留在
**commit `ec12206`** 裡，`git show ec12206` 即可取回，不必重新推導。

---

### Task 12: 籌碼逐日檢視 + 法人並排比較 (v0.3.7-dev.4)
- **Status**: DONE
- **Planner / Implementer**: Claude（需求由使用者提出）
- **Timestamp**: 2026-07-25 16:45:00 Asia/Taipei
- **Target Version**: v0.3.7-dev.4

#### Objective
(1) 三大法人表格能回看 7 天中任一天的資料。(2) 買賣超圖能同時比較各法人，並在右側空白處以圖例標明顏色對應。

#### Scope / Allowed Changes
- `Charts/`：`BarSeriesChart.tsx`（多序列並排）、`ChartLegend.tsx`（新增）、`chartColors.ts`（類別色）
- `StockDetail/`：`ChipsTab.tsx`（日期鈕 + 並排模式 + 圖例）、`chipStreak.ts`（新增）、`chipFormat.ts`（`fmtUpdatedAt`）
- `StockDetailPage.tsx`（頁首不重複資料日期）、`index.css`、版號三處、`README.md`、`docs/agent/*`

#### Acceptance Criteria
- [x] 三大法人表格可切換 7 天中任一天，「連買連賣」隨所看日期重算
- [x] 「全部（並排）」模式：四個法人各一類別色，右側圖例標明對應並顯示最近交易日約當張數
- [x] 單一法人模式維持紅正綠負，圖例改為說明買超 / 賣超
- [x] 合計不與其組成並排（避免重複計算）
- [x] 配色以 `validate_palette.js` 實測通過淺底與深底（非憑感覺挑色）
- [x] `npm run test` 150 → 159 passed；build 通過；lint 無新增 warning

#### Verification
瀏覽器實測（Playwright，臨時 harness 驗完刪除）：7 個日期鈕、圖例 4 項、並排 7×4=28 根長條、
切單一法人後 7 根且圖例改語意、切日期後表格與連買連賣同步重算、多序列 tooltip 一次列出四個法人、
PDF 實跑成功（453KB）、390px 無水平溢出。

---

### Task 11: 盤後籌碼報告 v2 —— 個股分析頁 + 籌碼走勢圖 (v0.3.7-dev.3)
- **Status**: DONE
- **Planner / Implementer / Reviewer**: Claude
- **Timestamp**: 2026-07-25 15:20:00 Asia/Taipei
- **Target Version**: v0.3.7-dev.3
- **Plan**: `docs/agent/PLAN.md` §「盤後籌碼報告 v2」（架構決策 A–J）

#### Objective
三大法人與融資融券各自拆成 買進 / 賣出 / 買賣超 / 連買連賣，保留 7 天並附走勢圖；
版面由彈窗改為獨立「個股分析頁」（籌碼 / 技術面 / 我的持股 分頁籤）。

#### Scope / Allowed Changes
- `sources/supabase/functions/stock-report/`：`twChips.ts`（ChipLeg、`extractMarginDated`）、
  `report.ts`（ChipDay、schema 2、`computeStreak(s)`、`isWeekendYmd`）、`index.ts`（`loadSeries` 回補）、
  **刪除** `reportHtml.ts`
- `sources/src/services/reportProxy.ts`（結構化型別、schema 守門）、`reportPdf.ts`（`.report-surface` 切換）
- `sources/src/components/Charts/`（新增）、`sources/src/components/StockDetail/`（新增）
- `sources/src/components/AppShell.tsx`（detail 下鑽 state）、`Dashboard/DashboardPage.tsx`（`onOpenDetail`）、
  **刪除** `Dashboard/ReportModal.tsx`
- `sources/src/index.css`、版號三處、`README.md`、`sources/supabase/README.md`、`docs/agent/*`

#### Constraints
- 不引入圖表函式庫（自繪 SVG）；不新增任何 npm 依賴。
- 不主動部署或異動任何 Supabase 環境（CLAUDE.md §18）。
- 無 schema migration：新的 `MI_MARGN_D` dataset 沿用現有 `chip_raw_cache`，`RETAIN_DAYS = 7` 不變。

#### Acceptance Criteria
- [x] 三大法人 5 列 × 買進 / 賣出 / 買賣超 / 約當張數 / 連買連賣
- [x] 融資融券含 買進 / 賣出 / 償還 / 今日餘額 / 較前日 / 連增連減，並標示「賣出＝放空、買進＝回補」
- [x] 近 7 日買賣超長條圖（可切換法人）＋ 融資 / 融券餘額折線圖（不共用 Y 軸）
- [x] 伺服器不再回 HTML；前端遇 `schema !== 2` 走即點即產 fallback
- [x] 單次回補上限 5 天，不足時 `notes[]` 說明且圖照常出
- [x] 深色主題下載的 PDF 仍為淺色文件
- [x] `npm run test`（113 → 148 筆）/ `npm run build` / `npm run lint` 全過，無新增 lint warning

#### Verification
- 單元測試：T86 買進/賣出與自營商加總、`extractMarginDated` 位置索引（2330 實測列 fixture）、
  `computeStreak` 邊界（遇 0 / null 中斷）、`niceDomain` 跨零與全零、`fetchStoredReport` 舊格式視為未命中。
- 元件測試 `StockDetailPage.test.tsx`：分頁切換、圖表數量、法人切換重繪、PDF 按鈕僅籌碼頁、兩條資料路徑。
- 瀏覽器（Playwright，臨時 preview harness 驗完即刪）：1280px / 390px 無水平溢出、
  hover tooltip 內容與定位、`.report-surface` 淺色容器、實際跑一次 `generatePdfBlob` 成功（388KB）、
  本機模式回歸（分析入口隱藏、導覽切換無錯）。

#### Supabase 部署（已完成，使用者明確授權）
- [x] `supabase functions deploy stock-report --no-verify-jwt` → dev 專案 `wqetxuhncvfidqnklyew`
      version 1 → 2、`verify_jwt` true → false。正式區未觸碰。
- [x] 線上實測 2330 真實資料：schema 2、無 `html`、第一次 5 天 / 第二次 7 天（回補機制有效）、
      融資融券走新 `rwd` 端點、與 PLAN.md §C 的 fixture 交叉驗證一致。詳見 `PROGRESS.md`。
- [x] 實證無需 schema migration：`MI_MARGN_D` 正常寫入 `chip_raw_cache`。

- [x] **補上 dev.2 遺留缺口**：dev 專案原本沒有 `reports` bucket / `CRON_SECRET`（盤後自動產報從未啟用）。
      已設 `CRON_SECRET`、套用 schema.sql §6（只套 §6），驗證 bucket public、`pg_cron`/`pg_net` 已啟用、
      cron job `30 12 * * 1-5` active。
- [x] 手動觸發 `generate-all` → `generated 3/3`、`historyDays 7`；bucket 內 `manifest.json` +
      3 份約 5KB 的 schema 2 JSON（無 `html`、`holding: null`、7 天 history 齊全）。
- [x] **Storage-first 效能實測**：0.8 秒 vs 即點即產 8 秒（約 10 倍）。

#### Outstanding
- 夜間排程尚未經歷一次自動觸發（每週一~五 12:30 UTC / 台北 20:30）。
- 未在瀏覽器走完整 Supabase 登入流程（需帳密），改以 curl 打真實端點 + jsdom 元件測試涵蓋。

---

### 補記（無 Task 編號）: 盤後籌碼報告 v1 (v0.3.7-dev.1 / dev.2)
- **Status**: DONE（實作於 038cdd8 / 9d62546，當時未建 TASK 條目，此處補記）
- **Implementer**: Claude
- **Timestamp**: 2026-07-24（dev.1）、2026-07-25（dev.2）

#### 摘要
- **dev.1**：新增 Edge Function `stock-report`，抓 TWSE 盤後籌碼（三大法人買賣超、融資融券、借券），
  於庫存總覽台股列以彈窗（`ReportModal`）顯示 Edge Function 產生的 HTML，可下載 PDF。
  新增 `chip_raw_cache` 依交易日共用快取；Supabase 檔案集中至 `sources/supabase/`。
- **dev.2**：新增 `generate-all` 批次 + `pg_cron` 每交易日 20:30 產出共用報告存入 `reports` bucket，
  前端改 Storage-first，保留 7 天並清理舊檔。
- **已被 Task 11 取代的部分**：HTML 產生路線（`reportHtml.ts`）、`ReportModal`、前端 `applyHoldingOverlay` 疊加。

---

### Task 10: 庫存總攬面板縮小為主副層級式 (v0.3.6)
- **Status**: DONE
- **Planner**: Claude（縮小方式經使用者選定「主副層級式」）
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-22 15:40:00 Asia/Taipei
- **Target Version**: v0.3.6

#### Objective
v0.3.5 的台股/美股雙面板過大（三個 24px 大數字直向堆疊）。改為主副層級：持倉市值當主角（22px），投入總成本與未實現淨損益縮小（16px）並排成 `.metric-row` 左右兩欄，面板高度約砍至 190px。

#### Scope / Allowed Changes
- `sources/src/components/Dashboard/DashboardPage.tsx`（`.metric-hero` + `.metric-row` 容器結構，三態邏輯與文案不變）
- `sources/src/index.css`（`.market-panel` 系列；`.kpi` 系列不動）
- `sources/package.json`
- `sources/src/version.ts`

### Task 9: Dashboard 庫存總攬改版為台美股雙面板 (v0.3.5)
- **Status**: DONE
- **Planner**: User
- **Implementer**: Gemini
- **Timestamp**: 2026-07-22 15:20:00 Asia/Taipei
- **Target Version**: v0.3.5

#### Objective
將 Dashboard 庫存總覽的 4 張單一 KPI 卡片改版為「台股/美股」兩張並排玻璃面板，面板內部採直向堆疊指標：持倉市值、投入總成本（含未含費）、未實現淨損益（含未含費）。

#### Scope / Allowed Changes
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/index.css`
- `sources/package.json`
- `sources/src/version.ts`

### Task 8: Add a GitHub-Status-style 服務狀態 page and retire the floating version badge (v0.3.0)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 14:45:00 Asia/Taipei
- **Target Version**: v0.3.0

#### Objective
加入 ServiceStatusPage 以顯示系統運作狀態、API 健康檢測與快取資訊。同時移除過時的畫面浮動版本標章。

### Task 7: 年度明細下放手續費/交易稅拆分 (v0.2.8)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 15:30:00 Asia/Taipei
- **Target Version**: v0.2.8

#### Objective
將 v0.2.7 新增的 summary 層級交易稅估算下放到年度表格的各個層級（年度、個股、逐筆明細），並調整相關 KPI 標籤。

#### Scope / Allowed Changes
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/package.json`
- `sources/src/App.tsx`

### Task 6: 歷史累計手續費拆分 (v0.2.7)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 14:05:00 Asia/Taipei
- **Target Version**: v0.2.7

#### Objective
將年度收益頁面的歷史累計手續費 KPI，透過稅率預估反推，拆分為「手續費」與「交易稅」。

#### Scope / Allowed Changes
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/package.json`
- `sources/src/App.tsx`

### Task 1: 專案目錄結構與 GEMINI.md 記憶體調整
- **Status**: DONE
- **Allowed Changes**: `docs/`
- **Verification**: `docs/agent/` 目錄建立且包含完整紀錄檔，`docs/architecture/` 與 `docs/database/` 文件歸位。

### Task 2: GitHub Pages CI/CD 自動化建置
- **Status**: TODO
- **Allowed Changes**: `.github/workflows/`
- **Acceptance Criteria**: Commit 至 `main` 自動 trigger build 並產出靜態網站至 GitHub Pages。

### Task 3: Supabase 後端上線與 Edge Function 部署
- **Status**: TODO
- **Allowed Changes**: `sources/supabase/`
- **Acceptance Criteria**: 提供標準指令說明或輔助執行 Supabase 部署與 `.env.local` 綁定。

### Task 5: 年度收益頁面改版與明細展開 (v0.2.6)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 12:03:00 Asia/Taipei
- **Target Version**: v0.2.6

#### Objective
移除年度收益頁面的排序功能，加入第三層的逐筆賣出明細（移動平均成本口徑），並在 KPI 區塊顯示買/賣筆數拆分。

#### Scope / Allowed Changes
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/components/Common/HelpTh.tsx`
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/index.css`
- `sources/package.json`
- `docs/agent/SPEC.md`, `docs/agent/PROGRESS.md`, `docs/agent/TASK.md`

### Task 4: 交易紀錄搜尋欄位（代號 / 名稱快速過濾）
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: Gemini
- **Timestamp**: 2026-07-21 09:58:00 Asia/Taipei
- **Target Version**: v0.2.5

#### Objective

在「交易紀錄」頁工具列新增搜尋輸入框，輸入代號或名稱關鍵字即時過濾交易列表，
快速找到特定股票的交易資訊。

#### Scope / Allowed Changes

- `sources/src/components/Transactions/TransactionsPage.tsx` — 加入搜尋輸入框與過濾接線
- `sources/src/components/Transactions/txSearch.ts` — **新檔**：純函式過濾邏輯（可獨立單元測試）
- `sources/src/components/Transactions/txSearch.test.ts` — **新檔**：單元測試
- `sources/src/App.smoke.test.tsx` — 新增 UI 整合測試（或另建 `TransactionsPage.test.tsx`）
- `sources/src/index.css` — 若需要搜尋框樣式（沿用既有 `.btn` / toolbar 風格，盡量少改）
- `sources/package.json` — 版本號 bump 至 `0.2.5`
- **不得修改**：`dataProvider.ts`、`WorkspaceContext.tsx`、資料模型、Supabase 相關檔案；不得新增依賴套件

#### Functional Spec

1. **搜尋框位置**：工具列（`.section.toolbar`）內、「刪除選取」之後、`.spacer` 之前，
   placeholder：`搜尋代號或名稱`，附清除按鈕（X），輸入框需有 `aria-label="搜尋交易"`。
2. **比對規則**（純前端、即時過濾，不需 debounce——資料在記憶體中）：
   - 關鍵字先 `trim()`；空字串 = 不過濾（顯示全部）。
   - 代號：不分大小寫的**子字串**比對（`"233"` 命中 `2330`、`"aapl"` 命中 `AAPL`）。
   - 名稱：子字串比對，需同時比對**原始 `tx.name`** 與 **`displayStockName(market, ticker, name)`**
     ——美股顯示層是中文譯名（如 AAPL → 蘋果），使用者搜「蘋果」或「Apple」都要命中。
   - 單一關鍵字命中代號**或**名稱任一即顯示該列。
3. **過濾時機**：在既有 `sorted` useMemo 之前先過濾（filter → sort），排序功能照常作用於過濾後結果。
4. **筆數提示**：過濾中時顯示「顯示 X / Y 筆」（Y = 全部交易數）。
5. **與勾選 / 批次刪除的互動**：
   - 過濾改變時**保留**既有勾選狀態（不清空）。
   - 「全選」只作用於目前可見（過濾後）的列——既有 `toggleAll` 以 `sorted` 為準，行為天然正確。
   - 「刪除選取（n）」的 **n 與實際刪除範圍 = 勾選且目前可見**的交易
     （既有 `handleDeleteSelected` 已是 `sorted.filter(selected)`，但按鈕顯示的
     `selected.size` 需改為可見勾選數，避免數字與實際刪除筆數不一致）。
6. **無結果狀態**：有交易但搜尋無命中時，顯示「找不到符合「{關鍵字}」的交易」＋清除搜尋按鈕；
   與「尚無交易紀錄」空狀態區分，工具列維持顯示。
7. **CSV 匯出不受過濾影響**：維持匯出全部交易（既有行為，需在 code review 確認未被改動）。
8. **切換工作區時清空搜尋字串**（比照勾選清空的既有 useEffect）。

#### Non-Goals

- 不做多關鍵字 / 進階語法（AND、市場篩選、日期區間）。
- 不做遠端搜尋（`stockSearch.ts` 是新增交易用的股票查詢，與本功能無關，勿混用）。
- Dashboard / 年度收益頁不加搜尋（未來另開任務）。

#### Test Items（驗收必備）

**單元測試 `txSearch.test.ts`（純函式 `filterTransactions(txs, query)`）**

| # | 案例 | 預期 |
| - | ---- | ---- |
| U1 | 空字串 / 全空白關鍵字 | 回傳全部交易 |
| U2 | 代號部分比對 `"233"` | 命中 `2330` |
| U3 | 代號不分大小寫 `"aapl"` | 命中 `AAPL` |
| U4 | 名稱子字串 `"台積"` | 命中名稱「台積電」 |
| U5 | 美股中文譯名 `"蘋果"`（tx.name 為 `Apple Inc.`） | 透過 displayStockName 命中 AAPL |
| U6 | 美股原始名稱 `"apple"`（不分大小寫） | 命中 tx.name `Apple Inc.` |
| U7 | 無任何命中 `"9999"` | 回傳空陣列 |
| U8 | 關鍵字前後空白 `"  2330  "` | 與 `"2330"` 結果相同 |

**UI 整合測試（jsdom + testing-library，比照 App.smoke.test.tsx 的本機模式流程）**

| # | 案例 | 預期 |
| - | ---- | ---- |
| I1 | 建立 2330 台積電與 AAPL 兩筆交易後輸入「台積」 | 表格只剩台積電列，顯示「顯示 1 / 2 筆」 |
| I2 | 點清除按鈕 | 恢復顯示全部列，筆數提示消失 |
| I3 | 輸入無命中關鍵字 | 顯示「找不到符合…」訊息，且**不是**「尚無交易紀錄」空狀態 |
| I4 | 過濾中點「全選」 | 只勾選可見列；清除搜尋後另一筆未被勾選 |
| I5 | 勾選 2 筆後過濾到只剩 1 筆可見，點「刪除選取」 | 按鈕顯示（1）、只刪除可見那筆，另一筆仍存在 |
| I6 | 過濾中點「代號」排序 | 排序作用於過濾後結果，不出錯 |
| I7 | 切換 / 新建工作區 | 搜尋框自動清空 |

**回歸驗證**

- `npm test`（既有 68 筆測試全數通過 + 新增測試）
- `npm run lint`、`npm run build` 無錯誤
- 以 `/verify` skill（Playwright 本機模式）人工走一次 I1–I3 流程

#### Acceptance Criteria

- [x] 上表 U1–U8、I1–I7 測試全部撰寫並通過
- [x] 既有測試無任何退步
- [x] 過濾邏輯集中於 `txSearch.ts` 純函式，UI 層只負責接線
- [x] 未修改 Scope 以外的檔案、未新增依賴
- [x] `package.json` 版本 bump 至 0.2.5，commit message 格式：`feat(transactions): add search filter (v0.2.5)`
