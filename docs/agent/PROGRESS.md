# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.22 released** — TW names from the exchange list + 0050 data fix (BUG-109); fee settings broker presets (Task 190).
- Status: ✅ `main` = `dev` (see git log); frontend only; PROD data fix applied and checked.
- Timestamp: 2026-10-02 16:55:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 16:55:00 Asia/Taipei (0.10.22 — BUG-109 + Task 190)
- **BUG-109**: 0050 read 「台灣５０」 — a 2026-09-30 bulk import's spelling, shown because a holding takes the newest row's name. Data fixed on PROD (11) and DEV (22) to the TWSE name 「元大台灣50」 (before-images outside the repo); TW labels now come from the exchange list (`twOfficialName`), row name as fallback. Details: FIXED_BUG.md BUG-109.
- **Release**: gates green (`npm test` 2,827 pass / 7 skipped, build, `typecheck:edge`, lint); ships Task 190's fee-settings redesign too. Frontend only — no DDL, no Edge.
- **Left**: Task 190 item 3 (modal + dark theme unseen); Discord card still uses row names (00981A has two in the data).
---
## 📅 Log: 2026-10-02 16:05:00 Asia/Taipei (Task 190, 0.10.22-dev.1 on `dev`)
- **Ask** (/impeccable): fee settings hard to operate; redesign without touching core behaviour.
- **Done**: broker presets (玉山 / 元大 / 自訂) over the same four fields, details folded behind 改單項; sticky 儲存 bar with 台股未實現淨損益 saved → previewed. Details: TASK.md Task 190.
- **Verified**: vitest 2,824 pass; build / lint / `typecheck:edge`; detector clean; both Playwright scripts PASS (1440 + 390).
- **Left**: modal home + dark theme not seen in a browser; user review; not released.
