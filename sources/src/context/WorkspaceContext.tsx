/**
 * Workspace and transaction data management:
 * - Use SupabaseProvider or LocalProvider depending on the mode
 * - Automatically create a default workspace for first time use
 * - Ledger uses useMemo to recalculate in real time (Dashboard/annual report is updated simultaneously when transactions change)
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { NewTransaction, Transaction, Workspace } from '../types/models'
import type { Ledger } from '../utils/pnlEngine'
import { computeLedger } from '../utils/pnlEngine'
import type { DataProvider } from '../services/dataProvider'
import { LocalProvider, SupabaseProvider } from '../services/dataProvider'
import { isSupabaseConfigured } from '../services/supabase'
import { prefetchStockData } from '../services/prefetchStockData'
import { useAuth } from './AuthContext'

const CURRENT_WS_KEY = 'stock-pnl-web/current-workspace'
const DEFAULT_WS_NAME = '我的投資組合'

export interface WorkspaceState {
  workspaces: Workspace[]
  current: Workspace | null
  transactions: Transaction[]
  ledger: Ledger
  /** Loading for the first time*/
  loading: boolean
  error: string | null
  selectWorkspace: (id: string) => void
  createWorkspace: (name: string) => Promise<void>
  renameWorkspace: (id: string, name: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  addTransactions: (txs: NewTransaction[]) => Promise<void>
  /** Update the contents of a single transaction*/
  updateTransaction: (id: string, patch: NewTransaction) => Promise<void>
  /** Batch deletion (single deletion passes in a single element array)*/
  deleteTransactions: (ids: string[]) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

const EMPTY_LEDGER = computeLedger([])

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const provider = useRef<DataProvider>(
    isSupabaseConfigured ? new SupabaseProvider() : new LocalProvider(),
  ).current

  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const current = workspaces.find((w) => w.id === currentId) ?? null
  const ledger = useMemo(
    () => (transactions.length > 0 ? computeLedger(transactions) : EMPTY_LEDGER),
    [transactions],
  )

  const runSafely = useCallback(async (action: () => Promise<void>) => {
    try {
      setError(null)
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // Load the workspace after logging in; automatically create a default workspace if there is no workspace
  // Rely on user.id instead of user object: token refresh should not be reloaded (otherwise the open Modal will be unmounted)
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    runSafely(async () => {
      let list = await provider.listWorkspaces()
      if (list.length === 0) {
        const ws = await provider.createWorkspace(DEFAULT_WS_NAME)
        list = [ws]
      }
      if (cancelled) return
      setWorkspaces(list)
      // When the memorized workspace cannot be found (including '__all__' in the old version of the overview mode), return to the first workspace
      const saved = localStorage.getItem(CURRENT_WS_KEY)
      const initial = list.find((w) => w.id === saved) ?? list[0]
      setCurrentId(initial.id)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId, provider, runSafely])

  // Load transactions when switching workspaces
  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    localStorage.setItem(CURRENT_WS_KEY, currentId)
    runSafely(async () => {
      const txs = await provider.listTransactions(currentId)
      if (!cancelled) setTransactions(txs)
    })
    return () => {
      cancelled = true
    }
  }, [currentId, provider, runSafely])

  const selectWorkspace = useCallback((id: string) => setCurrentId(id), [])

  const createWorkspace = useCallback(
    async (name: string) => {
      await runSafely(async () => {
        const ws = await provider.createWorkspace(name)
        setWorkspaces((prev) => [...prev, ws])
        setCurrentId(ws.id)
      })
    },
    [provider, runSafely],
  )

  const renameWorkspace = useCallback(
    async (id: string, name: string) => {
      await runSafely(async () => {
        await provider.renameWorkspace(id, name)
        setWorkspaces((prev) => prev.map((w) => (w.id === id ? { ...w, name } : w)))
      })
    },
    [provider, runSafely],
  )

  const deleteWorkspace = useCallback(
    async (id: string) => {
      await runSafely(async () => {
        await provider.deleteWorkspace(id)
        setWorkspaces((prev) => {
          const next = prev.filter((w) => w.id !== id)
          if (currentId === id) setCurrentId(next[0]?.id ?? null)
          return next
        })
      })
    },
    [provider, runSafely, currentId],
  )

  const addTransactions = useCallback(
    async (txs: NewTransaction[]) => {
      if (!currentId) throw new Error('尚未選擇工作區')
      // Snapshot which TPE tickers already have net holdings — first buy of a code warms data.
      const heldBefore = new Set(
        computeLedger(transactions)
          .holdings.filter((h) => h.market === 'TPE' && h.qty > 0)
          .map((h) => h.ticker),
      )
      const created = await provider.addTransactions(currentId, txs)
      setTransactions((prev) => [...prev, ...created])
      const seen = new Set<string>()
      for (const tx of created) {
        if (tx.market !== 'TPE') continue
        if (heldBefore.has(tx.ticker) || seen.has(tx.ticker)) continue
        seen.add(tx.ticker)
        void prefetchStockData(tx.ticker, tx.name)
      }
    },
    [provider, currentId, transactions],
  )

  const updateTransaction = useCallback(
    async (id: string, patch: NewTransaction) => {
      // Without runSafely: throw an error to the form when it fails and retain the input
      await provider.updateTransaction(id, patch)
      setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    },
    [provider],
  )

  const deleteTransactions = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      // Without runSafely: thrown to the caller in case of failure, otherwise the caller has no way of knowing and displays a false "deleted" success notification.
      setError(null)
      try {
        await provider.deleteTransactions(ids)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      }
      const removed = new Set(ids)
      setTransactions((prev) => prev.filter((t) => !removed.has(t.id)))
    },
    [provider],
  )

  const value = useMemo<WorkspaceState>(
    () => ({
      workspaces,
      current,
      transactions,
      ledger,
      loading,
      error,
      selectWorkspace,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      addTransactions,
      updateTransaction,
      deleteTransactions,
    }),
    [
      workspaces,
      current,
      transactions,
      ledger,
      loading,
      error,
      selectWorkspace,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      addTransactions,
      updateTransaction,
      deleteTransactions,
    ],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace 必須在 WorkspaceProvider 內使用')
  return ctx
}
