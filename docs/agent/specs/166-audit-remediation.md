# Task 166 — Full audit remediation (139 findings)

Source: audit report 2026-09-22 (artifact "stock-pnl-web 全面健檢", finding IDs SH/EN/TX/DA/PR/DT/FU/AI/MA/AD/EP/ER/ES/ED/DB/OP).
User decisions (2026-09-22):

- Signup stays open. Email confirmation ON, minimum password length 8 (DEV and PROD, plus local `config.toml`).
- AI analysis is **admin-only** (proxy returns 403 for non-admins; UI hides the AI tab; `get_ai_settings()` never returns a key to non-admins).
- Cloudflare R2 is gone (no R2 secrets on either project). Remove R2 code, tests, UI, and the `backup_run_log.r2_status/r2_error` columns. RISK-011 closes.
- Each batch: commit to `dev` → apply DDL / deploy Edge on DEV → verify → merge `main` → PROD (pre-authorized by the user).

## Batches

| Batch | Version | Scope |
| ---- | ---- | ---- |
| 1 | 0.9.63 | AI-01, OP-02, TX-01, TX-02, TX-06, TX-08, ER-01, ER-02, ER-03, ER-06, ER-07, SH-01, R2 removal |
| 2 | 0.9.64 | Money engine & data features: EN-01..EN-10, TX-03, TX-04, TX-09, DA-07, BUG-079, BUG-084 |
| 3 | 0.9.65 | Edge robustness & ops: ER-04, ER-08..ER-17, EP-01..EP-07, ES-01..ES-08, ED-01..ED-09, AD-02, DB-01..DB-05, OP-01 |
| 4 | 0.9.66 | Frontend sweep: SH-02..05, TX-05, TX-07, DA-*, PR-*, DT-*, FU-*, AI-02..07, MA-*, AD-01, AD-03..11, OP-03..07 |
| 5 | 0.9.67 | Structural: ER-05 (testable router), TX-10, TX-11 |

## Batch 1 contract

### AI-01 — admin-only AI
- `ai-proxy/handler.ts`: dependency `verifyJwt` is replaced by `authorize(token) => Promise<'admin' | 'user' | null>`.
  `null` → 401 (existing messages). `'user'` → **403** `{ error: 'AI 分析僅限管理員使用' }`; settings are not read and upstream is not called.
- `ai-proxy/index.ts`: `authorize` uses `db.auth.getUser(token)`; admin means `user.app_metadata.role === 'admin'` (same predicate as `stock-report` `assertAdmin`).
- `get_ai_settings()`: returns `''` for `ai_api_key` unless the caller's JWT has `app_metadata.role = 'admin'` (and still `''` for provider google). Closes RISK-013 for non-admins.
- UI: `StockDetailPage` shows the `ai` tab only when `isAdmin()` resolves true; a `tab=ai` URL for a non-admin falls back to `analysis`.
- Must not change: google key never leaves the server; model always from DB.

### OP-02 — auth policy
- Management API `PATCH /v1/projects/{ref}/config/auth` with `mailer_autoconfirm=false`, `password_min_length=8` (DEV first, then PROD).
- `config.toml`: `[auth.email] enable_confirmations = true`, `[auth] minimum_password_length = 8`.
- UI: every new-password check (sign-up, recovery modal, change-password modal) requires ≥ 8 chars; placeholders say 8.

### TX-01 / TX-02 / TX-06 / TX-08 — CSV
- `csv.ts` exports `markDuplicateRows(rows: NewTransaction[], existing: Transaction[]): boolean[]`.
  Key = `tx_date|market|ticker|tx_type|price|qty|fee_tax|tx_nature??''`. Multiset: when the file has k copies of a key and the
  ledger already has m, the first `min(k, m)` file rows are marked `true`. Two identical fills inside one file are not duplicates of each other.
- `CsvImportModal` gets `existing: Transaction[]`; duplicates are shown and excluded by default; a checkbox (`id="csv-include-dups"`) includes them.
  Parsing is debounced (≈250 ms) so pasting large text does not re-parse per keystroke.
- `transactionsToCsv`: a text cell that starts with `=`, `+`, `-`, `@` and is not a finite number is prefixed with `'`.
  `parseTransactionsCsv` strips that single leading `'` when the next char is one of `= + - @`, so export → import round-trips.
- `parseTxDate` accepts ROC dates: 2–3 digit year + 1911 (`113/01/10` → `2024-01-10`), same separators and validity check.

### ER-01 / ER-02 / ER-03 / ER-06 / ER-07 — nightly batch (stock-report/index.ts)
- ER-01 `handleGenerate`: upload only when `series.dataYmd && series.days.length > 0`.
- ER-02 chips loop: `okUp === false` counts as `failed` and adds to `failedTickers` (same as the catch path).
- ER-03 chips loop checks the remaining wall-clock budget per ticker; when exhausted it stops, and the result reports `skippedForBudget` (count). No new DB column: include it in the HTTP result and in the `batch_run_log` message/detail field that already exists (builder must use existing columns only).
- ER-06 manifest advances only when `generated > 0 && failed <= 0.2 * (generated + failed)`.
- ER-07 `handleGenerateAll`: when a later phase throws, write a `logEvent('error', …)` with the phase name before returning.

### SH-01
- `RecoveryPasswordModal` passes `disableBackdropClose`.

### R2 removal
- Delete `backup-transactions/r2.ts` and `r2.test.ts`; remove `syncToR2`/`readR2Config` use and the `r2_status`/`r2_error` fields from the log row.
- `stock-report` `handleAdminBackups` stops selecting/returning `r2_status`/`r2_error`; `BackupsSection` stops rendering them.
- DDL: `ALTER TABLE backup_run_log DROP COLUMN IF EXISTS r2_status, DROP COLUMN IF EXISTS r2_error;` (schema.sql updated; applied **after** the new Edge code is deployed).

## Test charter (Batch 1)

| Case | Expected outcome | Layer / file |
| ---- | ---- | ---- |
| authorize → 'user' | 403, settings not read, upstream not called | `ai-proxy/handler.test.ts` |
| authorize → null | 401 | same |
| export name `=HYPERLINK("x")` | cell starts with `'=` | `src/utils/csv.test.ts` |
| export → import of name `=abc` | name is `=abc` again | same |
| negative number text `-12.5` | not prefixed | same |
| `113/01/10`, `99/12/31`, `113-1-5` | `2024-01-10`, `2010-12-31`, `2024-01-05` | same |
| `113/02/30` | null | same |
| 2 file copies, 1 existing | `[true, false]` | same |
| different fee_tax | not a duplicate | same |

## Batch 2 contract (0.9.64) — money engine & data features

### EN-01 — dividends
Model (`src/types/models.ts` + `supabase/schema.sql` CHECK): `TxType = 'BUY' | 'SELL' | 'DIVIDEND' | 'STOCK_DIVIDEND'`.

- `DIVIDEND` (現金股利): `price` = 每股股利, `qty` = 配發股數, `fee_tax` = 代扣費用（二代健保、匯費）. Net cash = `price * qty - fee_tax`.
  It never changes `qty`, `cost`, `rawCost`, `openLots`, `realized`, or any sell leg. `tx_nature` is null.
- `STOCK_DIVIDEND` (股票股利): `qty` = 配發股數, `price` must be 0, `fee_tax` = 相關費用 and is added to cost.
  Engine treats it as a zero-price BUY: `qty += qty`, `cost += fee_tax`, `rawCost += 0`, a new `OpenLot` with `price = 0`.

Engine (`pnlEngine.ts`, then `npm run sync:edge-engine`):
- `Position.dividends: number` — cumulative net cash dividends.
- `YearTickerDetail.dividends: number`; `YearSummary.dividendsTw`, `dividendsUs`; `LedgerSummary.dividendsTw`, `dividendsUs`, `dividendCount`.
- Cash dividends are bucketed by `tx_date` year like every other row; a dividend for a ticker with no open position still creates/updates its `Position` (qty 0).
- `STOCK_DIVIDEND` counts in `count` and adds `fee_tax` to `buyAmt` (gross 0), but not to `buyCount`.

UI: `TransactionForm` offers both new types (price locked to 0 and hidden for 股票股利, 交易性質 hidden for both);
`YearlyPage` gains a 股利 column per year and per ticker, a 股利合計 KPI, and 總報酬 = 已實現 + 股利;
`TX_TYPE_LABEL` gains 現金股利 / 股票股利 and CSV round-trips both.
Non-goals: no tax reporting, no dividend data fetching, no dashboard change.

### BUG-079 + EN-07 — one fee model for break-even
`breakEvenPrice` / `breakEvenPriceShort` use the same per-lot fee rates as `estimateUnrealized`
(`holding.openLots[].feeRate`, workspace rate as fallback, min fee applied once), and return `null`
when the search does not converge. Callers (`holdingRows.ts`, `StockDetail/whatIf.ts`) render `null` as 「—」.

### EN-02 / EN-09 — US positions
US unrealized stays gross (no fee deduction — GAS parity, the app has no US fee-rate setting). Pin it with a test and
say so in the comment. `holdingRows` marks 券商口徑 as 不適用 for USD instead of `null` meaning both 「不適用」and 「尚無報價」.

### EN-03 / EN-04 — structured warnings
`Ledger.warnings: LedgerWarning[]`, `LedgerWarning = { kind: 'oversold' | 'over-cover' | 'tax-inferred', txId, ticker, message }`
(`message` keeps the current Chinese text so existing UI still renders). `splitFeeTax` reports when it inferred the
half tax rate for a row with no `tx_nature`; `TransactionsPage` marks those rows.

### EN-05 / EN-06 / EN-08 / EN-10 / DA-07 / BUG-084
As in the audit report: flag out-of-range inferred rates instead of silently using the default; compare corrected fees on
integers; fee-rate sync keeps `updated_at` and surfaces a failed cloud write; guard negative cost in ROI; yearly ROI skips
oversold legs; stop reading the legacy per-workspace min-fee localStorage keys and delete them once.

### TX-03 / TX-04 / TX-09 — atomic batch updates
- DDL: `tx_split_log` (id, user_id, workspace_id, market, ticker, cutoff_date, ratio_from, ratio_to, applied_at), RLS `auth.uid() = user_id` USING + WITH CHECK.
- DDL: `apply_transaction_updates(p_updates jsonb) RETURNS integer`, `SECURITY INVOKER` plpgsql, one UPDATE per element inside one statement/transaction, RLS still applies.
- `DataProvider.updateTransactions(updates)` uses the RPC (Supabase) or an in-memory batch (Local).
- `StockSplitModal` warns before applying a split whose (workspace, market, ticker, cutoff, ratio) already exists in `tx_split_log`, and writes the row after a successful apply. `RecalcFeesModal` uses the same batch path.

## Batch 4 contract (0.9.66) — frontend sweep

Grouped by area; every item is the audit finding of the same id. Shared rules:
- No behaviour change beyond the finding; no redesign; keep existing copy tone (Traditional Chinese, user-facing).
- Where a finding asks for a distinction the data cannot carry yet (stale vs missing), add the flag at the source that already knows it and render it, rather than guessing in the view.
- a11y items follow the patterns already in the codebase (`Modal` focus trap, `rowActivateProps`, `HelpTh`).

### Shell (SH-02..SH-05)
`isAdmin()` re-runs on `onAuthStateChange` (TOKEN_REFRESHED / USER_UPDATED); `signOut` checks the returned error and falls back to a local sign-out with a visible message; the 「至少保留一個工作區」 invariant moves into `WorkspaceContext.deleteWorkspace`; `HeaderMenu` closes when focus leaves it.

### Transactions and dashboard (TX-05, TX-07, DA-01..DA-06)
Future-dated transactions ask for confirmation; a failed ticker lookup says whether it was 查無代號 or 查詢失敗; a stale quote is rendered with reduced emphasis (not the same red/green as a live one) everywhere `priceStale` is known; `MarketPanel` skeletons get `aria-label`; the price poller does not double-fetch when a visibility change coincides with the interval; watchlist removal disables only its own row and 復原 restores the original `sort_order`; `addWatch` gets its sort order from the database and translates a duplicate-key error into 「已在自選股中」.

### Price pipeline (PR-01..PR-07)
`asOf` missing from the Edge response renders 「時間未知」 instead of the client clock; the warm caches (`attempted*`, `last*`, `inflight*`) clear on `SIGNED_OUT`/user change and carry an LRU cap, as do `intradayProxy`/`dailyProxy`; swallowed failures in `prefetchStockData` and `stockSearch` call `logClient`; the two prefetch warms run concurrently; US Chinese-name search ranks like `twMatchScore`; `AddWatchModal` memoises its filter/sort.

### Stock detail and charts (DT-01..DT-10, FU-01..FU-06)
Intraday and daily series carry `fetchedAt` and the ticker they belong to, and the UI shows 「快取於 HH:MM」 and refuses to render a series whose ticker does not match; the quote card shows 漲停/跌停 state and the intraday chart draws the ±10% reference lines from 昨收; US volume is labelled 股 not 張; the stats grid uses `dl/dt/dd`; what-if validates per field; the price ladder says it is a convenience ladder, not the statutory limit; charts memoise their static layer and thin x-axis labels by available width; a single non-null point still renders a mark; the fundamental tab drops the hardcoded `2024-Q1` cutoff for a rolling window; chips empty states distinguish 尚未公布 / 抓取失敗 / 無資料; TTM says 資料不足 (n/4); the 三大法人 total is cross-checked against the four legs; 「資料更新於」 formats in Asia/Taipei explicitly.

### Macro and FX (MA-01..MA-12)
`sessionHours` accepts known closed dates and MacroPage supplies TW's from `market/daily.json` (a weekday whose latest market day is earlier than today is 休市, shown as such instead of 交易中); `GlobalIndices` gets a request-sequence guard and shows 已收盤 with the last update time; market data is cached across tab switches; `marketProxy`/`foreignTopProxy` return a discriminated empty-vs-invalid result and the UI says which; turnover units appear in the cells, not only the header; `IndexDetail` surfaces a failed 當日 fetch; FX staleness counts trading days; `FxPage` aborts on unmount and 重新整理 also refreshes history; tab ARIA is completed (`tablist`/`tabpanel`); `reportPdf.ts` is renamed `downloadBlob.ts`.

### Admin and AI (AD-01, AD-03..AD-11, AI-02..AI-07)
Role changes and 「全部執行」 ask for confirmation; the status page polls with a visible age and uses the server's `asOf` for 「N 分鐘前」; error states distinguish 權限不足 / 網路錯誤 / 尚未部署; the log cursor is `(at, id)`; `message` is length-capped and redacted like `detail`; MechanismGuide's 19:40 claim is corrected to the real window; probe cards say 未到時窗 / 尚未命中 / 今日未命中; `window.confirm` gives way to `useConfirm`; a failed AI question is preserved, in-flight AI requests abort on unmount, prompts have a length cap, and the AI model list is not hardcoded in two places.

### Ops (OP-03..OP-07)
A CSP is served with the app (Cloudflare Pages `_headers`), the manifest gains a maskable icon, `tsconfig.edge.json` drops `noImplicitAny: false`, the workflows pin actions to commit SHAs, and a scheduled workflow runs the e2e scripts against DEV when the required secrets exist (skipping cleanly when they do not).
