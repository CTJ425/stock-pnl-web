/**
 * 移動平均成本法損益計算引擎
 *
 * 移植自 GAS 版 code.gs 的 computeLedger_，逐筆掃描交易並維護：
 * - 各股票目前部位（持股數、部位成本、歷史累計買入成本、已實現損益）
 * - 各年度彙整（已實現損益、買賣總額、手續費、筆數、個股明細）
 * - 資料異常警告（超賣：超賣部分成本以 0 計算，與 GAS 版同構）
 *
 * 與 GAS 版差異：幣別由 market 欄位判斷（'TPE' → TWD、'US' → USD），
 * 不再依賴 ticker 的 'TPE:' 前綴。
 */
import type { Currency, Market, Transaction } from '../types/models'
import { marketCurrency, positionKey } from '../types/models'

export interface Position {
  key: string
  ticker: string
  name: string
  market: Market
  currency: Currency
  /** 目前持有股數 */
  qty: number
  /** 目前部位成本（移動平均） */
  cost: number
  /** 歷史累計買入成本（報酬率分母） */
  buyCostTotal: number
  /** 累計已實現損益 */
  realized: number
}

export interface Holding extends Position {
  /** 平均買入成本（cost / qty） */
  avgCost: number
}

export interface YearTickerDetail {
  key: string
  ticker: string
  name: string
  market: Market
  currency: Currency
  buyAmt: number
  sellAmt: number
  realized: number
  fees: number
  count: number
}

export interface YearSummary {
  year: number
  realizedTw: number
  realizedUs: number
  buyAmt: number
  sellAmt: number
  fees: number
  count: number
  tickers: Record<string, YearTickerDetail>
}

export interface LedgerSummary {
  /** 台股歷史累計已實現損益 (TWD) */
  realizedTw: number
  /** 美股歷史累計已實現損益 (USD) */
  realizedUs: number
  /** 歷史累計手續費（幣別混計，與 GAS 版 KPI 同構） */
  fees: number
  /** 歷史累計交易筆數 */
  count: number
}

export interface Ledger {
  positions: Record<string, Position>
  /** position key 依首次出現順序 */
  order: string[]
  /** 目前持有股數 > 0 的個股，台股在前、代號排序（與 Dashboard 同構） */
  holdings: Holding[]
  yearly: Record<number, YearSummary>
  /** 有交易的年度（遞增） */
  years: number[]
  summary: LedgerSummary
  warnings: string[]
}

/** 台股賣出證交稅率：一般股票 0.3%，代號 00 開頭的 ETF 為 0.1% */
export function sellTaxRate(ticker: string): number {
  return ticker.startsWith('00') ? 0.001 : 0.003
}

/** 先修掉二進位浮點誤差（如 114 誤存成 113.99999999999999）再捨去到元 */
export function floorSafe(value: number): number {
  return Math.floor(Math.round(value * 1e6) / 1e6)
}

export function computeLedger(transactions: Transaction[]): Ledger {
  const ledger: Ledger = {
    positions: {},
    order: [],
    holdings: [],
    yearly: {},
    years: [],
    summary: { realizedTw: 0, realizedUs: 0, fees: 0, count: 0 },
    warnings: [],
  }

  // 依日期排序；同日依建立時間（等同 GAS 版的輸入列順序）
  const txs = transactions
    .filter((tx) => tx.qty > 0 && (tx.tx_type === 'BUY' || tx.tx_type === 'SELL'))
    .slice()
    .sort(
      (a, b) =>
        a.tx_date.localeCompare(b.tx_date) || a.created_at.localeCompare(b.created_at),
    )

  for (const tx of txs) {
    const year = Number(tx.tx_date.slice(0, 4))
    const currency = marketCurrency(tx.market)
    const key = positionKey(tx.market, tx.ticker)

    if (!ledger.yearly[year]) {
      ledger.yearly[year] = {
        year,
        realizedTw: 0,
        realizedUs: 0,
        buyAmt: 0,
        sellAmt: 0,
        fees: 0,
        count: 0,
        tickers: {},
      }
    }
    const y = ledger.yearly[year]

    if (!ledger.positions[key]) {
      ledger.positions[key] = {
        key,
        ticker: tx.ticker,
        name: tx.name || tx.ticker,
        market: tx.market,
        currency,
        qty: 0,
        cost: 0,
        buyCostTotal: 0,
        realized: 0,
      }
      ledger.order.push(key)
    }
    const pos = ledger.positions[key]
    if (tx.name) pos.name = tx.name

    if (!y.tickers[key]) {
      y.tickers[key] = {
        key,
        ticker: tx.ticker,
        name: tx.name || tx.ticker,
        market: tx.market,
        currency,
        buyAmt: 0,
        sellAmt: 0,
        realized: 0,
        fees: 0,
        count: 0,
      }
    }
    const yt = y.tickers[key]
    if (tx.name) yt.name = tx.name

    y.count++
    y.fees += tx.fee_tax
    yt.count++
    yt.fees += tx.fee_tax

    if (tx.tx_type === 'BUY') {
      const totalCost = tx.price * tx.qty + tx.fee_tax // 手續費計入成本
      y.buyAmt += totalCost
      yt.buyAmt += totalCost
      pos.cost += totalCost
      pos.qty += tx.qty
      pos.buyCostTotal += totalCost
    } else {
      const revenue = tx.price * tx.qty - tx.fee_tax
      y.sellAmt += revenue
      yt.sellAmt += revenue

      const avgCost = pos.qty > 0 ? pos.cost / pos.qty : 0
      const matchedQty = Math.min(tx.qty, pos.qty)
      if (matchedQty < tx.qty) {
        ledger.warnings.push(
          `${tx.tx_date} ${tx.ticker} 賣出 ${tx.qty} 股，但當時持有僅 ${pos.qty} 股（超賣部分成本以 0 計算）`,
        )
      }
      const costBasis = avgCost * matchedQty
      const realized = revenue - costBasis
      pos.cost -= costBasis
      pos.qty -= matchedQty
      pos.realized += realized
      yt.realized += realized

      if (currency === 'TWD') y.realizedTw += realized
      else y.realizedUs += realized
    }
  }

  ledger.years = Object.keys(ledger.yearly)
    .map(Number)
    .sort((a, b) => a - b)

  for (const key of ledger.order) {
    const pos = ledger.positions[key]
    if (pos.currency === 'TWD') ledger.summary.realizedTw += pos.realized
    else ledger.summary.realizedUs += pos.realized
  }
  for (const year of ledger.years) {
    ledger.summary.fees += ledger.yearly[year].fees
    ledger.summary.count += ledger.yearly[year].count
  }

  ledger.holdings = ledger.order
    .map((key) => ledger.positions[key])
    .filter((pos) => pos.qty > 0)
    .map((pos) => ({ ...pos, avgCost: pos.cost / pos.qty }))
    .sort((a, b) => {
      if (a.currency !== b.currency) return a.currency === 'TWD' ? -1 : 1
      return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0
    })

  return ledger
}

/**
 * 以現價估算單一持股的「淨未實現損益」（與 GAS 版 Dashboard 公式同構）：
 * - 台股：扣除預估賣出手續費與證交稅（分項 floor 捨去到元），最外層 round 收整浮點尾數
 * - 美股：市值 - 成本，不預扣
 */
export function estimateUnrealized(holding: Holding, price: number, feeRate: number): number {
  const mktVal = price * holding.qty
  if (holding.currency === 'TWD') {
    return Math.round(
      mktVal -
        holding.qty * holding.avgCost -
        floorSafe(mktVal * feeRate) -
        floorSafe(mktVal * sellTaxRate(holding.ticker)),
    )
  }
  return mktVal - holding.qty * holding.avgCost
}
