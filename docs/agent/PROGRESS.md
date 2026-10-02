# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.23 released** — Discord holdings card uses the exchanges' TW names; 00981A data fixed (BUG-109 follow-up).
- Status: ✅ `main` = `dev` (see git log); frontend only; PROD data fix applied and checked.
- Timestamp: 2026-10-02 17:25:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 17:25:00 Asia/Taipei (0.10.23 — BUG-109 follow-up: Discord card names)
- **Card**: `stock-report/twNames.ts` loads the TWSE + TPEx lists once per run; `aggregateHoldings` labels TW rows with them, row names as fallback (a TPEx outage on PROD happened once in 14 days of `twlist` logs — such a run only falls back for OTC codes).
- **Data**: 00981A 「主動統一」 → 「主動統一台股增長」, PROD 5 / DEV 10 rows, guarded and count-checked; no TW code has two names on either side.
- **Release**: gates green (2,832 pass / 7 skipped, build, `typecheck:edge`, lint); DEV Edge v42 (ezbr 320d932279f8…); PROD Edge deployed after the `main` push (see TASK / git log).
- **Not verified**: a real card send with the new names — the preview needs an admin session.
---
## 📅 Log: 2026-10-02 16:55:00 Asia/Taipei (0.10.22 — BUG-109 + Task 190)
- **BUG-109**: 0050 read 「台灣５０」 — a 2026-09-30 bulk import's spelling, shown because a holding takes the newest row's name. Data fixed on PROD (11) and DEV (22) to the TWSE name 「元大台灣50」 (before-images outside the repo); TW labels now come from the exchange list (`twOfficialName`), row name as fallback. Details: FIXED_BUG.md BUG-109.
- **Release**: gates green (`npm test` 2,827 pass / 7 skipped, build, `typecheck:edge`, lint); ships Task 190's fee-settings redesign too. Frontend only — no DDL, no Edge.
- **Left**: Task 190 item 3 (modal + dark theme unseen); Discord card still uses row names (00981A has two in the data).
