# Fixed Bugs History (FIXED_BUG.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-31 18:20:00 Asia/Taipei

---

## 🐛 Historical Bug Fixes

### Bug ID: BUG-012 — The admin schedule printed the raw cron string, so 15:00 never appeared
- **Date**: 2026-08-05 (introduced in 0.6.38, fixed in 0.6.39)
- **Discovered by**: The user, reading the admin console: "後台的排程好像沒有提到 15:00 的排程".
- **Symptom**: After `market-daily` moved to `0,30 7-10 * * 1-5`, the 排程 table showed that expression verbatim
  instead of a sentence. One row of an otherwise readable table was unreadable, and since the raw string is in UTC
  the page never mentioned 15:00 anywhere.
- **Root Cause**: `describeCron` in `timeline.ts` has one branch per shift shape and falls back to `return expr`.
  It covered step syntax, a daily hour list, and a single-minute hour range —— but not **a minute list inside an
  hour range**, which is exactly the shape 0.6.38 introduced. Changing the cron and not teaching the formatter is
  the whole bug: the schedule display is derived from `cron.job`, so it was correct and unreadable at once.
- **Impact**: Display only, admin console only. The schedule itself ran correctly the whole time.
- **Fix**: A branch for `M[,M…] H1-H2 * * 1-5` rendering 「週一至週五 15:00–18:30 每 30 分」. It sits **below** the
  single-minute branch and requires at least one comma, so `0 8-10 * * 1-5` keeps listing its three shifts one by
  one —— three times reads better than "每 60 分".
- **Tests**: `timeline.test.ts` two entries (the new shape, and a control that the old shape is still listed).
- **Status**: ✅ FIXED (0.6.39) and live —— pure frontend, shipped with the merge to `main`.
- **Timestamp**: 2026-08-05 23:00:00 Asia/Taipei

### Bug ID: BUG-011 — The after-close lock froze an intraday snapshot until the next morning
- **Date**: 2026-08-05 (introduced in 0.6.36, fixed in 0.6.37)
- **Discovered by**: Production, on the same day 0.6.36 went live.
- **Symptom**: After 13:30 the quote card on the individual-stock analysis page kept reading "盤中",
  and open / high / low / volume / previous close were all "—", with no way to recover before 08:25 the next day.
- **Root Cause**: `twQuoteTtlMs` locked the quote on the clock alone — "it is past 13:30, so no new price will arrive
  today". That reasoning holds for the **price**, but not for **"is this row the settled closing value"**.
  Rows lacking `trade_time` are intraday snapshots: written before the 0.6.36 column upgrade, or coming from a fallback
  path that has no such field (Yahoo / TWSE OpenAPI). 0.6.36 explicitly chose not to let a missing `t` block the lock,
  and the production upgrade at 16:47 left exactly such pre-upgrade rows in `price_cache`.
  The 13:30–14:00 grace window did not help either: it only covered a `t` that existed but was too early, and it expired
  at 14:00, after which even a stuck intraday matching time was frozen for the whole night.
- **Impact**: Production only, after 13:30 on 2026-08-05. Display layer only — no wrong number was ever shown,
  the card simply stopped updating and showed placeholders.
- **Fix**: `quoteWindow.ts` — the lock now requires a confirmed close (`tradeTime >= '13:30:00'`); a missing or earlier
  `t` returns the 60-second TTL at any hour, and the 14:00 `CONFIRM_MS` deadline is gone.
  A new `twMaxTtlMs(now)` supplies the upper bound for the `freshAfter` coarse filter in `stock-price/index.ts`,
  which cannot know each row's `trade_time` — without it the coarse filter would drop yesterday's settled close
  and refetch all night.
- **Tests**: `quoteWindow.test.ts` (rewritten around the new rule, including the case that locks the old behaviour out)
  and `priceProxy.test.ts`; whole suite 877 passed across 57 files.
- **Status**: ✅ FIXED and **live in both environments** (0.6.37). The browser half shipped with the push to `main`;
  the Edge half was deployed at 20:57 (dev v10 → **v11**) and 20:58 (prod v14 → **v15**), `verify_jwt` staying `true`.
  Evidence that it is the new code: `ezbr_sha256` moved from `00ce1004…` (the 0.6.36 build both environments shared)
  to `733891b768b2…`, **identical in both** — see Task 71 for why the sha, not the version number, is the evidence.
- **Timestamp**: 2026-08-05 21:05:00 Asia/Taipei

### Bug ID: BUG-010 — All legal entities in the market were received on time, but were drawn off-axis and judged as "delayed"
- **Date**: 2026-08-05 (introduced in 0.6.33, fixed in 0.6.36-dev.2)
- **Discovered by**: The user looked at the screen and reported "After the train started at 16:00, the status is still the same. Is this a BUG?"
- **Symptom**: The background timeline title stops at "Taiwan stock market after-hours round 2026-08-04",
  The data date in the "Three Major Legal Persons·All Markets" column is already 2026-08-05 - contradictory on the same axis.
  This column is also labeled "Delay" and is pasted to the far right of the axis.
- **Evidence** (actual measurement in test area on 2026-08-05):
  `market/daily.json`’s `asOf = 2026-08-05T08:00:04Z` (Taipei 16:00:04), the last `date = 2026-08-05`;
  And `chip.dataDate` is still `2026-08-04` (T86 will not be available until the 16:30 round, `batch_run_log`
  16:00 / 16:15 The two columns `t86_today = false` can be verified, and the column will be converted to `true` at 16:30).
  With 8/4 15:00 as the origin, `hoursFromBase` gets **25 hours**, `tlPercent(25)` = 131% is clipped to 100%,
  `judgeSource` is judged as `late` because 25 > `dueBy 3 + 0.25`.
- **Root Cause**: The base date of the timeline is taken from a single source (`chip.ymd` / `chip.dataDate`, individual stock chip report),
  But the five columns on the axis are from different batches: individual stock T86 post-market batch (16:30),
  The whole market BFI82U is scheduled independently `market-daily` (16:00). The column running faster must cross the coordinates of the epicycle.
- **Impact**: Between 16:00 and 16:30 on each trading day, the market-wide column that has been acquired on time will always have a red light.
  An always-on warning is equivalent to no warning - which is exactly against the principles set by `timeline.ts` itself.
  The data itself is completely correct, it is purely a display layer issue.
- **Fix**: `timeline.ts` adds `roundBaseYmd()`, and the base date is changed to the **maximum value of each source data**;
  The title and axis coordinates share the same base. Whether it belongs to this round is determined by "whether the timestamp falls within the axis range [0, TL_SPAN_HOURS]".
  Rather than comparing the date - because **The self-reported date for borrowing securities is the announcement date (the next trading day)**, which is naturally one day longer than the current round.
  Comparing it with it will cause the only column that should have a red light to be regarded as not caught; similarly, it will not participate in the calculation of `roundBaseYmd`.
- **Tests**: `timeline.test.ts` 4 items (including the control that directly locks the old behavior of "25 hours → late"),
  `AdminStatusPage.test.tsx` 1 transaction (when the whole market comes first, the title will jump, the individual stocks will show waiting and the old date will not be displayed).
- **Status**: ✅ FIXED (0.6.36-dev.2) and live — pure front-end, shipped with the 0.6.36 merge to `main` at 16:55.
- **Timestamp**: 2026-08-05 16:35:00 Asia/Taipei

### Bug ID: BUG-009 — The three major legal entities arrived on time but were judged to be "delayed" by three seconds.
- **Date**: 2026-07-31 (introduced in 0.6.13, fixed in 0.6.16)
- **Discovered by**: The user looked at the screen and reported "What does the delay here mean?"
- **Symptom**: On the Taiwan stock after-hours timeline on the "Capture Status" page, the three major legal entities display "Delay" in red.
  However, the daily K-line captured at the same time (16:30) shows green "normal". Caught at the same moment, one red and one green.
- **Evidence** (2026-07-31 official area test):
  `20260731/0050.json` of `sources.institutional.fetchedAt = 2026-07-31T08:30:03.218Z`
  =Taipei **16:30:03**, **1.5009 hours** from base 15:00;
  And `TW_CHAIN.institutional.dueBy = 1.5` (= 16:30:00 sharp).
- **Root Cause**: `fetchedHour > spec.dueBy` judgment for `judgeSource()`,
  The semantics of `dueBy` is originally "**which round**" (the after-hours batch is every 15 minutes, the 16:30 round),
  But it is written as a moment accurate to the second. The 16:30 round actually finished writing Storage at 16:30:03.
  **Crossed the threshold in three seconds**. The `dueBy` of the daily K-line is 2 (17:00), so it’s okay——
  The two were caught at the same moment but had different colors, precisely because the thresholds were different.
- **Fix**: Added `ROUND_GRACE_HOURS = 0.25` (the length of one round), and changed the judgment to
  `fetchedHour > spec.dueBy + ROUND_GRACE_HOURS`. The semantics returns to "falling within that round is considered on time."
- **Changed Files**: `sources/src/components/Admin/timeline.ts`、`timeline.test.ts`、
  `AdminStatusPage.tsx` (Supplementary explanation of legend)
- **Lesson**: **The unit semantics of the constant must be consistent with the predicate. ** `dueBy` wants to express "which round",
  But use it to directly compare the size with a timestamp accurate to milliseconds - this kind of "discrete intention, continuous comparison"
  As long as the boundaries are aligned, something will happen, and off-by-seconds are easy to miss in testing.
  (The original tests used values ​​such as 1.25 and 18.167 that are far away from the boundary).
  The new test specifically uses a welt value of `dueBy + 0.0009` to pin it.
- **Confusion fixed by the way**: The legend only says "Source Release Window", so the user asked
  "Aren't the three major legal entities originally open from 16:00 to 23:45 every 15 minutes from Monday to Friday?"——
  That is **our batch schedule**, and the light-colored block is **the time when the stock exchange releases the information**, and they are different.
  The legend has made up for this difference.
- **Verification**: ✅ `npm test` 721/721 (2 new welt tests), build passed,
  lint has only three existing warning and Playwright four widths, dark and light, and are scanned in full.

### Bug ID: BUG-008 — The general economic data is always one day behind, and is always one day behind every month during the winter period.
- **Date**: 2026-07-31 (introduced in 0.6.5-dev.2, fixed in 0.6.11-dev.1)
- **Discovered by**: User reported "But there has been an update to PCE, but I didn't catch it?"
- **Symptom**: The core PCE on the general economy page is stuck at 2026-05, while it is already there on 2026-06 on FRED.
  Same for both zones (official/test). The "data updated on" on the screen shows 2026-07-30 21:00,
  It seems that the schedule has been run, but the data is old.
- **Evidence chain** (2026-07-31 12:03 Taipei actual measurement):
  1. **Online file**: `asOf = 2026-07-30T13:00:01Z` of `macro/us.json` in both areas (Taipei 7/30 21:00),
     `PCEPILFE.latest.period = '2026-05'`。
  2. **FRED Current Status**: `PCEPILFE` already has `2026-06-01,130.266`.
  3. **ALFRED vintage comparison** (key): `vintage_date=2026-07-29` only goes to 2026-05 (value 130.082);
     `vintage_date=2026-07-30` **Already has 2026-06**, and at the same time 2026-05 is corrected to 130.094.
     ⇒ 2026-06 That item was put on the shelves on **7/30**.
  4. **Cross-validation captures the current status**: PCE yoy of the online file = 3.41%, and the corresponding base period is
     **The corrected** 130.094 - proves that the 13:00 UTC class did capture the updated sequence that day,
     It’s just that the 2026-06 sum has not entered FRED at that point in time.
- **Root Cause**: The idempotent key of `syncMacro()` is **Taipei Calendar Day**
  （`taipeiDateOf(existing.asOf) === today` At once return）。
  The purpose of `macro-daily` arranging two shifts (13:00 / 15:00 UTC) is "if the first shift fails to receive the call, the second shift will make up for it".
  But when the first class "**successfully** captures a piece of data that has not been updated", it will write `asOf` = today,
  As soon as the second shift saw the same Taipei day, it skipped it without sending a single request - the retry shift designed specifically for this purpose was useless.
  BEA releases at 8:30 US Eastern = 12:30 UTC in summer, it will take longer for FRED to be imported from BEA, and it cannot be received at 13:00;
  The winter release time is 13:30 UTC, and the 13:00 class** even runs before the release**,
  Therefore, the data for each month during the winter period is fixed to be one day slower. `schema.sql` §9 Original annotation
  "The two shifts fall behind summer and winter respectively." But he didn't realize that the success of the first shift would cause the second shift to never be executed -
  Design intent and implementation cancel each other out.
- **Fix**:
  - `usMacro.ts` adds `macroFingerprint(indicators)` pure function (reuses `pollPlan.ts`
    `fingerprint`), `syncMacro` is changed to **catch first, compare later, write only when changed**, and remove the date short circuit.
  - The fingerprint** covers the entire period of points, not just the latest period**: FRED will go back and correct the historical values.
    (This vintage has been changed to 2026-04 and 2026-05 at the same time, and the latest issue has not changed),
    Just comparing it to latest will make this type of revision never catch up.
  - `MacroFile` adds `checkedAt` (the last time FRED was asked), and `asOf`
    (Last change time of data) separation. When the content has not changed, only `checkedAt` is updated and `asOf` is left unchanged.
  - The front end will supplementally display "(last check...)" when the two days are different, otherwise the user will see a
    The date didn't move for several days and I thought it was broken.
  - `syncFx` **Deliberately not following up**: The exchange rate is closed at a new price every trading day, and the one who gets it at 03:00 will definitely get it.
    It is already a complete daily line of the previous trading day, and the second shift cannot make up for anything. Changing the fingerprint will only determine "changed" every time.
- **Changed Files**: `sources/supabase/functions/stock-report/usMacro.ts`、
  `usMacro.test.ts`, `index.ts`, `sources/supabase/schema.sql` (**annotation only**),
  `sources/supabase/README.md`、`sources/src/services/macroProxy.ts`、
  `sources/src/components/Macro/MacroPage.tsx`、`MacroPage.test.tsx`、
  `sources/src/components/StockDetail/aiPayload.test.ts`
- **Lesson**: **"Executed today" does not mean "got new data today". ** Use dates as idempotent keys,
  It is equivalent to assuming that "as soon as the scheduling time comes, the source will be ready" - this is true for the data you control,
  This is not true for external publishing schedules (especially across time zones and daylight savings time).
  For any design that "schedules multiple shifts and retries", the idempotent key must be **content** rather than time.
  Otherwise, the success of the first shift will silence all subsequent shifts, and the extra shifts are just psychological comfort.
  The price is just five more HTTP requests per day.
- **Verification**: ✅ `npm run lint` (only 3 existing warnings) / `npm run build` passed;
  `npm test` 632/632 (original 622 + new 10).
  ✅ **Online review in the test area (2026-07-31 12:37)**: After deployment, use `functions download` to compare file by file
  10 All files are consistent with `dev`. Hit `sync-macro` twice:
  The 1st time `reason: 'updated'`, `asOf=04:37:19.466Z`, 3892ms;
  The second time `reason: 'unchanged'`, **`asOf` completely unchanged**, 1020ms (FRED is really caught, not a short circuit).
  ⇒ The fingerprint is stable and does not fall into the sorting trap of BUG-004.
  `PCEPILFE.latest` of `macro/us.json` has been added from 2026-05 **2026-06 = 3.29%**,
  `checkedAt` is 4 seconds later than `asOf` (the second call only updates the check time), and the semantic separation is as expected.

### Bug ID: BUG-007 — The day’s margin trading can never be entered into the report, and the area on the chip page is always empty.
- **Date**: 2026-07-31 (introduced in 0.6.1-dev.1 `7e27a58`, fixed in 0.6.10)
- **Discovered by**: User reported "No data seems to be captured in this field of margin trading"
- **Symptom**: The margin trading table on the chip page of individual stock analysis is always displayed
  "Today's margin trading has not been announced yet (approximately 21:00–22:00), and the later schedule will be automatically added."
  The same goes for looking at it late at night and the next morning; the 7-day balance chart is always the latest day.
- **Evidence chain** (three sections tested separately, actual test at 2026-07-31 08:50):
  1. **Fetching and parsing are normal**: `rwd/zh/marginTrading/MI_MARGN?date=20260730` returns 200,
     `tables[1]` has 16 columns and `fields[0]='codename'`, which is completely consistent with `MARGIN_IDX`.
  2. **Cache normal**: Official area `20260729/0050.json`
     `sources.margin.fetchedAt = 2026-07-29T13:00:03Z` (Taipei 21:00)——
     That night's round did catch it and write it into `chip_raw_cache`.
  3. **Report has not been rewritten**: The official area manifest points to `20260730`, the file
     `generatedAt=2026-07-30T08:15:04Z` (Taipei 16:15), `margin: null`.
     And the copy of `20260729` was written at 16:00** the next day (`batch_run_log` can be checked by `taipei_ymd`,
     The first round of the next day `last=null` → `runSig` must be different → forced to re-produce), then the numbers 07-29 are brought.
- **Root Cause**: `index.ts` regenerates the gate's `runSignature` passed in
  `margin: series.marginDatedFailed ? '' : series.dataYmd`。
  `marginDatedFailed` asks "Have **any** been caught on one day in the past 7 days", there must be some historical days,
  So it is `false` all day long, and this section is equal to the constant `dataYmd` all day long.
  So at 21:00, the day's margin trading was captured in the round and written into the cache, but the **fingerprint did not change → `regenerate=false`**;
  21Starting from :15, `decideSkip` determines that `complete` is all short-circuited, and the `margin` reported that day will always stop at null.
- **Fix**:
  - `SeriesResult` adds `marginYmds` (the actual trading days of margin trading in the window, from old to new),
    `marginDatedFailed` is derived from it instead (the semantics remain the same, but it is more precisely limited to the days in the window).
  - Reproduce the gate to use `marginSigPart(series.marginYmds)` instead (a pure function of `pollPlan.ts`).
    As soon as the day's data arrives, the fingerprint will change, triggering a re-production; historical day replenishment is also covered.
- **Changed Files**: `sources/supabase/functions/stock-report/index.ts`、
  `pollPlan.ts`、`pollPlan.test.ts`
- **Lessons**: `pollPlan.test.ts` originally had a line "margin and securities lending from scratch → different fingerprints", and what was tested was a pure function
  (`margin: ''` vs `'b'') And the ** caller cannot produce `''`** at all - the purpose of the test has not been met by the implementation.
  Pure functional tests must also pin "what will be fed by the caller", otherwise they will test an input that does not exist.
- **Verification**: ✅ `npm run lint` / `npm run build` passed; `npm test` 622/622 (original 618 + new 4).
  Online (2026-07-31 09:15): Both areas have `functions deploy stock-report --no-verify-jwt`
  And use `functions download` to compare file by file to be the same as `main`; after triggering `generate-all` once,
  The `margin` of the official area `20260730/0050.json` is added (33,974 financing, `source: rwd`), `notes` is cleared,
  History has data for 7/7 days, and `sources.margin.fetchedAt = 2026-07-30T13:00:03Z` proves
  **The information was captured at 21:00 last night, but it could not be written into the report**.
  ⏳ Tonight’s round at 21:00 is the real regression verification (T86 has been frozen, only margin trading has come from scratch →
  Must `regenerated=true`).

### Bug ID: BUG-006 — The stock switching menu on the mobile phone is squeezed into a small piece, and only "18..." is visible.
- **Date**: 2026-07-29 (introduced in 0.6.7, fixed in 0.6.9-dev.1)
- **Discovered by**: Reported when the user switches to the mobile version, with screenshots attached
- **Symptom**: The stock switching menu at the top of the individual stock analysis page is only a few dozen pixels wide on mobile phones.
  The code name was truncated by ellipsis to "18...", and it is not clear which gear is currently selected.
  According to actual measurement, when 390px is reached, only **48px** is left in the container, and when 360px, only **33px** is left.
- **Root Cause**: There is an entry in `@media (max-width: 720px)` in `index.css`
  `.ws-select { flex: 1; min-width: 0 }`, the comment reads "The workspace menu eats up the remaining horizontal space at the top of the page"——
  **It is written for the top of the page**.

  The revision of BUG-005 allows the menu of individual stock analysis to also use `.ws-select` (in order to share the same appearance with the top of the page),
  So I inherited this mobile phone rule. The situations of the two containers are completely different:

  | | What else is in the same column |
  | ---- | ---- |
  | `.app-header` | Brand, workspace, account - plenty of space, `flex: 1` just fills up the remaining width |
  | `.detail-head` | Title (`flex: 1 1 auto`) + two buttons - four children competing for 390px |

  The `flex-basis` of `flex: 1` is **0**, when competing with the title of `flex: 1 1 auto` (basis is the content width),
  The allocated space approaches zero. The desktop computer is not visible because it is wide enough, only the mobile phone will explode.
- **Fix**: Convergence that rule into `.app-header .ws-select` (return to its original object),
  And give individual stock selections their own mobile behavior: `.detail-head .ws-select { flex: 1 0 100% }` has an exclusive column.
  By the way, let the title occupy its own column (`.detail-head .detail-title { flex: 1 0 100% }`),
  Only two buttons will be in the same column - otherwise the title will eat up the middle width and only squeeze the next one, pushing the other to the fourth column.
- **Verification**: Playwright size 320/360/390/430/720/721/1280px Seven widths:
  The trigger buttons are all 105px, the code is zero truncation, the two buttons are in the same column, and there is no horizontal overflow;
  The long stock name "00929 Fuhua Taiwan Technology Premium" (200px) is still fully displayed under 390px.
  Also confirm that the top workspace menu is not affected (still `flex: 1/1/0%`, container 252~612px).
- **Lesson**: **Before sharing a class, check who its media query is written for. **
  BUG-005 It is right to let the two places share the appearance, but sharing the class is equivalent to inheriting all breakpoint rules together——
  And those rules often carry the implicit premise of "the original container."
  The specific method this time is to add the container-specific rules to the ancestor selector (`.app-header .ws-select`).
  Make its scope of application consistent with the annotation description.

### Bug ID: BUG-005 — The stock switching drop-down of individual stock analysis degenerates into a native select without style
- **Date**: 2026-07-29 (introduced in 0.6.6, fixed in 0.6.7-dev.1)
- **Discovered by**: User reported that "the drop-down box for individual stock analysis looks different from the box at the top of the page", screenshot attached
- **Symptom**: The individual stock switch in the upper left corner of the individual stock analysis page becomes the default white background box of the browser starting from 0.6.6
  (No dark bottom, no rounded corners, no borders, chevron is also missing), it is very abrupt on the dark interface with glass quasi-object style.
  The workspace menu at the top of the page is normal.
- **Root Cause**: 0.6.6 (commit `674fa75`, bottom navigation bar of mobile phone) deleted `index.css`
  `.ws-select select` and `.ws-select select option` are the entire paragraph, and the commit description is written
  "After dev.3, you can no longer select dead CSS of any element."

  **That judgment only holds true for the top of the page. ** The workspace selector at the top of the page was indeed replaced in 0.6.5-dev.3
  `HeaderMenu` (`<button>`), but `AnalysisPage.tsx` is still used from beginning to end
  `<div class="ws-select"><select>` - that piece of CSS has always been effective.

  The misjudgment is because "use grep to find `.ws-select select` this **selector string**" and cannot find anything:
  It is made up of `<div className="ws-select">` and `<select>` in it.
  No line of source code looks like that selector.
- **Fix**: It’s not about filling the CSS back, but converging the two places into the same component——
  `HeaderMenu` moved from `AppShell.tsx` to `components/Common/HeaderMenu.tsx`,
  `AnalysisPage` uses it instead (the trigger button continues to use `.hmenu-ws`, and according to the user's choice, the front icon is not placed and only chevron is left;
  List using `menuitemradio` + Check, consistent with the workspace menu).
  Keeping a copy of each style is the reason why the clock will run this time. Adding CSS will only make it run again next time.
- **By the way, fix two points that would have caused problems** (only new callers will step on them):
  - `.hmenu-pop` is `right: 0` (designed for the menu on the right side of the page header). The stock selection menu is on the **left** of the screen.
    If used, it will expand to the left and go out of the screen → Added `.hmenu-pop-left`.
  - There is no height limit for the pop-up layer. When holding dozens of stocks, the list will grow beyond the window → Add `.hmenu-pop-scroll`.
- **Verification**: `AnalysisPage.test.tsx` changed from `selectOptions(combobox)` to
  Click the button → click `menuitemradio`, and add three new cases (the trigger button displays the current file,
  `aria-checked` of the selected item is the only one and will be automatically closed after selection). 568 tests all green.
- **Lesson**: **Search for the class name before deleting CSS, do not search for the complete selector. **
  Compound selectors (`.a b`) never appear literally in JSX.
  This time the search is for `ws-select` (two .tsx hits), not `.ws-select select` (zero hits).

### Bug ID: BUG-004 — The column order of T86 is different every time, causing the polling to never wait until it is finalized and the work never ends.
- **Date**: 2026-07-27 (0.6.1 was discovered and fixed the night it went online, 0.6.2)
- **Discovered by**: Claude, look at the first batch of measured data in the official area `batch_run_log`
- **Symptom**: `t86_unchanged` jumps between 0/1, **cannot reach `T86_STABLE_POLLS = 2`**,
  So `t86_frozen` is always false and `decideSkip` is never short-circuited. Really catch all 32 rounds a day,
  0.6.1 The three gates are all useless, and `generatedAt` also jumps every round.

  ```
  20:30 u=0 regen=true   21:15 u=1 regen=false   21:45 u=0 regen=true
  20:45 u=0 regen=true   21:30 u=0 regen=true    22:00 u=1 regen=false
  21:00 u=0 regen=true
  ```

- **Root Cause**: Catch `rwd/zh/fund/T86` twice directly (with an interval of 3 seconds),
  The length is the same 194,959 bytes but the bytes are different. After comparing column by column:
  **1334 The contents of the columns are exactly the same as the set, except that the order of 7 columns has been changed**——
  Between the columns with the same last column, the sorting of the endpoints is unstable.
  `fingerprint()` is calculated on `JSON.stringify`, and the fingerprint will change as soon as the order changes.
  So each round is judged as "rewritten again" by `nextT86State`.
- **Fix**: Added `t86Fingerprint()` in `pollPlan.ts`: **sort** after joining each column of `data`,
  Only take the `date` / `total` / sorted columns to calculate. All four T86 fingerprint calls in `index.ts` use it instead.
  The remaining fields (title/fields/notes/hints) are intentionally excluded - that's a fixed template,
  And quickly remove Postgres jsonb, **jsonb will rearrange the keys of objects**, which is a second independent source of instability.
- **Verification**: ✅ **Passed** (2026-07-27 23:00, official area).
  Offline: Verify with two actually captured files - the bytes before correction are different, but the semantic fingerprints after correction are the same.
  Plus 6 tests, including two reverse cases of "the real rewrite can still be measured" and "one less column"
  (To avoid overdoing it and not being able to detect anything).
  Online: Four rounds after deployment completed the expected path, **in contrast to the 0/1 shock before repair**:

  ```
  22:15 u=0 frozen=false regen=true 8509ms ← Change algorithm and restart
  22:30 u=1 frozen=false regen=false 8467ms
  22:45 h=2 frozen=true rain=false 7749ms ← Finalize
  23:00 u=2 frozen=true skip=true/complete 753ms ← short circuit, zero external capture
  ```

  Summary of the day: 13 rounds / 1 short circuit / 6 heavy productions; short circuit average **753ms**, actual running average **10,025ms**.
  The final time for T86 is 22:45, and the earliest time for margin trading is 21:00.
  (753ms, not "tens of milliseconds": the short-circuit path is still 3 Postgres round-trips -
  Read the status of the previous round, check today's cache, and write the observation column. The key point is **zero external crawling**. )
  ⚠️ The number `t86_revisions=5` is **untrustworthy today**: it contains fake rewrites fed by byte noise before repair.
  The first clean numbers will be tomorrow.
- **Lessons**: **To use content fingerprints as a criterion for "whether something has changed", it must first be formalized to the semantic layer. **
  External endpoints have no obligation to ensure serialization stability - column order here, key order over jsonb,
  Two independent sources will invalidate the byte comparison.

### Bug ID: BUG-003 — The cron in the test area hits the endpoint of the official area and is blocked by 401
- **Date**: 2026-07-27 (discovered and fixed)
- **Discovered by**: Claude, when accepting BUG-002, he found that the test area `manifest.json` was not advanced.
- **Root Cause** (two mistakenly stacked together):
  1. **URL points to the official area**: The command in the test area `cron.job` is
     `https://kxnxadaghidwumqsqneu.supabase.co/…`. The schedule in the test area never calls its own function.
  2. **Key does not match**: It contains a set of 43 code strings, `net._http_response` is displayed
     09:30:00Z (Taipei 17:30) that time **401**.
- **This is a variant of BUG-002**: It is also "§6c placeholder that needs to be replaced manually",
  But it’s not that I forgot to change it, but it was changed to the value of another environment (it is speculated that the SQL of the official area was copied during the repair at 14:04).
  The detection SQL of BUG-002 only checks "whether the key length is 13" and cannot catch this.
- **Warning**: The same set of URL + key is returned at 08:04:43Z (Taipei 16:04) 200**,
  It became 401 after the official area reset `CRON_SECRET`.
  In other words, before that, the database in the test area has the ability to trigger batches in the official area.
- **Fix**: Rebuild the test area cron job (change the url back to your own ref, fill in the test area's own `CRON_SECRET`,
  Schedule changed to `*/15 8-15 * * 1-5`). `schema.sql` §6d review checklist added
  "The project ref of **url must be your own**" is the criterion.
- **Verification**: ✅ 2026-07-27 20:15 That round of running —— `manifest.json` by
  `06:03:54Z` / `ymd=20260724` advances to `12:15:05Z` / `ymd=20260727`,
  `batch_run_log` writes the first column (`t86_today=true`, `generated=5`, `duration_ms=15361`).

### Bug ID: BUG-002 - The `<CRON_SECRET>` placeholder in cron in the official area has never been replaced, and the after-hours batch has never been automatically run.
- **Date**: 2026-07-27 (discovered and fixed)
- **Discovered by**: Claude, two-zone deployment audit after 0.6.0 finalization
- **Root Cause**: There are two placeholders in the `cron.schedule` body of `schema.sql` §6c
  (`<PROJECT_REF>` and `<CRON_SECRET>`), need to be replaced manually. The official area was not replaced when it was first applied.
  The cron job therefore calls the function with the literal value `'<CRON_SECRET>'` (length 13).
- **Impact**: The official area `stock-report` is deployed with `--no-verify-jwt` and authorized entirely by `x-cron-secret`.
  Therefore, the total number of the three classes is 401. **After-hours batch reports in the official area have never been generated by cron**. In the past, all reports were triggered manually.
  What's even more troublesome is that it is **silent**: the failure is only left in `net._http_response` (retained for 6 hours), and no trace is found the next day.
  There are always reports (manually generated) in Storage, and no abnormalities can be seen from the front end.
- **Same origin precedent**: The same placeholder fault in the test area has been fixed at 2026-07-27 14:04. The same landmine was stepped on twice,
  Because the two areas apply schema independently, fixing one side will not also fix the other side.
- **Fix**: Rebuild `cron.unschedule` + `cron.schedule` and fill in the real project ref and CRON_SECRET plain text.
  Review after repair: `active=true`, URL is `https://kxnxadaghidwumqsqneu.supabase.co/functions/v1/stock-report`,
  The key length is no longer 13.
- **Detection method** (can be reused directly in the future, only the last 4 codes are returned, so it can be safely leaked):
  ```sql
  SELECT jobname, schedule, active,
         (regexp_match(command, 'url\s*:=\s*''([^'']*)'''))[1] AS url,
         left(s,4) || '...' || right(s,4) || ' length=' || length(s) AS key fragment
  FROM (SELECT jobname, schedule, active, command,
               (regexp_match(command, $$'x-cron-secret',\s*'([^']*)'$$))[1] AS s
        FROM cron.job WHERE jobname = 'stock-report-nightly') t;
  ```
  **Length 13 = `<CRON_SECRET>` not replaced. **
- **Verification**: ✅ **Passed** (verified at 2026-07-27 19:20, Claude).
  `generatedAt` of `manifest.json` is pushed from baseline `08:04:50Z` to `09:46:47Z`;
  `batch_run_log` writes two columns (`17:30` cron + `17:46`), both `t86_today=true`, `generated=5`;
  `cron.job` `active=true`. **cron is passed, and the after-hours batch in the official area really runs automatically for the first time. **
  By the way, overturn the old annotation: **17:30 will get the day's T86** (`data_ymd=20260727`).
  ⚠️ On the same day, the test area `manifest.json` still stopped at `06:03:54Z`, and its cron showed no movement - a separate BUG-003 was established.
- **Lessons**: You need to manually replace the schema paragraphs with placeholders, and **there must be an independent verification query after application**.
  "SQL execution is successful" does not mean "the value is filled in correctly" - `cron.schedule` accepts the placeholder string correctly.

### Bug ID: BUG-001 - The inventory overview is inconsistent with the average price and profit and loss ratio of the brokerage APP
- **Date**: 2026-07-17
- **Root Cause**:
  1. **Average Price Difference**: The registration fee is 80 yuan (the actual brokerage price is 40 yuan), causing the calculated average buying price to rise from 102.44 to 102.48.
  2. **Profit and loss rate gap**: The original system inventory overview is mixed with the profits and losses and costs of the historical settled periods (the denominator includes the cost of settled positions), resulting in a different caliber for calculating the total return rate and the unrealized return rate of the securities APP.
- **Fix**:
  1. Transaction record update fee login value.
  2. Modify the Dashboard components and profit and loss calculation logic: remove the "Realized Profit and Loss" and "Cumulative Total Profit and Loss" fields, and adjust the total return rate to only include the "Unrealized Return Rate" of the current position (unrealized profit and loss / total cost of the current position).
- **Changed Files**: `sources/src/components/Dashboard/`, `sources/src/utils/pnlEngine.ts`
- **Verification**: Compare securities APP caliber through unit testing and manual testing.
