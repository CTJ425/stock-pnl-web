# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 0.9.66 — Task 166 稽核修補第 4 批（前端體驗與無障礙）
- Status: ✅ **0.9.66 on `dev` and `main`**；DEV／PROD 皆已套用 `admin_recent_app_logs` DDL 並重新部署三個 Edge Function
- Timestamp: 2026-09-23 09:49:00 Asia/Taipei

---

## 📅 Log: 2026-09-23 10:40:00 Asia/Taipei (BUG-085, 0.9.67)
- Fixed BUG-085: watchlist industry group flipped between 半導體業 and 其他 for 8150 (南茂), because `price_cache` did not store `industry`. See `FIXED_BUG.md` BUG-085 and `docs/agent/specs/BUG-085.md`.
- Released 0.9.67: `main` and `dev` both at 8ee2065. DEV and PROD: DDL applied, `stock-price` redeployed and verified.

---

## 📅 Log: 2026-09-23 09:49:00 Asia/Taipei (Task 166 batch 4, 0.9.66)

**稽核修補第 4 批：前端體驗與無障礙。** 前一段工作已完成殼層、交易、報價管線、管理後台、維運等項目但未提交；本輪以兩個 scout 逐條比對規格，補完剩餘項目後一次提交。

- 本輪補完（四個 builder 平行）：總經 proxy 回傳 `ProxyResult`（ok／empty／invalid）與「資料格式不符」文案（MA-06）；匯率過期改算台北交易日，超過 2 個才警示（MA-10）；`reportPdf.ts` → `downloadBlob.ts`（MA-12）；日誌游標改為 (at, id)，`admin_recent_app_logs` 新增 `p_before_id`（AD-07）；個股頁漲跌停徽章與參考線（新 `priceLimits`）、快取時間、代號不符不渲染、單點畫點、美股量以股計、`dl` 統計格、試算逐欄驗證、價格階梯註明；圖表靜態層 memo 與 `thinLabelStep` X 軸抽稀；基本面最近 9 季滾動視窗、TTM「資料不足 (n/4)」、籌碼空狀態分流、三大法人合計交叉檢查、`fmtUpdatedAt` 固定 Asia/Taipei。
- 主 session 寫的測試：`isStale` 交易日 4 例、MA-06 invalid 狀態 2 例、AD-07 游標 1 例、`thinLabelStep` 3 例、`priceLimits` 6 例；修正 TwMarketSection 兩個漏改的 mock。
- 決策：季報表視窗取 9 季（與舊 2024-Q1 截點在畫面上的季數相同，不突然變寬）。
- Reviewer：PASS；1 項 RISK（RISK-021，dailyProxy／intradayProxy 快取不隨帳號切換清空，資料為公開市場資料）。
- **Verify**：`npx vitest run` 2,613 通過／7 略過／0 失敗；`npm run build`、`npm run typecheck:edge` exit 0。DEV 實測 (at, id) 翻頁：兩頁各 5 筆、重疊 0、遺漏 0。
- **Deploy**：DEV 與 PROD 皆套用 DDL（識別條件檢查通過），部署 `stock-report`（DEV v27／PROD v16）、`stock-price`、`backup-transactions`；兩區 bundle sha 相同（stock-report `3b36b3234516`），未授權呼叫回 401。
