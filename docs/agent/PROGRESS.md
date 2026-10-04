# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 193 — codebase review fixed on `dev` (0.10.29-dev.4)**; `main` is still 0.10.28 (Task 192's PROD Edge and 191 item 5 dated checks unchanged).
- Status: ✅ code + DEV (DDL, 3 Edge functions) done and verified; ⏳ PROD DDL/Edge, two damaged Release titles, and the release itself wait for the user's OK. Open: Task 193 items 5–7, Task 192 item 5, Task 191 item 5.
- Timestamp: 2026-10-04 15:07:11 Asia/Taipei

---
## 📅 Log: 2026-10-04 15:07:11 Asia/Taipei (Task 193 — codebase review fixes, 0.10.29-dev.1…4)
- **Ask**: full review of the codebase for hidden defects and optimisations; user chose all four areas, report first, then fixed B1–B4 and "cite the source before touching the ETN rate". Report: `specs/193-codebase-review-2026-10-04.md`.
- **Found / fixed** (BUG-113…116; `dev` only, nothing on `main`): H1 取代 CSV import duplicated dividends; H2 `take_warm_quota` executable by `anon` (DEV query proved it; now 401); H3 nightly whitelist counted dividends as sells and netted across users (DEV: 2609 was kept although closed). B3: release-script titles ran through a shell, `restore.cjs` argv limit (E2BIG at 128 KiB, proven), `generate` meter 150/day, `app_log_size_check`. B2: edit-mode min fee, rate carry-over, ETN 0.1% (§2 款二 + 金管會 107-07-02 via 證交所), watched-stock quote/seed/polling, `1y` by date, fallback-quote TTL, monthly 全部 wording, intraday errors reach callers, 國際指數 per-ticker guard. B4: hidden-tab polling, 5-min refresh throttle, hover isolation, Fx refresh in place, war-room retire rule from the server plan, dead code and duplicates, cache bounds.
- **Verified**: every batch ran lint, `npm run build`, `typecheck:edge`, `sync:edge-engine --check` and vitest (final 2,942 pass / 7 skipped, +58 over 0.10.28); new tests were run against the old code first. DEV: schema REVOKE and `app_log_size_check` applied (guarded by the DEV cron predicate, `verify_setup()` 11/11 PASS); `stock-report` v45→v46 `5977623f…`, `stock-price` v29 `bee3895c…`, `backup-transactions` v7→v8 `6bfb84af…`, all from clean commits (last `34961d5`); smoke: anon `take_warm_quota` → 401, `generate` without a user → 401, the other two → 401 without the cron secret.
- **Incident**: while editing `sync-github-releases.cjs` two probes (`require`, then `--help`) executed it live and created a public Release+tag `0.10.29` on `dev` HEAD, twice; both deleted within ~2 min (`gh release delete 0.10.29 --cleanup-tag --yes`), 0.10.28 is Latest again. The script now refuses unknown flags and does nothing on `require`.
- **Not verified**: no Playwright run (stock analysis needs cloud mode); PROD has none of the DDL or Edge changes.
- **Left** (Task 193 items 5–7): PROD DDL (H2 REVOKE, `app_log_size_check`) and PROD Edge (3 functions) on explicit OK; repair the 0.9.35 / 0.9.33 Release titles (ask first); `ship` when asked — CHANGELOG 0.10.29 entry must be final before the `main` push. Deferred items: BUG-112.
## 📅 Log: 2026-10-04 12:42:09 Asia/Taipei (BUG-111 — 頁面發生錯誤 on tab switch, 0.10.28-dev.1)
- **Ask**: 「切換的時候很常出現頁面發生錯誤」.
- **Root cause**: stale tab after a deploy requests old hashed lazy chunks; Pages returns index.html (200 text/html) → dynamic import fails → root ErrorBoundary. PROD `app_log` render errors (30 d) are all this, each from a client one release behind.
- **Done**: `src/utils/chunkReload.ts` `loadChunk` around all 9 dynamic imports — reload once (30 s sessionStorage guard), else rethrow.
- **Verified**: vitest 2,884 pass / 7 skipped (+5 `chunkReload.test.ts`); build; `typecheck:edge`. Playwright, local-mode prod builds behind a Pages-style fallback: before → 頁面發生錯誤 reproduced; after → one reload, 年度收益 renders; permanently broken chunk → one reload then ErrorBoundary.
- **Released** (2026-10-04 12:49:25, user OK): 0.10.28 fast-forwarded to `main` `7ec1ffe`; Pages production bundle carries `chunk-reload-at`; Release 0.10.28 by CI.
- **Left**: watch PROD `app_log` — `dynamically imported module` render rows should stop from clients ≥ 0.10.28.
