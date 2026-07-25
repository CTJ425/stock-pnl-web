-- =========================================================
-- 股票小幫手 Web — Supabase 資料庫 Schema
-- 使用方式：在 Supabase Console -> SQL Editor 貼上執行一次即可
-- （與 build-docs/system_design.md 的設計一致）
-- =========================================================

-- 1. 工作區資料表 (workspaces)
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 供 transactions 複合外鍵引用，確保 workspace 歸屬一致性
    UNIQUE (id, user_id)
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage their own workspaces" ON workspaces;
CREATE POLICY "Users can manage their own workspaces"
ON workspaces FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 2. 交易紀錄資料表 (transactions)
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
    -- 複合外鍵：保證交易所屬的工作區屬於同一使用者
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


-- 3. 共用現價快取資料表 (price_cache)
--     Edge Function stock-price 的 L2 快取：TTL 內全站共用同一份報價，
--     避免每個使用者重複請求外部 API。
--     TTL 由 Edge Function 判斷（非 DB 層）：台股 60 秒、美股 10 分鐘——
--     台股走證交所 MIS 即時行情，短 TTL 才能反映即時價；美股走 Yahoo，維持 10 分鐘。
--     updated_at 記的是「報價實際取得時間」，前端據此判斷新鮮度，
--     避免前端 localStorage 快取與本表 TTL 疊加（見 src/services/priceProxy.ts）。
--     僅 Edge Function（service role）可寫入；一般使用者只能讀取，
--     避免有人直接竄改快取價格影響所有人。
CREATE TABLE IF NOT EXISTS price_cache (
    key TEXT PRIMARY KEY,                         -- 'TPE:2330'、'US:AAPL'
    price NUMERIC NOT NULL CHECK (price > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read price cache" ON price_cache;
CREATE POLICY "Authenticated users can read price cache"
ON price_cache FOR SELECT
TO authenticated
USING (true);
-- 注意：刻意不建立 INSERT / UPDATE / DELETE policy——
-- service role（Edge Function）不受 RLS 限制，是唯一的寫入途徑。


-- 3.1 共用股票名稱快取資料表 (stock_names)
--     搜尋 / 反查解析過的「代號 ↔ 名稱」由 Edge Function 回寫於此；
--     之後任何使用者查同一代號直接命中 DB，不再請求 Yahoo。
--     名稱幾乎不變動，不設 TTL。寫入權限同 price_cache（僅 service role）。
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


-- 4. 使用者設定資料表 (user_settings)
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


-- 5. 盤後籌碼原始檔快取資料表 (chip_raw_cache)
--     Edge Function stock-report 的共用快取：依交易日與資料集快取 TWSE 大檔，
--     避免每次產報告都重抓整份盤後籌碼。僅 Edge Function（service role）讀寫，前端不存取。
CREATE TABLE IF NOT EXISTS chip_raw_cache (
    ymd TEXT NOT NULL,
    dataset TEXT NOT NULL,
    payload JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ymd, dataset)
);

ALTER TABLE chip_raw_cache ENABLE ROW LEVEL SECURITY;

-- 注意：刻意不建立任何 policy——
-- service role（Edge Function）不受 RLS 限制，是唯一的讀寫途徑，前端不會存取。


-- 6. 盤後報告 Storage bucket + 每日自動產生排程 (pg_cron + pg_net)
--
--    reports bucket 存放「每檔台股 × 每個交易日」的共用盤後報告（純結構化 JSON，schema 2 起
--    已無 html 欄位，每份約 5KB），公開讀取；僅 Edge Function(service role) 寫入。
--    前端 Storage-first 讀取，查無再 fallback 到即點即產。批次由 stock-report 的
--    action='generate-all' 產生，只保留最近 7 天（同批次順便清掉更舊的報告與 chip_raw_cache）。
--
--    ⚠️ 本段是**選用**的：不套用時功能仍可用，但每次開啟個股分析頁都會即點即產
--       （實測約 8 秒、直接打 TWSE），而非讀預產好的報告（近乎即時）。
--
--    ⚠️ 執行前，請把下方兩個 <...> 佔位符換成你的專案值：
--      <PROJECT_REF>：Supabase 專案 ref（Project Settings → General → Reference ID）
--      <CRON_SECRET>：自訂密鑰，需與 `supabase secrets set CRON_SECRET=...` 設定的值相同

-- 6a. 建立公開讀取的 reports bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO UPDATE SET public = true;
-- 寫入權限：service role 本就繞過 RLS，是唯一寫入途徑；公開 bucket 讀取免 policy。

-- 6b. 啟用排程與伺服器端 HTTP 擴充（Supabase Free 亦支援）
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 6c. 每交易日 20:30 台北（= 12:30 UTC，週一~週五）觸發盤後批次產報
--     T86 / 融資融券 / 借券通常傍晚才發佈，20:30 已足夠；resolveT86 會往前找最近有資料日。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stock-report-nightly') THEN
    PERFORM cron.unschedule('stock-report-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'stock-report-nightly',
  '30 12 * * 1-5',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{"action":"generate-all"}'::jsonb
  );
  $$
);
-- 註：函數以 --no-verify-jwt 部署，故毋需 Authorization；批次的授權改由 x-cron-secret 把關。
-- 若你的 API Gateway 仍要求 apikey，於 headers 內加 'apikey', '<ANON_KEY>' 即可。


-- 7. 基本面（財報 EPS）資料表 (stock_fundamentals)
--
--    Edge Function stock-report 於盤後批次時，把 TWSE 綜合損益表的單季數字寫入此表。
--    前端不直讀本表——資料由 Edge Function 併入報告 JSON（與 chip_raw_cache 相同做法），
--    故 ENABLE RLS 但刻意不建任何 policy，service role 是唯一讀寫途徑。
--
--    ⚠️ 本表刻意「不設保留期」，與 chip_raw_cache 的 7 天 prune 是相反的取捨：
--       - chip_raw_cache 存的是每天數 MB 的原始大檔快取，留久了純粹佔空間。
--       - 本表存的是「一檔一季一列」的極小長期事實（1000 檔 × 4 季 ≈ 4000 列/年）。
--       而且**保留歷史正是「EPS 逐季趨勢」的唯一來源** ——
--       TWSE 的財報端點沒有季別參數、只回最新一期，歷史只能靠本表自然累積。
--       PK 衝突時 upsert 覆寫，容許官方事後更正數字。
--
--    不涵蓋：ETF（沒有 EPS，其價值來自持有的一籃子股票）、上櫃（端點是「上市公司」）、美股。
CREATE TABLE IF NOT EXISTS stock_fundamentals (
    ticker TEXT NOT NULL,
    year SMALLINT NOT NULL,                       -- 西元年（來源為民國，由 Edge Function 換算後存入）
    quarter SMALLINT NOT NULL CHECK (quarter BETWEEN 1 AND 4),
    eps NUMERIC,                                  -- 基本每股盈餘（元）
    revenue NUMERIC,                              -- 營業收入（千元）
    net_income NUMERIC,                           -- 淨利（淨損）歸屬於母公司業主（千元）
    source TEXT NOT NULL,                         -- 產業表來源：'ci' | 'fh' | 'ins' | 'bd' | 'mim'
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (ticker, year, quarter)
);

ALTER TABLE stock_fundamentals ENABLE ROW LEVEL SECURITY;

-- 注意：刻意不建立任何 policy——理由同 chip_raw_cache（僅 service role 存取，前端不直讀）。
