# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: AI 金鑰移出瀏覽器（Task 161）、CI 測試閘門、條件式 hook 與 lint 修補、刪除正式站樣板檔
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-14 19:29:33 Asia/Taipei

---

## 📅 Log: 2026-09-14 19:29:33 Asia/Taipei (0.9.51, Task 161 + 稽核 A2/A3/A4)

Google AI 金鑰不再進入瀏覽器。新增 `ai-proxy` Edge Function：前端仍負責組請求與解析回覆，代理只在伺服器端注入金鑰與模型名稱，並原樣轉送 Google 的狀態碼與 JSON —— 因此「400 去掉 `thinkingConfig` 重送一次」、401/429/5xx 對應、180 秒逾時全部不變。模型名稱改由伺服器端決定，呼叫端無法改指到別的模型。

權限那一段有一個**會靜默失效的陷阱，必須記住**：欄位層級的 `REVOKE` 對已持有資料表層級授權的角色無效，而且不報錯。Supabase 預設給 `authenticated` 整張表的 SELECT，Postgres 先檢查資料表層級權限。在 supabase/postgres 17.6 實測確認：只下 `REVOKE SELECT (ai_api_key) ... FROM authenticated`，金鑰照樣讀得到 —— 那會是一個所有測試都綠、卻什麼都沒修好的修補。正確順序是先 `REVOKE SELECT ON app_settings`，再把 `ai_api_key` 以外的欄位逐欄 `GRANT` 回去。**日後在這張表加欄位，沒補進那行 GRANT 就會讀不到。** 前端改走 `get_ai_settings()`（`SECURITY DEFINER`），該函數對 google 一律回傳空字串並附帶 `ai_has_key`。

範圍限於 google（使用者 2026-09-14 決定）。`openai-compatible` 維持瀏覽器直連，因為 Supabase Edge Function 連不到本機 Ollama，該路徑的金鑰仍會下發到每個登入者的瀏覽器 —— 記為 RISK-013。後台警語改為依供應商如實顯示。

同批修掉三項稽核發現。其一，`.github/workflows/ci.yml`：此前 repo 只有一支「push main 時同步 Release」的 workflow，1,900 多條測試從來沒有自動跑過。其二，`ChipsTab.tsx` 的兩個 `useState` 位在三個 early return 之後 —— 在籌碼分頁上切換股票時 `status` 由 `ready` 變回 `loading`，React 會看到 hook 數量由 2 變 0 並拋錯；兩行已移到所有 early return 之前。同時把 `useRowActivate` 更名為 `rowActivateProps`（它內部沒有任何 hook，`use` 前綴讓 oxlint 對 4 個呼叫點誤報），lint error 由 4 降為 0，A2 的閘門才擋得住東西。其三，刪除 `sources/public/mockup-table-redesign.html` —— 無程式引用，卻會隨 `dist/` 上傳到正式站。

審查後補正兩處：`readSettings` 原本吞掉 PostgREST 的 `error`，暫時性讀取失敗會退化成 `provider === ''` 並報成 400；256 KB 請求上限原本用 UTF-16 碼元長度計算，中文提示詞約 3 倍大仍會通過，已改為位元組。

驗證：`npm run lint` / `npm run build` / `npm run typecheck:edge` / `npm test` 四道皆 exit 0，122 檔 **1,952** 條測試全過（新增 23 條）。SQL 權限模型以真實欄位組成在 supabase/postgres 17.6 實測五項：直接讀金鑰被拒、應用欄位可讀、`get_ai_settings()` 對 google 回空字串、管理員寫入正常、openai-compatible 仍取得金鑰。

**部署狀態與正確順序（2026-09-14 20:37:39 更新）。** 先前寫的順序對線上站是錯的，已更正：正確順序是 `PART A`（建 `get_ai_settings()`）→ `supabase functions deploy ai-proxy` → 上傳前端 `dist/` → `PART B`（撤銷 `ai_api_key` 讀取權）。**`PART B` 一定要放最後** —— 0.9.51 以前的前端直接 `select('ai_api_key')`，先跑 `PART B` 會讓線上站的 AI 分析分頁一直顯示未設定，直到新前端上傳為止。兩段 SQL 已分開寫在 `docs/agent/161-ai-key-proxy-migration.sql`。

**DEV（`zyebvayngwrqzoaicbwd`）已完成並實測。** DDL 以 `db query --linked` 套用，同一個查詢內含 `EXISTS (... cron.job ... LIKE '%zyebvayngwrqzoaicbwd%')` 守衛，不是 DEV 就 RAISE。驗證用 `has_column_privilege` 而非肉眼：`auth_reads_key=false`、`auth_reads_model=true`、`auth_reads_prompt=true`、`auth_can_update=true`、`auth_execs_rpc=true`、`anon_execs_rpc=false`、`security_definer=true`。Edge 部署後 `functions list` 顯示 `ai-proxy` ACTIVE v1、`verify_jwt=true`、sha `0e9155260cf390ce…`。實際打端點：無 Authorization 回 401、假 JWT 回 401、OPTIONS 回 200。附帶查到 DEV 的 `ai_provider` 是 `openai-compatible` 且沒有金鑰，所以 DEV 上跑不到 google 代理路徑。

**PROD（`hrilemueiqyaoiwnkeuu`）尚未部署。** 部署指令被 Claude Code 的自動模式權限層以 `[Production Deploy]` 擋下，需要使用者另行授權或自行執行。另有一個環境陷阱要記住：`SUPABASE_ACCESS_TOKEN` 環境變數會蓋掉 `~/.supabase/access-token`，而這台機器上的那個變數屬於不相關的 `vuln-beacon` 專案 —— 帶著它時 `projects list` 看不到本專案、所有呼叫回 403。加 `env -u SUPABASE_ACCESS_TOKEN` 才會用到正確憑證。

## 📅 Log: 2026-09-14 15:29:05 Asia/Taipei (Task 160 R2 removed from scope)

使用者決定把 Cloudflare R2 移出 Task 160 範圍。`sources/scripts/snapshot.cjs` 已刪除 `readR2Config`、`signR2Put`、`copyToR2` 與相關 SigV4 helper，`--to` 現在只接受 `local` 與 `storage`，未知目的地以離開碼 1 拒絕（先前是靜默記錄失敗）。四支腳本 `grep -ci r2` 皆為 0。刪除後重跑快照仍為 1.6 MB、EXIT 0。

刻意保留、未動的三處：`supabase/functions/backup-transactions/r2.ts`（0.9.49 已進 repo，從未部署，無 `R2_*` secrets 時回報 skipped）、`stock-report/index.ts` 對 `r2_status` / `r2_error` 的讀取、以及 DEV `backup_run_log` 的那兩個欄位。**那兩個欄位不可以刪** —— `stock-report/index.ts:3867` 的 SELECT 指名了它們，PostgREST 遇到不存在的欄位會讓整個請求失敗，一旦該函式被部署，後台備份頁會整頁掛掉。

代價要說清楚：快照包現在沒有任何存在於 Supabase 帳號之外的副本。`local` 是爆炸半徑圖裡唯一在專案被刪除後還活著的目的地。這是覆蓋率的實質下降，不是中性的簡化。

