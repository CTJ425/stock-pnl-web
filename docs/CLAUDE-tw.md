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
- Skills（相關時載入）：`route`、`testing`、`verify`、`versioning`、`supabase-ops`、`ship`。

## 任務分派 (Task routing)

**委派給下列 role 屬於常設授權**，不需要每次先問使用者。主 session 跑在全系統最貴的模型上，凡是便宜 role 能正確完成的工作，就不該留在主 session 做。各 role 的模型與 effort 定義在 `.claude/agents/*.md` frontmatter，切勿在此重複記載。

| Role | 負責 | 主 session 不該做 |
| ---- | ---- | ---- |
| `scout` | 探勘檔案／呼叫者／測試，壓縮日誌與 stack trace | 超過約十餘次的探索性 Read/Grep |
| `architect` | Spec、失敗測試、修 bug 計畫、裁決（主 session 在 Opus 上時可自行處理） | — |
| `builder` | 依既有 spec 實作 | 修改 `sources/` 中大於單檔機械性變更的內容 |
| `reviewer` | 依 spec 審查變更檔案 | 自己審自己的實作 |
| `scribe` | `docs/agent/` 記錄維護、commit message | 手改 `TASK.md` / `PROGRESS.md` / bug 檔 |

- **流程本體是 `route` skill**：功能開發、修 bug、處理 `TASK.md` 項目時載入它，由它決定 lane 分級、派工順序、handoff 格式與升級規則。
- 兩條成本紅線讓這件事誠實：一次派工固定成本 5–15k tokens；實測完整 loop 跑瑣碎任務要 3.5 倍 token。人類 20 分鐘內能做完的，留在主 session（Lane 0）——那也是一種 routing 決策。
- Role 邊界由 `.claude/hooks/routing_guard.py` 強制，不是靠自律。被擋下代表你越界了：重新分派，不要繞過。逃生門：`ROUTING_MAIN=off`、`ROUTING_GUARD=off`。
- routing 有沒有真的發生是可量測的，計畫不算證據：`python3 .claude/hooks/routing_audit.py`。
- 這裡分派的**只有委派工作**。主 session 的模型由 `/model` 決定，不是由本檔案決定。

## 版本控制 (Versioning)

版本號無 `v` 前綴。`main` 分支 = `x.x.x`；`dev` 分支未完成工作 = `x.x.x-dev.N`。

需同步哪些檔案、以及如何決定下一個版本號：**`versioning`** skill。

## 分支與環境 (Branches & envs)

| 環境 | 分支 | Supabase |
| ---- | ---- | ---- |
| PROD (正式) | `main` | 雲端 **`hrilemueiqyaoiwnkeuu`**（專案「Stock-Pnl-Web」） |
| DEV (測試) | `dev` | 自建 Docker `https://korq9tvdz0jd7yblr72p.ivan.lab`（compose 位於 `/root/container/supabase/stock-pnl-web-dev`） |
| DEV (雲端) | `dev` | 雲端 **`zyebvayngwrqzoaicbwd`**（專案「Stock-Pnl-Web-Dev」） |

- **務必先 commit 至 `dev`**；在 DEV 環境驗證無誤後才合併至 `main`。`main` 的 push 會自動部署前端。
- 除非使用者要求，否則**切勿**部署 / 變更 Supabase 環境。正式環境 Edge 部署僅限在 `main` 分支且收到明確指令。
- DEV 環境 Edge 部署：將檔案 **volume copy** 至 `volumes/functions/` + 重新建立 functions 容器 — 而非使用雲端 `functions deploy`。
- 唯讀查詢可自由執行。操作坑洞（含 `stock-report` 於雲端需加 `--no-verify-jwt`）參見：**`supabase-ops`** skill。
