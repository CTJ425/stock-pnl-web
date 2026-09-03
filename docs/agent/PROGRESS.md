# Progress Log (PROGRESS.md)

- Agent: Claude Opus 5 (main session)
- Action: 0.9.28 — 正式發版並上線 PROD
- Status: **✅ RECORDED**
- Timestamp: 2026-09-03 15:59:47 Asia/Taipei

---

## 📅 Log: 2026-09-03 15:59:47 Asia/Taipei (0.9.28 — 正式發版並上線 PROD)

- **Status**: ✅ **RELEASED** — `main` 與 `dev` 皆為 `a1a26da`，已推送
- **Version**: `0.9.28-dev.10` → **`0.9.28`**（去掉 `-dev`，四處檔案同步；CHANGELOG 的十個 `dev.N` 段落收斂成單一 `0.9.28` 段落，比照 `0.9.27` 的既有慣例）
- **緣由**: 使用者授權合併到 `main` 並正式上線。
- **上線順序刻意如此，不可對調**: 先資料庫、再前端、最後 Edge。`dataProvider.ts` 遇到 `42703` / `PGRST204` 會去掉欄位重試，所以缺欄位不會讓 PROD 掛掉——但融券賣出會**靜默**失去 `tx_nature`、被記成普通賣出，損益算錯且沒有任何錯誤訊息。若前端先上，就會開一段無聲錯帳的空窗。
- **Work**:
  1. **PROD 資料庫遷移**（`hrilemueiqyaoiwnkeuu`）: `transactions.tx_nature`（CHECK 含 `SHORT`）、`transactions.fee_rate`、`workspaces.fee_rate`。DDL 逐字取自 `schema.sql`，包在帶專案身分守衛的 `DO` 區塊裡，隨後 `NOTIFY pgrst, 'reload schema'`。全文留存於 `docs/agent/prod-0.9.28-migration.sql`。
  2. **合併**: `main` 快轉到 `dev`（`origin/main` 是 `dev` 的祖先，無分歧），推送 `main` 與 `dev`，兩分支同版。
  3. **PROD Edge**: `stock-report` v3 → **v4**，帶 `--no-verify-jwt`，以 `--project-ref` 部署，未動 `supabase link` 全域狀態。
- **Verify — 每一項都查結果，不採信「指令成功」**:
  - **資料庫**: 三個欄位皆存在且可為 NULL；CHECK 含 `SHORT`；`count(*), count(tx_nature), count(fee_rate)` 回傳 `110, 0, 0`——110 筆既有交易一筆未被改寫。
  - **Edge**: `ezbr_sha256` 由 `28350abe…c71cea4` 變為 `1d2ba453…266a794f23`，`verify_jwt` 維持 `false`。雜湊只證明 bundle 有變，故另抓線上 bundle 逐字確認：`netOpenTickers` 5 次、`v.net !== 0` 2 次、舊的 `v.net > 0` **0 次**。**新 sha 與 DEV 完全相同**，依 `supabase-ops` 的判準即證明兩區跑同一份 bundle。
  - **前端**: Playwright 載入 `https://stock-pnl-web.pages.dev/`——版號徽章 `0.9.28`、字族 `Inter`、`--thead-bg` 為 `#0f131914`（即新的 `rgba(15,19,25,0.08)`），**零 console error、零 4xx/5xx**。線上 bundle 含 `0.9.28` 且無 `0.9.27` 殘留。
  - **Release**: GitHub Actions `Sync GitHub Releases` 成功，Release `0.9.28` 已建立並標為 Latest。
  - 發版前 gate：`npm run build` exit 0、`npm run typecheck:edge` exit 0、`npx vitest run` exit 0（95 檔 1537 測試）、`npx oxlint src` 0 error。
- **一次被權限守門擋下的嘗試**: 第一次對 PROD 資料庫的寫入被 Claude Code auto mode classifier 擋下。**沒有嘗試繞過**；改為向使用者說明並提供可自行執行的 SQL 檔，待使用者明確再次授權後才重試成功。
- **連帶關閉**: Task 141（PROD CHECK 約束）、BUG-041、BUG-044-P。
- **未做**: 融券流程的端到端 Playwright 驗證仍未執行。`transactions.user_id` 為 `NOT NULL` 但 TypeScript `Transaction` 型別未宣告，本次未動。`.inst-matrix tfoot td` 底色寫死為白色疊加、亮色主題方向相反，既有缺陷未修。

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