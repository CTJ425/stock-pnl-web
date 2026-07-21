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

Gemini should not make major architectural decisions without documenting the decision and requesting review from the primary Decision Agent.

---

# 2. Persistent Agent Memory

All important work records must be stored in:

```text
docs/agent/
```

The next Agent must be able to continue work by reading:

```text
docs/agent/
```

Important information must not exist only in chat history, terminal output, temporary notes, or Agent memory.

---

# 3. Balanced Repository Structure

The repository may contain the following structure:

```text
project-root/
├── CLAUDE.md
├── GEMINI.md
├── AGENTS.md                    # Optional shared Agent rules
├── README.md
│
├── docs/
│   ├── agent/
│   │   ├── PLAN.md
│   │   ├── SPEC.md
│   │   ├── PROGRESS.md
│   │   ├── TASK.md
│   │   ├── BUG_FIX.md
│   │   └── FIXED_BUG.md
│   ├── architecture/
│   ├── api/
│   ├── database/
│   ├── development/
│   └── deployment/
│
├── apps/                        # Optional multi-application structure
│   ├── web/
│   ├── api/
│   └── admin/
│
├── packages/                    # Optional shared packages
│   ├── ui/
│   ├── config/
│   ├── types/
│   └── utils/
│
├── src/                         # Single-application source code
├── tests/
├── supabase/                    # Optional Supabase project
├── docker/
├── scripts/
├── config/
└── infra/
```

This is a flexible structure.

Do not create every directory unless the project actually needs it.

---

# 4. Startup Procedure

Before starting work, read:

```text
docs/agent/PLAN.md
docs/agent/SPEC.md
docs/agent/PROGRESS.md
docs/agent/TASK.md
docs/agent/BUG_FIX.md
docs/agent/FIXED_BUG.md
```

Then inspect the relevant directory.

Determine:

1. What is the current project state?
2. What task should be performed?
3. What is the expected result?
4. What files and directories may be changed?
5. What constraints exist?
6. How will the result be verified?

Do not begin implementation before understanding the task.

---

# 5. Project Structure Rules

## 5.1 Single Frontend Application

For Next.js or React:

```text
src/
├── app/                         # Next.js App Router, if applicable
├── components/
├── features/
├── lib/
├── hooks/
├── services/
├── types/
└── styles/
```

For Next.js:

- Follow the framework's conventions.
- Keep route-specific files under `src/app/`.
- Keep reusable UI under `src/components/`.
- Keep business features under `src/features/`.
- Keep integrations and clients under `src/lib/` or `src/services/`.

For React/Vite:

- Do not create Next.js-specific routing structures.
- Use the existing framework's conventions.

---

## 5.2 Frontend + API + Backend

When the repository contains multiple independently runnable applications:

```text
apps/
├── web/
│   ├── src/
│   ├── public/
│   └── package.json
│
└── api/
    ├── src/
    ├── tests/
    └── package.json
```

Shared code may be placed under:

```text
packages/
├── types/
├── ui/
├── config/
└── utils/
```

Do not place application-specific code into `packages/`.

---

## 5.3 Frontend + Supabase

Supabase-specific files belong under:

```text
supabase/
├── migrations/
├── functions/
├── seed.sql
└── config.toml
```

Supabase client code normally belongs under:

```text
src/lib/supabase/
```

or, in a multi-app project:

```text
apps/web/src/lib/supabase/
```

Database migrations must remain under:

```text
supabase/migrations/
```

Edge Functions must remain under:

```text
supabase/functions/
```

Do not scatter Supabase database or function code across unrelated source directories.

---

## 5.4 Frontend + API + Supabase

A common structure is:

```text
apps/
├── web/
│   └── src/
│
└── api/
    └── src/

packages/
└── types/

supabase/
├── migrations/
├── functions/
├── seed.sql
└── config.toml
```

Use the architecture defined by `SPEC.md`.

Do not introduce an API layer only because the project also uses Supabase.

---

# 6. Source Code Organization

Prefer feature-oriented organization.

Avoid spreading one feature across unrelated global directories when possible.

Instead of:

```text
src/
├── controllers/
├── services/
├── repositories/
└── models/
```

prefer:

```text
src/
├── features/
│   ├── auth/
│   │   ├── components/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── types.ts
│   │   └── index.ts
│   │
│   └── users/
│       ├── components/
│       ├── services/
│       ├── hooks/
│       ├── types.ts
│       └── index.ts
│
├── components/
├── lib/
├── services/
├── hooks/
└── types/
```

Shared directories are for genuinely shared code.

Do not move feature-specific code into `shared`, `utils`, or `lib` without a clear reason.

---

# 7. Docker Files

Docker files should normally be placed under:

```text
docker/
```

Recommended:

```text
docker/
├── Dockerfile
├── Dockerfile.dev
├── Dockerfile.test
└── docker-compose.yml
```

For multiple services:

```text
docker/
├── web/
│   └── Dockerfile
├── api/
│   └── Dockerfile
└── docker-compose.yml
```

The Docker build context should normally remain the repository root:

```bash
docker build -f docker/Dockerfile .
```

Do not duplicate Dockerfiles unnecessarily.

---

# 8. Documentation Paths

Use:

```text
docs/agent/
```

for persistent Agent state.

Use:

```text
docs/architecture/
```

for architecture documentation.

Use:

```text
docs/api/
```

for API documentation.

Use:

```text
docs/database/
```

for database documentation.

Use:

```text
docs/development/
```

for development setup.

Use:

```text
docs/deployment/
```

for deployment documentation.

---

# 9. Task Execution

The standard Worker workflow is:

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

# 10. Task Scope

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

If additional work is discovered, record it as a new Task or Bug.

---

# 11. Implementation Rules

When implementing:

- Follow `SPEC.md`.
- Follow the existing architecture.
- Keep changes focused.
- Place files in the correct project area.
- Avoid unrelated refactoring.
- Avoid unnecessary dependencies.
- Preserve backward compatibility when required.
- Do not silently change public behavior.
- Do not remove existing functionality without authorization.
- Do not create directories simply because they appear in a template.

If the specification is unclear, do not guess about major behavior.

Record the uncertainty and request a decision.

---

# 12. Testing

After implementation, run the appropriate validation:

```text
Unit Tests
Integration Tests
Build
Lint
Type Check
Static Analysis
Manual Verification
```

Every completed task should record:

```markdown
### Verification

- Command:
- Result:
- Timestamp:
```

---

# 13. Task Completion

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

# 14. Bug Management

When a Bug is discovered, create a Bug record in:

```text
docs/agent/BUG_FIX.md
```

When a Bug is fixed:

1. Record the root cause.
2. Record the actual fix.
3. Record changed files.
4. Run verification.
5. Record the completed Bug in:
   `docs/agent/FIXED_BUG.md`
6. Update:
   `docs/agent/PROGRESS.md`

---

# 15. Blocked Work

If work cannot continue, update:

```text
docs/agent/PROGRESS.md
```

with:

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

# 16. Major Architectural Changes

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

# 17. Timestamp Rules

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

# 18. Work Completion Checklist

Before finishing work:

- [ ] Task was understood
- [ ] Specification was checked
- [ ] Implementation is complete
- [ ] Files are in the correct directories
- [ ] Tests were executed
- [ ] Build was checked when applicable
- [ ] Lint / type checking was performed when applicable
- [ ] `TASK.md` was updated
- [ ] `PROGRESS.md` was updated
- [ ] New Bugs were recorded
- [ ] Fixed Bugs were recorded
- [ ] All records contain timestamps
- [ ] All records identify the Agent
- [ ] Remaining limitations are documented
- [ ] Next steps are documented
- [ ] The next Agent can continue without relying on chat history

---

# 19. Handoff Requirements

Before stopping work, leave a clear handoff.

The handoff must answer:

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

# 20. Core Principle

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

Use the simplest repository structure that accurately represents the project.

Do not create directories because a template contains them.

Create directories because the project has a real responsibility that needs to be represented.
