# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 200** — 0050 成分股 tab, charts-first redesign, 0.10.39-dev.2.
- Status: ✅ `dev` pushed; Edge `stock-report` deployed to DEV only. `main` / PROD = 0.10.38.
- Timestamp: 2026-10-13 23:19:23 Asia/Taipei

---

## 📅 Log: 2026-10-13 23:19:23 Asia/Taipei (Task 200 UI, 0.10.39-dev.2)
- **Ask**: 「我想要用圖表為主，表格為輔的呈現方式 /impeccable 我們討論看看」 → shape round (3 questions, all recommended options chosen) → 「照你的建議開始實作，然後先push到dev」.
- **Done**: 持股集中度 100 % bar, 前 10 大 shared-scale bars, 50-row table moved into `details.chart-more`, 資產配置 bar sized by the four amounts (億 labels only). Front end only; no Edge change, no DEV redeploy needed. Spec § UI revision.
- **Verified**: `npm test` 3,176 pass / 7 skipped; `npm run build` (first run caught two unused test imports — fixed), `typecheck:edge`, oxlint exit 0; impeccable detect clean. Playwright preview (temporary harness, deleted) desktop light/dark + 390 px: no errors/overflow, disclosure opens to 50 rows. First pass had white in-bar labels failing contrast on the light-theme yellow and truncating on phones — moved the figures to the legend.
- **Not verified**: inside the logged-in app (needs cloud login).

## 📅 Log: 2026-10-13 22:46:23 Asia/Taipei (Task 200, 0.10.39-dev.1)
- **Ask**: research feasibility of showing Yuanta's 0050 「持股比重」 page in-app → deploy a DEV probe → 「開始寫spec，然後實作…呼叫 /route:reviwer…都沒問題直接幫我push到dev。supabase相關的部分都授權給你」.
- **Phase 0**: source is Yuanta's JSON bridge (`FuncId=PCF/Daily`), whole-fund holdings; `date` = announcement date; published same day ~16:00; weights over `fundsize`. A throwaway DEV function `etf-probe` proved Edge reachability (6/6 HTTP 200) and was deleted. Details: `specs/200-etf-holdings.md`.
- **Schedule finding**: DEV has no `stock-report-nightly` cron; `generate-chips` is probe-driven and skip-gated, so the sync rides on `market-data-daily` (18:00 / 22:00 Taipei) instead of next to `syncSectorFlow`.
- **Done**: Edge `etfHoldings.ts` / `etfHoldingsSync.ts` + wiring; Web proxy, view helpers, `EtfHoldingsTab`, conditional 成分股 tab; admin-run job; MechanismGuide; schema.sql note.
- **Review** (`route:reviewer`, sonnet, user-requested by name; 152,399 tokens, 62 tool uses, 421 s; read-only, could not run `git diff`): VERDICT FAIL, 1 BLOCKER + 10 RISK, all checked against the code, none false. Fixed: row links to `#/analysis/<code>` land on another stock for non-held/watched codes (links removed); failed Storage read taken as "no file" (dedicated reader throws); failures invisible (→ `app_log`, manual run 502); ETF fetch inside probe follow-up budget (skipped there); schema.sql retirement note; `invalid` shown as empty; producer→consumer contract test; order by weight; exception message kept; malformed stored day; unreachable branch. Accepted: no retry after a timeout inside the 10 s budget.
- **Verified**: `npm test` 3,173 pass / 7 skipped; `npm run build`, `typecheck:edge`, oxlint exit 0; impeccable detect clean. DEV live: first run `synced: true` (trade date 2026-10-13, 1.3 s), second run `unchanged` in 163 ms with no outbound request. Playwright preview (temporary harness, deleted) desktop light/dark + 390 px: no page errors, no horizontal overflow, expand → 50 rows; fixed th row-header rule, default-blue link, undimmed zero rows.
- **DEV deploy** of commit `be74995` (clean tree): `stock-report` v18, `ezbr_sha256` `6a0888820655…` (was `b99af535…` before this task), `verify_jwt=false`. Triggered by running the `market-data-daily` command with its action swapped (command text never selected). Existing file → `unchanged` 427 ms; after `storage rm` of `market/etf_holdings/0050.json` (public URL → 400) → `synced: true`, file recreated (2026-10-13, NAV 112.06, 50 stocks, fundSize 2,499,619,508,807) — the not-found detection works. `app_log` rows for `sync-etf-holdings`: 0.
- **Not verified**: the tab inside the logged-in app (needs cloud login; checked through a temporary harness instead); a real `market-data-daily` 18:00 run (next: 2026-10-14).
