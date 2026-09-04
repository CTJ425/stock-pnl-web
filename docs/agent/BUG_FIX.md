# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-04 20:08:47 Asia/Taipei

---

## 🔍 Codebase audit 2026-09-04 (follow-up) — `stock-report/index.ts` 未覆蓋範圍

前一次稽核在 4,236 行的 `stock-report/index.ts` 中只逐行讀了約 900 行，並在
「未覆蓋範圍」記下三段未展開：1200-2280、3400-3760、3900-3925。本次以兩個
平行 read-only 審查把 1200-2290 與 3400-3930 完整讀完，補上該缺口。

**結果：5 項可證明的缺陷，全部於 0.9.33 修正**（`FIXED_BUG.md` BUG-057 … BUG-061）。
授權面另有一項明確的陰性結論：`admin-status` / `admin-users` / `admin-set-role` /
`admin-backups` / `admin-backup-url` / `admin-backup-restore` 六個 handler 全數在
dispatch 層由 `assertAdmin` 把關，`backfill-*` / `sync-*` 走 `assertCronSecret`，
兩種機制沒有交叉錯配，**未發現授權繞過路徑**。

審查另主動查證並駁回一項既有疑慮：`handleAdminStatus` 直接回傳
`source_probe_tick.fingerprint` 曾被記為會外洩 `twt38u` 的原始表格內容，但現行
`twt38u` 分支已改用 `foreignTopFingerprint()`（長度 + djb2 雜湊），該疑慮不成立。

---

## 🔍 Codebase audit 2026-09-04 — six fixed in 0.9.32-dev.1, one accepted

Triggered by BUG-049. Three parallel read-only reviews covered `supabase/functions/`, `src/services/` +
`src/utils/` + `src/types/`, and `src/components/` + `src/context/`. **No code was touched.** Ranked by what
it costs if it bites. The main session verified each entry below by reading the cited lines; one further
reviewer claim (a `chip_raw_cache` upsert missing `onConflict`) was **rejected** — `chip_raw_cache_pkey` is
`PRIMARY KEY (ymd, dataset)`, so the default upsert target is correct.

> **六項已修，一項判定為可接受風險。** AUDIT-09、11、12、13、14、15 於 0.9.32-dev.1 修正
> （`FIXED_BUG.md` BUG-051 … BUG-056）。**AUDIT-10 不改程式**：「2.500」在台美股都可能是合法的
> 2.5 元，加規則拒絕它會擋掉正常匯入；多組點號如「1.234.567」目前已是 `NaN` 會報錯，真正的破口
> 只有「單組三位數」這種本質上無法區分小數與千分位的形式。台灣券商匯出使用逗號千分位，不會觸發。
> 使用者於 2026-09-04 確認此方向。下列清單保留為稽核發現的紀錄與各項為何重要的說明。

### AUDIT-09 — 反向分割可產生 0 股但保留原手續費的買入紀錄，永久墊高平均成本
- **Proven by reading**: `StockSplitModal.tsx:112` `newQty = Math.round(tx.qty / ratio)` 沒有下限檢查；
  `:119` 只有在 `tx.fee_tax === 0 && autoFillZeroFee` 時才重算手續費，原本非 0 的 `fee_tax` 原封不動帶過；
  `:164` `handleConfirm` 的守門只有 `busy || previewItems.length === 0 || !isValidRatio`，沒有擋 `newQty === 0`。
- **Proven by reading**: `pnlEngine.ts` BUY 分支 `pos.cost += totalCost` 且 `totalCost = tx.price * effQty + effFeeTax`。
  `effQty` 為 0 而 `effFeeTax` 非 0 時，`pos.cost` 增加但 `pos.qty` 不變。
- **Failure scenario**: 持有 3 股的零股，做 10 併 1 反向分割。`Math.round(3/10) = 0`，預覽欄位顯示 0 但不擋確認。
  確認後該標的的平均買入成本與保本賣出價被幽靈手續費墊高，直到整個部位全數賣出才歸零。
- **Severity**: HIGH（靜默的金額錯誤）

### AUDIT-10 — CSV 匯入把「以點為千分位」的數字少算 1000 倍且不報錯
- **Proven by reading**: `csv.ts:93` 的清理正規式只移除 `NT$ US$ $ , 空白 ( )`，不處理點號千分位；
  `:95` 直接 `Number(cleaned)`。
- **Failure scenario**: 交易單價欄位為 `"2.500"`（某些地區匯出代表 2500）解析為 `2.5`，是有限正數，
  通過 `price > 0` 驗證，不產生 `CsvRowError`。該筆交易金額少算 1000 倍，靜默污染移動平均成本。
- **Severity**: MEDIUM（台灣券商匯出用逗號千分位，觸發需特定來源檔）

### AUDIT-11 — 批次更新（分割換算、手續費重算）中途失敗沒有回滾，留下混合狀態
- **Proven by reading**: `StockSplitModal.tsx:168-181` 與 `RecalcFeesModal.tsx:51-63` 都是
  `for (const item of previewItems) { await updateTransaction(...) }` 包在單一 `try` 內，
  失敗處理只有 `catch (err) { setError(...) }`。
- **Failure scenario**: 20 筆分割換算做到第 8 筆時網路中斷。前 7 筆已是分割後數量與價格，後 13 筆仍是分割前，
  同一標的的 `qty` / `cost` 混用兩種股數基準，畫面只顯示一句「更新失敗」，不指出哪幾筆已套用。
- **Severity**: MEDIUM

### AUDIT-12 — `assembleOne` 拋錯會中斷整個 chips 產生階段
- **Proven by reading**: `supabase/functions/stock-report/index.ts:3071` 的迴圈本體直接呼叫 `assembleOne`，
  沒有逐筆 `try/catch`；`uploadJson` 自己吞例外，`assembleOne` 不會。
- **Failure scenario**: 一檔標的的資料形狀超出 `assembleOne` 的防禦，例外往上傳到 `handleGenerateAll` 的
  `try/catch`，該輪迴圈中止，排在它後面的標的與後續 phase 這一輪都拿不到報告。
- **Mitigation in place**: 5 分鐘後的下一次 cron 會自我修復，因此是可用性/延遲風險，不是資料損毀。
- **Severity**: MEDIUM

### AUDIT-13 — `assertCronSecret` 用一般字串比較，非固定時間比較
- **Proven by reading**: `supabase/functions/stock-report/index.ts:899-903`
  `if (!expected || got !== expected) return json({ error: 'Unauthorized' }, 401)`。
- **Failure scenario**: 理論上可對公開的 `--no-verify-jwt` 端點做時序側通道量測，逐位元組縮小 `CRON_SECRET`。
  在 HTTPS 與 Deno 網路抖動下實際可利用性低，但比較本身未加固。
- **Severity**: LOW

### AUDIT-14 — 盤中走勢圖的漲跌百分比未防除以 0
- **Proven by reading**: `IntradayChart.tsx:50-52` `const p = (change / base) * 100` 沒有 `base === 0` 檢查；
  `:181` `pct(change, prevClose as number)` 只擋 `null`，不擋 `0`。
- **Proven by reading**: 同一份程式庫的 `DashboardPage.tsx:57`、`QuoteTab.tsx:169`、`WatchSection.tsx:273`
  在相同計算上都明確寫了 `prevClose !== null && prevClose !== 0`，可見團隊知道 0 是真實會出現的資料狀態。
- **Failure scenario**: MIS 報價回傳 `prevClose: 0` 時，tooltip 直接印出 `漲跌 +123.00 (Infinity%)` 或 `(NaN%)`。
- **Severity**: LOW（僅顯示，不影響帳務）

### AUDIT-15 — `parseTxDate` 的正規式沒有錨定結尾，會靜默誤讀日期
- **Proven by reading**: `csv.ts:72` `/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/` 只錨定開頭，尾端多餘字元被丟棄。
- **Failure scenario**: 日期欄位誤打成 `"2024/01/105"` 時，`\d{1,2}` 貪婪取到 `10`，剩下的 `5` 被忽略，
  解析為 `2024-01-10` 而不是拒絕，靜默把交易記到錯誤日期。
- **Severity**: LOW

### 檢查過但未發現缺陷的類別
- Edge Functions：單位換算（匯率、籌碼股數 vs 金額、千元 vs 百萬元）、時區與日界（Asia/Taipei、DST）、
  外部 API 回應的 null 防禦、`JSON.parse` 例外包覆、秘密外洩到 log 或回應主體。
- services / utils：快取 TTL 與快取鍵碰撞、`||` 誤用於可為 0 的數值、浮點誤差外漏到顯示金額。
- components：受控輸入吞值、陣列索引當 key、非同步回應覆蓋較新狀態（皆已用序號或 cancelled 旗標處理）。

### 未覆蓋範圍
`supabase/functions/stock-report/index.ts` 共 4211 行，本次僅targeted 讀取約 900 行，
約 1200-2280、3400-3760、3900-3925 三段未展開。該段落已用 grep 掃過
（未檢查的 `.error`、`||` 對數值欄位、未包覆的 `JSON.parse`）且無命中，但 grep 不能取代控制流閱讀。
**已於 0.9.33 補讀完畢**：1200-2290 與 3400-3930 兩段已完整逐行讀過，發現 5 項缺陷（見上方 follow-up 稽核段落）。3900-3925 落在後者範圍內。

> **All eight are done.** AUDIT-01 … 04 in 0.6.42 (`FIXED_BUG.md` BUG-015 … BUG-018, Edge halves deployed to both
> environments 2026-08-06 01:2x), AUDIT-05 … 08 in 0.6.43 (BUG-019 … BUG-022). The list below is kept as the record
> of what the audit found and why each mattered.

## 🔍 Codebase audit 2026-08-06 —— findings only, nothing changed

A read-through of the core logic (`pnlEngine`, `fees`, `csv`, `priceProxy`, `pollPlan`, `twChips`, `macroCalendar`,
`fxConvert`, the two Edge Functions and the admin page) looking for defects and for values that are written to drift.
**No code was touched.** Ranked by what it costs if it bites; each entry states what is proven and what is inferred.

### AUDIT-01 — The trial-matching price is shown as 現價 with no marker outside the quote card
- **Proven by reading**: `priceProxy.ts` carries `trial` on every quote (set from MIS `ip`), `QuoteTab` is its **only**
  consumer, and `buildHoldingRows` never reads it —— the dashboard's 現價 column and 未實現淨損益 take `quote.price`.
- **Why it matters**: during 08:30–09:00 and 13:25–13:30, MIS's `z` is the **indicative auction price**. Nothing was
  traded at it. For that hour the dashboard prints a P&L computed from a price that does not exist yet, and says
  nothing about it —— while the quote card one page away labels the very same number 「試撮中」.
- **Not yet observed in the wild**: this is a reading of the code, not a report. Task 69 item 2 (watch a trial window)
  would confirm it on screen.
- **Cheapest fix if wanted**: carry `trial` into `HoldingRow` and mark the cell, the same way `stale` already is.

### AUDIT-02 — The Yahoo fallback silently defeats the after-close lock, and nothing caps it
- **Proven by reading**: the Yahoo path in `stock-price/index.ts` always returns `tradeTime: null`, and since 0.6.37
  `twQuoteTtlMs` treats a missing matching time as "not settled" → 60-second TTL **at any hour**.
- **Consequence**: while MIS is unavailable, every TW quote refetches once a minute all night, for every user, with
  no backoff and no daily cap. 0.6.37 accepted this deliberately ("an abnormal state should keep retrying") but the
  retry is unbounded, and the state is invisible on screen.
- **Second-order**: the two sources disagree on volume by about 10% (measured 2026-08-05 on 2330: MIS 31,851 張 vs
  35,214 張 from the daily batch, which is the Yahoo-calibre figure). A fallback therefore shifts a displayed number
  by ~10% with no source marker.

### AUDIT-03 — `sliceByRange` loses 1–3 days whenever the series ends on a 29th–31st
- **Proven by execution**: `fxConvert.ts` does `d.setUTCMonth(d.getUTCMonth() - months)`, which overflows on
  month-end dates. Verified with node: `2026-05-31` minus 3 months gives **2026-03-03** (not 02-28), and
  `2026-03-31` minus 1 month also gives **2026-03-03**.
- **Impact**: the FX range picker quietly returns a window short by up to three days. Invisible —— the chart just
  starts a little later than the label claims.

### AUDIT-04 — The T86 fingerprint joins cells with an empty string
- **Proven by execution**: `pollPlan.ts` `sortedRows` uses `row.join('')`, and `['12','3'].join('')` equals
  `['1','23'].join('')`. Two different rows can produce the same string.
- **Why it matters more than it looks**: this fingerprint is the gate that decides whether today's T86 is **finalised**
  (`nextT86State` freezes after N identical polls). A collision means a real revision reads as "unchanged".
- **Probability is low** (fixed-arity numeric columns) but the fix is one character —— a separator that cannot occur
  in the data.

### AUDIT-05 — `describeCron`'s silent fall-through is a defect generator
- Two bugs in one evening (BUG-012, BUG-014) had the same shape: a cron shape with no branch falls through to
  `return expr`, and a raw cron string on screen looks like a deliberate rendering rather than a failure.
- **Suggestion, not a bug**: make the fallback self-announcing (e.g. prefix 「未解析」) so the next unmatched shape is
  obvious the moment it appears, instead of waiting for a user to notice that a time looks wrong.

### AUDIT-06 — `writeStore` is the one unguarded localStorage write
- `dataProvider.ts` writes the local-mode ledger with no `try`, while `priceProxy` / `twMarketData` / `aiChatStore`
  all guard theirs. A quota or private-mode failure throws out of the save path with no message.
- **Arguably correct to fail loudly** for user data —— silently dropping a transaction would be worse. What is wrong
  is that it fails *unhandled*: the user sees nothing.

### AUDIT-07 — `shiftPeriod` breaks for negative period arithmetic
- `macroCalendar.ts` computes `total % 12` on `y * 12 + m - 1 + n`. JavaScript's `%` keeps the sign, so a negative
  total yields a negative month. Unreachable at today's years; a trap for whoever first calls it with a large
  negative `n`.

### AUDIT-08 — 「顯示全部」 on the new market volume table cannot reach the whole file
- `SHOWN_DAYS = 60` slices the days before the table sees them, while `market/daily.json` keeps up to
  `MARKET_DAYS_CAP = 120`. The button names the number it will show, so nothing lies —— but 「全部」 means "all 60 of
  the 60 I was given", not "everything on file". Introduced by me in 0.6.38.

---

## 🐛 Currently Active / Open Bugs

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

## 🐛 BUG-040 — WITHDRAWN (2026-09-01)

- **Finding**: "Admin self-revocation without confirmation" — premise is false.
- **Investigation**: `handleAdminSetRole` in `sources/supabase/functions/stock-report/index.ts:3700-3702` refuses self-revocation server-side (`if (userId === targetUserId && !targetIsAdmin) throw`). `setUserAdmin` in `AuthContext.tsx` unwraps that error message. `AccountsSection.test.tsx` already pins the UI behaviour (button stays enabled and unchanged on error).
- **Conclusion**: No code change needed. Existing test already covers the guard. Entry withdrawn from open bug list.

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



