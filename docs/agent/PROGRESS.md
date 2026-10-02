# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **Task 190 on `dev` (0.10.22-dev.1)** — fee settings: broker presets + sticky action bar. 0.10.21 is the release on `main`.
- Status: 🔄 `dev` ahead of `main` by the Task 190 UI change; PROD = 0.10.21 with its settings set.
- Timestamp: 2026-10-02 16:05:00 Asia/Taipei

---
## 📅 Log: 2026-10-02 16:05:00 Asia/Taipei (Task 190, 0.10.22-dev.1 on `dev`)
- **Ask** (/impeccable): fee settings hard to operate; redesign without touching core behaviour.
- **Done**: broker presets (玉山 / 元大 / 自訂) over the same four fields, details folded behind 改單項; sticky 儲存 bar with 台股未實現淨損益 saved → previewed. Details: TASK.md Task 190.
- **Verified**: vitest 2,824 pass; build / lint / `typecheck:edge`; detector clean; both Playwright scripts PASS (1440 + 390).
- **Left**: modal home + dark theme not seen in a browser; user review; not released.
---
## 📅 Log: 2026-10-02 15:25:00 Asia/Taipei (0.10.21 released — Task 189)
- **Release**: gates (`npm test` 2,819 pass / 7 skipped, `npm run build`, `npm run typecheck:edge`) green; `main` = `dev` = `99cbe50`; CI + Release 0.10.21 by CI (body checked); live bundle carries `sell_fee_basis`.
- **PROD**: DDL `sell_fee_basis` (identity-guarded), `verify_setup()` 10/10; Edge `stock-report` v25, ezbr c3e280bd0730… (= DEV v41).
- **PROD settings (user's request)**: Ron的投資組合 → 現折／日退 + 牌告; 玉山證卷 → 月退 + 牌告. Every holding's figure and ROI identical before/after on the same quotes (玉山 76,779 total, Ron −11,038); details TASK 189 item 6.
- **Left**: TASK 189 items 7 and 11 (00685L is never discounted; one rate per workspace).
