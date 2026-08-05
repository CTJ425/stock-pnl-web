# Supabase SQL Common Queries

Usage: Go to [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**, paste the snippet you want to execute, and click Run.

> Note: SQL Editor runs as the project owner, **bypassing RLS (Row Level Security)**, and can see all users' data.
> For table definitions, see `sources/supabase/schema.sql`.

---

## 1. Account Queries (auth.users)

### 1. List all registered accounts

```sql
select id, email, created_at, email_confirmed_at, last_sign_in_at
from auth.users
order by created_at desc;
```

- `email_confirmed_at` being `null` means email verification is not complete.
- `last_sign_in_at` shows if the account has logged in recently.

### 2. Query a specific account

```sql
select id, email, created_at, email_confirmed_at
from auth.users
where email = 'someone@example.com';
```

### 3. Count total accounts

```sql
select count(*) as total_users,
       count(email_confirmed_at) as confirmed_users
from auth.users;
```

### 4. Mark all unverified accounts as verified

Use case: Accounts registered before turning off Confirm email, stuck in an unverified state.

```sql
update auth.users
set email_confirmed_at = now()
where email_confirmed_at is null;
```

---

## 2. Data Queries

### 1. Workspaces of each user

```sql
select w.name as workspace, w.created_at, u.email as owner
from workspaces w
join auth.users u on u.id = w.user_id
order by u.email, w.created_at;
```

### 2. Recent transaction records (including account and workspace)

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

### 3. Query all transactions of a specific account

```sql
select t.tx_date, t.market, t.ticker, t.name, t.tx_type, t.price, t.qty, t.fee_tax
from transactions t
join auth.users u on u.id = t.user_id
where u.email = 'someone@example.com'
order by t.tx_date desc;
```

### 4. Query transaction records of a specific stock

```sql
select t.tx_date, t.tx_type, t.price, t.qty, t.fee_tax, u.email
from transactions t
join auth.users u on u.id = t.user_id
where t.ticker = '2330'      -- TWSE stock code does not contain 'TPE:' prefix; US stocks like 'AAPL'
order by t.tx_date;
```

### 5. Transaction count per user

```sql
select u.email, count(*) as tx_count,
       min(t.tx_date) as first_tx, max(t.tx_date) as last_tx
from transactions t
join auth.users u on u.id = t.user_id
group by u.email
order by tx_count desc;
```

### 6. Summary of buy/sell for each stock (example for a specific account)

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

### 7. User settings

```sql
select u.email, s.default_fee_rate, s.theme, s.created_at
from user_settings s
join auth.users u on u.id = s.user_id;
```

---

## 3. Maintenance (Use with caution)

### 1. Delete a specific account and all its data

Foreign keys on `auth.users` are set to `ON DELETE CASCADE`, deleting an account will also delete its workspaces, transactions, and settings.
It is recommended to prioritize using the Console → Authentication → Users interface to delete; SQL method is as follows:

```sql
delete from auth.users where email = 'someone@example.com';
```

### 2. Clear all transactions of an account (keep account and workspace)

```sql
delete from transactions
where user_id = (select id from auth.users where email = 'someone@example.com');
```

### 3. Check if RLS is enabled

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public';
```

The `rowsecurity` for all three tables (`workspaces`, `transactions`, `user_settings`) should be `true`.
