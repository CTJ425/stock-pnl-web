/**
 * 「資料抓取狀況」時間軸的座標與判定（純函式，方便單獨測試）。
 *
 * 時間軸的範圍是**當日 15:00 → 次日 10:00**（19 小時）：台股收盤到隔天開盤前，
 * 涵蓋三個籌碼來源全部的公布時間（法人 15:00、融資融券 21:00、借券 21:00–22:30）
 * 以及隔天早上的補抓輪。
 *
 * **判定基準是「公布窗結束後的第一個批次班次」，不是公布時刻。**
 * 三大法人 15:00–15:30 公布、我們 16:15 才抓到，用公布時刻判會變成「晚了 45 分」——
 * 但盤後批次本來就 16:00 才起跑，那是排程設計不是異常。
 * 反過來借券當晚 32 輪都在跑卻沒抓到、隔天才補，那才該亮燈。
 * 判定要對著我們控制得了的東西，與 BUG-008 同源：拿外部發布時程當基準，
 * 只會得到一片永遠亮著的黃燈，而永遠亮著的告警等於沒有告警。
 */

export type SourceState = 'ok' | 'warn' | 'late' | 'idle'

/** 時間軸起點（台北時間的小時）與總長度 */
export const TL_START_HOUR = 15
export const TL_SPAN_HOURS = 19

export interface ChainSpec {
  id: 'institutional' | 'daily' | 'margin' | 'borrow' | 'news'
  label: string
  hint: string
  /**
   * 來源公布窗，[起, 迄]，單位為「距當日 15:00 的小時數」。
   * **null 代表這個來源沒有公布窗的概念**（新聞隨時都可能有，批次每輪都會試著抓）——
   * 硬畫一個窗只會得到一條永遠抓不到東西的色塊，看起來像壞掉。
   */
  window: [number, number] | null
  /** 寬限截止：這個時間點之前沒拿到就算延遲。對應的是批次班次而非公布時刻 */
  dueBy: number
}

/**
 * 台股盤後鏈。順序即畫面順序（依公布時間先後）。
 *
 * `dueBy` 的取法：公布窗結束後、盤後批次仍在跑的下一個班次。
 * 批次是台北 16:00–23:45 每 15 分，所以沒有明確公布窗的（新聞），
 * 寬限給到隔天第一輪 09:15（＝ 18.25）。
 */
export const TW_CHAIN: readonly ChainSpec[] = [
  { id: 'institutional', label: '三大法人', hint: 'T86', window: [0, 0.5], dueBy: 1.5 },
  { id: 'daily', label: '日 K 線・估值', hint: '每檔持股', window: [1, 1.5], dueBy: 2 },
  { id: 'margin', label: '融資融券', hint: 'MI_MARGN', window: [6, 7], dueBy: 7.5 },
  { id: 'borrow', label: '借券賣出', hint: '次一交易日', window: [6, 7.5], dueBy: 8.75 },
  { id: 'news', label: '個股新聞', hint: '每檔持股', window: null, dueBy: 18.25 },
]

/** 時間軸刻度（小時數 → 標籤） */
export const TL_TICKS: ReadonlyArray<{ h: number; label: string }> = [
  { h: 0, label: '15:00' },
  { h: 3, label: '18:00' },
  { h: 6, label: '21:00' },
  { h: 9, label: '00:00' },
  { h: 12, label: '03:00' },
  { h: 15, label: '06:00' },
  { h: 18, label: '09:00' },
]

/** 小時數 → 軸上的百分比位置（夾在 0–100，超出範圍的事件貼邊而不是跑出容器） */
export function tlPercent(hour: number): number {
  const p = (hour / TL_SPAN_HOURS) * 100
  return Math.round(Math.min(100, Math.max(0, p)) * 100) / 100
}

/**
 * ISO 時間 → 距「資料日 15:00（台北）」的小時數。跨日自然算成 > 24 − 15 = 大於 9。
 * 時間戳或日期壞掉時回 null，呼叫端一律顯示為「未取得」。
 */
export function hoursFromBase(iso: string | null | undefined, baseYmd: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  const base = Date.parse(`${baseYmd}T${String(TL_START_HOUR).padStart(2, '0')}:00:00+08:00`)
  if (!Number.isFinite(t) || !Number.isFinite(base)) return null
  return (t - base) / 3_600_000
}

/** 小時數 → 'HH:mm'，跨日回 '次日 HH:mm' */
export function tlLabel(hour: number): string {
  const total = TL_START_HOUR * 60 + Math.round(hour * 60)
  const next = total >= 24 * 60
  const mins = next ? total - 24 * 60 : total
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')
  return next ? `次日 ${hh}:${mm}` : `${hh}:${mm}`
}

/**
 * 判定單一資料源的狀態。
 *
 * 沒拿到時，**還沒到 `dueBy` 就是 idle（等待中）而不是 late** ——
 * 每天傍晚都有一段時間資料本來就還沒公布，那時亮紅燈只會讓人學會忽略它。
 */
export function judgeSource(
  spec: ChainSpec,
  fetchedHour: number | null,
  nowHour: number,
  partial = false,
): SourceState {
  if (fetchedHour === null) return nowHour > spec.dueBy ? 'late' : 'idle'
  if (partial) return 'warn'
  return fetchedHour > spec.dueBy ? 'late' : 'ok'
}

/**
 * 月頻資料的落後判定：與**同組其他來源的最新期別**比，而不是查發布行事曆。
 *
 * 發布日每個指標都不一樣（非農每月第一個週五、CPI 月中、PCE 月底），
 * 維護行事曆等於維護一個一定會過期的常數表；但「其他四個都到 2026-06 了、
 * 只有你還在 2026-05」這件事不必查行事曆也成立。
 */
export function judgePeriod(period: string | null, peerLatest: string | null): SourceState {
  if (!period) return 'idle'
  if (!peerLatest || period >= peerLatest) return 'ok'
  return 'warn'
}

/** 一組期別字串裡最新的那個（'YYYY-MM' 字典序即時序） */
export function latestPeriod(periods: ReadonlyArray<string | null | undefined>): string | null {
  let best: string | null = null
  for (const p of periods) if (typeof p === 'string' && p && (best === null || p > best)) best = p
  return best
}

/** 毫秒差 → '3h 40m' / '38s' / '19d 20h' */
export function humanAgo(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

/** cron 排程的健康度：停用、今日有失敗、或從未跑過都要看得出來 */
export function judgeCron(
  active: boolean,
  failsToday: number,
  lastRun: string | null,
): SourceState {
  if (!active) return 'late'
  if (failsToday > 0) return 'warn'
  if (!lastRun) return 'idle'
  return 'ok'
}

/**
 * cron 表達式 → 一句白話（順帶把 UTC 換算成台北）。
 * 只認本專案實際用到的兩種形狀；認不得就原樣回傳 ——
 * 顯示 cron 字串總比顯示一個翻錯的句子好。
 */
export function describeCron(expr: string): string {
  const w = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (w) {
    const from = (Number(w[2]) + 8) % 24
    const to = (Number(w[3]) + 8) % 24
    const p = (n: number) => String(n).padStart(2, '0')
    return `週一至週五 ${p(from)}:00–${p(to)}:45 每 ${w[1]} 分`
  }
  const d = /^0\s+([\d,]+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (d) {
    const hours = d[1]
      .split(',')
      .map((h) => `${String((Number(h) + 8) % 24).padStart(2, '0')}:00`)
      .join(' / ')
    return `每日 ${hours}`
  }
  return expr
}
