# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 修復資料表漲跌紅綠與未實現損益顏色覆蓋問題（Task 150, 0.9.38）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-09 18:00:00 Asia/Taipei

---

## 📅 Log: 2026-09-09 18:00:00 Asia/Taipei (Task 150, 0.9.38)

**修復 0.9.37 引入之 Carbon 資料表四階對比造成 .pnl-up / .pnl-down 顏色覆蓋問題**

- **根因**: 0.9.37 於 `sources/src/index.css` 引入之 `.data-table td`（指定 `$text-secondary`）、`.data-table td.num > div:first-child`（指定 `$text-primary`）以及 `.data-table tbody tr:hover td`（指定 `$text-primary`）因 CSS 權重高於全域 `.pnl-up` / `.pnl-down`，導致資料表儲存格的現價漲跌、保本賣出價、未實現損益與未實現報酬率失去紅綠顏色，並在 hover 時被強制覆蓋為文字主色。
- **修復方案**:
  1. 於 `sources/src/index.css` 在 `tr:hover` 規則後補齊 `.data-table` 專屬之損益樣式規則：涵蓋 `.data-table .pnl-up/down/flat`、`td.pnl-*`、`td.num.pnl-*`、主數值 `> div:first-child` 以及滑鼠懸停 `tbody tr:hover` 狀態。
  2. 數值儲存格副標籤（如「未含費 …」、「券商 …」）因匹配 `:not(:first-child)` 與 inline 樣式，精準維持次要／輔助文字階層，不受紅綠主色干擾。
- **驗證**:
  - `DashboardPage.test.tsx` 新增持股列表獲利／虧損之數值儲存格 class 斷言（現價、保本價、未實現淨損益、報酬率）。
  - 新增 `sources/src/styles/tablePnlStyles.test.ts` 驗證 CSS 規則包含狀態與串接順序。
  - `npm test` exit 0（108 測試檔 / 1759 測試全數通過）。
  - `npm run build` exit 0。
  - `npm run typecheck:edge` exit 0。
- **版本更新**: 同步 5 檔案升版至 0.9.38，依使用者指示合併至 main。

---

## 📅 Log: 2026-09-09 15:15:32 Asia/Taipei (Task 149, 0.9.37)

針對 feat/carbon-design 分支做完整 UI/UX 稽核，21 項發現全數處理完畢。發布 0.9.37。

Gate：`npm run build` exit 0、`npm run typecheck:edge` exit 0、完整測試 107 檔 / 1757 測試 / exit 0（基準 103 / 1732）。42 個檔案異動，8 個新檔。

最重要的一項是根因修正：`downloadReportsJson` 過去把所有失敗吞成 `null`，與「報告還沒產生」同值，所以總經與後台五個畫面的錯誤狀態永遠觸發不到。現在 404 才回 `null`，網路失敗、5xx、JSON 解析失敗一律拋出。連帶補上兩個沒有 catch 的呼叫端，其中 `FxPage.load` 的 `setLoading(false)` 在 await 之後，網路失敗會讓頁面永遠轉圈——這個是 review 抓到的，第一次 scout 的範圍沒涵蓋到。

有兩項稽核發現在實作時查證為錯誤並撤回：A3「焦點不可見」是錯的，`index.css` 本來就有通用 `:focus-visible` 規則；B5 要求在兩個批次改寫 Modal 加確認閘門，但它們的按鈕本來就標明筆數，等於重複詢問。B6 的斷點 token 化在純 CSS 無法實作，改為慣例註解。

詳細條列見 `docs/agent/TASK_ARCHIVE.md` 的 Task 149。
