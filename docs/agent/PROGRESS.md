# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.16-dev.1 (uncommitted)** — fixed three regressions in Task 187's sell-form 當沖 detection (BUG-095/096/097) found by a review of the 0.10.15 cycle; six more findings filed as BUG-098..103.
- Status: ✅ Gates green (vitest 2,796 pass / 7 skipped, build / lint exit 0). ⚠️ **The live site is still 0.10.14**: Cloudflare Pages reported `Deploy failed` for `8b67800` (0.10.15). Not committed or pushed yet — waiting on the user.
- Timestamp: 2026-10-02 10:00:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 10:00:00 Asia/Taipei (0.10.15 review → BUG-095/096/097 fixed, 0.10.16-dev.1)
- **0.10.15 never reached the website.** The Cloudflare Pages check run on `8b67800` says `Deploy failed` (01:24:51 UTC, a minute after the push); the docs commit `d134e30` deployed fine, so the failure is specific to that build. Verified by fetching every chunk of `stock-pnl-web.pages.dev`: only `0.10.14`, none of Task 187's strings. The log needs a Cloudflare login. The previous entry's 「still building」 was wrong, and its timestamps are UTC labelled Asia/Taipei (commits were 01:2x UTC = 09:2x Taipei).
- **Review of `89a33fe..HEAD`** (high effort, findings reproduced with throw-away App tests that were deleted afterwards). Three were fixed:
  - **BUG-095**: editing a saved ordinary sell flipped it to 當沖 and changed its fee 734 → 485 (the edit-mode ledger already includes the sell). Detection now runs for new trades only.
  - **BUG-096**: `applyDayTrade` cleared `taxRateManual`, re-introducing BUG-094 (typed 0.002 → 0.0015). Removed; one rule with the drop-down.
  - **BUG-097**: ETF 當沖 notices said 減半 while the rate is 0.1% (§2-2 covers 股票 only); the fee dialog still said 「ETF 0.05%」. Copy now follows `dayTradeTaxRate`; grep sweep listed in `FIXED_BUG.md`.
- **Tests**: three new App-level tests in `TransactionForm.fee.test.tsx`; each fails against the 0.10.15 form and passes now. Full suite 2,796 pass / 7 skipped; `npm run build` and lint exit 0.
- **Version**: `0.10.16-dev.1` in `package.json` + lockfile, `version.ts`, `README.md`; CHANGELOG entry in zh-TW.
- **Left open**: BUG-098 (restore ignores `seq`) is the sharpest; BUG-099 needs a real broker export; BUG-100..103 in `BUG_FIX.md`. Cloudflare redeploy of 0.10.15 is the user's.

---
## 📅 Log: 2026-10-02 01:30:00 Asia/Taipei (0.10.15 released — 當沖 end to end; Task 186 closed)
- **The complaint was「手續費折扣差很多」and the discount was innocent.** Three independent defects were stacked on one screen: a same-day ordering guess, a tax rate derived by analogy, and an edit form that discarded the user's own input. Six bugs (089–094) and one task closed.
- **BUG-089 root cause, closed properly (Task 186).** `tx_date` has day granularity and a bulk import writes one `created_at` per row, so `compareTxOrder` fell back to "opening legs first" and replayed 買→賣→買 as 買、買、賣. `transactions.seq`, assigned by Postgres on insert (`nextval` per row, in the order sent), is now the tiebreak. The backfill is `row_number()` over the existing sort keys, so applying `schema.sql` changes no figure; rows without `seq` behave exactly as before.
- **The verification that caught the worst one.** After the wizard shipped, a review sweep showed which same-day buy it paired with the day-trade sell was decided by a **string comparison of transaction ids**: swapping two ids on the real ledger moved 持股成本 between 323,637 and 324,638. The user's own run of the wizard had in fact labelled the wrong buy. Both the code and the DEV data were corrected; the merge to main was held until it was.
- **BUG-093 was a law question, not a code question.** `sellTaxRate / 2` had been the 當沖 rate since 0.10.9. 證交稅條例 §2-2 gives a **flat** 千分之1.5 to 上市或上櫃**股票** and displaces §2 第一款 — an ETF is taxed under 第二款 and gets no relief, so every ETF day trade had been under-withheld by half. Two tests had pinned the wrong figure, which is why the suite stayed green.
- **Four rules written into `CLAUDE.md` § Changing a number that the law or a broker decides**, each one broken in this session: cite a rate, never derive it; fix an assumption everywhere at once; never clear a guard you did not write; a test is not evidence of a domain fact. Plus the versioning invariants (`dev` never carries a bare `x.y.z`; `N` moves every commit).
- **Released**: 0.10.15 on `main` and `dev` (identical), Release published by CI with the final body, CI green. Gates: vitest 2,793 pass / 7 skipped, build / `typecheck:edge` / lint / engine-sync exit 0.
- **Deployed**: DDL (`seq`, `day_trade_tax_estimate`, the `tx_nature`-carrying `apply_transaction_updates`, `verify_setup`) applied to **DEV and PROD**, `verify_setup()` 10/10 on both; `stock-report` deployed to both, identical bundle sha `968b24fa5509`. Verified against the live DEV ledger: 2303 均價 161.8185 / −2,066, 6182 −3,631, 總成本 456,693, 已實現 18,833 — all equal to the broker app.
- **Left open**: the Cloudflare Pages frontend was still building at the time of writing (content check polling); a same-day round trip whose fee carries no halved-tax signature still cannot be auto-detected, and is now at least ordered correctly by `seq`.
