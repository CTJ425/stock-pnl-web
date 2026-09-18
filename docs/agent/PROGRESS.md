# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — both Discord cards rewritten in markdown; holdings card cut to four fields per position
- Status: 🔄 **0.9.58-dev.12 on `dev`** (`6f9fed0`, not pushed) — DEV `stock-report` v19; both cards sent to the user's channel with real 09/18 data; PROD untouched
- Timestamp: 2026-09-18 15:20:00 Asia/Taipei

---

## 📅 Log: 2026-09-18 15:20:00 Asia/Taipei (Task 165 — card layout: 24 columns, markdown probe, markdown, 0.9.58-dev.10 → dev.12)

**Problem**: on a phone the fenced tables wrapped — the widest lines were 36 display columns and a phone message column fits about 33 — so the columns stopped lining up.

**Options shown**: a design canvas (artifact "Discord 卡片排版方案", private to the user) drew the current cards and four alternatives with the real 09/18 data at phone width: A native embed fields, B 24-column monospace, C fields + narrow table, D markdown, plus a comparison board.

**dev.10 (`c34e37e`, Revision 6)**: the user picked B. Every line ≤ 24 columns; indices rounded to whole points, margin without its header row, macro two lines per indicator, holdings seven to nine lines per position. Found on the way: `dispWidth` counted `▲ ▼ ─ ⚠` as one column although a CJK font draws them two wide, so title lines were really 25 — fixed by adding the box-drawing, geometric-shape and misc-symbol ranges to both `WIDE_RANGES` copies.

**dev.11 (`795eb85`, Revision 7)**: the user asked how markdown would look. Because Discord's `###` and `-#` are newer syntax that an old mobile client may print literally, a one-off sample (`markdownSample.ts`, op `markdown-sample`) was posted to the channel first instead of changing the cards. The user reported the US indices missing from it — the sample's numbers had been copied from the 09/16 test fixture, which deliberately leaves them empty; all eight index symbols return data in reality (checked).

**dev.12 (`6f9fed0`, Revision 8)**: markdown for both cards. Holdings: `未實現合計 **+X**（+P%）｜今日 +Y`, blank line, then `**代號 名稱**｜N 張|N 股｜均價 A｜未實現 **U**` per position — 市值, 成本, 今日已實現, 今年已實現, 空單市值 and the per-position price/return/break-even/realized lines are no longer rendered (still computed). Summary: every table row became `標籤 **數值** 圓點`; indices back to two decimals with a date only when stale; margin `融資 **N** 張（±Δ）`; macro `核心CPI **最新**（前值 X，期別）` or `（持平，期別）`. Data-derived text is markdown-escaped; the probe and the width machinery were removed, and the width drift guard in `scripts/lib/edgeConstants.test.mjs` now guards the two `escapeMd` copies instead.

**Verification**: `npm test` 2530 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. DEV deploys v17 (24 columns), v18 (probe), v19 (markdown). After v19 a holdings preview (missing quotes 0) and a full-edition summary preview were sent to the user's channel with the real 09/18 data. Builder blockers on dev.10 and dev.12 were all stale assertions the main session had not updated in `discordRun.test.ts`, `holdingsRun.test.ts` and `edgeConstants.test.mjs` — fixed there, no production change needed.

**Next**: the user reviews the two real markdown cards on their phone; watch one real 17:30 / 21:30 round on DEV; PROD untouched and needs explicit OK.

---

## 📅 Log: 2026-09-18 13:45:00 Asia/Taipei (Task 165 — card parity and the quote-header bug, 0.9.58-dev.8 / dev.9)

**The bug worth remembering**: every position on a real holdings card showed `--` for 現價/未實現/報酬率. `makeChartFetch` in `holdingQuotes.ts` fetched Yahoo with `{ signal }` and **no headers**, so the request went out with Deno's default `User-Agent` and Yahoo refused it. Everything else in `stock-report` that fetches Yahoo already sends `Accept: application/json` + `User-Agent: UA` (`twChips.ts`'s `fetchJson`), which is why the market summary's index block was fine and only the holdings card was broken; `stock-price`'s `fetchYahooPrice` sends the same headers, which is why the app's own quotes work from the Edge. Fixed by sending those two headers, importing `UA` from `twChips.ts`. Measured on DEV: `holdings-preview` reported 7 of 7 positions without a quote before (v15) and 0 of 7 after (v16).

**How it was found**: the user reported trailing `--` columns and asked for 庫存總覽 parity. Revision 4 added a `missingQuotes` counter to the preview result — that counter is what turned "maybe the quotes are stale" into "every quote fails in the Edge runtime, and only here". A laptop run of the same code against the same account fetched 6 of 6, which is what pointed at the request itself rather than the data.

**0.9.58-dev.8 (Revision 4)**: each position gained a `市值 … 成本 …` line (SHORT rows read 價金, since a short's basis is proceeds), so the card now carries every column 庫存總覽 shows, plus 當日%, 已實現 and the per-currency KPI block. `createQuoteCache` now runs at most 2 key fetches at a time instead of opening one per position at once. The preview result carries `missingQuotes`, the admin console shows 「已送出完整持股報告（資料日 …，N 檔無報價）」, and a daily send logs `holdings quotes missing` with counts only. Layout is the compact one the user picked: four lines per position, five when 已實現 is not 0.

**0.9.58-dev.9 (Revision 5)**: the header fix above.

**Verification**: `npm test` 2529 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. DEV deploys v15 then v16 (ezbr `02e08077…` then `8b6ba626…`), each followed by a real `holdings-preview` for the account with 114 transactions, which is also how the fix was proven. A local render of that account's card was read line by line: 7 positions, 996 characters of 2,800, 已實現 only on the two tickers with sells, the 2303 long/short pair carrying it once, 保本 just above 均價.

**Next**: watch one real 17:30 round on DEV; PROD still untouched and needs explicit OK (merge `main`, §14 + §15, clone cron, deploy).

