# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — 0.9.58 deployed to PROD (§14 + §15, holdings cron, `stock-report` v10)
- Status: ✅ **0.9.58 on `dev` and `main`, deployed to DEV and PROD** — next: watch one real 17:30 / 21:30 round on PROD
- Timestamp: 2026-09-18 15:46:22 Asia/Taipei

---

## 📅 Log: 2026-09-18 16:42:13 Asia/Taipei (Admin console nav consolidation — uncommitted, no version bump)

- **What**: Admin console left nav reduced from 8 panels to 5: 帳號 / 資料更新 / AI 設定 / Discord / 備份.
  - `資料更新` = old 抓取狀況 + 手動更新 + 執行記錄, switched by in-panel `.subtabs` (role=tablist, aria-label `資料更新分頁`); default sub-tab 抓取狀況. Sub-tabs, not stacking, because the three views total ~1000 lines.
  - `AI 設定` = old AI 連線 + 提示詞, stacked (AiConnectionSection above PromptsSection), each keeps its own save button.
  - Frontend-only: no change to `app_settings`, RLS, Edge functions, or section components.
- **Files**: `sources/src/components/Admin/AdminConsolePage.tsx`, `sources/src/components/Admin/AdminConsolePage.test.tsx` (labels updated; `aiPrompts` mocked; new asserts for sub-tabs and prompts heading), `sources/src/components/StockDetail/AiTab.tsx` (hint text 管理後台 → AI 設定), `README.md:358` (「AI 設定」).
- **Lane**: 0 (inline) — one production component already in context, UI-only, no money/auth/schema.
- **Verify**: `npm run build` ✅; `npx vitest run` → 148 files passed / 1 skipped, 2530 tests passed / 7 skipped.
- **Note**: 執行記錄 (`app_log`) also carries 前端/資料庫 sources, not only data-update jobs; it now lives under 資料更新 by user choice.
- **Next**: commit to `dev` + versioning (`0.9.59-dev.1`) when the user asks; no deploy.

---

## 📅 Log: 2026-09-18 15:46:22 Asia/Taipei (Task 165 — 0.9.58 on PROD)

**Authorization**: explicit user OK for PROD, with git work to follow the `versioning` and `ship` skills.

**Correction to the records**: PROD already had Phase 1 — `app_secrets`, `discord_send_log`, `discord-summary-brief` (`5 9`) and `discord-summary-full` (`30 13`), a global webhook, and 3 send-log rows. The earlier notes saying PROD had none of Task 165 were wrong; only Phase 2 was missing. PROD `stock-report` was v9 (ezbr `068be7e5…`, the pre-Phase-2 bundle).

**PROD DDL** (one transaction, `-f` file, guarded by `command LIKE '%hrilemueiqyaoiwnkeuu%'` AND NOT `'%zyebvayngwrqzoaicbwd%'`): §14 tables, `market_webhook_url`, the kind CHECK with `market`, the once-per-day index; `discord-holdings-daily` created at `30 9 * * 1-5` by cloning `discord-summary-brief`'s command (body and timeout replaced, then checked by `LIKE` inside the transaction — the command text was never selected); §15 `discord_schedule_get` / `discord_schedule_set` (ACL postgres + service_role only); then `discord_schedule_set(17, 30, 21, 30)`. Result: `discord-summary-brief 30 9`, `discord-holdings-daily 30 9`, `discord-summary-full 30 13`, 10 jobs in total.

**PROD Edge**: `stock-report` deployed from `869390c` with `--no-verify-jwt --use-api`: v9 → v10, ezbr `068be7e5…` → `1c93c3fc…`, identical to DEV v19. Probes: `discord-accounts` and `discord-webhook` 401 without a token, `discord-holdings-settings` 400.

**PROD verification**: `verify.sql` installed with `-f`; `verify_setup()` 10/10 PASS — all 19 tables, 10 jobs 0 inactive, recent cron HTTP 200, RLS on every user table. No temporary admin was created on PROD, to leave its users untouched; the same bundle passed the full admin-op check on DEV.

**Next**: watch one real 17:30 round (brief + holdings) and one 21:30 round (full edition) on PROD.
