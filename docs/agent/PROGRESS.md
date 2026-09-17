# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: Task 165 Phase 2 — spec approved; step 2a (Edge copy of the ledger engine) committed on `dev`
- Status: 🔄 **0.9.58-dev.1 on `dev`** (not pushed) — `main` stays 0.9.57; PROD Supabase for Phase 1 still awaits explicit OK
- Timestamp: 2026-09-17 17:19:33 Asia/Taipei

---

## 📅 Log: 2026-09-17 17:19:33 Asia/Taipei (Task 165 Phase 2 step 2a, 0.9.58-dev.1)

**Phase 2 planned and approved** (per-user Discord holdings card): spec `docs/agent/specs/discord-holdings.md`. User decisions D1–D6: each user's own webhook; full amounts; all workspaces merged into one card (TWD/USD separate, no FX); daily 17:15 after the brief; `workspaces.fee_rate` is already in the DB; **D6 — existing core code is not modified** (frozen file list in spec §0). BUG-084 (stale per-workspace 最低手續費 in localStorage) opened and accepted as a known difference.

**Step 2a — Edge copy of the ledger engine, core untouched**:
- `scripts/lib/edgeEngine.cjs` + `scripts/sync-edge-engine.cjs` (`npm run sync:edge-engine`, `--check`) generate `supabase/functions/_shared/engine/pnlEngine.ts` and `models.ts`. The only textual change is the two `'../types/models'` imports → `'./models.ts'`. The renderer throws on any other import (relative, bare, side-effect, dynamic, or a source already spelling `./models.ts`); every target is rendered before any is written.
- `scripts/lib/edgeEngine.test.mjs` (19 cases): drift (committed copy equals a fresh render), parity (same exports; identical `computeLedger` / `estimateUnrealized` / `estimateUnrealizedShort` on a fixture with long, short, US fractional shares and an oversell warning), renderer guards.
- Reviewer PASS with 4 RISKs: two fixed (source spelling `./models.ts`; partial write), two accepted (the literal rewrite could also touch a comment; a mid-line side-effect import is not detected).
- Note: builder's direct `node scripts/sync-edge-engine.cjs` was refused by the write-scope guard (`_shared/engine` is not in `paths.prod`); it ran the same script via `npm run sync:edge-engine`.

**Verification** (from `sources/`): `npm test` 138 files, 2220 passed / 7 skipped; `npm run build`, `npm run typecheck:edge`, `npm run lint`, `node scripts/sync-edge-engine.cjs --check` exit 0; `git diff` of every D6 file empty (only `src/version.ts` changed under `src/`). Deno 2.9.6 (`npx deno@2`): `deno check` on both generated files exit 0, and a script importing the generated engine ran all three functions. E2E: `run-all-e2e.cjs` against Supabase-mode vite on 127.0.0.1:5317 — 16/16 suites, 49 steps, 0 failed (Playwright Chromium installed on this host first).

**Next**: step 2b — `holdingQuotes.ts` + `holdingsCard.ts` (spec §2.2–2.4), tests first. Supabase untouched in 2a; nothing deployed.

---

## 📅 Log: 2026-09-17 16:33:21 Asia/Taipei (Task 165, 0.9.57 — merged to `main`)

**Released 0.9.57** at the user's request: `dev` fast-forwarded into `main`, both branches synced. The frontend goes live through Cloudflare Pages from `main`. PROD Supabase was not touched: schema §13 is not applied and `stock-report` is not redeployed, so the PROD admin console's Discord panel answers an error until both are done (awaiting explicit OK).

**Changes since 0.9.57-dev.1** (all verified on DEV; `stock-report` v9 → v12):
- dev.2 `e179a32`: the admin Discord panel gains a collapsible webhook setup guide (no Bot or API key needed; 7 steps; security note).
- dev.3 `6dc6f52`: 預覽快報 / 預覽完整版 send the real content immediately (`【預覽】` prefix, logged as `test`, never take the daily slot, fall back to the latest market day, skip rows with a malformed `date`). Error messages add known codes, e.g. `HTTP 409：找不到任何台股大盤資料`. Review round 1 FAIL (a malformed date could be chosen as latest) was fixed.
- dev.4 `cda426c`: one card per block, 🔴 / 🟢 / ⚪, a per-card data stamp (`09/17 15:05 更新`, `⚠️ 09/16 資料・非今日`), 盤後初步／完整 from the `market/daily.json` `asOf` (19:30 Taipei). Found while designing it: the newest USD/TWD point was 09/16 while the earlier brief presented it as today's. Review PASS; an unparseable `asOf` is now treated as unknown.
- dev.5 `963bfa3`: card bodies became monospace tables padded by display width (CJK and emoji count 2); Chinese names kept per the user; macro labels shortened by FRED id. The admin send log shows Asia/Taipei `YYYY-MM-DD HH:mm:ss`.

**DEV evidence**: the user set the webhook; the test send at 15:11 and the previews from 15:25 are HTTP 200 in `discord_send_log`. Every deploy was re-checked with 401 on unauthenticated calls and a 200 from the next `source-probe` call.

**Verification** (from `sources/`): `npm test` 137 files, 2201 passed / 7 skipped; a `TZ=UTC` rerun of the layout and log-time tests passed; `npm run build`, `npm run typecheck:edge`, `npm run lint` exit 0.

**Next**: PROD — apply §13 (clone an existing job's command behind the identity guard, then `verify_setup()`), deploy `stock-report` with `--no-verify-jwt --use-api`, set the PROD webhook. Watch the first real DEV 17:05 / 21:30 rounds and check phone alignment of the 國際指數 / 美國總經 tables.

