/**
 * The coordinates and judgment of the "data capture status" timeline (pure function, convenient for independent testing).
 *
 * The range of the time axis is **15:00 of the current day → 10:00** of the next day** (19 hours): Taiwan stocks close to the opening of the next day,
 * Covers the announcement times of all three chip sources (legal persons 15:00, margin trading 21:00, and securities borrowing 21:00–22:30)
 * and a make-up round the next morning.
 *
 * **The criterion is "the first batch after the announcement window ends", not the announcement time. **
 * The three major legal entities were announced between 15:00 and 15:30, but we only caught it at 16:15. Based on the announcement time, it would be "45 minutes late"——
 * However, the after-hours batch originally started at 16:00, which is due to scheduling design and not an anomaly.
 * On the other hand, if you ran 32 rounds on the night you borrowed the ticket but failed to catch it, and only made up for it the next day, then the light should be turned on.
 * The judgment must be based on things that we can control, which has the same origin as BUG-008: use the external release schedule as the benchmark,
 * You will only get a yellow light that is always on, and an alarm that is always on means no alarm.
 */

export type SourceState = 'ok' | 'warn' | 'late' | 'idle'

/** Timeline starting point (hour in Taipei time) and total length*/
export const TL_START_HOUR = 15
export const TL_SPAN_HOURS = 19

export interface ChainSpec {
  id: 'institutional' | 'market' | 'daily' | 'margin' | 'borrow'
  label: string
  hint: string
  /** Source announcement window, [from, to], the unit is "the number of hours from 15:00 on the current day"*/
  window: [number, number]
  /** Grace deadline: If you don’t get it before this time, it will be considered a delay. It corresponds to the batch shift rather than the announced time.*/
  dueBy: number
}

/**
 * Taiwan stocks after-hours chain. The order is the order of the pictures (in order of publication time).
 *
 * How to get `dueBy` (0.7.2 sparse schedule): last planned shift for that source, with a small grace.
 * - T86: generate-chips at 16:30 / 16:45 → dueBy 16:45 (1.75h from 15:00)
 * - BFI82U: market-daily at 15:30 / 15:45 → dueBy 15:45 (0.75h); grace → 16:00
 * - margin: evening 21:30 / 21:45; announce window still ~21–22h → dueBy 22:00 (7)
 * - borrow: same evening shifts; announce window can run to ~22:30 → dueBy 22:30 (7.5)
 * - daily K / fund: not on auto cron in 0.7.2 experiment (admin manual); soft dueBy near old afternoon window
 */
export const TW_CHAIN: readonly ChainSpec[] = [
  // "Individual stocks" and "whole market" should be marked in the name: both are called the three major legal persons, but one is T86 (each holding, unit stock),
  // One is BFI82U (entire concentrated market, unit yuan). 0.6.33 Previously, only "three major legal persons" were written.
  // Users therefore believe that the entire market has also been monitored.
  { id: 'institutional', label: '三大法人・個股', hint: 'T86', window: [0, 0.5], dueBy: 1.75 },
  /*
    market-daily is sparse since 0.7.2: Taipei **15:30 / 15:45** only (was dense 15:00–18:45).
    dueBy = last planned shift; if both miss, timeline warns — that is the point of the experiment.
  */
  { id: 'market', label: '三大法人・全市場', hint: 'BFI82U', window: [0, 0.5], dueBy: 0.75 },
  { id: 'daily', label: '日 K 線・估值', hint: '每檔持股', window: [1, 1.5], dueBy: 2 },
  { id: 'margin', label: '融資融券', hint: 'MI_MARGN', window: [6, 7], dueBy: 7 },
  { id: 'borrow', label: '借券賣出', hint: '次一交易日', window: [6, 7.5], dueBy: 7.5 },
]

/**
 * The target trading day for this round = the **maximum** of known data days from each source (0.6.36-dev.2).
 *
 * Previously, the "data date of the individual stock chip report" was used as the basis for the entire axis, but the five columns on the axis came from different batches:
 * T86 for individual stocks is available in post-market batches (available only at 16:30), and BFI82U for the entire market is available independently market-daily (available at 16:00).
 * The column running faster was used as the origin "yesterday 15:00" to calculate the coordinates - 2026-08-05 What actually happened:
 * The whole market arrived on time at 16:00 on the same day, but it was calculated as 25 hours, was clamped to the right end of the axis, and was judged to be late.
 * The punctual source lights up red, which means the alarm is invalid.
 *
 * Take max instead of checking the trading calendar: there is no new data on weekends and holidays, and the base day naturally stops at the last trading day;
 * The first source available after the close pushed it forward to today. One less holiday schedule to maintain.
 * The price is 15:00–16:00 (closed but no source has been received yet) and the previous round is still displayed——
 * During that period, there were no events of this cycle to draw.
 *
 * ⚠️ **The date of borrowing the bond cannot be put in**: it self-reports the **announcement date** (the next trading day),
 * It is born one day longer than the current round (`batch_run_log` can be seen that `borrow_data_date` is the next day and `data_ymd` is the current round).
 * Putting it in will make the base date one day earlier, and the other four columns of the entire axis will all become "not received".
 *
 * @param dates 'YYYY-MM-DD' format; formats that do not match or empty values ​​will be ignored
 */
export function roundBaseYmd(dates: ReadonlyArray<string | null | undefined>): string {
  let max = ''
  for (const d of dates) {
    if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > max) max = d
  }
  return max
}

/** Timeline scale (hours → labels)*/
export const TL_TICKS: ReadonlyArray<{ h: number; label: string }> = [
  { h: 0, label: '15:00' },
  { h: 3, label: '18:00' },
  { h: 6, label: '21:00' },
  { h: 9, label: '00:00' },
  { h: 12, label: '03:00' },
  { h: 15, label: '06:00' },
  { h: 18, label: '09:00' },
]

/** Hours → Percentage position on axis (clamped between 0–100, out-of-range events wrap instead of outside the container)*/
export function tlPercent(hour: number): number {
  const p = (hour / TL_SPAN_HOURS) * 100
  return Math.round(Math.min(100, Math.max(0, p)) * 100) / 100
}

/**
 * ISO time → Number of hours from "data day 15:00 (Taipei)". Cross days naturally count as > 24 − 15 = greater than 9.
 * If the timestamp or date is corrupted, null will be returned, and the caller will always display "Not Obtained".
 */
export function hoursFromBase(iso: string | null | undefined, baseYmd: string): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  const base = Date.parse(`${baseYmd}T${String(TL_START_HOUR).padStart(2, '0')}:00:00+08:00`)
  if (!Number.isFinite(t) || !Number.isFinite(base)) return null
  return (t - base) / 3_600_000
}

/** Hours → 'HH:mm', cross-day return 'HH:mm' next day*/
export function tlLabel(hour: number): string {
  const total = TL_START_HOUR * 60 + Math.round(hour * 60)
  const next = total >= 24 * 60
  const mins = next ? total - 24 * 60 : total
  const hh = String(Math.floor(mins / 60)).padStart(2, '0')
  const mm = String(mins % 60).padStart(2, '0')
  return next ? `次日 ${hh}:${mm}` : `${hh}:${mm}`
}

/**
 * Decision round buffer (hours). The after-hours batch is one round every 15 minutes, `dueBy` refers to "which round"
 * Rather than precise to the second.
 *
 * ⚠️ Without it, this picture will appear: `dueBy` of the three major legal persons is 1.5 (=16:30 round),
 * And the 16:30 round was actually written at **16:30:03** - 1.5009 > 1.5, **three seconds difference was judged as delay**,
 * However, the daily K-line captured at the same time displays normally because `dueBy` is 2.
 * One red and one green when caught at the same moment looks bad.
 */
export const ROUND_GRACE_HOURS = 0.25

/**
 * Determine the status of a single data source.
 *
 * When it is not obtained, ** has not arrived yet and `dueBy` is idle (waiting) instead of late** ——
 * There is a period of time every evening when the information has not been released to begin with, and turning on the red light at that time will only make people learn to ignore it.
 *
 * If you get it, the limit is `dueBy + ROUND_GRACE_HOURS`: as long as it falls within that round, it is considered on time.
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
 * The period judgment of monthly frequency indicators (`judgePeriod` / `latestPeriod` / `periodsBehind`) has been moved to
 * `components/Macro/macroPeriod.ts` - that is the domain logic of the general data itself,
 * This page is only borrowed for monitoring. The indicator card on the general page must also use the same set of judgments. Leaving it in Admin will reverse the dependence.
 */

/** Millisecond difference → '3h 40m' / '38s' / '19d 20h'*/
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
   Macro shift axis (M1). The horizontal axis is one whole Taipei day, 00:00 → 24:00.
   ────────────────────────────────────────────────────────────── */

/**
 * ISO time → Taipei local date and hour of the day (0–24, including decimals).
 * If the timestamp is corrupted or returns null, the caller will treat it as "there is no such time".
 *
 * Return the date instead of just the hour: only "today" is drawn on the shift axis, and the caller must first confirm that this time indeed falls on today.
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

/** Taipei hour (0–24) → percentage on 24-hour axis*/
export function dayPercent(hour: number): number {
  return Math.round(Math.min(24, Math.max(0, hour)) / 24 * 10000) / 100
}

/**
 * cron expression → fire times as Taipei hours (0–24, may be fractional).
 *
 * Supports:
 * - fixed hours daily `0 H,H * * *` (legacy macro two-shift; fx-daily)
 * - step over UTC hour range, e.g. every 30 min 12-18 UTC (macro-daily dense → Taipei 20:00–02:30)
 *
 * Unrecognised shapes return [] so the UI does not invent shifts.
 */
export function cronHoursTaipei(expr: string): number[] {
  const raw = expr.trim()
  const fixed = /^0\s+([\d,]+)\s+\*\s+\*\s+\*$/.exec(raw)
  if (fixed) {
    return fixed[1]
      .split(',')
      .map((h) => (Number(h) + 8) % 24)
      .sort((a, b) => a - b)
  }

  // e.g. */30 12-18 * * *  (minutes step + UTC hour range, every day)
  const step = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+\*$/.exec(raw)
  if (step) {
    const stepMin = Number(step[1])
    const fromH = Number(step[2])
    const toH = Number(step[3])
    if (!(stepMin > 0 && stepMin <= 60 && fromH <= toH)) return []
    const out: number[] = []
    for (let h = fromH; h <= toH; h++) {
      for (let m = 0; m < 60; m += stepMin) {
        // Standard cron: every listed hour gets every step minute (:00, :30, …).
        const taipei = ((h + 8) % 24) + m / 60
        out.push(taipei)
      }
    }
    // Unique + sort (overnight windows still work with nextRun: e.g. 20…23.5 then 0…2.5).
    return [...new Set(out.map((x) => Math.round(x * 60) / 60))].sort((a, b) => a - b)
  }

  return []
}

/**
 * executed next time. `hours` is the shift time of the day, `nowHour` is now (Taipei hours).
 * If there is no shift today, return to the first shift tomorrow (`tomorrow: true`).
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

/** Number of hours (can be decimal) → 'HH:mm'*/
export function hourLabel(hour: number): string {
  const total = Math.round(((hour % 24) + 24) % 24 * 60)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Duration → '6h 40m' / '25m'*/
export function durationLabel(hours: number): string {
  const m = Math.max(0, Math.round(hours * 60))
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/*
 * Release day estimates have been removed (0.6.17).
 *
 * That `RELEASE_RULE` is the range summarized by the front-end itself based on actual measurements, and is the same as that of the back-end `macroCalendar.ts`
 * The official calendar is **two constants that will drift** - and the symptoms of drift (the screen says 8/12, but the backend says 8/14
 * Judgment) is almost impossible to see from the screen.
 *
 * The `nextRelease` for each metric is now returned directly by `admin-status`, with a single source of truth in the backend.
 */

/**
 * What each schedule actually captures. Looking at the screen, the scope of the code name `generate-all` cannot be seen.
 * And "What data is this class responsible for?" is the first question to be asked during the investigation.
 *
 * The content is compared with each handler of `sources/supabase/functions/stock-report/index.ts`,
 * When changing the crawling range there, you need to change it here.
 */
export const ACTION_SCOPE: Record<string, string> = {
  'generate-all':
    '（相容入口）依序 chips → market-data → history，單一 HTTP 有算力預算；線上 cron 自 0.7.2 改打 phase，避免 cloud 546',
  'generate-chips':
    '全站淨持股台股籌碼：T86／融資融券／借券、組報告上傳。' +
    '稀疏班 16:30／16:45（T86）與 21:30／21:45（融資借券）；不與日K／歷史同請求',
  'generate-market-data':
    '持股日 K + 估值／產業等（syncDaily + syncFundamental）；0.7.2 實驗版未掛自動 cron，可手動',
  'generate-history':
    '一輪月營收+季報補齊；0.7.2 實驗版未掛自動 cron，可手動（完整 12/12 靠多輪）',
  /*
    market-daily / sync-market (0.6.44-dev.3 made the label explicit — ACTION_SCOPE had no
    entry before, so the schedule table showed only the code name). Three TWSE sources,
    one shared file market/daily.json; not per-ticker (unlike generate-all).
  */
  'sync-market':
    '全市場（非個股）：FMTQIK 成交量／值／筆數與加權收盤；MI_5MINS_HIST 加權開高低；' +
    'BFI82U 三大法人買賣超金額（外資／投信／自營，含買賣分開）。寫入 market/daily.json。' +
    '0.7.2：15:30／15:45 兩班；當日列齊後短路零外部請求',
  probe: '只探測估值檔與借券檔是否已更新，不寫報告（供調整排程時參考）',
  'sync-macro':
    'FRED：核心 CPI / PPI / PCE、FOMC 目標利率區間（DFEDTARU/L）、非農就業、消費者信心',
  'sync-fx': 'Yahoo 八個幣對：USD / JPY / EUR / CNY / HKD / GBP / AUD / KRW 對台幣',
  'backfill-revenue': '公開資訊觀測站的分月營收，補齊個股缺漏的月份',
}

/** Description of the schedule's fetching range; an unrecognized action returns an empty string (that line will not be displayed on the screen)*/
export function describeScope(action: string | null): string {
  return (action && ACTION_SCOPE[action]) || ''
}

/** The health of the cron schedule: it can be seen if it is disabled, has failed today, or has never been run.*/
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
 * cron expression → plain language (converting UTC to Taipei on the way).
 *
 * One branch per shift shape actually used in this project. An unrecognised shape is **marked, not silently
 * echoed** (0.6.43, AUDIT-05): returning the bare expression was still the honest thing to do —— better a cron
 * string than a mistranslated sentence —— but on screen it looked like a deliberate rendering, so nobody could
 * tell a missing branch from a design decision. BUG-012 and BUG-014 both hid there, the second for months.
 * With the prefix, the next unmatched shape announces itself the moment it appears.
 */
export const UNPARSED_CRON_PREFIX = '未解析的排程 '
export function describeCron(expr: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  // Last firing minute of a step range: a 15-minute step ends at :45, a 30-minute one at :30. This used to be
  // the literal 45 —— right for the only job that had this shape, silently wrong for any other step.
  const lastMinute = (step: number) => (step > 0 && step < 60 ? 60 - step : 0)

  const w = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (w) {
    const from = (Number(w[2]) + 8) % 24
    const to = (Number(w[3]) + 8) % 24
    return `週一至週五 ${p(from)}:00–${p(to)}:${p(lastMinute(Number(w[1])))} 每 ${w[1]} 分`
  }
  // Same step syntax but every day, not just weekdays —— `macro-daily`. Without this branch it printed the raw
  // cron string: the same defect as BUG-012, on a different row of the same table, found while verifying that fix.
  //
  // This one can cross midnight in Taipei: 12–18 UTC becomes 20:00 through 02:30 the next day, so the end needs
  // the 次日 marker. Without it the row reads "每日 20:00–02:30", which looks like it runs in the morning.
  const dw = /^\*\/(\d+)\s+(\d+)-(\d+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (dw) {
    const step = Number(dw[1])
    const from = (Number(dw[2]) + 8) % 24
    const toTotal = Number(dw[3]) + 8
    const end = `${p(toTotal % 24)}:${p(lastMinute(step))}`
    return `每日 ${p(from)}:00–${toTotal >= 24 ? '次日 ' : ''}${end} 每 ${step} 分`
  }
  const d = /^0\s+([\d,]+)\s+\*\s+\*\s+\*$/.exec(expr)
  if (d) {
    const hours = d[1]
      .split(',')
      .map((h) => `${String((Number(h) + 8) % 24).padStart(2, '0')}:00`)
      .join(' / ')
    return `每日 ${hours}`
  }
  // Hourly range on the hour, weekdays only (market-daily is `0 8-10 * * 1-5`).
  // Without this item, this class will print out the original cron string in the schedule - it is the only one that cannot understand the whole table.
  const r = /^0\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (r) {
    const from = Number(r[1])
    const to = Number(r[2])
    const hours: string[] = []
    for (let h = from; h <= to; h++) hours.push(`${String((h + 8) % 24).padStart(2, '0')}:00`)
    return `週一至週五 ${hours.join(' / ')}`
  }
  /*
    Minute list within an hour range, weekdays —— `market-daily` became `0,30 7-10 * * 1-5` in 0.6.38.
    Without this branch the admin schedule printed the raw cron string, so the page never mentioned 15:00
    and the whole table had one row nobody could read. Listing every shift would be eight entries, hence
    a range plus the step, the same shape as the step-syntax branch at the top.

    It is deliberately below the single-minute branch above: `0 8-10 * * 1-5` must keep listing its shifts
    one by one (three of them reads better than "每 60 分"), so this one demands at least one comma.
  */
  const s = /^(\d+(?:,\d+)+)\s+(\d+)-(\d+)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (s) {
    const mins = s[1].split(',').map(Number).sort((a, b) => a - b)
    const first = `${p((Number(s[2]) + 8) % 24)}:${p(mins[0])}`
    const last = `${p((Number(s[3]) + 8) % 24)}:${p(mins[mins.length - 1])}`
    return `週一至週五 ${first}–${last} 每 ${mins[1] - mins[0]} 分`
  }
  /*
    Sparse fixed shifts (0.7.2): minute list × hour list, weekdays.
    - market-daily `30,45 7 * * 1-5` → 15:30 / 15:45
    - stock-report-nightly `30,45 8,13 * * 1-5` → 16:30 / 16:45 / 21:30 / 21:45
    List every Taipei clock time; a range would hide the evening gap.
  */
  const sparse = /^(\d+(?:,\d+)+)\s+(\d+(?:,\d+)*)\s+\*\s+\*\s+1-5$/.exec(expr)
  if (sparse) {
    const mins = sparse[1].split(',').map(Number)
    const hours = sparse[2].split(',').map(Number)
    const labels: string[] = []
    for (const h of hours) {
      for (const m of mins) {
        labels.push(`${p((h + 8) % 24)}:${p(m)}`)
      }
    }
    return `週一至週五 ${labels.join(' / ')}`
  }
  return `${UNPARSED_CRON_PREFIX}${expr}`
}
