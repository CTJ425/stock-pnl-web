# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 清除 PDF 時代的死註解，並以實測更正 README 的部署敘述（0.9.53）
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-15 09:16:32 Asia/Taipei

---

## 📅 Log: 2026-09-15 09:16:32 Asia/Taipei (0.9.53, 死註解清理與部署敘述更正)

0.9.52 拔掉 PDF 產生器後，12 個檔案的註解仍在以「html2canvas 無法解析祖先層 CSS 變數」解釋圖表顏色為何寫死。該限制已不存在，註解改為陳述現況：一組字面值配色同時服務深淺兩個主題。顏色值一律未動。`StockDetailPage.tsx` 提到的 `surfaceRef` 早已不在程式中，只剩那句話。兩處刻意保留並標明為歷史記述 —— 刪掉會讓一個已做過的決定失去理由。

**更重要的是 README 被實測推翻。** 使用者問「CF page 不是會自己抓？」，查證結果是**會**。`0.9.52` 推上 GitHub 後數分鐘內，正式站就已經是該版本的建置產物：線上 bundle 含 `0.9.52` 版本字串、不含已刪的 `report-surface`，與本機建置的 JS 只差 50 個位元組 —— 差在 Supabase URL 與 publishable key，線上那份用 PROD 專案，本機用 DEV。CSS 檔 sha256 完全相同。沒有人手動上傳過。

README 步驟 9-1 原本明寫「本專案沒有前端自動部署」，已更正為 Cloudflare Pages 自動部署，手動上傳降為備援路徑。**這個錯誤有實際代價**：0.9.51 的上線順序因此被寫成「PART B 必須等人工上傳新前端之後」，但前端其實在推上 `main` 的當下就自動上線了。順帶一提，`.github/workflows/` 也不只有 `release.yml`，`ci.yml` 自 0.9.51 起就在。

**尚待確認**：Cloudflare Pages 綁的是 `main` 還是 `dev`。0.9.53 推 `dev` 之後、合併 `main` 之前查一次線上版號就能分辨。

**PROD 仍未部署（0.9.51 的 Edge 與 SQL）。** `supabase link --project-ref hrilemueiqyaoiwnkeuu` 被 Claude Code 自動模式的權限層以 `[Production Deploy]` 擋下，與 0.9.51 當時同一個攔截。PROD `functions list` 已確認沒有 `ai-proxy`，DEV 有。PROD 的 `get_ai_settings()` 是否存在則無法確認，查資料庫同樣需要先 link 到 PROD。

## 📅 Log: 2026-09-15 08:58:24 Asia/Taipei (0.9.52, 相依漏洞清理)

例行檢查 GitHub 與本機狀態時，`npm audit` 報出 `jspdf@3.0.4` 一個 critical 與連帶的 `dompurify` moderate。使用者問了關鍵的一句：PDF 功能不是已經拿掉了嗎。查證結果是**只拔了一半** —— UI 按鈕在 0.9.17（`11516cd`）移除並有測試鎖住，但 `generatePdfBlob()`、它的兩個動態 `import()`、以及 `package.json` 的兩個相依都還在，沒有任何正式程式呼叫它。

**因此選擇移除而不是升級。** `jspdf@4.2.1` 是 major 升級，為一個沒有呼叫者的函式承擔破壞性變更不划算。刪除 `generatePdfBlob()` 與 `pdfScaleFor()`、`reportPdf.test.ts`、以及 `index.css` 的 `.report-surface` 區塊；**`downloadBlob()` 必須保留**，`AppShell.tsx` 與 `Admin/BackupsSection.tsx` 用它下載備份檔。順手清掉 `QuoteTab.tsx` 一段引用早已不存在的 CSS 規則的註解，以及三個測試檔的 stale mock。正式相依 6 → 4，`npm audit --omit=dev` 由 1 critical + 1 moderate 歸零。

開發相依另有 5 個漏洞（`undici`、`nanoid` 為 high，`postcss`、`@vitest/mocker`、`vitest` 為 moderate），全在 `vitest` / `vite` 相依鏈上。`npm audit fix` 在現有 semver 範圍內修完，`vitest` 只從 4.1.10 走到 4.1.11，`package.json` 沒變。

驗證：`npm run lint` / `npm run build` / `npm run typecheck:edge` / `npm test` 四道皆 exit 0，121 檔 **1,947** 條測試全過。測試數比 0.9.51 少 5 條，差額正好是刪掉的 `reportPdf.test.ts`。全專案 `npm audit` 為 0 vulnerabilities。

**留待決定**：`Charts/` 底下 6 個檔案的註解仍在解釋「顏色寫死是因為 html2canvas 無法解析 CSS 變數」。該限制已不存在，但顏色仍在使用，清理會擴散到配色決策。

