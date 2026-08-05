/**
 * 「資料抓取狀況」頁（僅管理員可見）。
 *
 * 為什麼以時間軸為主體：台股盤後的三個籌碼來源公布時間差達 7 小時
 * （法人 15:00、融資融券 21:00、借券 21:00–22:30），批次是分段抓的。
 * 卡片或表格看得到「有沒有到」，卻看不出「該來的來了沒、慢了多久」——
 * 而那正是排查排程問題時唯一重要的資訊。
 *
 * 月頻的總經與基礎設施不放在日軸上：它們的節奏是「哪一期到了」而非「幾點到」，
 * 硬塞進時間軸只會讓軸的語意變得模糊。故分成三段：時間軸 → 排程 → 期別與基礎設施。
 *
 * 判定規則與座標計算全在 `timeline.ts`（純函式、有測試），這裡只做呈現。
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

/** 24 小時軸上要畫格線的時刻（刻度尺另含 0，那條由容器左緣代表） */
const DAY_GRID = [6, 12, 18, 21]

function Pill({ state, text }: { state: SourceState; text?: string }) {
  return <span className={`ast-pill ast-${state}`}>{text ?? STATE_TEXT[state]}</span>
}

/** 距現在多久，例：'3h 40m' */
function agoLabel(iso: string): string {
  return humanAgo(Date.now() - Date.parse(iso))
}

/**
 * 總經班次軸的一列。三列（美東發布 / 班次 / 資料最後變動）只有軌道與右欄的內容不同，
 * 格線與「現在」線則必須三列一致 —— 少畫一條就會看成資料對不齊軸。
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
 * 探針列數的括號段落。整段一起組，不要拆成兩個條件式 ——
 * 只有其中一項有值時會印出沒有右括號的「（估值 1081 列」。
 */
function probeRows(probe: AdminStatus['probe']): string {
  const parts: string[] = []
  if (probe?.bwibbu_rows != null) parts.push(`估值 ${probe.bwibbu_rows} 列`)
  if (probe?.borrow_rows != null) parts.push(`借券 ${probe.borrow_rows} 列`)
  return parts.length ? `（${parts.join('、')}）` : ''
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'（manifest 用的是無分隔格式） */
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

  // 時間軸的基準日是「資料日」而非今天 —— 隔天早上補抓的事件要落在同一條軸上
  const baseYmd = dashYmd(data?.chip?.ymd ?? data?.manifest?.ymd)

  const chain = useMemo(() => {
    if (!data || !baseYmd) return []
    const src = data.chip?.sources ?? null
    const held = data.coverage.held ?? 0
    const nowHour = hoursFromBase(data.asOf, baseYmd) ?? 0
    return TW_CHAIN.map((spec) => {
      // 日 K 線沒有 sources 條目：它與三大法人同一輪批次寫入，時間戳共用，
      // 完整與否則看 daily/ 目錄的檔案數是否追上持股數
      let stamp: SourceStamp | null = null
      let partial = false
      let cover: string | null = null
      if (spec.id === 'daily') {
        const n = data.coverage.daily ?? 0
        stamp = src?.institutional ?? null
        partial = held > 0 && n < held
        cover = held > 0 ? `${n} / ${held} 檔` : null
      } else {
        stamp = src?.[spec.id] ?? null
      }
      const h = hoursFromBase(stamp?.fetchedAt ?? null, baseYmd)
      return {
        spec,
        state: judgeSource(spec, h, nowHour, partial),
        hour: h,
        date: stamp?.date ?? null,
        cover,
      }
    })
  }, [data, baseYmd])

  const macroPeer = useMemo(
    () => latestPeriod((data?.macro?.indicators ?? []).map((i) => i.latest?.period)),
    [data],
  )

  /** 每個總經指標的落後判定。三處（結論計數、下一筆發布、表格）必須是同一份判定 */
  const macroRows = useMemo(
    () =>
      (data?.macro?.indicators ?? []).map((indicator) => ({
        indicator,
        state: judgePeriod(indicator.latest?.period ?? null, macroPeer),
      })),
    [data, macroPeer],
  )

  /** 現在是台北的第幾小時（0–24），供「現在」線與班次判定用 */
  const nowHour = useMemo(() => taipeiParts(data?.asOf)?.hour ?? null, [data])

  /** macro-daily 的班次時刻，以及各自今天跑過了沒 */
  const macroShifts = useMemo(() => {
    const job = (data?.schedules ?? []).find((s) => s.action === 'sync-macro')
    if (!job || nowHour === null) return []
    return cronHoursTaipei(job.schedule).map((hour) => ({ hour, done: nowHour >= hour }))
  }, [data, nowHour])

  const macroNext = useMemo(
    () => (nowHour === null ? null : nextRun(macroShifts.map((s) => s.hour), nowHour)),
    [macroShifts, nowHour],
  )

  /** 資料最後變動落在今天的第幾小時；不是今天就回 null（軸只畫今天） */
  const macroChangedHour = useMemo(() => {
    const tp = taipeiParts(data?.macro?.asOf)
    if (!tp || tp.ymd !== data?.todayYmd) return null
    return tp.hour
  }, [data])

  /** 最近的一筆發布：取後端算好的日期中最早的那個 */
  const nextRelease = useMemo(() => {
    const cands = macroRows
      .filter((r) => r.indicator.nextRelease)
      // 落後中的指標連上一期都還沒發，它的「下一期」沒有參考價值
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

  // 抓取週期直接取自 pg_cron，不在前端另寫一份常數 —— 兩份遲早漂移，而漂移看不出來
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
          <h3 className="head-tight">台股盤後・{data.chip?.dataDate ?? '—'} 這一輪</h3>
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
              ・成交量值與指數一次抓一整月，法人金額一天一個請求 ——
              兩者的日期覆蓋範圍本來就不同步，「待補」不等於異常。
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
