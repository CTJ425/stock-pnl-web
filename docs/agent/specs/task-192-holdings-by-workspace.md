# Task 192 — Discord 持股日報: one message, one section per workspace

- **Status**: DRAFT (open decisions D1–D3 below need the user)
- **Timestamp**: 2026-10-04 12:10:00 Asia/Taipei
- **Related**: `discord-holdings.md` (original card spec, Revision 8 §8.1 line formats)

## 1. Problem

The daily holdings card merges every workspace of an account into one set of rows
(`aggregateHoldings`, `supabase/functions/stock-report/holdingsCard.ts:398`): the same ticker in
two workspaces becomes one row, and the totals are the sum of all workspaces. The card never shows
a workspace name (`loadHoldingsWorkspaces` does not even select `workspaces.name`,
`discordHandlers.ts:339`). A user with one workspace per broker cannot tell either account's
position or P&L from the card.

Calculation is already per workspace (one ledger each, own fee rate / rebate / rounding /
day-trade-tax / sell-fee basis, `buildLedgers` `holdingsCard.ts:94`). Only the presentation merges.

## 2. Goal

Same webhook, same single message, same schedule. Inside it, positions and totals are grouped by
workspace, each group labelled with the workspace name.

Out of scope: per-workspace webhooks / channels, per-workspace on/off switches, the web UI.

## 3. Current shape (what changes)

| Piece | Now | After |
| ---- | ---- | ---- |
| Data | `loadHoldingsWorkspaces` selects `id, fee_*…` | also `name` → `WorkspaceInput.name` |
| Aggregation | `aggregateHoldings(ledgers, …)` → one `HoldingsSummary` (`twd`, `usd`) | call it once **per ledger** → `Array<{ workspaceId, name, summary }>`; quotes still fetched once for `heldKeys(all ledgers)` |
| Payload | ≤2 embeds: TWD, USD | one embed per (workspace × currency that has rows), title prefixed with the workspace name |
| Order | — | workspace `created_at, id` (already the query order) |

`aggregateHoldings` called with a one-element ledger list is exactly the per-workspace summary, so
the engine does not change; the merge across workspaces simply stops happening.

## 4. Discord limits — the real constraint

- ≤ **10 embeds** per message; ≤ **6,000 chars** total across all embed titles + descriptions +
  footers (`TOTAL_EMBED_LIMIT`, `holdingsCard.ts:525`).
- Today `BUDGET = (6000 − overhead×2) / 2` assumes exactly two embeds (`holdingsCard.ts:530`). With N
  embeds the budget must be `(6000 − overhead×N) / N`, or allocated by row count, and
  `clampCurrencyBlocksTotal` must handle N embeds.
- More than 10 (workspace × currency) blocks: keep the first 9, and the 10th says
  `…另 K 個工作區，完整明細請見網站`.
- Rows that no longer fit are dropped from the end of that block with the existing
  `…另 N 檔，完整明細請見網站` line.

## 5. Behaviour rules

1. A workspace with no open position (no row in either currency) is omitted.
2. All workspaces empty → `null` payload → `skipped / no-holdings`, as now.
3. Missing-quote count, stale-quote ⚠️, 券商 figure and footer legend work per block exactly as now.
4. Preview (`op: preview`) and the daily tick share `buildHoldingsPayload`, so both change together.
5. Workspace names are user input: pass through `escapeMd`, and truncate to keep the embed title
   ≤ 256 chars (Discord limit).

## 6. Open decisions (user)

- **D1 — single workspace**: when the account has only one workspace with holdings, keep today's
  title (no workspace name) or always show the name? Proposal: always show it, for one rule.
- **D2 — grand total**: also print a cross-workspace total (TWD / USD) in `content` or a first
  embed? Proposal: yes, one line per currency in `content`, e.g.
  `合計 未實現 +12,345（台幣）｜+123.45（美元）`, so the old headline number is not lost.
- **D3 — embed layout**: one embed per workspace × currency (proposal; keeps the existing per-
  currency colour and title), or one embed per workspace holding both currencies.

## 7. Tests

- `holdingsCard.test.ts`: two workspaces holding the same ticker produce two rows under two
  titles, not one merged row; per-block totals equal the single-workspace results.
- Budget: N = 1, 2, 5 blocks with many rows stay ≤ 6,000 total and ≤ 10 embeds.
- Name escaping / truncation; empty workspace omitted; all empty → `null`.
- `discordHandlers` loader: `name` selected in every step of the fallback `selects` list.
- Visible behaviour change → `-dev.N` bump + CHANGELOG (zh-TW). Edge deploy needed on DEV, then
  PROD with the release (a `main` push does not deploy Edge).
