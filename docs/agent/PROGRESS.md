# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 0.9.30-dev.1 — 觀察股票圖卡迷你緊湊化微調
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-03 22:06:00 Asia/Taipei

---

## 📅 Log: 2026-09-03 22:06:00 Asia/Taipei (0.9.30-dev.1 — 觀察股票圖卡迷你緊湊化微調)

- **Status**: ✅ **COMPLETED** on `dev`
- **Version**: `0.9.29` → **`0.9.30-dev.1`** (`version.ts`、`package.json`、`package-lock.json`、`README.md`、`CHANGELOG.md` 已同步)
- **緣由**: 使用者回饋希望將觀察股票卡片「再縮小一點」，先修改一版檢視。
- **Work**:
  1. **網格與卡片尺寸迷你化 (`index.css`)**:
     - `.watchlist-card-grid`: 欄寬改為 `minmax(136px, 1fr)`（下調約 17.5%），間距縮小為 8px。
     - `.watchlist-card`: 高度由 72px 壓至 58px（減少約 20% 高度），內距微調為 `7px 8px`，圓角微調為 6px。
  2. **字級與間距微調**:
     - 現價（`.watchlist-card-price`）：調整為 15px，line-height 1.15。
     - 漲跌幅（`.watchlist-card-change`）：調整為 11px。
     - 代碼與股名（`.watchlist-card-ticker`, `.watchlist-card-name`）：微調為 11.5px。
     - 產業徽章（`.watchlist-card-badge`）：調整為 9px，最大寬度 48px。
     - 刪除按鈕（`.watchlist-card-del`）：縮小至 16x16px。
- **Verify**:
  - `npm test`：97 檔測試檔全數 PASS。
  - `npm run typecheck:edge`：tsc -p tsconfig.edge.json exit 0。
  - `npm run build`：tsc -b && vite build exit 0。
  - `npx oxlint src`：0 errors。

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