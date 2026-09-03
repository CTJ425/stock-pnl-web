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
