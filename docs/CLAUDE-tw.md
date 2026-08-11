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

## 任務分派 (Task routing)

依三個軸向為任務評級——需要的推論層數、出錯的代價、主觀取捨的空間——再交給對應的 role。各 role 的模型與 effort 定義在 `.claude/agents/*.md` frontmatter（`.claude/mad/models.json` 為對應設定），切勿在此重複記載。

| 難度 | Role | 適用情境 |
| ---- | ---- | ---- |
| 高 | `architect` | 多層推論、需論證的取捨、複雜規劃、高風險變更 |
| 中 | `builder` / `reviewer` | 方向明確但仍需組織能力——依 spec 實作、對照 spec 審查 |
| 低、高吞吐 | `scout` / `scribe` | 規則明確、量大規律、有標準答案——程式碼探勘、日誌壓縮、文件記錄 |

- 評級是主觀判斷，不是強制關卡。各 role 的 `description` 已載明前置條件（例如 `builder` 需要 spec 路徑），務必遵守。
- Subagent 是冷啟動，看不到本次對話。若「交代任務 + 它重新讀檔」的成本高於直接做，就直接做，與難度無關。
- 完整功能開發已有現成的端到端流程：**`/mad:orchestrate`**。
- 這裡分派的**只有委派工作**。主 session 的模型由 `/model` 決定，不是由本檔案決定。

## 版本控制 (Versioning)

版本號無 `v` 前綴。`main` 分支 = `x.x.x`；`dev` 分支未完成工作 = `x.x.x-dev.N`。

需同步哪些檔案、以及如何決定下一個版本號：**`versioning`** skill。

## 分支與環境 (Branches & envs)

| 環境 | 分支 | Supabase |
| ---- | ---- | ---- |
| PROD (正式) | `main` | 雲端 `kxnxadaghidwumqsqneu` |
| DEV (測試) | `dev` | 自建 Docker `https://korq9tvdz0jd7yblr72p.ivan.lab`（compose 位於 `/root/container/supabase/stock-pnl-web-dev`） |

- **務必先 commit 至 `dev`**；在 DEV 環境驗證無誤後才合併至 `main`。`main` 的 push 會自動部署 Pages。
- 除非使用者要求，否則**切勿**部署 / 變更 Supabase 環境。正式環境 Edge 部署僅限在 `main` 分支且收到明確指令。
- DEV 環境 Edge 部署：將檔案 **volume copy** 至 `volumes/functions/` + 重新建立 functions 容器 — 而非使用雲端 `functions deploy`。
- 唯讀查詢可自由執行。操作坑洞（含 `stock-report` 於雲端需加 `--no-verify-jwt`）參見：**`supabase-ops`** skill。
