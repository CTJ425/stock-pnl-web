/**
 * Data layer abstraction: There are two implementations under the same interface——
 * - SupabaseProvider: formal mode, data is stored in Supabase (multi-user + RLS)
 * - LocalProvider: local mode (when the Supabase environment variable is not set), the data is stored in localStorage,
 *   You can use it without logging in; after setting the environment variables, you can seamlessly switch to Supabase mode.
 */
import type { NewTransaction, Transaction, Workspace } from '../types/models'
import { compareTxOrder } from '../utils/pnlEngine'
import { supabase } from './supabase'

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
  /** Batch deletion (single deletion passes in a single element array)*/
  deleteTransactions(ids: string[]): Promise<void>
  /** Persist the workspace's fee rate (source of truth; localStorage is the cache)*/
  setWorkspaceFeeRate(id: string, rate: number): Promise<void>
}

/* =========================================================
 * Native mode: localStorage
 * ========================================================= */

const LOCAL_KEY = 'stock-pnl-web/local-store-v1'

interface LocalStore {
  workspaces: Workspace[]
  transactions: Transaction[]
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readStore(): LocalStore {
  try {
    const raw = localStorage.getItem(LOCAL_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as LocalStore
      if (Array.isArray(parsed.workspaces) && Array.isArray(parsed.transactions)) return parsed
    }
  } catch {
    // Rebuild empty store when data is damaged
  }
  return { workspaces: [], transactions: [] }
}

/**
 * Persist the local-mode store.
 *
 * **Deliberately the one localStorage write that is allowed to throw** —— the cache writers elsewhere
 * (`priceProxy`, `twMarketData`, `aiChatStore`) swallow failures because a lost cache costs one refetch, while a
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
    const created = txs.map((tx, i) => ({
      ...tx,
      id: newId(),
      workspace_id: workspaceId,
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
}

/* =========================================================
 * Supabase mode
 * ========================================================= */

function client() {
  if (!supabase) throw new Error('Supabase 未設定')
  return supabase
}

const WORKSPACE_COLUMNS = 'id, name, created_at, fee_rate'
/** Without fee_rate, for a database that has not run that part of schema.sql. */
const WORKSPACE_COLUMNS_LEGACY = 'id, name, created_at'

const TX_COLUMNS =
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

type NewTxColumn = 'tx_nature' | 'fee_rate'
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
  return null
}

/**
 * Union of the literal column-list strings, not the widened `string` — Supabase's `.select()`
 * overload resolution needs the literal to type the response, otherwise it falls back to a
 * generic `GenericStringError[]` shape.
 */
type TxColumnList = typeof TX_COLUMNS | typeof TX_COLUMNS_WITHOUT_FEE_RATE | typeof TX_COLUMNS_WITHOUT_TX_NATURE | typeof TX_COLUMNS_LEGACY

/** Select column list to use for a given degrade step. */
function txColumnsFor(degrade: TxDegrade): TxColumnList {
  if (degrade === null) return TX_COLUMNS
  if (degrade === 'fee_rate') return TX_COLUMNS_WITHOUT_FEE_RATE
  if (degrade === 'tx_nature') return TX_COLUMNS_WITHOUT_TX_NATURE
  return TX_COLUMNS_LEGACY
}

/** Strips just the column named by `degrade` from a row (or both, for 'both'). No-op for null. */
function stripTxRow<T extends Record<string, unknown>>(row: T, degrade: TxDegrade): Record<string, unknown> {
  if (degrade === null) return row
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

async function currentUserId(): Promise<string> {
  const { data, error } = await client().auth.getUser()
  if (error || !data.user) throw new Error('尚未登入')
  return data.user.id
}

export class SupabaseProvider implements DataProvider {
  async listWorkspaces(): Promise<Workspace[]> {
    const { data, error } = await client()
      .from('workspaces')
      .select(WORKSPACE_COLUMNS)
      .order('created_at', { ascending: true })
    if (!error) return (data ?? []) as Workspace[]

    // The database may not have run the fee_rate part of schema.sql yet. PostgREST rejects
    // the whole query for an unknown column, so retry once without it rather than break login.
    const retry = await client()
      .from('workspaces')
      .select(WORKSPACE_COLUMNS_LEGACY)
      .order('created_at', { ascending: true })
    if (retry.error) throw new Error(`載入工作區失敗：${retry.error.message}`)
    return (retry.data ?? []) as Workspace[]
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
    const { error } = await client().from('workspaces').update({ name }).eq('id', id)
    if (error) throw new Error(`重新命名工作區失敗：${error.message}`)
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
    if (result.error) throw new Error(`寫入交易失敗：${result.error.message}`)
    return (result.data ?? []) as Transaction[]
  }

  async updateTransaction(id: string, patch: NewTransaction): Promise<void> {
    // Same degrade: an unknown tx_nature/fee_rate column rejects the whole update, so retry
    // with only the named column stripped from the patch rather than lose the other one too.
    const result = await withTxColumnDegrade((degrade) =>
      client()
        .from('transactions')
        .update(stripTxRow(patch, degrade))
        .eq('id', id),
    )
    if (result.error) throw new Error(`更新交易失敗：${result.error.message}`)
  }

  async deleteTransactions(ids: string[]): Promise<void> {
    const { error } = await client().from('transactions').delete().in('id', ids)
    if (error) throw new Error(`刪除交易失敗：${error.message}`)
  }

  async setWorkspaceFeeRate(id: string, rate: number): Promise<void> {
    const { error } = await client().from('workspaces').update({ fee_rate: rate }).eq('id', id)
    if (error) throw new Error(`儲存手續費率失敗：${error.message}`)
  }
}
