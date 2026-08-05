/**
 * Axis calculation for self-drawn SVG charts. Pure function, no DOM dependencies, easy for unit testing.
 * The reason for not introducing the chart function library can be found in docs/agent/PLAN.md §B (html2canvas can capture inline SVG, and PDF can maintain fidelity).
 */

export interface Domain {
  min: number
  max: number
}

export interface DomainOptions {
  /** Data that crosses zero such as buying and selling exceeds must contain 0, but the balance chart does not (it will flatten the changes)*/
  includeZero?: boolean
  /** The desired number of scale segments, used to select good-looking intervals*/
  tickCount?: number
}

/** Snap the rough level distance to 1 / 2 / 5 × 10^n*/
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1
  const exp = Math.floor(Math.log10(rough))
  const base = 10 ** exp
  const f = rough / base
  const mult = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return mult * base
}

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
}

/**
 * Calculate the value range that aligns with the good-looking intervals from the data.
 * - No valid data → { 0, 1 } (draw empty axis instead of collapse)
 * - all 0 → { -1, 1 } (leaving the zero axis in the middle)
 * - Single value → Leave 10% above and below the value
 */
export function niceDomain(
  values: Array<number | null | undefined>,
  opts: DomainOptions = {},
): Domain {
  const nums = finite(values)
  if (nums.length === 0) return { min: 0, max: 1 }

  let min = Math.min(...nums)
  let max = Math.max(...nums)
  if (opts.includeZero) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }

  if (min === max) {
    if (min === 0) return { min: -1, max: 1 }
    const pad = Math.abs(min) * 0.1
    min -= pad
    max += pad
  }

  const step = niceStep((max - min) / (opts.tickCount ?? 4))
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
  }
}

/** Scale interval; returns to 0 when the value range degrades*/
export function tickStep(domain: Domain, count = 4): number {
  const span = domain.max - domain.min
  return span > 0 ? niceStep(span / count) : 0
}

/** Scale values ​​within the range (from small to large, including endpoints)*/
export function domainTicks(domain: Domain, count = 4): number[] {
  const step = tickStep(domain, count)
  if (step === 0) return [domain.min]
  const out: number[] = []
  // Floating point accumulation will drift and be advanced by integer multiples instead.
  for (let k = Math.ceil(domain.min / step); k * step <= domain.max + step * 1e-9; k++) {
    out.push(k * step)
  }
  return out.length > 0 ? out : [domain.min, domain.max]
}

/** Value → SVG y-coordinate (0 on top). When the value range degenerates, it returns to the center line.*/
export function scaleY(value: number, domain: Domain, height: number): number {
  const span = domain.max - domain.min
  if (!(span > 0)) return height / 2
  const ratio = (value - domain.min) / span
  return height - ratio * height
}

/**
 * Large number axis labels: 12,345,678 → 12.35 million, 250,000,000 → 250 million.
 * When the step (scale interval) is passed in, the decimal places will be determined according to the step interval - otherwise, it will be like financing balance 31,100~31,928
 * For a sequence whose level interval is much smaller than the unit, the adjacent scales will all be marked as "31,000" and it will be impossible to distinguish between high and low.
 *
 * **Values ​​less than 1 also rely on step to determine the decimal place** (0.6.7 revision): Originally, it was always `Math.round`,
 * There is no problem with the balance, stock price, and trading volume (all ≥ 1), but the exchange rate of yen is 0.1957~0.2015,
 * The Korean won is 0.022 - the entire Y-axis will be marked with a row of "0", as is the case on the actual measurement screen.
 */
export function fmtAxisNumber(v: number, step?: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  const unit = abs >= 1e8 ? 1e8 : abs >= 1e4 ? 1e4 : 1
  if (unit === 1) {
    // When the step is large enough (≥1), the original integer presentation is maintained, and not a word of the existing chart will be changed.
    const decimals =
      step !== undefined && step > 0 && step < 1
        ? Math.min(Math.max(Math.ceil(-Math.log10(step)), 0), 6)
        : 0
    return `${sign}${abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`
  }
  const decimals =
    step === undefined || step <= 0
      ? abs >= unit * 10
        ? 0
        : 1
      : Math.min(Math.max(Math.ceil(Math.log10(unit / step)), 0), 3)
  return `${sign}${(abs / unit).toFixed(decimals)} ${unit === 1e8 ? '億' : '萬'}`
}
