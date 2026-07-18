/**
 * 資料層抽象：同一介面下有兩個實作——
 * - SupabaseProvider：正式模式，資料存 Supabase（多使用者 + RLS）
 * - LocalProvider：本機模式（未設定 Supabase 環境變數時），資料存 localStorage，
 *   免登入即可使用；之後設定環境變數即無縫切換為 Supabase 模式
 */
import type { NewTransaction, Transaction, Workspace } from '../types/models'
import { supabase } from './supabase'

export interface DataProvider {
  listWorkspaces(): Promise<Workspace[]>
  createWorkspace(name: string): Promise<Workspace>
  renameWorkspace(id: string, name: string): Promise<void>
  /** 刪除工作區（其下交易一併刪除） */
  deleteWorkspace(id: string): Promise<void>
  listTransactions(workspaceId: string): Promise<Transaction[]>
  /** 全部工作區的交易（「總覽」模式用） */
  listAllTransactions(): Promise<Transaction[]>
  /** 批次新增（單筆與 CSV 匯入共用） */
  addTransactions(workspaceId: string, txs: NewTransaction[]): Promise<Transaction[]>
  /** 更新單筆交易內容 */
  updateTransaction(id: string, patch: NewTransaction): Promise<void>
  /** 批次刪除（單筆刪除傳入單一元素陣列） */
  deleteTransactions(ids: string[]): Promise<void>
}

/* =========================================================
 * 本機模式：localStorage
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
    // 資料損毀時重建空 store
  }
  return { workspaces: [], transactions: [] }
}

function writeStore(store: LocalStore): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(store))
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
    return readStore()
      .transactions.filter((t) => t.workspace_id === workspaceId)
      .sort(
        (a, b) =>
          a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at),
      )
  }

  async listAllTransactions(): Promise<Transaction[]> {
    return readStore().transactions.sort(
      (a, b) =>
        a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at),
    )
  }

  async addTransactions(workspaceId: string, txs: NewTransaction[]): Promise<Transaction[]> {
    const store = readStore()
    const base = Date.now()
    const created = txs.map((tx, i) => ({
      ...tx,
      id: newId(),
      workspace_id: workspaceId,
      // 以毫秒遞增確保同批匯入維持原始順序（引擎同日交易以 created_at 排序）
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
}

/* =========================================================
 * Supabase 模式
 * ========================================================= */

function client() {
  if (!supabase) throw new Error('Supabase 未設定')
  return supabase
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
      .select('id, name, created_at')
      .order('created_at', { ascending: true })
    if (error) throw new Error(`載入工作區失敗：${error.message}`)
    return (data ?? []) as Workspace[]
  }

  async createWorkspace(name: string): Promise<Workspace> {
    const userId = await currentUserId()
    const { data, error } = await client()
      .from('workspaces')
      .insert({ name, user_id: userId })
      .select('id, name, created_at')
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
    const { data, error } = await client()
      .from('transactions')
      .select('id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at')
      .eq('workspace_id', workspaceId)
      .order('tx_date', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw new Error(`載入交易紀錄失敗：${error.message}`)
    return (data ?? []) as Transaction[]
  }

  async listAllTransactions(): Promise<Transaction[]> {
    // RLS 以使用者為界，不加 workspace 過濾即為該使用者的全部交易
    const { data, error } = await client()
      .from('transactions')
      .select('id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at')
      .order('tx_date', { ascending: true })
      .order('created_at', { ascending: true })
    if (error) throw new Error(`載入交易紀錄失敗：${error.message}`)
    return (data ?? []) as Transaction[]
  }

  async addTransactions(workspaceId: string, txs: NewTransaction[]): Promise<Transaction[]> {
    const userId = await currentUserId()
    const rows = txs.map((tx) => ({ ...tx, workspace_id: workspaceId, user_id: userId }))
    const { data, error } = await client()
      .from('transactions')
      .insert(rows)
      .select('id, workspace_id, tx_date, market, ticker, name, tx_type, price, qty, fee_tax, created_at')
    if (error) throw new Error(`寫入交易失敗：${error.message}`)
    return (data ?? []) as Transaction[]
  }

  async updateTransaction(id: string, patch: NewTransaction): Promise<void> {
    const { error } = await client().from('transactions').update(patch).eq('id', id)
    if (error) throw new Error(`更新交易失敗：${error.message}`)
  }

  async deleteTransactions(ids: string[]): Promise<void> {
    const { error } = await client().from('transactions').delete().in('id', ids)
    if (error) throw new Error(`刪除交易失敗：${error.message}`)
  }
}
