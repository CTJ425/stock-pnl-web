/**
 * Transaction input form (ported from GAS version Sidebar.html):
 * - The code name is out of focus and the name and market are automatically checked; the name input is anti-shake and blurry and the search drop-down
 * - The number of Taiwanese stocks can be switched and automatically converted according to "lots/odd lots" (U.S. stocks are locked in odd lots)
 * - Handling fee is automatically estimated: Taiwanese stocks are rounded off if they are below the dollar, and the certificate tax is added when sold (ETF 00 starts with 0.1%)
 * - Write failure retains all input content
 * - Passing in initial is the "edit mode": the existing transaction content is brought in, and the fields are not cleared after success;
 *   When the handling fee is turned on, it will be re-estimated based on the current rate (the old data may be logged in incorrectly), and the original record can be restored with one click.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Spinner } from '../Common/Spinner'
import { useConfirm } from '../Common/useConfirm'
import { useWorkspace } from '../../context/WorkspaceContext'
import { taipeiDateKey } from '../../utils/taipeiDate'
import type { Market, NewTransaction, Transaction, TxNature, TxType } from '../../types/models'
import { TX_NATURE_LABEL } from '../../types/models'
import { calculateFee, inferFeeRate } from '../../utils/fees'
import { DEFAULT_WIRE_FEE, estimateWithholding } from '../../utils/nhiSupplement'
import type { Holding } from '../../utils/pnlEngine'
import { dayTradeTaxRate, sellTaxRate } from '../../utils/pnlEngine'
import { getFeeRateOn, getMinFee } from '../../utils/settings'
import { describeTwFeeRate } from '../../utils/feeRateHint'
import type { StockSearchResult } from '../../services/stockSearch'
import { lookupTicker, searchStocks } from '../../services/stockSearch'
import { isSupabaseConfigured } from '../../services/supabase'

type Unit = '張' | '零股'

/** Securities tax rate quick selection value (general/ETF/halved/tax-free)*/
const TAX_PRESET_VALUES = ['0.003', '0.001', '0.0015', '0']

/**
 * Today in **Asia/Taipei**, like every other "today" in this app (`taipeiDateKey`, BUG-087).
 *
 * It used to read the device's own calendar date. For a user in Taiwan that is the same day, so
 * nothing looked wrong — but the market this form records trades on is TWSE, and the rest of the
 * app already dates everything by Taipei. The two disagree for anyone whose machine is on another
 * zone, including CI and any container on UTC: measured 2026-10-02 00:30 Taipei, the form offered
 * 2026-10-01 while the dashboard's day had already turned, which both pre-dates a new trade and
 * breaks the same-day 當沖 detection below (it compares the entered date against a lot's date).
 */
function todayStr(): string {
  return taipeiDateKey(new Date())
}

interface TransactionFormProps {
  onSubmit: (tx: NewTransaction) => Promise<void>
  onDone?: () => void
  /** Edit mode: bring in existing transaction content*/
  initial?: Transaction
}

export function TransactionForm({ onSubmit, onDone, initial }: TransactionFormProps) {
  const { current, ledger, transactions, updateTransactionsBatch } = useWorkspace()
  const confirm = useConfirm()
  const workspaceId = current?.id
  const isEdit = Boolean(initial)
  const [date, setDate] = useState(initial?.tx_date ?? todayStr)
  const [market, setMarket] = useState<Market>(initial?.market ?? 'TPE')
  const [txType, setTxType] = useState<TxType>(initial?.tx_type ?? 'BUY')
  const [nature, setNature] = useState<TxNature>(initial?.tx_nature ?? 'SPOT')
  const [ticker, setTicker] = useState(initial?.ticker ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '')
  // Edit mode displays the original number of shares in "odd shares" to avoid ambiguity in lot/odd share conversions
  const [unit, setUnit] = useState<Unit>(initial ? '零股' : '張')
  const [feeRate, setFeeRate] = useState(() => {
    if (initial?.fee_rate !== undefined && initial.fee_rate !== null) {
      return String(initial.fee_rate)
    }
    const defaultRate = getFeeRateOn(initial?.tx_date ?? todayStr(), workspaceId)
    if (initial) {
      const minFees = { whole: getMinFee('whole', workspaceId), odd: getMinFee('odd', workspaceId) }
      return String(inferFeeRate(initial, defaultRate, minFees))
    }
    return String(defaultRate)
  })
  // Task 182: the workspace's rate can change from a date, so the default follows the transaction's
  // own date — until the user types a rate for this one trade, after which the field is theirs.
  const feeRateManual = useRef(false)
  const minFeeUnit = unit === '張' ? 'whole' : 'odd'
  const [minFee, setMinFee] = useState(() => String(getMinFee(minFeeUnit, workspaceId)))

  // When switching workspaces/whole shares or odd units, the corresponding memorized rates and minimum handling fees are brought in
  useEffect(() => {
    if (isEdit || feeRateManual.current) return
    setFeeRate(String(getFeeRateOn(date, workspaceId)))
  }, [workspaceId, isEdit, date])
  useEffect(() => {
    // A different workspace has different defaults, so drop any values typed under the previous one.
    if (minFeeWorkspaceRef.current !== workspaceId) {
      minFeeTyped.current = {}
      minFeeWorkspaceRef.current = workspaceId
      setMinFee(String(getMinFee(minFeeUnit, workspaceId)))
      return
    }
    const typed = minFeeTyped.current[minFeeUnit]
    setMinFee(typed !== undefined ? typed : String(getMinFee(minFeeUnit, workspaceId)))
  }, [workspaceId, minFeeUnit])
  // BUG-091: the rate has to follow the row's own 交易性質, not just its ticker. Opening a 當沖
  // row showed 0.3% — and the moment any core input changed, the recalc effect below rewrote the
  // stored half-tax fee at the full rate, which lands in 持股成本 and 年度收益 alike.
  const [taxRate, setTaxRate] = useState(() =>
    initial
      ? String(
          initial.tx_nature === 'DAY_TRADE'
            ? dayTradeTaxRate(initial.ticker, initial.tx_date)
            : sellTaxRate(initial.ticker),
        )
      : '0.003',
  )
  const [fee, setFee] = useState(initial ? String(initial.fee_tax) : '0')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ ticker?: string; price?: string; qty?: string }>({})
  const tickerInputRef = useRef<HTMLInputElement | null>(null)
  const priceInputRef = useRef<HTMLInputElement | null>(null)
  const qtyInputRef = useRef<HTMLInputElement | null>(null)

  const [suggestions, setSuggestions] = useState<StockSearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  // TX-07: a lookup that comes back empty (查無代號) must read differently from one that
  // never reached the server (查詢失敗（網路）) — otherwise a network hiccup looks like a typo.
  const [tickerLookupMsg, setTickerLookupMsg] = useState<string | null>(null)
  const taxRateManual = useRef(false)

  const activeHoldings = useMemo(
    () => ledger.holdings.filter((h) => h.qty > 0 && h.market === market),
    [ledger.holdings, market],
  )
  /**
   * A sell that disposes of shares this workspace actually holds, so the 庫存 drop-down applies.
   *
   * 當沖 counts (Task 187): a 現股當沖 sell disposes of 現股 bought the same day — the position is
   * real and listing it is more useful here, not less. It was excluded only because the original
   * rule lumped every non-現股 nature together; the nature that genuinely holds nothing is 融券,
   * whose sell opens a short rather than closing a holding.
   */
  const isSpotSell =
    txType === 'SELL' && (market !== 'TPE' || nature === 'SPOT' || nature === 'DAY_TRADE')
  const isShortCover = txType === 'BUY' && market === 'TPE' && nature === 'SHORT'
  // Task 166 EN-01: dividends carry no 交易性質 (tx_nature is submitted as null for both) and a
  // stock dividend's price is locked to 0, so neither field is shown for these two types.
  const isCashDividend = txType === 'DIVIDEND'
  const isStockDividend = txType === 'STOCK_DIVIDEND'
  const activeShorts = useMemo(
    () => ledger.holdings.filter((h) => h.shortQty > 0 && h.market === market),
    [ledger.holdings, market],
  )

  const [showTickerHoldings, setShowTickerHoldings] = useState(false)
  const [showNameHoldings, setShowNameHoldings] = useState(false)
  const tickerFieldRef = useRef<HTMLDivElement | null>(null)
  const nameFieldRef = useRef<HTMLDivElement | null>(null)

  const filteredTickerHoldings = useMemo(() => {
    const q = ticker.trim().toUpperCase()
    if (!q) return activeHoldings
    return activeHoldings.filter(
      (h) => h.ticker.toUpperCase().includes(q) || h.name.includes(ticker.trim()),
    )
  }, [activeHoldings, ticker])

  const filteredTickerShorts = useMemo(() => {
    const q = ticker.trim().toUpperCase()
    if (!q) return activeShorts
    return activeShorts.filter(
      (h) => h.ticker.toUpperCase().includes(q) || h.name.includes(ticker.trim()),
    )
  }, [activeShorts, ticker])

  const filteredNameHoldings = useMemo(() => {
    const q = name.trim()
    if (!q) return activeHoldings
    return activeHoldings.filter(
      (h) => h.name.includes(q) || h.ticker.toUpperCase().includes(q.toUpperCase()),
    )
  }, [activeHoldings, name])

  const pickHolding = (item: Holding) => {
    setName(item.name)
    setTicker(item.ticker)
    if (item.market !== market) handleMarketChange(item.market)
    lastSearchedTicker.current = item.ticker
    updateTaxRateAuto(item.ticker)
    setShowTickerHoldings(false)
    setShowNameHoldings(false)
    closeSuggestions()
  }

  // In edit mode the saved fee/tax stands until the user changes a core input.
  // A "skip the first run" flag is not enough: StrictMode invokes an effect twice on
  // mount (main.tsx wraps App), and the second pass would consume the flag and overwrite
  // anyway. Comparing the inputs against their initial values gives the same answer
  // however many times the effect runs. Cleared for good on the first real change, so
  // typing a value back to its original still recalculates.
  // The list here and the one in the fee effect below MUST stay identical: if they drift, the
  // signatures never match, the guard releases immediately, and opening any record for edit
  // silently recalculates its fee. `date` is part of it only for a cash dividend, whose premium
  // rule is dated — adding it unconditionally would make editing a trade's date move its
  // commission, which it has never done. Pinned by TransactionForm.dividend.test.tsx D8.
  const untouchedFeeSig = useRef<string | null>(
    initial
      ? [price, qty, unit, feeRate, taxRate, minFee, market, txType, nature, txType === 'DIVIDEND' ? date : ''].join('|')
      : null,
  )
  // Per-unit record of user-typed 最低手續費, so a value typed under one unit survives switching to the other and back.
  const minFeeTyped = useRef<Partial<Record<'whole' | 'odd', string>>>({})
  const minFeeWorkspaceRef = useRef(workspaceId)
  // In edit mode, the original codename is considered to have been reverse-checked to avoid overwriting the user-defined name when out of focus.
  const lastSearchedTicker = useRef(initial?.ticker ?? '')
  const searchSeq = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Every path that hides the suggestion drop-down must also stop the spinner and
  // invalidate the in-flight search, or the spinner can be left turning forever.
  const closeSuggestions = useCallback(() => {
    if (searchTimer.current) {
      clearTimeout(searchTimer.current)
      searchTimer.current = null
    }
    searchSeq.current++
    setSuggestions(null)
    setSearching(false)
  }, [])

  const getActualShares = useCallback((): number => {
    const val = parseFloat(qty) || 0
    if (unit === '張') return Math.round(val * 1000)
    return market === 'TPE' ? Math.round(val) : val
  }, [qty, unit, market])

  // Securities tax rate field: automatically brought in according to the code if not manually modified (0.1% starting with ETF 00)
  // `nextNature` is explicit because the 交易性質 dropdown calls this during its own onChange,
  // when `nature` still holds the previous value (BUG-091).
  const updateTaxRateAuto = useCallback(
    (nextTicker: string, nextNature: TxNature = nature) => {
      if (taxRateManual.current) return
      const clean = nextTicker.trim().toUpperCase().replace(/^TPE:/, '')
      // The 當沖 relief is dated (§2-2 runs to 2027-12-31), so it is judged on this trade's date.
      setTaxRate(String(nextNature === 'DAY_TRADE' ? dayTradeTaxRate(clean, date) : sellTaxRate(clean)))
    },
    [nature, date],
  )

  /**
   * 現股當沖 detection for a TW sell (Task 187).
   *
   * Why the form and not the engine: 當沖 is a relationship between two trades, and at the moment
   * the **buy** is recorded the answer does not exist yet. The sell is the first point where it
   * can be known, so that is where the form asks — or decides, when there is nothing to decide.
   *
   * The rule is deliberately split, because the two cases are not equally certain:
   * - **No shares of this ticker from before today** → the only thing this sell can be closing is
   *   what was bought today. Applied automatically, with a notice saying so and a way back.
   * - **An older position exists** → the user may well be selling the old shares, which is an
   *   ordinary 現股賣出 at the full tax. Guessing here would write a securities tax the broker
   *   never charged, so the form offers it and leaves the default alone.
   *
   * This is the same boundary `proposeDayTradeLabels` keeps: same-day date matching alone was
   * measured at 12 false positives out of 14 round trips, so a date may prompt but never decide.
   *
   * **New trades only (BUG-095).** `ledger` is the ledger *after* every saved row, so in edit mode
   * it already includes the very sell being edited. FIFO has consumed whatever that sell closed,
   * and an ordinary 現股 sell of the old shares leaves only today's lot open — which reads as
   * "no older position" and used to flip the row to 當沖 the moment it was opened, halving the
   * tax and rewriting `fee_tax` with nothing touched. An edit keeps the nature it was saved with;
   * the 交易性質 drop-down is still there to change it.
   */
  const dayTradeContext = useMemo(() => {
    const clean = ticker.trim().toUpperCase().replace(/^TPE:/, '')
    if (isEdit || market !== 'TPE' || txType !== 'SELL' || !clean) return null
    const holding = ledger.holdings.find((h) => h.market === 'TPE' && h.ticker === clean)
    const sameDayLots = holding?.openLots.filter((l) => l.date === date) ?? []
    const sameDayQty = sameDayLots.reduce((sum, l) => sum + l.qty, 0)
    if (sameDayQty <= 0) return null
    const olderQty = (holding?.openLots ?? [])
      .filter((l) => l.date !== date)
      .reduce((sum, l) => sum + l.qty, 0)
    // The buy rows behind today's lots, so the pair can be labelled together on submit.
    const lotIds = new Set(sameDayLots.map((l) => l.txId))
    const buyLegs = transactions.filter(
      (t) => lotIds.has(t.id) && (t.tx_nature == null || t.tx_nature === 'SPOT'),
    )
    return { sameDayQty, olderQty, certain: olderQty === 0, buyLegs }
  }, [isEdit, market, txType, ticker, date, ledger.holdings, transactions])

  // Goes through the same path the 交易性質 drop-down uses, so there is one rule — including
  // BUG-094's: `updateTaxRateAuto` leaves a rate the user set alone. This used to reset
  // `taxRateManual` first, and the effect below calls it with no user action at all, so typing a
  // rate and then the ticker silently replaced the typed rate (BUG-096).
  const applyDayTrade = useCallback(
    (on: boolean) => {
      const next: TxNature = on ? 'DAY_TRADE' : 'SPOT'
      setNature(next)
      updateTaxRateAuto(ticker, next)
    },
    [ticker, updateTaxRateAuto],
  )

  /**
   * The automatic half: only for the certain case, only while the user has not taken the wheel.
   * `autoApplied` remembers that *this form* set it, so clicking 改回現股 is not undone on the
   * next render — and so a 當沖 the user picked by hand is never relabelled by this effect.
   */
  const autoApplied = useRef(false)

  /**
   * What the 當沖 notices say about the tax (BUG-097). 證券交易稅條例 §2-2 sets 千分之1.5 for
   * 上市或上櫃**股票** only, so an ETF day trade still pays 0.1% (and after the §2-2 sunset every
   * day trade pays the ordinary rate): the notice must not promise a cut the rate field does not
   * show. And since the label no longer re-prices a rate the user set (BUG-096), it says so when
   * the field holds something else.
   */
  const dayTradeTaxNote = useMemo(() => {
    if (!dayTradeContext) return null
    const clean = ticker.trim().toUpperCase().replace(/^TPE:/, '')
    const full = sellTaxRate(clean)
    const dt = dayTradeTaxRate(clean, date)
    const pct = (r: number) => `${parseFloat((r * 100).toFixed(4))}%`
    const relief = dt < full
    const expected = nature === 'DAY_TRADE' ? dt : full
    const field = parseFloat(taxRate)
    return {
      labelled: relief ? `證交稅用當沖的 ${pct(dt)}。` : `這檔當沖沒有降稅，證交稅仍是 ${pct(full)}。`,
      offer: relief
        ? `如果你賣的是今天買的那批，那是當沖，證交稅只收 ${pct(dt)}。`
        : `如果你賣的是今天買的那批，那是當沖；這檔當沖的證交稅不會降（仍是 ${pct(full)}），標成當沖是讓它先跟今天的買進沖銷再算成本。`,
      manual:
        Number.isFinite(field) && field !== expected ? `證交稅率欄是你自己設定的 ${pct(field)}，沒有跟著改。` : '',
    }
  }, [dayTradeContext, ticker, date, nature, taxRate])
  useEffect(() => {
    if (!dayTradeContext?.certain) {
      if (autoApplied.current && nature === 'DAY_TRADE') {
        autoApplied.current = false
        applyDayTrade(false)
      }
      return
    }
    if (nature !== 'SPOT' || autoApplied.current) return
    autoApplied.current = true
    applyDayTrade(true)
  }, [dayTradeContext, nature, applyDayTrade])


  // Automatic conversion of handling fees (recalculated when enabled and dependent on changes; users can still manually modify field values).
  // Edit mode no longer re-estimates on open: the initial mount keeps `initial.fee_tax` as-is,
  // and recalculation only kicks in once the user actually changes a core input below.
  // "Restore original record" is provided below the field to change it back to the original value.
  useEffect(() => {
    // Same list as `untouchedFeeSig` above — see the comment there before changing either.
    const sig = [price, qty, unit, feeRate, taxRate, minFee, market, txType, nature, isCashDividend ? date : ''].join('|')
    if (untouchedFeeSig.current !== null) {
      if (untouchedFeeSig.current === sig) return
      untouchedFeeSig.current = null
    }
    // 股票股利 moves shares and cost but no cash, so its 相關費用 is whatever the user says.
    if (isStockDividend) return
    const p = parseFloat(price) || 0
    const shares = getActualShares()
    // Task 183: a TW cash dividend's 代扣費用 is filled and kept in step exactly like a
    // commission — change 每股股利 or 配發股數 and the estimate follows until you save. The
    // saved number is still whatever stands in the field, and nothing recomputes it on read.
    // A US dividend is withheld at source under a rule this app does not model, so it is left
    // to the user; `date` joins the signature because the premium rule is dated.
    if (isCashDividend) {
      if (market !== 'TPE') return
      const gross = p * shares
      if (gross > 0) setFee(String(estimateWithholding(gross, date, DEFAULT_WIRE_FEE).total))
      return
    }
    const rate = parseFloat(feeRate) || 0
    if (p > 0 && shares > 0) {
      const calculated = calculateFee({
        market,
        txType,
        price: p,
        qty: shares,
        feeRate: rate,
        taxRate: parseFloat(taxRate) || 0,
        minFee: market === 'TPE' ? parseFloat(minFee) || 0 : undefined,
        nature: market === 'TPE' ? nature : undefined,
      })
      setFee(String(calculated))
    }
  }, [price, qty, unit, feeRate, taxRate, minFee, market, txType, nature, date, getActualShares, isCashDividend, isStockDividend])

  /**
   * Task 183: the breakdown behind the 代扣費用 the effect above just filled in, so the user can
   * see *why* it says 601 and correct it against their own notice. The figure itself is written by
   * the effect, not here. US dividends are withheld at source under a different rule, so no line.
   */
  const dividendWithholding = useMemo(() => {
    if (!isCashDividend || market !== 'TPE') return null
    const gross = (parseFloat(price) || 0) * getActualShares()
    if (!(gross > 0)) return null
    return { gross, ...estimateWithholding(gross, date, DEFAULT_WIRE_FEE) }
  }, [isCashDividend, market, price, date, getActualShares])

  // Market Switch: U.S. Stocks Mandate “Odd Lot” Units
  const handleMarketChange = (next: Market) => {
    setMarket(next)
    setShowTickerHoldings(false)
    setShowNameHoldings(false)
    closeSuggestions()
    if (next === 'US' && unit === '張') {
      convertUnit('零股')
    }
  }

  // Number of shares converted when switching units (sheets = 1000 shares)
  const convertUnit = (next: Unit) => {
    const val = parseFloat(qty)
    if (!Number.isNaN(val)) {
      if (unit === '張' && next === '零股') setQty(String(Math.round(val * 1000)))
      else if (unit === '零股' && next === '張') setQty(String(parseFloat((val / 1000).toFixed(3))))
    }
    setUnit(next)
  }

  // The code name is out of focus → Check the name and market
  const handleTickerBlur = async () => {
    const clean = ticker.trim().toUpperCase()
    if (!clean || clean === lastSearchedTicker.current) return
    setLookingUp(true)
    setTickerLookupMsg(null)
    try {
      const result = await lookupTicker(clean, market)
      if (result) {
        setName(result.name)
        setTicker(result.symbol)
        if (result.market !== market) handleMarketChange(result.market)
        lastSearchedTicker.current = result.symbol
        updateTaxRateAuto(result.symbol)
      } else {
        lastSearchedTicker.current = ''
        setTickerLookupMsg('查無代號')
      }
    } catch {
      lastSearchedTicker.current = ''
      setTickerLookupMsg('查詢失敗（網路）')
    } finally {
      setLookingUp(false)
    }
  }

  // Name input → anti-shake fuzzy search (searchSeq discards expired responses)
  const handleNameInput = (value: string) => {
    setName(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const query = value.trim()
    if (!query) {
      searchSeq.current++
      setSuggestions(null)
      setSearching(false)
      return
    }
    setSearching(true)
    searchTimer.current = setTimeout(async () => {
      const mySeq = ++searchSeq.current
      try {
        const results = await searchStocks(query)
        if (mySeq !== searchSeq.current) return
        setSuggestions(results)
      } catch {
        // A rejected search must not leave the spinner turning, and must not escape
        // the timer callback as an unhandled rejection.
        if (mySeq === searchSeq.current) setSuggestions([])
      } finally {
        if (mySeq === searchSeq.current) setSearching(false)
      }
    }, 300)
  }

  // The debounce timer outlives the component; clear it so a closed form runs no search.
  useEffect(
    () => () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    },
    [],
  )

  const pickSuggestion = (item: StockSearchResult) => {
    setName(item.name)
    setTicker(item.symbol)
    if (item.market !== market) handleMarketChange(item.market)
    lastSearchedTicker.current = item.symbol
    updateTaxRateAuto(item.symbol)
    closeSuggestions()
  }

  // Collapse drop-downs when clicking elsewhere in the form
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (tickerFieldRef.current && !tickerFieldRef.current.contains(target)) {
        setShowTickerHoldings(false)
      }
      if (nameFieldRef.current && !nameFieldRef.current.contains(target)) {
        setShowNameHoldings(false)
        closeSuggestions()
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [closeSuggestions])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)

    // STOCK_DIVIDEND's price is locked to 0 regardless of whatever the (hidden) field holds.
    const p = isStockDividend ? 0 : parseFloat(price)
    const shares = getActualShares()
    const feeVal = parseFloat(fee) || 0
    const cleanTicker = ticker.trim().toUpperCase().replace(/^TPE:/, '')

    const nextFieldErrors: { ticker?: string; price?: string; qty?: string } = {}
    if (!cleanTicker) nextFieldErrors.ticker = '請輸入股票代號'
    if (!isStockDividend && !(p > 0)) {
      nextFieldErrors.price = isCashDividend ? '每股股利要大於 0' : '單價要大於 0'
    }
    if (!(shares > 0)) {
      nextFieldErrors.qty = isCashDividend || isStockDividend ? '配發股數要大於 0' : '股數要大於 0'
    }
    if (nextFieldErrors.ticker || nextFieldErrors.price || nextFieldErrors.qty) {
      setFieldErrors(nextFieldErrors)
      const firstInvalid = nextFieldErrors.ticker
        ? tickerInputRef.current
        : nextFieldErrors.price
          ? priceInputRef.current
          : qtyInputRef.current
      firstInvalid?.focus()
      return
    }
    setFieldErrors({})
    if (feeVal < 0) {
      setMessage({ kind: 'error', text: '手續費 / 稅金不可為負數' })
      return
    }

    // TX-05: a future-dated transaction is usually a typo (wrong year/month), not intent —
    // ask instead of silently accepting it.
    if (date > todayStr()) {
      const ok = await confirm({
        title: '交易日期在未來',
        message: `交易日期「${date}」晚於今天，確定要新增這筆交易嗎？`,
        confirmLabel: '確定新增',
      })
      if (!ok) return
    }

    setBusy(true)
    try {
      await onSubmit({
        tx_date: date,
        market,
        ticker: cleanTicker,
        name: name.trim() || cleanTicker,
        tx_type: txType,
        tx_nature: isCashDividend || isStockDividend ? null : market === 'TPE' ? nature : undefined,
        fee_rate: feeRate !== '' && !Number.isNaN(parseFloat(feeRate)) ? parseFloat(feeRate) : undefined,
        price: p,
        qty: shares,
        fee_tax: feeVal,
      })
      // Task 187: a 當沖 is a pair, so the buy leg gets the label too. The engine needs only one
      // labelled leg, but a buy row still reading 現股 while its own sell reads 當沖 is a record
      // that contradicts itself — and the 標記當沖 wizard skips a date that already has a label,
      // so nothing would ever come back for it. Failure here is reported and nothing else:
      // the sell is already saved, and the ledger is correct with one leg labelled.
      if (nature === 'DAY_TRADE' && dayTradeContext && dayTradeContext.buyLegs.length > 0) {
        try {
          await updateTransactionsBatch(
            dayTradeContext.buyLegs.map((b) => ({
              id: b.id,
              price: b.price,
              qty: b.qty,
              fee_tax: b.fee_tax,
              fee_rate: b.fee_rate ?? null,
              tx_nature: 'DAY_TRADE' as const,
            })),
          )
        } catch (err) {
          setMessage({
            kind: 'error',
            text: `賣出已存檔，但同一天那筆買進沒有標記成當沖：${err instanceof Error ? err.message : String(err)}`,
          })
        }
      }
      if (isEdit) {
        // Edit mode: keep the content and let the caller close the window directly
        onDone?.()
        return
      }
      // Success: retain date/market/type, clear individual stock related fields (same structure as GAS version)
      setTicker('')
      setName('')
      setPrice('')
      setQty('')
      setFee('0')
      setNature('SPOT')
      setShowTickerHoldings(false)
      setShowNameHoldings(false)
      lastSearchedTicker.current = ''
      taxRateManual.current = false
      feeRateManual.current = false
      autoApplied.current = false
      setTaxRate('0.003')
      setMessage({ kind: 'ok', text: '🎉 成功新增交易紀錄，Dashboard 與年度收益已同步更新！' })
      onDone?.()
    } catch (err) {
      // Failure: Keep all input
      setMessage({
        kind: 'error',
        text: `寫入失敗：${err instanceof Error ? err.message : '請稍後再試'}`,
      })
    } finally {
      setBusy(false)
    }
  }

  const showTax = market === 'TPE' && txType === 'SELL'
  const feeRateHint = useMemo(
    () => (market === 'TPE' ? describeTwFeeRate(parseFloat(feeRate)) : { discount: null, warning: null }),
    [market, feeRate],
  )

  return (
    <form onSubmit={submit}>
      {message && (
        <div className={`notice ${message.kind === 'ok' ? 'notice-ok' : 'notice-error'}`}>
          {message.text}
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="tx-date">交易日期</label>
          <input id="tx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tx-market">交易市場</label>
          <select id="tx-market" value={market} onChange={(e) => handleMarketChange(e.target.value as Market)}>
            <option value="TPE">台股</option>
            <option value="US">美股</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="tx-type">交易類型</label>
          <select
            id="tx-type"
            value={txType}
            onChange={(e) => {
              const next = e.target.value as TxType
              setTxType(next)
              setShowTickerHoldings(false)
              setShowNameHoldings(false)
              closeSuggestions()
            }}
          >
            <option value="BUY">買入</option>
            <option value="SELL">賣出</option>
            <option value="DIVIDEND">現金股利</option>
            <option value="STOCK_DIVIDEND">股票股利</option>
          </select>
        </div>
        {market === 'TPE' && !isCashDividend && !isStockDividend && (
          <div className="field">
            <label htmlFor="tx-nature">交易性質</label>
            <select
              id="tx-nature"
              value={nature}
              onChange={(e) => {
                const next = e.target.value as TxNature
                setNature(next)
                setShowTickerHoldings(false)
                setShowNameHoldings(false)
                // nature feeds isSpotSell, so switching it hides the search drop-down.
                // Without this the spinner keeps turning and stale results come back.
                closeSuggestions()
                // The rate follows 交易性質 as well as the ticker (BUG-091) — but only while the
                // user has not set it themselves. `updateTaxRateAuto` returns early when
                // `taxRateManual` is set, and that early return is the point: changing the
                // classification of a trade is not a request to re-price it, so a rate typed or
                // picked by hand survives (BUG-094). Resetting the flag here used to discard it,
                // which was invisible on a 股票 (both sides land on 0.3%) and plain on an ETF.
                updateTaxRateAuto(ticker, next)
              }}
            >
              <option value="SPOT">{TX_NATURE_LABEL.SPOT}</option>
              <option value="DAY_TRADE">{TX_NATURE_LABEL.DAY_TRADE}</option>
              <option value="MARGIN">{TX_NATURE_LABEL.MARGIN}</option>
              <option value="SHORT">{TX_NATURE_LABEL.SHORT}</option>
            </select>
          </div>
        )}
      </div>

      {dayTradeContext && dayTradeTaxNote && nature === 'DAY_TRADE' && (
        <div className="notice" role="status">
          <span>
            {dayTradeContext.certain
              ? `這檔今天才買進 ${dayTradeContext.sameDayQty.toLocaleString('en-US')} 股、之前沒有庫存，所以這筆已經記成當沖。`
              : '這筆記成當沖了。'}
            {dayTradeTaxNote.labelled}
            {dayTradeTaxNote.manual}
          </span>
          <button type="button" onClick={() => applyDayTrade(false)}>
            改回現股
          </button>
        </div>
      )}
      {dayTradeContext && dayTradeTaxNote && nature === 'SPOT' && (
        <div className="notice" role="status">
          <span>
            今天這檔買進了 {dayTradeContext.sameDayQty.toLocaleString('en-US')} 股。
            {dayTradeTaxNote.offer}
            {dayTradeTaxNote.manual}
          </span>
          <button type="button" onClick={() => applyDayTrade(true)}>
            改成當沖
          </button>
        </div>
      )}

      <div className="field" ref={tickerFieldRef}>
        <label htmlFor="tx-ticker">股票代號（台股 2330 / 美股 AAPL）</label>
        <input
          id="tx-ticker"
          ref={tickerInputRef}
          value={ticker}
          autoComplete="off"
          placeholder={isSpotSell ? '點選或輸入代號（將列出庫存持股）' : '輸入代號會自動帶出名稱'}
          aria-invalid={fieldErrors.ticker ? 'true' : undefined}
          aria-describedby={fieldErrors.ticker ? 'tx-ticker-error' : undefined}
          onFocus={() => {
            if (isSpotSell || isShortCover) setShowTickerHoldings(true)
          }}
          onClick={() => {
            if (isSpotSell || isShortCover) setShowTickerHoldings(true)
          }}
          onChange={(e) => {
            setTicker(e.target.value)
            updateTaxRateAuto(e.target.value)
            if (isSpotSell || isShortCover) setShowTickerHoldings(true)
            if (fieldErrors.ticker) setFieldErrors((prev) => ({ ...prev, ticker: undefined }))
            if (tickerLookupMsg) setTickerLookupMsg(null)
          }}
          onBlur={() => {
            setShowTickerHoldings(false)
            handleTickerBlur()
          }}
        />
        {fieldErrors.ticker && (
          <p id="tx-ticker-error" className="field-error">
            {fieldErrors.ticker}
          </p>
        )}
        {isSpotSell && showTickerHoldings && (
          <div className="suggestions" data-testid="ticker-holdings-dropdown">
            {filteredTickerHoldings.length === 0 ? (
              <div className="suggestion-empty">
                {activeHoldings.length === 0 ? '目前帳戶無持股' : '庫存中無匹配代號'}
              </div>
            ) : (
              filteredTickerHoldings.map((item) => (
                <div
                  key={item.key}
                  className="suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickHolding(item)
                  }}
                >
                  <span>
                    <strong>{item.ticker}</strong> {item.name}
                  </span>
                  <span className="market-tag">
                    庫存 {item.qty.toLocaleString()} 股
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {isShortCover && showTickerHoldings && (
          <div className="suggestions" data-testid="ticker-shorts-dropdown">
            {filteredTickerShorts.length === 0 ? (
              <div className="suggestion-empty">
                {activeShorts.length === 0 ? '目前帳戶無空單' : '空單中無匹配代號'}
              </div>
            ) : (
              filteredTickerShorts.map((item) => (
                <div
                  key={item.key}
                  className="suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickHolding(item)
                  }}
                >
                  <span>
                    <strong>{item.ticker}</strong> {item.name}
                  </span>
                  <span className="market-tag">
                    空單 {item.shortQty.toLocaleString()} 股
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {lookingUp ? (
          <div className="field-hint">
            <Loader2 size={11} className="spin" style={{ verticalAlign: -1, marginRight: 4 }} />
            正在反查名稱…
          </div>
        ) : (
          tickerLookupMsg && <div className="field-hint">{tickerLookupMsg}</div>
        )}
      </div>

      <div className="field" ref={nameFieldRef}>
        <label htmlFor="tx-name">股票名稱</label>
        <input
          id="tx-name"
          value={name}
          autoComplete="off"
          placeholder={isSpotSell ? '點選或輸入名稱（將列出庫存持股）' : '輸入中文名稱可模糊搜尋（如：台積）'}
          onFocus={() => {
            if (isSpotSell) setShowNameHoldings(true)
          }}
          onClick={() => {
            if (isSpotSell) setShowNameHoldings(true)
          }}
          onChange={(e) => {
            if (isSpotSell) {
              setName(e.target.value)
              setShowNameHoldings(true)
            } else {
              handleNameInput(e.target.value)
            }
          }}
          onBlur={() => {
            setShowNameHoldings(false)
          }}
        />
        {isSpotSell && showNameHoldings && (
          <div className="suggestions" data-testid="name-holdings-dropdown">
            {filteredNameHoldings.length === 0 ? (
              <div className="suggestion-empty">
                {activeHoldings.length === 0 ? '目前帳戶無持股' : '庫存中無匹配股票'}
              </div>
            ) : (
              filteredNameHoldings.map((item) => (
                <div
                  key={item.key}
                  className="suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickHolding(item)
                  }}
                >
                  <span>
                    <strong>{item.ticker}</strong> {item.name}
                  </span>
                  <span className="market-tag">
                    庫存 {item.qty.toLocaleString()} 股
                  </span>
                </div>
              ))
            )}
          </div>
        )}
        {!isSpotSell && (searching || suggestions !== null) && (
          <div className="suggestions">
            {searching ? (
              <div
                className="suggestion-loading"
                role="status"
                aria-live="polite"
                data-testid="name-search-loading"
              >
                <Spinner size={12} />
                搜尋中…
              </div>
            ) : suggestions!.length === 0 ? (
              <div className="suggestion-empty">
                無匹配結果
                {!isSupabaseConfigured && '（本機模式僅支援台股搜尋；美股請直接輸入代號）'}
              </div>
            ) : (
              suggestions!.map((item) => (
                <div
                  key={`${item.market}:${item.symbol}`}
                  className="suggestion-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pickSuggestion(item)
                  }}
                >
                  <span>
                    {item.name}（{item.symbol}）
                  </span>
                  <span className="market-tag">{item.market === 'TPE' ? '台股' : '美股'}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <div className="field-row">
        {!isStockDividend && (
          <div className="field">
            <label htmlFor="tx-price">{isCashDividend ? '每股股利' : '交易單價'}</label>
            <input
              id="tx-price"
              ref={priceInputRef}
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={price}
              placeholder="單股價格"
              aria-invalid={fieldErrors.price ? 'true' : undefined}
              aria-describedby={fieldErrors.price ? 'tx-price-error' : undefined}
              onChange={(e) => {
                setPrice(e.target.value)
                if (fieldErrors.price) setFieldErrors((prev) => ({ ...prev, price: undefined }))
              }}
            />
            {fieldErrors.price && (
              <p id="tx-price-error" className="field-error">
                {fieldErrors.price}
              </p>
            )}
          </div>
        )}
        <div className="field tx-qty-field">
          <label htmlFor="tx-qty">{isCashDividend || isStockDividend ? '配發股數' : '交易股數'}</label>
          <div className="field-row">
            <input
              id="tx-qty"
              ref={qtyInputRef}
              type="number"
              inputMode="decimal"
              step="0.001"
              min="0"
              value={qty}
              placeholder="數量"
              aria-invalid={fieldErrors.qty ? 'true' : undefined}
              aria-describedby={fieldErrors.qty ? 'tx-qty-error' : undefined}
              onChange={(e) => {
                setQty(e.target.value)
                if (fieldErrors.qty) setFieldErrors((prev) => ({ ...prev, qty: undefined }))
              }}
            />
            <select
              className="narrow"
              value={unit}
              disabled={market === 'US'}
              aria-label="股數單位"
              onChange={(e) => convertUnit(e.target.value as Unit)}
            >
              <option value="張">張</option>
              <option value="零股">零股</option>
            </select>
          </div>
          {market === 'US' && <div className="field-hint">美股以「股」為單位</div>}
          {fieldErrors.qty && (
            <p id="tx-qty-error" className="field-error">
              {fieldErrors.qty}
            </p>
          )}
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="tx-fee-rate">手續費率</label>
          <input
            id="tx-fee-rate"
            type="number"
            inputMode="decimal"
            step="any"
            min="0"
            value={feeRate}
            onChange={(e) => {
              feeRateManual.current = true
              setFeeRate(e.target.value)
            }}
          />
          {market === 'TPE' && feeRateHint.discount && (
            <span className="fee-rate-hint">{feeRateHint.discount}</span>
          )}
          {market === 'TPE' && feeRateHint.warning && (
            <span className="fee-rate-warning">{feeRateHint.warning}</span>
          )}
          <div className="field-hint" data-testid="fee-rate-hint">
            原價 0.001425、6.5 折 0.00092625、3 折 0.0004275；只套用在這筆交易，不會更動工作區的預設值
          </div>
        </div>
        {market === 'TPE' && (
          <div className="field">
            <label htmlFor="tx-min-fee">最低手續費</label>
            <input
              id="tx-min-fee"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={minFee}
              onChange={(e) => {
                minFeeTyped.current[minFeeUnit] = e.target.value
                setMinFee(e.target.value)
              }}
            />
            <div className="field-hint">
              手續費最低收這麼多（{unit === '張' ? '整股常見 20 元' : '零股常見 1 元'}）；費率填 0 就不套用
            </div>
          </div>
        )}
      </div>

      {showTax && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="tx-tax-rate">證交稅率</label>
            <div className="field-row">
              <input
                id="tx-tax-rate"
                type="number"
                step="any"
                min="0"
                value={taxRate}
                onChange={(e) => {
                  taxRateManual.current = true
                  setTaxRate(e.target.value)
                }}
              />
              <select
                className="narrow-lg"
                aria-label="證交稅率快選"
                value={TAX_PRESET_VALUES.includes(taxRate) ? taxRate : 'custom'}
                onChange={(e) => {
                  if (e.target.value === 'custom') return
                  taxRateManual.current = true
                  setTaxRate(e.target.value)
                }}
              >
                <option value="0.003">一般 0.3%</option>
                <option value="0.001">ETF 0.1%</option>
                <option value="0.0015">股票當沖 0.15%</option>
                <option value="0">免稅 0%</option>
                {!TAX_PRESET_VALUES.includes(taxRate) && <option value="custom">自訂</option>}
              </select>
            </div>
            <div className="field-hint">
              只有台股賣出才收；ETF（00 開頭）自動 0.1%、債券 ETF（B 結尾）免稅。當沖降稅只適用股票（0.15%），ETF 當沖仍是 0.1%
            </div>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="tx-fee">
          {isCashDividend
            ? '代扣費用（二代健保、匯費）'
            : isStockDividend
              ? '相關費用'
              : `手續費 / 稅金${showTax ? '（賣出自動含證交稅）' : ''}`}
        </label>
        <input
          id="tx-fee"
          type="number"
          step="any"
          min="0"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
        />
        {isEdit && initial && parseFloat(fee) !== initial.fee_tax && (
          <div className="field-hint">
            已依目前費率重算；原本是 {initial.fee_tax}{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => setFee(String(initial.fee_tax))}
            >
              還原原紀錄
            </button>
          </div>
        )}
        {dividendWithholding && (
          <div className="field-hint">
            {dividendWithholding.belowThreshold ? (
              <>
                配息總額 {dividendWithholding.gross.toLocaleString('en-US')} 未達{' '}
                {dividendWithholding.threshold.toLocaleString('en-US')} 元起扣點，不用扣二代健保，上面是匯費{' '}
                {dividendWithholding.wire}
              </>
            ) : (
              <>
                配息總額 {dividendWithholding.gross.toLocaleString('en-US')}，上面是估二代健保{' '}
                {dividendWithholding.nhi.toLocaleString('en-US')} ＋ 匯費 {dividendWithholding.wire} ＝{' '}
                {dividendWithholding.total.toLocaleString('en-US')}
              </>
            )}
            <br />
            這是估算值，和券商的股利通知書不同時直接改上面的數字；改每股股利或股數會重新估算。
          </div>
        )}
      </div>

      <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
        {busy ? '寫入中…' : isEdit ? '儲存變更' : '確認送出'}
      </button>
    </form>
  )
}
