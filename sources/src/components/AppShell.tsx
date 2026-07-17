/** 應用外殼：頁首（品牌、工作區切換、主題切換、登出）、分頁導覽、全域新增交易與內容區 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  CalendarRange,
  HardDrive,
  LayoutDashboard,
  ListPlus,
  LogOut,
  Monitor,
  Moon,
  NotebookPen,
  Pencil,
  Percent,
  Plus,
  Sun,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import type { ThemePref } from '../utils/settings'
import { applyTheme, getFeeRate, getThemePref, setFeeRate, setThemePref } from '../utils/settings'
import { DashboardPage } from './Dashboard/DashboardPage'
import { YearlyPage } from './YearlyReport/YearlyPage'
import { TransactionsPage } from './Transactions/TransactionsPage'
import { TransactionForm } from './Transactions/TransactionForm'
import { Modal } from './Common/Modal'

type Tab = 'dashboard' | 'yearly' | 'transactions'

const TABS: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '庫存總覽', icon: LayoutDashboard },
  { id: 'yearly', label: '年度收益', icon: CalendarRange },
  { id: 'transactions', label: '交易紀錄', icon: NotebookPen },
]

const THEME_ORDER: ThemePref[] = ['system', 'dark', 'light']
const THEME_LABEL: Record<ThemePref, string> = {
  system: '跟隨系統',
  dark: '深色',
  light: '淺色',
}

function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>(getThemePref)

  useEffect(() => {
    applyTheme(pref)
    // 跟隨系統時，作業系統切換深/淺色要即時反映
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycle = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length]
    setPref(next)
    setThemePref(next)
  }

  const Icon = pref === 'system' ? Monitor : pref === 'dark' ? Moon : Sun
  return (
    <button
      className="btn btn-sm btn-icon"
      title={`外觀：${THEME_LABEL[pref]}（點擊切換）`}
      aria-label={`外觀：${THEME_LABEL[pref]}，點擊切換`}
      onClick={cycle}
    >
      <Icon size={14} />
    </button>
  )
}

function WorkspaceControls() {
  const {
    workspaces,
    current,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useWorkspace()
  const [modal, setModal] = useState<'create' | 'rename' | 'fee' | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [feeInput, setFeeInput] = useState('')

  const openCreate = () => {
    setNameInput('')
    setModal('create')
  }
  const openRename = () => {
    if (!current) return
    setNameInput(current.name)
    setModal('rename')
  }
  const openFee = () => {
    if (!current) return
    setFeeInput(String(getFeeRate(current.id)))
    setModal('fee')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (modal === 'fee') {
      const rate = parseFloat(feeInput)
      if (!Number.isFinite(rate) || rate < 0 || rate >= 1) return
      if (current) setFeeRate(rate, current.id)
      setModal(null)
      return
    }
    const name = nameInput.trim()
    if (!name) return
    if (modal === 'create') await createWorkspace(name)
    else if (modal === 'rename' && current) await renameWorkspace(current.id, name)
    setModal(null)
  }

  const handleDelete = async () => {
    if (!current) return
    if (workspaces.length <= 1) {
      window.alert('至少需保留一個工作區。')
      return
    }
    const ok = window.confirm(
      `確定刪除工作區「${current.name}」嗎？\n\n其中所有交易紀錄將一併刪除，此動作無法復原。`,
    )
    if (ok) await deleteWorkspace(current.id)
  }

  return (
    <div className="ws-select">
      <select
        value={current?.id ?? ''}
        onChange={(e) => selectWorkspace(e.target.value)}
        aria-label="切換工作區"
      >
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <button className="btn btn-sm btn-icon" title="新增工作區" aria-label="新增工作區" onClick={openCreate}>
        <Plus size={14} />
      </button>
      <button className="btn btn-sm btn-icon" title="重新命名工作區" aria-label="重新命名工作區" onClick={openRename}>
        <Pencil size={14} />
      </button>
      <button
        className="btn btn-sm btn-icon"
        title="設定此工作區的預設手續費率"
        aria-label="設定此工作區的預設手續費率"
        onClick={openFee}
      >
        <Percent size={14} />
      </button>
      <button
        className="btn btn-sm btn-icon btn-danger"
        title="刪除工作區"
        aria-label="刪除工作區"
        onClick={() => void handleDelete()}
      >
        <Trash2 size={14} />
      </button>

      {modal && (
        <Modal
          title={
            modal === 'create'
              ? '新增工作區'
              : modal === 'rename'
                ? '重新命名工作區'
                : `工作區設定 — ${current?.name ?? ''}`
          }
          onClose={() => setModal(null)}
        >
          <form onSubmit={(e) => void submit(e)}>
            {modal === 'fee' ? (
              <div className="field">
                <label htmlFor="ws-fee-rate">預設手續費率</label>
                <input
                  id="ws-fee-rate"
                  type="number"
                  step="any"
                  min="0"
                  max="0.99"
                  value={feeInput}
                  autoFocus
                  placeholder="例如 0.001425"
                  onChange={(e) => setFeeInput(e.target.value)}
                />
                <div className="field-hint">
                  台股法定標準 0.001425；券商有折扣可直接填折扣後費率（如 0.0004275）。
                  此費率只套用在「{current?.name ?? '目前'}」工作區，新增交易時會自動帶入。
                </div>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="ws-name">工作區名稱</label>
                <input
                  id="ws-name"
                  value={nameInput}
                  autoFocus
                  placeholder="例如：長期投資、退休帳戶"
                  onChange={(e) => setNameInput(e.target.value)}
                />
              </div>
            )}
            <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
              {modal === 'create' ? '建立' : '儲存'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}

export function AppShell() {
  const { mode, user, signOut } = useAuth()
  const { loading, error, addTransactions } = useWorkspace()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [showAddTx, setShowAddTx] = useState(false)

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="brand-mark">
              <TrendingUp size={17} />
            </span>
            股票小幫手
          </div>

          <nav className="tabs" aria-label="主要頁面">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={tab === id ? 'tab active' : 'tab'}
                onClick={() => setTab(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </nav>

          <div className="header-spacer" />

          <WorkspaceControls />

          <div className="header-meta">
            <ThemeToggle />
            {mode === 'local' ? (
              <span className="badge" title="未設定 Supabase，資料儲存於此瀏覽器的 localStorage">
                <HardDrive size={12} />
                本機模式
              </span>
            ) : (
              <>
                <span className="user-email" title={user?.email}>{user?.email}</span>
                <button
                  className="btn btn-sm btn-icon"
                  title={`登出（${user?.email ?? ''}）`}
                  aria-label="登出"
                  onClick={() => void signOut()}
                >
                  <LogOut size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="container">
        {error && (
          <div className="notice notice-error section" role="alert">
            {error}
          </div>
        )}
        {loading ? (
          <div className="glass empty-state section">載入中…</div>
        ) : (
          <>
            {tab === 'dashboard' && <DashboardPage />}
            {tab === 'yearly' && <YearlyPage />}
            {tab === 'transactions' && <TransactionsPage />}
          </>
        )}
      </main>

      <footer className="app-footer">
        提供的報價並非來自所有市場的即時報價 (最長可能延遲 20 分鐘)。所提供資訊均以現狀提供，僅供參考，不宜做為買賣依據或諮詢之用
      </footer>

      {/* 全域新增交易：任何分頁皆可使用；Modal 掛在外殼層，內容區重載也不會消失 */}
      {!loading && (
        <button className="btn btn-primary fab" onClick={() => setShowAddTx(true)}>
          <ListPlus size={17} />
          新增交易
        </button>
      )}
      {showAddTx && (
        <Modal title="新增交易紀錄" onClose={() => setShowAddTx(false)}>
          <TransactionForm onSubmit={(tx) => addTransactions([tx])} />
        </Modal>
      )}
    </>
  )
}
