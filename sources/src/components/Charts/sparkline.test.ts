import { describe, it, expect } from 'vitest'
import { sparkline } from './sparkline'

describe('sparkline', () => {
  it('最高值貼上緣、最低值貼下緣（留 pad）', () => {
    const g = sparkline([1, 3], 100, 20, 3)
    expect(g).not.toBeNull()
    // 由舊到新：1 是最低 → y = height - pad；3 是最高 → y = pad
    expect(g!.line).toBe('0,17 100,3')
    expect(g!.lastX).toBe(100)
    expect(g!.lastY).toBe(3)
  })

  it('x 依索引平均分佈，與值無關', () => {
    const g = sparkline([1, 2, 3], 100, 20, 0)
    expect(g!.line).toBe('0,20 50,10 100,0')
  })

  it('全部等值時擺中線，不除以 0', () => {
    const g = sparkline([2, 2, 2], 100, 20, 3)
    expect(g!.line).toBe('0,10 50,10 100,10')
  })

  it('null 跳過不畫，但仍佔一個 x 位置（時間軸不壓縮）', () => {
    // 第 2 期未發布：線從 x=0 直接連到 x=100，中間沒有點
    const g = sparkline([1, null, 3], 100, 20, 3)
    expect(g!.line).toBe('0,17 100,3')
    expect(g!.lastX).toBe(100)
  })

  it('面積路徑封閉到底緣', () => {
    const g = sparkline([1, 3], 100, 20, 3)
    expect(g!.area).toBe('M0,17 0,17 100,3 L100,20 L0,20 Z')
  })

  it('有效值少於兩個時回 null（一個點連不成線）', () => {
    expect(sparkline([1], 100, 20)).toBeNull()
    expect(sparkline([1, null, null], 100, 20)).toBeNull()
    expect(sparkline([], 100, 20)).toBeNull()
    expect(sparkline([null, undefined], 100, 20)).toBeNull()
  })

  it('非數字（NaN / Infinity）視同未發布', () => {
    expect(sparkline([1, NaN, Infinity], 100, 20)).toBeNull()
  })
})
