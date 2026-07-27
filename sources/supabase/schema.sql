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

-- 4.1 AI 助理全域設定（0.6.0）
--     AI 設定為全站共用：不分帳號、不分工作區，存於 app_settings 單列表（id 恆為 1）。
--     0.6.0-dev.1 曾以 user_settings.ai_* 欄位按帳號各存一份，0.6.0-dev.2 起改為全域；
--     以下 DROP 讓套過舊版的環境（僅測試區）重跑本檔時順手清掉死欄位。
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_provider;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_base_url;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_model;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_api_key;
ALTER TABLE user_settings DROP COLUMN IF EXISTS ai_updated_at;

--     金鑰以明文存放：0.6.0 是前端直連 AI 供應商，金鑰終究得回到瀏覽器才能發請求，
--     所以「所有登入帳號可讀」是這個架構的必然，不是疏忽。
--     要「金鑰不進瀏覽器」得等 0.6.1 的 Edge Function 代理。
CREATE TABLE IF NOT EXISTS app_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- 恆為單列
    ai_provider   TEXT,         -- 'google' | 'openai-compatible'
    ai_base_url   TEXT,         -- openai-compatible 用（ollama / vLLM）；google 留空
    ai_model      TEXT,
    ai_api_key    TEXT,         -- ollama 本機通常不需要，允許空字串
    ai_updated_at TIMESTAMPTZ
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- 全員（登入後）可讀：非管理員也要拿得到端點與金鑰，瀏覽器才能直接發 AI 請求
DROP POLICY IF EXISTS "Authenticated users can read app settings" ON app_settings;
CREATE POLICY "Authenticated users can read app settings"
ON app_settings FOR SELECT
TO authenticated
USING (true);

-- 僅帶 app_metadata.role = 'admin' 的帳號可寫。
-- app_metadata 只能由 Dashboard / SQL 設定，使用者無法自改（user_metadata 才是使用者可改的，不能拿來做權限）。
-- 授權方式（SQL Editor 執行；貼完 tag 該帳號要重新登入讓 JWT 刷新才生效）：
--   UPDATE auth.users
--   SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
--   WHERE email = '<要授權的帳號 email>';
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

-- 6c. 每交易日分三段觸發盤後批次產報（17:30 / 22:30 / 23:30 台北 = 9:30 / 14:30 / 15:30 UTC）
--
--     為什麼分段：各資料源的公布時間差很多，等最晚的那個才產報，等於讓最早就緒的
--     三大法人白白晚 6 小時才看得到。批次本身是冪等且會自我補完的（每次重讀快取、
--     只抓缺的、覆寫整份報告），所以多跑幾次自然就會逐步補齊，不需要額外機制。
--     第二、三班幾乎全快取命中，實測約 2 秒，成本可忽略。
--
--     ⚠️ 各資料源的實際公布時間（查證後，別憑印象往前挪）：
--       三大法人個股買賣超 (T86)：約 15:00–15:30，大行情或系統結算可能延至 16:30
--       融資融券餘額：            約 21:00–22:00，視全台券商回傳速度，偶爾延至 22:30–23:00
--       借券賣出餘額：            約 21:00–22:30，每日晚間執行二次更新
--     17:30 那班只會拿到三大法人，融資融券與借券要等 22:30 / 23:30 兩班補。
--     這是預期行為，不是故障 —— 報告的 sources 欄位會逐項標明各自的資料日與抓取時間，
--     前端也逐區塊顯示，使用者看得出哪塊是新的、哪塊還沒到。
--
--     借券的坑：端點沒有 date 參數、回的永遠是「目前最新」。早班抓到的其實是前一天的，
--     若照舊直接存成「今天」，後面幾班會因快取已存在而永遠沿用那份錯的。
--     故改用 rwd 版（自帶 title 日期），以「資料自己宣告的日期」為快取鍵，早晚班不會互相污染。
--
--     三班都在台北當日內，不影響 taipeiYmd 的判斷。真遇到更誇張的延遲也不會壞：
--     隔天的批次會把前一天缺的補回來，只是那一晚的報告不完整。
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stock-report-nightly') THEN
    PERFORM cron.unschedule('stock-report-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'stock-report-nightly',
  '30 9,14,15 * * 1-5',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{"action":"generate-all"}'::jsonb,
    -- ⚠️ 必須指定：pg_net 的 timeout_milliseconds 預設只有 5000ms，
    --    但每天第一次執行要抓當天的 T86 與融資融券大檔，實測需 10–13 秒
    --    （之後快取全命中只要約 2 秒）。用預設值的話 net._http_response 每晚都會記成
    --    status_code = null 的逾時失敗，導致「逾時但其實成功」與「真的失敗」無法區分
    --    —— 批次本身仍會在伺服器端跑完，但你就此失去唯一的伺服器端訊號。
    timeout_milliseconds := 60000
  );
  $$
);
-- 註：函數以 --no-verify-jwt 部署，故毋需 Authorization；批次的授權改由 x-cron-secret 把關。
-- 若你的 API Gateway 仍要求 apikey，於 headers 內加 'apikey', '<ANON_KEY>' 即可。
--
-- 執行結果查詢（pg_net 的回應保留 6 小時，見 pg_net.ttl）：
--   select id, status_code, error_msg, left(content, 200) from net._http_response order by id desc limit 5;


-- 7. 批次執行紀錄 (batch_run_log)
--     每次 generate-all 跑完寫一列，用來回答「這個時間點，當天的資料到了沒？」
--
--     為什麼需要它：cron 的三段時間是依「各資料源大約幾點公布」訂的，但那個認知
--     一度是錯的 —— 註解寫 T86（個股三大法人）約 15:00–15:30，實測 2026-07-27 15:42
--     T86 仍未發布，而同一時間 BFI82U（大盤買賣金額統計表）已經有資料。
--     兩份報表被混為一談，導致第一班的餘裕被高估。
--
--     pg_net 的 net._http_response 只保留 6 小時，chip_raw_cache.updated_at 也只記
--     「成功抓到的時間」，兩者都無法回答「那一班跑的時候資料到了沒」。
--     沒有這張表就只能靠人剛好在線上手動 curl 才知道，無從微調排程。
--
--     只由 Edge Function（service role）寫入，故不建 RLS policy —— 與 chip_raw_cache 同款。
CREATE TABLE IF NOT EXISTS batch_run_log (
    id            BIGSERIAL PRIMARY KEY,
    ran_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 執行當下的台北日期與時刻（HH:MM）。存字串是為了直接看得懂是哪一班，免每次轉時區
    taipei_ymd    TEXT,
    taipei_time   TEXT,
    -- 這次批次解析出來的資料日；若當天資料尚未發布，它會是前一個交易日
    data_ymd      TEXT,
    -- data_ymd 是否等於執行當天 → 當天的 T86 這時候到了沒。微調排程時看的就是這一欄
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

ALTER TABLE batch_run_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS batch_run_log_ran_at_idx ON batch_run_log (ran_at DESC);

-- 常用查詢：看各班次抓到當天 T86 的比率，用來決定要不要挪時間或加班次
--   SELECT taipei_time, count(*) AS 跑了幾次,
--          count(*) FILTER (WHERE t86_today) AS 拿到當天T86
--   FROM batch_run_log GROUP BY taipei_time ORDER BY taipei_time;
