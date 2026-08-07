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

# 2. Project Overview and Structure

**stock-pnl-web** — A web application for stock profit/loss calculation and after-hours institutional reports.

**The application root is `sources/`, not the repo root** —— all npm commands must be executed under `sources/`.
(The repo root only contains `CLAUDE.md`, `README.md`, `docs/`, `.claude/`.)

Structural principles:

- Code related to a feature should be placed near that feature, do not scatter it into purely technical directories.
- `lib` / `utils` should only contain **truly shared** items, do not put feature-specific code in them just because the directory exists.
- Do not create a directory just because it exists in a template.

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

# 4. Agent Documentation

| File | Content |
| ---- | ---- |
| `docs/agent/PLAN.md` | Project planning and architectural direction |
| `docs/agent/SPEC.md` | Requirements and technical specifications |
| `docs/agent/PROGRESS.md` | Current status and next steps |
| `docs/agent/TASK.md` | Task tracking |
| `docs/agent/BUG_FIX.md` | Unresolved Bugs |
| `docs/agent/FIXED_BUG.md` | Historical record of fixed Bugs |
| `docs/agent/TASK_ARCHIVE.md` | Archive of completed tasks (`TASK.md` only keeps active and recurring tasks) |

The Agent state files are authoritative for project progress.

Other documentation paths: `docs/architecture/` (architecture), `docs/api/` (API), `docs/database/` (data models), `docs/development/` (development guide), `docs/deployment/` (deployment and operations).

## 4.1 Documentation Language

**Markdown produced by the Agent must always be written in English**: `docs/agent/`, `docs/architecture/`,
`docs/api/`, `docs/database/`, `docs/development/`, `docs/deployment/`, `.claude/skills/`.

The reason is token cost, these files are loaded in every session. Measured (2026-08-05, o200k_base):
The same bug record takes 930 tokens / 1416 characters in Chinese, but 383 tokens / 1482 characters in English ——
**For the same length, Chinese is 2.5 times more expensive**. After offsetting the more concise expression in Chinese, equivalent information is still about **1.6–1.8 times** more expensive.

**Exceptions to keeping Chinese:**

- `README.md` —— The facade of the project, readers are humans, not agents.
- **UI text and user-facing copy** —— Displayed to end users on the web application.
- Conversations with users —— According to global rules, still use Traditional Chinese (Taiwanese usage).

**Existing Chinese documents are not forced to be retroactively translated**: The one-time cost is about 300K tokens, and it takes about 20 sessions to break even.
Also, translation wears down the empirical data and reasoning from troubleshooting. Naturally, translate sections into English as you edit them.

The real token consumer is **bloated documents**, not language: `TASK.md` once reached 38.6K tokens,
90% of which was the history of completed tasks. Move completed ones to `TASK_ARCHIVE.md`,
`TASK.md` only keeps ongoing and recurring tasks —— Archiving saves twice as much as translating.

---

# 5. Startup Procedure

Must read before making major changes (these files are long, read on-demand to save context):

**Default required reading:**

- `docs/agent/PROGRESS.md` — **Only read the latest status at the end**, no need to read from the beginning
- `docs/agent/TASK.md`
- `docs/agent/BUG_FIX.md`

**Conditional reading:**

- `docs/agent/PLAN.md` / `docs/agent/SPEC.md` — Only read when modifying architecture or changing behavior
- `docs/agent/FIXED_BUG.md` — Only read when investigating history

Next, inspect the relevant project structure.

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

# 12. Versioning

Version numbers **must never contain a `v` prefix**, and only take the form `x.x.x` or `x.x.x-dev.x`. Keep these three places synchronized:

- `sources/src/version.ts` → `APP_VERSION` (frontend display)
- `sources/package.json` → `version` (along with `package-lock.json`)
- `README.md` → Version badge (line 3)
- `docs/CHANGELOG.md` → Version History

The version badge in the bottom left corner of the screen **only shows the version number itself**, no author, no prefix.
(`APP_AUTHOR` was removed in 0.3.7-dev.6.)

Production release (`main`) uses `x.x.x`, development release (`dev`) uses `x.x.x-dev.x`.
When deciding the next version number, incrementing `dev.N`, or merging to `main` for release, read the **`versioning` skill**.

---

# 13. Deployment Environments

Two independent Supabase projects, corresponding to git branches:

| Environment | Supabase Project | project-ref | Corresponding Branch |
| ---- | ---- | ---- | ---- |
| Production | Stock-Pnl-Web | `kxnxadaghidwumqsqneu` | `main` |
| Test | Stock-Pnl-Web-Dev | `wqetxuhncvfidqnklyew` | `dev` |

## 13.1 Branch Flow: dev First

**All changes must go to `dev` first, verify in the test environment, and only merge to `main` after confirming no issues.**
Do not develop or commit directly on `main`, even if it's just a documentation change.

```text
Change → commit to dev → push origin dev → verify in test environment
                                            ↓ confirm no issues
                                    merge to main → push → Production / Pages
```

Reason: `push` to `main` will trigger `.github/workflows/deploy.yml`,
GitHub Pages will go online immediately, with no room for regret. Going to dev first equals an extra verification step in an actual environment.

When merging to `main`, remove the `-dev.<N>` suffix to finalize the version according to the `versioning` skill, and finalize the docs/CHANGELOG.md version history.

**Keep both branches synchronized after merging** (`git push origin main:dev` fast-forward),
to avoid dev falling behind main and causing confusion in the next comparison baseline —— auditing the test environment uses `dev` as the baseline.

## 13.2 Supabase Operation Rules

- **By default, do not proactively deploy / change any Supabase environment.** Daily work consists of code changes on branches (`dev` or other branches).
- **Deploy / change environment only when explicitly requested by the user** (`supabase functions deploy`, `secrets set`, running schema in SQL Editor, creating bucket / cron etc. are all external operations and must be confirmed first).
- **Production environment is only modified on the `main` branch and with explicit instructions.**
- **Read-only queries are not considered changes and can be executed freely**: `supabase projects/functions list`, hitting REST / Storage via service key to check if tables and buckets exist, etc.

## 13.3 Supabase Practical Pitfalls

Actual pitfalls encountered (`--no-verify-jwt`, `db query --linked` cwd trap, `supabase link` global side effects,
auditing requires `functions download` file-by-file comparison, etc.) are documented in the **`supabase-ops` skill**, read before touching Supabase.

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
