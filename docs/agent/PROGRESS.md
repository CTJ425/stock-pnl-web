# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 200 released as 0.10.39** — 0050 成分股 tab (charts first), Edge sync on `market-data-daily`.
- Status: ✅ `main` = `dev` = 0.10.39 `346c17b`; Edge `stock-report` same bundle on DEV and PROD (`6a0888820655…`); Pages serving 0.10.39.
- Timestamp: 2026-10-14 09:28:08 Asia/Taipei

---

## 📅 Log: 2026-10-14 09:28:08 Asia/Taipei (Task 200, release 0.10.39)
- **Ask**: 「先幫我合併到main，PROD相關的supabase都授權給你」.
- **Release**: gates had passed on `89481ae` (3,176 / 7 skipped, build, `typecheck:edge`, oxlint); release commit only moves the version (build re-run green). CHANGELOG finalized before the push — the first bullet still described the removed row links and the old 「前 10 檔，可展開」 table, rewritten to the charts-first layout. `346c17b release: 0.10.39`, `main` fast-forwarded from `794d9d7`, `dev` = `main`. CI `Sync GitHub Releases` created Release 0.10.39 with that body; CI green.
- **PROD Edge**: only `stock-report` changed since 0.10.38. Deployed from the clean tree at `346c17b` with `--no-verify-jwt`: v7, `ezbr_sha256` `b99af535…` → `6a0888820655…`, identical to DEV v18. PROD `market-data-daily` exists (`0 10,14 * * 1-5`, active). Triggered `sync-etf-holdings` once (cron command with the action swapped, PROD identity predicate in the same script, command text never selected): HTTP 200 `synced: true`, trade date 2026-10-13, 1.5 s; public `market/etf_holdings/0050.json` on PROD holds 2026-10-13 (NAV 112.06, 50 stocks).
- **Pages**: content check, not hash compare — live `AnalysisPage-c7dheOl-.js` contains 「持股集中度」 (exists only from 0.10.39).
- **Not verified**: the first scheduled run (2026-10-14 18:00 Taipei) on either env; the tab while logged in.

## 📅 Log: 2026-10-13 23:19:23 Asia/Taipei (Task 200 UI, 0.10.39-dev.2)
- **Ask**: 「我想要用圖表為主，表格為輔的呈現方式 /impeccable 我們討論看看」 → shape round (3 questions, all recommended options chosen) → 「照你的建議開始實作，然後先push到dev」.
- **Done**: 持股集中度 100 % bar, 前 10 大 shared-scale bars, 50-row table moved into `details.chart-more`, 資產配置 bar sized by the four amounts (億 labels only). Front end only; no Edge change, no DEV redeploy needed. Spec § UI revision.
- **Verified**: `npm test` 3,176 pass / 7 skipped; `npm run build` (first run caught two unused test imports — fixed), `typecheck:edge`, oxlint exit 0; impeccable detect clean. Playwright preview (temporary harness, deleted) desktop light/dark + 390 px: no errors/overflow, disclosure opens to 50 rows. First pass had white in-bar labels failing contrast on the light-theme yellow and truncating on phones — moved the figures to the legend.
- **Not verified**: inside the logged-in app (needs cloud login).
