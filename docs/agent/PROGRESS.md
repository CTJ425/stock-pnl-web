# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 200 expansion release 2** — 群益 00919 / 00685L and the futures-exposure view; branch `feature/etf-holdings-r2` (0.10.40-dev.3).
- Status: ✅ `main` = 0.10.39 (PROD); `dev` = 0.10.40-dev.2 (release 1); DEV Edge runs release 2 (`36539ca3b4bd…`); PR pending review.
- Timestamp: 2026-10-14 11:18:46 Asia/Taipei

---

## 📅 Log: 2026-10-14 11:18:46 Asia/Taipei (Task 200 expansion release 2, 0.10.40-dev.3)
- **Ask**: 「幫我做下一家投信，且全部完成再和我回報，如果需要異動到supabase 我都授權給你，但是都先在dev進行驗證」.
- **Phase 0 (群益)**: passed — `CFWeb/api/etf/buyback` is the whole fund; Edge reachable. Details: spec § Release 2.
- **Done**: Capital source + session, futures-led validation / sync / 期貨曝險 view, per-call 3 s / 7 s, log detail on allowlisted keys.
- **Verified**: `npm test` 3,218 / 7 skipped; build, `typecheck:edge`, oxlint, impeccable detect. DEV: 00919 recreated, 00685L written, others unchanged. Preview (temporary, deleted) 00685L desktop light + 390 px dark, 00919 desktop: no errors / overflow.
- **Caught on DEV**: list parser read the wrong level (test fake was a hand-built array); web dropped no-stock days. Both fixed with tests on the real response shapes. Process slip: a `git stash` used for a red/green check also stashed the user's own `CLAUDE.md` edit — `stash pop` restored it, verified (`git diff --stat`, `docs/agents/` intact, empty stash list); not to be repeated.
- **Not verified**: Capital and CTBC same-day publish times; the tab logged in.

## 📅 Log: 2026-10-14 10:11:38 Asia/Taipei (Task 200 expansion release 1, 0.10.40-dev.1)
- **Ask**: /grill-me on other ETFs (decisions in spec § Expansion), then 「開始中信 009828 的探勘…完成之後，把相關的PR使用 /herdr 交給 session 2 並且請進行code review，並給你建議，但是要禁止他直接改，接著交由你繼續完成相關任務」.
- **Phase 0 (CTBC)**: passed — SPA API found in the bundle; raw curl failed until the token was URL-encoded; Edge 3/3 via a throwaway DEV function (deleted). Details: spec § Release 1.
- **Done**: shared issuer module, CTBC source + session, per-issuer sources, universe sync with budget, contract additions, tab for every ETF code with 尚未串接 state, 市場分布 bar, issuer-aware note/link, admin text.
- **Verified**: `npm test` 3,201 pass / 7 skipped; `npm run build`, `typecheck:edge`, oxlint exit 0; impeccable detect clean. DEV deploy of the branch: first run 0056 + 009828 written (009828: 30 holdings, TW 17 / JP 9 / KR 4, assets null), 7 unsupported, 4.5 s; second run 705 ms. Playwright preview (temporary, deleted): 009828 desktop + 390 px and 00878 — no errors/overflow; caught and fixed the hard-coded 「元大官網原始頁面」 link text and an unlabelled market remainder.
- **Review by session 2** (herdr tab 2, agent `pr-reviewer`, review-only): 0 BLOCKER / 6 RISK / 6 NIT, all verified true; 6 RISK + 3 NIT fixed as 0.10.40-dev.2 (spec § Release 1 review). Gates after: `npm test` 3,206 / 7 skipped, build, `typecheck:edge`, oxlint. DEV redeploy `c83c6378a473…`: 009828 file deleted then recreated by the sync; 0050 / 0056 unchanged; 4.0 s.
- **Not verified**: CTBC same-day publish time; whether 10/12 was skipped for a Japanese holiday; the tab logged in.
