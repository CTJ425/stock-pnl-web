# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Release 0.9.30 (個股分析產業標籤清晰度優化、持股表格黃金比例與券商口徑對齊)
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-04 14:50:00 Asia/Taipei

---

## 📅 Log: 2026-09-04 14:50:00 Asia/Taipei (Release 0.9.30 正式版本發布與合併 main)

- **Status**: ✅ **COMPLETED** on `main` and `dev`
- **Version**: `0.9.30-dev.6` → **`0.9.30`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 5 檔嚴格同步)
- **緣由**: 使用者指示：「/goal 先把這個版本push到dev，然後合併到main，且確保資安與機敏資料都無外洩才准異動」。
- **資安與機敏資料審查 (Security & Secret Audit)**:
  - 嚴格比對 `origin/main..HEAD` 異動差異與工作區檔案，針對 `ghp_`、`eyJ`、`sbp_`、`service_role`、`token`、`secret` 等 pattern 進行全文掃描。
  - 確認除 E2E 測試用 mock token (`mock-access-token-e2e`) 與截圖 Base64 外，零真實憑證、密鑰或機敏資訊外洩。
  - GitHub Push Protection 驗證無任何阻擋。
- **Version 0.9.30 涵蓋重點 (Scope)**:
  1. **個股分析股票產業別顯示字級與清晰度優化 (`QuoteTab.tsx`, `index.css`)**:
     - 解耦 `.watchlist-card-badge`，產業徽章字級提升至 12.5px，色彩提升至最高對比 `var(--ink)`，消除截斷與模糊。
     - 標題列 `.detail-title .badge` 提升至 12px，下拉選單產業分類醒目加粗。
  2. **庫存總覽持股表格黃金比例字級與消除橫向捲軸 (`index.css`)**:
     - 13px/12px/11px 甜蜜點字級與緊湊 padding，在 1140px 容器下全 10 欄一眼綜覽，水平滾動徹底消除 (0px 溢出)。
  3. **庫存總覽持股表格分組列通欄純章節化 (`DashboardPage.tsx`)**:
     - 移除多空小計，標題橫跨全欄位 `colSpan={10}`，段落層次清晰。
  4. **未實現損益金額與報酬率雙行直顯券商 APP 牌告口徑 (`holdingRows.ts`, `DashboardPage.tsx`, `QuoteTab.tsx`)**:
     - 主標實質淨損益與報酬率，副標依 0.1425% 原價直顯券商數字，1:1 對齊手機 APP。
  5. **觀察股票小卡迷你極簡緊湊化 (`index.css`)**:
     - 網格縮窄至 136px，高度壓減 20%，大幅釋放儀表板空間。
  6. **DEV 實境全功能 E2E 整合測試 suite 與高質感報告 (`run-all-e2e.cjs`)**:
     - 7 大套件、16 項情境、35 個驗證步驟全數 PASS (100%)。
- **Verify**:
  - 單元測試：97 檔測試檔 / **1,603** 項單元測試全數 PASS。
  - 生產建置：`npm run build` (`tsc -b && vite build`) 產出 dist，exit 0。
  - Edge 型別檢查：`npm run typecheck:edge` exit 0。
  - 代碼風格檢查：`npx oxlint src` 0 errors。

---

## 📅 Log: 2026-09-04 14:38:00 Asia/Taipei (個股分析股票產業別顯示字級與清晰度優化)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.30-dev.5` → **`0.9.30-dev.6`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者指示：「在個股分析，股票的產業別有些顯示會太小與模糊，先改善這個問題」。
- **根本原因診斷 (First Principles Root Cause Analysis)**:
  1. 個股分析行情卡片 `QuoteTab.tsx` 原標籤帶有 `class="watchlist-card-badge quote-badge"`。
  2. 由於 CSS 順序與相同特異性 (0, 1, 0)，位在檔案後方的 `.watchlist-card-badge` 樣式覆蓋了前面定義的 `.quote-badge`。
  3. 導致其被強制套用 `font-size: 9px`、`max-width: 48px`、`overflow: hidden`、`padding: 0 3px`，以及暗淡灰色 `color: var(--ink-muted)`（在淺色主題對比度低至 2.8:1）。
  4. 8 字長產業別（如「電腦及週邊設備業」）被截斷為省略號，繁體中文字筆畫在 9px 低對比下嚴重模糊失真。
  5. 頂部標題列 `.detail-title .badge` 預設字級僅 11.5px 且顏色為次級墨色，在標題旁邊對比度亦不足。
- **Work**:
  1. **重構與解耦行情卡片產業徽章 (`QuoteTab.tsx`, `index.css`)**:
     - `QuoteTab.tsx` 移除 `watchlist-card-badge` 耦合，僅使用 `.quote-badge`。
     - `.quote-badge` 規格提升：字級提升至 **12.5px**（與旁邊 13px 代碼 `.code` 形成平衡），邊距 `2px 8px`，解除 `max-width: 48px` 限制，完整平整呈現長產業名。
     - 文字色彩提升為最高清晰度 `var(--ink)`（深色模式 `#dfe4ea` 對比度 >12:1，淺色模式 `#0f1319` 對比度 >16:1），邊框使用 `var(--border-strong)`，消除模糊毛邊。
     - 增加 `.m-sym .quote-badge` 雙重特異性守護與 `-webkit-font-smoothing: antialiased`、`letter-spacing: 0.02em`。
  2. **同步優化個股分析標題列產業標籤 (`index.css`)**:
     - 為 `.detail-title .badge` 建立專屬規則，字級提升至 **12px**，文字色彩改用 `var(--ink)`，邊框使用 `var(--border-strong)`，上下層次與行情卡片維持一致。
  3. **個股切換選單產業分組標題銳利化 (`index.css`)**:
     - `.hmenu-head` 由 `var(--ink-muted)` 調整為 `var(--ink-secondary)`，並設定 `font-weight: 600`，使下拉選單中「觀察 ── 電腦及週邊設備業」等分類醒目分明。
  4. **觀看清單小卡徽章基礎對比度修復 (`index.css`)**:
     - `.watchlist-card-badge` 色彩由 `--ink-muted` 提升至 `--ink-secondary`，寬度上限由 48px 增至 56px；條列表格徽章提升至 10.5px。
- **Verify**:
  - JSDOM 計算樣式檢測：`.quote-badge` fontSize: 12.5px, maxWidth: none, color: var(--ink), padding: 2px 8px；`.detail-title .badge` fontSize: 12px, color: var(--ink)。
  - Playwright 深淺雙色截圖實測驗證（`analysis-badge-dark.png` / `analysis-badge-light.png`）：廣達、台積電、元大台灣50 產業標籤清晰無截斷、筆畫分明。
  - 單元測試：97 檔測試檔 / **1,603** 項單元測試全數 PASS。
  - `npm run build`：`tsc -b && vite build` 順利產出 dist，exit 0。
  - `npm run typecheck:edge`：exit 0。
  - `npm run lint`：0 errors。

