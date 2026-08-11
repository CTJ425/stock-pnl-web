-- Production: admin_run_log + admin_schedule_status merge (0.6.44-dev.3)
-- Target: kxnxadaghidwumqsqneu — identity first

DO $$
DECLARE
  n int;
  url text;
BEGIN
  SELECT count(*) INTO n FROM batch_run_log;
  IF n < 1 THEN
    RAISE EXCEPTION 'identity check failed: empty batch_run_log';
  END IF;
  SELECT (regexp_match(command, 'url\s*:=\s*''https://([^.]+)\.'))[1]
    INTO url FROM cron.job WHERE jobname = 'stock-report-nightly' LIMIT 1;
  IF url IS DISTINCT FROM 'kxnxadaghidwumqsqneu' THEN
    RAISE EXCEPTION 'identity check failed: nightly ref=% (want kxnxadaghidwumqsqneu)', url;
  END IF;
  RAISE NOTICE 'identity ok batch=% ref=%', n, url;
END $$;

CREATE TABLE IF NOT EXISTS admin_run_log (
    id           BIGSERIAL PRIMARY KEY,
    jobname      TEXT NOT NULL,
    action       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMPTZ,
    ok           BOOLEAN,
    http_status  INT,
    duration_ms  INT,
    triggered_by UUID
);

ALTER TABLE admin_run_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS admin_run_log_job_finished_idx
  ON admin_run_log (jobname, finished_at DESC);

CREATE OR REPLACE FUNCTION public.admin_schedule_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(jsonb_agg(t ORDER BY t->>'jobname'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
             'jobid',      j.jobid,
             'jobname',    j.jobname,
             'schedule',   j.schedule,
             'active',     j.active,
             'action',     (regexp_match(j.command, '"action"\s*:\s*"([a-z-]+)"'))[1],
             'targetRef',  (regexp_match(j.command, 'url\s*:=\s*''https://([^.]+)\.'))[1],
             'lastRun',    CASE
                             WHEN m.last_manual IS NOT NULL
                              AND (r.last_run IS NULL OR m.last_manual >= r.last_run)
                             THEN m.last_manual
                             ELSE r.last_run
                           END,
             'lastStatus', CASE
                             WHEN m.last_manual IS NOT NULL
                              AND (r.last_run IS NULL OR m.last_manual >= r.last_run)
                             THEN CASE WHEN m.last_ok THEN 'succeeded' ELSE 'failed' END
                             ELSE r.last_status
                           END,
             'lastSource', CASE
                             WHEN m.last_manual IS NOT NULL
                              AND (r.last_run IS NULL OR m.last_manual >= r.last_run)
                             THEN 'manual'
                             WHEN r.last_run IS NOT NULL THEN 'cron'
                             ELSE NULL
                           END,
             'runsToday',  coalesce(r.runs_today, 0) + coalesce(m.runs_today, 0),
             'failsToday', coalesce(r.fails_today, 0) + coalesce(m.fails_today, 0)
           ) AS t
    FROM cron.job j
    LEFT JOIN LATERAL (
      SELECT
        max(d.start_time)                                      AS last_run,
        (array_agg(d.status ORDER BY d.start_time DESC))[1]     AS last_status,
        count(*) FILTER (
          WHERE (d.start_time AT TIME ZONE 'Asia/Taipei')::date
              = (now() AT TIME ZONE 'Asia/Taipei')::date
        )                                                       AS runs_today,
        count(*) FILTER (
          WHERE d.status <> 'succeeded'
            AND (d.start_time AT TIME ZONE 'Asia/Taipei')::date
              = (now() AT TIME ZONE 'Asia/Taipei')::date
        )                                                       AS fails_today
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
        AND d.start_time > now() - interval '2 days'
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT
        max(a.finished_at) AS last_manual,
        (array_agg(a.ok ORDER BY a.finished_at DESC NULLS LAST))[1] AS last_ok,
        count(*) FILTER (
          WHERE a.finished_at IS NOT NULL
            AND (a.finished_at AT TIME ZONE 'Asia/Taipei')::date
              = (now() AT TIME ZONE 'Asia/Taipei')::date
        ) AS runs_today,
        count(*) FILTER (
          WHERE a.ok IS DISTINCT FROM true
            AND a.finished_at IS NOT NULL
            AND (a.finished_at AT TIME ZONE 'Asia/Taipei')::date
              = (now() AT TIME ZONE 'Asia/Taipei')::date
        ) AS fails_today
      FROM public.admin_run_log a
      WHERE a.jobname = j.jobname
        AND a.finished_at > now() - interval '2 days'
    ) m ON true
  ) s;
$$;

REVOKE ALL ON FUNCTION public.admin_schedule_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_schedule_status() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schedule_status() TO service_role;

SELECT
  to_regclass('public.admin_run_log') AS admin_run_log,
  (SELECT count(*) FROM batch_run_log) AS batch_rows,
  (SELECT proname FROM pg_proc WHERE proname = 'admin_schedule_status') AS schedule_fn;
