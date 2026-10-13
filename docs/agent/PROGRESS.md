# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **BUG-120 released as 0.10.38** — TW stock list source, server cache and fallbacks.
- Status: ✅ `main` = 0.10.38 `794d9d7`; Edge `stock-price` + `stock-report` deployed to DEV and PROD (same bundle hash); Pages serving 0.10.38.
- Timestamp: 2026-10-13 13:57:01 Asia/Taipei

---

## 📅 Log: 2026-10-13 11:09:47 Asia/Taipei (BUG-120, 0.10.38)
- **Ask**: 「在加入觀察時…台股清單載入…為什麼很常失敗」, then 「1-4全部處理，幫我開bug…測試完畢後再呼叫 /route:reviewer…紀錄本次subagent的行為和token消耗」.
- **Root cause / fix / evidence**: see `BUG_FIX.md` BUG-120 (TWSE OpenAPI 10.2 s gz vs 10 s Edge timeout; CORS-dead client fallback; no stale use; no server copy).
- **Verified**: `npm test` 3,117 pass / 7 skipped; build, `typecheck:edge`, oxlint exit 0; new tests red-before/green-after.
- **Subagent record** (`route:reviewer`, model sonnet, one dispatch requested by the user by name; `/route:route` not run):
  - Cost: **123,722 tokens**, 57 tool uses, 350.8 s wall time. The main session's own token use is not exposed to it and is not recorded.
  - Input: changed-file line ranges (diff ~420 lines, too long to paste), the BUG-120 entry as contract, the test/build/lint results. Read-only (Read/Glob/Grep); it ran nothing and edited nothing.
  - Output: VERDICT FAIL, 1 BLOCKER + 9 RISK, each with `file:line`. All 10 checked by the main session; none was a false positive.
  - Verdicts: (1) BLOCKER Vite `/api/twse` prefix-shadows `/api/twse-www` — confirmed in `vite/dist/node/chunks/node.js` (`startsWith`), fixed by order. (2) outdated list close → `priceProxy` fresh price — confirmed, fixed (`allowStale: false`, new red/green test). (3) Edge `stale` ignored + re-stamped by `writeCache`, uncapped snapshot case — fixed (client stale flag, 24 h cap). (4) silent primary failure — fixed (`onFallback` → `app_log` / console). (5) Storage read unbounded, write could throw → 500 — fixed (3 s cap, try/catch). (6) truncated list could overwrite the copy — fixed (50 % share rule, C6). (7) timeout budget — fixed (OpenAPI 15→12 s, Discord CSV 8 s, 5-min stale hold); (8) E2E mocks on old endpoint — fixed, not run. (9) BOM test proved nothing — fixed (BOM on a used column; redundant strip removed). (10) `handleTwList` wiring untested — accepted, logic extracted and unit-tested instead.
  - Behaviour notes: stayed in scope and read-only; went beyond the given file list to the E2E scripts and Vite internals, which is where the BLOCKER and finding 8 came from — the test suite could not have caught either.
- **DEV deployed** by the user after freeing disk (first attempt: `ENOSPC`, `/` 100 %, `~/temp/Documents` 74G — not touched). Smoke passed: 2,393 rows live, second call served from `reports/twlist/latest.json` in 0.75 s; no `twlist` warnings in `app_log`.
- **Released** (user: 「幫我直接merge到main， supabase我都授權給你」): gates pass (3,117 / 7 skipped, build, typecheck:edge); `/verify` — dev server proxy `/api/twse-www` HTTP 200 text/csv, in-browser `getTwStockList()` 2,393 rows in 65 ms. `0a3fd67` dev → `794d9d7` release, ff to `main`; Release 0.10.38 by CI. PROD Edge deployed, smoke + hash match + live bundle checked (details in FIXED_BUG.md BUG-120).
- **Not done**: Discord `twNames` not exercised live; E2E scripts not run.

## 📅 Log: 2026-10-12 09:39:05 Asia/Taipei (docs archive + accuracy audit)
- **Ask**: 「幫我做一下所有文件的歸檔與查證…」, then 「都按照你的建議」.
- **Archive** (`61c23e3`): TASK.md 23,918 → ~13.3 KB, BUG_FIX.md 9,139 → 8,370 B (both still over cap — the remaining entries are live). Tasks 188/178/179/181 moved verbatim to `TASK_ARCHIVE.md` (open items **not** done); BUG-103/107 accepted → `ACCEPTED_RISKS.md`.
- **Refs**: `supabase projects list` shows only DEV `accmczhrqsilzrtyhyxa` and PROD `zizndnzibubcqdvnuhwr`. Old refs replaced in CLAUDE.md, GEMINI.md, CLAUDE-tw.md, `supabase-ops`/`probe-ops`, six E2E scripts, `e2e-dev.yml`, E2E.md. Identity predicate checked live: true on DEV, false on PROD. `sources/` re-linked to DEV (was dead `ytbgtuqeeyxlvldbzgnl`). Task 198 item 5 done.
- **Docs fixed**: README test counts (186 files / 3,094 pass / 7 skipped, run today), `stock-report` 44 files (not 45), `stock-price` 8 (not 9), the 「未登入回 401」 claim (publishable key passes `verify_jwt`, Task 185 #12), removed `supabase start` steps, added 資金流向 / 休市日 / 保持登入 / Discord to features and tree; `sources/README.md` now deploys `backup-transactions` with `--no-verify-jwt`; CLAUDE-tw.md `ai-proxy` removed; GEMINI.md deploy flag; UNIT.md / E2E.md dead file names.
- **Verified**: `npm run build`, vitest, `node --check` on all scripts, workflow YAML parses.
- **Not done / not verified**: E2E scripts not run against the new DEV; `sources/.env` (gitignored) still points at dead `zyebvayngwrqzoaicbwd` — needs the new DEV URL + publishable key; `docs/architecture/system_design.md` (original design doc) still lists `database.types.ts`; code comments were checked only for references to missing files, not read line by line.
