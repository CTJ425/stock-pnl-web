-- =========================================================
-- verify.sql — acceptance check for a stock-pnl-web database
-- =========================================================
--
--   Run this after applying schema.sql, and ALWAYS after a project is created,
--   recreated, restored, or migrated. It answers one question: is this database
--   actually wired up, or does it only look like it?
--
--   Why it exists. schema.sql §6d has carried a written checklist since BUG-002.
--   A checklist that asks a human to run a query and read it did not prevent the
--   same defect from shipping three times — most recently on 2026-08-31, when both
--   cloud projects were recreated and all 12 cron jobs kept the literal
--   `<PROJECT_REF>` and `<CRON_SECRET>`. They had never run once (OPS-001).
--
--   So this file is executable, not prose:
--
--     \i verify.sql                       -- installs the function
--     SELECT * FROM verify_setup();       -- the report
--     SELECT assert_setup_ok();           -- raises if anything FAILs
--
--   `assert_setup_ok()` is the one to put in a script or a CI step: silence means
--   healthy, and a failure is impossible to overlook.
--
--   What it cannot prove: that the cron secret equals the Edge Function's
--   CRON_SECRET. Secrets do not live in the database. The only evidence is a cron
--   round returning 200 rather than 401, which the `cron http (recent)` row reports
--   from `net._http_response` — retained for about 6 hours, so look soon after a run.

CREATE OR REPLACE FUNCTION public.verify_setup()
RETURNS TABLE (check_name text, status text, detail text)
LANGUAGE plpgsql
AS $fn$
DECLARE
  secret_re CONSTANT text := $q$'x-cron-secret',\s*'([^']*)'$q$;
BEGIN
  -- ---- tables -------------------------------------------------------------
  RETURN QUERY
  WITH want(t) AS (
    VALUES ('workspaces'),('transactions'),('price_cache'),('stock_names'),
           ('user_settings'),('tw_watchlist'),('chip_raw_cache'),('warm_quota'),
           ('batch_run_log'),('backup_run_log'),('admin_run_log'),
           ('source_probe_log'),('source_probe_tick'),('app_settings')
  ), missing AS (
    SELECT string_agg(t, ', ' ORDER BY t) AS m FROM want
     WHERE t NOT IN (SELECT table_name FROM information_schema.tables
                      WHERE table_schema = 'public')
  )
  SELECT 'tables',
         CASE WHEN m IS NULL THEN 'PASS' ELSE 'FAIL' END,
         COALESCE('missing: ' || m, 'all 14 present')
    FROM missing;

  -- ---- columns added by later migrations ----------------------------------
  -- A recreated project is built from whatever schema.sql was current, so every
  -- ADD COLUMN that shipped after the last full rebuild has to be re-checked here.
  RETURN QUERY
  WITH want(tbl, col) AS (
    VALUES ('workspaces','fee_rate'),      -- 0.9.24, task 135
           ('transactions','tx_nature'),   -- 0.9.25, task 137 §C
           ('transactions','fee_rate')     -- 0.9.27, fee_rate persistence
  ), missing AS (
    SELECT string_agg(tbl || '.' || col, ', ' ORDER BY tbl, col) AS m FROM want w
     WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns c
                        WHERE c.table_schema='public' AND c.table_name=w.tbl
                          AND c.column_name=w.col)
  )
  SELECT 'migration columns',
         CASE WHEN m IS NULL THEN 'PASS' ELSE 'FAIL' END,
         COALESCE('missing: ' || m, 'fee_rate, tx_nature present')
    FROM missing;

  -- ---- extensions ---------------------------------------------------------
  RETURN QUERY
  SELECT 'extensions',
         CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END,
         'pg_cron+pg_net installed: ' || count(*) || '/2'
    FROM pg_extension WHERE extname IN ('pg_cron','pg_net');

  -- ---- storage bucket -----------------------------------------------------
  RETURN QUERY
  SELECT 'reports bucket',
         CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN count(*) = 1 THEN 'present and public' ELSE 'missing or not public' END
    FROM storage.buckets WHERE id = 'reports' AND public;

  -- ---- cron jobs exist and are active -------------------------------------
  RETURN QUERY
  SELECT 'cron jobs',
         CASE WHEN count(*) >= 6 AND count(*) FILTER (WHERE NOT active) = 0
              THEN 'PASS' ELSE 'FAIL' END,
         count(*) || ' job(s), ' || count(*) FILTER (WHERE NOT active) || ' inactive'
    FROM cron.job;

  -- ---- the defect this file exists for ------------------------------------
  RETURN QUERY
  SELECT 'cron placeholders',
         CASE WHEN u = 0 AND s = 0 THEN 'PASS' ELSE 'FAIL' END,
         CASE WHEN u = 0 AND s = 0 THEN 'none'
              ELSE u || ' job(s) keep <PROJECT_REF>, ' || s || ' keep <CRON_SECRET>' END
    FROM (SELECT count(*) FILTER (WHERE command LIKE '%<PROJECT_REF>%')     AS u,
                 count(*) FILTER (WHERE command LIKE '%''<CRON_SECRET>''%') AS s
            FROM cron.job) t;

  -- ---- BUG-003 variant: substituted, but with another project's ref -------
  -- Every job must call the SAME host. Which host is right cannot be decided in here,
  -- so the host is printed: it is not a secret, and reading it is the confirmation.
  -- Matched generically, because a self-hosted deployment is not on supabase.co.
  RETURN QUERY
  SELECT 'cron target host',
         CASE WHEN count(DISTINCT h) = 1 THEN 'PASS' ELSE 'FAIL' END,
         COALESCE(string_agg(DISTINCT h, ', '), 'no job issues an https call')
    FROM (SELECT (regexp_match(command, 'https://([^/'']+)'))[1] AS h
            FROM cron.job WHERE command LIKE '%https://%') t;

  -- ---- secret shape (never the value) -------------------------------------
  RETURN QUERY
  SELECT 'cron secret shape',
         CASE WHEN count(DISTINCT s) = 1 AND min(length(s)) <> 13 AND min(length(s)) >= 20
              THEN 'PASS' ELSE 'FAIL' END,
         count(DISTINCT s) || ' distinct value(s), length ' || COALESCE(min(length(s)), 0) ||
         CASE WHEN min(length(s)) = 13 THEN ' — that is the placeholder' ELSE '' END
    FROM (SELECT (regexp_match(command, secret_re))[1] AS s
            FROM cron.job WHERE command LIKE '%x-cron-secret%') t;

  -- ---- the only proof the secret matches the Edge Function ----------------
  RETURN QUERY
  SELECT 'cron http (recent)',
         CASE WHEN count(*) = 0 THEN 'UNKNOWN'
              WHEN count(*) FILTER (WHERE status_code = 200) > 0
               AND count(*) FILTER (WHERE status_code = 401) = 0 THEN 'PASS'
              ELSE 'FAIL' END,
         CASE WHEN count(*) = 0
              THEN 'no response in the last 6h — wait for a cron round and re-run'
              ELSE string_agg(DISTINCT status_code || '', ', ' ORDER BY status_code || '') END
    FROM net._http_response WHERE created > now() - interval '6 hours';

  -- ---- RLS ----------------------------------------------------------------
  RETURN QUERY
  SELECT 'row level security',
         CASE WHEN count(*) FILTER (WHERE NOT c.relrowsecurity) = 0 THEN 'PASS' ELSE 'FAIL' END,
         count(*) FILTER (WHERE NOT c.relrowsecurity) || ' user table(s) without RLS'
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('workspaces','transactions','user_settings','tw_watchlist');
END
$fn$;

COMMENT ON FUNCTION public.verify_setup() IS
  'Acceptance check for a stock-pnl-web database. See sources/supabase/verify.sql.';

CREATE OR REPLACE FUNCTION public.assert_setup_ok()
RETURNS text
LANGUAGE plpgsql
AS $fn$
DECLARE
  failed text;
BEGIN
  SELECT string_agg(check_name || ' (' || detail || ')', '; ' ORDER BY check_name)
    INTO failed
    FROM public.verify_setup() WHERE status = 'FAIL';

  IF failed IS NOT NULL THEN
    RAISE EXCEPTION 'stock-pnl-web setup is incomplete: %', failed;
  END IF;
  RETURN 'ok';
END
$fn$;

COMMENT ON FUNCTION public.assert_setup_ok() IS
  'Raises unless every verify_setup() check passes. Put this in the setup script or CI.';
