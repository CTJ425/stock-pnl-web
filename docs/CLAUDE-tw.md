# CLAUDE.md

**stock-pnl-web**（股票損益計算 + 台股盤後報告）的 Agent 規範。保持此檔案簡短；詳細資訊位於 skills 與 `docs/`。

## 目錄結構 (Layout)

- 應用程式根目錄：**`sources/`** — 所有 `npm` / vitest / playwright 指令皆在此執行。
- 儲存庫根目錄：`CLAUDE.md`、`README.md`、`docs/`、`.claude/`。
- 與功能相關的程式碼放置在該功能附近；`utils`/`lib` 僅用於真正共用的程式碼。切勿建立僅為範本存在的目錄。

## 記憶機制 (`docs/agent/`) (Memory)

將重要狀態持久化儲存於此，讓下一個 Agent 不需要對話紀錄。

| 檔案 | 用途 |
| ---- | ---- |
| `PROGRESS.md` | 最新狀態（**僅讀取最頂部**）；較舊紀錄 → `PROGRESS_ARCHIVE.md` |
| `TASK.md` | 進行中的任務；已完成 → `TASK_ARCHIVE.md` |
| `BUG_FIX.md` / `FIXED_BUG.md` | 未解決 / 已修復的 Bug |
| `PLAN.md` / `SPEC.md` | 架構 / 需求（按需讀取） |
| `CHANGELOG.md` | 版本歷史紀錄 |
| `specs/<id>.md` | 各任務規格（若存在） |

另有：`docs/UnitTests/`（測試單一事實來源 SoT）、`docs/architecture/`。

**Agent 撰寫的文件一律使用英文**（見全域規則 1）。

## Session 啟動 (Start of session)

閱讀（按需讀取，保持 Context 輕量）：

1. `docs/agent/PROGRESS.md` — 僅最頂部  
2. `docs/agent/TASK.md`  
3. `docs/agent/BUG_FIX.md`  

接著檢查您將修改的程式碼。切勿假設對話包含完整狀態。

## 工作風格 (Work style)

- 工作完成後：更新 `TASK.md` / `PROGRESS.md`（如有需要亦更新 Bug 紀錄）。重要紀錄包含時間戳記：`YYYY-MM-DD HH:mm:ss Asia/Taipei`。
- Skills（相關時載入）：`testing`、`verify`、`versioning`、`supabase-ops`、`ship`。

## 版本控制 (Versioning)

版本號無 `v` 前綴。`main` 分支 = `x.x.x`；`dev` 分支未完成工作 = `x.x.x-dev.N`。

需同步哪些檔案、以及如何決定下一個版本號：**`versioning`** skill。

## 分支與環境 (Branches & envs)

| 環境 | 分支 | Supabase |
| ---- | ---- | ---- |
| PROD (正式) | `main` | 雲端 **`hrilemueiqyaoiwnkeuu`**（專案「Stock-Pnl-Web」） |
| DEV (測試) | `dev` | 雲端 **`zyebvayngwrqzoaicbwd`**（專案「Stock-Pnl-Web-Dev」）— `supabase link` 指向 |

- **務必先 commit 至 `dev`**；在 DEV 環境驗證無誤後才合併至 `main`。`main` 的 push 會自動部署前端。
- PROD 與 DEV 皆為 Supabase 雲端專案（無 Docker 環境）。
- Edge Functions 部署：
  - `stock-price` 與 `ai-proxy` 需開啟 JWT 驗證（`verify_jwt=true`，不加 `--no-verify-jwt` 旗標）：`supabase functions deploy <name> --project-ref <ref>`（前端以使用者 JWT 呼叫）。
  - 背景排程觸發的函數（`stock-report`、`backup-transactions`）需關閉 JWT 驗證：`supabase functions deploy <name> --project-ref <ref> --no-verify-jwt`（pg_cron 帶 `x-cron-secret` 呼叫、不帶 JWT）。
- 唯讀查詢可自由執行。操作坑洞（含 `stock-report` 於雲端需加 `--no-verify-jwt`）參見：**`supabase-ops`** skill。


