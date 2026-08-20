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
    const rows = sellLadder(base)
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
      const rows = sellLadder({ ...base, buyPrice: anchor, price: anchor })
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
