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
    時間軸的基準日是「資料日」而非今天 —— 隔天早上補抓的事件要落在同一條軸上。
    0.6.36-dev.2 起改取**各來源資料日的最大值**（見 timeline.ts 的 roundBaseYmd）：
    綁單一來源會讓跑得快的那列（全市場走獨立排程，16:00 就到手）算出跨日的座標。
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
          全市場法人不在 chip.sources 裡（那是個股批次寫的），改讀 market/daily.json。

          ⚠️ 時刻是**檔案產出時間**的近似值，不是那一天法人金額實際到手的時刻：
          17:00 那輪就算只更新了成交量值也會推進 asOf。要精確到逐日必須在 schema
          加 institutionalFetchedAt，但既有的日子都不會有那個欄位，加了也是空的。
          畫面上的 hint 因此標明是「檔案產出」，不要讓人以為這是抓到法人的時刻。
        */
        stamp = data.market
          ? { date: data.market.latestInstitutionalDate, fetchedAt: data.market.asOf }
          : null
        /*
          **Deliberately not using partial** (different from daily): Legal persons are replenished on a daily basis. It is normal for the latest one or two days not to be replenished.
          拿它當「不完整」會讓這一列幾乎每天都是黃燈。待補天數已經在下方的
          「台股全市場」KPI 講得很清楚，這條軸只回答「檔案有沒有準時產出」。
        */
        // The subscript must also explain the source and "this moment is the file output, not the legal person's acquisition", so there is no need to specify spec.hint
        cover = 'BFI82U・檔案產出時間'
      } else {
        stamp = src?.[spec.id] ?? null
      }
      /*
        時間戳落在本輪軸範圍外的，屬於別輪 —— 一律當未取得，由 judgeSource 依 dueBy 判定。
        不能拿上一輪的時間戳去算座標：個股 T86 還停在昨天時會算出 -22.5 小時，
        被 tlPercent 夾到 0（軸最左），看起來像「超早就到手」。

        判「屬不屬於本輪」用時間戳而不是比對 date，是因為 date 的語意各列不同：
        借券自報的是**公布日**（次一交易日），天生比本輪多一天 ——
        拿它比對會讓唯一該亮紅燈的那列反而被當成沒抓到。
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

  return (
    <>
      {/* ── 結論先行 ─────────────────────────────────────── */}
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

      {/* ── 台股盤後時間軸 ───────────────────────────────── */}
      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          {/* 標題與軸座標必須同一個基準日，否則標題說 8/4、軸上卻畫著 8/5 的點 */}
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
            淡色是<b>來源端的公布時間</b>（證交所何時公布），不是我們的抓取排程 ——
            盤後批次是週一至週五 16:00–23:45 每 15 分一輪。
            判定基準是<b>公布窗結束後的第一個批次班次</b>（含該輪 15 分鐘的緩衝），
            所以法人 15:00 公布、16:30 那輪到手屬正常。
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
                  {/* 手機隱藏時間軸（橫捲看不到右半，等於看不出延遲），時刻改列在這裡 */}
                  {hour !== null && <span className="ast-when">{tlLabel(hour)}</span>}
                  {date && <span className="ast-date">{date}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── 排程 ─────────────────────────────────────────── */}
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
                      {/* 光看 action 代號看不出這一班負責哪些資料 */}
                      {scope && <span className="ast-scope">{scope}</span>}
                    </td>
                    <td className="ast-mono">{describeCron(s.schedule)}</td>
                    <td className="ast-mono">{s.action ?? '—'}</td>
                    <td className="ast-mono">{s.targetRef ?? '—'}</td>
                    <td className="num">
                      {s.runsToday}
                      {s.failsToday > 0 && <span className="ast-fail"> / {s.failsToday} 失敗</span>}
                    </td>
                    <td className="ast-mono">{s.lastRun ? fmtUpdatedAt(s.lastRun) : '—'}</td>
                    <td>
                      <Pill state={st} text={s.active ? undefined : '已停用'} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {data.batch && (
          <p className="ast-note" style={{ marginTop: 10 }}>
            盤後批次今日第 {data.batch.runsToday ?? 0} 輪
            {data.probe?.taipei_time && `・探針最後探測 ${data.probe.taipei_time}`}
            {/* 括號整段一起組，分成兩個條件式會在只有其中一項時印出沒閉合的括號 */}
            {probeRows(data.probe)}
          </p>
        )}
      </div>

      {/* ── 總經：當日班次軸（與上方台股盤後同一種讀法）───── */}
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
            BEA / BLS 在美東 8:30 發布 ＝ <b>夏令台北 20:30、冬令 21:30</b>。21:00
            那班在冬令會跑在發布之前 —— 這正是 0.6.11 之前總經固定慢一天的成因，
            現在兩班都會實際去問 FRED，內容變了才寫檔。
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

            {/* 美東發布窗：夏令 20:30–21:30 涵蓋兩種日光節約情形 */}
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

            {macroShifts.map((s, i) => (
              <DayRow
                key={s.hour}
                label={`第${i === 0 ? '一' : '二'}班`}
                hint={hourLabel(s.hour)}
                nowHour={nowHour}
                end={<Pill state={s.done ? 'ok' : 'idle'} text={s.done ? '已執行' : '待執行'} />}
              >
                <div
                  className={s.done ? 'ast-hit ast-ok' : 'ast-next-run'}
                  style={{ left: `${dayPercent(s.hour)}%` }}
                />
                <span className="ast-hit-t" style={{ left: `${dayPercent(s.hour)}%` }}>
                  {hourLabel(s.hour)}・{s.done ? '已執行' : '尚未執行'}
                </span>
              </DayRow>
            ))}

            {/* 資料最後變動：與班次分開一列，因為它不一定發生在班次時刻（可手動觸發） */}
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

        {/* 下次抓取：cron 算得出來、100% 確定，與推估的發布日分開陳述 */}
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
                      {/* 落後的指標算不出有意義的日期——它連上一期都還沒發 */}
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

      {/* ── 台股全市場（0.6.32）───────────────────────────── */}
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
                  與上一格差一兩天是正常的：法人 15:00 才公布、且一天一個請求逐日補。
                  這裡刻意不亮燈 —— 判定「幾天算延遲」需要交易日曆，而我們沒有。
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
                {/* 0.6.32 之前補到的日子只有差額，靠回補逐日長出來，補完就不該再增加 */}
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
              抓取週期的說明 0.6.33 由總經頁的卡片移到這裡：那是排程的事，看盤時不需要，
              而且卡片上寫死班次必然與 pg_cron 漂移（實際漂過一次）。班次一律取自
              marketCron.schedule，每輪補幾天則只描述機制不給數字 —— 後端的
              MAX_MARKET_INST_DAYS 沒有透過 API 吐出來，寫數字就是再造一份會漂移的常數。
            */}
            <p className="ast-note" style={{ marginTop: 6 }}>
              <b>抓取週期</b>：
              {marketCron ? describeCron(marketCron.schedule) : '排程 market-daily'}
              。每輪抓一份當月的成交量值與加權指數（一次一整月），另補若干個交易日的法人金額 ——
              法人是<b>一天一個請求</b>，所以歷史是逐日補上來的，不是一次到位。
              兩者的日期覆蓋範圍本來就不同步，上方的「待補」不等於異常。
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
