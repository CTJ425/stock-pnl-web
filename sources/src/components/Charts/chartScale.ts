/**
 * 自繪 SVG 圖表的座標軸計算。純函式、無 DOM 依賴，便於單元測試。
 * 不引入圖表函式庫的理由見 docs/agent/PLAN.md §B（html2canvas 可擷取 inline SVG，PDF 才能保真）。
 */

export interface Domain {
  min: number
  max: number
}

export interface DomainOptions {
  /** 買賣超這類跨零的資料要強制含 0，餘額走勢圖則不必（會壓平變化） */
  includeZero?: boolean
  /** 期望的刻度段數，用於挑選好看的級距 */
  tickCount?: number
}

/** 把粗略級距吸附到 1 / 2 / 5 × 10^n */
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
 * 由資料算出對齊好看級距的值域。
 * - 無有效資料 → { 0, 1 }（畫出空軸而非崩掉）
 * - 全部為 0 → { -1, 1 }（保留零軸在中間）
 * - 單一值 → 以該值上下各留一成
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

/** 刻度級距；值域退化時回 0 */
export function tickStep(domain: Domain, count = 4): number {
  const span = domain.max - domain.min
  return span > 0 ? niceStep(span / count) : 0
}

/** 值域內的刻度值（由小到大，含端點） */
export function domainTicks(domain: Domain, count = 4): number[] {
  const step = tickStep(domain, count)
  if (step === 0) return [domain.min]
  const out: number[] = []
  // 浮點累加會漂移，改以整數倍數推進
  for (let k = Math.ceil(domain.min / step); k * step <= domain.max + step * 1e-9; k++) {
    out.push(k * step)
  }
  return out.length > 0 ? out : [domain.min, domain.max]
}

/** 值 → SVG y 座標（0 在頂部）。值域退化時回中線 */
export function scaleY(value: number, domain: Domain, height: number): number {
  const span = domain.max - domain.min
  if (!(span > 0)) return height / 2
  const ratio = (value - domain.min) / span
  return height - ratio * height
}

/**
 * 大數字軸標籤：12,345,678 → 1235 萬、250,000,000 → 2.5 億。
 * 傳入 step（刻度級距）時會依級距決定小數位 —— 否則像融資餘額 31,100～31,928 這種
 * 級距遠小於單位的序列，相鄰刻度會全部標成「3.1 萬」而分不出高低。
 *
 * **小於 1 的值也要靠 step 決定小數位**（0.6.6 修）：原本一律 `Math.round`，
 * 對餘額、股價、成交量都沒問題（都 ≥ 1），但匯率的日圓是 0.1957～0.2015、
 * 韓元是 0.022 —— 整條 Y 軸會標成一排「0」，實測畫面上就是這樣。
 */
export function fmtAxisNumber(v: number, step?: number): string {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  const unit = abs >= 1e8 ? 1e8 : abs >= 1e4 ? 1e4 : 1
  if (unit === 1) {
    // step 夠大（≥1）時維持原本的整數呈現，既有圖表一個字都不會變
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
