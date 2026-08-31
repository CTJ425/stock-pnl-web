# E2E Tests

## Definition

Real browser against:

1. **Native/local mode** — Vite, no Supabase env (default for agents)  
2. **Supabase mode** — DEV (`korq9tvdz0jd7yblr72p.ivan.lab`) or PROD front end + real session  

**No** `npm run e2e` and **no** Playwright CI suite today. E2E is opt-in:

| Asset | Role |
| ---- | ---- |
| `.claude/skills/verify/SKILL.md` | Agent Playwright / native checklist |
| `.claude/skills/testing/SKILL.md` | Layer choice + `npm test` gate |
| `sources/scripts/verify-admin-status.cjs` | Admin 「抓取狀況」 multi-viewport layout scan |

```bash
cd sources && npx playwright install chromium   # first time
```

## When to use E2E

jsdom cannot prove it: overflow, sticky/absolute layout, mobile safe-area + FAB, real downloads, auth session, multi-viewport screenshots.

**DOM text only** → `App.smoke` / page integration test first.

## Path A — Native mode

```bash
cd sources && npm run dev   # http://localhost:5173 · 「本機模式」
```

Seed (then `page.reload()`):

| Key | Shape |
| ---- | ---- |
| `stock-pnl-web/local-store-v1` | `{ workspaces, transactions }` |
| `stock-pnl-web/current-workspace` | workspace id |

Tx: `id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at`.

Selectors: `.ws-select select` / `工作區：…`, nav buttons (Chinese), `.fab`, `.notice-ok`/`.notice-warn`, `.data-table`, `.version-badge`.  
Confirm: `page.on('dialog', d => d.accept())`. CSV: `waitForEvent('download')`.

Worth driving: add/delete tx, CSV round-trip, chips empty copy when margin null, macro sub-tabs.  
Do not assert live 現價 without network control.

## Path B — Admin layout script

```bash
cd sources
SESSION=/path/session.json OUT=/tmp/shots REF=<project-ref> BASE_URL=http://localhost:5173/ \
  node scripts/verify-admin-status.cjs
```

`REF` must match the project that issued the session (script default may be stale). Injects `sb-${REF}-auth-token`. Never commit session files.

## Path C — Live ops smoke (not CI)

After Edge/cron changes (DEV; PROD only with user authorization):

| Check | How |
| ---- | ---- |
| `generate-all` | POST stock-report + `x-cron-secret` → `ok: true` |
| Margin on chips | `reports/{ymd}/{ticker}.json` → `data.margin` after ~21:00 |
| `batch_run_log` | `margin_today` / `regenerated` |
| UI | **Held** ticker → 融資融券 table |

No secrets in this docs folder.

## Layout is invisible to jsdom — the 0.8.0 lesson

`WatchlistPanel` shipped in 0.8.0 rendering as a plain inline `<section>` appended after
`StockDetailPage`, a full-length report. The panel existed, so all 1058 unit tests passed;
on screen it landed far below the fold and the 管理觀察 button looked dead. A user found it
on PROD.

**jsdom has no layout.** `getByRole(...)` proves a node exists, never that a human can see it.
Anything whose bug mode is *placement* — overlays, modals, sticky headers, off-screen or
clipped content, `overflow`/`backdrop-filter` ancestors — needs a real browser measuring a
bounding box:

```js
const box = await dialog.boundingBox()
expect(box.y >= 0 && box.y < viewport.height && box.height > 0)
```

Component-level companion assertion, cheap and worth having: a modal must be portaled out of
its caller's subtree, i.e. `container.contains(dialog) === false` and
`document.body.contains(dialog) === true`.

`scripts/verify-watchlist-e2e.cjs` is the runnable form of this for 觀察清單 (DEV only, mints
its own session, cleans up the row it adds).

## Cross-screen agreement — `verify-whatif-e2e.cjs`

Some invariants only exist *between* two screens, where no single component test can see them:
損益試算 and 庫存總覽 must report the same money for the same holding. `scripts/verify-whatif-e2e.cjs`
asserts that at 賣出價 = 現價, the tab's 投入成本 / 損益 equal the dashboard's 投入成本 /
未實現淨損益, and that the ladder and the marks strip actually render.

It compares the two screens rather than hard-coded numbers, so it stays valid as prices move.

```bash
BASE_URL=http://host:5173 WORKSPACE=<name> TICKER=0050 \
  APP_USER=… APP_PASS=… node scripts/verify-whatif-e2e.cjs
```

Credentials are read from the environment only and must never be written into the script, a
config file, or `docs/`. `WORKSPACE` matters: a ticker held in another workspace is not held in
this one, and the tab then correctly behaves like a watched stock — which is a real source of
"the numbers disagree" reports.

## Anti-patterns

- Secrets in git  
- Calling “looked fine once on DEV” unit coverage  
- Duplicating App.smoke cases in Playwright  
- PROD write from automation  
- `pkill -f vite` (kills agent shell) — kill by PID  

## Checklist

- [ ] jsdom enough? → integration first  
- [ ] Native: seed localStorage, not login  
- [ ] Roles/text over brittle selectors  
- [ ] Admin: `REF` matches `.env`  
