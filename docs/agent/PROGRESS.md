# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 200** — 0050 成分股 tab (Yuanta PCF/Daily → `market/etf_holdings/0050.json`), 0.10.39-dev.1.
- Status: ✅ `dev` pushed; Edge `stock-report` deployed to DEV only. `main` / PROD = 0.10.38.
- Timestamp: 2026-10-13 22:46:23 Asia/Taipei

---

## 📅 Log: 2026-10-13 22:46:23 Asia/Taipei (Task 200, 0.10.39-dev.1)
- **Ask**: research feasibility of showing Yuanta's 0050 「持股比重」 page in-app → deploy a DEV probe → 「開始寫spec，然後實作…呼叫 /route:reviwer…都沒問題直接幫我push到dev。supabase相關的部分都授權給你」.
- **Phase 0**: source is Yuanta's JSON bridge (`FuncId=PCF/Daily`), whole-fund holdings; `date` = announcement date; published same day ~16:00; weights over `fundsize`. A throwaway DEV function `etf-probe` proved Edge reachability (6/6 HTTP 200) and was deleted. Details: `specs/200-etf-holdings.md`.
- **Schedule finding**: DEV has no `stock-report-nightly` cron; `generate-chips` is probe-driven and skip-gated, so the sync rides on `market-data-daily` (18:00 / 22:00 Taipei) instead of next to `syncSectorFlow`.
- **Done**: Edge `etfHoldings.ts` / `etfHoldingsSync.ts` + wiring; Web proxy, view helpers, `EtfHoldingsTab`, conditional 成分股 tab; admin-run job; MechanismGuide; schema.sql note.
- **Review** (`route:reviewer`, sonnet, user-requested by name; 152,399 tokens, 62 tool uses, 421 s; read-only, could not run `git diff`): VERDICT FAIL, 1 BLOCKER + 10 RISK, all checked against the code, none false. Fixed: row links to `#/analysis/<code>` land on another stock for non-held/watched codes (links removed); failed Storage read taken as "no file" (dedicated reader throws); failures invisible (→ `app_log`, manual run 502); ETF fetch inside probe follow-up budget (skipped there); schema.sql retirement note; `invalid` shown as empty; producer→consumer contract test; order by weight; exception message kept; malformed stored day; unreachable branch. Accepted: no retry after a timeout inside the 10 s budget.
- **Verified**: `npm test` 3,173 pass / 7 skipped; `npm run build`, `typecheck:edge`, oxlint exit 0; impeccable detect clean. DEV live: first run `synced: true` (trade date 2026-10-13, 1.3 s), second run `unchanged` in 163 ms with no outbound request. Playwright preview (temporary harness, deleted) desktop light/dark + 390 px: no page errors, no horizontal overflow, expand → 50 rows; fixed th row-header rule, default-blue link, undimmed zero rows.
- **Not verified**: the Storage not-found detection in `downloadEtfHoldingsFile` (index.ts, not unit-testable) is checked live on DEV after the redeploy — see the line below once recorded; the tab inside the logged-in app (needs cloud login).

## 📅 Log: 2026-10-13 17:30:39 Asia/Taipei (Task 199, design only)
- **Ask**: 「如果我想要借鏡這些圖表跟UI呈現方式，我們有哪些地方建議調整?」 → 「先依照你的建議且用相關skill 設計與html demo」 → publish to artifacts → use real data → 「幫我比對一下前後差異，然後用html show給我看」.
- **Done**: recommendations, two HTML mockups and two private artifacts — details and open items in `TASK.md` Task 199. No app code, no version change.
- **Verified**: Playwright screenshots desktop light/dark + 390 px phone, no page errors; `impeccable detect` clean except the 2rem quote price (kept: it is the live app's size); range figures cross-checked against the user's screenshot.
- **Not done**: backend dividend-history check; implementation; the HTML files are uncommitted.
