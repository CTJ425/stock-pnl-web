-- Task 161 — keep the google AI key out of the browser.
-- Contains no secret value. Both parts are idempotent.
--
-- ⚠️ RUN THE TWO PARTS AT DIFFERENT TIMES. The order below is not a style preference.
--
--   PART A  ->  deploy `ai-proxy`  ->  upload the new frontend  ->  PART B
--
-- PART B is the only step that breaks the frontend that is live right now. A pre-0.9.51
-- build reads `ai_api_key` straight off the table, so running PART B before that build is
-- replaced takes the AI 分析 tab offline (it reports "not configured") until the upload
-- lands. PART A is safe at any time: it only adds a function nothing calls yet.
--
-- Applied to DEV (zyebvayngwrqzoaicbwd) 2026-09-14 — both parts at once, which is fine
-- there because DEV has no separately-hosted frontend to fall out of step.

-- ============================================================================
-- PART A — safe to run at any time. Adds the reader the new frontend needs.
-- ============================================================================

-- SECURITY DEFINER so it can still see the key server-side to report `ai_has_key`,
-- but it never returns the key itself for the google provider.
-- openai-compatible keeps returning its key: that path stays browser-direct (spec 161 §2).
CREATE OR REPLACE FUNCTION public.get_ai_settings()
RETURNS TABLE (ai_provider TEXT, ai_base_url TEXT, ai_model TEXT, ai_api_key TEXT, ai_has_key BOOLEAN)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ai_provider, ai_base_url, ai_model,
         CASE WHEN ai_provider = 'google' THEN '' ELSE COALESCE(ai_api_key, '') END,
         (ai_api_key IS NOT NULL AND ai_api_key <> '')
  FROM app_settings WHERE id = 1;
$$;

REVOKE ALL ON FUNCTION public.get_ai_settings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ai_settings() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- PART B — run ONLY after the 0.9.51 (or later) frontend is live.
-- This is the step that actually closes the leak.
-- ============================================================================
--
-- Order inside PART B matters and is not optional. Supabase grants `authenticated`
-- table-level SELECT on every table in `public`, and Postgres checks the table-level
-- privilege before the column one. A bare `REVOKE SELECT (ai_api_key) ... FROM authenticated`
-- therefore reports REVOKE and changes nothing — measured 2026-09-14 on supabase/postgres
-- 17.6, the value still came back. Revoke the table-level SELECT first, then grant back
-- every column except the key.

BEGIN;

REVOKE SELECT ON public.app_settings FROM authenticated, anon;

-- Every column EXCEPT ai_api_key. A column added later stays unreadable until it is listed here.
GRANT SELECT (id, ai_provider, ai_base_url, ai_model, ai_updated_at, ai_prompt_analysis, ai_prompt_chat)
  ON public.app_settings TO authenticated;

COMMIT;

-- ============================================================================
-- Verify (run after PART B). Expected, in order:
--   is_dev/is_prod    — confirm you are on the project you meant to touch
--   auth_reads_key    — false   (the whole point)
--   auth_reads_model  — true    (the app still works)
--   auth_can_update   — true    (an admin can still save settings)
--   auth_execs_rpc    — true
--   anon_execs_rpc    — false
--   security_definer  — true
--   rpc_key_len       — 0 when the provider is google
-- ============================================================================
--
-- SELECT
--   has_column_privilege('authenticated','public.app_settings','ai_api_key','SELECT')     AS auth_reads_key,
--   has_column_privilege('authenticated','public.app_settings','ai_model','SELECT')       AS auth_reads_model,
--   has_table_privilege ('authenticated','public.app_settings','UPDATE')                  AS auth_can_update,
--   has_function_privilege('authenticated','public.get_ai_settings()','EXECUTE')          AS auth_execs_rpc,
--   has_function_privilege('anon','public.get_ai_settings()','EXECUTE')                   AS anon_execs_rpc,
--   (SELECT prosecdef FROM pg_proc WHERE proname='get_ai_settings')                       AS security_definer,
--   (SELECT length(ai_api_key) FROM get_ai_settings())                                    AS rpc_key_len;
--
-- Never select ai_api_key itself — print its length, not its value.
