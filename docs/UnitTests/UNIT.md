# Unit Tests

## Definition

Pure (or nearly pure) modules: no real network, no Supabase/Storage/cron, no React `render`.  
Edge pure files under `supabase/functions/stock-report/` are tested with **Vitest on Node** (not Deno).  
`index.ts` calls `Deno.serve` at load — **never import it** in Vitest; logic lives in extractable modules (`pollPlan`, `twChips`, …).

## Run

```bash
cd sources
npm test
npx vitest run src/utils/pnlEngine.test.ts
npx vitest run supabase/functions/stock-report/pollPlan.test.ts
```

`testTimeout` is 20s for UI tests; unit cases should finish in ms — do not raise timeout to hide hangs.

## Conventions

**Layout:** `foo.ts` + sibling `foo.test.ts` (same for Edge).

```ts
import { describe, expect, it } from 'vitest'
import { decideSkip } from './pollPlan.ts'  // Edge often uses .ts suffix
```

- Small fixtures over huge JSON.  
- Production incident → one-line comment with date + symptom.  
- Assert invariants; money → `toBeCloseTo`.  
- Missing / `--` / empty → `null` (never pretend `0`).  

**Forbidden:** real TWSE/MOPS/Yahoo, real Storage, importing Edge `index.ts`.

## Where tests live

| Area | Paths |
| ---- | ---- |
| Utils | `src/utils/*.test.ts` — `pnlEngine`, `fees`, `csv`, `holdingRows`, `indicators` |
| Services | `src/services/*.test.ts` — proxies, `misParse`, `quoteWindow`, AI, warm/prefetch |
| Feature pure | e.g. `Charts/*`, `fxConvert`, `macroPeriod`, `chipStreak`, `txSearch`, `timeline` |
| Edge pure | `supabase/functions/stock-report/*.test.ts` — `pollPlan`, `twChips`, `twMarket`, daily/fundamental/history, FX, US macro, `batchTickers` |

List files with: `find sources/src sources/supabase/functions -name '*.test.ts'`.

## Critical domains (keep regressions)

1. **`pollPlan`** — skip without today’s margin; T86 fingerprints / row order; `marginSigPart`  
2. **`twChips` / `extractMarginDated`** — position-index columns (duplicate 買進/賣出 headers)  
3. **`pnlEngine` + `fees`** — TPE floor, ETF rates  
4. **`csv`** — multi-workspace import rejection  
5. **`quoteWindow` / `misParse`** — trial auction / after-close lock  

## Checklist

- [ ] Pure or fully mocked I/O  
- [ ] `npx vitest run <file>` green  
- [ ] Bug-driven tests: date + symptom comment  
