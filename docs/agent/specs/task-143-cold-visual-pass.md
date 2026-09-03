# Task 143 — Whole-app cold visual pass: strip the glass, switch the typeface

- **Status**: ✅ DONE (0.9.28-dev.4, 2026-09-03)
- **Lane**: 2 (cross-module — every page renders through these tokens)
- **Baseline**: 95 test files, 1530 tests, exit 0 (0.9.28-dev.3)
- **Approved design**: artifact `f6d0c748-9302-437b-ab2b-6f148de707bc` (配色版庫存總覽)
- **Follows**: Task 142, which shipped the structure and the colour roles but not the visual
  treatment. This task is the treatment.

## Goal

Make the app look like the approved artifact: flat hairline-bordered surfaces on a cold
neutral ground, a technical typeface pairing, denser tables, and steel in place of the
purple accent.

## Contract

### C1 — Class names do not change

Every existing CSS class name stays. Tests assert on `.glass`, `.data-table`, `.section`,
`.pnl-up`, `.pnl-down` and on nav button text. Change what the rules *do*, never what they
are called, and change no user-visible string.

- `App.smoke.test.tsx:102-115` asserts the six nav labels. They do not change.
- `MacroPage.test.tsx:142,145` selects `.section.glass` and `.data-table`.
- `FundamentalTab.test.tsx:89` counts `.data-table`.
- `AdminStatusPage.test.tsx:117` uses `.closest('.section')`.

### C2 — Token values carry most of the change

`--radius` and `--shadow-card` are already tokens used by 100+ rules. Change the token and
those rules follow. Set them once in each theme rather than editing every rule.

### C3 — No blur, no glow, no gradient chrome

- Delete every `backdrop-filter` / `-webkit-backdrop-filter` declaration.
- `.kpi::before` (index.css:359-360) and `.market-panel::before` (index.css:407-408) draw a
  2px `linear-gradient(90deg, var(--accent-strong), var(--accent-2), transparent)` across the
  top edge. Delete both rules entirely.
- `.tab.active` (index.css:221-225) uses a 135° accent gradient plus a `box-shadow`. Replace
  with a flat treatment: transparent background, `color: var(--ink)`, and a 2px bottom border
  in `var(--ink)`. The inactive `.tab` keeps `color: var(--ink-muted)` and a 2px transparent
  bottom border so the two states do not shift by a pixel.
- Set `--bg-glow-a` and `--bg-glow-b` to `transparent` in both themes so the two radial
  washes behind `body` stop painting. Do not delete the `body` rule that uses them.

### C4 — Radius rule, applied mechanically

- `--radius`: `14px` → `2px`. `--radius-sm`: `9px` → `2px`.
- Any **hardcoded** `border-radius` whose value is between `5px` and `20px` becomes `2px`.
  Known cases: `.modal` (index.css:1396, `16px`), `.bottom-nav` (index.css:281, `10px`).
- **Negative case**: leave `border-radius: 50%` and `border-radius: 999px` alone. Those are
  circles and pills whose shape is the point (avatars, dots, count badges). Changing them
  turns a circle into a square and is not part of this task.

### C5 — Typeface

`sources/index.html:9-14` loads Inter + Outfit + Noto Sans TC from Google Fonts. Replace that
link with Archivo + IBM Plex Mono + Noto Sans TC:

```
https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700&display=swap
```

Then in `index.css:31-32`:

- `--font-display: 'Archivo', 'Noto Sans TC', system-ui, sans-serif`
- `--font-body: 'Archivo', 'Noto Sans TC', 'Microsoft JhengHei', system-ui, sans-serif`
- add `--font-num: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace`

Apply `--font-num` with `font-variant-numeric: tabular-nums` to exactly three places:
`.data-table .num`, `.kpi-value`, and `.kpi-sub`. Do not set it on body text — Chinese text
must not fall into a Latin monospace face.

### C6 — Palette

Replace these token values. Every listed token already exists; do not add or rename any.

| Token | dark (`:root`) | light (`:root[data-theme='light']`) |
| --- | --- | --- |
| `--bg` | `#090b0f` | `#eff0f3` |
| `--bg-glow-a` | `transparent` | `transparent` |
| `--bg-glow-b` | `transparent` | `transparent` |
| `--surface` | `#0e1116` | `#fafbfc` |
| `--surface-strong` | `#141922` | `#ffffff` |
| `--border` | `rgba(255,255,255,0.15)` | `rgba(15,19,25,0.14)` |
| `--border-strong` | `rgba(255,255,255,0.24)` | `rgba(15,19,25,0.22)` |
| `--ink` | `#dfe4ea` | `#0f1319` |
| `--ink-secondary` | `#96a0ad` | `#48525f` |
| `--ink-muted` | `#6b7684` | `#838d9a` |
| `--accent` | `#74a6c0` | `#2f6484` |
| `--accent-strong` | `#5b8fa8` | `#245065` |
| `--accent-2` | `#74a6c0` | `#2f6484` |
| `--panel` | `#0e1116` | `#ffffff` |
| `--header-bg` | `#090b0f` | `#eff0f3` |
| `--modal-bg` | `#0e1116` | `#ffffff` |
| `--thead-bg` | `rgba(255,255,255,0.03)` | `rgba(15,19,25,0.035)` |
| `--row-hover` | `rgba(255,255,255,0.04)` | `rgba(15,19,25,0.035)` |
| `--row-alt` | `transparent` | `transparent` |
| `--radius` | `2px` | (inherits) |
| `--radius-sm` | `2px` | (inherits) |
| `--shadow-card` | `none` | `none` |

**Market colours, one step cooler** — this is the only change to `--up` / `--down`, and it is
deliberate. Keep it on its own two lines per theme so it can be reverted alone:

| Token | dark | light |
| --- | --- | --- |
| `--up` | `#ff4a5a` → `#ff5364` | `#dc2f3f` → `#bf2233` |
| `--down` | `#00e676` → `#21c88a` | `#059654` → `#0c6f4b` |

`--steel*` and `--ochre*` from Task 142 keep their current values.

### C7 — Table density

In the `.data-table` block (index.css:563-653):

- `.data-table th`: `font-size: 10.5px`, `font-weight: 500`, `letter-spacing: 0.14em`,
  `text-transform: uppercase`, `color: var(--ink-muted)`, `border-bottom: 1px solid var(--border)`.
- `.data-table td`: padding tightens to `9px 14px`, `border-bottom: 1px solid` a hairline at
  4.5% opacity. Add a `--rule-hair` token for it: `rgba(255,255,255,0.045)` dark,
  `rgba(15,19,25,0.045)` light.
- Table body `font-size: 13.5px`.
- **Negative case**: do not remove the `HelpTh` question-mark buttons or any column. The
  artifact's table has no help icons, but removing them is a content change, not a visual
  one, and it is out of scope.

### C8 — Section title

`.section-title` (index.css:319-338): flatten to a strip — the `h2` becomes `font-size: 11px`,
`font-weight: 600`, `letter-spacing: 0.18em`, `text-transform: uppercase`,
`color: var(--ink-secondary)`; the `.hint` sits right-aligned in `--font-num`, `11px`,
`color: var(--ink-muted)`.

## Files

Builder may touch only these:

- `sources/index.html`
- `sources/src/index.css`

## Verify

From `sources/`:

```
npm run build
npx vitest run
```

Baseline is 95 files / 1530 tests / exit 0. The count must not drop. `npm run build` is the
type gate — `npx tsc --noEmit` does not type-check test files here.

## Non-goals

- Do not rename any CSS class, change any user-visible string, or edit any `.tsx` file.
- Do not remove `HelpTh`, any table column, or any control.
- Do not touch `--steel*`, `--ochre*`, or anything Task 142 added.
- Do not change `border-radius: 50%` or `999px`.
- Do not change any P&L formula or any component logic.

## Revisions after the first render (2026-09-03)

The screenshot pass found four defects that the spec as written caused. All four are fixed
in `index.css`; the values above are superseded by these.

1. **C7/C8 tracking was written for Latin labels.** `letter-spacing: 0.14em` on
   `.data-table th` and `0.18em` on `.section-title h2` splits Chinese apart —
   「交 易 日 期」, 「持 有 股 數」. Reduced to `0.02em` and `0.06em`. Latin labels (TWD,
   ACTIVE) still read as tracked; Chinese does not come apart.
2. **The monospace face overflowed the holdings table.** IBM Plex Mono is wider than Inter,
   so the 10-column TW table pushed 未實現報酬率 outside its frame. Fixed by three changes:
   `.data-table th`/`td` horizontal padding to `10px`, `.data-table .num` to `12.5px`, and —
   the one that mattered — the secondary lines inside a numeric cell (未含費 …, 淨收 …) back
   to the proportional face at `10.5px` via `.data-table .num > div:not(.row-actions)`.
   Those lines are prose, not a column that has to align.
3. **C3 named only three pieces of accent chrome; five more survived.** `.btn-primary` and
   its `:hover` carried a hardcoded `#4f46e5` gradient (this is the 新增交易 FAB and 加入觀察),
   `.fab` carried a purple glow `box-shadow`, the avatar and `.adm-toggle.on` carried accent
   gradients. All flattened to `var(--accent-strong)` / `var(--accent)` with no shadow.
4. `.data-table th` and `td` had mismatched horizontal padding (9px vs 14px). Both are 10px.
