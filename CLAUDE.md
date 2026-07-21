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

Claude may implement code when necessary, but the primary responsibility is to ensure that the project remains correct, consistent, maintainable, testable, and aligned with the specification.

---

# 2. Persistent Agent Memory

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

# 3. Balanced Repository Structure

The repository must use a flexible structure that supports different project types without forcing unnecessary directories.

The preferred top-level structure is:

```text
project-root/
├── CLAUDE.md
├── GEMINI.md
├── AGENTS.md                    # Optional shared Agent rules
├── README.md
│
├── docs/
│   ├── agent/                   # Persistent Agent memory
│   │   ├── PLAN.md
│   │   ├── SPEC.md
│   │   ├── PROGRESS.md
│   │   ├── TASK.md
│   │   ├── BUG_FIX.md
│   │   └── FIXED_BUG.md
│   │
│   ├── architecture/            # Architecture documentation
│   ├── api/                     # API documentation
│   ├── database/                # Database documentation
│   ├── development/             # Development guides
│   └── deployment/              # Deployment documentation
│
├── apps/                        # Optional multi-application workspace
│   ├── web/                     # Frontend application
│   ├── api/                     # API application
│   └── admin/                   # Optional admin application
│
├── packages/                    # Optional shared packages
│   ├── ui/
│   ├── config/
│   ├── types/
│   └── utils/
│
├── src/                         # Single-application source code
│
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── supabase/                    # Optional Supabase project
│   ├── migrations/
│   ├── functions/
│   ├── seed.sql
│   └── config.toml
│
├── docker/
│   ├── Dockerfile
│   ├── Dockerfile.dev
│   ├── Dockerfile.test
│   └── docker-compose.yml
│
├── scripts/
├── config/
├── infra/                       # Optional infrastructure
│   ├── terraform/
│   ├── kubernetes/
│   └── cloud/
│
├── .env.example
├── .gitignore
└── .dockerignore
```

This is a flexible structure, not a requirement to create every directory.

Do not create empty directories merely to follow this template.

---

# 4. Project Structure Selection Rules

Choose the simplest structure that accurately represents the project.

## 4.1 Single Frontend Application

For a Next.js or React project:

```text
project-root/
├── CLAUDE.md
├── GEMINI.md
├── docs/
│   └── agent/
├── src/
│   ├── app/                     # Next.js App Router, if applicable
│   ├── components/
│   ├── features/
│   ├── lib/
│   ├── hooks/
│   ├── services/
│   ├── types/
│   └── styles/
├── public/
├── tests/
├── docker/
└── package.json
```

For a React/Vite application, use the framework's conventional entry point:

```text
src/
├── app/
├── components/
├── features/
├── lib/
├── services/
├── hooks/
├── types/
└── styles/
```

Do not force Next.js-specific directories into a non-Next.js project.

---

## 4.2 Frontend + API + Backend

For a full-stack project:

```text
project-root/
├── CLAUDE.md
├── GEMINI.md
├── docs/
│   └── agent/
│
├── apps/
│   ├── web/
│   │   ├── src/
│   │   ├── public/
│   │   └── package.json
│   │
│   └── api/
│       ├── src/
│       ├── tests/
│       └── package.json
│
├── packages/
│   ├── types/
│   ├── ui/
│   └── config/
│
├── tests/
│   └── e2e/
│
├── docker/
└── package.json
```

Use `apps/` when there are genuinely multiple independently runnable applications.

Do not use `apps/` simply because a project has multiple source folders.

---

## 4.3 Frontend + Supabase

For a frontend using Supabase:

```text
project-root/
├── CLAUDE.md
├── GEMINI.md
├── docs/
│   ├── agent/
│   └── database/
│
├── src/
│   ├── components/
│   ├── features/
│   ├── lib/
│   │   └── supabase/
│   ├── services/
│   └── types/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── seed.sql
│   └── config.toml
│
├── tests/
└── docker/
```

Supabase-specific database changes must be kept under:

```text
supabase/migrations/
```

Supabase Edge Functions must be kept under:

```text
supabase/functions/
```

Supabase client initialization should normally be kept under:

```text
src/lib/supabase/
```

Do not scatter Supabase configuration across unrelated source directories.

---

## 4.4 Frontend + API + Supabase

For a project containing frontend, API, and Supabase:

```text
project-root/
├── CLAUDE.md
├── GEMINI.md
├── docs/
│   ├── agent/
│   ├── architecture/
│   ├── api/
│   └── database/
│
├── apps/
│   ├── web/
│   │   └── src/
│   │
│   └── api/
│       └── src/
│
├── packages/
│   ├── types/
│   └── config/
│
├── supabase/
│   ├── migrations/
│   ├── functions/
│   ├── seed.sql
│   └── config.toml
│
├── tests/
│   └── e2e/
│
└── docker/
```

The responsibility boundaries should be:

```text
apps/web/
    ↓
apps/api/
    ↓
supabase/
```

However, the frontend may directly access Supabase when that is explicitly part of the architecture.

Do not introduce an API layer merely to make the directory tree look more complex.

---

# 5. Source Code Organization

Prefer feature-oriented organization over purely technical organization.

Avoid:

```text
src/
├── controllers/
├── services/
├── repositories/
├── models/
└── utils/
```

when the project has multiple business domains.

Prefer:

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

Use shared directories only for genuinely shared code.

Do not place feature-specific code into `shared`, `utils`, or `lib` merely because those directories exist.

---

# 6. Docker and Container Files

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

The Docker build context should normally remain the repository root:

```bash
docker build -f docker/Dockerfile .
```

Use root-level Docker files only when required by a platform or deployment tool.

If multiple services exist:

```text
docker/
├── web/
│   └── Dockerfile
├── api/
│   └── Dockerfile
└── docker-compose.yml
```

Do not duplicate Dockerfiles unnecessarily.

---

# 7. Documentation Paths

Use:

```text
docs/agent/
```

for Agent state and handoff.

Use:

```text
docs/architecture/
```

for architecture documents.

Use:

```text
docs/api/
```

for API documentation.

Use:

```text
docs/database/
```

for database and data model documentation.

Use:

```text
docs/development/
```

for development setup and contribution guides.

Use:

```text
docs/deployment/
```

for deployment and operational documentation.

The Agent state files are authoritative for project progress.

---

# 8. Agent Documents

## PLAN.md

Project planning and architectural direction.

## SPEC.md

Project requirements and technical specifications.

## PROGRESS.md

Current project state and next steps.

## TASK.md

Task tracking.

## BUG_FIX.md

Open and unresolved Bugs.

## FIXED_BUG.md

Historical record of fixed Bugs.

---

# 9. Mandatory Startup Procedure

Before making significant changes, Claude must read:

```text
docs/agent/PLAN.md
docs/agent/SPEC.md
docs/agent/PROGRESS.md
docs/agent/TASK.md
docs/agent/BUG_FIX.md
docs/agent/FIXED_BUG.md
```

Then inspect the relevant project structure.

Do not assume that the current conversation contains the complete project state.

---

# 10. Standard Workflow

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

# 11. Planning and Delegation

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

- Objective
- Scope
- Allowed files or directories
- Constraints
- Acceptance criteria
- Verification method

---

# 12. Review Procedure

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

# 13. Bug Management

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

# 14. Timestamp Rules

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

# 15. Work Completion Checklist

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

# 16. Core Principle

Use the simplest repository structure that can accurately represent the system.

The structure should be:

```text
Simple enough for humans
        +
Predictable enough for Agents
        +
Flexible enough for multiple architectures
        +
Explicit enough for deployment and testing
```

Do not create directories because a template contains them.

Create directories because the project has a real responsibility that needs to be represented.
