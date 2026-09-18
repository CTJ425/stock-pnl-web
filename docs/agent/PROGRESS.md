# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — holdings card matches 庫存總覽, and the quote request that made every card show `--` is fixed
- Status: 🔄 **0.9.58-dev.9 on `dev`** (`b10746f`, not pushed) — DEV `stock-report` v16 deployed and verified (missing quotes 7 → 0); PROD untouched
- Timestamp: 2026-09-18 13:45:00 Asia/Taipei

---

## 📅 Log: 2026-09-18 13:45:00 Asia/Taipei (Task 165 — card parity and the quote-header bug, 0.9.58-dev.8 / dev.9)

**The bug worth remembering**: every position on a real holdings card showed `--` for 現價/未實現/報酬率. `makeChartFetch` in `holdingQuotes.ts` fetched Yahoo with `{ signal }` and **no headers**, so the request went out with Deno's default `User-Agent` and Yahoo refused it. Everything else in `stock-report` that fetches Yahoo already sends `Accept: application/json` + `User-Agent: UA` (`twChips.ts`'s `fetchJson`), which is why the market summary's index block was fine and only the holdings card was broken; `stock-price`'s `fetchYahooPrice` sends the same headers, which is why the app's own quotes work from the Edge. Fixed by sending those two headers, importing `UA` from `twChips.ts`. Measured on DEV: `holdings-preview` reported 7 of 7 positions without a quote before (v15) and 0 of 7 after (v16).

**How it was found**: the user reported trailing `--` columns and asked for 庫存總覽 parity. Revision 4 added a `missingQuotes` counter to the preview result — that counter is what turned "maybe the quotes are stale" into "every quote fails in the Edge runtime, and only here". A laptop run of the same code against the same account fetched 6 of 6, which is what pointed at the request itself rather than the data.

**0.9.58-dev.8 (Revision 4)**: each position gained a `市值 … 成本 …` line (SHORT rows read 價金, since a short's basis is proceeds), so the card now carries every column 庫存總覽 shows, plus 當日%, 已實現 and the per-currency KPI block. `createQuoteCache` now runs at most 2 key fetches at a time instead of opening one per position at once. The preview result carries `missingQuotes`, the admin console shows 「已送出完整持股報告（資料日 …，N 檔無報價）」, and a daily send logs `holdings quotes missing` with counts only. Layout is the compact one the user picked: four lines per position, five when 已實現 is not 0.

**0.9.58-dev.9 (Revision 5)**: the header fix above.

**Verification**: `npm test` 2529 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. DEV deploys v15 then v16 (ezbr `02e08077…` then `8b6ba626…`), each followed by a real `holdings-preview` for the account with 114 transactions, which is also how the fix was proven. A local render of that account's card was read line by line: 7 positions, 996 characters of 2,800, 已實現 only on the two tickers with sells, the 2303 long/short pair carrying it once, 保本 just above 均價.

**Next**: watch one real 17:30 round on DEV; PROD still untouched and needs explicit OK (merge `main`, §14 + §15, clone cron, deploy).

---

## 📅 Log: 2026-09-18 13:13:38 Asia/Taipei (Task 165 — holdings card P&L, 0.9.58-dev.7)

**Asked first**: the card already showed 未實現 / 今日 / 今年已實現 per currency and 未實現 / 報酬率 / 當日% per position, so the user picked what was missing: 今日已實現, per-position 累計已實現, per-position 均價與保本價. 全幣別合計 was offered and not chosen, so TWD and USD stay separate.

**Code** (`holdingsCard.ts` only; the engine stays frozen, D6): `HoldingRowOut` gains `avgCost`, `breakEven`, `realized`; `CurrencySummary` gains `realizedToday`. `realized` is `Position.realized` summed across workspaces per key and attached once — LONG row, else SHORT row — so a key with both legs is never counted twice. `realizedToday` sums `ledger.yearly[year(ymd)].tickers[*].sells` whose `date === ymd` (SHORT_COVER legs included), split by `YearTickerDetail.currency`. `breakEven` is the lowest cent where `estimateUnrealized` of a synthetic single-lot holding is ≥ 0, seeded from the closed form, with the share-weighted fee rate of the contributing workspaces — it therefore cannot drift from the 未實現 column, and SHORT rows get `null`. Rendering: a KPI line 今日已實現 (always, even 0) and per position `均價 … 保本 …` plus `已實現 …` only when non-zero.

**Review**: main session read the diff (money code); `route:reviewer` PASS with one RISK — the break-even step-down loop had no cap. Fixed together with a second defect the main session found: a non-converged search used to return the last tried price as if it were the break-even price. Both searches are now bounded at 2,000 steps and a non-converged search returns `null`, which renders as `--`.

**Verification**: `npm test` 2521 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. The golden "builds the full two-card message exactly" test carries the new lines. Also rendered a card from the real DEV data of the account with 114 transactions (local, nothing sent to Discord): 已實現 appeared only on the two tickers with sells, the 2303 long/short pair showed it once, 保本 sat just above 均價, 今日已實現 was 0 (no sells today), and the title correctly flagged the 09/17 quotes as not today.

**Next**: DEV deploy of `stock-report` is needed before the card changes reach a real send — awaiting explicit OK; then a 完整推送測試 from the admin console; PROD still untouched.
