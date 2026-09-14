-- Task 161 — keep the google AI key out of the browser.
-- Apply to DEV first, then PROD. Idempotent: safe to run more than once.
-- Contains no secret value.
--
-- Order matters and is not optional. Supabase grants `authenticated` table-level SELECT on
-- every table in `public`, and Postgres checks the table-level privilege before the column
-- one. A bare `REVOKE SELECT (ai_api_key) ... FROM authenticated` therefore reports REVOKE
-- and changes nothing — measured 2026-09-14 on supabase/postgres 17.6, the value still came
-- back. Revoke the table-level SELECT first, then grant back every column except the key.

BEGIN;

REVOKE SELECT ON public.app_settings FROM authenticated, anon;

-- Every column EXCEPT ai_api_key. A column added later stays unreadable until it is listed here.
GRANT SELECT (id, ai_provider, ai_base_url, ai_model, ai_updated_at, ai_prompt_analysis, ai_prompt_chat)
  ON public.app_settings TO authenticated;

-- The browser reads settings through this function instead of the table.
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

COMMIT;

-- Verify (expect: step 1 raises "permission denied for table app_settings",
--         step 2 returns the row, step 3 returns an empty ai_api_key with ai_has_key = t).
--
--   SET ROLE authenticated;
--   SELECT ai_api_key FROM public.app_settings;              -- must FAIL
--   SELECT ai_provider, ai_model FROM public.app_settings;   -- must succeed
--   SELECT * FROM public.get_ai_settings();                  -- ai_api_key must be ''
--   RESET ROLE;
