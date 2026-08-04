/**
 * 個股分析的內容區。
 *
 * 0.6.8 起「我的持股 / 籌碼 / 基本面 / 技術面」四段**併成單一長頁**（版型 D：卡片分組），
 * 只留「分析內容 / AI 分析」兩個分頁籤。AI 沒有一起併是刻意的 ——
 * 它有 API Key 輸入框與對話狀態，而且內容是按鈕觸發、不是一直在那。
 *
 * 每段各自一張 `.glass` 卡（`.detail-card`），靠卡與卡之間的留白分邊界。
 * 選這個版型是因為它零互動、沒有「東西被收起來找不到」的問題。
 *
 * **持股那段刻意排在 PDF 擷取範圍之外**（`surfaceRef` 只包後三段）：
 * 共用報告一路以來就不含個資，持股數字是前端算的，不該因為版面合併而流進匯出檔。
 *
 * 這是純呈現元件：要看哪一檔、持股數字從哪來，都由呼叫端（AnalysisPage）決定。
 * 頁首左側的 selector 也由呼叫端傳入（目前是切換個股的下拉選單）。
 *
 * 資料流：Storage-first 讀盤後排程預產的共用報告，查無再即點即產 fallback。
 * 基本面在這一層載入一次分發給三處（標題的產業別 badge、基本面那段、AI 分析），
 * 與籌碼報告各自獨立，任一失敗不影響另一個。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Download, RefreshCw } from 'lucide-react'
import {
  fetchStoredReport,
  generateReport,
  type ReportData,
  type ReportHolding,
} from '../../services/reportProxy'
import { fetchFundamental, type FundamentalData } from '../../services/fundamentalProxy'
import { warmStock } from '../../services/warmStock'
import { downloadBlob, generatePdfBlob } from '../../services/reportPdf'
import { AiTab } from './AiTab'
import { ChipsTab } from './ChipsTab'
import { FundamentalTab } from './FundamentalTab'
import { HoldingTab } from './HoldingTab'
import { TechnicalTab } from './TechnicalTab'

export interface StockDetailTarget {
  ticker: string
  name: string
  holding: ReportHolding | null
}

interface StockDetailPageProps extends StockDetailTarget {
  /** 頁首左側的控制項（AnalysisPage 傳入切換個股的下拉選單） */
  selector?: ReactNode
}

type DetailTab = 'analysis' | 'ai'

const TABS: Array<{ id: DetailTab; label: string }> = [
  { id: 'analysis', label: '分析內容' },
  { id: 'ai', label: 'AI 分析' },
]

/**
 * 這份基本面是不是還缺歷史。
 *
 * 門檻用後端的 cap（月營收 12 個月、獲利能力 12 季）。低於它就再叫一次 warm ——
 * 真的沒那麼多期的標的（新上市、ETF）不會因此無限重試：伺服器補到沒東西可補時
 * 會回 `fundamentalComplete: true`，warmStock 那層就封印該代號。
 */
function needsFundamentalBackfill(f: FundamentalData): boolean {
  return f.revenueMonths.length < 12 || f.profitQuarters.length < 12
}

/** 長頁的分組標題。四段共用，讓層級明顯高過各段內部的 `.rpt-section h3` */
function CardHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="card-head">
      <span className="card-dot" aria-hidden="true" />
      <h3>{title}</h3>
      {meta && <span className="card-meta">{meta}</span>}
    </div>
  )
}

export function StockDetailPage({ ticker, name, holding, selector }: StockDetailPageProps) {
  const [tab, setTab] = useState<DetailTab>('analysis')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [errMsg, setErrMsg] = useState('')
  const [report, setReport] = useState<ReportData | null>(null)
  const [fundamental, setFundamental] = useState<FundamentalData | null>(null)
  const [fundLoading, setFundLoading] = useState(true)
  // 使用者按「重新整理」時 +1，串進各載入 effect 的依賴強制重抓。
  // 需要它是因為：報告與基本面只在開頁（ticker 變更）時抓一次，而盤後批次
  // 會在使用者看著的當下更新資料 —— 沒有這個鈕就只能整頁重載才看得到新的。
  const [reloadKey, setReloadKey] = useState(0)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [pdfNote, setPdfNote] = useState('')
  const surfaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setStatus('loading')
    setReport(null)
    ;(async () => {
      try {
        // Storage-first：盤後排程預產的共用報告（快、免打 TWSE）
        const stored = await fetchStoredReport(ticker)
        if (alive && stored) {
          setReport(stored)
          setStatus('ready')
          return
        }
        // fallback：未預產（不在清單 / 當日尚未產 / 舊格式）時即點即產
        const fresh = await generateReport({ market: 'TPE', ticker, name, holding })
        if (alive) {
          setReport(fresh)
          setStatus('ready')
        }
      } catch (e: unknown) {
        if (alive) {
          setErrMsg(e instanceof Error ? e.message : '產生報告失敗')
          setStatus('error')
        }
      }
    })()
    return () => {
      alive = false
    }
    // holding 不列入依賴：開頁當下的持股脈絡即可，避免現價刷新導致重複產生
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, name, reloadKey])

  // 分頁切回前景時比對報告有沒有換過一份（0.6.2）。
  //
  // 上面那個 effect 只在開頁時抓一次。三班制時代一天才更新 3 次，還算堪用；
  // 0.6.1 起盤後批次改成 16:00–23:45 每 15 分鐘輪詢，**報告會在使用者看著的當下更新**，
  // 開著不動就會一直停在開頁那一刻的快照 —— 實際發生過：20:15 的批次已寫出當天的報告，
  // 而 20:15 之前開的分頁仍顯示前一個交易日的籌碼。
  //
  // 作法沿用 useStockPrices 的 visibilitychange，不另開 timer：
  // 背景分頁的 timer 會被瀏覽器節流，而切回前景本來就是使用者要看資料的時刻。
  //
  // 0.6.8 起基本面也一起比對。四段併成一頁之後，「只有籌碼會自己更新」這件事
  // 從看不見變成肉眼可見的不對稱 —— 同一張畫面上籌碼跳到今天、月營收還停在昨天。
  // 技術面不在這裡處理：它由自己的 effect 管，且日線一天只換一次。
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void (async () => {
        const stored = await fetchStoredReport(ticker)
        if (stored) {
          // 只在 generatedAt 真的變了才換：沒變就別動 state，
          // 否則每次切回前景都重繪一次，捲動位置與展開狀態會被洗掉。
          setReport((prev) => (prev && stored.generatedAt !== prev.generatedAt ? stored : prev))
        }
        const f = await fetchFundamental(ticker)
        // 同樣只在真的換過一份時才 setState（比 asOf，那是我們寫檔的時刻）
        if (f) setFundamental((prev) => (prev && f.asOf !== prev.asOf ? f : prev))
      })()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [ticker])

  /*
    基本面獨立載入：與籌碼報告平行、互不阻塞，查無即 null（proxy 已吞錯）。

    **查無、或歷史還沒補滿時都補叫 warm**（0.6.29）。原本只在「完全查無」時叫，
    結果是新股票第一次開頁建好檔案之後就再也不叫了 —— 剩下的月份與季別要等夜間批次，
    而那段回補排在批次的短路判斷之後，當天多半輪不到。畫面上的差別是：
    新股票只有兩三個月的月營收，既有股票有 12 個月。

    伺服器端補滿之後回空、一個對外請求都不發，所以這個條件不會變成每次開頁都燒額度；
    warmStock 那層也只在伺服器回報「還沒補完」時才解除同代號的封印。
  */
  useEffect(() => {
    let alive = true
    setFundLoading(true)
    setFundamental(null)
    ;(async () => {
      let f = await fetchFundamental(ticker)
      if (!f || needsFundamentalBackfill(f)) {
        const warmed = await warmStock(ticker)
        if (warmed.fundamentalSynced > 0 || warmed.backfilled > 0) f = (await fetchFundamental(ticker)) ?? f
      }
      if (alive) {
        setFundamental(f)
        setFundLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [ticker, reloadKey])

  async function handleDownload() {
    if (!surfaceRef.current) return
    setPdfBusy(true)
    setPdfNote('')
    try {
      const blob = await generatePdfBlob(surfaceRef.current)
      // 檔名不再叫「盤後籌碼」：0.6.8 起擷取範圍是籌碼＋基本面＋技術面三段
      downloadBlob(blob, `個股分析-${ticker}-${report?.dataDate ?? ''}.pdf`)
    } catch {
      setPdfNote('PDF 產生失敗，請再試一次。')
    } finally {
      setPdfBusy(false)
    }
  }

  return (
    <div className="section">
      <div className="detail-head">
        {selector}
        <div className="detail-title">
          <h2>
            {ticker} {name}
            {fundamental?.industry && (
              <span className="badge" style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                {fundamental.industry}
              </span>
            )}
          </h2>
          {/* 資料日期與更新時間屬於「籌碼」報告本身，故顯示於報告表頭（也在 PDF 擷取範圍內），此處不重複 */}
          <span className="hint">個股分析</span>
        </div>
        <button
          className="btn btn-sm"
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={status === 'loading' || fundLoading}
          title="重新抓取籌碼、技術面與基本面"
        >
          <RefreshCw size={14} className={status === 'loading' || fundLoading ? 'spin' : undefined} />
          重新整理
        </button>
        {/*
          0.6.8 起不再限定「籌碼分頁」（那個分頁已經不存在），改成籌碼報告載好就能匯出。
          擷取範圍是籌碼＋基本面＋技術面，**不含持股**（見 surfaceRef 掛載處）。
        */}
        {status === 'ready' && tab === 'analysis' && (
          <button className="btn btn-sm" onClick={() => void handleDownload()} disabled={pdfBusy}>
            <Download size={14} className={pdfBusy ? 'spin' : undefined} />
            {pdfBusy ? '產生 PDF 中…' : '下載 PDF'}
          </button>
        )}
      </div>

      <nav className="subtabs" aria-label="個股分析分頁">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={tab === id ? 'subtab active' : 'subtab'}
            onClick={() => setTab(id)}
            aria-current={tab === id}
          >
            {label}
          </button>
        ))}
      </nav>

      {pdfNote && <div className="detail-note">{pdfNote}</div>}

      {tab === 'analysis' ? (
        <div className="detail-stack">
          {/*
            持股在 surfaceRef **外面**，所以不會進 PDF。
            這是刻意的：共用報告一路以來就不含個資，持股數字是前端依交易紀錄算的。
            順序是使用者定的（持股 → 籌碼 → 基本面 → 技術面），別自行調換。
          */}
          <section className="glass detail-card" aria-labelledby="sec-holding">
            <CardHead title="我的持股" meta="你的部位" />
            <div id="sec-holding">
              <HoldingTab holding={holding} />
            </div>
          </section>

          <div className="detail-stack" ref={surfaceRef}>
            <section className="glass detail-card" aria-labelledby="sec-chips">
              <CardHead title="籌碼" meta="三大法人 · 融資融券" />
              <div id="sec-chips">
                {/* 籌碼的載入 / 錯誤只影響自己這張卡，其他三段照常顯示 */}
                {status === 'loading' && (
                  <div className="empty-state" style={{ padding: 32 }}>
                    <RefreshCw size={28} className="spin" />
                    <div style={{ marginTop: 10 }}>正在讀取盤後籌碼…</div>
                  </div>
                )}
                {status === 'error' && (
                  <div className="notice notice-warn" role="alert">
                    <AlertTriangle size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                    {errMsg}
                  </div>
                )}
                {status === 'ready' && report && <ChipsTab report={report} />}
              </div>
            </section>

            <section className="glass detail-card" aria-labelledby="sec-fundamental">
              <CardHead title="基本面" meta="估值 · 獲利能力 · 月營收" />
              <div id="sec-fundamental">
                <FundamentalTab fundamental={fundamental} loading={fundLoading} />
              </div>
            </section>

            <section className="glass detail-card" aria-labelledby="sec-technical">
              <CardHead title="技術面" meta="日 K · 成交量 · KD" />
              <div id="sec-technical">
                <TechnicalTab ticker={ticker} reloadKey={reloadKey} />
              </div>
            </section>
          </div>
        </div>
      ) : (
        <div className="glass detail-body">
          <AiTab ticker={ticker} name={name} report={report} fundamental={fundamental} />
        </div>
      )}
    </div>
  )
}
