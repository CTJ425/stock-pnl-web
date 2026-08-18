# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: Task 113 — TWSE TWT38U Foreign Investors Top 50 Net Buy/Sell implementation & verification, shipped as 0.7.19-dev.1
- Status: **✅ IMPLEMENTED & VERIFIED, deployed to dev branch as 0.7.19-dev.1**
- Timestamp: 2026-08-18 11:45:16 Asia/Taipei

---

## 📅 Log: 2026-08-18 11:45:16 Asia/Taipei (Task 113: TWSE TWT38U Foreign Investors Top 50 Net Buy/Sell implementation & verification)

1. **Edge Function & Top 50 Snapshot Publisher (`twForeignTop.ts`)**:
   - Parser for TWSE TWT38U (外資及陸資買賣超彙總表) endpoint; `FOREIGN_TOP_SCHEMA` validates structure and fingerprint gates duplicate fetches.
   - `syncForeignTop` action called from `runGeneratePhaseChips` (existing generate-chips phase, no new action or cron).
   - Publishes Top 50 net-buy and net-sell snapshot to `market/foreign_top50.json` in the `reports` bucket.
2. **Frontend: `ForeignTopSection` + Proxy Service**:
   - New component `ForeignTopSection.tsx` mounted in `TwMarketSection` under **總體經濟 > 台股**.
   - Proxy service `foreignTopProxy.ts` with boundary stub in tests (`TwMarketSection.test.tsx`).
   - Tables: Buy/Sell tabs, lots/shares toggle, block trade indicator.
3. **Testing & Verification**:
   - 68 test files / 980 vitest tests passed (was 66 / 963); 12 new Edge tests (`twForeignTop.test.ts`), 4 new Frontend tests (`ForeignTopSection.test.tsx`).
   - Build (`tsc -b && vite build`) and Edge typecheck (`tsc -p tsconfig.edge.json`) 0 errors.
   - `oxlint` 0 errors.
   - Live-data verified 6 trading days (20251114–20260817): matched independent reference implementation on all 600 ranked rows.
   - Reviewer verdict: **PASS**; one risk (unmocked proxy boundary) resolved by test stub.
4. **Design notes**:
   - TWT38U 146 KB chosen over T86 despite equivalent data: `T86` with `selectType=ALLBUT0999` broke top-50 ranking on 4 of 16 days (warrants broke into top 50), while TWT38U is both the exact source and cheaper than T86 (194 KB). `generate-chips` retriggers (t86/margin/borrow overlap 16:00–17:30), so no hole from probe retirement.
   - Parser sorts locally, does not rely on TWSE row order (PROPOSED draft's §2.3 claim verified but deliberately not relied on).
   - Probe suite stays at 7 sources (no dedicated `twt38u` source, no new cron, no Admin ProbeWarRoom card).

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
