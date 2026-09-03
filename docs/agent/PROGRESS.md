# Progress Log (PROGRESS.md)

- Agent: Claude Opus 5 (main session)
- Action: 0.9.28-dev.5 — 修正市場抬頭（Task 143 續）：主數字、曝險尺與底部對齊未照設計實作
- Status: **✅ RECORDED**
- Timestamp: 2026-09-03 10:57:00 Asia/Taipei

---

## 📅 Log: 2026-09-03 10:57:00 Asia/Taipei (0.9.28-dev.5 — 修正市場抬頭 Task 143 續)

- **Status**: ✅ **COMPLETED** on `dev` (uncommitted)
- **Version**: `0.9.28-dev.4` → **`0.9.28-dev.5`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Spec**: `docs/agent/specs/task-143-cold-visual-pass.md`
- **緣由**: 使用者指出市場抬頭的「主數字 + 曝險尺」與核准的 artifact 差很多。逐項比對後屬實，共六處未實作。
- **一項必須更正的先前陳述**: 0.9.28-dev.4 的記錄寫「底部欄位用 `margin-top: auto` 推到底，兩塊面板永遠齊平」。**該句為誤。** `.market-panel .metric-row { margin-top: 12px }`（優先權 0,2,0）壓過 `.market-foot { margin-top: auto }`（0,1,0），auto 從未生效，兩塊面板底部並未齊平。
- **Work**:
  1. **主數字標籤移到抬頭列右端** (`DashboardPage.tsx`、`index.css`): 原本「淨額市值」自成一行並壓在分隔線下方；現與「台股 TWD」同一行、`margin-left: auto` 靠右。抬頭下方的 `border-bottom` 移除。
  2. **淨額帶正負號** (`DashboardPage.tsx`): 有空單時改用 `fmtSignedMoney`，因為多空相減可能為負；沒有空單時是持倉市值，維持不帶號。
  3. **底部欄位真的推到底** (`index.css`): `.market-foot` 提升為 `.market-panel .market-foot`（同優先權且在後），改滿版出血（左右 `-20px`）、上方分隔線、兩欄之間中線。
  4. **用語對齊設計** (`DashboardPage.tsx`): 曝險尺圖例與表格分組標題由「多方 / 空方」改為「多單 / 空單」。
  5. **面板內距** (`index.css`): `14px 16px 16px` → `15px 20px 0`。
- **驗證（用量測，不用目視）**: Playwright 讀 bounding box — 兩塊面板 `footBottom` 皆 **317px**（齊平）；持股表 `scrollWidth - clientWidth` = **0px**（不再溢出）；`tw-mktval` 文字為 `+NT$6,686,000`（帶號）；`.market-panel .panel-head .kpi-label` 存在（標籤在抬頭列）。`npm run build` exit 0；`npx vitest run` exit 0，95 檔 **1530** 測試，數量未下降。
- **教訓**: 上一輪用目視判讀截圖，把「看起來差不多」當成齊平。CSS 優先權對撞不會報錯，只會安靜地失效，必須量。

---

## 📅 Log: 2026-09-03 10:45:00 Asia/Taipei (0.9.28-dev.4 — 全站冷處理 Task 143)

- **Status**: ✅ **COMPLETED** on `dev` (uncommitted)
- **Version**: `0.9.28-dev.3` → **`0.9.28-dev.4`** (`version.ts`, `package.json`, `package-lock.json`, `README.md`, `CHANGELOG.md` synchronized)
- **Spec**: `docs/agent/specs/task-143-cold-visual-pass.md`（含 `## Revisions after the first render`）
- **Lane**: 2 (cross-module). scout → spec → builder → 主 session 補完與修正 → 截圖驗證 → scribe.
- **緣由**: Task 142 出貨了結構與顏色分工，但視覺處理被我排除在範圍外，所以畫面看起來仍是原本的毛玻璃。使用者指出這一點，這一版補上視覺處理。
- **Work**:
  1. **毛玻璃移除** (`index.css`): 所有 `backdrop-filter` 刪除；`--radius` 14px → 2px、`--radius-sm` 9px → 2px、`--shadow-card` → `none`。三個 token 覆蓋 100 多條規則。`border-radius: 50%` 與 `999px` 刻意保留。
  2. **紫藍換鋼藍** (`index.css`): `--accent` / `--accent-strong` / `--accent-2` 改鋼藍。`.kpi::before`、`.market-panel::before` 兩條漸層線刪除；`.tab.active` 改平面加 2px 底線；背景 radial 光暈設 `transparent`。
  3. **字體** (`index.html`、`index.css`): Google Fonts 連結換成 Archivo + IBM Plex Mono + Noto Sans TC。新增 `--font-num`，只套 `.data-table .num`、`.kpi-value`、`.kpi-sub`，內文不套。
  4. **表格加密** (`index.css`): 表頭 10.5px 全大寫，列高壓縮，分隔線 4.5%（新增 `--rule-hair`）。
- **Builder 撞 60 turn 上限**，停在 C5 之後。主 session 接手補完 `.market-panel` 的字體與主數字級數（30px），未重新派工。
- **首次算圖抓到四個缺陷，全部已修**（細節見 spec 的 Revisions 段）:
  1. `letter-spacing` 0.14em / 0.18em 是給拉丁標籤用的，套在中文上變成「交 易 日 期」。降到 0.02em / 0.06em。
  2. IBM Plex Mono 比 Inter 寬，台股十欄表被擠出容器，未實現報酬率看不到。關鍵修法是把儲存格內副行（未含費…、淨收…）改回比例字體 10.5px——那是文字不是需要對齊的欄。
  3. spec 的 C3 只點名三處 accent chrome，另有五處存活：`.btn-primary` 與其 `:hover`（即 新增交易 FAB 與 加入觀察）、`.fab` 的紫色光暈、頭像、`.adm-toggle.on`。全部改平面。
  4. `.data-table` 的 `th` 與 `td` 左右內距不一致（9px vs 14px），統一 10px。
- **驗證**: `npm run build` exit 0；`npx vitest run` exit 0，95 檔 **1530** 測試，數量未下降。深淺主題各截圖，庫存總覽與交易紀錄皆確認。
- **刻意改動**: `--up` / `--down` 各降一階（深色 `#ff5364` / `#21c88a`，淺色 `#bf2233` / `#0c6f4b`），與 artifact 一致。兩行獨立，可單獨還原。
- **未做**: 未移除 `HelpTh` 的說明圖示、未改任何 `.tsx`、未改任何類別名稱或使用者可見字串。

