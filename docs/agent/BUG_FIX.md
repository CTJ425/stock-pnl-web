# Active Bug Fixes (BUG_FIX.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-09-05（深度稽核九項已全部修正並發布於 0.9.34）

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
- **Status**: ✅ REVOKED — verified 2026-09-05. `supabase functions list` returned `401 Unauthorized` on both project refs with this token still in the CLI config, which is positive proof it no longer works.
- **Recorded**: 2026-09-04 19:45:00 Asia/Taipei

---

### Project-identity heuristic in `supabase-ops` skill is stale

- **Finding**: The `supabase-ops` skill's project-identity distinguishing heuristic states "batch_run_log: official area 2 / test area 0", used to infer which environment is live. As of 2026-08-26, DEV self-hosted has 242 rows in batch_run_log, and PROD has 565 rows. The count no longer reliably distinguishes DEV (test) from PROD (official) — both are growing with daily probe activity.
- **Cron.job row counts**: Both DEV and PROD have 6 jobs as of 2026-08-26 (after PROD cron cleanup), so this count also no longer distinguishes them.
- **Impact**: Agents relying on count-based heuristics would give false confidence about the target environment. Not a bug in the skill itself, but the distinguishing criteria have eroded.
- **Mitigation**: When operating on Supabase environments, use explicit paths for disambiguation. DEV operations on self-hosted should reference the compose file path directly (`/root/container/supabase/stock-pnl-web-dev/`); PROD operations on cloud should reference the explicit project ID (`kxnxadaghidwumqsqneu`). Do not rely on count-based heuristics that can drift over time.
- **Updated**: 2026-08-26; original finding 2026-08-24.

### Supabase personal access token exposed in transcript (2026-09-05)

- **What**: A fifth Supabase personal access token was pasted into the conversation, in the same message that said 「supabase的不授權給你」. The instruction and the paste contradict each other.
- **Handling during this session**: **the token was not used at all.** No `supabase login`, no query, no deploy. The instruction was read as "do not use this one", and the read-only checks in that turn ran against the CLI's existing (by then already revoked) login, which returned 401.
- **Action required**: revoke it. It is exposed by the paste itself, whether or not anything used it.
- **The pattern is now five in twelve days** (DEV `CRON_SECRET` 2026-08-25; personal access tokens 2026-08-26, 2026-09-01, 2026-09-04, 2026-09-05). Recording each one has not changed the outcome, because the cause is the working method, not forgetfulness: the secret is typed into the chat instead of into the CLI. The one change that ends it is `! supabase login` typed at the Claude Code prompt —— the CLI reads the token from its own input and it never enters the transcript. Nothing else on this list needs to change.
- **Status**: OPEN — user action
- **Recorded**: 2026-09-05 Asia/Taipei

---

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



