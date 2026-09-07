# Progress Log (PROGRESS.md)

- Agent: Antigravity
- Action: 帳號頭像重構為現代扁平人像圖標（Style 06 當代雙弧線條）、0.9.36 正式發布與雙分支合併
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-07 10:40:00 Asia/Taipei

---

## 📅 Log: 2026-09-07 10:40:00 Asia/Taipei (0.9.36 released: 帳號頭像現代扁平化重構)

**User Avatar Redesign: Style 06 (Contemporary Architect Arc) released as 0.9.36.**

- **Problem**: Previously, `AppShell.tsx:406` extracted the first two characters of the user's email/account (`email.slice(0, 2).toUpperCase() || 'ME'`) to render inside the circular 30px avatar badge (`.hmenu-avatar`). For phone/number-based accounts, this rendered disjointed digits like `09` or `88`, causing visual discord and lacking modern financial identity.
- **Solution**: Designed 6 modern flat icon concepts and a dedicated set of 6 human persona variants with interactive HTML demo in `docs/avatar-icon-designs.html`. Per user selection, implemented **Style 06: 當代雙弧線條人像 (`Contemporary Architect Arc`)** in `sources/src/components/AppShell.tsx`.
- **Implementation**:
  1. Embedded clean vector `AvatarIcon` (solid circle head + dual-arc minimalist shoulder contours) with `size={16}`.
  2. Inherits `--steel-on` foreground color on `--accent-strong` circle badge with zero layout shifts.
  3. Removed obsolete `initials` extraction while preserving `email` in accessible `triggerLabel` and dropdown menu header.
- **5-File Synchronization**: Bumper to `0.9.36-dev.1` across `version.ts`, `package.json`, `package-lock.json`, `README.md`, and `docs/agent/CHANGELOG.md`.
- **Verification**: `npm test` passed (103 files / 1,732 tests, exit 0); `npm run build` passed (`tsc -b && vite build`, exit 0); `npm run typecheck:edge` passed (exit 0); `npx oxlint src` passed (0 errors).

---

## 📅 Log: 2026-09-07 10:08:52 Asia/Taipei (Task 146, 0.9.35 on PROD)

**Spec 146 rolled out to PROD.** DEV and PROD now run the same bundle and the same schema.

**Database** (`hrilemueiqyaoiwnkeuu`): `app_log`, RLS on with exactly one INSERT policy and no SELECT policy, three indexes plus the primary key, `admin_recent_app_logs()` granted to `service_role` only, and the `app-log-prune` cron. The DDL was copied verbatim out of the committed `sources/supabase/schema.sql` §6d-2 at commit `3f7b423`, with a PROD identity guard in the same request, so a wrong target would have aborted the transaction instead of writing into DEV.

Verified on PROD: `is_prod=true`, `is_dev=false`, `policies=1`, `select_policies=0`, `idx=4`, `rpc=1`, `service_role` EXECUTE true, `authenticated` EXECUTE false, `cron_jobs=7`, `prune_job=1`. **PROD cron count is now 7, not 6.** RLS five cases match DEV攻 matching DEV exactly: own `web` row ALLOWED; own `web` row with `RETURNING` DENIED; own `edge` row DENIED; another user's row DENIED; `SELECT` returns nothing. The probe rows were deleted; the table is empty.

**Edge Functions**: `stock-report` v8, `stock-price` v5, `backup-transactions` v4. All three `ezbr_sha256` are byte-identical to the DEV deployment (`11fd4dcd…`, `30240a50…`, `1fd264b0…`), and every `verify_jwt` kept its previous value — `false`, `true`, `false`. Live on PROD: a POST body of literal `null` returns 400 `Invalid JSON body`, and `app-logs` returns 401 with no credential.

**One check was deliberately not run on PROD.** Forcing a real exception to prove end-to-end capture means sending a malformed request to a production endpoint on purpose. The evidence used instead is stronger and free: the deployed bundles are byte-identical to DEV, where that exact path was proven — a real `TypeError` reached `app_log` with its stack and nothing else in `detail`.

**Three access tokens expired mid-session, and the CLI hid it.** An expired token does not report as an auth failure: the Management API call fails, the CLI falls back to a direct database connection, and that surfaces as `IPv6 is not supported on your current network` with a suggestion to run `supabase link` — which would have cleared the DEV link and made things worse. `npx supabase projects list` answering `Unauthorized` is the one-command test.

**Also learned**: `--project-ref` is accepted only together with `--linked`. That pair names the project explicitly and removes the cwd trap that `db query --linked` alone carries, which is how every PROD write in this session was addressed.
