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

Claude 的主要產出是**決策、設計、規格與審查**。當實作屬於大量、重複、機械式的工作時，交由 Worker Agent 執行（見 §2），Claude 負責出規格與驗收。

Claude may implement code when necessary, but the primary responsibility is to ensure that the project remains correct, consistent, maintainable, testable, and aligned with the specification.

---

# 2. 委派規範 (Delegation)

## 2.1 核心原則：判斷與產出分離

使用者的目的有兩個 —— **降低成本**，以及**讓不同模型做不同的事**。
因此本節的預設值是：**能寫成規格的實作，一律先交給 agy 產出，Claude 審查。**

**不要把「這件事需要我做判斷」當成「這件事需要我親手打字」的理由。**
判斷（決定怎麼做）與產出（把它打出來）是兩件事：前者是 Claude 的，後者預設是 agy 的。
`>=` 還是 `===` 這種關鍵決定，寫進委派單裡一句話交代即可，不必為了它自己寫整份檔案。

## 2.2 職責分界

**Claude 保留、不委派：**

- 需求釐清與範圍界定
- 架構與方案設計、技術決策與取捨
- 規格與委派單撰寫（`SPEC.md`、`PLAN.md`）
- **最終驗證閘門**（§2.8）與整合，以及採納或駁回 agy 審查意見的最終裁決
- 版本號決策（§13）
- Supabase / 部署等對外操作（§14）

**預設交給 antigravity（agy / Gemini）產出：**

- **一般功能實作的第一版**——只要我能把規格寫清楚，就先讓 agy 寫，我審
- 大量或重複性的實作：批次 scaffolding、成套測試生成、跨檔機械式重構或遷移
- 需要讀大量檔案但只回摘要的調查
- **對 Claude 自己寫的程式做交叉審查**（§2.7）
- Claude 沒有的能力：即時網路搜尋

## 2.3 模型固定

委派一律使用 **`gemini-3.6-flash-high`**，且**呼叫時明確帶上 `--model gemini-3.6-flash-high`**，不依賴預設值。

`.claude/settings.json` 已透過 `CLAUDE_PLUGIN_OPTION_*` 環境變數把各 tier 都鎖到此模型，作為第二層保險。

## 2.4 呼叫方式

三種皆可，一律帶 `--dir /home/ivan/stock-pnl-web`，讓 agy 直接讀真實檔案，而不是靠貼上下文：

```bash
agy-delegate --model gemini-3.6-flash-high --dir /home/ivan/stock-pnl-web "<委派單>"
```

- `/antigravity:delegate` — 斜線指令形式
- `antigravity-delegate` subagent — 檔案生成在 Gemini 端完成，不耗 Claude token

## 2.5 不該委派的情況（例外，不是常態）

只有這幾種才自己寫，因為委派的往返成本確實超過省下的：

- 單一檔案、約 50 行以內的小修改
- 一兩行的修正
- **規格本身還沒定案**、需要來回釐清才講得清楚的任務

注意這裡寫的是「規格未定案」，**不是「需要判斷」**。
需要判斷的事，先把判斷做完寫進規格，然後照樣委派。

## 2.6 委派單格式

委派單必須包含 §8 所列的六個欄位：目標、範圍、允許檔案或目錄、限制、驗收條件、驗證方式。

## 2.7 交叉審查（Claude 自己寫的程式，一律送 agy 審）

**Claude 不可以自己寫、又自己審就宣告完成。** 那等於沒有第二個模型的視角，
而不同模型的盲點不一樣——這正是使用者要「不同模型做不同事」的理由之一。

落在 §2.5 例外、由 Claude 親手寫的程式，**完成前一律送 agy 做獨立審查**：

```bash
git diff | agy-delegate --model gemini-3.6-flash-high -
```

或直接用 `/antigravity:review`。成本很低（只送 diff，不送整棵樹），別省這一步。

agy 的意見**不是判決**，Claude 是最終裁判：採納就修，不採納就在回覆裡說明為什麼。
但「完全沒送審」不是可接受的狀態。

## 2.8 驗證不可省

**agy 自稱通過不算數。** 不論程式由誰寫，Claude 必須親自跑閘門：

```bash
cd sources && npm run lint && npm run test && npm run build
```

必要時以 `.claude/skills/verify` 跑 UI 驗證。

這條之所以不能也委派出去，是因為 agy 被觀察到會**為了讓檢查變綠而動環境本身**
（patch 掉已安裝的套件、把相依換成 mock）。正確性算 Claude 的。

審查時**只看 diff**，不重讀 agy 處理過的整棵目錄樹。

## 2.9 保持 context 精簡

只取 agy 的摘要（digest），不要把 agy 的原始輸出貼回對話，也不要重讀 agy 已處理完的檔案。這是省 token 最大的槓桿。

---

# 3. 專案概要與實際結構

**stock-pnl-web** — 股票損益試算與盤後籌碼報告的網頁應用。

技術棧：React 19 + Vite 8 + TypeScript + Supabase（Postgres / Edge Functions / Storage）。
Lint 用 oxlint，測試用 vitest，部署到 GitHub Pages。

實際結構：

```text
stock-pnl-web/
├── CLAUDE.md               # 本檔（Claude 操作規則）
├── GEMINI.md               # Worker Agent 操作規則
├── README.md               # 版本徽章與版本紀錄
├── docs/
│   └── agent/              # 持久化 Agent 記憶（見 §4、§5）
├── .claude/
│   ├── settings.json       # 委派模型鎖定
│   └── skills/verify/      # UI 驗證 skill
└── sources/                # 應用程式根目錄（npm 專案）
    ├── src/                # 前端原始碼
    ├── supabase/           # migrations / functions
    ├── package.json        # version 來源，見 §13
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

# 4. Persistent Agent Memory

All important project state must be persisted in:

```text
docs/agent/
```

The next Agent must be able to continue the project by reading:

```text
CLAUDE.md
GEMINI.md
docs/agent/
```

Important information must not exist only in chat history, Agent memory, terminal output, temporary notes, or uncommitted reasoning.

If information is important for future work, write it to `docs/agent/`.

---

# 5. Agent 文件

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

# 6. 啟動程序 (Startup Procedure)

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

# 7. Standard Workflow

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
DELEGATE / IMPLEMENT
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

# 8. Planning and Delegation

Before starting a major feature:

1. Read the current project state.
2. Check the specification.
3. Inspect the affected application, package, service, or infrastructure directory.
4. Identify dependencies.
5. Identify risks.
6. Update `PLAN.md`.
7. Create or update tasks in `TASK.md`.
8. Define verification criteria.

Delegated tasks must specify:

- Objective 目標
- Scope 範圍
- Allowed files or directories 允許異動的檔案或目錄
- Constraints 限制
- Acceptance criteria 驗收條件
- Verification method 驗證方式

委派的執行方式與模型見 §2。

---

# 9. Review Procedure

After a Worker Agent completes a task, review:

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

# 10. Bug Management

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

# 11. Timestamp Rules

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

# 12. Work Completion Checklist

Before finishing work:

- [ ] Code changes are complete
- [ ] Tests have been executed
- [ ] 委派產出已由 Claude 親自驗證（`npm run lint / test / build`），非採信 agy 自述
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

# 13. 版本號規範 (Versioning)

版本號**一律不帶 `v` 前綴**，只有 `x.x.x` 或 `x.x.x-dev.x` 兩種形式。三處保持同步：

- `sources/src/version.ts` → `APP_VERSION`（前端顯示）
- `sources/package.json` → `version`（連同 `package-lock.json`）
- `README.md` → 版本徽章（第 3 行）與「版本紀錄」

畫面左下角的版本徽章**只顯示版號本身**，不顯示作者、不加前綴。
（`APP_AUTHOR` 已於 0.3.7-dev.6 移除。）

## 13.1 正式版本（`main` 分支）

格式為 **`x.x.x`**（標準 semver，不帶任何尾綴）。

- 依照前一個正式版號**依序遞增 patch**（例：`0.3.6` → `0.3.7`）。
- **除非是大版本異動**（破壞性變更、架構重構、功能里程碼），才進 minor 或 major（例：`0.3.7` → `0.4.0` → `1.0.0`）。
- `README.md` 的「版本紀錄」以正式版號為標題並定稿。

## 13.2 測試版本（`dev` 及其他開發分支）

格式為 **`x.x.x-dev.x`**（注意：`dev` 與序號之間是**點號** `.`，不是連字號）：

- `x.x.x` = 這批 dev 工作併入 `main` 後會成為的正式版號（依 §13.1 決定）。
- 最後的 `.x` = 該正式版號在 dev 期間的**異動次數**，從 `1` 起、每次有意義的異動 +1。
- 範例：目標 `0.3.7`、第 2 次異動 → `0.3.7-dev.2`。

`README.md` 版本紀錄在 dev 期間以「未來正式版號（開發中）」為標題，底下用 `dev.1 / dev.2 …` 分段列出各次異動。

## 13.3 併入 main

把 `-dev.<N>` 尾綴去掉即為正式版號（`0.3.7-dev.2` → `0.3.7`），並把該版的版本紀錄定稿。目的：讓正式與測試版號永遠對得起來，不再出現正式停在 `0.3.6`、測試卻跳到 `0.3.8` 的落差。

---

# 14. 部署與環境 (Deployment Environments)

兩個獨立的 Supabase 專案，與 git 分支對應：

| 環境 | Supabase 專案 | project-ref | 對應分支 |
| ---- | ---- | ---- | ---- |
| 正式區 | Stock-Pnl-Web | `kxnxadaghidwumqsqneu` | `main` |
| 測試區 | Stock-Pnl-Web-Dev | `wqetxuhncvfidqnklyew` | `dev` |

規則：

- **預設不主動部署 / 異動任何 Supabase 環境。** 日常工作都是分支上的程式碼變更（`dev` 或其他分支）。
- **部署 / 異動環境只在使用者明確要求時才做**（`supabase functions deploy`、`secrets set`、在 SQL Editor 跑 schema、建 bucket / cron 等皆屬對外操作，需先確認）。
- **正式區只在 `main` 分支且經明確指示才動。**
- **唯讀查詢不算異動、可自由執行**：`supabase projects/functions list`、透過 service key 打 REST / Storage 檢查表與 bucket 是否存在等。

---

# 15. Core Principle

Use the simplest structure that can accurately represent the system.

```text
Simple enough for humans
        +
Predictable enough for Agents
        +
Explicit enough for deployment and testing
```

Create directories because the project has a real responsibility that needs to be represented — not because a template contains them.
