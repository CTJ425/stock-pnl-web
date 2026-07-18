/**
 * 工作區與交易資料管理：
 * - 依模式選用 SupabaseProvider 或 LocalProvider
 * - 首次使用自動建立預設工作區
 * - ledger 以 useMemo 即時重算（交易異動時 Dashboard / 年報同步更新）
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
import type { WorkspaceHolding } from '../utils/aggregate'
import { aggregateWorkspaces } from '../utils/aggregate'
import type { DataProvider } from '../services/dataProvider'
import { LocalProvider, SupabaseProvider } from '../services/dataProvider'
import { isSupabaseConfigured } from '../services/supabase'
import { useAuth } from './AuthContext'

const CURRENT_WS_KEY = 'stock-pnl-web/current-workspace'
const DEFAULT_WS_NAME = '我的投資組合'

/** 「全部工作區」總覽模式的虛擬工作區 id（唯讀） */
export const ALL_WORKSPACES_ID = '__all__'

export interface WorkspaceState {
  workspaces: Workspace[]
  current: Workspace | null
  /** 是否為「全部工作區」總覽模式（唯讀：不可新增 / 編輯 / 刪除交易） */
  isAllView: boolean
  /** 總覽模式下各工作區持股並列（含所屬工作區資訊）；單一工作區模式為空陣列 */
  allHoldings: WorkspaceHolding[]
  transactions: Transaction[]
  ledger: Ledger
  /** 首次載入中 */
  loading: boolean
  error: string | null
  selectWorkspace: (id: string) => void
  createWorkspace: (name: string) => Promise<void>
  renameWorkspace: (id: string, name: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<void>
  addTransactions: (txs: NewTransaction[]) => Promise<void>
  /** 更新單筆交易內容 */
  updateTransaction: (id: string, patch: NewTransaction) => Promise<void>
  /** 批次刪除（單筆刪除傳入單一元素陣列） */
  deleteTransactions: (ids: string[]) => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

const EMPTY_LEDGER = computeLedger([])
const EMPTY_HOLDINGS: WorkspaceHolding[] = []

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

  const isAllView = currentId === ALL_WORKSPACES_ID
  const current = workspaces.find((w) => w.id === currentId) ?? null
  // 總覽模式：各工作區「各自」計算後彙總（混算會讓跨券商的移動平均成本互相污染）
  const aggregated = useMemo(
    () => (isAllView ? aggregateWorkspaces(workspaces, transactions) : null),
    [isAllView, workspaces, transactions],
  )
  const ledger = useMemo(() => {
    if (aggregated) return aggregated.ledger
    return transactions.length > 0 ? computeLedger(transactions) : EMPTY_LEDGER
  }, [aggregated, transactions])
  const allHoldings = aggregated?.holdings ?? EMPTY_HOLDINGS

  const runSafely = useCallback(async (action: () => Promise<void>) => {
    try {
      setError(null)
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // 登入後載入工作區；無任何工作區時自動建立預設工作區
  // 依賴 user.id 而非 user 物件：token 刷新不應重載（否則開啟中的 Modal 會被 unmount）
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
      const saved = localStorage.getItem(CURRENT_WS_KEY)
      // 總覽選項僅在多工作區時存在；只剩一個工作區時退回該工作區，避免卡在唯讀模式
      if (saved === ALL_WORKSPACES_ID && list.length > 1) {
        setCurrentId(ALL_WORKSPACES_ID)
      } else {
        const initial = list.find((w) => w.id === saved) ?? list[0]
        setCurrentId(initial.id)
      }
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [userId, provider, runSafely])

  // 切換工作區時載入交易（總覽模式載入全部）
  useEffect(() => {
    if (!currentId) return
    let cancelled = false
    localStorage.setItem(CURRENT_WS_KEY, currentId)
    runSafely(async () => {
      const txs =
        currentId === ALL_WORKSPACES_ID
          ? await provider.listAllTransactions()
          : await provider.listTransactions(currentId)
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
      if (currentId === ALL_WORKSPACES_ID) throw new Error('總覽模式為唯讀，請先切換到單一工作區')
      const created = await provider.addTransactions(currentId, txs)
      setTransactions((prev) => [...prev, ...created])
    },
    [provider, currentId],
  )

  const updateTransaction = useCallback(
    async (id: string, patch: NewTransaction) => {
      if (isAllView) throw new Error('總覽模式為唯讀，請先切換到單一工作區')
      // 不經 runSafely：失敗時拋給表單顯示錯誤並保留輸入
      await provider.updateTransaction(id, patch)
      setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    },
    [provider, isAllView],
  )

  const deleteTransactions = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      // 不經 runSafely：失敗時拋給呼叫端，否則呼叫端無從得知而顯示假的「已刪除」成功通知
      if (isAllView) {
        const msg = '總覽模式為唯讀，請先切換到單一工作區'
        setError(msg)
        throw new Error(msg)
      }
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
    [provider, isAllView],
  )

  const value = useMemo<WorkspaceState>(
    () => ({
      workspaces,
      current,
      isAllView,
      allHoldings,
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
      isAllView,
      allHoldings,
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
