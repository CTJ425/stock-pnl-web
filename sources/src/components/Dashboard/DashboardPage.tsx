/**
 * 庫存總覽, redesigned 2026-09-26 as today's page of a broker statement:
 * - The totals open the page: 未實現淨損益 (the figure reconciled against the broker app) and
 *   持倉市值, each carrying its own qualifier — the as-of time, the fee basis, the FX rate —
 *   instead of a separate metadata strip. 今日損益 was removed 2026-09-28 at the owner's request.
 * - Both markets are combined in TWD when a USD rate is known; without one (local mode) the
 *   markets stay apart and the page says so, rather than guessing a conversion.
 * - 未實現淨損益 follows the workspace's fee settings (utils/pnlBasis): the sell-fee basis says which
 *   rate the broker app withholds, and under 月退 the posted-rate figure also carries the list-price
 *   buy fee in cost, as the app does (Task 189). The basis line opens those settings
 *   in place; the three figures stay side by side under every row (HoldingsLedger).
 * - Only current positions count (the broker app's basis); realized history lives on 年度收益.
 */
import { Suspense, lazy, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, ChevronDown, Inbox, RefreshCw } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import { useStockPrices } from '../../hooks/useStockPrices'
import { useUsdTwdRate } from '../../hooks/useUsdTwdRate'
import { buildHoldingRows } from '../../utils/holdingRows'
import { basisLabel, formatFeeRatePct, listPriceCost, pnlBasis } from '../../utils/pnlBasis'
import { fmtMoney, fmtSignedMoney, fmtSignedPercent, pnlClass } from '../../utils/formatters'
import { DEFAULT_FEE_RATE } from '../../utils/fees'
import { getFeeRateHistory, getFeeRateOn, getStoredFeeRate } from '../../utils/settings'
import { taipeiDateKey } from '../../utils/taipeiDate'
import { WorkspaceFeeSettings, type FeeDraft } from '../WorkspaceFeeSettings'
import { HoldingsLedger } from './HoldingsLedger'
import { WatchSection } from './WatchSection'
import { closedNote, taipeiToday } from '../MarketCalendar/marketCalendar'
import { asOfLabel, combine, marketSums, type Combined, type MarketSums } from './dashboardSums'

const RecalcFeesModal = lazy(() =>
  import('../Transactions/RecalcFeesModal').then((m) => ({ default: m.RecalcFeesModal })),
)

function Figure({ c, signed, testId }: { c: Combined; signed?: boolean; testId: string }) {
  return (
    <span data-testid={testId}>{signed ? fmtSignedMoney(c.value, c.currency) : fmtMoney(c.value, c.currency)}</span>
  )
}

function StatementTotals({
  tw,
  us,
  usdTwd,
  asOf,
  loading,
  onRefresh,
  basisText,
  feeOpen,
  onToggleFee,
  previewing = false,
  feeUnset = false,
  closedNote = null,
  onOpenCalendar,
}: {
  tw: MarketSums
  us: MarketSums
  usdTwd: number | null
  asOf: string
  loading: boolean
  onRefresh: () => void
  basisText: string
  feeOpen: boolean
  onToggleFee: () => void
  /** The figures use unsaved fee settings from the open panel. */
  previewing?: boolean
  /** The workspace never saved a discount, so the TW figures run on the list price by default. */
  feeUnset?: boolean
  /** 「今天休市（國慶日）」 / 「明天休市（…）」 beside the quote time, TW holders only (0.10.26) */
  closedNote?: string | null
  /** Opens 總經's 台股開休市 calendar; absent in local mode, where 總經 is hidden */
  onOpenCalendar?: () => void
}) {
  const hasTw = tw.rows.length > 0
  const hasUs = us.rows.length > 0
  const mkt = combine(tw.netMkt, us.netMkt, hasTw, hasUs, usdTwd)
  const unreal = combine(tw.unrealized, us.unrealized, hasTw, hasUs, usdTwd)
  const cost = combine(tw.cost, us.cost, hasTw, hasUs, usdTwd)
  const roi = unreal.value !== null && cost.value ? unreal.value / cost.value : null
  const anyShort = tw.hasShort || us.hasShort
  const combined = hasTw && hasUs && !mkt.usLeftOut
  // Both markets held but no rate: the headline is the TW figure alone, and its label says so.
  const scope = hasTw && hasUs && unreal.usLeftOut ? '（台股）' : ''
  const pending = (c: Combined) => c.value === null && loading

  return (
    <section className="stmt-totals" aria-label="合計">
      <div className="stmt-tot stmt-tot-lead">
        <h2>
          未實現淨損益{scope}
          {previewing && <span className="stmt-preview">預覽・尚未儲存</span>}
          {asOf && <span className="stmt-asof">{asOf}</span>}
          {hasTw && closedNote && (
            <span className="stmt-asof">
              {asOf && '・'}
              {onOpenCalendar ? (
                <button type="button" className="stmt-closed" onClick={onOpenCalendar} title="看台股開休市日">
                  {closedNote}
                </button>
              ) : (
                closedNote
              )}
            </span>
          )}
          <button
            type="button"
            className="stmt-refresh"
            aria-label="重新整理報價"
            title="重新整理報價"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spin' : undefined} aria-hidden="true" />
          </button>
        </h2>
        <div className={`stmt-fig stmt-fig-hero ${pnlClass(unreal.value)}`}>
          {pending(unreal) ? (
            <span className="skeleton" style={{ width: '9ch', height: 36 }} aria-label="損益載入中" />
          ) : (
            <Figure c={unreal} signed testId="total-unrealized" />
          )}
          {roi !== null && <span className="stmt-pct">{fmtSignedPercent(roi)}</span>}
        </div>
        {hasTw && hasUs && (
          <div className="stmt-sub">
            <span>
              台股 <b className={pnlClass(tw.unrealized)}>{fmtSignedMoney(tw.unrealized, 'TWD')}</b>
            </span>
            <span>
              美股 <b className={pnlClass(us.unrealized)}>{fmtSignedMoney(us.unrealized, 'USD')}</b>
              {unreal.usLeftOut && '（沒有匯率，未合計）'}
            </span>
          </div>
        )}
        <div className="stmt-sub">
          {hasTw ? (
            <span className="stmt-basis-line">
              {feeUnset && <span className="stmt-unset">手續費折扣未設定</span>}
              <button
                type="button"
                className="stmt-basis"
                aria-expanded={feeOpen}
                aria-controls="stmt-fee-panel"
                onClick={onToggleFee}
              >
                {feeUnset
                  ? `台股先用不打折 ${formatFeeRatePct(DEFAULT_FEE_RATE)} 預扣・設定折扣`
                  : `台股依${basisText}`}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            </span>
          ) : (
            <span>已扣買進手續費；美股不預扣賣出費用</span>
          )}
        </div>
      </div>

      <div className="stmt-tot">
        <h2>
          {anyShort ? '淨額市值' : '持倉市值'}
          {combined ? '（台幣合計）' : scope}
        </h2>
        <div className="stmt-fig">
          {pending(mkt) ? (
            <span className="skeleton" style={{ width: '11ch', height: 24 }} aria-label="市值載入中" />
          ) : (
            <Figure c={mkt} signed={anyShort} testId="total-mktval" />
          )}
        </div>
        <div className="stmt-sub stmt-sub-lines">
          {hasTw && (
            <span>
              台股{' '}
              <span data-testid="tw-mktval">{tw.hasShort ? fmtSignedMoney(tw.netMkt, 'TWD') : fmtMoney(tw.netMkt, 'TWD')}</span>
            </span>
          )}
          {tw.hasShort && (
            <span>
              多單 <span data-testid="tw-long-mktval">{fmtMoney(tw.longMkt, 'TWD')}</span>・空單{' '}
              <span data-testid="tw-short-mktval">{fmtMoney(tw.shortMkt, 'TWD')}</span>
            </span>
          )}
          {hasUs && (
            <span>
              美股 <span data-testid="us-mktval">{fmtMoney(us.netMkt, 'USD')}</span>
            </span>
          )}
          {combined && usdTwd !== null && <span>匯率 {usdTwd.toFixed(2)}</span>}
        </div>
      </div>
    </section>
  )
}

export function DashboardPage({
  onSelectTicker,
  onAddTransaction,
  onGoToTransactions,
  onOpenCalendar,
}: {
  onSelectTicker?: (ticker: string, name: string) => void
  onAddTransaction?: () => void
  onGoToTransactions?: () => void
  onOpenCalendar?: () => void
} = {}) {
  const { ledger, current, transactions = [] } = useWorkspace()
  const holdings = ledger.holdings
  const { prices, loading, refreshedAt, refresh } = useStockPrices(holdings)
  const [refreshKey, setRefreshKey] = useState(0)
  const [feeOpen, setFeeOpen] = useState(false)
  const [showRecalc, setShowRecalc] = useState(false)
  // Unsaved values from the open fee panel: every figure below is recomputed with them as a preview.
  const [draft, setDraft] = useState<FeeDraft | null>(null)
  // Task 182: a sell made now is charged the rate in force today, whatever rate the lots were
  // bought under — so every forward-looking figure on this page asks for today's rate.
  const savedRate = getFeeRateOn(taipeiDateKey(new Date()), current?.id)
  // A new workspace has no rate until its owner saves one, and the figures then fall back to the
  // list price. Someone who opened the account at a discount would not know that, record trades at
  // 3 折 in 新增交易, and read a total withheld at the full rate — so the basis line says it.
  const feeUnset =
    getStoredFeeRate(current?.id) === null &&
    current?.fee_rate == null &&
    getFeeRateHistory(current?.id).length === 0
  const savedRebate = current?.fee_rebate ?? 'instant'
  const savedRounding = current?.fee_rounding ?? 'lot'
  // BUG-090: null means "not set" and keeps the BUG-087 behaviour (玉山 halves it, RON does not).
  const savedDayTradeTax = current?.day_trade_tax_estimate ?? true
  const feeRate = draft?.rate ?? savedRate
  const rebate = draft?.rebate ?? savedRebate
  const rounding = draft?.rounding ?? savedRounding
  const dayTradeTax = draft?.dayTradeTax ?? savedDayTradeTax
  // Task 189: null keeps the pre-split rule inside `pnlBasis`.
  const savedSellBasis = current?.sell_fee_basis ?? null
  const sellBasis = draft?.sellBasis ?? savedSellBasis
  const savedBasis = pnlBasis(savedRate, savedRebate, savedSellBasis)
  const basis = pnlBasis(feeRate, rebate, sellBasis)
  // An open fee panel always carries a sell basis, so it previews what saving would switch on.
  const listCost = listPriceCost(rebate, sellBasis)
  const previewing =
    draft !== null &&
    (draft.rate !== savedRate ||
      draft.rebate !== savedRebate ||
      draft.rounding !== savedRounding ||
      draft.dayTradeTax !== savedDayTradeTax ||
      basis !== savedBasis ||
      listCost !== listPriceCost(savedRebate, savedSellBasis))

  const handleRefresh = () => {
    refresh()
    setRefreshKey((k) => k + 1)
  }

  // BUG-087: the 券商 figure withholds the halved 現股當沖 tax on a lot bought today. A plain
  // string, so the memo below compares by value and only re-runs when the Taipei date turns over.
  // BUG-090: and only when this workspace's broker actually does that — RON withholds the full
  // 0.3% on a position opened the same morning, so passing the date would read 195 too optimistic.
  const today = dayTradeTax ? taipeiDateKey(new Date()) : undefined
  const rows = useMemo(
    () => buildHoldingRows(holdings, prices, feeRate, current?.id, rounding, today, listCost),
    [holdings, prices, feeRate, current?.id, rounding, today, listCost],
  )
  const tw = marketSums(rows.filter((r) => r.holding.currency === 'TWD'), 'TWD', basis, loading)
  // While the fee panel is open, the same total on the saved settings, so the panel's action bar can
  // print saved → previewed next to 儲存 (the hero figure has scrolled away by then on a phone).
  const savedToday = savedDayTradeTax ? taipeiDateKey(new Date()) : undefined
  const savedListCost = listPriceCost(savedRebate, savedSellBasis)
  const savedTwUnrealized = useMemo(() => {
    if (draft === null) return null
    const savedRows = buildHoldingRows(
      holdings.filter((h) => h.currency === 'TWD'),
      prices,
      savedRate,
      current?.id,
      savedRounding,
      savedToday,
      savedListCost,
    )
    return marketSums(savedRows, 'TWD', savedBasis, loading).unrealized
  }, [draft, holdings, prices, savedRate, current?.id, savedRounding, savedToday, savedListCost, savedBasis, loading])
  const impact =
    draft !== null && tw.rows.length > 0 ? (
      <>
        <span className="fee-impact-label">台股未實現淨損益</span>
        <span className={pnlClass(savedTwUnrealized)}>{fmtSignedMoney(savedTwUnrealized, 'TWD')}</span>
        {previewing && tw.unrealized !== savedTwUnrealized ? (
          <>
            <ArrowRight className="fee-impact-arrow" size={14} aria-hidden="true" />
            <span className="sr-only">改成</span>
            <b className={pnlClass(tw.unrealized)}>{fmtSignedMoney(tw.unrealized, 'TWD')}</b>
          </>
        ) : (
          <span className="fee-impact-same">儲存後不變</span>
        )}
      </>
    ) : null
  const us = marketSums(rows.filter((r) => r.holding.currency === 'USD'), 'USD', basis, loading)
  const usdTwd = useUsdTwdRate(tw.rows.length > 0 && us.rows.length > 0, refreshKey)
  const markets = [
    ...(tw.rows.length > 0 ? [{ sums: tw, label: '台股' }] : []),
    ...(us.rows.length > 0 ? [{ sums: us, label: '美股' }] : []),
  ]
  const basisText = basisLabel(basis, feeRate, listCost)

  return (
    <>
      {ledger.warnings.length > 0 && (
        <div className="notice notice-warn section" role="alert">
          <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
          發現 {ledger.warnings.length} 筆資料異常（如超賣、超額回補）：
          {ledger.warnings.slice(0, 3).map((w) => (
            <div key={w} style={{ marginTop: 4 }}>・{w}</div>
          ))}
          {ledger.warnings.length > 3 && <div style={{ marginTop: 4 }}>…（共 {ledger.warnings.length} 筆）</div>}
        </div>
      )}

      {holdings.length > 0 && (
        <StatementTotals
          tw={tw}
          us={us}
          usdTwd={usdTwd}
          asOf={asOfLabel(rows, refreshedAt)}
          loading={loading}
          onRefresh={handleRefresh}
          basisText={basisText}
          feeOpen={feeOpen}
          onToggleFee={() => setFeeOpen((v) => !v)}
          previewing={previewing}
          feeUnset={feeUnset && !previewing}
          closedNote={closedNote(taipeiToday())}
          onOpenCalendar={onOpenCalendar}
        />
      )}

      {feeOpen && (
        <div className="stmt-fee-panel" id="stmt-fee-panel">
          <WorkspaceFeeSettings
            onPreview={setDraft}
            impact={impact}
            onClose={() => setFeeOpen(false)}
            onSaved={({ rateChanged }) => {
              if (rateChanged) setShowRecalc(true)
            }}
          />
        </div>
      )}

      <section className="section stmt-holdings" aria-label="持股明細">
        {holdings.length === 0 ? (
          <>
            <div className="hl-head">
              <h2>持股明細</h2>
            </div>
            <div className="glass empty-state">
              <div className="empty-icon">
                <Inbox size={36} />
              </div>
              <div>目前沒有持股。新增第一筆買入，或匯入舊的 CSV 資料。</div>
              <div className="empty-actions">
                {onAddTransaction && (
                  <button className="btn btn-primary" onClick={onAddTransaction}>
                    新增第一筆交易
                  </button>
                )}
                {onGoToTransactions && (
                  <button className="btn" onClick={onGoToTransactions}>
                    匯入 CSV
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <HoldingsLedger
              markets={markets}
              basis={basis}
              feeRate={feeRate}
              loading={loading}
              ledger={ledger}
              transactions={transactions}
              onRetry={handleRefresh}
              onSelectTicker={onSelectTicker}
              onGoToTransactions={onGoToTransactions}
            />
            {/* Footnotes replace the header "?" icons: every definition is readable without hovering. */}
            <ol className="stmt-notes">
              <li>現價：台股接近即時，每分鐘更新；美股最多延遲 20 分鐘。收盤後是當天的收盤價。紅色代表比昨天收盤高、綠色代表比昨天收盤低。標「快取」代表暫時抓不到新價格，不上色。</li>
              <li>
                未實現淨損益：如果現在全部賣掉，大約會賺賠多少。台股依{basisText}賣出手續費，再扣證交稅；美股只扣買進手續費。
                算法跟著這個工作區的手續費設定走。點一列可以看三種算法的對照、含費與未含費的成本，以及這檔股票的每一筆交易。
              </li>
            </ol>
          </>
        )}
      </section>

      <WatchSection refreshTrigger={refreshKey} onSelectTicker={onSelectTicker ?? (() => {})} />

      {showRecalc && (
        <Suspense fallback={null}>
          <RecalcFeesModal onClose={() => setShowRecalc(false)} />
        </Suspense>
      )}
    </>
  )
}
