---
name: verify
description: Verify stock-pnl-web UI with Playwright (native/local mode). Prefer App.smoke for DOM-only regressions.
---

# UI verification (native mode)

Strategy SoT: `docs/UnitTests/E2E.md`. Layer choice: **`testing`** skill.

## Start

```bash
cd sources && npm run dev   # http://localhost:5173 — local mode if Supabase env unset
```

## Playwright

`playwright` is a **devDependency**. First time on a machine:

```bash
cd sources && npx playwright install chromium
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
- FAB `.fab` · notices `.notice-ok` / `.notice-warn` · tables `.data-table`
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
