# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: **0.10.10 released.** 股利專區 + 二代健保自動試算 (Task 183) and 費率生效日 (Task 182) are on `main`. Release published by CI, both branches at `abe8c38`.
- Status: ✅ 0.10.10 on `main` + `dev`, CI green, Release published. ⚠️ **Task 182's DDL is still unapplied in DEV and PROD — until it is, changing a workspace's 手續費率 errors.** Nothing was deployed: PROD Edge and the DDL are separate steps.
- Timestamp: 2026-10-01 10:00:00 Asia/Taipei

---
## 📅 Log: 2026-10-01 10:00:00 Asia/Taipei (0.10.10 released to main)
- **Released on the user's explicit decision after the risk was stated.** I raised that merging ships Task 182 as well — the two tasks share `TransactionForm.tsx` and are in one commit (`cecf819`) — and that Task 182's DDL is unapplied. The user chose to merge anyway. Recording the decision, not re-litigating it.
- **What "unapplied DDL" actually costs, checked rather than assumed.** Reads are safe: `dataProvider.ts:384` steps the workspace query down to `WORKSPACE_COLUMNS_WITHOUT_HISTORY` when PostgREST rejects the unknown column, so login, 庫存 and 年度收益 are unaffected. Writes are not: `WorkspaceFeeSettings.tsx:113-120` sends a rate change down `setWorkspaceFeeRateHistory` whenever `base !== null`, and `base` is the workspace's existing `fee_rate` (`:70`), which every PROD workspace has. So **changing a workspace's 手續費率 in PROD throws 「儲存費率生效日失敗」** until the column exists. `dataProvider.ts:550` has no degrade ladder on that write, unlike the read.
- **Changelog finalized before the push, on purpose.** `release.yml` generates the Release body from the section and **skips a Release that already exists**, so the Task 182 caveat was rewritten from an internal "pending" note into the user-facing consequence above. Confirmed in the published body.
- **Shipped**: `abe8c38 chore(release): 0.10.10` on both branches (fast-forward, `main` and `dev` identical). CI run 36803253690 success; Sync GitHub Releases run 36803253703 success; Release `0.10.10` published by `github-actions[bot]`, marked Latest.
- **Deployed nothing.** A `main` push moves code, not services. PROD Edge Functions and the DDL are still untouched, and the nightly Discord card still runs the old bundle. Cloudflare Pages will serve the new frontend from `main` on its own.
- **Open, and the only thing between the user and a working 費率生效日**: apply to PROD (and DEV) —
  `ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS fee_rate_history JSONB;` plus its shape CHECK, both already in `sources/supabase/schema.sql`. Idempotent, touches no existing data. Then redeploy `stock-report` so the Edge card reads the history too.

---
## 📅 Log: 2026-10-01 09:30:00 Asia/Taipei (Task 183 — 二代健保改為自動填入，0.10.10-dev.2)
- **User's call, and it is the right parity.** They asked for the premium to behave like 手續費: filled in without a button and recomputed on every edit until save. Checked what 手續費 actually does first rather than assuming — `TransactionForm.tsx` fills it from `calculateFee` and overwrites a hand-typed value whenever price/qty/unit/rate/tax/minFee/market/type/nature changes, with one exception: on an edit's first mount `untouchedFeeSig` holds the stored value until a core input moves. The dividend now follows the same path; the 帶入 button is gone and the hint keeps only the breakdown and the 「以券商通知書為準」 line.
- **Regression I introduced and the test caught.** Adding `date` to the fee effect's signature without adding it to `untouchedFeeSig`'s initial signature made the two strings永不相等, so the "don't rewrite an opened record" guard released on the first run — **for every transaction type, not just dividends**. Opening any trade for edit would have silently recalculated its fee. Both lists must now be built identically, and `date` is included only for a cash dividend: unconditional inclusion would make editing a trade's date move its commission, which it has never done. Pinned by `TransactionForm.dividend.test.tsx` D8.
- **Verified in the browser** (local mode): new 2 x 14,000 auto-fills **601**; qty to 15,000 → **643**; 每股股利 to 1 → **10** (15,000 is under the 20,000 起扣點, and the hint says so); typing **661** then changing qty overwrites it with **601**. Side-by-side with 手續費 on a BUY: 500 x 1,000 → **463**, typing **999** then changing qty to 2,000 → **926**. Same behaviour, as asked. Opening the stored 661 dividend keeps **661** and only moves to 643 after the qty edit.
- **Gates**: vitest **2,683 passed / 7 skipped (+2)**, `npm run build` / `oxlint` / `typecheck:edge` exit 0. CI run 36802105283 green on `dev`.
- **Shipped to `dev` only**: `cecf819` (feature) → `f57acfc` (0.10.10-dev.1) → `cd19976` (0.10.10-dev.2). **Nothing deployed, nothing on `main`.**
- **Note on `npm run lint` locally**: the wrapper prints 「ESLint output (JSON parse failed)」 and exits 1 while `npx oxlint` exits 0 with no findings; CI's `npm run lint` passes. Local shell artefact, not a lint failure.

---