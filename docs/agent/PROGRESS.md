# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.29-dev.1 — 觀察股票緊湊型小卡與自適應產業分類標籤
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-03 16:58:30 Asia/Taipei

---

## 📅 Log: 2026-09-03 16:58:30 Asia/Taipei (0.9.29-dev.1 — 觀察股票緊湊型小卡與自適應產業分類標籤)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.28` → **`0.9.29-dev.1`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者要求依照建議的「方案 A（緊湊型小卡 Mini Card）」改版首頁庫存總覽觀察股票（WatchSection），並自適應判斷股票類型與官方 33 類產業分類，以微型徽章展示。
- **Work**:
  1. **Mini Card 緊湊型佈局（方案 A）** (`WatchSection.tsx`, `index.css`):
     - 卡片網格改為 `repeat(auto-fill, minmax(165px, 1fr))`，gap 10px。
     - 卡片內距優化為 `10px 10px`，最小高度降至 72px（垂直佔位大幅減少 35%~40%）。
     - 雙行佈局：
       - 第 1 行：股票代號（13px mono bold）、名稱（13px 保留 min-width: 2.2em 避免長字名被壓至 0px 隱形）、微型分類徽章（10px subtle badge，max-width: 64px 支援優雅省略，在條列檢視下不受限）、右上角緊湊型移除按鈕（20px）。
       - 第 2 行：現價（18px tabular nums, 保留紅綠漲跌色）與漲跌幅百分比（12px tabular nums, 保留紅綠色）。
     - 條列檢視（Table View）同步在名稱旁展示微型分類徽章。
  2. **台股類型與產業即時判定** (`src/utils/stockCategory.ts`):
     - 0ms 純函數即時推導，無任何外部網路開銷。
     - 規則式類型：`00...B` 債券 ETF、`00...L` 槓桿 ETF、`00...R` 反向 ETF、`00...` 股票型 ETF、`02...` ETN、`91...` TDR、`01...` REITs。
     - 特別股精準比對：嚴格限定 4 位數字代號加英文字母（如 `2881A`），徹底排除權證（如 `03001P`、`08321B`）之誤判。
     - 官方產業分類：擴充包含上櫃指標龍頭（3293 鈊象、5483 中美晶、3680 家登、6187 萬潤、3105 穩懋、3363 上詮等）之官方產業別，並納入 TPEx「文化創意」、「居家生活」類別。
     - 啟發式後備比對：支援遊戲/文創、生技/醫材/藥、能源/綠能、軟體/資訊等更完整的關鍵字後備推導。
  3. **單元測試** (`stockCategory.test.ts`, `WatchSection.test.tsx`):
     - `stockCategory.test.ts` 新增 17 個測試（包含權證排除、上櫃指標股、新產業別與擴充後備規則）。
     - `WatchSection.test.tsx` 擴增至 12 個測試（新增超長名稱與 TPEx 類別渲染測試）。
- **Verify**:
  - `npx vitest run src/utils/stockCategory.test.ts`: 17/17 tests passed.
  - `npx vitest run src/components/Dashboard/WatchSection.test.tsx`: 12/12 tests passed.
  - 全專案測試：`npm test` 96 檔測試檔、1556 個測試全數 PASS。
  - 編譯與型別：`npm run build`（`tsc -b && vite build`）exit 0。
  - 代碼檢查：`npx oxlint src` 0 error。

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