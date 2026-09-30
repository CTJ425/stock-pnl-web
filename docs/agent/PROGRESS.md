# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 177 匯入判重 — a re-imported trade is recognised by date/market/ticker/direction/price/qty, so a differing fee no longer duplicates it; 取代 mode added alongside
- Status: 🔄 `dev` = 0.10.8-dev.2, `main` = 0.10.7; no DDL, no Edge deploy
- Timestamp: 2026-09-30 14:30:00 Asia/Taipei

---

## 📅 Log: 2026-09-30 14:30:00 Asia/Taipei (Task 177 判重放寬, 0.10.8-dev.2)
- User looked at the real import preview — 118 rows, only 8 flagged, 「確認匯入 110 筆」 — and asked for the opposite of what 0.10.8-dev.1 delivered: have the import **recognise** a trade it already holds and skip it, rather than delete and rewrite the period.
- My earlier objection to a looser key was wrong and the correction matters: `markDuplicateRows` already matched as a **multiset**, so two genuine same-price fills on one day can never collapse into one — k copies in the file against m on the ledger always leave k − m to import. Loosening the key does not drop a real trade.
- `markDuplicateRows` → `matchImportRows` (`utils/csv.ts`), returning `'new' | 'exact' | 'similar'` per row. `exactKey` is unchanged; `tradeKey` is 日期|市場|代號|買賣別|單價|股數 — fee/tax and 交易性質 are out, because 玉山 charges the full statutory rate and refunds monthly, so its export always disagrees with a row typed at the discounted rate. Two passes over per-key buckets with a `used[]` flag per existing row: exact first, so an exact row never loses its ledger match to a looser one (`[712]` on the ledger, `[712, 713]` in the file ⇒ exact, new — not similar, exact).
- UI: 狀態 column now reads 重複 / 帳上已有（費用不同）, the header counts both kinds separately, and the checkbox became 「仍要匯入帳上已經有的 N 筆」. 取代 mode is untouched and still the answer when the file should simply be the truth for its period.
- Verify against the user's own 118-row export: ledger written by the same pipeline ⇒ 118 exact; the same trades with fees at 60% (a discounted hand-typed ledger) ⇒ 118 similar, 0 new — that is the case that used to import 110 duplicates; only the last 20 on the ledger ⇒ 20 exact, 98 new. Real Chromium with 3 seeded rows (1 identical, 2 with different fees): 「其中 1 筆完全相同、2 筆帳上已有但費用或性質不同」, 確認匯入 115 筆.
- `TransactionsPage.import.test.tsx` flipped: the case that asserted 合併 produces a 4th row now asserts it produces none (button disabled at 0 筆). `txRowCount()` had to be scoped to `.tx-table` — the modal renders a preview table of its own.
- Verify: vitest 151 files / 2,575 tests, 2,568 passed, 7 skipped; `npm run build`, `typecheck:edge`, `lint` exit 0.

---

## 📅 Log: 2026-09-30 13:30:00 Asia/Taipei (Task 177 取代匯入, 0.10.8-dev.1)
- User re-imported a broker CSV (玉山 API → `esun_to_stockpnl.py`) into a workspace that already held those trades and the ledger double-counted. Reproduced with the real parser: the file itself is clean (118 rows, 0 errors, 交易性質 → `SPOT`, split fee/tax mode on), and re-importing it against rows written by that same pipeline flags 118/118 as duplicates. So the duplication does not come from the file — it comes from `markDuplicateRows` (`utils/csv.ts:185`) needing all 8 fields to match exactly, which hand-entered or old-spreadsheet rows never do (a fee off by NT$1 is enough).
- Rejected: widening the duplicate key with a fee/price tolerance. It trades a visible error (an extra row you can see and delete) for an invisible one — the file has two genuinely identical fills on 2024-08-07 (2634 漢翔 48.1 × 1000, twice), and any tolerance merges real trades into one and silently drops a transaction.
- Built instead: 取代匯入. `replaceScope(rows, existing)` (`utils/csv.ts`) returns the CSV's own first/last `tx_date` plus the ids to delete, narrowed three ways — inside that window only, only the markets the CSV carries, and only BUY / SELL, so DIVIDEND / STOCK_DIVIDEND (never in a broker trade export) can't be swallowed. The mode is a radio pair in `CsvImportModal`; `handleImport` (`TransactionsPage.tsx`) asks a danger `confirm()`, then **writes first and deletes after** — a failed delete leaves visible duplicates, a failed write after a delete would destroy the old rows with nothing to replace them.
- Python fixes in the user's converter (file lives outside this repo): `t_time` dropped from `fill_key` — it is often empty, so one export with it and one without turned a single fill into two and defeated the cross-file dedup, putting duplicates inside the CSV itself; and `BUY_SELL[...]` became a warn-and-skip instead of a KeyError that aborts the whole run. Verified on synthetic exports: the cross-file pair collapses to 1 row, the unknown code is reported and skipped.
- Verify: vitest 151 files / 2,569 tests, 2,562 passed, 7 skipped — `replaceScope` unit cases in `csv.test.ts`, mode wiring in `CsvImportModal.test.tsx`, and `TransactionsPage.import.test.tsx` which drives the real local-mode provider: importing the same file twice leaves 3 rows, while the 合併 path with a fee 1 元 different produces 4. `npm run build` and `lint` exit 0. Real Chromium at 1280 and 390: the notice, the confirm and the result all read correctly, and after 取代 the workspace holds the CSV's 3 rows plus the untouched 股利 row.
- Committed to `dev` as 0.10.8-dev.1 (user asked for the commit, not a release). `main` stays on 0.10.7 until the user says merge. No DDL, no Edge deploy: nothing under `sources/supabase/` changed.

---
