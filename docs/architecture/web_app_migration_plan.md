# Implementation plan: web version of stock trading and inventory management system (Phase 1: project initialization and database design)

> 📌 **2026-07-16 Decision Update**: The front-end is changed to **TypeScript** (`react-ts` template); the database Schema adds CHECK constraints, `tx_type` is changed to `'BUY'/'SELL'`, and the workspace ownership consistency composite foreign key is added. See `system_design.md` for details.

## Goal Description
The goal of this stage is to complete the construction of the project development environment and database Schema design:
1. **Create and configure the `sources/` directory**: Use Vite to create a React + **TypeScript** (`react-ts`) project template.
2. **Output Supabase SQL DDL command**: Write the designed database schema (including RLS security policy, CHECK constraints, associated fields and indexes) into `build-docs/supabase_schema.sql`, so that users can execute it directly on the Supabase backend.
3. **Configure project environment variables and packages**: Create an environment variable template `.env.example` and plan the core directory structure.

---

## User Review Required
> [!IMPORTANT]
> - **Supabase Settings**: After completing this stage, you need to go to [Supabase Console](https://supabase.com) to create a project and execute the `supabase_schema.sql` we provided in the SQL Editor.
> - **Environment variable setting**: After the project is initialized, please fill in your Supabase URL and Anon Key into `sources/.env.local` (we will provide the `.env.example` file first).
> - **Vite script query**: According to system specifications, before executing `create-vite` initialization, we will first query the available parameters with `npx create-vite --help`.

---

## Decision confirmed (original Open Questions, 2026-07-16 conclusion)
- **Supabase Project: Not created yet**. After generating `supabase_schema.sql` and setting up the tutorial at this stage, the user can go to the Supabase Console to create a project and execute SQL.
- **Market Expansion**: Currently only Taiwan and US stocks (TWD/USD); the `market` field remains TEXT without adding CHECK, retaining the flexibility to expand other markets (Japanese stocks, Hong Kong stocks) in the future.
- **Old data migration**: The user's old Google spreadsheet has real transaction data, and the CSV import function has been included in the third phase priority project (see `system_design.md`).

---

## Proposed Changes

### [build-docs] Database and design documents
#### [NEW] supabase_schema.sql
Create a SQL file in the `build-docs/` directory to define the workspace, transaction records, user-configured data tables and security policies.

```sql
-- file: build-docs/supabase_schema.sql
-- Create workspace data table
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Provides composite foreign key references for transactions to ensure workspace ownership consistency
    UNIQUE (id, user_id)
);

-- Enable RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Users can manage their own workspaces"
ON workspaces FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create transaction record data table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tx_date DATE NOT NULL,
    market TEXT NOT NULL, -- 'TPE' or 'US', TEXT retains expansion flexibility
    ticker TEXT NOT NULL, -- e.g. '2330', 'AAPL' without 'TPE:' prefix
    name TEXT NOT NULL, -- stock name
    tx_type TEXT NOT NULL CHECK (tx_type IN ('BUY', 'SELL')), -- the display layer changes to "Buy/Sell"
    price NUMERIC NOT NULL CHECK (price >= 0),
    qty NUMERIC NOT NULL CHECK (qty > 0),
    fee_tax NUMERIC NOT NULL DEFAULT 0 CHECK (fee_tax >= 0),
    -- Composite foreign key: ensure that the workspace to which the transaction belongs belongs to the same user
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspaces(id, user_id) ON DELETE CASCADE
);

-- Create indexes to speed up queries
CREATE INDEX IF NOT EXISTS idx_tx_workspace ON transactions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_tx_date ON transactions(tx_date ASC);

-- Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Users can manage their own transactions"
ON transactions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create user profile table
CREATE TABLE IF NOT EXISTS user_settings (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    default_fee_rate NUMERIC NOT NULL DEFAULT 0.001425,
    theme TEXT NOT NULL DEFAULT 'dark'
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- RLS policy
CREATE POLICY "Users can manage their own settings"
ON user_settings FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
```

---

### [sources] Web front-end project
#### [NEW] sources project structure
Initialize the Vite React + TypeScript project with the `react-ts` template and configure `.env.example`:

```env
# file: sources/.env.example
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

---

## Verification Plan

### Automated Verification
1. **Compilation verification**: After the project is initialized, execute `npm run build` in the `sources/` directory to confirm that the Vite template can be packaged smoothly without grammatical or semantic errors.
2. **Static check**: Confirm that the generated `supabase_schema.sql` syntax conforms to the PostgreSQL standard format.

### Manual Verification
1. **File structure check**: Confirm that the `sources/` and `build-docs/` folders exist in the project root directory, and `template/` and `build-docs/` have indeed been added to `.gitignore`.
2. **Environment variable confirmation**: Confirm that `sources/.env.example` exists and is in the correct format.
