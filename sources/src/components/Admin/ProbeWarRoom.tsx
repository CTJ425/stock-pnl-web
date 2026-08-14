/**
 * 盤後探針命中戰情室 (Probe War Room)
 *
 * 採用與全站一致的 standard `.section.glass` 與 `.kpi-grid` / `.glass.kpi` 設計系統。
 * 即時呈現 7 大資料源的幾點命中、命中幾次、是否已退休與時間紀錄。
 */
import { useMemo } from 'react'
import { RefreshCw } from 'lucide-react'
import type { AdminStatus } from '../../services/adminStatus'

export interface WarRoomSourceConfig {
  id: string
  name: string
  code: string
  window: string
  target: number
}

export const WAR_ROOM_SOURCES: WarRoomSourceConfig[] = [
  { id: 'bfi82u', name: '全市場三大法人', code: 'BFI82U', window: '15:00–16:30 / 19:30–20:15', target: 3 },
  { id: 't86', name: '個股三大法人', code: 'T86', window: '15:30–17:30', target: 3 },
  { id: 'bwibbu', name: '個股估值 (PE/PB/DY)', code: 'BWIBBU', window: '17:00–18:30', target: 3 },
  { id: 'margin', name: '融資融券', code: 'MARGIN', window: '20:30–22:30', target: 3 },
  { id: 'borrow', name: '借券賣出餘額', code: 'BORROW', window: '21:00–23:30', target: 3 },
  { id: 'mops_revenue', name: 'MOPS 月營收彙整', code: 'MOPS_REV', window: '12:00 / 17:15 / 21:00 (平日6槽)', target: 1 },
  { id: 'mops_profit', name: 'MOPS 季報獲利彙整', code: 'MOPS_PROFIT', window: '12:00 / 17:15 / 21:00 (平日6槽)', target: 1 },
]

export interface ProbeSourceCardData {
  config: WarRoomSourceConfig
  hitCount: number
  target: number
  isRetired: boolean
  isProbing: boolean
  isWaiting: boolean
  hitTimes: string[]
  statusText: string
  statusType: 'retired' | 'probing' | 'waiting'
}

function dashYmd(ymd: string | undefined): string {
  if (!ymd || ymd.length !== 8) return ''
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`
}

function fmtUpdatedAt(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface ProbeWarRoomProps {
  data: AdminStatus
  loading: boolean
  onRefresh: () => void
}

export function ProbeWarRoom({ data, loading, onRefresh }: ProbeWarRoomProps) {
  const ticks = useMemo(() => data.probeExperiment?.ticks ?? [], [data.probeExperiment])
  const todayYmd = data.todayYmd || data.manifest?.ymd || ''
  const normalizedToday = todayYmd.replace(/-/g, '')

  const cards = useMemo<ProbeSourceCardData[]>(() => {
    return WAR_ROOM_SOURCES.map((s) => {
      const sourceTicks = ticks.filter((t) => {
        const tickYmd = (t.taipei_ymd || '').replace(/-/g, '')
        const matchesDate = normalizedToday ? tickYmd === normalizedToday : true
        return matchesDate && t.source === s.id
      })

      const hitTicks = sourceTicks.filter((t) => t.hit === true)
      const hitCount = hitTicks.length
      const hitTimes = hitTicks
        .map((t) => {
          const timeStr = t.taipei_time || ''
          return timeStr.length >= 5 ? timeStr.slice(0, 5) : timeStr
        })
        .filter(Boolean)

      const isRetired = hitCount >= s.target
      const isProbing = !isRetired && sourceTicks.length > 0
      const isWaiting = !isRetired && sourceTicks.length === 0

      let statusType: 'retired' | 'probing' | 'waiting' = 'waiting'
      let statusText = '⏳ 待機中'

      if (isRetired) {
        statusType = 'retired'
        statusText = s.target === 1 ? '✅ 槽次收工' : '✅ 已退休'
      } else if (isProbing) {
        statusType = 'probing'
        statusText = `🟢 探測中 (${hitCount}/${s.target})`
      } else {
        statusType = 'waiting'
        statusText = '⏳ 待機中'
      }

      return {
        config: s,
        hitCount,
        target: s.target,
        isRetired,
        isProbing,
        isWaiting,
        hitTimes,
        statusText,
        statusType,
      }
    })
  }, [ticks, normalizedToday])

  const retiredCount = cards.filter((c) => c.statusType === 'retired').length
  const probingCount = cards.filter((c) => c.statusType === 'probing').length
  const waitingCount = cards.filter((c) => c.statusType === 'waiting').length

  const dataDate = data.chip?.dataDate || dashYmd(data.manifest?.ymd) || '—'

  return (
    <div className="section glass" style={{ padding: '18px 20px' }}>
      {/* 頂部戰報抬頭 (統一採用 rpt-section-head) */}
      <div className="rpt-section-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 className="head-tight">盤後探針命中戰情室</h3>
          <span className="source-tag">
            已退休 {retiredCount} 源・探測中 {probingCount} 源・待機中 {waitingCount} 源
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="source-tag section-stamp">
            資料日 {dataDate}・更新於 {fmtUpdatedAt(data.asOf)}
          </span>
          <button className="btn btn-sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : undefined} />
            重新整理
          </button>
        </div>
      </div>

      <p className="ast-note" style={{ marginTop: 6, marginBottom: 14 }}>
        全天候每 5 分鐘巡邏，命中即觸發抓取，3 次穩定到位自動退休收工（MOPS 1 次到位收工）。
      </p>

      {/* 7 大資料源戰情卡片 (統一採用 .kpi-grid 與 .glass.kpi) */}
      <div className="kpi-grid pwr-grid">
        {cards.map((card) => {
          const { config, hitCount, target, isRetired, isProbing, hitTimes, statusText, statusType } = card
          return (
            <div
              key={config.id}
              className={`glass kpi pwr-kpi-card pwr-${statusType}`}
              data-testid={`pwr-card-${config.id}`}
            >
              {/* 卡片標題與狀態 (kpi-label) */}
              <div className="kpi-label pwr-kpi-label">
                <span className="pwr-kpi-name">
                  <b>{config.name}</b>
                  <code>{config.code}</code>
                </span>
                <span className={`source-tag pwr-status-tag ${statusType}`}>{statusText}</span>
              </div>

              {/* 命中計數與進度圓點 (kpi-value) */}
              <div className="kpi-value pwr-kpi-value">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                  <span className={isProbing ? 'pwr-probing-val' : isRetired ? 'pwr-retired-val' : ''}>
                    {hitCount}
                  </span>
                  <span className="ast-unit">
                    / {target} 次{isRetired ? '到位' : '命中'}
                  </span>
                </div>
                <div className="pwr-hits-dots" aria-label={`命中進度 ${hitCount}/${target}`}>
                  {Array.from({ length: target }).map((_, i) => (
                    <span key={i} className={`pwr-dot ${i < hitCount ? 'hit' : ''}`} />
                  ))}
                </div>
              </div>

              {/* 命中時間紀錄與時窗 (kpi-sub) */}
              <div className="kpi-sub pwr-kpi-sub">
                <div className="pwr-sub-window">時窗：{config.window}</div>
                <div className="pwr-sub-times">
                  {hitTimes.length > 0 ? (
                    <div className="pwr-times-line">
                      <span className="pwr-times-prefix">命中：</span>
                      <span className="pwr-times-chips">
                        {hitTimes.map((time, idx) => {
                          const isLast = idx === hitTimes.length - 1
                          return (
                            <span
                              key={idx}
                              className={`pwr-time-chip ${isLast && isRetired ? 'is-retire' : ''} ${
                                isLast && isProbing ? 'is-latest' : ''
                              }`}
                            >
                              {time}
                              {isLast && isRetired ? ' 退休' : ''}
                              {isLast && isProbing ? ' 最新' : ''}
                            </span>
                          )
                        })}
                      </span>
                    </div>
                  ) : (
                    <span className="pwr-times-empty">尚未進入時窗 (今日未命中)</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
