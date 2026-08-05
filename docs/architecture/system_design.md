# Stock trading and inventory management system (Web version) system design document

This document plans to port and upgrade the stock management tool originally based on Google Apps Script (GAS) into a modern single-page web application (SPA) based on **React (Vite + TypeScript)**, **Supabase (Database & Auth & Edge Functions)** and deployed on **GitHub Pages**.

> 📌 **2026-07-16 Decision Update**: This document has been revised based on the discussion conclusions - the front end adopts **TypeScript**, the current price is changed to **Supabase Edge Function agent**, **CSV import/export** (including the relocation of old spreadsheet data) is included in the early scope, and the database Schema adds CHECK constraints and workspace ownership consistency verification.

---

## 🏗️ System architecture and technical feasibility assessment

### 1. Deployment architecture: GitHub Pages (front-end static hosting)
* **Feasibility**: **High**. GitHub Pages offers free and extremely fast static web hosting. Since React/Vite projects are built as static HTML, JS, and CSS files, they are very suitable for deployment here.
* **Development environment and construction**: Use Vite as the packaging tool, and configure `base: './'` or `base: '/<repository-name>/'` to be perfectly compatible with the sub-path of GitHub Pages.
* **SPA Routing Notes**: Since it is deployed in a sub-path and GitHub Pages does not support server-side rewrite, the front-end routing uses **HashRouter** (or single-page paging switching, without using router) to avoid 404 when rewriting.
* **Auth Redirect URL**: The Site URL / Redirect URLs of Supabase Auth need to be set to the official URL of GitHub Pages, otherwise the registration confirmation letter and OAuth redirection will fail.

### 2. Backend and database: Supabase (BaaS)
* **Feasibility**: **High**. Supabase provides a PostgreSQL database, GoTrue authentication (Auth), and row level security (RLS).
* **Multi-user isolation**:
  - Through Supabase Auth, users can register/log in using their email address and password.
  - After turning on RLS, establish the following security policy: Each transaction record is bound to the workspace (Workspace) with `user_id`, and users can only read and write data that meets `auth.uid() = user_id`. This ensures 100% data privacy and security.
* **Client connection**: The front end directly uses `@supabase/supabase-js` to make API calls, without the need to write additional Node.js back-end services, which is very suitable for GitHub Pages static websites.

### 3. Current price API acquisition plan (Supabase Edge Function current price agent)
The browser front-end is restricted by the same-origin policy (CORS), and the public CORS Proxy is unstable and has privacy concerns. Therefore, we do not rely on the public Proxy and adopt the following strategy instead:
* **Main strategy: Supabase Edge Function current price agent**
  - Deploy an Edge Function (`stock-price`) in Supabase, and the server will request Yahoo Finance (Taiwan stock `2330.TW` / `.TWO`, US stock `AAPL`) and other sources on your behalf, completely bypassing CORS.
  - The front end uses `supabase.functions.invoke('stock-price', { body: { tickers: [...] } })` to query the current prices of multiple levels in batches to reduce the number of requests; the free quota is more than enough for personal use.
  - Stock name fuzzy search and code reverse search (original GAS's TWSE codeQuery, TPEx OpenAPI, Yahoo search) are also proxied through Edge Function and continue to use the cache strategy of the original project.
* **Taiwan stock backup: TWSE / TPEx OpenAPI direct connection**: Some official endpoints support CORS and can be used as a direct backup path for the current price of Taiwan stocks.
* **Downgrade mechanism**: When the API connection fails or no current price is found for some codes, the last cached price will be displayed (temporarily stored in localStorage and marked with time) or the market value/unrealized profit and loss will be left blank - **not mistakenly displayed as a full loss** (identical to the behavior of the original GAS project).
* **Asynchronous update design**: After entering the web page, the current price is loaded asynchronously (Async) in the background. The skeleton screen (Skeleton) or the last temporary price is displayed before the loading is completed. The unrealized profit and loss is automatically updated after loading.

---

## 🗄️Supabase Database Schema

We need to create three main data tables in Supabase and enable RLS (Row Level Security).

Design focus (2026-07-16 decision):
* The `tx_type` database layer stores `'BUY'` / `'SELL'` (add CHECK constraint), and the display layer then converts to "buy/sell" - it is cleaner for TypeScript types and future expansion; CSV imports old data and is converted by the importer.
* The numerical field plus CHECK constraints (`qty > 0`, `price >= 0`, `fee_tax >= 0`) is isomorphic to the front-end validation.
* `transactions` uses **composite foreign key** `(workspace_id, user_id) REFERENCES workspaces(id, user_id)` to ensure that the workspace to which the transaction belongs indeed belongs to the same user (with `UNIQUE (id, user_id)` of workspaces).
* `market` maintains TEXT without adding CHECK, retaining the flexibility to expand other markets (Japanese stocks, Hong Kong stocks) in the future.

```sql
-- 1. Workspace information table (workspaces)
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Provides composite foreign key references for transactions to ensure workspace ownership consistency
    UNIQUE (id, user_id)
);

-- Enable RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only operate their own workspace
CREATE POLICY "Users can manage their own workspaces"
ON workspaces FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 2. Transaction record data table (transactions)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    workspace_id UUID NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tx_date DATE NOT NULL,
    market TEXT NOT NULL, -- 'TPE' (Taiwan stock) or 'US' (U.S. stock), TEXT retains expansion flexibility
    ticker TEXT NOT NULL, -- ticker (e.g. '2330', 'AAPL') without 'TPE:' prefix
    name TEXT NOT NULL, -- stock name
    tx_type TEXT NOT NULL CHECK (tx_type IN ('BUY', 'SELL')), -- the display layer changes to "Buy/Sell"
    price NUMERIC NOT NULL CHECK (price >= 0), -- transaction unit price
    qty NUMERIC NOT NULL CHECK (qty > 0), -- number of shares traded
    fee_tax NUMERIC NOT NULL DEFAULT 0 CHECK (fee_tax >= 0), -- handling fee/tax
    -- Composite foreign key: ensure that the workspace to which the transaction belongs belongs to the same user
    FOREIGN KEY (workspace_id, user_id)
        REFERENCES workspaces(id, user_id) ON DELETE CASCADE
);

-- Create indexes to speed up queries
CREATE INDEX idx_tx_workspace ON transactions(workspace_id);
CREATE INDEX idx_tx_user ON transactions(user_id);
CREATE INDEX idx_tx_date ON transactions(tx_date ASC);

-- Enable RLS
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

-- RLS strategy: Users can only operate their own transaction records
CREATE POLICY "Users can manage their own transactions"
ON transactions FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);


-- 3. User settings table (user_settings)
CREATE TABLE user_settings (
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

## 📂 Project code structure planning (`sources/`)

The project will use the following React + Vite + **TypeScript** structure (initialized with the `react-ts` template), and all code will be placed under the `sources/` folder:

```
sources/
├── public/ # Static resources (Icon, etc.)
├── src/
│ ├── assets/ # Pictures and global styles
│ ├── components/ # Shared components
│ │ ├── Common/ # Button, input box, Modal, Loading
│ │ ├── Auth/ # Login and registration page (Glassmorphism style)
│ │ ├── Dashboard/ # Inventory overview board (cards, tables, pie charts)
│ │ ├── YearlyReport/ # Annual income report (folded details, KPI card)
│ │ └── Transactions/ # Transaction record form and input form (sidebar/floating window)
│ ├── context/ # Global state management
│ │ ├── AuthContext.tsx # Login status, user information
│ │ └── WorkspaceContext.tsx # Current workspace, transaction data loading, and calculated account books
│ ├── hooks/ # Custom React Hooks
│ │ └── useStockPrices.ts # Asynchronously pull the current stock price in the background
│ ├── services/ # External service API
│ │ ├── supabase.ts # Supabase client initialization
│ │ ├── priceProxy.ts # Call stock-price Edge Function to get the current price
│ │ └── stockSearch.ts # Taiwan and US stock search and code reverse check (via Edge Function)
│ ├── types/ # Shared type definition
│ │ ├── database.types.ts # Supabase CLI database types generated by schema
│ │ └── models.ts # Transaction / Holding / YearlySummary and other interfaces
│ ├── utils/ # Utility function
│ │ ├── pnlEngine.ts # Moving average cost profit and loss calculation engine transplanted from GAS
│ │ ├── csv.ts # CSV import/export (including old data TPE: prefix and Chinese transaction type conversion)
│ │ └── formatters.ts # Amount format (TWD integer, USD decimal)
│ ├── App.tsx # Main routing and application entrance
│ ├── index.css # Global CSS variables and theme design system
│   └── main.tsx
├── supabase/
│   └── functions/
│ └── stock-price/ # Edge Function: current price/search agent (bypass CORS)
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## ⚡ Core logic migration strategy (GAS ➡️ TypeScript)

1. **Core Computing Engine (pnlEngine.ts)**:
   * The `computeLedger_` logic in the original GAS is based on linear scanning of the array. We rewrote it into a **pure TypeScript function** and clearly defined the input and output with `Transaction`, `Holding`, `YearlySummary` and other interfaces (`types/models.ts`).
   * Input: Array of all transactions for a workspace (sorted by date and creation time).
   * Output:
     - `holdings`: List of stocks currently holding > 0 shares (including average price, market value, unrealized gains and losses, realized gains and losses, and rate of return).
     - `yearly`: Realized profits and losses, handling fees, number of transactions and individual stock details calculated by year.
     - `summary`: historical cumulative data of Taiwan and US stocks.
   * **The currency judgment is changed to be determined by the `market` field** (`'TPE'` → TWD, `'US'` → USD), and no longer relies on the `TPE:` prefix of the original GAS version ticker; `ticker` in the database will always store clean codes (such as `2330`, `AAPL`).
   * **Advantages**: Every time a transaction changes or the workspace is switched, the front-end can be recalculated within milliseconds, without the need to create complex triggers or maintain redundant status in the back-end database.

2. **CSV Import/Export (csv.ts)** — Critical path for old data migration:
   * **Import**: Supports CSV export from the "Stock Transaction History" tab of the old Google spreadsheet. The importer needs to handle:
     - `TPE:2330` → `market='TPE'` + `ticker='2330'` prefix dismantling (those without prefix are regarded as US stocks).
     - Transaction type "Buy/Sell" → `'BUY' / 'SELL'`.
     - Date format (`2026/07/15`, `2026-07-15`) parsing is isomorphic to the original GAS `parseTxDate_`.
     - Provide preview and column-by-column verification error prompts before importing, and write batches into Supabase after confirmation.
   * **Export**: Export the current workspace transactions as a CSV backup.

3. **Actuarial isomorphism alignment (Taiwan stocks rounded and taxes rounded off)**:
   * Retain the modified actuarial logic of the original GAS:
     - Taiwan stock handling fees and securities taxes are unconditionally discarded using `Math.floor()` when estimating.
     - The outermost layer uses `Math.round(..., 0)` to round floating point numbers.
     - U.S. stocks maintain decimal calculations.
   * Implement partition formatting in `formatters.ts`: Taiwan stock profits and losses are displayed as integers, with two decimal places for current/average prices; and two decimal places for U.S. stocks.

---

## 🎨 Interface and Visual Design (Premium UX)

In order to provide users with the ultimate visual feast (WOW factor), we will use **Glassmorphism & Neon Dark Mode**:
1. **Color color system**: Deep gray and black background (`#0b0f19`) with translucent frosted glass card, using neon gradient color as the main visual emphasis (neon red `#ff4a5a` is used for Taiwanese stocks to rise, and neon green `#00e676` is used for falling stocks. Note: This is in line with Taiwanese trading habits).
2. **Font Selection**: Introducing Google Fonts - **Inter** and **Outfit** to present a sense of modern technology.
3. **Microinteractions and animations**: Use CSS Transitions and Keyframes to provide smooth transition animations when hovering buttons, switching tabs, and expanding year details.

---

## 🛠️ Implementation Phases

> Each stage is advanced in sequence and verified upon completion; the number of days is not estimated (the original estimate was a manual development reference value and has been removed).

### Phase One: Infrastructure and Environment Setup
* **Job content**:
  1. Initialize the React + TypeScript project with the Vite **`react-ts`** template in `sources/` and set `.gitignore` and `.env.example`.
  2. Create a project in Supabase Console, execute SQL DDL to create data tables (including CHECK constraints and composite foreign keys), and set RLS rules.
  3. Install `@supabase/supabase-js`, `lucide-react` and other packages; use Supabase CLI to generate `database.types.ts` database types.
* **Verification method**:
  - Confirm that the project can successfully start the local server (`npm run dev`) and the `tsc` type check passes.
  - Use Supabase to test the connection and manually write the test account in the backend.

### Phase 2: User authentication and workspace switching
* **Job content**:
  1. Implement `AuthContext` to handle registration, login, logout and login state retention.
  2. Build beautiful Login/Register Glassmorphism pages.
  3. Implement workspace management (add new workspace, switch current workspace).
* **Verification method**:
  - For the test, two people registered separately. After confirming login, they can only see their own workspace in the drop-down menu.
  - Confirm that the login status will not be lost after refreshing the web page.

### Phase 3: Core engine porting, transaction record management and CSV import
* **Job content**:
  1. Move the GAS moving average cost calculation logic to `pnlEngine.ts` (the currency is determined by the `market` field instead), and write unit tests.
  2. Implemented transaction form and sidebar UI, supporting input and real-time estimation of handling fees (Taiwan stock `Math.floor` rounding, selling plus certificate tax, ETF 0.1% judgment).
  3. Implement fuzzy search (reverse search of Taiwan and US stock codes and name correspondence).
  4. Implementation of **CSV import/export (`csv.ts`)**: Prioritize the import (including `TPE:` prefix disassembly and "Buy/SELL" → `BUY/SELL` conversion, import preview and verification), and completely migrate the real transaction data of the user's old spreadsheet into Supabase.
* **Verification method**:
  - Provide a set of known transaction test data (including buying, selling, splitting and liquidation situations) to verify whether the number of shares held, average price and profit and loss calculated by `pnlEngine.ts` are 100% consistent with the results calculated by the template project.
  - Import the real CSV exported from the user's old spreadsheet, and check that the number of transactions, positions in each stock, and realized profits and losses are consistent with the original spreadsheet.

### Stage 4: Dashboard, annual income statement and current price integration
* **Job content**:
  1. Create a Dashboard page (big-character poster, Active shareholding form, fee statistics).
  2. Create an annual income overview page and implement folding grouping (the annual total is expanded to display individual stock details).
  3. Deploy `stock-price` Edge Function and integrate asynchronous stock current prices (`useStockPrices` + `priceProxy.ts`, including cache price downgrade mechanism).
* **Verification method**:
  - Confirm that when adding/deleting transaction records, Dashboard and annual reports can be updated simultaneously (silent update) in an instant.
  - Make sure there is smooth animation when clicking the year expansion button and the layout is neat.
  - The simulated current price API fails (offline/blocks the request), and the confirmation UI is downgraded to display the cache price or left blank or not displayed as a full loss.

### Phase 5: Self-test code review and deployment
* **Job content**:
  1. The self-test program code is safe, confirming that no sensitive information (API Key, password) has been leaked, and confirming that Supabase RLS is safe.
  2. Configure GitHub Actions to automatically package and deploy to GitHub Pages (`vite.config.ts` sets the `base` subpath).
  3. Set the Site URL / Redirect URLs of Supabase Auth to the GitHub Pages URL; confirm that the front-end routing (HashRouter or single page switching) does not reorganize 404.
* **Verification method**:
  - Open an incognito window and access the GitHub Pages URL to test the complete registration, login, accounting, CSV import and reporting process.
