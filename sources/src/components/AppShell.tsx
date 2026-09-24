/**
 * Application shell: Home page (brand, workspace menu, user menu), paginated navigation, global new transactions and content area.
 *
 * The right side of the top page is reduced from 8 control items to 2 menus in 0.6.5-dev.3. For the reason, see docs/agent/PLAN.md §R.
 */
import { Fragment, Suspense, lazy, useCallback, useEffect, useState } from 'react'
import {
  ArrowRightLeft,
  CalendarRange,
  Globe,
  LayoutDashboard,
  LineChart,
  ListPlus,
  NotebookPen,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useWorkspace } from '../context/WorkspaceContext'
import { isReportConfigured } from '../services/reportProxy'
import { isAdmin } from '../services/adminStatus'
import { APP_VERSION } from '../version'
import { RecoveryPasswordModal } from './Auth/PasswordModals'
import { BrandMark } from './BrandMark'
import { Modal } from './Common/Modal'
import { ToastProvider } from './Common/Toast'
import { ConfirmProvider } from './Common/useConfirm'
import { DashboardPage } from './Dashboard/DashboardPage'
import { TransactionForm } from './Transactions/TransactionForm'
import { UserMenu } from './UserMenu'
import { formatViewHash, parseViewHash, type ViewRoute } from './viewRoute'
import { WorkspaceControls } from './WorkspaceControls'

/**
 * Route-level split points. Only the dashboard (the first paint) and the shell ship in the entry
 * chunk; every other page is reached by a tab or menu click (OPT-1, Task 145; the rest 2026-09-24).
 * TransactionForm stays eager: 新增交易 is on every page and a first click should open the form,
 * not a loading placeholder (~6 KB gzip).
 * `.then` maps the named export onto `default`, which is what `lazy` expects.
 */
const AnalysisPage = lazy(() => import('./StockDetail/AnalysisPage').then((m) => ({ default: m.AnalysisPage })))
const YearlyPage = lazy(() => import('./YearlyReport/YearlyPage').then((m) => ({ default: m.YearlyPage })))
const TransactionsPage = lazy(() =>
  import('./Transactions/TransactionsPage').then((m) => ({ default: m.TransactionsPage })),
)
const MacroPage = lazy(() => import('./Macro/MacroPage').then((m) => ({ default: m.MacroPage })))
const FxPage = lazy(() => import('./Fx/FxPage').then((m) => ({ default: m.FxPage })))
const AdminConsolePage = lazy(() =>
  import('./Admin/AdminConsolePage').then((m) => ({ default: m.AdminConsolePage })),
)
const DiscordMySettings = lazy(() =>
  import('./Settings/DiscordMySettings').then((m) => ({ default: m.DiscordMySettings })),
)

/** Same markup as the workspace-loading placeholder, so a split page does not flash a different shape. */
const PAGE_FALLBACK = <div className="glass empty-state section">載入中…</div>

type Tab = 'dashboard' | 'analysis' | 'macro' | 'fx' | 'yearly' | 'transactions'

/** Pages other than pagination. The management background is not on the paging bar and is entered through the user menu (see `UserMenu`)*/
type View = Tab | 'admin' | 'discord'

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

/** Pages a URL may open directly. Hidden tabs are left out, so a local-mode `#/macro` lands on the dashboard. */
const ROUTABLE_VIEWS: View[] = [...TABS.map((t) => t.id), 'admin', ...(isReportConfigured ? (['discord'] as const) : [])]

function readRoute(): ViewRoute<View> {
  return parseViewHash(window.location.hash, ROUTABLE_VIEWS) ?? { view: 'dashboard' }
}

/** Label for the page identity heading (h1) and the browser tab title. `admin` is not on any tab, so it needs its own entry. */
const ALL_TAB_LABELS: Record<Tab, string> = Object.fromEntries(
  ALL_TABS.map((t) => [t.id, t.label]),
) as Record<Tab, string>

function viewLabel(view: View): string {
  if (view === 'admin') return '管理後台'
  if (view === 'discord') return 'Discord 通知設定'
  return ALL_TAB_LABELS[view]
}

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

export function AppShell() {
  const { recovery, user, authVersion } = useAuth()
  const { loading, error, addTransactions } = useWorkspace()
  // The page lives in the URL hash, so a reload, the back button and a shared link all keep it.
  const [route, setRoute] = useState<ViewRoute<View>>(readRoute)
  const view = route.view
  const analysisTicker = view === 'analysis' ? route.ticker : undefined
  const [showAddTx, setShowAddTx] = useState(false)
  // null until the first check answers: a reload on #/admin must wait for it, not bounce.
  const [admin, setAdmin] = useState<boolean | null>(null)

  const navigate = useCallback((next: View, ticker?: string) => {
    const nextRoute: ViewRoute<View> = ticker ? { view: next, ticker } : { view: next }
    const hash = formatViewHash(nextRoute)
    // Assigning the hash pushes a history entry, which is what makes the back button work.
    if (window.location.hash !== hash) window.location.hash = hash
    setRoute(nextRoute)
  }, [])

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  const narrow = useNarrowScreen()

  // Administrator entrance: It is determined that auth needs to be made once, so it is added asynchronously. If you make a mistake, there will only be one less menu item.
  // Does not affect any existing functions (the real control is on the Edge Function side)
  // Re-runs on a user change or a token refresh/profile update (authVersion, from AuthContext's
  // own onAuthStateChange subscription) — no second subscription is opened here.
  useEffect(() => {
    let alive = true
    void isAdmin().then((ok) => {
      if (alive) setAdmin(ok)
    })
    return () => {
      alive = false
    }
  }, [user?.id, authVersion])

  // When permissions are revoked (such as logging out to change accounts), do not leave the user in the background
  useEffect(() => {
    if (view !== 'admin' || admin !== false) return
    // Replace, not push: the back button should not return to a page this user cannot open.
    window.history.replaceState(null, '', formatViewHash({ view: 'dashboard' }))
    setRoute({ view: 'dashboard' })
  }, [admin, view])

  // Each page names itself in the browser tab, matching the single h1 rendered in <main>.
  useEffect(() => {
    document.title = `${viewLabel(view)} · 股票小幫手`
  }, [view])

  return (
    <>
      <ToastProvider>
        <ConfirmProvider>
          <header className="app-header">
            <div className="app-header-inner">
              <div className="brand">
                <BrandMark />
                <span className="brand-text">股票小幫手</span>
              </div>

              {!narrow && <TabNav variant="header" current={view} onSelect={navigate} tabs={TABS} />}

              <div className="header-spacer" />

              {/* Global "add transaction", in the header on every width (0.9.68: the floating button
                  covered the bottom-right corner). Hidden on admin, where it has no use. */}
              {!loading && view !== 'admin' && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm header-add"
                  aria-label="新增交易"
                  onClick={() => setShowAddTx(true)}
                >
                  <ListPlus size={17} />
                  <span className="header-add-label">新增交易</span>
                </button>
              )}

              <WorkspaceControls />

              <div className="header-meta">
                <UserMenu
                  admin={admin === true}
                  onOpenAdmin={() => navigate('admin')}
                  onOpenDiscord={() => navigate('discord')}
                />
              </div>
            </div>
          </header>

          <main className="container">
            <h1 className="sr-only">{viewLabel(view)}</h1>
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
                        ? (ticker) => navigate('analysis', ticker)
                        : undefined
                    }
                    onAddTransaction={() => setShowAddTx(true)}
                    onGoToTransactions={() => navigate('transactions')}
                  />
                )}
                <Suspense fallback={PAGE_FALLBACK}>
                  {view === 'analysis' && <AnalysisPage initialTicker={analysisTicker} />}
                  {view === 'macro' && <MacroPage />}
                  {view === 'fx' && <FxPage />}
                  {view === 'yearly' && <YearlyPage />}
                  {view === 'transactions' && <TransactionsPage />}
                  {view === 'admin' && admin === true && <AdminConsolePage onExit={() => navigate('dashboard')} />}
                  {view === 'admin' && admin === null && PAGE_FALLBACK}
                  {view === 'discord' && <DiscordMySettings />}
                </Suspense>
              </>
            )}
          </main>

          <footer className="app-footer">
            <p>
              提供的報價並非來自所有市場的即時報價 (最長可能延遲 20 分鐘)。所提供資訊均以現狀提供，僅供參考，不宜做為買賣依據或諮詢之用
              {/* 0.9.68: the version sits at the end of the disclaimer instead of a fixed bottom-left badge,
                  which covered page content on desktop and needed its own row on phones. */}
              <span className="footer-version-sep" aria-hidden="true"> · </span>
              <span className="footer-version">{APP_VERSION}</span>
            </p>
            {/* The GitHub link moved into the user menu (0.6.19): the footer is left to the disclaimer */}
          </footer>

          {/* Mobile bottom navigation: must live outside .app-header —— see the comment on useNarrowScreen */}
          {narrow && <TabNav variant="bottom" current={view} onSelect={navigate} tabs={TABS} />}

          {/* The add-transaction modal is mounted at the shell level so a content reload cannot drop it. */}
          {showAddTx && (
            <Modal title="新增交易紀錄" onClose={() => setShowAddTx(false)} disableBackdropClose>
              <TransactionForm onSubmit={(tx) => addTransactions([tx])} />
            </Modal>
          )}

          {recovery && <RecoveryPasswordModal />}
        </ConfirmProvider>
      </ToastProvider>
    </>
  )
}
