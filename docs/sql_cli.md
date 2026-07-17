# Supabase SQL 常用查詢指令

使用方式：到 [Supabase Dashboard](https://supabase.com/dashboard) → 你的專案 → **SQL Editor**，貼上要執行的段落後按 Run。

> 注意：SQL Editor 是以專案擁有者身分執行，**不受 RLS 限制**，看得到所有使用者的資料。
> 資料表結構定義見 `build-docs/supabase_schema.sql`。

---

## 一、帳號查詢（auth.users）

### 1. 列出所有註冊帳號

```sql
select id, email, created_at, email_confirmed_at, last_sign_in_at
from auth.users
order by created_at desc;
```

- `email_confirmed_at` 為 `null` 表示尚未完成信箱驗證。
- `last_sign_in_at` 可看出帳號最近是否有登入。

### 2. 查詢特定帳號

```sql
select id, email, created_at, email_confirmed_at
from auth.users
where email = 'someone@example.com';
```

### 3. 統計帳號總數

```sql
select count(*) as total_users,
       count(email_confirmed_at) as confirmed_users
from auth.users;
```

### 4. 將所有未驗證帳號標記為已驗證

適用情境：關閉 Confirm email 之前註冊、卡在未驗證狀態的帳號。

```sql
update auth.users
set email_confirmed_at = now()
where email_confirmed_at is null;
```

---

## 二、資料查詢

### 1. 各使用者的工作區

```sql
select w.name as workspace, w.created_at, u.email as owner
from workspaces w
join auth.users u on u.id = w.user_id
order by u.email, w.created_at;
```

### 2. 最近的交易紀錄（含所屬帳號與工作區）

```sql
select t.tx_date, t.market, t.ticker, t.name, t.tx_type,
       t.price, t.qty, t.fee_tax,
       w.name as workspace, u.email
from transactions t
join workspaces w on w.id = t.workspace_id
join auth.users u on u.id = t.user_id
order by t.created_at desc
limit 50;
```

### 3. 查詢特定帳號的所有交易

```sql
select t.tx_date, t.market, t.ticker, t.name, t.tx_type, t.price, t.qty, t.fee_tax
from transactions t
join auth.users u on u.id = t.user_id
where u.email = 'someone@example.com'
order by t.tx_date desc;
```

### 4. 查詢特定股票的交易紀錄

```sql
select t.tx_date, t.tx_type, t.price, t.qty, t.fee_tax, u.email
from transactions t
join auth.users u on u.id = t.user_id
where t.ticker = '2330'      -- 台股代號不含 'TPE:' 前綴；美股如 'AAPL'
order by t.tx_date;
```

### 5. 每個使用者的交易筆數統計

```sql
select u.email, count(*) as tx_count,
       min(t.tx_date) as first_tx, max(t.tx_date) as last_tx
from transactions t
join auth.users u on u.id = t.user_id
group by u.email
order by tx_count desc;
```

### 6. 各股票的買賣彙總（以某帳號為例）

```sql
select t.market, t.ticker, t.name,
       sum(case when t.tx_type = 'BUY'  then t.qty else 0 end) as total_buy_qty,
       sum(case when t.tx_type = 'SELL' then t.qty else 0 end) as total_sell_qty,
       sum(case when t.tx_type = 'BUY'  then t.price * t.qty else 0 end) as total_buy_amount,
       sum(case when t.tx_type = 'SELL' then t.price * t.qty else 0 end) as total_sell_amount,
       sum(t.fee_tax) as total_fee_tax
from transactions t
join auth.users u on u.id = t.user_id
where u.email = 'someone@example.com'
group by t.market, t.ticker, t.name
order by t.market, t.ticker;
```

### 7. 使用者設定

```sql
select u.email, s.default_fee_rate, s.theme, s.created_at
from user_settings s
join auth.users u on u.id = s.user_id;
```

---

## 三、維護用（謹慎使用）

### 1. 刪除特定帳號及其所有資料

`auth.users` 上的外鍵皆設定 `ON DELETE CASCADE`，刪除帳號會一併刪除其工作區、交易與設定。
建議優先使用 Console → Authentication → Users 介面刪除；SQL 方式如下：

```sql
delete from auth.users where email = 'someone@example.com';
```

### 2. 清空某帳號的所有交易（保留帳號與工作區）

```sql
delete from transactions
where user_id = (select id from auth.users where email = 'someone@example.com');
```

### 3. 確認 RLS 是否啟用

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public';
```

三張表（`workspaces`、`transactions`、`user_settings`）的 `rowsecurity` 都應為 `true`。
