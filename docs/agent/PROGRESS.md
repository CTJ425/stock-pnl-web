# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task quote-yahoo-a UI redesign completed & verified (Top banner, Darker chart badge, 2-day Institutional cards under chart, Section tabs, PDF removal, 2 read-only subagent reviews PASS, 1291 tests passed)
- Status: **✅ RECORDED**
- Timestamp: 2026-08-25 17:36:00 Asia/Taipei

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

---

## 📅 Log: 2026-08-25 17:05:00 Asia/Taipei (Task quote-yahoo-a: intraday chart + Yahoo-style quote header; code complete & verified, 1294 tests PASS)

- **Task quote-yahoo-a completion**: Yahoo-style quote redesign + intraday chart for 個股分析 page. Branch `feat/quote-yahoo-a` cut from `dev` at commit fad5ee2. Spec: `docs/agent/specs/quote-yahoo-a.md` (revisions 2, 3, 4 applied).
- **T1 (intraday data path)**: New pure module `supabase/functions/stock-price/intradayParse.ts` — parser for Yahoo Finance v8 chart payload (IntradaySeries / IntradayPoint types); null close carry-forward, null volume → 0, leading null closes dropped. New action `intraday` in `stock-price/index.ts` — `POST { action: 'intraday', symbol: { market: 'TPE'|'US', ticker }, range: '1d'|'5d' }` → `{ series: IntradaySeries | null }`. Reuses `yahooSymbols()` with .TW→.TWO fallback; returns `{ series: null, 200 }` on failure/unknown ticker. Client `src/services/intradayProxy.ts` with 60s in-memory cache.
- **T2 (UI rebuild)**: `IntradayChart.tsx` with stacked price (220px) + volume (70px) frames sharing hover crosshair, symmetric prevClose baseline, cumulative VWAP line, 1d/5d range tabs. `QuoteTab.tsx` with Yahoo header, 8-cell stats grid (volume, open, high, low, prevClose, vwap, change %, amplitude), right rail sidebar (.quote-layout) holding 我的持股 (.quote-aside-private, hidden in PDF export via `.report-surface`), 指標摘要, and 成交金額/估值.
- **Verification & Review**:
  - `code_reviewer` Subagent dispatched: **PASS** across data pipeline, UI tokens, error handling, edge cases, and PDF privacy.
  - Vitest Unit & Integration suite: **83 files / 1294 tests passed**, exit 0.
  - Build & Typecheck: `npm run lint` (`oxlint`) exit 0, `npm run typecheck:edge` exit 0, `npm run build` (`tsc -b && vite build`) exit 0.
  - E2E / Smoke: `App.smoke.test.tsx` passed, `sources/scripts/verify-quote-intraday-e2e.cjs` Playwright multi-viewport checks passed.
- **Open items**:
  1. DEV Edge function deployed & verified on self-hosted supabase (`stock-price`).
  2. PROD Edge Function deployment (`stock-price`) on cloud when authorized.
  3. Merge `feat/quote-yahoo-a` to `dev`.

---
