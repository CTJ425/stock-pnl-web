# Progress Log (PROGRESS.md)

- Agent: Scribe
- Action: 0.9.21 release recorded (當日大盤面板完善：重新整理按鈕、日期徽章、法人側欄、六項缺陷修復)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-27 11:20:00 Asia/Taipei

---

## 📅 Log: 2026-08-27 11:20:00 Asia/Taipei (0.9.21 Release: 當日大盤面板完善; Bookkeeping Only)

- **Release**: Version 0.9.21 — follow-up to 0.9.20 當日大盤 panel.
- **Features Added**:
  1. Panel's own refresh control (`重新整理` button) with request-id staleness guard.
  2. Dated badge reading session date from last intraday point (not first), falls back to `當日` with `null` sessionDate when no data.
  3. 三大法人 aside fed from parent's `market.json`; refresh button syncs both intraday series and parent data via new `onRefresh` prop.
  4. Chart layout reserves aside column only when data exists (`.has-aside` modifier), eliminating 300px blank strip.

- **Defects Fixed** (from review round 1):
  1. Missing `.catch` on fetch left `loading` stuck true forever; button now disabled, icon spinning permanently on failure. Added catch handler; deliberately does NOT clear series, preserves last good numbers on screen.
  2. 自營商 half-sum bug: only count when BOTH legs present, display `—` when incomplete (standing rule: "'—' for a value the day has not produced yet").
  3. Intraday points list in ascending order (oldest to newest); date badge now reads last point instead of first (five-day range showed five-day-old date). No points → `當日` text, `sessionDate: null`.
  4. Chart unnecessarily reserves 300px aside space even when no institutional data; now conditional on actual aside render.
  5. Lower button now has distinct accessible name (`aria-label="重新整理台股市場歷史資料"`) so screen reader can tell the two refresh controls apart.
  6. Inline padding on panel root removed (duplicate); CSS class rule supplies it; TwMarketSection chart block re-indented (whitespace-only); section heading: 台股市場歷史走勢與成交量.

- **Test & Quality**:
  - Full Vitest suite: **85 test files / 1330 tests passed** (100% PASS), exit 0.
  - Linter: `npm run lint` 12 warnings (identical set, no new).
  - Typecheck: `npm run typecheck:edge` exit 0.
  - Build: `npm run build` exit 0.
  - Reviewer: FAIL round 1 (blocker: missing `.catch`; risk: half-sum 自營商), sent back to builder. PASS round 2 (only finding: tighten new failure test to compare stat value rather than cell presence; already fixed).

- **Files Changed**:
  - Production: `TwIndexToday.tsx`, `TwMarketSection.tsx`, `index.css`
  - Tests: `TwIndexToday.test.tsx`, `TwMarketSection.test.tsx`
  - Bookkeeping: `version.ts`, `README.md`, `CHANGELOG.md`, `PROGRESS.md`

- **Edge Deploy**: Not required — pure frontend change, data contract unchanged.

- **Status**: Bookkeeping only; no git commit, push, or merge performed.

---

## 📅 Log: 2026-08-26 17:05:00 Asia/Taipei (0.9.19 Release: 當日大盤 Panel in 總體經濟 > 台股; DEV+PROD Deployed)

- **Feature Released**:
  1. **當日大盤 Panel** at the top of 總體經濟 > 台股, reusing IntradayChart component (`TwIndexToday.tsx`).
  2. Shows intraday OHLC data, volume, and price change visualization for Taiwan Index (^TWII).
  3. Integrated into `TwMarketSection.tsx` workflow.

- **Route Completed**: Spec → failing tests (main session) → builder → reviewer → main-session adjudication → release → deploy both environments.

- **Test & Quality Verification**:
  - Full Vitest suite: **85 test files / 1313 tests passed** (100% PASS), exit 0.
  - Linter: `npm run lint` exit 0.
  - Typecheck: `npm run typecheck:edge` exit 0.
  - Build: `npm run build` exit 0.
  - Reviewer: PASS with one RISK fixed (`pnlClass(changePct)` instead of `pnlClass(change)` in TwIndexToday.tsx; harmless while `prevClose` > 0, which is always true for index, but was a slip rather than trade-off).
  - Edge `index.ts` diff: doc comment + widened `SymbolItem['market']` to include `'IDX'` — zero runtime change.

- **Deployment Completed**:
  1. **DEV Edge** (`stock-price`): Volume copy with `/bin/cp -f` into `volumes/functions/stock-price/`, then `docker compose up -d --force-recreate functions`; healthy in ~9s. `diff -rq` all files identical.
  2. **PROD Edge** (`stock-price`): `supabase functions deploy stock-price --project-ref kxnxadaghidwumqsqneu`, no `--no-verify-jwt`. Version 20 → 21, ezbr_sha256 changed from `bac85eb3edcf1fc7` to `a1a7920dddf42417` (proof new code landed).
  3. **Live Behaviour Verified**: `^TWII` returns dayOpen/dayHigh/dayLow from OHLC arrays. Stock path `2330.TW` unchanged (271 points, prevClose=2400, interval=1m, point keys t/c/v).
  4. **GitHub Pages**: Deploy run 32948412913 succeeded; served bundle reports 0.9.19.

- **Files Changed**: 17 total (+666/−48) — `sources/supabase/functions/stock-price/intradayParse.ts`, `sources/supabase/functions/stock-price/index.ts`, `sources/src/services/intradayProxy.ts`, `sources/src/components/StockDetail/IntradayChart.tsx`, `sources/src/components/Macro/TwIndexToday.tsx` (new), `sources/src/components/Macro/TwMarketSection.tsx`, `sources/src/index.css`, plus four test files and version/README/CHANGELOG set.

- **Commits**: `7dae025` (feature, 0.9.19-dev.1) and `329fb95` (chore(release): 0.9.19). Branches: `dev`, `main`, `origin/dev`, `origin/main` all at `329fb95`.

---

