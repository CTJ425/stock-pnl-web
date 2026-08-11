-- tw_watchlist for 0.6.44-dev.6 (apply on DEV / prod when authorized)
-- Source of truth: sources/supabase/schema.sql

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
