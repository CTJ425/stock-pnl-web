import { describe, expect, it } from 'vitest'
import { whatIf, sellLadder } from './whatIf'
import { breakEvenPrice, calculateFee } from '../../utils/fees'

const RATE = 0.001425
const MIN_FEE = 20

describe('whatIf', () => {
  it('成本含買進手續費，售出扣手續費與證交稅', () => {
    const got = whatIf({ ticker: '2330', buyPrice: 100, qty: 1000, price: 110, feeRate: RATE, minFee: MIN_FEE })!

    // 買進 100,000 → 手續費 floor(142.5) = 142
    expect(got.buyFee).toBe(142)
    expect(got.cost).toBe(100_142)
    // 賣出 110,000 → 手續費 floor(156.75) = 156、證交稅 floor(330) = 330
    expect(got.sellFeeTax).toBe(486)
    expect(got.proceeds).toBe(109_514)
    expect(got.pnl).toBe(9_372)
    expect(got.roi).toBeCloseTo(9_372 / 100_142, 10)
  })

  it('每一筆費用都與 calculateFee 同值，不自成一套算法', () => {
    const input = { ticker: '2330', buyPrice: 123.5, qty: 2_000, price: 141, feeRate: RATE, minFee: MIN_FEE }
    const got = whatIf(input)!

    expect(got.buyFee).toBe(
      calculateFee({ market: 'TPE', txType: 'BUY', price: 123.5, qty: 2_000, feeRate: RATE, minFee: MIN_FEE }),
    )
    expect(got.sellFeeTax).toBe(
      calculateFee({
        market: 'TPE',
        txType: 'SELL',
        price: 141,
        qty: 2_000,
        feeRate: RATE,
        ticker: '2330',
        minFee: MIN_FEE,
      }),
    )
  })

  it('ETF（00 開頭）走 0.1% 證交稅', () => {
    const etf = whatIf({ ticker: '0050', buyPrice: 100, qty: 1_000, price: 110, feeRate: RATE, minFee: MIN_FEE })!
    const stock = whatIf({ ticker: '2330', buyPrice: 100, qty: 1_000, price: 110, feeRate: RATE, minFee: MIN_FEE })!

    // 110,000 × 0.1% = 110，對股票是 330
    expect(stock.sellFeeTax - etf.sellFeeTax).toBe(220)
  })

  it('最低手續費會頂上來', () => {
    const got = whatIf({ ticker: '2330', buyPrice: 10, qty: 100, price: 11, feeRate: RATE, minFee: MIN_FEE })!
    // 1,000 × 0.001425 = 1.4 → 低於最低 20
    expect(got.buyFee).toBe(MIN_FEE)
  })

  it('回本價沿用 breakEvenPrice', () => {
    const got = whatIf({ ticker: '2330', buyPrice: 100, qty: 1_000, price: 110, feeRate: RATE, minFee: MIN_FEE })!

    expect(got.breakEven).toBe(
      breakEvenPrice(
        {
          key: 'TPE:2330',
          market: 'TPE',
          ticker: '2330',
          name: '',
          currency: 'TWD',
          qty: 1_000,
          cost: got.cost,
          rawCost: 100_000,
          buyCostTotal: got.cost,
          realized: 0,
          avgCost: got.cost / 1_000,
          rawAvgCost: 100,
        },
        RATE,
        MIN_FEE,
      ),
    )
  })

  it('報酬率以含費成本為分母', () => {
    const got = whatIf({ ticker: '2330', buyPrice: 100, qty: 1_000, price: 100, feeRate: RATE, minFee: MIN_FEE })!
    // 原價賣回是虧的：進出手續費與證交稅都要付
    expect(got.pnl).toBeLessThan(0)
    expect(got.roi).toBeCloseTo(got.pnl / got.cost, 10)
  })

  it('股數或價格不合法時回傳 null，不丟例外', () => {
    expect(whatIf({ ticker: '2330', buyPrice: 100, qty: 0, price: 110, feeRate: RATE })).toBeNull()
    expect(whatIf({ ticker: '2330', buyPrice: 0, qty: 1_000, price: 110, feeRate: RATE })).toBeNull()
    expect(whatIf({ ticker: '2330', buyPrice: -1, qty: 1_000, price: 110, feeRate: RATE })).toBeNull()
    expect(whatIf({ ticker: '2330', buyPrice: 100, qty: 1_000, price: 0, feeRate: RATE })).toBeNull()
    expect(whatIf({ ticker: '2330', buyPrice: NaN, qty: 1_000, price: 110, feeRate: RATE })).toBeNull()
  })

  it('零手續費（免手續費券商）也算得出來', () => {
    const got = whatIf({ ticker: '2330', buyPrice: 100, qty: 1_000, price: 110, feeRate: 0, minFee: MIN_FEE })!
    expect(got.buyFee).toBe(0)
    expect(got.cost).toBe(100_000)
    // 證交稅仍要付
    expect(got.sellFeeTax).toBe(330)
  })
})

describe('sellLadder', () => {
  const base = {
    ticker: '2330',
    buyPrice: 100,
    qty: 1000,
    price: 110,
    feeRate: RATE,
    minFee: MIN_FEE,
  }

  it('以錨點為中心展開 ±10%，共九個級距', () => {
    const steps = sellLadder(base).filter((r) => r.kind !== 'breakEven')

    expect(steps).toHaveLength(9)
    expect(steps.map((r) => r.price)).toEqual([
      121, 118.25, 115.5, 112.75, 110, 107.25, 104.5, 101.75, 99,
    ])
  })

  it('錨點那一列標成 current，相對現價為 0', () => {
    const rows = sellLadder(base, { currentPrice: base.price })
    const current = rows.filter((r) => r.kind === 'current')

    expect(current).toHaveLength(1)
    expect(current[0].price).toBe(110)
    expect(current[0].relative).toBe(0)
    expect(rows[0].relative).toBeCloseTo(0.1, 10)
  })

  it('回本價插在排序後的位置，而且真的不賠', () => {
    const rows = sellLadder(base)
    const be = rows.filter((r) => r.kind === 'breakEven')

    expect(be).toHaveLength(1)
    expect(be[0].price).toBe(whatIf(base)!.breakEven)
    expect(be[0].pnl).toBeGreaterThanOrEqual(0)
    expect(rows.map((r) => r.price)).toEqual(
      [...rows].map((r) => r.price).sort((a, b) => b - a),
    )
  })

  it('回本價落在 ±10% 之外就不插入，階梯不硬拉', () => {
    // 買在 200、現價 110：回本價遠高於 +10% 的 121
    const rows = sellLadder({ ...base, buyPrice: 200 })

    expect(rows).toHaveLength(9)
    expect(rows.some((r) => r.kind === 'breakEven')).toBe(false)
  })

  it('每一列都是 whatIf 逐列實算，不是線性外插', () => {
    for (const row of sellLadder(base)) {
      const one = whatIf({ ...base, price: row.price })!
      expect(row.pnl).toBe(one.pnl)
      expect(row.roi).toBe(one.roi)
      expect(row.proceeds).toBe(one.proceeds)
      expect(row.sellFeeTax).toBe(one.sellFeeTax)
    }
  })

  it('價格不重複：低價股四捨五入後仍是唯一的一列', () => {
    // anchor * 0.025 掉到 0.01 網格以下時，−10% 與 −7.5% 會捨進同一個價格
    for (const anchor of [0.35, 1.2, 24.2, 110, 1085]) {
      const rows = sellLadder({ ...base, buyPrice: anchor, price: anchor }, {
        currentPrice: anchor,
      })
      const prices = rows.map((r) => r.price)

      expect(new Set(prices).size).toBe(prices.length)
      expect(rows.filter((r) => r.kind === 'current')).toHaveLength(1)
    }
  })

  it('回本價剛好落在某一階時不另插一列', () => {
    // 反解出「回本價正好等於錨點」的買進價：此時回本列與現價列同價
    const anchor = 110
    const rows = sellLadder({ ...base, buyPrice: 109, price: anchor })
    const atAnchor = rows.filter((r) => r.price === anchor)

    expect(atAnchor).toHaveLength(1)
    expect(rows.map((r) => r.price)).toEqual([...new Set(rows.map((r) => r.price))])
  })

  it('輸入不合法時回傳空陣列，不丟例外', () => {
    expect(sellLadder({ ...base, qty: 0 })).toEqual([])
    expect(sellLadder({ ...base, price: 0 })).toEqual([])
    expect(sellLadder({ ...base, buyPrice: -1 })).toEqual([])
  })
})

describe('sellLadder 錨點與標記：以持有均價展開，現價與回本變成標記列', () => {
  const base = {
    ticker: '2330',
    buyPrice: 100,
    qty: 1000,
    price: 110,
    feeRate: RATE,
    minFee: MIN_FEE,
  }
  /** 持有均價 100 當錨點，現價 104 落在窗口內但不在任何一階上。 */
  const onAvgCost = { ...base, price: 100 }

  it('錨點是持有均價時，均價那一列標成 avgCost', () => {
    const rows = sellLadder(onAvgCost, { currentPrice: 104, avgCost: 100 })
    const avg = rows.filter((r) => r.kind === 'avgCost')

    expect(avg).toHaveLength(1)
    expect(avg[0].price).toBe(100)
    expect(avg[0].relative).toBe(0)
    expect(rows.filter((r) => r.kind !== 'step').map((r) => r.kind).sort()).toEqual(
      ['avgCost', 'breakEven', 'current'],
    )
  })

  it('現價落在窗口內就自成一列，價格就是現價本身', () => {
    const rows = sellLadder(onAvgCost, { currentPrice: 104, avgCost: 100 })
    const cur = rows.filter((r) => r.kind === 'current')

    expect(cur).toHaveLength(1)
    expect(cur[0].price).toBe(104)
    expect(cur[0].pnl).toBe(whatIf({ ...onAvgCost, price: 104 })!.pnl)
  })

  it('沒有持股時，離窗口太遠的現價標記還是會被丟掉', () => {
    // 觀察股沒有均價可涵蓋，窗口就是現價 ±10%，200 落在外面
    const rows = sellLadder(base, { currentPrice: 200 })

    expect(rows.some((r) => r.kind === 'current')).toBe(false)
    expect(Math.max(...rows.map((r) => r.price))).toBe(121)
  })

  it('現價與均價同價時只留一列，標成 current', () => {
    const rows = sellLadder(onAvgCost, { currentPrice: 100, avgCost: 100 })
    const atAnchor = rows.filter((r) => r.price === 100)

    expect(atAnchor).toHaveLength(1)
    expect(atAnchor[0].kind).toBe('current')
  })

  it('標記價格照樣落在 0.01 網格上，均價不整齊也不會多出一列', () => {
    // 真實均價是 pos.cost / pos.qty，幾乎不可能剛好兩位小數
    const avgCost = 512.923
    const anchor = Math.round(avgCost * 100) / 100
    const rows = sellLadder({ ...base, buyPrice: avgCost, price: anchor }, { avgCost })
    const prices = rows.map((r) => r.price)
    const atAnchor = rows.filter((r) => r.price === anchor)

    expect(new Set(prices).size).toBe(prices.length)
    expect(atAnchor).toHaveLength(1)
    expect(atAnchor[0].kind).toBe('avgCost')
    expect(atAnchor[0].relative).toBe(0)
  })

  it('現價標記也要進位到 0.01', () => {
    const rows = sellLadder(onAvgCost, { currentPrice: 104.5678, avgCost: 100 })
    const cur = rows.filter((r) => r.kind === 'current')

    expect(cur).toHaveLength(1)
    expect(cur[0].price).toBe(104.57)
  })

  it('沒有給標記就只有九階加回本，不會冒出現價列', () => {
    for (const rows of [sellLadder(base), sellLadder(base, { currentPrice: null, avgCost: null })]) {
      expect(rows.filter((r) => r.kind === 'current')).toHaveLength(0)
      expect(rows.filter((r) => r.kind === 'avgCost')).toHaveLength(0)
      expect(rows.filter((r) => r.kind === 'step')).toHaveLength(9)
      expect(rows.filter((r) => r.kind === 'breakEven')).toHaveLength(1)
    }
  })
})

describe('sellLadder 現價簇：現價在均價 ±10% 之外時另成一簇', () => {
  const base = {
    ticker: '2330',
    buyPrice: 100,
    qty: 1000,
    price: 100,
    feeRate: RATE,
    minFee: MIN_FEE,
  }
  const groupOf = (rows: ReturnType<typeof sellLadder>, g: 'anchor' | 'quote') =>
    rows.filter((r) => r.group === g)

  it('主階梯維持均價 ±10% 九檔，現價另成上下三筆', () => {
    const rows = sellLadder(base, { currentPrice: 130, avgCost: 100 })
    const anchorRows = groupOf(rows, 'anchor')
    const quoteRows = groupOf(rows, 'quote')

    expect(Math.max(...anchorRows.map((r) => r.price))).toBe(110)
    expect(Math.min(...anchorRows.map((r) => r.price))).toBe(90)
    expect(quoteRows.map((r) => r.price)).toEqual([
      139.75, 136.5, 133.25, 130, 126.75, 123.5, 120.25,
    ])
    expect(quoteRows.filter((r) => r.kind === 'current')).toHaveLength(1)
    expect(rows.length).toBeLessThanOrEqual(18)
  })

  it('現價落在 ±10% 內就不另開一簇', () => {
    const rows = sellLadder(base, { currentPrice: 105, avgCost: 100 })

    expect(groupOf(rows, 'quote')).toHaveLength(0)
    expect(rows.every((r) => r.group === 'anchor')).toBe(true)
    expect(rows.filter((r) => r.kind === 'current')[0].price).toBe(105)
  })

  it('現價只差一點時，簇裡落回主窗口的那幾筆要丟掉', () => {
    const rows = sellLadder(base, { currentPrice: 112, avgCost: 100 })

    // 112 的 -7.5% / -5% / -2.5% 是 103.6 / 106.4 / 109.2，主階梯已經涵蓋
    expect(groupOf(rows, 'quote').map((r) => r.price)).toEqual([120.4, 117.6, 114.8, 112])
    expect(new Set(rows.map((r) => r.price)).size).toBe(rows.length)
  })

  it('現價遠低於均價時，簇排在主階梯下面，順序仍由高到低', () => {
    const rows = sellLadder(base, { currentPrice: 60, avgCost: 100 })
    const quoteRows = groupOf(rows, 'quote')

    expect(quoteRows).toHaveLength(7)
    expect(Math.max(...quoteRows.map((r) => r.price))).toBeLessThan(90)
    expect(rows.map((r) => r.price)).toEqual(
      [...rows].map((r) => r.price).sort((a, b) => b - a),
    )
  })

  it('沒有持股就不會有現價簇', () => {
    const rows = sellLadder({ ...base, price: 110 }, { currentPrice: 110 })

    expect(rows.every((r) => r.group === 'anchor')).toBe(true)
    expect(rows.filter((r) => r.kind === 'step')).toHaveLength(8)
  })
})
