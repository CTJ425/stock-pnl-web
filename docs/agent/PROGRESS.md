# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.29 正式版發布 — 觀察股票同產業自動群組聚合、緊湊型小卡、MIS 即時產業別與收盤無成交價格修復 (BUG-045, BUG-046)
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-03 20:00:00 Asia/Taipei

---

## 📅 Log: 2026-09-03 20:00:00 Asia/Taipei (0.9.29 正式版發布 — 部署 Edge Function 至 PROD、全庫資安查驗與分支合併發布)

- **Status**: ✅ **COMPLETED** (ready to merge `dev` into `main`)
- **Version**: `0.9.29-dev.3` → **`0.9.29`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 發布 0.9.29 正式版本並部署至 Supabase PROD 正式區。
- **Work & Security (CIA)**:
  1. **機密性 (Confidentiality) ── 零憑證外洩防護**:
     - 全庫 git diff 與 commit 歷程全面掃描，確認零敏感資訊（無使用者 access token `sbp_...`、無 service_role 金鑰、無 `CRON_SECRET` 明文）。
     - 本專案 GitHub PUBLIC 公開倉庫安全防護通過。
  2. **完整性 (Integrity) ── 代碼質量與型別防護**:
     - `npm test`：97 檔測試檔、**1599** 個單元測試全數 PASS（0 失敗）。
     - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
     - `npm run build`：生產環境建置成功 exit 0。
     - `npx oxlint src`：0 error。
     - Edge Function `stock-price` 維持 `verify_jwt: true` 預設權限保護。
  3. **可用性 (Availability) ── 正式環境部署與端點實測**:
     - 成功部署 `stock-price` 至 PROD 正式區 (`hrilemueiqyaoiwnkeuu`)。
     - 稽核雙環境一致性：PROD 與 DEV 之 `stock-price` 版本皆為 v3，`ezbr_sha256` 雜湊值皆為 `3ef2700b97ccad33d712c6359d1056a2c0a9fbc08a5ceb6a1b25a402b64c1621`，完全一致。
     - 正式區端點實測：向 PROD `stock-price` 發送台股即時報價請求（2330 台積電、2603 長榮），正確回傳即時行情與 `industry`（半導體業、航運業）；未攜帶 JWT 時精確回傳 401 Unauthorized。
  4. **版本同步與發布流程**:
     - 同步版本號至 0.9.29，整合 CHANGELOG 0.9.29 正式紀錄，歸檔 PROGRESS.md 歷史項目至 PROGRESS_ARCHIVE.md。

---

## 📅 Log: 2026-09-03 19:15:00 Asia/Taipei (0.9.29-dev.3 — 觀察股票同產業自動群組聚合、膠囊篩選與分析頁選單分組)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.29-dev.2` → **`0.9.29-dev.3`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者需求「讓相同產業的股票變成一個group，例如一開始只有長榮，但後來又觀察陽明這時候會自行形成一個group，方便使用者依照產業別選擇個股資訊」。
- **Work**:
  1. **核心自動分組邏輯 (`stockGrouping.ts`)**:
     - `groupWatchItems`：依據 `getStockCategory` 解析出的官方/推導產業別進行計數；當同產業標的數 $\ge 2$ 時，自動聚合成獨立產業族群（如「航運業 (2)」）；單一標的、未分類者以及官方「其他」類別個股自然歸入「其他」，徹底杜絕「其他業 (2)」與「其他 (1)」雙重重複分組。若無任何族群 $\ge 2$，不觸發分組。
     - `getGroupCategoryName`：建立 `CANONICAL_INDUSTRY_MAP`，完整涵蓋 33 大官方產業標準與常見異構別名（電腦週邊／電腦及週邊設備業、化學／化學工業、建材營造、觀光餐旅等），保證報價載入前後產業名稱完全一致，防止族群分裂。ETF/ETN/特別股等資產類型保留原有名稱。
  2. **庫存總覽分組檢視與快速篩選膠囊 (`WatchSection.tsx`, `index.css`)**:
     - 膠囊列（Filter Chips）：當存在 $\ge 2$ 群組時，在頂部動態渲染「全部 (N)」、「產業 (M)」、「其他 (K)」切換按鈕，點選後即時過濾卡片/表格列。
     - 圖卡模式：依群組顯示分組標題與計數標籤（`watchlist-group-title`）。
     - 條列模式：以分組標題列（`watchlist-group-row`）清晰劃分各產業。
     - 狀態持久與自適應解構：切換圖卡/條列模式保留當前篩選狀態；標的移除致產業數量 $< 2$ 時自動解構回復扁平檢視。
     - 篩選崩潰防護：在「其他」篩選狀態下若刪除最後一檔其他標的，`activeFilter` 安全退階為「全部 (N)」並自動同步重設 `filter` state，徹底消除畫面全空之 Fatal Bug。
  3. **個股分析頂部切換選單產業分組 (`AnalysisPage.tsx`)**:
     - 頂部「切換個股」下拉選單（`HeaderMenu`）中的觀察股票區塊，依據相同產業自動分組顯示（如「觀察 ── 航運業」、「觀察 ── 電腦及週邊設備業」、「觀察 ── 其他」），且不同標的切換時群組穩定不跳躍。
  4. **單元測試 (`stockGrouping.test.ts`, `WatchSection.test.tsx`, `AnalysisPage.test.tsx`)**:
     - `stockGrouping.test.ts`：13 個測試覆蓋空清單、單一股票不分組、多檔不同產業不分組、$\ge 2$ 檔自動聚合、多產業與其他群組、即時報價產業別支援、規範化別名對齊、官方「其他」類別防護、30 檔混合多元資產邊界。
     - `WatchSection.test.tsx`：新增 7 個測試覆蓋單一股票不觸發分組、2 檔同產業聚合與膠囊、多產業篩選切換、條列模式分組列與模式切換保留狀態、刪除股票後自動解構、刪除最後一檔其他標的退階防護、跨資料來源電腦週邊聚合。
     - `AnalysisPage.test.tsx`：新增 5 個測試覆蓋單一股票維持「觀察」標題、$\ge 2$ 檔聚合為「觀察 ── 產業名」、多產業聚合與其他分組、分組選單切換個股、異構報價電腦週邊選單聚合。
- **Verify**:
  - `npm test`：97 檔測試檔、**1599** 個測試全數 PASS（0 失敗）。
  - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
  - `npm run build`：tsc -b && vite build exit 0。
  - `npx oxlint src`：0 errors。