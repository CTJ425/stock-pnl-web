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
 * 判定的輪次緩衝（小時）。盤後批次是每 15 分一輪，`dueBy` 指的是「哪一輪」
 * 而不是精確到秒的時刻。
 *
 * ⚠️ 少了它會出現這種畫面：三大法人 `dueBy` 是 1.5（＝16:30 那輪），
 * 而 16:30 那輪實際在 **16:30:03** 才寫入 —— 1.5009 > 1.5，**差三秒被判成延遲**，
 * 而同一時刻抓到的日 K 線卻因為 `dueBy` 是 2 而顯示正常。
 * 同一刻抓到卻一紅一綠，看起來就是壞的。
 */
export const ROUND_GRACE_HOURS = 0.25

/**
 * 判定單一資料源的狀態。
 *
 * 沒拿到時，**還沒到 `dueBy` 就是 idle（等待中）而不是 late** ——
 * 每天傍晚都有一段時間資料本來就還沒公布，那時亮紅燈只會讓人學會忽略它。
 *
 * 拿到了則以 `dueBy + ROUND_GRACE_HOURS` 為界：只要落在那一輪之內就算準時。
 */
export function judgeSource(
  spec: ChainSpec,
  fetchedHour: number | null,
  nowHour: number,
  partial = false,
): SourceState {
  const deadline = spec.dueBy + ROUND_GRACE_HOURS
  if (fetchedHour === null) return nowHour > deadline ? 'late' : 'idle'
  if (partial) return 'warn'
  return fetchedHour > deadline ? 'late' : 'ok'
}

/*
 * 月頻指標的期別判定（`judgePeriod` / `latestPeriod` / `periodsBehind`）已移到
 * `components/Macro/macroPeriod.ts` —— 那是總經資料本身的領域邏輯，
 * 這一頁只是借來監看。總經頁的指標卡也要用同一套判定，留在 Admin 會讓依賴反向。
 */

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

/**
 * ISO 時間 → 台北當地的日期與當日小時數（0–24，含小數）。
 * 時間戳壞掉或空值回 null，呼叫端一律當成「沒有這個時刻」。
 *
 * 回傳日期而不只是小時：班次軸只畫「今天」，呼叫端得先確認這個時刻確實落在今天。
 */
export function taipeiParts(
  iso: string | null | undefined,
): { ymd: string; hour: number } | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const tp = new Date(t + 8 * 3600_000)
  const ymd = `${tp.getUTCFullYear()}${String(tp.getUTCMonth() + 1).padStart(2, '0')}${String(tp.getUTCDate()).padStart(2, '0')}`
  return { ymd, hour: tp.getUTCHours() + tp.getUTCMinutes() / 60 }
}

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

/*
 * 發布日推估已移除（0.6.17）。
 *
 * 那份 `RELEASE_RULE` 是前端自己依實測歸納的區間，與後端 `macroCalendar.ts` 的
 * 官方行事曆是**兩份會漂移的常數** —— 而漂移的症狀（畫面說 8/12、後端卻按 8/14
 * 判定）幾乎不可能從畫面上看出來。
 *
 * 現在由 `admin-status` 直接回傳每個指標的 `nextRelease`，單一真相來源在後端。
 */

/**
 * 每個排程實際抓什麼。畫面上光看 `generate-all` 這種代號看不出範圍，
 * 而「這一班到底負責哪些資料」正是排查時第一個要問的問題。
 *
 * 內容對照 `sources/supabase/functions/stock-report/index.ts` 的各 handler，
 * 改動那邊的抓取範圍時**這裡要跟著改**。
 */
export const ACTION_SCOPE: Record<string, string> = {
  'generate-all':
    '持股台股的三大法人 / 融資融券 / 借券 + 日 K 線 + 估值 + 月營收 + 獲利能力，寫入盤後報告',
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
