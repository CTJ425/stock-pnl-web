# Progress Log (PROGRESS.md)

- Agent: Claude (scribe dispatch)
- Action: Task 94 — Replace both icons with a hand-authored SVG React component
- Status: **✅ SVG component BrandMark created; favicon.svg generated; 994 tests pass; build verified; not committed**
- Timestamp: 2026-08-12 18:55:20 Asia/Taipei

---

## 📅 Log: 2026-08-12 20:08:20 Asia/Taipei (Release 0.7.14)

Released 0.7.14 to `main`; GitHub Pages deployed successfully (Actions run `31594918544`). `dev` and `main` are both at `3f0eaea` — the merge was a fast-forward, so no separate branch-sync push was needed.

Four commits: `551ed71` feat(ui) SVG brand mark · `23399da` fix(agents) scribe truncation · `c3744b0` docs(agent) records + cost correction · `3f0eaea` chore(release) 0.7.14.

Version synced across `version.ts`, `package.json`, `package-lock.json`, `README.md` badge, `CHANGELOG.md`.

Gate before release: 63 test files / 994 tests passed, `npx tsc -b --noEmit` clean, `npm run build` exit 0. Post-deploy smoke on the live site: index references `./favicon.svg` (200, 890B); `favicon.svg` serves 200 / 1207B containing `#6366f1`.

First GitHub Release under the policy in the `versioning` skill (`0.7.13` and earlier deliberately not backfilled).

Not shipped: `docs/picture/icon_v2.png` remains untracked. Nothing in the shipped code derives from it — the final mark is a hand-authored SVG — and it is 4.9 MB in a public repo. Left for the user to decide whether to commit or delete.

No Supabase or Edge Function change.

## 📅 Log: 2026-08-12 18:55:20 Asia/Taipei (Task 94: Replace both icons with a hand-authored SVG React component)

Supersedes Tasks 92 and 93 — the PNG icon pipeline they built is now deleted.

**Files changed:**
- `sources/src/components/BrandMark.tsx` (new) — prop-free `BrandMark` export; 30×30 `<svg viewBox="0 0 96 96">`, glow circle + three ascending rounded bars + up arrow; `role="img" aria-label="股票小幫手"`. Gradient ids come from React `useId()` so two instances cannot collide.
- `sources/src/index.css` — four token aliases added once in the dark `:root` block: `--svg-main-1: var(--accent-strong)`, `--svg-accent: var(--accent-2)`, `--stock-up-bright: var(--up)`, `--svg-bg-glow: var(--bg-glow-a)`. They resolve through `var()`, so they follow every theme with no duplication. Also deleted the orphaned `.brand-mark` rule (old lines 165-174).
- `sources/src/components/AppShell.tsx`, `sources/src/components/Auth/AuthPage.tsx` — the `<span className="brand-mark"><img/></span>` wrapper replaced by `<BrandMark />`; PNG import removed from each.
- `sources/public/favicon.svg` (new) — same artwork with literals `#6366f1`, `#22d3ee`, `#ff4a5a`, `rgba(99, 102, 241, 0.16)`.
- `sources/index.html:5` — `<link rel="icon" type="image/svg+xml" href="./favicon.svg" />`.
- Deleted: `sources/public/favicon.png`, `sources/src/assets/brand-mark.png`, and the emptied `sources/src/assets/` directory.

**Two findings worth keeping:**
1. A favicon cannot use the app's CSS custom properties — it renders in an isolated context where `var(--…)` does not resolve. The artwork therefore exists twice on purpose: the React component keeps `var()` and tracks the theme; `favicon.svg` bakes in literals. That duplication is deliberate, not drift.
2. React 19.2.7's `useId()` is safe inside SVG `url(#…)`. Verified in a real browser, not assumed — ids render as `_r_0_-p1/-p2/-p3`, plain ASCII, no `:` or `«»`.

**Verification, all passed:** `npx tsc -b --noEmit` exit 0; `npm test -- --run` → 63 files / 994 tests / 0 failed; `npm run build` exit 0; `dist/favicon.svg` 1.2 KB; `npm run lint` exit 0 (4 pre-existing warnings in untouched files); `grep -rn "brand-mark\|brandMark" src/ index.html` → zero hits. Plus Playwright against `npm run dev`: the mark renders in AuthPage, all three `url(#…)` refs resolved, stop colours returned `rgb(79,70,229)` / `rgb(34,211,238)` / `rgb(220,47,63)` — the light-theme values, proving the alias chain tracks the theme.

**Routing:** lane 1 — `scout` ×1 (proved all four CSS variables were undefined; that finding shaped the spec) → `builder` ×1 → main-session browser verification → `scribe`. No reviewer. No version bump, no deploy, not committed.

**Session routing cost** (`python3 .claude/hooks/routing_audit.py`, session 7b928169, covering Tasks 92–94) — main claude-opus-5 104 turns $12.28 (80.9%); builder claude-sonnet-5 4 runs $1.57 (10.4%); scribe claude-haiku-4.5 3 runs $0.70 (4.6%); scout claude-haiku-4.5 3 runs $0.63 (4.1%). Total ≈ $15.18; main averaged 66,700 tokens context = $0.118/turn. Component split: cache_write 41.0%, cache_read 30.3%, output 28.7% (whole session including subagents, $15.18 snapshot). All eight images read into the main session came to 16,069 tokens total (high-resolution cap is 4,784 tokens per image; the small previews are 87–1,365 each). At the 1-hour cache TTL that is $0.16 to write once and about $0.72 re-read over the remaining turns — $0.88, which is 5.0% of main's $17.51 and 4.2% of the session's $20.87. Images were not the driver. Main's $17.51 splits almost evenly three ways: output $5.80 (33.1%), cache read $5.85 (33.4%), cache write $5.86 (33.5%) (main only, at session's end, on $17.51). Cache write is high for two reasons that have nothing to do with images: every turn's new content is written to cache (585,535 tokens over 138 turns ≈ 4,243 written per turn), and this session ran a 1-hour cache TTL, which prices writes at 2× input instead of 1.25×. Lesson: output is a third of main's cost and most of it is thinking tokens, so `effort` is a cost lever that this project has never tuned. The earlier "image bytes, not turns" conclusion is withdrawn.

