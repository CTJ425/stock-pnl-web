# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Direct navigation from Holdings Overview to Stock Analysis (0.9.18) implemented, tested, and verified on DEV (84 test files / 1295 tests passed)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-25 18:12:00 Asia/Taipei

---

## 📅 Log: 2026-08-25 18:12:00 Asia/Taipei (Holdings Table: Direct Click-to-Analyze for Taiwan Stocks, 0.9.18; 1295 tests PASS)

- **Feature Implemented**:
  1. **Direct Click-to-Analyze for Taiwan Stock Holdings** (`DashboardPage.tsx`):
     - Wired `onSelectTicker` prop to `<HoldingsTable rows={twRows} currency="TWD" onSelectTicker={onSelectTicker} />`.
     - Clickable `<tr>` rows for Taiwan stocks with `cursor: pointer` style and `title="點擊查看個股分析"`.
     - US stocks remain non-clickable (standard cursor, no title, no action) as Stock Analysis focuses on Taiwan market chips/fundamentals/technical data.
  2. **Safe Mode / Offline Guard** (`AppShell.tsx`):
     - Guarded `onSelectTicker` in `AppShell.tsx` with `isReportConfigured` so local/offline mode gracefully leaves rows non-interactive.
  3. **Unit Tests Added** (`DashboardPage.test.tsx`):
     - Verified clicking Taiwan stock rows triggers `onSelectTicker` with `(ticker, name)`.
     - Verified US stock rows do not trigger `onSelectTicker`.
     - Verified offline / undefined `onSelectTicker` handling and empty state display.
- **Verification & Test Suite**:
  - Full Vitest suite: **84 test files / 1295 tests passed** (100% PASS), exit 0.
  - Linter & Typecheck: `npm run lint` (0 errors), `npm run typecheck:edge` (0 errors), `npm run build` (`tsc -b && vite build` exit 0).
- **Files Modified**:
  - `sources/src/components/Dashboard/DashboardPage.tsx`
  - `sources/src/components/AppShell.tsx`
  - `sources/src/components/Dashboard/DashboardPage.test.tsx` (new)
  - `sources/src/version.ts`, `sources/package.json`, `sources/package-lock.json`, `README.md` (bumped to 0.9.18)

---

## 📅 Log: 2026-08-25 17:36:00 Asia/Taipei (Stock Detail: 2-Day Institutional Cards Under Chart, Darker Chart Badge; Dual Read-Only Subagent Review PASS, 1291 tests PASS)

- **User Requirements Implemented**:
  1. **Darker Chart Time Badge**: Updated `.chart-time-badge` in `sources/src/index.css` to use a subtle, muted dark style (`var(--ink-secondary)` on `var(--surface-strong)` with `var(--border)`), avoiding visual distraction beside the intraday chart.
  2. **2-Day Institutional Cards Under Intraday Chart**: Added `.institutional-block` in `sources/src/components/StockDetail/QuoteTab.tsx` directly beneath `<IntradayChart />` in `.quote-main`.
     - Displays latest 2 trading days (`[最新, 前日]`) extracted from `report.history`.
     - Each card shows formatted date, tag, total net lots (`institutional.total.net` formatted via `fmtLotsFromShares` with `pnlClass`), and 3-leg grid for 外資, 投信, 自營商.
     - Full mobile responsiveness (`@media (max-width: 560px)` collapsing to 1 column).
  3. **Clean Decoupling & Null Safety**: In `QuoteTab.tsx` and `StockDetailPage.tsx`, gracefully handles 0-day, 1-day, null, and missing leg data.
- **Dual Read-Only Subagent Code Review (Both PASS)**:
  - **Reviewer 1 (Data Flow, Calculation & Integration - Read-Only)**: `PASS` (clean chronological extraction, lot/share unit conversion via `fmtLotsFromShares`, safe null handling for missing days/legs, unit tests comprehensive).
  - **Reviewer 2 (UI/UX, Visual Tokens & Responsiveness - Read-Only)**: `PASS` (muted badge tone, grid hierarchy, Taiwan red-up/green-down convention, seamless glassmorphic design token adherence, clean RWD break at <=560px).
- **Verification & Test Suite**:
  - Full Vitest suite: **83 test files / 1291 tests passed**, exit 0.
  - Linter & Typecheck: `npm run lint` (0 errors), `npm run typecheck:edge` (0 errors), `npm run build` (`tsc -b && vite build` exit 0).
- **Deployment Status**:
  - DEV Edge Function (`stock-price`): Volume copied and container restarted.
  - PROD Edge Function (`stock-price`): Deployed via Supabase CLI (active, version 20, SHA `bac85eb3edcf...`).
  - Remote Branches: Pushed `dev` and `main` to `origin` (triggered Cloudflare Pages build).
- **Files Modified**:
  - `sources/src/components/StockDetail/QuoteTab.tsx` & `QuoteTab.test.tsx`
  - `sources/src/components/StockDetail/StockDetailPage.tsx` & `StockDetailPage.test.tsx`
  - `sources/src/index.css`
  - `docs/agent/PROGRESS.md`

