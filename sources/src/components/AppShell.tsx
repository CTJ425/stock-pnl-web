/**
 * 應用外殼：頁首（品牌、工作區選單、使用者選單）、分頁導覽、全域新增交易與內容區。
 *
 * 頁首右側在 0.6.5-dev.3 由 8 個控制項收斂成 2 個選單，理由見 docs/agent/PLAN.md §R。
 */
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRightLeft,
  CalendarRange,
  Check,
  ChevronDown,
  Code2,
  ExternalLink,
  Globe,
  HardDrive,
  Layers,
  LayoutDashboard,
  LineChart,
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
import { RecalcFeesModal } from './Transactions/RecalcFeesModal'
import { Modal } from './Common/Modal'
import { HeaderMenu } from './Common/HeaderMenu'
import { AnalysisPage } from './StockDetail/AnalysisPage'
import { MacroPage } from './Macro/MacroPage'
import { FxPage } from './Fx/FxPage'
import { isReportConfigured } from '../services/reportProxy'

type Tab = 'dashboard' | 'analysis' | 'macro' | 'fx' | 'yearly' | 'transactions'

/**
 * `short` 供手機底部導覽列使用：底部列每格是直式（圖示在上、標籤在下），
 * 375px 螢幕上五格每格約 73px，兩字（26px）綽綽有餘，四字則會折行。
 * 新增分頁時 `short` 一律給兩個字。
 *
 * 0.6.7 加到六格：375px 每格約 60px、320px 約 51px，兩字在 11px 字級是 22px，
 * 仍然寬鬆 —— 底部列改成直式之後，橫式時代那套「圖示＋標籤擠在一行」的
 * 寬度算式已經不適用了（0.6.6 之前的註解算的是那個）。實測見 PROGRESS。
 */
const ALL_TABS: Array<{ id: Tab; label: string; short: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: '庫存總覽', short: '總覽', icon: LayoutDashboard },
  { id: 'analysis', label: '個股分析', short: '分析', icon: LineChart },
  { id: 'macro', label: '總體經濟', short: '總經', icon: Globe },
  { id: 'fx', label: '外幣匯率', short: '匯率', icon: ArrowRightLeft },
  { id: 'yearly', label: '年度收益', short: '年度', icon: CalendarRange },
  { id: 'transactions', label: '交易紀錄', short: '紀錄', icon: NotebookPen },
]

/**
 * 個股分析與總體經濟的資料都來自 Supabase Storage / Edge Function，
 * 本機模式沒有來源可讀，故未設定 Supabase 時整個分頁隱藏
 * （與盤後報告一路以來的入口規則一致）。
 *
 * 總經與匯率**必須**跟著隱藏：`fetchMacro()` / `fetchFx()` 在本機模式永遠回 null，
 * 而空狀態寫的是「每日排程完成後會自動補上」—— 在本機模式那是假的，
 * 永遠不會補上，留著只會讓使用者一直等一個不會來的東西。
 */
const SUPABASE_ONLY_TABS: Tab[] = ['analysis', 'macro', 'fx']
const TABS = isReportConfigured
  ? ALL_TABS
  : ALL_TABS.filter((t) => !SUPABASE_ONLY_TABS.includes(t.id))

const GITHUB_URL = 'https://github.com/CTJ425/stock-pnl-web'

/** 需與 index.css 的 `@media (max-width: 720px)` 一致 */
const NARROW_QUERY = '(max-width: 720px)'

/**
 * 手機（≤720px）把主導覽從頁首搬到固定底部列，桌機維持頁首橫列。
 *
 * **為什麼要用 JS 判斷、不能純靠 CSS：**`.app-header` 有 `backdrop-filter`，
 * 它會成為所有 fixed 子孫的 containing block —— 頁首裡的 `<nav>` 即使設
 * `position: fixed; bottom: 0` 也只會貼在頁首那一塊的底部，不是視窗底部。
 * 底部列因此必須是頁首以外的節點，而「同一份導覽渲染在哪」只能由 JS 決定
 * （渲染兩份會有兩組同名按鈕，對輔助技術與測試都是雜訊）。
 */
function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(
    // matchMedia 的存在檢查不可省：jsdom 沒有實作它（與 UserMenu 同一個理由），
    // 測試環境一律走桌機版
    () => typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW_QUERY)
    const onChange = () => setNarrow(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return narrow
}

/**
 * 主導覽。同一份分頁定義渲染成兩種型態：
 * - `header`：桌機頁首的藥丸橫列（≤1020px 只剩圖示，名稱在 title / aria-label）
 * - `bottom`：手機固定底部列，直式圖示＋兩字短標籤
 */
function TabNav({
  variant,
  current,
  onSelect,
}: {
  variant: 'header' | 'bottom'
  current: Tab
  onSelect: (tab: Tab) => void
}) {
  const isBottom = variant === 'bottom'
  return (
    <nav className={isBottom ? 'bottom-nav' : 'tabs'} aria-label="主要頁面">
      {TABS.map(({ id, label, short, icon: Icon }) => (
        <button
          key={id}
          type="button"
          className={current === id ? 'tab active' : 'tab'}
          onClick={() => onSelect(id)}
          /* 頁首在窄視窗只剩圖示，名稱改由 title / aria-label 呈現 */
          title={label}
          aria-label={label}
          aria-current={current === id ? 'page' : undefined}
        >
          <Icon size={isBottom ? 18 : 15} />
          <span className="tab-label">{isBottom ? short : label}</span>
        </button>
      ))}
    </nav>
  )
}

const THEME_ORDER: ThemePref[] = ['system', 'dark', 'light']
const THEME_LABEL: Record<ThemePref, string> = {
  system: '跟隨系統',
  dark: '深色',
  light: '淺色',
}

/** 使用者點擊「重設密碼」信件連結進站後，提示設定新密碼 */
function RecoveryPasswordModal() {
  const { updatePassword, dismissRecovery } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (password.length < 6) {
      setError('新密碼至少需要 6 個字元')
      return
    }
    if (password !== confirm) {
      setError('兩次輸入的密碼不一致')
      return
    }
    setBusy(true)
    try {
      const err = await updatePassword(password)
      if (err) setError(`設定失敗：${err}`)
      // 成功時 updatePassword 會自動關閉此視窗（recovery = false）
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="設定新密碼" onClose={dismissRecovery}>
      <div className="notice notice-warn">
        你剛透過「重設密碼」信件連結登入，請立即設定新密碼。
        （關閉此視窗則維持原密碼不變）
      </div>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="notice notice-error">{error}</div>}
        <div className="field">
          <label htmlFor="new-password">新密碼</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            placeholder="至少 6 個字元"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">確認新密碼</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            placeholder="再輸入一次新密碼"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? '儲存中…' : '儲存新密碼'}
        </button>
      </form>
    </Modal>
  )
}


/**
 * 使用者選單：外觀切換、身分、登出。
 *
 * 本機模式**刻意保留「本機模式」徽章當作觸發鈕**，而不是換成頭像 ——
 * 「資料只存在這個瀏覽器」是使用者需要隨時看得到的事實，藏進選單等於把它降級。
 */
function UserMenu() {
  const { mode, user, signOut } = useAuth()
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())

  useEffect(() => {
    applyTheme(pref)
  }, [pref])

  useEffect(() => {
    // matchMedia 的存在檢查不可省：jsdom 沒有實作它，少了這道測試會整批炸掉
    if (pref !== 'system' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [pref])

  const cycleTheme = () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(pref) + 1) % THEME_ORDER.length]
    setPref(next)
    setThemePref(next)
  }

  const ThemeIcon = pref === 'system' ? Monitor : pref === 'dark' ? Moon : Sun
  const email = user?.email ?? ''
  const initials = email.slice(0, 2).toUpperCase() || 'ME'
  const isLocal = mode === 'local'

  return (
    <HeaderMenu
      triggerLabel={isLocal ? '本機模式選單' : `帳號選單（${email}）`}
      triggerClass={isLocal ? 'badge hmenu-badge' : 'hmenu-avatar'}
      triggerContent={
        isLocal ? (
          <>
            <HardDrive size={12} />
            本機模式
          </>
        ) : (
          initials
        )
      }
      menuLabel="帳號與外觀"
    >
      {(close) => (
        <>
          <div className="hmenu-head">
            {isLocal ? '資料儲存於此瀏覽器，未連線 Supabase' : email}
          </div>
          <div className="hmenu-sep" />
          <button type="button" role="menuitem" className="hmenu-item" onClick={cycleTheme}>
            <ThemeIcon size={14} />
            <span>外觀：{THEME_LABEL[pref]}</span>
          </button>
          {!isLocal && (
            <>
              <div className="hmenu-sep" />
              <button
                type="button"
                role="menuitem"
                className="hmenu-item"
                onClick={() => {
                  close()
                  void signOut()
                }}
              >
                <LogOut size={14} />
                <span>登出</span>
              </button>
            </>
          )}
        </>
      )}
    </HeaderMenu>
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
  // 費率異動後開啟批次重算預覽，讓歷史紀錄可跟著新費率調整
  const [showRecalc, setShowRecalc] = useState(false)

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
      if (current) {
        const changed = rate !== getFeeRate(current.id)
        setFeeRate(rate, current.id)
        // 費率有變動時帶出批次重算，供歷史紀錄同步調整（可勾選、可取消）
        if (changed) setShowRecalc(true)
      }
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
      {/*
        切換與管理放在同一個選單裡：管理動作本來就只作用在「目前這個工作區」，
        把它們跟工作區清單擺在一起，作用對象不必用猜的。
        刪除隔一條分隔線並用紅色 —— 它原本與「重新命名」並排，都是 14px 無標籤圖示。
      */}
      <HeaderMenu
        triggerLabel={`工作區：${current?.name ?? '未選擇'}`}
        triggerClass="hmenu-ws"
        triggerContent={
          <>
            <Layers size={14} />
            <span className="hmenu-ws-name">{current?.name ?? '未選擇'}</span>
            <ChevronDown size={12} className="hmenu-caret" />
          </>
        }
        menuLabel="工作區選單"
      >
        {(close) => (
          <>
            {workspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                role="menuitemradio"
                aria-checked={w.id === current?.id}
                className={w.id === current?.id ? 'hmenu-item is-current' : 'hmenu-item'}
                onClick={() => {
                  selectWorkspace(w.id)
                  close()
                }}
              >
                <Check size={14} className="hmenu-check" aria-hidden="true" />
                <span>{w.name}</span>
              </button>
            ))}
            <div className="hmenu-sep" />
            <button
              type="button"
              role="menuitem"
              className="hmenu-item"
              onClick={() => {
                close()
                openCreate()
              }}
            >
              <Plus size={14} />
              <span>新增工作區</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="hmenu-item"
              onClick={() => {
                close()
                openRename()
              }}
            >
              <Pencil size={14} />
              <span>重新命名</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="hmenu-item"
              onClick={() => {
                close()
                openFee()
              }}
            >
              <Percent size={14} />
              <span>預設手續費率</span>
            </button>
            <div className="hmenu-sep" />
            <button
              type="button"
              role="menuitem"
              className="hmenu-item is-danger"
              onClick={() => {
                close()
                void handleDelete()
              }}
            >
              <Trash2 size={14} />
              <span>刪除工作區</span>
            </button>
          </>
        )}
      </HeaderMenu>

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
                  台股標準是 0.001425。券商有折扣就填折扣後的數字（例如 0.0004275）。
                  只套用在「{current?.name ?? '目前'}」工作區，新增交易時會自動帶入；
                  改了費率會問你要不要把舊紀錄一起重算。
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

      {showRecalc && <RecalcFeesModal onClose={() => setShowRecalc(false)} />}
    </div>
  )
}

export function AppShell() {
  const { recovery } = useAuth()
  const { loading, error, addTransactions } = useWorkspace()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [showAddTx, setShowAddTx] = useState(false)
  const narrow = useNarrowScreen()

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <span className="brand-mark">
              <TrendingUp size={17} />
            </span>
            <span className="brand-text">股票小幫手</span>
          </div>

          {!narrow && <TabNav variant="header" current={tab} onSelect={setTab} />}

          <div className="header-spacer" />

          <WorkspaceControls />

          <div className="header-meta">
            <UserMenu />
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
            {tab === 'analysis' && <AnalysisPage />}
            {tab === 'macro' && <MacroPage />}
            {tab === 'fx' && <FxPage />}
            {tab === 'yearly' && <YearlyPage />}
            {tab === 'transactions' && <TransactionsPage />}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          提供的報價並非來自所有市場的即時報價 (最長可能延遲 20 分鐘)。所提供資訊均以現狀提供，僅供參考，不宜做為買賣依據或諮詢之用
        </p>
        <a className="footer-link" href={GITHUB_URL} target="_blank" rel="noreferrer">
          <Code2 size={13} />
          GitHub Repository
          <ExternalLink size={11} />
        </a>
      </footer>

      {/* 手機底部導覽：必須掛在 .app-header 之外，理由見 useNarrowScreen 的註解 */}
      {narrow && <TabNav variant="bottom" current={tab} onSelect={setTab} />}

      {/* 全域新增交易：任何分頁皆可使用；Modal 掛在外殼層，內容區重載也不會消失 */}
      {!loading && (
        <button className="btn btn-primary fab" onClick={() => setShowAddTx(true)}>
          <ListPlus size={17} />
          新增交易
        </button>
      )}
      {showAddTx && (
        <Modal title="新增交易紀錄" onClose={() => setShowAddTx(false)} disableBackdropClose>
          <TransactionForm onSubmit={(tx) => addTransactions([tx])} />
        </Modal>
      )}

      {recovery && <RecoveryPasswordModal />}
    </>
  )
}
