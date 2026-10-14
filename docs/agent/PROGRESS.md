# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 200 expansion release 1** — any ETF gets the tab; 0056 + 中信 009828 synced; branch `feature/etf-holdings-r1` (0.10.40-dev.1) in PR.
- Status: ✅ `main` = 0.10.39 (PROD Edge + Pages); DEV Edge runs the branch (`06fcb71f10c2…`); PR pending review.
- Timestamp: 2026-10-14 10:11:38 Asia/Taipei

---

## 📅 Log: 2026-10-14 10:11:38 Asia/Taipei (Task 200 expansion release 1, 0.10.40-dev.1)
- **Ask**: /grill-me on other ETFs (decisions in spec § Expansion), then 「開始中信 009828 的探勘…完成之後，把相關的PR使用 /herdr 交給 session 2 並且請進行code review，並給你建議，但是要禁止他直接改，接著交由你繼續完成相關任務」.
- **Phase 0 (CTBC)**: passed — SPA API found in the bundle; raw curl failed until the token was URL-encoded; Edge 3/3 via a throwaway DEV function (deleted). Details: spec § Release 1.
- **Done**: shared issuer module, CTBC source + session, per-issuer sources, universe sync with budget, contract additions, tab for every ETF code with 尚未串接 state, 市場分布 bar, issuer-aware note/link, admin text.
- **Verified**: `npm test` 3,201 pass / 7 skipped; `npm run build`, `typecheck:edge`, oxlint exit 0; impeccable detect clean. DEV deploy of the branch: first run 0056 + 009828 written (009828: 30 holdings, TW 17 / JP 9 / KR 4, assets null), 7 unsupported, 4.5 s; second run 705 ms. Playwright preview (temporary, deleted): 009828 desktop + 390 px and 00878 — no errors/overflow; caught and fixed the hard-coded 「元大官網原始頁面」 link text and an unlabelled market remainder.
- **Not verified**: CTBC same-day publish time; whether 10/12 was skipped for a Japanese holiday; the tab logged in.

## 📅 Log: 2026-10-14 09:28:08 Asia/Taipei (Task 200, release 0.10.39)
- **Ask**: 「先幫我合併到main，PROD相關的supabase都授權給你」.
- **Release**: gates had passed on `89481ae` (3,176 / 7 skipped, build, `typecheck:edge`, oxlint); release commit only moves the version (build re-run green). CHANGELOG finalized before the push — the first bullet still described the removed row links and the old 「前 10 檔，可展開」 table, rewritten to the charts-first layout. `346c17b release: 0.10.39`, `main` fast-forwarded from `794d9d7`, `dev` = `main`. CI `Sync GitHub Releases` created Release 0.10.39 with that body; CI green.
- **PROD Edge**: only `stock-report` changed since 0.10.38. Deployed from the clean tree at `346c17b` with `--no-verify-jwt`: v7, `ezbr_sha256` `b99af535…` → `6a0888820655…`, identical to DEV v18. PROD `market-data-daily` exists (`0 10,14 * * 1-5`, active). Triggered `sync-etf-holdings` once (cron command with the action swapped, PROD identity predicate in the same script, command text never selected): HTTP 200 `synced: true`, trade date 2026-10-13, 1.5 s; public `market/etf_holdings/0050.json` on PROD holds 2026-10-13 (NAV 112.06, 50 stocks).
- **Pages**: content check, not hash compare — live `AnalysisPage-c7dheOl-.js` contains 「持股集中度」 (exists only from 0.10.39).
- **Not verified**: the first scheduled run (2026-10-14 18:00 Taipei) on either env; the tab while logged in.
