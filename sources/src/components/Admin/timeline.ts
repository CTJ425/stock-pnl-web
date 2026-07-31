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
  id: 'institutional' | 'daily' | 'margin' | 'borrow'
  label: string
  hint: string
  /** 來源公布窗，[起, 迄]，單位為「距當日 15:00 的小時數」 */
  window: [number, number]
  /** 寬限截止：這個時間點之前沒拿到就算延遲。對應的是批次班次而非公布時刻 */
  dueBy: number
}

/**
 * 台股盤後鏈。順序即畫面順序（依公布時間先後）。
 *
 * `dueBy` 的取法：公布窗結束後、盤後批次仍在跑的下一個班次
 * （批次是台北 16:00–23:45 每 15 分）。三大法人實測要到 16:30 那輪才抓得到
 * —— 15:00–15:30 雖已公布，但 16:00 / 16:15 兩輪都還讀不到，故 dueBy 給 1.5。
 */
export const TW_CHAIN: readonly ChainSpec[] = [
  { id: 'institutional', label: '三大法人', hint: 'T86', window: [0, 0.5], dueBy: 1.5 },
  { id: 'daily', label: '日 K 線・估值', hint: '每檔持股', window: [1, 1.5], dueBy: 2 },
  { id: 'margin', label: '融資融券', hint: 'MI_MARGN', window: [6, 7], dueBy: 7.5 },
  { id: 'borrow', label: '借券賣出', hint: '次一交易日', window: [6, 7.5], dueBy: 8.75 },
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

/* ──────────────────────────────────────────────────────────────
   總經班次軸（M1）。橫軸是一整天的台北時間 00:00 → 24:00。
   ────────────────────────────────────────────────────────────── */

/** 台北小時（0–24）→ 24 小時軸上的百分比 */
export function dayPercent(hour: number): number {
  return Math.round(Math.min(24, Math.max(0, hour)) / 24 * 10000) / 100
}

/**
 * cron 表達式 → 當日的執行時刻（台北小時）。
 * 只認 `0 H[,H...] * * *` 這種每日固定時刻的形狀，其餘回空陣列。
 */
export function cronHoursTaipei(expr: string): number[] {
  const m = /^0\s+([\d,]+)\s+\*\s+\*\s+\*$/.exec(expr.trim())
  if (!m) return []
  return m[1]
    .split(',')
    .map((h) => (Number(h) + 8) % 24)
    .sort((a, b) => a - b)
}

/**
 * 下一次執行。`hours` 是當日的班次時刻，`nowHour` 是現在（台北小時）。
 * 今天已無班次時回明天的第一班（`tomorrow: true`）。
 */
export function nextRun(
  hours: readonly number[],
  nowHour: number,
): { hour: number; tomorrow: boolean; inHours: number } | null {
  if (!hours.length) return null
  const upcoming = hours.find((h) => h > nowHour)
  if (upcoming !== undefined) {
    return { hour: upcoming, tomorrow: false, inHours: upcoming - nowHour }
  }
  return { hour: hours[0], tomorrow: true, inHours: 24 - nowHour + hours[0] }
}

/** 小時數（可為小數）→ 'HH:mm' */
export function hourLabel(hour: number): string {
  const total = Math.round(((hour % 24) + 24) % 24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** 時間長度 → '6h 40m' / '25m' */
export function durationLabel(hours: number): string {
  const m = Math.max(0, Math.round(hours * 60))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/**
 * 各指標下一期的發布日**推估區間**。
 *
 * ⚠️ 這是依實測歸納，**不是官方行事曆** —— FRED 沒有提供發布日 API。
 * 排程完全不依賴它（每天兩班照跑、比對內容指紋），它純粹是給人看的參考，
 * 畫面上必須標示「推估」。
 *
 * **為什麼是區間而不是單一日期**：以 ALFRED 的 vintage 反查近三期的實際發布日
 * （vintage 是單調的，某期首次出現的那天就是發布日），結果如下 ——
 *
 * | 指標 | 2026-04 期 | 2026-05 期 | 2026-06 期 |
 * | ---- | ---- | ---- | ---- |
 * | CPILFESL | 05-12 | 06-10 | 07-14 |
 * | PPIFES   | 05-13 | 06-11 | 07-15 |
 * | PCEPILFE | 05-28 | 06-25 | 07-30 |
 * | PAYEMS   | 05-08 | 06-05 | 07-02 |
 * | UMCSENT  | 04-01 | 05-01 | 06-01（皆為次月 1 日） |
 *
 * 日期每個月都在跳（CPI 就橫跨 10–14 日），給單一日期等於假裝精確。
 * 另外 `PAYEMS` 原本寫「次月第一個週五」是**錯的** —— 2026-07-02 是週四。
 */
const RELEASE_RULE: Record<string, { from: number; to: number }> = {
  PAYEMS: { from: 2, to: 8 },
  UMCSENT: { from: 1, to: 3 },
  CPILFESL: { from: 10, to: 14 },
  PPIFES: { from: 11, to: 15 },
  PCEPILFE: { from: 25, to: 30 },
}

export interface ReleaseWindow {
  /** 'YYYY-MM-DD'，區間起 */
  from: string
  /** 'YYYY-MM-DD'，區間迄 */
  to: string
  /** 供畫面顯示的短字串，如 '08-10 ~ 14' */
  label: string
}

/**
 * 給定指標與它「已取得的最新期別」，推估下一期的發布區間。
 * 回 null 代表沒有規則（不認得的指標）或期別格式怪異 —— 此時畫面顯示「待定」。
 */
export function estimateNextRelease(id: string, latestPeriod: string | null): ReleaseWindow | null {
  const rule = RELEASE_RULE[id]
  if (!rule || !latestPeriod) return null
  const m = /^(\d{4})-(\d{2})$/.exec(latestPeriod)
  if (!m) return null
  // 資料期別的次月才是發布月：已有 2026-06 時，下一期是 2026-07，於 2026-08 發布
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + 2
  const y = Math.floor(total / 12)
  const mon = (total % 12) + 1
  const p = (n: number) => String(n).padStart(2, '0')
  const ym = `${y}-${p(mon)}`
  return {
    from: `${ym}-${p(rule.from)}`,
    to: `${ym}-${p(rule.to)}`,
    label: `${p(mon)}-${p(rule.from)} ~ ${p(rule.to)}`,
  }
}

/**
 * 落後幾期。0 代表沒落後。
 *
 * 畫面上「落後一期」與「落後三期」是完全不同的意思：前者多半只是還沒發布，
 * 後者代表來源可能停更了（實測 UMCSENT 就是如此 —— 依規律 2026-06 該在
 * 07-01 就發布，但 07-01 / 07-15 / 07-31 三個 vintage 全都還停在 2026-05）。
 */
export function periodsBehind(period: string | null, peerLatest: string | null): number {
  if (!period || !peerLatest) return 0
  const a = /^(\d{4})-(\d{2})$/.exec(period)
  const b = /^(\d{4})-(\d{2})$/.exec(peerLatest)
  if (!a || !b) return 0
  const ma = Number(a[1]) * 12 + Number(a[2])
  const mb = Number(b[1]) * 12 + Number(b[2])
  return Math.max(0, mb - ma)
}

/**
 * 每個排程實際抓什麼。畫面上光看 `generate-all` 這種代號看不出範圍，
 * 而「這一班到底負責哪些資料」正是排查時第一個要問的問題。
 *
 * 內容對照 `sources/supabase/functions/stock-report/index.ts` 的各 handler，
 * 改動那邊的抓取範圍時**這裡要跟著改**。
 */
export const ACTION_SCOPE: Record<string, string> = {
  'generate-all':
    '持股台股的三大法人 / 融資融券 / 借券 + 日 K 線 + 估值 + 月營收 + 新聞，寫入盤後報告',
  probe: '只探測估值檔與借券檔是否已更新，不寫報告（供調整排程時參考）',
  'sync-macro': 'FRED 五個序列：核心 CPI / PPI / PCE、非農就業、消費者信心',
  'sync-fx': 'Yahoo 八個幣對：USD / JPY / EUR / CNY / HKD / GBP / AUD / KRW 對台幣',
  'backfill-revenue': '公開資訊觀測站的分月營收，補齊個股缺漏的月份',
}

/** 排程的抓取範圍說明；不認得的 action 回空字串（畫面就不顯示那一行） */
export function describeScope(action: string | null): string {
  return (action && ACTION_SCOPE[action]) || ''
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
