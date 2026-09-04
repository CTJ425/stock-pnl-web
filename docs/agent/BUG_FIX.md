# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-04 23:45:00 Asia/Taipei

---

## 🔍 Codebase audit 2026-09-04 (deep sweep) — P0 defects, pagination gaps & UI anomalies

A comprehensive audit covering `sources/src/` (engines, components, utils) and `sources/supabase/` (Edge functions).
Documented in detail in `docs/agent/specs/145-codebase-bugs-and-optimizations-audit.md`.

### BUG-063 — CSV 匯出後再匯入導致融券借券費永久遺失
- **Location**: `sources/src/utils/csv.ts:262, 325` & `sources/src/utils/pnlEngine.ts:268`
- **Root Cause**: `splitFeeTax` 扣除 `borrow`，將手續費填為 `tx.fee_tax - tax - borrow`。CSV 沒有獨立借券費欄位，匯入時 `splitMode` 以 `fee + tax` 覆蓋 `fee_tax`，借券費永久遺失。
- **Severity**: P0（帳務金額靜默失真）
- **Status**: OPEN

### BUG-064 — 批次重算手續費漏算融券借券費，且未同步更新折讓率
- **Location**: `sources/src/utils/fees.ts:163-171` & `sources/src/components/Transactions/RecalcFeesModal.tsx:55-64`
- **Root Cause**: `proposeFeeCorrections` 呼叫 `calculateFee` 時漏傳 `nature: tx.tx_nature`，融券賣出被當成一般現股賣出而未計入借券費，精靈誤判不符並提示覆蓋。更新時未將 `fee_rate` 寫入，導致折讓率欄位脫鉤。
- **Severity**: P0（融券帳務損毀）
- **Status**: OPEN

### BUG-065 — 股票分割換算未隔離融券交易，造成部位失衡
- **Location**: `sources/src/components/Transactions/StockSplitModal.tsx:49-65, 178-184`
- **Root Cause**: 以 `tx_type === 'BUY'` 篩選交易時未排除 `tx_nature === 'SHORT'`，融券回補買進被誤當現股買進進行分割計算；未平倉融券賣出空單未受支援，分割後導致資券失衡。
- **Severity**: P0（計算錯誤）
- **Status**: OPEN

### BUG-066 — PostgREST 預設 1000 筆上限造成跨模組靜默截斷（7 處）
- **Location**:
  1. `sources/src/services/dataProvider.ts:312` (`listTransactions` 無分頁)
  2. `sources/supabase/functions/backup-transactions/index.ts:72` (`backupAccount` 備份查詢未分頁)
  3. `sources/supabase/functions/stock-report/index.ts:1003` (`heldTwTickers` 跨用戶全表無分頁)
  4. `sources/supabase/functions/stock-report/index.ts:1011` (`watchedTwTickers` 觀察名單超過 1000 筆截斷)
  5. `sources/supabase/functions/backup-transactions/index.ts:172` & `stock-report/index.ts:3809` (`listUsers` 未多頁走訪)
  6. `sources/supabase/functions/stock-report/index.ts:3538` (`source_probe_tick` 寫死 `.limit(2000)` 仍受 1000 上限截斷)
  7. `sources/supabase/functions/stock-report/index.ts:3947` (備份還原寫入回傳筆數截斷)
- **Root Cause**: PostgREST 伺服器端強制上限 `max_rows = 1000`，無分頁循環的查詢超過 1000 筆時尾端資料靜默遺失。
- **Severity**: P1（系統容量與資料完整性）
- **已完成的部分（0.9.33）**: 7 處中的 2 處已修 —— `stock-report/index.ts` 的 `handleAdminBackupRestore`（既有列查詢）與 `handleAdminBackups`（`backup_run_log` 查詢），皆改走新增的 `pagedSelect` helper 並以 key 排序後分頁（`.range()` 是 OFFSET/LIMIT，沒有 `ORDER BY` 就不保證跨頁列序一致）。紀錄見 `FIXED_BUG.md` BUG-059、BUG-060。**實作此項時請直接重用 `pagedSelect`，並先確認剩下 5 處是哪幾處，不要重做已完成的兩處。**
- **Status**: OPEN

### BUG-067 — 個股分析下拉選單重複 Key，導致融券空單永遠無法被選取
- **Location**: `sources/src/components/StockDetail/AnalysisPage.tsx:84, 115, 204`
- **Root Cause**: `holdingEntries` 誤用 `r.holding.key`（兩者同為 `'TPE:2330'`）而非唯一的 `r.rowKey`。導致 Duplicate Key 警告且 `find` 永遠命中第一筆多單，融券空單持股無法切換。
- **Severity**: P1（功能阻斷）
- **Status**: OPEN

### BUG-068 — 個股分析傳入純融券部位導致 What-If 試算鎖死
- **Location**: `sources/src/components/StockDetail/AnalysisPage.tsx:258`
- **Root Cause**: 純融券部位 `qty = 0, avgCost = 0`（股數存於 `shortQty`），傳入 What-If 試算造成預設股數與成本歸零。
- **Severity**: P1（功能異常）
- **Status**: OPEN

### BUG-069 — 每日報表全數失敗時仍上傳 `manifest.json` 引發全站 404
- **Location**: `sources/supabase/functions/stock-report/index.ts:3111`
- **Root Cause**: 在 `handleGenerateAll` 中無條件上傳 `reports/manifest.json`，當 `generated === 0` 且全數失敗時將前端導向空目錄。應加上 `if (generated > 0)` 守衛。
- **Severity**: P1（可用性風險）
- **Status**: OPEN

### BUG-070 — `backup-transactions` 定時觸發金鑰比對存在時序攻擊風險
- **Location**: `sources/supabase/functions/backup-transactions/index.ts:51`
- **Root Cause**: 使用字串 `got !== expected` 比較，未對齊 `cronSecret.ts` 的 `secretsMatch` 常數時間比較。
- **Severity**: P2（安全性加固）
- **可直接重用的實作（0.9.33）**: `stock-report` 的同型問題已於 0.9.32 修正，固定時間比較函式位於 `sources/supabase/functions/stock-report/cronSecret.ts`（`secretsMatch`），並有 `cronSecret.test.ts` 五個案例覆蓋。紀錄見 `FIXED_BUG.md` BUG-054。`backup-transactions` 請重用同一份實作，並保留「`CRON_SECRET` 未設定時一律 401」的短路。
- **Status**: OPEN

### BUG-071 — 年度報告當沖拆分記錄 Duplicate Key 與融券回補標籤顛倒
- **Location**: `sources/src/components/YearlyReport/YearlyPage.tsx:373, 377` & `sources/src/utils/pnlEngine.ts:534, 772`
- **Root Cause**: 當沖拆分賣出推入相同 `txId` 導致 `<tr key={sell.txId}>` 噴警告；line 377 寫死「賣出」，融券回補顯示顛倒。
- **Severity**: P2（顯示與主控台錯誤）
- **Status**: OPEN

---

## 🐛 Currently Active / Open Bugs

### AUDIT-10 — CSV 匯入把「以點為千分位」的數字少算 1000 倍且不報錯

- **Where**: `sources/src/utils/csv.ts`（`parseNumber`）
- **Proven by reading**: 清理正規式只移除 `NT$ US$ $ , 空白 ( )`，不處理點號千分位，之後直接 `Number(cleaned)`。
- **Failure scenario**: 交易單價欄位為 `"2.500"`（某些地區匯出代表 2500）解析為 `2.5`，是有限正數，通過 `price > 0` 驗證，不產生 `CsvRowError`。該筆交易金額少算 1000 倍，靜默污染移動平均成本。
- **Severity**: MEDIUM（台灣券商匯出用逗號千分位，觸發需特定來源檔）
- **Decision**: 使用者於 2026-09-04 決定**不改程式**，記為可接受風險。「2.500」在台股與美股都可能是合法的 2.5 元，加規則拒絕它會擋掉正常匯入；多組點號如「1.234.567」目前已是 `NaN` 會報錯，真正的破口只有「單組三位數」這種本質上無法區分小數與千分位的形式。
- **Status**: OPEN（已接受，不修）
- **Discovered**: 2026-09-04 全庫稽核。同批的其餘六項（AUDIT-09、11、12、13、14、15）已於 0.9.32 修正，紀錄見 `FIXED_BUG.md` BUG-051 … BUG-056，稽核全文已歸檔至 `FIXED_BUG.md` 末段。

---

### RISK-005 — chips 逐檔上傳失敗既不計入 `generated` 也不計入 `failed`

- **Where**: `sources/supabase/functions/stock-report/index.ts`（chips phase 的逐檔迴圈，`if (okUp) generated++`）
- **What**: `uploadJson` 內建自己的 `try/catch`，失敗時不拋例外而是回傳 `false`。因此 Storage 上傳失敗的標的不會進入 BUG-053 新增的 `catch`，既不計入 `generated` 也不計入 `failed`，`generated + failed` 可能小於 `tickers.length`。
- **Confirmed by Review**: `route:reviewer`，2026-09-04，BUG-050 與 AUDIT 修正的審查。
- **Impact Today**: 低。運維者看到的是偏低的 `generated`，不是錯誤的數字；隔 5 分鐘的下一次 cron 會重跑並自我修復。
- **Scope**: 此缺口在 BUG-053 之前就存在，不是本次修正造成的。BUG-053 只處理 `assembleOne` 拋例外的路徑。
- **Decision**: 本次不修。要正確計數必須改動 `uploadJson` 的回傳約定，影響面遠大於這個顯示問題。
- **Status**: OPEN（低嚴重度，已確認）
- **Discovered**: 2026-09-04

---

### RISK-004 — `addTransactions` silently drops `tx_nature` on pre-migration database

- **Where**: `sources/src/services/dataProvider.ts:174-188` (retry path in `SupabaseProvider.addTransactions`)
- **What**: When the `tx_nature` column is missing, `addTransactions` retries with a schema that omits the field. The retry succeeds and returns success, so the caller believes the label was persisted. User sees "save" succeed, then finds the label gone on reopen.
- **Confirmed by Review**: Task 139 code review before landing.
- **Impact Today**: None. Both cloud projects have carried the column since 2026-09-03 — see BUG-041 and BUG-044-P in `FIXED_BUG.md`, closed with the 0.9.28 release.
- **User Experience**: User picks 當沖, sees save succeed, reopens and finds label lost. But ledger inference (fee/tax split via `splitFeeTax`) still produces correct tax numbers because `DAY_TRADE` → halved tax is both the explicit inference and the fallback when label absent.
- **Mitigation**: Same property that `workspaces.fee_rate` shipped with in Task 135: explicit label lost until PROD migration runs, but numbers stay correct.
- **Decision**: Accepted, not fixed. No code change.
- **Status**: OPEN (low severity, accepted)
- **Introduced**: Task 139 (2026-09-01)
- **Scope**: Dormant while a project carries `tx_nature` — but **this risk is not one-time**. It re-arms every time a project is created or recreated from un-migrated schema, which is exactly what happened on 2026-08-31: both cloud projects were recreated and silently lost the column, and nothing surfaced it until 2026-09-03. Treat it as a standing post-recreation check, not a closed question.

---

### RISK-003 — Historical chip report files keep permanent "回補中" note

- **Where**: `sources/supabase/functions/stock-report/index.ts:2135` (note text from `assembleOne` at `index.ts:698-701`)
- **What**: For the 6 non-latest days the chips backfill writes (Task 130 new `phase: 'chips'`), `daySeries.incomplete` is true by construction. Each past-date `reports/{ymd}/{ticker}.json` embeds the note "歷史資料回補中…走勢圖會逐日補齊". The nightly `generate-chips` only ever rewrites `{series.dataYmd}/{ticker}.json`, so the note never clears.
- **Confirmed by Observation**: DEV manual test on 2026-08-31, Task 130 manual DEV verification item 7. The generated `20260828/2454.json` carries the note; only the newest file (manifest.ymd) has the full 7-day history and no note.
- **Impact Today**: None. `reportProxy.ts:178-180` only ever fetches `manifest.ymd`, so no consumer reads a past-date report.
- **Future Risk**: Becomes a real defect if any future feature reads a report by a specific past `ymd`.
- **Decision**: Accepted, not fixed. The note is semantically defensible — a report for 7 days ago genuinely has a thin history window.
- **Status**: OPEN (low severity, confirmed)
- **Introduced**: Task 130 (2026-08-30)

---

### RISK-002 — Night batch cost scaling with watched stock count

- **Condition**: 0.8.0 expands `batchTwTickers()` from held-only to held ∪ watched; each stock ~6 external requests; cost per day ≈ (users × avg watched stocks) × 6.
- **Limit**: `tw_watchlist` max 30 stocks/user is the only brake.
- **Status**: OPEN — observation week completed, scaling hypothesis not exercise; revised trigger applied.
- **Observation week (2026-08-18..2026-08-26)**:
  - Daily batch total runtime peaked at 283.7 s on 2026-08-20, fell to 162.1 s on 2026-08-25 after the 0.9.15 borrow fix cut redundant rounds.
  - Mean per-run duration rose from ~4.3 s (2026-08-12) to 10.1 s (2026-08-25), roughly double.
  - Scaling hypothesis NOT exercised: PROD user base unchanged (2 users, 1 with a watchlist), 8 watched rows, 58 stock_names.
  - Per-run growth (4.3s → 10.1s) is therefore NOT attributable to users × watched count.
- **Revised trigger**: Revisit RISK-002 if user growth or watchlist growth occurs, not on calendar. Current per-run baseline (10.1 s post-borrow-fix) is the new reference point.
- **Action on growth**: If user count or avg watched per user rises, monitor subsequent week of batch runtime and compare against 10.1 s baseline.

---

## 📝 Operational Notes

### DEV CRON_SECRET rotation (exposed in earlier session)

- **Status**: OPEN — deferred, user decided to record instead of rotate immediately.
- **Exposure**: DEV `CRON_SECRET` exposed in plaintext in session transcript on 2026-08-25. `/root/container/supabase/stock-pnl-web-dev/.env` still has mtime 2026-08-07 15:37 (unchanged since before exposure).
- **Rotation requirements** (when user authorizes):
  1. Generate new `CRON_SECRET` value.
  2. Update DEV `.env` at `/root/container/supabase/stock-pnl-web-dev/.env`.
  3. Recreate the functions container: `docker compose up -d --force-recreate functions` (from compose directory).
  4. Update the `x-cron-secret` header in all 6 DEV cron jobs using `alter_job(jobid, ...)` — update the `command` text to embed the new secret.
  5. Verify by re-hashing the updated commands, not by "no error" message.
- **Discovered**: Task 134, carried to BUG_FIX.md 2026-08-26.

### Supabase personal access token exposed in transcript (2026-08-26)

- **Status**: OPEN — requires revocation in Supabase console.
- **Exposure**: A Supabase personal access token was pasted into a session transcript on 2026-08-26 and was used again on 2026-08-26 to deploy the 0.9.19 PROD Edge Function (`stock-price`). Revocation is required.
- **Risk**: Supabase personal access tokens grant full management access to every project in the account (Management API, CLI for functions, database, secrets, project settings). Token has been actively used for privileged operations (function deployment). Revocation is the required action.
- **Action required**: Revoke the token in the Supabase console (Settings → Access Tokens). This action is the user's responsibility.
- **Discovered**: 2026-08-26.
- **Used for deployment**: 2026-08-26 (`supabase functions deploy stock-price --project-ref kxnxadaghidwumqsqneu`).

### Supabase personal access token exposed in transcript (2026-09-01)

- **What**: The user pasted a Supabase personal access token into the conversation to authorise the cron diagnosis. It is now in the session transcript.
- **Action required**: rotate it in the Supabase dashboard. This is the **third** such exposure recorded in this file, after the DEV `CRON_SECRET` (2026-08-25) and an earlier personal access token (2026-08-26).
- **Handling during this session**: used only as an environment variable, never echoed, never written to any file in the repo.
- **Status**: OPEN — user action
- **Recorded**: 2026-09-01 13:37:25 Asia/Taipei

---

### Supabase personal access token exposed in transcript (2026-09-04)

- **What**: The user pasted a Supabase personal access token into the `/goal` message to authorise the DEV and PROD Edge deployment. It is now in the session transcript.
- **Action required**: rotate it in the Supabase dashboard (Account → Access Tokens). This is the **fourth** such exposure recorded in this file, after the DEV `CRON_SECRET` (2026-08-25) and two earlier personal access tokens (2026-08-26, 2026-09-01). Four in eleven days is a pattern, not an accident: the working method that keeps producing it is pasting the secret into the conversation instead of running `supabase login` in the terminal. Prefer `! supabase login` in the Claude Code prompt — the CLI reads the token from its own interactive input and it never enters the transcript.
- **Handling during this session**: passed once to `supabase login --token`, which stores it under the CLI's own config outside the repository. Never echoed, never written to any file in the repository, never used in a query or a log line. Rotation is still required — the transcript is the exposure, not the storage.
- **Status**: OPEN — user action
- **Recorded**: 2026-09-04 19:45:00 Asia/Taipei

---

### Project-identity heuristic in `supabase-ops` skill is stale

- **Finding**: The `supabase-ops` skill's project-identity distinguishing heuristic states "batch_run_log: official area 2 / test area 0", used to infer which environment is live. As of 2026-08-26, DEV self-hosted has 242 rows in batch_run_log, and PROD has 565 rows. The count no longer reliably distinguishes DEV (test) from PROD (official) — both are growing with daily probe activity.
- **Cron.job row counts**: Both DEV and PROD have 6 jobs as of 2026-08-26 (after PROD cron cleanup), so this count also no longer distinguishes them.
- **Impact**: Agents relying on count-based heuristics would give false confidence about the target environment. Not a bug in the skill itself, but the distinguishing criteria have eroded.
- **Mitigation**: When operating on Supabase environments, use explicit paths for disambiguation. DEV operations on self-hosted should reference the compose file path directly (`/root/container/supabase/stock-pnl-web-dev/`); PROD operations on cloud should reference the explicit project ID (`kxnxadaghidwumqsqneu`). Do not rely on count-based heuristics that can drift over time.
- **Updated**: 2026-08-26; original finding 2026-08-24.

### Supabase Redirect URLs allow-list does not contain app origin

- **Status**: OPEN — requires Supabase console configuration.
- **Finding**: Signup confirmation link flow calls `signUp` with `emailRedirectTo`, so Supabase verifies the account and redirects back with `#access_token=...&type=signup`. The Supabase project's Redirect URLs configuration does not include the app's origin, so GoTrue rejects the `redirect_to` and falls back to `SITE_URL`. Evidence: DEV self-hosted compose `.env` has empty `ADDITIONAL_REDIRECT_URLS` and `SITE_URL` pointing at the Supabase API (`http://kong:8000`) rather than at the app; Supabase CLI has no access token available in this environment; PROD front-end deploy target currently unconfigured.
- **Consequence**: The signup confirmation flow works (account is verified), but the redirect lands at Supabase instead of the app, breaking the user's perception that anything happened. App catches the hash with `authRedirect.ts` on render, but only if the browser is at the correct origin.
- **Action required**: Add the app's origin to the Supabase project's Redirect URLs allow-list (Supabase dashboard → Project Settings → Auth → Authorized redirect URLs). Separate the URLs configured by app environment (DEV, PROD).
- **Discovered**: 2026-08-31, during signup confirmation link fix (Item 5).

---

**Historical notes**: BUG-026 (borrow flip dead on arrival) and BUG-027 (unordered 20-ticker sample
decided landing) fixed in **0.7.13** — see `FIXED_BUG.md`. BUG-024 fixed in **0.7.11** — see `FIXED_BUG.md`.

BUG-023 (manual 「全部執行」 opaque non-2xx) fixed in **0.6.47** — see `FIXED_BUG.md`.

BUG-011 (the after-close lock froze an intraday snapshot) was fixed as 0.6.37, deployed to both environments at
20:57 / 20:58, and moved to `FIXED_BUG.md`.

The 2026-07-28 look-back on BUG-004 (32-round day, 16:00–17:00 rounds, short-circuit ratio) is obsolete:
the scheduler has been reworked several times since, most recently in 0.6.32, and the timeline now reads from
`batch_run_log` directly. Nothing is pending from it.

---

## ⚠️ RISK — `breakEvenPrice` returns 0 for zero-cost holdings when `minFee` is undefined

- **Where**: `sources/src/utils/fees.ts:89-92` (after BUG-038 fix)
- **Condition**: `cost === 0` AND `minFee === undefined`
- **Consequence**: Return value is 0, which is also the documented "no answer" sentinel for the function. Cannot distinguish a real zero break-even from a failure.
- **Reachability**: Possible for non-TWD holdings through `sources/src/utils/holdingRows.ts` (minFee is undefined for non-TWD); rendered by `DashboardPage.tsx`.
- **Severity**: Low. No marker error. Row still renders; formula is just 0.
- **Status**: Pre-existing, not introduced by this session. BUG-038 fix did not change this case.
- **Discovered**: 2026-09-01, after BUG-038 fix

---

### BUG-042 — `listWorkspaces` 的退回重試會吞掉第一次的錯誤訊息
- **Where**: `sources/src/services/dataProvider.ts:183-191`
- **What**: When the retry succeeds (or a second error occurs), the first query's error is discarded. A real cause like missing column-level grant on `fee_rate` leaves no trace; `fee_rate` reads fail silently every time without diagnostic output.
- **Status**: ACCEPTED RISK — the project's production source contains no `console.warn` / `console.error` at all, so adding one would break existing style. Reviewer verdict: PASS.
- **Discovered**: 2026-08-31

### BUG-043 — `LocalProvider.setWorkspaceFeeRate` 對未知 id 靜默成功
- **Where**: `sources/src/services/dataProvider.ts:148-155`
- **What**: `setWorkspaceFeeRate(id, rate)` resolves without writing when `id` matches no workspace, so caller believes the rate was persisted.
- **Status**: ACCEPTED RISK — identical to existing `LocalProvider.renameWorkspace` pattern at the same file, so it is project style and not a regression. Reviewer verdict: PASS.
- **Discovered**: 2026-08-31



