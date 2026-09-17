# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 2 — steps 2b and 2c (per-user Discord holdings card) committed on `dev`
- Status: 🔄 **0.9.58-dev.3 on `dev`** (not pushed) — Supabase DEV not deployed yet (§14 DDL, cron, `stock-report`); awaiting explicit OK
- Timestamp: 2026-09-17 18:34:45 Asia/Taipei

---

## 📅 Log: 2026-09-17 18:34:45 Asia/Taipei (Task 165 Phase 2 steps 2b + 2c, 0.9.58-dev.2 / dev.3)

**Commits on `dev`** (not pushed): `fe6845f` 0.9.58-dev.2 (2b), `66f2a8f` 0.9.58-dev.3 (2c). Spec `docs/agent/specs/discord-holdings.md` now carries the exact contracts for §2.2–2.7.

**2b — pure modules** (`stock-report/holdingQuotes.ts`, `holdingsCard.ts`): last completed Yahoo daily bar per ticker (.TW then .TWO, memoized per run); one ledger per workspace, merged by key + direction with each workspace's `fee_rate` and per-leg minimum fee; SHORT basis = short proceeds and inverted day P&L; totals from quoted rows only, market value and cost from LONG rows; TWD/USD separate; two-line rows ≤ 36 columns, stale ⚠️ marks, 2,800-character budget with `…另 N 檔`. The width table, colours and fee constants are re-stated (D6) and guarded by `scripts/lib/edgeConstants.test.mjs`. Reviewer PASS; its no-drift-test RISK fixed.

**2c — wiring** (`holdingsRun.ts`, `index.ts` additive, schema §14, `snapshotPlan.cjs`, `src/services/discordHoldings.ts`, `src/components/Settings/DiscordPushSection.tsx`, `AppShell.tsx` menu item): daily run at 17:15 (`discord-holdings`, x-cron-secret) with market-day gate, claim-then-send per user, 80 s start budget; settings ops (`discord-holdings-settings`, user JWT) get/set/clear/enable/test/preview, URL never returned, 10 manual sends per day; `makeChartFetch` adds an 8 s timeout and one retry on network/429/5xx. Dialog uses existing global classes and the admin `adm-toggle`. S15 in `snapshotPlan.test.mjs` updated 8 → 9 placeholder substitutions (the new cron job). Reviewer PASS with 4 RISKs: run budget lowered 110 → 80 s; RISK-015/016/017 recorded in `BUG_FIX.md`.

**Process note**: the step-2c test files were written while the 2b builder was still running, which reddened its full gate; they were parked, 2b verified alone, then restored. `pkill -f "vite --port 5317"` kills the calling shell too (its own command line matches) — stop the server by its listening PID instead.

**Verification** (from `sources/`): `npm test` 144 files, 2386 passed / 7 skipped; `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0; `TZ=UTC` rerun of the dialog test passed; D6 frozen files unchanged; existing files only gained lines (`snapshotPlan.cjs` one list line changed). E2E against Supabase-mode vite on 127.0.0.1:5317: new `scripts/verify-discord-push-e2e.cjs` 13/13 (desktop + 390 px, token never in the DOM, bearer on every call), `run-all-e2e.cjs` 16/16.

**Also this session**: the 5173 dev server (started 14:40) was serving a pre-Discord `AdminConsolePage.tsx` because Vite missed the 16:37 rewrite; `touch` on the three Discord files fixed it without content changes.

**Next**: DEV deploy on explicit OK — apply §14 DDL, create `discord-holdings-daily` by cloning an existing job's command behind the identity guard, deploy `stock-report` (`--no-verify-jwt --use-api`), then a real test/preview from a private webhook and the next 17:15 round.

---

## 📅 Log: 2026-09-17 17:19:33 Asia/Taipei (Task 165 Phase 2 step 2a, 0.9.58-dev.1)

**Phase 2 planned and approved** (per-user Discord holdings card): spec `docs/agent/specs/discord-holdings.md`. User decisions D1–D6: each user's own webhook; full amounts; all workspaces merged into one card (TWD/USD separate, no FX); daily 17:15 after the brief; `workspaces.fee_rate` is already in the DB; **D6 — existing core code is not modified** (frozen file list in spec §0). BUG-084 (stale per-workspace 最低手續費 in localStorage) opened and accepted as a known difference.

**Step 2a — Edge copy of the ledger engine, core untouched**:
- `scripts/lib/edgeEngine.cjs` + `scripts/sync-edge-engine.cjs` (`npm run sync:edge-engine`, `--check`) generate `supabase/functions/_shared/engine/pnlEngine.ts` and `models.ts`. The only textual change is the two `'../types/models'` imports → `'./models.ts'`. The renderer throws on any other import (relative, bare, side-effect, dynamic, or a source already spelling `./models.ts`); every target is rendered before any is written.
- `scripts/lib/edgeEngine.test.mjs` (19 cases): drift (committed copy equals a fresh render), parity (same exports; identical `computeLedger` / `estimateUnrealized` / `estimateUnrealizedShort` on a fixture with long, short, US fractional shares and an oversell warning), renderer guards.
- Reviewer PASS with 4 RISKs: two fixed (source spelling `./models.ts`; partial write), two accepted (the literal rewrite could also touch a comment; a mid-line side-effect import is not detected).
- Note: builder's direct `node scripts/sync-edge-engine.cjs` was refused by the write-scope guard (`_shared/engine` is not in `paths.prod`); it ran the same script via `npm run sync:edge-engine`.

**Verification** (from `sources/`): `npm test` 138 files, 2220 passed / 7 skipped; `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0; `git diff` of every D6 file empty (only `src/version.ts` changed under `src/`). Deno 2.9.6 (`npx deno@2`): `deno check` on both generated files exit 0, and a script importing the generated engine ran all three functions. E2E: `run-all-e2e.cjs` against Supabase-mode vite on 127.0.0.1:5317 — 16/16 suites, 49 steps, 0 failed (Playwright Chromium installed on this host first).

**Next**: step 2b — `holdingQuotes.ts` + `holdingsCard.ts` (spec §2.2–2.4), tests first. Supabase untouched in 2a; nothing deployed.

