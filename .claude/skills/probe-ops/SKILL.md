---
name: probe-ops
description: Diagnose the after-hours source probe (source-probe cron, source_probe_tick, probeSource) on DEV or PROD. Use when a probe source never fires, a probe round times out, a source never retires, or you need to prove whether a source has ever been probed.
---

# Probe diagnosis

The probe answers exactly one question: **what time of day does this source publish?**
When it misbehaves, the failure is almost always in *dispatch* (the source is never
scheduled, or `probeSource` does not recognise it), not in the fetch.

## The three tables lie in order — read them in this order

Two of them report success for a round that produced nothing. Checking only the first
is how a broken probe reads as healthy.

| Step | Table | What it actually proves | Trap |
| --- | --- | --- | --- |
| 1 | `cron.job_run_details` | pg_cron fired and `net.http_post` **queued** a request | `status = 'succeeded'` says nothing about the HTTP call. `return_message = '1 row'` is just the queued request id |
| 2 | `net._http_response` | the real HTTP outcome: `status_code`, `error_msg` | **Retention is only ~6 hours.** Anything older is gone — capture it the same session |
| 3 | `source_probe_tick` | the round actually ran and wrote per-source rows | A tick is written **before** the fetch, so *no tick at all* means the hang is upstream of probing |

On 2026-08-18 those three read, for the same 21:30 round: `succeeded` / `Timeout of
60000 ms reached` / no rows.

```sql
-- 1: did cron fire?  (NEVER select command — it carries x-cron-secret)
SELECT d.jobid, j.jobname, d.status,
       to_char(d.start_time AT TIME ZONE 'Asia/Taipei','HH24:MI:SS') AS started
FROM cron.job_run_details d JOIN cron.job j ON j.jobid = d.jobid
WHERE d.start_time > now() - interval '30 minutes' ORDER BY d.start_time DESC;

-- 2: what did the HTTP call actually return?
SELECT id, status_code, left(coalesce(error_msg,''),80) AS err,
       to_char(created AT TIME ZONE 'Asia/Taipei','HH24:MI') AS t
FROM net._http_response WHERE created > now() - interval '30 minutes' ORDER BY created DESC;

-- 3: did the round write ticks?
SELECT taipei_time, source, hit, ok, rows, left(note,50) AS note
FROM source_probe_tick
WHERE taipei_ymd = to_char(now() AT TIME ZONE 'Asia/Taipei','YYYYMMDD')
ORDER BY taipei_time DESC, source;

-- has a source EVER been probed?  0 here is the signature of a dispatch gap.
SELECT count(*) FROM source_probe_tick WHERE source = '<id>';
```

Run them against DEV with `docker exec stock-pnl-web-dev-db-1 psql -U postgres -d postgres`.
Do **not** reach for `supabase db query --linked` — it resolves against the current working
directory and has silently written to PROD before (see `supabase-ops`).

## A source that never fires: check both halves of the dispatch path

`twt38u` was defined everywhere and still never probed once, because dispatch is two
independent places and each can be missing on its own (BUG-029, 0.7.22):

1. **`sourceProbePlan.ts` → `sourcesForTaipeiTime()`** must emit the id. It now derives the
   daily list from `Object.keys(DAILY_WINDOWS)`; a hardcoded second list is what hid the bug.
2. **`index.ts` → `probeSource()`** must have an `if (id === '<id>')` branch. Without one the
   tick falls through to `fail('unknown source')`: never hits, never retires, re-probes the
   whole window every 5 minutes forever.

A source also needs a `fingerprint` on its tick when `REQUIRE_SETTLED_CONTENT[id]` is true —
a null fingerprint can never settle, so the source never retires.

**No vitest test executes `probeSource`** — `index.ts` is Deno-only. `npm run typecheck:edge`
plus a reviewer are the only gates on that half. Do not read a green suite as end-to-end proof.

## Timeouts: two different limits, and they disagree

- **Edge worker wall clock: 150 s per request**, a fresh worker per request
  (`workerTimeoutMs` in `volumes/functions/main/index.ts` on DEV).
- **pg_net client gives up at 60 s.** So a round can still be running when cron already
  recorded a timeout. `wall clock duration reached ... in_flight_req_exists = true` in the
  functions container log is the worker being killed mid-request.

**Manual probe calls contend with the cron rounds.** Issuing `{"action":"probe"}` by hand while
diagnosing produces exactly the 60 s timeouts that look like the regression you are hunting —
this happened on 2026-08-18 and cost two rounds. **Stop calling it and watch two cron ticks
before concluding anything.**

`probeRound.ts` has no per-source deadline check (open RISK-001), so a window with several
overlapping sources is the realistic timeout case: 17:00 carries `t86` + `bwibbu` + `twt38u`,
and 17:15/17:20 add both MOPS sources.

## You cannot force a window

`handleProbe()` reads the real clock and takes no time-override parameter. A source can only be
verified inside its own `DAILY_WINDOWS` slot, on a weekday. Plan the check for that time or wait.

## Deploying a probe fix

- **DEV**: volume copy into `/root/container/supabase/stock-pnl-web-dev/volumes/functions/stock-report/`
  then `docker compose up -d --force-recreate functions` from the compose dir. `cp` is interactive
  here — use `command cp -f`, and re-run `diff -rq` afterwards to prove the copy landed.
- **PROD**: `supabase functions deploy stock-report --project-ref <ref> --no-verify-jwt` from
  `sources/`. Confirm with the `ezbr_sha256` change from `functions list`, not the version number.
- `git push` does **not** deploy an Edge Function.

## Secrets

`cron.job.command` and Edge logs carry `x-cron-secret` and Supabase keys. Never select the command
text, redacted or otherwise. When reading container logs, filter before printing.
