# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — holdings card now carries 今日已實現, per-position 已實現 and 均價／保本價
- Status: 🔄 **0.9.58-dev.7 on `dev`** (`c5c40b6`, not pushed) — DEV Supabase still runs the dev.6 `stock-report` (v14); the new card needs a DEV deploy; PROD untouched
- Timestamp: 2026-09-18 13:13:38 Asia/Taipei

---

## 📅 Log: 2026-09-18 13:13:38 Asia/Taipei (Task 165 — holdings card P&L, 0.9.58-dev.7)

**Asked first**: the card already showed 未實現 / 今日 / 今年已實現 per currency and 未實現 / 報酬率 / 當日% per position, so the user picked what was missing: 今日已實現, per-position 累計已實現, per-position 均價與保本價. 全幣別合計 was offered and not chosen, so TWD and USD stay separate.

**Code** (`holdingsCard.ts` only; the engine stays frozen, D6): `HoldingRowOut` gains `avgCost`, `breakEven`, `realized`; `CurrencySummary` gains `realizedToday`. `realized` is `Position.realized` summed across workspaces per key and attached once — LONG row, else SHORT row — so a key with both legs is never counted twice. `realizedToday` sums `ledger.yearly[year(ymd)].tickers[*].sells` whose `date === ymd` (SHORT_COVER legs included), split by `YearTickerDetail.currency`. `breakEven` is the lowest cent where `estimateUnrealized` of a synthetic single-lot holding is ≥ 0, seeded from the closed form, with the share-weighted fee rate of the contributing workspaces — it therefore cannot drift from the 未實現 column, and SHORT rows get `null`. Rendering: a KPI line 今日已實現 (always, even 0) and per position `均價 … 保本 …` plus `已實現 …` only when non-zero.

**Review**: main session read the diff (money code); `route:reviewer` PASS with one RISK — the break-even step-down loop had no cap. Fixed together with a second defect the main session found: a non-converged search used to return the last tried price as if it were the break-even price. Both searches are now bounded at 2,000 steps and a non-converged search returns `null`, which renders as `--`.

**Verification**: `npm test` 2521 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. The golden "builds the full two-card message exactly" test carries the new lines. Also rendered a card from the real DEV data of the account with 114 transactions (local, nothing sent to Discord): 已實現 appeared only on the two tickers with sells, the 2303 long/short pair showed it once, 保本 sat just above 均價, 今日已實現 was 0 (no sells today), and the title correctly flagged the 09/17 quotes as not today.

**Next**: DEV deploy of `stock-report` is needed before the card changes reach a real send — awaiting explicit OK; then a 完整推送測試 from the admin console; PROD still untouched.

---

## 📅 Log: 2026-09-18 12:24:08 Asia/Taipei (Task 165 Phase 2 step 2d revision 2, 0.9.58-dev.6)

**User feedback, five items** (spec `docs/agent/specs/discord-admin-accounts.md` §9, which overrides D2 and D7): accounts and the global webhook at the top with the explanations at the bottom; one click switches account and the editor must name it; a per-account 「完整推送測試」; the schedule as a half-hour drop-down instead of typing, fields and order reworked; general UI polish. Asked and answered before building: the grid is on the hour and half hour, so 17:05 is gone and the brief default becomes 17:30; deploy to DEV and commit was authorized.

**Code**: `discordSchedule.ts` now exports `SCHEDULE_OPTIONS` (brief 17:30–20:30, full 21:00–23:30) and drops `SCHEDULE_HOURS` / `scheduleMinuteOptions`; `discordAccounts.ts` gains op `holdings-preview` (delegates to `runHoldingsSettingsOp`'s existing `preview`, returns `previewYmd`); schema §13/§14 default to `'30 9 * * 1-5'` and §15's SQL check accepts only minute 0 or 30 in those ranges. Browser: `AdminConsolePage` renders `DiscordSection` → `DiscordAccountsSection` (accounts, then schedule) → new `DiscordHelpSection`; the global card's heading is 「全域 Webhook」, its recent-sends table is behind a 「最近發送紀錄（N 筆）」 toggle and the how-to moved to the help card; the account section is master–detail (`nav aria-label="帳號清單"`, `aria-current`, first account selected, detail titled with the email and its last send); 「完整推送測試」 reports 「已送出完整持股報告（資料日 …）」; an off-grid stored time shows as 「（目前設定，請改選）」 and blocks saving; scoped `dsc-*` CSS only.

**DEV**: `discord_schedule_set` replaced via `CREATE OR REPLACE` inside a transaction with the DEV identity predicate, then the schedule moved to 17:30 / 21:30 (all three jobs read `30 9`, `30 9`, `30 13`); `stock-report` deployed v13 → v14, ezbr `c439abab…` → `9fab9a41…`. End-to-end with a temporary admin user: 17:00 / 17:05 / 18:15 / full 21:15 all refused with 400 `invalid-time`, 18:30 / 22:00 accepted and restored, market and holdings set/test/clear, `holdings-preview` → 409 `no-holdings` (that account holds nothing, so the op is wired), unknown account 400, demoted user 403 — all passed, temp account deleted.

**Verification**: `npm test` 2512 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. Browser check (Supabase-mode vite, all backend calls mocked, ad-hoc script not committed) 13 checks at 1280 px and 390 px: panel order, collapsed recent sends, account list and one-click switch, half-hour drop-downs and save, market custom → test → inherit, holdings set → toggle → connection test → full report → clear, help card, no token in the DOM, bearer on every call, no overflow, no page errors. Two polish rounds came out of reading the screenshots: the first fixed a real bug (toggle label overflowing onto 「測試持股報告」), the second separated the holdings rows, removed the duplicated inline hint and made the account rows look clickable.

**Next**: real test sends to a private webhook from the admin console; watch one 17:30 and 21:30 round on DEV; PROD needs explicit OK (merge `main`, §14 + §15, clone cron, deploy).

