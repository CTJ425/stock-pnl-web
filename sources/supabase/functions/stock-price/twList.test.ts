import { describe, expect, it } from 'vitest'
import { buildTwList, type TwListSource } from './twList'

const ok = (rows: Array<Record<string, unknown>>): TwListSource => ({
  status: 'fulfilled',
  value: rows,
})
const failed = (): TwListSource => ({ status: 'rejected', reason: new Error('HTTP 503') })

const TWSE = [{ Code: '3037', Name: '欣興', ClosingPrice: '993.00' }]
const TPEX = [{ SecuritiesCompanyCode: '6488', CompanyName: '環球晶', Close: '500' }]

describe('buildTwList', () => {
  it('E1: 兩個來源都成功時合併並保留兩邊的資料', () => {
    const result = buildTwList(ok(TWSE), ok(TPEX))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toEqual([
      { symbol: '3037', name: '欣興', close: 993 },
      { symbol: '6488', name: '環球晶', close: 500 },
    ])
  })

  it('E2: 上市來源失敗時整體視為失敗，不得回傳只有上櫃的半份清單', () => {
    const result = buildTwList(failed(), ok(TPEX))

    expect(result.ok).toBe(false)
  })

  it('E3: 上櫃來源失敗時同樣整體視為失敗', () => {
    const result = buildTwList(ok(TWSE), failed())

    expect(result.ok).toBe(false)
  })

  it('E4: 來源回成功但內容為空陣列時，同樣視為失敗', () => {
    // 掛掉的來源不一定會 reject：維護時段或假日可能回 HTTP 200 加空陣列。
    expect(buildTwList(ok([]), ok(TPEX)).ok).toBe(false)
    expect(buildTwList(ok(TWSE), ok([])).ok).toBe(false)
  })

  it('E5: 代號重複時以先出現的為準', () => {
    const result = buildTwList(ok(TWSE), ok([{ Code: '3037', Name: '重複', Close: '1' }]))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toEqual({ symbol: '3037', name: '欣興', close: 993 })
  })

  it('E6: 缺代號或缺名稱的列會被丟棄；全部被丟棄時視為失敗', () => {
    const junk = [{ Code: '', Name: '無代號' }, { Code: '2330', Name: '' }]

    const partial = buildTwList(ok([...TWSE, ...junk]), ok(TPEX))
    expect(partial.ok).toBe(true)
    if (partial.ok) expect(partial.rows.map((r) => r.symbol)).toEqual(['3037', '6488'])

    expect(buildTwList(ok(junk), ok(junk)).ok).toBe(false)
  })

  it('E7: 收盤價非正數或無法解析時記為 null，千分位逗號要能解析', () => {
    const result = buildTwList(
      ok([
        { Code: '1101', Name: '台泥', ClosingPrice: '1,234.5' },
        { Code: '1102', Name: '亞泥', ClosingPrice: '--' },
        { Code: '1103', Name: '嘉泥', ClosingPrice: '0' },
      ]),
      ok(TPEX),
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.rows.map((r) => r.close)).toEqual([1234.5, null, null, 500])
  })
  it('E8: 一邊全好、另一邊非空但每列都無效時，仍視為失敗', () => {
    // `length === 0` 擋不住這種：陣列非空，但每一列都缺代號或缺名稱，
    // 全部被丟棄後結果就是一份只有單邊交易所的半份清單。
    const junk = [{ Code: '', Name: '無代號' }, { Code: '2330', Name: '' }]

    expect(buildTwList(ok(TWSE), ok(junk)).ok).toBe(false)
    expect(buildTwList(ok(junk), ok(TPEX)).ok).toBe(false)
  })

  it('E9: 上市來源被拒時，失敗明細要指名 TWSE 並帶上原因', () => {
    const result = buildTwList(failed(), ok(TPEX))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([{ source: 'TWSE', reason: 'HTTP 503' }])
    expect(result.error).toContain('TWSE')
    expect(result.error).toContain('HTTP 503')
  })

  it('E10: 兩個來源都被拒時要各列一筆，順序為 TWSE、TPEx', () => {
    const result = buildTwList(failed(), failed())

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.map((f) => f.source)).toEqual(['TWSE', 'TPEx'])
  })

  it('E11: 來源有回應但無有效列時，原因要寫出原始筆數，而非「無回應」', () => {
    const junk = [{ Code: '', Name: '無代號' }, { Code: '2330', Name: '' }]

    const result = buildTwList(ok(TWSE), ok(junk))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([{ source: 'TPEx', reason: '0 usable rows of 2 returned' }])
  })

  it('E12: 一邊被拒、一邊空陣列時，錯誤訊息要同時含兩個來源名稱', () => {
    const result = buildTwList(failed(), ok([]))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures.map((f) => f.source)).toEqual(['TWSE', 'TPEx'])
    expect(result.error).toContain('TWSE')
    expect(result.error).toContain('TPEx')
  })

  it('E13: 來源回傳非陣列物件（如錯誤 JSON）時，正確回報而非崩潰', () => {
    const notArray = { status: 'fulfilled', value: { error: 'Rate limit' } } as unknown as TwListSource
    const result = buildTwList(notArray, ok(TPEX))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failures).toEqual([{ source: 'TWSE', reason: 'response is not an array' }])
  })
})
