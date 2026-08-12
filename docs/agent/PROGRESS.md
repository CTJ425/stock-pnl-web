# Progress Log (PROGRESS.md)

- Agent: Claude (scribe dispatch)
- Action: Task 94 — Replace both icons with a hand-authored SVG React component
- Status: **✅ SVG component BrandMark created; favicon.svg generated; 994 tests pass; build verified; not committed**
- Timestamp: 2026-08-12 18:55:20 Asia/Taipei

---

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

## 📅 Log: 2026-08-12 15:14:58 Asia/Taipei (Task 93: Switch app icon to icon_v2, replace in-app brand mark)

Supersedes Task 92. Regenerated favicon from `docs/picture/icon_v2.png` (2592×1662) using Pillow 11.3.0.
Key finding: source image has fully opaque alpha channel (255 on all 4.3M pixels); background keyed by
colour using alpha-extraction rule `alpha = clip(max((sat-20)/30, (215-mx)/30), 0, 1)` (keeps saturated
or dark pixels; checkerboard greys + white key to 0; grey wedge survives via darkness term). Bbox of
`alpha > 0.25` is `(887, 373, 1727, 1293)`, squared and padded 8% → crop `(810, 336, 1803, 1329)`, side 993.
Downscaled with `Image.LANCZOS`.

**Files changed:**
- `sources/public/favicon.png`: 256×256 RGBA, 42.4 KB (regenerated from icon_v2.png)
- `sources/src/assets/brand-mark.png`: 96×96 RGBA, 11.0 KB (new; extracted and downscaled from same source)
- `sources/src/components/AppShell.tsx`: navbar brand `<TrendingUp size={17} />` in `<span className="brand-mark">` replaced with `<img src={brandMark} width={17} height={17} alt="股票小幫手" />`; added `import brandMark from '../assets/brand-mark.png'`; lucide-react `TrendingUp` removed (no other use in file)
- `sources/src/components/Auth/AuthPage.tsx`: same swap in login card brand; added `import brandMark from '../../assets/brand-mark.png'`; `TrendingUp` lucide import removed
- `sources/index.html` line 5: unchanged — still `<link rel="icon" type="image/png" href="./favicon.png" />`; only the file it points to changed

**Verification (5/5 pass):** Assets read back `(256,256) RGBA (96,96) RGBA` with alpha extrema `(0, 255)`; 
`npx tsc -b --noEmit` exit 0; `npm test -- --run` → 63 test files, 994 tests, all passed; 
`npm run build` exit 0; `dist/favicon.png` present at 42.4 KB. Composited both over dark navy and 
visually confirmed clean transparency (no checkerboard residue).

**No review dispatched** — verification is the gate. No money, auth, persistence, schema, API, 
background job, or price surface touched.

No version bump, no deploy, no Supabase change, not committed.

### Routing cost (session 7b928169, both Task 92 and Task 93)

| Role | Dispatches | USD | Share |
| --- | ---: | ---: | ---: |
| main (claude-opus-5) | 60 turns | 4.71 | 70% |
| builder (claude-sonnet-5) | 3 | 1.05 | 16.8% |
| scribe (claude-haiku-4-5) | 2 | 0.47 | 7.5% |
| scout (claude-haiku-4-5) | 2 | 0.33 | 5.3% |

Total **$6.24**. Cost by component: cache_write 35.8%, cache_read 32.2%, output 32.0%. Main averaged 45,504 tokens
context over 60 turns = $0.079/turn. Note: main's share elevated by three large PNG reads (4.5/4.9 MB + previews)
into context for crop adjudication — image bytes land in cache_write, inflating that component's share.

---

