# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Fugle removed** (0.10.36-dev.1) — TW quotes, intraday and daily back to MIS → Yahoo; quote/cache path reviewed.
- Status: ✅ committed and pushed to `dev`; **Edge not deployed** (DEV and PROD still run the Fugle code until `stock-price` + `stock-report` are redeployed). Task 195 cancelled → `TASK_ARCHIVE.md`; Task 198 opened.
- Timestamp: 2026-10-08 13:07:25 Asia/Taipei

---

## 📅 Log: 2026-10-08 13:07:25 Asia/Taipei (Task 198 — remove Fugle, 0.10.36-dev.1)
- **Ask**: 「把之前富果的功能給刪掉，一樣維持在MIS->Yahoo就好，另外在看目前現價抓取的機制、Cache、與建議改善方式」.
- **Done**: local `dev` was 20+ commits behind `origin/dev` — pulled first. Only the five Fugle commits (`ceb539e`, `f00092a`, `5d6e82a`, `eafc817`, `5a5e2ad`) touched `stock-price/index.ts`, `stock-report/index.ts`, `twDaily.ts`, so those three were restored from `ceb539e^`; deleted `_shared/fugle.ts`, `stock-price/fugleParse.ts`(+test), `stock-report/fugleDaily.ts`(+test). README + `sources/supabase/README.md` Fugle lines removed. `grep -i fugle sources README.md` is empty. Left as history: spec 195, `docs/architecture/1006.md`, CHANGELOG 0.10.33.
- **Verified**: `npm run build`, `typecheck:edge`, vitest 3,087 pass / 7 skipped (−25 Fugle tests). First vitest run had 1 failure that did not repeat on the rerun; not investigated.
- **Review (answered in chat; Task 198 item 4)**: L1 localStorage (TW 60 s in session, lock to next trading day 08:25 once settled; US 10 min) → L2 `price_cache` (same TTL rules, `updated_at` = fetch time) → L3 MIS (groups of 25 tickers, sequential) then Yahoo (≤ 50 parallel, 20 s deadline); browser fallback TWSE daily list, then stale L1. In session every viewer invokes Edge once a minute even when L2 is warm, `useStockPrices` / `useWatchQuote` / index quotes poll separately, and concurrent L2 misses each hit MIS.
## 📅 Log: 2026-10-07 16:40:56 Asia/Taipei (repo tidy: ops scripts → `scripts/`, backups → `backups/`, dead files removed)
- **Ask**: 「把已經都用不到的東西或是過去因為測試所產生的檔案都移除；script、備份這些跟前端比較沒關係請移到上一層目錄」. User picked every proposed deletion and `backups/` at the root.
- **Removed**: `scratchpad/` (13 tracked files; now git-ignored), `comprehensive-audit.cjs`, `debug-capture.cjs`, `reconcile-market-daily.cjs`, Spec 160 tools `snapshot.cjs` / `restore.cjs` / `wipe-dev.cjs` + `lib/snapshotPlan*` / `lib/sqlFile*` and their npm scripts (needed Docker CLI, hardcoded the deleted DEV; superseded by `db-backup.sh` / `db-migrate.sh`), local `.snapshots/` (34 MB, untracked).
- **Moved**: `db-backup.sh`, `db-migrate.sh`, `backup-download.cjs`, `find-release-dates.py` → repo-root `scripts/`; `docs/dbak/` → `backups/` (`.gitignore` now `backups/`). Kept in `sources/scripts/`: E2E (need `sources/node_modules` playwright), edge-engine sync, data generators, release sync (`release.yml`) — their `lib/*.test.mjs` run under `sources` vitest. `backup-download.cjs` default `--dest` was `./backups-local`, never ignored → now `backups/storage/`. References updated: README, CLAUDE.md (layout rule), BUG-098, RISK-012, TASK.md, `macroCalendar.ts` comment.
- **Verified**: vitest 3,112 pass / 7 skipped (−32 = removed tool tests), `npm run build`; `scripts/db-backup.sh --project-ref <PROD>` wrote to `backups/<name>/…` (test package deleted); `db-migrate.sh` interactive lists both packages from `backups/`.
