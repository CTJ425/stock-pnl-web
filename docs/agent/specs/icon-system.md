# Spec — Icon system unification (`AppIcon`)

- Lane: 2 (cross-module UI refactor, 30 files import `lucide-react`)
- Branch: `dev` (worktree `feat/icon-redesign` merged at `b6d14c8`)
- Source blueprint: `docs/design/icon-redesign-report.html`
- Timestamp: 2026-09-01 21:05:00 Asia/Taipei

## Blueprint correction — measured, do not revert

The blueprint proposes `name: keyof typeof Icons`, which forces
`import * as Icons from 'lucide-react'` and disables tree-shaking.
Measured on this branch with `npx vite build`:

| Variant | JS raw | gzip | Delta (gzip) |
| --- | ---: | ---: | ---: |
| Baseline (no change) | 750.56 kB | 217.10 kB | — |
| Blueprint `name` prop (namespace import) | 1368.73 kB | 370.49 kB | **+153.39 kB (+70.7%)** |
| `icon: LucideIcon` prop | 750.64 kB | 217.13 kB | +0.03 kB |

The project uses 57 of the library's icons. **Use the `icon: LucideIcon` prop.**
`SortableTh.tsx` already passes an icon component as a value, so this matches
existing style. A string `name` prop is a **non-goal** in every phase.

## Contract

### Size tokens

Six tokens. Each token fixes both pixel size and stroke width.

| Token | px | strokeWidth |
| --- | ---: | ---: |
| `xs` | 12 | 2 |
| `sm` | 14 | 1.75 |
| `md` | 16 | 1.75 |
| `lg` | 20 | 1.5 |
| `xl` | 24 | 1.5 |
| `2xl` | 32 | 1.25 |

The same six values appear twice: as a TypeScript map in `AppIcon.tsx`, and as
CSS custom properties `--icon-xs` … `--icon-2xl` in the `:root` block of
`src/index.css`. A test asserts the two agree, so the pair cannot drift.
The CSS tokens carry the pixel value only, not the stroke width.

### Component

File: `sources/src/components/Common/AppIcon.tsx`

```typescript
import type { LucideIcon, LucideProps } from 'lucide-react'

export type IconSizeToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

export interface AppIconProps extends Omit<LucideProps, 'size' | 'ref'> {
  icon: LucideIcon
  size?: IconSizeToken | number
}

export const ICON_SIZE_PX: Record<IconSizeToken, number>
export const ICON_STROKE_WIDTH: Record<IconSizeToken, number>
export function AppIcon(props: AppIconProps): JSX.Element
```

Behaviour:

1. `size` defaults to `'md'`.
2. A token `size` sets both the pixel size and the stroke width from the table.
3. A numeric `size` passes through as the pixel size. Its stroke width defaults
   to the `md` stroke width (1.75).
4. An explicit `strokeWidth` prop always wins over the token default.
5. All other props pass through to the Lucide component unchanged, including
   `className`, `color`, and `aria-*`.

### What must not change

- No call site changes in Phase 1.
- No new dependency.
- `lucide-react` stays imported by name at each call site.

## Test charter — Phase 1

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| Renders the passed icon | An `svg` element appears | `src/components/Common/AppIcon.test.tsx` |
| Default size | `width`/`height` = 16, `stroke-width` = 1.75 | same |
| Each of the six tokens | `width`/`height` and `stroke-width` match the table | same |
| Numeric size | `width`/`height` = the number, `stroke-width` = 1.75 | same |
| Explicit `strokeWidth` beats the token | `stroke-width` = the given value | same |
| `className` passes through | The class appears on the `svg` | same |
| CSS tokens equal the TS map | `--icon-*` in `src/index.css` match `ICON_SIZE_PX` | same |

## Roadmap

| Phase | Work | Gate |
| --- | --- | --- |
| 1 | `AppIcon.tsx` + `--icon-*` tokens + unit test | `npm run build` exit 0, new test green |
| 2 | Replace 9 emoji / text symbols with vectors | full vitest + build |
| 3 | Migrate `AppShell.tsx`, `TransactionsPage.tsx`, `SortableTh.tsx` | full vitest + build |
| 4 | Financial accent styling on trend icons, logo, empty states | user picks the visual, then build |
| 5 | Full regression: vitest + Playwright E2E | exit 0 on both |

Phase 4 is a subjective visual decision. Produce options for the user; do not
choose the styling unattended.

## Verify

From `sources/`:

```
npm run build
npx vitest run src/components/Common/AppIcon.test.tsx
```

`npm run build` is the type gate. `npx tsc --noEmit` does not type-check test
files in this project and must not be used as the gate.

---

# Phase 2 — replace rendered emoji with vector icons

Timestamp: 2026-09-01 21:20:00 Asia/Taipei

## Scope correction — measured against the code, not the blueprint

The blueprint lists 9 symbols. A grep of `sources/src` shows **8 of the 9 live
inside strings or comments, not in rendered JSX**:

| Symbol | Where it really is | In scope |
| --- | --- | --- |
| 💡 `MechanismGuide.tsx:292` | rendered JSX text | **yes** |
| ⚠️ `RecalcFeesModal.tsx:84` | rendered JSX text | **yes** |
| `?` `HelpTip.tsx` | rendered button text | **yes** |
| ⚠️ `FxPage.tsx:348` | inside a `{/* … */}` JSX comment | no |
| ⚠️ 6 other files | inside `/** … */` code comments | no |
| ⚠️ `aiClient.ts`, `aiPayload.ts` | strings sent to a model or shown as markdown | no |
| ▲ / ▼ ×3 files | template strings (`FxPage.tsx:72` returns a string) | no |
| ✅ / 🟢 ×4 `ProbeWarRoom.tsx` | `statusText = '✅ …'` string state | no |
| ✅ / 🗑️ `TransactionsPage.tsx` | `setNotice('…')` string state | no |
| 🎉 `TransactionForm.tsx` | `setMessage({ text })` string state | no |
| ✉️ `AuthPage.tsx` | string state | no |

The rows marked "no" need a data-shape change (string → icon plus text), which
would ripple into `FxPage`'s formatter signature, `ProbeWarRoom`'s status state,
three notice/message states, and 11 existing assertions in
`ProbeWarRoom.test.tsx` and `FxPage.test.tsx`. **The user scoped Phase 2 to the
three rendered occurrences only.** Do not touch the rows marked "no".

Second correction: the blueprint asks for `color="var(--warn)"`. **`--warn` does
not exist in `src/index.css`.** Use no explicit color; the icon inherits the
surrounding text color, which is what the emoji effectively did.

## Contract

Lucide class names, verified by rendering them:
`Lightbulb` → `lucide-lightbulb`, `HelpCircle` → `lucide-circle-question-mark`,
`AlertTriangle` → `lucide-triangle-alert`.

1. `MechanismGuide.tsx:292` — replace the `💡` text node with
   `<AppIcon icon={Lightbulb} size="sm" className="icon-inline" />`.
2. `RecalcFeesModal.tsx:84` — replace the `⚠️` text node with
   `<AppIcon icon={AlertTriangle} size="sm" className="icon-inline" />`.
3. `HelpTip.tsx` — replace the `?` button text with
   `<AppIcon icon={HelpCircle} size="sm" />`.
4. `index.css` — add one utility class `.icon-inline { vertical-align: -0.15em; }`
   so an icon sits on the text baseline.
5. `index.css` — `.help-tip` currently draws its own 14px circle with a border
   around a 9.5px `?`. `HelpCircle` draws that circle itself, so a circle inside
   a circle would appear. Remove `border`, `border-radius`, `font-size`,
   `font-weight` and `line-height` from `.help-tip`, and add
   `display: inline-flex; align-items: center; justify-content: center;`.
   Keep the 14px box, `color`, `cursor` and `transition`. In
   `.help-tip:hover, .help-tip:focus-visible`, remove `border-color` and keep
   `color`.

### What must not change

- `HelpTip`'s `aria-label` stays `` `${label}欄位說明` `` — tests depend on it.
- No change to any file in the "no" rows above.
- No new CSS custom property, and no `var(--warn)`.

## Test charter — Phase 2

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| HelpTip renders a vector, not `?` | `svg.lucide-circle-question-mark` present, button text has no `?` | `src/components/Common/HelpTip.test.tsx` (new) |
| HelpTip keeps its accessible name | `getByRole('button', { name: /欄位說明/ })` resolves | same |
| MechanismGuide renders a vector, not 💡 | after expanding, `svg.lucide-lightbulb` present and no `💡` in `textContent` | `src/components/Admin/MechanismGuide.test.tsx` (append one case) |
| RecalcFeesModal has no rendered ⚠️ | no non-comment line of the file contains `⚠` | `src/components/Transactions/emojiFree.test.ts` (new) |
| The three files import from `AppIcon` | each imports `AppIcon` | same guard file |

## Verify

From `sources/`:

```
npx vitest run
npm run build
```

Both must exit 0. Baseline to beat: 95 files / 1493 tests, and a JS bundle of
750.56 kB (gzip 217.10 kB).

---

# Phase 3 — migrate the three core files to `AppIcon`

Timestamp: 2026-09-01 21:35:00 Asia/Taipei

## Measured size distribution

128 icon instances exist in `sources/src`. By raw `size` value:
14px×59, 13px×16, 15px×12, 36px×9, 28px×8, 12px×8, 16px×6, 18px×4, 32px×2,
24px×1, 19px×1, 17px×1, 11px×1. **41% match no token.**

The user chose to round every size to the nearest token. Ties resolve to the
**smaller** token, because the project's dominant cluster is 14px and an icon
beside 13px text must not grow.

This changes the screen: `17→16`, `15→14`, `36→32`, and every migrated icon
takes the token stroke width in place of Lucide's default 2. That is intended.

## Exact call-site map — 25 sites

`sources/src/components/AppShell.tsx` (14 sites)

| Line | Icon | Now | Token |
| ---: | --- | ---: | --- |
| 417 | `HardDrive` | 12 | `xs` |
| 433 | `ThemeIcon` | 14 | `sm` |
| 453 | `ShieldCheck` | 14 | `sm` |
| 467 | `ExternalLink` | 12 | `xs` |
| 481 | `KeyRound` | 14 | `sm` |
| 493 | `LogOut` | 14 | `sm` |
| 584 | `Layers` | 14 | `sm` |
| 586 | `ChevronDown` | 12 | `xs` |
| 605 | `Check` | 14 | `sm` |
| 619 | `Plus` | 14 | `sm` |
| 631 | `Pencil` | 14 | `sm` |
| 643 | `Percent` | 14 | `sm` |
| 656 | `Trash2` | 14 | `sm` |
| 811 | `ListPlus` | 17 | `md` |

`sources/src/components/Transactions/TransactionsPage.tsx` (10 sites)

| Line | Icon | Now | Token |
| ---: | --- | ---: | --- |
| 215 | `Trash2` | 15 | `sm` |
| 220 | `Search` | 15 | `sm` |
| 236 | `X` | 14 | `sm` |
| 252 | `Calculator` | 15 | `sm` |
| 256 | `Upload` | 15 | `sm` |
| 260 | `Download` | 15 | `sm` |
| 273 | `NotebookPen` | 36 | `2xl` |
| 282 | `Search` | 36 | `2xl` |
| 356 | `Pencil` | 14 | `sm` |
| 364 | `Trash2` | 14 | `sm` |

`sources/src/components/Common/SortableTh.tsx` (1 site)

| Line | Icon | Now | Token |
| ---: | --- | ---: | --- |
| ~46 | `Icon` (a variable) | 12 | `xs` |

`ThemeIcon` and `Icon` are variables that hold a Lucide component. `AppIcon`
takes a component value, so `icon={ThemeIcon}` works unchanged.

## Contract

1. Every site above becomes `<AppIcon icon={X} size="<token>" … />`.
2. Every other prop at the site is preserved verbatim — `className`,
   `aria-hidden`, and any handler.
3. The `lucide-react` import stays a named import in each file. The icon names
   stay imported because they are now passed as values.
4. No raw numeric `size` is left in these three files.

### What must not change

- No other file. The other 103 icon sites stay as they are.
- No change to `AppIcon.tsx` or to the tokens.
- No new CSS.

## Test charter — Phase 3

| Case | Expected outcome | Layer / file |
| --- | --- | --- |
| `SortableTh` draws the `xs` token | `svg` has `width` 12 and `stroke-width` 2 | `src/components/Common/SortableTh.test.tsx` (new) |
| `SortableTh` still switches direction | clicking calls `onSort` with the key | same |
| The three files hold no raw numeric size | no `size={<number>}` remains | `src/components/iconTokens.test.ts` (new) |
| The three files import `AppIcon` | each has the import | same |
| Every site migrated | `<AppIcon` count is 14 / 10 / 1 | same |

## Verify

From `sources/`:

```
npx vitest run
npm run build
```

Both must exit 0. Baseline to beat: 97 files / 1501 tests.
