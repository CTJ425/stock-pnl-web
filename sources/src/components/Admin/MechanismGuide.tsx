/**
 * 管理後台：資料源探針與 pg_cron 排程機制運作總覽對照。
 *
 * 供管理員清楚比較「探針主動偵測（命中即抓取）」與「定時排程（總經、匯率與兜底備援）」的運作週期與分工。
 */
import { useState } from 'react'
import { ChevronDown, Cpu, HelpCircle, Radio, Timer } from 'lucide-react'

export interface ProbeSourceConfig {
  id: string
  name: string
  window: string
  interval: string
  retirement: string
  action: string
  description: string
}

export interface CronJobConfig {
  jobname: string
  cron: string
  taipeiTime: string
  action: string
  role: string
  description: string
}

const PROBE_SOURCES_CONFIG: ProbeSourceConfig[] = [
  {
    id: 'bfi82u',
    name: '全市場法人',
    window: '15:00 – 16:30 / 19:30 – 20:15',
    interval: '每 5 分鐘',
    retirement: '各時段 3 次到位',
    action: 'sync-market',
    description: '三大法人全市場買賣超金額，寫入 market/daily.json。雙時段分別抓取盤後初版與 19:40 綜合帳戶／鉅額交易結算。',
  },
  {
    id: 't86',
    name: '個股三大法人',
    window: '16:00 – 17:00',
    interval: '每 5 分鐘',
    retirement: '3 次穩定到位',
    action: 'generate-chips',
    description: '個股外資/投信/自營商買賣超張數，產出個股籌碼報告。',
  },
  {
    id: 'bwibbu',
    name: '個股估值',
    window: '17:00 – 18:30',
    interval: '每 5 分鐘',
    retirement: '3 次穩定到位',
    action: 'generate-market-data',
    description: '本益比、殖利率、股價淨值比，打帶日期端點更新 fundamental/*.json（實測官方約 17:15–17:20 出表）。',
  },
  {
    id: 'twt38u',
    name: '外資買賣超 TOP50',
    window: '17:00 – 18:00',
    interval: '每 5 分鐘',
    retirement: '3 次穩定到位',
    action: 'generate-chips',
    description: '外資及陸資買賣超彙總表（TWT38U），於 generate-chips 階段產出 market/foreign_top50.json 的買超／賣超 TOP 50 快照。',
  },
  {
    id: 'margin',
    name: '融資融券',
    window: '20:30 – 22:30',
    interval: '每 5 分鐘',
    retirement: '3 次穩定到位',
    action: 'generate-chips',
    description: '融資增減、融券增減、資券互抵與使用率，寫入籌碼報告。',
  },
  {
    id: 'borrow',
    name: '借券賣出',
    window: '21:00 – 23:30',
    interval: '每 5 分鐘',
    retirement: '3 次到位 (日期翻日)',
    action: 'generate-chips',
    description: '借券賣出餘額與額度。前緣留 75 分鐘餘裕，後緣延至 23:30 接住 22:15 翻日。',
  },
  {
    id: 'mops_revenue',
    name: 'MOPS 月營收彙整',
    window: '12:00, 12:05, 17:15, 17:20, 21:00, 21:05',
    interval: '平日 6 個槽點',
    retirement: '不退休 (六槽全跑)',
    action: 'generate-history',
    description: '公開資訊觀測站月營收快照彙整表，自動補齊歷史月營收。彙整表整天隨申報家數重出，命中不會提早收工，平日六個槽點全跑。',
  },
  {
    id: 'mops_profit',
    name: 'MOPS 季報獲利彙整',
    window: '12:00, 12:05, 17:15, 17:20, 21:00, 21:05',
    interval: '平日 6 個槽點',
    retirement: '不退休 (六槽全跑)',
    action: 'generate-history',
    description: '公開資訊觀測站季報財務報表彙整表，自動補齊歷史獲利能力。彙整表整天隨申報家數重出，命中不會提早收工，平日六個槽點全跑。',
  },
]

const CRON_JOBS_CONFIG: CronJobConfig[] = [
  {
    jobname: 'source-probe',
    cron: '*/5 * * * *',
    taipeiTime: '每日 每 5 分鐘 (全天候)',
    action: 'probe',
    role: '探針主引擎',
    description: '驅動 8 大資料源探測，在 Edge 判斷時窗與資料狀態，命中立即聯動抓取。',
  },
  {
    jobname: 'macro-daily',
    cron: '*/30 12-18 * * *',
    taipeiTime: '每日 20:00 – 次日 02:30 每 30 分 (14 班)',
    action: 'sync-macro',
    role: '總經日曆自適應',
    description: 'FRED 核心 CPI / PPI / PCE / FOMC / 非農 / 消費者信心，依發布日曆自適應掃描。',
  },
  {
    jobname: 'fx-daily',
    cron: '0 3,9 * * *',
    taipeiTime: '每日 11:00 / 17:00 (2 班)',
    action: 'sync-fx',
    role: '外匯定時同步',
    description: '紐約匯市收盤後同步 Yahoo 8 大幣對對台幣匯率（17:00 為重試班次）。',
  },
  {
    jobname: 'market-data-daily',
    cron: '0 10,14 * * 1-5',
    taipeiTime: '週一至週五 18:00 / 22:00 (2 班)',
    action: 'generate-market-data',
    role: '估值/日K最外層兜底',
    description: '平日傍晚與晚間定時備援，防範探針未命中時的估值與日 K 漏缺。',
  },
  {
    jobname: 'history-daily',
    cron: '30 4,13 * * 1-5',
    taipeiTime: '週一至週五 12:30 / 21:30 (2 班)',
    action: 'generate-history',
    role: '營收/季報最外層兜底',
    description: 'MOPS 探測槽次後半小時進行補齊重試，雙重確保歷史財報資料落地。',
  },
]

export function MechanismGuide() {
  const [open, setOpen] = useState(false)

  return (
    <div className="section glass adm-guide-section" style={{ padding: '18px 20px' }}>
      <button
        type="button"
        className="adm-guide-toggle"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
      >
        <div className="adm-guide-toggle-title">
          <HelpCircle size={18} className="ast-verdict-icon" />
          <h3 className="head-tight">探針與排程機制運作總覽</h3>
          <span className="source-tag">雙軌架構對照說明</span>
        </div>
        <span className="adm-guide-toggle-action">
          <span>{open ? '收合說明' : '展開機制與週期對照表'}</span>
          <ChevronDown
            size={16}
            className={`apr-caret${open ? ' apr-caret-open' : ''}`}
            aria-hidden="true"
          />
        </span>
      </button>

      {open && (
        <div className="adm-guide-body">
          {/* 雙軌架構核心摘要卡片 */}
          <div className="adm-guide-cards">
            <div className="glass adm-guide-card">
              <div className="adm-guide-card-head">
                <Radio size={16} className="text-accent" />
                <strong>1. 探針主動驅動（Source Probes・毫秒級即時觸發）</strong>
              </div>
              <p className="ast-note">
                由 <code>source-probe</code> 每 5 分鐘驅動，在各自時間窗內探測上游資料是否發布。
                <strong>命中即刻觸發對應抓取</strong>，並在確認資料落地後（日頻來源需 3 次穩定到位、MOPS 需 1 次）
                標記退休收工，不再發送多餘請求；大盤法人採雙時段機制覆蓋初版與盤後鉅額結算。
              </p>
            </div>

            <div className="glass adm-guide-card">
              <div className="adm-guide-card-head">
                <Timer size={16} className="text-accent" />
                <strong>2. pg_cron 定時排程（Schedules・總經、匯率與兜底備援）</strong>
              </div>
              <p className="ast-note">
                由資料庫 <code>pg_cron</code> 定時呼叫 Edge Function。包含美國總經（FRED 日曆自適應掃描）、
                外匯匯率定時同步，以及個股估值/日K（<code>18:00 / 22:00</code>）與營收季報歷史（<code>12:30 / 21:30</code>）
                的最外層安全兜底網。
              </p>
            </div>
          </div>

          {/* 表格 1：資料源探針運作週期 */}
          <div className="adm-guide-subhead">
            <Cpu size={15} />
            <h4>資料源探針運作週期（8 大來源）</h4>
          </div>
          <div className="table-scroll">
            <table className="data-table adm-guide-table">
              <thead>
                <tr>
                  <th>資料源</th>
                  <th>代碼</th>
                  <th>台北時間時窗</th>
                  <th>週期</th>
                  <th>退休 / 收工條件</th>
                  <th>聯動動作 (Action)</th>
                  <th>機制說明</th>
                </tr>
              </thead>
              <tbody>
                {PROBE_SOURCES_CONFIG.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.name}</b>
                    </td>
                    <td className="ast-mono">
                      <code>{p.id}</code>
                    </td>
                    <td className="ast-mono">{p.window}</td>
                    <td>{p.interval}</td>
                    <td>
                      <span className="source-tag">{p.retirement}</span>
                    </td>
                    <td className="ast-mono">
                      <code>{p.action}</code>
                    </td>
                    <td className="ast-note-cell">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 表格 2：pg_cron 定時排程 */}
          <div className="adm-guide-subhead" style={{ marginTop: 20 }}>
            <Timer size={15} />
            <h4>pg_cron 定時排程與兜底備援（5 大排程）</h4>
          </div>
          <div className="table-scroll">
            <table className="data-table adm-guide-table">
              <thead>
                <tr>
                  <th>排程名稱</th>
                  <th>Cron 表達式</th>
                  <th>台北時間 (Asia/Taipei)</th>
                  <th>執行動作 (Action)</th>
                  <th>機制角色</th>
                  <th>任務說明</th>
                </tr>
              </thead>
              <tbody>
                {CRON_JOBS_CONFIG.map((c) => (
                  <tr key={c.jobname}>
                    <td className="ast-mono">
                      <b>{c.jobname}</b>
                    </td>
                    <td className="ast-mono">
                      <code>{c.cron}</code>
                    </td>
                    <td className="ast-mono">{c.taipeiTime}</td>
                    <td className="ast-mono">
                      <code>{c.action}</code>
                    </td>
                    <td>
                      <span className="source-tag">{c.role}</span>
                    </td>
                    <td className="ast-note-cell">{c.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ast-note" style={{ marginTop: 12 }}>
            💡 <strong>架構優化提示</strong>：原固定班表 <code>stock-report-nightly</code>（抓籌碼）與{' '}
            <code>market-daily</code>（抓大盤）已於 0.7.13 退場，由探針命中時自帶觸發取代，免除盲跑浪費。
          </div>
        </div>
      )}
    </div>
  )
}
