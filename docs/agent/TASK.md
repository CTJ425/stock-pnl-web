# Task Backlog & Tracking (TASK.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-09-09 18:05:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-11 13:03)

- **Version 0.9.45 — merged to `main`, not yet uploaded.** `main` and `dev` are synchronized at `0.9.45`; Cloudflare Pages still serves 0.9.44 until the manual upload (README step 9-1).
  - Shipped 2026-09-11: 手機與桌機介面第一批改善（0.9.45, Task 158/159 batch 1）。
  - Shipped 2026-09-10: 查無檔案被當成錯誤、即時產生因此永遠不會執行（0.9.44, BUG-078）、非持股股票日線區間讀不到（0.9.43, BUG-077）、行情走勢圖擴充為八個區間（0.9.42）、技術面 K 線圖擴充為六個區間與 Edge `daily` action（0.9.41）、Edge 台股清單完整性檢查（0.9.40）。
  - Verification: 117 test files / **1,864** vitest tests, exit 0 **且無 unhandled error**; `npm run build` exit 0; `npm run typecheck:edge` exit 0.
  - Edge Functions: `stock-price` is **v7** on both environments (deployed 2026-09-10 from commit `c4a8b9e`, `ezbr_sha256` `253e6c3d25d6e7ac…` — **identical sha on DEV and PROD**), `stock-report` is **v8**, `backup-transactions` is **v4**.
  - **前端沒有自動部署。** 手動 `npm run build` 後上傳 `sources/dist/` 到 Cloudflare Pages（PROD `site_url` = `https://stock-pnl-web.pages.dev/`）。流程寫在 `README.md` 步驟 9-1。合併 `main` 不等於上線，驗收看畫面左下角版本徽章。
  - Known and not done: Task 144 的資源用量監控與 R2 多目標備份（皆未動工）；Task 85 只有 `borrow` 一個視窗完成重調；`成交金額` / `昨量` 仍缺資料來源；end-to-end Playwright run for the 融券 flow；`.inst-matrix tfoot td` hardcoded white overlay inverted under light theme。

## 📋 Active Tasks

### Task 159: Desktop and general UI/UX fixes
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-11 12:37:31 Asia/Taipei
- **Done**: items D2, D4, D6, D8, D9, D11, D12 (0.9.45) — full text in `TASK_ARCHIVE.md`.
- **Spec**: `docs/design/desktop-ux-audit.html` (item numbers D1–D15 match the report)
- **What is this**: Audit measured at 1440×900 and 1024×768, light + dark theme, local mode, 0.9.44. Batch 1 shipped in 0.9.45 = D2, D4, D6, D8, D9, D11, D12, plus the title half of D1 and the 「Active 持股」 half of D13. Side finding recorded as BUG-079.

- D1. Page switch does not change the URL (stays `/`). The `document.title` half shipped in 0.9.45 (「<頁名> · 股票小幫手」). — ⏳ batch 2
- D3. 5 native `confirm()` calls; no undo after delete. — ⏳ batch 2
- D5. 7 error messages append raw Supabase `error.message` (`dataProvider.ts:281–360`). — ⏳ batch 2
- D7. Holdings rows carry ~20 numbers (未含費 / 淨收 / 券商 sub-lines). — ⏳ batch 3
- D10. At 1024 px the holdings table is 1,023 px wide in a 974 px box. — ⏳ batch 3
- D13. Terminology: 工作區 (16) / 帳戶 (5) / 投資組合. 「Active 持股」→「目前持股」 shipped in 0.9.45; the account noun needs a user decision. — ⏳ user decision
- D14. 20 help buttons sit in the Tab order before table content. — ⏳ batch 3
- D15. 11 components format numbers with `toFixed()` instead of `utils/formatters.ts`. — ⏳ batch 3

### Task 158: Mobile UI/UX fixes from the iPhone 13 mini audit
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-11 12:37:31 Asia/Taipei
- **Done**: items 2, 5, 6, 9, 15, 16 (0.9.45) — full text in `TASK_ARCHIVE.md`.
- **Spec**: `docs/design/mobile-ux-audit-iphone13mini.html` (item numbers 1–17 match the report)
- **What is this**: Audit measured at 375×629 (Playwright `iPhone 13 Mini`, local mode, 0.9.44). Batch 1 shipped in 0.9.45 = items 2, 5, 6, 9, 15, 16. Item 8 deferred (needs a real iPhone); item 11 re-scoped (see item). Batches 2–3 = the rest.

1. Holdings / transactions / yearly tables show 33–40% of their width at 375 px; P&L is columns 9–10. Card list at ≤560 px. — ⏳ batch 2
3. Tap targets under 44 px (28 of 30 on the dashboard; 14×14 help icons, 16×16 checkboxes, 39 px nav tabs). — ⏳ batch 2
4. 92% of dashboard text is 12 px; the ≤1120 px shrink rule also applies on phones. — ⏳ batch 2
7. The first screen shows only summary cards; 「Active 持股」 wraps. — ⏳ batch 2
8. No `viewport-fit=cover`, so `env(safe-area-inset-*)` resolves to 0. Deferred from batch 1: verify on a real iPhone in standalone mode before changing. — ⏳ batch 2
10. Charts handle mouse events only (`chartFrame.tsx`); no pointer/touch. — ⏳ batch 3
11. The manifest `theme_color` / `background_color` are fixed at `#161616` (dark splash for light-theme users). Correction: `applyTheme()` already updates the `theme-color` meta at runtime (`utils/settings.ts:43–45`). — ⏳ batch 3 (low)
12. Four low-use tool buttons take 20% of the transactions first screen. — ⏳ batch 3
13. The add-transaction modal is not full-screen on phones; the save button is below the fold. — ⏳ batch 3
14. Cloud-mode bottom nav has 6 tabs; proposal is 5 with 「更多」. — ⏳ batch 3, user decision
17. Flag emoji render as empty boxes without a colour emoji font. — ⏳ batch 3

### Task 157: 追蹤文件與程式碼對帳（2026-09-10）
- **Status**: ✅ DONE
- **Agent**: Claude
- **Timestamp**: 2026-09-10 15:14:01 Asia/Taipei
- **What is this**: 使用者要求「從 log 與過去 bug_fix / task 文件查出還有什麼沒修，或報告了結果卻根本沒做的部分」。以**程式碼與線上實測**為準對帳，不採信文件自述。

**對帳結論：文件說待辦、程式碼其實已完成（紀錄過期，已更正）**

| 項目 | 文件說法 | 實際 | 證據 |
| ---- | ---- | ---- | ---- |
| Task 144-2 執行日誌檢視器 | 未實作 | **已完成** | `sources/src/components/Admin/LogsSection.tsx`，讀 `app_log`；`schema.sql:1138` |
| Task 145 P0-1 CSV 借券費 | OPEN | **已完成** | `utils/csv.ts:264-274, 334, 352` |
| Task 145 P0-2 融券借券費修正 | OPEN | **已完成** | `utils/fees.ts:121, 163-171` |
| Task 145 P0-3 拆併股融券處理 | OPEN | **已完成** | `StockSplitModal.tsx:52, 94` 排除融券並警告；`StockSplitModal.test.tsx:497, 551` 兩條測試守著。規格本就允許「排除並警示」這個解法 |
| Task 145 P1-1 PostgREST 1000 筆截斷 | OPEN | **已完成** | `dataProvider.ts:307-335`、`backup-transactions` 與 `stock-report` 各有 `pagedSelect`、`heldTwTickers:1007`、`watchedTwTickers:1023` |
| Task 145 P1-2 rowKey 碰撞 | OPEN | **已完成** | `AnalysisPage.tsx:84-86` |
| Task 76 item 4 試撮 UI | OPEN | **已完成** | `QuoteTab.tsx:60`（試撮中）、`:285`（預估標記） |
| quote-yahoo-a 均價 | 缺資料來源 | **已完成** | `QuoteTab.tsx:305` |

**對帳結論：確實沒做（維持待辦）**

| 項目 | 狀態 | 說明 |
| ---- | ---- | ---- |
| Task 144-3 資源用量監控 | ABSENT | `components/Admin/` 沒有任何呈現配額或用量的元件 |
| Task 144-4 R2 多目標備份 | ABSENT | `backup-transactions/` 只有 `BACKUPS_BUCKET = 'backups'`，註解寫明 phase 1 |
| Task 85 探針視窗重調 | 1/7 | 只有 `borrow`（`sourceProbePlan.ts:127`）有 2026-08-11 的實測註解，其餘六個未見重調證據 |
| quote-yahoo-a 成交金額 / 昨量 | ABSENT | `PriceQuote` 型別沒有這兩個欄位，需先決定資料來源 |
| Task 145 OPT-1 / OPT-2 / item 10 | 未驗證 | 效能優化項，本次未查 |

**實測澄清（原本被列為風險，實際不成立）**

- `readDoneSourcesToday`（`stock-report/index.ts:2636`）沒有分頁，理論上受 PostgREST 1000 筆上限影響。實測 PROD：`source_probe_tick` 每日僅 **74 筆**，符合該查詢條件者 **24 筆**，不會截斷。
- `handleAdminUsers`（`:3760`）單次 `listUsers({perPage:1000})` 未分頁，但程式碼註解已寫明是刻意決定（本專案帳號數為個位數）。
- `daily/` 檔案時間停在 9/9 17:10 **不是過期**：當日批次尚未到執行時間。更舊的 `3714`／`009816`／`2303`／`00981A` 已不在批次清單中，是舊持股的凍結檔案。

**設定面實測（Task 132/133）**

- PROD `site_url` = `https://stock-pnl-web.pages.dev/`，`uri_allow_list` **為空**。目前登入可用，但任何非 `site_url` 的重導目標都會被拒。若之後要加自訂網域或 preview 網址，必須先補進允許清單。
- DEV 的 auth 設定無法以本次的 access token 讀取（權限不足），未驗證。

### Task 156: 修復非持股股票的日線區間讀不到（BUG-077）
- **Status**: ✅ DONE
- **Agent**: Claude
- **Timestamp**: 2026-09-10 14:42:14 Asia/Taipei
- **What is this**: 0.9.42 讓行情分頁多了四個讀 `daily/{ticker}.json` 的區間，而該檔案只有持股才有（PROD 實測僅 9 檔）。在 `useDailySeries` 加第三層後援改打 Edge `daily` action 取 5 年日線，行情與技術面一起修好。定版 0.9.43，已併入 `main`。不需部署 Edge。

### Task 155: 行情走勢圖也擴充為八個區間
- **Status**: ✅ DONE
- **Agent**: Claude
- **Timestamp**: 2026-09-10 14:14:51 Asia/Taipei
- **Spec**: `docs/agent/specs/quote-tab-trend-ranges.md`
- **Done**: items 1-5 — full text in `TASK_ARCHIVE.md`.
- **What is this**: 反轉 0.9.41「只擴充 K 線圖」的決定。行情分頁的走勢圖改為八個區間，維持折線；技術面的六個區間不變。定版 0.9.42，已併入 `main`。

### Task 154: 個股走勢圖區間擴充為八個
- **Status**: ✅ DONE
- **Agent**: Claude
- **Timestamp**: 2026-09-10 12:26:19 Asia/Taipei
- **Spec**: `docs/agent/specs/chart-range-eight.md`
- **Done**: items 1-5 — full text in `TASK_ARCHIVE.md`.
- **What is this**: 技術面日 K 圖的區間選擇器改為 `近 1 月 / 近 6 月 / 本年迄今 / 近 1 年 / 近 5 年 / 全部`，盤中圖的 `一日 / 五日` 不動，合計八個區間。`近 5 年` 與 `全部` 走線路 A：不落地 Storage，由 `stock-price` 新增的 `daily` action 即時代理 Yahoo。

6. ~~部署 `stock-price` 到 DEV 並實打驗證 `近 5 年` 與 `全部`（v7, sha `253e6c3d…`）~~ ✅
7. ~~定版 0.9.41、合併 `main`~~ ✅
8. ~~部署 `stock-price` 到 PROD（v7, sha `253e6c3d…`，與 DEV 相同）~~ ✅

### Task 145: Codebase Deep Audit Remediation (P0 Calculation Bugs, PostgREST Truncations & Optimizations)
- **Status**: ⏳ **OPEN — Specified & Handover Ready (Spec 145)**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-04 23:05:00 Asia/Taipei
- **Spec**: `docs/agent/specs/145-codebase-bugs-and-optimizations-audit.md`
- **What is this**: Comprehensive audit across calculation engines, Edge Functions, data parsers, and UI components:
  1. **P0 Data & Calculation Integrity**: Fix CSV export/import losing borrow fee (`csv.ts:262, 325`), `proposeFeeCorrections` omitting borrow fee on short sales and leaving `fee_rate` desynced (`fees.ts:163`, `RecalcFeesModal.tsx:55`), and `StockSplitModal` miscalculating short-cover buys and ignoring short sells (`StockSplitModal.tsx:50`). (Fixed in 0.9.34 BUG-063..065).
  2. **P1 Capacity & Availability**: Address PostgREST 1000-row silent query truncation across 7 locations (`dataProvider.ts:312`, `backup-transactions`, `stock-report`); fix `AnalysisPage.tsx:84` rowKey collision preventing selection of short positions; fix pure short position passing `qty: 0` to What-If tab; guard `stock-report` manifest publication on complete batch failure (`index.ts:3111`).
  3. **P2 & Optimizations**: Timing-safe comparison in `backup-transactions`; duplicate key & sell label fix in `YearlyPage.tsx`; route-level `React.lazy()` code splitting for `AdminConsolePage`, `MacroPage`, and `FxPage` in `AppShell.tsx`; memo stabilization in `IntradayChart.tsx`.
- **Roadmap**: Ready for implementation of remaining phases per `Spec 145`.

### Task 144: Admin Enhancements, Execution Logs, Resource Usage & Multi-Target Backups
- **Status**: ⏳ **OPEN — Specified & Handover Ready (Spec 144)**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-04 16:30:00 Asia/Taipei
- **Spec**: `docs/agent/specs/144-admin-enhancements-and-backups.md`
- **What is this**: 4 interrelated system feature additions requested by user:
  1. ~~**Uniform Account Icon**~~: ✅ Completed in 0.9.36 (Modern Flat Persona Style 06 in `AppShell.tsx`).
  2. **Admin Cron & Probe Execution Logs**: Add detailed execution log viewer in Admin Console for `cron.job_run_details`, `source_probe_tick` anomalies, and batch run errors (shares `logs` panel in `LogsSection.tsx` added in Spec 146).
  3. **Supabase Cloud Usage & Limit Monitor**: Expose database size, storage usage, and plan thresholds (Free 500MB DB / 1GB Storage) directly in the Admin Console.
  4. **Multi-Target Backups**: Add Cloudflare R2 (S3-compatible, zero egress) offsite backup target in `backup-transactions` and provide local backup download/export options (bulk admin download, user self-service JSON export, and local backup script).
- **Remaining**: Implementation of Features 2, 3, 4 across frontend and backend RPCs.

### Task 85: 0.7.8 / 0.7.9 探針命中直接觸發抓取，且要確認資料到位
- **Status**: 🔄 **shipped everywhere and proven live; landing windows measured, retune needed**
- **Agent**: Claude
- **Timestamp**: 2026-08-11 19:00:00 Asia/Taipei
- **Done**: items 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14 — full text in `TASK_ARCHIVE.md`.
- **Remaining work**: Retune configured windows in `sourceProbePlan.ts` to match measured timings:
  - mops_profit: 12:00
  - bfi82u: 15:05-19:40
  - t86: 16:05-16:45
  - twt38u: 17:00-17:10
  - bwibbu: 17:05-17:35
  - margin: 20:45-21:00
  - borrow: 22:15-23:30

### Task 76: Checks that can only be made during market hours
- **Status**: 🔄 **Items 1, 2, 3 answered; item 4 remains open**
- **Agent**: Claude / Grok
- **Timestamp**: 2026-08-06 10:00:00 Asia/Taipei
- **Done**: items 1 (market-daily landing confirmed), 2 (volume discrepancy resolved in SPEC), 3 (t86 stabilization confirmed).
- **Remaining work**: Item 4: Trial-matching UI — confirm 「試撮」 badge on dashboard + 「預估」 on quote card in an auction window (08:30–09:00 or 13:25–13:30).

### quote-yahoo-a data source: stats grid omits 均價 / 成交金額 / 昨量
- **Status**: ⏳ **OPEN — Code shipped, data source decision pending**
- **Agent**: —
- **Timestamp**: 2026-08-25 15:41:49 CST
- **What is this**: 0.9.17 shipped the 個股分析 quote tab with a redesigned stats grid. The design mockup (`docs/design/quote-redesign-mockups.html`) shows three additional cells (均價, 成交金額, 昨量) beyond the current seven. The shipped grid omits these three because `PriceQuote` has no data source for them today.
- **Open work**: Data source decision (schema table, batch service, or external API integration) for the three omitted columns.

### Task 47: Refresh next year's release calendar every December (recurring)
- **Status**: 🔁 **Recurring**
- **Timestamp**: 2026-07-31 17:55:00 Asia/Taipei
- **What to do**: Update `RELEASE_CALENDAR` in `macroCalendar.ts` with next year's dates.
- **Why manual**: BLS schedule page returns 403, so it cannot be synced automatically. `sources/scripts/find-release-dates.py` cross-checks dates against ALFRED vintages.

### Task 132 & Task 133: Supabase Redirect URLs allow-list & DEV auth URLs
- **Status**: 🔄 **PROD 已設定；DEV 未驗證**
- **Timestamp**: 2026-09-10 15:41:33 Asia/Taipei（原開立 2026-08-31 16:45:40）
- **What is this**:
  - ~~Add app origin to Supabase Redirect URLs allow-list (`authRedirect.ts`).~~ ✅
  - In DEV compose `.env`, update `ADDITIONAL_REDIRECT_URLS` and `SITE_URL` —— ⏳ 本次的 access token 讀不到 DEV 的 auth 設定（權限不足），未驗證。

**PROD 設定內容（2026-09-10 經 Management API 寫入，並以獨立查詢回讀確認）**

`site_url` 維持 `https://stock-pnl-web.pages.dev/`，`uri_allow_list` 由**空值**改為：

```
https://stock-pnl-web.pages.dev/**
https://*.stock-pnl-web.pages.dev/**
http://localhost:5173/**
http://localhost:5174/**
http://localhost:5175/**
```

**為什麼原本是空的卻還能登入**：`site_url` 本身永遠允許，而正式站的 `origin + pathname` 剛好等於它。第一條是把這件事寫明，不再依賴那個隱含規則。

**實際受影響的只有重設密碼**。`mailer_autoconfirm = true`，註冊確認信根本不寄，所以 `AuthContext.tsx:86` 的 `emailRedirectTo` 目前不會觸發；`AuthContext.tsx:101` 的 `resetPasswordForEmail` 一定寄信，過去從 localhost 或 preview 網址觸發時，重導目標會被悄悄換成 `site_url`，人被送回正式站。

**localhost 列了三個 port**：vite 預設 5173，但被占用時會自動遞增 —— 本次 session 實際跑到 5175。

**未動到的設定**（寫入後確認）：`disable_signup=false`、`mailer_autoconfirm=true`、`password_min_length=6`、`jwt_exp=3600`。

**日後綁自訂網域時**：新增 `https://<網域>/**`，並把 `site_url` 一併改過去。若之後開啟 email 確認（`mailer_autoconfirm` 改 false），註冊回跳會開始使用同一份清單，`authRedirect.ts:19` 已能處理 `type=signup`。
