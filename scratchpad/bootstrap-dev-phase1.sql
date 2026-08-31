-- =========================================================
-- Bootstrap for NEW dev environment (ivan.lab)
-- Phase 1: tables, RLS, warm_quota, reports bucket, admin RPC
-- Cron jobs applied separately after CRON_SECRET is set.
-- =========================================================

-- =========================================================
-- Stock Helper Web — Supabase Database Schema
-- Usage: Paste and execute once in Supabase Console -> SQL Editor
-- (Consistent with the design of build-docs/system_design.md)
-- =========================================================

-- 1. Workspace information table (workspaces)
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Provides composite foreign key references for transactions to ensure workspace ownership consistency
    UNIQUE (id, user_id)
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own workspaces" ON workspaces;
CREATE POLICY "Users can manage their own workspaces"
ON workspaces FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 2. Transaction record data table (transactions)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tx_date DATE NOT NULL,
    market TEXT NOT NULL,         -- 'TPE' 或 'US'，TEXT 保留擴充彈性
    ticker TEXT NOT NULL,         -- 例如 '2330', 'AAPL'，不含 'TPE:' 前綴
    name TEXT NOT NULL,           -- 股票名稱
    tx_type TEXT NOT NULL CHECK (tx_type IN ('BUY', 'SELL')), -- 顯示層轉「買入/賣出」
    price NUMERIC NOT NULL CHECK (price >= 0),
    qty NUMERIC NOT NULL CHECK (qty > 0),
    fee_tax NUMERIC NOT NULL DEFAULT 0 CHECK (fee_tax >= 0),
    -- Composite foreign key: ensure that the workspace to which the transaction belongs belongs to the same user
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspaces(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tx_workspace ON transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(tx_date ASC);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own transactions" ON transactions;
CREATE POLICY "Users can manage their own transactions"
ON transactions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 3. Shared current price cache data table (price_cache)
--     L2 cache of Edge Function stock-price: the entire site within TTL shares the same quote.
--     Avoid repeated requests to external APIs for each consumer.
--     TTL is determined by Edge Function (not DB layer): Taiwan stocks are based on time period (see stock-price/quoteWindow.ts),
--     10 minutes of U.S. stocks—Taiwan stocks use the stock exchange’s MIS real-time quotes during the day, and a short TTL can reflect the real-time price;
--     The price was finalized after the market closed at 13:30, and the TTL was extended all the way until the trial trading at 08:25 the next day, and there was no external price capture (0.6.36) during the entire night.
--     updated_at records the "actual acquisition time of the quotation", and the front-end determines the freshness based on this.
--     Avoid the overlap between the front-end localStorage cache and the TTL of this table (see src/services/priceProxy.ts).
--     Only Edge Function (service role) can write; general users can only read.
--     Prevent someone from directly changing the cache price to affect everyone.
--     prev_close is yesterday's close (0.6.34): there must be a benchmark for the rise and fall of the current price, and once the cache is hit, the source will not be asked again.
--     If the benchmark is not saved along with it, the colors will flicker between TTL and outside - tinted, gray, tinted. Can be NULL (not given by the source).
--     open / high / low / volume / trade_date / trade_time / trial are quotation card fields (0.6.36):
--     The quotation card for individual stock analysis should display today's opening high and low volume and trial price, and these fields are originally in the same source response.
--     If they are not saved together, the quotation card will be unavailable as soon as the cache hits it - the same reason for prev_close in the first place.
CREATE TABLE IF NOT EXISTS price_cache (
    key TEXT PRIMARY KEY,                         -- 'TPE:2330'、'US:AAPL'
    price NUMERIC NOT NULL CHECK (price > 0),
    prev_close NUMERIC CHECK (prev_close > 0),    -- 昨收；來源未提供時為 NULL
    open NUMERIC CHECK (open > 0),                -- 今開
    high NUMERIC CHECK (high > 0),                -- 今日最高
    low NUMERIC CHECK (low > 0),                  -- 今日最低
    volume NUMERIC CHECK (volume >= 0),           -- 累積成交量（張）；尚無成交為 0
    trade_date TEXT,                              -- 交易日 YYYYMMDD（僅 MIS 提供）
    trade_time TEXT,                              -- 最後撮合時間 HH:mm:ss（僅 MIS 提供）
    trial BOOLEAN NOT NULL DEFAULT FALSE,         -- 抓價當下是否為試撮階段
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fill in the fields in the existing environment (this file can be executed repeatedly; the newly created table already contains these columns, the following is no-op)
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS prev_close NUMERIC CHECK (prev_close > 0);
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS open NUMERIC CHECK (open > 0);
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS high NUMERIC CHECK (high > 0);
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS low NUMERIC CHECK (low > 0);
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS volume NUMERIC CHECK (volume >= 0);
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS trade_date TEXT;
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS trade_time TEXT;
ALTER TABLE price_cache ADD COLUMN IF NOT EXISTS trial BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read price cache" ON price_cache;
CREATE POLICY "Authenticated users can read price cache"
ON price_cache FOR SELECT
TO authenticated
USING (true);
-- NOTE: Deliberately do not create INSERT / UPDATE / DELETE policy -
-- The service role (Edge Function) is not restricted by RLS and is the only way to write.


-- 3.1 Shared stock name cache data table (stock_names)
--     The searched/reverse-checked parsed "Codename ↔ Name" is written back here by Edge Function;
--     Any subsequent users who search for the same code number will directly hit the DB and no longer request Yahoo.
--     Names rarely change and there is no TTL. Write permissions are the same as price_cache (service role only).
CREATE TABLE IF NOT EXISTS stock_names (
    key TEXT PRIMARY KEY,                         -- 'TPE:2330'、'US:AAPL'
    name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stock_names ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read stock names" ON stock_names;
CREATE POLICY "Authenticated users can read stock names"
ON stock_names FOR SELECT
TO authenticated
USING (true);


-- 4. User settings table (user_settings)
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    default_fee_rate NUMERIC NOT NULL DEFAULT 0.001425,
    theme TEXT NOT NULL DEFAULT 'dark'
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own settings" ON user_settings;
CREATE POLICY "Users can manage their own settings"
ON user_settings FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 4.1 AI assistant global settings (0.6.0)
--     AI settings are shared by the entire site: regardless of account or workspace, and are stored in a single list of app_settings (the id is always 1).
--     In 0.6.0-dev.1, the user_settings.ai_* fields were used to save one copy for each account. From 0.6.0-dev.2 onwards, it was changed to the whole domain;
--     The following DROP allows the old version of the environment (test area only) to easily clear the dead slots when re-running this file.
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_provider;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_base_url;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_model;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_api_key;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_updated_at;

--     The key is stored in plain text: 0.6.0 is a front-end direct connection to the AI ​​provider. The key must eventually be returned to the browser to make a request.
--     Therefore, "all login accounts can be read" is a necessity of this architecture, not an oversight.
--     To prevent the key from entering the browser, you have to wait for the 0.6.1 Edge Function proxy.
CREATE TABLE IF NOT EXISTS app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 恆為單列
    ai_provider   TEXT,         -- 'google' | 'openai-compatible'
    ai_base_url   TEXT,         -- openai-compatible 用（ollama / vLLM）；google 留空
    ai_model      TEXT,
    ai_api_key    TEXT,         -- ollama 本機通常不需要，允許空字串
    ai_updated_at TIMESTAMPTZ
);

-- 4.1a Online editing of prompt words (0.6.19)
--
--     Administrators can change the analysis and questioning criteria in the background without having to modify the code and redeploy it.
--
--     ⚠️ **NULL means "use the default value in the program code", not "no prompt word". **
--     The default value is deliberately not written into the database: after writing it in, the default value can be adjusted in aiPrompts.ts in the future.
--     The environment that has been applied will not be updated, and the two areas will run their own prompt words and cannot be seen.
--     When the front-end archives, if the content is the same as the default, NULL will be written back (see normalize in aiPrompts.ts).
--
--     ⚠️ **Only the "Style" section exists here. ** Safety rules (no buying or selling orders and target prices,
--     Ending disclaimers, leveled risk warnings, question limits and command override prevention) are fixed in the code.
--     `ANALYSIS_LOCKED` / `CHAT_LOCKED` followed by user input.
--     Opening the entire paragraph for editing is equivalent to leaving the guardrail to be deleted with one click, and there will be no sign after deletion.
--
--     Use the existing RLS of this table: readable by all login accounts (you need to use it to configure prompt on the front end), and writable only by admin.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ai_prompt_analysis TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS ai_prompt_chat     TEXT;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Readable by all members (after logging in): Non-administrators must also obtain the endpoint and key before the browser can directly send AI requests.
DROP POLICY IF EXISTS "Authenticated users can read app settings" ON app_settings;
CREATE POLICY "Authenticated users can read app settings"
ON app_settings FOR SELECT
TO authenticated
USING (true);

-- Only accounts with app_metadata.role = 'admin' can write.
-- app_metadata can only be set by Dashboard/SQL and cannot be changed by users (user_metadata is changeable by users and cannot be used as permissions).
-- Authorization method (executed by SQL Editor; after pasting the tag, the account must log in again to refresh the JWT to take effect):
--   UPDATE auth.users
--   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--   WHERE email = '<account email to be authorized>';
DROP POLICY IF EXISTS "Admins can insert app settings" ON app_settings;
CREATE POLICY "Admins can insert app settings"
ON app_settings FOR INSERT
TO authenticated
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

DROP POLICY IF EXISTS "Admins can update app settings" ON app_settings;
CREATE POLICY "Admins can update app settings"
ON app_settings FOR UPDATE
TO authenticated
USING ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
WITH CHECK ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');


-- 5. After-hours chip raw file cache data table (chip_raw_cache)
--     Shared cache of Edge Function stock-report: cache TWSE files based on transaction date and data set,
--     Avoid re-capturing the entire after-market chips every time the market reports. Only Edge Function (service role) can read and write, and the front end does not access it.
CREATE TABLE IF NOT EXISTS chip_raw_cache (
    ymd TEXT NOT NULL,
    dataset TEXT NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ymd, dataset)
);

ALTER TABLE chip_raw_cache ENABLE ROW LEVEL SECURITY;

-- NOTE: Deliberately do not create any policy -
-- The service role (Edge Function) is not restricted by RLS and is the only way to read and write. The front end will not access it.


-- 5a. Daily quota for on-demand stock warming (warm_quota) —— 0.6.44
--
--     Until 0.6.44 the `warm` / `generate` actions of stock-report only accepted codes that somebody
--     already held (`heldTwTickers()`). That was an anti-abuse ceiling, not a privacy rule: the
--     function is deployed --no-verify-jwt and its URL ships inside the public front-end bundle,
--     so the whitelist was what stopped a stranger from using us to hammer TWSE / MOPS.
--
--     The individual stock analysis page can now search the whole market, so that ceiling is gone.
--     What replaces it: `assertUser()` (a real account, not just the anon key) plus this table,
--     which caps `warm` —— the only action whose cost is not already paid by chip_raw_cache ——
--     at WARM_DAILY_LIMIT calls per account per Taipei day.
--
--     ⚠️ `assertUser` alone would not be enough: signup is open, so an attacker just registers.
--
--     `ymd` is the 8-digit Taipei date, the same shape chip_raw_cache uses, so the same
--     lexicographic `ymd < cutoff` prune in pruneChipCache() clears both tables.
CREATE TABLE IF NOT EXISTS warm_quota (
    user_id UUID NOT NULL,
    ymd     TEXT NOT NULL,
    used    INT  NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, ymd)
);

ALTER TABLE warm_quota ENABLE ROW LEVEL SECURITY;

-- NOTE: Same as chip_raw_cache —— deliberately no policy at all. The Edge Function (service role)
-- is the only reader and writer; a user being able to read their own counter would be harmless,
-- but a user being able to write it would make the whole table decorative.

-- Atomic take-one for warm_quota. Read-then-upsert in the Edge Function races under parallel
-- warms (every concurrent call can read used=0 and write used=1). This function does
-- insert-or-increment under the row lock, and only succeeds when used stays below p_limit.
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

-- service_role only (Edge Function). Anon/authenticated must not bump their own counter.
REVOKE ALL ON FUNCTION take_warm_quota(uuid, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION take_warm_quota(uuid, text, int) TO service_role;


-- 6. After-hours report Storage bucket + daily automatic generation schedule (pg_cron + pg_net)
--
--    reports bucket stores the common after-hours report of "each Taiwan stock × each trading day" (purely structured JSON, schema 2 and above)
--    There is no html field, each copy is about 5KB), publicly read; only Edge Function (service role) writes.
--    The front-end reads Storage-first, and then fallsback to instant production if there is no result. Batch by stock-report
--    Action='generate-all' is generated, and only the last 7 days are retained (older reports and chip_raw_cache are cleared in the same batch).
--
--    ⚠️ This section is **optional**: the function is still available when it is not applied, but every time you open the individual stock analysis page, it will be clicked to produce it.
--       (The actual measurement is about 8 seconds, type TWSE directly) instead of reading the pre-produced report (nearly instantaneous).
--
--    ⚠️ Before execution, please replace the two <...> placeholders below with your project values:
--      <PROJECT_REF>：Supabase 專案 ref（Project Settings → General → Reference ID）
--      <CRON_SECRET>: Custom secret key, which must be the same as the value set by `supabase secrets set CRON_SECRET=...`

-- 6a. Create a publicly readable reports bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO UPDATE SET public = true;
-- Write permission: service role bypasses RLS and is the only way to write; public bucket reading is policy-free.

-- 6b. Enable scheduling and server-side HTTP extensions (also supported by Supabase Free)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 7. Batch execution record (batch_run_log)
--     Each time generate-all is run, write a column to answer "At this point in time, has the data for the day arrived?"
--
--     Why it is needed: The three periods of cron are set based on "the approximate time each data source is released", but that understanding
--     It was wrong for a time - the annotation said T86 (the three major legal persons of individual stocks) about 15:00–15:30, actual measurement 2026-07-27 15:42
--     T86 has not yet been released, but at the same time BFI82U (large market trading amount statistics table) has data.
--     The two statements were conflated, resulting in an overestimation of the margin for the first shift.
--
--     pg_net's net._http_response is only retained for 6 hours, and chip_raw_cache.updated_at is also only remembered
--     "The time of successful capture", neither of them can answer "Whether the data arrived when that class ran".
--     Without this table, the only way to know is by manually curling someone online, and there is no way to fine-tune the schedule.
--
--     It is only written by Edge Function (service role), so no RLS policy is created - the same as chip_raw_cache.
CREATE TABLE IF NOT EXISTS batch_run_log (
    id            BIGSERIAL PRIMARY KEY,
    ran_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Execute the current Taipei date and time (HH:MM). The purpose of saving the string is to directly understand which class it is, so as to avoid changing the time zone every time.
    taipei_ymd    TEXT,
    taipei_time   TEXT,
    -- The data day parsed in this batch; if the data on that day has not been released yet, it will be the previous trading day
    data_ymd      TEXT,
    -- Is data_ymd equal to the day of execution → T86 of that day? Has this time arrived? This is the column you look at when fine-tuning the schedule.
    t86_today     BOOLEAN,
    margin_ok     BOOLEAN,
    borrow_ok     BOOLEAN,
    history_days  INT,
    generated     INT,
    daily_synced  INT,
    fundamental_synced INT,
    news_synced   INT,
    duration_ms   INT
);

-- 0.6.1 New fields added. Use ADD COLUMN IF NOT EXISTS instead of changing CREATE above,
-- This is to allow environments that have already built tables (the official area was built on 2026-07-27) to upgrade by re-running this file.
--
-- ⚠️ But "re-running this file" means **only running these few lines of ALTER**, not pasting the entire file into the SQL Editor.
--    The cron in §6c is unschedule + schedule, and the entire rerun will fill in <PROJECT_REF>
--    Return the literal value with <CRON_SECRET> - 2026-07-28 Actual step on the test area: in order to apply
--    revenue_backfilled and the entire job was rerun, the two jobs failed on the spot, and because the DNS could not be resolved at all,
--    net._http_response does not even have a failure record, and it was not until 16:00 that night that it was found to be empty all night.
--    **This file is not idempotent. **
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS runs_today   INT;      -- 今天第幾次執行（含短路），MAX_RUNS_PER_DAY 靠它把關
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS skipped      BOOLEAN;  -- 這輪短路，沒有任何對外請求
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS skip_reason  TEXT;     -- 'complete' | 'run-cap'
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS regenerated  BOOLEAN;  -- 這輪有沒有重產報告（輸入沒變就不重產）
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS run_sig      TEXT;     -- 報告輸入的指紋，用來判斷要不要重產
-- T86 Rewrite tracking: These columns are both observation data** and cross-round status (see the description of index.ts readLastRun)
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_fingerprint TEXT;
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_revisions   INT;   -- 今天被改寫過幾次
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_unchanged   INT;   -- 連續幾次抓到相同內容
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_frozen      BOOLEAN; -- 已定稿，不再重抓
-- Each source's "self-declared data date". 2026-07-27 Actual test: TWSE’s openapi and rwd endpoints
-- None provide Last-Modified / ETag / Age, all Cache-Control: no-cache ——
-- So I can’t remember “what time it was put on the shelves”. All I can remember is “when we went to see it, it said what day it was.”
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS margin_today     BOOLEAN; -- 融資融券是否為當天
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS borrow_data_date TEXT;    -- 借券 title 自帶的日期
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS bwibbu_date      TEXT;    -- 估值檔的民國日期，例 '1150724'
-- 0.6.4 Monthly revenue historical recovery. Without this column, there is no server-side signal that can answer "is it patched?"——
-- fundamental/*.json is an overwrite system. From Storage, you can only see "the current number of transactions", but not which round of replacement.
-- After filling up, this column will be 0 for a long time (when the gap is empty, it is short-circuited), which is normal and not broken.
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS revenue_backfilled INT;  -- 這輪補寫了幾檔的月營收
-- 0.6.21 Quarterly profitability recovery. The reason is exactly the same as the column above (the overwritten file cannot be seen in which round it was made).
-- ⚠️ **This column must be added first before deploying the function**: logBatchRun’s insert failure will not throw an exception
--    (supabase-js returns an error object, not a throw). When the field does not exist, the entire batch of observations will stop silently.
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS profit_backfilled  INT;  -- 這輪補寫了幾檔的季度獲利能力
-- ⚠️ The macro_synced added in 0.6.5-dev.1 has become an **obsolete field** in dev.2: the general manager will remove it to his own
--    cron jobs (see §9), are no longer written by generate-all, so will always be NULL.
--    No DROP because the risk of deleting a field is greater than leaving a useless field; the official area has never been added, and there is no need to add it.
--    The general observation is changed to two places: macro/us.json comes with asOf (that is, "when was it written"),
--    And net._http_response (retained for 6 hours to see if cron is successful).
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS macro_synced INT;        -- 已廢棄，見上

ALTER TABLE batch_run_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS batch_run_log_ran_at_idx ON batch_run_log (ran_at DESC);
-- readLastRun will check "today's last column" in each round. This index makes it an index scan instead of a full table scan.
CREATE INDEX IF NOT EXISTS batch_run_log_today_idx ON batch_run_log (taipei_ymd, id DESC);

-- Commonly used query 1: The ratio of T86 captured at each time of the day is used to verify whether the polling window is early enough/late enough
--   SELECT taipei_time, count(*) AS ran several times,
--          count(*) FILTER (WHERE t86_today) AS gets the T86 of the day
--   FROM batch_run_log GROUP BY taipei_time ORDER BY taipei_time;
--
-- Commonly used query 2: The actual time of arrival of each source every day (this is the real answer to "what time is updated")
--   SELECT taipei_ymd,
--          min(taipei_time) FILTER (WHERE t86_today) AS T86 is the earliest,
--          min(taipei_time) FILTER (WHERE margin_today) AS margin trading is the earliest,
--          max(t86_revisions) AS T86 revision times,
--          min(taipei_time) FILTER (WHERE t86_frozen) AS T86 finalization time
--   FROM batch_run_log GROUP BY taipei_ymd ORDER BY taipei_ymd DESC;
--
-- Commonly used query 3: Confirming the short circuit really saves trouble (the duration_ms of the skipped rounds should only be tens of milliseconds)
--   SELECT skipped, skip_reason, count(*), round(avg(duration_ms)) AS average milliseconds
--   FROM batch_run_log GROUP BY 1, 2 ORDER BY 3 DESC;


-- 8. Data source probe record (source_probe_log) —— 0.6.3
--
--     This table answers only one question: **"When was this source actually updated?"**
--
--     Why batch_run_log cannot answer: `batch_run_log.bwibbu_date` looks like it is recording this matter,
--     In fact, what I remember is **quick value**. `readLatest` uses "the day we went to capture" as the cache key,
--     After catching the first round of the day, I ate fast all day long - on 2026-07-27, those 12 rounds were all recorded as the same '1150724'.
--     **That's not 12 observations, it's the same one that was read 12 times**; the batch one short circuit is not recorded at all.
--     Using it to judge the release time will result in false answers, and "using false answers to guess the release time" is the reason for the 0.6.1 rework.
--
--     The probe deliberately does not write to cache, does not write to Storage, and does not touch any status of the batch.
--     Therefore, the three gates of 0.6.1 (including "short circuit = zero external request") are not affected at all and are still verifiable.
--
--     Just explore these two - they are currently the only two sources of "if you have a cache, you won't look at it all day":
--       BWIBBU_ALL (valuation, 116KB, daily)/borrow TWT96U (244KB)
--     T86 and margin trading have been faithfully recorded by t86_revisions / margin_today of batch_run_log;
--     Monthly revenue and company information are updated monthly, so there is no point in checking it every 15 minutes.
--
--     Cost: (116+244)KB × 32 rounds ≈ 11.5MB/day. You can stop at any time after getting the answer without redeploying:
--       SELECT cron.unschedule('source-probe');

CREATE TABLE IF NOT EXISTS source_probe_log (
    id            BIGSERIAL PRIMARY KEY,
    probed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    taipei_ymd    TEXT NOT NULL,
    taipei_time   TEXT NOT NULL,   -- 'HH:mm'
    bwibbu_ok     BOOLEAN,
    bwibbu_date   TEXT,            -- 估值檔自報的民國日期，例 '1150724'
    bwibbu_fp     TEXT,            -- 內容指紋（列排序後才算，見 pollPlan.rowsFingerprint）
    bwibbu_rows   INT,
    borrow_ok     BOOLEAN,
    borrow_date   TEXT,            -- 借券 title 自帶的日期（＝下一個交易日）
    borrow_fp     TEXT,
    borrow_rows   INT,
    duration_ms   INT
);

ALTER TABLE source_probe_log ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS source_probe_log_ymd_idx ON source_probe_log (taipei_ymd, id DESC);


-- 11. Administrator backend: Scheduling status query function (0.6.12)
--
--    The "Data Fetch Status" page requires pg_cron's schedule and execution records, but the `cron` schema is not available
--    In the exposed schemas of PostgREST, supabase-js cannot directly find it. Therefore, SECURITY DEFINER
--    One layer of function package, called by Edge Function with service role.
--
--    ⚠️ **Absolutely not return the full text of `cron.job.command`**: There is `x-cron-secret` in it
--    Clear text (see job definition in §6c / §9 / §10). This function only selects jobname, schedule,
--    active, action and target project ref - all are insensitive fields.
--    Be sure to reread this paragraph when you want to expand the returned content. Don't take out the entire command.
--
--    The reason why the target ref needs to be returned is because BUG-003 is "the cron in the test area is transferred to the official area".
--    Display it in the background so that you can see it at a glance next time.
--
--    ⚠️ **Only run this section, do not rerun the entire schema.sql** (see the warning at the beginning of this file).
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
             -- Only get the action and target ref. The full text of the command contains the key and must not be leaked out.
             'action',     (regexp_match(j.command, '"action"\s*:\s*"([a-z-]+)"'))[1],
             'targetRef',  (regexp_match(j.command, 'url\s*:=\s*''https://([^.]+)\.'))[1],
             'lastRun',    r.last_run,
             'lastStatus', r.last_status,
             'runsToday',  coalesce(r.runs_today, 0),
             'failsToday', coalesce(r.fails_today, 0)
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
  ) s;
$$;

-- Only service role can call (Edge Function will check whether the user is admin before forwarding the call).
-- It is not possible to use the anon/authenticated key directly on the front end - the schedule information is not open to general users.
REVOKE ALL ON FUNCTION public.admin_schedule_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_schedule_status() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schedule_status() TO service_role;
