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
import { useWorkspace } from '../../context/WorkspaceContext'
import type { Market, NewTransaction, Transaction, TxNature, TxType } from '../../types/models'
import { TX_NATURE_LABEL } from '../../types/models'
import { calculateFee, inferFeeRate } from '../../utils/fees'
import type { Holding } from '../../utils/pnlEngine'
import { sellTaxRate } from '../../utils/pnlEngine'
import { getFeeRate, getMinFee } from '../../utils/settings'
import type { StockSearchResult } from '../../services/stockSearch'
import { lookupTicker, searchStocks } from '../../services/stockSearch'
import { isSupabaseConfigured } from '../../services/supabase'

type Unit = '張' | '零股'

/** Securities tax rate quick selection value (general/ETF/halved/tax-free)*/
const TAX_PRESET_VALUES = ['0.003', '0.001', '0.0015', '0']

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface TransactionFormProps {
  onSubmit: (tx: NewTransaction) => Promise<void>
  onDone?: () => void
  /** Edit mode: bring in existing transaction content*/
  initial?: Transaction
}

export function TransactionForm({ onSubmit, onDone, initial }: TransactionFormProps) {
  const { current, ledger } = useWorkspace()
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
    const defaultRate = getFeeRate(workspaceId)
    if (initial) {
      const minFees = { whole: getMinFee('whole', workspaceId), odd: getMinFee('odd', workspaceId) }
      return String(inferFeeRate(initial, defaultRate, minFees))
    }
    return String(defaultRate)
  })
  const minFeeUnit = unit === '張' ? 'whole' : 'odd'
  const [minFee, setMinFee] = useState(() => String(getMinFee(minFeeUnit, workspaceId)))

  // When switching workspaces/whole shares or odd units, the corresponding memorized rates and minimum handling fees are brought in
  useEffect(() => {
    if (isEdit) return
    setFeeRate(String(getFeeRate(workspaceId)))
  }, [workspaceId, isEdit])
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
  const [taxRate, setTaxRate] = useState(() =>
    initial ? String(sellTaxRate(initial.ticker)) : '0.003',
  )
  const [fee, setFee] = useState(initial ? String(initial.fee_tax) : '0')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  const [suggestions, setSuggestions] = useState<StockSearchResult[] | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  const taxRateManual = useRef(false)

  const activeHoldings = useMemo(
    () => ledger.holdings.filter((h) => h.qty > 0 && h.market === market),
    [ledger.holdings, market],
  )
  const isSpotSell = txType === 'SELL' && (market !== 'TPE' || nature === 'SPOT')

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
    setSuggestions(null)
  }

  // In edit mode the saved fee/tax stands until the user changes a core input.
  // A "skip the first run" flag is not enough: StrictMode invokes an effect twice on
  // mount (main.tsx wraps App), and the second pass would consume the flag and overwrite
  // anyway. Comparing the inputs against their initial values gives the same answer
  // however many times the effect runs. Cleared for good on the first real change, so
  // typing a value back to its original still recalculates.
  const untouchedFeeSig = useRef<string | null>(
    initial ? [price, qty, unit, feeRate, taxRate, minFee, market, txType].join('|') : null,
  )
  // Per-unit record of user-typed 最低手續費, so a value typed under one unit survives switching to the other and back.
  const minFeeTyped = useRef<Partial<Record<'whole' | 'odd', string>>>({})
  const minFeeWorkspaceRef = useRef(workspaceId)
  // In edit mode, the original codename is considered to have been reverse-checked to avoid overwriting the user-defined name when out of focus.
  const lastSearchedTicker = useRef(initial?.ticker ?? '')
  const searchSeq = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const getActualShares = useCallback((): number => {
    const val = parseFloat(qty) || 0
    if (unit === '張') return Math.round(val * 1000)
    return market === 'TPE' ? Math.round(val) : val
  }, [qty, unit, market])

  // Securities tax rate field: automatically brought in according to the code if not manually modified (0.1% starting with ETF 00)
  const updateTaxRateAuto = useCallback(
    (nextTicker: string) => {
      if (taxRateManual.current) return
      const clean = nextTicker.trim().toUpperCase().replace(/^TPE:/, '')
      setTaxRate(String(sellTaxRate(clean)))
    },
    [],
  )

  // Automatic conversion of handling fees (recalculated when enabled and dependent on changes; users can still manually modify field values).
  // Edit mode no longer re-estimates on open: the initial mount keeps `initial.fee_tax` as-is,
  // and recalculation only kicks in once the user actually changes a core input below.
  // "Restore original record" is provided below the field to change it back to the original value.
  useEffect(() => {
    const sig = [price, qty, unit, feeRate, taxRate, minFee, market, txType].join('|')
    if (untouchedFeeSig.current !== null) {
      if (untouchedFeeSig.current === sig) return
      untouchedFeeSig.current = null
    }
    const p = parseFloat(price) || 0
    const shares = getActualShares()
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
      })
      setFee(String(calculated))
    }
  }, [price, qty, unit, feeRate, taxRate, minFee, market, txType, getActualShares])

  // Market Switch: U.S. Stocks Mandate “Odd Lot” Units
  const handleMarketChange = (next: Market) => {
    setMarket(next)
    setShowTickerHoldings(false)
    setShowNameHoldings(false)
    setSuggestions(null)
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
      }
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
      return
    }
    searchTimer.current = setTimeout(async () => {
      const mySeq = ++searchSeq.current
      const results = await searchStocks(query)
      if (mySeq !== searchSeq.current) return
      setSuggestions(results)
    }, 300)
  }

  const pickSuggestion = (item: StockSearchResult) => {
    setName(item.name)
    setTicker(item.symbol)
    if (item.market !== market) handleMarketChange(item.market)
    lastSearchedTicker.current = item.symbol
    updateTaxRateAuto(item.symbol)
    setSuggestions(null)
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
        setSuggestions(null)
      }
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)

    const p = parseFloat(price)
    const shares = getActualShares()
    const feeVal = parseFloat(fee) || 0
    const cleanTicker = ticker.trim().toUpperCase().replace(/^TPE:/, '')

    if (!cleanTicker || !(p > 0) || !(shares > 0)) {
      setMessage({ kind: 'error', text: '請填寫代號、單價與股數（皆須為正數）' })
      return
    }
    if (feeVal < 0) {
      setMessage({ kind: 'error', text: '手續費 / 稅金不可為負數' })
      return
    }

    setBusy(true)
    try {
      await onSubmit({
        tx_date: date,
        market,
        ticker: cleanTicker,
        name: name.trim() || cleanTicker,
        tx_type: txType,
        tx_nature: market === 'TPE' ? nature : undefined,
        fee_rate: feeRate !== '' && !Number.isNaN(parseFloat(feeRate)) ? parseFloat(feeRate) : undefined,
        price: p,
        qty: shares,
        fee_tax: feeVal,
      })
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
              setSuggestions(null)
            }}
          >
            <option value="BUY">買入</option>
            <option value="SELL">賣出</option>
          </select>
        </div>
        {market === 'TPE' && (
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
                // 當沖 is what a user sets the tax rate preset to by hand today; keep it in sync.
                if (next === 'DAY_TRADE') {
                  taxRateManual.current = true
                  setTaxRate('0.0015')
                }
              }}
            >
              <option value="SPOT">{TX_NATURE_LABEL.SPOT}</option>
              <option value="DAY_TRADE">{TX_NATURE_LABEL.DAY_TRADE}</option>
              <option value="MARGIN">{TX_NATURE_LABEL.MARGIN}</option>
            </select>
          </div>
        )}
      </div>

      <div className="field" ref={tickerFieldRef}>
        <label htmlFor="tx-ticker">股票代號（台股 2330 / 美股 AAPL）</label>
        <input
          id="tx-ticker"
          value={ticker}
          autoComplete="off"
          placeholder={isSpotSell ? '點選或輸入代號（將列出庫存持股）' : '輸入代號會自動帶出名稱'}
          onFocus={() => {
            if (isSpotSell) setShowTickerHoldings(true)
          }}
          onClick={() => {
            if (isSpotSell) setShowTickerHoldings(true)
          }}
          onChange={(e) => {
            setTicker(e.target.value)
            updateTaxRateAuto(e.target.value)
            if (isSpotSell) setShowTickerHoldings(true)
          }}
          onBlur={() => {
            setShowTickerHoldings(false)
            handleTickerBlur()
          }}
        />
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
        {lookingUp && (
          <div className="field-hint">
            <Loader2 size={11} className="spin" style={{ verticalAlign: -1, marginRight: 4 }} />
            正在反查名稱…
          </div>
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
        {!isSpotSell && suggestions !== null && (
          <div className="suggestions">
            {suggestions.length === 0 ? (
              <div className="suggestion-empty">
                無匹配結果
                {!isSupabaseConfigured && '（本機模式僅支援台股搜尋；美股請直接輸入代號）'}
              </div>
            ) : (
              suggestions.map((item) => (
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
        <div className="field">
          <label htmlFor="tx-price">交易單價</label>
          <input
            id="tx-price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            placeholder="單股價格"
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="tx-qty">交易股數</label>
          <div className="field-row">
            <input
              id="tx-qty"
              type="number"
              step="0.001"
              min="0"
              value={qty}
              placeholder="數量"
              onChange={(e) => setQty(e.target.value)}
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
        </div>
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="tx-fee-rate">手續費率</label>
          <input
            id="tx-fee-rate"
            type="number"
            step="any"
            min="0"
            value={feeRate}
            onChange={(e) => {
              setFeeRate(e.target.value)
            }}
          />
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
                <option value="0.0015">當沖 0.15%</option>
                <option value="0">免稅 0%</option>
                {!TAX_PRESET_VALUES.includes(taxRate) && <option value="custom">自訂</option>}
              </select>
            </div>
            <div className="field-hint">
              只有台股賣出才收；ETF（00 開頭）自動 0.1%、債券 ETF（B 結尾）免稅
            </div>
          </div>
        </div>
      )}

      <div className="field">
        <label htmlFor="tx-fee">手續費 / 稅金{showTax && '（賣出自動含證交稅）'}</label>
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
      </div>

      <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
        {busy ? '寫入中…' : isEdit ? '儲存變更' : '確認送出'}
      </button>
    </form>
  )
}
