/**
 * Data Fetch Status page (visible to administrators only).
 *
 * Why the timeline is the main body: The release time difference of the three chip sources after the Taiwan stock market is up to 7 hours
 * (15:00 for legal persons, 21:00 for margin trading, and 21:00–22:30 for borrowing securities). The batches are divided into sections.
 * Cards or forms can tell "whether it has arrived", but cannot tell "whether the thing that is supposed to come has arrived or how long it has been delayed" -
 * And that's the only information that matters when troubleshooting scheduling problems.
 *
 * The monthly general statistics and infrastructure are not placed on the daily axis: their rhythm is "which issue is coming" rather than "what time is it coming".
 * Shouting a timeline only makes the semantics of the axis blurry. Therefore, it is divided into three sections: Timeline → Scheduling → Periods and Infrastructure.
 *
 * The decision rules and coordinate calculations are all in `timeline.ts` (pure function, with tests), and are only presented here.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react'
import {
  fetchAdminStatus,
  type AdminStatus,
  type ScheduleRow,
  type SourceStamp,
} from '../../services/adminStatus'
import { fmtUpdatedAt } from '../StockDetail/chipFormat'
import {
  TL_SPAN_HOURS,
  TL_TICKS,
  TW_CHAIN,
  cronHoursTaipei,
  dayPercent,
  describeCron,
  describeScope,
  durationLabel,
  hourLabel,
  hoursFromBase,
  humanAgo,
  judgeCron,
  judgeSource,
  nextRun,
  roundBaseYmd,
  taipeiParts,
  tlLabel,
  tlPercent,
  type SourceState,
} from './timeline'
import { judgePeriod, latestPeriod, periodsBehind } from '../Macro/macroPeriod'

const STATE_TEXT: Record<SourceState, string> = {
  ok: '正常',
  warn: '注意',
  late: '延遲',
  idle: '等待中',
}

const SECTION_PAD = { padding: '18px 20px' }

/** The time at which the grid line is to be drawn on the 24-hour axis (the scale also contains 0, which is represented by the left edge of the container)*/
const DAY_GRID = [6, 12, 18, 21]

function Pill({ state, text }: { state: SourceState; text?: string }) {
  return <span className={`ast-pill ast-${state}`}>{text ?? STATE_TEXT[state]}</span>
}

/** How long since now, for example: '3h 40m'*/
function agoLabel(iso: string): string {
  return humanAgo(Date.now() - Date.parse(iso))
}

/**
 * A column along the general shift axis. In the three columns (Eastern US Release/Shift/Last Change of Data), only the track is different from the content in the right column.
 * The grid line and the "now" line must be consistent in three columns - if one is missing, it will be regarded as the data misalignment axis.
 */
function DayRow({
  label,
  hint,
  nowHour,
  end,
  children,
}: {
  label: string
  hint: string
  nowHour: number | null
  end: ReactNode
  children: ReactNode
}) {
  return (
    <div className="ast-row">
      <div className="ast-lbl">
        <b>{label}</b>
        <span>{hint}</span>
      </div>
      <div className="ast-track">
        {DAY_GRID.map((h) => (
          <i className="ast-grid" key={h} style={{ left: `${dayPercent(h)}%` }} />
        ))}
        {nowHour !== null && <i className="ast-now" style={{ left: `${dayPercent(nowHour)}%` }} />}
        {children}
      </div>
      <div className="ast-end">{end}</div>
    </div>
  )
}

/**
 * A bracketed paragraph for the probe column number. Put the whole paragraph together, do not split it into two conditional expressions——
 * If only one of the items has a value, "(Valuation 1081 column" without the closing bracket will be printed.
 */
function probeRows(probe: AdminStatus['probe']): string {
  const parts: string[] = []
  if (probe?.bwibbu_rows != null) parts.push(`估值 ${probe.bwibbu_rows} 列`)
  if (probe?.borrow_rows != null) parts.push(`借券 ${probe.borrow_rows} 列`)
  return parts.length ? `（${parts.join('、')}）` : ''
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' (manifest uses undelimited format)*/
function dashYmd(ymd: string | undefined): string {
  if (!ymd || ymd.length !== 8) return ''
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

export function AdminStatusPage() {
  const [data, setData] = useState<AdminStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const d = await fetchAdminStatus()
    setData(d)
    setFailed(d === null)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /*
    The axis is based on the **data day**, not today —— events picked up the next morning must land on the same
    axis. Since 0.6.36-dev.2 it takes the **maximum data day across sources** (see roundBaseYmd in timeline.ts):
    binding to one source lets the fastest row (market-wide, on its own schedule) compute a cross-day coordinate.
  */
  const baseYmd = useMemo(
    () =>
      roundBaseYmd([
        dashYmd(data?.chip?.ymd ?? data?.manifest?.ymd),
        data?.chip?.dataDate,
        data?.chip?.sources?.institutional?.date,
        data?.chip?.sources?.margin?.date,
        data?.market?.latestInstitutionalDate,
      ]),
    [data],
  )

  const chain = useMemo(() => {
    if (!data || !baseYmd) return []
    const src = data.chip?.sources ?? null
    const held = data.coverage.held ?? 0
    const nowHour = hoursFromBase(data.asOf, baseYmd) ?? 0
    return TW_CHAIN.map((spec) => {
      // There is no sources entry for the daily K-line: it is written in the same batch as the three major legal persons, and the timestamp is shared.
      // Whether it is complete or not depends on whether the number of files in the daily/ directory has caught up with the number of holdings.
      let stamp: SourceStamp | null = null
      let partial = false
      let cover: string | null = null
      if (spec.id === 'daily') {
        const n = data.coverage.daily ?? 0
        stamp = src?.institutional ?? null
        partial = held > 0 && n < held
        cover = held > 0 ? `${n} / ${held} 檔` : null
      } else if (spec.id === 'market') {
        /*
          Market-wide institutional data is not in chip.sources (that is written by the per-stock batch), so it
          is read from market/daily.json.

          ⚠️ The time shown approximates **when the file was produced**, not when that day's institutional
          amounts actually arrived: a 17:00 round advances asOf even if it only refreshed turnover. Getting it
          per-day would need an institutionalFetchedAt column in the schema, and every existing day would have
          it empty anyway. The hint on screen therefore says 檔案產出, so nobody reads it as the fetch moment.
        */
        stamp = data.market
          ? { date: data.market.latestInstitutionalDate, fetchedAt: data.market.asOf }
          : null
        /*
          **Deliberately not using partial** (different from daily): Legal persons are replenished on a daily basis. It is normal for the latest one or two days not to be replenished.
          Treating that as "incomplete" would leave this row amber almost every day. The number of days still to
          fill is already spelled out in the 台股全市場 KPI below; this axis only answers "was the file produced on time".
        */
        // The subscript must also explain the source and "this moment is the file output, not the legal person's acquisition", so there is no need to specify spec.hint
        cover = 'BFI82U・檔案產出時間'
      } else {
        stamp = src?.[spec.id] ?? null
      }
      /*
        A timestamp outside this round's axis range belongs to another round —— treat it as not received and let
        judgeSource decide by dueBy. The previous round's timestamp must not be used for coordinates: when the
        per-stock T86 is still on yesterday it computes −22.5 hours, gets clamped to 0 by tlPercent (far left of
        the axis) and looks like it arrived absurdly early.

        Membership of the round is decided by timestamp rather than by comparing `date`, because `date` means
        different things per row: securities borrowing self-reports the **announcement date** (the next trading
        day) and is naturally one day ahead —— comparing it would make the one row that should be red look fine.
      */
      const raw = hoursFromBase(stamp?.fetchedAt ?? null, baseYmd)
      const inRound = raw !== null && raw >= 0 && raw <= TL_SPAN_HOURS
      const h = inRound ? raw : null
      return {
        spec,
        state: judgeSource(spec, h, nowHour, inRound && partial),
        hour: h,
        // The date of the other round has no meaning on this axis and is not displayed to avoid being read that the current round has been obtained.
        date: inRound ? stamp?.date ?? null : null,
        cover,
      }
    })
  }, [data, baseYmd])

  const macroPeer = useMemo(
    () => latestPeriod((data?.macro?.indicators ?? []).map((i) => i.latest?.period)),
    [data],
  )

  /** Determination of lagging behind each general economic indicator. The three places (conclusion count, next release, table) must be the same judgment*/
  const macroRows = useMemo(
    () =>
      (data?.macro?.indicators ?? []).map((indicator) => ({
        indicator,
        state: judgePeriod(indicator.latest?.period ?? null, macroPeer),
      })),
    [data, macroPeer],
  )

  /** What hour is it in Taipei now (0–24), used for determining the "now" line and flight*/
  const nowHour = useMemo(() => taipeiParts(data?.asOf)?.hour ?? null, [data])

  /** The shift time of macro-daily and whether they have run there today*/
  const macroShifts = useMemo(() => {
    const job = (data?.schedules ?? []).find((s) => s.action === 'sync-macro')
    if (!job || nowHour === null) return []
    return cronHoursTaipei(job.schedule).map((hour) => ({ hour, done: nowHour >= hour }))
  }, [data, nowHour])

  const macroNext = useMemo(
    () => (nowHour === null ? null : nextRun(macroShifts.map((s) => s.hour), nowHour)),
    [macroShifts, nowHour],
  )

  /** The hour of today when the last data change occurred; if it is not today, return null (the axis only draws today)*/
  const macroChangedHour = useMemo(() => {
    const tp = taipeiParts(data?.macro?.asOf)
    if (!tp || tp.ymd !== data?.todayYmd) return null
    return tp.hour
  }, [data])

  /** The most recent release: take the earliest date calculated by the backend*/
  const nextRelease = useMemo(() => {
    const cands = macroRows
      .filter((r) => r.indicator.nextRelease)
      // The indicator that is lagging behind has not even been released in the previous period, and its "next period" has no reference value.
      .filter((r) => r.state !== 'warn')
      .sort((a, b) => a.indicator.nextRelease!.date.localeCompare(b.indicator.nextRelease!.date))
    const top = cands[0]?.indicator
    return top ? { ...top.nextRelease!, label: top.label } : null
  }, [macroRows])

  if (loading && !data) {
    return (
      <div className="section glass" style={SECTION_PAD}>
        正在讀取資料抓取狀況…
      </div>
    )
  }

  if (failed || !data) {
    return (
      <div className="section glass" style={SECTION_PAD}>
        <h3 className="head-tight">讀不到資料抓取狀況</h3>
        <p className="ast-note">
          這一頁只有管理員帳號看得到。若你確定帳號有管理員權限，可能是後端尚未部署最新版本。
        </p>
        <button className="btn btn-sm" onClick={() => void load()}>
          重新整理
        </button>
      </div>
    )
  }

  const attention =
    chain.filter((c) => c.state === 'late' || c.state === 'warn').length +
    (data.schedules ?? []).filter(
      (s) => judgeCron(s.active, s.failsToday, s.lastRun) !== 'ok',
    ).length +
    macroRows.filter((r) => r.state === 'warn').length

  // The fetch cycle is taken directly from pg_cron, without writing another constant on the front end - the two copies will drift sooner or later, and the drift cannot be seen
  const marketCron = (data.schedules ?? []).find((s) => s.jobname === 'market-daily') ?? null
  /*
    Same reason for the after-hours batch (0.6.40): the timeline legend used to state "16:00–23:45 每 15 分" as
    a literal. It was still true, but it was a second copy of a value that lives in pg_cron —— and 0.6.38 had
    just proved how that ends (BUG-012). Read it from the schedule like everything else.
  */
  const nightlyCron =
    (data.schedules ?? []).find((s) => s.jobname === 'stock-report-nightly') ?? null

  return (
    <>
      {/* ── Conclusion first ──────────────────────────────── */}
      <div className="section glass ast-verdict" style={{ padding: '16px 20px' }}>
        <ShieldCheck size={18} className="ast-verdict-icon" />
        <h3 className="head-tight">
          {attention === 0 ? '所有資料源都在預期時間內取得' : `有 ${attention} 項需要注意`}
        </h3>
        <span className="source-tag section-stamp">
          資料日 {data.chip?.dataDate || dashYmd(data.manifest?.ymd) || '—'}・更新於{' '}
          {fmtUpdatedAt(data.asOf)}
        </span>
        <button className="btn btn-sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : undefined} />
          重新整理
        </button>
      </div>

      {/* ── Taiwan after-hours timeline ───────────────────── */}
      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          {/* Title and axis coordinates must share one base day, or the title says 8/4 while the axis plots 8/5 */}
          <h3 className="head-tight">台股盤後・{baseYmd || '—'} 這一輪</h3>
          <span className="source-tag">三個籌碼來源的公布時間差達 7 小時，批次是分段抓的</span>
        </div>

        <div className="ast-legend">
          <span>
            <i className="ast-lg-win" />
            來源公布窗
          </span>
          <span>
            <i className="ast-lg-dot ast-ok" />
            準時抓到
          </span>
          <span>
            <i className="ast-lg-dot ast-warn" />
            抓到但不完整
          </span>
          <span>
            <i className="ast-lg-dot ast-late" />
            延遲
          </span>
          <span className="ast-rule">
            淡色是<b>來源端的公布時間</b>（證交所何時公布），不是我們的抓取排程。
            這條軸上有<b>兩套排程</b>：個股的法人、日 K、融資融券、借券走盤後批次
            （{nightlyCron ? describeCron(nightlyCron.schedule) : '排程 stock-report-nightly'}）；
            <b>三大法人・全市場</b>走獨立排程
            （{marketCron ? describeCron(marketCron.schedule) : '排程 market-daily'}）。
            判定基準是<b>公布窗結束後的第一個班次</b>（含該輪的緩衝），
            所以法人 15:00 公布之後，全市場那列可能當天 15:00 那輪就到手，
            個股 T86 則要等 16:30 那輪，兩者都算正常。
          </span>
        </div>

        <div className="ast-tl-scroll">
          <div className="ast-tl">
            <div className="ast-ruler">
              {TL_TICKS.map((t) => (
                <span key={t.h} style={{ left: `${tlPercent(t.h)}%` }}>
                  {t.label}
                </span>
              ))}
              <em style={{ left: `${tlPercent(9)}%` }}>次日</em>
            </div>

            {chain.map(({ spec, state, hour, date, cover }) => (
              <div className="ast-row" key={spec.id}>
                <div className="ast-lbl">
                  <b>{spec.label}</b>
                  <span>{cover ?? spec.hint}</span>
                </div>
                <div className="ast-track">
                  {TL_TICKS.slice(1).map((t) => (
                    <i className="ast-grid" key={t.h} style={{ left: `${tlPercent(t.h)}%` }} />
                  ))}
                  {spec.window && (
                    <div
                      className="ast-win"
                      style={{
                        left: `${tlPercent(spec.window[0])}%`,
                        width: `${tlPercent(spec.window[1]) - tlPercent(spec.window[0])}%`,
                      }}
                    />
                  )}
                  {spec.window && hour !== null && hour > spec.dueBy && (
                    <div
                      className={`ast-lag ast-${state}`}
                      style={{
                        left: `${tlPercent(spec.window[1])}%`,
                        width: `${Math.max(0, tlPercent(hour) - tlPercent(spec.window[1]))}%`,
                      }}
                    />
                  )}
                  {hour !== null ? (
                    <>
                      <div className={`ast-hit ast-${state}`} style={{ left: `${tlPercent(hour)}%` }} />
                      <span className="ast-hit-t" style={{ left: `${tlPercent(hour)}%` }}>
                        {tlLabel(hour)}
                      </span>
                    </>
                  ) : (
                    <span className="ast-none">{STATE_TEXT[state]}</span>
                  )}
                </div>
                <div className="ast-end">
                  <Pill state={state} />
                  {/* Phones hide the axis (its right half is off-screen, so delays are invisible); the times are listed here instead */}
                  {hour !== null && <span className="ast-when">{tlLabel(hour)}</span>}
                  {date && <span className="ast-date">{date}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Schedules ─────────────────────────────────────── */}
      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          <h3 className="head-tight">排程</h3>
          <span className="source-tag">
            pg_cron・時間已換算為台北；「目標」是這個排程實際打的環境
          </span>
        </div>
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>排程名稱</th>
                <th>執行時機</th>
                <th>動作</th>
                <th>目標</th>
                <th className="num">今日</th>
                <th>最後執行</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {(data.schedules ?? []).map((s: ScheduleRow) => {
                const st = judgeCron(s.active, s.failsToday, s.lastRun)
                const scope = describeScope(s.action)
                return (
                  <tr key={s.jobid}>
                    <td>
                      <b>{s.jobname}</b>
                      {/* The action code alone does not say which data this shift is responsible for */}
                      {scope && <span className="ast-scope">{scope}</span>}
                    </td>
                    <td className="ast-mono">{describeCron(s.schedule)}</td>
                    <td className="ast-mono">{s.action ?? '—'}</td>
                    <td className="ast-mono">{s.targetRef ?? '—'}</td>
                    <td className="num">
                      {s.runsToday}
                      {s.failsToday > 0 && <span className="ast-fail"> / {s.failsToday} 失敗</span>}
                    </td>
                    <td className="ast-mono">
                      {s.lastRun ? fmtUpdatedAt(s.lastRun) : '—'}
                      {s.lastSource === 'manual' && (
                        <span className="ast-scope" title="由管理後台「手動更新」觸發">
                          手動
                        </span>
                      )}
                      {s.lastSource === 'cron' && s.lastRun && (
                        <span className="ast-scope" title="由 pg_cron 排程觸發">
                          排程
                        </span>
                      )}
                    </td>
                    <td>
                      <Pill state={st} text={s.active ? undefined : '已停用'} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="ast-note" style={{ marginTop: 10 }}>
          「今日／最後執行」含排程與後台<strong>手動更新</strong>；手動不會寫入 pg_cron
          的 job_run_details，但會記在 admin_run_log 並合併顯示。
        </p>
        {data.batch && (
          <p className="ast-note" style={{ marginTop: 6 }}>
            盤後批次今日第 {data.batch.runsToday ?? 0} 輪
            {data.probe?.taipei_time && `・探針最後探測 ${data.probe.taipei_time}`}
            {/* The parenthesised part is assembled as one piece: split into two conditionals it prints an unclosed bracket when only one side exists */}
            {probeRows(data.probe)}
          </p>
        )}
      </div>

      {/* ── Macro: the day's shift axis (read the same way as the Taiwan one above) ── */}
      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          <h3 className="head-tight">美國總體經濟・今日班次</h3>
          <span className="source-tag section-stamp">
            資料變動於 {fmtUpdatedAt(data.macro?.asOf)}
            {data.macro?.checkedAt && `・最後檢查 ${fmtUpdatedAt(data.macro.checkedAt)}`}
          </span>
        </div>

        <div className="ast-legend">
          <span>
            <i className="ast-lg-win" />
            美東發布時刻
          </span>
          <span>
            <i className="ast-lg-dot ast-ok" />
            已執行
          </span>
          <span>
            <i className="ast-lg-next" />
            尚未執行
          </span>
          <span className="ast-rule">
            BEA / BLS 在美東 8:30 發布 ＝ <b>夏令台北 20:30、冬令 21:30</b>。
            抓取時刻以 pg_cron 的 <code>macro-daily</code> 為準（排程表有白話）；
            密集掃描時每班都會問 FRED，內容變了才寫檔。
          </span>
        </div>

        <div className="ast-tl-scroll">
          <div className="ast-tl">
            <div className="ast-ruler ast-ruler-day">
              {[0, 6, 12, 18, 21].map((h) => (
                <span key={h} style={{ left: `${dayPercent(h)}%` }}>
                  {hourLabel(h)}
                </span>
              ))}
              <span style={{ left: '100%' }}>24:00</span>
            </div>

            {/* US release window: 20:30–21:30 covers both daylight-saving cases */}
            <DayRow
              label="美東發布"
              hint="8:30 ET"
              nowHour={nowHour}
              end={<span className="ast-when">夏令中</span>}
            >
              <div
                className="ast-win"
                style={{ left: `${dayPercent(20.5)}%`, width: `${dayPercent(1)}%` }}
              />
              <span className="ast-hit-t" style={{ left: `${dayPercent(21)}%` }}>
                夏令 20:30 / 冬令 21:30
              </span>
            </DayRow>

            {/*
              Few shifts (legacy two-slot cron): one row per hour.
              Dense scan (step every 30m over a UTC hour range): collapse — 14 half-hours is unreadable.
            */}
            {macroShifts.length > 0 && macroShifts.length <= 4
              ? macroShifts.map((s, i) => (
                  <DayRow
                    key={s.hour}
                    label={`第${i + 1}班`}
                    hint={hourLabel(s.hour)}
                    nowHour={nowHour}
                    end={
                      <Pill state={s.done ? 'ok' : 'idle'} text={s.done ? '已執行' : '待執行'} />
                    }
                  >
                    <div
                      className={s.done ? 'ast-hit ast-ok' : 'ast-next-run'}
                      style={{ left: `${dayPercent(s.hour)}%` }}
                    />
                    <span className="ast-hit-t" style={{ left: `${dayPercent(s.hour)}%` }}>
                      {hourLabel(s.hour)}・{s.done ? '已執行' : '尚未執行'}
                    </span>
                  </DayRow>
                ))
              : macroShifts.length > 4
                ? (() => {
                    const job = (data.schedules ?? []).find((s) => s.action === 'sync-macro')
                    // Overnight window sorts as 0…2.5 then 20…23.5 — bar from evening start only.
                    const evening = macroShifts.map((s) => s.hour).filter((h) => h >= 12)
                    const markAt = evening.length ? Math.min(...evening) : macroShifts[0]!.hour
                    const anyDone = macroShifts.some((s) => s.done)
                    const allDone = macroShifts.every((s) => s.done)
                    return (
                      <DayRow
                        key="macro-dense"
                        label="密集掃描"
                        hint={`${macroShifts.length} 班`}
                        nowHour={nowHour}
                        end={
                          <Pill
                            state={allDone ? 'ok' : anyDone ? 'warn' : 'idle'}
                            text={allDone ? '今日窗已過' : anyDone ? '進行中' : '待執行'}
                          />
                        }
                      >
                        <div
                          className={anyDone ? 'ast-hit ast-ok' : 'ast-next-run'}
                          style={{ left: `${dayPercent(markAt)}%` }}
                        />
                        <span className="ast-hit-t" style={{ left: `${dayPercent(markAt)}%` }}>
                          {job ? describeCron(job.schedule) : hourLabel(markAt)}
                        </span>
                      </DayRow>
                    )
                  })()
                : null}

            {/* Last data change: its own row, because it does not necessarily happen at a shift time (it can be triggered manually) */}
            <DayRow
              label="資料最後變動"
              hint="asOf"
              nowHour={nowHour}
              end={
                <span className="ast-when">
                  {data.macro?.asOf ? `${agoLabel(data.macro.asOf)} 前` : '—'}
                </span>
              }
            >
              {macroChangedHour !== null ? (
                <>
                  <div className="ast-hit ast-ok" style={{ left: `${dayPercent(macroChangedHour)}%` }} />
                  <span className="ast-hit-t" style={{ left: `${dayPercent(macroChangedHour)}%` }}>
                    {hourLabel(macroChangedHour)}
                  </span>
                </>
              ) : (
                <span className="ast-none">今天尚無新資料（正常，月度數據一個月才動一次）</span>
              )}
            </DayRow>
          </div>
        </div>

        {/* Next fetch: computable from cron and therefore certain —— stated separately from the estimated release date */}
        <div className="ast-next">
          <span>
            <span className="k">下次抓取</span>{' '}
            <b>
              {macroNext
                ? `${macroNext.tomorrow ? '明日' : '今日'} ${hourLabel(macroNext.hour)}`
                : '—'}
            </b>
            {macroNext && <span className="ast-in">（{durationLabel(macroNext.inHours)} 後）</span>}
          </span>
          {nextRelease && (
            <span className="sep">
              <span className="k">下一筆新數據</span> <b>{nextRelease.date}</b>{' '}
              {nextRelease.label}
              <span className="ast-est">
                {nextRelease.estimated ? '（推估，行事曆已過期）' : '（官方公告日）'}
              </span>
            </span>
          )}
        </div>

        <div className="table-scroll" style={{ marginTop: 4 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>指標</th>
                <th>最新期別</th>
                <th className="num">數值</th>
                <th className="num">前期</th>
                <th>下期預計</th>
                <th>狀態</th>
              </tr>
            </thead>
            <tbody>
              {macroRows.map(({ indicator: i, state: st }) => {
                const behind = periodsBehind(i.latest?.period ?? null, macroPeer)
                return (
                  <tr key={i.id}>
                    <td>
                      <b>{i.label}</b>
                      <span className="ast-sub">{i.id}</span>
                    </td>
                    <td className="ast-mono">{i.latest?.period ?? '—'}</td>
                    <td className="num">
                      {i.latest?.value != null ? `${i.latest.value} ${i.unit}` : '—'}
                    </td>
                    <td className="num">
                      {i.previous?.value != null ? `${i.previous.value} ${i.unit}` : '—'}
                    </td>
                    <td className="ast-mono">
                      {/* A lagging indicator has no meaningful date to compute —— its previous period is not out either */}
                      {st === 'warn' ? '待定' : (i.nextRelease?.date ?? '待定')}
                      {i.nextRelease?.estimated && st !== 'warn' && (
                        <span className="ast-est"> 推估</span>
                      )}
                    </td>
                    <td>
                      <Pill
                        state={st}
                        text={behind > 0 ? `落後 ${behind} 期` : '最新'}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Taiwan market-wide (0.6.32) ───────────────────── */}
      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          <h3 className="head-tight">台股全市場・量能與三大法人</h3>
          <span className="source-tag">
            {marketCron ? describeCron(marketCron.schedule) : 'market-daily'}
          </span>
        </div>
        {!data.market ? (
          <p className="ast-note" style={{ marginTop: 12 }}>
            讀不到 market/daily.json —— 排程還沒跑過，或檔案被刪掉了。
          </p>
        ) : (
          <>
            <div className="kpi-grid" style={{ marginTop: 14 }}>
              <div className="glass kpi">
                <div className="kpi-label">最新交易日</div>
                <div className="kpi-value">{data.market.latestDate ?? '—'}</div>
                <div className="kpi-sub">
                  共 {data.market.days} 個交易日・schema {data.market.schema ?? '—'}
                </div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">法人金額最新到</div>
                <div className="kpi-value">{data.market.latestInstitutionalDate ?? '—'}</div>
                {/*
                  Being a day or two behind the box above is normal: institutional amounts are only published at
                  15:00 and are filled one request per day. Deliberately no lamp here —— deciding "how many days
                  counts as late" needs a trading calendar, and we do not have one.
                */}
                <div className="kpi-sub">
                  {data.market.missingInstitutional > 0
                    ? `${data.market.missingInstitutional} 天待補`
                    : '全部補齊'}
                </div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">買進 / 賣出回補</div>
                <div className="kpi-value">
                  {data.market.missingBuySell === 0 ? (
                    '已補齊'
                  ) : (
                    <>
                      {data.market.missingBuySell}
                      <span className="ast-unit"> 天待補</span>
                    </>
                  )}
                </div>
                {/* Days filled before 0.6.32 only had the net figure; they grow back day by day and must stop growing once complete */}
                <div className="kpi-sub">每輪最多補 5 天</div>
              </div>
              <div className="glass kpi">
                <div className="kpi-label">缺開高低</div>
                <div className="kpi-value">
                  {data.market.missingCandle}
                  <span className="ast-unit"> / {data.market.days} 天</span>
                </div>
                <div className="kpi-sub">缺的那幾天畫不出日 K</div>
              </div>
            </div>
            <p className="ast-note" style={{ marginTop: 12 }}>
              檔案產出於 {data.market.asOf ? fmtUpdatedAt(data.market.asOf) : '—'}
              {data.market.asOf && `・${agoLabel(data.market.asOf)} 前`}
            </p>
            {/*
              The fetch-cycle explanation moved here from the macro page card in 0.6.33: it is a scheduling
              matter, not something needed while watching the market, and a hard-coded shift list on a card is
              bound to drift from pg_cron (it did, once). Shifts always come from marketCron.schedule, and how
              many days each round fills is described as a mechanism without a number —— the backend's
              MAX_MARKET_INST_DAYS is not exposed through the API, so writing a number would just recreate a
              constant that drifts.
            */}
            <p className="ast-note" style={{ marginTop: 6 }}>
              <b>抓取對象</b>：證交所三個來源，寫成單一檔 <code>market/daily.json</code>
              （全市場共用，不是持股清單）。
              <br />
              · <b>FMTQIK</b>：當日成交股數／金額／筆數、加權指數收盤與漲跌點（一次抓整月）
              <br />
              · <b>MI_5MINS_HIST</b>：加權指數開／高／低（日 K 用；與 FMTQIK 同月一次抓）
              <br />
              · <b>BFI82U</b>：三大法人（外資、投信、自營）買進／賣出／買賣超金額（
              <b>一天一個請求</b>，歷史逐日回補）
            </p>
            <p className="ast-note" style={{ marginTop: 6 }}>
              <b>抓取週期</b>：
              {marketCron ? describeCron(marketCron.schedule) : '排程 market-daily'}
              。每輪重抓當月量能與加權指數，另補若干個交易日的法人金額。
              量能與法人的日期覆蓋本來就不同步，上方的「待補」不等於異常。
            </p>
          </>
        )}
      </div>

      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          <h3 className="head-tight">匯率與檔案涵蓋</h3>
          <span className="source-tag">不隨台股交易日走</span>
        </div>
        <div className="kpi-grid" style={{ marginTop: 14 }}>
          <div className="glass kpi">
            <div className="kpi-label">台幣匯率</div>
            <div className="kpi-value">{data.fx?.count ?? 0} 幣別</div>
            <div className="kpi-sub">
              {data.fx?.asOf ? fmtUpdatedAt(data.fx.asOf) : '—'}
              {data.fx?.asOf && `・${agoLabel(data.fx.asOf)} 前`}
            </div>
          </div>
          <div className="glass kpi">
            <div className="kpi-label">日線檔</div>
            <div className="kpi-value">
              {data.coverage.daily ?? 0}
              <span className="ast-unit"> / {data.coverage.held ?? 0}</span>
            </div>
            <div className="kpi-sub">daily/{'{代號}'}.json</div>
          </div>
          <div className="glass kpi">
            <div className="kpi-label">基本面檔</div>
            <div className="kpi-value">
              {data.coverage.fundamental ?? 0}
              <span className="ast-unit"> / {data.coverage.held ?? 0}</span>
            </div>
            <div className="kpi-sub">含月營收與獲利能力</div>
          </div>
        </div>
        <p className="ast-note" style={{ marginTop: 12 }}>
          <Activity size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
          後端彙總耗時 {data.durationMs} ms
        </p>
      </div>
    </>
  )
}
