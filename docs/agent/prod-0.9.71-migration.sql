-- 0.9.71 (Task 170) PROD migration: workspaces.fee_rebate (現折 / 月退).
-- Run once in the Supabase SQL Editor of project hrilemueiqyaoiwnkeuu (Stock-Pnl-Web).
-- The guard aborts unless this is PROD, so running it on DEV by mistake changes nothing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%hrilemueiqyaoiwnkeuu%')
     OR EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%zyebvayngwrqzoaicbwd%') THEN
    RAISE EXCEPTION 'not PROD';
  END IF;
  ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS fee_rebate TEXT;
  ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_fee_rebate_values;
  ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_fee_rebate_values
    CHECK (fee_rebate IS NULL OR fee_rebate IN ('instant', 'monthly'));
END $$;
NOTIFY pgrst, 'reload schema';

-- Check: expect is_prod = true, col = text, chk = CHECK (...instant...monthly...).
SELECT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%hrilemueiqyaoiwnkeuu%') AS is_prod,
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'workspaces' AND column_name = 'fee_rebate') AS col,
       (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'workspaces_fee_rebate_values') AS chk;
