# Progress Log (PROGRESS.md)

- Agent: Claude Opus 5 (main session)
- Action: 0.9.28-dev.10 — 表格底色分層
- Status: **✅ RECORDED**
- Timestamp: 2026-09-03 15:33:55 Asia/Taipei

---

## 📅 Log: 2026-09-03 15:33:55 Asia/Taipei (0.9.28-dev.10 — 表格底色分層)

- **Status**: ✅ **COMPLETED** on `dev` (committed, not pushed)
- **Version**: `0.9.28-dev.9` → **`0.9.28-dev.10`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者反映表格的標題列與資料列看起來顏色一樣，並指出可能是背景底色造成的。該判斷正確。
- **診斷方式：逐像素取樣，不是讀 CSS 推論**。以專案真正的 `index.css` 配上真正的 DOM 結構（`.glass.table-scroll → table.data-table`）渲染後截圖再讀像素。暗色主題三層底色為 頁面 `#090b0f` (L\* 3.00) → 卡片 `#0e1116` (L\* 4.99) → 標題列 `#15181d` (L\* 8.14)：**整段只跨越 5.14 個 L\***，標題與資料列之間僅 +3.15，落在人眼分辨門檻上。
- **兩項在提案階段就查出並更正的錯誤**:
  1. 第一版提案把亮色資料列寫成 `--panel` `#ffffff`。**錯了**——表格外層是 `.glass`，用的是 `--surface`，亮色為 `#fafbfc`。所有亮色數字重算。
  2. 使用者原本要的方向（標題變深、資料變淺）在暗色下會撞到頁面底：標題壓到 `#0a0c0f` 時離 `--bg` 只剩 0.27 L\*，卡片上緣會溶進頁面。改採反向分層（標題提亮、資料列不動），使用者確認採用。
- **Work** (`index.css`):
  1. `--thead-bg` 暗色 `0.03` → **`0.09`**（合成 `#24262b`）；亮色 `0.035` → **`0.08`**（合成 `#e7e8ea`）。資料列完全不動。
  2. `.data-table th` 文字由 `--ink-muted` 改 **`--ink-secondary`**。
  3. 新增 `--thead-solid`（不透明表頭色）與 `--row-band`（保留舊的表頭色調）。
  4. `.inst-matrix` 凍結首欄：原本表頭格與資料格共用 `var(--panel)`。改為表頭格用 `--thead-solid`、資料格用 `--surface`。
  5. `.holding-group td` 與 `.adm-prompt-locked` 原本借用 `--thead-bg`，改指向 `--row-band`，外觀維持不變。
  6. `.report-surface`（PDF 匯出面）補上兩個新變數，底色維持原樣。
- **一個必須靠順序解決的 CSS 陷阱**: `.inst-matrix th:first-child` 與合併規則 `.inst-matrix th:first-child, .inst-matrix td:first-child` **特異度相同**（0,2,1），先寫的會被後寫的蓋掉。首次寫入時把它放在合併規則之前，等於沒有生效；已移到合併規則之後並加註說明。
- **順手修掉的既有缺陷**: 亮色主題下 `.inst-matrix` 凍結首欄是 `--panel` `#ffffff`，但表頭是 `#f2f3f4`、資料列是 `#fafbfc`——首欄與上下兩者都對不上。現在兩者皆對齊。
- **Verify — 全部以像素實測，非計算推估**:
  - 暗色：標題列 `#23262b`，對資料列 ΔL\* **+10.06**（原 +3.15）。分組列 `#15181d`、資料列 `#0e1116` **未變動**，證實釘定有效。矩陣首欄表頭格對表格標題 ΔL\* +0.10、資料格對資料列 0.00。
  - 亮色：標題列 `#e7e8ea`，ΔL\* **−6.60**（原 −2.78）。矩陣首欄兩格皆對齊。
  - 表頭文字 WCAG：暗色 3.85 → **5.73**、亮色 3.03 → **6.47**、PDF 匯出 2.86 → **5.58**，三者皆由不合格轉為通過 AA 的 4.5:1。
  - `npm run build` exit 0；`npx vitest run` exit 0，95 檔 1537 測試；`npx oxlint src` 0 errors。
- **未改動，已知**: `.inst-matrix tfoot td` 的底色寫死為 `rgba(255, 255, 255, 0.035)`，是白色疊加，在亮色主題下方向相反。既有缺陷，不在本次核准範圍。

---

## 📅 Log: 2026-09-03 14:51:14 Asia/Taipei (0.9.28-dev.9 — 字級對齊正式區)

- **Status**: ✅ **COMPLETED** on `dev` (committed, not pushed)
- **Version**: `0.9.28-dev.8` → **`0.9.28-dev.9`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: dev.8 只對齊了字族（Outfit + Inter），使用者接著要求字級也與正式區一致。
- **先量再改**: 把 `main` 與 `dev` 的 `index.css` 各自解析成「選擇器 → font-size」對照表比對，並統計兩邊 `.tsx` 的內嵌 `fontSize`。結果比預期小得多：
  - `body` 基準字級兩邊都是 `14px`。
  - 內嵌 `fontSize` 幾乎相同（main 89 處 / dev 91 處，值分佈只差兩個 `fontSize: 11`）。
  - **共同選擇器中只有 4 條字級不同**，全部來自 0.9.28-dev.5「冷處理改版」與 dev.7。
  - 另有 7 條是 dev 新元件（`.exposure-key`、`.dir-long`、`.holding-group td` 等），正式區沒有對應規則，無法比對。
- **Work** (`index.css`，四條規則，使用者選定全部還原):
  1. `.section-title h2`：11px → **16px**
  2. `.section-title .hint`：11px → **12px**
  3. `.data-table th`：10.5px → **12px**
  4. `.market-panel .metric-hero .kpi-value`：30px → **22px**
- **一項查證後確認無需改動的地方**: `DashboardPage.tsx:553`／`561` 與 `YearlyPage.tsx:227` 的 `<h2 style={{ fontSize: 14 }}>` 會蓋過 `.section-title h2`。查 `main` 後確認這三處的內嵌值**與正式區完全相同**，本來就已對齊，因此不動。CSS 的 16px 只作用在沒有內嵌覆寫的區塊標題上。
- **Verify**:
  - 靜態：重跑同一份解析比對，共同選擇器字級差異由 4 條降為 **0 條**。
  - 動態：Playwright 以相同 viewport（1280×900）分別載入 `http://10.8.22.99:5173/` 與 `https://stock-pnl-web.pages.dev/`，統計所有可見文字節點的「字級|字重|字族」分佈，兩邊**完全相同**（20px/700/Outfit ×1、14px/400/Inter ×7、13px/400/Inter ×4、12.5px/500/Inter ×2、11px/400/Inter ×1 等）。
  - `npm run build` exit 0；`npx vitest run` exit 0，95 檔 1537 測試。
- **範圍限制（誠實記錄）**: 動態比對只涵蓋登入頁，因為量測沒有登入憑證。登入後的頁面靠上述靜態比對涵蓋，那份比對是整份 `index.css` 的全量對照，不是抽樣。