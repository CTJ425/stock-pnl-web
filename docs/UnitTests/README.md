# Testing Guide (stock-pnl-web)

- **Status**: ACTIVE  
- **SoT for strategy**: this folder  
- **Agent skill**: `.claude/skills/testing/SKILL.md` (thin pointer — load when writing/running tests)  
- **UI Playwright skill**: `.claude/skills/verify/SKILL.md`  
- **Human facade**: project `README.md` §測試  
- **Command root**: always `sources/`  
- **Gate**: `cd sources && npm test` (Vitest: unit + integration; E2E is opt-in)

Language: English (agent docs). UI assertions may use Traditional Chinese product copy.

---

## Layers

| Layer | Proves | Tool | Doc |
| ---- | ---- | ---- | ---- |
| **Unit** | Pure logic, parsers, fees, Edge extract/poll | Vitest (Node) | [UNIT.md](./UNIT.md) |
| **Integration** | React wiring, LocalProvider, mocked network | Vitest + jsdom + Testing Library | [INTEGRATION.md](./INTEGRATION.md) |
| **E2E** | Real browser layout / native journeys / admin session | Playwright (manual / agent) | [E2E.md](./E2E.md) |

No `test:unit` / `test:e2e` scripts. Unit + integration share one gate. E2E is not CI-gated.

---

## When to write which layer

```text
Pure function / fee / poll / parser / Edge extract  → Unit (sibling *.test.ts)
React page + mocks                                 → Integration (jsdom)
DOM copy only                                      → App.smoke / page test first
Layout, overflow, downloads, multi-viewport        → Playwright (verify skill)
Edge index.ts wiring / cron                        → Unit pure + DEV generate-all smoke
```

Judgment bugs → unit. Wiring/copy bugs → integration. Pixels → Playwright.

---

## Quick start

```bash
cd sources
npm test
npx vitest run path/to/file.test.ts
npm run dev    # local UI for manual / Playwright
```

Config: `vite.config.ts` (`testTimeout: 20_000`, wipe Supabase env), `src/test/setup.ts` (MemoryStorage).

---

## Project constraints

1. npm / vitest only under **`sources/`**.  
2. Edge pure modules are Vitest-tested; **do not import** `functions/*/index.ts` (Deno.serve side effect).  
3. UI tests run **local mode** (Vitest clears `VITE_SUPABASE_*`).  
4. TPE fees/P&amp;L: floor rules — use `toBeCloseTo`.  
5. TW UI colors: red up / green down — do not invert assertions.

---

## Inventory (discover live; counts drift)

```bash
cd sources && find src supabase/functions -name '*.test.ts' -o -name '*.test.tsx' | wc -l
cd sources && npm test   # reports file + test counts
```

| Bucket | Where |
| ---- | ---- |
| Unit frontend | `src/utils`, `src/services`, feature `*.test.ts` without `render` |
| Unit Edge | `supabase/functions/stock-report/*.test.ts` |
| Integration | `*.test.tsx` + jsdom pages under `src/components`, `App.smoke.test.tsx` |
| E2E scripts | `scripts/verify-admin-status.cjs`, ad-hoc Playwright |

Critical unit domains: `pollPlan`, `twChips`/`extractMarginDated`, `pnlEngine`+`fees`, `csv`, `quoteWindow`/`misParse`.

---

## Gaps

| Gap | Direction |
| ---- | ---- |
| No Playwright CI | Prefer App.smoke for DOM; Playwright only when needed |
| No live TWSE suite | Pure extract tests + DEV ops smoke after Edge deploy |
| Edge `index.ts` untested | Keep helpers pure; smoke `generate-all` on DEV |

---

## Maintenance

- Colocate tests next to source. Update this folder when **conventions** change, not every new case.  
- No secrets in tests; no PROD write APIs from automation.  
