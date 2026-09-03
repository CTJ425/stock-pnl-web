-- PROD (hrilemueiqyaoiwnkeuu) migration for 0.9.28
--
-- Why: PROD is missing transactions.tx_nature, transactions.fee_rate and workspaces.fee_rate.
-- The app degrades gracefully when a column is missing (dataProvider.ts retries on 42703 /
-- PGRST204), so nothing breaks outright — but a 融券 SELL silently loses its tx_nature and is
-- recorded as a plain sell, which computes the wrong P&L. Apply this BEFORE the 0.9.28 frontend
-- reaches PROD.
--
-- Every statement is copied verbatim from sources/supabase/schema.sql. All of them are additive,
-- idempotent, and nullable: no existing row is rewritten and no column is dropped.
--
-- Run it in the Supabase SQL Editor of project "Stock-Pnl-Web" (hrilemueiqyaoiwnkeuu).
-- The guard aborts the whole block if it is run against the wrong project.

DO $$
BEGIN
  -- Project-identity guard. cron.job row count is 6 on BOTH projects, so it cannot identify
  -- one; the PROD ref inside the cron command text can.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE command LIKE '%hrilemueiqyaoiwnkeuu%') THEN
    RAISE EXCEPTION 'ABORT: this is not the PROD project';
  END IF;

  ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS fee_rate NUMERIC;
  ALTER TABLE workspaces DROP CONSTRAINT IF EXISTS workspaces_fee_rate_range;
  ALTER TABLE workspaces ADD CONSTRAINT workspaces_fee_rate_range
      CHECK (fee_rate IS NULL OR (fee_rate >= 0 AND fee_rate < 1));

  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_nature TEXT;
  ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_tx_nature_check;
  ALTER TABLE transactions ADD CONSTRAINT transactions_tx_nature_check
      CHECK (tx_nature IS NULL OR tx_nature IN ('SPOT', 'DAY_TRADE', 'MARGIN', 'SHORT'));

  ALTER TABLE transactions ADD COLUMN IF NOT EXISTS fee_rate NUMERIC;
  ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_fee_rate_range;
  ALTER TABLE transactions ADD CONSTRAINT transactions_fee_rate_range
      CHECK (fee_rate IS NULL OR (fee_rate >= 0 AND fee_rate < 1));
END $$;

-- PostgREST caches the schema. Without this it keeps answering as if the columns do not exist.
NOTIFY pgrst, 'reload schema';

-- Verification. Expect: 3 rows (transactions.fee_rate, transactions.tx_nature,
-- workspaces.fee_rate) and a tx_nature CHECK that lists SHORT.
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'transactions' AND column_name IN ('tx_nature', 'fee_rate'))
   OR (table_name = 'workspaces' AND column_name = 'fee_rate')
ORDER BY table_name, column_name;

SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'transactions'::regclass
  AND conname IN ('transactions_tx_nature_check', 'transactions_fee_rate_range');
