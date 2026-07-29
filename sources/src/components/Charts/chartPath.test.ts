import { describe, it, expect } from 'vitest'
import { areaSegments, clampTipCenter, lineSegments } from './chartPath'
import type { PlotGeometry } from './chartFrame'

/** 好算的假 geometry：bandCenter = 10i + 5、y = 值本身、底邊 100 */
const geo: PlotGeometry = {
  innerW: 100,
  innerH: 100,
  count: 10,
  bandWidth: 10,
  bandCenter: (i) => 10 * i + 5,
  y: (v) => v,
  hover: null,
}

describe('lineSegments', () => {
  /*
    0.6.8 把分段邏輯抽成內部的 segments()，供折線與面積共用。
    這一組是**行為未變的護欄** —— 三個呼叫端（籌碼、匯率、技術面均線）
    與 PDF 匯出都依賴這個輸出，格式改一個字都算破壞。
  */
  it('連續有值時輸出一段，座標為 x,y 空白分隔、各取兩位小數', () => {
    expect(lineSegments([1, 2, 3], geo)).toEqual(['5.00,1.00 15.00,2.00 25.00,3.00'])
  })

  it('遇 null 斷開成多段，不內插', () => {
    expect(lineSegments([1, 2, null, 4, 5], geo)).toEqual([
      '5.00,1.00 15.00,2.00',
      '35.00,4.00 45.00,5.00',
    ])
  })

  it('只有一個點的段被丟棄（畫不出線）', () => {
    expect(lineSegments([1, null, 3, null, 5, 6], geo)).toEqual(['45.00,5.00 55.00,6.00'])
  })

  it('全是 null 或空序列時回空陣列', () => {
    expect(lineSegments([null, null], geo)).toEqual([])
    expect(lineSegments([], geo)).toEqual([])
  })

  it('undefined 與 null 同樣視為斷點', () => {
    expect(lineSegments([1, 2, undefined as unknown as null, 4, 5], geo)).toEqual([
      '5.00,1.00 15.00,2.00',
      '35.00,4.00 45.00,5.00',
    ])
  })
})

describe('areaSegments', () => {
  it('每段前後各補一個底邊座標，封閉成多邊形', () => {
    expect(areaSegments([1, 2, 3], geo)).toEqual([
      '5.00,100.00 5.00,1.00 15.00,2.00 25.00,3.00 25.00,100.00',
    ])
  })

  it('分段方式與 lineSegments 完全一致（填色與線條的斷點不得走鐘）', () => {
    for (const values of [
      [1, 2, 3],
      [1, 2, null, 4, 5],
      [1, null, 3, null, 5, 6],
      [null, null],
      [],
    ]) {
      const lines = lineSegments(values, geo)
      const areas = areaSegments(values, geo)
      expect(areas).toHaveLength(lines.length)
      // 面積 = 底邊點 + 折線原樣 + 底邊點
      areas.forEach((a, i) => {
        const inner = a.split(' ').slice(1, -1).join(' ')
        expect(inner).toBe(lines[i])
      })
    }
  })

  it('底邊用 innerH 而不是 y(0) —— 折線圖的值域不含 0', () => {
    // y(0) 會是 0（這個假 geo 的 y 是恆等函式），底邊必須是 100
    const pts = areaSegments([1, 2], geo)[0].split(' ')
    expect(pts[0]).toBe('5.00,100.00')
    expect(pts[pts.length - 1]).toBe('15.00,100.00')
  })

  it('全是 null 時回空陣列，不產生退化多邊形', () => {
    expect(areaSegments([null, null], geo)).toEqual([])
  })
})

describe('clampTipCenter', () => {
  it('中間的點不動', () => {
    expect(clampTipCenter(300, 100, 600)).toBe(300)
  })

  it('最左的點往右推，剛好不超出左緣', () => {
    expect(clampTipCenter(10, 100, 600)).toBe(50)
  })

  it('最右的點往左拉，剛好不超出右緣', () => {
    expect(clampTipCenter(590, 100, 600)).toBe(550)
  })

  it('容器比 tooltip 還窄時回正中間（再夾也只是換一邊被裁）', () => {
    expect(clampTipCenter(10, 400, 200)).toBe(100)
    expect(clampTipCenter(190, 200, 200)).toBe(100)
  })

  it('寬度為 0 時等同不夾', () => {
    expect(clampTipCenter(7, 0, 600)).toBe(7)
  })
})
