# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.7.7-dev.2 移除個股買賣超長條圖；排查「探針命中但資料不更新」並恢復 DEV 班表
- Status: **on dev; DEV crons restored, PROD untouched**
- Timestamp: 2026-08-11 15:20:00 Asia/Taipei

> **Read only the newest entries at the top.** Older logs: `docs/agent/PROGRESS_ARCHIVE.md`.
> When this file grows past ~400 lines, move entries older than ~2 weeks to the archive.

---

## 📅 Log: 2026-08-11 15:20:00 Asia/Taipei (0.7.7-dev.2 長條圖移除 + 探針誤判排查)

Two things this round.

**1. Removed the 近 N 日買賣超 bar chart under the per-stock chips table.** Once the matrix shows every
法人 on every day at once, the chart was drawing the same numbers a second time. Its 法人 switcher and
clickable legend went with it —— they existed only to work around the chart being able to show one thing
at a time, which is not a problem the matrix has. Five tests that covered the chart were removed and one
was rewritten to assert the chips section now holds exactly the two margin line charts.

**2. "BFI82U 顯示命中但資料沒更新" —— no bug in the code.** Root cause: nothing was scheduled to ingest.
All four writer crons (`generate-chips` / `sync-market` / `sync-macro` / `sync-fx`) have been
`active = f` since the 0.7.3 probe-only experiment, and `handleProbe` by design writes
`source_probe_tick` and nothing else —— a hit never triggers a fetch. Proof: firing `sync-market` by
hand returned `reason:"updated"`, `institutionalFilled:1`, and an immediate second call returned
`skipped` (session-ready), i.e. the ingestion path was healthy the whole time.

Two secondary findings:
- The user read the 15:00 slot as the hit. It was not: 15:00 and 15:05 were both 「當日 BFI 尚未齊」 and
  **15:10** was the first green. That is now the evidence behind the retune.
- The admin probe panel hardcoded 「固定盤後 cron 已停用」 —— a cron state the page cannot actually
  observe, and one that turned into a lie the moment the schedules came back. Replaced with the thing
  the reader actually needs: 命中＝上游有資料，不代表已抓回來.

DEV actions taken (PROD untouched, needs explicit go-ahead):
- `cron.alter_job` re-enabled jobs 1/3/4/5.
- `sync-market` retuned `30,45 7 * * 1-5` → `15,30,45 7 * * 1-5` UTC (Taipei 15:15/15:30/15:45), because
  the probe measured the landing at 15:10. `schema.sql` updated to match.
- Verified live: the 15:15 flight fired on its own and returned `skipped`, the manual run having already
  completed today's data.

`t86` / `bwibbu` / `margin` / `borrow` / MOPS windows are still un-measured today; their schedules were
restored **unchanged** and should be retuned once a full day of ticks exists (TASK 84 step 8).

Verification: 959/959 vitest, tsc + oxlint clean.

---

## 📅 Log: 2026-08-11 15:20:00 Asia/Taipei (0.7.7-dev.1 個股籌碼矩陣)

Applied the 0.7.6 matrix to the per-stock chips table (`ChipsTab.tsx`) at the user's request.

The individual-stock table had the same disease in a different form: rather than an accordion it was a
**day picker** —— 法人 as rows, 買進／賣出／買賣超／約當張數／連買連賣 as columns, for exactly one
selected day. 「外資這幾天在買還是在賣」 meant clicking through up to seven days and holding seven
numbers in your head, and six of the seven days were always one click away. Same fix: 列＝五個法人,
欄＝N 個交易日. The day picker then had nothing left to do and was removed.

Two things differ from the macro version on purpose:
- **Cells are 張, not 股.** A single stock's foreign net runs to eight digits in shares (+20,145,000);
  seven of those side by side is a wall of digits. The exact share count moved to each cell's `title`,
  so it is demoted rather than dropped.
- **走勢 header carries no day count.** The macro spark reads 15 days against 7 columns and has to say
  so; here the spark and the columns are the same 7 days.

The streak deliberately keeps reading the net even when the cells show 買進/賣出 —— a gross leg has no
direction, so 「連 N 買」 computed from it would be meaningless.

Shared rather than duplicated: `heatStyle` moved into `chipFormat.ts` and the CSS class was renamed
`.mac-inst-matrix` → `.inst-matrix` (plus `.inst-matrix-cum` / `.inst-metric-seg`). The two tables are
the same encoding answering the same question at two scopes; two copies would drift.

Verification: 963/963 vitest pass (2 StockDetailPage tests rewritten), tsc + oxlint + build clean.
Chromium layout check against real markup + real `index.css`: 1280px needs no scrolling, 390px has 0
page overflow with 405px of in-table scroll, the frozen 法人 column holds when scrolled fully right,
and the tint resolves. Not verified: the logged-in page with live report data (Supabase auth, no
credentials in session).

Frontend only. **On `dev`, not released** —— awaiting the user's go-ahead to merge to `main`.

---

## 📅 Log: 2026-08-11 14:50:00 Asia/Taipei (0.7.6 三大法人矩陣)

User asked for a UI/UX rework of 總體經濟 → 台股市場 → 三大法人買賣超（億元）・近 7 個交易日,
stating the table must stay the主角 and charts the sidekick. Six HTML proposals were written to
`docs/architecture/` (index: `macro_inst_index.html`); the user picked 方案一 and asked to ship it
straight to `main`.

The diagnosis was that the axis was wrong, not the styling. The old table was 日期 × 單位 with a
per-day expand: 「外資這幾天在買還是在賣」 cost seven expands and reading one unit name across seven
separate blocks, and since only the newest day opened by default, 外資 and 投信 were hidden on the
other six days. Fully expanded it was 42 rows under a single header.

Transposed to 列＝六個單位 / 欄＝七個交易日 —— 6×7 always visible, **no expand state exists any more**
(the `expanded` Set, `toggle`, `toggleAll` and `DayTrend` are gone). Days now run oldest → newest, the
same direction as the three charts on the card; the old table was the only element reading the other way.
Also added: 7 日累計 column (the old table could not answer this without mental arithmetic), row-relative
heat tint (外資 moves in hundreds of 億 and 外資自營商 in single digits — a table-wide scale flattens
every other row), streak moved onto the unit row where it belongs, 買進／賣出 demoted from two permanent
columns to a metric switch, and the 單位 column frozen for horizontal scroll.

Verification: 963/963 vitest pass (16 of them rewritten for this section), tsc + oxlint + build clean.
Layout checked in Chromium against the real component markup and the real `index.css` at 1280px and
390px: page horizontal overflow 0 at both, the table scrolls inside `.table-scroll` (470px of scroll at
390px), the frozen 單位 cell holds at x=37 when scrolled fully right, and the `color-mix` tint resolves.
**Not verified**: the logged-in DEV page with live data —— the app is behind Supabase auth and no
credentials were available in the session. The DEV bundle itself boots with no console or page errors
and the badge reads the new version.

Frontend only. No Edge Function, Supabase schema or cron change.

---

## 📅 Log: 2026-08-11 13:40:00 Asia/Taipei (0.7.5 BUG-025)

User reported at 13:31 that the quote card still said 「盤中」. It is a fixed ten-minute window every
trading day, not a one-off: `twQuoteTtlMs` gave any not-yet-settled quote a 10-minute backoff at every
moment outside 08:25–13:30, so the 13:30:30 poll treated the 13:29 intraday snapshot as fresh and sent
no request at all. Manual refresh did not help either — `force` only skips the frontend L1, and the
Edge `price_cache` row is judged by the same function.

Checked upstream first: MIS returned `t=13:30:00`, `ip=0` for 2330/2317 at 13:31, so the source was fine.

Fix is a 13:30–14:00 settle window where an unsettled quote goes back to the 60-second poll; after
14:00 the 10-minute AUDIT-02 backoff resumes, and a settled quote still locks to 08:25 immediately.
Full detail and the two rewritten regression tests: `FIXED_BUG.md` BUG-025.

**Both halves must ship** — frontend L1 and the `stock-price` Edge share `quoteWindow.ts`.

### Deploy (0.7.5, commit `1a6bc88`, `main` = `dev`)

- DEV: volume-copy `quoteWindow.ts` into `stock-price` + restart functions. `price_cache` then held
  `trade_time 13:30:00` for every TPE row (2208 / 2609 / 8033 / 2317 / 2059) at 13:38:40.
- PROD `kxnxadaghidwumqsqneu`: `stock-price` **v17 → v18**, `verify_jwt=true` **preserved**
  (no `--no-verify-jwt` — this one is user-facing), sha `17fc299c81a8d91e…`, 05:39:31 UTC.
  Anon smoke → 401. `stock-report` untouched at v41.
- Pages ships the frontend half on the `main` push.

---

## 📅 Log: 2026-08-11 13:25:00 Asia/Taipei (0.7.4 probe hit fix + admin rework)

### The defect 0.7.3 shipped with

Three of the seven probes used `hit = r.ok`, i.e. "HTTP ok and the array is not empty". Measured at
13:02 Taipei, **before any of their windows opened**:

| source | live payload | 0.7.3 verdict | truth |
| ---- | ---- | ---- | ---- |
| `borrow` TWT96U | `stat OK`, 1232 rows, title `115年08月11日` | 中 | the day's own quota, published pre-open |
| `mops_revenue` t187ap05_L | 1082 rows, 出表日期 `1150717` | 中 | June data, issued 07-17 |
| `mops_profit` t187ap17_L | 336 rows, 出表日期 `1150811` | 中 | genuinely new today — but for the wrong reason |

Both endpoints always return a full snapshot, so "has data" is true around the clock. The two-day
observation would have concluded "these three land before their window opens", which is not a finding.
`t86` / `bfi82u` / `margin` (dated requests) and `bwibbu` (self-reported ROC date) were already correct.

### Fixed

- `borrowHit(dateIso, todayYmd)` — hit only once the title date has moved **past** today. Window
  widened 20:30→**15:00** so the flip itself is observable rather than already done when the window opens.
- `mopsIssueRocYmd(rows)` — hit when 出表日期 equals today's ROC date; `data_ymd` now carries the real
  issue date instead of the probe date.
- `source_probe_tick` DDL added to `schema.sql` (0.7.3 created it by hand on both DBs only), plus the
  real `*/5 * * * *` schedule and a note on tightening it to `*/5 4,7-14 * * 1-5` after the experiment.
- T86 miss note typo 「尚日」→「當日」.

### Verified against live endpoints (13:20, before any window)

`borrow` parsed `2026-08-11` → 沒中 ・ `revenue` 出表 `1150717` ≠ `1150811` → 沒中 ・
`profit` 出表 `1150811` → **中** (true positive, so the fix is not "everything is now a miss") ・
`bwibbu` `1150810` → 沒中. Unit + integration suite 959 passed; `tsc -b` clean.

### Admin rework

- Probe panel is now **one row per source**: name, hit/miss progress bar (one cell per 5-minute probe,
  left to right), first-hit summary, click to expand the per-tick log (time / hit / data date / rows /
  duration / fingerprint prefix / note). Sources whose window has not opened keep their row.
- Grouping moved to `timeline.ts` `groupProbeTicks` (pure, tested) per the page's existing convention.
- **「排程」 table deleted** at user request. Consequences recorded deliberately:
  - `judgeCron` / `describeScope` in `timeline.ts` are now **unused by any component** (kept, they have
    their own tests — user chose "keep, drop the references only").
  - The verdict banner no longer counts cron rows. During the experiment four crons are intentionally
    `active=false`, which `judgeCron` scores as 延遲 — that was four permanently-lit false alarms
    pointing at a table that no longer exists.
  - **Lost observability**: the per-schedule `targetRef` column is gone. That column was BUG-003's
    tripwire (a DEV cron hitting PROD). Nothing else on screen shows which environment a cron targets.
- `data.schedules` is still fetched — the timeline axes and legend read the cron expressions from it.

### Deploy

- DEV: volume-copy `index.ts` / `sourceProbePlan.ts` + restart `stock-pnl-web-dev-functions-1`;
  manual probe fire → HTTP 200, `taipei_time 13:15`, `sources: []` (first window is 15:00 — expected).
- PROD (`kxnxadaghidwumqsqneu`), user-authorized, deployed from clean tree at `ac3911b`:
  `stock-report` **v40 → v41**, `verify_jwt=false` (`--no-verify-jwt`),
  `ezbr_sha256` `6ea97d1b…` → **`9194ae6fb9bcdb0673b738ee3e5d93456d58b9ca0fb6cd0936f948b7752353ce`**,
  updated 2026-08-11 05:24:33 UTC.
  Anon smoke: `probe` **401**, `generate-chips` **401**, `unknown-xyz` **400** — gate intact.
  Token supplied in chat and used only in the deploy shell env; **user should rotate it**.
- `main` and `dev` both at `ac3911b`; Pages ships the admin rework on the `main` push.
- **Not verified from here**: PROD's own `cron.job` rows (no DB credentials in this shell). 0.7.3
  recorded them as set; confirm on the admin page that `source-probe` is the only active one.

---

## 📅 Log: 2026-08-11 12:55:00 Asia/Taipei (0.7.3 probe-only)

- Disabled fixed crons (nightly/market/macro/fx) on DEV+PROD; only `source-probe` `*/5 * * * *`
- Table `source_probe_tick`; Edge multi-source probe with time windows; admin UI hit/miss chips
- PROD stock-report redeployed; DEV volume-copy + functions restart
- **No auto generate** — observe ~2 trading days then restore schedules

---

## 📅 Log: 2026-08-11 11:20:00 Asia/Taipei (0.7.2 sparse after-hours cron)

- **Agent**: Grok
- **Action**: User OK — implement sparse shifts, skip late-night catch-up for now; merge main

### Schedule (Taipei, weekdays)
| Job | Action | Times |
| ---- | ---- | ---- |
| market-daily | sync-market | 15:30 / 15:45 |
| stock-report-nightly | generate-chips | 16:30 / 16:45 / 21:30 / 21:45 |

### Applied
- DEV self-hosted + PROD cloud via `cron.alter_job` (secret preserved, len=48)
- Not scheduled: generate-market-data / generate-history / late-night fill (admin manual)
- Frontend: dueBy, describeCron sparse branch, labels
- Version **0.7.2**

### Observe next trading day
- Did BFI land by 15:45?
- Did T86 land/freeze by 16:45?
- Did margin/borrow land by 21:45?

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

