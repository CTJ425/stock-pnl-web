/**
 * 交易輸入表單（移植自 GAS 版 Sidebar.html）：
 * - 代號失焦自動反查名稱與市場；名稱輸入防抖模糊搜尋下拉
 * - 台股股數可依「張 / 零股」切換並自動換算（美股鎖定零股）
 * - 手續費自動估算：台股元以下捨去、賣出加計證交稅（ETF 00 開頭 0.1%）
 * - 寫入失敗保留所有輸入內容
 * - 傳入 initial 即為「編輯模式」：帶入既有交易內容，成功後不清空欄位；
 *   手續費開啟時即依目前費率重新估算（舊資料可能登錄錯誤），可一鍵還原原紀錄
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { useWorkspace } from '../../context/WorkspaceContext'
import type { Market, NewTransaction, Transaction, TxType } from '../../types/models'
import { calculateFee } from '../../utils/fees'
import { sellTaxRate } from '../../utils/pnlEngine'
import {
  getFeeRate,
  getMinFee,
  setFeeRate as persistFeeRate,
  setMinFee as persistMinFee,
} from '../../utils/settings'
import type { StockSearchResult } from '../../services/stockSearch'
import { lookupTicker, searchStocks } from '../../services/stockSearch'
import { isSupabaseConfigured } from '../../services/supabase'

type Unit = '張' | '零股'

/** 證交稅率快選值（一般 / ETF / 當沖減半 / 免稅） */
const TAX_PRESET_VALUES = ['0.003', '0.001', '0.0015', '0']

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface TransactionFormProps {
  onSubmit: (tx: NewTransaction) => Promise<void>
  onDone?: () => void
  /** 編輯模式：帶入既有交易內容 */
  initial?: Transaction
}

export function TransactionForm({ onSubmit, onDone, initial }: TransactionFormProps) {
  const { current } = useWorkspace()
  const workspaceId = current?.id
  const isEdit = Boolean(initial)
  const [date, setDate] = useState(initial?.tx_date ?? todayStr)
  const [market, setMarket] = useState<Market>(initial?.market ?? 'TPE')
  const [txType, setTxType] = useState<TxType>(initial?.tx_type ?? 'BUY')
  const [ticker, setTicker] = useState(initial?.ticker ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [price, setPrice] = useState(initial ? String(initial.price) : '')
  const [qty, setQty] = useState(initial ? String(initial.qty) : '')
  // 編輯模式以「零股」顯示原始股數，避免張/零股換算歧義
  const [unit, setUnit] = useState<Unit>(initial ? '零股' : '張')
  const [feeRate, setFeeRate] = useState(() => String(getFeeRate(workspaceId)))
  const minFeeUnit = unit === '張' ? 'whole' : 'odd'
  const [minFee, setMinFee] = useState(() => String(getMinFee(minFeeUnit, workspaceId)))

  // 切換工作區 / 整股零股單位時帶入對應記憶的費率與最低手續費
  useEffect(() => {
    setFeeRate(String(getFeeRate(workspaceId)))
  }, [workspaceId])
  useEffect(() => {
    setMinFee(String(getMinFee(minFeeUnit, workspaceId)))
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
  // 編輯模式下原代號視為已反查過，避免失焦時覆寫使用者自訂的名稱
  const lastSearchedTicker = useRef(initial?.ticker ?? '')
  const searchSeq = useRef(0)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suggestionsRef = useRef<HTMLDivElement | null>(null)

  const getActualShares = useCallback((): number => {
    const val = parseFloat(qty) || 0
    if (unit === '張') return Math.round(val * 1000)
    return market === 'TPE' ? Math.round(val) : val
  }, [qty, unit, market])

  // 證交稅率欄位：未手動修改時依代號自動帶入（ETF 00 開頭 0.1%）
  const updateTaxRateAuto = useCallback(
    (nextTicker: string) => {
      if (taxRateManual.current) return
      const clean = nextTicker.trim().toUpperCase().replace(/^TPE:/, '')
      setTaxRate(String(sellTaxRate(clean)))
    },
    [],
  )

  // 自動換算手續費（開啟與依賴變動時皆重算；使用者仍可手動修改欄位值）。
  // 編輯模式也照算：舊資料的手續費可能登錄錯誤，開啟時即依目前費率重新估算，
  // 欄位下方提供「還原原紀錄」可改回原值
  useEffect(() => {
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

  // 市場切換：美股強制「零股」單位
  const handleMarketChange = (next: Market) => {
    setMarket(next)
    if (next === 'US' && unit === '張') {
      convertUnit('零股')
    }
  }

  // 單位切換時換算股數（張 = 1000 股）
  const convertUnit = (next: Unit) => {
    const val = parseFloat(qty)
    if (!Number.isNaN(val)) {
      if (unit === '張' && next === '零股') setQty(String(Math.round(val * 1000)))
      else if (unit === '零股' && next === '張') setQty(String(parseFloat((val / 1000).toFixed(3))))
    }
    setUnit(next)
  }

  // 代號失焦 → 反查名稱與市場
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

  // 名稱輸入 → 防抖模糊搜尋（searchSeq 丟棄過期回應）
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

  // 點擊表單其它區域時收合下拉
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
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
        price: p,
        qty: shares,
        fee_tax: feeVal,
      })
      if (isEdit) {
        // 編輯模式：保留內容、直接交由呼叫端關閉視窗
        onDone?.()
        return
      }
      // 成功：保留日期 / 市場 / 類型，清空個股相關欄位（與 GAS 版同構）
      setTicker('')
      setName('')
      setPrice('')
      setQty('')
      setFee('0')
      lastSearchedTicker.current = ''
      taxRateManual.current = false
      setTaxRate('0.003')
      setMessage({ kind: 'ok', text: '🎉 成功新增交易紀錄，Dashboard 與年度收益已同步更新！' })
      onDone?.()
    } catch (err) {
      // 失敗：保留所有輸入內容
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
          <select id="tx-type" value={txType} onChange={(e) => setTxType(e.target.value as TxType)}>
            <option value="BUY">買入</option>
            <option value="SELL">賣出</option>
          </select>
        </div>
      </div>

      <div className="field">
        <label htmlFor="tx-ticker">股票代號（台股 2330 / 美股 AAPL）</label>
        <input
          id="tx-ticker"
          value={ticker}
          autoComplete="off"
          placeholder="輸入代號會自動帶出名稱"
          onChange={(e) => {
            setTicker(e.target.value)
            updateTaxRateAuto(e.target.value)
          }}
          onBlur={handleTickerBlur}
        />
        {lookingUp && (
          <div className="field-hint">
            <Loader2 size={11} className="spin" style={{ verticalAlign: -1, marginRight: 4 }} />
            正在反查名稱…
          </div>
        )}
      </div>

      <div className="field" ref={suggestionsRef}>
        <label htmlFor="tx-name">股票名稱</label>
        <input
          id="tx-name"
          value={name}
          autoComplete="off"
          placeholder="輸入中文名稱可模糊搜尋（如：台積）"
          onChange={(e) => handleNameInput(e.target.value)}
        />
        {suggestions !== null && (
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
                  onClick={() => pickSuggestion(item)}
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
              const rate = parseFloat(e.target.value)
              if (Number.isFinite(rate)) persistFeeRate(rate, workspaceId)
            }}
          />
          <div className="field-hint">
            台股標準是 0.001425；填了會記成「{current?.name ?? '目前'}」工作區的預設值
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
                setMinFee(e.target.value)
                const val = parseFloat(e.target.value)
                if (Number.isFinite(val)) persistMinFee(minFeeUnit, val, workspaceId)
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
