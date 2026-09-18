# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 — released 0.9.58 (Phase 1 + Phase 2) and fast-forwarded `main` to `dev`
- Status: ✅ **0.9.58 on `dev` and `main`** (same commit, not pushed) — DEV Supabase deployed and verified; PROD Supabase untouched, awaits explicit OK
- Timestamp: 2026-09-18 15:33:33 Asia/Taipei

---

## 📅 Log: 2026-09-18 15:33:33 Asia/Taipei (Task 165 — release 0.9.58)

**Release**: the user approved the markdown cards and asked to deploy, commit and merge to `main`. Versions set to `0.9.58` (`version.ts`, `package.json`, lock, README badge); `docs/agent/CHANGELOG.md` gained a finalized 0.9.58 section (no pending wording, so the Release body published on the `main` push is correct). `main` was fast-forwarded to the release commit, so `main` and `dev` point at the same commit.

**Gap closed before release**: `sources/supabase/verify.sql` did not know Phase 2's tables. Added `user_discord_settings` and `user_discord_send_log` to the table list and the RLS list, and the table message now reads `all 19 present`. Installed on DEV and run: all 10 checks PASS. Pitfall recorded: `supabase db query "$(cat verify.sql)"` fails because the file's first line starts with `--`, which the CLI parses as a flag — use `supabase db query --linked --project-ref <ref> -f supabase/verify.sql`.

**Gate** (from `sources/`): `npm test` 149 files (148 passed, 1 skipped), 2,537 tests: 2,530 passed / 7 skipped; `npx tsc --noEmit`, `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0. DEV probes: `discord-accounts` and `discord-webhook` answer 401 without a token, the retired `discord-holdings-settings` answers 400.

**Not done — needs the user**: `git push origin dev main` (no credentials on this host). PROD Supabase has **none** of Task 165 applied yet — not even Phase 1's §13 — so a `main` push alone changes nothing on PROD's Edge or database. PROD rollout: §13 + §14 + §15 with the DEV identity predicate swapped for PROD's, cron jobs created by cloning an existing command, `stock-report` deployed with `--no-verify-jwt --use-api`, `verify.sql` installed with `-f`, `verify_setup()` run, the global webhook set in the PROD admin console. Awaiting explicit OK.

---

## 📅 Log: 2026-09-18 15:20:00 Asia/Taipei (Task 165 — card layout: 24 columns, markdown probe, markdown, 0.9.58-dev.10 → dev.12)

**Problem**: on a phone the fenced tables wrapped — the widest lines were 36 display columns and a phone message column fits about 33 — so the columns stopped lining up.

**Options shown**: a design canvas (artifact "Discord 卡片排版方案", private to the user) drew the current cards and four alternatives with the real 09/18 data at phone width: A native embed fields, B 24-column monospace, C fields + narrow table, D markdown, plus a comparison board.

**dev.10 (`c34e37e`, Revision 6)**: the user picked B. Every line ≤ 24 columns; indices rounded to whole points, margin without its header row, macro two lines per indicator, holdings seven to nine lines per position. Found on the way: `dispWidth` counted `▲ ▼ ─ ⚠` as one column although a CJK font draws them two wide, so title lines were really 25 — fixed by adding the box-drawing, geometric-shape and misc-symbol ranges to both `WIDE_RANGES` copies.

**dev.11 (`795eb85`, Revision 7)**: the user asked how markdown would look. Because Discord's `###` and `-#` are newer syntax that an old mobile client may print literally, a one-off sample (`markdownSample.ts`, op `markdown-sample`) was posted to the channel first instead of changing the cards. The user reported the US indices missing from it — the sample's numbers had been copied from the 09/16 test fixture, which deliberately leaves them empty; all eight index symbols return data in reality (checked).

**dev.12 (`6f9fed0`, Revision 8)**: markdown for both cards. Holdings: `未實現合計 **+X**（+P%）｜今日 +Y`, blank line, then `**代號 名稱**｜N 張|N 股｜均價 A｜未實現 **U**` per position — 市值, 成本, 今日已實現, 今年已實現, 空單市值 and the per-position price/return/break-even/realized lines are no longer rendered (still computed). Summary: every table row became `標籤 **數值** 圓點`; indices back to two decimals with a date only when stale; margin `融資 **N** 張（±Δ）`; macro `核心CPI **最新**（前值 X，期別）` or `（持平，期別）`. Data-derived text is markdown-escaped; the probe and the width machinery were removed, and the width drift guard in `scripts/lib/edgeConstants.test.mjs` now guards the two `escapeMd` copies instead.

**Verification**: `npm test` 2530 passed / 7 skipped; `npm run build`, `typecheck:edge`, `lint`, `sync-edge-engine --check` exit 0. DEV deploys v17 (24 columns), v18 (probe), v19 (markdown). After v19 a holdings preview (missing quotes 0) and a full-edition summary preview were sent to the user's channel with the real 09/18 data. Builder blockers on dev.10 and dev.12 were all stale assertions the main session had not updated in `discordRun.test.ts`, `holdingsRun.test.ts` and `edgeConstants.test.mjs` — fixed there, no production change needed.

**Next**: the user reviews the two real markdown cards on their phone; watch one real 17:30 / 21:30 round on DEV; PROD untouched and needs explicit OK.

