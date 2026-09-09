# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: UI/UX 稽核 21 項全數處理（Task 149）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-09 15:15:32 Asia/Taipei

---

## 📅 Log: 2026-09-09 15:15:32 Asia/Taipei (Task 149, 0.9.36)

針對 feat/carbon-design 分支做完整 UI/UX 稽核，21 項發現全數處理完畢。版本未動（0.9.36），尚未 commit。

Gate：`npm run build` exit 0、`npm run typecheck:edge` exit 0、完整測試 107 檔 / 1757 測試 / exit 0（基準 103 / 1732）。42 個檔案異動，8 個新檔。

最重要的一項是根因修正：`downloadReportsJson` 過去把所有失敗吞成 `null`，與「報告還沒產生」同值，所以總經與後台五個畫面的錯誤狀態永遠觸發不到。現在 404 才回 `null`，網路失敗、5xx、JSON 解析失敗一律拋出。連帶補上兩個沒有 catch 的呼叫端，其中 `FxPage.load` 的 `setLoading(false)` 在 await 之後，網路失敗會讓頁面永遠轉圈——這個是 review 抓到的，第一次 scout 的範圍沒涵蓋到。

有兩項稽核發現在實作時查證為錯誤並撤回：A3「焦點不可見」是錯的，`index.css` 本來就有通用 `:focus-visible` 規則；B5 要求在兩個批次改寫 Modal 加確認閘門，但它們的按鈕本來就標明筆數，等於重複詢問。B6 的斷點 token 化在純 CSS 無法實作，改為慣例註解。

詳細條列見 `docs/agent/TASK_ARCHIVE.md` 的 Task 149。

---

## 📅 Log: 2026-09-09 10:07:59 Asia/Taipei (Task 148, 0.9.36, branch `feat/carbon-design`)

**Four refinement levers applied on top of the Carbon conversion, from a Diagram Design proposal.**

- **Approach**: A layer-stack diagram (`docs/design/carbon-layer-stack.html`) named the one thing that needed a picture — Carbon's surface hierarchy was collapsed into a single layer — and three levers that only needed a table. All four were then implemented.
- **Changed**: layer contexts so a field steps above its card or modal and a card inside a card steps up too; 20 font sizes collapsed to the 6 on the Carbon ramp; 216 spacing values snapped to the Carbon scale; page width 1180 → 1312; data-table rows at the Carbon md height of 40px; the workspace header action rebuilt as a 48px borderless UI Shell action.
- **Verified**: `npm run build` exit 0. `npm test` exit 0 — 103 files, 1732 tests passed. The transactions table was measured at 1440 and 1024 and overflows at neither width, which was the standing risk of raising every 11px and 13px value onto the ramp.
- **Follow-up, same branch**: the refinement pass left every table row on one tone. The data table now carries four separable surfaces (header, hover, zebra, base) and three text levels inside the cell, all from Carbon tokens. One collision was found and fixed by screenshot: the neutral 類型 chip shared its value with the new hover band and disappeared on the hovered row.
- **Follow-up, admin console**: the console's `.data-table` instances were already covered, but its execution log and probe round list are tables built from divs and never matched a table rule. Both now carry the same bands, row height and tag treatment. The search also turned up `var(--hairline, …)`, a fallback to a legacy slate literal that both earlier colour sweeps missed because the literal sits inside a `var()` fallback. The Diagram Design profile is now stored in the repo at `docs/design/diagram-design-carbon-profile.md`.
- **Follow-up, probe war room**: the eight state cards were identical because the two `::before` gradients that were supposed to mark state were dead CSS — no base rule ever gave the pseudo-element content or a box. State now rides on a 3px Carbon status rule on the leading edge, and the hue count went from four to two: green for retired, blue for probing. Tags, chips and dots follow the same two hues, the glow is gone, and the light-theme patch block for `.pwr-*` was deleted because every value is now a token.
- **Not done on purpose**: no version bump, no merge. `dev` and `main` are untouched.
