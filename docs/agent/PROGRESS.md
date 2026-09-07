# Progress Log (PROGRESS.md)

- Agent: Claude
- Action: 深度稽核九項查證與修正、0.9.34 發布與雙環境部署
- Status: **✅ COMPLETED**
- Timestamp: 2026-09-05 09:22:10 Asia/Taipei

---

## 📅 Log: 2026-09-07 10:08:52 Asia/Taipei (Task 146, 0.9.35 on PROD)

**Spec 146 rolled out to PROD.** DEV and PROD now run the same bundle and the same schema.

**Database** (`hrilemueiqyaoiwnkeuu`): `app_log`, RLS on with exactly one INSERT policy and no SELECT policy, three indexes plus the primary key, `admin_recent_app_logs()` granted to `service_role` only, and the `app-log-prune` cron. The DDL was copied verbatim out of the committed `sources/supabase/schema.sql` §6d-2 at commit `3f7b423`, with a PROD identity guard in the same request, so a wrong target would have aborted the transaction instead of writing into DEV.

Verified on PROD: `is_prod=true`, `is_dev=false`, `policies=1`, `select_policies=0`, `idx=4`, `rpc=1`, `service_role` EXECUTE true, `authenticated` EXECUTE false, `cron_jobs=7`, `prune_job=1`. **PROD cron count is now 7, not 6.** RLS five cases match DEV exactly: own `web` row ALLOWED; own `web` row with `RETURNING` DENIED; own `edge` row DENIED; another user's row DENIED; `SELECT` returns nothing. The probe rows were deleted; the table is empty.

**Edge Functions**: `stock-report` v8, `stock-price` v5, `backup-transactions` v4. All three `ezbr_sha256` are byte-identical to the DEV deployment (`11fd4dcd…`, `30240a50…`, `1fd264b0…`), and every `verify_jwt` kept its previous value — `false`, `true`, `false`. Live on PROD: a POST body of literal `null` returns 400 `Invalid JSON body`, and `app-logs` returns 401 with no credential.

**One check was deliberately not run on PROD.** Forcing a real exception to prove end-to-end capture means sending a malformed request to a production endpoint on purpose. The evidence used instead is stronger and free: the deployed bundles are byte-identical to DEV, where that exact path was proven — a real `TypeError` reached `app_log` with its stack and nothing else in `detail`.

**Three access tokens expired mid-session, and the CLI hid it.** An expired token does not report as an auth failure: the Management API call fails, the CLI falls back to a direct database connection, and that surfaces as `IPv6 is not supported on your current network` with a suggestion to run `supabase link` — which would have cleared the DEV link and made things worse. `npx supabase projects list` answering `Unauthorized` is the one-command test.

**Also learned**: `--project-ref` is accepted only together with `--linked`. That pair names the project explicitly and removes the cwd trap that `db query --linked` alone carries, which is how every PROD write in this session was addressed.

---

## 📅 Log: 2026-09-06 16:40:00 Asia/Taipei (Task 146, 0.9.35 released)

**Live DEV verification of Spec 146, then the release.**

Six checks against the deployed DEV project, not against mocks:

1. **A real Edge exception is captured.** `POST /functions/v1/stock-price` with `{"action":"prices","symbols":[null]}` threw `Cannot read properties of null (reading 'market')` and returned 500. The row landed in `app_log`: `level=error`, `source=edge`, `action=prices`, message intact, a 479-character stack, and `detail` minus `stack` was `{}` — nothing extra leaked through the allowlist.
2. **`app-logs` is closed.** 401 with no credential, 401 with the anon key alone.
3. **The `null`-body defect stays fixed on the deployed bundle.** A POST body of literal `null` returns 400, not a dropped connection.
4. **The RPC reads and filters.** `admin_recent_app_logs` returned the rows and honoured the `level` filter.
5. **The RLS policy behaves as designed**, tested as the `authenticated` role carrying a real user's claims: own `web` row ALLOWED; own `web` row with `RETURNING` DENIED; own `edge` row DENIED; a row attributed to another `user_id` DENIED; `SELECT` returns nothing.
6. **The app boots against DEV.** Version badge `0.9.35-dev.2` at the time of the check, no console errors, no page errors, the ErrorBoundary fallback not triggered.

**Check 5 found a trap worth keeping.** The first run reported the user's own `web` insert as DENIED, which would have meant every client-side log failing silently in production. The cause was the test itself using `INSERT ... RETURNING`: PostgreSQL requires a `SELECT` policy for `RETURNING`, and this table deliberately has none. `supabase-js` adds `RETURNING` only when `.select()` is chained, and `appLog.ts` does not chain it — so the production path is correct. A regression test now pins it, because chaining `.select()` later would break every client log with no symptom: `logClient` swallows its own errors by design.

**Not verified, and stated plainly**: the admin panel's own UI, and a log written from a real browser session. Both need an admin login, which this session did not have. The panel's data layer is covered by unit tests and by check 4 above; its rendering is not covered by anything but `AdminConsolePage.test.tsx`'s panel-list assertion.

**Release**: `0.9.35-dev.1` and `-dev.2` are consolidated into one `0.9.35` section in `CHANGELOG.md`. Version synchronized across `version.ts`, `package.json`, `package-lock.json` and the README badge.

**Verification**: `npx vitest run` 103 files / **1732** tests passed, exit 0. `npm run build` exit 0. `npm run typecheck:edge` exit 0. `npx oxlint src` 0 errors.
