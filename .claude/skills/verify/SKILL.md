---
name: verify
description: Verify stock-pnl-web changes: drive native mode UI with Playwright after starting vite dev server
---

# Verification process (native mode, no need for Supabase)

## start up

```bash
cd sources && npm run dev # http://localhost:5173, automatically enter local mode when Supabase env is not set
```

## Powered by Playwright

> ⚠️ 2026-07-21 Actual measurement: `~/.npm/_npx` and `~/.cache/ms-playwright` no longer have playwright (npx cache will be cleared).
> For verification of pure copywriting/DOM structure, please add `src/App.smoke.test.tsx` (jsdom + Testing Library) first——
> It is more durable than a one-time browser script and also becomes a regression test. When you really need pixel or layout scanning, use `npm i -D playwright && npx playwright install chromium`.

- The project does not have playwright installed, if the npx cache is still there:
  `NODE_PATH=$(find ~/.npm/_npx -maxdepth 4 -name playwright -type d | head -1 | xargs dirname) node <script>.js`
  Execute the `require('playwright')` script; chromium is installed in `~/.cache/ms-playwright`.
- `page.reload()` after injecting test data (localStorage) without logging in:
  - `stock-pnl-web/local-store-v1`：`{ workspaces: [{id,name,created_at}], transactions: [{id,workspace_id,tx_date,market:'TPE'|'US',ticker,name,tx_type:'BUY'|'SELL',price,qty,fee_tax,created_at}] }`
  - `stock-pnl-web/current-workspace`: workspace id (overview mode was removed in v0.2.1)
- Commonly used selectors: workspace switching `.ws-select select` (selectOption), paging `getByRole('button', {name:'Transaction Record'})`,
  Added transaction FAB `.fab`, notification `.notice-ok` / `.notice-warn`, and table `.data-table`.
- Native confirm dialog: `page.on('dialog', d => d.accept())`.
- Export CSV: `page.waitForEvent('download')` and click "Export CSV".

## A process worth driving

- Transaction check → Delete selection → `.notice-ok` Success notification
- CSV export → paste back the imported Modal verification analysis (old backup files containing the "Workspace" column and multiple workspaces will be rejected in batches)
- The current price is an external API: when there is no network, the skeleton screen/cache price is displayed. Do not rely on the current price field for verification.

## Notice

- `pkill -f vite` will kill your own shell as well (the command line contains "vite"); write down the PID and then kill.
