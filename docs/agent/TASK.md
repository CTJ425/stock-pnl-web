# Task Backlog & Tracking (TASK.md)

- Agent: Antigravity
- Status: ACTIVE
- Timestamp: 2026-09-09 18:05:00 Asia/Taipei

---

> **This file only contains ongoing and recurring tasks.** Completed tasks are moved to `TASK_ARCHIVE.md` (see CLAUDE.md § Memory).
> For detailed implementation history, always refer to `PROGRESS.md`.

## 📍 Where the project stands (2026-09-15 08:58)

- **Version 0.9.52 — on `dev` and `main`, not yet uploaded. 0.9.51 的 Edge/SQL 仍未部署到 PROD。** `main` and `dev` are synchronized at `0.9.52`; the live site shows whatever was last uploaded by hand — check its version badge (README step 9-1).
  - **0.9.51 的 PROD 上線順序（四步，不可顛倒）**：`PART A` → `supabase functions deploy ai-proxy`（維持 `verify_jwt=true`，不加旗標）→ 上傳前端 `dist/` → `PART B`。`PART B`（撤銷 `ai_api_key` 讀取權）必須放最後，否則線上那份舊前端的 AI 分析分頁會壞掉。兩段 SQL 分開寫在 `docs/agent/161-ai-key-proxy-migration.sql`。DEV 已全部完成，PROD 四步都還沒做。
  - Shipped 2026-09-15: 移除未使用的 PDF 產生器與 jspdf / html2canvas 相依、修補開發相依漏洞（0.9.52）。
  - Shipped 2026-09-14: AI 金鑰移出瀏覽器 + CI 閘門 + 條件式 hook 修補（0.9.51, Task 161）。
  - Shipped 2026-09-14: 全專案快照與還原腳本（0.9.50, Task 160）。
  - Shipped 2026-09-14: 修復台股代號與中文搜尋失敗（0.9.49, BUG-081）、多目標備份與本機匯出（Task 144 #4）、docs 過時文件清理。
  - Shipped 2026-09-11: 手機版交易紀錄工具列與觀察股票標題列排整齊（0.9.48, Task 158 #12）。
  - Shipped 2026-09-11: 桌機版「新增交易」改回右下角浮動按鈕（0.9.47，使用者決定撤回 Task 159 D9）。
  - Shipped 2026-09-11: 修正 iPhone 實機版面問題（0.9.46, BUG-080）。
  - Shipped 2026-09-11: 手機與桌機介面第一批改善（0.9.45, Task 158/159 batch 1）。
  - Verification: 121 test files / **1,947** vitest tests, exit 0；`npm run lint`、`npm run build`、`npm run typecheck:edge` 皆 exit 0；`npm audit` 0 vulnerabilities。
  - Edge Functions: `stock-price` deployed to DEV and PROD, `stock-report` is **v8**, `backup-transactions` is **v4**, `ai-proxy` 為 **DEV v1（ACTIVE, verify_jwt=true）；PROD 尚未部署**。
  - **前端沒有自動部署。** 手動 `npm run build` 後上傳 `sources/dist/` 到 Cloudflare Pages（PROD `site_url` = `https://stock-pnl-web.pages.dev/`）。流程寫在 `README.md` 步驟 9-1。合併 `main` 不等於上線，驗收看畫面左下角版本徽章。
  - Known and not done: Task 144 的資源用量監控與日誌檢視（Features 2, 3）；Task 85 只有 `borrow` 一個視窗完成重調；`成交金額` / `昨量` 仍缺資料來源；end-to-end Playwright run for the 融券 flow；`.inst-matrix tfoot td` hardcoded white overlay inverted under light theme。

## 📋 Active Tasks

### Task 160: 全專案快照與還原腳本（snapshot / restore / wipe-dev）
- **Status**: 🔄 **Phase A + A-2 程式完成並實測；破壞性演練待使用者決定 CRON_SECRET 方案**
- **Spec**: `docs/agent/specs/160-snapshot-restore.md`（含 §3a、§3b 兩項設計修正）
- **Done**:
  - `sources/scripts/lib/snapshotPlan.cjs` — 純邏輯核心，21 條測試（`snapshotPlan.test.mjs`）
  - `sources/scripts/snapshot.cjs` — 產生快照包，目的地 local / storage / r2
  - `sources/scripts/restore.cjs` — 從快照包還原，支援 `--dry-run`
  - `sources/scripts/wipe-dev.cjs` — 破壞性演練，五道守衛
  - `sources/package.json` — 新增 `snapshot` / `restore` / `wipe:dev` 三個指令
  - `.gitignore` — 擋下 `.snapshots/` 與 `*.sql.gpg`
  - DEV `backup_run_log` 補上 `r2_status` / `r2_error` 兩欄
- **Deferred (使用者決定 2026-09-14)**: 破壞性演練暫不執行。DEV 維持現狀，未做任何 wipe / restore 往返。
- **Resume 時要先決定**: 還原會重建 7 個 cron job，需要真正的 CRON_SECRET，但 Supabase 只回得出 SHA256 摘要、讀不回原值。方案 A 是產新密鑰並 `supabase secrets set` 寫進目標專案（能驗證 placeholder 窄替換，但會換掉現有密鑰）；方案 B 是跳過 cron（不動設定，但 placeholder 替換就驗不到，而那正是 2026-08-31 的失敗點）。
- **Out of scope (使用者決定 2026-09-14)**: Cloudflare R2。`snapshot.cjs` 的 `r2` 目的地與 SigV4 簽章已全部移除，`--to` 只接受 `local` 與 `storage`。詳見 spec §9。
- **Not done**: 實際的 wipe → restore 往返。所有其他環節都已對 DEV 實測：snapshot 產包 1.6 MB / 137 檔 sha256 吻合、restore `--dry-run` 六步全過（6 URL + 6 secret header 窄替換）、wipe-dev 對 PROD ref 與未知 ref 皆以離開碼 1 拒絕。

### Task 159: Desktop and general UI/UX fixes
- **Status**: 🔄 IN PROGRESS
- **Agent**: Claude
- **Timestamp**: 2026-09-11 12:37:31 Asia/Taipei
- **Done**: items D2, D4, D6, D8, D9, D11, D12 (0.9.45) — full text in `TASK_ARCHIVE.md`.
- **Decision (0.9.47)**: D9 reverted by user decision — desktop uses the floating 「新增交易」 button again and the header button was removed. `main.container` already reserves 96 px at the bottom above 720 px, so only mid-scroll overlap remains.
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
- **Done**: items 2, 5, 6, 9, 15, 16 (0.9.45), 12 and 18 (0.9.48) — full text in `TASK_ARCHIVE.md`.
- **Spec**: `docs/design/mobile-ux-audit-iphone13mini.html` (item numbers 1–17 match the report)
- **What is this**: Audit measured at 375×629 (Playwright `iPhone 13 Mini`, local mode, 0.9.44). Batch 1 shipped in 0.9.45 = items 2, 5, 6, 9, 15, 16. Item 8 deferred (needs a real iPhone); item 11 re-scoped (see item). Batches 2–3 = the rest.

1. Holdings / transactions / yearly tables show 33–40% of their width at 375 px; P&L is columns 9–10. Card list at ≤560 px. — ⏳ batch 2
3. Tap targets under 44 px (28 of 30 on the dashboard; 14×14 help icons, 16×16 checkboxes, 39 px nav tabs). — ⏳ batch 2
4. 92% of dashboard text is 12 px; the ≤1120 px shrink rule also applies on phones. — ⏳ batch 2
7. The first screen shows only summary cards; 「Active 持股」 wraps. — ⏳ batch 2
8. No `viewport-fit=cover`, so `env(safe-area-inset-*)` resolves to 0. Deferred from batch 1: verify on a real iPhone in standalone mode before changing. — ⏳ batch 2
10. Charts handle mouse events only (`chartFrame.tsx`); no pointer/touch. — ⏳ batch 3
11. The manifest `theme_color` / `background_color` are fixed at `#161616` (dark splash for light-theme users). Correction: `applyTheme()` already updates the `theme-color` meta at runtime (`utils/settings.ts:43–45`). — ⏳ batch 3 (low)
13. The add-transaction modal is not full-screen on phones; the save button is below the fold. — ⏳ batch 3
14. Cloud-mode bottom nav has 6 tabs; proposal is 5 with 「更多」. — ⏳ batch 3, user decision
17. Flag emoji render as empty boxes without a colour emoji font. — ⏳ batch 3
19. The 交易紀錄 empty-state copy says 「點右下角『新增交易』…或用『匯入 CSV』」, but at ≤720 px the add button is icon-only and 匯入 CSV sits in the 「工具」 sheet. — ⏳ batch 3

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
- **Status**: 🔄 **IN PROGRESS — Features 1 & 4 shipped (0.9.49)**
- **Agent**: Antigravity
- **Timestamp**: 2026-09-14 12:30:00 Asia/Taipei
- **Spec**: `docs/agent/specs/144-admin-enhancements-and-backups.md`
- **What is this**: 4 interrelated system feature additions requested by user:
  1. ~~**Uniform Account Icon**~~: ✅ Completed in 0.9.36 (Modern Flat Persona Style 06 in `AppShell.tsx`).
  2. **Admin Cron & Probe Execution Logs**: Add detailed execution log viewer in Admin Console for `cron.job_run_details`, `source_probe_tick` anomalies, and batch run errors (shares `logs` panel in `LogsSection.tsx` added in Spec 146).
  3. **Supabase Cloud Usage & Limit Monitor**: Expose database size, storage usage, and plan thresholds (Free 500MB DB / 1GB Storage) directly in the Admin Console.
  4. ~~**Multi-Target Backups**~~: ✅ Completed in 0.9.49 (Cloudflare R2 S3 offsite target via `r2.ts`, admin bulk download in `BackupsSection.tsx`, user self-service export in `selfExport.ts`, local CLI script `backup-download.cjs`).
- **Remaining**: Implementation of Features 2, 3 across frontend and backend RPCs.

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
