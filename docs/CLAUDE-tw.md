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

**Agent 撰寫的文件：英文**（、UI 文案、`README.md` 除外）。與使用者的對話：繁體中文。

## Session 啟動 (Start of session)

閱讀（按需讀取，保持 Context 輕量）：

1. `docs/agent/PROGRESS.md` — 僅最頂部  
2. `docs/agent/TASK.md`  
3. `docs/agent/BUG_FIX.md`  

接著檢查您將修改的程式碼。切勿假設對話包含完整狀態。

## 工作風格 (Work style)

- 偏好簡單、精準的變更（Surgical changes）；不加入未要求的推測性功能。
- 工作完成後：程式碼完成、`cd sources && npm test` 綠燈通過、更新 `TASK.md` / `PROGRESS.md`（如有需要亦更新 Bug 紀錄）。重要紀錄包含時間戳記：`YYYY-MM-DD HH:mm:ss Asia/Taipei`。
- Skills（相關時載入）：`testing`、`verify`、`versioning`、`supabase-ops`、`ship`。

## 版本控制 (Versioning)

版本號無 `v` 前綴。保持同步：

- `sources/src/version.ts` → `APP_VERSION`
- `sources/package.json`（及 lock 檔）
- `README.md` badge
- `docs/agent/CHANGELOG.md`

`main` 分支 = `x.x.x`；`dev` 分支未完成工作 = `x.x.x-dev.N`。發佈後，`dev` 與 `main` 為相同版本（`git push origin main:dev`）。下一次工作 = 下一個 patch 版本 `-dev.1`。詳細資訊參見：**`versioning`** skill。

## 分支與環境 (Branches & envs)

| 環境 | 分支 | Supabase |
| ---- | ---- | ---- |
| PROD (正式) | `main` | 雲端 `kxnxadaghidwumqsqneu` |
| DEV (測試) | `dev` | 自建 Docker `https://korq9tvdz0jd7yblr72p.ivan.lab`（compose 位於 `/root/container/supabase/stock-pnl-web-dev`） |

- **務必先 commit 至 `dev`**；在 DEV 環境驗證無誤後才合併至 `main`。`main` 的 push 會自動部署 Pages。
- 除非使用者要求，否則**切勿**部署 / 變更 Supabase 環境。正式環境 Edge 部署僅限在 `main` 分支且收到明確指令。
- DEV 環境 Edge 部署：將檔案 **volume copy** 至 `volumes/functions/` + 重新建立 functions 容器 — 而非使用雲端 `functions deploy`。
- 唯讀查詢可自由執行。操作坑洞參見：**`supabase-ops`** skill。`stock-report` 於雲端環境需要加上 `--no-verify-jwt`。
