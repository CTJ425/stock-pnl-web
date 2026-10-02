/**
 * Data layer abstraction: There are two implementations under the same interface——
 * - SupabaseProvider: formal mode, data is stored in Supabase (multi-user + RLS)
 * - LocalProvider: local mode (when the Supabase environment variable is not set), the data is stored in localStorage,
 *   You can use it without logging in; after setting the environment variables, you can seamlessly switch to Supabase mode.
 */
import type { FeeRateSegment, FeeRebate, FeeRounding, Market, SellFeeBasis, NewTransaction, Transaction, TxNature, Workspace } from '../types/models'
import { compareTxOrder } from '../utils/pnlEngine'
import { supabase } from './supabase'
import { logClient } from './appLog'

/** One row of a batch update (TX-03): price/qty/fee_tax/fee_rate, plus an optional tx_nature, by id. */
export interface TxUpdate {
  id: string
  price: number
  qty: number
  fee_tax: number
  fee_rate: number | null
  /**
   * BUG-089: optional on purpose, and absent means "leave it alone". Only the 當沖 labelling
   * wizard sends it; `RecalcFeesModal` and `StockSplitModal` must not reclassify a trade as a
   * side effect of re-pricing or splitting it. Mirrors how `fee_rate` is keyed in the RPC.
   */
  tx_nature?: TxNature | null
}

/** A previously-applied stock split, logged so the wizard can warn before it is reapplied (TX-04). */
export interface SplitLogEntry {
  id: string
  workspace_id: string
  market: Market
  ticker: string
  cutoff_date: string | null
  ratio_from: number
  ratio_to: number
  applied_at: string
}

export type NewSplitLogEntry = Omit<SplitLogEntry, 'id' | 'applied_at'>

export interface DataProvider {
  listWorkspaces(): Promise<Workspace[]>
  createWorkspace(name: string): Promise<Workspace>
  renameWorkspace(id: string, name: string): Promise<void>
  /** Delete the workspace (the transactions under it are also deleted)*/
  deleteWorkspace(id: string): Promise<void>
  listTransactions(workspaceId: string): Promise<Transaction[]>
  /** Batch addition (shared with single transaction and CSV import)*/
  addTransactions(workspaceId: string, txs: NewTransaction[]): Promise<Transaction[]>
  /** Update the contents of a single transaction*/
  updateTransaction(id: string, patch: NewTransaction): Promise<void>
  /** Atomically update several transactions' price/qty/fee_tax/fee_rate (TX-03). */
  updateTransactionsBatch(updates: TxUpdate[]): Promise<void>
  /** List the stock splits already recorded for a workspace (TX-04 duplicate-apply warning). */
  listSplitLog(workspaceId: string): Promise<SplitLogEntry[]>
  /** Record a successfully-applied stock split (TX-04). */
  recordSplit(entry: NewSplitLogEntry): Promise<SplitLogEntry>
  /** Batch deletion (single deletion passes in a single element array)*/
  deleteTransactions(ids: string[]): Promise<void>
  /** Persist the workspace's fee rate (source of truth; localStorage is the cache)*/
  setWorkspaceFeeRate(id: string, rate: number): Promise<void>
  /** Replaces the whole fee-rate history (Task 182); see `utils/feeRateHistory.ts`. */
  setWorkspaceFeeRateHistory(id: string, history: FeeRateSegment[]): Promise<void>
  /** Persist how the workspace's broker refunds the fee discount (現折 / 月退). */
  setWorkspaceFeeRebate(id: string, rebate: FeeRebate): Promise<void>
  /** Persist how the workspace's broker floors the estimated sell fee and tax (BUG-088). */
  setWorkspaceFeeRounding(id: string, rounding: FeeRounding): Promise<void>
  setWorkspaceDayTradeTaxEstimate(id: string, enabled: boolean): Promise<void>
  /** Persist which rate the broker app withholds as the sell fee (Task 189). */
  setWorkspaceSellFeeBasis(id: string, basis: SellFeeBasis): Promise<void>
}

/* =========================================================
 * Native mode: localStorage
 * ========================================================= */

const LOCAL_KEY = 'stock-pnl-web/local-store-v1'

interface LocalStore {
  workspaces: Workspace[]
  transactions: Transaction[]
  splitLog: SplitLogEntry[]
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * Where a store that could not be read is copied before it is replaced (Task 185 / C4). An empty
 * store is returned for it, and the very next write would otherwise overwrite the user's only copy.
 */
const UNREADABLE_BACKUP_KEY = `${LOCAL_KEY}/unreadable-backup`

function backUpUnreadableStore(raw: string): void {
  try {
    if (localStorage.getItem(UNREADABLE_BACKUP_KEY) !== raw) localStorage.setItem(UNREADABLE_BACKUP_KEY, raw)
  } catch {
    // Quota or blocked storage: the copy is a courtesy, never a reason to fail a read.
  }
}

function readStore(): LocalStore {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(LOCAL_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LocalStore
      if (Array.isArray(parsed.workspaces) && Array.isArray(parsed.transactions)) {
        // splitLog is new (TX-04): a store written before it existed has no such array.
        return { ...parsed, splitLog: Array.isArray(parsed.splitLog) ? parsed.splitLog : [] }
      }
    }
  } catch {
    // Rebuild an empty store when the data is damaged — after keeping what was there.
  }
  if (raw) backUpUnreadableStore(raw)
  return { workspaces: [], transactions: [], splitLog: [] }
}

/**
 * Persist the local-mode store.
 *
 * **Deliberately the one localStorage write that is allowed to throw** —— the cache writers elsewhere
 * (`priceProxy`, `twMarketData`) swallow failures because a lost cache costs one refetch, while a
 * lost transaction is the user's own data and silence would be the worst outcome.
 *
 * What 0.6.43 adds (AUDIT-06) is a message. It used to throw the raw `QuotaExceededError`, which surfaces as an
 * unhandled rejection somewhere far from the save the user just made —— the write failed and the screen said
 * nothing. Now the reason reaches the caller, and the caller already shows the message.
 */
function writeStore(store: LocalStore): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(store))
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === 'QuotaExceededError' || e.code === 22)
    throw new Error(
      quota
        ? '瀏覽器的本機儲存空間已滿，這筆資料沒有存下來。請先匯出備份並刪除一些舊紀錄。'
        : '無法寫入瀏覽器的本機儲存空間，這筆資料沒有存下來。若使用無痕視窗，請改用一般視窗。',
    )
  }
}

export class LocalProvider implements DataProvider {
  async listWorkspaces(): Promise<Workspace[]> {
    return readStore().workspaces
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const store = readStore()
    const ws: Workspace = { id: newId(), name, created_at: new Date().toISOString() }
    store.workspaces.push(ws)
    writeStore(store)
    return ws
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.name = name
      writeStore(store)
    }
  }

  async deleteWorkspace(id: string): Promise<void> {
    const store = readStore()
    store.workspaces = store.workspaces.filter((w) => w.id !== id)
    store.transactions = store.transactions.filter((t) => t.workspace_id !== id)
    writeStore(store)
  }

  async listTransactions(workspaceId: string): Promise<Transaction[]> {
    // BUG-049: share the engine's comparator so local mode and Supabase mode can never
    // disagree on the order of two transactions whose tx_date and created_at both tie.
    return readStore()
      .transactions.filter((t) => t.workspace_id === workspaceId)
      .sort(compareTxOrder)
  }

  async addTransactions(workspaceId: string, txs: NewTransaction[]): Promise<Transaction[]> {
    const store = readStore()
    const base = Date.now()
    // Task 186: local mode assigns `seq` itself, so both storage modes order a same-day import
    // the same way. The cloud side lets Postgres do it (`nextval` per row, in the order sent).
    const nextSeq =
      store.transactions.reduce((max, t) => (typeof t.seq === 'number' && t.seq > max ? t.seq : max), 0) + 1
    const created = txs.map((tx, i) => ({
      ...tx,
      id: newId(),
      workspace_id: workspaceId,
      seq: nextSeq + i,
      // Ensure that the same batch import maintains the original order in millisecond increments (engine same-day transactions are sorted by created_at)
      created_at: new Date(base + i).toISOString(),
    }))
    store.transactions.push(...created)
    writeStore(store)
    return created
  }

  async updateTransaction(id: string, patch: NewTransaction): Promise<void> {
    const store = readStore()
    const idx = store.transactions.findIndex((t) => t.id === id)
    if (idx < 0) throw new Error('找不到要更新的交易')
    store.transactions[idx] = { ...store.transactions[idx], ...patch }
    writeStore(store)
  }

  /**
   * Atomic by construction: every id is resolved against the same in-memory `store` before
   * anything is mutated, so a missing id throws before `writeStore` ever runs and no row is
   * half-applied (TX-03, same guarantee the Supabase RPC gives via one SQL statement).
   */
  async updateTransactionsBatch(updates: TxUpdate[]): Promise<void> {
    const store = readStore()
    const indices = updates.map((u) => {
      const idx = store.transactions.findIndex((t) => t.id === u.id)
      if (idx < 0) throw new Error('找不到要更新的交易')
      return idx
    })
    updates.forEach((u, i) => {
      const idx = indices[i]
      store.transactions[idx] = {
        ...store.transactions[idx],
        price: u.price,
        qty: u.qty,
        fee_tax: u.fee_tax,
        fee_rate: u.fee_rate,
        // Same key-presence rule as the cloud RPC: an update without the key keeps the stored
        // nature, so local mode and cloud mode cannot drift apart (BUG-089).
        ...('tx_nature' in u ? { tx_nature: u.tx_nature ?? null } : {}),
      }
    })
    writeStore(store)
  }

  async listSplitLog(workspaceId: string): Promise<SplitLogEntry[]> {
    return readStore().splitLog.filter((s) => s.workspace_id === workspaceId)
  }

  async recordSplit(entry: NewSplitLogEntry): Promise<SplitLogEntry> {
    const store = readStore()
    const row: SplitLogEntry = { ...entry, id: newId(), applied_at: new Date().toISOString() }
    store.splitLog.push(row)
    writeStore(store)
    return row
  }

  async deleteTransactions(ids: string[]): Promise<void> {
    const removed = new Set(ids)
    const store = readStore()
    store.transactions = store.transactions.filter((t) => !removed.has(t.id))
    writeStore(store)
  }

  async setWorkspaceFeeRate(id: string, rate: number): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.fee_rate = rate
      writeStore(store)
    }
  }

  async setWorkspaceFeeRateHistory(id: string, history: FeeRateSegment[]): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.fee_rate_history = history
      writeStore(store)
    }
  }

  async setWorkspaceFeeRebate(id: string, rebate: FeeRebate): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.fee_rebate = rebate
      writeStore(store)
    }
  }

  async setWorkspaceFeeRounding(id: string, rounding: FeeRounding): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.fee_rounding = rounding
      writeStore(store)
    }
  }

  async setWorkspaceDayTradeTaxEstimate(id: string, enabled: boolean): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.day_trade_tax_estimate = enabled
      writeStore(store)
    }
  }

  async setWorkspaceSellFeeBasis(id: string, basis: SellFeeBasis): Promise<void> {
    const store = readStore()
    const ws = store.workspaces.find((w) => w.id === id)
    if (ws) {
      ws.sell_fee_basis = basis
      writeStore(store)
    }
  }
}

/* =========================================================
 * Supabase mode
 * ========================================================= */

function client() {
  if (!supabase) throw new Error('Supabase 未設定')
  return supabase
}

const WORKSPACE_COLUMNS =
  'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate, sell_fee_basis'
/** Without sell_fee_basis, for a database that has not run that part of schema.sql (Task 189). */
const WORKSPACE_COLUMNS_WITHOUT_SELL_BASIS =
  'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding, day_trade_tax_estimate'
/** Without day_trade_tax_estimate, for a database that has not run that part of schema.sql (BUG-090). */
const WORKSPACE_COLUMNS_WITHOUT_DAY_TRADE =
  'id, name, created_at, fee_rate, fee_rate_history, fee_rebate, fee_rounding'
/** Without fee_rate_history, for a database that has not run that part of schema.sql (Task 182). */
const WORKSPACE_COLUMNS_WITHOUT_HISTORY = 'id, name, created_at, fee_rate, fee_rebate, fee_rounding'
/** Without fee_rounding, for a database that has not run that part of schema.sql (BUG-088). */
const WORKSPACE_COLUMNS_WITHOUT_ROUNDING = 'id, name, created_at, fee_rate, fee_rebate'
/** Without fee_rebate, for a database that has not run that part of schema.sql. */
const WORKSPACE_COLUMNS_WITHOUT_REBATE = 'id, name, created_at, fee_rate'
/** Without fee_rate either, for a database that has not run that part of schema.sql. */
const WORKSPACE_COLUMNS_LEGACY = 'id, name, created_at'

const TX_COLUMNS =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, fee_rate, seq, created_at'
/** Without seq, for a database that has not run that part of schema.sql (Task 186). */
const TX_COLUMNS_WITHOUT_SEQ =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, fee_rate, created_at'
/** Without fee_rate only, for a database that has tx_nature but has not run the fee_rate part of schema.sql. */
const TX_COLUMNS_WITHOUT_FEE_RATE =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, tx_nature, created_at'
/** Without tx_nature only, for a database that has fee_rate but has not run the tx_nature part of schema.sql. */
const TX_COLUMNS_WITHOUT_TX_NATURE =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, fee_rate, created_at'
/** Without tx_nature and fee_rate, for a database that has not run that part of schema.sql. */
const TX_COLUMNS_LEGACY =
  'id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at'

const SPLIT_LOG_COLUMNS = 'id, workspace_id, market, ticker, cutoff_date, ratio_from, ratio_to, applied_at'

type NewTxColumn = 'tx_nature' | 'fee_rate' | 'seq'
/** null: nothing dropped (full column set). 'both': neither new column present. */
type TxDegrade = NewTxColumn | 'both' | null

/**
 * Names the new column a 42703 / PGRST204 error refers to, or null when it names neither.
 * `fee_rate` is checked first because a message can theoretically name both (it does not in
 * practice — Postgres/PostgREST report one undefined column per error).
 */
function missingTxColumn(error: { message?: string | null } | null): NewTxColumn | null {
  const message = error?.message ?? ''
  if (message.includes('fee_rate')) return 'fee_rate'
  if (message.includes('tx_nature')) return 'tx_nature'
  // Task 186: `seq` is read-only for the client (Postgres assigns it), so a database without it
  // only needs the column dropped from the SELECT list — the rest of the row is unaffected.
  if (message.includes('seq')) return 'seq'
  return null
}

/**
 * Union of the literal column-list strings, not the widened `string` — Supabase's `.select()`
 * overload resolution needs the literal to type the response, otherwise it falls back to a
 * generic `GenericStringError[]` shape.
 */
type TxColumnList =
  | typeof TX_COLUMNS
  | typeof TX_COLUMNS_WITHOUT_SEQ
  | typeof TX_COLUMNS_WITHOUT_FEE_RATE
  | typeof TX_COLUMNS_WITHOUT_TX_NATURE
  | typeof TX_COLUMNS_LEGACY

/** Select column list to use for a given degrade step. */
function txColumnsFor(degrade: TxDegrade): TxColumnList {
  if (degrade === null) return TX_COLUMNS
  if (degrade === 'seq') return TX_COLUMNS_WITHOUT_SEQ
  if (degrade === 'fee_rate') return TX_COLUMNS_WITHOUT_FEE_RATE
  if (degrade === 'tx_nature') return TX_COLUMNS_WITHOUT_TX_NATURE
  return TX_COLUMNS_LEGACY
}

/** Strips just the column named by `degrade` from a row (or both, for 'both'). No-op for null. */
function stripTxRow<T extends Record<string, unknown>>(row: T, degrade: TxDegrade): Record<string, unknown> {
  // Task 186: `seq` is assigned by the database; a client that sent one would fight the sequence.
  // It is never in a write payload, so a 'seq' degrade only affects the SELECT list.
  if (degrade === 'seq' || degrade === null) return row
  if (degrade === 'both') {
    const { tx_nature: _tx_nature, fee_rate: _fee_rate, ...rest } = row
    return rest
  }
  const rest = { ...row }
  delete rest[degrade]
  return rest
}

/**
 * The only error class a legacy-schema retry can fix. Postgres reports an undefined column as
 * 42703 on reads; PostgREST reports it as PGRST204 on writes, where the column is missing from
 * its schema cache. Retrying anything else is wrong — an INSERT is not idempotent, so a blind
 * retry after a dropped response writes the rows twice.
 */
function isMissingColumnError(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204'
}

interface TxOpResult {
  data: unknown
  error: { code?: string | null; message?: string | null } | null
}

/**
 * Runs `run` with the full column set, then degrades once to drop only the column the error
 * names (keeping the other new column). If that retry also fails with a missing-column error —
 * the database has neither column — allows exactly one further retry dropping both. At most 3
 * attempts total. A 42703/PGRST204 means the statement was rejected before any write, so this
 * chain cannot duplicate rows; any other error returns immediately without a further attempt.
 */
async function withTxColumnDegrade<R extends TxOpResult>(run: (degrade: TxDegrade) => PromiseLike<R>): Promise<R> {
  const first = await run(null)
  if (!first.error || !isMissingColumnError(first.error)) return first

  const missing = missingTxColumn(first.error)
  const second = await run(missing === null ? 'both' : missing)
  if (!second.error || missing === null || !isMissingColumnError(second.error)) return second

  return run('both')
}

/**
 * PostgREST answers an UPDATE that matched no row (filtered out by RLS, or already deleted from
 * another tab or device) with plain success. The write paths ask for the ids back (`.select('id')`)
 * and treat an empty answer as a failure, the way `LocalProvider` already does for a missing id.
 */
function assertRowsAffected(data: unknown, message: string): void {
  if (!Array.isArray(data) || data.length === 0) throw new Error(message)
}

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser()
  if (error || !data.user) throw new Error('尚未登入')
  return data.user.id
}

export class SupabaseProvider implements DataProvider {
  async listWorkspaces(): Promise<Workspace[]> {
    // The database may not have run the fee_rebate or fee_rate part of schema.sql yet. PostgREST
    // rejects the whole query for an unknown column, so step down one column set at a time rather
    // than break login (a frontend deploy can land before the migration).
    const columnSets = [
      WORKSPACE_COLUMNS,
      WORKSPACE_COLUMNS_WITHOUT_SELL_BASIS,
      WORKSPACE_COLUMNS_WITHOUT_DAY_TRADE,
      WORKSPACE_COLUMNS_WITHOUT_HISTORY,
      WORKSPACE_COLUMNS_WITHOUT_ROUNDING,
      WORKSPACE_COLUMNS_WITHOUT_REBATE,
      WORKSPACE_COLUMNS_LEGACY,
    ]
    let lastError = ''
    for (const columns of columnSets) {
      const { data, error } = await client()
        .from('workspaces')
        .select(columns)
        .order('created_at', { ascending: true })
      if (!error) return (data ?? []) as unknown as Workspace[]
      lastError = error.message
    }
    throw new Error(`載入工作區失敗：${lastError}`)
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const userId = await currentUserId()
    const { data, error } = await client()
      .from('workspaces')
      .insert({ name, user_id: userId })
      .select(WORKSPACE_COLUMNS_LEGACY)
      .single()
    if (error) throw new Error(`建立工作區失敗：${error.message}`)
    return data as Workspace
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    const { data, error } = await client().from('workspaces').update({ name }).eq('id', id).select('id')
    if (error) throw new Error(`重新命名工作區失敗：${error.message}`)
    assertRowsAffected(data, '重新命名工作區失敗：找不到這個工作區')
  }

  async deleteWorkspace(id: string): Promise<void> {
    const { error } = await client().from('workspaces').delete().eq('id', id)
    if (error) throw new Error(`刪除工作區失敗：${error.message}`)
  }

  async listTransactions(workspaceId: string): Promise<Transaction[]> {
    // BUG-066: PostgREST caps a response at `max_rows` (1000), so a workspace past that many
    // transactions silently lost every row past the first page. Page with .range() until a
    // page comes back short.
    const PAGE = 1000
    const selectPage = (degrade: TxDegrade, from: number) =>
      client()
        .from('transactions')
        .select(txColumnsFor(degrade) as typeof TX_COLUMNS)
        .eq('workspace_id', workspaceId)
        .order('tx_date', { ascending: true })
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)

    // The database may not have run the tx_nature/fee_rate part of schema.sql yet. PostgREST
    // rejects the whole query for an unknown column, so degrade to only the column that error
    // actually names rather than drop both and lose the one the database does have. That
    // decision only needs to be made once, on the first page — every later page reuses
    // whichever column list the first page settled on.
    let settledDegrade: TxDegrade = null
    const first = await withTxColumnDegrade((degrade) => {
      settledDegrade = degrade
      return selectPage(degrade, 0)
    })
    if (first.error) throw new Error(`載入交易紀錄失敗：${first.error.message}`)
    const rows = (first.data ?? []) as Transaction[]
    if (rows.length < PAGE) return rows

    for (let from = PAGE; ; from += PAGE) {
      const result = await selectPage(settledDegrade, from)
      if (result.error) throw new Error(`載入交易紀錄失敗：${result.error.message}`)
      const page = (result.data ?? []) as Transaction[]
      rows.push(...page)
      if (page.length < PAGE) break
    }
    return rows
  }

  async addTransactions(workspaceId: string, txs: NewTransaction[]): Promise<Transaction[]> {
    const userId = await currentUserId()
    const rows = txs.map((tx) => ({ ...tx, workspace_id: workspaceId, user_id: userId }))
    // Same degrade as listTransactions: an unknown tx_nature/fee_rate column rejects the whole
    // insert, so retry with only the named column stripped from every row. Anything else is not
    // retried — an INSERT is not idempotent, so a blind retry after a dropped response would
    // write the rows twice.
    const result = await withTxColumnDegrade((degrade) =>
      client()
        .from('transactions')
        .insert(rows.map((row) => stripTxRow(row, degrade)))
        .select(txColumnsFor(degrade) as typeof TX_COLUMNS),
    )
    if (result.error) {
      logClient('error', 'addTransactions', result.error.message, { code: result.error.code })
      throw new Error(`寫入交易失敗：${result.error.message}`)
    }
    return (result.data ?? []) as Transaction[]
  }

  async updateTransaction(id: string, patch: NewTransaction): Promise<void> {
    // Same degrade: an unknown tx_nature/fee_rate column rejects the whole update, so retry
    // with only the named column stripped from the patch rather than lose the other one too.
    const result = await withTxColumnDegrade((degrade) =>
      client()
        .from('transactions')
        .update(stripTxRow(patch, degrade))
        .eq('id', id)
        .select('id'),
    )
    if (result.error) {
      logClient('error', 'updateTransaction', result.error.message, { code: result.error.code })
      throw new Error(`更新交易失敗：${result.error.message}`)
    }
    assertRowsAffected(result.data, '更新交易失敗：找不到要更新的交易')
  }

  /**
   * One RPC call updates every row inside one SQL statement (TX-03) — no per-row round trip
   * that could leave a split or a fee recalculation half-applied. `apply_transaction_updates`
   * returns the number of rows it actually updated (RLS still applies inside it). Since Task 185
   * (A3) it raises — rolling the whole batch back — when any id matched no row. The count check
   * below is the second line for a database that has not applied that schema.sql yet: there the
   * matched rows are already committed, and the message says so instead of claiming nothing changed.
   */
  async updateTransactionsBatch(updates: TxUpdate[]): Promise<void> {
    if (updates.length === 0) return
    const { data, error } = await client().rpc('apply_transaction_updates', { p_updates: updates })
    if (error) {
      logClient('error', 'updateTransactionsBatch', error.message, { code: error.code })
      throw new Error(`批次更新交易失敗：${error.message}`)
    }
    const updated = typeof data === 'number' ? data : Number(data ?? 0)
    if (updated < updates.length) {
      throw new Error(
        `批次更新交易失敗：預期更新 ${updates.length} 筆，實際更新 ${updated} 筆。若資料庫尚未套用最新的 schema.sql，已更新的列不會自動回復，請重新整理後檢查這些交易紀錄。`,
      )
    }
  }

  async listSplitLog(workspaceId: string): Promise<SplitLogEntry[]> {
    const { data, error } = await client()
      .from('tx_split_log')
      .select(SPLIT_LOG_COLUMNS)
      .eq('workspace_id', workspaceId)
    if (error) throw new Error(`載入分割紀錄失敗：${error.message}`)
    return (data ?? []) as SplitLogEntry[]
  }

  async recordSplit(entry: NewSplitLogEntry): Promise<SplitLogEntry> {
    const userId = await currentUserId()
    const { data, error } = await client()
      .from('tx_split_log')
      .insert({ ...entry, user_id: userId })
      .select(SPLIT_LOG_COLUMNS)
      .single()
    if (error) throw new Error(`記錄分割紀錄失敗：${error.message}`)
    return data as SplitLogEntry
  }

  async deleteTransactions(ids: string[]): Promise<void> {
    const { error } = await client().from('transactions').delete().in('id', ids)
    if (error) {
      logClient('error', 'deleteTransactions', error.message, { code: error.code })
      throw new Error(`刪除交易失敗：${error.message}`)
    }
  }

  async setWorkspaceFeeRate(id: string, rate: number): Promise<void> {
    const { data, error } = await client().from('workspaces').update({ fee_rate: rate }).eq('id', id).select('id')
    if (error) throw new Error(`儲存手續費率失敗：${error.message}`)
    assertRowsAffected(data, '儲存手續費率失敗：找不到這個工作區')
  }

  async setWorkspaceFeeRateHistory(id: string, history: FeeRateSegment[]): Promise<void> {
    const { data, error } = await client()
      .from('workspaces')
      .update({ fee_rate_history: history })
      .eq('id', id)
      .select('id')
    if (error) throw new Error(`儲存費率生效日失敗：${error.message}`)
    assertRowsAffected(data, '儲存費率生效日失敗：找不到這個工作區')
  }

  async setWorkspaceFeeRebate(id: string, rebate: FeeRebate): Promise<void> {
    const { data, error } = await client().from('workspaces').update({ fee_rebate: rebate }).eq('id', id).select('id')
    if (error) throw new Error(`儲存折扣退還方式失敗：${error.message}`)
    assertRowsAffected(data, '儲存折扣退還方式失敗：找不到這個工作區')
  }

  async setWorkspaceFeeRounding(id: string, rounding: FeeRounding): Promise<void> {
    const { data, error } = await client().from('workspaces').update({ fee_rounding: rounding }).eq('id', id).select('id')
    if (error) throw new Error(`儲存手續費計算方式失敗：${error.message}`)
    assertRowsAffected(data, '儲存手續費計算方式失敗：找不到這個工作區')
  }

  async setWorkspaceDayTradeTaxEstimate(id: string, enabled: boolean): Promise<void> {
    const { data, error } = await client()
      .from('workspaces')
      .update({ day_trade_tax_estimate: enabled })
      .eq('id', id)
      .select('id')
    if (error) throw new Error(`儲存當沖稅率估算方式失敗：${error.message}`)
    assertRowsAffected(data, '儲存當沖稅率估算方式失敗：找不到這個工作區')
  }

  async setWorkspaceSellFeeBasis(id: string, basis: SellFeeBasis): Promise<void> {
    const { data, error } = await client()
      .from('workspaces')
      .update({ sell_fee_basis: basis })
      .eq('id', id)
      .select('id')
    if (error) throw new Error(`儲存賣出手續費預扣方式失敗：${error.message}`)
    assertRowsAffected(data, '儲存賣出手續費預扣方式失敗：找不到這個工作區')
  }
}
