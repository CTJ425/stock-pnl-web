import { describe, it, expect } from 'vitest'
import { buildHoldingRows } from './holdingRows'
import { computeLedger } from './pnlEngine'
import type { PriceMap } from '../services/priceProxy'
import type { Transaction } from '../types/models'

/** Quotation for testing: only price / prevClose / stale are meaningful, the rest are fields required by the type*/
const quote = (price: number, stale = false, prevClose: number | null = null): PriceMap[string] => ({
  price,
  prevClose,
  open: null,
  high: null,
  low: null,
  volume: null,
  tradeDate: null,
  tradeTime: null,
  trial: false,
  asOf: '2026-07-25T12:00:00.000Z',
  source: stale ? 'cache' : 'edge',
  stale,
})

let seq = 0
function tx(p: Partial<Transaction>): Transaction {
  seq += 1
  return {
    id: `t${seq}`,
    workspace_id: 'ws',
    tx_date: '2026-03-02',
    market: 'TPE',
    ticker: '2330',
    name: '台積電',
    tx_type: 'BUY',
    price: 100,
    qty: 1000,
    fee_tax: 20,
    created_at: '2026-03-02T01:00:00.000Z',
    ...p,
  }
}

const holdingsOf = (txs: Transaction[]) => computeLedger(txs).holdings

describe('buildHoldingRows', () => {
  it('有現價時算出市值、參考淨值 (netMktVal)、未實現淨損益與報酬率', () => {
    const holdings = holdingsOf([tx({ price: 100, qty: 1000, fee_tax: 142 })])
    const [row] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(row.mktVal).toBe(120000)
    expect(row.unrealized).not.toBeNull()
    // Taiwan stocks withhold selling fees and securities taxes, so the net profit or loss must be less than the pure price difference
    expect(row.unrealized!).toBeLessThan(row.rawUnrealized!)
    expect(row.roi).toBeCloseTo(row.unrealized! / row.holding.cost, 10)
    expect(row.priceStale).toBe(false)
    // 參考淨值 = cost + unrealized = mktVal - sellFee - sellTax
    expect(row.netMktVal).not.toBeNull()
    expect(row.netMktVal).toBe(row.holding.cost + row.unrealized!)
    expect(row.netMktVal!).toBeLessThan(row.mktVal!)
    // 牌告費率時 brokerRoi 等於 roi
    expect(row.brokerRoi).toBeCloseTo(row.roi!, 10)
  })

  it('有手續費折讓（如 3 折）時，brokerRoi 依牌告 0.1425% 預扣計算，精確反映券商 APP 口徑差額', () => {
    // 買進 1000 股 @135.5，現價 125 (如聯電 2303)
    const holdings = holdingsOf([tx({ ticker: '2303', name: '聯電', price: 135.5, qty: 1000, fee_tax: 58 })])
    // 設定 3 折 (0.0004275)
    const [row] = buildHoldingRows(holdings, { 'TPE:2303': quote(125) }, 0.0004275)
    expect(row.roi).not.toBeNull()
    expect(row.brokerRoi).not.toBeNull()
    expect(row.brokerUnrealized).not.toBeNull()
    // 專案淨損益高於券商 APP 未折讓損益（券商 APP 牌告手續費 178 元 vs 3 折 53 元，多扣 125 元）
    expect(row.unrealized!).toBeGreaterThan(row.brokerUnrealized!)
    expect(row.unrealized! - row.brokerUnrealized!).toBe(125)
    // 專案淨報酬率高於券商 APP 未折讓報酬率（券商 APP 多扣約 0.10% 賣出手續費）
    expect(row.roi!).toBeGreaterThan(row.brokerRoi!)
    const diff = (row.roi! - row.brokerRoi!) * 100
    // 0.1425% - 0.04275% = 0.09975% ≈ 0.10%
    expect(diff).toBeCloseTo(0.10, 1)
  })

  it('無現價時市值 / 參考淨值 / 未實現 / 報酬率皆為 null（不以 0 冒充）', () => {
    const holdings = holdingsOf([tx({})])
    const [row] = buildHoldingRows(holdings, {}, 0.001425)
    expect(row.price).toBeNull()
    expect(row.mktVal).toBeNull()
    expect(row.netMktVal).toBeNull()
    expect(row.unrealized).toBeNull()
    expect(row.rawUnrealized).toBeNull()
    expect(row.roi).toBeNull()
    // The breakeven price does not require the current price, it can still be calculated.
    expect(row.breakEven).toBeGreaterThan(0)
  })

  it('dayChange 為現價與昨收的差；報價沒帶昨收時為 null（不以 0 冒充平盤）', () => {
    const holdings = holdingsOf([tx({})])
    const [up] = buildHoldingRows(holdings, { 'TPE:2330': quote(120, false, 118) }, 0.001425)
    expect(up.dayChange).toBeCloseTo(2, 10)
    const [down] = buildHoldingRows(holdings, { 'TPE:2330': quote(120, false, 125) }, 0.001425)
    expect(down.dayChange).toBeCloseTo(-5, 10)
    const [unknown] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(unknown.dayChange).toBeNull()
  })

  it('帶出快取價的 stale 旗標', () => {
    const holdings = holdingsOf([tx({})])
    const [row] = buildHoldingRows(holdings, { 'TPE:2330': quote(120, true) }, 0.001425)
    expect(row.priceStale).toBe(true)
  })

  it('零股（<1000 股）與整股套用不同的台股最低手續費', () => {
    const odd = holdingsOf([tx({ ticker: '2330', qty: 100, price: 100, fee_tax: 1 })])
    const whole = holdingsOf([tx({ ticker: '2330', qty: 1000, price: 100, fee_tax: 20 })])
    const prices: PriceMap = { 'TPE:2330': quote(100) }
    const [oddRow] = buildHoldingRows(odd, prices, 0.001425)
    const [wholeRow] = buildHoldingRows(whole, prices, 0.001425)
    // Both have withheld selling costs, so the net unrealized gains and losses are negative; the absolute amount of the entire stock is larger (the position is 10 times larger)
    expect(oddRow.unrealized!).toBeLessThan(0)
    expect(wholeRow.unrealized!).toBeLessThan(oddRow.unrealized!)
  })

  it('美股不套用最低手續費、也不預扣賣出費用（淨損益＝純價差）', () => {
    const holdings = holdingsOf([
      tx({ market: 'US', ticker: 'AAPL', name: 'Apple Inc.', price: 100, qty: 10, fee_tax: 0 }),
    ])
    const [row] = buildHoldingRows(holdings, { 'US:AAPL': quote(120) }, 0.001425)
    expect(row.holding.currency).toBe('USD')
    expect(row.unrealized).toBe(row.rawUnrealized)
  })

  it('試撮價的標記要帶到列上，未實現損益是用它算的（0.6.42，AUDIT-01）', () => {
    /*
      During 08:30–09:00 and 13:25–13:30 the price is the indicative auction estimate —— nothing traded at it.
      The quote card had always said 「試撮中」 while the dashboard computed 未實現淨損益 from the same number and
      said nothing, so the flag has to reach the row for the table to be able to mark it.
    */
    const holdings = holdingsOf([tx({ ticker: '2330', qty: 1000, price: 100, fee_tax: 20 })])
    const trialQuote = { ...quote(120), trial: true, tradeTime: '08:45:00' }
    const [row] = buildHoldingRows(holdings, { 'TPE:2330': trialQuote }, 0.001425)
    expect(row.trial).toBe(true)
    expect(row.price).toBe(120)
    // Ordinary quotes must not be marked, or the badge means nothing
    const [plain] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(plain.trial).toBe(false)
  })

  it('空持股回空陣列', () => {
    expect(buildHoldingRows([], {}, 0.001425)).toEqual([])
  })
})

describe('buildHoldingRows — 融券空單（Task 141 Stage B）', () => {
  // 2603 一般股。1000 股 @100 融券賣出：手續費 142 + 稅 300 + 借券費 80 = 522；淨收 99478
  const openShort = () =>
    tx({ ticker: '2603', name: '長榮', tx_type: 'SELL', price: 100, qty: 1000, fee_tax: 522, tx_nature: 'SHORT' })

  it('純空單只產出一列 SHORT，市值是買回成本，未實現在價跌時為正', () => {
    const rows = buildHoldingRows(holdingsOf([openShort()]), { 'TPE:2603': quote(95) }, 0.001425)
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.direction).toBe('SHORT')
    expect(r.rowKey).toBe('TPE:2603:SHORT')
    expect(r.rowQty).toBe(-1000)
    expect(r.mktVal).toBe(95_000)
    expect(r.netMktVal).toBeNull()
    // 99478 − (95000 + 手續費 135) = 4343
    expect(r.unrealized).toBe(4343)
    expect(r.rawUnrealized).toBe(100_000 - 95_000)
    expect(r.roi).toBeCloseTo(4343 / 99_478, 9)
    expect(r.breakEven).toBeGreaterThan(0)
  })

  it('同一檔同時有波段持股與空單時產出兩列，多頭列的數字不變', () => {
    const rows = buildHoldingRows(
      holdingsOf([
        tx({ tx_date: '2026-03-01', ticker: '2603', name: '長榮', tx_type: 'BUY', price: 90, qty: 1000, fee_tax: 128 }),
        openShort(),
      ]),
      { 'TPE:2603': quote(95) },
      0.001425,
    )
    expect(rows.map((r) => r.direction)).toEqual(['LONG', 'SHORT'])
    expect(rows[0].rowQty).toBe(1000)
    expect(rows[0].rowKey).toBe('TPE:2603:LONG')
    expect(rows[0].mktVal).toBe(95_000)
    expect(rows[1].rowQty).toBe(-1000)
    // 兩列的 rowKey 必須相異，否則 React 會重複 key
    expect(rows[0].rowKey).not.toBe(rows[1].rowKey)
  })

  it('沒有現價時空單列的金額欄位為 null，方向與股數仍要有', () => {
    const rows = buildHoldingRows(holdingsOf([openShort()]), {}, 0.001425)
    expect(rows).toHaveLength(1)
    expect(rows[0].direction).toBe('SHORT')
    expect(rows[0].rowQty).toBe(-1000)
    expect(rows[0].mktVal).toBeNull()
    expect(rows[0].unrealized).toBeNull()
    expect(rows[0].roi).toBeNull()
  })

  it('既有的純多頭部位仍然只產出一列 LONG', () => {
    const rows = buildHoldingRows(holdingsOf([tx({})]), { 'TPE:2330': quote(110) }, 0.001425)
    expect(rows).toHaveLength(1)
    expect(rows[0].direction).toBe('LONG')
    expect(rows[0].rowQty).toBe(1000)
  })
})

/**
 * BUG-087. The broker app estimates a lot bought **today** at the halved 現股當沖 securities tax;
 * the numbers below are the real PROD case that found it (6560 欣普羅, bought 2026-09-29 at
 * 32.6 × 1000 with fee 46, close 32.40) plus the 2026-09-30 follow-up at 32.2 that confirmed the
 * broker goes back to 0.3% overnight.
 */
describe('buildHoldingRows — 當日買進的券商口徑用當沖稅率（BUG-087）', () => {
  const sameDay = () =>
    holdingsOf([tx({ tx_date: '2026-09-29', ticker: '6560', name: '欣普羅', price: 32.6, qty: 1000, fee_tax: 46 })])

  it('買進當天：券商口徑減半稅（−340），自己的淨損益與損益兩平不動（−389 / 32.79）', () => {
    const [row] = buildHoldingRows(sameDay(), { 'TPE:6560': quote(32.4) }, 0.001425, undefined, 'lot', '2026-09-29')
    // 32,400 − 32,646 − fee 46 − tax 48 (0.15%)，正是券商 APP 顯示的數字
    expect(row.brokerUnrealized).toBe(-340)
    expect(row.brokerDayTradeTax).toBe(true)
    // 自己的口徑維持 0.3%：32,400 − 32,646 − 46 − 97
    expect(row.unrealized).toBe(-389)
    // 損益兩平是「不賣就要這個價才保本」，不能用有條件的當沖稅率
    expect(row.breakEven).toBe(32.79)
  })

  it('隔天同一批未賣出：券商口徑回到 0.3%，和自己的口徑一致', () => {
    const [row] = buildHoldingRows(sameDay(), { 'TPE:6560': quote(32.2) }, 0.001425, undefined, 'lot', '2026-09-30')
    // 32,200 − 32,646 − fee 45 − tax 96 = −587，= 2026-09-30 券商 APP 的 −587 / −1.8%
    expect(row.brokerUnrealized).toBe(-587)
    expect(row.unrealized).toBe(-587)
    expect(row.brokerDayTradeTax).toBe(false)
    expect(row.roi).toBeCloseTo(-587 / 32646, 10)
  })

  it('不傳 today 時完全沿用舊行為（全部 0.3%）', () => {
    const [row] = buildHoldingRows(sameDay(), { 'TPE:6560': quote(32.4) }, 0.001425)
    expect(row.brokerUnrealized).toBe(-389)
    expect(row.brokerDayTradeTax).toBe(false)
  })

  it('只有今天買的那一批減半：舊批次仍是 0.3%', () => {
    const holdings = holdingsOf([
      tx({ tx_date: '2026-09-01', ticker: '6560', price: 32.6, qty: 1000, fee_tax: 46 }),
      tx({ tx_date: '2026-09-29', ticker: '6560', price: 32.6, qty: 1000, fee_tax: 46 }),
    ])
    const [row] = buildHoldingRows(holdings, { 'TPE:6560': quote(32.4) }, 0.001425, undefined, 'lot', '2026-09-29')
    // 兩批共 2000 股：舊批 tax 97、今日批 tax 48（每批各自 floor）
    // 32,400×2 − 32,646×2 − (46+46) − (97+48)
    expect(row.brokerUnrealized).toBe(-729)
    expect(row.brokerDayTradeTax).toBe(true)
  })

  it('落日之後（2028 起）不再減半', () => {
    const holdings = holdingsOf([
      tx({ tx_date: '2028-01-03', ticker: '6560', price: 32.6, qty: 1000, fee_tax: 46 }),
    ])
    const [row] = buildHoldingRows(holdings, { 'TPE:6560': quote(32.4) }, 0.001425, undefined, 'lot', '2028-01-03')
    expect(row.brokerUnrealized).toBe(-389)
    expect(row.brokerDayTradeTax).toBe(false)
  })

  // BUG-093 corrects what 0.10.9 asserted here. §2-2 gives 千分之1.5 to 上市或上櫃**股票** and
  // displaces **§2 第一款** (0.3%); an ETF is taxed under 第二款 (0.1%) and gets no relief, so a
  // lot bought today reads exactly the same as any other day — and `brokerDayTradeTax` must say
  // so, or the UI prints 「以當沖稅率估」over a figure that had no 當沖 rate applied to it.
  it('ETF 當沖不降稅，所以今天買的那批和平常一樣；債券 ETF 的 0 還是 0', () => {
    const etf = holdingsOf([tx({ tx_date: '2026-09-29', ticker: '0050', price: 100, qty: 1000, fee_tax: 142 })])
    const [etfRow] = buildHoldingRows(etf, { 'TPE:0050': quote(100) }, 0.001425, undefined, 'lot', '2026-09-29')
    // 100,000 − 100,142 − fee 142 − tax 100 (0.1%, unchanged) = −384
    expect(etfRow.brokerUnrealized).toBe(-384)
    expect(etfRow.unrealized).toBe(-384)
    expect(etfRow.brokerDayTradeTax).toBe(false)

    const bond = holdingsOf([tx({ tx_date: '2026-09-29', ticker: '00679B', price: 30, qty: 1000, fee_tax: 42 })])
    const [bondRow] = buildHoldingRows(bond, { 'TPE:00679B': quote(30) }, 0.001425, undefined, 'lot', '2026-09-29')
    expect(bondRow.brokerDayTradeTax).toBe(false)

    // 一般股票才會減半，標籤也才該出現
    const stock = holdingsOf([tx({ tx_date: '2026-09-29', ticker: '6560', price: 32.6, qty: 1000, fee_tax: 46 })])
    const [stockRow] = buildHoldingRows(stock, { 'TPE:6560': quote(32.4) }, 0.001425, undefined, 'lot', '2026-09-29')
    expect(stockRow.brokerDayTradeTax).toBe(true)
  })
})

// Task 182: a sell made today is charged today's rate, whatever rate each lot was bought under.
// Before this, the 折扣後 figure priced the exit with each lot's own recorded rate — invisible
// while the rate never changed, and wrong the day 玉山 moved from 6.5 折 to 3.8 折.
describe('未實現與保本價用今天的費率，不是買進那批的費率（Task 182）', () => {
  // One lot bought at the statutory rate, one at 3 折. Neither rate may reach the sell estimate.
  const holdings = holdingsOf([
    tx({ id: 'old', tx_date: '2026-01-05', price: 100, qty: 1000, fee_tax: 142, fee_rate: 0.001425 }),
    tx({ id: 'new', tx_date: '2026-06-05', price: 100, qty: 1000, fee_tax: 42, fee_rate: 0.0004275 }),
  ])

  it('兩批不同歷史費率，未實現只跟著傳進來的今日費率走', () => {
    const [cheap] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.0004275)
    const [dear] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    // 240,000 市值：3 折賣出費 102（每批 51），原價 342（每批 171）—— 差 240 元
    expect((cheap.unrealized as number) - (dear.unrealized as number)).toBe(240)
  })

  it('保本賣出價和未實現用同一個費率，兩者不會各答各的', () => {
    const [cheap] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.0004275)
    const [dear] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(cheap.breakEven).not.toBeNull()
    expect(dear.breakEven).not.toBeNull()
    expect(cheap.breakEven as number).toBeLessThan(dear.breakEven as number)
  })

  it('牌告口徑（月退在看的那個數字）不受費率歷史影響，永遠是 0.1425%', () => {
    const [cheap] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.0004275)
    const [dear] = buildHoldingRows(holdings, { 'TPE:2330': quote(120) }, 0.001425)
    expect(cheap.brokerUnrealized).toBe(dear.brokerUnrealized)
  })
})

/**
 * Task 189: a 月退 broker deducts the list-price fee at settlement and its app keeps it in cost.
 * Real case (玉山 App, 2026-10-02): 009828 10,000 @ 10.70, recorded fee 57 (3.8 折), price 10.68.
 * The app showed −610 = 106,800 − 152 − 106 − 107,152; the recorded cost gives −515.
 */
describe('buildHoldingRows — 月退的券商成本含牌告手續費（Task 189）', () => {
  const buy = () =>
    holdingsOf([tx({ ticker: '009828', name: '中信台日韓PCB', tx_date: '2026-10-02', price: 10.7, qty: 10000, fee_tax: 57 })])

  it('月退：券商口徑用 107,152 當成本，對上玉山 App 的 −610 / −0.57%', () => {
    const [row] = buildHoldingRows(buy(), { 'TPE:009828': quote(10.68) }, 0.0005415, undefined, 'lot', undefined, true)
    expect(row.brokerCost).toBe(107_152)
    expect(row.brokerUnrealized).toBe(-610)
    expect(row.brokerRoi).toBeCloseTo(-610 / 107_152, 10)
    // The economic figure keeps the recorded cost.
    expect(row.holding.cost).toBe(107_057)
  })

  it('日退（或舊工作區）：券商口徑沿用記錄的成本 −515', () => {
    for (const listCost of [false, undefined]) {
      const [row] = buildHoldingRows(buy(), { 'TPE:009828': quote(10.68) }, 0.0005415, undefined, 'lot', undefined, listCost)
      expect(row.brokerCost).toBeNull()
      expect(row.brokerUnrealized).toBe(-515)
    }
  })

  it('部分賣出後，剩下的股數按比例分攤原本那筆的牌告手續費', () => {
    const holdings = holdingsOf([
      tx({ ticker: '009828', tx_date: '2026-10-02', price: 10.7, qty: 10000, fee_tax: 57 }),
      tx({ ticker: '009828', tx_date: '2026-10-03', tx_type: 'SELL', price: 10.8, qty: 4000, fee_tax: 66 }),
    ])
    const [row] = buildHoldingRows(holdings, { 'TPE:009828': quote(10.68) }, 0.0005415, undefined, 'lot', undefined, true)
    // 6,000 left: list fee 152 × 0.6 = 91.2, recorded 57 × 0.6 = 34.2 → 57 more than the ledger.
    expect(row.brokerCost as number).toBeCloseTo(row.holding.cost + 57, 6)
  })

  it('零股照最低手續費算；已經記成牌告的那筆不加；股票股利不加', () => {
    const holdings = holdingsOf([
      // 10 × 50 = 500 → floor(0.71) = 0 → odd-lot minimum 1; recorded 1 → nothing to add.
      tx({ ticker: '2330', price: 50, qty: 10, fee_tax: 1 }),
      // Already at the list price: floor(100,000 × 0.1425%) = 142.
      tx({ ticker: '2330', price: 100, qty: 1000, fee_tax: 142 }),
      tx({ ticker: '2330', tx_type: 'STOCK_DIVIDEND', price: 0, qty: 50, fee_tax: 10 }),
    ])
    const [row] = buildHoldingRows(holdings, { 'TPE:2330': quote(100) }, 0.0004275, undefined, 'lot', undefined, true)
    expect(row.brokerCost).toBe(row.holding.cost)
  })
})
