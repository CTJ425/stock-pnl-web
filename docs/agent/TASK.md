# Task Backlog & Tracking (TASK.md)

- Agent: Claude
- Status: ACTIVE
- Timestamp: 2026-07-21 09:52:39 Asia/Taipei

---

## 📋 Active Tasks

### Task 6: 歷史累計手續費拆分 (v0.2.7)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 14:05:00 Asia/Taipei
- **Target Version**: v0.2.7

#### Objective
將年度收益頁面的歷史累計手續費 KPI，透過稅率預估反推，拆分為「手續費」與「交易稅」。

#### Scope / Allowed Changes
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/package.json`
- `sources/src/App.tsx`

### Task 1: 專案目錄結構與 GEMINI.md 記憶體調整
- **Status**: DONE
- **Allowed Changes**: `docs/`
- **Verification**: `docs/agent/` 目錄建立且包含完整紀錄檔，`docs/architecture/` 與 `docs/database/` 文件歸位。

### Task 2: GitHub Pages CI/CD 自動化建置
- **Status**: TODO
- **Allowed Changes**: `.github/workflows/`
- **Acceptance Criteria**: Commit 至 `main` 自動 trigger build 並產出靜態網站至 GitHub Pages。

### Task 3: Supabase 後端上線與 Edge Function 部署
- **Status**: TODO
- **Allowed Changes**: `sources/supabase/`
- **Acceptance Criteria**: 提供標準指令說明或輔助執行 Supabase 部署與 `.env.local` 綁定。

### Task 5: 年度收益頁面改版與明細展開 (v0.2.6)
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: agy (delegated)
- **Timestamp**: 2026-07-21 12:03:00 Asia/Taipei
- **Target Version**: v0.2.6

#### Objective
移除年度收益頁面的排序功能，加入第三層的逐筆賣出明細（移動平均成本口徑），並在 KPI 區塊顯示買/賣筆數拆分。

#### Scope / Allowed Changes
- `sources/src/components/YearlyReport/YearlyPage.tsx`
- `sources/src/components/Dashboard/DashboardPage.tsx`
- `sources/src/components/Common/HelpTh.tsx`
- `sources/src/utils/pnlEngine.ts`
- `sources/src/utils/pnlEngine.test.ts`
- `sources/src/index.css`
- `sources/package.json`
- `docs/agent/SPEC.md`, `docs/agent/PROGRESS.md`, `docs/agent/TASK.md`

### Task 4: 交易紀錄搜尋欄位（代號 / 名稱快速過濾）
- **Status**: DONE
- **Planner**: Claude
- **Implementer**: Gemini
- **Timestamp**: 2026-07-21 09:58:00 Asia/Taipei
- **Target Version**: v0.2.5

#### Objective

在「交易紀錄」頁工具列新增搜尋輸入框，輸入代號或名稱關鍵字即時過濾交易列表，
快速找到特定股票的交易資訊。

#### Scope / Allowed Changes

- `sources/src/components/Transactions/TransactionsPage.tsx` — 加入搜尋輸入框與過濾接線
- `sources/src/components/Transactions/txSearch.ts` — **新檔**：純函式過濾邏輯（可獨立單元測試）
- `sources/src/components/Transactions/txSearch.test.ts` — **新檔**：單元測試
- `sources/src/App.smoke.test.tsx` — 新增 UI 整合測試（或另建 `TransactionsPage.test.tsx`）
- `sources/src/index.css` — 若需要搜尋框樣式（沿用既有 `.btn` / toolbar 風格，盡量少改）
- `sources/package.json` — 版本號 bump 至 `0.2.5`
- **不得修改**：`dataProvider.ts`、`WorkspaceContext.tsx`、資料模型、Supabase 相關檔案；不得新增依賴套件

#### Functional Spec

1. **搜尋框位置**：工具列（`.section.toolbar`）內、「刪除選取」之後、`.spacer` 之前，
   placeholder：`搜尋代號或名稱`，附清除按鈕（X），輸入框需有 `aria-label="搜尋交易"`。
2. **比對規則**（純前端、即時過濾，不需 debounce——資料在記憶體中）：
   - 關鍵字先 `trim()`；空字串 = 不過濾（顯示全部）。
   - 代號：不分大小寫的**子字串**比對（`"233"` 命中 `2330`、`"aapl"` 命中 `AAPL`）。
   - 名稱：子字串比對，需同時比對**原始 `tx.name`** 與 **`displayStockName(market, ticker, name)`**
     ——美股顯示層是中文譯名（如 AAPL → 蘋果），使用者搜「蘋果」或「Apple」都要命中。
   - 單一關鍵字命中代號**或**名稱任一即顯示該列。
3. **過濾時機**：在既有 `sorted` useMemo 之前先過濾（filter → sort），排序功能照常作用於過濾後結果。
4. **筆數提示**：過濾中時顯示「顯示 X / Y 筆」（Y = 全部交易數）。
5. **與勾選 / 批次刪除的互動**：
   - 過濾改變時**保留**既有勾選狀態（不清空）。
   - 「全選」只作用於目前可見（過濾後）的列——既有 `toggleAll` 以 `sorted` 為準，行為天然正確。
   - 「刪除選取（n）」的 **n 與實際刪除範圍 = 勾選且目前可見**的交易
     （既有 `handleDeleteSelected` 已是 `sorted.filter(selected)`，但按鈕顯示的
     `selected.size` 需改為可見勾選數，避免數字與實際刪除筆數不一致）。
6. **無結果狀態**：有交易但搜尋無命中時，顯示「找不到符合「{關鍵字}」的交易」＋清除搜尋按鈕；
   與「尚無交易紀錄」空狀態區分，工具列維持顯示。
7. **CSV 匯出不受過濾影響**：維持匯出全部交易（既有行為，需在 code review 確認未被改動）。
8. **切換工作區時清空搜尋字串**（比照勾選清空的既有 useEffect）。

#### Non-Goals

- 不做多關鍵字 / 進階語法（AND、市場篩選、日期區間）。
- 不做遠端搜尋（`stockSearch.ts` 是新增交易用的股票查詢，與本功能無關，勿混用）。
- Dashboard / 年度收益頁不加搜尋（未來另開任務）。

#### Test Items（驗收必備）

**單元測試 `txSearch.test.ts`（純函式 `filterTransactions(txs, query)`）**

| # | 案例 | 預期 |
| - | ---- | ---- |
| U1 | 空字串 / 全空白關鍵字 | 回傳全部交易 |
| U2 | 代號部分比對 `"233"` | 命中 `2330` |
| U3 | 代號不分大小寫 `"aapl"` | 命中 `AAPL` |
| U4 | 名稱子字串 `"台積"` | 命中名稱「台積電」 |
| U5 | 美股中文譯名 `"蘋果"`（tx.name 為 `Apple Inc.`） | 透過 displayStockName 命中 AAPL |
| U6 | 美股原始名稱 `"apple"`（不分大小寫） | 命中 tx.name `Apple Inc.` |
| U7 | 無任何命中 `"9999"` | 回傳空陣列 |
| U8 | 關鍵字前後空白 `"  2330  "` | 與 `"2330"` 結果相同 |

**UI 整合測試（jsdom + testing-library，比照 App.smoke.test.tsx 的本機模式流程）**

| # | 案例 | 預期 |
| - | ---- | ---- |
| I1 | 建立 2330 台積電與 AAPL 兩筆交易後輸入「台積」 | 表格只剩台積電列，顯示「顯示 1 / 2 筆」 |
| I2 | 點清除按鈕 | 恢復顯示全部列，筆數提示消失 |
| I3 | 輸入無命中關鍵字 | 顯示「找不到符合…」訊息，且**不是**「尚無交易紀錄」空狀態 |
| I4 | 過濾中點「全選」 | 只勾選可見列；清除搜尋後另一筆未被勾選 |
| I5 | 勾選 2 筆後過濾到只剩 1 筆可見，點「刪除選取」 | 按鈕顯示（1）、只刪除可見那筆，另一筆仍存在 |
| I6 | 過濾中點「代號」排序 | 排序作用於過濾後結果，不出錯 |
| I7 | 切換 / 新建工作區 | 搜尋框自動清空 |

**回歸驗證**

- `npm test`（既有 68 筆測試全數通過 + 新增測試）
- `npm run lint`、`npm run build` 無錯誤
- 以 `/verify` skill（Playwright 本機模式）人工走一次 I1–I3 流程

#### Acceptance Criteria

- [x] 上表 U1–U8、I1–I7 測試全部撰寫並通過
- [x] 既有測試無任何退步
- [x] 過濾邏輯集中於 `txSearch.ts` 純函式，UI 層只負責接線
- [x] 未修改 Scope 以外的檔案、未新增依賴
- [x] `package.json` 版本 bump 至 0.2.5，commit message 格式：`feat(transactions): add search filter (v0.2.5)`
