/** 應用外殼：頁首（品牌、工作區切換、登出）、分頁導覽與內容區 */
import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  CalendarRange,
  HardDrive,
  LayoutDashboard,
  LogOut,
  NotebookPen,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { DashboardPage } from './Dashboard/DashboardPage'
import { YearlyPage } from './YearlyReport/YearlyPage'
import { TransactionsPage } from './Transactions/TransactionsPage'
import { Modal } from './Common/Modal'

type Tab = 'dashboard' | 'yearly' | 'transactions'

const TABS: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '庫存總覽', icon: LayoutDashboard },
  { id: 'yearly', label: '年度收益', icon: CalendarRange },
  { id: 'transactions', label: '交易紀錄', icon: NotebookPen },
]

function WorkspaceControls() {
  const {
    workspaces,
    current,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
  } = useWorkspace()
  const [modal, setModal] = useState<'create' | 'rename' | null>(null)
  const [nameInput, setNameInput] = useState('')

  const openCreate = () => {
    setNameInput('')
    setModal('create')
  }
  const openRename = () => {
    if (!current) return
    setNameInput(current.name)
    setModal('rename')
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
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
        className="btn btn-sm btn-icon btn-danger"
        title="刪除工作區"
        aria-label="刪除工作區"
        onClick={() => void handleDelete()}
      >
        <Trash2 size={14} />
      </button>

      {modal && (
        <Modal
          title={modal === 'create' ? '新增工作區' : '重新命名工作區'}
          onClose={() => setModal(null)}
        >
          <form onSubmit={(e) => void submit(e)}>
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
  const { loading, error } = useWorkspace()
  const [tab, setTab] = useState<Tab>('dashboard')

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
            {mode === 'local' ? (
              <span className="badge" title="未設定 Supabase，資料儲存於此瀏覽器的 localStorage">
                <HardDrive size={12} />
                本機模式
              </span>
            ) : (
              <>
                <span title={user?.email}>{user?.email}</span>
                <button className="btn btn-sm btn-icon" title="登出" aria-label="登出" onClick={() => void signOut()}>
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
    </>
  )
}
