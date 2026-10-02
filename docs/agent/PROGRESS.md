# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.24 released** — dashboard marks a workspace whose fee discount was never set; 「折扣怎麼退給你」 open at 不打折.
- Status: ✅ `main` = `dev` (see git log); frontend only.
- Timestamp: 2026-10-02 18:12:59 Asia/Taipei

---
## 📅 Log: 2026-10-02 18:12:59 Asia/Taipei (0.10.24 — fee onboarding marker + rebate open at 不打折)
- **Release**: `2e68462` feature + `0196c97` E2E mock fix; gates green (vitest 2,837 pass / 7 skipped, build, `typecheck:edge`); frontend only — no DDL, no Edge. User authorized the `main` merge in advance.
- **E2E**: `verify-fee-rate-e2e` (after the mock fix), `verify-monthly-rebate-cost-e2e`, `verify-pnl-rounding-e2e` PASS; local-mode journey 1440 / 390 PASS.
- **Left**: Task 190 item 3; `.stmt-pct` overflow at 390px with a 7-digit hero figure (pre-existing).
---
## 📅 Log: 2026-10-02 17:00:32 Asia/Taipei (Task 190 item 6 — 「手續費折扣未設定」 on the dashboard)
- **Ask** (/impeccable): a new workspace has no prompt to set the discount; trades typed at 3 折, figures on 不打折, 批次重算 out of step.
- **Done**: user picked only the dashboard marker. `DashboardPage.tsx` stamp + basis text while unset (no stored rate, `fee_rate` or history); `WorkspaceFeeSettings.submit` stores 不打折 as the base when saved unset; `dashboard.css` shares the `.stmt-preview` stamp; DESIGN.md fee-settings line.
- **Verified**: vitest 2,837 pass / 7 skipped; build; lint; detector clean; Playwright local mode 1440 + 390 light/dark, saving clears the stamp. New save test fails without the change.
- **Seen, not fixed**: at 390px a 7-digit hero figure pushes `.stmt-pct` past the viewport (scrollWidth 426, same with a rate set — pre-existing).
---
