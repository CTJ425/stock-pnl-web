/**
 * 資料抓取與排程同步狀況頁面（管理員後台）。
 *
 * 核心依據：
 * 1. 排程同步狀態：一源一列 5 分鐘探針命中時序與即時抓取紀錄，以及總經 FRED 決策。
 * 2. 台股全市場・量能與三大法人：market/daily.json 產出狀態與缺口補齊進度。
 * 3. 匯率與檔案涵蓋：Yahoo 匯率及各檔持股 daily/ 與 fundamental/ 檔案完整度。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ChevronDown } from 'lucide-react'
import { fetchAdminStatus, type AdminStatus } from '../../services/adminStatus'
import { fmtUpdatedAt } from '../StockDetail/chipFormat'
import { MechanismGuide } from './MechanismGuide'
import { ProbeWarRoom } from './ProbeWarRoom'
import {
  describeCron,
  groupProbeTicks,
  humanAgo,
  type ProbeSeries,
} from './timeline'

const SECTION_PAD = { padding: '18px 20px' }

/** 距今多久標籤，例如：'3h 40m' */
function agoLabel(iso: string): string {
  return humanAgo(Date.now() - Date.parse(iso))
}

/** `null`/`undefined` 代表該次 Storage 查詢本身失敗，不是「目錄是空的」，兩者不可用 `?? 0` 混為一談 */
function coverageLabel(v: number | null | undefined): string | number {
  return v == null ? '—' : v
}

/**
 * 一源一列：名稱、命中/未命中進度條、首次命中摘要、可展開的明細表。
 *
 * 進度條每格代表一次 5 分鐘探測，由左至右按時間排序。
 */
function ProbeRow({
  series,
  open,
  onToggle,
}: {
  series: ProbeSeries
  open: boolean
  onToggle: () => void
}) {
  const { ticks, hits, firstHit, label } = series
  const total = ticks.length
  const summary = firstHit
    ? `首次命中 ${firstHit}`
    : total > 0
      ? '尚未命中'
      : '尚未探測'

  return (
    <div className={`apr-row${open ? ' apr-open' : ''}`}>
      <button
        type="button"
        className="apr-head"
        aria-expanded={open}
        onClick={onToggle}
        disabled={total === 0}
      >
        <span className="apr-name">{label}</span>
        <span className="apr-bar" aria-hidden="true">
          {total === 0 ? (
            <i className="apr-seg apr-seg-empty" />
          ) : (
            ticks.map((t) => (
              <i
                key={t.time}
                className={`apr-seg ${t.hit ? 'apr-seg-hit' : 'apr-seg-miss'}`}
                title={`${t.time} ${t.hit ? '中' : '沒中'}${t.note ? `・${t.note}` : ''}`}
              />
            ))
          )}
        </span>
        <span className="apr-sum">
          <b>{summary}</b>
          <span className="ast-sub">{total > 0 ? `${hits} / ${total} 中` : '窗口未開'}</span>
        </span>
        <ChevronDown className="apr-caret" size={16} aria-hidden="true" />
      </button>
      {open && total > 0 && (
        <div className="table-scroll apr-log">
          <table className="data-table">
            <thead>
              <tr>
                <th>時分</th>
                <th>命中</th>
                <th>資料日期</th>
                <th className="num">列數</th>
                <th className="num">耗時</th>
                <th>指紋</th>
                <th>說明</th>
              </tr>
            </thead>
            <tbody>
              {ticks.map((t) => (
                <tr key={t.time} className={t.hit ? 'apr-hit-row' : undefined}>
                  <td className="ast-mono">{t.time}</td>
                  <td className="ast-mono">{t.hit ? '中' : t.ok ? '沒中' : '抓取失敗'}</td>
                  <td className="ast-mono">{t.dataYmd ?? '—'}</td>
                  <td className="num">{t.rows ?? '—'}</td>
                  <td className="num">{t.durationMs != null ? `${t.durationMs} ms` : '—'}</td>
                  {/* 只印前 8 碼：要看的是「跟上一列一不一樣」，不是雜湊本身 */}
                  <td className="ast-mono" title={t.fingerprint ?? ''}>
                    {t.fingerprint ? t.fingerprint.slice(0, 8) : '—'}
                  </td>
                  <td>{t.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** `decideMacroScan` 的判準說明，逐一對應 `ScanReason`。 */
const MACRO_SCAN_REASON: Record<string, string> = {
  routine: '今天還沒問過 FRED，例行掃一次（FRED 會回頭修訂歷史值）',
  due: '發布時間已到、該期還沒拿到，且落在掃描窗內',
  satisfied: '該拿的都拿到了——命中即收工，今天不再問',
  'outside-window': '還有期別沒拿到，但已超出掃描窗，等明天的例行班',
  capped: '今天已達掃描次數上限',
}

/**
 * 總經的探針決策。
 *
 * 判準寫在 `sync-macro` 內部的 `decideMacroScan`，由 `macro-daily` 的班表當節拍。
 */
function MacroScanRow({ s }: { s: NonNullable<NonNullable<AdminStatus['probeExperiment']>['macroScan']> }) {
  return (
    <div className="ast-note" style={{ marginTop: 12 }}>
      <strong>總經（FRED）</strong>
      <span className="source-tag" style={{ marginLeft: 8 }}>
        {s.scan ? '下一輪會問' : '下一輪不問'}
      </span>
      <span style={{ marginLeft: 8 }}>
        {MACRO_SCAN_REASON[s.reason] ?? s.reason}
        {s.dueIds.length > 0 && `（${s.dueIds.join('、')}）`}
      </span>
      <div style={{ marginTop: 4 }}>
        今日已問 {s.scansToday} / {s.cap} 次
        {s.checkedAt && ` · 最後一次 ${new Date(s.checkedAt).toLocaleString('zh-TW')}`}
      </div>
    </div>
  )
}

function ProbeSchedulePanel({
  exp,
  todayYmd,
}: {
  exp: NonNullable<AdminStatus['probeExperiment']>
  todayYmd: string
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set())
  const days = useMemo(
    () =>
      groupProbeTicks(
        Array.isArray(exp.ticks) ? exp.ticks : [],
        exp.order?.length ? exp.order : Object.keys(exp.labels ?? {}),
        exp.labels ?? {},
      ),
    [exp],
  )

  if (days.length === 0) {
    return (
      <p className="ast-note">
        尚無探針紀錄。請確認 <code>source-probe</code> 已改為每 5 分、且 Edge 已 deploy；
        窗外時段（如上午）本就不會寫入。
      </p>
    )
  }

  return (
    <div className="apr-days">
      {days.map((day) => (
        <div key={day.ymd}>
          <div className="apr-day">
            {dashYmd(day.ymd) || day.ymd}
            <span className="ast-sub">{day.ymd === todayYmd ? '今天' : '前一日'}</span>
          </div>
          {day.series.map((s) => {
            const key = `${day.ymd}|${s.source}`
            return (
              <ProbeRow
                key={key}
                series={s}
                open={open.has(key)}
                onToggle={() =>
                  setOpen((prev) => {
                    const next = new Set(prev)
                    if (!next.delete(key)) next.add(key)
                    return next
                  })
                }
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** 'YYYYMMDD' → 'YYYY-MM-DD' (manifest 使用無分隔符格式) */
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

  // 抓取全市場排程
  const marketCron = (data?.schedules ?? []).find((s) => s.jobname === 'market-daily') ?? null

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

  return (
    <>
      {/* ── 盤後探針命中戰情室 ────────────────────────────── */}
      <ProbeWarRoom data={data} loading={loading} onRefresh={() => void load()} />

      {/* ── 探針與排程機制運作總覽 ────────────────────────── */}
      <MechanismGuide />

      {/* ── 排程同步狀態 ────────────────────────────────────── */}
      {data.probeExperiment && (
        <div className="section glass" style={SECTION_PAD}>
          <div className="rpt-section-head">
            <h3 className="head-tight">排程同步狀態</h3>
            <span className="source-tag section-stamp">每 5 分鐘探測與即時抓取</span>
          </div>
          <p className="ast-note" style={{ marginBottom: 8 }}>
            一源一列，進度條由左到右每格代表一次 5 分鐘探測，綠格＝命中；點該列展開逐次紀錄。
            日頻源僅在各自時間窗內探測；月營收／季報僅 12:00／21:00 附近。
          </p>
          <p className="ast-note" style={{ marginBottom: 12 }}>
            命中代表<strong>上游已公布資料</strong>，系統會在同一輪直接觸發對應的抓取。
            抓了什麼、成功與否寫在該次紀錄的說明（展開該列可見）；抓取失敗的來源下一輪會自動重試，
            直到該來源的時間窗關閉為止。
          </p>
          <ProbeSchedulePanel exp={data.probeExperiment} todayYmd={data.todayYmd} />
          {data.probeExperiment.macroScan && (
            <MacroScanRow s={data.probeExperiment.macroScan} />
          )}
        </div>
      )}

      {/* ── Taiwan market-wide ─────────────────────────────── */}
      <div className="section glass" style={SECTION_PAD}>
        <div className="rpt-section-head">
          <h3 className="head-tight">台股全市場・量能與三大法人</h3>
          <span className="source-tag">
            {marketCron ? describeCron(marketCron.schedule) : '探針 bfi82u 驅動'}
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
              <b>抓取機制</b>：
              {marketCron ? describeCron(marketCron.schedule) : '探針 bfi82u（15:00–16:30 / 19:30–20:15 每 5 分，各時段 3 次到位收工）'}
              。每輪重抓當月量能與加權指數，另補若干個交易日的法人金額。
              量能與法人的日期覆蓋本來就不同步，上方的「待補」不等於異常。
            </p>
          </>
        )}
      </div>

      {/* ── FX and coverage ────────────────────────────────── */}
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
              {coverageLabel(data.coverage.daily)}
              <span className="ast-unit"> / {coverageLabel(data.coverage.held)}</span>
            </div>
            <div className="kpi-sub">daily/{'{代號}'}.json</div>
          </div>
          <div className="glass kpi">
            <div className="kpi-label">基本面檔</div>
            <div className="kpi-value">
              {coverageLabel(data.coverage.fundamental)}
              <span className="ast-unit"> / {coverageLabel(data.coverage.held)}</span>
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
