# Integration Tests

## Definition

React components + app wiring in Vitest:

- `// @vitest-environment jsdom`  
- Testing Library (+ user-event)  
- Network mocked (`vi.mock`)  
- **Local mode only** (`VITE_SUPABASE_*` cleared in `vite.config.ts`)  

Not full browser E2E; not live DEV/PROD APIs.  
Highest level: `src/App.smoke.test.tsx` (full `<App />`).

## Run

```bash
cd sources
npm test
npx vitest run src/App.smoke.test.tsx
npx vitest run src/components/StockDetail/
```

## Conventions

**Required header** on any file that `render`s:

```ts
// @vitest-environment jsdom
```

**Reset:**

```ts
beforeEach(() => {
  cleanup()
  window.localStorage.clear()
})
```

`src/test/setup.ts` provides MemoryStorage when jsdom lacks localStorage.

**Mock pattern** (`vi.hoisted` before SUT import):

```ts
const { fetchStoredReport } = vi.hoisted(() => ({
  fetchStoredReport: vi.fn(),
}))
vi.mock('../../services/reportProxy', () => ({
  isReportConfigured: true,
  fetchStoredReport,
}))
import { StockDetailPage } from './StockDetailPage'
```

Mock: Storage/Edge proxies (`reportProxy`, `dailyProxy`, `fundamentalProxy`, `warmStock`, `priceProxy`, admin).  
Do not mock pure helpers under test.

- Prefer `userEvent`; `await screen.findBy…` for async.  
- Stub `matchMedia` for mobile; restore in `afterEach`.  
- Assert **product Chinese copy** when that string is the contract (e.g. 融資尚未公布 vs 故障).

## Where tests live

| Path | Scope |
| ---- | ---- |
| `App.smoke.test.tsx` | Boot, workspace, tx → dashboard/yearly, version badge |
| `components/Transactions/*` | CRUD / search / CSV UI |
| `components/StockDetail/*` | Tabs, warm, chips empty states (network mocked) |
| `components/Macro|Fx|Admin/*` | Macro, FX, admin console/status |
| Some `services/*` / hooks | Light mocks without full page — borderline unit |

Reference implementation: `StockDetailPage.test.tsx`.

## App.smoke (must stay green)

- Local mode boot → empty holdings  
- Version badge = `APP_VERSION` only (no `v`, no author)  
- Add transaction surfaces on list/dashboard  
- Footer disclaimer; menu GitHub link  

DOM-only Playwright checks → promote here first.

## Vs Edge ops smoke

| | Vitest integration | DEV ops smoke |
| ---- | ---- | ---- |
| `npm test` | Yes | No |
| Needs Docker Supabase | No | Yes |
| Catches deleted Edge helpers | No | Yes (`generate-all` 500) |

After `stock-report/index.ts` wiring changes: pure unit + **DEV generate-all** (`supabase-ops`).

## Checklist

- [ ] jsdom directive  
- [ ] I/O mocked; no live Supabase  
- [ ] cleanup + localStorage clear  
- [ ] User-visible outcome (role/text)  
