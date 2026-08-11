---
name: testing
description: Run and write stock-pnl-web tests. Use when adding tests, choosing unit vs integration vs E2E, or before ship.
---

# Testing (stock-pnl-web)

**SoT (read on demand):** `docs/UnitTests/README.md` → `UNIT.md` / `INTEGRATION.md` / `E2E.md`.

## Commands (always under `sources/`)

```bash
cd sources && npm test                    # full gate (unit + integration)
npx vitest run path/to/file.test.ts       # one file
```

Never run npm from repo root. Never import `supabase/functions/*/index.ts` in Vitest (`Deno.serve` side effect).

## Pick a layer

| Change | Write |
| ---- | ---- |
| Pure logic / parser / fee / pollPlan / Edge extract | Unit `*.test.ts` beside module |
| React page + mocked network | Integration: jsdom + Testing Library (`// @vitest-environment jsdom`) |
| Copy/DOM only | Prefer `App.smoke` / page test over Playwright |
| Layout / overflow / real browser | Playwright — see **`verify`** skill + `docs/UnitTests/E2E.md` |
| Edge HTTP / cron wiring | Pure unit + **DEV** `generate-all` smoke (`supabase-ops`) |

## E2E / verify

- Native mode: `npm run dev`, no Supabase env → 「本機模式」.
- Admin layout script: `sources/scripts/verify-admin-status.cjs` (pass `REF` + `SESSION`).
- No secrets in git. No PROD write from automation.

## Gate before ship

`cd sources && npm test` green. Do not claim CI E2E unless a Playwright suite exists.
