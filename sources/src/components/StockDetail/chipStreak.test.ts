import { describe, it, expect } from 'vitest'
import { streakAt } from './chipStreak'

// 這些案例刻意與 supabase/functions/stock-report/report.test.ts 的 computeStreak 對齊：
// 同一套規則跨網路邊界，兩邊行為必須一致。
describe('streakAt', () => {
  const last = (s: Array<number | null>) => streakAt(s, s.length - 1)

  it('由指定日往回數同號連續筆數，正數＝連買、負數＝連賣', () => {
    expect(last([-1, 2, 3, 4])).toBe(3)
    expect(last([5, -1, -2])).toBe(-2)
    expect(last([1, 2, 3])).toBe(3)
  })

  it('該日為 0 或 null 時視為中斷（0）', () => {
    expect(last([1, 2, 0])).toBe(0)
    expect(last([1, 2, null])).toBe(0)
    expect(last([])).toBe(0)
  })

  it('中途遇 0 或 null 即停止累計', () => {
    expect(last([3, 0, 1, 2])).toBe(2)
    expect(last([3, null, 1])).toBe(1)
  })

  it('全 0 序列回 0', () => {
    expect(last([0, 0, 0])).toBe(0)
  })

  it('可算「到某一天為止」的連續天數，不受更晚的資料影響', () => {
    const s = [1, 2, 3, -1, -2]
    expect(streakAt(s, 2)).toBe(3) // 到第 3 天為止連 3 買
    expect(streakAt(s, 3)).toBe(-1) // 第 4 天翻空，連 1 賣
    expect(streakAt(s, 4)).toBe(-2)
  })

  it('索引越界不炸', () => {
    expect(streakAt([1, 2], 9)).toBe(0)
    expect(streakAt([1, 2], -1)).toBe(0)
  })
})
