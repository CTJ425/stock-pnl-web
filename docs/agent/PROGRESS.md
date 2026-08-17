# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 112 — Backfill all 84 GitHub Releases from CHANGELOG and establish automated release sync workflow
- Status: **✅ All 84 historical GitHub Releases successfully published and synchronized; automated release CI workflow deployed**
- Timestamp: 2026-08-17 18:03:00 Asia/Taipei

---

## 📅 Log: 2026-08-17 18:03:00 Asia/Taipei (Task 112: Full GitHub Releases backfill & automated workflow sync)

1. **Full Backfill of GitHub Releases (`sources/scripts/sync-github-releases.cjs`)**:
   - Created sync utility parsing `docs/agent/CHANGELOG.md` across all 84 versions (`0.2` through `0.7.18`).
   - Matched each historical version to its exact release commit SHA in git history.
   - Synchronized all 84 releases to GitHub Releases with titles and detailed markdown release notes.
2. **Automated CI/CD Workflow (`.github/workflows/release.yml`)**:
   - Configured GitHub Actions workflow triggering on push to `main` (and `workflow_dispatch`).
   - Automatically synchronizes GitHub Releases whenever a new version is pushed to `main`.
   - Added `release:sync` and `release:sync:all` npm scripts in `sources/package.json`.
3. **Skill & Documentation Sync**:
   - Updated `.claude/skills/versioning/SKILL.md`, `.gemini/skills/versioning/SKILL.md`, `.claude/skills/ship/SKILL.md`, and `.gemini/skills/ship/SKILL.md`.
   - Full Vitest suite: 66 test files / 963 tests passed 100%.
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.

## 📅 Log: 2026-08-17 16:55:00 Asia/Taipei (Task 111: Retune T86 probe active window to 16:00–17:00, sync UI & docs, release 0.7.18)

1. **T86 Probe Window Optimization (`sourceProbePlan.ts`)**:
   - Narrowed `DAILY_WINDOWS.t86` from `15:30 – 17:30` to **`16:00 – 17:00`** (every 5 mins, 3 hits to retire).
   - Removed 15:30–16:00 probe attempts where TWSE T86 data is never available, eliminating 6 daily no-op probes.
2. **Admin UI & Documentation Sync**:
   - Updated `ProbeWarRoom.tsx` card window label to `16:00–17:00`.
   - Updated `MechanismGuide.tsx` description table to `16:00 – 17:00`.
   - Updated `schema.sql` commentary.
3. **Testing & Version Release (0.7.18)**:
   - Updated unit tests in `sourceProbePlan.test.ts`.
   - Full Vitest suite: 66 test files / 963 tests passed 100%.
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.
   - Synchronized `version.ts`, `package.json`, `package-lock.json`, `README.md`, and `CHANGELOG.md` to `0.7.18`.
