/**
 * Technical indicators: pure function, no DOM dependencies, easy for unit testing.
 *
 * Why do the math yourself instead of throwing it to something else: The AI ​​assistant in 0.6.0 will eat the output here.
 * The language model's mental calculation of MA60 or KD from the 244 original closing prices must be wrong, and the wrong number package is the hardest to detect in fluent Chinese.
 * The indicators are all calculated by the program, and the model is only responsible for interpretation - so the accuracy of this file is the foundation of the entire function.
 *
 * Common rules (all three are easy to write wrong, so they are listed clearly):
 * 1. **Output and input are of equal length**. The early period when the warm-up period is insufficient is `null`, and the chart will be disconnected accordingly and will not be interpolated.
 * 2. **null is not considered 0**. When any root is null, the root outputs null and does not update the recursive state.
 *    —— Treating the omission as 0 will cause the moving average to collapse to close to zero instantly, which is worse than no drawing at all.
 * 3. **Only crop the display range during switching**. Indicators must be calculated on the complete sequence before clipping.
 *    Otherwise, when switching to "near March", the entire MA60 will become null.
 */

/** Single K-bar (only fields required for indicator calculation)*/
export interface Bar {
  high: number
  low: number
  close: number
}

type Series = Array<number | null>

/** Simple moving average. The window contains null, which means the root is null.*/
export function sma(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (period <= 0) return out
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0
    let ok = true
    for (let k = i - period + 1; k <= i; k++) {
      const v = values[k]
      if (v === null) {
        ok = false
        break
      }
      sum += v
    }
    if (ok) out[i] = sum / period
  }
  return out
}

/**
 * Exponential moving average. The simple average of the previous period pens is used as the seed (consistent with mainstream disk viewing software),
 * Then go back - using the first one as a seed will cause the first few dozen to deviate.
 */
export function ema(values: Series, period: number): Series {
  const out: Series = new Array(values.length).fill(null)
  if (period <= 0) return out
  const k = 2 / (period + 1)
  let prev: number | null = null
  let seedSum = 0
  let seedCount = 0

  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) continue // 狀態不動，該根留 null
    if (prev === null) {
      seedSum += v
      seedCount++
      if (seedCount === period) {
        prev = seedSum / period
        out[i] = prev
      }
      continue
    }
    prev = v * k + prev * (1 - k)
    out[i] = prev
  }
  return out
}

export interface MacdResult {
  /** Fast line (DIF) = EMA(fast) − EMA(slow)*/
  dif: Series
  /** Slow line (DEA / MACD line) = EMA(signal) of DIF*/
  dea: Series
  /** Column (OSC) = DIF − DEA*/
  hist: Series
}

/** MACD(12, 26, 9). The columnar body adopts the international convention of DIF − DEA, which is not multiplied by 2.*/
export function macd(closes: Series, fast = 12, slow = 26, signal = 9): MacdResult {
  const fastEma = ema(closes, fast)
  const slowEma = ema(closes, slow)
  const dif: Series = closes.map((_, i) => {
    const f = fastEma[i]
    const s = slowEma[i]
    return f === null || s === null ? null : f - s
  })
  const dea = ema(dif, signal)
  const hist: Series = dif.map((d, i) => {
    const e = dea[i]
    return d === null || e === null ? null : d - e
  })
  return { dif, dea, hist }
}

export interface KdResult {
  k: Series
  d: Series
}

/**
 * KD stochastic indicator (usually 9,3,3 for Taiwan stocks).
 *
 * RSV = (Close − n-day low) / (n-day high − n-day low) × 100
 * K = K × 2/3 + RSV × 1/3 of the previous day; D = D × 2/3 + K × 1/3 of the previous day, and the initial values ​​of K/D are both 50.
 *
 * n When the highest value in a day is equal to the lowest value (there is no fluctuation in the entire period, such as continuous lower limit lock-up), RSV takes 50 -
 * A denominator of zero cannot be treated as 0 or 100, which will create an oversold/overbought signal out of thin air.
 */
export function kd(bars: Array<Bar | null>, period = 9, kSmooth = 3, dSmooth = 3): KdResult {
  const k: Series = new Array(bars.length).fill(null)
  const d: Series = new Array(bars.length).fill(null)
  let prevK = 50
  let prevD = 50

  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) continue
    const window = bars.slice(i - period + 1, i + 1)
    if (window.some((b) => b === null)) continue
    const w = window as Bar[]
    const high = Math.max(...w.map((b) => b.high))
    const low = Math.min(...w.map((b) => b.low))
    const close = w[w.length - 1].close
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100

    prevK = prevK * ((kSmooth - 1) / kSmooth) + rsv / kSmooth
    prevD = prevD * ((dSmooth - 1) / dSmooth) + prevK / dSmooth
    k[i] = prevK
    d[i] = prevD
  }
  return { k, d }
}

/**
 * RSI (Wilder Smooth, preset 14).
 * The simple average of the rise and fall of the roots in the previous period is used as the seed, and then avg = (previous value × (n−1) + this time) / n.
 * An average drawdown of 0 is back to 100 (not divided by zero).
 */
export function rsi(closes: Series, period = 14): Series {
  const out: Series = new Array(closes.length).fill(null)
  if (period <= 0) return out

  let avgGain: number | null = null
  let avgLoss = 0
  let seedGain = 0
  let seedLoss = 0
  let seedCount = 0

  for (let i = 1; i < closes.length; i++) {
    const cur = closes[i]
    const prev = closes[i - 1]
    if (cur === null || prev === null) continue
    const diff = cur - prev
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0

    if (avgGain === null) {
      seedGain += gain
      seedLoss += loss
      seedCount++
      if (seedCount === period) {
        avgGain = seedGain / period
        avgLoss = seedLoss / period
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
      }
      continue
    }
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)
  }
  return out
}

/** Moving average arrangement status; if any one is missing a value, it returns null (no guess)*/
export function maAlignment(
  short: number | null,
  mid: number | null,
  long: number | null,
): '多頭排列' | '空頭排列' | '糾結' | null {
  if (short === null || mid === null || long === null) return null
  if (short > mid && mid > long) return '多頭排列'
  if (short < mid && mid < long) return '空頭排列'
  return '糾結'
}

/** Get the last non-null value in the sequence; return null if empty*/
export function lastValue(series: Series): number | null {
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null) return series[i]
  }
  return null
}
