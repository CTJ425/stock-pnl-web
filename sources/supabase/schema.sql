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

-- 6c. 每交易日 16:00–23:45 每 15 分鐘輪詢一次（台北）＝ UTC 8:00–15:45
--
--     ⚠️ 0.6.1 改版：原本是固定三班（17:30 / 22:30 / 23:30）。改的理由是
--     **那三個時間點是照「各資料源大約幾點公布」的認知訂的，而那個認知被實測推翻了**。
--     2026-07-27 一天之內就推翻三處：
--       1. 註解說 T86 約 15:00–15:30 → 實測 15:42 仍未發布、17:02 已有。
--          （15:00–15:30 是 BFI82U 大盤買賣金額統計表的時間窗，兩份報表被混為一談。）
--       2. 註解說借券約 21:00–22:30 → 實測 17:07 就有當天的了。
--       3. 註解說的是「借券賣出餘額」，但我們實際抓的 TWT96U 是「當日可借券賣出股數」，
--          語意根本不同（見 twChips.ts 的說明）。
--     結論：**別再用時鐘猜發布時間**。改成密集輪詢＋內容判斷，讓資料自己說話。
--
--     為什麼一天 32 次不會爆掉（實測位元組，2026-07-27）：
--       T86 194KB／融資融券 128KB／借券 244KB／估值 116KB／月營收 603KB／公司資料 1.32MB
--       每天實際對外抓取約 8.7MB；Function 呼叫 704 次/月，免費額度 500,000，佔 0.14%。
--     真正的防線不是額度而是這三道，全部實作在 index.ts / pollPlan.ts：
--       1. **短路**：今天該有的都有了就直接回，一個對外請求都不發。
--       2. **改寫偵測**：T86 自 16:00 起每 15 分鐘更新，定稿前每輪重抓比對，
--          連續兩次內容相同才凍結。沒有這道，早抓會把初版鎖成當天的答案，比晚抓更糟。
--       3. **當日執行上限 MAX_RUNS_PER_DAY = 40**：防的是我們自己的判斷邏輯出錯
--          （0.3.9 燒光額度正是這個形狀），以及 x-cron-secret 外流時的最後一道剎車。
--
--     借券的坑（仍然成立）：端點沒有 date 參數、回的永遠是「目前最新」。
--     故用 rwd 版（自帶 title 日期），以「資料自己宣告的日期」為快取鍵，早晚不會互相污染。
--
--     全部落在台北當日內，不影響 taipeiYmd 的判斷。真遇到更誇張的延遲也不會壞：
--     隔天的批次會把前一天缺的補回來，只是那一晚的報告不完整。
-- ⚠️ 下面是**全新安裝**的作法（unschedule + schedule），會重寫整段 command，
--    所以必須重填兩個佔位符 —— 那正是 BUG-002 的成因。
--    **只是要改時間的話，改用 cron.alter_job，它保留原本的 command，密鑰碰都不用碰：**
--      SELECT cron.alter_job(jobid, schedule := '*/15 8-15 * * 1-5')
--      FROM cron.job WHERE jobname = 'stock-report-nightly';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'stock-report-nightly') THEN
    PERFORM cron.unschedule('stock-report-nightly');
  END IF;
END $$;

SELECT cron.schedule(
  'stock-report-nightly',
  '*/15 8-15 * * 1-5',
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

-- 6d. ⚠️ 套用完**一定要跑這段覆驗**（BUG-002 的教訓，見 docs/agent/FIXED_BUG.md）
--
--     正式區曾經整整一段時間盤後批次從來沒靠 cron 跑起來過，因為上面兩個佔位符
--     沒被替換，job 就以字面值 '<CRON_SECRET>' 去呼叫函式、每次都 401。
--     `cron.schedule` 對佔位符字串照收不誤，**「SQL 執行成功」不等於「值填對了」**。
--     而且失敗是無聲的：函式以 --no-verify-jwt 部署，401 只留在 net._http_response
--     （保留 6 小時），Storage 裡又一直有手動產的報告，從前端完全看不出異常。
--
--     ⚠️ 光檢查佔位符不夠 —— BUG-003 是同一顆地雷的變種：測試區的 job 不是「沒換」，
--     而是**換成了正式區的 ref 與密鑰**（推測是複製另一區的 SQL 來修）。
--     結果測試區的排程一直在呼叫正式區的函式，被 401 擋下才沒釀成跨環境誤觸發。
--     所以覆驗必須包含「**url 裡的 project ref 等於本專案自己的 ref**」這一條。
--
--     三條判斷標準：
--       1. url 不得含 '<'，且其 project ref 必須等於 current_setting('request.jwt.claim.ref')
--          拿不到時就用肉眼比對 —— 下面的查詢直接把 url 印出來，看得出是哪一區。
--       2. 密鑰長度不得是 13（那正是 '<CRON_SECRET>' 的長度）。
--       3. 密鑰要與**本專案**的 CRON_SECRET 相同。這條 SQL 驗不了（secrets 不在 DB 內），
--          唯一的實證是排程跑過之後 net._http_response 回 200 而不是 401。
--     只回頭尾 4 碼，貼給別人看也不會外洩密鑰。
--
--   SELECT jobname, schedule, active,
--          (regexp_match(command, 'url\s*:=\s*''([^'']*)'''))[1] AS url,
--          left(s,4) || '…' || right(s,4) || ' 長度=' || length(s) AS 密鑰片段
--   FROM (SELECT jobname, schedule, active, command,
--                (regexp_match(command, $q$'x-cron-secret',\s*'([^']*)'$q$))[1] AS s
--         FROM cron.job WHERE jobname = 'stock-report-nightly') t;
--
--     跑過一輪後再驗這個（**只保留 6 小時**，要看要趁早）：
--   SELECT id, status_code, left(content, 120), created
--   FROM net._http_response ORDER BY id DESC LIMIT 5;
--
--     ⚠️ 第三顆地雷（2026-07-27 當天踩到）：**`CRON_SECRET` 與這段 command 不連動**。
--     前者是 Edge Function 的環境變數，後者是資料庫裡的字串明文。
--     `supabase secrets set CRON_SECRET=...` 之後，這個 job 仍帶著舊值，下一班直接 401。
--     **輪換密鑰是兩步驟操作**：set secret ＋ 重寫這段 command，缺一不可。
--     （正式區 16:55 才修好，19:45 輪換密鑰時又斷了一次，就是漏掉第二步。）


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

-- 0.6.1 新增欄位。用 ADD COLUMN IF NOT EXISTS 而非改上面的 CREATE，
-- 是為了讓已經建過表的環境（正式區 2026-07-27 已建）重跑本檔就能升級。
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS runs_today   INT;      -- 今天第幾次執行（含短路），MAX_RUNS_PER_DAY 靠它把關
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS skipped      BOOLEAN;  -- 這輪短路，沒有任何對外請求
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS skip_reason  TEXT;     -- 'complete' | 'run-cap'
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS regenerated  BOOLEAN;  -- 這輪有沒有重產報告（輸入沒變就不重產）
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS run_sig      TEXT;     -- 報告輸入的指紋，用來判斷要不要重產
-- T86 改寫追蹤：這幾欄同時是觀測資料**與**跨輪次狀態（見 index.ts readLastRun 的說明）
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_fingerprint TEXT;
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_revisions   INT;   -- 今天被改寫過幾次
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_unchanged   INT;   -- 連續幾次抓到相同內容
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS t86_frozen      BOOLEAN; -- 已定稿，不再重抓
-- 各源「自己宣告的資料日」。2026-07-27 實測：TWSE 的 openapi 與 rwd 端點
-- 都不提供 Last-Modified / ETag / Age，一律 Cache-Control: no-cache ——
-- 所以「它幾點上架」記不到，能記的只有「我們去看的時候，它說自己是哪一天的」。
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS margin_today     BOOLEAN; -- 融資融券是否為當天
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS borrow_data_date TEXT;    -- 借券 title 自帶的日期
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS bwibbu_date      TEXT;    -- 估值檔的民國日期，例 '1150724'
-- 0.6.4 月營收歷史回補。沒有這一欄就沒有伺服器端訊號能回答「它到底補了沒」——
-- fundamental/*.json 是覆寫制，從 Storage 只看得到「現在幾筆」，看不到哪一輪補的。
-- 補滿之後這欄會長期是 0（缺口為空就短路），那是正常的，不是壞掉。
ALTER TABLE batch_run_log ADD COLUMN IF NOT EXISTS revenue_backfilled INT;  -- 這輪補寫了幾檔的月營收

ALTER TABLE batch_run_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS batch_run_log_ran_at_idx ON batch_run_log (ran_at DESC);
-- readLastRun 每輪都會查「今天最後一列」，這個索引讓它是 index scan 而不是全表掃
CREATE INDEX IF NOT EXISTS batch_run_log_today_idx ON batch_run_log (taipei_ymd, id DESC);

-- 常用查詢 1：各時刻抓到當天 T86 的比率，用來驗證輪詢窗口夠不夠早 / 夠不夠晚
--   SELECT taipei_time, count(*) AS 跑了幾次,
--          count(*) FILTER (WHERE t86_today) AS 拿到當天T86
--   FROM batch_run_log GROUP BY taipei_time ORDER BY taipei_time;
--
-- 常用查詢 2：每天各源實際到齊的時間（這才是「幾點更新」的真實答案）
--   SELECT taipei_ymd,
--          min(taipei_time) FILTER (WHERE t86_today)   AS T86最早,
--          min(taipei_time) FILTER (WHERE margin_today) AS 融資融券最早,
--          max(t86_revisions)                           AS T86改寫次數,
--          min(taipei_time) FILTER (WHERE t86_frozen)   AS T86定稿時刻
--   FROM batch_run_log GROUP BY taipei_ymd ORDER BY taipei_ymd DESC;
--
-- 常用查詢 3：確認短路真的有在省事（skipped 的那幾輪 duration_ms 應該只有幾十毫秒）
--   SELECT skipped, skip_reason, count(*), round(avg(duration_ms)) AS 平均毫秒
--   FROM batch_run_log GROUP BY 1, 2 ORDER BY 3 DESC;


-- 8. 資料源探針紀錄 (source_probe_log) —— 0.6.3
--
--     這張表回答的問題只有一個：**「這個來源，實際上是幾點更新的？」**
--
--     為什麼 batch_run_log 答不了：`batch_run_log.bwibbu_date` 看起來像在記這件事，
--     其實記的是**快取值**。`readLatest` 用「我們去抓的那天」當快取鍵，
--     當天第一輪抓完就整天吃快取 —— 2026-07-27 那 12 輪全記成同一個 '1150724'，
--     **那不是 12 次觀測，是同一次被讀了 12 遍**；批次一短路更是完全不記。
--     拿它來判斷發布時間會得到假答案，而「用假答案猜發布時間」正是 0.6.1 重做的起因。
--
--     探針刻意**不寫快取、不寫 Storage、不碰批次的任何狀態**，
--     所以 0.6.1 那三道閘門（含「短路＝零對外請求」）完全不受影響，仍然可證。
--
--     只探這兩個 —— 它們是目前唯二「有快取就整天不再看」的來源：
--       BWIBBU_ALL（估值，116KB，每日）／借券 TWT96U（244KB）
--     T86 與融資融券已由 batch_run_log 的 t86_revisions / margin_today 如實記錄；
--     月營收與公司資料是月更新，15 分鐘探一次沒有意義。
--
--     成本：(116+244)KB × 32 輪 ≈ 11.5MB/日。答案拿到後隨時可停，不必重新部署：
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

-- 與盤後批次同節奏。⚠️ 同樣有兩個佔位符要換，套用完務必跑 §6d 的覆驗（含「url 的 ref 是不是自己」）
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'source-probe') THEN
    PERFORM cron.unschedule('source-probe');
  END IF;
END $$;

SELECT cron.schedule(
  'source-probe',
  '*/15 8-15 * * 1-5',
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/stock-report',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'x-cron-secret', '<CRON_SECRET>'
               ),
    body    := '{"action":"probe"}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- 常用查詢 1：**只看變化點** —— 這就是「幾點更新」的直接答案
--   SELECT taipei_time, bwibbu_date, borrow_date FROM (
--     SELECT taipei_time, bwibbu_date, borrow_date, id,
--            lag(bwibbu_fp) OVER (ORDER BY id) AS pb,  bwibbu_fp,
--            lag(borrow_fp) OVER (ORDER BY id) AS pr,  borrow_fp
--     FROM source_probe_log WHERE taipei_ymd = '20260728') t
--   WHERE pb IS DISTINCT FROM bwibbu_fp OR pr IS DISTINCT FROM borrow_fp
--   ORDER BY id;
--
-- 常用查詢 2：每天各來源第一次宣告「新日期」的時刻（累積幾天後才有意義）
--   SELECT taipei_ymd, min(taipei_time) FILTER (WHERE bwibbu_date IS NOT NULL) AS 估值最早,
--          max(bwibbu_date) AS 估值最終日, max(borrow_date) AS 借券最終日
--   FROM source_probe_log GROUP BY taipei_ymd ORDER BY taipei_ymd DESC;
--
-- 常用查詢 3：內容變了但自報日期沒變 —— 代表當天被改寫（跟 T86 一樣的形態）
--   SELECT taipei_time, bwibbu_date, bwibbu_fp FROM source_probe_log
--   WHERE taipei_ymd = '20260728' ORDER BY id;
