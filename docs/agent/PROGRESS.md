# Progress Log (PROGRESS.md)

- Agent: Claude (scribe dispatch)
- Action: Task 94 — Replace both icons with a hand-authored SVG React component
- Status: **✅ SVG component BrandMark created; favicon.svg generated; 994 tests pass; build verified; not committed**
- Timestamp: 2026-08-12 18:55:20 Asia/Taipei

---

## 📅 Log: 2026-08-12 20:33:25 Asia/Taipei (Task 95: Measure the per-dispatch context delta from existing transcripts)

Task is now complete. Analysis tool `.claude/hooks/dispatch_delta.py` (220 lines, new) joins main-transcript `Agent` tool_use calls to subagent transcripts via `toolUseId` in `<session>/subagents/agent-*.meta.json`, measures cost side (dispatch prompt + report chars, i.e. context footprint) against benefit side (tool_result payloads main avoided pulling in), reports net per dispatch. Sample: all 42 dispatches across 11 sessions, project history.

**Finding: a dispatch removes net tokens from main.** Mean net removal +9,411 tokens, median +5,354; 36/42 (86%) net positive. Cost footprint stable across roles: mean prompt 746 + report 602 = ~1,348 tok per dispatch. Benefit by role (mean tokens removed, share positive): general-purpose +24,191 (1/1); Explore +21,726 (8/8); scout +8,126 (6/6); scribe +6,854 mean / +4,472 median (17/21); builder +811 mean / +346 median (3/5); antigravity-delegate +508 (1/1). Six net-negative dispatches are trivial: worst −725 tokens.

**Validation:** chars/4 against main's own measured `cache_read` growth across solo dispatch turns gives median ratio 1.12, so estimate is sound and conservative.

**Reconciliation with earlier finding (Task 95's brief):** routed sessions carry ~30k MORE main context than all-main sessions at same turn count, not less. This does NOT overturn the dispatch-cost measurement, because both are true: routing's context mechanism works and removes ~9.4k tokens per dispatch (5.7% of total project spend on dispatching is $38.85 return on $681.90 cost). But the routed-vs-all-main ~30k gap is 3x larger, so it cannot be caused by dispatching — it is selection (routed sessions are harder). Cost-wise, routing is worth keeping at ~6% lever, but session length is the dominant term (quadratic in turns; capping sessions at 100 turns → −44.5% cost). Three forward-carrying conclusions: (1) scout role is best-value (12x return, 6/6 positive), validates route skill emphasis; (2) Explore/general-purpose remove most context (22–24k each) but route skill bans them for model cost (Opus vs Sonnet), not context; (3) builder's context saving is near-zero — route for model cost only, not context.

No sources/ touched. No version bump. This is analysis tooling with no production impact.

## 📅 Log: 2026-08-12 20:08:20 Asia/Taipei (Release 0.7.14)

Released 0.7.14 to `main`; GitHub Pages deployed successfully (Actions run `31594918544`). `dev` and `main` are both at `3f0eaea` — the merge was a fast-forward, so no separate branch-sync push was needed.

Four commits: `551ed71` feat(ui) SVG brand mark · `23399da` fix(agents) scribe truncation · `c3744b0` docs(agent) records + cost correction · `3f0eaea` chore(release) 0.7.14.

Version synced across `version.ts`, `package.json`, `package-lock.json`, `README.md` badge, `CHANGELOG.md`.

Gate before release: 63 test files / 994 tests passed, `npx tsc -b --noEmit` clean, `npm run build` exit 0. Post-deploy smoke on the live site: index references `./favicon.svg` (200, 890B); `favicon.svg` serves 200 / 1207B containing `#6366f1`.

First GitHub Release under the policy in the `versioning` skill (`0.7.13` and earlier deliberately not backfilled).

Not shipped: `docs/picture/icon_v2.png` remains untracked. Nothing in the shipped code derives from it — the final mark is a hand-authored SVG — and it is 4.9 MB in a public repo. Left for the user to decide whether to commit or delete.

No Supabase or Edge Function change.

