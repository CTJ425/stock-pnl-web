# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.30-dev.3 — 未實現損益金額同步雙行直顯券商 APP 牌告口徑
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-03 23:13:00 Asia/Taipei

---

## 📅 Log: 2026-09-03 23:13:00 Asia/Taipei (0.9.30-dev.3 — 未實現損益金額同步雙行直顯券商 APP 牌告口徑)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.30-dev.2` → **`0.9.30-dev.3`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者回饋聯電持股損益 APP 顯示 -10,610 元但網頁端顯示 -10,485 元，差額精準為 125 元（即現價 125 元下牌告手續費 178 元 vs 3 折 53 元之差額）。將「未實現損益」金額同步升級為雙行直顯，直接標記券商 APP 牌告損益。
- **Work**:
  1. **核心計算 (`holdingRows.ts`)**:
     - `HoldingRow` 擴充 `brokerUnrealized: number | null` 欄位，將標準牌告預扣損益 `standardUnrealized` 帶出。
  2. **UI 雙行直顯 (`DashboardPage.tsx`, `QuoteTab.tsx`, `reportProxy.ts`, `AnalysisPage.tsx`)**:
     - 庫存總覽「未實現損益」欄位：主標（粗體）顯示實質淨損益（`-NT$10,485`），副標（11px 灰字）直顯 `券商 -NT$10,610`。
     - 個股分析持股概況（`QuoteTab.tsx`）同步在未實現損益後方標註 `(券商 -NT$XX)`。
  3. **測試**:
     - `holdingRows.test.ts`：實測驗證聯電 2303 損益差額精確為 125 元。
     - `DashboardPage.test.tsx`：驗證折讓時儲存格直顯 `券商 -NT$11,111` 與 `券商 -8.20%`。
- **Verify**:
  - `npm test`：97 檔測試檔全數 PASS。
  - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
  - `npm run build`：tsc -b && vite build exit 0。
  - `npx oxlint src`：0 errors。

---

## 📅 Log: 2026-09-03 22:55:00 Asia/Taipei (0.9.30-dev.2 — 未實現報酬率雙行直顯券商 APP 牌告口徑)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.30-dev.1` → **`0.9.30-dev.2`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者回饋「聯電 app 是 -7.86% 但專案是 -7.76%」，確認為券商「月退制」未折讓預扣與專案實質折讓扣除產生的 0.10% 差額。依使用者指示實施方案 1：直接雙行呈現，免滑鼠懸停一眼對帳。
- **Work**:
  1. **核心計算 (`holdingRows.ts`, `pnlEngine.ts`)**:
     - `HoldingRow` 擴充 `brokerRoi: number | null` 欄位。
     - `estimateUnrealized` 支援 `overrideFeeRate?: boolean`，當計算券商口徑時，全批次強制套用台灣法定牌告未折讓費率（0.1425%），算出 1:1 吻合券商 APP 月退制的報酬率（`brokerRoi`）。
     - 同步支援多頭（LONG）與空單（SHORT）。
  2. **UI 雙行直顯 (`DashboardPage.tsx`, `QuoteTab.tsx`)**:
     - 庫存總覽「未實現報酬率」欄位：主標（粗體）顯示實質淨報酬率（`-7.76%`），副標（11px 灰字）直顯 `券商 -7.86%`，免滑鼠懸停一眼核對。
     - 自適應防呆：當無折讓或兩者四捨五入後相同時，副標自動隱藏。
     - 個股分析持股概況（`QuoteTab.tsx`）同步在報酬率旁顯示 `(券商 XX%)`。
  3. **測試與型別**:
     - `holdingRows.test.ts`：驗證折讓下 `brokerRoi` 比 `roi` 低約 0.10% 之券商口徑。
     - `DashboardPage.test.tsx`：驗證折讓時儲存格直顯「券商」標記。
- **Verify**:
  - `npm test`：97 檔測試檔全數 PASS。
  - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
  - `npm run build`：tsc -b && vite build exit 0。
  - `npx oxlint src`：0 errors。