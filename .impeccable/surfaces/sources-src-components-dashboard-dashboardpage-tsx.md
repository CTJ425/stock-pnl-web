---
version: 1
slug: "sources-src-components-dashboard-dashboardpage-tsx"
primary_target: "sources/src/components/Dashboard/DashboardPage.tsx"
related_targets: ["sources/src/components/AppShell.tsx"]
---

Scope: whole-app redesign (replace the IBM Carbon world). First surface: Dashboard (庫存總覽). Visitor mode: Operate.
Audience/job: owner + invited users; after-close desk review and quick phone checks. Primary question on open: "how much did I make or lose today?"
User pain points (confirmed 2026-09-26): holdings P&L unreadable on phones; too many numbers per row; no combined total or today's P&L; looks like an enterprise console.
Constraints: red = up, green = down, signed values; zh-TW; dark/light/system themes; TW/US computed separately; plain-language help.
Build path: code-led (no image generation). Discussion checkpoint: standalone mockup in docs/design/ before touching app code.

## Direction contract

THESIS: The dashboard reads as today's page of the broker statement: one net total the user can reconcile, then the line items that make it up. Refuses the dark neon trading-terminal grid and its opposite, soft rounded fintech cards.

OWN-WORLD: White statement paper, ink near-black, blue-gray printed ruling, one ruling blue as the only accent (actions, selection, statement header band). Totals close with a double rule; subtotals per market. Tabular figures everywhere. Square corners. Red/green only on signed figures. Help lives in the statement's footnotes, not "?" icons. Dark theme is the same statement at night: blue-black paper, pale ink.

STORY: The user sees today's net P&L first, trusts it because each figure states its own as-of time, rate or fee basis, scans rows by today's move, opens one row to see cost, fees and its trade history.

FIRST VIEWPORT: No metadata strip (removed 2026-09-26 after user review: a label/value dump repeats the workspace and splits facts from the numbers they qualify). Totals block opens the page: 今日損益 largest (same size on phone and desktop) with its as-of time and the quote refresh beside the label; 持倉市值 (TWD combined) with the FX rate in its sub-line; 未實現淨損益 with its fee basis as the sub-line link that opens the workspace fee settings in place. The basis is derived from the workspace fee discount + rebate type (現折/月退), never a separate setting. Below, the holdings statement: one line per holding, 7 columns on desktop, two-line rows on phone. 新增交易 is the primary action top-right.

FORM: 券商對帳單 (broker statement), position 1 of the ordered grounded list; seed 6e53c8cb; chosen kind: pick.
Raises: today's P&L never shrinks (tdr-info-noise-sleeve); secondary numbers appear only on row focus/expand (ikeda-datamatics); destructive actions isolated with space, outline until focused (dev console); status printed as statement lines, not toasts (phosphor terminal); market session vocabulary 盤前/盤中/收盤/盤後 app-wide (ocean dive); each holding keeps its trade stops, visible on expand (orizuru).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
