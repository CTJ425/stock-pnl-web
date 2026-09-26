# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- Primary: the owner, a Taiwan-based individual investor (mainly TW stocks, some US stocks) tracking their own holdings across several brokers.
- Secondary: friends and other people who sign up and use the same tool for their own portfolios. UI copy assumes readers who are not familiar with stock jargon (see `docs/agent/SPEC.md` → "UI Copywriting Guidelines").
- Admin: the owner also operates the after-hours data pipeline through the Admin status / probe war-room page.

## Product Purpose

Record stock trades and show profit and loss that matches what the broker reports, plus the after-hours market data an investor checks after the close, in one place. It replaces an earlier Google Sheets + Apps Script "stock helper". Success: the numbers can be trusted against the broker statement, and daily review does not require jumping between several finance sites.

## Positioning

- **P&L on the broker's basis:** moving-average cost; buy fees included in cost; unrealized P&L is shown net, with TW sell fees and securities tax withheld. One workspace per broker/portfolio, each with its own fee rate; workspaces are viewed one at a time (no cross-workspace total). Because broker apps compute differently, the UI also offers the broker's posted-rate figure (券商, undiscounted 0.1425%) and a no-fee figure (未含費) for reconciliation.
- **After-hours data in one place:** institutional flows, margin/borrow, fundamentals (monthly revenue, quarterly profitability), technicals, FX and macro indices sit next to the user's own holdings, filtered to what they hold.

## Operating Context

- Used equally on desktop (after-close, in-depth review of P&L, chips, fundamentals, yearly reports) and on phones (quick checks of P&L and quotes during the day or on the go). Both are first-class.
- Two storage modes: local mode (no login, `localStorage`) and Supabase cloud mode (email login, multi-device sync). Stock analysis, FX, macro and admin features need cloud mode and are hidden without it.
- Data freshness matters: quotes have TTLs (TW ~60 s, US ~10 min), after-hours data arrives on a schedule, and the UI must say when data is delayed.
- Main views: Dashboard (holdings overview), Transactions, Yearly report, Stock analysis (quote, chips / fundamentals / technicals, what-if), FX, Macro (international indices, US economy), Settings, Admin.

## Capabilities and Constraints

- Stack: React 19 + TypeScript + Vite SPA with plain CSS and CSS custom properties; Supabase (Postgres + RLS + Edge Functions); static hosting on Cloudflare Pages. App root is `sources/`.
- UI language is Traditional Chinese (zh-TW).
- Market color convention is Taiwanese: **red = up / gain, green = down / loss** (`--up` / `--down`). Values are always signed, never color-only. `--up`/`--down` must not be reused for error/warning status.
- TW fees and securities tax round to whole numbers; ETF (code starting `00`) tax 0.1%, stocks 0.3%. TW and US figures are computed and shown separately.
- Supports dark / light / follow-system themes; mobile inputs use 16px text to avoid iOS focus zoom.
- Financial information only, not investment advice; a disclaimer sits in the footer with the version number.

## Brand Commitments

- Name: Stock PnL Web (股票交易與庫存管理系統).
- Voice: plain, short explanations (1–2 sentences), results over formulas, no jargon; always state whether fees are included, whether data is delayed, and what a number covers.

## Evidence on Hand

- Real product documentation: `README.md`, `docs/agent/SPEC.md`, `docs/agent/CHANGELOG.md`.
- Prior design explorations and audits: `docs/design/` (desktop/mobile UX audits, mockups).
- No testimonials, user counts, or press exist; do not invent them.

## Product Principles

1. The numbers must reconcile with the broker; any figure states what it includes (fees, tax, delay).
2. Show only what is relevant to the user's own holdings; empty or unavailable data is stated plainly, not padded.
3. Desktop depth and mobile glanceability are equally important.
4. Explain in plain language for people who are not stock experts.
