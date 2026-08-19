# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.8.1 bugfix release recording
- Status: **✅ RECORDED**
- Timestamp: 2026-08-19 11:58:53 Asia/Taipei

---

## 📅 Log: 2026-08-19 11:58:53 Asia/Taipei (0.8.1 bugfix — management panel placement and watched stock pricing)

- **Release**: Version 0.8.1 bugfix on 0.8.0 (Frontend only).
- **What was fixed**:
  - **BUG-030 — 管理觀察 button looked dead**: `WatchlistPanel` was rendered as a flat inline section after `<StockDetailPage>`, placing it far below the fold. Fix: wrap in `Modal.tsx` (portals to `document.body`, brings overlay, Esc handler, single close button). Root cause: jsdom has no layout, so all 1058 unit tests passed while the feature was unusable in browser.
  - **BUG-031 — watched ticker had no quote**: `AnalysisPage` passed `quote={null}` for every watch entry because `useStockPrices` only covers holdings. Fix: for the selected watched entry, fetch `fetchPrices([{ market: 'TPE', ticker }])` from `priceProxy.ts`, with `cancelled` flag in effect cleanup to prevent stale responses from overwriting. Failure leaves quote null, never blocks rendering.
- **Correction recorded**: Earlier claim that "chips stay empty until nightly batch" was incorrect — chips appear immediately because `reportProxy` falls back to Edge `generate` action when batch file is missing; browser console 400 is expected and handled.
- **Testing**: Unit tests: `npx vitest run` → 72 files, **1060 passed**, 0 failed. Types/lint/build: `npx tsc --noEmit` 0 errors; `npx tsc -p tsconfig.edge.json` 0 errors; `npx oxlint src supabase` 0 errors; `npm run build` ok. **Browser E2E (Playwright against DEV, new)** — 12/12 steps: 進個股分析 → 管理觀察可見 → 面板出現在可視範圍內 (y=49, viewport 800) → 搜尋並加入 1101 → 關閉 → 下拉觀察組出現 1101 → 選取後頁面渲染 → 觀察股取得報價 → 損益試算可開且無 NaN/Infinity → 試算帶入現價 24.2 當預設買進價 → 算出回本價 → 移除 1101 還原 DEV 資料。
- **Reviewer verdict**: Lane 1. Two RISKs raised: (1) **Accepted** — watched entry deleted while viewing falls back to another without signalling; user removed it themselves, fallback is reasonable. (2) **Rejected as incorrect** — workspace switch could leave stale watchlist; `tw_watchlist` keyed by `user_id` only, schema says "Per-user, not per-workspace", no per-workspace watchlist exists to go stale.
- **Unfinished**: None — complete release.
- **Commit**: `cbbdba0` (0.8.0, version files bumped for 0.8.1).

---

## 📅 Log: 2026-08-19 11:29:34 Asia/Taipei (0.8.0 post-release deployment — watchlist and P&L simulator)

- **Deployment**: Version 0.8.0 schema and Edge functions deployed to DEV and PROD; merged `dev` → `main`.
- **What was deployed**:
  - Schema: `tw_watchlist` max cap 5 → 30, trigger renamed `tw_watchlist_max5` → `tw_watchlist_max30` with compatible dual drop.
  - Edge (`stock-report`): Whitelist logic expanded from "held only" to "held ∪ watched"; new functions `watchedTwTickers()`, `allowedTwTickers()`; `batchTwTickers()` returns union; 403 message updated to "僅限持有或已加入觀察清單的台股代號".
- **Deployment sequence**:
  1. **DEV schema migration** — Applied via `docker exec stock-pnl-web-dev-db-1 psql`. Before: `tw_watchlist_max5`, cap 5, 2 rows. After: `tw_watchlist_max30`, cap 30, 2 rows preserved. DEV identity confirmed: `batch_run_log = 142`.
  2. **DEV Edge deploy** — Volume copy `index.ts` + `batchTickers.ts` into `/root/container/supabase/stock-pnl-web-dev/volumes/functions/stock-report/`, then `docker compose up -d --force-recreate functions`. Confirmed in container: `allowedTwTickers` appears 5 times, new 403 guard string appears twice.
  3. **DEV end-to-end verification** — Called `generate` action (signed-in user):
     - Ticker `2327` (on watchlist, held by nobody): **HTTP 200**, produced report `20260818_2327_…`. Pre-0.8.0 code returned 403 for this path.
     - Ticker `1101` (neither held nor watched): **HTTP 403** with new message, confirming whitelist widened without becoming open.
     - Ticker `2059` (held): **HTTP 200**, no regression on existing path.
     - Unauthenticated call: **401**, confirming `assertUser` still runs before whitelist check.
  4. **PROD schema migration** — Applied via Supabase Management API with explicit project ref `kxnxadaghidwumqsqneu`. Before: `tw_watchlist_max5`, cap 5, 0 rows. After: `tw_watchlist_max30`, cap 30, 0 rows. PROD identity confirmed: `batch_run_log = 441`.
  5. **PROD Edge deploy** — `supabase functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt` from `sources/`. Version 53 → **54**; `ezbr_sha256` changed; `verify_jwt` remains **false** (unchanged, correct for after-hours cron). PROD unauthenticated call returned 401, confirming function is live.
  6. **Merge to main** — Fast-forward `ab03d9d..cbbdba0`, pushed. Both `dev` and `main` now at `cbbdba0`; Pages deploys 0.8.0.
- **What was NOT proven on PROD**: The watched-ticker allow path verified end-to-end on DEV (identical bundle), but not re-exercised on PROD because `tw_watchlist` is empty and requires a signed-in browser session. First real PROD exercise happens when a user adds a watched ticker.
- **Correction**: ~~Watched ticker's chips remain empty until the nightly batch runs~~ **Chips appear immediately** — when the published batch file is missing, `reportProxy` falls back to the Edge `generate` action, which is now open to watched tickers (not just holdings). The browser console shows 400 on the missing file read; this is expected and handled, not a fault. Users do not need to wait for the nightly batch.
- **Commit**: `cbbdba0` (0.8.0).
