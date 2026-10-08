# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.36 released** — OTC daily fix (BUG-117), `db-migrate.sh` restores Edge + cron + Auth URLs in one run (BUG-118), plus the Fugle removal from dev.1.
- Status: ✅ `main` = `dev` = `cc07a8d`, Release 0.10.36 by CI; Edge 0.10.36 on DEV and PROD, PROD Auth URLs set, both verified (Task 198 item 2).
- Timestamp: 2026-10-08 15:07:18 Asia/Taipei

---

## 📅 Log: 2026-10-08 15:07:18 Asia/Taipei (PROD restore follow-up; BUG-117, BUG-118; release 0.10.36)
- **Ask**: after restoring the PROD backup into a new project: why the cron secret hash differed, why quotes failed, fix it; review the backup / migrate / deploy scripts; merge the Edge deploy into the migration and E2E it on `accmczhrqsilzrtyhyxa`; then 「直接幫我合併到main」.
- **Found**: new PROD `zizndnzibubcqdvnuhwr` had zero Edge Functions (BUG-118) and Auth URLs on localhost; DEV's different hash was the `--new-cron-secret` choice (by design). PROD fixed by hand: functions deployed, `CRON_SECRET` = cron (`21d0257c…`), `fx-daily` call 200, `verify_setup()` 10 PASS + http 200, counts = backup. 6560 missing daily → BUG-117.
- **Done**: `yahooDailyRows` (BUG-117); `db-migrate.sh` merged deploy (BUG-118) — see FIXED_BUG for the E2E evidence; README migration section rewritten. Rebased onto `c02ef99` (Fugle removal) — `syncDaily` conflict resolved without Fugle. Gates: `npm test` 3,091 pass / 7 skipped, build, `typecheck:edge`. Released 0.10.36 (`b101500` dev.2, `cc07a8d` release), CI Release body checked.
- **Not done**: PROD Edge deploy + Auth URLs (Task 198 item 2); CLAUDE.md/skill refs (item 5); script gaps (item 6); credential rotation (item 7).
## 📅 Log: 2026-10-08 13:07:25 Asia/Taipei (Task 198 — remove Fugle, 0.10.36-dev.1)
- **Ask**: 「把之前富果的功能給刪掉，一樣維持在MIS->Yahoo就好，另外在看目前現價抓取的機制、Cache、與建議改善方式」.
- **Done**: local `dev` was 20+ commits behind `origin/dev` — pulled first. Only the five Fugle commits (`ceb539e`, `f00092a`, `5d6e82a`, `eafc817`, `5a5e2ad`) touched `stock-price/index.ts`, `stock-report/index.ts`, `twDaily.ts`, so those three were restored from `ceb539e^`; deleted `_shared/fugle.ts`, `stock-price/fugleParse.ts`(+test), `stock-report/fugleDaily.ts`(+test). README + `sources/supabase/README.md` Fugle lines removed. `grep -i fugle sources README.md` is empty. Left as history: spec 195, `docs/architecture/1006.md`, CHANGELOG 0.10.33.
- **Verified**: `npm run build`, `typecheck:edge`, vitest 3,087 pass / 7 skipped (−25 Fugle tests). First vitest run had 1 failure that did not repeat on the rerun; not investigated.
- **Review (answered in chat; Task 198 item 4)**: L1 localStorage (TW 60 s in session, lock to next trading day 08:25 once settled; US 10 min) → L2 `price_cache` (same TTL rules, `updated_at` = fetch time) → L3 MIS (groups of 25 tickers, sequential) then Yahoo (≤ 50 parallel, 20 s deadline); browser fallback TWSE daily list, then stale L1. In session every viewer invokes Edge once a minute even when L2 is warm, `useStockPrices` / `useWatchQuote` / index quotes poll separately, and concurrent L2 misses each hit MIS.
