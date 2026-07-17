# 實作計畫：股票交易與庫存管理系統網頁版 (第一階段：專案初始化與資料庫設計)

> 📌 **2026-07-16 決策更新**：前端改採 **TypeScript**（`react-ts` 範本）；資料庫 Schema 加入 CHECK constraints、`tx_type` 改存 `'BUY'/'SELL'`、workspace 歸屬一致性複合外鍵。詳見 `system_design.md`。

## Goal Description
本階段的目標是完成專案開發環境的搭建與資料庫 Schema 設計：
1. **建立並配置 `sources/` 目錄**：利用 Vite 建立 React + **TypeScript**（`react-ts`）專案範本。
2. **產出 Supabase SQL DDL 指令**：將設計好的資料庫綱要（包含 RLS 安全政策、CHECK constraints、關聯欄位與索引）寫入 `build-docs/supabase_schema.sql`，便於使用者在 Supabase 後端直接執行。
3. **配置專案環境變數與套件**：建立環境變數範本 `.env.example`，並規劃核心目錄結構。

---

## User Review Required
> [!IMPORTANT]
> - **Supabase 設定**: 本階段完成後，您需要前往 [Supabase Console](https://supabase.com) 建立專案，並在 SQL Editor 中執行我們提供的 `supabase_schema.sql`。
> - **環境變數設定**: 專案初始化後，請將您的 Supabase URL 與 Anon Key 填寫至 `sources/.env.local` 中（我們會先提供 `.env.example` 檔案）。
> - **Vite 腳本查詢**: 根據系統規範，我們在執行 `create-vite` 初始化前，會先以 `npx create-vite --help` 查詢可用參數。

---

## 已確認決策（原 Open Questions，2026-07-16 結論）
- **Supabase 專案：尚未建立**。本階段產出 `supabase_schema.sql` 與設定教學後，由使用者前往 Supabase Console 建立專案並執行 SQL。
- **市場擴充**：目前僅台美股 (TWD/USD)；`market` 欄位維持 TEXT 不加 CHECK，保留未來擴充其它市場（日股、港股）的彈性。
- **舊資料搬遷**：使用者舊 Google 試算表有真實交易資料，CSV 匯入功能已納入第三階段優先項目（見 `system_design.md`）。

---

## Proposed Changes

### [build-docs] 資料庫與設計文件
#### [NEW] supabase_schema.sql
在 `build-docs/` 目錄下建立 SQL 檔案，定義工作區、交易紀錄、使用者設定之資料表與安全政策。

```sql
-- file: build-docs/supabase_schema.sql
-- 建立工作區資料表
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 供 transactions 複合外鍵引用，確保 workspace 歸屬一致性
    UNIQUE (id, user_id)
);

-- 啟用 RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "Users can manage their own workspaces"
ON workspaces FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 建立交易紀錄資料表
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

-- 建立索引加速查詢
CREATE INDEX IF NOT EXISTS idx_tx_workspace ON transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(tx_date ASC);

-- 啟用 RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "Users can manage their own transactions"
ON transactions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- 建立使用者設定資料表
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    default_fee_rate NUMERIC NOT NULL DEFAULT 0.001425,
    theme TEXT NOT NULL DEFAULT 'dark'
);

-- 啟用 RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "Users can manage their own settings"
ON user_settings FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

---

### [sources] 網頁前端專案
#### [NEW] sources 專案結構
以 `react-ts` 範本初始化 Vite React + TypeScript 專案，並配置 `.env.example`：

```env
# file: sources/.env.example
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

---

## Verification Plan

### 自動化驗證 (Automated Verification)
1. **編譯驗證**: 專案初始化後，於 `sources/` 目錄執行 `npm run build` 確認 Vite 範本能順利打包，無語法或語意錯誤。
2. **靜態檢查**: 確認產生的 `supabase_schema.sql` 語法符合 PostgreSQL 標準格式。

### 手動驗證 (Manual Verification)
1. **檔案結構核對**: 確認專案根目錄下存在 `sources/` 與 `build-docs/` 資料夾，且 `template/` 與 `build-docs/` 確實已被加入 `.gitignore`。
2. **環境變數確認**: 確認 `sources/.env.example` 存在且格式正確。
