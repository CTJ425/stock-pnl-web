# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修好查無檔案被當成錯誤的根因，並完成追蹤文件對帳（Task 156/157, 0.9.44, BUG-078）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 15:14:01 Asia/Taipei

---

## 📅 Log: 2026-09-11 15:38:25 Asia/Taipei (BUG-080, 0.9.46)

- **What**: The user's iPhone screenshots of live 0.9.45 showed: select text clipped (regression from 0.9.45 — `.field select` joined the ≤720 px `font-size: 16px; padding: 12px 12px` rule while the height stayed 40 px), the iOS date input too tall and overflowing its column, the trend-chart title 「走勢圖」 and the admin 「重新整理」 button squeezed to one character per line, and the add-transaction FAB covering admin status text.
- **Fix**: ≤720 px inputs and selects are 44 px high with 0 vertical padding; date input `appearance: none` + `min-width: 0`; `.m-card-h` wraps, title and badge `nowrap`, the 8 range buttons form a 4×2 grid at ≤560 px; the ProbeWarRoom stamp row wraps; no add button on the admin view.
- **Verification**: 117 test files / 1,864 tests, exit 0; `npm run build` and `npm run typecheck:edge` exit 0. A 375 px harness with the built CSS: 「走勢圖」 14×60 → 42×20, badge 50×75 → 132×23, range buttons in 2 rows, controls 44 px. iOS-only rendering (select, date) cannot be reproduced in Chromium — needs a device check after upload.
- **Not changed**: the blank area above the intraday plot comes from a y-scale centred on the previous close (design choice); left for the Task 158 chart batch.
- **Release**: 0.9.46 merged to `main` and synced to `dev`. Frontend not uploaded.

## 📅 Log: 2026-09-11 13:03:40 Asia/Taipei (Task 158/159 batch 1, 0.9.45)

- **What**: Mobile (iPhone 13 mini, 375×629) and desktop (1440×900, 1024×768) UI/UX audits, published as `docs/design/mobile-ux-audit-iphone13mini.html` and `docs/design/desktop-ux-audit.html`; 32 findings recorded as Task 158 (1–17) and Task 159 (D1–D15). Batch 1 (13 items) shipped.
- **Changed**: `AppShell.tsx`, `DashboardPage.tsx`, `TransactionForm.tsx`, `Toast.tsx`, `index.css`, `index.html`, `manifest.webmanifest`, new `utils/feeRateHint.ts`, 3 PNG icons.
- **Verification**: 117 test files / 1,864 tests, exit 0 (+19 new tests; 1 stale smoke assertion updated to seed holdings); `npm run build` and `npm run typecheck:edge` exit 0. Playwright re-measure at 375×629: FAB 56×56, inputs 16 px, qty input 50 → 215 px, h1 → h2 → h3, no skeleton after load. At 1440 dark: `.pnl-up` 5.33:1, sub-lines 5.31:1, help icon 6.76:1.
- **Review**: reviewer FAIL overruled — the add button is hidden while the workspace loads by design (unchanged `!loading` gate); the Toast unmount-timer note is pre-existing code.
- **Audit corrections**: mobile #11 (`applyTheme()` already updates `theme-color` at runtime) and desktop D4 (the close button existed). Both reports were republished.
- **Deferred**: mobile #8 `viewport-fit=cover` needs a real iPhone. BUG-079 (保本賣出價 vs 淨收 fee interpretation) is open and not investigated.
- **Release**: 0.9.45 merged to `main` and synced to `dev`. Frontend not uploaded to Cloudflare Pages. No Edge change.

