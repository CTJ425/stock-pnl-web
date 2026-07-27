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

技術棧：React 19 + Vite 8 + TypeScript + Supabase（Postgres / Edge Functions / Storage）。
Lint 用 oxlint，測試用 vitest，部署到 GitHub Pages。

實際結構：

```text
stock-pnl-web/
├── CLAUDE.md               # 本檔（Claude 操作規則）
├── README.md               # 版本徽章與版本紀錄
├── docs/
│   └── agent/              # 持久化 Agent 記憶（見 §3、§4）
├── .claude/
│   └── skills/verify/      # UI 驗證 skill
└── sources/                # 應用程式根目錄（npm 專案）
    ├── src/                # 前端原始碼
    ├── supabase/           # migrations / functions
    ├── package.json        # version 來源，見 §12
    └── vite.config.ts
```

所有 npm 指令一律在 `sources/` 底下執行：

| 指令 | 內容 |
| ---- | ---- |
| `npm run dev` | vite dev server |
| `npm run build` | `tsc -b && vite build` |
| `npm run lint` | oxlint |
| `npm run test` | `vitest run` |

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

```text
READ
  ↓
UNDERSTAND
  ↓
INSPECT STRUCTURE
  ↓
PLAN
  ↓
DECIDE
  ↓
IMPLEMENT
  ↓
REVIEW
  ↓
VERIFY
  ↓
DOCUMENT
  ↓
HANDOFF
```

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

### Code

- Correctness
- Architecture
- Maintainability
- Error handling
- Security
- Performance
- Compatibility

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

## 12.1 正式版本（`main` 分支）

格式為 **`x.x.x`**（標準 semver，不帶任何尾綴）。

- 依照前一個正式版號**依序遞增 patch**（例：`0.3.6` → `0.3.7`）。
- **除非是大版本異動**（破壞性變更、架構重構、功能里程碼），才進 minor 或 major（例：`0.3.7` → `0.4.0` → `1.0.0`）。
- `README.md` 的「版本紀錄」以正式版號為標題並定稿。

## 12.2 測試版本（`dev` 及其他開發分支）

格式為 **`x.x.x-dev.x`**（注意：`dev` 與序號之間是**點號** `.`，不是連字號）：

- `x.x.x` = 這批 dev 工作併入 `main` 後會成為的正式版號（依 §12.1 決定）。
- 最後的 `.x` = 該正式版號在 dev 期間的**異動次數**，從 `1` 起、每次有意義的異動 +1。
- 範例：目標 `0.3.7`、第 2 次異動 → `0.3.7-dev.2`。

`README.md` 版本紀錄在 dev 期間以「未來正式版號（開發中）」為標題，底下用 `dev.1 / dev.2 …` 分段列出各次異動。

## 12.3 併入 main

把 `-dev.<N>` 尾綴去掉即為正式版號（`0.3.7-dev.2` → `0.3.7`），並把該版的版本紀錄定稿。目的：讓正式與測試版號永遠對得起來，不再出現正式停在 `0.3.6`、測試卻跳到 `0.3.8` 的落差。

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

合併到 `main` 時，依 §12.3 把 `-dev.<N>` 尾綴去掉定版，並將 README 版本紀錄定稿。

**合併後讓兩個分支保持一致**（`git push origin main:dev` 快轉），
避免 dev 落後 main 造成下一輪比對基準混亂 —— 稽核測試區時是拿 `dev` 當基準的。

## 13.2 Supabase 操作規則

- **預設不主動部署 / 異動任何 Supabase 環境。** 日常工作都是分支上的程式碼變更（`dev` 或其他分支）。
- **部署 / 異動環境只在使用者明確要求時才做**（`supabase functions deploy`、`secrets set`、在 SQL Editor 跑 schema、建 bucket / cron 等皆屬對外操作，需先確認）。
- **正式區只在 `main` 分支且經明確指示才動。**
- **唯讀查詢不算異動、可自由執行**：`supabase projects/functions list`、透過 service key 打 REST / Storage 檢查表與 bucket 是否存在等。

## 13.3 Supabase 實務陷阱（都是實際踩過的）

**指令要在 `sources/` 底下執行。** Edge Functions 在 `sources/supabase/functions/`，
不是 repo root。在 root 執行會出現 `entrypoint path does not exist`。

**部署 `stock-report` 一定要帶 `--no-verify-jwt`。**
兩區的 `stock-report` 都是 `verify_jwt=false`，因為 pg_cron 是帶 `CRON_SECRET` 呼叫、不帶 JWT。
被重設成 `true` 的話盤後批次會全數 401。
（`stock-price` 是 `verify_jwt=true`，用預設即可。）

**稽核要用 `functions download` 逐檔比對，不要看版本號推論。**

```bash
supabase functions download <slug> --project-ref <ref>   # 抓線上實際跑的程式碼
diff <下載的檔> sources/supabase/functions/<slug>/<檔>
```

曾遇到版本號較新的那支反而是舊程式碼（測試區 `stock-price` v2 落後 137 行、
`misParse.ts` 根本沒部署上去）。

**比對基準要對應分支**（§13 對照表）：正式區比 `main`、測試區比 `dev`。
拿錯基準會誤判「已同步」—— 這個錯犯過一次。

**`supabase link` 有全域副作用，不是 per-directory。** 在別的目錄重新 link 會把前一份清掉。
要查另一個專案時優先用支援 `--project-ref` 的指令（`functions list/deploy/download`、`secrets list`）；
只有 `db query --linked` 沒有 `--project-ref`，非用不可時才 link。

**Agent 拿不到 `CRON_SECRET` 明文**（`secrets list` 只回雜湊），
所以手動觸發 `generate-all` 一定要請使用者自己執行。

**`manifest.json` 日期落後時先確認星期。** cron 是 `1-5`，週末本來就不跑，
週末看到日期停在週五是正確的，不是故障。

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
