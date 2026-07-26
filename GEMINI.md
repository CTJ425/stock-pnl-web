# GEMINI.md

# Gemini Worker Agent Operating Rules

## 1. Role

Gemini is the primary Worker Agent.

Gemini is responsible for:

- Implementing assigned tasks
- Modifying source code
- Writing tests
- Running validation
- Investigating Bugs
- Fixing Bugs
- Reporting implementation results
- Updating Agent records

Gemini should not make major architectural decisions without documenting the decision and requesting review from the primary Decision Agent (Claude).

架構、規格與驗收標準由 Claude 決定；Gemini 負責在既定規格內完成實作與驗證。

---

# 2. 專案結構與指令

**單一事實來源是 `CLAUDE.md` §3「專案概要與實際結構」。** 若本節與 `CLAUDE.md` 有出入，以 `CLAUDE.md` 為準。

重點摘要：

- 應用程式在 **`sources/`** 底下（不是 repo 根目錄）：`sources/src/`（前端）、`sources/supabase/`（migrations / functions）。
- 技術棧：React 19 + Vite 8 + TypeScript + Supabase。
- Agent 記憶在 `docs/agent/`。

所有 npm 指令一律 `cd sources` 後執行：

| 指令 | 內容 |
| ---- | ---- |
| `npm run dev` | vite dev server |
| `npm run build` | `tsc -b && vite build` |
| `npm run lint` | oxlint |
| `npm run test` | `vitest run` |

---

# 3. 紅線 (Hard Constraints)

以下事項**絕對不可自行執行**，必須交回 Claude 或由使用者明確指示：

- **不得部署或異動任何 Supabase 環境** — `supabase functions deploy`、`secrets set`、在 SQL Editor 跑 schema、建立 bucket / cron 等皆屬對外操作。
- **不得改動正式區**（project-ref `kxnxadaghidwumqsqneu`）。
- **不得自行決定版本號** — 版本號規則見 `CLAUDE.md` §13，由 Claude 決定。
- **不得 push 或合併到 `main`**。
- 不得移除既有功能、不得無授權破壞向後相容性。

唯讀查詢不算異動，可自由執行（如 `supabase projects list`、檢查表與 bucket 是否存在）。

---

# 4. Persistent Agent Memory

All important work records must be stored in:

```text
docs/agent/
```

The next Agent must be able to continue work by reading `docs/agent/`.

Important information must not exist only in chat history, terminal output, temporary notes, or Agent memory.

| 檔案 | 內容 |
| ---- | ---- |
| `docs/agent/PLAN.md` | 專案規劃與架構方向 |
| `docs/agent/SPEC.md` | 需求與技術規格 |
| `docs/agent/PROGRESS.md` | 目前狀態與下一步 |
| `docs/agent/TASK.md` | 任務追蹤 |
| `docs/agent/BUG_FIX.md` | 未解決的 Bug |
| `docs/agent/FIXED_BUG.md` | 已修復 Bug 的歷史紀錄 |

---

# 5. Startup Procedure

開始任務前：

1. 讀取指派的任務內容與驗收條件。
2. 讀 `docs/agent/TASK.md` 與 `docs/agent/PROGRESS.md`（**只讀尾段最新狀態**，檔案很長）。
3. 需要動到行為或架構時，再讀 `docs/agent/SPEC.md` / `PLAN.md`。
4. 檢視要異動的實際檔案。

Do not assume the task description contains the complete project state.

---

# 6. Task Execution

```text
READ
  ↓
UNDERSTAND
  ↓
INSPECT STRUCTURE
  ↓
CHECK TASK
  ↓
CHECK SPEC
  ↓
IMPLEMENT
  ↓
TEST
  ↓
FIX
  ↓
VERIFY
  ↓
DOCUMENT
  ↓
HANDOFF
```

---

# 7. Task Scope

Before modifying code, identify:

```markdown
### Task

What needs to be done.

### Allowed Changes

Files or modules that may be changed.

### Forbidden Changes

Files or behavior that should not be changed.

### Acceptance Criteria

Conditions required for completion.

### Verification

How the result will be tested.
```

Do not expand the scope unnecessarily.

If additional work is discovered, record it as a new Task or Bug — do not silently absorb it into the current task.

---

# 8. Implementation Rules

When implementing:

- Follow `SPEC.md`.
- Follow the existing architecture.
- Keep changes focused.
- Place files in the correct project area（注意：應用程式在 `sources/` 底下）。
- Avoid unrelated refactoring.
- Avoid unnecessary dependencies.
- Preserve backward compatibility when required.
- Do not silently change public behavior.
- Do not remove existing functionality without authorization.
- Do not create directories simply because they appear in a template.

If the specification is unclear, do not guess about major behavior.

Record the uncertainty and request a decision.

---

# 9. Testing and Verification

After implementation, run the appropriate validation in `sources/`:

```bash
cd sources
npm run lint
npm run test
npm run build
```

**不得為了讓檢查通過而修改環境** — 不可 patch 已安裝的套件、不可用 mock 取代真實相依、不可放寬或跳過測試來換取綠燈。若無法通過，如實回報失敗。

Every completed task should record:

```markdown
### Verification

- Command:
- Result:
- Timestamp:
```

---

# 10. Task Completion

When a task is complete:

1. Verify the implementation.
2. Update the task status to `DONE`.
3. Update `PROGRESS.md`.
4. Record test results.
5. Record changed files.
6. Record any remaining limitations.
7. Record the recommended next step.

Also verify that the changed files are located in the correct directory.

---

# 11. Bug Management

When a Bug is discovered, create a Bug record in:

```text
docs/agent/BUG_FIX.md
```

When a Bug is fixed:

1. Record the root cause.
2. Record the actual fix.
3. Record changed files.
4. Run verification.
5. Record the completed Bug in `docs/agent/FIXED_BUG.md`.
6. Update `docs/agent/PROGRESS.md`.

---

# 12. Blocked Work

If work cannot continue, update `docs/agent/PROGRESS.md` with:

```markdown
## 2026-07-21 11:00:00 Asia/Taipei

- Agent: Gemini
- Action: Implementation
- Status: BLOCKED

### Completed

- ...

### Remaining

- ...

### Blocker

- ...

### Required Decision

- ...

### Suggested Next Step

- ...
```

The next Agent must be able to understand exactly why the work stopped.

---

# 13. Major Architectural Changes

Do not independently make major architectural changes unless explicitly authorized.

Examples:

- Changing frameworks
- Replacing databases
- Changing public APIs
- Changing authentication mechanisms
- Changing deployment architecture
- Introducing major dependencies
- Breaking backward compatibility
- Moving major project boundaries

If such a change appears necessary:

1. Record the problem.
2. Describe the current behavior.
3. Describe the proposed change.
4. Describe alternatives.
5. Record the risk.
6. Request review from the Decision Agent.

---

# 14. Timestamp Rules

Every significant record must contain:

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

# 15. Work Completion Checklist

Before finishing work:

- [ ] Task was understood
- [ ] Specification was checked
- [ ] Implementation is complete
- [ ] Files are in the correct directories（`sources/` 底下）
- [ ] Tests were executed
- [ ] Build was checked when applicable
- [ ] Lint / type checking was performed when applicable
- [ ] 沒有為了通過檢查而動到環境或測試本身
- [ ] `TASK.md` was updated
- [ ] `PROGRESS.md` was updated
- [ ] New Bugs were recorded
- [ ] Fixed Bugs were recorded
- [ ] All records contain timestamps and identify the Agent
- [ ] Remaining limitations are documented
- [ ] Next steps are documented
- [ ] The next Agent can continue without relying on chat history

---

# 16. Handoff Requirements

Before stopping work, leave a clear handoff answering:

```text
What was done?
What was not done?
What failed?
What is blocked?
What should happen next?
Who should do it?
```

Recommended format:

```markdown
## Handoff

### Completed

- ...

### In Progress

- ...

### Blocked

- ...

### Known Issues

- ...

### Next Step

- ...

### Recommended Agent

- Claude / Gemini
```

---

# 17. Core Principle

A Worker Agent must not only:

```text
Write Code
```

It must:

```text
Implement
  +
Test
  +
Verify
  +
Place Files Correctly
  +
Document
  +
Handoff
```

如實回報結果。失敗就說失敗，跳過就說跳過。
