# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.28 released** — BUG-111 (stale-tab lazy chunk → reload once). 0.10.27 (Task 192) earlier today.
- Status: ✅ `main` = `dev` (`7ec1ffe`); Pages production serves the fix (`index-CfzrYPwZ.js` has `chunk-reload-at`); Release 0.10.28 by CI, body correct. Front-end only — no Edge deploy. Left: Task 192 item 5 and Task 191 item 5 (dated checks).
- Timestamp: 2026-10-04 12:49:25 Asia/Taipei

---
## 📅 Log: 2026-10-04 12:42:09 Asia/Taipei (BUG-111 — 頁面發生錯誤 on tab switch, 0.10.28-dev.1)
- **Ask**: 「切換的時候很常出現頁面發生錯誤」.
- **Root cause**: stale tab after a deploy requests old hashed lazy chunks; Pages returns index.html (200 text/html) → dynamic import fails → root ErrorBoundary. PROD `app_log` render errors (30 d) are all this, each from a client one release behind.
- **Done**: `src/utils/chunkReload.ts` `loadChunk` around all 9 dynamic imports — reload once (30 s sessionStorage guard), else rethrow.
- **Verified**: vitest 2,884 pass / 7 skipped (+5 `chunkReload.test.ts`); build; `typecheck:edge`. Playwright, local-mode prod builds behind a Pages-style fallback: before → 頁面發生錯誤 reproduced; after → one reload, 年度收益 renders; permanently broken chunk → one reload then ErrorBoundary.
- **Released** (2026-10-04 12:49:25, user OK): 0.10.28 fast-forwarded to `main` `7ec1ffe`; Pages production bundle carries `chunk-reload-at`; Release 0.10.28 by CI.
- **Left**: watch PROD `app_log` — `dynamically imported module` render rows should stop from clients ≥ 0.10.28.
## 📅 Log: 2026-10-04 12:23:11 Asia/Taipei (Task 192 — holdings card per workspace, 0.10.27)
- **Ask**: Discord holdings card should not merge workspaces; user chose one message split by workspace, accepted D1–D3 as proposed (name always shown; grand total line when >1 section; one embed per workspace × currency), then "merge to main when done".
- **Done**: `holdingsCard.ts` `aggregateCard` (per-ledger `aggregateHoldings` + merged total), `buildHoldingsPayload(card)` with `name｜` title prefix, `budgetFor(cards)` (≤2,800 per card, 6,000 total), 10-embed cap keeping whole workspaces + `…另 K 個工作區`; loader selects `workspaces.name` in every fallback step. Grand total line is shown only when ≥2 sections (with one it would repeat the card's own total).
- **Verified**: vitest 2,879 pass / 7 skipped (Edge 936 incl. 11 new Task 192 cases); build; `typecheck:edge`. DEV `stock-report` deployed from clean `a3bfb07`: v42 → v43, ezbr `320d9322…` → `92e139e7ab55…`; `functions download` diff of holdingsCard/holdingsRun/discordHandlers = identical. Release 0.10.27 created by CI, body correct.
- **PROD** (2026-10-04 12:25:51, user authorized): `stock-report` deployed from clean `bbc9148` (Edge code = `a3bfb07`), `--no-verify-jwt`: now v27, `verify_jwt=false`, ezbr `92e139e7ab55…` = DEV.
- **Not verified**: no real card sent — Sunday, the tick runs weekdays 17:00–23:30.
- **Left**: look at the first real per-workspace card (DEV/PROD) on 2026-10-05.
