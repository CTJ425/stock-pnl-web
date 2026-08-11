# Progress Log (PROGRESS.md)

- Agent: Grok
- Action: PROD stock-report v39 (BUG-024)
- Status: **prod edge deployed**
- Timestamp: 2026-08-11 10:03:41 Asia/Taipei

> **Read only the newest entries at the top.** Older logs: `docs/agent/PROGRESS_ARCHIVE.md`.
> When this file grows past ~400 lines, move entries older than ~2 weeks to the archive.

---

## 📅 Log: 2026-08-11 10:03:41 Asia/Taipei (0.7.1 prod Edge BUG-024)

- **Agent**: Grok
- **Action**: User authorized PROD Edge deploy after 0.7.1 release

### Deploy
- Project: `kxnxadaghidwumqsqneu` (PROD)
- Source commit: `e751e3a` (main/dev)
- `stock-report` **v38 → v39**, `verify_jwt=false` (`--no-verify-jwt`)
- `ezbr_sha256`: `ea64e25d…` → **`fd12b4181a56602a541f736164ee9532e97e8d12e5e802053083ca4bcf3cab33`**
- Updated (UTC): 2026-08-11 02:03:24

### Smoke (anon, no CRON_SECRET)
| action | HTTP | body |
| ---- | ---- | ---- |
| sync-top-tickers | **400** | Unknown action (route gone) |
| warm 2330 | **401** | Unauthorized |
| unknown-xyz | **400** | Unknown action |
| generate-chips | **401** | Unauthorized |

### Note
- BUG-024 helpers now live on PROD runtime (was broken on v38 bundle from 0.7.0 cleanup).
- Token used only in shell env for this deploy; not written to repo.
- Nightly/cron with CRON_SECRET still needed for a full chips regenerate; next scheduled after-hours batch should seal margin.

---

## 📅 Log: 2026-08-11 10:05:00 Asia/Taipei (release 0.7.1)

- Verified `dev`: `npm test` 942 passed; `tsc --noEmit` clean; working tree clean (scratchpad untracked only)
- Commits vs main: macro TW/US tabs + institutional table/spark (dev.1–3) + BUG-024 stock-report helpers + docs/skills
- Version finalized **0.7.1**; CHANGELOG official entry; push `dev` → merge `main` → sync `main:dev`
- **Not** deploying PROD Edge (needs explicit authorize); Pages ships frontend on main push

---

## 📅 Log: 2026-08-11 09:50:00 Asia/Taipei (PROGRESS archive + README testing)

- Split `PROGRESS.md`: keep logs from **2026-08-10** onward; older → `PROGRESS_ARCHIVE.md`
- Project `README.md`: testing section → `docs/UnitTests/` + skills `testing` / `verify`
- Skill usage: agents load `testing` when writing/running tests; humans run `cd sources && npm test`

---

## 📅 Log: 2026-08-11 09:35:00 Asia/Taipei (testing skill + md slim)

### Installed
- `.claude/skills/testing/SKILL.md` — thin pointer to `docs/UnitTests/`
- CLAUDE.md §4 + Review tests → SoT / `npm test`
- `ship` skill: `sources/`, testing/verify pointers, dev-first
- `verify` skill: playwright is devDependency; link testing SoT

### Slimmed
- `docs/UnitTests/*` rewritten shorter; inventory → find + critical domains
- Removed `SKILL-RECOMMENDATION.md` (decision executed; avoid dual SoT)

---

## 📅 Log: 2026-08-11 09:20:00 Asia/Taipei (docs/UnitTests)

- Initial testing SoT under `docs/UnitTests/` (later slimmed same day)

---

## 📅 Log: 2026-08-11 09:09:37 Asia/Taipei (BUG-024 融資融券)

### Root cause
- Not TWSE: `MI_MARGN` OK for 20260810; OpenAPI OK.
- 0.7.0 deleted `chipReportReady` + `fundamentalSoftReady` while `evaluateTickerScope` still called them.
- `generate-all` chips phase → 500 every tick after ~20:45; no `batch_run_log`; margin never sealed in UI for stuck reports.

### Fix
- Restored both helpers in `sources/supabase/functions/stock-report/index.ts`
- DEV: volume-copy + `docker compose restart functions` + manual `generate-all`
- Result: `ok:true`, `generated:5`, holdings chips have 融資/融券 (e.g. 2317 marginToday=50336 shortToday=642)

### Still open
- **PROD** `stock-report` still on broken 0.7.0 bundle until authorized deploy
- Watchlist 2330/2327 still pre-margin files (0.7.0 night batch = holdings only)
- Commit not made yet

---

## 📅 Log: 2026-08-10 17:36:21 Asia/Taipei (0.7.1-dev.3)

- Larger spark (100×36); label above: 連 N 日買超／賣超
- Expand/collapse restored; default open = newest day only
- 全部展開 / 全部收起; collapsed shows 合計 only
- Macro tests 33 passed (TwMarket + MacroPage)

---

## 📅 Log: 2026-08-10 17:31:10 Asia/Taipei (0.7.1-dev.2)

- **Agent**: Grok
- **Action**: User rejected default-expand; reformat table instead

### Product
- Revert expand-by-default
- 三大法人 table columns: **日期 | 單位 | 買進 | 賣出 | 買賣超**
- Trend/streak under date cell; no +/- expand

### Verify
- Macro tests 41 passed

---

## 📅 Log: 2026-08-10 17:24:28 Asia/Taipei (0.7.1-dev.1)

- **Agent**: Grok
- **Action**: Macro page UX

### Product
- 總體經濟 subtabs: **台股** | **美國經濟** (default 台股)
- 三大法人買賣超: rows with buy/sell detail **default expanded**

### Verify
- Macro tests 42 passed
- Frontend-only; no Edge deploy

### Open
- push `dev` when ready; main stays 0.7.0 until release

---

## 📅 Log: 2026-08-10 17:11:45 Asia/Taipei (0.7.0 prod Edge)

- **Agent**: Grok
- **Action**: User supplied access token; deploy stock-report

### Deploy
- Project: `kxnxadaghidwumqsqneu` (PROD)
- `stock-report` **v37 → v38**, `verify_jwt=false` (`--no-verify-jwt`)
- Updated (UTC): 2026-08-10 09:11:24

### Smoke (no JWT / no cron secret)
| action | HTTP | body |
| ---- | ---- | ---- |
| sync-top-tickers | **400** | Unknown action (route gone) |
| warm 2330 | **401** | Unauthorized |
| unknown-xyz | **400** | Unknown action |
| generate-chips | **401** | Unauthorized |

### Note
- Token used only in shell env for this deploy; not written to repo.
- Recommend user rotate personal access token after sharing in chat.

---

## 📅 Log: 2026-08-10 17:08:26 Asia/Taipei (0.7.0 ship)

- **Agent**: Grok
- **Action**: User asked merge to main

### Git
- Commit `944548c` on `dev` + `main` (ff)
- Pushed `origin/main` and `origin/dev` (synced)

### Edge
- **DEV** self-hosted: volume-copy `stock-report` + restart functions — `sync-top-tickers` → 400 Unknown action (good)
- **PROD** cloud: `supabase functions deploy` failed — **no SUPABASE_ACCESS_TOKEN** in this environment
- PROD still answers `sync-top-tickers` with 401 (route still present — old bundle)

### Open
- Re-run with access token:  
  `cd sources && supabase functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt`

---

## 📅 Log: 2026-08-10 17:04:08 Asia/Taipei (0.7.0)

- **Agent**: Grok
- **Action**: Product rollback of 搜尋個股 + TOP20 while keeping post-0.6.43 non-feature fixes

### Removed
- Analysis subtabs 搜尋個股 / TOP20; `Top30Panel`, `topTickersProxy`, `twWatchlist`
- Edge: `topTickers.ts`, MI_INDEX20 sync, watchlist batch, dual-scope reportComplete
- Admin job `sync-top-tickers`; ACTION_SCOPE TOP copy
- Night batch = **held tickers only**

### Restored / kept
- `generate`/`warm` holdings whitelist + assertUser (+ warm_quota)
- Progressive warm, generate phases, admin manual run/progress, FOMC, Bollinger/K, skips, BUG-023, …

### Version
- `0.7.0` in version.ts / package.json / lock / README / CHANGELOG

### Open
- Run frontend tests
- Deploy Edge `stock-report --no-verify-jwt` only when authorized
- Push / Pages when authorized

---

## 📅 Log: 2026-08-10 23:45:00 Asia/Taipei (0.6.49 A2+P1)

- **Agent**: Grok
- **Action**: Split post-close batch to avoid cloud Edge 546

### Design
- Phases: `chips` | `market-data` | `history`
- `generate-all` (cron): budget 110s + 12s reserve between phases
- Admin: three jobs, one HTTP each (progress bar already per job)
- P1: history = one backfill round only

### Ship
- Frontend **0.6.49** Pages success (`60cc525` after test-id fix)
- Prod Edge **stock-report v34** `verify_jwt=false` sha `e0168beb…` (was v33)
- Smoke: `generate-chips|market-data|history` → 401 Unauthorized (route present)
- DEV: volume-copy + functions recreate; generate-chips → 401

---

## 📅 Log: 2026-08-10 23:25:00 Asia/Taipei (0.6.48 release)

- **Agent**: Grok
- **Action**: Manual-run progress UI + version policy clarification

### Product
- `runAdminJobs(..., onProgress)` emits job-start / job-done
- `ManualRunSection`: bar + per-job status table while running

### Versioning docs
- `versioning` skill + CLAUDE.md §12: after release dev=main=`x.x.x`; next work uses
  next target `-dev.1`; only release commit drops `-dev`

### Ship
- Frontend-only **0.6.48** → main / Pages

---

## 📅 Log: 2026-08-10 23:10:00 Asia/Taipei (prod Edge verify)

- **Agent**: Grok
- **Action**: User authorized prod Edge patch after 0.6.47 frontend ship

### Before / deploy
| Function | Version | verify_jwt | ezbr_sha256 (prefix) | CLI deploy result |
| ---- | ---- | ---- | ---- | ---- |
| stock-report | **v33** | false | `7b64e4b765083b07…` | **No change found** (bundle = local) |
| stock-price | **v17** | true | `8c1b665d73b791df…` | **No change found** |

- Project: `kxnxadaghidwumqsqneu`
- Local tree: `main` / `9809980` (0.6.47)
- `functions download stock-report`: `sync-top-tickers` present in `ADMIN_RUN_JOBS` + action routes

### Smoke (no JWT)
| action | HTTP | body |
| ---- | ---- | ---- |
| admin-run | 401 | Unauthorized |
| sync-top-tickers | 401 | Unauthorized |
| ensure-top-tickers | 401 | Unauthorized |
| warm | 400 | ticker 格式不正確 |
| unknown-xyz | 400 | Unknown action |

### Conclusion
Prod Edge already carried the 0.6.46 TOP30 / progressive-warm / admin-run job list
(v33 updated 2026-08-10 06:46 UTC). The opaque non-2xx on 「全部執行」 was the
**frontend multi-job single request** issue fixed in 0.6.47 Pages, not missing Edge code.

---

## 📅 Log: 2026-08-10 23:05:00 Asia/Taipei (0.6.47 release)

- **Agent**: Grok
- **Action**: BUG-023 — 「全部執行」 Edge non-2xx (timeout)

### Fix
- `adminRun.ts`: each job = separate `functions.invoke` (own ~150s budget)
- Clearer 504 / non-JSON error text
- UI note: multi-job is sequential client-side; check 抓取狀況 if one times out

### Verify
- Full suite 962 tests green; `tsc --noEmit` ok
- Frontend-only; no Edge redeploy required for this fix

### Ship
- Version **0.6.47**; commit on `dev` → merge `main` → push (Pages)

---

## 📅 Log: 2026-08-10 19:15:00 Asia/Taipei (0.6.46-dev.6)

- **Agent**: Grok
- **Action**: Fix incomplete quarterly profit on watchlist / 其他台股

### Root cause
- Soft warm only checked revenue &lt; 6 or **zero** quarters. After progressive warm spent budget on months first, files often sat at 12m + 1–2q and never on-demand warmed again.

### Fix
- `needsCoreWarm` (no file / no months / no quarters) vs `needsHistoryWarm` (months &lt; 6 **or** quarters &lt; 6)
- Detail page + prefetch: history-only when months full but quarters thin (no core quota)

### DEV verify (phase=history only)
| ticker | before q | after q | client_ms | complete |
|--------|----------|---------|-----------|----------|
| 2330 | 2 | **12** | 44417 | false (EPS/gap tail) |
| 2408 | 1 | **11** | 32016 | false |
| 2344 | 5 | **12** | 16761 | true |

### Tests
- needsFundamentalBackfill / prefetch / StockDetailPage paths green

---

## 📅 Log: 2026-08-10 19:05:00 Asia/Taipei (0.6.46-dev.5 + verify)

- **Agent**: Grok
- **Action**: Fix sealed-core skipping history; measure progressive warm on cold stock

### Fix
- `warmStockCore` / `warmStockHistory`: sealed re-call returns **last result**
- `StockDetailPage`: `shouldHistory` = core incomplete, or thin file when core not ok

### DEV live metrics (2881 富邦金, no prior fundamental/daily)
| Step | client_ms | server durationMs | file after |
|------|-----------|-------------------|------------|
| core | **859** | 450 | months=1, quarters=0, valuation+industry |
| history | 26363 | 26246 | months=11, quarters=12, complete |
| total | 27222 | — | — |
| TTFP proxy (core) | **859** | vs full wait **27222** (~**31.7×** earlier first paint) |

- Pre Storage: fundamental/daily not present (API 400)
- Post core: both HTTP 200; `dailySynced=1`, `fundamentalSynced=1`, `fundamentalComplete=false`
- Post history: `fundamentalComplete=true`; revenue filled 10 new months + 12 quarters this round

### Tests
- warmStock + StockDetailPage paths green after BUG-A

---

## 📅 Log: 2026-08-10 18:55:00 Asia/Taipei (0.6.46-dev.4 deploy)

- **Agent**: Grok
- **Action**: Commit progressive warm + deploy stock-report to self-hosted DEV

### Git
- `f89de86` feat: progressive warm core then history (0.6.46-dev.4)
- Branch `dev` ahead of origin by 2 (`f03ade5`, `f89de86`); **no push** until local UI OK

### DEV Edge
- rsync `sources/supabase/functions/stock-report/` → `volumes/functions/stock-report/`
- `docker compose up -d --force-recreate functions` → `stock-pnl-web-dev-functions-1` healthy
- `index.ts` SHA match repo
- Smoke: `POST warm phase=core` without JWT → **401**; invalid ticker → **400**

### Still open
- Manual cold-ticker timing on local vite against DEV
- push origin/dev after user confirms

---

## 📅 Log: 2026-08-10 18:40:00 Asia/Taipei (0.6.46-dev.4)

- **Agent**: Grok
- **Action**: Split on-demand warm so first paint is not blocked by MOPS history

### Baseline
- Prior work 0.6.46-dev.1–3 committed as `f03ade5` before this change.

### Code
1. Edge `handleWarm`: `phase=core|history|full` (default full). Core = `syncDaily` + `syncFundamental`. History = MOPS loops only, **no second `takeWarmQuota`**. Full = previous one-shot.
2. Frontend: `warmStockCore` / `warmStockHistory` / progressive `warmStock` (prefetch).
3. `StockDetailPage`: paint after core, then history re-read. `useDailySeries`: core only.

### Verify
- Full suite **933/933**.

---

# Progress Log (PROGRESS.md)

- Agent: Grok
- Action: 0.6.46-dev.2 FOMC meeting-calendar points (DEV)
- Status: **DEV Edge + sync-macro green; later committed in f03ade5**
- Timestamp: 2026-08-10 09:47:00 Asia/Taipei

---

## 📅 Log: 2026-08-10 09:47:00 Asia/Taipei (0.6.46-dev.2)

- **Agent**: Grok
- **Action**: FOMC = official meeting days + FRED range (includes holds)

### Code
- `meetingRatePoints` in `usMacro.ts`; `syncMacro` uses `RELEASE_CALENDAR.DFEDTARU`
- Force rebuild when on-disk FOMC latest is not a calendar statement day

### DEV verify
- volume-copy `stock-report` + `sync-macro` → `synced:true`, `reason:updated`
- FOMC latest **2026-07-29** 3.50–3.75%; points include 2026 hold meetings

---

# Progress Log (PROGRESS.md)

- Agent: Grok
- Action: 0.6.46-dev.1 new-stock prefetch + batch includes watchlist (DEV only)
- Status: **DEV Edge green; local uncommitted; prod untouched**
- Timestamp: 2026-08-09 13:40:00 Asia/Taipei

---

