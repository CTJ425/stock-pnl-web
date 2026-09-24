---
name: verify
description: Verify stock-pnl-web UI with Playwright (native/local mode). Prefer App.smoke for DOM-only regressions.
---

# UI verification (native mode)

Strategy SoT: `docs/UnitTests/E2E.md`. Layer choice: **`testing`** skill.

## Start

```bash
cd sources && VITE_SUPABASE_URL= VITE_SUPABASE_ANON_KEY= npm run dev   # http://localhost:5173
```

`sources/.env` sets both variables, so a plain `npm run dev` opens the login page, not 「本機模式」.
Blanking them on the command line gives local mode without touching `.env`.

## Playwright

`playwright` is a **devDependency**. First time on a machine:

```bash
cd sources && npx playwright install chromium
sudo env "PATH=$PATH" npx playwright install-deps chromium   # system libs (e.g. libatk); nvm is not on root's PATH
```

Prefer **`src/App.smoke.test.tsx`** (jsdom) for copy/DOM structure — more durable than one-off browser scripts. Use Playwright for layout, overflow, downloads, multi-viewport.

### Seed data (no login)

After inject, `page.reload()`:

| Key | Value |
| ---- | ---- |
| `stock-pnl-web/local-store-v1` | `{ workspaces, transactions }` |
| `stock-pnl-web/current-workspace` | workspace id |

Tx fields: `id, workspace_id, tx_date, market ('TPE'\|'US'), ticker, name, tx_type, price, qty, fee_tax, created_at`.

### Selectors

- Workspace: `.ws-select select` or button `工作區：…`
- Nav: `getByRole('button', { name: '…' })` (Chinese labels)
- Add-transaction button `.header-add` · notices `.notice-ok` / `.notice-warn` · tables `.data-table`
- Confirm: `page.on('dialog', d => d.accept())`
- CSV: `page.waitForEvent('download')` then export

### Useful journeys

- Add/delete transaction → `.notice-ok`
- CSV export → re-import Modal (multi-workspace backups rejected)
- Do not assert live 現價 without network control

### Admin layout scan

`sources/scripts/verify-admin-status.cjs` — needs `SESSION`, `REF` (must match `.env`), `BASE_URL`, optional `OUT`.

## Notice

- Kill vite by **PID**, not `pkill -f vite` (kills the agent shell too).
