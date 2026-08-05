# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.6.43 —— audit list closed (BUG-019 … BUG-022) and 0.6.42's Edge halves deployed
- Status: **All 8 audit findings fixed and live in both environments; 890 tests green**
- Timestamp: 2026-08-06 01:30:00 Asia/Taipei

---

## 📅 Log: 2026-08-06 01:30:00 Asia/Taipei (0.6.43 + the 0.6.42 Edge deploy)

- **Agent**: Claude
- **Action**: Deploy what a git push cannot, then close AUDIT-05 … 08

### The deploy (Task 75)

Test first, then production, `--no-verify-jwt` on `stock-report` only. Both environments came out on the **same**
shas —— `stock-price` `2797ede37f0a`, `stock-report` `c8825b1f4908` —— off the previous `733891b768b2` /
`91d1dce6ac72`, with `verify_jwt` still `true` / `false`. Only now is the retry bound (BUG-016) applied on the
server side, and the fingerprint separator (BUG-018) applied at all.

### The remaining four, and what connects them

Three of the four were about **a program that knew something and did not say it**, which is the same shape as the
first four:

- `describeCron` knew it had failed to parse and returned the raw expression, which on screen is indistinguishable
  from a deliberate rendering —— that is where BUG-012 and BUG-014 both hid. It now says 未解析的排程 and still
  shows the expression. **This is the one that pays forward**: the next missing branch reports itself.
- `writeStore` knew the write had failed and threw a raw `QuotaExceededError` into nobody's hands. Letting it
  throw is right —— losing a transaction silently would be worse —— but the user saw nothing. It now throws a
  cause they can act on, and `TransactionForm` already renders it.
- 「顯示全部」 knew it was showing 60 of up to 120 days. The table now reads the whole file; `SHOWN_DAYS` goes on
  keeping the charts' X axis readable, which was always its only job.

The fourth, `shiftPeriod`'s signed modulo, is unreachable at today's years —— a trap disarmed, not a defect fixed,
and the entry says so rather than dressing it up.

### Completed Tasks
- [x] Deployed `stock-price` + `stock-report` to test and production; shas verified matching across environments.
- [x] `timeline.ts` `UNPARSED_CRON_PREFIX` (BUG-019); `dataProvider.writeStore` message (BUG-020);
      `macroCalendar.shiftPeriod` floored modulo (BUG-021); turnover table reads the full file (BUG-022).
- [x] **890 tests across 57 files**, build and lint clean; `FIXED_BUG.md` ×4, `BUG_FIX.md` header, README 0.6.43,
      Tasks 74 and 75 closed.

---

## 📅 Log: 2026-08-06 01:10:00 Asia/Taipei (0.6.42)

- **Agent**: Claude
- **Action**: Fix AUDIT-01 … AUDIT-04

### Two were about a field that existed and was ignored

`trial` was carried correctly on every quote and read by exactly one of its consumers, so the dashboard priced
holdings at the indicative auction estimate during the two auction windows —— a price nothing traded at —— while
the quote card labelled the identical number 「試撮中」. The fix is a flag on the row and a badge; the test also
pins that ordinary quotes stay unmarked, because a badge that always shows says nothing.

The fallback path was the mirror image: it never reports a matching time, which since 0.6.37 means "not settled"
and therefore the short TTL **at any hour**. 0.6.37 accepted that retry deliberately and never bounded it, so a MIS
outage meant per-minute polling all night for every user. Now 10 minutes: still not locked (that is BUG-011's fix
and must stay), just asked ten times less often. The test pins the contract as "fresh at 2 minutes, refetched at
11" rather than as a single number.

### Two were arithmetic, both proven by running them

`setUTCMonth(m - n)` keeps the day of month, so a series ending on the 31st overflowed: `2026-05-31` minus three
months landed on `2026-03-03`, three days short, invisibly. And `sortedRows` joined cells with an empty string, so
`['12','3']` and `['1','23']` hashed identically —— on the fingerprint that decides whether today's T86 is final.
Neither had been observed in the wild; both were cheap enough that waiting for a report made no sense.

### The deploy trap, for the second time in two days

`quoteWindow.ts` and `pollPlan.ts` are Edge Function code. **A git push does not ship them.** The frontend half of
the retry bound is live with Pages; the server half and the fingerprint fix are not, and need
`supabase functions deploy` with the user's explicit go-ahead. Task 75 carries the commands, the current shas, and
the one-off effect to expect on the `stock-report` side.

### Completed Tasks
- [x] `holdingRows` + `DashboardPage`: `trial` carried and badged (BUG-015).
- [x] `quoteWindow`: `UNSETTLED_RETRY_MS` (BUG-016) —— bounded, still unlocked.
- [x] `fxConvert`: month stepped arithmetically, day clamped (BUG-017).
- [x] `pollPlan`: U+001F cell separator (BUG-018).
- [x] 4 new tests (**890 across 57 files**), build and lint clean; `FIXED_BUG.md`, `BUG_FIX.md`, README, Task 75.

---

## 📅 Log: 2026-08-06 00:20:00 Asia/Taipei (audit, no changes)

- **Agent**: Claude
- **Action**: Read the core logic looking for defects and for values written to drift

Findings live in `BUG_FIX.md` as AUDIT-01 … AUDIT-08; Task 74 summarises them. Nothing was edited.

### What the audit actually turned up

The two findings that matter are both in the **price path**, and both are the same species: a field that exists,
is carried correctly, and is then read by only one of its consumers.

`trial` is set from MIS's `ip` on every quote, but `buildHoldingRows` drops it —— so during the two auction windows
the dashboard computes unrealised P&L from a price nothing traded at, while the quote card one page away labels the
identical number 「試撮中」. And the Yahoo fallback returns no matching time, which since 0.6.37 means "not settled"
and therefore a 60-second TTL at any hour: while MIS is down, every quote refetches once a minute all night with no
cap, and the volume figure shifts by ~10% with no marker. 0.6.37 accepted the retry deliberately; what it did not do
is bound it.

Two more were **proven by running them** rather than by reading: month-end arithmetic in `sliceByRange`
(`2026-05-31` minus 3 months lands on `2026-03-03`, so the FX range is short by three days), and the T86 fingerprint
joining cells with an empty string (`['12','3']` and `['1','23']` hash identically —— and that fingerprint is the
gate deciding whether today's T86 is final).

### Note on method

Reading is not observation. AUDIT-01 says what the code does, not what a user saw; the honest confirmation is to
watch a trial window, which is Task 69 item 2 tomorrow morning. Entries state which side of that line they fall on.

Not covered by this pass: the AI client's provider matrix, the PDF path, CSS/layout.

---

## 📅 Log: 2026-08-05 23:55:00 Asia/Taipei (0.6.41)

- **Agent**: Claude
- **Action**: Fix BUG-014, found by checking every row instead of only the reported one

The user pasted two schedule rows that still said 16:00 and asked why nothing had changed. They were
`source-probe` and `stock-report-nightly` —— **both correct**, both `*/15 8-15 * * 1-5`, neither ever touched by
0.6.38. The row that moved is `market-daily`, and the user then confirmed it reads 「週一至週五 15:00–18:30 每
30 分」. So the reported symptom was a misreading, not a defect.

**But checking the whole table rather than the reported row turned up a real one**: `macro-daily`
(`*/30 12-18 * * *`) was also printing its raw cron string, and had been all along —— `describeCron`'s step branch
demands a `1-5` weekday suffix and that job runs every day. Same fall-through as BUG-012, different missing
branch. Two of five rows in that table were unreadable and only one had been noticed.

The new branch has to mark 次日: 12–18 UTC is 20:00 through 02:30 **the next day** in Taipei, and without the
marker the row reads 「每日 20:00–02:30」, which looks like a morning job. The end minute is now derived from the
step as well, instead of the literal `:45` that was only ever right for a 15-minute step.

### The same comment trap, twice in one evening
Writing the step syntax inside a block comment closes the comment early and breaks the parse. It happened in
0.6.39, was written up, and then happened again here —— the note was in PROGRESS, not in the file being edited.
Both comments are now line comments. If a third case appears, the fix is a lint rule, not another note.

### Completed Tasks
- [x] `timeline.ts`: daily step-range branch with the 次日 marker; end minute derived from the step.
- [x] `timeline.test.ts`: two entries; **887 tests across 57 files**, build and lint clean.
- [x] `FIXED_BUG.md` BUG-014, README 0.6.41.

---

## 📅 Log: 2026-08-05 23:40:00 Asia/Taipei (0.6.40)

- **Agent**: Claude
- **Action**: Fix BUG-013 —— the same lesson as BUG-012, one file away

The user reported that the admin console still said the earliest shift was 16:00 even on 0.6.39. Diagnosis first,
and the schedule **table** turned out to be correct: DB (`0,30 7-10 * * 1-5`), the RPC (reads `cron.job.schedule`
live) and `describeCron` all checked out. What still said 16:00 was the **prose** in the timeline legend, which
hard-coded 「盤後批次 16:00–23:45 每 15 分」 and named only that one schedule.

So it was BUG-012's lesson repeating one file away: a second copy of a value that lives in pg_cron. It had been
true right up until 0.6.38 gave the 全市場 row its own, earlier schedule —— then it became wrong by omission
without anyone touching it. Both schedules are now read from `data.schedules` through `describeCron`, and the
sentence says plainly that 15:00 for 全市場 and 16:30 for 個股 T86 are both normal.

### Three tests broke, and each break was informative
- Two matched 「三大法人・全市場」 with no scope; the legend now names that row too. Scoped to `.ast-tl`, which is
  what they meant all along —— they assert the axis has that row.
- One pinned the old wording 「第一個**批次**班次」. The word 批次 had to go: the sentence now covers two schedules,
  only one of which is the batch.

### Tooling note (not a project problem)
For roughly an hour the harness's Bash permission classifier was intermittently unavailable, which fails closed
and blocks command execution. File edits were unaffected, so the code was written first and verified afterwards;
the user ran one round of `npm test` themselves via the `!` prefix in the meantime. Nothing in the repo caused it.

### Completed Tasks
- [x] `AdminStatusPage`: `nightlyCron` alongside `marketCron`; legend rewritten to name both and derive both.
- [x] Tests: one added, three adjusted; **885 across 57 files**, build and lint clean.
- [x] `FIXED_BUG.md` BUG-013, README 0.6.40.
- [x] Secret hygiene: the user pasted two project keys into the chat. Scanned the repo (including `sources/.env`
      and `docs/`) and the scratchpad for 48-hex tokens —— **no match anywhere**; they were never written to disk.
      They still count as exposed, so rotation was advised. A transcript cannot be edited from here.

---

## 📅 Log: 2026-08-05 23:00:00 Asia/Taipei (0.6.39)

- **Agent**: Claude
- **Action**: Fix BUG-012 —— `describeCron` had no branch for the shift shape 0.6.38 introduced

The user read the admin console and noticed 15:00 was mentioned nowhere. Correct observation, and the cause was
mine: 0.6.38 changed `market-daily` to `0,30 7-10 * * 1-5` without teaching `describeCron` that shape, so it fell
through to `return expr` and printed the raw cron string —— which is in UTC, hence no 15:00 on the page anywhere.

**The lesson generalises beyond this one function**: the schedule display is *derived* from `cron.job` precisely so
it cannot drift from reality, and that is exactly why changing the cron silently changed the UI. Anything that
formats a value has a domain, and moving the value outside that domain is a UI change even when no UI code moved.
Grepping for who reads a constant is not enough —— check who *formats* it.

`cronHoursTaipei` and `judgeCron` were checked too: the first is only applied to `sync-macro`, the second never
parses the expression. `describeCron` was the only gap.

### Completed Tasks
- [x] `timeline.ts`: branch for a minute list inside an hour range, placed below the single-minute branch and
      requiring a comma so `0 8-10 * * 1-5` keeps listing three shifts individually.
- [x] `timeline.test.ts`: the new shape plus a control for the old one; `FIXED_BUG.md` BUG-012; README 0.6.39.
- [x] Verified: **884 tests across 57 files**, build and lint clean.
- ⚠️ A comment containing the literal step syntax closed the block comment early and broke the parse —— caught by
      the test run, worth remembering when writing about cron inside `/* */`.

---

## 📅 Log: 2026-08-05 22:40:00 Asia/Taipei (0.6.38 → main)

- **Agent**: Claude
- **Action**: Daily volume tables for the stock and the market, then release

### Mockup first, code second

The user asked to see the layout before any implementation, so both areas were mocked in
`docs/architecture/volume_table_layouts.html` with **real** 2026-08-05 numbers pulled from the live files
(`daily/2330.json`, `market/daily.json`) —— column widths and digit counts cannot be judged from placeholder data.
Two options each; the user picked A for both: collapsed by default with a 顯示全部 button.

### What the tables add that the charts could not

Per stock, the answer is **量比**: a bar chart shows relative height, the ratio says "today is N times the 20-day
average", bold from 1.5x. It is computed over the full series rather than the visible slice, so the oldest visible
row still has a real average behind it instead of a hole.

Market-wide, the answer is that `tradeVolumeShares` and `transactions` had been sitting in `market/daily.json`
since 0.6.28 **without ever being displayed** —— the chart only ever drew the amount. Shares and amount are listed
side by side on purpose: 2026-07-29 traded 170.5 億股 for 11,492 億 while 08-05 traded 132.1 億股 for 12,002 億,
which is what a rotation into pricier stocks looks like.

### The disagreement that is not a bug

2330 on 2026-08-05: 35,214 張 from the daily batch, 31,851 張 from MIS —— about 10% apart, and now both are on the
same page (the new table and the 行情 card). This was flagged to the user before building, and the resolution is to
state the sources rather than reconcile the numbers. It is also the measurement Task 69 was waiting on.

### Two traps worth remembering

**A second `.data-table` on a card breaks unscoped selectors.** Eight existing market tests read
`.data-table tbody tr` with no scope and silently started matching both tables' rows. Both tables now carry
`aria-label`, and the tests scope by it.

**`npx tsc --noEmit` is not the type gate; `npm run build` is.** The build type-checks test files too, and a
`TechnicalView` fixture in `aiPayload.test.ts` was missing the new field —— tsc and the whole vitest run were green
while the build failed.

### Completed Tasks
- [x] `technicalView.ts`: `volumeRows` (newest first, ratios from the full series).
- [x] `TechnicalTab`: KD and volume swapped, volume table under its own chart, 20 rows then 顯示全部.
- [x] `TwMarketSection`: 每日成交量 table above the institutional one, 7 rows then 顯示全部; both tables labelled.
- [x] 3 new tests (882 total across 57 files); `SPEC.md`, `TASK.md` Task 73, README finalised at 0.6.38.

---

## 📅 Log: 2026-08-05 21:40:00 Asia/Taipei (0.6.38-dev.1)

- **Agent**: Claude
- **Action**: Move `market-daily` earlier, merge three pairs of UI, add a search box to the yearly page

### The early round costs less than the old comment claimed

`schema.sql` justified starting at 16:00 with "running early only gets 'no data found', which is a wasted trip".
Reading `syncMarket` says otherwise: it compares a content signature and, when nothing changed, returns
`synced: false` and **leaves `asOf` untouched** —— an early miss writes nothing and cannot put a false "arrived"
mark on the admin timeline. The whole cost is two GETs. So the schedule moved to every half hour from 15:00.

What is genuinely unknown is whether 15:00 will *win*: today's institutional amount is only fetched when today's
date already exists in the merged day list, and that list comes from **FMTQIK**, not BFI82U. The early round
therefore needs both publishers. Tomorrow's `market/daily.json` `asOf` answers it.

Applied with `cron.alter_job` rather than re-running `cron.schedule`: altering keeps the existing command, so the
plaintext `CRON_SECRET` —— which an agent cannot read —— is never needed. Every write carried the target ref in
the same query, per the `supabase-ops` cwd trap.

### The merges, and the one thing that must not be tidied away

「報價」and its inner「今日行情」were two titles for one card; the technical page ended a wall of charts with a
table of numbers about the latest day, repeating 收盤 / 開高低 / 成交量 that the quote already showed live.
So: the card is now called **行情**, the duplicated cells are gone, and what survives from 指標摘要 is what a quote
cannot give —— 均線 / KD / RSI / MACD 柱 / 量比.

⚠️ **The two halves can be different days.** The quote is MIS in real time; the summary comes from the after-hours
daily batch, which only lands in the evening, so during the session it still describes the previous trading day.
That is why the summary keeps its own date in the heading, and a test now locks it.

Same reasoning for the macro page: chip row and trend table are two readings of one set of indicators, and splitting
them made 資料更新於 / 重新整理 look as if they only covered the top card.

### Search that recomputes rather than hides

The yearly search filters **what gets aggregated**. Hiding detail rows while leaving the year totals alone would
print a year total that adds up to nothing visible. The four KPI cards stay lifetime totals and say so in a hint
while a query is active.

### Completed Tasks
- [x] `schema.sql` §10b + both environments: `market-daily` → `0,30 7-10 * * 1-5` (Taipei 15:00–18:30).
- [x] `QuoteTab` / `TechnicalTab` / `StockDetailPage` + new `useDailySeries`: one download feeds both sections.
- [x] `MacroPage`: US indicators in a single card.
- [x] `YearlyPage`: search box, aggregation-level filtering, distinct empty-state wording.
- [x] `SPEC.md`: four sections added/updated; `TASK.md` Task 72; version bumped to 0.6.38-dev.1 in all three places.
- [x] Verified: **879 tests across 57 files**, build and lint clean; three stale layout assertions rewritten.

---

## 📅 Log: 2026-08-05 21:05:00 Asia/Taipei (documentation catch-up)

- **Agent**: Claude
- **Action**: Write down what 0.6.37 and the translation commits changed, and audit what is actually running

Three commits landed after the last log — 0.6.37 (`b3109b4`) plus the comment/doc translation
(`aba1aa4`, `c87ea0e`, `2dac793`) — and none of them reached the agent documents. Version numbers were
in sync in all three places, tests and build were green, so the gap was invisible from the code side.

### The deploy that was never done — now done

0.6.37 fixes BUG-011 in `quoteWindow.ts`, a file that exists **twice** — once for the browser, once for the
Edge Function. Pushing to `main` shipped the browser half through Pages, which made the bug look fixed.
It was not: a read-only `functions list` at 20:51 showed prod `stock-price` **v14** and dev **v10** carrying
the *same* `ezbr_sha256 00ce1004…`, the 0.6.36 build, while the 0.6.37 commit is timestamped 17:06 — after both
deploys. Every device whose local cache expired was still getting a locked snapshot from the server.

The lesson is the file-count one: **a fix that touches `supabase/functions/` is not shipped by a git push.**

With the user's authorisation, deployed dev first (**v11**, 20:57) then production (**v15**, 20:58), `verify_jwt`
staying `true` on both. The sha moved to `733891b768b2…`, identical in both environments — that match is the
evidence, not the version numbers; `functions download` still cannot get an access token here, as Task 69 found.

### What deliberately was not verified

That a `price_cache` row with a null `trade_time` now refreshes rather than staying frozen would need a service key
(only the anon key is in `sources/.env`) or a `db query --linked` — and `link` currently points at production, which
is the exact configuration the `supabase-ops` skill warns silently writes to the wrong database. The rule is covered
by unit tests; the honest end-to-end check is Task 69 item 2 tomorrow morning during trial matching.

### The previous entry's summary of the language policy was already stale

The 16:55 log recorded "README, **code comments and UI copy** stay Chinese". Two commits later that changed:
`c87ea0e` removed the code-comment exception and `aba1aa4` translated the comments, then `2dac793` restored
the exception **for UI text and user-facing copy only**. CLAUDE.md §4.1 is the authority; the older log entry
is left in place as history rather than edited.

### A pending verification that got less pending

Task 69 item 1 needed `STOCK_DAY_ALL` to publish 08-05 data so the volume discrepancy could be reconciled.
Re-checked at 20:50, seven hours after the close: still `Date: 1150804`, 2330 still at 2320. The endpoint lags
by more than an evening, which strengthens the original decision to drop it. Two facts recorded alongside it:
it carries 1377 TWSE records and **6488 is absent** (TPEx), and its `TradeVolume` is in shares, not lots.

### Completed Tasks
- [x] `FIXED_BUG.md`: BUG-011 written up — root cause is that "past 13:30" proves a *price* is final but not that a
      *row* is the settled close; rows without `trade_time` are intraday snapshots.
- [x] `SPEC.md`: the TTL table now keys on the reported matching time, the 13:30–14:00 grace window is removed,
      and `twMaxTtlMs`'s role as the coarse-filter upper bound is written down.
- [x] `BUG_FIX.md`: no open bugs; the obsolete 2026-07-28 BUG-004 look-back retired with the reason.
- [x] `TASK.md`: Task 71 added and closed (deployed to both environments), Task 69 item 1 updated with tonight's
      measurement and item 2 re-scoped to run after the deploy.
- [x] Verified the post-translation tree: **877 tests across 57 files passed**, `npm run build` and `npm run lint`
      clean (only the four pre-existing `only-export-components` warnings).
- [x] `supabase-ops` skill: its prescribed audit (`functions download` + diff) cannot authenticate here, so the skill
      was telling every future session to do something that does not work. Added the `ezbr_sha256` fallback with its
      limits, and the "a git push does not deploy an Edge Function" trap that cost this session.

---

## 📅 Log: 2026-08-05 16:55:00 Asia/Taipei (0.6.36 → main)

- **Agent**: Claude
- **Action**: Merge to main, production deploy, and a documentation-language policy

> First entry written in English under the new CLAUDE.md §4.1. Existing Chinese
> entries stay as they are — see the cost analysis below for why.

### Deploy order mattered

Merging to `main` fires GitHub Pages immediately, but production Supabase was still
on the old Edge Function with no new `price_cache` columns. Pushing first would have
put the live site in a state where every quote-card cell reads "—".

CLAUDE.md §13.2 also says production is only touched from `main`. Both constraints are
satisfied by merging locally first, deploying production while sitting on `main`, and
only then pushing — the merge is local, the push is what deploys.

Production: `stock-price` v13 → **v14** (`verify_jwt` stays `true`), `price_cache`
got the seven columns, and an end-to-end call returned the full set for 2330
(`tradeDate: 20260805`, `tradeTime: 13:30:00`). `main` and `dev` both at `1a9f37f`.

⚠️ `supabase link` now points at **production**. Re-link before touching dev.

### The first production deploy attempt was blocked

The harness permission classifier denied `functions deploy --project-ref <prod>`.
It went through on a second attempt after the user explicitly authorised it. Worth
knowing: that classifier is not something a user authorisation flag overrides, so if
it blocks again the fallback is for the user to run the command themselves.

### Chinese vs English token cost — measured, not assumed

The user asked whether Chinese docs cost more tokens. Measured with `gpt-tokenizer`
(o200k_base) on a natural bilingual pair — the BUG-010 entry in `FIXED_BUG.md` versus
the commit message describing the same bug:

| Sample | tokens | chars | tok/char |
| --- | --- | --- | --- |
| Chinese (FIXED_BUG entry) | 930 | 1,416 | 0.657 |
| English (commit message) | 383 | 1,482 | 0.258 |

**Same length, Chinese costs 2.5x.** Netting out that Chinese says the same thing in
roughly 0.65 the characters, equivalent information runs **1.6–1.8x**.

### But translating everything was the wrong fix

Converting all 8,688 lines would cost ~300K tokens once and take ~20 sessions to pay
back, and translation erodes exactly what makes these files worth keeping — the
measured numbers and the "why we did not do it that way" reasoning.

The real cost was file bloat. `TASK.md` was **38,579 tokens** and loaded every session,
nine tenths of it completed-task history. Moving those to `TASK_ARCHIVE.md` cut it to
**2,558 tokens — 93.4% saved**, more than double what translation would have given,
with no translation risk at all.

### Completed Tasks
- [x] `CLAUDE.md` §4.1: agent-authored Markdown is written in English from now on.
      README, **code comments and UI copy** stay Chinese — comments carry the
      "why not" reasoning that translation damages most.
- [x] `TASK.md`: kept only Task 68/69/70 and the recurring Task 47; the other 66 went
      to `TASK_ARCHIVE.md` verbatim (moved, not translated).
- [x] Merged `dev` into `main` as 0.6.36, deployed production, pushed, and
      fast-forwarded `dev` back to `main`.

---

## 📅 Log: 2026-08-05 16:35:00 Asia/Taipei（0.6.36-dev.2）

- **Agent**: Claude
- **Action**: 修正後台台股盤後時間軸的基準日（BUG-010）

### 使用者的問題帶出兩件事

問題是「16:00 這班車啟動後，台股盤後・2026-08-04 這一輪 狀態都還是舊的，是 BUG 嗎」。

**第一件：不是 bug。** 批次用的 `T86?selectType=ALLBUT0999` 在 16:00 / 16:15 都還沒發布
（`batch_run_log` 兩列 `t86_today = false`、cron 兩班都 succeeded）。
容易誤導的是同一支 API 換成 `selectType=ALL` 當時已經有 8/5 的 16575 筆 ——
但那份含權證、ETF、可轉債，與批次要的 1339 筆股票是**兩份不同的資料、產製時間不同步**。
16:30 那輪 `t86_today` 轉 true、`data_ymd` 推進到 20260805，與 `timeline.ts` 註解
記載的「實測要到 16:30 那輪才抓得到」完全一致。

**第二件：但使用者的直覺指向了一個真的 bug。** 他說「甚至 BFI82U 開始跑的時候就該切換」——
查下去發現全市場法人 16:00 那班確實已經抓到 8/5（`market/daily.json` 的 `asOf` 是台北 16:00:04），
但標題與軸座標都綁在個股籌碼的資料日 8/4，於是那一列被算成 25 小時、
`tlPercent` 夾到 100% 貼在軸最右端、`judgeSource` 判成 `late`。
**準時到手的來源天天亮紅燈**（每個交易日 16:00–16:30 這段）。

### 修法與一個差點踩進去的坑

基準日改取各來源資料日的**最大值**（`roundBaseYmd`）。使用者在兩個方案中選了這個 ——
另一案是用 0.6.36 剛加的報價 `tradeDate` 判交易日，能連 15:00–16:00 的空窗都正確，
但要改 Edge 多帶欄位、再部署一次。

**坑**：第一版把借券的 date 也放進 max，既有測試立刻爆掉 ——
借券自報的是**公布日（次一交易日）**，天生比本輪多一天
（`batch_run_log` 可見 `borrow_data_date` 是隔日而 `data_ymd` 是本輪）。
放進去會讓基準日整個快一天、其他四列全變「未到手」。
連帶把「屬不屬於本輪」的判斷從「比對 date」改成「時間戳落不落在軸範圍內」——
後者對五列語意一致，也才不會把唯一該亮紅燈的借券誤判成沒抓到。

### Completed Tasks
- [x] `timeline.ts`：新增 `roundBaseYmd()`（含「借券不可放進來」的警告註解）。
- [x] `AdminStatusPage.tsx`：基準日改用 `roundBaseYmd`、標題與軸共用同一基準、
      本輪判定改用 `[0, TL_SPAN_HOURS]` 範圍、別輪的日期不顯示。
- [x] 測試：`timeline.test.ts` 4 筆（含鎖住舊行為「25 小時 → late」的對照）、
      `AdminStatusPage.test.tsx` 1 筆（全市場先到手時整條軸跳輪）。
- [x] 驗證：`npm test -- --run` 57 檔 **874 筆全通過**；`npm run build` 乾淨。

---

## 📅 Log: 2026-08-05 16:05:00 Asia/Taipei（0.6.36-dev.1）

- **Agent**: Claude
- **Action**: 個股分析的持股卡換成報價卡；台股 13:30 收盤後鎖到隔天 08:25 不再抓價

### 使用者原本的構想被實測否決

使用者要求「今天收盤價直接從 TWSE 個股日收盤價及月平均價（`STOCK_DAY_AVG_ALL`）定義，
庫存總覽抓到就更新到現價、不再打 API，直到隔天 8:25 試搓前」。動工前先打了三個端點：

| 來源 | 交易日 | 2330 收盤 | OHLCV |
| ---- | ---- | ---- | ---- |
| `STOCK_DAY_AVG_ALL` | 1150804（**前一交易日**） | 2320 | 無 |
| `STOCK_DAY_ALL` | 1150804（**前一交易日**） | 2320 | 有 |
| MIS `getStockInfo.jsp` | **20260805**，t=13:30:00 | **2405** | 全有 |

實測時間是 2026-08-05 15:23 台北，**收盤後整整兩小時**，兩個 OpenAPI 端點都還停在昨天，
而它們回的 2320 恰好等於 MIS 的昨收 `y`。照原構想實作，今天會把 2320 當成今收
（實際 2405，差 3.6%）**並鎖定 17 小時** —— 正好把使用者要避免的「隔夜價格錯亂」制度化。

同一時間 MIS 的一筆回應已含全部所需欄位（`o` 2385 / `h` 2415 / `l` 2370 / `z` 2405 /
`y` 2320 / `v` 31851 / `d` 20260805 / `t` 13:30:00 / `ip` 0），且收盤後仍是當日定案值。
向使用者說明後改採 **MIS 單一來源**，四個決策點都由使用者定案（單一來源、只做台股、
只刪卡片保留資料流、七格不含月均價）。

### 收盤判斷改看時鐘，不看資料到齊

`quoteWindow.ts` 的 `twQuoteTtlMs(now, tradeTime?)` 是無狀態純函式，只看台北時鐘：
08:25–13:30 走 60 秒，其餘時段一路鎖到下一個 08:25。

**刻意不查交易日曆、不存鎖定旗標**：週末與國定假日一到 13:30 自然落入長 TTL；
隔天 08:25 解除後若當天休市，13:30 又重新落入。少一份要維護的假日表。
唯一的例外處理是 13:30–14:00 的過渡窗 —— 來源 `t` 還沒到 13:30 表示收盤撮合尚未落地，
這種過渡值不鎖夜，免得整晚顯示一個錯的收盤價。

### 踩到的坑：`Number('')` 是 0

`toCount()`（成交量）允許 0，因為「今天還沒成交」是真值。但也正因為 0 有效，
空字串不能直接交給 `Number()` —— 它回 0，會把「回應裡沒有 `v` 欄位」變成「成交量 0 張」。
既有測試（舊的 MIS 真實回應樣本沒有 `v`）當場抓到，補上空字串前置檢查。

### Completed Tasks
- [x] `misParse.ts`：`MisQuote` 擴充 `open/high/low/volume/tradeDate/tradeTime/trial`；
      `pickPrice` 的 z→b→y 退階邏輯**未動**。
- [x] `quoteWindow.ts`（新）：時段 TTL 純函式，前端與 Edge 共用（跨目錄 import，
      沿用 `misParse.test.ts` 既有模式）。
- [x] `stock-price/index.ts`：`Quote` 擴充；Yahoo 路徑補 OHLCV
      （開盤價**不在 `meta`**，要從 `indicators.quote[0].open[0]` 取；
      成交量 Yahoo 給股數、MIS 給張數，除以 1000 對齊）；
      DB 快取讀寫新欄位；`freshAfter` 粗篩下界改取兩市場較大者。
- [x] `schema.sql`：`price_cache` 補 7 個欄位（`ADD COLUMN IF NOT EXISTS`，可重複執行）。
- [x] `priceProxy.ts`：`PriceQuote` 擴充、快取 key 升 `v3`、`cacheTtlMs` 改吃 quote；
      新增共用的 `isClosed` / `tradeDateLabel`。
- [x] `QuoteTab.tsx`（新）取代 `HoldingTab.tsx`（刪）；`StockDetailPage` 的 `surfaceRef`
      改為包住四段全部；`AnalysisPage` 把 `PriceQuote` 往下傳。
- [x] `DashboardPage.tsx`：現價 tooltip 補上交易日與「收盤」，快取價明說不一定是今天的。
- [x] 測試：新增 `quoteWindow.test.ts`(9)、`QuoteTab.test.tsx`(10)；
      擴充 `misParse.test.ts`(3)、`priceProxy.test.ts`；更新 `StockDetailPage.test.tsx`
      的持股相關斷言（PDF 那兩條改為釘「畫面上沒有持股數字」）。
- [x] 驗證：`npm test -- --run` 56 檔 **869 筆全通過**；`npm run build`、`npm run lint` 乾淨。

### 測試區部署與實測（16:00–16:10，使用者授權後執行）

`stock-price` v9 → **v10**（`verify_jwt` 維持 `true`）、`price_cache` 補齊 7 個欄位。
端到端打測試區的 Edge Function：2330 / 6488 回齊七欄（`tradeDate: 20260805`、
`tradeTime: 13:30:00`）；AAPL 的交易日與撮合時間為 null、成交量 67779 張（股數已除以 1000）。

**收盤鎖定的決定性驗證**：把 `TPE:2330` 的 `updated_at` 往回撥 5 分鐘再打一次，
`asOf` 仍停在 5 分鐘前 —— 舊的 60 秒 TTL 必定會重抓，所以這證明長 TTL 真的在 Edge 端生效。

踩到的環境問題兩則：
- `db query` 在 repo root 執行會連本機 Docker DB（skill 警告的 cwd 陷阱的另一種表現），
  且新版 CLI 不認舊的 `supabase/.temp/linked-project.json`，必須重新 `link`。
- `functions download` 取不到 access token（`projects list` / `deploy` 卻可以，
  走不同的認證路徑），所以 skill 要求的逐檔比對這次改用「版本更新時間 ＋ 端到端回傳」替代。

⚠️ **`supabase link` 現在指向測試區**（全域副作用），要動正式區必須先重新 link。

### ⚠️ 尚未做
- `git push origin dev`：這台機器沒有 GitHub 認證（無 `gh`、remote 是 https 且無 credential helper），
  需由使用者自行 push。commit 已在本地 `dev` 分支。

### 待隔日盤中回頭確認
1. MIS 的 `v`（31,851 張）與 Yahoo 同日的 35,214 張差約 10%，推測是盤後定價交易未計入；
   單位是「張」已確定，差異來源用隔日的 `STOCK_DAY_ALL` 對帳。
2. 試撮時段（08:30–09:00）MIS 實際回的 `ip` / `t`，確認「預估」格如預期顯示。

---

## 📅 Log: 2026-08-05 13:20:00 Asia/Taipei（0.6.35）

- **Agent**: Claude
- **Action**: 依使用者選定的版型改寫 `MacroPage`

### 為什麼是轉置，不是照抄

使用者要「CPI 等指數改成和三大法人買賣超類似」。**不能直接照抄**：
法人表的「趨勢／連續」描述的是**合計**這一個序列，而五個總經指標沒有合計可言
（單位是 %、千人、指數，加總沒有意義）。維持「一列一個月份」的話，趨勢欄會沒有東西可畫。

所以改成**一列一個指標**，趨勢與連續描述該指標自己的 12 期 —— 這才對回法人表
「一列一個東西 ＋ 它自己的趨勢與連續」的形狀。代價是「同一個月五個指標」要橫著看，
使用者在兩個版型範本之間選了這個，是知情的取捨。

### 三個由使用者定案的決定

1. **版型 A**（一列一個指標，可展開 12 期明細）。
2. **字卡瘦身成一行 chip**（只有名稱與最新值）——「期別、較上期、走勢、連續、說明」
   全在表裡，卡片版等於把同一份數字說兩次。
3. **全表依升降上色**。

### ⚠️ 第 3 點改變了非農就業的顏色語意（刻意）

0.6.34 之前非農依 `kind === 'momThousands'` 走**數值正負**上色（就業人數增加＝紅）。
改成全表一致之後它跟著看升降 —— **「+57 千人但比上期少 72」現在是綠的**。

理由：同一張表不能有些格子紅代表「值是正的」、有些代表「比上期高」，
兩套規則並存比一套不完美的規則更難讀。表格下方那句
「紅色代表比上期高、綠色代表比上期低；升降本身沒有好壞之分」**不可刪** ——
沒有它，紅色會被讀成好消息。`MacroPage.tsx` 的 `IndicatorRow` 註解與一條測試都鎖著這件事。

### 抽出 `Charts/SparkCell.tsx`

法人表與總經表都要迷你走勢線，**只抽繪製、不抽 streak 判定** ——
法人看金額正負號、總經看與前一期的升降，是兩件事，合成一個「通用 streak」
只會多一個參數與一段條件。畫不出線時由元件自己印「—」（兩張表要的行為一致）。

`TwMarketSection` 的 `TrendCells` 改呼叫它，**行為不變**，該檔既有測試原封通過。

### 驗證

`npm test` 843/843（新增 2 案例、改寫 5 個）、`oxlint` 僅 3 個既有 warning、
`tsc -b` 與 `npm run build` 通過。**純前端 —— 資料欄位全部現成，
不需要部署 Edge Function、不需要動任何 Supabase 環境。**

---

- Agent: Claude
- Action: 0.6.34 合併到 `main`，正式區補上 0.6.31–0.6.34 的後端異動
- Status: **完成 —— 兩區程式碼與 schema 已同步**
- Timestamp: 2026-08-05 11:52:00 Asia/Taipei

---

## 📅 Log: 2026-08-05 11:52:00 Asia/Taipei（0.6.34 併入 main）

- **Agent**: Claude
- **Action**: dev → main 快轉合併並部署正式區

**正式區先前停在 0.6.30 的程式碼**，所以這次一口氣要補 0.6.31–0.6.34 的後端異動。
順序刻意是「先後端、後推 main」—— push 到 `main` 會立刻觸發 Pages，
前端上線時後端若還沒補，畫面會整排平盤色。

| 項目 | 正式區處置 |
| ---- | ---- |
| `price_cache.prev_close` | `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 已執行（身分檢查：27 筆快取） |
| `stock-price` | v12 → v13（預設 `verify_jwt=true`） |
| `stock-report` | v28 → v29，**帶 `--no-verify-jwt`**（確認部署後仍是 `verify_jwt=false`） |
| `sync-market` cron | 已存在（jobid 15，`0 8-10 * * 1-5` UTC＝台北 16–18 點），未新增 |

實打驗證：`TPE:2330` 2400／昨收 2320、`US:AAPL` 309.38／303.42，
`price_cache` 的 `prev_close` 已回寫。

**所有 Supabase 操作都走 Management API（URL 帶 project ref），不用 `db query --linked`** ——
當下 CLI link 的其實是正式區，用 `--linked` 改測試區會無聲寫錯專案（`supabase-ops` skill 記載的坑）。

⚠️ **法人買進 / 賣出在正式區需要時間回補**：`stock-report` 每班最多補 15 天（`MAX_MARKET_INST_DAYS`），
0.6.32 之前補到的日子只有差額。畫面上那些日子的展開鈕要等排程跑過才會出現。

---

- Agent: Claude
- Action: 現價漲跌著色；台股三張圖同步 hover；總經卡片改用連續期數（0.6.34 定版）
- Status: **完成 —— 841 測試全過；兩區皆已部署（見上一則）**
- Timestamp: 2026-08-05 11:45:00 Asia/Taipei

---

## 📅 Log: 2026-08-05 11:45:00 Asia/Taipei（0.6.34）

- **Agent**: Claude
- **Action**: 依使用者三點要求實作

### 1. 現價字級調回 + 漲跌著色

0.6.20 把現價放大到 17px/700，這次改回一般字級，改用顏色（紅漲綠跌，基準昨收）。
**取捨的理由**：放大只說得出「這欄重要」，顏色說得出「今天是漲是跌」，後者才是看現價時要知道的。

**基準取昨收、不取今開**（使用者原話是「昨收或今開」，這裡選了昨收）：
MIS 兩個都給（`y` / `o`），但 Yahoo 的 chart meta 只穩定給昨收，今開要另外拆
`indicators.quote[0].open`。用昨收台美才是同一套口徑，也與看盤軟體的「漲跌幅」一致。

**不多打任何一次外部 API** —— `y` 與 `chartPreviousClose` 本來就在同一筆回應裡，先前被丟棄。

⚠️ **需要 schema 異動**：`price_cache` 加 `prev_close`。快取一命中就不會再問來源，
基準沒跟著存的話顏色會在 TTL 內外之間閃（有色 → 灰 → 有色）。
localStorage 快取 key 同步升到 `price-cache-v2`，讓舊快取一次汰換。

**台股 OpenAPI 備援路徑（TWSE/TPEx 日收盤清單）沒有昨收**，走到那條的代號一律平盤色。

### 2. 台股三張圖上中下 + 共用 hover

`ChartFrame` 新增**受控 hover**（`hoverIndex` / `onHover`），未給則維持各圖自持 ——
其餘呼叫端不受影響。索引由 `TwMarketSection` 持有，三張圖一起反白同一天。

**關鍵前提是三張圖吃同一組 days**：原本 K 線把開高低不全的日子過濾掉，
那樣第 N 根就不是另外兩張的第 N 天。改成 `Candle` 的開高低收可為 null、該欄留白但保留。
用收盤補開高低仍然不行（會畫出一整排十字線）。

高度由並排的 220 改成 180/180/140 —— 疊起來總高是三者相加，沿用 220 會變成 700px 的一面牆。
`.chart-pair` 已無使用者，一併移除（匯率頁的 `.fx-chart-pair` 不受影響）。

### 3. 美國總經卡片：走勢線 → 連續期數 chip

使用者選的是 b 方案（保留在卡片上，換成文字 chip），不是把趨勢欄加進下方表格。

**不能直接沿用 `trendAt`**：法人買賣超看正負號（買超 / 賣超本身有方向），
但 CPI 年增率永遠是正的，這裡看的是**與前一期的升降**。連 2 期以上才顯示。
**刻意不套漲跌色** —— 物價或信心「比上期高」沒有好壞之分（同 `fmtDelta` 既有的取捨）。
缺值會中斷連續計算：把缺值當成「與前一期相同」會把兩段不相干的走勢接成一段。

### 驗證

`npm test` 841/841（新增 5 案例、改 10 個）、`oxlint` 僅 3 個既有 warning、
`tsc -b` 與 `npm run build` 通過。

測試區實機驗證（Management API，專案 ref 明確指定，不走 `db query --linked`）：
- `ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS prev_close` 已執行。
- `stock-price` 已部署（index.ts + misParse.ts 都上傳）。
- 實打回應：`TPE:2330 price 2400 / prevClose 2320`、`US:AAPL 309.38 / 303.42`，台美兩市都有。
- 立即再打一次，`asOf` 不變（確認命中 DB 快取）且 `prevClose` 仍在 —— 加欄位的目的達成。

⚠️ **正式區完全未動**（仍是 0.6.30 的程式碼與沒有 `prev_close` 的表）。
合併到 `main` 時必須先跑那條 ALTER、再部署 `stock-price`，否則前端會整排平盤色。

- Agent: Claude
- Action: 台股市場卡片整理；全市場法人進到後台時間軸（0.6.33 定版）
- Status: **完成 —— 836 測試全過；純前端，不需要部署 Edge Function**
- Timestamp: 2026-08-05 10:55:00 Asia/Taipei

---

## 📅 Log: 2026-08-05 10:55:00 Asia/Taipei（0.6.33）

- **Agent**: Claude
- **Action**: 依 0.6.32 上線後的實機回饋修正六點

### 卡片（`TwMarketSection.tsx`）

1. **移除法人買賣超長條圖**：同一份數字有表格（金額）與趨勢欄（方向），長條圖是第三種說法。
2. **指數兩種畫法並排**（新增 `.chart-pair`，≤900px 疊成一欄）。兩張圖高度都指定
   `PAIR_CHART_H = 220`，否則左右高度不同（元件預設 260 / 170）看起來像沒對齊。
   **`.chart-pair` 與 `.fx-chart-pair` 刻意分開定義** —— 後者綁著匯率頁的 `.fx-chart-head`，
   共用會讓兩處的改動互相牽連。斷點取一致（900px）。
3. **趨勢拆成兩欄**（`TrendCell` → `TrendCells`，回傳兩個 `<td>`）。原本走勢線與「連 N 日」
   在同一格靠右排，有標籤的列會把線往左推，列與列之間的走勢範圍看起來不一樣。
4. **「全部展開 / 全部收起」**。`allOpen` **只計可展開的列**（`institutional.buy` 存在的），
   否則沒有明細的舊資料日會讓 `allOpen` 永遠是 false、按鈕卡在「全部展開」按不動
   （同 `YearlyPage` 只計 `sells` 不為空的個股）。
5. **hint 由兩大段砍成一句**，抓取週期整段移到後台。理由不只是版面：
   前端自備一份班次常數必然與 pg_cron 漂移，**而且已經漂了** —— 卡片寫著「最多 5 個交易日」
   時後端的 `MAX_MARKET_INST_DAYS` 已經是 15。

### 後台時間軸（`timeline.ts` / `AdminStatusPage.tsx`）

新增 `market` 這條 chain，既有的 `institutional` 改名「三大法人・個股」、新的叫
「三大法人・全市場」。**使用者就是因為看到「三大法人」以為全市場那份也已納入監看才回報的**，
兩列必須一眼分得出來（T86 是每檔持股、單位股；BFI82U 是整個集中市場、單位元）。

兩個與其他四列不同的判定，都寫進註解了：

- **`dueBy: 3` 而不是 1.5**：其他列由盤後批次（16:00–23:45 每 15 分）負責，公布窗一結束的
  下一班就該到手；全市場走獨立排程 `market-daily`，整天只有 16:00 / 17:00 / 18:00 三班，
  最後一班是第 3 小時。沿用 1.5 的話每天 16:15 一到就亮紅燈 —— 永遠亮著的告警等於沒有告警。
- **刻意不套 `partial`**：法人逐日回補，最新一兩天沒補到是常態，拿它當「不完整」
  會讓這一列幾乎每天黃燈。待補天數已經在下方的「台股全市場」KPI 講清楚了。

⚠️ **時刻是 `market/daily.json` 的 `asOf`，是近似值**：17:00 那輪就算只更新成交量值也會推進它，
不是那一天法人金額實際到手的時刻。副標因此寫「BFI82U・檔案產出時間」而不是 `spec.hint`。
要精確到逐日得在 schema 加 `institutionalFetchedAt`，但既有的日子都不會有那個欄位、
加了也是空的，故本次不做。

驗證：`npm test` 836/836（新增 6 案例、改 4 個）、`oxlint` 僅 3 個既有 warning、
`tsc -b` 與 `npm run build` 通過。**純前端，Edge Function 不需要重新部署。**

---

- Agent: Claude
- Action: 法人買進 / 賣出與趨勢欄；抓取週期與全市場監控進到後台（0.6.32 定版）
- Status: **完成 —— 831 測試全過；測試區已部署 v43，24/24 天資料已補齊**
- Timestamp: 2026-08-05 10:05:00 Asia/Taipei

---

## 📅 Log: 2026-08-05 10:05:00 Asia/Taipei（0.6.32）

- **Agent**: Claude
- **Action**: 三大法人買進 / 賣出 / 趨勢，抓取週期與全市場抓取狀況

使用者要三件事：法人表要有買進與賣出、要有趨勢、抓取週期與狀態監控要在後台看得到。

### 資料形狀：既有六欄原地不動

`MarketInstitutional` 頂層那六個買賣差額欄位**完全沒動**，買進 / 賣出改成掛在旁邊的
`buy` / `sell`，兩者共用新抽出的 `MarketInstitutionalSide`（同樣六個單位）。
這樣既有的 KPI、長條圖、表格全部零波及，展開明細也只要 iterate 一份 `UNITS` 常數。
`MARKET_SCHEMA` 由 1 升到 2；前端 `MIN_MARKET_SCHEMA` **維持 1** —— 加欄位對舊讀者無害，
升 MIN 只會讓部署空窗期整張卡片消失。

### 四個必須擋掉的迴圈 / 陷阱

1. **回補判定**：`planInstitutionalBackfill` 原本只挑 `!institutional` 的日子，
   既有 120 天早就補過，買進 / 賣出會永遠是 null。改成「沒有 `buy` 也算缺」。
2. **空殼**：`parseBfi82u` 若端點少了買進欄，回傳六欄全 null 的 `buy` 物件會讓判定
   誤以為補過。故整組解不出來就給 `null`。
3. **補了又被洗掉**：新增 `mergeInstitutional`，重抓沒吐買進 / 賣出時留用舊值，
   否則會變成「補上 → 被覆寫成 null → 又排進回補」的無限迴圈。
   `syncMarket` 的回補迴圈也改走這支，不再直接覆寫。
4. **寫檔簽章看不出差別**（最險的一個）：`syncMarket` 比對內容用的 `signature` 原本只記
   `institutional ? 1 : 0`。0.6.32 的回補是去補**已經有差額**的舊日子 —— 簽章一字不變，
   整份檔案不會寫回 Storage，補到的買賣金額每輪都被默默丟掉。改記三態（0 / 1 / 2，
   2 = 連買賣金額都有）。這正是註解裡「與 backfillProfit 的 EPS 同一個坑」那句話警告的事。

### 趨勢欄

走勢線取 **15 個交易日**而不是表格的 7 列：只用表內資料的話第一列只有一個點畫不出線。
底稿只取「有法人金額」的日子 —— 把還沒補到的日子留在序列裡，走勢會出現憑空斷點，
連續天數也會被一個「還沒補到」打斷而低報。連續 1 天不印（1 天不是趨勢）。

### 展開明細用巢狀表格，與年度收益相反

年度收益的明細列與父列是同一組欄位，欄寬必須對齊；這裡的明細是「六個單位 ×
買進 / 賣出 / 買賣超」，與父列的「六個單位各一欄」是不同形狀，塞進同一組欄位
只會逼出一堆 colSpan 佔位格。兩處的處置相反是刻意的，註解已寫明。

### 後台

`handleAdminStatus` 多讀一份 `market/daily.json`，吐出 `marketStatus()`：最新交易日、
法人補到哪天、三個缺口（整天沒法人 / 只有差額沒買賣 / 缺開高低）。
**後端只吐事實、不判定延遲** —— 判定規則全留在前端 `timeline.ts`（純函式、有測試），
兩邊各判一次遲早不一致。

順帶修好一個既有缺陷：`describeCron` 認不得 `0 8-10 * * 1-5`（market-daily 的形狀），
整張排程表就它一個印原始 cron 字串。補上第三種形狀後翻成「週一至週五 16:00 / 17:00 / 18:00」。

### ⚠️ 部署狀態

使用者於 2026-08-05 明確授權部署測試區並調高回補預算。

**測試區已部署** —— 2026-08-05 10:15:00 Asia/Taipei，`Stock-Pnl-Web-Dev`
（`wqetxuhncvfidqnklyew`），`stock-report` v41 → **v42**，`verify_jwt` 維持 `false`。
指令：`supabase functions deploy stock-report --project-ref wqetxuhncvfidqnklyew --no-verify-jwt`。
已用 `functions download` 逐檔比對，`index.ts` / `twMarket.ts` / `twChips.ts` / `report.ts`
與 `dev` 分支**位元組相同**（不看版本號推論，見 supabase-ops skill）。
**正式區未動**（仍是舊版，`main` 分支也還沒合併）。

部署當下的 `market/daily.json` 基準（10:17 讀取，公開 bucket 唯讀）：
`schema: 1`、24 天、20 天有法人金額、**0 天有買賣金額**。
測試區這份檔案只有 24 天（不是 120），以 15 天／輪計，當天 16:00 與 17:00 兩輪就會補完。

### 驗證（使用者提供 CRON_SECRET 後手動觸發，10:20–10:22）

第一次觸發回 **500**：`syncMarket` 用了 `mergeInstitutional` 卻**沒有 import**。

⚠️ **這個工具鏈盲區要記住**：`supabase/functions/` 是 Deno 程式碼，
`npm run build` 的 `tsc -b` 只涵蓋 `src/`，vitest 也只直接測 `twMarket.ts` ——
**沒有任何一關會檢查 `index.ts` 的 import 是否齊全**。本機沒裝 deno，
`deno check` 跑不了。改完 `index.ts` 後若無法靜態檢查，部署完**務必實際打一次**再收工。
（已用腳本掃過 index.ts 對本地模組的其他呼叫，沒有第二處遺漏。）

補上 import、重新部署（v42 → v43）後兩輪觸發：

| 輪次 | institutionalFilled | durationMs |
| ---- | ---- | ---- |
| 第一輪 | 15（預算上限） | 4158 |
| 第二輪 | 9 | 5179 |

**結果：24 / 24 天全部有法人金額與買進 / 賣出，`schema` 由 1 變 2，待補 0。**
15 天約 4 秒，證實預算 15 的時間估計正確（cron timeout 60 秒，餘裕充足）。

資料正確性抽驗 2026-08-04 外資：買進 4476.6 億 − 賣出 4533.9 億 = −57.3 億，
與官方揭露的差額**完全相符**；合計亦相符（+20.0 億）。

⚠️ **驗證時的陷阱**：`reports` bucket 的公開 URL **走 CDN 快取**。第二輪跑完後直接
curl 公開 URL 讀到的仍是上一輪的內容，差點誤判「第二輪沒生效」。
驗證務必加 cache-buster（`?t=$(date +%s)`）—— 這與 `reportsBucket.ts` 開頭記載的
「1 小時瀏覽器快取」是同一個東西的不同面向。

`MAX_MARKET_INST_DAYS` 由 5 調到 **15**（`schema.sql` 的 cron 註解同步更新）：
120 天的重抓由 8 個工作天縮到約 3 個。每個請求自帶 10 秒逾時、單日請求實測 0.2–0.4 秒，
15 個約 3–6 秒，遠低於 cron 的 60 秒 `timeout_milliseconds`；這一班是獨立 action，
不與個股報告搶時間。**正式區未動**（仍在 `main` 分支的舊版）。

驗證：`npm test` 831/831（新增 11 個案例）、`oxlint` 僅 3 個既有 warning、
`tsc -b` 與 `npm run build` 通過。

---

- Agent: Claude
- Action: 大盤法人買賣超逐日表格；年度收益加報酬率欄（0.6.31 定版）
- Status: **完成 —— 820 測試全過；純前端，不需要部署 Edge Function**
- Timestamp: 2026-08-05 09:42:00 Asia/Taipei

---

## 📅 Log: 2026-08-05 09:35:00 Asia/Taipei（0.6.31，同版第三次異動）

- **Agent**: Claude
- **Action**: 年度收益表格新增「報酬率」欄

報酬率 = 已實現損益 ÷ 賣出成本，插在「已實現損益」與「手續費 / 稅金」之間，
年度 / 個股 / 逐筆賣出三層列都顯示。新增 `RoiCell`（`YearlyPage.tsx`），
與 `AmountCell` / `FeeCell` 並列。

**分母為 0 的兩種情況必須擋掉**（這是本欄唯一的陷阱）：

- 「僅買進」個股：成本與損益都是 0 → `0/0 = NaN`
- 「超賣」：超出持股的部分成本以 0 計 → `x/0 = Infinity`

`RoiCell` 對含費與未含費兩個分母各自判斷，為 0 就給 `null`、顯示「—」，
兩者皆 null 時整格「—」（沿用 `AmountCell` 的 muted 樣式）。

**口徑沿用左邊三欄的雙行體例**：主行含費（實際賺賠的百分比）、副行「未含費 x%」
（純價差，會比實際好看）。與庫存總覽的「未實現報酬率」同為含費口徑，兩頁可以對照。

驗證：`npm test` 821/821、lint 僅 3 個既有 warning、build 通過。
`App.smoke.test.tsx` 補兩處斷言 —— CSV 匯入情境核對 `+39.18%` 與副行 `未含費 +40.00%`
（98096/250356 與 100000/250000），只買未賣情境核對表頭存在且畫面無 `NaN` / `Infinity`。

---

## 📅 Log: 2026-08-05 09:42:00 Asia/Taipei（0.6.31，同版第四次異動）

- **Agent**: Claude
- **Action**: 移除法人表格右側「我的買進 / 我的賣出」兩欄

⚠️ **這兩欄曾在 commit `1960345` 實作並提交，同日經使用者決定移除。不要再加回來** ——
不是漏做，是刻意拿掉的。要看自己的交易請到交易紀錄頁。

一併移除的還有為它拉出來的整條資料通道：`AppShell` → `MacroPage` → `TwMarketSection`
的 `transactions` prop（`MacroPage` 只負責轉交，自己從未使用）、`twFlowByDate()` 彙總函式、
以及對應的測試案例。`TwMarketSection` 回到完全自載入、無 props 的形態。

若日後要重做，`1960345` 裡有完整實作，當時記下的兩個關鍵點仍然成立：

1. **不能在 `TwMarketSection` 內呼叫 `useWorkspace()`** —— 沒有 provider 時會 throw
   （`WorkspaceContext.tsx:228`），且 `WorkspaceContext` 沒有 export、無法做寬容 fallback；
   `TwMarketSection.test.tsx` 與 `MacroPage.test.tsx` 都是裸 render，直接呼叫會打掛既有測試。
2. **金額口徑**沿用交易紀錄頁的 `cashFlow`（買進含費、賣出扣費），單位維持元不換算成億元。

驗證：`npm test` 820/820、`oxlint` 僅 3 個既有 warning、`npm run build` 通過。
「缺料列整列 —」斷言由 8 欄改回 6 欄。

---

## 📅 Log: 2026-08-04 22:35:00 Asia/Taipei（0.6.31）

- **Agent**: Claude
- **Action**: 台股市場的法人買賣超加逐日表格

使用者回報「看不出以天為單位的買賣超」—— 長條圖答得出方向，答不出金額。
補一張表在圖下方，逐日列外資 / 外資自營商 / 投信 / 自營商（自行）/ 自營商（避險）/ 合計。

三個沿用既有準則的地方：

1. **表由新到舊、圖由舊到新**（與月營收、獲利能力一致）。兩者方向相反是刻意的，
   已寫進註解免得下一個人「順手修正」。
2. **合計取官方揭露值**，不由前五欄自己加總（同 ChipsTab 的處置）。
3. **還沒補到法人金額的日子整列「—」**，不以 0 冒充 —— 那是「還沒補到」不是「零進出」。

驗證：`npm test` 820/820、lint 3 個既有 warning、build 通過；
另以暫時的 vite 入口 + Playwright 掃深淺兩色與 375px，實際核對前五欄相加等於合計
（112.7 + 0 + 23.1 + 2.9 + 5.8 = 144.5 ✓），缺料日整列為「—」，無橫向溢出。

⚠️ 驗證期間為了讓元件讀得到假資料，曾暫時改 `marketProxy.ts` 注入 —— **已 `git checkout` 還原**，
未進 commit（確認過 `__market` 字串為 0 個）。

---

## 📅 Log: 2026-08-04 22:15:00 Asia/Taipei（0.6.30）

- **Agent**: Claude
- **Action**: 台股市場加上加權指數日 K，法人買賣超改看 7 個交易日

### 資料面：K 線要的開高低不在原本那支端點

`FMTQIK` 只給收盤指數與漲跌點數。開高低在 **`MI_5MINS_HIST`**
（`rwd/zh/TAIEX/MI_5MINS_HIST?date=YYYYMM01`，實測回整月的開高低收）。
兩支都是「一次一個月」，故同一輪抓完就併，不必各自維護進度。
**收盤刻意只由 FMTQIK 寫**：同一個欄位讓兩支各寫一次，總有一天會不一致，
而且看不出是哪一支寫的。

### 又踩到同一個坑：新欄位對既有資料是缺口

第一次部署後只有 2 根 K —— 因為 `planMarketMonths` 只回本月，而 7 月的 22 天
是舊版寫的、沒有開高低，且再也不會被碰到。與 EPS 完全相同的處境。
改成**缺口驅動**：本月 + 任何還缺開高低的月份，上限 3 個月、由新到舊。
補完之後每輪又只剩本月，成本回到原樣。

> 教訓（第三次遇到，寫下來）：**在既有的滾動資料結構上加欄位時，
> 一定要同時想「舊資料上的這個欄位是缺口嗎？誰會去補？」**
> EPS、market 的開高低都是這樣。只加欄位不改缺口判定＝那個欄位永遠只有新資料才有。

### 法人買賣超改 7 日

與個股分析的籌碼圖一致（那裡是 `HISTORY_DAYS = 7`）。兩張圖問的是同一個問題
「法人這幾天在買還是在賣」，一張看一週、另一張看一季會讓人以為在比不同的東西。
成交金額與 K 線維持 60 天：那是「行情在什麼位置」的脈絡，需要更長。

### K 線的缺料處理

開高低與收盤不同源，最新一兩天可能只有收盤 —— **那幾天不畫 K 棒**。
不拿收盤冒充開盤：會畫出一整排十字線，看起來像真的「那天沒有波動」。
標題會標明實際畫得出幾根。

### 驗證

`npm test` **818/818**（新增 8 條）、lint 3 個既有 warning、build 通過。
兩區皆已部署 stock-report。

---

## 📅 Log: 2026-08-04 21:55:00 Asia/Taipei（0.6.29 補強與部署）

- **Agent**: Claude
- **Action**: 把 warm 從「補一輪」改成「補到滿」，部署兩區，清掉新聞殘留，並實測驗收

### 為什麼「補一輪」不夠

使用者的驗收標準是「新股票產生個股分析時要跟既有股票一樣有資訊」。
只補一輪的話第一次開頁仍然只有 2–3 個月，而且**第二次開頁不會再補** ——
前端原本只在「完全查無」時才叫 warm，檔案一旦建立就再也不叫了。兩處都要改：

1. **後端**：warm 改成一輪一輪補到沒東西可補，或用完 `WARM_BUDGET_MS`（30 秒）。
   預算是**時間**不是輪數 —— 月營收一輪 4 個月 × 兩市場 × 400KB，
   季報一輪 2 季 × 兩市場 × 1.6MB，成本差四倍，用輪數當上限會一邊超時一邊浪費。
   先補月營收再補季報：同樣的秒數先換到比較多的完整度。
2. **前端**：`!f || needsFundamentalBackfill(f)` 才叫 warm（門檻用後端的 cap：12 月 / 12 季）。
   `warmStock` 的「同代號每 session 只叫一次」封印改成**伺服器回報未補完時解除** ——
   有終點的迴圈，補滿後伺服器回 `fundamentalComplete: true`，封印從此生效。
   重讀 Storage 的條件也改看新的 `backfilled` 計數：回補是併進既有檔案的，
   不會讓 `fundamentalSynced` 增加，用舊條件會補了卻不重讀。

### 實測（測試區，刪掉 8033 的基本面檔模擬全新股票）

| | 第 1 次 warm（34 秒） | 第 2 次 warm（27 秒） |
| ---- | ---- | ---- |
| 月營收 | 12 / 12 ✅ | — |
| 季度 | 8 / 12 | **12 / 12 ✅** |
| EPS | 8 季 | **12 季 ✅** |
| `fundamentalComplete` | false | true |

也就是「開頁 → 等半分鐘 → 月營收已滿、季度八成」，再開一次就全滿。
既有標的（1802）當時只有 2 季 EPS —— 因為它靠夜間回補、每輪 2 季，
而批次在當天資料齊了之後就短路。已用新的 warm 把兩區既有標的一併補齊。

### 部署與清理（使用者授權 DB / Storage）

- `stock-report`：測試區 **v38**、正式區 **v26**，皆 `verify_jwt=false`
- 兩區 Storage 的 `news/*.json` 全數刪除（各 5 檔），刪後以 service key 列表覆驗為 0
- 兩區 `app_settings` 的自訂提示詞檢查：`ai_prompt_analysis` / `ai_prompt_chat`
  **都不含「新聞」**，無須修改（正式區有自訂分析詞，但內容不含新聞條款）
- ⚠️ 覆驗身分**不要用 `batch_run_log` 筆數**：兩區現在都在 200 上下，分不出來。
  改用 `cron.job` 的 url（裡面帶著 project ref），那是唯一不會誤判的。

---

## 📅 Log: 2026-08-04 21:35:00 Asia/Taipei（0.6.29）

- **Agent**: Claude
- **Action**: 即點即產順手補一輪歷史；新聞功能整個移除

### 1. 新股票不必等到隔天

**問題**（使用者回報「新股票的月營收好像不會馬上抓」）：
`warm` 只跑 `syncDaily` + `syncFundamental`，而後者的來源端點**只回最新一期** ——
月營收 1 個月、獲利能力 1 季，且沒有 EPS。歷史與 EPS 全靠回補，
而回補在 `handleGenerateAll` 裡排在 `decideSkip` **之後**：當天 T86 定稿且融資融券已到
就整段短路。結果是晚上加的股票當天一輪都補不到，隔天的批次才開始長。

**做法**：`handleWarm` 追加一輪 `backfillRevenue` + `backfillProfit`，
預算刻意比夜間小（月營收 2 個月、季報 **1** 季），因為這是使用者正在等的請求。
兩支回補**必須循序**：都會下載、合併、覆寫同一個 `fundamental/{ticker}.json`，
並行會有一邊的寫入被蓋掉。回補本身缺口驅動，補滿的舊標的幾乎零成本。

### 2. 新聞功能整個移除

使用者要求全部刪掉，並提到「之前已經說過不要了」。**查證後：0.6.13 移除的是
管理後台的新聞追蹤，功能本體當時仍在**（PROGRESS 當年就寫明「不是把新聞功能拿掉」），
所以這次才是真正的移除。刪除範圍：

- 後端：`twNews.ts` / `twNews.test.ts`、`syncNews()`、generate-all 的呼叫與 `news_synced`、
  `pruneStorage` 的 `news` 目錄
- 前端：`newsProxy.ts` / 測試、`AiTab` 的 `fetchNews`、`aiPayload` 的 news 區塊與 prompt 段落
- 提示詞：`aiPrompts.ts` 分析準則第 6 條（新聞）刪除並重新編號、追問範圍去掉「新聞標題」、
  `aiChat.ts` 的婉拒句、後台 PromptsSection 的說明文字、`timeline.ts` 的班次說明
- 文件：`SPEC.md` 的「消息面」段落（改為一行移除註記）

**⚠️ 尚未處理、需要人工決定的兩件事**：
1. 兩區 Storage 仍有 `news/{ticker}.json` 舊檔（不再被讀取，也不再被寫入）。
   要清掉的話得逐檔刪 —— 屬於資料刪除，未經指示不做。
2. **管理員若曾在後台儲存過自訂的分析提示詞，那份仍留著舊的第 6 條（新聞）**。
   程式碼的預設值已更新，但 DB 裡的自訂版本不會自動跟著改。

### 驗證

`npm test` **809/809**（822 − 13 條新聞測試）、lint 3 個既有 warning、build 通過、
Edge Function 以 tsc 做語法檢查無誤（Deno 專用檔，不進 vitest）。

---

## 📅 Log: 2026-08-04 21:10:00 Asia/Taipei（0.6.28 部署）

- **Agent**: Claude
- **Action**: 依使用者明確指示，部署 0.6.28 到測試區與正式區
- **Status**: COMPLETED

### 做了什麼

| 項目 | 測試區 `wqetxuhncvfidqnklyew` | 正式區 `kxnxadaghidwumqsqneu` |
| ---- | ---- | ---- |
| `stock-report` 部署 | v37，`verify_jwt=false` | v25，`verify_jwt=false` |
| `market-daily` 排程 | 已建，`0 8-10 * * 1-5` | 已建，`0 8-10 * * 1-5` |
| `market/daily.json` | 24 天（07-01→08-04），法人已補 5 天 | 同左 |
| EPS 回補（抽查 1802） | 12 季中 2 季有 EPS | 同左 |

首跑觸發後實測數字：最新交易日 2026-08-04 成交金額 10,870.5 億、加權指數 43,360.66、
三大法人合計 +20.0 億（外資 −57.3 億）。1802 的 2026-Q1 EPS 為 0.2、2025-Q4 為 −0.2，
`epsChecked` 恰好只標在這兩季 —— 與 `MAX_BACKFILL_QUARTERS = 2` 一致，
**而且補的是最新的兩季**，證實「`needEps` 不受 `through` 限制」那條確實生效
（舊邏輯下這兩季因為已存在而永遠不會被回頭補）。

### 兩個做法值得沿用

1. **cron 不用佔位符，改沿用同一個資料庫裡既有 job 的指令字串**：
   ```sql
   PERFORM cron.schedule('market-daily', '0 8-10 * * 1-5',
     replace(cmd, '{"action":"sync-macro"}', '{"action":"sync-market"}'));
   ```
   `<PROJECT_REF>` / `<CRON_SECRET>` 從頭到尾沒出現過，BUG-002/003 那顆地雷直接繞開，
   Agent 也不需要（也拿不到）密鑰明文。
2. **身分檢查寫進同一個 DO 區塊**：先從 `macro-daily` 的 url 取出 ref，
   不符預期就 `RAISE EXCEPTION` 中止。`db query --linked` 認的是當下 cwd，
   分兩次查擋不住（supabase-ops 記載的 2026-07-27 事故）。正式區另以
   `batch_run_log` 筆數（199）二次確認不是測試區。

### 首跑是手動踢的，理由

`market-daily` 下一班是隔天台北 16:00，不先跑一次的話今晚整夜都是空畫面。
用的是同一招（`EXECUTE cmd`），順手也踢了一次 `backfill-profit` 讓 EPS 先補兩季。

---

## 📅 Log: 2026-08-04 20:50:00 Asia/Taipei（0.6.28）

- **Agent**: Claude
- **Action**: 季度每股盈餘（EPS）與台股全市場量能／法人買賣超

### ⚠️ 這一版需要部署才會有資料

前端已上線但**兩區的 Edge Function 都還是舊版**，所以：
EPS 欄位會全是「—」、總經頁的「台股市場」會顯示「市場資料尚未產生」。
待使用者指示後執行（§13.2 規定不主動部署）：

1. `supabase functions deploy stock-report --no-verify-jwt`（兩區各一次）
2. 在 SQL Editor 跑 `schema.sql` **§10b** 那一段建立 `market-daily` 排程
   （⚠️ 替換 `<PROJECT_REF>` / `<CRON_SECRET>`，跑完做 §6d 覆驗）
3. EPS 不需要新排程：既有的 `backfill-profit` 會自己把 12 季逐批補上（每輪 2 季、約 6 輪）

### 端點探路的結果（與原本的推測不同，記下來）

- `FMTQIK` 的 **openapi 版只回最新一天**，但 **rwd 版帶 `date=YYYYMM01` 回整個月的每日列** ——
  所以成交量值的歷史一次一個月就補得完，用的是 rwd 版。
- `BFI82U` **不在 openapi 清單裡**（只有 rwd 版）。而且 `type=month` 回的是**整月合計**、
  不是逐日 —— 所以法人買賣金額**一天一個請求**，必須預算式回補（`MAX_MARKET_INST_DAYS = 5`）。
- **EPS 的期間基準已驗證一致**：`t187ap06_L_ci` 的營業收入與 `t187ap17_L` 的
  營業收入(百萬元) 逐檔吻合（1232 / 1477 / 1582 實測），所以季報的 EPS 與畫面上的比率
  是同一個基準，可以放進同一列。

### EPS 的三個坑（都已修，且都寫了測試）

1. **每晚的覆寫會洗掉 EPS**。`t187ap17_L` 沒有 EPS，那一筆每晚覆寫同一季 →
   補好的 EPS 天天被清掉。故 `mergeProfitQuarters` 的 EPS **逐欄合併、誰查過誰贏**，
   不跟著整筆取捨走（`fillGapsOnly` 那個方向也一樣會弄丟）。
2. **只補 EPS 時不會寫檔**。`backfillProfit` 原本比「季別清單」判斷有沒有變，
   而補 EPS 不會動到季別 → 補了也不存。簽章改成帶 `epsChecked`。
3. **`through` 會擋住最新一季的 EPS**。它記的是「比它舊的都問過了」，
   而 EPS 缺口出現在最新那幾季，正好在另一側。故 `needEps` 的季別**不受 through 限制**，
   改以 `epsChecked` 防止無限重抓（問過就算數，即使那一列真的沒有 EPS）。

### 台股市場為什麼放在總經頁而不是年度收益頁

年度收益回答「我賺了多少」（全部是個人已實現損益），大盤量能回答「市場如何」。
放同一頁，讀者每看一個數字都要先判斷這是自己的還是大盤的。
總經頁本來就是「與個股無關的共用背景」，市場量能屬於那裡。

### 驗證

`npm test` **822/822**（新增 21 條：EPS 後端 6、EPS 前端 4、市場模組 17 之中的 17… 實際為
EPS 10 + 市場 11）、lint 3 個既有 warning、build 通過。
EPS 版面另以暫時的 vite 入口 + Playwright 掃過深淺兩色與 375px：
EPS 走勢圖自成一軸（5–20 元）、最新一季無 EPS 時退回上一季並標明季別、無橫向溢出。
**台股市場區塊只有 jsdom 測試，沒有瀏覽器實測** —— 本機模式讀不到 Storage，沒有資料可畫。

---

## 📅 Log: 2026-08-04 20:20:00 Asia/Taipei（0.6.27）

- **Agent**: Claude
- **Action**: 籌碼分頁「近 N 日買賣超」並排圖的圖例可關掉個別法人

沿用 0.6.26 在 `ChartLegend` 加的 opt-in 切換，`ChipsTab` 只是接上去，沒有新機制。
價值同樣在**縱軸重算**：外資的量級常是投信的數十倍，關掉外資之後另外三家才拉得開。

### 兩個範圍決定

1. **只有 `all`（並排）模式給切換**。切到單一法人時圖例講的是紅買綠賣（極性編碼），
   不是身分，那裡沒有東西可以關。
2. **顏色依 `COMPONENTS` 原始順序指派**（`colorOf(key)`），不是依過濾後的索引 ——
   否則關掉外資之後，投信會接手外資的藍色，剩下的線等於整組換色。

### 測試定位的坑

`ChipsTab` 沒有獨立測試檔，測試加在 `StockDetailPage.test.tsx`。
**不能用 `getByRole('button', { name })` 抓圖例** —— 上方切換法人的 `.chip-btn`
用的是同一批文字，會同時命中兩顆。改以 `title`（隱藏 X／顯示 X）定位。

### 驗證

`npm test` **791/791**（新增 2 條：關掉外資後該色長條消失且值域縮小、最後一個 disabled）、
lint 3 個既有 warning、build 通過。

---

## 📅 Log: 2026-08-04 20:10:00 Asia/Taipei（0.6.26）

- **Agent**: Claude
- **Action**: 獲利能力走勢圖可點圖例關掉單條線

### 需求與關鍵設計

使用者要「在曲線圖旁點一下就讓某條線消失，比較好看單個數值」。
關鍵不在於藏線，而在於**藏線之後 Y 軸要跟著重算** ——
`MultiLineChart` 的值域本來就是由傳進去的 `series` 現算的，
所以關掉的序列是**整條移出 series**，而不是畫成透明。實測：四條同軸時軸是 30–70，
只留稅後純益率後變成 35–50，那條線撐滿整張圖。

### 兩個範圍決定

1. **可切換是 opt-in**：`ChartLegend` 只有拿到 `onToggle` 的項目才變成按鈕。
   KD、均線、籌碼那三處圖例維持純標示 —— 全部變成按鈕只會讓人以為那裡有東西可按。
2. **最後一條不給關**（按鈕留著但 disabled，title 寫「至少要留一條線」）。
   全部關掉只會剩一張空座標軸，看起來像壞掉。

### 為什麼拆出 `MarginTrendChart`

`FundamentalTab` 是純呈現元件、開頭就有兩個提早 return；要記收合狀態就得把 hook
提到最前面宣告。狀態只有這張圖需要，故拆成同檔案內的小元件，FundamentalTab 維持原狀。

### 驗證

`npm test` **789/789**（新增 3 條：切換、Y 軸重算、最後一條不給關）、
lint 3 個既有 warning、build 通過。
另以暫時的 vite 入口 + Playwright 實測深淺兩色與 375px：關掉三條後軸由 30–70 變 35–50、
關掉的色塊變空心、最後一條 disabled、無橫向溢出。驗完即刪。

---

## 📅 Log: 2026-08-04 19:55:00 Asia/Taipei（0.6.25）

- **Agent**: Claude
- **Action**: 獲利能力加上 12 季四線走勢圖（版本 A）

### 選版經過

先出三份設計稿並排比較（artifact，見 TASK.md Task 54），使用者選 **A｜四線同軸**。
設計稿階段有兩個發現與原本的計畫不同，記下來：

1. **A 的弱點比預期溫和**。原本以為低毛利股會「四條線擠在底部」，
   實際上 `niceDomain` 會把鴻海的值域吸附成 2–8，線是有拉開的；
   真正糊掉的是營益 / 稅前 / 稅後三者的差距（全在 1.2 個百分點內）。
2. **B 有計畫沒列到的致命傷：PDF**。整頁被 html2canvas 擷取，而 B 一次只顯示一項，
   另外三項在紙上永遠不存在 —— 與 0.6.24 移除收合的理由是同一條。

### 實作

`FundamentalTab.tsx` 獲利能力區塊，KPI 卡之下、表格之上（**圖在上、表在下**，
照月營收既有版面）。`MultiLineChart` + `ChartLegend`，版面結構照抄 KD 那段的
`.chart-with-legend` / `.chart-legend-side`。四項的名稱、顏色、順序集中在 `MARGIN_SERIES`
一份資料，圖與圖例都由它產生。

### ⚠️ 方向陷阱（與月營收同一個坑）

圖必須用 `profitQuarters`（由舊到新），不是為了表格 reverse 成新→舊的 `quarters`。
拿錯的話整條線會反過來、而且看起來完全像真的。已用「毛利率逐季走高 → y 座標逐點變小」
寫成測試釘住方向。

### 驗證

`npm test` **786/786**（新增 6 條：四線與圖例、方向、X 軸抽稀、單季不畫、負值不破圖、
金融業無毛利率）。lint 3 個既有 warning、build 通過。
另建一個暫時的 vite 入口渲染 `FundamentalTab`，以 Playwright 掃深淺兩色與 375px：
無橫向溢出（手機 svg 297px）、X 軸 6 個標籤不重疊、線色為字面值。驗完即刪，未進 commit。

---

## 📅 Log: 2026-08-04 19:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 移除個股分析的表格收合（0.6.24）

### 決定：整個功能拿掉，不是只拿掉按鈕

使用者在 0.6.23 上線後明確要求移除。做法是 **`git revert 2d9049b` 當機械性基底**，
而不是手動逐處刪 —— 收合牽到的地方比表面上多（測試裡的 `noCollapse`、
`StockDetailPage.test` 的 `.detail-card > [id^="sec-"]` 選擇器、
`index.css` 的 `.rpt-collapse` / `.rpt-caret`、`handleDownload` 的展開／還原），
手刪一定會漏。

### revert 之後另外處理的三件事

1. **版號不跟著回退**：revert 會把 `version.ts` / `package.json` 打回 0.6.22，
   改成 **0.6.24**；README 版本紀錄保留 0.6.23 那則（歷史不抹除），另加 0.6.24 一則。
   `docs/agent/` 兩份也是先 `git checkout HEAD --` 保住歷史再往上加。
2. **保留 0.6.23 才加的 PDF 測試 mock**：`vi.mock('../../services/reportPdf')`
   讓 PDF 路徑第一次測得到，拿掉是退步。收合那個 describe（4 條）刪掉，
   改寫成 1 條「匯出 PDF：擷取的是籌碼＋基本面＋技術面三段，持股不在裡面」——
   它同時守住「擷取範圍完整」與「沒有殘留的展開／還原邏輯」。
3. **`index.css` 那段註解重新成立**：0.6.8 原本寫著四段刻意不收合，
   0.6.23 推翻它，現在回來了。補上「0.6.23 試過、0.6.24 移除」與理由
   （收起來的區塊不在 DOM，匯出 PDF 多一條沒人看得見的失敗路徑），
   免得下一個 Agent 再走一次。

### 驗證

`npm test` **780/780**（783 − 收合 4 條 + PDF 1 條）、lint 3 個既有 warning、build 通過。

---

## 📅 Log: 2026-08-04 16:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 個股分析的表格收合 + 一鍵全部收起／展開（0.6.23）

### 推翻了一條既有決定，記下來

`index.css` 原本寫著：四段卡片刻意**不做收合**，「不需要任何互動，
也不會有『東西被收起來找不到』」。使用者現在要收合，所以那條決定作廢 ——
但它指出的風險是真的，而那正是「全部展開」這顆按鈕存在的理由。

### 範圍：只收表格，不收圖表

4 個區塊：三大法人、融資融券、獲利能力、月營收。
圖表區塊（買賣超走勢、日 K、KD）不動 —— 圖表本來就是一眼看完的東西。
清單集中在 `StockDetail/tableSections.ts`，**新增可收合表格時要同步加**，
否則「全部收起」那顆按鈕會漏掉它（那顆按鈕在 `StockDetailPage`，
它不該知道各分頁內部長什麼樣）。

### 三個實作決定

1. **收起時不渲染，而不是 display:none**。這些區塊裡有 SVG 圖表與長表格，
   收起來卻還留在 DOM，等於使用者以為省下的東西其實一樣在算。
2. **標題本身就是開關**（不是旁邊放一顆小圖示鈕）：點擊目標大得多。
   樣式刻意繼承 h3 —— 收合前後必須看起來是同一個標題，只多一個箭頭。
3. **收起時 meta 仍然顯示**（資料更新於、共 N 個月、單位）。
   那一行正是「要不要展開來看」的判斷依據，跟著收掉就沒意義了。

### ⚠️ 與 PDF 匯出的交互作用

這是本次最容易無聲出錯的地方：**收起的區塊不在 DOM 裡，直接擷取會產出
一份缺表格的 PDF，而且畫面上完全看不出少了什麼**。
故 `handleDownload` 先全部展開 → 等兩幀 → 擷取 → 還原使用者原本的收合狀態。
有一條專屬測試在 mock 的 `generatePdfBlob` 裡檢查「擷取當下那張表在不在 DOM」。

### 驗證

`npm test` **783/783**（新增 4 條）、lint 3 個既有 warning、build 通過。
Playwright 實測深淺兩色 × 桌機/手機：展開箭頭 `matrix(1,0,0,1,0,0)`、
收起 `matrix(0,-1,1,0,0,0)`（-90°）、標題字級與原 h3 同為 14px/600、無橫向溢出。

---

## 📅 Log: 2026-08-04 15:20:00 Asia/Taipei（0.6.22）

- Agent: Claude
- Action: 季度獲利能力歷史回補（0.6.22 定版）
- Status: **完成 —— 兩區已回補完成（各檔 12 季）；779 測試全過**
- Timestamp: 2026-08-04 15:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-04 15:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 季度獲利能力歷史回補 + 併入個股分析（0.6.21）

### 起點：使用者問排程，答案是「排程沒問題，資料源才是問題」

`syncFundamental` 跑在 `stock-report-nightly`（台北週一至週五 16:00–23:45 每 15 分），
但 **`t187ap17_L` 是當季快照** —— 實測只回 58 家、只有民國115 Q2 一季。
所以 `profitQuarters` **一季只長一筆**，要 12 季得等三年。
持股實況印證：1802 / 2609 只有 `2026-Q1`，2303 有 Q1+Q2。

### 回補來源與三個容易搞混的差異

MOPS `POST /mops/web/ajax_t163sb04`。與月營收那支（`t21sc03`）**每一點都不同**：

| | 月營收 t21sc03 | 季報 t163sb04 |
| -- | -- | -- |
| 方法 | 靜態 GET | **POST 表單** |
| 編碼 | **big5** | **UTF-8** |
| 大小 | 約 400 KB | 約 1.6 MB |
| 格式 | 單一表格 | **7 張表、6 種產業別格式** |

因為格式隨產業而異，解析**一律以表頭文字定位欄位，不寫死索引**。

### 正確性怎麼驗的

拿真實的 1.6 MB 頁面餵給 TS 解析器，與官方 `t187ap17_L` 已存的值對答案：

```
1802  官方 毛19.23 營7.88 前6.44 後5.71  營收 10244.19
      算出 毛19.23 營7.88 前6.44 後5.71  營收 10244.19
2303 / 2609 亦全部逐位吻合
```

順帶驗出**單位差異**：MOPS 是千元、`t187ap17_L` 是百萬元，寫檔前要 ÷1000。

**金融業**：沒有「毛利」概念 → 該欄 null。**銀行業沒有單一營收欄**
（是「利息淨收益」＋「利息以外淨損益」兩欄），整張表跳過 ——
硬湊一個分母只會產生無法與其他產業比較的數字。

### Free tier 評估（實測正式區，回答使用者的提問）

| 項目 | 目前 | Free tier | 使用率 |
| -- | -- | -- | -- |
| Storage | 346 KB | 1 GB | 0.03% |
| Database | 18 MB | 500 MB | 3.6% |
| Edge 呼叫 | 約 1,830/月 | 500K/月 | 0.4% |

回補只增加約 3 KB（一季約 180 bytes）。**瓶頸不是容量，是單次執行的記憶體與時間**：
單份 1.6 MB，故 `MAX_BACKFILL_QUARTERS = 2`（月營收是 4），一晚 32 輪綽綽有餘。

### 一個差點再踩一次的坑

新增 `profitBackfilledThrough` 時，**必須在 `buildFundamentalFile` 明確帶過去** ——
那支是整份重建物件，漏帶就是每晚把回補進度抹掉、隔天重走 12 季。
月營收在 0.6.4-dev.2 踩過一模一樣的坑，檔案裡有註解警告，這次照著做了。

另外 `batch_run_log` 加了 `profit_backfilled` 欄位。**這一欄必須先加再部署函式**：
`logBatchRun` 的 insert 失敗不會拋例外（supabase-js 回 error 物件而非 throw），
欄位不存在時整批觀測會靜默停擺。

### 回補實跑（經使用者提供 CRON_SECRET 授權觸發）

| 環境 | 輪數 | 結果 |
| -- | -- | -- |
| 測試區 | 6 輪 | 最後一輪 `filled=0 quarters=[] 714ms` |
| 正式區 | 7 輪 | 最後一輪 `filled=0 quarters=[] 2966ms` |

正式區實測：1802 / 2609 為 2023-Q2→2026-Q1、2303 為 2023-Q3→2026-Q2，各 **12 季**；
0050（ETF）為 0 季且 `profitBackfilledThrough=2023-Q2` —— 證明「找過了就是沒有」
的收斂機制有效，它不會每輪重試。台泥 2025-Q3 營益率 `-0.47`（虧損）也正常帶負號。

### ⚠️ 獨立的「持股獲利能力」區塊最後整個移除

使用者一句「這個是不是在基本面上就有了?」點出重點：**是**。
同樣四項利率在「個股分析 → 基本面」早就有（四張 KPI 卡＋季度表），
差別只是「一檔的細節」vs「多檔的橫向比較」—— 兩者疊在同一頁就是重複。
依指示刪除該元件、其測試與孤兒 CSS，基本面內容一字未動。

**教訓：加新區塊之前先確認同一份資料現在出現在哪裡。**
0.6.20 當初把它放進總經頁時就該問這個問題，而不是等到搬進個股分析、
與基本面分頁面對面了才被使用者看出來。

**但回補本身完全保留，而且那才是真正的價值**：基本面的季度表原本只有 1–2 季，
現在 12 季，那張表與趨勢才成立。

### 驗證

`npm test` **779/779**（回補相關新增 20 條、移除區塊帶走 7 條）、
lint 3 個既有 warning、build 通過。

---

## 📅 Log: 2026-08-04 14:35:00 Asia/Taipei（0.6.20）

- Agent: Claude
- Action: 四項調整（0.6.20 定版）
- Status: **完成 —— 兩區 Edge Function 已重新部署；766 測試全過**
- Timestamp: 2026-08-04 14:35:00 Asia/Taipei

---

## 📅 Log: 2026-08-04 14:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 四項調整（0.6.20）
- **Status**: 完成並上線

### 「最後登入怪怪的」是真的 bug，值得記下來

使用者只說「怪怪的」。查正式區資料庫（唯讀）才看出來：

| 欄位 | 值 |
| ---- | -- |
| `users.last_sign_in_at`（畫面原本顯示這個） | 2026-08-02 09:17 UTC |
| `auth.sessions.refreshed_at`（實際在用的時間） | 2026-08-04 04:53 UTC |

**Supabase 的 `last_sign_in_at` 只在「真的重新登入」時才更新**，
靠 refresh token 續命的帳號會一直停在很舊的時間。

改用 `users.updated_at` —— 它會跟著 session 更新（實測與 `refreshed_at` 差 0.02 秒），
而且 `listUsers()` 本來就回傳，**不必去查 `auth.sessions`**（那張表在 `auth` schema，
PostgREST 讀不到，要查得另外寫一支 SECURITY DEFINER 的 RPC）。

### 另外三項

- **GitHub 官方 mark**：`lucide-react@1.24.0` 已把品牌 icon 全部移除
  （`ls icons/ | grep -c '^github'` → 0），故自己內嵌一段 path。
- **現價 17px/700**：只動這一欄。它是庫存總覽上唯一隨時在動的數字，
  其餘都是成本與換算 —— 整排都放大等於整排都沒重點。
- **總經頁新增「持股獲利能力」**：四項利率的資料早就有了
  （`fundamental/{代號}.json` 的 `profitQuarters`），只是先前只出現在個股基本面、一次一檔。
  這一區橫向排開比較，走勢線重用 0.6.19 的 `sparkline.ts`。
  **只對台股發請求** —— ETF 與美股在公開資訊觀測站的季報裡沒有。

### 一個沒有照使用者原話做的決定

使用者寫的欄位名是「淨利率 / 稅後淨利率」，實作沿用既有的
**「稅前純益率 / 稅後純益率」**。理由：個股基本面那一頁已經是這個名字，
同一個數字在兩個地方叫不同名字，比名稱不夠直覺更容易讓人誤判。要改就兩邊一起改。

### 驗證

`npm test` **766/766**（新增 7 條）、lint 3 個既有 warning、build 通過。
Playwright 實測深淺兩色 × 桌機/手機：現價 `17px/700` vs 隔壁欄 `13.5px/400`、
GitHub mark 為 fill path、新區塊走勢線 56×20 且四欄一致、皆無橫向溢出。

---

## 📅 Log: 2026-08-04 14:05:00 Asia/Taipei（0.6.19）

- Agent: Claude
- Action: 五項功能異動（0.6.19 定版）
- Status: **完成 —— 兩區 schema 與 Edge Function 皆已更新並逐檔稽核通過；0.6.19 已上線**
- Timestamp: 2026-08-04 14:05:00 Asia/Taipei

---

## 📅 Log: 2026-08-04 14:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 五項功能異動（0.6.19-dev.1 ＋ dev.2）
- **Status**: 前端全部完成；需要 Supabase 的兩件事待授權

### 流程：先畫 mockup 再寫程式

使用者提出五項異動並要求「先看畫面再談程式碼」。產出三份完整方案的 HTML 設計稿
（A 就地微調 / B 分組重整 / C 儀表板化），使用者選了 **A ＋ B 的後台**，
另外指定 GitHub 收進帳號選單、版本徽章維持左下角不動。定案稿：
<https://claude.ai/code/artifact/d3392953-faeb-4112-9668-074b2c299558>

先畫再寫是對的：三個版本裡有兩個的總經頁方案（大圖表、三分區）
都需要新增前端邏輯，而使用者要的其實是「原本的卡片再多一點資訊」。
直接寫程式的話會做出一個他不要的東西。

### dev.1（純前端，不碰 Supabase）

| 項目 | 做法 |
| ---- | ---- |
| 分頁分組 | `ALL_TABS` 加 `group` 欄位，`TabNav` 在換組時插一道 `.tab-div`。不加組標題 —— 頁首水平空間最稀缺 |
| 抓取狀況移出分頁列 | 新增 `AdminConsolePage`（全頁＋左側導覽），由帳號選單進入。分頁從 7 個降為 6 個 |
| AI 設定搬家 | 從 `AiTab` 抽成 `Admin/AiConnectionSection`。**搬的理由是權限不是版面** —— 那份表單只有管理員能用，卻長在所有人每天都會開的分頁裡 |
| 總經走勢線 | 新增 `Macro/sparkline.ts`（純函式，7 個測試）。**沒有用 `LineSeriesChart`**：那支帶座標軸與 tooltip、預設高 170px，放進 KPI 卡會比卡片本身還高 |
| GitHub | 從頁尾移進帳號選單 |

順手把 `judgePeriod` / `latestPeriod` / `periodsBehind` 從 `Admin/timeline.ts`
移到 `Macro/macroPeriod.ts`：那是總經資料的領域邏輯，Admin 只是借來監看，
留在 Admin 會讓總經頁反過來依賴管理員後台。

### dev.2（需要 Supabase）

**提示詞線上編輯**。最重要的設計決定是**可編輯／鎖定的切線**：

- 可編輯：風格（幾段、口吻、要不要用操作框架的語彙）→ 存進 `app_settings`
- 鎖定：不得給買賣指令與目標價、結尾免責聲明、攤平風險提示、
  追問的框限與防指令覆寫 → 固定在 `ANALYSIS_LOCKED` / `CHAT_LOCKED`

**順序有意義**：鎖定段落接在使用者輸入**之後**，後面的規則才蓋得住被改壞的前半段。
測試直接驗這件事：把可編輯段落整段換成「請直接告訴使用者現在該買還是該賣」，
安全規則仍然在。畫面上也照實印出鎖定段落 —— 不然管理員只能對著模型的回覆猜哪一條在擋。

**NULL 代表「用預設值」**，預設值刻意不寫進資料庫：寫進去之後日後改預設值，
已套用的環境不會跟著更新，兩區就會各跑各的提示詞而且看不出來。

**帳號管理**。`auth.users` 不在 PostgREST 的 exposed schemas 裡、專案也沒有 profiles 表，
所以只能走 Edge Function 以 service role 讀（新增 `admin-users` / `admin-set-role`）。
三個實作細節：

1. 寫的是 `app_metadata.role` 不是 `user_metadata` —— 後者使用者自己改得動。
2. `app_metadata` 用併的不是整包覆寫，那裡面還有 provider 等 Supabase 自己的欄位。
3. **不允許取消自己的管理員權限**：全站可能只剩你一個，收回之後連後台都進不去。
4. 開關採「成功才改畫面」而不是樂觀更新 —— 權限是敏感操作，失敗看起來像成功最糟。

### 對外操作（2026-08-04，經授權執行）

依 §13.1 先測試區、確認後才動正式區。**寫入型 `db query` 一律把身分檢查放進同一次查詢**
（從 `cron.job.command` 抽 project ref），避免 skill 記載的 cwd 陷阱：

```sql
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ai_prompt_analysis TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ai_prompt_chat     TEXT;
SELECT (SELECT (regexp_match(command, 'https://([a-z]+)\.supabase\.co'))[1] FROM cron.job LIMIT 1) AS 身分檢查, ...;
```

- **測試區**：欄位已加（身分檢查回 `wqetxuhncvfidqnklyew`）、
  `functions deploy stock-report --no-verify-jwt` 完成、
  `functions download` 逐檔比對 **11 個檔全部與 `dev` 相同**。
- **端點探測**（不需登入即可驗證新程式碼有沒有上線）：
  `admin-users` / `admin-set-role` 回 401（被 `assertAdmin` 擋下），
  不存在的 action 回 400 `Unknown action` —— 兩者不同即證明新 action 已被辨識。
- **正式區**：先把 0.6.19 定版併入 `main` 並 push（§13.2：正式區只在 `main` 上動；
  Pages 部署 run 30880978398 success），才執行同一組操作 ——
  欄位已加（身分檢查回 `kxnxadaghidwumqsqneu`）、
  `functions deploy stock-report --no-verify-jwt` 完成、
  `functions download` 逐檔比對 **11 個檔全部與 `main` 相同**、端點探測結果與測試區一致。

### ⚠️ 尚未做到的驗證

後台的「帳號」與「提示詞」**沒有以真正的管理員帳號實際操作過** ——
Agent 拿不到登入憑證，只驗到「端點存在且正確擋下未授權請求」。
第一次用的時候請留意：帳號清單讀不讀得出來、提示詞存檔會不會成功。

### 驗證

`npm test` **759/759**（dev.1 +5、dev.2 +18）、`npm run lint` 恰 3 個既有 warning、
`npm run build` 通過。

**盲區**：`index.ts` 的兩個新 handler 不在 `tsc -b` 範圍內也沒有單元測試（本機無 deno），
已人工核對 supabase-js 的 `auth.admin` 回傳形狀，但實際行為要部署到測試區才驗得了。

---

## 📅 Log: 2026-08-04 12:15:00 Asia/Taipei

- **Agent**: Claude（三個 code-simplifier 子代理分批）
- **Action**: 程式碼簡化（0.6.18-dev.1）
- **Status**: 完成並驗證；未 push

### 做法：分三批、批次間避開共用檔

範圍是 0.6.14–0.6.17 動過的檔案加上 `stock-report/index.ts`。
批次 A（前端 Admin）與批次 B（`macroCalendar.ts`）檔案不重疊故並行；
批次 C（`index.ts`）等 B 定案後才開始 —— `index.ts` import `macroCalendar`，
同時改會衝突。每批完成都跑過完整的 test / lint / build。

### 改了什麼（行為不變）

| 檔案 | 改動 | 為什麼 |
| ---- | ---- | ---- |
| `AdminStatusPage.tsx` | 抽檔內 `DayRow` 元件、`DAY_GRID` / `SECTION_PAD` 常數 | 班次軸三列的骨架＋格線＋「現在」線原本各寫一份，漏改一份就會看成資料對不齊軸 |
| 同上 | `macroRows` useMemo | `judgePeriod` 原本在結論計數／下一筆發布／表格三處各算一次，可能三份判定漂移 |
| `timeline.ts` | 新增純函式 `taipeiParts()`（+4 測試） | 頁面裡兩處手寫 `+8h` 換算，時區運算屬於已有測試的純函式層 |
| `macroCalendar.ts` | 私有 `pad2` / `shiftPeriod` | 「年×12 + 月序 ± k」算式原本出現三次，`nextReleaseFor` 更把只差 1 的兩個值分開算兩遍 |
| `index.ts` | 刪 `taipeiDateOf()`，四處改用早已 import 的 `taipeiYmdOf()` | 同一功能的第二份實作；這是唯一不必新增 import edge 的收斂路徑 |
| `index.ts` | `handleAdminStatus` 註解修正 | 原註解寫「全部 allSettled」，實際是 `Promise.all` + 逐項 `.catch()`，**只改註解不改行為** |

### ⚠️ 一處刻意接受的行為差異

`taipeiDateOf(existing.asOf)` 在 `asOf` 無法解析時會 `new Date(NaN).toISOString()` 拋
RangeError —— `syncNews` 被自身 try/catch 吃掉會**永久跳過該檔**、`syncFx` 沒有 try/catch
則整段失敗。改用 `taipeiYmdOf` 後回 `'NaN-NaN-NaN'`，比對不符 → 重抓一次。
該路徑需要檔案內容壞掉才會到達（`asOf` 只由本檔以 `new Date().toISOString()` 寫入，
壞到 JSON 解析不了時 `downloadJson` 早就回 null），且新行為是自我修復。

### ⚠️ 驗證的盲區（下個 Agent 請注意）

`sources/tsconfig.app.json` 的 `include` 只有 `["src"]`，本機也沒有安裝 deno →
**`supabase/functions/` 完全不在 `tsc -b` 的檢查範圍內**，`npm run build` 通過
不代表 `index.ts` 型別正確；`index.ts` 又因模組載入即 `Deno.serve` 而沒有單元測試。
該檔唯一的自動防護是 oxlint。本次因此刻意只做機械式等價改動，並人工核對每個呼叫點。

### 驗證結果

- `npm test` **721/721**（48 檔；較基準 +4，為 `taipeiParts` 的新測試）
- `npm run lint` **恰 3 個 warning**（SortableTh / AuthContext / WorkspaceContext，皆既有）
- `npm run build` 通過

### 刻意沒做的事（理由留檔，免得下個 Agent 重想一遍）

- **`+8h` 收斂成跨檔共用 helper**（`report.ts` / `twRevenueHistory.ts` / `macroCalendar.ts`）：
  實際算過是淨 +7 行，且 `macroCalendar.ts` 目前是**零 import 的純模組**
  （檔頭註解說明它獨立出來就是為了測得到），為一行算術替它接上依賴是拿耦合換不存在的收益。
- **三支 `handleSyncX` 抽共用 wrapper**：三者回應欄位各不相同，抽出來會變成帶一堆
  可選欄位的假抽象，比現在難讀。
- **`handleGenerateAll` 流程、`logBatchRun` 欄位名、`json()` 鍵名**：分別對應踩過坑的
  執行順序、`batch_run_log` 的 DB 欄位、前端依賴的 API 契約，全列為禁區。
- **`usMacro.ts` 的 `fredSinceDate`**：算 UTC 月份、輸出 `'YYYY-MM-01'`，與期別語意不同，
  屬表面相似而非真重複。
- **`adminStatus.ts`**：逐欄位 normalize 是刻意的防禦，抽 helper 只會是單次使用的抽象。

---

## 📅 Log: 2026-07-31 17:55:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 總經改為發布行事曆驅動的自適應掃描（0.6.15）
- **Status**: 程式完成、測試區已驗證；**cron 改密尚未執行**（需授權）

### 需求與前提修正

使用者要求：查官方公告時間，「如果是一個區間就把 scan 拉長，一旦抓到就不抓」。
查證後**前提要修正**：官方給的不是區間，是**提前公告的確定日期**。
真正的不確定區間是「官方發布 → FRED 匯入可用」的延遲
（實證：7/30 PCE 官方台北 20:30 發布，我們 21:00 那班就是抓不到）。

### 官方發布行事曆（查證所得，重查成本高）

發布時刻：BLS（CPI / PPI / 非農）與 BEA（PCE）皆**美東 8:30**；
密大（UMCSENT）為**美東 10:00**（與其他四項不同）。
台北換算：8:30 ET = 夏令 20:30 / 冬令 21:30；10:00 ET = 夏令 22:00 / 冬令 23:00。

| 指標 | 2026 已公告日期（括號為資料期別） |
| ---- | ---- |
| CPILFESL | 07-14(06) 08-12(07) 09-11(08) 10-14(09) 11-10(10) 12-10(11) |
| PPIFES | 07-15(06) 08-13(07) 09-10(08) 10-15(09) |
| PAYEMS | 08-07(07) 09-04(08) 10-02(09)（皆週五） |
| PCEPILFE | 07-30(06) 08-26(07) 09-30(08) 10-29(09) 11-25(10) 12-23(11) |
| UMCSENT | 密大當月最後一個週五發終值，次月 1 日進 FRED |

已寫進 `macroCalendar.ts` 的 `RELEASE_CALENDAR`。
**以 ALFRED vintage 反查的實際發布日與官方表完全吻合**
（反查腳本 `sources/scripts/find-release-dates.py`，vintage 單調故可二分搜尋）。

### ⚠️ 環境限制與維護須知

- **BLS 的 schedule 頁一律 403**（`bls.gov/schedule/news_release/*.htm`，換 UA 無效），
  **無法自動同步行事曆** → 只能人工維護。BEA 的頁面則可正常抓取。
- OMB 的 `statspolicy.gov` 有全指標年度行事曆 PDF，但內容是圖層、抽不出文字。
- **每年 12 月要手動更新次年日期**（已在 TASK.md 留條目）。
  行事曆用完會自動 fallback 到規則推算並標記 `stale`，忘記更新不會整組失效。

### 實作

- 新增 `macroCalendar.ts`（純模組，21 個測試）：`RELEASE_CALENDAR`、
  `expectedLatestPeriod`（依**發布時刻**而非發布日判斷）、`decideMacroScan`
  （沿用 `pollPlan.decideSkip` 的形狀）、`isEasternDst`（美東日光節約換算）。
- `syncMacro` 前面加掃描決策，新增 `reason: 'skipped'`。
  **指紋比對與「全滅不覆寫」完全沒動** —— 那是 BUG-008 的修正。
- `MacroFile` 加 `scansToday: { ymd, n }`（台北日 + 次數，跨日歸零）。不升 schema。

決策順序（有意義）：次數上限 → 今天沒掃過就掃（**跟上 FRED 回頭修正歷史值**，
BUG-008 那次 vintage 就同時改了兩期）→ 發布窗內且未取得就掃 → 其餘不掃。

**UMCSENT 不納入密集掃**（使用者裁示）：它在 FRED 上已停更，
07-01 / 07-15 / 07-31 三個 vintage 全停在 2026-05，納入只會每個發布日白掃到上限。
仍由每日例行那一班跟進，來源恢復就會自動拿到。
⚠️ 若後續變成落後 2 期以上，該考慮換來源或移除。

### ✅ 測試區驗證（2026-07-31 17:50）

連打三次 `sync-macro`：

| | reason | durationMs | scan.reason |
| ---- | ---- | ---- | ---- |
| 第 1 次 | `unchanged` | 3186 | `routine`（今天首次） |
| 第 2 次 | **`skipped`** | **135** | `satisfied` |
| 第 3 次 | **`skipped`** | **75** | `satisfied` |

**3186ms → 75ms 證明完全沒打 FRED**，這正是「一旦抓到就不抓」。
`npm test` 719/719（新增 21）、build 通過。

### ✅ 正式區部署與覆驗（2026-07-31 18:00）

0.6.15 已 ff-merge 進 `main`、Pages 部署成功；兩區 Edge Function 皆已部署。
正式區連打三次：`unchanged`(2883ms) / `skipped`(403ms) / `skipped`(171ms)，
與測試區行為一致。

### ✅ cron 改密已執行（2026-07-31 18:35，使用者授權後）

兩區皆由 `0 13,15 * * *` 改為 **`*/30 12-18 * * *`**（台北 20:00–02:30 每 30 分，14 班）。

作法（照 `supabase-ops` skill）：
- 用 **`cron.alter_job`**，不重跑 `cron.schedule` —— 重跑會把 command 打回佔位符（BUG-002/003）。
- **身分檢查與異動放在同一個 `DO $$` 區塊**：先確認 `macro-daily` 的目標 ref 是本區，
  不是就 `RAISE EXCEPTION` 中止。分兩次查擋不住 cwd 在中間被改掉的情形。

覆驗：兩區的 `schedule` 皆為新值、目標 ref 各自正確、**command 未含未替換的佔位符**、
長度 410 未被清空；其餘三個排程（`fx-daily` / `source-probe` / `stock-report-nightly`）
未被動到。

**班次變多不等於請求變多**：改後立即觸發，測試區 `skipped` 652ms、正式區 `skipped` 1050ms，
仍走 `satisfied` 分支、零 FRED 請求。

### ⏳ 待辦

1. **前端 `timeline.ts` 的 `RELEASE_RULE` 尚未改用行事曆**，仍是區間推估。
   顯示的區間包含確定日期（08-10~14 含 08-12），不算錯但不夠精準。
3. **真實迴歸要等 8/7**（非農 2026-07 期發布日）：當天台北 20:30 起應看到
   密集掃描啟動、抓到後停止。

---

## 📅 Log: 2026-07-31 15:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 排程說明抓取範圍；發布日推估改為實測歸納的區間（0.6.14）
- **Status**: COMPLETED（前端變更，後端未動）

### 使用者的兩個問題

**1.「CPI / PPI / PCE / UMCSENT 的下期預計是怎麼估的？」**

老實說：0.6.13 那版是**我依「一般慣例」寫死的**，沒有任何根據。
既然 ALFRED 的 vintage 是單調的（某期首次出現的那天就是發布日），
就能二分搜尋反查**實際發布日**。實測近三期：

| 指標 | 2026-04 期 | 2026-05 期 | 2026-06 期 | 原本寫的 |
| ---- | ---- | ---- | ---- | ---- |
| CPILFESL | 05-12 | 06-10 | 07-14 | 12 日 |
| PPIFES | 05-13 | 06-11 | 07-15 | 14 日 |
| PCEPILFE | 05-28 | 06-25 | 07-30 | 28 日 |
| PAYEMS | 05-08(五) | 06-05(五) | **07-02(四)** | **第一個週五** |
| UMCSENT | 04-01 | 05-01 | 06-01 | **14 日** |

兩個原本的規則是**錯的**：`PAYEMS` 的「第一個週五」對 2026-07 不成立（7/2 是週四）；
`UMCSENT` 實際是次月 1 日發布，不是 14 日。其餘三個雖落在範圍內，
但實際日期每月都在跳（CPI 橫跨 10–14 日），**給單一日期等於假裝精確**。

故改為區間（`ReleaseWindow`），畫面顯示 `08-10 ~ 14` 並標「依實測歸納的區間」。
反查腳本 `find_release.py` 留在 scratchpad，日後要重新校準可再跑一次。

**順帶查出 UMCSENT 的真實狀況**：它依規律 2026-06 該在 07-01 發布，
但 07-01 / 07-15 / 07-31 三個 vintage 全都停在 2026-05 —— **確實落後一期**
（不是「還沒到發布時間」）。新增 `periodsBehind()`，畫面改顯示「落後 N 期」，
因為「落後 1 期」與「落後 3 期」意思完全不同（後者代表來源可能停更）。

**2.「排程沒說明抓取範圍」**

新增 `ACTION_SCOPE` 對照表，排程名稱下方直接寫明範圍。
⚠️ 它對照的是 `index.ts` 各 handler 的實際行為，**改動抓取範圍時這裡要跟著改**。

### 一個刻意保留的「新聞」字樣

`stock-report-nightly` 的範圍說明仍含「+ 新聞」——**那是後端事實**
（`generate-all` 確實還是會抓 `news/*.json`，個股分析頁也還在用）。
0.6.13 移除的是「抓取狀況頁不再追蹤新聞狀態」，不是把新聞功能拿掉。
若要連這行字也拿掉，說明就會與後端行為不符，故保留待使用者裁示。

### 驗證
`npm test` 698/698（新增 7）、build 通過、lint 僅 3 個既有 warning、
四種寬度深淺兩色掃描全過。

---

## 📅 Log: 2026-07-31 14:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 總經改用「今日班次」時間軸（M1）、移除新聞追蹤（0.6.13）
- **Status**: COMPLETED（前端變更，後端未動）

### 使用者的三個問題

1. **「台股盤後・2026-07-30」什麼時候變 07-31？** 查 `batch_run_log` 實證：
   7/29 那天 16:00 與 16:15 兩輪的 `data_ymd` 都還是前一天，**16:30 那輪才翻**
   （`t86_today` 轉 true 並重產 5 份報告）。所以標題會在當天 16:30 前後更新。
   這也回頭印證 `TW_CHAIN.institutional.dueBy = 1.5`（＝16:30）設得對。
2. **新聞全部移除** —— `TW_CHAIN` 拿掉 news、頁面拿掉新聞 KPI 卡與相關分支。
   新聞的抓取功能本身沒動（`news/*.json` 照產），只是這個後台不再追蹤它。
3. **總經要和台股盤後一樣的圖表 + 下次抓取時間** → 比稿 M1 / M2 / M3 後選定 M1。

### M1：總經當日班次軸

一天 24 小時的軸，四列：美東發布窗（夏令 20:30 / 冬令 21:30）、第一班、第二班、
資料最後變動，另有一條「現在」參考線。**順帶把 BUG-008 的成因畫了出來** ——
21:00 那班在冬令會落在發布之前。

新增純函式（皆有測試）：`cronHoursTaipei`（cron → 台北班次時刻）、`nextRun`（下一班、
跨日回明天）、`dayPercent` / `hourLabel` / `durationLabel`、`estimateNextRelease`。

**「下次抓取」與「下期發布」刻意分開陳述**，因為可靠度不同：
前者由 cron 表達式算出、100% 確定；後者依各機關慣例推估（非農次月第一個週五、
CPI 月中、PPI 月中、PCE 月底），FRED 沒有發布日 API。畫面標「推估」，
**排程完全不依賴它** —— 仍是每天兩班、比對內容指紋。
落後中的指標（消費者信心）下期預計顯示「待定」：它連上一期都還沒發，推估沒有意義。

### Playwright 掃描抓到的問題

- **尚未執行的班次原本用 `border: 2px dashed` 畫 13px 圓圈**，只畫得出三四段虛線，
  看起來像個怪符號。改實線空心圈。
- **圖例文字仍被擠成直排** —— 上一輪「已修正」的其實沒生效：
  `.ast-legend span`（特異性 0,1,1）壓過了 `.ast-rule`（0,1,0），
  `display: block` 根本沒套用。改成 `.ast-legend .ast-rule` 才真的修好。
  **這個坑踩了兩次**，故在掃描腳本新增「圖例說明不得是 flex / 高度不得超過行高 8 倍」
  的檢查，並以「把修正還原→掃描應報錯」實測過它抓得到（三種寬度都報）。

### 驗證
`npm test` 691/691（新增 20）、build 通過、lint 僅 3 個既有 warning、
四種寬度深淺兩色掃描全過。

### ✅ 正式區上線覆驗（2026-07-31 14:55）

0.6.13 已在 `main`，GitHub Pages 部署成功（33 秒）。**本次無後端變更**
（`git diff 846ffaa..f0d9fa3 -- sources/supabase/` 為空），故未重新部署 Edge Function；
仍以 `functions download` 確認正式區 10 檔與 `main` 一致。

1. **線上 bundle 內容檢查**：抓 GitHub Pages 的 `index-*.js`，確認含
   `0.6.13` / `今日班次` / `美東發布` / `下次抓取` / `推估`，且
   **`個股新聞` 與 `新聞檔` 皆已不存在**。
2. **以正式區資料實地渲染**：`.env.local` 暫時指向正式區 + 正式區 admin session，
   跑四種寬度掃描 → 全過。畫面確認：工作區「玉山證卷」、排程目標 ref 為
   `kxnxadaghidwumqsqneu`（自己）、兩班顯示「待執行」、下次抓取「今日 21:00（6h 8m 後）」、
   借券次日 09:11 標延遲、後端彙總 910ms。
3. 驗畢已把 `.env.local` **還原為測試區**。

⚠️ 覆驗過程需要暫時把 `.env.local` 指向正式區，事後務必還原 ——
否則之後的本機開發會直接對著正式區資料。

## 📅 Log: 2026-07-31 13:55:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 新增管理員專用的「資料抓取狀況」頁（含排程資訊）
- **Status**: CODE COMPLETE（測試區已部署；正式區尚未動）

### 起因

使用者要一個只有 admin 看得到的後台，追蹤所有資料的抓取狀況
（點名三大法人、融資融券），並要求「PCE 等資料用列表呈現，不用每次都請 Agent 查」。
設計比稿四輪（A 狀態燈板 / B 稽核總表 / C 時間軸，再出 A1–A3、C1–C2），
最後定案 **C 單日時間軸**，比稿檔留在 `docs/architecture/admin_status_*.html`。

### 架構

```
前端 AdminStatusPage ──functions.invoke（帶使用者 JWT）
  └→ stock-report {action:'admin-status'}
       ├ assertAdmin()  驗 JWT + app_metadata.role === 'admin'
       ├ rpc admin_schedule_status()   cron.job + job_run_details
       ├ storage: manifest / macro / fx / 各目錄檔案數
       └ table:   batch_run_log（readLastRun）、source_probe_log
```

### Completed Tasks
- [x] `schema.sql` §11：`admin_schedule_status()`（SECURITY DEFINER，只 GRANT service_role）。
- [x] `index.ts`：`assertAdmin()` + `handleAdminStatus()` + `latestChipSources()` + `storageCoverage()`。
- [x] `src/services/adminStatus.ts`：proxy 與通用 `isAdmin()`。
- [x] `src/components/Admin/timeline.ts`：判定與座標純函式（29 測試）。
- [x] `src/components/Admin/AdminStatusPage.tsx`：時間軸 / 排程 / 總經 / 涵蓋四段（10 測試）。
- [x] `AppShell.tsx`：`ADMIN_ONLY_TABS`，分頁清單改為元件內計算（admin 是非同步取得的，
      不能在模組層固定）；權限被收回時自動退回總覽。
- [x] `index.css`：`ast-` 前綴樣式段（狀態色用 `--notice-*-ink`，**刻意不用 `--up/--down`** ——
      台股 `--up` 是紅色代表漲，拿它當異常會與盤面語意打架）。
- [x] 驗證：`npm test` 671/671（新增 39）、build 通過、lint 僅 3 個既有 warning。

### 關鍵決定

1. **判定基準是批次班次，不是來源公布時刻。** 詳見 SPEC。這是設計階段就踩到的坑：
   法人 16:15 到手若用公布時刻判會變成「晚 45 分」，但批次本來就 16:00 起跑。
2. **走 Edge Function 而不是鬆綁 RLS。** `batch_run_log` / `source_probe_log` 的
   「有 RLS 但無 policy」是刻意設計，不該為了唯讀後台去開洞。
3. **`cron.job.command` 不可外流** —— 裡面有 CRON_SECRET 明文。
   SQL function 只挑五個不敏感欄位，已實測回應中不含任何密鑰。
4. **目標 ref 要顯示出來。** BUG-003 就是測試區的 cron 打到正式區，
   把它放進畫面，那種事下次一眼看得到。
5. **Edge Function 端原本也寫了一份判定模組，發現前端已涵蓋後刪除** ——
   兩份判準只會漂移。判定統一在 `timeline.ts`。

### ✅ 測試區授權矩陣實測（2026-07-31 13:50）

| 呼叫者 | 結果 |
| ---- | ---- |
| admin 帳號 JWT | **200**（0.9s，排程 4 筆、涵蓋率、總經 5 指標全到齊） |
| 一般使用者 JWT | **403** |
| 無 token / 亂編 token | **401** |
| **CRON_SECRET** | **401**（刻意：那把密鑰不能開後台） |
| anon 直呼 RPC | **401** |
| admin 直呼 RPC | **403**（只有 service_role 能執行） |
| admin 直讀 `batch_run_log` / `source_probe_log` | 200 但**回空陣列**（RLS 無 policy） |

回應內容已實測不含 `x-cron-secret`、service_role key 或任何密鑰。

### ✅ 正式區部署與覆驗（2026-07-31 13:55）

0.6.12 已 ff-merge 進 `main` 並 push（GitHub Pages 部署成功，33 秒）。

1. **link 正式區時帶身分檢查**（`supabase-ops` skill 的對策）：
   查詢同時撈 `cron.job` 的目標 ref，確認為 `kxnxadaghidwumqsqneu`（自己）才繼續 ——
   BUG-002/003 就是在這一步出的事。
2. **`schema.sql` §11 只跑那一段**（未整份重跑）。權限實測：
   `service_role` 可執行、`authenticated` 與 `anon` 皆不可。
3. `functions deploy --no-verify-jwt` 後 `functions download` 逐檔比對，
   10 個 `.ts` 全部與 `main` 一致。

**正式區授權矩陣**（與測試區完全一致）：

| 呼叫者 | 結果 |
| ---- | ---- |
| admin 帳號 JWT | **200**（557ms） |
| 一般使用者 JWT | **403** |
| 無 token | **401** |
| CRON_SECRET | **401** |
| anon / admin 直呼 RPC | **401 / 403** |

**帳號現況**：`zrchen0425@gmail.com` 在兩區皆已是 `app_metadata.role = 'admin'`
（先前為 AI 設定設好的，本次未異動任何帳號）。正式區另兩個帳號 `role` 為 null。

正式區實際資料：排程 4 個（目標 ref 全部指向自己）、籌碼三源時間戳齊全
（法人 07-30 16:15、融資融券 07-30 21:00、借券 07-31 09:10 ← 次日補抓）、
總經 4 項到 2026-06 / 消費者信心 2026-05、匯率 8 幣別。回應實測不含任何密鑰。

### ✅ Playwright 版面掃描（2026-07-31 14:10，使用者要求後安裝）

`npm i -D playwright` + `npx playwright install chromium`；WSL2 還需
`sudo playwright install-deps chromium`（缺 `libglib-2.0.so.0` 會直接 exit 127）。
腳本收進 **`sources/scripts/verify-admin-status.cjs`**，掃 1440 / 1024 / 768 / 390px。

驗的是 jsdom 碰不到的東西：橫向溢出、絕對定位是否落在軌道內、時刻標籤是否溢出所屬列、
手機上該隱藏的有沒有隱藏、console 錯誤。

**登入方式**：Agent 沒有帳號密碼，改以 Admin API 產生 magic link → 換 access_token →
注入 `localStorage` 的 `sb-<ref>-auth-token`（supabase-js v2 的 session 位置），與真登入等價。

#### 掃描抓到四個真問題（都已修）

1. **手機看不出誰延遲了**。時間軸需要約 700px，390px 只能橫捲，而預設停在左端 ——
   借券與新聞的「次日 09:10」落在右半，等於白畫。
   改為手機隱藏軌道，由標籤列直接列出狀態與時刻（`.ast-when`），資訊不減。
2. **手機上狀態欄整個消失**（`.ast-end` 被三欄 grid 擠掉）。改為兩欄並讓狀態靠右。
3. **圖例「判定基準是」被擠成一字一行的直排**。`.ast-legend span` 是 `inline-flex`，
   `.ast-rule` 繼承後把文字節點與 `<b>` 各自變成 flex item。補 `display: block`。
4. **個股新聞畫了一個永遠抓不到東西的公布窗**。它其實沒有公布窗的概念
   （隨時可能有，批次每輪都會試著抓）。`ChainSpec.window` 改為可 null，新聞設 null。

另外修掉一個**尚未觸發**的字串 bug：探針列數的括號原本拆成兩個條件式，
只有其中一項有值時會印出沒有右括號的「（估值 1081 列」。改為整段一起組（`probeRows()`）。

### ⏳ 待辦
2. `sources/.env.local` 已建立並指向**測試區**（gitignored）。
   要改回本機模式把兩行註解掉即可；要看正式區資料則換成正式區的 URL 與 anon key。
3. `supabase link` 目前停在**正式區**（全域副作用）。下次要對測試區下 `db query --linked`
   前務必重新 link，並照 skill 的做法把身分檢查放進同一次查詢。

---

## 📅 Log: 2026-07-31 12:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修 BUG-008 —— 總經的日期冪等把「當天的重試班次」整個消音
- **Status**: CODE COMPLETE（尚未部署任何環境）

### 起因

使用者原本問的是「總體經濟目前怎麼抓的？可以改成每月或每季抓嗎？」，
追問時補了一句「可是像 PCE 已經有更新了，卻沒抓到？」——
**真正的問題不是頻率，是抓了卻拿到舊資料。**

### 根因（完整證據鏈見 `FIXED_BUG.md` BUG-008）

`syncMacro()` 的冪等鍵是台北日曆日：`taipeiDateOf(existing.asOf) === today` 就直接 return。
而 `macro-daily` 排兩班（13:00 / 15:00 UTC）的用意是「第一班沒接到就讓第二班補」——
第一班「**成功**抓到一份還沒更新的資料」時會寫入 `asOf` = 今天，
第二班一看同一台北日就跳過、**一個請求都不發**。重試班次形同虛設。

BEA 美東 8:30 發布 ＝ 夏令 12:30 UTC，FRED 匯入更晚，13:00 那班接不到；
**冬令發布是 13:30 UTC，13:00 那班甚至跑在發布之前** —— 冬令每個月都固定慢一天。
`schema.sql` §9 的原註解寫「兩班分別落在夏令與冬令之後」，設計意圖是對的，
只是沒察覺自己的冪等會讓第二班永遠不執行。

決定性證據是 ALFRED 的 vintage 比對：`vintage_date=2026-07-30` 已有 2026-06 的 PCE，
且同時把 2026-05 由 130.082 修正為 130.094 —— 而線上檔的 yoy 3.41% 正好對應
**修正後**的值，證明 13:00 那班抓到的是當天已更新的序列，只是 2026-06 還沒進去。

### Completed Tasks
- [x] `usMacro.ts`：新增 `macroFingerprint(indicators)`（重用 `pollPlan.ts` 的 `fingerprint`），
      `MacroFile` 新增 `checkedAt`。**不升 `MACRO_SCHEMA`**（前端 `>=` 守門，加欄位無害）。
- [x] `index.ts`：`syncMacro` 改為先抓、後比指紋、變了才寫；回傳值新增
      `reason: 'updated' | 'unchanged' | 'empty'`（原本單一 boolean 分不出「沒變」與「抓不到」）。
- [x] `index.ts`：`syncFx` 的註解修正 —— 它原本寫「與 syncMacro 逐條對應（台北日冪等…）」，
      已不成立；並記錄**匯率刻意不跟進**的理由。
- [x] `schema.sql` §9 / §10：**只改註解，零可執行 SQL 變動**（`git diff` 已確認）。
- [x] 前端：`macroProxy.ts` 加 `checkedAt` 正規化；`MacroPage.tsx` 在兩者不同日時
      補顯示「（最後檢查 …）」—— 否則 `asOf` 一個月才跳一次，看起來像壞了。
- [x] 測試：`usMacro.test.ts` +7（含「歷史值被修正也算變動」「null 與 0 不同」），
      `MacroPage.test.tsx` +3（同日不印、不同日補印、舊檔無欄位）。
- [x] `sources/supabase/README.md`：修掉「觸發＝`generate-all` 內獨立一行」的失準敘述
      （那是 0.6.5-dev.1 的舊事實，dev.2 已拆成獨立 cron），並補上兩個時間欄位的語意差別。
- [x] 版號 0.6.11-dev.1 三處同步。
- [x] 驗證：`npm run lint`（僅 3 個既有 warning）、`npm run build` 通過，`npm test` 632/632。

### 關鍵設計決定

1. **指紋涵蓋整段 points，不只比最新一期。** FRED 會回頭修正歷史值
   （本次 vintage 就同時改了 2026-04 與 2026-05，最新期別沒變）。
   只比 `latest` 的話，這類修正會被判定為「沒變動」而永遠追不上。
2. **`asOf` 與 `checkedAt` 分離。** 前者是資料最後變動時間（月度資料一個月才跳一次，
   屬正常）、後者是最後一次問過 FRED 的時間。合而為一正是慢一天的成因：
   「今天問過了」與「今天有新資料」分不開。查健康度看 `checkedAt`，查新舊看 `asOf`。
3. **`syncFx` 刻意不跟進。** 匯率每個交易日都收出新價，03:00 那班（紐約收盤後）
   拿到的必然已是完整的前一交易日日線，第二班補不到東西；
   對每天都變的資料，內容指紋只會每次都判定「變了」，徒增一次無謂抓取。
4. **沒有改排程頻率。** 使用者原本設想的「每月/每季抓一次」會讓問題更嚴重：
   五個指標發布日各不相同（非農每月第一個週五、CPI 月中、PCE 月底），
   一個月跑一次只能對準其中一個；且降頻後單次失敗的代價從「明天補上」變成「停一個月」。
   維持每天兩班，代價只是每天多五個 CSV 請求。

### ✅ 測試區線上覆驗（2026-07-31 12:37，使用者授權後執行）

部署：`functions deploy stock-report --project-ref wqetxuhncvfidqnklyew --no-verify-jwt`。
**沒有跑任何 SQL** —— schema.sql 這次只動註解，排程完全沒碰。

稽核：`functions download` 後逐檔 `diff`，10 個 `.ts` 全部與 `dev` 工作區一致。

核心迴歸（連打兩次 `sync-macro`）：

| | reason | asOf | durationMs |
| ---- | ---- | ---- | ---- |
| 第 1 次 | `updated` | `2026-07-31T04:37:19.466Z` | 3892 |
| 第 2 次 | `unchanged` | **完全不變** | 1020 |

第二次仍花了 1 秒 ⇒ **有真的去問 FRED，不是日期短路**，而指紋判定沒變 ——
這正是修正的目標行為，也代表指紋穩定、沒有踩到 BUG-004 的排序陷阱。

資料覆驗：`PCEPILFE.latest` 由 `2026-05 (3.41%)` 補上 **`2026-06 (3.29%)`**。
`checkedAt` 比 `asOf` 晚 4 秒（第二次呼叫只更新檢查時間、不動資料時間），語意分離成立。
`UMCSENT` 仍停在 2026-05 —— FRED 上就只有到 2026-05，非缺陷。

### ✅ 正式區線上覆驗（2026-07-31 12:41）

0.6.11 已 ff-merge 進 `main` 並 push（GitHub Pages 部署成功，37 秒）。
`functions deploy stock-report --project-ref kxnxadaghidwumqsqneu --no-verify-jwt` 後，
`functions download` 逐檔比對 10 個 `.ts` 全部與 `main` 一致。

| | reason | asOf | durationMs |
| ---- | ---- | ---- | ---- |
| 第 1 次 | `updated` | `2026-07-31T04:40:44.188Z` | 2103 |
| 第 2 次 | `unchanged` | **完全不變** | 910 |

`macro/us.json` 五項指標的走勢區間全部往前推一期：
`PCEPILFE` 由 `2025-06..2026-05` 變成 `2025-07..2026-06`（latest = 2026-06、3.29%），
CPI / PPI / 非農同為 2026-06，`UMCSENT` 仍是 2026-05（FRED 上就只有到 2026-05，非缺陷）。

兩區覆驗結果一致，且 `dev` 與 `main` 都停在 `279b669`（§13.1 要求的分支同步已成立）。

### ⏳ 待辦（下一位 Agent 從這裡接手）

1. **明天（2026-08-01）21:00 / 23:00 那兩班才是真正的排程迴歸**：
   要看到第二班確實發出請求（而非日期短路），且 `asOf` 只在有新數據時才跳。
2. 下一次值得盯的月度發布是 8 月的 CPI（月中）與 PCE（月底）——
   尤其 **11 月進入冬令後**，13:00 那班會跑在發布之前，屆時應能觀察到
   第二班（15:00 UTC）確實接上，那是本修正最主要的受益情境。

---

## 📅 Log: 2026-07-31 09:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修 BUG-007 —— 21:00 抓到的融資融券因重產閘門而永遠寫不進報告
- **Status**: COMPLETED（程式 + 兩區部署 + 線上覆驗）

### 根因（完整證據鏈見 `FIXED_BUG.md` BUG-007）

`handleGenerateAll` 的 `runSignature` 傳的是
`margin: series.marginDatedFailed ? '' : series.dataYmd`。
`marginDatedFailed` 問的是「這 7 天有沒有**任何**一天抓到」，歷史日必定有 ——
所以這一段整天都是 `dataYmd` 這個常數。21:00 那輪確實抓到當天的融資融券並寫進快取，
但指紋沒變、`regenerate=false`，報告不重寫；21:15 起 `decideSkip` 判 `complete` 全面短路。
結果：**每天的融資融券都晚一天才進報告**，而 manifest 早就指向新的一天，使用者看到的永遠是空的。

這是 0.6.1-dev.1（`7e27a58`，2026-07-27 由三班制改 15 分鐘輪詢）引入的迴歸。

### Completed Tasks
- [x] `pollPlan.ts`：新增純函式 `marginSigPart(marginYmds)`（附完整成因註解）。
- [x] `index.ts`：`SeriesResult` 新增 `marginYmds`（**視窗內**實際有融資融券的交易日，由舊到新）；
      `marginDatedFailed` 改由它推導；重產閘門改用 `marginSigPart(series.marginYmds)`。
- [x] `pollPlan.test.ts`：新增 4 條，含「當天由無到有 → 指紋必須改變」與「歷史日回補也要重產」。
- [x] 版本三處 bump 至 `0.6.10`（dev 期間為 `0.6.10-dev.1`），README 版本紀錄定稿。
- [x] 驗證：`npm run lint`（僅既有 3 條 fast-refresh warning）、`npm run build` 通過；
      `npm test -- --run` **622/622**（原 618 + 新增 4）。

### 影響面（已逐一確認）
- `marginDatedFailed` 語意不變，其兩個消費端不受影響：
  `loadMarginFallback`（OpenAPI 備援觸發條件）與 `batch_run_log.margin_ok`。
- `SeriesResult` 是**加欄位**，`assembleOne` 等既有消費端不動。
- 前端零改動：`ReportData` 契約沒變，`ChipsTab` / `aiPayload` 不受影響。
- 唯一的行為改變：**每天多一次重產**（約 21:00 融資融券到齊那輪）。
  代價是 N 檔 × 約 5KB 上傳 + manifest + 一次 prune，可忽略。

### 線上部署與覆驗（2026-07-31 09:15，使用者明確授權兩區）

| 環境 | 動作 | 結果 |
| ---- | ---- | ---- |
| 測試區 `wqetxuhncvfidqnklyew` | `functions deploy stock-report --no-verify-jwt` | v28、`verify_jwt=false`、ACTIVE |
| 正式區 `kxnxadaghidwumqsqneu` | 同上 | v16、`verify_jwt=false`、ACTIVE |

依 §13.3 以 `functions download` 逐檔比對，兩區的 `index.ts` / `pollPlan.ts` / `twChips.ts` /
`report.ts` 皆與 `main` **完全相同**（不是看版本號推論）。

接著各手動觸發一次 `generate-all`（兩區皆 `regenerated=true`、`generated=5`），
正式區 `20260730/0050.json` 覆驗結果：

- `margin`：融資今日 33,974 張、前日 29,290 張、變化 +4,684；融券今日 585 張；`source: rwd`。
- `sources.margin.fetchedAt = 2026-07-30T13:00:03.949Z` —— **這是關鍵證據**：
  資料昨晚 21:00 就抓到並躺在 `chip_raw_cache` 裡，只是寫不進報告。
- `notes` 由「今日融資融券尚未公布」變成**空陣列**；`history` 7/7 天都有融資融券（原本 6/7）。

### 仍待觀察（今晚）
今天的觸發是「隔天第一輪」的形狀（`last=null` 本來就會重產）。
**真正的迴歸驗證是今晚 21:00 那輪**：當天 T86 已凍結、只有融資融券由無到有，
要看 `batch_run_log` 該輪 `margin_today=true` **且 `regenerated=true`**
（修好前這一輪必定 `regenerated=false`）。

---

## 📅 Log: 2026-07-30 21:08:19 Asia/Taipei

- **Agent**: Claude
- **Action**: 修掉 README 在 GitHub 上的 Mermaid 解析錯誤，架構圖改為手繪 SVG，並清掉一批事實錯誤
- **Status**: COMPLETED（純文件，版本維持 0.6.9；**尚未 commit，也未動任何 Supabase 環境**）

### 根因：Mermaid 標題裡的半形括號

使用者看到的「錯誤訊息」是 GitHub 的 Mermaid 渲染失敗訊息，不是應用程式的錯誤。
原因是 3 個 `subgraph` 的標題含半形括號：

```text
subgraph Frontend    [React SPA (Vite + TS)]
subgraph LocalStorage [本機儲存 (本機模式)]
subgraph Supabase     [Supabase 雲端服務 (Supabase 模式)]
```

Mermaid 對 `[...]` 內的 `(` `)` 會解析失敗（要加引號才行），整塊圖因此渲染不出來。
**這種錯只在 GitHub 上看得到** —— 本地看 Markdown 原始碼是不會發現的。

### 改法：不修 Mermaid，直接換成 SVG

使用者一併要求改 SVG，所以沒有回頭修語法。新檔 `docs/architecture/system-architecture.svg`：

- **手繪、無外部依賴**（無 CDN、無字型下載），README 以 `![...](docs/architecture/system-architecture.svg)` 引用。
- 深淺色以 `prefers-color-scheme` 切換；**同時自帶背景 rect**，
  所以就算瀏覽器偏好與 GitHub 主題不一致，也不會出現「深色頁面上讀不到字」。
  （不用 `<picture>` 雙檔，是為了避免兩份圖日後各改一半而失真。）
- 內容更新到 0.6.9 實況：舊圖只有 Auth / DB / stock-price / Yahoo / MIS，
  現在補上 Storage（`reports` bucket）、pg_cron 排程、stock-report、月營收 / 新聞 / FRED、
  以及**由瀏覽器直連的 AI 端點**（使用者自備金鑰，這條路徑不經過 Supabase）。
- 驗證方式：`~/.cache/ms-playwright/chromium-1228/.../chrome --headless --screenshot`
  在淺色與 `--force-dark-mode` 各截一張，逐一確認節點不重疊、文字不溢出；XML 亦可解析。

### 一併修掉的事實錯誤

| 位置 | 錯誤 |
| ---- | ---- |
| 專案目錄結構 | 列了早已不存在的 `build-docs/`，也沒列 `docs/agent`、`docs/architecture`、`.claude/` |
| §環境架構 | 資料表只提 `price_cache` / `stock_names`；函數只提 `stock-price`；沒有 Storage / cron / AI |
| §注意事項 1 | 把 `prices` / `search` / `twlist` 寫成三支獨立 Edge Function，實為 `stock-price` 的 action（另有 `fx`） |
| §部署方式 3 | `stock-report` 只列 3 個檔（實際 10 個）；`stock-price` 漏了 `misParse.ts` |
| 版本紀錄 0.6.8 | 與 0.6.7 重複同一條「Y 軸小於 1 標成 0」bullet（0.6.7 才是原始出處） |
| 版本紀錄 0.6.2 | 第二段掉了子標題，看起來像斷章 |
| 版本紀錄 0.2.x | 標題帶 `v` 前綴，違反 `CLAUDE.md` §12「版號一律不帶 v」 |
| §使用版本 | 漏列 lucide-react、jsPDF、html2canvas、oxlint |
| §功能特色 | 完全沒有個股分析 / AI 分析 / 外幣匯率 / 總體經濟 —— 佔了 0.5.0 之後的大半功能 |

### 一併關掉 Task 41（verify_jwt 文件錯誤）

前一輪查出、當時刻意未動的那件事這次修了：兩份 README 都把 `--no-verify-jwt` 加在
**兩支**函數上，而線上實況是 `stock-price` 為 `verify_jwt=true`。
照抄會把它從「要登入」開成公開端點。改成只有 `stock-report` 帶旗標，並寫上各自的理由。
`sources/supabase/README.md` 另修掉：Dashboard 步驟（stock-price 原寫「關閉 JWT」）、
檔案清單 3 檔 → 10 檔、部署後驗證的「JWT 顯示為關閉」、常見問題的 401 列，
以及報告 JSON 結構仍寫 `schema: 2` / 「非 2 一律當未命中」（0.4.1 起是 `>= MIN_REPORT_SCHEMA`，已核對程式碼）。

### 刻意未動

- **0.2.3 版本紀錄裡**的 `deploy stock-price --no-verify-jwt`：那是歷史紀錄，記的是當時實際做法，不改寫歷史。
- **未 commit**：依 `CLAUDE.md` §13.1，異動要先進 `dev`；目前在 `main`，等使用者指示。
- 沒有部署、沒有動任何 Supabase 環境（本次全是文件）。

---

## 📅 Log: 2026-07-29 22:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 架構頁加入可點選的資料時序；**修正 `verify_jwt` 的事實錯誤**
- **Status**: COMPLETED（純文件）

### ⚠️ 修正：`stock-price` 的 verify_jwt 是 true，不是 false

22:10 那版的架構頁寫「兩支 Edge Function 都是 `verify_jwt = false`」，**這是錯的**。
以 `supabase functions list --project-ref`（唯讀，兩區都查）為準：

| 函式 | 正式區 kxnx… | 測試區 wqet… |
| ---- | ---- | ---- |
| `stock-price` | v12 · **verify_jwt = true** | v8 · **verify_jwt = true** |
| `stock-report` | v15 · verify_jwt = false | v27 · verify_jwt = false |

錯誤來源：`sources/supabase/README.md:71-73` 與根目錄 `README.md:200-201` 的部署段落
**對兩支都寫了 `--no-verify-jwt`**，但線上實況並非如此。
`CLAUDE.md` §13.3 的說法才對：「`stock-price` 是 `verify_jwt=true`，用預設即可。」

**待辦**：那兩份 README 的部署指令應該修掉，否則照抄會把 `stock-price` 開成公開端點。
本次未動（不在使用者的要求範圍內），已記在 TASK.md。

### 資料時序（使用者要求）

使用者指到 2026-07-27 那份舊 artifact（`7f867367`，0.6.0-dev.6 時期，
標題就叫「系統架構與資料時序」），要把那個互動搬到 0.6.9 這版上。
舊版的作法是：點情境按鈕 → SVG 高亮該路徑的節點與連線（跑動虛線）→ 下方列編號步驟。

移植時做了三件不一樣的事：
1. **節點上直接標圈號** —— 舊版只有下方列表有順序，圖上看不出先後。現在每個亮起的節點右上角有序號。
2. **步驟列多一欄「時間」** —— 這才是「資料時序」的重點：`T+0` / `L1 過期` / `16:00 起每 15 分` / `≤ 180s` / `閘門`。
3. **情境改為五個**，補上 0.6.9 才有的「總經／匯率：每日同步」，並依 0.6.9 更新每一步的事實
   （舊版寫的是三班制 `30 9,14,15 * * 1-5`、5 分頁個股分析、`stock-price verify_jwt = true` 也還在但當時是對的）。

放在 §01 之內（標題改為「系統全景與資料時序」），不另開章節，避免十個章節全部重新編號。

### 驗證

Playwright 跑過 1440px / 375px × 明暗兩主題 × 五個情境全部點過一輪：
零 console error、零外部請求、無橫向溢出，每個情境的高亮節點數／連線數／步驟數與序號皆符合預期。

---

## 📅 Log: 2026-07-29 22:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 產出兩份 HTML 文件 —— UI 設計方向比較、0.6.9 架構與運作流程
- **Status**: COMPLETED（**純文件，`sources/` 與 Supabase 兩區都沒有動；未進版，維持 0.6.9**）

### 產出

| 檔案 | 內容 |
| ---- | ---- |
| `docs/architecture/ui_redesign_shadcn_carbon_stripe.html` | shadcn/ui · IBM Carbon · Stripe FinTech 三個方向，各含「庫存總覽」「個股分析」兩大畫面 + 元件表 + token 表 |
| `docs/architecture/architecture_workflow_0.6.9.html` | 0.6.9 完整運作參考，十個章節（全景／Edge Functions／排程／閘門／資料源／資料庫／Storage／前端資料流／AI／部署陷阱） |

兩份都已發布成 Artifact：
- UI 設計 <https://claude.ai/code/artifact/89c7558a-6909-4b65-8935-7b4398ec51aa>
- 架構流程 <https://claude.ai/code/artifact/70738ccf-e0b5-4376-9158-b2a24c3619fb>

### 與既有四份 design HTML 的關係

`docs/architecture/` 原本已有 `design.html`（12 系統）、`design_systems.html`（16 系統）、
`layout_structure_designs.html`、`minimalist_designs.html`。那些是**廣度**展示 ——
一頁切換 `data-system`、三套骨架共用、只換色。
這次要的是**深度**，所以開新檔、不改舊檔：三個系統的
**版面骨架各自不同**（shadcn 水平 tab／Carbon 左側 UI Shell 側欄／Stripe 頂列 + 麵包屑 + 漸層 hero），
表格密度、按鈕形狀（Carbon 的文字靠左、圖示釘右）也照該系統的規範走。

### 兩個必須記住的寫法限制

1. **Artifact 的 CSP 會擋掉所有外部請求**，且發布時檔案會被包進 `<!doctype>…<body>` 骨架。
   所以這兩份檔案**不寫 `<!DOCTYPE>` / `<html>` / `<head>` / `<body>`**，
   也**不能用 Google Fonts `<link>`** —— 既有的 `design_systems.html` 用的那種在 Artifact 裡會靜默失效，
   改用系統字體堆疊。日後要再發布 HTML 到 Artifact，同樣的規則適用。
2. **不用 mermaid。** Artifact 原生支援 `<pre class="mermaid">`，但那樣的檔案直接在 repo 裡開只會看到原始文字。
   改為手刻 CSS box + inline SVG，兩種開啟方式一致。

### 驗證

以 Playwright（`sources/node_modules` 底下那份，1.62.0）實際渲染：
1440px 與 375px 兩種寬度、明暗兩種主題，**零 console error、零外部請求、無橫向溢出**，
圖表由頁面內 JS 產生（28 根 K 棒 × 3 系統 = 168 個 rect，指標摘要的 MA/KD 由同一份資料算出，不會對不上）。

過程中抓到兩個實際的破版並修掉：
- 架構頁的檔案樹少了 `white-space: pre`，縮排整個塌掉變成一段流動文字
- Carbon 的展示外框仍是 10px 圓角，等於展示框本身在破壞它「0 圓角」的規則

### 內容的事實基準

架構頁的每個數字都對過 `sources/supabase/`，不是從記憶寫的。特別記下三件容易寫錯的：
- **這個 repo 沒有 `migrations/` 目錄** —— 所有 DDL 與 cron 都在單一手動套用的 `sources/supabase/schema.sql`（不具冪等性）
- **只有兩支 Edge Function**（`stock-price` / `stock-report`），七個 action 集中在後者
- **`backfill-revenue` 沒有自己的 cron job**，掛在 `generate-all` 裡跑；所以排程表是四個，不是七個

---

## 📅 Log: 2026-07-29 17:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.9 定版、併入 `main`
- **Status**: COMPLETED（**純前端異動，Supabase 兩區都沒有動**）

### 三個 AI 問題其實同源

使用者連續回報三個症狀，一個修完換下一個冒出來：
「分析失敗（choices[0].message.content）」→「答案全在思考欄位」→「輸出寫到一半被截斷」。

追下去發現**根源是同一件事**：`GoogleProviderImpl` 一路踩坑一路補，
而 `OpenAiCompatibleProviderImpl` 的對應處理**從來沒跟上**。三處一一對照：

| | Google | OpenAI 相容（修正前） |
| ---- | ---- | ---- |
| 空回應的診斷 | 分 MAX_TOKENS / SAFETY / 結構不符 / 空文字 | **只有一句通用錯誤** |
| 關閉思考 | `thinkingConfig.thinkingBudget: 0`，400 時去掉重送 | **沒有** |
| 輸出上限 | `maxOutputTokens: 8192`（註解還記著 0.6.0-dev.6 的坑） | **沒送，用端點預設** |

修法就是把三格補齊，並沿用 Google 既有的「400 退回重送一次」模式。
**教訓：同一個介面有兩個實作時，其中一個踩到的坑要主動去看另一個有沒有同樣的洞** ——
這次是使用者連續踩三次才被逼出來的。SPEC 已把兩邊的差異補記。

### 推理型模型的處理順序（由前到後）

1. 請求時要求關掉思考（三個欄位一起送，由端點各取所需；400 退回最小集合重送一次）
2. `content` 夾著 `<think>…</think>` 就剝掉，只留正文
3. 關不掉又只有思考內容時，**改用它但強制加警語**，不整個失敗

第 3 點的警語不可省略：思考是推導草稿，有自我懷疑與中途推翻，
**數字可能是模型後來否定掉的** —— 使用者明講以前就是被 think 誤導過。有測試釘住那幾句。

### 其他

- AI 提示詞加入使用者指定的四種分批進出框架。**與既有準則 5 的衝突已處理**：
  當成描述用語彙而非放行許可，準則 10 明文寫「這不放寬準則 5」。
  **馬丁格爾單獨標註前提**（標的不歸零且資金無限、真實帳戶不成立），
  不與其他三項並列成等價選項 —— 有測試鎖死。
- BUG-006：手機上個股切換選單被擠成 48px（360px 只剩 33px）。根因是 0.6.7 讓它
  沿用 `.ws-select`，連帶繼承了一條**為頁首寫的** `flex: 1`。
  規則收斂為 `.app-header .ws-select`，個股選單改為手機上獨占一列。

### 待確認

**dev.5 的截斷修法尚未在使用者的端點上實測**（前兩個已由使用者回報確認）。
若仍截斷，代表是端點自身的硬上限（例如 Ollama 的 `num_ctx`），需在端點側調整。

### 為什麼兩區都不用動

`git diff --name-only origin/main...dev` 對 `sources/supabase/` 零命中。

---

## 📅 Log: 2026-07-29 16:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.8 定版、併入 `main`
- **Status**: COMPLETED（**純前端異動，Supabase 兩區都沒有動**）

### 這一版做了什麼

1. **個股分析合併成單一長頁**（使用者要求，先產 6 個 HTML 版型比稿後選定**版型 D 卡片分組**）。
   分頁 5 → 2（分析內容 / AI 分析），順序 我的持股 → 籌碼 → 基本面 → 技術面。
2. **折線圖改 Google Finance 風格**：漸層面積、hover 垂直虛線、提示框貼著資料點、
   超過 20 點不逐點畫圓。
3. **基本面新增月營收走勢圖**。
4. 修 `fmtAxisNumber` 對小於 1 的值標成「0」；修 BUG-005（個股切換下拉的樣式退化）。

### 三個實測後才發現、值得記下的

**① PDF 差點靜默壞掉。** 合併後擷取範圍 1140×3885 CSS px，scale 2 下是
**17.7M px²，超過 iOS Safari 約 16.7M 的 canvas 上限** —— 那是靜默失敗
（`toDataURL` 回空白，使用者只看到「PDF 產生失敗」）。
新增 `pdfScaleFor` 依面積自動降倍率，實測降到 1.901、剛好 16M 以內。
這條在計畫階段就標記為風險，實測證實會踩到。

**② 技術面的延後載入做了又拿掉。** 原本用 `IntersectionObserver` 讓它捲到才載，
量過之後發現**完全沒生效**：掛載當下籌碼與基本面都還在載、各自只有一個 spinner，
整頁不到 500px 高，技術面本來就在視窗內，observer 立刻判定可見而照樣載。
要真的延後得在上面兩段預留一兩千像素的假高度（用猜的），
而省下的只有一個約 17KB 的 Storage 請求（`warmStock` 的 session 名額早被基本面路徑用掉）。
**不值得換一個「宣稱延後、實際每次都載」的機制**，理由寫進 `TechnicalTab` 檔頭。

**③ 漸層填充在 html2canvas 下是安全的。** 本專案先前從未用過 SVG `<defs>`，
沒有相容性結論。實測 html2canvas 正確渲染 `<linearGradient>` 與 `url(#id)`，
同一次擷取內多個實例 id 不衝突、文字未變巨大黑字。
**但 id 不能直接用 `useId()`** —— React 給的是 `:r3:`，`url(#:r3:)` 不是合法選擇器語法，
填色會整片消失。

### 量測結果

- 鍵盤：整頁 Tab 次數由 **213～765 降為 24**（圖表改 roving tabindex，
  原本逐點建 `<rect tabIndex={0}>`，一年份日 K 就 244 個）。
- PDF：不含持股個資（有測試釘住）、含籌碼／基本面／技術面三段、產出非空白。
- 三大法人的**日期選擇有保留**（使用者特別交代）：7 個按鈕與法人選擇 6 項都在。
- 596 tests 綠、build 綠、lint 無新增警告。

### 為什麼兩區都不用動

`git diff --name-only origin/main...dev` 對 `sources/supabase/` 零命中 ——
這一版沒有動任何 Edge Function、schema 或 cron。

---

## 📅 Log: 2026-07-29 14:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.7 定版、併入 `main`、正式區部署完成
- **Status**: COMPLETED（**兩區皆已上線並驗證**）

### 上線順序（刻意的）

**先部署正式區後端，再 push `main`。** 反過來的話 Pages 一上線就會有使用者
看到空的匯率頁 —— 前端已經在呼叫、後端還沒有資料。

### 正式區（`kxnxadaghidwumqsqneu`）

| 項目 | 結果 |
| ---- | ---- |
| `stock-report` | v15，覆驗 `verify_jwt=false` ✅ |
| `stock-price` | v12，覆驗 `verify_jwt=true` ✅ |
| `sync-fx` | `{ok:true, synced:true, count:8, durationMs:2015}` |
| 未帶 secret | HTTP 401 ✅ |
| cron `fx-daily` | `0 3,9 * * *` 已建；直接 EXECUTE 其 command 經 pg_net 得 **200** |
| `fx/twd.json` | 8 幣別 × 259 點，2025-07-29 ~ 2026-07-28 |
| 稽核 | `functions download` 逐檔 diff **12/12 與 `main` 一致** |

### 建 cron 時身分檢查實際攔下了一次寫入

第一次送出時 `RAISE EXCEPTION 身分檢查失敗（實際看到 <NULL>）` —— 原因是
Python f-string 的跳脫寫成 `\\.`，進到 SQL 變成 `\\.`（比對「反斜線」而非小數點），
regex 匹配不到、`seen` 為 NULL。**那道防呆正確地拒絕在無法確認身分時寫入。**
修正跳脫為 `\.` 後才成功。這正是 §13.3 那條規則存在的價值 ——
若當初只寫「先查一次再寫一次」，這種情況會直接寫進去。

### GitHub Pages

`git push origin main` → workflow `30427677872` **success（36 秒）**。
線上 bundle 覆驗：版本字串 `0.6.7`、含「外幣匯率」分頁、含
`action:\`fx\`` 的即時報價呼叫（**注意 minifier 把字串轉成反引號**，
用 `action:"fx"` 去 grep 會誤判成沒有）。

合併後 `git push origin main:dev` 快轉，兩分支同為 `2fe8c73`。

### 這一版實際包含

- 外幣匯率頁（8 幣別、即時卡片 + 雙向走勢圖、3 天過期警示）
- BUG-005：個股切換下拉的樣式退化（0.6.6 誤刪 CSS）
- `fmtAxisNumber` 對小於 1 的值標成「0」
- 依使用者指示移除換算器、放棄央行 API 校驗

---

## 📅 Log: 2026-07-29 10:15:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.7-dev.1 測試區部署與驗證
- **Status**: COMPLETED（**測試區已上線並驗證；正式區未動**）

使用者授權處理 Supabase 設定並提供兩區的 `CRON_SECRET`。依 §13.1 只做測試區。

### 測試區（`wqetxuhncvfidqnklyew`）做了什麼

1. `supabase functions deploy stock-report --no-verify-jwt --project-ref wqetxuhncvfidqnklyew`
   → v26，`functions list` 覆驗 `verify_jwt=false`（漏掉這個旗標會讓盤後批次全數 401）。
2. 手動觸發 `sync-fx` → `{ok:true, synced:true, count:8, durationMs:1985}`。
3. `schema.sql` §10 的 cron job `fx-daily`（`0 3,9 * * *`）已建立。

### cron 的寫入怎麼防呆（CLAUDE.md §13.3 記載過的事故）

CLI 原本 `linked` 在**正式區**（`supabase projects list` 顯示 `kxnxadaghidwumqsqneu: linked=true`），
若直接下 `db query --linked` 就會重演 2026-07-27「測試區 cron 寫進正式區」那次。
作法：先 `supabase link --project-ref wqetxuhncvfidqnklyew`，再把**身分檢查與寫入包進同一個
`DO $$` 區塊** —— 從既有 `macro-daily` 的 command 取出 project ref，
不等於預期值就 `RAISE EXCEPTION` 中止。分兩次查擋不住 cwd 在中間被改掉。

### 驗證結果

- **冪等守門**：同一台北日第二次呼叫回 `synced:false`、208ms（首次 1985ms），不發對外請求。
- **把關**：未帶 `x-cron-secret` → HTTP 401。
- **cron 內嵌的 secret 正確**：直接 EXECUTE `fx-daily` 的 command，
  `net._http_response` 得 `status_code=200` —— secret 錯的話會每天靜默 401，必須驗這一條。
- **Storage**：`fx/twd.json` 51,208 bytes、`cache-control: public, max-age=0`（GET 量測，
  HEAD 會誤報 no-cache）。8 幣別 × 259 點、2025-07-29～2026-07-28，
  日變動落在 −0.48%～+0.03%（即時報價列已正確剔除，人民幣沒有再出現 +4.47%）。
  人民幣如預期採用 `TWDCNY=X`，其餘七個採外幣在前的幣對。
- **稽核**：`functions download` 逐檔 diff，**10/10 檔與 `dev` 分支一致**。
- **前端實測**：Playwright 讀測試區真實 Storage（不再用 fixture），
  8 張卡、雙向換算、3/6/12 個月 = 67/131/260 點、六個分頁在 320～1280px 高度全 36px、無 JS 錯誤。

### 重整到底部導覽列之上（rebase，2026-07-29 10:40）

推 `dev` 時才發現遠端已經有另一批 0.6.6 工作（Task 33 手機底部導覽列），
而且**已經定版並 push 到 `main`**（GitHub Pages 已上線）。兩件事撞在一起：

1. **版號撞號**：雙方都用了 0.6.6-dev.1。0.6.6 已被 Task 33 定版佔用，
   本功能改為 **0.6.7-dev.1**。
2. **改到同一塊**：Task 33 把主導覽改寫成 `TabNav`（≤720px 渲染成固定底部列）、
   `index.css` 動了 183 行。已 rebase 到 `origin/dev` 之上並解完衝突。

**刪掉了自己原本加的 `@media (max-width: 360px) { .tab svg { display:none } }`。**
那是為橫式分頁列算的（圖示＋標籤擠在一行）；底部列改成直式之後算式完全不適用，
留著反而會把底部列的圖示弄不見。實測六格在底部列的表現：

| 螢幕 | 每格寬 | 格高 | 標籤截斷 |
| ---- | ---- | ---- | ---- |
| 720px | 116.3px | 45px | 0 |
| 393px | 61.8px | 45px | 0 |
| 375px | 58.8px | 45px | 0 |
| 320px | 49.7px | 45px | 0 |

到 320px 都寬鬆，不需要任何補救。桌機頁首橫列六格在 1280／1020／800px
高度分別為 36／29／29px，皆未折行。版本徽章與頁尾捲到底後都沒被底部列蓋住
（不捲就量會得到假的重疊警告 —— 徽章在視窗外）。

rebase 後重跑：553 tests 全綠、`npm run build` 綠、lint 無新增警告；
測試區重新部署並再次 `functions download` 逐檔 diff，10/10 一致。

### 下一步

正式區與 `main` 尚未動，等使用者決定是否上線（push `main` 會立刻觸發 GitHub Pages）。

---

## 📅 Log: 2026-07-29 09:55:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 新增「外幣匯率」頂層頁面 (0.6.7-dev.1)
- **Status**: IN PROGRESS（程式碼完成、`dev` 分支已提交；**兩區皆未部署**）

### 做了什麼

以 0.6.5「總經」為樣板做第六個頂層頁：全域單檔走 Storage、獨立每日 cron、
`stock-report` 加一個 action，不新開 Edge Function。

- 後端：`fxRates.ts`（純函式 + 型別）、`index.ts` 的 `syncFx()` 與 action `sync-fx`、
  `schema.sql` §10 的 cron job `fx-daily`（`0 3,9 * * *` UTC ＝ 台北 11:00／17:00）。
- 前端：`services/fxProxy.ts`、`components/Fx/{fxConvert.ts,FxPage.tsx}`、
  `AppShell` 註冊第 6 個分頁（`SUPABASE_ONLY_TABS` 一併加入）。
- 測試：551 passed（新增 93 支），`npm run build` 與 `npm run lint` 皆綠。

### 四個實測結論（都不是臆測，是打了才知道的）

1. **台灣銀行牌告匯率抓不到。** `rate.bot.com.tw/xrt/flcsv/0/day` 與
   `/xrt/flcsv/0/{YYYY-MM}/{幣別}` 都回 `<title>Challenge Validation</title>`
   的 JS proof-of-work 頁，帶瀏覽器 UA 一樣。這比 FRED 的「UA 挑食」更硬，
   要真的執行 JS，Deno Edge Function 做不到。**下一個 Agent 不必再試一次。**
   改用 Yahoo（`twDaily.ts` 本來就在用同一支 API），代價是只有市場中價、
   沒有現金／即期買賣價 —— 畫面上已明白標示。

2. **沒有任何單一幣對方向對 8 個幣別都成立。** 兩側都各有幣別是死的，
   死法一樣：回 200、結構完整、但 `timestamp` 只有 1 格。
   實測 `CNYTWD=X` 只有 1 格而 `TWDCNY=X` 有 263 格；`TWDEUR=X` 只有 1 格
   而 `EURTWD=X` 有 263 格 —— 方向還相反。故每個幣別備兩個候選，
   以點數（`FX_MIN_POINTS = 60`）判定夠不夠，不夠就換下一個。

3. **Yahoo 會在序列尾端附加一列「即時報價」，必須剔除。**
   它的 timestamp **精確等於 `meta.regularMarketTime`**（兩個幣對各驗一次都成立）。
   不剔除會出錯：反向幣對那側流動性差，人民幣當天日線 4.7766、
   附加的即時列換算後 4.9900 —— 日變動 **+4.47%**，而同日其他七個幣別都只動 0.4%。
   剔除後八個幣別的日變動落在 −0.5%～+0.03%。

4. **`fmtAxisNumber` 對小於 1 的值會標成「0」。** 既有圖表（餘額、股價、成交量）
   都 ≥ 1 所以從沒踩到；匯率的日圓是 0.1957～0.2015、韓元 0.022，
   實測整條 Y 軸就是一排「0」。已改成 step < 1 時依級距補小數位，
   step ≥ 1 的既有行為一個字都沒變。

### 驗證方式

Playwright ＋ Vite dev server，以 **Supabase 模式**（塞一份假 session 繞過登入頁，
不觸及任何伺服器端授權），並攔截 `reports/fx/twd.json` 餵入**由真實 Yahoo 資料產出**
的 fixture（8 幣別 × 259 點）。量到：

- 六個分頁在 1280 / 720 / 400 / 375 / 360 / 320px 高度全為 36px（折行是 57px），
  360px 以下圖示隱藏。既有手機版沒有退化。
- 雙向換算：輸入台幣 32000 → 990.65 美元；輸入 100 美元 → 3,230.20 台幣。
- 走勢圖 3 個月／6 個月／1 年 = 67／131／260 點，X 軸抽稀成 6 個標籤。
- Console 無任何 JS 錯誤。

過程中靠瀏覽器抓到一個 jsdom 測不出來的 bug：`Converter` 與 `TrendChart`
是同層兄弟節點卻共用 `key={current.code}`，React 判定「同一層兩個相同 key」，
實際結果是切到日圓後畫面上同時留著兩個美元換算器。已改成不同前綴。

### 下一步

**兩區都還沒部署，需使用者明確指示才動**（見 TASK.md Task 33 的待辦清單）。
`CRON_SECRET` 明文 Agent 拿不到，手動觸發 `sync-fx` 要請使用者自己執行。
## 📅 Log: 2026-07-28 21:55:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 手機主導覽改為固定底部列（方案 08）
- **Status**: COMPLETED（程式碼）／PENDING（commit 與部署）

### 背景

使用者提供「頂層頁籤 — 10 個設計提案」文件並指定**方案 08：手機底部導覽**。
要解的是 0.6.5-dev.2 留下的帳：分頁從 4 個變 5 個後，375px 只差 1px 就折行，
當時靠 `@media (max-width: 400px)` 收窄間距硬擠，第六個分頁就再也塞不下。
選擇理由與其餘九案的淘汰理由寫在 `PLAN.md §S`。

### 最關鍵的一件事：純 CSS 做不到

`.app-header` 有 `backdrop-filter: blur(18px)`，**它會成為所有 fixed 子孫的
containing block**。頁首裡的 `<nav>` 就算設 `position: fixed; bottom: 0`，
也只會貼在頁首那一塊的底部，不是視窗底部。

所以底部列必須是頁首以外的節點，改由 `AppShell` 的 `useNarrowScreen()`
（`matchMedia('(max-width: 720px)')`）決定同一份導覽渲染在哪。
**刻意不渲染兩份用 CSS 藏一份** —— 那會有兩組同名按鈕。

### Completed Tasks

- [x] `AppShell.tsx`：抽出 `TabNav`（`variant: 'header' | 'bottom'`）與 `useNarrowScreen()`；
      移除 `.tab-label-short` 這個「同一顆按鈕塞兩份標籤」的舊寫法。
- [x] `index.css`：新增 `.bottom-nav`（高度單一來源 `--bottom-nav-h: 54px`，
      安全區另加 `env(safe-area-inset-bottom)`）；浮動鈕上移讓開；
      版本徽章手機改回文件流跟在頁尾後面；刪掉 `@media (max-width: 400px)` 的分頁擠壓。
- [x] 清掉 dev.3 之後就選不到元素的死 CSS：`.ws-select select`（4 處）、`.user-email`（3 處）。
      其中 `≤720px` 那條正是「375px 工作區下拉塌成 39px」的肇因。
- [x] `App.smoke.test.tsx`：新增 `stubMatchMedia()` 與 2 支測試（手機走底部列且頁首無分頁、
      桌機維持頁首橫列）。**`afterEach` 一定要還原 matchMedia**，否則後面所有測試都會跑在手機版。
- [x] 版本 bump 至 `0.6.6-dev.1`（`version.ts` / `package.json` / `package-lock.json` / README）。
- [x] 驗證：`npm run lint` 無新增警告、`npm run build` 通過、`npm test` **471/471**（原 469 + 2）。

### Playwright 實測（`375 / 414 / 768 / 1024 / 1220 / 1440px`）

| 項目 | 結果 |
| ---- | ---- |
| 導覽位置 | ≤720px 底部列、≥721px 頁首橫列，不會同時存在 |
| 底部列 | 54px；每格 45px，三格皆通過 `elementFromPoint` 命中測試 |
| 5 / 6 格（複製節點實測） | 375px：71px / 59px；414px：79px / 65px，**皆單列不折行** |
| 頁首高度（375px） | 106px → **58px** |
| 捲到底 | GitHub 連結可點；徽章在導覽列上方，與浮動鈕不重疊（320px 亦然） |
| 縮放 1280 → 375 → 1280 | 導覽列正確換位，**目前分頁不被重設** |

亮色 / 暗色兩種主題都看過截圖。

### 教訓

- **`--no-save` 裝 Playwright 不會污染 `package.json` / `package-lock.json`**（實測 git status 乾淨），
  記憶裡那三道安裝指令（含 `sudo -n env "PATH=$PATH"`）2026-07-28 仍然可用。
- 量測腳本放在 scratchpad 時，**ESM 的 `import 'playwright'` 會從腳本所在目錄找 node_modules**，
  不是 cwd。改成 import 絕對路徑 `sources/node_modules/playwright/index.mjs` 即可。
- 本機模式只有 3 個分頁，要驗 5 / 6 格時**用 `cloneNode` 複製既有按鈕**再量 ——
  同樣的 CSS 與節點形狀，比推算算式可信。

### 定版與分支

依使用者指示**直接 commit 到 `dev` 與 `main`**（跳過測試區先行驗證這一關；
本次為純前端版面異動，Supabase 兩區都不必動，風險僅止於畫面）。
`dev` 為 `0.6.6-dev.1`，`main` 依 §12.3 去掉尾綴定版為 `0.6.6`，
之後 `dev` 快轉對齊 `main`，兩分支一致。

### 🚧 Next Steps

1. **`git push origin main`** —— 會觸發 `deploy.yml`，GitHub Pages 立即上線（尚未執行）。
   一併 `git push origin dev` 讓遠端兩分支同步。
2. 上線後**用真手機看安全區**（桌機瀏覽器的 `env(safe-area-inset-bottom)` 恆為 0，
   iPhone 的 home indicator 那條只有實機看得到）。

---

## 📅 Log: 2026-07-28 19:55:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.5 定版並上線兩區
- **Status**: COMPLETED

### 合併 main 帶上的是整個 0.6.5

不只 dev.3 的頁首異動 —— `main` 從 0.6.4 直接跳到 0.6.5，一次帶上
獲利能力、總體經濟頁、AI 追問對話、總經獨立排程、頁首收斂。
**所以正式區的後端也必須一起補**，否則線上的「總體經濟」會是空的、
基本面看不到獲利能力。

### 正式區部署（`kxnxadaghidwumqsqneu`）

1. `functions deploy stock-report --no-verify-jwt`
2. 建 `macro-daily` cron job（`0 13,15 * * *`）。身分檢查包進同一個 `DO` 區塊
   （`009816` 只有正式區有），不符就 `RAISE EXCEPTION`。
3. `sync-macro` → `synced: true, count: 5, 3750ms`
4. `generate-all` → `fundamentalSynced: 5`，回傳**已無 `macroSynced`**

> `batch_run_log.macro_synced` 正式區從未加過，dev.2 起已成廢欄位，**確認不必補**。

### 覆驗結果

**總經**（`macro/us.json`，schema 1，五項）：

| 指標 | 期別 | 值 |
| --- | --- | --- |
| 核心 CPI | 2026-06 | 2.57 % |
| 核心 PPI | 2026-06 | 4.68 % |
| 核心 PCE | 2026-05 | 3.41 % |
| 非農就業 | 2026-06 | +57 千人 |
| 消費者信心 | 2026-05 | 44.8 |

**獲利能力**（`fundamental/*.json` 升到 schema 2）：
台玻 2026-Q1 毛利率 19.23%、陽明 7.3%；0050 為 ETF 無季度資料（預期內）。

**cron**：三個 job 的 ref 都是 `kxnxadaghidwumqsqneu`、密鑰長度 48、active。

**程式碼稽核**：`functions download` 逐檔比對，正式區線上 **9/9 檔與 `main` 一致**。

**GitHub Pages**：run 30347350372 **success**（40s）。

### 仍未做

- **AI 追問框限的人工驗證**（無法自動化）：問「幫我寫首詩」應一字不差回固定拒答句。
  清單見 `TASK.md` Task 30。
- 獲利能力目前只有 1 季（來源只回最新一季），要兩年才長滿 8 季。

---

## 📅 Log: 2026-07-28 19:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.5-dev.3 —— 頁首右側改為工作區選單 ＋ 帳號選單（設計 review 的 R4）
- **Status**: COMPLETED（程式碼與閘門）

### 起因

使用者要了頁首頁籤的設計提案，接著說「右邊的也一起 review」。
量完之後右側其實比左側嚴重：**8 個控制項**，而且有**兩個確定性的 bug**（見 `PLAN.md §R1`）。
使用者選定 R4（R1 ＋ R3 合併）。

### 兩個 bug 修好了，有數字

| 項目 | 之前 | 之後 |
| --- | --- | --- |
| header 高（≥1221px） | **106px**（兩列） | **70px**（單列） |
| header 高（≤1220px） | 70px | 70px |
| 375px 工作區下拉 | **39px**（只剩箭頭） | 108px（名稱佔 42px 可讀） |

實測七個寬度：375 / 720 / 1024 / 1200 / 1221 / 1440 / 1600。

### 實作時自己踩的坑

把 `ThemeToggle` 的 effect 搬進 `UserMenu` 時，**漏抄了
`typeof window.matchMedia !== 'function'` 這個條件**。jsdom 沒有實作 matchMedia，
少了它 `App.smoke` 整批 **8 支測試當場全掛**。

教訓：搬移程式碼時，看起來像贅字的防禦條件往往是有人踩過才加的。
搬之前先問「這個條件為什麼在這裡」，不要憑印象重打一遍。

### 刻意的取捨

- **本機模式保留「本機模式」徽章當觸發鈕**，不換成頭像。
  「資料只存在這個瀏覽器」要隨時看得到，藏進選單等於降級。
  附帶效果：十餘個以 `findByText('本機模式')` 當載入訊號的測試不受影響。
- **`HeaderMenu` 抽成共用**：兩個選單的點外面關閉 / Esc / aria 必須一致，
  各寫一份遲早只修好一邊。

### 驗證

- 閘門：lint / build / **469 tests**（原 465 ＋ 新增 4）。
- 新測試鎖住：選單分層與順序、刪除為 `is-danger`、`aria-checked`、
  Esc 關閉並把焦點還給觸發鈕、本機模式無登出、**右側只剩兩顆按鈕**。
- 真瀏覽器七寬度量測（見上表）＋ 選單外觀截圖確認。

---

## 📅 Log: 2026-07-28 17:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.5-dev.2 —— 總經從個股分析與盤後批次雙雙拆出
- **Status**: 實作完成、閘門全綠；待部署

### 起因

使用者問「如果我們把總經的部分獨立開來呢？」。dev.1 把總經做成
**個股分析的一個分頁**、並掛在 `handleGenerateAll` 裡 —— 兩件事都與
`PLAN.md §Q3` 第 1 點（「它是全市場共用的一份」）自相矛盾。

**dev.1 甚至得在畫面上印一行「與您正在查看的個股無關」來補救**。
那句補救文案本身就是「設計放錯位置」的訊號。

使用者定案：拆①畫面改頂層頁面、②觸發改自己的 cron。
**不拆**成獨立的 Edge Function —— 要解耦的是觸發時機不是程式碼位置，
而 `source-probe` 已有「同一支函式、不同 action、不同排程」的先例。

### 先把耦合的嚴重度講清楚（不誇大）

`decideSkip` 的短路 `return` 排在 `syncMacro` 之前，**短路時總經整段不跑**
（實測 2026-07-27：15 輪有 4 輪短路）。但當天第一輪必然不短路，
所以交易日的總經都抓得到；**真正的缺口是週末**（cron 是 `1-5`）。
美國數據多在美東上午發布 ＝ 台北傍晚，落在現有窗口內 ——
**這次是修架構，不是修線上故障。**

### 做了什麼

- **`MacroPage`**（頂層頁）取代 `MacroTab`。零 props、自持載入 state 與重新整理鈕。
  自己包 `.section`＋`.glass`（`.detail-body` 的 padding 不會跟著走）。
- **本機模式一併隱藏**：`fetchMacro()` 在本機模式永遠回 `null`，
  而空狀態寫「排程完成後會自動補上」在本機模式是假的。
  抽出 `SUPABASE_ONLY_TABS`，與「個股分析」同一條規則。
- **`AiTab` 改成自己 `fetchMacro()`**，與它既有的 daily / news 同構；
  `StockDetailPage` 的 macro state / effect / prop 與 `macroLoading` 耦合整段刪除。
  附帶好處：變成 lazy，按下「產生分析」才抓。
- **新 action `sync-macro` ＋ 新 cron job `macro-daily`**（`0 13,15 * * *`）。
  兩班 ＝ 台北 21:00 與 23:00，分別在美國夏令 / 冬令的 8:30 ET 發布之後，
  且**都落在同一個台北日內**，所以第一班成功時第二班會被「同日已抓過」擋掉
  （零對外請求），第一班失敗時第二班才真的重抓。
- `batch_run_log.macro_synced` 標為**廢欄位**。不寫進 `batch_run_log` 是刻意的：
  那張表的一列 ＝ 一輪盤後批次，`readLastRun` 會讀最後一列取 T86 指紋與 `runs_today`，
  插進總經的列會**汙染 `decideSkip` 的跨輪狀態**。

### 實測到的版面問題（本次的重點風險）

頂層分頁由四個變五個，**375px 螢幕上折行** —— Playwright 量到 tab 高度
由 36px 變 **57px**（其他寬度都是 36px）。

算式對得起來：容器 375 − container padding 14×2 − tabs padding 4×2 ≈ 339px，
五等分每格 **63px**；而每格內容 ＝ 圖示 15 ＋ gap 7 ＋ 兩字 26 ＋ padding 8×2 ＝ **64px**。
**差 1px。**

修法：新增 `@media (max-width: 400px)` 收 gap 與左右 padding（內容壓到 56px），
並加 `white-space: nowrap`。⚠️ 該區塊**必須排在 720px 那段之後** ——
兩者對 `.tab` 的權重相同，順序錯了等於沒寫（第一次就寫錯了，量完才發現）。

重量六種寬度（375 / 414 / 768 / 1024 / 1220 / 1440）：
tab 高度全部一致、五格等寬差距 0、單列、無橫向溢出。

### 另一個小坑：`*/15` 把區塊註解關掉

在 JSDoc 裡寫 cron 表達式 `` `*/15 8-15 * * 1-5` `` —— 其中的 `*/`
**直接終止了區塊註解**，lint 報 `Expected a semicolon`。改寫成中文敘述。

### 驗證

- 閘門：lint / build / **465 tests** 全綠（原 458 ＋ 新增 7）。
- `MacroPage.test.tsx` 7 筆，含「走勢表以期別聯集為列、某指標缺該期時填『—』而非錯位」
  （各指標發布時程不同，PCE 通常比 CPI 晚一個月）。
- `App.smoke.test.tsx` 補「本機模式沒有總體經濟分頁」，並斷言其餘三頁不受影響。
- Playwright 六寬度導覽列掃描（見上）。

### 測試區驗證（2026-07-28 17:2x）

- `{"action":"sync-macro"}` 第一次 324ms、第二次 110ms，皆回
  `synced:false, count:5` —— 今天已抓過，**同台北日短路生效、零對外請求**。
- `{"action":"generate-all"}` 的回傳**已無 `macroSynced` 欄位**，其餘正常。
- `macro-daily` cron job 已建立並覆驗：`ref=wqetxuhncvfidqnklyew`（自己）、
  密鑰長度 48（非佔位符的 13）、`schedule=0 13,15 * * *`、`action=sync-macro`。
  另兩個既有 job（`stock-report-nightly` / `source-probe`）未受影響。
  建立時把身分檢查包進同一個 `DO` 區塊（`8033` 只有測試區有），
  身分不符就 `RAISE EXCEPTION` —— §13.3 那顆「寫錯區」地雷的防呆。
- `functions download` 逐檔比對：線上 **9/9 檔與 `dev` 位元組一致**。
- **真瀏覽器**渲染 `MacroPage`（讀測試區實際資料）：1280 / 375px 都是
  五格 KPI、12 期走勢、`.section.glass` padding `18px 20px` 正確、
  **補救文案已消失**、無橫向溢出、無 page error。

### 待辦

正式區未動。見 `TASK.md` Task 31 —— 併 `main` 時要一併部署 0.6.5 的全部內容
（0.6.5-dev.1 的獲利能力與總經、dev.2 的拆分），並**建立 `macro-daily` cron job**。
**只跑 `schema.sql` §9 那一段，不要整份重跑。**

---

## 📅 Log: 2026-07-28 15:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.5-dev.1 —— AI 分析更名與追問對話、總經分頁、獲利能力比率
- **Status**: 實作完成、閘門全綠；待部署驗證

### 使用者要求

① 「AI 解讀」改叫「AI 分析」 ② 產生初次分析後可繼續與 AI 討論，
但要**嚴格限制與框架提示詞，不允許有股票與分析外的部分**
③ 個股分析新增核心 CPI / PPI / 非農 / PCE / CCI / 消費者信心，
以及毛利率 / 營益率 / 淨利率 / 稅後淨利率。

### 先把資料源實測完才設計

| 需求 | 結論 |
| --- | --- |
| 獲利能力 | `opendata/t187ap17_L` 一次到位（1051 筆／383KB），**比率由證交所算好** |
| 核心 CPI / PPI / PCE | FRED `CPILFESL` / `PPIFES` / `PCEPILFE`，**免 API key** |
| 核心非農就業 | 不是既有概念 → 採 `PAYEMS` 的月增人數 |
| 核心 CCI ＋ 核心消費者信心 | **實質同一件事**，合併為 `UMCSENT` |

**CCI 拿不到的實證**：Conference Board 版為付費；FRED 上的 OECD 版
`CSCICP03USM665S` 實測**最後一筆停在 2024-01**（已停更）。
使用者據此定案合併為密大指數一項。

**「核心」只有 CPI / PPI / PCE 有標準定義**（排除食品與能源），
不硬造「核心非農」「核心消費者信心」這種不存在的口徑。

### 推翻了兩條既有決策（依慣例寫進 PLAN.md，不默默改）

1. **§M8「0.6.0 不做多輪對話」→ §P**。那是範圍控制不是紅線，單輪已穩定運行。
2. **§N2「不用季報 EPS：欄位解析繁瑣」→ §Q**。那句是針對綜合損益表講的
   （要分五張產業別表、自己做除法）。`t187ap17_L` 的比率是現成欄位，
   理由在新端點上不成立。

### 框限的設計重點

- **固定拒答句要求一字不差**。它的價值不在阻擋而在**可觀測**：
  模型若自由發揮地婉拒，「它拒絕了」與「它其實答了但講得客氣」就分不出來。
- **刻意不做前端關鍵字過濾**。「這檔跟聯電比呢」是合理提問卻會被代號黑名單擋掉；
  「用這檔資料寫首詩」每個詞都在白名單裡卻該擋。誤擋的代價比漏接高。
- **system 每一輪都重送**，框限不隨對話變長被稀釋，也擠不出脈絡窗口。
- **成本用輪數控制**（`MAX_CHAT_TURNS = 10`），不是用內容過濾控制。

### 順便修掉的既有痛點

`AiTab` 的結果原本純為 component state，而 `StockDetailPage` 是條件渲染 ——
切分頁再切回來就消失、要重按一次**並重新計費**（`PROGRESS.md:181` 記過）。
現在分析與對話一起存進 `sessionStorage`，回來直接還原。

對話紀錄**一律顯示**（含還原的），能不能「繼續問」才取決於 `payload`：
兩件事分開，否則會看得到分析卻看不到自己剛才問過什麼 —— 這是寫測試時抓到的。

### 實作過程中抓到的兩件事

1. **Gemini 的助理角色叫 `model` 不是 `assistant`**。`AiRequest` 改成
   `messages` 陣列之後，兩支 adapter 的映射差異變成正式的風險點：送錯會讓模型
   以為自己上一輪講的話是使用者說的。抽成純函式並測住。
2. **`mergeRevenueMonths` 與新的 `mergeProfitQuarters` 抽出共用核心**
   `mergePeriodSeries`。兩者的去重 / 排序 / cap 規則必須永遠一致，
   各寫一份遲早只會修好其中一邊，而這種不一致從呼叫端完全看不出來。

### 閘門的偽陽性（順手修掉）

`App.smoke` 與 `TransactionsPage` I1–I7 那幾支「render 整個 App ＋ userEvent
逐字輸入」的整合測試，在機器忙碌時整批逾時。**把所有異動 stash 掉、
在乾淨的 main 上跑，同樣 7 支全紅** —— 與程式碼無關。
`vite.config` 的 `testTimeout` 由預設 5 秒拉到 20 秒。閘門會無故變紅就沒人信它了。

### 驗證

- 閘門：lint / build / **456 tests** 全綠（原 422 ＋ 新增 34）。
- 純函式測試涵蓋：`usMacro`（含 FRED 空值列、年增基期為 0 不硬算）、
  `twFundamental`（`rocYearQuarter` / `extractProfit` / `mergeProfitQuarters`、
  **`buildFundamentalFile` 必須帶上新欄位**的回歸樁）、
  `aiChat`（固定拒答句、防注入、輪數）、`aiChatStore`（sessionStorage 停用時降級）、
  `aiClient`（**`assistant` → `model`** 映射）。
- **真瀏覽器**（Playwright）：以真實資料渲染 `MacroTab` 與 `FundamentalTab`，
  1440 / 760px 版面正確、無橫向溢出、無 page error。
- FRED 五序列的計算值都合理，非農 `+57 千人` 與手算 `158984−158927` 相符。

### 測試區部署後撞到的事：FRED 擋瀏覽器 UA

第一次部署，`generate-all` 回 `macroSynced: false`、`macro/us.json` 根本沒產生。
獲利能力那半完全正常（`schema: 2`、2330 的 Q1 為 66.25 / 58.10 / 60.65 / 50.51）。

根因：`syncMacro` 沿用了 `twChips.ts` 的 `UA` 常數 —— 那是給 TWSE 用的**瀏覽器字串**。
FRED 的防護對「宣稱是瀏覽器卻不是瀏覽器」的請求**直接重置 HTTP/2 連線**
（`INTERNAL_ERROR`），連 HTTP 狀態碼都拿不到，所以 `catch` 直接吃掉。

逐一實測（各兩次，確認是確定性而非偶發）：

| User-Agent | 結果 |
| --- | --- |
| `Mozilla/5.0 (…Chrome/120…)` | ❌ 連線重置 |
| `stock-pnl-web/0.6.5` / `Deno` / 空 UA | ❌ 同上 |
| `Deno/1.45.5` / `curl/8.5.0` / `python-requests/2.31.0` | ✅ 200 |
| `stock-pnl-web (+https://github.com/CTJ425/stock-pnl-web)` | ✅ 200 |

選最後這個並抽成 `MACRO_UA`：誠實表明自己是誰、附聯絡處，是對公開資料源該有的禮貌，
也不必賭 Deno 預設 UA 的格式哪天會不會變。加了回歸樁鎖住「不得含 Mozilla / Chrome」。

**順手修掉可觀測性**：原本整批失敗時只留一個 `macroSynced: false`，
與「今天已經抓過所以跳過」長得一模一樣。改成 `batch_run_log.macro_synced`
記**指標數**：5 是正常、0 是一個都沒抓到。

> **教訓**：跨資料源複製貼上請求標頭是有代價的。`UA` 那個常數的名字太泛，
> 讀起來像「本專案的 UA」，實際上是「給 TWSE 看的偽裝」。

### 測試區驗證（2026-07-28 15:35）

- `generate-all` → `macroSynced: true`、`macroIndicators: 5`、`fundamentalSynced: 5`。
- `macro/us.json` 五項齊全，數值與本機由原始 CSV 算出的完全一致
  （核心 CPI 2.57% / 核心 PPI 4.68% / 核心 PCE 3.41% / 非農 +57 千人 / 信心 44.8）。
- `fundamental/2330.json` 升到 `schema: 2`，`profitQuarters` 有 2026-Q1。
- **真瀏覽器**（Playwright，讀測試區實際資料）：`fetchMacro` 拿到 5 項、
  `MacroTab` 五格 KPI ＋ 12 期走勢表、`FundamentalTab` 七格 KPI
  （估值三格 ＋ 獲利能力四格 66.25 / 58.10 / 60.65 / 50.51）、無橫向溢出、無 page error。

### 待辦

- **人工驗證追問框限**（無法自動化，清單見 `TASK.md` Task 30）。
- 正式區未動。併 `main` 時**只跑那一行 `ALTER TABLE`，不要整份重跑 `schema.sql`**
  —— 0.6.4 那次整份重跑把兩個 cron job 打回佔位符。

---

## 📅 Log: 2026-07-28 11:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 時間戳移到月營收標題旁；0.6.4 定版並併入 `main`、部署正式區
- **Status**: IN PROGRESS

### 版面調整

「資料更新於 …（共 N 個月）」由表格下方移到**月營收標題右側**（使用者要求）。
理由站得住腳：擺在下方時使用者不會注意到 —— 0.6.4-dev.4 實際發生過，
畫面少了 11 個月，而答案就在同一頁的下面兩行，仍然沒被看見。

新增 CSS `.rpt-section-head h3.head-tight` / `.section-stamp`：
`h3` 預設 `flex: 1 1 auto` 會把後面的元素全推到最右，改由 stamp 接手伸縮，
「單位：千元」仍靠右。Playwright 於 1440 / 1024 / 760px 實測版面正確、12 列。

### 定版

依 §12.3 去掉 `-dev.N` 尾綴：`0.6.4`（`package.json` / `package-lock.json` /
`version.ts` / README 徽章）。README 版本紀錄把 dev.1–dev.5 五個分段**整併定稿**
為一則 0.6.4 條目，不留開發期的流水帳。

### 正式區上線（`kxnxadaghidwumqsqneu`）

**刻意只跑一行 SQL**，沒有整份重跑 `schema.sql` —— 測試區今天早上正是因為整份重跑
而讓兩個 cron job 被打回佔位符（見 10:45 那則）：

```sql
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS revenue_backfilled INT;
```

身分檢查與寫入放同一次查詢（§13.3）：`fundamental/` 代號清單為
`0050,00685L,009816,1802,2609`（含 `00685L` / `009816`，測試區沒有），確認是正式區。
欄位數 26 → 27。

部署 `stock-report --no-verify-jwt`，回補打 4 輪：

| 輪 | months | filled | duration |
| - | --- | - | --- |
| 1 | 2026-03…06 | 5 | 6004ms |
| 2 | 2025-11…2026-02 | 5 | 5452ms |
| 3 | 2025-07…10 | 5 | 4710ms |
| 4 | （空） | 0 | **2117ms** |

覆驗結果：

| 代號 | 名稱 | 月數 |
| --- | --- | - |
| 1802 | 台玻 | **12**（2025-07～2026-06） |
| 2609 | 陽明 | **12** |
| 0050 / 00685L / 009816 | ETF ×3 | 0，`through=2025-07` 已收斂 |

**快取修正確認生效**：`GET .../fundamental/2609.json` 現在回
`cache-control: public, max-age=0`（原為 `max-age=3600`）。
—— 注意這是**檔案被重寫之後**才換掉的 metadata，再次印證前端那道 `no-store` 不能省。

### 上線後稽核（全綠）

- `functions download` 逐檔比對：正式區線上 **8/8 檔與 `main` 位元組一致**。
- 正式區兩個 cron job：ref = `kxnxadaghidwumqsqneu`（自己）、密鑰長度 48、
  schedule `*/15 8-15 * * 1-5`、active —— **未受本次異動影響**。
- GitHub Pages：`Deploy React App to GitHub Pages` run 30325714234 **success**（40s）。
- `main` 與 `dev` 同為 `770e574`，兩分支一致（§13.1）。

---

## 📅 Log: 2026-07-28 11:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.4-dev.5 —— Storage 讀取被瀏覽器快取一小時（線上事故根因）
- **Status**: COMPLETED（前端已驗證；後端已部署測試區）

### dev.4 加的時間戳立刻抓到真兇

使用者並排截圖：同一頁、同一檔（2609 陽明）

- **一般視窗**：「資料更新於 2026-07-27 20:15（**共 1 個月**）」
- **無痕視窗**：12 個月

也就是說瀏覽器拿到的是一份**舊了約 15 小時**的檔案。這在加上時間戳之前完全看不出來 ——
畫面上只是「少了幾個月」，無從分辨是資料本來就這樣還是自己拿到舊的。

### 根因

1. `index.ts` 的 `uploadJson` **沒有指定 `cacheControl`**，supabase-js 預設 `'3600'`。
   實查 `storage.objects.metadata` → `cacheControl = max-age=3600`。
2. Storage 因此回 `cache-control: public, max-age=3600`。
3. `supabase.storage.download()` 底層是 `fetch()`，這份回應被瀏覽器快取。
4. **使用者救不了自己**：`Ctrl+Shift+R` 只跳過「文件與其子資源」的快取，
   **不涵蓋 JS 之後才發出的 `fetch()`**。所以硬重整無效，只有無痕視窗才對。

### ⚠️ 我自己製造的診斷錯誤（這條最該記住）

先前我用 **`curl -I`（HEAD）** 量這個端點，得到 `cache-control: no-cache`，
就據此下結論「不是快取問題」，並要使用者往瀏覽器 session 方向找。

**Supabase Storage 對 HEAD 與 GET 回的 `cache-control` 不一樣**：

```text
HEAD → cache-control: no-cache
GET  → cache-control: public, max-age=3600   ← 前端實際遇到的
```

這個錯誤結論讓整件事多繞了兩輪（先怪 HMR、再怪瀏覽器 session）。
**驗證快取行為一律用 GET**：`curl -s -o /dev/null -D - <url>`。

### 修法（兩邊都要）

- **前端** `reportsBucket.ts`：改用 `fetch(getPublicUrl(path), { cache: 'no-store' })`。
  這是單一讀取入口，籌碼 / 日線 / 基本面 / 新聞全部受惠。
- **後端** `index.ts` `uploadJson`：明寫 `cacheControl: '0'`。

**前端那道不能省** —— 既有檔案的 metadata 要等下次寫入才會更新，
而 `syncFundamental` 有 `dataDate >= targetDate` 的跳過條件，今天不會重寫，
要等明天的新交易日。前端 `no-store` 是立即生效的那一道。

### 驗證

- 閘門：lint / build / **395 tests**（新增 `reportsBucket.test.ts` 4 筆，
  含「讀取必須帶 `cache: no-store`」）。
- 四個既有 proxy 測試的 mock 由 `download` 轉接到 `fetch`，斷言不必改寫。
- **真瀏覽器實測**（Playwright，持久 context 非無痕）：連續三次 `fetchFundamental('2609')`
  → **發出 3 次網路請求**、三次都回 12 個月。修改前第二次以後會被瀏覽器快取吃掉。

### 教訓

- **快取問題要用 GET 驗，HEAD 會騙人。**
- **「使用者能不能自救」是嚴重性的一部分**：同樣是顯示舊資料，
  能靠重整解決 vs 硬重整也沒用（只有無痕才對），後者嚴重得多。
- 這次能定位靠的是 dev.4 加的那行時間戳。**先讓問題可觀測，再談修**
  —— 在那之前我查了六個層次全部「正常」，因為每一層都是拿新資料驗的。

---

## 📅 Log: 2026-07-28 11:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.4-dev.4 —— 基本面標示資料產出時間；個股分析頁加「重新整理」鈕
- **Status**: COMPLETED（前端變更，未動後端）

### 起因：一個查不出來的回報

使用者回報台玻（1802）的月營收畫面只有 2026/6，重整、重開 dev server 都一樣。
我把每一層都驗過（見下），全部顯示 12 個月，**無法重現**。使用者判斷是瀏覽器端問題。

驗證過的層次，之後遇到同類問題可直接跳過：

| 層 | 方法 | 結果 |
| --- | --- | --- |
| Storage 物件 | service role 查 `storage.objects` | 12 個月，10:25:38 後無新寫入 |
| HTTP 快取 | `curl -I` | `cache-control: no-cache`、`cf-cache-status: MISS` |
| anon 讀取 | `.env.local` 金鑰打 `/object/reports/...` | 12 個月 |
| **真瀏覽器 + 真前端** | Playwright 開 `localhost:5173` 後 `import('/src/services/fundamentalProxy.ts')` | 12 個月 |
| 元件渲染 | 真實 JSON 餵進 `FundamentalTab`（jsdom 與真瀏覽器各一次） | 12 列 |
| 頁面邏輯 | `StockDetailPage.tsx` | 無快取層，`[ticker]` 變更即重抓 |

**一個關鍵事實**：使用者截圖的估值數字（PER 392.31 / PBR 2.99 / 資料日 2026-07-24）
與該 JSON 完全一致 —— 也就是說瀏覽器確實讀到了那個檔案，而那個檔案有 12 個月。
同一份 JSON 不可能只有月營收那段是舊的。根因未明。

### 所以改的是「可判斷性」，不是猜一個修法

根因查不出來時，能做的是讓下次一眼看得出來、並且使用者能自己救：

- `FundamentalTab`：月營收區塊下方加「資料更新於 {asOf}（共 N 個月）」。
  **與估值的「資料日」刻意並存且語意不同** —— 後者是資料自己宣告的日期，
  前者是我們抓到並寫檔的時刻。這個區分本來就是 `source_probe_log`（0.6.3）
  建立的準則，只是先前沒有帶到畫面上。
- `StockDetailPage`：新增 `reloadKey` state 與「重新整理」鈕，
  串進報告與基本面的 effect 依賴，並以 prop 傳給 `TechnicalTab`。
  不必整頁重載也不必切換股票就能重抓。
  （`AiTab` 刻意不接 —— 重掛會把使用者剛產生的 AI 解讀洗掉。）

### 驗證

- 閘門：lint / build / **391 tests**（新增 2 筆鎖住時間戳與「兩個日期不可混談」）。
- **真瀏覽器實測**：Playwright 在 `localhost:5173` 內以真實測試區資料渲染 `FundamentalTab`，
  得到 12 列與「資料更新於 2026-07-28 10:25（共 12 個月）」。

### 未採用（使用者評估後排除）

- 讀取改 `fetch(publicUrl, { cache: 'no-store' })`。
- `warm` 也跑月營收回補 —— **這個缺口仍然存在**：新增股票第一次打開只有 1 個月，
  要等當晚批次才補滿。`backfill-revenue` 目前只掛在 `generate-all` 上。

---

## 📅 Log: 2026-07-28 10:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.4-dev.3 —— 修「每晚批次抹掉回補進度」；建檔邏輯抽成純函式
- **Status**: COMPLETED（測試區已部署驗證）

### 起因：使用者回報畫面上還是只有六月

先把「是不是前端問題」查到底，結論是**後端與前端都沒問題**：

1. Storage 四檔（1802 / 2330 / 2609 / 8033）內容完全一致，各 12 個月。
2. HTTP 標頭 `cache-control: no-cache`，CDN 不會提供舊版；
   `cf-cache-status: MISS`、`last-modified` 都是寫入當下。
3. 以 **anon 金鑰**照 `supabase-js` 的路徑實測，2330 一樣讀到 12 個月。
4. 前端 `downloadReportsJson` **完全沒有任何快取層**，每次都真的下載。
5. 把測試區的**真實 JSON** 餵進 `fetchFundamental` → `FundamentalTab` 用 jsdom 渲染，
   四檔**各渲染出 12 列**（2026 年 06 月 → 2025 年 07 月）。

所以畫面只顯示六月是瀏覽器端的舊狀態，重新整理即可。
（使用者一度以為是正式區，實際上正式區確實還停在 1 個月 —— 那是刻意沒動。）

### 但查這件事的時候撞到一個真的 bug

`syncFundamental` 是**整份重建** `FundamentalFile` 物件，而 dev.2 新增的
`revenueBackfilledThrough` **沒有被帶過去**。後果：

- 每個交易日的第一輪批次會把回補進度抹掉（後續輪次因
  `existing.dataDate >= targetDate` 而跳過，所以一天只掉一次）。
- 隔天 `backfillRevenue` 看到 `through = null`，又把 12 個月重走一遍
  —— 每天多 24 次對外抓取與 5 次 Storage 寫入。
- **dev.2 宣稱的「補滿之後零成本」形同虛設。**

還沒發作只是因為今天的批次還沒跑到（cron 16:00 才啟動）。

### 修法：把建檔抽成純函式

不只補上那一行，而是把整個 `FundamentalFile` 的組裝與 `notes` 判斷抽成
`twFundamental.ts` 的 `buildFundamentalFile()`。理由是**同一類錯誤已經出現兩次**：

- dev.1：`backfillRevenue` 用長度判斷有沒有變化（cap 砍掉最舊一筆時會漏寫）。
- dev.3：整份重建時漏帶欄位。

兩者都在 `index.ts`，而 `index.ts` **既不在 `tsc -b` 的涵蓋範圍**（`tsconfig.app.json`
的 `include` 只有 `src`），本機也沒有 deno 可以 `deno check`，更沒有任何測試碰得到。
抽出來之後這兩類錯誤都有測試鎖住（新增 7 筆，含「回補進度必須帶過去」）。

### 驗證

- 閘門：lint / build / **389 tests** 全綠。
- 測試區重新部署後打 `backfill-revenue`：`filled: 0, months: []`，1910ms 短路。
- 五檔資料完好：四家公司各 12 個月、`through = 2025-07`；0050 為 ETF 已收斂。

### 教訓（與 dev.2 同一條，這次更明確）

**`index.ts` 是這個專案唯一沒有任何自動檢查的檔案。**
它綁死 Deno 與 Supabase client，`tsc` 收不到、vitest 也跑不動。
往後只要是「有判斷」或「組裝有多個欄位的物件」的程式碼，
一律放進 sibling 純函式模組；`index.ts` 只留 fetch / upload 的膠水。

---

## 📅 Log: 2026-07-28 10:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.4-dev.2 —— 修 dev.1 在測試區實測到的死結；測試區驗證通過
- **Status**: COMPLETED（測試區）

### 部署測試區時先撞到的另一件事：cron 被 schema.sql 打回佔位符

部署前稽核發現測試區的 **兩個 cron job（`stock-report-nightly` / `source-probe`）
的 url 與密鑰都是未替換的字面值** `<PROJECT_REF>` / `<CRON_SECRET>`。

成因：為了套用本次新增的 `ALTER TABLE batch_run_log … revenue_backfilled`
而**整份重跑了 `schema.sql`**，而 §6c 用的是 `unschedule + schedule`、
**會整段重寫 command** —— 這正是 `schema.sql:241` 那段警告寫的事，只是這次是
從另一個方向踩到：不是新裝，是為了別的目的重跑整份檔案。

**失敗是無聲的**：`<PROJECT_REF>.supabase.co` 連 DNS 都解不出來，
`net._http_response` 連一筆失敗紀錄都沒有；`batch_run_log` 停在前一天 23:45
看起來很正常（cron 只跑 16:00–23:45，當時是上午）。若沒有在部署前稽核，
會在當晚 16:00 才發現整晚全空。

修法用 `cron.alter_job` + `replace` 只換掉那兩個字串，不重寫整段 command。
覆驗：ref = `wqetxuhncvfidqnklyew`（自己）、密鑰長度 48（不是佔位符的 13）。

> **給後續 Agent 的規則**：`schema.sql` 不是冪等的。要套用新的 `ALTER TABLE`
> 就**只跑那幾行**，不要整份貼進 SQL Editor。整份重跑必定重建 cron job。

### dev.1 的死結：ETF 把整批回補卡住

測試區部署後實跑，第 1 輪正常（補 4 個月、5 檔寫了 4 檔），
但**第 2、3、4 輪都回同樣的 `2026-03`～`2026-06` 且 `filled: 0`** —— 永遠不前進。

根因：`planRevenueBackfill` 把缺口定義成「檔案裡沒有的月份」，取所有標的的聯集。
測試區的 `0050` 是 ETF、不在 `t21sc03` 內，它的缺口**永遠填不滿**，
於是最新那幾個月被永久釘在待抓清單上，`2330` 這些真正的公司就再也拿不到更舊的月份。

**我少記了一件事：「這個月份已經找過了，就是沒有」。**
缺口不該是「檔案裡沒有的月份」，而是「**還沒去找過**的月份」。

修法：`FundamentalFile` 新增 `revenueBackfilledThrough`（最舊的已嘗試月份），
`planRevenueBackfill` 只把「比 `through` 更舊」的月份算成缺口，
並新增 `nextBackfilledThrough()` 推進進度。兩個配套細節：

- **「已嘗試」的判準是抓取成功，不是有沒有找到我們要的代號。**
  全是 ETF 時 `merged` 必然是空的，用有無資料判斷會讓 `through` 永遠推不動。
- **即使一筆資料都沒找到也要寫檔**，否則 ETF 的 `through` 存不下來、下輪照樣重問。

### 測試區驗證結果（2026-07-28 10:2x）

重新部署後連打 5 次：

| 輪 | months | filled | duration |
| - | --- | - | --- |
| 1 | 2026-03…06 | 5 | 11830ms |
| 2 | 2025-11…2026-02 | 5 | 4690ms |
| 3 | 2025-07…10 | 5 | 3693ms |
| 4 | （空） | 0 | **594ms** |
| 5 | （空） | 0 | **369ms** |

**3 輪補滿 12 個月，第 4 輪起短路**（幾百毫秒＝零對外請求），與設計一致。

Storage 覆驗（公開網址）：

| 代號 | 名稱 | 月數 | through | 範圍 |
| --- | --- | - | --- | --- |
| 1802 | 台玻 | 12 | 2025-07 | 2025-07～2026-06 |
| 2330 | 台積電 | 12 | 2025-07 | 2025-07～2026-06 |
| 2609 | 陽明 | 12 | 2025-07 | 2025-07～2026-06 |
| 8033 | 雷虎 | 12 | 2025-07 | 2025-07～2026-06 |
| 0050 | 元大台灣50 | 0 | 2025-07 | ETF，已收斂不再重問 |

**`fillGapsOnly` 確認生效**：2330 的 `2026-06` 月增仍是 `6.164589232380731`
（`t187ap05_L` 的完整精度），沒有被 MOPS 網頁上四捨五入的 `6.16` 蓋掉。
數列本身也自洽：`2026-05` 的 416,975,163 正是 6 月報表「上月營收」欄，
且 416,975,163 → 442,679,969 恰為 +6.16%。

### 教訓

- **「缺資料」有兩種，別混為一談**：沒去找過 vs 找過了就是沒有。
  只記錄「現在有什麼」而不記錄「找過什麼」，任何永遠填不滿的成員都會讓整批停擺。
  這個 bug 在單元測試裡看不出來 —— 測試餵的是理想的公司資料，
  **是部署到真實環境、資料裡真的有一檔 ETF 才浮出來的**。
- **部署前的稽核不是形式**：這次真正嚴重的問題（cron 被打回佔位符）
  跟本次要部署的功能毫無關係，是稽核順手撞到的。

### 待辦

- 正式區尚未動（未加欄位、未部署新函式）。要不要併 `main` 由使用者決定。
- 併 `main` 時記得：只跑 `ALTER TABLE` 那幾行，**不要整份重跑 `schema.sql`**（見上）。

---

## 📅 Log: 2026-07-28 10:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 月營收歷史回補（0.6.4-dev.1）
- **Status**: 實作完成、閘門全綠；待部署驗證

### 起因與先查清楚的事

使用者問「把今年度的月營收補齊，按照目前 DB 的資料會不會爆掉」。
**先量再答** —— 正式區唯讀實測（2026-07-28）：

| 項目 | 現況 |
| --- | --- |
| 全庫大小 | 15 MB |
| `chip_raw_cache` | 29 列 / 2.6 MB（`T187AP05_L` 單月 TOAST 壓縮後 148 KB，原始 603 KB） |
| Storage `reports/fundamental/` | 5 檔 / 1745 bytes |
| 淨持有台股 | **5 檔**（曾持有 26 檔） |

**容量差得很遠，不是問題。** 真正的阻礙是資料源：`t187ap05_L` 只回最新一個月、
端點不吃年月參數，`index.ts` 的 request body 也沒有年月欄位
（`MAX_BACKFILL_DAYS = 5` 那條回補是 T86 逐日籌碼，與月營收無關）。
所以「補齊」等於要接一個新來源，不是調個參數。

### 新來源與實測（2026-07-28）

```text
https://mopsov.twse.com.tw/nas/t21/sii/t21sc03_{民國年}_{月}_0.html   上市 ~450KB big5
https://mopsov.twse.com.tw/nas/t21/otc/t21sc03_{民國年}_{月}_0.html   上櫃 ~390KB big5
```

- **`mops.twse.com.tw` 的同一條路徑已 404**，必須用 `mopsov` 這台 host。
- 115_1 / 115_6 / 114_7 × sii / otc 六種組合全部 200。
- 版面兩者相同，欄位與現有 `RevenueMonth` 一一對應。代號實測全為 4 碼、兩份不重疊
  （上市 991 家 / 上櫃 860 家），故**毋需判斷某檔是上市還是上櫃**，兩份都抓再合成一張表。

### Completed Tasks

- [x] 新增 `twRevenueHistory.ts`（純函式、不觸網）：`mopsRevenueUrl` / `parseMopsRevenue` /
      `planRevenueBackfill` / `publishedMonths`。
- [x] `twFundamental.ts`：`mergeRevenueMonths` 第二參數改吃陣列，新增 `fillGapsOnly` 選項。
- [x] `index.ts`：`fetchBig5Text`、`backfillRevenue()`、`action: 'backfill-revenue'`，
      並掛進 `handleGenerateAll`（缺口為空就短路，補滿後零成本）。
- [x] `index.ts`：上櫃股 `notes` 由籠統一條改為**分項**。
- [x] `schema.sql`：`batch_run_log` 加 `revenue_backfilled INT`。
- [x] 文件：`PLAN.md` N5/N6 改寫、`SPEC.md`、`TASK.md` Task 27、
      `sources/supabase/README.md` 新增「月營收歷史回補」段。
- [x] 版號 `0.6.4-dev.1`（`package.json` / `package-lock.json` / `version.ts` / `README.md`）。
- [x] 閘門：`npm run lint`（僅 3 個既有 warning）/ `npm run build` / **376 tests 全綠**。

### 驗證方式與結果

單元測試 17 筆（fixture 逐字取自真實回應，含大寫 `<Td>`、`&nbsp;`、不規則空白）。
另以一支**用完即刪**的端到端測試真的打網路跑過整條路徑：

- 22 次實抓（11 個月 × 上市/上櫃）全部 200，`new TextDecoder('big5')` 解碼正常。
- **交叉驗證**：由 5 月報表解析出的 2330 當月營收 `416,975,163`，
  等於 6 月報表「上月營收」欄的值；6488 同法為 `4,842,007`。
  兩份獨立 HTML 對得起來 —— 這才證明抓到的是真資料，而不是空殼或快取。
- 模擬排程反覆呼叫：**3 輪補滿 12 個月**；既有的 2026-06 值未被覆蓋（`fillGapsOnly` 生效）。

### 三個設計決定與理由

1. **不寫 `chip_raw_cache`**。`pruneChipCache` 是 `ymd < cutoff`（8 碼日期）的字典序比較，
   任何月份鍵（`'2026-06'`）都比它小、**每輪都會被刪掉**，快取等於白寫。
   `fundamental/*.json` 本身就是快取：某月補進所有檔之後就不會再被請求。
2. **單次上限 4 個月**（`MAX_BACKFILL_MONTHS`）。理由同 `MAX_BACKFILL_DAYS = 5` ——
   Edge Function 的執行時間上限才是這條路徑最緊的一條線，不是資料量。
3. **只填缺口不覆蓋**。月營收會更正重發；讓一份較舊的爬取蓋掉 `t187ap05_L` 的更正後數字，
   等於補歷史反而弄髒現況，是最不划算的交換。

### 實作過程中自己抓到的一個 bug

`backfillRevenue` 原本用「合併前後**長度**相同就跳過寫檔」判斷有沒有變化。
這在「檔案已有 12 筆、補進一個更新的月份」時會出錯：cap 砍掉最舊一筆後長度仍是 12，
內容卻變了，於是真正的更新被當成沒事發生而不寫檔。改為**比對月份清單**。

### 教訓

- **`index.ts` 不在任何型別檢查的涵蓋範圍內**：`npm run build` 的 `tsc -b` 只收 `src/`，
  本機也沒有 deno 可以 `deno check`。所以有判斷的邏輯要**抽進 sibling 純函式模組**
  才測得到（`planRevenueBackfill` 就是為此抽出來的），留在 `index.ts` 的只能靠人眼複查。
- **註記不能寫成假話**：`valuation` 為 null 有兩種成因 —— 「這檔不在估值檔涵蓋範圍」
  與「這輪抓取失敗」。只有前者才能說「只涵蓋上市」，所以那條註記加了 `bwibbu` 非 null 的前提。

### 待辦（部署前請使用者確認，§13.2）

1. 兩區跑 `schema.sql` 的 `ALTER TABLE batch_run_log ADD COLUMN … revenue_backfilled`。
2. 部署 `stock-report`，**`--no-verify-jwt` 不可省**（§13.3）。
3. 手動打一次 `{"action":"backfill-revenue"}` —— **需 `CRON_SECRET` 明文，Agent 拿不到**。
4. 由公開 Storage URL 覆驗 `fundamental/{ticker}.json` 的 `revenueMonths` 長度為 12。

---

## 📅 Log: 2026-07-27 20:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.1 兩區上線並驗證；個股分析頁切回前景自動換新報告 (0.6.2)
- **Status**: 0.6.1/0.6.2 兩區皆已上線並線上驗證通過（**352 tests**）

### 0.6.1 上線結果

| | 正式區 `kxnxadaghidwumqsqneu` | 測試區 `wqetxuhncvfidqnklyew` |
| --- | --- | --- |
| `stock-report` | v10 | v14 |
| `verify_jwt` | false ✅ | false ✅ |
| `batch_run_log` | 26 欄 | 26 欄 |
| cron | jobid 11 / `*/15 8-15 * * 1-5` / url 自己 / `a7a6` | jobid 8 / 同左 / url 自己 / `54cc` |

測試區 20:15 第一輪的實測資料，形狀完全符合設計：

```
taipei_time=20:15  data_ymd=20260727  t86_today=true
t86_unchanged=0  t86_frozen=false   ← 第一次抓到，還沒定稿（要再兩輪相同）
margin_today=false                  ← 融資融券約 21:00 才到 → 不會短路，正確
borrow_data_date=2026-07-27  bwibbu_date=1150724  ← 估值檔還是上週五的
runs_today=1  skipped=false  regenerated=true  generated=5  duration_ms=15361
```

`bwibbu_date` 這欄第一天就發揮作用：它說明**基本面的資料日與籌碼的資料日不同步**，
而這件事原本只能靠猜。

### 我犯的錯：`db query` 打進了另一個專案

19:52 那次「重建測試區 cron」實際寫進了**正式區** —— `functions download` 把 cwd 留在
scratchpad，之後的 `db query --linked` 在那個沒有 link 設定的目錄下執行，CLI 退回全域設定。

**最惡劣的是它驗得過**：緊接著的覆驗查詢也在同一個錯的資料庫，
所以「url 是 wqetx、排程 `*/15`」看起來全部正確，其實是正式區被改成指向測試區。
19:53 改正式區時覆蓋掉了，期間無 cron 觸發，**無實害**，但這是運氣不是設計。

對策已寫進 `CLAUDE.md §13.3`：**任何會寫入的 `db query`，把「專案身分欄位」放進同一次查詢**
（例：`(SELECT count(*) FROM batch_run_log)`，正式區 2 / 測試區 0）。
分兩次查（先驗身分、再寫入）擋不住 —— cwd 可能在兩次之間被別的指令改掉。

### 0.6.2：切回前景時自動換上最新報告

使用者回報測試區籌碼仍顯示 `2026-07-24 · 更新於 2026-07-25 12:02`。
對檔後確認**那正是舊檔 `20260724/2609.json` 的內容**，而今天的檔是好的
（`institutional.date=2026-07-27`、20:15 抓的）—— 問題在前端只在開頁抓一次。

三班制時代一天才更新 3 次，這個缺口還藏得住；改成 32 輪之後，
**報告會在使用者看著的當下更新**，缺口就浮出來了。這是輪詢改版的連帶影響，不是舊 bug。

作法與取捨見 `SPEC.md`「前端的重抓時機」。四個測試釘住：換過一份才替換、
`generatedAt` 沒變不動 state、切到背景不抓、查無時保留現有那份。

### 0.6.1 上線當晚就抓到的真 bug：T86 指紋永遠不穩定

「待觀察」的預期形狀當場被推翻。正式區 20:30–22:00 七輪的實測：

```
20:30 unchanged=0 regenerated=true   21:15 unchanged=1 regenerated=false
20:45 unchanged=0 regenerated=true   21:30 unchanged=0 regenerated=true
21:00 unchanged=0 regenerated=true   21:45 unchanged=0 regenerated=true
                                     22:00 unchanged=1 regenerated=false
```

`t86_unchanged` 在 0/1 之間跳、**到不了 2**，所以 `t86_frozen` 永遠 false、
`decideSkip` 永遠不短路。一天 32 輪全跑，三道閘門等於全廢。

**根因**：直接抓兩次 T86 端點比對（間隔 3 秒），檔案長度同為 194,959 位元組但**位元組不同**。
逐列比對後真相是：1334 列的**內容與集合完全相同，只有 7 列的順序換了** ——
末欄相同的那幾列之間，端點的排序不穩定。

`fingerprint` 是對 `JSON.stringify` 算的，順序一變指紋就變。

**修法**：新增 `t86Fingerprint()`，先把 `data` 各列 join 後排序，
只取 `date` / `total` / 排序後的列來算 —— 看語意，不看端點今天高興怎麼排。
其餘欄位（title / fields / notes / hints）刻意排除：它們是固定樣板，
而且快取走 Postgres jsonb，**jsonb 會重排物件的鍵**，算進去等於自找另一個不穩定來源。

以實際抓下來的兩份檔案覆驗：修正前位元組不同、修正後語意指紋相同。
另加 6 個測試釘住（含「真正的改寫仍測得出來」與「少一列」兩個反向案例）。

**教訓**：內容指紋若要拿來當「東西有沒有變」的判準，
**必須先正規化到語意層**。外部端點沒有義務保證序列化穩定 ——
這裡是列順序，jsonb 那邊是鍵順序，兩個獨立的來源，都會讓位元組比對失效。

### 線上驗證通過（23:00，正式區）

修復部署後四輪一路走完預期路徑，與修復前的 0/1 震盪形成對照：

```
22:15 u=0 frozen=false regen=true  8509ms  ← 換演算法，重新起算
22:30 u=1 frozen=false regen=false 8467ms
22:45 u=2 frozen=true  regen=false 7749ms  ← 定稿
23:00 u=2 frozen=true  skip=true/complete   753ms  ← 短路，零對外抓取
```

當日彙總：13 輪 / 1 次短路 / 6 次重產；短路平均 **753ms**、實跑平均 **10,025ms**。
T86 定稿 22:45、融資融券最早 21:00。

兩個要誠實記下來的偏差：

1. **我先前預估短路是「幾十毫秒」，實際 753ms。** 短路路徑仍有 3 次 Postgres 來回
   （`readLastRun` / `cachedDayDatasets` / `logBatchRun`）。省下的是對外抓取，不是 DB 往返。
2. **`t86_revisions=5` 今天不可信** —— 含修復前位元組雜訊灌進去的假改寫。
   第一個乾淨的數字要等明天。

### 基本面的日期對不上 —— 以及儀器本身是壞的（0.6.3）

使用者回報「技術面和基本面時間好像都不太對」。查證結果：

- **技術面正確**。四檔 `daily/*.json` 的 `lastDate` 都是 `2026-07-27`。
  2330 的「更新於 15:28」與其他檔的 20:15 不同，是因為跳過條件
  （`lastDate >= 本次資料日` 就不重抓）—— 標示誠實，只是同頁不一致，讀起來像壞掉。
- **基本面的檔案在說謊**：`fundamental/2330.json` 的 `dataDate = 2026-07-27`，
  而 `valuation.dataDate = 2026-07-24`。UI 顯示的是後者（誠實），但檔案本身宣稱今天。
  成因是 `syncFundamental` 寫死 `dataDate: dashDate(dataYmd)` —— 又是
  **拿「我們去問的時間」當「資料的時間」**，今晚第四次同一種錯（BUG-002/003/004 皆是）。
  連帶：跳過條件用它，所以第一輪寫完就整天不再更新；`readLatest` 也用同一個鍵，
  導致同一份 116KB payload 同時存在 `20260724` 與 `20260727` 兩個 key 下。

**但真正的問題是：我們沒有能力判斷該怎麼修。** TWSE 到 23:15 仍只有 07-24 的估值，
而「BWIBBU 是當天深夜才發布，還是本來就 T+1」這件事**手上沒有任何可信資料**。

更糟的是查下去發現**儀器本身是壞的**：`batch_run_log.bwibbu_date` 那 12 個
`1150724` 不是 12 次觀測，是同一次被讀了 12 遍（吃快取），短路後三輪更是空白。
照這樣跑，明天會再產生 32 個一樣的假資料。

**所以先修儀器，不修行為**（使用者同意「讓它跑完完整的一天，但要有辦法記錄差異」）：
新增 `source_probe_log` ＋ `action: 'probe'` ＋ 專屬 cron job，每 15 分鐘對
BWIBBU 與借券各看一眼，記下自報日期與內容指紋。
**刻意不碰批次** —— 今晚才驗證過的「短路＝零對外請求」必須保持可證。
設計與取捨見 `SPEC.md`「資料源探針」。

明天拿到資料再決定基本面怎麼修：若估值當天深夜會更新，就值得持續探並修好標示；
若本來就 T+1，追它沒意義，只要把 `dataDate` 改成誠實的日期、順手修掉快取重複存。

### 待觀察（明天 2026-07-28，第一個完整的 32 輪日）

```sql
SELECT taipei_time, t86_today, t86_unchanged, t86_frozen,
       margin_today, skipped, skip_reason, regenerated, duration_ms
FROM batch_run_log WHERE taipei_ymd = '20260727' ORDER BY id;
```

今天只從 20:30 起在新排程下跑了 13 輪，明天才是第一個 16:00–23:45 的完整 32 輪日。要看：

1. **16:00–17:00 那幾輪**（T86 尚未發布）的行為。今天沒有涵蓋到這段 ——
   `t86Today=false` 時 `nextT86State` 回 null、狀態不推進，理論上正確但沒有實測過。
2. **一整天的短路比率**。定稿後到 23:45 之間應該全是 `skipped`，
   若不是，代表定稿又被解凍（`t86_revisions` 會顯示）。
3. **第一個乾淨的 `t86_revisions`** —— T86 一天到底真的被改寫幾次，
   這是整個輪詢改版最初想回答的問題。

---

## 📅 Log: 2026-07-27 19:52:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 測試區套用 0.6.1；BUG-003 根因查明
- **Status**: 測試區 2/3 完成；正式區未動
- **授權範圍**: 使用者明確授權操作正式區與測試區的 Supabase

### BUG-003 根因：測試區的 cron 打的是正式區的端點

查測試區 `cron.job`：

| 欄位 | 值 |
| --- | --- |
| url | `https://kxnxadaghidwumqsqneu.supabase.co/...` ← **正式區的 ref** |
| 密鑰 | 43 碼（`Qea5…wvro`），非佔位符 |
| `net._http_response` | 09:30:00Z（台北 17:30）→ **401 Unauthorized** |

**測試區的排程從來不是在呼叫自己的函式。** 這是 BUG-002 的變種：
同一顆「§6c 需人工替換的佔位符」地雷，只是這次不是忘了換，
而是**換成了另一個環境的值**（推測 14:04 修復時複製了正式區的 SQL）。

值得警惕的是：同一組 URL＋密鑰在 08:04:43Z（台北 16:04）**還回 200**，
是正式區後來重設 `CRON_SECRET` 才變成 401。也就是說在那之前，
**測試區的資料庫有能力觸發正式區的批次** —— 這比「測試區沒資料」嚴重。
BUG-002 的偵測 SQL 只看「密鑰長度是不是 13」，抓不到這種，已在 §6d 補上
「url 的 project ref 必須是自己」這條。

### 測試區已完成

- [x] `batch_run_log` 補 12 個新欄位＋`(taipei_ymd, id DESC)` 索引 → 共 26 欄
      （原本 14 欄、0 列資料，因為從來沒跑成功過）
- [x] `stock-report` 部署 **v14**、`--no-verify-jwt`（`verify_jwt=false` 確認未被改動）
- [x] `functions download` 逐檔 diff：僅 `*.test.ts` 不在線上（本來就不上傳），
      `pollPlan.ts` 等原始碼全部一致
- [ ] **cron job 重建** —— 卡在沒有測試區 `CRON_SECRET` 明文（`secrets list` 只回雜湊，
      §13.3）。`supabase secrets set` 也被權限規則擋下。需使用者提供或重設。

### 正式區：刻意不動

依 §13.1 dev 先行。0.6.1 只在 `dev`，正式區的基準是 `main`。
**特別危險的是排程**：若只把正式區 cron 改成 `*/15` 而程式碼仍是 0.6.0，
等於一天 32 次**沒有任何閘門**的全跑 —— 三道閘門全在 0.6.1 的程式碼裡。
正確順序是 dev 驗證一晚 → 併 main → 正式區照「ALTER → deploy → alter_job」三步走。

---

## 📅 Log: 2026-07-27 19:30:47 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後批次由三班制改為 15 分鐘輪詢（0.6.1-dev.1）；順帶驗收 BUG-002
- **Status**: 本地完成 —— lint（3 個既有 warning）／test **342 passed**（+17）／build 全綠。
  **尚未部署任何環境，cron 也還沒改**（§13.2：對外操作需明確指示）

### BUG-002 修復驗證通過（正式區）

上一則留的「待驗證：今晚 17:30 那班」現在有答案了。正式區讀庫查證（唯讀，`db query --linked`）：

| 證據 | 值 |
| --- | --- |
| `manifest.json` `generatedAt` | `2026-07-27T09:46:47Z` ← 基準值 `08:04:50Z`，**已推進** |
| `batch_run_log` | 兩列：`17:30`（cron）與 `17:46`，皆 `t86_today=true`、`generated=5` |
| `cron.job` | `active=true`、`schedule='30 9,14,15 * * 1-5'` |

**cron 通了、`batch_run_log` 寫得進去、正式區三件事全部到位。** BUG-002 可結案。

順帶推翻一條舊認知：**17:30 就拿得到當天的 T86**（`t86_today=true`、`data_ymd=20260727`）。
`schema.sql` 原註解寫的「15:00–15:30」與 15:42 實測「還沒有」都不對，真實區間在兩者之間。

**測試區則沒跑**：`manifest.json` 仍停在 `06:03:54Z`、`ymd=20260724`（上週五）。
測試區的佔位符是 14:04 修的，理應同樣生效卻沒有 —— **待查**（見 BUG_FIX.md BUG-003）。
未再深入是因為要查得 `supabase link` 到測試區，而 link 有全域副作用（§13.3），
會把使用者目前 link 著的正式區清掉，不宜擅自為之。

### 為什麼把三班改成輪詢

「幾點公布」這個認知在 2026-07-27 一天之內被實測推翻**三次**：

| 註解寫的 | 實測 |
| --- | --- |
| T86 約 15:00–15:30 | 15:42 仍未發布；17:02 已有（15:00–15:30 其實是 BFI82U 大盤買賣金額統計表的時間窗，兩份報表被混為一談） |
| 借券約 21:00–22:30 | 17:07 就有當天的了 |
| 抓的是「借券賣出餘額」 | 實際抓的 TWT96U 是「當日可借券賣出股數」，語意根本不同 |

三次都錯在同一個地方：**用時鐘去猜一件我們沒有觀測資料的事**。
再挪一次班次只是換一個猜法。所以改成 **16:00–23:45 每 15 分鐘輪詢（32 輪）＋看內容判斷**，
並把「它幾點到的」記進 `batch_run_log`，讓下一次調整有事實可依。

還有一個獨立的理由：使用者指出 T86 **自 16:00 起每 15 分鐘更新一次**。
這直接推翻舊的 `loadT86`（當天第一次抓到就快取、之後永不更新）——
**早抓會把初版鎖成當天的答案，比晚抓一次還糟**。不做改寫偵測就不能提早抓。

### 三道閘門讓 32 輪不等於 32 倍成本

判斷邏輯全抽到新檔 `pollPlan.ts`（129 行）並以 17 個測試釘住。
**為什麼一定要獨立成檔**：`index.ts` 在模組載入時就呼叫 `Deno.serve`，vitest 匯入不了，
寫在那裡的判斷等於沒有測試 —— 而判斷寫錯的代價已從三班時代的 3 倍變成 32 倍。

1. **短路** `decideSkip`：今天 T86 已到**且已定稿**、且今天融資融券已到 → 一個對外請求都不發。
   條件必須含融資融券，否則 17:00 就收工，當天約 21:00 才發布的那份永遠抓不到。
2. **T86 改寫偵測** `nextT86State`：定稿前每輪重抓比對指紋，連續 2 次相同才凍結。
   指紋是「長度＋djb2」，刻意含內容雜湊 —— T86 被改寫的真實形態是**筆數不變、
   某幾檔的數字被更正**，只比長度或筆數會漏掉。
3. **當日上限** `MAX_RUNS_PER_DAY = 40`：cron 只排 32，正常碰不到。它防的是
   自己的判斷邏輯出錯（0.3.9 燒光額度正是這個形狀）與 `CRON_SECRET` 外流。

另外兩個省法：
- **重產閘門** `runSignature`：輸入沒變就不重產報告。省的不是空間（5 檔 × 5KB），
  是讓 `generatedAt` 只在真有變動時才跳，否則 32 輪會把「什麼時候變的」這個訊號洗掉。
- **借券快取** `loadBorrow(minYmd)`：該端點沒有 date 參數，原本每次執行都無條件重抓 244KB。
  三班時代是一天 3 次，32 輪就是一天 7.8MB 純浪費。已有「日期 ≥ 今天」的快取就直接用
  （rwd 版 title 自帶的日期是下一個交易日，所以 `>= 今天` 正是我們要的那份）。

實測位元組（2026-07-27）：T86 194KB／融資融券 128KB／借券 244KB／估值 116KB／
月營收 603KB／公司資料 1.32MB。每天實際對外抓取約 **8.7MB**；
Function 呼叫 **704 次/月**，免費額度 500,000，佔 0.14%。

### 跨輪次狀態放在觀測表，不另建表

`readLastRun` 從 `batch_run_log` 今天的最後一列取回 `runs_today` 與 T86 狀態。
這些欄位**本來就是我們想觀測的東西**（改寫幾次、什麼時候定稿），沒必要為同一份資料再建一張表。
代價是它變成半承載狀態：`logBatchRun` 刻意吞例外，寫入失敗時下一輪會當成當天第一次跑，
於是重抓一次 T86 並重新計數 —— **多做事而不是做錯事**，可接受，但別把這個特性忘了。

### 一個當場抓到的錯（靠實測資料，不是靠讀程式碼）

`margin_today` 原本寫成 `cachedToday.has(...) || (!series.marginDatedFailed && t86Today)`。
查正式區 17:46 那筆時發現 `margin_ok=true`，但 `chip_raw_cache` 裡今天的 `MI_MARGN_D`
**根本不存在**（只有 20260724 那份）——`margin_ok` 問的是「有沒有任何一天抓成功」，
不是「今天的到了沒」，拿它當備援會把整欄污染成恆真。
改為在批次跑完後重讀一次快取（`cachedAfter`），只認今天的那筆。
**這欄正是用來回答「融資融券幾點到」的，寫錯等於這次改版白做。**

### 異動範圍

- 新增：`supabase/functions/stock-report/pollPlan.ts` + `pollPlan.test.ts`（17 tests）
- 修改：`stock-report/index.ts`（`loadT86` refresh 模式、`loadBorrow` 快取、
  `readLastRun`、`handleGenerateAll` 短路與重產閘門、`syncFundamental` 回傳 `bwibbuDate`）
- 修改：`supabase/schema.sql` §6c 改排程 `*/15 8-15 * * 1-5`、新增 §6d 佔位符覆驗查詢、
  §7 以 `ADD COLUMN IF NOT EXISTS` 補 12 個欄位＋`(taipei_ymd, id DESC)` 索引
- 文件：`SPEC.md`（新增「盤後批次排程」節）、`supabase/README.md`、`README.md` 版本紀錄
- 版號三處 → `0.6.1-dev.1`

### 待辦（需使用者明確指示，§13.2）

1. **兩區重跑 `schema.sql` §7 的 ALTER**（12 個新欄位）—— 不加欄位就部署新程式碼的話，
   `logBatchRun` 會整列寫入失敗（它吞例外，所以是**無聲**的），跨輪次狀態也就永遠讀不回來，
   等於三道閘門全部失效、每輪都全跑。**順序必須是先 ALTER 再部署。**
2. **兩區部署 `stock-report`**，一定要帶 `--no-verify-jwt`（§13.3）。
3. **改 cron 排程**：用 `cron.alter_job` 而不是重跑 §6c 的 schedule ——
   後者會重寫整段 command，等於再踩一次 BUG-002 的佔位符地雷。
   ```sql
   SELECT cron.alter_job(jobid, schedule := '*/15 8-15 * * 1-5')
   FROM cron.job WHERE jobname = 'stock-report-nightly';
   ```
4. 測試區 cron 為何沒跑（BUG-003）。
5. 上一則提的安全建議仍然成立：正式區 `CRON_SECRET` 是 8 碼可猜字串，
   而 `generate-all` 的授權完全靠它。輪詢改版後端點被打的價值更高，建議改成隨機長字串。

---

## 📅 Log: 2026-07-27 16:38:10 Asia/Taipei

- **Agent**: Claude
- **Action**: 稽核 0.6.0 定版後的兩區實際狀態，補上中斷處的缺口
- **Status**: 部署已補齊並驗證；**正式區 `batch_run_log` 建表待使用者在 SQL Editor 執行**
- **授權範圍**: 使用者明確授權三項對外操作（測試區 `stock-report` 重部署、正式區
  `stock-price` 重部署、正式區建表）

### 稽核發現：一組會互相掩蓋的交叉錯配

0.6.0 定版後的部署在正式區做到一半中斷，留下的狀態是**兩區各缺對方有的那一半**：

| 項目 | 正式區 `kxnxadaghidwumqsqneu` | 測試區 `wqetxuhncvfidqnklyew` |
| --- | --- | --- |
| `stock-report` 程式碼 | ✅ v7（16:02 部署）與 main 逐檔一致 | ❌ v12 落後，缺 `logBatchRun` / `taipeiHhmm` |
| `batch_run_log`（§7） | ❌ **不存在**（REST 回 PGRST205） | ✅ 存在 |
| `app_settings`（§4.1） | ✅ | ✅ |
| `CRON_SECRET` | ✅ 16:03:55 設定 | ✅ |
| 批次產出 | ✅ 16:04 完成，0050 / 2609 / 1802 的籌碼＋日線＋基本面＋新聞皆 200 | ✅ |

**兩邊都不會報錯**，所以不主動查就看不出來：正式區有寫入程式碼但沒有表，
而 `logBatchRun` 刻意吞掉例外（觀測失敗不能拖垮批次）；測試區有表但沒有寫入程式碼。
這正是「觀測資料寫入失敗要靜默」這個正確設計的副作用 —— 它同時也讓漏套 schema 變得無聲。
**教訓：凡是刻意靜默的寫入路徑，上線後要有一次獨立的存在性檢查，不能等它自己喊。**

另外 `stock-price` 在正式區落後一行過時註解（`build-docs/supabase_schema.sql`），
是 2026-07-20 舊部署的殘留，功能無異，順手一併重部署。

### 稽核方法（可重複）

- 程式碼：`supabase functions download <slug> --project-ref <ref>` 後 `diff -r`，
  **不看版本號推論**（§13.3）。正式區比 `main`、測試區比 `dev`（本次兩者同 commit）。
- 資料表存在性：用**公開 anon key** 打 REST。缺表回 `PGRST205 / 404`，
  有表但被 RLS 擋回 `200 []` —— 兩者可區分，足以判斷 schema 有沒有套。
  正式區的 anon key 直接取自 GitHub Pages 的 bundle（本來就是公開資訊）。
- 產出檔：公開 bucket 逐個 HTTP 探測 `20260724/<t>.json`、`daily|fundamental|news/<t>.json`。
  （`object/list` 需要 policy，anon 一律回 `[]`，不能拿來判斷「沒有檔案」。）

### 已完成

- [x] 測試區 `stock-report` 重部署 → v13，`--no-verify-jwt`（`verify_jwt` 仍為 false）
- [x] 正式區 `stock-price` 重部署 → v9，用預設（`verify_jwt` 仍為 true）
- [x] 兩支重新下載逐檔 diff，皆與分支程式碼一致
- [x] 本地閘門：lint 3 個既有 warning / test **325 passed** / build 通過

### 正式區 SQL（使用者執行，16:40–16:55）

- [x] **建 `batch_run_log`**（§7）。覆驗：REST 由 `PGRST205 / 404` 變成 `200 []`
      —— 有表，且 RLS 擋住 anon 讀取，與「只由 service role 寫入、不建 policy」的設計相符。
- [x] **修好 cron 的佔位符故障** —— 詳見 FIXED_BUG.md **BUG-002**。
      診斷發現密鑰是字面值 `<CRON_SECRET>`（長度 13），亦即**正式區的盤後批次從來沒靠
      cron 跑起來過**，過去所有報告都是手動觸發的產物。這與測試區 14:04 修掉的是同一顆地雷
      —— 兩區各自套 schema，修好一邊不會連帶修好另一邊。
      修後覆驗：`active=true`、URL 正確、密鑰長度不再是 13。

### 待驗證（今晚 17:30 那班）

修復是否真的生效，只能看批次跑起來沒有。**基準值（2026-07-27 16:49 記錄）**：

| 區 | `manifest.json` 的 `generatedAt` |
| --- | --- |
| 正式區 | `2026-07-27T08:04:50.805Z`（＝台北 16:04，手動觸發那次） |
| 測試區 | `2026-07-27T06:03:54.938Z` |

17:30 之後這兩個值若往前推進，就代表 cron 通了；`batch_run_log` 也應各寫下第一列
（測試區驗證的是新部署的 v13 寫入路徑，正式區驗證的是新建的表）。

註：`secrets list` 回的是雜湊，且**不是裸 sha256**（實測 `sha256('明文')` 對不上），
所以無法用它離線驗證密鑰是否一致 —— 別把「雜湊對不上」當成密鑰錯誤的證據。

### 安全備註

正式區 `CRON_SECRET` 目前是 8 碼的可猜字串，而 `stock-report` 以 `--no-verify-jwt` 部署、
網址就在公開 bundle 裡 —— 授權完全靠這一個 header。`generate-all` 不吃白名單保護
（`generate` / `warm` 才有 `heldTwTickers` 把關），被猜中即可反覆觸發對 TWSE 的抓取。
0.3.9 燒光額度的前例值得參考。建議今晚確認批次跑通之後，改成隨機長字串並同步更新
secret 與 cron job 兩處。

---

## 📅 Log: 2026-07-27 15:57:19 Asia/Taipei

- **Agent**: Claude
- **Action**: 新增 `batch_run_log`；0.6.0 定版
- **Status**: 閘門全綠（325 tests）

### 為什麼要加 batch_run_log

排程時段的認知被證明是錯的：`schema.sql` §6c 註解寫「三大法人個股買賣超 (T86)
約 15:00–15:30」，但 2026-07-27 15:42 實測 T86 仍未發布，**同一時間 BFI82U
（大盤買賣金額統計表）已經有資料**。兩份報表被混為一談 —— 15:00–15:30 是大盤統計表的
時間窗，而我們實際在抓的個股日報要更晚（使用者提供的資料指向 16:00–17:00）。

要微調時段就需要「那一班跑的時候，當天資料到了沒」這個事實，而現有的東西都答不出來：

- `net._http_response` 只保留 6 小時
- `chip_raw_cache.updated_at` 只記「成功抓到的時間」，不記「試了但還沒發布」

故新增 `batch_run_log`（schema §7），每次 `generate-all` 寫一列。
關鍵欄位是 **`t86_today`**（`data_ymd === 執行當天的台北日期`），微調時段時看的就是它。
寫入失敗完全不影響批次 —— 這是觀測資料，不是產出。

查詢方式（累積幾天後再看）：

```sql
SELECT taipei_time, count(*) AS 跑了幾次,
       count(*) FILTER (WHERE t86_today) AS 拿到當天T86
FROM batch_run_log GROUP BY taipei_time ORDER BY taipei_time;
```

### 尚未決定：要不要加第四班

使用者問「改成四班如何」。評估結論（成本可忽略：4 班 × 22 交易日 = 88 次 invocation／月）：

**應該「加一班」而不是「挪一班」**。17:30 那班即使拿不到 T86 也不是白跑——
台股 13:30 收盤，Yahoo 日線這時早就有今天的 K 棒，`syncDaily` / `syncFundamental` /
`syncNews`（當天只抓一次，就是這班抓的）三件事都在這班完成。往後挪會連帶延後這三樣。

建議時段 `30 9,10,14,15 * * 1-5`（台北 17:30 / **18:30** / 22:30 / 23:30），
把最壞情況的延遲從 5 小時（等 22:30）縮短為 1 小時。**決定前先看 batch_run_log 的實測資料。**

另有一個未驗證的疑慮：使用者提供的資料指出官方檔案在 18:00（不含鉅額）與 20:00（含鉅額）
各產一次。若網頁版 T86 也跟著更新，18:30 抓到的可能不含鉅額——那影響的是**數字正確性**
而不只是有無。網頁端點與付費檔案是兩套發布管道，需實測比對同日 18:30 與 20:30 的數字才知道。

---

## 📅 Log: 2026-07-27 15:30:18 Asia/Taipei

- **Agent**: Claude
- **Action**: 新增 `warm` action —— 技術面與基本面即點即產
- **Status**: VERIFIED — lint / test 325 passed（+8）/ build 全綠；測試區已部署並實測

### 起因

使用者問「全新的股票是不是就不會產出基本面」。追下去確認：`heldTwTickers()` 是動態掃
`transactions`，新股票**會**被納入，但要等下一班批次（平日 17:30 / 22:30 / 23:30）。
在那之前三個分頁的行為並不一致：

- 籌碼：**立刻有**（`fetchStoredReport` 查無時 fallback 到 `generate` 即點即產）
- 技術面 / 基本面：空狀態，等批次
- AI 解讀：**直接失敗**——`AiTab` 硬性依賴日線，拿不到就 throw，不是降級

### 設計：為什麼這樣做不會重演 0.3.9

0.3.9 燒光額度的成因是「無驗證的公開端點」＋「prune 單位錯配讓每晚做白工」，
不是正常使用量。新增 fallback 的風險評估與對策：

1. **沿用 `heldTwTickers()` 白名單**（與 `generate` 同一道防線）。函式以 `--no-verify-jwt`
   部署、網址就在公開 bundle 裡，這是把濫用上限壓到最低的關鍵。
2. **查無資料也要寫檔**——這是最重要的一條。`syncFundamental` 本來就會寫（null＋notes），
   但 `syncDaily` 原本是 `if (rows.length === 0) continue`、**什麼都不寫**。
   若直接加 fallback，一檔 Yahoo 查不到的股票會變成「每次開頁都重打、永遠不會停」。
   故新增 `DailyFile.emptyCheckedDate`：查無時寫空殼檔並記下查詢日。
3. **批次刻意不看 `emptyCheckedDate`**（仍以 `lastDate` 判斷），三班要留給剛上市、
   Yahoo 還沒補資料的代號重試的機會；只有即點即產路徑吃這個條件。
4. **前端節流**：`warmStock.ts` 以 `attempted` Set 確保同代號整個 session 只送一次，
   即使伺服器回「沒產出任何東西」也不重試；`inflight` Map 處理併發去重。
5. **不含新聞**：它只服務 AI 解讀，而 AI 缺新聞本來就能正常降級（prompt 有缺料文案），
   沒必要為它在開頁路徑上多付一次 10 秒逾時的 RSS 請求。

量級：每檔新股票一次性 2 次 invocation（免費約 500K/月），可忽略。

### 線上實測（測試區）

部署後直接打端點驗證，**不是只看單元測試**：

| 測試 | 結果 |
| --- | --- |
| 已賣光的代號 2338（net = 0） | HTTP 403 ✅ |
| 從未持有 9999 / 2317 | HTTP 403 ✅ |
| 格式不正確 `../etc` | HTTP 400 ✅ |
| 持股且資料已最新 2609 | `0/0` 跳過 ✅ |
| 持股但缺資料 2330 | `dailySynced:1, fundamentalSynced:1` ✅ |
| 2330 第二次呼叫 | `0/0` 不重複做事 ✅ |

**過程中的自我修正**：我原本預期 2330 會被 403 擋下（先前批次只產出 3 檔），
結果它成功產出。查 `transactions` 後確認 **2330 台積電淨持有 2000 股、確實在白名單內**
——是使用者在 14:00 批次跑完之後才加的，這正是他發問的來源。白名單沒有問題，是我的預期錯了。
教訓：驗證防護時要先確認「測試樣本真的屬於該被擋的那一類」，否則會誤判成功或失敗。

產出內容核對：2330 產業別「半導體業」、本益比 31.59、6 月營收 442,679,969 千元（年增 +67.87%）、
日線 242 根到 2026-07-27，與 TWSE 原始 API 一致。

### 待辦

- [ ] UI 實測：加一檔新股票後開技術面／基本面，應該當場就有資料。
- [x] 正式區已於 16:02–16:04 套用（函式、§4.1、CRON_SECRET、批次產出），
      2026-07-27 16:38 稽核確認；唯一缺口是 §7 `batch_run_log`，見該則紀錄。

---

## 📅 Log: 2026-07-27 14:32:04 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正 Gemini Flash 解讀被截斷；截斷不再靜默
- **Status**: IMPLEMENTED — lint / test 317 passed（+9）/ build 全綠

### 症狀與根因

使用者回報切到 Gemini Flash 後輸出被截斷，實例只有一句：
「元大台灣50（0050）於 2026 年 7 月 24 日收盤價為 101.7 元，下跌 2.2 元，跌幅」

根因有兩層，第二層是關鍵：

1. `aiClient.ts` 的 Google 請求把 `maxOutputTokens` 寫死 **1200**。0.6.0-dev.3/4 之後
   輸出要求變長（多了建議操作、注意事項兩小節，以及基本面與消息面的內容），1200 本來就偏緊。
2. **Gemini 2.5 起的「思考」（thinking）token 也計入 `maxOutputTokens`**
   （查證來源見下）。1200 額度幾乎被思考吃光，正文只剩幾十個字就被切斷 ——
   這解釋了為什麼斷點遠早於 1200 token 該有的長度。

### 修法

- `GOOGLE_MAX_OUTPUT_TOKENS = 8192`（上限不是預約量，調高不增加實際用量與費用）。
- `generationConfig.thinkingConfig = { thinkingBudget: 0 }` 關閉思考 ——
  這份工作的數字全由程式算好、prompt 又明令不得自行計算，模型只負責寫成白話，不需要推理。
- **模型不接受該參數（HTTP 400）時自動去掉重送一次。** 刻意不用模型名稱判斷支援度：
  各世代的控制欄位不同（2.5 用 thinkingBudget、3 改 thinkingLevel）且還會再變，
  寫死清單一定會過時。只退回一次，不會無限重試。
- **截斷不再靜默**：`extractGoogleText` 先前完全沒看 `finishReason`，半截文字會被當成
  完整結果回傳（就是使用者遇到的情況）。現在：有內容但 `MAX_TOKENS` → 保留文字並附上
  `TRUNCATION_NOTICE`（使用者已為它付費，丟掉更浪費）；完全沒有正文 → 拋錯並點明是
  思考吃光額度；`SAFETY` / `RECITATION` 各有專屬訊息。
- 同一類問題也存在於 OpenAI 相容路徑（`finish_reason: 'length'`，ollama 的 `num_predict`
  截斷會長一樣），一併補上。**未**替該路徑加 `max_tokens` —— 目前不設上限沒有問題，
  加了反而可能製造新的截斷。

### 查證

Google 官方文件頁當下抓不到（工具受限），改以社群與 SDK issue 佐證，多來源一致：
`thinking tokens are counted against maxOutputTokens`，額度不足時會出現
「`finishReason: MAX_TOKENS` 但 `content` 整個缺席」。相關討論：
googleapis/python-genai #2062、#782、google-gemini/gemini-cli #2104、
Google AI Developers Forum「Thinking ate all the tokens and hit MAX_TOKENS」。

### 待辦

- [ ] 使用者以 Gemini Flash 實測，確認解讀能完整寫到免責聲明那段。
- [ ] 若仍截斷（例如模型忽略 thinkingBudget），下一步是把 8192 再往上調，
      或在 UI 開放讓使用者自訂上限。

---

## 📅 Log: 2026-07-27 14:04:27 Asia/Taipei

- **Agent**: Claude
- **Action**: 測試區部署 0.6.0-dev.4/5 並線上驗證；修 2 個實測才發現的問題 + 1 個既有故障
- **Status**: VERIFIED — 測試區三檔持股（0050 / 1802 / 2609）的基本面與新聞皆已產出並核對正確
- **授權範圍**: 使用者明確授權「對 dev 都新增上去」→ **只動測試區**（`wqetxuhncvfidqnklyew`），正式區完全未觸碰

### 🔴 既有故障：測試區的夜間 cron 從來沒有真正跑起來過

觸發批次時噴 `invalid URL "https://<PROJECT_REF>.supabase.co/..."` ——
`cron.job.command` 裡是**字面的 `<PROJECT_REF>` 與 `<CRON_SECRET>` 佔位符**，當初建排程時沒代入真值。

佐證：`cron.job_run_details` **0 筆**；`net._http_response` 只有 7/26 15:09 一筆成功
（時間不對應排程三段，是手動觸發）；bucket 最新資料停在 `20260724/`。

**為什麼之前沒發現**：7/26 的稽核只查了 `active=true` 與 schedule 字串，沒看 command 內容。
**教訓**：查 cron 健康度必須看 command 本身（至少驗 `command NOT LIKE '%<PROJECT_REF>%'`），
`active=true` 完全不代表它跑得起來。

**修法**：`secrets list` 只回雜湊、拿不到舊密鑰明文，故由使用者執行一行指令產新 `CRON_SECRET`、
`secrets set` 後以真值重建排程（舊密鑰無任何東西在用，因為排程本來就是壞的）。
現況：`has_ref_placeholder=false / has_secret_placeholder=false / has_real_url=true / timeout=60000 / active=true`。

### 🔴 實測才發現的問題 1：新聞查詢撞名（已修，dev.5）

只用股票名稱查 Google News 會抓到完全無關的東西：**「陽明」回的 10 則全是陽明交通大學的校園新聞**
（教評會、國安疑慮…），與陽明海運（2609）毫無關係。這種內容餵進 AI 會產出離題的「消息面分析」。

改成 `{名稱} {代號}` 後實測三檔全部命中：`陽明 2609` / `台玻 1802` / `元大台灣50 0050` 各回 100 則正確結果。
台股名稱與機構、地名撞名太常見，**代號是唯一可靠的消歧依據**。

### 🟡 實測才發現的問題 2：ETF 被誤稱為上櫃股（已修，dev.5）

0050 三份 API 都查無 → 觸發缺料註記，但原文寫「可能為上櫃股票」。0050 是 **ETF** 不是上櫃股。
改為「查無公司基本面資料：ETF 與上櫃（TPEx）標的不在 TWSE 這三份資料中」。

### 線上驗證結果（測試區）

部署以 `functions download` 逐檔 diff 確認（§14.3 準則，不看版本號推論）：
`index.ts / twChips.ts / twDaily.ts / report.ts / twFundamental.ts / twNews.ts` 六檔與本機一致；
`stock-report` 的 `verify_jwt=false` 維持正確。

schema §4.1：`app_settings` 六欄位齊全、RLS 已啟用、單列 CHECK 在、三條 policy 正確
（SELECT 開放 authenticated、INSERT/UPDATE 限 `app_metadata.role='admin'`）、
`user_settings` 舊 `ai_*` 欄位剩 0 個。

批次產出（`fundamentalSynced: 3 / newsSynced: 3`，跳過條件二次觸發時正確生效）：

| 代號 | 產業別 | 本益比 / 殖利率 / 淨值比 | 6 月營收（千元） | 新聞 |
| --- | --- | --- | --- | --- |
| 1802 台玻 | 玻璃陶瓷 | 392.31 / — / 2.99 | 4,207,055（月增 +7.34% / 年增 +27.00%） | 10 則，皆命中 |
| 2609 陽明 | 航運業 | 16.72 / 3.88% / 0.55 | 16,591,195（月增 +9.85% / 年增 +20.18%） | 6 則，皆命中 |
| 0050 元大台灣50 | —（ETF） | — | — | 10 則 |

**交叉驗證**：台玻的新聞標題「6月營收42.07億元年增率高達27％」與我們解析出的
`4,207,055 千元 / +27.00%` 完全吻合，確認欄位對應與單位換算正確。

**Google News RSS 沒有被 Supabase 機房 IP 擋**（原本列為最大風險，實測三檔皆正常）。

### 操作備忘（下次會用到）

- `supabase db query --linked` 的輸出前面有一行 `Initialising login role...`，
  直接餵給 JSON parser 會炸，要先 `sed -n '/^{/,$p'`。
- `supabase storage ls/rm` 需要 `--experimental`；且 **`storage rm` 實測刪不掉**
  （回 `deleted: []` 且無錯誤）。要刪檔改用 Storage REST：
  `curl -X DELETE -H "Authorization: Bearer <service_role>" .../storage/v1/object/reports/<path>`，
  service key 可由 `supabase projects api-keys --reveal` 取得。
- 強制重產某類檔案時，刪掉 Storage 上的檔即可繞過跳過條件（fundamental 看 `dataDate`、news 看 `asOf` 的台北日曆日）。

### 待辦

- [ ] **使用者需登出再登入**：admin tag 是台北 11:31 貼的、最後登入是 10:32，
      目前手上的 JWT 還沒有 admin claim，AI 設定表單不會出現。
- [ ] 重新填一次 AI 設定（dev.2 的 schema 改版把舊的個人設定清掉了）。
- [ ] UI 實測：基本面分頁、產業別 badge、AI 解讀是否引用到基本面與消息面。
- [ ] 正式區未套用任何 dev.2–dev.5 的異動（schema §4.1、新版函式），併 main 時要一起處理。

---

## 📅 Log: 2026-07-27 11:25:16 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.0-dev.4 —— 基本面（估值＋月營收）、產業別、新聞入 AI
- **Status**: IMPLEMENTED — lint / test 307 passed（+13）/ build 全綠；線上部署待使用者

### 做了什麼

三項需求都沿用既有的「盤後批次 → Storage JSON → 前端直讀」管線，**無 DB schema 變更**
（`chip_raw_cache` 的 PK `(ymd, dataset)` 直接容納新 dataset key）。設計理由見 PLAN.md §N。

- **Edge Function**：新增純函式模組 `twFundamental.ts`（估值 / 月營收 / 產業別解析）與
  `twNews.ts`（Google News RSS regex 解析）；`index.ts` 加 `syncFundamental()` / `syncNews()`
  掛在 `handleGenerateAll` 的籌碼與 manifest 之後、prune 之前。
- **前端**：`fundamentalProxy.ts` / `newsProxy.ts`（照 dailyProxy 模板，schema 閘門一律 `>=`）；
  新增 `FundamentalTab.tsx`；`StockDetailPage` 加第三個分頁籤「基本面」、標題旁產業別 badge，
  並在該層載入 fundamental 一次分發給三處（badge / 分頁 / AiTab）。
- **AI**：`AiPayload` 加 `fundamental` / `news` 兩區塊（沿用 chip 的 hasData 缺料模式、單位寫進欄位名）；
  user prompt 加【基本面摘要】【近期新聞標題】兩段與缺料替代文案；
  system prompt 新增準則 7（新聞只能依標題字面判斷、不得臆測擴寫），準則 4 補上千元 / 百分比單位。

### 實測記錄（curl，2026-07-27，寫進程式註解與 supabase/README.md）

| 端點 | 筆數 | 關鍵欄位形態 |
| --- | --- | --- |
| `BWIBBU_ALL` | 1080 | **英文鍵** `Code/PEratio/DividendYield/PBratio`，`Date` 民國 7 碼 `1150724` |
| `t187ap05_L` | 1082 | 中文鍵，「資料年月」民國 5 碼 `11506`，「產業別」**直接給中文**「半導體業」 |
| `t187ap03_L` | 1092 | 中文鍵，「產業別」是**兩位數代碼** `24` → 需 `INDUSTRY_NAMES` 對照表 |
| Google News RSS | 105 則 | 單行 XML；`<title>標題 - 來源</title>` 純文字＋entity（未見 CDATA）、`<source url=...>` |

三個因此而生的實作決定：產業別**優先取 t187ap05_L 的中文名**（免維護對照表）；
民國日期分 7 碼 / 5 碼兩個轉換函式各自測試釘住；RSS 解析同時支援 CDATA 與純文字兩形態
（Google 端格式可能變動）。

### 待辦（線上操作，需使用者執行）

- [ ] **重新部署**：`cd sources && supabase functions deploy stock-report --no-verify-jwt`
      （`--no-verify-jwt` 不可省，見 CLAUDE.md §13.3）。
- [ ] （選）手動觸發一次 `generate-all` 立即回填，確認 bucket 出現 `fundamental/`、`news/` 兩個前綴。
      CRON_SECRET 明文 Agent 拿不到，需使用者自己執行。
- [ ] 實測：基本面分頁的估值數字對得上 TWSE 網站、產業別正確、AI 解讀有提到基本面與消息面且無臆測數字。
- [ ] 月營收首次只會有 1 筆（檔內自累積設計），逐月長到 12 筆——這是預期行為不是 bug。

---

## 📅 Log: 2026-07-27 10:30:22 Asia/Taipei

- **Agent**: Claude（規格 / 審查 / 驗證）＋ agy `flash`（實作，使用者以 /antigravity:delegate 明確指定）
- **Action**: 0.6.0-dev.3 —— AI 提示詞加上「建議操作」與「注意事項」
- **Status**: IMPLEMENTED — lint / test 260 passed / build 全綠

### 內容與關鍵決策

使用者要求在既有解讀之外加「建議操作與注意事項」。這與原 system prompt 準則 5
「絕對不得提供任何買賣建議、操作訊號」直接衝突——**經使用者指示放寬**：
「建議操作」僅限中性、條件式的觀察性參考，仍禁止明確買賣/加碼/出清指令、
目標價、進出場價位、報酬預期；免責聲明字句不變（測試鎖定）。

- `aiPayload.ts` `renderAiPrompt()`：準則 1 加輸出結構要求；準則 5 改寫；新增準則 6
  （注意事項＝風險訊號＋資料侷限）；免責聲明移為準則 7。user prompt 結尾加請求句。
- `aiPayload.test.ts`：補 5 條斷言（建議操作/注意事項/不得給出明確的買進），既有斷言未動。
- SPEC.md 新增「輸出結構與建議的邊界」段落；README dev.3 段落；版號三處 bump。
- 委派驗收：diff 僅涉 2 個允許檔案，Claude 逐行審過並親自重跑完整閘門（不採信 agy 自述）。

---

## 📅 Log: 2026-07-27 09:52:26 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.6.0-dev.2 —— AI 逾時 30s→180s；AI 設定由每帳號一份改為全站共用
- **Status**: IMPLEMENTED — lint / test（260 passed，+3 新測試）/ build 全綠；線上套用待使用者

### 變更一：AI 逾時放寬為 180 秒

使用者的 local model 30 秒跑不完。`aiClient.ts` 新增 `export const AI_TIMEOUT_MS = 180_000`
作為 `requestJson` 預設值；`AiTab.tsx` 兩處「30 秒」字樣改由 `AI_TIMEOUT_MS` 推導，
不再硬編碼（先前 UI 字串與程式值是兩份，會不同步）。逾時錯誤訊息本來就是動態組字，未動。

### 變更二：AI 設定全域化（app_settings 單列 + admin tag）

使用者要求「不分帳號、不分工作區」。評估過四案（共用 DB 表 / VITE_ 環境變數 /
Edge Function 代理 / localStorage），使用者選定共用 DB 表；寫入權限要「可指定、不綁死 email」，
採 `app_metadata.role = 'admin'` tag（只能由 Dashboard / SQL 設定，使用者無法自改）。

- `schema.sql` §4.1 **整段改版**：DROP 掉 `user_settings.ai_*` 五欄位（dev.1 的設計，僅測試區套過），
  新建 `app_settings`（`id SMALLINT PK DEFAULT 1 CHECK (id=1)` 恆為單列 + 同名五個 ai_* 欄位）。
  RLS：SELECT 開放 authenticated 全員（前端直連，金鑰必須能進瀏覽器）；
  INSERT / UPDATE 僅 `(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`。
- `aiSettings.ts`：load / save / clear 改打 `app_settings`（`id = 1` / `onConflict: 'id'`），
  移除 getUser + user_id 邏輯；新增 `isAiAdmin()`。
- `AiTab.tsx`：非管理員隱藏「AI 設定」按鈕與表單，header 顯示「全站共用，僅管理員可修改」；
  未設定時顯示「請聯絡管理員完成設定」。管理員體驗不變。
- 測試：`AiTab.test.tsx` 補 `isAiAdmin` mock 與 2 個非管理員案例（共 260 passed）。
- 文件：SPEC.md（儲存範圍、權限、180 秒）、README（dev.2 段落）、版號三處 bump `0.6.0-dev.2`。

### 待辦（線上套用，需使用者執行）

- [ ] **測試區重新套用 schema §4.1**：上一輪（00:30）套的是舊版 §4.1（user_settings.ai_* 欄位），
      新版會 DROP 舊欄位並建 `app_settings`。SQL Editor 貼新版 §4.1 段落即可（冪等、可重跑）。
      注意：舊欄位裡已存的個人 AI 設定會一併清掉，需在新表單重填一次。
- [ ] **貼 admin tag**（SQL Editor，語法見 schema.sql §4.1 註解），貼完該帳號**重新登入**才生效。
- [ ] 測試區實測：admin 可存設定；非 admin 帳號看到唯讀並可產生解讀；local model 在 180 秒內完成。
- [ ] 正式區照舊**不動**（0.6.0 併 main 時一次套用新版 §4.1）。

---

## 📅 Log: 2026-07-27 00:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 測試區套用 `schema.sql` §4.1（AI 設定欄位）並驗證
- **Status**: COMPLETED
- **授權範圍**: 使用者「先幫我測試一下 SQL 的部分」→ 僅動**測試區**（`wqetxuhncvfidqnklyew`）；
  **正式區完全未觸碰**，依 §14.2 需另外明確指示。

### 執行方式（可重複）

`supabase db query --linked` **不能直接把 SQL 當引數傳**：§4.1 開頭是 `--` 註解，
CLI 會把它當成旗標而噴 `UnrecognizedOption`。改用 `-f <檔>` 餵檔即可，
順便驗證了 `schema.sql` 的原文可直接執行、不必手改。

```bash
sed -n '/^-- 4.1 AI 助理設定/,/ai_updated_at TIMESTAMPTZ;/p' supabase/schema.sql > /tmp/ai_columns.sql
supabase db query --linked -f /tmp/ai_columns.sql      # 在 sources/ 底下執行
```

### 六項驗證（全通過）

| # | 檢查 | 結果 |
| --- | --- | --- |
| 1 | 套用前的失敗模式 | PostgREST 回 `42703 column user_settings.ai_provider does not exist`（與文件記載一致） |
| 2 | 欄位形狀 | `ai_provider/base_url/model/api_key` = TEXT nullable、`ai_updated_at` = TIMESTAMPTZ nullable，皆無預設值 |
| 3 | 冪等性 | 同一份 SQL 再跑一次，無錯誤（`ADD COLUMN IF NOT EXISTS` 生效） |
| 4 | RLS | `rls_enabled = true`、policy `Users can manage their own settings` 的 `polcmd = *`（ALL）—— 新欄位自動被既有 policy 覆蓋，不需新增 policy |
| 5 | PostgREST schema cache | 套用後 `select=ai_provider,…` 回 `[] / HTTP 200`（不再 42703）→ **cache 自動重載，不需手動 `NOTIFY pgrst`** |
| 6 | 匿名寫入防護 | 未登入的 upsert 被擋：`42501 new row violates row-level security policy` / HTTP 401 → 金鑰欄位不會被未登入者寫入 |

### 為什麼沒做「真的 insert 一列」的測試

`saveAiSettings` 的 upsert 只帶 `user_id` + `ai_*`，能否成功取決於其餘 NOT NULL 欄位有沒有預設值。
實際 insert 會寫進**使用者本人的資料列**，所以改用靜態證明：
`default_fee_rate` 預設 `0.001425`、`theme` 預設 `'dark'::text`、`created_at` 預設 `now()`
—— 三者都有預設，故只帶 `user_id` + `ai_*` 的 upsert 建列不會違反 NOT NULL。結論相同，且不動使用者資料。

### 待辦

- [ ] **正式區套用 §4.1**（需明確指示）。指令與上面相同，只是把 link 換成正式區
      —— 或直接在正式區 SQL Editor 貼那五行 `ALTER TABLE`（**不必重跑整份 schema.sql**）。
      提醒：`supabase link` 有全域副作用，為此重新 link 會清掉目前指向測試區的 link。
- [ ] 登入測試區實測 AI 解讀（測試區 schema 已就緒，現在可以測了）。

---

## 📅 Log: 2026-07-27 00:05:00 Asia/Taipei

- **Agent**: agy（實作）／Claude（規格、審查、修正、驗證）
- **Action**: 0.6.0-dev.1 —— 個股分析新增「AI 解讀」分頁
- **Status**: IMPLEMENTED
- **規格**: `PLAN.md §M`；**委派單**: `TASK.md` Task 17

### 使用者五項定案

UI 放個股分析頁的第四個分頁籤／金鑰存 Supabase `user_settings`（非 localStorage）／
第一版只做前端直連（代理留 0.6.1）／payload 含技術面＋籌碼 7 日但**不含持股**／
失敗與逾時行為由 Claude 決定。

### 產出

新增 `aiSettings.ts`、`aiClient.ts`（兩支 adapter：`google` 與 `openai-compatible`）、
`aiPayload.ts`（純函式）、`AiTab.tsx` 與四份測試；`StockDetailPage` 加第四個分頁籤；
`schema.sql` §4.1 五個 `ai_*` 欄位（Claude 自己寫，未委派）。

**閘門（Claude 親跑）**：lint 3 個既有 warning（未增加）、**test 258 passed**（基準 221）、build 通過。
**未動禁區**：`supabase/functions/`、`TechnicalTab` / `ChipsTab` / `HoldingTab`、無新增 npm 依賴。

### 審查抓到的 5 個問題（詳情見 TASK.md Task 17）

最嚴重的是**漲跌幅小 100 倍**：`technicalView.ts:140` 的 `changePct` 是小數比例，
UI 在顯示時會乘 100（`TechnicalTab.tsx:240`），但 agy 把原始值直接接 `%` 送進 prompt。
其餘四項：連續天數正負號未說明、三大法人漏了買進 / 賣出拆項、逾時沒包住讀 body、CSS 用了
不存在的 `var(--shadow)` 與硬寫深色疊層。全部已修正並補測試。

### 寫給後續 Agent 的三條教訓

1. **委派 AI 相關功能時，要把「數字的單位與正負號語意」當成硬性驗收項。**
   模型不會質疑你給的數字，錯誤會被包在流暢的中文裡送到使用者眼前 —— 這正是
   PLAN.md §M1.1「指標由程式算好再餵給模型」要防的事，而 0.6.0 證明**光是算好還不夠，
   標示也得對**。`changePct` 這個坑之所以存在，是因為它在 UI 端是「顯示時才乘 100」。
2. **逾時要包住讀取回應主體。** `fetch` 收到 headers 就 resolve，在那之後 clearTimeout
   等於對「headers 來了但 body 卡住」完全沒有保護。
3. **加測試時要順手驗證錯誤分類，不只驗成功路徑。** 這輪就是在補逾時測試時，
   抓到自己第一版修正把 body 階段的 `AbortError` 誤分類成 `bad-response`。

### 待辦（需使用者授權 / 執行）

- [ ] 兩區套用 `sources/supabase/schema.sql` **§4.1**（五行 `ALTER TABLE`）。
      未套用時 AI 設定按儲存會回 `column "ai_provider" does not exist`，其餘功能不受影響。
- [ ] 登入測試區實測：設定 Google AI 金鑰 → 產生解讀 → 對照技術面分頁確認漲跌幅、
      買賣超單位、連續天數方向是否一致；1280 / 390px 無水平溢出。
- [ ] **Ollama / vLLM 本機端點尚未實機驗證**（PLAN.md §M7 風險 1）：
      從 `https://` 網域打 `http://localhost` 除了 `OLLAMA_ORIGINS`，
      還可能被瀏覽器私有網路限制擋下。README 目前刻意標為「尚未實機驗證」，實測後再改寫。

---

## 📅 Log: 2026-07-26 23:15:00 Asia/Taipei

- **Agent**: Claude（驗證）／使用者（執行觸發）
- **Action**: 0.5.0 線上收尾 —— `generate-all` 觸發後的資料驗證
- **Status**: COMPLETED

### 執行與結果

使用者在兩區 SQL Editor 各跑一次前一則紀錄的 `DO` 區塊（重放 `cron.job.command`）。
批次於 `2026-07-26T15:09Z` 完成，兩區 `manifest.json` 的 `generatedAt` 同步更新。

| | `daily/*.json` | 報告本體 |
| ---- | ---- | ---- |
| 正式區 | 2609(243) / 0050(244) / 009816(119) / 1802(243) 皆 200 | `history` 7 筆，7/16–7/24 |
| 測試區 | 2609(243) / 0050(244) / 1802(243) 皆 200 | `history` 7 筆，7/16–7/24 |

兩區代號數不同是**正確的**：`heldTwTickers()` 依各環境自己的持股算，測試區沒有 009816。
009816 只有 119 筆（首日 2026-01-23）是該 ETF 上市較晚，非資料缺漏 —— 仍 > 60，MA60 畫得出來。

### 資料完整性檢查（全部通過）

- `schema = 1`，與前端 `dailyProxy.ts` 的 `MIN_DAILY_SCHEMA = 1`（`>=` 比對）相符。
- `lastDate = 2026-07-24`，等於 `dataDate`。
- 日期嚴格遞增、無重複、**無週末列**（`extractDaily` 的假日格丟棄有生效）。
- 每列 `low <= open/close <= high`、量非負、**零筆 null**（§L 的「五欄全 null 假日格丟棄」成立）。
- 兩區同代號的 `rows` 逐值相同（`asOf` 各自獨立，符合預期）。

### 結論

**0.5.0 至此完全落地**：程式碼、兩區部署、線上資料三者到位，技術面分頁不再是空狀態。
下一次排程 `30 9,14,15 * * 1-5`（台北 17:30 / 22:30 / 23:30）會以 `lastDate >= targetDate`
判斷跳過重抓，只在有新交易日時更新。

---

## 📅 Log: 2026-07-26 23:04:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.5.0 線上收尾稽核（唯讀），本機 `main` ref 快轉
- **Status**: PARTIAL — 稽核完成；觸發批次由使用者執行
- **起因**: 使用者要求「依 PLAN.md 部署 0.6.0」。實際查核發現 **0.6.0 尚未實作**（見下方「0.6.0 現況」），
  改為先收尾 0.5.0（使用者定案）。

### 稽核結果（公開 URL 探測，未異動任何環境）

`git push origin main` 已完成 —— `origin/main` = `origin/dev` = `dbf662d`（0.5.0），前端已上 Pages。

| | `manifest.json` | 20260724 報告 | `daily/*.json` |
| ---- | ---- | ---- | ---- |
| 正式區 | `ymd 20260724`，`generatedAt 2026-07-25T18:01:44Z` | 2609 / 0050 / 009816 / 1802 皆 200 | **全數 400（不存在）** |
| 測試區 | `ymd 20260724`，`generatedAt 2026-07-25T17:57:59Z` | 2609 / 0050 / 1802 皆 200 | **全數 400（不存在）** |

**為什麼日線是空的**：最後一次批次跑在 `2026-07-25T18:01Z`，而含 `syncDaily` 的
`stock-report` v5（正式）/ v8（測試）是 `2026-07-26T04:10Z` 才部署 —— 批次跑在部署之前，
`syncDaily` 一次都沒執行過。這不是故障，`TechnicalTab` 的 `'empty'` 狀態正常運作中。

`manifest.json` 的 `ymd` 停在 20260724 是**正確的**（7/24 為週五，7/25 起為週末，cron `1-5` 不跑）。
但兩區的 `generatedAt` 都落在 7/25 18:01Z 前後 4 分鐘、不對應排程三段（UTC 09:30 / 14:30 / 15:30），
研判是當時的**手動觸發**，非排程產物。

測試區 cron 完好：`stock-report-nightly | 30 9,14,15 * * 1-5 | active=true`（唯讀查詢，未動）。

### 觸發批次可以完全不碰密鑰明文（新發現，寫給後續 Agent）

`cron.job.command` 就是單一句 `net.http_post(... body '{"action":"generate-all"}' ... timeout 60000)`。
因此不需要（也不該）把 `CRON_SECRET` 取出來貼進 curl，直接讓資料庫重放那句即可：

```sql
do $$
declare c text;
begin
  select command into c from cron.job where jobname = 'stock-report-nightly';
  if c is null then raise exception 'cron job stock-report-nightly 不存在'; end if;
  execute c;
end $$;
```

在該環境的 SQL Editor 執行即可（每區各自帶自己的 URL 與密鑰，同一段 SQL 兩區通用）。
`pg_net` 是非同步，回應要等約 20–40 秒後查 `net._http_response`。
**此法取代舊紀錄裡「請使用者自己 curl」的做法** —— 密鑰始終不離開資料庫。

### 本機整理

- 本機 `main` ref 停在 `558f0c2`（0.3.6），`origin/main` 早已是 `dbf662d`。
  以 `git branch -f main origin/main` 快轉（已先確認是 fast-forward，無 rebase / 無 push）。
  這正是 7/26 11:40 那次「拿 main 當測試區基準」誤判的溫床，一併清掉。

### 0.6.0 現況（接手前必讀）

- **0.6.0 AI 助理尚未實作**：`sources/src` 內零 AI 相關程式碼，版號仍 0.5.0。
- **PLAN.md §6 指向的 `~/.claude/plans/k-ai-toasty-pearl.md` 已不存在**（該目錄現存最新者為
  籌碼 v2 的 `groovy-plotting-parnas.md`）。0.6.0 目前只剩 PLAN.md §6 三條約束
  ＋ TASK.md Task 16 的三點使用者定案，**不足以直接出委派單**。
  仍待使用者定案：UI 位置、API key 存放處（localStorage vs Supabase）、
  第一版支援哪些 provider、餵給模型的 payload 規格、失敗與逾時行為。

### 待辦（使用者執行）

- [ ] 兩區各跑一次上述 `DO` 區塊 → 查 `net._http_response` 應為 `status_code 200`、
      body 含 `dailySynced` 大於 0；之後 `daily/{ticker}.json` 公開 URL 應回 200。
      使用者已表明兩區皆自行執行。

## 📅 Log: 2026-07-26 11:58:00 Asia/Taipei

- **Agent**: Claude
- **Action**: `dev` 併入 `main` 定版 0.5.0，並部署 K 線後端
- **Status**: PARTIAL
- **起因**: 使用者「直接幫我先把 0.5-dev 合併到 main 去，不然現在好像有點混亂」

### 已完成

- [x] 先提交 main 上未提交的文件異動（`9c80241`、`63084e2`），避免與 merge 衝突糾纏。
- [x] `git merge origin/dev --no-ff` → `4189ab0`。
      衝突僅 `PROGRESS.md` 一處（兩側都在檔首新增紀錄），保留雙方條目、依時間新到舊排列。
- [x] 依 §17.3 去掉 `-dev.1` 定版 **0.5.0**，四處同步：
      `version.ts`、`package.json`、`package-lock.json`(×2 處)、`README.md` 第 3 行；
      README 版本紀錄由「0.5.0（開發中）/ dev.1」改寫為「0.5.0（2026-07-26）」定稿。
- [x] 驗證：oxlint 通過（3 個既有 fast-refresh warning）；vitest **221/221**（併入前 183）；
      `npm run build` 通過。
- [x] **測試區** `stock-report` v7 → **v8**，`--no-verify-jwt`；
      重新 download 驗證 `index.ts`/`report.ts`/`twChips.ts`/`twDaily.ts` 四檔逐位元相同，
      `verify_jwt=false` 維持不變。

- [x] **正式區** `stock-report` v4 → **v5**（使用者授權後執行），
      同樣四檔逐位元驗證通過、`verify_jwt=false` 維持不變。
- [x] 兩區 cron 皆確認為 0.4.0 的三段式 `30 9,14,15 * * 1-5`（正式區這次才補查）。

**部署後兩區最終狀態：**

| | `stock-price` | `stock-report` | cron |
| ---- | ---- | ---- | ---- |
| 正式區 | v7 `verify_jwt=true` | **v5** `verify_jwt=false` | `30 9,14,15 * * 1-5` |
| 測試區 | v3 `verify_jwt=true` | **v8** `verify_jwt=false` | `30 9,14,15 * * 1-5` |

### 待辦（下一個 Agent 接手）

- [ ] `git push origin main` 尚未執行。**推上去會觸發 GitHub Pages 自動部署**
      （`deploy.yml` 的 trigger 是 `push: branches: [main]`），前端 K 線 UI 即上線。
      後端已就緒，可以直接推。

### ⚠️ 我造成的副作用：使用者原本的 link 被清掉

使用者原先在 `/home/ivan/`（家目錄）執行過 `supabase link`，link 狀態存於
`/home/ivan/supabase/.temp/`。我為了查正式區 cron，在暫存目錄另跑了一次
`supabase link --project-ref <prod>`，**原本那個目錄整個消失**——
推測 CLI 的 link 狀態是全域單一份，重新 link 會清掉前一個，而非各目錄獨立。

已重建到**正確位置**：`sources/supabase/.temp/`（指向測試區），
`sources/supabase/.gitignore` 已忽略 `.temp`，不會弄髒 repo。
現在在 `sources/` 下可直接用 `supabase db query --linked`，已實測可用。

**教訓**：`supabase link` 有全域副作用，不是 per-directory。要查另一個專案時，
優先用支援 `--project-ref` 的指令（`functions list/deploy/download`、`secrets list`），
不要為了查詢而重新 link。只有 `db query --linked` 沒有 `--project-ref` 可用。

### 為什麼「前端先上、後端沒跟上」這次不會重演 0.4.0 故障

0.4.0 的坑是前端用 `===` 比對 schema，後端一升版就全掛。這輪不同：

1. `dailyProxy.ts` 的 `MIN_DAILY_SCHEMA` 用 **`>=`**，且在註解裡明寫這是 0.4.0 的教訓。
2. `fetchDailySeries` 查無檔案 / 格式不符 / 無有效列一律回 `null`，
   `TechnicalTab` 有獨立的 `'empty'` 狀態，顯示「這檔還沒有歷史股價」而非崩潰。

所以正式區在後端補上前，技術面分頁只會是空狀態，不是故障。

### 資料何時才會出現

`syncDaily` 掛在盤後批次裡，下次觸發是**週一 17:30**（三段式排程第一段）。
在那之前 `daily/*.json` 不會存在。若要提前驗證需手動打 `generate-all`，
但那需要 `CRON_SECRET` 明文 —— `supabase secrets list` 只回雜湊，Agent 取不到值，
必須由使用者執行。

---

## 📅 Log: 2026-07-26 11:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 以 supabase CLI 稽核兩區環境，補部署測試區 `stock-price`
- **Status**: COMPLETED
- **授權範圍**: 使用者明確授權 supabase CLI 操作**測試區**（`wqetxuhncvfidqnklyew`）

### 稽核方法（可重複）

用 `supabase functions download` 把線上實際跑的程式碼抓下來，跟 repo 逐檔 `diff`。
**不要只看 `functions list` 的 version / updated_at 去推論**——本次就是靠逐檔比對才發現，
版本號較新的那支反而是舊程式碼。

### ⚠️ 稽核基準錯誤（已修正，留作教訓）

第一次稽核時我人在 `main`，就拿 `main` 的程式碼去比對**測試區** —— 基準錯了。
依 CLAUDE.md §18，測試區對應的是 **`dev` 分支**，不是 main。
因此我一度得出「`stock-report` 兩區都已最新」的錯誤結論，實際上測試區缺了整個
0.5.0-dev.1 的 K 線後端。**比對環境前先確認該環境對應哪個分支。**

### 稽核結果（已用正確基準重測）

| 項目 | 測試區 (dev) — 基準 `origin/dev` | 正式區 (prod) — 基準 `main` |
| ---- | ---- | ---- |
| `stock-report` | **落後 187 行**：缺 `twDaily.ts`(115) 與 `index.ts` 的 `syncDaily`(+73)，即 0.5.0-dev.1 的 K 線後端 | 與 `main` 逐位元相同 |
| `stock-price` | **落後 137 行**，缺整個 TWSE MIS 即時報價、`misParse.ts` 根本不存在（兩分支此檔相同，故補 main 版即正確） | 僅 1 行註解路徑過時，功能等價 |
| cron 排程 | 已是 0.4.0 的三段式 `30 9,14,15 * * 1-5` | 未查（link 指向 dev） |
| `reports` bucket | 公開可讀正常 | 公開可讀正常 |
| `CRON_SECRET` | 已設定 | 未查 |

### 已執行

- [x] `supabase functions deploy stock-price --project-ref wqetxuhncvfidqnklyew`
      → v2 → v3，`verify_jwt=true` 維持不變（config.toml 無 per-function 覆寫，預設即 true）。
- [x] 驗證：重新 download 後與 repo 逐位元相同（`index.ts`、`misParse.ts` 皆是）。
- [x] 煙霧測試：`action:'prices'` 打 2330 回 `HTTP 200 {"price":2350}`。

### 刻意未動

- **正式區一律未異動。** 依 CLAUDE.md §14，正式區需另外明確指示；且該處只有一行註解漂移，
  功能等價，不值得為此重新部署。
- ~~測試區的 `stock-report` 尚未補上 K 線後端~~ → 已於 11:55 隨 0.5.0 併入 main 後補上，
  見下一則紀錄。

### 0.5 K 線後端的重點（接手前先讀）

- 版本 `0.5.0-dev.1`（commit `7c90742`，只在 `dev` 分支）。
- **不需要 schema migration。** PLAN.md §G 原本設想建 `price_daily` 資料表，實作時改為
  存進既有 `reports` bucket 的 `daily/{ticker}.json`（整份覆寫），故 `schema.sql` 未動。
  理由寫在 `stock-report/index.ts` 的 `syncDaily` 註解裡。
- 資料源是 Yahoo chart 端點（`range=1y&interval=1d`，2330 實測回 244 個交易日 / 16.8KB），
  `stock-price` 本來就在用同一個端點取現價，只是丟掉了 `timestamp` 與 `indicators`。

### 順帶記錄

- `manifest.json` 停在 `20260724` 是**正確的**：7/24 是週五，7/25、7/26 為週末，
  排程 `1-5` 本就不跑。查到日期落後時先確認星期，別誤判為故障。
- 0.4.1 只改前端（`reportProxy.ts`），**不含任何 Edge Function 異動**，
  故該版無需部署後端，走 GitHub Pages 即可。
- 使用者的 `supabase link` 執行在 `/home/ivan/`（家目錄）而非 `sources/`，
  link 狀態落在 `/home/ivan/supabase/.temp/`。因此 `supabase db query --linked`
  必須在 `/home/ivan/` 下執行；其餘指令改帶 `--project-ref` 明確指定，較不易出錯。

---

## 📅 Log: 2026-07-26 10:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 技術面分頁上線：日 K + 均線、成交量、KD、指標摘要 (0.5.0-dev.1)
- **Status**: COMPLETED
- **起因**: 使用者「如果我現在想要把 K 線補上，可以怎麼做？」
- **計畫檔**: `~/.claude/plans/k-ai-toasty-pearl.md`（含 0.6.0 AI 助理的規劃，本輪未實作）

### 與 PLAN §G 的偏離：日線存 Storage，不新增 `price_daily` 資料表

§G 原本設想 `price_daily(ticker,date,ohlcv)` + 約 400 天保留期。改為
**`reports` bucket 內每檔一份 `daily/{ticker}.json`、每晚整份覆寫**：

1. **沒有保留期問題**。覆寫不累積、不需要 prune —— 而 prune 的保留期單位錯配
   （砍日曆日 vs 數交易日）正是 0.3.9 修過的坑，不要再造第二個。
2. **前端直接下載、不耗 Edge Function 額度**（0.3.9 的教訓：額度燒光會連帶讓 `stock-price` 停擺）。
3. **體積實測 10.8KB / 檔**（243 個交易日），與規劃時估的約 10KB 一致。

代價是每晚重抓整年而非增量，5 檔持股 = 5 個請求，可忽略。

### 資料源實測（先驗證再寫程式）

`query1.finance.yahoo.com/v8/finance/chart/2330.TW?interval=1d&range=1y`：

| 項目 | 結果 |
| --- | --- |
| HTTP / 大小 | 200、16.8KB |
| 交易日數 | **244**（季線只需 60，餘裕充足） |
| `indicators.quote[0]` | open / high / low / close / volume 五欄齊全 |
| `meta.gmtoffset` | 28800 |
| 最後一根 | `2026-07-24`，與籌碼報告的最新交易日一致 |

**兩個實測發現的坑（不是防禦性臆測）**：
1. 回應包含**沒有資料的交易日**：2025-08-01 那格五欄全 null。這種列直接丟棄
   （244 → 243 根），留著只會讓每一條均線都要處處防 null。
2. `timestamp` 是 UTC 秒數、指向當地開盤時刻（台股 09:00 → 01:00Z）。直接
   `toISOString().slice(0,10)` 在台股時區**碰巧**會對，但那是巧合 ——
   一律先加 `gmtoffset` 再取 UTC 日期。測試以 UTC+9 的反例把這件事釘住。

### 實作

- **`twDaily.ts`（新增）**：`dailyUrl` / `yahooDailySymbols`（.TW → .TWO）/ `tradingDateOf` / `extractDaily`。純函式、可測。
- **`index.ts`**：`syncDaily()` 掛進 `handleGenerateAll`。既有檔案的 `lastDate >= 本次資料日`就跳過，
  所以三段式 cron 只有第一班真的去抓。單檔失敗不影響其他檔與籌碼報告。回應新增 `dailySynced`。
  **cron 排程完全不動** —— 日線收盤後就有，17:30 那班必定抓得到。
- **`indicators.ts`（新增）**：`sma` / `ema` / `macd` / `kd` / `rsi` / `maAlignment` / `lastValue`。
  三條共同規則寫在檔頭：輸出與輸入等長、**null 不當成 0**、遞迴狀態遇 null 不更新。
- **`technicalView.ts`（新增）**：把「先算指標、後裁切」這個順序獨立成純函式並加測試 ——
  反過來寫的話，切到「近 3 月」時 MA60 會整條變成 null。
- **`dailyProxy.ts` / `reportsBucket.ts`（新增）**：`downloadJson` 原本是 `reportProxy.ts` 的私有函式，
  日線也要用，**抽成共用模組而非複製**（比照 `holdingRows.ts` 的前例）。
- **圖表**：`CandleChart`（蠟燭 + 均線疊圖）、`MultiLineChart`（KD 雙線 + 20/80 參考線）、
  `chartPath.ts`（`lineSegments` 三處共用）。`ChartFrame` 只加一個選用的 `labelIndices`
  （未傳時行為完全不變）—— 一年 244 根不可能每根標日期。

### Verification

- `npm run test` 182 → **221 passed**（twDaily 9、indicators 14、dailyProxy 6、technicalView 7、StockDetailPage +3）
- `npm run build` 通過；`npm run lint` **維持既有 3 個 warning**
  （中途一度變 4：從 `chartFrame.tsx` 匯出非元件會觸發 `only-export-components`，
  故把 `lineSegments` 移到獨立的 `chartPath.ts`）
- Edge Function 以 esbuild bundle 過（Deno 檔不在 tsc 的 include 範圍內）
- **瀏覽器實測（Playwright，1280 / 390px）**：以本次實抓的 2330 真實資料（243 根）餵進
  臨時 mock storage server，跑的是 `dailyProxy` → supabase-js storage client → 圖表的**完整真實路徑**，
  沒有把服務層 mock 掉。結果：3 張圖、3 條均線、X 軸 6 個等距標籤、
  兩種寬度皆 `scrollWidth == clientWidth`（無水平溢出）、tooltip 含 OHLC + 三條均線 + 量、
  切到「近 3 月」後**均線仍是 3 條**（先算後裁切確實生效）、無 console error。
- **數字交叉驗證（不接受「圖看起來對」）**：以另一份獨立實作重算，
  全部與畫面逐項相符 —— MA5 2377.00 / MA20 2416.75 / MA60 2345.83、漲跌 −55.00（−2.29%）、
  量能比 0.71、KD 44.8 / 43.9、RSI14 46.2。

### 實測抓到並修掉的視覺缺陷

指標摘要用「容器底色 + 1px gap」畫分隔線，但指標有 7 個、每列格數不一定整除，
最後一列空出來的格子被整塊塗成邊框色，在 390px 下看起來像壞掉的空面板。
改成把分隔線畫在格子上（`border-right` / `border-bottom`）。

### Outstanding

1. **尚未部署到任何 Supabase 環境**（CLAUDE.md §18：需使用者明確要求）。
   部署後要驗：`daily/2330.json` 存在、`rows.length` 合理、
   第二次觸發 `generate-all` 時 `dailySynced` 為 0（跳過邏輯生效）。
   在那之前，線上的技術面分頁會顯示「這檔還沒有歷史股價」空狀態。
2. **PDF 不含技術面**。「下載 PDF」按鈕只在籌碼分頁出現（既有行為，本輪未動），
   所以 K 線不會進到 PDF。原計畫寫著「驗 K 線在 `.report-surface` 下的呈現」，
   實測才發現那個前提不成立 —— 要不要把 PDF 擴到技術面是另一個決定，本輪刻意不擴張範圍。
3. 上櫃（.TWO）路徑未經實測，只有單元測試涵蓋 —— 目前持股清單裡沒有上櫃股可驗。

---

## 📅 Log: 2026-07-26 02:40:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正 0.4.0 造成的線上故障 (0.4.1)
- **Status**: COMPLETED
- **回報者**: 使用者（「伺服器回傳的報告格式不符，請稍後再試 這是怎麼回事?」）

### 故障
0.4.0 上線後，個股分析的籌碼分頁**一律**顯示「伺服器回傳的報告格式不符」。
Storage-first 全數判為未命中、即點即產也被擋，整個分頁不可用。

### 原因（我造成的）
0.4.0 把 `REPORT_SCHEMA` 升到 3（新增 `sources`），但前端 `reportProxy.ts` 的守門是
`r.schema === REPORT_SCHEMA` 且 `REPORT_SCHEMA = 2` —— **等號比對**，於是 schema 3 全被拒。

更該檢討的是：我在 0.4.0 的 PLAN、README、commit message 都寫「前端接受 `schema >= 2`」，
**但那個改動從未進到這一版**。`>= 2` 是 0.3.7-dev.5（EPS）時做的，隨著 EPS 被回退（688d9ec）
一起消失了，我卻把那個說法沿用下來、沒有回頭確認程式碼實際長什麼樣。
**文件寫了什麼不等於程式碼做了什麼。**

### 為什麼測試沒抓到
- `reportProxy.test.ts` 的 fixture 是 schema 2 → 等號比對照樣通過
- `StockDetailPage.test.tsx` 把整個 `reportProxy` 模組 mock 掉 → 根本沒執行到守門
- 兩者都沒有「後端回新版、前端要收」這個案例

### 修正
`MIN_REPORT_SCHEMA = 2` + `>=` 比對，並在常數註解寫明「為什麼必須是 >=」。
補上回歸測試：schema 3 與 schema 99 都必須被接受。
**已反向驗證**：該測試在修正前會失敗、修正後通過 —— 確認它真的擋得住這個錯。

### 教訓（寫給後續 Agent）
1. 伺服器的結構版本升級對舊前端是**加法**，守門一律用 `>=`，不要用 `===`。
2. 元件測試把資料層整個 mock 掉時，資料層自己的邊界必須另有測試涵蓋 ——
   否則「兩邊各自通過、串起來壞掉」不會被發現。
3. 跨版本的相容性宣稱要當成**行為**來測，不能只寫在文件裡。

---

## 📅 Log: 2026-07-26 02:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後批次分段執行、逐區塊標示資料時間、借券改用自帶日期的端點 (0.4.0)
- **Status**: COMPLETED
- **起因**: 使用者提議「不能分段執行嗎？能更新的就先更新，並且標註更新時間」

### 為什麼這個提議成立
1. **`generate-all` 本來就冪等且會自我補完** —— 每次重讀快取、只抓缺的、覆寫整份報告。
   「跑三次、能更新的先更新」不需要新機制，加 cron 條目就會發生。
2. **逐項更新時間的資料早就存在** —— `chip_raw_cache.updated_at` 就是「這份 dataset 何時抓到的」，
   逐日逐 dataset 都有，只是沒放進報告。

### 但分段執行會放大一個既有的坑（實測確認）
借券與備援融資融券的回應**完全沒有日期欄位**（實測：`['TWSECode','TWSEAvailableVolume',
'GRETAICode','GRETAIAvailableVolume']`，裸陣列）。而 `readLatest` 是「有快取就直接用」：
早班（17:30）抓到的其實是前一天的借券、卻存成今天，後面幾班因快取已存在而**永遠沿用那份錯的**。
從偶發變成必然。

**解法**：找到帶日期的 rwd 端點 `rwd/zh/marginTrading/TWT96U`。
`date` 參數實測**無效**（三個不同日期回同一份），但 **`title` 自帶日期**
（`115年07月27日 當日可借券賣出股數`），足以判斷拿到的是哪一天 —— 以此為快取鍵（新 dataset `SBL_D`）。

**順帶修正語意錯位**：「可借券賣出股數」是**下一個交易日**的額度，不是收盤那天的數字
（實測最後交易日 07/24 時 title 為 07/27）。原本混在收盤日底下顯示，現在各自標日期。

### 實作
- `twChips.ts`：`BORROW_DATED_URL` / `parseRocTitleDate` / `extractBorrowDated` /
  `borrowDatedOk` / `borrowDatedDate`。rwd 的儲存格把代號包在 `<a>` 裡、每列是兩欄配對（4 格），都已處理。
- `report.ts`：新增 `SourceStamp` / `ReportSources`，`REPORT_SCHEMA` 2 → **3**。
- `index.ts`：`fetchedAtByDataset` 在讀/寫快取時記下時間；`loadLatestOnlySources` 拆成
  `loadBorrow`（以資料自己的日期為鍵）與 `loadMarginFallback`；`assembleOne` 組出 `sources`。
- 前端：`SourceTag` 元件逐區塊顯示「資料日 X · 更新於 Y」；融資融券未到的文案改為
  「今日尚未公布（約 21:00–22:00），稍晚會自動補上」並點明三大法人不受影響。
- cron：`'30 15 * * 1-5'` → **`'30 9,14,15 * * 1-5'`**（17:30 / 22:30 / 23:30 台北）。

### 驗證（兩區皆已部署）
- `chip_raw_cache` 出現 `SBL_D` 且 **ymd = 20260727**（借券自己的日期），
  而非籌碼的 20260724 —— 早晚班不會互相污染。
- 報告 `schema: 3`，`sources` 三項的 `fetchedAt` **各不相同**
  （institutional 04:02、margin 07:32、borrow 17:57 UTC），逐項新鮮度確實生效。
- `npm run test` 170 → **182 passed**；`build` 通過；`lint` 維持 3 個既有 warning。
- Edge Function 檔案先以 esbuild parse 過再部署（Deno 檔不在 tsc 的 include 範圍內）。

### Outstanding
第一次三段式自動執行是 **2026-07-27（週一）** 的 17:30 / 22:30 / 23:30。
預期 17:30 那班只有三大法人、`sources.margin` 為 null，22:30 或 23:30 補齊 —— 這正是要驗的行為。

---

## 📅 Log: 2026-07-26 11:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 夜間排程時間 20:30 → 23:30 (0.3.10)
- **Status**: COMPLETED
- **起因**: 使用者問「為什麼是 20:30？」，接著要求查各網站的實際更新時間

### 查證結果（各資料源的公布時間）
| 資料 | 公布時間 | 原本的 20:30 |
| --- | --- | --- |
| 三大法人個股買賣超 (T86) | 約 15:00–15:30，大行情可能延至 16:30 | ✅ 來得及 |
| 融資融券餘額 | 約 21:00–22:00，偶爾延至 22:30–23:00 | ❌ 太早 |
| 借券賣出餘額 | 約 21:00–22:30，每晚二次更新 | ❌ 太早 |

**證據來源與其限制**：TWSE 官網的 T86 與融資融券頁面**都沒有標示更新時間**（已實際抓取確認），
所以無法取得一手文件。融資融券的 21:30 來自 Yahoo 股市說明頁，與使用者提供的整理表
（21:00–22:00）一致 —— 兩個獨立來源相符。T86 的差異（表 15:00–15:30 vs Yahoo 17:00）
可解釋為「證交所發布」與「Yahoo 轉載上架」的時間差，我們直接打 TWSE，故採前者。
使用者那張表標題掛「臺灣證券交易所」但含期交所項目，應為多來源彙整而非官方文件。

### 原設定的實際後果（照程式碼推導，非臆測）
20:30 執行時 T86 已有 → 當天**算得上交易日**、被收進 history；但：
1. `loadMarginDated` 抓不到當天資料 → 該日 `margin: null`
2. 備援不會啟動 —— `marginDatedFailed` 判斷的是「**整批**都沒有 margin」，
   而較舊的日子在快取裡有值，故為 false，OpenAPI 備援被跳過
3. 前端頂層 `margin` 為 null → **融資融券區塊每天顯示「查無此股當日資料」**
4. **借券更糟**：`readLatest` 用的 SBL 端點無 date 參數，回「目前最新」卻被
   `writeCache(dataYmd, ...)` 存成今天 → **把前一天的數字當成今天的顯示**，且快取後不再更新

這不會自己好：隔天批次補上前一天的，但「最新的一天」又換成新的、又是空的。

### 修正
`schema.sql` §6c 由 `'30 12 * * 1-5'` 改為 `'30 15 * * 1-5'`（23:30 台北），
並把上表的公布時間與「為什麼別再往前挪」寫進註解。兩區以相同 SQL 重新排定，
保留既有 `CRON_SECRET` 與 0.3.8 加的 `timeout_milliseconds := 60000`。

驗證：兩區皆 `schedule = "30 15 * * 1-5"`、`active = true`、`has_timeout = true`。

23:30 仍在台北當日內，不影響 `taipeiYmd` 的交易日判斷。

### Outstanding
第一次自動觸發是 **2026-07-27（週一）23:30**。屆時可查（`pg_net.ttl` 為 6 小時，隔天早上仍查得到）：
`select id, status_code, error_msg, left(content,200) from net._http_response order by id desc limit 3;`
並確認 manifest 的 `ymd` 等於當天、且最新一天的 `margin` 不為 null。

---

## 📅 Log: 2026-07-26 10:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: `generate` 端點加代號白名單、修正 `prune` 過度清除快取 (0.3.9)
- **Status**: COMPLETED

### 1. `generate` 端點的濫用防護
**問題**（實測確認）：函數以 `--no-verify-jwt` 部署（夜間 cron 只帶 `x-cron-secret`），
不帶任何 key 也回 200；而專案網址就在 GitHub Pages 的公開 bundle 裡
（實測線上站台的 `assets/index-*.js` 含 `https://kxnxadaghidwumqsqneu.supabase.co`，repo 為 PUBLIC）。

**這不是資料安全問題**，而是額度問題：
- 回傳的是純公開的 TWSE 資料；`holding` 是請求方自己傳進來、原樣回傳的，讀不到別人的持股
- 唯一可寫的 `chip_raw_cache` 內容來自 TWSE，攻擊者無法注入
- 不碰 `transactions` / `workspaces`；會寫 Storage 的 `generate-all` 有 `CRON_SECRET` 保護
- 真正的風險：每次呼叫 = 1 次 Edge Function invocation（免費約 500K/月），
  實測快取暖時每次約 2.3–2.6 秒。額度燒光會**連帶讓 `stock-price` 一起停擺**

**修正**：`handleGenerate` 加上 `heldTwTickers()` 白名單，非持股回 403（不透露清單內容或長度）。
攻擊者最多只能打持有的那幾檔，而它們早已被夜間批次快取 → **TWSE 放大效應歸零**。
前端不受影響：下拉選單本來就只列使用者自己的持股。

實測（兩區）：持有的代號 200；未持有、以及**曾持有但已賣光**（`net > 0` 過濾）的代號皆 403；
`generate-all` 走自己的清單、不受白名單影響。

### 2. `prune` 保留期的單位錯配
`RETAIN_DAYS = 7` 砍的是**日曆日**，但 `HISTORY_DAYS = 7` 數的是**交易日** ——
7 個交易日要跨 9–11 個日曆日，於是每晚都把隔天還要用的 2–3 天一起砍掉，隔天再重抓。

實證：正式區 prune 後 `chip_raw_cache` 只剩 6 個交易日（20260717 起），
我幾次匿名 `generate` 呼叫又把它補到 9 天（20260714 起）—— 也就是每天都在做白工，
這正是 `generate-all` 每天第一次要 10–13 秒的原因之一。

**修正**：拆成兩個常數。`REPORT_RETAIN_DAYS = 7`（Storage，前端只讀最新一份）、
`CACHE_RETAIN_DAYS = LOOKBACK_DAYS`（原始檔快取，必須涵蓋 `loadSeries` 會回頭找的整個範圍）。

### 未處理（需使用者自行操作）
**Supabase 用量警示**：CLI 與 Management API 都沒有對應指令，只能在 Dashboard 設定
（Organization → Billing → Usage / Spend cap）。這是唯一能在額度燒光前得到通知的方式。

### 踩到的坑
`functions deploy` 第一次失敗：`entrypoint path does not exist (/home/ivan/supabase/...)`
—— shell cwd 被重置，deploy 必須在 `sources/` 下執行。所幸當下的驗證如實反映
「正式區仍是舊版（未持有代號仍回 200）」，沒有誤判成功。**部署指令一律與 `cd` 寫在同一行。**

---

## 📅 Log: 2026-07-26 09:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.3.8 定版、併入 `main`
- **Status**: COMPLETED

### 版號定稿（CLAUDE.md §17.3）
`0.3.8-dev.2` → **`0.3.8`**（三處同步）。README 把 dev.1 / dev.2 併成一則 0.3.8 正式紀錄。

### 本次不需要動 Supabase 的部署
0.3.8 的前端改動（分析頁獨立、移除服務狀態）**不涉及 Edge Function 或報告 JSON 結構**，
兩區的 `stock-report` 維持既有部署即可。唯一的後端異動是 cron 的 `timeout_milliseconds`，
已於 dev.2 當下同步套用到兩區並驗證。因此本次**先合併再部署前端**沒有空窗風險
（不像 0.3.7 當時正式區根本沒有 `stock-report`，必須先補後端）。

---

## 📅 Log: 2026-07-26 09:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 修正夜間排程的 pg_net 逾時 (0.3.8-dev.2)
- **Status**: COMPLETED
- **起因**: 使用者要求分析「免費 Supabase + GitHub Pages 的隱藏問題」，盤點時實測發現此問題

### 問題
`schema.sql` §6c 的 `net.http_post` 沒指定 `timeout_milliseconds`，而 pg_net 的**預設值是 5000ms**
（實測 `pg_get_function_arguments`：`timeout_milliseconds integer DEFAULT 5000`）。
但 `generate-all` **每天第一次執行要 10–13 秒**（抓當天的 T86 與融資融券大檔），
第二次因快取全命中只要約 2 秒 —— 也就是說**每天唯一有意義的那一次必定逾時**。

### 實測（dev，以 `timeout_milliseconds := 1000` 強制重現）
| 觀察點 | 結果 |
| --- | --- |
| `net._http_response` | `error_msg = "Timeout of 1000 ms reached"`、`status_code = null` |
| Storage `manifest.generatedAt` | 16:02:25 → **16:03:37（前進）** |

**結論：批次本身沒壞** —— 客戶端逾時後 Edge Function 仍在伺服器端跑完、報告正常寫入。
真正的損失是**可觀測性**：每晚都記成失敗，導致「逾時但成功」與「真的失敗」無法區分，
而這是唯一的伺服器端訊號（服務狀態頁已於 dev.1 移除）。

### 修正
`schema.sql` 的 cron 補上 `timeout_milliseconds := 60000` 並加註原因，
兩區的 `cron.job` 皆以相同 SQL 重新排定（保留原有的 `CRON_SECRET`，從既有 command 取出）。

驗證：dev 直接執行修正後的 cron 指令 → `net._http_response` 記錄
`status_code = 200`、`error_msg = null`、含完整回應內容 `{"ok":true,...,"historyDays":7}`。
兩區皆確認 `command like '%timeout_milliseconds := 60000%'` 且 `active = true`。

### 同時盤點到、但**未**在本輪處理的免費方案議題
- **`stock-report` 的 `generate` 是完全公開端點**：實測不帶任何 key 也回 200
  （函數以 `--no-verify-jwt` 部署，且專案 URL 就在 GitHub Pages 的公開 bundle 裡）。
  `generate-all` 有 `CRON_SECRET` 保護，只有 `generate` 是開的。
- **可觀測性**：dev.1 移除服務狀態後，排程失敗不會有任何地方顯示（症狀只是開頁變慢）。
- **免費方案**：每組織 2 個 active 專案（**已用滿**）、7 天無活動自動暫停、無 PITR/備份保障
  （`transactions` 是唯一不可重建的資料，建議定期 CSV 匯出）。
- **實測後確認不是問題**：dev 全庫 13MB、`chip_raw_cache` 含 TOAST 僅 1.68MB
  （22 筆、原始 JSON 3.99MB 壓到 1.45MB，遠低於 PLAN 當初估的 15–25MB）；
  前端 bundle 508KB + 動態載入的 PDF 函式庫，對 Pages 頻寬無感；
  Storage bucket 匿名無法列舉（400），但直接猜路徑可探測「全體持有哪些代號」（無股數、無個資）。

---

## 📅 Log: 2026-07-26 00:30:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 個股分析改為獨立導覽分頁（下拉切換持股）、服務狀態功能整個移除 (0.3.8-dev.1)
- **Status**: COMPLETED
- **Task**: `TASK.md` Task 15；計畫檔 `~/.claude/plans/nested-sauteeing-boole.md`

### 1. 移除服務狀態
- 刪除 `components/ServiceStatus/`（整個目錄）、`services/serviceHealth.ts`、`serviceHealth.test.ts`
- `AppShell`：移除 `Activity` import、`ServiceStatusPage` import、`Tab` 的 `'status'`、TABS 項、渲染條件
- `index.css`：刪除服務狀態專用的 75 行（20 個 `.status-*` / `.uptime-*` class，全庫僅該頁使用）。
  刪除前以程式斷言確認未含 `.spin` / `.section-title` 等共用樣式
- 連帶清掉 dead code：`twMarketData.ts` 的 `readTwListCacheMeta`（唯一呼叫者是 serviceHealth）；
  `priceProxy.ts` 的 `readPriceCache` 保留（內部仍在用），只修註解
- **GitHub 連結改置於頁尾**免責聲明下方（依使用者指示）；專案簡介文案不保留（README 仍有）

### 2. 個股分析獨立成頁
- 新增 `components/StockDetail/AnalysisPage.tsx`（容器）：`useWorkspace` + `useStockPrices` + `getFeeRate`，
  過濾台股後作為下拉選單來源；`selectedKey` state，選中的代號因交易異動而消失時自動回退第一檔
- 下拉沿用既有 `.ws-select` 樣式（後代選擇器，無需新 class）
- `StockDetailPage` 的 `onBack` 改為 **`selector?: ReactNode`** —— 已無下鑽，頁首左側改放下拉選單。
  以 `key={holding.key}` 強制換股時重置整組 state，避免看到上一檔的殘留
- `AppShell`：移除 `detail` state 與 `goTab`，新增 `analysis` 分頁；
  **未設定 Supabase 時該分頁隱藏**（`isReportConfigured` 閘門，與盤後報告入口規則一致）
- `DashboardPage`：移除「個股分析」欄、`onOpenDetail` / `openDetail` 與相關 import

### 3. 共用計算：`utils/holdingRows.ts`
`buildRows` / `HoldingRow` 原本是 `DashboardPage` 的 module-local。分析頁需要同一份
「每檔的 price / unrealized / roi」（含台股零股最低手續費、預扣賣出費稅），**抽成共用模組**而非複製。
`DashboardPage` 改 import，行為不變。

### Verification
- `npm run test` 159 → **170 passed**（刪 serviceHealth 4 筆、改 smoke 2 筆並新增 2 筆、
  新增 holdingRows 6 筆 + AnalysisPage 7 筆）
- `npm run build` 通過；`npm run lint` warning 由 4 降到 **3**（ServiceStatusPage 那筆隨檔案消失）
- 瀏覽器實測（Playwright，本機模式）：
  - 導覽列 `庫存總覽 / 年度收益 / 交易紀錄`（服務狀態已無、個股分析在本機模式正確隱藏）
  - 庫存總覽表頭已無「個股分析」欄
  - 頁尾：免責聲明 + 其下的 GitHub 連結，`href` 正確
  - 分析頁（臨時 harness 掛 AuthProvider + WorkspaceProvider）：下拉只列 `1802 / 2330 / 2609`
    （美股 AAPL 不在內）、切換後標題與內容同步更換、「我的持股」數字由 ledger 正確帶入、
    390px 無水平溢出、無 console error
- **不需要動 Supabase**：純前端呈現層改動，報告 JSON 結構與 Edge Function 完全不變

### 踩到的小坑
- `tsc` 抓到我新寫的 `holdingRows.test.ts` fixture 少了 `PriceQuote` 的 `asOf` / `source`
  —— vitest 不做型別檢查所以測試先過了，`npm run build` 才擋下來。這正是 PLAN 一直寫
  「`build` 不可略過」的理由。
- 臨時 harness 這次**一律用絕對路徑刪除**，未再發生前兩輪 cwd 被重置導致 `rm -f` 靜默失敗的情況。

---

## 📅 Log: 2026-07-25 23:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 0.3.7 定版、併入 `main`、正式區（`kxnxadaghidwumqsqneu`）後端部署
- **Status**: COMPLETED

### 版號定稿（CLAUDE.md §17.3）
`0.3.7-dev.6` → **`0.3.7`**（三處同步）。README 版本紀錄把 dev.1–dev.6 **併成一則 0.3.7 正式紀錄**：
從 `main` 的角度 EPS 從未存在（dev.5 已回退），故不列入；dev.6 只留「版號格式與徽章」這兩項淨效果。

### ⚠️ 正式區原本停在 v0.3.6 的狀態
盤點結果：只有 `stock-price`(v6)、**沒有 `stock-report`**、**沒有 `chip_raw_cache`**、
沒有 `reports` bucket、沒有 `pg_cron`/`pg_net`、沒有 `CRON_SECRET`。有 126 筆真實交易。

與 v0.3.6 的 schema 差異只有第 5、6 段（第 1–4 段未變動），故**只套這兩段**，不在有真實資料的庫上重跑既有表。

### 部署順序刻意先後端、後 git
`.github/workflows/deploy.yml` 是 **push 到 `main` 就觸發 Pages 部署**。若先合併，
線上會有一段「分析」按鈕點了就失敗的空窗（前端已上線但正式區沒有 `stock-report`）。
故順序為：正式區後端就緒 → 驗證 → 才合併推 main。

### 正式區執行內容
1. schema 第 5 段 → 建 `chip_raw_cache`
2. `functions deploy stock-report --no-verify-jwt`
3. `secrets set CRON_SECRET=<token_urlsafe(32)>`
4. schema 第 6 段（代入實際 project ref 與 secret）→ `reports` bucket(public)、`pg_cron`/`pg_net`、
   cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`
5. 手動觸發 `generate-all` 兩次：首次 5 檔 / 5 天（回補上限，13.3 秒），第二次補滿 **7 天**（12.3 秒）
6. 驗證 5 份報告（0050、00685L、009816、1802、2609）皆 `schema 2`、`history` 7 天且
   融資融券 7 天齊全、`holding: null`（共用報告不含個資）、`notes` 空

### ⚠️ 踩到的陷阱：Supabase CLI 的 link 是**依 cwd 解析**
從 repo 根目錄執行 `--linked` 指向 **dev**，從 `sources/` 執行才指向**正式區**
（link 檔在 `sources/supabase/.temp/project-ref`）。一開始從根目錄查，`projects list` 回報
正式區 `linked=False`，與使用者所述不符 —— 換到 `sources/` 才對得上。
**對策**：函數部署一律明確帶 `--project-ref`；每次寫入 DB 前先斷言 linked 專案是預期的那個。

### Verification
- `npm run test` 159 passed / `build` / `lint` 全過（版號改動不影響邏輯）
- 正式區與測試區後端狀態一致（皆有 `chip_raw_cache`、`stock-report`(no-verify-jwt)、
  `reports` bucket、每交易日 20:30 排程）

### Outstanding
- 兩區的夜間排程都尚未經歷一次自動觸發（每週一~五 12:30 UTC / 台北 20:30，最快下週一）。
- `TechnicalTab` 仍為佔位頁（需 `price_daily` 與約 400 天保留期，見 PLAN §G / §L）。

---

## 📅 Log: 2026-07-25 23:10:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 依使用者指示移除基本面（EPS）全部實作；版號格式改為不帶 `v`；徽章不再顯示作者 (0.3.7-dev.6)
- **Status**: COMPLETED

### 1. 移除 EPS（dev.5 全數回退）
- `git revert ec12206`（乾淨套用，無衝突）→ 刪除 `twFundamentals.ts(+test)`、`FundamentalsTab.tsx(+test)`、
  `fundamentalFormat.ts(+test)`；`report.ts` 回到 `REPORT_SCHEMA = 2`；`index.ts` 移除
  `syncFundamentals` / `BWIBBU` / `STOCK_DAY_AVG`；`StockDetailPage` 回到三個分頁籤；
  `reportProxy.ts` schema 守門回到 `=== 2`。實測 `grep -rl "EPS|fundamental|每股盈餘|本益比|BWIBBU"` 於
  `src/` 與 `supabase/` **零命中**。
- **Supabase 端必須跟著回退，不是選項**：部署中的函數回 schema 3，而回退後的前端只接受 `=== 2`，
  Storage-first 與即點即產兩條路都會被判為不支援 → 籌碼頁會整個壞掉。故：
  - 重新部署 `stock-report`（回 schema 2）
  - 重跑 `generate-all` 把 Storage 內 3 份 schema 3 JSON 覆寫回 schema 2（實測 1802/2609/0050 皆已無 `fundamentals` 欄位）
  - `DROP TABLE stock_fundamentals`（1070 列，全為公開 TWSE 資料、無使用者資料、可一道指令重抓）
  - 刪除 `chip_raw_cache` 的 `BWIBBU` / `STOCK_DAY_AVG` 兩筆（否則會閒置 7 天才被 prune）
  - 驗證後 `chip_raw_cache` 只剩 `MI_MARGN, MI_MARGN_D, SBL, T86` 四個 dataset
- `schema.sql` 的第 7 段（`stock_fundamentals`）已隨 revert 移除，檔案回到 6 段。

### 2. 版號格式（CLAUDE.md §17 已更新）
- **一律不帶 `v` 前綴**，只有 `x.x.x`（正式）或 `x.x.x-dev.x`（測試）兩種形式。
- `version.ts` 的 `APP_VERSION` 由 `'v0.3.7-dev.4'` 改為 `'0.3.7-dev.6'`；
  README 第 3 行與「開發中」標題同步去掉 `v`。
- README **歷史版本標題保留原樣**（`### v0.2.5` 等）—— 使用者說的是「以後」，那些是既成紀錄，
  改了只是製造 diff 噪音。

### 3. 徽章不再顯示作者
- `APP_AUTHOR` 常數與其 export **整個移除**（不只是不顯示）；`App.tsx` 的徽章由
  `{APP_VERSION} | {APP_AUTHOR}` 改為 `{APP_VERSION}`。
- `App.smoke.test.tsx` 的斷言改為 `toBe(APP_VERSION)` 並加驗「不以 v 開頭」「不含 Ivan」，
  讓格式規則有測試把關而非只寫在文件。

### 版號選擇說明
本輪進到 **dev.6 而非重用 dev.5**：dev.5 已被 EPS 用掉並推上 remote，重用會讓同一版號指向兩份不同內容。

### Verification
- `npm run test` **159 passed**（回到 dev.4 的基準；EPS 的 40 筆測試隨功能一併移除）
- `npm run build` 通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- dev Supabase：2330 / 0050 實測皆回 `schema 2`、無 `fundamentals` 欄位、`history` 7 天完好
- 籌碼功能未受影響（history、走勢圖、逐日檢視、法人並排全部保留）

---

## 📅 Log: 2026-07-25 16:45:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 籌碼逐日檢視 + 法人並排比較 (v0.3.7-dev.4)
- **Status**: COMPLETED
- **使用者需求**: (1) 三大法人表格能 review 1~7 天的資料 (2) 買賣超圖在右側空白處顯示圖例

### Completed Tasks
- [x] **三大法人表格可切換 7 天中任一天**：日期鈕列於區塊標題旁，預設最新交易日。
- [x] **連買連賣改為前端計算**（`chipStreak.ts` 的 `streakAt`）：伺服器的 `report.streaks` 只有最新日，
      表格能回看任一天就必須算「到那一天為止」的連續天數。UI 一律走前端這條路（含融資融券），
      不混用兩種來源。行為必須與 Edge Function 的 `computeStreak` 一致，兩邊各有測試。
- [x] **`BarSeriesChart` 支援多序列並排**（grouped bars），同組內留 2px 間隙。
- [x] **新增「全部（並排）」模式**：四個法人同時比較，各一類別色 + 右側 `ChartLegend`。
      hover 一次列出當日四個法人的數字。
- [x] **新增 `chartColors.ts` 的 `CATEGORICAL_COLORS`**（見下方配色決策）。
- [x] **報告表頭加上「報告更新時間」**（`fmtUpdatedAt`），且表頭移進 PDF 擷取範圍內。

### 配色決策（依 dataviz 指引，非憑感覺挑色）
- **顏色一次只能做一件事**：單一序列時顏色表達極性（紅正綠負）；多序列並排時顏色表達身分，
  正負改由長條在零軸上下的方向表達。兩者不可疊在同一組標記上。
- 類別色取自參考配色的固定順序 slot 1–4，**依序指派不循環**。
- **選 dark steps 而非 light steps**：本專案圖表色必須是單一組字面值（html2canvas 限制），
  需同時服務深色主題、淺色主題與淺底 PDF。以 `validate_palette.js` 實測：
  light steps 在深底 **FAIL 亮度帶**；dark steps `#3987e5,#d95926,#199e70,#c98500`
  在淺底 `#fcfcfb` 與深底 `#131a2b` **全部 PASS**（淺底 contrast 2.99 為 WARN，
  需「可見標籤或表格檢視」作緩解 —— 本頁同時有圖例文字與完整數字表格，成立）。
- **合計不與其組成並排**：三大法人合計＝四項之和，一起畫等於同一筆量重複計算。

### Verification
- `npm run test` 150 → **159 passed**（新增 `chipStreak` 6、`StockDetailPage` 3）
- `npm run build` 通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- 瀏覽器實測（Playwright + 臨時 harness，驗完刪除）：7 個日期鈕、圖例 4 項、
  並排長條 7×4=28 根、切單一法人後 7 根且圖例改為買超/賣超、切日期後表格與連買連賣同步重算、
  多序列 tooltip 一次列出四個法人、PDF 實跑成功（453KB）、390px 無水平溢出（日期鈕換行、圖例移至圖下）

### 已知限制（資料本質，非缺陷）
- 並排模式下若某法人量級遠大於其他（例如外資 990 萬 vs 外資自營商 2.2 萬），
  小的那幾根會接近看不見。這是共用同一縱軸的必然結果；要細看請切到單一法人（各自獨立縱軸），
  或看上方表格的數字。**刻意不做雙縱軸** —— 那會讓兩個量級的高低變得無法比較。

---

## 📅 Log: 2026-07-25 15:20:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v2 —— 個股分析頁 + 籌碼走勢圖 (v0.3.7-dev.3)
- **Status**: COMPLETED
- **Task**: `docs/agent/TASK.md` Task 11；架構決策見 `docs/agent/PLAN.md` §A–J

### Completed Tasks
- [x] **版號規範改版**：CLAUDE.md §17 改為 main `x.x.x`（依序遞增，除非大版本異動）／dev `x.x.x-dev.x`（點號）。
      全庫由 `0.3.7-dev-2` 遷移為 `0.3.7-dev.2`，本次進版至 `0.3.7-dev.3`。
- [x] **`twChips.ts`**：新增 `ChipLeg`（buy/sell/net）；`InstitutionalChip` 五項全部改為 leg
      （自營商買進/賣出由「自行買賣」+「避險」相加，買賣超取官方欄位；三大法人買進/賣出由五個 leg 加總）；
      `MarginChip` 擴充買進/賣出/償還並加 `source` 欄；新增 `marginDatedUrl` / `extractMarginDated`（**位置索引**）
      / `marginDatedOk`（欄序防護）。
- [x] **`report.ts`**：新增 `ChipDay`、`REPORT_SCHEMA = 2`、`history`、`ChipStreaks`；
      純函式 `computeStreak` / `computeStreaks` / `isWeekendYmd`。`buildReport` 改吃 history。
- [x] **`index.ts`**：`loadDaySources` → `loadSeries`（回推 14 日曆日、跳過週六日、快取優先、
      併發上限 3、單次回補上限 5 天、滿 7 個交易日即停）；每日大檔抽成 per-ticker 切片後即釋放，
      避免同時持有數十 MB；移除 html 產生與上傳。**刪除 `reportHtml.ts`**。
- [x] **`reportProxy.ts`**：以結構化型別取代 `data: unknown`；`isSupportedReport` 守門，
      `schema !== 2` 視為未命中；刪除 `applyHoldingOverlay` / `renderHoldingSection`（與 `reportHtml.ts` 重複的手抄複本）。
- [x] **`components/Charts/`（新增）**：`chartScale.ts`（`niceDomain` / `domainTicks` / `tickStep` / `scaleY` /
      `fmtAxisNumber`，純函式有測試）、`chartColors.ts`、`chartFrame.tsx`（軸線、命中區、tooltip）、
      `BarSeriesChart.tsx`、`LineSeriesChart.tsx`。
- [x] **`components/StockDetail/`（新增）**：`StockDetailPage.tsx`（三分頁籤 + PDF）、`ChipsTab.tsx`、
      `HoldingTab.tsx`、`TechnicalTab.tsx`（佔位）、`chipFormat.ts`。
- [x] **`AppShell.tsx`**：新增 `detail` state 作為下鑽檢視，`goTab()` 點導覽分頁即清空；
      `DashboardPage` 改吃 `onOpenDetail`，**刪除 `ReportModal.tsx`**。
- [x] **`reportPdf.ts`**：擷取前後動態掛上／移除 `.report-surface`，深色主題也輸出淺色文件 PDF。
- [x] **`index.css`**：新增個股分析頁、二級分頁籤、圖表、持股卡片與 `.report-surface` 樣式。
- [x] 文件：`README.md`（dev.3 版本紀錄）、`sources/supabase/README.md`（schema 2 結構、
      `MI_MARGN_D` dataset、回補行為、新增症狀對照）、`TASK.md`（補 v1 摘要 + Task 11）、`SPEC.md`（新增章節）。

### Verification
- `npm run test`：**148 passed**（基準 113；新增 twChips 6、report 12、chartScale 12、reportProxy 4、StockDetailPage 9）
- `npm run build`（`tsc -b && vite build`）通過；`npm run lint` 無新增 warning（維持既有 4 筆）
- 瀏覽器（Playwright + 臨時 preview harness，驗完刪除）：
  1280px / 390px 皆無水平溢出（寬表格在自身 `.table-scroll` 內滾動）、hover tooltip 內容與定位正確、
  `.report-surface` 淺色容器正確、`generatePdfBlob` 實跑成功（388KB PDF）、
  本機模式回歸（分析入口正確隱藏、四個導覽分頁切換無 console error）。
- **圖表兩個實測修正**：軸標籤原本隨 viewBox 等比縮放（寬螢幕變兩倍大 / 手機太小），改為量測容器寬度以 1:1 繪製；
  `fmtAxisNumber` 加入 step 參數，修正融資餘額 31,100–31,928 這種序列相鄰刻度全標成「3.1 萬」的問題。

### Supabase 部署（使用者於同一 session 明確授權後執行）

- **只動 dev 專案** `wqetxuhncvfidqnklyew`（Stock-Pnl-Web-Dev）；正式區 `kxnxadaghidwumqsqneu` 未觸碰、CLI 亦未 link。
- `supabase functions deploy stock-report --no-verify-jwt` → **version 1 → 2、`verify_jwt` true → false**。
  `stock-price` 未動（本次無變更），仍為 version 1 / `verify_jwt: true`。
  順帶修掉一個既有問題：舊部署是 `verify_jwt: true`，但 schema.sql §6c 的 cron 只帶 `x-cron-secret`
  不帶 Authorization，代表夜間批次本來就會被 gateway 擋 401。
- **無需 schema migration**（實證）：`chip_raw_cache.dataset` 無 CHECK 約束，
  新的 `MI_MARGN_D` 已正常寫入 9 筆（20260714–20260724），與既有 `T86` / `MI_MARGN` / `SBL` 並存。

### 線上實測（真實 TWSE 資料，2330）

| 項目 | 結果 |
| --- | --- |
| HTTP / 耗時 | 200、約 8 秒（Edge Function wall-clock 內） |
| `schema` / `html` | `2`；回應已無 `html` 欄位 |
| 第一次呼叫 | `history` **5 天**（= `MAX_BACKFILL_DAYS`），`notes` 正確說明「歷史資料回補中」 |
| 第二次呼叫 | `history` **7 天**（07/16、17、20、21、22、23、24 —— 正確跳過 07/18–19 週末），`notes` 清空 |
| 三大法人 | 五項 buy/sell/net 皆有值（外資 buy 8,879,341 / sell 18,515,947 / net −9,636,606） |
| 融資融券 | `source: 'rwd'`（新端點成功），買進 797 / 賣出 454 / 償還 360 / 今日餘額 31,915 張 |
| 交叉驗證 | 2026-07-22 融資餘額 **31,928 張**，與 PLAN.md §C 當初手動實測的 2330 fixture 完全一致 |
| 借券 | `availableVolume: 11,853,736` |
| history 完整性 | 7 天皆 `institutional` 與 `margin` 有值 → 走勢圖資料齊全 |

**回補機制實證有效**：第二次呼叫命中前次快取，額度得以用在剩下 2 天，如 README 所述。

### schema.sql §6 套用（dev.2 遺留缺口，本次一併補上）

dev 專案原本沒有 `reports` bucket、沒有 `CRON_SECRET`，代表 dev.2 的「盤後自動產報」從來沒真的啟用過。
使用者授權後補齊（**只套 §6，前 5 段既有表未重跑**）：

- `supabase secrets set CRON_SECRET=<token_urlsafe(32)>` → 已確認出現在 secrets 清單。
  值同時存在 Edge Function secrets 與 `cron.job.command`；需要取回時查
  `select command from cron.job where jobname='stock-report-nightly'`。
- `supabase db query -f`（§6 代入實際 `<PROJECT_REF>` / `<CRON_SECRET>`）→ 驗證結果：
  `reports` bucket 存在且 public、`pg_cron` / `pg_net` 已啟用、
  cron job `stock-report-nightly | 30 12 * * 1-5 | active=true`。

### 批次與 Storage-first 線上實測

- 手動觸發 `generate-all`（**只帶 `x-cron-secret`、不帶 Authorization**）→
  `{"ok":true,"ymd":"20260724","generated":3,"total":3,"historyDays":7}`，4 秒完成（raw 檔已在快取內）。
  這同時證明 `--no-verify-jwt` 生效 —— 修好前，夜間 cron 會被 gateway 擋 401。
- Bucket 內容：`manifest.json`（0.1KB）+ `20260724/{0050,1802,2609}.json`（各約 5KB，與估算一致）。
- 報告 JSON 檢查（0050）：`schema: 2`、**上下層都無 `html` 欄位**、`history` 7 天且每日 `institutional`
  與 `margin` 皆有值、`holding: null`（共用報告不含個資）、`notes` 空、`margin.source: 'rwd'`。
- Anon 讀取權限：`manifest.json` / 存在的代號 → 200；不存在的代號 → 400（前端據此 fallback 即點即產）。
- **效能**：Storage-first 兩次下載共 **0.8 秒**，對比即點即產 **8 秒** —— 約 10 倍差距，
  這就是套用 §6 的實際價值。

### Outstanding

- **未在瀏覽器走完整登入流程驗證**：dev 為 Supabase 模式需帳密登入，改以 curl 打真實端點 +
  jsdom 元件測試涵蓋。UI 版面另以 fixture 在瀏覽器實測（見上）。
- 夜間排程的首次自動執行時間：**每週一~五 12:30 UTC（台北 20:30）**，尚未經歷一次自動觸發。

---

## 📅 Log: 2026-07-25 12:27:06 Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v2 架構規劃與資料源實測（PLAN.md）
- **Status**: COMPLETED（規劃）

### Completed Tasks
- [x] 實測確認帶 `date` 的 rwd 融資融券端點欄位（16 欄、名稱重複需位置索引），記下 2330 實測列當 fixture。
- [x] 確認 T86 同一份回應已含各法人買進 / 賣出（19 欄），拆項無需新資料源。
- [x] 決定移除 HTML 產生路線、改由 React 繪製；`PLAN.md` 寫入架構決策 A–J 與風險。

---

## 📅 Log: 2026-07-25 (dev.2) Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告自動產生 + Storage 快取 (v0.3.7-dev.2，commit 9d62546)
- **Status**: COMPLETED

### Completed Tasks
- [x] `stock-report` 新增 `generate-all` 批次動作，由 `pg_cron` 每交易日 20:30（台北）觸發，
      產出全體持有台股的共用報告存入公開 `reports` bucket；新增 `CRON_SECRET` 驗證。
- [x] 前端改 Storage-first（先讀預產報告，查無再即點即產），個人持股概況由前端疊加。
- [x] 只保留 7 天：同批次清理舊報告與 `chip_raw_cache`。

---

## 📅 Log: 2026-07-24 (dev.1) Asia/Taipei

- **Agent**: Claude
- **Action**: 盤後籌碼報告 v1 (v0.3.7-dev.1，commit 038cdd8)
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增 Edge Function `stock-report`：抓 TWSE 三大法人買賣超、融資融券、借券，產生報告 HTML。
- [x] 庫存總覽台股列新增「報告」按鈕與彈窗，可下載 PDF（`jspdf` / `html2canvas` 動態載入）。
- [x] 新增 `chip_raw_cache` 依交易日共用快取；Supabase 檔案集中至 `sources/supabase/`。

---

## 📅 Log: 2026-07-22 15:40:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner / Reviewer**: Claude
- **Action**: 庫存總攬面板縮小為主副層級式 (v0.3.6)
- **Status**: COMPLETED

### Completed Tasks
- [x] `DashboardPage.tsx`: 每張面板改為 `.metric.metric-hero`（持倉市值）+ `.metric-row` 兩欄（投入總成本、未實現淨損益）；縮小欄位 skeleton 寬度 120 → 90。三態顯示、格式化參數、tooltip 文案不變。
- [x] `index.css`: `.market-panel` padding 縮小；`.kpi-value` 24px → 16px、新增 `.metric-hero .kpi-value` 22px（小螢幕 20px）；新增 `.metric-row` 兩欄網格（上邊線 + 欄間左分隔線）；刪除舊的直向 `.metric + .metric` 分隔規則；`.kpi-sub` 11.5px → 11px。
- [x] 版本號升至 0.3.6 / v0.3.6。
- [x] Claude 親自 review diff 並重跑 `npm run build` 通過。

---

## 📅 Log: 2026-07-22 15:20:00 Asia/Taipei

- **Agent**: Gemini
- **Action**: Dashboard 庫存總攬改版為台美股雙面板 (v0.3.5)
- **Status**: COMPLETED

### Completed Tasks
- [x] `DashboardPage.tsx`: 新增 `twCost` / `twRawCost` / `usCost` / `usRawCost` 4 個成本聚合運算。
- [x] `DashboardPage.tsx`: 將 4 張卡片改版為 `.market-grid` 下的 2 張 `.market-panel`（🇹🇼 台股 TWD / 🇺🇸 美股 USD）。
- [x] `DashboardPage.tsx`: 調整指標順序為：1. 持倉市值 2. 投入總成本 3. 未實現淨損益。
- [x] `index.css`: 新增 `.market-grid` / `.market-panel` 相關樣式與小螢幕 media query 覆寫，維持 `.kpi-grid` / `.kpi` 既有樣式不動。
- [x] `package.json` 與 `version.ts`: 版本號同步升級至 0.3.5 / v0.3.5。
- [x] 執行 `npm run build` 通過驗證。

---

## 📅 Log: 2026-07-21 14:45:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: Implementation
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增服務狀態頁面 (`ServiceStatusPage.tsx`) 與檢測邏輯 (`serviceHealth.ts`)。
- [x] 移除畫面左下角固定版本標籤。
- [x] 更新 `AppShell.tsx` 分頁選項加入服務狀態。
- [x] 升級版本至 v0.3.0。

---

## 📅 Log: 2026-07-21 15:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 服務狀態頁 review 修復與視覺收尾 (v0.3.0)
- **Status**: COMPLETED

### 修復的缺陷（agy 交付版本無法執行）
- [x] **白屏（阻斷級）**：`ServiceStatusPage.tsx` 將純型別以一般 import 匯入，`verbatimModuleSyntax`
      下 Vite 執行期報 `does not provide an export named 'ComponentId'`，整個應用無法啟動。改用 `import type`。
- [x] **白屏（阻斷級）**：lucide-react 1.24 已移除品牌圖示 `Github`，改用 `Code2`。
- [x] **型別錯誤**：`serviceHealth.ts` 閉包內 `supabase` 的 non-null narrowing 失效，收斂至區域常數 `sb`。
- [x] `serviceHealth.test.ts` 同樣的 type-only import 問題（TS1484）。

### 驗收流程修正
- `npx tsc --noEmit` 與 `npm test` **均無法**攔截上述白屏：前者走的 tsconfig 不含 `verbatimModuleSyntax`，
  後者的 esbuild transform 會 tree-shake 未使用的 type import。實測反證確認唯有 **`npm run build`（`tsc -b`）** 會報 TS1484。
  往後驗收一律以 `npm run build` 為準。

### 視覺與一致性收尾
- [x] 版本字串 `v0.3.0` → `v0.3`（依需求），README 同步。
- [x] uptime 條說明由每個元件重複 8 次改為整頁一次；空格子改用 `--border-strong` 以免條狀圖看似只有半截。
- [x] 檢測時間改用 `zh-TW` 24 小時制，與 Dashboard「現價更新於」一致。
- [x] `lastSample?.results?.x` 防禦，避免歷史資料損毀時整頁崩潰。
- [x] `App.smoke.test.tsx` 新增服務狀態分頁斷言（本機模式後端為「未啟用」且整體仍為正常）。
- [x] 驗證：`npm run build` 通過、`npm test` 10 檔 90/90、Playwright 深淺兩主題與四個分頁零 pageerror。

## 📅 Log: 2026-07-21 15:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 頁首維持單行（使用者回饋：新增分頁後右側控制項被擠到第二行）
- **Status**: COMPLETED

### Completed Tasks
- [x] 量測確認換行門檻：1100px 時子元素合計 1143px 超出可用 1060px 約 83px。
- [x] `AppShell.tsx` / `index.css`: 頁首改為逐級讓步——1180px 起縮間距與 tab padding、
      1060px 起收起品牌文字、960px 起分頁只留圖示（名稱移至 title / aria-label）。
- [x] 手機版 (≤700px) 分頁改用短標籤（總覽／年度／紀錄／狀態）：四個分頁平分 390px 時
      四字標籤會折行成兩列。
- [x] 驗證：1280/1100/1000/820px 頁首皆為單行（高 63–70px，原本 112px），
      390px 分頁不再折行；`npm run build` 與 90/90 測試通過。

---

## 📅 Log: 2026-07-21 15:50:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 頁首換行修正補完 + 庫存總覽未實現損益加入未含費 (v0.3.1)
- **Status**: COMPLETED

### 頁首（使用者回報「還是一樣」）
- [x] 每 10px 密集掃描找出前次修正的缺口：**1080px 與 980px 仍換行**，
      原因是讓步門檻壓在 1060 / 960，恰好卡在需求曲線之上。
- [x] 門檻上移：品牌文字 1060 → 1120px、分頁文字 960 → 1020px；
      手機版斷點 700 → 720px 以接上 710px 的空隙。
- [x] 驗證：730–1600px 每 10px 掃描全部單行。版面左右維持原樣（使用者確認）。

### 庫存總覽未實現損益
- [x] `DashboardPage.tsx`: `HoldingRow` 新增 `rawUnrealized`（市值 − `rawCost`），
      與年度收益的 `rawRealized = sellGross − rawCostBasis` 同構。
- [x] 表格「未實現損益」欄改雙行，副行「未含費」；KPI 台股/美股各加「未含費」副行，
      台股原說明改為「主數字已預扣賣出手續費與證交稅」以區分兩個口徑。
- [x] 手算對帳：0050 買 100@120 費 50、現價 150 → 未含費 15000−12000=+3,000；
      含費扣手續費 21 與證交稅 15 後 +2,914。AAPL 買 10@100 費 5、現價 130 → +300 / +295。
- [x] `npm run build` 與 90/90 測試通過。

---

## 📅 Log: 2026-07-21 09:32:30 Asia/Taipei

- **Agent**: Gemini
- **Action**: Align project structure & persistent memory with `GEMINI.md`
- **Status**: COMPLETED

### Completed Tasks
- [x] 建立 `docs/agent/` 資料夾與持久記憶檔 (`PLAN.md`, `SPEC.md`, `PROGRESS.md`, `TASK.md`, `BUG_FIX.md`, `FIXED_BUG.md`)。
- [x] 重構文件目錄架構，將系統設計移至 `docs/architecture/`，資料庫 Schema 移至 `docs/database/`。
- [x] 前端 React + TypeScript 主體建置完成並通過測試（7/7 測試檔案、68/68 測試全數通過，包含 PnL 計算、CSV 匯入匯出與 App 煙霧測試）。
- [x] Dashboard 新增投入成本欄位，並將投入成本移至平均買入成本之前 (v0.2.4)。

---

## 📅 Log: 2026-07-21 09:52:39 Asia/Taipei

- **Agent**: Claude
- **Action**: 規劃交易紀錄搜尋欄位功能（Task 4），含完整功能規格與測試項目
- **Status**: COMPLETED（規劃）；實作待 agy 執行，Claude 負責 review

### Notes
- 規格與測試項目詳見 `TASK.md` Task 4。
- 關鍵設計決策：純函式過濾（`txSearch.ts`）、名稱比對需含 `displayStockName` 中文譯名、
  「刪除選取」計數需改為「勾選且可見」、CSV 匯出不受過濾影響。

---

## 📅 Log: 2026-07-21 09:58:00 Asia/Taipei

- **Agent**: Gemini
- **Action**: 實作交易紀錄搜尋欄位與過濾功能 (v0.2.5)
- **Status**: COMPLETED

### Completed Tasks
- [x] 建立純函式過濾模組 `txSearch.ts`，支援代號子字串、原始名稱與美股中文譯名 (`displayStockName`) 即時過濾。
- [x] 撰寫單元測試 `txSearch.test.ts`（涵蓋 U1–U8 全部測試案例，全數通過）。
- [x] 整合 `TransactionsPage.tsx` 工具列：新增搜尋輸入框、清除按鈕、筆數提示（「顯示 X / Y 筆」）與無結果提示畫面。
- [x] 修正勾選與刪除選取邏輯：「全選」與「刪除選取（n）」僅作用於當前過濾可見之列，過濾條件改變時保留既有勾選狀態。
- [x] 撰寫 UI 整合測試 `TransactionsPage.test.tsx`（涵蓋 I1–I7 全部測試案例，全數通過）。
- [x] 更新版號與文件：Bump package.json 至 `0.2.5`、`App.tsx` 的 `APP_VERSION` 至 `v0.2.5`、更新 `README.md`。
- [x] 驗證：`npm run lint`（0 error）、`npm test`（9/9 檔案、83/83 測試全數通過）、`npm run build`（打包成功）。

---

## 📅 Log: 2026-07-21 10:00:30 Asia/Taipei

- **Agent**: Claude
- **Action**: Task 4 Code Review（交易紀錄搜尋欄位 v0.2.5）
- **Status**: APPROVED（可 commit）

### Review 結果
- 規格 1–8 全數符合：純函式 `txSearch.ts`、displayStockName 中文譯名比對、filter→sort、
  筆數提示、勾選保留、無結果狀態區分、CSV 匯出未受影響、切換工作區清空搜尋。
- 「刪除選取」計數與刪除範圍已統一為「勾選且可見」（`visibleSelectedCount`），
  且批次刪除後只移除已刪 id、保留隱藏勾選——優於原規格的清空做法。
- 驗證：`npm test` 9 檔 83/83 通過、`npm run lint` 僅既有 3 個 fast-refresh 警告、
  `npm run build` 成功。
- 輕微議題（不擋驗收，留待後續順手處理）：
  1. `TransactionsPage.test.tsx` I5 直接覆寫 `window.confirm` 未還原，建議改用
     `vi.spyOn(window, 'confirm')` + afterEach 還原，避免測試順序耦合。
  2. 無結果狀態存在兩個「清除搜尋」同名按鈕（輸入框 X 與空狀態按鈕），
     螢幕閱讀器辨識略有重複；可改為不同 aria-label。
  3. 空狀態按鈕使用 inline style `marginTop`，可移入 CSS class。
- Scope 備註：`App.tsx`（APP_VERSION）與 `README.md` 版本紀錄不在原 Allowed Changes 清單，
  但屬既有版本 bump 慣例，予以接受；未來規劃時應將此二檔納入清單。

---

## 📅 Log: 2026-07-21 12:03:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Action**: 實作年度收益頁面三項功能 (v0.2.6)
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx`: 移除表格排序，替換為純 HelpTh 表頭。
- [x] `DashboardPage.tsx`: 將 HelpTh 抽離至 `Common/HelpTh.tsx` 供共用。
- [x] `pnlEngine.ts`: 新增 `SellDetail` 介面，於 `YearTickerDetail` 紀錄逐筆賣出明細與超賣狀態。
- [x] `YearlyPage.tsx`: 實作第三層明細展開 (`expandedTickers`)，顯示逐筆賣出明細 (`.sell-row`)。
- [x] `pnlEngine.ts`: 於 `LedgerSummary` 新增 `buyCount` 與 `sellCount` 歷史累計買賣筆數。
- [x] `YearlyPage.tsx`: 於交易筆數 KPI 下方顯示買入/賣出拆分。
- [x] `pnlEngine.test.ts`: 新增 SellDetail 運算邏輯與買賣筆數測試驗證。
- [x] `package.json`: 版號更新至 0.2.6。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 12:35:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 年度收益視覺調整（使用者回饋，隨 v0.2.6 後續，commit 06b7be7）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx` + `index.css`: 三層縮排改固定 32px 一層（`.cell-tree` flex 排版），無展開鈕的列以 `.toggle-slot` 空槽補位，圖示/文字垂直對齊。
- [x] `index.css`: 年度表格加 `.table-scroll-y`（max-height 480px 垂直捲動 + sticky 表頭，底色 `--panel`）。
- [x] 逐筆賣出明細分隔符「@」改為「｜」。
- [x] Playwright 目測驗證對齊/捲動/釘選表頭，`npm run build` 與 85/85 測試通過，Pages 部署成功。

---

## 📅 Log: 2026-07-21 13:05:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 年度收益縮排再調整（使用者回饋：圖示排一直線、逐筆明細貼齊父層）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx`: 展開圖示改為全層級同一直欄（拿掉個股列的 32px 縮排），層級由列底色與字重呈現。
- [x] `YearlyPage.tsx`: 逐筆賣出文字縮排 96px → 32px，貼齊父層個股文字起點。
- [x] Playwright 驗證各層圖示/文字座標對齊，build 與 85/85 測試通過。

---

## 📅 Log: 2026-07-21 13:40:00 Asia/Taipei

- **Agent**: agy (delegated)，Claude 規劃/review/驗證
- **Action**: 年度收益展開圖示置中修正 + 分區「全部展開/全部收起」按鈕
- **Status**: COMPLETED

### Completed Tasks
- [x] `index.css`: `.year-toggle` 補 `padding: 0`（根因：全域 border-box 下瀏覽器預設按鈕 padding 擠壓 22px 盒，圖示偏移；修後 svg 與按鈕中心偏差 0px）。
- [x] `YearlyPage.tsx`: 各分區標題右側新增 `.btn btn-sm`「全部展開/全部收起」，一鍵開合該分區所有年度與逐筆賣出明細。
- [x] Playwright 驗證置中與開合行為，build 與 85/85 測試通過。

---

## 📅 Log: 2026-07-21 14:00:00 Asia/Taipei

- **Agent**: Claude
- **Action**: 移除年度收益表格垂直捲動（使用者回饋：不要上下拉 bar）
- **Status**: COMPLETED

### Completed Tasks
- [x] `YearlyPage.tsx` / `index.css`: 移除 `.table-scroll-y`（480px 高度上限、sticky 表頭），表格恢復完整展開。
- [x] build 與 85/85 測試通過。

## 📅 Log: 2026-07-21 14:05:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: 歷史累計手續費拆分 (v0.2.7)
- **Status**: COMPLETED

### Completed Tasks
- [x] `pnlEngine.ts`: 於 `LedgerSummary` 新增 `feesBrokerage` 與 `feesTax`，並透過稅率反推估算手續費與交易稅。
- [x] `YearlyPage.tsx`: 將年度收益頁面的歷史累計手續費 KPI 拆分為手續費與交易稅雙行顯示。
- [x] `pnlEngine.test.ts`: 新增手續費與交易稅估算之測試案例驗證，確保拆分邏輯與總和不變。
- [x] `package.json` 與 `App.tsx`: 版號更新至 0.2.7。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 15:30:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: 年度明細下放手續費/交易稅拆分 (v0.2.8)
- **Status**: COMPLETED

### Completed Tasks
- [x] `pnlEngine.ts`: 於 `YearSummary`, `YearTickerDetail`, `SellDetail` 實作 `feesTax` 屬性與累加機制。
- [x] `YearlyPage.tsx`: 將年度、個股、逐筆賣出明細層級的手續費欄位，改用新增的 `FeeCell` 元件，顯示費稅拆分副行。
- [x] `YearlyPage.tsx`: 修正歷史累計手續費 KPI 與交易筆數 KPI 標籤（新增標註台美股合計）。
- [x] `pnlEngine.test.ts`: 擴展手續費測試，加入 invariants（年度總和 = 各個股總和）與各層級欄位斷言。
- [x] `package.json` 與 `App.tsx`: 版號更新至 0.2.8。
- [x] 更新文件 `SPEC.md`, `PROGRESS.md`, `TASK.md`。
- [x] 通過 `npm test` 與 `npx tsc --noEmit` 驗證。

---

## 📅 Log: 2026-07-21 16:30:00 Asia/Taipei

- **Agent**: agy (delegated)
- **Planner**: Claude
- **Action**: Fix header wrapping & clarify unrealized P&L gap in UI (v0.3.2)
- **Status**: COMPLETED

### Completed Tasks
- [x] `index.css`: Fixed header wrapping in Supabase mode by moving `.app-header-inner`, `.tab`, and `.user-email` rules out of `@media (max-width: 1180px)` into unconditional rules. Root cause: fixed 1180px container makes viewport media queries ineffective above that width; local mode masked it because its meta area is much narrower than Supabase mode's email+logout.
- [x] `index.css`: Bounded `.ws-select select` with `max-width: 180px` unconditionally to prevent long workspace names from pushing the row over.
- [x] `DashboardPage.tsx`: Clarified the unrealized P&L fee gap tooltip text in table cells, KPIs, and help icon, detailing the gap composition (buy fee + estimated sell fee/tax, and buy fee only for US stocks).
- [x] `package.json`: Bumped version to `0.3.2`.
- [x] Verified with `npm run build` and `npm test -- --run`.

### Claude review 補正
- [x] agy 的修正解決了寬螢幕（≥1220px）的換行，但 review 時實測發現
      **窄寬度 + Supabase 模式仍換行**（1024 / 800 / 730px）：email 截斷後仍佔 132px，
      而窄寬度斷點當初是照本機模式調的。補一條 `@media (max-width: 1220px) { .user-email { display: none } }`
      ——完整信箱本來就在登出鈕的 title，收起不會遺失資訊。
- [x] 註解修正：原本寫「先收間距」與「手機版 ≤700px」，與實際的無條件套用及 720px 斷點不符；
      並補記「調整斷點務必以 Supabase 模式驗證」的教訓。
- [x] 驗證：**兩種模式**各自 730–1920px 每 10px 掃描，全部單行；`npm run build` 與 90/90 測試通過。

### 教訓
- 本機模式的「本機模式」標籤比 Supabase 模式的 email + 登出鈕窄約 140px，
  只測本機模式會漏掉正式環境的版面問題。往後頁首相關變更一律以 Supabase 模式為準。

---

## 2026-07-21 15:58:00 Asia/Taipei — 版本徽章回歸左下角、未實現損益改稱「淨」(v0.3.3)

- **Agent**: Claude（小幅 UI 調整，未達委派 agy 的損益平衡點）
- **Action**: Relocate version stamp; rename unrealized P&L to 「淨損益」
- **Status**: COMPLETED

### Completed Tasks
- [x] 新增 `src/version.ts` 作為版本資訊**單一來源**（`APP_VERSION` / `APP_AUTHOR`）。
      先前 v0.3.0 把版號硬編在 `ServiceStatusPage.tsx`，與 `package.json` 各走各的，已漂移成 `v0.3` vs `0.3.2`。
- [x] `App.tsx` + `index.css`：還原 v0.2.8 的 `.version-badge`（fixed、左下 14/12px、`pointer-events: none` 不擋點擊）。
- [x] `ServiceStatusPage.tsx`：移除「版本戳記」區塊；`runHealthCheck(APP_VERSION)` 改用共用常數，
      「應用程式」元件的檢測註記仍帶版號，功能不受影響。
- [x] `DashboardPage.tsx`：表格欄位與兩張 KPI 一律改名為「未實現淨損益」；
      欄位 `?` 說明改以「『淨』代表把交易成本都算進去」開頭，明列買入手續費 / 台股賣出手續費 + 證交稅。
- [x] `DashboardPage.tsx`：台股 KPI 的「主數字已預扣賣出手續費與證交稅」那行改收進卡片標題 `title` tooltip；
      美股 KPI 標題同步補 tooltip 說明「不預扣賣出費用」，避免「淨」字被誤讀為兩市場口徑相同。
- [x] `App.smoke.test.tsx`：新增 2 個測試鎖住上述行為（徽章存在且含版號、狀態頁無「版本戳記」、
      KPI 名稱與 tooltip、預扣說明不再單獨成行），並在既有流程補驗表頭為「未實現淨損益」。
- [x] `package.json` 版本 bump 至 `0.3.3`。
- [x] 驗證：`npm run build` 通過；`npm test -- --run` 92/92 通過（原 90 + 新增 2）。

### 教訓
- `/verify` skill 記載的 Playwright 走法**此環境已失效**（`~/.npm/_npx` 快取與 `~/.cache/ms-playwright` 皆已無 playwright，
  npx 快取本來就會被清）。這次改以既有的 `App.smoke.test.tsx`（jsdom + Testing Library）驗證 UI 文案與 DOM，
  比一次性的瀏覽器腳本更耐久，且變成回歸測試。往後 UI 文案 / 結構類驗證優先走 smoke test，
  真正需要像素或版面掃描（例如頁首換行）時才補裝 Playwright。

---

## 2026-07-21 16:05:00 Asia/Taipei — 全站說明文案改寫為白話短句 (v0.3.4)

- **Agent**: Claude（文案判斷密集，不適合委派）
- **Action**: Rewrite all user-facing help text for stock novices
- **Status**: COMPLETED

### 背景
使用者回報既有說明「太長太攏統」，且**目標讀者是不熟股票的人**。
原文案的問題不是資訊錯誤，而是把公式（`市值 − 未含費成本`）、
交叉引用（「與年度收益頁的口徑一致」）、次要但書（「各券商收費結構差異大」）
全塞進同一段 tooltip，novice 讀不完也讀不懂。

### 改寫原則（後續新增文案請沿用）
1. **短句白話**，一則說明以 1–2 句為限。
2. **不放公式**：講「這些股票現在值多少錢」，不講「現價 × 持有股數」。
3. **去除內行黑話**：拿掉「移動平均成本法」「同口徑」「純價差」「反推」等詞。
4. **砍掉次要但書與交叉引用**，只保留使用者當下做決定需要知道的事。
5. 保留關鍵事實：費用是否計入、資料是否延遲、數字涵蓋範圍。

### Completed Tasks
- [x] `DashboardPage.tsx`：10 條欄位說明 + 8 個 inline tooltip 全面改寫。
      最長的 `unrealized` 由 5 句/約 130 字縮到 2 句。
- [x] `YearlyReport/columnHelp.ts`：6 條年度欄位說明改寫。
- [x] `YearlyPage.tsx`：超賣 badge、只買未賣、交易稅估算 3 個 tooltip 與空狀態文案。
- [x] `ServiceStatusPage.tsx`：「關於本專案」由技術規格（Edge Function、localStorage 降級）
      改為使用者視角的一句話；uptime 條說明白話化。
- [x] `AppShell.tsx` / `RecalcFeesModal.tsx` / `TransactionForm.tsx` / `TransactionsPage.tsx`：
      費率、最低手續費、證交稅、批次重算等 field-hint 與按鈕 tooltip 白話化。
- [x] `utils/csv.ts`：多工作區匯出檔的拒絕訊息改寫（原文用「成本互相污染」）。
- [x] `App.smoke.test.tsx`：同步更新被鎖住的 tooltip 斷言。
- [x] `package.json` + `src/version.ts` bump 至 `0.3.4`。
- [x] 驗證：`npm run build` 通過；`npm test -- --run` 92/92 通過。

### 未更動（刻意）
- 程式碼註解（`/** */`、`//`）維持技術寫法——那是寫給後續 Agent 與開發者看的，
  與畫面上的說明文字是兩個不同的讀者群，不可一起「簡化」。
- 欄位名稱本身未動，只動說明。

---

## 🚧 Next Steps
1. 設定 GitHub Actions 自動部署流程 (Task 2)。
2. 配合使用者引導完成 Supabase 專案連結與 Edge Function `stock-price` 部署 (Task 3)。
