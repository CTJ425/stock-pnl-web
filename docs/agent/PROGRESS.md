# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 修好查無檔案被當成錯誤的根因，並完成追蹤文件對帳（Task 156/157, 0.9.44, BUG-078）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-10 15:14:01 Asia/Taipei

---

## 📅 Log: 2026-09-11 16:40:36 Asia/Taipei (Task 158 #12 + watch header, 0.9.48)

- **What**: The user asked to tidy the mobile buttons with desktop untouched. 交易紀錄: at ≤720 px the four tools (分割換算 / 重算手續費 / 匯入 CSV / 匯出 CSV) moved into a 「工具」 button that opens a bottom sheet 「交易工具」; search and 工具 share one row. 觀察股票 header: one row, icon-only 圖卡/條列 toggle, 「＋ 加入」.
- **How**: CSS decides visibility (`.tx-tool` hidden and `.tx-tools-trigger` shown at ≤720 px); the sheet reuses `Modal` and is pinned to the bottom with `:has(.tx-tools-sheet)`; the add button renders two spans (`.watch-add-full` / `.watch-add-short`).
- **Caught in measurement**: the first build widened the desktop 「加入觀察」 by 8 px (an extra flex gap) and wrapped 工具 below the search box at 375 px (search basis 100%). Both fixed; desktop now matches the before-measurement exactly at 1440 px.
- **Verification**: `TransactionsPage.tools` (2 tests) red first, then green. 118 test files / 1,866 tests, exit 0; `npm run build` and `npm run typecheck:edge` exit 0. At 375 px: search 211×44 and 工具 89×44 on one row; watch header on one row (toggles 44×44, add 80×44); the sheet is full width at the bottom with 48 px items. A first full-suite run from the repo root reported 48 errors because npm could not find package.json; the rerun from `sources/` is the valid one.
- **Open**: the 交易紀錄 empty-state copy still refers to 「右下角『新增交易』」 and 「匯入 CSV」 (Task 158 item 19).
- **Release**: 0.9.48 merged to `main` and synced to `dev`. Frontend not uploaded.

## 📅 Log: 2026-09-11 16:12:57 Asia/Taipei (Task 159 D9 reverted, 0.9.47)

- **What**: User decision: desktop returns to the bottom-right floating 「新增交易」 button (icon + text); mobile keeps the 56×56 icon button; the admin view shows none. The 0.9.45 header button (`.header-add`) was removed.
- **Finding**: `main.container` already had `padding-bottom: 96px` above 720 px, so the page end was never covered on desktop. The remaining cost of the floating button is mid-scroll overlap of the rightmost column, which the user accepted.
- **Verification**: `AppShell.a11y` test updated first (red while the header button existed), then green. 117 test files / 1,864 tests, exit 0; `npm run build` and `npm run typecheck:edge` exit 0. Playwright: at 1440 and 1024 the button is 124×48 with its label, exactly one add button, 109 px clearance at the page end; at 375 it is 56×56 with the label hidden.
- **Release**: 0.9.47 merged to `main` and synced to `dev`. Frontend not uploaded.

