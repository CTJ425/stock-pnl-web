# CLAUDE.md

# Claude Agent Operating Rules

## 1. Role

Claude is the primary:

- Architecture Agent
- Planning Agent
- Decision Agent
- Specification Agent
- Review Agent
- Integration Agent

Claude is responsible for maintaining the overall technical direction of the project.

Claude implements code directly, and the primary responsibility is to ensure that the project remains correct, consistent, maintainable, testable, and aligned with the specification.

---

# 2. 專案概要與實際結構

**stock-pnl-web** — 股票損益試算與盤後籌碼報告的網頁應用。

**應用程式根目錄是 `sources/`，不是 repo root** —— 所有 npm 指令一律在 `sources/` 底下執行。
（repo root 只放 `CLAUDE.md`、`README.md`、`docs/`、`.claude/`。）

結構原則：

- feature 相關的程式碼放在該 feature 附近，不要打散到純技術性目錄。
- `lib` / `utils` 只放**真正共用**的東西，不要因為目錄存在就把 feature 專屬程式碼丟進去。
- 不要因為模板有某個目錄就去建立它。

---

# 3. Persistent Agent Memory

All important project state must be persisted in:

```text
docs/agent/
```

The next Agent must be able to continue the project by reading:

```text
CLAUDE.md
docs/agent/
```

Important information must not exist only in chat history, Agent memory, terminal output, temporary notes, or uncommitted reasoning.

If information is important for future work, write it to `docs/agent/`.

---

# 4. Agent 文件

| 檔案 | 內容 |
| ---- | ---- |
| `docs/agent/PLAN.md` | 專案規劃與架構方向 |
| `docs/agent/SPEC.md` | 需求與技術規格 |
| `docs/agent/PROGRESS.md` | 目前狀態與下一步 |
| `docs/agent/TASK.md` | 任務追蹤 |
| `docs/agent/BUG_FIX.md` | 未解決的 Bug |
| `docs/agent/FIXED_BUG.md` | 已修復 Bug 的歷史紀錄 |

The Agent state files are authoritative for project progress.

其他文件路徑：`docs/architecture/`（架構）、`docs/api/`（API）、`docs/database/`（資料模型）、`docs/development/`（開發指南）、`docs/deployment/`（部署維運）。

---

# 5. 啟動程序 (Startup Procedure)

進行重大變更前必讀（這些檔案很長，按需讀取以節省 context）：

**預設必讀：**

- `docs/agent/PROGRESS.md` — **只讀尾段的最新狀態**，不必從頭讀完
- `docs/agent/TASK.md`
- `docs/agent/BUG_FIX.md`

**條件式讀取：**

- `docs/agent/PLAN.md` / `docs/agent/SPEC.md` — 動到架構或改變行為時才讀
- `docs/agent/FIXED_BUG.md` — 需要查歷史時才讀

接著檢視相關的專案結構。

Do not assume that the current conversation contains the complete project state.

---

# 6. Standard Workflow

READ → UNDERSTAND → INSPECT STRUCTURE → PLAN → DECIDE → IMPLEMENT → REVIEW → VERIFY → DOCUMENT → HANDOFF

---

# 7. Planning

Before starting a major feature:

1. Read the current project state.
2. Check the specification.
3. Inspect the affected application, package, service, or infrastructure directory.
4. Identify dependencies.
5. Identify risks.
6. Update `PLAN.md`.
7. Create or update tasks in `TASK.md`.
8. Define verification criteria.

---

# 8. Review Procedure

After completing implementation, review:

### Structure

- Are files located in the correct project area?
- Is feature code kept near its feature?
- Are shared modules genuinely shared?
- Were unnecessary directories introduced?
- Were unrelated files modified?

### Tests

- Are tests sufficient?
- Are edge cases covered?
- Does the test verify the actual requirement?

### Documentation

- Is `TASK.md` updated?
- Is `PROGRESS.md` updated?
- Are Bugs documented?
- Are specifications still accurate?

---

# 9. Bug Management

When a Bug is discovered:

```text
DISCOVERED
    ↓
INVESTIGATING
    ↓
ROOT CAUSE IDENTIFIED
    ↓
FIX IN PROGRESS
    ↓
FIXED
    ↓
VERIFIED
```

Open Bugs belong in:

```text
docs/agent/BUG_FIX.md
```

Fixed Bugs belong in:

```text
docs/agent/FIXED_BUG.md
```

---

# 10. Timestamp Rules

Every significant Agent record must contain:

```text
YYYY-MM-DD HH:mm:ss Asia/Taipei
```

Every record should identify:

```markdown
- Agent:
- Action:
- Status:
- Timestamp:
```

---

# 11. Work Completion Checklist

Before finishing work:

- [ ] Code changes are complete
- [ ] Tests have been executed
- [ ] Relevant Bugs are recorded
- [ ] `TASK.md` is updated
- [ ] `PROGRESS.md` is updated
- [ ] `SPEC.md` is updated if behavior changed
- [ ] `PLAN.md` is updated if architecture changed
- [ ] Files are placed in the correct directory
- [ ] No unnecessary directory structure was introduced
- [ ] All important records contain timestamps
- [ ] The next Agent can continue without relying on chat history

---

# 12. 版本號規範 (Versioning)

版本號**一律不帶 `v` 前綴**，只有 `x.x.x` 或 `x.x.x-dev.x` 兩種形式。三處保持同步：

- `sources/src/version.ts` → `APP_VERSION`（前端顯示）
- `sources/package.json` → `version`（連同 `package-lock.json`）
- `README.md` → 版本徽章（第 3 行）與「版本紀錄」

畫面左下角的版本徽章**只顯示版號本身**，不顯示作者、不加前綴。
（`APP_AUTHOR` 已於 0.3.7-dev.6 移除。）

正式版（`main`）用 `x.x.x`、開發版（`dev`）用 `x.x.x-dev.x`。
要決定下一個版號、遞增 `dev.N`、或併入 `main` 定版時，讀 **`versioning` skill**。

---

# 13. 部署與環境 (Deployment Environments)

兩個獨立的 Supabase 專案，與 git 分支對應：

| 環境 | Supabase 專案 | project-ref | 對應分支 |
| ---- | ---- | ---- | ---- |
| 正式區 | Stock-Pnl-Web | `kxnxadaghidwumqsqneu` | `main` |
| 測試區 | Stock-Pnl-Web-Dev | `wqetxuhncvfidqnklyew` | `dev` |

## 13.1 分支流程：一律 dev 先行

**所有異動先進 `dev`，在測試區確認無誤，才合併到 `main`。**
不要直接在 `main` 上開發或提交，即使只是文件異動。

```text
異動 → commit 到 dev → push origin dev → 測試區驗證
                                            ↓ 確認無誤
                                    合併到 main → push → 正式區 / Pages
```

理由：`push` 到 `main` 會觸發 `.github/workflows/deploy.yml`，
GitHub Pages 立刻上線，沒有反悔餘地。dev 先行等於多一道實際環境的驗證。

合併到 `main` 時，依 `versioning` skill 把 `-dev.<N>` 尾綴去掉定版，並將 README 版本紀錄定稿。

**合併後讓兩個分支保持一致**（`git push origin main:dev` 快轉），
避免 dev 落後 main 造成下一輪比對基準混亂 —— 稽核測試區時是拿 `dev` 當基準的。

## 13.2 Supabase 操作規則

- **預設不主動部署 / 異動任何 Supabase 環境。** 日常工作都是分支上的程式碼變更（`dev` 或其他分支）。
- **部署 / 異動環境只在使用者明確要求時才做**（`supabase functions deploy`、`secrets set`、在 SQL Editor 跑 schema、建 bucket / cron 等皆屬對外操作，需先確認）。
- **正式區只在 `main` 分支且經明確指示才動。**
- **唯讀查詢不算異動、可自由執行**：`supabase projects/functions list`、透過 service key 打 REST / Storage 檢查表與 bucket 是否存在等。

## 13.3 Supabase 實務陷阱

實際踩過的坑（`--no-verify-jwt`、`db query --linked` 的 cwd 陷阱、`supabase link` 全域副作用、
稽核要用 `functions download` 逐檔比對等）整理在 **`supabase-ops` skill**，動到 Supabase 前先讀。

---

# 14. Core Principle

Use the simplest structure that can accurately represent the system.

```text
Simple enough for humans
        +
Predictable enough for Agents
        +
Explicit enough for deployment and testing
```

Create directories because the project has a real responsibility that needs to be represented — not because a template contains them.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
