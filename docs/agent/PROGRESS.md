# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修好查無檔案被當成錯誤的根因，並完成追蹤文件對帳（Task 156/157, 0.9.44, BUG-078）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 15:14:01 Asia/Taipei

---

## 📅 Log: 2026-09-11 16:12:57 Asia/Taipei (Task 159 D9 reverted, 0.9.47)

- **What**: User decision: desktop returns to the bottom-right floating 「新增交易」 button (icon + text); mobile keeps the 56×56 icon button; the admin view shows none. The 0.9.45 header button (`.header-add`) was removed.
- **Finding**: `main.container` already had `padding-bottom: 96px` above 720 px, so the page end was never covered on desktop. The remaining cost of the floating button is mid-scroll overlap of the rightmost column, which the user accepted.
- **Verification**: `AppShell.a11y` test updated first (red while the header button existed), then green. 117 test files / 1,864 tests, exit 0; `npm run build` and `npm run typecheck:edge` exit 0. Playwright: at 1440 and 1024 the button is 124×48 with its label, exactly one add button, 109 px clearance at the page end; at 375 it is 56×56 with the label hidden.
- **Release**: 0.9.47 merged to `main` and synced to `dev`. Frontend not uploaded.

## 📅 Log: 2026-09-11 15:38:25 Asia/Taipei (BUG-080, 0.9.46)

- **What**: The user's iPhone screenshots of live 0.9.45 showed: select text clipped (regression from 0.9.45 — `.field select` joined the ≤720 px `font-size: 16px; padding: 12px 12px` rule while the height stayed 40 px), the iOS date input too tall and overflowing its column, the trend-chart title 「走勢圖」 and the admin 「重新整理」 button squeezed to one character per line, and the add-transaction FAB covering admin status text.
- **Fix**: ≤720 px inputs and selects are 44 px high with 0 vertical padding; date input `appearance: none` + `min-width: 0`; `.m-card-h` wraps, title and badge `nowrap`, the 8 range buttons form a 4×2 grid at ≤560 px; the ProbeWarRoom stamp row wraps; no add button on the admin view.
- **Verification**: 117 test files / 1,864 tests, exit 0; `npm run build` and `npm run typecheck:edge` exit 0. A 375 px harness with the built CSS: 「走勢圖」 14×60 → 42×20, badge 50×75 → 132×23, range buttons in 2 rows, controls 44 px. iOS-only rendering (select, date) cannot be reproduced in Chromium — needs a device check after upload.
- **Not changed**: the blank area above the intraday plot comes from a y-scale centred on the previous close (design choice); left for the Task 158 chart batch.
- **Release**: 0.9.46 merged to `main` and synced to `dev`. Frontend not uploaded.

