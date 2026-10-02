---
name: 股票小幫手 (Stock PnL Web)
description: Stock trades and broker-basis P&L, laid out as today's page of a broker statement.
colors:
  paper: "#ffffff"
  paper-band: "#eff3f7"
  paper-band-strong: "#e3e9f0"
  paper-raised: "#f6f8fa"
  ink: "#16191d"
  ink-secondary: "#444d58"
  ink-helper: "#636c78"
  ruling: "#d3dae3"
  ruling-strong: "#8a94a1"
  ruling-blue: "#2c5785"
  ruling-blue-deep: "#234769"
  market-up: "#c42f2b"
  market-down: "#17784a"
  support-error: "#b3261e"
  support-warning: "#8a6100"
  night-paper: "#11151a"
  night-band: "#1a2129"
  night-ink: "#e7ebf0"
  night-ruling: "#29323d"
  night-ruling-blue: "#8db3e2"
  night-up: "#ff7d74"
  night-down: "#52c98c"
typography:
  hero-figure:
    fontFamily: "Public Sans, Noto Sans TC, PingFang TC, Microsoft JhengHei, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum, lnum"
  figure:
    fontFamily: "Public Sans, Noto Sans TC, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.25
    fontFeature: "tnum, lnum"
  section-title:
    fontFamily: "Public Sans, Noto Sans TC, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
  body:
    fontFamily: "Public Sans, Noto Sans TC, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum, lnum"
  label:
    fontFamily: "Public Sans, Noto Sans TC, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
rounded:
  none: "0px"
  control: "2px"
spacing:
  sp-02: "4px"
  sp-03: "8px"
  sp-04: "12px"
  sp-05: "16px"
  sp-06: "24px"
  sp-07: "32px"
  sp-09: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ruling-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    height: "36px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "{colors.ruling-blue-deep}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "36px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "40px"
  tag:
    textColor: "{colors.ink-secondary}"
    rounded: "{rounded.control}"
    height: "20px"
  ledger-row:
    height: "48px"
  ledger-row-hover:
    backgroundColor: "{colors.paper-band}"
---

# Design System: 股票小幫手

## Overview

**Creative North Star: "今天這一頁的券商對帳單" (today's page of the broker statement)**

The app reads like the statement the user reconciles against: white paper, near-black ink, blue-gray printed ruling, and one ruling-blue accent. Totals close with a double rule, each market carries its own subtotal, and every figure states what it includes (fees, tax basis, as-of time, FX rate) right beside itself. Chosen 2026-09-26 to replace IBM Carbon, which read as an enterprise console.

The dark theme is the same statement at night: blue-black paper and pale ink, never neon. Light is primary: the owner reviews after the 13:30 close at a desk in daylight and checks the phone on a bright platform.

**Key characteristics:**
- One number per cell. Secondary figures (未含費, 券商, 淨收, cost, break-even) open under the row, never stacked into it.
- Qualifiers sit beside the figure they qualify; there is no metadata strip.
- Help is printed as footnotes under the table, not "?" icons.
- Red = up, green = down, always signed; the market colours never carry error or warning meaning.
- Tabular lining figures everywhere money lines up.

## Colors

Restrained: neutrals of paper and ink plus one ruling blue; the market colours are semantic, not an accent.

### Primary
- **Ruling Blue** (#2c5785; night #8db3e2): primary buttons, links, the selected navigation underline, focus rings, the fee-basis link. Nothing decorative.

### Neutral
- **Statement Paper** (#ffffff; night #11151a): the page and every table.
- **Band** (#eff3f7; night #1a2129): hover and the opened row's sub-ledger.
- **Ink** (#16191d; night #e7ebf0): figures, headings, the rule under column heads and the double rule under totals.
- **Ink Secondary / Helper** (#444d58 / #636c78): names, labels, footnotes.
- **Ruling** (#d3dae3; night #29323d): hairlines between rows and blocks.

### Semantic
- **Market Up / Down** (#c42f2b / #17784a; night #ff7d74 / #52c98c): signed P&L and price moves only.
- **Error / Warning** (#b3261e / #8a6100): notices, destructive buttons, stale-quote tags. Kept visibly apart from market red/green.

**The one-accent rule.** Ruling blue marks what can be acted on or is selected. If a second hue appears, it must be semantic (market or status).

## Typography

**Face:** Public Sans (Latin, figures) with Noto Sans TC (CJK), one family for everything; fallbacks PingFang TC, Microsoft JhengHei.

- **Hero figure** (2.5rem/700): one per page — 未實現淨損益 on the dashboard (今日損益 removed 2026-09-28 at the owner's request), 台股歷史已實現 on 年度收益 — and it never shrinks: the same size on a phone and a desktop.
- **Figure** (1.5rem/700, 1.25rem on phones): the other statement totals.
- **Section title** (1.25rem/700): 持股明細 and page sections.
- **Body** (0.875rem/400, 1.5): table cells and prose.
- **Label** (0.75rem/500, helper ink): column heads, block heads in the sub-ledger.

**The figure rule.** `font-variant-numeric: tabular-nums lining-nums` is set on `body`; do not override it in data.

## Layout

- Content column 1200px (container 1248px with 24px gutters; 16px on phones). The app bar is 56px with a hairline below.
- The dashboard opens with the totals block (未實現淨損益 wide, 持倉市值 beside it, split by a vertical hairline, closed by a 3px double rule), then the holdings ledger grouped by market, then footnotes.
- Phones (≤720px): totals stack (the lead figure full width; further totals side by side, a lone one full width); ledger rows become two-line entries (name + unrealized / shares · price + move + return, the return right-aligned under the P&L); navigation moves to a fixed bottom bar.
- More space above a heading than below it; the ledger starts 48px under the totals.

## Elevation & Depth

Flat. Depth is printed: hairlines, a band tint for hover and opened rows, and the double rule for totals. Shadows exist only on floating layers (menus, modals, toasts) and carry a real offset and blur.

## Shapes

Square statement geometry. Tables, blocks and panels have 0px corners; controls (buttons, fields, tags, segmented controls) have a 2px corner. No pills. Status never uses a thick side stripe; notices are ruled boxes tinted by their status.

## Components

- **Buttons:** 36px (32px small), label centred at 600. Primary is the only filled button. Destructive stays an outline until hovered or focused.
- **Fields:** fully ruled 40px boxes (44px on phones, 16px text to stop iOS zoom); focus is a 2px ruling-blue inset ring.
- **Header navigation:** text links the full bar height; current page is ink 700 over a 2px ruling-blue underline. Icons appear only when labels collapse (≤1020px). Bottom bar: accent colour plus a 2px top rule on the current cell.
- **Holdings ledger:** 6 columns (股票, 股數, 現價, 漲跌幅, 市值, 未實現淨損益), always ordered by 市值, largest first, with no sort control (the 市值 / 未實現損益 / 代號 buttons were removed 2026-09-28: within a group of a few holdings they rarely changed the order); the whole row toggles its sub-ledger (cost, the three unrealized-P&L methods with 「目前採用」, the trades of that stock, 個股分析).
- **Fee settings:** one form (`WorkspaceFeeSettings`) opened in place from the 未實現淨損益 basis link or in a modal from the workspace menu. Left: the discount, its effective date and history. Middle: 「你的券商 App 怎麼算」 as a segmented choice — 玉山 / 元大 (presets reconciled against those apps) / 其他券商／自訂 — with the four settings (退法, 賣出預扣費率, 分批捨去, 當沖稅) summarised in one line and folded behind 改單項; 自訂 or a non-matching combination shows them. The broker is derived from the four stored fields, never stored. The action bar (儲存／取消) is sticky — above the bottom nav on phones — and, on the dashboard, prints the TW unrealized total saved → previewed.
- **Tags:** 20px, 12px/600, 1px rule, 2px corner.
- **Charts first (2026-09-27):** every analysis page opens with a picture and keeps the exact numbers one `details.chart-more` disclosure below it. Polarity (漲跌, 買賣超) is red above / green below a zero line; identity (外資 / 投信 / 自營商, margin lines, several indicators) uses `var(--chart-c1..4)` — blue, yellow, violet, pink, never red or green — with a legend. Lists of moves (國際指數, 外幣匯率, 各檔貢獻) are diverging bars on one shared scale, the list itself being the chart.

## Do's and Don'ts

- **Do** print qualifiers beside the number they qualify (as-of time, FX rate, fee basis).
- **Do** keep one number per cell and move extra figures into the row's sub-ledger.
- **Do** keep TW and US apart when no FX rate is known, and say so; never guess a conversion.
- **Don't** add a metadata strip of label/value pairs above the totals.
- **Don't** use "?" icons for definitions; write a footnote.
- **Don't** use pills, gradients, glass, glows, or thick coloured side stripes.
- **Don't** reuse market red/green for errors, warnings or status.
