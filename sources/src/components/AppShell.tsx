/**
 * Application shell: Home page (brand, workspace menu, user menu), paginated navigation, global new transactions and content area.
 *
 * The right side of the top page is reduced from 8 control items to 2 menus in 0.6.5-dev.3. For the reason, see docs/agent/PLAN.md §R.
 */
import { Fragment, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRightLeft,
  CalendarRange,
  Check,
  ChevronDown,
  ExternalLink,
  Globe,
  HardDrive,
  KeyRound,
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
  ShieldCheck,
  Sun,
  Trash2,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import type { ThemePref } from '../utils/settings'
import { applyTheme, getFeeRate, getThemePref, setThemePref } from '../utils/settings'
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
import { AdminConsolePage } from './Admin/AdminConsolePage'
import { isReportConfigured } from '../services/reportProxy'
import { isAdmin } from '../services/adminStatus'
import { BrandMark } from './BrandMark'

type Tab = 'dashboard' | 'analysis' | 'macro' | 'fx' | 'yearly' | 'transactions'

/** Pages other than pagination. The management background is not on the paging bar and is entered through the user menu (see `UserMenu`)*/
type View = Tab | 'admin'

/**
 * Paginated functional grouping. The order is the order of the pictures, and a dividing line is drawn when changing groups.
 *
 * - `holding`: my positions - stocks, stocks, years, records
 * - `market`: market environment - general economics, exchange rate
 *
 * 0.6.19 Rearrange according to this division. Grouping is only separated by 1px and does not add a group title:
 * The horizontal space at the top of the page is the scarcest resource, and group titles will make the entire navigation taller.
 */
type TabGroup = 'holding' | 'market'

/**
 * `short` is used for the bottom navigation bar of mobile phones: each cell in the bottom column is vertical (icons at the top, labels at the bottom),
 * Each of the five boxes on the 375px screen is about 73px. Two characters (26px) are more than enough, and four characters will break.
 * When adding pagination, always give two words for `short`.
 *
 * 0.6.7 Add to six cells: 375px is about 60px per cell, 320px is about 51px, two words at 11px font level is 22px,
 * Still loose - after the bottom column was changed to vertical format, the set of "icons + labels squeezed into one line" in the horizontal format era
 * The width calculation is no longer applicable (the comment before 0.6.6 calculated that). See PROGRESS for actual measurement.
 */
const ALL_TABS: Array<{
  id: Tab
  label: string
  short: string
  group: TabGroup
  icon: typeof LayoutDashboard
}> = [
  { id: 'dashboard', label: '庫存總覽', short: '總覽', group: 'holding', icon: LayoutDashboard },
  { id: 'analysis', label: '個股分析', short: '分析', group: 'holding', icon: LineChart },
  { id: 'yearly', label: '年度收益', short: '年度', group: 'holding', icon: CalendarRange },
  { id: 'transactions', label: '交易紀錄', short: '紀錄', group: 'holding', icon: NotebookPen },
  { id: 'macro', label: '總體經濟', short: '總經', group: 'market', icon: Globe },
  { id: 'fx', label: '外幣匯率', short: '匯率', group: 'market', icon: ArrowRightLeft },
]

/**
 * Data on individual stock analysis and the overall economy come from Supabase Storage/Edge Function.
 * There is no source to read in native mode, so the entire page is hidden when Supabase is not configured.
 * (Similar to the entry rules for after-hours reports).
 *
 * General economics and exchange rates **must** be followed by hiding: `fetchMacro()` / `fetchFx()` always returns null in native mode,
 * The empty state says "It will be automatically added after the daily schedule is completed" - that is false in local mode.
 * It will never be replenished, and keeping it will only keep the user waiting for something that will never come.
 */
const SUPABASE_ONLY_TABS: Tab[] = ['analysis', 'macro', 'fx']

const TABS = isReportConfigured
  ? ALL_TABS
  : ALL_TABS.filter((t) => !SUPABASE_ONLY_TABS.includes(t.id))

const GITHUB_URL = 'https://github.com/CTJ425/stock-pnl-web'

/** Need to be consistent with `@media (max-width: 720px)` in index.css*/
const NARROW_QUERY = '(max-width: 720px)'

/**
 * Mobile phones (≤720px) move the main navigation from the top of the page to the fixed bottom row, while desktop computers maintain the top row.
 *
 * **Why should we use JS to judge and not rely solely on CSS: **`.app-header` has `backdrop-filter`,
 * It will become the containing block for all fixed descendants - `<nav>` in the header even if
 * `position: fixed; bottom: 0` will only be attached to the bottom of the page header, not the bottom of the window.
 * The bottom column must therefore be a node other than the top of the page, and "where the same navigation is rendered" can only be determined by JS
 * (Rendering two copies will have two sets of buttons with the same name, which is noisy to assistive technologies and testing).
 */
function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(
    // The existence check of matchMedia is not optional: jsdom does not implement it (same reason as UserMenu),
    // The test environment must be the desktop version.
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
 * Main navigation. The same paging definition is rendered into two types:
 * - `header`: the pill row at the top of the desktop page (≤1020px, only the icon is left, the name is in title / aria-label)
 * - `bottom`: Fixed bottom column for mobile phones, straight icon + two-word short label
 */
function TabNav({
  variant,
  current,
  onSelect,
  tabs,
}: {
  variant: 'header' | 'bottom'
  current: View
  onSelect: (tab: Tab) => void
  tabs: typeof ALL_TABS
}) {
  const isBottom = variant === 'bottom'
  return (
    <nav className={isBottom ? 'bottom-nav' : 'tabs'} aria-label="主要頁面">
      {tabs.map(({ id, label, short, group, icon: Icon }, i) => (
        <Fragment key={id}>
          {/* A divider between groups. Purely visual, hidden from assistive technology */}
          {i > 0 && tabs[i - 1].group !== group && <span className="tab-div" aria-hidden="true" />}
          <button
            type="button"
            className={current === id ? 'tab active' : 'tab'}
            onClick={() => onSelect(id)}
            /* Only the icon is left at the top of the page in the narrow window, and the name is changed to title / aria-label.*/
            title={label}
            aria-label={label}
            aria-current={current === id ? 'page' : undefined}
          >
            <Icon size={isBottom ? 18 : 15} />
            <span className="tab-label">{isBottom ? short : label}</span>
          </button>
        </Fragment>
      ))}
    </nav>
  )
}

/**
 * GitHub official mark.
 *
 * Embed a path yourself instead of using an icon library: **lucide 1.x has removed all brand icons**
 * (`lucide-react@1.24.0` does not have `Github`), it is not cost-effective to install one more package for one icon.
 * Size and stroke alignment lucide: 24×24 viewBox, `currentColor` coloring (this is solid not line art).
 */
function GithubMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
}

const THEME_ORDER: ThemePref[] = ['system', 'dark', 'light']
const THEME_LABEL: Record<ThemePref, string> = {
  system: '跟隨系統',
  dark: '深色',
  light: '淺色',
}

/** After the user clicks the "Reset Password" email link to enter the site, he or she is prompted to set a new password.*/
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
      // updatePassword will automatically close this window when successful (recovery = false)
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

/** Change password from inside the account: re-authenticates with the current password first (see AuthContext.changePassword). */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { changePassword } = useAuth()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (!current) {
      setError('請輸入目前密碼')
      return
    }
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
      const err = await changePassword(current, password)
      if (err) setError(err)
      else {
        // Keep the modal open so the confirmation is actually seen; clear the fields and lock
        // the button so a second submit cannot fail against the password that just changed.
        setDone(true)
        setCurrent('')
        setPassword('')
        setConfirm('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="變更密碼" onClose={onClose}>
      <form onSubmit={(e) => void submit(e)}>
        {error && <div className="notice notice-error">{error}</div>}
        {done && <div className="notice notice-ok">密碼已變更</div>}
        <div className="field">
          <label htmlFor="current-password">目前密碼</label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="change-new-password">新密碼</label>
          <input
            id="change-new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            placeholder="至少 6 個字元"
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="change-confirm-password">確認新密碼</label>
          <input
            id="change-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirm}
            placeholder="再輸入一次新密碼"
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>
        <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy || done}>
          {busy ? '儲存中…' : '變更密碼'}
        </button>
      </form>
    </Modal>
  )
}

/**
 * User menu: appearance switching, management background, source code, identity, logout.
 *
 * Local mode** deliberately retains the "local mode" badge as a trigger button** instead of replacing it with an avatar——
 * "Data only exists in this browser" is a fact that users need to see at all times. Hiding it in the menu is equivalent to downgrading it.
 *
 * 0.6.19 Collect two things:
 * - **Admin Backstage** (Administrator only). Originally it was "crawl status" on the paginated column, but the management function is the same as
 *   The paginations for daily viewing are mixed into the same navigation, which means that every user sees a location that they cannot click on.
 * - **Source Code** (for everyone). Originally a line of text link at the end of the page; a disclaimer at the end of the page,
 *   The link is included here, and there is no need to make room for it at the top or bottom of the page.
 */
function UserMenu({ admin, onOpenAdmin }: { admin: boolean; onOpenAdmin: () => void }) {
  const { mode, user, signOut } = useAuth()
  const [pref, setPref] = useState<ThemePref>(() => getThemePref())
  const [showChangePassword, setShowChangePassword] = useState(false)

  useEffect(() => {
    applyTheme(pref)
  }, [pref])

  useEffect(() => {
    // The existence check of matchMedia cannot be omitted: jsdom has not implemented it. Without this test, the whole batch will explode.
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
    <>
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
            <div className="hmenu-sep" />
            {/*
              Hiding the admin console is **housekeeping in the interface, not a security boundary** —— the real
              gate is `assertAdmin` in the Edge Function plus RLS on the tables (anything the frontend hides can
              be summoned by editing one line of JS). Bypassing this check to open the console only earns a 403
              and a page with no data in it.
            */}
            {admin && (
              <button
                type="button"
                role="menuitem"
                className="hmenu-item hmenu-item-admin"
                onClick={() => {
                  close()
                  onOpenAdmin()
                }}
              >
                <ShieldCheck size={14} />
                <span>管理後台</span>
              </button>
            )}
            <a
              role="menuitem"
              className="hmenu-item"
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              onClick={close}
            >
              <GithubMark />
              <span>原始碼</span>
              <ExternalLink size={12} className="hmenu-item-ext" />
            </a>
            {!isLocal && (
              <>
                <div className="hmenu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="hmenu-item"
                  onClick={() => {
                    close()
                    setShowChangePassword(true)
                  }}
                >
                  <KeyRound size={14} />
                  <span>變更密碼</span>
                </button>
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
      {showChangePassword && (
        <ChangePasswordModal onClose={() => setShowChangePassword(false)} />
      )}
    </>
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
    setWorkspaceFeeRate,
  } = useWorkspace()
  const [modal, setModal] = useState<'create' | 'rename' | 'fee' | null>(null)
  const [nameInput, setNameInput] = useState('')
  const [feeInput, setFeeInput] = useState('')
  // After the rate changes, batch recalculation preview is enabled so that historical records can be adjusted according to the new rate.
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
        await setWorkspaceFeeRate(current.id, rate)
        // When the rates change, batch recalculation will be carried out for simultaneous adjustment of historical records (can be checked or cancelled)
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
        Switching and managing share one menu: the management actions only ever act on "the workspace you are
        in", so putting them next to the workspace list means the target never has to be guessed.
        Delete is set off by a divider and coloured red —— it used to sit beside 重新命名, both 14px unlabelled icons.
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
  const [view, setView] = useState<View>('dashboard')
  const [analysisTicker, setAnalysisTicker] = useState<string | undefined>(undefined)
  const [showAddTx, setShowAddTx] = useState(false)
  const [admin, setAdmin] = useState(false)
  const narrow = useNarrowScreen()

  // Administrator entrance: It is determined that auth needs to be made once, so it is added asynchronously. If you make a mistake, there will only be one less menu item.
  // Does not affect any existing functions (the real control is on the Edge Function side)
  useEffect(() => {
    let alive = true
    void isAdmin().then((ok) => {
      if (alive) setAdmin(ok)
    })
    return () => {
      alive = false
    }
  }, [])

  // When permissions are revoked (such as logging out to change accounts), do not leave the user in the background
  useEffect(() => {
    if (view === 'admin' && !admin) setView('dashboard')
  }, [admin, view])

  return (
    <>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand">
            <BrandMark />
            <span className="brand-text">股票小幫手</span>
          </div>

          {!narrow && <TabNav variant="header" current={view} onSelect={setView} tabs={TABS} />}

          <div className="header-spacer" />

          <WorkspaceControls />

          <div className="header-meta">
            <UserMenu admin={admin} onOpenAdmin={() => setView('admin')} />
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
            {view === 'dashboard' && (
              <DashboardPage
                onSelectTicker={
                  isReportConfigured
                    ? (ticker) => {
                        setAnalysisTicker(ticker)
                        setView('analysis')
                      }
                    : undefined
                }
              />
            )}
            {view === 'analysis' && <AnalysisPage initialTicker={analysisTicker} />}
            {view === 'macro' && <MacroPage />}
            {view === 'fx' && <FxPage />}
            {view === 'yearly' && <YearlyPage />}
            {view === 'transactions' && <TransactionsPage />}
            {view === 'admin' && <AdminConsolePage onExit={() => setView('dashboard')} />}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>
          提供的報價並非來自所有市場的即時報價 (最長可能延遲 20 分鐘)。所提供資訊均以現狀提供，僅供參考，不宜做為買賣依據或諮詢之用
        </p>
        {/* The GitHub link moved into the user menu (0.6.19): the footer is left to the disclaimer */}
      </footer>

      {/* Mobile bottom navigation: must live outside .app-header —— see the comment on useNarrowScreen */}
      {narrow && <TabNav variant="bottom" current={view} onSelect={setView} tabs={TABS} />}

      {/* Global "add transaction": available from any tab; the modal is mounted at the shell level so a content reload cannot drop it */}
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
