# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.27 released** — Discord 持股日報 split per workspace (Task 192).
- Status: ✅ `main` = `dev`; `stock-report` DEV v43 / PROD v27, both ezbr `92e139e7ab55…`. Left: look at the first real card on 2026-10-05.
- Timestamp: 2026-10-04 12:25:51 Asia/Taipei

---
## 📅 Log: 2026-10-04 12:23:11 Asia/Taipei (Task 192 — holdings card per workspace, 0.10.27)
- **Ask**: Discord holdings card should not merge workspaces; user chose one message split by workspace, accepted D1–D3 as proposed (name always shown; grand total line when >1 section; one embed per workspace × currency), then "merge to main when done".
- **Done**: `holdingsCard.ts` `aggregateCard` (per-ledger `aggregateHoldings` + merged total), `buildHoldingsPayload(card)` with `name｜` title prefix, `budgetFor(cards)` (≤2,800 per card, 6,000 total), 10-embed cap keeping whole workspaces + `…另 K 個工作區`; loader selects `workspaces.name` in every fallback step. Grand total line is shown only when ≥2 sections (with one it would repeat the card's own total).
- **Verified**: vitest 2,879 pass / 7 skipped (Edge 936 incl. 11 new Task 192 cases); build; `typecheck:edge`. DEV `stock-report` deployed from clean `a3bfb07`: v42 → v43, ezbr `320d9322…` → `92e139e7ab55…`; `functions download` diff of holdingsCard/holdingsRun/discordHandlers = identical. Release 0.10.27 created by CI, body correct.
- **PROD** (2026-10-04 12:25:51, user authorized): `stock-report` deployed from clean `bbc9148` (Edge code = `a3bfb07`), `--no-verify-jwt`: now v27, `verify_jwt=false`, ezbr `92e139e7ab55…` = DEV.
- **Not verified**: no real card sent — Sunday, the tick runs weekdays 17:00–23:30.
- **Left**: look at the first real per-workspace card (DEV/PROD) on 2026-10-05.
## 📅 Log: 2026-10-04 11:22:25 Asia/Taipei (0.10.26 release — Task 191)
- **Ask**: footnote placement for 總經 (user chose bottom of 國際指數, dev.3); badges 休市 vs 已收盤 for every region (dev.4); 未開盤 before the open (dev.5); then merge to `main` (user OK).
- **Done**: `sessionHours.ts` `SessionState` = preopen / open / break / closed / holiday, `SESSION_LABELS` shared by `GlobalIndices` and `IndexDetail`; holiday = local weekend or `ClosedDates` (TW from `TW_HOLIDAYS`). JP/KR/US have no holiday calendar — their holidays read as trading days.
- **Verified**: vitest 2,869 pass / 7 skipped; build; `typecheck:edge`; lint clean. PROD `stock-price` deployed from clean `6fb3cf6` (Edge code identical to DEV's `373e76f`): v16 → v17, ezbr `b085cd6e…` → `811480ed6d70…` (= DEV). Live PROD call (Sunday): 0050 112.8 / 2603 240 / 2303 161.5 = Friday closes via Yahoo. Release 0.10.26 created by CI, body correct. Pages production bundle carries `stmt-closed`, `台股：`, `未開盤`.
- **Left**: Task 191 item 5 — on 2026-10-09 check `price_cache` for `trade_date = 20261009` rows and the dashboard note.
