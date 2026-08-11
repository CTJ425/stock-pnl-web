-- Production DDL for 0.6.44 (user authorized 2026-08-07)
-- Target: Stock-Pnl-Web cloud kxnxadaghidwumqsqneu
-- Identity check first: abort if not production-shaped (batch history present).

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM batch_run_log;
  IF n < 1 THEN
    RAISE EXCEPTION 'identity check failed: batch_run_log empty (wrong project?)';
  END IF;
  RAISE NOTICE 'identity ok: batch_run_log rows=%', n;
END $$;

-- 1) warm_quota + take_warm_quota
CREATE TABLE IF NOT EXISTS warm_quota (
    user_id UUID NOT NULL,
    ymd     TEXT NOT NULL,
    used    INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, ymd)
);

ALTER TABLE warm_quota ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION take_warm_quota(p_user_id uuid, p_ymd text, p_limit int)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_used int;
BEGIN
  IF p_limit IS NULL OR p_limit < 1 THEN
    RETURN false;
  END IF;

  INSERT INTO warm_quota (user_id, ymd, used)
  VALUES (p_user_id, p_ymd, 1)
  ON CONFLICT (user_id, ymd) DO UPDATE
    SET used = warm_quota.used + 1
    WHERE warm_quota.used < p_limit
  RETURNING used INTO new_used;

  RETURN new_used IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION take_warm_quota(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION take_warm_quota(uuid, text, int) TO service_role;

-- 2) tw_watchlist
CREATE TABLE IF NOT EXISTS tw_watchlist (
    user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    ticker     TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    sort_order INT  NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, ticker),
    CONSTRAINT tw_watchlist_ticker_ok CHECK (ticker ~ '^[0-9A-Za-z]{2,8}$')
);

CREATE INDEX IF NOT EXISTS tw_watchlist_user_sort_idx
    ON tw_watchlist (user_id, sort_order, created_at);

ALTER TABLE tw_watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own tw_watchlist" ON tw_watchlist;
CREATE POLICY "Users can manage their own tw_watchlist"
ON tw_watchlist FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION tw_watchlist_enforce_max()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (SELECT count(*)::int FROM tw_watchlist WHERE user_id = NEW.user_id) >= 5 THEN
    RAISE EXCEPTION 'tw_watchlist limit is 5'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tw_watchlist_max5 ON tw_watchlist;
CREATE TRIGGER tw_watchlist_max5
  BEFORE INSERT ON tw_watchlist
  FOR EACH ROW
  EXECUTE FUNCTION tw_watchlist_enforce_max();

-- Verify
SELECT
  to_regclass('public.warm_quota') AS warm_quota,
  to_regclass('public.tw_watchlist') AS tw_watchlist,
  (SELECT count(*) FROM batch_run_log) AS batch_run_log_rows,
  (SELECT proname FROM pg_proc WHERE proname = 'take_warm_quota' LIMIT 1) AS take_warm_fn;
