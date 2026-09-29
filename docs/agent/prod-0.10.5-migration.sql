-- PROD migration for 0.10.5 (BUG-088): workspaces.fee_rounding. Same DDL as schema.sql.
-- Paste into the PROD SQL Editor (project hrilemueiqyaoiwnkeuu). The DO block aborts unless the database is PROD.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%hrilemueiqyaoiwnkeuu%')
     OR EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%zyebvayngwrqzoaicbwd%') THEN
    RAISE EXCEPTION 'identity guard: this database is not PROD';
  END IF;
  ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS fee_rounding TEXT;
  ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_fee_rounding_values;
  ALTER TABLE workspaces ADD CONSTRAINT workspaces_fee_rounding_values
      CHECK (fee_rounding IS NULL OR fee_rounding IN ('lot', 'position'));
END $$;
NOTIFY pgrst, 'reload schema';

-- Check: expect is_prod true, is_dev false, col_type text, chk CHECK (... 'lot' ... 'position' ...), rows_set 0.
SELECT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%hrilemueiqyaoiwnkeuu%') AS is_prod,
       EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%zyebvayngwrqzoaicbwd%') AS is_dev,
       (SELECT data_type FROM information_schema.columns WHERE table_name='workspaces' AND column_name='fee_rounding') AS col_type,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='workspaces_fee_rounding_values') AS chk,
       (SELECT count(*) FROM workspaces WHERE fee_rounding IS NOT NULL) AS rows_set;
