# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 深度稽核九項查證與修正、0.9.34 發布與雙環境部署
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-05 09:22:10 Asia/Taipei

---

## 📅 Log: 2026-09-06 15:46:21 Asia/Taipei (Task 146, 0.9.35-dev.1)

**Spec 146 Phase 1 — the `app_log` capture layer and the admin "執行記錄" panel.**

The starting fact, from a codebase scout: nothing recorded causes. `stock-report/index.ts` had no `console.log` at all — an exception became an HTTP status and a response body nobody kept. The web services `catch` and `return null`, so a failure rendered an empty state. The four existing log tables (`batch_run_log`, `source_probe_log`, `source_probe_tick`, `admin_run_log`) store flags, durations and skip reasons. Spec 144 Feature 2 was already specified over exactly those four tables, which is why it could never have shown a front-end error: the data did not exist. Spec 146 adds the capture, and shares one panel with Spec 144.

**Applied to DEV** through `supabase db query --linked` with the `EXISTS (... command LIKE '%zyebvayngwrqzoaicbwd%')` identity guard inside the write. Verified on DEV: `is_dev=true`, table present, RLS on, `policies=1`, `select_policies=0`, `idx=4`, RPC present, `service_role` EXECUTE true, `authenticated` EXECUTE false, `cron_jobs=7`, `prune_job=1`. **DEV cron job count is now 7, not 6** — `CLAUDE.md` and older PROGRESS entries name 6. The count was never a valid identity check; the `EXISTS` predicate on the project ref is.

**Three defects found during the build, none of which any green gate could see:**

1. **`try { return promise }` does not catch a rejection.** The first version of the outermost catch covered 3 of 20 dispatch branches in `stock-report` and 0 of 5 in `stock-price`; the rest returned an unawaited promise whose rejection escaped the `try`. `npm run build` and `npm run typecheck:edge` were both green. All 24 handler returns are now `return await`.
2. **A POST body of the literal JSON value `null` produced no response at all.** `null` is valid JSON, so the parse `catch` never fires; `body.action` then throws a `TypeError`, and the new outermost catch threw a second time reading the same `body.action`, escaping `Deno.serve`. Reachable with no credential. Before this task's catch existed the same input produced an empty 500 — the new error handling made it strictly worse until the guard was added after the parse in both functions. Found by `reviewer`.
3. **`fetchAppLogs` omitted `timeout` on `functions.invoke`**, breaking the project's structural contract in `src/services/invokeTimeout.test.ts`. `supabase-js` has no default, so a hung Edge Function leaves the spinner turning forever. Now 20 s.

**Redaction is a key allowlist, not a denylist**, at every depth including inside arrays, with `stack` truncated to 2000 characters, other strings to 500, and arrays capped at 20 elements. The array cap exists because `app_log.detail` has no size CHECK in the database: `pg_column_size` is not immutable and does not belong in a CHECK constraint. A denylist fails open, and this project already has a precedent — a redaction regex once printed the DEV `CRON_SECRET` into a transcript.

**Verification**: `npx vitest run` 100 files / 1710 tests passed, exit 0. `npm run build` exit 0. `npm run typecheck:edge` exit 0. `npx oxlint src` 0 errors. `reviewer` verdict FAIL on the first pass (two BLOCKERs, both real), PASS after the fix.

**Not done**: Phase 2 (ErrorBoundary and service-level capture), Phase 3 (transaction write path), and the DEV Edge deploy. Edge-side capture exists in source only.

---

## 📅 Log: 2026-09-05 09:21:54 Asia/Taipei (深度稽核九項查證與修正、0.9.34 發布)

- **Status**: ✅ **COMPLETED** —— 已合併 `main`，DEV 與 PROD Edge 均已部署並驗證
- **Version**: `0.9.33` → **`0.9.34`**（`main` 與 `dev` 同為 `2799991`）
- **緣由**: 使用者先問「有確認過 Antigravity 找出的 BUG 都屬實嗎」，接著指示「依查證屬實的部分修復、驗證並直接部署合併」。

### 查證（先於修復）
九項深度稽核發現先前只被歸檔、未經查證。逐條核對後：**七項完全成立、兩項部分成立、無一被駁回**。
同時修正原報告四處錯誤主張：BUG-066 第 5 處成因實為 GoTrue Admin API 分頁而非 PostgREST `max_rows`
（照原歸因實作會白做工）；BUG-066 引用 `config.toml` 作為雲端證據但該檔管的是本機堆疊；
BUG-068「鎖死」誇大（輸入框未 disabled）；BUG-069「無條件上傳」不正確（在 `if (regenerate)` 內）。

### 修復
三波 builder，主 session 先寫 15 個失敗測試作為契約。三項 P0 都是融券帳務的靜默金額錯誤。
`route:reviewer` 判定 **FAIL** 並攔下兩個 BLOCKER，皆於同版修正並各自補測試：
- **BUG-072**：`handleAdminStatus` 的 `pagedSelect` 呼叫端忽略 `r.error`，把分頁中途失敗的部分資料
  當成完整結果 —— 正是分頁工作要消除的缺陷，在呼叫端被重新引入。由 0.9.34 自身引入。
- **BUG-073**：BUG-067 讓融券列首次可被選取後，暴露出股數與均價取自共用多頭腿、損益取自選中列的
  接縫，同檔有多空時畫面數字自相矛盾。

### 兩個由本專案自身修正引入的缺陷（模式相同，值得記住）
- **BUG-069** 的可觸發性來自 0.9.32 的 BUG-053：加上逐筆 `try/catch` 之前，例外會中止整輪，
  manifest 根本不會被寫入。
- **BUG-073** 的可達性來自本版的 BUG-067。
兩者都是「修好一個缺陷，讓另一個原本到不了的缺陷浮現」。修正本身都沒錯，但**修好一個可達性問題時，
要一併檢查它讓什麼變得可達**。

### Verify
`npm run build`、`npm run typecheck:edge`、`npm run lint` 全部 exit 0；
`npx vitest run` 99 檔 / **1,684** 項通過（新增 15 項）。

### Edge Function 部署（2026-09-05 01:26–01:41 UTC）
使用者於本輪明確授權新 token 後完成。**DEV 先行，確認部署後的 cron 回 200 才推 PROD** ——
BUG-070 改動了 `backup-transactions` 的 `CRON_SECRET` 比對方式，若有缺陷會讓兩環境的備份排程全部 401。

| Function | 版本 | Hash | verify_jwt |
| --- | --- | --- | --- |
| `stock-report` | v6 → **v7** | `9ad5501c…` → `c4a1f053…` | false ✓ |
| `backup-transactions` | v2 → **v3** | `32d4fac…` → `7c05cd47…` | false ✓ |
| `stock-price` | v4（0.9.34 未動，未重新部署） | `9609330f…` | true ✓ |

兩環境部署後三個 function 的 `ezbr_sha256` 完全一致。
- **DEV** 01:30 UTC 回 200，部署後零非-200。
- **PROD** 01:40 UTC 回 200，部署後零非-200；`verify_setup()` 十項全 PASS，`cron target host` 正確。
- 查詢完畢後 link 已還原回 DEV。

**0.9.34 至此完整上線**：程式碼、`main`、GitHub Release、兩環境 Edge 全部到位。

